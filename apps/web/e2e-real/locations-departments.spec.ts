import { expect, test, type Page } from '@playwright/test';
import { api, choose, runId, signInAsOwner, signInWithPassword } from './support';

/**
 * Real stack (compose api + Postgres), no mock. Founder report 2026-11-24: "location edit for site:
 * at edit time I got an error but right now I did not get it". Root cause: an out-of-limit address
 * value (typically a country name instead of the two-letter code) came back as a 422 whose pointer
 * (`/address/country`) matched no form field, so the dialog only said "The request body failed
 * validation (1 problem)". The first block replays every way an edit of a location can fail in the UI
 * against the real API; the second block is the managed-departments story.
 */
const id = runId();
const SITE = `E2E Site ${id}`;
const BUILDING = `E2E Building ${id}`;
const ROOM = `E2E Room ${id}`;

test.describe.configure({ mode: 'serial' });

let page: Page;
let siteId = '';
let buildingId = '';
let roomId = '';

const tree = () => page.getByRole('tree', { name: 'Locations' });
const dialog = (name: RegExp | string) => page.getByRole('dialog', { name });

async function openLocation(name: string) {
  await page.goto('/locations');
  await page.getByRole('searchbox', { name: 'Search locations' }).fill(name);
  await tree()
    .getByRole('treeitem', { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await expect(page.getByTestId('location-name')).toHaveText(name);
}
const editButton = () => page.getByRole('button', { name: 'Edit', exact: true });

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  await signInAsOwner(page);
  const site = await api<{ id: string }>(page, 'POST', '/v1/locations', {
    name: SITE,
    kind: 'site',
  });
  expect(site.status).toBe(201);
  siteId = site.json.id;
  const building = await api<{ id: string }>(page, 'POST', '/v1/locations', {
    name: BUILDING,
    kind: 'building',
    parent_id: siteId,
  });
  buildingId = building.json.id;
  const room = await api<{ id: string }>(page, 'POST', '/v1/locations', {
    name: ROOM,
    kind: 'room',
    parent_id: buildingId,
  });
  roomId = room.json.id;
});
test.afterAll(async () => {
  await page.context().close();
});

