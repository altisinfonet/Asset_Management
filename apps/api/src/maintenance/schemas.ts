import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the repair endpoints (openapi `Repair`, `RepairCreate`, `RepairUpdate`,
 * `RepairCompleteRequest`). Bodies are strict; the update schema has no defaults (RFC 7396 merge
 * semantics: omitted = unchanged, `null` clears a nullable field).
 */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
export const uuidParam = z.uuid();

export const REPAIR_KINDS = ['repair', 'maintenance', 'inspection', 'upgrade'] as const;
export const REPAIR_STATUSES = ['open', 'in_progress', 'completed', 'cancelled'] as const;
export type RepairKind = (typeof REPAIR_KINDS)[number];
export type RepairStatus = (typeof REPAIR_STATUSES)[number];

/** An RFC 3339 instant PostgreSQL accepts (year 0000 passes the format check but not the database). */
const instant = z.iso
  .datetime({ offset: true })
  .refine((v) => new Date(v).getUTCFullYear() >= 1, 'year must be 1 or later');

/** `Money`: integer minor units and an ISO 4217 code. */
const money = z.strictObject({
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: z.string().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as "EUR"'),
});

const attachmentIds = z
  .array(z.uuid())
  .max(10)
  .transform((ids) => [...new Set(ids.map((i) => i.toLowerCase()))]);

export const repairCreateSchema = z.strictObject({
  asset_id: z.uuid(),
  kind: z.enum(REPAIR_KINDS).optional(),
  title: trimmed(1, 200),
  description: nullableText(10_000).optional(),
  reported_at: instant.optional(),
  started_at: instant.nullable().optional(),
  vendor_id: z.uuid().nullable().optional(),
  performed_by_person_id: z.uuid().nullable().optional(),
  ticket_ref: nullableText(200).optional(),
  cost: money.nullable().optional(),
  restore_status_id: z.uuid().nullable().optional(),
  // A repair is created open or already in progress; it is closed by the complete endpoint or a cancel.
  status: z.enum(['open', 'in_progress']).optional(),
  set_status_id: z.uuid().optional(),
  force_checkin: z.boolean().optional(),
  force_note: trimmed(1, 500).optional(),
  attachment_ids: attachmentIds.optional(),
});
export type RepairCreate = z.output<typeof repairCreateSchema>;

export const repairUpdateSchema = z.strictObject({
  kind: z.enum(REPAIR_KINDS).optional(),
  title: trimmed(1, 200).optional(),
  description: nullableText(10_000).optional(),
  reported_at: instant.optional(),
  started_at: instant.nullable().optional(),
  vendor_id: z.uuid().nullable().optional(),
  performed_by_person_id: z.uuid().nullable().optional(),
  ticket_ref: nullableText(200).optional(),
  cost: money.nullable().optional(),
  restore_status_id: z.uuid().nullable().optional(),
  status: z.enum(['open', 'in_progress', 'cancelled']).optional(),
});
export type RepairUpdate = z.output<typeof repairUpdateSchema>;

export const repairCompleteSchema = z.strictObject({
  completed_at: instant.optional(),
  resolution_notes: str().trim().max(4000).optional(),
  cost: money.nullable().optional(),
  restore_status_id: z.uuid().nullable().optional(),
  attachment_ids: attachmentIds.optional(),
});
export type RepairComplete = z.output<typeof repairCompleteSchema>;

const csv = <T extends z.ZodType<unknown, string>>(item: T) =>
  z
    .string()
    .max(2000)
    .transform((v) =>
      v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    )
    .pipe(z.array(item).max(20));

export const repairListSchema = listQuerySchema.extend({
  archived: z.enum(['exclude', 'include', 'only']).default('exclude'),
  asset_id: z.uuid().optional(),
  status: csv(z.enum(REPAIR_STATUSES)).optional(),
  kind: csv(z.enum(REPAIR_KINDS)).optional(),
  vendor_id: z.uuid().optional(),
  reported_from: instant.optional(),
  reported_to: instant.optional(),
});
export type RepairListQuery = z.output<typeof repairListSchema>;
