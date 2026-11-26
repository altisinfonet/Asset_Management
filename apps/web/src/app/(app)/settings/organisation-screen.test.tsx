import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { filesSettingsApi } from '@/lib/files/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { SettingsSectionScreen } from './settings-section';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

const MB = 1024 * 1024;

describe('Settings > Organisation', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('is a real page: the organisation, the check-out defaults and the file settings', async () => {
    const { container } = renderApp(<SettingsSectionScreen section="organisation" />);
    expect(await screen.findByRole('heading', { name: 'Organisation' })).toBeVisible();
    expect(screen.queryByText(/not built yet/)).not.toBeInTheDocument();
    expect(await screen.findByTestId('org-name')).not.toBeEmptyDOMElement();
    expect(screen.getByTestId('org-currency')).toHaveTextContent(/^[A-Z]{3}$/);
    expect(await screen.findByRole('heading', { name: 'Check-out defaults' })).toBeVisible();
    expect(await screen.findByLabelText(/^Largest upload \(MB\)/)).toBeVisible();
    await expectNoA11yViolations(container);
  });

  it('saves the file settings and checks the cap against the plan first', async () => {
    const user = userEvent.setup();
    renderApp(<SettingsSectionScreen section="organisation" />);
    const cap = await screen.findByLabelText(/^Largest upload \(MB\)/);
    const tier = Math.floor((await filesSettingsApi.get()).tier_max_upload_bytes! / MB);
    await user.clear(cap);
    await user.type(cap, String(tier + 1));
    await user.click(screen.getByRole('button', { name: 'Save file settings' }));
    expect(await screen.findByText(`Enter a whole number from 1 to ${tier}.`)).toBeVisible();
    await user.clear(cap);
    await user.type(cap, '5');
    await user.click(
      screen.getByRole('checkbox', {
        name: 'Remove location and camera data (EXIF) from uploaded photos',
      }),
    );
    await user.click(screen.getByRole('button', { name: 'Save file settings' }));
    expect(await screen.findByText('File settings saved')).toBeVisible();
    await waitFor(async () => expect((await filesSettingsApi.get()).max_upload_bytes).toBe(5 * MB));
  });

  it('a role that only reads the catalogue sees the values without save buttons', async () => {
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<SettingsSectionScreen section="organisation" />);
    expect(await screen.findByTestId('org-name')).toBeVisible();
    await screen.findByLabelText(/^Largest upload \(MB\)/);
    expect(screen.queryByRole('button', { name: 'Save file settings' })).not.toBeInTheDocument();
  });
});
