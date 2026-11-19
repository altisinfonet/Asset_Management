import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOCK_ACCOUNTS,
  MOCK_PASSWORD,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_TOTP_CODE,
} from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { SecurityScreen } from './security-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const TURN_OFF_TITLE = 'Turn off two-step verification?';
const TURN_OFF_CONFIRM = 'Turn off two-step verification';

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

  it('offers MFA set-up when it is off and the two actions when it is on', async () => {
    seedSession(MOCK_ACCOUNTS.owner);
    const off = renderApp(<SecurityScreen />);
    expect(await screen.findByRole('link', { name: 'Set up' })).toHaveAttribute(
      'href',
      '/mfa/enroll?next=%2Faccount%2Fsecurity',
    );
    expect(screen.getByText('Off')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
    off.unmount();

    seedSession(MOCK_ACCOUNTS.mfaOwner);
    renderApp(<SecurityScreen />);
    expect(await screen.findByText('On')).toBeVisible();
    expect(screen.queryByRole('link', { name: 'Set up' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'New recovery codes' })).toBeEnabled();
  });

  describe('Turn off', () => {
    async function openTurnOff(email: string = MOCK_ACCOUNTS.mfaOwner) {
      seedSession(email);
      renderApp(<SecurityScreen />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Turn off' }));
      const dialog = await screen.findByRole('dialog', { name: TURN_OFF_TITLE });
      return { user, dialog };
    }

    it('explains the impact and turns MFA off after re-authenticating with the password', async () => {
      const { user, dialog } = await openTurnOff();
      expect(within(dialog).getByText(/Your recovery codes stop working/)).toBeVisible();
      expect(within(dialog).getByText(/Every other signed-in device is signed out/)).toBeVisible();
      await expectNoA11yViolations(dialog);

      await user.type(within(dialog).getByLabelText(/^Current password/), MOCK_PASSWORD);
      await user.click(within(dialog).getByRole('button', { name: TURN_OFF_CONFIRM }));
      expect(await screen.findByText('Two-step verification is off.')).toBeVisible();
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByText('Off')).toBeVisible();
      expect(screen.getByRole('link', { name: 'Set up again' })).toHaveAttribute(
        'href',
        '/mfa/enroll?next=%2Faccount%2Fsecurity',
      );
      expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument();
      // the other devices were signed out: only this one is left in the list
      await waitFor(() =>
        expect(
          within(screen.getByRole('table', { name: 'Signed-in devices' })).getAllByRole('row'),
        ).toHaveLength(2),
      );
    });

    it('accepts an authenticator code instead of the password', async () => {
      const { user, dialog } = await openTurnOff();
      await user.click(within(dialog).getByRole('tab', { name: 'Authenticator code' }));
      await user.type(within(dialog).getByLabelText(/^Authentication code/), MOCK_TOTP_CODE);
      await user.click(within(dialog).getByRole('button', { name: TURN_OFF_CONFIRM }));
      expect(await screen.findByText('Two-step verification is off.')).toBeVisible();
    });

    it('asks for a value first, then shows 403 reauth-failed on the field', async () => {
      const { user, dialog } = await openTurnOff();
      const submit = within(dialog).getByRole('button', { name: TURN_OFF_CONFIRM });
      await user.click(submit);
      expect(await within(dialog).findByText('Enter your password.')).toBeVisible();

      await user.click(within(dialog).getByRole('tab', { name: 'Authenticator code' }));
      expect(within(dialog).queryByText('Enter your password.')).not.toBeInTheDocument();
      await user.type(within(dialog).getByLabelText(/^Authentication code/), '000000');
      await user.click(submit);
      expect(await within(dialog).findByText(/That code is not correct/)).toBeVisible();
      expect(within(dialog).getByLabelText(/^Authentication code/)).toHaveAttribute(
        'aria-invalid',
        'true',
      );
      // still on, dialog still open
      expect(screen.getByText('On')).toBeVisible();
      await expectNoA11yViolations(dialog);
    });

    it('disables Turn off up front, with the explanation, when /me says the policy is enforced', async () => {
      seedSession(MOCK_ACCOUNTS.mfaEnforced);
      const { container } = renderApp(<SecurityScreen />);
      const turnOff = await screen.findByRole('button', { name: 'Turn off' });
      await waitFor(() => expect(turnOff).toBeDisabled());
      expect(turnOff).toHaveAccessibleDescription(/requires two-step verification/);
      expect(screen.getByText(/Your organisation requires two-step verification/)).toBeVisible();
      // the other action stays available
      expect(screen.getByRole('button', { name: 'New recovery codes' })).toBeEnabled();
      await expectNoA11yViolations(container);
    });

    it('offers Turn off to an account the policy does not cover', async () => {
      seedSession(MOCK_ACCOUNTS.mfaOwner);
      renderApp(<SecurityScreen />);
      expect(await screen.findByRole('button', { name: 'Turn off' })).toBeEnabled();
      expect(screen.queryByText(/Your organisation requires two-step verification/)).toBeNull();
    });

    it('still explains the 403 when /me said the policy does not apply but the API refuses, and disables Turn off afterwards', async () => {
      seedSession(MOCK_ACCOUNTS.mfaEnforced);
      const me = (await (await fetch(`${window.location.origin}/v1/auth/me`)).json()) as Record<
        string,
        unknown
      >;
      me.mfa_policy = { required: false, scope: 'off' };
      server.use(http.get('/v1/auth/me', () => HttpResponse.json(me)));
      renderApp(<SecurityScreen />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'Turn off' }));
      const dialog = await screen.findByRole('dialog', { name: TURN_OFF_TITLE });
      await user.type(within(dialog).getByLabelText(/^Current password/), MOCK_PASSWORD);
      await user.click(within(dialog).getByRole('button', { name: TURN_OFF_CONFIRM }));
      expect(
        await within(dialog).findByText('Your organisation requires two-step verification'),
      ).toBeVisible();
      await expectNoA11yViolations(dialog);
      await user.click(within(dialog).getByRole('button', { name: 'Got it' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

      const turnOff = screen.getByRole('button', { name: 'Turn off' });
      expect(turnOff).toBeDisabled();
      expect(turnOff).toHaveAccessibleDescription(/requires two-step verification/);
      expect(screen.getByText('On')).toBeVisible();
    });

    it('says how long to wait when re-authentication is rate limited', async () => {
      server.use(
        http.delete('/v1/auth/mfa', () =>
          HttpResponse.json(
            { status: 429, code: 'account-locked', request_id: 'req-429' },
            {
              status: 429,
              headers: { 'content-type': 'application/problem+json', 'retry-after': '90' },
            },
          ),
        ),
      );
      const { user, dialog } = await openTurnOff();
      await user.type(within(dialog).getByLabelText(/^Current password/), MOCK_PASSWORD);
      await user.click(within(dialog).getByRole('button', { name: TURN_OFF_CONFIRM }));
      expect(await within(dialog).findByText(/2 minutes/)).toBeVisible();
    });
  });

  describe('New recovery codes', () => {
    async function openAsk() {
      seedSession(MOCK_ACCOUNTS.mfaOwner);
      renderApp(<SecurityScreen />);
      const user = userEvent.setup();
      await user.click(await screen.findByRole('button', { name: 'New recovery codes' }));
      const ask = await screen.findByRole('dialog', { name: 'Get new recovery codes?' });
      return { user, ask };
    }

    it('re-authenticates, shows the new codes and only closes once they are saved', async () => {
      const { user, ask } = await openAsk();
      expect(within(ask).getByText(/stop working immediately/)).toBeVisible();
      await user.type(within(ask).getByLabelText(/^Current password/), MOCK_PASSWORD);
      await user.click(within(ask).getByRole('button', { name: 'Get new codes' }));

      const dialog = await screen.findByRole('dialog', { name: 'Your new recovery codes' });
      const codes = within(dialog).getByTestId('recovery-codes');
      expect(
        within(codes)
          .getAllByRole('listitem')
          .map((li) => li.textContent),
      ).toEqual(MOCK_REGENERATED_RECOVERY_CODES);
      expect(within(dialog).getByText(/old recovery codes no longer work/)).toBeVisible();
      await expectNoA11yViolations(dialog);

      // gated: Close is disabled and Esc does nothing
      const close = within(dialog).getByRole('button', { name: 'Close' });
      expect(close).toBeDisabled();
      await user.keyboard('{Escape}');
      expect(screen.getByRole('dialog', { name: 'Your new recovery codes' })).toBeVisible();

      await user.click(within(dialog).getByRole('checkbox', { name: 'I have saved these codes' }));
      expect(close).toBeEnabled();
      await user.click(close);
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      // the codes are shown once, and are gone from the page afterwards
      expect(screen.queryByTestId('recovery-codes')).not.toBeInTheDocument();
    });

    it('shows a wrong password on the field and no codes', async () => {
      const { user, ask } = await openAsk();
      await user.type(within(ask).getByLabelText(/^Current password/), 'wrong password');
      await user.click(within(ask).getByRole('button', { name: 'Get new codes' }));
      expect(await within(ask).findByText('That password is not correct.')).toBeVisible();
      expect(screen.queryByTestId('recovery-codes')).not.toBeInTheDocument();
    });
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
