#!/usr/bin/env node
// @ts-check
/**
 * `next dev` with the mock API: copies the MSW service worker into public/ for the session and
 * removes it again on exit (a stray copy would fail the production build check).
 *
 *   node scripts/dev-mock.mjs [--port 3001]
 */
import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(appRoot, 'package.json'));
const target = path.join(appRoot, 'public', 'mockServiceWorker.js');
const worker = path.join(appRoot, 'node_modules', 'msw', 'lib', 'mockServiceWorker.js');

if (!existsSync(worker)) {
  console.error(`MSW service worker not found at ${worker}; run pnpm install`);
  process.exit(1);
}
mkdirSync(path.dirname(target), { recursive: true });
copyFileSync(worker, target);

const cleanup = () => rmSync(target, { force: true });
process.on('exit', cleanup);
for (const signal of /** @type {const} */ (['SIGINT', 'SIGTERM'])) {
  process.on(signal, () => process.exit(0));
}

const args = process.argv.slice(2);
const child = spawn(process.execPath, [require.resolve('next/dist/bin/next'), 'dev', ...args], {
  cwd: appRoot,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_API_MOCKS: '1' },
});
child.on('exit', (code) => process.exit(code ?? 0));
