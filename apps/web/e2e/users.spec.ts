import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';

/** Users, roles and invitations (M1-WEB-09). */

async function choose(page: Page, label: RegExp | string, option: RegExp | string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test.describe('login accounts and their people (M2-USR-03)', () => {
  test('shows the person of each login, links one to a person without a login and unlinks it', async ({
    page,
  }) => {
    await page.goto('/settings/users');
    const marco = page.getByRole('row', { name: /Marco Secure/ });
    await expect(marco).toContainText('None');
    await expect(
      page.getByRole('row', { name: /Alice Owner/ }).getByRole('link', { name: 'Alice Owner' }),
    ).toBeVisible();

    await marco.getByRole('button', { name: /Actions for Marco Secure/ }).click();
    await page.getByRole('menuitem', { name: 'Link to a person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Link Marco Secure to a person' });
    await dialog.getByRole('combobox', { name: /Person/ }).fill('Jamie');
    await page
      .getByRole('option', { name: /Jamie Okafor/ })
      .first()
      .click();
    await expect(dialog.getByText(/Jamie Okafor will sign in as mfa@example\.org/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Link login' }).click();
    await expect(marco.getByRole('link', { name: 'Jamie Okafor' })).toBeVisible();

    await marco.getByRole('button', { name: /Actions for Marco Secure/ }).click();
    await page.getByRole('menuitem', { name: 'Unlink person' }).click();
    const confirm = page.getByRole('dialog', { name: 'Unlink Jamie Okafor from their login?' });
    await confirm.getByRole('button', { name: 'Unlink' }).click();
    await expect(marco.getByRole('link', { name: 'Jamie Okafor' })).toHaveCount(0);
  });
});

test.describe('users and invitations', () => {
  test('invites a user, who then waits under Pending invitations', async ({ page }) => {
    await page.goto('/settings/users');
    await expect(page.getByRole('row', { name: /Alice Owner/ })).toBeVisible();
    await page.getByRole('button', { name: 'Invite user' }).click();
    const dialog = page.getByRole('dialog', { name: 'Invite a user' });

    // client-side required checks and server-side duplicate detection, on the field
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByText('This field is required.').first()).toBeVisible();
    await dialog.getByLabel(/^Name/).fill('Dana Reyes');
    await dialog.getByLabel(/^Email/).fill('alice@example.org');
    await choose(page, /^Role/, 'Technician');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog.getByText('already in use')).toBeVisible();

    await dialog.getByLabel(/^Email/).fill('dana.reyes@example.org');
    await dialog.getByRole('button', { name: 'Send invitation' }).click();
    await expect(
      page.getByText('Invitation sent to dana.reyes@example.org.').first(),
    ).toBeVisible();

    await page.getByRole('tab', { name: /Pending invitations/ }).click();
    const row = page.getByRole('row', { name: /dana\.reyes@example\.org/ });
    await expect(row).toContainText('Technician');
    await expect(row).toContainText('Dana Reyes');
  });

  test('resends and revokes a pending invitation', async ({ page }) => {
    await page.goto('/settings/users');
    await page.getByRole('tab', { name: /Pending invitations/ }).click();
    await expect(page.getByRole('row', { name: /jordan\.invited@example\.org/ })).toBeVisible();

    await page
      .getByRole('button', { name: 'Resend invitation to jordan.invited@example.org' })
      .click();
    await expect(
      page.getByText('Invitation resent to jordan.invited@example.org.').first(),
    ).toBeVisible();

    await page
      .getByRole('button', { name: 'Revoke invitation for jordan.invited@example.org' })
      .click();
    const confirm = page.getByRole('dialog', { name: /Revoke the invitation for jordan/ });
    await confirm.getByRole('button', { name: 'Revoke' }).click();
    await expect(page.getByRole('row', { name: /jordan\.invited@example\.org/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /sasha\.waiting@example\.org/ })).toBeVisible();
  });

  test('a pending login is on the Users tab too: access, link to a person, resend, revoke', async ({
    page,
  }) => {
    await page.goto('/settings/users');
    const row = page.getByRole('row', { name: /Jordan Invited/ });
    await expect(row.getByText('Pending')).toBeVisible();
    await expect(page.getByRole('row', { name: /Alice Owner/ }).getByText('Pending')).toHaveCount(
      0,
    );

    // access: add a role to the pending login
    await row.getByRole('button', { name: /Actions for Jordan Invited/ }).click();
    await page.getByRole('menuitem', { name: 'Change role and access' }).click();
    const access = page.getByRole('dialog', { name: 'Role and access of Jordan Invited' });
    await access.getByRole('button', { name: 'Add access' }).click();
    const add = page.getByRole('dialog', { name: 'Add access for Jordan Invited' });
    await choose(page, /^Role/, 'Viewer');
    await add.getByRole('button', { name: 'Add access' }).click();
    await expect(access.getByRole('button', { name: 'Remove access: Viewer' })).toBeVisible();
    await access.getByRole('button', { name: 'Close' }).first().click();
    await expect(access).toBeHidden();

    // link to a person
    await row.getByRole('button', { name: /Actions for Jordan Invited/ }).click();
    await page.getByRole('menuitem', { name: 'Link to a person' }).click();
    const link = page.getByRole('dialog', { name: 'Link Jordan Invited to a person' });
    await link.getByRole('combobox', { name: /Person/ }).fill('Jamie');
    await page
      .getByRole('option', { name: /Jamie Okafor/ })
      .first()
      .click();
    await link.getByRole('button', { name: 'Link login' }).click();
    await expect(row.getByRole('link', { name: 'Jamie Okafor' })).toBeVisible();

    // resend, then revoke (the row leaves both tabs); the actions that need a sign-in are not offered
    await row.getByRole('button', { name: /Actions for Jordan Invited/ }).click();
    await expect(page.getByRole('menuitem', { name: 'Deactivate' })).toHaveCount(0);
    await expect(page.getByRole('menuitem', { name: 'Signed-in devices' })).toHaveCount(0);
    await page.getByRole('menuitem', { name: 'Resend invitation' }).click();
    await expect(
      page.getByText('Invitation resent to jordan.invited@example.org.').first(),
    ).toBeVisible();
    await row.getByRole('button', { name: /Actions for Jordan Invited/ }).click();
    await page.getByRole('menuitem', { name: 'Revoke invitation' }).click();
    await page
      .getByRole('dialog', { name: /Revoke the invitation for jordan/ })
      .getByRole('button', { name: 'Revoke' })
      .click();
    await expect(page.getByRole('row', { name: /Jordan Invited/ })).toHaveCount(0);
  });

  test('changes a role, deactivates and reactivates a user', async ({ page }) => {
    await page.goto('/settings/users');
    await choose(page, 'Role of Vera Viewer', 'Auditor');
    await expect(page.getByText('Role of Vera Viewer changed.').first()).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Role of Vera Viewer' })).toContainText(
      'Auditor',
    );

    await page.getByRole('button', { name: 'Actions for Priya Patel' }).click();
    await page.getByRole('menuitem', { name: 'Deactivate' }).click();
    await expect(page.getByText('Priya Patel was deactivated.').first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Priya Patel/ })).toContainText('Deactivated');
    await page.getByRole('button', { name: 'Actions for Priya Patel' }).click();
    await page.getByRole('menuitem', { name: 'Reactivate' }).click();
    await expect(page.getByRole('row', { name: /Priya Patel/ })).toContainText('Active');
  });

  test('admin MFA reset asks for confirmation and clears the second factor', async ({ page }) => {
    await page.goto('/settings/users');
    const row = page.getByRole('row', { name: /Priya Patel/ });
    await expect(row).toContainText('On');
    await page.getByRole('button', { name: 'Actions for Priya Patel' }).click();
    await page.getByRole('menuitem', { name: 'Reset two-step verification' }).click();
    const confirm = page.getByRole('dialog', { name: /Reset two-step verification for Priya/ });
    await expect(confirm).toContainText('signs them out everywhere');
    await confirm.getByRole('button', { name: 'Reset two-step verification' }).click();
    await expect(
      page.getByText('Two-step verification reset for Priya Patel.').first(),
    ).toBeVisible();
    await expect(row).toContainText('Off');
    // no reset action for yourself
    await page.getByRole('button', { name: 'Actions for Alice Owner' }).click();
    await expect(page.getByRole('menuitem', { name: 'Reset two-step verification' })).toHaveCount(
      0,
    );
  });

  test('lists and revokes the sessions of a user', async ({ page }) => {
    await page.goto('/settings/users');
    await page.getByRole('button', { name: 'Actions for Marco Secure' }).click();
    await page.getByRole('menuitem', { name: 'Signed-in devices' }).click();
    const dialog = page.getByRole('dialog', { name: /Signed-in devices of Marco Secure/ });
    await expect(dialog.getByText('Safari on iPhone')).toBeVisible();
    await dialog.getByRole('button', { name: 'Sign out Safari on iPhone' }).click();
    await expect(dialog.getByText('Safari on iPhone')).toHaveCount(0);
    await expect(dialog.getByText('Firefox on Linux')).toBeVisible();
  });

  test('the Roles tab lists the built-in roles read-only', async ({ page }) => {
    await page.goto('/settings/users');
    await page.getByRole('tab', { name: 'Roles' }).click();
    const table = page.getByRole('region', { name: 'Roles' });
    for (const name of ['Administrator', 'Asset Manager', 'Technician', 'Auditor', 'Viewer']) {
      await expect(table.getByRole('cell', { name, exact: true })).toBeVisible();
    }
  });

  test.describe('without user:manage', () => {
    test.use({ session: MOCK_ACCOUNTS.manager });
    test('a manager can read users but every control is gone', async ({ page }) => {
      await page.goto('/settings/users');
      await expect(page.getByRole('row', { name: /Alice Owner/ })).toBeVisible();
      await expect(page.getByText('You can see users but not change them.')).toBeVisible();
      await expect(page.getByRole('button', { name: 'Invite user' })).toHaveCount(0);
      await expect(page.getByRole('combobox', { name: 'Role of Vera Viewer' })).toBeDisabled();
      await expect(page.getByRole('button', { name: /Actions for/ })).toHaveCount(0);
    });
  });
});
