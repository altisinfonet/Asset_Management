import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { renderApp, seedSession } from '@/test/render';
import { DepartmentsScreen } from './departments-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

describe('DepartmentsScreen', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('lists the departments with code, manager and the people and asset counts, with no axe violations', async () => {
    const { container } = renderApp(<DepartmentsScreen />);
    const row = await screen.findByRole('row', { name: /Mathematics/ });
    expect(within(row).getByText('MATH')).toBeVisible();
    expect(
      within(await screen.findByRole('row', { name: /^IT/ })).getByText('Alice Owner'),
    ).toBeVisible();
    expect(screen.getAllByRole('row').length).toBeGreaterThanOrEqual(7);
    await expectNoA11yViolations(container);
  });

  it('adds a department, refuses a duplicate name on the Name field, and renames it', async () => {
    const user = userEvent.setup();
    renderApp(<DepartmentsScreen />);
    await screen.findByRole('row', { name: /Mathematics/ });
    await user.click(screen.getByRole('button', { name: 'Add department' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a department' });
    await user.click(within(dialog).getByRole('button', { name: 'Add department' }));
    expect(await within(dialog).findByText('This field is required.')).toBeVisible();

    await user.type(within(dialog).getByLabelText(/^Name/), ' mathematics ');
    await user.click(within(dialog).getByRole('button', { name: 'Add department' }));
    expect(await within(dialog).findByText('This value is already in use.')).toBeVisible();

    await user.clear(within(dialog).getByLabelText(/^Name/));
    await user.type(within(dialog).getByLabelText(/^Name/), 'Art');
    await user.type(within(dialog).getByLabelText(/^Code/), 'ART');
    await user.click(within(dialog).getByRole('button', { name: 'Add department' }));
    expect(await screen.findByText('Department "Art" added.')).toBeVisible();
    expect(await screen.findByRole('row', { name: /Art/ })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Edit Art' }));
    const edit = await screen.findByRole('dialog', { name: 'Edit Art' });
    await user.clear(within(edit).getByLabelText(/^Name/));
    await user.type(within(edit).getByLabelText(/^Name/), 'Arts');
    await user.click(within(edit).getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('Department "Arts" saved.')).toBeVisible();
    expect(await screen.findByRole('row', { name: /Arts/ })).toBeVisible();
  });

  it('an empty department archives at once', async () => {
    const user = userEvent.setup();
    renderApp(<DepartmentsScreen />);
    await screen.findByRole('row', { name: /Mathematics/ });
    await user.click(screen.getByRole('button', { name: 'Add department' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add a department' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Spare');
    await user.click(within(dialog).getByRole('button', { name: 'Add department' }));
    await screen.findByRole('row', { name: /Spare/ });
    await user.click(screen.getByRole('button', { name: 'Archive Spare' }));
    const confirm = await screen.findByRole('dialog', { name: 'Archive Spare?' });
    await user.click(within(confirm).getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('Department archived.')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /Spare/ })).not.toBeInTheDocument(),
    );
  });

  it('archiving a department in use says what uses it, and merging moves everything to another one', async () => {
    const user = userEvent.setup();
    renderApp(<DepartmentsScreen />);
    const science = await screen.findByRole('row', { name: /Science/ });
    const people = Number(within(science).getAllByRole('cell')[3]!.textContent);
    expect(people).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Archive Science' }));
    const dialog = await screen.findByRole('dialog', { name: 'Archive Science?' });
    await user.click(within(dialog).getByRole('button', { name: 'Archive' }));

    // refused: the counts are named and the merge picker appears
    expect(await within(dialog).findByText(/Still in use by/)).toHaveTextContent(
      `${people} people`,
    );
    const merge = within(dialog).getByRole('button', { name: 'Merge and archive' });
    expect(merge).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: /Move them to/ }));
    // not offered: the department itself
    expect(screen.queryByRole('option', { name: /^Science/ })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('option', { name: /^Mathematics/ }));
    await user.click(merge);

    expect(await screen.findByText('Merged into "Mathematics".')).toBeVisible();
    await waitFor(() =>
      expect(screen.queryByRole('row', { name: /Science/ })).not.toBeInTheDocument(),
    );
    const maths = await screen.findByRole('row', { name: /Mathematics/ });
    await waitFor(() =>
      expect(Number(within(maths).getAllByRole('cell')[3]!.textContent)).toBeGreaterThan(people),
    );
  });

  it('a read-only role sees the list and no write buttons', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<DepartmentsScreen />);
    await screen.findByRole('row', { name: /Mathematics/ });
    expect(screen.queryByRole('button', { name: 'Add department' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Archive / })).not.toBeInTheDocument();
  });
});
