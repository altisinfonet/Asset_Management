import { violations } from './axe';
import { expect, test } from './fixtures';

/**
 * Automated WCAG 2.2 AA checks (axe-core) in a real browser, including colour contrast, for the
 * main screens in light and dark. Complements the jsdom axe tests in src/components/ui.
 * The auth screens have their own file (a11y-auth.spec.ts).
 */
const APP_PAGES = [
  '/',
  '/assets',
  '/assets/view?id=0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8c9d',
  '/settings/categories',
];
const PUBLIC_PAGES = ['/login', '/ui'];

for (const scheme of ['light', 'dark'] as const) {
  for (const url of APP_PAGES) {
    test(`axe: ${url} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('main')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  }
  test.describe(`public pages (${scheme})`, () => {
    test.use({ session: 'none' });
    for (const url of PUBLIC_PAGES) {
      test(`axe: ${url} (${scheme})`, async ({ page }) => {
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(url);
        await page.waitForLoadState('networkidle');
        expect(await violations(page)).toEqual([]);
      });
    }
  });
}

test('axe: assets drawer and command palette are accessible when open', async ({ page }) => {
  await page.goto('/assets');
  await page.getByRole('row', { name: /AT-00123/ }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(await violations(page)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+k');
  await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  expect(await violations(page)).toEqual([]);
});
