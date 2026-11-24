import type { Page } from '@playwright/test';
import { violations } from './axe';
import { expect, settled, test } from './fixtures';
import {
  api,
  bigCsv,
  CSV_ASSETS,
  CSV_MATCHING,
  importAt,
  loadApp,
  looseDevice,
  poolWithDevices,
  staffPool,
  studentPool,
} from './w3-helpers';

/**
 * axe (WCAG 2.2 A/AA incl. contrast) in light and dark for every screen and dialog of M2 wave 3:
 * the loaner dashboard, desk (lending, a problem, returning), pools and one pool, and every step of
 * the import wizard (choose, file, columns, values, dry run, importing, finished, failed). Then the
 * same screens at 375, 768 and 1440 px: no horizontal page scroll, dialogs inside the screen.
 */
interface Scenario {
  name: string;
  open: (page: Page) => Promise<void>;
}

const job = (page: Page, id: string, step?: string) =>
  page.goto(`/imports/job?id=${id}${step ? `&step=${step}` : ''}`);

const SCENARIOS: Scenario[] = [
  // ---- loaners ----
  {
    name: 'loaners: dashboard',
    open: async (p) => {
      await p.goto('/loaners');
      await expect(p.getByRole('article', { name: /Student Chromebook loaners/ })).toBeVisible();
      await expect(
        p.getByRole('table', { name: 'Overdue loans' }).getByText('5 days late'),
      ).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'loaners: extend a loan dialog',
    open: async (p) => {
      await p.goto('/loaners');
      await p
        .getByRole('table', { name: 'Overdue loans' })
        .getByRole('button', { name: /^Extend the loan of / })
        .first()
        .click();
      await expect(p.getByRole('dialog', { name: /^Extend the loan of / })).toBeVisible();
    },
  },
  {
    name: 'loaners: desk ready to lend',
    open: async (p) => {
      await p.goto('/loaners/desk');
      await expect(p.getByLabel('Device', { exact: true })).toBeFocused();
    },
  },
  {
    name: 'loaners: desk with devices and a borrower',
    open: async (p) => {
      await loadApp(p);
      const staff = await staffPool(p);
      const members = await api<{ data: Array<{ asset: { asset_tag: string } }> }>(
        p,
        'GET',
        `/v1/loaner-pools/${staff.id}/members?available=true`,
      );
      await p.goto('/loaners/desk');
      const device = p.getByLabel('Device', { exact: true });
      for (const member of members.json.data) {
        await device.fill(member.asset.asset_tag);
        await device.press('Enter');
      }
      await p.getByLabel('Borrower', { exact: true }).fill('Alice Owner');
      await p.getByLabel('Borrower', { exact: true }).press('Enter');
      await expect(p.getByTestId('desk-summary')).toContainText('Alice Owner');
    },
  },
  {
    name: 'loaners: desk after a lend',
    open: async (p) => {
      await loadApp(p);
      const staff = await staffPool(p);
      const members = await api<{ data: Array<{ asset: { asset_tag: string } }> }>(
        p,
        'GET',
        `/v1/loaner-pools/${staff.id}/members?available=true`,
      );
      await p.goto('/loaners/desk');
      const device = p.getByLabel('Device', { exact: true });
      await device.fill(members.json.data[0]!.asset.asset_tag);
      await device.press('Enter');
      await p.getByLabel('Borrower', { exact: true }).fill('Alice Owner');
      await p.getByLabel('Borrower', { exact: true }).press('Enter');
      await expect(p.getByRole('button', { name: 'Lend 1 device' })).toBeFocused();
      await p.keyboard.press('Enter');
      await expect(p.getByTestId('desk-feedback')).toContainText('lent to Alice Owner');
    },
  },
  {
    name: 'loaners: desk with a device the pool refuses',
    open: async (p) => {
      await loadApp(p);
      const loose = await looseDevice(p);
      await p.goto('/loaners/desk');
      const device = p.getByLabel('Device', { exact: true });
      await device.fill(loose.asset_tag);
      await device.press('Enter');
      await p.getByLabel('Borrower', { exact: true }).fill('Alice Owner');
      await p.getByLabel('Borrower', { exact: true }).press('Enter');
      await p.getByRole('button', { name: 'Lend 1 device' }).click();
      await expect(p.getByTestId('desk-feedback')).toContainText('No device could be lent');
      await expect(p.getByRole('list', { name: 'Devices to lend' })).toContainText(
        'is not in this loaner pool',
      );
    },
  },
  {
    name: 'loaners: desk bulk return',
    open: async (p) => {
      await p.goto('/loaners/desk?mode=return');
      await expect(p.getByLabel('Returned device')).toBeFocused();
    },
  },
  {
    name: 'loaners: pools and defaults',
    open: async (p) => {
      await p.goto('/loaners/pools');
      await expect(p.getByRole('row', { name: /Student Chromebook loaners/ })).toBeVisible();
      await expect(p.getByLabel('Remind the borrower (days before the due date)')).toHaveValue('2');
      await settled(p);
    },
  },
  {
    name: 'loaners: new pool dialog',
    open: async (p) => {
      await p.goto('/loaners/pools');
      await p.getByRole('button', { name: 'New pool' }).click();
      await expect(p.getByRole('dialog', { name: 'New loaner pool' })).toBeVisible();
    },
  },
  {
    name: 'loaners: new pool dialog with errors',
    open: async (p) => {
      await p.goto('/loaners/pools');
      await p.getByRole('button', { name: 'New pool' }).click();
      const dialog = p.getByRole('dialog', { name: 'New loaner pool' });
      await dialog.getByRole('button', { name: 'Create pool' }).click();
      await expect(dialog.getByRole('alert').first()).toBeVisible();
    },
  },
  {
    name: 'loaners: one pool',
    open: async (p) => {
      await loadApp(p);
      const pool = await studentPool(p);
      await p.goto(`/loaners/pool?id=${pool.id}`);
      await expect(p.getByTestId('pool-range')).toHaveText('Showing 8 of 8');
      await settled(p);
    },
  },
  {
    name: 'loaners: one pool, overdue only',
    open: async (p) => {
      await loadApp(p);
      const pool = await studentPool(p);
      await p.goto(`/loaners/pool?id=${pool.id}&show=overdue`);
      await expect(p.getByTestId('pool-range')).toHaveText('Showing 1 of 8');
      await settled(p);
    },
  },
  {
    name: 'loaners: add a device dialog',
    open: async (p) => {
      await loadApp(p);
      const pool = await studentPool(p);
      await p.goto(`/loaners/pool?id=${pool.id}`);
      await p.getByRole('button', { name: 'Add device' }).click();
      await expect(p.getByRole('dialog', { name: /Add a device to/ })).toBeVisible();
    },
  },
  {
    name: 'loaners: archive pool confirmation',
    open: async (p) => {
      await loadApp(p);
      const { pool } = await poolWithDevices(p, 'Short lived', 1);
      await p.goto(`/loaners/pool?id=${pool.id}`);
      await p.getByRole('button', { name: 'Archive pool' }).click();
      await expect(p.getByRole('dialog', { name: 'Archive Short lived?' })).toBeVisible();
    },
  },
  {
    name: 'dashboard: overdue card with the loaner link',
    open: async (p) => {
      await p.goto('/');
      await expect(p.getByTestId('panel-overdue-link')).toBeVisible();
      await settled(p);
    },
  },
  // ---- imports ----
  {
    name: 'imports: first use',
    open: async (p) => {
      await p.goto('/imports');
      await expect(p.getByRole('heading', { name: 'No imports yet' })).toBeVisible();
    },
  },
  {
    name: 'imports: list with imports',
    open: async (p) => {
      await loadApp(p);
      await importAt(p, 'mapped', { csv: CSV_MATCHING, filename: 'devices.csv' });
      await importAt(p, 'draft');
      await p.goto('/imports');
      await expect(p.getByRole('row', { name: /devices\.csv/ })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'imports: choose the data',
    open: async (p) => {
      await p.goto('/imports/new');
      await expect(p.getByRole('radio', { name: /^Assets/ })).toBeChecked();
    },
  },
  {
    name: 'imports: choose the data with an import to resume',
    open: async (p) => {
      await loadApp(p);
      await importAt(p, 'uploaded');
      await p.goto('/imports/new');
      await expect(p.getByRole('link', { name: 'Continue it' })).toBeVisible();
    },
  },
  {
    name: 'imports: upload the file',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'draft');
      await job(p, id);
      await expect(p.getByRole('heading', { name: 'Upload your file' })).toBeVisible();
    },
  },
  {
    name: 'imports: the file is being scanned',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'draft');
      await job(p, id);
      await p.locator('input[type="file"]').setInputFiles({
        name: 'devices.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(CSV_ASSETS),
      });
      await expect(p.getByText('Scanning').first()).toBeVisible();
    },
  },
  {
    name: 'imports: match the columns',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'uploaded');
      await job(p, id);
      await expect(p.getByRole('table', { name: 'Columns of your file' })).toBeVisible();
      await expect(p.getByText(/We matched 4 of your columns/)).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'imports: match the columns with a problem',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'uploaded');
      await job(p, id);
      const columns = p.getByRole('table', { name: 'Columns of your file' });
      await columns.getByRole('combobox', { name: 'Field for column Category' }).click();
      await p.getByRole('option', { name: '(Do not import)' }).click();
      await expect(p.getByText(/Choose a column for the category/)).toBeVisible();
    },
  },
  {
    name: 'imports: a file that cannot be read',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'uploaded', {
        csv: 'Serial,Name\n"5CG1,Broken',
        filename: 'broken.csv',
      });
      await job(p, id);
      await expect(p.getByRole('heading', { name: 'The import failed' })).toBeVisible();
    },
  },
  {
    name: 'imports: match the values',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'mapped');
      await job(p, id, 'values');
      await expect(p.getByRole('table', { name: 'Values of Location' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'imports: the dry run is checking',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'dry-run-running', {
        csv: bigCsv(3000),
        mapping: { 'Serial Number': 'serial', 'Asset ID': 'asset_tag', Category: 'category' },
      });
      await job(p, id);
      await expect(p.getByRole('progressbar', { name: 'Checking your file...' })).toBeVisible();
    },
  },
  {
    name: 'imports: dry run result',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'reviewed');
      await job(p, id);
      await expect(p.getByTestId('import-tile-create')).toBeVisible();
      await expect(p.getByTestId('import-range')).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'imports: dry run errors only',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'reviewed');
      await job(p, id);
      await p.getByRole('button', { name: 'Errors' }).click();
      await expect(p.getByTestId('import-range')).toContainText('of 1');
      await settled(p);
    },
  },
  {
    name: 'imports: importing with progress',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'committing', {
        csv: bigCsv(600),
        mapping: { 'Serial Number': 'serial', 'Asset ID': 'asset_tag', Category: 'category' },
      });
      await job(p, id);
      await expect(p.getByRole('progressbar', { name: 'Import progress' })).toBeVisible();
    },
  },
  {
    name: 'imports: finished',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'committed', {
        csv: CSV_MATCHING,
        mapping: { 'Serial Number': 'serial', 'Asset ID': 'asset_tag', Category: 'category' },
      });
      await job(p, id);
      await expect(p.getByRole('heading', { name: 'Import finished' })).toBeVisible();
    },
  },
  {
    name: 'imports: finished with rows that failed',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'committed');
      await job(p, id);
      await expect(p.getByRole('heading', { name: 'Import finished' })).toBeVisible();
      await expect(p.getByText(/could not be imported/).first()).toBeVisible();
    },
  },
  {
    name: 'imports: failed',
    open: async (p) => {
      await loadApp(p);
      const { id } = await importAt(p, 'uploaded', {
        csv: 'Serial,Name\n"5CG1,Broken',
        filename: 'broken.csv',
      });
      await job(p, id);
      await expect(p.getByRole('heading', { name: 'The import failed' })).toBeVisible();
      await expect(p.getByRole('button', { name: 'Read the file again' })).toBeVisible();
    },
  },
  {
    name: 'assets: the import button and settings links',
    open: async (p) => {
      await p.goto('/assets');
      await expect(p.getByRole('link', { name: 'Import' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'settings: navigation with imports and loaner pools',
    open: async (p) => {
      await p.goto('/settings/organisation');
      await expect(p.getByRole('link', { name: 'Loaner pools' })).toBeVisible();
      await settled(p);
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const scenario of SCENARIOS) {
    test(`axe: ${scenario.name} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await scenario.open(page);
      expect(await violations(page)).toEqual([]);
    });
  }
}

/** The screens at the three reference widths: no page-level horizontal scroll, dialogs inside the screen. */
test.describe('responsive layout of the wave 3 screens (375, 768, 1440)', () => {
  const FIT = [
    'loaners: dashboard',
    'loaners: desk with devices and a borrower',
    'loaners: desk with a device the pool refuses',
    'loaners: desk bulk return',
    'loaners: pools and defaults',
    'loaners: new pool dialog',
    'loaners: one pool',
    'loaners: add a device dialog',
    'imports: list with imports',
    'imports: choose the data',
    'imports: upload the file',
    'imports: match the columns',
    'imports: match the values',
    'imports: dry run result',
    'imports: importing with progress',
    'imports: finished with rows that failed',
  ];
  for (const width of [375, 768, 1440]) {
    for (const scenario of SCENARIOS.filter((s) => FIT.includes(s.name))) {
      test(`${scenario.name} has no horizontal page scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await scenario.open(page);
        await settled(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
        const dialog = page.getByRole('dialog');
        if (await dialog.count()) {
          const box = (await dialog.first().boundingBox())!;
          expect(box.x).toBeGreaterThanOrEqual(0);
          expect(box.x + box.width).toBeLessThanOrEqual(width);
        }
      });
    }
  }
});
