import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';
import { choose } from './m2-helpers';

/**
 * Saved views on the server (M2-REG-01), the views kept in this browser by the earlier version, and the
 * CSV export of the asset list with its filters (M2-REG-02).
 */
const range = (page: import('@playwright/test').Page) => page.getByTestId('assets-range');

test.describe('saved views', () => {
  test('saves a personal view, applies it after a reload, renames and deletes it', async ({
    page,
  }) => {
    await page.goto('/assets');
    await choose(page, page.getByRole('combobox', { name: 'Category' }), 'Tablet');
    await expect(range(page)).toHaveText('Showing 1-19 of 19');
    await page.getByRole('button', { name: 'Save view' }).click();
    const save = page.getByRole('dialog', { name: 'Save this view' });
    await save.getByLabel(/^View name/).fill('Tablets');
    await save.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('combobox', { name: 'View' })).toContainText('Tablets');

    await page.reload();
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    await choose(page, page.getByRole('combobox', { name: 'View' }), 'Tablets', true);
    await expect(range(page)).toHaveText('Showing 1-19 of 19');

    await page.getByRole('button', { name: 'Rename or share' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit view "Tablets"' });
    await edit.getByLabel(/^View name/).fill('iPads and tabs');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('combobox', { name: 'View' })).toContainText('iPads and tabs');

    await page.getByRole('button', { name: 'Delete view' }).click();
    await page
      .getByRole('dialog', { name: 'Delete view "iPads and tabs"?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('View deleted.').first()).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'View' })).toContainText('All assets');
  });

  test('a view shared by someone else can be used by everyone', async ({ page }) => {
    await page.goto('/assets');
    await choose(
      page,
      page.getByRole('combobox', { name: 'View' }),
      'Teacher devices (shared)',
      true,
    );
    await expect(range(page)).toHaveText('Showing 1-39 of 39');
    await expect(page.getByText('shared by Sam Lee')).toBeVisible();
  });

  test('moves the views of the earlier version from this browser to the account, once', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      if (window.localStorage.getItem('at-asset-views-migrated')) return;
      window.localStorage.setItem(
        'at-asset-views',
        JSON.stringify([
          {
            id: 'view-old',
            name: 'Old projectors',
            state: {
              q: 'PRJ-',
              status_id: '',
              category_id: '',
              location_id: '',
              include_sublocations: true,
              assigned: '',
              person_id: '',
              person_name: '',
              archived: 'exclude',
              cf: null,
              sort: '',
              columns: ['tag', 'name'],
            },
          },
        ]),
      );
    });
    await page.goto('/assets');
    await expect(
      page.getByText('Moved 1 saved view from this browser to your account.').first(),
    ).toBeVisible();
    expect(await page.evaluate(() => window.localStorage.getItem('at-asset-views'))).toBeNull();
    await choose(page, page.getByRole('combobox', { name: 'View' }), 'Old projectors', true);
    await expect(range(page)).toHaveText('Showing 1-10 of 10');
    await expect(page.getByRole('columnheader', { name: 'Model' })).toHaveCount(0);

    await page.reload();
    await expect(page.getByText(/Moved \d+ saved view/)).toHaveCount(0);
    await choose(page, page.getByRole('combobox', { name: 'View' }), 'Old projectors', true);
  });
});

test.describe('saved views as a viewer', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('uses the shared view but cannot change it or share their own', async ({ page }) => {
    await page.goto('/assets');
    await choose(
      page,
      page.getByRole('combobox', { name: 'View' }),
      'Teacher devices (shared)',
      true,
    );
    await expect(range(page)).toHaveText('Showing 1-39 of 39');
    await expect(page.getByRole('button', { name: 'Rename or share' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Delete view' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('checkbox', { name: /Share with everyone/ })).toHaveCount(0);
  });
});

test.describe('CSV export', () => {
  test('exports what the filters show: progress, then a CSV download with those rows', async ({
    page,
  }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('PRJ-');
    await expect(range(page)).toHaveText('Showing 1-10 of 10');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export to CSV' });
    await expect(dialog.getByTestId('export-status')).toContainText(/Starting|Preparing/);
    const link = dialog.getByRole('link', { name: 'Download CSV' });
    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByTestId('export-status')).toContainText('10 assets exported.');
    const [download] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(download.suggestedFilename()).toMatch(/\.csv$/);
    // the downloaded file is read through the same link (the download itself is a browser matter)
    const href = (await link.getAttribute('href'))!;
    const text = (await page.evaluate(async (url) => (await fetch(url)).text(), href)).trim();
    const lines = text.split('\n');
    expect(lines[0]).toBe(
      'asset_tag,name,serial,category,status,location,purchase_date,warranty_end',
    );
    expect(lines).toHaveLength(11);
    expect(lines.slice(1).every((line) => line.startsWith('PRJ-'))).toBe(true);
  });

  test('says so when the export fails and offers to start again', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('fail');
    await expect(page.getByRole('heading', { name: 'No assets match' })).toBeVisible();
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export to CSV' });
    await expect(dialog.getByText('The export failed.')).toBeVisible({ timeout: 15_000 });
    await expect(dialog.getByRole('button', { name: 'Start again' })).toBeEnabled();
  });
});
