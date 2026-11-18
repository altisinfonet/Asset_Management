import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { PgBoss } from 'pg-boss';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { onScrape, setQueueDepth } from '../observability/index.js';
import { runtimeBossOptions } from './boss-options.js';
import { allQueues } from './catalogue.js';
import { PgBossJobQueue } from './job-queue.js';

/**
 * Owns the RUNTIME pg-boss instance of this process (api, worker or scheduler): `app_user`, through
 * PgBouncer, no DDL and no background maintenance (see `boss-options.ts`).
 *
 * Started LAZILY on first use. An api process whose database is briefly unreachable still boots and
 * answers its probes; the first enqueue then connects (and retries on the next call if that failed).
 * The worker and scheduler call {@link get} at startup, where failing fast is what we want.
 */
@Injectable()
export class JobsRuntime implements OnApplicationShutdown {
  private readonly logger = new Logger('Jobs');
  private starting?: Promise<PgBoss>;
  private boss?: PgBoss;
  readonly queue: PgBossJobQueue;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.queue = new PgBossJobQueue(() => this.get());
  }

  /** The started runtime instance (starts it on first call). */
  get(): Promise<PgBoss> {
    this.starting ??= this.start().catch((err: unknown) => {
      this.starting = undefined;
      throw err;
    });
    return this.starting;
  }

  /** True once the instance has started (readiness of worker/scheduler). */
  get started(): boolean {
    return this.boss !== undefined;
  }

  private async start(): Promise<PgBoss> {
    const boss = new PgBoss(
      runtimeBossOptions({
        connectionString: this.config.DATABASE_URL!,
        applicationName: `assettracker-${this.config.APP_ROLE}-jobs`,
        poolMax: this.config.JOBS_POOL_MAX,
        schema: this.config.JOBS_SCHEMA,
      }),
    );
    // An unhandled 'error' event would crash the process; pg-boss reports background failures there.
    boss.on('error', (err) => this.logger.error(`pg-boss error: ${err.message}`));
    boss.on('warning', (w) => this.logger.warn(`pg-boss warning: ${JSON.stringify(w)}`));
    await boss.start();
    this.boss = boss;
    registerQueueDepthCollector(boss);
    return boss;
  }

  async onApplicationShutdown(): Promise<void> {
    const boss = this.boss;
    this.boss = undefined;
    this.starting = undefined;
    if (boss) await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  }
}

/** Queue depth gauges, refreshed at most every 10 s, on scrape (`jobs_queue_depth`). */
export function registerQueueDepthCollector(boss: PgBoss): () => void {
  let lastAt = 0;
  return onScrape(async () => {
    if (Date.now() - lastAt < 10_000) return;
    lastAt = Date.now();
    const names = allQueues().map((q) => q.name);
    const queues = await boss.getQueues([...names, 'dead-letter']);
    for (const q of queues) {
      setQueueDepth(q.name, {
        ready: q.readyCount,
        deferred: q.deferredCount,
        active: q.activeCount,
        failed: q.failedCount,
      });
    }
  });
}
