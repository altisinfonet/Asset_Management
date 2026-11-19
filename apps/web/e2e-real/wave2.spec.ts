import { expect, test, type Page } from '@playwright/test';
import {
  api,
  choose,
  pick,
  runId,
  signInAsOwner,
  signInWithPassword,
  waitForMailWithSubject,
  DEMO_OWNER,
} from './support';

/**
 * M2 wave 2 against the REAL stack (compose api + worker + Postgres + MinIO + ClamAV + Mailpit), no mock.
 * One signed-in story on the seeded Acme tenant, in order:
 *
 *   labels (async batch, a real one-page PDF) -> an accessory handed out and partly returned (holders by
 *   name) -> a consumable that falls below its minimum (bell with a link to the item + the mail) -> a
 *   repair that moves the asset to "in repair" and gives the old status back (cost totals) -> a saved view
 *   shared with a colleague -> a CSV export -> the security page and the MFA policy -> Globex cannot reach
 *   any of it (404 by id, absent from every list).
 *
 * Names carry a per-run suffix, so the suite can run again on the same database.
 */
const id = runId();
const TERM = `W2 ${id}`; // every asset of this run is called "W2 <id> ..."
const ACCESSORY = `E2E Charger ${id}`;
const CONSUMABLE = `E2E Toner ${id}`;
const ACC_CATEGORY = `E2E Accessories ${id}`;
const CON_CATEGORY = `E2E Supplies ${id}`;
const HOLDER = `Ada Holder ${id}`;
const VIEW = `W2 view ${id}`;
const REPAIR = `Cracked hinge ${id}`;
const COLLEAGUE = 'admin@acme.example';
const OTHER_TENANT_USER = 'admin@globex.example';

test.describe.configure({ mode: 'serial' });

let page: Page;
let accessoryId = '';
let consumableId = '';
let repairId = '';
let repairAssetId = '';
let repairAssetTag = '';
let viewId = '';
let exportId = '';
let batchId = '';
let notificationId = '';
let exportAssetTag = '';
let labelTags: string[] = [];

interface Page_<T> {
  data: T[];
  page: { next_cursor: string | null; has_more: boolean; total?: number };
}

