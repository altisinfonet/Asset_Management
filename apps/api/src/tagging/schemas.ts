import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';
import { LABEL_CODES, LABEL_FIELDS } from './templates.js';

/**
 * Request schemas of the label endpoints (openapi `LabelBatchCreate`, `LabelTemplateUpdate`).
 * Bodies are strict: an unknown field is a 422.
 */

export const uuidParam = z.uuid();

/** Assets per batch. The DB check allows more; the limit is what a 30 s worker run is measured for (ADR 0007). */
export const LABEL_MAX_ASSETS = 2000;
/** Labels per batch (assets x copies). */
export const LABEL_MAX_LABELS = 2000;
export const LABEL_MAX_COPIES = 10;
/** How long a rendered PDF is kept (then deleted by `label.sweep`, status `expired`). */
export const LABEL_RETENTION_HOURS = 7 * 24;
/** The logo is re-encoded to this box before it enters the PDF; larger sources are refused up front. */
export const LABEL_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const uniqueBy = <T>(items: readonly T[]): boolean => new Set(items).size === items.length;

export const labelBatchCreateSchema = z
  .strictObject({
    template_key: z
      .string()
      .regex(/^[a-z0-9][a-z0-9_-]{1,62}$/, 'must be a template key')
      .describe('Key from GET /v1/labels/templates.'),
    asset_ids: z
      .array(z.uuid())
      .min(1)
      .max(LABEL_MAX_ASSETS)
      .refine(uniqueBy, 'must not repeat an asset (use copies)')
      .optional(),
    filter: z.record(z.string().min(1).max(60), z.unknown()).optional(),
    start_position: z.number().int().min(1).max(1000).default(1),
    copies: z.number().int().min(1).max(LABEL_MAX_COPIES).default(1),
    codes: z
      .array(z.enum(LABEL_CODES))
      .max(2)
      .refine(uniqueBy, 'must not repeat a code')
      .optional(),
    fields: z
      .array(z.enum(LABEL_FIELDS))
      .max(LABEL_FIELDS.length)
      .refine(uniqueBy, 'must not repeat a field')
      .optional(),
    logo_attachment_id: z.uuid().nullable().optional(),
    outlines: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    const given = (value.asset_ids ? 1 : 0) + (value.filter ? 1 : 0);
    if (given !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: [value.filter ? 'filter' : 'asset_ids'],
        message: 'Send exactly one of asset_ids and filter.',
      });
    }
  });
export type LabelBatchCreate = z.output<typeof labelBatchCreateSchema>;

/** Only the calibration shift of a fixed template can be changed (M2-TAG-04). */
const offset = z
  .number()
  .min(-10)
  .max(10)
  .transform((v) => Math.round(v * 100) / 100);
export const labelTemplateUpdateSchema = z
  .strictObject({
    offset_x_mm: offset.optional(),
    offset_y_mm: offset.optional(),
  })
  .refine((v) => v.offset_x_mm !== undefined || v.offset_y_mm !== undefined, {
    message: 'Send offset_x_mm and/or offset_y_mm.',
  });
export type LabelTemplateUpdate = z.output<typeof labelTemplateUpdateSchema>;

export const LABEL_BATCH_STATUSES = ['queued', 'ready', 'failed', 'expired'] as const;
export const labelBatchListSchema = listQuerySchema.extend({
  status: z
    .string()
    .max(100)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(LABEL_BATCH_STATUSES)).max(4))
    .optional(),
});
export type LabelBatchListQuery = z.output<typeof labelBatchListSchema>;
