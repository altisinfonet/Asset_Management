import { randomUUID } from 'node:crypto';
import type pg from 'pg';
import { env, rawTenantTx, withClient } from '../support/db.js';

/**
 * M2-SEC-01: isolation probes driven by the database catalogue, so a new table or a new foreign key is
 * covered the moment its migration exists (nobody has to remember to add a case). Used by the route
 * replay, whose fixtures give tenant A rows in (nearly) every table.
 *
 *  - `visibilityProbe`: for EVERY tenant table, tenant B (runtime role, the suite's connection: direct or
 *    through PgBouncer) sees none of A's rows, and A sees all of them (the positive control).
 *  - `foreignKeyProbe`: for EVERY foreign key between two tenant tables, a row of A re-pointed at a record
 *    that exists only in ANOTHER tenant is refused with 23503. The foreign record is made by cloning the
 *    row the reference points at into a throwaway tenant id with a new key, with triggers and foreign
 *    keys off for that one insert (`session_replication_role = replica`, superuser only), then the probe
 *    runs with them on. A single-column key `(x) -> parent (id)` would accept the re-pointed row (the
 *    clone exists), so only a key that pairs tenant_id with tenant_id refuses it. Everything is rolled back.
 */

export interface TenantTable {
  schema: string;
  table: string;
}

const q = (name: string) => `"${name.replace(/"/g, '""')}"`;
const rel = (t: TenantTable) => `${q(t.schema)}.${q(t.table)}`;

/** Every tenant table: schema app (and identity) tables with a tenant_id column, partitions excluded. */
export async function tenantTables(c: pg.Client): Promise<TenantTable[]> {
  const { rows } = await c.query<TenantTable>(
    `select n.nspname as schema, c.relname as table
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname in ('app', 'identity') and c.relkind in ('r', 'p') and not c.relispartition
        and exists (select 1 from pg_attribute a
                     where a.attrelid = c.oid and a.attname = 'tenant_id' and not a.attisdropped)
      order by 1, 2`,
  );
  return rows;
}

export interface VisibilityResult {
  /** `schema.table: n` for the tables in which A has rows */
  checked: string[];
  /** tables without a row of A (cannot be probed) */
  empty: string[];
  /** tables in which B saw a row of A */
  leaks: string[];
  /** tables in which A did not see all of its own rows */
  ownMismatch: string[];
}

/** Tenant B must see none of A's rows in any tenant table; A must see exactly its own. */
export async function visibilityProbe(a: string, b: string): Promise<VisibilityResult> {
  const out: VisibilityResult = { checked: [], empty: [], leaks: [], ownMismatch: [] };
  await withClient(env.adminUrl!, async (admin) => {
    for (const t of await tenantTables(admin)) {
      const name = `${t.schema}.${t.table}`;
      const truth = (
        await admin.query<{ n: number }>(
          `select count(*)::int as n from ${rel(t)} where tenant_id = $1`,
          [a],
        )
      ).rows[0]!.n;
      if (truth === 0) {
        out.empty.push(name);
        continue;
      }
      // identity tables are non-tenant (no RLS; the runtime role reads them through narrow functions)
      if (t.schema !== 'app') continue;
      const seenByB = await withClient(env.databaseUrl!, (c) =>
        rawTenantTx(
          c,
          b,
          async () =>
            (
              await c.query<{ n: number }>(
                `select count(*)::int as n from ${rel(t)} where tenant_id = $1`,
                [a],
              )
            ).rows[0]!.n,
        ),
      );
      if (seenByB !== 0) out.leaks.push(`${name}: ${seenByB}`);
      const seenByA = await withClient(env.databaseUrl!, (c) =>
        rawTenantTx(
          c,
          a,
          async () =>
            (await c.query<{ n: number }>(`select count(*)::int as n from ${rel(t)}`)).rows[0]!.n,
        ),
      );
      if (seenByA !== truth) out.ownMismatch.push(`${name}: ${seenByA} of ${truth}`);
      out.checked.push(`${name}: ${truth}`);
    }
  });
  return out;
}

interface ForeignKey {
  name: string;
  child: TenantTable;
  parent: TenantTable;
  /** referencing columns, in key order */
  cols: string[];
  /** referenced columns, in key order */
  refs: string[];
}

export interface ForeignKeyResult {
  /** `fk (child -> parent): sqlstate` for every key that was probed */
  probed: string[];
  /** keys without a referencing row of the given tenants (cannot be probed) */
  unprobed: string[];
  /** keys that accepted a reference into another tenant, or refused it for another reason */
  failures: string[];
}

