import { currentBulkSink } from '../context/bulk-writes.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { assertIdsOnlyPayload } from '../ids/ids-only.js';
import type { OutboxEvent, OutboxPublisher } from '../ports/index.js';
import type { Tx } from '../tenancy/index.js';

/** `asset.checked_out`, `user.invited`: dotted, lower-case, at least two segments. */
const EVENT_TYPE = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;
const AGGREGATE_TYPE = /^[a-z][a-z0-9_]{0,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Inserts the event into `app.outbox_event` inside the caller's transaction (M1-PLAT-05): it exists
 * if and only if the business change commits. The tenant comes from the transaction's `app.tenant_id`
 * (RLS WITH CHECK enforces it), never from the caller.
 *
 * PAYLOAD RULE: ids only (see `ids/ids-only.ts`). The relay and every subscriber read the payload
 * with the tenant context but WITHOUT the originating request's authorisation, and webhooks (M5)
 * forward events outside the system, so an event says WHAT happened to WHICH entity and carries
 * references (ids, versions); consumers fetch the current representation through the API/repository
 * under RLS. `aggregateId` + `type` + the ids in `payload` are the "API representation reference".
 */
export class PgOutboxPublisher implements OutboxPublisher {
  async publish(tx: Tx, event: OutboxEvent): Promise<void> {
    if (!EVENT_TYPE.test(event.type)) {
      throw new Error(
        `invalid outbox event type "${event.type}" (expected e.g. asset.checked_out)`,
      );
    }
    if (!AGGREGATE_TYPE.test(event.aggregateType)) {
      throw new Error(`invalid outbox aggregate type "${event.aggregateType}"`);
    }
    if (!UUID.test(event.aggregateId)) throw new Error('outbox aggregateId must be a UUID');
    assertIdsOnlyPayload(event.payload, `outbox event ${event.type}`);

    const sink = currentBulkSink();
    if (sink) {
      sink.outbox.push({
        id: uuidv7(),
        event_type: event.type,
        aggregate_type: event.aggregateType,
        aggregate_id: event.aggregateId,
        payload: JSON.stringify(event.payload),
      });
      return;
    }

    await tx.$executeRaw`
      insert into app.outbox_event (id, tenant_id, event_type, aggregate_type, aggregate_id, payload)
      values (${uuidv7()}::uuid,
              (select nullif(current_setting('app.tenant_id', true), '')::uuid),
              ${event.type}::text, ${event.aggregateType}::text, ${event.aggregateId}::uuid,
              ${JSON.stringify(event.payload)}::jsonb)`;
  }
}

/** One multi-row INSERT of the events a bulk job collected. */
export async function flushOutboxRows(tx: Tx, rows: Array<Record<string, unknown>>): Promise<void> {
  if (rows.length === 0) return;
  const col = (key: string) => rows.map((r) => r[key] as string);
  await tx.$executeRaw`
    insert into app.outbox_event (id, tenant_id, event_type, aggregate_type, aggregate_id, payload)
    select t.id::uuid, (select nullif(current_setting('app.tenant_id', true), '')::uuid),
           t.event_type, t.aggregate_type, t.aggregate_id::uuid, t.payload::jsonb
      from unnest(${col('id')}::text[], ${col('event_type')}::text[], ${col('aggregate_type')}::text[],
                  ${col('aggregate_id')}::text[], ${col('payload')}::text[])
           as t(id, event_type, aggregate_type, aggregate_id, payload)`;
}
