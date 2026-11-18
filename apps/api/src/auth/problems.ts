import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import {
  type FieldError,
  PROBLEM_CONTENT_TYPE,
  type ProblemCode,
  REQUEST_ID_HEADER,
  toProblemBody,
} from '../platform/index.js';

/**
 * Problem codes of the auth contract (openapi `x-problem-codes`) that the platform kernel's
 * PROBLEM_CATALOG does not carry yet. Thrown as {@link AuthProblem} and rendered by
 * {@link AuthProblemFilter} with the same RFC 9457 shape as every other error. Codes are API
 * surface: never rename one.
 *
 * TODO(platform): once PROBLEM_CATALOG has these codes, throw `ApiProblem` and delete the filter.
 */
export const AUTH_PROBLEMS = {
  'invalid-credentials': { status: 401, title: 'Invalid credentials' },
  'mfa-invalid-code': { status: 401, title: 'Invalid verification code' },
  'mfa-challenge-expired': { status: 401, title: 'MFA challenge expired' },
  'session-expired': { status: 401, title: 'Session expired' },
  'csrf-invalid': { status: 403, title: 'CSRF token invalid' },
  'mfa-enrolment-required': { status: 403, title: 'MFA enrolment required' },
  'mfa-required-by-policy': { status: 403, title: 'MFA is required by policy' },
  'reauth-failed': { status: 403, title: 'Re-authentication failed' },
  'token-invalid': { status: 404, title: 'Token invalid' },
  'invitation-not-found': { status: 404, title: 'Invitation not found' },
  'cannot-revoke-current': { status: 409, title: 'Cannot revoke the current session' },
  'mfa-already-enrolled': { status: 409, title: 'MFA already enrolled' },
  'token-expired': { status: 410, title: 'Token expired' },
  'invitation-expired': { status: 410, title: 'Invitation expired' },
  'account-locked': { status: 429, title: 'Account locked' },
} as const;

export type AuthProblemCode = keyof typeof AUTH_PROBLEMS;

export interface AuthProblemInit {
  code: AuthProblemCode;
  /** Overrides the catalogue status (`mfa-invalid-code` is 401 on login, 422 on enrolment). */
  status?: number;
  detail?: string;
  errors?: FieldError[];
  headers?: Record<string, string>;
}

export class AuthProblem extends HttpException {
  readonly code: AuthProblemCode;
  readonly detail?: string;
  readonly errors?: FieldError[];
  readonly extraHeaders: Record<string, string>;
  readonly httpStatus: number;

  constructor(init: AuthProblemInit) {
    const status = init.status ?? AUTH_PROBLEMS[init.code].status;
    super({ code: init.code, detail: init.detail }, status);
    this.code = init.code;
    this.detail = init.detail;
    this.errors = init.errors;
    this.extraHeaders = init.headers ?? {};
    this.httpStatus = status;
    this.message = init.detail ?? AUTH_PROBLEMS[init.code].title;
  }
}

const retryAfter = (seconds: number) => ({
  'Retry-After': String(Math.max(1, Math.ceil(seconds))),
});

export const authProblem = {
  invalidCredentials: () =>
    new AuthProblem({
      code: 'invalid-credentials',
      detail: 'The email or password is incorrect.',
      headers: { 'WWW-Authenticate': 'Bearer' },
    }),
  accountLocked: (retryAfterSeconds: number) =>
    new AuthProblem({
      code: 'account-locked',
      detail: 'Too many failed attempts. Try again later.',
      headers: retryAfter(retryAfterSeconds),
    }),
  sessionExpired: () =>
    new AuthProblem({
      code: 'session-expired',
      detail: 'The session has expired or was revoked. Sign in again.',
      headers: { 'WWW-Authenticate': 'Bearer' },
    }),
  csrfInvalid: () =>
    new AuthProblem({
      code: 'csrf-invalid',
      detail: 'A valid X-CSRF-Token header is required for this request.',
    }),
  mfaEnrolmentRequired: () =>
    new AuthProblem({
      code: 'mfa-enrolment-required',
      detail: 'Your organisation requires multi-factor authentication. Enrol before continuing.',
    }),
  mfaRequiredByPolicy: () =>
    new AuthProblem({
      code: 'mfa-required-by-policy',
      detail: 'Multi-factor authentication is required for your account by tenant policy.',
    }),
  reauthFailed: () =>
    new AuthProblem({
      code: 'reauth-failed',
      detail: 'The password or code you sent to confirm this action is incorrect.',
    }),
  mfaInvalidCode: (status: 401 | 422 = 401) =>
    new AuthProblem({
      code: 'mfa-invalid-code',
      status,
      detail: 'The verification code is incorrect or was already used.',
      ...(status === 422
        ? {
            errors: [
              { pointer: '/code', message: 'The code is incorrect.', code: 'mfa-invalid-code' },
            ],
          }
        : {}),
    }),
  mfaChallengeExpired: () =>
    new AuthProblem({
      code: 'mfa-challenge-expired',
      detail: 'The sign-in challenge expired or was already used. Sign in again.',
    }),
  tokenInvalid: () =>
    new AuthProblem({ code: 'token-invalid', detail: 'The token is unknown or was already used.' }),
  tokenExpired: () =>
    new AuthProblem({
      code: 'token-expired',
      detail: 'The token has expired. Request a new link.',
    }),
  invitationNotFound: () =>
    new AuthProblem({
      code: 'invitation-not-found',
      detail: 'The invitation does not exist, was already accepted or was revoked.',
    }),
  invitationExpired: () =>
    new AuthProblem({
      code: 'invitation-expired',
      detail: 'The invitation has expired. Ask an administrator to resend it.',
    }),
  cannotRevokeCurrent: () =>
    new AuthProblem({
      code: 'cannot-revoke-current',
      detail: 'This is the current session. Use sign out instead.',
    }),
  mfaAlreadyEnrolled: () =>
    new AuthProblem({
      code: 'mfa-already-enrolled',
      detail: 'A TOTP factor is already active. Disable it first.',
    }),
};

/** Renders {@link AuthProblem}; registered as a global filter AFTER the platform's catch-all filter so it takes precedence for its own type. */
@Catch(AuthProblem)
@Injectable()
export class AuthProblemFilter implements ExceptionFilter<AuthProblem> {
  private readonly typeBase: string;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.typeBase = config.PROBLEM_TYPE_BASE;
  }

  catch(exception: AuthProblem, host: ArgumentsHost): void {
    if (host.getType() !== 'http') throw exception;
    const http = host.switchToHttp();
    const reply = http.getResponse<FastifyReply>();
    const request = http.getRequest<FastifyRequest>();
    const body = toProblemBody(exception.code as unknown as ProblemCode, {
      base: this.typeBase,
      detail: exception.detail,
      errors: exception.errors,
      requestId: request.id,
      instance: request.url.split('?')[0],
      status: exception.httpStatus,
      title: AUTH_PROBLEMS[exception.code].title,
    });
    void reply
      .status(exception.httpStatus)
      .headers({
        ...exception.extraHeaders,
        'content-type': PROBLEM_CONTENT_TYPE,
        [REQUEST_ID_HEADER]: request.id,
      })
      .send(body);
  }
}
