import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/lib/auth/auth-context';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { RequireAuth } from './require-auth';
import { AccessDenied, RequirePermission } from './access-denied';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

function Probe() {
  const auth = useAuth();
  return (
    <div>
      <span data-testid="status">{auth.state.status}</span>
      <span data-testid="can-settings">{String(auth.can(['catalog:manage']))}</span>
      <button onClick={() => void auth.signOut()}>probe sign out</button>
    </div>
  );
}

describe('RequireAuth (route guard)', () => {
  beforeEach(() => resetRouter());

  it('shows nothing of the page while the session is being checked, then renders it', async () => {
    seedSession();
    renderApp(
      <RequireAuth>
        <p>secret page</p>
      </RequireAuth>,
    );
    expect(screen.queryByText('secret page')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Checking your session');
    expect(await screen.findByText('secret page')).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it('redirects an anonymous visitor to /login?next= with the page they wanted', async () => {
    window.history.pushState({}, '', '/assets/view/?code=AT-00124');
    renderApp(
      <RequireAuth>
        <p>secret page</p>
      </RequireAuth>,
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/login?next=%2Fassets%2Fview%2F%3Fcode%3DAT-00124',
      ),
    );
    expect(screen.queryByText('secret page')).not.toBeInTheDocument();
  });

  it('sends users who still owe an MFA enrolment to the enrolment screen', async () => {
    seedSession(MOCK_ACCOUNTS.mfaRequired, { limited: true });
    window.history.pushState({}, '', '/assets/');
    renderApp(
      <RequireAuth>
        <p>secret page</p>
      </RequireAuth>,
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith('/mfa/enroll?next=%2Fassets%2F'),
    );
  });

  it('a 401 after load means the session ended: back to login with reason=expired', async () => {
    seedSession();
    window.history.pushState({}, '', '/settings/users/');
    renderApp(
      <RequireAuth>
        <p>secret page</p>
      </RequireAuth>,
    );
    await screen.findByText('secret page');
    // The session is revoked server-side; the next API call comes back 401.
    server.use(
      http.get('/v1/auth/sessions', () =>
        HttpResponse.json({ status: 401, code: 'unauthenticated' }, { status: 401 }),
      ),
    );
    const { authApi } = await import('@/lib/auth/auth-api');
    await act(async () => {
      await authApi.listSessions().catch(() => undefined);
    });
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(
        '/login?reason=expired&next=%2Fsettings%2Fusers%2F',
      ),
    );
    expect(screen.queryByText('secret page')).not.toBeInTheDocument();
  });

  it('offers a retry when the session check itself fails (server down), not a login loop', async () => {
    server.use(http.get('/v1/auth/me', () => HttpResponse.error()));
    renderApp(
      <RequireAuth>
        <p>secret page</p>
      </RequireAuth>,
    );
    expect(
      await screen.findByRole('heading', { name: 'We could not check your session' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(router.replace).not.toHaveBeenCalled();
  });
});

describe('AuthProvider', () => {
  beforeEach(() => resetRouter());

  it('exposes permission checks from /me and signs out locally', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<Probe />);
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
    expect(screen.getByTestId('can-settings')).toHaveTextContent('false');

    await userEvent.click(screen.getByRole('button', { name: 'probe sign out' }));
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('anonymous'));
  });

  it('wildcard owners can do everything', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    renderApp(<Probe />);
    await waitFor(() => expect(screen.getByTestId('can-settings')).toHaveTextContent('true'));
  });
});

describe('permission denied (WEB-24)', () => {
  it('RequirePermission shows the 403 screen with no hint about the data', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(
      <RequirePermission permission="user:manage">
        <p>admin only</p>
      </RequirePermission>,
    );
    expect(await screen.findByTestId('access-denied')).toHaveTextContent(
      'You do not have access to this page',
    );
    expect(screen.queryByText('admin only')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/');
  });

  it('shows the request id when the API sent one', () => {
    renderApp(<AccessDenied requestId="req-42" />);
    expect(screen.getByText('Request ID req-42')).toBeVisible();
  });
});
