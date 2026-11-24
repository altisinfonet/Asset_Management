import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { repairsApi } from '@/lib/repairs/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetView } from '../assets/view/asset-view';
import { RepairsScreen } from './repairs-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/** The asset picker of the log dialog: its label, then "(required)" with no space in the name. */
const ASSET_FIELD = /^Asset\(required\)/;

describe('RepairsScreen', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists the open repairs with counts, assets and the cost of what is shown, no axe violations', async () => {
    const { container } = renderApp(<RepairsScreen />);
    const first = await screen.findByRole('row', { name: /Cracked screen, replace/ });
    expect(first).toHaveTextContent('Open');
    expect(first).toHaveTextContent('$64.00');
    expect(screen.getByRole('row', { name: /Battery swap/ })).toHaveTextContent('In progress');
    expect(screen.queryByRole('row', { name: /Replace screen/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Open/ })).toHaveTextContent('16');
    await waitFor(() => expect(screen.getByRole('tab', { name: /Closed/ })).toHaveTextContent('2'));
    expect(screen.getByTestId('repairs-total')).toHaveTextContent(
      'Cost of the repairs shown: $86.00',
    );
    await expectNoA11yViolations(container);
  });

  it('switches to closed repairs and filters by kind, supplier and dates', async () => {
    const user = userEvent.setup();
    renderApp(<RepairsScreen />);
    await screen.findByRole('row', { name: /Cracked screen, replace/ });
    await user.click(screen.getByRole('tab', { name: /Closed/ }));
    expect(await screen.findByRole('row', { name: /Replace screen/ })).toHaveTextContent('Done');
    expect(screen.queryByRole('row', { name: /Cracked screen, replace/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole('combobox', { name: 'Kind' }));
    await user.click(await screen.findByRole('option', { name: 'Inspection' }));
    expect(await screen.findByRole('heading', { name: 'No repairs match' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await screen.findByRole('row', { name: /Replace screen/ })).toBeVisible();

    await user.click(screen.getByRole('tab', { name: 'All' }));
    expect(await screen.findByRole('row', { name: /Cracked screen, replace/ })).toBeVisible();
    expect(screen.getByRole('row', { name: /Replace screen/ })).toBeVisible();
    await user.type(screen.getByLabelText('Reported from'), '2099-01-01');
    expect(await screen.findByRole('heading', { name: 'No repairs match' })).toBeVisible();
  });

  it('opens a repair in a drawer from its title and writes the id to the URL', async () => {
    const user = userEvent.setup();
    renderApp(<RepairsScreen />);
    await user.click(
      await screen.findByRole('button', { name: 'Open repair Cracked screen, replace' }),
    );
    await waitFor(() =>
      expect(router.replace).toHaveBeenCalledWith(expect.stringMatching(/^\/repairs\?id=/)),
    );
  });

  it('shows a repair opened from the URL with its details and files, and starts, then closes it', async () => {
    const user = userEvent.setup();
    const open = (await repairsApi.list({ status: ['open'] })).data.find(
      (r) => r.title === 'Cracked screen, replace',
    )!;
    window.history.pushState({}, '', `/repairs?id=${open.id}`);
    renderApp(<RepairsScreen />);
    const drawer = await screen.findByRole('dialog', { name: 'Cracked screen, replace' });
    expect(await within(drawer).findByText('Reported')).toBeVisible();
    expect(
      within(drawer).getByRole('region', { name: 'Quotes, receipts and photos' }),
    ).toBeVisible();
    await expectNoA11yViolations(drawer);

    await user.click(within(drawer).getByRole('button', { name: 'Start work' }));
    expect(await screen.findByText('Repair marked in progress.')).toBeVisible();
    await waitFor(() =>
      expect(within(drawer).queryByRole('button', { name: 'Start work' })).toBeNull(),
    );

    await user.click(within(drawer).getByRole('button', { name: 'Close repair' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Close repair "Cracked screen, replace"',
    });
    await expectNoA11yViolations(dialog);
    const cost = within(dialog).getByRole('textbox', { name: /^Final cost/ });
    expect(cost).toHaveValue('64.00');
    await user.clear(cost);
    await user.type(cost, 'oops');
    await user.click(within(dialog).getByRole('button', { name: 'Close repair' }));
    expect(await within(dialog).findByText('Enter an amount such as 64.00.')).toBeVisible();
    await user.clear(cost);
    await user.type(cost, '70.5');
    await user.type(
      within(dialog).getByRole('textbox', { name: /^What was done/ }),
      'Replaced the panel',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Close repair' }));
    expect(await screen.findByText('Repair closed.')).toBeVisible();
    const done = (await repairsApi.get(open.id)).value;
    expect(done).toMatchObject({ status: 'completed', resolution_notes: 'Replaced the panel' });
    expect(done.cost).toEqual({ amount_minor: 7050, currency: 'USD' });
  });

  it('logs a repair for an asset with a supplier and a cost, then offers the files step', async () => {
    const user = userEvent.setup();
    const asset = (
      await assetsApi.list({
        state_type: ['deployable'],
        assigned: false,
        sort: ['-asset_tag'],
        limit: 1,
      })
    ).data[0]!;
    renderApp(<RepairsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Log repair' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a repair' });
    await user.click(within(dialog).getByRole('button', { name: 'Log repair' }));
    expect(await within(dialog).findByText('Choose the asset.')).toBeVisible();
    expect(within(dialog).getByText('Describe what needs doing.')).toBeVisible();
    await expectNoA11yViolations(dialog);

    await user.click(within(dialog).getByRole('combobox', { name: ASSET_FIELD }));
    await user.type(within(dialog).getByRole('combobox', { name: ASSET_FIELD }), asset.asset_tag);
    await user.click(await screen.findByRole('option', { name: new RegExp(asset.asset_tag) }));
    await user.type(
      within(dialog).getByRole('textbox', { name: /^What needs doing/ }),
      'Broken hinge',
    );
    await user.click(within(dialog).getByRole('combobox', { name: 'Supplier' }));
    await user.click(await screen.findByRole('option', { name: 'CDW' }));
    await user.type(within(dialog).getByRole('textbox', { name: /^Quoted cost/ }), '45');
    await user.click(within(dialog).getByRole('button', { name: 'Log repair' }));

    expect(await screen.findByText(`Repair logged for ${asset.asset_tag}.`)).toBeVisible();
    const files = await screen.findByRole('dialog', { name: 'Repair logged' });
    expect(within(files).getByRole('button', { name: /Browse|choose|Add/i })).toBeDefined();
    const moved = (await assetsApi.get(asset.id)).value;
    expect(moved.status_id).not.toBe(asset.status_id);
    const logged = (await repairsApi.list({ asset_id: asset.id })).data[0]!;
    expect(logged).toMatchObject({ title: 'Broken hinge', status: 'open' });
    expect(logged.cost).toEqual({ amount_minor: 4500, currency: 'USD' });
    await user.click(within(files).getByRole('button', { name: 'Done' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('refuses a checked-out asset with the server explanation and keeps the form', async () => {
    const user = userEvent.setup();
    const held = (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 })).data[0]!;
    renderApp(<RepairsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Log repair' }));
    const dialog = await screen.findByRole('dialog', { name: 'Log a repair' });
    await user.click(within(dialog).getByRole('combobox', { name: ASSET_FIELD }));
    await user.type(within(dialog).getByRole('combobox', { name: ASSET_FIELD }), held.asset_tag);
    await user.click(await screen.findByRole('option', { name: new RegExp(held.asset_tag) }));
    await user.type(within(dialog).getByRole('textbox', { name: /^What needs doing/ }), 'Broken');
    await user.click(within(dialog).getByRole('button', { name: 'Log repair' }));
    expect(
      await within(dialog).findByText(
        'The asset is checked out. Check it in first, or open the repair with force_checkin and a note.',
      ),
    ).toBeVisible();
    expect(within(dialog).getByRole('textbox', { name: /^What needs doing/ })).toHaveValue(
      'Broken',
    );
  });

  it('is read-only for someone without repair:manage', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<RepairsScreen />);
    await screen.findByRole('row', { name: /Cracked screen, replace/ });
    expect(screen.queryByRole('button', { name: 'Log repair' })).not.toBeInTheDocument();
  });
});

describe('Repairs tab of an asset', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  async function openTab(tag: string) {
    const asset = (await assetsApi.list({ tag })).data[0]!;
    window.history.pushState({}, '', `/assets/view?id=${asset.id}&tab=repairs`);
    return asset;
  }

  it('lists the asset repairs with their total cost and no placeholder', async () => {
    const done = (await repairsApi.list({ status: ['completed'] })).data.find(
      (r) => r.title === 'Replace screen',
    )!;
    const asset = (await assetsApi.get(done.asset_id)).value;
    window.history.pushState({}, '', `/assets/view?id=${asset.id}&tab=repairs`);
    const { container } = renderApp(<AssetView />, { workflows: true });
    expect(await screen.findByRole('row', { name: /Replace screen/ })).toHaveTextContent('Done');
    expect(screen.getByTestId('repairs-summary')).toHaveTextContent('1 repair, $64.00 in total');
    expect(screen.queryByText(/arrives in a later milestone/)).not.toBeInTheDocument();
    // the asset's own tab has no asset column
    expect(screen.queryByRole('columnheader', { name: 'Asset' })).not.toBeInTheDocument();
    await expectNoA11yViolations(container);
  });

  it('logs a repair from the tab with the asset fixed', async () => {
    const user = userEvent.setup();
    const ready = (
      await assetsApi.list({
        state_type: ['deployable'],
        assigned: false,
        sort: ['asset_tag'],
        limit: 1,
      })
    ).data[0]!;
    await openTab(ready.asset_tag);
    renderApp(<AssetView />, { workflows: true });
    expect(await screen.findByText('No repairs for this asset yet.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Log repair' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Log a repair for ${ready.asset_tag}`,
    });
    expect(within(dialog).queryByRole('combobox', { name: ASSET_FIELD })).not.toBeInTheDocument();
    await user.type(
      within(dialog).getByRole('textbox', { name: /^What needs doing/ }),
      'Flaky wifi',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Log repair' }));
    expect(await screen.findByRole('dialog', { name: 'Repair logged' })).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Done' }));
    expect(await screen.findByRole('row', { name: /Flaky wifi/ })).toHaveTextContent('Open');
    // the asset is "In repair" now: no check-out on its page
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Check out' })).not.toBeInTheDocument(),
    );
  });
});
