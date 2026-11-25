import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../src/ids/uuidv7.js';
import { auditRoles, ensurePartitions, schemaLint } from '../src/db/maintenance.js';
import { applyMigrations, DEFAULT_MIGRATIONS_DIR, loadMigrations } from '../src/db/migrator.js';
import { connect, dbEnabled, env, sqlState, withClient } from './support/db.js';

/** Runs `ddl` as the owner inside a transaction, returns the lint output, and rolls back. */
async function lintAfter(ddl: string, url = env.migratorUrl!): Promise<string[]> {
  const c = await connect(url);
  try {
    await c.query('BEGIN');
    await c.query(ddl);
    const v = await schemaLint(c);
    await c.query('ROLLBACK');
    return v;
  } finally {
    await c.end();
  }
}

describe.skipIf(!dbEnabled)('schema lint, role audit and migrations (M1-TEN-03, M1-DB-02)', () => {
  it('a freshly migrated database has no lint violations and a clean role audit', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      expect(await schemaLint(c)).toEqual([]);
      expect(await auditRoles(c)).toEqual([]);
    });
  });

  it('migrating again is a no-op (checksums match, nothing applied)', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      const migrations = await loadMigrations(DEFAULT_MIGRATIONS_DIR);
      expect(await applyMigrations(c, migrations)).toEqual([]);
    });
  });

  describe('every rule has a failing fixture proving that it fires', () => {
    const cases: Array<{ rule: string; ddl: string; expected: RegExp }> = [
      {
        rule: '1. tenant table without RLS',
        ddl: `create table app.zz_norls (id uuid primary key, tenant_id uuid not null references app.tenant (id));
              create index on app.zz_norls (tenant_id);`,
        expected: /table app\.zz_norls lacks RLS\/FORCE or the tenant_isolation policy/,
      },
      {
        rule: '1. RLS enabled but not FORCEd',
        ddl: `select app.create_tenant_table('zz_noforce', 'v text');
              alter table app.zz_noforce no force row level security;`,
        expected: /table app\.zz_noforce lacks RLS\/FORCE/,
      },
      {
        rule: '1. policy without the NULLIF form',
        ddl: `select app.create_tenant_table('zz_bare', 'v text');
              drop policy tenant_isolation on app.zz_bare;
              create policy tenant_isolation on app.zz_bare
                using (tenant_id = current_setting('app.tenant_id', true)::uuid)
                with check (tenant_id = current_setting('app.tenant_id', true)::uuid);`,
        expected: /table app\.zz_bare lacks RLS\/FORCE/,
      },
      {
        rule: '1. policy without WITH CHECK',
        ddl: `select app.create_tenant_table('zz_nocheck', 'v text');
              drop policy tenant_isolation on app.zz_nocheck;
              create policy tenant_isolation on app.zz_nocheck
                using (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid));`,
        expected: /table app\.zz_nocheck lacks RLS\/FORCE/,
      },
      {
        rule: '2. no tenant-led index',
        ddl: `create table app.zz_noidx (id uuid primary key, tenant_id uuid not null);
              select app.apply_tenant_conventions('app.zz_noidx');`,
        expected: /table app\.zz_noidx has no index led by tenant_id/,
      },
      {
        rule: '3. grant on a partition (to app_user)',
        ddl: 'grant select on app.audit_log_default to app_user;',
        expected: /partition app\.audit_log_default has a grant to app_user/,
      },
      {
        rule: '3. grant on a partition (to PUBLIC)',
        ddl: 'grant select on app.audit_log_default to public;',
        expected: /partition app\.audit_log_default has a grant to PUBLIC/,
      },
      {
        rule: '4. view without security_invoker',
        ddl: 'create view app.zz_view as select 1 as x;',
        expected: /view app\.zz_view is not security_invoker/,
      },
      {
        rule: '5. SECURITY DEFINER function',
        ddl: `create function app.zz_definer() returns int language sql security definer as 'select 1';`,
        expected: /function app\.zz_definer is SECURITY DEFINER/,
      },
      {
        rule: '6b. runtime role may create objects',
        ddl: 'grant create on schema app to app_user;',
        expected: /app_user has CREATE on schema app/,
      },
      {
        rule: '7. database-side uuidv7() default',
        ddl: `create function app.uuidv7() returns uuid language sql as 'select gen_random_uuid()';
              create table app.zz_v7 (id uuid primary key default app.uuidv7(), tenant_id uuid not null);`,
        expected: /column zz_v7\.id has a uuidv7\(\) default/,
      },
      {
        rule: '8. non-composite foreign key between tenant tables',
        // The referenced tenant table is a fixture of the same (rolled back) transaction, never a live
        // table: a foreign key to app.asset would hold a SHARE ROW EXCLUSIVE lock on app.asset until the
        // rollback, and asset writes of the e2e files running in parallel then deadlock against it
        // (seen as a 500 on a check-in in a pooled run).
        ddl: `select app.create_tenant_table('zz_fk_parent', 'v text');
              create table app.zz_fk (id uuid primary key, tenant_id uuid not null references app.tenant (id), parent_id uuid references app.zz_fk_parent (id));
              create index on app.zz_fk (tenant_id);
              select app.apply_tenant_conventions('app.zz_fk');`,
        expected: /foreign key zz_fk_parent_id_fkey on app\.zz_fk must be composite/,
      },
      {
        // M2-SEC-01 (0170): both column lists contain tenant_id, but tenant_id is paired with the parent's
        // id, so the key does not keep the reference inside the tenant. The earlier form of rule 8 let it pass.
        rule: '8. composite foreign key that pairs tenant_id with an id column',
        ddl: `select app.create_tenant_table('zz_fkm_parent', 'v text');
              select app.create_tenant_table('zz_fkm', 'parent_id uuid');
              alter table app.zz_fkm add constraint zz_fkm_misaligned
                foreign key (tenant_id, parent_id) references app.zz_fkm_parent (id, tenant_id);`,
        expected: /foreign key zz_fkm_misaligned on app\.zz_fkm must be composite/,
      },
      {
        rule: '9. unclassified table in schema app',
        ddl: 'create table app.zz_unclassified (id int);',
        expected: /table app\.zz_unclassified is unclassified/,
      },
      {
        rule: '9. identity table without a non-tenant classification comment',
        ddl: 'create table identity.zz_uncommented (id int);',
        expected: /table identity\.zz_uncommented is unclassified/,
      },
    ];

    it.each(cases)('$rule', async ({ ddl, expected }) => {
      const violations = await lintAfter(ddl);
      expect(
        violations.filter((v) => expected.test(v)),
        violations.join('\n'),
      ).toHaveLength(1);
    });

    it('the database stays clean afterwards (every fixture rolled back)', async () => {
      await withClient(env.migratorUrl!, async (c) => expect(await schemaLint(c)).toEqual([]));
    });

    it.skipIf(!env.adminUrl)(
      '6. a BYPASSRLS or superuser application role fails the lint and the role audit (superuser fixture)',
      async () => {
        const c = await connect(env.adminUrl!);
        try {
          await c.query('BEGIN');
          await c.query('alter role app_user bypassrls');
          expect((await schemaLint(c)).join('\n')).toMatch(
            /role app_user is superuser or BYPASSRLS/,
          );
          expect((await auditRoles(c)).join('\n')).toMatch(/app_user is BYPASSRLS/);
          await c.query('ROLLBACK');

          await c.query('BEGIN');
          await c.query('alter role app_user createrole');
          expect((await auditRoles(c)).join('\n')).toMatch(/app_user has CREATEROLE/);
          await c.query('ROLLBACK');

          // A future reporting role with BYPASSRLS and access to the application schemas is caught too.
          await c.query('BEGIN');
          await c.query('create role zz_reporting nologin bypassrls');
          await c.query('grant usage on schema app to zz_reporting');
          expect((await auditRoles(c)).join('\n')).toMatch(/zz_reporting is BYPASSRLS/);
          await c.query('ROLLBACK');
        } finally {
          await c.end();
        }
        await withClient(env.migratorUrl!, async (client) =>
          expect(await auditRoles(client)).toEqual([]),
        );
      },
    );
  });

  describe('app.create_tenant_table (the approved helper, M1-TEN-01)', () => {
    async function inRolledBackTx<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
      const c = await connect(env.migratorUrl!);
      try {
        await c.query('BEGIN');
        const result = await fn(c);
        await c.query('ROLLBACK');
        return result;
      } finally {
        await c.end();
      }
    }
    const setTenant = (c: pg.Client, id: string) =>
      c.query("select set_config('app.tenant_id', $1, true)", [id]);

    it('emits a table that passes the lint and isolates tenants: unset and empty GUC give 0 rows, a foreign tenant_id gives 42501', async () => {
      const [a, b] = [uuidv7(), uuidv7()];
      const out = await inRolledBackTx(async (c) => {
        await c.query(
          `select app.create_tenant_table('zz_probe', 'label text not null', 'select, insert, update', true)`,
        );
        const meta = (
          await c.query(`
            select c.relrowsecurity, c.relforcerowsecurity,
                   (select count(*)::int from pg_policy p where p.polrelid = c.oid and p.polname = 'tenant_isolation') as policies,
                   has_table_privilege('app_user', c.oid, 'select,insert,update') as dml,
                   has_table_privilege('app_user', c.oid, 'delete') as del,
                   (select count(*)::int from pg_trigger t where t.tgrelid = c.oid and not t.tgisinternal) as triggers
              from pg_class c where c.oid = 'app.zz_probe'::regclass`)
        ).rows[0];

        // Two tenants (the owner is bound by FORCE too, so the tenant context is set per insert).
        for (const id of [a, b]) {
          await setTenant(c, id);
          await c.query("insert into app.tenant (id, name) values ($1, 'probe')", [id]);
          await c.query(
            "insert into app.company (id, tenant_id, name, is_default) values ($1, $2, 'probe', true)",
            [uuidv7(), id],
          );
          // company_id is filled by the trigger the helper installs (p_company = true)
          await c.query('insert into app.zz_probe (id, tenant_id, label) values ($1, $2, $3)', [
            uuidv7(),
            id,
            `row-${id}`,
          ]);
        }
        const count = async () =>
          (await c.query('select count(*)::int as n from app.zz_probe')).rows[0].n as number;

        await setTenant(c, a);
        const seenA = await count();
        await setTenant(c, '');
        const seenEmpty = await count(); // a used pooled connection: GUC is '' (no 22P02)
        await c.query('RESET app.tenant_id'); // back to unset inside this throwaway transaction
        const seenUnset = await count();

        await setTenant(c, a);
        await c.query('SAVEPOINT s');
        const foreign = await sqlState(
          c.query("insert into app.zz_probe (id, tenant_id, label) values ($1, $2, 'x')", [
            uuidv7(),
            b,
          ]),
        );
        await c.query('ROLLBACK TO s');
        const lint = await schemaLint(c);
        return { meta, seenA, seenEmpty, seenUnset, foreign, lint };
      });
      expect(out.meta).toMatchObject({
        relrowsecurity: true,
        relforcerowsecurity: true,
        policies: 1,
        dml: true,
        del: false,
      });
      expect(out.meta.triggers).toBeGreaterThanOrEqual(2); // touch_row + fill_default_company
      expect(out.seenA).toBe(1);
      expect(out.seenEmpty).toBe(0);
      expect(out.seenUnset).toBe(0);
      expect(out.foreign).toBe('42501');
      expect(out.lint).toEqual([]);
    });

    it('apply_tenant_conventions refuses a partition and a table outside schema app', async () => {
      await inRolledBackTx(async (c) => {
        await c.query('SAVEPOINT s');
        expect(
          await sqlState(c.query(`select app.apply_tenant_conventions('app.audit_log_default')`)),
        ).toBe('P0001');
        await c.query('ROLLBACK TO s');
        expect(
          await sqlState(c.query(`select app.apply_tenant_conventions('identity.session')`)),
        ).toBe('P0001');
      });
    });

    it('app_user cannot execute the helpers or the partition factory', async () => {
      await withClient(env.databaseUrl!, async (c) => {
        expect(await sqlState(c.query(`select app.create_tenant_table('zz_denied')`))).toBe(
          '42501',
        );
        expect(await sqlState(c.query(`select app.apply_tenant_conventions('app.asset')`))).toBe(
          '42501',
        );
        expect(await sqlState(c.query(`select app.ensure_partitions(current_date, 1)`))).toBe(
          '42501',
        );
        expect(await sqlState(c.query('create table app.zz_denied (id int)'))).toBe('42501');
      });
    });
  });

  describe('partition rotation (M1-TEN-06)', () => {
    const year = 2040 + Math.floor(Math.random() * 50);
    // Both partitioned tables get partitions in the far-future year (audit_log and asset_history); drop
    // both before and after, otherwise a leftover of an earlier run that drew the same random year
    // makes the "created 6" count come out smaller.
    // Dropping an asset_history partition drops its cloned foreign keys, which locks app.asset and
    // app.assignment like creating one does (see ensurePartitions): with a short lock_timeout the drop
    // gives up and retries instead of the deadlock detector cancelling a custody transaction of a test
    // file running in parallel.
    const dropFutureYear = () =>
      withClient(env.migratorUrl!, async (c) => {
        await c.query("set lock_timeout = '200ms'");
        for (const table of ['audit_log', 'asset_history'])
          for (const m of ['01', '02', '03'])
            for (let attempt = 1; ; attempt++) {
              const code = await sqlState(
                c.query(`drop table if exists app.${table}_${year}_${m}`),
              );
              if (code === undefined) break;
              if ((code !== '55P03' && code !== '40P01') || attempt >= 20) throw new Error(code);
              await new Promise((r) => setTimeout(r, 100 * attempt));
            }
      });
    beforeAll(dropFutureYear);
    afterAll(dropFutureYear);

    it('creating future partitions needs no manual step, is idempotent, and every partition is FORCE-RLS with no grants', async () => {
      await withClient(env.migratorUrl!, async (c) => {
        await c.query("set time zone 'UTC'");
        // "Advance the clock": ask for 3 months starting in a far-future month.
        // Since M2 wave 1 two tables are partitioned (audit_log and asset_history, ED-09): one call
        // covers both, so 3 months create 3 partitions of each.
        const first = await ensurePartitions(c, new Date(`${year}-01-15T00:00:00Z`), 3);
        expect(first).toBe(6);
        expect(await ensurePartitions(c, new Date(`${year}-01-15T00:00:00Z`), 3)).toBe(0);
        for (const table of ['audit_log', 'asset_history']) {
          const { rows } = await c.query(
            `select c.relname, c.relrowsecurity and c.relforcerowsecurity as forced, c.relacl::text as acl,
                    pg_get_expr(c.relpartbound, c.oid) as bound
               from pg_class c where c.relkind = 'r' and c.relname like $1 order by c.relname`,
            [`${table}_${year}_%`],
          );
          expect(rows.map((r) => r.relname)).toEqual([
            `${table}_${year}_01`,
            `${table}_${year}_02`,
            `${table}_${year}_03`,
          ]);
          for (const r of rows) {
            expect(r.forced).toBe(true);
            expect(String(r.acl ?? '')).not.toMatch(/app_user/);
          }
          expect(rows[0].bound).toContain(`${year}-01-01 00:00:00+00`);
        }
        expect(await schemaLint(c)).toEqual([]);
      });
    });
  });
});
