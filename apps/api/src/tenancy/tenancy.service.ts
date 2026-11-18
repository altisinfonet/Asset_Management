import { Logger, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import {
  type TenantContext,
  type Tx,
  type TxOptions,
  withPreTenantTx,
  withTenantTx,
} from './tenant-tx.js';

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
 * The ONLY owner of the Prisma client at runtime (an ESLint rule forbids importing `@prisma/client`,
 * the driver adapter, `pg` or the generated client anywhere else). Holds the connection pool and
 * exposes exactly two ways in:
 *   - {@link withTenantTx}: tenant data, interactive transaction + transaction-local tenant context;
 *   - {@link withPreTenantTx}: `identity` lookups and the control plane, no tenant context.
 * Plain class (no Nest decorators) so the CLI and seed script can use it without the HTTP app.
 *
 * Prisma 7 runs through the `@prisma/adapter-pg` driver adapter (node-postgres), so it behaves like
 * any `pg` client behind PgBouncer: no session state, every statement inside an explicit transaction.
 */
export class TenancyService implements OnModuleDestroy {
  private readonly logger = new Logger(TenancyService.name);
  private readonly db: PrismaClient;

  constructor(options: TenancyOptions) {
    const adapter = new PrismaPg(
      {
        connectionString: options.connectionString,
        max: options.poolMax ?? 10,
        connectionTimeoutMillis: 5_000,
        idleTimeoutMillis: 30_000,
        application_name: options.applicationName ?? 'assettracker',
      },
      {
        // An idle client erroring (e.g. the pooler restarting) must not crash the process.
        onPoolError: (err) => this.logger.error(`idle pg client error: ${err.message}`),
      },
    );
    this.db = new PrismaClient({ adapter });
  }

  /** Cheap round trip used by the health check. Goes through PgBouncer when so configured. */
  async ping(): Promise<PingResult> {
    const started = performance.now();
    await this.db.$queryRaw`select 1 as ok`;
    return { latencyMs: Math.round((performance.now() - started) * 100) / 100 };
  }

  /** See {@link withTenantTx} in tenant-tx.ts. */
  withTenantTx<T>(
    ctx: TenantContext,
    fn: (trx: Tx) => Promise<T>,
    options?: TxOptions,
  ): Promise<T> {
    return withTenantTx(this.db, ctx, fn, options);
  }

  /** See {@link withPreTenantTx} in tenant-tx.ts. */
  withPreTenantTx<T>(fn: (trx: Tx) => Promise<T>, options?: TxOptions): Promise<T> {
    return withPreTenantTx(this.db, fn, options);
  }

  async onModuleDestroy(): Promise<void> {
    await this.db.$disconnect();
  }
}
