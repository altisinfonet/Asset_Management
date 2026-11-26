import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetFormScreen } from './asset-form-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/**
 * The status list also has lost-type and archived-type labels; picked by hand they only change the
 * label. The form points at the proper action (M2-LIFE-05) and offers it in place.
 */
describe('AssetFormScreen (edit): lost and retired statuses', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('a lost status on a checked-out asset offers Mark as lost, which ends the check-out', async () => {
    const taken = (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 3 }))
      .data[2]!;
    window.history.pushState({}, '', `/assets/edit/?id=${taken.id}`);
    const user = userEvent.setup();
    const { container } = renderApp(<AssetFormScreen kind="edit" />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Tag/ })).toHaveValue(taken.asset_tag),
    );
    expect(screen.queryByTestId('lifecycle-status-hint')).not.toBeInTheDocument();
    await user.click(screen.getByRole('combobox', { name: /^Status/ }));
    await user.click(await screen.findByRole('option', { name: 'Missing' }));
    const hint = await screen.findByTestId('lifecycle-status-hint');
    expect(hint).toHaveTextContent('does not close a check-out');
    await expectNoA11yViolations(container);
    await user.click(within(hint).getByRole('button', { name: 'Mark as lost instead' }));
    const dialog = await screen.findByRole('dialog', {
      name: `Mark ${taken.asset_tag} as lost or stolen`,
    });
    await user.click(within(dialog).getByRole('button', { name: 'Mark as lost' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/assets/view?id=${taken.id}`));
    const after = (await assetsApi.get(taken.id)).value;
    expect(after.current_assignment).toBeNull();
    expect(after.status?.state_type).toBe('lost');
  });

  it('a retired status says to use Dispose', async () => {
    const free = (
      await assetsApi.list({
        state_type: ['deployable'],
        assigned: false,
        sort: ['asset_tag'],
        limit: 8,
      })
    ).data[7]!;
    window.history.pushState({}, '', `/assets/edit/?id=${free.id}`);
    const user = userEvent.setup();
    renderApp(<AssetFormScreen kind="edit" />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Tag/ })).toHaveValue(free.asset_tag),
    );
    await user.click(screen.getByRole('combobox', { name: /^Status/ }));
    await user.click(await screen.findByRole('option', { name: 'Retired' }));
    const hint = await screen.findByTestId('lifecycle-status-hint');
    expect(hint).toHaveTextContent('Use Dispose instead');
    expect(within(hint).getByRole('button', { name: 'Dispose instead' })).toBeVisible();
  });
});
