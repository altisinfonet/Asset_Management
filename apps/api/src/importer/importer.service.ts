import { Inject, Injectable } from '@nestjs/common';
import { type AuthContext, locationScopeFor, permits } from '../auth/index.js';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { uuidv7 } from '../ids/uuidv7.js';
import {
  ApiProblem,
  type FieldError,
  type IfMatch,
  type ListSpec,
  type Page,
  assertIfMatch,
  listPage,
  problem,
} from '../platform/index.js';
import {
  AUDIT_WRITER,
  JOB_QUEUE,
  OUTBOX_PUBLISHER,
  type AuditWriter,
  type JobQueue,
  type OutboxPublisher,
} from '../ports/index.js';
import { CategoriesService, CustomFieldsService, RegistryBase } from '../registry/index.js';
import {
  Prisma,
  TenancyService,
  currentLocationScope,
  intersectLocationScopes,
  isLocationScoped,
  locationScopeWhere,
  type Tx,
} from '../tenancy/index.js';
import { jobAuth } from './handlers/shared.js';
import { IMPORT_ANALYZE_JOB, IMPORT_STEP_JOB } from './engine.js';
import { ImportEngine } from './engine.js';
import { FileFormatError } from './csv-reader.js';
import { type CustomTarget, type EntityType, type RefKind, specOf } from './fields.js';
import { RefResolver, type Resolution, createsLocations, locationTextsOf } from './refs.js';
import { formatOf } from './reader.js';
import { GOOGLE_CHROMEBOOK_CATEGORY, PRESETS, type Preset, presetOf } from './presets.js';
import type {
  ImportAnalyze,
  ImportCommit,
  ImportCreate,
  ImportListQuery,
  ImportRowsQuery,
  ImportUpdate,
  ImportValuesQuery,
} from './schemas.js';
import {
  type ImportOptions,
  type ImportState,
  type JobRow,
  type RowIssue,
  type ValueMap,
  RUNNING_STATES,
  optionsSchema,
} from './types.js';
import { normKey } from './values.js';
import { RefServicesToken } from './tokens.js';
import type { RefServices } from './refs.js';

type JobRecord = NonNullable<Awaited<ReturnType<Tx['import_job']['findUnique']>>>;

/** Stands for a category the import creates when the value step checks a model (ED-37): it has no models. */
const NEW_CATEGORY = '00000000-0000-4000-8000-000000000000';

const SPEC: ListSpec = { sortable: { created_at: { kind: 'date' } }, defaultSort: '-created_at' };

/** Permission an import of each entity type needs on top of `import:run`. */
const WRITE_PERMISSION: Record<EntityType, string> = {
  asset: 'asset:create',
  person: 'person:manage',
  location: 'location:manage',
  department: 'department:manage',
};
/** What creating missing references needs. */
const CREATE_PERMISSION: Partial<Record<RefKind, string>> = {
  category: 'catalog:manage',
  manufacturer: 'catalog:manage',
  model: 'catalog:manage',
  vendor: 'catalog:manage',
  department: 'department:manage',
  location: 'location:manage',
  person: 'person:manage',
};
/** Reference kinds each entity type resolves (the kinds whose policy matters). */
const ENTITY_REFS: Record<EntityType, RefKind[]> = {
  asset: ['category', 'manufacturer', 'model', 'location', 'department', 'vendor', 'person'],
  person: ['department', 'location'],
  location: ['location'],
  department: ['person'],
};
/** The mapping target a reference kind is read from, per entity type. */
const REF_TARGET: Record<EntityType, Partial<Record<RefKind, string>>> = {
  asset: {
    category: 'category',
    manufacturer: 'manufacturer',
    model: 'model',
    status: 'status',
    location: 'location',
    department: 'department',
    vendor: 'vendor',
    person: 'assigned_to',
  },
  person: { department: 'department', location: 'location' },
  location: { location: 'parent_path' },
  department: { person: 'manager' },
};

const policyOf = (options: ImportOptions, kind: RefKind): 'create' | 'must_exist' =>
  options.references[kind] ?? (kind === 'status' || kind === 'person' ? 'must_exist' : 'create');

/** The number of rows of a phase as a share of the file. */
function progressOf(job: JobRecord): {
  phase: string | null;
  processed: number;
  total: number;
  percent: number;
} {
  const phase =
    job.state === 'analyzing'
      ? 'analyze'
      : job.state === 'dry_running'
        ? 'dry_run'
        : job.state === 'committing'
          ? 'commit'
          : null;
  const total = job.rows_total;
  const processed =
    phase === 'analyze'
      ? 0
      : phase
        ? job.rows_processed
        : job.state === 'completed' || job.state === 'dry_run_done'
          ? total
          : 0;
  return {
    phase,
    processed,
    total,
    percent:
      total > 0
        ? Math.min(100, Math.round((processed / total) * 100))
        : phase
          ? 0
          : job.state === 'completed'
            ? 100
            : 0,
  };
}

