import { defineConfig, type PlaywrightTestConfig } from '@playwright/test';

/**
 * Routing and smoke e2e for the web app.
 *
 *   E2E_TARGET=static (default)  serves the MOCK export `out-mock/` (pnpm build:mock) with scripts/serve-static.mjs
 *   E2E_TARGET=dev               runs `next dev` with the mock API (scripts/dev-mock.mjs)
 *   E2E_TARGET=real              project `real`: the REAL stack. Serves the production export `out/` (pnpm build)
 *                                with `/v1` proxied to the compose API (E2E_API_URL, default http://localhost:3000)
 *                                and drives e2e-real/ against the seeded demo tenant; Mailpit (E2E_MAILPIT_URL,
 *                                default http://localhost:8025) shows the mails.
 *   E2E_FALLBACK=404|index|none  SPA-fallback mode of the static server (see serve-static.mjs)
 *   PW_CHANNEL=chrome|msedge     use an installed browser instead of the Playwright download
 *
 * Every screen sits behind the auth guard, so the mock suites run against the MSW mock API (docs/engineering/openapi.yaml
 * contract); `pnpm test:e2e` builds out-mock/ first, `pnpm test:e2e:run` reuses an existing build, and
 * `pnpm test:e2e:real` runs the real-stack project against `docker compose up` (needs `pnpm build` first).
 * Optional in CI (needs a browser).
 */
const target = process.env.E2E_TARGET ?? 'static';
const fallback = process.env.E2E_FALLBACK ?? '404';
const port =
  Number(process.env.E2E_PORT) || (target === 'dev' ? 3101 : target === 'real' ? 4174 : 4173);
const apiUrl = process.env.E2E_API_URL ?? 'http://localhost:3000';

const common: PlaywrightTestConfig = {
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: `http://localhost:${port}`,
    channel: process.env.PW_CHANNEL || undefined,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
};

export default target === 'real'
  ? defineConfig({
      ...common,
      // One signed-in story that builds on its own data: strictly in order, one worker.
      fullyParallel: false,
      workers: 1,
      retries: 0,
      timeout: 60_000,
      projects: [{ name: 'real', testDir: './e2e-real' }],
      webServer: {
        command: `node scripts/serve-static.mjs out --port=${port} --fallback=${fallback} --proxy=${apiUrl}`,
        port,
        // Never reuse: a leftover server on this port may proxy /v1 to a different (or dead) API stack.
        reuseExistingServer: false,
      },
    })
  : defineConfig({
      ...common,
      testDir: './e2e',
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
