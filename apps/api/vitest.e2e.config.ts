import { defineConfig } from 'vitest/config';
import base from './vitest.config.js';

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: ['test/**/*.e2e.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
