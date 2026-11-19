import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from '@/components/app-shell/app-shell';
import { assetsApi } from '@/lib/registry/api';
import type { Asset } from '@/lib/registry/types';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function shell(email: string = MOCK_ACCOUNTS.owner) {
  seedSession(email);
  const view = renderApp(
    <AppShell>
      <p>page content</p>
    </AppShell>,
  );
  await screen.findByTestId('tenant-name');
  // the shell's listeners are attached in an effect right after the first render
  await waitFor(() => expect(document.querySelector('[role="search"]')).not.toBeNull());
  return view;
}

async function firstAsset(query: Parameters<typeof assetsApi.list>[0]): Promise<Asset> {
  return (await assetsApi.list({ ...query, sort: ['asset_tag'], limit: 1 })).data[0]!;
}

describe('keyboard-wedge scanner (global)', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
  });

  it('a fast burst of keys and Enter, with nothing focused, opens the asset', async () => {
    await shell();
    const asset = await firstAsset({ state_type: ['deployable'], assigned: false });
    const user = userEvent.setup(); // no delay: keys arrive a millisecond apart, like a scanner
    document.body.focus();
    await user.keyboard(`${asset.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/assets/view?id=${asset.id}&scanned=1`),
    );
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('resolves a label code too', async () => {
    await shell();
    const user = userEvent.setup();
    await user.keyboard('LBL00124{Enter}');
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/scanned=1$/)),
    );
  });

  it('reports a code nobody has, and does not navigate', async () => {
    await shell();
    const user = userEvent.setup();
    await user.keyboard('ZZ-99999{Enter}');
    expect(await screen.findByText('No asset matches "ZZ-99999".')).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a person typing at normal speed is not mistaken for a scanner', async () => {
    await shell();
    const user = userEvent.setup({ delay: 150 });
    await user.keyboard('AT-00124{Enter}');
    expect(router.push).not.toHaveBeenCalled();
    expect(screen.queryByText(/No asset matches/)).not.toBeInTheDocument();
  });

  it('a scanned code that starts with a shortcut key does not run the shortcut', async () => {
    await shell();
    const user = userEvent.setup();
    // "c" is "new asset", "g" then "a" is "go to Assets"
    await user.keyboard('cga-nothing{Enter}');
    expect(await screen.findByText('No asset matches "cga-nothing".')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a scanned code that starts with the go-to sequence does not change the page', async () => {
    await shell();
    const user = userEvent.setup();
    await user.keyboard('gas-nothing{Enter}');
    expect(await screen.findByText('No asset matches "gas-nothing".')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a lone "c" still starts a new asset (after the scanner guard)', async () => {
    await shell();
    const user = userEvent.setup();
    await user.keyboard('c');
    await waitFor(() => expect(router.push).toHaveBeenCalledWith('/assets/new'));
  });

  it('typing into a field is never intercepted: the top bar field submits once', async () => {
    await shell();
    const asset = await firstAsset({ state_type: ['deployable'], assigned: false });
    const user = userEvent.setup();
    await user.click(screen.getByPlaceholderText('Scan or type tag'));
    await user.keyboard(`${asset.asset_tag}{Enter}`);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    expect(router.push).toHaveBeenCalledWith(`/assets/view?id=${asset.id}&scanned=1`);
    expect(screen.getByPlaceholderText('Scan or type tag')).toHaveValue('');
  });

  it('a serial number resolves like a tag (fallback to the exact serial lookup)', async () => {
    await shell();
    const asset = await firstAsset({ state_type: ['deployable'], assigned: false });
    const user = userEvent.setup();
    await user.click(screen.getByPlaceholderText('Scan or type tag'));
    await user.keyboard(`${asset.serial}{Enter}`);
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/assets/view?id=${asset.id}&scanned=1`),
    );
  });
});

describe('scan panel and batch mode', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
  });

  async function openPanel(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole('button', { name: 'Scan assets' }));
    return screen.findByRole('dialog', { name: 'Scan assets' });
  }

  it('keeps focus in its field and checks assets in one after another', async () => {
    await shell();
    const [first, second] = (
      await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 2 })
    ).data;
    const user = userEvent.setup();
    const panel = await openPanel(user);
    const field = within(panel).getByRole('textbox', { name: 'Scan or type an asset tag' });
    await waitFor(() => expect(field).toHaveFocus());
    await expectNoA11yViolations(panel);

    await user.click(within(panel).getByRole('combobox', { name: 'When I scan' }));
    await user.click(await screen.findByRole('option', { name: 'Check in' }));
    await user.type(field, `${first!.asset_tag}{Enter}`);
    const log = within(panel).getByTestId('scan-log');
    await waitFor(() => expect(log).toHaveTextContent(`${first!.asset_tag} checked in.`));
    await waitFor(() => expect(field).toHaveFocus());
    await user.type(field, `${second!.asset_tag}{Enter}`);
    await waitFor(() => expect(log).toHaveTextContent(`${second!.asset_tag} checked in.`));
    expect((await assetsApi.get(first!.id)).value.current_assignment).toBeNull();
    expect((await assetsApi.get(second!.id)).value.current_assignment).toBeNull();
    expect(router.push).not.toHaveBeenCalled(); // batch mode does not navigate
  });

  it('says why a scan could not be applied', async () => {
    await shell();
    const free = await firstAsset({ state_type: ['deployable'], assigned: false });
    const user = userEvent.setup();
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole('combobox', { name: 'When I scan' }));
    await user.click(await screen.findByRole('option', { name: 'Check in' }));
    const field = within(panel).getByRole('textbox', { name: 'Scan or type an asset tag' });
    await user.type(field, `${free.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(within(panel).getByTestId('scan-log')).toHaveTextContent(
        'This asset is not checked out.',
      ),
    );
    await user.type(field, 'NOPE-1{Enter}');
    await waitFor(() =>
      expect(within(panel).getByTestId('scan-log')).toHaveTextContent('No asset matches "NOPE-1".'),
    );
  });

  it('checks assets out to the chosen person, and asks for a person first', async () => {
    await shell();
    const [first, free] = (
      await assetsApi.list({
        state_type: ['deployable'],
        assigned: false,
        sort: ['asset_tag'],
        limit: 2,
      })
    ).data as [Asset, Asset];
    const user = userEvent.setup();
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole('combobox', { name: 'When I scan' }));
    await user.click(await screen.findByRole('option', { name: 'Check out to a person' }));
    const field = within(panel).getByRole('textbox', { name: 'Scan or type an asset tag' });
    await user.type(field, `${first.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(within(panel).getByTestId('scan-log')).toHaveTextContent(
        'Choose who the assets go to first.',
      ),
    );
    await user.type(within(panel).getByRole('combobox', { name: /Check out to/ }), 'Maria Reyes');
    await user.click(await screen.findByRole('option', { name: /Maria Reyes/ }));
    await user.type(field, `${free.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(within(panel).getByTestId('scan-log')).toHaveTextContent(
        `${free.asset_tag} checked out to Maria Reyes.`,
      ),
    );
    expect((await assetsApi.get(free.id)).value.current_assignment?.target_name).toBe(
      'Maria Reyes',
    );
  });

  it('a role without check-out rights is only offered "open"', async () => {
    await shell(MOCK_ACCOUNTS.viewer);
    const user = userEvent.setup();
    const panel = await openPanel(user);
    await user.click(within(panel).getByRole('combobox', { name: 'When I scan' }));
    expect(await screen.findAllByRole('option')).toHaveLength(1);
  });

  it('is reachable from the command palette', async () => {
    await shell();
    const user = userEvent.setup();
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Command palette' });
    await user.type(within(palette).getByRole('combobox'), 'scan');
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('dialog', { name: 'Scan assets' })).toBeVisible();
  });
});
