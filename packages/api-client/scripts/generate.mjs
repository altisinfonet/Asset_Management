// Generates src/generated/schema.ts from docs/engineering/openapi.yaml (the API contract).
//
//   node scripts/generate.mjs           write the file
//   node scripts/generate.mjs --check   fail (exit 1) when the committed file differs from the
//                                       contract; used by `pnpm test` (see src/generated.test.ts)
//                                       and runnable directly in CI.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import openapiTS, { astToString } from 'openapi-typescript';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SPEC_PATH = path.resolve(here, '../../../docs/engineering/openapi.yaml');
export const OUTPUT_PATH = path.resolve(here, '../src/generated/schema.ts');

const HEADER = `/**
 * GENERATED FILE - DO NOT EDIT.
 * Source: docs/engineering/openapi.yaml. Regenerate with
 * \`pnpm --filter @assettracker/api-client generate\`; CI fails when this file is stale.
 */

`;

const normalise = (text) => text.replace(/\r\n/g, '\n');

/** Render the contract to TypeScript (deterministic: no timestamps). */
export async function render() {
  // `defaultNonNullable: false`: a property with a schema `default` stays optional in request
  // bodies, so a client may omit it (the server fills it in).
  const ast = await openapiTS(pathToFileURL(SPEC_PATH), { defaultNonNullable: false });
  return normalise(HEADER + astToString(ast));
}

/** `{ upToDate, expected, actual }` for the committed file. */
export async function check() {
  const expected = await render();
  let actual = '';
  try {
    actual = normalise(await readFile(OUTPUT_PATH, 'utf8'));
  } catch {
    actual = '';
  }
  return { upToDate: expected === actual, expected, actual };
}

async function main() {
  if (process.argv.includes('--check')) {
    const { upToDate } = await check();
    if (!upToDate) {
      console.error(
        'packages/api-client/src/generated/schema.ts is out of date with docs/engineering/openapi.yaml.\n' +
          'Run `pnpm --filter @assettracker/api-client generate` and commit the result.',
      );
      process.exit(1);
    }
    console.log('api-client: generated types are up to date with the contract.');
    return;
  }
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, await render());
  console.log(`api-client: wrote ${path.relative(process.cwd(), OUTPUT_PATH)}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
