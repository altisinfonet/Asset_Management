import { expect, test, type Page } from '@playwright/test';
import { choose, runId, signInAsOwner, waitForMail } from './support';

/**
 * M1-WEB-11: the web app against the REAL stack (compose api + Postgres + worker + Mailpit), no mock.
 * One signed-in story on the seeded Acme tenant, in order, each step building on the previous one:
 *
 *   sign in (password + TOTP) -> category with a custom field -> asset (generated tag) -> edit and a
 *   412 conflict -> list search and filter -> bulk archive / restore -> command palette search ->
 *   tag numbering template (PUT with If-Match) -> invite a user and read the mail in Mailpit -> sign out.
 *
 * Names, prefixes and e-mails carry a per-run suffix, so the suite can run again on the same database.
 */
const id = runId();
const PREFIX = `E${id}-`; // category tag prefix (A-Z, 0-9, -; at most 12)
const CATEGORY = `E2E Monitor ${id}`;
const FIELD = `Panel brand ${id}`;
const INVITEE = `e2e.${id.toLowerCase()}@acme.example`;

test.describe.configure({ mode: 'serial' });

let page: Page;
let assetId = '';

/** Calls the real API from the signed-in page (cookie + CSRF), for set-up that is not under test. */
async function api<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<{ status: number; json: T; etag: string | null }> {
  return page.evaluate(
    async ({ method, path, body, headers }) => {
      const me = (await (await fetch('/v1/auth/me')).json()) as { csrf_token: string };
      const res = await fetch(path, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': me.csrf_token,
          ...headers,
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
    { method, path, body, headers },
  );
}

/** Every non-2xx answer the app got from the API, to tell expected problems from surprises. */
const failures: string[] = [];

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
  page.on('response', (res) => {
    if (res.url().includes('/v1/') && res.status() >= 400) {
      failures.push(`${res.status()} ${res.request().method()} ${new URL(res.url()).pathname}`);
    }
  });
});
test.afterAll(async () => {
  console.log(`API answers >= 400 during the run:\n${failures.join('\n')}`);
  await page.context().close();
});

test('signs in with password and TOTP and lands on the dashboard of the Acme tenant', async () => {
  await signInAsOwner(page);
  await expect(page.getByTestId('tenant-name').first()).toHaveText('Acme');
  // the API status tile reads GET /v1/health through the typed client
  await expect(page.getByText('API status')).toBeVisible();
});

test('creates a category and a custom field for it', async () => {
  await page.goto('/settings/categories');
  await page.getByRole('button', { name: 'New category' }).click();
  const dialog = page.getByRole('dialog', { name: 'New category' });
  await dialog.getByLabel(/^Name/).fill(CATEGORY);
  await dialog.getByLabel('Tag prefix').fill(PREFIX);
  await dialog.getByRole('button', { name: 'Create category' }).click();
  await expect(page.getByRole('row', { name: new RegExp(CATEGORY) })).toBeVisible();

  await page.goto('/settings/fields');
  await page.getByRole('button', { name: 'New field' }).click();
  const builder = page.getByRole('dialog', { name: 'New field' });
  await builder.getByLabel(/^Label/).fill(FIELD);
  await choose(page, /^Type/, /^Text$/);
  await choose(page, /^Applies to/, CATEGORY);
  await builder.getByRole('button', { name: 'Create field' }).click();
  await expect(builder).toBeHidden();
  await choose(page, /^Show fields for/, CATEGORY);
  await expect(page.getByRole('row', { name: new RegExp(FIELD) })).toBeVisible();
});

test('creates an asset: the tag is generated from the category prefix and the custom field is saved', async () => {
  await page.goto('/assets/new');
  await choose(page, /^Category/, CATEGORY);
  await expect(page.getByRole('group', { name: `Fields for ${CATEGORY}` })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(`Lobby display ${id}`);
  await page.getByLabel('Serial number').fill(`SN-${id}`);
  await page.getByLabel(new RegExp(`^${FIELD}`)).fill('Iiyama');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('asset-tag')).toHaveText(`${PREFIX}00001`);
  await expect(page.getByText('Iiyama')).toBeVisible();
  assetId = new URL(page.url()).searchParams.get('id') ?? '';
  expect(assetId).toMatch(/^[0-9a-f-]{36}$/);
});

test('edits the asset, and a concurrent change answers 412 with a way to keep my work', async () => {
  await page.goto(`/assets/edit?id=${assetId}`);
  await expect(page.getByRole('heading', { name: 'Edit asset', level: 1 })).toBeVisible();
  await page.getByLabel('Name', { exact: true }).fill(`Lobby display ${id} (renamed)`);
  await page.keyboard.press('Control+Enter');
  await expect(page.getByRole('heading', { name: `Lobby display ${id} (renamed)` })).toBeVisible();

  // second edit: somebody else saves a different field first
  await page.goto(`/assets/edit?id=${assetId}`);
  await expect(page.getByRole('textbox', { name: /^Tag/ })).toHaveValue(`${PREFIX}00001`);
  const read = await api<{ notes: string | null }>('GET', `/v1/assets/${assetId}`);
  const other = await api(
    'PATCH',
    `/v1/assets/${assetId}`,
    { notes: 'changed by someone else' },
    {
      'if-match': read.etag ?? '',
    },
  );
  expect(other.status).toBe(200);

  await page.getByLabel('Serial number').fill(`SN-${id}-MINE`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const banner = page.getByRole('status').filter({ hasText: 'This asset changed' });
  await expect(banner).toBeVisible();
  await banner.getByRole('button', { name: 'Reload and keep my changes' }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByLabel('Notes')).toHaveValue('changed by someone else');
  await expect(page.getByLabel('Serial number')).toHaveValue(`SN-${id}-MINE`);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByTestId('asset-tag')).toHaveText(`${PREFIX}00001`);
  await expect(page.getByText(`SN-${id}-MINE`).first()).toBeVisible();
});

