import { PgBoss, type Queue } from 'pg-boss';
import {
  DEAD_LETTER_QUEUE,
  PGBOSS_SCHEMA,
  allQueues,
  provisioningBossOptions,
  type QueueDefinition,
} from '../jobs/index.js';
import { type Queryable, withOwnerClient } from './maintenance.js';
import type { MigrationLogger } from './migrator.js';

/**
 * The `migrate` step for the job system (M1-PLAT-06), run over the DIRECT owner connection right
 * after the SQL migrations:
 *
 *  1. pg-boss creates its schema (`pgboss`) or upgrades it to the version this build ships
 *     (`createSchema` + `migrate` are on ONLY here; runtime instances have both off);
 *  2. every catalogue queue exists with the catalogue's retry/expiry settings and the dead-letter
 *     queue (created first: queues reference it), never with `notify`;
 *  3. grants for the runtime role (re-applied on EVERY run, so a pg-boss upgrade that adds tables,
 *     sequences or functions is covered, and default privileges cover objects created later by the
 *     owner, e.g. the per-queue partitions pg-boss creates);
 *  4. the grants are verified; any gap fails the deploy before services start.
 *
 * Note the repository-wide rule "no ALTER DEFAULT PRIVILEGES" (migrations/*.sql, tested) exists so
 * that partitions of tenant tables in schema `app` never inherit access. It does not apply to
 * schema `pgboss`, which holds no tenant tables and whose partitions the runtime role MUST reach.
 */
export async function provisionJobs(
  ownerDatabaseUrl: string,
  logger: MigrationLogger,
): Promise<{ queues: string[] }> {
  const boss = new PgBoss(
    provisioningBossOptions({
      connectionString: ownerDatabaseUrl,
      applicationName: 'migrate-jobs',
    }),
  );
  boss.on('error', (err) => logger.info({ err: err.message }, 'pg-boss provisioning error'));
  await boss.start();
  const names: string[] = [];
  try {
    await ensureQueue(boss, DEAD_LETTER_QUEUE, {
      retentionSeconds: 30 * 24 * 3600,
      deleteAfterSeconds: 30 * 24 * 3600,
      retryLimit: 0,
    });
    names.push(DEAD_LETTER_QUEUE);
    for (const def of allQueues()) {
      await ensureQueue(boss, def.name, queueOptions(def));
      names.push(def.name);
    }
  } finally {
    await boss.stop({ graceful: true, timeout: 10_000 });
  }

  await withOwnerClient(
    ownerDatabaseUrl,
    async (client) => {
      await grantJobsAccess(client);
      const gaps = await verifyJobsGrants(client);
      if (gaps.length > 0) throw new Error(`pgboss grants incomplete:\n  - ${gaps.join('\n  - ')}`);
    },
    'migrate-jobs-grants',
  );
  logger.info({ queues: names }, 'job queues ready');
  return { queues: names };
}

function queueOptions(def: QueueDefinition): Omit<Queue, 'name'> {
  return {
    policy: 'standard',
    retryLimit: def.retryLimit,
    retryDelay: def.retryDelay,
    retryBackoff: true,
    ...(def.retryDelayMax ? { retryDelayMax: def.retryDelayMax } : {}),
    expireInSeconds: def.expireInSeconds,
    retentionSeconds: 14 * 24 * 3600,
    deleteAfterSeconds: 7 * 24 * 3600,
    deadLetter: DEAD_LETTER_QUEUE,
  };
}

async function ensureQueue(
  boss: PgBoss,
  name: string,
  options: Omit<Queue, 'name'>,
): Promise<void> {
  const existing = await boss.getQueue(name);
  if (!existing) {
    await boss.createQueue(name, options);
    return;
  }
  // `policy`, `partition` and `deadLetter` of an existing queue are not updatable: they are set at creation.
  const { policy: _policy, partition: _partition, deadLetter: _deadLetter, ...updatable } = options;
  await boss.updateQueue(name, updatable);
}

const IDENT = /^[a-z_][a-z0-9_]*$/;

/**
 * Grants the runtime role what a pg-boss runtime instance needs: USAGE on the schema, DML on its
 * tables (partitions included) and sequences, EXECUTE on its functions, plus default privileges for
 * objects the connected owner role creates later. No DDL, no TRUNCATE, nothing outside `pgboss`.
 */
export async function grantJobsAccess(client: Queryable, runtimeRole = 'app_user'): Promise<void> {
  if (!IDENT.test(runtimeRole)) throw new Error(`invalid role name ${runtimeRole}`);
  const s = PGBOSS_SCHEMA;
  const statements = [
    `grant usage on schema ${s} to ${runtimeRole}`,
    `grant select, insert, update, delete on all tables in schema ${s} to ${runtimeRole}`,
    `grant usage, select on all sequences in schema ${s} to ${runtimeRole}`,
    `grant execute on all functions in schema ${s} to ${runtimeRole}`,
  ];
  for (const sql of statements) await client.query(sql);
  // FOR ROLE = the role running this (the owner / migrator), i.e. the creator of future pg-boss objects.
  await client.query(`
    do $$
    begin
      execute format('alter default privileges for role %I in schema ${s} grant select, insert, update, delete on tables to ${runtimeRole}', current_user);
      execute format('alter default privileges for role %I in schema ${s} grant usage, select on sequences to ${runtimeRole}', current_user);
      execute format('alter default privileges for role %I in schema ${s} grant execute on functions to ${runtimeRole}', current_user);
    end
    $$`);
}

/** Gaps in the runtime role's access to schema pgboss (empty = complete). */
export async function verifyJobsGrants(
  client: Queryable,
  runtimeRole = 'app_user',
): Promise<string[]> {
  const gaps: string[] = [];
  const schema = await client.query(`select has_schema_privilege($1, $2, 'USAGE') as ok`, [
    runtimeRole,
    PGBOSS_SCHEMA,
  ]);
  if (!schema.rows[0]?.ok) gaps.push(`${runtimeRole} lacks USAGE on schema ${PGBOSS_SCHEMA}`);

  const tables = await client.query(
    `select c.relname
       from pg_class c
      where c.relnamespace = $2::regnamespace and c.relkind in ('r','p')
        and not (has_table_privilege($1, c.oid, 'SELECT')
             and has_table_privilege($1, c.oid, 'INSERT')
             and has_table_privilege($1, c.oid, 'UPDATE')
             and has_table_privilege($1, c.oid, 'DELETE'))
      order by c.relname`,
    [runtimeRole, PGBOSS_SCHEMA],
  );
  for (const r of tables.rows)
    gaps.push(`${runtimeRole} lacks DML on ${PGBOSS_SCHEMA}.${String(r.relname)}`);

  const sequences = await client.query(
    `select c.relname from pg_class c
      where c.relnamespace = $2::regnamespace
        and case when c.relkind = 'S' then not has_sequence_privilege($1, c.oid, 'USAGE') else false end`,
    [runtimeRole, PGBOSS_SCHEMA],
  );
  for (const r of sequences.rows)
    gaps.push(`${runtimeRole} lacks USAGE on sequence ${PGBOSS_SCHEMA}.${String(r.relname)}`);

  const functions = await client.query(
    `select p.proname from pg_proc p
      where p.pronamespace = $2::regnamespace and not has_function_privilege($1, p.oid, 'EXECUTE')
      order by p.proname`,
    [runtimeRole, PGBOSS_SCHEMA],
  );
  for (const r of functions.rows)
    gaps.push(`${runtimeRole} lacks EXECUTE on ${PGBOSS_SCHEMA}.${String(r.proname)}()`);
  return gaps;
}
