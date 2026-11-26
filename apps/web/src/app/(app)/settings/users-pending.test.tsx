import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { renderApp, seedSession } from '@/test/render';
import { UsersScreen } from './users-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/**
 * Pending logins on the Users tab (ED-27): a login whose invitation is not accepted yet is listed with
 * a "Pending" badge and has the actions that make sense for it (access, link to a person, resend,
 * revoke), not the ones that need a sign-in (devices, two-step reset, deactivate).
 */
describe('UsersScreen pending logins', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  async function openActions(user: ReturnType<typeof userEvent.setup>, name: string) {
    const row = await screen.findByRole('row', { name: new RegExp(name) });
    await user.click(within(row).getByRole('button', { name: new RegExp(`Actions for ${name}`) }));
    return row;
  }

  it('lists a pending login with a Pending badge and its own actions', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<UsersScreen />);
    const row = await openActions(user, 'Jordan Invited');
    expect(within(row).getByText('Pending')).toBeVisible();
    // the people who can sign in are not marked
    expect(
      within(screen.getByRole('row', { name: /Alice Owner/ })).queryByText('Pending'),
    ).toBeNull();
    for (const name of [
      'Rename',
      'Change role and access',
      'Link to a person',
      'Resend invitation',
      'Revoke invitation',
    ]) {
      expect(await screen.findByRole('menuitem', { name })).toBeVisible();
    }
    for (const name of ['Signed-in devices', 'Deactivate', 'Reset two-step verification']) {
      expect(screen.queryByRole('menuitem', { name })).toBeNull();
    }
    await expectNoA11yViolations(container.ownerDocument.body);
    // the Pending invitations tab still lists it, with its count
    await user.keyboard('{Escape}');
    expect(screen.getByRole('tab', { name: /Pending invitations/ })).toHaveTextContent('2');
  });

  it('resends and revokes an invitation from the Users tab', async () => {
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    await openActions(user, 'Jordan Invited');
    await user.click(await screen.findByRole('menuitem', { name: 'Resend invitation' }));
    expect(
      await screen.findByText('Invitation resent to jordan.invited@example.org.'),
    ).toBeVisible();

    await openActions(user, 'Jordan Invited');
    await user.click(await screen.findByRole('menuitem', { name: 'Revoke invitation' }));
    const confirm = await screen.findByRole('dialog', { name: /Revoke the invitation for jordan/ });
    await user.click(within(confirm).getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(screen.queryByRole('row', { name: /Jordan Invited/ })).toBeNull());
  });

  it('links a pending login to a person', async () => {
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    const row = await openActions(user, 'Sasha Waiting');
    await user.click(await screen.findByRole('menuitem', { name: 'Link to a person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link Sasha Waiting to a person' });
    await user.type(within(dialog).getByRole('combobox', { name: /Person/ }), 'Jamie');
    await user.click(await screen.findByRole('option', { name: /Jamie Okafor/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Link login' }));
    expect(await within(row).findByRole('link', { name: 'Jamie Okafor' })).toBeVisible();
  });

  it('gives a pending login more access from its access dialog', async () => {
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    await openActions(user, 'Jordan Invited');
    await user.click(await screen.findByRole('menuitem', { name: 'Change role and access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Role and access of Jordan Invited' });
    await user.click(within(dialog).getByRole('button', { name: 'Add access' }));
    const add = await screen.findByRole('dialog', { name: 'Add access for Jordan Invited' });
    await user.click(within(add).getByRole('combobox', { name: /^Role/ }));
    await user.click(await screen.findByRole('option', { name: 'Viewer' }));
    await user.click(within(add).getByRole('button', { name: 'Add access' }));
    expect(
      await within(dialog).findByRole('button', { name: 'Remove access: Viewer' }),
    ).toBeVisible();
  });
});
