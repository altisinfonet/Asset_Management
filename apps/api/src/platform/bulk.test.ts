import { describe, expect, it } from 'vitest';
import { runBulk } from './bulk.js';
import { ApiProblem, problem } from './problem.js';

describe('runBulk', () => {
  it('returns one result per item in request order with a summary', async () => {
    const out = await runBulk(
      [1, 2, 3, 4],
      async (n) => {
        if (n === 2) throw problem.notFound('no asset 2');
        if (n === 4)
          throw problem.validation([{ pointer: '/items/3/qty', message: 'must be positive' }]);
        return { n };
      },
      { successStatus: 201, requestId: 'req-1' },
    );
    expect(out.summary).toEqual({ total: 4, succeeded: 2, failed: 2 });
    expect(out.results.map((r) => [r.index, r.status])).toEqual([
      [0, 201],
      [1, 404],
      [2, 201],
      [3, 422],
    ]);
    expect(out.results[0]).toEqual({ index: 0, status: 201, data: { n: 1 } });
    expect(out.results[1]?.error).toMatchObject({
      code: 'not-found',
      request_id: 'req-1',
      detail: 'no asset 2',
    });
    expect(out.results[3]?.error?.errors).toEqual([
      { pointer: '/items/3/qty', message: 'must be positive' },
    ]);
  });

  it('runs items sequentially', async () => {
    const order: number[] = [];
    await runBulk([1, 2, 3], async (n) => {
      await new Promise((r) => setTimeout(r, 5 - n));
      order.push(n);
    });
    expect(order).toEqual([1, 2, 3]);
  });

  it('rejects an empty or oversized request as 422 validation pointing at the array', async () => {
    const tooMany = await runBulk(Array(101).fill(0), async () => 1).catch(
      (e: unknown) => e as ApiProblem,
    );
    expect(tooMany).toBeInstanceOf(ApiProblem);
    expect((tooMany as ApiProblem).getStatus()).toBe(422);
    expect((tooMany as ApiProblem).errors?.[0]).toMatchObject({
      pointer: '/items',
      code: 'too_big',
    });
    const custom = await runBulk([1, 2, 3], async () => 1, { max: 2, pointer: '/assets' }).catch(
      (e: unknown) => e as ApiProblem,
    );
    expect((custom as ApiProblem).errors?.[0]?.pointer).toBe('/assets');
    const empty = await runBulk([], async () => 1).catch((e: unknown) => e as ApiProblem);
    expect((empty as ApiProblem).errors?.[0]?.code).toBe('too_small');
    expect((await runBulk(Array(100).fill(0), async () => 1)).summary.total).toBe(100);
  });

  it('an unexpected error (not a problem) fails the whole request instead of hiding in one item', async () => {
    const boom = new Error('database exploded');
    await expect(
      runBulk([1, 2], async (n) => {
        if (n === 2) throw boom;
        return n;
      }),
    ).rejects.toBe(boom);
  });
});
