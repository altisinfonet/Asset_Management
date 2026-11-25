import { screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { roleAssignmentView, roleIdFor, uid } from '@/mocks/registry-fixtures';
import { mutateRegistry } from '@/mocks/registry-state';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AppShell } from './app-shell';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function renderShell(email: string) {
  seedSession(email);
  const view = renderApp(
    <AppShell>
      <p>page content</p>
    </AppShell>,
  );
  await screen.findByTestId('tenant-name');
  return view;
}

describe('"Scoped to" indicator (M2-LOC-03)', () => {
  beforeEach(() => {
    resetRouter();
    window.localStorage.clear();
  });

  it('shows the path of the scope for a location-scoped user, without axe violations', async () => {
    const { container } = await renderShell(MOCK_ACCOUNTS.scopedTechnician);
    const indicator = await screen.findByTestId('scope-indicator');
    expect(indicator).toHaveTextContent(
      'Scoped to: Riverside Elementary / Main building / Room 101',
    );
    expect(within(screen.getByRole('banner')).getByTestId('scope-indicator')).toBe(indicator);
    await expectNoA11yViolations(container.ownerDocument.body);
  });

  it('is absent for an org-wide user', async () => {
    await renderShell(MOCK_ACCOUNTS.owner);
    expect(screen.getAllByRole('navigation', { name: 'Primary' })[0]).toBeVisible();
    expect(screen.queryByTestId('scope-indicator')).not.toBeInTheDocument();
    expect(screen.queryByText(/Scoped to/)).not.toBeInTheDocument();
  });

  it('lists every scope root, and a scoped Administrator gets no Settings (no org-only permissions)', async () => {
    // Priya's login id is the one of the policy-enforced mock account
    mutateRegistry((data) => {
      const priya = data.users.find((u) => u.email === 'priya.patel@example.org')!;
      priya.role_assignments = [
        roleAssignmentView(
          {
            role_id: roleIdFor('tenant_admin'),
            scope_type: 'location',
            location_id: uid('location', 4),
          },
          'ra-1',
        ),
        roleAssignmentView(
          {
            role_id: roleIdFor('tenant_admin'),
            scope_type: 'location',
            location_id: uid('location', 5),
          },
          'ra-2',
        ),
      ];
    });
    await renderShell(MOCK_ACCOUNTS.mfaEnforced);
    expect(await screen.findByTestId('scope-indicator')).toHaveTextContent(
      'Scoped to: Riverside Elementary / Main building / Gym, Riverside Elementary / Main building / Room 204',
    );
    const nav = screen.getAllByRole('navigation', { name: 'Primary' })[0]!;
    expect(within(nav).getByRole('link', { name: 'Assets' })).toBeVisible();
    expect(within(nav).getByRole('link', { name: 'Locations' })).toBeVisible();
    expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
