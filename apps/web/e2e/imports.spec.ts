import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { violations } from './axe';
import { expect, settled, test } from './fixtures';
import {
  api,
  bigCsv,
  CSV_ASSETS,
  CSV_MATCHING,
  importAt,
  importState,
  loadApp,
} from './w3-helpers';

/**
 * The import wizard (M2-IMP-08) against the mock of the real import API: from the Assets page to a
 * finished import with a real file upload (CSV and Excel), the dry run that changes nothing, value
 * decisions, the error report, resuming after a reload, stopping a running import, the problems the
 * API answers (`import-stale-dry-run`, `import-wrong-state`, `import-quota-exceeded`), the message when
 * the retention job has removed the details of a finished import, and axe in both colour schemes.
 */
const MATCHING_COLUMNS = {
  'Serial Number': 'serial',
  'Asset ID': 'asset_tag',
  Category: 'category',
};

const jobUrl = (id: string, step?: string) => `/imports/job?id=${id}${step ? `&step=${step}` : ''}`;

/** Edit a stored import of the mock (its state lives in the page's local storage) and reload. */
async function backdateFinish(page: Page, id: string, days: number): Promise<void> {
  await page.evaluate(
    ({ id, days }) => {
      const key = 'at-mock-w3-v3';
      const data = JSON.parse(window.localStorage.getItem(key) ?? '{}') as {
        importJobs: Array<{ id: string; finished_at: string | null }>;
      };
      const job = data.importJobs.find((candidate) => candidate.id === id)!;
      job.finished_at = new Date(Date.now() - days * 86_400_000).toISOString();
      window.localStorage.setItem(key, JSON.stringify(data));
    },
    { id, days },
  );
  await page.reload();
}

/** An import in the review step with the options of the asset file. */
const reviewed = (page: Page, csv = CSV_ASSETS) => importAt(page, 'reviewed', { csv });

