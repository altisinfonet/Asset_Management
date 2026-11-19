import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/** Request schemas of the export endpoints (openapi `ExportCreate`, `Export`). */

export const uuidParam = z.uuid();
export const EXPORT_RESOURCES = ['assets', 'people', 'locations'] as const;
export type ExportResource = (typeof EXPORT_RESOURCES)[number];
export const EXPORT_STATUSES = ['queued', 'running', 'succeeded', 'failed', 'expired'] as const;

/** Query parameters of the lists that never belong in an export (paging and presentation). */
export const FORBIDDEN_FILTERS = ['limit', 'cursor', 'include_total', 'fields', 'expand'] as const;

const filterValue = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(100)).max(50),
]);

export const exportCreateSchema = z.strictObject({
  resource: z.enum(EXPORT_RESOURCES),
  format: z.enum(['csv']).default('csv'),
  filters: z
    .record(z.string().max(80), filterValue)
    .refine((v) => Object.keys(v).length <= 40, 'at most 40 filters')
    .default({}),
});
export type ExportCreate = z.output<typeof exportCreateSchema>;

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(500)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(10));

export const exportListSchema = listQuerySchema.pick({ limit: true, cursor: true }).extend({
  status: csv(z.enum(EXPORT_STATUSES)).optional(),
});
export type ExportListQuery = z.output<typeof exportListSchema>;

/**
 * The filters as a query string would carry them: arrays are comma-separated, booleans and numbers are
 * their text. This is what is stored on the job and what the list endpoints parse.
 */
export function toQueryRecord(
  filters: Record<string, string | number | boolean | string[]>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) {
    out[key] = Array.isArray(value) ? value.join(',') : String(value);
  }
  return out;
}
