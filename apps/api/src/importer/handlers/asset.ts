import { locationScopeWhere } from '../../tenancy/index.js';
import type { CustodyService } from '../../lifecycle/index.js';
import {
  type AssetCreate,
  type AssetRow,
  type AssetUpdate,
  type AssetsFacade,
  type FieldDef,
  assetCreateSchema,
  assetUpdateSchema,
  loadAsset,
  toFieldDef,
} from '../../registry/index.js';
import { RefResolver, type Resolution } from '../refs.js';
import type { MappedRecord, Outcome, RowIssue, Verdict } from '../types.js';
import { normKey, parseBoolean, parseDate, parseNumber } from '../values.js';
import {
  type EntityHandler,
  type HandlerEnv,
  type WorkRow,
  assetPointer,
  inNamedSavepoint,
  issuesOf,
  rehearse,
  zodIssues,
} from './shared.js';

/** Per-step lookups shared by the rows of a batch. */
interface AssetStepCache {
  resolver: RefResolver;
  defs: Array<FieldDef & { categoryId: string | null }>;
  statuses: Map<string, { id: string; name: string; state_type: string }>;
  defaultStatusId: string | null;
}

/** What the cells of one row came to once the references are resolved. */
interface ExistingAsset {
  id: string;
  asset_tag: string;
  asset_tag_key: string | null;
  serial_key: string | null;
  version: number;
  archived_at: Date | null;
  external_id: string | null;
}
interface Found {
  byTag: ExistingAsset[];
  bySerial: ExistingAsset[];
  byExt: ExistingAsset[];
}

interface Prepared {
  issues: RowIssue[];
  warnings: RowIssue[];
  /** Fields for create (ids resolved); references that are only announced (dry run) are missing. */
  create: Record<string, unknown>;
  /** The same for an update: only what the file says (blank cells only with `blank_cells = clear`). */
  update: Record<string, unknown>;
  /** A category, model or other reference will be created by the commit: checks that need its id are skipped. */
  pending: boolean;
  newCategory: boolean;
  assignee: Resolution | null;
  statusState: string | null;
  categoryId: string | null;
}

const NULLABLE_CLEAR: Record<string, unknown> = {
  name: null,
  serial: null,
  model_id: null,
  location_id: null,
  department_id: null,
  vendor_id: null,
  purchase_date: null,
  purchase_cost: null,
  order_number: null,
  warranty_end: null,
  notes: null,
};
const TARGET_COLUMN: Record<string, string> = {
  name: 'name',
  serial: 'serial',
  model: 'model_id',
  location: 'location_id',
  department: 'department_id',
  vendor: 'vendor_id',
  purchase_date: 'purchase_date',
  purchase_cost: 'purchase_cost',
  order_number: 'order_number',
  warranty_end: 'warranty_end',
  notes: 'notes',
};

const PLACEHOLDER_ID = '00000000-0000-4000-8000-000000000000';

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Asset imports (M2-IMP-04/05/06). Validation and writing go through `AssetsFacade` (the very code
 * behind `POST /v1/assets` and `PATCH /v1/assets/{id}`): a dry run calls the facade with `dryRun`, which runs
 * every check and stops before the first write; a commit calls it for real, with the import job in the
 * audit metadata. References are resolved by `RefResolver` (which creates what the policy allows, through
 * the services of the API); `assigned_to` checks the asset out through `CustodyService`.
 */
export class AssetHandler implements EntityHandler {
  /** Nothing in an asset batch reads back the audit, event or history rows it writes. */
  readonly bulkWrites = true;

  constructor(
    private readonly assets: AssetsFacade,
    private readonly custody: CustodyService,
  ) {}

  keys(rec: MappedRecord): { k1: string | null; k2: string | null } {
    const tag = typeof rec.f.asset_tag === 'string' ? normKey(rec.f.asset_tag) : '';
    const serial = typeof rec.f.serial === 'string' ? normKey(rec.f.serial) : '';
    return { k1: tag ? `tag:${tag}` : null, k2: serial ? `serial:${serial}` : null };
  }

  // ------------------------------------------------------------------------------------ step cache

