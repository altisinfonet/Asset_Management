import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { expect, settled, test } from './fixtures';
import { choose, pick } from './m2-helpers';

/**
 * Managed departments (ED-17): the Settings page (create, rename, duplicate refused on the field,
 * archive refused with the counts, merge), the picker on the person and asset forms, the department
 * column and filter on People and Assets, and the bulk edit. Against the mock API.
 */
test.describe('Settings -> Departments', () => {
  test('lists the demo departments with code, manager and the people and asset counts', async ({
    page,
  }) => {
    await page.goto('/settings/departments');
    await expect(page.getByRole('heading', { name: 'Departments', level: 2 })).toBeVisible();
    const row = page.getByRole('row', { name: /Mathematics/ });
    await expect(row).toContainText('MATH');
    await expect(page.getByRole('row', { name: /^IT/ })).toContainText('Alice Owner');
    await settled(page);
    // the counts link to the lists they count
    await page
      .getByRole('row', { name: /Library/ })
      .getByRole('link')
      .first()
      .click();
    await expect(page).toHaveURL(/\/people\/?\?department=/);
    await expect(page.getByRole('combobox', { name: 'Department' })).toHaveValue('Library');
  });

  test('creates, refuses a duplicate on the Name field, and renames', async ({ page }) => {
    await page.goto('/settings/departments');
    await page.getByRole('button', { name: 'Add department' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a department' });
    await dialog.getByLabel(/^Name/).fill(' mathematics ');
    await dialog.getByRole('button', { name: 'Add department' }).click();
    await expect(dialog.getByText('This value is already in use.')).toBeVisible();
    await dialog.getByLabel(/^Name/).fill('Art');
    await dialog.getByLabel(/^Code/).fill('ART');
    await dialog.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByText('Department "Art" added.').first()).toBeVisible();

    await page.getByRole('button', { name: 'Edit Art' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit Art' });
    await edit.getByLabel(/^Name/).fill('Arts');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: /Arts/ })).toContainText('ART');
  });

  test('archive is refused with the counts, then merges everything into another department', async ({
    page,
  }) => {
    await page.goto('/settings/departments');
    const science = page.getByRole('row', { name: /Science/ });
    const people = Number(await science.getByRole('cell').nth(3).innerText());
    expect(people).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'Archive Science' }).click();
    await page
      .getByRole('dialog', { name: 'Archive Science?' })
      .getByRole('button', { name: 'Archive' })
      .click();
    // the dialog turns into "... is still in use": its name changes with it
    const dialog = page.getByRole('dialog', { name: 'Science is still in use' });
    await expect(dialog.getByText(/Still in use by/)).toContainText(`${people} people`);
    await expect(dialog.getByRole('button', { name: 'Merge and archive' })).toBeDisabled();
    await pick(
      page,
      dialog.getByRole('combobox', { name: /Move them to/ }),
      'math',
      /^Mathematics/,
    );
    await dialog.getByRole('button', { name: 'Merge and archive' }).click();
    await expect(page.getByText('Merged into "Mathematics".').first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Science/ })).toHaveCount(0);
    await expect(page.getByRole('row', { name: /Mathematics/ })).toBeVisible();
  });

  test('a department with nobody in it archives at once', async ({ page }) => {
    await page.goto('/settings/departments');
    await page.getByRole('button', { name: 'Add department' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a department' });
    await dialog.getByLabel(/^Name/).fill('Spare');
    await dialog.getByRole('button', { name: 'Add department' }).click();
    await expect(page.getByRole('row', { name: /Spare/ })).toBeVisible();
    await page.getByRole('button', { name: 'Archive Spare' }).click();
    await page
      .getByRole('dialog', { name: 'Archive Spare?' })
      .getByRole('button', { name: 'Archive' })
      .click();
    await expect(page.getByText('Department archived.').first()).toBeVisible();
    await expect(page.getByRole('row', { name: /Spare/ })).toHaveCount(0);
  });
});

