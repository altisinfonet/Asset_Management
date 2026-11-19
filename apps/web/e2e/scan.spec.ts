import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, gotoApp, test } from './fixtures';
import { heldAsset, pick, readyAsset } from './m2-helpers';

/**
 * Keyboard-wedge scanner and manual tag entry (M2-LIFE-08). A wedge scanner "types" the code in a
 * burst of keys a few milliseconds apart and ends with Enter; here Playwright does the same with a
 * 5 ms delay (a person types at 100 ms or more).
 */
async function wedge(page: import('@playwright/test').Page, code: string) {
  // let the freshly loaded page attach its key listener (a real scan never comes this early)
  await page.waitForTimeout(250);
  await page.keyboard.type(code, { delay: 5 });
  await page.keyboard.press('Enter');
}

test.describe('wedge scanner on any page', () => {
  test('a scan with nothing focused opens the asset, with its primary action focused', async ({
    page,
  }) => {
    const asset = await readyAsset(page);
    await gotoApp(page, '/settings/organisation');
    await wedge(page, asset.asset_tag);
    await expect(page.getByTestId('asset-tag')).toHaveText(asset.asset_tag);
    // Enter now starts the check-out
    await expect(page.getByRole('button', { name: 'Check out', exact: true })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: `Check out ${asset.asset_tag}` })).toBeVisible();
  });

  test('works from the dashboard, the people list and the locations tree alike', async ({
    page,
  }) => {
    const asset = await heldAsset(page);
    for (const url of ['/', '/people', '/locations']) {
      await gotoApp(page, url);
      await wedge(page, asset.asset_tag);
      await expect(page.getByTestId('asset-tag')).toHaveText(asset.asset_tag);
      await expect(page.getByRole('button', { name: 'Check in', exact: true })).toBeFocused();
    }
  });

  test('a label code and a label URL resolve like a tag', async ({ page }) => {
    await gotoApp(page, '/');
    await wedge(page, 'LBL00124');
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
    await gotoApp(page, '/');
    await wedge(page, 'https://assets.example.org/s/LBL00007');
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00007');
  });

  test('a code that starts with a shortcut key does not trigger the shortcut', async ({ page }) => {
    await gotoApp(page, '/');
    // "c" starts a new asset, "g" then "a" goes to Assets: neither may fire for a scanned burst
    await wedge(page, 'cga-no-such-code');
    await expect(page.getByText('No asset matches "cga-no-such-code".').first()).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a code nobody has is reported and the page stays put', async ({ page }) => {
    await gotoApp(page, '/people');
    await wedge(page, 'ZZ-99999');
    await expect(page.getByText('No asset matches "ZZ-99999".').first()).toBeVisible();
    await expect(page).toHaveURL(/\/people\/?$/);
  });

  test('typing slowly in the page is not a scan, and fields keep their own Enter', async ({
    page,
  }) => {
    await gotoApp(page, '/assets');
    await page.keyboard.type('AT-00124', { delay: 150 });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/assets\/?$/);
    // the search field receives typing as ever
    await page.getByPlaceholder('Tag, serial or name').fill('AT-00124');
    await page.getByPlaceholder('Tag, serial or name').press('Enter');
    await expect(page).toHaveURL(/\/assets\/?$/);
  });
});

test.describe('manual entry in the top bar', () => {
  test('/ focuses the field; a tag, a serial number or a label URL opens the asset', async ({
    page,
  }) => {
    await gotoApp(page, '/assets');
    await page.keyboard.press('/');
    await expect(page.getByPlaceholder('Scan or type tag')).toBeFocused();
    await page.keyboard.type('AT-00124');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
    const serial = await page.evaluate(async () => {
      const body = (await (await fetch('/v1/assets?tag=AT-00007')).json()) as {
        data: Array<{ serial: string }>;
      };
      return body.data[0]!.serial;
    });
    await page.getByPlaceholder('Scan or type tag').fill(serial);
    await page.getByPlaceholder('Scan or type tag').press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00007');
  });
});

test.describe('scan panel and batch mode', () => {
  test('checks in many assets in a row, listing every result', async ({ page }) => {
    const asset = await heldAsset(page);
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Scan assets' }).click();
    const panel = page.getByRole('dialog', { name: 'Scan assets' });
    await panel.getByRole('combobox', { name: 'When I scan' }).click();
    await page.getByRole('option', { name: 'Check in', exact: true }).click();
    const field = panel.getByRole('textbox', { name: 'Scan or type an asset tag' });
    await expect(field).toBeFocused();
    await field.fill(asset.asset_tag);
    await field.press('Enter');
    const log = panel.getByTestId('scan-log');
    await expect(log).toContainText(`${asset.asset_tag} checked in.`);
    await expect(field).toBeFocused(); // ready for the next scan
    // the same asset again (a scanner's double read inside 0.8 s is ignored): it is not out any more
    await page.waitForTimeout(900);
    await field.fill(asset.asset_tag);
    await field.press('Enter');
    await expect(log).toContainText('This asset is not checked out.');
    await field.fill('ZZ-00000');
    await field.press('Enter');
    await expect(log).toContainText('No asset matches "ZZ-00000".');
  });

  test('checks out many assets to one person, and says why one cannot', async ({ page }) => {
    const ready = await readyAsset(page);
    const held = await heldAsset(page);
    await gotoApp(page, '/');
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox').fill('Scan assets');
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog', { name: 'Scan assets' });
    await panel.getByRole('combobox', { name: 'When I scan' }).click();
    await page.getByRole('option', { name: 'Check out to a person' }).click();
    const field = panel.getByRole('textbox', { name: 'Scan or type an asset tag' });
    // no person yet
    await field.fill(ready.asset_tag);
    await field.press('Enter');
    await expect(panel.getByTestId('scan-log')).toContainText('Choose who the assets go to first.');
    await pick(page, panel.getByRole('combobox', { name: /Check out to/ }), 'Maria', /Maria Reyes/);
    await field.fill(ready.asset_tag);
    await field.press('Enter');
    await expect(panel.getByTestId('scan-log')).toContainText(
      `${ready.asset_tag} checked out to Maria Reyes.`,
    );
    await field.fill(held.asset_tag);
    await field.press('Enter');
    await expect(panel.getByTestId('scan-log')).toContainText(
      /Already with .+\. Check it in first\./,
    );
    // leaving the panel ends batch mode
    await panel.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('dialog', { name: 'Scan assets' })).toBeHidden();
  });

  test('in "open" mode the panel opens each scanned asset', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Scan assets' }).click();
    const panel = page.getByRole('dialog', { name: 'Scan assets' });
    const field = panel.getByRole('textbox', { name: 'Scan or type an asset tag' });
    await field.fill('AT-00124');
    await field.press('Enter');
    await expect(page.getByTestId('asset-tag')).toHaveText('AT-00124');
    await expect(page.getByRole('dialog', { name: 'Scan assets' })).toBeHidden();
  });

  test('is usable at 375px: the top bar button opens it', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Scan assets' }).click();
    const panel = page.getByRole('dialog', { name: 'Scan assets' });
    await expect(panel).toBeVisible();
    expect((await panel.boundingBox())!.width).toBeLessThanOrEqual(375);
  });
});

test.describe('scanning (read-only role)', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('a viewer can scan to open assets but is not offered batch actions', async ({ page }) => {
    await gotoApp(page, '/');
    await page.getByRole('button', { name: 'Scan assets' }).click();
    const panel = page.getByRole('dialog', { name: 'Scan assets' });
    await panel.getByRole('combobox', { name: 'When I scan' }).click();
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.keyboard.press('Escape');
  });
});
