import { z } from 'zod';
import { DATE_FORMATS, NUMBER_FORMATS } from './values.js';
import { ENTITY_TYPES, REF_KINDS } from './fields.js';

/** The states of an import job (migration 0110) and who moves it. */
export const IMPORT_STATES = [
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
export type ImportState = (typeof IMPORT_STATES)[number];

/** States in which a worker job is (or should be) working on the import. */
export const RUNNING_STATES: readonly ImportState[] = ['analyzing', 'dry_running', 'committing'];
/** Final states. */
export const FINAL_STATES: readonly ImportState[] = ['completed', 'failed', 'cancelled'];

export const IMPORT_SOURCES = ['csv', 'xlsx', 'google_admin_csv'] as const;
export const PLANS = ['create', 'update', 'skip', 'error'] as const;
export type Plan = (typeof PLANS)[number];
export const RESULTS = ['created', 'updated', 'skipped', 'error'] as const;
export type RowResult = (typeof RESULTS)[number];

/** What is wrong (or worth knowing) about one row, on one field. */
export interface RowIssue {
  /** Target field key (`serial`, `cf:os_version`) or null for the row as a whole. */
  field: string | null;
  message: string;
  code: string;
}

/** The typed content of one row after the mapping, before references are resolved. */
export interface MappedRecord {
  /** Scalar targets, typed: strings, numbers, ISO dates, `{ amount_minor, currency }`. */
  f: Record<string, unknown>;
  /** Reference targets: the text of the cell (`category`, `model`, `assigned_to`...). */
  r: Record<string, string>;
  /** Custom field targets (`cf:<key>` without the prefix): the cell text, coerced when the row is planned. */
  c: Record<string, string>;
  /** Targets whose cell was blank (an update may clear them, per the `blank_cells` option). */
  b: string[];
}

export const mappingColumnSchema = z.strictObject({
  index: z.number().int().min(0).max(499),
  /** A key of `FIELD_SPECS[entity]`, `cf:<custom field key>`, or null to ignore the column. */
  target: z.string().max(80).nullable(),
  /** Per-column override of the job's date format (`dmy`, `mdy`, `iso`). */
  date_format: z.enum(DATE_FORMATS).optional(),
});
export const mappingSchema = z.strictObject({
  columns: z.array(mappingColumnSchema).max(500),
  /**
   * A text for a target that has no column (`{ "category": "Chromebook" }`): used for every row whose own
   * cell (if the target is mapped at all) is blank. Reference and plain text targets only.
   */
  constants: z.record(z.string().max(80), z.string().trim().min(1).max(300)).optional(),
});
export type Mapping = z.output<typeof mappingSchema>;

const refPolicy = z.enum(['create', 'must_exist']);
export const optionsSchema = z.strictObject({
  /** Assets: how an existing asset is found. `auto` = the tag when the row has one, else the serial. */
  match_on: z.enum(['auto', 'asset_tag', 'serial', 'external_id']).default('auto'),
  /** What to do when the row matches an existing record. */
  on_match: z.enum(['skip', 'update', 'error']).default('skip'),
  /** Update only: a blank cell leaves the field alone (`ignore`) or empties it (`clear`). */
  blank_cells: z.enum(['ignore', 'clear']).default('ignore'),
  date_format: z.enum(DATE_FORMATS).default('auto'),
  number_format: z.enum(NUMBER_FORMATS).default('auto'),
  /** Currency of costs that name none; else the organisation's base currency. */
  default_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  /** `external_source` written with a mapped external id (default `import`). */
  external_source: z.string().min(1).max(100).optional(),
  /** Per reference kind: create what is missing, or require it to exist. */
  references: z.partialRecord(z.enum(REF_KINDS as [string, ...string[]]), refPolicy).default({}),
  /** Ids used when a row's cell is blank: `{ category: <id>, status: <id>, ... }`. */
  defaults: z
    .strictObject({
      category: z.uuid().optional(),
      status: z.uuid().optional(),
      location: z.uuid().optional(),
      department: z.uuid().optional(),
      vendor: z.uuid().optional(),
    })
    .default({}),
  /** Kind given to locations the import creates. */
  location_kind: z
    .enum(['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'])
    .default('other'),
  /** Assets: check the created asset out to `assigned_to` (default true). */
  assign: z.boolean().default(true),
  /** Update only: refuse to touch a record somebody edited after the dry run (default true). */
  detect_changes: z.boolean().default(true),
});
export type ImportOptions = z.output<typeof optionsSchema>;

/** The options a request may set: every key optional and WITHOUT its default (an omitted key is unchanged). */
export const optionsPatchSchema = z.strictObject({
  match_on: z.enum(['auto', 'asset_tag', 'serial', 'external_id']).optional(),
  on_match: z.enum(['skip', 'update', 'error']).optional(),
  blank_cells: z.enum(['ignore', 'clear']).optional(),
  date_format: z.enum(DATE_FORMATS).optional(),
  number_format: z.enum(NUMBER_FORMATS).optional(),
  default_currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  external_source: z.string().min(1).max(100).optional(),
  references: z.partialRecord(z.enum(REF_KINDS as [string, ...string[]]), refPolicy).optional(),
  defaults: z
    .strictObject({
      category: z.uuid().optional(),
      status: z.uuid().optional(),
      location: z.uuid().optional(),
      department: z.uuid().optional(),
      vendor: z.uuid().optional(),
    })
    .optional(),
  location_kind: z
    .enum(['site', 'building', 'floor', 'room', 'storage', 'vehicle', 'other'])
    .optional(),
  assign: z.boolean().optional(),
  detect_changes: z.boolean().optional(),
});
export type OptionsPatch = z.output<typeof optionsPatchSchema>;

/** One entry of `value_map[kind]`: what a source value of a reference column means. */
export const valueEntrySchema = z.union([
  z.strictObject({ id: z.uuid() }),
  z.strictObject({ create: z.literal(true), name: z.string().trim().min(1).max(200).optional() }),
  z.strictObject({ skip: z.literal(true) }),
]);
export type ValueEntry = z.output<typeof valueEntrySchema>;
export const valueMapSchema = z.partialRecord(
  z.enum(REF_KINDS as [string, ...string[]]),
  z.record(z.string().max(300), valueEntrySchema),
);
export type ValueMap = Partial<Record<string, Record<string, ValueEntry>>>;

export const entityTypeSchema = z.enum(ENTITY_TYPES);

/** The job row as the engine reads it. */
export interface JobRow {
  id: string;
  tenant_id: string;
  requested_by: string;
  source: string;
  entity_type: (typeof ENTITY_TYPES)[number];
  preset_key: string | null;
  state: ImportState;
  file_attachment_id: string | null;
  filename: string | null;
  parse: Record<string, unknown>;
  headers: string[] | null;
  mapping: Mapping | Record<string, never>;
  options: Record<string, unknown>;
  value_map: ValueMap;
  rows_total: number;
  cursor_row: number;
  rows_processed: number;
  cancel_requested: boolean;
  dry_run_digest: string | null;
  version: number;
}

/** The dry-run verdict of one row. */
export interface Verdict {
  plan: Plan;
  errors: RowIssue[];
  warnings: RowIssue[];
  entityId?: string | null;
  entityVersion?: number | null;
}

/** The commit outcome of one row. */
export interface Outcome {
  result: RowResult;
  errors: RowIssue[];
  createdId?: string | null;
  /** The record an update changed (and, in `before`, the values it replaced). */
  entityId?: string | null;
  before?: Record<string, unknown> | null;
  warnings?: RowIssue[];
}

/** One import_row as the engine reads it. */
export interface RowData {
  row_no: number;
  line_no: number;
  raw: string[];
  mapped: MappedRecord | null;
  match_key: string | null;
  match_key2: string | null;
  dup_of: number | null;
  plan: Plan | null;
  entity_id: string | null;
  entity_version: number | null;
}
