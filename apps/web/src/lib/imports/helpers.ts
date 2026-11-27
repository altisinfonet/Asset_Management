import type {
  ImportColumnProfile,
  ImportEntity,
  ImportJob,
  ImportMapping,
  ImportMappingColumn,
  ImportOptions,
  ImportPreset,
  ImportRefKind,
  ImportRow,
  ImportState,
  ImportValue,
  ImportValueEntry,
  ImportValueMap,
} from './api';

/**
 * Pure logic of the import wizard (M2-IMP-08): the kinds of data it offers, which step a job is on, the
 * checks before a dry run (the same rules the API applies to a mapping), the value decisions and the
 * numbers behind the progress bars.
 */

// ---- what is imported -----------------------------------------------------------------------------------

/** What the user picks in step 1: a built-in preset (an entity type plus how its file is read). */
export type ImportKind = 'asset' | 'person' | 'location' | 'department' | 'chromeos';

export const IMPORT_KINDS: ReadonlyArray<{
  id: ImportKind;
  entity: ImportEntity;
  /** The key of the preset (`GET /v1/imports/presets`) the import is created from. */
  preset: string;
}> = [
  { id: 'asset', entity: 'asset', preset: 'assets' },
  { id: 'person', entity: 'person', preset: 'people' },
  { id: 'location', entity: 'location', preset: 'locations' },
  { id: 'department', entity: 'department', preset: 'departments' },
  { id: 'chromeos', entity: 'asset', preset: 'google_admin_chromeos' },
];

export const kindOf = (
  job: Pick<ImportJob, 'entity_type' | 'source' | 'preset_key'>,
): ImportKind =>
  job.preset_key === 'google_admin_chromeos' || job.source === 'google_admin_csv'
    ? 'chromeos'
    : (IMPORT_KINDS.find((kind) => kind.entity === job.entity_type)?.id ?? 'asset');

export const isImportKind = (value: string | null | undefined): value is ImportKind =>
  IMPORT_KINDS.some((kind) => kind.id === value);

/** The recommended order of a first import: places and people before the assets that point at them. */
export const RECOMMENDED_ORDER: readonly ImportKind[] = [
  'location',
  'department',
  'person',
  'asset',
];

// ---- the file --------------------------------------------------------------------------------------------

const CONTENT_TYPES = {
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
} as const;

/** The file picker of the upload step: CSV, tab- or comma-separated text (Excel's "Unicode text") and XLSX. */
export const IMPORT_FILE_ACCEPT = '.csv,.tsv,.txt,.xlsx';

/**
 * The format the importer reads a file as, from its name: `.csv`, `.tsv` and `.txt` are delimited text
 * (`csv`; Excel's "Unicode text" is a tab-delimited `.txt`, ED-40), `.xlsx` a workbook.
 */
export function fileFormatOf(name: string): 'csv' | 'xlsx' | null {
  const ext = /\.([a-z0-9]+)$/i.exec(name)?.[1]?.toLowerCase();
  if (ext === 'csv' || ext === 'tsv' || ext === 'txt') return 'csv';
  return ext === 'xlsx' ? ext : null;
}

/**
 * The file with the content type its extension calls for. Browsers report what the operating system
 * says (Excel makes `.csv` files `application/vnd.ms-excel`, others send nothing), and the upload
 * allow-list matches the type to the extension, so the declared type is set here.
 */
export function withImportContentType(file: File): File {
  const format = fileFormatOf(file.name);
  if (!format || file.type === CONTENT_TYPES[format]) return file;
  return new File([file], file.name, {
    type: CONTENT_TYPES[format],
    lastModified: file.lastModified,
  });
}

// ---- steps ---------------------------------------------------------------------------------------------

export type WizardStep = 'type' | 'file' | 'mapping' | 'values' | 'review' | 'import' | 'done';
export const WIZARD_STEPS: readonly Exclude<WizardStep, 'done'>[] = [
  'type',
  'file',
  'mapping',
  'values',
  'review',
  'import',
];