  /**
   * `rehearsal` is the dry run's (ED-29): a resolver that really creates the missing references inside
   * the rehearsal savepoint (rolled back after the batch), never memoised, because its ids die with it.
   */
  private async cache(
    env: HandlerEnv,
    mode: 'dry' | 'commit' | 'rehearsal',
  ): Promise<AssetStepCache> {
    const key = `asset:${mode}`;
    const hit =
      mode === 'rehearsal' ? undefined : (env.memo.get(key) as AssetStepCache | undefined);
    if (hit) return hit;
    const defRows = await env.tx.custom_field_def.findMany({
      where: { archived_at: null },
      orderBy: [{ position: 'asc' }, { key: 'asc' }],
    });
    const statusRows = await env.tx.status_label.findMany({
      where: { archived_at: null },
      select: { id: true, name: true, state_type: true, is_default: true },
    });
    const cache: AssetStepCache = {
      resolver: new RefResolver(
        env.tx,
        env.auth,
        env.options,
        env.valueMap,
        env.refs,
        mode === 'dry' ? 'dry' : 'commit',
        undefined,
        { import_job_id: env.job.id },
      ),
      defs: defRows.map((r) => ({ ...toFieldDef(r), categoryId: r.category_id })),
      statuses: new Map(statusRows.map((s) => [s.id, s])),
      defaultStatusId: statusRows.find((s) => s.is_default)?.id ?? null,
    };
    if (mode !== 'rehearsal') env.memo.set(key, cache);
    return cache;
  }

  // ---------------------------------------------------------------------------------------- prepare

