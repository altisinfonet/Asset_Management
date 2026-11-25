import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { roleIdFor, uid } from '@/mocks/registry-fixtures';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { renderApp, seedSession } from '@/test/render';
import { UsersScreen } from './users-screen';

describe('UsersScreen role column', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  it('renders each role as a dense ghost select that still opens and has no stray tab scroll', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<UsersScreen />);
    const row = await screen.findByRole('row', { name: /Marco Secure/ });
    const select = within(row).getByRole('combobox', { name: /Role of Marco Secure/ });

    // 28px dense control, borderless at rest, chevron visible, content-width
    expect(select.className).toContain('min-h-(--size-control-dense)');
    expect(select.className).toContain('border-transparent');
    expect(select.className).not.toContain('w-full');
    expect(select.querySelector('svg')).toBeInTheDocument();

    // the table announces its density so the control can shrink to 24px in compact rows
    expect(
      within(row)
        .getByRole('combobox', { name: /Role of/ })
        .closest('table'),
    ).toHaveAttribute('data-density', 'comfortable');

    // the tab strip must not grow a vertical scrollbar (its triggers are 36px in a 36px list)
    const tabList = screen.getByRole('tablist');
    expect(tabList.className).toContain('overflow-y-hidden');
    expect(tabList.className).toContain('overflow-x-auto');

    await user.click(select);
    expect(await screen.findByRole('option', { name: 'Viewer' })).toBeVisible();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    await expectNoA11yViolations(container);
  });

  it('a deactivated user keeps a quiet, disabled role select', async () => {
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    const row = await screen.findByRole('row', { name: /Vera Viewer/ });
    await user.click(within(row).getByRole('button', { name: /Actions for Vera Viewer/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Deactivate' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Vera Viewer/ })).getByRole('combobox', {
          name: /Role of Vera Viewer/,
        }),
      ).toBeDisabled(),
    );
    const select = within(screen.getByRole('row', { name: /Vera Viewer/ })).getByRole('combobox');
    expect(select.className).toContain('disabled:hover:bg-transparent');
  });
});

