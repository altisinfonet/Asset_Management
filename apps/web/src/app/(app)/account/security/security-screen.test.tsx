import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { SecurityScreen } from './security-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

describe('SecurityScreen', () => {
  beforeEach(() => resetRouter());

  it('lists devices, marks this one and revokes another', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    const { container } = renderApp(<SecurityScreen />);
    const table = await screen.findByRole('table', { name: 'Signed-in devices' });
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(3);
    expect(within(rows[0]!).getByText('This device')).toBeVisible();
    // nothing to revoke on the current device: that is "Sign out"
    expect(within(rows[0]!).queryByRole('button')).not.toBeInTheDocument();
    await expectNoA11yViolations(container);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Sign out Safari on iPhone' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'Sign out Safari on iPhone' }),
      ).not.toBeInTheDocument(),
    );
    expect(await screen.findByText('Device signed out.')).toBeVisible();
    expect(within(table).getAllByRole('row')).toHaveLength(3);
  });

  it('offers MFA set-up when it is off and hides it when it is on', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    const off = renderApp(<SecurityScreen />);
    expect(await screen.findByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/mfa/enroll?next=%2Faccount%2Fsecurity',
    );
    expect(screen.getByText('Off')).toBeVisible();
    off.unmount();

    seedSession(MOCK_ACCOUNTS.mfaOwner);
    renderApp(<SecurityScreen />);
    expect(await screen.findByText('On')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Set up' })).not.toBeInTheDocument();
  });

  it('shows the permission-denied screen with the request id on a 403', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    server.use(
      http.get('/v1/auth/sessions', () =>
        HttpResponse.json(
          { status: 403, code: 'forbidden', request_id: 'req-403' },
          { status: 403, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderApp(<SecurityScreen />);
    expect(await screen.findByTestId('access-denied')).toBeVisible();
    expect(screen.getByText('Request ID req-403')).toBeVisible();
  });

  it('shows an error banner when the list cannot be loaded', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    server.use(http.get('/v1/auth/sessions', () => HttpResponse.error()));
    renderApp(<SecurityScreen />);
    expect(await screen.findByText('We could not load your devices.')).toBeVisible();
  });
});
