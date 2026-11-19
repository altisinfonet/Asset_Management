import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { attachmentsApi } from '@/lib/files/api';
import { assetsApi, custodyApi, fetchAll, locationsApi, peopleApi } from '@/lib/registry/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { setMockScanDelay } from './m2-handlers';
import { uid } from './registry-fixtures';

/**
 * The M2 wave 1 mock endpoints follow docs/engineering/openapi.yaml, because the web screens and
 * Playwright are written against them: counts, uniqueness, cycles, idempotency, ETags, scan states.
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

const code = (error: ApiError) => (error.body as { code?: string }).code;

async function readyAsset() {
  const page = await assetsApi.list({
    state_type: ['deployable'],
    assigned: false,
    sort: ['asset_tag'],
    limit: 1,
  });
  return page.data[0]!;
}

async function heldAsset() {
  const page = await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 });
  return page.data[0]!;
}

describe('mock locations (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists the tree with the asset count of every node including its sublocations', async () => {
    const all = await fetchAll((cursor) => locationsApi.list({ limit: 200, cursor }));
    const site = all.find((l) => l.name === 'Riverside Elementary')!;
    const room = all.find((l) => l.name === 'Room 101')!;
    const assets = await assetsApi.list({ limit: 1, include_total: true });
    expect(site.asset_count).toBe(assets.page.total);
    expect(room.asset_count).toBeLessThan(site.asset_count!);
    const inRoom = await assetsApi.list({ location_id: room.id, include_total: true, limit: 1 });
    expect(inRoom.page.total).toBe(room.asset_count);
  });

  it('filters assets by location with and without sublocations', async () => {
    const all = await fetchAll((cursor) => locationsApi.list({ limit: 200, cursor }));
    const building = all.find((l) => l.name === 'Main building')!;
    const only = await assetsApi.list({
      location_id: building.id,
      include_sublocations: false,
      include_total: true,
      limit: 1,
    });
    const withChildren = await assetsApi.list({
      location_id: building.id,
      include_total: true,
      limit: 1,
    });
    expect(only.page.total).toBe(0);
    expect(withChildren.page.total).toBeGreaterThan(0);
  });

  it('creates inside a parent, keeps names unique per parent and refuses cycles', async () => {
    const site = (await locationsApi.list({ root: true })).data[0]!;
    const created = (
      await locationsApi.create({ name: 'Annex', kind: 'building', parent_id: site.id })
    ).value;
    expect(created).toMatchObject({ depth: 1, parent_id: site.id, asset_count: 0 });
    expect(created.ancestor_ids).toEqual([site.id, created.id]);

    const duplicate = await fails(
      locationsApi.create({ name: ' annex ', kind: 'room', parent_id: site.id }),
    );
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/name',
    );
    // the same name is fine under another parent
    await locationsApi.create({ name: 'Annex', kind: 'room', parent_id: created.id });

    const cycle = await fails(locationsApi.update(site.id, { parent_id: created.id }));
    expect(cycle.status).toBe(422);
    expect((cycle.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/parent_id',
    );
  });

  it('moving a location re-parents its subtree and recomputes depth and ancestors', async () => {
    const all = await fetchAll((cursor) => locationsApi.list({ limit: 200, cursor }));
    const building = all.find((l) => l.name === 'Main building')!;
    const gym = all.find((l) => l.name === 'Gym')!;
    const other = (await locationsApi.create({ name: 'North site', kind: 'site' })).value;
    await locationsApi.update(building.id, { parent_id: other.id });
    const moved = (await locationsApi.get(gym.id)).value;
    expect(moved.depth).toBe(2);
    expect(moved.ancestor_ids).toEqual([other.id, building.id, gym.id]);
  });

  it('refuses to archive a location with assets or sublocations and lists the counts', async () => {
    const all = await fetchAll((cursor) => locationsApi.list({ limit: 200, cursor }));
    const building = all.find((l) => l.name === 'Main building')!;
    const refused = await fails(locationsApi.archive(building.id));
    expect(refused.status).toBe(409);
    const usage = (refused.body as { usage: Record<string, number> }).usage;
    expect(usage.children).toBeGreaterThan(0);
    expect(usage.assets).toBeGreaterThan(0);

    const empty = (await locationsApi.create({ name: 'Scratch', kind: 'other' })).value;
    await locationsApi.archive(empty.id);
    const live = await locationsApi.list({ q: 'Scratch' });
    expect(live.data).toHaveLength(0);
  });

  it('a read-only role lists locations but cannot write them', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await locationsApi.list({ limit: 1 })).data).toHaveLength(1);
    expect((await fails(locationsApi.create({ name: 'Nope' }))).status).toBe(403);
  });
});

describe('mock people (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists people with and without a login, and filters on it', async () => {
    const withLogin = await peopleApi.list({ has_login: true, include_total: true });
    const without = await peopleApi.list({ has_login: false, include_total: true, limit: 1 });
    expect(withLogin.page.total).toBe(4);
    expect(withLogin.data.every((p) => p.user_id)).toBe(true);
    expect(without.page.total).toBeGreaterThan(20);
  });

  it('searches by name, e-mail and number', async () => {
    expect((await peopleApi.list({ q: 'okafor' })).data.map((p) => p.display_name)).toContain(
      'Jamie Okafor',
    );
    expect((await peopleApi.list({ q: 'S-2001' })).data).toHaveLength(1);
  });

  it('keeps e-mail and employee number unique per tenant', async () => {
    const created = (
      await peopleApi.create({ display_name: 'Dana Reyes', email: 'dana@school.example' })
    ).value;
    expect(created.user_id).toBeNull();
    const email = await fails(
      peopleApi.create({ display_name: 'Other Dana', email: 'DANA@school.example' }),
    );
    expect(email.status).toBe(409);
    expect((email.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/email',
    );
    const ref = await fails(peopleApi.create({ display_name: 'Third', employee_ref: 'S-2001' }));
    expect((ref.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/employee_ref',
    );
  });

  it('refuses to archive a person who still holds assets, and lists what they hold', async () => {
    const asset = await heldAsset();
    const holderId = asset.current_assignment!.target_id;
    const refused = await fails(peopleApi.archive(holderId));
    expect(refused.status).toBe(409);
    expect(
      (refused.body as { usage: Record<string, number> }).usage.open_assignments,
    ).toBeGreaterThan(0);
    const open = await peopleApi.assignments(holderId);
    expect(open.data.length).toBeGreaterThan(0);
    expect(open.data.every((a) => !a.checked_in_at)).toBe(true);
    const all = await peopleApi.assignments(holderId, { state: 'all' });
    expect(all.data.length).toBeGreaterThanOrEqual(open.data.length);
  });
});

describe('mock custody (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('checks an asset out: assignment, deployed status, new ETag, history with the actor', async () => {
    const asset = await readyAsset();
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    const out = await custodyApi.checkout(
      asset.id,
      { person_id: person.id, expected_return: '2099-01-31', note: 'Exam week' },
      { idempotencyKey: 'key-checkout-1' },
    );
    expect(out.result.asset.current_assignment).toMatchObject({
      target_type: 'person',
      target_id: person.id,
      target_name: person.display_name,
      expected_return: '2099-01-31',
    });
    expect(out.result.asset.status?.state_type).toBe('deployed');
    expect(out.result.assignment).toMatchObject({ person_id: person.id, quantity_returned: 0 });
    expect(out.etag).toBeTruthy();

    const history = await assetsApi.history(asset.id, { event_type: ['checked_out'] });
    expect(history.data[0]).toMatchObject({
      event_type: 'checked_out',
      actor: { display_name: 'Alice Owner' },
    });
  });

  it('requires an Idempotency-Key and replays the first answer for the same key and body', async () => {
    const asset = await readyAsset();
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    const missing = await fails(
      custodyApi.checkout(asset.id, { person_id: person.id }, { idempotencyKey: '' }),
    );
    expect(missing.status).toBe(400);
    expect(code(missing)).toBe('idempotency-key-required');
    const short = await fails(
      custodyApi.checkout(asset.id, { person_id: person.id }, { idempotencyKey: 'abc' }),
    );
    expect(code(short)).toBe('idempotency-key-invalid');

    const first = await custodyApi.checkout(
      asset.id,
      { person_id: person.id },
      { idempotencyKey: 'key-replay-1' },
    );
    const again = await custodyApi.checkout(
      asset.id,
      { person_id: person.id },
      { idempotencyKey: 'key-replay-1' },
    );
    expect(again.replayed).toBe(true);
    expect(again.result.assignment.id).toBe(first.result.assignment.id);

    const reuse = await fails(
      custodyApi.checkout(
        asset.id,
        { location_id: uid('location', 3) },
        { idempotencyKey: 'key-replay-1' },
      ),
    );
    expect(reuse.status).toBe(422);
    expect(code(reuse)).toBe('idempotency-key-reuse');
  });

  it('a held asset cannot be checked out again (409 asset-already-checked-out)', async () => {
    const asset = await heldAsset();
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    const error = await fails(
      custodyApi.checkout(asset.id, { person_id: person.id }, { idempotencyKey: 'key-held-0001' }),
    );
    expect(error.status).toBe(409);
    expect(code(error)).toBe('asset-already-checked-out');
  });

  it('answers 412 when the asset changed since the ETag the caller holds', async () => {
    const asset = await readyAsset();
    const read = await assetsApi.get(asset.id);
    await assetsApi.update(asset.id, { notes: 'changed elsewhere' });
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    const error = await fails(
      custodyApi.checkout(
        asset.id,
        { person_id: person.id },
        { idempotencyKey: 'key-stale-0001', etag: read.etag },
      ),
    );
    expect(error.status).toBe(412);
  });

  it('validates the target: exactly one, existing and active', async () => {
    const asset = await readyAsset();
    const none = await fails(
      custodyApi.checkout(asset.id, {} as never, { idempotencyKey: 'key-none-0001' }),
    );
    expect(none.status).toBe(422);
    const inactive = (await peopleApi.list({ status: 'inactive' })).data[0]!;
    const refused = await fails(
      custodyApi.checkout(
        asset.id,
        { person_id: inactive.id },
        { idempotencyKey: 'key-inactive-1' },
      ),
    );
    expect((refused.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/person_id',
    );
    const past = await fails(
      custodyApi.checkout(
        asset.id,
        { location_id: uid('location', 3), expected_return: '2001-01-01' },
        { idempotencyKey: 'key-past-00001' },
      ),
    );
    expect((past.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/expected_return',
    );
  });

  it('checks in: closes the assignment, sets status and location, and refuses a second check-in', async () => {
    const asset = await heldAsset();
    const location = uid('location', 4);
    const back = await custodyApi.checkin(
      asset.id,
      { checkin_location_id: location, note: 'Condition: Fair.' },
      { idempotencyKey: 'key-checkin-01' },
    );
    expect(back.result.asset.current_assignment).toBeNull();
    expect(back.result.asset.location_id).toBe(location);
    expect(back.result.asset.status?.state_type).toBe('deployable');
    expect(back.result.assignment).toMatchObject({
      quantity_returned: 1,
      checkin_note: 'Condition: Fair.',
    });

    const again = await fails(
      custodyApi.checkin(asset.id, {}, { idempotencyKey: 'key-checkin-02' }),
    );
    expect(again.status).toBe(409);
    expect(code(again)).toBe('asset-not-checked-out');
  });

  it('transfers in one step: old assignment closed, new one open, one history event', async () => {
    const asset = await heldAsset();
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    const moved = await custodyApi.transfer(
      asset.id,
      { person_id: person.id, reason: 'Class change' },
      { idempotencyKey: 'key-transfer-1' },
    );
    expect(moved.result.transfer.from_assignment_id).toBe(asset.current_assignment!.assignment_id);
    expect(moved.result.asset.current_assignment?.target_id).toBe(person.id);
    const events = await assetsApi.history(asset.id, { event_type: ['transferred'] });
    expect(events.data).toHaveLength(1);
    const assignments = await peopleApi.assignments(asset.current_assignment!.target_id, {
      state: 'closed',
    });
    expect(assignments.data.some((a) => a.id === asset.current_assignment!.assignment_id)).toBe(
      true,
    );
  });

  it('only a role with the permission may act; a viewer gets 403', async () => {
    const asset = await readyAsset();
    seedSession(MOCK_ACCOUNTS.viewer);
    const error = await fails(
      custodyApi.checkout(
        asset.id,
        { location_id: uid('location', 3) },
        { idempotencyKey: 'key-viewer-01' },
      ),
    );
    expect(error.status).toBe(403);
  });

  it('scan resolve lists the actions valid for the state and the caller', async () => {
    const ready = await readyAsset();
    const held = await heldAsset();
    expect((await assetsApi.resolve(ready.asset_tag)).allowed_actions).toEqual(
      expect.arrayContaining(['checkout', 'update']),
    );
    const heldActions = (await assetsApi.resolve(held.asset_tag)).allowed_actions;
    expect(heldActions).toEqual(expect.arrayContaining(['checkin', 'transfer']));
    expect(heldActions).not.toContain('checkout');
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await assetsApi.resolve(ready.asset_tag)).allowed_actions).toEqual([]);
  });

  it('filters the asset list by custody', async () => {
    const holder = (await heldAsset()).current_assignment!;
    const mine = await assetsApi.list({
      assigned_person_id: holder.target_id,
      include_total: true,
    });
    expect(mine.data.every((a) => a.current_assignment?.target_id === holder.target_id)).toBe(true);
    const free = await assetsApi.list({ assigned: false, limit: 200 });
    expect(free.data.every((a) => a.current_assignment === null)).toBe(true);
  });
});

describe('mock attachments (owner)', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockScanDelay(0);
  });

  const assetId = () => uid('asset', 124);

  async function upload(filename: string, contentType: string, size: number) {
    const created = await attachmentsApi.create({
      entity_type: 'asset',
      entity_id: assetId(),
      kind: 'document',
      filename,
      content_type: contentType,
      size_bytes: size,
    });
    const put = await fetch(created.upload.url, {
      method: created.upload.method,
      headers: created.upload.headers,
      body: new Uint8Array(size),
    });
    expect(put.ok).toBe(true);
    return created.attachment;
  }

  it('creates, uploads, completes and shows the scan result with a download URL once clean', async () => {
    const attachment = await upload('quote.pdf', 'application/pdf', 2048);
    expect(attachment.scan_status).toBe('pending');
    expect(attachment.uploaded_at).toBeNull();
    const done = await attachmentsApi.complete(attachment.id);
    expect(done.uploaded_at).toBeTruthy();
    const read = await attachmentsApi.get(attachment.id);
    expect(read.scan_status).toBe('clean');
    expect(read.download_url).toMatch(/^data:/);
    const list = await attachmentsApi.list('asset', assetId());
    expect(list.data.some((a) => a.id === attachment.id)).toBe(true);
    expect(list.data.every((a) => a.download_url === undefined)).toBe(true);
  });

  it('a file that is not clean has no download URL: pending stays pending, EICAR is rejected', async () => {
    setMockScanDelay(60_000);
    const slow = await upload('slow.pdf', 'application/pdf', 100);
    await attachmentsApi.complete(slow.id);
    const pending = await attachmentsApi.get(slow.id);
    expect(pending.scan_status).toBe('pending');
    expect(pending.download_url).toBeNull();

    setMockScanDelay(0);
    const virus = await upload('eicar-test.pdf', 'application/pdf', 68);
    await attachmentsApi.complete(virus.id);
    const result = await attachmentsApi.get(virus.id);
    expect(result.scan_status).toBe('infected');
    expect(result.download_url).toBeNull();
  });

  it('refuses a type or size that is not allowed, with the message on the field', async () => {
    const type = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'setup.exe',
        content_type: 'application/x-msdownload',
        size_bytes: 10,
      }),
    );
    expect(type.status).toBe(422);
    expect((type.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/content_type',
    );
    const size = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'huge.pdf',
        content_type: 'application/pdf',
        size_bytes: 26_000_000,
      }),
    );
    expect((size.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/size_bytes',
    );
  });

  it('cannot be completed before the bytes arrived, and can be deleted', async () => {
    const created = await attachmentsApi.create({
      entity_type: 'asset',
      entity_id: assetId(),
      filename: 'late.pdf',
      content_type: 'application/pdf',
      size_bytes: 10,
    });
    expect((await fails(attachmentsApi.complete(created.attachment.id))).status).toBe(409);
    await attachmentsApi.archive(created.attachment.id);
    expect((await fails(attachmentsApi.get(created.attachment.id))).status).toBe(404);
  });

  it('is seeded with a clean photo, a clean document, a pending and a rejected file', async () => {
    const list = await attachmentsApi.list('asset', assetId());
    expect(list.data.map((a) => a.scan_status).sort()).toEqual([
      'clean',
      'clean',
      'infected',
      'pending',
    ]);
  });

  it('a viewer can read attachments but not add them', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await attachmentsApi.list('asset', assetId())).data.length).toBeGreaterThan(0);
    const error = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'x.pdf',
        content_type: 'application/pdf',
        size_bytes: 10,
      }),
    );
    expect(error.status).toBe(403);
  });
});