/** Every foreign key between two tenant tables (to app.tenant excluded: that is the tenant itself). */
async function tenantForeignKeys(c: pg.Client): Promise<ForeignKey[]> {
  const { rows } = await c.query<{
    name: string;
    cschema: string;
    ctable: string;
    pschema: string;
    ptable: string;
    cols: string[];
    refs: string[];
  }>(
    `select con.conname as name, cn.nspname as cschema, cc.relname as ctable,
            pn.nspname as pschema, pc.relname as ptable,
            array(select a.attname::text from unnest(con.conkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.conrelid and a.attnum = k.n order by k.i) as cols,
            array(select a.attname::text from unnest(con.confkey) with ordinality k(n, i)
                    join pg_attribute a on a.attrelid = con.confrelid and a.attnum = k.n order by k.i) as refs
       from pg_constraint con
       join pg_class cc on cc.oid = con.conrelid join pg_namespace cn on cn.oid = cc.relnamespace
       join pg_class pc on pc.oid = con.confrelid join pg_namespace pn on pn.oid = pc.relnamespace
      where con.contype = 'f' and con.conparentid = 0
        and cn.nspname in ('app', 'identity') and pn.nspname = 'app' and pc.relname <> 'tenant'
        and exists (select 1 from pg_attribute a
                     where a.attrelid = pc.oid and a.attname = 'tenant_id' and not a.attisdropped)
      order by 2, 3, 1`,
  );
  return rows.map((r) => ({
    name: r.name,
    child: { schema: r.cschema, table: r.ctable },
    parent: { schema: r.pschema, table: r.ptable },
    cols: r.cols,
    refs: r.refs,
  }));
}

/** Insertable columns of a table (no generated or dropped columns), and the unique keys not led by tenant_id. */
async function shapeOf(c: pg.Client, t: TenantTable) {
  const cols = (
    await c.query<{ name: string; type: string }>(
      `select a.attname as name, format_type(a.atttypid, a.atttypmod) as type
         from pg_attribute a
        where a.attrelid = $1::regclass and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
        order by a.attnum`,
      [rel(t)],
    )
  ).rows;
  // columns of unique indexes that do not contain tenant_id: a clone into another tenant must not collide
  const globalUnique = (
    await c.query<{ name: string }>(
      `select distinct a.attname as name
         from pg_index i
         join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any (i.indkey)
        where i.indrelid = $1::regclass and i.indisunique
          and not exists (select 1 from pg_attribute t
                           where t.attrelid = i.indrelid and t.attname = 'tenant_id' and t.attnum = any (i.indkey))`,
      [rel(t)],
    )
  ).rows.map((r) => r.name);
  return { cols, globalUnique };
}

/**
 * Probes every foreign key between tenant tables with a referencing row of one of `tenants`. Needs the
 * superuser connection (ADMIN_DATABASE_URL): `session_replication_role` and reading every tenant.
 */
export async function foreignKeyProbe(tenants: string[]): Promise<ForeignKeyResult> {
  const out: ForeignKeyResult = { probed: [], unprobed: [], failures: [] };
  await withClient(env.adminUrl!, async (c) => {
    for (const fk of await tenantForeignKeys(c)) {
      // one short transaction per key, always rolled back
      await c.query('begin');
      try {
        await probeKey(c, fk, tenants, out);
      } finally {
        await c.query('rollback');
      }
    }
  });
  return out;
}

/**
 * The control of the control: a composite key whose enforcement is switched off (its triggers disabled)
 * must be reported as ACCEPTING the cross-tenant reference, so a green probe means "refused", not "the
 * probe cannot see". Fixture tables in one transaction that is rolled back.
 */
export async function foreignKeyProbeControl(tenantId: string): Promise<ForeignKeyResult> {
  const out: ForeignKeyResult = { probed: [], unprobed: [], failures: [] };
  await withClient(env.adminUrl!, async (c) => {
    await c.query('begin');
    try {
      await c.query(`select app.create_tenant_table('zz_probe_parent', 'v text')`);
      await c.query(`select app.create_tenant_table('zz_probe_child', 'parent_id uuid')`);
      await c.query(
        `alter table app.zz_probe_child add constraint zz_probe_fk
           foreign key (tenant_id, parent_id) references app.zz_probe_parent (tenant_id, id)`,
      );
      const parent = randomUUID();
      await c.query(`insert into app.zz_probe_parent (id, tenant_id, v) values ($1, $2, 'p')`, [
        parent,
        tenantId,
      ]);
      await c.query(
        `insert into app.zz_probe_child (id, tenant_id, parent_id) values ($1, $2, $3)`,
        [randomUUID(), tenantId, parent],
      );
      await c.query('alter table app.zz_probe_child disable trigger all');
      await probeKey(
        c,
        {
          name: 'zz_probe_fk',
          child: { schema: 'app', table: 'zz_probe_child' },
          parent: { schema: 'app', table: 'zz_probe_parent' },
          cols: ['tenant_id', 'parent_id'],
          refs: ['tenant_id', 'id'],
        },
        [tenantId],
        out,
      );
    } finally {
      await c.query('rollback');
    }
  });
  return out;
}

