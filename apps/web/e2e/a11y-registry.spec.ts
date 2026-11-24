import type { Page } from '@playwright/test';
import { violations } from './axe';
import { assetId, expect, settled, test } from './fixtures';

/**
 * axe (WCAG 2.2 A/AA incl. contrast) in light and dark for every registry screen added in M1
 * wave 3, including the open dialogs and the error states of the asset form.
 */
interface Scenario {
  name: string;
  open: (page: Page) => Promise<void>;
}

async function choose(page: Page, label: RegExp | string, option: RegExp | string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

const page = (name: string, url: string, ready: (p: Page) => Promise<void>): Scenario => ({
  name,
  open: async (p) => {
    await p.goto(url);
    await ready(p);
    await settled(p);
  },
});

const heading =
  (text: string, level = 2) =>
  async (p: Page) => {
    await expect(p.getByRole('heading', { name: text, level, exact: true })).toBeVisible();
  };

const SCENARIOS: Scenario[] = [
  page('assets: list with data', '/assets', async (p) => {
    await expect(p.getByTestId('assets-range')).toContainText('of 195');
  }),
  page('assets: new asset form', '/assets/new', heading('New asset', 1)),
  {
    name: 'assets: new asset form with custom fields and errors',
    open: async (p) => {
      await p.goto('/assets/new');
      await choose(p, /^Category/, 'Chromebook');
      await p.getByLabel(/^Cost/).fill('abc');
      await p.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(
        p
          .getByRole('alert')
          .filter({ hasText: /attention/ })
          .first(),
      ).toBeVisible();
      await settled(p);
    },
  },
  page('assets: edit form', `/assets/edit?id=${assetId(124)}`, async (p) => {
    await expect(p.getByRole('textbox', { name: /^Tag/ })).toHaveValue('AT-00124');
  }),
  {
    name: 'assets: edit form with the stale-version banner',
    open: async (p) => {
      await p.goto(`/assets/edit?id=${assetId(40)}`);
      await expect(p.getByRole('textbox', { name: /^Tag/ })).toHaveValue('AT-00040');
      await p.evaluate(
        async (url) => {
          const read = await fetch(url);
          await fetch(url, {
            method: 'PATCH',
            headers: {
              'content-type': 'application/json',
              'x-csrf-token': 'csrf-e2e',
              'if-match': read.headers.get('etag') ?? '',
            },
            body: JSON.stringify({ notes: 'other' }),
          });
        },
        `/v1/assets/${assetId(40)}`,
      );
      await p.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(p.getByRole('status').filter({ hasText: 'This asset changed' })).toBeVisible();
    },
  },
  page('assets: detail overview', `/assets/view?id=${assetId(124)}`, async (p) => {
    await expect(p.getByTestId('asset-tag')).toBeVisible();
  }),
  page('assets: detail for an unknown asset', `/assets/view?id=${assetId(9999)}`, async (p) => {
    await expect(p.getByTestId('asset-not-found')).toBeVisible();
  }),
  {
    name: 'assets: columns dialog',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('button', { name: 'Columns' }).click();
      await expect(p.getByRole('dialog', { name: 'Columns' })).toBeVisible();
    },
  },
  {
    name: 'assets: save view dialog',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('button', { name: 'Save view' }).click();
      await expect(p.getByRole('dialog', { name: 'Save this view' })).toBeVisible();
    },
  },
  {
    name: 'assets: bulk bar, edit dialog and archive confirmation',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByRole('checkbox', { name: 'Select row PRJ-00010' }).click();
      await p.getByRole('button', { name: 'Edit', exact: true }).click();
      await expect(p.getByRole('dialog', { name: 'Edit 1 asset' })).toBeVisible();
    },
  },
  {
    name: 'assets: empty search result',
    open: async (p) => {
      await p.goto('/assets');
      await p.getByPlaceholder('Tag, serial or name').fill('zzzz');
      await expect(p.getByRole('heading', { name: 'No assets match' })).toBeVisible();
    },
  },
  page('settings: categories', '/settings/categories', async (p) => {
    await expect(p.getByRole('row', { name: /Chromebook/ })).toBeVisible();
  }),
  {
    name: 'settings: category archive confirmation',
    open: async (p) => {
      await p.goto('/settings/categories');
      await p.getByRole('button', { name: 'Archive Laptop' }).click();
      await expect(
        p.getByRole('dialog', { name: 'Archive Laptop?' }).getByRole('status'),
      ).toContainText('assets');
    },
  },
  page('settings: custom fields', '/settings/fields', async (p) => {
    await expect(p.getByRole('row', { name: /OS version/ })).toBeVisible();
  }),
  {
    name: 'settings: field builder with a select field and preview',
    open: async (p) => {
      await p.goto('/settings/fields');
      await p.getByRole('button', { name: 'New field' }).click();
      const builder = p.getByRole('dialog', { name: 'New field' });
      await builder.getByLabel(/^Label/).fill('Resolution');
      await choose(p, /^Type/, /^Select$/);
      await builder.getByRole('button', { name: 'Add option' }).click();
      await builder.getByLabel('Option 1', { exact: true }).fill('1080p');
      await expect(builder.getByRole('region', { name: 'Preview' })).toContainText('Resolution');
    },
  },
  page('settings: models', '/settings/models', async (p) => {
    await expect(p.getByRole('row', { name: /ThinkPad T14/ })).toBeVisible();
  }),
  page('settings: manufacturers', '/settings/manufacturers', async (p) => {
    await expect(p.getByRole('row', { name: /Dell/ })).toBeVisible();
  }),
  page('settings: status labels', '/settings/status', async (p) => {
    await expect(p.getByRole('row', { name: /Out for fix/ })).toBeVisible();
  }),
  page('settings: tag numbering', '/settings/tags', async (p) => {
    await expect(p.getByRole('row', { name: /Laptop/ })).toBeVisible();
  }),
  page('settings: vendors', '/settings/vendors', async (p) => {
    await expect(p.getByRole('row', { name: /CDW/ })).toBeVisible();
  }),
  page('settings: departments', '/settings/departments', async (p) => {
    await expect(p.getByRole('row', { name: /Mathematics/ })).toBeVisible();
  }),
  {
    name: 'settings: department edit dialog with the manager picker',
    open: async (p) => {
      await p.goto('/settings/departments');
      await p.getByRole('button', { name: 'Edit Mathematics' }).click();
      await expect(p.getByRole('dialog', { name: 'Edit Mathematics' })).toBeVisible();
    },
  },
  {
    name: 'settings: department archive turns into a merge when it is in use',
    open: async (p) => {
      await p.goto('/settings/departments');
      await p.getByRole('button', { name: 'Archive Science' }).click();
      await p
        .getByRole('dialog', { name: 'Archive Science?' })
        .getByRole('button', { name: 'Archive' })
        .click();
      // the dialog turns into "... is still in use": its name changes with it
      await expect(
        p.getByRole('dialog', { name: 'Science is still in use' }).getByText(/Still in use by/),
      ).toBeVisible();
    },
  },
  page('settings: users', '/settings/users', async (p) => {
    await expect(p.getByRole('row', { name: /Alice Owner/ })).toBeVisible();
  }),
  {
    name: 'settings: pending invitations',
    open: async (p) => {
      await p.goto('/settings/users');
      await p.getByRole('tab', { name: /Pending invitations/ }).click();
      await expect(p.getByRole('row', { name: /jordan\.invited/ })).toBeVisible();
    },
  },
  {
    name: 'settings: roles',
    open: async (p) => {
      await p.goto('/settings/users');
      await p.getByRole('tab', { name: 'Roles' }).click();
      await expect(p.getByRole('cell', { name: 'Auditor', exact: true })).toBeVisible();
    },
  },
  {
    name: 'settings: invite dialog',
    open: async (p) => {
      await p.goto('/settings/users');
      await p.getByRole('button', { name: 'Invite user' }).click();
      await expect(p.getByRole('dialog', { name: 'Invite a user' })).toBeVisible();
    },
  },
  {
    name: 'settings: user sessions dialog',
    open: async (p) => {
      await p.goto('/settings/users');
      await p.getByRole('button', { name: 'Actions for Marco Secure' }).click();
      await p.getByRole('menuitem', { name: 'Signed-in devices' }).click();
      await expect(p.getByRole('dialog').getByText('Safari on iPhone')).toBeVisible();
    },
  },
  {
    name: 'palette: live search results',
    open: async (p) => {
      await p.goto('/');
      await expect(p.locator('main#main')).toBeVisible();
      await p.keyboard.press('Control+k');
      await p.getByRole('combobox').fill('LAP-00007');
      await expect(p.getByRole('option', { name: /LAP-00007 / })).toBeVisible();
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
