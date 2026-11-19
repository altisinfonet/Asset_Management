import type { Locator, Page } from '@playwright/test';
import { expect } from './fixtures';

/**
 * Helpers of the M2 wave 1 specs. The mock API lives in the page (a service worker), so state is
 * read and changed with `fetch` inside the page, like the app itself does.
 */
export interface AssetRef {
  id: string;
  asset_tag: string;
  name: string | null;
  etag: string;
}

async function firstAsset(page: Page, query: string): Promise<AssetRef> {
  // the app must be loaded first: the mock API starts with the page
  await page.goto('/');
  await expect(page.locator('main#main')).toBeVisible();
  const found = await page.evaluate(async (q) => {
    const list = await fetch(`/v1/assets?${q}&limit=1&sort=asset_tag`);
    const body = (await list.json()) as {
      data: Array<{ id: string; asset_tag: string; name: string | null }>;
    };
    const asset = body.data[0]!;
    const one = await fetch(`/v1/assets/${asset.id}`);
    return { ...asset, etag: one.headers.get('etag') ?? '' };
  }, query);
  return found;
}

/** The first asset that is ready (deployable) and in stock. */
export const readyAsset = (page: Page) => firstAsset(page, 'state_type=deployable&assigned=false');

/** The first asset that is checked out to a person. */
export const heldAsset = (page: Page) => firstAsset(page, 'assigned=true');

/** A change made "by someone else" while a dialog is open: bumps the asset's version. */
export async function touchAsset(page: Page, asset: AssetRef): Promise<void> {
  await page.evaluate(
    async ({ id, etag }) => {
      await fetch(`/v1/assets/${id}`, {
        method: 'PATCH',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'csrf-e2e',
          'if-match': etag,
        },
        body: JSON.stringify({ notes: 'changed by someone else' }),
      });
    },
    { id: asset.id, etag: asset.etag },
  );
}

/** Check an asset out through the API (arranging state for a test). */
export async function checkOutViaApi(page: Page, assetId: string, personId: string): Promise<void> {
  await page.evaluate(
    async ({ assetId, personId }) => {
      const response = await fetch(`/v1/assets/${assetId}/checkout`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-csrf-token': 'csrf-e2e',
          'idempotency-key': `e2e-${Math.random().toString(36).slice(2)}-key`,
        },
        body: JSON.stringify({ person_id: personId }),
      });
      if (!response.ok) throw new Error(`checkout failed: ${response.status}`);
    },
    { assetId, personId },
  );
}

export async function personId(page: Page, q: string): Promise<string> {
  return page.evaluate(async (query) => {
    const body = (await (await fetch(`/v1/people?q=${encodeURIComponent(query)}`)).json()) as {
      data: Array<{ id: string }>;
    };
    return body.data[0]!.id;
  }, q);
}

/** Type into a combobox and choose the option with that name. */
export async function pick(page: Page, combobox: Locator, text: string, option: RegExp | string) {
  await combobox.fill(text);
  await page.getByRole('option', { name: option }).first().click();
}

/**
 * Choose an option of a Radix select. The select gives focus back to its trigger as it closes; wait
 * for that, or a field filled right after would lose focus to it.
 */
export async function choose(page: Page, trigger: Locator, option: RegExp | string, exact = false) {
  await trigger.click();
  await page.getByRole('option', { name: option, exact }).click();
  await expect(trigger).toBeFocused();
}

/** A tiny valid PNG, for upload tests. */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
