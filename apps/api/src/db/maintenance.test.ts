import { describe, expect, it } from 'vitest';
import {
  PARTITION_ATTEMPTS,
  ensurePartitions,
  isPartitionLockConflict,
  partitionRetryPause,
  type Queryable,
} from './maintenance.js';

/** A client whose `ensure_partitions` call fails with the given SQLSTATEs first, then returns 6. */
function scriptedClient(failures: string[]) {
  const statements: string[] = [];
  const client: Queryable = {
    async query(text) {
      statements.push(text.trim());
      if (text.includes('app.ensure_partitions')) {
        const code = failures.shift();
        if (code) {
          // the shape node-postgres gives a server error (message as Postgres words it)
          throw Object.assign(new Error(`could not obtain lock on relation "asset"`), { code });
        }
        return { rows: [{ created: 6 }] };
      }
      return { rows: [] };
    },
  };
  return { client, statements };
}

describe('ensurePartitions retry (ED-28 "Partition DDL yields", migration 0180)', () => {
  it('retries the NOWAIT failure of ensure_partitions (55P03) and the lock_timeout one alike, then commits', async () => {
    const pauses: number[] = [];
    // 55P03 is what both layers raise: a NOWAIT lock that is taken and an expired lock_timeout; 40P01 too
    const { client, statements } = scriptedClient(['55P03', '55P03', '40P01']);
    const created = await ensurePartitions(
      client,
      new Date('2040-01-15T00:00:00Z'),
      3,
      async (ms) => {
        pauses.push(ms);
      },
    );
    expect(created).toBe(6);
    expect(pauses).toHaveLength(3);
    // growing backoff: 250 ms per attempt so far plus at most 100 ms of jitter
    pauses.forEach((ms, i) => {
      expect(ms).toBeGreaterThanOrEqual(250 * (i + 1));
      expect(ms).toBeLessThan(250 * (i + 1) + 100);
    });
    // every attempt is its own transaction with the lock timeout, and a failed one is rolled back
    expect(statements.filter((s) => s === 'begin')).toHaveLength(4);
    expect(statements.filter((s) => s.startsWith('set local lock_timeout'))).toHaveLength(4);
    expect(statements.filter((s) => s === 'rollback')).toHaveLength(3);
    expect(statements.at(-1)).toBe('commit');
  });

  it('gives up after the last attempt and surfaces the lock error', async () => {
    const { client } = scriptedClient(Array<string>(PARTITION_ATTEMPTS).fill('55P03'));
    await expect(
      ensurePartitions(client, new Date(), 1, async () => undefined),
    ).rejects.toMatchObject({
      code: '55P03',
    });
  });

  it('does not retry other errors', async () => {
    const pauses: number[] = [];
    const { client } = scriptedClient(['42501']);
    await expect(
      ensurePartitions(client, new Date(), 1, async (ms) => {
        pauses.push(ms);
      }),
    ).rejects.toMatchObject({ code: '42501' });
    expect(pauses).toEqual([]);
  });

  it('classifies the retryable SQLSTATEs and computes a jittered, growing pause', () => {
    expect(isPartitionLockConflict({ code: '55P03' })).toBe(true);
    expect(isPartitionLockConflict({ code: '40P01' })).toBe(true);
    expect(isPartitionLockConflict({ code: '23505' })).toBe(false);
    expect(isPartitionLockConflict(null)).toBe(false);
    expect(partitionRetryPause(1, () => 0)).toBe(250);
    expect(partitionRetryPause(3, () => 0.999)).toBe(849);
  });
});
