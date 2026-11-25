import type { Page } from '@playwright/test';
import { violations } from './axe';
import { expect, settled, test } from './fixtures';

/** The dashboard (WEB-03) against the mock API, and the sidebar that leads to it. */
const TILES = [
  { id: 'ready', label: 'Ready', href: '/assets?state_type=deployable' },
  { id: 'assigned', label: 'Assigned', href: '/assets?assigned=yes' },
  { id: 'inRepair', label: 'Not deployable', href: '/assets?state_type=undeployable' },
  { id: 'overdue', label: 'Overdue check-outs', href: '/assets?overdue=1' },
] as const;

async function tileCount(page: Page, id: string): Promise<number> {
  const text = await page.getByTestId(`tile-${id}`).locator('[data-tile-count]').innerText();
  return Number(text.replace(/[^\d]/g, ''));
}

/** Open the dashboard and wait until the tiles exist and nothing on it is loading any more. */
async function openDashboard(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('tile-ready')).toBeVisible();
  await settled(page);
}

test.describe('dashboard', () => {
  test('shows real counts in the tiles, the status charts and the needs-attention panels, no placeholder', async ({
    page,
  }) => {
    await openDashboard(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    for (const tile of TILES) {
      const link = page.getByTestId(`tile-${tile.id}`);
      await expect(link).toContainText(tile.label);
      expect(await link.getAttribute('href')).toContain(tile.href.split('?')[1]!);
      expect(await tileCount(page, tile.id)).toBeGreaterThan(0);
    }
    await expect(page.getByTestId('chart-status').getByRole('img')).toBeVisible();
    await expect(page.getByTestId('chart-utilisation').getByRole('img')).toBeVisible();
    await expect(page.getByText('Counts and attention lists arrive')).toHaveCount(0);
    await expect(page.getByText('API status')).toHaveCount(0);

    for (const panel of ['overdue', 'stock', 'repairs']) {
      const card = page.getByTestId(`panel-${panel}`);
      await expect(card).toBeVisible();
      const rows = await card.getByRole('listitem').count();
      expect(rows).toBeGreaterThan(0);
      expect(rows).toBeLessThanOrEqual(5);
    }
    // the overdue card says what it counts, under its title
    await expect(page.getByTestId('panel-overdue-hint')).toHaveText(
      'Every checked-out asset past its return date, loans included.',
    );
  });

  test('a tile opens the asset list already filtered, with the same number', async ({ page }) => {
    await openDashboard(page);
    const overdue = await tileCount(page, 'overdue');
    await page.getByTestId('tile-overdue').click();
    await expect(page).toHaveURL(/\/assets\/?\?overdue=1$/);
    await expect(page.getByRole('checkbox', { name: 'Overdue only' })).toBeChecked();
    await expect(page.getByTestId('assets-range')).toContainText(`of ${overdue}`);

    await openDashboard(page);
    const repair = await tileCount(page, 'inRepair');
    await page.getByTestId('tile-inRepair').click();
    await expect(page.getByRole('combobox', { name: 'State' })).toContainText('Not deployable');
    await expect(page.getByTestId('assets-range')).toContainText(`of ${repair}`);
  });

  test('an overdue row opens the asset; tiles and rows are reachable by keyboard', async ({
    page,
  }) => {
    await openDashboard(page);
    await page.getByTestId('tile-ready').focus();
    await page.keyboard.press('Tab');
    await expect(page.getByTestId('tile-assigned')).toBeFocused();
    const row = page.getByTestId('panel-overdue').getByRole('listitem').first().getByRole('link');
    const tag = (await row.locator('span.font-tag').innerText()).trim();
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText(tag);
  });

  for (const [width, columns] of [
    // the "All assets" tile spans both columns below 1024px
    [375, 2],
    [768, 2],
    [1440, 5],
  ] as const) {
    test(`tiles lay out in ${columns} column(s) at ${width}px with no horizontal scroll`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await openDashboard(page);
      const lefts = await page
        .locator('[data-testid^="tile-"]')
        .evaluateAll(
          (els) => new Set(els.map((el) => Math.round(el.getBoundingClientRect().left))).size,
        );
      expect(lefts).toBe(columns);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(0);
    });
  }

  test('axe: dashboard with real data, loading finished (light and dark)', async ({ page }) => {
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await openDashboard(page);
      await expect(page.getByTestId('panel-repairs').getByRole('listitem').first()).toBeVisible();
      expect(await violations(page)).toEqual([]);
    }
  });
});

test.describe('sidebar', () => {
  test('the stock entry is called "Stock" and every label fits in the 232px sidebar', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const nav = page.getByRole('navigation', { name: 'Primary' });
    await expect(nav.getByRole('link', { name: 'Stock' })).toHaveAttribute('href', /^\/stock\/?$/);
    expect((await page.locator('aside').boundingBox())?.width).toBeCloseTo(232, 0);
    const clipped = await nav
      .locator('a > span.truncate')
      .evaluateAll((els) =>
        els.filter((el) => el.scrollWidth > el.clientWidth).map((el) => el.textContent),
      );
    expect(clipped).toEqual([]);
    // the page keeps its full name
    await nav.getByRole('link', { name: 'Stock' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Accessories and consumables' }),
    ).toBeVisible();
  });

  test('in the collapsed 56px rail every item shows its name in a tooltip', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    expect((await page.locator('aside').boundingBox())?.width).toBeCloseTo(56, 0);
    const nav = page.getByRole('navigation', { name: 'Primary' });
    const links = nav.getByRole('link');
    const count = await links.count();
    expect(count).toBeGreaterThanOrEqual(6);
    for (let i = 0; i < count; i += 1) {
      const link = links.nth(i);
      const name = await link.getAttribute('aria-label');
      await link.hover();
      await expect(page.getByRole('tooltip').filter({ hasText: name! }).first()).toBeVisible();
    }
  });
});
