import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, settled, test } from './fixtures';
import { choose, heldAsset, pick } from './m2-helpers';

/** People (M2-USR-02): list with or without login, create / edit, a person's page with what they hold. */
test.describe('people list', () => {
  test('lists people with the login state and filters by it', async ({ page }) => {
    await page.goto('/people');
    await expect(page.getByTestId('people-range')).toContainText('of 34');
    await expect(page.getByRole('row', { name: /Alice Owner/ })).toContainText('Can sign in');
    await expect(page.getByRole('row', { name: /Jamie Okafor/ })).toContainText('No login');

    await choose(page, page.getByRole('combobox', { name: 'Login' }), 'Can sign in', true);
    await expect(page.getByTestId('people-range')).toHaveText('Showing 1-4 of 4');
    await choose(page, page.getByRole('combobox', { name: 'Login' }), 'No login', true);
    await expect(page.getByRole('row', { name: /Alice Owner/ })).toHaveCount(0);
  });

  test('searches by name, e-mail or number, and shows inactive people on request', async ({
    page,
  }) => {
    await page.goto('/people');
    await page.getByRole('searchbox', { name: 'Search' }).fill('S-2001');
    await expect(page.getByTestId('people-range')).toHaveText('Showing 1-1 of 1');
    await expect(page.getByRole('row', { name: /Jamie Okafor/ })).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('leaver');
    await expect(page.getByRole('heading', { name: 'Nobody matches' })).toBeVisible();
    await choose(page, page.getByRole('combobox', { name: 'Status' }), 'Inactive', true);
    await expect(page.getByRole('row', { name: /Olivia Leaver/ })).toContainText('Inactive');
  });

  test('adds a person, with the unique e-mail and number checked by the server', async ({
    page,
  }) => {
    await page.goto('/people');
    await page.getByRole('button', { name: 'Add person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(dialog.getByText('This field is required.').first()).toBeVisible();

    await dialog.getByLabel(/^Name/).fill('Dana Reyes');
    await dialog.getByLabel(/^E-mail/).fill('alice@example.org');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(dialog.getByText('This e-mail address is already in use')).toBeVisible();

    await dialog.getByLabel(/^E-mail/).fill('dana.reyes@school.example');
    await dialog.getByLabel(/^Employee or student number/).fill('S-2001');
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(
      dialog.getByText('This employee or student number is already in use'),
    ).toBeVisible();

    await dialog.getByLabel(/^Employee or student number/).fill('E-5000');
    await pick(
      page,
      dialog.getByRole('combobox', { name: 'Home location' }),
      'Room 101',
      /Room 101/,
    );
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText('Dana Reyes added.').first()).toBeVisible();
    await page.getByRole('searchbox', { name: 'Search' }).fill('Dana');
    await expect(page.getByRole('row', { name: /Dana Reyes/ })).toContainText('Room 101');
  });

  test('keyboard: arrows move between rows and Enter opens the person', async ({ page }) => {
    await page.goto('/people');
    await page.getByRole('searchbox', { name: 'Search' }).fill('Okafor');
    await expect(page.getByTestId('people-range')).not.toHaveText('');
    await page.getByRole('row', { name: /Jamie Okafor/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('person-name')).toHaveText('Jamie Okafor');
  });
});

test.describe('a person', () => {
  test('shows details, the assets they hold, and checks one back in from there', async ({
    page,
  }) => {
    const asset = await heldAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByTestId('asset-holder').getByRole('link').click();
    await expect(page.getByTestId('person-name')).toBeVisible();
    const name = (await page.getByTestId('person-name').textContent()) ?? '';

    await page.getByRole('tab', { name: /Assets held/ }).click();
    const row = page.getByRole('row', { name: new RegExp(asset.asset_tag) });
    await expect(row).toBeVisible();
    await page.getByRole('button', { name: `Check in ${asset.asset_tag}` }).click();
    const dialog = page.getByRole('dialog', { name: `Check in ${asset.asset_tag}` });
    await dialog.getByRole('button', { name: 'Check in', exact: true }).click();
    await expect(page.getByText(`${asset.asset_tag} checked in.`).first()).toBeVisible();
    await expect(page.getByRole('row', { name: new RegExp(asset.asset_tag) })).toHaveCount(0);

    await page.getByRole('tab', { name: 'History' }).click();
    const history = page.getByRole('list', { name: 'History' });
    await expect(history.getByRole('link', { name: asset.asset_tag })).toBeVisible();
    await expect(history.getByText(/returned/).first()).toBeVisible();
    expect(name).not.toBe('');
  });

  test('shows the login state and offers the user list to those who can open it', async ({
    page,
  }) => {
    await page.goto('/people');
    await page.getByRole('link', { name: 'Alice Owner' }).click();
    await expect(page.getByText('Has a login account.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage users' })).toBeVisible();
  });

  test('edits and archives; a person who still holds assets cannot be archived', async ({
    page,
  }) => {
    const asset = await heldAsset(page);
    await page.goto(`/assets/view?id=${asset.id}`);
    await page.getByTestId('asset-holder').getByRole('link').click();
    await expect(page.getByTestId('person-name')).toBeVisible();

    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: /^Edit / });
    await edit.getByLabel(/^Job title/).fill('Head of year');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText(/ saved\.$/).first()).toBeVisible();
    await expect(page.getByText('Head of year')).toBeVisible();

    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: /^Archive / });
    await expect(confirm.getByRole('status')).toContainText('still hold');
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(confirm.getByRole('alert')).toContainText(/still checked out|open_assignments/);
  });

  test('an unknown person shows the not-found screen', async ({ page }) => {
    await page.goto('/people/view?id=0190a6b2-0011-7000-8000-000000009999');
    await expect(page.getByTestId('person-not-found')).toBeVisible();
    await settled(page);
  });
});

test.describe('people (read-only role)', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('can read people and what they hold but has no write actions', async ({ page }) => {
    await page.goto('/people');
    await expect(page.getByRole('button', { name: 'Add person' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Alice Owner' }).click();
    await expect(page.getByTestId('person-name')).toBeVisible();
    await expect(page.getByRole('button', { name: /Edit|Archive/ })).toHaveCount(0);
  });
});