/** A real PDF has the header, and one `/Type /Page` object per sheet. */
function pdfPages(pdf: Buffer): number {
  return (pdf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

/** Reads the bytes behind a link of the page (a presigned MinIO URL or a same-origin file). */
async function download(href: string): Promise<Buffer> {
  const res = await fetch(href);
  expect(res.status, href).toBe(200);
  return Buffer.from(await res.arrayBuffer());
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('signs in and sets up the data of the run: categories, a person and five assets', async () => {
  await signInAsOwner(page);
  const asset = (await api<Page_<{ id: string }>>(page, 'GET', '/v1/categories?kind=asset&limit=1'))
    .json.data[0]!;
  for (const [name, kind] of [
    [ACC_CATEGORY, 'accessory'],
    [CON_CATEGORY, 'consumable'],
  ] as const) {
    const made = await api(page, 'POST', '/v1/categories', { name, kind });
    expect(made.status, name).toBe(201);
  }
  expect((await api(page, 'POST', '/v1/people', { display_name: HOLDER })).status).toBe(201);

  const tags: Record<string, string> = {};
  for (const n of ['label 1', 'label 2', 'label 3', 'repair', 'export']) {
    const made = await api<{ id: string; asset_tag: string }>(page, 'POST', '/v1/assets', {
      category_id: asset.id,
      name: `${TERM} ${n}`,
      serial: `SN-W2-${id}-${n.replace(' ', '')}`,
    });
    expect(made.status, n).toBe(201);
    tags[n] = made.json.asset_tag;
    if (n === 'repair') {
      repairAssetId = made.json.id;
      repairAssetTag = made.json.asset_tag;
    }
  }
  labelTags = [tags['label 1']!, tags['label 2']!, tags['label 3']!];
  exportAssetTag = tags['export']!;
});

test('prints labels for three assets: a batch is queued, made, and downloads as a one-page PDF', async () => {
  await page.goto('/assets');
  await page.getByPlaceholder('Tag, serial or name').fill(`${TERM} label`);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-3 of 3');
  for (const tag of labelTags) {
    await page.getByRole('checkbox', { name: `Select row ${tag}` }).click();
  }
  await page.getByRole('button', { name: 'Print labels (3)' }).click();
  const dialog = page.getByRole('dialog', { name: 'Print labels' });
  await expect(dialog.getByTestId('labels-source')).toHaveText('3 selected assets');
  await expect(dialog.getByTestId('label-preview')).toBeVisible();
  await dialog.getByRole('button', { name: 'Generate PDF' }).click();

  // the worker renders the sheet; the dialog follows the batch until it is ready
  const ready = dialog.getByTestId('labels-ready');
  await expect(ready).toContainText('3 labels on 1 sheet', { timeout: 90_000 });
  const link = ready.getByRole('link', { name: 'Download PDF' });
  const pdf = await download((await link.getAttribute('href'))!);
  expect(pdf.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(pdfPages(pdf)).toBe(1);

  const batches = await api<Page_<{ id: string; status: string; label_count: number }>>(
    page,
    'GET',
    '/v1/labels/batches?limit=1',
  );
  expect(batches.json.data[0]).toMatchObject({ status: 'ready', label_count: 3 });
  batchId = batches.json.data[0]!.id;
  // every asset on the sheet got a "label printed" entry
  const history = await api<Page_<{ event_type: string }>>(
    page,
    'GET',
    `/v1/assets?q=${encodeURIComponent(labelTags[0]!)}&limit=1`,
  );
  const first = history.json.data[0] as unknown as { id: string };
  await expect
    .poll(async () =>
      (
        await api<Page_<{ event_type: string }>>(
          page,
          'GET',
          `/v1/assets/${first.id}/history?limit=20`,
        )
      ).json.data.some((e) => e.event_type === 'label_printed'),
    )
    .toBe(true);
  await page.keyboard.press('Escape');
});

test('an accessory: units handed to a person, a partial return, the holders by name', async () => {
  await page.goto('/stock');
  await page.getByRole('button', { name: 'New accessory' }).click();
  let dialog = page.getByRole('dialog', { name: 'New accessory' });
  await dialog.getByRole('textbox', { name: /^Name/ }).fill(ACCESSORY);
  await dialog.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: ACC_CATEGORY }).click();
  await dialog.getByRole('spinbutton', { name: /^Total quantity/ }).fill('10');
  await dialog.getByRole('spinbutton', { name: /^Minimum stock/ }).fill('2');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/stock\/view\/?\?kind=accessory&id=/);
  accessoryId = new URL(page.url()).searchParams.get('id')!;
  await expect(page.getByRole('heading', { level: 1, name: ACCESSORY })).toBeVisible();
  await expect(page.getByTestId('figure-available')).toHaveText('10');

  await page.getByRole('button', { name: 'Check out', exact: true }).click();
  dialog = page.getByRole('dialog', { name: `Check out ${ACCESSORY}` });
  await pick(page, /Person/, HOLDER, new RegExp(HOLDER));
  await dialog.getByRole('spinbutton', { name: /^Quantity/ }).fill('6');
  await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
  await expect(
    page.getByText(new RegExp(`6 x ${ACCESSORY} checked out to ${HOLDER}`)).first(),
  ).toBeVisible();
  await expect(page.getByTestId('figure-available')).toHaveText('4');

  // who holds them: the name comes with the assignment (target_name), no lookup per row
  const holders = page.getByRole('table', { name: 'People and places holding this' });
  const row = holders.getByRole('row', { name: new RegExp(HOLDER) });
  await expect(row).toContainText('6');
  await row.getByRole('button', { name: /^Return units from/ }).click();
  const ret = page.getByRole('dialog', { name: new RegExp(`^Return units of ${ACCESSORY}`) });
  await ret.getByRole('spinbutton', { name: /^Units coming back/ }).fill('2');
  await ret.getByRole('button', { name: 'Return', exact: true }).click();
  await expect(page.getByText('2 returned. 4 still out.').first()).toBeVisible();
  await expect(page.getByTestId('figure-available')).toHaveText('6');
  await expect(holders.getByRole('row', { name: new RegExp(HOLDER) })).toContainText('2');

  const open = await api<
    Page_<{
      target_name: string;
      accessory_name: string;
      quantity: number;
      quantity_returned: number;
    }>
  >(page, 'GET', `/v1/accessories/${accessoryId}/assignments?state=open`);
  expect(open.json.data).toHaveLength(1);
  expect(open.json.data[0]).toMatchObject({
    target_name: HOLDER,
    accessory_name: ACCESSORY,
    quantity: 6,
    quantity_returned: 2,
  });
  const item = await api<{ qty_total: number; qty_checked_out: number; qty_available: number }>(
    page,
    'GET',
    `/v1/accessories/${accessoryId}`,
  );
  expect(item.json).toMatchObject({ qty_total: 10, qty_checked_out: 4, qty_available: 6 });
});

test('a consumable that falls below its minimum: a Low stock notification in the bell and a mail', async () => {
  // the default for this type is a daily digest: ask for a mail right away, on the settings screen
  await page.goto('/account/notifications');
  // (a rerun finds it already set: nothing to save then)
  const email = page.getByRole('combobox', { name: 'E-mail for Low stock' });
  await expect(email).toBeVisible();
  if (!(await email.innerText()).includes('Right away')) {
    await choose(page, 'E-mail for Low stock', 'Right away');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Notification settings saved.').first()).toBeVisible();
  }
  const prefs = await api<Array<unknown> & { data: Array<{ type: string; email: string }> }>(
    page,
    'GET',
    '/v1/notification-preferences',
  );
  expect(prefs.json.data.find((p) => p.type === 'consumable.low_stock')?.email).toBe('immediate');

  await page.goto('/stock?kind=consumable');
  await page.getByRole('button', { name: 'New consumable' }).click();
  const dialog = page.getByRole('dialog', { name: 'New consumable' });
  await dialog.getByRole('textbox', { name: /^Name/ }).fill(CONSUMABLE);
  await dialog.getByRole('combobox', { name: /^Category/ }).click();
  await page.getByRole('option', { name: CON_CATEGORY }).click();
  await dialog.getByRole('textbox', { name: /^Unit/ }).fill('box');
  await dialog.getByRole('spinbutton', { name: /^Minimum stock/ }).fill('4');
  await dialog.getByRole('spinbutton', { name: /^Quantity on hand/ }).fill('10');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await expect(page).toHaveURL(/\/stock\/view\/?\?kind=consumable&id=/);
  consumableId = new URL(page.url()).searchParams.get('id')!;
  await expect(page.getByTestId('figure-on-hand')).toHaveText('10 box');

  // 10 -> 3: at or below the minimum of 4, once
  await page.getByRole('button', { name: 'Use', exact: true }).click();
  const use = page.getByRole('dialog', { name: `Use ${CONSUMABLE}` });
  await use.getByRole('spinbutton', { name: /^Units used/ }).fill('7');
  await use.getByRole('button', { name: 'Use', exact: true }).click();
  await expect(page.getByTestId('figure-on-hand')).toHaveText('3 box');
  await expect(page.getByText('Low stock').first()).toBeVisible();

  // the notification (made by the worker from the outbox event) links to the stock item
  await expect
    .poll(
      async () => {
        const list = await api<
          Page_<{ id: string; type: string; link: string | null; entity_id: string | null }>
        >(page, 'GET', '/v1/notifications?unread=true&limit=50');
        const found = list.json.data.find(
          (n) => n.type === 'consumable.low_stock' && n.entity_id === consumableId,
        );
        if (found) {
          notificationId = found.id;
          expect(found.link).toBe(`/stock/view?kind=consumable&id=${consumableId}`);
        }
        return !!found;
      },
      { timeout: 60_000 },
    )
    .toBe(true);

  await page.goto('/');
  await page.getByRole('button', { name: /^Notifications, \d+ unread/ }).click();
  const panel = page.getByRole('dialog', { name: 'Notifications' });
  await expect(panel.getByRole('listitem').first()).toContainText(`Low stock: ${CONSUMABLE}`);
  await panel.getByRole('button', { name: `View: Low stock: ${CONSUMABLE}` }).click();
  await expect(page).toHaveURL(new RegExp(`/stock/view/?\\?kind=consumable&id=${consumableId}`));
  await expect(page.getByRole('heading', { level: 1, name: CONSUMABLE })).toBeVisible();

  // and the mail, since the preference asks for one right away
  const mail = await waitForMailWithSubject(DEMO_OWNER, `Low stock: ${CONSUMABLE}`);
  expect(mail.Text).toContain(CONSUMABLE);
  expect(mail.To.map((t) => t.Address)).toContain(DEMO_OWNER);
});

test('a repair moves the asset to "in repair" and completing it gives the old status back', async () => {
  const before = await api<{ status_id: string }>(page, 'GET', `/v1/assets/${repairAssetId}`);
  const beforeStatus = before.json.status_id;

  await page.goto(`/assets/view?id=${repairAssetId}&tab=repairs`);
  await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Log repair' }).first().click();
  const dialog = page.getByRole('dialog', { name: `Log a repair for ${repairAssetTag}` });
  await dialog.getByRole('textbox', { name: /^What needs doing/ }).fill(REPAIR);
  await dialog.getByRole('textbox', { name: /^Quoted cost/ }).fill('45.50');
  await dialog.getByRole('button', { name: 'Log repair' }).click();
  const files = page.getByRole('dialog', { name: 'Repair logged' });
  await expect(files).toBeVisible();
  await files.getByRole('button', { name: 'Done' }).click();

  // in repair: the status changed and the asset cannot be checked out
  const during = await api<{ status_id: string }>(page, 'GET', `/v1/assets/${repairAssetId}`);
  expect(during.json.status_id).not.toBe(beforeStatus);
  await expect(page.getByTestId('repairs-summary')).toHaveText('1 repair, $45.50 in total');
  await page.goto(`/assets/view?id=${repairAssetId}&tab=repairs`);
  await expect(page.getByRole('button', { name: 'Check out', exact: true })).toHaveCount(0);
  const repairs = await api<
    Page_<{ id: string; set_status_id: string | null; vendor_name: string | null }>
  >(page, 'GET', `/v1/repairs?asset_id=${repairAssetId}`);
  repairId = repairs.json.data[0]!.id;
  expect(repairs.json.data[0]!.set_status_id).toBe(during.json.status_id);

  // complete it with the real cost
  await page.getByRole('button', { name: `Open repair ${REPAIR}` }).click();
  const drawer = page.getByRole('dialog', { name: REPAIR });
  await drawer.getByRole('button', { name: 'Close repair' }).click();
  const close = page.getByRole('dialog', { name: `Close repair "${REPAIR}"` });
  await close.getByRole('textbox', { name: /^Final cost/ }).fill('52');
  await close.getByRole('textbox', { name: /^What was done/ }).fill('New hinge fitted');
  await close.getByRole('button', { name: 'Close repair' }).click();
  await expect(page.getByText('Repair closed.').first()).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();

  // the previous status is back, and the total (from repair-summary) shows the final cost
  const after = await api<{ status_id: string }>(page, 'GET', `/v1/assets/${repairAssetId}`);
  expect(after.json.status_id).toBe(beforeStatus);
  await expect(page.getByTestId('repairs-summary')).toHaveText('1 repair, $52.00 in total');
  const summary = await api<{
    open_count: number;
    total_count: number;
    total_cost: Array<{ amount_minor: number; currency: string }>;
  }>(page, 'GET', `/v1/assets/${repairAssetId}/repair-summary`);
  expect(summary.json).toMatchObject({ open_count: 0, total_count: 1 });
  expect(summary.json.total_cost).toEqual([{ amount_minor: 5200, currency: expect.any(String) }]);
  await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();
});

test('a saved view is kept, shared, and used by a colleague', async ({ browser }) => {
  await page.goto('/assets');
  await page.getByPlaceholder('Tag, serial or name').fill(TERM);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-5 of 5');
  await page.getByRole('button', { name: 'Save view' }).click();
  const save = page.getByRole('dialog', { name: 'Save this view' });
  await save.getByLabel(/^View name/).fill(VIEW);
  await save.getByRole('checkbox', { name: /Share with everyone/ }).click();
  await save.getByRole('button', { name: 'Save view' }).click();
  await expect(page.getByRole('combobox', { name: 'View' })).toContainText(`${VIEW} (shared)`);

  const mine = await api<
    Page_<{
      id: string;
      name: string;
      is_shared: boolean;
      is_owner: boolean;
      filters: { q?: string };
    }>
  >(page, 'GET', '/v1/saved-views?limit=100');
  const view = mine.json.data.find((v) => v.name === VIEW)!;
  expect(view).toMatchObject({ is_shared: true, is_owner: true });
  expect(view.filters.q).toBe(TERM);
  viewId = view.id;

  // after a reload the view applies again
  await page.reload();
  await expect(page.getByTestId('assets-range')).toContainText('of ');
  await choose(page, 'View', `${VIEW} (shared)`);
  await expect(page.getByPlaceholder('Tag, serial or name')).toHaveValue(TERM);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-5 of 5');

  // a colleague sees it as somebody else's shared view: usable, not editable
  const colleague = await signInWithPassword(browser, COLLEAGUE);
  try {
    const theirs = await api<Page_<{ id: string; is_shared: boolean; is_owner: boolean }>>(
      colleague,
      'GET',
      '/v1/saved-views?limit=100',
    );
    expect(theirs.json.data.find((v) => v.id === viewId)).toMatchObject({
      is_shared: true,
      is_owner: false,
    });
    await colleague.goto('/assets');
    await choose(colleague, 'View', `${VIEW} (shared)`);
    await expect(colleague.getByTestId('assets-range')).toHaveText('Showing 1-5 of 5');
    await expect(colleague.getByRole('button', { name: 'Rename or share' })).toHaveCount(0);
    await expect(colleague.getByRole('button', { name: 'Delete view' })).toHaveCount(0);
    const refused = await api(colleague, 'DELETE', `/v1/saved-views/${viewId}`, undefined, {
      'if-match': 'W/"1"',
    });
    expect(refused.status).toBe(404);
  } finally {
    await colleague.context().close();
  }
});

test('exports the asset list as CSV: header row and the assets of this run', async () => {
  await page.goto('/assets');
  await page.getByPlaceholder('Tag, serial or name').fill(TERM);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-5 of 5');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  const dialog = page.getByRole('dialog', { name: 'Export to CSV' });
  const link = dialog.getByRole('link', { name: 'Download CSV' });
  await expect(link).toBeVisible({ timeout: 90_000 });
  await expect(dialog.getByTestId('export-status')).toContainText('5 rows exported.');
  const bytes = await download((await link.getAttribute('href'))!);
  // a byte order mark, then CRLF lines like spreadsheets expect
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const lines = bytes.subarray(3).toString('utf8').trim().split('\r\n');
  expect(lines[0]).toContain('asset_tag');
  expect(lines[0]).toContain('name');
  expect(lines).toHaveLength(6);
  expect(lines.slice(1).some((line) => line.includes(exportAssetTag))).toBe(true);
  expect(lines.slice(1).every((line) => line.includes(TERM))).toBe(true);

  const jobs = await api<
    Page_<{ id: string; status: string; resource: string; row_count: number }>
  >(page, 'GET', '/v1/exports?limit=1');
  expect(jobs.json.data[0]).toMatchObject({
    status: 'succeeded',
    resource: 'assets',
    row_count: 5,
  });
  exportId = jobs.json.data[0]!.id;
  await page.keyboard.press('Escape');
});

test('the security page follows the organisation policy for two-step verification', async () => {
  const me = await api<{
    mfa_policy: { required: boolean; scope: string };
    user: { mfa_enabled: boolean };
  }>(page, 'GET', '/v1/auth/me');
  // the demo organisation enforces nothing; the page must say the same as the API does
  expect(me.json.mfa_policy).toEqual({ required: false, scope: 'off' });
  expect(me.json.user.mfa_enabled).toBe(true);

  await page.goto('/account/security');
  await expect(
    page.getByRole('heading', { level: 2, name: /Two-step verification/ }),
  ).toBeVisible();
  const turnOff = page.getByRole('button', { name: 'Turn off', exact: true });
  await expect(turnOff).toBeEnabled();
  await expect(page.getByText(/so you cannot turn it off/)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'New recovery codes' })).toBeEnabled();
  await expect(page.getByRole('table', { name: 'Signed-in devices' })).toBeVisible();
});

