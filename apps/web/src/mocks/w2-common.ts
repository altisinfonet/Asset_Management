import { HttpResponse, type JsonBodyType } from 'msw';
import { problem, type ProblemExtra } from './http';
import { type Body, type FieldError, validation } from './registry-handlers';
import type { W2Data } from './w2-state';

/**
 * Helpers shared by the M2 wave 2 mock handlers: the problems the API's catalogue words, strict
 * body checks like the API's zod schemas, and `Idempotency-Key` replay.
 */
const CATALOG = {
  'bad-request': [400, 'Bad request'],
  'not-found': [404, 'Not found'],
  conflict: [409, 'Conflict'],
  'precondition-failed': [412, 'Precondition failed'],
  'idempotency-key-required': [400, 'Idempotency-Key required'],
  'idempotency-key-reuse': [422, 'Idempotency-Key reused with a different request'],
  'insufficient-stock': [409, 'Not enough stock'],
  'asset-already-checked-out': [409, 'Asset already checked out'],
} as const;

export function fail(code: keyof typeof CATALOG, extra: ProblemExtra = {}) {
  const [status, title] = CATALOG[code];
  return problem(status, code, title, extra);
}

export const notFound = (what: string) => fail('not-found', { detail: `${what} not found.` });

export const missing = (pointer: string, message: string): FieldError => ({
  pointer,
  message,
  code: 'not-found',
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && UUID.test(value);

/** A body member the schema does not know: zod's strict object reports it on the root. */
export function rejectUnknown(body: Body, allowed: readonly string[]): FieldError[] {
  return Object.keys(body)
    .filter((key) => !allowed.includes(key))
    .map((key) => ({
      pointer: '/',
      message: `Unrecognized key: "${key}"`,
      code: 'unrecognized_keys',
    }));
}

export function checkUuids(
  body: Body,
  keys: readonly string[],
  nullable: readonly string[] = [],
): FieldError[] {
  const errors: FieldError[] = [];
  for (const key of keys) {
    const value = body[key];
    if (value === undefined || (value === null && nullable.includes(key))) continue;
    if (!isUuid(value))
      errors.push({ pointer: `/${key}`, message: 'Invalid UUID', code: 'format' });
  }
  return errors;
}

/** An integer member with bounds; `undefined` when absent. */
export function checkInt(
  body: Body,
  key: string,
  { min, max, required = false }: { min?: number; max?: number; required?: boolean } = {},
): FieldError[] {
  const value = body[key];
  if (value === undefined) {
    return required
      ? [{ pointer: `/${key}`, message: 'Invalid input: expected int', code: 'invalid_type' }]
      : [];
  }
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    return [{ pointer: `/${key}`, message: 'Invalid input: expected int', code: 'invalid_type' }];
  }
  if (min !== undefined && value < min) {
    return [
      {
        pointer: `/${key}`,
        message: `Too small: expected number to be >=${min}`,
        code: 'too_small',
      },
    ];
  }
  if (max !== undefined && value > max) {
    return [
      { pointer: `/${key}`, message: `Too big: expected number to be <=${max}`, code: 'too_big' },
    ];
  }
  return [];
}

/** A string member trimmed to at most `max` characters (and at least `min`). */
export function checkText(
  body: Body,
  key: string,
  {
    min = 0,
    max,
    nullable = false,
    required = false,
  }: {
    min?: number;
    max: number;
    nullable?: boolean;
    required?: boolean;
  },
): FieldError[] {
  const value = body[key];
  if (value === undefined) {
    return required
      ? [{ pointer: `/${key}`, message: 'Invalid input: expected string', code: 'invalid_type' }]
      : [];
  }
  if (value === null && nullable) return [];
  if (typeof value !== 'string') {
    return [
      { pointer: `/${key}`, message: 'Invalid input: expected string', code: 'invalid_type' },
    ];
  }
  const length = value.trim().length;
  if (length < min) {
    return [
      {
        pointer: `/${key}`,
        message: `Too small: expected string to have >=${min} characters`,
        code: 'too_small',
      },
    ];
  }
  if (length > max) {
    return [
      {
        pointer: `/${key}`,
        message: `Too big: expected string to have <=${max} characters`,
        code: 'too_big',
      },
    ];
  }
  return [];
}

export function checkDate(body: Body, key: string, nullable = true): FieldError[] {
  const value = body[key];
  if (value === undefined || (value === null && nullable)) return [];
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return [{ pointer: `/${key}`, message: 'Invalid date (YYYY-MM-DD)', code: 'invalid_format' }];
  }
  return [];
}

export function checkMoney(body: Body, key: string): FieldError[] {
  const value = body[key];
  if (value === undefined || value === null) return [];
  const money = value as { amount_minor?: unknown; currency?: unknown };
  if (
    typeof value !== 'object' ||
    typeof money.amount_minor !== 'number' ||
    !Number.isInteger(money.amount_minor) ||
    money.amount_minor < 0 ||
    typeof money.currency !== 'string' ||
    !/^[A-Z]{3}$/.test(money.currency)
  ) {
    return [{ pointer: `/${key}`, message: 'Invalid money amount', code: 'invalid_type' }];
  }
  return [];
}

export const trimmed = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

// ---- Idempotency-Key ---------------------------------------------------------------------------

/**
 * `Idempotency-Key` handling of the stock-changing POSTs: the first request runs, the same key with
 * the same request replays its answer (`Idempotent-Replayed: true`), the same key with another
 * request is `422 idempotency-key-reuse`.
 */
export function idempotent(
  request: Request,
  data: W2Data,
  signature: string,
  run: () => { status: number; body: JsonBodyType; headers?: Record<string, string> } | Response,
): Response {
  const key = request.headers.get('idempotency-key');
  if (!key) return fail('idempotency-key-required');
  const scoped = `${new URL(request.url).pathname}:${key}`;
  const known = data.idempotency[scoped];
  if (known) {
    if (known.signature !== signature) return fail('idempotency-key-reuse');
    return HttpResponse.json(known.body, {
      status: known.status,
      headers: { 'Idempotent-Replayed': 'true' },
    });
  }
  const result = run();
  if (result instanceof Response) return result;
  if (result.status < 300) {
    data.idempotency[scoped] = { signature, status: result.status, body: result.body };
  }
  return HttpResponse.json(result.body, { status: result.status, headers: result.headers });
}

export { validation };
