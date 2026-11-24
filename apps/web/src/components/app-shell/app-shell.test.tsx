import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RECENT_STORAGE_KEY } from '@/lib/recent-items';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function renderShell(email: string = MOCK_ACCOUNTS.owner) {
  seedSession(email);
  const view = renderApp(
    <AppShell>
      <p>page content</p>
    </AppShell>,
  );
  await screen.findByTestId('tenant-name');
  return view;
}

describe('AppShell navigation', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
  });

  it('shows the tenant name and the user in the menu, and has no axe violations', async () => {
    const { container } = await renderShell();
    expect(screen.getByTestId('tenant-name')).toHaveTextContent('Acme Schools');
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByText('Alice Owner')).toBeVisible();
    expect(within(menu).getByText(MOCK_ACCOUNTS.owner)).toBeVisible();
    expect(within(menu).getByRole('menuitem', { name: /Security/ })).toHaveAttribute(
      'href',
      '/account/security',
    );
    await expectNoA11yViolations(container.ownerDocument.body);
  });

  it('role-aware navigation: a viewer does not get Settings, an owner does', async () => {
    const owner = await renderShell(MOCK_ACCOUNTS.owner);
    const ownerNav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(ownerNav).getByRole('link', { name: 'Settings' })).toBeVisible();
    owner.unmount();

    await renderShell(MOCK_ACCOUNTS.viewer);
    const viewerNav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(viewerNav).getByRole('link', { name: 'Assets' })).toBeVisible();
    expect(within(viewerNav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('offers accessories and repairs by permission, with the notification bell in the top bar', async () => {
    const owner = await renderShell(MOCK_ACCOUNTS.owner);
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Stock' })).toHaveAttribute('href', '/stock');
    expect(within(nav).getByRole('link', { name: 'Repairs' })).toHaveAttribute('href', '/repairs');
    expect(await screen.findByRole('button', { name: 'Notifications, 3 unread' })).toBeVisible();
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }));
    expect(await screen.findByRole('menuitem', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/account/notifications',
    );
    owner.unmount();

    // a viewer reads both (every built-in role holds the read permissions)
    await renderShell(MOCK_ACCOUNTS.viewer);
    const viewerNav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(viewerNav).getByRole('link', { name: 'Repairs' })).toBeVisible();
  });

  it('sign out ends the session and returns to the login screen with a notice', async () => {
    await renderShell();
    await userEvent.click(screen.getByRole('button', { name: 'User menu' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/login?reason=signed_out'));
  });
});

describe('command palette', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
  });

  it('opens with Ctrl+K, lists navigation from the nav config and navigates on Enter', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    expect(within(dialog).getByRole('option', { name: 'Assets' })).toBeVisible();
    expect(within(dialog).getByRole('option', { name: 'Settings' })).toBeVisible();
    expect(within(dialog).getByRole('option', { name: 'Locations' })).toBeVisible();
    expect(within(dialog).getByRole('option', { name: 'People' })).toBeVisible();
    // modules that are not built yet are not offered
    expect(within(dialog).queryByRole('option', { name: 'Loaner pool' })).not.toBeInTheDocument();

    await user.type(within(dialog).getByRole('combobox'), 'settings');
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith('/settings/organisation');
    expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument();
  });

  it('a typed tag becomes an "Open asset" quick-jump to /assets/view?code=', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), 'AT-00124');
    const option = await within(dialog).findByRole('option', { name: 'Open asset AT-00124' });
    await user.click(option);
    expect(router.push).toHaveBeenCalledWith('/assets/view?code=AT-00124');
  });

  it('text that is not tag-like (spaces) offers no quick-jump', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), 'two words');
    expect(within(dialog).queryByRole('option', { name: /Open asset/ })).not.toBeInTheDocument();
  });

  it('remembers recent targets in localStorage and lists them first next time', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    let dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(dialog).getByRole('combobox'), 'AT-00124');
    await user.click(await within(dialog).findByRole('option', { name: 'Open asset AT-00124' }));
    expect(JSON.parse(window.localStorage.getItem(RECENT_STORAGE_KEY)!)).toEqual([
      { type: 'asset', code: 'AT-00124' },
    ]);

    await user.keyboard('{Control>}k{/Control}');
    dialog = await screen.findByRole('dialog', { name: 'Command palette' });
    const recent = within(dialog).getByRole('group', { name: 'Recent' });
    expect(within(recent).getByRole('option', { name: 'Open asset AT-00124' })).toBeVisible();
  });

  it('still works when localStorage is unavailable', async () => {
    await renderShell();
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    try {
      const user = userEvent.setup();
      await user.keyboard('{Control>}k{/Control}');
      const dialog = await screen.findByRole('dialog', { name: 'Command palette' });
      await user.click(within(dialog).getByRole('option', { name: 'Assets' }));
      expect(router.push).toHaveBeenCalledWith('/assets');
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('keyboard shortcuts', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
  });

  it('? opens the shortcuts help dialog, Esc closes it and focus returns', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard('?');
    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(dialog).getByText('Open the command palette')).toBeVisible();
    expect(within(dialog).getByText('Dashboard')).toBeVisible();
    await expectNoA11yViolations(dialog);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Keyboard shortcuts' })).not.toBeInTheDocument();
  });

  it('g then a goes to Assets; g then an unknown key does nothing; typing in a field is ignored', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.keyboard('ga');
    // the shortcut waits a beat (the scanner guard) so a scanned code cannot trigger it
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/assets'));

    router.push.mockReset();
    await user.keyboard('gx');
    await user.keyboard('a');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(router.push).not.toHaveBeenCalled();

    await user.click(screen.getByPlaceholderText('Scan or type tag'));
    await user.keyboard('ga');
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('the shortcuts are also reachable from the user menu', async () => {
    await renderShell();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'User menu' }));
    await user.click(await screen.findByRole('menuitem', { name: /Keyboard shortcuts/ }));
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});
