import { Injectable } from '@nestjs/common';
import type { Logger } from 'pino';
import { outboxEvents } from '../observability/index.js';
import type { TenancyService, Tx } from '../tenancy/index.js';

/** What a subscriber receives. Ids only (see ids/ids-only.ts): fetch details under RLS if needed. */
export interface OutboxDelivery {
  id: string;
  tenantId: string;
  type: string;
  aggregateType: string;
  aggregateId: string;
  payload: Record<string, unknown>;
  /** Envelope version (bumped if this shape changes). */
  version: 1;
  createdAt: Date;
  /** Failed attempts before this one. */
  attempts: number;
}

/**
 * Subscribers run INSIDE the relay's tenant transaction: whatever they write (rows, audit, further
 * outbox events, jobs) commits atomically with the event being marked delivered, which is what
 * makes DB-side effects exactly-once. Side effects outside the database (HTTP, SMTP) are
 * at-least-once; make them idempotent on `event.id`.
 */
export type OutboxSubscriber = (event: OutboxDelivery, ctx: { tx: Tx }) => Promise<void>;

/** `asset.checked_out` (exact), `asset.*` (prefix) or `*` (everything). */
export type OutboxPattern = string;

@Injectable()
export class OutboxSubscribers {
  private readonly subscribers: Array<{ pattern: OutboxPattern; handle: OutboxSubscriber }> = [];

  subscribe(pattern: OutboxPattern, handle: OutboxSubscriber): () => void {
    const entry = { pattern, handle };
    this.subscribers.push(entry);
    return () => {
      const i = this.subscribers.indexOf(entry);
      if (i >= 0) this.subscribers.splice(i, 1);
    };
  }

  handlersFor(type: string): OutboxSubscriber[] {
    return this.subscribers.filter((s) => matches(s.pattern, type)).map((s) => s.handle);
  }
}

function matches(pattern: string, type: string): boolean {
  if (pattern === '*' || pattern === type) return true;
  return pattern.endsWith('.*') && type.startsWith(pattern.slice(0, -1));
}

export interface RelayOptions {
  /** A failing event is dead-lettered after this many failed attempts. */
  maxAttempts: number;
  /** Events handled per tenant per pass. */
  batchPerTenant: number;
  /** Backoff after the Nth failure: `min(maxBackoffSeconds, baseBackoffSeconds * 2^N)`. */
  baseBackoffSeconds: number;
  maxBackoffSeconds: number;
}

export const DEFAULT_RELAY_OPTIONS: RelayOptions = {
  maxAttempts: 8,
  batchPerTenant: 50,
  baseBackoffSeconds: 2,
  maxBackoffSeconds: 3600,
};

export interface RelayPass {
  delivered: number;
  failed: number;
  deadLettered: number;
}

interface ClaimedRow {
  id: string;
  tenant_id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  created_at: Date;
}

/** Thrown inside the claim transaction to roll it back; carries the claimed row's identity. */
class DispatchFailed extends Error {
  constructor(
    readonly eventId: string,
    readonly attempts: number,
    override readonly cause: unknown,
  ) {
    super(`dispatch of outbox event ${eventId} failed`);
  }
}

/**
 * The outbox relay (worker role, M1-PLAT-05). Per active tenant and pass it repeats, ONE event per
 * transaction:
 *
 *   BEGIN; set tenant context;
 *   SELECT ... FROM app.outbox_event WHERE pending AND next_attempt_at <= now()
 *     ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED;            -- claim (concurrent relays skip it)
 *   run the in-process subscribers (they get the same tx);
 *   UPDATE ... SET published_at = now();  COMMIT;             -- delivered, exactly once
 *
 * A subscriber failure ROLLS BACK that transaction (the claim and anything the subscriber wrote),
 * then a separate short transaction records the failure: attempts + 1, exponential
 * `next_attempt_at`, `last_error`; at `maxAttempts` the row is dead-lettered (`dead_lettered_at`) and
 * skipped until an operator clears it. SKIP LOCKED makes any number of relays safe: a claimed event
 * is invisible to the others until it commits or rolls back.
 *
 * Events with no subscriber are marked delivered (nothing to do), so the table does not grow.
 * Ordering: by id (UUIDv7, creation order) within a tenant, except that a failing event waits out
 * its backoff while later events proceed.
 */
export class OutboxRelay {
  private timer?: NodeJS.Timeout;
  private pass?: Promise<void>;
  private stopped = false;

  constructor(
    private readonly deps: {
      tenancy: Pick<TenancyService, 'withTenantTx'>;
      tenants: () => Promise<Array<{ tenantId: string }>>;
      subscribers: OutboxSubscribers;
      logger: Logger;
      options?: Partial<RelayOptions>;
    },
  ) {}

