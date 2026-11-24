import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { env, mode, rawTenantTx, sqlState, withClient } from '../support/db.js';
import {
  type ImportHarness,
  type TenantFixture,
  analyzed,
  createTenant,
  csv,
  newTenancy,
  ownerTenantSql,
  startImportApp,
} from '../importer/support.js';

/**
 * M2-SEC-01 for the import tables (import_job, import_row, import_template): the two-tenant checks of the
 * isolation suite, direct and through PgBouncer. Tenant A owns an analysed import (with rows) and a saved
 * template; tenant B must see none of them, write none of them and reference none of them.
 */
describe.skipIf(!dbEnabled)(`tenant isolation of imports (${mode})`, () => {
  const tenancy = newTenancy();
  let ih: ImportHarness;
  let A: TenantFixture;
  let B: TenantFixture;
  let fx: {
    jobId: string;
    templateId: string;
    attachmentId: string;
    bJobId: string;
    aUserId: string;
  };
  const TABLES = ['import_job', 'import_row', 'import_template'] as const;

  beforeAll(async () => {
    ih = await startImportApp();
    A = await createTenant(ih.h.app, tenancy, 'impiso-a');
    B = await createTenant(ih.h.app, tenancy, 'impiso-b');
    const body = csv([
      ['Serial', 'Category'],
      ['A-1', 'Laptops'],
      ['A-2', 'Laptops'],
    ]);
    const job = await analyzed(ih, A.admin, A.tenantId, 'asset', { filename: 'a.csv', body });
    const tpl = await A.admin.post('/v1/import-templates', {
      name: 'A template',
      entity_type: 'asset',
      from_import_id: job.id,
    });
    expect(tpl.status, tpl.raw).toBe(201);
    const bJob = await analyzed(ih, B.admin, B.tenantId, 'asset', {
      filename: 'b.csv',
      body: csv([
        ['Serial', 'Category'],
        ['B-1', 'Laptops'],
      ]),
    });
    const me = await A.admin.get('/v1/auth/me');
    fx = {
      jobId: job.id,
      templateId: tpl.body.id,
      attachmentId: job.file_attachment_id,
      bJobId: bJob.id,
      aUserId: me.body.user.id,
    };
  });
  afterAll(async () => {
    await ih.h.close();
    await tenancy.onModuleDestroy();
  });

  const asTenant = <T>(tenantId: string, sql: string, params: unknown[] = []) =>
    withClient(env.databaseUrl!, (c) =>
      rawTenantTx(c, tenantId, async () => (await c.query(sql, params)).rows as T[]),
    );
  const run = (tenantId: string, sql: string, params: unknown[] = []) =>
    sqlState(
      withClient(env.databaseUrl!, (c) => rawTenantTx(c, tenantId, () => c.query(sql, params))),
    );

  it('each tenant sees its own rows, never the other tenant', async () => {
    for (const table of TABLES) {
      const own = await asTenant<{ n: number }>(
        A.tenantId,
        `select count(*)::int as n from app.${table}`,
      );
      expect(own[0]!.n, `${table} rows of A`).toBeGreaterThan(0);
      const foreign = await asTenant<{ n: number }>(
        B.tenantId,
        `select count(*)::int as n from app.${table} where tenant_id = $1`,
        [A.tenantId],
      );
      expect(foreign[0]!.n, `${table}: B reads A's rows`).toBe(0);
    }
    expect(
      await asTenant(B.tenantId, 'select 1 from app.import_row where job_id = $1', [fx.jobId]),
    ).toEqual([]);
    expect(
      await asTenant(B.tenantId, 'select 1 from app.import_job where id = $1', [fx.jobId]),
    ).toEqual([]);
    expect(
      await asTenant(B.tenantId, 'select 1 from app.import_template where id = $1', [
        fx.templateId,
      ]),
    ).toEqual([]);
  });

  it('an unset tenant context sees nothing, and not even the owner role does (FORCE RLS)', async () => {
    await withClient(env.databaseUrl!, async (c) => {
      for (const table of TABLES)
        expect(
          (await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n,
          table,
        ).toBe(0);
    });
    await withClient(env.migratorUrl!, async (c) => {
      for (const table of TABLES)
        expect(
          (await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n,
          `owner ${table}`,
        ).toBe(0);
    });
  });

  it("B cannot write rows for A (WITH CHECK, 42501) or reference A's rows from its own (composite FK, 23503)", async () => {
    const job = (tenant: string, extra = '') =>
      `insert into app.import_job (id, tenant_id, requested_by, source, entity_type${extra ? ', file_attachment_id' : ''})
       values ($1, '${tenant}', $2, 'csv', 'asset'${extra ? `, '${extra}'` : ''})`;
    const bUser = (
      await asTenant<{ id: string }>(B.tenantId, 'select id from app.user_account limit 1')
    )[0]!.id;
    expect(await run(B.tenantId, job(A.tenantId), [randomUUID(), bUser])).toBe('42501');
    // B's job requested by A's user, and B's job pointing at A's attachment
    expect(await run(B.tenantId, job(B.tenantId), [randomUUID(), fx.aUserId])).toBe('23503');
    expect(await run(B.tenantId, job(B.tenantId, fx.attachmentId), [randomUUID(), bUser])).toBe(
      '23503',
    );
    // rows: for A's job under A's tenant id (42501), and under B's tenant id (23503: no such job of B)
    const row = (tenant: string) =>
      `insert into app.import_row (tenant_id, job_id, row_no, line_no, raw) values ('${tenant}', $1, 99, 99, '[]'::jsonb)`;
    expect(await run(B.tenantId, row(A.tenantId), [fx.jobId])).toBe('42501');
    expect(await run(B.tenantId, row(B.tenantId), [fx.jobId])).toBe('23503');
    expect(
      await run(B.tenantId, `update app.import_row set plan = 'skip' where job_id = $1`, [
        fx.jobId,
      ]),
    ).toBeUndefined();
    const stillA = await ownerTenantSql(
      A.tenantId,
      `select count(*)::int as n from app.import_row where job_id = $1 and plan is not null`,
      [fx.jobId],
    );
    expect(stillA.rows[0]!.n).toBe(0);
  });

  it('the runtime role cannot delete jobs or templates, and the table CHECKs hold', async () => {
    expect(await run(A.tenantId, 'delete from app.import_job where id = $1', [fx.jobId])).toBe(
      '42501',
    );
    expect(
      await run(A.tenantId, 'delete from app.import_template where id = $1', [fx.templateId]),
    ).toBe('42501');
    // a commit needs a reviewed dry run
    expect(
      await run(A.tenantId, "update app.import_job set state = 'committing' where id = $1", [
        fx.jobId,
      ]),
    ).toBe('23514');
    expect(
      await run(A.tenantId, "update app.import_job set state = 'bogus' where id = $1", [fx.jobId]),
    ).toBe('23514');
    expect(
      await run(A.tenantId, "update app.import_row set plan = 'maybe' where job_id = $1", [
        fx.jobId,
      ]),
    ).toBe('23514');
    expect(
      await run(A.tenantId, "update app.import_job set dry_run_digest = 'xyz' where id = $1", [
        fx.jobId,
      ]),
    ).toBe('23514');
    expect(
      await run(A.tenantId, 'update app.import_job set mapping = $2::jsonb where id = $1', [
        fx.jobId,
        '[]',
      ]),
    ).toBe('23514');
  });

  it('the schema lint is clean and the grants are exactly what the module needs', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      expect((await c.query('select violation from app.schema_lint()')).rows).toEqual([]);
      const grants = await c.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'app_user' and table_schema = 'app' and table_name = any($1::text[])`,
        [[...TABLES]],
      );
      expect(grants.rows.map((r) => `${r.table_name}:${r.privilege_type}`).sort()).toEqual([
        'import_job:INSERT',
        'import_job:SELECT',
        'import_job:UPDATE',
        'import_row:DELETE',
        'import_row:INSERT',
        'import_row:SELECT',
        'import_row:UPDATE',
        'import_template:INSERT',
        'import_template:SELECT',
        'import_template:UPDATE',
      ]);
    });
  });

  it('a pooled connection never leaks one tenant context into the next', async () => {
    for (let i = 0; i < 6; i++) {
      const [a, b] = await Promise.all([
        asTenant<{ n: number }>(
          A.tenantId,
          'select count(*)::int as n from app.import_row where job_id = $1',
          [fx.jobId],
        ),
        asTenant<{ n: number }>(
          B.tenantId,
          'select count(*)::int as n from app.import_row where job_id = $1',
          [fx.jobId],
        ),
      ]);
      expect(a[0]!.n).toBe(2);
      expect(b[0]!.n).toBe(0);
    }
  });
});
