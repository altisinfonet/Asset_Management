import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { ControlPlaneService, TenantInactiveError } from '../control-plane/index.js';
import { hashToken, IdentityLookupService } from '../identity/index.js';
import { problem } from '../platform/index.js';
import { TenancyService } from '../tenancy/index.js';
import { loadGrants, loadMfaPolicy, mfaRequired, tenantSlugFromHost } from './access-data.js';
import { type AuthContext, clientInfo } from './auth-context.js';
import { authProblem } from './problems.js';
import { PolicyService } from './policy.service.js';
import { SecurityLogService } from './security-log.service.js';
import { SessionService } from './session.service.js';

const API_KEY_PATTERN = /^([A-Za-z0-9]{8,16})\.([A-Za-z0-9_-]{20,128})$/;
/** Same cost for a key prefix that does not exist as for one that does. */
const DUMMY_HASH = createHash('sha256').update('no-such-api-key').digest();
const KEY_TOUCH_INTERVAL_MS = 60_000;

/**
 * Turns the credential on a request into an {@link AuthContext} (M1-AUTH-03, M1-AUTH-06): a session
 * cookie or an `Authorization: Bearer <prefix>.<secret>` API key, and NOTHING else. The tenant comes
 * from the stored credential, never from a header, query or body (a hostname hint can only
 * contradict it, which is refused). Throws 401 / 403 problems; never returns a partial context.
 */
@Injectable()
export class AuthenticationService {
  constructor(
    private readonly identity: IdentityLookupService,
    private readonly controlPlane: ControlPlaneService,
    private readonly tenancy: TenancyService,
    private readonly sessions: SessionService,
    private readonly policy: PolicyService,
    private readonly securityLog: SecurityLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** `null` when the request carries no credential at all. */
  async authenticate(request: FastifyRequest): Promise<AuthContext | null> {
    const authorization = request.headers.authorization;
    if (authorization !== undefined) {
      const match = /^Bearer\s+(\S+)$/i.exec(authorization);
      if (!match)
        throw problem.unauthorized('The Authorization header must be "Bearer <api key>".');
      return this.authenticateApiKey(request, match[1]!);
    }
    const token = this.sessions.tokenFromCookieHeader(request.headers.cookie);
    if (!token) return null;
    return this.authenticateSession(request, token);
  }

  private async assertTenantUsable(request: FastifyRequest, tenantId: string): Promise<string> {
    let slug: string;
    try {
      slug = (await this.controlPlane.assertTenantActive(tenantId)).slug;
    } catch (err) {
      if (err instanceof TenantInactiveError) {
        await this.securityLog.record({
          eventType: 'tenant_inactive',
          tenantId,
          client: clientInfo(request),
          detail: { status: err.status },
        });
        throw problem.forbidden('This workspace is not active.');
      }
      throw err;
    }
    this.assertHostMatches(request, slug);
    return slug;
  }

  /**
   * Hostname hint (M1-AUTH-06): with `TENANT_HOST_SUFFIX=assettracker.test`, a request to
   * `acme.assettracker.test` carrying tenant B's credential is refused instead of served.
   */
  private assertHostMatches(request: FastifyRequest, tenantSlug: string): void {
    const hinted = tenantSlugFromHost(request.headers.host, this.config.TENANT_HOST_SUFFIX);
    if (hinted && hinted !== tenantSlug) {
      throw problem.forbidden('The hostname does not belong to the authenticated workspace.');
    }
  }

  private async authenticateSession(request: FastifyRequest, token: string): Promise<AuthContext> {
    const row = await this.identity.findSessionByTokenHash(hashToken(token));
    const now = Date.now();
    if (
      !row ||
      row.revokedAt ||
      row.expiresAt.getTime() <= now ||
      row.idleExpiresAt.getTime() <= now
    ) {
      await this.securityLog.record({
        eventType: 'session_invalid',
        ...(row ? { tenantId: row.tenantId } : {}),
        client: clientInfo(request),
        detail: { reason: !row ? 'unknown' : row.revokedAt ? 'revoked' : 'expired' },
      });
      throw authProblem.sessionExpired();
    }
    await this.assertTenantUsable(request, row.tenantId);

    const loaded = await this.tenancy.withTenantTx(
      { tenantId: row.tenantId, actorId: row.userId },
      async (trx) => {
        const user = await trx.user_account.findUnique({ where: { id: row.userId } });
        if (!user || user.archived_at || user.status !== 'active') return null;
        return {
          user,
          grants: await loadGrants(trx, user.id),
          mfaPolicy: await loadMfaPolicy(trx, row.tenantId),
        };
      },
    );
    if (!loaded) throw authProblem.sessionExpired();
    const { user, grants, mfaPolicy } = loaded;

    const subject = { grants };
    const permissions = this.policy.effectivePermissions(subject);
    const info = clientInfo(request);
    const idleExpiresAt = await this.sessions.touch(
      { id: row.sessionId, lastSeenAt: row.lastSeenAt, absoluteExpiresAt: row.expiresAt },
      info,
    );

    return {
      method: 'session',
      tenantId: row.tenantId,
      userId: user.id,
      principalId: user.id,
      sessionId: row.sessionId,
      apiKeyId: null,
      apiKeyScopes: null,
      sessionToken: token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        status: user.status,
        locale: user.locale,
        timezone: user.timezone,
        mfaEnabled: user.mfa_enabled,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        version: user.version,
      },
      grants,
      permissions,
      mfaVerified: row.mfaVerifiedAt !== null,
      mfaEnrolmentRequired: mfaRequired(mfaPolicy, permissions) && !user.mfa_enabled,
      session: { idleExpiresAt, absoluteExpiresAt: row.expiresAt },
      csrfToken: this.sessions.csrfFor(token),
    };
  }

