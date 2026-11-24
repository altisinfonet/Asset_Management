import { http, HttpResponse, type HttpHandler } from 'msw';
import { checkIfMatch, etagOf, problem, requireSession } from './http';
import { idempotent, fail, notFound } from './m2-handlers';
import { newResourceId, type MockAsset, type RegistryData } from './registry-fixtures';
import { nowIso, paginate, readBody, validation, type FieldError } from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import { checkText, checkUuids, rejectUnknown } from './w2-common';
import {
  TARGETS,
  detectType,
  parseCsv,
  suggestField,
  toCsv,
  type ReferenceKind,
  type TargetSpec,
} from './w3-import-parse';
import {
  importUploadText,
  mutateW3,
  newW3Id,
  w3,
  type MockImportJob,
  type MockImportRow,
  type MockMappingTemplate,
} from './w3-state';

/**
 * Mock handlers of the import endpoints of docs/engineering/openapi.yaml (tag Imports, including the
 * `[M2-W3 WEB proposal]` operations): jobs with their state machine, the analysis of the uploaded
 * CSV, target fields, value lookups, dry run, commit with progress and cancel, row results, the error
 * report, templates and saved column mappings. The "worker" is time driven: a job moves along when
 * it is read, so progress bars, polling and resuming after a reload behave like the real thing.
 * A dry run touches no registry data; a commit creates the rows' records.
 */

const ENTITIES = [
  'asset',
  'accessory',
  'consumable',
  'location',
  'person',
  'manufacturer',
  'asset_model',
  'category',
  'department',
];
const SOURCES = ['csv', 'xlsx', 'snipe_it', 'google_admin_csv'];
const ALL_STATES = [
  'draft',
  'dry_run_queued',
  'dry_run_running',
  'dry_run_complete',
  'commit_queued',
  'committing',
  'committed',
  'failed',
  'cancelled',
];
const OWNER_ID = '0190a6b2-0000-7000-8000-000000000001';

/** How the simulated worker paces itself; tests make it quick (`setMockImportTiming`). */
let timing = { queued: 300, dryRun: 600, perRow: 4, batchMs: 400, batchRows: 25 };
export function setMockImportTiming(next: Partial<typeof timing>): void {
  timing = { ...timing, ...next };
}

// ---- helpers --------------------------------------------------------------------------------------

const targetsOf = (entity: string): TargetSpec[] => TARGETS[entity] ?? [];

function customTargets() {
  return registry()
    .customFields.filter((field) => !field.archived_at)
    .map((field) => {
      const category = field.category_id
        ? registry().categories.find((c) => c.id === field.category_id)
        : null;
      return {
        key: field.key,
        label: category ? `${field.label} (${category.name})` : field.label,
        type: field.data_type,
        required: !!field.required,
      };
    });
}

function digestOf(job: MockImportJob): string {
  const text = `${job.file_text?.length ?? 0}|${JSON.stringify(job.mapping)}|${JSON.stringify(job.options)}`;
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return `dry-${hash.toString(16).padStart(8, '0')}`;
}

function jobView(job: MockImportJob) {
  // the stored job also keeps what the simulated worker needs (and the paging wrapper adds `archived_at`)
  const view: Record<string, unknown> = { ...job };
  for (const key of [
    '_v',
    'file_text',
    'dry_run_ready_at',
    'commit_started_at',
    'cancel_requested',
    'archived_at',
  ]) {
    delete view[key];
  }
  return view;
}

function oneJob(job: MockImportJob, status = 200, headers: Record<string, string> = {}) {
  return HttpResponse.json(jobView(job), { status, headers: { ETag: etagOf(job._v), ...headers } });
}

const optionsOf = (job: MockImportJob) => ({
  match_on: (job.options.match_on as string | undefined) ?? 'asset_tag',
  on_duplicate: (job.options.on_duplicate as string | undefined) ?? 'skip',
  create_missing: job.options.create_missing_references !== false,
  date_format: (job.options.date_format as string | undefined) ?? 'YYYY-MM-DD',
  valueMap: (job.options.value_map ?? {}) as Record<
    string,
    Record<string, { action: string; id?: string }>
  >,
});

function refs(kind: ReferenceKind): Array<{ id: string; name: string }> {
  const data = registry();
  const live = <T extends { archived_at?: string | null }>(list: T[]) =>
    list.filter((item) => !item.archived_at);
  switch (kind) {
    case 'category':
      return live(data.categories).map((c) => ({ id: c.id, name: c.name }));
    case 'manufacturer':
      return live(data.manufacturers).map((c) => ({ id: c.id, name: c.name }));
    case 'asset_model':
      return live(data.models).map((c) => ({ id: c.id, name: c.name }));
    case 'location':
      return live(data.locations).map((c) => ({ id: c.id, name: c.name }));
    case 'person':
      return live(data.people).map((c) => ({ id: c.id, name: c.display_name }));
    case 'department':
      return live(data.departments).map((c) => ({ id: c.id, name: c.name }));
    case 'vendor':
      return live(data.vendors).map((c) => ({ id: c.id, name: c.name }));
    case 'status_label':
      return live(data.statusLabels).map((c) => ({ id: c.id, name: c.name }));
  }
}

