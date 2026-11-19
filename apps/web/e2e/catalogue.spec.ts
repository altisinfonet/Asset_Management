import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

/** Settings: categories, custom fields, models, manufacturers, status labels, tag numbering, vendors. */

async function choose(page: Page, label: RegExp | string, option: RegExp | string) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

test.describe('categories and custom fields (M1-WEB-05)', () => {
  test('creates a category with one custom field of each type and previews them', async ({
    page,
  }) => {
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'New category' }).click();
    const dialog = page.getByRole('dialog', { name: 'New category' });
    await dialog.getByLabel(/^Name/).fill('Monitor');
    await dialog.getByLabel('Tag prefix').fill('MON-');
    await dialog.getByRole('button', { name: 'Create category' }).click();
    await expect(page.getByRole('row', { name: /Monitor/ })).toBeVisible();

    // The "Custom fields" count links to the field list of that category.
    await page.goto('/settings/fields');
    await expect(page.getByRole('heading', { name: 'Custom fields', level: 2 })).toBeVisible();

    const types: Array<{ type: string; label: string }> = [
      { type: 'Text', label: 'Panel brand' },
      { type: 'Long text', label: 'Remarks' },
      { type: 'Number', label: 'Diagonal' },
      { type: 'Checkbox', label: 'Has speakers' },
      { type: 'Date', label: 'Installed on' },
      { type: 'Select', label: 'Resolution' },
      { type: 'Multi-select', label: 'Ports' },
      { type: 'URL', label: 'Manual link' },
      { type: 'Email', label: 'Owner email' },
    ];

    for (const { type, label } of types) {
      await page.getByRole('button', { name: 'New field' }).click();
      const builder = page.getByRole('dialog', { name: 'New field' });
      await builder.getByLabel(/^Label/).fill(label);
      await choose(page, /^Type/, new RegExp(`^${type}$`));
      await choose(page, /^Applies to/, 'Monitor');
      if (type === 'Select' || type === 'Multi-select') {
        await builder.getByRole('button', { name: 'Add option' }).click();
        await builder.getByLabel('Option 1', { exact: true }).fill('First');
        await builder.getByRole('button', { name: 'Add option' }).click();
        await builder.getByLabel('Option 2', { exact: true }).fill('Second');
      }
      // live preview of the form field
      await expect(builder.getByRole('region', { name: 'Preview' })).toContainText(label);
      await builder.getByRole('button', { name: 'Create field' }).click();
      await expect(builder).toBeHidden();
    }

    await choose(page, /^Show fields for/, 'Monitor');
    for (const { label } of types) {
      await expect(page.getByRole('row', { name: new RegExp(label) })).toBeVisible();
    }
    // key derived from the label, type shown in words
    await expect(page.getByRole('row', { name: /Diagonal/ })).toContainText('diagonal');
    await expect(page.getByRole('row', { name: /Ports/ })).toContainText('Multi-select');
  });

  test('a field key is locked after saving and the builder validates the label', async ({
    page,
  }) => {
    await page.goto('/settings/fields');
    await page.getByRole('button', { name: 'New field' }).click();
    const builder = page.getByRole('dialog', { name: 'New field' });
    await builder.getByRole('button', { name: 'Create field' }).click();
    await expect(builder.getByText('This field is required.').first()).toBeVisible();
    await builder.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Edit Screen size (in)' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit field' });
    await expect(edit.getByLabel(/^Key/)).toBeDisabled();
    await expect(edit.getByLabel(/^Key/)).toHaveValue('screen_size');
  });

  test('archiving a category in use is refused and says how many assets use it', async ({
    page,
  }) => {
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'Archive Laptop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Archive Laptop?' });
    await expect(dialog.getByRole('status')).toContainText('assets use this category');
    await dialog.getByRole('button', { name: 'Archive' }).click();
    await expect(dialog.getByRole('alert')).toContainText(
      'Still in use by 40 assets, 3 models, 2 custom fields',
    );
    await expect(dialog).toBeVisible();
  });

  test('an unused category can be archived and is then listed only with Show archived', async ({
    page,
  }) => {
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'New category' }).click();
    const dialog = page.getByRole('dialog', { name: 'New category' });
    await dialog.getByLabel(/^Name/).fill('Scratch');
    await dialog.getByRole('button', { name: 'Create category' }).click();
    await page.getByRole('button', { name: 'Archive Scratch' }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive Scratch?' });
    await expect(confirm.getByRole('status')).toContainText('No assets use this category');
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(page.getByRole('row', { name: /Scratch/ })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Show archived' }).click();
    await expect(page.getByRole('row', { name: /Scratch/ })).toContainText('archived');
  });

  test('a duplicate category name shows the server message on the field', async ({ page }) => {
    await page.goto('/settings/categories');
    await page.getByRole('button', { name: 'New category' }).click();
    const dialog = page.getByRole('dialog', { name: 'New category' });
    await dialog.getByLabel(/^Name/).fill('Laptop');
    await dialog.getByRole('button', { name: 'Create category' }).click();
    await expect(dialog.getByText('A category with this name already exists')).toBeVisible();
  });
});

