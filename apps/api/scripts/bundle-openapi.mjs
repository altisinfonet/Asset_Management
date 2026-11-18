// Bundles docs/engineering/openapi.yaml (the contract, source of truth) into
// apps/api/openapi.generated.json, which the API serves at GET /v1/openapi.json and ships in the
// image (package.json "files"). The document is self-contained (no external $ref), so bundling is a
// YAML -> JSON conversion plus a sanity check that every internal $ref resolves.
//
//   node scripts/bundle-openapi.mjs
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import yaml from 'js-yaml';

const apiRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OPENAPI_SOURCE = join(apiRoot, '..', '..', 'docs', 'engineering', 'openapi.yaml');
export const OPENAPI_BUNDLE = join(apiRoot, 'openapi.generated.json');

function dangling(doc) {
  const missing = new Set();
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (node && typeof node === 'object') {
      for (const [k, v] of Object.entries(node)) {
        if (k === '$ref' && typeof v === 'string' && v.startsWith('#/')) {
          let cur = doc;
          for (const part of v.slice(2).split('/'))
            cur = cur?.[part.replace(/~1/g, '/').replace(/~0/g, '~')];
          if (cur === undefined) missing.add(v);
        } else visit(v);
      }
    }
  };
  visit(doc);
  return [...missing];
}

export function bundleOpenApi() {
  const doc = yaml.load(readFileSync(OPENAPI_SOURCE, 'utf8'));
  if (!doc || doc.openapi !== '3.1.0' || !doc.paths) {
    throw new Error(`${OPENAPI_SOURCE} is not an OpenAPI 3.1 document`);
  }
  const missing = dangling(doc);
  if (missing.length > 0) throw new Error(`unresolved $ref in the contract: ${missing.join(', ')}`);
  mkdirSync(dirname(OPENAPI_BUNDLE), { recursive: true });
  writeFileSync(OPENAPI_BUNDLE, `${JSON.stringify(doc)}\n`);
  console.log(`openapi: bundled ${Object.keys(doc.paths).length} paths -> ${OPENAPI_BUNDLE}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) bundleOpenApi();
