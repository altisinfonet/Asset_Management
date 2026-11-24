import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { uid } from '@/mocks/registry-fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { SAVED_VIEWS_KEY } from '@/lib/registry/asset-view';
import { AssetsTable } from './assets-table';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const range = () => screen.findByTestId('assets-range');

async function loaded() {
  await waitFor(() => expect(screen.getByTestId('assets-range')).toHaveTextContent('of'));
}

describe('AssetsTable against the mock registry', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.removeItem(SAVED_VIEWS_KEY);
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('loads the first page of 50 with the total, resolving ids to names', async () => {
    const { container } = renderApp(<AssetsTable />, { workflows: true });
    expect(await range()).toHaveTextContent('Showing 1-50 of 195');
    const row = await screen.findByRole('row', { name: /PRJ-00010/ });
    expect(within(row).getAllByText('EB-992F').length).toBe(2); // name and model, resolved from the lookups
    expect(within(row).getByText(/Riverside Elementary > Main building > /)).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('sorts by the tag column through the server and pages with cursors', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(within(screen.getByRole('columnheader', { name: /Tag/ })).getByRole('button'));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Tag/ })).toHaveAttribute(
        'aria-sort',
        'ascending',
      ),
    );
    await screen.findByRole('row', { name: /AT-00001/ });
    await user.click(screen.getByRole('button', { name: 'Next page' }));
    expect(await screen.findByText('Showing 51-100 of 195')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Previous page' }));
    expect(await screen.findByText('Showing 1-50 of 195')).toBeVisible();
  });

  it('search narrows the list (debounced) and shows the filtered-empty state with a way out', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'LAP-0002');
    expect(await screen.findByText('Showing 1-10 of 10')).toBeVisible();
    await user.clear(screen.getByPlaceholderText('Tag, serial or name'));
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'zzzz');
    expect(await screen.findByRole('heading', { name: 'No assets match' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Clear all filters' })[0]!);
    expect(await screen.findByText('Showing 1-50 of 195')).toBeVisible();
  });

  it('keyboard: Space selects a row, Enter opens the full page, a click opens the drawer', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    const row = await screen.findByRole('row', { name: /PRJ-00010/ });
    row.focus();
    await user.keyboard(' ');
    expect(row).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText('1 row selected')).toBeVisible();
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/assets\/view\?id=/));

    await user.click(screen.getByRole('row', { name: /PRJ-00009/ }));
    const drawer = await screen.findByRole('dialog');
    expect(await within(drawer).findByText('Lamp hours')).toBeVisible();
    expect(within(drawer).getByRole('link', { name: 'Open full page' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/assets\/view\?id=/),
    );
  });

  it('bulk archive asks first, lists the tags, and removes the rows from the active list', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
    expect(await screen.findByText('Showing 1-10 of 10')).toBeVisible();
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00010' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00009' }));
    await user.click(screen.getByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive 2 assets?' });
    expect(dialog).toHaveTextContent('PRJ-00010, PRJ-00009');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Showing 1-8 of 8')).toBeVisible();
    expect(screen.queryByRole('row', { name: /PRJ-00010/ })).not.toBeInTheDocument();
  });

  it('shows a department column on request and filters by department with the picker', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Columns' }));
    const columns = await screen.findByRole('dialog', { name: 'Columns' });
    await user.click(within(columns).getByRole('checkbox', { name: 'Department' }));
    await user.keyboard('{Escape}');
    expect(await screen.findByRole('columnheader', { name: 'Department' })).toBeVisible();

    await user.click(screen.getByRole('combobox', { name: 'Department' }));
    await user.click(await screen.findByRole('option', { name: /^IT/ }));
    await waitFor(() => expect(screen.getByTestId('assets-range')).not.toHaveTextContent('of 195'));
    for (const row of screen.getAllByRole('row').slice(1)) expect(row).toHaveTextContent('IT');
  });

  it('bulk edit sets the department of the selected assets, or clears it', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
    await screen.findByText('Showing 1-10 of 10');
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00010' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00008' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit 2 assets' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Field' }));
    await user.click(await screen.findByRole('option', { name: 'Department' }));
    expect(within(dialog).getByRole('button', { name: 'Apply to 2 assets' })).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    await user.click(await screen.findByRole('option', { name: /^Library/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2 assets' }));
    expect(await screen.findByText('Done: 2 assets updated.')).toBeVisible();
    const { assetsApi } = await import('@/lib/registry/api');
    const library = uid('department', 5);
    expect((await assetsApi.list({ tag: 'PRJ-00010' })).data[0]!.department_id).toBe(library);

    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00010' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const again = await screen.findByRole('dialog', { name: 'Edit 1 asset' });
    await user.click(within(again).getByRole('combobox', { name: 'Field' }));
    await user.click(await screen.findByRole('option', { name: 'Department' }));
    await user.click(within(again).getByRole('checkbox', { name: 'No department (clear it)' }));
    await user.click(within(again).getByRole('button', { name: 'Apply to 1 asset' }));
    expect(await screen.findByText('Done: 1 asset updated.')).toBeVisible();
    expect((await assetsApi.list({ tag: 'PRJ-00010' })).data[0]!.department_id).toBeNull();
  });

  it('bulk edit reports the assets that failed instead of stopping at the first one', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
    await screen.findByText('Showing 1-10 of 10');
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00010' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00009' }));
    // PRJ-00009 is archived behind our back, so the bulk edit refuses that one item (409)
    const { assetsApi } = await import('@/lib/registry/api');
    const nine = (await assetsApi.list({ tag: 'PRJ-00009' })).data[0]!;
    await assetsApi.archive(nine.id);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit 2 assets' });
    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    await user.click(await screen.findByRole('option', { name: 'Out for fix' }));
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2 assets' }));
    const results = await screen.findByRole('dialog', { name: 'Edit results' });
    expect(results).toHaveTextContent('1 done, 1 failed.');
    expect(within(results).getByRole('list', { name: 'Assets that failed' })).toHaveTextContent(
      'PRJ-00009',
    );
  });
});
