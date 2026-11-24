import { http, HttpResponse, type HttpHandler } from 'msw';
import { hasPermission } from '@/lib/auth/permissions';
import { checkIfMatch, etagOf, problem, requireSession } from './http';
import { idempotent, notFound } from './m2-handlers';
import { newResourceId, type MockAsset, type RegistryData } from './registry-fixtures';
import {
  nowIso,
  paginate,
  readBody,
  validation,
  type Body,
  type FieldError,
} from './registry-handlers';
import { mutateRegistry, registry } from './registry-state';
import {
  FIELD_SPECS,
  LOCATION_KINDS,
  PERSON_KINDS,
  PERSON_STATUSES,
  PRESETS,
  buildXlsx,
  dictionary,
  looseKey,
  normKey,
  parseCsv,
  presetOf,
  profileOf,
  readDate,
  readNumber,
  specOf,
  suggestMapping,
  templateRows,
  toCsv,
  type DateFormat,
  type EntityType,
  type FieldSpec,
  type NumberFormat,
  type Preset,
  type RefKind,
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
 * Mock handlers of the Imports tag of docs/engineering/openapi.yaml, mirroring apps/api/src/importer:
 * the job and its state machine (draft -> analyzing -> analyzed -> mapped -> dry_running ->
 * dry_run_done -> committing -> completed, failed, cancelled), the analysis of the uploaded file (a CSV
 * is read; a spreadsheet gets a fixed sample), the presets with their data dictionary and template
 * downloads, the value lookups, the dry run and the commit with their progress, the per-row results,
 * the error report, the saved mapping templates, the `import:read` / `import:run` split (ED-19), the
 * 409 `import-wrong-state` / `import-stale-dry-run` and 429 `import-quota-exceeded` problems, and the
 * retention purge of finished imports (ED-25). The "worker" is time driven: a job moves along when it
 * is read, so progress bars, polling and resuming after a reload behave like the real thing. A dry run
 * touches no registry data; a commit writes the rows through the mock registry.
 */

const ENTITIES: readonly EntityType[] = ['asset', 'person', 'location', 'department'];
const STATES = [
  'draft',
  'uploaded',
  'analyzing',
  'analyzed',
  'mapped',
  'dry_running',
  'dry_run_done',
  'committing',
  'completed',
  'failed',
  'cancelled',
] as const;
const RUNNING = ['analyzing', 'dry_running', 'committing'];
/** `IMPORT_MAX_CONCURRENT`: imports a tenant may run at once. */
const MAX_CONCURRENT = 2;
/** `IMPORT_ROW_RETENTION_DAYS`. */
const RETENTION_DAYS = 30;
const DAY_MS = 86_400_000;

/**
 * How the simulated worker paces itself; tests make it quick (`setMockImportTiming`): the analysis takes
 * `analyze` ms, a dry run or commit starts after `start` ms, then handles `dryBatchRows` (dry run) or
 * `batchRows` (commit) rows every `batchMs` ms. Setting `batchRows` alone paces the dry run the same way.
 */
const DEFAULT_TIMING = { analyze: 300, start: 300, batchMs: 400, batchRows: 25, dryBatchRows: 100 };
let timing = { ...DEFAULT_TIMING };
export function setMockImportTiming(next: Partial<typeof DEFAULT_TIMING>): void {
  timing = {
    ...timing,
    ...(next.batchRows !== undefined && next.dryBatchRows === undefined
      ? { dryBatchRows: next.batchRows }
      : {}),
    ...next,
  };
}
export function resetMockImportTiming(): void {
  timing = { ...DEFAULT_TIMING };
}

const WRITE_PERMISSION: Record<EntityType, string> = {
  asset: 'asset:create',
  person: 'person:manage',
  location: 'location:manage',
  department: 'department:manage',
};
const CREATE_PERMISSION: Partial<Record<RefKind, string>> = {
  category: 'catalog:manage',
  manufacturer: 'catalog:manage',
  model: 'catalog:manage',
  vendor: 'catalog:manage',
  department: 'department:manage',
  location: 'location:manage',
  person: 'person:manage',
};
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
const REF_KINDS: readonly RefKind[] = [
  'category',
  'manufacturer',
  'model',
  'status',
  'location',
  'department',
  'vendor',
  'person',
];
const REF_LABEL: Record<RefKind, string> = {
  category: 'Category',
  manufacturer: 'Manufacturer',
  model: 'Model',
  status: 'Status',
  location: 'Location',
  department: 'Department',
  vendor: 'Vendor',
  person: 'Person',
};

// ---- problems ---------------------------------------------------------------------------------------

function wrongState(job: Pick<MockImportJob, 'state'>, doing: string, allowed: readonly string[]) {
  return problem(409, 'import-wrong-state', 'The import is in the wrong state', {
    detail: `The import is "${job.state}"; ${doing} is only possible when it is ${allowed.map((s) => `"${s}"`).join(', ')}.`,
    extensions: { state: job.state, allowed },
  });
}

function quotaExceeded(running: number) {
  return problem(429, 'import-quota-exceeded', 'Too many imports are running', {
    detail: `${running} imports are running already (at most ${MAX_CONCURRENT} at once). Wait for one to finish.`,
    headers: { 'Retry-After': '30' },
  });
}

const badRequest = (detail: string) => problem(400, 'bad-request', 'Bad request', { detail });
const forbidden = (detail: string) => problem(403, 'forbidden', 'Forbidden', { detail });

// ---- options -------------------------------------------------------------------------------------------------

interface Options {
  match_on: 'auto' | 'asset_tag' | 'serial' | 'external_id';
  on_match: 'skip' | 'update' | 'error';
  blank_cells: 'ignore' | 'clear';
  date_format: DateFormat;
  number_format: NumberFormat;
  default_currency?: string;
  external_source?: string;
  references: Partial<Record<RefKind, 'create' | 'must_exist'>>;
  defaults: Partial<Record<'category' | 'status' | 'location' | 'department' | 'vendor', string>>;
  location_kind: (typeof LOCATION_KINDS)[number];
  assign: boolean;
  detect_changes: boolean;
}

const optionsOf = (job: Pick<MockImportJob, 'options'>): Options => ({
  match_on: 'auto',
  on_match: 'skip',
  blank_cells: 'ignore',
  date_format: 'auto',
  number_format: 'auto',
  location_kind: 'other',
  assign: true,
  detect_changes: true,
  ...(job.options as Partial<Options>),
  references: { ...(job.options.references as Options['references'] | undefined) },
  defaults: { ...(job.options.defaults as Options['defaults'] | undefined) },
});

const policyOf = (options: Options, kind: RefKind): 'create' | 'must_exist' =>
  options.references[kind] ?? (kind === 'status' || kind === 'person' ? 'must_exist' : 'create');

const ENUMS: Record<string, readonly string[]> = {
  match_on: ['auto', 'asset_tag', 'serial', 'external_id'],
  on_match: ['skip', 'update', 'error'],
  blank_cells: ['ignore', 'clear'],
  date_format: ['auto', 'iso', 'dmy', 'mdy'],
  number_format: ['auto', 'dot', 'comma'],
  location_kind: LOCATION_KINDS,
};
const DEFAULT_KEYS = ['category', 'status', 'location', 'department', 'vendor'];

/** The options a request may set (`optionsPatchSchema`): strict keys, enums, the 3-letter currency, uuid defaults. */
function checkOptionsPatch(value: unknown, pointer = '/options'): FieldError[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [{ pointer, message: 'Invalid input: expected object', code: 'invalid_type' }];
  }
  const errors: FieldError[] = [];
  const o = value as Record<string, unknown>;
  const allowed = [
    ...Object.keys(ENUMS),
    'default_currency',
    'external_source',
    'references',
    'defaults',
    'assign',
    'detect_changes',
  ];
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) {
      errors.push({ pointer, message: `Unrecognized key: "${key}"`, code: 'unrecognized_keys' });
    }
  }
  for (const [key, values] of Object.entries(ENUMS)) {
    if (key in o && !values.includes(String(o[key]))) {
      errors.push({
        pointer: `${pointer}/${key}`,
        message: 'Invalid option',
        code: 'invalid_value',
      });
    }
  }
  if ('default_currency' in o && !/^[A-Z]{3}$/.test(String(o.default_currency))) {
    errors.push({
      pointer: `${pointer}/default_currency`,
      message: 'Invalid string: must match pattern /^[A-Z]{3}$/',
      code: 'invalid_format',
    });
  }
  for (const key of ['assign', 'detect_changes']) {
    if (key in o && typeof o[key] !== 'boolean') {
      errors.push({
        pointer: `${pointer}/${key}`,
        message: 'Invalid input: expected boolean',
        code: 'invalid_type',
      });
    }
  }
  if ('references' in o) {
    const refs = o.references as Record<string, unknown> | null;
    for (const [kind, policy] of Object.entries(refs ?? {})) {
      if (
        !REF_KINDS.includes(kind as RefKind) ||
        !['create', 'must_exist'].includes(String(policy))
      ) {
        errors.push({
          pointer: `${pointer}/references/${kind}`,
          message: 'Invalid option',
          code: 'invalid_value',
        });
      }
    }
  }
  if ('defaults' in o) {
    for (const [key, id] of Object.entries((o.defaults as Record<string, unknown>) ?? {})) {
      if (!DEFAULT_KEYS.includes(key) || !/^[0-9a-f-]{36}$/i.test(String(id))) {
        errors.push({
          pointer: `${pointer}/defaults/${key}`,
          message: 'Invalid UUID',
          code: 'invalid_format',
        });
      }
    }
  }
  return errors;
}

/** `checkDefaults`: the ids of the options' defaults must exist. */
function checkDefaults(options: Options): FieldError[] {
  const data = registry();
  const lists: Record<string, Array<{ id: string; archived_at?: string | null }>> = {
    category: data.categories.filter((c) => c.kind === 'asset'),
    status: data.statusLabels,
    location: data.locations,
    department: data.departments,
    vendor: data.vendors,
  };
  const labels: Record<string, string> = {
    category: 'asset category',
    status: 'status label',
    location: 'location',
    department: 'department',
    vendor: 'vendor',
  };
  return Object.entries(options.defaults).flatMap(([key, id]) =>
    lists[key]?.some((r) => r.id === id && !r.archived_at)
      ? []
      : [
          {
            pointer: `/options/defaults/${key}`,
            message: `No such ${labels[key]}.`,
            code: 'not-found',
          },
        ],
  );
}

// ---- mapping checks ---------------------------------------------------------------------------------------------

interface MappingColumn {
  index: number;
  target: string | null;
  date_format?: DateFormat;
}
interface MappingShape {
  columns: MappingColumn[];
  constants?: Record<string, string>;
}

const mappingOf = (job: Pick<MockImportJob, 'mapping'>): MappingShape => {
  const m = job.mapping as Partial<MappingShape>;
  return { columns: m.columns ?? [], ...(m.constants ? { constants: m.constants } : {}) };
};

const customFieldKeys = () =>
  new Set(
    registry()
      .customFields.filter((f) => !f.archived_at)
      .map((f) => f.key),
  );

interface Issue {
  field: string | null;
  code: string;
  message: string;
}