/** "/Main/Room 101" matches the location called "Room 101". */
const referenceKey = (kind: ReferenceKind, value: string) => {
  const trimmed = value.trim();
  const last =
    kind === 'location' ? (trimmed.split('/').filter(Boolean).pop() ?? trimmed) : trimmed;
  return last.toLowerCase();
};

function matchReference(kind: ReferenceKind, value: string) {
  const wanted = referenceKey(kind, value);
  return refs(kind).find((r) => r.name.trim().toLowerCase() === wanted) ?? null;
}

interface FileView {
  headers: string[];
  rows: string[][];
  delimiter: string;
}

function fileOf(job: MockImportJob): FileView | { error: string } {
  if (!job.file_text) return { error: 'No file is attached to this import yet.' };
  if (/\.xlsx?$/i.test(job.original_filename ?? '')) {
    return {
      error: 'Line 1: this mock cannot read spreadsheets. Save the sheet as CSV and upload that.',
    };
  }
  try {
    const delimiter = typeof job.options.delimiter === 'string' ? job.options.delimiter : undefined;
    return parseCsv(job.file_text, delimiter);
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'The file could not be read.' };
  }
}

/** How long the simulated dry run takes: a base time plus a little per row, so a long file shows its progress. */
function dryRunMs(job: MockImportJob): number {
  const file = fileOf(job);
  return timing.dryRun + ('error' in file ? 0 : file.rows.length * timing.perRow);
}

// ---- the attached file ----------------------------------------------------------------------------

function attachmentOf(id: string) {
  return registry().attachments.find((a) => a.id === id && !a.archived_at);
}

/** An uploaded file that has passed its scan, as `GET /v1/attachments/{id}` would say (advances the simulated scanner). */
function scanState(id: string): 'pending' | 'clean' | 'infected' | 'error' | 'missing' {
  const attachment = attachmentOf(id);
  if (!attachment) return 'missing';
  if (
    attachment.scan_status === 'pending' &&
    attachment.scan_due_at != null &&
    Date.now() >= attachment.scan_due_at
  ) {
    mutateRegistry(() => {
      attachment.scan_status = attachment.scan_result === 'infected' ? 'infected' : 'clean';
      attachment.scan_detail =
        attachment.scan_result === 'infected' ? 'Eicar-Test-Signature' : null;
    });
  }
  return attachment.scan_status;
}

// ---- row evaluation ---------------------------------------------------------------------------------

interface Resolved {
  values: Record<string, string>;
  errors: FieldError[];
  warnings: FieldError[];
  /** Per reference field: an existing record, or a name to create. */
  refs: Record<string, { id: string | null; create: string | null }>;
  /** The existing record the row matches (an asset), if any. */
  existingAssetId: string | null;
}

function valuesOf(job: MockImportJob, file: FileView, row: string[]) {
  const values: Record<string, string> = {};
  file.headers.forEach((header, index) => {
    const target = job.mapping[header];
    if (target) values[target] = (row[index] ?? '').trim();
  });
  return values;
}

function parseDate(value: string, format: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{2,4})$/.exec(value);
  if (!m) return null;
  const [d, mo] = format.startsWith('MM') ? [m[2]!, m[1]!] : [m[1]!, m[2]!];
  const year = m[3]!.length === 2 ? `20${m[3]}` : m[3]!;
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

function resolveRow(job: MockImportJob, file: FileView, row: string[]): Resolved {
  const options = optionsOf(job);
  const values = valuesOf(job, file, row);
  const errors: FieldError[] = [];
  const warnings: FieldError[] = [];
  const resolvedRefs: Resolved['refs'] = {};
  const specs = targetsOf(job.entity_type);
  const chromeos = job.source === 'google_admin_csv';

  for (const spec of specs) {
    const value = values[spec.key] ?? '';
    if (spec.required && !value) {
      errors.push({
        pointer: `/${spec.key}`,
        message: `${spec.label} is required`,
        code: 'required',
      });
      continue;
    }
    if (!value) continue;
    if (spec.type === 'date' && !parseDate(value, options.date_format)) {
      errors.push({
        pointer: `/${spec.key}`,
        message: `"${value}" is not a date in the format ${options.date_format}`,
        code: 'invalid_format',
      });
    }
    if (spec.type === 'money' && Number.isNaN(Number(value.replace(',', '.')))) {
      errors.push({
        pointer: `/${spec.key}`,
        message: `"${value}" is not an amount`,
        code: 'invalid_format',
      });
    }
    if (spec.type === 'reference' && spec.reference) {
      const kind = spec.reference;
      const choice = options.valueMap[spec.key]?.[value];
      const match = matchReference(kind, value);
      if (choice?.action === 'map' && choice.id)
        resolvedRefs[spec.key] = { id: choice.id, create: null };
      else if (choice?.action === 'skip') resolvedRefs[spec.key] = { id: null, create: null };
      else if (match) resolvedRefs[spec.key] = { id: match.id, create: null };
      else if (
        (choice?.action === 'create' || options.create_missing) &&
        kind !== 'person' &&
        kind !== 'status_label'
      ) {
        resolvedRefs[spec.key] = { id: null, create: value };
        warnings.push({
          pointer: `/${spec.key}`,
          message: `${spec.label} "${value}" will be created`,
          code: 'will-create',
        });
      } else {
        errors.push({
          pointer: `/${spec.key}`,
          message: `${spec.label} "${value}" was not found`,
          code: 'not-found',
        });
      }
    }
  }

  let existingAssetId: string | null = null;
  if (job.entity_type === 'asset') {
    const key = values[options.match_on] ?? '';
    if (!key && !errors.some((e) => e.pointer === `/${options.match_on}`)) {
      const label = specs.find((s) => s.key === options.match_on)?.label ?? options.match_on;
      errors.push({
        pointer: `/${options.match_on}`,
        message: `${label} is required`,
        code: 'required',
      });
    }
    const category = resolvedRefs.category;
    if (!chromeos && !category?.id && !category?.create) {
      errors.push({ pointer: '/category', message: 'Category is required', code: 'required' });
    }
    if (key) {
      existingAssetId =
        registry().assets.find(
          (a) =>
            !a.archived_at &&
            (options.match_on === 'serial' ? a.serial : a.asset_tag)?.toLowerCase() ===
              key.toLowerCase(),
        )?.id ?? null;
    }
  }
  return { values, errors, warnings, refs: resolvedRefs, existingAssetId };
}