test.describe('Settings -> Departments (read-only role)', () => {
  test.use({ session: MOCK_ACCOUNTS.viewer });

  test('sees the list and no write buttons', async ({ page }) => {
    await page.goto('/settings/departments');
    await expect(page.getByRole('row', { name: /Mathematics/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add department' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^(Edit|Archive) / })).toHaveCount(0);
  });
});

test.describe('people and assets', () => {
  test('the person form picks the department from the list and the list shows and filters by it', async ({
    page,
  }) => {
    await page.goto('/people');
    await page.getByRole('button', { name: 'Add person' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add a person' });
    await dialog.getByLabel(/^Name/).fill('Dana Departments');
    await pick(page, dialog.getByRole('combobox', { name: 'Department' }), 'sci', /^Science/);
    await dialog.getByRole('button', { name: 'Add person' }).click();
    await expect(page.getByText('Dana Departments added.').first()).toBeVisible();

    await page.getByRole('combobox', { name: 'Department' }).fill('sci');
    await page.getByRole('option', { name: /^Science/ }).click();
    const row = page.getByRole('row', { name: /Dana Departments/ });
    await expect(row).toContainText('Science');
    await expect(page.getByRole('row', { name: /Alice Owner/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters' }).first().click();
    await expect(page.getByRole('row', { name: /Alice Owner/ })).toBeVisible();
  });

  test('the person page shows the department and links to the people list filtered by it', async ({
    page,
  }) => {
    await page.goto('/people');
    await page.getByRole('link', { name: 'Alice Owner' }).click();
    await page.getByRole('link', { name: 'Administration' }).click();
    await expect(page.getByRole('combobox', { name: 'Department' })).toHaveValue('Administration');
    await expect(page.getByRole('row', { name: /Alice Owner/ })).toBeVisible();
  });

  test('an asset gets a department on the form; the list has the column and the filter', async ({
    page,
  }) => {
    await page.goto('/assets/new');
    await choose(page, page.getByRole('combobox', { name: /^Category/ }), 'Projector');
    await page.getByRole('spinbutton', { name: 'Lamp hours' }).fill('10');
    await expect(
      page.getByText('Who owns or pays for it. Where it is stays Location.'),
    ).toBeVisible();
    await pick(page, page.getByRole('combobox', { name: 'Department' }), 'lib', /^Library/);
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toBeVisible();
    await expect(page.getByText('Library').first()).toBeVisible();

    await page.goto('/assets');
    await page.getByRole('button', { name: 'Columns' }).click();
    await page
      .getByRole('dialog', { name: 'Columns' })
      .getByRole('checkbox', { name: 'Department' })
      .click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('columnheader', { name: 'Department' })).toBeVisible();
    await pick(page, page.getByRole('combobox', { name: 'Department' }), 'lib', /^Library/);
    await expect(page.getByTestId('assets-range')).not.toContainText('of 195');
    for (const row of (await page.getByRole('row').all()).slice(1, 6)) {
      await expect(row).toContainText('Library');
    }
  });

  test('bulk edit sets the department of the selected assets', async ({ page }) => {
    await page.goto('/assets');
    await page.getByPlaceholder('Tag, serial or name').fill('PRJ-');
    await expect(page.getByTestId('assets-range')).toHaveText('Showing 1-10 of 10');
    await page.getByRole('checkbox', { name: 'Select row PRJ-00010' }).click();
    await page.getByRole('checkbox', { name: 'Select row PRJ-00008' }).click();
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Edit 2 assets' });
    await choose(page, dialog.getByRole('combobox', { name: 'Field' }), 'Department');
    await pick(page, dialog.getByRole('combobox', { name: 'New value' }), 'fac', /^Facilities/);
    await dialog.getByRole('button', { name: 'Apply to 2 assets' }).click();
    await expect(page.getByText('Done: 2 assets updated.').first()).toBeVisible();
    const ids = await page.evaluate(async () => {
      const body = (await (await fetch('/v1/assets?tag=PRJ-00010')).json()) as {
        data: Array<{ department_id: string | null }>;
      };
      return body.data[0]!.department_id;
    });
    expect(ids).toMatch(/-0014-/);
  });
});
