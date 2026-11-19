import type { Accessory, Assignment, Consumable, StockKind } from './api';

/**
 * Pure helpers of the accessories and consumables screens: stock levels, the quantity limits of a
 * hand-out or return, and the delta of a stock count.
 */
export type StockLevel = 'ok' | 'low' | 'out';

/**
 * How much is left compared with the minimum. `out` is nothing left; `low` is at or below a
 * minimum that was set (a minimum of 0 means "no alert"); otherwise `ok`. This is the same
 * threshold the API's `low_stock` filter and the `stock.low` alert use.
 */
export function stockLevel(available: number, minimum: number): StockLevel {
  if (available <= 0) return 'out';
  if (minimum > 0 && available <= minimum) return 'low';
  return 'ok';
}

/** Units the shelf has: what is available for an accessory, what is on hand for a consumable. */
export function unitsLeft(item: Accessory | Consumable, kind: StockKind): number {
  return kind === 'accessory'
    ? ((item as Accessory).qty_available ?? 0)
    : ((item as Consumable).qty_on_hand ?? 0);
}

export function levelOf(item: Accessory | Consumable, kind: StockKind): StockLevel {
  return stockLevel(unitsLeft(item, kind), item.min_qty ?? 0);
}

/** Share of the stock that is still on the shelf, 0..1 (for the level bar); 1 when nothing is tracked. */
export function shelfShare(item: Accessory | Consumable, kind: StockKind): number {
  if (kind === 'accessory') {
    const accessory = item as Accessory;
    return accessory.qty_total > 0
      ? Math.min(1, (accessory.qty_available ?? 0) / accessory.qty_total)
      : 0;
  }
  const onHand = (item as Consumable).qty_on_hand ?? 0;
  const ceiling = Math.max(onHand, (item.min_qty ?? 0) * 2, 1);
  return Math.min(1, onHand / ceiling);
}

/** Units of an assignment that are still out. */
export function outstanding(
  assignment: Pick<Assignment, 'quantity' | 'quantity_returned'>,
): number {
  return Math.max(0, assignment.quantity - assignment.quantity_returned);
}

/**
 * `qty_delta` of a stock count: the stock ends at `counted`. Zero means nothing to adjust, which
 * the API refuses (`qty_delta` is never 0).
 */
export function adjustmentDelta(onHand: number, counted: number): number {
  return counted - onHand;
}

/** A whole number >= 0 typed in a field, or `null` for empty / not a whole number. */
export function parseCount(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  return Number(trimmed);
}