function computeDryRun(job: MockImportJob): { rows: MockImportRow[]; error: string | null } {
  const file = fileOf(job);
  if ('error' in file) return { rows: [], error: file.error };
  const options = optionsOf(job);
  const seen = new Map<string, number>();
  const rows: MockImportRow[] = [];
  file.rows.forEach((raw, index) => {
    const rowNo = index + 2; // the header is line 1
    const resolved = resolveRow(job, file, raw);
    const source: Record<string, string> = {};
    file.headers.forEach((header, i) => (source[header] = raw[i] ?? ''));
    let outcome: MockImportRow['outcome'] = 'create';
    const errors = [...resolved.errors];
    const warnings = [...resolved.warnings];
    if (errors.length > 0) outcome = 'error';
    else if (job.entity_type === 'asset') {
      const key = resolved.values[options.match_on] ?? '';
      const first = key ? seen.get(key.toLowerCase()) : undefined;
      if (key) seen.set(key.toLowerCase(), first ?? rowNo);
      if (first !== undefined) {
        outcome = 'skip';
        warnings.push({
          pointer: `/${options.match_on}`,
          message: `Duplicate of row ${first} in the file`,
          code: 'duplicate-in-file',
        });
      } else if (resolved.existingAssetId) {
        const existing = registry().assets.find((a) => a.id === resolved.existingAssetId)!;
        if (options.on_duplicate === 'update') {
          outcome = 'update';
          warnings.push({
            pointer: '/',
            message: `Updates ${existing.asset_tag}`,
            code: 'will-update',
          });
        } else if (options.on_duplicate === 'error') {
          outcome = 'error';
          errors.push({
            pointer: `/${options.match_on}`,
            message: `${existing.asset_tag} already exists`,
            code: 'duplicate',
          });
        } else {
          outcome = 'skip';
          warnings.push({
            pointer: `/${options.match_on}`,
            message: `Already exists as ${existing.asset_tag}`,
            code: 'duplicate',
          });
        }
      }
    }
    rows.push({
      job_id: job.id,
      row_no: rowNo,
      phase: 'dry_run',
      outcome,
      entity_id: resolved.existingAssetId,
      errors,
      warnings,
      source_data: source,
    });
  });
  return { rows, error: null };
}

// ---- the commit -------------------------------------------------------------------------------------

function ensureReference(
  data: RegistryData,
  kind: ReferenceKind,
  name: string,
  categoryId: string | null,
): string | null {
  const stamp = nowIso();
  const base = { created_at: stamp, updated_at: stamp, archived_at: null, _v: 1 };
  switch (kind) {
    case 'category': {
      const id = newResourceId('category');
      data.categories.push({
        ...base,
        id,
        name,
        kind: 'asset',
        tag_prefix: null,
        description: null,
      });
      return id;
    }
    case 'manufacturer': {
      const id = newResourceId('manufacturer');
      data.manufacturers.push({ ...base, id, name });
      return id;
    }
    case 'location': {
      const id = newResourceId('location');
      data.locations.push({
        ...base,
        id,
        name,
        kind: 'other',
        parent_id: null,
        depth: 0,
        ancestor_ids: [id],
        company_id: data.locations[0]?.company_id ?? id,
      });
      return id;
    }
    case 'department': {
      const id = newResourceId('department');
      data.departments.push({
        ...base,
        id,
        name,
        code: null,
        description: null,
        manager_person_id: null,
      });
      return id;
    }
    case 'vendor': {
      const id = newResourceId('vendor');
      data.vendors.push({ ...base, id, name });
      return id;
    }
    case 'asset_model': {
      const id = newResourceId('model');
      data.models.push({ ...base, id, name, category_id: categoryId ?? data.categories[0]!.id });
      return id;
    }
    default:
      return null;
  }
}

