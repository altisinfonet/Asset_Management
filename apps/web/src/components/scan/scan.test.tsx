import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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

/**
 * What a wedge scanner does: every key of the code, then Enter, within one burst. The keys are
 * dispatched in one go (no timers), and each carries a timestamp 5 ms after the previous one: the
 * detector reads `event.timeStamp`, and every `fireEvent` flushes a React render of the shell, which on
 * a saturated machine took more than the detector's 80 ms gap, so the burst read as typing and the
 * test failed now and then (AUDIT B.27). The clock of the burst no longer depends on the machine.
 */
function scanBurst(code: string) {
  const target = (document.activeElement as HTMLElement | null) ?? document.body;
  let at = performance.now();
  const clock = vi.spyOn(Event.prototype, 'timeStamp', 'get').mockImplementation(() => at);
  try {
    for (const key of [...code, 'Enter']) {
      at += 5;
      fireEvent.keyDown(target, { key });
    }
  } finally {
    clock.mockRestore();
  }
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
    document.body.focus();
    scanBurst(asset.asset_tag);
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(`/assets/view?id=${asset.id}&scanned=1`),
    );
    expect(router.push).toHaveBeenCalledTimes(1);
  });

  it('resolves a label code too', async () => {
    await shell();
    scanBurst('LBL00124');
    await waitFor(() =>
      expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/scanned=1$/)),
    );
  });

  it('reports a code nobody has, and does not navigate', async () => {
    await shell();
    scanBurst('ZZ-99999');
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
    // "c" is "new asset", "g" then "a" is "go to Assets"
    scanBurst('cga-nothing');
    expect(await screen.findByText('No asset matches "cga-nothing".')).toBeVisible();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(router.push).not.toHaveBeenCalled();
  });

  it('a scanned code that starts with the go-to sequence does not change the page', async () => {
    await shell();
    scanBurst('gas-nothing');
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

  it('stays in the scan field after it opens an asset and announces the asset, scan after scan', async () => {
    // founder decision (walk-through step 17): a wedge scanner reads label after label into the field
    await shell();
    const assets = (
      await assetsApi.list({
        state_type: ['deployable'],
        assigned: false,
        sort: ['asset_tag'],
        limit: 3,
      })
    ).data;
    const user = userEvent.setup();
    const field = screen.getByPlaceholderText('Scan or type tag');
    await user.click(field);
    for (const asset of assets) await user.keyboard(`${asset.asset_tag}{Enter}`);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(assets.length));
    assets.forEach((asset, i) =>
      expect(router.push).toHaveBeenNthCalledWith(i + 1, `/assets/view?id=${asset.id}&scanned=1`),
    );
    expect(field).toHaveFocus();
    const last = assets.at(-1)!;
    await waitFor(() =>
      expect(screen.getByTestId('scan-announcement')).toHaveTextContent(
        last.name ? `Opened ${last.asset_tag}, ${last.name}.` : `Opened ${last.asset_tag}.`,
      ),
    );
  });

  it('a wedge scan with nothing focused opens the asset and puts focus in the scan field', async () => {
    await shell();
    const asset = await firstAsset({ state_type: ['deployable'], assigned: false });
    document.body.focus();
    scanBurst(asset.asset_tag);
    await waitFor(() => expect(router.push).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByPlaceholderText('Scan or type tag')).toHaveFocus());
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
