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

test.describe('an administrator scopes a role assignment', () => {
  test('limits Priya to Room 204 from "Change role and access"; the table shows it after a reload', async ({
    page,
  }) => {
    await page.goto('/settings/users');
    const priya = page.getByRole('row', { name: /Priya Patel/ });
    await expect(priya).toBeVisible();
    await expect(priya.getByTestId('role-scope')).toHaveCount(0);

    await priya.getByRole('button', { name: /Actions for Priya Patel/ }).click();
    await page.getByRole('menuitem', { name: 'Change role and access' }).click();
    const dialog = page.getByRole('dialog', { name: 'Role and access of Priya Patel' });
    await dialog.getByRole('combobox', { name: /^Access/ }).click();
    await page.getByRole('option', { name: 'Limited to a location' }).click();

    // the location is required before anything is sent
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog.getByText('This field is required.')).toBeVisible();

    const location = dialog.getByRole('combobox', { name: /^Location/ });
    await location.fill('Room 204');
    await page.getByRole('option', { name: /Room 204/ }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Role and access of Priya Patel saved.').first()).toBeVisible();
    await expect(priya.getByTestId('role-scope')).toHaveText('at Room 204');

    await page.reload();
    await expect(
      page.getByRole('row', { name: /Priya Patel/ }).getByTestId('role-scope'),
    ).toHaveText('at Room 204');
    // the Roles tab says where scoping lives
    await page.getByRole('tab', { name: 'Roles' }).click();
    await expect(page.getByText(/Each role can be limited to a location/)).toBeVisible();
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
