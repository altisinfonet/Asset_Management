/**
 * The job catalogue (M1-PLAT-06/07): every queue the system knows, declared in ONE reviewable place.
 *
 * Queues are created by the `migrate` step (owner role, direct connection, `provisionJobs`), not at
 * runtime: the runtime role has no DDL. Adding a job therefore means a line here, then a deploy
 * (which runs `migrate`). `enqueue` and `register` both refuse a queue that is not listed.
 *
 * Rules every entry inherits (docs/03_system_architecture.md 5.2):
 *  - payloads are IDS ONLY (`ids/ids-only.ts`), because `pgboss.*` has no RLS;
 *  - a tenant-scoped queue requires `tenantId` in the payload and its handler runs inside
 *    `withTenantTx(tenantId)`: there is no way to run a tenant handler without tenant context;
 *  - no queue is created with `notify: true` and no instance enables `useListenNotify`
 *    (LISTEN does not work through PgBouncer transaction pooling; workers poll every 1-2 s).
 */
export type JobPriorityClass = 'interactive' | 'scheduled' | 'bulk';

/** pg-boss priority: higher is fetched first. interactive > scheduled > bulk. */
export const PRIORITY: Record<JobPriorityClass, number> = {
  interactive: 20,
  scheduled: 10,
  bulk: 0,
};

/** Which process role registers a handler for the queue. `scheduler` has the owner connection. */
export type JobRunner = 'worker' | 'scheduler';

export interface QueueDefinition {
  name: string;
  /** Payload must carry `tenantId`; the handler runs in a tenant transaction. */
  tenantScoped: boolean;
  priorityClass: JobPriorityClass;
  runsIn: JobRunner;
  /** Attempts after the first failure (pg-boss `retryLimit`) before the job is dead-lettered. */
  retryLimit: number;
  /** Seconds before the first retry; doubles per attempt (exponential backoff) up to `retryDelayMax`. */
  retryDelay: number;
  retryDelayMax?: number;
  /** A job active longer than this is failed and retried (hung handler). */
  expireInSeconds: number;
  /** `singletonSeconds` applied when `enqueue` receives a `singletonKey` (time-slot dedupe). */
  dedupeSeconds?: number;
}

export const DEAD_LETTER_QUEUE = 'dead-letter';

const MINUTE = 60;

export const QUEUES = {
  /** MailSender.send -> worker renders the template and talks SMTP (M1-PLAT-09, ADR 0004). */
  'mail.send': {
    name: 'mail.send',
    tenantScoped: true,
    priorityClass: 'interactive',
    runsIn: 'worker',
    retryLimit: 6,
    retryDelay: 10,
    retryDelayMax: 15 * MINUTE,
    expireInSeconds: 2 * MINUTE,
  },
  /** No-op per-tenant tick, used by tests and as the liveness probe of the scheduler -> worker path. */
  'tenant.heartbeat': {
    name: 'tenant.heartbeat',
    tenantScoped: true,
    priorityClass: 'scheduled',
    runsIn: 'worker',
    retryLimit: 1,
    retryDelay: 5,
    expireInSeconds: MINUTE,
    dedupeSeconds: 60,
  },
  /**
   * Monthly partition rotation (M1-TEN-06). `app.ensure_partitions` is executable by the owner only,
   * so the handler runs in the scheduler role, which holds the direct owner connection.
   */
  'maintenance.partition-rotate': {
    name: 'maintenance.partition-rotate',
    tenantScoped: false,
    priorityClass: 'scheduled',
    runsIn: 'scheduler',
    retryLimit: 3,
    retryDelay: 60,
    expireInSeconds: 5 * MINUTE,
    dedupeSeconds: 6 * 60 * MINUTE,
  },
} as const satisfies Record<string, QueueDefinition>;

export type QueueName = keyof typeof QUEUES;

export function queueDefinition(name: string): QueueDefinition | undefined {
  return (QUEUES as Record<string, QueueDefinition>)[name];
}

export function allQueues(): QueueDefinition[] {
  return Object.values(QUEUES) as QueueDefinition[];
}
