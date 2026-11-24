import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { signInAsOwner } from './support';

/**
 * The import wizard against the REAL stack (M2-IMP-06, M2-IMP-08): the synthetic Google Admin ChromeOS
 * export of the API test corpus goes through the preset, the column check, the dry run (nothing is
 * written) and the commit, and the Chromebooks show up in the asset list. The annotated users must
 * exist (people are never created by an asset import), so the suite makes them first through the API.
 * The serials of the fixture are fixed, so on a second run against the same database the import
 * UPDATES the assets it created the first time: the test accepts both.
 */
const SAMPLE = join(
  __dirname,
  '..',
  '..',
  'api',
  'test',
  'importer',
  'fixtures',
  'google-admin-chromeos-sample.csv',
);

test.describe.configure({ mode: 'serial' });

let page: Page;
const csv = readFileSync(SAMPLE);

/** Calls the real API from the signed-in page (cookie + CSRF). */
async function api<T = unknown>(
  p: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: T }> {
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
      return { status: res.status, json: (text ? JSON.parse(text) : null) as never };
    },
    { method, path, body },
  );
}

test.beforeAll(async ({ browser }) => {
  page = await (await browser.newContext()).newPage();
});
test.afterAll(async () => {
  await page.context().close();
});

test('signs in and creates the people the export names', async () => {
  await signInAsOwner(page);
  const users = new Set(
    csv
      .toString('utf8')
      .split(/\r?\n/)
      .slice(1)
      .map((line) => line.split(',')[8])
      .filter((email): email is string => !!email && email.includes('@')),
  );
  expect(users.size).toBeGreaterThan(10);
  for (const email of users) {
    const res = await api(page, 'POST', '/v1/people', {
      display_name: email.split('@')[0],
      email,
      kind: 'student',
    });
    // 409: a previous run made it
    expect([201, 409, 422]).toContain(res.status);
  }
});

test('imports the Google Admin export: preset, dry run that writes nothing, commit, assets visible', async () => {
  const total = async () =>
    (
      await api<{ page: { total: number } }>(
        page,
        'GET',
        '/v1/assets?limit=1&include_total=true&q=5CD00000',
      )
    ).json.page.total;
  const before = await total();

  await page.goto('/imports/new?entity=asset');
  await page.getByRole('radio', { name: /^Google Admin ChromeOS/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Upload your file' })).toBeVisible();
  await page.locator('input[type="file"]').setInputFiles({
    name: 'chromeos.csv',
    mimeType: 'text/csv',
    buffer: csv,
  });

  // the preset recognised the columns; the category is fixed to Chromebook
  const columns = page.getByRole('table', { name: 'Columns of your file' });
  await expect(columns).toBeVisible({ timeout: 90_000 });
  await expect(
    columns.getByRole('combobox', { name: 'Field for column Serial number' }),
  ).toContainText('Serial number');
  await expect(page.getByText(/Category = Chromebook/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  // dry run: the numbers appear, nothing is written yet
  const created = page.getByTestId('import-tile-create');
  const updated = page.getByTestId('import-tile-update');
  await expect(created.or(updated).first()).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText('Preview. Nothing has been saved yet.')).toBeVisible();
  expect(await total()).toBe(before);

  // a second run against the same database finds everything in place and has nothing to write
  const button = page.getByRole('button', { name: /^Import \d+ rows?$/ });
  if (await button.isVisible()) {
    await button.click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 180_000,
    });
  } else {
    await expect(page.getByTestId('import-tile-skip')).toBeVisible();
  }

  // the Chromebooks are in the registry (created now, or updated when an earlier run made them)
  expect(await total()).toBeGreaterThanOrEqual(40);
  const one = await api<{ data: Array<{ serial: string }> }>(
    page,
    'GET',
    '/v1/assets?q=5CD00000&limit=1',
  );
  const serial = one.json.data[0]!.serial;
  await page.getByRole('link', { name: 'View assets' }).click();
  await page.getByPlaceholder('Tag, serial or name').fill(serial);
  await expect(page.getByRole('row', { name: new RegExp(serial) })).toBeVisible();
});
