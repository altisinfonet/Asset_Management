import { expect, test } from './fixtures';
import { wedge } from './m2-helpers';
import { api, loadApp, poolWithDevices, studentPool } from './w3-helpers';

/**
 * The loaner desk and dashboard (M2-LOAN-02, M2-LOAN-04): ten devices lent and taken back, the
 * dashboard numbers following, the keyboard flow and the scanner flow, the main dashboard's link.
 */
test.describe('loaner desk', () => {
  test('checks 10 devices out to one borrower with the keyboard and back in by scanner', async ({
    page,
  }) => {
    await loadApp(page);
    const { pool, devices } = await poolWithDevices(page, 'Exam week loaners', 10);
    expect(devices).toHaveLength(10);

    await page.goto('/loaners/desk');
    const device = page.getByLabel('Device', { exact: true });
    await expect(device).toBeFocused();
    const feedback = page.getByTestId('desk-feedback');

    for (const [index, asset] of devices.entries()) {
      await device.fill(asset.asset_tag);
      await device.press('Enter');
      if (index === 0) {
        // the first device asks for the borrower; the pool's five days are filled in
        const borrower = page.getByLabel('Borrower', { exact: true });
        await expect(borrower).toBeFocused();
        await expect(page.getByLabel('Due date')).not.toHaveValue('');
        await borrower.fill('Alice Owner');
        await borrower.press('Enter');
      }
      // with a device and a borrower the Lend button has focus: one Enter lends
      await expect(page.getByRole('button', { name: 'Lend device' })).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(feedback).toContainText(`${asset.asset_tag} lent to Alice Owner`);
      await expect(feedback).toHaveAttribute('role', 'status');
      await expect(device).toBeFocused();
    }
    await expect(page.getByTestId('desk-log').getByRole('listitem')).toHaveCount(10);

    // the dashboard follows
    await page.goto('/loaners');
    const card = page.getByRole('article', { name: /Exam week loaners/ });
    await expect(card).toContainText('10 devices');
    await expect(page.getByTestId(`pool-${pool.id}-onLoan`)).toContainText('10');
    await expect(page.getByTestId(`pool-${pool.id}-available`)).toContainText('0');

    // back in by scanner: nothing is focused, the code arrives as one burst of keys and Enter
    await page.goto('/loaners/desk?mode=return');
    await expect(page.getByLabel('Returned device')).toBeFocused();
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    for (const [index, asset] of devices.entries()) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await wedge(page, asset.asset_tag);
      await expect(feedback).toContainText(`${asset.asset_tag} returned by Alice Owner`);
      await expect(page.getByTestId('desk-return-summary')).toContainText(
        `${index + 1} ${index === 0 ? 'device' : 'devices'} returned`,
      );
      // let the scanner's "same code twice" window pass, as a real second device would
    }
    await expect(page.getByTestId('desk-log').getByRole('listitem')).toHaveCount(10);

    await page.goto('/loaners');
    await expect(page.getByTestId(`pool-${pool.id}-onLoan`)).toContainText('0');
    await expect(page.getByTestId(`pool-${pool.id}-available`)).toContainText('10');
  });

  test('says why a device cannot be lent and offers the return', async ({ page }) => {
    await loadApp(page);
    const pool = await studentPool(page);
    const members = await api<{
      data: Array<{
        available: boolean;
        asset: { asset_tag: string; current_assignment: { target_name: string } | null };
      }>;
    }>(page, 'GET', `/v1/loaner-pools/${pool.id}/members`);
    const out = members.json.data.find((m) => !m.available)!;
    const spare = await api<{ data: Array<{ asset_tag: string; loaner_pool_id: string | null }> }>(
      page,
      'GET',
      '/v1/assets?state_type=deployable&assigned=false&limit=200',
    );
    const loose = spare.json.data.find((a) => !a.loaner_pool_id)!;

    await page.goto('/loaners/desk');
    const device = page.getByLabel('Device', { exact: true });
    await device.fill(loose.asset_tag);
    await device.press('Enter');
    await expect(page.getByTestId('desk-feedback')).toContainText(
      `${loose.asset_tag} is not in a loaner pool. Add it to a pool first.`,
    );

    await device.fill(out.asset.asset_tag);
    await device.press('Enter');
    const alert = page.getByTestId('desk-feedback');
    await expect(alert).toContainText(`${out.asset.asset_tag} is already on loan to`);
    await alert.getByRole('button', { name: 'Return it instead' }).click();
    await expect(page.getByTestId('desk-feedback')).toContainText(
      `${out.asset.asset_tag} returned`,
    );
  });

  test('the main dashboard links its overdue card to the loaner dashboard', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('panel-overdue-link').click();
    await expect(page).toHaveURL(/\/loaners\/?$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Loaners' })).toBeVisible();
    // the card of a pool opens its overdue devices
    const pool = await studentPool(page);
    await page.getByTestId(`pool-${pool.id}-overdue`).click();
    await expect(page).toHaveURL(new RegExp(`/loaners/pool/?\\?id=${pool.id}&show=overdue`));
    await expect(page.getByTestId('pool-range')).toHaveText('Showing 1 of 8');
  });

  test('the sidebar shows Loaners in full at 232px and leads there', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/');
    const link = page
      .getByRole('navigation', { name: 'Primary' })
      .getByRole('link', { name: 'Loaners' });
    await expect(link).toBeVisible();
    const fits = await link
      .locator('span.truncate')
      .evaluate((el) => el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    await link.click();
    await expect(page).toHaveURL(/\/loaners\/?$/);
    await expect(link).toHaveAttribute('aria-current', 'page');
  });

  test('a manager creates a pool and sets the loan defaults', async ({ page }) => {
    await page.goto('/loaners/pools');
    await page.getByRole('button', { name: 'New pool' }).click();
    const dialog = page.getByRole('dialog', { name: 'New loaner pool' });
    await dialog.getByLabel(/^Name/).fill('Staff trips');
    await dialog.getByLabel(/Default loan length/).fill('3');
    await dialog.getByRole('button', { name: 'Create pool' }).click();
    await expect(page.getByRole('row', { name: /Staff trips/ })).toContainText('3 days');
    await page.getByLabel('Default loan length (days)').fill('10');
    await page.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByText('Loan defaults saved.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Default loan length (days)')).toHaveValue('10');
  });
});
