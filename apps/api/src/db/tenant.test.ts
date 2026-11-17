import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { runWithTenant } from './tenant.js';

const TENANT = '0197b2c0-7a4e-7c3a-9f1d-5a1b2c3d4e5f';

function fakeSource(failOn?: string) {
  const calls: Array<{ text: string; values?: unknown[] }> = [];
  const client = {
    query: vi.fn(async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      if (failOn && text.startsWith(failOn)) throw new Error(`boom on ${failOn}`);
      return { rows: [] };
    }),
    release: vi.fn(),
  };
  return { source: { connect: async () => client as unknown as PoolClient }, client, calls };
}

describe('runWithTenant', () => {
  it('sets app.tenant_id transaction-locally between BEGIN and COMMIT', async () => {
    const { source, client, calls } = fakeSource();
    const result = await runWithTenant(source, TENANT, async (c) => {
      await c.query('select 42');
      return 'done';
    });

    expect(result).toBe('done');
    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      "select set_config('app.tenant_id', $1, true)",
      'select 42',
      'COMMIT',
    ]);
    expect(calls[1]?.values).toEqual([TENANT]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back, releases and rethrows when fn fails', async () => {
    const { source, client, calls } = fakeSource();
    await expect(
      runWithTenant(source, TENANT, async () => {
        throw new Error('handler failed');
      }),
    ).rejects.toThrow('handler failed');

    expect(calls.map((c) => c.text)).toEqual([
      'BEGIN',
      "select set_config('app.tenant_id', $1, true)",
      'ROLLBACK',
    ]);
    expect(client.release).toHaveBeenCalledTimes(1);
  });

  it('rolls back when set_config itself fails', async () => {
    const { source, calls } = fakeSource('select set_config');
    await expect(runWithTenant(source, TENANT, async () => 1)).rejects.toThrow(/boom/);
    expect(calls.at(-1)?.text).toBe('ROLLBACK');
  });

  it('rejects a non-UUID tenant id without touching the database', async () => {
    const { source, client } = fakeSource();
    const connect = vi.spyOn(source, 'connect');
    await expect(
      runWithTenant(source, "x'; drop table assets;--", async () => 1),
    ).rejects.toThrow();
    expect(connect).not.toHaveBeenCalled();
    expect(client.query).not.toHaveBeenCalled();
  });
});
