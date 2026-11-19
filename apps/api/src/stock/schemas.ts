import { z } from 'zod';
import { listQuerySchema } from '../platform/index.js';

/**
 * Request schemas of the accessory and consumable endpoints (openapi `AccessoryCreate`,
 * `AccessoryUpdate`, `AccessoryCheckoutRequest`, `AccessoryCheckinRequest`, `ConsumableCreate`,
 * `ConsumableUpdate`, `StockMovementCreate`). Bodies are strict; update schemas carry no defaults
 * (RFC 7396 merge semantics).
 */

const str = () =>
  z.string().refine((v) => !v.includes('\u0000'), 'must not contain NUL characters');
const trimmed = (min: number, max: number) => str().trim().min(min).max(max);
const nullableText = (max: number) => str().trim().max(max).nullable();
export const uuidParam = z.uuid();

/** A calendar date PostgreSQL accepts (year 0000 passes the format check but not the database). */
const isoDate = z.iso
  .date()
  .refine((v) => new Date(`${v}T00:00:00Z`).getUTCFullYear() >= 1, 'year must be 1 or later');

const money = z.strictObject({
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  currency: str().regex(/^[A-Z]{3}$/, 'must be an ISO 4217 code such as USD'),
});

/** `integer` column bound (PostgreSQL `integer`). */
const qty = z.number().int().min(0).max(2_000_000_000);

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

// ------------------------------------------------------------------------------- accessories

const accessoryWritable = {
  category_id: z.uuid(),
  name: trimmed(1, 200),
  manufacturer_id: z.uuid().nullable(),
  vendor_id: z.uuid().nullable(),
  location_id: z.uuid().nullable(),
  company_id: z.uuid(),
  model_number: nullableText(200),
  qty_total: qty,
  min_qty: qty,
  purchase_date: isoDate.nullable(),
  purchase_cost: money.nullable(),
  notes: nullableText(10_000),
};

export const accessoryCreateSchema = z.strictObject({
  category_id: accessoryWritable.category_id,
  name: accessoryWritable.name,
  qty_total: accessoryWritable.qty_total,
  manufacturer_id: accessoryWritable.manufacturer_id.optional(),
  vendor_id: accessoryWritable.vendor_id.optional(),
  location_id: accessoryWritable.location_id.optional(),
  company_id: accessoryWritable.company_id.optional(),
  model_number: accessoryWritable.model_number.optional(),
  min_qty: accessoryWritable.min_qty.optional(),
  purchase_date: accessoryWritable.purchase_date.optional(),
  purchase_cost: accessoryWritable.purchase_cost.optional(),
  notes: accessoryWritable.notes.optional(),
});
export type AccessoryCreate = z.output<typeof accessoryCreateSchema>;

export const accessoryUpdateSchema = z.strictObject({
  category_id: accessoryWritable.category_id.optional(),
  name: accessoryWritable.name.optional(),
  manufacturer_id: accessoryWritable.manufacturer_id.optional(),
  vendor_id: accessoryWritable.vendor_id.optional(),
  location_id: accessoryWritable.location_id.optional(),
  company_id: accessoryWritable.company_id.optional(),
  model_number: accessoryWritable.model_number.optional(),
  qty_total: accessoryWritable.qty_total.optional(),
  min_qty: accessoryWritable.min_qty.optional(),
  purchase_date: accessoryWritable.purchase_date.optional(),
  purchase_cost: accessoryWritable.purchase_cost.optional(),
  notes: accessoryWritable.notes.optional(),
});
export type AccessoryUpdate = z.output<typeof accessoryUpdateSchema>;

const archivedFilter = z.enum(['exclude', 'include', 'only']).default('exclude');

export const accessoryListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedFilter,
  category_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  low_stock: bool.optional(),
});
export type AccessoryListQuery = z.output<typeof accessoryListSchema>;

const TARGETS = ['person_id', 'location_id', 'target_asset_id'] as const;

export const accessoryCheckoutSchema = z
  .strictObject({
    person_id: z.uuid().optional(),
    location_id: z.uuid().optional(),
    target_asset_id: z.uuid().optional(),
    quantity: z.number().int().min(1).max(2_000_000_000).default(1),
    expected_return: isoDate.optional(),
    note: str().trim().max(2000).optional(),
  })
  .superRefine((value, ctx) => {
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
  });
export type AccessoryCheckoutBody = z.output<typeof accessoryCheckoutSchema>;

export const accessoryCheckinSchema = z.strictObject({
  assignment_id: z.uuid(),
  quantity: z.number().int().min(1).max(2_000_000_000).optional(),
  note: str().trim().max(2000).optional(),
});
export type AccessoryCheckinBody = z.output<typeof accessoryCheckinSchema>;

