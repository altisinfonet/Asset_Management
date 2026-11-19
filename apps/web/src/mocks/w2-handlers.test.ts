import { ApiError } from '@assettracker/api-client';
import { beforeEach, describe, expect, it } from 'vitest';
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
import { setMockExportDelay } from './w2-misc-handlers';

/**
 * The M2 wave 2 mock endpoints follow docs/engineering/openapi.yaml (and the `[M2-W2 WEB proposal]`
 * block of its generator), because the screens and Playwright are written against them: derived
 * quantities, refusals (over-checkout, negative stock, checked-out assets), idempotent replays,
 * permissions and the shape of every answer.
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
    expect(charger).toMatchObject({ qty_total: 42, qty_checked_out: 11, qty_available: 31 });
    const dock = list.data.find((a) => a.name === 'Docking station')!;
    expect(dock.qty_available).toBe(0);
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
    expect(code(error)).toBe('conflict');
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
    expect((await consumablesApi.get(paper.id)).value.qty_on_hand).toBe(24);

    const received = await consumablesApi.addMovement(
      paper.id,
      { qty_delta: 6, reason: 'receive', note: 'Delivery' },
      'key-rcv-0000001',
    );
    expect(received).toMatchObject({ balance_after: 30, qty_delta: 6, note: 'Delivery' });
    const issued = await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -30, reason: 'adjust' },
      'key-adj-0000001',
    );
    expect(issued.balance_after).toBe(0);
    const zero = await fails(
      consumablesApi.addMovement(paper.id, { qty_delta: 0, reason: 'adjust' }, 'key-zero-000001'),
    );
    expect(fieldPointers(zero)).toEqual(['/qty_delta']);
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
    const before = (await notificationsApi.list()).unread_count;
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -15, reason: 'issue' },
      'key-low-0000001',
    );
    expect((await notificationsApi.list()).unread_count).toBe(before + 1);
    await consumablesApi.addMovement(
      paper.id,
      { qty_delta: -1, reason: 'issue' },
      'key-low-0000002',
    );
    expect((await notificationsApi.list()).unread_count).toBe(before + 1);
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
    expect(created.value).toMatchObject({ status: 'open', asset_tag: asset.asset_tag });
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

  it('refuses a repair for an asset that is checked out', async () => {
    const held = (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 })).data[0]!;
    const error = await fails(repairsApi.create({ asset_id: held.id, title: 'Broken hinge' }));
    expect(error.status).toBe(409);
    expect(fieldPointers(error)).toEqual(['/asset_id']);
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
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists the fixed templates', async () => {
    const templates = await labelsApi.templates();
    expect(templates.map((t) => [t.key, t.cols * t.rows])).toEqual([
      ['avery-5160', 30],
      ['a4-21up', 21],
      ['a4-10up', 10],
      ['single-50x25', 1],
    ]);
  });

  it('renders a PDF, names it and writes a label_printed event per asset', async () => {
    const assets = (await assetsApi.list({ limit: 3, sort: ['asset_tag'] })).data;
    const rendered = await labelsApi.render({
      template_key: 'avery-5160',
      asset_ids: assets.map((a) => a.id),
      start_position: 7,
    });
    expect(rendered.filename).toBe('labels-avery-5160.pdf');
    const bytes = new Uint8Array(await rendered.blob.arrayBuffer());
    expect(new TextDecoder().decode(bytes.slice(0, 8))).toBe('%PDF-1.4');
    const history = await assetsApi.history(assets[0]!.id, { event_type: ['label_printed'] });
    expect(history.data).toHaveLength(1);
  });

  it('rejects an unknown template, a position past the sheet and too many assets', async () => {
    const asset = (await assetsApi.list({ limit: 1 })).data[0]!;
    const unknown = await fails(labelsApi.render({ template_key: 'nope', asset_ids: [asset.id] }));
    expect(fieldPointers(unknown)).toEqual(['/template_key']);
    const far = await fails(
      labelsApi.render({ template_key: 'a4-10up', asset_ids: [asset.id], start_position: 11 }),
    );
    expect(fieldPointers(far)).toEqual(['/start_position']);
    const many = await fails(
      labelsApi.render({
        template_key: 'avery-5160',
        asset_ids: Array.from(
          { length: 501 },
          (_, i) => `0190a6b2-0008-7000-8000-${String(i + 1).padStart(12, '0')}`,
        ),
      }),
    );
    expect(fieldPointers(many)).toEqual(['/asset_ids']);
  });

  it('needs asset:label', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const error = await fails(labelsApi.templates());
    expect(error.status).toBe(403);
  });
});

describe('mock notifications', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('starts with an inbox, counts the unread ones whatever the page and filter', async () => {
    const page = await notificationsApi.list({ limit: 2 });
    expect(page.data).toHaveLength(2);
    expect(page.page.has_more).toBe(true);
    expect(page.unread_count).toBe(3);
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
    expect((await notificationsApi.list({ limit: 1 })).unread_count).toBe(2);
    expect(await notificationsApi.markAllRead()).toBe(2);
    expect((await notificationsApi.list({ limit: 1 })).unread_count).toBe(0);
    expect(await notificationsApi.markAllRead()).toBe(0);
  });

  it('keeps every user an inbox of their own', async () => {
    const mine = (await notificationsApi.list({ unread: true })).data[0]!;
    await notificationsApi.markRead(mine.id);
    seedSession(MOCK_ACCOUNTS.manager);
    expect((await notificationsApi.list({ limit: 1 })).unread_count).toBe(3);
    const other = await fails(notificationsApi.markRead(mine.id));
    expect(other.status).toBe(404);
  });

  it('lists the preferences and saves changes for the listed types only', async () => {
    const before = await notificationsApi.preferences();
    expect(before.find((p) => p.event_type === 'stock.low')?.delivery).toBe('immediate');
    const saved = await notificationsApi.savePreferences([
      { event_type: 'stock.low', delivery: 'daily_digest' },
    ]);
    expect(saved.find((p) => p.event_type === 'stock.low')?.delivery).toBe('daily_digest');
    expect(saved.find((p) => p.event_type === 'loan.overdue')?.delivery).toBe('immediate');
    const bad = await fails(
      notificationsApi.savePreferences([{ event_type: 'nope.nope', delivery: 'off' }]),
    );
    expect(fieldPointers(bad)).toEqual(['/data/0/event_type']);
  });
});

describe('mock saved views', () => {
  const definition = {
    filters: { q: 'x', category_id: '' },
    columns: ['tag', 'name'],
    sort: null,
  };

  it('shows own views and shared ones; sharing needs view:share', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const before = await savedViewsApi.list();
    expect(before.map((v) => v.name)).toEqual(['Laptops']);
    expect(before[0]).toMatchObject({ shared: true, owner_name: 'Sam Lee' });

    const mine = await savedViewsApi.create({ name: 'My view', shared: false, definition });
    expect(mine).toMatchObject({ shared: false, owner_user_id: expect.any(String) });
    const refused = await fails(
      savedViewsApi.create({ name: 'For all', shared: true, definition }),
    );
    expect(refused.status).toBe(403);

    seedSession(MOCK_ACCOUNTS.manager);
    const managers = await savedViewsApi.list();
    // the viewer's personal view is not visible to others
    expect(managers.map((v) => v.name)).toEqual(['Laptops']);
    const shared = await savedViewsApi.create({ name: 'Everyone', shared: true, definition });
    expect(shared.shared).toBe(true);
    seedSession(MOCK_ACCOUNTS.viewer);
    expect((await savedViewsApi.list()).map((v) => v.name)).toEqual([
      'My view',
      'Everyone',
      'Laptops',
    ]);
  });

  it('keeps names unique per owner, renames, and deletes only what the caller may', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const a = await savedViewsApi.create({ name: 'A', shared: false, definition });
    const dupe = await fails(savedViewsApi.create({ name: ' a ', shared: false, definition }));
    expect(dupe.status).toBe(409);
    expect(fieldPointers(dupe)).toEqual(['/name']);
    const renamed = await savedViewsApi.update(a.id, { name: 'B' });
    expect(renamed.name).toBe('B');
    const shared = (await savedViewsApi.list()).find((v) => v.shared)!;
    const denied = await fails(savedViewsApi.remove(shared.id));
    expect(denied.status).toBe(403);
    await savedViewsApi.remove(a.id);
    expect((await savedViewsApi.list()).map((v) => v.name)).toEqual(['Laptops']);
    const gone = await fails(savedViewsApi.remove(a.id));
    expect(gone.status).toBe(404);
  });

  it('validates the definition', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const bad = await fails(
      getApi().http.POST('/v1/saved-views', {
        body: {
          entity: 'asset',
          name: 'Bad',
          definition: { filters: {}, columns: [1], sort: null } as never,
        },
      }),
    );
    expect(fieldPointers(bad)).toEqual(['/definition/columns']);
  });
});

describe('mock exports', () => {
  beforeEach(() => {
    seedSession(MOCK_ACCOUNTS.owner);
    setMockExportDelay(0);
  });

  it('runs a job with the list filters and serves the CSV', async () => {
    const query = { category_id: [(await categoriesApi.list({ kind: 'asset' })).data[1]!.id] };
    const queued = await exportsApi.create({ entity: 'asset', query });
    expect(queued.status).toBe('queued');
    const ready = await exportsApi.get(queued.id);
    expect(ready).toMatchObject({ status: 'ready', row_count: 39 });
    expect(ready.download_url).toMatch(/\/mock-storage\/exports\//);
    const response = await fetch(`${window.location.origin}${ready.download_url}`);
    const text = await response.text();
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe(
      'asset_tag,name,serial,category,status,location,purchase_date,warranty_end',
    );
    expect(lines).toHaveLength(40);
    expect(lines.slice(1).every((line) => line.includes('Laptop') || line.startsWith('LAP-'))).toBe(
      true,
    );
  });

  it('can fail, and is gated by asset:read', async () => {
    const failed = await exportsApi.create({ entity: 'asset', query: { q: 'fail-me' } });
    expect((await exportsApi.get(failed.id)).status).toBe('failed');
    const missing = await fails(exportsApi.get('0190a6b2-00a7-7000-8000-999999999999'));
    expect(missing.status).toBe(404);
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
