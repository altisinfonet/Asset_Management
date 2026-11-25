import { expect, gotoApp, settled, test } from './fixtures';

test.describe('theme', () => {
  test('follows the OS and a manual override survives a reload without a flash', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/assets');
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(await bg()).toBe('rgb(11, 17, 32)'); // dark `bg` token #0B1120

    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Light' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bg()).toBe('rgb(241, 245, 249)'); // light `bg` token #F1F5F9

    await page.reload();
    // the inline init script applies the stored choice before first paint
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    expect(await bg()).toBe('rgb(241, 245, 249)');

    await page.getByRole('button', { name: 'Theme' }).click();
    await page.getByRole('menuitemradio', { name: 'Use system setting' }).click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.+/);
    expect(await bg()).toBe('rgb(11, 17, 32)');
  });
});

test.describe('navigation shell', () => {
  test('command palette (Ctrl+K) navigates and the sidebar marks the current page', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Dashboard' }),
    ).toHaveAttribute('aria-current', 'page');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('settings');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/settings\/organisation\/?$/);
    await expect(
      page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Settings' }),
    ).toHaveAttribute('aria-current', 'page');
  });

  test('typing a tag in the scan field and pressing Enter opens the asset lookup', async ({
    page,
  }) => {
    await gotoApp(page, '/assets');
    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Scan or type tag')).toBeFocused();
    await page.keyboard.type('AT-00124');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
  });

  test('assets row click opens the 480px drawer; Enter on a row opens the full page', async ({
    page,
  }) => {
    await page.goto('/assets');
    await page.getByRole('row', { name: /PRJ-00010/ }).click();
    const drawer = page.getByRole('dialog');
    await expect(drawer).toBeVisible();
    expect((await drawer.boundingBox())?.width).toBeCloseTo(480, 0);
    await page.keyboard.press('Escape');
    await expect(drawer).toBeHidden();

    await page.getByRole('row', { name: /PRJ-00009/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-00009');
  });
});

test.describe('responsive layout (375, 768, 1440)', () => {
  for (const width of [375, 768, 1440]) {
    for (const url of [
      '/',
      '/assets',
      '/assets/new',
      '/settings/users',
      '/settings/categories',
      '/settings/fields',
      '/settings/models',
      '/settings/status',
      '/account/security',
    ]) {
      test(`${url} has no horizontal page scroll at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        await expect(page.locator('main')).toBeVisible();
        await settled(page);
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        );
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }
    test.describe('signed-out screens', () => {
      test.use({ session: 'none' });
      for (const url of [
        '/login',
        '/forgot-password',
        '/reset-password?token=reset-valid',
        '/invitation?token=inv-valid',
      ]) {
        test(`${url} has no horizontal page scroll at ${width}px`, async ({ page }) => {
          await page.setViewportSize({ width, height: 900 });
          await page.goto(url);
          await page.waitForLoadState('networkidle');
          await expect(page.locator('main h1')).toBeVisible();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
          );
          expect(overflow).toBeLessThanOrEqual(0);
        });
      }
    });
  }

  test('below 1024px the sidebar becomes an off-canvas drawer', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await page.goto('/assets');
    await expect(page.locator('aside')).toBeHidden();
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const nav = page.getByRole('dialog').getByRole('navigation', { name: 'Primary' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Settings' }).click();
    await expect(page).toHaveURL(/\/settings\//);
    await expect(page.getByRole('dialog')).toBeHidden();
  });
});
