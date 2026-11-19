import { expect, test } from './fixtures';
import { choose } from './m2-helpers';

/**
 * Notifications (M2-NOT-02): the bell with the unread count, the panel (mark read, mark all, follow a
 * notification), the preferences page, and a notification that arrives from something the user did.
 */
test.describe('notification bell and panel', () => {
  test('shows the unread count, lists the notifications and marks them read', async ({ page }) => {
    await page.goto('/');
    const bell = page.getByRole('button', { name: 'Notifications, 3 unread' });
    await expect(bell).toBeVisible();
    await expect(page.getByTestId('notification-count')).toHaveText('3');
    await bell.click();

    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await expect(panel.getByTestId('notification-list').getByRole('listitem')).toHaveCount(5);
    await expect(panel.getByRole('listitem').first()).toContainText(
      'Unread: Toner HP 26A is low on stock',
    );
    await panel
      .getByRole('button', { name: 'Mark as read: Import finished: 120 assets created' })
      .click();
    await expect(page.getByTestId('notification-count')).toHaveText('2');

    await panel.getByRole('button', { name: 'Unread', exact: true }).click();
    await expect(panel.getByRole('listitem')).toHaveCount(2);
    await panel.getByRole('button', { name: 'Mark all as read' }).click();
    await expect(panel.getByText('Nothing unread.')).toBeVisible();
    await expect(page.getByTestId('notification-count')).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Mark all as read' })).toBeDisabled();
  });

  test('follows a notification to the record it is about', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Notifications, 3 unread' }).click();
    await page
      .getByRole('dialog', { name: 'Notifications' })
      .getByRole('button', { name: 'View: Toner HP 26A is low on stock' })
      .click();
    await expect(page).toHaveURL(/\/stock\/view\/?\?kind=consumable&id=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Toner HP 26A' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Notifications, 2 unread' })).toBeVisible();
  });

  test('a stock movement that crosses the minimum raises one alert', async ({ page }) => {
    await page.goto('/stock?kind=consumable');
    await page.getByRole('link', { name: 'Printer paper A4' }).click();
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Use Printer paper A4' });
    await dialog.getByRole('spinbutton', { name: /^Units used/ }).fill('15');
    await dialog.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(page.getByTestId('figure-on-hand')).toHaveText('9 ream');
    await expect(page.getByRole('button', { name: 'Notifications, 4 unread' })).toBeVisible();

    // further use below the minimum is the same crossing: no second alert
    await page.getByRole('button', { name: 'Use', exact: true }).click();
    await dialog.getByRole('spinbutton', { name: /^Units used/ }).fill('1');
    await dialog.getByRole('button', { name: 'Use', exact: true }).click();
    await expect(page.getByTestId('figure-on-hand')).toHaveText('8 ream');
    await expect(page.getByRole('button', { name: 'Notifications, 4 unread' })).toBeVisible();
  });
});

test.describe('notification settings', () => {
  test('changes how the user hears about each event and keeps it after a reload', async ({
    page,
  }) => {
    await page.goto('/account/notifications');
    await expect(
      page.getByRole('heading', { level: 1, name: 'Notification settings' }),
    ).toBeVisible();
    const stock = page.getByRole('combobox', { name: 'Delivery for Stock is low' });
    await expect(stock).toContainText('Right away');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await choose(page, stock, 'Daily summary', true);
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Notification settings saved.').first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'Delivery for Stock is low' })).toContainText(
      'Daily summary',
    );
  });

  test('is reachable from the panel and from the user menu', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /^Notifications/ }).click();
    await page.getByRole('link', { name: 'Notification settings' }).click();
    await expect(page).toHaveURL(/\/account\/notifications\/?$/);
    await page.getByRole('button', { name: 'User menu' }).click();
    await expect(page.getByRole('menuitem', { name: 'Notification settings' })).toBeVisible();
  });
});
