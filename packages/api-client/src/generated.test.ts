import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('../scripts/generate.mjs', import.meta.url));

describe('generated client', () => {
  // Runs under `pnpm test` (and so in CI), which makes a stale generated file fail the PR:
  // edit docs/engineering/openapi.yaml, run `pnpm --filter @assettracker/api-client generate`.
  it('src/generated/schema.ts is up to date with docs/engineering/openapi.yaml', () => {
    const result = spawnSync(process.execPath, [script, '--check'], { encoding: 'utf8' });
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
  }, 60_000);
});