/** `checkMapping`: unknown or repeated targets, columns the file lacks, and the essentials a dry run needs. */
function mappingIssues(job: MockImportJob, mapping: MappingShape, options: Options): Issue[] {
  const issues: Issue[] = [];
  const seen = new Map<string, number>();
  const custom = customFieldKeys();
  const headerCount = job.headers?.length ?? null;
  const entity = job.entity_type;
  for (const col of mapping.columns) {
    if (headerCount !== null && col.index >= headerCount) {
      issues.push({
        field: null,
        code: 'column',
        message: `Column ${col.index + 1} is not in the file.`,
      });
    }
    if (!col.target) continue;
    const isCustom = col.target.startsWith('cf:');
    if (isCustom && entity !== 'asset') {
      issues.push({
        field: col.target,
        code: 'target',
        message: 'Custom fields can only be imported into assets.',
      });
    } else if (isCustom && !custom.has(col.target.slice(3))) {
      issues.push({
        field: col.target,
        code: 'target',
        message: `There is no custom field "${col.target.slice(3)}".`,
      });
    } else if (!isCustom && !specOf(entity, col.target)) {
      issues.push({
        field: col.target,
        code: 'target',
        message: `"${col.target}" is not a field of ${entity} imports.`,
      });
    }
    if (seen.has(col.target)) {
      issues.push({
        field: col.target,
        code: 'duplicate',
        message: `Two columns (${seen.get(col.target)! + 1} and ${col.index + 1}) are mapped to ${col.target}.`,
      });
    }
    seen.set(col.target, col.index);
  }
  const consts = mapping.constants ?? {};
  const has = (k: string) => seen.has(k) || k in consts;
  if (entity === 'asset') {
    if (!has('category') && !options.defaults.category) {
      issues.push({
        field: 'category',
        code: 'required',
        message: 'Map a column to Category, or choose a default category.',
      });
    }
    if (!has('asset_tag') && !has('serial') && !has('name') && !has('external_id')) {
      issues.push({
        field: null,
        code: 'required',
        message:
          'Map at least one of asset tag, serial number, name or external id so rows can be told apart.',
      });
    }
  } else if (entity === 'person') {
    if (!has('display_name') && !(has('first_name') || has('last_name')) && !has('email')) {
      issues.push({
        field: 'display_name',
        code: 'required',
        message: 'Map a column to Name (or First/Last name, or Email).',
      });
    }
  } else if (entity === 'location') {
    if (!has('name') && !has('path')) {
      issues.push({
        field: 'name',
        code: 'required',
        message: 'Map a column to Name or to Full path.',
      });
    }
  } else if (!has('name')) {
    issues.push({ field: 'name', code: 'required', message: 'Map a column to Name.' });
  }
  return issues;
}

/** The mapping shape the contract allows (`mappingSchema`): strict keys, 0-based columns, text constants. */
function checkMappingShape(value: unknown): FieldError[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [
      { pointer: '/mapping', message: 'Invalid input: expected object', code: 'invalid_type' },
    ];
  }
  const m = value as Record<string, unknown>;
  const errors: FieldError[] = [];
  for (const key of Object.keys(m)) {
    if (key !== 'columns' && key !== 'constants') {
      errors.push({
        pointer: '/mapping',
        message: `Unrecognized key: "${key}"`,
        code: 'unrecognized_keys',
      });
    }
  }
  if (!Array.isArray(m.columns)) {
    errors.push({
      pointer: '/mapping/columns',
      message: 'Invalid input: expected array',
      code: 'invalid_type',
    });
    return errors;
  }
  m.columns.forEach((col, i) => {
    const c = col as Record<string, unknown> | null;
    const at = `/mapping/columns/${i}`;
    if (typeof c !== 'object' || c === null) {
      errors.push({ pointer: at, message: 'Invalid input: expected object', code: 'invalid_type' });
      return;
    }
    for (const key of Object.keys(c)) {
      if (!['index', 'target', 'date_format'].includes(key)) {
        errors.push({
          pointer: at,
          message: `Unrecognized key: "${key}"`,
          code: 'unrecognized_keys',
        });
      }
    }
    if (!Number.isInteger(c.index) || (c.index as number) < 0 || (c.index as number) > 499) {
      errors.push({
        pointer: `${at}/index`,
        message: 'Invalid input: expected int',
        code: 'invalid_type',
      });
    }
    if (c.target !== null && typeof c.target !== 'string') {
      errors.push({ pointer: `${at}/target`, message: 'Invalid input', code: 'invalid_type' });
    }
    if ('date_format' in c && !['auto', 'iso', 'dmy', 'mdy'].includes(String(c.date_format))) {
      errors.push({
        pointer: `${at}/date_format`,
        message: 'Invalid option',
        code: 'invalid_value',
      });
    }
  });
  return errors;
}

/** `valueMapSchema`: by reference kind, then by normalised value, an `{id}`, `{create: true, name?}` or `{skip: true}`. */
function checkValueMap(value: unknown): FieldError[] {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return [
      { pointer: '/value_map', message: 'Invalid input: expected object', code: 'invalid_type' },
    ];
  }
  const errors: FieldError[] = [];
  for (const [kind, entries] of Object.entries(value)) {
    if (!REF_KINDS.includes(kind as RefKind)) {
      errors.push({
        pointer: `/value_map/${kind}`,
        message: 'Invalid option',
        code: 'invalid_key',
      });
      continue;
    }
    for (const [key, entry] of Object.entries((entries as Record<string, unknown>) ?? {})) {
      const e = entry as Record<string, unknown> | null;
      const ok =
        typeof e === 'object' &&
        e !== null &&
        ((Object.keys(e).length === 1 &&
          typeof e.id === 'string' &&
          /^[0-9a-f-]{36}$/i.test(e.id)) ||
          (e.create === true && Object.keys(e).every((k) => k === 'create' || k === 'name')) ||
          (e.skip === true && Object.keys(e).length === 1));
      if (!ok) {
        errors.push({
          pointer: `/value_map/${kind}/${key}`,
          message: 'Invalid input',
          code: 'invalid_union',
        });
      }
    }
  }
  return errors;
}

// ---- the stored job and its view ---------------------------------------------------------------------------------

const rowsOf = (jobId: string) => w3().importRows.filter((r) => r.job_id === jobId);
const phaseOf = (state: string): 'analyze' | 'dry_run' | 'commit' | null =>
  state === 'analyzing'
    ? 'analyze'
    : state === 'dry_running'
      ? 'dry_run'
      : state === 'committing'
        ? 'commit'
        : null;

/** `progressOf`: the rows of the running phase as a share of the file. */
function progressView(job: MockImportJob) {
  const phase = phaseOf(job.state);
  const total = job.rows_total;
  const processed =
    phase === 'analyze'
      ? 0
      : phase
        ? job.cursor
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

/** `ImportJob`; the heavy members only on a single job (`full`), their content only with `import:run`. */
function jobView(job: MockImportJob, full: boolean, content = true) {
  const parse = job.parse;
  return {
    id: job.id,
    entity_type: job.entity_type,
    source: job.source,
    preset_key: job.preset_key,
    state: job.state,
    filename: job.filename,
    file_attachment_id: job.file_attachment_id,
    parse: {
      format: parse.format ?? null,
      encoding: parse.encoding ?? null,
      delimiter: parse.delimiter ?? null,
      sheet: parse.sheet ?? null,
      sheets: parse.sheets ?? null,
      header_line: parse.header_line ?? null,
    },
    headers: job.headers,
    mapping: job.mapping,
    options: job.options,
    rows_total: job.rows_total,
    counts: {
      dry_run: { ...job.plan },
      commit: { ...job.done },
    },
    progress: progressView(job),
    dry_run_digest: job.dry_run_digest,
    dry_run_at: job.dry_run_at,
    committed_at: job.committed_at,
    started_at: job.started_at,
    finished_at: job.finished_at,
    data_purged_at: job.data_purged_at,
    cancel_requested: job.cancel_requested,
    error: job.error,
    summary: job.summary,
    requested_by: job.requested_by,
    created_at: job.created_at,
    updated_at: job.updated_at,
    ...(full
      ? {
          profile: content
            ? job.profile
            : ((job.profile as Array<Record<string, unknown>> | null)?.map((c) => ({
                ...c,
                samples: [],
              })) ?? null),
          samples: content ? job.samples : null,
          confidence:
            (job.parse.confidence as Record<string, number> | undefined) ?? job.confidence ?? null,
          value_map: content ? job.value_map : {},
        }
      : {}),
  };
}

function oneJob(
  job: MockImportJob,
  content: boolean,
  status = 200,
  headers: Record<string, string> = {},
) {
  return HttpResponse.json(jobView(job, true, content), {
    status,
    headers: { ETag: etagOf(job._v), ...headers },
  });
}

const touch = (job: MockImportJob) => {
  job.updated_at = nowIso();
  job._v += 1;
};

const hex64 = (text: string): string => {
  let out = '';
  for (let round = 0; round < 8; round += 1) {
    let h = (0x811c9dc5 ^ (round * 0x9e3779b1)) >>> 0;
    for (let i = 0; i < text.length; i += 1)
      h = Math.imul(h ^ text.charCodeAt(i), 0x01000193) >>> 0;
    out += h.toString(16).padStart(8, '0');
  }
  return out;
};

// ---- registry lookups (names to records) ---------------------------------------------------------------------------

interface Named {
  id: string;
  name: string;
}

const live = <T extends { archived_at?: string | null }>(list: T[]) =>
  list.filter((x) => !x.archived_at);

function locationLabel(data: RegistryData, id: string): string {
  const byId = new Map(data.locations.map((l) => [l.id, l]));
  const target = byId.get(id);
  if (!target) return '';
  return (target.ancestor_ids?.length ? target.ancestor_ids : [target.id])
    .map((x) => byId.get(x)?.name ?? '')
    .filter(Boolean)
    .join(' > ');
}

function namedList(kind: RefKind): Named[] {
  const data = registry();
  switch (kind) {
    case 'category':
      return live(data.categories)
        .filter((c) => c.kind === 'asset')
        .map((c) => ({ id: c.id, name: c.name }));
    case 'manufacturer':
      return live(data.manufacturers).map((c) => ({ id: c.id, name: c.name }));
    case 'model':
      return live(data.models).map((c) => ({ id: c.id, name: c.name }));
    case 'status':
      return live(data.statusLabels).map((c) => ({ id: c.id, name: c.name }));
    case 'location':
      return live(data.locations).map((c) => ({ id: c.id, name: locationLabel(data, c.id) }));
    case 'department':
      return live(data.departments).map((c) => ({ id: c.id, name: c.name }));
    case 'vendor':
      return live(data.vendors).map((c) => ({ id: c.id, name: c.name }));
    case 'person':
      return live(data.people).map((c) => ({ id: c.id, name: c.display_name }));
  }
}

/** "/Main/Room 101", "Main > Room 101" and "Room 101" are all ways to name a location. */
const pathKey = (text: string) => normKey(text.replace(/^\/+/, '').replace(/\s*[>/]\s*/g, ' > '));

/** The existing record a text names: by name, a location by its path or its (unique) leaf name, a person by email or employee number. */
function findByName(kind: RefKind, text: string): Named | null {
  const list = namedList(kind);
  if (kind === 'location') {
    const wanted = pathKey(text);
    const full = list.find((l) => pathKey(l.name) === wanted);
    if (full) return full;
    const leaves = list.filter((l) => normKey(l.name.split(' > ').pop()) === wanted);
    return leaves.length === 1 ? leaves[0]! : null;
  }
  if (kind === 'person') {
    const key = normKey(text);
    const data = registry();
    const person = live(data.people).find(
      (p) =>
        (key.includes('@') && normKey(p.email) === key) ||
        (!key.includes('@') && p.employee_ref && p.employee_ref.trim() === text.trim()),
    );
    if (person) return { id: person.id, name: person.display_name };
    const same = list.filter((p) => normKey(p.name) === key);
    return same.length === 1 ? same[0]! : null;
  }
  const same = list.filter((x) => normKey(x.name) === normKey(text));
  return same.length === 1 || (same.length > 1 && kind !== 'model') ? same[0]! : null;
}

// ---- reading a row ------------------------------------------------------------------------------------------------------

interface MappedRecord {
  f: Record<string, unknown>;
  r: Record<string, string>;
  c: Record<string, string>;
  b: string[];
}

function mapRow(
  job: MockImportJob,
  raw: string[],
  options: Options,
): { mapped: MappedRecord; issues: Issue[] } {
  const mapping = mappingOf(job);
  const entity = job.entity_type;
  const mapped: MappedRecord = { f: {}, r: {}, c: {}, b: [] };
  const issues: Issue[] = [];
  const issue = (field: string, code: string, message: string) =>
    issues.push({ field, code, message });
  for (const col of mapping.columns) {
    if (!col.target) continue;
    const cell = (raw[col.index] ?? '').trim();
    if (col.target.startsWith('cf:')) {
      if (cell === '') mapped.b.push(col.target);
      else mapped.c[col.target.slice(3)] = cell;
      continue;
    }
    const spec = specOf(entity, col.target);
    if (!spec) continue;
    if (cell === '') {
      mapped.b.push(col.target);
      continue;
    }
    readCell(spec, cell, col.date_format ?? options.date_format, options, mapped, issue);
  }
  for (const [target, text] of Object.entries(mapping.constants ?? {})) {
    const spec = specOf(entity, target);
    if (!spec || target in mapped.r || target in mapped.f) continue;
    if (spec.ref || spec.kind === 'ref') mapped.r[target] = text;
    else mapped.f[target] = text;
  }
  const cost = mapped.f.purchase_cost;
  if (typeof cost === 'number') {
    const currency = String(mapped.f.currency ?? options.default_currency ?? 'USD').toUpperCase();
    mapped.f.purchase_cost = { amount_minor: Math.round(cost * 100), currency };
    delete mapped.f.currency;
  }
  return { mapped, issues };
}

function readCell(
  spec: FieldSpec,
  cell: string,
  dateFormat: DateFormat,
  options: Options,
  mapped: MappedRecord,
  issue: (field: string, code: string, message: string) => void,
): void {
  const key = spec.key;
  switch (spec.kind) {
    case 'ref':
    case 'path':
      if (spec.ref) mapped.r[key] = cell;
      else mapped.f[key] = cell;
      break;
    case 'date': {
      const result = readDate(cell, dateFormat);
      if ('iso' in result) mapped.f[key] = result.iso;
      else if (result.error === 'ambiguous-date') {
        issue(
          key,
          'ambiguous-date',
          `"${cell}" could be day/month or month/day. Choose a date format for this column.`,
        );
      } else issue(key, 'date', `"${cell}" is not a date.`);
      break;
    }
    case 'money':
    case 'number':
    case 'integer': {
      const n = readNumber(cell, options.number_format);
      if (n === null || (spec.kind === 'integer' && !Number.isInteger(n))) {
        issue(key, 'number', `"${cell}" is not a number.`);
      } else mapped.f[key] = n;
      break;
    }
    case 'enum': {
      const wanted = cell.toLowerCase();
      if (spec.values && !spec.values.includes(wanted)) {
        issue(key, 'enum', `"${cell}" is not one of ${spec.values.join(', ')}.`);
      } else mapped.f[key] = wanted;
      break;
    }
    case 'email':
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cell))
        issue(key, 'invalid', `"${cell}" is not an email address.`);
      else mapped.f[key] = cell;
      break;
    default:
      mapped.f[key] = cell;
  }
}

