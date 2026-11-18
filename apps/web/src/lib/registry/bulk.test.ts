import { ApiError } from '@assettracker/api-client';
import { describe, expect, it } from 'vitest';
import { runBulk, type BulkItem } from './bulk';

const items = (n: number): BulkItem[] =>
  Array.from({ length: n }, (_, i) => ({ id: `id-${i}`, label: `AT-${i}` }));

describe('runBulk', () => {
  it('runs every item, keeps the order of the results and reports progress', async () => {
    const progress: number[] = [];
    const results = await runBulk(items(5), async () => undefined, {
      onProgress: (done) => progress.push(done),
    });
    expect(results.map((r) => r.item.label)).toEqual(['AT-0', 'AT-1', 'AT-2', 'AT-3', 'AT-4']);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(progress.at(-1)).toBe(5);
  });

  it('a failure in one item does not stop the others and carries its reason', async () => {
    const results = await runBulk(items(4), async (item) => {
      if (item.id === 'id-2') {
        throw new ApiError('x', 412, { code: 'precondition-failed', request_id: 'req-1' });
      }
    });
    expect(results.map((r) => r.ok)).toEqual([true, true, false, true]);
    expect(results[2]!.error).toMatchObject({ kind: 'stale', requestId: 'req-1' });
  });

  it('never runs more than the concurrency limit at once', async () => {
    let running = 0;
    let peak = 0;
    await runBulk(
      items(12),
      async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 2));
        running -= 1;
      },
      { concurrency: 3 },
    );
    expect(peak).toBe(3);
  });

  it('handles an empty selection', async () => {
    expect(await runBulk([], async () => undefined)).toEqual([]);
  });
});
