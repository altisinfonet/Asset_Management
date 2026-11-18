import { HttpResponse } from 'msw';
import { hasPermission } from '@/lib/auth/permissions';
import { findUser, loadState, type MockUser } from './state';

/**
 * Helpers shared by every mock handler: RFC 9457 problem responses, the session / CSRF /
 * permission guard and ETag helpers. Mock-only; never part of the production bundle.
 */

export function requestId(): string {
  return `mock-${Math.random().toString(16).slice(2, 10)}`;
}

export interface ProblemExtra {
  errors?: Array<{ pointer: string; message: string; code?: string }>;
  headers?: Record<string, string>;
  detail?: string;
  /** RFC 9457 extension of a 409: what still references the record (`{ assets: 3 }`). */
  usage?: Record<string, number>;
}

/** The JSON body of a problem document (also used inside bulk results). */
export function problemBody(
  status: number,
  code: string,
  title: string,
  extra: ProblemExtra = {},
  id = requestId(),
) {
  return {
    type: `https://assettracker.test/problems/${code}`,
    title,
    status,
    code,
    request_id: id,
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.errors ? { errors: extra.errors } : {}),
    ...(extra.usage ? { usage: extra.usage } : {}),
  };
}

export function problem(status: number, code: string, title: string, extra: ProblemExtra = {}) {
  const id = requestId();
  return HttpResponse.json(problemBody(status, code, title, extra, id), {
    status,
    headers: {
      'content-type': 'application/problem+json',
      'x-request-id': id,
      ...extra.headers,
    },
  });
}

export type Guard = { ok: true; user: MockUser } | { ok: false; response: Response };

/**
 * Session check shared by authenticated endpoints: 401, CSRF on mutations, limited sessions
 * (403 `mfa-enrolment-required`, except where `allowLimited`) and, when `permission` is given,
 * a 403 `forbidden` for principals that do not hold it (the API enforces what the UI hides).
 */
export function requireSession(
  request: Request,
  options: { mutation?: boolean; allowLimited?: boolean; permission?: string } = {},
): Guard {
  const session = loadState().session;
  const user = session ? findUser(session.email) : undefined;
  if (!session || !user) {
    return { ok: false, response: problem(401, 'unauthorized', 'Authentication required') };
  }
  if (options.mutation && request.headers.get('x-csrf-token') !== session.csrf) {
    return { ok: false, response: problem(403, 'csrf-invalid', 'CSRF token missing or invalid') };
  }
  if (session.limited && !options.allowLimited) {
    return {
      ok: false,
      response: problem(403, 'mfa-enrolment-required', 'Two-step verification is required'),
    };
  }
  if (options.permission && !hasPermission(user.permissions, options.permission)) {
    return {
      ok: false,
      response: problem(403, 'forbidden', 'You do not have permission to do this'),
    };
  }
  return { ok: true, user };
}

/** `W/"<version>"`, the weak ETag the contract describes. */
export function etagOf(version: number): string {
  return `W/"${version}"`;
}

/** Check `If-Match` against the current version: 428 when absent, 412 when stale, else null. */
export function checkIfMatch(request: Request, version: number): Response | null {
  const header = request.headers.get('if-match');
  if (!header) return problem(428, 'precondition-required', 'If-Match is required');
  if (header !== etagOf(version)) {
    return problem(412, 'precondition-failed', 'The resource changed since you loaded it');
  }
  return null;
}