test('the list searches and filters; bulk archive and restore use the bulk endpoints', async () => {
  // two more assets of the category, created through the API
  const category = (
    await api<{ data: Array<{ id: string; name: string }> }>(
      'GET',
      `/v1/categories?q=${encodeURIComponent(CATEGORY)}`,
    )
  ).json.data[0]!;
  for (const n of [2, 3]) {
    const created = await api('POST', '/v1/assets', {
      category_id: category.id,
      name: `Spare ${n}`,
    });
    expect(created.status).toBe(201);
  }

  await page.goto('/assets');
  await page.getByPlaceholder('Tag, serial or name').fill(PREFIX);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-3 of 3');
  await choose(page, 'Category', CATEGORY);
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-3 of 3');

  // archive two of them in bulk
  await page.getByRole('checkbox', { name: `Select row ${PREFIX}00002` }).click();
  await page.getByRole('checkbox', { name: `Select row ${PREFIX}00003` }).click();
  await expect(page.getByRole('status').filter({ hasText: '2 rows selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const confirm = page.getByRole('dialog', { name: 'Archive 2 assets?' });
  await confirm.getByRole('button', { name: 'Archive' }).click();
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-1 of 1');

  // ... and bring them back
  await choose(page, 'Show', 'Archived only');
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-2 of 2');
  await page.getByRole('checkbox', { name: 'Select all rows' }).click();
  await page.getByRole('button', { name: 'Restore' }).click();
  await page
    .getByRole('dialog', { name: 'Restore 2 assets?' })
    .getByRole('button', { name: 'Restore' })
    .click();
  await expect(page.getByRole('heading', { name: 'No assets match' })).toBeVisible();
  await choose(page, 'Show', 'Active assets');
  await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-3 of 3');
});

test('the command palette finds the asset and opens it', async () => {
  await page.goto('/');
  await expect(page.locator('main#main')).toBeVisible();
  await page.keyboard.press('Control+k');
  const dialog = page.getByRole('dialog', { name: 'Command palette' });
  await dialog.getByRole('combobox').fill(`${PREFIX}00001`);
  const option = dialog
    .getByRole('group', { name: 'Assets' })
    .getByRole('option', { name: new RegExp(`${PREFIX}00001`) });
  await expect(option).toBeVisible();
  await option.click();
  await expect(page.getByTestId('asset-tag')).toHaveText(`${PREFIX}00001`);
  expect(new URL(page.url()).searchParams.get('id')).toBe(assetId);
});

test('the numbering template is read and replaced with If-Match, and new tags follow it', async () => {
  await page.goto('/settings/tags');
  await expect(page.getByTestId('tag-template-summary')).toContainText('5 digits');
  await page.getByRole('button', { name: 'Edit template' }).click();
  const dialog = page.getByRole('dialog', { name: 'Tag numbering template' });
  await dialog.getByLabel('Digits in the counter').fill('6');
  await expect(dialog.getByTestId('tag-template-preview')).toContainText('LAP-000042');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('tag-template-summary')).toContainText('6 digits');
  await expect(page.getByTestId('tag-template-example')).toHaveText('LAP-000042');

  const category = (
    await api<{ data: Array<{ id: string }> }>(
      'GET',
      `/v1/categories?q=${encodeURIComponent(CATEGORY)}`,
    )
  ).json.data[0]!;
  const created = await api<{ asset_tag: string }>('POST', '/v1/assets', {
    category_id: category.id,
  });
  expect(created.json.asset_tag).toBe(`${PREFIX}000004`);

  // put it back so the tenant ends as it started
  await page.getByRole('button', { name: 'Edit template' }).click();
  await dialog.getByLabel('Digits in the counter').fill('5');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('tag-template-summary')).toContainText('5 digits');
});

test('archiving a category that is in use says by how many assets and models (409 usage)', async () => {
  await page.goto('/settings/categories');
  await page.getByRole('button', { name: `Archive ${CATEGORY}` }).click();
  const dialog = page.getByRole('dialog', { name: `Archive ${CATEGORY}?` });
  await dialog.getByRole('button', { name: 'Archive' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Still in use by 4 assets, 1 custom field');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
});

test('invites a user; the invitation mail arrives in Mailpit', async () => {
  await page.goto('/settings/users');
  await page.getByRole('button', { name: 'Invite user' }).click();
  const dialog = page.getByRole('dialog', { name: 'Invite a user' });
  await dialog.getByLabel(/^Name/).fill(`E2E Invitee ${id}`);
  await dialog.getByLabel(/^Email/).fill(INVITEE);
  await choose(page, /^Role/, 'Technician');
  await dialog.getByRole('button', { name: 'Send invitation' }).click();
  await expect(page.getByText(`Invitation sent to ${INVITEE}.`).first()).toBeVisible();

  await page.getByRole('tab', { name: /Pending invitations/ }).click();
  await expect(
    page.getByRole('row', { name: new RegExp(INVITEE.replace('.', '\\.')) }),
  ).toContainText('Technician');

  const mail = await waitForMail(INVITEE);
  expect(mail.Subject).toMatch(/invit/i);
  expect(mail.Text).toMatch(/\/invitations?\/|invitation/i);
});

test('signs out; the session is gone and an app URL bounces to the login', async () => {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(/\/login\/?\?reason=signed_out/);
  await expect(page.getByRole('status')).toContainText('You have been signed out.');
  await page.goto('/assets');
  await expect(page).toHaveURL(/\/login\/?\?next=/);
  const me = await page.evaluate(async () => (await fetch('/v1/auth/me')).status);
  expect(me).toBe(401);
});
