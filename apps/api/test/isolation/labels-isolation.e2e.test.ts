import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { env, mode, rawTenantTx, sqlState, withClient } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  basics,
  createTenant,
  newAsset,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
} from '../lifecycle/support.js';

/**
 * M2-SEC-01 for the label tables (label_template, label_batch): the two-tenant checks of the isolation
 * suite, direct and through PgBouncer. Tenant A owns templates and a batch; tenant B must see none of
 * them, write none of them, and not reference them from its own rows.
 */
describe.skipIf(!dbEnabled)(`tenant isolation of label templates and batches (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  let fx: {
    templateId: string;
    batchId: string;
    assetId: string;
    bTemplateId: string;
    bAssetId: string;
  };
  const TABLES = ['label_template', 'label_batch'] as const;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    A = await createTenant(app, tenancy, 'labiso-a');
    B = await createTenant(app, tenancy, 'labiso-b');
    const basicsA = await basics(A);
    const basicsB = await basics(B);
    const asset = await newAsset(A.admin, basicsA.categoryId);
    const bAsset = await newAsset(B.admin, basicsB.categoryId);
    const templates = (await A.admin.get('/v1/labels/templates')).body.data as Array<{
      id: string;
    }>;
    const bTemplates = (await B.admin.get('/v1/labels/templates')).body.data as Array<{
      id: string;
    }>;
    const batch = await A.admin.post(
      '/v1/labels/batches',
      { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
      { headers: { 'idempotency-key': `labiso-${randomUUID()}` } },
    );
    expect(batch.status, batch.raw).toBe(202);
    fx = {
      templateId: templates[0]!.id,
      batchId: batch.body.id,
      assetId: asset.id,
      bTemplateId: bTemplates[0]!.id,
      bAssetId: bAsset.id,
    };
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  const asTenant = <T>(tenantId: string, sql: string, params: unknown[] = []) =>
    withClient(env.databaseUrl!, (c) =>
      rawTenantTx(c, tenantId, async () => (await c.query(sql, params)).rows as T[]),
    );
  const insertAs = (tenantId: string, sql: string, params: unknown[]) =>
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
      await asTenant(B.tenantId, 'select id from app.label_template where id = $1', [
        fx.templateId,
      ]),
    ).toEqual([]);
    expect(
      await asTenant(B.tenantId, 'select id from app.label_batch where id = $1', [fx.batchId]),
    ).toEqual([]);
    // both tenants have the SAME template keys, each its own rows
    const keysA = await asTenant<{ key: string }>(
      A.tenantId,
      'select key from app.label_template order by key',
    );
    const keysB = await asTenant<{ key: string }>(
      B.tenantId,
      'select key from app.label_template order by key',
    );
    expect(keysA).toEqual(keysB);
    expect(fx.templateId).not.toBe(fx.bTemplateId);
  });

  it('an unset tenant context sees nothing, and not even the owner role does (FORCE RLS)', async () => {
    await withClient(env.databaseUrl!, async (c) => {
      for (const table of TABLES) {
        expect(
          (await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n,
          table,
        ).toBe(0);
      }
      expect(
        await sqlState(c.query('select app.seed_label_templates($1::uuid)', [A.tenantId])),
      ).toBe('42501');
    });
    await withClient(env.migratorUrl!, async (c) => {
      for (const table of TABLES) {
        expect(
          (await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n,
          `owner ${table}`,
        ).toBe(0);
      }
    });
  });

  it("B cannot write rows for A (WITH CHECK, 42501) or reference A's rows from its own (composite FK, 23503)", async () => {
    const template = (tenant: string, key: string) =>
      `insert into app.label_template (id, tenant_id, key, name, page_size, page_width_mm, page_height_mm,
         label_width_mm, label_height_mm, cols, rows) values ($1, '${tenant}', '${key}', 'x', 'custom', 50, 25, 50, 25, 1, 1)`;
    expect(await insertAs(B.tenantId, template(A.tenantId, 'b-was-here'), [randomUUID()])).toBe(
      '42501',
    );

    const batch = (tenant: string, templateId: string) =>
      `insert into app.label_batch (id, tenant_id, template_id, template_key, asset_ids, asset_count, label_count,
         codes, fields, expires_at) values ($1, '${tenant}', '${templateId}', 'k', array['${randomUUID()}']::uuid[], 1, 1,
         array['qr'], array['asset_tag'], now())`;
    expect(await insertAs(B.tenantId, batch(A.tenantId, fx.bTemplateId), [randomUUID()])).toBe(
      '42501',
    );
    // B's batch on A's template
    expect(await insertAs(B.tenantId, batch(B.tenantId, fx.templateId), [randomUUID()])).toBe(
      '23503',
    );
    // B's batch with A's attachment as logo
    const att = await ownerTenantSql(A.tenantId, 'select id from app.attachment limit 1');
    if (att.rows[0]) {
      expect(
        await insertAs(
          B.tenantId,
          `insert into app.label_batch (id, tenant_id, template_id, template_key, asset_ids, asset_count, label_count,
             codes, fields, expires_at, logo_attachment_id)
           values ($1, '${B.tenantId}', '${fx.bTemplateId}', 'k', array['${fx.bAssetId}']::uuid[], 1, 1,
             array['qr'], array['asset_tag'], now(), '${att.rows[0].id}')`,
          [randomUUID()],
        ),
      ).toBe('23503');
    }
  });

  it('the runtime role cannot delete templates or batches, and the table CHECKs hold', async () => {
    const run = (tenant: string, sql: string, params: unknown[] = []) =>
      insertAs(tenant, sql, params);
    expect(
      await run(A.tenantId, 'delete from app.label_template where id = $1', [fx.templateId]),
    ).toBe('42501');
    expect(await run(A.tenantId, 'delete from app.label_batch where id = $1', [fx.batchId])).toBe(
      '42501',
    );
    // a template's geometry must fit its page; offsets are bounded
    expect(
      await run(A.tenantId, 'update app.label_template set offset_x_mm = 11 where id = $1', [
        fx.templateId,
      ]),
    ).toBe('23514');
    expect(
      await run(A.tenantId, 'update app.label_template set cols = 9 where id = $1', [
        fx.templateId,
      ]),
    ).toBe('23514');
    // a ready batch needs its file; a storage key outside the tenant's prefix is refused
    expect(
      await run(A.tenantId, "update app.label_batch set status = 'ready' where id = $1", [
        fx.batchId,
      ]),
    ).toBe('23514');
    expect(
      await run(
        A.tenantId,
        "update app.label_batch set storage_key = 'tenants/other/2026/x' where id = $1",
        [fx.batchId],
      ),
    ).toBe('23514');
  });

  it('the schema lint is clean and the grants are exactly select/insert/update', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      expect((await c.query('select violation from app.schema_lint()')).rows).toEqual([]);
      const grants = await c.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'app_user' and table_schema = 'app' and table_name = any($1::text[])`,
        [[...TABLES]],
      );
      expect(grants.rows.map((r) => `${r.table_name}:${r.privilege_type}`).sort()).toEqual([
        'label_batch:INSERT',
        'label_batch:SELECT',
        'label_batch:UPDATE',
        'label_template:INSERT',
        'label_template:SELECT',
        'label_template:UPDATE',
      ]);
    });
  });

  it('a pooled connection never leaks one tenant context into the next', async () => {
    for (let i = 0; i < 6; i++) {
      const [a, b] = await Promise.all([
        asTenant<{ n: number }>(A.tenantId, 'select count(*)::int as n from app.label_batch'),
        asTenant<{ n: number }>(B.tenantId, 'select count(*)::int as n from app.label_batch'),
      ]);
      expect(a[0]!.n).toBeGreaterThan(0);
      expect(b[0]!.n).toBe(0);
    }
  });
});
