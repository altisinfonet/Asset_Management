import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { LocationsScreen } from './locations-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const tree = () => screen.findByRole('tree', { name: 'Locations' });

describe('LocationsScreen', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('shows the roots with their asset counts and no axe violations', async () => {
    const { container } = renderApp(<LocationsScreen />);
    const site = within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ });
    expect(site).toHaveAttribute('aria-level', '1');
    expect(site).toHaveAttribute('aria-expanded', 'false');
    expect(site).toHaveTextContent(/\d+ assets/);
    await expectNoA11yViolations(container);
  });

  it('keyboard: Right opens, Right again enters the first child, Left goes back, Enter selects', async () => {
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    const site = within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ });
    site.focus();
    await user.keyboard('{ArrowRight}');
    expect(site).toHaveAttribute('aria-expanded', 'true');
    await user.keyboard('{ArrowRight}');
    const building = await screen.findByRole('treeitem', { name: /^Main building/ });
    await waitFor(() => expect(building).toHaveFocus());
    expect(building).toHaveAttribute('aria-level', '2');
    await user.keyboard('{ArrowLeft}');
    await waitFor(() => expect(site).toHaveFocus());
    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('location-name')).toHaveTextContent('Riverside Elementary');
    expect(site).toHaveAttribute('aria-selected', 'true');
    expect(router.replace).toHaveBeenCalledWith(expect.stringContaining('/locations?id='));
  });

  it('a click selects, and the details list sublocations, address and the assets inside', async () => {
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    await user.click(within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ }));
    expect(await screen.findByTestId('location-name')).toHaveTextContent('Riverside Elementary');
    expect(screen.getByRole('button', { name: 'Main building' })).toBeVisible();
    const assets = await screen.findByRole('region', { name: 'Assets here' });
    await waitFor(() => expect(within(assets).getAllByRole('listitem')).toHaveLength(8));
    expect(within(assets).getByRole('link', { name: 'View in asset list' })).toHaveAttribute(
      'href',
      expect.stringMatching(/^\/assets\?location=/),
    );
  });

  it('search keeps the way to each match open and counts the matches', async () => {
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    await tree();
    await user.type(screen.getByRole('searchbox', { name: 'Search locations' }), 'room 1');
    expect(await screen.findByText('1 location matches')).toBeVisible();
    expect(screen.getByRole('treeitem', { name: /^Room 101/ })).toBeVisible();
    expect(screen.queryByRole('treeitem', { name: /^Gym/ })).not.toBeInTheDocument();
  });

  it('adds a location inside the selected one, then refuses a duplicate name on the field', async () => {
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    await user.click(within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ }));
    await user.click(await screen.findByRole('button', { name: 'Add inside' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a location' });
    expect(within(dialog).getByRole('combobox', { name: /Inside/ })).toHaveValue(
      'Riverside Elementary',
    );
    await user.click(within(dialog).getByRole('button', { name: 'Add location' }));
    expect(await within(dialog).findByText('This field is required.')).toBeVisible();
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Science lab');
    await user.click(within(dialog).getByRole('button', { name: 'Add location' }));
    expect(await screen.findByText('Location "Science lab" added.')).toBeVisible();
    expect(await screen.findByTestId('location-name')).toHaveTextContent('Science lab');

    await user.click(screen.getByRole('button', { name: 'Add inside' }));
    const again = await screen.findByRole('dialog', { name: 'Add a location' });
    await user.clear(within(again).getByRole('combobox', { name: /Inside/ }));
    await user.type(within(again).getByRole('combobox', { name: /Inside/ }), 'Riverside');
    await user.click(await screen.findByRole('option', { name: /^Riverside Elementary/ }));
    await user.type(within(again).getByRole('textbox', { name: /^Name/ }), 'SCIENCE LAB');
    await user.click(within(again).getByRole('button', { name: 'Add location' }));
    expect(
      await within(again).findByText('A location with this name already exists here'),
    ).toBeVisible();
  });

  it('the move dialog cannot put a location inside itself', async () => {
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    await user.click(within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ }));
    await user.click(await screen.findByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move Riverside Elementary' });
    await user.type(within(dialog).getByRole('combobox', { name: 'New parent' }), 'Main');
    expect(await screen.findByRole('option', { name: /^Main building/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  it('archiving a location that is in use is refused with the counts', async () => {
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    await user.click(within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Riverside Elementary?' });
    expect(within(dialog).getByRole('status')).toHaveTextContent('sublocations');
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/sublocation/);
  });

  it('a read-only role browses the tree and sees no write actions', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    const user = userEvent.setup();
    renderApp(<LocationsScreen />);
    await user.click(within(await tree()).getByRole('treeitem', { name: /^Riverside Elementary/ }));
    await screen.findByTestId('location-name');
    for (const name of ['Add location', 'Add inside', 'Move', 'Archive']) {
      expect(screen.queryByRole('button', { name })).not.toBeInTheDocument();
    }
  });
});
