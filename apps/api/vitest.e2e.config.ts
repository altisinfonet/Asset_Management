import { availableParallelism } from 'node:os';
import { defineConfig } from 'vitest/config';
import { E2E_JOBS_SCHEMA } from './test/support/jobs-schema.js';
import base from './vitest.config.js';

/**
 * How many test FILES run at once. Every file boots its own Nest app (a connection pool, a pg-boss
 * pool) against the same database, so the number of files in flight is the number of database
 * clients. Left at vitest's default (cores - 1, 27 on a 28-core workstation) the suite opened 60+
 * client connections through PgBouncer's pool of 16 server connections and 300+ in direct mode
 * (Postgres max_connections); a loaded machine then made transactions queue for the pool and tests
 * hit their timeouts or got "remaining connection slots are reserved". Six files in parallel keep the
 * suite fast (about as fast as 27: the work is database bound, not CPU bound) and the connection
 * count well inside the limits of the dev/CI stack. Override with E2E_MAX_WORKERS.
 */
const maxWorkers =
  Number(process.env.E2E_MAX_WORKERS) || Math.min(6, Math.max(2, availableParallelism()));

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/**/*.e2e.test.ts'],
    maxWorkers,
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The suite has its own pg-boss schema (see test/support/global-setup.ts), so a running compose
    // worker/scheduler (default schema `pgboss`) and the tests never compete for the same jobs.
    // DB_POOL_MAX: a smaller pool per app than the production default of 10; a file never needs more
    // than a handful of concurrent connections (the 40-request concurrency tests queue on the pool).
    env: { JOBS_SCHEMA: E2E_JOBS_SCHEMA, DB_POOL_MAX: '6' },
    globalSetup: ['./test/support/global-setup.ts'],
  },
});
