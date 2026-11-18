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
}

export function loadContract(): { operations: ContractOperation[]; permissions: string[] } {
  const doc = yaml.load(readFileSync(CONTRACT, 'utf8')) as {
    paths: Record<string, Record<string, RawOperation>>;
  };
  const operations: ContractOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
      const op = item[method];
      if (!op) continue;
      operations.push({
        method,
        path,
        operationId: op.operationId,
        tag: op.tags?.[0] ?? '',
        public: Array.isArray(op.security) && op.security.length === 0,
        permission: op['x-permission'] ?? null,
        selfService: op['x-self-service'] === true,
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