/** Schema `ImportJob`; the heavy members (profile, samples, value map) only when `full`. */
export function importDto(r: JobRecord, full: boolean, content = true): Record<string, unknown> {
  const parse = (r.parse ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    entity_type: r.entity_type,
    source: r.source,
    preset_key: r.preset_key,
    state: r.state,
    filename: r.filename,
    file_attachment_id: r.file_attachment_id,
    parse: {
      format: parse.format ?? null,
      encoding: parse.encoding ?? null,
      delimiter: parse.delimiter ?? null,
      sheet: parse.sheet ?? null,
      sheets: parse.sheets ?? null,
      header_line: parse.header_line ?? null,
    },
    headers: r.headers ?? null,
    mapping: r.mapping,
    options: r.options,
    rows_total: r.rows_total,
    counts: {
      dry_run: {
        create: r.plan_create,
        update: r.plan_update,
        skip: r.plan_skip,
        error: r.plan_error,
      },
      commit: {
        created: r.done_create,
        updated: r.done_update,
        skipped: r.done_skip,
        error: r.done_error,
      },
    },
    progress: progressOf(r),
    dry_run_digest: r.dry_run_digest,
    dry_run_at: r.dry_run_at ? r.dry_run_at.toISOString() : null,
    committed_at: r.committed_at ? r.committed_at.toISOString() : null,
    started_at: r.started_at ? r.started_at.toISOString() : null,
    finished_at: r.finished_at ? r.finished_at.toISOString() : null,
    data_purged_at: r.data_purged_at ? r.data_purged_at.toISOString() : null,
    cancel_requested: r.cancel_requested,
    error: r.error,
    summary: r.summary ?? null,
    requested_by: r.requested_by,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    ...(full
      ? {
          // The file's own cells (sample rows, sample values, the source values of the value map) go to
          // whoever may run imports; `import:read` sees the shape of the file and the counts (ED-19).
          profile: content
            ? (r.profile ?? null)
            : ((r.profile as Array<Record<string, unknown>> | null)?.map((c) => ({
                ...c,
                samples: [],
              })) ?? null),
          samples: content ? (r.samples ?? null) : null,
          confidence: parse.confidence ?? null,
          value_map: content ? r.value_map : {},
        }
      : {}),
  };
}

/**
 * The import job endpoints (M2-IMP-01..05). The service only moves the state machine and checks what the
 * caller may do; every long piece of work is a worker job (`import.analyze`, `import.step`, ids only) queued
 * in the SAME transaction as the state change, so the job and its queue entry are never out of step.
 */
@Injectable()
export class ImportsService extends RegistryBase {
  constructor(
    tenancy: TenancyService,
    @Inject(AUDIT_WRITER) audit: AuditWriter,
    @Inject(OUTBOX_PUBLISHER) outbox: OutboxPublisher,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly engine: ImportEngine,
    private readonly categories: CategoriesService,
    private readonly customFields: CustomFieldsService,
    @Inject(RefServicesToken) private readonly refServices: RefServices,
  ) {
    super(tenancy, audit, outbox);
  }

  // ------------------------------------------------------------------------------------- helpers

  private async lock(trx: Tx, id: string, auth: AuthContext): Promise<JobRecord> {
    const rows = await trx.$queryRaw<
      Array<{ id: string; requested_by: string }>
    >`select id, requested_by from app.import_job where id = ${id}::uuid for update`;
    if (rows.length === 0 || !this.mayOpen(auth, rows[0]!.requested_by)) {
      throw problem.notFound('Import not found.');
    }
    return (await trx.import_job.findUnique({ where: { id } }))!;
  }

  /**
   * M2-LOC-03 (ED-26): an import holds file content of whatever locations it touches, so a
   * location-scoped principal sees and works on only the imports it started itself.
   */
  private mine(auth: AuthContext): { requested_by?: string } {
    return isLocationScoped() ? { requested_by: auth.userId } : {};
  }

  private mayOpen(auth: AuthContext, requestedBy: string): boolean {
    return !isLocationScoped() || requestedBy === auth.userId;
  }

  /**
   * The location scope a dry run / commit carries to the worker (ED-26): the import:run scope of the
   * request narrowed to the scopes of the write permissions the import uses (custom role bundles
   * can scope them differently).
   */
  private async scopeColumns(trx: Tx, auth: AuthContext, job: JobRecord) {
    let scope: readonly string[] | null = currentLocationScope();
    const entity = job.entity_type as EntityType;
    const needs = [WRITE_PERMISSION[entity]];
    if (entity === 'asset' && this.options(job).on_match === 'update') needs.push('asset:update');
    for (const permission of needs) {
      scope = await intersectLocationScopes(trx, scope, locationScopeFor(auth.grants, permission));
    }
    return { location_scoped: scope !== null, location_scope: scope ? [...scope] : [] };
  }

  private wrongState(
    job: { state: string },
    doing: string,
    allowed: readonly string[],
  ): ApiProblem {
    return new ApiProblem({
      code: 'import-wrong-state',
      detail: `The import is "${job.state}"; ${doing} is only possible when it is ${allowed.map((s) => `"${s}"`).join(', ')}.`,
      extensions: { state: job.state, allowed },
    });
  }

  /** Imports that are being worked on right now; the tenant may run only a few at once. */
  private async assertCapacity(trx: Tx, exceptId: string): Promise<void> {
    const running = await trx.import_job.count({
      where: { state: { in: [...RUNNING_STATES] }, id: { not: exceptId } },
    });
    if (running >= this.config.IMPORT_MAX_CONCURRENT) {
      throw new ApiProblem({
        code: 'import-quota-exceeded',
        detail: `${running} imports are running already (at most ${this.config.IMPORT_MAX_CONCURRENT} at once). Wait for one to finish.`,
        headers: { 'Retry-After': '30' },
      });
    }
  }

  private options(job: Pick<JobRecord, 'options'>): ImportOptions {
    return optionsSchema.parse(job.options ?? {});
  }