  private async prepare(
    env: HandlerEnv,
    cache: AssetStepCache,
    rec: MappedRecord,
  ): Promise<Prepared> {
    const { options } = env;
    const out: Prepared = {
      issues: [],
      warnings: [],
      create: {},
      update: {},
      pending: false,
      newCategory: false,
      assignee: null,
      statusState: null,
      categoryId: null,
    };
    const { resolver } = cache;
    const take = (res: Resolution, kind = ''): string | null | undefined => {
      switch (res.kind) {
        case 'found': {
          // made by the dry run's rehearsal: still announced, and checked with its real id
          const made = resolver.createdName(res.id);
          if (made !== undefined) {
            out.warnings.push({
              field: kind || null,
              code: 'will-create',
              message: `Will create ${kind} "${made}"`,
            });
          }
          return res.id;
        }
        case 'none':
          return null;
        case 'create':
          out.pending = true;
          out.warnings.push({
            field: kind || null,
            code: 'will-create',
            message: `Will create ${kind} "${res.name}"`,
          });
          return undefined;
        case 'error':
          out.issues.push(res.issue);
          return undefined;
      }
    };

    // category
    let categoryId: string | null | undefined;
    if (rec.r.category) {
      const res = await resolver.resolve('category', rec.r.category);
      categoryId = take(res, 'category');
      if (res.kind === 'create') out.newCategory = true;
    } else if (options.defaults.category) {
      categoryId = options.defaults.category;
    }
    out.categoryId = categoryId ?? null;
    if (categoryId) {
      out.create.category_id = categoryId;
      out.update.category_id = categoryId;
    } else if (!out.newCategory && !out.issues.some((i) => i.field === 'category')) {
      out.issues.push({
        field: 'category',
        code: 'required',
        message: 'The row has no category (map a Category column or choose a default category).',
      });
    }

    // manufacturer and model
    let manufacturerId: string | null | undefined;
    if (rec.r.manufacturer)
      manufacturerId = take(
        await resolver.resolve('manufacturer', rec.r.manufacturer),
        'manufacturer',
      );
    if (rec.r.model) {
      const scope = {
        categoryId: out.newCategory ? null : (categoryId ?? null),
        manufacturerId: manufacturerId ?? null,
      };
      const res = out.newCategory
        ? ({ kind: 'create', name: rec.r.model } as Resolution)
        : await resolver.resolve('model', rec.r.model, scope);
      const id = take(res, 'model');
      if (id) {
        out.create.model_id = id;
        out.update.model_id = id;
      }
    }

    // status
    if (rec.r.status) {
      const res = await resolver.resolve('status', rec.r.status);
      const id = take(res, 'status');
      if (id) {
        out.create.status_id = id;
        out.update.status_id = id;
        out.statusState = cache.statuses.get(id)?.state_type ?? null;
      }
    } else if (options.defaults.status) {
      out.create.status_id = options.defaults.status;
      out.statusState = cache.statuses.get(options.defaults.status)?.state_type ?? null;
    }

    // location, department, vendor
    for (const [kind, column, key] of [
      ['location', 'location_id', 'location'],
      ['department', 'department_id', 'department'],
      ['vendor', 'vendor_id', 'vendor'],
    ] as const) {
      const text = rec.r[key];
      const fallback = options.defaults[key];
      if (text) {
        const id = take(await resolver.resolve(kind, text), kind);
        if (id) {
          out.create[column] = id;
          out.update[column] = id;
        }
      } else if (fallback) out.create[column] = fallback;
    }

    // assignee
    if (rec.r.assigned_to) {
      const res = await resolver.resolve('person', rec.r.assigned_to);
      out.assignee = res;
      if (res.kind === 'error') {
        // a missing person never blocks the asset: it is created and the hand-over is reported
        out.warnings.push({
          ...res.issue,
          message: `${res.issue.message} The asset is imported without an assignee.`,
        });
        out.assignee = null;
      }
    }

    // scalars
    for (const k of [
      'asset_tag',
      'name',
      'serial',
      'purchase_date',
      'order_number',
      'warranty_end',
      'notes',
      'purchase_cost',
    ]) {
      if (rec.f[k] !== undefined) {
        out.create[k] = rec.f[k];
        if (k !== 'asset_tag') out.update[k] = rec.f[k];
      }
    }
    if (rec.f.external_id !== undefined) {
      const source = options.external_source ?? 'import';
      out.create.external_source = source;
      out.create.external_id = rec.f.external_id;
      out.update.external_source = source;
      out.update.external_id = rec.f.external_id;
    }
    // blank cells of an update with blank_cells = clear
    if (options.blank_cells === 'clear') {
      for (const target of rec.b) {
        const column = TARGET_COLUMN[target];
        if (column && column in NULLABLE_CLEAR && !(column in out.update))
          out.update[column] = null;
        if (target === 'external_id') {
          out.update.external_id = null;
          out.update.external_source = null;
        }
      }
    }

    // custom fields: the definitions of the (resolved) category plus the global ones
    const custom: Record<string, unknown> = {};
    const customClear: string[] = [];
    for (const [key, text] of Object.entries(rec.c)) {
      const def = cache.defs.find(
        (d) => d.key === key && (d.categoryId === null || d.categoryId === categoryId),
      );
      if (!def) {
        out.warnings.push({
          field: `cf:${key}`,
          code: 'ignored',
          message: `The custom field "${key}" does not apply to this category; the value is ignored.`,
        });
        continue;
      }
      const v = coerceCustom(def, text, env);
      if (!v.ok)
        out.issues.push({ field: `cf:${key}`, code: v.code, message: `${def.label} ${v.message}` });
      else custom[key] = v.value;
    }
    if (options.blank_cells === 'clear') {
      for (const target of rec.b) if (target.startsWith('cf:')) customClear.push(target.slice(3));
    }
    if (Object.keys(custom).length > 0) {
      out.create.custom_data = { ...custom };
      out.update.custom_data = {
        ...custom,
        ...Object.fromEntries(customClear.map((k) => [k, null])),
      };
    } else if (customClear.length > 0) {
      out.update.custom_data = Object.fromEntries(customClear.map((k) => [k, null]));
    }
    return out;
  }

  // ------------------------------------------------------------------------------------------ lookup

  /** One lookup for the whole commit batch (not one per row). */
  async begin(env: HandlerEnv, rows: WorkRow[]): Promise<void> {
    env.memo.set(
      'asset:existing',
      await this.existing(
        env,
        rows.map((r) => r.mapped),
      ),
    );
  }

