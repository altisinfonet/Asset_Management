import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { custodySettingsApi } from '@/lib/loaners/api';
import { assetsApi } from '@/lib/registry/api';
import type { Asset } from '@/lib/registry/types';
import { MOCK_ACCOUNTS } from '@/mocks/fixtures';
import { problem } from '@/mocks/http';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from '@/test/axe';
import { resetRouter } from '@/test/navigation';
import { renderApp, seedSession } from '@/test/render';
import { useCustody } from './custody-provider';
import type { CustodyAction } from '@/lib/custody/helpers';

vi.mock('next/navigation', () => import('@/test/navigation').then((m) => m.navigationMock));

function Opener({ assets, action }: { assets: Asset[]; action: CustodyAction }) {
  const custody = useCustody();
  return <button onClick={() => custody.open({ assets, action })}>open dialog</button>;
}

async function ready(count = 1): Promise<Asset[]> {
  const page = await assetsApi.list({
    state_type: ['deployable'],
    assigned: false,
    sort: ['asset_tag'],
    limit: count,
  });
  return page.data;
}

async function held(count = 1): Promise<Asset[]> {
  const page = await assetsApi.list({ assigned: true, sort: ['asset_tag'], limit: count });
  return page.data;
}

async function openDialog(assets: Asset[], action: CustodyAction) {
  const user = userEvent.setup();
  const view = renderApp(<Opener assets={assets} action={action} />, { workflows: true });
  await user.click(await screen.findByRole('button', { name: 'open dialog' }));
  return { user, view };
}

async function choosePerson(
  user: ReturnType<typeof userEvent.setup>,
  dialog: HTMLElement,
  name: string,
) {
  const box = within(dialog).getByRole('combobox', { name: /Person/ });
  await user.type(box, name);
  await user.click(await screen.findByRole('option', { name: new RegExp(name) }));
}