// ---- reference resolution -----------------------------------------------------------------------------------------------

type Resolution =
  | { kind: 'found'; id: string; name: string }
  | { kind: 'create'; name: string }
  | { kind: 'none' }
  | { kind: 'missing' };

function resolveRef(job: MockImportJob, options: Options, kind: RefKind, text: string): Resolution {
  const entry = (job.value_map[kind] as Record<string, Record<string, unknown>> | undefined)?.[
    normKey(text)
  ];
  if (entry) {
    if (typeof entry.id === 'string') {
      const hit = namedList(kind).find((n) => n.id === entry.id);
      return hit ? { kind: 'found', id: hit.id, name: hit.name } : { kind: 'missing' };
    }
    if (entry.skip === true) return { kind: 'none' };
    if (entry.create === true) {
      if (kind === 'status') return { kind: 'missing' };
      const name =
        typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : text.trim();
      const hit = findByName(kind, name);
      return hit ? { kind: 'found', id: hit.id, name: hit.name } : { kind: 'create', name };
    }
  }
  const hit = findByName(kind, text);
  if (hit) return { kind: 'found', id: hit.id, name: hit.name };
  if (kind !== 'status' && policyOf(options, kind) === 'create')
    return { kind: 'create', name: text.trim() };
  return { kind: 'missing' };
}

/** The record that already exists for this row (an asset by tag or serial, a person by email ...), and the key it is told apart by. */
function matchExisting(
  job: MockImportJob,
  options: Options,
  mapped: MappedRecord,
): {
  /** The keys that tell this row from the others of the file (tag and serial are independent keys). */
  keys: string[];
  existing: { id: string; label: string; version: number } | null;
  ambiguous: boolean;
} {
  const data = registry();
  const f = mapped.f;
  switch (job.entity_type) {
    case 'asset': {
      const tag = normKey(String(f.asset_tag ?? ''));
      const serial = normKey(String(f.serial ?? ''));
      const ext = normKey(String(f.external_id ?? ''));
      const byTag = tag ? live(data.assets).find((a) => normKey(a.asset_tag) === tag) : undefined;
      const bySerial = serial
        ? live(data.assets).find((a) => normKey(a.serial) === serial)
        : undefined;
      const byExt = ext
        ? live(data.assets).find(
            (a) => normKey((a as { external_id?: string | null }).external_id) === ext,
          )
        : undefined;
      const mode = options.match_on === 'auto' ? (tag ? 'asset_tag' : 'serial') : options.match_on;
      const hit = mode === 'asset_tag' ? byTag : mode === 'serial' ? bySerial : byExt;
      const ambiguous =
        options.match_on === 'auto' && !!byTag && !!bySerial && byTag.id !== bySerial.id;
      return {
        keys: [tag && `tag:${tag}`, serial && `serial:${serial}`, ext && `ext:${ext}`].filter(
          Boolean,
        ) as string[],
        existing: hit ? { id: hit.id, label: hit.asset_tag, version: hit._v } : null,
        ambiguous,
      };
    }
    case 'person': {
      const email = normKey(String(f.email ?? ''));
      const ref = String(f.employee_ref ?? '').trim();
      const hit = live(data.people).find(
        (p) => (email && normKey(p.email) === email) || (!email && ref && p.employee_ref === ref),
      );
      return {
        keys: [email && `email:${email}`, ref && `ref:${ref.toLowerCase()}`].filter(
          Boolean,
        ) as string[],
        existing: hit ? { id: hit.id, label: hit.display_name, version: hit._v } : null,
        ambiguous: false,
      };
    }
    case 'location': {
      const path = locationPathOf(f);
      const hit = path ? findByName('location', path) : null;
      return {
        keys: path ? [`location:${pathKey(path)}`] : [],
        existing: hit ? { id: hit.id, label: hit.name, version: 1 } : null,
        ambiguous: false,
      };
    }
    case 'department': {
      const name = normKey(String(f.name ?? ''));
      const hit = live(data.departments).find((d) => normKey(d.name) === name);
      return {
        keys: name ? [`department:${name}`] : [],
        existing: hit ? { id: hit.id, label: hit.name, version: hit._v } : null,
        ambiguous: false,
      };
    }
  }
}

function locationPathOf(f: Record<string, unknown>): string {
  const path = typeof f.path === 'string' ? f.path : '';
  if (path) return path;
  const parent = typeof f.parent_path === 'string' ? f.parent_path : '';
  const name = typeof f.name === 'string' ? f.name : '';
  return parent && name ? `${parent} > ${name}` : name;
}

// ---- the dry run ------------------------------------------------------------------------------------------------------------

/** What `ENTITY_REFS`-kind each mapped target of the entity is, as it is read from the typed record. */
function refTargets(job: MockImportJob): Array<{ target: string; kind: RefKind }> {
  const out: Array<{ target: string; kind: RefKind }> = [];
  for (const spec of FIELD_SPECS[job.entity_type]) {
    if (spec.ref && spec.key !== 'parent_path') out.push({ target: spec.key, kind: spec.ref });
  }
  return out;
}

function planRows(job: MockImportJob): void {
  const options = optionsOf(job);
  const rows = rowsOf(job.id);
  const seen = new Map<string, number>();
  for (const row of rows) {
    const { mapped, issues } = mapRow(job, row.raw, options);
    const errors: Issue[] = issues.filter((i) => i.code !== 'will-create');
    const warnings: Issue[] = [];
    // references
    const record: Record<string, unknown> = { ...mapped.f };
    const refs: Record<string, unknown> = {};
    for (const { target, kind } of refTargets(job)) {
      const text = mapped.r[target];
      const fallback = DEFAULT_KEYS.includes(target)
        ? (target as keyof Options['defaults'])
        : undefined;
      if (!text) {
        const id = fallback ? options.defaults[fallback] : undefined;
        if (id) refs[target] = { id };
        continue;
      }
      const res = resolveRef(job, options, kind, text);
      if (res.kind === 'found') refs[target] = { id: res.id, name: res.name };
      else if (res.kind === 'create') {
        refs[target] = { create: res.name };
        warnings.push({
          field: target,
          code: 'will-create',
          message: `${REF_LABEL[kind]} "${res.name}" will be created.`,
        });
      } else if (res.kind === 'missing') {
        errors.push({
          field: target,
          code: 'not-found',
          message: `${REF_LABEL[kind]} "${text}" does not exist.`,
        });
      }
    }
    // the essentials of the row
    const required = (field: string, message: string) =>
      errors.push({ field, code: 'required', message });
    if (job.entity_type === 'asset' && !refs.category)
      required('category', 'Category is required.');
    if (
      job.entity_type === 'person' &&
      !record.display_name &&
      !record.first_name &&
      !record.last_name &&
      !record.email
    ) {
      required('display_name', 'Name is required.');
    }
    if (job.entity_type === 'location' && !record.name && !record.path)
      required('name', 'Name is required.');
    if (job.entity_type === 'department' && !record.name) required('name', 'Name is required.');

    const match = matchExisting(job, options, mapped);
    let plan: NonNullable<MockImportRow['plan']> = 'create';
    let dupOf: number | null = null;
    let entityId: string | null = null;
    let entityVersion: number | null = null;
    if (match.ambiguous) {
      errors.push({
        field: 'asset_tag',
        code: 'ambiguous',
        message: 'The tag and the serial number name different assets.',
      });
    }
    for (const key of match.keys) {
      const first = seen.get(key);
      if (first === undefined) seen.set(key, row.row_no);
      else if (dupOf === null || first < dupOf) dupOf = first;
    }
    if (errors.length > 0) plan = 'error';
    else if (dupOf !== null && options.on_match !== 'update') {
      if (options.on_match === 'error') {
        plan = 'error';
        errors.push({
          field: null,
          code: 'duplicate-in-file',
          message: `Repeats row ${dupOf} of the file.`,
        });
      } else {
        plan = 'skip';
        warnings.push({
          field: null,
          code: 'duplicate-in-file',
          message: `Repeats row ${dupOf} of the file; skipped.`,
        });
      }
    } else if (match.existing) {
      entityId = match.existing.id;
      entityVersion = match.existing.version;
      if (options.on_match === 'update') plan = 'update';
      else if (options.on_match === 'error') {
        plan = 'error';
        errors.push({
          field: null,
          code: 'exists',
          message: `${match.existing.label} exists already.`,
        });
      } else {
        plan = 'skip';
        warnings.push({
          field: null,
          code: 'exists',
          message: `${match.existing.label} exists already; skipped.`,
        });
      }
    }
    row.mapped = { ...mapped, refs } as unknown as Record<string, unknown>;
    row.plan = plan;
    row.errors = errors;
    row.warnings = plan === 'error' ? warnings.filter((w) => w.code !== 'will-create') : warnings;
    row.entity_id = entityId;
    row.entity_version = entityVersion;
    row.dup_of = dupOf;
  }
}

