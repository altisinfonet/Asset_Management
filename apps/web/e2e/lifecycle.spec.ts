import type { Page } from '@playwright/test';
import { violations } from './axe';
import { expect, settled, test } from './fixtures';
import { choose, heldAsset, readyAsset, type AssetRef } from './m2-helpers';

/**
 * The v0.2.8 close-out of M2 (the founder walk-through): lost, found and dispose on the asset page
 * (M2-LIFE-05), bulk dispose and the bulk move from the asset list, Settings > Organisation, and
 * "Open PDF" on a finished label sheet showing the PDF instead of saving it.
 */

/** A ready asset further down the list, so the tests do not share one. */
async function readyAt(page: Page, n: number): Promise<AssetRef> {
  await readyAsset(page);
  return page.evaluate(async (index) => {
    const list = await fetch(
      '/v1/assets?state_type=deployable&assigned=false&limit=40&sort=asset_tag',
    );
    const body = (await list.json()) as {
      data: Array<{ id: string; asset_tag: string; name: string | null }>;
    };
    const asset = body.data[index]!;
    const one = await fetch(`/v1/assets/${asset.id}`);
    return { ...asset, etag: one.headers.get('etag') ?? '' };
  }, n);
}

test.describe('lost, found and dispose', () => {
  test('mark a checked-out asset lost: the check-out ends; mark it found somewhere else', async ({
    page,
  }) => {
    const asset = await heldAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await expect(page.getByTestId('asset-holder')).toBeVisible();
    await page.getByRole('button', { name: 'Mark as lost or stolen' }).click();
    const lost = page.getByRole('dialog', { name: `Mark ${asset.asset_tag} as lost or stolen` });
    await expect(lost.getByTestId('lost-closes-checkout')).toContainText('closes that check-out');
    expect(await violations(page)).toEqual([]);
    await lost.getByRole('textbox', { name: 'What happened' }).fill('Left on the bus');
    await lost.getByRole('button', { name: 'Mark as lost' }).click();
    await expect(lost).toBeHidden();
    await expect(page.getByTestId('asset-holder')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check in' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Mark as found' }).click();
    const found = page.getByRole('dialog', { name: `Mark ${asset.asset_tag} as found` });
    const where = found.getByRole('combobox', { name: /Where is it now/ });
    await where.click();
    await where.fill('Gym');
    await page.getByRole('option', { name: /^Gym/ }).click();
    expect(await violations(page)).toEqual([]);
    await found.getByRole('button', { name: 'Mark as found' }).click();
    await expect(found).toBeHidden();
    await expect(page.getByRole('button', { name: 'Check out' })).toBeVisible();

    await page.getByRole('tab', { name: /History/ }).click();
    await expect(page.getByText(/Marked lost: Left on the bus/)).toBeVisible();
    await expect(page.getByText('Marked found', { exact: true })).toBeVisible();
  });

  test('dispose with a reason, date and note: the asset is archived and says why', async ({
    page,
  }) => {
    const asset = await readyAt(page, 6);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Dispose' }).click();
    const dialog = page.getByRole('dialog', { name: `Dispose of ${asset.asset_tag}` });
    await expect(dialog).toContainText('The asset is then archived');
    await choose(page, dialog.getByRole('combobox', { name: /^Reason/ }), 'Recycled');
    await dialog.getByLabel(/^Date/).fill('2026-11-20');
    await dialog.getByRole('textbox', { name: 'Note' }).fill('Certificate R-2210');
    expect(await violations(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Dispose' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('disposal-banner')).toHaveText(
      'Disposed of on 2026-11-20: Recycled. Certificate R-2210',
    );
    await expect(page.getByRole('button', { name: 'Restore' })).toBeVisible();

    // gone from the default (active) list
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill(asset.asset_tag);
    await expect(page.getByRole('row', { name: new RegExp(asset.asset_tag) })).toHaveCount(0);
    await expect(page.getByTestId('assets-range')).toHaveText('');
  });

  test('a checked-out asset cannot be disposed of: the dialog warns and shows the refusal', async ({
    page,
  }) => {
    const asset = await heldAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Dispose' }).click();
    const dialog = page.getByRole('dialog', { name: `Dispose of ${asset.asset_tag}` });
    await expect(dialog.getByTestId('dispose-checked-out')).toContainText('Check it in');
    await choose(page, dialog.getByRole('combobox', { name: /^Reason/ }), 'Sold');
    await dialog.getByRole('button', { name: 'Dispose' }).click();
    await expect(dialog).toContainText('Check it in before disposing of it.');
  });

  test('a lost status picked in the form points at Mark as lost', async ({ page }) => {
    const asset = await readyAt(page, 7);
    await page.goto(`/assets/edit?id=${asset.id}`);
    await choose(page, page.getByRole('combobox', { name: /^Status/ }), 'Missing');
    await expect(page.getByTestId('lifecycle-status-hint')).toContainText(
      'Use Mark as lost or stolen instead',
    );
    expect(await violations(page)).toEqual([]);
  });
});

