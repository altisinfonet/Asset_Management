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
  keyed,
  newAsset,
  newLocation,
  newPerson,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
} from '../lifecycle/support.js';

/**
 * M2-SEC-01 for the wave-1 tables (location, person, assignment, transfer, asset_history): the same
 * two-tenant checks as the M1 isolation suite, direct and through PgBouncer (this file runs in
 * whichever mode the e2e suite runs). Tenant A owns rows in every table; tenant B must see none of
 * them, write none of them, and not even reference them from its own rows.
 */
describe.skipIf(!dbEnabled)(`tenant isolation of locations, people and custody (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  let fx: {
    locationId: string;
    personId: string;
    assetId: string;
    bAssetId: string;
    assignmentId: string;
    transferId: string;
    historyId: string;
  };

  const TABLES = ['location', 'person', 'assignment', 'transfer', 'asset_history'] as const;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    A = await createTenant(app, tenancy, 'isoa');
    B = await createTenant(app, tenancy, 'isob');
    const basicsA = await basics(A);
    const basicsB = await basics(B);
    const location = await newLocation(A.admin);
    const person = await newPerson(A.admin);
    const other = await newPerson(A.admin);
    const asset = await newAsset(A.admin, basicsA.categoryId, { location_id: location.id });
    await A.admin.post(`/v1/assets/${asset.id}/checkout`, { person_id: person.id }, keyed());
    const transfer = await A.admin.post(`/v1/assets/${asset.id}/transfer`, { person_id: other.id }, keyed());
    const bAsset = await newAsset(B.admin, basicsB.categoryId);
    const history = await ownerTenantSql(A.tenantId, `select id from app.asset_history where asset_id = $1 limit 1`, [asset.id]);
    fx = {
      locationId: location.id,
      personId: person.id,
      assetId: asset.id,
      bAssetId: bAsset.id,
      assignmentId: transfer.body.assignment.id,
      transferId: transfer.body.transfer.id,
      historyId: history.rows[0].id,
    };
  });
  afterAll(async () => {
    await app.close();
    await tenancy.onModuleDestroy();
  });

  /** Runs `sql` as app_user inside tenant `tenantId`'s context. */
  const asTenant = <T>(tenantId: string, sql: string, params: unknown[] = []) =>
    withClient(env.databaseUrl!, (c) =>
      rawTenantTx(c, tenantId, async () => (await c.query(sql, params)).rows as T[]),
    );

  it('each tenant sees its own rows in every table, never the other tenant', async () => {
    for (const table of TABLES) {
      const own = await asTenant<{ n: number }>(A.tenantId, `select count(*)::int as n from app.${table}`);
      expect(own[0]!.n, `${table} rows of A`).toBeGreaterThan(0);
      const foreign = await asTenant<{ n: number }>(
        B.tenantId,
        `select count(*)::int as n from app.${table} where tenant_id = $1`,
        [A.tenantId],
      );
      expect(foreign[0]!.n, `${table}: B reads A's rows`).toBe(0);
      const ids = await asTenant<{ tenant_id: string }>(B.tenantId, `select distinct tenant_id from app.${table}`);
      expect(ids.every((r) => r.tenant_id === B.tenantId), table).toBe(true);
    }
    // direct lookups of A's ids from B come back empty
    expect(await asTenant(B.tenantId, `select id from app.location where id = $1`, [fx.locationId])).toEqual([]);
    expect(await asTenant(B.tenantId, `select id from app.person where id = $1`, [fx.personId])).toEqual([]);
    expect(await asTenant(B.tenantId, `select id from app.assignment where id = $1`, [fx.assignmentId])).toEqual([]);
    expect(await asTenant(B.tenantId, `select id from app.transfer where id = $1`, [fx.transferId])).toEqual([]);
    expect(await asTenant(B.tenantId, `select id from app.asset_history where id = $1`, [fx.historyId])).toEqual([]);
  });

  it('an unset tenant context sees nothing and cannot insert (fail closed, 42501)', async () => {
    await withClient(env.databaseUrl!, async (c) => {
      for (const table of TABLES) {
        expect((await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n, table).toBe(0);
      }
      expect(
        await sqlState(
          c.query(`insert into app.location (id, tenant_id, company_id, name) values ($1, $2, $3, 'x')`, [randomUUID(), A.tenantId, randomUUID()]),
        ),
      ).toBe('42501');
    });
    // FORCE ROW LEVEL SECURITY: even the table owner sees nothing without a tenant context
    await withClient(env.migratorUrl!, async (c) => {
      for (const table of TABLES) {
        expect((await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n, `owner ${table}`).toBe(0);
      }
    });
  });

  it("B cannot write rows for A: WITH CHECK refuses a foreign tenant_id (42501) in every table", async () => {
    const insert = (sql: string, params: unknown[]) =>
      sqlState(withClient(env.databaseUrl!, (c) => rawTenantTx(c, B.tenantId, () => c.query(sql, params))));
    expect(await insert(`insert into app.location (id, tenant_id, company_id, name) values ($1, $2, (select id from app.company where is_default), 'x')`, [randomUUID(), A.tenantId])).toBe('42501');
    expect(await insert(`insert into app.person (id, tenant_id, company_id, display_name) values ($1, $2, (select id from app.company where is_default), 'x')`, [randomUUID(), A.tenantId])).toBe('42501');
    expect(await insert(`insert into app.assignment (id, tenant_id, asset_id, person_id) values ($1, $2, $3, $4)`, [randomUUID(), A.tenantId, fx.assetId, fx.personId])).toBe('42501');
    expect(await insert(`insert into app.asset_history (id, tenant_id, asset_id, event_type) values ($1, $2, $3, 'updated')`, [randomUUID(), A.tenantId, fx.assetId])).toBe('42501');
    expect(await insert(`insert into app.transfer (id, tenant_id, asset_id, to_assignment_id) values ($1, $2, $3, $4)`, [randomUUID(), A.tenantId, fx.assetId, fx.assignmentId])).toBe('42501');
  });

  it("B cannot reference A's rows from its own: composite foreign keys (tenant_id, id) refuse it (23503)", async () => {
    const insert = (sql: string, params: unknown[]) =>
      sqlState(withClient(env.databaseUrl!, (c) => rawTenantTx(c, B.tenantId, () => c.query(sql, params))));
    // B's own asset checked out to A's person / location / asset
    expect(await insert(`insert into app.assignment (id, tenant_id, asset_id, person_id) values ($1, $2, $3, $4)`, [randomUUID(), B.tenantId, fx.bAssetId, fx.personId])).toBe('23503');
    expect(await insert(`insert into app.assignment (id, tenant_id, asset_id, location_id) values ($1, $2, $3, $4)`, [randomUUID(), B.tenantId, fx.bAssetId, fx.locationId])).toBe('23503');
    expect(await insert(`insert into app.assignment (id, tenant_id, asset_id, target_asset_id) values ($1, $2, $3, $4)`, [randomUUID(), B.tenantId, fx.bAssetId, fx.assetId])).toBe('23503');
    // A's asset on B's assignment
    expect(await insert(`insert into app.assignment (id, tenant_id, asset_id, person_id) values ($1, $2, $3, (select id from app.person limit 1))`, [randomUUID(), B.tenantId, fx.assetId])).toBe('23503');
    // B's person living in A's location, a child under A's location, B's asset located in A's place
    expect(await insert(`insert into app.person (id, tenant_id, company_id, display_name, location_id) values ($1, $2, (select id from app.company where is_default), 'x', $3)`, [randomUUID(), B.tenantId, fx.locationId])).toBe('23503');
    expect(await insert(`insert into app.location (id, tenant_id, company_id, name, parent_id) values ($1, $2, (select id from app.company where is_default), 'x', $3)`, [randomUUID(), B.tenantId, fx.locationId])).toBe('23503');
    expect(await sqlState(withClient(env.databaseUrl!, (c) => rawTenantTx(c, B.tenantId, () => c.query(`update app.asset set location_id = $1 where id = $2`, [fx.locationId, fx.bAssetId]))))).toBe('23503');
    // history of A's asset written under B's tenant id
    expect(await insert(`insert into app.asset_history (id, tenant_id, asset_id, event_type) values ($1, $2, $3, 'updated')`, [randomUUID(), B.tenantId, fx.assetId])).toBe('23503');
    // a role assignment scoped to A's location
    expect(await insert(`insert into app.role_assignment (id, tenant_id, user_id, role_id, scope_type, scope_location_id) values ($1, $2, (select id from app.user_account limit 1), (select id from app.role where key = 'viewer'), 'location', $3)`, [randomUUID(), B.tenantId, fx.locationId])).toBe('23503');
  });

  it('asset_history and transfer are append-only for the runtime role; partitions carry no grants', async () => {
    const run = (sql: string, params: unknown[] = []) =>
      sqlState(withClient(env.databaseUrl!, (c) => rawTenantTx(c, A.tenantId, () => c.query(sql, params))));
    expect(await run(`update app.asset_history set summary = 'tampered' where id = $1`, [fx.historyId])).toBe('42501');
    expect(await run(`delete from app.asset_history where id = $1`, [fx.historyId])).toBe('42501');
    expect(await run(`update app.transfer set reason = 'tampered' where id = $1`, [fx.transferId])).toBe('42501');
    expect(await run(`delete from app.transfer where id = $1`, [fx.transferId])).toBe('42501');
    // reading a partition directly would bypass the parent's policy: no grant on it
    expect(await run(`select count(*) from app.asset_history_default`)).toBe('42501');
    const month = new Date().toISOString().slice(0, 7).replace('-', '_');
    expect(await run(`select count(*) from app.asset_history_${month}`)).toBe('42501');
    // and none of the tables is insertable-around: the row is still intact
    const row = await asTenant<{ summary: string | null }>(A.tenantId, `select summary from app.asset_history where id = $1`, [fx.historyId]);
    expect(row[0]!.summary).not.toBe('tampered');
  });

  it('the schema lint is clean with the new tables and every asset_history partition is FORCE RLS with no grants', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      expect((await c.query('select violation from app.schema_lint()')).rows).toEqual([]);
      const parts = await c.query(
        `select c.relname, c.relforcerowsecurity as forced, c.relacl::text as acl
           from pg_class c join pg_inherits i on i.inhrelid = c.oid
          where i.inhparent = 'app.asset_history'::regclass`,
      );
      expect(parts.rows.length).toBeGreaterThanOrEqual(13); // 12 months + default
      for (const p of parts.rows) {
        expect(p.forced, p.relname).toBe(true);
        expect(String(p.acl ?? ''), p.relname).not.toMatch(/app_user/);
      }
      const grants = await c.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'app_user' and table_schema = 'app' and table_name = any($1::text[])`,
        [['asset_history', 'transfer']],
      );
      expect(grants.rows.map((r) => `${r.table_name}:${r.privilege_type}`).sort()).toEqual([
        'asset_history:INSERT',
        'asset_history:SELECT',
        'transfer:INSERT',
        'transfer:SELECT',
      ]);
    });
  });

  it('the same names, emails and tags coexist in both tenants, and a pooled connection never leaks the context', async () => {
    const [nameA, nameB] = ['Shared hall', 'Shared hall'];
    expect((await A.admin.post('/v1/locations', { name: nameA })).status).toBe(201);
    expect((await B.admin.post('/v1/locations', { name: nameB })).status).toBe(201);
    expect((await A.admin.post('/v1/people', { display_name: 'Same', email: 'same@iso.example', employee_ref: 'E-1' })).status).toBe(201);
    expect((await B.admin.post('/v1/people', { display_name: 'Same', email: 'same@iso.example', employee_ref: 'E-1' })).status).toBe(201);
    // interleave reads of both tenants on the shared pool: each only ever sees its own
    for (let i = 0; i < 10; i++) {
      const [ra, rb] = await Promise.all([A.admin.get('/v1/locations?limit=200'), B.admin.get('/v1/locations?limit=200')]);
      expect(ra.body.data.some((l: { id: string }) => l.id === fx.locationId)).toBe(true);
      expect(rb.body.data.some((l: { id: string }) => l.id === fx.locationId)).toBe(false);
    }
  });
});
