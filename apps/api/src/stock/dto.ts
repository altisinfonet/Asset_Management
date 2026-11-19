import type { Tx } from '../tenancy/index.js';

type AccessoryRow = NonNullable<Awaited<ReturnType<Tx['accessory']['findUnique']>>>;
type ConsumableRow = NonNullable<Awaited<ReturnType<Tx['consumable']['findUnique']>>>;

const day = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

const money = (minor: bigint | null, currency: string | null) =>
  minor === null || currency === null ? null : { amount_minor: Number(minor), currency };

/** True while the minimum is set and the available / on-hand quantity is at or below it. */
export const isLow = (available: number, min: number): boolean => min > 0 && available <= min;

/** Schema `Accessory`. `qtyOut` is computed per request from the open assignments. */
export function accessoryDto(r: AccessoryRow, qtyOut: number) {
  const available = r.qty_total - qtyOut;
  return {
    id: r.id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    archived_at: r.archived_at ? r.archived_at.toISOString() : null,
    category_id: r.category_id,
    name: r.name,
    manufacturer_id: r.manufacturer_id,
    vendor_id: r.vendor_id,
    location_id: r.location_id,
    company_id: r.company_id,
    model_number: r.model_number,
    qty_total: r.qty_total,
    min_qty: r.min_qty,
    purchase_date: day(r.purchase_date),
    purchase_cost: money(r.purchase_cost_minor, r.currency),
    notes: r.notes,
    qty_checked_out: qtyOut,
    qty_available: available,
    low_stock: isLow(available, r.min_qty),
    label_code: r.label_code,
  };
}
export type AccessoryDto = ReturnType<typeof accessoryDto>;

/** Schema `Consumable`. */
export function consumableDto(r: ConsumableRow) {
  return {
    id: r.id,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
    archived_at: r.archived_at ? r.archived_at.toISOString() : null,
    category_id: r.category_id,
    name: r.name,
    manufacturer_id: r.manufacturer_id,
    vendor_id: r.vendor_id,
    location_id: r.location_id,
    company_id: r.company_id,
    model_number: r.model_number,
    unit: r.unit,
    min_qty: r.min_qty,
    unit_cost: money(r.unit_cost_minor, r.currency),
    notes: r.notes,
    qty_on_hand: r.qty_on_hand,
    low_stock: isLow(r.qty_on_hand, r.min_qty),
    label_code: r.label_code,
  };
}
export type ConsumableDto = ReturnType<typeof consumableDto>;

/** Audit view: no timestamps, no computed members, no label code (it is not a business field). */
export const auditView = (dto: Record<string, unknown>) => {
  const {
    created_at: _c,
    updated_at: _u,
    qty_checked_out: _o,
    qty_available: _a,
    low_stock: _l,
    label_code: _code,
    ...rest
  } = dto;
  return rest;
};

/** Units still out per accessory: `sum(quantity - quantity_returned)` over the open assignments. */
export async function outstandingByAccessory(
  trx: Tx,
  ids: readonly string[],
): Promise<Map<string, number>> {
  if (ids.length === 0) return new Map();
  const rows = await trx.$queryRaw<Array<{ accessory_id: string; n: number }>>`
    select accessory_id, coalesce(sum(quantity - quantity_returned), 0)::int as n
      from app.assignment
     where accessory_id = any(${ids as string[]}::uuid[]) and checked_in_at is null
     group by accessory_id`;
  return new Map(rows.map((r) => [r.accessory_id, r.n]));
}

/** Ids of the live items at or below their minimum (the view `v_low_stock`; minimum > 0 only). */
export async function lowStockIds(trx: Tx, type: 'accessory' | 'consumable'): Promise<string[]> {
  const rows = await trx.$queryRaw<Array<{ item_id: string }>>`
    select item_id from app.v_low_stock where item_type = ${type}`;
  return rows.map((r) => r.item_id);
}

export interface MovementRow {
  id: string;
  consumable_id: string;
  qty_delta: number;
  reason: string;
  person_id: string | null;
  note: string | null;
  balance_after: number;
  by_user_id: string | null;
  at: Date;
  consumable_name?: string | null;
  person_name?: string | null;
}

/** Schema `StockMovement`. The names are present in the lists only. */
export function movementDto(r: MovementRow) {
  return {
    id: r.id,
    consumable_id: r.consumable_id,
    qty_delta: r.qty_delta,
    reason: r.reason,
    person_id: r.person_id,
    note: r.note,
    balance_after: r.balance_after,
    by_user_id: r.by_user_id,
    at: r.at.toISOString(),
    ...(r.consumable_name !== undefined ? { consumable_name: r.consumable_name } : {}),
    ...(r.person_name !== undefined ? { person_name: r.person_name } : {}),
  };
}
export type MovementDto = ReturnType<typeof movementDto>;