  /** Makes an asset created by this batch visible to the later rows of the batch (a repeated tag or serial). */
  private remember(env: HandlerEnv, id: string, prep: Prepared): void {
    const found = env.memo.get('asset:existing') as Found | undefined;
    if (!found) return;
    const tag = typeof prep.create.asset_tag === 'string' ? prep.create.asset_tag : null;
    const serial = typeof prep.create.serial === 'string' ? prep.create.serial : null;
    const entry = {
      id,
      asset_tag: tag ?? '',
      asset_tag_key: tag ? normKey(tag) : null,
      serial_key: serial ? normKey(serial) : null,
      version: 1,
      archived_at: null,
      external_id: typeof prep.create.external_id === 'string' ? prep.create.external_id : null,
    };
    found.byTag.push(entry);
    found.bySerial.push(entry);
    found.byExt.push(entry);
  }

  /** The existing assets a batch of rows may be talking about, by tag, serial and external id. */
  private async existing(env: HandlerEnv, recs: MappedRecord[]) {
    const tags = new Set<string>();
    const serials = new Set<string>();
    const ext = new Set<string>();
    for (const r of recs) {
      if (typeof r.f.asset_tag === 'string') tags.add(normKey(r.f.asset_tag));
      if (typeof r.f.serial === 'string') serials.add(normKey(r.f.serial));
      if (typeof r.f.external_id === 'string') ext.add(r.f.external_id);
    }
    const select = {
      id: true,
      asset_tag: true,
      asset_tag_key: true,
      serial_key: true,
      version: true,
      archived_at: true,
      external_id: true,
    } as const;
    // M2-LOC-03 (ED-26): a scoped import only matches assets inside the caller's scope
    const inScope = await locationScopeWhere(env.tx, 'location_id');
    const [byTag, bySerial, byExt]: [ExistingAsset[], ExistingAsset[], ExistingAsset[]] =
      await Promise.all([
        tags.size
          ? env.tx.asset.findMany({
              where: { asset_tag_key: { in: [...tags] }, ...inScope },
              select,
            })
          : [],
        serials.size
          ? env.tx.asset.findMany({
              where: { serial_key: { in: [...serials] }, ...inScope },
              select,
            })
          : [],
        ext.size
          ? env.tx.asset.findMany({
              where: {
                ...inScope,
                external_source: env.options.external_source ?? 'import',
                external_id: { in: [...ext] },
              },
              select,
            })
          : [],
      ]);
    return { byTag, bySerial, byExt } as Found;
  }

  private match(
    env: HandlerEnv,
    rec: MappedRecord,
    found: Found,
  ): {
    hit: { id: string; asset_tag: string; version: number; archived_at: Date | null } | null;
    issue?: RowIssue;
  } {
    const tag = typeof rec.f.asset_tag === 'string' ? normKey(rec.f.asset_tag) : '';
    const serial = typeof rec.f.serial === 'string' ? normKey(rec.f.serial) : '';
    const ext = typeof rec.f.external_id === 'string' ? rec.f.external_id : '';
    const tagHit = tag ? (found.byTag.find((a) => a.asset_tag_key === tag) ?? null) : null;
    const serialHits = serial ? found.bySerial.filter((a) => a.serial_key === serial) : [];
    const extHit = ext ? (found.byExt.find((a) => a.external_id === ext) ?? null) : null;
    const serialAmbiguous = serialHits.length > 1;
    const ambiguous = (): RowIssue => ({
      field: 'serial',
      code: 'ambiguous',
      message: `Several assets have the serial number "${String(rec.f.serial).slice(0, 60)}". Match on the asset tag instead.`,
    });
    // Matching on the serial or the external id says "new asset" for a row whose TAG is already taken by another
    // asset: the API refuses that (duplicate), so the dry run must too, not the commit.
    const tagClash = <R extends { hit: unknown; issue?: RowIssue }>(
      r: R,
    ): R | { hit: null; issue: RowIssue } =>
      !r.hit && !r.issue && tagHit
        ? {
            hit: null,
            issue: { field: 'asset_tag', code: 'duplicate', message: 'is already in use' },
          }
        : r;
    switch (env.options.match_on) {
      case 'asset_tag':
        return { hit: tagHit };
      case 'serial':
        return tagClash(
          serialAmbiguous ? { hit: null, issue: ambiguous() } : { hit: serialHits[0] ?? null },
        );
      case 'external_id':
        return tagClash({ hit: extHit });
      default: {
        if (tagHit) {
          if (serialHits.length === 1 && serialHits[0]!.id !== tagHit.id) {
            return {
              hit: null,
              issue: {
                field: 'serial',
                code: 'conflict',
                message: `The tag "${tagHit.asset_tag}" belongs to one asset but the serial number "${String(rec.f.serial).slice(0, 60)}" to another.`,
              },
            };
          }
          return { hit: tagHit };
        }
        if (extHit) return { hit: extHit };
        if (!tag && serial)
          return serialAmbiguous
            ? { hit: null, issue: ambiguous() }
            : { hit: serialHits[0] ?? null };
        return { hit: null };
      }
    }
  }

