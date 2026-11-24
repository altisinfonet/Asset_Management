import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVED_VIEWS_KEY } from '@/lib/registry/asset-view';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetsTable } from './assets-table';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function loaded() {
  await waitFor(() => expect(screen.getByTestId('assets-range')).toHaveTextContent('of'));
}

describe('AssetsTable: custody columns, filters and bulk actions (M2)', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.removeItem(SAVED_VIEWS_KEY);
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('shows who holds each asset in the Assigned to column, with an overdue mark', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    expect(screen.getByRole('columnheader', { name: 'Assigned to' })).toBeVisible();
    await user.click(screen.getByRole('combobox', { name: 'Custody' }));
    await user.click(await screen.findByRole('option', { name: 'Checked out' }));
    await waitFor(() => expect(screen.getByTestId('assets-range')).not.toHaveTextContent('of 195'));
    const rows = await screen.findAllByRole('row');
    const withHolder = rows.filter((row) => within(row).queryAllByRole('link').length > 1);
    expect(withHolder.length).toBeGreaterThan(1);
    expect(screen.getAllByText('Overdue').length).toBeGreaterThan(0);
  });

  it('filters to what is in stock, and to what one person holds', async () => {
    const user = userEvent.setup();
    const held = (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 })).data[0]!;
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(screen.getByRole('combobox', { name: 'Custody' }));
    await user.click(await screen.findByRole('option', { name: 'In stock' }));
    await waitFor(() => expect(screen.getByTestId('assets-range')).not.toHaveTextContent('of 195'));
    expect(screen.queryByRole('row', { name: new RegExp(held.asset_tag) })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Clear all filters' }));

    const holder = held.current_assignment!.target_name!;
    await user.type(screen.getByRole('combobox', { name: 'Held by' }), holder);
    await user.click(await screen.findByRole('option', { name: new RegExp(holder) }));
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), held.asset_tag);
    expect(await screen.findByRole('row', { name: new RegExp(held.asset_tag) })).toBeVisible();
  });

  it('the location filter is a picker with an include-sublocations switch', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByRole('combobox', { name: 'Location' }), 'Main building');
    await user.click(await screen.findByRole('option', { name: /^Main building/ }));
    await waitFor(() => expect(screen.getByTestId('assets-range')).toHaveTextContent('of'));
    const withChildren = screen.getByTestId('assets-range').textContent;
    const toggle = screen.getByRole('checkbox', { name: 'Include sublocations' });
    expect(toggle).toBeChecked();
    await user.click(toggle);
    // the assets sit in the rooms below the building, not in the building itself
    await screen.findByRole('heading', { name: 'No assets match' });
    expect(screen.getByTestId('assets-range')).not.toHaveTextContent(withChildren ?? '');
  });

  it('bulk Check in counts only the selected assets that are out, and opens the dialog for them', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(screen.getByRole('combobox', { name: 'Custody' }));
    await user.click(await screen.findByRole('option', { name: 'Checked out' }));
    await waitFor(() => expect(screen.getByTestId('assets-range')).not.toHaveTextContent('of 195'));
    const boxes = await screen.findAllByRole('checkbox', { name: /^Select row/ });
    await user.click(boxes[0]!);
    await user.click(boxes[1]!);
    expect(screen.getByRole('button', { name: 'Check out (0)' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Check in (2)' }));
    expect(await screen.findByRole('dialog', { name: 'Check in 2 assets' })).toBeVisible();
  });

  it('starts filtered by a deep link from the locations screen', async () => {
    window.history.pushState({}, '', '/assets/?location=0190a6b2-0007-7000-8000-000000000002');
    renderApp(<AssetsTable />, { workflows: true });
    await waitFor(() =>
      expect(screen.getByRole('combobox', { name: 'Location' })).toHaveValue('Main building'),
    );
    await waitFor(() => expect(screen.getByTestId('assets-range')).toHaveTextContent('of 195'));
  });

  it('starts filtered by the dashboard tiles: state type, checked out and overdue', async () => {
    const total = async (query: Parameters<typeof assetsApi.list>[0]) =>
      (await assetsApi.list({ ...query, limit: 1, include_total: true })).page.total!;
    const repair = await total({ state_type: ['undeployable'] });
    window.history.pushState({}, '', '/assets/?state_type=undeployable');
    const first = renderApp(<AssetsTable />, { workflows: true });
    await waitFor(() =>
      expect(screen.getByTestId('assets-range')).toHaveTextContent(`of ${repair}`),
    );
    expect(screen.getByRole('combobox', { name: 'State' })).toHaveTextContent('Not deployable');
    first.unmount();

    const overdue = await total({ overdue: true });
    window.history.pushState({}, '', '/assets/?overdue=1');
    const second = renderApp(<AssetsTable />, { workflows: true });
    await waitFor(() =>
      expect(screen.getByTestId('assets-range')).toHaveTextContent(`of ${overdue}`),
    );
    expect(screen.getByRole('checkbox', { name: 'Overdue only' })).toBeChecked();
    second.unmount();

    const assigned = await total({ assigned: true });
    window.history.pushState({}, '', '/assets/?assigned=yes');
    renderApp(<AssetsTable />, { workflows: true });
    await waitFor(() =>
      expect(screen.getByTestId('assets-range')).toHaveTextContent(`of ${assigned}`),
    );
    expect(screen.getByRole('combobox', { name: 'Custody' })).toHaveTextContent('Checked out');
  });

  it('sorts by Assigned to, Due back and Location from the headers; assets without a value come last either way (M2-REG-03)', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const dialog = await screen.findByRole('dialog', { name: 'Columns' });
    await user.click(within(dialog).getByRole('checkbox', { name: 'Due back' }));
    await user.keyboard('{Escape}');

    const header = (name: string) => screen.getByRole('columnheader', { name: new RegExp(name) });
    for (const name of ['Assigned to', 'Due back', 'Location']) {
      await user.click(within(header(name)).getByRole('button'));
      await waitFor(() => expect(header(name)).toHaveAttribute('aria-sort', 'ascending'));
      await user.click(within(header(name)).getByRole('button'));
      await waitFor(() => expect(header(name)).toHaveAttribute('aria-sort', 'descending'));
    }

    // the mock mirrors the API: empty values last in both directions
    const dueOf = async (sort: 'due' | '-due') =>
      (await assetsApi.list({ sort: [sort], limit: 200 })).data.map(
        (a) => a.current_assignment?.expected_return ?? null,
      );
    for (const sort of ['due', '-due'] as const) {
      const dues = await dueOf(sort);
      const firstEmpty = dues.indexOf(null);
      expect(firstEmpty).toBeGreaterThan(0);
      expect(dues.slice(firstEmpty).every((d) => d === null)).toBe(true);
      const filled = dues.slice(0, firstEmpty) as string[];
      expect(filled).toEqual(
        [...filled].sort(sort === 'due' ? undefined : (a, b) => (a < b ? 1 : -1)),
      );
    }
  });
});
