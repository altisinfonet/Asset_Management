import type {
  ImportAnalysis,
  ImportEntity,
  ImportJob,
  ImportLookup,
  ImportRow,
  ImportSource,
  ImportState,
  ImportTargetField,
  ValueMap,
} from './api';

/**
 * Pure logic of the import wizard (M2-IMP-08): the kinds of data it offers, which step a job is on,
 * the checks before a dry run, the value decisions and the numbers behind the progress bar.
 */

/** What the user picks in step 1: a kind of data, which is an entity and a file source. */
export type ImportKind = 'asset' | 'person' | 'location' | 'department' | 'chromeos';

export const IMPORT_KINDS: ReadonlyArray<{
  id: ImportKind;
  entity: ImportEntity;
  source: ImportSource;
  /** Needs `asset:create` as well (the importer writes through the registry). */
  permission?: string;
}> = [
  { id: 'asset', entity: 'asset', source: 'csv' },
  { id: 'person', entity: 'person', source: 'csv' },
  { id: 'location', entity: 'location', source: 'csv' },
  { id: 'department', entity: 'department', source: 'csv' },
  { id: 'chromeos', entity: 'asset', source: 'google_admin_csv' },
];

export const kindOf = (job: Pick<ImportJob, 'entity_type' | 'source'>): ImportKind =>
  job.source === 'google_admin_csv'
    ? 'chromeos'
    : (IMPORT_KINDS.find((kind) => kind.entity === job.entity_type && kind.source === 'csv')?.id ??
      'asset');

export const isImportKind = (value: string | null | undefined): value is ImportKind =>
  IMPORT_KINDS.some((kind) => kind.id === value);

/** The recommended order of a first import: places and people before the assets that point at them. */
export const RECOMMENDED_ORDER: readonly ImportKind[] = [
  'location',
  'department',
  'person',
  'asset',
];

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

/** Steps a draft job can be moved back to (`?step=`). */
const DRAFT_STEPS: readonly WizardStep[] = ['file', 'mapping', 'values'];

/**
 * Where a job belongs: its state decides, so a reload or a link from the list lands on the right
 * step. Only a draft with a file can be sent back to an earlier step (`requested`).
 */
export function stepFor(
  job: Pick<ImportJob, 'state' | 'file_attachment_id'>,
  requested?: string | null,
): WizardStep {
  switch (job.state) {
    case 'draft':
      if (requested === 'file') return 'file';
      if (!job.file_attachment_id) return 'file';
      return DRAFT_STEPS.includes(requested as WizardStep) ? (requested as WizardStep) : 'mapping';
    case 'dry_run_queued':
    case 'dry_run_running':
    case 'dry_run_complete':
      return 'review';
    case 'commit_queued':
    case 'committing':
      return 'import';
    case 'committed':
    case 'failed':
    case 'cancelled':
      return 'done';
  }
}

/** The stepper item that is current (the finished screen is the last step, done). */
export const stepperIndex = (step: WizardStep): number =>
  step === 'done' ? WIZARD_STEPS.length - 1 : WIZARD_STEPS.indexOf(step);

/** A state the worker is still moving: poll until it settles. */
export const isRunning = (state: ImportState): boolean =>
  state === 'dry_run_queued' ||
  state === 'dry_run_running' ||
  state === 'commit_queued' ||
  state === 'committing';

export const isFinished = (state: ImportState): boolean =>
  state === 'committed' || state === 'failed' || state === 'cancelled';

/** Can the job still be resumed from the list? */
export const isResumable = (state: ImportState): boolean => !isFinished(state);

// ---- mapping ------------------------------------------------------------------------------------------

/** A mapping from the heuristics' suggestions: every column with a suggestion, each target once. */
export function suggestedMapping(
  analysis: Pick<ImportAnalysis, 'columns'>,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const taken = new Set<string>();
  for (const column of analysis.columns) {
    const target = column.suggested_field;
    if (!target || taken.has(target)) continue;
    mapping[column.name] = target;
    taken.add(target);
  }
  return mapping;
}

export interface MappingProblems {
  /** Required fields no column goes to. */
  missingRequired: ImportTargetField[];
  /** Targets two columns are mapped to. */
  duplicates: string[];
  /** The field the duplicate check uses (tag or serial) has no column. */
  missingKey: string | null;
  ok: boolean;
}

