import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';
import {
  choose,
  heldAsset,
  PNG,
  personId,
  pick,
  readyAsset,
  touchAsset,
  checkOutViaApi,
} from './m2-helpers';

/** Check-out, check-in and transfer (M2-LIFE-07): dialogs, conflicts, history, list columns and filters. */
test.describe('check-out, check-in and transfer from the asset page', () => {
  test('checks a ready asset out to a person, shows who holds it and records the history', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await expect(page.getByTestId('asset-tag')).toHaveText(asset.asset_tag);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();

    const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
    await expect(dialog).toBeVisible();
    // nothing chosen yet: the form says what is missing
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(dialog.getByText('Choose who or where it goes.')).toBeVisible();

    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
    await dialog.getByRole('button', { name: 'In a week' }).click();
    await dialog.getByLabel('Notes').fill('Exam week');
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();

    await expect(
      page.getByText(`${asset.asset_tag} checked out to Maria Reyes.`).first(),
    ).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId('asset-holder')).toContainText('Assigned to Maria Reyes');
    await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Transfer', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: /History/ }).click();
    const history = page.getByRole('list', { name: 'History' });
    await expect(history.getByText('Checked out to Maria Reyes').first()).toBeVisible();
    await expect(history.getByText('by Alice Owner').first()).toBeVisible();
  });

  test('keyboard only: person picker with arrows and Enter, Ctrl+Enter submits', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
    const person = dialog.getByRole('combobox', { name: /Person/ });
    await expect(person).toBeFocused();
    await page.keyboard.type('Jamie Okafor');
    // typing highlights the first match; Enter chooses it, even before the search answered
    await page.keyboard.press('Enter');
    await expect(person).toHaveAttribute('aria-expanded', 'false');
    await expect(person).toHaveValue('Jamie Okafor');
    // the first Escape closes a list, not the dialog
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Control+Enter');
    await expect(
      page.getByText(`${asset.asset_tag} checked out to Jamie Okafor.`).first(),
    ).toBeVisible();
  });

  test('checks in with a condition, a status, a location and a photo', async ({ page }) => {
    const asset = await heldAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Check in', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Check in ${asset.asset_tag}` });
    await choose(page, dialog.getByRole('combobox', { name: 'Condition' }), 'Fair');
    await choose(
      page,
      dialog.getByRole('combobox', { name: 'Status after check-in' }),
      'Out for fix',
    );
    await pick(
      page,
      dialog.getByRole('combobox', { name: 'Location now' }),
      'Room 204',
      /Room 204/,
    );
    await dialog.getByLabel('Notes').fill('Cracked bezel');

    // the photo goes through the attachments pipeline; the form waits until it is clean
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'bezel.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(dialog.getByText('Waiting for the photo to finish')).toBeVisible();
    await expect(dialog.getByRole('list', { name: 'Attached photos' })).toContainText('bezel.png');
    await dialog.getByRole('button', { name: 'Check in', exact: true }).click();

    await expect(page.getByText(`${asset.asset_tag} checked in.`).first()).toBeVisible();
    await expect(page.getByTestId('asset-holder')).toHaveCount(0);
    await page.getByRole('tab', { name: /History/ }).click();
    const history = page.getByRole('list', { name: 'History' });
    await expect(history.getByText('Condition: Fair').first()).toBeVisible();
    await expect(history.getByText('“Cracked bezel”').first()).toBeVisible();
  });

  test('transfers to another person in one step', async ({ page }) => {
    const asset = await heldAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Transfer', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Transfer ${asset.asset_tag}` });
    await expect(dialog.getByText('From', { exact: true })).toBeVisible();
    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Priya', /Priya Patel/);
    await dialog.getByLabel('Reason').fill('Class change');
    await dialog.getByRole('button', { name: 'Transfer', exact: true }).click();
    await expect(
      page.getByText(`${asset.asset_tag} transferred to Priya Patel.`).first(),
    ).toBeVisible();
    await expect(page.getByTestId('asset-holder')).toContainText('Priya Patel');
  });

  test('a changed asset shows a banner with a way to reload (412), then succeeds', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
    await expect(dialog.getByTestId('custody-asset-tag')).toBeVisible();
    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
    // someone else edits the asset while the dialog is open
    await touchAsset(page, asset);
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    const banner = dialog.getByRole('status').filter({ hasText: 'The asset changed' });
    await expect(banner).toBeVisible();
    await banner.getByRole('button', { name: 'Reload asset' }).click();
    await expect(banner).toBeHidden();
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(
      page.getByText(`${asset.asset_tag} checked out to Maria Reyes.`).first(),
    ).toBeVisible();
  });

  test('an asset checked out meanwhile is reported, and after a reload offers check-in instead', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
    await expect(dialog.getByTestId('custody-asset-tag')).toBeVisible();
    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
    // somebody else checks it out first; the dialog still believes it is free
    await checkOutViaApi(page, asset.id, await personId(page, 'Jamie'));
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    const banner = dialog.getByRole('status').filter({ hasText: 'The asset changed' });
    await banner.getByRole('button', { name: 'Reload asset' }).click();
    // the dialog now sees the asset as held: it offers check-in and transfer instead
    const held = page.getByRole('dialog', { name: `Check in ${asset.asset_tag}` });
    await expect(held.getByRole('tab', { name: 'Check in' })).toBeVisible();
    await expect(held.getByRole('tab', { name: 'Transfer' })).toBeVisible();
    await expect(held.getByText(/^Held by Jamie/)).toBeVisible();
  });
});

test.describe('read-only role', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('has no Check out button on a ready asset', async ({ page }) => {
    await page.goto('/assets');
    const row = page.getByRole('row').nth(1);
    await row.click();
    await page.getByRole('link', { name: 'Open full page' }).click();
    await expect(page.getByTestId('asset-tag')).toBeVisible();
    await expect(page.getByRole('button', { name: /Check out|Check in|Transfer/ })).toHaveCount(0);
  });
});