test.describe('bulk actions', () => {
  test('bulk edit moves the selected assets to a location', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('PRJ-');
    await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-10 of 10');
    await page.getByRole('checkbox', { name: 'Select row PRJ-00004' }).click();
    await page.getByRole('checkbox', { name: 'Select row PRJ-00003' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit 2 assets' });
    await choose(page, dialog.getByRole('combobox', { name: 'Field' }), 'Location');
    const where = dialog.getByRole('combobox', { name: 'New value' });
    await where.click();
    await where.fill('Room 204');
    await page.getByRole('option', { name: /^Room 204/ }).click();
    await dialog.getByRole('textbox', { name: 'Note for the history' }).fill('New term');
    expect(await violations(page)).toEqual([]);
    await dialog.getByRole('button', { name: 'Apply to 2 assets' }).click();
    await expect(page.getByText('Done: 2 assets updated.')).toBeVisible();
    await expect(page.getByRole('row', { name: /PRJ-00004/ })).toContainText('Room 204');
  });

  test('bulk dispose archives the selected assets with one reason', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('PRJ-');
    await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-10 of 10');
    await page.getByRole('checkbox', { name: 'Select row PRJ-00002' }).click();
    await page.getByRole('checkbox', { name: 'Select row PRJ-00001' }).click();
    await page.getByRole('button', { name: /^Dispose of \d+ assets?$/ }).click();
    const dialog = page.getByRole('dialog', { name: /^Dispose of \d+ assets?$/ });
    await choose(page, dialog.getByRole('combobox', { name: /^Reason/ }), 'Donated');
    expect(await violations(page)).toEqual([]);
    await dialog.getByRole('button', { name: /^Dispose of \d+ assets?$/ }).click();
    await expect(page.getByText(/^Done: \d+ assets? updated\.$/)).toBeVisible();
    await expect(page.getByRole('row', { name: /PRJ-00001/ })).toHaveCount(0);
  });
});

test.describe('settings and labels', () => {
  test('Settings opens on the Organisation page, not a placeholder', async ({ page }) => {
    await page.goto('/settings/organisation');
    await expect(page.getByRole('heading', { name: 'Organisation' })).toBeVisible();
    await expect(page.getByText(/not built yet/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Check-out defaults' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Files and photos' })).toBeVisible();
    await settled(page);
    expect(await violations(page)).toEqual([]);
  });

  test('Open PDF shows the sheet in a new tab instead of saving it', async ({ page }) => {
    const asset = await readyAt(page, 8);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Print labels' }).click();
    const dialog = page.getByRole('dialog', { name: /^Print label for / });
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    const ready = dialog.getByTestId('labels-ready');
    await expect(ready).toBeVisible();
    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    const [tab] = await Promise.all([
      page.context().waitForEvent('page'),
      ready.getByRole('button', { name: 'Open PDF' }).click(),
    ]);
    await expect.poll(() => tab.url()).toMatch(/^blob:/);
    expect(downloaded).toBe(false);
  });
});
