import { expect, test, type Page } from '@playwright/test';
import { choose, DEMO_PASSWORD, runId, signInAsOwner } from './support';

/**
 * M2 wave 1 against the REAL stack (compose api + worker + Postgres + MinIO + ClamAV), no mock:
 *
 *   location tree (UI) -> check out an asset to a person -> transfer it to another person ->
 *   check in with a real photo (browser PUT to MinIO, real ClamAV scan, photo listed on the assignment)
 *   -> the history timeline shows the whole chain with the actors' names -> an EICAR upload is rejected
 *   -> the other tenant (Globex) cannot see the location, the person, the assignment or the photo (404).
 *
 * Every name carries a per-run suffix, so the suite can run again on the same database.
 */
const id = runId();
const ROOT = `E2E Campus ${id}`;
const HALL = `Hall ${id}`;
const ROOM = `Room ${id}`;
const FIRST = `Ada First ${id}`;
const SECOND = `Bo Second ${id}`;
const SERIAL = `SN-CF-${id}`;

/** A tiny valid PNG (1x1). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
/** The standard anti-malware test string; any scanner flags it, it is harmless. */
const EICAR = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

test.describe.configure({ mode: 'serial' });

let page: Page;
let assetId = '';
let assetTag = '';
let rootId = '';
let roomId = '';
let firstId = '';
let secondId = '';
let assignmentId = '';
let photoId = '';
let ownerName = '';

/** Calls the real API from the signed-in page (cookie + CSRF), for set-up and read-back. */
async function api<T = unknown>(
  p: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T; etag: string | null }> {
  return p.evaluate(
    async ({ method, path, body }) => {
      const me = (await (await fetch('/v1/auth/me')).json()) as { csrf_token: string };
      const res = await fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': me.csrf_token,
          'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}-${Date.now()}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return {
        status: res.status,
        json: (text ? JSON.parse(text) : null) as never,
        etag: res.headers.get('etag'),
      };
    },
    { method, path, body },
  );
}

/** Type into a combobox and choose the option with that name. */
async function pick(p: Page, name: RegExp | string, text: string, option: RegExp | string) {
  const box = p.getByRole('combobox', { name });
  await box.fill(text);
  await p.getByRole('option', { name: option }).first().click();
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('signs in and builds a location tree: campus, hall and room', async () => {
  await signInAsOwner(page);
  ownerName = (await api<{ user: { display_name: string } }>(page, 'GET', '/v1/auth/me')).json.user
    .display_name;

  await page.goto('/locations');
  await page.getByRole('button', { name: 'Add location' }).first().click();
  let dialog = page.getByRole('dialog', { name: 'Add a location' });
  await dialog.getByLabel(/^Name/).fill(ROOT);
  await dialog.getByRole('button', { name: 'Add location' }).click();
  await expect(page.getByText(`Location "${ROOT}" added.`).first()).toBeVisible();

  for (const name of [HALL, ROOM]) {
    await page.getByRole('button', { name: 'Add inside' }).click();
    dialog = page.getByRole('dialog', { name: 'Add a location' });
    await dialog.getByLabel(/^Name/).fill(name);
    await dialog.getByRole('button', { name: 'Add location' }).click();
    await expect(page.getByText(`Location "${name}" added.`).first()).toBeVisible();
  }
  await expect(page.getByTestId('location-name')).toHaveText(ROOM);
  await expect(page.getByText(`${ROOT} > ${HALL} > ${ROOM}`)).toBeVisible();

  const found = await api<{
    data: Array<{ id: string; name: string; depth: number; ancestor_ids: string[] }>;
  }>(page, 'GET', `/v1/locations?q=${encodeURIComponent(id)}&limit=50`);
  const byName = new Map(found.json.data.map((l) => [l.name, l]));
  expect(byName.get(ROOM)?.depth).toBe(2);
  expect(byName.get(ROOM)?.ancestor_ids).toHaveLength(3);
  rootId = byName.get(ROOT)!.id;
  roomId = byName.get(ROOM)!.id;
});

test('sets up an asset (with a serial) in the room and two people', async () => {
  const category = (
    await api<{ data: Array<{ id: string }> }>(page, 'GET', '/v1/categories?limit=1')
  ).json.data[0]!;
  const asset = await api<{ id: string; asset_tag: string }>(page, 'POST', '/v1/assets', {
    category_id: category.id,
    name: `Custody laptop ${id}`,
    serial: SERIAL,
    location_id: roomId,
  });
  expect(asset.status).toBe(201);
  assetId = asset.json.id;
  assetTag = asset.json.asset_tag;
  for (const name of [FIRST, SECOND]) {
    const person = await api<{ id: string }>(page, 'POST', '/v1/people', { display_name: name });
    expect(person.status).toBe(201);
    if (name === FIRST) firstId = person.json.id;
    else secondId = person.json.id;
  }
  // the location now counts the asset, in the room and in every ancestor
  const root = await api<{ asset_count: number; direct_asset_count: number }>(
    page,
    'GET',
    `/v1/locations/${rootId}`,
  );
  expect(root.json).toMatchObject({ asset_count: 1, direct_asset_count: 0 });
});

test('checks the asset out to the first person from the asset page', async () => {
  await page.goto(`/assets/view?id=${assetId}`);
  await expect(page.getByTestId('asset-tag')).toHaveText(assetTag);
  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Check out ${assetTag}` });
  await pick(page, /Person/, FIRST, new RegExp(FIRST));
  await dialog.getByLabel('Notes').fill('Term loan');
  await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(page.getByText(`${assetTag} checked out to ${FIRST}.`).first()).toBeVisible();
  await expect(page.getByTestId('asset-holder')).toContainText(`Assigned to ${FIRST}`);

  const assignments = await api<{ data: Array<{ id: string; person_id: string }> }>(
    page,
    'GET',
    `/v1/assets/${assetId}/assignments`,
  );
  expect(assignments.json.data[0]?.person_id).toBe(firstId);
});

test('transfers it to the second person', async () => {
  await page.getByRole('button', { name: 'Transfer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Transfer ${assetTag}` });
  await expect(dialog.getByText('From', { exact: true })).toBeVisible();
  await pick(page, /Person/, SECOND, new RegExp(SECOND));
  await dialog.getByLabel('Reason').fill('Class change');
  await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
  await expect(page.getByText(`${assetTag} transferred to ${SECOND}.`).first()).toBeVisible();
  await expect(page.getByTestId('asset-holder')).toContainText(SECOND);
});

