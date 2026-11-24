import type { AuthContext } from '../auth/index.js';
import { ApiProblem } from '../platform/index.js';
import type { Tx } from '../tenancy/index.js';
import type { RefKind } from './fields.js';
import type { ImportOptions, RowIssue, ValueMap } from './types.js';
import { normKey } from './values.js';

/**
 * Resolution of the reference columns of an import (category, manufacturer, model, status, location,
 * department, vendor, person) to ids (M2-IMP-03). The order is: an explicit entry of the job's value map,
 * then an exact name match (ignoring case, padding and repeated spaces) among the live records, then the
 * policy of the kind: `create` (what is missing is created, in a dry run only announced) or `must_exist`.
 *
 * Reads are memoised for the lifetime of the resolver (one worker step = one transaction), so a batch of
 * 500 rows reads each catalogue once. Creation goes through the same services as the API, so audit rows,
 * events and validation are never bypassed.
 */

export type Resolution =
  | { kind: 'found'; id: string; name: string }
  | { kind: 'create'; name: string }
  | { kind: 'none' }
  | { kind: 'error'; issue: RowIssue };

/** The create operations of the services the resolver may call (satisfied by the real services). */
export interface RefServices {
  categories: {
    create(
      auth: AuthContext,
      body: Record<string, never> | never,
    ): Promise<{ data: Record<string, unknown> }>;
  };
  manufacturers: {
    create(auth: AuthContext, body: never): Promise<{ data: Record<string, unknown> }>;
  };
  vendors: { create(auth: AuthContext, body: never): Promise<{ data: Record<string, unknown> }> };
  models: { create(auth: AuthContext, body: never): Promise<{ data: Record<string, unknown> }> };
  departments: {
    create(
      auth: AuthContext,
      body: never,
      meta?: Record<string, unknown>,
    ): Promise<{ data: Record<string, unknown> }>;
  };
  locations: {
    create(
      auth: AuthContext,
      body: never,
      meta?: Record<string, unknown>,
    ): Promise<{ data: Record<string, unknown> }>;
  };
  people: {
    create(
      auth: AuthContext,
      body: never,
      meta?: Record<string, unknown>,
    ): Promise<{ data: Record<string, unknown> }>;
  };
}

interface Named {
  id: string;
  name: string;
}
interface ModelEntry extends Named {
  category_id: string;
  manufacturer_id: string | null;
}

const LABELS: Record<RefKind, string> = {
  category: 'category',
  manufacturer: 'manufacturer',
  model: 'model',
  status: 'status label',
  location: 'location',
  department: 'department',
  vendor: 'vendor',
  person: 'person',
};
const FIELD_OF: Record<RefKind, string> = {
  category: 'category',
  manufacturer: 'manufacturer',
  model: 'model',
  status: 'status',
  location: 'location',
  department: 'department',
  vendor: 'vendor',
  person: 'assigned_to',
};

