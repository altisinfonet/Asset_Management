import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { violations } from './axe';
import { assetId, expect, settled, test } from './fixtures';
import { choose, pick, readyAsset } from './m2-helpers';

/**
 * axe (WCAG 2.2 A/AA incl. contrast) in light and dark for every screen and dialog added by M2 wave 2:
 * labels, accessories and consumables, the repair log, notifications, saved views, CSV export and the
 * Security page with an enforced policy. Then the new screens at 375, 768 and 1440 px.
 */
interface Scenario {
  name: string;
  open: (page: Page) => Promise<void>;
  session?: string;
}

const accessoryLink = (p: Page, name: string) => p.getByRole('link', { name, exact: true });

const SCENARIOS: Scenario[] = [
  // ---- accessories and consumables ----
  {
    name: 'stock: accessories list',
    open: async (p) => {
      await p.goto('/stock');
      await expect(p.getByRole('row', { name: /HDMI cable 2 m/ })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'stock: consumables list',
    open: async (p) => {
      await p.goto('/stock?kind=consumable');
      await expect(p.getByRole('row', { name: /Toner HP 26A/ })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'stock: nothing matches the filter',
    open: async (p) => {
      await p.goto('/stock');
      await p.getByRole('searchbox', { name: 'Search' }).fill('zzzz');
      await expect(p.getByRole('heading', { name: 'Nothing matches' })).toBeVisible();
    },
  },
  {
    name: 'stock: accessory page with who holds it',
    open: async (p) => {
      await p.goto('/stock');
      await accessoryLink(p, 'USB-C charger 65 W').click();
      await expect(p.getByRole('table', { name: 'People and places holding this' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'stock: accessory returned history tab',
    open: async (p) => {
      await p.goto('/stock');
      // the sleeve has a hand-out that came back in full
      await accessoryLink(p, 'Laptop sleeve 14 in').click();
      await p.getByRole('tab', { name: 'History' }).click();
      await expect(p.getByRole('tab', { name: 'History' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(p.getByRole('table', { name: 'People and places holding this' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'stock: consumable page with the ledger',
    open: async (p) => {
      await p.goto('/stock?kind=consumable');
      await accessoryLink(p, 'Toner HP 26A').click();
      await expect(p.getByRole('table', { name: 'Stock movements' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'stock: details and files tabs',
    open: async (p) => {
      await p.goto('/stock');
      await accessoryLink(p, 'HDMI cable 2 m').click();
      await p.getByRole('tab', { name: 'Details' }).click();
      await expect(p.getByText('Model number')).toBeVisible();
    },
  },
  {
    name: 'stock: new accessory dialog with errors',
    open: async (p) => {
      await p.goto('/stock');
      await p.getByRole('button', { name: 'New accessory' }).click();
      const dialog = p.getByRole('dialog', { name: 'New accessory' });
      await dialog.getByRole('button', { name: 'Create' }).click();
      await expect(dialog.getByText('This field is required.').first()).toBeVisible();
    },
  },
  {
    name: 'stock: check-out dialog with errors',
    open: async (p) => {
      await p.goto('/stock');
      await p.getByRole('button', { name: 'Check out HDMI cable 2 m' }).click();
      const dialog = p.getByRole('dialog', { name: 'Check out HDMI cable 2 m' });
      await dialog.getByRole('spinbutton', { name: /^Quantity/ }).fill('9');
      await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
      await expect(dialog.getByText('Choose who gets it.')).toBeVisible();
    },
  },
  {
    name: 'stock: return dialog',
    open: async (p) => {
      await p.goto('/stock');
      await accessoryLink(p, 'USB-C charger 65 W').click();
      await p
        .getByRole('button', { name: /^Return units from/ })
        .first()
        .click();
      await expect(p.getByRole('dialog', { name: /^Return units of/ })).toBeVisible();
    },
  },
  {
    name: 'stock: receive dialog',
    open: async (p) => {
      await p.goto('/stock?kind=consumable');
      await p.getByRole('button', { name: 'Receive Toner HP 26A' }).click();
      await expect(p.getByRole('dialog', { name: 'Receive stock for Toner HP 26A' })).toBeVisible();
    },
  },
  {
    name: 'stock: use dialog with an error',
    open: async (p) => {
      await p.goto('/stock?kind=consumable');
      await p.getByRole('button', { name: 'Use Toner HP 26A' }).click();
      const dialog = p.getByRole('dialog', { name: 'Use Toner HP 26A' });
      await dialog.getByRole('spinbutton', { name: /^Units used/ }).fill('5');
      await dialog.getByRole('button', { name: 'Use', exact: true }).click();
      await expect(dialog.getByText('Only 2 are on hand.')).toBeVisible();
    },
  },
  {
    name: 'stock: count dialog with the difference',
    open: async (p) => {
      await p.goto('/stock?kind=consumable');
      await accessoryLink(p, 'Printer paper A4').click();
      await p.getByRole('button', { name: 'Save count' }).click();
      const dialog = p.getByRole('dialog', { name: 'Count Printer paper A4' });
      await dialog.getByRole('spinbutton', { name: /^Counted on hand/ }).fill('20');
      await expect(dialog.getByTestId('count-delta')).toBeVisible();
    },
  },
  {
    name: 'stock: minimum stock dialog',
    open: async (p) => {
      await p.goto('/stock');
      await accessoryLink(p, 'HDMI cable 2 m').click();
      await p.getByRole('button', { name: 'Change minimum' }).click();
      await expect(p.getByRole('dialog', { name: /^Minimum stock for/ })).toBeVisible();
    },
  },
  // ---- repairs ----
  {
    name: 'repairs: open list',
    open: async (p) => {
      await p.goto('/repairs');
      await expect(p.getByRole('row', { name: /Cracked screen, replace/ })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'repairs: closed list and no matches',
    open: async (p) => {
      await p.goto('/repairs');
      await p.getByRole('tab', { name: /Closed/ }).click();
      await expect(p.getByRole('row', { name: /Replace screen/ })).toBeVisible();
      await p.getByLabel('Reported from').fill('2099-01-01');
      await expect(p.getByRole('heading', { name: 'No repairs match' })).toBeVisible();
    },
  },
  {
    name: 'repairs: drawer of one repair',
    open: async (p) => {
      await p.goto('/repairs');
      await p.getByRole('button', { name: 'Open repair Cracked screen, replace' }).click();
      const drawer = p.getByRole('dialog', { name: 'Cracked screen, replace' });
      await expect(
        drawer.getByRole('region', { name: 'Quotes, receipts and photos' }),
      ).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'repairs: log dialog with errors',
    open: async (p) => {
      await p.goto('/repairs');
      await p.getByRole('button', { name: 'Log repair' }).click();
      const dialog = p.getByRole('dialog', { name: 'Log a repair' });
      await dialog.getByRole('button', { name: 'Log repair' }).click();
      await expect(dialog.getByText('Choose the asset.')).toBeVisible();
    },
  },
  {
    name: 'repairs: files step after logging',
    open: async (p) => {
      const asset = await readyAsset(p);
      await p.goto('/repairs');
      await p.getByRole('button', { name: 'Log repair' }).click();
      const dialog = p.getByRole('dialog', { name: 'Log a repair' });
      await pick(
        p,
        dialog.getByRole('combobox', { name: /^Asset\(required\)/ }),
        asset.asset_tag,
        new RegExp(asset.asset_tag),
      );
      await dialog.getByRole('textbox', { name: /^What needs doing/ }).fill('Broken hinge');
      await dialog.getByRole('button', { name: 'Log repair' }).click();
      await expect(p.getByRole('dialog', { name: 'Repair logged' })).toBeVisible();
    },
  },
  {
    name: 'repairs: close dialog',
    open: async (p) => {
      await p.goto('/repairs');
      await p.getByRole('button', { name: 'Open repair Cracked screen, replace' }).click();
      await p
        .getByRole('dialog', { name: 'Cracked screen, replace' })
        .getByRole('button', { name: 'Close repair' })
        .click();
      await expect(p.getByRole('dialog', { name: /^Close repair "/ })).toBeVisible();
    },
  },
  {
    name: 'repairs: cancel confirmation',
    open: async (p) => {
      await p.goto('/repairs');
      await p.getByRole('button', { name: 'Open repair Cracked screen, replace' }).click();
      await p
        .getByRole('dialog', { name: 'Cracked screen, replace' })
        .getByRole('button', { name: 'Cancel repair' })
        .click();
      await expect(p.getByRole('dialog', { name: 'Cancel this repair?' })).toBeVisible();
    },
  },
  {
    name: 'repairs: Repairs tab of an asset',
    open: async (p) => {
      await p.goto('/repairs');
      await p.getByRole('tab', { name: /Closed/ }).click();
      await p
        .getByRole('row', { name: /Replace screen/ })
        .getByRole('link')
        .first()
        .click();
      await p.getByRole('tab', { name: 'Repairs' }).click();
      await expect(p.getByTestId('repairs-summary')).toBeVisible();
    },
  },
  {
    name: 'repairs: empty Repairs tab of an asset',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}&tab=repairs`);
      await expect(p.getByText('No repairs for this asset yet.')).toBeVisible();
    },
  },
  // ---- labels ----
  {
    name: 'labels: dialog for a selection',
    open: async (p) => {
      await p.goto('/assets');
      await p
        .getByRole('checkbox', { name: /^Select row/ })
        .first()
        .click();
      await p.getByRole('button', { name: /^Print label \(1\)/ }).click();
      await expect(
        p.getByRole('dialog', { name: /^Print label for / }).getByTestId('label-preview'),
      ).toBeVisible();
    },
  },
  {
    name: 'labels: partly used sheet and two sheets',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('checkbox', { name: 'Select all rows' }).click();
      await p.getByRole('button', { name: /^Print labels \(50\)/ }).click();
      const dialog = p.getByRole('dialog', { name: 'Print labels' });
      await dialog.getByRole('radio', { name: /^Position 12,/ }).click();
      await expect(dialog.getByText('Sheet 1 of 3')).toBeVisible();
      await dialog.getByRole('button', { name: 'Next sheet' }).click();
      await expect(dialog.getByText('Sheet 2 of 3')).toBeVisible();
    },
  },
  {
    name: 'labels: one-label page',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}`);
      await p.getByRole('button', { name: 'Print labels' }).click();
      const dialog = p.getByRole('dialog', { name: /^Print label for / });
      await choose(
        p,
        dialog.getByRole('combobox', { name: 'Sheet template' }),
        /Single label 50 x 25/,
      );
      await expect(dialog.getByText(/one label per page/)).toBeVisible();
    },
  },
  {
    name: 'labels: PDF ready',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}`);
      await p.getByRole('button', { name: 'Print labels' }).click();
      const dialog = p.getByRole('dialog', { name: /^Print label for / });
      await dialog.getByRole('button', { name: 'Generate PDF' }).click();
      await expect(dialog.getByTestId('labels-ready')).toBeVisible();
    },
  },
  {
    name: 'labels: no code chosen',
    open: async (p) => {
      await p.goto(`/assets/view?id=${assetId(124)}`);
      await p.getByRole('button', { name: 'Print labels' }).click();
      const dialog = p.getByRole('dialog', { name: /^Print label for / });
      await dialog.getByRole('checkbox', { name: 'QR code' }).click();
      await expect(dialog.getByText(/carry text only/)).toBeVisible();
    },
  },
  {
    name: 'labels: batch queued',
    open: async (p) => {
      // the mock worker takes a minute, so the batch stays queued while axe looks
      await p.addInitScript(() => window.localStorage.setItem('at-mock-label-delay', '60000'));
      await p.goto(`/assets/view?id=${assetId(124)}`);
      await p.getByRole('button', { name: 'Print labels' }).click();
      const dialog = p.getByRole('dialog', { name: /^Print label for / });
      await dialog.getByRole('button', { name: 'Generate PDF' }).click();
      await expect(dialog.getByTestId('labels-queued')).toBeVisible();
    },
  },
  {
    name: 'labels: batch failed',
    open: async (p) => {
      await p.addInitScript(() =>
        window.localStorage.setItem('at-mock-label-failure', 'render-failed'),
      );
      await p.goto(`/assets/view?id=${assetId(124)}`);
      await p.getByRole('button', { name: 'Print labels' }).click();
      const dialog = p.getByRole('dialog', { name: /^Print label for / });
      await dialog.getByRole('button', { name: 'Generate PDF' }).click();
      await expect(dialog.getByTestId('labels-failed')).toBeVisible();
    },
  },
  // ---- notifications ----
  {
    name: 'notifications: panel with unread',
    open: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: 'Notifications, 3 unread' }).click();
      await expect(p.getByTestId('notification-list')).toBeVisible();
    },
  },
  {
    name: 'notifications: panel with nothing unread',
    open: async (p) => {
      await p.goto('/');
      await p.getByRole('button', { name: 'Notifications, 3 unread' }).click();
      const panel = p.getByRole('dialog', { name: 'Notifications' });
      await panel.getByRole('button', { name: 'Mark all as read' }).click();
      await panel.getByRole('button', { name: 'Unread', exact: true }).click();
      await expect(panel.getByText('Nothing unread.')).toBeVisible();
    },
  },
  {
    name: 'notifications: settings',
    open: async (p) => {
      await p.goto('/account/notifications');
      await expect(p.getByRole('table', { name: 'Notification delivery by type' })).toBeVisible();
      await settled(p);
    },
  },
  {
    name: 'notifications: settings with unsaved changes',
    open: async (p) => {
      await p.goto('/account/notifications');
      await choose(p, p.getByRole('combobox', { name: 'E-mail for Low stock' }), 'Off', true);
      await expect(p.getByText('You have unsaved changes.')).toBeVisible();
    },
  },
  {
    name: 'notifications: the rules of the organisation',
    open: async (p) => {
      await p.goto('/settings/notifications');
      await expect(p.getByRole('table', { name: 'Notification rules by type' })).toBeVisible();
      await settled(p);
    },
  },
  // ---- saved views and export ----
  {
    name: 'assets: saved views bar with a shared view',
    open: async (p) => {
      await p.goto('/assets');
      await choose(p, p.getByRole('combobox', { name: 'View' }), 'Teacher devices (shared)', true);
      await expect(p.getByTestId('assets-range')).toHaveText('Showing 1-39 of 39');
      await settled(p);
    },
  },
  {
    name: 'assets: save view dialog',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('button', { name: 'Save view' }).click();
      await expect(p.getByRole('checkbox', { name: /Share with everyone/ })).toBeVisible();
    },
  },
  {
    name: 'assets: delete view confirmation',
    open: async (p) => {
      await p.goto('/assets');
      // only the owner of a view deletes it: save one of the user's own first
      await p.getByRole('button', { name: 'Save view' }).click();
      await p
        .getByRole('dialog', { name: 'Save this view' })
        .getByLabel(/^View name/)
        .fill('Mine');
      await p
        .getByRole('dialog', { name: 'Save this view' })
        .getByRole('button', { name: 'Save view' })
        .click();
      await expect(p.getByRole('combobox', { name: 'View' })).toContainText('Mine');
      await p.getByRole('button', { name: 'Delete view' }).click();
      await expect(p.getByRole('dialog', { name: /^Delete view/ })).toBeVisible();
    },
  },
  {
    name: 'assets: export dialog while it works',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('button', { name: 'Export CSV' }).click();
      await expect(p.getByRole('dialog', { name: 'Export to CSV' })).toBeVisible();
    },
  },
  {
    name: 'assets: export ready',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('button', { name: 'Export CSV' }).click();
      await expect(p.getByRole('link', { name: 'Download CSV' })).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: 'assets: export failed',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByPlaceholder('Tag, serial or name').fill('fail');
      await expect(p.getByRole('heading', { name: 'No assets match' })).toBeVisible();
      await p.getByRole('button', { name: 'Export CSV' }).click();
      await expect(p.getByText('The export failed.')).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: 'people: export dialog',
    open: async (p) => {
      await p.goto('/people');
      await p.getByRole('button', { name: 'Export CSV' }).click();
      await expect(p.getByRole('link', { name: 'Download CSV' })).toBeVisible({ timeout: 15_000 });
    },
  },
  {
    name: 'assets: toolbar with print and export',
    open: async (p) => {
      await p.goto('/assets');
      await expect(p.getByRole('button', { name: 'Print labels for this filter' })).toBeVisible();
      await settled(p);
    },
  },
  // ---- security ----
  {
    name: 'security: Turn off disabled by the policy',
    session: MOCK_ACCOUNTS.mfaEnforced,
    open: async (p) => {
      await p.goto('/account/security');
      await expect(p.getByRole('button', { name: 'Turn off', exact: true })).toBeDisabled();
      await expect(p.getByText(/so you cannot turn it off/)).toBeVisible();
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const scenario of SCENARIOS) {
    test(`axe: ${scenario.name} (${scheme})`, async ({ page: p }) => {
      if (scenario.session) {
        await p.addInitScript(
          ({ key, email }) => {
            window.localStorage.setItem(
              key,
              JSON.stringify({
                session: {
                  id: 'sess-e2e',
                  email,
                  csrf: 'csrf-e2e',
                  mfaVerified: true,
                  limited: false,
                  createdAt: new Date().toISOString(),
                },
              }),
            );
          },
          { key: 'at-mock-state', email: scenario.session },
        );
      }
      await p.emulateMedia({ colorScheme: scheme });
      await scenario.open(p);
      expect(await violations(p)).toEqual([]);
    });
  }
}

/** The new screens at the three reference widths: no page-level horizontal scroll, dialogs fit. */
test.describe('responsive layout of the wave 2 screens (375, 768, 1440)', () => {
  for (const width of [375, 768, 1440]) {
    for (const url of [
      '/stock',
      '/stock?kind=consumable',
      '/repairs',
      '/account/notifications',
      `/assets/view?id=${assetId(124)}&tab=repairs`,
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

    const dialogs: Array<[string, (page: Page) => Promise<void>, RegExp | string]> = [
      [
        'print labels',
        async (p) => {
          await p.goto(`/assets/view?id=${assetId(124)}`);
          await p.getByRole('button', { name: 'Print labels' }).click();
        },
        /^Print label for /,
      ],
      [
        'log repair',
        async (p) => {
          await p.goto('/repairs');
          await p.getByRole('button', { name: 'Log repair' }).click();
        },
        'Log a repair',
      ],
      [
        'check out accessory',
        async (p) => {
          await p.goto('/stock');
          await p.getByRole('button', { name: 'Check out HDMI cable 2 m' }).click();
        },
        'Check out HDMI cable 2 m',
      ],
      [
        'notifications',
        async (p) => {
          await p.goto('/');
          await p.getByRole('button', { name: /^Notifications/ }).click();
        },
        'Notifications',
      ],
    ];
    for (const [name, open, title] of dialogs) {
      test(`the ${name} dialog fits at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 800 });
        await open(page);
        const dialog = page.getByRole('dialog', { name: title });
        await expect(dialog).toBeVisible();
        // (a sub-pixel of slack: the drawer is still sliding in when it is measured)
        expect((await dialog.boundingBox())!.width).toBeLessThanOrEqual(width + 1);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
  }
});
