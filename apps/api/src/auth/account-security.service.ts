import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { problem } from '../platform/index.js';
import { AUDIT_WRITER, type AuditWriter } from '../ports/index.js';
import { TenancyService, type Tx } from '../tenancy/index.js';
import { loadMfaPolicy, lowerEmail, mfaRequired } from './access-data.js';
import type { AuthContext, ClientInfo } from './auth-context.js';
import { AuthMailer } from './auth-mailer.service.js';
import type { SessionInfoDto } from './auth.dto.js';
import type { ReauthBody } from './auth.schemas.js';
import { MfaService } from './mfa.service.js';
import { PasswordService } from './password.service.js';
import { authProblem } from './problems.js';
import { SecurityLogService } from './security-log.service.js';
import { SessionService } from './session.service.js';
import { bucketKey, ThrottleService } from './throttle.service.js';

/**
 * The signed-in user's own security settings (M1-AUTH-03, M1-AUTH-04): TOTP enrolment and removal,
 * recovery codes, and the device list. Sensitive actions (disable MFA, regenerate recovery codes)
 * need re-authentication in the request body; a wrong value is `403 reauth-failed` (never 401) and
 * counts toward the same lockout as failed logins.
 */
@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly tenancy: TenancyService,
    private readonly mfa: MfaService,
    private readonly sessions: SessionService,
    private readonly passwords: PasswordService,
    private readonly throttle: ThrottleService,
    private readonly securityLog: SecurityLogService,
    private readonly mailer: AuthMailer,
    @Inject(AUDIT_WRITER) private readonly audit: AuditWriter,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private tx<T>(auth: AuthContext, fn: (trx: Tx) => Promise<T>): Promise<T> {
    return this.tenancy.withTenantTx({ tenantId: auth.tenantId, actorId: auth.userId }, fn);
  }

  // ------------------------------------------------------------------------------------------ MFA

  async startEnrolment(auth: AuthContext) {
    return this.tx(auth, (trx) =>
      this.mfa.startEnrolment(trx, {
        id: auth.userId,
        tenantId: auth.tenantId,
        email: auth.user.email,
      }),
    );
  }

  async confirmEnrolment(auth: AuthContext, code: string, client: ClientInfo) {
    const bucket = `mfa:enrol:${auth.userId}`;
    const wait = await this.throttle.blockedFor(bucket, this.config.LOGIN_MAX_FAILURES_PER_ACCOUNT);
    if (wait > 0) throw authProblem.accountLocked(wait);

    const user = { id: auth.userId, tenantId: auth.tenantId };
    const result = await this.tx(auth, async (trx) => {
      if (await this.mfa.hasActiveFactor(trx, user.id)) throw authProblem.mfaAlreadyEnrolled();
      if (!(await this.mfa.hasPendingFactor(trx, user.id))) {
        throw problem.conflict(
          'No MFA enrolment is pending. Start one with POST /v1/auth/mfa/enrol.',
        );
      }
      if (!(await this.mfa.verifyTotp(trx, user, code, 'pending'))) return { ok: false as const };

      const recoveryCodes = await this.mfa.activate(trx, user);
      // Becoming MFA-verified is a privilege change: new session id, old one dead.
      const session = await this.sessions.rotate(
        trx,
        {
          id: auth.sessionId!,
          tenantId: auth.tenantId,
          userId: auth.userId,
          absoluteExpiresAt: auth.session!.absoluteExpiresAt,
        },
        { mfaVerified: true, ip: client.ip, userAgent: client.userAgent },
      );
      await this.audit.write(trx, {
        action: 'auth.mfa.enabled',
        entityType: 'user',
        entityId: user.id,
        meta: { method: 'totp', session_rotated: true },
      });
      const tenant = await trx.tenant.findUniqueOrThrow({
        where: { id: auth.tenantId },
        select: { name: true },
      });
      return { ok: true as const, recoveryCodes, session, tenantName: tenant.name };
    });

    if (!result.ok) {
      await this.throttle.hit(bucket);
      await this.securityLog.record({
        eventType: 'mfa_failed',
        tenantId: auth.tenantId,
        subject: auth.userId,
        client,
        detail: { stage: 'enrolment' },
      });
      throw authProblem.mfaInvalidCode(422);
    }
    await this.throttle.reset(bucket);
    await this.mailer.mfaEnabled({
      to: auth.user.email,
      displayName: auth.user.displayName,
      tenantName: result.tenantName,
      locale: auth.user.locale,
    });
    return {
      body: { recovery_codes: result.recoveryCodes, csrf_token: result.session.csrfToken },
      cookie: this.sessions.cookieFor(result.session.token, result.session.absoluteExpiresAt),
    };
  }

  /** Verifies the password or TOTP code of the signed-in user; throws 403 `reauth-failed` / 429 on lockout. */
  private async reauthenticate(trx: Tx, auth: AuthContext, body: ReauthBody): Promise<void> {
    const bucket = `login:acct:${bucketKey(lowerEmail(auth.user.email))}`;
    const wait = await this.throttle.blockedFor(bucket, this.config.LOGIN_MAX_FAILURES_PER_ACCOUNT);
    if (wait > 0) throw authProblem.accountLocked(wait);

    let ok = false;
    if (body.password !== undefined) {
      const credential = await trx.credential.findUnique({
        where: { tenant_id_user_id: { tenant_id: auth.tenantId, user_id: auth.userId } },
      });
      ok = credential
        ? await this.passwords.verify(credential.password_hash, body.password)
        : await this.passwords.verifyDummy(body.password);
    } else if (body.totp_code !== undefined) {
      ok = await this.mfa.verifyTotp(
        trx,
        { id: auth.userId, tenantId: auth.tenantId },
        body.totp_code,
        'active',
      );
    }
    if (!ok) {
      await this.throttle.hit(bucket);
      throw authProblem.reauthFailed();
    }
  }

  async regenerateRecoveryCodes(auth: AuthContext, body: ReauthBody) {
    const codes = await this.tx(auth, async (trx) => {
      if (!(await this.mfa.hasActiveFactor(trx, auth.userId))) {
        throw problem.conflict('MFA is not enabled for this user.');
      }
      await this.reauthenticate(trx, auth, body);
      const fresh = await this.mfa.replaceRecoveryCodes(trx, {
        id: auth.userId,
        tenantId: auth.tenantId,
      });
      await this.audit.write(trx, {
        action: 'auth.mfa.recovery_codes_regenerated',
        entityType: 'user',
        entityId: auth.userId,
      });
      return fresh;
    });
    return { recovery_codes: codes };
  }

  async disableMfa(auth: AuthContext, body: ReauthBody): Promise<void> {
    await this.tx(auth, async (trx) => {
      if (!(await this.mfa.hasActiveFactor(trx, auth.userId))) {
        throw problem.conflict('MFA is not enabled for this user.');
      }
      await this.reauthenticate(trx, auth, body);
      const policy = await loadMfaPolicy(trx, auth.tenantId);
      if (mfaRequired(policy, auth.permissions)) throw authProblem.mfaRequiredByPolicy();

      await this.mfa.removeAll(trx, auth.userId);
      const revoked = await this.sessions.revokeAll(
        trx,
        auth.tenantId,
        auth.userId,
        auth.sessionId ?? undefined,
      );
      await this.audit.write(trx, {
        action: 'auth.mfa.disabled',
        entityType: 'user',
        entityId: auth.userId,
        meta: { sessions_revoked: revoked },
      });
    });
  }

  // ------------------------------------------------------------------------------------ sessions

  async listMySessions(auth: AuthContext): Promise<{ data: SessionInfoDto[] }> {
    const rows = await this.tx(auth, (trx) =>
      this.sessions.listActive(trx, auth.tenantId, auth.userId),
    );
    return {
      data: rows.map((r) => ({
        id: r.id,
        created_at: r.createdAt.toISOString(),
        last_seen_at: r.lastSeenAt.toISOString(),
        ip: r.ip,
        user_agent: r.userAgent,
        current: r.id === auth.sessionId,
      })),
    };
  }

  async revokeMySession(auth: AuthContext, sessionId: string): Promise<void> {
    if (sessionId === auth.sessionId) throw authProblem.cannotRevokeCurrent();
    await this.tx(auth, async (trx) => {
      if (!(await this.sessions.revokeOne(trx, auth.tenantId, auth.userId, sessionId))) {
        throw problem.notFound('Session not found.');
      }
      await this.audit.write(trx, {
        action: 'session.revoked',
        entityType: 'session',
        entityId: sessionId,
        meta: { user_id: auth.userId, by: 'self' },
      });
    });
  }

  async revokeOtherSessions(auth: AuthContext): Promise<void> {
    await this.tx(auth, async (trx) => {
      const count = await this.sessions.revokeAll(
        trx,
        auth.tenantId,
        auth.userId,
        auth.sessionId ?? undefined,
      );
      await this.audit.write(trx, {
        action: 'session.revoked',
        entityType: 'user',
        entityId: auth.userId,
        meta: { count, by: 'self', scope: 'others' },
      });
    });
  }
}
