import { ApiProblem } from '../platform/index.js';

/**
 * Problem codes of the auth contract (openapi `x-problem-codes`). They live in the platform
 * PROBLEM_CATALOG (`platform/problem.ts`) like every other code and are thrown as {@link ApiProblem},
 * so the one ProblemFilter renders them. Codes are API surface: never rename one.
 */
export const AUTH_PROBLEM_CODES = [
  'invalid-credentials',
  'mfa-invalid-code',
  'mfa-challenge-expired',
  'session-expired',
  'csrf-invalid',
  'mfa-enrolment-required',
  'mfa-required-by-policy',
  'reauth-failed',
  'token-invalid',
  'invitation-not-found',
  'cannot-revoke-current',
  'mfa-already-enrolled',
  'token-expired',
  'invitation-expired',
  'account-locked',
] as const;

const retryAfter = (seconds: number) => ({
  'Retry-After': String(Math.max(1, Math.ceil(seconds))),
});

export const authProblem = {
  invalidCredentials: () =>
    new ApiProblem({
      code: 'invalid-credentials',
      detail: 'The email or password is incorrect.',
      headers: { 'WWW-Authenticate': 'Bearer' },
    }),
  accountLocked: (retryAfterSeconds: number) =>
    new ApiProblem({
      code: 'account-locked',
      detail: 'Too many failed attempts. Try again later.',
      headers: retryAfter(retryAfterSeconds),
    }),
  sessionExpired: () =>
    new ApiProblem({
      code: 'session-expired',
      detail: 'The session has expired or was revoked. Sign in again.',
      headers: { 'WWW-Authenticate': 'Bearer' },
    }),
  csrfInvalid: () =>
    new ApiProblem({
      code: 'csrf-invalid',
      detail: 'A valid X-CSRF-Token header is required for this request.',
    }),
  mfaEnrolmentRequired: () =>
    new ApiProblem({
      code: 'mfa-enrolment-required',
      detail: 'Your organisation requires multi-factor authentication. Enrol before continuing.',
    }),
  mfaRequiredByPolicy: () =>
    new ApiProblem({
      code: 'mfa-required-by-policy',
      detail: 'Multi-factor authentication is required for your account by tenant policy.',
    }),
  reauthFailed: () =>
    new ApiProblem({
      code: 'reauth-failed',
      detail: 'The password or code you sent to confirm this action is incorrect.',
    }),
  mfaInvalidCode: (status: 401 | 422 = 401) =>
    new ApiProblem({
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
    new ApiProblem({
      code: 'mfa-challenge-expired',
      detail: 'The sign-in challenge expired or was already used. Sign in again.',
    }),
  tokenInvalid: () =>
    new ApiProblem({ code: 'token-invalid', detail: 'The token is unknown or was already used.' }),
  tokenExpired: () =>
    new ApiProblem({
      code: 'token-expired',
      detail: 'The token has expired. Request a new link.',
    }),
  invitationNotFound: () =>
    new ApiProblem({
      code: 'invitation-not-found',
      detail: 'The invitation does not exist, was already accepted or was revoked.',
    }),
  invitationExpired: () =>
    new ApiProblem({
      code: 'invitation-expired',
      detail: 'The invitation has expired. Ask an administrator to resend it.',
    }),
  cannotRevokeCurrent: () =>
    new ApiProblem({
      code: 'cannot-revoke-current',
      detail: 'This is the current session. Use sign out instead.',
    }),
  mfaAlreadyEnrolled: () =>
    new ApiProblem({
      code: 'mfa-already-enrolled',
      detail: 'A TOTP factor is already active. Disable it first.',
    }),
};