  // --------------------------------------------------------------------------------------------- plan

  /**
   * The dry run of a batch (ED-29). The batch is rehearsed: the references it would create are created
   * for real inside a savepoint that is rolled back afterwards, so a row that needs a new category,
   * model, location or department is checked by the facade like any other row (required fields, tag and
   * serial rules, the location scope, the permission to create the reference) instead of being left to
   * the commit. Each row runs in its own savepoint, so one that breaks the transaction costs only itself.
   */
  async plan(env: HandlerEnv, rows: WorkRow[]): Promise<Verdict[]> {
    const found = await this.existing(
      env,
      rows.map((r) => r.mapped),
    );
    return rehearse(env.tx, async () => {
      const cache = await this.cache(env, 'rehearsal');
      const out: Verdict[] = [];
      for (const row of rows) {
        try {
          out.push(
            await inNamedSavepoint(env.tx, 'import_row', () =>
              this.planRow(env, cache, found, row),
            ),
          );
        } catch (err) {
          out.push({ plan: 'error', errors: issuesOf(err, assetPointer), warnings: [] });
        }
      }
      return out;
    });
  }

  private async planRow(
    env: HandlerEnv,
    cache: AssetStepCache,
    found: Found,
    row: WorkRow,
  ): Promise<Verdict> {
    const prep = await this.prepare(env, cache, row.mapped);
    const warnings = [...prep.warnings];
    const fail = (issues: RowIssue[]): Verdict => ({ plan: 'error', errors: issues, warnings });
    if (prep.issues.length > 0) return fail(prep.issues);

    const { hit, issue } = this.match(env, row.mapped, found);
    if (issue) return fail([issue]);
    const policy = env.options.on_match;

    if (hit?.archived_at) {
      return fail([
        {
          field: 'asset_tag',
          code: 'archived',
          message: `The asset ${hit.asset_tag} exists but is archived. Restore it first (an archived asset keeps its tag).`,
        },
      ]);
    }
    if (hit) {
      if (policy === 'skip') {
        warnings.push({
          field: null,
          code: 'exists',
          message: `Already exists as ${hit.asset_tag}; left unchanged.`,
        });
        return { plan: 'skip', errors: [], warnings, entityId: hit.id, entityVersion: hit.version };
      }
      if (policy === 'error')
        return fail([
          {
            field: 'asset_tag',
            code: 'exists',
            message: `An asset with this ${env.options.match_on === 'serial' ? 'serial number' : 'tag'} already exists (${hit.asset_tag}).`,
          },
        ]);
      return this.planUpdate(env, prep, hit.id, hit.version, warnings);
    }
    if (row.dup_of !== null) {
      if (policy === 'skip') {
        warnings.push({
          field: null,
          code: 'duplicate-in-file',
          message: `Same tag or serial number as row ${row.dup_of} of the file; skipped.`,
        });
        return { plan: 'skip', errors: [], warnings };
      }
      if (policy === 'error')
        return fail([
          {
            field: null,
            code: 'duplicate-in-file',
            message: `Same tag or serial number as row ${row.dup_of} of the file.`,
          },
        ]);
      warnings.push({
        field: null,
        code: 'duplicate-in-file',
        message: `Applied on top of row ${row.dup_of} (same tag or serial number).`,
      });
    }
    // create
    // a category that is about to be created has no id yet: a placeholder satisfies the shape check only
    const parsed = assetCreateSchema.safeParse(
      prep.newCategory ? { ...prep.create, category_id: PLACEHOLDER_ID } : prep.create,
    );
    if (!parsed.success) return fail(zodIssues(parsed.error.issues, assetPointer));
    if (prep.pending) {
      // only without the rehearsal (a reference announced, not created): checked when committed
      warnings.push({
        field: null,
        code: 'validated-at-commit',
        message: 'Checked when the import runs (a record it needs is created on the way).',
      });
    } else {
      try {
        await this.assets.createInTx(env.tx, env.auth, parsed.data as AssetCreate, undefined, '', {
          dryRun: true,
        });
      } catch (err) {
        return fail(issuesOf(err, assetPointer));
      }
    }
    this.assignWarnings(prep, warnings);
    return { plan: row.dup_of !== null ? 'update' : 'create', errors: [], warnings };
  }

