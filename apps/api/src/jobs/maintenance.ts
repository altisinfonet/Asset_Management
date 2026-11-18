import { PgBoss } from 'pg-boss';
import type { Logger } from 'pino';
import { maintenanceBossOptions } from './boss-options.js';

/**
 * The pg-boss MAINTENANCE instance (`supervise` on): expires hung jobs, applies retention and
 * archival, refreshes queue statistics. Owner role over a DIRECT connection; it runs in the
 * scheduler role and nowhere else. It never sends or fetches jobs.
 */
export class MaintenanceInstance {
  private boss?: PgBoss;

  constructor(
    private readonly ownerDatabaseUrl: string,
    private readonly logger: Logger,
    private readonly schema?: string,
  ) {}

  async start(): Promise<void> {
    const boss = new PgBoss(
      maintenanceBossOptions({
        connectionString: this.ownerDatabaseUrl,
        applicationName: 'assettracker-scheduler-maintenance',
        poolMax: 2,
        ...(this.schema ? { schema: this.schema } : {}),
      }),
    );
    boss.on('error', (err) => this.logger.error({ err: err.message }, 'pg-boss maintenance error'));
    await boss.start();
    this.boss = boss;
  }

  get started(): boolean {
    return this.boss !== undefined;
  }

  async stop(): Promise<void> {
    const boss = this.boss;
    this.boss = undefined;
    if (boss) await boss.stop({ graceful: true, timeout: 10_000 }).catch(() => undefined);
  }
}
