#!/usr/bin/env node
/**
 * Regenerates the screenshots of the user guides (docs/guides/img/*.png) from a running, freshly
 * seeded Asset Tracker stack. See docs/guides/tools/README.md for how to run it.
 *
 *   node docs/guides/tools/shoot.mjs [--only=import,labels] [--list]
 *
 * Environment (all optional):
 *   BASE_URL     web app, with /v1 proxied to the API   (default http://localhost:3001)
 *   PW_CHANNEL   a browser channel such as "chrome"      (default: Playwright's own Chromium)
 *   OUT_DIR      where the PNG files go                  (default docs/guides/img)
 *
 * The script signs in with the demo users of README.md, creates the little data it needs through the
 * real API and the real screens (a loan pool member, a repair, a scoped user ...), and takes the
 * pictures. It needs a stack that was seeded once and not used since: run it against a fresh one.
 * It is a documentation tool: it never runs in CI.
 */
import { createHmac } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..', '..');
// Playwright is a dependency of apps/web: resolve it from there, so no new dependency is needed.
const { chromium } = createRequire(path.join(repoRoot, 'apps', 'web', 'package.json'))(
  '@playwright/test',
);

const BASE_URL = (process.env.BASE_URL ?? 'http://localhost:3001').replace(/\/$/, '');
const OUT_DIR = path.resolve(repoRoot, process.env.OUT_DIR ?? 'docs/guides/img');
const SAMPLES = path.join(here, 'samples');
const PASSWORD = 'Demo-Passw0rd-2026';
const OWNER_TOTP_SECRET = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const MAILPIT_URL = (process.env.MAILPIT_URL ?? 'http://localhost:8025').replace(/\/$/, '');
const VIEWPORT = { width: 1280, height: 800 };

mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 6238 code (30 s step, 6 digits) like an authenticator app would show. */
function totp(secret, stepOffset = 0) {
  let bits = '';
  for (const c of secret.toUpperCase()) bits += BASE32.indexOf(c).toString(2).padStart(5, '0');
  const key = Buffer.from(bits.match(/.{8}/g).map((b) => parseInt(b, 2)));
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + stepOffset));
  const d = createHmac('sha1', key).update(msg).digest();
  const o = d[d.length - 1] & 0xf;
  const n = ((d[o] & 0x7f) << 24) | (d[o + 1] << 16) | (d[o + 2] << 8) | d[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Moves the pointer out of the way, so no row or button looks hovered in the picture. */
const park = (page) => page.mouse.move(1279, 1);

function log(msg) {
  console.log(msg);
}

/** Opens a new signed-in page. The Owner needs the authenticator code, the others do not. */
async function signIn(browser, email) {
  const context = await browser.newContext({ viewport: VIEWPORT, colorScheme: 'light' });
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`);
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const dashboard = page.getByRole('heading', { level: 1, name: 'Dashboard' });
  if (email.startsWith('owner@')) {
    const code = page.getByLabel(/^Authentication code/);
    await code.waitFor();
    // a code that was used already is refused, so try this step and then the next one
    for (const offset of [0, 1, 1]) {
      await code.fill(totp(OWNER_TOTP_SECRET, offset));
      await page.getByRole('button', { name: 'Verify' }).click();
      if (
        await dashboard.waitFor({ timeout: 5000 }).then(
          () => true,
          () => false,
        )
      )
        break;
      if (offset === 1) await sleep(31000);
    }
  }
  await dashboard.waitFor();
  return page;
}

/** Calls the API from a signed-in page (cookie, CSRF token and an Idempotency-Key). */
async function api(page, method, apiPath, body, headers = {}) {
  return page.evaluate(
    async ({ method, apiPath, body, headers }) => {
      const me = await (await fetch('/v1/auth/me')).json();
      const res = await fetch(apiPath, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          'x-csrf-token': me.csrf_token,
          'idempotency-key': `doc-${Math.random().toString(36).slice(2)}-${Date.now()}`,
          ...headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      return {
        status: res.status,
        json: text ? JSON.parse(text) : null,
        etag: res.headers.get('etag'),
      };
    },
    { method, apiPath, body, headers },
  );
}

async function must(promise, what) {
  const res = await promise;
  if (res.status >= 300) throw new Error(`${what}: HTTP ${res.status} ${JSON.stringify(res.json)}`);
  return res.json;
}

/** Waits for the page to settle (no spinner text, network quiet). */
async function settle(page, ms = 400) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await sleep(ms);
}

const taken = [];

/**
 * Saves a screenshot. `region` is one or more locators: the picture is cropped to their union plus
 * `pad` pixels (the window is made taller for the moment, so a long region is seen whole).
 * Without a region the whole 1280 x 800 window is saved.
 */
async function shot(
  page,
  name,
  region,
  { pad = 12, padBottom = pad, height = 1500, width = VIEWPORT.width, wide = false } = {},
) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await sleep(250);
  if (!region) {
    await page.screenshot({ path: file });
  } else {
    await page.setViewportSize({ width, height });
    await sleep(200);
    await page.evaluate(() => {
      window.scrollTo(0, 0);
      for (const el of document.querySelectorAll('main, [data-scroll], body > div'))
        if (el.scrollTop) el.scrollTop = 0;
      // a table that scrolls sideways may have been scrolled by a focused button (the row's actions
      // after a dialog closes): show it from its first column
      for (const el of document.querySelectorAll('main *')) if (el.scrollLeft) el.scrollLeft = 0;
    });
    const locators = Array.isArray(region) ? region : [region];
    const boxes = [];
    for (const l of locators) {
      boxes.push(
        await l.first().evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, y: r.top, w: r.width, h: r.height };
        }),
      );
    }
    if (wide) {
      // the full width of the page content, not only of the widest element
      const m = await page
        .locator('main')
        .first()
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return { x: r.left, w: r.width };
        });
      boxes.push({ x: m.x, y: boxes[0].y, w: m.w, h: 0 });
    }
    const x1 = Math.max(0, Math.min(...boxes.map((b) => b.x)) - pad);
    const y1 = Math.max(0, Math.min(...boxes.map((b) => b.y)) - pad);
    const x2 = Math.min(width, Math.max(...boxes.map((b) => b.x + b.w)) + pad);
    const y2 = Math.min(height, Math.max(...boxes.map((b) => b.y + b.h)) + padBottom);
    await page.screenshot({ path: file, clip: { x: x1, y: y1, width: x2 - x1, height: y2 - y1 } });
    await page.setViewportSize(VIEWPORT);
  }
  const kb = Math.round(statSync(file).size / 1024);
  taken.push({ name, kb });
  log(`  ${name}.png (${kb} KB)`);
}

/** Opens a Radix select by its label and picks an option. */
async function choose(page, label, option) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('option', { name: option }).click();
}

// ---------------------------------------------------------------------------------------------
// Stages
// ---------------------------------------------------------------------------------------------

/** An unfinished import would show a "continue it" notice: end the ones a rehearsal left behind. */
async function cancelOpenImports(page) {
  await page.goto(`${BASE_URL}/imports`);
  const list = await api(page, 'GET', '/v1/imports?limit=100');
  for (const job of list.json.data) {
    if (!['completed', 'failed', 'cancelled'].includes(job.state)) {
      await api(page, 'POST', `/v1/imports/${job.id}/cancel`);
    }
  }
}

const stages = {};

/** Guide 1: import a spreadsheet (CSV). */
stages.import = async ({ admin }) => {
  await cancelOpenImports(admin);
  await admin.goto(`${BASE_URL}/imports`);
  await settle(admin);
  await shot(admin, '01-import-list', [
    admin.getByRole('heading', { name: 'Imports', level: 1 }),
    admin.getByRole('link', { name: 'New import' }).last(),
  ]);

  await admin.getByRole('link', { name: 'New import' }).first().click();
  await admin.getByRole('heading', { name: 'What do you want to import?' }).waitFor();
  await settle(admin);
  const caption = admin.getByTestId('import-step-caption');
  await shot(admin, '01-import-choose', [
    admin.getByRole('heading', { name: 'What do you want to import?' }),
    admin.getByRole('button', { name: 'Continue' }),
  ]);

  await admin.getByRole('radio', { name: /^Assets/ }).click();
  await admin.getByRole('button', { name: 'Continue' }).click();
  await admin.getByRole('heading', { name: 'Upload your file' }).waitFor();
  await settle(admin);
  await shot(
    admin,
    '01-import-upload',
    [caption, admin.getByText(/or Excel \(\.xlsx\) file, up to/)],
    { padBottom: 50 },
  );

  await admin.locator('input[type="file"]').setInputFiles(path.join(SAMPLES, 'school-devices.csv'));
  const columns = admin.getByRole('table', { name: 'Columns of your file' });
  await columns.waitFor({ timeout: 90000 });
  await settle(admin, 800);
  await park(admin);
  await shot(admin, '01-import-columns', [caption, columns]);
  await shot(admin, '01-import-options', [
    admin.getByRole('group', { name: 'Duplicates and settings' }),
    admin.getByRole('group', { name: 'Defaults for empty cells' }),
  ]);

  await admin.getByRole('button', { name: 'Continue' }).click();
  await admin.getByRole('heading', { name: 'Match values' }).waitFor();
  await settle(admin, 800);
  // "Good" and "Needs repair" are not status labels of this organisation: point them at real ones
  await admin.getByRole('combobox', { name: 'What to do with "Good"' }).click();
  await admin.getByRole('option', { name: 'Use an existing one' }).click();
  await admin.getByRole('combobox', { name: 'Existing record for "Good"' }).click();
  await admin.getByRole('option', { name: 'Ready to deploy' }).click();
  await admin.getByRole('combobox', { name: 'What to do with "Needs repair"' }).click();
  await admin.getByRole('option', { name: 'Use an existing one' }).click();
  await admin.getByRole('combobox', { name: 'Existing record for "Needs repair"' }).click();
  await admin.getByRole('option', { name: 'In repair' }).click();
  await settle(admin);
  await park(admin);
  await shot(admin, '01-import-values', [
    caption,
    admin.getByRole('table', { name: 'Values of Status' }),
  ]);

  await admin.getByRole('button', { name: 'Run the dry run' }).click();
  await admin.getByTestId('import-tiles').waitFor({ timeout: 120000 });
  await admin.getByText('Preview. Nothing has been saved yet.').waitFor();
  await settle(admin, 800);
  await park(admin);
  await shot(admin, '01-import-dryrun', [
    caption,
    admin.getByTestId('import-tiles'),
    admin.getByRole('table', { name: 'Rows of the dry run' }),
  ]);
  await shot(admin, '01-import-dryrun-errors', [
    admin.getByRole('heading', { name: 'Why rows were rejected' }),
    admin.getByRole('button', { name: /Import \d+ rows?/ }),
  ]);

  // the error report
  const [download] = await Promise.all([
    admin.waitForEvent('download'),
    admin.getByRole('button', { name: 'Download error report' }).click(),
  ]);
  const report = readFileSync(await download.path(), 'utf8');
  log(`--- error report ---\n${report}`);

  await admin.getByRole('button', { name: /^Import \d+ rows?$/ }).click();
  await admin.getByRole('heading', { name: 'Import finished' }).waitFor({ timeout: 180000 });
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '01-import-done',
    [caption, admin.getByText('A notification tells you when an import finishes.')],
    { height: 1100 },
  );
};

/** Guide 2: import from Google Admin (ChromeOS). */
stages.google = async ({ admin }) => {
  await cancelOpenImports(admin);
  await admin.goto(`${BASE_URL}/imports/new`);
  await admin.getByRole('heading', { name: 'What do you want to import?' }).waitFor();
  await admin.getByRole('radio', { name: /^Google Admin ChromeOS/ }).click();
  await settle(admin);
  await park(admin);
  await shot(admin, '02-google-choose', [
    admin.getByRole('heading', { name: 'What do you want to import?' }),
    admin.getByRole('button', { name: 'Continue' }),
  ]);
  await admin.getByRole('button', { name: 'Continue' }).click();
  await admin.getByRole('heading', { name: 'Upload your file' }).waitFor();
  await admin
    .locator('input[type="file"]')
    .setInputFiles(path.join(SAMPLES, 'chromeos-export.csv'));
  const columns = admin.getByRole('table', { name: 'Columns of your file' });
  await columns.waitFor({ timeout: 90000 });
  await settle(admin, 800);
  await park(admin);
  const caption = admin.getByTestId('import-step-caption');
  await shot(admin, '02-google-columns', [
    caption,
    columns,
    admin.getByText(/Category = Chromebook/),
  ]);

  await admin.getByRole('button', { name: 'Continue' }).click();
  const tiles = admin.getByTestId('import-tiles');
  const values = admin.getByRole('heading', { name: 'Match values' });
  await tiles.or(values).waitFor({ timeout: 120000 });
  if (await values.isVisible()) {
    await settle(admin, 800);
    await park(admin);
    await shot(
      admin,
      '02-google-values',
      [caption, admin.getByRole('button', { name: 'Run the dry run' })],
      { height: 1800 },
    );
    await admin.getByRole('button', { name: 'Run the dry run' }).click();
  }
  await tiles.waitFor({ timeout: 120000 });
  await admin.getByText('Preview. Nothing has been saved yet.').waitFor();
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '02-google-dryrun',
    [caption, tiles, admin.getByRole('list', { name: 'Records the import would create' })],
    { height: 1800 },
  );
  await admin.getByRole('button', { name: /^Import \d+ rows?$/ }).click();
  await admin.getByRole('heading', { name: 'Import finished' }).waitFor({ timeout: 180000 });
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '02-google-done',
    [caption, admin.getByText('A notification tells you when an import finishes.')],
    { height: 1100 },
  );

  // the devices are in the register: show them with their Chromebook details
  await admin.goto(`${BASE_URL}/assets`);
  await admin.getByPlaceholder('Tag, serial or name').fill('GA-10');
  await settle(admin, 1200);
  await park(admin);
  await shot(admin, '02-google-assets', [admin.locator('table').first()], { height: 1100 });
};

/** Guide 3: print and apply labels. */
stages.labels = async ({ admin }) => {
  await admin.goto(`${BASE_URL}/assets`);
  await admin.getByPlaceholder('Tag, serial or name').fill('TAB-10');
  await settle(admin, 1200);
  const boxes = admin.getByRole('checkbox', { name: /^Select row/ });
  await boxes.first().waitFor();
  for (const tag of ['TAB-101', 'TAB-102', 'TAB-103']) {
    await admin.getByRole('checkbox', { name: `Select row ${tag}` }).click();
  }
  await park(admin);
  const print = admin.getByRole('button', { name: /^Print labels \(\d+\)$/ });
  await shot(admin, '03-labels-select', [admin.locator('table').first(), print]);
  await print.click();
  const dialog = admin.getByRole('dialog', { name: 'Print labels' });
  await dialog.waitFor();
  await settle(admin, 800);
  // the sheet was already used for its first row (three labels): start at position 4
  await dialog
    .getByTestId('sheet-grid')
    .getByRole('radio', { name: /^Position 4,/ })
    .click();
  await park(admin);
  await shot(admin, '03-labels-dialog', dialog, { pad: 4 });
  await dialog.getByRole('button', { name: 'Generate PDF' }).click();
  await admin.getByTestId('labels-ready').waitFor({ timeout: 90000 });
  await settle(admin, 500);
  await shot(admin, '03-labels-ready', dialog, { pad: 4 });
  await dialog.getByRole('button', { name: 'Close' }).first().click();
};

const POOL_NAME = 'Science tablets';

/** Guide 4: run a loaner day (pool set-up, desk, dashboard and alerts). */
stages.loaners = async ({ admin }) => {
  // 1. the pool list and the organisation's loan defaults
  await admin.goto(`${BASE_URL}/loaners/pools`);
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '04-pools',
    [
      admin.getByRole('heading', { name: 'Loaner pools', level: 1 }),
      admin.getByRole('table', { name: 'Loaner pools' }),
    ],
    { height: 1500 },
  );

  // 2. a new pool
  await admin.getByRole('button', { name: 'New pool' }).click();
  const form = admin.getByRole('dialog', { name: 'New loaner pool' });
  await form.waitFor();
  await form.getByLabel(/^Name/).fill(POOL_NAME);
  await form
    .getByLabel(/^Description/)
    .fill('Tablets for the science rooms, lent for a lesson or a weekend.');
  const home = form.getByRole('combobox', { name: /^Home location/ });
  await home.fill('Lab 1');
  await admin.getByRole('option', { name: /Lab 1/ }).first().click();
  await form.getByLabel(/^Default loan length/).fill('3');
  await form.getByLabel(/^Longest loan/).fill('10');
  await form.getByLabel(/^Devices per borrower/).fill('2');
  await park(admin);
  await shot(admin, '04-pool-form', form, { pad: 4 });
  await form.getByRole('button', { name: 'Create pool' }).click();
  await admin.getByText(`Pool "${POOL_NAME}" created.`).first().waitFor();

  // 3. add the devices: the first one in the dialog, the rest through the API
  const pools = await must(api(admin, 'GET', '/v1/loaner-pools'), 'pools');
  const pool = pools.data.find((p) => p.name === POOL_NAME);
  await admin.goto(`${BASE_URL}/loaners/pool?id=${pool.id}`);
  await admin.getByRole('button', { name: 'Add device' }).first().click();
  const add = admin.getByRole('dialog', { name: `Add a device to ${POOL_NAME}` });
  await add.waitFor();
  const search = add.getByRole('combobox', { name: /^Device/ });
  await search.fill('TAB-101');
  await admin
    .getByRole('option', { name: /TAB-101/ })
    .first()
    .click();
  await park(admin);
  await shot(admin, '04-pool-add', add, { pad: 4 });
  await add.getByRole('button', { name: 'Add to pool' }).click();
  await admin.getByText('TAB-101 added to the pool.').first().waitFor();
  for (const tag of ['TAB-102', 'TAB-103', 'TAB-104', 'TAB-105']) {
    const found = await must(api(admin, 'GET', `/v1/assets?q=${tag}`), tag);
    await must(
      api(admin, 'POST', `/v1/loaner-pools/${pool.id}/members`, { asset_id: found.data[0].id }),
      `add ${tag}`,
    );
  }
  await admin.reload();
  await settle(admin, 1000);
  await park(admin);
  await shot(
    admin,
    '04-pool-page',
    [
      admin.getByRole('heading', { level: 1 }),
      admin.getByRole('table', { name: `Devices in ${POOL_NAME}` }),
    ],
    { height: 1200 },
  );

  // 4. the desk: lend two devices to one borrower
  await admin.goto(`${BASE_URL}/loaners/desk`);
  await admin.getByRole('combobox', { name: 'Lend from' }).click();
  await admin.getByRole('option', { name: POOL_NAME }).click();
  const device = admin.getByLabel('Device', { exact: true });
  for (const tag of ['TAB-101', 'TAB-102']) {
    await device.fill(tag);
    await device.press('Enter');
  }
  const borrower = admin.getByLabel('Borrower', { exact: true });
  await borrower.fill('S-2008');
  await borrower.press('Enter');
  await settle(admin, 600);
  await park(admin);
  const deskTitle = admin.getByRole('heading', { name: 'Loaner desk', level: 1 });
  await shot(
    admin,
    '04-desk-lend',
    [deskTitle, admin.getByRole('button', { name: /^Lend \d+ devices?$/ })],
    // padBottom: the hint under the button stays in the picture
    { height: 1500, wide: true, padBottom: 40 },
  );
  await admin.getByRole('button', { name: /^Lend \d+ devices?$/ }).click();
  await admin.getByTestId('desk-feedback').waitFor();
  await settle(admin, 600);
  await shot(admin, '04-desk-lent', [deskTitle, admin.getByTestId('desk-feedback')], {
    height: 1500,
    wide: true,
  });

  // 5. returning
  await admin.goto(`${BASE_URL}/loaners/desk?mode=return`);
  const returned = admin.getByLabel('Returned device');
  await returned.waitFor();
  await returned.fill('TAB-101');
  await returned.press('Enter');
  await admin.getByTestId('desk-return-summary').waitFor();
  await settle(admin, 600);
  await park(admin);
  await shot(admin, '04-desk-return', [deskTitle, admin.getByTestId('desk-return-summary')], {
    height: 1500,
    wide: true,
  });
  await returned.fill('TAB-102');
  await returned.press('Enter');
  await admin.getByText('TAB-102 returned.').first().waitFor();

  // 5b. the next available device: TAB-101 and TAB-102 were just lent, TAB-103 never was, so the
  // pool picks TAB-103 (idle the longest: never lent first, then the lowest tag)
  await admin.goto(`${BASE_URL}/loaners/desk`);
  await admin.getByRole('combobox', { name: 'Lend from' }).click();
  await admin.getByRole('option', { name: POOL_NAME }).click();
  const nextBorrower = admin.getByLabel('Borrower', { exact: true });
  await nextBorrower.fill('S-2008');
  await nextBorrower.press('Enter');
  const nextButton = admin.getByRole('button', { name: 'Lend next available device' });
  // click() waits until the button is enabled, that is until the borrower is chosen
  await nextButton.click();
  await admin.getByTestId('desk-feedback').waitFor();
  await settle(admin, 600);
  await park(admin);
  await shot(
    admin,
    '04-desk-next',
    [deskTitle, admin.getByTestId('desk-feedback'), nextButton, admin.locator('#desk-next-hint')],
    { height: 1500, wide: true },
  );

  // 6. the dashboard and the alerts
  await admin.goto(`${BASE_URL}/loaners`);
  await settle(admin, 1000);
  await park(admin);
  await shot(
    admin,
    '04-dashboard',
    [
      admin.getByRole('heading', { name: 'Loaners', level: 1 }),
      admin.getByRole('table', { name: 'Overdue loans' }),
    ],
    { height: 1500 },
  );
  await admin.goto(`${BASE_URL}/`);
  await settle(admin, 1000);
  await park(admin);
  await shot(
    admin,
    '04-home-overdue',
    [
      admin.getByRole('heading', { name: 'Needs attention' }),
      admin.getByRole('link', { name: 'Overdue loans only' }),
    ],
    { height: 1500 },
  );
  await admin
    .getByRole('button', { name: /Notifications/ })
    .first()
    .click();
  await settle(admin, 600);
  await shot(admin, '04-bell', admin.getByRole('dialog').first(), { pad: 0, height: 800 });
  await admin.keyboard.press('Escape');
};

/** Guide 4, part 3: where each person chooses how loan reminders reach them (changes nothing). */
stages.notifications = async ({ admin }) => {
  await admin.goto(`${BASE_URL}/account/notifications`);
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '04-notification-settings',
    [
      admin.getByRole('heading', { name: 'Notification settings', level: 1 }),
      admin.getByRole('button', { name: 'Save changes' }),
    ],
    { height: 1500, wide: true },
  );
};

/** Guide 5: log a repair, then close it. */
stages.repair = async ({ admin }) => {
  await admin.goto(`${BASE_URL}/repairs`);
  await settle(admin, 800);
  await admin.getByRole('button', { name: 'Log repair' }).first().click();
  const form = admin.getByRole('dialog', { name: 'Log a repair' });
  await form.waitFor();
  const asset = form.getByRole('combobox', { name: /^Asset(?! status)/ });
  await asset.fill('CHR-00006');
  await admin
    .getByRole('option', { name: /CHR-00006/ })
    .first()
    .click();
  await form.getByLabel(/^What needs doing/).fill('Cracked screen, replace');
  await form.getByLabel(/^Details/).fill('Dropped in the corridor. Touch still works.');
  await form.getByRole('combobox', { name: /^Supplier/ }).click();
  await admin.getByRole('option', { name: 'CDW' }).click();
  await form.getByLabel(/^Quoted cost/).fill('85.00');
  await park(admin);
  await shot(admin, '05-repair-form', form, { pad: 4 });
  await form.getByRole('button', { name: 'Log repair' }).click();
  await admin.getByText('Repair logged', { exact: false }).first().waitFor();
  await settle(admin, 600);
  await park(admin);
  await shot(admin, '05-repair-logged', admin.getByRole('dialog'), { pad: 4 });
  await admin.getByRole('button', { name: 'Done' }).click();

  // the asset is not deployable now
  const found = await must(api(admin, 'GET', '/v1/assets?q=CHR-00006'), 'asset');
  const assetId = found.data[0].id;
  await admin.goto(`${BASE_URL}/assets/view?id=${assetId}`);
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '05-asset-in-repair',
    [admin.getByRole('heading', { level: 1 }), admin.getByText('Due back', { exact: true })],
    { height: 900 },
  );

  // the desk refuses it the moment it is scanned, naming its status
  await admin.goto(`${BASE_URL}/loaners/desk`);
  await admin.getByRole('combobox', { name: 'Lend from' }).click();
  await admin.getByRole('option', { name: 'Chromebook cart' }).click();
  const device = admin.getByLabel('Device', { exact: true });
  await device.fill('CHR-00006');
  await device.press('Enter');
  await admin
    .getByText('CHR-00006 is In repair and cannot be lent. Choose another device.')
    .first()
    .waitFor();
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '05-desk-refuses',
    [
      admin.getByRole('heading', { name: 'Loaner desk', level: 1 }),
      admin.getByTestId('desk-feedback'),
    ],
    { height: 1500, wide: true },
  );

  // close the repair
  await admin.goto(`${BASE_URL}/repairs`);
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '05-repairs-list',
    [admin.getByRole('heading', { name: 'Repairs', level: 1 }), admin.locator('table').first()],
    { height: 1100 },
  );
  await admin
    .getByRole('button', { name: /^Open repair Cracked screen, replace$/ })
    .first()
    .click();
  const drawer = admin.getByRole('dialog').first();
  await drawer.waitFor();
  await settle(admin, 600);
  await shot(admin, '05-repair-drawer', drawer, { pad: 0, height: 800 });
  await drawer.getByRole('button', { name: 'Close repair' }).click();
  const close = admin.getByRole('dialog', { name: /^Close repair/ });
  await close.waitFor();
  await close.getByLabel(/^What was done/).fill('Screen replaced and tested.');
  await close.getByLabel(/^Final cost/).fill('79.50');
  await park(admin);
  await shot(admin, '05-repair-close', close, { pad: 4 });
  await close.getByRole('button', { name: 'Close repair' }).click();
  await admin.getByText('Repair closed.').first().waitFor();
  await admin.goto(`${BASE_URL}/assets/view?id=${assetId}`);
  await settle(admin, 800);
  await park(admin);
  await shot(
    admin,
    '05-asset-ready',
    [admin.getByRole('heading', { level: 1 }), admin.getByText('Due back', { exact: true })],
    { height: 900 },
  );
};

/**
 * Accepts the invitation a user was mailed (read from Mailpit), as the invited person would by
 * following the link in the mail. Done in a separate browser context: it signs the invitee in.
 */
async function acceptInvitation(browser, email, name, password) {
  let token = '';
  for (let i = 0; i < 60 && !token; i++) {
    const found = await (
      await fetch(`${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`)
    ).json();
    const message = found.messages?.[0];
    if (message) {
      const full = await (await fetch(`${MAILPIT_URL}/api/v1/message/${message.ID}`)).json();
      const match = /token=([^\s&>"')\]]+)/.exec(full.Text ?? '');
      if (match) token = decodeURIComponent(match[1]);
    }
    if (!token) await sleep(500);
  }
  if (!token) throw new Error(`no invitation mail for ${email} in Mailpit (${MAILPIT_URL})`);
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto(`${BASE_URL}/login`);
    const status = await page.evaluate(
      async ({ token, name, password }) => {
        const res = await fetch('/v1/auth/invitations/accept', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token, password, display_name: name }),
        });
        return res.status;
      },
      { token, name, password },
    );
    if (status !== 200) throw new Error(`accepting the invitation of ${email}: HTTP ${status}`);
  } finally {
    await context.close();
  }
}

/** The Owner (password and authenticator code) is needed for Settings -> Users; sign in once. */
async function ownerPage({ owner }, browser) {
  return owner ?? (await signIn(browser, 'owner@acme.example'));
}

/** Guide 7: people and logins. */
stages.people = async (ctx, browser) => {
  const owner = (ctx.owner = await ownerPage(ctx, browser));
  // Alice is a person already (she holds a laptop). IT makes her a login with a different address
  // than the one on her person record, so the two are not joined automatically.
  const loginEmail = 'alice.j@acme.example';
  await owner.goto(`${BASE_URL}/settings/users`);
  await settle(owner, 800);
  await owner.getByRole('button', { name: 'Invite user' }).click();
  const invite = owner.getByRole('dialog', { name: 'Invite a user' });
  await invite.waitFor();
  await invite.getByLabel(/^Name/).fill('Alice Johansen');
  await invite.getByLabel(/^Email/).fill(loginEmail);
  await choose(owner, /^Role/, 'Technician');
  await park(owner);
  await shot(owner, '07-invite', invite, { pad: 4 });
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await owner.getByText(`Invitation sent to ${loginEmail}.`).first().waitFor();
  // until it is accepted, the login is on the Users tab with a "Pending" badge
  await owner.keyboard.press('Escape');
  await owner.goto(`${BASE_URL}/settings/users`);
  await owner
    .getByRole('row', { name: /Alice Johansen/ })
    .first()
    .waitFor();
  await settle(owner, 800);
  await park(owner);
  await shot(
    owner,
    '07-users-pending',
    [owner.getByRole('heading', { name: 'Users and roles' }), owner.locator('table').first()],
    // wider than the 1280 px window: the Users table needs about 1400 px to show every column
    { height: 1200, wide: true, width: 1500 },
  );
  // Alice follows the link in her mail and chooses a password: now the login is a real one
  await acceptInvitation(browser, loginEmail, 'Alice Johansen', 'Alice-Johansen-Passw0rd-2026');

  // two Alices in the people list: the real one and the empty record the login came with
  await owner.goto(`${BASE_URL}/people`);
  const search = owner.getByPlaceholder('Name, e-mail or number');
  await search.fill('Alice');
  await settle(owner, 1200);
  await park(owner);
  await shot(owner, '07-people-two', [search, owner.locator('table').first()], {
    height: 1200,
    pad: 30,
    width: 1500,
  });

  // link them from the person page
  await owner.getByRole('link', { name: 'Alice Johansen' }).first().click();
  await owner.getByRole('tab', { name: 'Overview' }).waitFor();
  await settle(owner, 800);
  // the first Alice in the list may be the empty one: open the person with the number E-1000
  if (
    !(await owner
      .getByText('E-1000')
      .first()
      .isVisible()
      .catch(() => false))
  ) {
    await owner.goBack();
    await owner.getByRole('link', { name: 'Alice Johansen' }).nth(1).click();
    await owner.getByRole('tab', { name: 'Overview' }).waitFor();
    await settle(owner, 800);
  }
  await park(owner);
  await shot(
    owner,
    '07-person-nologin',
    [
      owner.getByRole('heading', { level: 1 }),
      owner.getByRole('button', { name: 'Link to a login' }),
    ],
    { height: 1200, wide: true },
  );
  await owner.getByRole('button', { name: 'Link to a login' }).click();
  const dialog = owner.getByRole('dialog', { name: /^Link .* to a login$/ });
  await dialog.waitFor();
  await dialog.getByRole('combobox', { name: /^Login account/ }).fill('alice.j');
  // the list shows the email and the roles under each name
  const options = owner.getByRole('listbox');
  await options
    .getByRole('option', { name: /alice\.j@acme\.example/ })
    .first()
    .waitFor();
  await settle(owner, 400);
  await park(owner);
  await shot(owner, '07-link-picker', [dialog, options], { pad: 4 });
  await owner
    .getByRole('option', { name: /alice\.j@acme\.example/ })
    .first()
    .click();
  await settle(owner, 400);
  await park(owner);
  await shot(owner, '07-link-dialog', dialog, { pad: 4 });
  await dialog.getByRole('button', { name: 'Link login' }).click();
  await owner
    .getByText(/is now linked to/)
    .first()
    .waitFor();
  await settle(owner, 800);
  await park(owner);
  await shot(
    owner,
    '07-person-linked',
    [owner.getByRole('heading', { level: 1 }), owner.getByRole('button', { name: 'Unlink login' })],
    { height: 1200, wide: true },
  );

  // Settings -> Users shows the person next to the login
  await owner.goto(`${BASE_URL}/settings/users`);
  await settle(owner, 1000);
  await park(owner);
  await shot(
    owner,
    '07-users-person',
    [owner.getByRole('heading', { name: 'Users and roles' }), owner.locator('table').first()],
    // wider than the 1280 px window: the Users table needs about 1400 px to show every column
    { height: 1200, wide: true, width: 1500 },
  );

  // unlinking: only look at the question, do not confirm
  await owner.goto(`${BASE_URL}/people`);
  await owner.getByPlaceholder('Name, e-mail or number').fill('Alice');
  await settle(owner, 1000);
  await owner.getByRole('link', { name: 'Alice Johansen' }).first().click();
  await owner.getByRole('button', { name: 'Unlink login' }).click();
  const unlink = owner.getByRole('dialog', { name: /^Unlink .* from their login\?$/ });
  await unlink.waitFor();
  await park(owner);
  await shot(owner, '07-unlink-dialog', unlink, { pad: 4 });
  await owner.getByRole('button', { name: 'Cancel' }).click();
};

/** Guide 6: limit a user to a site. */
stages.scope = async (ctx, browser) => {
  const owner = (ctx.owner = await ownerPage(ctx, browser));
  const unplaced = 'Loose charger, not yet placed';
  const cats = await must(api(owner, 'GET', '/v1/categories?kind=asset&limit=1'), 'categories');
  const have = await must(
    api(owner, 'GET', `/v1/assets?q=${encodeURIComponent('Loose charger')}`),
    'assets',
  );
  if (!have.data.length) {
    await must(
      api(owner, 'POST', '/v1/assets', { category_id: cats.data[0].id, name: unplaced }),
      'unplaced asset',
    );
  }

  // the access dialog: Technician for the whole organisation, the only access (cannot be removed)
  const dialog = await openAccess(owner, 'Demo Technician');
  await park(owner);
  await shot(owner, '06-access-dialog', dialog, { pad: 4 });
  // add Technician limited to the Bergen campus, then remove the whole-organisation access
  const add = await addAccess(owner, dialog, 'Demo Technician', 'Technician', 'Bergen campus');
  await park(owner);
  await shot(owner, '06-access-dialog-limited', add, { pad: 4 });
  await add.getByRole('button', { name: 'Add access' }).click();
  await owner.getByText('Access added for Demo Technician.').first().waitFor();
  await dialog.getByText('Technician at Bergen campus').waitFor();
  await dialog.getByRole('button', { name: 'Remove access: Technician', exact: true }).click();
  const confirm = owner.getByRole('dialog', { name: 'Remove this access?' });
  await confirm.waitFor();
  await park(owner);
  await shot(owner, '06-remove-dialog', confirm, { pad: 4 });
  await confirm.getByRole('button', { name: 'Remove' }).click();
  await owner.getByText('Access removed from Demo Technician.').first().waitFor();
  await settle(owner, 600);
  await dialog.getByRole('button', { name: 'Close' }).first().click();
  await settle(owner, 800);
  await park(owner);
  await shot(
    owner,
    '06-users-scoped',
    [owner.getByRole('heading', { name: 'Users and roles' }), owner.locator('table').first()],
    // wider than the 1280 px window: the Users table needs about 1400 px to show every column
    { height: 1200, wide: true, width: 1500 },
  );

  // what the technician sees now
  const tech = await signIn(browser, 'technician@acme.example');
  await tech.goto(`${BASE_URL}/assets`);
  await settle(tech, 1200);
  await park(tech);
  await shot(tech, '06-scoped-assets');
  const search = tech.getByPlaceholder('Tag, serial or name');
  await search.fill('Loose charger');
  await settle(tech, 1200);
  await park(tech);
  await shot(
    tech,
    '06-unplaced-scoped',
    [search, tech.getByText('Try a different search or clear the filters.')],
    { height: 1200, pad: 30, padBottom: 60, wide: true },
  );
  await owner.goto(`${BASE_URL}/assets`);
  await owner.getByPlaceholder('Tag, serial or name').fill('Loose charger');
  await settle(owner, 1200);
  await park(owner);
  await shot(
    owner,
    '06-unplaced-owner',
    [owner.getByPlaceholder('Tag, serial or name'), owner.locator('table').first()],
    { height: 1200, pad: 30, wide: true },
  );

  // the holder of an asset inside the scope is shown, the person is not
  await search.fill('LAP00108');
  await settle(tech, 1200);
  await park(tech);
  await shot(tech, '06-holder-asset', [search, tech.locator('table').first()], {
    height: 1200,
    pad: 30,
    wide: true,
  });
  await tech.goto(`${BASE_URL}/people`);
  const people = tech.getByPlaceholder('Name, e-mail or number');
  await people.fill('Eva Larsen');
  await settle(tech, 1200);
  await park(tech);
  await shot(
    tech,
    '06-holder-people',
    [people, tech.getByText('Try a different search or clear the filters.')],
    { height: 1200, pad: 30, padBottom: 60, wide: true },
  );
  await tech.context().close();

  // undo: add the whole organisation again, then remove the limited access
  const back = await openAccess(owner, 'Demo Technician');
  const whole = await addAccess(owner, back, 'Demo Technician', 'Technician', null);
  await whole.getByRole('button', { name: 'Add access' }).click();
  await owner.getByText('Access added for Demo Technician.').first().waitFor();
  await back.getByRole('button', { name: 'Remove access: Technician', exact: true }).waitFor();
  await settle(owner, 600);
  await park(owner);
  await shot(owner, '06-undo-dialog', back, { pad: 4 });
  await back.getByRole('button', { name: 'Remove access: Technician at Bergen campus' }).click();
  const undo = owner.getByRole('dialog', { name: 'Remove this access?' });
  await undo.getByRole('button', { name: 'Remove' }).click();
  await owner.getByText('Access removed from Demo Technician.').first().waitFor();
};

/** Opens Settings -> Users -> Actions -> Change role and access of a user; returns the dialog. */
async function openAccess(owner, name) {
  await owner.goto(`${BASE_URL}/settings/users`);
  await settle(owner, 1000);
  await owner.getByRole('button', { name: `Actions for ${name}` }).click();
  await owner.getByRole('menuitem', { name: 'Change role and access' }).click();
  const dialog = owner.getByRole('dialog', { name: `Role and access of ${name}` });
  await dialog.waitFor();
  await settle(owner, 400);
  return dialog;
}

/**
 * Presses "Add access" in the access dialog and fills in the role and the access (a location name,
 * or null for the whole organisation). Returns the filled-in "Add access for ..." dialog, unsent.
 */
async function addAccess(owner, dialog, name, role, location) {
  await dialog.getByRole('button', { name: 'Add access' }).click();
  const add = owner.getByRole('dialog', { name: `Add access for ${name}` });
  await add.waitFor();
  await choose(owner, /^Role/, role);
  if (location) {
    await choose(owner, /^Access/, 'Limited to a location');
    // the select hands the focus back to its trigger after it closes: wait, or the typing is lost
    const access = add.getByRole('combobox', { name: /^Access/ });
    for (let i = 0; i < 20; i++) {
      if (await access.evaluate((el) => el === document.activeElement)) break;
      await sleep(100);
    }
    await add.getByRole('combobox', { name: /^Location/ }).fill(location);
    await owner
      .getByRole('option', { name: new RegExp(location) })
      .first()
      .click();
  } else {
    await choose(owner, /^Access/, 'Whole organisation');
  }
  await settle(owner, 300);
  return add;
}

/** Guide 8: schools (K-12). */
stages.k12 = async (ctx, browser) => {
  const admin = ctx.admin;
  // a homeroom is a department: two of them, with a few students each
  const existing = await must(api(admin, 'GET', '/v1/departments?limit=200'), 'departments');
  const ensure = async (name) =>
    existing.data.find((d) => d.name === name) ??
    (await must(api(admin, 'POST', '/v1/departments', { name }), `department ${name}`));
  const room8a = await ensure('Homeroom 8A');
  await ensure('Homeroom 8B');
  const roster = [
    ['Mira Lund', 'S-2101'],
    ['Noah Vik', 'S-2102'],
    ['Olivia Ruud', 'S-2103'],
  ];
  for (const [name, ref] of roster) {
    const found = await must(api(admin, 'GET', `/v1/people?q=${ref}`), ref);
    if (!found.data.length) {
      await must(
        api(admin, 'POST', '/v1/people', {
          display_name: name,
          kind: 'student',
          employee_ref: ref,
          department_id: room8a.id,
          email: `${name.toLowerCase().replace(' ', '.')}@acme.example`,
        }),
        name,
      );
    }
  }
  await admin.goto(`${BASE_URL}/people`);
  await settle(admin, 800);
  await admin.getByRole('combobox', { name: 'Department' }).click();
  await admin.getByRole('option', { name: 'Homeroom 8A' }).click();
  await settle(admin, 1000);
  await park(admin);
  await shot(
    admin,
    '08-people-roster',
    [admin.getByRole('heading', { name: 'People', level: 1 }), admin.locator('table').first()],
    { height: 1200 },
  );

  await admin.getByRole('button', { name: 'Add person' }).first().click();
  const form = admin.getByRole('dialog', { name: 'Add a person' });
  await form.waitFor();
  await form.getByLabel(/^Name/).fill('Pia Aas');
  await choose(admin, /^Kind/, 'Student');
  await form.getByLabel(/^Employee or student number/).fill('S-2104');
  await form.getByRole('combobox', { name: /^Department/ }).click();
  await admin.getByRole('option', { name: 'Homeroom 8A' }).first().click();
  await park(admin);
  await shot(
    admin,
    '08-person-form',
    [
      form.getByRole('heading', { name: 'Add a person' }),
      form.getByText('Choose from the list of departments.'),
    ],
    { pad: 16, wide: false },
  );
  await form.getByRole('button', { name: 'Cancel' }).click();

  // the cart: who may borrow, and no mail to pupils
  const pools = await must(api(admin, 'GET', '/v1/loaner-pools'), 'pools');
  const pool = pools.data.find((p) => p.name === 'Chromebook cart');
  await admin.goto(`${BASE_URL}/loaners/pools`);
  await admin.getByRole('button', { name: 'Edit Chromebook cart' }).click();
  const edit = admin.getByRole('dialog', { name: 'Edit Chromebook cart' });
  await edit.waitFor();
  await edit.getByRole('checkbox', { name: 'Students' }).click();
  await park(admin);
  await shot(
    admin,
    '08-pool-students',
    [
      edit.getByText('Who may borrow', { exact: true }),
      edit.getByRole('combobox', { name: /^E-mail borrowers who have no login/ }),
    ],
    { pad: 16 },
  );
  await edit.getByRole('button', { name: 'Cancel' }).click();
  void pool;
};

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------

const args = process.argv.slice(2);
if (args.includes('--list')) {
  console.log(Object.keys(stages).join('\n'));
  process.exit(0);
}
const onlyArg = args.find((a) => a.startsWith('--only='));
const only = onlyArg ? onlyArg.slice(7).split(',') : Object.keys(stages);

const browser = await chromium.launch({
  channel: process.env.PW_CHANNEL || undefined,
});
const ctx = {};
try {
  log(`Signing in at ${BASE_URL}`);
  ctx.admin = await signIn(browser, 'admin@acme.example');
  for (const name of only) {
    if (!stages[name]) throw new Error(`unknown stage "${name}"`);
    log(`Stage: ${name}`);
    await stages[name](ctx, browser);
  }
} catch (error) {
  // leave a picture of what the browser showed, to see why a step did not find its button
  for (const [who, page] of Object.entries(ctx)) {
    const file = path.join(tmpdir(), `shoot-failure-${who}.png`);
    await page.screenshot({ path: file }).then(
      () => console.error(`Failure screenshot: ${file}`),
      () => {},
    );
  }
  throw error;
} finally {
  await browser.close();
}
const total = taken.reduce((n, t) => n + t.kb, 0);
log(`\n${taken.length} screenshots, ${total} KB in ${path.relative(repoRoot, OUT_DIR)}`);
const big = taken.filter((t) => t.kb > 200);
if (big.length) log(`Over 200 KB: ${big.map((t) => t.name).join(', ')}`);
