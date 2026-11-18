import {
  ApiError,
  createTypedClient,
  ETagStore,
  ifMatch,
  type TypedClient,
} from '@assettracker/api-client';
import type { TranslationKey } from '@/i18n/messages/en';
import { getCsrfToken } from '@/lib/auth/http';
import { reportMfaEnrolmentRequired, reportUnauthorized } from '@/lib/auth/session-events';

export { ETagStore, ifMatch };

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
  /** On a `409` that refuses to delete or change something still in use: what references it. */
  usage?: Record<string, number>;
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
  /** The problem's human-readable `detail` (for example "Used by 3 assets"), when it sent one. */
  detail?: string;
  /** Counts of what still references the record, from a `409` (`usage` in the problem), e.g. `{ assets: 12 }`. */
  usage?: Record<string, number>;
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

/** Keeps only positive integer counts of a problem's `usage` member. */
function usageOf(value: unknown): Record<string, number> | undefined {
  if (typeof value !== 'object' || value === null) return undefined;
  const entries = Object.entries(value).filter(
    (e): e is [string, number] => typeof e[1] === 'number' && Number.isFinite(e[1]) && e[1] > 0,
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
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
      detail: typeof problem?.detail === 'string' ? problem.detail : undefined,
      usage: usageOf(problem?.usage),
      fieldErrors: Array.isArray(problem?.errors) ? problem.errors : [],
    };
  }
  // fetch() rejects with a TypeError when the network or the server is unreachable.
  if (err instanceof TypeError) {
    return { kind: 'network', messageKey: 'error.network', fieldErrors: [] };
  }
  return { kind: 'unknown', messageKey: 'error.unknown', fieldErrors: [] };
}

export interface WebApi {
  /** The typed REST client generated from docs/engineering/openapi.yaml. */
  http: TypedClient;
  etags: ETagStore;
  /** Convert a thrown value to a `UiError`, filling the request id from the last failed response. */
  toUiError: (err: unknown) => UiError;
}

/**
 * Endpoints whose `401` is an expected answer (wrong password, session bootstrap, sign-out), not
 * an ended session, so it is not broadcast to the auth provider.
 */
const EXPECTED_401 = /^\/v1\/auth\/(login|logout|me|mfa\/verify|password\/|invitations)/;

export function createWebApi(fetchImpl?: typeof fetch): WebApi {
  const etags = new ETagStore();
  return {
    http: createTypedClient({
      fetch: fetchImpl,
      etags,
      getCsrfToken,
      onResponse: ({ pathname, response, problemCode }) => {
        // An ended session answers 401 anywhere; the auth provider reacts.
        if (response.status === 401 && !EXPECTED_401.test(pathname)) reportUnauthorized();
        // A limited session (tenant requires MFA, user not enrolled) answers 403 everywhere else.
        if (response.status === 403 && problemCode === 'mfa-enrolment-required') {
          reportMfaEnrolmentRequired();
        }
      },
    }),
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
