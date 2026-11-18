#!/usr/bin/env node
// Fails when a vitest JSON report contains skipped or todo tests (M1-CI-02: "ALL env so nothing is skipped").
//
// The database-, SMTP- and admin-backed e2e suites use `describe.skipIf(!env)`: without the right
// environment they silently PASS by skipping. In CI that would be a green build that proved nothing, so
// the integration job runs vitest with `--reporter=json --outputFile.json=<file>` and then this script.
//
//   node scripts/ci/assert-no-skips.mjs apps/api/e2e-direct.json [more.json ...]
//
// Exit code: 0 nothing skipped, 1 skipped/todo/failed tests or no tests at all, 2 usage error.

import { readFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: assert-no-skips.mjs <vitest-report.json> [...]');
  process.exit(2);
}

let bad = 0;
for (const file of files) {
  const report = JSON.parse(readFileSync(file, 'utf8'));
  const notRun = [];
  for (const suite of report.testResults ?? []) {
    for (const t of suite.assertionResults ?? []) {
      if (t.status !== 'passed') notRun.push(`${t.status}: ${t.fullName}`);
    }
  }
  const total = report.numTotalTests ?? 0;
  console.log(
    `${file}: ${report.numPassedTests}/${total} passed, ${report.numPendingTests} skipped, ${report.numTodoTests} todo, ${report.numFailedTests} failed`,
  );
  if (total === 0) {
    console.error(`  no tests ran`);
    bad++;
  }
  if (notRun.length > 0) {
    for (const line of notRun.slice(0, 30)) console.error(`  ${line}`);
    if (notRun.length > 30) console.error(`  ... and ${notRun.length - 30} more`);
    bad++;
  }
}
if (bad > 0) {
  console.error(
    'Some tests did not run. Check the job environment: DATABASE_URL, MIGRATOR_DATABASE_URL, ADMIN_DATABASE_URL, ISOLATION_MODE, POOLED_ONE_URL (pooled), SMTP_URL and MAILPIT_API_URL.',
  );
  process.exit(1);
}
console.log('no skipped tests');
