#!/usr/bin/env node
// @ts-check
/**
 * Static export WITH the mock API, for Playwright e2e and demos without a backend.
 *
 *   node scripts/build-mock.mjs          writes out-mock/ (the production out/ is untouched)
 *
 * The flag `NEXT_PUBLIC_API_MOCKS=1` compiles the MSW layer (src/mocks) in, and the MSW service
 * worker is copied next to the pages. Neither ever happens in `pnpm build`: the production
 * check (scripts/check-static-export.mjs) fails when the flag is set or when out/ contains mock code.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = 'out-mock';
const require = createRequire(path.join(appRoot, 'package.json'));

rmSync(path.join(appRoot, outDir), { recursive: true, force: true });

const nextBin = require.resolve('next/dist/bin/next');
const result = spawnSync(process.execPath, [nextBin, 'build'], {
  cwd: appRoot,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_API_MOCKS: '1', AT_EXPORT_DIR: outDir },
});
if (result.status !== 0) process.exit(result.status ?? 1);

const worker = path.join(appRoot, 'node_modules', 'msw', 'lib', 'mockServiceWorker.js');
if (!existsSync(worker)) {
  console.error(`MSW service worker not found at ${worker}; run pnpm install`);
  process.exit(1);
}
copyFileSync(worker, path.join(appRoot, outDir, 'mockServiceWorker.js'));
console.log(
  `mock export ready in ${outDir}/ (serve with: node scripts/serve-static.mjs ${outDir})`,
);
