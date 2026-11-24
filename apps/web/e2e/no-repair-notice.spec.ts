import type { Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { violations } from './axe';
import { expect, settled, test } from './fixtures';
import { choose, readyAsset, type AssetRef } from './m2-helpers';

/**
 * A status label and a repair record are different things. When an asset is (or is about to be) in a
 * not-deployable status and has no open repair, the app says so and offers "Log a repair": inline in
 * the asset form, as a banner on the asset page, and as a one-line note in the bulk edit. Nothing is
 * ever blocked.
 */
const SENTENCE =
  'No repair is logged for this asset. Log a repair to track the problem, supplier and cost.';

/**
 * The mock seeds its repairs from the registry the first time they are read, so read them first;
 * then put the asset into the not-deployable status by hand (no repair), as a status edit does.
 */
async function putOutForFix(page: Page, asset: AssetRef): Promise<void> {
  await page.evaluate(async (a) => {
    await fetch('/v1/repairs?limit=1');
    const labels = (await (await fetch('/v1/status-labels?limit=100')).json()) as {
      data: Array<{ id: string; state_type: string }>;
    };
    const status = labels.data.find((s) => s.state_type === 'undeployable')!;
    await fetch(`/v1/assets/${a.id}`, {
      method: 'PATCH',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': 'csrf-e2e',
        'if-match': a.etag,
      },
      body: JSON.stringify({ status_id: status.id }),
    });
  }, asset);
}

async function logRepair(page: Page, tag: string, what: string): Promise<void> {
  const dialog = page.getByRole('dialog', { name: `Log a repair for ${tag}` });
  await expect(dialog).toBeVisible();
  // prefilled for this asset (no picker) with the status the asset is getting
  await expect(dialog.getByRole('combobox', { name: /^Asset\(required\)/ })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: /^Asset status while/ })).toContainText(
    'Out for fix',
  );
  await dialog.getByRole('textbox', { name: /^What needs doing/ }).fill(what);
  await dialog.getByRole('button', { name: 'Log repair' }).click();
  const files = page.getByRole('dialog', { name: 'Repair logged' });
  await expect(files).toBeVisible();
  await files.getByRole('button', { name: 'Done' }).click();
}

