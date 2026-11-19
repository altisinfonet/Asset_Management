import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SAVED_VIEWS_KEY, defaultViewState } from '@/lib/registry/asset-view';
import { MIGRATED_KEY, toDefinition } from '@/lib/views/convert';
import { savedViewsApi } from '@/lib/views/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { server } from '@/mocks/server';
import { setMockExportDelay } from '@/mocks/w2-misc-handlers';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetsTable } from './assets-table';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function loaded() {
  await waitFor(() => expect(screen.getByTestId('assets-range')).toHaveTextContent('of'));
}

const viewSelect = () => screen.findByRole('combobox', { name: 'View' });

describe('AssetsTable: saved views on the server', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists the shared view, marks it as shared and applies its filters and columns', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(await viewSelect());
    await user.click(await screen.findByRole('option', { name: 'Teacher devices (shared)' }));
    await waitFor(
      () => expect(screen.getByTestId('assets-range')).toHaveTextContent('Showing 1-39 of 39'),
      { timeout: 5000 },
    );
    expect(screen.queryByRole('columnheader', { name: 'Assigned to' })).not.toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Location' })).toBeVisible();
    expect(screen.getByText('shared by Sam Lee')).toBeVisible();
    // only the owner of a view changes it (the API answers 404 to everybody else), also an administrator
    expect(screen.queryByRole('button', { name: 'Rename or share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update view' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete view' })).not.toBeInTheDocument();
  });

  it('saves the current state as a personal view that survives a reload', async () => {
    const user = userEvent.setup();
    const first = renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
    await screen.findByText('Showing 1-10 of 10', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this view' });
    expect(dialog).toHaveTextContent('to your account');
    await expectNoA11yViolations(dialog);
    await user.type(within(dialog).getByRole('textbox', { name: /^View name/ }), 'Projectors');
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }));
    expect(await screen.findByText('View "Projectors" saved.')).toBeVisible();
    expect(await viewSelect()).toHaveTextContent('Projectors');
    first.unmount();

    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(await viewSelect());
    await user.click(await screen.findByRole('option', { name: 'Projectors' }));
    await waitFor(
      () => expect(screen.getByTestId('assets-range')).toHaveTextContent('Showing 1-10 of 10'),
      { timeout: 5000 },
    );
    expect(screen.getByPlaceholderText('Tag, serial or name')).toHaveValue('PRJ-');
  });

  it('shares a view with the organisation, renames it, updates it and deletes it', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    let dialog = await screen.findByRole('dialog', { name: 'Save this view' });
    await user.type(within(dialog).getByRole('textbox', { name: /^View name/ }), 'Everything');
    await user.click(within(dialog).getByRole('checkbox', { name: /Share with everyone/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save view' }));
    expect(await screen.findByText('View "Everything" saved.')).toBeVisible();
    expect(await viewSelect()).toHaveTextContent('Everything (shared)');

    await user.click(screen.getByRole('button', { name: 'Rename or share' }));
    dialog = await screen.findByRole('dialog', { name: 'Edit view "Everything"' });
    const name = within(dialog).getByRole('textbox', { name: /^View name/ });
    await user.clear(name);
    await user.type(name, 'All kit');
    await user.click(within(dialog).getByRole('checkbox', { name: /Share with everyone/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(await viewSelect()).toHaveTextContent('All kit');
    expect(await viewSelect()).not.toHaveTextContent('shared');

    // narrow the list, then update the view with it
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'TAB-');
    await screen.findByText('Showing 1-19 of 19', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Update view' }));
    expect(
      await screen.findByText('View "All kit" now uses the current search, filters and columns.'),
    ).toBeVisible();
    const stored = (await savedViewsApi.list()).find((v) => v.name === 'All kit')!;
    expect(stored.filters).toMatchObject({ q: 'TAB-' });

    await user.click(screen.getByRole('button', { name: 'Delete view' }));
    const confirm = await screen.findByRole('dialog', { name: 'Delete view "All kit"?' });
    await user.click(within(confirm).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('View deleted.')).toBeVisible();
    await waitFor(async () =>
      expect((await savedViewsApi.list()).map((v) => v.name)).toEqual(['Teacher devices']),
    );
    expect(await viewSelect()).toHaveTextContent('All assets');
  });

  it('refuses a name the user already has, on the field', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    for (const attempt of [1, 2]) {
      await user.click(screen.getByRole('button', { name: 'Save view' }));
      const dialog = await screen.findByRole('dialog', { name: 'Save this view' });
      await user.type(within(dialog).getByRole('textbox', { name: /^View name/ }), 'Mine');
      await user.click(within(dialog).getByRole('button', { name: 'Save view' }));
      if (attempt === 2) {
        expect(await within(dialog).findByText('This value is already in use.')).toBeVisible();
      } else {
        await screen.findByText('View "Mine" saved.');
      }
    }
  });

  it('lets a viewer use the shared view but not change it or share their own', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(await viewSelect());
    await user.click(await screen.findByRole('option', { name: 'Teacher devices (shared)' }));
    await waitFor(
      () => expect(screen.getByTestId('assets-range')).toHaveTextContent('Showing 1-39 of 39'),
      { timeout: 5000 },
    );
    expect(screen.queryByRole('button', { name: 'Rename or share' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete view' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save view' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save this view' });
    expect(
      within(dialog).queryByRole('checkbox', { name: /Share with everyone/ }),
    ).not.toBeInTheDocument();
  });

  it('applies a view whose status was deleted, without that filter, and says so', async () => {
    const user = userEvent.setup();
    const state = {
      ...defaultViewState(),
      status_id: '0190a6b2-0003-7000-8000-999999999999',
      category_id: '0190a6b2-0001-7000-8000-000000000003',
    };
    await savedViewsApi.create({ name: 'Stale tablets', ...toDefinition(state) });
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.click(await viewSelect());
    await user.click(await screen.findByRole('option', { name: 'Stale tablets' }));
    const warning = await screen.findByText('Some parts of "Stale tablets" no longer exist');
    expect(warning).toBeVisible();
    expect(screen.getByText('They were left out of the filters: a status.')).toBeVisible();
    // the category part still applies: the 19 live tablets, not zero and not everything
    await waitFor(
      () => expect(screen.getByTestId('assets-range')).toHaveTextContent('Showing 1-19 of 19'),
      { timeout: 5000 },
    );
    await expectNoA11yViolations(document.body);
  });

  it('moves the views kept in this browser to the account, once', async () => {
    window.localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([
        {
          id: 'view-a',
          name: 'Old laptops',
          state: { ...defaultViewState(), category_id: '0190a6b2-0001-7000-8000-000000000002' },
        },
        {
          id: 'view-b',
          name: 'Old tablets',
          state: { ...defaultViewState(), category_id: '0190a6b2-0001-7000-8000-000000000003' },
        },
      ]),
    );
    const first = renderApp(<AssetsTable />, { workflows: true });
    expect(
      await screen.findByText('Moved 2 saved views from this browser to your account.'),
    ).toBeVisible();
    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).toBeNull();
    expect(window.localStorage.getItem(MIGRATED_KEY)).toBeTruthy();
    const names = (await savedViewsApi.list()).map((v) => v.name).sort();
    expect(names).toEqual(['Old laptops', 'Old tablets', 'Teacher devices']);
    first.unmount();

    // a second load finds nothing left to move, so nothing is duplicated
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    expect(screen.queryByText(/Moved \d+ saved view/)).not.toBeInTheDocument();
    expect((await savedViewsApi.list()).filter((v) => v.name === 'Old laptops')).toHaveLength(1);
  });

  it('keeps the local views and tells the user when they could not be moved', async () => {
    window.localStorage.setItem(
      SAVED_VIEWS_KEY,
      JSON.stringify([{ id: 'view-a', name: 'Old laptops', state: defaultViewState() }]),
    );
    server.use(http.post('/v1/saved-views', () => HttpResponse.json({}, { status: 500 })));
    renderApp(<AssetsTable />, { workflows: true });
    expect(await screen.findByText(/could not be moved yet/)).toBeVisible();
    expect(window.localStorage.getItem(SAVED_VIEWS_KEY)).not.toBeNull();
    expect(window.localStorage.getItem(MIGRATED_KEY)).toBeNull();
  });

  it('keeps the list usable when the views cannot be loaded', async () => {
    server.use(http.get('/v1/saved-views', () => HttpResponse.json({}, { status: 500 })));
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    expect(await screen.findByText('We could not load the saved views.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save view' })).toBeEnabled();
  });
});

describe('AssetsTable: CSV export and labels', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
    seedSession(MOCK_ACCOUNTS.owner);
    setMockExportDelay(50);
  });

  it('exports what the filters show: starts a job, shows progress and offers the download', async () => {
    const user = userEvent.setup();
    let sent: unknown;
    server.events.on('request:start', async ({ request }) => {
      if (request.method === 'POST' && new URL(request.url).pathname === '/v1/exports') {
        sent = await request.clone().json();
      }
    });
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
    await screen.findByText('Showing 1-10 of 10', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export to CSV' });
    expect(
      await within(dialog).findByText(/Preparing your file|Starting the export/),
    ).toBeVisible();
    await expectNoA11yViolations(dialog);
    const download = await within(dialog).findByRole(
      'link',
      { name: 'Download CSV' },
      { timeout: 4000 },
    );
    expect(download).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/mock-storage\/exports\/.+\.csv$/),
    );
    expect(within(dialog).getByTestId('export-status')).toHaveTextContent('10 rows exported.');
    // the list's filters as flat members, never its paging or presentation
    expect(sent).toEqual({ resource: 'assets', filters: { q: 'PRJ-', archived: 'exclude' } });
    await expectNoA11yViolations(dialog);
  });

  it('says so when the export fails and starts again on request', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'fail');
    await screen.findByRole('heading', { name: 'No assets match' });
    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    const dialog = await screen.findByRole('dialog', { name: 'Export to CSV' });
    expect(
      await within(dialog).findByText('The export failed.', {}, { timeout: 4000 }),
    ).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Start again' })).toBeEnabled();
    expect(within(dialog).queryByRole('link', { name: 'Download CSV' })).not.toBeInTheDocument();
  });

  it('hides the export from someone without export:run, and the labels from someone who cannot print', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    // viewers read assets but hold neither export:run nor asset:label
    expect(screen.queryByRole('button', { name: 'Export CSV' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Print labels for this filter' }),
    ).not.toBeInTheDocument();
  });

  it('gives the export to a manager, who holds export:run', async () => {
    seedSession(MOCK_ACCOUNTS.manager);
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeVisible();
  });

  it('prints labels for the current filter and for a selection', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await loaded();
    await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
    await screen.findByText('Showing 1-10 of 10', {}, { timeout: 5000 });
    await user.click(screen.getByRole('button', { name: 'Print labels for this filter' }));
    let dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    await waitFor(() =>
      expect(within(dialog).getByTestId('labels-source')).toHaveTextContent(
        '10 assets match the current filter',
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());

    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00010' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00009' }));
    await user.click(screen.getByRole('button', { name: 'Print labels (2)' }));
    dialog = await screen.findByRole('dialog', { name: 'Print labels' });
    expect(within(dialog).getByTestId('labels-source')).toHaveTextContent('2 selected assets');
  });
});
