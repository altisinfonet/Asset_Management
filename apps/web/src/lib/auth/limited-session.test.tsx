import { act, screen, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RequireAuth } from '@/components/auth/require-auth';
import { getApi } from '@/lib/api';
import { MOCK_ACCOUNTS, MOCK_TOTP_CODE } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { loadState } from '@/mocks/state';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { authApi } from './auth-api';
import { useAuth } from './auth-context';
import { getCsrfToken, setCsrfToken } from './http';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

function Probe() {
  const auth = useAuth();
  return <span data-testid="status">{auth.state.status}</span>;
}

/**
 * The limited session: the tenant requires MFA and the user has not enrolled. The real API answers
 * 200 to GET /v1/auth/me with `mfa_enrolment_required: true` (so the client learns its CSRF token)
 * and 403 `mfa-enrolment-required` everywhere else. The mock used to answer 403 on /me, which hid
 * a client that treated a 200 as "fully signed in".
 */
describe('limited session', () => {
  beforeEach(() => resetRouter());

  it('the mock answers like the real API: 200 on /me with the flag, 403 elsewhere', async () => {
    seedSession(MOCK_ACCOUNTS.mfaRequired, { limited: true });
    const me = await fetch('/v1/auth/me');
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      mfa_enrolment_required: true,
      csrf_token: 'csrf-test',
    });
    const assets = await fetch('/v1/assets');
    expect(assets.status).toBe(403);
    expect(await assets.json()).toMatchObject({ code: 'mfa-enrolment-required' });
  });

  it('a full session reports mfa_enrolment_required: false', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    const me = (await (await fetch('/v1/auth/me')).json()) as { mfa_enrolment_required: boolean };
    expect(me.mfa_enrolment_required).toBe(false);
  });

  it('the bootstrap turns a 200 with the flag into the enrolment state and keeps the CSRF token', async () => {
    seedSession(MOCK_ACCOUNTS.mfaRequired, { limited: true });
    setCsrfToken(undefined);
    renderApp(<Probe />);
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('mfa_enrolment_required'),
    );
    // the token from /me is what lets the enrolment screen start the TOTP factor
    expect(getCsrfToken()).toBe('csrf-test');
    await expect(authApi.startMfaEnrolment()).resolves.toMatchObject({
      secret: expect.any(String),
    });
  });

  it('reload while limited: a fresh page load lands on enrolment again, not on the app', async () => {
    seedSession(MOCK_ACCOUNTS.mfaRequired, { limited: true });
    window.history.pushState({}, '', '/assets/');
    const first = renderApp(
      <RequireAuth>
        <p>the app</p>
      </RequireAuth>,
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/mfa/enroll?next=%2Fassets%2F'),
    );
    first.unmount();

    // "reload": a new page has no CSRF token in memory, only the (mock) session cookie
    setCsrfToken(undefined);
    router.replace.mockClear();
    renderApp(
      <RequireAuth>
        <p>the app</p>
      </RequireAuth>,
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/mfa/enroll?next=%2Fassets%2F'),
    );
    expect(screen.queryByText('the app')).not.toBeInTheDocument();
    // and the token learned from /me works for the enrolment calls
    expect(getCsrfToken()).toBe('csrf-test');
    await authApi.startMfaEnrolment();
    await authApi.confirmMfaEnrolment(MOCK_TOTP_CODE);
    expect(loadState().session?.limited).toBe(false);
  });

  it('an API call that answers 403 mfa-enrolment-required flips an authenticated app to enrolment', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    renderApp(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    server.use(
      http.get('/v1/assets', () =>
        HttpResponse.json(
          { status: 403, code: 'mfa-enrolment-required', title: 'MFA required' },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await act(async () => {
      await getApi()
        .http.GET('/v1/assets')
        .catch(() => undefined);
    });
    await waitFor(() =>
      expect(screen.getByTestId('status')).toHaveTextContent('mfa_enrolment_required'),
    );
  });
});
