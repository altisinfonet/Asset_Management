import { expect, test, type Page } from '@playwright/test';
import { api, choose, runId, signInAsOwner } from './support';

/**
 * A status label ("In repair") and a repair record are different things, and the demo data and the screens
 * must not drift apart. Against the REAL stack (compose api + Postgres, the demo seed), on the seeded Acme tenant:
 *
 *   1. every asset the seed put in "In repair" has an open repair: the Repairs page counts as many open
 *      repairs as there are assets with that label ("Broken" assets have none, and say so on their page);
 *   2. choosing "In repair" for an asset that has no repair shows the hint in the edit form; "Log a repair"
 *      opens the dialog prefilled for that asset and status; logging it removes the hint, keeps the edits;
 *   3. an asset saved as "In repair" by hand gets the banner on its page; logging a repair from it removes
 *      the banner, and completing that repair gives the asset back as ready.
 *
 * Names carry a per-run suffix, so the suite can run again on the same database.
 */
const id = runId();
const SENTENCE =
  'No repair is logged for this asset. Log a repair to track the problem, supplier and cost.';

test.describe.configure({ mode: 'serial' });

let page: Page;
let categoryId = '';
let inRepairId = '';
let readyId = '';
const made: Array<{ id: string; tag: string }> = [];

interface Paged<T> {
  data: T[];
  page: { next_cursor: string | null; has_more: boolean; total?: number };
}
interface Label {
  id: string;
  name: string;
  state_type: string;
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
  const asset = { id: res.json.id, tag: res.json.asset_tag };
  made.push(asset);
  return asset;
}

test('the Repairs page counts as many open repairs as there are assets in "In repair"', async () => {
  await signInAsOwner(page);
  const labels = (await api<Paged<Label>>(page, 'GET', '/v1/status-labels?limit=200')).json.data;
  inRepairId = labels.find((l) => l.name === 'In repair')!.id;
  readyId = labels.find((l) => l.name === 'Ready to deploy')!.id;
  const brokenId = labels.find((l) => l.name === 'Broken')!.id;
  categoryId = (await api<Paged<{ id: string }>>(page, 'GET', '/v1/categories?kind=asset&limit=1'))
    .json.data[0]!.id;

  // Assets an import made (the Google Admin run of import-wizard.spec.ts maps disabled devices to this
  // label and, like any import, writes no repair records) are not the demo data this test is about.
  const inRepairAll = await api<Paged<{ id: string; external_source?: string | null }>>(
    page,
    'GET',
    `/v1/assets?status_id=${inRepairId}&limit=200&include_total=true`,
  );
  const inRepair = {
    json: { data: inRepairAll.json.data.filter((a) => a.external_source !== 'google_admin') },
  };
  const labelled = inRepair.json.data.length;
  expect(labelled).toBeGreaterThan(0);

  const open = await api<Paged<{ asset_id: string; set_status_id: string | null }>>(
    page,
    'GET',
    '/v1/repairs?status=open,in_progress&limit=200&include_total=true',
  );
  expect(open.json.page.total).toBe(labelled);
  // and they are the same assets, each held by its record
  expect(open.json.data.map((r) => r.asset_id).sort()).toEqual(
    inRepair.json.data.map((a) => a.id).sort(),
  );
  expect(open.json.data.every((r) => r.set_status_id === inRepairId)).toBe(true);

  // what the person sees: the Open tab of the Repairs page, and the dashboard panel
  await page.goto('/repairs');
  await expect(page.getByRole('tab', { name: /Open/ })).toContainText(String(labelled));
  await expect(page.getByRole('row', { name: /Open|In progress/ }).first()).toBeVisible();
  await page.goto('/');
  await expect(page.getByTestId('panel-repairs').getByRole('listitem').first()).toBeVisible();

  // "Broken" is not "being repaired": those assets have no record, and the page says so
  const broken = await api<Paged<{ id: string }>>(
    page,
    'GET',
    `/v1/assets?status_id=${brokenId}&limit=1`,
  );
  const first = broken.json.data[0]!;
  expect(
    (await api<{ total_count: number }>(page, 'GET', `/v1/assets/${first.id}/repair-summary`)).json
      .total_count,
  ).toBe(0);
  await page.goto(`/assets/view?id=${first.id}`);
  await expect(page.getByTestId('no-repair-notice')).toHaveText(SENTENCE);
});

