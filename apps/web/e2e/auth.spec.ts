import type { Page } from '@playwright/test';
import {
  MOCK_ACCOUNTS,
  MOCK_INVITATIONS,
  MOCK_NEW_RECOVERY_CODES,
  MOCK_PASSWORD,
  MOCK_RECOVERY_CODES,
  MOCK_RESET_TOKENS,
  MOCK_TOTP_CODE,
} from '../src/mocks/fixtures';
import { alerts, expect, test } from './fixtures';

/**
 * Authentication flows against the mock API (docs/engineering/openapi.yaml contract plus the
 * proposed endpoints). All of these start signed out.
 */
test.use({ session: 'none' });

const NEW_PASSWORD = 'a brand new passphrase';

async function signIn(page: Page, email: string, password = MOCK_PASSWORD) {
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

async function expectDashboard(page: Page) {
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: 'User menu' }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
}

test.describe('login', () => {
  test('email and password sign in lands on the dashboard with the organisation in the header', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page, MOCK_ACCOUNTS.owner);
    await expectDashboard(page);
    await expect(page.getByTestId('tenant-name').first()).toHaveText('Acme Schools');
  });

  test('login -> MFA challenge (TOTP) -> dashboard -> logout', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, MOCK_ACCOUNTS.mfaOwner);

    await expect(
      page.getByRole('heading', { level: 1, name: 'Two-step verification' }),
    ).toBeVisible();
    await expect(page.getByLabel(/^Authentication code/)).toBeFocused();
    await page.getByLabel(/^Authentication code/).fill('000000');
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(alerts(page)).toContainText('That code is not correct');

    await page.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectDashboard(page);

    await signOut(page);
    await expect(page).toHaveURL(/\/login\/?\?reason=signed_out/);
    await expect(page.getByRole('status')).toContainText('You have been signed out.');

    // the session is gone: an app URL bounces back to login
    await page.goto('/assets');
    await expect(page).toHaveURL(/\/login\/?\?next=/);
  });

  test('a recovery code works instead of the authenticator code', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, MOCK_ACCOUNTS.mfaOwner);
    await page.getByRole('button', { name: 'Use a recovery code' }).click();
    await expect(page.getByLabel(/^Recovery code/)).toBeFocused();
    await page.getByLabel(/^Recovery code/).fill(MOCK_RECOVERY_CODES[0]!);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expectDashboard(page);
  });

  test('wrong credentials give one generic message; a throttled account says how long to wait', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page, 'ghost@example.org', 'wrong');
    await expect(alerts(page)).toHaveText('Email or password is incorrect.');
    await expect(page).toHaveURL(/\/login/);

    await page.getByLabel(/^Email/).fill(MOCK_ACCOUNTS.locked);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(alerts(page)).toContainText('Too many sign-in attempts. Try again in 2 minutes.');
  });

  test('empty submit announces the field errors and focuses the first one', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByText('Enter your email address.')).toBeVisible();
    await expect(page.getByLabel(/^Email/)).toBeFocused();
    await expect(alerts(page).first()).toBeVisible();
  });

  test('an email in several organisations asks which one', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, MOCK_ACCOUNTS.multiTenant);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Choose your organisation' }),
    ).toBeVisible();
    await page.getByRole('radio', { name: 'Globex Clinics' }).check();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectDashboard(page);
  });

  test('the password can be shown and pasted into (no paste blocking)', async ({ page }) => {
    await page.goto('/login');
    const password = page.getByLabel(/^Password/);
    await password.fill('visible text');
    await expect(password).toHaveAttribute('type', 'password');
    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(password).toHaveAttribute('type', 'text');
  });
});