export const accessoryAssignmentsListSchema = listQuerySchema
  .pick({ limit: true, cursor: true })
  .extend({ state: z.enum(['open', 'closed', 'all']).default('open') });
export type AccessoryAssignmentsQuery = z.output<typeof accessoryAssignmentsListSchema>;

// ------------------------------------------------------------------------------- consumables

const consumableWritable = {
  category_id: z.uuid(),
  name: trimmed(1, 200),
  manufacturer_id: z.uuid().nullable(),
  vendor_id: z.uuid().nullable(),
  location_id: z.uuid().nullable(),
  company_id: z.uuid(),
  model_number: nullableText(200),
  unit: trimmed(1, 50),
  min_qty: qty,
  unit_cost: money.nullable(),
  notes: nullableText(10_000),
};

export const consumableCreateSchema = z.strictObject({
  category_id: consumableWritable.category_id,
  name: consumableWritable.name,
  manufacturer_id: consumableWritable.manufacturer_id.optional(),
  vendor_id: consumableWritable.vendor_id.optional(),
  location_id: consumableWritable.location_id.optional(),
  company_id: consumableWritable.company_id.optional(),
  model_number: consumableWritable.model_number.optional(),
  unit: consumableWritable.unit.optional(),
  min_qty: consumableWritable.min_qty.optional(),
  unit_cost: consumableWritable.unit_cost.optional(),
  notes: consumableWritable.notes.optional(),
  initial_qty: qty.optional(),
});
export type ConsumableCreate = z.output<typeof consumableCreateSchema>;

export const consumableUpdateSchema = z.strictObject({
  category_id: consumableWritable.category_id.optional(),
  name: consumableWritable.name.optional(),
  manufacturer_id: consumableWritable.manufacturer_id.optional(),
  vendor_id: consumableWritable.vendor_id.optional(),
  location_id: consumableWritable.location_id.optional(),
  company_id: consumableWritable.company_id.optional(),
  model_number: consumableWritable.model_number.optional(),
  unit: consumableWritable.unit.optional(),
  min_qty: consumableWritable.min_qty.optional(),
  unit_cost: consumableWritable.unit_cost.optional(),
  notes: consumableWritable.notes.optional(),
});
export type ConsumableUpdate = z.output<typeof consumableUpdateSchema>;

export const consumableListSchema = listQuerySchema.extend({
  q: str().min(1).max(200).optional(),
  archived: archivedFilter,
  category_id: z.uuid().optional(),
  location_id: z.uuid().optional(),
  low_stock: bool.optional(),
});
export type ConsumableListQuery = z.output<typeof consumableListSchema>;

export const STOCK_REASONS = ['receive', 'issue', 'return', 'adjust', 'correction'] as const;
export type StockReason = (typeof STOCK_REASONS)[number];

export const stockMovementCreateSchema = z
  .strictObject({
    qty_delta: z.number().int().min(-2_000_000_000).max(2_000_000_000),
    reason: z.enum(STOCK_REASONS),
    person_id: z.uuid().nullable().optional(),
    note: str().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.qty_delta === 0) {
      ctx.addIssue({ code: 'custom', path: ['qty_delta'], message: 'must not be zero' });
    } else if ((v.reason === 'receive' || v.reason === 'return') && v.qty_delta < 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['qty_delta'],
        message: `a ${v.reason} adds stock: use a positive quantity`,
      });
    } else if (v.reason === 'issue' && v.qty_delta > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['qty_delta'],
        message: 'an issue takes stock out: use a negative quantity',
      });
    }
    if ((v.reason === 'adjust' || v.reason === 'correction') && !v.note) {
      ctx.addIssue({
        code: 'custom',
        path: ['note'],
        message: `a ${v.reason} needs a note saying why`,
      });
    }
  });
export type StockMovementCreate = z.output<typeof stockMovementCreateSchema>;

const reasonCsv = z
  .string()
  .max(200)
  .transform((v) =>
    v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  )
  .pipe(z.array(z.enum(STOCK_REASONS)).max(5));

export const stockMovementListSchema = listQuerySchema
  .pick({ limit: true, cursor: true })
  .extend({ reason: reasonCsv.optional(), person_id: z.uuid().optional() });
export type StockMovementListQuery = z.output<typeof stockMovementListSchema>;

export const personStockMovementListSchema = listQuerySchema
  .pick({ limit: true, cursor: true })
  .extend({ reason: reasonCsv.optional() });
export type PersonStockMovementListQuery = z.output<typeof personStockMovementListSchema>;