test.describe('not deployable without a repair', () => {
  test('asset form: the hint shows for the status, Log a repair keeps the edits, saving still works', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/edit?id=${asset.id}`);
    const status = page.getByRole('combobox', { name: 'Status' });
    await expect(status).toBeVisible();
    await settled(page);
    await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);

    await page.getByRole('textbox', { name: 'Serial number' }).fill('SN-HINT-1');
    await choose(page, status, 'Out for fix', true);
    const hint = page.getByTestId('no-repair-notice');
    await expect(hint).toHaveText(new RegExp(SENTENCE));
    await expect(hint.getByRole('button', { name: 'Log a repair' })).toBeVisible();
    expect(await violations(page)).toEqual([]);

    await choose(page, status, 'Ready', true);
    await expect(hint).toHaveCount(0);
    await choose(page, status, 'Out for fix', true);

    await hint.getByRole('button', { name: 'Log a repair' }).click();
    await logRepair(page, asset.asset_tag, 'Cracked hinge');
    await expect(hint).toHaveCount(0);
    await expect(page.getByRole('textbox', { name: 'Serial number' })).toHaveValue('SN-HINT-1');
    await expect(status).toContainText('Out for fix');

    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/assets/view/?\\?id=${asset.id}`));
    await expect(page.getByTestId('asset-tag')).toHaveText(asset.asset_tag);
    // the repair is there, and so no banner
    await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);
    await page.goto(`/assets/view?id=${asset.id}&tab=repairs`);
    await expect(page.getByTestId('repairs-summary')).toHaveText('1 repair');
  });

  test('asset page: a subtle banner with the action; logging a repair removes it', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await putOutForFix(page, asset);
    await page.goto(`/assets/view?id=${asset.id}`);
    const banner = page.getByTestId('no-repair-notice');
    await expect(banner).toHaveText(SENTENCE);
    await settled(page);
    expect(await violations(page)).toEqual([]);

    await page.getByRole('button', { name: 'Log a repair' }).click();
    await logRepair(page, asset.asset_tag, 'Dead battery');
    await expect(banner).toHaveCount(0);
    await page.getByRole('tab', { name: 'Repairs' }).click();
    await expect(page.getByRole('button', { name: 'Open repair Dead battery' })).toBeVisible();
  });

  test('asset page: no banner for a ready asset or one with an open repair', async ({ page }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await expect(page.getByTestId('asset-tag')).toHaveText(asset.asset_tag);
    await page.getByRole('tab', { name: 'Repairs' }).click();
    await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);

    // a seeded open repair belongs to an asset in the not-deployable status: no banner for it either
    const repairedId = await page.evaluate(async () => {
      const list = (await (await fetch('/v1/repairs?status=open&limit=1')).json()) as {
        data: Array<{ asset_id: string }>;
      };
      return list.data[0]!.asset_id;
    });
    await page.goto(`/assets/view?id=${repairedId}`);
    await expect(page.getByTestId('asset-tag')).toBeVisible();
    await expect(page.getByText('Out for fix').first()).toBeVisible();
    await page.getByRole('tab', { name: 'Repairs' }).click();
    await expect(page.getByTestId('repairs-summary')).not.toHaveText('');
    await expect(page.getByTestId('no-repair-notice')).toHaveCount(0);
  });

  test('somebody who may read repairs but not log them gets the sentence without the button', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await putOutForFix(page, asset);
    await page.evaluate(
      ({ key, email }) => {
        const state = JSON.parse(window.localStorage.getItem(key) ?? '{}');
        state.session = { ...state.session, email };
        window.localStorage.setItem(key, JSON.stringify(state));
      },
      { key: 'at-mock-state', email: MOCK_ACCOUNTS.viewer },
    );
    await page.goto(`/assets/view?id=${asset.id}`);
    await expect(page.getByTestId('no-repair-notice')).toHaveText(SENTENCE);
    await expect(page.getByRole('button', { name: 'Log a repair' })).toHaveCount(0);
  });

  test('bulk edit: a one-line note for a not-deployable status, and the change is not blocked', async ({
    page,
  }) => {
    await page.goto('/assets');
    await settled(page);
    await page
      .getByRole('checkbox', { name: /^Select row / })
      .nth(0)
      .check();
    await page
      .getByRole('checkbox', { name: /^Select row / })
      .nth(1)
      .check();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit 2 assets' });
    await choose(page, dialog.getByRole('combobox', { name: 'New value' }), 'Ready', true);
    await expect(dialog.getByTestId('bulk-no-repair-note')).toHaveCount(0);
    await choose(page, dialog.getByRole('combobox', { name: 'New value' }), 'Out for fix', true);
    await expect(dialog.getByTestId('bulk-no-repair-note')).toHaveText(
      'A not-deployable status does not log repairs. Log one on each asset to track the problem, supplier and cost.',
    );
    expect(await violations(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Apply to 2 assets' }).click();
    await expect(page.getByText('Done: 2 assets updated.')).toBeVisible();
  });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`axe: asset page banner and form hint (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const asset = await readyAsset(page);
    await putOutForFix(page, asset);
    await page.goto(`/assets/view?id=${asset.id}`);
    await expect(page.getByTestId('no-repair-notice')).toBeVisible();
    await settled(page);
    expect(await violations(page)).toEqual([]);

    await page.goto(`/assets/edit?id=${asset.id}`);
    await expect(page.getByRole('combobox', { name: 'Status' })).toContainText('Out for fix');
    await expect(page.getByTestId('no-repair-notice')).toBeVisible();
    await settled(page);
    expect(await violations(page)).toEqual([]);

    // the log dialog opened from the notice
    await page.getByRole('button', { name: 'Log a repair' }).click();
    const dialog = page.getByRole('dialog', { name: `Log a repair for ${asset.asset_tag}` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveCSS('opacity', '1'); // not while it still fades in
    expect(await violations(page)).toEqual([]);
  });
}
