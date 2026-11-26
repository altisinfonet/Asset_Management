import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { assetsApi, lifecycleApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { uid } from './registry-fixtures';

/**
 * The mock of the lifecycle actions (M2-LIFE-05) and the bulk move answers like apps/api: the state
 * machine's 409s, the closed custody of mark-lost, the archived disposal, and location scoping.
 */
async function fails(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected the request to fail');
}
const key = () => crypto.randomUUID();

async function readyAsset(n: number) {
  return (
    await assetsApi.list({
      state_type: ['deployable'],
      assigned: false,
      sort: ['asset_tag'],
      limit: 30,
    })
  ).data[n]!;
}

describe('mock lifecycle actions', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('mark found is 409 unless lost; mark lost twice is 409; found takes a location', async () => {
    const asset = await readyAsset(10);
    expect(
      (await fails(lifecycleApi.markFound(asset.id, {}, { idempotencyKey: key() }))).status,
    ).toBe(409);
    const lost = await lifecycleApi.markLost(asset.id, { note: 'gone' }, { idempotencyKey: key() });
    expect(lost.value.status?.state_type).toBe('lost');
    expect(
      (await fails(lifecycleApi.markLost(asset.id, {}, { idempotencyKey: key() }))).status,
    ).toBe(409);
    const found = await lifecycleApi.markFound(
      asset.id,
      { location_id: uid('location', 5) },
      { idempotencyKey: key() },
    );
    expect(found.value).toMatchObject({ location_id: uid('location', 5) });
    expect(found.value.status?.state_type).toBe('deployable');
  });

  it('a stale If-Match is 412', async () => {
    const asset = await readyAsset(11);
    const error = await fails(
      lifecycleApi.markLost(asset.id, {}, { idempotencyKey: key(), etag: 'W/"999"' }),
    );
    expect(error.status).toBe(412);
  });

  it('dispose validates the reason, then archives with the record; an archived asset is 409', async () => {
    const asset = await readyAsset(12);
    const bad = await fails(
      lifecycleApi.dispose(asset.id, { reason: 'lost' as never }, { idempotencyKey: key() }),
    );
    expect(bad.status).toBe(422);
    const done = await lifecycleApi.dispose(
      asset.id,
      { reason: 'sold', note: 'Buyer: J. Doe' },
      { idempotencyKey: key() },
    );
    expect(done.value.archived_at).not.toBeNull();
    expect(done.value.disposal).toMatchObject({ reason: 'sold', note: 'Buyer: J. Doe' });
    expect(done.value.status?.state_type).toBe('archived');
    expect(
      (await fails(lifecycleApi.dispose(asset.id, { reason: 'sold' }, { idempotencyKey: key() })))
        .status,
    ).toBe(409);
    // restore takes it back and clears the record
    const restored = await assetsApi.restore(asset.id);
    expect(restored.value.disposal ?? null).toBeNull();
    expect(restored.value.archived_at).toBeNull();
  });
});

describe('mock bulk move', () => {
  it('moves every asset; an unknown location is a 422 of the whole request', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    const [a, b] = [await readyAsset(13), await readyAsset(14)];
    const result = await assetsApi.bulkMove([a.id, b.id], uid('location', 6), 'To repairs');
    expect(result.results.map((r) => r.status)).toEqual([200, 200]);
    expect((await assetsApi.get(a.id)).value.location_id).toBe(uid('location', 6));
    const error = await fails(assetsApi.bulkMove([a.id], uid('location', 999)));
    expect(error.status).toBe(422);
  });

  it('a location-scoped user cannot move outside the scope or clear the location', async () => {
    seedSession(MOCK_ACCOUNTS.scopedAdmin);
    const own = (await assetsApi.list({ limit: 1 })).data[0]!;
    const outside = await fails(assetsApi.bulkMove([own.id], uid('location', 1)));
    expect(outside.status).toBe(422);
    const cleared = await fails(assetsApi.bulkMove([own.id], null));
    expect(cleared.status).toBe(422);
  });
});