function commitRows(job: MockImportJob) {
  const file = fileOf(job);
  if ('error' in file) return;
  const options = optionsOf(job);
  const actor = job.created_by ?? OWNER_ID;
  mutateRegistry((data) => {
    for (const row of w3().importRows.filter((r) => r.job_id === job.id && r.phase === 'dry_run')) {
      if (row.outcome === 'error' || row.outcome === 'skip') continue;
      const raw = file.rows[row.row_no - 2];
      if (!raw) continue;
      const resolved = resolveRow(job, file, raw);
      const idOf = (field: string, kind: ReferenceKind, categoryId: string | null = null) => {
        const r = resolved.refs[field];
        if (!r) return null;
        return r.id ?? (r.create ? ensureReference(data, kind, r.create, categoryId) : null);
      };
      if (job.entity_type === 'asset') {
        const v = resolved.values;
        const chromebook = data.categories.find((c) => c.name === 'Chromebook');
        const categoryId =
          idOf('category', 'category') ??
          (job.source === 'google_admin_csv' ? (chromebook?.id ?? null) : null);
        if (!categoryId) continue;
        const status =
          idOf('status_label', 'status_label') ??
          data.statusLabels.find((s) => s.state_type === 'deployable' && s.is_default)?.id ??
          data.statusLabels.find((s) => s.state_type === 'deployable')!.id;
        const stamp = nowIso();
        const existing = resolved.existingAssetId
          ? data.assets.find((a) => a.id === resolved.existingAssetId)
          : undefined;
        const target: MockAsset = existing ?? ({} as MockAsset);
        if (!existing) {
          Object.assign(target, {
            id: newResourceId('asset'),
            created_at: stamp,
            archived_at: null,
            current_assignment: null,
            custom_data: {},
            label_code: `IMP${newResourceId('asset').slice(-8)}`,
            parent_asset_id: null,
            _v: 0,
          });
        }
        Object.assign(target, {
          updated_at: stamp,
          asset_tag:
            v.asset_tag ||
            target.asset_tag ||
            `IMP-${String(data.assets.length + 1).padStart(5, '0')}`,
          serial: v.serial || target.serial || null,
          name: v.name || target.name || null,
          category_id: categoryId,
          model_id: idOf('model', 'asset_model', categoryId) ?? target.model_id ?? null,
          status_id: status,
          location_id: idOf('location', 'location') ?? target.location_id ?? null,
          department_id: idOf('department', 'department') ?? target.department_id ?? null,
          vendor_id: idOf('vendor', 'vendor') ?? target.vendor_id ?? null,
          purchase_date: v.purchase_date
            ? parseDate(v.purchase_date, options.date_format)
            : (target.purchase_date ?? null),
          order_number: v.order_number || target.order_number || null,
          notes: v.notes || target.notes || null,
        });
        target._v += 1;
        for (const [key, value] of Object.entries(v)) {
          if (key.startsWith('custom_data.') && value) target.custom_data![key.slice(12)] = value;
        }
        if (!existing) data.assets.push(target);
        row.entity_id = target.id;
        data.history.push({
          id: newResourceId('history'),
          asset_id: target.id,
          at: stamp,
          event_type: existing ? 'updated' : 'imported',
          actor_type: 'user',
          actor_id: actor,
          assignment_id: null,
          transfer_id: null,
          summary: existing
            ? `Updated by import ${job.original_filename ?? ''}`.trim()
            : `Imported from ${job.original_filename ?? 'a file'}`,
          payload: { import_job_id: job.id },
        });
      } else if (job.entity_type === 'person') {
        const v = resolved.values;
        const stamp = nowIso();
        data.people.push({
          id: newResourceId('person'),
          created_at: stamp,
          updated_at: stamp,
          archived_at: null,
          kind: (['employee', 'student', 'contractor', 'external'].includes(v.kind ?? '')
            ? v.kind
            : 'employee') as 'employee',
          display_name: v.display_name!,
          first_name: null,
          last_name: null,
          email: v.email || null,
          phone: v.phone || null,
          employee_ref: v.employee_ref || null,
          department_id: idOf('department', 'department'),
          job_title: v.job_title || null,
          location_id: idOf('location', 'location'),
          company_id: data.locations[0]?.company_id ?? '',
          status: 'active',
          notes: null,
          user_id: null,
          _v: 1,
        } as never);
      } else if (job.entity_type === 'location') {
        const stamp = nowIso();
        const id = newResourceId('location');
        const parent = idOf('parent', 'location');
        data.locations.push({
          id,
          created_at: stamp,
          updated_at: stamp,
          archived_at: null,
          parent_id: parent,
          company_id: data.locations[0]?.company_id ?? id,
          name: resolved.values.name!,
          kind: 'other',
          code: resolved.values.code || null,
          depth: 0,
          ancestor_ids: [id],
          _v: 1,
        } as never);
      } else if (job.entity_type === 'department') {
        ensureReference(data, 'department', resolved.values.name!, null);
      }
    }
  });
}

