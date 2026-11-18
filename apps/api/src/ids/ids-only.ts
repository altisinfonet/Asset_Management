/**
 * The "ids only" payload rule for job payloads and outbox events (architecture 5.2/5.3, M1-PLAT-06).
 *
 * Why: `pgboss.*` tables have no row-level security, so the runtime role can read EVERY tenant's job
 * payloads; the outbox payload is read by the relay across the tenant boundary of a single batch.
 * Whatever is in a payload must therefore be safe to show to any holder of the runtime role: tenant
 * and entity ids, versions, counters, short enum-like codes. Never an email address, a name, free
 * text, a token or a URL. The consumer resolves the details under the tenant context (RLS) from the
 * ids.
 *
 * Allowed values (recursively, depth <= 3, arrays <= 100 items):
 *   - null, boolean, finite number
 *   - UUID strings
 *   - short codes: `[A-Za-z0-9_.:-]{1,64}` (event types, `2026-11-18` buckets, enum values).
 *     No whitespace, `@`, `/` or `=`: an email, a URL or a sentence cannot pass as a "code".
 * Keys must be identifier-like and must not name a secret.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[A-Za-z0-9_.:-]{1,64}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const SECRET_KEY =
  /pass(word|wd|phrase)|secret|token|totp|otp|recovery|api_?key|private_?key|credential|cookie|authorization|email|phone|address/i;
const MAX_DEPTH = 3;
const MAX_ARRAY = 100;
const MAX_BYTES = 4_096;

export class PayloadNotIdsOnlyError extends Error {
  constructor(
    readonly violations: string[],
    what: string,
  ) {
    super(`${what} payload must contain ids only: ${violations.join('; ')}`);
    this.name = 'PayloadNotIdsOnlyError';
  }
}

/** Violations of the rule in `payload` (empty = compliant). */
export function idsOnlyViolations(payload: unknown): string[] {
  const out: string[] = [];
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return ['payload must be a JSON object'];
  }
  walk(payload, '', 0, out);
  const size = Buffer.byteLength(JSON.stringify(payload));
  if (size > MAX_BYTES) out.push(`payload is ${size} bytes (max ${MAX_BYTES})`);
  return out;
}

/** Throws {@link PayloadNotIdsOnlyError} when `payload` is not ids-only. `what` names the caller. */
export function assertIdsOnlyPayload(payload: unknown, what = 'job'): void {
  const violations = idsOnlyViolations(payload);
  if (violations.length > 0) throw new PayloadNotIdsOnlyError(violations, what);
}

function walk(value: unknown, path: string, depth: number, out: string[]): void {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) out.push(`${path || '(root)'}: non-finite number`);
    return;
  }
  if (typeof value === 'string') {
    if (!UUID.test(value) && !CODE.test(value)) {
      out.push(`${path}: free text is not allowed (use an id or a short code)`);
    }
    return;
  }
  if (depth >= MAX_DEPTH) {
    out.push(`${path}: nested deeper than ${MAX_DEPTH} levels`);
    return;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY) out.push(`${path}: more than ${MAX_ARRAY} items`);
    value.slice(0, MAX_ARRAY).forEach((item, i) => walk(item, `${path}[${i}]`, depth + 1, out));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, inner] of Object.entries(value)) {
      const here = path ? `${path}.${key}` : key;
      if (!KEY.test(key)) out.push(`${here}: key is not identifier-like`);
      else if (SECRET_KEY.test(key)) out.push(`${here}: key names a secret or personal field`);
      walk(inner, here, depth + 1, out);
    }
    return;
  }
  out.push(`${path}: unsupported value type ${typeof value}`);
}
