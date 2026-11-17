// Catch-all shell experiment for ADR-0002 (kept for reproducibility; not part of the build).
//
//   1. mkdir -p "apps/web/src/app/spike/[[...path]]"
//      cp spikes/web-routing/catchall-page.tsx  "apps/web/src/app/spike/[[...path]]/page.tsx"
//      cp spikes/web-routing/catchall-shell.tsx "apps/web/src/app/spike/[[...path]]/shell.tsx"
//   2. pnpm --filter @assettracker/web exec next build
//   3. PW_CHANNEL=chrome node spikes/web-routing/catchall-experiment.mjs
//   4. rm -r apps/web/src/app/spike
//
// It serves out/ the way a "shell" SPA fallback would (every /spike/** miss returns
// out/spike/index.html) and records what a real browser does on a deep link, a <Link> click,
// router.push, reload and back.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const webDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../apps/web');
const require = createRequire(path.join(webDir, 'package.json'));
const { chromium } = require('@playwright/test');
const out = path.join(webDir, 'out');
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.woff2': 'font/woff2',
};

const requests = [];
const isFile = async (f) => {
  try {
    return (await stat(f)).isFile();
  } catch {
    return false;
  }
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = decodeURIComponent(url.pathname);
  let file = path.join(out, p);
  if (path.extname(p)) {
    if (!(await isFile(file))) {
      requests.push(`404 ${p}`);
      res.writeHead(404).end();
      return;
    }
  } else if (await isFile(path.join(file, 'index.html'))) {
    file = path.join(file, 'index.html');
  } else {
    file = path.join(out, p.startsWith('/spike') ? 'spike/index.html' : '404.html');
  }
  requests.push(`200 ${p}${file.endsWith('index.html') || file.endsWith('404.html') ? '  (html)' : ''}`);
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  res.end(await readFile(file));
});
await new Promise((r) => server.listen(4180, r));

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || undefined });
const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 160)}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 160)}`));

async function snap(label) {
  const pathname = await page.getByTestId('pathname').textContent().catch(() => null);
  const params = await page.getByTestId('params').textContent().catch(() => null);
  console.log(
    `[${label}] url=${page.url().replace('http://localhost:4180', '')} usePathname=${pathname} useParams=${params}`,
  );
  console.log('  console:', logs.splice(0));
}

await page.goto('http://localhost:4180/spike/assets/abc-123');
await page.waitForTimeout(800);
await snap('deep link');

requests.length = 0;
await page.getByTestId('link-xyz').click();
await page.waitForTimeout(1200);
await snap('<Link> click');
console.log('  requests (first 3):', requests.slice(0, 3));

await page.getByTestId('push').click();
await page.waitForTimeout(1200);
await snap('router.push');

await page.reload();
await page.waitForTimeout(800);
await snap('reload');

await page.goBack();
await page.waitForTimeout(800);
await snap('back');

await browser.close();
server.close();
