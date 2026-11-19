import type { Page } from '@playwright/test';
import { violations } from './axe';
import { assetId, expect, settled, test } from './fixtures';
import { heldAsset, pick, readyAsset, wedge } from './m2-helpers';

/**
 * axe (WCAG 2.2 A/AA incl. contrast) in light and dark for every screen and dialog added by M2 wave 1:
 * locations, people, the custody dialogs, the scan panel, history and attachments.
 */
interface Scenario {
  name: string;
  open: (page: Page) => Promise<void>;
}

const tree = (p: Page) => p.getByRole('tree', { name: 'Locations' });

const SCENARIOS: Scenario[] = [
  {
    name: 'locations: tree with a selected site',
    open: async (p) => {
      await p.goto('/locations');
      await tree(p)
        .getByRole('treeitem', { name: /^Riverside Elementary/ })
        .click();
      await expect(p.getByTestId('location-name')).toBeVisible();
      await expect(
        p.getByRole('region', { name: 'Assets here' }).getByRole('listitem').first(),
      ).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'locations: expanded tree',
    open: async (p) => {
      await p.goto('/locations');
      const site = tree(p).getByRole('treeitem', { name: /^Riverside Elementary/ });
      await site.focus();
      await p.keyboard.press('ArrowRight');
      await expect(tree(p).getByRole('treeitem', { name: /^Main building/ })).toBeVisible();
    },
  },
  {
    name: 'locations: add dialog with the picker open',
    open: async (p) => {
      await p.goto('/locations');
      await p.getByRole('button', { name: 'Add location' }).click();
      const dialog = p.getByRole('dialog', { name: 'Add a location' });
      await dialog.getByRole('combobox', { name: /Inside/ }).click();
      await expect(p.getByRole('listbox')).toBeVisible();
    },
  },
  {
    name: 'locations: add dialog with an error',
    open: async (p) => {
      await p.goto('/locations');
      await p.getByRole('button', { name: 'Add location' }).click();
      const dialog = p.getByRole('dialog', { name: 'Add a location' });
      await dialog.getByRole('button', { name: 'Add location' }).click();
      await expect(dialog.getByText('This field is required.')).toBeVisible();
    },
  },
  {
    name: 'locations: move dialog',
    open: async (p) => {
      await p.goto('/locations');
      await tree(p)
        .getByRole('treeitem', { name: /^Riverside Elementary/ })
        .click();
      await p.getByRole('button', { name: 'Move' }).click();
      await expect(p.getByRole('dialog', { name: 'Move Riverside Elementary' })).toBeVisible();
    },
  },
  {
    name: 'locations: archive refused for a location in use',
    open: async (p) => {
      await p.goto('/locations');
      await tree(p)
        .getByRole('treeitem', { name: /^Riverside Elementary/ })
        .click();
      await p.getByRole('button', { name: 'Archive', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: 'Archive Riverside Elementary?' });
      await dialog.getByRole('button', { name: 'Archive' }).click();
      await expect(dialog.getByRole('alert')).toBeVisible();
    },
  },
  {
    name: 'people: list',
    open: async (p) => {
      await p.goto('/people');
      await expect(p.getByRole('row', { name: /Alice Owner/ })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'people: empty search result',
    open: async (p) => {
      await p.goto('/people');
      await p.getByRole('searchbox', { name: 'Search' }).fill('zzzz');
      await expect(p.getByRole('heading', { name: 'Nobody matches' })).toBeVisible();
    },
  },
  {
    name: 'people: add dialog with server errors',
    open: async (p) => {
      await p.goto('/people');
      await p.getByRole('button', { name: 'Add person' }).click();
      const dialog = p.getByRole('dialog', { name: 'Add a person' });
      await dialog.getByLabel(/^Name/).fill('Dana');
      await dialog.getByLabel(/^E-mail/).fill('alice@example.org');
      await dialog.getByRole('button', { name: 'Add person' }).click();
      await expect(dialog.getByText('This e-mail address is already in use')).toBeVisible();
    },
  },
  {
    name: 'people: a person with login, overview',
    open: async (p) => {
      await p.goto('/people');
      await p.getByRole('link', { name: 'Alice Owner' }).click();
      await expect(p.getByText('Has a login account.')).toBeVisible();
    },
  },
  {
    name: 'people: assets held and history tabs',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByTestId('asset-holder').getByRole('link').click();
      await p.getByRole('tab', { name: /Assets held/ }).click();
      await expect(p.getByRole('row', { name: new RegExp(asset.asset_tag) })).toBeVisible();
      await p
        .getByRole('row', { name: new RegExp(asset.asset_tag) })
        .getByRole('checkbox')
        .click();
      await expect(p.getByRole('button', { name: /^Check in \(1\)/ })).toBeVisible();
    },
  },
  {
    name: 'people: history of past custody',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByTestId('asset-holder').getByRole('link').click();
      await p.getByRole('tab', { name: 'History' }).click();
      await expect(p.getByRole('list', { name: 'History' })).toBeVisible();
    },
  },
  {
    name: 'assets: list with custody columns and filters',
    open: async (p) => {
      await p.goto('/assets');
      await expect(p.getByRole('columnheader', { name: 'Assigned to' })).toBeVisible();
      await expect(p.getByTestId('assets-range')).toContainText('of 195');
      await settled(p);
    },
  },
  {
    name: 'assets: bulk bar with check-in and check-out',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('checkbox', { name: 'Select row PRJ-00010' }).click();
      await expect(p.getByRole('button', { name: /^Check out/ })).toBeVisible();
    },
  },
  {
    name: 'assets: location filter picker open',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('combobox', { name: 'Location' }).click();
      await expect(p.getByRole('listbox')).toBeVisible();
    },
  },
  {
    name: 'assets: held asset detail (assigned, due date)',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await expect(p.getByTestId('asset-holder')).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'assets: history tab',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto(`/assets/view?id=${asset.id}&tab=history`);
      await expect(p.getByRole('list', { name: 'History' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'assets: attachments tab with every scan state',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}&tab=attachments`);
      await expect(
        p.getByRole('list', { name: 'Attached files' }).getByRole('listitem'),
      ).toHaveCount(4);
      await settled(p);
    },
  },
  {
    name: 'assets: attachments with a failed upload',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}&tab=attachments`);
      await p.locator('input[type=file]').setInputFiles({
        name: 'setup.exe',
        mimeType: 'application/x-msdownload',
        buffer: Buffer.from('MZ'),
      });
      await expect(p.getByRole('alert').filter({ hasText: 'not allowed' })).toBeVisible();
    },
  },
  {
    name: 'assets: delete attachment confirmation',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}&tab=attachments`);
      await p.getByRole('button', { name: 'Delete purchase-order.pdf' }).click();
      await expect(p.getByRole('dialog', { name: 'Delete purchase-order.pdf?' })).toBeVisible();
    },
  },
  {
    name: 'custody: check-out dialog',
    open: async (p) => {
      const asset = await readyAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByRole('button', { name: 'Check out', exact: true }).click();
      await expect(p.getByRole('dialog', { name: `Check out ${asset.asset_tag}` })).toBeVisible();
    },
  },
  {
    name: 'custody: check-out dialog with the person list open and errors',
    open: async (p) => {
      const asset = await readyAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByRole('button', { name: 'Check out', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
      await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
      await expect(dialog.getByText('Choose who or where it goes.')).toBeVisible();
      await dialog.getByRole('combobox', { name: /Person/ }).click();
      await expect(p.getByRole('listbox')).toBeVisible();
      await expect(p.getByRole('option').first()).toBeVisible();
    },
  },
  {
    name: 'custody: check-in dialog with the photo slot',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByRole('button', { name: 'Check in', exact: true }).click();
      await expect(p.getByRole('dialog', { name: `Check in ${asset.asset_tag}` })).toBeVisible();
    },
  },
  {
    name: 'custody: transfer dialog',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByRole('button', { name: 'Transfer', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: `Transfer ${asset.asset_tag}` });
      await dialog.getByRole('radio', { name: 'Location' }).check();
      await expect(dialog.getByRole('combobox', { name: /Location/ })).toBeVisible();
    },
  },
  {
    name: 'custody: stale-asset banner',
    open: async (p) => {
      const asset = await readyAsset(p);
      await p.goto(`/assets/view?id=${asset.id}`);
      await p.getByRole('button', { name: 'Check out', exact: true }).click();
      const dialog = p.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
      await expect(dialog.getByTestId('custody-asset-tag')).toBeVisible();
      await pick(p, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
      await p.evaluate(
        async ({ id, etag }) => {
          await fetch(`/v1/assets/${id}`, {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': 'csrf-e2e',
              'if-match': etag,
            },
            body: JSON.stringify({ notes: 'other' }),
          });
        },
        { id: asset.id, etag: asset.etag },
      );
      await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
      await expect(
        dialog.getByRole('status').filter({ hasText: 'The asset changed' }),
      ).toBeVisible();
    },
  },
  {
    name: 'custody: bulk check-in dialog',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('combobox', { name: 'Custody' }).click();
      await p.getByRole('option', { name: 'Checked out', exact: true }).click();
      await expect(p.getByRole('row').nth(2)).toBeVisible();
      await p.getByRole('row').nth(1).getByRole('checkbox').click();
      await p.getByRole('row').nth(2).getByRole('checkbox').click();
      await p.getByRole('button', { name: /^Check in \(2\)/ }).click();
      await expect(p.getByRole('dialog', { name: 'Check in 2 assets' })).toBeVisible();
    },
  },
  {
    name: 'scan: panel in open mode',
    open: async (p) => {
      await p.goto('/');
      await expect(p.locator('main#main')).toBeVisible();
      await p.getByRole('button', { name: 'Scan assets' }).click();
      await expect(p.getByRole('dialog', { name: 'Scan assets' })).toBeVisible();
    },
  },
  {
    name: 'scan: panel in batch mode with results',
    open: async (p) => {
      const asset = await heldAsset(p);
      await p.goto('/');
      await expect(p.locator('main#main')).toBeVisible();
      await p.getByRole('button', { name: 'Scan assets' }).click();
      const panel = p.getByRole('dialog', { name: 'Scan assets' });
      await panel.getByRole('combobox', { name: 'When I scan' }).click();
      await p.getByRole('option', { name: 'Check in', exact: true }).click();
      const field = panel.getByRole('textbox', { name: 'Scan or type an asset tag' });
      await expect(field).toBeFocused();
      await field.fill(asset.asset_tag);
      await field.press('Enter');
      await expect(panel.getByTestId('scan-log')).toContainText('checked in');
      await field.fill('ZZ-0000');
      await field.press('Enter');
      await expect(panel.getByTestId('scan-log')).toContainText('No asset matches');
    },
  },
  {
    name: 'scan: not-found notice from a wedge scan',
    open: async (p) => {
      await p.goto('/');
      await wedge(p, 'ZZ-99999');
      await expect(p.getByText('No asset matches "ZZ-99999".').first()).toBeVisible();
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const scenario of SCENARIOS) {
    test(`axe: ${scenario.name} (${scheme})`, async ({ page: p }) => {
      await p.emulateMedia({ colorScheme: scheme });
      await scenario.open(p);
      expect(await violations(p)).toEqual([]);
    });
  }
}

/** The new screens at the three reference widths: no page-level horizontal scroll. */
test.describe('responsive layout of the M2 screens (375, 768, 1440)', () => {
  for (const width of [375, 768, 1440]) {
    for (const url of [
      '/locations',
      '/people',
      `/assets/view?id=${assetId(124)}&tab=attachments`,
      `/assets/view?id=${assetId(124)}&tab=history`,
    ]) {
      test(`${url} has no horizontal page scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main')).toBeVisible();
        await settled(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test(`the check-out dialog fits at ${width}px`, async ({ page }) => {
      const asset = await readyAsset(page);
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`/assets/view?id=${asset.id}`);
      await page.getByRole('button', { name: 'Check out', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
      await expect(dialog).toBeVisible();
      expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
