import pg from 'pg';

/**
 * Owner-path database maintenance (runs as `app_owner` over a DIRECT connection, like the migrator):
 * partition rotation, the schema lint and the role audit. The runtime role cannot execute any of it.
 */

export interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
}

/** Connects directly with `databaseUrl`, runs `fn`, disconnects. */
export async function withOwnerClient<T>(
  databaseUrl: string,
  fn: (client: pg.Client) => Promise<T>,
  applicationName = 'maintenance',
): Promise<T> {
  const client = new pg.Client({
    connectionString: databaseUrl,
    application_name: applicationName,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/**
 * Creates the monthly partitions of every partitioned table (audit_log, later asset_history) for the
 * `months` months starting at `from`'s month, plus the default partitions. Idempotent; returns how
 * many partitions were created. The rotation job calls this monthly (M1-TEN-06); `migrate` calls it
 * after every deploy, so the window rolls forward with no manual step.
 *
 * Creating a partition is DDL: it needs locks on the partitioned parent and its default partition, so
 * it can deadlock with (or time out behind) transactions that are writing to the same tables right
 * now. The call is one statement = one transaction, so a deadlock victim rolled back completely and
 * simply running it again is safe (idempotent): it is retried a few times with a growing pause for
 * `deadlock_detected` (40P01) and `lock_not_available` (55P03) before the error is surfaced.
 */
export async function ensurePartitions(
  client: Queryable,
  from: Date = new Date(),
  months = 12,
): Promise<number> {
  for (let attempt = 1; ; attempt++) {
    try {
      const { rows } = await client.query(
        'select app.ensure_partitions($1::date, $2::int) as created',
        [from.toISOString().slice(0, 10), months],
      );
      return Number(rows[0]?.created ?? 0);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if ((code !== '40P01' && code !== '55P03') || attempt >= PARTITION_ATTEMPTS) throw err;
      await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
    }
  }
}

const PARTITION_ATTEMPTS = 6;

/** Violations reported by `app.schema_lint()` (empty = clean). */
export async function schemaLint(client: Queryable): Promise<string[]> {
  const { rows } = await client.query('select violation from app.schema_lint() order by violation');
  return rows.map((r) => String(r.violation));
}

/**
 * Role audit (M1-DB-02): the runtime role and every role that can use the application schemas
 * (reporting, support, future roles) must be neither superuser nor BYPASSRLS (FORCE RLS does not
 * bind either); the runtime role must not be able to create objects, own objects or become the owner.
 */
export async function auditRoles(client: Queryable): Promise<string[]> {
  const violations: string[] = [];

  const privileged = await client.query(`
    select r.rolname, r.rolsuper, r.rolbypassrls
      from pg_roles r
     where (r.rolsuper or r.rolbypassrls)
       and r.rolname not like 'pg\\_%'
       and (
         r.rolname like 'app\\_%'
         or exists (
           select 1 from pg_namespace n, lateral aclexplode(n.nspacl) x
            where n.nspname in ('app', 'identity') and x.grantee = r.oid))`);
  for (const r of privileged.rows) {
    violations.push(
      `role ${String(r.rolname)} is ${r.rolsuper ? 'superuser' : 'BYPASSRLS'} but can use the application schemas`,
    );
  }

  const runtime = await client.query(`
    select r.rolname,
           r.rolcreaterole, r.rolcreatedb, r.rolreplication,
           has_database_privilege(r.rolname, current_database(), 'CREATE') as db_create,
           pg_has_role(r.rolname, 'app_owner', 'member') as is_owner_member
      from pg_roles r where r.rolname = 'app_user'`);
  const u = runtime.rows[0];
  if (!u) {
    violations.push('role app_user does not exist (run docker/postgres/init/01-roles.sql)');
  } else {
    if (u.rolcreaterole) violations.push('app_user has CREATEROLE');
    if (u.rolcreatedb) violations.push('app_user has CREATEDB');
    if (u.rolreplication) violations.push('app_user has REPLICATION');
    if (u.db_create) violations.push('app_user has CREATE on the database');
    if (u.is_owner_member) violations.push('app_user is a member of app_owner');
  }

  const owned = await client.query(`
    select count(*)::int as n from pg_class c join pg_roles r on r.oid = c.relowner
     where r.rolname = 'app_user' and c.relnamespace in ('app'::regnamespace, 'identity'::regnamespace, 'public'::regnamespace)`);
  if (Number(owned.rows[0]?.n) > 0)
    violations.push('app_user owns objects in the application schemas');

  return violations;
}
