import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { IdentityLookupService, generateToken, hashToken } from '../identity/index.js';
import { ApiProblem, problem } from '../platform/index.js';
import { AUDIT_WRITER, type AuditWriter } from '../ports/index.js';
import { asBytes, TenancyService } from '../tenancy/index.js';
import {
  loadGrants,
  loadMfaPolicy,
  lowerEmail,
  mfaRequired,
  tenantSlugFromHost,
} from './access-data.js';
import { type AuthContext, type ClientInfo } from './auth-context.js';
import { type LoginResponseDto, userDto } from './auth.dto.js';
import { AuthMailer } from './auth-mailer.service.js';
import type { LoginBody, MfaVerifyBody } from './auth.schemas.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { authProblem } from './problems.js';
import { SecurityLogService } from './security-log.service.js';
import { SessionService } from './session.service.js';
import { bucketKey, ThrottleService } from './throttle.service.js';

const MFA_CHALLENGE_TTL_MS = 5 * 60_000;
const MFA_CHALLENGE_MAX_ATTEMPTS = 5;
/** Throttle: invitation lookups, password reset submissions, reset requests (per IP per window). */
const TOKEN_ENDPOINT_MAX_PER_IP = 60;
const FORGOT_MAX_PER_IP = 10;
const FORGOT_MAX_PER_EMAIL = 3;

export interface AuthResult<T> {
  body: T;
  /** `Set-Cookie` header value to send. */
  cookie?: string;
}