function finishDryRun(job: MockImportJob): void {
  planRows(job);
  const rows = rowsOf(job.id);
  const n = (plan: string) => rows.filter((r) => r.plan === plan).length;
  job.plan = { create: n('create'), update: n('update'), skip: n('skip'), error: n('error') };
  const byCode = new Map<string, { code: string; field: string | null; n: number }>();
  const willCreate = new Map<string, { field: string | null; message: string; n: number }>();
  for (const row of rows) {
    if (row.plan === 'error') {
      for (const e of row.errors) {
        const k = `${e.code}|${e.field}`;
        byCode.set(k, { code: e.code, field: e.field, n: (byCode.get(k)?.n ?? 0) + 1 });
      }
    }
    if (row.plan === 'create' || row.plan === 'update') {
      for (const w of row.warnings.filter((x) => x.code === 'will-create')) {
        const k = `${w.field}|${w.message}`;
        willCreate.set(k, {
          field: w.field,
          message: w.message,
          n: (willCreate.get(k)?.n ?? 0) + 1,
        });
      }
    }
  }
  const setup = (job.summary as { setup?: unknown } | null)?.setup;
  job.summary = {
    counts: { ...job.plan },
    errors_by_code: [...byCode.values()].sort((a, b) => b.n - a.n).slice(0, 50),
    will_create: [...willCreate.values()].sort((a, b) => b.n - a.n).slice(0, 200),
    ...(setup ? { setup } : {}),
  };
  job.dry_run_digest = hex64(
    JSON.stringify({
      file: job.file_text?.length ?? 0,
      parse: job.parse,
      mapping: job.mapping,
      options: job.options,
      value_map: job.value_map,
      rows: job.rows_total,
      plan: job.plan,
      rowDigest: rows.map((r) => `${r.row_no}:${r.plan}:${r.entity_id ?? ''}`).join(','),
    }),
  );
  job.dry_run_at = nowIso();
  job.state = 'dry_run_done';
  job.cursor = job.rows_total;
  job.phase_started_at = null;
  job.error = null;
  touch(job);
}

// ---- the commit -----------------------------------------------------------------------------------------------------------------

function ensureReference(
  data: RegistryData,
  kind: RefKind,
  name: string,
  scope: { categoryId?: string | null; locationKind?: string },
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
      } as never);
      return id;
    }
    case 'manufacturer': {
      const id = newResourceId('manufacturer');
      data.manufacturers.push({ ...base, id, name } as never);
      return id;
    }
    case 'location': {
      const parts = name
        .replace(/^\/+/, '')
        .split(/\s*[>/]\s*/)
        .filter(Boolean);
      let parentId: string | null = null;
      let ancestors: string[] = [];
      for (const [i, part] of parts.entries()) {
        const existing = data.locations.find(
          (l) =>
            !l.archived_at &&
            (l.parent_id ?? null) === parentId &&
            normKey(l.name) === normKey(part),
        );
        if (existing) {
          parentId = existing.id;
          ancestors = existing.ancestor_ids?.length ? [...existing.ancestor_ids] : [existing.id];
          continue;
        }
        const id = newResourceId('location');
        ancestors = [...ancestors, id];
        data.locations.push({
          ...base,
          id,
          name: part,
          kind: i === parts.length - 1 ? (scope.locationKind ?? 'other') : 'other',
          code: null,
          parent_id: parentId,
          depth: ancestors.length - 1,
          ancestor_ids: ancestors,
        } as never);
        parentId = id;
      }
      return parentId;
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
      } as never);
      return id;
    }
    case 'vendor': {
      const id = newResourceId('vendor');
      data.vendors.push({ ...base, id, name } as never);
      return id;
    }
    case 'model': {
      const id = newResourceId('model');
      data.models.push({
        ...base,
        id,
        name,
        category_id: scope.categoryId ?? data.categories[0]!.id,
      } as never);
      return id;
    }
    case 'person': {
      const id = newResourceId('person');
      data.people.push({
        ...base,
        id,
        kind: 'employee',
        display_name: name,
        first_name: null,
        last_name: null,
        email: null,
        phone: null,
        employee_ref: null,
        department_id: null,
        job_title: null,
        location_id: null,
        status: 'active',
        notes: null,
        user_id: null,
      } as never);
      return id;
    }
    default:
      return null;
  }
}

interface RowOutcome {
  result: 'created' | 'updated' | 'error';
  errors: Issue[];
  createdId: string | null;
  entityId: string | null;
  before: Record<string, unknown> | null;
}

function applyRow(job: MockImportJob, row: MockImportRow, data: RegistryData): RowOutcome {
  const options = optionsOf(job);
  const mapped = row.mapped as unknown as MappedRecord & {
    refs: Record<string, { id?: string; create?: string }>;
  };
  const f = mapped.f;
  const stamp = nowIso();
  const refId = (
    target: string,
    kind: RefKind,
    categoryId: string | null = null,
  ): string | null => {
    const ref = mapped.refs[target];
    if (!ref) return null;
    if (ref.id) return ref.id;
    return ref.create
      ? ensureReference(data, kind, ref.create, { categoryId, locationKind: options.location_kind })
      : null;
  };
  const fail = (code: string, message: string): RowOutcome => ({
    result: 'error',
    errors: [{ field: null, code, message }],
    createdId: null,
    entityId: null,
    before: null,
  });
  const updating = row.plan === 'update';
  const existingId = updating ? row.entity_id : null;
  const findAsset = () => data.assets.find((a) => a.id === existingId);
  const findPerson = () => data.people.find((p) => p.id === existingId);
  const findDept = () => data.departments.find((d) => d.id === existingId);
  const current =
    job.entity_type === 'asset'
      ? findAsset()
      : job.entity_type === 'person'
        ? findPerson()
        : job.entity_type === 'department'
          ? findDept()
          : undefined;
  if (
    updating &&
    options.detect_changes &&
    current &&
    row.entity_version !== null &&
    current._v !== row.entity_version
  ) {
    return fail('changed-since-dry-run', 'Changed since the dry run; the record was left alone.');
  }
  const blank = (target: string) => options.blank_cells === 'clear' && mapped.b.includes(target);
  switch (job.entity_type) {
    case 'asset': {
      const categoryId = refId('category', 'category') ?? findAsset()?.category_id ?? null;
      if (!categoryId) return fail('required', 'Category is required.');
      const status =
        refId('status', 'status') ??
        findAsset()?.status_id ??
        data.statusLabels.find((s) => s.state_type === 'deployable' && s.is_default)?.id ??
        data.statusLabels.find((s) => s.state_type === 'deployable')!.id;
      const existing = findAsset();
      const target: MockAsset = existing ?? ({} as MockAsset);
      const before = existing
        ? { name: existing.name, serial: existing.serial, notes: existing.notes }
        : null;
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
          (f.asset_tag as string | undefined) ||
          target.asset_tag ||
          `IMP-${String(data.assets.length + 1).padStart(5, '0')}`,
        serial:
          (f.serial as string | undefined) || (blank('serial') ? null : (target.serial ?? null)),
        name: (f.name as string | undefined) || (blank('name') ? null : (target.name ?? null)),
        category_id: categoryId,
        model_id: refId('model', 'model', categoryId) ?? target.model_id ?? null,
        status_id: status,
        location_id: refId('location', 'location') ?? target.location_id ?? null,
        department_id: refId('department', 'department') ?? target.department_id ?? null,
        vendor_id: refId('vendor', 'vendor') ?? target.vendor_id ?? null,
        purchase_date: (f.purchase_date as string | undefined) ?? target.purchase_date ?? null,
        order_number: (f.order_number as string | undefined) || target.order_number || null,
        notes: (f.notes as string | undefined) || (blank('notes') ? null : (target.notes ?? null)),
      });
      target._v += 1;
      target.custom_data = { ...(target.custom_data ?? {}), ...mapped.c } as never;
      if (!existing) data.assets.push(target);
      data.history.push({
        id: newResourceId('history'),
        asset_id: target.id,
        at: stamp,
        event_type: existing ? 'updated' : 'imported',
        actor_type: 'user',
        actor_id: job.requested_by,
        assignment_id: null,
        transfer_id: null,
        summary: existing
          ? `Updated by import ${job.filename ?? ''}`.trim()
          : `Imported from ${job.filename ?? 'a file'}`,
        payload: { import_job_id: job.id, import_row: row.row_no },
      } as never);
      return {
        result: existing ? 'updated' : 'created',
        errors: [],
        createdId: existing ? null : target.id,
        entityId: target.id,
        before,
      };
    }
    case 'person': {
      const existing = findPerson();
      if (existing) {
        const before = { display_name: existing.display_name, email: existing.email };
        Object.assign(existing, {
          updated_at: stamp,
          display_name: (f.display_name as string | undefined) || existing.display_name,
          email: (f.email as string | undefined) || existing.email,
          phone: (f.phone as string | undefined) || existing.phone,
          job_title: (f.job_title as string | undefined) || existing.job_title,
          department_id: refId('department', 'department') ?? existing.department_id,
          location_id: refId('location', 'location') ?? existing.location_id,
        });
        existing._v += 1;
        return { result: 'updated', errors: [], createdId: null, entityId: existing.id, before };
      }
      const id = newResourceId('person');
      const display =
        (f.display_name as string | undefined) ||
        [f.first_name, f.last_name].filter(Boolean).join(' ') ||
        String(f.email ?? '');
      data.people.push({
        id,
        created_at: stamp,
        updated_at: stamp,
        archived_at: null,
        kind: (PERSON_KINDS as readonly string[]).includes(String(f.kind)) ? f.kind : 'employee',
        display_name: display,
        first_name: (f.first_name as string | undefined) ?? null,
        last_name: (f.last_name as string | undefined) ?? null,
        email: (f.email as string | undefined) ?? null,
        phone: (f.phone as string | undefined) ?? null,
        employee_ref: (f.employee_ref as string | undefined) ?? null,
        department_id: refId('department', 'department'),
        job_title: (f.job_title as string | undefined) ?? null,
        location_id: refId('location', 'location'),
        status: (PERSON_STATUSES as readonly string[]).includes(String(f.status))
          ? f.status
          : 'active',
        notes: (f.notes as string | undefined) ?? null,
        user_id: null,
        _v: 1,
      } as never);
      return { result: 'created', errors: [], createdId: id, entityId: id, before: null };
    }
    case 'location': {
      const path = locationPathOf(f);
      if (updating) {
        return {
          result: 'updated',
          errors: [],
          createdId: null,
          entityId: row.entity_id,
          before: {},
        };
      }
      const id = ensureReference(data, 'location', path, {
        locationKind: String(f.kind ?? options.location_kind),
      });
      return { result: 'created', errors: [], createdId: id, entityId: id, before: null };
    }
    case 'department': {
      const existing = findDept();
      if (existing) {
        const before = { name: existing.name, code: existing.code };
        Object.assign(existing, {
          updated_at: stamp,
          code: (f.code as string | undefined) || existing.code,
          description: (f.description as string | undefined) || existing.description,
        });
        existing._v += 1;
        return { result: 'updated', errors: [], createdId: null, entityId: existing.id, before };
      }
      const id = ensureReference(data, 'department', String(f.name), {});
      const dept = data.departments.find((d) => d.id === id);
      if (dept) {
        dept.code = (f.code as string | undefined) ?? null;
        dept.description = (f.description as string | undefined) ?? null;
      }
      return { result: 'created', errors: [], createdId: id, entityId: id, before: null };
    }
  }
}