  /** What the caller needs to hold to run (dry run, commit) this import: the entity's write permission and creation of references. */
  private assertMayRun(auth: AuthContext, job: JobRecord): void {
    const options = this.options(job);
    const entity = job.entity_type as EntityType;
    const need = new Set<string>([WRITE_PERMISSION[entity]]);
    if (entity === 'asset' && options.on_match === 'update') need.add('asset:update');
    if (options.on_match === 'update' && entity !== 'asset') need.add(WRITE_PERMISSION[entity]);
    const targets = new Set(
      ((job.mapping as { columns?: Array<{ target: string | null }> }).columns ?? []).map(
        (c) => c.target,
      ),
    );
    const consts = Object.keys(
      (job.mapping as { constants?: Record<string, string> }).constants ?? {},
    );
    for (const kind of ENTITY_REFS[entity]) {
      const target = REF_TARGET[entity][kind];
      const used =
        target !== undefined &&
        (targets.has(target) ||
          consts.includes(target) ||
          (options.defaults as Record<string, unknown>)[kind] !== undefined);
      if (!used || policyOf(options, kind) !== 'create') continue;
      const perm = CREATE_PERMISSION[kind];
      if (perm) need.add(perm);
    }
    if (entity === 'asset' && options.assign && targets.has('assigned_to'))
      need.add('asset:checkout');
    const missing = [...need].filter((p) => !permits(auth.permissions, p));
    if (missing.length > 0) {
      throw problem.forbidden(
        `This import needs the permission${missing.length > 1 ? 's' : ''} ${missing.join(', ')} as well as import:run. Ask an administrator, or set the references that need creating to "must_exist".`,
      );
    }
  }

