import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS, MOCK_PASSWORD, MOCK_TOTP_CODE } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';

/**
 * Limited session: the tenant requires MFA and the user has not enrolled. The real API answers
 * 200 to `GET /v1/auth/me` with `mfa_enrolment_required: true` (and 403 `mfa-enrolment-required`
 * everywhere else), and the mock does the same. A reload while limited must land on enrolment
 * again, with a working CSRF token, instead of showing the app.
 */
test.use({ session: 'none' });

async function signInLimited(page: Page) {
  await page.goto('/assets');
  await page.getByLabel(/^Email/).fill(MOCK_ACCOUNTS.mfaRequired);
  await page.getByLabel(/^Password/).fill(MOCK_PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/mfa\/enroll\/?\?next=%2Fassets/);
}

test('GET /v1/auth/me answers 200 with mfa_enrolment_required while the session is limited', async ({
  page,
}) => {
  await signInLimited(page);
  const answers = await page.evaluate(async () => {
    const me = await fetch('/v1/auth/me');
    const assets = await fetch('/v1/assets');
    return {
      me: me.status,
      flag: ((await me.json()) as { mfa_enrolment_required: boolean }).mfa_enrolment_required,
      assets: assets.status,
      assetsCode: ((await assets.json()) as { code: string }).code,
    };
  });
  expect(answers).toEqual({
    me: 200,
    flag: true,
    assets: 403,
    assetsCode: 'mfa-enrolment-required',
  });
});

test('reloading while limited stays on enrolment and can still finish it', async ({ page }) => {
  await signInLimited(page);
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();

  await page.reload();
  await expect(page).toHaveURL(/\/mfa\/enroll\/?\?next=%2Fassets/);
  // the CSRF token came from /me, so starting enrolment again after the reload works
  await expect(page.getByRole('img', { name: 'QR code for your authenticator app' })).toBeVisible();
  await page.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
  await page.getByRole('button', { name: 'Verify and turn on' }).click();
  await page.getByRole('checkbox', { name: 'I have saved these codes' }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page).toHaveURL(/\/assets\/?$/);
  await expect(page.getByTestId('assets-range')).toContainText('of 195');
});

test('a limited session cannot reach the app by typing a URL', async ({ page }) => {
  await signInLimited(page);
  await page.goto('/settings/users');
  await expect(page).toHaveURL(/\/mfa\/enroll\/?\?next=%2Fsettings%2Fusers/);
});

test('an unlimited session whose requests start to answer 403 mfa-enrolment-required is sent to enrolment', async ({
  page,
}) => {
  // The tenant turned MFA on while the app was open: the next API call says so.
  await page.addInitScript((email) => {
    window.localStorage.setItem(
      'at-mock-state',
      JSON.stringify({
        session: {
          id: 's',
          email,
          csrf: 'csrf-e2e',
          mfaVerified: false,
          limited: false,
          createdAt: new Date().toISOString(),
        },
      }),
    );
  }, MOCK_ACCOUNTS.mfaRequired);
  await page.goto('/assets');
  await expect(page.getByTestId('assets-range')).toContainText('of 195');
  await page.evaluate(() => {
    const raw = JSON.parse(window.localStorage.getItem('at-mock-state') ?? '{}');
    raw.session.limited = true;
    window.localStorage.setItem('at-mock-state', JSON.stringify(raw));
  });
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page).toHaveURL(/\/mfa\/enroll\/?\?next=%2Fassets/);
});
