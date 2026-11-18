import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/server';
import {
  MOCK_ACCOUNTS,
  MOCK_INVITATIONS,
  MOCK_PASSWORD,
  MOCK_RECOVERY_CODES,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_RESET_TOKENS,
  MOCK_TOTP_CODE,
} from '@/mocks/fixtures';
import { toUiError } from '@/lib/api';
import { authApi } from './auth-api';
import { ApiError } from '@assettracker/api-client';
import { getCsrfToken, setCsrfToken } from './http';
import { onUnauthorized } from './session-events';

async function failure(promise: Promise<unknown>): Promise<ApiError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error('expected the request to fail');
}

describe('auth API against the mock contract', () => {
  it('login without MFA creates a session that /me then reports', async () => {
    setCsrfToken(undefined);
    const login = await authApi.login({ email: MOCK_ACCOUNTS.owner, password: MOCK_PASSWORD });
    expect(login.status).toBe('authenticated');
    expect(login.csrf_token).toBeTruthy();
    expect(login.user?.email).toBe(MOCK_ACCOUNTS.owner);

    const me = await authApi.getMe();
    expect(me.user.display_name).toBe('Alice Owner');
    expect(me.tenant.name).toBe('Acme Schools');
    expect(me.permissions).toContain('*');
    expect(me.auth.method).toBe('session');
  });

  it('wrong password and unknown account are indistinguishable (401, same code)', async () => {
    const wrong = await failure(authApi.login({ email: MOCK_ACCOUNTS.owner, password: 'nope' }));
    const unknown = await failure(authApi.login({ email: 'ghost@example.org', password: 'nope' }));
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.code).toBe(unknown.code);
    expect(toUiError(wrong).kind).toBe('unauthorized');
    expect(toUiError(wrong).requestId).toMatch(/^mock-/);
  });

  it('a throttled account answers 429 with Retry-After', async () => {
    const err = await failure(
      authApi.login({ email: MOCK_ACCOUNTS.locked, password: MOCK_PASSWORD }),
    );
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(90);
    expect(toUiError(err).kind).toBe('rate_limited');
  });

  it('MFA accounts get a challenge; TOTP and single-use recovery codes verify it', async () => {
    const first = await authApi.login({ email: MOCK_ACCOUNTS.mfaOwner, password: MOCK_PASSWORD });
    expect(first.status).toBe('mfa_required');
    expect(first.mfa?.methods).toEqual(['totp', 'recovery_code']);
    // no session yet
    expect((await failure(authApi.getMe())).status).toBe(401);

    const bad = await failure(
      authApi.verifyMfa({ challenge_id: first.mfa!.challenge_id, method: 'totp', code: '000000' }),
    );
    expect(bad.status).toBe(401);

    const ok = await authApi.verifyMfa({
      challenge_id: first.mfa!.challenge_id,
      method: 'totp',
      code: MOCK_TOTP_CODE,
    });
    expect(ok.status).toBe('authenticated');
    expect((await authApi.getMe()).auth.mfa_verified).toBe(true);

    const second = await authApi.login({ email: MOCK_ACCOUNTS.mfaOwner, password: MOCK_PASSWORD });
    const recovery = await authApi.verifyMfa({
      challenge_id: second.mfa!.challenge_id,
      method: 'recovery_code',
      code: MOCK_RECOVERY_CODES[0]!,
    });
    expect(recovery.status).toBe('authenticated');
    const third = await authApi.login({ email: MOCK_ACCOUNTS.mfaOwner, password: MOCK_PASSWORD });
    const reuse = await failure(
      authApi.verifyMfa({
        challenge_id: third.mfa!.challenge_id,
        method: 'recovery_code',
        code: MOCK_RECOVERY_CODES[0]!,
      }),
    );
    expect(reuse.status).toBe(401);
  });

  it('a multi-organisation email must choose a tenant', async () => {
    const first = await authApi.login({
      email: MOCK_ACCOUNTS.multiTenant,
      password: MOCK_PASSWORD,
    });
    expect(first.status).toBe('tenant_selection_required');
    expect(first.tenants).toHaveLength(2);
    const second = await authApi.login({
      email: MOCK_ACCOUNTS.multiTenant,
      password: MOCK_PASSWORD,
      tenant_slug: first.tenants![0]!.slug,
    });
    expect(second.status).toBe('authenticated');
  });

  it('mutations send the CSRF token from login; logout clears the session', async () => {
    await authApi.login({ email: MOCK_ACCOUNTS.owner, password: MOCK_PASSWORD });
    await authApi.logout();
    expect((await failure(authApi.getMe())).status).toBe(401);

    await authApi.login({ email: MOCK_ACCOUNTS.owner, password: MOCK_PASSWORD });
    setCsrfToken('forged');
    const rejected = await failure(authApi.logout());
    expect(rejected.status).toBe(403);
    expect(rejected.code).toBe('csrf-invalid');
  });

  it('a limited session (MFA required by the tenant) is blocked everywhere but enrolment', async () => {
    await authApi.login({ email: MOCK_ACCOUNTS.mfaRequired, password: MOCK_PASSWORD });
    // Like the real API: /me answers 200 and says enrolment is pending (and hands out the CSRF token).
    const me = await authApi.getMe();
    expect(me.mfa_enrolment_required).toBe(true);
    // every other endpoint is blocked with 403 mfa-enrolment-required
    const blocked = await failure(authApi.listSessions());
    expect(blocked.status).toBe(403);
    expect(blocked.code).toBe('mfa-enrolment-required');

    const enrolment = await authApi.startMfaEnrolment();
    expect(enrolment.provisioning_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolment.secret).toBeTruthy();
    const wrong = await failure(authApi.confirmMfaEnrolment('000000'));
    expect(wrong.status).toBe(422);
    const done = await authApi.confirmMfaEnrolment(MOCK_TOTP_CODE);
    expect(done.recovery_codes).toHaveLength(10);
    expect((await authApi.getMe()).user.mfa_enabled).toBe(true);
  });

  it('confirming MFA enrolment rotates the session: the new csrf_token is stored for later mutations', async () => {
    const login = await authApi.login({
      email: MOCK_ACCOUNTS.mfaRequired,
      password: MOCK_PASSWORD,
    });
    await authApi.startMfaEnrolment();
    const done = await authApi.confirmMfaEnrolment(MOCK_TOTP_CODE);
    expect(done.recovery_codes).toHaveLength(10);
    // The confirm response carries the rotated CSRF token, which the client stored.
    expect(getCsrfToken()).toBe(done.csrf_token);
    expect(getCsrfToken()).toBeTruthy();
    expect(getCsrfToken()).not.toBe(login.csrf_token);
    await expect(authApi.revokeSession('sess-phone')).resolves.toBeUndefined();
    // The pre-rotation token is dead, like on the real API.
    setCsrfToken(login.csrf_token);
    expect((await failure(authApi.revokeSession('sess-phone'))).code).toBe('csrf-invalid');
  });

  it('password reset: accepted for any email, token single-use, weak or breached passwords rejected', async () => {
    await expect(authApi.forgotPassword('anyone@example.org')).resolves.toBeUndefined();
    await expect(authApi.forgotPassword(MOCK_ACCOUNTS.owner)).resolves.toBeUndefined();

    expect(
      (await failure(authApi.resetPassword(MOCK_RESET_TOKENS.expired, 'long enough pass phrase')))
        .status,
    ).toBe(410);
    expect(
      (await failure(authApi.resetPassword('garbage', 'long enough pass phrase'))).status,
    ).toBe(404);
    const weak = await failure(authApi.resetPassword(MOCK_RESET_TOKENS.valid, 'short'));
    expect(weak.status).toBe(422);
    expect(toUiError(weak).fieldErrors[0]?.pointer).toBe('/password');

    await authApi.resetPassword(MOCK_RESET_TOKENS.valid, 'a brand new passphrase');
    expect(
      (await failure(authApi.resetPassword(MOCK_RESET_TOKENS.valid, 'another new passphrase')))
        .status,
    ).toBe(404);
    await expect(
      authApi.login({ email: MOCK_ACCOUNTS.owner, password: 'a brand new passphrase' }),
    ).resolves.toMatchObject({ status: 'authenticated' });
  });

  it('invitations: lookup, expiry, accept sets the password and signs in', async () => {
    const info = await authApi.getInvitation(MOCK_INVITATIONS.valid);
    expect(info).toMatchObject({ email: 'new.user@example.org', tenant_name: 'Acme Schools' });
    expect((await failure(authApi.getInvitation(MOCK_INVITATIONS.expired))).status).toBe(410);
    expect((await failure(authApi.getInvitation('nope'))).status).toBe(404);

    const accepted = await authApi.acceptInvitation({
      token: MOCK_INVITATIONS.valid,
      password: 'my chosen passphrase',
      display_name: 'Nora New',
    });
    expect(accepted.status).toBe('authenticated');
    expect((await authApi.getMe()).user.display_name).toBe('Nora New');
    // the token is spent
    expect((await failure(authApi.getInvitation(MOCK_INVITATIONS.valid))).status).toBe(404);
  });

  it('a 401 outside the sign-in endpoints is broadcast as an ended session', async () => {
    const listener = vi.fn();
    const off = onUnauthorized(listener);
    await failure(authApi.listSessions());
    expect(listener).toHaveBeenCalledTimes(1);
    // login's own 401 is an expected answer, not a broadcast
    await failure(authApi.login({ email: MOCK_ACCOUNTS.owner, password: 'wrong' }));
    expect(listener).toHaveBeenCalledTimes(1);
    off();
  });

  it('reads a non-JSON 200 (SPA fallback answering instead of the API) as a server error', async () => {
    server.use(http.get('/v1/auth/me', () => HttpResponse.html('<html></html>')));
    const err = await failure(authApi.getMe());
    expect(toUiError(err).kind).toBe('server');
  });
});

