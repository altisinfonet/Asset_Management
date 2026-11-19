import type { Logger } from 'pino';
import type { ControlPlaneService } from '../control-plane/index.js';
import type { PgBossJobQueue } from './job-queue.js';

/**
 * A cron-like producer: every `everySeconds` it enqueues a job, one per ACTIVE TENANT (enumerated
 * from the control plane: ids and status only) or one global job.
 *
 * SINGLETON KEYS make two schedulers safe: each job is enqueued with
 * `singletonKey = <producer>[:<tenantId>]` and `singletonSeconds = everySeconds`, which pg-boss
 * turns into a unique index on (queue, time slot, key). Whichever scheduler inserts first wins; the
 * other gets `null` back (the adapter returns ''). A restart or a second replica cannot duplicate a
 * run inside the same slot, and nothing needs a lock.
 */
export interface Producer {
  name: string;
  queue: string;
  everySeconds: number;
  perTenant: boolean;
}

export const PRODUCERS: readonly Producer[] = [
  { name: 'tenant-heartbeat', queue: 'tenant.heartbeat', everySeconds: 60, perTenant: true },
  // Daily: rolls the partition window forward (a monthly rotation would leave no margin for a missed run).
  {
    name: 'partition-rotate',
    queue: 'maintenance.partition-rotate',
    everySeconds: 24 * 3600,
    perTenant: false,
  },
  // M2-FILE-02: orphan sweep (abandoned uploads, lost scan jobs), every 5 minutes per tenant.
  { name: 'attachment-sweep', queue: 'attachment.sweep', everySeconds: 300, perTenant: true },
  // M2-NOT-01: the daily notification digest (one email per user), M2-REG-02: expired export files.
  { name: 'notification-digest', queue: 'notification.digest', everySeconds: 86_400, perTenant: true },
  { name: 'export-sweep', queue: 'export.sweep', everySeconds: 3600, perTenant: true },
];

export interface SchedulerDeps {
  queue: Pick<PgBossJobQueue, 'enqueue'>;
  controlPlane: Pick<ControlPlaneService, 'listActiveTenants'>;
  logger: Logger;
  producers?: readonly Producer[];
  now?: () => number;
}

export class Scheduler {
  private readonly lastBucket = new Map<string, number>();
  private timer?: NodeJS.Timeout;
  private running = Promise.resolve();

  constructor(private readonly deps: SchedulerDeps) {}

  /** Re-evaluates every `tickSeconds`. A producer fans out once per time slot per process. */
  start(tickSeconds: number): void {
    const tick = () => {
      this.running = this.running
        .then(async () => {
          await this.tick();
        })
        .catch((err: unknown) => this.deps.logger.error({ err }, 'scheduler tick failed'));
    };
    tick();
    this.timer = setInterval(tick, tickSeconds * 1000);
    this.timer.unref();
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.running;
  }

  /** One evaluation; returns how many jobs were actually inserted (deduplicated ones excluded). */
  async tick(): Promise<number> {
    const now = (this.deps.now ?? Date.now)();
    let inserted = 0;
    for (const producer of this.deps.producers ?? PRODUCERS) {
      const bucket = Math.floor(now / (producer.everySeconds * 1000));
      if (this.lastBucket.get(producer.name) === bucket) continue;
      inserted += await this.produce(producer, bucket);
      this.lastBucket.set(producer.name, bucket);
    }
    return inserted;
  }

  private async produce(producer: Producer, bucket: number): Promise<number> {
    const { queue, controlPlane, logger } = this.deps;
    let inserted = 0;
    if (!producer.perTenant) {
      const id = await queue.enqueue(
        producer.queue,
        { bucket },
        {
          singletonKey: producer.name,
          singletonSeconds: producer.everySeconds,
        },
      );
      return id ? 1 : 0;
    }
    const tenants = await controlPlane.listActiveTenants();
    for (const tenant of tenants) {
      const id = await queue.enqueue(
        producer.queue,
        { tenantId: tenant.tenantId, bucket },
        {
          singletonKey: `${producer.name}:${tenant.tenantId}`,
          singletonSeconds: producer.everySeconds,
        },
      );
      if (id) inserted += 1;
    }
    logger.debug(
      { producer: producer.name, tenants: tenants.length, inserted },
      'fan-out enqueued',
    );
    return inserted;
  }
}
