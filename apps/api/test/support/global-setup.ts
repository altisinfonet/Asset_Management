import { provisionJobs } from '../../src/db/provision-jobs.js';
import { E2E_JOBS_SCHEMA } from './jobs-schema.js';

/**
 * Runs once before the e2e suite: provisions the pg-boss schema the suite uses (`JOBS_SCHEMA`,
 * `pgboss_e2e` from vitest.e2e.config.ts) over the owner connection. It is idempotent (re-applies
 * queues and grants). Isolating the suite in its own schema is what lets the e2e tests run while
 * the compose `worker` is up: the worker polls the default `pgboss` schema and never sees these jobs.
 */
export default async function setup(): Promise<void> {
  const url = process.env.MIGRATOR_DATABASE_URL;
  const schema = process.env.JOBS_SCHEMA ?? E2E_JOBS_SCHEMA;
  if (!url) return; // database-backed suites are skipped without MIGRATOR_DATABASE_URL
  await provisionJobs(url, { info: () => undefined }, schema);
}
