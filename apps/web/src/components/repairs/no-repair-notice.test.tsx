import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetFormScreen } from '@/app/(app)/assets/asset-form-screen';
import { BulkEditDialog } from '@/app/(app)/assets/bulk-dialogs';
import { AssetView } from '@/app/(app)/assets/view/asset-view';
import { assetsApi, statusApi } from '@/lib/registry/api';
import type { Asset } from '@/lib/registry/types';
import { repairsApi } from '@/lib/repairs/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import type { Lookups } from '@/lib/registry/queries';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const SENTENCE =
  'No repair is logged for this asset. Log a repair to track the problem, supplier and cost.';

/** A free, ready asset and the "Out for fix" (undeployable) label. */
async function freeAsset(): Promise<{ asset: Asset; outForFix: string }> {
  // The mock seeds its repairs from the registry the first time they are read: read them before
  // an asset is put into the status by hand, so that asset stays without a repair.
  await repairsApi.list({ limit: 1 });
  const asset = (
    await assetsApi.list({
      state_type: ['deployable'],
      assigned: false,
      sort: ['-asset_tag'],
      limit: 1,
    })
  ).data[0]!;
  const statuses = (await statusApi.list({ limit: 100 })).data;
  return { asset, outForFix: statuses.find((s) => s.state_type === 'undeployable')!.id };
}

/** Puts the asset into the status directly (no repair), as a manual status edit does. */
async function setStatus(asset: Asset, statusId: string) {
  const current = await assetsApi.get(asset.id);
  await assetsApi.update(asset.id, { status_id: statusId }, current.etag);
}

const openView = (id: string) => window.history.pushState({}, '', `/assets/view/?id=${id}`);
const openForm = (id: string) => window.history.pushState({}, '', `/assets/edit/?id=${id}`);