  private async customTargets(trx: Tx): Promise<CustomTarget[]> {
    const rows = await trx.custom_field_def.findMany({
      where: { archived_at: null },
      select: { key: true, label: true, data_type: true, category_id: true },
    });
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      dataType: r.data_type,
      categoryId: r.category_id,
    }));
  }

  // -------------------------------------------------------------------------------------- create

  async create(auth: AuthContext, body: ImportCreate): Promise<Record<string, unknown>> {
    const preset = body.preset_key ? presetOf(body.preset_key) : undefined;
    if (body.preset_key && (!preset || preset.entity_type !== body.entity_type)) {
      throw problem.validation([
        {
          pointer: '/preset_key',
          message: `No preset "${body.preset_key}" for ${body.entity_type} imports. See GET /v1/imports/presets.`,
          code: 'not-found',
        },
      ]);
    }
    if (!permits(auth.permissions, WRITE_PERMISSION[body.entity_type])) {
      throw problem.forbidden(
        `Importing ${body.entity_type === 'asset' ? 'assets' : body.entity_type === 'person' ? 'people' : `${body.entity_type}s`} needs the ${WRITE_PERMISSION[body.entity_type]} permission as well as import:run.`,
      );
    }
    const options = optionsSchema.parse({ ...(preset?.options ?? {}), ...(body.options ?? {}) });
    return this.tx(auth, async (trx) => {
      const setup = preset?.setup ? await this.ensureSetup(trx, auth, preset) : null;
      const id = uuidv7();
      const row = await trx.import_job.create({
        data: {
          id,
          tenant_id: auth.tenantId,
          requested_by: auth.userId,
          created_by: auth.userId,
          source: preset?.source ?? 'csv',
          entity_type: body.entity_type,
          preset_key: preset?.key ?? null,
          state: 'draft',
          options: options as never,
          summary: setup ? ({ setup } as never) : undefined,
        },
      });
      await this.record(trx, {
        entity: 'import_job',
        verb: 'created',
        id,
        version: row.version,
        before: null,
        after: {
          entity_type: row.entity_type,
          preset_key: row.preset_key,
          ...(setup ? { setup } : {}),
        },
        meta: { import_job_id: id },
        refs: { requestedBy: auth.userId },
      });
      return importDto(row, true);
    });
  }

  /** Makes sure the category and custom fields a preset needs exist (an explicit act: creating the import). */
  private async ensureSetup(
    trx: Tx,
    auth: AuthContext,
    preset: Preset,
  ): Promise<{ category_created: boolean; custom_fields_created: string[] }> {
    const setup = preset.setup!;
    let category = await trx.$queryRaw<
      Array<{ id: string }>
    >`select id from app.category where kind = 'asset' and archived_at is null and lower(btrim(name)) = ${normKey(setup.category)} limit 1`;
    const existingFields = category[0]
      ? await trx.custom_field_def.findMany({
          where: { category_id: category[0].id, archived_at: null },
          select: { key: true },
        })
      : [];
    const haveKeys = new Set(existingFields.map((f) => f.key));
    const missingFields = setup.customFields.filter((f) => !haveKeys.has(f.key));
    if (
      (!category[0] || missingFields.length > 0) &&
      !permits(auth.permissions, 'catalog:manage')
    ) {
      throw problem.forbidden(
        `The ${setup.category} category and its custom fields do not exist yet; creating them needs the catalog:manage permission.`,
      );
    }
    let categoryId = category[0]?.id;
    let created = false;
    if (!categoryId) {
      const res = await this.categories.create(auth, {
        name: setup.category,
        kind: 'asset',
      } as never);
      categoryId = res.data.id as string;
      created = true;
      category = [{ id: categoryId }];
    }
    const createdFields: string[] = [];
    for (const f of missingFields) {
      await this.customFields.create(auth, {
        category_id: categoryId,
        key: f.key,
        label: f.label,
        data_type: f.data_type,
        ...(f.help ? { help_text: f.help } : {}),
        show_in_list: false,
      } as never);
      createdFields.push(f.key);
    }
    return { category_created: created, custom_fields_created: createdFields };
  }

  // ---------------------------------------------------------------------------------------- reads

  async list(auth: AuthContext, query: ImportListQuery): Promise<Page<Record<string, unknown>>> {
    return this.tx(auth, async (trx) => {
      const filter = {
        ...this.mine(auth),
        ...(query.state?.length ? { state: { in: query.state } } : {}),
        ...(query.entity_type ? { entity_type: query.entity_type } : {}),
      };
      const page = await listPage({
        query: {
          limit: query.limit,
          include_total: false,
          ...(query.cursor ? { cursor: query.cursor } : {}),
        },
        spec: SPEC,
        filters: { state: query.state, entity_type: query.entity_type },
        fetch: ({ take, orderBy, where }) =>
          trx.import_job.findMany({
            where: where ? { AND: [filter, where] } : filter,
            orderBy,
            take,
          }) as unknown as Promise<Array<JobRecord & Record<string, unknown>>>,
      });
      return { data: page.data.map((r) => importDto(r, false)), page: page.page };
    });
  }

  async get(
    auth: AuthContext,
    id: string,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const row = await trx.import_job.findFirst({ where: { id, ...this.mine(auth) } });
      if (!row) throw problem.notFound('Import not found.');
      return {
        data: importDto(row, true, permits(auth.permissions, 'import:run')),
        version: row.version,
      };
    });
  }

  // --------------------------------------------------------------------------------------- update

  async update(
    auth: AuthContext,
    id: string,
    ifMatch: IfMatch,
    body: ImportUpdate,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const job = await this.lock(trx, id, auth);
      assertIfMatch(ifMatch, job.version);
      const editable: ImportState[] = ['draft', 'uploaded', 'analyzed', 'mapped', 'dry_run_done'];
      if (!editable.includes(job.state as ImportState))
        throw this.wrongState(job, 'editing the mapping or options', editable);
      const errors: FieldError[] = [];
      let options = this.options(job);
      if (body.options) {
        const o = body.options;
        options = optionsSchema.parse({
          ...options,
          ...o,
          references: { ...options.references, ...(o.references ?? {}) },
          defaults: { ...options.defaults, ...(o.defaults ?? {}) },
        });
        await this.checkDefaults(trx, options, errors);
      }
      let mapping = job.mapping as Record<string, unknown>;
      if (body.mapping) {
        const issues = await this.engine.mappingIssues(trx, {
          entity_type: job.entity_type as EntityType,
          mapping: body.mapping,
          options,
          headers: job.headers as string[] | null,
        });
        for (const i of issues.filter((x) => x.code !== 'required'))
          errors.push({ pointer: '/mapping/columns', message: i.message, code: i.code });
        mapping = body.mapping as Record<string, unknown>;
      }
      if (errors.length > 0) throw problem.validation(errors);
      const valueMap = body.value_map
        ? { ...(job.value_map as object), ...body.value_map }
        : job.value_map;
      const next: ImportState =
        job.state === 'draft' || job.state === 'uploaded' ? (job.state as ImportState) : 'mapped';
      const row = await trx.import_job.update({
        where: { id },
        data: {
          mapping: mapping as never,
          options: options as never,
          value_map: valueMap as never,
          state: next,
          // any change invalidates the reviewed dry run
          dry_run_digest: null,
          dry_run_at: null,
          plan_create: 0,
          plan_update: 0,
          plan_skip: 0,
          plan_error: 0,
          cursor_row: 0,
          rows_processed: 0,
        },
      });
      await this.record(trx, {
        entity: 'import_job',
        verb: 'updated',
        id,
        version: row.version,
        before: { state: job.state },
        after: {
          state: row.state,
          mapping: body.mapping ? 'changed' : undefined,
          options: body.options ? 'changed' : undefined,
          value_map: body.value_map ? 'changed' : undefined,
        },
        meta: { import_job_id: id },
      });
      return { data: importDto(row, true), version: row.version };
    });
  }

  private async checkDefaults(
    trx: Tx,
    options: ImportOptions,
    errors: FieldError[],
  ): Promise<void> {
    const d = options.defaults;
    const check = async (key: keyof typeof d, exists: () => Promise<unknown>, label: string) => {
      if (d[key] && !(await exists()))
        errors.push({
          pointer: `/options/defaults/${key}`,
          message: `No such ${label}.`,
          code: 'not-found',
        });
    };
    await check(
      'category',
      () =>
        trx.category.findFirst({ where: { id: d.category!, kind: 'asset', archived_at: null } }),
      'asset category',
    );
    await check(
      'status',
      () => trx.status_label.findFirst({ where: { id: d.status!, archived_at: null } }),
      'status label',
    );
    await check(
      'location',
      // M2-LOC-03 (ED-26): outside the caller's scope is the same as unknown
      async () =>
        trx.location.findFirst({
          // AND, not a spread: the scope filter is on `id` too and must not replace the id match
          where: {
            AND: [{ id: d.location!, archived_at: null }, await locationScopeWhere(trx, 'id')],
          },
        }),
      'location',
    );
    await check(
      'department',
      () => trx.department.findFirst({ where: { id: d.department!, archived_at: null } }),
      'department',
    );
    await check(
      'vendor',
      () => trx.vendor.findFirst({ where: { id: d.vendor!, archived_at: null } }),
      'vendor',
    );
  }

  // --------------------------------------------------------------------------------------- analyze

  async analyze(
    auth: AuthContext,
    id: string,
    body: ImportAnalyze,
  ): Promise<Record<string, unknown>> {
    return this.tx(auth, async (trx) => {
      const job = await this.lock(trx, id, auth);
      const allowed: ImportState[] = [
        'draft',
        'uploaded',
        'analyzed',
        'mapped',
        'dry_run_done',
        'failed',
      ];
      if (
        !allowed.includes(job.state as ImportState) ||
        (job.state === 'failed' && job.committed_at)
      )
        throw this.wrongState(job, 'analysing the file', allowed);
      const attachmentId = body.file_attachment_id ?? job.file_attachment_id;
      if (!attachmentId) {
        throw problem.validation([
          {
            pointer: '/file_attachment_id',
            message:
              'Upload the file first (POST /v1/attachments with entity_type "import_job" and kind "import_file") and name it here.',
            code: 'required',
          },
        ]);
      }
      const att = await trx.attachment.findFirst({
        where: { id: attachmentId, archived_at: null },
      });
      const bad = (message: string): never => {
        throw problem.validation([{ pointer: '/file_attachment_id', message, code: 'invalid' }]);
      };
      if (
        !att ||
        att.entity_type !== 'import_job' ||
        att.entity_id !== id ||
        att.kind !== 'import_file'
      )
        bad(
          'No such import file: it must be an attachment of kind "import_file" owned by this import.',
        );
      if (!att!.uploaded_at)
        bad('The upload has not been completed yet (POST /v1/attachments/{id}/complete).');
      if (att!.scan_status === 'infected' || att!.scan_status === 'error')
        bad('This file was rejected by the upload checks.');
      let format: 'csv' | 'xlsx';
      try {
        format = formatOf(att!.filename);
      } catch (err) {
        if (err instanceof FileFormatError) bad(err.message);
        throw err;
      }
      await this.assertCapacity(trx, id);
      const parse = {
        ...((body.file_attachment_id && body.file_attachment_id !== job.file_attachment_id
          ? {}
          : (job.parse as object)) as object),
        ...(body.parse ?? {}),
      };
      const row = await trx.import_job.update({
        where: { id },
        data: {
          state: 'analyzing',
          file_attachment_id: att!.id,
          filename: att!.filename,
          source: job.source === 'google_admin_csv' ? job.source : format,
          parse: parse as never,
          error: null,
          started_at: new Date(),
          finished_at: null,
          cancel_requested: false,
          dry_run_digest: null,
          dry_run_at: null,
        },
      });
      await this.jobs.enqueue(
        IMPORT_ANALYZE_JOB,
        { tenantId: auth.tenantId, importId: id },
        { tx: trx },
      );
      await this.record(trx, {
        entity: 'import_job',
        verb: 'analysis_requested',
        id,
        version: row.version,
        meta: { import_job_id: id, filename: att!.filename, size_bytes: Number(att!.size_bytes) },
      });
      return importDto(row, true);
    });
  }

  // --------------------------------------------------------------------------------------- dry run

  async dryRun(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    return this.tx(auth, async (trx) => {
      const job = await this.lock(trx, id, auth);
      const allowed: ImportState[] = ['analyzed', 'mapped', 'dry_run_done'];
      if (!allowed.includes(job.state as ImportState))
        throw this.wrongState(job, 'a dry run', allowed);
      const issues = await this.engine.mappingIssues(trx, {
        entity_type: job.entity_type as EntityType,
        mapping: job.mapping as never,
        options: job.options as never,
        headers: job.headers as string[] | null,
      });
      if (issues.length > 0) {
        throw problem.validation(
          issues.map((i): FieldError => ({
            pointer: '/mapping',
            message: i.message,
            code: i.code,
          })),
        );
      }
      this.assertMayRun(auth, job);
      await this.assertCapacity(trx, id);
      const row = await trx.import_job.update({
        where: { id },
        data: {
          state: 'dry_running',
          ...(await this.scopeColumns(trx, auth, job)),
          cursor_row: 0,
          rows_processed: 0,
          plan_create: 0,
          plan_update: 0,
          plan_skip: 0,
          plan_error: 0,
          done_create: 0,
          done_update: 0,
          done_skip: 0,
          done_error: 0,
          dry_run_digest: null,
          dry_run_at: null,
          started_at: new Date(),
          finished_at: null,
          cancel_requested: false,
          error: null,
        },
      });
      await this.jobs.enqueue(
        IMPORT_STEP_JOB,
        { tenantId: auth.tenantId, importId: id },
        { tx: trx },
      );
      await this.record(trx, {
        entity: 'import_job',
        verb: 'dry_run_requested',
        id,
        version: row.version,
        meta: { import_job_id: id, rows: row.rows_total },
      });
      return importDto(row, true);
    });
  }

  // ----------------------------------------------------------------------------------------- commit

  async commit(
    auth: AuthContext,
    id: string,
    body: ImportCommit,
  ): Promise<Record<string, unknown>> {
    return this.tx(auth, async (trx) => {
      const job = await this.lock(trx, id, auth);
      if (job.state !== 'dry_run_done') throw this.wrongState(job, 'a commit', ['dry_run_done']);
      if (!job.dry_run_digest || job.dry_run_digest !== body.dry_run_digest) {
        throw new ApiProblem({
          code: 'import-stale-dry-run',
          detail:
            'The file, mapping or options changed after the dry run you reviewed, or the digest is not the latest one. Run the dry run again and review it.',
          extensions: { current_digest: job.dry_run_digest },
        });
      }
      this.assertMayRun(auth, job);
      await this.assertCapacity(trx, id);
      const row = await trx.import_job.update({
        where: { id },
        data: {
          state: 'committing',
          ...(await this.scopeColumns(trx, auth, job)),
          cursor_row: 0,
          rows_processed: 0,
          done_create: 0,
          done_update: 0,
          done_skip: 0,
          done_error: 0,
          started_at: new Date(),
          finished_at: null,
          committed_at: null,
          cancel_requested: false,
          error: null,
        },
      });
      await this.jobs.enqueue(
        IMPORT_STEP_JOB,
        { tenantId: auth.tenantId, importId: id },
        { tx: trx },
      );
      await this.record(trx, {
        entity: 'import_job',
        verb: 'commit_requested',
        id,
        version: row.version,
        meta: {
          import_job_id: id,
          plan: {
            create: row.plan_create,
            update: row.plan_update,
            skip: row.plan_skip,
            error: row.plan_error,
          },
        },
      });
      return importDto(row, true);
    });
  }

  // ----------------------------------------------------------------------------------------- cancel

  async cancel(auth: AuthContext, id: string): Promise<Record<string, unknown>> {
    return this.tx(auth, async (trx) => {
      const job = await this.lock(trx, id, auth);
      if (job.state === 'completed' || job.state === 'cancelled')
        throw this.wrongState(job, 'cancelling', [
          'draft',
          'uploaded',
          'analyzing',
          'analyzed',
          'mapped',
          'dry_running',
          'dry_run_done',
          'committing',
          'failed',
        ]);
      const running = job.state === 'dry_running' || job.state === 'committing';
      const row = await trx.import_job.update({
        where: { id },
        data: running
          ? { cancel_requested: true }
          : { state: 'cancelled', finished_at: new Date(), cancel_requested: false },
      });
      await this.record(trx, {
        entity: 'import_job',
        verb: running ? 'cancel_requested' : 'cancelled',
        id,
        version: row.version,
        meta: { import_job_id: id, phase: job.state, rows_processed: job.rows_processed },
      });
      return importDto(row, true);
    });
  }

  // ---------------------------------------------------------------------------------- templates link

  /** Used by the templates service: applies saved columns (matched by header) to an analysed job. */
  async applyColumns(
    auth: AuthContext,
    id: string,
    columns: Array<{ header: string; target: string | null; date_format?: string | undefined }>,
    options: Record<string, unknown>,
  ): Promise<{ data: Record<string, unknown>; version: number }> {
    return this.tx(auth, async (trx) => {
      const job = await this.lock(trx, id, auth);
      const allowed: ImportState[] = ['analyzed', 'mapped', 'dry_run_done'];
      if (!allowed.includes(job.state as ImportState))
        throw this.wrongState(job, 'applying a template', allowed);
      const headers = (job.headers ?? []) as string[];
      const norm = (s: string) => normKey(s).replace(/[^\p{L}\p{N}]+/gu, '');
      const used = new Set<string>();
      const cols = headers.map((h, index) => {
        const hit = columns.find(
          (c) => c.target && !used.has(c.target) && norm(c.header) === norm(h),
        );
        if (hit?.target) used.add(hit.target);
        return {
          index,
          target: hit?.target ?? null,
          ...(hit?.date_format ? { date_format: hit.date_format } : {}),
        };
      });
      const merged = optionsSchema.parse({ ...this.options(job), ...options });
      const row = await trx.import_job.update({
        where: { id },
        data: {
          mapping: { columns: cols } as never,
          options: merged as never,
          state: 'mapped',
          dry_run_digest: null,
          dry_run_at: null,
          plan_create: 0,
          plan_update: 0,
          plan_skip: 0,
          plan_error: 0,
          cursor_row: 0,
          rows_processed: 0,
        },
      });
      await this.record(trx, {
        entity: 'import_job',
        verb: 'template_applied',
        id,
        version: row.version,
        meta: { import_job_id: id, mapped: cols.filter((c) => c.target).length },
      });
      return { data: importDto(row, true), version: row.version };
    });
  }

  // ------------------------------------------------------------------------------------------ rows

  async rows(
    auth: AuthContext,
    id: string,
    q: ImportRowsQuery,
  ): Promise<{
    data: Array<Record<string, unknown>>;
    page: { next_cursor: string | null; has_more: boolean };
  }> {
    return this.tx(auth, async (trx) => {
      const job = await trx.import_job.findFirst({ where: { id, ...this.mine(auth) } });
      if (!job) throw problem.notFound('Import not found.');
      const phase =
        q.phase ?? (job.state === 'committing' || job.state === 'completed' ? 'commit' : 'dry_run');
      const after = q.cursor ? Number(Buffer.from(q.cursor, 'base64url').toString('utf8')) : 0;
      if (q.cursor && !Number.isInteger(after)) throw problem.badRequest('Invalid cursor.');
      const outcomes = q.outcome ?? [];
      const where: Record<string, unknown> = { job_id: id, row_no: { gt: after } };
      if (phase === 'dry_run') {
        where.plan = outcomes.length
          ? { in: outcomes.filter((o) => ['create', 'update', 'skip', 'error'].includes(o)) }
          : { not: null };
      } else {
        where.result = outcomes.length
          ? {
              in: outcomes.map(
                (o) =>
                  (
                    ({ create: 'created', update: 'updated', skip: 'skipped' }) as Record<
                      string,
                      string
                    >
                  )[o] ?? o,
              ),
            }
          : { not: null };
      }
      if (q.has_warnings !== undefined)
        where.NOT = q.has_warnings ? { warnings: { equals: [] } } : undefined;
      const rows = await trx.import_row.findMany({
        where: where as never,
        orderBy: { row_no: 'asc' },
        take: q.limit + 1,
      });
      const more = rows.length > q.limit;
      const slice = rows.slice(0, q.limit);
      const headers = (job.headers ?? []) as string[];
      return {
        data: slice.map((r) => rowDto(r, headers, phase)),
        page: {
          next_cursor: more
            ? Buffer.from(String(slice[slice.length - 1]!.row_no)).toString('base64url')
            : null,
          has_more: more,
        },
      };
    });
  }

  /** The rows of the error report in pages (for streaming): row, line, messages and the original cells. */
  async errorPage(
    auth: AuthContext,
    id: string,
    after: number,
    limit: number,
  ): Promise<{
    headers: string[];
    rows: Array<{
      row_no: number;
      line_no: number;
      raw: string[];
      issues: RowIssue[];
      warnings: RowIssue[];
    }>;
    phase: string;
  } | null> {
    return this.tx(auth, async (trx) => {
      const job = await trx.import_job.findFirst({
        where: { id, ...this.mine(auth) },
        select: { headers: true, state: true },
      });
      if (!job) return null;
      const commit = job.state === 'committing' || job.state === 'completed';
      const rows = await trx.import_row.findMany({
        where: commit
          ? { job_id: id, row_no: { gt: after }, result: 'error' }
          : { job_id: id, row_no: { gt: after }, plan: 'error' },
        orderBy: { row_no: 'asc' },
        take: limit,
        select: {
          row_no: true,
          line_no: true,
          raw: true,
          errors: true,
          result_errors: true,
          warnings: true,
        },
      });
      return {
        headers: (job.headers ?? []) as string[],
        phase: commit ? 'commit' : 'dry_run',
        rows: rows.map((r) => ({
          row_no: r.row_no,
          line_no: r.line_no,
          raw: r.raw as string[],
          issues: ((commit ? r.result_errors : r.errors) ??
            r.errors ??
            []) as unknown as RowIssue[],
          warnings: (r.warnings ?? []) as unknown as RowIssue[],
        })),
      };
    });
  }

  async assertExists(auth: AuthContext, id: string): Promise<void> {
    await this.tx(auth, async (trx) => {
      if (
        !(await trx.import_job.findFirst({
          where: { id, ...this.mine(auth) },
          select: { id: true },
        }))
      )
        throw problem.notFound('Import not found.');
    });
  }

  // ---------------------------------------------------------------------------------------- values

  /**
   * For the model values of an asset import: the category and manufacturer each value's rows resolve to
   * (ED-37), so the value step checks a model inside its rows' category, as the dry run does. A category
   * that does not exist (yet) is `null`: the import creates it and the model with it.
   */
  private async modelScopes(
    trx: Tx,
    job: JobRecord,
    options: ImportOptions,
    context: RefResolver,
    idx: number,
    hasColumn: boolean,
  ): Promise<Map<string, Array<{ categoryId: string | null; manufacturerId: string | null }>>> {
    const mapping = (job.mapping ?? {}) as {
      columns?: Array<{ index: number; target: string | null }>;
      constants?: Record<string, string>;
    };
    const constants = mapping.constants ?? {};
    const colOf = (target: string) => (mapping.columns ?? []).find((c) => c.target === target);
    const cell = (c: { index: number } | undefined) =>
      c ? Prisma.sql`nullif(btrim(raw->>${c.index}::int), '')` : Prisma.sql`null::text`;
    const model = hasColumn
      ? Prisma.sql`btrim(raw->>${idx}::int)`
      : Prisma.sql`${constants.model ?? ''}::text`;
    const rows = await trx.$queryRaw<Array<{ v: string; c: string | null; m: string | null }>>`
      select distinct ${model} as v, ${cell(colOf('category'))} as c, ${cell(colOf('manufacturer'))} as m
        from app.import_row where job_id = ${job.id}::uuid and nullif(${model}, '') is not null
       limit 5000`;
    const idOf = async (kind: RefKind, text: string | null | undefined) => {
      if (!text) return null;
      const res = await context.resolve(kind, text);
      return res.kind === 'found' ? res.id : null;
    };
    const out = new Map<
      string,
      Array<{ categoryId: string | null; manufacturerId: string | null }>
    >();
    const seen = new Set<string>();
    for (const r of rows) {
      const categoryText = r.c ?? constants.category ?? null;
      let categoryId = categoryText
        ? await idOf('category', categoryText)
        : (options.defaults.category ?? null);
      // A category the import creates is a new, empty category: the dry run then refuses a model whose
      // name exists under another category, exactly as for an existing category without that model.
      // A category id that matches no model stands for it.
      if (
        categoryId === null &&
        categoryText &&
        (options.references.category ?? 'create') === 'create'
      ) {
        categoryId = NEW_CATEGORY;
      }
      const manufacturerId = await idOf('manufacturer', r.m ?? constants.manufacturer ?? null);
      const key = `${r.v}|${categoryId}|${manufacturerId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const list = out.get(r.v) ?? [];
      list.push({ categoryId, manufacturerId });
      out.set(r.v, list);
    }
    return out;
  }

  async values(
    auth: AuthContext,
    id: string,
    q: ImportValuesQuery,
  ): Promise<Record<string, unknown>> {
    return this.tx(auth, async (trx) => {
      const job = await trx.import_job.findFirst({ where: { id, ...this.mine(auth) } });
      if (!job) throw problem.notFound('Import not found.');
      const entity = job.entity_type as EntityType;
      const kind = q.field as RefKind;
      const target = REF_TARGET[entity][kind];
      const columns =
        (job.mapping as { columns?: Array<{ index: number; target: string | null }> }).columns ??
        [];
      const constant = target
        ? (job.mapping as { constants?: Record<string, string> }).constants?.[target]
        : undefined;
      const col = target ? columns.find((c) => c.target === target) : undefined;
      if (!target || (!col && !constant)) {
        throw problem.validation([
          {
            pointer: 'query:field',
            message: `No column is mapped to ${kind}. Map one first.`,
            code: 'invalid',
          },
        ]);
      }
      const like = q.q ? `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`).toLowerCase()}%` : null;
      const idx = col ? col.index : 0;
      const grouped = col
        ? await trx.$queryRaw<Array<{ v: string; n: number }>>`
            select btrim(raw->>${idx}::int) as v, count(*)::int as n from app.import_row
             where job_id = ${id}::uuid and nullif(btrim(raw->>${idx}::int), '') is not null
               and (${like}::text is null or lower(raw->>${idx}::int) like ${like}::text)
             group by 1 order by n desc, 1 limit ${q.limit}`
        : [{ v: constant!, n: job.rows_total }];
      const total = col
        ? ((
            await trx.$queryRaw<
              Array<{ n: number }>
            >`select count(distinct btrim(raw->>${idx}::int))::int as n from app.import_row where job_id = ${id}::uuid and nullif(btrim(raw->>${idx}::int), '') is not null`
          )[0]?.n ?? 0)
        : 1;
      const options = optionsSchema.parse(job.options ?? {});
      // ED-37: the same resolver rules as the dry run, with nothing created: a name that would be created
      // comes back "not found" (the web says "Will be created" or "Not found" by the kind's policy).
      const lookOnly = (valueMap: ValueMap) =>
        new RefResolver(
          trx,
          jobAuth(auth.tenantId, auth.userId),
          {
            ...options,
            references: Object.fromEntries(
              (ENTITY_REFS[entity].concat(['status']) as RefKind[]).map((k) => [k, 'must_exist']),
            ) as never,
          },
          valueMap,
          this.refServices,
          'dry',
        );
      const valueMap = (job.value_map ?? {}) as ValueMap;
      // the value itself is looked up by name (its own entry is shown apart, as `entry`) ...
      const resolver = lookOnly({});
      // ... the other references of its rows (a model's category and manufacturer) as the dry run sees them
      const context = lookOnly(valueMap);
      if (kind === 'location' && createsLocations(options)) {
        resolver.planLocations(() => locationTextsOf(trx, job));
      }
      const scopes =
        kind === 'model'
          ? await this.modelScopes(trx, job, options, context, idx, col !== undefined)
          : null;
      const data = [];
      for (const g of grouped) {
        let suggestion: { id: string; name: string } | null = null;
        let issue: { code: string; message: string } | null = null;
        const results: Resolution[] = [];
        if (scopes) {
          for (const scope of scopes.get(g.v) ?? [{ categoryId: null, manufacturerId: null }]) {
            // a category that does not exist yet is created by the import, and so is the model
            if (scope.categoryId === null) results.push({ kind: 'create', name: g.v });
            else results.push(await resolver.resolve('model', g.v, scope));
          }
        } else results.push(await resolver.resolve(kind, g.v));
        for (const res of results) {
          if (res.kind === 'error' && res.issue.code !== 'not-found') {
            issue = { code: res.issue.code, message: res.issue.message };
            break;
          }
        }
        if (!issue && results.length > 0 && results.every((r) => r.kind === 'found')) {
          const first = results[0] as Extract<Resolution, { kind: 'found' }>;
          suggestion = { id: first.id, name: first.name };
        }
        data.push({
          value: g.v,
          count: g.n,
          suggestion,
          issue,
          entry: valueMap[kind]?.[normKey(g.v)] ?? null,
        });
      }
      return {
        field: kind,
        column: col ? ((job.headers as string[] | null)?.[col.index] ?? null) : null,
        distinct: total,
        data,
      };
    });
  }
}

