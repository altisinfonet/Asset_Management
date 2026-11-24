// Refreshes the generated sections of docs/API.md from docs/engineering/openapi.yaml.
//
//   node docs/engineering/tools/gen-api-md.mjs            rewrite docs/API.md in place
//   node docs/engineering/tools/gen-api-md.mjs --check    exit 1 when docs/API.md is stale (no write)
//   node docs/engineering/tools/gen-api-md.mjs --spec <openapi.yaml> --out <API.md>
//
// Only the text between these marker pairs is replaced; everything else in API.md is hand-written:
//   <!-- api-catalogue:start --> ... <!-- api-catalogue:end -->     endpoint catalogue by tag
//   <!-- problem-codes:start --> ... <!-- problem-codes:end -->     problem-code catalogue
//
// Needs the `yaml` package (the same one gen.mjs uses). If `import 'yaml'` fails inside the monorepo,
// install it outside the repository and point YAML_DIR at that folder:
//   mkdir ../yaml-tmp && cd ../yaml-tmp && npm init -y && npm i yaml
//   YAML_DIR=/path/to/yaml-tmp node docs/engineering/tools/gen-api-md.mjs
// Run it after every contract change (gen.mjs first, then this script). The tables are written already
// padded the way Prettier pads them, so no formatting step is needed (docs/ is excluded from Prettier).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? path.resolve(args[i + 1]) : fallback;
};
const SPEC = opt('--spec', path.resolve(here, '../openapi.yaml'));
const OUT = opt('--out', path.resolve(here, '../../API.md'));

async function loadYaml() {
  try {
    return (await import('yaml')).default;
  } catch {
    if (process.env.YAML_DIR) {
      const req = createRequire(path.join(path.resolve(process.env.YAML_DIR), 'x.js'));
      return req('yaml');
    }
    console.error(
      "Cannot load the 'yaml' package. Install it outside the repository and set YAML_DIR (see the header of this script).",
    );
    process.exit(2);
  }
}
const YAML = await loadYaml();

// Tags that are in the contract but have no routes in the running API yet. Edit this list when one
// ships (the route-rules test requires every other tag to be implemented). Value = where it lands.
const CONTRACT_ONLY = {
  Loaners: 'planned for M2 wave 3, stories LOAN-01..04',
  Imports: 'planned for M2 wave 3, stories IMP-01..09',
  Audit: 'planned for M5 with the audit log screen, story AUD-01',
};
// Problem codes that the running API does not emit yet (their feature is contract only).
const CODES_NOT_EMITTED = new Set(['no-loaner-available', 'import-stale-dry-run']);

const METHOD_ORDER = ['get', 'post', 'put', 'patch', 'delete'];
const doc = YAML.parse(fs.readFileSync(SPEC, 'utf8'));
const tags = (doc.tags ?? []).map((t) => t.name);
const tagText = Object.fromEntries((doc.tags ?? []).map((t) => [t.name, t.description ?? '']));
const esc = (s) =>
  String(s ?? '')
    .replace(/\|/g, '\\|')
    .replace(/\s*\n\s*/g, ' ')
    .trim();

