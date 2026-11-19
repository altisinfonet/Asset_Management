import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { uid } from '@/mocks/registry-fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetView } from './asset-view';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const open = (query: string) => window.history.pushState({}, '', `/assets/view/?${query}`);

async function ready() {
  return (
    await assetsApi.list({
      state_type: ['deployable'],
      assigned: false,
      sort: ['asset_tag'],
      limit: 1,
    })
  ).data[0]!;
}
async function held() {
  return (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 })).data[0]!;
}

describe('AssetView: custody actions', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('a ready asset offers Check out; a held one offers Check in and Transfer and says who holds it', async () => {
    const free = await ready();
    open(`id=${free.id}`);
    const view = renderApp(<AssetView />, { workflows: true });
    expect(await screen.findByRole('button', { name: 'Check out' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    view.unmount();

    const taken = await held();
    open(`id=${taken.id}`);
    renderApp(<AssetView />, { workflows: true });
    expect(await screen.findByRole('button', { name: 'Check in' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Transfer' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Check out' })).not.toBeInTheDocument();
    expect(screen.getByTestId('asset-holder')).toHaveTextContent(
      `Assigned to ${taken.current_assignment!.target_name}`,
    );
  });

  it('the details show who holds it and the due date, with an overdue mark when it is late', async () => {
    const late = (await assetsApi.list({ assigned: true, limit: 200 })).data.find(
      (a) => (a.current_assignment?.expected_return ?? '9') < '2026-11-17',
    )!;
    open(`id=${late.id}`);
    renderApp(<AssetView />, { workflows: true });
    const overview = await screen.findByText('Due back');
    expect(overview.nextElementSibling).toHaveTextContent(/Overdue/);
  });

  it('arriving from a scan puts focus on the primary action', async () => {
    const free = await ready();
    open(`id=${free.id}&scanned=1`);
    renderApp(<AssetView />, { workflows: true });
    const button = await screen.findByRole('button', { name: 'Check out' });
    await waitFor(() => expect(button).toHaveFocus());
  });

  it('the Check out button opens the dialog for the asset', async () => {
    const free = await ready();
    open(`id=${free.id}`);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Check out' }));
    expect(
      await screen.findByRole('dialog', { name: `Check out ${free.asset_tag}` }),
    ).toBeVisible();
  });

  it('a read-only role has no custody buttons', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const free = await ready();
    open(`id=${free.id}`);
    renderApp(<AssetView />, { workflows: true });
    await screen.findByTestId('asset-tag');
    for (const name of ['Check out', 'Check in', 'Transfer']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});

describe('AssetView: History tab', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('is the real chain of custody: who did what, with the details, newest first', async () => {
    const taken = await held();
    open(`id=${taken.id}&tab=history`);
    const { container } = renderApp(<AssetView />, { workflows: true });
    const list = await screen.findByRole('list', { name: 'History' });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Checked out');
    expect(items[0]).toHaveTextContent(`Checked out to ${taken.current_assignment!.target_name}`);
    expect(items[0]).toHaveTextContent('by Sam Lee');
    expect(items.at(-1)).toHaveTextContent('Created');
    expect(items.at(-1)).toHaveTextContent('by Alice Owner');
    await expectNoA11yViolations(container);
  });

  it('filters by kind of event', async () => {
    const taken = await held();
    open(`id=${taken.id}&tab=history`);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await screen.findByRole('list', { name: 'History' });
    await user.click(screen.getByRole('combobox', { name: 'Show' }));
    await user.click(await screen.findByRole('option', { name: 'Custody' }));
    await waitFor(() => {
      const items = within(screen.getByRole('list', { name: 'History' })).getAllByRole('listitem');
      expect(items.every((li) => /Checked (out|in)|Transferred/.test(li.textContent ?? ''))).toBe(
        true,
      );
      expect(items.some((li) => li.textContent?.includes('Created'))).toBe(false);
    });
    await user.click(screen.getByRole('combobox', { name: 'Show' }));
    await user.click(await screen.findByRole('option', { name: 'Repairs' }));
    expect(await screen.findByText('No events of this kind.')).toBeVisible();
  });

  it('shows the new events after a check-in without a reload', async () => {
    const taken = await held();
    open(`id=${taken.id}&tab=history`);
    const user = userEvent.setup();
    renderApp(<AssetView />, { workflows: true });
    await screen.findByRole('list', { name: 'History' });
    await user.click(screen.getByRole('button', { name: 'Check in' }));
    const dialog = await screen.findByRole('dialog', { name: `Check in ${taken.asset_tag}` });
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    await screen.findByText(`${taken.asset_tag} checked in.`);
    await waitFor(() =>
      expect(
        within(screen.getByRole('list', { name: 'History' })).getAllByRole('listitem')[0],
      ).toHaveTextContent('Checked in'),
    );
  });
});

describe('AssetView: Attachments tab', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('is the attachments panel of the asset', async () => {
    open(`id=${uid('asset', 124)}&tab=attachments`);
    renderApp(<AssetView />, { workflows: true });
    const list = await screen.findByRole('list', { name: 'Attached files' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByRole('button', { name: 'Choose files' })).toBeVisible();
  });

  it('a role without attachment rights is told so', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    open(`id=${uid('asset', 124)}&tab=attachments`);
    renderApp(<AssetView />, { workflows: true });
    // the viewer may read attachments but not write them
    expect(await screen.findByRole('list', { name: 'Attached files' })).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Choose files' })).not.toBeInTheDocument();
  });
});
