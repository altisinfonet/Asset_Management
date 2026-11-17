import { expect, test, type Page } from '@playwright/test';

/**
 * Automated WCAG 2.2 AA checks (axe-core) in a real browser, including colour contrast, for the
 * main screens in light and dark. Complements the jsdom axe tests in src/components/ui.
 */
const axePath = require.resolve('axe-core');

const PAGES = [
  '/',
  '/assets',
  '/assets/view?id=0190a6b2-7c3e-7a10-9d2f-4f5e6a7b8c9d',
  '/settings/categories',
  '/login',
  '/ui',
];

async function violations(page: Page) {
  await page.addScriptTag({ path: axePath });
  return page.evaluate(async () => {
    const axe = (
      window as unknown as {
        axe: {
          run: (
            c: Document,
            o: object,
          ) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: string[] }> }> }>;
        };
      }
    ).axe;
    const results = await axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] },
    });
    return results.violations.map(
      (v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`,
    );
  });
}

for (const scheme of ['light', 'dark'] as const) {
  for (const url of PAGES) {
    test(`axe: ${url} (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(url);
      await page.waitForLoadState('networkidle');
      expect(await violations(page)).toEqual([]);
    });
  }
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