test.describe('route guard', () => {
  test('a protected URL redirects to /login?next= and returns there after sign-in', async ({
    page,
  }) => {
    await page.goto('/assets');
    await expect(page).toHaveURL(/\/login\/?\?next=%2Fassets(%2F)?$/);
    await signIn(page, MOCK_ACCOUNTS.owner);
    await expect(page).toHaveURL(/\/assets\/?$/);
    await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();
  });

  test('a scanned QR link (/s/<code>) survives the login round trip', async ({ page }) => {
    await page.goto('/s/LBL00124');
    await expect(page).toHaveURL(/\/login\/?\?next=/);
    await signIn(page, MOCK_ACCOUNTS.owner);
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
  });

  test('an external next= target is ignored', async ({ page }) => {
    await page.goto('/login?next=https%3A%2F%2Fevil.example%2F');
    await signIn(page, MOCK_ACCOUNTS.owner);
    await expectDashboard(page);
    expect(new URL(page.url()).hostname).toBe('localhost');
  });

  test('a session that ends while the app is open sends the user to login with a notice', async ({
    page,
  }) => {
    await page.goto('/login');
    await signIn(page, MOCK_ACCOUNTS.owner);
    await expectDashboard(page);

    // The server revokes the session (idle timeout, "sign out this device" elsewhere).
    await page.evaluate(() => {
      const key = 'at-mock-state';
      const state = JSON.parse(window.localStorage.getItem(key) ?? '{}');
      delete state.session;
      window.localStorage.setItem(key, JSON.stringify(state));
    });
    await page.getByRole('button', { name: 'User menu' }).click();
    await page.getByRole('menuitem', { name: /Security/ }).click();

    await expect(page).toHaveURL(/\/login\/?\?reason=expired&next=%2Faccount%2Fsecurity/);
    await expect(page.getByRole('status')).toContainText(
      'Your session ended. Sign in again to continue.',
    );
  });

  test('a role without permission sees the 403 screen and no Settings link', async ({ page }) => {
    await page.goto('/login');
    await signIn(page, MOCK_ACCOUNTS.viewer);
    await expectDashboard(page);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }),
    ).toHaveCount(0);

    await page.goto('/settings/users');
    await expect(page.getByTestId('access-denied')).toHaveText(
      'You do not have access to this page',
    );
    await page.getByRole('link', { name: 'Go to the dashboard' }).click();
    await expectDashboard(page);
  });
});

