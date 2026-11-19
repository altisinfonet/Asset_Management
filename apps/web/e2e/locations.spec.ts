import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, test } from './fixtures';
import { pick } from './m2-helpers';

/** Locations admin (M2-LOC-04): the tree, its keyboard model, create / edit / move / archive, counts. */
const tree = (page: import('@playwright/test').Page) =>
  page.getByRole('tree', { name: 'Locations' });

test.describe('locations tree', () => {
  test('shows the hierarchy with asset counts, expands and collapses with the keyboard', async ({
    page,
  }) => {
    await page.goto('/locations');
    const site = tree(page).getByRole('treeitem', { name: /^Riverside Elementary/ });
    await expect(site).toBeVisible();
    await expect(site).toHaveAttribute('aria-expanded', 'false');
    await expect(site).toContainText(/\d+ assets/);

    await site.focus();
    await page.keyboard.press('ArrowRight');
    await expect(site).toHaveAttribute('aria-expanded', 'true');
    const building = tree(page).getByRole('treeitem', { name: /^Main building/ });
    await expect(building).toHaveAttribute('aria-level', '2');
    await page.keyboard.press('ArrowRight'); // into the first child
    await expect(building).toBeFocused();
    await page.keyboard.press('ArrowRight');
    await expect(tree(page).getByRole('treeitem', { name: /^Room 101/ })).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(tree(page).getByRole('treeitem', { name: /^Room 101/ })).toHaveCount(0);
    await page.keyboard.press('ArrowLeft'); // to the parent
    await expect(site).toBeFocused();
    await page.keyboard.press('End');
    await page.keyboard.press('Home');
    await expect(site).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(page.getByTestId('location-name')).toHaveText('Riverside Elementary');
    await expect(site).toHaveAttribute('aria-selected', 'true');
  });

  test('searching opens the way to a match', async ({ page }) => {
    await page.goto('/locations');
    await page.getByRole('searchbox', { name: 'Search locations' }).fill('gym');
    await expect(page.getByText('1 location matches')).toBeVisible();
    await expect(tree(page).getByRole('treeitem', { name: /^Gym/ })).toBeVisible();
    await expect(tree(page).getByRole('treeitem', { name: /^Room 101/ })).toHaveCount(0);
  });

  test('adds a location inside the selected one and validates the name', async ({ page }) => {
    await page.goto('/locations');
    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await page.getByRole('button', { name: 'Add inside' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a location' });
    await expect(dialog.getByRole('combobox', { name: /Inside/ })).toHaveValue(
      'Riverside Elementary',
    );

    await dialog.getByRole('button', { name: 'Add location' }).click();
    await expect(dialog.getByText('This field is required.')).toBeVisible();
    await dialog.getByLabel(/^Name/).fill('Science lab');
    await dialog.getByLabel(/^Code/).fill('S-1');
    await dialog.getByRole('button', { name: 'Add location' }).click();

    await expect(page.getByText('Location "Science lab" added.').first()).toBeVisible();
    await expect(page.getByTestId('location-name')).toHaveText('Science lab');
    await expect(page.getByText('Riverside Elementary > Science lab')).toBeVisible();

    // the same name in the same place is refused on the field
    await page.getByRole('button', { name: 'Add inside' }).click();
    const again = page.getByRole('dialog', { name: 'Add a location' });
    await pick(
      page,
      again.getByRole('combobox', { name: /Inside/ }),
      'Riverside',
      /^Riverside Elementary/,
    );
    await again.getByLabel(/^Name/).fill('science lab');
    await again.getByRole('button', { name: 'Add location' }).click();
    await expect(again.getByText('This value is already in use.')).toBeVisible();
  });

  test('edits a site with its address, then moves a room with the picker', async ({ page }) => {
    await page.goto('/locations');
    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Riverside Elementary' });
    await edit.getByLabel(/^City/).fill('Springfield');
    await edit.getByLabel(/^Country/).fill('US');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByText('Location "Riverside Elementary" saved.').first()).toBeVisible();
    await expect(page.getByText('Springfield')).toBeVisible();

    await page.getByRole('searchbox', { name: 'Search locations' }).fill('Room 101');
    await tree(page)
      .getByRole('treeitem', { name: /^Room 101/ })
      .click();
    await page.getByRole('button', { name: 'Move' }).click();
    const move = page.getByRole('dialog', { name: 'Move Room 101' });
    const parent = move.getByRole('combobox', { name: 'New parent' });
    await parent.fill('Gym');
    await page.getByRole('option', { name: /^Gym/ }).click();
    await move.getByRole('button', { name: 'Move' }).click();
    await expect(page.getByText('"Room 101" moved.').first()).toBeVisible();
    await expect(
      page.getByText('Riverside Elementary > Main building > Gym > Room 101'),
    ).toBeVisible();
  });

  test('a location cannot be moved inside itself', async ({ page }) => {
    await page.goto('/locations');
    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await page.getByRole('button', { name: 'Move' }).click();
    const move = page.getByRole('dialog', { name: 'Move Riverside Elementary' });
    await move.getByRole('combobox', { name: 'New parent' }).fill('Main');
    // the option exists but cannot be chosen
    await expect(page.getByRole('option', { name: /^Main building/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('archiving a location that holds assets is refused with the counts; an empty one is archived', async ({
    page,
  }) => {
    await page.goto('/locations');
    await page.getByRole('button', { name: 'Add location' }).click();
    const create = page.getByRole('dialog', { name: 'Add a location' });
    await create.getByLabel(/^Name/).fill('Scratch room');
    await create.getByRole('button', { name: 'Add location' }).click();
    await expect(page.getByTestId('location-name')).toHaveText('Scratch room');
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Archive Scratch room?' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByText('Location archived.').first()).toBeVisible();
    await expect(tree(page).getByRole('treeitem', { name: /^Scratch room/ })).toHaveCount(0);

    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await page.getByRole('button', { name: 'Archive', exact: true }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive Riverside Elementary?' });
    await expect(confirm.getByRole('status')).toContainText('sublocations');
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(confirm.getByRole('alert')).toContainText(/sublocation/);
  });

  test('"View in asset list" opens the asset list filtered to the location and its sublocations', async ({
    page,
  }) => {
    await page.goto('/locations');
    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await page.getByRole('link', { name: 'View in asset list' }).click();
    await expect(page).toHaveURL(/\/assets\/?\?location=/);
    await expect(page.getByRole('combobox', { name: 'Location' })).toHaveValue(
      'Riverside Elementary',
    );
    await expect(page.getByTestId('assets-range')).toContainText('of 195');
  });

  test('the asset form uses the same picker for its location', async ({ page }) => {
    await page.goto('/assets/new');
    const field = page.getByRole('combobox', { name: 'Location' });
    await pick(page, field, 'Gym', /^Gym/);
    await expect(field).toHaveValue('Gym');
    await page.getByRole('button', { name: 'Clear location' }).click();
    await expect(field).toHaveValue('');
  });
});

test.describe('locations at 375px', () => {
  test('stays usable: tree, details and dialog fit the screen', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto('/locations');
    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await expect(page.getByTestId('location-name')).toBeVisible();
    await page.getByRole('button', { name: 'Add inside' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a location' });
    const box = await dialog.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(375);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});

test.describe('locations (read-only role)', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('can browse the tree but has no write actions', async ({ page }) => {
    await page.goto('/locations');
    await tree(page)
      .getByRole('treeitem', { name: /^Riverside Elementary/ })
      .click();
    await expect(page.getByTestId('location-name')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /Add location|Add inside|Move|Archive/ }),
    ).toHaveCount(0);
  });
});
