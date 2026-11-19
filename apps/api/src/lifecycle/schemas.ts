import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/** Request schemas of the custody endpoints (openapi `CheckoutRequest`, `CheckinRequest`, `TransferRequest`). */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
export const uuidParam = z.uuid();

/** A calendar date PostgreSQL accepts (year 0000 passes the format check but not the database). */
const isoDate = z.iso
  .date()
  .refine((v) => new Date(`${v}T00:00:00Z`).getUTCFullYear() >= 1, 'year must be 1 or later');

/**
 * Ids of photos / signatures to link to the custody record. Only the uuid format is checked here:
 * the attachments service (a parallel M2 story) owns the files, and the integrator adds the
 * existence / ownership validation when the two meet (see migration 0041).
 */
const attachmentIds = z
  .array(z.uuid())
  .max(10)
  .transform((ids) => [...new Set(ids.map((i) => i.toLowerCase()))]);

const TARGETS = ['person_id', 'location_id', 'target_asset_id'] as const;
const targetShape = {
  person_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  target_asset_id: z.uuid().optional(),
};

/** Exactly one of person / location / asset (schema `AssignmentTarget`). */
function exactlyOneTarget(
  value: Partial<Record<(typeof TARGETS)[number], unknown>>,
  ctx: z.RefinementCtx,
) {
  const given = TARGETS.filter((k) => value[k] !== undefined);
  if (given.length !== 1) {
    ctx.addIssue({
      code: 'custom',
      path: [given[0] ?? TARGETS[0]],
      message:
        given.length === 0
          ? 'exactly one of person_id, location_id and target_asset_id is required'
          : 'send only one of person_id, location_id and target_asset_id',
    });
  }
}

export const checkoutSchema = z
  .strictObject({
    ...targetShape,
    expected_return: isoDate.optional(),
    note: str().trim().max(2000).optional(),
    acceptance_required: z.boolean().optional(),
    attachment_ids: attachmentIds.optional(),
  })
  .superRefine(exactlyOneTarget);
export type CheckoutBody = z.output<typeof checkoutSchema>;

export const checkinSchema = z.strictObject({
  checkin_location_id: z.uuid().nullable().optional(),
  status_id: z.uuid().nullable().optional(),
  note: str().trim().max(2000).optional(),
  attachment_ids: attachmentIds.optional(),
});
export type CheckinBody = z.output<typeof checkinSchema>;

export const transferSchema = z
  .strictObject({
    ...targetShape,
    to_location_id: z.uuid().nullable().optional(),
    expected_return: isoDate.optional(),
    reason: str().trim().max(500).optional(),
    note: str().trim().max(2000).optional(),
    attachment_ids: attachmentIds.optional(),
  })
  .superRefine(exactlyOneTarget);
export type TransferBody = z.output<typeof transferSchema>;

export const assetAssignmentsListSchema = listQuerySchema.pick({ limit: true, cursor: true });
export type AssetAssignmentsQuery = z.output<typeof assetAssignmentsListSchema>;

export const personAssignmentsListSchema = listQuerySchema
  .pick({ limit: true, cursor: true })
  .extend({
    state: z.enum(['open', 'closed', 'all']).default('open'),
  });
export type PersonAssignmentsQuery = z.output<typeof personAssignmentsListSchema>;

export const personHistoryListSchema = listQuerySchema.pick({ limit: true, cursor: true });
export type PersonHistoryQuery = z.output<typeof personHistoryListSchema>;
