import { http, HttpResponse, type HttpHandler } from 'msw';
import type {
  AcceptInvitationRequest,
  InvitationInfo,
  LoginRequest,
  LoginResponse,
  Me,
  MfaVerifyRequest,
  SessionInfo,
  User,
} from '@/lib/auth/types';
import {
  MOCK_BREACHED_PASSWORD,
  MOCK_ACCOUNTS,
  MOCK_INVITATIONS,
  MOCK_NEW_RECOVERY_CODES,
  MOCK_REGENERATED_RECOVERY_CODES,
  MOCK_RESET_TOKENS,
  MOCK_SECRET,
  MOCK_TENANTS,
  MOCK_TOTP_CODE,
} from './fixtures';
import { problem, requireSession } from './http';
import { roleIdFor } from './registry-fixtures';
import { registry } from './registry-state';
import { locationScopeView, withScope } from './scope';
import { departmentHandlers } from './dept-handlers';
import { linkHandlers } from './link-handlers';
import { m2Handlers } from './m2-handlers';
import { registryHandlers } from './registry-handlers';
import { w2Handlers } from './w2-handlers';
import { w3Handlers } from './w3-handlers';
import {
  availableRecoveryCodes,
  findUser,
  loadState,
  newId,
  passwordFor,
  updateState,
  type MockUser,
} from './state';

/**
 * Mock API handlers derived from docs/engineering/openapi.yaml: the auth endpoints here and the
 * registry endpoints in `registry-handlers.ts`. Errors are
 * RFC 9457 `application/problem+json` with a stable `code`, `request_id` and `errors[]`.
 *
 * The session lives in `localStorage` (see `state.ts`) because a mock cannot set the real
 * `HttpOnly` cookie from a service worker.
 */

const MIN_PASSWORD = 12;

/** The role assignments of the account in the registry (what the Users screen edits), else the seed role. */
function assignmentsOf(user: MockUser): User['role_assignments'] {
  const record = registry().users.find((u) => u.id === user.id);
  return record?.role_assignments.length
    ? record.role_assignments
    : [
        {
          role_id: roleIdFor(user.role),
          scope_type: 'tenant',
          company_id: null,
          location_id: null,
        },
      ];
}

function toUser(user: MockUser): User {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    status: 'active',
    role_assignments: assignmentsOf(user),
    mfa_enabled: user.mfa,
  };
}

function buildMe(account: MockUser): Me {
  const state = loadState();
  const session = state.session;
  // M2-LOC-03: effective permissions (a scoped grant drops the org-only ones) and the scope
  const user = withScope(account);
  return {
    user: toUser(user),
    tenant: {
      id: '0190a6b2-0000-7000-8000-0000000000aa',
      name: user.tenantName,
      base_currency: 'USD',
      branding: { logo_url: null, accent_color: null },
    },
    permissions: user.permissions,
    role_assignments: assignmentsOf(user),
    // null for an org-wide principal, else the subtrees it is limited to ("Scoped to: ...")
    location_scope: locationScopeView(user.locationScope),
    auth: { method: 'session', mfa_verified: session?.mfaVerified ?? false },
    // Like the real API: a limited session still gets a 200 here (so the client learns its CSRF
    // token and that it must enrol); every other endpoint answers 403 mfa-enrolment-required.
    mfa_enrolment_required: !!session?.limited,
    // M2-AUTH-01: whether the organisation policy enforces two-step verification for this user
    mfa_policy: {
      required: !!user.mfaPolicy || !!user.mfaRequired,
      scope: user.mfaPolicy || user.mfaRequired ? 'all' : 'off',
    },
    session: {
      idle_expires_at: new Date(Date.now() + 30 * 60_000).toISOString(),
      absolute_expires_at: new Date(Date.now() + 12 * 3_600_000).toISOString(),
    },
    csrf_token: session?.csrf,
  };
}

/** Create the session for `user`; limited when the tenant requires MFA and the user has none. */
function startSession(user: MockUser, mfaVerified: boolean): LoginResponse {
  const csrf = newId('csrf');
  updateState((state) => {
    state.session = {
      id: newId('sess'),
      email: user.email,
      csrf,
      mfaVerified,
      limited: !!user.mfaRequired && !user.mfa,
      createdAt: new Date().toISOString(),
    };
  });
  return { status: 'authenticated', csrf_token: csrf, user: toUser(user) };
}

