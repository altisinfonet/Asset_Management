import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

describe('platform services boundaries (M1-PLAT-04..09; lint fixtures)', () => {
  const eslint = new ESLint({ cwd: apiRoot });
  const restricted = async (filePath: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: join(apiRoot, filePath) });
    return result!.messages.filter((m) => m.ruleId === '@typescript-eslint/no-restricted-imports');
  };

  it('pg-boss is importable only inside src/jobs and src/db', async () => {
    const code = "import { PgBoss } from 'pg-boss';\nexport const x = PgBoss;\n";
    expect(await restricted('src/registry/queue.ts', code)).toHaveLength(1); // domain module
    expect(await restricted('src/platform/queue.ts', code)).toHaveLength(1); // kernel
    expect(await restricted('src/mail/queue.ts', code)).toHaveLength(1); // other platform service
    expect(await restricted('src/roles/queue.ts', code)).toHaveLength(1); // process roles
    expect(await restricted('src/jobs/adapter.ts', code)).toEqual([]);
    expect(await restricted('src/db/provision.ts', code)).toEqual([]);
    // type-only imports stay free everywhere
    expect(
      await restricted(
        'src/registry/t.ts',
        "import type { Job } from 'pg-boss';\nexport type J = Job;\n",
      ),
    ).toEqual([]);
  });

  it('the database client is still off limits to the new platform services', async () => {
    const code = "import pg from 'pg';\nexport const x = pg;\n";
    for (const dir of ['audit', 'outbox', 'jobs', 'crypto', 'mail', 'observability']) {
      expect(await restricted(`src/${dir}/a.ts`, code), dir).toHaveLength(1);
    }
  });

  it('the new platform services are used through their facades only', async () => {
    for (const m of [
      'audit/redact',
      'outbox/relay',
      'jobs/worker',
      'crypto/secret-box',
      'mail/templates',
      'observability/metrics',
    ]) {
      expect(
        await restricted(
          'src/registry/a.ts',
          `import { x } from '../${m}.js';\nexport const y = x;\n`,
        ),
        m,
      ).toHaveLength(1);
    }
    for (const m of ['audit', 'outbox', 'jobs', 'crypto', 'mail', 'observability']) {
      expect(
        await restricted(
          'src/registry/a.ts',
          `import { x } from '../${m}/index.js';\nexport const y = x;\n`,
        ),
        m,
      ).toEqual([]);
    }
  });
});