test.describe('asset list: custody columns, filters and bulk actions', () => {
  test('shows who holds each asset and filters by custody and by holder', async ({ page }) => {
    const held = await heldAsset(page);
    await page.goto('/assets');
    await expect(page.getByRole('columnheader', { name: 'Assigned to' })).toBeVisible();
    await expect(page.getByTestId('assets-range')).toContainText('of 195');

    await choose(page, page.getByRole('combobox', { name: 'Custody' }), 'Checked out', true);
    await expect(page.getByTestId('assets-range')).not.toContainText('of 195');
    await page.getByPlaceholder('Tag, serial or name').fill(held.asset_tag);
    await expect(page.getByRole('row', { name: new RegExp(held.asset_tag) })).toBeVisible();

    await choose(page, page.getByRole('combobox', { name: 'Custody' }), 'In stock', true);
    await expect(page.getByRole('row', { name: new RegExp(held.asset_tag) })).toHaveCount(0);

    await page.getByRole('button', { name: 'Clear all filters' }).first().click();
    await expect(page.getByPlaceholder('Tag, serial or name')).toHaveValue('');
    const person = await page.evaluate(async (id) => {
      const body = (await (await fetch(`/v1/assets/${id}`)).json()) as {
        current_assignment: { target_name: string };
      };
      return body.current_assignment.target_name;
    }, held.id);
    await pick(page, page.getByRole('combobox', { name: 'Held by' }), person, new RegExp(person));
    await page.getByPlaceholder('Tag, serial or name').fill(held.asset_tag);
    await expect(page.getByRole('row', { name: new RegExp(held.asset_tag) })).toBeVisible();
  });

  test('filters by location with its sublocations and links from a location', async ({ page }) => {
    await page.goto('/assets');
    await pick(
      page,
      page.getByRole('combobox', { name: 'Location' }),
      'Main building',
      /^Main building/,
    );
    await expect(page.getByTestId('assets-range')).toContainText('of');
    await expect(page.getByRole('checkbox', { name: 'Include sublocations' })).toBeChecked();
    const withChildren = await page.getByTestId('assets-range').textContent();
    await page.getByRole('checkbox', { name: 'Include sublocations' }).click();
    await expect(page.getByTestId('assets-range')).not.toHaveText(withChildren ?? '');
  });

  test('bulk check-in from the list returns every selected asset', async ({ page }) => {
    await page.goto('/assets');
    await choose(page, page.getByRole('combobox', { name: 'Custody' }), 'Checked out', true);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    const tags: string[] = [];
    for (const index of [1, 2]) {
      const row = page.getByRole('row').nth(index);
      tags.push((await row.getByRole('link').first().textContent()) ?? '');
      await row.getByRole('checkbox').click();
    }
    await page.getByRole('button', { name: /^Check in \(2\)/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Check in 2 assets' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByText('2 assets checked in.').first()).toBeVisible();
    for (const tag of tags)
      await expect(page.getByRole('row', { name: new RegExp(tag) })).toHaveCount(0);
  });

  test('undo toast (M2-UX-02): Undo reverses a check-out; the history keeps both; Undo works with the keyboard', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(
      page.getByText(`${asset.asset_tag} checked out to Maria Reyes.`).first(),
    ).toBeVisible();
    await expect(page.getByText('You can undo this for 10 seconds.').first()).toBeVisible();
    await expect(page.getByTestId('asset-holder')).toContainText('Assigned to Maria Reyes');

    // F8 jumps to the notifications region; Undo is reachable and used with Enter
    await page.keyboard.press('F8');
    const undo = page.getByRole('button', { name: 'Undo', exact: true });
    await undo.focus();
    await expect(undo).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(
      page.getByText(`Undone: ${asset.asset_tag} is back as it was.`).first(),
    ).toBeVisible();
    await expect(page.getByTestId('asset-holder')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();

    await page.getByRole('tab', { name: /History/ }).click();
    const history = page.getByRole('list', { name: 'History' });
    await expect(history.getByText('Custody undone').first()).toBeVisible();
    await expect(history.getByText('Checked out to Maria Reyes').first()).toBeVisible();
  });

  test('undo is refused with a clear message when the asset changed meanwhile', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` });
    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(
      page.getByText(`${asset.asset_tag} checked out to Maria Reyes.`).first(),
    ).toBeVisible();
    // somebody else edits the asset after the check-out
    const current = await page.evaluate(
      async (id) => (await fetch(`/v1/assets/${id}`)).headers.get('etag') ?? '',
      asset.id,
    );
    await touchAsset(page, { ...asset, etag: current });
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    await expect(
      page
        .getByText(`${asset.asset_tag} changed in the meantime, so this cannot be undone.`)
        .first(),
    ).toBeVisible();
  });

  test('bulk check-out to one person', async ({ page }) => {
    await page.goto('/assets');
    await choose(page, page.getByRole('combobox', { name: 'Custody' }), 'In stock', true);
    await choose(page, page.getByRole('combobox', { name: 'Status' }), 'Ready', true);
    await expect(page.getByRole('row').nth(1)).toBeVisible();
    await page.getByRole('row').nth(1).getByRole('checkbox').click();
    await page.getByRole('row').nth(2).getByRole('checkbox').click();
    await page.getByRole('button', { name: /^Check out \(2\)/ }).click();
    const dialog = page.getByRole('dialog', { name: 'Check out 2 assets' });
    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Maria', /Maria Reyes/);
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(page.getByText('2 assets checked out to Maria Reyes.').first()).toBeVisible();
  });
});