/** What blocks a dry run: a required field with no column, a target used twice, no column for the match key. */
export function mappingProblems(
  mapping: Record<string, string>,
  fields: readonly ImportTargetField[],
  entity: ImportEntity,
  matchOn: string,
): MappingProblems {
  const targets = Object.values(mapping).filter(Boolean);
  const counts = new Map<string, number>();
  for (const target of targets) counts.set(target, (counts.get(target) ?? 0) + 1);
  const duplicates = [...counts].filter(([, n]) => n > 1).map(([target]) => target);
  const missingRequired = fields.filter((f) => f.required && !counts.has(f.key));
  const missingKey = entity === 'asset' && !counts.has(matchOn) ? matchOn : null;
  return {
    missingRequired,
    duplicates,
    missingKey,
    ok: missingRequired.length === 0 && duplicates.length === 0 && missingKey === null,
  };
}

/** The reference fields (category, location ...) that have a column, in the order of the field list. */
export function mappedReferences(
  mapping: Record<string, string>,
  fields: readonly ImportTargetField[],
): ImportTargetField[] {
  const targets = new Set(Object.values(mapping));
  return fields.filter((f) => f.type === 'reference' && targets.has(f.key));
}

/** Only the mapping entries a column still exists for (a saved mapping may name columns this file lacks). */
export function applicableMapping(
  mapping: Record<string, string>,
  analysis: Pick<ImportAnalysis, 'columns'>,
): Record<string, string> {
  const names = new Set(analysis.columns.map((c) => c.name));
  return Object.fromEntries(Object.entries(mapping).filter(([column]) => names.has(column)));
}

// ---- values ---------------------------------------------------------------------------------------------

/** Kinds of record the importer never invents: a person or a status label has to exist. */
const NEVER_CREATED: ReadonlySet<ImportLookup['reference']> = new Set(['person', 'status_label']);
export const canCreateMissing = (reference: ImportLookup['reference']): boolean =>
  !NEVER_CREATED.has(reference);

/** Values that match nothing yet, per field. */
export function unmatchedValues(lookups: readonly ImportLookup[]) {
  return lookups
    .map((lookup) => ({ ...lookup, values: lookup.values.filter((v) => v.match === null) }))
    .filter((lookup) => lookup.values.length > 0);
}

/** A choice for every unmatched value that can be created: "create it". The rest stay open. */
export function createAllMissing(
  lookups: readonly ImportLookup[],
  current: ValueMap = {},
): ValueMap {
  const next: ValueMap = {};
  for (const [field, choices] of Object.entries(current)) next[field] = { ...choices };
  for (const lookup of unmatchedValues(lookups)) {
    if (!canCreateMissing(lookup.reference)) continue;
    next[lookup.field] ??= {};
    for (const value of lookup.values) {
      next[lookup.field]![value.value] ??= { action: 'create' };
    }
  }
  return next;
}

/** How many unmatched values still have no decision (they would be errors in the dry run). */
export function openValueCount(lookups: readonly ImportLookup[], valueMap: ValueMap): number {
  return unmatchedValues(lookups).reduce(
    (sum, lookup) =>
      sum + lookup.values.filter((value) => !valueMap[lookup.field]?.[value.value]).length,
    0,
  );
}

// ---- progress and results ----------------------------------------------------------------------------

/** Share of the rows the commit has handled, 0..100. */
export function commitPercent(job: Pick<ImportJob, 'rows_total' | 'commit_progress'>): number {
  const total = job.rows_total ?? 0;
  const done = job.commit_progress?.processed ?? 0;
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((done / total) * 100)));
}

/** Rows the commit will write: creates and updates (the rest are skipped or in error). */
export const rowsToWrite = (job: Pick<ImportJob, 'rows_create' | 'rows_update'>): number =>
  (job.rows_create ?? 0) + (job.rows_update ?? 0);

/** The value a row is known by: its tag, serial, name or email, taken from the columns that were mapped to them. */
export function rowKey(
  row: Pick<ImportRow, 'source_data'>,
  mapping: Record<string, string>,
): string {
  const data = row.source_data ?? {};
  for (const target of ['asset_tag', 'serial', 'display_name', 'name', 'email']) {
    const column = Object.entries(mapping).find(([, to]) => to === target)?.[0];
    const value = column ? data[column] : undefined;
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

/** Lines of a row's problem: its errors, then its warnings. */
export const rowMessages = (row: Pick<ImportRow, 'errors' | 'warnings'>): string[] => [
  ...row.errors.map((e) => e.message),
  ...row.warnings.map((w) => w.message),
];

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