  private async authenticateApiKey(request: FastifyRequest, bearer: string): Promise<AuthContext> {
    const info = clientInfo(request);
    const parsed = API_KEY_PATTERN.exec(bearer);
    const lookup = parsed ? await this.identity.findApiKeyByPrefix(parsed[1]!) : null;
    // Compare against a dummy when the prefix is unknown: same work either way.
    const presented = createHash('sha256')
      .update(parsed?.[2] ?? '')
      .digest();
    const expected = lookup?.keyHash ?? DUMMY_HASH;
    const equal =
      expected.length === presented.length && timingSafeEqual(expected, presented) && !!lookup;
    if (!lookup || !equal) {
      await this.securityLog.record({
        eventType: 'api_key_invalid',
        subject: parsed?.[1],
        client: info,
      });
      throw problem.unauthorized('The API key is not valid.');
    }
    await this.assertTenantUsable(request, lookup.tenantId);

    const loaded = await this.tenancy.withTenantTx(
      { tenantId: lookup.tenantId, actorId: lookup.apiKeyId },
      async (trx) => {
        const key = await trx.api_key.findUnique({ where: { id: lookup.apiKeyId } });
        if (!key || key.revoked_at || (key.expires_at && key.expires_at.getTime() <= Date.now())) {
          return null;
        }
        if (!key.created_by) return null;
        const user = await trx.user_account.findUnique({ where: { id: key.created_by } });
        if (!user || user.archived_at || user.status !== 'active') return null;
        if (!key.last_used_at || Date.now() - key.last_used_at.getTime() > KEY_TOUCH_INTERVAL_MS) {
          await trx.api_key.update({
            where: { id: key.id },
            data: { last_used_at: new Date(), last_used_ip: info.ip },
          });
        }
        return { key, user, grants: await loadGrants(trx, user.id) };
      },
    );
    if (!loaded) {
      await this.securityLog.record({
        eventType: 'api_key_invalid',
        tenantId: lookup.tenantId,
        subject: lookup.keyPrefix,
        client: info,
        detail: { reason: 'revoked-expired-or-owner-inactive' },
      });
      throw problem.unauthorized('The API key is not valid.');
    }
    const { key, user, grants } = loaded;
    const subject = { grants, keyScopes: key.scopes };
    return {
      method: 'api_key',
      tenantId: lookup.tenantId,
      userId: user.id,
      principalId: key.id,
      sessionId: null,
      apiKeyId: key.id,
      apiKeyScopes: key.scopes,
      sessionToken: null,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.display_name,
        status: user.status,
        locale: user.locale,
        timezone: user.timezone,
        mfaEnabled: user.mfa_enabled,
        lastLoginAt: user.last_login_at,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        version: user.version,
      },
      grants,
      permissions: this.policy.effectivePermissions(subject),
      mfaVerified: false,
      mfaEnrolmentRequired: false,
      session: null,
      csrfToken: null,
    };
  }
}