  private get options(): RelayOptions {
    return { ...DEFAULT_RELAY_OPTIONS, ...this.deps.options };
  }

  start(intervalMs: number): void {
    this.stopped = false;
    const loop = () => {
      if (this.stopped) return;
      this.pass = this.runOnce()
        .then(() => undefined)
        .catch((err: unknown) => this.deps.logger.error({ err }, 'outbox relay pass failed'))
        .finally(() => {
          if (!this.stopped) {
            this.timer = setTimeout(loop, intervalMs);
            this.timer.unref();
          }
        });
    };
    loop();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    await this.pass;
  }

  /** One pass over every active tenant. */
  async runOnce(): Promise<RelayPass> {
    const total: RelayPass = { delivered: 0, failed: 0, deadLettered: 0 };
    const tenants = await this.deps.tenants();
    for (const { tenantId } of tenants) {
      const r = await this.drainTenant(tenantId);
      total.delivered += r.delivered;
      total.failed += r.failed;
      total.deadLettered += r.deadLettered;
    }
    return total;
  }

  private async drainTenant(tenantId: string): Promise<RelayPass> {
    const result: RelayPass = { delivered: 0, failed: 0, deadLettered: 0 };
    const { batchPerTenant, maxAttempts } = this.options;
    for (let i = 0; i < batchPerTenant; i++) {
      try {
        const handled = await this.deps.tenancy.withTenantTx(
          { tenantId, requestId: 'outbox-relay' },
          (tx) => this.claimAndDispatch(tx, tenantId),
        );
        if (!handled) break;
        result.delivered += 1;
        outboxEvents.inc({ result: 'delivered' });
      } catch (err) {
        if (!(err instanceof DispatchFailed)) throw err;
        const dead = err.attempts + 1 >= maxAttempts;
        await this.recordFailure(tenantId, err, dead);
        result.failed += 1;
        outboxEvents.inc({ result: 'failed' });
        if (dead) {
          result.deadLettered += 1;
          outboxEvents.inc({ result: 'dead_lettered' });
        }
      }
    }
    return result;
  }

  /** Returns false when nothing is pending. Throws DispatchFailed (rolling back) on subscriber failure. */
  private async claimAndDispatch(tx: Tx, tenantId: string): Promise<boolean> {
    const rows = await tx.$queryRaw<ClaimedRow[]>`
      select id, tenant_id, event_type, aggregate_type, aggregate_id, payload, attempts, created_at
        from app.outbox_event
       where published_at is null and dead_lettered_at is null and next_attempt_at <= now()
       order by id
       limit 1
         for update skip locked`;
    const row = rows[0];
    if (!row) return false;

    const event: OutboxDelivery = {
      id: row.id,
      tenantId: row.tenant_id ?? tenantId,
      type: row.event_type,
      aggregateType: row.aggregate_type,
      aggregateId: row.aggregate_id,
      payload: row.payload,
      version: 1,
      createdAt: row.created_at,
      attempts: row.attempts,
    };
    try {
      for (const handle of this.deps.subscribers.handlersFor(event.type))
        await handle(event, { tx });
    } catch (cause) {
      throw new DispatchFailed(row.id, row.attempts, cause);
    }
    await tx.$executeRaw`
      update app.outbox_event set published_at = now(), last_error = null where id = ${row.id}::uuid`;
    return true;
  }

  private async recordFailure(
    tenantId: string,
    failure: DispatchFailed,
    dead: boolean,
  ): Promise<void> {
    const { baseBackoffSeconds, maxBackoffSeconds } = this.options;
    const delay = Math.min(maxBackoffSeconds, baseBackoffSeconds * 2 ** failure.attempts);
    const message = (
      failure.cause instanceof Error ? failure.cause.message : String(failure.cause)
    ).slice(0, 1000);
    this.deps.logger.warn(
      {
        tenant_id: tenantId,
        event_id: failure.eventId,
        attempts: failure.attempts + 1,
        dead,
        err: message,
      },
      dead ? 'outbox event dead-lettered' : 'outbox dispatch failed, will retry',
    );
    await this.deps.tenancy.withTenantTx({ tenantId, requestId: 'outbox-relay' }, async (tx) => {
      await tx.$executeRaw`
        update app.outbox_event
           set attempts = attempts + 1,
               last_error = ${message}::text,
               next_attempt_at = now() + make_interval(secs => ${delay}::double precision),
               dead_lettered_at = case when ${dead}::boolean then now() else null end
         where id = ${failure.eventId}::uuid and published_at is null`;
    });
  }
}
