import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { assetId, expect, gotoApp, test } from './fixtures';

/** Command palette: live search over GET /v1/search and the "New asset" command (M1-WEB-04). */
test.describe('command palette: search and actions', () => {
  test('live search lists matching assets (debounced) and opens the chosen one', async ({
    page,
  }) => {
    await gotoApp(page, '/');
    const requests: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/v1/search')) requests.push(request.url());
    });
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    // typed one key at a time: the debounce sends few requests, not one per key
    await dialog.getByRole('combobox').pressSequentially('LAP-00007', { delay: 30 });
    const assets = dialog.getByRole('group', { name: 'Assets' });
    await expect(assets.getByRole('option', { name: /LAP-00007 / })).toBeVisible();
    expect(requests.length).toBeLessThanOrEqual(2);
    expect(new URL(requests[0]!).searchParams.get('q')).toMatch(/^LAP-0/);

    await assets.getByRole('option', { name: /LAP-00007 / }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('LAP-00007');
    expect(new URL(page.url()).searchParams.get('id')).toBe(assetId(137));
  });

  test('searching by a model name finds models and categories too', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await dialog.getByRole('combobox').fill('Chrome');
    await expect(
      dialog.getByRole('group', { name: 'Models' }).getByRole('option').first(),
    ).toBeVisible();
    const category = dialog
      .getByRole('group', { name: 'Categories' })
      .getByRole('option', { name: /^Chromebook/ });
    await expect(category).toBeVisible();
    await category.click();
    await expect(page).toHaveURL(/\/settings\/categories\/?$/);
  });

  test('"New asset" opens the create form, also from the C shortcut', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('new asset');
    await page
      .getByRole('option', { name: /New asset/ })
      .first()
      .click();
    await expect(page).toHaveURL(/\/assets\/new\/?$/);
    await expect(page.getByRole('heading', { name: 'New asset', level: 1 })).toBeVisible();

    await gotoApp(page, '/');
    await page.keyboard.press('c');
    await expect(page).toHaveURL(/\/assets\/new\/?$/);
  });

  test.describe('read-only role', () => {
    test.use({ session: MOCK_ACCOUNTS.viewer });
    test('has no "New asset" command and no C shortcut', async ({ page }) => {
      await gotoApp(page, '/');
      await page.keyboard.press('Control+k');
      await page.getByRole('combobox').fill('new asset');
      await expect(page.getByRole('option', { name: /New asset/ })).toHaveCount(0);
      await page.keyboard.press('Escape');
      await page.keyboard.press('c');
      await expect(page).not.toHaveURL(/\/assets\/new/);
    });
  });
});