/** Markdown table padded like Prettier does (so the raw file stays readable). */
function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, 3, ...rows.map((r) => r[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  return [line(headers), `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`, ...rows.map(line)];
}

function permissionOf(op) {
  if (op['x-permission']) {
    const base = `\`${op['x-permission']}\``;
    return op['x-permission-by-type'] ? `${base} (per type, see schema)` : base;
  }
  if (op['x-self-service']) return 'signed in (browser session)';
  if (Array.isArray(op.security) && op.security.length === 0) return 'public';
  return 'signed in';
}

function requiresOf(op) {
  const out = [];
  const refs = (op.parameters ?? []).map((p) => p.$ref ?? '');
  if (refs.some((r) => r.endsWith('/IfMatch'))) out.push('If-Match');
  if (refs.some((r) => r.endsWith('/IdempotencyKeyRequired'))) out.push('Idempotency-Key');
  return out.join(', ');
}

// ---------------------------------------------------------------- endpoint catalogue
const ops = [];
for (const [p, item] of Object.entries(doc.paths ?? {})) {
  for (const m of METHOD_ORDER) {
    const op = item[m];
    if (!op) continue;
    ops.push({
      method: m.toUpperCase(),
      path: p,
      tag: (op.tags ?? ['Other'])[0],
      summary: op.summary ?? op.operationId ?? '',
      permission: permissionOf(op),
      requires: requiresOf(op),
    });
  }
}
const pathCount = Object.keys(doc.paths ?? {}).length;
const byTag = new Map();
for (const t of [...tags, 'Other']) byTag.set(t, []);
for (const o of ops) (byTag.get(o.tag) ?? byTag.set(o.tag, []).get(o.tag)).push(o);

const catalogue = [];
catalogue.push(
  `Generated from \`docs/engineering/openapi.yaml\` (contract version \`${doc.info?.version}\`): **${ops.length} operations on ${pathCount} paths in ${tags.length} tags**. Paths are shown as served, with the \`/v1\` prefix.`,
  '',
  '"Requires" lists headers that are mandatory for that operation beyond the credential: `If-Match` (stale or missing gives `412` / `428`) and `Idempotency-Key` (missing gives `400 idempotency-key-required`).',
  '',
);
for (const [tag, list] of byTag) {
  if (list.length === 0) continue;
  list.sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      METHOD_ORDER.indexOf(a.method.toLowerCase()) - METHOD_ORDER.indexOf(b.method.toLowerCase()),
  );
  catalogue.push(`### ${tag}`, '');
  if (CONTRACT_ONLY[tag]) {
    catalogue.push(
      `> **Contract only (${CONTRACT_ONLY[tag]}).** These operations are specified in the contract but have no routes in the running API yet.`,
      '',
    );
  }
  if (tagText[tag]) catalogue.push(`${tagText[tag]}`, '');
  catalogue.push(
    ...table(
      ['Method', 'Path', 'Permission', 'Requires', 'Purpose'],
      list.map((o) => [
        o.method,
        `\`${o.path}\``,
        o.permission,
        esc(o.requires) || '-',
        esc(o.summary),
      ]),
    ),
    '',
  );
}

// ---------------------------------------------------------------- problem codes
const codes = Object.entries(doc['x-problem-codes'] ?? {});
codes.sort(([a, x], [b, y]) => Math.min(...x.status) - Math.min(...y.status) || a.localeCompare(b));
const problems = [
  `Generated from the root \`x-problem-codes\` of the contract: **${codes.length} codes**. Branch on \`code\`, not on the title; the set grows over time.`,
  '',
  ...table(
    ['Status', 'Code', 'Meaning'],
    codes.map(([code, v]) => [
      v.status.join(' / '),
      `\`${code}\``,
      esc(v.description) +
        (CODES_NOT_EMITTED.has(code) ? ' _(emitted once the feature ships)_' : ''),
    ]),
  ),
  '',
];

// ---------------------------------------------------------------- splice into API.md
function splice(text, name, body) {
  const start = `<!-- ${name}:start -->`;
  const end = `<!-- ${name}:end -->`;
  const i = text.indexOf(start);
  const j = text.indexOf(end);
  if (i < 0 || j < 0 || j < i) {
    console.error(`Markers ${start} / ${end} not found in ${OUT}`);
    process.exit(2);
  }
  return `${text.slice(0, i + start.length)}\n\n${body.join('\n').trimEnd()}\n\n${text.slice(j)}`;
}

const current = fs.readFileSync(OUT, 'utf8');
let next = splice(current, 'api-catalogue', catalogue);
next = splice(next, 'problem-codes', problems);

if (flag('--check')) {
  if (current !== next) {
    console.error('docs/API.md is stale: run node docs/engineering/tools/gen-api-md.mjs');
    process.exit(1);
  }
  console.log('docs/API.md is up to date');
} else {
  fs.writeFileSync(OUT, next);
  console.log(
    `API.md updated: ${ops.length} operations, ${pathCount} paths, ${codes.length} problem codes`,
  );
}