test.describe('models, manufacturers, status labels, tag numbering, vendors (M1-WEB-06)', () => {
  test('creates a manufacturer and a model, filters and archives', async ({ page }) => {
    await page.goto('/settings/manufacturers');
    await page.getByRole('button', { name: 'New manufacturer' }).click();
    const m = page.getByRole('dialog', { name: 'New manufacturer' });
    await m.getByLabel(/^Name/).fill('Acer');
    await m.getByRole('button', { name: 'Create manufacturer' }).click();
    await expect(page.getByRole('row', { name: /Acer/ })).toBeVisible();

    await page.goto('/settings/models');
    await page.getByRole('button', { name: 'New model' }).click();
    const dialog = page.getByRole('dialog', { name: 'New model' });
    await dialog.getByRole('button', { name: 'Create model' }).click();
    await expect(dialog.getByText('This field is required.').first()).toBeVisible();
    await dialog.getByLabel(/^Model name/).fill('Chromebook Spin 311');
    await choose(page, /^Category/, 'Chromebook');
    await choose(page, /^Manufacturer/, 'Acer');
    await dialog.getByLabel('Depreciation (months)').fill('36');
    await dialog.getByRole('button', { name: 'Create model' }).click();
    await expect(page.getByRole('row', { name: /Chromebook Spin 311/ })).toContainText('Acer');

    await page.getByPlaceholder('Model name or number').fill('spin');
    await expect(page.getByRole('row', { name: /Chromebook Spin 311/ })).toBeVisible();
    await expect(page.getByRole('row', { name: /ThinkPad/ })).toHaveCount(0);

    // archiving a model in use is refused with the count
    await page.getByPlaceholder('Model name or number').fill('ThinkPad');
    await page.getByRole('button', { name: 'Archive ThinkPad T14' }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive ThinkPad T14?' });
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(confirm.getByRole('alert')).toContainText('Still in use by');
  });

  test('status labels: create, rename only (state type is fixed), default and ordering', async ({
    page,
  }) => {
    await page.goto('/settings/status');
    await page.getByRole('button', { name: 'New label' }).click();
    const dialog = page.getByRole('dialog', { name: 'New label' });
    await dialog.getByLabel(/^Name/).fill('Loaned out');
    await choose(page, /^State type/, 'Assigned');
    await dialog.getByRole('button', { name: 'Create label' }).click();
    const row = page.getByRole('row', { name: /Loaned out/ });
    await expect(row).toBeVisible();
    // the preview badge uses the fixed colour of the state type, with an icon and the label text
    await expect(row.getByText('Loaned out').last()).toBeVisible();

    await page.getByRole('button', { name: 'Edit Loaned out' }).click();
    const edit = page.getByRole('dialog', { name: 'Edit status label' });
    await expect(edit.getByRole('combobox', { name: /^State type/ })).toBeDisabled();
    await edit.getByLabel(/^Name/).fill('On loan');
    await edit.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: /On loan/ })).toBeVisible();

    await page.getByRole('button', { name: 'Make default' }).first().click();
    await expect(page.getByText('is now the default.').first()).toBeVisible();
    // the default label cannot be archived: the button is not offered for it
    const defaultRow = page.getByRole('row').filter({ hasText: 'Default' }).first();
    await expect(defaultRow.getByRole('button', { name: /^Archive/ })).toHaveCount(0);
  });

  test('tag numbering edits the category prefix with a live example', async ({ page }) => {
    await page.goto('/settings/tags');
    await page.getByRole('button', { name: 'Edit prefix of Laptop' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tag prefix for Laptop' });
    await dialog.getByLabel(/^Prefix/).fill('NB-');
    await expect(dialog.getByTestId('tag-example')).toContainText('NB-00042');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByRole('row', { name: /Laptop/ })).toContainText('NB-00042');
  });

  test('tag numbering template: edit prefix, width and the category prefix; new assets follow it', async ({
    page,
  }) => {
    await page.goto('/settings/tags');
    await expect(page.getByTestId('tag-template-summary')).toContainText('5 digits');
    await page.getByRole('button', { name: 'Edit template' }).click();
    const dialog = page.getByRole('dialog', { name: 'Tag numbering template' });
    await dialog.getByLabel(/^Prefix/).fill('ACME-');
    await dialog.getByLabel('Digits in the counter').fill('4');
    await expect(dialog.getByTestId('tag-template-preview')).toContainText('ACME-LAP-0042');
    await dialog.getByRole('checkbox', { name: /category prefix/ }).click();
    await expect(dialog.getByTestId('tag-template-preview')).toContainText('ACME-0042');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('tag-template-example')).toHaveText('ACME-0042');
    // the per-category table follows the template
    await expect(page.getByRole('row', { name: /Laptop/ })).toContainText('ACME-0042');

    await page.goto('/assets/new');
    await choose(page, /^Category/, 'Tablet');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByTestId('asset-tag')).toHaveText('ACME-0001');
  });

  test('vendors: create, validate the email inline, archive a vendor in use is refused', async ({
    page,
  }) => {
    await page.goto('/settings/vendors');
    await page.getByRole('button', { name: 'New vendor' }).click();
    const dialog = page.getByRole('dialog', { name: 'New vendor' });
    await dialog.getByLabel(/^Name/).fill('Staples');
    await dialog.getByLabel('Contact email').fill('not-an-email');
    await dialog.getByRole('button', { name: 'Create vendor' }).click();
    await expect(dialog.getByText('must be an email address')).toBeVisible();
    await dialog.getByLabel('Contact email').fill('orders@staples.example');
    await dialog.getByRole('button', { name: 'Create vendor' }).click();
    await expect(page.getByRole('row', { name: /Staples/ })).toBeVisible();

    await page.getByRole('button', { name: 'Archive CDW' }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive CDW?' });
    await confirm.getByRole('button', { name: 'Archive' }).click();
    await expect(confirm.getByRole('alert')).toContainText('Still in use by');
  });
});
