import { describe, expect, it } from 'vitest';
import { loadProblemCodes } from '../../test/support/contract.js';
import { ApiProblem, PROBLEM_CATALOG } from '../platform/index.js';
import { AUTH_PROBLEM_CODES, authProblem } from './problems.js';

describe('auth problem codes', () => {
  const contract = loadProblemCodes();

  it('are all in the platform PROBLEM_CATALOG with a status the contract documents', () => {
    for (const code of AUTH_PROBLEM_CODES) {
      expect(PROBLEM_CATALOG[code], code).toBeDefined();
      expect(contract[code], `${code} in openapi x-problem-codes`).toContain(
        PROBLEM_CATALOG[code].status,
      );
    }
  });

  it('every helper throws an ApiProblem whose code is an auth code', () => {
    const problems = [
      authProblem.invalidCredentials(),
      authProblem.accountLocked(30),
      authProblem.sessionExpired(),
      authProblem.csrfInvalid(),
      authProblem.mfaEnrolmentRequired(),
      authProblem.mfaRequiredByPolicy(),
      authProblem.reauthFailed(),
      authProblem.mfaInvalidCode(),
      authProblem.mfaChallengeExpired(),
      authProblem.tokenInvalid(),
      authProblem.tokenExpired(),
      authProblem.invitationNotFound(),
      authProblem.invitationExpired(),
      authProblem.cannotRevokeCurrent(),
      authProblem.mfaAlreadyEnrolled(),
    ];
    expect(new Set(problems.map((p) => p.code))).toEqual(new Set(AUTH_PROBLEM_CODES));
    for (const p of problems) expect(p).toBeInstanceOf(ApiProblem);
  });

  it('mfa-invalid-code is 401 on login and 422 when confirming an enrolment', () => {
    expect(authProblem.mfaInvalidCode().getStatus()).toBe(401);
    expect(authProblem.mfaInvalidCode(422).getStatus()).toBe(422);
  });

  it('account-locked carries Retry-After (rounded up, at least 1)', () => {
    expect(authProblem.accountLocked(0.2).extraHeaders['Retry-After']).toBe('1');
    expect(authProblem.accountLocked(61.5).extraHeaders['Retry-After']).toBe('62');
  });
});
