import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { accessoriesApi } from '@/lib/stock/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetView } from './asset-view';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const open = (id: string) => window.history.pushState({}, '', `/assets/view/?id=${id}`);

/** The n-th ready asset (n > 0 picks a later one, so tests do not share an asset). */
async function ready(n = 0) {
  return (
    await assetsApi.list({
      state_type: ['deployable'],
      assigned: false,
      sort: ['asset_tag'],
      limit: 20,
    })
  ).data[n]!;
}
async function held() {
  return (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 })).data[0]!;
}

describe('AssetView: lost, found and dispose (M2-LIFE-05)', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('marks a checked-out asset lost: the dialog says the check-out ends, and it does', async () => {
    const taken = await held();
    const holder = taken.current_assignment!.target_name!;
    open(taken.id);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Mark as lost or stolen' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Mark ${taken.asset_tag} as lost or stolen`,
    });
    expect(within(dialog).getByTestId('lost-closes-checkout')).toHaveTextContent(
      `It is checked out to ${holder}. Marking it lost closes that check-out`,
    );
    await expectNoA11yViolations(dialog);
    await user.type(within(dialog).getByRole('textbox', { name: 'What happened' }), 'Left on bus');
    await user.click(within(dialog).getByRole('button', { name: 'Mark as lost' }));
    expect(await screen.findByText(`${taken.asset_tag} is marked lost`)).toBeVisible();

    const after = (await assetsApi.get(taken.id)).value;
    expect(after.status?.state_type).toBe('lost');
    expect(after.current_assignment).toBeNull();
    // the page now offers Mark as found, and no custody action
    expect(await screen.findByRole('button', { name: 'Mark as found' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Mark as lost or stolen' }),
    ).not.toBeInTheDocument();
  });

  it('marks a lost asset found and asks where it is now', async () => {
    const asset = await ready(2);
    const { etag } = await assetsApi.get(asset.id);
    const { lifecycleApi } = await import('@/lib/registry/api');
    await lifecycleApi.markLost(asset.id, {}, { idempotencyKey: `lost-${asset.id}`, etag });
    open(asset.id);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Mark as found' }));
    const dialog = await screen.findByRole('dialog', { name: `Mark ${asset.asset_tag} as found` });
    expect(within(dialog).getByRole('combobox', { name: /Where is it now/ })).toBeVisible();
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Mark as found' }));
    expect(await screen.findByText(`${asset.asset_tag} is marked found`)).toBeVisible();
    await waitFor(async () =>
      expect((await assetsApi.get(asset.id)).value.status?.state_type).toBe('deployable'),
    );
  });

  it('disposes of an asset with a reason, a date and a note; it is archived with the record', async () => {
    const asset = await ready(3);
    open(asset.id);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Dispose' }));
    const dialog = await screen.findByRole('dialog', { name: `Dispose of ${asset.asset_tag}` });
    expect(dialog).toHaveTextContent('The asset is then archived');
    // the reason is required
    await user.click(within(dialog).getByRole('button', { name: 'Dispose' }));
    expect(await within(dialog).findByText('This field is required.')).toBeVisible();
    await user.click(within(dialog).getByRole('combobox', { name: /^Reason/ }));
    await user.click(await screen.findByRole('option', { name: 'Recycled' }));
    const date = within(dialog).getByLabelText(/^Date/);
    await user.clear(date);
    await user.type(date, '2026-11-20');
    await user.type(within(dialog).getByRole('textbox', { name: 'Note' }), 'Certificate R-2210');
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Dispose' }));
    expect(await screen.findByText(`${asset.asset_tag} is disposed of and archived`)).toBeVisible();
    expect(await screen.findByTestId('disposal-banner')).toHaveTextContent(
      'Disposed of on 2026-11-20: Recycled. Certificate R-2210',
    );
    const after = (await assetsApi.get(asset.id)).value;
    expect(after.archived_at).not.toBeNull();
    expect(after.disposal).toMatchObject({ reason: 'recycled', disposed_on: '2026-11-20' });
  });

  it('a checked-out asset is warned about, and the refusal of the API is shown in the dialog', async () => {
    const taken = (await assetsApi.list({ assigned: true, sort: ['-asset_tag'], limit: 1 }))
      .data[0]!;
    open(taken.id);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Dispose' }));
    const dialog = await screen.findByRole('dialog', { name: `Dispose of ${taken.asset_tag}` });
    expect(within(dialog).getByTestId('dispose-checked-out')).toHaveTextContent('Check it in');
    await user.click(within(dialog).getByRole('combobox', { name: /^Reason/ }));
    await user.click(await screen.findByRole('option', { name: 'Sold' }));
    await user.click(within(dialog).getByRole('button', { name: 'Dispose' }));
    expect(
      await within(dialog).findByText(
        'The asset is checked out. Check it in before disposing of it.',
      ),
    ).toBeVisible();
  });

  it('an asset that still holds accessory units says so plainly (409)', async () => {
    const asset = await ready(4);
    const accessory = (await accessoriesApi.list({ limit: 50 })).data.find(
      (a) => (a.qty_available ?? 0) >= 2,
    )!;
    await accessoriesApi.checkout(
      accessory.id,
      { quantity: 2, target_asset_id: asset.id },
      `acc-${asset.id}`,
    );
    open(asset.id);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Dispose' }));
    const dialog = await screen.findByRole('dialog', { name: `Dispose of ${asset.asset_tag}` });
    await user.click(within(dialog).getByRole('combobox', { name: /^Reason/ }));
    await user.click(await screen.findByRole('option', { name: 'Scrapped' }));
    await user.click(within(dialog).getByRole('button', { name: 'Dispose' }));
    expect(
      await within(dialog).findByText(
        '2 accessory units are still checked out to this asset. Check them in on the Stock page first.',
      ),
    ).toBeVisible();
  });

  it('a read-only role gets none of the three actions', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const asset = await ready(5);
    open(asset.id);
    renderApp(<AssetView />, { workflows: true });
    await screen.findByTestId('asset-tag');
    for (const name of ['Mark as lost or stolen', 'Mark as found', 'Dispose']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