  private async planUpdate(
    env: HandlerEnv,
    prep: Prepared,
    id: string,
    version: number,
    warnings: RowIssue[],
  ): Promise<Verdict> {
    const current = await loadAsset(env.tx, id);
    if (!current)
      return {
        plan: 'error',
        errors: [{ field: null, code: 'not-found', message: 'The asset no longer exists.' }],
        warnings,
      };
    const parsed = assetUpdateSchema.safeParse(this.forCustody(prep.update, current, warnings));
    if (!parsed.success)
      return { plan: 'error', errors: zodIssues(parsed.error.issues, assetPointer), warnings };
    let changed: string[];
    try {
      const res = await this.assets.updateInTx(
        env.tx,
        env.auth,
        current,
        parsed.data as AssetUpdate,
        undefined,
        { dryRun: true },
      );
      changed = res.changed ?? [];
    } catch (err) {
      return { plan: 'error', errors: issuesOf(err, assetPointer), warnings };
    }
    const handover = prep.assignee?.kind === 'found' && !current.assignment;
    if (changed.length === 0 && !handover) {
      warnings.push({
        field: null,
        code: 'unchanged',
        message: 'Nothing to change; left as it is.',
      });
      return { plan: 'skip', errors: [], warnings, entityId: id, entityVersion: version };
    }
    return { plan: 'update', errors: [], warnings, entityId: id, entityVersion: version };
  }

  /**
   * The custody of an asset owns its status: while it is checked out, the status of the file (which says
   * "Active", "Provisioned"...) is not applied, so a re-import never un-deploys a device somebody holds.
   */
  private forCustody(
    update: Record<string, unknown>,
    current: AssetRow,
    warnings: RowIssue[],
  ): Record<string, unknown> {
    if (!current.assignment || update.status_id === undefined) return update;
    const { status_id: wanted, ...rest } = update;
    if (wanted !== current.status_id && !warnings.some((w) => w.code === 'status-kept')) {
      warnings.push({
        field: 'status',
        code: 'status-kept',
        message: 'The asset is checked out: its status is left as it is.',
      });
    }
    return rest;
  }

  private assignWarnings(prep: Prepared, warnings: RowIssue[]): void {
    if (
      prep.assignee &&
      prep.statusState &&
      prep.statusState !== 'deployable' &&
      prep.statusState !== 'deployed'
    ) {
      warnings.push({
        field: 'status',
        code: 'not-assigned',
        message: 'The asset will not be checked out: its status is not a deployable one.',
      });
    }
  }

  // -------------------------------------------------------------------------------------------- apply

