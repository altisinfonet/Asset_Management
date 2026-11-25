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

  it('changes a user to a location scope, and shows a 422 location problem on the Location field', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<UsersScreen />);
    const priya = await screen.findByRole('row', { name: /Priya Patel/ });
    await user.click(within(priya).getByRole('button', { name: /Actions for Priya Patel/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Change role and access' }));
    const dialog = await screen.findByRole('dialog', { name: 'Role and access of Priya Patel' });
    expect(within(dialog).getByRole('combobox', { name: /^Access/ })).toHaveTextContent(
      'Whole organisation',
    );
    await chooseOption(user, dialog, /^Access/, 'Limited to a location');
    const location = within(dialog).getByRole('combobox', { name: /^Location/ });
    await user.type(location, 'Gym');
    await user.click(await screen.findByRole('option', { name: /Gym/ }));

    // the location was archived meanwhile: the API's problem lands on the field
    server.use(
      http.patch('/v1/users/:id', () =>
        HttpResponse.json(
          {
            type: 'https://assettracker.test/problems/validation',
            title: 'Validation failed',
            status: 422,
            code: 'validation',
            request_id: 'req-1',
            errors: [
              {
                pointer: '/role_assignments/0/location_id',
                message: 'A location-scoped assignment needs an existing, active location_id.',
                code: 'not-found',
              },
            ],
          },
          { status: 422, headers: { 'content-type': 'application/problem+json' } },
        ),
      ),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(
      await within(dialog).findByText(
        'A location-scoped assignment needs an existing, active location_id.',
      ),
    ).toBeVisible();
    expect(location).toHaveAttribute('aria-invalid', 'true');
    await expectNoA11yViolations(container.ownerDocument.body);

    // without the override the mock API stores the scope and the table shows it
    server.resetHandlers();
    await user.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Priya Patel/ })).getByTestId('role-scope'),
      ).toHaveTextContent('at Gym'),
    );
  });
});
