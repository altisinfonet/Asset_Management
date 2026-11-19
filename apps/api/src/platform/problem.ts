import { HttpException } from '@nestjs/common';

/**
 * Error format of the public API (M1-PLAT-02): RFC 9457 `application/problem+json` with a stable
 * machine `code`, the request id and, for validation failures, `errors[]`
 * (docs/engineering/openapi.yaml: schemas `Problem` and `FieldError`).
 */
export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** Default base of the `type` URIs; overridable (PROBLEM_TYPE_BASE) for a self-hosted install. */
export const DEFAULT_PROBLEM_TYPE_BASE = 'https://api.assettracker.test/problems';

export interface FieldError {
  /** JSON pointer into the request body (`/asset_tag`), `query:<name>` or `path:<name>`. */
  pointer: string;
  message: string;
  code?: string;
}

export interface ProblemBody {
  type: string;
  title: string;
  status: number;
  code: string;
  detail?: string;
  instance?: string;
  request_id?: string;
  errors?: FieldError[];
  /** RFC 9457 extension members (for example `usage`: counts of what blocks a delete). */
  [extension: string]: unknown;
}

/** Every stable problem code with its status and title. Codes are API surface: never rename one. */
export const PROBLEM_CATALOG = {
  'bad-request': { status: 400, title: 'Bad request' },
  'invalid-cursor': { status: 400, title: 'Invalid cursor' },
  'idempotency-key-invalid': { status: 400, title: 'Invalid Idempotency-Key' },
  'idempotency-key-required': { status: 400, title: 'Idempotency-Key required' },
  unauthorized: { status: 401, title: 'Authentication required' },
  // Auth contract (openapi x-problem-codes, M1-AUTH). `mfa-invalid-code` is 401 on the login
  // challenge and 422 when confirming an enrolment (the throw site passes `status: 422`).
  'invalid-credentials': { status: 401, title: 'Invalid credentials' },
  'mfa-invalid-code': { status: 401, title: 'Invalid verification code' },
  'mfa-challenge-expired': { status: 401, title: 'MFA challenge expired' },
  'session-expired': { status: 401, title: 'Session expired' },
  forbidden: { status: 403, title: 'Forbidden' },
  'csrf-invalid': { status: 403, title: 'CSRF token invalid' },
  'mfa-enrolment-required': { status: 403, title: 'MFA enrolment required' },
  'mfa-required-by-policy': { status: 403, title: 'MFA is required by policy' },
  'reauth-failed': { status: 403, title: 'Re-authentication failed' },
  'not-found': { status: 404, title: 'Not found' },
  'token-invalid': { status: 404, title: 'Token invalid' },
  'invitation-not-found': { status: 404, title: 'Invitation not found' },
  'method-not-allowed': { status: 405, title: 'Method not allowed' },
  conflict: { status: 409, title: 'Conflict' },
  'cannot-revoke-current': { status: 409, title: 'Cannot revoke the current session' },
  // Files (M2-FILE-01): the upload has not reached the store yet.
  'upload-missing': { status: 409, title: 'Upload not found' },
  'mfa-already-enrolled': { status: 409, title: 'MFA already enrolled' },
  'idempotency-key-in-flight': {
    status: 409,
    title: 'Request with this Idempotency-Key in flight',
  },
  'precondition-failed': { status: 412, title: 'Precondition failed' },
  'payload-too-large': { status: 413, title: 'Payload too large' },
  'token-expired': { status: 410, title: 'Token expired' },
  'invitation-expired': { status: 410, title: 'Invitation expired' },
  'unsupported-media-type': { status: 415, title: 'Unsupported media type' },
  validation: { status: 422, title: 'Validation failed' },
  'idempotency-key-reuse': {
    status: 422,
    title: 'Idempotency-Key reused with a different request',
  },
  'precondition-required': { status: 428, title: 'Precondition required' },
  'too-many-requests': { status: 429, title: 'Too many requests' },
  'account-locked': { status: 429, title: 'Account locked' },
  internal: { status: 500, title: 'Internal server error' },
  unavailable: { status: 503, title: 'Service unavailable' },
} as const;

export type ProblemCode = keyof typeof PROBLEM_CATALOG;

