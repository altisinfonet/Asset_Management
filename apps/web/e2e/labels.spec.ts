import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { assetId, expect, settled, test } from './fixtures';
import { choose } from './m2-helpers';

/**
 * Label printing (M2-TAG-03): from the asset list (selection and filter) and from an asset's page.
 * Template, start position on a partly used sheet (visual grid), codes and text lines, a live preview
 * of one label, then the PDF as a download. The last template is remembered in this browser.
 */
test.describe('print labels', () => {
  test('selection from the list: choose a template and the start slot, download the PDF', async ({
    page,
  }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('PRJ-');
    await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-10 of 10');
    await page.getByRole('checkbox', { name: 'Select row PRJ-00010' }).click();
    await page.getByRole('checkbox', { name: 'Select row PRJ-00009' }).click();
    await page.getByRole('checkbox', { name: 'Select row PRJ-00008' }).click();
    await page.getByRole('button', { name: 'Print labels (3)' }).click();

    const dialog = page.getByRole('dialog', { name: 'Print labels' });
    await expect(dialog.getByTestId('labels-source')).toHaveText('3 selected assets');
    await expect(dialog.getByTestId('label-preview')).toBeVisible();
    await expect(dialog.getByRole('img', { name: 'QR code' })).toBeVisible();

    await choose(page, dialog.getByRole('combobox', { name: 'Sheet template' }), /A4 21-up/);
    const grid = dialog.getByRole('radiogroup', { name: 'Start position on the sheet' });
    await expect(grid.getByRole('radio')).toHaveCount(21);
    await grid.getByRole('radio', { name: /^Position 8,/ }).click();
    await expect(dialog.getByTestId('labels-start')).toContainText('8');
    await expect(grid.getByRole('radio', { name: /^Position 7,.*already used/ })).toBeVisible();
    await expect(grid.getByRole('radio', { name: /^Position 9,.*gets a label/ })).toBeVisible();

    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    // the PDF is made in the background: queued first, then ready with a short-lived link
    await expect(dialog.getByTestId('labels-queued')).toBeVisible();
    const ready = dialog.getByTestId('labels-ready');
    await expect(ready).toContainText('3 labels on 1 sheet');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      ready.getByRole('link', { name: 'Download PDF' }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^labels-a4-21up-qr-.+\.pdf$/);
  });

  test('remembers the last template for the next time', async ({ page }) => {
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await page.getByRole('button', { name: 'Print labels' }).click();
    let dialog = page.getByRole('dialog', { name: /^Print label for / });
    await expect(dialog.getByTestId('labels-source')).toHaveText('1 selected asset');
    await choose(page, dialog.getByRole('combobox', { name: 'Sheet template' }), /Letter 10-up/);
    await dialog.getByRole('checkbox', { name: 'Code 128 barcode' }).click();
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByTestId('labels-ready')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await page.reload();
    await page.getByRole('button', { name: 'Print labels' }).click();
    dialog = page.getByRole('dialog', { name: /^Print label for / });
    await expect(dialog.getByRole('combobox', { name: 'Sheet template' })).toContainText(
      'US Letter 10-up',
    );
    await expect(dialog.getByRole('checkbox', { name: 'Code 128 barcode' })).not.toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'QR code' })).toBeChecked();

    // and each printed asset says so in its history
    await page.keyboard.press('Escape');
    await page.goto(`/assets/view?id=${assetId(124)}&tab=history`);
    await expect(page.getByText('Label printed').first()).toBeVisible();
  });

  test('the whole filter, and a refusal beyond what one PDF holds', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('LAP-');
    await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-39 of 39');
    await page.getByRole('button', { name: 'Print labels for this filter' }).click();
    const dialog = page.getByRole('dialog', { name: 'Print labels' });
    await expect(dialog.getByTestId('labels-source')).toHaveText(
      '39 assets match the current filter',
    );
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
  });

  test('a one-label page has no start position; a role without asset:label has no button', async ({
    page,
  }) => {
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await page.getByRole('button', { name: 'Print labels' }).click();
    const dialog = page.getByRole('dialog', { name: /^Print label for / });
    await choose(
      page,
      dialog.getByRole('combobox', { name: 'Sheet template' }),
      /Single label 50 x 25/,
    );
    await expect(dialog.getByText(/one label per page/)).toBeVisible();
    await expect(dialog.getByRole('radiogroup')).toHaveCount(0);
    await expect(dialog.getByTestId('label-preview')).toBeVisible();
  });
});

test.describe('label batches that do not finish well', () => {
  test('says why a batch failed and lets the user try again', async ({ page }) => {
    await page.addInitScript(() =>
      window.localStorage.setItem('at-mock-label-failure', 'logo-invalid'),
    );
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await page.getByRole('button', { name: 'Print labels' }).click();
    const dialog = page.getByRole('dialog', { name: /^Print label for / });
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    const failed = dialog.getByTestId('labels-failed');
    await expect(failed).toContainText('The labels could not be made');
    await expect(failed).toContainText('The logo is not a clean PNG or JPEG.');
    await failed.getByRole('button', { name: 'Try again' }).click();
    await expect(dialog.getByRole('button', { name: 'Generate PDF' })).toBeVisible();
  });
});

test.describe('print labels without permission', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('a viewer gets no print button on the list or the asset page', async ({ page }) => {
    await page.goto('/assets');
    // viewers read assets but hold neither export:run nor asset:label
    await expect(page.getByRole('button', { name: 'Export CSV' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Print labels for this filter' })).toHaveCount(0);
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await settled(page);
    await expect(page.getByTestId('asset-tag')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Print labels' })).toHaveCount(0);
  });
});
