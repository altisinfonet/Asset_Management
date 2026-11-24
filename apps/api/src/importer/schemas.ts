import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';
import { CSV_DELIMITERS, CSV_ENCODINGS } from './csv-reader.js';
import { ENTITY_TYPES, REF_KINDS } from './fields.js';
import { IMPORT_STATES, mappingSchema, optionsPatchSchema, valueMapSchema } from './types.js';

/** Request schemas of the import endpoints (openapi `ImportCreate`, `ImportUpdate`, ...). Bodies are strict. */

export const uuidParam = z.uuid();
const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');

const csvList = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(500)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(20));

export const parseOverridesSchema = z.strictObject({
  encoding: z.enum(CSV_ENCODINGS as unknown as [string, ...string[]]).optional(),
  delimiter: z.enum(CSV_DELIMITERS as unknown as [string, ...string[]]).optional(),
  sheet: str().trim().min(1).max(100).optional(),
  header_line: z.number().int().min(1).max(100_000).optional(),
});
export type ParseOverrides = z.output<typeof parseOverridesSchema>;

export const importCreateSchema = z.strictObject({
  entity_type: z.enum(ENTITY_TYPES),
  /** A built-in preset (`GET /v1/imports/presets`): its mapping is applied when the file is analysed. */
  preset_key: str().min(1).max(64).optional(),
  options: optionsPatchSchema.optional(),
});
export type ImportCreate = z.output<typeof importCreateSchema>;

export const importUpdateSchema = z.strictObject({
  mapping: mappingSchema.optional(),
  options: optionsPatchSchema.optional(),
  value_map: valueMapSchema.optional(),
});
export type ImportUpdate = z.output<typeof importUpdateSchema>;

export const importAnalyzeSchema = z.strictObject({
  file_attachment_id: z.uuid().optional(),
  parse: parseOverridesSchema.optional(),
});
export type ImportAnalyze = z.output<typeof importAnalyzeSchema>;

export const importCommitSchema = z.strictObject({
  dry_run_digest: z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'must be the 64 hex characters of the reviewed dry run'),
});
export type ImportCommit = z.output<typeof importCommitSchema>;

export const importListSchema = listQuerySchema.pick({ limit: true, cursor: true }).extend({
  state: csvList(z.enum(IMPORT_STATES)).optional(),
  entity_type: z.enum(ENTITY_TYPES).optional(),
});
export type ImportListQuery = z.output<typeof importListSchema>;

export const importRowsSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  cursor: z.string().max(100).optional(),
  outcome: csvList(
    z.enum(['create', 'update', 'skip', 'error', 'created', 'updated', 'skipped']),
  ).optional(),
  phase: z.enum(['dry_run', 'commit']).optional(),
  has_warnings: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ImportRowsQuery = z.output<typeof importRowsSchema>;

export const importValuesSchema = z.object({
  field: z.enum(REF_KINDS as unknown as [string, ...string[]]),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  q: str().trim().max(200).optional(),
});
export type ImportValuesQuery = z.output<typeof importValuesSchema>;

export const applyTemplateSchema = z.strictObject({ template_id: z.uuid() });

export const templateColumnSchema = z.strictObject({
  header: str().trim().min(1).max(200),
  target: z.string().max(80).nullable(),
  date_format: z.enum(['auto', 'iso', 'dmy', 'mdy']).optional(),
});
export const templateCreateSchema = z
  .strictObject({
    name: str().trim().min(1).max(100),
    description: str().trim().max(1000).nullable().optional(),
    entity_type: z.enum(ENTITY_TYPES).optional(),
    columns: z.array(templateColumnSchema).max(500).optional(),
    options: optionsPatchSchema.optional(),
    /** Copy the mapping (by header) and options of this import. */
    from_import_id: z.uuid().optional(),
  })
  .refine(
    (v) =>
      v.from_import_id !== undefined || (v.columns !== undefined && v.entity_type !== undefined),
    {
      message: 'give either from_import_id, or entity_type and columns',
    },
  );
export type TemplateCreate = z.output<typeof templateCreateSchema>;
export const templateUpdateSchema = z.strictObject({
  name: str().trim().min(1).max(100).optional(),
  description: str().trim().max(1000).nullable().optional(),
  columns: z.array(templateColumnSchema).max(500).optional(),
  options: optionsPatchSchema.optional(),
});
export type TemplateUpdate = z.output<typeof templateUpdateSchema>;
export const templateListSchema = listQuerySchema.pick({ limit: true, cursor: true }).extend({
  entity_type: z.enum(ENTITY_TYPES).optional(),
});
export type TemplateListQuery = z.output<typeof templateListSchema>;

export const presetFileSchema = z.object({ format: z.enum(['csv', 'xlsx']).default('csv') });
