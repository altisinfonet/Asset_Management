import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { PeopleScreen } from './people-screen';
import { PersonView } from './view/person-view';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

describe('PeopleScreen', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists active people with and without a login, 34 in all, and has no axe violations', async () => {
    const { container } = renderApp(<PeopleScreen />);
    expect(await screen.findByTestId('people-range')).toHaveTextContent('Showing 1-34 of 34');
    expect(screen.getByRole('row', { name: /Alice Owner/ })).toHaveTextContent('Can sign in');
    expect(screen.getByRole('row', { name: /Jamie Okafor/ })).toHaveTextContent('No login');
    await expectNoA11yViolations(container);
  });

  it('filters by login and by search, with a way out of an empty result', async () => {
    const user = userEvent.setup();
    renderApp(<PeopleScreen />);
    await screen.findByRole('row', { name: /Alice Owner/ });
    await user.click(screen.getByRole('combobox', { name: 'Login' }));
    await user.click(await screen.findByRole('option', { name: 'Can sign in' }));
    await waitFor(() => expect(screen.getByTestId('people-range')).toHaveTextContent('1-4 of 4'));
    await user.click(screen.getByRole('combobox', { name: 'Login' }));
    await user.click(await screen.findByRole('option', { name: 'With or without login' }));
    await user.type(screen.getByRole('searchbox', { name: 'Search' }), 'zzzz');
    expect(await screen.findByRole('heading', { name: 'Nobody matches' })).toBeVisible();
    await user.click(screen.getAllByRole('button', { name: 'Clear filters' })[0]!);
    expect(await screen.findByRole('row', { name: /Alice Owner/ })).toBeVisible();
  });

  it('adds a person and shows the server complaint about a duplicate e-mail on the field', async () => {
    const user = userEvent.setup();
    renderApp(<PeopleScreen />);
    await user.click(await screen.findByRole('button', { name: 'Add person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a person' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Dana Reyes');
    await user.type(within(dialog).getByRole('textbox', { name: /^E-mail/ }), 'alice@example.org');
    await user.click(within(dialog).getByRole('button', { name: 'Add person' }));
    expect(await within(dialog).findByText('This value is already in use.')).toBeVisible();
    const email = within(dialog).getByRole('textbox', { name: /^E-mail/ });
    await user.clear(email);
    await user.type(email, 'dana.reyes@school.example');
    await user.click(within(dialog).getByRole('button', { name: 'Add person' }));
    expect(await screen.findByText('Dana Reyes added.')).toBeVisible();
  });

  it('opens a person with Enter on the row', async () => {
    const user = userEvent.setup();
    renderApp(<PeopleScreen />);
    const row = await screen.findByRole('row', { name: /Alice Owner/ });
    row.focus();
    await user.keyboard('{Enter}');
    expect(router.push).toHaveBeenCalledWith(expect.stringMatching(/^\/people\/view\?id=/));
  });

  it('a read-only role sees the list but no add button', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<PeopleScreen />);
    await screen.findByRole('row', { name: /Alice Owner/ });
    expect(screen.queryByRole('button', { name: 'Add person' })).not.toBeInTheDocument();
  });
});

describe('PersonView', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  async function holder() {
    const asset = (await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: 1 }))
      .data[0]!;
    return { asset, personId: asset.current_assignment!.target_id };
  }

  it('shows the details, what the person holds and a history of past custody', async () => {
    const { asset, personId } = await holder();
    window.history.pushState({}, '', `/people/view/?id=${personId}&tab=assets`);
    const { container } = renderApp(<PersonView />, { workflows: true });
    expect(await screen.findByTestId('person-name')).toBeVisible();
    const row = await screen.findByRole('row', { name: new RegExp(asset.asset_tag) });
    expect(within(row).getByRole('link', { name: asset.asset_tag })).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('the History tab lists every custody period of the person', async () => {
    const { personId } = await holder();
    window.history.pushState({}, '', `/people/view/?id=${personId}&tab=history`);
    renderApp(<PersonView />, { workflows: true });
    const history = await screen.findByRole('list', { name: 'History' });
    expect(within(history).getAllByRole('listitem').length).toBeGreaterThan(0);
    // the server timeline of the person (GET /v1/people/{id}/history): events with the asset tag
    expect(history).toHaveTextContent(/Checked out/);
  });

  it('checks an asset in from the person page and the row disappears', async () => {
    const { asset, personId } = await holder();
    window.history.pushState({}, '', `/people/view/?id=${personId}&tab=assets`);
    const user = userEvent.setup();
    renderApp(<PersonView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: `Check in ${asset.asset_tag}` }));
    const dialog = await screen.findByRole('dialog', { name: `Check in ${asset.asset_tag}` });
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    expect(await screen.findByText(`${asset.asset_tag} checked in.`)).toBeVisible();
    await waitFor(() =>
      expect(
        screen.queryByRole('row', { name: new RegExp(asset.asset_tag) }),
      ).not.toBeInTheDocument(),
    );
  });

  it('archiving a person who holds assets is refused, then deactivating anyway needs a reason', async () => {
    const { personId } = await holder();
    window.history.pushState({}, '', `/people/view/?id=${personId}`);
    const user = userEvent.setup();
    renderApp(<PersonView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: /^Archive / });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await within(dialog).findByText(/still holds assets/)).toBeVisible();
    // the reason is required (the API refuses `force` without one)
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate anyway' }));
    expect(await within(dialog).findByText('This field is required.')).toBeVisible();
    await user.type(within(dialog).getByRole('textbox', { name: /^Reason/ }), 'Left the school');
    await user.click(within(dialog).getByRole('button', { name: 'Deactivate anyway' }));
    expect(await screen.findByText(/deactivated\./)).toBeVisible();
  });

  it('shows the not-found screen for an unknown person', async () => {
    window.history.pushState({}, '', '/people/view/?id=0190a6b2-0011-7000-8000-000000009999');
    renderApp(<PersonView />, { workflows: true });
    expect(await screen.findByTestId('person-not-found')).toBeVisible();
  });
});
