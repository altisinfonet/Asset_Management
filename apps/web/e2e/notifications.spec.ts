import { expect, test } from './fixtures';
import { assetId } from './fixtures';
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
      'Unread: Low stock: Toner HP 26A',
    );
    await panel.getByRole('button', { name: 'Mark as read: Import finished' }).click();
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
      .getByRole('button', { name: 'View: Low stock: Toner HP 26A' })
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

test.describe('notifications from background work', () => {
  test('labels that finish while the dialog is closed arrive as a notification that opens the batch', async ({
    page,
  }) => {
    // the mock worker needs a moment (not a minute), so the batch is queued when the dialog closes
    await page.addInitScript(() => window.localStorage.setItem('at-mock-label-delay', '400'));
    await page.goto(`/assets/view?id=${assetId(124)}`);
    await page.getByRole('button', { name: 'Print labels' }).click();
    const dialog = page.getByRole('dialog', { name: /^Print label for / });
    await dialog.getByRole('button', { name: 'Generate PDF' }).click();
    await expect(dialog.getByTestId('labels-queued')).toBeVisible();
    await dialog.getByTestId('labels-queued').getByRole('button', { name: 'Close' }).click();
    await expect(dialog).toBeHidden();

    // the worker finishes in the background; the bell picks it up when it reads again
    await page.waitForTimeout(600);
    await page.reload();
    await page.getByRole('button', { name: /^Notifications, 4 unread/ }).click({ timeout: 15_000 });
    const panel = page.getByRole('dialog', { name: 'Notifications' });
    await panel.getByRole('button', { name: 'View: Your labels are ready' }).first().click();
    await expect(page).toHaveURL(/\/assets\/?$/);
    const batch = page.getByRole('dialog', { name: 'Print labels' });
    await expect(batch.getByTestId('labels-ready')).toBeVisible();
    await expect(batch.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  });

  test('an export that finishes arrives as a notification that opens the download', async ({
    page,
  }) => {
    await page.goto('/people');
    await page.getByRole('button', { name: 'Export CSV' }).click();
    const dialog = page.getByRole('dialog', { name: 'Export to CSV' });
    await expect(dialog.getByRole('link', { name: 'Download CSV' })).toBeVisible({
      timeout: 15_000,
    });
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: /^Notifications, 4 unread/ }).click();
    await page
      .getByRole('dialog', { name: 'Notifications' })
      .getByRole('button', { name: 'View: Your export is ready' })
      .first()
      .click();
    await expect(page).toHaveURL(/\/assets\/?$/);
    await expect(
      page.getByRole('dialog', { name: 'Export to CSV' }).getByRole('link', {
        name: 'Download CSV',
      }),
    ).toBeVisible();
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
    const stock = page.getByRole('combobox', { name: 'E-mail for Low stock' });
    await expect(stock).toContainText('Daily summary');
    await expect(page.getByRole('button', { name: 'Save changes' })).toBeDisabled();

    await choose(page, stock, 'Off', true);
    await page.getByRole('checkbox', { name: 'Show Loan overdue in the bell' }).click();
    await expect(page.getByText('You have unsaved changes.')).toBeVisible();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Notification settings saved.').first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole('combobox', { name: 'E-mail for Low stock' })).toContainText('Off');
    await expect(
      page.getByRole('checkbox', { name: 'Show Loan overdue in the bell' }),
    ).not.toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'Show Low stock in the bell' })).toBeChecked();
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
