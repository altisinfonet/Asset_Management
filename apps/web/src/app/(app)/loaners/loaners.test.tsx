import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { custodySettingsApi, loanersApi } from '@/lib/loaners/api';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { LoanersScreen } from './loaners-screen';
import { PoolView } from './pool/pool-view';
import { PoolsScreen } from './pools/pools-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function students() {
  return (await loanersApi.pools()).data.find((p) => p.name.startsWith('Student'))!;
}
async function members(poolId: string) {
  return (await loanersApi.members(poolId)).data;
}
/** A deployable device that is in no pool. */
async function looseDevice() {
  const pools = (await loanersApi.pools()).data;
  const taken = new Set(
    (await Promise.all(pools.map((p) => members(p.id)))).flat().map((m) => m.asset_id),
  );
  return (
    await assetsApi.list({ limit: 200, state_type: ['deployable'], assigned: false })
  ).data.find((a) => !taken.has(a.id))!;
}

describe('loaner dashboard', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('shows the totals, a card per pool with its four numbers and the way into each list', async () => {
    const { container } = renderApp(<LoanersScreen />);
    const pool = await students();
    const card = await screen.findByRole('article', { name: /Student Chromebook loaners/ });
    // 8 devices: 3 out (1 overdue, 1 due today), 5 free
    expect(within(card).getByTestId(`pool-${pool.id}-available`)).toHaveTextContent('5');
    expect(within(card).getByTestId(`pool-${pool.id}-onLoan`)).toHaveTextContent('3');
    expect(within(card).getByTestId(`pool-${pool.id}-overdue`)).toHaveTextContent('1');
    expect(within(card).getByTestId(`pool-${pool.id}-dueToday`)).toHaveTextContent('1');
    expect(within(card).getByTestId(`pool-${pool.id}-overdue`)).toHaveAttribute(
      'href',
      `/loaners/pool?id=${pool.id}&show=overdue`,
    );
    expect(screen.getByTestId('loaner-total-inPool')).toHaveTextContent('11');
    expect(screen.getByTestId('loaner-total-available')).toHaveTextContent('7');
    expect(screen.getByTestId('loaner-total-onLoan')).toHaveTextContent('4');
    expect(screen.getByRole('link', { name: 'Loaner desk' })).toHaveAttribute(
      'href',
      '/loaners/desk',
    );
    expect(screen.getByRole('link', { name: 'Bulk return' })).toHaveAttribute(
      'href',
      '/loaners/desk?mode=return',
    );
    await expectNoA11yViolations(container);
  });

  it('lists the overdue loans with the borrower, how late and how to reach them', async () => {
    const user = userEvent.setup();
    renderApp(<LoanersScreen />);
    // every overdue check-out, loaner or not, until a pool is chosen
    await user.click(await screen.findByRole('combobox', { name: 'Show overdue loans of' }));
    await user.click(await screen.findByRole('option', { name: 'Student Chromebook loaners' }));
    const table = await screen.findByRole('table', { name: 'Overdue loans' });
    const late = await within(table).findByText('5 days late');
    const row = late.closest('tr')!;
    expect(within(row).getByText(/^AT-/)).toBeVisible();
    expect(within(row).getByText('Student Chromebook loaners')).toBeVisible();
    // the borrower is a link to the person, the contact an email link
    expect(within(row).getAllByRole('link').length).toBeGreaterThanOrEqual(2);
    const mail = within(row).queryByRole('link', { name: /@/ });
    if (mail) expect(mail.getAttribute('href')).toMatch(/^mailto:/);
    expect(within(table).getAllByRole('row')).toHaveLength(2);
  });

  it('shows what happened lately, newest first', async () => {
    renderApp(<LoanersScreen />);
    const heading = await screen.findByRole('heading', { name: 'Recent activity' });
    const list = await within(heading.closest('section')!).findByRole('list');
    const items = within(list).getAllByRole('listitem');
    expect(items.length).toBeGreaterThan(0);
    expect(items[0]).toHaveTextContent(/lent to/);
  });

  it('a viewer sees the numbers but not the desk', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<LoanersScreen />);
    await screen.findByRole('article', { name: /Student Chromebook loaners/ });
    expect(screen.queryByRole('link', { name: 'Loaner desk' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Bulk return' })).not.toBeInTheDocument();
  });
});