// ---- the worker: a job moves along when it is read ---------------------------------------------------

function advance(job: MockImportJob): void {
  const now = Date.now();
  if ((job.state === 'dry_run_queued' || job.state === 'dry_run_running') && job.dry_run_ready_at) {
    if (now >= job.dry_run_ready_at) {
      const result = computeDryRun(job);
      mutateW3((data) => {
        data.importRows = data.importRows.filter(
          (r) => !(r.job_id === job.id && r.phase === 'dry_run'),
        );
        if (result.error) {
          job.state = 'failed';
          job.error = result.error;
        } else {
          data.importRows.push(...result.rows);
          job.state = 'dry_run_complete';
          job.rows_total = result.rows.length;
          job.rows_create = result.rows.filter((r) => r.outcome === 'create').length;
          job.rows_update = result.rows.filter((r) => r.outcome === 'update').length;
          job.rows_skip = result.rows.filter((r) => r.outcome === 'skip').length;
          job.rows_error = result.rows.filter((r) => r.outcome === 'error').length;
          job.dry_run_digest = digestOf(job);
          job.dry_run_completed_at = nowIso();
        }
        job.dry_run_ready_at = null;
        job.updated_at = nowIso();
        job._v += 1;
      });
    } else if (
      job.state === 'dry_run_queued' &&
      now >= job.dry_run_ready_at - dryRunMs(job) + timing.queued
    ) {
      mutateW3(() => {
        job.state = 'dry_run_running';
        job._v += 1;
      });
    }
    return;
  }
  if ((job.state === 'commit_queued' || job.state === 'committing') && job.commit_started_at) {
    const running = now - job.commit_started_at - timing.queued;
    const todo = job.rows_create + job.rows_update;
    const batches = running < 0 ? 0 : Math.floor(running / timing.batchMs) + 1;
    const processedOf = (n: number) => Math.min(todo, n * timing.batchRows);
    const done = processedOf(batches);
    if (job.cancel_requested && batches > 0) {
      mutateW3(() => finish(job, 'cancelled', processedOf(batches)));
      return;
    }
    if (done >= todo && batches > 0) {
      commitRows(job);
      mutateW3(() => finish(job, 'committed', todo));
    } else if (batches > 0) {
      mutateW3(() => {
        job.state = 'committing';
        job.commit_progress = progress(job, done);
      });
    }
  }
}

function progress(job: MockImportJob, processed: number) {
  const creates = Math.min(processed, job.rows_create);
  return {
    processed: processed + job.rows_skip + job.rows_error,
    created: creates,
    updated: Math.max(0, processed - creates),
    skipped: job.rows_skip,
    failed: job.rows_error,
  };
}

function finish(job: MockImportJob, state: 'committed' | 'cancelled', processed: number) {
  job.state = state;
  job.commit_progress = progress(job, processed);
  job.committed_at = state === 'committed' ? nowIso() : null;
  job.updated_at = nowIso();
  job._v += 1;
}

// ---- handlers ------------------------------------------------------------------------------------------

const jobOr404 = (id: string | readonly string[] | undefined) => {
  const job = w3().importJobs.find((j) => j.id === id);
  if (job) advance(job);
  return job;
};

const CSV_HEADERS = { 'content-type': 'text/csv; charset=utf-8' };

function templateCsv(entity: string, source: string): string {
  if (source === 'google_admin_csv') {
    return toCsv([
      ['Serial Number', 'Asset ID', 'Model', 'Annotated User', 'Org Unit', 'Status', 'Notes'],
      [
        '5CG1234XYZ',
        'AT-00123',
        'Chromebook 3100',
        'jokafor@school.org',
        '/Main/Room 101',
        'Provisioned',
        '',
      ],
    ]);
  }
  const specs = targetsOf(entity);
  const example: Record<string, string> = {
    asset_tag: 'AT-00123',
    serial: '5CG1234XYZ',
    name: 'Chromebook 3100',
    category: 'Chromebook',
    manufacturer: 'Acme',
    model: 'Chromebook 3100',
    status_label: 'Ready',
    location: 'Room 101',
    department: 'Science',
    assignee: '',
    vendor: '',
    purchase_date: '2026-01-15',
    purchase_cost: '289.00',
    order_number: 'PO-4001',
    warranty_end: '2029-01-15',
    notes: '',
    display_name: 'Jo Okafor',
    email: 'jokafor@school.org',
    employee_ref: 'S-1042',
    kind: 'employee',
    job_title: 'Teacher',
    phone: '',
    parent: 'Main building',
    code: 'R101',
    description: '',
    manager: '',
  };
  return toCsv([specs.map((s) => s.label), specs.map((s) => example[s.key] ?? '')]);
}