describe('UsersScreen role assignment scope (M2-LOC-03)', () => {
  beforeEach(() => seedSession(MOCK_ACCOUNTS.owner));

  async function chooseOption(
    user: ReturnType<typeof userEvent.setup>,
    dialog: HTMLElement,
    label: RegExp,
    option: string,
  ) {
    await user.click(within(dialog).getByRole('combobox', { name: label }));
    await user.click(await screen.findByRole('option', { name: option }));
  }

  it('shows where a scoped role applies, next to the role', async () => {
    renderApp(<UsersScreen />);
    const theo = await screen.findByRole('row', { name: /Theo Scoped/ });
    await waitFor(() =>
      expect(within(theo).getByTestId('role-scope')).toHaveTextContent('at Room 101'),
    );
    expect(within(theo).getByRole('combobox', { name: /Role of Theo Scoped/ })).toHaveTextContent(
      'Technician',
    );
    const alice = screen.getByRole('row', { name: /Alice Owner/ });
    expect(within(alice).queryByTestId('role-scope')).not.toBeInTheDocument();
  });

  it('invites with a role limited to a location: the body names the scope and the location', async () => {
    const sent: unknown[] = [];
    server.use(
      http.post('/v1/users', async ({ request }) => {
        sent.push(await request.clone().json());
        // nothing returned: the mock API answers
      }),
    );
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    await screen.findByRole('row', { name: /Alice Owner/ });
    await user.click(screen.getByRole('button', { name: 'Invite user' }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a user' });
    await user.type(within(dialog).getByLabelText(/^Name/), 'Dana Reyes');
    await user.type(within(dialog).getByLabelText(/^Email/), 'dana.reyes@example.org');
    await chooseOption(user, dialog, /^Role/, 'Technician');
    // the location is only asked for once the access is limited
    expect(within(dialog).queryByRole('combobox', { name: /^Location/ })).not.toBeInTheDocument();
    await chooseOption(user, dialog, /^Access/, 'Limited to a location');
    const location = within(dialog).getByRole('combobox', { name: /^Location/ });

    // required on the client before anything is sent
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    expect(await within(dialog).findByText('This field is required.')).toBeVisible();
    expect(sent).toHaveLength(0);

    await user.type(location, 'Room 204');
    await user.click(await screen.findByRole('option', { name: /Room 204/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(sent).toEqual([
      {
        email: 'dana.reyes@example.org',
        display_name: 'Dana Reyes',
        role_assignments: [
          {
            role_id: roleIdFor('technician'),
            scope_type: 'location',
            location_id: uid('location', 4),
          },
        ],
        send_invite: true,
      },
    ]);
  });

  async function openAccess(user: ReturnType<typeof userEvent.setup>, name: string) {
    const row = await screen.findByRole('row', { name: new RegExp(name) });
    await user.click(within(row).getByRole('button', { name: new RegExp(`Actions for ${name}`) }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change role and access' }));
    return screen.findByRole('dialog', { name: `Role and access of ${name}` });
  }

  async function addAccess(
    user: ReturnType<typeof userEvent.setup>,
    name: string,
    role: string,
  ): Promise<void> {
    const dialog = screen.getByRole('dialog', { name: `Role and access of ${name}` });
    await user.click(within(dialog).getByRole('button', { name: 'Add access' }));
    const add = await screen.findByRole('dialog', { name: `Add access for ${name}` });
    await chooseOption(user, add, /^Role/, role);
    await user.click(within(add).getByRole('button', { name: 'Add access' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: `Add access for ${name}` })).toBeNull(),
    );
  }

  it('adds access limited to a location, and shows a 422 location problem on the Location field', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<UsersScreen />);
    const dialog = await openAccess(user, 'Priya Patel');
    // the one access of Priya cannot be removed: there is a reason, not a hidden button
    const current = within(dialog).getByRole('list', { name: 'Current access of Priya Patel' });
    expect(within(current).getAllByRole('listitem')).toHaveLength(1);
    expect(
      within(dialog).getByRole('button', { name: 'Remove access: Technician' }),
    ).toBeDisabled();
    expect(within(dialog).getByText(/This is the only access of the user/)).toBeVisible();

    await user.click(within(dialog).getByRole('button', { name: 'Add access' }));
    const add = await screen.findByRole('dialog', { name: 'Add access for Priya Patel' });
    await chooseOption(user, add, /^Role/, 'Viewer');
    expect(within(add).getByRole('combobox', { name: /^Access/ })).toHaveTextContent(
      'Whole organisation',
    );
    await chooseOption(user, add, /^Access/, 'Limited to a location');
    const location = within(add).getByRole('combobox', { name: /^Location/ });
    await user.type(location, 'Gym');
    await user.click(await screen.findByRole('option', { name: /Gym/ }));

    // the location was archived meanwhile: the API's problem lands on the field (a one-assignment body)
    server.use(
      http.post('/v1/users/:id/role-assignments', () =>
        HttpResponse.json(
          {
            type: 'https://assettracker.test/problems/validation',
            title: 'Validation failed',
            status: 422,
            code: 'validation',
            request_id: 'req-1',
            errors: [
              {
                pointer: '/location_id',
                message: 'A location-scoped assignment needs an existing, active location_id.',
                code: 'not-found',
              },
            ],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await user.click(within(add).getByRole('button', { name: 'Add access' }));
    expect(
      await within(add).findByText(
        'A location-scoped assignment needs an existing, active location_id.',
      ),
    ).toBeVisible();
    expect(location).toHaveAttribute('aria-invalid', 'true');
    await expectNoA11yViolations(container.ownerDocument.body);

    // without the override the mock API stores it: the dialog lists both, the table shows the scope
    server.resetHandlers();
    await user.click(within(add).getByRole('button', { name: 'Add access' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Add access for Priya Patel' })).toBeNull(),
    );
    expect(await within(dialog).findByText('Viewer at Gym')).toBeVisible();
    expect(within(dialog).getByRole('button', { name: 'Remove access: Technician' })).toBeEnabled();
  });

  it('adds a whole-organisation access: the body is one assignment, the role is required', async () => {
    const sent: unknown[] = [];
    server.use(
      http.post('/v1/users/:id/role-assignments', async ({ request }) => {
        sent.push(await request.clone().json());
      }),
    );
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    const dialog = await openAccess(user, 'Vera Viewer');
    await user.click(within(dialog).getByRole('button', { name: 'Add access' }));
    const add = await screen.findByRole('dialog', { name: 'Add access for Vera Viewer' });
    await user.click(within(add).getByRole('button', { name: 'Add access' }));
    expect(await within(add).findByText('This field is required.')).toBeVisible();
    expect(sent).toHaveLength(0);
    await chooseOption(user, add, /^Role/, 'Technician');
    await user.click(within(add).getByRole('button', { name: 'Add access' }));
    await waitFor(() => expect(sent).toHaveLength(1));
    expect(sent[0]).toEqual({ role_id: roleIdFor('technician'), scope_type: 'tenant' });
  });

  it('removes one access after a confirmation that says what happens', async () => {
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    const dialog = await openAccess(user, 'Vera Viewer');
    await addAccess(user, 'Vera Viewer', 'Technician');
    await within(dialog).findByRole('button', { name: 'Remove access: Technician' });

    await user.click(within(dialog).getByRole('button', { name: 'Remove access: Technician' }));
    const confirm = await screen.findByRole('dialog', { name: 'Remove this access?' });
    expect(confirm).toHaveTextContent(
      'Vera Viewer will no longer have Technician. They are signed out of every device',
    );
    // cancelling removes nothing
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Remove this access?' })).toBeNull(),
    );
    expect(within(dialog).getByRole('button', { name: 'Remove access: Technician' })).toBeEnabled();

    await user.click(within(dialog).getByRole('button', { name: 'Remove access: Technician' }));
    const again = await screen.findByRole('dialog', { name: 'Remove this access?' });
    await user.click(within(again).getByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(
        within(dialog).queryByRole('button', { name: 'Remove access: Technician' }),
      ).toBeNull(),
    );
    // the only access left cannot be removed
    expect(within(dialog).getByRole('button', { name: 'Remove access: Viewer' })).toBeDisabled();
  });

  it('a refusal of the API is shown in the confirmation, and nothing is removed', async () => {
    const user = userEvent.setup();
    renderApp(<UsersScreen />);
    const dialog = await openAccess(user, 'Marco Secure');
    await addAccess(user, 'Marco Secure', 'Viewer');
    server.use(
      http.delete('/v1/users/:id/role-assignments/:assignmentId', () =>
        HttpResponse.json(
          {
            type: 'https://assettracker.test/problems/conflict',
            title: 'Conflict',
            status: 409,
            code: 'conflict',
            detail:
              'The last active administrator cannot be removed, demoted, disabled or archived.',
            request_id: 'req-2',
          },
          { status: 409, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await user.click(
      await within(dialog).findByRole('button', { name: 'Remove access: Administrator' }),
    );
    const confirm = await screen.findByRole('dialog', { name: 'Remove this access?' });
    await user.click(within(confirm).getByRole('button', { name: 'Remove' }));
    expect(await within(confirm).findByText(/last active administrator/i)).toBeVisible();
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Remove this access?' })).toBeNull(),
    );
    expect(
      within(dialog).getByRole('button', { name: 'Remove access: Administrator' }),
    ).toBeEnabled();
  });
});
