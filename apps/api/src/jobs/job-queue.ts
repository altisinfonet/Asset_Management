import type { PgBoss, SendOptions } from 'pg-boss';
import { assertIdsOnlyPayload } from '../ids/ids-only.js';
import type { JobQueue } from '../ports/index.js';
import { currentTenantContext, type Tx } from '../tenancy/index.js';
import { PRIORITY, type QueueDefinition, queueDefinition } from './catalogue.js';
import { dbFromTx } from './tx-db.js';

/** What the adapter adds beyond the port's options (used by the scheduler). */
export interface EnqueueOptions {
  tx?: Tx;
  startAfterSeconds?: number;
  /**
   * With a queue `dedupeSeconds` (or `singletonSeconds` here): at most ONE job per key per time slot
   * across all processes, enforced by a unique index in the database. This is what makes two
   * schedulers safe. A deduplicated enqueue returns `null`.
   */
  singletonKey?: string;
  singletonSeconds?: number;
}

export class UnknownQueueError extends Error {
  constructor(name: string) {
    super(
      `unknown job queue "${name}": declare it in src/jobs/catalogue.ts (queues are created by migrate)`,
    );
    this.name = 'UnknownQueueError';
  }
}

export class TenantPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TenantPayloadError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The job payload lint, shared by the pg-boss adapter and the in-memory queue of the e2e suite (so every
 * job a test makes the application queue is checked by the same rules): the queue is in the catalogue,
 * the payload is ids only, and a tenant-scoped queue carries a `tenantId` that, when the job is queued
 * inside a tenant transaction (`inTx`), is the tenant of that transaction. Returns the queue definition.
 */
export function assertEnqueueable(
  name: string,
  payload: { tenantId?: string } & Record<string, unknown>,
  inTx = false,
): QueueDefinition {
  const def = queueDefinition(name);
  if (!def) throw new UnknownQueueError(name);
  assertIdsOnlyPayload(payload, `job ${name}`);

  if (def.tenantScoped) {
    const tenantId = payload.tenantId;
    if (typeof tenantId !== 'string' || !UUID.test(tenantId)) {
      throw new TenantPayloadError(
        `job ${name} is tenant scoped: payload.tenantId (uuid) is required`,
      );
    }
    const ambient = inTx ? currentTenantContext()?.tenantId : undefined;
    if (inTx && ambient && ambient.toLowerCase() !== tenantId.toLowerCase()) {
      throw new TenantPayloadError(
        `job ${name} for tenant ${tenantId} cannot be enqueued inside the transaction of tenant ${ambient}`,
      );
    }
  }
  return def;
}

/**
 * `JobQueue` port implementation over pg-boss (M1-PLAT-06). pg-boss never leaks past this adapter.
 *
 * With `opts.tx` the job row is inserted through the caller's tenant transaction
 * (`send(..., { db: { executeSql } })`): rolled back with it, visible to workers only after it
 * commits. Without `tx` the job is sent immediately on pg-boss's own pooled connection.
 *
 * Enforced here, before anything is written:
 *  - the queue is in the catalogue;
 *  - the payload is ids only (`ids/ids-only.ts`);
 *  - a tenant-scoped queue carries a `tenantId`, and when a tenant transaction is passed it is THAT
 *    tenant (a job for tenant B cannot be queued from inside tenant A's transaction).
 */
export class PgBossJobQueue implements JobQueue {
  constructor(private readonly boss: () => Promise<PgBoss>) {}

  async enqueue(
    name: string,
    payload: { tenantId?: string } & Record<string, unknown>,
    opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const def = assertEnqueueable(name, payload, Boolean(opts.tx));

    const options: SendOptions = { priority: PRIORITY[def.priorityClass] };
    if (opts.tx) options.db = dbFromTx(opts.tx);
    // Per-tenant fairness: pg-boss group concurrency limits (see worker `localGroupConcurrency`).
    if (def.tenantScoped) options.group = { id: String(payload.tenantId) };
    if (opts.startAfterSeconds && opts.startAfterSeconds > 0)
      options.startAfter = opts.startAfterSeconds;
    if (opts.singletonKey) {
      options.singletonKey = opts.singletonKey;
      const seconds = opts.singletonSeconds ?? def.dedupeSeconds;
      if (seconds) options.singletonSeconds = seconds;
    }

    const boss = await this.boss();
    const id = await boss.send(name, payload, options);
    return id ?? null;
  }
}