/** Steps an analysed import can be sent back to (`?step=`). */
const EDIT_STEPS: readonly WizardStep[] = ['file', 'mapping', 'values'];

/**
 * Where a job belongs: its state decides, so a reload, a link from the list or the "import finished"
 * notification lands on the right step. An analysed (or mapped, or reviewed) import can be sent back to
 * an earlier step with `requested`; a failed one can take another file.
 */
export function stepFor(job: Pick<ImportJob, 'state'>, requested?: string | null): WizardStep {
  switch (job.state) {
    case 'draft':
    case 'uploaded':
      return 'file';
    case 'analyzing':
      return 'mapping';
    case 'analyzed':
    case 'mapped':
      return EDIT_STEPS.includes(requested as WizardStep) ? (requested as WizardStep) : 'mapping';
    case 'dry_running':
      return 'review';
    case 'dry_run_done':
      return EDIT_STEPS.includes(requested as WizardStep) ? (requested as WizardStep) : 'review';
    case 'committing':
      return 'import';
    case 'failed':
      return requested === 'file' ? 'file' : 'done';
    case 'completed':
    case 'cancelled':
      return 'done';
  }
}

/** The stepper item that is current (the finished screen is the last step). */
export const stepperIndex = (step: WizardStep): number =>
  step === 'done' ? WIZARD_STEPS.length - 1 : WIZARD_STEPS.indexOf(step);

/** A state the worker is still moving: poll until it settles. */
export const isRunning = (state: ImportState): boolean =>
  state === 'analyzing' || state === 'dry_running' || state === 'committing';

export const isFinished = (state: ImportState): boolean =>
  state === 'completed' || state === 'failed' || state === 'cancelled';

/** Can the job still be resumed from the list? */
export const isResumable = (state: ImportState): boolean => !isFinished(state);

/** The analysis failed (no data rows were read), as opposed to a dry run or commit that failed. */
export const analysisFailed = (job: Pick<ImportJob, 'state' | 'headers'>): boolean =>
  job.state === 'failed' && !job.headers;

/** The retention job removed the rows, profile, samples, value map and file of this finished import (ED-25). */
export const isPurged = (job: Pick<ImportJob, 'data_purged_at'>): boolean => !!job.data_purged_at;

// ---- targets -----------------------------------------------------------------------------------------------

export interface TargetOption {
  /** The value of the mapping: a field of the entity or `cf:<custom field key>`. */
  key: string;
  label: string;
  description: string;
  required: boolean;
  custom: boolean;
}

/** `serial_number` -> `Serial number`: the label of a target the data dictionary does not describe. */
export function humanizeTarget(key: string): string {
  const text = key.replace(/^cf:/, '').replace(/[_-]+/g, ' ').trim();
  return text ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : key;
}

/**
 * What a column of this entity can be mapped to: the data dictionary of the presets of the entity (the
 * template columns, with their descriptions) and, for assets, the organisation's custom fields as
 * `cf:<key>`. A target the job already uses but the dictionary lacks is kept, so no choice is lost.
 */
