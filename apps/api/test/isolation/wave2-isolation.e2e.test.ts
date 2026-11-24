import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbEnabled } from '../auth/support.js';
import {
  env,
  mode,
  rawTenantTx,
  schemaLintViolations,
  sqlState,
  withClient,
} from '../support/db.js';
import { NOTIFIER, type Notifier } from '../../src/ports/index.js';
import { TenancyService } from '../../src/tenancy/index.js';
import {
  type App,
  type TenantFixture,
  basics,
  createTenant,
  newAsset,
  newTenancy,
  startRegistryApp,
} from '../lifecycle/support.js';

/**
 * M2-SEC-01 for the wave-2 tables (maintenance_record, notification, notification_preference,
 * notification_rule, notification_delivery, saved_view, export_job): the same two-tenant checks as the
 * M1 and wave-1 isolation suites, direct and through PgBouncer (this file runs in whichever mode the
 * e2e suite runs). Tenant A owns rows in every table; tenant B must see none of them, write none of
 * them, and not even reference them from its own rows. Notifications are invisible across tenants.
 */
describe.skipIf(!dbEnabled)(
  `tenant isolation of repairs, notifications, views and exports (${mode})`,
  () => {
    const tenancy = newTenancy();
    let app: App;
    let A: TenantFixture;
    let B: TenantFixture;
    let fx: {
      assetId: string;
      bAssetId: string;
      adminId: string;
      bAdminId: string;
      repairId: string;
      notificationId: string;
      vendorId: string;
      statusId: string;
    };

    const TABLES = [
      'maintenance_record',
      'notification',
      'notification_preference',
      'notification_rule',
      'notification_delivery',
      'saved_view',
      'export_job',
    ] as const;

    beforeAll(async () => {
      ({ app } = await startRegistryApp());
      A = await createTenant(app, tenancy, 'w2isoa');
      B = await createTenant(app, tenancy, 'w2isob');
      const basicsA = await basics(A);
      const basicsB = await basics(B);
      const asset = await newAsset(A.admin, basicsA.categoryId);
      const bAsset = await newAsset(B.admin, basicsB.categoryId);
      const vendor = (await A.admin.post('/v1/vendors', { name: 'Isolated vendor' })).body;
      const repair = await A.admin.post('/v1/repairs', {
        asset_id: asset.id,
        title: 'Isolated repair',
        vendor_id: vendor.id,
        set_status_id: basicsA.status['In repair'],
      });
      expect(repair.status, repair.raw).toBe(201);
      const adminId = (await A.admin.get('/v1/auth/me')).body.user.id as string;
      const bAdminId = (await B.admin.get('/v1/auth/me')).body.user.id as string;
      // a notification and its delivery rows, a preference and a rule
      const runtime = app.get(TenancyService, { strict: false });
      const notifier = app.get<Notifier>(NOTIFIER, { strict: false });
      await runtime.withTenantTx({ tenantId: A.tenantId }, (tx) =>
        notifier.notify(tx, {
          type: 'export.completed',
          recipients: [adminId],
          vars: { filename: 'x.csv', rows: 1 },
          dedupeKey: 'w2-iso',
        }),
      );
      const notifications = await A.admin.get('/v1/notifications');
      await A.admin.put('/v1/notification-preferences/export.completed', { email: 'digest' });
      await A.admin.put('/v1/notification-rules/consumable.low_stock', { enabled: false });
      await A.admin.post('/v1/saved-views', { name: 'Isolated view', filters: { q: 'x' } });
      await A.admin.post('/v1/exports', { resource: 'locations' });
      fx = {
        assetId: asset.id,
        bAssetId: bAsset.id,
        adminId,
        bAdminId,
        repairId: repair.body.id,
        notificationId: notifications.body.data[0].id,
        vendorId: vendor.id,
        statusId: basicsA.status['In repair']!,
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
    const insertAsB = (sql: string, params: unknown[]) =>
      sqlState(
        withClient(env.databaseUrl!, (c) => rawTenantTx(c, B.tenantId, () => c.query(sql, params))),
      );

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
      // direct lookups of A's ids from B come back empty
      expect(
        await asTenant(B.tenantId, `select id from app.maintenance_record where id = $1`, [
          fx.repairId,
        ]),
      ).toEqual([]);
      expect(
        await asTenant(B.tenantId, `select id from app.notification where id = $1`, [
          fx.notificationId,
        ]),
      ).toEqual([]);
      expect(
        await asTenant(B.tenantId, `select id from app.notification where user_id = $1`, [
          fx.adminId,
        ]),
      ).toEqual([]);
    });

    it('notifications and the delivery log are invisible across tenants through the API too', async () => {
      expect((await B.admin.get('/v1/notifications')).body.data).toEqual([]);
      expect((await B.admin.get('/v1/notification-deliveries')).body.data).toEqual([]);
      expect((await B.admin.post(`/v1/notifications/${fx.notificationId}/read`, {})).status).toBe(
        404,
      );
      expect((await A.admin.get('/v1/notifications')).body.data).toHaveLength(1);
      expect((await A.admin.get('/v1/notification-deliveries')).body.data.length).toBeGreaterThan(
        0,
      );
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
              `insert into app.saved_view (id, tenant_id, user_id, resource, name) values ($1, $2, $3, 'assets', 'x')`,
              [randomUUID(), A.tenantId, fx.adminId],
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
        await insertAsB(
          `insert into app.maintenance_record (id, tenant_id, asset_id, title) values ($1, $2, $3, 'x')`,
          [randomUUID(), A.tenantId, fx.assetId],
        ),
      ).toBe('42501');
      expect(
        await insertAsB(
          `insert into app.notification (id, tenant_id, user_id, type, title, dedupe_key) values ($1, $2, $3, 'export.completed', 'x', 'k')`,
          [randomUUID(), A.tenantId, fx.adminId],
        ),
      ).toBe('42501');
      expect(
        await insertAsB(
          `insert into app.notification_preference (id, tenant_id, user_id, type, in_app, email) values ($1, $2, $3, 'export.completed', true, 'off')`,
          [randomUUID(), A.tenantId, fx.adminId],
        ),
      ).toBe('42501');
      expect(
        await insertAsB(
          `insert into app.notification_rule (id, tenant_id, type) values ($1, $2, 'export.completed')`,
          [randomUUID(), A.tenantId],
        ),
      ).toBe('42501');
      expect(
        await insertAsB(
          `insert into app.notification_delivery (id, tenant_id, user_id, type, channel, status) values ($1, $2, $3, 'export.completed', 'email', 'queued')`,
          [randomUUID(), A.tenantId, fx.adminId],
        ),
      ).toBe('42501');
      expect(
        await insertAsB(
          `insert into app.saved_view (id, tenant_id, user_id, resource, name) values ($1, $2, $3, 'assets', 'x')`,
          [randomUUID(), A.tenantId, fx.adminId],
        ),
      ).toBe('42501');
      expect(
        await insertAsB(
          `insert into app.export_job (id, tenant_id, requested_by, resource) values ($1, $2, $3, 'assets')`,
          [randomUUID(), A.tenantId, fx.adminId],
        ),
      ).toBe('42501');
      // updates and deletes of A's rows touch nothing
      const touched = await asTenant<{ id: string }>(
        B.tenantId,
        `update app.maintenance_record set title = 'tampered' where id = $1 returning id`,
        [fx.repairId],
      );
      expect(touched).toEqual([]);
      expect(
        await asTenant(
          B.tenantId,
          `update app.notification set read_at = now() where id = $1 returning id`,
          [fx.notificationId],
        ),
      ).toEqual([]);
    });

    it("B cannot reference A's rows from its own: composite foreign keys (tenant_id, id) refuse it (23503)", async () => {
      // a repair of B's asset naming A's vendor / status, and one on A's asset
      expect(
        await insertAsB(
          `insert into app.maintenance_record (id, tenant_id, asset_id, title, vendor_id) values ($1, $2, $3, 'x', $4)`,
          [randomUUID(), B.tenantId, fx.bAssetId, fx.vendorId],
        ),
      ).toBe('23503');
      expect(
        await insertAsB(
          `insert into app.maintenance_record (id, tenant_id, asset_id, title, set_status_id) values ($1, $2, $3, 'x', $4)`,
          [randomUUID(), B.tenantId, fx.bAssetId, fx.statusId],
        ),
      ).toBe('23503');
      expect(
        await insertAsB(
          `insert into app.maintenance_record (id, tenant_id, asset_id, title) values ($1, $2, $3, 'x')`,
          [randomUUID(), B.tenantId, fx.assetId],
        ),
      ).toBe('23503');
      // a notification, preference, view or export for A's user, in B's tenant
      expect(
        await insertAsB(
          `insert into app.notification (id, tenant_id, user_id, type, title, dedupe_key) values ($1, $2, $3, 'export.completed', 'x', 'k')`,
          [randomUUID(), B.tenantId, fx.adminId],
        ),
      ).toBe('23503');
      expect(
        await insertAsB(
          `insert into app.notification_preference (id, tenant_id, user_id, type, in_app, email) values ($1, $2, $3, 'export.completed', true, 'off')`,
          [randomUUID(), B.tenantId, fx.adminId],
        ),
      ).toBe('23503');
      expect(
        await insertAsB(
          `insert into app.saved_view (id, tenant_id, user_id, resource, name) values ($1, $2, $3, 'assets', 'x')`,
          [randomUUID(), B.tenantId, fx.adminId],
        ),
      ).toBe('23503');
      expect(
        await insertAsB(
          `insert into app.export_job (id, tenant_id, requested_by, resource) values ($1, $2, $3, 'assets')`,
          [randomUUID(), B.tenantId, fx.adminId],
        ),
      ).toBe('23503');
      // a delivery row pointing at A's notification
      expect(
        await insertAsB(
          `insert into app.notification_delivery (id, tenant_id, notification_id, user_id, type, channel, status) values ($1, $2, $3, $4, 'export.completed', 'in_app', 'delivered')`,
          [randomUUID(), B.tenantId, fx.notificationId, fx.bAdminId],
        ),
      ).toBe('23503');
    });

    it('the schema lint is clean with the new tables, and the notification delivery log is append-only', async () => {
      await withClient(env.migratorUrl!, async (c) => {
        expect(await schemaLintViolations(c)).toEqual([]);
        const grants = await c.query(
          `select privilege_type from information_schema.role_table_grants
          where grantee = 'app_user' and table_schema = 'app' and table_name = 'notification_delivery'`,
        );
        expect(grants.rows.map((r) => r.privilege_type).sort()).toEqual(['INSERT', 'SELECT']);
      });
      expect(
        await sqlState(
          withClient(env.databaseUrl!, (c) =>
            rawTenantTx(c, A.tenantId, () =>
              c.query(`update app.notification_delivery set reason = 'tampered'`),
            ),
          ),
        ),
      ).toBe('42501');
    });
  },
);