test.describe('invitation', () => {
  test('accept invitation -> set password -> dashboard, then the new password works', async ({
    page,
  }) => {
    await page.goto(`/invitation?token=${MOCK_INVITATIONS.valid}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'Accept your invitation' }),
    ).toBeVisible();
    await expect(page.getByText('Role: Asset Manager')).toBeVisible();
    await expect(page.getByLabel(/^Your name/)).toHaveValue('New User');

    await page.getByLabel(/^Password/).fill('short');
    await page.getByLabel(/^Confirm password/).fill('short');
    await page.getByRole('button', { name: 'Create account' }).click();
    await expect(page.getByText('Use at least 12 characters.', { exact: true })).toBeVisible();

    await page.getByLabel(/^Password/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirm password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();
    await expectDashboard(page);

    await signOut(page);
    await signIn(page, 'new.user@example.org', NEW_PASSWORD);
    await expectDashboard(page);
  });

  test('when the organisation requires MFA, accepting continues to the QR enrolment and recovery codes', async ({
    page,
  }) => {
    await page.goto(`/invitation?token=${MOCK_INVITATIONS.mfaRequired}`);
    await page.getByLabel(/^Password/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirm password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Create account' }).click();

    await expect(page).toHaveURL(/\/mfa\/enroll/);
    await expect(page.getByText('Your organisation requires two-step verification')).toBeVisible();
    await expect(
      page.getByRole('img', { name: 'QR code for your authenticator app' }),
    ).toBeVisible();
    await expect(page.getByTestId('mfa-secret')).toBeVisible();

    await page.getByLabel(/^Authentication code/).fill('111111');
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(alerts(page)).toContainText('That code is not correct');

    await page.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Save your recovery codes' }),
    ).toBeFocused();
    await expect(page.getByTestId('recovery-codes').locator('li')).toHaveCount(10);
    await expect(page.getByTestId('recovery-codes')).toContainText(MOCK_NEW_RECOVERY_CODES[0]!);

    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
    await page.getByRole('checkbox', { name: 'I have saved these codes' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expectDashboard(page);
  });

  test('expired and unknown invitation links say so without detail', async ({ page }) => {
    await page.goto(`/invitation?token=${MOCK_INVITATIONS.expired}`);
    await expect(
      page.getByRole('heading', { level: 1, name: 'This invitation has expired' }),
    ).toBeVisible();
    await page.goto('/invitation?token=whatever');
    await expect(
      page.getByRole('heading', { level: 1, name: 'This invitation is not valid' }),
    ).toBeVisible();
  });
});

test.describe('password reset', () => {
  test('forgot password shows the same confirmation for any address', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
    await page.getByLabel(/^Email/).fill('nobody-at-all@example.org');
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeFocused();
    await expect(
      page.getByText(/If an account exists for nobody-at-all@example.org/),
    ).toBeVisible();
  });

  test('reset password with a valid token, then sign in with the new password', async ({
    page,
  }) => {
    await page.goto(`/reset-password?token=${MOCK_RESET_TOKENS.valid}`);
    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirm new password/).fill('something different');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('The passwords do not match.')).toBeVisible();

    await page.getByLabel(/^Confirm new password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Password changed' })).toBeFocused();
    await page.getByRole('link', { name: 'Go to sign in' }).click();
    await expect(page.getByRole('status')).toContainText('Your password was changed');

    await signIn(page, MOCK_ACCOUNTS.owner, NEW_PASSWORD);
    await expectDashboard(page);

    // the link is single-use
    await page.goto(`/reset-password?token=${MOCK_RESET_TOKENS.valid}`);
    await page.getByLabel(/^New password/).fill('yet another passphrase');
    await page.getByLabel(/^Confirm new password/).fill('yet another passphrase');
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link is not valid' }),
    ).toBeVisible();
  });

  test('an expired reset link offers a new one', async ({ page }) => {
    await page.goto(`/reset-password?token=${MOCK_RESET_TOKENS.expired}`);
    await page.getByLabel(/^New password/).fill(NEW_PASSWORD);
    await page.getByLabel(/^Confirm new password/).fill(NEW_PASSWORD);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeVisible();
    await page.getByRole('link', { name: 'Request a new link' }).click();
    await expect(page).toHaveURL(/\/forgot-password/);
  });
});

test.describe('forced MFA enrolment at login', () => {
  test('a user whose organisation requires MFA is sent to enrolment before anything else', async ({
    page,
  }) => {
    await page.goto('/assets');
    await signIn(page, MOCK_ACCOUNTS.mfaRequired);
    await expect(page).toHaveURL(/\/mfa\/enroll\/?\?next=%2Fassets(%2F)?$/);
    await page.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
    await page.getByRole('button', { name: 'Verify and turn on' }).click();
    await page.getByRole('checkbox', { name: 'I have saved these codes' }).click();
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page).toHaveURL(/\/assets\/?$/);
  });
});

test.describe('security page', () => {
  test.use({ session: MOCK_ACCOUNTS.owner });

  test('lists signed-in devices and revokes another one', async ({ page }) => {
    await page.goto('/account/security');
    const table = page.getByRole('table', { name: 'Signed-in devices' });
    await expect(table.getByRole('row')).toHaveCount(4); // header + 3 devices
    await expect(table.getByText('This device')).toBeVisible();
    await page.getByRole('button', { name: 'Sign out Safari on iPhone' }).click();
    await expect(table.getByRole('row')).toHaveCount(3);
    await expect(page.getByText('Device signed out.', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Set up' })).toBeVisible();
  });
});