export const importHandlers: HttpHandler[] = [
  http.get('/v1/imports', ({ request }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const params = new URL(request.url).searchParams;
    const states = (params.get('state') ?? '').split(',').filter(Boolean);
    const bad = states.find((s) => !ALL_STATES.includes(s));
    if (bad) return fail('bad-request', { detail: `Unknown state "${bad}"` });
    w3().importJobs.forEach(advance);
    return paginate(
      request,
      w3().importJobs.map((j) => ({ ...j, archived_at: null })),
      {
        sorts: { created_at: (j) => j.created_at },
        defaultSort: '-created_at',
        filter: (j, query) =>
          (states.length === 0 || states.includes(j.state)) &&
          (!query.get('entity_type') || j.entity_type === query.get('entity_type')),
      },
      jobView,
    );
  }),

  http.post('/v1/imports', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors: FieldError[] = [
      ...rejectUnknown(body, ['source', 'entity_type', 'file_attachment_id', 'mapping', 'options']),
      ...checkUuids(body, ['file_attachment_id']),
    ];
    if (!SOURCES.includes(String(body.source))) {
      errors.push({ pointer: '/source', message: 'Invalid option', code: 'invalid_value' });
    }
    if (!ENTITIES.includes(String(body.entity_type))) {
      errors.push({ pointer: '/entity_type', message: 'Invalid option', code: 'invalid_value' });
    }
    if (body.source === 'google_admin_csv' && body.entity_type !== 'asset') {
      errors.push({
        pointer: '/entity_type',
        message: 'The Google Admin export holds devices (assets)',
        code: 'invalid',
      });
    }
    if (errors.length > 0) return validation(errors);
    const stamp = nowIso();
    const job: MockImportJob = {
      id: newW3Id('import'),
      source: body.source as MockImportJob['source'],
      entity_type: body.entity_type as MockImportJob['entity_type'],
      state: 'draft',
      file_attachment_id: null,
      original_filename: null,
      mapping: (body.mapping as Record<string, string> | undefined) ?? {},
      options: {
        match_on: 'asset_tag',
        on_duplicate: 'skip',
        create_missing_references: true,
        ...((body.options as Record<string, unknown> | undefined) ?? {}),
      },
      rows_total: 0,
      rows_create: 0,
      rows_update: 0,
      rows_skip: 0,
      rows_error: 0,
      dry_run_digest: null,
      dry_run_completed_at: null,
      committed_at: null,
      error: null,
      created_at: stamp,
      updated_at: stamp,
      created_by: guard.user.id,
      commit_progress: null,
      file_text: null,
      dry_run_ready_at: null,
      commit_started_at: null,
      cancel_requested: false,
      _v: 1,
    };
    mutateW3((data) => data.importJobs.push(job));
    return oneJob(job, 201, { Location: `/v1/imports/${job.id}` });
  }),

  http.get('/v1/imports/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    return job ? oneJob(job) : notFound('Import');
  }),

  http.patch('/v1/imports/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const stale = checkIfMatch(request, job._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors = [
      ...rejectUnknown(body, ['mapping', 'options', 'file_attachment_id']),
      ...checkUuids(body, ['file_attachment_id']),
    ];
    if (errors.length > 0) return validation(errors);
    if (job.state !== 'draft' && job.state !== 'dry_run_complete') {
      return fail('conflict', { detail: `The import cannot be edited in state "${job.state}".` });
    }
    if (typeof body.file_attachment_id === 'string') {
      if (job.state !== 'draft')
        return fail('conflict', { detail: 'Only a draft import takes another file.' });
      const attachment = attachmentOf(body.file_attachment_id);
      if (!attachment || attachment.entity_id !== job.id || attachment.kind !== 'import_file') {
        return validation([
          {
            pointer: '/file_attachment_id',
            message: 'No such import file for this import.',
            code: 'not-found',
          },
        ]);
      }
      if (scanState(attachment.id) !== 'clean') {
        return validation([
          {
            pointer: '/file_attachment_id',
            message: 'The file has not passed its virus scan.',
            code: 'not-clean',
          },
        ]);
      }
    }
    mutateW3(() => {
      if (typeof body.file_attachment_id === 'string') {
        const attachment = attachmentOf(body.file_attachment_id)!;
        job.file_attachment_id = attachment.id;
        job.original_filename = attachment.filename;
        job.file_text = importUploadText(attachment.id);
      }
      if (body.mapping && typeof body.mapping === 'object')
        job.mapping = body.mapping as Record<string, string>;
      if (body.options && typeof body.options === 'object')
        job.options = { ...job.options, ...(body.options as Record<string, unknown>) };
      if (job.state === 'dry_run_complete') {
        job.state = 'draft';
        job.dry_run_digest = null;
        job.dry_run_completed_at = null;
      }
      job.updated_at = nowIso();
      job._v += 1;
    });
    return oneJob(job);
  }),

  http.get('/v1/imports/:id/analysis', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const empty = {
      status: 'pending',
      error: null,
      encoding: null,
      delimiter: null,
      rows_total: null,
      columns: [],
    };
    if (!job.file_attachment_id) return HttpResponse.json(empty);
    const scan = scanState(job.file_attachment_id);
    if (scan === 'pending') return HttpResponse.json(empty);
    if (scan === 'infected' || scan === 'error' || scan === 'missing') {
      return HttpResponse.json({
        ...empty,
        status: 'failed',
        error: 'The file did not pass the virus scan and was removed.',
      });
    }
    const file = fileOf(job);
    if ('error' in file)
      return HttpResponse.json({ ...empty, status: 'failed', error: file.error });
    const taken = new Set<string>();
    const custom = customTargets();
    const columns = file.headers.map((name, index) => {
      const values = file.rows.map((r) => (r[index] ?? '').trim());
      const suggested = suggestField(job.entity_type, name, job.source, taken, custom);
      if (suggested) taken.add(suggested);
      const distinct = [...new Set(values.filter(Boolean))];
      return {
        index,
        name,
        sample_values: distinct.slice(0, 5),
        distinct_count: distinct.length,
        empty_count: values.filter((v) => !v).length,
        detected_type: detectType(values),
        suggested_field: suggested,
      };
    });
    return HttpResponse.json({
      status: 'ready',
      error: null,
      encoding: 'utf-8',
      delimiter: file.delimiter,
      rows_total: file.rows.length,
      columns,
    });
  }),

  http.get('/v1/import-target-fields', ({ request }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const entity = new URL(request.url).searchParams.get('entity_type') ?? '';
    if (!ENTITIES.includes(entity)) {
      return fail('bad-request', {
        detail: 'Query parameter "entity_type" is not a known entity.',
        errors: [
          { pointer: 'query:entity_type', message: 'Invalid option', code: 'invalid_value' },
        ],
      });
    }
    const core = targetsOf(entity).map((t) => ({
      key: t.key,
      label: t.label,
      required: t.required,
      type: t.type,
      reference: t.reference ?? null,
      custom: false,
    }));
    const custom =
      entity === 'asset'
        ? customTargets().map((c) => ({
            key: `custom_data.${c.key}`,
            label: c.label,
            required: false,
            type: (c.type === 'number'
              ? 'number'
              : c.type === 'date'
                ? 'date'
                : c.type === 'boolean'
                  ? 'boolean'
                  : 'text') as 'text',
            reference: null,
            custom: true,
          }))
        : [];
    return HttpResponse.json({ data: [...core, ...custom] });
  }),

  http.get('/v1/imports/:id/lookups', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const file = fileOf(job);
    if ('error' in file) return HttpResponse.json({ data: [] });
    const data = [];
    for (const spec of targetsOf(job.entity_type)) {
      if (spec.type !== 'reference' || !spec.reference) continue;
      const column = file.headers.findIndex((h) => job.mapping[h] === spec.key);
      if (column < 0) continue;
      const counts = new Map<string, number>();
      for (const row of file.rows) {
        const value = (row[column] ?? '').trim();
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
      data.push({
        field: spec.key,
        reference: spec.reference,
        values: [...counts.entries()].map(([value, rows]) => ({
          value,
          rows,
          match: matchReference(spec.reference!, value),
        })),
      });
    }
    return HttpResponse.json({ data });
  }),

  http.post('/v1/imports/:id/dry-run', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    if (job.state !== 'draft')
      return fail('conflict', {
        detail: `A dry run starts from a draft, not from "${job.state}".`,
      });
    if (!job.file_text && !job.file_attachment_id)
      return fail('conflict', { detail: 'Attach the file first.' });
    if (Object.keys(job.mapping).length === 0) {
      return validation([
        { pointer: '/mapping', message: 'Map at least one column first.', code: 'required' },
      ]);
    }
    mutateW3(() => {
      job.state = 'dry_run_queued';
      job.dry_run_ready_at = Date.now() + dryRunMs(job);
      job.error = null;
      job.updated_at = nowIso();
      job._v += 1;
    });
    return oneJob(job, 202, { Location: `/v1/imports/${job.id}`, 'Retry-After': '1' });
  }),

  http.get('/v1/imports/:id/rows', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const query = new URL(request.url).searchParams;
    const phase = query.get('phase') ?? 'dry_run';
    const outcomes = (query.get('outcome') ?? '').split(',').filter(Boolean);
    const rows = w3()
      .importRows.filter((r) => r.job_id === job.id && r.phase === (phase as 'dry_run'))
      .map((r) => ({
        ...r,
        id: `${r.job_id}-${String(r.row_no).padStart(8, '0')}`,
        _v: 1,
        archived_at: null,
      }));
    return paginate(
      request,
      rows,
      {
        sorts: { row_no: (r) => r.row_no },
        defaultSort: 'row_no',
        filter: (r) => outcomes.length === 0 || outcomes.includes(r.outcome),
      },
      ({ job_id: _j, id: _i, _v: _v, archived_at: _a, ...row }) => row,
    );
  }),

  http.get('/v1/imports/:id/error-report', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const errors = w3().importRows.filter((r) => r.job_id === job.id && r.outcome === 'error');
    const headers = errors[0] ? Object.keys(errors[0].source_data ?? {}) : [];
    const csv = toCsv([
      ['row', 'problem', ...headers],
      ...errors.map((r) => [
        String(r.row_no),
        r.errors.map((e) => e.message).join('; '),
        ...headers.map((h) => r.source_data?.[h] ?? ''),
      ]),
    ]);
    return new HttpResponse(csv, {
      headers: {
        ...CSV_HEADERS,
        'content-disposition': `attachment; filename="import-${job.id.slice(-6)}-errors.csv"`,
      },
    });
  }),

  http.post('/v1/imports/:id/commit', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    return idempotent(request, guard.user.id, body, () => {
      const job = jobOr404(params.id);
      if (!job) return notFound('Import');
      const errors = [
        ...(body ? rejectUnknown(body, ['dry_run_digest']) : []),
        ...(body ? checkText(body, 'dry_run_digest', { min: 1, max: 200, required: true }) : []),
      ];
      if (!body || errors.length > 0) return validation(errors);
      if (job.state !== 'dry_run_complete') {
        return fail('conflict', {
          detail: `Only a reviewed dry run can be committed, not "${job.state}".`,
        });
      }
      if (body.dry_run_digest !== job.dry_run_digest) {
        return problem(409, 'import-stale-dry-run', 'The dry run is out of date', {
          detail:
            'The file, the mapping or the options changed since you reviewed the dry run. Run it again.',
        });
      }
      mutateW3(() => {
        job.state = 'commit_queued';
        job.commit_started_at = Date.now();
        job.cancel_requested = false;
        job.commit_progress = { processed: 0, created: 0, updated: 0, skipped: 0, failed: 0 };
        job.updated_at = nowIso();
        job._v += 1;
      });
      return HttpResponse.json(jobView(job), {
        status: 202,
        headers: { Location: `/v1/imports/${job.id}`, 'Retry-After': '1', ETag: etagOf(job._v) },
      });
    });
  }),

  http.post('/v1/imports/:id/cancel', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    if (['committed', 'failed', 'cancelled'].includes(job.state)) {
      return fail('conflict', { detail: `The import is already ${job.state}.` });
    }
    mutateW3(() => {
      if (job.state === 'commit_queued' || job.state === 'committing') {
        // a running commit finishes its current batch and stops
        job.cancel_requested = true;
      } else {
        job.state = 'cancelled';
      }
      job.updated_at = nowIso();
      job._v += 1;
    });
    return oneJob(job);
  }),

  http.get('/v1/import-templates/:entity', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const entity = String(params.entity);
    if (!ENTITIES.includes(entity)) return notFound('Template');
    const source = new URL(request.url).searchParams.get('source') ?? 'csv';
    return new HttpResponse(templateCsv(entity, source), {
      headers: {
        ...CSV_HEADERS,
        'content-disposition': `attachment; filename="${entity}-${source === 'csv' ? 'template' : 'chromeos'}.csv"`,
      },
    });
  }),

  http.get('/v1/import-mapping-templates', ({ request }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    return paginate(
      request,
      w3().mappingTemplates.map((t) => ({ ...t, archived_at: null, _v: 1 })),
      {
        sorts: { name: (t) => t.name },
        defaultSort: 'name',
        filter: (t, params) =>
          !params.get('entity_type') || t.entity_type === params.get('entity_type'),
      },
      ({ archived_at: _a, _v: _v, ...template }) => template,
    );
  }),

  http.post('/v1/import-mapping-templates', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return fail('bad-request', { detail: 'Malformed JSON body' });
    const errors: FieldError[] = [
      ...rejectUnknown(body, ['name', 'entity_type', 'source', 'mapping', 'options']),
      ...checkText(body, 'name', { min: 1, max: 120, required: true }),
    ];
    if (!ENTITIES.includes(String(body.entity_type)))
      errors.push({ pointer: '/entity_type', message: 'Invalid option', code: 'invalid_value' });
    if (!SOURCES.includes(String(body.source)))
      errors.push({ pointer: '/source', message: 'Invalid option', code: 'invalid_value' });
    if (typeof body.mapping !== 'object' || body.mapping === null)
      errors.push({
        pointer: '/mapping',
        message: 'Invalid input: expected object',
        code: 'invalid_type',
      });
    if (errors.length > 0) return validation(errors);
    const name = String(body.name).trim();
    if (
      w3().mappingTemplates.some(
        (t) => t.entity_type === body.entity_type && t.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      return fail('conflict', {
        detail: `A saved mapping named "${name}" already exists.`,
        errors: [{ pointer: '/name', message: 'is already in use', code: 'duplicate' }],
      });
    }
    const template: MockMappingTemplate = {
      id: newW3Id('template'),
      name,
      entity_type: body.entity_type as MockMappingTemplate['entity_type'],
      source: body.source as MockMappingTemplate['source'],
      mapping: body.mapping as Record<string, string>,
      options: (body.options as Record<string, unknown> | undefined) ?? {},
      created_at: nowIso(),
    };
    mutateW3((data) => data.mappingTemplates.push(template));
    return HttpResponse.json(template, {
      status: 201,
      headers: { Location: `/v1/import-mapping-templates/${template.id}` },
    });
  }),

  http.delete('/v1/import-mapping-templates/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    if (!w3().mappingTemplates.some((t) => t.id === params.id)) return notFound('Saved mapping');
    mutateW3((data) => {
      data.mappingTemplates = data.mappingTemplates.filter((t) => t.id !== params.id);
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
