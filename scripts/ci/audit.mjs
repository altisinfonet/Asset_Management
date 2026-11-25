#!/usr/bin/env node
// Dependency audit with an expiring allow-list (M1-CI-03, SCA).
//
//   node scripts/ci/audit.mjs                 # fails on high/critical advisories that are not allow-listed
//   AUDIT_LEVEL=moderate node scripts/ci/audit.mjs
//   AUDIT_ALLOWLIST=path.json node scripts/ci/audit.mjs
//
// Runs `pnpm audit --json` (the npm audit endpoint), then:
//   - fails on every advisory at or above AUDIT_LEVEL (default high) that has no allow-list entry;
//   - fails on an allow-list entry whose `expires` date has passed, or that has no reason / expiry, or
//     whose expiry is more than 90 days after `added` (exceptions must be temporary);
//   - warns about entries that no longer match an advisory (delete them);
//   - ALWAYS fails on a production-reachable advisory at critical severity, allow-list or not.
// Node >= 22, no dependencies. Exit code: 0 clean, 1 findings, 2 audit could not run.

import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const ORDER = ['info', 'low', 'moderate', 'high', 'critical'];
const level = process.env.AUDIT_LEVEL ?? 'high';
if (!ORDER.includes(level)) {
  console.error(`AUDIT_LEVEL must be one of ${ORDER.join(', ')}`);
  process.exit(2);
}
const allowFile = resolve(
  process.env.AUDIT_ALLOWLIST ?? resolve(here, '../../.github/security/audit-allowlist.json'),
);
const today = new Date().toISOString().slice(0, 10);
const MAX_DAYS = 90;
const DAY = 86_400_000;

const problems = [];
const warnings = [];

// ---- allow-list
const allow = JSON.parse(readFileSync(allowFile, 'utf8')).entries ?? [];
for (const e of allow) {
  const label = e.id ?? '(entry without id)';
  if (!e.id || !e.reason || !e.expires) {
    problems.push(`allow-list entry ${label}: id, reason and expires are required`);
    continue;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.expires)) {
    problems.push(`allow-list entry ${label}: expires must be YYYY-MM-DD`);
    continue;
  }
  if (e.expires < today) {
    problems.push(
      `allow-list entry ${label} EXPIRED on ${e.expires}: fix the dependency or renew the entry with a new review`,
    );
  }
  if (e.added) {
    const days = (Date.parse(e.expires) - Date.parse(e.added)) / DAY;
    if (days > MAX_DAYS)
      problems.push(
        `allow-list entry ${label}: expiry is ${Math.round(days)} days after it was added (max ${MAX_DAYS})`,
      );
  }
}

// ---- audit
// Command and arguments are passed separately: without a shell (Linux, macOS) a single
// 'pnpm audit --json' string is looked up as one executable name and fails with ENOENT.
const run = spawnSync('pnpm', ['audit', '--json'], {
  encoding: 'utf8',
  shell: process.platform === 'win32',
  maxBuffer: 64 * 1024 * 1024,
});
let report;
try {
  report = JSON.parse(run.stdout);
} catch {
  console.error('pnpm audit did not return JSON (registry unreachable?)');
  console.error(run.error?.message || run.stderr || run.stdout);
  process.exit(2);
}
const advisories = Object.entries(report.advisories ?? {}).map(([npmId, a]) => ({
  npmId,
  ghsa: a.github_advisory_id,
  pkg: a.module_name,
  severity: a.severity,
  title: a.title,
  patched: a.patched_versions,
  vulnerable: a.vulnerable_versions,
  prod: (a.findings ?? []).some((f) => !f.dev),
  versions: [...new Set((a.findings ?? []).map((f) => f.version))],
}));

const matched = new Set();
const lines = [];
for (const a of advisories) {
  const gated = ORDER.indexOf(a.severity) >= ORDER.indexOf(level);
  const entry = allow.find((e) => e.id === a.ghsa || e.id === a.npmId);
  const expired = entry && entry.expires < today;
  if (entry) matched.add(entry.id);
  let state;
  if (!gated) state = 'below threshold';
  else if (a.severity === 'critical' && a.prod) {
    state = 'FAIL (critical in production deps: not allow-listable)';
    problems.push(
      `${a.ghsa ?? a.npmId} ${a.pkg}@${a.versions.join(',')} is critical and reachable from production dependencies: ${a.title}`,
    );
  } else if (entry && !expired) state = `allow-listed until ${entry.expires}`;
  else {
    state = 'FAIL';
    problems.push(
      `${a.ghsa ?? a.npmId} ${a.severity} ${a.pkg}@${a.versions.join(',')} (${a.prod ? 'production' : 'dev only'}): ${a.title}; patched: ${a.patched ?? 'none'}`,
    );
  }
  lines.push(
    `${a.severity.padEnd(8)} ${a.pkg}@${a.versions.join(',')} ${a.ghsa ?? a.npmId} ${a.prod ? 'prod' : 'dev'}  ${state}`,
  );
}
for (const e of allow) {
  if (e.id && !matched.has(e.id))
    warnings.push(`allow-list entry ${e.id} matches no current advisory: delete it`);
}

const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `pnpm audit: ${advisories.length} advisories ${JSON.stringify(counts)} over ${report.metadata?.totalDependencies ?? '?'} dependencies; gate = ${level} and above`,
);
for (const l of lines) console.log(`  ${l}`);
for (const w of warnings) console.warn(`warning: ${w}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(
    process.env.GITHUB_STEP_SUMMARY,
    [
      `### Dependency audit (gate: ${level}+)`,
      '',
      ...(lines.length ? lines.map((l) => `- \`${l}\``) : ['No advisories.']),
      ...warnings.map((w) => `- warning: ${w}`),
      '',
    ].join('\n'),
  );
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('audit OK');