test('editing an asset to "In repair" shows the hint; Log a repair opens the dialog prefilled and removes it', async () => {
  const asset = await newAsset('Hint');
  await page.goto(`/assets/edit?id=${asset.id}`);
  const status = page.getByRole('combobox', { name: 'Status' });
  await expect(status).toBeVisible();
  await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);

  await page.getByRole('textbox', { name: 'Serial number' }).fill(`SN-ND-${id}`);
  await choose(page, 'Status', 'In repair');
  const hint = page.getByTestId('no-repair-notice');
  await expect(hint).toHaveText(new RegExp(SENTENCE));

  await hint.getByRole('button', { name: 'Log a repair' }).click();
  const dialog = page.getByRole('dialog', { name: `Log a repair for ${asset.tag}` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: /^Asset\(required\)/ })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: /^Asset status while/ })).toContainText(
    'In repair',
  );
  await dialog.getByRole('textbox', { name: /^What needs doing/ }).fill(`Screen flicker ${id}`);
  await dialog.getByRole('textbox', { name: /^Quoted cost/ }).fill('80');
  await dialog.getByRole('button', { name: 'Log repair' }).click();
  const files = page.getByRole('dialog', { name: 'Repair logged' });
  await expect(files).toBeVisible();
  await files.getByRole('button', { name: 'Done' }).click();

  await expect(hint).toHaveCount(0);
  await expect(page.getByRole('textbox', { name: 'Serial number' })).toHaveValue(`SN-ND-${id}`);
  await expect(status).toContainText('In repair');
  // the repair moved the asset; saving the rest of the form still works
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/assets/view/?\\?id=${asset.id}`));
  await expect(page.getByTestId('asset-tag')).toHaveText(asset.tag);
  await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);
  const saved = await api<{ serial: string; status_id: string }>(
    page,
    'GET',
    `/v1/assets/${asset.id}`,
  );
  expect(saved.json).toMatchObject({ serial: `SN-ND-${id}`, status_id: inRepairId });
  const repairs = await api<Paged<{ title: string; status: string; set_status_id: string | null }>>(
    page,
    'GET',
    `/v1/repairs?asset_id=${asset.id}`,
  );
  expect(repairs.json.data).toHaveLength(1);
  expect(repairs.json.data[0]).toMatchObject({
    title: `Screen flicker ${id}`,
    status: 'open',
    set_status_id: inRepairId,
  });
});

test('an asset put in "In repair" by hand gets the banner; logging a repair removes it and closing it gives the asset back as ready', async () => {
  const asset = await newAsset('Banner');
  // the status edit, with no repair
  await page.goto(`/assets/edit?id=${asset.id}`);
  await expect(page.getByRole('combobox', { name: 'Status' })).toBeVisible();
  await choose(page, 'Status', 'In repair');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/assets/view/?\\?id=${asset.id}`));

  const banner = page.getByTestId('no-repair-notice');
  await expect(banner).toHaveText(SENTENCE);
  await page.getByRole('button', { name: 'Log a repair' }).click();
  const dialog = page.getByRole('dialog', { name: `Log a repair for ${asset.tag}` });
  await dialog.getByRole('textbox', { name: /^What needs doing/ }).fill(`Dead battery ${id}`);
  await dialog.getByRole('button', { name: 'Log repair' }).click();
  await page
    .getByRole('dialog', { name: 'Repair logged' })
    .getByRole('button', { name: 'Done' })
    .click();
  await expect(banner).toHaveCount(0);

  // it holds the status now, and completing it gives the asset back as ready
  const repairs = await api<Paged<{ id: string; set_status_id: string | null }>>(
    page,
    'GET',
    `/v1/repairs?asset_id=${asset.id}`,
  );
  expect(repairs.json.data[0]!.set_status_id).toBe(inRepairId);
  await page.getByRole('tab', { name: 'Repairs' }).click();
  await page.getByRole('button', { name: `Open repair Dead battery ${id}` }).click();
  const drawer = page.getByRole('dialog', { name: `Dead battery ${id}` });
  await drawer.getByRole('button', { name: 'Close repair' }).click();
  const close = page.getByRole('dialog', { name: `Close repair "Dead battery ${id}"` });
  await close.getByRole('button', { name: 'Close repair' }).click();
  await expect(page.getByText('Repair closed.').first()).toBeVisible();
  const after = await api<{ status_id: string }>(page, 'GET', `/v1/assets/${asset.id}`);
  expect(after.json.status_id).toBe(readyId);
  await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);
});

test('the open repairs and the "In repair" assets still agree after all of that', async () => {
  // not the assets an import made (see the first test)
  const labelled = (
    await api<Paged<{ external_source?: string | null }>>(
      page,
      'GET',
      `/v1/assets?status_id=${inRepairId}&limit=200`,
    )
  ).json.data.filter((a) => a.external_source !== 'google_admin').length;
  const open = (
    await api<Paged<{ id: string }>>(
      page,
      'GET',
      '/v1/repairs?status=open,in_progress&limit=1&include_total=true',
    )
  ).json.page.total;
  expect(open).toBe(labelled);
});
