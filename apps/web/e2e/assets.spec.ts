import type { Page } from '@playwright/test';
import { assetId, expect, settled, test } from './fixtures';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';

/** The asset registry screens: list, drawer, detail, create, edit, clone, archive (M1-WEB-07/08). */

async function choose(page: Page, label: RegExp | string, option: RegExp | string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

const range = (page: Page) => page.getByTestId('assets-range');

test.describe('assets list (M1-WEB-07)', () => {
  test('shows the first page of 50 with the total, newest first, and pages with cursors', async ({
    page,
  }) => {
    await page.goto('/assets');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    await expect(page.getByRole('row').nth(1)).toContainText('PRJ-00010');

    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(range(page)).toHaveText('Showing 51-100 of 195');
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.getByRole('button', { name: 'Next page' }).click();
    await expect(range(page)).toHaveText('Showing 151-195 of 195');
    await expect(page.getByRole('button', { name: 'Next page' })).toBeDisabled();

    await page.getByRole('button', { name: 'Previous page' }).click();
    await expect(range(page)).toHaveText('Showing 101-150 of 195');
  });

  test('sorts by tag from the column header and keeps the sort across pages', async ({ page }) => {
    await page.goto('/assets');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    await page.getByRole('columnheader', { name: /Tag/ }).getByRole('button').click();
    await expect(page.getByRole('columnheader', { name: /Tag/ })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await expect(page.getByRole('row').nth(1)).toContainText('AT-00001');
    await page.getByRole('columnheader', { name: /Tag/ }).getByRole('button').click();
    await expect(page.getByRole('columnheader', { name: /Tag/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
    await expect(page.getByRole('row').nth(1)).toContainText('TAB-00020');
    // a cursor from the previous sort is never reused: the page is the first of the new order
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
  });

  test('sorts by Assigned to and Location (M2-REG-03): empty values stay last in both directions', async ({
    page,
  }) => {
    await page.goto('/assets');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    const assignee = page.getByRole('columnheader', { name: /Assigned to/ });
    await assignee.getByRole('button').click();
    await expect(assignee).toHaveAttribute('aria-sort', 'ascending');
    // somebody holds the first asset of the list; the nobody-has-it dash is not up here
    await expect(page.getByRole('row').nth(1).getByText('-', { exact: true })).toHaveCount(0);
    await assignee.getByRole('button').click();
    await expect(assignee).toHaveAttribute('aria-sort', 'descending');
    await expect(page.getByRole('row').nth(1).getByText('-', { exact: true })).toHaveCount(0);
    for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next page' }).click();
    await expect(range(page)).toHaveText('Showing 151-195 of 195');
    await expect(page.getByRole('row').last().getByText('-', { exact: true })).toHaveCount(1);

    const location = page.getByRole('columnheader', { name: /Location/ });
    await location.getByRole('button').click();
    await expect(location).toHaveAttribute('aria-sort', 'ascending');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
  });

  test('search and filters narrow the list; clear all restores it', async ({ page }) => {
    await page.goto('/assets');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');

    await page.getByPlaceholder('Tag, serial or name').fill('LAP-0002');
    await expect(range(page)).toHaveText('Showing 1-10 of 10');

    await page.getByPlaceholder('Tag, serial or name').fill('');
    await choose(page, 'Category', 'Tablet');
    await expect(range(page)).toHaveText('Showing 1-19 of 19');
    await choose(page, 'Status', 'Ready');
    await expect(page.getByTestId('assets-range')).not.toHaveText('Showing 1-19 of 19');

    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
  });

  test('filters by a custom field value', async ({ page }) => {
    await page.goto('/assets');
    await choose(page, 'Category', 'Chromebook');
    await choose(page, 'Custom field', 'Screen size (in)');
    await page.getByLabel('Value of Screen size (in)').fill('14');
    const total = await range(page).textContent();
    expect(total).toMatch(/of \d+$/);
    await expect(range(page)).not.toHaveText(/of 130$/);
    // every visible row has the value in the (added) column
    await page.getByRole('button', { name: 'Columns' }).click();
    await page.getByRole('checkbox', { name: 'Screen size (in)' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    const cells = page.getByRole('row').filter({ has: page.getByRole('link') });
    expect(await cells.count()).toBeGreaterThan(0);
    for (const row of await cells.all()) await expect(row).toContainText('14');
  });

  test('the empty state of a search with no result offers to clear it', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('zzzz-nothing');
    await expect(page.getByRole('heading', { name: 'No assets match' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear all filters' }).last().click();
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
  });

  test('column picker: hide, add and reorder columns; saved views survive a reload', async ({
    page,
  }) => {
    await page.goto('/assets');
    await expect(page.getByRole('columnheader', { name: 'Model' })).toBeVisible();
    await page.getByRole('button', { name: 'Columns' }).click();
    const dialog = page.getByRole('dialog', { name: 'Columns' });
    await dialog.getByRole('checkbox', { name: 'Model' }).click();
    await dialog.getByRole('checkbox', { name: 'Serial' }).click();
    await dialog.getByRole('button', { name: 'Move Serial up' }).click();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('columnheader', { name: 'Model' })).toHaveCount(0);
    await expect(page.getByRole('columnheader', { name: 'Serial' })).toBeVisible();

    await choose(page, 'Category', 'Laptop');
    await expect(range(page)).toHaveText('Showing 1-39 of 39');
    await page.getByRole('button', { name: 'Save view' }).click();
    const save = page.getByRole('dialog', { name: 'Save this view' });
    await save.getByLabel(/^View name/).fill('Laptops');
    await save.getByRole('button', { name: 'Save view' }).click();
    await expect(page.getByRole('combobox', { name: 'View' })).toContainText('Laptops');

    await page.reload();
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    await choose(page, 'View', 'Laptops');
    await expect(range(page)).toHaveText('Showing 1-39 of 39');
    await expect(page.getByRole('columnheader', { name: 'Serial' })).toBeVisible();
    await expect(page.getByRole('columnheader', { name: 'Model' })).toHaveCount(0);
  });

  test('row click opens the 480px drawer with the details; the full page link opens the detail', async ({
    page,
  }) => {
    await page.goto('/assets');
    await page.getByRole('row', { name: /PRJ-00010/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    expect((await drawer.boundingBox())?.width).toBeCloseTo(480, 0);
    await expect(drawer.getByText('Lamp hours')).toBeVisible();
    await drawer.getByRole('link', { name: 'Open full page' }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-00010');
  });

  test('keyboard: arrows move between rows, Space selects, Enter opens the full page', async ({
    page,
  }) => {
    await page.goto('/assets');
    const first = page.getByRole('row', { name: /PRJ-00010/ });
    await expect(first).toBeVisible();
    await first.focus();
    await page.keyboard.press('ArrowDown');
    const second = page.getByRole('row', { name: /PRJ-00009/ });
    await expect(second).toBeFocused();
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('status').filter({ hasText: '1 row selected' })).toBeVisible();
    await page.keyboard.press('Space');
    await expect(second).toHaveAttribute('aria-selected', 'false');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-00009');
  });

  test('bulk archive: select rows, confirm, and they leave the active list', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('PRJ-');
    await expect(range(page)).toHaveText('Showing 1-10 of 10');
    await page.getByRole('checkbox', { name: 'Select row PRJ-00010' }).click();
    await page.getByRole('checkbox', { name: 'Select row PRJ-00009' }).click();
    await expect(page.getByRole('status').filter({ hasText: '2 rows selected' })).toBeVisible();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive 2 assets?' });
    await expect(confirm).toContainText('PRJ-00010, PRJ-00009');
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(range(page)).toHaveText('Showing 1-8 of 8');

    // archived assets are retrievable, and restorable in bulk
    await choose(page, 'Show', 'Archived only');
    await expect(range(page)).toHaveText('Showing 1-2 of 2');
    await page.getByRole('checkbox', { name: 'Select all rows' }).click();
    await page.getByRole('button', { name: 'Restore' }).click();
    await page
      .getByRole('dialog', { name: 'Restore 2 assets?' })
      .getByRole('button', { name: 'Restore' })
      .click();
    await expect(page.getByRole('heading', { name: 'No assets match' })).toBeVisible();
  });

  test('bulk edit changes the status of the selected assets and lists failures', async ({
    page,
  }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('TAB-0001');
    await expect(range(page)).toHaveText('Showing 1-9 of 9');
    await page.getByRole('checkbox', { name: 'Select row TAB-00010' }).click();
    await page.getByRole('checkbox', { name: 'Select row TAB-00011' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit 2 assets' });
    await expect(dialog).toContainText('TAB-00011, TAB-00010');
    await choose(page, 'New value', 'Out for fix');
    await dialog.getByRole('button', { name: 'Apply to 2 assets' }).click();
    await expect(page.getByText('Done: 2 assets updated.', { exact: true })).toBeVisible();
    await page.getByPlaceholder('Tag, serial or name').fill('TAB-00010');
    await expect(page.getByRole('row', { name: /TAB-00010/ })).toContainText('Out for fix');
  });

  test('a viewer sees the list but no create, edit or archive actions', async ({ page }) => {
    // sign in as the viewer by replacing the seeded session
    await page.addInitScript((email) => {
      window.localStorage.setItem(
        'at-mock-state',
        JSON.stringify({
          session: {
            id: 's',
            email,
            csrf: 'csrf-e2e',
            mfaVerified: true,
            limited: false,
            createdAt: new Date().toISOString(),
          },
        }),
      );
    }, MOCK_ACCOUNTS.viewer);
    await page.goto('/assets');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    await expect(page.getByRole('link', { name: 'New asset' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Select row PRJ-00010' }).click();
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  });
});

test.describe('asset detail (M1-WEB-08)', () => {
  test('overview shows details, purchase and the custom fields; the history tab is URL-addressable', async ({
    page,
  }) => {
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
    await expect(page.getByRole('heading', { name: 'Fields for Chromebook' })).toBeVisible();
    await expect(page.getByText('OS version')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Purchase' })).toBeVisible();

    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page).toHaveURL(/tab=history/);
    await expect(page.getByRole('list', { name: 'History' })).toContainText('Created');

    await page.reload();
    await expect(page.getByRole('tab', { name: /History/ })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.getByRole('tab', { name: 'Repairs' }).click();
    await expect(page.getByText('No repairs for this asset yet.')).toBeVisible();
  });

  test('an unknown asset id shows a not-found screen', async ({ page }) => {
    await page.goto(`/assets/view?id=${assetId(9999)}`);
    await expect(page.getByTestId('asset-not-found')).toBeVisible();
  });

  test('archive then restore from the detail page', async ({ page }) => {
    await page.goto(`/assets/view?id=${assetId(5)}`);
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Archive AT-00005?' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Edit' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Restore' }).click();
    await expect(page.getByRole('button', { name: 'Archive', exact: true })).toBeVisible();
  });
});

test.describe('create, edit and clone (M1-WEB-08)', () => {
  test('creates an asset with custom fields of a category, validating them first', async ({
    page,
  }) => {
    await page.goto('/assets/new');
    await expect(page.getByRole('heading', { name: 'New asset', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByRole('alert').filter({ hasText: '1 field needs attention' }),
    ).toBeVisible();

    await choose(page, /^Category/, 'Chromebook');
    await expect(page.getByRole('group', { name: 'Fields for Chromebook' })).toBeVisible();
    await choose(page, /^Model/, /Chromebook 3100/);
    await page.getByLabel('Serial number').fill('SN-E2E-0001');

    // required custom field first, then type-specific validation
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByTestId('custom-fields').getByText('This field is required.'),
    ).toBeVisible();
    await page.getByLabel(/^OS version/).fill('ChromeOS 126');
    await page.getByLabel('Screen size (in)').fill('99');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('custom-fields').getByText('Must be at most 20.')).toBeVisible();

    await page.getByLabel('Screen size (in)').fill('11.6');
    await page.getByRole('checkbox', { name: 'Managed' }).click();
    await page.getByRole('checkbox', { name: 'Charger' }).click();
    await page.getByLabel('Enrollment date').fill('2026-11-02');
    await page.getByLabel('Admin console URL').fill('not a url');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(
      page.getByTestId('custom-fields').getByText(/Enter a full web address/),
    ).toBeVisible();
    await page.getByLabel('Admin console URL').fill('https://admin.example.org/devices');
    await choose(page, /^Condition/, 'Good');
    await page.getByLabel(/^Cost/).fill('289.00');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00131');
    await expect(page.getByText('ChromeOS 126')).toBeVisible();
    await expect(page.getByText('11.6')).toBeVisible();
    await expect(page.getByText('$289.00')).toBeVisible();
    await expect(page.getByText('Charger')).toBeVisible();
  });

  test('a typed tag overrides numbering; a duplicate tag is flagged with a link to the asset', async ({
    page,
  }) => {
    await page.goto('/assets/new');
    await choose(page, /^Category/, 'Projector');
    await page.getByRole('radio', { name: 'Enter my own' }).check();
    await page.getByLabel(/^Tag/).fill('PRJ-00001');
    await page.getByLabel(/^Tag/).blur();
    await expect(page.getByRole('link', { name: 'Open that asset' })).toBeVisible();
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByText('This asset tag is already in use', { exact: true })).toBeVisible();
    await page.getByLabel(/^Tag/).fill('PRJ-MY-1');
    await page.getByLabel('Lamp hours').fill('120');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-MY-1');
  });

  test('changing the category warns before discarding custom values', async ({ page }) => {
    await page.goto('/assets/new');
    await choose(page, /^Category/, 'Chromebook');
    await page.getByLabel(/^OS version/).fill('ChromeOS 1');
    await choose(page, /^Category/, 'Laptop');
    const banner = page.getByRole('status').filter({ hasText: 'Change the category?' });
    await expect(banner).toContainText('OS version');
    await banner.getByRole('button', { name: 'Keep the category' }).click();
    await expect(page.getByLabel(/^OS version/)).toHaveValue('ChromeOS 1');
    await choose(page, /^Category/, 'Laptop');
    await page.getByRole('button', { name: 'Change anyway' }).click();
    await expect(page.getByRole('group', { name: 'Fields for Laptop' })).toBeVisible();
    await expect(page.getByLabel(/^OS version/)).toHaveCount(0);
  });

  test('Save and add another keeps category, model and purchase info for fast entry', async ({
    page,
  }) => {
    await page.goto('/assets/new');
    await choose(page, /^Category/, 'Tablet');
    await choose(page, /^Model/, /iPad 9th gen/);
    await page.getByLabel('Purchase date').fill('2026-11-01');
    await page.getByLabel('Serial number').fill('TAB-ONE');
    await page.getByRole('button', { name: 'Save and add another' }).click();
    // the toast text is mirrored into a live region for screen readers: take the visible toast
    await expect(page.getByText('Created TAB-00021.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Serial number')).toHaveValue('');
    await expect(page.getByLabel('Serial number')).toBeFocused();
    await expect(page.getByLabel('Purchase date')).toHaveValue('2026-11-01');
    await expect(page.getByRole('combobox', { name: /^Model/ })).toContainText('iPad 9th gen');
    await page.getByLabel('Serial number').fill('TAB-TWO');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('TAB-00022');
  });

  test('edit saves with the ETag and shows the result', async ({ page }) => {
    await page.goto(`/assets/edit?id=${assetId(124)}`);
    await expect(page.getByRole('heading', { name: 'Edit asset', level: 1 })).toBeVisible();
    await page.getByLabel('Name', { exact: true }).fill('Renamed Chromebook');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByRole('heading', { name: 'Renamed Chromebook' })).toBeVisible();
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByRole('list', { name: 'History' })).toContainText('Updated');
  });

  test('a stale edit (412) offers to reload and keeps my changes when asked', async ({ page }) => {
    const id = assetId(30);
    await page.goto(`/assets/edit?id=${id}`);
    await expect(page.getByRole('heading', { name: 'Edit asset', level: 1 })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /^Tag/ })).toHaveValue('AT-00030');

    // someone else saves the same asset in the meantime (a different field)
    await page.evaluate(async (assetUrl) => {
      const read = await fetch(assetUrl);
      await fetch(assetUrl, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'csrf-e2e',
          'if-match': read.headers.get('etag') ?? '',
        },
        body: JSON.stringify({ notes: 'changed by someone else' }),
      });
    }, `/v1/assets/${id}`);

    await page.getByLabel('Serial number').fill('SN-MINE');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    const banner = page.getByRole('status').filter({ hasText: 'This asset changed' });
    await expect(banner).toBeVisible();

    await banner.getByRole('button', { name: 'Reload and keep my changes' }).click();
    await expect(banner).toBeHidden();
    await expect(page.getByLabel('Notes')).toHaveValue('changed by someone else');
    await expect(page.getByLabel('Serial number')).toHaveValue('SN-MINE');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00030');
    await expect(page.getByText('SN-MINE').first()).toBeVisible();
    await expect(page.getByText('changed by someone else')).toBeVisible();
  });

  test('a stale edit can also discard my changes in favour of the latest version', async ({
    page,
  }) => {
    const id = assetId(31);
    await page.goto(`/assets/edit?id=${id}`);
    await expect(page.getByRole('textbox', { name: /^Tag/ })).toHaveValue('AT-00031');
    await page.evaluate(async (assetUrl) => {
      const read = await fetch(assetUrl);
      await fetch(assetUrl, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'csrf-e2e',
          'if-match': read.headers.get('etag') ?? '',
        },
        body: JSON.stringify({ serial: 'SN-THEIRS' }),
      });
    }, `/v1/assets/${id}`);
    await page.getByLabel('Serial number').fill('SN-MINE');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Reload and discard my changes' }).click();
    await expect(page.getByLabel('Serial number')).toHaveValue('SN-THEIRS');
  });

  test('clone prefills everything except tag and serial and creates a new asset', async ({
    page,
  }) => {
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await page.getByRole('link', { name: 'Clone' }).click();
    await expect(page.getByRole('heading', { name: 'Clone asset', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Serial number')).toHaveValue('');
    await expect(page.getByRole('radio', { name: 'Automatic' })).toBeChecked();
    await expect(page.getByRole('combobox', { name: /^Category/ })).toContainText('Chromebook');
    await expect(page.getByLabel(/^OS version/)).not.toHaveValue('');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00131');
  });

  test('works at 375px width without horizontal page scroll', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    for (const url of ['/assets', '/assets/new', `/assets/view?id=${assetId(124)}`]) {
      await page.goto(url);
      await settled(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, url).toBeLessThanOrEqual(0);
    }
  });
});