/**
 * Login, MFA challenge, logout, password reset, invitation acceptance and `me` (M1-AUTH-02..05).
 *
 * Security properties (each has a test in test/auth):
 *  - unknown email and wrong password answer identically (same body, one password verification of
 *    equal cost either way) and are throttled identically (per hashed email and per IP);
 *  - a session is created only after the password (and, when enrolled, the second factor) checked out,
 *    with a freshly generated id: nothing a client sent before login can become the session;
 *  - tokens (reset, invitation, challenge, session) are random, stored hashed, single use;
 *  - password reset requests always answer 202 and never reveal whether an account exists.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly background = new Set<Promise<void>>();

  constructor(
    private readonly tenancy: TenancyService,
    private readonly identity: IdentityLookupService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionService,
    private readonly throttle: ThrottleService,
    private readonly securityLog: SecurityLogService,
    private readonly mfa: MfaService,
    private readonly mailer: AuthMailer,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Waits for fire-and-forget work (password reset mails). Tests and graceful shutdown call it. */
  async drain(): Promise<void> {
    await Promise.allSettled([...this.background]);
  }

  // ------------------------------------------------------------------------------------ throttling

  private async assertNotThrottled(acctBucket: string, ipBucket: string): Promise<void> {
    const acctWait = await this.throttle.blockedFor(
      acctBucket,
      this.config.LOGIN_MAX_FAILURES_PER_ACCOUNT,
    );
    if (acctWait > 0) throw authProblem.accountLocked(acctWait);
    const ipWait = await this.throttle.blockedFor(ipBucket, this.config.LOGIN_MAX_FAILURES_PER_IP);
    if (ipWait > 0) {
      throw new ApiProblem({
        code: 'too-many-requests',
        detail: 'Too many failed attempts from this address. Try again later.',
        headers: { 'Retry-After': String(ipWait) },
      });
    }
  }

  private async recordFailure(
    acctBucket: string,
    ipBucket: string,
    event: {
      eventType: 'login_failed' | 'mfa_failed';
      subject?: string;
      tenantId?: string;
      client: ClientInfo;
    },
  ): Promise<void> {
    const hits = await this.throttle.hit(acctBucket);
    await this.throttle.hit(ipBucket);
    await this.securityLog.record({
      eventType: event.eventType,
      subject: event.subject,
      tenantId: event.tenantId,
      client: event.client,
    });
    if (hits === this.config.LOGIN_MAX_FAILURES_PER_ACCOUNT) {
      await this.securityLog.record({
        eventType: 'account_locked',
        subject: event.subject,
        tenantId: event.tenantId,
        client: event.client,
        detail: { failures: hits },
      });
    }
  }

  // ------------------------------------------------------------------------------------------ login

  async login(body: LoginBody, client: ClientInfo): Promise<AuthResult<LoginResponseDto>> {
    const email = lowerEmail(body.email);
    const acctBucket = `login:acct:${bucketKey(email)}`;
    const ipBucket = `login:ip:${client.ip ?? 'unknown'}`;
    await this.assertNotThrottled(acctBucket, ipBucket);

    // A tenant hostname (acme.<suffix>) selects the tenant like `tenant_slug`; the two must agree.
    const hostSlug = tenantSlugFromHost(client.host ?? undefined, this.config.TENANT_HOST_SUFFIX);
    if (hostSlug && body.tenant_slug && body.tenant_slug !== hostSlug) {
      throw problem.forbidden('The hostname does not match the requested workspace.');
    }
    const slug = body.tenant_slug ?? hostSlug ?? undefined;
    let candidates = await this.identity.findLoginCandidates(email);
    if (slug) candidates = candidates.filter((c) => c.tenantSlug === slug);

    // One password verification per candidate account; one dummy verification when there is none, so
    // an unknown email costs what a wrong password costs.
    const matched: typeof candidates = [];
    for (const candidate of candidates) {
      const credential = await this.tenancy.withPreTenantTx((trx) =>
        trx.credential.findUnique({
          where: {
            tenant_id_user_id: { tenant_id: candidate.tenantId, user_id: candidate.userId },
          },
        }),
      );
      if (!credential) {
        await this.passwords.verifyDummy(body.password);
        continue;
      }
      if (await this.passwords.verify(credential.password_hash, body.password)) {
        matched.push(candidate);
      }
    }
    if (candidates.length === 0) await this.passwords.verifyDummy(body.password);

    if (matched.length === 0) {
      await this.recordFailure(acctBucket, ipBucket, {
        eventType: 'login_failed',
        subject: email,
        client,
      });
      throw authProblem.invalidCredentials();
    }

    const usable = matched.filter((c) => c.tenantStatus === 'active');
    if (usable.length === 0) {
      // The password was right, so telling the user why they cannot get in discloses nothing.
      await this.securityLog.record({
        eventType: 'tenant_inactive',
        tenantId: matched[0]!.tenantId,
        subject: email,
        client,
      });
      throw problem.forbidden('This workspace is not active. Contact your administrator.');
    }

    if (usable.length > 1) {
      const tenants = await Promise.all(
        usable.map(async (c) => ({
          slug: c.tenantSlug,
          name:
            (
              await this.tenancy.withTenantTx({ tenantId: c.tenantId }, (trx) =>
                trx.tenant.findUnique({ where: { id: c.tenantId }, select: { name: true } }),
              )
            )?.name ?? c.tenantSlug,
        })),
      );
      return { body: { status: 'tenant_selection_required', tenants } };
    }

    const chosen = usable[0]!;
    const outcome = await this.tenancy.withTenantTx(
      { tenantId: chosen.tenantId, actorId: chosen.userId },
      async (trx) => {
        const user = await trx.user_account.findUnique({ where: { id: chosen.userId } });
        if (!user || user.archived_at || user.status !== 'active')
          return { kind: 'inactive' as const };

        if (user.mfa_enabled && (await this.mfa.hasActiveFactor(trx, user.id))) {
          const challenge = generateToken();
          await trx.mfa_challenge.create({
            data: {
              token_hash: asBytes(hashToken(challenge)),
              tenant_id: chosen.tenantId,
              user_id: user.id,
              expires_at: new Date(Date.now() + MFA_CHALLENGE_TTL_MS),
              ip: client.ip,
              user_agent: client.userAgent,
            },
          });
          return { kind: 'mfa' as const, challenge };
        }

        const session = await this.sessions.create(trx, {
          tenantId: chosen.tenantId,
          userId: user.id,
          mfaVerified: false,
          ip: client.ip,
          userAgent: client.userAgent,
        });
        const updated = await trx.user_account.update({
          where: { id: user.id },
          data: { last_login_at: new Date() },
        });
        const grants = await loadGrants(trx, user.id);
        await this.audit.write(trx, {
          action: 'auth.login.succeeded',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'password', session_id: session.id },
        });
        return { kind: 'ok' as const, session, user: updated, grants };
      },
    );

    if (outcome.kind === 'inactive') {
      await this.recordFailure(acctBucket, ipBucket, {
        eventType: 'login_failed',
        subject: email,
        client,
      });
      throw authProblem.invalidCredentials();
    }
    await this.throttle.reset(acctBucket);
    if (outcome.kind === 'mfa') {
      return {
        body: {
          status: 'mfa_required',
          mfa: { challenge_id: outcome.challenge, methods: ['totp', 'recovery_code'] },
        },
      };
    }
    return {
      body: {
        status: 'authenticated',
        csrf_token: outcome.session.csrfToken,
        user: userDto(outcome.user, outcome.grants),
      },
      cookie: this.sessions.cookieFor(outcome.session.token, outcome.session.absoluteExpiresAt),
    };
  }

  // ------------------------------------------------------------------------------ MFA challenge

  async verifyMfa(body: MfaVerifyBody, client: ClientInfo): Promise<AuthResult<LoginResponseDto>> {
    const ipBucket = `mfa:ip:${client.ip ?? 'unknown'}`;
    const ipWait = await this.throttle.blockedFor(ipBucket, this.config.LOGIN_MAX_FAILURES_PER_IP);
    if (ipWait > 0) {
      throw new ApiProblem({
        code: 'too-many-requests',
        detail: 'Too many failed attempts from this address. Try again later.',
        headers: { 'Retry-After': String(ipWait) },
      });
    }
    const hash = hashToken(body.challenge_id);
    const challenge = await this.tenancy.withPreTenantTx((trx) =>
      trx.mfa_challenge.findUnique({ where: { token_hash: asBytes(hash) } }),
    );
    if (
      !challenge ||
      challenge.consumed_at ||
      challenge.expires_at.getTime() <= Date.now() ||
      challenge.attempts >= MFA_CHALLENGE_MAX_ATTEMPTS
    ) {
      throw authProblem.mfaChallengeExpired();
    }
    const acctBucket = `mfa:acct:${challenge.user_id}`;
    const acctWait = await this.throttle.blockedFor(
      acctBucket,
      this.config.LOGIN_MAX_FAILURES_PER_ACCOUNT,
    );
    if (acctWait > 0) throw authProblem.accountLocked(acctWait);

    const user = { id: challenge.user_id, tenantId: challenge.tenant_id };
    const outcome = await this.tenancy.withTenantTx(
      { tenantId: user.tenantId, actorId: user.id },
      async (trx) => {
        // Spend an attempt first (and only proceed while one was available): parallel guesses race on this row.
        const claimed = await trx.mfa_challenge.updateMany({
          where: {
            token_hash: asBytes(hash),
            consumed_at: null,
            attempts: { lt: MFA_CHALLENGE_MAX_ATTEMPTS },
          },
          data: { attempts: { increment: 1 } },
        });
        if (claimed.count === 0) return { kind: 'expired' as const };

        const account = await trx.user_account.findUnique({ where: { id: user.id } });
        if (!account || account.archived_at || account.status !== 'active') {
          return { kind: 'expired' as const };
        }

        let ok = false;
        if (body.method === 'totp') ok = await this.mfa.verifyTotp(trx, user, body.code, 'active');
        else if (body.method === 'recovery_code') {
          ok = await this.mfa.consumeRecoveryCode(trx, user, body.code);
        }
        if (!ok) return { kind: 'invalid' as const };

        const consumed = await trx.mfa_challenge.updateMany({
          where: { token_hash: asBytes(hash), consumed_at: null },
          data: { consumed_at: new Date() },
        });
        if (consumed.count === 0) return { kind: 'expired' as const };

        const session = await this.sessions.create(trx, {
          tenantId: user.tenantId,
          userId: user.id,
          mfaVerified: true,
          ip: client.ip,
          userAgent: client.userAgent,
        });
        const updated = await trx.user_account.update({
          where: { id: user.id },
          data: { last_login_at: new Date() },
        });
        const grants = await loadGrants(trx, user.id);
        await this.audit.write(trx, {
          action: 'auth.login.succeeded',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'password+mfa', mfa_method: body.method, session_id: session.id },
        });
        return { kind: 'ok' as const, session, user: updated, grants };
      },
    );

    if (outcome.kind === 'expired') throw authProblem.mfaChallengeExpired();
    if (outcome.kind === 'invalid') {
      await this.recordFailure(acctBucket, ipBucket, {
        eventType: 'mfa_failed',
        subject: user.id,
        tenantId: user.tenantId,
        client,
      });
      throw authProblem.mfaInvalidCode(401);
    }
    await this.throttle.reset(acctBucket);
    return {
      body: {
        status: 'authenticated',
        csrf_token: outcome.session.csrfToken,
        user: userDto(outcome.user, outcome.grants),
      },
      cookie: this.sessions.cookieFor(outcome.session.token, outcome.session.absoluteExpiresAt),
    };
  }

  // -------------------------------------------------------------------------------------- logout

  async logout(auth: AuthContext): Promise<{ cookie?: string }> {
    if (auth.method !== 'session' || !auth.sessionId) return {};
    await this.tenancy.withTenantTx(
      { tenantId: auth.tenantId, actorId: auth.userId },
      async (trx) => {
        await this.sessions.revokeOne(trx, auth.tenantId, auth.userId, auth.sessionId!);
        await this.audit.write(trx, {
          action: 'auth.logout',
          entityType: 'user',
          entityId: auth.userId,
          meta: { session_id: auth.sessionId },
        });
      },
    );
    return { cookie: this.sessions.clearCookie() };
  }

  // ------------------------------------------------------------------------------------------- me

  async me(auth: AuthContext) {
    const { tenant, company } = await this.tenancy.withTenantTx(
      { tenantId: auth.tenantId, actorId: auth.principalId },
      async (trx) => ({
        tenant: await trx.tenant.findUniqueOrThrow({ where: { id: auth.tenantId } }),
        company: await trx.company.findFirst({ where: { is_default: true }, select: { id: true } }),
      }),
    );
    return {
      user: userDto(
        {
          id: auth.user.id,
          email: auth.user.email,
          display_name: auth.user.displayName,
          status: auth.user.status,
          locale: auth.user.locale,
          timezone: auth.user.timezone,
          mfa_enabled: auth.user.mfaEnabled,
          last_login_at: auth.user.lastLoginAt,
          created_at: auth.user.createdAt,
          updated_at: auth.user.updatedAt,
          archived_at: null,
        },
        auth.grants,
      ),
      tenant: {
        id: tenant.id,
        name: tenant.name,
        plan: tenant.plan,
        base_currency: tenant.base_currency,
        cell: tenant.cell,
        branding: { logo_url: null, accent_color: null },
      },
      ...(company ? { default_company_id: company.id } : {}),
      permissions: [...auth.permissions],
      role_assignments: auth.grants.map((g) => ({
        id: g.assignmentId,
        role_id: g.roleId,
        scope_type: g.scopeType,
        company_id: g.scopeCompanyId,
        location_id: g.scopeLocationId,
      })),
      auth: {
        method: auth.method,
        mfa_verified: auth.mfaVerified,
        api_key_id: auth.apiKeyId,
        scopes: auth.apiKeyScopes ? [...auth.apiKeyScopes] : [],
      },
      mfa_enrolment_required: auth.mfaEnrolmentRequired,
      session: auth.session
        ? {
            idle_expires_at: auth.session.idleExpiresAt.toISOString(),
            absolute_expires_at: auth.session.absoluteExpiresAt.toISOString(),
          }
        : null,
      ...(auth.csrfToken ? { csrf_token: auth.csrfToken } : {}),
    };
  }

  passwordPolicy() {
    return this.passwords.policy();
  }

  // ------------------------------------------------------------------------------ password reset

  /**
   * Always resolves the same way for known and unknown addresses: the lookup is the only work done
   * before answering, token creation and mail run afterwards in the background.
   */
  async requestPasswordReset(emailInput: string, client: ClientInfo): Promise<void> {
    const email = lowerEmail(emailInput);
    const ipBucket = `forgot:ip:${client.ip ?? 'unknown'}`;
    const emailBucket = `forgot:email:${bucketKey(email)}`;
    const ipWait = await this.throttle.blockedFor(ipBucket, FORGOT_MAX_PER_IP);
    const emailWait = await this.throttle.blockedFor(emailBucket, FORGOT_MAX_PER_EMAIL);
    const wait = Math.max(ipWait, emailWait);
    if (wait > 0) {
      throw new ApiProblem({
        code: 'too-many-requests',
        detail: 'Too many reset requests. Try again later.',
        headers: { 'Retry-After': String(wait) },
      });
    }
    await this.throttle.hit(ipBucket);
    await this.throttle.hit(emailBucket);

    const candidates = (await this.identity.findLoginCandidates(email)).filter(
      (c) => c.tenantStatus === 'active',
    );
    const work = this.issueResetTokens(email, candidates, client).catch((err: unknown) =>
      this.logger.error(`password reset processing failed: ${String(err)}`),
    );
    this.background.add(work);
    void work.finally(() => this.background.delete(work));
  }

  private async issueResetTokens(
    email: string,
    candidates: Array<{ tenantId: string; userId: string }>,
    client: ClientInfo,
  ): Promise<void> {
    await this.securityLog.record({
      eventType: 'password_reset_requested',
      subject: email,
      client,
      detail: { accounts: candidates.length },
    });
    for (const c of candidates) {
      const token = generateToken();
      const expiresAt = new Date(Date.now() + this.config.PASSWORD_RESET_TTL_MINUTES * 60_000);
      const info = await this.tenancy.withTenantTx(
        { tenantId: c.tenantId, actorId: c.userId },
        async (trx) => {
          const user = await trx.user_account.findUnique({ where: { id: c.userId } });
          if (!user || user.archived_at || user.status !== 'active') return null;
          // Only the newest link works.
          await trx.password_reset_token.deleteMany({ where: { user_id: user.id, used_at: null } });
          await trx.password_reset_token.create({
            data: {
              token_hash: asBytes(hashToken(token)),
              tenant_id: c.tenantId,
              user_id: user.id,
              expires_at: expiresAt,
            },
          });
          await this.audit.write(trx, {
            action: 'auth.password.reset_requested',
            entityType: 'user',
            entityId: user.id,
          });
          const tenant = await trx.tenant.findUniqueOrThrow({
            where: { id: c.tenantId },
            select: { name: true },
          });
          return { user, tenantName: tenant.name };
        },
      );
      if (!info) continue;
      await this.mailer.passwordReset({
        to: info.user.email,
        displayName: info.user.display_name,
        tenantName: info.tenantName,
        token,
        expiresAt,
        locale: info.user.locale,
      });
    }
  }

  async resetPassword(token: string, password: string, client: ClientInfo): Promise<void> {
    const ipBucket = `reset:ip:${client.ip ?? 'unknown'}`;
    await this.assertTokenEndpointNotThrottled(ipBucket);

    const hash = hashToken(token);
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx.password_reset_token.findUnique({ where: { token_hash: asBytes(hash) } }),
    );
    if (!row || row.used_at) {
      await this.failToken(ipBucket, 'password_reset_failed', client);
      throw authProblem.tokenInvalid();
    }
    if (row.expires_at.getTime() <= Date.now()) {
      await this.failToken(ipBucket, 'password_reset_failed', client, row.tenant_id);
      throw authProblem.tokenExpired();
    }
    const violation = await this.passwords.validate(password);
    if (violation) {
      // A rejected password does not consume the token.
      throw problem.validation([{ ...this.fieldError(violation) }]);
    }
    const passwordHash = await this.passwords.hash(password);

    await this.tenancy.withTenantTx(
      { tenantId: row.tenant_id, actorId: row.user_id },
      async (trx) => {
        const spent = await trx.password_reset_token.updateMany({
          where: { token_hash: asBytes(hash), used_at: null, expires_at: { gt: new Date() } },
          data: { used_at: new Date() },
        });
        if (spent.count === 0) throw authProblem.tokenInvalid();
        const user = await trx.user_account.findUnique({ where: { id: row.user_id } });
        if (!user || user.archived_at || user.status !== 'active') throw authProblem.tokenInvalid();
        await trx.credential.upsert({
          where: { tenant_id_user_id: { tenant_id: row.tenant_id, user_id: row.user_id } },
          create: {
            tenant_id: row.tenant_id,
            user_id: row.user_id,
            password_hash: passwordHash,
          },
          update: {
            password_hash: passwordHash,
            password_changed_at: new Date(),
            failed_attempts: 0,
            locked_until: null,
            must_change: false,
          },
        });
        // Any other outstanding reset link dies with this one; every session ends (the user signs in again).
        await trx.password_reset_token.deleteMany({ where: { user_id: user.id, used_at: null } });
        const revoked = await this.sessions.revokeAll(trx, row.tenant_id, user.id);
        await this.audit.write(trx, {
          action: 'auth.password.reset',
          entityType: 'user',
          entityId: user.id,
          meta: { sessions_revoked: revoked },
        });
      },
    );
    await this.throttle.reset(
      `login:acct:${bucketKey(await this.emailOf(row.tenant_id, row.user_id))}`,
    );
  }

  private async emailOf(tenantId: string, userId: string): Promise<string> {
    const user = await this.tenancy.withTenantTx({ tenantId }, (trx) =>
      trx.user_account.findUnique({ where: { id: userId }, select: { email: true } }),
    );
    return lowerEmail(user?.email ?? '');
  }

  private fieldError(violation: Parameters<typeof PasswordService.fieldError>[0]) {
    return PasswordService.fieldError(violation);
  }

  private async assertTokenEndpointNotThrottled(ipBucket: string): Promise<void> {
    const wait = await this.throttle.blockedFor(ipBucket, TOKEN_ENDPOINT_MAX_PER_IP);
    if (wait > 0) {
      throw new ApiProblem({
        code: 'too-many-requests',
        detail: 'Too many attempts. Try again later.',
        headers: { 'Retry-After': String(wait) },
      });
    }
  }

  private async failToken(
    ipBucket: string,
    eventType: 'password_reset_failed' | 'invitation_token_invalid',
    client: ClientInfo,
    tenantId?: string,
  ): Promise<void> {
    await this.throttle.hit(ipBucket);
    await this.securityLog.record({ eventType, tenantId, client });
  }

  // ------------------------------------------------------------------------------- invitations

  private async resolveInvitation(token: string, client: ClientInfo) {
    const ipBucket = `invite:ip:${client.ip ?? 'unknown'}`;
    await this.assertTokenEndpointNotThrottled(ipBucket);
    const found = await this.identity.findInvitationByTokenHash(hashToken(token));
    if (!found) {
      await this.failToken(ipBucket, 'invitation_token_invalid', client);
      throw authProblem.invitationNotFound();
    }
    const detail = await this.tenancy.withTenantTx({ tenantId: found.tenantId }, async (trx) => {
      const invitation = await trx.invitation.findUnique({
        where: { id: found.invitationId },
        include: { role: { select: { name: true, permissions: true } } },
      });
      if (!invitation || invitation.status !== 'pending' || !invitation.user_id) return null;
      const user = await trx.user_account.findUnique({ where: { id: invitation.user_id } });
      if (!user || user.archived_at || user.status !== 'invited') return null;
      const tenant = await trx.tenant.findUniqueOrThrow({ where: { id: found.tenantId } });
      return { invitation, user, tenant, mfaPolicy: await loadMfaPolicy(trx, found.tenantId) };
    });
    if (!detail) {
      await this.failToken(ipBucket, 'invitation_token_invalid', client, found.tenantId);
      throw authProblem.invitationNotFound();
    }
    if (
      detail.invitation.expires_at.getTime() <= Date.now() ||
      found.expiresAt.getTime() <= Date.now()
    ) {
      throw authProblem.invitationExpired();
    }
    return { found, ...detail };
  }

  async getInvitation(token: string, client: ClientInfo) {
    const d = await this.resolveInvitation(token, client);
    return {
      email: d.user.email,
      display_name: d.user.display_name,
      tenant_name: d.tenant.name,
      role_name: d.invitation.role.name,
      expires_at: d.invitation.expires_at.toISOString(),
      mfa_enrolment_required: mfaRequired(d.mfaPolicy, d.invitation.role.permissions),
    };
  }

  async acceptInvitation(
    body: { token: string; password: string; display_name: string },
    client: ClientInfo,
  ): Promise<AuthResult<LoginResponseDto>> {
    const d = await this.resolveInvitation(body.token, client);
    const violation = await this.passwords.validate(body.password);
    if (violation) throw problem.validation([this.fieldError(violation)]);
    const passwordHash = await this.passwords.hash(body.password);
    const tenantId = d.found.tenantId;

    const outcome = await this.tenancy.withTenantTx(
      { tenantId, actorId: d.user.id },
      async (trx) => {
        const claimed = await trx.invitation.updateMany({
          where: { id: d.invitation.id, status: 'pending', expires_at: { gt: new Date() } },
          data: { status: 'accepted', accepted_at: new Date() },
        });
        if (claimed.count === 0) throw authProblem.invitationNotFound();
        const user = await trx.user_account.update({
          where: { id: d.user.id },
          data: { status: 'active', display_name: body.display_name, last_login_at: new Date() },
        });
        await trx.credential.upsert({
          where: { tenant_id_user_id: { tenant_id: tenantId, user_id: user.id } },
          create: { tenant_id: tenantId, user_id: user.id, password_hash: passwordHash },
          update: {
            password_hash: passwordHash,
            password_changed_at: new Date(),
            failed_attempts: 0,
          },
        });
        await trx.login_identity.upsert({
          where: { tenant_id_user_id: { tenant_id: tenantId, user_id: user.id } },
          create: { tenant_id: tenantId, user_id: user.id, email_lower: lowerEmail(user.email) },
          update: { status: 'active' },
        });
        await trx.invitation_token.deleteMany({ where: { invitation_id: d.invitation.id } });
        const session = await this.sessions.create(trx, {
          tenantId,
          userId: user.id,
          mfaVerified: false,
          ip: client.ip,
          userAgent: client.userAgent,
        });
        const grants = await loadGrants(trx, user.id);
        await this.audit.write(trx, {
          action: 'invitation.accepted',
          entityType: 'user',
          entityId: user.id,
          meta: { invitation_id: d.invitation.id },
        });
        await this.audit.write(trx, {
          action: 'auth.login.succeeded',
          entityType: 'user',
          entityId: user.id,
          meta: { method: 'invitation', session_id: session.id },
        });
        return { session, user, grants };
      },
    );
    return {
      body: {
        status: 'authenticated',
        csrf_token: outcome.session.csrfToken,
        user: userDto(outcome.user, outcome.grants),
      },
      cookie: this.sessions.cookieFor(outcome.session.token, outcome.session.absoluteExpiresAt),
    };
  }
}
