import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { assetId, expect, test } from './fixtures';
import { PNG } from './m2-helpers';

/** Attachments (M2-FILE-04) on the asset's Attachments tab: upload, scan states, download, delete. */
const url = `/assets/view?id=${assetId(124)}&tab=attachments`;

test.describe('attachments tab', () => {
  test('lists the files with their scan state, thumbnails for clean images and a download', async ({
    page,
  }) => {
    await page.goto(url);
    const list = page.getByRole('list', { name: 'Attached files' });
    await expect(list.getByRole('listitem')).toHaveCount(4);
    await expect(
      list.getByRole('listitem').filter({ hasText: 'purchase-order.pdf' }),
    ).toContainText('Ready');
    await expect(list.getByRole('listitem').filter({ hasText: 'warranty-card.pdf' })).toContainText(
      'Scanning',
    );
    const rejected = list.getByRole('listitem').filter({ hasText: 'invoice-copy.pdf' });
    await expect(rejected).toContainText('Rejected');
    // only a clean file can be downloaded
    await expect(rejected.getByRole('button', { name: /Download/ })).toHaveCount(0);
    await expect(
      list
        .getByRole('listitem')
        .filter({ hasText: 'warranty-card.pdf' })
        .getByRole('button', { name: /Download/ }),
    ).toHaveCount(0);
    await expect(
      list.getByRole('listitem').filter({ hasText: 'front.png' }).locator('img'),
    ).toBeVisible();

    const download = page.waitForEvent('download');
    await list.getByRole('button', { name: 'Download purchase-order.pdf' }).click();
    expect((await download).suggestedFilename()).toBe('purchase-order.pdf');
  });

  test('uploads a picture: progress, scanning, then ready with a thumbnail', async ({ page }) => {
    await page.goto(url);
    await page.locator('input[type=file]').setInputFiles({
      name: 'new-photo.png',
      mimeType: 'image/png',
      buffer: PNG,
    });
    const row = page.getByRole('listitem').filter({ hasText: 'new-photo.png' });
    await expect(row).toBeVisible();
    // the scan takes a moment (the mock scanner answers after 1.5 s); the list refreshes itself
    await expect(row).toContainText('Ready', { timeout: 15_000 });
    await expect(row.locator('img')).toBeVisible();
    await expect(
      page.getByRole('list', { name: 'Attached files' }).getByRole('listitem'),
    ).toHaveCount(5);
  });

  test('a file the scanner rejects is shown as rejected and cannot be downloaded', async ({
    page,
  }) => {
    await page.goto(url);
    await page.locator('input[type=file]').setInputFiles({
      name: 'eicar-test.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR'),
    });
    const row = page.getByRole('listitem').filter({ hasText: 'eicar-test.pdf' });
    await expect(row).toContainText('Rejected', { timeout: 15_000 });
    await expect(row.getByRole('button', { name: /Download/ })).toHaveCount(0);
  });

  test('a type or size the server refuses shows the server message and can be dismissed', async ({
    page,
  }) => {
    await page.goto(url);
    await page.locator('input[type=file]').setInputFiles({
      name: 'setup.exe',
      mimeType: 'application/x-msdownload',
      buffer: Buffer.from('MZ'),
    });
    const refusal = page.getByRole('alert').filter({ hasText: 'are not accepted' });
    await expect(refusal).toBeVisible();
    await page.getByRole('button', { name: 'Dismiss' }).click();
    await expect(refusal).toHaveCount(0);
  });

  test('deleting a file asks first and removes it', async ({ page }) => {
    await page.goto(url);
    await page.getByRole('button', { name: 'Delete purchase-order.pdf' }).click();
    const dialog = page.getByRole('dialog', { name: 'Delete purchase-order.pdf?' });
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(
      page.getByRole('listitem').filter({ hasText: 'purchase-order.pdf' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Delete purchase-order.pdf' }).click();
    await page
      .getByRole('dialog', { name: 'Delete purchase-order.pdf?' })
      .getByRole('button', { name: 'Delete' })
      .click();
    await expect(page.getByText('purchase-order.pdf deleted.').first()).toBeVisible();
    // (the toast is a list item too, so look in the list of files)
    await expect(
      page
        .getByRole('list', { name: 'Attached files' })
        .getByRole('listitem')
        .filter({ hasText: 'purchase-order.pdf' }),
    ).toHaveCount(0);
  });

  test('the drop zone takes dropped files', async ({ page }) => {
    await page.goto(url);
    const zone = page.getByText('or drag files here').locator('..').locator('..');
    const data = await page.evaluateHandle(
      (bytes) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], 'dropped.png', { type: 'image/png' }));
        return transfer;
      },
      [...PNG],
    );
    await zone.dispatchEvent('drop', { dataTransfer: data });
    await expect(page.getByRole('listitem').filter({ hasText: 'dropped.png' })).toBeVisible();
  });
});

test.describe('attachments (read-only role)', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('can see and download files but not add or delete them', async ({ page }) => {
    await page.goto(url);
    await expect(page.getByRole('list', { name: 'Attached files' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Choose files' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Delete/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Download purchase-order.pdf' })).toBeVisible();
  });
});