describe('MFA management against the mock contract', () => {
  async function signInWithMfa(email: string) {
    const first = await authApi.login({ email, password: MOCK_PASSWORD });
    await authApi.verifyMfa({
      challenge_id: first.mfa!.challenge_id,
      method: 'totp',
      code: MOCK_TOTP_CODE,
    });
  }

  it('regenerating recovery codes needs the password or a TOTP code and returns ten new codes', async () => {
    await signInWithMfa(MOCK_ACCOUNTS.mfaOwner);
    const wrong = await failure(authApi.regenerateRecoveryCodes({ password: 'nope' }));
    // 403 reauth-failed, never 401 (a 401 would read as "session gone")
    expect(wrong.status).toBe(403);
    expect(wrong.code).toBe('reauth-failed');

    const byPassword = await authApi.regenerateRecoveryCodes({ password: MOCK_PASSWORD });
    expect(byPassword.recovery_codes).toEqual(MOCK_REGENERATED_RECOVERY_CODES);
    const byCode = await authApi.regenerateRecoveryCodes({
      totp_code: ` ${MOCK_TOTP_CODE}`.trim(),
    });
    expect(byCode.recovery_codes).toHaveLength(10);

    // the old codes stop working at the sign-in challenge, the new ones work
    await authApi.logout();
    const challenge = await authApi.login({
      email: MOCK_ACCOUNTS.mfaOwner,
      password: MOCK_PASSWORD,
    });
    const old = await failure(
      authApi.verifyMfa({
        challenge_id: challenge.mfa!.challenge_id,
        method: 'recovery_code',
        code: MOCK_RECOVERY_CODES[0]!,
      }),
    );
    expect(old.code).toBe('mfa-invalid-code');
    await expect(
      authApi.verifyMfa({
        challenge_id: challenge.mfa!.challenge_id,
        method: 'recovery_code',
        code: MOCK_REGENERATED_RECOVERY_CODES[0]!,
      }),
    ).resolves.toMatchObject({ status: 'authenticated' });
  });

  it('validates the re-authentication body like the API (422) and refuses without MFA (409)', async () => {
    await signInWithMfa(MOCK_ACCOUNTS.mfaOwner);
    const empty = await failure(authApi.disableMfa({} as never));
    expect(empty.status).toBe(422);
    expect(empty.code).toBe('validation');
    const shortCode = await failure(authApi.disableMfa({ totp_code: '12' }));
    expect(toUiError(shortCode).fieldErrors[0]?.pointer).toBe('/totp_code');

    await authApi.logout();
    await authApi.login({ email: MOCK_ACCOUNTS.owner, password: MOCK_PASSWORD });
    const noMfa = await failure(authApi.disableMfa({ password: MOCK_PASSWORD }));
    expect(noMfa.status).toBe(409);
    expect(noMfa.code).toBe('conflict');
  });

  it('too many wrong values lock re-authentication (429 account-locked with Retry-After)', async () => {
    await signInWithMfa(MOCK_ACCOUNTS.mfaOwner);
    for (let i = 0; i < 5; i += 1) {
      expect((await failure(authApi.disableMfa({ totp_code: '000000' }))).code).toBe(
        'reauth-failed',
      );
    }
    const locked = await failure(authApi.disableMfa({ password: MOCK_PASSWORD }));
    expect(locked.status).toBe(429);
    expect(locked.code).toBe('account-locked');
    expect(locked.retryAfterSeconds).toBe(90);
  });

  it('turning MFA off removes the factor, keeps this session and signs the other devices out', async () => {
    await signInWithMfa(MOCK_ACCOUNTS.mfaOwner);
    const before = getCsrfToken();
    await expect(authApi.disableMfa({ password: MOCK_PASSWORD })).resolves.toBeUndefined();
    // no rotation: the same CSRF token still works and the session is still there
    expect(getCsrfToken()).toBe(before);
    expect((await authApi.getMe()).user.mfa_enabled).toBe(false);
    const devices = await authApi.listSessions();
    expect(devices.map((d) => d.id)).not.toContain('sess-phone');
    // signing in no longer asks for a code
    await authApi.logout();
    const next = await authApi.login({ email: MOCK_ACCOUNTS.mfaOwner, password: MOCK_PASSWORD });
    expect(next.status).toBe('authenticated');
    // and a second removal is a conflict
    const again = await failure(authApi.disableMfa({ password: MOCK_PASSWORD }));
    expect(again.status).toBe(409);
  });

  it('the policy-enforced account re-authenticates first, then gets 403 mfa-required-by-policy', async () => {
    await signInWithMfa(MOCK_ACCOUNTS.mfaEnforced);
    // a wrong value never reveals the policy
    expect((await failure(authApi.disableMfa({ password: 'nope' }))).code).toBe('reauth-failed');
    const blocked = await failure(authApi.disableMfa({ password: MOCK_PASSWORD }));
    expect(blocked.status).toBe(403);
    expect(blocked.code).toBe('mfa-required-by-policy');
    expect((await authApi.getMe()).user.mfa_enabled).toBe(true);
    // recovery codes can still be regenerated
    await expect(
      authApi.regenerateRecoveryCodes({ password: MOCK_PASSWORD }),
    ).resolves.toMatchObject({ recovery_codes: expect.any(Array) });
  });
});
