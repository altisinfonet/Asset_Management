import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import pg from 'pg';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { runWithTenant } from './tenant.js';

export interface PingResult {
  latencyMs: number;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  private readonly logger = new Logger(DbService.name);
  readonly pool: pg.Pool;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.pool = new pg.Pool({
      connectionString: config.DATABASE_URL,
      max: config.DB_POOL_MAX,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: `assettracker-${config.APP_ROLE}`,
    });
    // An idle client erroring (e.g. the pooler restarting) must not crash the process.
    this.pool.on('error', (err) => this.logger.error(`idle pg client error: ${err.message}`));
  }

  /** Cheap round trip used by the health check. Goes through PgBouncer when so configured. */
  async ping(): Promise<PingResult> {
    const started = performance.now();
    await this.pool.query('select 1 as ok');
    return { latencyMs: Math.round((performance.now() - started) * 100) / 100 };
  }

  /** See {@link runWithTenant}. */
  withTenant<T>(tenantId: string, fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
    return runWithTenant(this.pool, tenantId, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
