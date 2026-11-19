import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import { env, mode, rawTenantTx, sqlState, withClient } from '../support/db.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  keyed,
  newAccessory,
  newConsumable,
  newLocation,
  newPerson,
  newTenancy,
  startRegistryApp,
} from '../stock/support.js';

/**
 * M2-SEC-01 for the accessory tables (accessory, consumable, stock_movement, and the accessory
 * foreign key of assignment): the same two-tenant checks as the wave-1 isolation suite, direct and
 * through PgBouncer (this file runs in whichever mode the e2e suite runs). Tenant A owns rows in
 * every table; tenant B must see none of them, write none of them, and not even reference them.
 */
describe.skipIf(!dbEnabled)(`tenant isolation of accessories and consumables (${mode})`, () => {
  const tenancy = newTenancy();
  let app: App;
  let A: TenantFixture;
  let B: TenantFixture;
  let fx: {
    locationId: string;
    personId: string;
    accessoryId: string;
    categoryId: string;
    assignmentId: string;
    consumableId: string;
    movementId: string;
    bAccessoryId: string;
    bConsumableId: string;
    bCategoryId: string;
  };

  const TABLES = ['accessory', 'consumable', 'stock_movement'] as const;

  beforeAll(async () => {
    ({ app } = await startRegistryApp());
    A = await createTenant(app, tenancy, 'stka');
    B = await createTenant(app, tenancy, 'stkb');
    const location = await newLocation(A.admin);
    const person = await newPerson(A.admin);
    const accessory = await newAccessory(A.admin, { qty_total: 4, location_id: location.id });
    const out = await A.admin.post(
      `/v1/accessories/${accessory.id}/checkout`,
      { person_id: person.id, quantity: 2 },
      keyed(),
    );
    const consumable = await newConsumable(A.admin, { initial_qty: 3 });
    const moved = await A.admin.post(
      `/v1/consumables/${consumable.id}/movements`,
      { qty_delta: -1, reason: 'issue', person_id: person.id },
      keyed(),
    );
    const bAccessory = await newAccessory(B.admin, { qty_total: 2 });
    const bConsumable = await newConsumable(B.admin, { initial_qty: 1 });
    fx = {
      locationId: location.id,
      personId: person.id,
      accessoryId: accessory.id,
      categoryId: accessory.body.category_id,
      assignmentId: out.body.id,
      consumableId: consumable.id,
      movementId: moved.body.id,
      bAccessoryId: bAccessory.id,
      bConsumableId: bConsumable.id,
      bCategoryId: bAccessory.body.category_id,
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
  const insertAs = (tenantId: string, sql: string, params: unknown[]) =>
    sqlState(
      withClient(env.databaseUrl!, (c) => rawTenantTx(c, tenantId, () => c.query(sql, params))),
    );
  const defaultCompany = `(select id from app.company where is_default)`;

  it('each tenant sees its own rows in every table, never the other tenant', async () => {
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
      const ids = await asTenant<{ tenant_id: string }>(
        B.tenantId,
        `select distinct tenant_id from app.${table}`,
      );
      expect(
        ids.every((r) => r.tenant_id === B.tenantId),
        table,
      ).toBe(true);
    }
    expect(
      await asTenant(B.tenantId, `select id from app.accessory where id = $1`, [fx.accessoryId]),
    ).toEqual([]);
    expect(
      await asTenant(B.tenantId, `select id from app.consumable where id = $1`, [fx.consumableId]),
    ).toEqual([]);
    expect(
      await asTenant(B.tenantId, `select id from app.stock_movement where id = $1`, [
        fx.movementId,
      ]),
    ).toEqual([]);
    // the availability / low-stock views are security_invoker: B sees none of A's accessories there
    expect(
      await asTenant(
        B.tenantId,
        `select 1 from app.v_accessory_availability where accessory_id = $1`,
        [fx.accessoryId],
      ),
    ).toEqual([]);
    expect(
      await asTenant(B.tenantId, `select 1 from app.v_low_stock where item_id = any($1::uuid[])`, [
        [fx.accessoryId, fx.consumableId],
      ]),
    ).toEqual([]);
    expect(
      (
        await asTenant<{ qty_available: number }>(
          A.tenantId,
          `select qty_available from app.v_accessory_availability where accessory_id = $1`,
          [fx.accessoryId],
        )
      )[0]!.qty_available,
    ).toBe(2);
  });

  it('an unset tenant context sees nothing and cannot insert (fail closed, 42501)', async () => {
    await withClient(env.databaseUrl!, async (c) => {
      for (const table of TABLES) {
        expect(
          (await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n,
          table,
        ).toBe(0);
      }
      expect(
        await sqlState(
          c.query(
            `insert into app.accessory (id, tenant_id, company_id, category_id, name) values ($1, $2, $3, $4, 'x')`,
            [randomUUID(), A.tenantId, randomUUID(), fx.categoryId],
          ),
        ),
      ).toBe('42501');
    });
    // FORCE ROW LEVEL SECURITY: even the table owner sees nothing without a tenant context
    await withClient(env.migratorUrl!, async (c) => {
      for (const table of TABLES) {
        expect(
          (await c.query(`select count(*)::int as n from app.${table}`)).rows[0].n,
          `owner ${table}`,
        ).toBe(0);
      }
    });
  });

  it('B cannot write rows for A: WITH CHECK refuses a foreign tenant_id (42501) in every table', async () => {
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.accessory (id, tenant_id, company_id, category_id, name) values ($1, $2, ${defaultCompany}, $3, 'x')`,
        [randomUUID(), A.tenantId, fx.categoryId],
      ),
    ).toBe('42501');
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.consumable (id, tenant_id, company_id, category_id, name) values ($1, $2, ${defaultCompany}, $3, 'x')`,
        [randomUUID(), A.tenantId, fx.categoryId],
      ),
    ).toBe('42501');
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.stock_movement (id, tenant_id, consumable_id, qty_delta, reason) values ($1, $2, $3, 1, 'receive')`,
        [randomUUID(), A.tenantId, fx.consumableId],
      ),
    ).toBe('23503'); // the ledger trigger finds no such consumable in B first: refused either way
    // B's own session cannot move A's stock through an UPDATE either: the row is invisible
    const changed = await asTenant<{ id: string }>(
      B.tenantId,
      `update app.accessory set qty_total = 999 where id = $1 returning id`,
      [fx.accessoryId],
    );
    expect(changed).toEqual([]);
    const still = await asTenant<{ qty_total: number }>(
      A.tenantId,
      `select qty_total from app.accessory where id = $1`,
      [fx.accessoryId],
    );
    expect(still[0]!.qty_total).toBe(4);
  });

  it("B cannot reference A's rows from its own: composite foreign keys (tenant_id, id) refuse it (23503)", async () => {
    // B's accessory in A's category / A's location, B's consumable in A's category
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.accessory (id, tenant_id, company_id, category_id, name) values ($1, $2, ${defaultCompany}, $3, 'x')`,
        [randomUUID(), B.tenantId, fx.categoryId],
      ),
    ).toBe('23503');
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.accessory (id, tenant_id, company_id, category_id, location_id, name) values ($1, $2, ${defaultCompany}, $3, $4, 'x')`,
        [randomUUID(), B.tenantId, fx.bCategoryId, fx.locationId],
      ),
    ).toBe('23503');
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.consumable (id, tenant_id, company_id, category_id, name) values ($1, $2, ${defaultCompany}, $3, 'x')`,
        [randomUUID(), B.tenantId, fx.categoryId],
      ),
    ).toBe('23503');
    // an assignment of B's accessory to A's person, and of A's accessory under B's tenant id
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.assignment (id, tenant_id, accessory_id, person_id) values ($1, $2, $3, $4)`,
        [randomUUID(), B.tenantId, fx.bAccessoryId, fx.personId],
      ),
    ).toBe('23503');
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.assignment (id, tenant_id, accessory_id, person_id) values ($1, $2, $3, (select id from app.person limit 1))`,
        [randomUUID(), B.tenantId, fx.accessoryId],
      ),
    ).toBe('23503');
    // a movement of A's consumable under B's tenant id, and B's movement issued to A's person
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.stock_movement (id, tenant_id, consumable_id, qty_delta, reason) values ($1, $2, $3, 1, 'receive')`,
        [randomUUID(), B.tenantId, fx.consumableId],
      ),
    ).toBe('23503');
    expect(
      await insertAs(
        B.tenantId,
        `insert into app.stock_movement (id, tenant_id, consumable_id, qty_delta, reason, person_id) values ($1, $2, $3, 1, 'receive', $4)`,
        [randomUUID(), B.tenantId, fx.bConsumableId, fx.personId],
      ),
    ).toBe('23503');
  });

  it('the ledger is append-only for the runtime role; the accessory stock trigger holds in the database', async () => {
    const run = (sql: string, params: unknown[] = []) =>
      sqlState(
        withClient(env.databaseUrl!, (c) => rawTenantTx(c, A.tenantId, () => c.query(sql, params))),
      );
    expect(
      await run(`update app.stock_movement set note = 'tampered' where id = $1`, [fx.movementId]),
    ).toBe('42501');
    expect(await run(`delete from app.stock_movement where id = $1`, [fx.movementId])).toBe(
      '42501',
    );
    // 2 of 4 units are out: a direct insert for 3 more is refused by the trigger (23514), 2 more are fine
    const checkout = (quantity: number) =>
      run(
        `insert into app.assignment (id, tenant_id, accessory_id, person_id, quantity) values ($1, $2, $3, $4, $5)`,
        [randomUUID(), A.tenantId, fx.accessoryId, fx.personId, quantity],
      );
    expect(await checkout(3)).toBe('23514');
    // the total cannot be cut below the units that are out (23514)
    expect(
      await run(`update app.accessory set qty_total = 1 where id = $1`, [fx.accessoryId]),
    ).toBe('23514');
    // a closed (returned) period is not reopened and quantity never changes
    expect(
      await run(`update app.assignment set quantity = 9 where id = $1`, [fx.assignmentId]),
    ).toBe('23514');
    expect(
      await run(`update app.assignment set quantity_returned = 5 where id = $1`, [fx.assignmentId]),
    ).toBe('23514');
    expect(await checkout(2)).toBeUndefined();
  });

  it('the schema lint is clean with the new tables, views and grants', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      expect((await c.query('select violation from app.schema_lint()')).rows).toEqual([]);
      const grants = await c.query(
        `select table_name, privilege_type from information_schema.role_table_grants
          where grantee = 'app_user' and table_schema = 'app' and table_name = any($1::text[])`,
        [['stock_movement']],
      );
      expect(grants.rows.map((r) => `${r.table_name}:${r.privilege_type}`).sort()).toEqual([
        'stock_movement:INSERT',
        'stock_movement:SELECT',
      ]);
    });
  });

  it('the same names and label lookups coexist in both tenants, and a pooled connection never leaks the context', async () => {
    const name = 'Shared headset';
    const a = await newAccessory(A.admin, { name });
    const b = await newAccessory(B.admin, { name });
    expect(a.id).not.toBe(b.id);
    expect(a.body.label_code).not.toBe(b.body.label_code);
    for (let i = 0; i < 20; i++) {
      const tenant = i % 2 === 0 ? A : B;
      const mine = i % 2 === 0 ? a : b;
      const list = await tenant.admin.get(`/v1/accessories?q=${name.toLowerCase()}`);
      expect(list.body.data.map((x: { id: string }) => x.id)).toEqual([mine.id]);
    }
    // each tenant resolves only its own label
    expect((await B.admin.get(`/v1/scan/resolve?code=${a.body.label_code}`)).status).toBe(404);
    expect(
      (await A.admin.get(`/v1/scan/resolve?code=${a.body.label_code}`)).body.accessory.id,
    ).toBe(a.id);
  });
});
