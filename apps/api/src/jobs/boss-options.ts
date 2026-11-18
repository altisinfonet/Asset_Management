import type { ConstructorOptions } from 'pg-boss';

/**
 * The ONLY places a PgBoss instance is configured (M1-PLAT-06; spike docs/validation/
 * spike_rls_pgbouncer.md F5, architecture 5.2). Three instance kinds, three privilege levels:
 *
 *  1. `provisioning`  (migrate step, DIRECT connection, owner role): creates/upgrades the `pgboss`
 *     schema and the queues. The only instance with `createSchema`/`migrate`.
 *  2. `runtime`       (api, worker, scheduler; `app_user`, through PgBouncer): send / fetch /
 *     complete only. `createSchema`, `migrate`, `supervise`, `schedule` all FALSE: no DDL, no
 *     background maintenance competing on the request path.
 *  3. `maintenance`   (exactly one logical instance, in the scheduler role; owner role, DIRECT):
 *     `supervise` on (expiry, retention, archival, queue statistics). `schedule` stays false: cron
 *     is implemented by the scheduler's own singleton-keyed producers (`scheduler.ts`).
 *
 * Every kind has `useListenNotify: false`. LISTEN/NOTIFY needs a session-pinned connection; behind a
 * transaction-mode pooler it fails silently (notifications never arrive, workers fall back to a
 * 30 s backstop poll). Workers poll every 1-2 s instead (`pollingIntervalSeconds`).
 */
export const PGBOSS_SCHEMA = 'pgboss';

interface Common {
  connectionString: string;
  applicationName: string;
  poolMax?: number;
}

const base = ({ connectionString, applicationName, poolMax }: Common): ConstructorOptions => ({
  connectionString,
  schema: PGBOSS_SCHEMA,
  application_name: applicationName,
  ...(poolMax ? { max: poolMax } : {}),
  useListenNotify: false,
  schedule: false,
});

export const provisioningBossOptions = (c: Common): ConstructorOptions => ({
  ...base(c),
  createSchema: true,
  migrate: true,
  supervise: false,
  registerInstance: false,
});

export const runtimeBossOptions = (c: Common): ConstructorOptions => ({
  ...base(c),
  createSchema: false,
  migrate: false,
  supervise: false,
});

export const maintenanceBossOptions = (c: Common): ConstructorOptions => ({
  ...base(c),
  createSchema: false,
  migrate: false,
  supervise: true,
});
