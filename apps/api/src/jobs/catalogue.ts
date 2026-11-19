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
  /**
   * Time limit of the tenant transaction the handler runs in (default 30 s, `DEFAULT_TX_OPTIONS`). Only
   * for jobs that legitimately compute for longer, such as rendering a large PDF.
   */
  transactionTimeoutSeconds?: number;
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
  // ---- M2 files (M2-FILE-02/03) ------------------------------------------------------------
  /** Stream a confirmed upload to ClamAV; clean -> thumbnail, infected -> delete + notify. */
  'attachment.scan': {
    name: 'attachment.scan',
    tenantScoped: true,
    priorityClass: 'interactive',
    runsIn: 'worker',
    retryLimit: 6,
    retryDelay: 10,
    retryDelayMax: 10 * MINUTE,
    expireInSeconds: 5 * MINUTE,
    dedupeSeconds: 5 * MINUTE,
  },
  /** Re-encode a clean image into a metadata-free WebP thumbnail (sharp). */
  'attachment.thumbnail': {
    name: 'attachment.thumbnail',
    tenantScoped: true,
    priorityClass: 'scheduled',
    runsIn: 'worker',
    retryLimit: 3,
    retryDelay: 15,
    expireInSeconds: 3 * MINUTE,
    dedupeSeconds: 5 * MINUTE,
  },
  /** Orphan sweep: abandoned uploads, lost scan jobs (per tenant, from the scheduler). */
  'attachment.sweep': {
    name: 'attachment.sweep',
    tenantScoped: true,
    priorityClass: 'scheduled',
    runsIn: 'worker',
    retryLimit: 1,
    retryDelay: 30,
    expireInSeconds: 5 * MINUTE,
    dedupeSeconds: 5 * MINUTE,
  },
  // ---- [M2-W2 LABELS] M2-TAG-02 ------------------------------------------------------------
  /** Render a label batch into a PDF (pdfkit + bwip-js), store it, flip the batch to ready. */
  'label.render': {
    name: 'label.render',
    tenantScoped: true,
    priorityClass: 'interactive',
    runsIn: 'worker',
    retryLimit: 3,
    retryDelay: 10,
    retryDelayMax: 5 * MINUTE,
    expireInSeconds: 5 * MINUTE,
    dedupeSeconds: 10 * MINUTE,
    transactionTimeoutSeconds: 2 * MINUTE,
  },
  /** Delete expired label files, re-queue render jobs that were lost (per tenant, from the scheduler). */
  'label.sweep': {
    name: 'label.sweep',
    tenantScoped: true,
    priorityClass: 'scheduled',
    runsIn: 'worker',
    retryLimit: 1,
    retryDelay: 30,
    expireInSeconds: 5 * MINUTE,
    dedupeSeconds: 10 * MINUTE,
  },
  // ---- M2 wave 2 (notifications, exports) -----------------------------------------------------
  /** Daily per tenant: one digest email per user with notifications waiting in the digest (M2-NOT-01). */
  'notification.digest': {
    name: 'notification.digest',
    tenantScoped: true,
    priorityClass: 'scheduled',
    runsIn: 'worker',
    retryLimit: 3,
    retryDelay: 60,
    retryDelayMax: 15 * MINUTE,
    expireInSeconds: 10 * MINUTE,
    dedupeSeconds: 6 * 60 * MINUTE,
  },
  /** Writes one CSV export through the StorageAdapter (M2-REG-02). Ids only: { tenantId, exportId }. */
  'export.run': {
    name: 'export.run',
    tenantScoped: true,
    priorityClass: 'bulk',
    runsIn: 'worker',
    retryLimit: 2,
    retryDelay: 30,
    retryDelayMax: 5 * MINUTE,
    expireInSeconds: 30 * MINUTE,
    dedupeSeconds: 5 * MINUTE,
  },
  /** Deletes the files of exports older than their retention and marks them expired (per tenant, hourly). */
  'export.sweep': {
    name: 'export.sweep',
    tenantScoped: true,
    priorityClass: 'scheduled',
    runsIn: 'worker',
    retryLimit: 1,
    retryDelay: 30,
    expireInSeconds: 5 * MINUTE,
    dedupeSeconds: 30 * MINUTE,
  },
} as const satisfies Record<string, QueueDefinition>;

export type QueueName = keyof typeof QUEUES;

export function queueDefinition(name: string): QueueDefinition | undefined {
  return (QUEUES as Record<string, QueueDefinition>)[name];
}

export function allQueues(): QueueDefinition[] {
  return Object.values(QUEUES) as QueueDefinition[];
}
