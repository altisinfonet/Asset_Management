import {
  locationCreateSchema,
  locationUpdateSchema,
  type LocationsService,
} from '../../locations/index.js';
import { RefResolver, splitPath } from '../refs.js';
import type { MappedRecord, RowIssue } from '../types.js';
import { normKey } from '../values.js';
import { type Existing, type Prep, ServiceHandler } from './service-handler.js';
import { type HandlerEnv, plainPointer } from './shared.js';

interface LocationPrep extends Prep {
  parentId: string | null;
  /** The parent is only announced (will be created): the existing-child lookup is moot. */
  parentPending: boolean;
  name: string;
  fullPath: string[];
}

const ADDRESS_KEYS = {
  address_line1: 'line1',
  address_line2: 'line2',
  city: 'city',
  region: 'region',
  postal_code: 'postal_code',
  country: 'country',
} as const;

/**
 * Location imports (M2-IMP-07). A row is a name under a parent, given either as a full path
 * (`HQ > Building 2 > Room 14`) or as `name` + `parent_path`; missing parents are created (policy
 * `references.location`), so a tree can be loaded in any row order. A location is matched by its place in the
 * tree: the live child of that parent with that name (ignoring case and padding). Written by `LocationsService`.
 */
export class LocationHandler extends ServiceHandler {
  protected readonly label = 'location';
  protected readonly pointer = plainPointer({ parent_id: 'parent_path' });
  protected readonly createSchema = locationCreateSchema;
  protected readonly updateSchema = locationUpdateSchema;
  protected readonly identity = ['name', 'parent_id'] as const;

  constructor(private readonly locations: LocationsService) {
    super();
  }

  protected override refField(): string {
    return 'parent_path';
  }

  /** Name and parent path of a row, from the full path or from `name` + `parent_path`. */
  static place(rec: MappedRecord): { name: string; parent: string[]; full: string[] } | null {
    const path = typeof rec.f.path === 'string' ? splitPath(rec.f.path) : [];
    if (path.length > 0)
      return { name: path[path.length - 1]!, parent: path.slice(0, -1), full: path };
    const name = typeof rec.f.name === 'string' ? rec.f.name.trim() : '';
    if (!name) return null;
    const parent = typeof rec.f.parent_path === 'string' ? splitPath(rec.f.parent_path) : [];
    return { name, parent, full: [...parent, name] };
  }

  keys(rec: MappedRecord): { k1: string | null; k2: string | null } {
    const place = LocationHandler.place(rec);
    return { k1: place ? `path:${place.full.map(normKey).join('>')}` : null, k2: null };
  }

  protected async prepare(
    env: HandlerEnv,
    resolver: RefResolver,
    rec: MappedRecord,
  ): Promise<LocationPrep> {
    const place = LocationHandler.place(rec);
    const prep: LocationPrep = {
      issues: [],
      warnings: [],
      create: {},
      update: {},
      pending: false,
      parentId: null,
      parentPending: false,
      name: '',
      fullPath: [],
    };
    if (!place) {
      prep.issues.push({
        field: 'name',
        code: 'required',
        message: 'The row has no name or path.',
      });
      return prep;
    }
    prep.name = place.name;
    prep.fullPath = place.full;
    if (place.parent.length > 0) {
      const res = await resolver.resolve('location', place.parent.join(' > '));
      if (res.kind === 'found') prep.parentId = res.id;
      else if (res.kind === 'create') {
        prep.pending = true;
        prep.parentPending = true;
        prep.warnings.push({
          field: 'parent_path',
          code: 'will-create',
          message: `Will create location "${res.name}"`,
        });
      } else if (res.kind === 'error') prep.issues.push({ ...res.issue, field: 'parent_path' });
    }
    prep.create.name = place.name;
    prep.create.parent_id = prep.parentId;
    prep.create.kind = (rec.f.kind as string | undefined) ?? env.options.location_kind;
    if (rec.f.kind !== undefined) prep.update.kind = rec.f.kind;
    for (const key of ['code', 'notes'] as const) {
      if (rec.f[key] !== undefined) {
        prep.create[key] = rec.f[key];
        prep.update[key] = rec.f[key];
      }
    }
    for (const key of ['latitude', 'longitude'] as const) {
      if (rec.f[key] !== undefined) {
        prep.create[key] = rec.f[key];
        prep.update[key] = rec.f[key];
      }
    }
    const address: Record<string, unknown> = {};
    for (const [target, member] of Object.entries(ADDRESS_KEYS))
      if (rec.f[target] !== undefined) address[member] = rec.f[target];
    if (env.options.blank_cells === 'clear') {
      for (const target of rec.b) {
        if (target in ADDRESS_KEYS)
          address[ADDRESS_KEYS[target as keyof typeof ADDRESS_KEYS]] = null;
        if (
          target === 'code' ||
          target === 'notes' ||
          target === 'latitude' ||
          target === 'longitude'
        )
          prep.update[target] = null;
      }
    }
    if (Object.keys(address).length > 0) {
      prep.create.address = address;
      prep.update.address = address;
    }
    return prep;
  }

  protected async lookup(env: HandlerEnv, recs: MappedRecord[], preps: Prep[]) {
    const parents = new Set<string | null>();
    for (const p of preps as LocationPrep[])
      if (!p.parentPending && p.name) parents.add(p.parentId);
    const rows = parents.size
      ? await env.tx.location.findMany({
          where: {
            archived_at: null,
            OR: [
              ...(parents.has(null) ? [{ parent_id: null }] : []),
              { parent_id: { in: [...parents].filter((p): p is string => p !== null) } },
            ],
          },
          select: { id: true, name: true, parent_id: true, version: true },
        })
      : [];
    return (i: number): { hit: Existing | null; issue?: RowIssue } => {
      void recs;
      const p = preps[i] as LocationPrep;
      if (p.parentPending || !p.name) return { hit: null };
      const hit = rows.find(
        (l) => l.parent_id === p.parentId && normKey(l.name) === normKey(p.name),
      );
      return {
        hit: hit ? { id: hit.id, version: hit.version, label: p.fullPath.join(' > ') } : null,
      };
    };
  }

  protected async doCreate(
    env: HandlerEnv,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<string> {
    const res = await this.locations.create(env.auth, body as never, meta);
    return res.data.id as string;
  }

  protected async doUpdate(
    env: HandlerEnv,
    id: string,
    body: Record<string, unknown>,
    meta: Record<string, unknown>,
  ): Promise<number> {
    let next = body;
    if (body.address && typeof body.address === 'object') {
      // the service replaces the address as a whole: merge the cells of the file into the stored one
      const current = await env.tx.location.findUnique({
        where: { id },
        select: { address: true },
      });
      next = {
        ...body,
        address: {
          ...((current?.address as Record<string, unknown> | null) ?? {}),
          ...(body.address as Record<string, unknown>),
        },
      };
    }
    const res = await this.locations.update(env.auth, id, { kind: 'any' }, next as never, meta);
    return res.version;
  }

  protected async currentOf(env: HandlerEnv, id: string) {
    const row = await env.tx.location.findUnique({ where: { id } });
    return row && !row.archived_at
      ? { version: row.version, row: row as unknown as Record<string, unknown> }
      : null;
  }
}