/** Probes one key inside the caller's transaction (everything it does is undone by a savepoint). */
async function probeKey(
  c: pg.Client,
  fk: ForeignKey,
  tenants: string[],
  out: ForeignKeyResult,
): Promise<void> {
  const label = `${fk.name} (${fk.child.schema}.${fk.child.table} -> ${fk.parent.schema}.${fk.parent.table})`;
  const tenantPos = fk.cols.findIndex(
    (col, i) => col === 'tenant_id' && fk.refs[i] === 'tenant_id',
  );
  if (tenantPos < 0) {
    out.failures.push(`${label}: tenant_id is not paired with tenant_id`);
    return;
  }
  const others = fk.cols
    .map((col, i) => ({ col, ref: fk.refs[i]! }))
    .filter((_, i) => i !== tenantPos);
  // a referencing row with the key set (its referenced row is cloned) ...
  let row = (
    await c.query<Record<string, string>>(
      `select ctid::text as ctid, tenant_id::text as tenant_id, ${others.map((o, i) => `${q(o.col)}::text as v${i}`).join(', ')}
         from ${rel(fk.child)}
        where tenant_id = any ($1::uuid[]) and ${others.map((o) => `${q(o.col)} is not null`).join(' and ')}
        limit 1`,
      [tenants],
    )
  ).rows[0];
  let how = 're-pointed';
  if (!row) {
    // ... or, for an optional reference no fixture row uses, any row of the tenant whose key is then set
    // to a clone of any referenced-table row of the same tenant
    const any = (
      await c.query<Record<string, string>>(
        `select ctid::text as ctid, tenant_id::text as tenant_id from ${rel(fk.child)}
          where tenant_id = any ($1::uuid[]) limit 1`,
        [tenants],
      )
    ).rows[0];
    const target = any
      ? (
          await c.query<Record<string, string>>(
            `select ${others.map((o, i) => `${q(o.ref)}::text as v${i}`).join(', ')}
               from ${rel(fk.parent)} where tenant_id = $1::uuid limit 1`,
            [any.tenant_id],
          )
        ).rows[0]
      : undefined;
    if (!any || !target) {
      out.unprobed.push(`${label}: no row of the given tenants`);
      return;
    }
    row = { ...any, ...target };
    how = 'set';
  }
  const shape = await shapeOf(c, fk.parent);
  const foreignTenant = randomUUID();
  await c.query('savepoint fk_probe');
  try {
    // 1. the referenced row, cloned into a throwaway tenant under new key values (FKs and triggers off)
    await c.query('set local session_replication_role = replica');
    // the id columns of the key get new values; a discriminator such as a category's `kind` keeps its value
    const overrides: Record<string, string> = {};
    const moved = others.filter((o) => shape.cols.find((x) => x.name === o.ref)?.type === 'uuid');
    if (moved.length === 0) throw new Error('the key has no uuid column to re-point');
    const fresh = moved.map(() => randomUUID());
    for (const [j, o] of moved.entries()) overrides[o.ref] = fresh[j]!;
    for (const col of shape.globalUnique) {
      if (col in overrides || col === 'tenant_id') continue;
      const type = shape.cols.find((x) => x.name === col)?.type ?? 'text';
      overrides[col] = type === 'uuid' ? randomUUID() : `probe-${randomUUID()}`;
    }
    const list = shape.cols.map((x) => q(x.name)).join(', ');
    const cloned = await c.query(
      `insert into ${rel(fk.parent)} (${list})
       select ${shape.cols.map((x) => `r.${q(x.name)}`).join(', ')}
         from ${rel(fk.parent)} p,
              jsonb_populate_record(null::${rel(fk.parent)},
                replace(to_jsonb(p)::text, $1, $2)::jsonb || $3::jsonb) r
        where p.tenant_id::text = $1 and ${others.map((o, i) => `p.${q(o.ref)}::text = $${i + 4}`).join(' and ')}`,
      [
        row.tenant_id,
        foreignTenant,
        JSON.stringify(overrides),
        ...others.map((_, i) => row[`v${i}`]),
      ],
    );
    if (cloned.rowCount !== 1) {
      throw new Error(`could not clone the referenced row (${cloned.rowCount})`);
    }
    await c.query('set local session_replication_role = origin');
    // 2. the referencing row, pointed at the clone: a key on the id alone would accept it
    await c.query('savepoint fk_probe_update');
    let code: string | undefined;
    let constraint: string | undefined;
    try {
      await c.query(
        `update ${rel(fk.child)} set ${moved.map((o, j) => `${q(o.col)} = $${j + 2}`).join(', ')} where ctid = $1::tid`,
        [row.ctid, ...fresh],
      );
    } catch (err) {
      code = (err as { code?: string }).code;
      constraint = (err as { constraint?: string }).constraint;
    }
    await c.query('rollback to savepoint fk_probe_update');
    if (code === '23503') out.probed.push(`${label}: ${how}, 23503 (${constraint})`);
    else if (code === undefined) {
      out.failures.push(`${label}: the reference into another tenant was ACCEPTED`);
    } else if (how === 'set') {
      // setting an unused optional reference broke another rule of the row first (a CHECK)
      out.unprobed.push(`${label}: setting the key on a fixture row fails with ${code} first`);
    } else out.failures.push(`${label}: expected 23503, got ${code}`);
  } catch (err) {
    out.failures.push(`${label}: probe error ${(err as Error).message}`);
  } finally {
    await c.query('rollback to savepoint fk_probe');
  }
}
