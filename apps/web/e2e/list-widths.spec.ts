import type { Page } from '@playwright/test';
import { expect, settled, test } from './fixtures';

/**
 * The big lists at a 1280 px window (a common laptop): the page itself never scrolls sideways, and
 * every column of the table is inside its box, so nothing (People's Login column) is cut off: columns
 * of lower value give way below 1440 px and long location paths end in an ellipsis. The asset list
 * shows the columns its user chose, so it may still scroll, inside its own box, with the tag pinned.
 */
const LISTS = [
  { name: 'People', path: '/people', fits: true },
  { name: 'Assets', path: '/assets', fits: false },
  { name: 'Stock', path: '/stock', fits: true },
  { name: 'Repairs', path: '/repairs', fits: true },
  { name: 'Loaners', path: '/loaners', fits: true },
] as const;

async function widths(page: Page) {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const regions = [...document.querySelectorAll('table')].map((table) => {
      const box = table.parentElement!;
      return {
        label: table.getAttribute('aria-label') ?? box.getAttribute('aria-label') ?? '',
        table: Math.ceil(table.getBoundingClientRect().width),
        box: Math.floor(box.clientWidth),
      };
    });
    return { page: doc.scrollWidth, window: doc.clientWidth, regions };
  });
}

test.describe('lists at 1280 px', () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  for (const list of LISTS) {
    test(`${list.name}: no sideways page scroll, every column inside the table`, async ({
      page,
    }) => {
      await page.goto(list.path);
      await expect(page.locator('main#main')).toBeVisible();
      await expect(page.locator('table').first()).toBeVisible();
      await settled(page);
      const measured = await widths(page);
      expect(measured.page, 'the page scrolls sideways').toBeLessThanOrEqual(measured.window);
      for (const region of measured.regions) {
        if (list.fits) {
          expect(region.table, `table "${region.label}" is wider than its box`).toBeLessThanOrEqual(
            region.box + 1,
          );
        }
      }
      if (!list.fits) {
        // what does not fit scrolls inside the table, the first column stays in place
        const tag = page.getByRole('columnheader', { name: 'Tag' });
        expect(await tag.evaluate((th) => getComputedStyle(th).position)).toBe('sticky');
        await page
          .locator('table')
          .first()
          .evaluate((t) => (t.parentElement!.scrollLeft = 400));
        await expect(tag).toBeInViewport({ ratio: 1 });
      }
    });
  }

  test('People shows the Login column whole', async ({ page }) => {
    await page.goto('/people');
    const table = page.locator('table').first();
    await expect(table.getByRole('row').nth(1)).toBeVisible();
    await settled(page);
    const header = table.getByRole('columnheader', { name: 'Login' });
    await expect(header).toBeInViewport({ ratio: 1 });
    // the kind gave way at this width
    await expect(table.getByRole('columnheader', { name: 'Kind' })).toBeHidden();
  });
});

test.describe('lists at 1440 px', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('People shows the kind again when there is room', async ({ page }) => {
    await page.goto('/people');
    const table = page.locator('table').first();
    await expect(table.getByRole('row').nth(1)).toBeVisible();
    await expect(table.getByRole('columnheader', { name: 'Kind' })).toBeVisible();
  });
});
