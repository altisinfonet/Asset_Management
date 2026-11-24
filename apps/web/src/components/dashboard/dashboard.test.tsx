import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { repairsApi } from '@/lib/repairs/api';
import { accessoriesApi, consumablesApi } from '@/lib/stock/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { Dashboard } from './dashboard';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/** Permissions to withhold from the signed-in user (the mock roles all hold every read permission). */
const withheld = vi.hoisted(() => ({ list: [] as string[] }));
vi.mock('@/lib/auth/auth-context', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/auth/auth-context')>();
  return {
    ...original,
    useAuth: () => {
      const auth = original.useAuth();
      return {
        ...auth,
        can: (permission: string | readonly string[] | undefined) => {
          const wanted = typeof permission === 'string' ? [permission] : [...(permission ?? [])];
          return auth.can(permission) && !wanted.every((p) => withheld.list.includes(p));
        },
      };
    },
  };
});

const tile = (id: string) => screen.getByTestId(`tile-${id}`);

describe('Dashboard', () => {
  beforeEach(() => {
    resetRouter();
    withheld.list = [];
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('shows the four counts from the API, each a link to the asset list with the same filter', async () => {
    const [ready, assigned, inRepair, overdue] = await Promise.all([
      assetsApi.list({ state_type: ['deployable'], limit: 1, include_total: true }),
      assetsApi.list({ assigned: true, limit: 1, include_total: true }),
      assetsApi.list({ state_type: ['undeployable'], limit: 1, include_total: true }),
      assetsApi.list({ overdue: true, limit: 1, include_total: true }),
    ]);
    expect(ready.page.total).toBeGreaterThan(0);
    expect(assigned.page.total).toBeGreaterThan(0);
    expect(overdue.page.total).toBeGreaterThan(0);

    const { container } = renderApp(<Dashboard />);
    await waitFor(() => expect(tile('ready')).toHaveTextContent(String(ready.page.total)));
    expect(tile('ready')).toHaveTextContent('Ready');
    expect(tile('assigned')).toHaveTextContent(`${assigned.page.total}Assigned`);
    expect(tile('inRepair')).toHaveTextContent(`${inRepair.page.total}In repair`);
    expect(tile('overdue')).toHaveTextContent(`${overdue.page.total}Overdue`);
    expect(tile('ready')).toHaveAttribute('href', '/assets?state_type=deployable');
    expect(tile('assigned')).toHaveAttribute('href', '/assets?assigned=yes');
    expect(tile('inRepair')).toHaveAttribute('href', '/assets?state_type=undeployable');
    expect(tile('overdue')).toHaveAttribute('href', '/assets?overdue=1');
    // no skeleton is left behind
    await waitFor(() => expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0));
    await expectNoA11yViolations(container);
  });

  it('lists the overdue check-outs, the low stock and the open repairs, each row a link', async () => {
    renderApp(<Dashboard />);
    const overdue = await screen.findByTestId('panel-overdue');
    const overdueTotal = (await assetsApi.list({ overdue: true, limit: 1, include_total: true }))
      .page.total!;
    await waitFor(() => expect(within(overdue).getAllByRole('listitem').length).toBeGreaterThan(0));
    expect(within(overdue).getAllByRole('listitem').length).toBeLessThanOrEqual(5);
    const first = within(overdue).getAllByRole('link')[1]!;
    expect(first).toHaveAttribute('href', expect.stringMatching(/^\/assets\/view\?id=/));
    expect(first).toHaveTextContent(/Held by .*Due /);
    expect(
      within(overdue).getByRole('link', { name: 'View all: Overdue check-outs' }),
    ).toHaveAttribute('href', '/assets?overdue=1');
    expect(overdue).toHaveTextContent(String(overdueTotal));

    const stock = await screen.findByTestId('panel-stock');
    const lowAccessories = await accessoriesApi.list({ low_stock: true, include_total: true });
    const lowConsumables = await consumablesApi.list({ low_stock: true, include_total: true });
    await waitFor(() =>
      expect(within(stock).getAllByRole('listitem').length).toBe(
        Math.min(5, lowAccessories.data.length + lowConsumables.data.length),
      ),
    );
    const lowest = lowAccessories.data[0]!;
    expect(within(stock).getByRole('link', { name: new RegExp(lowest.name) })).toHaveAttribute(
      'href',
      `/stock/view?kind=accessory&id=${lowest.id}`,
    );
    expect(stock).toHaveTextContent(/(Low|Out of) stock: \d+ left, minimum \d+/);

    const repairs = await screen.findByTestId('panel-repairs');
    const open = await repairsApi.list({ status: ['open', 'in_progress'], include_total: true });
    await waitFor(() =>
      expect(within(repairs).getAllByRole('listitem').length).toBe(Math.min(5, open.data.length)),
    );
    expect(repairs).toHaveTextContent(String(open.page.total));
    expect(within(repairs).getAllByRole('link')[1]).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/repairs\?id=/),
    );
  });

  it('shows friendly empty states when nothing needs attention', async () => {
    const empty = (total: number) => HttpResponse.json({ data: [], page: { total } });
    server.use(
      http.get('/v1/assets', ({ request }) => {
        const params = new URL(request.url).searchParams;
        return params.get('overdue') === 'true'
          ? empty(0)
          : HttpResponse.json({ data: [], page: { total: 7 } });
      }),
      http.get('/v1/accessories', () => empty(0)),
      http.get('/v1/consumables', () => empty(0)),
      http.get('/v1/repairs', () => empty(0)),
    );
    const { container } = renderApp(<Dashboard />);
    expect(await screen.findByText(/Nothing is overdue/)).toBeVisible();
    expect(await screen.findByText(/Nothing is running low/)).toBeVisible();
    expect(await screen.findByText(/No repairs are open/)).toBeVisible();
    await waitFor(() => expect(tile('ready')).toHaveTextContent('7'));
    expect(tile('overdue')).toHaveTextContent('0');
    // no "View all" when there is nothing to view
    expect(screen.queryByRole('link', { name: /View all/ })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('shows skeletons while loading, then resolves them', async () => {
    server.use(
      http.get('/v1/assets', async () => {
        await delay(300);
        return undefined;
      }),
    );
    const { container } = renderApp(<Dashboard />);
    // the screen waits for the session before it knows what to show
    await waitFor(() => expect(tile('ready')).toHaveAttribute('aria-busy', 'true'));
    expect(container.querySelectorAll('[data-skeleton]').length).toBeGreaterThan(0);
    await waitFor(() => expect(container.querySelectorAll('[data-skeleton]')).toHaveLength(0));
    expect(tile('ready')).toHaveAttribute('aria-busy', 'false');
  });

  it('hides the panels and tiles the user may not read', async () => {
    withheld.list = ['repair:read', 'accessory:read', 'consumable:read'];
    renderApp(<Dashboard />);
    expect(await screen.findByTestId('panel-overdue')).toBeVisible();
    expect(screen.getByTestId('tile-ready')).toBeVisible();
    expect(screen.queryByTestId('panel-repairs')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-stock')).not.toBeInTheDocument();
  });

  it('shows the low-stock panel when only one of the two stock permissions is held', async () => {
    withheld.list = ['consumable:read'];
    renderApp(<Dashboard />);
    expect(await screen.findByTestId('panel-stock')).toBeVisible();
  });

  it('without asset access, shows only the panels left (and no tiles)', async () => {
    withheld.list = ['asset:read'];
    renderApp(<Dashboard />);
    expect(await screen.findByTestId('panel-repairs')).toBeVisible();
    expect(screen.queryByTestId('tile-ready')).not.toBeInTheDocument();
    expect(screen.queryByTestId('panel-overdue')).not.toBeInTheDocument();
  });

  it('with no read permission at all, says so instead of showing empty cards', async () => {
    withheld.list = ['asset:read', 'repair:read', 'accessory:read', 'consumable:read'];
    renderApp(<Dashboard />);
    expect(await screen.findByText(/no dashboard summaries/)).toBeVisible();
    expect(screen.queryByTestId('tile-ready')).not.toBeInTheDocument();
  });

  it('shows an error with a retry for the counts and for a panel, and recovers', async () => {
    const user = userEvent.setup();
    let failing = true;
    server.use(
      // once `failing` is off the handlers answer nothing and the mock API takes over
      http.get('/v1/assets', () =>
        failing ? HttpResponse.json({ title: 'boom' }, { status: 500 }) : undefined,
      ),
      http.get('/v1/repairs', () =>
        failing ? HttpResponse.json({ title: 'boom' }, { status: 500 }) : undefined,
      ),
    );
    renderApp(<Dashboard />);
    expect(await screen.findByText('We could not load some of the counts.')).toBeVisible();
    expect(tile('ready')).toHaveTextContent('unavailable');
    const repairs = screen.getByTestId('panel-repairs');
    expect(await within(repairs).findByText('We could not load this.')).toBeVisible();

    failing = false;
    await user.click(
      within(screen.getByTestId('panel-repairs')).getByRole('button', { name: 'Try again' }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByTestId('panel-repairs')).queryByText('We could not load this.'),
      ).toBeNull(),
    );
    const retry = screen.getAllByRole('button', { name: 'Try again' })[0]!;
    await user.click(retry);
    await waitFor(() =>
      expect(screen.queryByText('We could not load some of the counts.')).not.toBeInTheDocument(),
    );
    expect(tile('ready')).not.toHaveTextContent('unavailable');
  });
});