test.describe('import wizard', () => {
  test('imports assets from a CSV: upload, match columns, dry run, commit, summary', async ({
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
    await expect(page.getByTestId('import-file-summary')).toHaveText('devices.csv: 6 rows');
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Serial Number' }),
    ).toContainText('Serial number');
    await expect(columns.getByRole('row', { name: /Serial Number/ })).toContainText('Exact');
    await page.getByRole('combobox', { name: 'Recognise existing assets by' }).click();
    await page.getByRole('option', { name: 'Serial number', exact: true }).click();
    await page.getByRole('button', { name: 'Continue' }).click();

    // every value matches a record or may be created, so the dry run starts straight away
    await expect(page.getByText('Preview. Nothing has been saved yet.')).toBeVisible();
    await expect(page.getByTestId('import-tile-create')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('import-tile-create')).toContainText('4');
    await expect(page.getByTestId('import-tile-skip')).toContainText('1');
    await expect(page.getByTestId('import-tile-error')).toContainText('1');
    await expect(page.getByRole('list', { name: 'Reasons rows were rejected' })).toContainText(
      '1 row: a required value is missing (category)',
    );
    await expect(page.getByRole('list', { name: 'Records the import would create' })).toContainText(
      'Location "Room 999" will be created.',
    );
    await expect(page.getByRole('table', { name: 'Rows of the dry run' })).toContainText(
      'Category is required.',
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

    await page.getByRole('button', { name: 'Import 4 rows' }).click();
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('import-done-created')).toContainText('4');
    await expect(page.getByTestId('import-done-failed')).toContainText('1');
    await expect(
      page.getByRole('table', { name: 'Rows that could not be imported' }),
    ).toContainText('Category is required.');
    await page.getByRole('link', { name: 'View assets' }).click();
    await page.getByPlaceholder('Tag, serial or name').fill('IMP-000');
    await expect(page.getByRole('row', { name: /IMP-0001/ })).toBeVisible();
  });

  test('decides the values that match nothing before the dry run', async ({ page }) => {
    await loadApp(page);
    const { id } = await importAt(page, 'uploaded');
    // locations must exist: "Room 999" needs a decision
    const read = await api(page, 'GET', `/v1/imports/${id}`);
    expect(
      (
        await api(
          page,
          'PATCH',
          `/v1/imports/${id}`,
          { options: { match_on: 'serial', references: { location: 'must_exist' } } },
          { 'if-match': read.etag ?? '' },
        )
      ).status,
    ).toBe(200);
    await page.goto(jobUrl(id));
    await expect(page.getByRole('table', { name: 'Columns of your file' })).toBeVisible();
    await page.getByRole('button', { name: 'Continue' }).click();

    const location = page.getByRole('table', { name: 'Values of Location' });
    await expect(location).toContainText('Room 999');
    await expect(location.getByRole('row', { name: /Room 999/ })).toContainText(
      'Not found: its rows will be errors',
    );
    await expect(page.getByTestId('import-values-open')).toContainText(
      '1 value still needs a decision.',
    );
    await page.getByRole('button', { name: 'Create all that are missing' }).click();
    await expect(page.getByTestId('import-values-open')).toHaveCount(0);
    await page.getByRole('button', { name: 'Run the dry run' }).click();
    await expect(page.getByTestId('import-tile-create')).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('import-tile-create')).toContainText('4');
  });

  test('accepts an Excel file as well as a CSV', async ({ page }) => {
    await loadApp(page);
    const { id } = await importAt(page, 'draft');
    await page.goto(jobUrl(id));
    await expect(page.getByRole('heading', { name: 'Upload your file' })).toBeVisible();
    await expect(page.getByText(/A CSV or Excel \(\.xlsx\) file/)).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveAttribute('accept', '.csv,.xlsx');
    await page.locator('input[type="file"]').setInputFiles({
      name: 'devices.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: Buffer.from('PK'),
    });
    const columns = page.getByRole('table', { name: 'Columns of your file' });
    await expect(columns).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId('import-file-summary')).toContainText('devices.xlsx');
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Serial number' }),
    ).toContainText('Serial number');
    expect(
      (await api<{ source: string; parse: { format: string } }>(page, 'GET', `/v1/imports/${id}`))
        .json,
    ).toMatchObject({ source: 'xlsx', parse: { format: 'xlsx' } });
  });

  test('shows a long import advancing and stops it between batches', async ({ page }) => {
    await loadApp(page);
    // 200 rows at 25 per batch: a few seconds of progress
    const { id } = await importAt(page, 'reviewed', {
      csv: bigCsv(200),
      mapping: MATCHING_COLUMNS,
    });
    await page.goto(jobUrl(id));
    await page.getByRole('button', { name: 'Import 200 rows' }).click();
    const progress = page.getByTestId('import-progress-text');
    await expect(progress).toContainText(/Imported \d+ of 200 rows/, { timeout: 10_000 });
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
      mapping: MATCHING_COLUMNS,
    });
    await page.goto('/settings/organisation');
    await page
      .getByRole('navigation', { name: 'Settings sections' })
      .getByRole('link', { name: 'Imports' })
      .click();
    await expect(page).toHaveURL(/\/imports\/?$/);
    const row = page.getByRole('row', { name: /devices\.csv/ });
    await expect(row).toContainText('Ready for a dry run');
    await row.getByRole('link', { name: /Continue import/ }).click();
    await expect(page).toHaveURL(new RegExp(`/imports/job/?\\?id=${id}`));
    await expect(page.getByRole('table', { name: 'Columns of your file' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Field for column Category' })).toContainText(
      'Category',
    );
  });

  test('downloads the templates as CSV and Excel and imports people and locations', async ({
    page,
  }) => {
    await page.goto('/imports/new?entity=person');
    await expect(page.getByRole('radio', { name: /^People/ })).toBeChecked();
    const csv = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download the People template (CSV)' }).click();
    expect((await csv).suggestedFilename()).toBe('people-template.csv');
    const xlsx = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download the People template (Excel)' }).click();
    expect((await xlsx).suggestedFilename()).toBe('people-template.xlsx');
    await page.getByRole('radio', { name: /^Locations/ }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Locations' })).toBeVisible();
    await expect(page.getByTestId('import-step-caption')).toHaveText('Step 2 of 6: Upload file');
  });

  test('a ChromeOS export is recognised column by column, with the category fixed', async ({
    page,
  }) => {
    await loadApp(page);
    const text =
      'Serial Number,Annotated Asset ID,Annotated User,Org Unit Path,Status\n5CG9001,CB-1,a@b.org,/Main/Room 101,ACTIVE';
    const { id } = await importAt(page, 'uploaded', {
      csv: text,
      preset: 'google_admin_chromeos',
      filename: 'chromeos.csv',
    });
    await page.goto(jobUrl(id));
    const columns = page.getByRole('table', { name: 'Columns of your file' });
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Annotated User' }),
    ).toContainText('Assigned to');
    await expect(
      columns.getByRole('combobox', { name: 'Field for column Org Unit Path' }),
    ).toContainText('Department');
    await expect(page.getByText('Fixed values')).toBeVisible();
    await expect(page.getByText(/Category = Chromebook/)).toBeVisible();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Google Admin ChromeOS' }),
    ).toBeVisible();
  });

  test('explains once what is checked when importing, not on every row (ED-29)', async ({
    page,
  }) => {
    await loadApp(page);
    const { id } = await importAt(page, 'reviewed', {
      entity: 'location',
      csv: 'Path
New Campus > Block A
New Campus > Block B',
      filename: 'places.csv',
      mapping: { Path: 'path' },
      importOptions: { on_match: 'skip' },
    });
    await page.goto(jobUrl(id));
    const note = page.getByTestId('import-checks-note');
    await expect(note).toContainText('Every row was checked as it will be imported');
    await expect(note).toContainText(
      '2 locations sit below a parent location this import creates, so their last checks run when you import.',
    );
    const table = page.getByRole('table', { name: 'Rows of the dry run' });
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(table).not.toContainText('Checked when the import runs');
  });

  test('says to run the dry run again when it changed after the one that was reviewed', async ({
    page,
  }) => {
    await loadApp(page);
    const { id } = await reviewed(page);
    await page.goto(jobUrl(id));
    await expect(page.getByTestId('import-tile-create')).toBeVisible();
    // somebody changes an option and runs the dry run again: the digest moves on
    const read = await api(page, 'GET', `/v1/imports/${id}`);
    await api(
      page,
      'PATCH',
      `/v1/imports/${id}`,
      { options: { on_match: 'error' } },
      { 'if-match': read.etag ?? '' },
    );
    await api(page, 'POST', `/v1/imports/${id}/dry-run`);
    await expect.poll(() => importState(page, id), { timeout: 20_000 }).toBe('dry_run_done');
    await page.getByRole('button', { name: 'Import 4 rows' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Run the dry run again' }),
    ).toContainText('The file, your choices or the dry run changed after the one you reviewed.');
  });

  test('says where the import is when it is in another state than the action needs', async ({
    page,
  }) => {
    await loadApp(page);
    const { id } = await reviewed(page);
    await page.goto(jobUrl(id));
    await expect(page.getByTestId('import-tile-create')).toBeVisible();
    await api(page, 'POST', `/v1/imports/${id}/cancel`);
    await page.getByRole('button', { name: 'Import 4 rows' }).click();
    await expect(
      page.getByText('That is not possible while the import is "Cancelled".').first(),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Import cancelled' })).toBeVisible();
  });

  test('says how long to wait when too many imports are running', async ({ page }) => {
    await loadApp(page);
    const { id } = await reviewed(page);
    // two long dry runs keep the organisation's import slots busy
    for (let i = 0; i < 2; i += 1) {
      await importAt(page, 'dry-run-running', { csv: bigCsv(3000), mapping: MATCHING_COLUMNS });
    }
    await page.goto(jobUrl(id));
    await expect(page.getByTestId('import-tile-create')).toBeVisible();
    await page.getByRole('button', { name: 'Import 4 rows' }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: 'Too many imports are running at once' }),
    ).toContainText('Try again in 30 seconds.');
  });

  test('says that the details were removed once the retention period has passed', async ({
    page,
  }) => {
    await loadApp(page);
    const { id } = await importAt(page, 'committed');
    await backdateFinish(page, id, 40);
    await page.goto(jobUrl(id));
    await expect(page.getByRole('heading', { name: 'Import finished' })).toBeVisible();
    await expect(page.getByText('The details of this import were removed')).toBeVisible();
    await expect(
      page.getByText(/the rows, the column statistics, the sample rows, your value choices/),
    ).toBeVisible();
    await expect(page.getByTestId('import-done-created')).toContainText('4');
    await expect(page.getByRole('table', { name: 'Rows that could not be imported' })).toHaveCount(
      0,
    );
    await expect(page.getByRole('button', { name: 'Download error report' })).toHaveCount(0);
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

/** axe (WCAG 2.2 A/AA, contrast included) in both colour schemes for the screens this change touched. */
const SCREENS: Array<{ name: string; open: (page: Page) => Promise<void> }> = [
  {
    name: 'choose the data with the data dictionary',
    open: async (page) => {
      await page.goto('/imports/new');
      await expect(page.getByRole('radio', { name: /^Assets/ })).toBeChecked();
      await page.getByText('What the template contains').click();
      await expect(
        page.getByRole('table', { name: 'Columns of the Assets template' }),
      ).toBeVisible();
    },
  },
  {
    name: 'upload an Excel or CSV file',
    open: async (page) => {
      await loadApp(page);
      const { id } = await importAt(page, 'draft');
      await page.goto(jobUrl(id));
      await expect(page.getByRole('heading', { name: 'Upload your file' })).toBeVisible();
    },
  },
  {
    name: 'match the columns with the options',
    open: async (page) => {
      await loadApp(page);
      const { id } = await importAt(page, 'uploaded');
      await page.goto(jobUrl(id));
      const columns = page.getByRole('table', { name: 'Columns of your file' });
      await expect(columns).toBeVisible();
      await expect(
        columns.getByRole('combobox', { name: 'Field for column Category' }),
      ).toBeVisible();
      await page.getByRole('combobox', { name: 'When the record exists already' }).click();
      await page.getByRole('option', { name: 'Update it with the file' }).click();
      await expect(
        page.getByRole('combobox', { name: 'An empty cell when updating' }),
      ).toBeVisible();
      await settled(page);
    },
  },
  {
    name: 'match the values',
    open: async (page) => {
      await loadApp(page);
      const { id } = await importAt(page, 'mapped');
      await page.goto(jobUrl(id, 'values'));
      await expect(page.getByRole('table', { name: 'Values of Location' })).toBeVisible();
      await settled(page);
    },
  },
  {
    name: 'the dry run with its summary',
    open: async (page) => {
      await loadApp(page);
      const { id } = await reviewed(page);
      await page.goto(jobUrl(id));
      await expect(page.getByTestId('import-tile-create')).toBeVisible();
      await expect(
        page.getByRole('list', { name: 'Records the import would create' }),
      ).toBeVisible();
      await settled(page);
    },
  },
  {
    name: 'finished, with the details removed',
    open: async (page) => {
      await loadApp(page);
      const { id } = await importAt(page, 'committed');
      await backdateFinish(page, id, 40);
      await page.goto(jobUrl(id));
      await expect(page.getByText('The details of this import were removed')).toBeVisible();
      await settled(page);
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const screen of SCREENS) {
    test(`axe: ${screen.name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await screen.open(page);
      expect(await violations(page)).toEqual([]);
    });
  }
}
