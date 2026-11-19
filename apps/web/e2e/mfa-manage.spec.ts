import {
  MOCK_ACCOUNTS,
  MOCK_PASSWORD,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_TOTP_CODE,
} from '../src/mocks/fixtures';
import { expect, test } from './fixtures';

/**
 * Account security: turn two-step verification off and get new recovery codes (both re-authenticate
 * with the password or an authenticator code), against the mock API that mirrors the contract.
 */
const TURN_OFF = 'Turn off two-step verification';

test.describe('two-step verification on', () => {
  test.use({ session: MOCK_ACCOUNTS.mfaOwner });

  test('turns off with the password, shows Off and offers to set it up again', async ({ page }) => {
    await page.goto('/account/security');
    await expect(page.getByText('On', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: 'Turn off two-step verification?' });
    await expect(dialog).toContainText('Your recovery codes stop working');
    await dialog.getByLabel(/^Current password/).fill(MOCK_PASSWORD);
    await dialog.getByRole('button', { name: TURN_OFF }).click();

    await expect(page.getByRole('main').getByText('Two-step verification is off.')).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByText('Off', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn off', exact: true })).toHaveCount(0);
    const again = page.getByRole('link', { name: 'Set up again' });
    await expect(again).toHaveAttribute('href', /\/mfa\/enroll\/?\?next=%2Faccount%2Fsecurity/);

    // the other devices were signed out with it (header row + this device)
    await expect(
      page.getByRole('table', { name: 'Signed-in devices' }).getByRole('row'),
    ).toHaveCount(2);

    await page.getByRole('link', { name: 'Set up again' }).click();
    await expect(page).toHaveURL(/\/mfa\/enroll\/?\?next=/);
  });

  test('a wrong authenticator code is an inline error and nothing changes', async ({ page }) => {
    await page.goto('/account/security');
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step verification?' });
    await dialog.getByRole('tab', { name: 'Authenticator code' }).click();
    await dialog.getByLabel(/^Authentication code/).fill('000000');
    await dialog.getByRole('button', { name: TURN_OFF }).click();
    await expect(dialog.getByText(/That code is not correct/)).toBeVisible();
    await expect(dialog.getByLabel(/^Authentication code/)).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByText('On', { exact: true })).toBeVisible();

    // the right code then works
    await dialog.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
    await dialog.getByRole('button', { name: TURN_OFF }).click();
    await expect(page.getByRole('main').getByText('Two-step verification is off.')).toBeVisible();
  });

  test('regenerating recovery codes shows ten codes and gates Close on "I have saved these codes"', async ({
    page,
  }) => {
    await page.goto('/account/security');
    await page.getByRole('button', { name: 'New recovery codes' }).click();
    const ask = page.getByRole('dialog', { name: 'Get new recovery codes?' });
    await expect(ask).toContainText('stop working immediately');
    await ask.getByRole('tab', { name: 'Authenticator code' }).click();
    await ask.getByLabel(/^Authentication code/).fill(MOCK_TOTP_CODE);
    await ask.getByRole('button', { name: 'Get new codes' }).click();

    const dialog = page.getByRole('dialog', { name: 'Your new recovery codes' });
    await expect(dialog.getByTestId('recovery-codes').getByRole('listitem')).toHaveText(
      MOCK_REGENERATED_RECOVERY_CODES,
    );
    const close = dialog.getByRole('button', { name: 'Close' });
    await expect(close).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('checkbox', { name: 'I have saved these codes' }).click();
    await expect(close).toBeEnabled();
    await close.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('recovery-codes')).toHaveCount(0);
  });
});

test.describe('policy-enforced two-step verification', () => {
  test.use({ session: MOCK_ACCOUNTS.mfaEnforced });

  test('Turn off is refused with an explanation and then disabled; MFA stays on', async ({
    page,
  }) => {
    await page.goto('/account/security');
    await page.getByRole('button', { name: 'Turn off', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Turn off two-step verification?' });
    await dialog.getByLabel(/^Current password/).fill(MOCK_PASSWORD);
    await dialog.getByRole('button', { name: TURN_OFF }).click();
    await expect(
      dialog.getByText('Your organisation requires two-step verification'),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Got it' }).click();

    await expect(page.getByRole('button', { name: 'Turn off', exact: true })).toBeDisabled();
    await expect(page.getByText(/so you cannot turn it off/)).toBeVisible();
    await expect(page.getByText('On', { exact: true })).toBeVisible();
    // a reload still shows On (the server kept the factor)
    await page.reload();
    await expect(page.getByText('On', { exact: true })).toBeVisible();
  });
});
