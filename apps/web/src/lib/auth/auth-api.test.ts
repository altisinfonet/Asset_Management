import { http, HttpResponse } from 'msw';
import { describe, expect, it, vi } from 'vitest';
import { server } from '@/mocks/server';
import {
  MOCK_ACCOUNTS,
  MOCK_INVITATIONS,
  MOCK_PASSWORD,
  MOCK_RECOVERY_CODES,
  MOCK_RESET_TOKENS,
  MOCK_TOTP_CODE,
} from '@/mocks/fixtures';
import { toUiError } from '@/lib/api';
import { authApi } from './auth-api';
import { AuthRequestError, setCsrfToken } from './http';
import { onUnauthorized } from './session-events';

async function failure(promise: Promise<unknown>): Promise<AuthRequestError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AuthRequestError);
    return err as AuthRequestError;
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
    const me = await failure(authApi.getMe());
    expect(me.status).toBe(403);
    expect(me.code).toBe('mfa-enrolment-required');

    const enrolment = await authApi.startMfaEnrolment();
    expect(enrolment.provisioning_uri).toMatch(/^otpauth:\/\/totp\//);
    expect(enrolment.secret).toBeTruthy();
    const wrong = await failure(authApi.confirmMfaEnrolment('000000'));
    expect(wrong.status).toBe(422);
    const done = await authApi.confirmMfaEnrolment(MOCK_TOTP_CODE);
    expect(done.recovery_codes).toHaveLength(10);
    expect((await authApi.getMe()).user.mfa_enabled).toBe(true);
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
