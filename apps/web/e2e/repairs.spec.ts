import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';
import { PNG, pick, readyAsset } from './m2-helpers';

/**
 * The repair log (M2-MNT-02): the tenant-wide Repairs page with filters and cost totals, the drawer of
 * one repair with its receipts, the Repairs tab of an asset, logging a repair (the asset goes "in
 * repair") and closing it (the asset comes back).
 */
test.describe('Repairs page', () => {
  test('lists open repairs first with counts and the cost of what is shown', async ({ page }) => {
    await page.goto('/repairs');
    await expect(page.getByRole('row', { name: /Cracked screen, replace/ })).toContainText('Open');
    await expect(page.getByRole('row', { name: /Battery swap/ })).toContainText('In progress');
    await expect(page.getByRole('tab', { name: /Open/ })).toContainText('3');
    await expect(page.getByRole('tab', { name: /Closed/ })).toContainText('2');
    await expect(page.getByTestId('repairs-total')).toHaveText('Cost of the repairs shown: $86.00');

    await page.getByRole('tab', { name: /Closed/ }).click();
    await expect(page.getByRole('row', { name: /Replace screen/ })).toContainText('Done');
    await expect(page.getByTestId('repairs-total')).toContainText('$109.00');
    await page.getByLabel('Reported from').fill('2099-01-01');
    await expect(page.getByRole('heading', { name: 'No repairs match' })).toBeVisible();
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.getByRole('row', { name: /Replace screen/ })).toBeVisible();
  });

  test('logs a repair for an asset: it goes in repair, files can be added, then it is closed', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await page.goto('/repairs');
    await page.getByRole('button', { name: 'Log repair' }).click();
    const dialog = page.getByRole('dialog', { name: 'Log a repair' });
    await dialog.getByRole('button', { name: 'Log repair' }).click();
    await expect(dialog.getByText('Choose the asset.')).toBeVisible();
    await expect(dialog.getByText('Describe what needs doing.')).toBeVisible();

    await pick(
      page,
      dialog.getByRole('combobox', { name: /^Asset\(required\)/ }),
      asset.asset_tag,
      new RegExp(asset.asset_tag),
    );
    await dialog.getByRole('textbox', { name: /^What needs doing/ }).fill('Broken hinge');
    await dialog.getByRole('combobox', { name: 'Supplier' }).click();
    await page.getByRole('option', { name: 'CDW' }).click();
    await dialog.getByRole('textbox', { name: /^Quoted cost/ }).fill('45.50');
    await dialog.getByRole('button', { name: 'Log repair' }).click();

    const files = page.getByRole('dialog', { name: 'Repair logged' });
    await expect(files).toBeVisible();
    await files.locator('input[type="file"]').setInputFiles({
      name: 'quote.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    await expect(files.getByText('quote.png')).toBeVisible();
    await files.getByRole('button', { name: 'Done' }).click();

    // in the open list now; the asset page says it is in repair and has no check-out
    await expect(page.getByRole('row', { name: /Broken hinge/ })).toContainText('$45.50');
    await page.goto(`/assets/view?id=${asset.id}`);
    await expect(page.getByTestId('asset-tag')).toHaveText(asset.asset_tag);
    await expect(page.getByRole('button', { name: 'Check out', exact: true })).toHaveCount(0);

    // close it from the asset's Repairs tab
    await page.goto(`/assets/view?id=${asset.id}&tab=repairs`);
    await expect(page.getByTestId('repairs-summary')).toHaveText('1 repair, $45.50 in total');
    await page.getByRole('button', { name: 'Open repair Broken hinge' }).click();
    const drawer = page.getByRole('dialog', { name: 'Broken hinge' });
    await expect(drawer.getByText('quote.png')).toBeVisible();
    await drawer.getByRole('button', { name: 'Close repair' }).click();
    const close = page.getByRole('dialog', { name: 'Close repair "Broken hinge"' });
    await close.getByRole('textbox', { name: /^Final cost/ }).fill('52');
    await close.getByRole('textbox', { name: /^What was done/ }).fill('New hinge fitted');
    await close.getByRole('button', { name: 'Close repair' }).click();
    await expect(page.getByText('Repair closed.').first()).toBeVisible();
    // the drawer stays open and shows the repair as done
    await expect(drawer).toContainText('Done');
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(page.getByRole('row', { name: /Broken hinge/ })).toContainText('Done');
    await expect(page.getByTestId('repairs-summary')).toHaveText('1 repair, $52.00 in total');
    // ready again: it can be checked out
    await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeVisible();
    // and the history tells the story
    await page.goto(`/assets/view?id=${asset.id}&tab=history`);
    await expect(page.getByText('Repair opened').first()).toBeVisible();
    await expect(page.getByText('Repair completed').first()).toBeVisible();
  });

  test('an open repair can be started and cancelled', async ({ page }) => {
    await page.goto('/repairs');
    await page.getByRole('button', { name: 'Open repair Keyboard not responding' }).click();
    const drawer = page.getByRole('dialog', { name: 'Keyboard not responding' });
    await drawer.getByRole('button', { name: 'Start work' }).click();
    await expect(page.getByText('Repair marked in progress.').first()).toBeVisible();
    await drawer.getByRole('button', { name: 'Cancel repair' }).click();
    const confirm = page.getByRole('dialog', { name: 'Cancel this repair?' });
    await confirm.getByRole('button', { name: 'Cancel repair' }).click();
    await expect(page.getByText('Repair cancelled.').first()).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('row', { name: /Keyboard not responding/ })).toHaveCount(0);
  });
});

test.describe('read-only role', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('a viewer reads the log and has no Log repair button', async ({ page }) => {
    await page.goto('/repairs');
    await expect(page.getByRole('row', { name: /Cracked screen, replace/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Log repair' })).toHaveCount(0);
  });
});
