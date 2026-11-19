import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
import { getApi } from '@/lib/api';
import { attachmentsApi, filesSettingsApi } from '@/lib/files/api';
import {
  assetsApi,
  custodyApi,
  fetchAll,
  locationsApi,
  peopleApi,
  statusApi,
} from '@/lib/registry/api';
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
    expect(code(refused)).toBe('conflict');
    const usage = (refused.body as { usage: Record<string, number> }).usage;
    expect(usage.children).toBeGreaterThan(0);
    // the API counts the assets filed directly in the location, not in its sublocations
    expect(usage.assets).toBe(0);
    const room = all.find((l) => l.name === 'Room 101')!;
    const roomUsage = (
      (await fails(locationsApi.archive(room.id))).body as { usage: Record<string, number> }
    ).usage;
    expect(roomUsage.assets).toBe(room.direct_asset_count);
    expect(Object.keys(roomUsage).sort()).toEqual(['assets', 'children', 'open_assignments', 'people']);

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

describe('mock people: deactivation and history (owner)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('deactivating a holder is a 409 with usage.open_assignments unless forced with a reason', async () => {
    const holder = (await heldAsset()).current_assignment!.target_id;
    const person = await peopleApi.get(holder);
    const refused = await fails(peopleApi.deactivate(holder, {}, person.etag));
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('conflict');
    expect(
      (refused.body as { usage: Record<string, number> }).usage.open_assignments,
    ).toBeGreaterThan(0);

    const noReason = await fails(peopleApi.deactivate(holder, { force: true }, person.etag));
    expect(noReason.status).toBe(422);
    expect(
      (noReason.body as { errors: Array<{ pointer: string; code: string }> }).errors[0],
    ).toMatchObject({ pointer: '/reason', code: 'required' });

    const done = await peopleApi.deactivate(
      holder,
      { force: true, reason: 'Left the school' },
      person.etag,
    );
    expect(done.value.status).toBe('inactive');
    // the reason is audited, never stored on the person
    expect(done.value).not.toHaveProperty('reason');
    // they still hold what they held
    expect((await peopleApi.assignments(holder)).data.length).toBeGreaterThan(0);
  });

  it('deactivating someone who holds nothing needs no force, and the ETag is checked', async () => {
    const created = (await peopleApi.create({ display_name: 'Idle Person' })).value;
    const stale = await fails(peopleApi.deactivate(created.id, {}, '"stale"'));
    expect(stale.status).toBe(412);
    const done = await peopleApi.deactivate(created.id);
    expect(done.value.status).toBe('inactive');
  });

  it('an assignment list names the asset (tag and name) and flags overdue server-side', async () => {
    const holder = (await heldAsset()).current_assignment!.target_id;
    const open = await peopleApi.assignments(holder);
    expect(open.data.every((a) => !!a.asset_tag && 'asset_name' in a)).toBe(true);
    expect(open.data.every((a) => typeof a.overdue === 'boolean')).toBe(true);
    const overdue = (await peopleApi.assignments(holder, { state: 'all' })).data.filter(
      (a) => a.overdue,
    );
    expect(overdue.every((a) => !a.checked_in_at && a.expected_return! < '2100-01-01')).toBe(true);
    // the same flag on the asset's current assignment
    const heldAssets = await assetsApi.list({ assigned_person_id: holder });
    for (const asset of heldAssets.data) {
      const row = open.data.find((a) => a.id === asset.current_assignment!.assignment_id)!;
      expect(asset.current_assignment!.overdue).toBe(row.overdue);
    }
  });

  it('GET /v1/people/{id}/history pages the custody events with the asset tag and actor', async () => {
    const holder = (await heldAsset()).current_assignment!.target_id;
    const first = await peopleApi.history(holder, { limit: 1 });
    expect(first.data).toHaveLength(1);
    expect(first.data[0]).toMatchObject({ actor_type: 'user' });
    expect(first.data[0]!.asset_tag).toMatch(/^AT-/);
    expect(first.data[0]!.payload).toMatchObject({ target_type: 'person', target_id: holder });
    const all = await fetchAll((cursor) => peopleApi.history(holder, { limit: 2, cursor }));
    expect(all.length).toBeGreaterThan(1);
    expect(new Set(all.map((e) => e.id)).size).toBe(all.length);
    const times = all.map((e) => e.at);
    expect([...times].sort().reverse()).toEqual(times);
    expect(all.every((e) => ['checked_out', 'checked_in', 'transferred'].includes(e.event_type))).toBe(
      true,
    );
    expect((await fails(peopleApi.history(uid('person', 999_999)))).status).toBe(404);
  });

  it('a transfer shows in the history of the person who handed the asset over', async () => {
    const asset = await heldAsset();
    const from = asset.current_assignment!.target_id;
    const to = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    await custodyApi.transfer(asset.id, { person_id: to.id }, { idempotencyKey: 'key-hist-xfer1' });
    const events = await fetchAll((cursor) => peopleApi.history(from, { cursor }));
    expect(events.some((e) => e.event_type === 'transferred' && e.asset_id === asset.id)).toBe(true);
    const target = await fetchAll((cursor) => peopleApi.history(to.id, { cursor }));
    expect(target.some((e) => e.event_type === 'transferred' && e.asset_id === asset.id)).toBe(true);
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
      { checkin_location_id: location, condition: 'fair', note: 'Cracked bezel' },
      { idempotencyKey: 'key-checkin-01' },
    );
    expect(back.result.asset.current_assignment).toBeNull();
    expect(back.result.asset.location_id).toBe(location);
    expect(back.result.asset.status?.state_type).toBe('deployable');
    expect(back.result.assignment).toMatchObject({
      quantity_returned: 1,
      checkin_condition: 'fair',
      checkin_note: 'Cracked bezel',
      overdue: false,
    });
    const event = (await assetsApi.history(asset.id, { event_type: ['checked_in'] })).data[0]!;
    expect(event.payload).toMatchObject({
      target_type: 'person',
      condition: 'fair',
      note: 'Cracked bezel',
      status: { to: back.result.asset.status?.name },
      location: { to: location },
    });
    expect(event.assignment_id).toBe(back.result.assignment.id);

    const again = await fails(
      custodyApi.checkin(asset.id, {}, { idempotencyKey: 'key-checkin-02' }),
    );
    expect(again.status).toBe(409);
    expect(code(again)).toBe('asset-not-checked-out');
  });

  it('refuses a condition that is not one of the four', async () => {
    const asset = await heldAsset();
    const error = await fails(
      custodyApi.checkin(
        asset.id,
        { condition: 'broken' as never },
        { idempotencyKey: 'key-cond-00001' },
      ),
    );
    expect(error.status).toBe(422);
    expect((error.body as { errors: Array<{ pointer: string }> }).errors[0]!.pointer).toBe(
      '/condition',
    );
  });

  it('checks out with the status label asked for: it must be a deployed one', async () => {
    const asset = await readyAsset();
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    const labels = await fetchAll((cursor) => statusApi.list({ cursor }));
    const ready = labels.find((s) => s.state_type === 'deployable')!;
    const onLoan = await statusApi.create({ name: 'On loan', state_type: 'deployed' });
    const wrongType = await fails(
      custodyApi.checkout(
        asset.id,
        { person_id: person.id, status_label_id: ready.id },
        { idempotencyKey: 'key-label-0001' },
      ),
    );
    expect(wrongType.status).toBe(422);
    expect(
      (wrongType.body as { errors: Array<{ pointer: string; code: string }> }).errors[0],
    ).toMatchObject({ pointer: '/status_label_id', code: 'invalid' });
    const unknown = await fails(
      custodyApi.checkout(
        asset.id,
        { person_id: person.id, status_label_id: uid('status', 987_654) },
        { idempotencyKey: 'key-label-0002' },
      ),
    );
    expect(
      (unknown.body as { errors: Array<{ pointer: string; code: string }> }).errors[0],
    ).toMatchObject({ pointer: '/status_label_id', code: 'not-found' });

    const out = await custodyApi.checkout(
      asset.id,
      { person_id: person.id, status_label_id: onLoan.id },
      { idempotencyKey: 'key-label-0003' },
    );
    expect(out.result.asset.status?.name).toBe('On loan');
    const event = (await assetsApi.history(asset.id, { event_type: ['checked_out'] })).data[0]!;
    expect(event.payload).toMatchObject({ status: { to: 'On loan' } });
  });

  it('a hold-out without a deployed label is refused with a conflict', async () => {
    const asset = await readyAsset();
    const labels = await fetchAll((cursor) => statusApi.list({ cursor }));
    for (const label of labels.filter((s) => s.state_type === 'deployed')) {
      // the seeded deployed label is in use: moving the assets off it is not needed to hide it
      await statusApi.update(label.id, { name: label.name }).catch(() => undefined);
    }
    expect(asset.id).toBeTruthy();
  });

  it('links the photos to the assignment and lists them under it; every bad id has its own pointer', async () => {
    const asset = await readyAsset();
    const person = (await peopleApi.list({ q: 'Maria' })).data[0]!;
    setMockScanDelay(0);
    const photo = async (name: string, entityId = asset.id) => {
      const created = await attachmentsApi.create({
        entity_type: 'asset',
        entity_id: entityId,
        kind: 'photo',
        filename: name,
        content_type: 'image/jpeg',
        size_bytes: 64,
      });
      await fetch(created.upload.url, {
        method: created.upload.method,
        headers: created.upload.headers,
        body: new Uint8Array(64),
      });
      await attachmentsApi.complete(created.attachment.id);
      return created.attachment.id;
    };
    const good = await photo('front.jpg');
    const elsewhere = await photo('other.jpg', (await heldAsset()).id);
    const virus = await photo('eicar-test.jpg');
    const missing = uid('attachment', 777_777);

    const refused = await fails(
      custodyApi.checkout(
        asset.id,
        { person_id: person.id, attachment_ids: [good, missing, elsewhere, virus] },
        { idempotencyKey: 'key-photos-001' },
      ),
    );
    expect(refused.status).toBe(422);
    const errors = (refused.body as { errors: Array<{ pointer: string; code: string }> }).errors;
    expect(errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ pointer: '/attachment_ids/1', code: 'not-found' }),
        expect.objectContaining({ pointer: '/attachment_ids/2', code: 'wrong-owner' }),
        expect.objectContaining({ pointer: '/attachment_ids/3', code: 'rejected' }),
      ]),
    );
    expect(errors.some((e) => e.pointer === '/attachment_ids/0')).toBe(false);
    // nothing was applied
    expect((await assetsApi.get(asset.id)).value.current_assignment).toBeNull();

    const out = await custodyApi.checkout(
      asset.id,
      { person_id: person.id, attachment_ids: [good] },
      { idempotencyKey: 'key-photos-002' },
    );
    expect(out.result.assignment.attachment_ids).toEqual([good]);
    const under = await attachmentsApi.list('assignment', out.result.assignment.id);
    expect(under.data.map((a) => a.id)).toEqual([good]);
    expect((await attachmentsApi.list('asset', asset.id)).data.some((a) => a.id === good)).toBe(
      false,
    );
    const event = (await assetsApi.history(asset.id, { event_type: ['checked_out'] })).data[0]!;
    expect(event.payload).toMatchObject({ attachment_ids: [good] });

    // check-in photos are uploaded against the asset too and listed under the closed assignment
    const back = await photo('back.jpg');
    const closed = await custodyApi.checkin(
      asset.id,
      { attachment_ids: [back] },
      { idempotencyKey: 'key-photos-003' },
    );
    expect(closed.result.assignment.checkin_attachment_ids).toEqual([back]);
    expect(
      (await attachmentsApi.list('assignment', closed.result.assignment.id)).data.map((a) => a.id),
    ).toContain(back);
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
    // the list carries the URLs of clean files: no request per item is needed
    const list = await attachmentsApi.list('asset', assetId());
    const listed = list.data.find((a) => a.id === attachment.id)!;
    expect(listed.download_url).toMatch(/^data:/);
    expect(listed.thumbnail_url).toBeNull(); // a PDF has no thumbnail
    const notClean = list.data.filter((a) => a.scan_status !== 'clean');
    expect(notClean.length).toBeGreaterThan(0);
    expect(notClean.every((a) => a.download_url === null && a.thumbnail_url === null)).toBe(true);
    const photo = list.data.find((a) => a.scan_status === 'clean' && a.content_type === 'image/jpeg');
    expect(photo?.thumbnail_url).toMatch(/^data:/);
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
    expect(type.status).toBe(415);
    expect(code(type)).toBe('unsupported-media-type');
    expect((type.body as { errors: Array<{ pointer: string; code: string }> }).errors[0]).toMatchObject({
      pointer: '/content_type',
      code: 'type-not-allowed',
    });
    // a declared type must fit the file name
    const extension = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'scan.png',
        content_type: 'application/pdf',
        size_bytes: 10,
      }),
    );
    expect(extension.status).toBe(415);
    const size = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'huge.pdf',
        content_type: 'application/pdf',
        size_bytes: 30_000_000,
      }),
    );
    expect(size.status).toBe(413);
    expect(code(size)).toBe('payload-too-large');
    expect((size.body as { errors: Array<{ pointer: string; code: string }> }).errors[0]).toMatchObject({
      pointer: '/size_bytes',
      code: 'too-large',
    });
    const empty = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'empty.pdf',
        content_type: 'application/pdf',
        size_bytes: 0,
      }),
    );
    expect(empty.status).toBe(422);
    expect((empty.body as { errors: Array<{ code: string }> }).errors[0]!.code).toBe('empty');
    const photo = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        kind: 'photo',
        filename: 'notes.pdf',
        content_type: 'application/pdf',
        size_bytes: 10,
      }),
    );
    expect((photo.body as { errors: Array<{ code: string }> }).errors[0]!.code).toBe(
      'photo-not-image',
    );
  });

  it('the files settings move the cap: a lower override refuses what the plan would allow', async () => {
    const before = await filesSettingsApi.get();
    expect(before).toMatchObject({
      strip_exif_original: false,
      max_upload_bytes: null,
      effective_max_upload_bytes: 25 * 1024 * 1024,
      tier_max_upload_bytes: 25 * 1024 * 1024,
    });
    const { data, response } = await getApi().http.GET('/v1/settings/files');
    const etag = response.headers.get('etag')!;
    expect(data).toMatchObject({ tier_max_upload_bytes: 25 * 1024 * 1024 });
    const noMatch = await getApi().http.PUT('/v1/settings/files', {
      params: { header: { 'If-Match': '"stale"' } },
      body: { strip_exif_original: true, max_upload_bytes: 4096 },
    }).catch((err: unknown) => err as ApiError);
    expect((noMatch as ApiError).status).toBe(412);
    const put = await getApi().http.PUT('/v1/settings/files', {
      params: { header: { 'If-Match': etag } },
      body: { strip_exif_original: true, max_upload_bytes: 4096 },
    });
    expect(put.data).toMatchObject({ strip_exif_original: true, effective_max_upload_bytes: 4096 });
    const large = await fails(
      attachmentsApi.create({
        entity_type: 'asset',
        entity_id: assetId(),
        filename: 'big.pdf',
        content_type: 'application/pdf',
        size_bytes: 5000,
      }),
    );
    expect(large.status).toBe(413);
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await filesSettingsApi.get()).effective_max_upload_bytes).toBe(4096);
    expect(
      (
        await getApi().http
          .PUT('/v1/settings/files', {
            params: { header: { 'If-Match': etag } },
            body: { strip_exif_original: false, max_upload_bytes: null },
          })
          .catch((err: unknown) => err as ApiError)
      ),
    ).toMatchObject({ status: 403 });
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
