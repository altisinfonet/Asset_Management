import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_MIGRATIONS_DIR,
  applyMigrations,
  loadMigrations,
  type Migration,
  type MigrationClient,
} from './migrator.js';

function fakeClient(alreadyApplied: Array<{ id: string; checksum: string }> = []) {
  const statements: string[] = [];
  const client: MigrationClient = {
    async query(text) {
      statements.push(text.trim().split('\n')[0]!.trim());
      if (text.includes('from public.schema_migrations')) return { rows: alreadyApplied };
      return { rows: [] };
    },
  };
  return { client, statements };
}

const mig = (id: string, sql = 'select 1;', transactional = true): Migration => ({
  id,
  sql,
  checksum: `sum-${id}`,
  transactional,
});

describe('loadMigrations', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'migrations-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('loads *.sql files in order, ignoring other files, and detects the no-transaction marker', async () => {
    await writeFile(join(dir, '0002_second.sql'), '-- migrate:no-transaction\nselect 2;');
    await writeFile(join(dir, '0001_first.sql'), 'select 1;');
    await writeFile(join(dir, 'README.md'), 'ignored');
    const loaded = await loadMigrations(dir);
    expect(loaded.map((m) => m.id)).toEqual(['0001_first', '0002_second']);
    expect(loaded.map((m) => m.transactional)).toEqual([true, false]);
    expect(loaded[0]?.checksum).toMatch(/^[0-9a-f]{64}$/);
  });

  it('ships the initial (empty) migration', async () => {
    const loaded = await loadMigrations(DEFAULT_MIGRATIONS_DIR);
    expect(loaded[0]?.id).toBe('0001_init');
  });
});

describe('applyMigrations', () => {
  it('applies pending migrations inside a transaction under the advisory lock', async () => {
    const { client, statements } = fakeClient();
    const ran = await applyMigrations(client, [mig('0001_init')]);
    expect(ran).toEqual(['0001_init']);
    expect(statements[0]).toContain('pg_advisory_lock');
    expect(statements).toContain('BEGIN');
    expect(statements).toContain('COMMIT');
    expect(statements.at(-1)).toContain('pg_advisory_unlock');
  });

  it('skips already-applied migrations', async () => {
    const { client } = fakeClient([{ id: '0001_init', checksum: 'sum-0001_init' }]);
    expect(await applyMigrations(client, [mig('0001_init'), mig('0002_next')])).toEqual([
      '0002_next',
    ]);
  });

  it('fails when an applied migration was modified', async () => {
    const { client, statements } = fakeClient([{ id: '0001_init', checksum: 'different' }]);
    await expect(applyMigrations(client, [mig('0001_init')])).rejects.toThrow(/checksum/);
    expect(statements.at(-1)).toContain('pg_advisory_unlock');
  });

  it('rolls back and rethrows when a migration fails', async () => {
    const statements: string[] = [];
    const client: MigrationClient = {
      async query(text) {
        statements.push(text.trim().split('\n')[0]!.trim());
        if (text === 'select broken;') throw new Error('syntax error');
        return { rows: [] };
      },
    };
    await expect(applyMigrations(client, [mig('0001_bad', 'select broken;')])).rejects.toThrow(
      'syntax error',
    );
    expect(statements).toContain('ROLLBACK');
    expect(statements).not.toContain('COMMIT');
  });
});