test('checks in with a real photo: MinIO upload, ClamAV scan clean, photo on the assignment', async () => {
  await page.getByRole('button', { name: 'Check in', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: `Check in ${assetTag}` });
  await choose(page, 'Condition', 'Fair');
  await dialog.getByLabel('Notes').fill('Scratch on the lid');
  await dialog.locator('input[type=file]').setInputFiles({
    name: `lid-${id}.png`,
    mimeType: 'image/png',
    buffer: PNG,
  });
  await expect(dialog.getByRole('list', { name: 'Attached photos' })).toContainText(
    `lid-${id}.png`,
  );
  // the form submits only once the photo is clean (the worker asks ClamAV)
  const submit = dialog.getByRole('button', { name: 'Check in', exact: true });
  await expect(dialog.getByText('Waiting for the photo to finish')).toBeHidden({ timeout: 90_000 });
  await submit.click();
  await expect(page.getByText(`${assetTag} checked in.`).first()).toBeVisible();
  await expect(page.getByTestId('asset-holder')).toHaveCount(0);

  // the closed assignment carries the condition and the photo; the photo is clean and downloadable
  const list = await api<{
    data: Array<{
      id: string;
      checkin_condition: string | null;
      checkin_attachment_ids: string[];
      person_id: string;
    }>;
  }>(page, 'GET', `/v1/assets/${assetId}/assignments`);
  const closed = list.json.data[0]!;
  expect(closed).toMatchObject({ person_id: secondId, checkin_condition: 'fair' });
  expect(closed.checkin_attachment_ids).toHaveLength(1);
  assignmentId = closed.id;
  photoId = closed.checkin_attachment_ids[0]!;

  const photos = await api<{
    data: Array<{
      id: string;
      scan_status: string;
      entity_type: string;
      download_url: string | null;
      thumbnail_url: string | null;
    }>;
  }>(page, 'GET', `/v1/attachments?entity_type=assignment&entity_id=${assignmentId}`);
  expect(photos.json.data.map((a) => a.id)).toEqual([photoId]);
  const photo = photos.json.data[0]!;
  expect(photo).toMatchObject({ scan_status: 'clean', entity_type: 'assignment' });
  expect(photo.download_url).toBeTruthy();
  const bytes = await page.request.get(photo.download_url!);
  expect(bytes.status()).toBe(200);
  expect((await bytes.body()).subarray(1, 4).toString()).toBe('PNG');
});