describe('loaner pools', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lists the pools with their loan lengths and the organisation defaults, no axe violations', async () => {
    const { container } = renderApp(<PoolsScreen />);
    const row = await screen.findByRole('row', { name: /Student Chromebook loaners/ });
    expect(within(row).getByText('7 days')).toBeVisible();
    expect(within(row).getByText('28 days')).toBeVisible();
    expect(within(row).getByText('Active')).toBeVisible();
    // no return date is offered at check-out until the organisation sets one; reminders default to 2 days
    expect(
      await screen.findByLabelText('Return date offered at check-out (days from today)'),
    ).toHaveValue(null);
    expect(screen.getByLabelText('Remind the borrower (days before the due date)')).toHaveValue(2);
    await expectNoA11yViolations(container);
  });

  it('creates a pool, checking the lengths first', async () => {
    const user = userEvent.setup();
    renderApp(<PoolsScreen />);
    await user.click(await screen.findByRole('button', { name: 'New pool' }));
    const dialog = await screen.findByRole('dialog', { name: 'New loaner pool' });
    await expectNoA11yViolations(dialog);
    await user.type(within(dialog).getByLabelText(/^Name/), 'Exam week');
    const days = within(dialog).getByLabelText(/Default loan length/);
    await user.clear(days);
    await user.type(days, '10');
    await user.type(within(dialog).getByLabelText(/Longest loan/), '5');
    await user.click(within(dialog).getByRole('button', { name: 'Create pool' }));
    expect(
      await within(dialog).findByText('The longest loan cannot be shorter than the default.'),
    ).toBeVisible();
    await user.clear(within(dialog).getByLabelText(/Longest loan/));
    await user.type(within(dialog).getByLabelText(/Longest loan/), '14');
    await user.click(within(dialog).getByRole('button', { name: 'Create pool' }));
    expect(await screen.findByText('Pool "Exam week" created.')).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('row', { name: /Exam week/ })).toHaveTextContent('14 days');
  });

  it('creates a pool without its own loan length (it inherits) and chooses who is e-mailed without a login', async () => {
    const user = userEvent.setup();
    renderApp(<PoolsScreen />);
    await user.click(await screen.findByRole('button', { name: 'New pool' }));
    const dialog = await screen.findByRole('dialog', { name: 'New loaner pool' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Inheriting cart');
    expect(within(dialog).getByLabelText(/Default loan length/)).toHaveValue(null);
    const email = within(dialog).getByLabelText(/E-mail borrowers who have no login/);
    expect(email).toHaveTextContent(
      'Automatic: employees, contractors and external people, not students',
    );
    await user.click(email);
    await user.click(await screen.findByRole('option', { name: 'Always, students too' }));
    await user.click(within(dialog).getByRole('button', { name: 'Create pool' }));
    expect(await screen.findByText('Pool "Inheriting cart" created.')).toBeVisible();
    const row = await screen.findByRole('row', { name: /Inheriting cart/ });
    expect(row).toHaveTextContent('7 days (organisation default)');
  });

  it('shows the server refusing a second pool with the same name', async () => {
    const user = userEvent.setup();
    renderApp(<PoolsScreen />);
    await user.click(await screen.findByRole('button', { name: 'New pool' }));
    const dialog = await screen.findByRole('dialog', { name: 'New loaner pool' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'staff laptop loaners');
    await user.click(within(dialog).getByRole('button', { name: 'Create pool' }));
    expect(await within(dialog).findByText(/already in use|already exists/i)).toBeVisible();
  });

  it('edits a pool', async () => {
    const user = userEvent.setup();
    renderApp(<PoolsScreen />);
    await user.click(await screen.findByRole('button', { name: 'Edit Staff laptop loaners' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Staff laptop loaners' });
    const days = within(dialog).getByLabelText(/Default loan length/);
    await user.clear(days);
    await user.type(days, '21');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Pool "Staff laptop loaners" saved.')).toBeVisible();
    expect(await screen.findByRole('row', { name: /Staff laptop loaners/ })).toHaveTextContent(
      '21 days',
    );
  });

  it('saves the organisation defaults and checks the numbers first', async () => {
    const user = userEvent.setup();
    renderApp(<PoolsScreen />);
    const expected = await screen.findByLabelText(
      'Return date offered at check-out (days from today)',
    );
    await waitFor(() =>
      expect(screen.getByLabelText('Remind the borrower (days before the due date)')).toHaveValue(
        2,
      ),
    );
    await user.type(expected, '999');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(
      await screen.findByText('Enter a whole number from 1 to 366, or leave it empty.'),
    ).toBeVisible();
    await user.clear(expected);
    await user.type(expected, '14');
    const reminder = screen.getByLabelText('Remind the borrower (days before the due date)');
    await user.clear(reminder);
    await user.type(reminder, '3');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(await screen.findByText('Loan defaults saved.')).toBeVisible();
    expect((await custodySettingsApi.get()).value).toEqual({
      default_expected_return_days: 14,
      loan_reminder_days: 3,
    });
  });

  it('a viewer reads the pools but cannot change them', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<PoolsScreen />);
    await screen.findByRole('row', { name: /Student Chromebook loaners/ });
    expect(screen.queryByRole('button', { name: 'New pool' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save defaults' })).not.toBeInTheDocument();
  });
});

describe('one pool', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('filters the devices: overdue shows only the late one, with who has it', async () => {
    const pool = await students();
    window.history.pushState({}, '', `/loaners/pool?id=${pool.id}&show=overdue`);
    const { container } = renderApp(<PoolView />);
    const table = await screen.findByRole('table', {
      name: 'Devices in Student Chromebook loaners',
    });
    const rows = await within(table).findAllByRole('row');
    // the header row and one device
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('Overdue');
    expect(rows[1]).toHaveTextContent('5 days late');
    expect(screen.getByTestId('pool-range')).toHaveTextContent('Showing 1 of 8');
    await expectNoA11yViolations(container);
  });

  it('opens a filter through the URL', async () => {
    const pool = await students();
    window.history.pushState({}, '', `/loaners/pool?id=${pool.id}`);
    const user = userEvent.setup();
    renderApp(<PoolView />);
    await screen.findByRole('table', { name: /Devices in/ });
    await user.click(screen.getByRole('button', { name: 'Available' }));
    expect(router.replace).toHaveBeenCalledWith(`/loaners/pool?id=${pool.id}&show=available`);
  });

  it('takes a device back from its row', async () => {
    const pool = await students();
    const out = (await members(pool.id)).find((m) => !m.available)!;
    window.history.pushState({}, '', `/loaners/pool?id=${pool.id}&show=on_loan`);
    const user = userEvent.setup();
    renderApp(<PoolView />);
    await user.click(await screen.findByRole('button', { name: `Return ${out.asset?.asset_tag}` }));
    expect(await screen.findByText(`${out.asset?.asset_tag} returned.`)).toBeVisible();
    await waitFor(async () =>
      expect((await members(pool.id)).find((m) => m.asset_id === out.asset_id)?.available).toBe(
        true,
      ),
    );
  });

  it('adds a device and does not remove one that is out', async () => {
    const pool = await students();
    const spare = await looseDevice();
    window.history.pushState({}, '', `/loaners/pool?id=${pool.id}`);
    const user = userEvent.setup();
    renderApp(<PoolView />);
    await screen.findByRole('table', { name: /Devices in/ });
    const removeOut = screen
      .getAllByRole('button', { name: /^Remove .* from the pool$/ })
      .find((b) => b.hasAttribute('disabled'));
    expect(removeOut).toBeDefined();

    await user.click(screen.getByRole('button', { name: 'Add device' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Add a device to Student Chromebook loaners',
    });
    await expectNoA11yViolations(dialog);
    await user.click(within(dialog).getByRole('button', { name: 'Add to pool' }));
    expect(await within(dialog).findByText('Choose a device.')).toBeVisible();
    await user.click(within(dialog).getByRole('combobox'));
    await user.type(within(dialog).getByRole('combobox'), spare.asset_tag);
    await user.click(await screen.findByRole('option', { name: new RegExp(spare.asset_tag) }));
    await user.click(within(dialog).getByRole('button', { name: 'Add to pool' }));
    expect(await screen.findByText(`${spare.asset_tag} added to the pool.`)).toBeVisible();
    expect((await members(pool.id)).some((m) => m.asset_id === spare.id)).toBe(true);
  });

  it('archives a pool that has nothing out and goes back to the list', async () => {
    const { value } = await loanersApi.createPool({ name: 'Short lived' });
    window.history.pushState({}, '', `/loaners/pool?id=${value.id}`);
    const user = userEvent.setup();
    renderApp(<PoolView />);
    await user.click(await screen.findByRole('button', { name: 'Archive pool' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Short lived?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive pool' }));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/loaners/pools'));
  });

  it('says so for a pool that does not exist', async () => {
    window.history.pushState({}, '', '/loaners/pool?id=0190a6b2-00b1-7000-8000-000000000999');
    renderApp(<PoolView />);
    expect(
      await screen.findByRole('heading', {
        name: 'This pool does not exist or you cannot see it.',
      }),
    ).toBeVisible();
  });
});
