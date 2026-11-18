import { defineConfig } from '@playwright/test';

/**
 * Routing and smoke e2e for the web app.
 *
 *   E2E_TARGET=static (default)  serves the MOCK export `out-mock/` (pnpm build:mock) with scripts/serve-static.mjs
 *   E2E_TARGET=dev               runs `next dev` with the mock API (scripts/dev-mock.mjs)
 *   E2E_FALLBACK=404|index|none  SPA-fallback mode of the static server (see serve-static.mjs)
 *   PW_CHANNEL=chrome|msedge     use an installed browser instead of the Playwright download
 *
 * Every screen sits behind the auth guard, so the app runs against the MSW mock API (docs/engineering/openapi.yaml
 * contract); `pnpm test:e2e` builds out-mock/ first, `pnpm test:e2e:run` reuses an existing build.
 * Optional in CI (needs a browser).
 */
const target = process.env.E2E_TARGET ?? 'static';
const fallback = process.env.E2E_FALLBACK ?? '404';
const port = target === 'dev' ? 3101 : 4173;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
  },
  webServer:
    target === 'dev'
      ? {
          command: `node scripts/dev-mock.mjs --port ${port}`,
          port,
          reuseExistingServer: !process.env.CI,
          timeout: 120_000,
        }
      : {
          command: `node scripts/serve-static.mjs out-mock --port=${port} --fallback=${fallback}${
            process.env.E2E_REDIRECT_SLASH ? ' --redirect-slash' : ''
          }`,
          port,
          reuseExistingServer: !process.env.CI,
        },
});
