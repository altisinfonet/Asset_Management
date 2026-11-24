import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loanersApi } from '@/lib/loaners/api';
import { assetsApi, peopleApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { DeskScreen } from './desk-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/** The two seeded pools: staff laptops (two devices per borrower, 3 laptops, 1 out) and students. */
async function pool(prefix: string) {
  return (await loanersApi.pools()).data.find((p) => p.name.startsWith(prefix))!;
}
async function members(poolId: string, available?: boolean) {
  return (await loanersApi.members(poolId, available === undefined ? {} : { available })).data;
}
const tagOf = (m: Awaited<ReturnType<typeof members>>[number]) => m.asset!.asset_tag;

describe('loaner desk', () => {
  beforeEach(() => {
    resetRouter();
    window.history.pushState({}, '', '/loaners/desk');
    window.localStorage.clear();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('lends several devices with the keyboard in one go, the borrower stays', async () => {
    const staff = await pool('Staff');
    const [a, b] = (await members(staff.id, true)).map(tagOf);
    const user = userEvent.setup();
    const { container } = renderApp(<DeskScreen />, { workflows: true });
    const device = await screen.findByLabelText('Device');
    await waitFor(() => expect(device).toHaveFocus());
    await expectNoA11yViolations(container);

    await user.type(device, `${a}{Enter}`);
    await user.type(device, `${b}{Enter}`);
    const queue = await screen.findByRole('list', { name: 'Devices to lend' });
    expect(within(queue).getAllByRole('listitem')).toHaveLength(2);
    // the pool's two weeks are filled in
    await waitFor(() => expect(screen.getByLabelText('Due date')).not.toHaveValue(''));
    const borrower = await screen.findByLabelText('Borrower');
    await user.type(borrower, 'Alice Owner{Enter}');
    const lend = await screen.findByRole('button', { name: 'Lend 2 devices' });
    await waitFor(() => expect(lend).toHaveFocus());
    expect(screen.getByTestId('desk-summary')).toHaveTextContent('Lend 2 devices to Alice Owner');

    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        /2 devices lent to Alice Owner, due /,
      ),
    );
    expect(screen.getByTestId('desk-feedback')).toHaveAttribute('role', 'status');
    // the list is empty, the borrower stays, the device field has focus again
    expect(screen.queryByRole('list', { name: 'Devices to lend' })).not.toBeInTheDocument();
    expect(screen.getByText('Alice Owner')).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Device')).toHaveFocus());
    const after = await members(staff.id);
    expect(
      after.filter((m) => m.asset?.current_assignment?.target_name === 'Alice Owner'),
    ).toHaveLength(2);
  });

  it('Enter on an empty device field lends what is in the list', async () => {
    const staff = await pool('Staff');
    const tag = tagOf((await members(staff.id, true))[0]!);
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    const device = await screen.findByLabelText('Device');
    await user.type(await screen.findByLabelText('Borrower'), 'Alice Owner{Enter}');
    await user.click(device);
    await user.type(device, `${tag}{Enter}`);
    await user.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(`${tag} lent to Alice Owner`),
    );
  });

  it('keeps a device the pool refused in the list with its problem while the others go', async () => {
    const staff = await pool('Staff');
    const tag = tagOf((await members(staff.id, true))[0]!);
    const students = await pool('Student');
    const stranger = tagOf((await members(students.id, true))[0]!);
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    const device = await screen.findByLabelText('Device');
    await user.type(device, `${tag}{Enter}`);
    await user.type(device, `${stranger}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'Alice Owner{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Lend 2 devices' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('1 of 2 devices lent to Alice Owner.'));
    const queue = screen.getByRole('list', { name: 'Devices to lend' });
    const rows = within(queue).getAllByRole('listitem');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent(
      `${stranger} is not in this loaner pool. Add it to the pool first.`,
    );
    // it can be taken off the list
    await user.click(within(rows[0]!).getByRole('button', { name: `Remove ${stranger}` }));
    expect(screen.queryByRole('list', { name: 'Devices to lend' })).not.toBeInTheDocument();
  });

  it('says a device is already out and offers to return it', async () => {
    const staff = await pool('Staff');
    const out = (await members(staff.id, false)).find((m) => m.asset?.current_assignment)!;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${tagOf(out)}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'Alice Owner{Enter}');
    await user.click(await screen.findByRole('button', { name: 'Lend 1 device' }));
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(alert).toHaveTextContent('No device could be lent: see the list.'));
    expect(screen.getByRole('list', { name: 'Devices to lend' })).toHaveTextContent(
      `${tagOf(out)} is already out.`,
    );
    await user.click(within(alert).getByRole('button', { name: 'Return it instead' }));
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(`${tagOf(out)} returned.`),
    );
  });

  it('stops a borrower at the most devices the pool allows, naming the device', async () => {
    const students = await pool('Student');
    const holder = (await members(students.id, false)).find((m) => m.asset?.current_assignment)!;
    const person = (await peopleApi.get(holder.asset!.current_assignment!.target_id)).value;
    const free = tagOf((await members(students.id, true))[0]!);
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.click(await screen.findByRole('combobox', { name: 'Lend from' }));
    await user.click(await screen.findByRole('option', { name: 'Student Chromebook loaners' }));
    await user.type(await screen.findByLabelText('Device'), `${free}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), `${person.display_name}{Enter}`);
    await user.click(await screen.findByRole('button', { name: 'Lend 1 device' }));
    await waitFor(() =>
      expect(screen.getByRole('list', { name: 'Devices to lend' })).toHaveTextContent(
        `${person.display_name} already holds the most devices this pool allows.`,
      ),
    );
  });

  it('shows what stops the whole request: a switched-off pool', async () => {
    const staff = await pool('Staff');
    const tag = tagOf((await members(staff.id, true))[0]!);
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${tag}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'Alice Owner{Enter}');
    // somebody switches the pool off while the screen is open
    await loanersApi.updatePool(staff.id, { is_active: false });
    await user.click(await screen.findByRole('button', { name: 'Lend 1 device' }));
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        'This pool is switched off and lends nothing.',
      ),
    );
  });

  it('lists several matches for a borrower to choose from', async () => {
    const staff = await pool('Staff');
    const tag = tagOf((await members(staff.id, true))[0]!);
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${tag}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'a{Enter}');
    const list = await screen.findByRole('list', { name: 'Matches' });
    const choices = within(list).getAllByRole('button');
    expect(choices.length).toBeGreaterThan(1);
    await user.click(choices[0]!);
    expect(screen.getByRole('button', { name: 'Change borrower' })).toBeVisible();
  });

  it('warns when the due date is beyond what the pool allows', async () => {
    const staff = await pool('Staff');
    const tag = tagOf((await members(staff.id, true))[0]!);
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Device'), `${tag}{Enter}`);
    await user.type(await screen.findByLabelText('Borrower'), 'Alice Owner{Enter}');
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2099-01-01' } });
    await user.click(await screen.findByRole('button', { name: 'Lend 1 device' }));
    expect(await screen.findByText(/The pool allows loans until .* at most\./)).toBeVisible();
  });

  it('accepts a scanner anywhere on the page: a device, then the borrower card', async () => {
    const staff = await pool('Staff');
    const tag = tagOf((await members(staff.id, true))[0]!);
    const person = (await peopleApi.list({ limit: 50, status: 'active' })).data.find(
      (p) => p.employee_ref,
    )!;
    renderApp(<DeskScreen />, { workflows: true });
    await screen.findByLabelText('Device');
    (document.activeElement as HTMLElement | null)?.blur();
    const burst = (code: string) => {
      for (const key of [...code, 'Enter']) fireEvent.keyDown(document.body, { key });
    };
    burst(tag);
    const queue = await screen.findByRole('list', { name: 'Devices to lend' });
    expect(queue).toHaveTextContent(tag);
    (document.activeElement as HTMLElement | null)?.blur();
    await new Promise((resolve) => setTimeout(resolve, 900));
    burst(person.employee_ref!);
    expect(await screen.findByRole('button', { name: 'Change borrower' })).toBeVisible();
    expect(screen.getByText(person.display_name)).toBeVisible();
  });

  it('returns by scan in bulk, counting what worked and what did not', async () => {
    window.history.pushState({}, '', '/loaners/desk?mode=return');
    const students = await pool('Student');
    const out = (await members(students.id, false)).filter((m) => m.asset?.current_assignment);
    const user = userEvent.setup();
    const { container } = renderApp(<DeskScreen />, { workflows: true });
    const input = await screen.findByLabelText('Returned device');
    await waitFor(() => expect(input).toHaveFocus());
    await user.type(input, `${tagOf(out[0]!)}{Enter}`);
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        new RegExp(`${tagOf(out[0]!)} returned`),
      ),
    );
    await user.type(input, `${tagOf(out[1]!)}{Enter}`);
    await waitFor(() =>
      expect(screen.getByTestId('desk-return-summary')).toHaveTextContent('2 devices returned'),
    );
    // the same device again is not on loan any more
    await user.type(input, `${tagOf(out[0]!)}{Enter}`);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(`${tagOf(out[0]!)} is not on loan.`),
    );
    expect(screen.getByTestId('desk-return-summary')).toHaveTextContent(
      '2 devices returned, 1 problem',
    );
    const log = within(screen.getByTestId('desk-log')).getAllByRole('listitem');
    expect(log).toHaveLength(3);
    expect(log[0]).toHaveTextContent('Problem: ');
    await expectNoA11yViolations(container);
    expect((await pool('Student')).checked_out_count).toBe(1);
  });

  it('refuses a device that is in no pool when returning', async () => {
    window.history.pushState({}, '', '/loaners/desk?mode=return');
    const taken = new Set(
      (await Promise.all((await loanersApi.pools()).data.map((p) => members(p.id))))
        .flat()
        .map((m) => m.asset_id),
    );
    const loose = (
      await assetsApi.list({ limit: 200, state_type: ['deployable'], assigned: false })
    ).data.find((a) => !taken.has(a.id))!;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Returned device'), `${loose.asset_tag}{Enter}`);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        `${loose.asset_tag} is not in this loaner pool.`,
      ),
    );
  });

  it('says a late return is late', async () => {
    window.history.pushState({}, '', '/loaners/desk?mode=return');
    const students = await pool('Student');
    const late = (await members(students.id, false)).find(
      (m) => m.asset?.current_assignment?.overdue,
    )!;
    const user = userEvent.setup();
    renderApp(<DeskScreen />, { workflows: true });
    await user.type(await screen.findByLabelText('Returned device'), `${tagOf(late)}{Enter}`);
    await waitFor(() =>
      expect(screen.getByTestId('desk-feedback')).toHaveTextContent(
        `${tagOf(late)} returned, 5 days late.`,
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