function passwordProblems(password: unknown) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
    return [
      {
        pointer: '/password',
        message: `Password must be at least ${MIN_PASSWORD} characters.`,
        code: 'too-short',
      },
    ];
  }
  if (password === MOCK_BREACHED_PASSWORD) {
    return [
      {
        pointer: '/password',
        message: 'This password has appeared in a data breach. Choose a different one.',
        code: 'breached',
      },
    ];
  }
  return [];
}

interface InvitationRecord extends InvitationInfo {
  permissions: string[];
  role: string;
}

const FAR_FUTURE = '2099-01-01T00:00:00Z';

function invitationFor(token: string): InvitationRecord | 'expired' | undefined {
  if (token === MOCK_INVITATIONS.expired) return 'expired';
  if (loadState().usedTokens.includes(token)) return undefined;
  if (token === MOCK_INVITATIONS.valid) {
    return {
      email: 'new.user@example.org',
      display_name: 'New User',
      tenant_name: MOCK_TENANTS[0].name,
      role_name: 'Asset Manager',
      expires_at: FAR_FUTURE,
      mfa_enrolment_required: false,
      role: 'asset_manager',
      permissions: ['asset:*', 'catalog:read', 'location:read'],
    };
  }
  if (token === MOCK_INVITATIONS.mfaRequired) {
    return {
      email: 'new.admin@example.org',
      display_name: 'New Admin',
      tenant_name: MOCK_TENANTS[0].name,
      role_name: 'Administrator',
      expires_at: FAR_FUTURE,
      mfa_enrolment_required: true,
      role: 'tenant_admin',
      permissions: ['*'],
    };
  }
  return undefined;
}

const REAUTH_MAX_FAILURES = 5;

type ReauthCheck = { ok: true; user: MockUser } | { ok: false; response: Response };

/**
 * What `DELETE /v1/auth/mfa` and `POST /v1/auth/mfa/recovery-codes/regenerate` check, in the API's
 * order: session + CSRF (no limited session), body shape (422 `validation`), MFA enabled (409),
 * lockout (429 `account-locked`), then the password or TOTP code (403 `reauth-failed`, never 401).
 */
async function checkReauth(request: Request): Promise<ReauthCheck> {
  const guard = requireSession(request, { mutation: true });
  if (!guard.ok) return guard;
  const body = (await request.json().catch(() => null)) as {
    password?: unknown;
    totp_code?: unknown;
  } | null;
  const errors: Array<{ pointer: string; message: string; code?: string }> = [];
  const known = new Set(['password', 'totp_code']);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    errors.push({
      pointer: '/password',
      message: 'Send the current password or a current TOTP code.',
    });
  } else {
    if (Object.keys(body).some((key) => !known.has(key))) {
      errors.push({ pointer: '/', message: 'Unrecognised key.' });
    }
    if (
      body.password !== undefined &&
      (typeof body.password !== 'string' || body.password.length > 1024)
    ) {
      errors.push({ pointer: '/password', message: 'must be a string of at most 1024 characters' });
    }
    if (
      body.totp_code !== undefined &&
      !(typeof body.totp_code === 'string' && /^[0-9 ]{6,8}$/.test(body.totp_code))
    ) {
      errors.push({ pointer: '/totp_code', message: 'must be a 6-digit code' });
    }
    if (body.password === undefined && body.totp_code === undefined && errors.length === 0) {
      errors.push({
        pointer: '/password',
        message: 'Send the current password or a current TOTP code.',
      });
    }
  }
  if (errors.length > 0) {
    return { ok: false, response: problem(422, 'validation', 'Validation failed', { errors }) };
  }
  const { user } = guard;
  if (!user.mfa) {
    return {
      ok: false,
      response: problem(409, 'conflict', 'MFA is not enabled for this user', {
        detail: 'MFA is not enabled for this user.',
      }),
    };
  }
  if (loadState().reauthFailures >= REAUTH_MAX_FAILURES) {
    return {
      ok: false,
      response: problem(429, 'account-locked', 'Too many attempts', {
        headers: { 'retry-after': '90' },
      }),
    };
  }
  const ok =
    typeof body?.password === 'string'
      ? body.password === passwordFor(user.email)
      : String(body?.totp_code).replace(/\s+/g, '') === MOCK_TOTP_CODE;
  if (!ok) {
    updateState((state) => {
      state.reauthFailures += 1;
    });
    return {
      ok: false,
      response: problem(403, 'reauth-failed', 'The password or code is incorrect', {
        detail: 'The password or code you sent to confirm this action is incorrect.',
      }),
    };
  }
  updateState((state) => {
    state.reauthFailures = 0;
  });
  return { ok: true, user };
}

