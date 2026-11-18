/**
 * Redaction and diff helpers for the audit trail (M1-PLAT-04) and anything else that must never
 * persist or log a secret. A value is replaced by {@link REDACTED} when its KEY names a secret;
 * values are never inspected, so a token hiding under an innocent key is the caller's problem (the
 * audit writer runs this over every diff regardless, as defence in depth).
 */

export const REDACTED = '[REDACTED]';

/**
 * Key fragments that mark a field as sensitive, compared case-insensitively with every non
 * alphanumeric character removed (`password_hash`, `passwordHash`, `Password-Hash` all match
 * `password`). Substring match on purpose: over-redacting an audit diff is cheap, leaking is not.
 */
export const SENSITIVE_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'totp',
  'otp',
  'recovery',
  'apikey',
  'privatekey',
  'credential',
  'authorization',
  'cookie',
  'masterkey',
  'datakey',
  'csrf',
  'signature',
  'bearer',
] as const;

const MAX_DEPTH = 8;
const MAX_STRING = 2_000;

export function isSensitiveKey(key: string): boolean {
  const normalised = key.toLowerCase().replace(/[^a-z0-9]/g, '');
  return SENSITIVE_KEY_FRAGMENTS.some((fragment) => normalised.includes(fragment));
}

/** Deep copy of `value` with sensitive fields replaced and oversized strings truncated. */
export function redactSensitive<T>(value: T): T {
  return redactAt(value, 0) as T;
}

function redactAt(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}...[truncated]` : value;
  }
  if (typeof value === 'bigint') return value.toString();
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Uint8Array) return `[binary ${value.byteLength} bytes]`;
  if (depth >= MAX_DEPTH) return '[max depth]';
  if (Array.isArray(value)) return value.map((item) => redactAt(item, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactAt(inner, depth + 1);
  }
  return out;
}

export interface AuditDiff {
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, inner: unknown) =>
    inner && typeof inner === 'object' && !Array.isArray(inner)
      ? Object.fromEntries(Object.entries(inner).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : inner,
  );

/**
 * Field-level diff of two records, redacted. A create passes `before = null` and gets every field
 * of `after`; a delete the reverse; an update gets only the fields whose value changed (on both
 * sides, so the reader sees what each one was and became). Sensitive fields appear as
 * `[REDACTED]` on whichever side they changed, never with their value.
 */
export function diffRecords(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): AuditDiff {
  if (!before || !after) {
    return {
      before: before ? redactSensitive(before) : null,
      after: after ? redactSensitive(after) : null,
    };
  }
  const changedBefore: Record<string, unknown> = {};
  const changedAfter: Record<string, unknown> = {};
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (stable(before[key]) === stable(after[key])) continue;
    if (key in before) changedBefore[key] = before[key];
    if (key in after) changedAfter[key] = after[key];
  }
  return { before: redactSensitive(changedBefore), after: redactSensitive(changedAfter) };
}
