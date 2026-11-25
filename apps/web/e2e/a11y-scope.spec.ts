import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { violations } from './axe';
import { expect, settled, test, type SessionOption } from './fixtures';

/**
 * axe (WCAG 2.2 A/AA incl. contrast) in light and dark for the location scoping of M2-LOC-03: the
 * "Change role and access" dialog with a location scope and its error, the invite dialog, and the
 * app shell of a scoped user with its "Scoped to" indicator.
 */
interface Scenario {
  name: string;
  session?: SessionOption;
  open: (page: Page) => Promise<void>;
}

async function openAccess(p: Page) {
  await p.goto('/settings/users');
  const priya = p.getByRole('row', { name: /Priya Patel/ });
  await priya.getByRole('button', { name: /Actions for Priya Patel/ }).click();
  await p.getByRole('menuitem', { name: 'Change role and access' }).click();
  return p.getByRole('dialog', { name: 'Role and access of Priya Patel' });
}

/** "Add access" opened on the access dialog, limited to a location. */
async function openAdd(p: Page) {
  const dialog = await openAccess(p);
  await dialog.getByRole('button', { name: 'Add access' }).click();
  const add = p.getByRole('dialog', { name: 'Add access for Priya Patel' });
  await add.getByRole('combobox', { name: /^Access/ }).click();
  await p.getByRole('option', { name: 'Limited to a location' }).click();
  return add;
}

const SCENARIOS: Scenario[] = [
  {
    name: 'users: access dialog with one access (Remove disabled, with its reason)',
    open: async (p) => {
      const dialog = await openAccess(p);
      await expect(
        dialog.getByRole('button', { name: 'Remove access: Technician' }),
      ).toBeDisabled();
      await expect(dialog.getByText(/This is the only access of the user/)).toBeVisible();
    },
  },
  {
    name: 'users: add access limited to a location',
    open: async (p) => {
      const add = await openAdd(p);
      await add.getByRole('combobox', { name: /^Location/ }).click();
      await expect(p.getByRole('listbox')).toBeVisible();
    },
  },
  {
    name: 'users: add access with the location missing',
    open: async (p) => {
      const add = await openAdd(p);
      await add.getByRole('button', { name: 'Add access' }).click();
      await expect(add.getByText('This field is required.').first()).toBeVisible();
    },
  },
  {
    name: 'users: remove access confirmation',
    open: async (p) => {
      const add = await openAdd(p);
      await add.getByRole('combobox', { name: /^Role/ }).click();
      await p.getByRole('option', { name: 'Viewer' }).click();
      await add.getByRole('combobox', { name: /^Location/ }).fill('Room 204');
      await p.getByRole('option', { name: /Room 204/ }).click();
      await add.getByRole('button', { name: 'Add access' }).click();
      await expect(add).toBeHidden();
      const dialog = p.getByRole('dialog', { name: 'Role and access of Priya Patel' });
      await dialog.getByRole('button', { name: 'Remove access: Viewer at Room 204' }).click();
      await expect(p.getByRole('dialog', { name: 'Remove this access?' })).toBeVisible();
    },
  },
  {
    name: 'users: invite dialog limited to a location',
    open: async (p) => {
      await p.goto('/settings/users');
      await p.getByRole('button', { name: 'Invite user' }).click();
      const dialog = p.getByRole('dialog', { name: 'Invite a user' });
      await dialog.getByRole('combobox', { name: /^Access/ }).click();
      await p.getByRole('option', { name: 'Limited to a location' }).click();
      await expect(dialog.getByRole('combobox', { name: /^Location/ })).toBeVisible();
    },
  },
  {
    name: 'users: a scoped user in the table',
    open: async (p) => {
      await p.goto('/settings/users');
      await expect(
        p.getByRole('row', { name: /Theo Scoped/ }).getByTestId('role-scope'),
      ).toHaveText('at Room 101');
      await settled(p);
    },
  },
  {
    name: 'shell: "Scoped to" indicator of a scoped technician',
    session: MOCK_ACCOUNTS.scopedTechnician,
    open: async (p) => {
      await p.goto('/assets');
      await expect(p.getByTestId('scope-indicator')).toBeVisible();
      await settled(p);
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const scenario of SCENARIOS) {
    test.describe(() => {
      if (scenario.session) test.use({ session: scenario.session });
      test(`axe: ${scenario.name} (${scheme})`, async ({ page: p }) => {
        await p.emulateMedia({ colorScheme: scheme });
        await scenario.open(p);
        expect(await violations(p)).toEqual([]);
      });
    });
  }
}

/** The indicator never makes the top bar scroll sideways, down to a phone. */
test.describe('"Scoped to" at 375, 768 and 1440 px', () => {
  test.use({ session: MOCK_ACCOUNTS.scopedTechnician });
  for (const width of [375, 768, 1440]) {
    test(`no horizontal page scroll at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/assets');
      await expect(page.getByTestId('scope-indicator')).toBeVisible();
      await settled(page);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }
});
