import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_ACCOUNTS,
  MOCK_NEW_RECOVERY_CODES,
  MOCK_SECRET,
  MOCK_TOTP_CODE,
} from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { EnrolScreen } from './enrol-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

describe('EnrolScreen', () => {
  beforeEach(() => resetRouter());

  it('sends an anonymous visitor to sign in', async () => {
    window.history.pushState({}, '', '/mfa/enroll/?next=%2Fassets%2F');
    renderApp(<EnrolScreen />);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?next=%2Fassets%2F'));
  });

  it('shows a QR code with a text alternative and the setup key, then the recovery codes once', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    window.history.pushState({}, '', '/mfa/enroll/?next=%2Fassets%2F');
    const { container } = renderApp(<EnrolScreen />);

    const qr = await screen.findByRole('img', { name: 'QR code for your authenticator app' });
    expect(qr.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
    expect(screen.getByTestId('mfa-secret')).toHaveTextContent(
      MOCK_SECRET.replace(/(.{4})/g, '$1 ').trim(),
    );
    await expectNoA11yViolations(container);

    const user = userEvent.setup();
    const code = screen.getByLabelText(/^Authentication code/);
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify and turn on' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not correct');

    await user.clear(code);
    await user.type(code, MOCK_TOTP_CODE);
    await user.click(screen.getByRole('button', { name: 'Verify and turn on' }));

    const heading = await screen.findByRole('heading', {
      level: 1,
      name: 'Save your recovery codes',
    });
    await waitFor(() => expect(heading).toHaveFocus());
    const list = screen.getByRole('list', { name: 'Recovery codes' });
    expect(list.querySelectorAll('li')).toHaveLength(10);
    expect(list).toHaveTextContent(MOCK_NEW_RECOVERY_CODES[0]!);

    // Continue stays disabled until the user confirms they saved the codes.
    const proceed = screen.getByRole('button', { name: 'Continue' });
    expect(proceed).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: 'I have saved these codes' }));
    expect(proceed).toBeEnabled();
    await user.click(proceed);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/assets/'));
  });

  it('when the organisation requires MFA it says so and offers sign out', async () => {
    seedSession(MOCK_ACCOUNTS.mfaRequired, { limited: true });
    renderApp(<EnrolScreen />);
    expect(
      await screen.findByText(
        'Your organisation requires two-step verification. Set it up to continue.',
      ),
    ).toBeVisible();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?reason=signed_out'));
  });
});