test('the history timeline shows the chain of custody with the actors', async () => {
  await page.goto(`/assets/view?id=${assetId}&tab=history`);
  const history = page.getByRole('list', { name: 'History' });
  await expect(history.getByText(`Checked out to ${FIRST}`).first()).toBeVisible();
  await expect(history.getByText(/^Transferred/).first()).toBeVisible();
  await expect(history.getByText(/Checked in from/).first()).toBeVisible();
  await expect(history.getByText(`by ${ownerName}`).first()).toBeVisible();
  await expect(history.getByText('Condition: Fair').first()).toBeVisible();

  // the person's own timeline (GET /v1/people/{id}/history) has the same events for their asset
  await page.goto(`/people/view?id=${secondId}&tab=history`);
  const personHistory = page.getByRole('list', { name: 'History' });
  await expect(personHistory.getByText(assetTag).first()).toBeVisible();
});

test('an EICAR upload is scanned by ClamAV and rejected, and cannot be downloaded', async () => {
  await page.goto(`/assets/view?id=${assetId}&tab=attachments`);
  await page.locator('input[type=file]').setInputFiles({
    name: `eicar-${id}.csv`,
    mimeType: 'text/csv',
    buffer: Buffer.from(EICAR),
  });
  const row = page.getByRole('listitem').filter({ hasText: `eicar-${id}.csv` });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Rejected', { timeout: 90_000 });
  await expect(row.getByRole('button', { name: /Download/ })).toHaveCount(0);

  const infected = await api<{
    data: Array<{ filename: string; scan_status: string; download_url: string | null }>;
  }>(page, 'GET', `/v1/attachments?entity_type=asset&entity_id=${assetId}`);
  const entry = infected.json.data.find((a) => a.filename === `eicar-${id}.csv`);
  expect(entry).toMatchObject({ scan_status: 'infected', download_url: null });
});

test('scanning the serial number finds the asset', async () => {
  const found = await api<{ match_type: string; asset: { id: string } }>(
    page,
    'GET',
    `/v1/scan/resolve?code=${encodeURIComponent(SERIAL.toLowerCase())}`,
  );
  expect(found.status).toBe(200);
  expect(found.json).toMatchObject({ match_type: 'serial', asset: { id: assetId } });
});

test('the other tenant cannot see the location, the person, the assignment or the photo', async ({
  browser,
}) => {
  const other = await (await browser.newContext()).newPage();
  try {
    await other.goto('/login');
    await other.getByLabel(/^Email/).fill('viewer@globex.example');
    await other.getByLabel(/^Password/).fill(DEMO_PASSWORD);
    await other.getByRole('button', { name: 'Sign in' }).click();
    await expect(other.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(other.getByTestId('tenant-name').first()).toHaveText('Globex');

    for (const path of [
      `/v1/locations/${rootId}`,
      `/v1/locations/${roomId}`,
      `/v1/people/${secondId}`,
      `/v1/people/${secondId}/history`,
      `/v1/people/${secondId}/assignments`,
      `/v1/assets/${assetId}/assignments`,
      `/v1/attachments/${photoId}`,
    ]) {
      expect((await api(other, 'GET', path)).status, path).toBe(404);
    }
    // the lists show nothing of Acme's
    const locations = await api<{ data: unknown[] }>(
      other,
      'GET',
      `/v1/locations?q=${encodeURIComponent(id)}`,
    );
    expect(locations.json.data).toHaveLength(0);
    const people = await api<{ data: unknown[] }>(
      other,
      'GET',
      `/v1/people?q=${encodeURIComponent(id)}`,
    );
    expect(people.json.data).toHaveLength(0);
    const photos = await api<{ data: unknown[] }>(
      other,
      'GET',
      `/v1/attachments?entity_type=assignment&entity_id=${assignmentId}`,
    );
    expect(photos.json.data).toHaveLength(0);
    // (writes across tenants are covered by the API suite; the Globex viewer may not write at all)
    // the serial of Acme's asset resolves to nothing in Globex
    expect(
      (await api(other, 'GET', `/v1/scan/resolve?code=${encodeURIComponent(SERIAL)}`)).status,
    ).toBe(404);
    await other.goto(`/locations`);
    await expect(other.getByText(ROOT)).toHaveCount(0);
  } finally {
    await other.context().close();
  }
});
