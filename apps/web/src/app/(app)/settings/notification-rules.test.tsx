import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notificationsApi } from '@/lib/notifications/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { NotificationRulesScreen } from './notification-rules-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

describe('NotificationRulesScreen', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists every type with who gets it and whether it is on, with no axe violations', async () => {
    const { container } = renderApp(<NotificationRulesScreen />);
    const table = await screen.findByRole('table', { name: 'Notification rules by type' });
    expect(within(table).getAllByRole('row')).toHaveLength(9);
    const low = within(table).getByRole('row', { name: /Low stock/ });
    expect(low).toHaveTextContent('Users who manage consumables.');
    expect(within(low).getByRole('checkbox', { name: 'Send Low stock' })).toBeChecked();
    await expectNoA11yViolations(container);
  });

  it('turns a type off for the organisation as soon as it is changed, and keeps it', async () => {
    const user = userEvent.setup();
    const view = renderApp(<NotificationRulesScreen />);
    await user.click(await screen.findByRole('checkbox', { name: 'Send Low stock' }));
    expect(await screen.findByText('Low stock is off.')).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole('checkbox', { name: 'Send Low stock' })).not.toBeChecked(),
    );
    const rule = (await notificationsApi.rules()).find((r) => r.type === 'consumable.low_stock');
    expect(rule).toMatchObject({ enabled: false, updated_at: expect.any(String) });
    view.unmount();

    renderApp(<NotificationRulesScreen />);
    expect(await screen.findByRole('checkbox', { name: 'Send Low stock' })).not.toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: 'Send Low stock' }));
    expect(await screen.findByText('Low stock is on.')).toBeVisible();
  });

  it('says so when the rules cannot be loaded or changed', async () => {
    const user = userEvent.setup();
    server.use(http.get('/v1/notification-rules', () => HttpResponse.json({}, { status: 500 })));
    const failed = renderApp(<NotificationRulesScreen />);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'We could not load the notification rules.',
    );
    failed.unmount();

    server.resetHandlers();
    server.use(
      http.put('/v1/notification-rules/:type', () =>
        HttpResponse.json(
          { type: 'x', title: 'Server error', status: 500, code: 'internal', request_id: 'r-1' },
          { status: 500, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    renderApp(<NotificationRulesScreen />);
    await user.click(await screen.findByRole('checkbox', { name: 'Send Low stock' }));
    expect(await screen.findByText('We could not change the rule.')).toBeVisible();
    expect(screen.getByRole('checkbox', { name: 'Send Low stock' })).toBeChecked();
  });
});