test.describe('location edit (founder report 2026-11-24)', () => {
  test('a country that is not a two-letter code is explained on the field, and the fixed value saves', async () => {
    await openLocation(SITE);
    await editButton().click();
    const edit = dialog(`Edit ${SITE}`);
    await edit.getByLabel(/^Street address/).fill('1 Main Street');
    await edit.getByLabel(/^City/).fill('Oslo');
    await edit.getByLabel(/^Country/).fill('Norway');
    await edit.getByRole('button', { name: 'Save' }).click();
    // the message sits on the Country field and no generic banner is shown
    await expect(edit.getByText(/two-letter country code/i).first()).toBeVisible();
    await expect(page.getByText(/request body failed validation/i)).toHaveCount(0);
    await edit.getByLabel(/^Country/).fill('no');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${SITE}" saved.`).first()).toBeVisible();
    const saved = await api<{ address: { country: string; city: string } }>(
      page,
      'GET',
      `/v1/locations/${siteId}`,
    );
    expect(saved.json.address).toMatchObject({ country: 'NO', city: 'Oslo' });
  });

  test('every address field keeps its limit: a too-long value is named on its own field', async () => {
    await openLocation(SITE);
    await editButton().click();
    const edit = dialog(`Edit ${SITE}`);
    await edit.getByLabel(/^Postal code/).fill('1'.repeat(41));
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText(/at most 40 characters/i).first()).toBeVisible();
    await expect(page.getByText(/request body failed validation/i)).toHaveCount(0);
    await edit.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a second address line survives an edit of the site (it was silently dropped before)', async () => {
    const cur = await api<unknown>(page, 'GET', `/v1/locations/${siteId}`);
    const set = await api(
      page,
      'PATCH',
      `/v1/locations/${siteId}`,
      { address: { line1: '1 Main Street', line2: 'Wing B', city: 'Oslo', country: 'NO' } },
      { 'if-match': cur.etag! },
    );
    expect(set.status).toBe(200);
    await openLocation(SITE);
    await editButton().click();
    const edit = dialog(`Edit ${SITE}`);
    await expect(edit.getByLabel(/^Address line 2/)).toHaveValue('Wing B');
    await edit.getByLabel(/^City/).fill('Bergen');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${SITE}" saved.`).first()).toBeVisible();
    const saved = await api<{ address: Record<string, string> }>(
      page,
      'GET',
      `/v1/locations/${siteId}`,
    );
    expect(saved.json.address).toMatchObject({ line2: 'Wing B', city: 'Bergen' });
  });

  test('changing the type of a location that has sublocations and assets keeps everything', async () => {
    const cat = await api<{ id: string }>(page, 'POST', '/v1/categories', {
      name: `E2E Loc category ${id}`,
      tag_prefix: `L${id}-`,
    });
    expect(cat.status).toBe(201);
    const asset = await api(page, 'POST', '/v1/assets', {
      category_id: cat.json.id,
      location_id: buildingId,
    });
    expect(asset.status).toBe(201);
    await openLocation(BUILDING);
    await editButton().click();
    await choose(page, /^Type/, 'Site');
    await dialog(`Edit ${BUILDING}`).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${BUILDING}" saved.`).first()).toBeVisible();
    const after = await api<Record<string, unknown>>(page, 'GET', `/v1/locations/${buildingId}`);
    expect(after.json).toMatchObject({
      kind: 'site',
      parent_id: siteId,
      child_count: 1,
      direct_asset_count: 1,
    });
    await openLocation(BUILDING);
    await editButton().click();
    await choose(page, /^Type/, 'Building');
    await dialog(`Edit ${BUILDING}`).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${BUILDING}" saved.`).first()).toBeVisible();
  });

  test('changing a site to another type keeps its address instead of wiping it', async () => {
    const cur = await api<unknown>(page, 'GET', `/v1/locations/${siteId}`);
    await openLocation(SITE);
    await editButton().click();
    await choose(page, /^Type/, 'Building');
    await dialog(`Edit ${SITE}`).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${SITE}" saved.`).first()).toBeVisible();
    const after = await api<{ kind: string; address: Record<string, string> | null }>(
      page,
      'GET',
      `/v1/locations/${siteId}`,
    );
    expect(after.json.kind).toBe('building');
    expect(after.json.address).toMatchObject({ city: 'Bergen' });
    expect(cur.etag).toBeTruthy();
    await openLocation(SITE);
    await editButton().click();
    await choose(page, /^Type/, 'Site');
    await expect(dialog(`Edit ${SITE}`).getByLabel(/^City/)).toHaveValue('Bergen');
    await dialog(`Edit ${SITE}`).getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${SITE}" saved.`).first()).toBeVisible();
  });

  test('a duplicate name under the same parent is refused on the Name field', async () => {
    const twin = await api(page, 'POST', '/v1/locations', {
      name: `Twin ${id}`,
      parent_id: buildingId,
    });
    expect(twin.status).toBe(201);
    await openLocation(ROOM);
    await editButton().click();
    const edit = dialog(`Edit ${ROOM}`);
    await edit.getByLabel(/^Name/).fill(`twin ${id}`);
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText('This value is already in use.').first()).toBeVisible();
    await edit.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a stale version offers to reload, and the reloaded form shows the other change', async () => {
    await openLocation(SITE);
    await editButton().click();
    const edit = dialog(`Edit ${SITE}`);
    const current = await api<unknown>(page, 'GET', `/v1/locations/${siteId}`);
    const changed = await api(
      page,
      'PATCH',
      `/v1/locations/${siteId}`,
      { notes: 'changed elsewhere' },
      { 'if-match': current.etag! },
    );
    expect(changed.status).toBe(200);
    await edit.getByLabel(/^Code/).fill('ST-1');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByText(/changed by someone else/i)).toBeVisible();
    await edit.getByRole('button', { name: 'Reload latest' }).click();
    await expect(edit.getByLabel(/^Notes/)).toHaveValue('changed elsewhere');
    await edit.getByLabel(/^Code/).fill('ST-1');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "${SITE}" saved.`).first()).toBeVisible();
  });

  test('a location added a moment ago can be edited straight away', async () => {
    await page.goto('/locations');
    await page.getByRole('button', { name: 'Add location' }).first().click();
    const create = dialog('Add a location');
    await create.getByLabel(/^Name/).fill(`Fresh ${id}`);
    await choose(page, /^Type/, 'Site');
    await create.getByRole('button', { name: 'Add location' }).click();
    await expect(page.getByTestId('location-name')).toHaveText(`Fresh ${id}`);
    await editButton().click();
    const edit = dialog(`Edit Fresh ${id}`);
    await edit.getByLabel(/^Code/).fill('F-1');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Location "Fresh ${id}" saved.`).first()).toBeVisible();
  });

  test('a location archived by someone else while the dialog is open is reported plainly', async () => {
    const gone = await api<{ id: string }>(page, 'POST', '/v1/locations', { name: `Gone ${id}` });
    await openLocation(`Gone ${id}`);
    await editButton().click();
    const edit = dialog(`Edit Gone ${id}`);
    const cur = await api<unknown>(page, 'GET', `/v1/locations/${gone.json.id}`);
    expect(
      (
        await api(page, 'DELETE', `/v1/locations/${gone.json.id}`, undefined, {
          'if-match': cur.etag!,
        })
      ).status,
    ).toBe(204);
    await edit.getByLabel(/^Code/).fill('G-1');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(edit.getByRole('alert').filter({ hasText: /not found/i })).toBeVisible();
    await edit.getByRole('button', { name: 'Cancel' }).click();
  });

  test('moving under its own descendant is a clear 422 (never a 500); moving into a taken name says so', async () => {
    const etag = async (target: string) =>
      (await api<unknown>(page, 'GET', `/v1/locations/${target}`)).etag!;
    const cycle = await api<{ errors: Array<{ pointer: string; code: string }> }>(
      page,
      'PATCH',
      `/v1/locations/${siteId}`,
      { parent_id: roomId },
      { 'if-match': await etag(siteId) },
    );
    expect(cycle.status).toBe(422);
    expect(cycle.json.errors[0]).toMatchObject({ pointer: '/parent_id', code: 'cycle' });

    // "Twin" exists under the building: a top-level one with the same name collides when moved there
    const other = await api<{ id: string }>(page, 'POST', '/v1/locations', { name: `Twin ${id}` });
    expect(other.status).toBe(201);
    await page.goto(`/locations?id=${other.json.id}`);
    await expect(page.getByTestId('location-name')).toHaveText(`Twin ${id}`);
    await page.getByRole('button', { name: 'Move' }).first().click();
    const move = dialog(new RegExp(`^Move Twin ${id}`));
    await move.getByRole('combobox', { name: 'New parent' }).fill(BUILDING);
    await page.getByRole('option', { name: new RegExp(`^${BUILDING}`) }).click();
    await move.getByRole('button', { name: 'Move' }).click();
    await expect(move.getByRole('alert')).toContainText(/already exists/i);
    await move.getByRole('button', { name: 'Cancel' }).click();
  });

  test('a read-only role sees the location but no Edit button; the API answers 403', async ({
    browser,
  }) => {
    const viewer = await signInWithPassword(browser, 'viewer@acme.example');
    await viewer.goto('/locations');
    await viewer.getByRole('searchbox', { name: 'Search locations' }).fill(SITE);
    await viewer
      .getByRole('tree', { name: 'Locations' })
      .getByRole('treeitem', { name: new RegExp(`^${SITE}`) })
      .first()
      .click();
    await expect(viewer.getByTestId('location-name')).toHaveText(SITE);
    await expect(viewer.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
    const denied = await api<{ code: string }>(
      viewer,
      'PATCH',
      `/v1/locations/${siteId}`,
      { notes: 'x' },
      { 'if-match': 'W/"1"' },
    );
    expect(denied.status).toBe(403);
    await viewer.context().close();
  });
});
