import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { NotificationSettingsScreen } from '@/app/(app)/account/notifications/notifications-screen';
import { NotificationBell } from './notification-bell';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

describe('NotificationBell', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('shows the unread count in the badge and in the button name', async () => {
    renderApp(<NotificationBell />);
    const bell = await screen.findByRole('button', { name: 'Notifications, 3 unread' });
    expect(screen.getByTestId('notification-count')).toHaveTextContent('3');
    expect(bell).toBeVisible();
  });

  it('has no badge and a plain name when everything is read, or when the server cannot answer', async () => {
    server.use(http.get('/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })));
    const view = renderApp(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('notification-count')).not.toBeInTheDocument());
    view.unmount();

    server.use(
      http.get('/v1/notifications/unread-count', () => HttpResponse.json({}, { status: 404 })),
    );
    renderApp(<NotificationBell />);
    expect(await screen.findByRole('button', { name: 'Notifications' })).toBeVisible();
    expect(screen.queryByTestId('notification-count')).not.toBeInTheDocument();
  });

  it('opens the panel with the list: unread ones marked in words, with no axe violations', async () => {
    const user = userEvent.setup();
    renderApp(<NotificationBell />);
    await user.click(await screen.findByRole('button', { name: /^Notifications/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    const list = await within(panel).findByTestId('notification-list');
    const items = within(list).getAllByRole('listitem');
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent('Unread: Low stock: Toner HP 26A');
    // the name of the type, from the type the API sent
    expect(items[0]).toHaveTextContent('Low stock');
    expect(items[1]).toHaveTextContent('Loan overdue');
    expect(items[3]).not.toHaveTextContent('Unread');
    expect(within(panel).getByRole('link', { name: 'Notification settings' })).toHaveAttribute(
      'href',
      '/account/notifications',
    );
    await expectNoA11yViolations(panel);
  });

  it('marks one as read and the badge follows; Mark all as read clears the rest', async () => {
    const user = userEvent.setup();
    renderApp(<NotificationBell />);
    await user.click(await screen.findByRole('button', { name: 'Notifications, 3 unread' }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    await user.click(
      await within(panel).findByRole('button', {
        name: 'Mark as read: Import finished',
      }),
    );
    // the panel is modal, so the bell behind it is hidden from the accessibility tree
    await waitFor(() => expect(screen.getByTestId('notification-count')).toHaveTextContent('2'));
    expect(
      screen.getByRole('button', { name: 'Notifications, 2 unread', hidden: true }),
    ).toBeInTheDocument();
    await user.click(within(panel).getByRole('button', { name: 'Mark all as read' }));
    expect(await screen.findByText('All notifications marked as read.')).toBeVisible();
    await waitFor(() => expect(screen.queryByTestId('notification-count')).not.toBeInTheDocument());
    expect(within(panel).getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
    expect(
      within(panel).queryByRole('button', { name: /^Mark as read: / }),
    ).not.toBeInTheDocument();
  });

  it('shows only the unread ones when asked, and an empty state when there are none', async () => {
    const user = userEvent.setup();
    renderApp(<NotificationBell />);
    await user.click(await screen.findByRole('button', { name: /^Notifications/ }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    await within(panel).findByTestId('notification-list');
    await user.click(within(panel).getByRole('button', { name: 'Unread' }));
    await waitFor(() => expect(within(panel).getAllByRole('listitem')).toHaveLength(3));
    await user.click(within(panel).getByRole('button', { name: 'Mark all as read' }));
    expect(await within(panel).findByText('Nothing unread.')).toBeVisible();
    await expectNoA11yViolations(panel);
  });

  it('follows a notification to what it is about and marks it read', async () => {
    const user = userEvent.setup();
    renderApp(<NotificationBell />);
    await user.click(await screen.findByRole('button', { name: 'Notifications, 3 unread' }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    await user.click(
      await within(panel).findByRole('button', { name: 'View: Low stock: Toner HP 26A' }),
    );
    // the notification's own link is the API's consumables list; the app opens the item instead
    expect(router.push).toHaveBeenCalledWith(
      '/stock/view?kind=consumable&id=0190a6b2-00a2-7000-8000-000000000002',
    );
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 2 unread' })).toBeInTheDocument(),
    );
  });

  it('says so, with a way to retry, when the list cannot be loaded', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/v1/notifications', () => HttpResponse.json({}, { status: 500 })),
      http.get('/v1/notifications/unread-count', () => HttpResponse.json({ count: 0 })),
    );
    renderApp(<NotificationBell />);
    await user.click(await screen.findByRole('button', { name: 'Notifications' }));
    const panel = await screen.findByRole('dialog', { name: 'Notifications' });
    expect(await within(panel).findByRole('alert')).toHaveTextContent(
      'We could not load your notifications.',
    );
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeVisible();
  });
});

describe('NotificationSettingsScreen', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists every type with how the user hears about it, with no axe violations', async () => {
    const { container } = renderApp(<NotificationSettingsScreen />);
    const table = await screen.findByRole('table', { name: 'Notification delivery by type' });
    // the header and the eight types of the API, with the API's own label and description
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    expect(
      within(table).getByText('A consumable fell to or below its reorder level.'),
    ).toBeVisible();
    expect(within(table).getByRole('combobox', { name: 'E-mail for Low stock' })).toHaveTextContent(
      'Daily summary',
    );
    expect(
      within(table).getByRole('combobox', { name: 'E-mail for Loan overdue' }),
    ).toHaveTextContent('Right away');
    expect(
      within(table).getByRole('checkbox', { name: 'Show Low stock in the bell' }),
    ).toBeChecked();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    await expectNoA11yViolations(container);
  });

  it('saves the changes together and keeps them', async () => {
    const user = userEvent.setup();
    const view = renderApp(<NotificationSettingsScreen />);
    await user.click(await screen.findByRole('combobox', { name: 'E-mail for Low stock' }));
    await user.click(await screen.findByRole('option', { name: 'Off' }));
    expect(await screen.findByText('You have unsaved changes.')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Show Loan overdue in the bell' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Notification settings saved.')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled(),
    );
    view.unmount();

    renderApp(<NotificationSettingsScreen />);
    expect(await screen.findByRole('combobox', { name: 'E-mail for Low stock' })).toHaveTextContent(
      'Off',
    );
    expect(
      screen.getByRole('checkbox', { name: 'Show Loan overdue in the bell' }),
    ).not.toBeChecked();
    // the untouched one still has its default
    expect(screen.getByRole('checkbox', { name: 'Show Low stock in the bell' })).toBeChecked();
  });

  it('says so when the settings cannot be loaded or saved', async () => {
    const user = userEvent.setup();
    server.use(
      http.get('/v1/notification-preferences', () => HttpResponse.json({}, { status: 500 })),
    );
    const failed = renderApp(<NotificationSettingsScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not load your notification settings.',
    );
    failed.unmount();

    server.resetHandlers();
    server.use(
      http.put('/v1/notification-preferences/:type', () =>
        HttpResponse.json(
          {
            type: 'x',
            title: 'Server error',
            status: 500,
            code: 'internal',
            request_id: 'req-500-pref',
          },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderApp(<NotificationSettingsScreen />);
    await user.click(await screen.findByRole('combobox', { name: 'E-mail for Low stock' }));
    await user.click(await screen.findByRole('option', { name: 'Off' }));
    await user.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('We could not save your settings.')).toBeVisible();
    // the choice is still there to try again
    expect(screen.getByRole('combobox', { name: 'E-mail for Low stock' })).toHaveTextContent('Off');
  });
});