test('the other tenant (Globex) cannot reach any of it: 404 by id, absent from the lists', async ({
  browser,
}) => {
  const other = await signInWithPassword(browser, OTHER_TENANT_USER);
  try {
    await expect(other.getByTestId('tenant-name').first()).toHaveText('Globex');
    for (const path of [
      `/v1/accessories/${accessoryId}`,
      `/v1/accessories/${accessoryId}/assignments`,
      `/v1/consumables/${consumableId}`,
      `/v1/consumables/${consumableId}/movements`,
      `/v1/repairs/${repairId}`,
      `/v1/assets/${repairAssetId}/repair-summary`,
      `/v1/saved-views/${viewId}`,
      `/v1/exports/${exportId}`,
      `/v1/labels/batches/${batchId}`,
    ]) {
      expect((await api(other, 'GET', path)).status, path).toBe(404);
    }
    expect((await api(other, 'POST', `/v1/notifications/${notificationId}/read`)).status).toBe(404);
    const sharing = await api(
      other,
      'PUT',
      `/v1/saved-views/${viewId}/sharing`,
      { shared: false },
      {
        'if-match': 'W/"1"',
      },
    );
    expect(sharing.status).toBe(404);

    const q = encodeURIComponent(id);
    for (const path of [
      `/v1/accessories?q=${q}&limit=50`,
      `/v1/consumables?q=${q}&limit=50`,
      `/v1/repairs?limit=100`,
      `/v1/saved-views?limit=100`,
      `/v1/exports?limit=100`,
      `/v1/labels/batches?limit=100`,
      `/v1/notifications?limit=100`,
      `/v1/assets?q=${q}&limit=50`,
    ]) {
      const list = await api<Page_<{ id: string }>>(other, 'GET', path);
      expect(list.status, path).toBe(200);
      const ids = new Set(list.json.data.map((row) => row.id));
      for (const ours of [
        accessoryId,
        consumableId,
        repairId,
        repairAssetId,
        viewId,
        exportId,
        batchId,
        notificationId,
      ]) {
        expect(ids.has(ours), `${path} lists ${ours}`).toBe(false);
      }
    }
    await other.goto('/stock');
    await expect(other.getByText(ACCESSORY)).toHaveCount(0);
  } finally {
    await other.context().close();
  }
});
