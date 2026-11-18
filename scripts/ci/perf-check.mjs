#!/usr/bin/env node
// Performance budget check (M1-CI-05). Dependency-free: Node >= 22 (global fetch), no npm install.
//
// Drives a RUNNING stack (docker compose, see scripts/ci/compose-smoke.sh) with N concurrent
// connections for D seconds per endpoint, computes p50/p95/p99 and fails when an endpoint breaches the
// p95 budget in scripts/ci/perf-budgets.json or exceeds its error-rate limit.
//
//   node scripts/ci/perf-check.mjs                          # defaults below
//   PERF_BASE_URL=http://127.0.0.1:3130 PERF_DURATION=10 node scripts/ci/perf-check.mjs
//
// Environment (all optional):
//   PERF_BASE_URL         API base URL                                  (default http://127.0.0.1:3000)
//   PERF_DURATION         seconds of load per endpoint                  (default 10)
//   PERF_CONNECTIONS      concurrent connections                        (default 10)
//   PERF_WARMUP           warm-up requests per endpoint, not measured   (default 20)
//   PERF_BUDGET_SCALE     multiplies every p95 budget (slow laptop: 2)  (default 1)
//   PERF_EMAIL/PASSWORD   login for authenticated endpoints             (default viewer@acme.example / demo password)
//   PERF_REQUIRE_REGISTRY 1 = a `requires: registry` endpoint that cannot run is a FAILURE (default 0: skipped)
//   PERF_BUDGETS          budgets file                                  (default scripts/ci/perf-budgets.json)
//   PERF_OUT              results JSON path                             (default perf-results.json)
//   PERF_SEARCH_TERM / PERF_ASSET_TAG   override the values derived from the first listed asset
//   GITHUB_STEP_SUMMARY   when set, a Markdown table is appended (the CI job summary = the trend record)
//
// The seed size (2 x 50,000 assets) is the job's responsibility (M1-CI-05 seeds before calling this
// script); the script only reports what it measured and which tenant it measured it as.

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const env = process.env;
const num = (name, dflt) => {
  const v = Number(env[name]);
  return Number.isFinite(v) && env[name] !== '' && env[name] !== undefined ? v : dflt;
};

