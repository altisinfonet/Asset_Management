import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_ACCOUNTS,
  MOCK_PASSWORD,
  MOCK_RECOVERY_CODES,
  MOCK_TOTP_CODE,
} from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp } from '@/test/render';
import { LoginScreen } from './login-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function fillCredentials(email: string, password = MOCK_PASSWORD) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Email/), email);
  await user.type(screen.getByLabelText(/^Password/), password);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
  return user;
}

describe('LoginScreen', () => {
  beforeEach(() => resetRouter());

  it('has labelled fields, a forgot-password link and no axe violations', async () => {
    const { container } = renderApp(<LoginScreen />);
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('autocomplete', 'username');
    expect(screen.getByLabelText(/^Password/)).toHaveAttribute('autocomplete', 'current-password');
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    await expectNoA11yViolations(container);
  });

  it('validates before calling the API and moves focus to the first invalid field', async () => {
    const calls = vi.fn();
    server.use(
      http.post('/v1/auth/login', () => {
        calls();
        return HttpResponse.json({});
      }),
    );
    renderApp(<LoginScreen />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeVisible();
    expect(screen.getByText('Enter your password.')).toBeVisible();
    expect(screen.getByLabelText(/^Email/)).toHaveFocus();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');

    await user.type(screen.getByLabelText(/^Email/), 'not-an-email');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address.')).toBeVisible();
    expect(calls).not.toHaveBeenCalled();
  });

  it('answers wrong credentials with one announced message that does not name the cause', async () => {
    const unknown = renderApp(<LoginScreen />);
    await fillCredentials('ghost@example.org', 'wrong password');
    const unknownText = (await screen.findByRole('alert')).textContent;
    expect(unknownText).toBe('Email or password is incorrect.');
    expect(router.replace).not.toHaveBeenCalled();
    unknown.unmount();

    // known account, wrong password: the very same text
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.owner, 'wrong password');
    expect((await screen.findByRole('alert')).textContent).toBe(unknownText);
  });

  it('says how long to wait when throttled', async () => {
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.locked);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Too many sign-in attempts. Try again in 2 minutes.',
    );
  });

  it('signs in and goes to the dashboard, or to a safe ?next= target', async () => {
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.owner);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('honours ?next= for same-origin paths and ignores external ones', async () => {
    window.history.pushState({}, '', '/login/?next=%2Fassets%2F');
    const first = renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.owner);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/assets/'));
    first.unmount();

    router.replace.mockReset();
    window.history.pushState({}, '', '/login/?next=https%3A%2F%2Fevil.example');
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.owner);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('explains why you are here when the session ended or you signed out', async () => {
    window.history.pushState({}, '', '/login/?reason=expired');
    const { unmount } = renderApp(<LoginScreen />);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Your session ended. Sign in again to continue.',
    );
    unmount();
    window.history.pushState({}, '', '/login/?reason=signed_out');
    renderApp(<LoginScreen />);
    expect(screen.getByRole('status')).toHaveTextContent('You have been signed out.');
  });

  it('MFA: asks for the code, rejects a wrong one, accepts the right one', async () => {
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.mfaOwner);
    const heading = await screen.findByRole('heading', { level: 1, name: 'Two-step verification' });
    expect(heading).toBeVisible();
    const code = screen.getByLabelText(/^Authentication code/);
    await waitFor(() => expect(code).toHaveFocus());
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    expect(code).toHaveAttribute('inputmode', 'numeric');

    const user = userEvent.setup();
    await user.type(code, '000000');
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('That code is not correct');
    expect(router.replace).not.toHaveBeenCalled();

    await user.clear(code);
    await user.type(code, `${MOCK_TOTP_CODE.slice(0, 3)} ${MOCK_TOTP_CODE.slice(3)}`); // pasted with a space
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('MFA: a recovery code works once', async () => {
    renderApp(<LoginScreen />);
    const user = await fillCredentials(MOCK_ACCOUNTS.mfaOwner);
    await user.click(await screen.findByRole('button', { name: 'Use a recovery code' }));
    const field = screen.getByLabelText(/^Recovery code/);
    await waitFor(() => expect(field).toHaveFocus());
    await user.type(field, MOCK_RECOVERY_CODES[1]!);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('MFA: an expired challenge sends the user back to the password step with a notice', async () => {
    server.use(
      http.post('/v1/auth/mfa/verify', () =>
        HttpResponse.json(
          { code: 'mfa-challenge-expired', title: 'expired', status: 401 },
          { status: 401, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderApp(<LoginScreen />);
    const user = await fillCredentials(MOCK_ACCOUNTS.mfaOwner);
    await user.type(await screen.findByLabelText(/^Authentication code/), MOCK_TOTP_CODE);
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(
      await screen.findByText('Your sign-in timed out. Enter your password again.'),
    ).toBeVisible();
    expect(screen.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  });

  it('asks which organisation when the email belongs to several', async () => {
    renderApp(<LoginScreen />);
    const user = await fillCredentials(MOCK_ACCOUNTS.multiTenant);
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Choose your organisation' }),
    ).toBeVisible();
    expect(screen.getByRole('radio', { name: 'Acme Schools' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Globex Clinics' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/'));
  });

  it('goes to MFA enrolment when the organisation requires it and the user has none', async () => {
    window.history.pushState({}, '', '/login/?next=%2Fassets%2F');
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.mfaRequired);
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/mfa/enroll?next=%2Fassets%2F'),
    );
  });

  it('reports a network failure without leaving the form', async () => {
    server.use(http.post('/v1/auth/login', () => HttpResponse.error()));
    renderApp(<LoginScreen />);
    await fillCredentials(MOCK_ACCOUNTS.owner);
    expect(await screen.findByRole('alert')).toHaveTextContent('The server could not be reached');
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeEnabled();
  });
});
