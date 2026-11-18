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
  MOCK_RESET_TOKENS,
  MOCK_SECRET,
  MOCK_TENANTS,
  MOCK_TOTP_CODE,
} from './fixtures';
import { problem, requireSession } from './http';
import { roleIdFor } from './registry-fixtures';
import { registryHandlers } from './registry-handlers';
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
 * Mock API handlers derived from docs/engineering/openapi.yaml (login, logout, me, mfa/verify)
 * plus the PROPOSED endpoints the auth screens need (see `lib/auth/auth-api.ts`). Errors are
 * RFC 9457 `application/problem+json` with a stable `code`, `request_id` and `errors[]`.
 *
 * The session lives in `localStorage` (see `state.ts`) because a mock cannot set the real
 * `HttpOnly` cookie from a service worker.
 */

const MIN_PASSWORD = 12;

function toUser(user: MockUser): User {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    status: 'active',
    role_assignments: [{ role_id: roleIdFor(user.role), scope_type: 'tenant' }],
    mfa_enabled: user.mfa,
  };
}

function buildMe(user: MockUser): Me {
  const state = loadState();
  const session = state.session;
  return {
    user: toUser(user),
    tenant: {
      id: '0190a6b2-0000-7000-8000-0000000000aa',
      name: user.tenantName,
      base_currency: 'USD',
      branding: { logo_url: null, accent_color: null },
    },
    permissions: user.permissions,
    auth: { method: 'session', mfa_verified: session?.mfaVerified ?? false },
    // Like the real API: a limited session still gets a 200 here (so the client learns its CSRF
    // token and that it must enrol); every other endpoint answers 403 mfa-enrolment-required.
    mfa_enrolment_required: !!session?.limited,
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

export const handlers: HttpHandler[] = [
  // ---- not auth, but the dashboard and the API-status tile call them --------------------
  ...registryHandlers,

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
      state.pendingEnrolment = false;
      if (state.session) {
        state.session.limited = false;
        state.session.mfaVerified = true;
        // Like the API: becoming MFA-verified rotates the session (and so its CSRF token).
        state.session.csrf = rotatedCsrf;
      }
    });
    // The contract returns only the codes; the client re-reads /me for the rotated CSRF token.
    return HttpResponse.json({ recovery_codes: MOCK_NEW_RECOVERY_CODES });
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
