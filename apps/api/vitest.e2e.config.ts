import { defineConfig } from 'vitest/config';
import { E2E_JOBS_SCHEMA } from './test/support/jobs-schema.js';
import base from './vitest.config.js';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // The suite has its own pg-boss schema (see test/support/global-setup.ts), so a running compose
    // worker/scheduler (default schema `pgboss`) and the tests never compete for the same jobs.
    env: { JOBS_SCHEMA: E2E_JOBS_SCHEMA },
    globalSetup: ['./test/support/global-setup.ts'],
  },
});
