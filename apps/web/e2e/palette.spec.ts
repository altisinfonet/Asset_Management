import { expect, gotoApp, test } from './fixtures';

/** Command palette, recent items and keyboard shortcuts (M1-WEB-04) in a real browser. */
test.describe('command palette', () => {
  test('Ctrl+K navigates to a screen by name', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toBeFocused();
    await dialog.getByRole('combobox').fill('assets');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/assets\/?$/);
    await expect(dialog).toBeHidden();
  });

  test('a typed asset tag jumps to /assets/view?code=', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: 'Command palette' });
    await dialog.getByRole('combobox').fill('AT-00124');
    await dialog.getByRole('option', { name: 'Open asset AT-00124' }).click();
    await expect(page.getByTestId('asset-code')).toHaveText('AT-00124');
    expect(new URL(page.url()).search).toBe('?code=AT-00124');
  });

  test('recent items are remembered across reloads and listed first', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('AT-00124');
    await page.getByRole('option', { name: 'Open asset AT-00124' }).click();
    await expect(page.getByTestId('asset-code')).toBeVisible();

    await page.reload();
    await expect(page.locator('main#main')).toBeVisible();
    await page.keyboard.press('Control+k');
    const recent = page.getByRole('group', { name: 'Recent' });
    await expect(recent.getByRole('option', { name: 'Open asset AT-00124' })).toBeVisible();
    await recent.getByRole('option', { name: 'Open asset AT-00124' }).click();
    await expect(page.getByTestId('asset-code')).toHaveText('AT-00124');
  });

  test('works with localStorage blocked (the palette and navigation still function)', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key: string, value: string) {
        if (key === 'at-recent-items') throw new Error('blocked');
        return original.call(this, key, value);
      };
    });
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('assets');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/assets\/?$/);
  });

  test('Esc closes the palette and focus is not trapped afterwards', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeHidden();
    await page.keyboard.press('Tab');
    await expect(page.locator('body')).not.toBeFocused();
  });
});

test.describe('keyboard shortcuts', () => {
  test('? opens the shortcut help, Esc closes it', async ({ page }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('?');
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('Open the command palette')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
  });

  test('g then a goes to Assets, g then s to Settings, g then d to the dashboard', async ({
    page,
  }) => {
    await gotoApp(page, '/');
    await page.keyboard.press('g');
    await page.keyboard.press('a');
    await expect(page).toHaveURL(/\/assets\/?$/);
    await page.keyboard.press('g');
    await page.keyboard.press('s');
    await expect(page).toHaveURL(/\/settings\/organisation\/?$/);
    await page.keyboard.press('g');
    await page.keyboard.press('d');
    await expect(page).toHaveURL(/\/$/);
  });

  test('the user menu offers the shortcut help, security and sign out', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByRole('menuitem', { name: /Security/ })).toBeVisible();
    await page.getByRole('menuitem', { name: /Keyboard shortcuts/ }).click();
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
  });
});
