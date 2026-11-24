import { ApiError } from '@assettracker/api-client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getApi } from '@/lib/api';
import { exportsApi } from '@/lib/exports/api';
import { labelsApi } from '@/lib/labels/api';
import { notificationsApi } from '@/lib/notifications/api';
import {
  assetsApi,
  categoriesApi,
  custodyApi,
  fetchAll,
  peopleApi,
  statusApi,
} from '@/lib/registry/api';
import { repairsApi } from '@/lib/repairs/api';
import { accessoriesApi, consumablesApi } from '@/lib/stock/api';
import { savedViewsApi } from '@/lib/views/api';
import { seedSession } from '@/test/render';
import { MOCK_ACCOUNTS } from './fixtures';
import { setMockExportDelay, setMockLabelDelay, setMockLabelFailure } from './w2-misc-handlers';

/**
 * The M2 wave 2 mock endpoints mirror the real API (docs/engineering/openapi.yaml and the services
 * under apps/api/src), because the screens and Playwright are written against them: derived
 * quantities, refusals (over-checkout, negative stock, checked-out assets), idempotent replays,
 * permissions, problem codes and the shape of every answer.
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
const fieldPointers = (error: ApiError) =>
  ((error.body as { errors?: Array<{ pointer: string }> }).errors ?? []).map((e) => e.pointer);

async function firstPerson() {
  return (await peopleApi.list({ limit: 1 })).data[0]!;
}

describe('mock accessories', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('derives checked out and available from the open hand-outs', async () => {
    const list = await accessoriesApi.list({ sort: ['name'] });
    const charger = list.data.find((a) => a.name === 'USB-C charger 65 W')!;
    // 8 + (4 - 1 returned) hand-outs are open
    expect(charger).toMatchObject({
      qty_total: 42,
      qty_checked_out: 11,
      qty_available: 31,
      low_stock: false,
    });
    // an opaque QR payload, never an id
    expect(charger.label_code).toMatch(/^[0-9a-f]{32}$/);
    const dock = list.data.find((a) => a.name === 'Docking station')!;
    expect(dock).toMatchObject({ qty_available: 0, low_stock: true });
    // no minimum, no alert
    expect(list.data.find((a) => a.name === 'Laptop sleeve 14 in')).toMatchObject({
      min_qty: 0,
      low_stock: false,
    });
  });

  it('low_stock lists what is at or below the minimum', async () => {
    const low = await accessoriesApi.list({ low_stock: true });
    expect(low.data.map((a) => a.name).sort()).toEqual(['Docking station', 'HDMI cable 2 m']);
  });

  it('refuses a check-out of more than is available (409) and leaves the stock alone', async () => {
    const hdmi = (await accessoriesApi.list({ q: 'HDMI' })).data[0]!;
    const person = await firstPerson();
    const error = await fails(
      accessoriesApi.checkout(hdmi.id, { person_id: person.id, quantity: 4 }, 'key-over-0001'),
    );
    expect(error.status).toBe(409);
    expect(code(error)).toBe('insufficient-stock');
    expect((await accessoriesApi.get(hdmi.id)).value.qty_available).toBe(3);
  });

  it('checks units out and takes them back in parts; the last return closes the assignment', async () => {
    const sleeve = (await accessoriesApi.list({ q: 'sleeve' })).data[0]!;
    const person = await firstPerson();
    const out = await accessoriesApi.checkout(
      sleeve.id,
      { person_id: person.id, quantity: 5, expected_return: '2030-01-01' },
      'key-out-sleeve-1',
    );
    expect(out).toMatchObject({ quantity: 5, quantity_returned: 0, accessory_id: sleeve.id });
    expect((await accessoriesApi.get(sleeve.id)).value.qty_available).toBe(10);

    const partial = await accessoriesApi.checkin(
      sleeve.id,
      { assignment_id: out.id, quantity: 2 },
      'key-in-sleeve-1',
    );
    expect(partial).toMatchObject({ quantity_returned: 2, checked_in_at: null });
    expect((await accessoriesApi.get(sleeve.id)).value.qty_available).toBe(12);

    const tooMany = await fails(
      accessoriesApi.checkin(sleeve.id, { assignment_id: out.id, quantity: 4 }, 'key-in-sleeve-2'),
    );
    expect(tooMany.status).toBe(422);
    expect(fieldPointers(tooMany)).toEqual(['/quantity']);

    const done = await accessoriesApi.checkin(
      sleeve.id,
      { assignment_id: out.id },
      'key-in-sleeve-3',
    );
    expect(done.quantity_returned).toBe(5);
    expect(done.checked_in_at).not.toBeNull();
    const open = await accessoriesApi.assignments(sleeve.id, { state: 'open' });
    expect(open.data.some((a) => a.id === out.id)).toBe(false);
    const closed = await accessoriesApi.assignments(sleeve.id, { state: 'closed' });
    expect(closed.data.some((a) => a.id === out.id)).toBe(true);
  });

  it('names who holds the units (target_name) and the accessory (accessory_name) in the assignment list', async () => {
    const charger = (await accessoriesApi.list({ q: 'charger' })).data[0]!;
    const open = await accessoriesApi.assignments(charger.id, { state: 'open' });
    expect(open.data.length).toBeGreaterThan(1);
    for (const assignment of open.data) {
      expect(assignment.accessory_name).toBe(charger.name);
      expect(assignment.target_name).toBeTruthy();
    }
    const hdmi = (await accessoriesApi.list({ q: 'HDMI' })).data[0]!;
    const toRoom = (await accessoriesApi.assignments(hdmi.id, { state: 'open' })).data.find(
      (a) => a.location_id,
    )!;
    expect(toRoom.target_name).toBe('Room 101');
  });

  it('replays a request with the same Idempotency-Key and refuses the key with another body', async () => {
    const sleeve = (await accessoriesApi.list({ q: 'sleeve' })).data[0]!;
    const person = await firstPerson();
    const first = await accessoriesApi.checkout(
      sleeve.id,
      { person_id: person.id, quantity: 1 },
      'key-replay-0001',
    );
    const again = await accessoriesApi.checkout(
      sleeve.id,
      { person_id: person.id, quantity: 1 },
      'key-replay-0001',
    );
    expect(again.id).toBe(first.id);
    expect((await accessoriesApi.get(sleeve.id)).value.qty_checked_out).toBe(1);
    const reuse = await fails(
      accessoriesApi.checkout(sleeve.id, { person_id: person.id, quantity: 2 }, 'key-replay-0001'),
    );
    expect(code(reuse)).toBe('idempotency-key-reuse');
  });

  it('requires exactly one target and a real person', async () => {
    const sleeve = (await accessoriesApi.list({ q: 'sleeve' })).data[0]!;
    const none = await fails(
      accessoriesApi.checkout(sleeve.id, { quantity: 1 }, 'key-target-0001'),
    );
    expect(none.status).toBe(422);
    const unknown = await fails(
      accessoriesApi.checkout(
        sleeve.id,
        { person_id: '0190a6b2-0011-7000-8000-999999999999', quantity: 1 },
        'key-target-0002',
      ),
    );
    expect(fieldPointers(unknown)).toEqual(['/person_id']);
  });

  it('creates with a category of the right kind, refuses a lower total than is out, archives', async () => {
    const accessoryCategory = (await categoriesApi.list({ kind: 'accessory' })).data[0]!;
    const assetCategory = (await categoriesApi.list({ kind: 'asset' })).data[0]!;
    const wrongKind = await fails(
      accessoriesApi.create({ name: 'Mouse', category_id: assetCategory.id, qty_total: 3 }),
    );
    expect(fieldPointers(wrongKind)).toEqual(['/category_id']);

    const created = await accessoriesApi.create({
      name: 'Mouse',
      category_id: accessoryCategory.id,
      qty_total: 3,
      min_qty: 1,
    });
    expect(created.value).toMatchObject({ qty_total: 3, qty_available: 3, qty_checked_out: 0 });
    expect(created.etag).toBeTruthy();

    const person = await firstPerson();
    await accessoriesApi.checkout(
      created.value.id,
      { person_id: person.id, quantity: 2 },
      'key-mouse-0001',
    );
    const below = await fails(
      accessoriesApi.update(created.value.id, { qty_total: 1 }, created.etag),
    );
    expect(fieldPointers(below)).toEqual(['/qty_total']);
    const inUse = await fails(accessoriesApi.archive(created.value.id));
    expect(inUse.status).toBe(409);
    expect((inUse.body as { usage?: Record<string, number> }).usage).toEqual({
      open_assignments: 1,
    });
  });

  it('answers 428 without If-Match semantics through the client and 412 for a stale version', async () => {
    const hdmi = (await accessoriesApi.list({ q: 'HDMI' })).data[0]!;
    const loaded = await accessoriesApi.get(hdmi.id);
    await accessoriesApi.update(hdmi.id, { min_qty: 6 }, loaded.etag);
    const stale = await fails(accessoriesApi.update(hdmi.id, { min_qty: 7 }, loaded.etag));
    expect(stale.status).toBe(412);
  });

  it('is permission checked: a viewer reads but cannot check out or create', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const list = await accessoriesApi.list();
    expect(list.data.length).toBeGreaterThan(0);
    const person = await firstPerson();
    const out = await fails(
      accessoriesApi.checkout(
        list.data[0]!.id,
        { person_id: person.id, quantity: 1 },
        'key-view-0001',
      ),
    );
    expect(out.status).toBe(403);
    const create = await fails(
      accessoriesApi.create({ name: 'x', category_id: list.data[0]!.category_id, qty_total: 1 }),
    );
    expect(create.status).toBe(403);
  });
});

describe('mock consumables', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists the stock on hand, the low ones, and the ledger newest first', async () => {
    const all = await consumablesApi.list();
    expect(all.data.map((c) => [c.name, c.qty_on_hand])).toEqual([
      ['AA batteries', 0],
      ['Printer paper A4', 24],
      ['Toner HP 26A', 2],
      ['Whiteboard markers', 60],
    ]);
    const low = await consumablesApi.list({ low_stock: true });
    expect(low.data.map((c) => c.name)).toEqual(['AA batteries', 'Toner HP 26A']);
    expect(all.data.find((c) => c.name === 'Printer paper A4')).toMatchObject({
      low_stock: false,
      label_code: expect.stringMatching(/^[0-9a-f]{32}$/),
    });

    const toner = all.data.find((c) => c.name === 'Toner HP 26A')!;
    const ledger = await consumablesApi.movements(toner.id);
    expect(ledger.data.map((m) => [m.reason, m.qty_delta, m.balance_after])).toEqual([
      ['issue', -2, 2],
      ['issue', -2, 4],
      ['receive', 6, 6],
    ]);
    const issues = await consumablesApi.movements(toner.id, { reason: ['receive'] });
    expect(issues.data).toHaveLength(1);
  });

  it('refuses stock that would go negative (409) and records receive, issue and adjust', async () => {
    const paper = (await consumablesApi.list({ q: 'paper' })).data[0]!;
    const refused = await fails(
      consumablesApi.addMovement(paper.id, { qty_delta: -25, reason: 'issue' }, 'key-neg-0000001'),
    );
    expect(refused.status).toBe(409);
    expect(code(refused)).toBe('insufficient-stock');
    expect((await consumablesApi.get(paper.id)).value.qty_on_hand).toBe(24);

    const received = await consumablesApi.addMovement(
      paper.id,
      { qty_delta: 6, reason: 'receive', note: 'Delivery' },
      'key-rcv-0000001',
    );
    expect(received).toMatchObject({ balance_after: 30, qty_delta: 6, note: 'Delivery' });
    const issued = await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -30, reason: 'adjust', note: 'Stock count' },
      'key-adj-0000001',
    );
    expect(issued.balance_after).toBe(0);
    const zero = await fails(
      consumablesApi.addMovement(
        paper.id,
        { qty_delta: 0, reason: 'adjust', note: 'Nothing to change' },
        'key-zero-000001',
      ),
    );
    expect(fieldPointers(zero)).toEqual(['/qty_delta']);
  });

  it('checks the sign and the note a reason needs, like the API', async () => {
    const paper = (await consumablesApi.list({ q: 'paper' })).data[0]!;
    const send = (body: Parameters<typeof consumablesApi.addMovement>[1], key: string) =>
      fails(consumablesApi.addMovement(paper.id, body, key));
    expect(
      fieldPointers(await send({ qty_delta: -2, reason: 'receive' }, 'key-sign-000001')),
    ).toEqual(['/qty_delta']);
    expect(fieldPointers(await send({ qty_delta: 2, reason: 'issue' }, 'key-sign-000002'))).toEqual(
      ['/qty_delta'],
    );
    expect(
      fieldPointers(await send({ qty_delta: 2, reason: 'adjust' }, 'key-sign-000003')),
    ).toEqual(['/note']);
  });

  it('replays an identical movement instead of applying it twice', async () => {
    const markers = (await consumablesApi.list({ q: 'markers' })).data[0]!;
    await consumablesApi.addMovement(
      markers.id,
      { qty_delta: -5, reason: 'issue' },
      'key-dup-0000001',
    );
    const replay = await consumablesApi.addMovement(
      markers.id,
      { qty_delta: -5, reason: 'issue' },
      'key-dup-0000001',
    );
    expect(replay.balance_after).toBe(55);
    expect((await consumablesApi.get(markers.id)).value.qty_on_hand).toBe(55);
  });

  it('alerts once per crossing below the minimum, not per movement', async () => {
    const paper = (await consumablesApi.list({ q: 'paper' })).data[0]!;
    const before = await notificationsApi.unreadCount();
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -15, reason: 'issue' },
      'key-low-0000001',
    );
    expect(await notificationsApi.unreadCount()).toBe(before + 1);
    const [alert] = (await notificationsApi.list({ limit: 1 })).data;
    expect(alert).toMatchObject({
      type: 'consumable.low_stock',
      entity_type: 'consumable',
      entity_id: paper.id,
    });
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -1, reason: 'issue' },
      'key-low-0000002',
    );
    expect(await notificationsApi.unreadCount()).toBe(before + 1);
  });

  it('creates with an initial quantity recorded as a first receive', async () => {
    const category = (await categoriesApi.list({ kind: 'consumable' })).data[0]!;
    const created = await consumablesApi.create({
      name: 'Cable ties',
      category_id: category.id,
      unit: 'bag',
      min_qty: 2,
      initial_qty: 9,
    });
    expect(created.value.qty_on_hand).toBe(9);
    const ledger = await consumablesApi.movements(created.value.id);
    expect(ledger.data).toHaveLength(1);
    expect(ledger.data[0]).toMatchObject({ reason: 'receive', qty_delta: 9, balance_after: 9 });
  });
});

describe('mock repairs', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  async function readyAsset() {
    return (
      await assetsApi.list({
        state_type: ['deployable'],
        assigned: false,
        sort: ['-asset_tag'],
        limit: 1,
      })
    ).data[0]!;
  }

  it('lists open repairs with the asset tag and the filters', async () => {
    const open = await repairsApi.list({ status: ['open', 'in_progress'], include_total: true });
    expect(open.page.total).toBeGreaterThan(0);
    expect(open.data.every((r) => !!r.asset_tag)).toBe(true);
    const done = await repairsApi.list({ status: ['completed'] });
    expect(done.data.length).toBeGreaterThan(0);
    const none = await repairsApi.list({ kind: ['inspection'] });
    expect(none.data).toHaveLength(0);
    const byAsset = await repairsApi.list({ asset_id: open.data[0]!.asset_id });
    expect(byAsset.data.every((r) => r.asset_id === open.data[0]!.asset_id)).toBe(true);
  });

  it('opening a repair moves the asset to the chosen status, closing restores it, both write history', async () => {
    const asset = await readyAsset();
    const statuses = await fetchAll((cursor) => statusApi.list({ limit: 50, cursor }));
    const inRepair = statuses.find((s) => s.state_type === 'undeployable')!;
    const created = await repairsApi.create({
      asset_id: asset.id,
      title: 'Cracked screen',
      set_status_id: inRepair.id,
      cost: { amount_minor: 6400, currency: 'USD' },
    });
    expect(created.value).toMatchObject({
      status: 'open',
      asset_tag: asset.asset_tag,
      set_status_id: inRepair.id,
    });
    expect((await assetsApi.get(asset.id)).value.status_id).toBe(inRepair.id);

    const done = await repairsApi.complete(
      created.value.id,
      { resolution_notes: 'New screen', cost: { amount_minor: 7000, currency: 'USD' } },
      created.etag,
    );
    expect(done.value).toMatchObject({ status: 'completed', resolution_notes: 'New screen' });
    expect(done.value.cost?.amount_minor).toBe(7000);
    expect((await assetsApi.get(asset.id)).value.status_id).toBe(asset.status_id);
    const history = await assetsApi.history(asset.id);
    expect(history.data.map((e) => e.event_type)).toEqual(
      expect.arrayContaining(['repair_opened', 'repair_completed']),
    );
    const again = await fails(repairsApi.complete(created.value.id, {}, done.etag));
    expect(again.status).toBe(409);
  });

  it('a repair logged with the not-deployable status the asset already has adopts it and gives the asset back as ready (like the API)', async () => {
    await repairsApi.list({ limit: 1 }); // the mock seeds its repairs from the registry on first read
    const asset = await readyAsset();
    const statuses = await fetchAll((cursor) => statusApi.list({ limit: 50, cursor }));
    const inRepair = statuses.find((s) => s.state_type === 'undeployable')!;
    const ready = statuses.find((s) => s.state_type === 'deployable' && s.is_default)!;
    const current = await assetsApi.get(asset.id);
    await assetsApi.update(asset.id, { status_id: inRepair.id }, current.etag);

    const first = await repairsApi.create({
      asset_id: asset.id,
      title: 'Adopt',
      set_status_id: inRepair.id,
    });
    expect(first.value).toMatchObject({
      set_status_id: inRepair.id,
      restore_status_id: ready.id,
    });
    expect((await assetsApi.get(asset.id)).value.status_id).toBe(inRepair.id);
    // while it holds the status a second record does not take it over
    const second = await repairsApi.create({
      asset_id: asset.id,
      title: 'Note',
      set_status_id: inRepair.id,
    });
    expect(second.value).toMatchObject({ set_status_id: null, restore_status_id: null });

    await repairsApi.complete(first.value.id, {}, first.etag);
    expect((await assetsApi.get(asset.id)).value.status_id).toBe(ready.id);
  });

  it('refuses a repair for an asset that is checked out', async () => {
    const held = (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 })).data[0]!;
    const error = await fails(repairsApi.create({ asset_id: held.id, title: 'Broken hinge' }));
    expect(error.status).toBe(409);
    expect(code(error)).toBe('asset-already-checked-out');
  });

  it('names the asset and the vendor in a repair (asset_tag, asset_name, vendor_name)', async () => {
    const asset = await readyAsset();
    const vendor = (await repairsApi.list({ limit: 50 })).data.find((r) => r.vendor_id)!;
    expect(vendor.vendor_name).toBeTruthy();
    const created = await repairsApi.create({ asset_id: asset.id, title: 'Fan noise' });
    expect(created.value).toMatchObject({
      asset_tag: asset.asset_tag,
      asset_name: asset.name,
      vendor_name: null,
      set_status_id: null,
    });
  });

  it('seeds one open repair, moving the status, for every asset in the not-deployable status (like the demo seed)', async () => {
    const statuses = (await statusApi.list({ limit: 100 })).data;
    const inRepair = statuses.find((s) => s.state_type === 'undeployable')!;
    const assets = (await assetsApi.list({ status_id: [inRepair.id], limit: 200 })).data;
    expect(assets.length).toBeGreaterThan(3);
    const open = (await repairsApi.list({ status: ['open', 'in_progress'], limit: 200 })).data;
    expect(open.map((r) => r.asset_id).sort()).toEqual(assets.map((a) => a.id).sort());
    expect(open.every((r) => r.set_status_id === inRepair.id)).toBe(true);
    expect(open.some((r) => r.status === 'in_progress')).toBe(true);
  });

  it('totals the repair cost of an asset per currency, without the cancelled ones', async () => {
    const asset = await readyAsset();
    const empty = await repairsApi.summary(asset.id);
    expect(empty).toEqual({ asset_id: asset.id, open_count: 0, total_count: 0, total_cost: [] });
    await repairsApi.create({
      asset_id: asset.id,
      title: 'Screen',
      cost: { amount_minor: 6400, currency: 'USD' },
    });
    await repairsApi.create({
      asset_id: asset.id,
      title: 'Battery',
      cost: { amount_minor: 2200, currency: 'USD' },
    });
    await repairsApi.create({
      asset_id: asset.id,
      title: 'Dock',
      cost: { amount_minor: 100, currency: 'EUR' },
    });
    const dropped = await repairsApi.create({
      asset_id: asset.id,
      title: 'Cancelled one',
      cost: { amount_minor: 9900, currency: 'USD' },
    });
    await repairsApi.update(dropped.value.id, { status: 'cancelled' }, dropped.etag);
    const summary = await repairsApi.summary(asset.id);
    expect(summary).toMatchObject({ open_count: 3, total_count: 3 });
    expect(summary.total_cost).toEqual([
      { amount_minor: 8600, currency: 'USD' },
      { amount_minor: 100, currency: 'EUR' },
    ]);
    const missing = await fails(repairsApi.summary('0190a6b2-0008-7000-8000-999999999999'));
    expect(missing.status).toBe(404);
  });

  it('cancelling restores the asset and a closed repair cannot be changed again', async () => {
    const asset = await readyAsset();
    const statuses = await fetchAll((cursor) => statusApi.list({ limit: 50, cursor }));
    const inRepair = statuses.find((s) => s.state_type === 'undeployable')!;
    const created = await repairsApi.create({
      asset_id: asset.id,
      title: 'Check the fan',
      set_status_id: inRepair.id,
    });
    const started = await repairsApi.update(
      created.value.id,
      { status: 'in_progress' },
      created.etag,
    );
    expect(started.value.started_at).not.toBeNull();
    const cancelled = await repairsApi.update(
      created.value.id,
      { status: 'cancelled' },
      started.etag,
    );
    expect(cancelled.value.status).toBe('cancelled');
    expect((await assetsApi.get(asset.id)).value.status_id).toBe(asset.status_id);
    const reopen = await fails(
      repairsApi.update(created.value.id, { status: 'open' }, cancelled.etag),
    );
    expect(reopen.status).toBe(409);
  });

  it('validates the body and needs repair:manage to write', async () => {
    const asset = await readyAsset();
    const invalid = await fails(
      repairsApi.create({
        asset_id: asset.id,
        title: '',
        cost: { amount_minor: -1, currency: 'usd' },
      }),
    );
    expect(fieldPointers(invalid).sort()).toEqual(['/cost', '/title']);
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await repairsApi.list()).data.length).toBeGreaterThan(0);
    const denied = await fails(repairsApi.create({ asset_id: asset.id, title: 'Nope' }));
    expect(denied.status).toBe(403);
  });

  it('keeps a checked-out asset check-out-able only after the repair is closed', async () => {
    const asset = await readyAsset();
    const statuses = await fetchAll((cursor) => statusApi.list({ limit: 50, cursor }));
    const inRepair = statuses.find((s) => s.state_type === 'undeployable')!;
    const person = await firstPerson();
    const created = await repairsApi.create({
      asset_id: asset.id,
      title: 'Battery',
      set_status_id: inRepair.id,
    });
    const blocked = await fails(
      custodyApi.checkout(
        asset.id,
        { person_id: person.id },
        { idempotencyKey: 'key-blocked-0001' },
      ),
    );
    expect(code(blocked)).toBe('asset-not-deployable');
    await repairsApi.complete(created.value.id, {}, created.etag);
    await custodyApi.checkout(
      asset.id,
      { person_id: person.id },
      { idempotencyKey: 'key-blocked-0002' },
    );
  });
});

describe('mock labels', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockLabelDelay(0);
  });
  afterEach(() => {
    setMockLabelDelay(1200);
    setMockLabelFailure(undefined);
  });

  async function someAssets(limit: number) {
    return (await assetsApi.list({ limit, sort: ['asset_tag'] })).data;
  }

  it('lists the six fixed templates with their geometry and calibration', async () => {
    const templates = await labelsApi.templates();
    expect(templates.map((t) => [t.key, t.slots])).toEqual([
      ['letter-30up-qr', 30],
      ['a4-21up-qr', 21],
      ['a4-24up-qr', 24],
      ['letter-10up-qr', 10],
      ['single-50x25-qr', 1],
      ['thermal-2x1in-qr', 1],
    ]);
    expect(templates[0]).toMatchObject({
      cols: 3,
      rows: 10,
      margin_top_mm: 12.7,
      gap_x_mm: 3.18,
      offset_x_mm: 0,
      offset_y_mm: 0,
      code_type: 'qr',
      fields: ['asset_tag', 'name'],
      is_system: true,
    });
    expect(templates[3]!.code_type).toBe('qr_and_code128');
  });

  it('answers 202 with a queued batch and a Location, then renders it when the worker is done', async () => {
    const assets = await someAssets(3);
    const { data, response } = await getApi().http.POST('/v1/labels/batches', {
      params: { header: { 'Idempotency-Key': 'key-batch-00001' } },
      body: {
        template_key: 'letter-30up-qr',
        asset_ids: assets.map((a) => a.id),
        start_position: 7,
        codes: ['qr', 'code128'],
      },
    });
    expect(response.status).toBe(202);
    expect(data).toMatchObject({
      status: 'queued',
      source: 'asset_ids',
      asset_count: 3,
      copies: 1,
      label_count: 3,
      start_position: 7,
      codes: ['qr', 'code128'],
      fields: ['asset_tag', 'name'],
      outlines: false,
      page_count: null,
      filename: null,
      download_url: null,
      error: null,
    });
    expect(response.headers.get('location')).toBe(`/v1/labels/batches/${data!.id}`);

    const ready = await labelsApi.batch(data!.id);
    expect(ready).toMatchObject({ status: 'ready', page_count: 1 });
    expect(ready.filename).toMatch(/\.pdf$/);
    expect(ready.download_url).toMatch(/\/mock-storage\/labels\//);
    expect(ready.download_expires_at).toBeTruthy();
    const pdf = await fetch(`${window.location.origin}${ready.download_url}`);
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 8))).toBe('%PDF-1.4');
    // a label_printed event per asset, and the requester is told
    const history = await assetsApi.history(assets[0]!.id, { event_type: ['label_printed'] });
    expect(history.data).toHaveLength(1);
    const [bell] = (await notificationsApi.list({ limit: 1 })).data;
    expect(bell).toMatchObject({ type: 'label.batch.ready', entity_type: 'label_batch' });
    expect(bell!.entity_id).toBe(ready.id);
  });

  it('counts copies and the sheets they need, and a filter picks its own assets', async () => {
    const category = (await categoriesApi.list({ kind: 'asset' })).data[1]!.id;
    const batch = await labelsApi.createBatch(
      { template_key: 'a4-21up-qr', filter: { category_id: [category] }, copies: 2 },
      'key-batch-filter',
    );
    expect(batch).toMatchObject({ source: 'filter', asset_count: 39, copies: 2, label_count: 78 });
    expect((await labelsApi.batch(batch.id)).page_count).toBe(4);
  });

  it('replays the same Idempotency-Key and refuses it with another body', async () => {
    const assets = await someAssets(2);
    const body = { template_key: 'letter-30up-qr', asset_ids: assets.map((a) => a.id) };
    const first = await labelsApi.createBatch(body, 'key-batch-replay');
    const again = await labelsApi.createBatch(body, 'key-batch-replay');
    expect(again.id).toBe(first.id);
    expect((await labelsApi.batches()).data).toHaveLength(1);
    const reuse = await fails(
      labelsApi.createBatch({ ...body, start_position: 2 }, 'key-batch-replay'),
    );
    expect(code(reuse)).toBe('idempotency-key-reuse');
  });

  it('rejects an unknown template, a position past the sheet, both or neither of ids and filter, an empty filter and too many labels', async () => {
    const asset = (await someAssets(1))[0]!;
    const send = (body: Parameters<typeof labelsApi.createBatch>[0], key: string) =>
      fails(labelsApi.createBatch(body, key));
    expect(
      fieldPointers(await send({ template_key: 'nope', asset_ids: [asset.id] }, 'key-reject-001')),
    ).toEqual(['/template_key']);
    expect(
      fieldPointers(
        await send(
          { template_key: 'letter-10up-qr', asset_ids: [asset.id], start_position: 11 },
          'key-reject-002',
        ),
      ),
    ).toEqual(['/start_position']);
    expect(fieldPointers(await send({ template_key: 'letter-30up-qr' }, 'key-reject-003'))).toEqual(
      ['/'],
    );
    expect(
      fieldPointers(
        await send(
          { template_key: 'letter-30up-qr', asset_ids: [asset.id], filter: {} },
          'key-reject-004',
        ),
      ),
    ).toEqual(['/']);
    expect(
      fieldPointers(
        await send(
          { template_key: 'letter-30up-qr', filter: { q: 'no-such-asset-xyz' } },
          'key-reject-005',
        ),
      ),
    ).toEqual(['/filter']);
    expect(
      fieldPointers(
        await send(
          {
            template_key: 'letter-30up-qr',
            asset_ids: Array.from(
              { length: 2001 },
              (_, i) => `0190a6b2-0008-7000-8000-${String(i + 1).padStart(12, '0')}`,
            ),
          },
          'key-reject-006',
        ),
      ),
    ).toEqual(['/asset_ids']);
    expect(
      fieldPointers(
        await send(
          { template_key: 'letter-30up-qr', asset_ids: [asset.id], copies: 11 },
          'key-reject-007',
        ),
      ),
    ).toEqual(['/copies']);
    const unknownKey = await fails(
      getApi().http.POST('/v1/labels/batches', {
        params: { header: { 'Idempotency-Key': 'key-reject-008' } },
        body: { template_key: 'letter-30up-qr', asset_ids: [asset.id], code_type: 'qr' } as never,
      }),
    );
    expect(fieldPointers(unknownKey)).toEqual(['/']);
  });

  it('fails a batch the worker could not render, with the code and a sentence', async () => {
    setMockLabelFailure('render-failed');
    const asset = (await someAssets(1))[0]!;
    const batch = await labelsApi.createBatch(
      { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
      'key-batch-fail',
    );
    const failed = await labelsApi.batch(batch.id);
    expect(failed).toMatchObject({
      status: 'failed',
      download_url: null,
      error: { code: 'render-failed', detail: expect.any(String) },
    });
    const history = await assetsApi.history(asset.id, { event_type: ['label_printed'] });
    expect(history.data).toHaveLength(0);
  });

  it('shows a batch to the user who requested it, nobody else', async () => {
    const asset = (await someAssets(1))[0]!;
    const batch = await labelsApi.createBatch(
      { template_key: 'letter-30up-qr', asset_ids: [asset.id] },
      'key-batch-mine',
    );
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await labelsApi.batches()).data).toHaveLength(0);
    expect((await fails(labelsApi.batch(batch.id))).status).toBe(404);
    seedSession(MOCK_ACCOUNTS.owner);
    expect((await labelsApi.batches()).data.map((b) => b.id)).toEqual([batch.id]);
  });

  it('needs asset:label', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const error = await fails(labelsApi.templates());
    expect(error.status).toBe(403);
    const batch = await fails(
      labelsApi.createBatch({ template_key: 'letter-30up-qr', asset_ids: [] }, 'key-batch-view'),
    );
    expect(batch.status).toBe(403);
  });
});

describe('mock notifications', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('starts with an inbox in the shape of the API: type, link, entity; the count has its own endpoint', async () => {
    const page = await notificationsApi.list({ limit: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.page.has_more).toBe(true);
    expect(page).not.toHaveProperty('unread_count');
    expect(page.data[0]).toEqual({
      id: expect.any(String),
      type: 'consumable.low_stock',
      title: 'Low stock: Toner HP 26A',
      body: expect.any(String),
      link: '/consumables',
      entity_type: 'consumable',
      entity_id: expect.any(String),
      created_at: expect.any(String),
      read_at: null,
    });
    expect(await notificationsApi.unreadCount()).toBe(3);
    const unread = await notificationsApi.list({ unread: true });
    expect(unread.data.every((n) => !n.read_at)).toBe(true);
    expect(unread.data).toHaveLength(3);
  });

  it('marks one and all as read; marking again keeps the first time', async () => {
    const first = (await notificationsApi.list({ unread: true })).data[0]!;
    const read = await notificationsApi.markRead(first.id);
    expect(read.read_at).toBeTruthy();
    const again = await notificationsApi.markRead(first.id);
    expect(again.read_at).toBe(read.read_at);
    expect(await notificationsApi.unreadCount()).toBe(2);
    expect(await notificationsApi.markAllRead()).toBe(2);
    expect(await notificationsApi.unreadCount()).toBe(0);
    expect(await notificationsApi.markAllRead()).toBe(0);
  });

  it('keeps every user an inbox of their own', async () => {
    const mine = (await notificationsApi.list({ unread: true })).data[0]!;
    await notificationsApi.markRead(mine.id);
    seedSession(MOCK_ACCOUNTS.manager);
    expect(await notificationsApi.unreadCount()).toBe(3);
    const other = await fails(notificationsApi.markRead(mine.id));
    expect(other.status).toBe(404);
  });

  it('lists a preference per type with the API label and description, and defaults until chosen', async () => {
    const prefs = await notificationsApi.preferences();
    expect(prefs.map((p) => p.type)).toEqual([
      'attachment.infected',
      'asset.checked_out',
      'export.completed',
      'consumable.low_stock',
      'label.batch.ready',
      'loan.overdue',
      'loan.due_soon',
      'import.completed',
    ]);
    expect(prefs.find((p) => p.type === 'consumable.low_stock')).toEqual({
      type: 'consumable.low_stock',
      label: 'Low stock',
      description: 'A consumable fell to or below its reorder level.',
      in_app: true,
      email: 'digest',
      is_default: true,
    });
  });

  it('saves one type at a time; omitted fields keep their value', async () => {
    const saved = await notificationsApi.savePreference('loan.overdue', { email: 'off' });
    expect(saved).toMatchObject({
      type: 'loan.overdue',
      in_app: true,
      email: 'off',
      is_default: false,
    });
    const again = await notificationsApi.savePreference('loan.overdue', { in_app: false });
    expect(again).toMatchObject({ in_app: false, email: 'off' });
    const untouched = (await notificationsApi.preferences()).find(
      (p) => p.type === 'import.completed',
    )!;
    expect(untouched.is_default).toBe(true);

    const unknown = await fails(notificationsApi.savePreference('nope.nope', { email: 'off' }));
    expect(unknown.status).toBe(404);
    const empty = await fails(notificationsApi.savePreference('loan.overdue', {}));
    expect(empty.status).toBe(422);
    const bad = await fails(
      notificationsApi.savePreference('loan.overdue', { email: 'daily' as never }),
    );
    expect(fieldPointers(bad)).toEqual(['/email']);
  });

  it('does not raise a notification the user turned off in the bell, or the organisation switched off', async () => {
    const paper = (await consumablesApi.list({ q: 'paper' })).data[0]!;
    await notificationsApi.savePreference('consumable.low_stock', { in_app: false });
    const before = await notificationsApi.unreadCount();
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -15, reason: 'issue' },
      'key-pref-0000001',
    );
    expect(await notificationsApi.unreadCount()).toBe(before);

    await notificationsApi.savePreference('consumable.low_stock', { in_app: true });
    await notificationsApi.saveRule('consumable.low_stock', { enabled: false });
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: 20, reason: 'receive' },
      'key-pref-0000002',
    );
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -20, reason: 'issue' },
      'key-pref-0000003',
    );
    expect(await notificationsApi.unreadCount()).toBe(before);
  });

  it('lets an administrator read and change the rules, and nobody else', async () => {
    const rules = await notificationsApi.rules();
    expect(rules).toHaveLength(8);
    expect(rules.find((r) => r.type === 'consumable.low_stock')).toEqual({
      type: 'consumable.low_stock',
      label: 'Low stock',
      description: 'A consumable fell to or below its reorder level.',
      enabled: true,
      recipients: 'Users who manage consumables.',
      role_configurable: true,
      recipient_roles: null,
      updated_at: null,
    });
    const changed = await notificationsApi.saveRule('consumable.low_stock', {
      enabled: false,
      recipient_roles: ['asset_manager'],
    });
    expect(changed).toMatchObject({
      enabled: false,
      recipient_roles: ['asset_manager'],
      updated_at: expect.any(String),
    });
    const fixed = await fails(
      notificationsApi.saveRule('export.completed', { recipient_roles: ['asset_manager'] }),
    );
    expect(fieldPointers(fixed)).toEqual(['/recipient_roles']);
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await fails(notificationsApi.rules())).status).toBe(403);
  });
});

describe('mock saved views', () => {
  const view = { filters: { q: 'x', category_id: '' }, columns: ['tag', 'name'], sort: null };

  it('shows own views and shared ones, in the shape of the API', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const before = await savedViewsApi.list();
    expect(before.map((v) => v.name)).toEqual(['Teacher devices']);
    expect(before[0]).toMatchObject({
      resource: 'assets',
      is_shared: true,
      is_owner: false,
      owner: { display_name: 'Sam Lee' },
      warnings: [],
      columns: ['tag', 'name', 'status', 'location'],
      sort: null,
    });
    expect(before[0]).not.toHaveProperty('definition');

    const { data, response } = await getApi().http.POST('/v1/saved-views', {
      body: { name: 'My view', ...view },
    });
    expect(response.status).toBe(201);
    expect(response.headers.get('location')).toBe(`/v1/saved-views/${data!.id}`);
    expect(response.headers.get('etag')).toBeTruthy();
    expect(data).toMatchObject({ is_shared: false, is_owner: true, resource: 'assets', ...view });

    seedSession(MOCK_ACCOUNTS.manager);
    // the viewer's personal view is not visible to others
    expect((await savedViewsApi.list()).map((v) => v.name)).toEqual(['Teacher devices']);
    const scoped = await getApi().http.GET('/v1/saved-views', {
      params: { query: { scope: 'mine' } },
    });
    expect(scoped.data!.data.map((v) => v.name)).toEqual(['Teacher devices']);
  });

  it('lists by name, case-insensitively, whoever owns the view', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    await savedViewsApi.create({ name: 'zeta', ...view });
    await savedViewsApi.create({ name: 'Alpha', ...view });
    expect((await savedViewsApi.list()).map((v) => v.name)).toEqual([
      'Alpha',
      'Teacher devices',
      'zeta',
    ]);
  });

  it('shares with PUT /sharing: needs view:share, an owner and a name no other shared view has', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const mine = await savedViewsApi.create({ name: 'Mine', ...view });
    const refused = await fails(savedViewsApi.share(mine.id, true));
    expect(refused.status).toBe(403);

    seedSession(MOCK_ACCOUNTS.manager);
    const shared = await savedViewsApi.create({ name: 'Everyone', ...view });
    expect((await savedViewsApi.share(shared.id, true)).is_shared).toBe(true);
    // somebody else's view, shared or not, is not theirs to share
    expect((await fails(savedViewsApi.share(mine.id, true))).status).toBe(404);

    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await savedViewsApi.list()).map((v) => [v.name, v.is_shared, v.is_owner])).toEqual([
      ['Everyone', true, false],
      ['Mine', false, true],
      ['Teacher devices', true, false],
    ]);

    seedSession(MOCK_ACCOUNTS.manager);
    // an administrator may also share: a second shared view of the same name is refused
    seedSession(MOCK_ACCOUNTS.owner);
    const clash = await savedViewsApi.create({ name: 'Teacher devices', ...view });
    const taken = await fails(savedViewsApi.share(clash.id, true));
    expect(taken.status).toBe(409);
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await savedViewsApi.share(shared.id, false)).is_shared).toBe(false);
  });

  it('keeps names unique per owner, renames with If-Match, and deletes only own views', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const a = await savedViewsApi.create({ name: 'A', ...view });
    const dupe = await fails(savedViewsApi.create({ name: ' a ', ...view }));
    expect(dupe.status).toBe(409);
    expect(fieldPointers(dupe)).toEqual(['/name']);
    const renamed = await savedViewsApi.update(a.id, { name: 'B' });
    expect(renamed.name).toBe('B');
    const shared = (await savedViewsApi.list()).find((v) => v.is_shared)!;
    // a shared view is read only for everybody but its owner: it does not exist for them
    expect((await fails(savedViewsApi.remove(shared.id))).status).toBe(404);
    expect((await fails(savedViewsApi.update(shared.id, { name: 'Mine now' }))).status).toBe(404);
    await savedViewsApi.remove(a.id);
    expect((await savedViewsApi.list()).map((v) => v.name)).toEqual(['Teacher devices']);
    expect((await fails(savedViewsApi.remove(a.id))).status).toBe(404);
  });

  it('answers 428 without If-Match and 412 for a stale one', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const a = await savedViewsApi.create({ name: 'A', ...view });
    const bare = await fetch(`${window.location.origin}/v1/saved-views/${a.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', 'x-csrf-token': 'csrf-test' },
      body: JSON.stringify({ name: 'B' }),
    });
    expect(bare.status).toBe(428);
    const stale = await fails(
      getApi().http.PATCH('/v1/saved-views/{id}', {
        params: { path: { id: a.id }, header: { 'If-Match': 'W/"99"' } },
        body: { name: 'B' },
      }),
    );
    expect(stale.status).toBe(412);
  });

  it('warns about references that no longer resolve', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const gone = '0190a6b2-0003-7000-8000-999999999999';
    const created = await savedViewsApi.create({
      name: 'Stale',
      filters: { status_id: gone, q: '' },
      columns: [],
      sort: null,
    });
    expect(created.warnings).toEqual([{ field: 'status_id', id: gone, reason: 'not-found' }]);
    const listed = (await savedViewsApi.list()).find((v) => v.id === created.id)!;
    expect(listed.warnings).toHaveLength(1);
  });

  it('validates the body like the API', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const bad = await fails(
      getApi().http.POST('/v1/saved-views', {
        body: { name: 'Bad', filters: {}, columns: [1] as never, sort: null },
      }),
    );
    expect(fieldPointers(bad)).toEqual(['/columns']);
    // sharing is its own call, not a member of the body
    const shared = await fails(
      getApi().http.POST('/v1/saved-views', { body: { name: 'Bad', is_shared: true } as never }),
    );
    expect(fieldPointers(shared)).toEqual(['/']);
    const long = await fails(savedViewsApi.create({ name: 'x'.repeat(101), ...view }));
    expect(fieldPointers(long)).toEqual(['/name']);
  });
});

describe('mock exports', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockExportDelay(0);
  });

  it('answers 202 with a Location and Retry-After, then succeeds with a file and a link', async () => {
    const category = (await categoriesApi.list({ kind: 'asset' })).data[1]!.id;
    const { data: queued, response } = await getApi().http.POST('/v1/exports', {
      body: { resource: 'assets', filters: { category_id: [category], archived: 'exclude' } },
    });
    expect(response.status).toBe(202);
    expect(response.headers.get('location')).toBe(`/v1/exports/${queued!.id}`);
    expect(response.headers.get('retry-after')).toBe('2');
    expect(queued).toMatchObject({
      resource: 'assets',
      format: 'csv',
      status: 'queued',
      // normalised to the query string form
      filters: { category_id: category, archived: 'exclude' },
      row_count: null,
      download_url: null,
      error: null,
    });
    expect(queued!.requested_by).toBeTruthy();

    const done = await exportsApi.get(queued!.id);
    expect(done).toMatchObject({ status: 'succeeded', row_count: 39 });
    expect(done.filename).toMatch(/\.csv$/);
    expect(done.size_bytes).toBeGreaterThan(0);
    expect(done.download_url).toMatch(/\/mock-storage\/exports\//);
    expect(done.download_expires_at).toBeTruthy();
    const bytes = new Uint8Array(
      await (await fetch(`${window.location.origin}${done.download_url}`)).arrayBuffer(),
    );
    // a byte order mark and CRLF line ends, like the API's files
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder().decode(bytes).trim().split('\r\n');
    expect(lines[0]).toBe(
      'asset_tag,name,serial,category,status,location,purchase_date,warranty_end',
    );
    expect(lines).toHaveLength(40);
    expect(lines.slice(1).every((line) => line.includes('Laptop') || line.startsWith('LAP-'))).toBe(
      true,
    );
    // the list never carries a link
    const listed = await getApi().http.GET('/v1/exports');
    expect(listed.data!.data[0]).toMatchObject({ id: queued!.id, download_url: null });
  });

  it('exports people and locations too', async () => {
    const people = await exportsApi.create({ resource: 'people' });
    const peopleDone = await exportsApi.get(people.id);
    expect(peopleDone.status).toBe('succeeded');
    expect(peopleDone.row_count).toBeGreaterThan(0);
    const locations = await exportsApi.create({ resource: 'locations', filters: { q: 'room' } });
    const locationsDone = await exportsApi.get(locations.id);
    expect(locationsDone).toMatchObject({ resource: 'locations', status: 'succeeded' });
    expect(locationsDone.row_count).toBeGreaterThan(0);
  });

  it('can fail, and only its requester sees a job', async () => {
    const failed = await exportsApi.create({ resource: 'assets', filters: { q: 'fail-me' } });
    expect(await exportsApi.get(failed.id)).toMatchObject({
      status: 'failed',
      error: expect.any(String),
      download_url: null,
    });
    const missing = await fails(exportsApi.get('0190a6b2-00a7-7000-8000-999999999999'));
    expect(missing.status).toBe(404);
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await fails(exportsApi.get(failed.id))).status).toBe(404);
  });

  it('refuses paging members, unknown resources and bodies, like the API', async () => {
    const paging = await fails(
      exportsApi.create({ resource: 'assets', filters: { limit: 50, cursor: 'x' } }),
    );
    expect(paging.status).toBe(422);
    expect(fieldPointers(paging)).toEqual(['/filters/limit', '/filters/cursor']);
    const resource = await fails(exportsApi.create({ resource: 'users' as never }));
    expect(fieldPointers(resource)).toEqual(['/resource']);
    const extra = await fails(
      getApi().http.POST('/v1/exports', { body: { resource: 'assets', entity: 'asset' } as never }),
    );
    expect(fieldPointers(extra)).toEqual(['/']);
  });

  it('needs export:run, and the read permission of the list as well', async () => {
    // the viewer reads assets but may not run exports; a manager may export what they can read
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await fails(exportsApi.create({ resource: 'assets' }))).status).toBe(403);
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await exportsApi.create({ resource: 'assets' })).status).toBe('queued');
  });

  it('stops a user from piling up more than five waiting exports (409)', async () => {
    setMockExportDelay(60_000);
    for (let n = 0; n < 5; n += 1) await exportsApi.create({ resource: 'locations' });
    const sixth = await fails(exportsApi.create({ resource: 'locations' }));
    expect(sixth.status).toBe(409);
  });
});

describe('mock /auth/me mfa_policy', () => {
  it('says whether the organisation enforces MFA for the user', async () => {
    seedSession(MOCK_ACCOUNTS.mfaEnforced);
    const enforced = await getApi().http.GET('/v1/auth/me');
    expect(enforced.data?.mfa_policy).toEqual({ required: true, scope: 'all' });
    seedSession(MOCK_ACCOUNTS.mfaOwner);
    const free = await getApi().http.GET('/v1/auth/me');
    expect(free.data?.mfa_policy).toEqual({ required: false, scope: 'off' });
  });
});
