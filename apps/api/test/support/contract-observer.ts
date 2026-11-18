import {
  type ContractOperation,
  UNIVERSAL_STATUSES,
  loadContract,
  matchOperation,
} from './contract.js';

/**
 * Records every request an e2e client makes (method, url, status) and checks, in `afterAll`, that
 * each answer is a status the contract documents for that operation (or one of the universal
 * transport / auth / throttling statuses). This turns the whole e2e suite into a contract test of the
 * status codes without writing an assertion per request.
 */
const seen: Array<{ method: string; url: string; status: number }> = [];

export function observe(method: string, url: string, status: number): void {
  seen.push({ method, url, status });
}

export interface ContractViolation {
  request: string;
  status: number;
  documented: number[] | 'no such operation';
}

export function contractViolations(
  operations: readonly ContractOperation[] = loadContract().operations,
): ContractViolation[] {
  const out: ContractViolation[] = [];
  for (const { method, url, status } of seen) {
    const path = url.split('?')[0]!;
    // Unversioned probes and unknown routes (404 from the router) are not contract operations.
    if (!path.startsWith('/v1/')) continue;
    const op = matchOperation(operations, method, path);
    if (!op) {
      // A route outside the contract answers 404/405 for the router, or is one of the probes.
      if (![404, 405, 200, 304].includes(status)) {
        out.push({ request: `${method} ${path}`, status, documented: 'no such operation' });
      }
      continue;
    }
    if (op.statuses.includes(status) || UNIVERSAL_STATUSES.includes(status)) continue;
    out.push({ request: `${method} ${path} (${op.operationId})`, status, documented: op.statuses });
  }
  return out;
}

export const observedCount = () => seen.length;
