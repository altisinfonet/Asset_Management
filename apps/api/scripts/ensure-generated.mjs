// Generates build inputs that are NOT committed, only when missing or stale:
//   1. the Prisma client (src/generated/prisma) from prisma/schema.prisma;
//   2. the bundled OpenAPI document (openapi.generated.json) from docs/engineering/openapi.yaml,
//      served at GET /v1/openapi.json (M1-PLAT-03).
// `build`, `typecheck`, `test` and `test:e2e` call this first so they work from a clean checkout, and
// so that parallel turbo tasks do not rewrite the same files at the same time (turbo runs the
// `db:generate` task first; by then the output is fresh and this script is a no-op).
import { spawnSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { bundleOpenApi, OPENAPI_BUNDLE, OPENAPI_SOURCE } from './bundle-openapi.mjs';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const schema = join(apiRoot, 'prisma', 'schema.prisma');
const marker = join(apiRoot, 'src', 'generated', 'prisma', 'client.ts');

const fresh = existsSync(marker) && statSync(marker).mtimeMs >= statSync(schema).mtimeMs;
if (!fresh) {
  const prismaBin = createRequire(import.meta.url).resolve('prisma/build/index.js');
  const result = spawnSync(process.execPath, [prismaBin, 'generate'], {
    cwd: apiRoot,
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const bundleFresh =
  existsSync(OPENAPI_BUNDLE) &&
  (!existsSync(OPENAPI_SOURCE) ||
    statSync(OPENAPI_BUNDLE).mtimeMs >= statSync(OPENAPI_SOURCE).mtimeMs);
if (!bundleFresh) bundleOpenApi();
