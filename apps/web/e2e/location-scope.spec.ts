import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, settled, test } from './fixtures';

/**
 * Location scoping of role assignments (M2-LOC-03, ED-26) against the mock API: an administrator
 * limits a user's role to a location on the Users screen; a scoped user sees "Scoped to: ..." in the
 * top bar, only the locations and assets inside the scope, and must give new records a location.
 */

const range = (page: Page) => page.getByTestId('assets-range');
const tree = (page: Page) => page.getByRole('tree', { name: 'Locations' });
const total = async (page: Page) =>
  Number((/of (\d+)$/.exec((await range(page).textContent()) ?? '') ?? [])[1]);

test.describe('an administrator adds and removes role assignments', () => {
  test('adds Viewer limited to Room 204 to Priya from "Add access"; removes it again after a confirmation', async ({
    page,
  }) => {
    await page.goto('/settings/users');
    const priya = page.getByRole('row', { name: /Priya Patel/ });
    await expect(priya).toBeVisible();

    await priya.getByRole('button', { name: /Actions for Priya Patel/ }).click();
    await page.getByRole('menuitem', { name: 'Change role and access' }).click();
    const dialog = page.getByRole('dialog', { name: 'Role and access of Priya Patel' });
    // the one access cannot be removed
    await expect(dialog.getByRole('button', { name: 'Remove access: Technician' })).toBeDisabled();

    await dialog.getByRole('button', { name: 'Add access' }).click();
    const add = page.getByRole('dialog', { name: 'Add access for Priya Patel' });
    await add.getByRole('combobox', { name: /^Role/ }).click();
    await page.getByRole('option', { name: 'Viewer' }).click();
    await add.getByRole('combobox', { name: /^Access/ }).click();
    await page.getByRole('option', { name: 'Limited to a location' }).click();
    // the select hands focus back to its trigger as it closes; typing before that closes the list
    await expect(add.getByRole('combobox', { name: /^Access/ })).toBeFocused();

    // the location is required before anything is sent
    await add.getByRole('button', { name: 'Add access' }).click();
    await expect(add.getByText('This field is required.')).toBeVisible();

    await add.getByRole('combobox', { name: /^Location/ }).fill('Room 204');
    await page.getByRole('option', { name: /Room 204/ }).click();
    await add.getByRole('button', { name: 'Add access' }).click();
    await expect(add).toBeHidden();
    await expect(page.getByText('Access added for Priya Patel.').first()).toBeVisible();
    await expect(dialog.getByText('Viewer at Room 204')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Remove access: Technician' })).toBeEnabled();

    // the confirmation says what happens; cancelling keeps it
    await dialog.getByRole('button', { name: 'Remove access: Viewer at Room 204' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove this access?' });
    await expect(confirm).toContainText('Priya Patel will no longer have Viewer at Room 204');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(confirm).toBeHidden();
    await expect(dialog.getByText('Viewer at Room 204')).toBeVisible();

    await dialog.getByRole('button', { name: 'Remove access: Viewer at Room 204' }).click();
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(confirm).toBeHidden();
    await expect(page.getByText('Access removed from Priya Patel.').first()).toBeVisible();
    await expect(dialog.getByText('Viewer at Room 204')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Remove access: Technician' })).toBeDisabled();
  });

  test('a user limited to a location shows where in the table; the Roles tab says where scoping lives', async ({
    page,
  }) => {
    await page.goto('/settings/users');
    await expect(
      page.getByRole('row', { name: /Theo Scoped/ }).getByTestId('role-scope'),
    ).toHaveText('at Room 101');
    await page.getByRole('tab', { name: 'Roles' }).click();
    await expect(page.getByText(/Each role can be limited to a location/)).toBeVisible();
  });

  test('a refusal is shown in the dialog that asked: you cannot remove your own last administrator access', async ({
    page,
  }) => {
    await page.goto('/settings/users');
    const alice = page.getByRole('row', { name: /Alice Owner/ });
    await alice.getByRole('button', { name: /Actions for Alice Owner/ }).click();
    await page.getByRole('menuitem', { name: 'Change role and access' }).click();
    const dialog = page.getByRole('dialog', { name: 'Role and access of Alice Owner' });
    await dialog.getByRole('button', { name: 'Add access' }).click();
    const add = page.getByRole('dialog', { name: 'Add access for Alice Owner' });
    await add.getByRole('combobox', { name: /^Role/ }).click();
    await page.getByRole('option', { name: 'Viewer' }).click();
    await add.getByRole('button', { name: 'Add access' }).click();
    await expect(add).toBeHidden();

    await dialog.getByRole('button', { name: 'Remove access: Administrator' }).click();
    const confirm = page.getByRole('dialog', { name: 'Remove this access?' });
    await confirm.getByRole('button', { name: 'Remove' }).click();
    await expect(confirm).toContainText('You cannot remove your own last administrator access');
    await confirm.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      dialog.getByRole('button', { name: 'Remove access: Administrator' }),
    ).toBeVisible();
  });

  test('an org-wide user sees no "Scoped to"', async ({ page }) => {
    await page.goto('/assets');
    await expect(range(page)).toHaveText('Showing 1-50 of 195');
    await expect(page.getByTestId('scope-indicator')).toHaveCount(0);
  });
});

test.describe('a technician limited to Room 101', () => {
  test.use({ session: MOCK_ACCOUNTS.scopedTechnician });

  test('sees "Scoped to" and only the assets and locations inside Room 101', async ({ page }) => {
    await page.goto('/assets');
    await expect(page.getByRole('banner').getByTestId('scope-indicator')).toHaveText(
      'Scoped to: Riverside Elementary / Main building / Room 101',
    );
    await expect(range(page)).toHaveText(/^Showing 1-\d+ of \d+$/);
    const count = await total(page);
    expect(count).toBeGreaterThan(0);
    expect(count).toBeLessThan(195);
    await settled(page);
    const rows = page.getByRole('row');
    const visible = Math.min(count, 5);
    for (let i = 1; i <= visible; i += 1) await expect(rows.nth(i)).toContainText('Room 101');

    await page.goto('/locations');
    await expect(tree(page).getByRole('treeitem', { name: /^Room 101/ })).toBeVisible();
    await expect(tree(page).getByRole('treeitem')).toHaveCount(1);
    await expect(tree(page).getByRole('treeitem', { name: /^Riverside Elementary/ })).toHaveCount(
      0,
    );

    // no Settings (a technician has no settings permission)
    const nav = page.getByRole('navigation', { name: 'Primary' }).first();
    await expect(nav.getByRole('link', { name: 'Assets' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);
  });
});

test.describe('an Administrator limited to Main building (location administrator)', () => {
  test.use({ session: MOCK_ACCOUNTS.scopedAdmin });

  test('has no Settings, and new locations and people need a location inside the scope', async ({
    page,
  }) => {
    await page.goto('/locations');
    await expect(page.getByTestId('scope-indicator')).toHaveText(
      'Scoped to: Riverside Elementary / Main building',
    );
    // the org-only permissions are absent: no Settings in the navigation
    const nav = page.getByRole('navigation', { name: 'Primary' }).first();
    await expect(nav.getByRole('link', { name: 'Locations' })).toBeVisible();
    await expect(nav.getByRole('link', { name: 'Settings' })).toHaveCount(0);

    await expect(tree(page).getByRole('treeitem', { name: /^Main building/ })).toBeVisible();
    await page.getByRole('button', { name: 'Add location' }).first().click();
    const add = page.getByRole('dialog', { name: 'Add a location' });
    // the only scope root is the parent; there is no "top level" to fall back to
    const parent = add.getByRole('combobox', { name: /Inside/ });
    await expect(parent).toHaveValue('Main building');
    await expect(add.getByRole('button', { name: 'Clear location' })).toHaveCount(0);
    await add.getByLabel(/^Name/).fill('Science lab');
    await add.getByRole('button', { name: 'Add location' }).click();
    await expect(add).toBeHidden();
    await page.getByRole('treeitem', { name: /^Main building/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(tree(page).getByRole('treeitem', { name: /^Science lab/ })).toBeVisible();

    await page.goto('/people');
    await page.getByRole('button', { name: 'Add person' }).click();
    const person = page.getByRole('dialog', { name: 'Add a person' });
    await person.getByLabel(/^Name/).fill('Lab Assistant');
    await person.getByRole('button', { name: 'Add person' }).click();
    const home = person.getByRole('combobox', { name: /^Home location/ });
    await expect(home).toHaveAttribute('aria-invalid', 'true');
    await home.fill('Gym');
    await page.getByRole('option', { name: /Gym/ }).click();
    await person.getByRole('button', { name: 'Add person' }).click();
    await expect(person).toBeHidden();
  });
});
