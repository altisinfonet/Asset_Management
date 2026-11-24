import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loanersApi } from '@/lib/loaners/api';
import { assetsApi, peopleApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { DeskScreen } from './desk/desk-screen';
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
    expect(await screen.findByLabelText('Default loan length (days)')).toHaveValue(7);
    expect(screen.getByLabelText('Longest loan (days)')).toHaveValue(30);
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

  it('saves the organisation defaults and rejects a longest loan below the default', async () => {
    const user = userEvent.setup();
    renderApp(<PoolsScreen />);
    const days = await screen.findByLabelText('Default loan length (days)');
    await waitFor(() => expect(days).toHaveValue(7));
    await user.clear(days);
    await user.type(days, '40');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(
      await screen.findByText('The longest loan cannot be shorter than the default.'),
    ).toBeVisible();
    const max = screen.getByLabelText('Longest loan (days)');
    await user.clear(max);
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    expect(await screen.findByText('Loan defaults saved.')).toBeVisible();
    expect((await loanersApi.settings()).value).toMatchObject({
      default_loan_days: 40,
      max_loan_days: null,
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
    const spare = (
      await assetsApi.list({ limit: 200, state_type: ['deployable'], assigned: false })
    ).data.find((a) => !a.loaner_pool_id)!;
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
    expect((await assetsApi.get(spare.id)).value.loaner_pool_id).toBe(pool.id);
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

describe('loaner desk', () => {
  beforeEach(() => {
    resetRouter();
    window.history.pushState({}, '', '/loaners/desk');
    seedSession(MOCK_ACCOUNTS.owner);
  });

  async function freeDevice() {
    const pool = await students();
    return (await loanersApi.members(pool.id, { available: true })).data[0]!;
  }

  it('lends with the keyboard: device, borrower, Enter; the borrower stays for the next device', async () => {
    const free = await freeDevice();
    const user = userEvent.setup();
    const { container } = renderApp(<DeskScreen />, { workflows: true });
    const device = await screen.findByLabelText('Device');
    await waitFor(() => expect(device).toHaveFocus());
    await expectNoA11yViolations(container);

    await user.type(device, `${free.asset?.asset_tag}{Enter}`);
    expect(await screen.findByText(new RegExp(`In Student Chromebook loaners`))).toBeVisible();
    const borrower = await screen.findByLabelText('Borrower');
    await waitFor(() => expect(borrower).toHaveFocus());
    // the pool's seven days are filled in
    await waitFor(() => expect(screen.getByLabelText('Due date')).not.toHaveValue(''));
    await user.type(borrower, 'Alice Owner{Enter}');
    const lend = await screen.findByRole('button', { name: 'Lend device' });
    await waitFor(() => expect(lend).toHaveFocus());
    expect(screen.getByTestId('desk-summary')).toHaveTextContent(
      `Lend ${free.asset?.asset_tag} to Alice Owner`,
    );

    await user.keyboard('{Enter}');
    const feedback = await screen.findByTestId('desk-feedback');
    await waitFor(() =>
      expect(feedback).toHaveTextContent(
        new RegExp(`${free.asset?.asset_tag} lent to Alice Owner, due `),
      ),
    );
    expect(feedback).toHaveAttribute('role', 'status');
    // the device is cleared, the borrower stays
    expect(screen.getByText('Alice Owner')).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Device')).toHaveFocus());
    const pool = await students();
    const lent = (await members(pool.id)).find((m) => m.asset_id === free.asset_id)!;
    expect(lent.available).toBe(false);
    expect(lent.asset?.current_assignment?.target_name).toBe('Alice Owner');
  });

  it('refuses a device that is not in a pool, in words and as an alert', async () => {
    const spare = (
      await assetsApi.list({ limit: 200, state_type: ['deployable'], assigned: false })
    ).data.find((a) => !a.loaner_pool_id)!;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${spare.asset_tag}{Enter}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      `${spare.asset_tag} is not in a loaner pool. Add it to a pool first.`,
    );
  });

  it('says who has a device that is already out and offers to return it', async () => {
    const pool = await students();
    const out = (await members(pool.id)).find(
      (m) => !m.available && !m.asset?.current_assignment?.overdue,
    )!;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${out.asset?.asset_tag}{Enter}`);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      `${out.asset?.asset_tag} is already on loan to ${out.asset?.current_assignment?.target_name}, due`,
    );
    await user.click(within(alert).getByRole('button', { name: 'Return it instead' }));
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        `${out.asset?.asset_tag} returned by`,
      ),
    );
  });

  it('stops a borrower at the most devices the pool allows', async () => {
    const free = await freeDevice();
    const pool = await students();
    const holder = (await members(pool.id)).find((m) => !m.available)!.asset!.current_assignment!;
    const person = (await peopleApi.get(holder.target_id)).value;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${free.asset?.asset_tag}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), `${person.display_name}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'Lend device' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(
      `${person.display_name} already holds the most devices this pool allows.`,
    );
  });

  it('lists several matches for a borrower to choose from', async () => {
    const free = await freeDevice();
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${free.asset?.asset_tag}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'a{Enter}');
    const list = await screen.findByRole('list', { name: 'Matches' });
    const choices = within(list).getAllByRole('button');
    expect(choices.length).toBeGreaterThan(1);
    await user.click(choices[0]!);
    expect(screen.getByRole('button', { name: 'Change borrower' })).toBeVisible();
  });

  it('warns when the due date is beyond what the pool allows', async () => {
    const free = await freeDevice();
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${free.asset?.asset_tag}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'Alice Owner{Enter}');
    const due = screen.getByLabelText('Due date');
    fireEvent.change(due, { target: { value: '2099-01-01' } });
    await user.click(await screen.findByRole('button', { name: 'Lend device' }));
    expect(await screen.findByText(/The pool allows loans until .* at most\./)).toBeVisible();
  });

  it('accepts a scanner anywhere on the page: device, then the borrower card', async () => {
    const free = await freeDevice();
    const person = (await peopleApi.list({ limit: 50, status: 'active' })).data.find(
      (p) => p.employee_ref,
    )!;
    renderApp(<DeskScreen />, { workflows: true });
    await screen.findByLabelText('Device');
    (document.activeElement as HTMLElement | null)?.blur();
    const burst = (code: string) => {
      for (const key of [...code, 'Enter']) fireEvent.keyDown(document.body, { key });
    };
    burst(free.asset!.asset_tag);
    expect(await screen.findByText(/In Student Chromebook loaners/)).toBeVisible();
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((resolve) => setTimeout(resolve, 900));
    burst(person.employee_ref!);
    expect(await screen.findByRole('button', { name: 'Change borrower' })).toBeVisible();
    expect(screen.getByText(person.display_name)).toBeVisible();
  });

  it('returns by scan in bulk, counting what worked and what did not', async () => {
    window.history.pushState({}, '', '/loaners/desk?mode=return');
    const pool = await students();
    const out = (await members(pool.id)).filter((m) => !m.available);
    const user = userEvent.setup();
    const { container } = renderApp(<DeskScreen />, { workflows: true });
    const input = await screen.findByLabelText('Returned device');
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, `${out[0]!.asset?.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        `${out[0]!.asset?.asset_tag} returned`,
      ),
    );
    await user.type(input, `${out[1]!.asset?.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(screen.getByTestId('desk-return-summary')).toHaveTextContent('2 devices returned'),
    );
    // the same device again is not on loan any more
    await user.type(input, `${out[0]!.asset?.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        `${out[0]!.asset?.asset_tag} is not on loan.`,
      ),
    );
    expect(screen.getByTestId('desk-return-summary')).toHaveTextContent(
      '2 devices returned, 1 problem',
    );
    const log = within(screen.getByTestId('desk-log')).getAllByRole('listitem');
    expect(log).toHaveLength(3);
    expect(log[0]).toHaveTextContent('Problem: ');
    await expectNoA11yViolations(container);
    // the pool agrees
    expect((await students()).checked_out_count).toBe(1);
  });

  it('says a late return is late', async () => {
    window.history.pushState({}, '', '/loaners/desk?mode=return');
    const pool = await students();
    const late = (await members(pool.id)).find((m) => m.asset?.current_assignment?.overdue)!;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(
      await screen.findByLabelText('Returned device'),
      `${late.asset?.asset_tag}{Enter}`,
    );
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        /returned by .*, 5 days late\./,
      ),
    );
  });

  it('switches between lending and returning through the URL', async () => {
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Return' }));
    expect(router.replace).toHaveBeenCalledWith('/loaners/desk?mode=return');
  });
});