describe('asset page: not deployable without a repair', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('says so and offers to log a repair; logging one removes the notice', async () => {
    const user = userEvent.setup();
    const { asset, outForFix } = await freeAsset();
    await setStatus(asset, outForFix);
    openView(asset.id);
    const { container } = renderApp(<AssetView />, { workflows: true });

    const notice = await screen.findByTestId('no-repair-notice');
    expect(notice).toHaveTextContent(SENTENCE);
    await expectNoA11yViolations(container);

    await user.click(screen.getByRole('button', { name: 'Log a repair' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Log a repair for ${asset.asset_tag}`,
    });
    // prefilled for this asset (no asset picker) with the not-deployable status it already has
    expect(
      within(dialog).queryByRole('combobox', { name: /^Asset\(required\)/ }),
    ).not.toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: /^Asset status while/ })).toHaveTextContent(
      'Out for fix',
    );
    await user.type(
      within(dialog).getByRole('textbox', { name: /^What needs doing/ }),
      'Dead battery',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Log repair' }));
    const files = await screen.findByRole('dialog', { name: 'Repair logged' });
    await user.click(within(files).getByRole('button', { name: 'Done' }));

    await waitFor(() => expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument());
    const repairs = (await repairsApi.list({ asset_id: asset.id })).data;
    expect(repairs).toHaveLength(1);
    expect(repairs[0]).toMatchObject({ title: 'Dead battery', status: 'open' });
  });

  it('shows nothing for a ready asset or one that already has an open repair', async () => {
    const { asset, outForFix } = await freeAsset();
    openView(asset.id);
    const ready = renderApp(<AssetView />, { workflows: true });
    await screen.findByRole('heading', { level: 1 });
    await screen.findByRole('tab', { name: 'Repairs' });
    expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument();
    ready.unmount();

    // one of the open repairs of the seed: its asset is "Out for fix" and has a record
    const open = (await repairsApi.list({ status: ['open'] })).data[0]!;
    expect((await assetsApi.get(open.asset_id)).value.status_id).toBe(outForFix);
    openView(open.asset_id);
    renderApp(<AssetView />, { workflows: true });
    await screen.findByRole('tab', { name: 'Repairs' });
    await waitFor(() => expect(repairsApi.summary(open.asset_id)).resolves.toBeTruthy());
    expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument();
  });

  it('gives somebody who may read but not log repairs the sentence without the button', async () => {
    const { asset, outForFix } = await freeAsset();
    await setStatus(asset, outForFix);
    seedSession(MOCK_ACCOUNTS.viewer);
    openView(asset.id);
    renderApp(<AssetView />, { workflows: true });
    expect(await screen.findByTestId('no-repair-notice')).toHaveTextContent(SENTENCE);
    expect(screen.queryByRole('button', { name: 'Log a repair' })).not.toBeInTheDocument();
  });
});

describe('asset form: choosing a not-deployable status', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('hints while the status is not deployable and no repair is open, and Log a repair keeps the edits', async () => {
    const user = userEvent.setup();
    const { asset } = await freeAsset();
    openForm(asset.id);
    const { container } = renderApp(<AssetFormScreen kind="edit" />);
    const status = await screen.findByRole('combobox', { name: 'Status' });
    expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Serial number' }), '-X');
    await user.click(status);
    await user.click(await screen.findByRole('option', { name: 'Out for fix' }));
    const hint = await screen.findByTestId('no-repair-notice');
    expect(hint).toHaveTextContent(SENTENCE);
    await expectNoA11yViolations(container);

    // choosing a deployable status again takes it away; the status is only a form value so far
    await user.click(status);
    await user.click(await screen.findByRole('option', { name: 'Ready' }));
    await waitFor(() => expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument());
    expect((await assetsApi.get(asset.id)).value.status_id).toBe(asset.status_id);

    await user.click(status);
    await user.click(await screen.findByRole('option', { name: 'Out for fix' }));
    await user.click(await screen.findByRole('button', { name: 'Log a repair' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Log a repair for ${asset.asset_tag}`,
    });
    expect(within(dialog).getByRole('combobox', { name: /^Asset status while/ })).toHaveTextContent(
      'Out for fix',
    );
    await user.type(within(dialog).getByRole('textbox', { name: /^What needs doing/ }), 'Hinge');
    await user.click(within(dialog).getByRole('button', { name: 'Log repair' }));
    await user.click(
      within(await screen.findByRole('dialog', { name: 'Repair logged' })).getByRole('button', {
        name: 'Done',
      }),
    );
    await waitFor(() => expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument());
    // logging the repair did not submit the form behind the dialog
    expect(router.push).not.toHaveBeenCalled();
    // the form still shows what was typed and the status, and saving it works on the new version
    expect(screen.getByRole('textbox', { name: 'Serial number' })).toHaveValue(
      `${asset.serial ?? ''}-X`,
    );
    expect(screen.getByRole('combobox', { name: 'Status' })).toHaveTextContent('Out for fix');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(async () =>
      expect((await assetsApi.get(asset.id)).value.serial).toBe(`${asset.serial ?? ''}-X`),
    );
    expect((await repairsApi.list({ asset_id: asset.id })).data).toHaveLength(1);
  });

  it('does not hint at an asset that already has an open repair', async () => {
    const open = (await repairsApi.list({ status: ['open'] })).data[0]!;
    openForm(open.asset_id);
    renderApp(<AssetFormScreen kind="edit" />);
    expect(await screen.findByRole('combobox', { name: 'Status' })).toHaveTextContent(
      'Out for fix',
    );
    await waitFor(() => expect(repairsApi.summary(open.asset_id)).resolves.toBeTruthy());
    expect(screen.queryByTestId('no-repair-notice')).not.toBeInTheDocument();
  });
});

describe('bulk edit: a not-deployable status', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('adds a one-line note, never blocks, and is silent for other statuses', async () => {
    const user = userEvent.setup();
    const statuses = (await statusApi.list({ limit: 100 })).data;
    const lookups = {
      statuses,
      statusById: new Map(statuses.map((s) => [s.id, s])),
      categories: [],
      vendors: [],
    } as unknown as Lookups;
    const onApply = vi.fn();
    renderApp(
      <BulkEditDialog
        open
        onOpenChange={() => undefined}
        items={[{ id: 'a', label: 'LAP-1' } as never, { id: 'b', label: 'LAP-2' } as never]}
        lookups={lookups}
        progress={null}
        onApply={onApply}
      />,
    );
    const dialog = await screen.findByRole('dialog', { name: 'Edit 2 assets' });
    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    await user.click(await screen.findByRole('option', { name: 'Ready' }));
    expect(screen.queryByTestId('bulk-no-repair-note')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    await user.click(await screen.findByRole('option', { name: 'Out for fix' }));
    expect(screen.getByTestId('bulk-no-repair-note')).toHaveTextContent(
      'A not-deployable status does not log repairs. Log one on each asset to track the problem, supplier and cost.',
    );
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2 assets' }));
    expect(onApply).toHaveBeenCalledWith({ status_id: expect.any(String) });
  });
});
