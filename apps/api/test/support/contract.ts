/**
 * Test-only helper: reads docs/engineering/openapi.yaml (the contract) so tests can walk every
 * operation. Never imported by application code.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import type { AccessRule } from '../../src/auth/access.js';

export interface ContractOperation {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete';
  /** OpenAPI path template, e.g. `/v1/users/{id}`. */
  path: string;
  operationId: string;
  tag: string;
  /** `security: []` in the contract: callable without a credential. */
  public: boolean;
  permission: string | null;
  selfService: boolean;
  /** HTTP status codes the operation documents. */
  statuses: number[];
  /** `$ref` target (schema name) of the JSON body of each documented status, when there is one. */
  responseSchemas: Record<number, string>;
}

const CONTRACT = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'docs',
  'engineering',
  'openapi.yaml',
);

interface RawOperation {
  operationId: string;
  tags?: string[];
  security?: unknown[];
  'x-permission'?: string;
  'x-self-service'?: boolean;
  responses?: Record<
    string,
    { content?: Record<string, { schema?: { $ref?: string } }>; $ref?: string }
  >;
}

export interface RawDocument {
  paths: Record<string, Record<string, RawOperation>>;
  components: {
    schemas: Record<string, unknown>;
    responses?: Record<string, { content?: Record<string, { schema?: { $ref?: string } }> }>;
  };
  'x-problem-codes': Record<string, { status: number[] }>;
}

let cached: RawDocument | undefined;
export function loadDocument(): RawDocument {
  cached ??= yaml.load(readFileSync(CONTRACT, 'utf8')) as RawDocument;
  return cached;
}

export function loadContract(): { operations: ContractOperation[]; permissions: string[] } {
  const doc = loadDocument();
  const operations: ContractOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[method];
      if (!op) continue;
      const responseSchemas: Record<number, string> = {};
      for (const [code, response] of Object.entries(op.responses ?? {})) {
        const schema =
          response.content?.['application/json']?.schema?.$ref ??
          (response.$ref
            ? doc.components.responses?.[response.$ref.split('/').pop()!]?.content?.[
                'application/json'
              ]?.schema?.$ref
            : undefined);
        if (schema) responseSchemas[Number(code)] = schema.split('/').pop()!;
      }
      operations.push({
        method,
        path,
        operationId: op.operationId,
        tag: op.tags?.[0] ?? '',
        public: Array.isArray(op.security) && op.security.length === 0,
        permission: op['x-permission'] ?? null,
        selfService: op['x-self-service'] === true,
        statuses: Object.keys(op.responses ?? {}).map(Number),
        responseSchemas,
      });
    }
  }
  const permissions = [
    ...new Set(operations.flatMap((o) => (o.permission ? [o.permission] : []))),
  ].sort();
  return { operations, permissions };
}

/** The access rule the contract implies for an operation (what a controller must declare). */
export function ruleOf(op: ContractOperation): AccessRule {
  if (op.public) return { kind: 'public' };
  if (op.permission) return { kind: 'permission', permission: op.permission };
  if (op.selfService) return { kind: 'self-service' };
  return { kind: 'authenticated' };
}

/** The contract's root `x-problem-codes` catalogue: code -> HTTP statuses it can carry. */
export function loadProblemCodes(): Record<string, number[]> {
  const doc = loadDocument();
  return Object.fromEntries(
    Object.entries(doc['x-problem-codes']).map(([code, v]) => [code, v.status]),
  );
}

/**
 * Operations under the registry tags that are not built yet: the route tests treat them as "not
 * yet", everything else under the registry tags is required. M2 wave 1 (custody, history,
 * assignments) implemented the five operations that used to be listed here; a later M2 wave that
 * adds operations to a registry tag lists them here until they land.
 */
export const M2_OPERATIONS = new Set<string>();

/** Tags whose operations the registry module (M1-REG) owns. */
export const REGISTRY_TAGS = new Set([
  'Assets',
  'Search',
  'Categories',
  'Manufacturers',
  'Models',
  'Custom fields',
  'Status labels',
  'Vendors',
]);

/**
 * Tags of M2 wave 1 (locations, people, custody): every operation under them has a route, and the
 * wave-1 contract walk (`test/lifecycle/contract-wave1.e2e.test.ts`) calls each one live. The
 * `Assets` operations added by the wave (move, dispose, mark-lost, mark-found, bulk-move) belong to
 * the registry tag and are walked there.
 */
export const WAVE1_TAGS = new Set(['Locations', 'People', 'Custody']);
/** Tags whose operations the files module (M2-FILE) owns: every one must be implemented. */
export const FILES_TAGS = new Set(['Attachments']);
/** [M2-W2 ACC] Tags of the accessories and consumables module: every operation is implemented. */
export const ACC_TAGS = new Set(['Accessories', 'Consumables']);
/** [M2-W2 LABELS] Tags whose operations the tagging module (M2-TAG-02) owns: every one must be implemented. */
export const LABELS_TAGS = new Set(['Labels']);

/** Statuses any operation may answer with (transport, authentication, throttling, server faults). */
export const UNIVERSAL_STATUSES = [400, 401, 403, 429, 500, 503];

/** Finds the contract operation a concrete request belongs to (most specific path template wins). */
export function matchOperation(
  operations: readonly ContractOperation[],
  method: string,
  url: string,
): ContractOperation | undefined {
  const path = url.split('?')[0]!;
  const candidates = operations
    .filter((o) => o.method === method.toLowerCase())
    .filter((o) => new RegExp(`^${o.path.replace(/\{[^}]+\}/g, '[^/]+')}$`).test(path));
  // `/v1/assets/bulk-update` also matches `/v1/assets/{id}`: prefer the template with fewer parameters.
  candidates.sort(
    (a, b) => (a.path.match(/\{/g)?.length ?? 0) - (b.path.match(/\{/g)?.length ?? 0),
  );
  return candidates[0];
}
