import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { Kysely, PostgresDialect, sql } from 'kysely';
import pg from 'pg';
import type { Database } from './database.js';
import { type TenantContext, type Tx, withPreTenantTx, withTenantTx } from './tenant-tx.js';

export interface TenancyOptions {
  /** Runtime role (app_user), through PgBouncer in transaction mode (or direct in tests/CLI). */
  connectionString: string;
  poolMax?: number;
  applicationName?: string;
}

export interface PingResult {
  latencyMs: number;
}

/**
 * The ONLY owner of the database driver at runtime (an ESLint rule forbids importing `pg` or
 * `kysely` anywhere else). Holds the connection pool and exposes exactly two ways in:
 *   - {@link withTenantTx}: tenant data, explicit transaction + transaction-local tenant context;
 *   - {@link withPreTenantTx}: `identity` lookups and the control plane, no tenant context.
 * Plain class (no Nest decorators) so the CLI and seed script can use it without the HTTP app.
 */
export class TenancyService implements OnModuleDestroy {
  private readonly logger = new Logger(TenancyService.name);
  private readonly db: Kysely<Database>;

  constructor(options: TenancyOptions) {
    const pool = new pg.Pool({
      connectionString: options.connectionString,
      max: options.poolMax ?? 10,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      application_name: options.applicationName ?? 'assettracker',
    });
    // An idle client erroring (e.g. the pooler restarting) must not crash the process.
    pool.on('error', (err) => this.logger.error(`idle pg client error: ${err.message}`));
    this.db = new Kysely<Database>({ dialect: new PostgresDialect({ pool }) });
  }

  /** Cheap round trip used by the health check. Goes through PgBouncer when so configured. */
  async ping(): Promise<PingResult> {
    const started = performance.now();
    await sql`select 1 as ok`.execute(this.db);
    return { latencyMs: Math.round((performance.now() - started) * 100) / 100 };
  }

  /** See {@link withTenantTx} in tenant-tx.ts. */
  withTenantTx<T>(ctx: TenantContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return withTenantTx(this.db, ctx, fn);
  }

  /** See {@link withPreTenantTx} in tenant-tx.ts. */
  withPreTenantTx<T>(fn: (trx: Tx) => Promise<T>): Promise<T> {
    return withPreTenantTx(this.db, fn);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.destroy();
  }
}
