import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { peopleApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { UsersScreen } from '../settings/users-screen';
import { PersonView } from './view/person-view';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

/** M2-USR-03: link and unlink a person and a login account, from the person page and from Users. */
async function personNamed(name: string) {
  return (await peopleApi.list({ q: name })).data.find((p) => p.display_name === name)!;
}

async function openPerson(name: string) {
  const person = await personNamed(name);
  window.history.pushState({}, '', `/people/view/?id=${person.id}`);
  return person;
}

describe('person page: link to a login and unlink', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('links a person without a login: the consequence is stated first, then the person has a login', async () => {
    await openPerson('Jamie Okafor');
    const user = userEvent.setup();
    const { container } = renderApp(<PersonView />, { workflows: true });
    expect(await screen.findByText('No login')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Link to a login' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link Jamie Okafor to a login' });
    // nothing can be confirmed before a login is chosen
    expect(within(dialog).getByRole('button', { name: 'Link login' })).toBeDisabled();
    await user.click(within(dialog).getByRole('combobox', { name: /Login account/ }));
    await user.type(within(dialog).getByRole('combobox', { name: /Login account/ }), 'Vera');
    await user.click(await screen.findByRole('option', { name: /Vera Viewer/ }));
    expect(
      within(dialog).getByText(/Jamie Okafor will sign in as viewer@example.org\./),
    ).toBeVisible();
    await expectNoA11yViolations(container);
    await user.click(within(dialog).getByRole('button', { name: 'Link login' }));
    expect(
      await screen.findByText('Jamie Okafor is now linked to viewer@example.org.'),
    ).toBeVisible();
    // the page now shows the login (and the way to unlink it)
    expect(await screen.findByRole('button', { name: 'Unlink login' })).toBeVisible();
    expect((await personNamed('Jamie Okafor')).user_id).toBeTruthy();
  });

  it('shows why a link is refused, in the dialog, and changes nothing', async () => {
    const user = userEvent.setup();
    // Vera's login already has a person that somebody chose
    const jamie = await personNamed('Jamie Okafor');
    const vera = (await peopleApi.list({ q: 'Vera Viewer' })).data[0]!;
    await peopleApi.linkUser(jamie.id, vera.user_id!);

    await openPerson('Maria Reyes');
    renderApp(<PersonView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Link to a login' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link Maria Reyes to a login' });
    await user.type(within(dialog).getByRole('combobox', { name: /Login account/ }), 'Vera');
    await user.click(await screen.findByRole('option', { name: /Vera Viewer/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Link login' }));
    expect(
      await within(dialog).findByText(
        'The login account is already linked to Jamie Okafor. Unlink that person first.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('dialog', { name: 'Link Maria Reyes to a login' })).toBeVisible();
    expect((await personNamed('Maria Reyes')).user_id).toBeNull();
  });

  it('unlinks after a confirmation that says what stays', async () => {
    const user = userEvent.setup();
    await openPerson('Vera Viewer');
    const { container } = renderApp(<PersonView />, { workflows: true });
    await user.click(await screen.findByRole('button', { name: 'Unlink login' }));
    const dialog = await screen.findByRole('dialog', {
      name: 'Unlink Vera Viewer from their login?',
    });
    expect(within(dialog).getByText(/keeps everything they hold and their history/)).toBeVisible();
    expect(within(dialog).getByText(/gets a new, empty person record/)).toBeVisible();
    await expectNoA11yViolations(container);
    await user.click(within(dialog).getByRole('button', { name: 'Unlink' }));
    expect(await screen.findByText('Vera Viewer was unlinked from their login.')).toBeVisible();
    expect(await screen.findByRole('button', { name: 'Link to a login' })).toBeVisible();
    expect((await personNamed('Vera Viewer')).user_id).toBeNull();
  });

  it('is offered to Administrators only', async () => {
    seedSession(MOCK_ACCOUNTS.manager);
    await openPerson('Jamie Okafor');
    renderApp(<PersonView />, { workflows: true });
    expect(await screen.findByText('No login')).toBeVisible();
    expect(screen.queryByRole('button', { name: 'Link to a login' })).not.toBeInTheDocument();
  });
});

describe('Settings > Users: link a login to a person and unlink', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('shows the person of each login, links one to a person without a login, and unlinks it again', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<UsersScreen />);
    const marco = await screen.findByRole('row', { name: /Marco Secure/ });
    expect(within(marco).getByText('None')).toBeVisible();
    // Alice's login is the login of the person Alice Owner
    const alice = screen.getByRole('row', { name: /Alice Owner/ });
    expect(await within(alice).findByRole('link', { name: 'Alice Owner' })).toBeVisible();

    await user.click(within(marco).getByRole('button', { name: /Actions for Marco Secure/ }));
    await user.click(await screen.findByRole('menuitem', { name: 'Link to a person' }));
    const dialog = await screen.findByRole('dialog', { name: 'Link Marco Secure to a person' });
    await user.type(within(dialog).getByRole('combobox', { name: /Person/ }), 'Jamie');
    await user.click(await screen.findByRole('option', { name: /Jamie Okafor/ }));
    expect(within(dialog).getByText(/Jamie Okafor will sign in as mfa@example.org/)).toBeVisible();
    await expectNoA11yViolations(container);
    await user.click(within(dialog).getByRole('button', { name: 'Link login' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Marco Secure/ })).getByRole('link', {
          name: 'Jamie Okafor',
        }),
      ).toBeVisible(),
    );

    await user.click(
      within(screen.getByRole('row', { name: /Marco Secure/ })).getByRole('button', {
        name: /Actions for Marco Secure/,
      }),
    );
    await user.click(await screen.findByRole('menuitem', { name: 'Unlink person' }));
    const confirm = await screen.findByRole('dialog', {
      name: 'Unlink Jamie Okafor from their login?',
    });
    await user.click(within(confirm).getByRole('button', { name: 'Unlink' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('row', { name: /Marco Secure/ })).queryByRole('link', {
          name: 'Jamie Okafor',
        }),
      ).not.toBeInTheDocument(),
    );
  });
});