describe('CustodyDialog', () => {
  beforeEach(() => {
    resetRouter();
    seedSession(MOCK_ACCOUNTS.owner);
  });

  it('starts the expected return at the organisation default and lets the person clear it', async () => {
    await custodySettingsApi.put({ default_expected_return_days: 14, loan_reminder_days: 2 });
    const [asset] = await ready();
    const { user } = await openDialog([asset!], 'checkout');
    const dialog = await screen.findByRole('dialog', { name: `Check out ${asset!.asset_tag}` });
    const expected = within(dialog).getByLabelText(/^Expected return/);
    const inTwoWeeks = new Date(Date.now() + 14 * 86_400_000);
    const iso = `${inTwoWeeks.getFullYear()}-${String(inTwoWeeks.getMonth() + 1).padStart(2, '0')}-${String(inTwoWeeks.getDate()).padStart(2, '0')}`;
    await waitFor(() => expect(expected).toHaveValue(iso));
    await user.clear(expected);
    expect(expected).toHaveValue('');
  });

  it('checks an asset out to a person, closes and leaves the asset with them', async () => {
    const [asset] = await ready();
    const { user, view } = await openDialog([asset!], 'checkout');
    const dialog = await screen.findByRole('dialog', { name: `Check out ${asset!.asset_tag}` });
    // a single ready asset offers check-out only: no tabs
    expect(within(dialog).queryByRole('tablist')).not.toBeInTheDocument();
    await expectNoA11yViolations(view.container.ownerDocument.body);

    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'In a week' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Notes' }), 'Exam week');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));

    expect(
      await screen.findByText(`${asset!.asset_tag} checked out to Maria Reyes.`),
    ).toBeVisible();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    const after = (await assetsApi.get(asset!.id)).value;
    expect(after.current_assignment).toMatchObject({
      target_name: 'Maria Reyes',
      target_type: 'person',
    });
  });

  it('asks for the target and refuses a past date before sending anything', async () => {
    const [asset] = await ready();
    const sent = vi.fn();
    server.use(
      http.post('/v1/assets/:id/checkout', () => {
        sent();
      }),
    );
    const { user } = await openDialog([asset!], 'checkout');
    const dialog = await screen.findByRole('dialog', { name: `Check out ${asset!.asset_tag}` });
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await within(dialog).findByText('Choose who or where it goes.')).toBeVisible();
    expect(sent).not.toHaveBeenCalled();
  });

  it('sends the same Idempotency-Key when a dropped connection is retried, and a new one for a changed request', async () => {
    const [asset] = await ready();
    const keys: Array<string | null> = [];
    let calls = 0;
    server.use(
      http.post('/v1/assets/:id/checkout', ({ request }) => {
        keys.push(request.headers.get('idempotency-key'));
        calls += 1;
        if (calls === 1) return HttpResponse.error();
        return undefined; // the mock API answers
      }),
    );
    const { user } = await openDialog([asset!], 'checkout');
    const dialog = await screen.findByRole('dialog', { name: `Check out ${asset!.asset_tag}` });
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    // the connection dropped: the banner says a retry is safe
    expect(await within(dialog).findByText(/sent again safely/)).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    await screen.findByText(/checked out to Maria Reyes/);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBeTruthy();
    expect(keys[1]).toBe(keys[0]);
  });

  it('says who has an asset that was checked out meanwhile (409) and offers a reload', async () => {
    const [asset] = await ready();
    server.use(
      http.post('/v1/assets/:id/checkout', () =>
        problem(409, 'asset-already-checked-out', 'The asset is already checked out'),
      ),
    );
    const { user } = await openDialog([asset!], 'checkout');
    const dialog = await screen.findByRole('dialog', { name: `Check out ${asset!.asset_tag}` });
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    const banner = await within(dialog).findByRole('alert');
    expect(banner).toHaveTextContent('Already checked out');
    expect(within(banner).getByRole('button', { name: 'Reload asset' })).toBeVisible();
  });

  it('answers a changed asset (412) with a reload path, and the banner goes after the reload', async () => {
    const [asset] = await ready();
    const { user } = await openDialog([asset!], 'checkout');
    const dialog = await screen.findByRole('dialog', { name: `Check out ${asset!.asset_tag}` });
    await within(dialog).findByTestId('custody-asset-tag');
    await choosePerson(user, dialog, 'Maria Reyes');
    await assetsApi.update(asset!.id, { notes: 'changed by someone else' }); // bumps the version
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    const banner = await within(dialog).findByText('The asset changed');
    expect(banner).toBeVisible();
    await user.click(within(dialog).getByRole('button', { name: 'Reload asset' }));
    await waitFor(() =>
      expect(within(dialog).queryByText('The asset changed')).not.toBeInTheDocument(),
    );
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await screen.findByText(/checked out to Maria Reyes/)).toBeVisible();
  });

  it('checks in with the condition, a status and a location', async () => {
    const [asset] = await held();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post('/v1/assets/:id/checkin', async ({ request }) => {
        body = (await request.clone().json()) as Record<string, unknown>;
        return undefined;
      }),
    );
    const { user } = await openDialog([asset!], 'checkin');
    const dialog = await screen.findByRole('dialog', { name: `Check in ${asset!.asset_tag}` });
    await user.click(within(dialog).getByRole('combobox', { name: 'Condition' }));
    await user.click(await screen.findByRole('option', { name: 'Fair' }));
    await user.type(within(dialog).getByRole('textbox', { name: 'Notes' }), 'Cracked bezel');
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    expect(await screen.findByText(`${asset!.asset_tag} checked in.`)).toBeVisible();
    expect(body).toMatchObject({ note: 'Cracked bezel', condition: 'fair' });
    expect((await assetsApi.get(asset!.id)).value.current_assignment).toBeNull();
  });

  it('a held asset offers check-in and transfer, and transfer needs a target', async () => {
    const [asset] = await held();
    const { user } = await openDialog([asset!], 'transfer');
    const dialog = await screen.findByRole('dialog', { name: `Transfer ${asset!.asset_tag}` });
    expect(
      within(dialog)
        .getAllByRole('tab')
        .map((tab) => tab.textContent),
    ).toEqual(['Check in', 'Transfer']);
    await user.click(within(dialog).getByRole('button', { name: 'Transfer' }));
    expect(await within(dialog).findByText('Choose who or where it goes.')).toBeVisible();
  });

  it('checks in a selection, reports each outcome and lists the ones that failed', async () => {
    const assets = await held(3);
    const failing = assets[1]!;
    server.use(
      http.post('/v1/assets/:id/checkin', ({ params }) =>
        params.id === failing.id
          ? problem(409, 'asset-not-checked-out', 'The asset is not checked out')
          : undefined,
      ),
    );
    const { user } = await openDialog(assets, 'checkin');
    const dialog = await screen.findByRole('dialog', { name: 'Check in 3 assets' });
    expect(dialog).toHaveTextContent('3 assets selected');
    // one set of defaults for the whole selection: no per-asset photo
    expect(within(dialog).queryByRole('button', { name: 'Add photo' })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Check in' }));
    const results = await screen.findByRole('dialog', { name: 'Result' });
    expect(results).toHaveTextContent('2 done, 1 failed');
    expect(within(results).getByText(failing.asset_tag)).toBeVisible();
    expect((await assetsApi.get(assets[0]!.id)).value.current_assignment).toBeNull();
    expect((await assetsApi.get(failing.id)).value.current_assignment).not.toBeNull();
  });

  it('checks a selection out to one person', async () => {
    const assets = await ready(2);
    const { user } = await openDialog(assets, 'checkout');
    const dialog = await screen.findByRole('dialog', { name: 'Check out 2 assets' });
    await choosePerson(user, dialog, 'Maria Reyes');
    await user.click(within(dialog).getByRole('button', { name: 'Check out' }));
    expect(await screen.findByText('2 assets checked out to Maria Reyes.')).toBeVisible();
    for (const asset of assets) {
      expect((await assetsApi.get(asset.id)).value.current_assignment?.target_name).toBe(
        'Maria Reyes',
      );
    }
  });

  it('offers nothing for an asset that cannot change hands', async () => {
    const page = await assetsApi.list({ state_type: ['lost'], limit: 1 });
    const { user: _user } = await openDialog([page.data[0]!], 'checkout');
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText(/Nothing can be done/)).toBeVisible();
  });
});