export const handlers: HttpHandler[] = [
  // ---- not auth, but the dashboard and the API-status tile call them --------------------
  ...registryHandlers,
  ...m2Handlers,
  ...departmentHandlers,
  ...linkHandlers,
  ...w2Handlers,
  ...w3Handlers,

  http.get('/v1/health', () =>
    HttpResponse.json({
      status: 'ok',
      checks: { db: { status: 'ok', latencyMs: 2 } },
      uptimeSeconds: 120,
    }),
  ),
  http.get('/v1/version', () =>
    HttpResponse.json({
      name: 'asset-tracker-api',
      version: '0.0.0-mock',
      commit: 'mock',
      role: 'api',
    }),
  ),

  // ---- contract: openapi.yaml ------------------------------------------------------------
  http.post('/v1/auth/login', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as Partial<LoginRequest> | null;
    if (!body?.email || !body.password) {
      return problem(422, 'validation', 'Validation failed', {
        errors: [{ pointer: !body?.email ? '/email' : '/password', message: 'is required' }],
      });
    }
    const email = body.email.trim().toLowerCase();
    if (email === MOCK_ACCOUNTS.locked) {
      return problem(429, 'account-locked', 'Too many sign-in attempts', {
        headers: { 'retry-after': '90' },
      });
    }
    const user = findUser(email);
    if (!user || passwordFor(email) !== body.password) {
      return problem(401, 'invalid-credentials', 'Email or password is incorrect');
    }
    if (email === MOCK_ACCOUNTS.multiTenant && !body.tenant_slug) {
      return HttpResponse.json<LoginResponse>({
        status: 'tenant_selection_required',
        tenants: [...MOCK_TENANTS],
      });
    }
    if (user.mfa) {
      const challengeId = newId('chal');
      updateState((state) => {
        state.challenges[challengeId] = email;
      });
      return HttpResponse.json<LoginResponse>({
        status: 'mfa_required',
        mfa: { challenge_id: challengeId, methods: ['totp', 'recovery_code'] },
      });
    }
    return HttpResponse.json(startSession(user, false));
  }),

  http.post('/v1/auth/mfa/verify', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as Partial<MfaVerifyRequest> | null;
    const email = body?.challenge_id ? loadState().challenges[body.challenge_id] : undefined;
    const user = email ? findUser(email) : undefined;
    if (!body || !user) {
      return problem(401, 'mfa-challenge-expired', 'The sign-in challenge expired');
    }
    const code = (body.code ?? '').replace(/\s+/g, '');
    let valid = false;
    if (body.method === 'totp') valid = code === MOCK_TOTP_CODE;
    if (body.method === 'recovery_code') {
      valid = availableRecoveryCodes().includes(code.toUpperCase());
      if (valid) {
        updateState((state) => {
          state.usedRecoveryCodes.push(code.toUpperCase());
        });
      }
    }
    if (!valid) return problem(401, 'mfa-invalid-code', 'The code is not valid');
    updateState((state) => {
      delete state.challenges[body.challenge_id as string];
    });
    return HttpResponse.json(startSession(user, true));
  }),

  http.get('/v1/auth/me', ({ request }) => {
    const guard = requireSession(request, { allowLimited: true });
    return guard.ok ? HttpResponse.json(buildMe(guard.user)) : guard.response;
  }),

  http.post('/v1/auth/logout', ({ request }) => {
    const guard = requireSession(request, { mutation: true, allowLimited: true });
    if (!guard.ok) return guard.response;
    updateState((state) => {
      delete state.session;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  // ---- proposed: password reset ---------------------------------------------------------
  http.post('/v1/auth/password/forgot', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as { email?: string } | null;
    if (!body?.email) {
      return problem(422, 'validation', 'Validation failed', {
        errors: [{ pointer: '/email', message: 'is required' }],
      });
    }
    // Same answer whether or not the account exists.
    return new HttpResponse(null, { status: 202 });
  }),

  http.post('/v1/auth/password/reset', async ({ request }) => {
    const body = (await request.json().catch(() => null)) as {
      token?: string;
      password?: string;
    } | null;
    const token = body?.token ?? '';
    if (token === MOCK_RESET_TOKENS.expired) {
      return problem(410, 'token-expired', 'The reset link has expired');
    }
    if (token !== MOCK_RESET_TOKENS.valid || loadState().usedTokens.includes(token)) {
      return problem(404, 'token-invalid', 'The reset link is not valid');
    }
    const errors = passwordProblems(body?.password);
    if (errors.length > 0) return problem(422, 'validation', 'Validation failed', { errors });
    updateState((state) => {
      state.usedTokens.push(token);
      // The seeded reset token belongs to the owner account; a reset ends every session.
      state.passwords[MOCK_ACCOUNTS.owner] = body?.password as string;
      delete state.session;
    });
    return new HttpResponse(null, { status: 204 });
  }),

  // ---- proposed: invitations --------------------------------------------------------------
  http.get('/v1/auth/invitations/:token', ({ params }) => {
    const found = invitationFor(String(params.token));
    if (found === 'expired') return problem(410, 'invitation-expired', 'The invitation expired');
    if (!found) return problem(404, 'invitation-not-found', 'The invitation is not valid');
    const { permissions: _p, role: _r, ...info } = found;
    return HttpResponse.json<InvitationInfo>(info);
  }),

  http.post('/v1/auth/invitations/accept', async ({ request }) => {
    const body = (await request
      .json()
      .catch(() => null)) as Partial<AcceptInvitationRequest> | null;
    const found = invitationFor(body?.token ?? '');
    if (found === 'expired') return problem(410, 'invitation-expired', 'The invitation expired');
    if (!found || !body?.token) {
      return problem(404, 'invitation-not-found', 'The invitation is not valid');
    }
    const errors = passwordProblems(body.password);
    if (errors.length > 0) return problem(422, 'validation', 'Validation failed', { errors });
    const email = found.email.toLowerCase();
    const user: MockUser = {
      id: newId('user'),
      email,
      display_name: body.display_name?.trim() || found.display_name,
      role: found.role,
      permissions: found.permissions,
      mfa: false,
      mfaRequired: found.mfa_enrolment_required,
      mfaPolicy: found.mfa_enrolment_required,
      tenantName: found.tenant_name,
    };
    updateState((state) => {
      state.users[email] = user;
      state.passwords[email] = body.password as string;
      state.usedTokens.push(body.token as string);
    });
    return HttpResponse.json(startSession(user, false));
  }),

  // ---- proposed: MFA enrolment ------------------------------------------------------------
  http.post('/v1/auth/mfa/enrol', ({ request }) => {
    const guard = requireSession(request, { mutation: true, allowLimited: true });
    if (!guard.ok) return guard.response;
    updateState((state) => {
      state.pendingEnrolment = true;
    });
    const label = encodeURIComponent(`Asset Tracker:${guard.user.email}`);
    return HttpResponse.json({
      secret: MOCK_SECRET,
      provisioning_uri: `otpauth://totp/${label}?secret=${MOCK_SECRET}&issuer=Asset%20Tracker`,
    });
  }),

  http.post('/v1/auth/mfa/enrol/confirm', async ({ request }) => {
    const guard = requireSession(request, { mutation: true, allowLimited: true });
    if (!guard.ok) return guard.response;
    const body = (await request.json().catch(() => null)) as { code?: string } | null;
    if (
      !loadState().pendingEnrolment ||
      (body?.code ?? '').replace(/\s+/g, '') !== MOCK_TOTP_CODE
    ) {
      return problem(422, 'mfa-invalid-code', 'The code is not valid', {
        errors: [{ pointer: '/code', message: 'does not match', code: 'invalid' }],
      });
    }
    const rotatedCsrf = newId('csrf');
    updateState((state) => {
      const email = guard.user.email;
      if (!state.mfaEnrolled.includes(email)) state.mfaEnrolled.push(email);
      state.mfaDisabled = state.mfaDisabled.filter((e) => e !== email);
      // Activating replaces every recovery code with a fresh set, like the API.
      state.recoveryCodes = [...MOCK_NEW_RECOVERY_CODES];
      state.pendingEnrolment = false;
      if (state.session) {
        state.session.limited = false;
        state.session.mfaVerified = true;
        // Like the API: becoming MFA-verified rotates the session (and so its CSRF token).
        state.session.csrf = rotatedCsrf;
      }
    });
    return HttpResponse.json({ recovery_codes: MOCK_NEW_RECOVERY_CODES, csrf_token: rotatedCsrf });
  }),

  // ---- MFA management: re-authenticate, then regenerate recovery codes or turn MFA off ----------
  http.post('/v1/auth/mfa/recovery-codes/regenerate', async ({ request }) => {
    const checked = await checkReauth(request);
    if (!checked.ok) return checked.response;
    updateState((state) => {
      state.recoveryCodes = [...MOCK_REGENERATED_RECOVERY_CODES];
      state.usedRecoveryCodes = [];
    });
    return HttpResponse.json({ recovery_codes: MOCK_REGENERATED_RECOVERY_CODES });
  }),

  http.delete('/v1/auth/mfa', async ({ request }) => {
    const checked = await checkReauth(request);
    if (!checked.ok) return checked.response;
    // Re-authentication comes first (like the API): a wrong value never reveals the policy.
    if (checked.user.mfaPolicy || checked.user.mfaRequired) {
      return problem(
        403,
        'mfa-required-by-policy',
        'Two-step verification is required for your account',
        { detail: 'Multi-factor authentication is required for your account by tenant policy.' },
      );
    }
    const email = checked.user.email;
    updateState((state) => {
      state.mfaEnrolled = state.mfaEnrolled.filter((e) => e !== email);
      if (!state.mfaDisabled.includes(email)) state.mfaDisabled.push(email);
      state.recoveryCodes = [];
      // Every OTHER session of the user is revoked; this one stays (no rotation, no new CSRF token).
      for (const id of ['sess-phone', 'sess-laptop']) {
        if (!state.revokedSessions.includes(id)) state.revokedSessions.push(id);
      }
    });
    return new HttpResponse(null, { status: 204 });
  }),

  // ---- proposed: device list ---------------------------------------------------------------
  http.get('/v1/auth/sessions', ({ request }) => {
    const guard = requireSession(request);
    if (!guard.ok) return guard.response;
    const state = loadState();
    const now = Date.now();
    const sessions: SessionInfo[] = [
      {
        id: state.session?.id ?? 'current',
        created_at: state.session?.createdAt ?? new Date(now).toISOString(),
        last_seen_at: new Date(now).toISOString(),
        ip: '203.0.113.10',
        user_agent: 'Chrome on Windows',
        current: true,
      },
      {
        id: 'sess-phone',
        created_at: new Date(now - 3 * 86_400_000).toISOString(),
        last_seen_at: new Date(now - 3_600_000).toISOString(),
        ip: '198.51.100.24',
        user_agent: 'Safari on iPhone',
        current: false,
      },
      {
        id: 'sess-laptop',
        created_at: new Date(now - 9 * 86_400_000).toISOString(),
        last_seen_at: new Date(now - 2 * 86_400_000).toISOString(),
        ip: '192.0.2.77',
        user_agent: 'Firefox on Linux',
        current: false,
      },
    ].filter((s) => s.current || !state.revokedSessions.includes(s.id));
    return HttpResponse.json({ data: sessions });
  }),

  http.delete('/v1/auth/sessions/:id', ({ request, params }) => {
    const guard = requireSession(request, { mutation: true });
    if (!guard.ok) return guard.response;
    const id = String(params.id);
    if (id === loadState().session?.id) {
      return problem(409, 'cannot-revoke-current', 'Use sign out for the current device');
    }
    updateState((state) => {
      state.revokedSessions.push(id);
    });
    return new HttpResponse(null, { status: 204 });
  }),
];