export function rowDto(
  r: {
    row_no: number;
    line_no: number;
    raw: unknown;
    mapped: unknown;
    plan: string | null;
    result: string | null;
    errors: unknown;
    result_errors: unknown;
    warnings: unknown;
    entity_id: string | null;
    created_id: string | null;
    before_image?: unknown;
    dup_of: number | null;
  },
  headers: string[],
  phase: string,
): Record<string, unknown> {
  const raw = (r.raw ?? []) as string[];
  const source: Record<string, string> = {};
  headers.forEach((h, i) => {
    if (raw[i] !== undefined && raw[i] !== '') source[h] = raw[i]!;
  });
  const commit = phase === 'commit';
  return {
    row_no: r.row_no,
    line_no: r.line_no,
    phase,
    outcome: commit ? r.result : r.plan,
    plan: r.plan,
    result: r.result,
    entity_id: r.entity_id,
    created_id: r.created_id,
    duplicate_of: r.dup_of,
    errors: ((commit ? (r.result_errors ?? r.errors) : r.errors) ?? []) as RowIssue[],
    warnings: (r.warnings ?? []) as RowIssue[],
    source,
    mapped: r.mapped ?? null,
    before_image: r.before_image ?? null,
  };
}

export { PRESETS, GOOGLE_CHROMEBOOK_CATEGORY, specOf, jobAuth };
export type { JobRow };
