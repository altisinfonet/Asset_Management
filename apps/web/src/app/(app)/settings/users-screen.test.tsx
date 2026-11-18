import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
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
