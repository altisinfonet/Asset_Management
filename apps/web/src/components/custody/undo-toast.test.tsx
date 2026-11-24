import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import type { Asset } from '@/lib/registry/types';
import type { CustodyAction } from '@/lib/custody/helpers';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { problem } from '@/mocks/http';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { useCustody } from './custody-provider';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/** M2-UX-02: the Undo of the success toast after a check-out, check-in and transfer. */
function Opener({ assets, action }: { assets: Asset[]; action: CustodyAction }) {
  const custody = useCustody();
  return <button onClick={() => custody.open({ assets, action })}>open dialog</button>;
}

const ready = async (count = 1) =>
  (
    await assetsApi.list({
      state_type: ['deployable'],
      assigned: false,
      sort: ['asset_tag'],
      limit: count,
    })
  ).data;
const held = async (count = 1) =>
  (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: count })).data;
const fresh = async (id: string) => (await assetsApi.get(id)).value;

async function open(assets: Asset[], action: CustodyAction) {
  const user = userEvent.setup();
  renderApp(<Opener assets={assets} action={action} />, { workflows: true });
  await user.click(await screen.findByRole('button', { name: 'open dialog' }));
  const title =
    assets.length > 1
      ? new RegExp(`${action === 'checkin' ? 'Check in' : 'Check out'} ${assets.length} assets`)
      : new RegExp(
          `${action === 'checkout' ? 'Check out' : action === 'checkin' ? 'Check in' : 'Transfer'} ${assets[0]!.asset_tag}`,
        );
  const dialog = await screen.findByRole('dialog', { name: title });
  return { user, dialog };
}

async function choosePerson(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  name: string,
) {
  await user.type(within(dialog).getByRole('combobox', { name: /Person/ }), name);
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('Undo toast after a custody action', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('undoes a check-out: the toast offers Undo with a hint, the asset is back in stock, the history shows both', async () => {
    const [asset] = await ready();
    const { user, dialog } = await open([asset!], 'checkout');
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(
      await screen.findByText(`${asset!.asset_tag} checked out to Maria Reyes.`),
    ).toBeVisible();
    expect(screen.getByText('You can undo this for 10 seconds.')).toBeVisible();
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeVisible();
    await expectNoA11yViolations(document.body);

    await user.click(undo);
    expect(await screen.findByText(`Undone: ${asset!.asset_tag} is back as it was.`)).toBeVisible();
    const after = await fresh(asset!.id);
    expect(after.current_assignment).toBeNull();
    expect(after.status?.state_type).toBe('deployable');
    // both events are in the history, newest first, and the check-out is still there
    const types = (await assetsApi.history(asset!.id)).data.map((e) => e.event_type);
    expect(types.slice(0, 2)).toEqual(['custody_undone', 'checked_out']);
  });

  it('undoes a check-in: the holder has the asset again', async () => {
    const [asset] = await held();
    const holder = asset!.current_assignment!.target_name;
    const { user, dialog } = await open([asset!], 'checkin');
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    expect(await screen.findByText(`${asset!.asset_tag} checked in.`)).toBeVisible();
    expect((await fresh(asset!.id)).current_assignment).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(`Undone: ${asset!.asset_tag} is back as it was.`)).toBeVisible();
    const after = await fresh(asset!.id);
    expect(after.current_assignment?.target_name).toBe(holder);
    expect(after.status?.state_type).toBe('deployed');
    expect((await assetsApi.history(asset!.id)).data[0]!.event_type).toBe('custody_undone');
  });

  it('undoes a transfer: back with the previous holder', async () => {
    const [asset] = await held();
    const before = asset!.current_assignment!.target_name;
    const { user, dialog } = await open([asset!], 'transfer');
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    await screen.findByText(/transferred to Maria Reyes/);
    expect((await fresh(asset!.id)).current_assignment?.target_name).toBe('Maria Reyes');
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await screen.findByText(`Undone: ${asset!.asset_tag} is back as it was.`);
    expect((await fresh(asset!.id)).current_assignment?.target_name).toBe(before);
  });

  it('a bulk check-out is undone for every asset with one click', async () => {
    const assets = await ready(3);
    const { user, dialog } = await open(assets, 'checkout');
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await screen.findByText('3 assets checked out to Maria Reyes.')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText('Undone: 3 assets are back as they were.')).toBeVisible();
    for (const a of assets) expect((await fresh(a.id)).current_assignment).toBeNull();
  });

  it('refuses with a clear message when the asset changed meanwhile, and nothing is undone', async () => {
    const [asset] = await ready();
    const { user, dialog } = await open([asset!], 'checkout');
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    await screen.findByText(`${asset!.asset_tag} checked out to Maria Reyes.`);
    // somebody else edits the asset after the check-out
    const current = await assetsApi.get(asset!.id);
    await assetsApi.update(asset!.id, { notes: 'changed by someone else' }, current.etag);
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(
      await screen.findByText(
        `${asset!.asset_tag} changed in the meantime, so this cannot be undone.`,
      ),
    ).toBeVisible();
    expect((await fresh(asset!.id)).current_assignment?.target_name).toBe('Maria Reyes');
  });

  it('says when it is too late, and when the server answers an unexpected refusal', async () => {
    const [asset] = await ready();
    const { user, dialog } = await open([asset!], 'checkout');
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    await screen.findByText(`${asset!.asset_tag} checked out to Maria Reyes.`);
    server.use(
      http.post('/v1/assets/:id/undo-custody', () =>
        problem(409, 'undo-expired', 'Too late to undo', {
          detail: 'The time to undo this action has passed.',
        }),
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    expect(await screen.findByText(`Too late to undo ${asset!.asset_tag}.`)).toBeVisible();
  });

  it('the Undo button is the first control of the toast and can be used from the keyboard', async () => {
    const [asset] = await ready();
    const { user, dialog } = await open([asset!], 'checkout');
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    await screen.findByText(`${asset!.asset_tag} checked out to Maria Reyes.`);
    const undo = screen.getByRole('button', { name: 'Undo' });
    undo.focus();
    expect(undo).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText(`Undone: ${asset!.asset_tag} is back as it was.`)).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument(),
    );
  });
});
