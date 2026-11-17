import 'reflect-metadata';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { uuidv7 } from '../../src/ids/uuidv7.js';
import {
  NoTenantTransactionError,
  sql,
  TenantRepository,
  type Tx,
} from '../../src/tenancy/index.js';
import {
  connect,
  createFixtureTenant,
  dbEnabled,
  env,
  FIXTURE_ASSETS,
  type FixtureTenant,
  mode,
  newTenancy,
  rawTenantTx,
  sleep,
  sqlState,
  withClient,
} from '../support/db.js';

/**
 * Two-tenant isolation harness (M1-TEN-04 / M1-TEN-05). Ports the spike tests a, b, c, e, f, g, h
 * (docs/validation/spike_rls_pgbouncer.md). The SAME suite runs twice in CI and locally:
 *   ISOLATION_MODE=direct   DATABASE_URL -> Postgres
 *   ISOLATION_MODE=pooled   DATABASE_URL -> PgBouncer 1.26.1+ (transaction mode, max_prepared_statements=100)
 * The pooled-only tests (negative control, ...) live in pooling.e2e.test.ts.
 */
describe.skipIf(!dbEnabled)(`tenant isolation (${mode})`, () => {
  const tenancy = newTenancy();
  const owner = newTenancy(env.migratorUrl!, 2);
  let A: FixtureTenant;
  let B: FixtureTenant;

  beforeAll(async () => {
    A = await createFixtureTenant(tenancy, 'A');
    B = await createFixtureTenant(tenancy, 'B');
    // Test-only objects live in their own schema so app.schema_lint() never sees them.
    await withClient(env.migratorUrl!, async (c) => {
      await c.query(`
        drop schema if exists isolation_test cascade;
        create schema isolation_test;
        grant usage on schema isolation_test to app_user;
        create view isolation_test.asset_v_invoker with (security_invoker = true) as
          select id, tenant_id, asset_tag from app.asset;
        create view isolation_test.asset_v_definer as
          select id, tenant_id, asset_tag from app.asset;
        grant select on isolation_test.asset_v_invoker, isolation_test.asset_v_definer to app_user;
        -- a table WITHOUT force: the owner (and so a default view) bypasses RLS on it
        create table isolation_test.noforce (id uuid primary key, tenant_id uuid not null, v text);
        alter table isolation_test.noforce enable row level security;
        create policy tenant_isolation on isolation_test.noforce
          using (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid))
          with check (tenant_id = (select nullif(current_setting('app.tenant_id', true), '')::uuid));
        create view isolation_test.noforce_v_definer as select id, tenant_id, v from isolation_test.noforce;
        create view isolation_test.noforce_v_invoker with (security_invoker = true) as
          select id, tenant_id, v from isolation_test.noforce;
        grant select on isolation_test.noforce, isolation_test.noforce_v_definer,
                        isolation_test.noforce_v_invoker to app_user;`);
      for (const t of [A, B]) {
        await c.query('insert into isolation_test.noforce values ($1, $2, $3), ($4, $2, $3)', [
          uuidv7(),
          t.id,
          t.slug,
          uuidv7(),
        ]);
      }
    });
  });

  afterAll(async () => {
    await withClient(env.migratorUrl!, (c) =>
      c.query('drop schema if exists isolation_test cascade'),
    );
    await tenancy.onModuleDestroy();
    await owner.onModuleDestroy();
  });

  it('a. tenant A sees only A and tenant B only B (overlapping tags and serials coexist)', async () => {
    expect(A.assetTags).toEqual(B.assetTags); // identical data in both tenants on purpose
    for (const [t, other] of [
      [A, B],
      [B, A],
    ] as const) {
      await tenancy.withTenantTx({ tenantId: t.id }, async (trx) => {
        const assets = await trx
          .selectFrom('app.asset')
          .select(['id', 'tenant_id', 'asset_tag'])
          .execute();
        expect(assets).toHaveLength(FIXTURE_ASSETS);
        expect(new Set(assets.map((a) => a.tenant_id))).toEqual(new Set([t.id]));
        expect(assets.map((a) => a.id).sort()).toEqual([...t.assetIds].sort());
        expect(assets.some((a) => other.assetIds.includes(a.id))).toBe(false);

        for (const table of [
          'app.category',
          'app.status_label',
          'app.role',
          'app.company',
          'app.audit_log',
          'app.outbox_event',
        ] as const) {
          const rows = await trx.selectFrom(table).select('tenant_id').execute();
          expect(rows.length, table).toBeGreaterThan(0);
          expect(new Set(rows.map((r) => r.tenant_id)), table).toEqual(new Set([t.id]));
        }
        // app.tenant is keyed by id: a tenant sees exactly its own registry row.
        const tenants = await trx.selectFrom('app.tenant').select('id').execute();
        expect(tenants.map((r) => r.id)).toEqual([t.id]);
        // Direct lookups by a foreign id come back empty, not forbidden (no existence oracle).
        const foreign = await trx
          .selectFrom('app.asset')
          .select('id')
          .where('id', '=', other.assetIds[0]!)
          .execute();
        expect(foreign).toEqual([]);
      });
    }
  });

  it('b. unset tenant context returns 0 rows and inserts fail with 42501 (fail closed)', async () => {
    await withClient(env.databaseUrl!, async (c) => {
      expect((await c.query('select count(*)::int as n from app.asset')).rows[0].n).toBe(0);
      expect((await c.query('select count(*)::int as n from app.tenant')).rows[0].n).toBe(0);
      const code = await sqlState(
        c.query(`insert into app.category (id, tenant_id, name) values ($1, $2, 'orphan')`, [
          uuidv7(),
          A.id,
        ]),
      );
      expect(code).toBe('42501');
    });
  });

  it('c. 600 interleaved concurrent transactions across two tenants: zero cross-tenant reads, no GUC outside a transaction', async () => {
    const TOTAL = 600;
    let completed = 0;
    let violations = 0;
    let wrongGuc = 0;
    let intendedFailures = 0;
    let next = 0;

    const one = async (i: number) => {
      const mine = Math.random() < 0.5 ? A : B;
      const other = mine === A ? B : A;
      try {
        await tenancy.withTenantTx({ tenantId: mine.id }, async (trx) => {
          await sleep(Math.floor(Math.random() * 12));
          const guc = (
            await sql<{ g: string }>`select current_setting('app.tenant_id', true) as g`.execute(
              trx,
            )
          ).rows[0]!.g;
          if (guc !== mine.id) wrongGuc++;
          await sleep(Math.floor(Math.random() * 12));
          const rows = await trx.selectFrom('app.asset').select('tenant_id').execute();
          if (rows.length !== FIXTURE_ASSETS || rows.some((r) => r.tenant_id !== mine.id))
            violations++;
          if (i % 17 === 0) {
            // Deliberate WITH CHECK failure: the whole transaction must roll back.
            await trx
              .insertInto('app.category')
              .values({ id: uuidv7(), tenant_id: other.id, name: `leak-${i}` })
              .execute();
          }
        });
        completed++;
      } catch (err) {
        if (i % 17 === 0 && (err as { code?: string }).code === '42501') intendedFailures++;
        else throw err;
      }
    };
    const worker = async () => {
      while (next < TOTAL) await one(next++);
    };
    await Promise.all(Array.from({ length: 12 }, worker));

    expect(violations).toBe(0);
    expect(wrongGuc).toBe(0);
    expect(completed + intendedFailures).toBe(TOTAL);
    expect(intendedFailures).toBe(Math.floor((TOTAL - 1) / 17) + 1);

    // Nothing leaked outside a transaction, and the rolled-back inserts left no rows behind.
    await withClient(env.databaseUrl!, async (c) => {
      const { rows } = await c.query("select current_setting('app.tenant_id', true) as g");
      expect([null, '']).toContain(rows[0].g);
    });
    await tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
      expect(
        await trx.selectFrom('app.category').select('id').where('name', 'like', 'leak-%').execute(),
      ).toEqual([]);
    });
  });

  it('e. WITH CHECK blocks writing a foreign tenant_id; updates and deletes cannot touch the other tenant', async () => {
    // Insert for tenant B while acting as tenant A.
    const insertCode = await sqlState(
      tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
        trx
          .insertInto('app.asset')
          .values({
            id: uuidv7(),
            tenant_id: B.id,
            company_id: A.companyId,
            asset_tag: 'FOREIGN-1',
            category_id: A.categoryId,
            status_id: A.statusId,
          })
          .execute(),
      ),
    );
    expect(insertCode).toBe('42501');

    // Moving an own row to tenant B is also blocked by WITH CHECK.
    const moveCode = await sqlState(
      tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
        trx
          .updateTable('app.asset')
          .set({ tenant_id: B.id })
          .where('id', '=', A.assetIds[0]!)
          .execute(),
      ),
    );
    expect(moveCode).toBe('42501');

    // Targeting B's rows from A matches nothing.
    await tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
      const upd = await trx
        .updateTable('app.asset')
        .set({ name: 'hijacked' })
        .where('id', 'in', B.assetIds)
        .executeTakeFirst();
      expect(upd.numUpdatedRows).toBe(0n);
      const del = await trx
        .deleteFrom('app.outbox_event')
        .where('aggregate_id', '=', B.assetIds[0]!)
        .executeTakeFirst();
      expect(del.numDeletedRows).toBe(0n);
    });
    await tenancy.withTenantTx({ tenantId: B.id }, async (trx) => {
      const names = await trx.selectFrom('app.asset').select('name').execute();
      expect(names.some((r) => r.name === 'hijacked')).toBe(false);
      expect(await trx.selectFrom('app.outbox_event').select('id').execute()).toHaveLength(1);
    });
  });

  it('e2. composite foreign keys stop a row in tenant A from referencing tenant B (FK checks bypass RLS)', async () => {
    const code = await sqlState(
      tenancy.withTenantTx({ tenantId: A.id }, (trx) =>
        trx
          .insertInto('app.asset')
          .values({
            id: uuidv7(),
            tenant_id: A.id,
            company_id: A.companyId,
            asset_tag: 'CROSS-FK',
            category_id: B.categoryId, // B's category, A's tenant_id
            status_id: A.statusId,
          })
          .execute(),
      ),
    );
    expect(code).toBe('23503');
  });

  it('f. security_invoker views respect RLS; a default view only bypasses on a table WITHOUT force', async () => {
    const counts = async (tenantId: string, view: string) =>
      tenancy.withTenantTx({ tenantId }, async (trx) => {
        const { rows } = await sql<{ n: number; t: number }>`
          select count(*)::int as n, count(distinct tenant_id)::int as t from ${sql.table(view)}`.execute(
          trx,
        );
        return rows[0]!;
      });

    expect(await counts(A.id, 'isolation_test.asset_v_invoker')).toEqual({
      n: FIXTURE_ASSETS,
      t: 1,
    });
    // FORCE RLS binds the view owner too, so even a default (definer) view over a FORCE table is safe.
    expect(await counts(A.id, 'isolation_test.asset_v_definer')).toEqual({
      n: FIXTURE_ASSETS,
      t: 1,
    });
    expect(await counts(A.id, 'isolation_test.noforce_v_invoker')).toEqual({ n: 2, t: 1 });
    // The hazard the lint exists for: owner-rights view over a table without FORCE bypasses RLS.
    const leak = await counts(A.id, 'isolation_test.noforce_v_definer');
    expect(leak.t).toBeGreaterThan(1);
  });

  it('h. the owner role is bound by FORCE: no tenant sees 0 rows, a tenant context sees only its own', async () => {
    await withClient(env.migratorUrl!, async (c) => {
      expect((await c.query('select count(*)::int as n from app.asset')).rows[0].n).toBe(0);
      expect(
        (await c.query('select count(*)::int as n from isolation_test.noforce')).rows[0].n,
      ).toBeGreaterThanOrEqual(4); // control: without FORCE the owner sees everything
    });
    await owner.withTenantTx({ tenantId: A.id }, async (trx) => {
      const rows = await trx.selectFrom('app.asset').select('tenant_id').execute();
      expect(rows).toHaveLength(FIXTURE_ASSETS);
      expect(new Set(rows.map((r) => r.tenant_id))).toEqual(new Set([A.id]));
    });
  });

  it('g. direct access to a partition is denied (42501); the parent still selects and routes inserts', async () => {
    const partitions = await withClient(env.migratorUrl!, async (c) => {
      const { rows } = await c.query(`
        select c.relname, c.relrowsecurity, c.relforcerowsecurity, c.relacl::text as acl
          from pg_inherits i join pg_class c on c.oid = i.inhrelid
         where i.inhparent = 'app.audit_log'::regclass order by c.relname`);
      return rows as Array<{
        relname: string;
        relrowsecurity: boolean;
        relforcerowsecurity: boolean;
        acl: string | null;
      }>;
    });
    expect(partitions.length).toBeGreaterThanOrEqual(13); // 12 months + default
    expect(partitions.some((p) => p.relname === 'audit_log_default')).toBe(true);
    for (const p of partitions) {
      expect(p.relrowsecurity && p.relforcerowsecurity, `${p.relname} FORCE RLS`).toBe(true);
      expect(p.acl ?? '', `${p.relname} has no grants beyond the owner`).not.toMatch(/app_user/);
    }

    await withClient(env.databaseUrl!, async (c) => {
      for (const p of [
        partitions[0]!,
        partitions.find((x) => x.relname === 'audit_log_default')!,
      ]) {
        await rawTenantTx(c, A.id, async () => {
          expect(await sqlState(c.query(`select count(*) from app.${p.relname}`))).toBe('42501');
        }).catch(() => undefined); // the failed statement aborts the transaction: expected
      }
      // Through the parent: select and insert routing work for the tenant.
      const id = uuidv7();
      await rawTenantTx(c, A.id, async () => {
        await c.query(
          `insert into app.audit_log (id, tenant_id, actor_type, action, entity_type) values ($1, $2, 'system', 'partition.test', 'asset')`,
          [id, A.id],
        );
      });
      const viaParent = await rawTenantTx(c, A.id, () =>
        c.query('select id, tenant_id from app.audit_log where id = $1', [id]),
      );
      expect(viaParent.rows).toHaveLength(1);
      // The tenant sees its own rows only, through the parent.
      const all = await rawTenantTx(c, A.id, () =>
        c.query('select distinct tenant_id from app.audit_log'),
      );
      expect(all.rows.map((r) => r.tenant_id)).toEqual([A.id]);
    });
  });

  it('M1-TEN-02: data, audit row and outbox row roll back together; commit together on success', async () => {
    const assetId = uuidv7();
    const insertAll = async (trx: Tx) => {
      await trx
        .insertInto('app.asset')
        .values({
          id: assetId,
          tenant_id: A.id,
          asset_tag: `ATOMIC-${assetId.slice(-6)}`,
          category_id: A.categoryId,
          status_id: A.statusId,
        })
        .execute();
      await trx
        .insertInto('app.audit_log')
        .values({
          id: uuidv7(),
          tenant_id: A.id,
          actor_type: 'system',
          action: 'asset.create',
          entity_type: 'asset',
          entity_id: assetId,
        })
        .execute();
      await trx
        .insertInto('app.outbox_event')
        .values({
          id: uuidv7(),
          tenant_id: A.id,
          event_type: 'asset.created',
          aggregate_type: 'asset',
          aggregate_id: assetId,
        })
        .execute();
    };
    const counts = () =>
      tenancy.withTenantTx({ tenantId: A.id }, async (trx) => ({
        asset: (await trx.selectFrom('app.asset').select('id').where('id', '=', assetId).execute())
          .length,
        audit: (
          await trx
            .selectFrom('app.audit_log')
            .select('id')
            .where('entity_id', '=', assetId)
            .execute()
        ).length,
        outbox: (
          await trx
            .selectFrom('app.outbox_event')
            .select('id')
            .where('aggregate_id', '=', assetId)
            .execute()
        ).length,
      }));

    await expect(
      tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
        await insertAll(trx);
        throw new Error('forced failure after the audit and outbox inserts');
      }),
    ).rejects.toThrow(/forced failure/);
    expect(await counts()).toEqual({ asset: 0, audit: 0, outbox: 0 });

    await tenancy.withTenantTx({ tenantId: A.id }, insertAll);
    expect(await counts()).toEqual({ asset: 1, audit: 1, outbox: 1 });
  });

  it('M1-TEN-02: TenantRepository works inside withTenantTx only', async () => {
    class AssetRepository extends TenantRepository {
      byTag(tag: string) {
        return this.db
          .selectFrom('app.asset')
          .select(['id', 'tenant_id'])
          .where('asset_tag', '=', tag)
          .execute();
      }
      tenant() {
        return this.context.tenantId;
      }
    }
    const repo = new AssetRepository();
    expect(() => repo.byTag('ISO-001')).toThrow(NoTenantTransactionError);
    const inA = await tenancy.withTenantTx({ tenantId: A.id }, async () => ({
      rows: await repo.byTag('ISO-001'),
      tenant: repo.tenant(),
    }));
    expect(inA.tenant).toBe(A.id);
    expect(inA.rows).toEqual([{ id: A.assetIds[0], tenant_id: A.id }]);
    const inB = await tenancy.withTenantTx({ tenantId: B.id }, () => repo.byTag('ISO-001'));
    expect(inB).toEqual([{ id: B.assetIds[0], tenant_id: B.id }]);
    expect(() => repo.byTag('ISO-001')).toThrow(NoTenantTransactionError);
  });

  it('i. a connection that served a tenant transaction returns 0 rows (not 22P02) afterwards', async () => {
    // One physical connection (direct, or one pooled client): tenant tx, then autocommit reads.
    const c = await connect(env.databaseUrl!);
    try {
      await rawTenantTx(c, A.id, async () => {
        // >= : the atomicity test above adds one more asset to tenant A
        expect(
          (await c.query('select count(*)::int as n from app.asset')).rows[0].n,
        ).toBeGreaterThanOrEqual(FIXTURE_ASSETS);
      });
      for (let i = 0; i < 5; i++) {
        const after = await c.query('select count(*)::int as n from app.asset');
        expect(after.rows[0].n).toBe(0);
      }
    } finally {
      await c.end();
    }
  });
});
