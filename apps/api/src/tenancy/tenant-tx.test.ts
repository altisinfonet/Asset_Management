import {
  type CompiledQuery,
  type DatabaseConnection,
  type Driver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  type QueryResult,
  type TransactionSettings,
} from 'kysely';
import { describe, expect, it } from 'vitest';
import type { Database } from './database.js';
import { TenantRepository } from './tenant-repository.js';
import { NoTenantTransactionError, withPreTenantTx, withTenantTx } from './tenant-tx.js';

const TENANT = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f';
const OTHER = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e60';
const ACTOR = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e61';

/** A Kysely instance over a recording fake driver: asserts the exact statement sequence. */
function recordingDb(failOn?: RegExp) {
  const log: Array<{ sql: string; parameters?: readonly unknown[] }> = [];
  let acquired = 0;
  let released = 0;
  const connection: DatabaseConnection = {
    async executeQuery<R>(q: CompiledQuery): Promise<QueryResult<R>> {
      log.push({ sql: q.sql, parameters: q.parameters });
      if (failOn?.test(q.sql)) throw new Error(`boom on ${q.sql}`);
      return { rows: [] };
    },
    // eslint-disable-next-line require-yield
    async *streamQuery() {
      throw new Error('not supported');
    },
  };
  const driver: Driver = {
    async init() {},
    async acquireConnection() {
      acquired++;
      return connection;
    },
    async beginTransaction(_c: DatabaseConnection, _s: TransactionSettings) {
      log.push({ sql: 'BEGIN' });
    },
    async commitTransaction() {
      log.push({ sql: 'COMMIT' });
    },
    async rollbackTransaction() {
      log.push({ sql: 'ROLLBACK' });
    },
    async releaseConnection() {
      released++;
    },
    async destroy() {},
  };
  const db = new Kysely<Database>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (d) => new PostgresIntrospector(d),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  return { db, log, counts: () => ({ acquired, released }) };
}

class ProbeRepository extends TenantRepository {
  tenantFromContext() {
    return this.context.tenantId;
  }
  rows() {
    return this.db.selectFrom('app.asset').select('id').execute();
  }
}

describe('withTenantTx', () => {
  it('sets the tenant context transaction-locally between BEGIN and COMMIT', async () => {
    const { db, log, counts } = recordingDb();
    const result = await withTenantTx(
      db,
      { tenantId: TENANT, actorId: ACTOR, requestId: 'req-1' },
      async (trx) => {
        await trx.selectFrom('app.asset').select('id').execute();
        return 'done';
      },
    );

    expect(result).toBe('done');
    expect(log.map((l) => l.sql.split('\n')[0])).toEqual([
      'BEGIN',
      "select set_config('app.tenant_id', $1, true),",
      'select "id" from "app"."asset"',
      'COMMIT',
    ]);
    // is_local = true is part of the statement text, never a parameter: no session-level SET.
    expect(log[1]?.sql).toContain("set_config('app.actor_id', $2, true)");
    expect(log[1]?.sql).toContain("set_config('app.request_id', $3, true)");
    expect(log[1]?.parameters).toEqual([TENANT, ACTOR, 'req-1']);
    expect(counts()).toEqual({ acquired: 1, released: 1 });
  });

  it('rolls back, releases and rethrows when fn fails', async () => {
    const { db, log, counts } = recordingDb();
    await expect(
      withTenantTx(db, { tenantId: TENANT }, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    expect(log.map((l) => l.sql.split('\n')[0])).toEqual([
      'BEGIN',
      "select set_config('app.tenant_id', $1, true),",
      'ROLLBACK',
    ]);
    expect(counts()).toEqual({ acquired: 1, released: 1 });
  });

  it('rolls back when set_config itself fails', async () => {
    const { db, log } = recordingDb(/set_config/);
    await expect(withTenantTx(db, { tenantId: TENANT }, async () => 1)).rejects.toThrow(/boom/);
    expect(log.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('rejects a non-UUID tenant or actor id without touching the database', async () => {
    const { db, log } = recordingDb();
    await expect(
      withTenantTx(db, { tenantId: "x'; drop table assets;--" }, async () => 1),
    ).rejects.toThrow();
    await expect(
      withTenantTx(db, { tenantId: TENANT, actorId: 'not-a-uuid' }, async () => 1),
    ).rejects.toThrow();
    expect(log).toEqual([]);
  });

  it('joins a nested call for the same tenant and refuses another tenant', async () => {
    const { db, log } = recordingDb();
    await withTenantTx(db, { tenantId: TENANT }, async () => {
      await withTenantTx(db, { tenantId: TENANT }, async () => undefined);
      await expect(withTenantTx(db, { tenantId: OTHER }, async () => undefined)).rejects.toThrow(
        /different tenant/,
      );
    });
    expect(log.filter((l) => l.sql === 'BEGIN')).toHaveLength(1);
  });

  it('withPreTenantTx runs in a transaction and sets no tenant context', async () => {
    const { db, log } = recordingDb();
    await withPreTenantTx(db, async (trx) => {
      await trx.selectFrom('identity.tenant_directory').select('slug').execute();
    });
    expect(log.map((l) => l.sql)).toEqual([
      'BEGIN',
      'select "slug" from "identity"."tenant_directory"',
      'COMMIT',
    ]);
  });
});

describe('TenantRepository', () => {
  it('throws outside withTenantTx', () => {
    const repo = new ProbeRepository();
    expect(() => repo.rows()).toThrow(NoTenantTransactionError);
    expect(() => repo.tenantFromContext()).toThrow(NoTenantTransactionError);
  });

  it('exposes the transaction and context inside withTenantTx, and not after it', async () => {
    const { db } = recordingDb();
    const repo = new ProbeRepository();
    await withTenantTx(db, { tenantId: TENANT }, async () => {
      expect(repo.tenantFromContext()).toBe(TENANT);
      await repo.rows();
    });
    expect(() => repo.rows()).toThrow(NoTenantTransactionError);
  });
});