export interface ProblemInit {
  code: ProblemCode;
  /** Overrides the catalogue status for the few codes documented with two (`mfa-invalid-code`: 401 / 422). */
  status?: number;
  detail?: string;
  errors?: FieldError[];
  /** RFC 9457 extension members rendered next to the standard ones (never override them). */
  extensions?: Record<string, unknown>;
  /** Extra response headers (`Retry-After`, `WWW-Authenticate`, ...). */
  headers?: Record<string, string>;
}

/**
 * Throw this from any controller, pipe, guard or service to answer with a problem document. It
 * extends HttpException so Nest's own machinery (interceptors, `@Catch(HttpException)`) still sees
 * a normal HTTP error; the global filter renders it.
 */
export class ApiProblem extends HttpException {
  readonly code: ProblemCode;
  readonly detail?: string;
  readonly errors?: FieldError[];
  readonly extensions?: Record<string, unknown>;
  readonly extraHeaders: Record<string, string>;

  constructor(init: ProblemInit) {
    const { status: catalogStatus, title } = PROBLEM_CATALOG[init.code];
    const status = init.status ?? catalogStatus;
    super({ code: init.code, title, detail: init.detail, errors: init.errors }, status);
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.extensions = init.extensions;
    this.extraHeaders = init.headers ?? {};
    this.message = init.detail ?? title;
  }
}

/** Shorthands used across the API. */
export const problem = {
  badRequest: (detail: string, errors?: FieldError[]) =>
    new ApiProblem({ code: 'bad-request', detail, errors }),
  validation: (errors: FieldError[], detail = 'The request body failed validation.') =>
    new ApiProblem({ code: 'validation', detail, errors }),
  notFound: (detail = 'The resource does not exist.') =>
    new ApiProblem({ code: 'not-found', detail }),
  conflict: (detail: string) => new ApiProblem({ code: 'conflict', detail }),
  unauthorized: (detail = 'Authentication is required.', scheme = 'Bearer') =>
    new ApiProblem({ code: 'unauthorized', detail, headers: { 'WWW-Authenticate': scheme } }),
  forbidden: (detail = 'You do not have permission to do this.') =>
    new ApiProblem({ code: 'forbidden', detail }),
  preconditionFailed: (detail: string) => new ApiProblem({ code: 'precondition-failed', detail }),
  preconditionRequired: (detail: string) =>
    new ApiProblem({ code: 'precondition-required', detail }),
};

/** Problem `code` for a status the framework produced on its own (404 route, 413 body, ...). */
export function codeForStatus(status: number): ProblemCode {
  switch (status) {
    case 400:
      return 'bad-request';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not-found';
    case 405:
      return 'method-not-allowed';
    case 409:
      return 'conflict';
    case 412:
      return 'precondition-failed';
    case 413:
      return 'payload-too-large';
    case 415:
      return 'unsupported-media-type';
    case 422:
      return 'validation';
    case 428:
      return 'precondition-required';
    case 429:
      return 'too-many-requests';
    case 503:
      return 'unavailable';
    default:
      return status >= 500 ? 'internal' : 'bad-request';
  }
}

/** Builds the response document. `base` is the `type` URI prefix without a trailing slash. */
export function toProblemBody(
  code: ProblemCode,
  opts: {
    base?: string;
    detail?: string;
    errors?: FieldError[];
    requestId?: string;
    instance?: string;
    status?: number;
    title?: string;
    extensions?: Record<string, unknown>;
  } = {},
): ProblemBody {
  const entry = PROBLEM_CATALOG[code];
  return {
    ...(opts.extensions ?? {}),
    type: `${(opts.base ?? DEFAULT_PROBLEM_TYPE_BASE).replace(/\/+$/, '')}/${code}`,
    title: opts.title ?? entry.title,
    status: opts.status ?? entry.status,
    code,
    ...(opts.detail ? { detail: opts.detail } : {}),
    ...(opts.instance ? { instance: opts.instance } : {}),
    ...(opts.requestId ? { request_id: opts.requestId } : {}),
    ...(opts.errors && opts.errors.length > 0 ? { errors: opts.errors } : {}),
  };
}
