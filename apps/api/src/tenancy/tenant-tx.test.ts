import { describe, expect, it } from 'vitest';
import { isUniqueViolation, prismaCodeOf, sqlStateOf } from './errors.js';
import { TenantRepository } from './tenant-repository.js';
import { runWithRequestContext } from '../context/request-context.js';
import { currentLocationScope, isLocationScoped } from './location-scope.js';
import {
  NoTenantTransactionError,
  runWithLocationScope,
  type Tx,
  type TxSource,
  withPreTenantTx,
  withTenantTx,
} from './tenant-tx.js';

const TENANT = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f';
const OTHER = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e60';
const ACTOR = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e61';

interface LogEntry {
  sql: string;
  parameters?: readonly unknown[];
  options?: { maxWait?: number; timeout?: number };
}

/** A fake PrismaClient transaction source that records the exact statement sequence. */
function recordingSource(failOn?: RegExp) {
  const log: LogEntry[] = [];
  let open = 0;
  let closed = 0;
  const tx = {
    async $executeRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const text = strings.reduce(
        (acc, part, i) => acc + part + (i < values.length ? `$${i + 1}` : ''),
        '',
      );
      log.push({ sql: text, parameters: values });
      if (failOn?.test(text)) throw new Error(`boom on ${text}`);
      return 0;
    },
  } as unknown as Tx;
  const source: TxSource = {
    async $transaction<T>(
      fn: (t: Tx) => Promise<T>,
      options?: { maxWait?: number; timeout?: number },
    ): Promise<T> {
      open++;
      log.push({ sql: 'BEGIN', options });
      try {
        const result = await fn(tx);
        log.push({ sql: 'COMMIT' });
        return result;
      } catch (err) {
        log.push({ sql: 'ROLLBACK' });
        throw err;
      } finally {
        closed++;
      }
    },
  };
  return { source, log, counts: () => ({ open, closed }) };
}

class ProbeRepository extends TenantRepository {
  tenantFromContext() {
    return this.context.tenantId;
  }
  handle() {
    return this.db;
  }
}

describe('withTenantTx', () => {
  it('sets the tenant context transaction-locally between BEGIN and COMMIT', async () => {
    const { source, log, counts } = recordingSource();
    const result = await withTenantTx(
      source,
      { tenantId: TENANT, actorId: ACTOR, requestId: 'req-1' },
      async () => 'done',
    );

    expect(result).toBe('done');
    expect(log.map((l) => l.sql.split('\n')[0])).toEqual([
      'BEGIN',
      "select set_config('app.tenant_id', $1, true),",
      'COMMIT',
    ]);
    // is_local = true is part of the statement text, never a parameter: no session-level SET.
    expect(log[1]?.sql).toContain("set_config('app.actor_id', $2, true)");
    expect(log[1]?.sql).toContain("set_config('app.request_id', $3, true)");
    expect(log[1]?.parameters).toEqual([TENANT, ACTOR, 'req-1']);
    expect(counts()).toEqual({ open: 1, closed: 1 });
  });

  it('applies the default interactive-transaction limits and lets callers override them', async () => {
    const a = recordingSource();
    await withTenantTx(a.source, { tenantId: TENANT }, async () => undefined);
    expect(a.log[0]?.options).toEqual({ maxWait: 5_000, timeout: 30_000 });
    const b = recordingSource();
    await withTenantTx(b.source, { tenantId: TENANT }, async () => undefined, {
      maxWaitMs: 1_000,
      timeoutMs: 120_000,
    });
    expect(b.log[0]?.options).toEqual({ maxWait: 1_000, timeout: 120_000 });
  });

  it('rolls back and rethrows when fn fails', async () => {
    const { source, log } = recordingSource();
    await expect(
      withTenantTx(source, { tenantId: TENANT }, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');
    expect(log.map((l) => l.sql.split('\n')[0])).toEqual([
      'BEGIN',
      "select set_config('app.tenant_id', $1, true),",
      'ROLLBACK',
    ]);
  });

  it('rolls back when set_config itself fails', async () => {
    const { source, log } = recordingSource(/set_config/);
    await expect(withTenantTx(source, { tenantId: TENANT }, async () => 1)).rejects.toThrow(/boom/);
    expect(log.at(-1)?.sql).toBe('ROLLBACK');
  });

  it('rejects a non-UUID tenant or actor id without touching the database', async () => {
    const { source, log } = recordingSource();
    await expect(
      withTenantTx(source, { tenantId: "x'; drop table assets;--" }, async () => 1),
    ).rejects.toThrow();
    await expect(
      withTenantTx(source, { tenantId: TENANT, actorId: 'not-a-uuid' }, async () => 1),
    ).rejects.toThrow();
    expect(log).toEqual([]);
  });

  it('joins a nested call for the same tenant and refuses another tenant', async () => {
    const { source, log } = recordingSource();
    await withTenantTx(source, { tenantId: TENANT }, async () => {
      await withTenantTx(source, { tenantId: TENANT }, async () => undefined);
      await expect(
        withTenantTx(source, { tenantId: OTHER }, async () => undefined),
      ).rejects.toThrow(/different tenant/);
    });
    expect(log.filter((l) => l.sql === 'BEGIN')).toHaveLength(1);
  });

  it('withPreTenantTx runs in a transaction and sets no tenant context', async () => {
    const { source, log } = recordingSource();
    await withPreTenantTx(source, async () => 'x');
    expect(log.map((l) => l.sql)).toEqual(['BEGIN', 'COMMIT']);
  });
});

describe('TenantRepository', () => {
  it('throws outside withTenantTx', () => {
    const repo = new ProbeRepository();
    expect(() => repo.handle()).toThrow(NoTenantTransactionError);
    expect(() => repo.tenantFromContext()).toThrow(NoTenantTransactionError);
  });

  it('exposes the transaction and context inside withTenantTx, and not after it', async () => {
    const { source } = recordingSource();
    const repo = new ProbeRepository();
    await withTenantTx(source, { tenantId: TENANT }, async (trx) => {
      expect(repo.tenantFromContext()).toBe(TENANT);
      expect(repo.handle()).toBe(trx);
    });
    expect(() => repo.handle()).toThrow(NoTenantTransactionError);
  });
});

describe('sqlStateOf', () => {
  it('reads the SQLSTATE from pg errors and from Prisma driver-adapter errors', () => {
    expect(sqlStateOf({ code: '42501' })).toBe('42501');
    expect(
      sqlStateOf({
        code: 'P2010',
        clientVersion: '7.10.1',
        meta: { driverAdapterError: { cause: { kind: 'postgres', originalCode: '23503' } } },
      }),
    ).toBe('23503');
    expect(
      sqlStateOf({
        code: 'P2010',
        clientVersion: '7.10.1',
        meta: { code: '22012', message: 'division by zero' },
      }),
    ).toBe('22012');
    expect(sqlStateOf(new Error('plain'))).toBeUndefined();
    expect(sqlStateOf(null)).toBeUndefined();
    // A Prisma-only code is not a SQLSTATE.
    expect(sqlStateOf({ code: 'P2002', clientVersion: '7' })).toBeUndefined();
  });

  it('classifies unique violations from either shape', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation({ code: 'P2002', clientVersion: '7' })).toBe(true);
    expect(isUniqueViolation({ code: '23503' })).toBe(false);
    expect(prismaCodeOf({ code: 'P2002', clientVersion: '7' })).toBe('P2002');
    expect(prismaCodeOf({ code: '23505' })).toBeUndefined();
    expect(prismaCodeOf({ code: 'P0001' })).toBeUndefined(); // a plpgsql RAISE, not a Prisma code
  });
});