  async apply(env: HandlerEnv, row: WorkRow): Promise<Outcome> {
    const cache = await this.cache(env, 'commit');
    const prep = await this.prepare(env, cache, row.mapped);
    const warnings = [...prep.warnings];
    if (prep.issues.length > 0) return { result: 'error', errors: prep.issues, warnings };

    // the batch's lookups were made once (`begin`); assets created by earlier rows of the batch are added below
    const found =
      (env.memo.get('asset:existing') as Found | undefined) ??
      (await this.existing(env, [row.mapped]));
    const { hit, issue } = this.match(env, row.mapped, found);
    if (issue) return { result: 'error', errors: [issue], warnings };
    const policy = env.options.on_match;
    const meta = { import_job_id: env.job.id, import_row: row.row_no };

    if (hit?.archived_at) {
      return {
        result: 'error',
        errors: [
          {
            field: 'asset_tag',
            code: 'archived',
            message: `The asset ${hit.asset_tag} exists but is archived. Restore it first.`,
          },
        ],
        warnings,
      };
    }
    if (hit && row.plan === 'create' && row.dup_of === null) {
      warnings.push({
        field: null,
        code: 'appeared',
        message: `Created by someone else since the dry run (${hit.asset_tag}).`,
      });
    }
    if (hit) {
      if (policy === 'skip')
        return {
          result: 'skipped',
          errors: [],
          warnings: [
            ...warnings,
            {
              field: null,
              code: 'exists',
              message: `Already exists as ${hit.asset_tag}; left unchanged.`,
            },
          ],
          entityId: hit.id,
        };
      if (policy === 'error')
        return {
          result: 'error',
          errors: [
            {
              field: 'asset_tag',
              code: 'exists',
              message: `An asset with this tag or serial number already exists (${hit.asset_tag}).`,
            },
          ],
          warnings,
        };
      return this.applyUpdate(env, prep, row, hit.id, meta, warnings);
    }
    if (row.plan === 'update' && row.dup_of === null && row.entity_id) {
      warnings.push({
        field: null,
        code: 'recreated',
        message: 'The asset to update is gone; a new one was created.',
      });
    }
    return this.applyCreate(env, cache, prep, row, meta, warnings);
  }

  private async applyCreate(
    env: HandlerEnv,
    cache: AssetStepCache,
    prep: Prepared,
    row: WorkRow,
    meta: Record<string, unknown>,
    warnings: RowIssue[],
  ): Promise<Outcome> {
    const wantsAssign = env.options.assign && prep.assignee?.kind === 'found';
    const body = { ...prep.create };
    if (wantsAssign && prep.statusState === 'deployed') {
      // a deployed label cannot be checked out: create in the default (deployable) status, check-out deploys it
      if (cache.defaultStatusId) body.status_id = cache.defaultStatusId;
    }
    const parsed = assetCreateSchema.safeParse(body);
    if (!parsed.success)
      return { result: 'error', errors: zodIssues(parsed.error.issues, assetPointer), warnings };
    try {
      const created = await this.assets.createInTx(
        env.tx,
        env.auth,
        parsed.data as AssetCreate,
        meta,
      );
      const id = created.asset.id;
      this.remember(env, id, prep);
      if (wantsAssign) await this.checkout(env, id, (prep.assignee as { id: string }).id, warnings);
      return { result: 'created', errors: [], createdId: id, warnings };
    } catch (err) {
      return { result: 'error', errors: issuesOf(err, assetPointer), warnings };
    }
  }

  private async applyUpdate(
    env: HandlerEnv,
    prep: Prepared,
    row: WorkRow,
    id: string,
    meta: Record<string, unknown>,
    warnings: RowIssue[],
  ): Promise<Outcome> {
    const current = await loadAsset(env.tx, id);
    if (!current)
      return {
        result: 'error',
        errors: [{ field: null, code: 'not-found', message: 'The asset no longer exists.' }],
        warnings,
      };
    if (
      env.options.detect_changes &&
      row.entity_version !== null &&
      row.dup_of === null &&
      row.entity_id === id &&
      current.version !== row.entity_version
    ) {
      return {
        result: 'error',
        errors: [
          {
            field: null,
            code: 'changed-since-dry-run',
            message: `${current.asset_tag} was edited after the dry run (version ${row.entity_version} -> ${current.version}); it was not touched. Run the dry run again.`,
          },
        ],
        warnings,
      };
    }
    const parsed = assetUpdateSchema.safeParse(this.forCustody(prep.update, current, warnings));
    if (!parsed.success)
      return { result: 'error', errors: zodIssues(parsed.error.issues, assetPointer), warnings };
    const body = parsed.data as AssetUpdate;
    try {
      const before = beforeImage(current, body as Record<string, unknown>);
      const res = await this.assets.updateInTx(env.tx, env.auth, current, body, meta);
      const changed = res.version !== current.version;
      let handedOver = false;
      if (env.options.assign && prep.assignee?.kind === 'found' && !current.assignment) {
        handedOver = await this.checkout(env, id, prep.assignee.id, warnings);
      }
      if (!changed && !handedOver)
        return {
          result: 'skipped',
          errors: [],
          warnings: [
            ...warnings,
            { field: null, code: 'unchanged', message: 'Nothing to change; left as it is.' },
          ],
          entityId: id,
        };
      return { result: 'updated', errors: [], entityId: id, before, warnings };
    } catch (err) {
      return { result: 'error', errors: issuesOf(err, assetPointer), warnings };
    }
  }

