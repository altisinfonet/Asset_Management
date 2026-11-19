import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';
import { pick } from './m2-helpers';

/**
 * Accessories and consumables (M2-ACC-04): quantity-aware hand-outs with partial returns, the stock
 * ledger of a consumable with receive / use / count, stock level indicators, the low-stock filter and
 * the minimum-stock setting.
 */
test.describe('accessories', () => {
  test('lists quantities and levels, filters to low stock, and opens an item', async ({ page }) => {
    await page.goto('/stock');
    await expect(page.getByRole('tab', { name: 'Accessories' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByTestId('stock-range')).toHaveText('Showing 1-4 of 4');
    await expect(page.getByRole('row', { name: /HDMI cable 2 m/ })).toContainText('Low stock');
    await expect(page.getByRole('row', { name: /Docking station/ })).toContainText('Out of stock');
    await expect(page.getByRole('row', { name: /USB-C charger/ })).toContainText('In stock');
    await expect(page.getByTestId('stock-low-banner')).toHaveText('2 items are low on stock.');

    await page.getByRole('checkbox', { name: 'Low stock only' }).click();
    await expect(page.getByTestId('stock-range')).toHaveText('Showing 1-2 of 2');
    await page.getByRole('link', { name: 'Docking station' }).click();
    await expect(page).toHaveURL(/\/stock\/view\/?\?kind=accessory&id=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Docking station' })).toBeVisible();
    await expect(page.getByTestId('figure-available')).toHaveText('0');
    // nothing available: no check-out
    await expect(page.getByRole('button', { name: 'Check out' })).toBeDisabled();
  });

  test('checks units out to a person, over-checkout is refused, then part of them come back', async ({
    page,
  }) => {
    await page.goto('/stock');
    await page.getByRole('button', { name: 'Check out HDMI cable 2 m' }).click();
    const dialog = page.getByRole('dialog', { name: 'Check out HDMI cable 2 m' });
    await expect(dialog).toContainText('3 available');
    await dialog.getByRole('spinbutton', { name: /^Quantity/ }).fill('4');
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(dialog.getByText('Enter a whole number from 1 to 3.')).toBeVisible();
    await expect(dialog.getByText('Choose who gets it.')).toBeVisible();

    await pick(page, dialog.getByRole('combobox', { name: /Person/ }), 'Alice', /Alice Owner/);
    await dialog.getByRole('spinbutton', { name: /^Quantity/ }).fill('3');
    await dialog.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(
      page.getByText(/3 x HDMI cable 2 m checked out to Alice Owner/).first(),
    ).toBeVisible();
    await expect(page.getByRole('row', { name: /HDMI cable 2 m/ })).toContainText('Out of stock');

    await page.getByRole('link', { name: 'HDMI cable 2 m' }).click();
    const holders = page.getByRole('table', { name: 'People and places holding this' });
    await expect(holders.getByRole('row', { name: /Alice Owner/ })).toContainText('3');
    // the earlier seeded hand-outs are there too: partial return of the first listed one
    await holders
      .getByRole('button', { name: /^Return units from/ })
      .first()
      .click();
    const ret = page.getByRole('dialog', { name: /^Return units of HDMI cable 2 m/ });
    await ret.getByRole('spinbutton', { name: /^Units coming back/ }).fill('1');
    await ret.getByRole('button', { name: 'Return', exact: true }).click();
    await expect(page.getByText(/1 returned\. \d+ still out\./).first()).toBeVisible();
    await expect(page.getByTestId('figure-available')).toHaveText('1');
  });

  test('sets the minimum stock and the level badge follows', async ({ page }) => {
    await page.goto('/stock');
    await page.getByRole('link', { name: 'HDMI cable 2 m' }).click();
    await expect(page.getByText('Low stock').first()).toBeVisible();
    await page.getByRole('button', { name: 'Change minimum' }).click();
    const dialog = page.getByRole('dialog', { name: 'Minimum stock for HDMI cable 2 m' });
    await dialog.getByRole('spinbutton', { name: /^Minimum stock/ }).fill('1');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Minimum stock is now 1.').first()).toBeVisible();
    await expect(page.getByTestId('figure-minimum')).toHaveText('1');
    await expect(page.getByText('In stock').first()).toBeVisible();
  });

  test('adds an accessory and lands on its page', async ({ page }) => {
    await page.goto('/stock');
    await page.getByRole('button', { name: 'New accessory' }).click();
    const dialog = page.getByRole('dialog', { name: 'New accessory' });
    await dialog.getByRole('textbox', { name: /^Name/ }).fill('Webcam');
    await dialog.getByRole('combobox', { name: /^Category/ }).click();
    await page.getByRole('option', { name: 'Chargers' }).click();
    await dialog.getByRole('spinbutton', { name: /^Total quantity/ }).fill('9');
    await dialog.getByRole('spinbutton', { name: /^Minimum stock/ }).fill('2');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/stock\/view\/?\?kind=accessory&id=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Webcam' })).toBeVisible();
    await expect(page.getByTestId('figure-available')).toHaveText('9');
  });
});

test.describe('consumables', () => {
  test('receive, use and count change the stock and the ledger', async ({ page }) => {
    await page.goto('/stock?kind=consumable');
    await expect(page.getByRole('tab', { name: 'Consumables' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('row', { name: /Toner HP 26A/ })).toContainText('Low stock');
    await page.getByRole('link', { name: 'Toner HP 26A' }).click();
    await expect(page.getByTestId('figure-on-hand')).toHaveText('2 each');

    await page.getByRole('button', { name: 'Receive', exact: true }).click();
    let dialog = page.getByRole('dialog', { name: 'Receive stock for Toner HP 26A' });
    await dialog.getByRole('spinbutton', { name: /^Units received/ }).fill('6');
    await dialog.getByRole('textbox', { name: /^Note/ }).fill('Order 1182');
    await dialog.getByRole('button', { name: 'Receive', exact: true }).click();
    await expect(page.getByTestId('figure-on-hand')).toHaveText('8 each');

    await page.getByRole('button', { name: 'Use', exact: true }).click();
    dialog = page.getByRole('dialog', { name: 'Use Toner HP 26A' });
    await dialog.getByRole('spinbutton', { name: /^Units used/ }).fill('9');
    await dialog.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(dialog.getByText('Only 8 are on hand.')).toBeVisible();
    await dialog.getByRole('spinbutton', { name: /^Units used/ }).fill('5');
    await dialog.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(page.getByTestId('figure-on-hand')).toHaveText('3 each');

    await page.getByRole('button', { name: 'Save count' }).click();
    dialog = page.getByRole('dialog', { name: 'Count Toner HP 26A' });
    await dialog.getByRole('spinbutton', { name: /^Counted on hand/ }).fill('4');
    await expect(dialog.getByTestId('count-delta')).toHaveText('Change: +1');
    await dialog.getByRole('button', { name: 'Save count' }).click();
    await expect(page.getByTestId('figure-on-hand')).toHaveText('4 each');

    const ledger = page.getByRole('table', { name: 'Stock movements' });
    await expect(ledger.getByRole('row').nth(1)).toContainText('Counted');
    await expect(ledger.getByRole('row')).toHaveCount(7);
  });
});

test.describe('read-only role', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('a viewer sees the stock and has no actions', async ({ page }) => {
    await page.goto('/stock');
    await expect(page.getByRole('row', { name: /HDMI cable 2 m/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Check out/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'New accessory' })).toHaveCount(0);
  });
});
