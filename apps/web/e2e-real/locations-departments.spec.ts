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
const dialogNamed = dialog;

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

/**
 * Managed departments (ED-17, founder request 2026-11-24): the Settings page, the picker on the person
 * and asset forms, the column and filters of the lists, the archive refusal with its counts and the
 * merge. Shares the signed-in page of the file; every name carries the per-run suffix.
 */
test.describe('departments (founder request 2026-11-24)', () => {
  const DEPT = `E2E Dept ${id}`;
  const RENAMED = `E2E Dept renamed ${id}`;
  const TARGET = `E2E Target ${id}`;
  const PERSON = `E2E Dana ${id}`;
  const SECOND = `E2E Evan ${id}`;
  const DEMO = ['IT', 'Science', 'Mathematics', 'Administration', 'Library', 'Facilities'];
  let deptId = '';
  let targetId = '';
  let assetTag = '';

  const settingsRow = (name: string) => page.getByRole('row', { name: new RegExp(name) });

  test('the demo tenant has the six demo departments, with people and assets linked', async () => {
    const list = await api<{
      data: Array<{ id: string; name: string; person_count: number; asset_count: number }>;
    }>(page, 'GET', '/v1/departments?limit=200');
    expect(list.status).toBe(200);
    const byName = new Map(list.json.data.map((d) => [d.name, d]));
    for (const name of DEMO) expect(byName.get(name), name).toBeTruthy();
    expect(byName.get('IT')!.person_count).toBeGreaterThan(0);
    const assets = await api<{ page: { total: number } }>(
      page,
      'GET',
      '/v1/assets?limit=1&include_total=true',
    );
    const linked = DEMO.reduce((n, name) => n + byName.get(name)!.asset_count, 0);
    expect(linked).toBeGreaterThan(0); // some assets belong to a department ...
    expect(linked).toBeLessThan(assets.json.page.total); // ... and some do not

    await page.goto('/settings/departments');
    await expect(page.getByRole('heading', { name: 'Departments', level: 2 })).toBeVisible();
    for (const name of DEMO) await expect(settingsRow(`^${name}`).first()).toBeVisible();
  });

  test('creates a department on the Settings page and refuses the same name in other capitals', async () => {
    await page.goto('/settings/departments');
    await page.getByRole('button', { name: 'Add department' }).click();
    const dialog = dialogNamed('Add a department');
    await dialog.getByLabel(/^Name/).fill(DEPT);
    await dialog.getByLabel(/^Code/).fill(`E${id}`);
    await dialog.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText(`Department "${DEPT}" added.`).first()).toBeVisible();
    await expect(settingsRow(DEPT)).toBeVisible();
    const made = await api<{ data: Array<{ id: string }> }>(
      page,
      'GET',
      `/v1/departments?q=${encodeURIComponent(DEPT)}`,
    );
    deptId = made.json.data[0]!.id;

    await page.getByRole('button', { name: 'Add department' }).click();
    const again = dialogNamed('Add a department');
    await again.getByLabel(/^Name/).fill(`  ${DEPT.toUpperCase()}  `);
    await again.getByRole('button', { name: 'Add department' }).click();
    await expect(again.getByText('This value is already in use.')).toBeVisible();
    await again.getByRole('button', { name: 'Cancel' }).click();
  });

  test('renames it; the new name shows everywhere it is used', async () => {
    await page.goto('/settings/departments');
    await page.getByRole('button', { name: `Edit ${DEPT}` }).click();
    const edit = dialogNamed(`Edit ${DEPT}`);
    await edit.getByLabel(/^Name/).fill(RENAMED);
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(`Department "${RENAMED}" saved.`).first()).toBeVisible();
    await expect(settingsRow(RENAMED)).toBeVisible();
  });

  test('the person form picks the department from the list; the list shows it and filters by it', async () => {
    await page.goto('/people');
    await page.getByRole('button', { name: 'Add person' }).click();
    const dialog = dialogNamed('Add a person');
    await dialog.getByLabel(/^Name/).fill(PERSON);
    await dialog.getByRole('combobox', { name: 'Department' }).fill('renamed');
    await page.getByRole('option', { name: new RegExp(`^${RENAMED}`) }).click();
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText(`${PERSON} added.`).first()).toBeVisible();

    const saved = await api<{ data: Array<{ department_id: string; department: string }> }>(
      page,
      'GET',
      `/v1/people?q=${encodeURIComponent(PERSON)}`,
    );
    expect(saved.json.data[0]).toMatchObject({ department_id: deptId, department: RENAMED });

    await page.getByRole('combobox', { name: 'Department' }).fill('renamed');
    await page.getByRole('option', { name: new RegExp(`^${RENAMED}`) }).click();
    await expect(page.getByRole('row', { name: new RegExp(PERSON) })).toContainText(RENAMED);
    await expect(page.getByTestId('people-range')).toHaveText('Showing 1-1 of 1');
  });

  test('the old free text is gone: the API refuses a department string', async () => {
    const res = await api<{ errors: Array<{ code: string }> }>(page, 'POST', '/v1/people', {
      display_name: `E2E Free ${id}`,
      department: 'Maths',
    });
    expect(res.status).toBe(422);
    expect(res.json.errors[0]).toMatchObject({ code: 'unrecognized_keys' });
  });

  test('the asset form picks the department; the asset list has the column and filters by it', async () => {
    const cat = await api<{ id: string }>(page, 'POST', '/v1/categories', {
      name: `E2E Dept category ${id}`,
      tag_prefix: `D${id}-`,
    });
    expect(cat.status).toBe(201);
    await page.goto('/assets/new');
    await choose(page, /^Category/, `E2E Dept category ${id}`);
    await expect(
      page.getByText('Who owns or pays for it. Where it is stays Location.'),
    ).toBeVisible();
    await page.getByRole('combobox', { name: 'Department' }).fill('renamed');
    await page.getByRole('option', { name: new RegExp(`^${RENAMED}`) }).click();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toBeVisible();
    assetTag = (await page.getByTestId('asset-tag').innerText()).trim();
    await expect(page.getByText(RENAMED).first()).toBeVisible();

    await page.goto(`/assets?department=${deptId}`);
    await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-1 of 1');
    await page.getByRole('button', { name: 'Columns' }).click();
    await dialogNamed('Columns').getByRole('checkbox', { name: 'Department' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('row', { name: new RegExp(assetTag) })).toContainText(RENAMED);
    await expect(page.getByRole('combobox', { name: 'Department' })).toHaveValue(RENAMED);
  });

  test('archiving a department that is in use is refused with the counts', async () => {
    const second = await api(page, 'POST', '/v1/people', {
      display_name: SECOND,
      department_id: deptId,
    });
    expect(second.status).toBe(201);
    // the merge target exists before the page loads its lists
    const target = await api<{ id: string }>(page, 'POST', '/v1/departments', { name: TARGET });
    expect(target.status).toBe(201);
    targetId = target.json.id;
    await page.goto('/settings/departments');
    await expect(settingsRow(RENAMED)).toBeVisible();
    await page.getByRole('button', { name: `Archive ${RENAMED}` }).click();
    await dialogNamed(`Archive ${RENAMED}?`).getByRole('button', { name: 'Archive' }).click();
    // the dialog turns into "... is still in use": its name changes with it
    const dialog = dialogNamed(`${RENAMED} is still in use`);
    await expect(dialog.getByText(/Still in use by/)).toContainText('2 people, 1 asset');
    await expect(dialog.getByRole('button', { name: 'Merge and archive' })).toBeDisabled();
    const still = await api<{
      archived_at: string | null;
      person_count: number;
      asset_count: number;
    }>(page, 'GET', `/v1/departments/${deptId}`);
    expect(still.json).toMatchObject({ archived_at: null, person_count: 2, asset_count: 1 });
  });

  test('merges it into another department: the people and the asset move, the old one is archived', async () => {
    const dialog = dialogNamed(`${RENAMED} is still in use`);
    await dialog.getByRole('combobox', { name: /Move them to/ }).fill('target');
    await page.getByRole('option', { name: new RegExp(`^${TARGET}`) }).click();
    await dialog.getByRole('button', { name: 'Merge and archive' }).click();
    await expect(page.getByText(`Merged into "${TARGET}".`).first()).toBeVisible();
    await expect(settingsRow(RENAMED)).toHaveCount(0);

    const moved = await api<{ person_count: number; asset_count: number }>(
      page,
      'GET',
      `/v1/departments/${targetId}`,
    );
    expect(moved.json).toMatchObject({ person_count: 2, asset_count: 1 });
    const old = await api<{ archived_at: string | null }>(page, 'GET', `/v1/departments/${deptId}`);
    expect(old.json.archived_at).not.toBeNull();
    const asset = await api<{ data: Array<{ department_id: string }> }>(
      page,
      'GET',
      `/v1/assets?tag=${encodeURIComponent(assetTag)}`,
    );
    expect(asset.json.data[0]!.department_id).toBe(targetId);
  });

  test('a read-only role sees the page without write buttons; the API answers 403 to a write', async ({
    browser,
  }) => {
    const viewer = await signInWithPassword(browser, 'viewer@acme.example');
    await viewer.goto('/settings/departments');
    await expect(viewer.getByRole('row', { name: new RegExp(TARGET) })).toBeVisible();
    await expect(viewer.getByRole('button', { name: 'Add department' })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: /^(Edit|Archive) / })).toHaveCount(0);
    const denied = await api(viewer, 'POST', '/v1/departments', { name: `E2E Nope ${id}` });
    expect(denied.status).toBe(403);
    await viewer.context().close();
  });
});