// ---- the worker: a job moves along when it is read -----------------------------------------------------------------------

/** An uploaded file that has passed its scan, as `GET /v1/attachments/{id}` would say (advances the simulated scanner). */
function scanState(id: string): 'pending' | 'clean' | 'infected' | 'error' | 'missing' {
  const attachment = registry().attachments.find((a) => a.id === id && !a.archived_at);
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

const failJob = (job: MockImportJob, message: string) => {
  job.state = 'failed';
  job.error = message.slice(0, 1000);
  job.finished_at = nowIso();
  job.phase_started_at = null;
  touch(job);
};

/** The sheet a spreadsheet upload stands for: this mock reads no `.xlsx`, so it gets the preset's template rows. */
function spreadsheetSample(job: MockImportJob) {
  const preset =
    (job.preset_key ? presetOf(job.preset_key) : undefined) ??
    PRESETS.find((p) => p.entity_type === job.entity_type && p.source === 'csv')!;
  const [headers, ...rows] = templateRows(preset, []);
  return {
    headers: headers!,
    rows,
    lines: rows.map((_, i) => i + 2),
    delimiter: null as string | null,
    headerLine: 1,
  };
}

function analyse(job: MockImportJob): void {
  const attId = job.file_attachment_id;
  const scan = attId ? scanState(attId) : 'missing';
  if (scan === 'pending') return; // the job stays "analyzing" until the scan answers
  if (scan === 'infected') return failJob(job, 'The file was rejected by the virus scan.');
  if (scan === 'error' || scan === 'missing') return failJob(job, 'The uploaded file is gone.');
  const spreadsheet = job.source === 'xlsx';
  let file: ReturnType<typeof spreadsheetSample>;
  try {
    if (spreadsheet) file = spreadsheetSample(job);
    else {
      const overrides = job.parse;
      const parsed = parseCsv(job.file_text ?? '', {
        ...(typeof overrides.delimiter === 'string' ? { delimiter: overrides.delimiter } : {}),
        ...(typeof overrides.header_line === 'number' ? { headerLine: overrides.header_line } : {}),
      });
      file = { ...parsed };
    }
  } catch (err) {
    return failJob(job, err instanceof Error ? err.message : 'The file could not be read.');
  }
  if (file.rows.length > 100_000) {
    return failJob(
      job,
      'The file has more than 100,000 data rows, which is the most one import takes.',
    );
  }
  const custom = live(registry().customFields).map((x) => ({ key: x.key, label: x.label }));
  const suggestions = suggestMapping(job.entity_type, file.headers, custom);
  const profile = profileOf(file.headers, file.rows);
  let mapping: MappingShape = {
    columns: suggestions.map((s) => {
      const order = profile[s.index]?.date_order;
      return {
        index: s.index,
        target: s.target,
        ...(s.target && (order === 'dmy' || order === 'mdy') ? { date_format: order } : {}),
      };
    }),
  };
  let options = job.options;
  let valueMap = job.value_map;
  const preset = job.preset_key ? presetOf(job.preset_key) : undefined;
  if (preset) {
    const applied = applyPreset(preset, file.headers, mapping, file.rows);
    mapping = applied.mapping;
    options = { ...preset.options, ...job.options };
    valueMap = { ...applied.valueMap, ...job.value_map };
  }
  job.rows_total = file.rows.length;
  job.headers = file.headers;
  job.profile = profile;
  job.samples = file.rows.slice(0, 50).map((r) => file.headers.map((_, i) => r[i] ?? ''));
  job.confidence = Object.fromEntries(suggestions.map((s) => [String(s.index), s.confidence]));
  job.parse = {
    format: spreadsheet ? 'xlsx' : 'csv',
    encoding: spreadsheet ? null : 'utf-8',
    delimiter: file.delimiter,
    sheet: spreadsheet ? 'Sheet1' : null,
    sheets: spreadsheet ? ['Sheet1'] : null,
    header_line: file.headerLine,
    confidence: job.confidence,
  };
  job.mapping = mapping as unknown as Record<string, unknown>;
  job.options = options;
  job.value_map = valueMap;
  job.plan = { create: 0, update: 0, skip: 0, error: 0 };
  job.done = { created: 0, updated: 0, skipped: 0, error: 0 };
  job.dry_run_digest = null;
  job.cursor = 0;
  job.error = null;
  job.state = 'analyzed';
  job.phase_started_at = null;
  mutateW3((data) => {
    data.importRows = data.importRows.filter((r) => r.job_id !== job.id);
    data.importRows.push(
      ...file.rows.map((raw, i): MockImportRow => ({
        job_id: job.id,
        row_no: i + 1,
        line_no: file.lines[i] ?? i + 2,
        raw: file.headers.map((_, c) => raw[c] ?? ''),
        mapped: null,
        plan: null,
        errors: [],
        warnings: [],
        entity_id: null,
        entity_version: null,
        dup_of: null,
        result: null,
        result_errors: null,
        created_id: null,
        before_image: null,
      })),
    );
  });
  touch(job);
}

/** The preset's header recognition: every preset column whose header matches is mapped, the rest keeps the heuristic. */
function applyPreset(
  preset: Preset,
  headers: readonly string[],
  suggested: MappingShape,
  rows: readonly string[][],
) {
  const columns: MappingColumn[] = headers.map((_, index) => ({ index, target: null }));
  const used = new Set<string>();
  headers.forEach((h, index) => {
    const hit = preset.columns.find(
      (col) => !used.has(col.target) && col.headers.some((x) => looseKey(x) === looseKey(h)),
    );
    if (hit) {
      columns[index]!.target = hit.target;
      used.add(hit.target);
    }
  });
  for (const s of suggested.columns) {
    const mine = columns[s.index]!;
    if (
      !mine.target &&
      s.target &&
      !used.has(s.target) &&
      !(preset.constants && s.target in preset.constants)
    ) {
      mine.target = s.target;
      used.add(s.target);
      if (s.date_format) mine.date_format = s.date_format;
    }
  }
  const mapping: MappingShape = {
    columns,
    ...(preset.constants ? { constants: { ...preset.constants } } : {}),
  };
  const valueMap: Record<string, Record<string, unknown>> = {};
  const statusColumn = columns.find((c) => c.target === 'status');
  if (preset.statusHints && statusColumn) {
    const labels = live(registry().statusLabels);
    const entries: Record<string, { id: string }> = {};
    for (const value of new Set(
      rows.map((r) => (r[statusColumn.index] ?? '').trim()).filter(Boolean),
    )) {
      const wanted = preset.statusHints[normKey(value)];
      if (!wanted) continue;
      const label =
        (wanted === 'deployable'
          ? labels.find((l) => l.is_default && l.state_type === 'deployable')
          : undefined) ?? labels.find((l) => l.state_type === wanted);
      if (label) entries[normKey(value)] = { id: label.id };
    }
    if (Object.keys(entries).length > 0) valueMap.status = entries;
  }
  return { mapping, valueMap };
}

/** The batch the clock says a running phase has reached. */
function batchesDone(job: MockImportJob): number {
  if (!job.phase_started_at) return 0;
  const running = Date.now() - job.phase_started_at - timing.start;
  return running < 0 ? 0 : Math.floor(running / timing.batchMs) + 1;
}

/** A cancel finishes the batch in flight, then stops: the batches that may still complete once it was asked. */
const cancelLimit = (job: MockImportJob) =>
  job.cancel_requested ? job.cancel_batches + 1 : Number.POSITIVE_INFINITY;

function dryStep(job: MockImportJob): void {
  const batches = batchesDone(job);
  if (batches === 0) return;
  if (job.cancel_requested && batches >= cancelLimit(job)) {
    job.state = 'cancelled';
    job.cancel_requested = false;
    job.finished_at = nowIso();
    job.phase_started_at = null;
    touch(job);
    return;
  }
  const processed = Math.min(job.rows_total, batches * timing.dryBatchRows);
  if (processed >= job.rows_total) {
    finishDryRun(job);
    return;
  }
  job.cursor = processed;
}

function commitStep(job: MockImportJob): void {
  const batches = batchesDone(job);
  if (batches === 0) return;
  const rows = rowsOf(job.id);
  const writable = rows.filter((r) => r.plan === 'create' || r.plan === 'update');
  if (job.cursor === 0 && batches > 0) {
    // rows the dry run decided not to write are finished at once
    for (const row of rows) {
      if (row.plan === 'skip') row.result = 'skipped';
      else if (row.plan === 'error') {
        row.result = 'error';
        row.result_errors = row.errors;
      }
    }
  }
  const target = Math.min(writable.length, Math.min(batches, cancelLimit(job)) * timing.batchRows);
  if (target > job.cursor) {
    mutateRegistry((data) => {
      for (const row of writable.slice(job.cursor, target)) {
        const outcome = applyRow(job, row, data);
        row.result = outcome.result;
        row.result_errors = outcome.errors.length > 0 ? outcome.errors : null;
        row.created_id = outcome.createdId;
        row.before_image = outcome.before;
        if (outcome.result === 'created') job.done.created += 1;
        else if (outcome.result === 'updated') job.done.updated += 1;
        else job.done.error += 1;
      }
    });
    job.cursor = target;
  }
  if (job.cursor >= writable.length) {
    const count = (res: string) => rows.filter((r) => r.result === res).length;
    job.done = {
      created: count('created'),
      updated: count('updated'),
      skipped: count('skipped'),
      error: count('error'),
    };
    job.state = 'completed';
    job.committed_at = nowIso();
    job.finished_at = nowIso();
    job.cursor = job.rows_total;
    job.phase_started_at = null;
    touch(job);
    return;
  }
  if (job.cancel_requested && batches >= cancelLimit(job)) {
    job.state = 'cancelled';
    job.cancel_requested = false;
    job.finished_at = nowIso();
    job.phase_started_at = null;
    touch(job);
  }
}

/** ED-25: after the retention period the rows, profile, samples, value map and file of a finished import are removed. */
function purgeIfDue(job: MockImportJob): void {
  if (job.data_purged_at || !job.finished_at) return;
  if (!['completed', 'failed', 'cancelled'].includes(job.state)) return;
  if (Date.now() - Date.parse(job.finished_at) <= RETENTION_DAYS * DAY_MS) return;
  mutateW3((data) => {
    data.importRows = data.importRows.filter((r) => r.job_id !== job.id);
  });
  job.profile = null;
  job.samples = null;
  job.value_map = {};
  job.file_text = null;
  job.file_attachment_id = null;
  job.data_purged_at = nowIso();
  touch(job);
}

function advance(job: MockImportJob): void {
  purgeIfDue(job);
  if (job.state === 'analyzing') {
    if (job.phase_started_at && Date.now() - job.phase_started_at >= timing.analyze) {
      mutateW3(() => analyse(job));
    }
  } else if (job.state === 'dry_running') mutateW3(() => dryStep(job));
  else if (job.state === 'committing') mutateW3(() => commitStep(job));
}

const jobOr404 = (id: string | readonly string[] | undefined) => {
  const job = w3().importJobs.find((j) => j.id === id);
  if (job) advance(job);
  return job;
};

const canRun = (user: { permissions: readonly string[] }) =>
  hasPermission(user.permissions, 'import:run');

/** `assertMayRun`: what the caller needs on top of `import:run` for this job (the entity's write permission ...). */
function missingPermissions(
  user: { permissions: readonly string[] },
  job: MockImportJob,
): string[] {
  const options = optionsOf(job);
  const need = new Set<string>([WRITE_PERMISSION[job.entity_type]]);
  if (options.on_match === 'update' && job.entity_type === 'asset') need.add('asset:update');
  const mapping = mappingOf(job);
  const targets = new Set(mapping.columns.map((c) => c.target));
  const consts = Object.keys(mapping.constants ?? {});
  for (const kind of ENTITY_REFS[job.entity_type]) {
    const target = REF_TARGET[job.entity_type][kind];
    const used =
      !!target &&
      (targets.has(target) ||
        consts.includes(target) ||
        (options.defaults as Record<string, unknown>)[kind] !== undefined);
    if (!used || policyOf(options, kind) !== 'create') continue;
    const perm = CREATE_PERMISSION[kind];
    if (perm) need.add(perm);
  }
  if (job.entity_type === 'asset' && options.assign && targets.has('assigned_to'))
    need.add('asset:checkout');
  return [...need].filter((p) => !hasPermission(user.permissions, p));
}

function capacity(job: MockImportJob) {
  const running = w3().importJobs.filter(
    (j) => j.id !== job.id && RUNNING.includes(j.state),
  ).length;
  return running >= MAX_CONCURRENT ? quotaExceeded(running) : null;
}

// ---- presets and template files ---------------------------------------------------------------------------------------------

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function presetView(p: Preset) {
  return {
    key: p.key,
    label: p.label,
    description: p.description,
    entity_type: p.entity_type,
    source: p.source,
    notes: p.notes,
    sets_up: p.setup
      ? { category: p.setup.category, custom_fields: p.setup.customFields.map((x) => x.key) }
      : null,
    columns: dictionary(p),
  };
}

/** `ensureSetup`: the Chromebook category and its custom fields, made when the import is created. */
function ensureSetup(preset: Preset, user: { permissions: readonly string[] }) {
  const setup = preset.setup!;
  const data = registry();
  const category = data.categories.find(
    (c) => c.kind === 'asset' && !c.archived_at && normKey(c.name) === normKey(setup.category),
  );
  const have = new Set(
    category
      ? data.customFields
          .filter((f) => f.category_id === category.id && !f.archived_at)
          .map((f) => f.key)
      : [],
  );
  const missing = setup.customFields.filter((x) => !have.has(x.key));
  if ((!category || missing.length > 0) && !hasPermission(user.permissions, 'catalog:manage')) {
    return {
      error: forbidden(
        `The ${setup.category} category and its custom fields do not exist yet; creating them needs the catalog:manage permission.`,
      ),
    };
  }
  let created = false;
  mutateRegistry((reg) => {
    let categoryId = category?.id;
    if (!categoryId) {
      categoryId = ensureReference(reg, 'category', setup.category, {})!;
      created = true;
    }
    const stamp = nowIso();
    for (const x of missing) {
      reg.customFields.push({
        id: newResourceId('field'),
        category_id: categoryId,
        key: x.key,
        label: x.label,
        data_type: x.data_type,
        required: false,
        options: null,
        validation: null,
        help_text: null,
        position: reg.customFields.length + 1,
        show_in_list: false,
        archived_at: null,
        created_at: stamp,
        updated_at: stamp,
        _v: 1,
      } as never);
    }
  });
  return { setup: { category_created: created, custom_fields_created: missing.map((x) => x.key) } };
}

// ---- saved mapping templates -------------------------------------------------------------------------------------------------

function templateView(t: MockMappingTemplate) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    entity_type: t.entity_type,
    columns: t.columns,
    options: t.options,
    created_at: t.created_at,
    updated_at: t.updated_at,
    created_by: t.created_by,
  };
}