  /** Checks the asset out to a person; a refusal is a warning (the asset stays, unassigned). */
  private async checkout(
    env: HandlerEnv,
    assetId: string,
    personId: string,
    warnings: RowIssue[],
  ): Promise<boolean> {
    try {
      await inNamedSavepoint(env.tx, 'import_inner', () =>
        this.custody.checkout(env.auth, assetId, { kind: 'any' }, { person_id: personId } as never),
      );
      return true;
    } catch (err) {
      const [first] = issuesOf(err, assetPointer);
      warnings.push({
        field: 'assigned_to',
        code: 'not-assigned',
        message: `Imported, but not checked out: ${first?.message ?? 'refused'}`,
      });
      return false;
    }
  }
}

/** The values an update replaces, for undo (v1.1): only the keys the update body names. */
function beforeImage(current: AssetRow, body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(body)) {
    switch (key) {
      case 'purchase_cost':
        out.purchase_cost =
          current.purchase_cost_minor === null
            ? null
            : { amount_minor: Number(current.purchase_cost_minor), currency: current.currency };
        break;
      case 'purchase_date':
        out.purchase_date = day(current.purchase_date);
        break;
      case 'warranty_end':
        out.warranty_end = day(current.warranty_end);
        break;
      case 'custom_data': {
        const custom: Record<string, unknown> = {};
        for (const k of Object.keys(body.custom_data as Record<string, unknown>))
          custom[k] = current.custom_data[k] ?? null;
        out.custom_data = custom;
        break;
      }
      default:
        out[key] = (current as unknown as Record<string, unknown>)[key] ?? null;
    }
  }
  return out;
}

type CustomResult = { ok: true; value: unknown } | { ok: false; message: string; code: string };

/** A custom field's cell as the value the facade's validator expects (it does the final checks). */
export function coerceCustom(
  def: FieldDef,
  text: string,
  env: Pick<HandlerEnv, 'options'>,
): CustomResult {
  const bad = (message: string, code = 'invalid'): CustomResult => ({ ok: false, message, code });
  switch (def.dataType) {
    case 'number': {
      const n = parseNumber(text, env.options.number_format);
      return n.ok ? { ok: true, value: n.value } : bad(n.message, n.code);
    }
    case 'boolean': {
      const b = parseBoolean(text);
      return b.ok ? { ok: true, value: b.value } : bad(b.message, b.code);
    }
    case 'date': {
      const d = parseDate(text, env.options.date_format);
      return d.ok ? { ok: true, value: d.value } : bad(d.message, d.code);
    }
    case 'select': {
      const hit = def.options?.find(
        (o) =>
          normKey(o.value) === normKey(text) ||
          (o.label !== undefined && normKey(o.label) === normKey(text)),
      );
      return { ok: true, value: hit ? hit.value : text };
    }
    case 'multiselect': {
      const parts = text
        .split(/[|;,]/)
        .map((p) => p.trim())
        .filter(Boolean);
      return {
        ok: true,
        value: parts.map(
          (p) =>
            def.options?.find(
              (o) =>
                normKey(o.value) === normKey(p) ||
                (o.label !== undefined && normKey(o.label) === normKey(p)),
            )?.value ?? p,
        ),
      };
    }
    default:
      return { ok: true, value: text };
  }
}