export function targetOptionsFor(
  entity: ImportEntity,
  presets: readonly ImportPreset[],
  customFields: ReadonlyArray<{ key: string; label: string; category?: string | null }>,
  used: readonly string[] = [],
): TargetOption[] {
  const out: TargetOption[] = [];
  const seen = new Set<string>();
  for (const preset of presets.filter((p) => p.entity_type === entity)) {
    for (const column of preset.columns) {
      if (column.target.startsWith('cf:') || seen.has(column.target)) continue;
      seen.add(column.target);
      out.push({
        key: column.target,
        label: column.column,
        description: column.description,
        required: column.required.startsWith('yes'),
        custom: false,
      });
    }
  }
  if (entity === 'asset') {
    for (const field of customFields) {
      const key = `cf:${field.key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({
        key,
        label: field.category ? `${field.label} (${field.category})` : field.label,
        description: '',
        required: false,
        custom: true,
      });
    }
  }
  for (const key of used) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      key,
      label: humanizeTarget(key),
      description: '',
      required: false,
      custom: key.startsWith('cf:'),
    });
  }
  return out;
}

// ---- mapping -------------------------------------------------------------------------------------------------

/** The mapped columns of a mapping (a draft import's mapping is `{}`, so `columns` can be absent). */
export const columnsOf = (
  mapping: Partial<ImportMapping> | null | undefined,
): ImportMappingColumn[] => mapping?.columns ?? [];

/** The target of a column of the file (null: not imported). */
export const targetOfColumn = (mapping: Partial<ImportMapping>, index: number): string | null =>
  columnsOf(mapping).find((c) => c.index === index)?.target ?? null;

/** The mapping with column `index` sent to `target` (a target is used once: another column that had it lets go). */
export function withTarget(
  mapping: Partial<ImportMapping>,
  headerCount: number,
  index: number,
  target: string | null,
): ImportMapping {
  const byIndex = new Map(columnsOf(mapping).map((c) => [c.index, c]));
  const columns = Array.from({ length: headerCount }, (_, i) => {
    const current = byIndex.get(i) ?? { index: i, target: null };
    if (i === index) return { ...current, target };
    return target && current.target === target ? { ...current, target: null } : current;
  });
  return { ...mapping, columns };
}

/** The mapping with the date format of one column set (`null` removes the override). */
export function withDateFormat(
  mapping: Partial<ImportMapping>,
  index: number,
  format: ImportOptions['date_format'] | null,
): ImportMapping {
  return {
    ...mapping,
    columns: columnsOf(mapping).map((c) => {
      if (c.index !== index) return c;
      const { date_format: _unused, ...rest } = c;
      return format ? { ...rest, date_format: format } : rest;
    }),
  };
}

export type MappingProblem =
  | { kind: 'category' }
  | { kind: 'identity' }
  | { kind: 'name' }
  | { kind: 'duplicate'; field: string };

/**
 * What stops a dry run (the rules of the API's `checkMapping`): a target used twice, an asset without a
 * category (a column, a fixed value or a default) or without anything that tells rows apart, a person,
 * location or department without a name.
 */
export function mappingProblems(
  entity: ImportEntity,
  mapping: Partial<ImportMapping>,
  defaults: ImportOptions['defaults'] | undefined,
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const column of columnsOf(mapping)) {
    if (!column.target) continue;
    if (seen.has(column.target)) duplicated.add(column.target);
    seen.add(column.target);
  }
  for (const field of duplicated) problems.push({ kind: 'duplicate', field });
  const constants = mapping.constants ?? {};
  const has = (key: string) => seen.has(key) || key in constants;
  switch (entity) {
    case 'asset':
      if (!has('category') && !defaults?.category) problems.push({ kind: 'category' });
      if (!has('asset_tag') && !has('serial') && !has('name') && !has('external_id')) {
        problems.push({ kind: 'identity' });
      }
      break;
    case 'person':
      if (!has('display_name') && !(has('first_name') || has('last_name')) && !has('email')) {
        problems.push({ kind: 'name' });
      }
      break;
    case 'location':
      if (!has('name') && !has('path')) problems.push({ kind: 'name' });
      break;
    case 'department':
      if (!has('name')) problems.push({ kind: 'name' });
      break;
  }
  return problems;
}

/** The mapped targets of kind date or money (what the date and number format options are about). */
export const DATE_TARGETS: ReadonlySet<string> = new Set([
  'purchase_date',
  'warranty_end',
  'cf:last_sync',
  'cf:auto_update_expiration',
]);

export const hasDateTarget = (
  mapping: Partial<ImportMapping>,
  profile?: readonly ImportColumnProfile[] | null,
) =>
  columnsOf(mapping).some(
    (c) =>
      !!c.target &&
      (DATE_TARGETS.has(c.target) || profile?.find((p) => p.index === c.index)?.type === 'date'),
  );

export const hasNumberTarget = (mapping: Partial<ImportMapping>) =>
  columnsOf(mapping).some((c) => c.target === 'purchase_cost');

/** A date column whose values do not say the order (`03/04/2024`): it needs a date format. */
export const needsDateFormat = (
  profile: Pick<ImportColumnProfile, 'type' | 'date_order'> | undefined,
) =>
  profile?.type === 'date' &&
  (profile.date_order === 'ambiguous' || profile.date_order === 'mixed');

/** The columns that have a target, counted. */
export const mappedCount = (mapping: Partial<ImportMapping>): number =>
  columnsOf(mapping).filter((c) => !!c.target).length;

// ---- references and values -------------------------------------------------------------------------------

/** The mapping target each reference kind is read from, per entity type (the API's `REF_TARGET`). */
export const REF_TARGET: Record<ImportEntity, Partial<Record<ImportRefKind, string>>> = {
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

const REF_ORDER: readonly ImportRefKind[] = [
  'category',
  'manufacturer',
  'model',
  'status',
  'location',
  'department',
  'vendor',
  'person',
];

/** The reference kinds that have a column (or a fixed value) in the mapping: the ones the values step is about. */
export function mappedRefKinds(
  entity: ImportEntity,
  mapping: Partial<ImportMapping>,
): ImportRefKind[] {
  const targets = new Set(
    columnsOf(mapping)
      .map((c) => c.target)
      .filter(Boolean),
  );
  const constants = Object.keys(mapping.constants ?? {});
  return REF_ORDER.filter((kind) => {
    const target = REF_TARGET[entity][kind];
    return !!target && (targets.has(target) || constants.includes(target));
  });
}

/** What a missing record of this kind turns into when the user did not decide: create it, or an error (the API's defaults). */
export const policyOf = (
  options: Pick<ImportOptions, 'references'> | undefined,
  kind: ImportRefKind,
): 'create' | 'must_exist' =>
  options?.references?.[kind] ?? (kind === 'status' || kind === 'person' ? 'must_exist' : 'create');

/** An import never invents a status label; every other kind can be created (a person needs `person:manage`). */
export const canCreate = (kind: ImportRefKind): boolean => kind !== 'status';

/** The key a source value has in the value map: trimmed, spaces collapsed, lower case. */
export const normValue = (text: string): string =>
  text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();

export type EntryKind = 'use' | 'create' | 'skip';
export const entryKind = (entry: ImportValueEntry | null | undefined): EntryKind | null =>
  !entry ? null : 'id' in entry ? 'use' : 'create' in entry ? 'create' : 'skip';

/** The value map with one entry set (`null` removes it). */
export function withEntry(
  valueMap: ImportValueMap,
  kind: ImportRefKind,
  value: string,
  entry: ImportValueEntry | null,
): ImportValueMap {
  const key = normValue(value);
  const next: Record<string, ImportValueEntry> = { ...(valueMap[kind] ?? {}) };
  if (entry) next[key] = entry;
  else delete next[key];
  return { ...valueMap, [kind]: next };
}

export const entryFor = (
  valueMap: ImportValueMap,
  kind: ImportRefKind,
  value: string,
): ImportValueEntry | null => valueMap[kind]?.[normValue(value)] ?? null;

/** A value the dry run would reject: no decision, no record of that name, and missing records are not created. */
export function needsDecision(
  value: Pick<ImportValue, 'value' | 'suggestion'> & { issue?: ImportValue['issue'] },
  kind: ImportRefKind,
  options: Pick<ImportOptions, 'references'> | undefined,
  valueMap: ImportValueMap,
): boolean {
  if (entryFor(valueMap, kind, value.value)) return false;
  // ED-37: a name that exists but would still fail the dry run (ambiguous, or in another category)
  if (value.issue) return true;
  if (value.suggestion) return false;
  return policyOf(options, kind) === 'must_exist';
}

/** A "create it" decision for every value that matches no record, for the kinds that can be created. */
export function createAllMissing(
  values: ReadonlyArray<{ kind: ImportRefKind; values: readonly ImportValue[] }>,
  current: ImportValueMap,
): ImportValueMap {
  let next = current;
  for (const group of values) {
    if (!canCreate(group.kind)) continue;
    for (const value of group.values) {
      // a value with an issue (ambiguous, another category) is not fixed by creating it
      if (value.suggestion || value.issue || entryFor(next, group.kind, value.value)) continue;
      next = withEntry(next, group.kind, value.value, { create: true });
    }
  }
  return next;
}

// ---- progress and results --------------------------------------------------------------------------------

/** Share of the rows the running step has handled, 0..100. */
export const progressPercent = (job: Pick<ImportJob, 'progress'>): number =>
  Math.max(0, Math.min(100, Math.round(job.progress.percent)));

/** Rows the commit will write: creates and updates (the rest are skipped or in error). */
export const rowsToWrite = (job: Pick<ImportJob, 'counts'>): number =>
  job.counts.dry_run.create + job.counts.dry_run.update;

/** Counts of the dry run as shown by the filter buttons. */
export type RowFilter = 'all' | 'error' | 'skip' | 'create' | 'update' | 'warnings';

/** The dry-run rows (or commit rows) the filter stands for, as the `outcome` / `has_warnings` query. */
export function rowQueryFor(
  filter: RowFilter,
  phase: 'dry_run' | 'commit',
): {
  outcome?: Array<'create' | 'update' | 'skip' | 'error' | 'created' | 'updated' | 'skipped'>;
  has_warnings?: boolean;
} {
  if (filter === 'all') return {};
  if (filter === 'warnings') return { has_warnings: true };
  if (phase === 'dry_run') return { outcome: [filter] };
  return {
    outcome: [
      filter === 'create'
        ? 'created'
        : filter === 'update'
          ? 'updated'
          : filter === 'skip'
            ? 'skipped'
            : 'error',
    ],
  };
}

const KEY_FIELDS = [
  'asset_tag',
  'serial',
  'display_name',
  'name',
  'email',
  'path',
  'code',
] as const;

/** The value a row is known by: its tag, serial, name, email or path (from the typed record), else its first cell. */
export function rowKey(row: Pick<ImportRow, 'mapped' | 'source'>): string {
  const typed = (row.mapped as { f?: Record<string, unknown> } | null)?.f;
  for (const field of KEY_FIELDS) {
    const value = typed?.[field];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  const first = Object.values(row.source ?? {}).find((v) => v.trim() !== '');
  return first?.trim() ?? '';
}

/** The entity's list, to open once rows were imported. */
export function listRouteFor(
  entity: ImportEntity,
): '/assets' | '/people' | '/locations' | '/settings/departments' {
  switch (entity) {
    case 'person':
      return '/people';
    case 'location':
      return '/locations';
    case 'department':
      return '/settings/departments';
    default:
      return '/assets';
  }
}

/** What the dry run summary says about the preset's setup (the category and fields creating the import made). */
export function setupOf(
  job: Pick<ImportJob, 'summary'>,
): { categoryCreated: boolean; customFieldsCreated: string[] } | null {
  const setup = (job.summary as { setup?: Record<string, unknown> } | null)?.setup;
  if (!setup) return null;
  return {
    categoryCreated: setup.category_created === true,
    customFieldsCreated: Array.isArray(setup.custom_fields_created)
      ? (setup.custom_fields_created as string[])
      : [],
  };
}

/** The category the Google Admin preset creates (the API's `GOOGLE_CHROMEBOOK_CATEGORY`). */
export const CHROMEBOOK_CATEGORY = 'Chromebook';

/** The row problem codes that have a sentence of their own in the messages. */
const KNOWN_CODES = [
  'required',
  'not-found',
  'exists',
  'duplicate-in-file',
  'duplicate',
  'ambiguous-date',
  'ambiguous',
  'date',
  'number',
  'enum',
  'invalid',
  'changed-since-dry-run',
  'conflict',
  'too-deep',
  'internal',
  'serial-taken',
  'archived',
  'integer',
  'currency',
  'unknown-field',
  // BUG-3: the schema checks' own codes (zod), never shown raw
  'too_big',
  'too_small',
  'invalid_type',
  'invalid_format',
  'invalid_value',
  'not_multiple_of',
  'invalid_union',
  'invalid_key',
  'invalid_element',
  'custom',
  'unrecognized_keys',
] as const;
export type KnownCode = (typeof KNOWN_CODES)[number];
export const isKnownCode = (code: string): code is KnownCode =>
  (KNOWN_CODES as readonly string[]).includes(code);

export interface ErrorGroup {
  code: string;
  field: string | null;
  count: number;
}

/** `summary.errors_by_code` of a dry run, most frequent first. */
export function errorGroupsOf(job: Pick<ImportJob, 'summary'>): ErrorGroup[] {
  const list = (job.summary as { errors_by_code?: unknown } | null)?.errors_by_code;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const e = entry as { code?: unknown; field?: unknown; n?: unknown };
    return typeof e.code === 'string' && typeof e.n === 'number'
      ? [{ code: e.code, field: typeof e.field === 'string' ? e.field : null, count: e.n }]
      : [];
  });
}

/** Skip reasons that mean "the record is already there as the file says" (or the line is not data). */
const ALREADY_THERE = new Set(['exists', 'unchanged']);
const NOT_DATA = new Set(['duplicate-in-file', 'summary-row']);

/**
 * ED-40: a dry run where nothing would be written because every row matches what is already there (a
 * re-import of an unchanged file): no errors, nothing to create or update, and every skipped row is
 * `exists` / `unchanged` (or a repeat or summary line of the file). The review then says so in a neutral
 * tone instead of "No row can be imported".
 */
export function nothingChanged(job: Pick<ImportJob, 'summary'>): boolean {
  const summary = job.summary as {
    counts?: { create?: unknown; update?: unknown; skip?: unknown; error?: unknown };
    skipped_by_code?: unknown;
  } | null;
  const counts = summary?.counts;
  const list = summary?.skipped_by_code;
  if (!counts || !Array.isArray(list)) return false;
  if (counts.create !== 0 || counts.update !== 0 || counts.error !== 0) return false;
  if (typeof counts.skip !== 'number' || counts.skip === 0) return false;
  let already = 0;
  for (const entry of list) {
    const e = entry as { code?: unknown; n?: unknown };
    if (typeof e.code !== 'string' || typeof e.n !== 'number') return false;
    if (ALREADY_THERE.has(e.code)) already += e.n;
    else if (!NOT_DATA.has(e.code)) return false;
  }
  return already > 0;
}

export interface WillCreate {
  field: string | null;
  message: string;
  count: number;
}

/**
 * `summary.validated_at_commit` of a dry run (ED-29): the rows whose last checks wait for the commit (a
 * location below a parent the same import creates). Said once above the rows, never on each row.
 */
export function deferredRowsOf(job: Pick<ImportJob, 'summary'>): number {
  const n = (job.summary as { validated_at_commit?: unknown } | null)?.validated_at_commit;
  return typeof n === 'number' && n > 0 ? n : 0;
}

/** The warnings a row shows: "checked when the import runs" is explained once for the whole import. */
export function rowWarnings<W extends { code: string }>(warnings: readonly W[]): W[] {
  return warnings.filter((w) => w.code !== 'validated-at-commit');
}

/** `summary.will_create` of a dry run: the records the commit would create on the way. */
export function willCreateOf(job: Pick<ImportJob, 'summary'>): WillCreate[] {
  const list = (job.summary as { will_create?: unknown } | null)?.will_create;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry) => {
    const e = entry as { field?: unknown; message?: unknown; n?: unknown };
    return typeof e.message === 'string' && typeof e.n === 'number'
      ? [{ field: typeof e.field === 'string' ? e.field : null, message: e.message, count: e.n }]
      : [];
  });
}
