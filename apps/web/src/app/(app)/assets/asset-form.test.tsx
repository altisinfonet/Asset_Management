import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { assetsApi } from '@/lib/registry/api';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { uid } from '@/mocks/registry-fixtures';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter, router } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { AssetFormScreen } from './asset-form-screen';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

async function pick(label: RegExp | string, option: RegExp | string) {
  await userEvent.click(await screen.findByRole('combobox', { name: label }));
  await userEvent.click(await screen.findByRole('option', { name: option }));
}

describe('AssetFormScreen (create)', () => {
  beforeEach(() => {
    resetRouter();
    window.history.pushState({}, '', '/assets/new/');
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('renders the custom fields of the chosen category and validates them before saving', async () => {
    const user = userEvent.setup();
    const { container } = renderApp(<AssetFormScreen kind="new" />);
    expect(await screen.findByRole('heading', { name: 'New asset', level: 1 })).toBeVisible();
    expect(screen.queryByRole('group', { name: /Fields for/ })).not.toBeInTheDocument();

    await pick(/^Category/, 'Chromebook');
    const fields = await screen.findByRole('group', { name: 'Fields for Chromebook' });
    // one input of the right kind per definition
    expect(within(fields).getByRole('textbox', { name: /^OS version/ })).toBeRequired();
    expect(within(fields).getByRole('spinbutton', { name: 'Screen size (in)' })).toHaveAttribute(
      'max',
      '20',
    );
    expect(within(fields).getByRole('checkbox', { name: 'Managed' })).toBeVisible();
    expect(within(fields).getByLabelText('Enrollment date')).toHaveAttribute('type', 'date');
    expect(within(fields).getByLabelText('Admin console URL')).toHaveAttribute('type', 'url');
    expect(within(fields).getByRole('group', { name: 'Accessories' })).toBeVisible();
    expect(within(fields).getByRole('combobox', { name: 'Condition' })).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('1 field needs attention')).toBeVisible();
    expect(within(fields).getByText('This field is required.')).toBeVisible();
    expect(router.push).not.toHaveBeenCalled();
    await expectNoA11yViolations(container);
  });

  it('creates the asset with typed custom values and goes to its page', async () => {
    const user = userEvent.setup();
    renderApp(<AssetFormScreen kind="new" />);
    await pick(/^Category/, 'Chromebook');
    await user.type(await screen.findByRole('textbox', { name: /^OS version/ }), 'ChromeOS 126');
    await user.type(screen.getByRole('spinbutton', { name: 'Screen size (in)' }), '11.6');
    await user.click(screen.getByRole('checkbox', { name: 'Managed' }));
    await user.click(screen.getByRole('checkbox', { name: 'Charger' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const target = String(router.push.mock.calls[0]![0]);
    const id = new URL(target, 'http://x').searchParams.get('id')!;
    const created = await assetsApi.get(id);
    expect(created.value.asset_tag).toBe('AT-00131');
    expect(created.value.custom_data).toMatchObject({
      os_version: 'ChromeOS 126',
      screen_size: 11.6,
      managed: true,
      accessories: ['charger'],
    });
  });

  it('chooses the department from the list; where the asset is stays the location', async () => {
    const user = userEvent.setup();
    renderApp(<AssetFormScreen kind="new" />);
    await pick(/^Category/, 'Projector');
    await user.type(await screen.findByRole('spinbutton', { name: 'Lamp hours' }), '10');
    expect(screen.getByText('Who owns or pays for it. Where it is stays Location.')).toBeVisible();
    await pick(/^Department/, /^Mathematics/);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.push).toHaveBeenCalled());
    const id = new URL(String(router.push.mock.calls[0]![0]), 'http://x').searchParams.get('id')!;
    const created = (await assetsApi.get(id)).value;
    expect(created.department_id).toBe(uid('department', 3));
    expect(created.location_id).toBeNull();
  });

  it('shows the server tag conflict on the tag field', async () => {
    const user = userEvent.setup();
    renderApp(<AssetFormScreen kind="new" />);
    await pick(/^Category/, 'Projector');
    await user.click(screen.getByRole('radio', { name: 'Enter my own' }));
    await user.type(screen.getByRole('textbox', { name: /^Tag/ }), 'PRJ-00001');
    await user.type(await screen.findByRole('spinbutton', { name: 'Lamp hours' }), '10');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const tag = screen.getByRole('textbox', { name: /^Tag/ });
    await waitFor(() => expect(tag).toBeInvalid());
    expect(tag).toHaveAccessibleDescription(/already in use/);
  });
});

describe('AssetFormScreen (edit, 412 conflict)', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('a stale save offers to reload, keeping my edits merged over the latest version', async () => {
    const id = uid('asset', 30);
    window.history.pushState({}, '', `/assets/edit/?id=${id}`);
    const user = userEvent.setup();
    renderApp(<AssetFormScreen kind="edit" />);
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /^Tag/ })).toHaveValue('AT-00030'),
    );

    await assetsApi.update(id, { notes: 'changed by someone else' }); // the other user saves first
    await user.type(screen.getByLabelText('Serial number'), '-MINE');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('This asset changed')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Reload and keep my changes' }));
    await waitFor(() =>
      expect(screen.getByLabelText('Notes')).toHaveValue('changed by someone else'),
    );
    expect((screen.getByLabelText('Serial number') as HTMLInputElement).value).toContain('-MINE');

    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(router.push).toHaveBeenCalledWith(`/assets/view?id=${id}`));
    const saved = (await assetsApi.get(id)).value;
    expect(saved.notes).toBe('changed by someone else');
    expect(saved.serial).toContain('-MINE');
  });

  it('a clone starts without tag and serial', async () => {
    const id = uid('asset', 124);
    window.history.pushState({}, '', `/assets/new/?clone=${id}`);
    renderApp(<AssetFormScreen kind="new" />);
    expect(await screen.findByRole('heading', { name: 'Clone asset', level: 1 })).toBeVisible();
    await waitFor(() => expect(screen.getByLabelText('Serial number')).toHaveValue(''));
    expect(screen.getByRole('radio', { name: 'Automatic' })).toBeChecked();
    expect(await screen.findByRole('textbox', { name: /^OS version/ })).not.toHaveValue('');
  });

  it('an unknown asset id says not found', async () => {
    window.history.pushState({}, '', `/assets/edit/?id=${uid('asset', 9999)}`);
    renderApp(<AssetFormScreen kind="edit" />);
    expect(await screen.findByTestId('asset-not-found')).toBeVisible();
  });
});

describe('AssetFormScreen (permissions)', () => {
  it('a viewer sees the 403 screen instead of the form', async () => {
    resetRouter();
    window.history.pushState({}, '', '/assets/new/');
    seedSession(MOCK_ACCOUNTS.viewer);
    renderApp(<AssetFormScreen kind="new" />);
    expect(await screen.findByTestId('access-denied')).toBeVisible();
  });
});