const BASE = (env.PERF_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');
const DURATION_S = num('PERF_DURATION', 10);
const CONNECTIONS = num('PERF_CONNECTIONS', 10);
const WARMUP = num('PERF_WARMUP', 20);
const SCALE = num('PERF_BUDGET_SCALE', 1);
const REQUIRE_REGISTRY = env.PERF_REQUIRE_REGISTRY === '1';
const EMAIL = env.PERF_EMAIL ?? 'viewer@acme.example';
// Dev/demo password of the seed (apps/api/src/auth/demo-credentials.ts). Not a secret.
const PASSWORD = env.PERF_PASSWORD ?? 'Demo-Passw0rd-2026';
const BUDGETS_FILE = resolve(env.PERF_BUDGETS ?? resolve(here, 'perf-budgets.json'));
const OUT = resolve(env.PERF_OUT ?? 'perf-results.json');

function percentile(sorted, p) {
  if (sorted.length === 0) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}
const round = (n) => (Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

/** Logs in and returns a Cookie header value, or null when the login is not possible. */
async function login() {
  const res = await fetch(`${BASE}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.status !== 'authenticated') {
    console.warn(
      `[perf] login as ${EMAIL} failed: HTTP ${res.status} ${body.status ?? body.code ?? ''}`,
    );
    return null;
  }
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]);
  return cookies.join('; ');
}

/** Pulls the first item out of a list response, whatever the envelope is called. */
function firstItem(body) {
  const list = Array.isArray(body) ? body : (body?.data ?? body?.items ?? body?.results);
  return Array.isArray(list) && list.length > 0 ? list[0] : null;
}

async function request(path, cookie) {
  return fetch(`${BASE}${path}`, {
    headers: cookie ? { cookie, accept: 'application/json' } : { accept: 'application/json' },
  });
}

async function runLoad(path, cookie) {
  for (let i = 0; i < WARMUP; i++) await (await request(path, cookie)).arrayBuffer();
  const latencies = [];
  let errors = 0;
  const statuses = {};
  const deadline = performance.now() + DURATION_S * 1000;
  const started = performance.now();
  await Promise.all(
    Array.from({ length: CONNECTIONS }, async () => {
      while (performance.now() < deadline) {
        const t0 = performance.now();
        try {
          const res = await request(path, cookie);
          await res.arrayBuffer();
          latencies.push(performance.now() - t0);
          statuses[res.status] = (statuses[res.status] ?? 0) + 1;
          if (!res.ok) errors++;
        } catch {
          errors++;
          statuses.network = (statuses.network ?? 0) + 1;
        }
      }
    }),
  );
  const elapsed = (performance.now() - started) / 1000;
  latencies.sort((a, b) => a - b);
  const total = latencies.length + (statuses.network ?? 0);
  return {
    requests: total,
    errors,
    errorRate: total === 0 ? 1 : errors / total,
    rps: round(total / elapsed),
    p50: round(percentile(latencies, 50)),
    p95: round(percentile(latencies, 95)),
    p99: round(percentile(latencies, 99)),
    max: round(latencies.at(-1)),
    statuses,
  };
}

const budgets = JSON.parse(readFileSync(BUDGETS_FILE, 'utf8'));
const results = [];
let failed = false;

console.log(
  `[perf] ${BASE}  connections=${CONNECTIONS} duration=${DURATION_S}s per endpoint  scale=${SCALE}  tenant user=${EMAIL}`,
);

let cookie = null;
let cookieTried = false;
const context = { searchTerm: env.PERF_SEARCH_TERM ?? '', assetTag: env.PERF_ASSET_TAG ?? '' };
let registryProbed = false;

for (const ep of budgets.endpoints) {
  const budget = ep.p95Ms * SCALE;
  const base = { name: ep.name, path: ep.path, budgetP95Ms: budget, requires: ep.requires };
  const skip = (reason) => {
    const status = ep.requires && REQUIRE_REGISTRY ? 'fail' : 'skipped';
    if (status === 'fail') failed = true;
    results.push({ ...base, status, reason });
    console.log(`[perf] ${ep.name.padEnd(13)} ${status.toUpperCase()}: ${reason}`);
  };

  if (ep.auth && !cookieTried) {
    cookieTried = true;
    cookie = await login();
  }
  if (ep.auth && !cookie) {
    skip('no authenticated session (is the demo seed on? SEED_DEMO_DATA=true)');
    continue;
  }

  // Registry endpoints: probe once. 404/405 = the route has not landed yet.
  if (ep.requires === 'registry' && !registryProbed) {
    registryProbed = true;
    const probe = await request('/v1/assets?limit=1', cookie);
    const body = await probe.json().catch(() => null);
    if (probe.status === 404 || probe.status === 405) {
      context.registryMissing = true;
    } else if (probe.ok) {
      const item = firstItem(body);
      if (item) {
        context.assetTag ||= String(item.asset_tag ?? item.tag ?? '');
        context.searchTerm ||= String(item.asset_tag ?? item.tag ?? item.name ?? '');
      }
    } else {
      context.registryMissing = true;
      context.registryReason = `GET /v1/assets answered ${probe.status}`;
    }
  }
  if (ep.requires === 'registry' && context.registryMissing) {
    skip(
      context.registryReason ?? 'asset registry not available yet (GET /v1/assets is not served)',
    );
    continue;
  }

  const placeholders = [...ep.path.matchAll(/\{\{(\w+)\}\}/g)].map((x) => x[1]);
  if (placeholders.some((k) => !context[k])) {
    skip(`no seeded asset to derive ${placeholders.join(', ')} from`);
    continue;
  }
  const path = ep.path.replace(/\{\{(\w+)\}\}/g, (_, k) => encodeURIComponent(context[k]));

  const m = await runLoad(path, ep.auth ? cookie : null);
  const maxErr = ep.maxErrorRate ?? 0;
  const breaches = [];
  if (!(m.p95 <= budget)) breaches.push(`p95 ${m.p95} ms > budget ${budget} ms`);
  if (m.errorRate > maxErr)
    breaches.push(
      `error rate ${(m.errorRate * 100).toFixed(2)}% > ${maxErr * 100}% (${JSON.stringify(m.statuses)})`,
    );
  const status = breaches.length ? 'fail' : 'pass';
  if (status === 'fail') failed = true;
  results.push({ ...base, status, path, ...m, breaches });
  console.log(
    `[perf] ${ep.name.padEnd(13)} ${status.toUpperCase()}  p50=${m.p50} p95=${m.p95} p99=${m.p99} max=${m.max} ms  ${m.rps} req/s  n=${m.requests} err=${m.errors}  (budget p95 ${budget} ms)` +
      (breaches.length ? `\n[perf]   ${breaches.join('; ')}` : ''),
  );
}

const report = {
  timestamp: new Date().toISOString(),
  sha: env.GITHUB_SHA ?? env.GIT_SHA ?? null,
  baseUrl: BASE,
  connections: CONNECTIONS,
  durationSeconds: DURATION_S,
  budgetScale: SCALE,
  user: EMAIL,
  node: process.version,
  results,
};
writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`[perf] wrote ${OUT}`);

if (env.GITHUB_STEP_SUMMARY) {
  const rows = results.map((r) =>
    r.status === 'skipped'
      ? `| ${r.name} | skipped | | | | ${r.budgetP95Ms} | ${r.reason} |`
      : `| ${r.name} | ${r.status} | ${r.p50 ?? ''} | ${r.p95 ?? ''} | ${r.p99 ?? ''} | ${r.budgetP95Ms} | ${r.rps ?? ''} req/s, ${r.errors ?? 0} errors |`,
  );
  appendFileSync(
    env.GITHUB_STEP_SUMMARY,
    [
      `### Performance budgets (${report.timestamp}, ${CONNECTIONS} connections, ${DURATION_S}s each)`,
      '',
      '| Endpoint | Result | p50 ms | p95 ms | p99 ms | p95 budget ms | Notes |',
      '|---|---|---|---|---|---|---|',
      ...rows,
      '',
    ].join('\n'),
  );
}

if (failed) {
  console.error(
    '[perf] FAILED: at least one budget was breached or a required endpoint could not run',
  );
  process.exit(1);
}
console.log('[perf] OK');
