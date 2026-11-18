#!/usr/bin/env node
// @ts-check
/**
 * Runs the real-stack e2e suite (e2e-real/) with Playwright's project `real`:
 *
 *   docker compose up -d --build            # api, worker, Postgres, Mailpit ... with the demo seed
 *   pnpm --filter @assettracker/web build   # the production export out/ (no mock code in it)
 *   pnpm --filter @assettracker/web test:e2e:real
 *
 * It serves out/ with `/v1` proxied to the API (E2E_API_URL, default http://localhost:3000), signs in as
 * the seeded demo Owner and reads mail from Mailpit (E2E_MAILPIT_URL, default http://localhost:8025).
 * Extra arguments go to `playwright test`. No other setup, no mock.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
if (!existsSync(path.join(appRoot, 'out', 'index.html'))) {
  console.error('out/ is missing: run `pnpm --filter @assettracker/web build` first.');
  process.exit(1);
}
const require = createRequire(path.join(appRoot, 'package.json'));
const playwright = require.resolve('@playwright/test/cli');
const result = spawnSync(process.execPath, [playwright, 'test', ...process.argv.slice(2)], {
  cwd: appRoot,
  stdio: 'inherit',
  env: { ...process.env, E2E_TARGET: 'real' },
});
process.exit(result.status ?? 1);
