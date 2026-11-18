import type { Page } from '@playwright/test';
import {
  MOCK_ACCOUNTS,
  MOCK_INVITATIONS,
  MOCK_PASSWORD,
  MOCK_RESET_TOKENS,
  MOCK_TOTP_CODE,
} from '../src/mocks/fixtures';
import { violations } from './axe';
import { alerts, expect, gotoApp, test, type SessionOption } from './fixtures';

/**
 * axe (WCAG 2.2 AA, with colour contrast) for every auth screen and state in light and dark.
 * Each case drives the UI to the state, then scans the whole document.
 */
interface Scenario {
  name: string;
  session?: SessionOption;
  open: (page: Page) => Promise<void>;
}

async function signInUntil(page: Page, email: string) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

const SCENARIOS: Scenario[] = [
  {
    name: 'login: credentials',
    open: async (page) => {
      await page.goto('/login');
      await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    },
  },
  {
    name: 'login: field errors',
    open: async (page) => {
      await page.goto('/login');
      await page.getByRole('button', { name: 'Sign in' }).click();
      await expect(page.getByText('Enter your email address.')).toBeVisible();
    },
  },
  {
    name: 'login: wrong password alert',
    open: async (page) => {
      await signInUntil(page, 'ghost@example.org');
      await expect(alerts(page)).toBeVisible();
    },
  },
  {
    name: 'login: session expired notice',
    open: async (page) => {
      await page.goto('/login?reason=expired');
      await expect(page.getByRole('status')).toContainText('Your session ended');
    },
  },
  {
    name: 'login: MFA challenge',
    open: async (page) => {
      await signInUntil(page, MOCK_ACCOUNTS.mfaOwner);
      await expect(page.getByLabel(/^Authentication code/)).toBeVisible();
    },
  },
  {
    name: 'login: MFA recovery code',
    open: async (page) => {
      await signInUntil(page, MOCK_ACCOUNTS.mfaOwner);
      await page.getByRole('button', { name: 'Use a recovery code' }).click();
      await expect(page.getByLabel(/^Recovery code/)).toBeVisible();
    },
  },
  {
    name: 'login: organisation choice',
    open: async (page) => {
      await signInUntil(page, MOCK_ACCOUNTS.multiTenant);
      await expect(page.getByRole('radio', { name: 'Acme Schools' })).toBeVisible();
    },
  },
  {
    name: 'forgot password',
    open: async (page) => {
      await page.goto('/forgot-password');
      await expect(
        page.getByRole('heading', { level: 1, name: 'Reset your password' }),
      ).toBeVisible();
    },
  },
  {
    name: 'forgot password: sent',
    open: async (page) => {
      await page.goto('/forgot-password');
      await page.getByLabel(/^Email/).fill('someone@example.org');
      await page.getByRole('button', { name: 'Send reset link' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Check your email' })).toBeVisible();
    },
  },
  {
    name: 'reset password',
    open: async (page) => {
      await page.goto(`/reset-password?token=${MOCK_RESET_TOKENS.valid}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'Choose a new password' }),
      ).toBeVisible();
    },
  },
  {
    name: 'reset password: field error',
    open: async (page) => {
      await page.goto(`/reset-password?token=${MOCK_RESET_TOKENS.valid}`);
      await page.getByLabel(/^New password/).fill('short');
      await page.getByRole('button', { name: 'Set new password' }).click();
      await expect(page.getByText('Use at least 12 characters.', { exact: true })).toBeVisible();
    },
  },
  {
    name: 'reset password: invalid link',
    open: async (page) => {
      await page.goto('/reset-password');
      await expect(
        page.getByRole('heading', { level: 1, name: 'This link is not valid' }),
      ).toBeVisible();
    },
  },
  {
    name: 'invitation: set password',
    open: async (page) => {
      await page.goto(`/invitation?token=${MOCK_INVITATIONS.valid}`);
      await expect(page.getByLabel(/^Your name/)).toBeVisible();
    },
  },
  {
    name: 'invitation: expired',
    open: async (page) => {
      await page.goto(`/invitation?token=${MOCK_INVITATIONS.expired}`);
      await expect(
        page.getByRole('heading', { level: 1, name: 'This invitation has expired' }),
      ).toBeVisible();
    },
  },
  {
    name: 'MFA enrolment: QR code',
    session: MOCK_ACCOUNTS.owner,
    open: async (page) => {
      await page.goto('/mfa/enroll');
      await expect(
        page.getByRole('img', { name: 'QR code for your authenticator app' }),
      ).toBeVisible();
    },
  },
  {
    name: 'MFA enrolment: recovery codes',
    session: MOCK_ACCOUNTS.owner,
    open: async (page) => {
      await page.goto('/mfa/enroll');
      await page.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
      await page.getByRole('button', { name: 'Verify and turn on' }).click();
      await expect(page.getByTestId('recovery-codes')).toBeVisible();
    },
  },
  {
    name: 'security: devices',
    session: MOCK_ACCOUNTS.owner,
    open: async (page) => {
      await page.goto('/account/security');
      await expect(page.getByRole('table', { name: 'Signed-in devices' })).toBeVisible();
    },
  },
  {
    name: 'permission denied (403)',
    session: MOCK_ACCOUNTS.viewer,
    open: async (page) => {
      await page.goto('/settings/users');
      await expect(page.getByTestId('access-denied')).toBeVisible();
    },
  },
  {
    name: 'shell: user menu open',
    session: MOCK_ACCOUNTS.owner,
    open: async (page) => {
      await gotoApp(page, '/');
      await page.getByRole('button', { name: 'User menu' }).click();
      await expect(page.getByRole('menu')).toBeVisible();
    },
  },
  {
    name: 'shell: shortcuts dialog',
    session: MOCK_ACCOUNTS.owner,
    open: async (page) => {
      await gotoApp(page, '/');
      await page.keyboard.press('?');
      await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    },
  },
  {
    name: 'shell: palette with a typed tag and recents',
    session: MOCK_ACCOUNTS.owner,
    open: async (page) => {
      await gotoApp(page, '/');
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('AT-00124');
      await expect(page.getByRole('option', { name: 'Open asset AT-00124' })).toBeVisible();
    },
  },
];

for (const scheme of ['light', 'dark'] as const) {
  for (const scenario of SCENARIOS) {
    test.describe(scenario.name, () => {
      test.use({ session: scenario.session ?? 'none' });
      test(`axe: ${scenario.name} (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await scenario.open(page);
        await page.waitForLoadState('networkidle');
        expect(await violations(page)).toEqual([]);
      });
    });
  }
}
