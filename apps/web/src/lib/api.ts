import { ApiError, createApiClient, type ApiClient } from '@assettracker/api-client';
import type { TranslationKey } from '@/i18n/messages/en';
import { reportUnauthorized } from '@/lib/auth/session-events';

/**
 * Thin web wrapper around `@assettracker/api-client`.
 *
 *  - same-origin only: the base URL is empty, so no API URL is baked into the bundle (CloudFront
 *    and Caddy route `/v1` to the API; the dev server proxies it);
 *  - records ETags per resource so writes can send `If-Match` (optimistic concurrency);
 *  - turns every failure into a typed `UiError` (RFC 9457 problem+json) carrying the request id,
 *    which error toasts display so support can find the request.
 */

/** RFC 9457 problem details as returned by the API (`request_id` is also in `X-Request-Id`). */
export interface ProblemDetails {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  code?: string;
  request_id?: string;
  errors?: Array<{ pointer: string; message: string }>;
}

export type ApiErrorKind =
  | 'network'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'stale'
  | 'precondition_required'
  | 'rate_limited'
  | 'validation'
  | 'server'
  | 'unknown';

export interface FieldError {
  pointer: string;
  message: string;
}

export interface UiError {
  kind: ApiErrorKind;
  status?: number;
  /** Stable machine code from the API (`code` in the problem body). */
  code?: string;
  /** Catalogue key for a user-safe message. */
  messageKey: TranslationKey;
  requestId?: string;
  fieldErrors: FieldError[];
}

const KIND_BY_STATUS: Record<number, [ApiErrorKind, TranslationKey]> = {
  401: ['unauthorized', 'error.unauthorized'],
  403: ['forbidden', 'error.forbidden'],
  404: ['not_found', 'error.notFound'],
  409: ['conflict', 'error.conflict'],
  412: ['stale', 'error.stale'],
  422: ['validation', 'error.validation'],
  400: ['validation', 'error.validation'],
  428: ['precondition_required', 'error.preconditionRequired'],
  429: ['rate_limited', 'error.rateLimited'],
};

function isProblem(body: unknown): body is ProblemDetails {
  return typeof body === 'object' && body !== null;
}

/** Map any thrown value from an API call to a `UiError`. Never throws. */
export function toUiError(err: unknown, headerRequestId?: string): UiError {
  if (err instanceof ApiError) {
    const [kind, messageKey] =
      KIND_BY_STATUS[err.status] ??
      (err.status >= 500
        ? (['server', 'error.server'] as const)
        : (['unknown', 'error.unknown'] as const));
    const problem = isProblem(err.body) ? err.body : undefined;
    return {
      kind,
      status: err.status,
      code: problem?.code,
      messageKey,
      requestId: problem?.request_id ?? headerRequestId,
      fieldErrors: Array.isArray(problem?.errors) ? problem.errors : [],
    };
  }
  // fetch() rejects with a TypeError when the network or the server is unreachable.
  if (err instanceof TypeError) {
    return { kind: 'network', messageKey: 'error.network', fieldErrors: [] };
  }
  return { kind: 'unknown', messageKey: 'error.unknown', fieldErrors: [] };
}

/** Per-resource ETag memory (`GET` responses), keyed by request path. */
export class ETagStore {
  private readonly etags = new Map<string, string>();
  private lastFailedRequestId: string | undefined;

  record(path: string, response: Response): void {
    const etag = response.headers.get('etag');
    if (etag) this.etags.set(path, etag);
    if (!response.ok) this.lastFailedRequestId = response.headers.get('x-request-id') ?? undefined;
  }

  /** ETag to send as `If-Match` when writing `path`; undefined when it was never read. */
  etagFor(path: string): string | undefined {
    return this.etags.get(path);
  }

  forget(path: string): void {
    this.etags.delete(path);
  }

  /** Request id of the most recent failed call (fallback when the body has none). */
  get failedRequestId(): string | undefined {
    return this.lastFailedRequestId;
  }
}

/** Headers for a conditional write. */
export function ifMatch(etag: string | undefined): Record<string, string> {
  return etag ? { 'If-Match': etag } : {};
}

export interface WebApi {
  client: ApiClient;
  etags: ETagStore;
  /** Convert a thrown value to a `UiError`, filling the request id from the last failed response. */
  toUiError: (err: unknown) => UiError;
}

export function createWebApi(fetchImpl?: typeof fetch): WebApi {
  const etags = new ETagStore();
  const baseFetch = fetchImpl ?? ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
  const tracked: typeof fetch = async (input, init) => {
    const response = await baseFetch(input, init);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    etags.record(new URL(url, 'http://same-origin').pathname, response);
    // An ended session (idle timeout, revoked) answers 401 anywhere; the auth provider reacts.
    if (response.status === 401) reportUnauthorized();
    return response;
  };
  return {
    client: createApiClient({ baseUrl: '', fetch: tracked }),
    etags,
    toUiError: (err) => toUiError(err, etags.failedRequestId),
  };
}

let singleton: WebApi | undefined;

/** The app-wide API instance (created lazily so importing this module never touches the network). */
export function getApi(): WebApi {
  singleton ??= createWebApi();
  return singleton;
}
