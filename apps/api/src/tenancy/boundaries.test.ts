import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'generated') yield* walk(full); // Prisma output is not our code
    } else yield full;
  }
}

describe('no session-level tenant context (M1-TEN-02)', () => {
  // `SET app.x` / `SET SESSION app.x` / `set_config(..., false)` survive the transaction and leak to
  // the next borrower of a pooled connection. Only `SET LOCAL` and `set_config(..., true)` are allowed.
  const sessionSet = /\bSET\s+(?!LOCAL\b)(?:SESSION\s+)?app\./i;
  const sessionSetConfig = /set_config\s*\([^)]*,\s*false\s*\)/i;

  it('the sources and migrations never use a session-level SET of app.*', async () => {
    const offenders: string[] = [];
    for (const dir of ['src', 'migrations']) {
      for await (const file of walk(join(apiRoot, dir))) {
        if (!/\.(ts|sql)$/.test(file) || file.endsWith('.test.ts')) continue;
        const text = await readFile(file, 'utf8');
        if (sessionSet.test(text) || sessionSetConfig.test(text)) {
          offenders.push(relative(apiRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the matcher itself catches the forbidden forms and allows the safe ones', () => {
    expect(sessionSet.test("SET app.tenant_id = 'x'")).toBe(true);
    expect(sessionSet.test("set session app.tenant_id = 'x'")).toBe(true);
    expect(sessionSetConfig.test("select set_config('app.tenant_id', $1, false)")).toBe(true);
    expect(sessionSet.test("SET LOCAL app.tenant_id = 'x'")).toBe(false);
    expect(sessionSetConfig.test("select set_config('app.tenant_id', $1, true)")).toBe(false);
  });
});

describe('database client import boundary (M1-TEN-02, ADR 0001)', () => {
  const eslint = new ESLint({ cwd: apiRoot });

  async function lint(
    filePath: string,
    code: string,
    ruleId = '@typescript-eslint/no-restricted-imports',
  ) {
    const [result] = await eslint.lintText(code, { filePath: join(apiRoot, filePath) });
    return result!.messages.filter((m) => m.ruleId === ruleId);
  }

  it('fails lint when a domain module imports the database client (deliberate violation fixtures)', async () => {
    const violation = await lint(
      'src/orders/orders.repository.ts',
      "import pg from 'pg';\nexport const x = pg;\n",
    );
    expect(violation).toHaveLength(1);
    expect(violation[0]?.message).toMatch(/src\/tenancy/);

    for (const [name, code] of [
      ['a', "import { PrismaClient } from '@prisma/client';\nexport const k = PrismaClient;\n"],
      ['b', "import { PrismaPg } from '@prisma/adapter-pg';\nexport const k = PrismaPg;\n"],
      [
        'c',
        "import { PrismaClient } from '../generated/prisma/client.js';\nexport const k = PrismaClient;\n",
      ],
      [
        'd',
        "import { Prisma } from '../../generated/prisma/client.js';\nexport const k = Prisma;\n",
      ],
      ['e', "import { Kysely } from 'kysely';\nexport const k = Kysely;\n"],
    ] as const) {
      expect(await lint(`src/orders/q-${name}.ts`, code), name).toHaveLength(1);
    }
  });

  it('allows type-only imports, and the client inside tenancy and db', async () => {
    expect(
      await lint(
        'src/orders/types.ts',
        "import type { PrismaClient } from '@prisma/client';\nimport type { Prisma } from '../generated/prisma/client.js';\nexport type K = PrismaClient | Prisma.TransactionClient;\n",
      ),
    ).toEqual([]);
    expect(
      await lint('src/tenancy/driver.ts', "import pg from 'pg';\nexport const x = pg;\n"),
    ).toEqual([]);
    expect(
      await lint(
        'src/tenancy/client.ts',
        "import { PrismaClient } from '../generated/prisma/client.js';\nexport const x = PrismaClient;\n",
      ),
    ).toEqual([]);
    expect(await lint('src/db/driver.ts', "import pg from 'pg';\nexport const x = pg;\n")).toEqual(
      [],
    );
  });
});

describe('unsafe raw SQL is banned (ADR 0001)', () => {
  const eslint = new ESLint({ cwd: apiRoot });
  const unsafe = async (filePath: string, code: string) => {
    const [result] = await eslint.lintText(code, { filePath: join(apiRoot, filePath) });
    return result!.messages.filter((m) => m.ruleId === 'no-restricted-syntax');
  };

  it('rejects $queryRawUnsafe and $executeRawUnsafe everywhere, including tenancy and tests', async () => {
    for (const file of ['src/orders/a.ts', 'src/tenancy/b.ts', 'test/c.e2e.test.ts']) {
      expect(
        await unsafe(file, 'export const a = (tx) => tx.$queryRawUnsafe("select 1");\n'),
        file,
      ).toHaveLength(1);
      expect(
        await unsafe(file, 'export const b = (tx) => tx.$executeRawUnsafe("select 1");\n'),
        file,
      ).toHaveLength(1);
      expect(
        await unsafe(file, 'export const c = (tx) => tx["$queryRawUnsafe"]("select 1");\n'),
        file,
      ).toHaveLength(1);
    }
  });

  it('allows the tagged-template forms', async () => {
    const code =
      'export const a = (tx) => tx.$queryRaw`select 1`;\nexport const b = (tx) => tx.$executeRaw`select 1`;\n';
    expect(await unsafe('src/orders/a.ts', code)).toEqual([]);
  });
});