const oneTemplate = (t: MockMappingTemplate, status = 200, headers: Record<string, string> = {}) =>
  HttpResponse.json(templateView(t), { status, headers: { ETag: etagOf(t._v), ...headers } });

function checkTemplateColumns(value: unknown): FieldError[] {
  if (!Array.isArray(value)) {
    return [
      { pointer: '/columns', message: 'Invalid input: expected array', code: 'invalid_type' },
    ];
  }
  return value.flatMap((col, i): FieldError[] => {
    const c = col as Record<string, unknown> | null;
    const at = `/columns/${i}`;
    if (typeof c !== 'object' || c === null) {
      return [{ pointer: at, message: 'Invalid input: expected object', code: 'invalid_type' }];
    }
    const errors: FieldError[] = [];
    if (typeof c.header !== 'string' || !c.header.trim()) {
      errors.push({
        pointer: `${at}/header`,
        message: 'Too small: expected string to have >=1 characters',
        code: 'too_small',
      });
    }
    if (c.target !== null && typeof c.target !== 'string') {
      errors.push({ pointer: `${at}/target`, message: 'Invalid input', code: 'invalid_type' });
    }
    return errors;
  });
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// ---- handlers ------------------------------------------------------------------------------------------------------------------

const CSV_HEADERS = {
  'content-type': 'text/csv; charset=utf-8',
  'cache-control': 'private, no-store',
};

export const importHandlers: HttpHandler[] = [
  // ---- presets and template files (static routes first)
  http.get('/v1/imports/presets', ({ request }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    return HttpResponse.json({ data: PRESETS.map(presetView) });
  }),

  http.get('/v1/imports/presets/:key/template', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const preset = presetOf(String(params.key));
    if (!preset) return notFound('Preset');
    const format = new URL(request.url).searchParams.get('format') ?? 'csv';
    if (format !== 'csv' && format !== 'xlsx') {
      return validation([
        { pointer: 'query:format', message: 'Invalid option', code: 'invalid_value' },
      ]);
    }
    const custom =
      preset.entity_type === 'asset' ? live(registry().customFields).map((x) => x.key) : [];
    const rows = templateRows(preset, [...new Set(custom)]);
    const name = `${preset.key.replace(/[^a-z0-9_-]/gi, '-')}-template.${format}`;
    const headers = {
      'content-disposition': `attachment; filename="${name}"`,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    };
    if (format === 'xlsx') {
      const dictionaryRows = [
        ['Column', 'Field', 'Description', 'Required', 'Example'],
        ...dictionary(preset).map((d) => [
          d.column,
          d.target,
          d.description,
          d.required,
          d.example,
        ]),
      ];
      const bytes = buildXlsx([
        { name: 'Template', rows },
        { name: 'Data dictionary', rows: dictionaryRows },
      ]);
      return new HttpResponse(bytes as BodyInit, {
        headers: { 'content-type': XLSX_TYPE, ...headers },
      });
    }
    return new HttpResponse(toCsv(rows), { headers: { ...CSV_HEADERS, ...headers } });
  }),

  // ---- jobs
  http.get('/v1/imports', ({ request }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const params = new URL(request.url).searchParams;
    const states = (params.get('state') ?? '').split(',').filter(Boolean);
    const bad = states.find((s) => !(STATES as readonly string[]).includes(s));
    if (bad) return badRequest(`Unknown state "${bad}"`);
    const entity = params.get('entity_type');
    if (entity && !(ENTITIES as readonly string[]).includes(entity)) {
      return badRequest(`Unknown entity type "${entity}"`);
    }
    w3().importJobs.forEach(advance);
    return paginate(
      request,
      w3().importJobs.map((j) => ({ ...j, archived_at: null })),
      {
        sorts: { created_at: (j) => j.created_at },
        defaultSort: '-created_at',
        filter: (j) =>
          (states.length === 0 || states.includes(j.state)) &&
          (!entity || j.entity_type === entity),
      },
      (j) => jobView(j, false),
    );
  }),

  http.post('/v1/imports', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return badRequest('Malformed JSON body');
    const errors: FieldError[] = [];
    for (const key of Object.keys(body)) {
      if (!['entity_type', 'preset_key', 'options'].includes(key)) {
        errors.push({
          pointer: '/',
          message: `Unrecognized key: "${key}"`,
          code: 'unrecognized_keys',
        });
      }
    }
    if (!(ENTITIES as readonly string[]).includes(String(body.entity_type))) {
      errors.push({ pointer: '/entity_type', message: 'Invalid option', code: 'invalid_value' });
    }
    if ('preset_key' in body && (typeof body.preset_key !== 'string' || !body.preset_key)) {
      errors.push({
        pointer: '/preset_key',
        message: 'Invalid input: expected string',
        code: 'invalid_type',
      });
    }
    if ('options' in body) errors.push(...checkOptionsPatch(body.options));
    if (errors.length > 0) return validation(errors);
    const entity = body.entity_type as EntityType;
    const preset = typeof body.preset_key === 'string' ? presetOf(body.preset_key) : undefined;
    if (body.preset_key && (!preset || preset.entity_type !== entity)) {
      return validation([
        {
          pointer: '/preset_key',
          message: `No preset "${String(body.preset_key)}" for ${entity} imports. See GET /v1/imports/presets.`,
          code: 'not-found',
        },
      ]);
    }
    if (!hasPermission(guard.user.permissions, WRITE_PERMISSION[entity])) {
      return forbidden(
        `Importing ${entity === 'asset' ? 'assets' : entity === 'person' ? 'people' : `${entity}s`} needs the ${WRITE_PERMISSION[entity]} permission as well as import:run.`,
      );
    }
    const patch = (body.options ?? {}) as Record<string, unknown>;
    const options = {
      match_on: 'auto',
      on_match: 'skip',
      blank_cells: 'ignore',
      date_format: 'auto',
      number_format: 'auto',
      references: {},
      defaults: {},
      location_kind: 'other',
      assign: true,
      detect_changes: true,
      ...(preset?.options ?? {}),
      ...patch,
    };
    const defaultsErrors = checkDefaults(optionsOf({ options }));
    if (defaultsErrors.length > 0) return validation(defaultsErrors);
    let setup: Record<string, unknown> | null = null;
    if (preset?.setup) {
      const result = ensureSetup(preset, guard.user);
      if ('error' in result) return result.error!;
      setup = result.setup!;
    }
    const stamp = nowIso();
    const job: MockImportJob = {
      id: newW3Id('import'),
      entity_type: entity,
      source: preset?.source ?? 'csv',
      preset_key: preset?.key ?? null,
      state: 'draft',
      filename: null,
      file_attachment_id: null,
      parse: {},
      headers: null,
      mapping: {},
      options,
      value_map: {},
      rows_total: 0,
      plan: { create: 0, update: 0, skip: 0, error: 0 },
      done: { created: 0, updated: 0, skipped: 0, error: 0 },
      dry_run_digest: null,
      dry_run_at: null,
      committed_at: null,
      started_at: null,
      finished_at: null,
      data_purged_at: null,
      cancel_requested: false,
      error: null,
      summary: setup ? { setup } : null,
      requested_by: guard.user.id,
      created_at: stamp,
      updated_at: stamp,
      profile: null,
      samples: null,
      confidence: null,
      file_text: null,
      phase_started_at: null,
      cursor: 0,
      cancel_batches: 0,
      _v: 1,
    };
    mutateW3((data) => data.importJobs.push(job));
    return oneJob(job, true, 201, { Location: `/v1/imports/${job.id}` });
  }),

  http.get('/v1/imports/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    return job ? oneJob(job, canRun(guard.user)) : notFound('Import');
  }),

  http.patch('/v1/imports/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const stale = checkIfMatch(request, job._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return badRequest('Malformed JSON body');
    const shape: FieldError[] = [];
    for (const key of Object.keys(body)) {
      if (!['mapping', 'options', 'value_map'].includes(key)) {
        shape.push({
          pointer: '/',
          message: `Unrecognized key: "${key}"`,
          code: 'unrecognized_keys',
        });
      }
    }
    if ('mapping' in body) shape.push(...checkMappingShape(body.mapping));
    if ('options' in body) shape.push(...checkOptionsPatch(body.options));
    if ('value_map' in body) shape.push(...checkValueMap(body.value_map));
    if (shape.length > 0) return validation(shape);
    const editable = ['draft', 'uploaded', 'analyzed', 'mapped', 'dry_run_done'];
    if (!editable.includes(job.state))
      return wrongState(job, 'editing the mapping or options', editable);
    const errors: FieldError[] = [];
    let options = optionsOf(job);
    if (body.options) {
      const o = body.options as Partial<Options>;
      options = {
        ...options,
        ...o,
        references: { ...options.references, ...(o.references ?? {}) },
        defaults: { ...options.defaults, ...(o.defaults ?? {}) },
      };
      errors.push(...checkDefaults(options));
    }
    let mapping = mappingOf(job);
    if (body.mapping) {
      mapping = body.mapping as MappingShape;
      for (const issue of mappingIssues(job, mapping, options).filter(
        (i) => i.code !== 'required',
      )) {
        errors.push({ pointer: '/mapping/columns', message: issue.message, code: issue.code });
      }
    }
    if (errors.length > 0) return validation(errors);
    mutateW3(() => {
      if (body.mapping) job.mapping = mapping as unknown as Record<string, unknown>;
      if (body.options) job.options = options as unknown as Record<string, unknown>;
      if (body.value_map)
        job.value_map = { ...job.value_map, ...(body.value_map as typeof job.value_map) };
      if (job.state !== 'draft' && job.state !== 'uploaded') job.state = 'mapped';
      job.dry_run_digest = null;
      job.dry_run_at = null;
      job.plan = { create: 0, update: 0, skip: 0, error: 0 };
      job.cursor = 0;
      touch(job);
    });
    return oneJob(job, true);
  }),

  http.post('/v1/imports/:id/analyze', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const raw = await request.text();
    let body: Body = {};
    if (raw.trim()) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
          throw new Error('shape');
        body = parsed as Body;
      } catch {
        return badRequest('Malformed JSON body');
      }
    }
    const shape: FieldError[] = [];
    for (const key of Object.keys(body)) {
      if (!['file_attachment_id', 'parse'].includes(key)) {
        shape.push({
          pointer: '/',
          message: `Unrecognized key: "${key}"`,
          code: 'unrecognized_keys',
        });
      }
    }
    if ('file_attachment_id' in body && !/^[0-9a-f-]{36}$/i.test(String(body.file_attachment_id))) {
      shape.push({
        pointer: '/file_attachment_id',
        message: 'Invalid UUID',
        code: 'invalid_format',
      });
    }
    const overrides = (body.parse ?? {}) as Record<string, unknown>;
    if ('parse' in body) {
      for (const key of Object.keys(overrides)) {
        if (!['encoding', 'delimiter', 'sheet', 'header_line'].includes(key)) {
          shape.push({
            pointer: '/parse',
            message: `Unrecognized key: "${key}"`,
            code: 'unrecognized_keys',
          });
        }
      }
      if (
        'encoding' in overrides &&
        !['utf-8', 'utf-16le', 'utf-16be', 'windows-1252'].includes(String(overrides.encoding))
      ) {
        shape.push({
          pointer: '/parse/encoding',
          message: 'Invalid option',
          code: 'invalid_value',
        });
      }
      if (
        'delimiter' in overrides &&
        ![',', ';', '\t', '|'].includes(String(overrides.delimiter))
      ) {
        shape.push({
          pointer: '/parse/delimiter',
          message: 'Invalid option',
          code: 'invalid_value',
        });
      }
    }
    if (shape.length > 0) return validation(shape);
    const allowed = ['draft', 'uploaded', 'analyzed', 'mapped', 'dry_run_done', 'failed'];
    if (!allowed.includes(job.state) || (job.state === 'failed' && job.committed_at)) {
      return wrongState(job, 'analysing the file', allowed);
    }
    const attachmentId = (body.file_attachment_id as string | undefined) ?? job.file_attachment_id;
    if (!attachmentId) {
      return validation([
        {
          pointer: '/file_attachment_id',
          message:
            'Upload the file first (POST /v1/attachments with entity_type "import_job" and kind "import_file") and name it here.',
          code: 'required',
        },
      ]);
    }
    const attachment = registry().attachments.find((a) => a.id === attachmentId && !a.archived_at);
    const bad = (message: string) =>
      validation([{ pointer: '/file_attachment_id', message, code: 'invalid' }]);
    if (
      !attachment ||
      attachment.entity_type !== 'import_job' ||
      attachment.entity_id !== job.id ||
      attachment.kind !== 'import_file'
    ) {
      return bad(
        'No such import file: it must be an attachment of kind "import_file" owned by this import.',
      );
    }
    if (!attachment.uploaded_at)
      return bad('The upload has not been completed yet (POST /v1/attachments/{id}/complete).');
    if (scanState(attachment.id) === 'infected' || attachment.scan_status === 'error') {
      return bad('This file was rejected by the upload checks.');
    }
    const ext = /\.([a-z0-9]+)$/i.exec(attachment.filename)?.[1]?.toLowerCase();
    if (ext !== 'csv' && ext !== 'xlsx') {
      return bad(`"${attachment.filename}" is not a CSV or XLSX file.`);
    }
    const quota = capacity(job);
    if (quota) return quota;
    mutateW3(() => {
      const sameFile =
        !body.file_attachment_id || body.file_attachment_id === job.file_attachment_id;
      job.parse = { ...(sameFile ? job.parse : {}), ...overrides };
      job.state = 'analyzing';
      job.file_attachment_id = attachment.id;
      job.filename = attachment.filename;
      job.source = job.source === 'google_admin_csv' ? job.source : ext === 'xlsx' ? 'xlsx' : 'csv';
      job.file_text = ext === 'csv' ? (importUploadText(attachment.id) ?? job.file_text) : null;
      job.error = null;
      job.started_at = nowIso();
      job.finished_at = null;
      job.cancel_requested = false;
      job.dry_run_digest = null;
      job.dry_run_at = null;
      job.phase_started_at = Date.now();
      touch(job);
    });
    return oneJob(job, true, 202, { Location: `/v1/imports/${job.id}`, 'Retry-After': '2' });
  }),

  http.post('/v1/imports/:id/apply-template', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const body = await readBody(request);
    if (!body) return badRequest('Malformed JSON body');
    if (!/^[0-9a-f-]{36}$/i.test(String(body.template_id)) || Object.keys(body).length !== 1) {
      return validation([
        { pointer: '/template_id', message: 'Invalid UUID', code: 'invalid_format' },
      ]);
    }
    const template = w3().mappingTemplates.find((t) => t.id === body.template_id);
    if (!template) return notFound('Template');
    const allowed = ['analyzed', 'mapped', 'dry_run_done'];
    if (!allowed.includes(job.state)) return wrongState(job, 'applying a template', allowed);
    const norm = (s: string) => normKey(s).replace(/[^\p{L}\p{N}]+/gu, '');
    const used = new Set<string>();
    const columns = (job.headers ?? []).map((header, index) => {
      const hit = template.columns.find(
        (c) => c.target && !used.has(c.target) && norm(c.header) === norm(header),
      );
      if (hit?.target) used.add(hit.target);
      return {
        index,
        target: hit?.target ?? null,
        ...(hit?.date_format ? { date_format: hit.date_format } : {}),
      };
    });
    mutateW3(() => {
      job.mapping = { columns };
      job.options = { ...optionsOf(job), ...template.options } as unknown as Record<
        string,
        unknown
      >;
      job.state = 'mapped';
      job.dry_run_digest = null;
      job.dry_run_at = null;
      job.plan = { create: 0, update: 0, skip: 0, error: 0 };
      job.cursor = 0;
      touch(job);
    });
    return oneJob(job, true);
  }),

  http.get('/v1/imports/:id/values', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const query = new URL(request.url).searchParams;
    const field = query.get('field');
    if (!field || !REF_KINDS.includes(field as RefKind)) {
      return validation([
        { pointer: 'query:field', message: 'Invalid option', code: 'invalid_value' },
      ]);
    }
    const limit = Number(query.get('limit') ?? 200);
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      return validation([
        { pointer: 'query:limit', message: 'Must be between 1 and 1000.', code: 'invalid_value' },
      ]);
    }
    const kind = field as RefKind;
    const target = REF_TARGET[job.entity_type][kind];
    const mapping = mappingOf(job);
    const col = target ? mapping.columns.find((c) => c.target === target) : undefined;
    const constant = target ? mapping.constants?.[target] : undefined;
    if (!target || (!col && !constant)) {
      return validation([
        {
          pointer: 'query:field',
          message: `No column is mapped to ${kind}. Map one first.`,
          code: 'invalid',
        },
      ]);
    }
    const q = (query.get('q') ?? '').trim().toLowerCase();
    const counts = new Map<string, number>();
    if (col) {
      for (const row of rowsOf(job.id)) {
        const value = (row.raw[col.index] ?? '').trim();
        if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
      }
    } else counts.set(constant!, job.rows_total);
    const options = optionsOf(job);
    const strict = {
      ...options,
      references: Object.fromEntries(REF_KINDS.map((k) => [k, 'must_exist'])),
    } as Options;
    const grouped = [...counts.entries()]
      .filter(([value]) => !q || value.toLowerCase().includes(q))
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const valueMap = job.value_map as Record<string, Record<string, unknown>>;
    return HttpResponse.json({
      field: kind,
      column: col ? (job.headers?.[col.index] ?? null) : null,
      distinct: counts.size,
      data: grouped.slice(0, limit).map(([value, count]) => {
        const res = resolveRef({ ...job, value_map: {} }, strict, kind, value);
        return {
          value,
          count,
          suggestion: res.kind === 'found' ? { id: res.id, name: res.name } : null,
          entry: valueMap[kind]?.[normKey(value)] ?? null,
        };
      }),
    });
  }),

  http.post('/v1/imports/:id/dry-run', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const allowed = ['analyzed', 'mapped', 'dry_run_done'];
    if (!allowed.includes(job.state)) return wrongState(job, 'a dry run', allowed);
    const issues = mappingIssues(job, mappingOf(job), optionsOf(job));
    if (issues.length > 0) {
      return validation(
        issues.map((i) => ({ pointer: '/mapping', message: i.message, code: i.code })),
      );
    }
    const missing = missingPermissions(guard.user, job);
    if (missing.length > 0) {
      return forbidden(
        `This import needs the permission${missing.length > 1 ? 's' : ''} ${missing.join(', ')} as well as import:run. Ask an administrator, or set the references that need creating to "must_exist".`,
      );
    }
    const quota = capacity(job);
    if (quota) return quota;
    mutateW3((data) => {
      for (const row of data.importRows.filter((r) => r.job_id === job.id)) {
        Object.assign(row, {
          mapped: null,
          plan: null,
          errors: [],
          warnings: [],
          entity_id: null,
          entity_version: null,
          dup_of: null,
          result: null,
          result_errors: null,
          created_id: null,
          before_image: null,
        });
      }
      job.state = 'dry_running';
      job.cursor = 0;
      job.plan = { create: 0, update: 0, skip: 0, error: 0 };
      job.done = { created: 0, updated: 0, skipped: 0, error: 0 };
      job.dry_run_digest = null;
      job.dry_run_at = null;
      job.started_at = nowIso();
      job.finished_at = null;
      job.cancel_requested = false;
      job.error = null;
      job.phase_started_at = Date.now();
      touch(job);
    });
    return oneJob(job, true, 202, { Location: `/v1/imports/${job.id}`, 'Retry-After': '2' });
  }),

  http.get('/v1/imports/:id/rows', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const query = new URL(request.url).searchParams;
    const limit = Number(query.get('limit') ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
      return badRequest('Query parameter "limit" must be between 1 and 500.');
    }
    const phaseParam = query.get('phase');
    if (phaseParam && phaseParam !== 'dry_run' && phaseParam !== 'commit') {
      return badRequest('Query parameter "phase" must be dry_run or commit.');
    }
    const phase =
      phaseParam ??
      (job.state === 'committing' || job.state === 'completed' ? 'commit' : 'dry_run');
    const outcomes = (query.get('outcome') ?? '').split(',').filter(Boolean);
    const valid = ['create', 'update', 'skip', 'error', 'created', 'updated', 'skipped'];
    if (outcomes.some((o) => !valid.includes(o)))
      return badRequest('Query parameter "outcome" is invalid.');
    const warnings = query.get('has_warnings');
    let after = 0;
    const cursor = query.get('cursor');
    if (cursor) {
      try {
        after = Number(atob(cursor));
      } catch {
        after = Number.NaN;
      }
      if (!Number.isInteger(after)) return badRequest('Invalid cursor.');
    }
    const toResult = (o: string) =>
      ({ create: 'created', update: 'updated', skip: 'skipped' })[o] ?? o;
    const matching = rowsOf(job.id)
      .filter((r) => r.row_no > after)
      .filter((r) => (phase === 'dry_run' ? r.plan !== null : r.result !== null))
      .filter((r) =>
        outcomes.length === 0
          ? true
          : phase === 'dry_run'
            ? outcomes.includes(r.plan ?? '')
            : outcomes.map(toResult).includes(r.result ?? ''),
      )
      .filter((r) =>
        warnings === null
          ? true
          : warnings === 'true'
            ? r.warnings.length > 0
            : r.warnings.length === 0,
      )
      .sort((a, b) => a.row_no - b.row_no);
    const slice = matching.slice(0, limit);
    const more = matching.length > limit;
    const headers = job.headers ?? [];
    return HttpResponse.json({
      data: slice.map((r) => {
        const commit = phase === 'commit';
        const source: Record<string, string> = {};
        headers.forEach((h, i) => {
          if (r.raw[i] !== undefined && r.raw[i] !== '') source[h] = r.raw[i]!;
        });
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
          errors: (commit ? (r.result_errors ?? r.errors) : r.errors) ?? [],
          warnings: r.warnings,
          source,
          mapped: r.mapped,
          before_image: r.before_image,
        };
      }),
      page: {
        next_cursor: more ? btoa(String(slice[slice.length - 1]!.row_no)) : null,
        has_more: more,
      },
    });
  }),

  http.get('/v1/imports/:id/errors.csv', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    const commit = job.state === 'committing' || job.state === 'completed';
    const headers = job.headers ?? [];
    const failing = rowsOf(job.id).filter((r) =>
      commit ? r.result === 'error' : r.plan === 'error',
    );
    const csvText = toCsv([
      ['Row', 'Line', 'Fields', 'Problems', 'Warnings', ...headers],
      ...failing.map((r) => {
        const issues = (commit ? (r.result_errors ?? r.errors) : r.errors) ?? [];
        const fields = [...new Set(issues.map((i) => i.field).filter(Boolean))].join(', ');
        return [
          r.row_no,
          r.line_no,
          fields,
          issues.map((i) => i.message).join(' | '),
          r.warnings.map((w) => w.message).join(' | '),
          ...headers.map((_, i) => r.raw[i] ?? ''),
        ];
      }),
    ]);
    return new HttpResponse(csvText, {
      headers: {
        ...CSV_HEADERS,
        'x-content-type-options': 'nosniff',
        'content-disposition': `attachment; filename="import-${job.id.slice(0, 8)}-errors.csv"`,
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
      const digest = body?.dry_run_digest;
      if (
        !body ||
        Object.keys(body).length !== 1 ||
        typeof digest !== 'string' ||
        !/^[0-9a-f]{64}$/.test(digest)
      ) {
        return validation([
          {
            pointer: '/dry_run_digest',
            message: 'must be the 64 hex characters of the reviewed dry run',
            code: 'invalid_format',
          },
        ]);
      }
      if (job.state !== 'dry_run_done') return wrongState(job, 'a commit', ['dry_run_done']);
      if (!job.dry_run_digest || job.dry_run_digest !== digest) {
        return problem(409, 'import-stale-dry-run', 'The dry run is out of date', {
          detail:
            'The file, mapping or options changed after the dry run you reviewed, or the digest is not the latest one. Run the dry run again and review it.',
          extensions: { current_digest: job.dry_run_digest },
        });
      }
      const missing = missingPermissions(guard.user, job);
      if (missing.length > 0) {
        return forbidden(
          `This import needs the permission${missing.length > 1 ? 's' : ''} ${missing.join(', ')} as well as import:run.`,
        );
      }
      const quota = capacity(job);
      if (quota) return quota;
      mutateW3(() => {
        job.state = 'committing';
        job.cursor = 0;
        job.done = { created: 0, updated: 0, skipped: 0, error: 0 };
        job.started_at = nowIso();
        job.finished_at = null;
        job.committed_at = null;
        job.cancel_requested = false;
        job.error = null;
        job.phase_started_at = Date.now();
        touch(job);
      });
      return oneJob(job, true, 202, { Location: `/v1/imports/${job.id}`, 'Retry-After': '2' });
    });
  }),

  http.post('/v1/imports/:id/cancel', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const job = jobOr404(params.id);
    if (!job) return notFound('Import');
    if (job.state === 'completed' || job.state === 'cancelled') {
      return wrongState(job, 'cancelling', [
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
    }
    const running = job.state === 'dry_running' || job.state === 'committing';
    mutateW3(() => {
      if (running) {
        job.cancel_requested = true;
        job.cancel_batches = batchesDone(job);
      } else {
        job.state = 'cancelled';
        job.finished_at = nowIso();
        job.cancel_requested = false;
        job.phase_started_at = null;
      }
      touch(job);
    });
    return oneJob(job, true);
  }),

  // ---- saved mapping templates
  http.get('/v1/import-templates', ({ request }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const entity = new URL(request.url).searchParams.get('entity_type');
    if (entity && !(ENTITIES as readonly string[]).includes(entity)) {
      return badRequest(`Unknown entity type "${entity}"`);
    }
    return paginate(
      request,
      w3().mappingTemplates.map((t) => ({ ...t, archived_at: null })),
      {
        sorts: { name: (t) => t.name.toLowerCase() },
        defaultSort: 'name',
        filter: (t) => !entity || t.entity_type === entity,
      },
      templateView,
    );
  }),

  http.post('/v1/import-templates', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const body = await readBody(request);
    if (!body) return badRequest('Malformed JSON body');
    const errors: FieldError[] = [];
    for (const key of Object.keys(body)) {
      if (
        !['name', 'description', 'entity_type', 'columns', 'options', 'from_import_id'].includes(
          key,
        )
      ) {
        errors.push({
          pointer: '/',
          message: `Unrecognized key: "${key}"`,
          code: 'unrecognized_keys',
        });
      }
    }
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name || name.length > 100) {
      errors.push({
        pointer: '/name',
        message: name
          ? 'Too big: expected string to have <=100 characters'
          : 'Too small: expected string to have >=1 characters',
        code: name ? 'too_big' : 'too_small',
      });
    }
    if ('options' in body) errors.push(...checkOptionsPatch(body.options));
    const fromImport = typeof body.from_import_id === 'string' ? body.from_import_id : undefined;
    if (!fromImport && !(body.columns !== undefined && body.entity_type !== undefined)) {
      errors.push({
        pointer: '/',
        message: 'give either from_import_id, or entity_type and columns',
        code: 'custom',
      });
    }
    if (body.columns !== undefined) errors.push(...checkTemplateColumns(body.columns));
    if (
      body.entity_type !== undefined &&
      !(ENTITIES as readonly string[]).includes(String(body.entity_type))
    ) {
      errors.push({ pointer: '/entity_type', message: 'Invalid option', code: 'invalid_value' });
    }
    if (errors.length > 0) return validation(errors);
    let entity = body.entity_type as EntityType | undefined;
    let columns = (body.columns ?? []) as MockMappingTemplate['columns'];
    let options = (body.options ?? {}) as Record<string, unknown>;
    if (fromImport) {
      const job = jobOr404(fromImport);
      if (!job) return notFound('Import');
      entity = job.entity_type;
      columns = mappingOf(job)
        .columns.filter((c) => c.target)
        .map((c) => ({
          header: job.headers?.[c.index] ?? `Column ${c.index + 1}`,
          target: c.target,
          ...(c.date_format ? { date_format: c.date_format } : {}),
        }));
      options = { ...job.options };
    }
    if (w3().mappingTemplates.some((t) => t.entity_type === entity && sameName(t.name, name))) {
      return problem(409, 'conflict', 'Conflict', {
        detail: `A saved mapping named "${name}" already exists for ${entity} imports.`,
        errors: [{ pointer: '/name', message: 'is already in use', code: 'duplicate' }],
      });
    }
    const stamp = nowIso();
    const template: MockMappingTemplate = {
      id: newW3Id('template'),
      name,
      description: typeof body.description === 'string' ? body.description : null,
      entity_type: entity!,
      columns,
      options,
      created_at: stamp,
      updated_at: stamp,
      created_by: guard.user.id,
      _v: 1,
    };
    mutateW3((data) => data.mappingTemplates.push(template));
    return oneTemplate(template, 201, { Location: `/v1/import-templates/${template.id}` });
  }),

  http.get('/v1/import-templates/:id', ({ request, params }) => {
    const guard = requireSession(request, { permission: 'import:read' });
    if (!guard.ok) return guard.response;
    const template = w3().mappingTemplates.find((t) => t.id === params.id);
    return template ? oneTemplate(template) : notFound('Template');
  }),

  http.patch('/v1/import-templates/:id', async ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const template = w3().mappingTemplates.find((t) => t.id === params.id);
    if (!template) return notFound('Template');
    const stale = checkIfMatch(request, template._v);
    if (stale) return stale;
    const body = await readBody(request);
    if (!body) return badRequest('Malformed JSON body');
    const errors: FieldError[] = [];
    for (const key of Object.keys(body)) {
      if (!['name', 'description', 'columns', 'options'].includes(key)) {
        errors.push({
          pointer: '/',
          message: `Unrecognized key: "${key}"`,
          code: 'unrecognized_keys',
        });
      }
    }
    if ('columns' in body) errors.push(...checkTemplateColumns(body.columns));
    if ('options' in body) errors.push(...checkOptionsPatch(body.options));
    const name = typeof body.name === 'string' ? body.name.trim() : undefined;
    if ('name' in body && (!name || name.length > 100)) {
      errors.push({ pointer: '/name', message: 'Invalid name', code: 'too_small' });
    }
    if (errors.length > 0) return validation(errors);
    if (
      name &&
      w3().mappingTemplates.some(
        (t) =>
          t.id !== template.id && t.entity_type === template.entity_type && sameName(t.name, name),
      )
    ) {
      return problem(409, 'conflict', 'Conflict', {
        detail: `A saved mapping named "${name}" already exists for ${template.entity_type} imports.`,
        errors: [{ pointer: '/name', message: 'is already in use', code: 'duplicate' }],
      });
    }
    mutateW3(() => {
      if (name) template.name = name;
      if ('description' in body) template.description = (body.description as string | null) ?? null;
      if (body.columns) template.columns = body.columns as MockMappingTemplate['columns'];
      if (body.options)
        template.options = { ...template.options, ...(body.options as Record<string, unknown>) };
      template.updated_at = nowIso();
      template._v += 1;
    });
    return oneTemplate(template);
  }),

  http.delete('/v1/import-templates/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true, permission: 'import:run' });
    if (!guard.ok) return guard.response;
    const template = w3().mappingTemplates.find((t) => t.id === params.id);
    if (!template) return notFound('Template');
    const stale = checkIfMatch(request, template._v);
    if (stale) return stale;
    mutateW3((data) => {
      data.mappingTemplates = data.mappingTemplates.filter((t) => t.id !== template.id);
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