/** Splits a location path on `>`, `/`, `\`, `|`, `›` and `»`; empty parts are dropped. */
export function splitPath(text: string): string[] {
  return text
    .split(/[>/\\|›»]/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

export class RefResolver {
  private readonly named = new Map<string, Promise<Named[]>>();
  private models?: Promise<ModelEntry[]>;
  private readonly children = new Map<string, Promise<Named[]>>();
  private allLocations?: Promise<Array<Named & { parent_id: string | null }>>;
  private readonly people = new Map<string, Promise<Named | null>>();
  /** Everything created by this resolver, for the caller's counters. */
  readonly created: Record<string, number> = {};

  constructor(
    private readonly tx: Tx,
    private readonly auth: AuthContext,
    private readonly options: ImportOptions,
    private readonly valueMap: ValueMap,
    private readonly services: RefServices,
    private readonly mode: 'dry' | 'commit',
    private readonly overrideField?: (kind: RefKind) => string,
    /** Recorded with the audit entry of every location, department and person this resolver creates. */
    private readonly meta?: Record<string, unknown>,
  ) {}

  private field(kind: RefKind): string {
    return this.overrideField ? this.overrideField(kind) : FIELD_OF[kind];
  }

  private policy(kind: RefKind): 'create' | 'must_exist' {
    const set = this.options.references[kind];
    if (set) return set;
    // creating a status label needs a state type: it is never created implicitly
    return kind === 'status' || kind === 'person' ? 'must_exist' : 'create';
  }

  private missing(kind: RefKind, text: string): Resolution {
    const what = LABELS[kind];
    return {
      kind: 'error',
      issue: {
        field: this.field(kind),
        code: 'not-found',
        message: `No ${what} named "${text.slice(0, 80)}". Create it first, map the value to an existing ${what}, or allow creating missing ${what === 'person' ? 'people' : `${what}s`}.`,
      },
    };
  }

  // ---------------------------------------------------------------------------- catalogue reads

  private list(kind: Exclude<RefKind, 'model' | 'location' | 'person'>): Promise<Named[]> {
    let hit = this.named.get(kind);
    if (!hit) {
      const live = { archived_at: null };
      const select = { id: true, name: true };
      switch (kind) {
        case 'category':
          hit = this.tx.category.findMany({ where: { ...live, kind: 'asset' }, select });
          break;
        case 'manufacturer':
          hit = this.tx.manufacturer.findMany({ where: live, select });
          break;
        case 'vendor':
          hit = this.tx.vendor.findMany({ where: live, select });
          break;
        case 'status':
          hit = this.tx.status_label.findMany({ where: live, select });
          break;
        case 'department':
          hit = this.tx.department.findMany({ where: live, select });
          break;
      }
      this.named.set(kind, hit);
    }
    return hit;
  }

  private async modelList(): Promise<ModelEntry[]> {
    this.models ??= this.tx.asset_model.findMany({
      where: { archived_at: null },
      select: { id: true, name: true, category_id: true, manufacturer_id: true },
    });
    return this.models;
  }

  private async remember(kind: RefKind, entry: Named & Partial<ModelEntry>): Promise<void> {
    if (kind === 'model') (await this.modelList()).push(entry as ModelEntry);
    else if (kind !== 'location' && kind !== 'person') (await this.list(kind)).push(entry);
  }

  // ------------------------------------------------------------------------------------ resolve

  /**
   * One reference cell. `scope` carries what a model needs to be told apart: the resolved category (null
   * when it is about to be created) and manufacturer.
   */
  async resolve(
    kind: RefKind,
    text: string,
    scope: { categoryId?: string | null; manufacturerId?: string | null } = {},
  ): Promise<Resolution> {
    const entry = this.valueMap[kind]?.[normKey(text)];
    if (entry) {
      if ('skip' in entry) return { kind: 'none' };
      if ('id' in entry) return this.byId(kind, entry.id, text);
      // "create it" must not create it twice: the records made by earlier rows (or already there) are found first
      return this.findOrCreate(kind, entry.name ?? text, scope);
    }
    switch (kind) {
      case 'location':
        return this.location(text);
      case 'person':
        return this.person(text);
      case 'model':
        return this.model(text, scope);
      default: {
        const hit = (await this.list(kind)).find((n) => normKey(n.name) === normKey(text));
        if (hit) return { kind: 'found', id: hit.id, name: hit.name };
        return this.policy(kind) === 'create' && kind !== 'status'
          ? this.createOrAnnounce(kind, text, scope)
          : this.missing(kind, text);
      }
    }
  }

  private async byId(kind: RefKind, id: string, text: string): Promise<Resolution> {
    let found: Named | null | undefined;
    switch (kind) {
      case 'model':
        found = (await this.modelList()).find((m) => m.id === id);
        break;
      case 'location':
        found = await this.tx.location.findFirst({
          where: { id, archived_at: null },
          select: { id: true, name: true },
        });
        break;
      case 'person':
        found = await this.tx.person
          .findFirst({ where: { id, archived_at: null }, select: { id: true, display_name: true } })
          .then((p) => (p ? { id: p.id, name: p.display_name } : null));
        break;
      default:
        found = (await this.list(kind)).find((n) => n.id === id);
    }
    if (!found) {
      return {
        kind: 'error',
        issue: {
          field: this.field(kind),
          code: 'not-found',
          message: `The ${LABELS[kind]} that "${text.slice(0, 60)}" is mapped to no longer exists. Edit the value mapping.`,
        },
      };
    }
    return { kind: 'found', id: found.id, name: found.name };
  }

  // -------------------------------------------------------------------------------------- model

  private async model(
    text: string,
    scope: { categoryId?: string | null; manufacturerId?: string | null },
  ): Promise<Resolution> {
    const key = normKey(text);
    const sameName = (await this.modelList()).filter((m) => normKey(m.name) === key);
    const inCategory = scope.categoryId
      ? sameName.filter((m) => m.category_id === scope.categoryId)
      : [];
    let pool = inCategory;
    if (scope.manufacturerId) {
      const exact = inCategory.filter((m) => m.manufacturer_id === scope.manufacturerId);
      pool = exact.length > 0 ? exact : inCategory.filter((m) => m.manufacturer_id === null);
    }
    if (pool.length > 0) return { kind: 'found', id: pool[0]!.id, name: pool[0]!.name };
    if (sameName.length > 0 && scope.categoryId && inCategory.length === 0) {
      // the name exists, but under another category: never silently re-file it
      const other = await this.tx.category.findUnique({
        where: { id: sameName[0]!.category_id },
        select: { name: true },
      });
      return {
        kind: 'error',
        issue: {
          field: 'model',
          code: 'invalid',
          message: `The model "${text.slice(0, 80)}" already exists in the category "${other?.name ?? 'another category'}", not in this asset's category.`,
        },
      };
    }
    if (this.policy('model') === 'create') return this.createOrAnnounce('model', text, scope);
    return this.missing('model', text);
  }

  // ------------------------------------------------------------------------------------ location

  private childrenOf(parentId: string | null): Promise<Named[]> {
    const key = parentId ?? 'root';
    let hit = this.children.get(key);
    if (!hit) {
      hit = this.tx.location.findMany({
        where: { parent_id: parentId, archived_at: null },
        select: { id: true, name: true },
      });
      this.children.set(key, hit);
    }
    return hit;
  }

  private async location(text: string): Promise<Resolution> {
    const parts = splitPath(text);
    if (parts.length === 0) return { kind: 'none' };
    let parent: string | null = null;
    let depth = 0;
    let last: Named | null = null;
    for (; depth < parts.length; depth++) {
      const hit: Named | undefined = (await this.childrenOf(parent)).find(
        (c) => normKey(c.name) === normKey(parts[depth]!),
      );
      if (!hit) break;
      parent = hit.id;
      last = hit;
    }
    if (depth === parts.length && last) return { kind: 'found', id: last.id, name: last.name };
    if (parts.length === 1 && depth === 0) {
      // a bare name: fine when exactly one live location has it, wherever it sits
      this.allLocations ??= this.tx.location.findMany({
        where: { archived_at: null },
        select: { id: true, name: true, parent_id: true },
      });
      const same = (await this.allLocations).filter((l) => normKey(l.name) === normKey(parts[0]!));
      if (same.length === 1) return { kind: 'found', id: same[0]!.id, name: same[0]!.name };
      if (same.length > 1) {
        return {
          kind: 'error',
          issue: {
            field: this.field('location'),
            code: 'ambiguous',
            message: `"${parts[0]}" matches ${same.length} locations; write the full path such as "Site > Building > ${parts[0]}".`,
          },
        };
      }
    }
    if (this.policy('location') !== 'create') return this.missing('location', text);
    if (this.mode === 'dry') return { kind: 'create', name: parts.join(' > ') };
    // create the missing parts below the deepest existing one
    let id: string | null = parent;
    let name = last?.name ?? parts[0]!;
    for (let i = depth; i < parts.length; i++) {
      const created = await this.services.locations.create(
        this.auth,
        {
          parent_id: id,
          name: parts[i]!,
          kind: this.options.location_kind,
        } as never,
        this.meta,
      );
      this.children.delete(id ?? 'root');
      this.allLocations = undefined;
      id = created.data.id as string;
      name = parts[i]!;
      this.created.location = (this.created.location ?? 0) + 1;
    }
    return { kind: 'found', id: id!, name };
  }

  // -------------------------------------------------------------------------------------- person

  private person(text: string): Promise<Resolution> {
    const key = normKey(text);
    let hit = this.people.get(key);
    if (!hit) {
      hit = this.findPerson(text);
      this.people.set(key, hit);
    }
    return hit.then(async (p) => {
      if (p) return { kind: 'found', id: p.id, name: p.name } as Resolution;
      if (this.policy('person') !== 'create') return this.missing('person', text);
      return this.createOrAnnounce('person', text, {});
    });
  }

  private async findPerson(text: string): Promise<Named | null> {
    const key = normKey(text);
    const select = { id: true, display_name: true } as const;
    const live = { archived_at: null };
    if (key.includes('@')) {
      const p = await this.tx.person.findFirst({ where: { ...live, email_key: key }, select });
      return p ? { id: p.id, name: p.display_name } : null;
    }
    const byRef = await this.tx.person.findFirst({
      where: { ...live, employee_ref: text.trim() },
      select,
    });
    if (byRef) return { id: byRef.id, name: byRef.display_name };
    const rows = await this.tx.$queryRaw<Array<{ id: string; display_name: string }>>`
      select id, display_name from app.person
       where archived_at is null and lower(btrim(display_name)) = ${key} limit 2`;
    return rows.length === 1 ? { id: rows[0]!.id, name: rows[0]!.display_name } : null;
  }

  // ---------------------------------------------------------------------------------- creation

  /** An explicit "create it" of the value map: the record of that name if there is one, else created. */
  private async findOrCreate(
    kind: RefKind,
    name: string,
    scope: { categoryId?: string | null; manufacturerId?: string | null },
  ): Promise<Resolution> {
    switch (kind) {
      case 'location':
        return this.location(name);
      case 'person': {
        const found = await this.findPerson(name);
        return found
          ? { kind: 'found', id: found.id, name: found.name }
          : this.createOrAnnounce(kind, name, scope);
      }
      case 'model': {
        const key = normKey(name);
        const hit = (await this.modelList()).find(
          (m) =>
            normKey(m.name) === key && (!scope.categoryId || m.category_id === scope.categoryId),
        );
        return hit
          ? { kind: 'found', id: hit.id, name: hit.name }
          : this.createOrAnnounce(kind, name, scope);
      }
      case 'status':
        return this.missing(kind, name);
      default: {
        const hit = (await this.list(kind)).find((n) => normKey(n.name) === normKey(name));
        return hit
          ? { kind: 'found', id: hit.id, name: hit.name }
          : this.createOrAnnounce(kind, name, scope);
      }
    }
  }

  private async createOrAnnounce(
    kind: RefKind,
    name: string,
    scope: { categoryId?: string | null; manufacturerId?: string | null },
  ): Promise<Resolution> {
    const clean = name
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, kind === 'person' ? 200 : 100);
    if (kind === 'status') return this.missing('status', name);
    if (kind === 'location') return this.location(name); // an explicit `create` entry follows the path rules
    if (this.mode === 'dry') return { kind: 'create', name: clean };
    try {
      let data: Record<string, unknown>;
      switch (kind) {
        case 'category':
          ({ data } = await this.services.categories.create(this.auth, {
            name: clean,
            kind: 'asset',
          } as never));
          break;
        case 'manufacturer':
          ({ data } = await this.services.manufacturers.create(this.auth, {
            name: clean.slice(0, 200),
          } as never));
          break;
        case 'vendor':
          ({ data } = await this.services.vendors.create(this.auth, {
            name: clean.slice(0, 200),
          } as never));
          break;
        case 'department':
          ({ data } = await this.services.departments.create(
            this.auth,
            {
              name: clean.slice(0, 200),
            } as never,
            this.meta,
          ));
          break;
        case 'model': {
          if (!scope.categoryId) {
            return {
              kind: 'error',
              issue: {
                field: 'model',
                code: 'invalid',
                message: 'A model cannot be created without its category.',
              },
            };
          }
          ({ data } = await this.services.models.create(this.auth, {
            category_id: scope.categoryId,
            manufacturer_id: scope.manufacturerId ?? null,
            name: clean.slice(0, 200),
          } as never));
          break;
        }
        case 'person': {
          const email = clean.includes('@') ? clean.toLowerCase() : null;
          ({ data } = await this.services.people.create(
            this.auth,
            {
              display_name: email ? (email.split('@')[0] ?? clean) : clean,
              ...(email ? { email } : {}),
            } as never,
            this.meta,
          ));
          break;
        }
        default:
          return this.missing(kind, name);
      }
      const id = data.id as string;
      const display = (data.name ?? data.display_name ?? clean) as string;
      await this.remember(kind, {
        id,
        name: display,
        ...(kind === 'model'
          ? { category_id: scope.categoryId!, manufacturer_id: scope.manufacturerId ?? null }
          : {}),
      });
      if (kind === 'person') this.people.set(normKey(name), Promise.resolve({ id, name: display }));
      this.created[kind] = (this.created[kind] ?? 0) + 1;
      return { kind: 'found', id, name: display };
    } catch (err) {
      if (err instanceof ApiProblem) {
        return {
          kind: 'error',
          issue: {
            field: this.field(kind),
            code: 'invalid',
            message: `Could not create the ${LABELS[kind]} "${clean.slice(0, 60)}": ${err.detail ?? err.message}`,
          },
        };
      }
      throw err;
    }
  }
}
