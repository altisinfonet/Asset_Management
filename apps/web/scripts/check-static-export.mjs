#!/usr/bin/env node
// @ts-check
/**
 * CI gate for the static-export constraints. Fails (exit 1) when a forbidden feature is used.
 *
 *   node scripts/check-static-export.mjs            pre-build: source scan + production config
 *   node scripts/check-static-export.mjs --built    post-build: out/ exists, no emitted rewrites/headers/middleware
 *   node scripts/check-static-export.mjs --root DIR check another app root (used by the unit tests)
 *
 * Wired into `pnpm build` so a violation fails the web build. Rules: src/lib/static-export-check.test.ts
 * and docs/adr/0002-web-routing-static-export.md.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkBuilt, checkConfig, checkMockEnv, scanSource } from './lib/static-export-check.mjs';

const args = process.argv.slice(2);
const rootIdx = args.indexOf('--root');
const appRoot = path.resolve(
  rootIdx >= 0
    ? (args[rootIdx + 1] ?? '.')
    : path.join(path.dirname(fileURLToPath(import.meta.url)), '..'),
);

const built = args.includes('--built');
const { violations: sourceViolations, usesNextImage } = scanSource(appRoot);
const violations = built
  ? checkBuilt(appRoot)
  : [
      ...sourceViolations,
      ...checkMockEnv(process.env),
      ...(await checkConfig(appRoot, usesNextImage)),
    ];

if (violations.length > 0) {
  console.error(`static-export check FAILED (${built ? 'built output' : 'source'}):`);
  for (const v of violations) console.error(`  [${v.rule}] ${v.file ?? ''} ${v.message}`);
  process.exit(1);
}
console.log(`static-export check passed (${built ? 'built output' : 'source and config'})`);
