import { ApiError } from '@assettracker/api-client';
import { reportUnauthorized } from './session-events';

/**
 * Same-origin JSON requests for the auth endpoints. Cookie sessions are `HttpOnly`, so the
 * browser attaches the cookie itself; mutations also send `X-CSRF-Token` (the value returned by
 * login and `GET /v1/auth/me`). Failures throw `AuthRequestError` (an `ApiError`), which
 * `toUiError` in `lib/api.ts` maps to a catalogue message and request id.
 */
export class AuthRequestError extends ApiError {
  constructor(
    message: string,
    status: number,
    body: unknown,
    /** From the `Retry-After` header of a 429 response. */
    readonly retryAfterSeconds?: number,
  ) {
    super(message, status, body);
    this.name = 'AuthRequestError';
  }

  /** Stable machine code from the problem body (`invalid-credentials`, `token-expired`, ...). */
  get code(): string | undefined {
    const body = this.body as { code?: unknown } | undefined;
    return typeof body?.code === 'string' ? body.code : undefined;
  }
}

let csrfToken: string | undefined;

/** Remember the CSRF token returned by login / `me`; cleared on sign-out. */
export function setCsrfToken(token: string | undefined): void {
  csrfToken = token;
}

export interface RequestOptions {
  body?: unknown;
  /**
   * A `401` is an expected answer here (wrong password, session bootstrap), not an ended
   * session, so it is not broadcast to the auth provider.
   */
  expectUnauthorized?: boolean;
  signal?: AbortSignal;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds) : undefined;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json, application/problem+json' };
  if (options.body !== undefined) headers['content-type'] = 'application/json';
  if (method !== 'GET' && csrfToken) headers['x-csrf-token'] = csrfToken;

  const response = await globalThis.fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const requestId = response.headers.get('x-request-id') ?? undefined;
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = text ? JSON.parse(text) : undefined;
  } catch {
    parsed = undefined;
  }

  if (response.ok) {
    if (response.status !== 204 && text && parsed === undefined) {
      // A 200 that is not JSON means a proxy or the SPA fallback answered instead of the API.
      throw new AuthRequestError(`${method} ${path} returned a non-JSON body`, 502, undefined);
    }
    return parsed as T;
  }

  const problem =
    typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
  const body = { ...problem, request_id: problem.request_id ?? requestId };
  if (response.status === 401 && !options.expectUnauthorized) reportUnauthorized();
  throw new AuthRequestError(
    `${method} ${path} failed with ${response.status}`,
    response.status,
    body,
    parseRetryAfter(response.headers.get('retry-after')),
  );
}
