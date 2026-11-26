import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi, custodyApi, peopleApi } from '@/lib/registry/api';
import { SAVED_VIEWS_KEY } from '@/lib/registry/asset-view';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { uid } from '@/mocks/registry-fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetsTable } from './assets-table';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function searchPrj(user: ReturnType<typeof userEvent.setup>) {
  await waitFor(() => expect(screen.getByTestId('assets-range')).toHaveTextContent('of'));
  await user.type(screen.getByPlaceholderText('Tag, serial or name'), 'PRJ-');
  await screen.findByText('Showing 1-10 of 10');
}

describe('AssetsTable: bulk move and bulk dispose (v0.2.8)', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.removeItem(SAVED_VIEWS_KEY);
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('bulk edit moves the selected assets to a location, with a note in their history', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await searchPrj(user);
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00007' }));
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00006' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit 2 assets' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Field' }));
    await user.click(await screen.findByRole('option', { name: 'Location' }));
    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    await user.click(await screen.findByRole('option', { name: /^Gym/ }));
    await user.type(
      within(dialog).getByRole('textbox', { name: 'Note for the history' }),
      'Exam week',
    );
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Apply to 2 assets' }));
    expect(await screen.findByText('Done: 2 assets updated.')).toBeVisible();
    const seven = (await assetsApi.list({ tag: 'PRJ-00007' })).data[0]!;
    expect(seven.location_id).toBe(uid('location', 5));
    const history = await assetsApi.history(seven.id, { event_type: ['location_changed'] });
    expect(history.data[0]).toMatchObject({
      event_type: 'location_changed',
      payload: expect.objectContaining({ note: 'Exam week' }),
    });
  });

  it('a location-scoped user can only move inside its scope and cannot clear the location', async () => {
    seedSession(MOCK_ACCOUNTS.scopedAdmin);
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await user.click((await screen.findAllByRole('checkbox', { name: /^Select row / }))[0]!);
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit 1 asset' });
    await user.click(within(dialog).getByRole('combobox', { name: 'Field' }));
    await user.click(await screen.findByRole('option', { name: 'Location' }));
    expect(within(dialog).getByText('You can only choose places inside your sites.')).toBeVisible();
    expect(within(dialog).queryByRole('checkbox', { name: /No location/ })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    // the site above the scope (Riverside Elementary) is not offered
    expect(await screen.findByRole('option', { name: /^Gym/ })).toBeVisible();
    expect(screen.queryByRole('option', { name: /^Riverside Elementary/ })).not.toBeInTheDocument();
  });

  it('a lost or retired status in bulk edit points at the proper actions', async () => {
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await searchPrj(user);
    await user.click(screen.getByRole('checkbox', { name: 'Select row PRJ-00005' }));
    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit 1 asset' });
    await user.click(within(dialog).getByRole('combobox', { name: 'New value' }));
    await user.click(await screen.findByRole('option', { name: 'Missing' }));
    expect(within(dialog).getByTestId('bulk-lifecycle-note')).toHaveTextContent(
      'Use Mark as lost or stolen, or Dispose',
    );
  });

  it('bulk dispose leaves checked-out assets out and archives the rest with one reason', async () => {
    const [two, three, four] = await Promise.all(
      ['PRJ-00002', 'PRJ-00003', 'PRJ-00004'].map(
        async (tag) => (await assetsApi.list({ tag })).data[0]!,
      ),
    );
    if (!three!.current_assignment) {
      const person = (await peopleApi.list({ limit: 1 })).data[0]!;
      await custodyApi.checkout(
        three!.id,
        { person_id: person.id },
        { idempotencyKey: `out-${three!.id}` },
      );
    }
    const user = userEvent.setup();
    renderApp(<AssetsTable />, { workflows: true });
    await searchPrj(user);
    for (const asset of [two!, three!, four!]) {
      await user.click(screen.getByRole('checkbox', { name: `Select row ${asset.asset_tag}` }));
    }
    const free = [two!, four!].filter((a) => !a.current_assignment);
    const label = free.length === 1 ? 'Dispose of 1 asset' : `Dispose of ${free.length} assets`;
    await user.click(await screen.findByRole('button', { name: label }));
    expect(await screen.findByText(/checked out and (was|were) left out/)).toBeVisible();
    const dialog = await screen.findByRole('dialog', { name: label });
    await user.click(within(dialog).getByRole('combobox', { name: /^Reason/ }));
    await user.click(await screen.findByRole('option', { name: 'Donated' }));
    await user.click(within(dialog).getByRole('button', { name: label }));
    expect(await screen.findByText(/^Done: \d+ assets? updated\.$/)).toBeVisible();
    for (const asset of free) {
      const after = (await assetsApi.get(asset.id)).value;
      expect(after.archived_at).not.toBeNull();
      expect(after.disposal?.reason).toBe('donated');
    }
    expect((await assetsApi.get(three!.id)).value.archived_at).toBeNull();
  });
});