describe('location scope of a tenant transaction (M2-LOC-03, ED-26)', () => {
  const SCHOOL = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e70';
  const OTHER_SCHOOL = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e71';

  it('is not limited by default', async () => {
    const { source } = recordingSource();
    await withTenantTx(source, { tenantId: TENANT }, async () => {
      expect(currentLocationScope()).toBeNull();
      expect(isLocationScoped()).toBe(false);
    });
    expect(currentLocationScope()).toBeNull(); // outside any transaction
  });

  it("inherits the ambient request's scope (set by the auth guard)", async () => {
    const { source } = recordingSource();
    await runWithRequestContext({ requestId: 'r1', locationScope: [SCHOOL] }, () =>
      withTenantTx(source, { tenantId: TENANT }, async () => {
        expect(currentLocationScope()).toEqual([SCHOOL]);
      }),
    );
  });

  it('an explicit scope wins over the ambient one, and null means not limited', async () => {
    const { source } = recordingSource();
    await runWithRequestContext({ requestId: 'r2', locationScope: [SCHOOL] }, async () => {
      await withTenantTx(source, { tenantId: TENANT, locationScope: [OTHER_SCHOOL] }, async () => {
        expect(currentLocationScope()).toEqual([OTHER_SCHOOL]);
      });
      await withTenantTx(source, { tenantId: TENANT, locationScope: null }, async () => {
        expect(currentLocationScope()).toBeNull();
      });
    });
  });

  it('a nested call narrows an unscoped transaction but never widens a scoped one', async () => {
    const { source } = recordingSource();
    await withTenantTx(source, { tenantId: TENANT }, async () => {
      await withTenantTx(source, { tenantId: TENANT, locationScope: [SCHOOL] }, async () => {
        expect(currentLocationScope()).toEqual([SCHOOL]);
        await withTenantTx(source, { tenantId: TENANT, locationScope: null }, async () => {
          expect(currentLocationScope()).toEqual([SCHOOL]);
        });
      });
      expect(currentLocationScope()).toBeNull();
    });
  });

  it('runWithLocationScope scopes a job step, never widens, and needs a transaction', async () => {
    const { source } = recordingSource();
    await withTenantTx(source, { tenantId: TENANT }, async () => {
      await runWithLocationScope([SCHOOL], async () => {
        expect(currentLocationScope()).toEqual([SCHOOL]);
        await runWithLocationScope([OTHER_SCHOOL], async () => {
          expect(currentLocationScope()).toEqual([SCHOOL]);
        });
      });
      await runWithLocationScope(null, async () => {
        expect(currentLocationScope()).toBeNull();
      });
    });
    expect(() => runWithLocationScope([SCHOOL], () => 1)).toThrow(NoTenantTransactionError);
  });

  it('rejects a scope id that is not a uuid before touching the database', async () => {
    const { source, log } = recordingSource();
    await expect(
      withTenantTx(source, { tenantId: TENANT, locationScope: ['nope'] }, async () => 1),
    ).rejects.toThrow();
    expect(log).toEqual([]);
  });
});
