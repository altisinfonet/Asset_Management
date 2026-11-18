import { describe, expect, it } from 'vitest';
import { BULK_MAX, runBulk, type BulkItem } from './bulk';
import type { BulkAssetResult } from './types';

const items = (n: number): BulkItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, label: `AT-${i}` }));

/** A bulk response where every id succeeds, except the indexes in `failures` (index -> status). */
function respond(ids: string[], failures: Record<number, number> = {}): BulkAssetResult {
  const results = ids.map((_, index) => {
    const status = failures[index];
    return status
      ? {
          index,
          status,
          error: {
            type: 'x',
            title: 'x',
            status,
            code: status === 412 ? 'precondition-failed' : 'conflict',
            request_id: `req-${index}`,
          },
        }
      : { index, status: 200 };
  });
  const failed = Object.keys(failures).length;
  return {
    results: results as BulkAssetResult['results'],
    summary: { total: ids.length, succeeded: ids.length - failed, failed },
  };
}

describe('runBulk', () => {
  it('maps every result of the response to its item, in order, and reports progress', async () => {
    const progress: number[] = [];
    const results = await runBulk(items(5), async (ids) => respond(ids), {
      onProgress: (done) => progress.push(done),
    });
    expect(results.map((r) => r.item.label)).toEqual(['AT-0', 'AT-1', 'AT-2', 'AT-3', 'AT-4']);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(progress).toEqual([5]);
  });

  it('a failing item does not stop the others and carries its problem', async () => {
    const results = await runBulk(items(4), async (ids) => respond(ids, { 2: 412 }));
    expect(results.map((r) => r.ok)).toEqual([true, true, false, true]);
    expect(results[2]!.error).toMatchObject({
      kind: 'stale',
      code: 'precondition-failed',
      requestId: 'req-2',
    });
  });

  it('keeps the usage counts of a 409 item', async () => {
    const results = await runBulk(items(1), async () => ({
      results: [
        {
          index: 0,
          status: 409,
          error: { type: 'x', title: 'x', status: 409, code: 'conflict', usage: { assets: 3 } },
        },
      ],
      summary: { total: 1, succeeded: 0, failed: 1 },
    }));
    expect(results[0]!.error).toMatchObject({ kind: 'conflict', usage: { assets: 3 } });
  });

  it('sends a selection above the limit in chunks of 100 ids', async () => {
    const calls: number[] = [];
    const results = await runBulk(items(BULK_MAX * 2 + 5), async (ids) => {
      calls.push(ids.length);
      return respond(ids);
    });
    expect(calls).toEqual([100, 100, 5]);
    expect(results).toHaveLength(205);
  });

  it('a request that fails as a whole fails every item of that chunk with the same reason', async () => {
    const { ApiError } = await import('@assettracker/api-client');
    const results = await runBulk(items(3), async () => {
      throw new ApiError('x', 403, { code: 'forbidden', request_id: 'req-9' });
    });
    expect(results.map((r) => r.ok)).toEqual([false, false, false]);
    expect(results[0]!.error).toMatchObject({ kind: 'forbidden', requestId: 'req-9' });
  });

  it('handles an empty selection without calling the API', async () => {
    let called = false;
    const results = await runBulk([], async (ids) => {
      called = true;
      return respond(ids);
    });
    expect(results).toEqual([]);
    expect(called).toBe(false);
  });
});
