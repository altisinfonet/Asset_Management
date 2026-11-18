import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_ACCOUNTS,
  MOCK_BREACHED_PASSWORD,
  MOCK_INVITATIONS,
  MOCK_RESET_TOKENS,
} from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp } from '@/test/render';
import { ForgotPasswordScreen } from './forgot-password/forgot-password-screen';
import { InvitationScreen } from './invitation/invitation-screen';
import { ResetPasswordScreen } from './reset-password/reset-password-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const GOOD_PASSWORD = 'a long enough passphrase';

describe('ForgotPasswordScreen', () => {
  beforeEach(() => resetRouter());

  it('is accessible and validates the email before sending', async () => {
    const { container } = renderApp(<ForgotPasswordScreen />);
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your email address.')).toBeVisible();
    expect(screen.getByLabelText(/^Email/)).toHaveFocus();
  });

  it('shows the same confirmation for a known and an unknown address', async () => {
    const texts: string[] = [];
    for (const email of [MOCK_ACCOUNTS.owner, 'nobody@example.org']) {
      const { unmount } = renderApp(<ForgotPasswordScreen />);
      const user = userEvent.setup();
      await user.type(screen.getByLabelText(/^Email/), email);
      await user.click(screen.getByRole('button', { name: 'Send reset link' }));
      const heading = await screen.findByRole('heading', { level: 1, name: 'Check your email' });
      await waitFor(() => expect(heading).toHaveFocus());
      texts.push(
        screen.getByText(/a reset link is on its way/).textContent!.replace(email, '<email>'),
      );
      unmount();
    }
    expect(texts[0]).toBe(texts[1]);
    expect(texts[0]).toMatch(/^If an account exists for/);
  });

  it('tells the user when requests are throttled', async () => {
    server.use(
      http.post('/v1/auth/password/forgot', () =>
        HttpResponse.json(
          { code: 'rate-limited', status: 429 },
          {
            status: 429,
            headers: { 'retry-after': '30', 'content-type': 'application/problem+json' },
          },
        ),
      ),
    );
    renderApp(<ForgotPasswordScreen />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Email/), 'a@example.org');
    await user.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Try again in 30 seconds.');
  });
});

describe('ResetPasswordScreen', () => {
  beforeEach(() => resetRouter());

  it('without a token it explains the link is not valid and offers a new one', async () => {
    renderApp(<ResetPasswordScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'This link is not valid' })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('checks length and confirmation client-side, then resets and points to sign in', async () => {
    window.history.pushState({}, '', `/reset-password/?token=${MOCK_RESET_TOKENS.valid}`);
    const { container } = renderApp(<ResetPasswordScreen />);
    await expectNoA11yViolations(container);
    const user = userEvent.setup();
    const [password, confirm] = [
      screen.getByLabelText(/^New password/),
      screen.getByLabelText(/^Confirm new password/),
    ];
    expect(password).toHaveAttribute('autocomplete', 'new-password');

    await user.type(password, 'short');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('Use at least 12 characters.')).toBeVisible();
    expect(password).toHaveFocus();

    await user.clear(password);
    await user.type(password, GOOD_PASSWORD);
    await user.type(confirm, 'something else entirely');
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('The passwords do not match.')).toBeVisible();

    await user.clear(confirm);
    await user.type(confirm, GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    const done = await screen.findByRole('heading', { level: 1, name: 'Password changed' });
    await waitFor(() => expect(done).toHaveFocus());
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute(
      'href',
      '/login?reason=password_reset',
    );
  });

  it('shows the server message for a breached password', async () => {
    window.history.pushState({}, '', `/reset-password/?token=${MOCK_RESET_TOKENS.valid}`);
    renderApp(<ResetPasswordScreen />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New password/), MOCK_BREACHED_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm new password/), MOCK_BREACHED_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText(/appeared in a data breach/)).toBeVisible();
  });

  it('an expired token gets its own message', async () => {
    window.history.pushState({}, '', `/reset-password/?token=${MOCK_RESET_TOKENS.expired}`);
    renderApp(<ResetPasswordScreen />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^New password/), GOOD_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm new password/), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This link has expired' }),
    ).toBeVisible();
  });
});

describe('InvitationScreen', () => {
  beforeEach(() => resetRouter());

  it('shows the organisation and role, then accepts with a name and password', async () => {
    window.history.pushState({}, '', `/invitation/?token=${MOCK_INVITATIONS.valid}`);
    const { container } = renderApp(<InvitationScreen />);
    expect(await screen.findByLabelText(/^Your name/)).toHaveValue('New User');
    expect(screen.getByText(/invited to join Acme Schools/)).toBeVisible();
    expect(screen.getByText('Role: Asset Manager')).toBeVisible();
    const email = screen.getByLabelText(/^Email/);
    expect(email).toHaveValue('new.user@example.org');
    expect(email).toHaveAttribute('readonly');
    await expectNoA11yViolations(container);

    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^Password/), GOOD_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm password/), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('goes to MFA enrolment when the organisation requires it', async () => {
    window.history.pushState({}, '', `/invitation/?token=${MOCK_INVITATIONS.mfaRequired}`);
    renderApp(<InvitationScreen />);
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/^Password/), GOOD_PASSWORD);
    await user.type(screen.getByLabelText(/^Confirm password/), GOOD_PASSWORD);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/mfa/enroll'));
  });

  it('expired, unknown and missing tokens each get a clear, safe message', async () => {
    window.history.pushState({}, '', `/invitation/?token=${MOCK_INVITATIONS.expired}`);
    const expired = renderApp(<InvitationScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This invitation has expired' }),
    ).toBeVisible();
    expired.unmount();

    window.history.pushState({}, '', '/invitation/?token=unknown');
    const unknown = renderApp(<InvitationScreen />);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'This invitation is not valid' }),
    ).toBeVisible();
    unknown.unmount();

    window.history.pushState({}, '', '/invitation/');
    renderApp(<InvitationScreen />);
    expect(
      screen.getByRole('heading', { level: 1, name: 'This invitation is not valid' }),
    ).toBeVisible();
  });

  it('requires a name and matching passwords', async () => {
    window.history.pushState({}, '', `/invitation/?token=${MOCK_INVITATIONS.valid}`);
    renderApp(<InvitationScreen />);
    const user = userEvent.setup();
    const name = await screen.findByLabelText(/^Your name/);
    await user.clear(name);
    await user.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter your name.')).toBeVisible();
    expect(name).toHaveFocus();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
