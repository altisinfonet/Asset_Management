#!/usr/bin/env node
// M2-OPS-01: prints the in-process performance results of the API (apps/api/test-results/*-perf.json,
// written by the vitest perf suites) as a Markdown table, and appends it to the GitHub job summary when
// GITHUB_STEP_SUMMARY is set. Dependency-free; a missing file is reported, not an error (the vitest step
// already failed the job if a suite did not run).
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? join('apps', 'api', 'test-results');
const read = (name) => {
  const file = join(dir, name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
};

const lines = ['### In-process budgets (apps/api/test/perf, PERF=1)', ''];
const registry = read('registry-perf.json');
if (registry) {
  lines.push(
    `Registry, custody, search and scoped access on ${registry.perTenant.toLocaleString('en')} assets x 2 tenants ` +
      `(budgets ms: ${Object.entries(registry.budgetsMs)
        .map(([k, v]) => `${k} ${v}`)
        .join(', ')}; ${registry.enforced ? 'enforced' : 'recorded only'})`,
    '',
    '| Measurement | p50 ms | p95 ms | p99 ms | max ms |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...registry.stats.map((s) => `| ${s.name} | ${s.p50} | ${s.p95} | ${s.p99} | ${s.max} |`),
    '',
  );
} else lines.push('registry-perf.json: not written', '');
const labels = read('labels-perf.json');
if (labels) {
  lines.push(
    `Label PDF: ${labels.labels} labels, ${labels.runs.length} runs: p50 ${labels.p50} ms, p95 ${labels.p95} ms, max ${labels.max} ms (budget ${labels.budgetMs} ms, ${labels.enforced ? 'enforced' : 'recorded only'})`,
    '',
  );
} else lines.push('labels-perf.json: not written', '');
const imports = read('import-perf.json');
if (imports) {
  lines.push(
    `Import: ${Object.entries(imports)
      .map(([k, v]) => `${k} ${typeof v === 'number' ? v.toLocaleString('en') : JSON.stringify(v)}`)
      .join(', ')}`,
    '',
  );
} else lines.push('import-perf.json: not written', '');
const corpus = read('import-corpus-perf.json');
if (corpus) {
  lines.push(
    `Import, messy corpus file (M2-IMP-09): ${Object.entries(corpus)
      .map(([k, v]) => `${k} ${typeof v === 'number' ? v.toLocaleString('en') : JSON.stringify(v)}`)
      .join(', ')}`,
    '',
  );
} else lines.push('import-corpus-perf.json: not written', '');

const text = `${lines.join('\n')}\n`;
process.stdout.write(text);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, text);
