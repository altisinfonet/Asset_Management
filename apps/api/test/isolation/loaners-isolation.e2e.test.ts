import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newObjectKey } from '../../src/storage/index.js';
import { dbEnabled } from '../auth/support.js';
import {
  env,
  mode,
  rawTenantTx,
  schemaLintViolations,
  sqlState,
  withClient,
} from '../support/db.js';
import {
  type App,
  type TenantFixture,
  createTenant,
  keyed,
  newLocation,
  newPerson,
  newTenancy,
  ownerTenantSql,
  startRegistryApp,
} from '../stock/support.js';

/**
 * M2-SEC-01 for the loaner tables (loaner_pool, loaner_pool_member, loan_alert, and loans: assignments
 * with a loaner pool) and for the named cross-tenant references of the story: an assignment, a loan, a
 * repair, an import row, a pool membership and an attachment that point at another tenant's record must
 * each be refused by the database itself (composite foreign keys; for the polymorphic attachment owner
 * the 0170 guard trigger), whoever writes them. Runs direct and through PgBouncer like every e2e file.
 */
describe.skipIf(!dbEnabled)(
  `tenant isolation of loaners and cross-tenant references (${mode})`,
  () => {
    const tenancy = newTenancy();
    let app: App;
    let A: TenantFixture;
    let B: TenantFixture;
    let fx: {
      a: {
        personId: string;
        assetId: string;
        poolId: string;
        loanerAssetId: string;
        loanId: string;
        alertId: string;
        repairId: string;
        importId: string;
        userId: string;
      };
      b: {
        personId: string;
        assetId: string;
        poolId: string;
        loanerAssetId: string;
        userId: string;
      };
    };

    const TABLES = ['loaner_pool', 'loaner_pool_member', 'loan_alert'] as const;

    /** A tenant with a category, a person, an asset, a pool with a device on loan (and a loan alert). */
    async function world(T: TenantFixture, label: string) {
      const category = (await T.admin.post('/v1/categories', { name: `${label} laptops` })).body;
      const person = await newPerson(T.admin);
      const asset = (await T.admin.post('/v1/assets', { category_id: category.id })).body;
      const location = await newLocation(T.admin);
      const pool = (
        await T.admin.post('/v1/loaner-pools', {
          name: `${label} pool ${randomUUID().slice(0, 8)}`,
          home_location_id: location.id,
        })
      ).body;
      const loanerAsset = (await T.admin.post('/v1/assets', { category_id: category.id })).body;
      const member = await T.admin.post(`/v1/loaner-pools/${pool.id}/members`, {
        asset_id: loanerAsset.id,
      });
      expect(member.status, member.raw).toBe(201);
      const loan = await T.admin.post(
        `/v1/loaner-pools/${pool.id}/checkout`,
        { person_id: person.id, asset_id: loanerAsset.id },
        keyed(),
      );
      expect(loan.status, loan.raw).toBeLessThan(300);
      const userId = (await T.admin.get('/v1/auth/me')).body.user.id as string;
      return {
        personId: person.id,
        assetId: asset.id,
        poolId: pool.id,
        loanerAssetId: loanerAsset.id,
        loanId: loan.body.assignment.id as string,
        userId,
      };
    }

    beforeAll(async () => {
      ({ app } = await startRegistryApp());
      A = await createTenant(app, tenancy, 'lna');
      B = await createTenant(app, tenancy, 'lnb');
      const a = await world(A, 'A');
      const b = await world(B, 'B');
      // a loan alert (written by the daily loan.alerts job in production)
      const alertId = randomUUID();
      await ownerTenantSql(
        A.tenantId,
        `insert into app.loan_alert (id, tenant_id, assignment_id, kind, alert_date, expected_return)
       values ($1, $2, $3, 'due_soon', current_date, current_date + 1)`,
        [alertId, A.tenantId, a.loanId],
      );
      const repair = await A.admin.post('/v1/repairs', { asset_id: a.assetId, title: 'A repair' });
      expect(repair.status, repair.raw).toBe(201);
      const imp = await A.admin.post('/v1/imports', { entity_type: 'asset' });
      expect(imp.status, imp.raw).toBe(201);
      fx = {
        a: { ...a, alertId, repairId: repair.body.id, importId: imp.body.id },
        b,
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

    it('each tenant sees its own loaner rows and loans, never the other tenant', async () => {
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
      // loans are assignments with a loaner pool
      expect(
        await asTenant(B.tenantId, `select id from app.assignment where id = $1`, [fx.a.loanId]),
      ).toEqual([]);
      expect(
        await asTenant(B.tenantId, `select 1 from app.assignment where loaner_pool_id = $1`, [
          fx.a.poolId,
        ]),
      ).toEqual([]);
      // and through the API
      const loans = await B.admin.get(
        '/v1/loans?limit=200&state=on_loan,due_today,overdue,returned',
      );
      expect(loans.status).toBe(200);
      expect(loans.raw).not.toContain(fx.a.loanId);
      expect((await B.admin.get(`/v1/loans/${fx.a.loanId}`)).status).toBe(404);
      const own = await A.admin.get('/v1/loans?limit=200');
      expect(own.raw).toContain(fx.a.loanId);
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
            c.query(`insert into app.loaner_pool (id, tenant_id, name) values ($1, $2, 'x')`, [
              randomUUID(),
              A.tenantId,
            ]),
          ),
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

    it('B cannot write rows for A: WITH CHECK refuses a foreign tenant_id (42501)', async () => {
      expect(
        await insertAs(
          B.tenantId,
          `insert into app.loaner_pool (id, tenant_id, name) values ($1, $2, 'x')`,
          [randomUUID(), A.tenantId],
        ),
      ).toBe('42501');
      expect(
        await insertAs(
          B.tenantId,
          `insert into app.loaner_pool_member (tenant_id, asset_id, loaner_pool_id) values ($1, $2, $3)`,
          [A.tenantId, fx.a.assetId, fx.a.poolId],
        ),
      ).toBe('42501');
      expect(
        await insertAs(
          B.tenantId,
          `insert into app.loan_alert (id, tenant_id, assignment_id, kind, alert_date, expected_return)
         values ($1, $2, $3, 'overdue', current_date, current_date - 1)`,
          [randomUUID(), A.tenantId, fx.a.loanId],
        ),
      ).toBe('42501');
      const changed = await asTenant(
        B.tenantId,
        `update app.loaner_pool set name = 'pwned' where id = $1 returning id`,
        [fx.a.poolId],
      );
      expect(changed).toEqual([]);
    });

    it("an assignment, a loan, a repair, an import row, a pool membership and an attachment pointing at A's records are refused (23503)", async () => {
      const refusals: Record<string, [string, unknown[]]> = {
        // B's asset handed to A's person
        'assignment -> person of A': [
          `insert into app.assignment (id, tenant_id, asset_id, person_id) values ($1, $2, $3, $4)`,
          [randomUUID(), B.tenantId, fx.b.assetId, fx.a.personId],
        ],
        // A's asset checked out under B
        'assignment -> asset of A': [
          `insert into app.assignment (id, tenant_id, asset_id, person_id) values ($1, $2, $3, $4)`,
          [randomUUID(), B.tenantId, fx.a.assetId, fx.b.personId],
        ],
        // a loan of B's device, booked on A's pool
        'loan -> pool of A': [
          `insert into app.assignment (id, tenant_id, asset_id, person_id, loaner_pool_id, expected_return) values ($1, $2, $3, $4, $5, current_date + 1)`,
          [randomUUID(), B.tenantId, fx.b.assetId, fx.b.personId, fx.a.poolId],
        ],
        'loan alert -> loan of A': [
          `insert into app.loan_alert (id, tenant_id, assignment_id, kind, alert_date, expected_return)
         values ($1, $2, $3, 'overdue', current_date, current_date - 1)`,
          [randomUUID(), B.tenantId, fx.a.loanId],
        ],
        'repair -> asset of A': [
          `insert into app.maintenance_record (id, tenant_id, asset_id, title) values ($1, $2, $3, 'x')`,
          [randomUUID(), B.tenantId, fx.a.assetId],
        ],
        'import row -> import of A': [
          `insert into app.import_row (tenant_id, job_id, row_no, line_no, raw) values ($1, $2, 1, 2, '[]'::jsonb)`,
          [B.tenantId, fx.a.importId],
        ],
        'import -> user of A': [
          `insert into app.import_job (id, tenant_id, requested_by, source, entity_type) values ($1, $2, $3, 'csv', 'asset')`,
          [randomUUID(), B.tenantId, fx.a.userId],
        ],
        'pool membership -> asset of A': [
          `insert into app.loaner_pool_member (tenant_id, asset_id, loaner_pool_id) values ($1, $2, $3)`,
          [B.tenantId, fx.a.assetId, fx.b.poolId],
        ],
        'pool membership -> pool of A': [
          `insert into app.loaner_pool_member (tenant_id, asset_id, loaner_pool_id) values ($1, $2, $3)`,
          [B.tenantId, fx.b.assetId, fx.a.poolId],
        ],
        'pool -> owner user of A': [
          `insert into app.loaner_pool (id, tenant_id, name, owner_user_id) values ($1, $2, 'x', $3)`,
          [randomUUID(), B.tenantId, fx.a.userId],
        ],
      };
      // the attachment owner is polymorphic (no foreign key): the 0170 guard refuses an owner of A
      for (const [type, id] of [
        ['asset', fx.a.assetId],
        ['person', fx.a.personId],
        ['assignment', fx.a.loanId],
        ['maintenance_record', fx.a.repairId],
        ['import_job', fx.a.importId],
      ] as const) {
        const attId = randomUUID();
        refusals[`attachment -> ${type} of A`] = [
          `insert into app.attachment (id, tenant_id, entity_type, entity_id, storage_key, filename, content_type, size_bytes)
         values ($1, $2, $3, $4, $5, 'x.csv', 'text/csv', 1)`,
          [attId, B.tenantId, type, id, newObjectKey(B.tenantId, { objectId: attId })],
        ];
      }
      for (const [name, [sql, params]] of Object.entries(refusals)) {
        expect(await insertAs(B.tenantId, sql, params), name).toBe('23503');
      }
      // the positive control: the same statements with B's own records are accepted
      const okAtt = randomUUID();
      expect(
        await insertAs(
          B.tenantId,
          `insert into app.attachment (id, tenant_id, entity_type, entity_id, storage_key, filename, content_type, size_bytes)
         values ($1, $2, 'asset', $3, $4, 'x.csv', 'text/csv', 1)`,
          [okAtt, B.tenantId, fx.b.assetId, newObjectKey(B.tenantId, { objectId: okAtt })],
        ),
      ).toBeUndefined();
      expect(
        await insertAs(
          B.tenantId,
          `insert into app.maintenance_record (id, tenant_id, asset_id, title) values ($1, $2, $3, 'x')`,
          [randomUUID(), B.tenantId, fx.b.assetId],
        ),
      ).toBeUndefined();
    });

    it('the attachment owner guard binds the owner role and a BYPASSRLS superuser too, and moving an attachment to A is refused', async () => {
      const attId = randomUUID();
      const insert = `insert into app.attachment (id, tenant_id, entity_type, entity_id, storage_key, filename, content_type, size_bytes)
                    values ($1, $2, 'asset', $3, $4, 'x.csv', 'text/csv', 1)`;
      const params = [
        attId,
        B.tenantId,
        fx.a.assetId,
        newObjectKey(B.tenantId, { objectId: attId }),
      ];
      // the owner (FORCE RLS, B's context)
      expect(await sqlState(ownerTenantSql(B.tenantId, insert, params))).toBe('23503');
      // a superuser sees every tenant's rows: the guard compares tenant ids, not just visibility
      if (env.adminUrl) {
        expect(await sqlState(withClient(env.adminUrl, (c) => c.query(insert, params)))).toBe(
          '23503',
        );
      }
      // B's own attachment cannot be re-pointed at A's asset
      const own = randomUUID();
      await ownerTenantSql(
        B.tenantId,
        `insert into app.attachment (id, tenant_id, entity_type, entity_id, storage_key, filename, content_type, size_bytes)
       values ($1, $2, 'asset', $3, $4, 'x.csv', 'text/csv', 1)`,
        [own, B.tenantId, fx.b.assetId, newObjectKey(B.tenantId, { objectId: own })],
      );
      expect(
        await sqlState(
          ownerTenantSql(B.tenantId, `update app.attachment set entity_id = $2 where id = $1`, [
            own,
            fx.a.assetId,
          ]),
        ),
      ).toBe('23503');
      // an unknown owner type is still the CHECK constraint's error (the guard leaves it alone)
      expect(
        await sqlState(
          ownerTenantSql(
            B.tenantId,
            `update app.attachment set entity_type = 'user_account' where id = $1`,
            [own],
          ),
        ),
      ).toBe('23514');
    });

    it('the schema lint is clean', async () => {
      await withClient(env.migratorUrl!, async (c) => {
        expect(await schemaLintViolations(c)).toEqual([]);
      });
    });
  },
);
