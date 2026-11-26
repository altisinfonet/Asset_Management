import { expect, test, type Page } from '@playwright/test';
import { api, choose, pick, runId, signInAsOwner } from './support';

/**
 * Lost, found and dispose (M2-LIFE-05) and the bulk move, through the screens of v0.2.8, against the
 * REAL stack (compose api + Postgres, the demo seed):
 *
 *   1. an asset checked out to a person is marked lost on its page: the API closes the check-out;
 *      marked found with a new place, it is ready again and the history has both entries;
 *   2. an asset that still holds accessory units cannot be disposed of (409, said plainly); once they
 *      are back it is disposed of with a reason, a date and a note, archived, with the record;
 *   3. two assets are moved at once from the asset list (bulk-move), each with a history entry;
 *   4. Settings opens on the Organisation page with the organisation's name.
 *
 * Every asset is made by the test with a per-run suffix, so the suite can run again on the same database.
 */
const id = runId();

test.describe.configure({ mode: 'serial' });

let page: Page;
let categoryId = '';
let readyId = '';
let personId = '';
let personName = '';

interface Paged<T> {
  data: T[];
  page: { next_cursor: string | null; has_more: boolean; total?: number };
}
interface AssetJson {
  id: string;
  asset_tag: string;
  archived_at: string | null;
  location_id: string | null;
  current_assignment: unknown;
  status?: { state_type: string; name: string };
  disposal?: { reason: string; disposed_on: string; note: string | null } | null;
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

async function newAsset(name: string): Promise<{ id: string; tag: string }> {
  const res = await api<{ id: string; asset_tag: string }>(page, 'POST', '/v1/assets', {
    category_id: categoryId,
    name: `${name} ${id}`,
    status_id: readyId,
  });
  expect(res.status, name).toBe(201);
  return { id: res.json.id, tag: res.json.asset_tag };
}

const read = async (assetId: string) =>
  (await api<AssetJson>(page, 'GET', `/v1/assets/${assetId}`)).json;

test('mark a checked-out asset lost from its page: the check-out ends; mark it found elsewhere', async () => {
  await signInAsOwner(page);
  const labels = (
    await api<Paged<{ id: string; name: string; state_type: string }>>(
      page,
      'GET',
      '/v1/status-labels?limit=200',
    )
  ).json.data;
  readyId = labels.find((l) => l.state_type === 'deployable' && l.name === 'Ready to deploy')!.id;
  categoryId = (await api<Paged<{ id: string }>>(page, 'GET', '/v1/categories?kind=asset&limit=1'))
    .json.data[0]!.id;
  personName = `Lifecycle Person ${id}`;
  const person = await api<{ id: string }>(page, 'POST', '/v1/people', {
    display_name: personName,
  });
  expect(person.status).toBe(201);
  personId = person.json.id;

  const asset = await newAsset('Lost laptop');
  const out = await api(page, 'POST', `/v1/assets/${asset.id}/checkout`, { person_id: personId });
  expect(out.status).toBe(201);

  await page.goto(`/assets/view?id=${asset.id}`);
  await expect(page.getByTestId('asset-holder')).toContainText(personName);
  await page.getByRole('button', { name: 'Mark as lost or stolen' }).click();
  const lost = page.getByRole('dialog', { name: `Mark ${asset.tag} as lost or stolen` });
  await expect(lost.getByTestId('lost-closes-checkout')).toContainText(personName);
  await lost.getByRole('textbox', { name: 'What happened' }).fill(`Left on the bus ${id}`);
  await lost.getByRole('button', { name: 'Mark as lost' }).click();
  await expect(lost).toBeHidden();
  await expect(page.getByTestId('asset-holder')).toHaveCount(0);

  const afterLost = await read(asset.id);
  expect(afterLost.status?.state_type).toBe('lost');
  expect(afterLost.current_assignment).toBeNull();
  // the person no longer holds it
  const held = await api<Paged<{ asset_id: string }>>(
    page,
    'GET',
    `/v1/people/${personId}/assignments?state=open`,
  );
  expect(held.json.data.some((a) => a.asset_id === asset.id)).toBe(false);

  await page.getByRole('button', { name: 'Mark as found' }).click();
  const found = page.getByRole('dialog', { name: `Mark ${asset.tag} as found` });
  await pick(page, /Where is it now/, 'Library', /^Library/);
  await found.getByRole('button', { name: 'Mark as found' }).click();
  await expect(found).toBeHidden();
  await expect(page.getByRole('button', { name: 'Check out' })).toBeVisible();
  const afterFound = await read(asset.id);
  expect(afterFound.status?.state_type).toBe('deployable');
  expect(afterFound.location_id).not.toBeNull();

  await page.getByRole('tab', { name: /History/ }).click();
  await expect(page.getByText(`Marked lost: Left on the bus ${id}`)).toBeVisible();
  await expect(page.getByText(/^Marked found/).first()).toBeVisible();
});

test('dispose: refused while accessories are checked out to the asset, then archived with the record', async () => {
  const asset = await newAsset('Old desktop');
  const accessory = (
    await api<Paged<{ id: string; qty_available: number }>>(page, 'GET', '/v1/accessories?limit=50')
  ).json.data.find((a) => a.qty_available >= 1)!;
  const lent = await api<{ id: string }>(page, 'POST', `/v1/accessories/${accessory.id}/checkout`, {
    quantity: 1,
    target_asset_id: asset.id,
  });
  expect(lent.status).toBe(201);

  await page.goto(`/assets/view?id=${asset.id}`);
  await page.getByRole('button', { name: 'Dispose' }).click();
  const dialog = page.getByRole('dialog', { name: `Dispose of ${asset.tag}` });
  await choose(page, /^Reason/, 'Recycled');
  await dialog.getByRole('button', { name: 'Dispose' }).click();
  await expect(dialog).toContainText(
    '1 accessory unit is still checked out to this asset. Check it in on the Stock page first.',
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  const back = await api(page, 'POST', `/v1/accessories/${accessory.id}/checkin`, {
    assignment_id: lent.json.id,
  });
  expect(back.status).toBe(200);

  await page.reload();
  await page.getByRole('button', { name: 'Dispose' }).click();
  await choose(page, /^Reason/, 'Recycled');
  await dialog.getByLabel(/^Date/).fill('2026-11-20');
  await dialog.getByRole('textbox', { name: 'Note' }).fill(`Certificate ${id}`);
  await dialog.getByRole('button', { name: 'Dispose' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId('disposal-banner')).toHaveText(
    `Disposed of on 2026-11-20: Recycled. Certificate ${id}`,
  );
  const after = await read(asset.id);
  expect(after.archived_at).not.toBeNull();
  expect(after.status?.state_type).toBe('archived');
  expect(after.disposal).toEqual({
    reason: 'recycled',
    disposed_on: '2026-11-20',
    note: `Certificate ${id}`,
  });
  // not in the default (active) list
  const active = await api<Paged<{ id: string }>>(
    page,
    'GET',
    `/v1/assets?q=${encodeURIComponent(asset.tag)}&limit=5`,
  );
  expect(active.json.data.some((a) => a.id === asset.id)).toBe(false);
});

test('bulk edit moves two assets to a location, each with a history entry', async () => {
  const one = await newAsset('Move one');
  const two = await newAsset('Move two');
  await page.goto('/assets');
  await page.getByPlaceholder('Tag, serial or name').fill(id);
  // a new search clears the selection: tick only once the list shows the search's result (every
  // row is one of this run's assets), not the unfiltered first page that is still on screen
  const rows = page
    .getByRole('row')
    .filter({ has: page.getByRole('checkbox', { name: /^Select row / }) });
  await expect
    .poll(async () => {
      const texts = await rows.allInnerTexts();
      return texts.length >= 2 && texts.every((text) => text.includes(id));
    })
    .toBe(true);
  await page.getByRole('checkbox', { name: `Select row ${one.tag}` }).click();
  await page.getByRole('checkbox', { name: `Select row ${two.tag}` }).click();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toBeVisible();
  await expect(page.getByText('2 rows selected')).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Edit 2 assets' });
  await choose(page, 'Field', 'Location');
  const where = dialog.getByRole('combobox', { name: 'New value' });
  await where.click();
  await where.fill('Library');
  await page
    .getByRole('option', { name: /^Library/ })
    .first()
    .click();
  await dialog.getByRole('textbox', { name: 'Note for the history' }).fill(`Term ${id}`);
  await dialog.getByRole('button', { name: 'Apply to 2 assets' }).click();
  await expect(page.getByText('Done: 2 assets updated.', { exact: true })).toBeVisible();

  const [a, b] = [await read(one.id), await read(two.id)];
  expect(a.location_id).not.toBeNull();
  expect(b.location_id).toBe(a.location_id);
  const history = await api<Paged<{ event_type: string }>>(
    page,
    'GET',
    `/v1/assets/${one.id}/history?event_type=location_changed`,
  );
  expect(history.json.data.length).toBeGreaterThan(0);
});

test('Settings opens on the Organisation page with the organisation name', async () => {
  const me = (await api<{ tenant: { name: string } }>(page, 'GET', '/v1/auth/me')).json;
  await page.goto('/settings/organisation');
  await expect(page.getByRole('heading', { name: 'Organisation' })).toBeVisible();
  await expect(page.getByTestId('org-name')).toHaveText(me.tenant.name);
  await expect(page.getByText(/not built yet/)).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Files and photos' })).toBeVisible();
});
