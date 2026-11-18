import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { MOCK_ACCOUNTS } from '../src/mocks/fixtures';
import { uid } from '../src/mocks/registry-fixtures';

/**
 * e2e runs against the static export built with the mock API (`pnpm build:mock`). Every app screen
 * sits behind the auth guard, so by default each test starts with a signed-in mock session (what
 * the HttpOnly cookie would be). Tests of the auth flows opt out with `test.use({ session: 'none' })`
 * or pick another account.
 */
export type SessionOption = 'none' | (typeof MOCK_ACCOUNTS)[keyof typeof MOCK_ACCOUNTS];

const STATE_KEY = 'at-mock-state';

export async function seedSession(page: Page, email: string): Promise<void> {
  await page.addInitScript(
    ({ key, email }) => {
      try {
        if (window.localStorage.getItem(key)) return; // keep what the app itself wrote since
        window.localStorage.setItem(
          key,
          JSON.stringify({
            session: {
              id: 'sess-e2e',
              email,
              csrf: 'csrf-e2e',
              mfaVerified: true,
              limited: false,
              createdAt: new Date().toISOString(),
            },
          }),
        );
      } catch {
        // storage unavailable
      }
    },
    { key: STATE_KEY, email },
  );
}

export const test = base.extend<{ session: SessionOption }>({
  session: [MOCK_ACCOUNTS.owner, { option: true }],
  page: async ({ page, session }, provide) => {
    if (session !== 'none') await seedSession(page, session);
    await provide(page);
  },
});

/**
 * Open an app URL and wait until the auth guard has let the shell through (keyboard shortcuts
 * and the palette only exist once the shell is mounted).
 */
export async function gotoApp(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator('main#main')).toBeVisible();
}

/**
 * The visible `role="alert"` messages. Next.js keeps an empty alert element for route
 * announcements, which would make a plain `getByRole('alert')` ambiguous.
 */
export function alerts(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: /\S/ });
}

/** Id of seeded asset number `n` in the mock registry (`AT-00124` is `assetId(124)`). */
export const assetId = (n: number) => uid('asset', n);

/**
 * Wait until nothing on the page is loading: no busy region (tables, skeleton screens) and no
 * skeleton blocks. Use before axe or screenshots so they see the real screen, not its placeholder.
 */
export async function settled(page: Page): Promise<void> {
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  await expect(page.locator('[data-skeleton]')).toHaveCount(0);
}

export { expect };
