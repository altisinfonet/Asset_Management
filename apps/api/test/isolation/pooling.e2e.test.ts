import 'reflect-metadata';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
} from '../support/db.js';

/**
 * Connection-reuse behaviour (M1-TEN-05). These cases are only meaningful when the next borrower of
 * a connection can be a different client, so in pooled mode they run through the `app_one`
 * (pool_size=1) alias: every client then shares ONE server connection, deterministically.
 *
 * In pooled mode the NEGATIVE CONTROL must observe a real leak from a deliberate session-level SET;
 * that test passes only if the leak is seen, so a green run proves the harness can fail, and it
 * fails the build if pooling is accidentally bypassed.
 */
describe.skipIf(!dbEnabled)(`connection reuse and pooling (${mode})`, () => {
  const tenancy = newTenancy();
  /** One shared server connection when pooled; plain direct connections otherwise. */
  const reuseUrl = (mode === 'pooled' ? env.pooledOneUrl : undefined) ?? env.databaseUrl!;
  let A: FixtureTenant;

  beforeAll(async () => {
    if (mode === 'pooled') {
      expect(
        env.pooledOneUrl,
        'ISOLATION_MODE=pooled needs POOLED_ONE_URL (the pool_size=1 alias used by the negative control)',
      ).toBeTruthy();
    }
    A = await createFixtureTenant(tenancy, 'P');
  });

  afterAll(async () => {
    await tenancy.onModuleDestroy();
  });

  it('b3. after a tenant transaction the GUC reads empty-string, and the policy returns 0 rows without error 22P02', async () => {
    const c1 = await connect(reuseUrl);
    try {
      await rawTenantTx(c1, A.id, async () => {
        expect((await c1.query('select count(*)::int as n from app.asset')).rows[0].n).toBe(
          FIXTURE_ASSETS,
        );
      });
      // Same connection (direct) or the same shared server connection (pooled, pool_size=1).
      const guc = (await c1.query("select current_setting('app.tenant_id', true) as g")).rows[0].g;
      expect(guc).toBe(''); // defined-but-empty on a connection that served a tenant tx (spike F1)
      // The NULLIF policy form turns '' into NULL: zero rows, no 22P02.
      expect((await c1.query('select count(*)::int as n from app.asset')).rows[0].n).toBe(0);
      expect((await c1.query('select count(*)::int as n from app.tenant')).rows[0].n).toBe(0);
      // For contrast, the bare cast the policy must NOT use:
      await expect(c1.query("select ''::uuid")).rejects.toMatchObject({ code: '22P02' });
    } finally {
      await c1.end();
    }
  });

  it('a transaction that fails mid-way leaves the next borrower with no tenant', async () => {
    const c1 = await connect(reuseUrl);
    const c2 = await connect(reuseUrl);
    try {
      await c1.query('BEGIN');
      await c1.query("select set_config('app.tenant_id', $1, true)", [A.id]);
      expect((await c1.query('select count(*)::int as n from app.asset')).rows[0].n).toBe(
        FIXTURE_ASSETS,
      );
      await expect(c1.query('select 1/0')).rejects.toMatchObject({ code: '22012' });
      await c1.query('ROLLBACK');

      const next = await c2.query(
        "select current_setting('app.tenant_id', true) as g, (select count(*)::int from app.asset) as n",
      );
      expect([null, '']).toContain(next.rows[0].g);
      expect(next.rows[0].n).toBe(0);
    } finally {
      await c1.end();
      await c2.end();
    }
  });

  it('80 autocommit queries outside any transaction never see a tenant, even while tenant transactions run', async () => {
    const pool = new pg.Pool({ connectionString: env.databaseUrl!, max: 8 });
    let stop = false;
    const background = (async () => {
      while (!stop) {
        await tenancy.withTenantTx({ tenantId: A.id }, async (trx) => {
          await sleep(5);
          await trx.selectFrom('app.asset').select('id').execute();
        });
      }
    })();
    try {
      const seen = await Promise.all(
        Array.from({ length: 80 }, async () => {
          const { rows } = await pool.query(
            "select current_setting('app.tenant_id', true) as g, (select count(*)::int from app.asset) as n",
          );
          return rows[0] as { g: string | null; n: number };
        }),
      );
      expect(seen.filter((r) => r.g !== null && r.g !== '')).toEqual([]);
      expect(seen.filter((r) => r.n !== 0)).toEqual([]);
    } finally {
      stop = true;
      await background;
      await pool.end();
    }
  });

  it('named prepared statements survive pooling (max_prepared_statements=100)', async () => {
    const pool = new pg.Pool({ connectionString: env.databaseUrl!, max: 6 });
    try {
      const results = await Promise.all(
        Array.from({ length: 30 }, async () => {
          const c = await pool.connect();
          try {
            await c.query('BEGIN');
            await c.query("select set_config('app.tenant_id', $1, true)", [A.id]);
            const r = await c.query({
              name: 'iso_count_assets',
              text: 'select count(*)::int as n from app.asset where asset_tag like $1',
              values: ['ISO-%'],
            });
            await c.query('COMMIT');
            return r.rows[0].n as number;
          } finally {
            c.release();
          }
        }),
      );
      expect(new Set(results)).toEqual(new Set([FIXTURE_ASSETS]));
    } finally {
      await pool.end();
    }
  });

  if (mode === 'pooled') {
    it('NEGATIVE CONTROL: a session-level SET through the pool_size=1 alias leaks to another client (the harness can see a leak)', async () => {
      const c1 = await connect(env.pooledOneUrl!);
      const c2 = await connect(env.pooledOneUrl!);
      try {
        // Deliberately forbidden: session-level SET (the grep test excludes test/ for exactly this).
        await c1.query(`SET app.tenant_id = '${A.id}'`);
        const pid1 = (await c1.query('select pg_backend_pid() as pid')).rows[0].pid;

        // A DIFFERENT client that never set a tenant:
        const seen = (
          await c2.query(
            "select pg_backend_pid() as pid, current_setting('app.tenant_id', true) as g, (select count(*)::int from app.asset) as n",
          )
        ).rows[0];
        const leaked = seen.g === A.id && seen.n === FIXTURE_ASSETS && seen.pid === pid1;
        expect(
          leaked,
          `expected the session SET to leak across pooled clients, saw ${JSON.stringify(seen)} (is pooling bypassed?)`,
        ).toBe(true);
      } finally {
        // Clean the shared server connection so later tests (and other suites) start clean.
        await c2.query('RESET app.tenant_id').catch(() => undefined);
        await c1.end();
        await c2.end();
      }
      const after = await connect(env.pooledOneUrl!);
      try {
        const g = (await after.query("select current_setting('app.tenant_id', true) as g")).rows[0]
          .g;
        expect([null, '']).toContain(g);
      } finally {
        await after.end();
      }
    });
  } else {
    it('control of the control (direct): a session SET stays on its own connection, so the leak test is meaningful', async () => {
      const c1 = await connect(env.databaseUrl!);
      const c2 = await connect(env.databaseUrl!);
      try {
        await c1.query(`SET app.tenant_id = '${A.id}'`);
        const g = (await c2.query("select current_setting('app.tenant_id', true) as g")).rows[0].g;
        expect(g).not.toBe(A.id);
      } finally {
        await c1.end();
        await c2.end();
      }
    });
  }
});
