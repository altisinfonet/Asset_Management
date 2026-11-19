import type { OutboxPublisher } from '../ports/index.js';
import type { Tx } from '../tenancy/index.js';

/**
 * Minimum-stock alerts (M2-ACC-03, ADR 0008). An item is LOW while `min_qty > 0` and its quantity
 * (consumable: on hand; accessory: available = total minus units out) is at or below `min_qty` (the
 * same rule as the view `v_low_stock` and the `low_stock` flag of the representation).
 *
 * `low_stock_alerted` is the per-item latch: it is set in the SAME statement that detects the
 * crossing, and an event is published only when that statement changed the latch from false to
 * true, so a crossing emits exactly one `consumable.low_stock` / `accessory.low_stock` outbox event
 * however many movements happen while the item stays low. Restocking above the minimum clears the
 * latch (re-arm); the next crossing alerts again. Callers hold the row lock of the item (the ledger
 * trigger, `FOR UPDATE`, or the UPDATE itself) so two concurrent changes cannot both observe the
 * crossing. The event carries ids only: the subscriber reads the item.
 */
export type LowStockChange = 'raised' | 'cleared' | null;

export async function reevaluateConsumable(
  trx: Tx,
  outbox: OutboxPublisher,
  id: string,
  cause: { movementId?: string } = {},
): Promise<LowStockChange> {
  const rows = await trx.$queryRaw<Array<{ alerted: boolean }>>`
    update app.consumable c
       set low_stock_alerted = (c.min_qty > 0 and c.qty_on_hand <= c.min_qty)
     where c.id = ${id}::uuid and c.archived_at is null
       and c.low_stock_alerted is distinct from (c.min_qty > 0 and c.qty_on_hand <= c.min_qty)
    returning c.low_stock_alerted as alerted`;
  const changed = rows[0];
  if (!changed) return null;
  if (changed.alerted) {
    await outbox.publish(trx, {
      type: 'consumable.low_stock',
      aggregateType: 'consumable',
      aggregateId: id,
      payload: { consumableId: id, ...(cause.movementId ? { movementId: cause.movementId } : {}) },
    });
    return 'raised';
  }
  return 'cleared';
}

export async function reevaluateAccessory(
  trx: Tx,
  outbox: OutboxPublisher,
  id: string,
  cause: { assignmentId?: string } = {},
): Promise<LowStockChange> {
  const rows = await trx.$queryRaw<Array<{ alerted: boolean }>>`
    with now_low as (
      select a.id,
             (a.min_qty > 0 and a.qty_total - coalesce((
                select sum(s.quantity - s.quantity_returned)
                  from app.assignment s
                 where s.tenant_id = a.tenant_id and s.accessory_id = a.id and s.checked_in_at is null
              ), 0) <= a.min_qty) as low
        from app.accessory a
       where a.id = ${id}::uuid and a.archived_at is null)
    update app.accessory x
       set low_stock_alerted = n.low
      from now_low n
     where x.id = n.id and x.low_stock_alerted is distinct from n.low
    returning x.low_stock_alerted as alerted`;
  const changed = rows[0];
  if (!changed) return null;
  if (changed.alerted) {
    await outbox.publish(trx, {
      type: 'accessory.low_stock',
      aggregateType: 'accessory',
      aggregateId: id,
      payload: {
        accessoryId: id,
        ...(cause.assignmentId ? { assignmentId: cause.assignmentId } : {}),
      },
    });
    return 'raised';
  }
  return 'cleared';
}
