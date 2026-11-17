import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** Default folder: apps/api/migrations (works from both src/db and dist/db). */
export const DEFAULT_MIGRATIONS_DIR = fileURLToPath(new URL('../../migrations', import.meta.url));

/** Arbitrary constant: serialises concurrent migrate runs via a session advisory lock. */
const ADVISORY_LOCK_KEY = 727_274_001;

const FILE_PATTERN = /^(\d{4}_[a-z0-9_]+)\.sql$/;
/** A first-line `-- migrate:no-transaction` marker runs the file outside a transaction. */
const NO_TX_MARKER = /^\s*--\s*migrate:no-transaction\b/;

export interface Migration {
  id: string;
  sql: string;
  checksum: string;
  transactional: boolean;
}

export interface MigrationClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface MigrationLogger {
  info(obj: object, msg: string): void;
}

export async function loadMigrations(dir: string = DEFAULT_MIGRATIONS_DIR): Promise<Migration[]> {
  const files = (await readdir(dir)).filter((f) => FILE_PATTERN.test(f)).sort();
  return Promise.all(
    files.map(async (file) => {
      const sql = await readFile(`${dir}/${file}`, 'utf8');
      return {
        id: FILE_PATTERN.exec(file)![1]!,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
        transactional: !NO_TX_MARKER.test(sql),
      };
    }),
  );
}

/**
 * Applies pending migrations in order using ONE dedicated connection (session advisory lock,
 * transactions). Must be given a DIRECT Postgres connection as the owner role, never PgBouncer.
 * Returns the ids applied by this run.
 */
export async function applyMigrations(
  client: MigrationClient,
  migrations: Migration[],
  logger: MigrationLogger = { info: () => undefined },
): Promise<string[]> {
  await client.query('select pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
  try {
    await client.query(`
      create table if not exists public.schema_migrations (
        id text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )`);
    const { rows } = await client.query('select id, checksum from public.schema_migrations');
    const applied = new Map(rows.map((r) => [String(r.id), String(r.checksum)]));

    const ran: string[] = [];
    for (const m of migrations) {
      const existing = applied.get(m.id);
      if (existing !== undefined) {
        if (existing !== m.checksum) {
          throw new Error(`Migration ${m.id} was modified after being applied (checksum mismatch)`);
        }
        continue;
      }
      logger.info({ migration: m.id }, 'applying migration');
      if (m.transactional) {
        await client.query('BEGIN');
        try {
          await client.query("set local lock_timeout = '5s'");
          await client.query("set local statement_timeout = '15min'");
          await client.query(m.sql);
          await client.query(
            'insert into public.schema_migrations (id, checksum) values ($1, $2)',
            [m.id, m.checksum],
          );
          await client.query('COMMIT');
        } catch (err) {
          await client.query('ROLLBACK');
          throw err;
        }
      } else {
        await client.query(m.sql);
        await client.query('insert into public.schema_migrations (id, checksum) values ($1, $2)', [
          m.id,
          m.checksum,
        ]);
      }
      ran.push(m.id);
    }
    return ran;
  } finally {
    await client.query('select pg_advisory_unlock($1)', [ADVISORY_LOCK_KEY]);
  }
}

/** Connects directly with `databaseUrl` (owner role), applies pending migrations, disconnects. */
export async function migrate(
  databaseUrl: string,
  logger: MigrationLogger,
  dir: string = DEFAULT_MIGRATIONS_DIR,
): Promise<string[]> {
  const migrations = await loadMigrations(dir);
  const client = new pg.Client({ connectionString: databaseUrl, application_name: 'migrate' });
  await client.connect();
  try {
    return await applyMigrations(client, migrations, logger);
  } finally {
    await client.end();
  }
}
