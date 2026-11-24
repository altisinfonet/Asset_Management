import { expect, test } from './fixtures';
import { wedge } from './m2-helpers';
import { api, loadApp, looseDevice, poolWithDevices, staffPool, studentPool } from './w3-helpers';

/**
 * The loaner desk and dashboard (M2-LOAN-02, M2-LOAN-04): ten devices lent and taken back, the
 * dashboard numbers following, the keyboard flow and the scanner flow, a device the pool refuses, the
 * main dashboard's link, extending a loan.
 */
test.describe('loaner desk', () => {
  test('checks 10 devices out to one borrower with the keyboard and back in by scanner', async ({
    page,
  }) => {
    await loadApp(page);
    const { pool, devices } = await poolWithDevices(page, 'Exam week loaners', 10);
    expect(devices).toHaveLength(10);

    await page.goto('/loaners/desk');
    // the pool picked is the first by name: the new one; its five days are filled in
    await expect(page.getByRole('combobox', { name: 'Lend from' })).toContainText(
      'Exam week loaners',
    );
    const device = page.getByLabel('Device', { exact: true });
    await expect(device).toBeFocused();
    const feedback = page.getByTestId('desk-feedback');

    for (const asset of devices) {
      await device.fill(asset.asset_tag);
      await device.press('Enter');
    }
    await expect(
      page.getByRole('list', { name: 'Devices to lend' }).getByRole('listitem'),
    ).toHaveCount(10);
    const borrower = page.getByLabel('Borrower', { exact: true });
    await borrower.fill('Alice Owner');
    await borrower.press('Enter');
    // with devices and a borrower the Lend button has focus: one Enter lends them all
    await expect(page.getByRole('button', { name: 'Lend 10 devices' })).toBeFocused();
    await expect(page.getByLabel('Due date')).not.toHaveValue('');
    await page.keyboard.press('Enter');
    await expect(feedback).toContainText('10 devices lent to Alice Owner');
    await expect(feedback).toHaveAttribute('role', 'status');
    await expect(page.getByRole('list', { name: 'Devices to lend' })).toHaveCount(0);
    await expect(device).toBeFocused();

    // the dashboard follows
    await page.goto('/loaners');
    const card = page.getByRole('article', { name: /Exam week loaners/ });
    await expect(card).toContainText('10 devices');
    await expect(page.getByTestId(`pool-${pool.id}-onLoan`)).toContainText('10');
    await expect(page.getByTestId(`pool-${pool.id}-available`)).toContainText('0');

    // back in by scanner: nothing is focused, the code arrives as one burst of keys and Enter
    await page.goto('/loaners/desk?mode=return');
    await expect(page.getByLabel('Returned device')).toBeFocused();
    for (const [index, asset] of devices.entries()) {
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      await wedge(page, asset.asset_tag);
      await expect(feedback).toContainText(`${asset.asset_tag} returned`);
      await expect(page.getByTestId('desk-return-summary')).toContainText(
        `${index + 1} ${index === 0 ? 'device' : 'devices'} returned`,
      );
    }
    await expect(page.getByTestId('desk-log').getByRole('listitem')).toHaveCount(10);

    await page.goto('/loaners');
    await expect(page.getByTestId(`pool-${pool.id}-onLoan`)).toContainText('0');
    await expect(page.getByTestId(`pool-${pool.id}-available`)).toContainText('10');
  });

  test('keeps a device the pool refuses in the list, with the reason, and lends the others', async ({
    page,
  }) => {
    await loadApp(page);
    const staff = await staffPool(page);
    const members = await api<{
      data: Array<{ available: boolean; asset: { asset_tag: string } }>;
    }>(page, 'GET', `/v1/loaner-pools/${staff.id}/members?available=true`);
    const mine = members.json.data[0]!.asset.asset_tag;
    const loose = await looseDevice(page);

    await page.goto('/loaners/desk');
    const device = page.getByLabel('Device', { exact: true });
    await device.fill(mine);
    await device.press('Enter');
    await device.fill(loose.asset_tag);
    await device.press('Enter');
    await page.getByLabel('Borrower', { exact: true }).fill('Alice Owner');
    await page.getByLabel('Borrower', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Lend 2 devices' }).click();
    const feedback = page.getByTestId('desk-feedback');
    await expect(feedback).toContainText('1 of 2 devices lent to Alice Owner.');
    await expect(feedback).toHaveAttribute('role', 'alert');
    const queue = page.getByRole('list', { name: 'Devices to lend' });
    await expect(queue.getByRole('listitem')).toHaveCount(1);
    await expect(queue).toContainText(`${loose.asset_tag} is not in this loaner pool.`);
  });

  test('says a device is already out and offers the return', async ({ page }) => {
    await loadApp(page);
    const staff = await staffPool(page);
    const members = await api<{
      data: Array<{ available: boolean; asset: { asset_tag: string } }>;
    }>(page, 'GET', `/v1/loaner-pools/${staff.id}/members?available=false`);
    const out = members.json.data[0]!.asset.asset_tag;

    await page.goto('/loaners/desk');
    const device = page.getByLabel('Device', { exact: true });
    await device.fill(out);
    await device.press('Enter');
    await page.getByLabel('Borrower', { exact: true }).fill('Alice Owner');
    await page.getByLabel('Borrower', { exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Lend 1 device' }).click();
    const feedback = page.getByTestId('desk-feedback');
    await expect(page.getByRole('list', { name: 'Devices to lend' })).toContainText(
      `${out} is already out.`,
    );
    await feedback.getByRole('button', { name: 'Return it instead' }).click();
    await expect(feedback).toContainText(`${out} returned`);
  });

  test('extends an overdue loan from the dashboard', async ({ page }) => {
    await page.goto('/loaners');
    const overdue = page.getByRole('table', { name: 'Overdue loans' });
    await expect(overdue.getByText('5 days late')).toBeVisible();
    await overdue
      .getByRole('button', { name: /^Extend the loan of / })
      .first()
      .click();
    const dialog = page.getByRole('dialog', { name: /^Extend the loan of / });
    await dialog
      .getByLabel(/^New due date/)
      .fill(new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10));
    await dialog.getByLabel('Reason (optional)').fill('Exam week');
    await dialog.getByRole('button', { name: 'Extend loan' }).click();
    await expect(page.getByText(/^The loan of .* now ends /)).toBeVisible();
    await expect(overdue.getByText('5 days late')).toHaveCount(0);
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
    await dialog.getByRole('checkbox', { name: 'Students' }).check();
    await dialog.getByRole('button', { name: 'Create pool' }).click();
    await expect(page.getByRole('row', { name: /Staff trips/ })).toContainText('3 days');
    await page.getByLabel('Return date offered at check-out (days from today)').fill('10');
    await page.getByRole('button', { name: 'Save defaults' }).click();
    await expect(page.getByText('Loan defaults saved.', { exact: true })).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Return date offered at check-out (days from today)')).toHaveValue(
      '10',
    );
  });
});
