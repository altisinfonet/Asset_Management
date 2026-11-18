import { assetId, expect, test } from './fixtures';

/**
 * M1-WEB-10: deep links, hard refresh, back/forward and QR-style deep links against the static
 * export (or `next dev`). These cases are kept forever; see docs/adr/0002-web-routing-static-export.md.
 */
const ID = assetId(124);

test('query-string detail route renders on a direct load and survives a hard refresh', async ({
  page,
}) => {
  await page.goto(`/assets/view?id=${ID}`);
  await expect(page.getByTestId('asset-id')).toHaveText(ID);

  await page.reload();
  await expect(page.getByTestId('asset-id')).toHaveText(ID);
  expect(new URL(page.url()).searchParams.get('id')).toBe(ID);
});

test('the same route works with and without a trailing slash', async ({ page }) => {
  await page.goto(`/assets/view/?id=${ID}`);
  await expect(page.getByTestId('asset-id')).toHaveText(ID);
  await page.goto(`/assets/view?id=${ID}`);
  await expect(page.getByTestId('asset-id')).toHaveText(ID);
});

test('missing id shows the empty state, not a crash', async ({ page }) => {
  await page.goto('/assets/view');
  await expect(page.getByTestId('no-asset')).toBeVisible();
});

test('client navigation, back and forward keep the right page', async ({ page }) => {
  await page.goto('/assets');
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();

  await page.getByRole('link', { name: 'PRJ-00010' }).click();
  await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-00010');
  expect(new URL(page.url()).pathname).toMatch(/^\/assets\/view\/?$/);

  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Assets', exact: true })).toBeVisible();

  await page.goForward();
  await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-00010');

  // refresh on the history entry we came forward to
  await page.reload();
  await expect(page.getByTestId('asset-tag')).toHaveText('PRJ-00010');
});

test('settings sections are prerendered via generateStaticParams and survive refresh', async ({
  page,
}) => {
  await page.goto('/settings/categories');
  await expect(page.getByTestId('settings-section')).toHaveText('categories');
  await page.reload();
  await expect(page.getByTestId('settings-section')).toHaveText('categories');
});

test('QR-style deep link /s/<code> resolves the label code to the asset', async ({ page }) => {
  await page.goto('/s/LBL00124');
  await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
  expect(new URL(page.url()).pathname).toMatch(/^\/assets\/view\/?$/);
  expect(new URL(page.url()).searchParams.get('id')).toBe(ID);
});

test('an unknown QR code says the asset was not found', async ({ page }) => {
  await page.goto('/s/AB12CD34');
  await expect(page.getByTestId('asset-not-found')).toBeVisible();
});

test('unknown paths show the not-found screen (and refresh keeps it)', async ({ page }) => {
  await page.goto('/definitely/not/a/page');
  await expect(page.getByTestId('not-found')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('not-found')).toBeVisible();
});

test('unknown settings section is not found (dynamicParams = false)', async ({ page }) => {
  await page.goto('/settings/nope');
  await expect(page.getByTestId('not-found')).toBeVisible();
});
