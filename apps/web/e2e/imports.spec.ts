import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';
import { api, CSV_ASSETS, CSV_MATCHING, importAt, loadApp } from './w3-helpers';

/**
 * The import wizard (M2-IMP-08): from the Assets page to a finished import with a real file upload,
 * the dry run that changes nothing, value decisions, the error report, resuming after a reload and
 * stopping a running import.
 */
test.describe('import wizard', () => {
  test('imports assets from a CSV: upload, match columns and values, dry run, commit, summary', async ({
    page,
  }) => {
    await loadApp(page);
    await page.goto('/assets');
    await expect(page.getByRole('heading', { level: 1, name: 'Assets' })).toBeVisible();
    const before = (
      await api<{ page: { total: number } }>(page, 'GET', '/v1/assets?limit=1&include_total=true')
    ).json.page.total;
    await page.getByRole('link', { name: 'Import' }).click();
    await expect(page).toHaveURL(/\/imports\/new\/?\?entity=asset/);
    await expect(page.getByRole('radio', { name: /^Assets/ })).toBeChecked();
    await page.getByRole('button', { name: 'Continue' }).click();

    // upload: the same pipeline as every attachment, scanned before it is read
    await expect(page.getByRole('heading', { name: 'Upload your file' })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'devices.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV_ASSETS),
    });

    // columns: the suggestions are there, the duplicate check uses the serial number
    const columns = page.getByRole('table', { name: 'Columns of your file' });
    await expect(columns).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('import-file-summary')).toHaveText('devices.csv: 5 rows');
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Serial Number' }),
    ).toContainText('Serial number');
    await page.getByRole('combobox', { name: 'Recognise existing assets by' }).click();
    await page.getByRole('option', { name: 'Serial number' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // values: two values match nothing
    await expect(page.getByRole('table', { name: 'Values to decide for Location' })).toContainText(
      'Room 999',
    );
    await expect(page.getByRole('table', { name: 'Values to decide for Category' })).toContainText(
      'Hovercraft',
    );
    await page.getByRole('button', { name: 'Create all that are missing' }).click();
    await page.getByRole('button', { name: 'Run the dry run' }).click();

    // dry run: nothing is saved yet
    await expect(page.getByText('Preview. Nothing has been saved yet.')).toBeVisible();
    await expect(page.getByTestId('import-tile-create')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('import-tile-create')).toContainText('3');
    await expect(page.getByTestId('import-tile-skip')).toContainText('1');
    await expect(page.getByTestId('import-tile-error')).toContainText('1');
    await expect(page.getByRole('table', { name: 'Rows of the dry run' })).toContainText(
      'Serial number is required',
    );
    expect(
      (await api<{ page: { total: number } }>(page, 'GET', '/v1/assets?limit=1&include_total=true'))
        .json.page.total,
    ).toBe(before);

    // the error report is a download
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download error report' }).click();
    expect((await download).suggestedFilename()).toMatch(/errors\.csv$/);

    // reload: the import resumes where it was
    await page.reload();
    await expect(page.getByTestId('import-tile-create')).toBeVisible();

    await page.getByRole('button', { name: 'Import 3 rows' }).click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId('import-done-created')).toContainText('3');
    await expect(page.getByTestId('import-done-failed')).toContainText('1');
    await page.getByRole('link', { name: 'View assets' }).click();
    await page.getByPlaceholder('Tag, serial or name').fill('IMP-000');
    await expect(page.getByRole('row', { name: /IMP-0001/ })).toBeVisible();
  });

  test('shows a long import advancing and stops it between batches', async ({ page }) => {
    await loadApp(page);
    // 60 rows at 25 per batch: a few seconds of progress
    const csv = ['Serial Number,Asset ID,Category'];
    for (let n = 1; n <= 200; n += 1) csv.push(`LN-${n},LONG-${n},Chromebook`);
    const { id } = await importAt(page, 'reviewed', { csv: csv.join('\n') });
    await page.goto(`/imports/job?id=${id}`);
    await page.getByRole('button', { name: 'Import 200 rows' }).click();
    const progress = page.getByTestId('import-progress-text');
    await expect(progress).toContainText('Importing');
    await page.getByRole('button', { name: 'Cancel import' }).click();
    await expect(page.getByRole('heading', { name: 'Import cancelled' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(/already been written and stay/)).toBeVisible();
  });

  test('the list brings an unfinished import back, and the settings navigation leads to it', async ({
    page,
  }) => {
    await loadApp(page);
    const { id } = await importAt(page, 'mapped', {
      csv: CSV_MATCHING,
      mapping: { 'Serial Number': 'serial', 'Asset ID': 'asset_tag', Category: 'category' },
    });
    await page.goto('/settings/organisation');
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Imports' })
      .click();
    await expect(page).toHaveURL(/\/imports\/?$/);
    const row = page.getByRole('row', { name: /devices\.csv/ });
    await expect(row).toContainText('Draft');
    await row.getByRole('link', { name: /Continue import/ }).click();
    await expect(page).toHaveURL(new RegExp(`/imports/job/?\\?id=${id}`));
    await expect(page.getByRole('table', { name: 'Columns of your file' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Field for column Category' })).toContainText(
      'Category',
    );
  });

  test('imports people and locations from their templates', async ({ page }) => {
    await page.goto('/imports/new?entity=person');
    await expect(page.getByRole('radio', { name: /^People/ })).toBeChecked();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download the People template' }).click();
    expect((await download).suggestedFilename()).toBe('person-template.csv');
    await page.getByRole('radio', { name: /^Locations/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible();
    await expect(page.getByTestId('import-step-caption')).toHaveText('Step 2 of 6: Upload file');
  });

  test('a ChromeOS export is recognised column by column', async ({ page }) => {
    await loadApp(page);
    const text =
      'Serial Number,Asset ID,Annotated User,Org Unit,Status\n5CG9001,CB-1,a@b.org,/Main/Room 101,Provisioned';
    const { id } = await importAt(page, 'uploaded', {
      csv: text,
      source: 'google_admin_csv',
      filename: 'chromeos.csv',
    });
    await page.goto(`/imports/job?id=${id}`);
    const columns = page.getByRole('table', { name: 'Columns of your file' });
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Annotated User' }),
    ).toContainText('Assigned to');
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Org Unit' }),
    ).toContainText('Location');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Google Admin ChromeOS' }),
    ).toBeVisible();
  });
});

test.describe('import wizard as a viewer', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });
  test('sees the list but gets the 403 screen for a new import', async ({ page }) => {
    await page.goto('/imports');
    await expect(page.getByRole('heading', { name: 'No imports yet' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'New import' })).toHaveCount(0);
    await page.goto('/imports/new');
    await expect(page.getByTestId('access-denied')).toBeVisible();
  });
});
