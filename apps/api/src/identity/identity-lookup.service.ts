import { Injectable } from '@nestjs/common';
import { TenancyService, type Tx } from '../tenancy/index.js';
import { uuidv7 } from '../ids/uuidv7.js';

export interface LoginCandidate {
  tenantId: string;
  userId: string;
  tenantSlug: string;
  tenantStatus: 'active' | 'suspended' | 'pending_deletion';
}

export interface ApiKeyLookupResult {
  keyPrefix: string;
  keyHash: Buffer;
  tenantId: string;
  apiKeyId: string;
}

export interface SessionLookupResult {
  sessionId: string;
  tenantId: string;
  userId: string;
  authMethod: 'password' | 'oidc' | 'saml';
  mfaVerifiedAt: Date | null;
  idleExpiresAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
}

export interface InvitationTokenLookupResult {
  tenantId: string;
  invitationId: string;
  expiresAt: Date;
}

export interface SecurityEventInput {
  eventType: 'login_failed' | 'api_key_invalid' | 'session_invalid' | 'tenant_inactive' | 'other';
  tenantId?: string;
  /** email (lower-cased), key prefix, ...: never a secret. */
  subject?: string;
  ip?: string;
  userAgent?: string;
  requestId?: string;
  detail?: Record<string, unknown>;
}

/**
 * Pre-tenant lookups (M1-TEN-08): authentication runs BEFORE the tenant is known, so these read the
 * `identity` schema (hashes and ids only, no RLS) outside any tenant context. Nothing here can reach
 * a tenant table: with no tenant set RLS returns zero rows (verified in test/identity.e2e.test.ts).
 * The auth module (M1-AUTH) is the only intended caller.
 */
@Injectable()
export class IdentityLookupService {
  constructor(private readonly tenancy: TenancyService) {}

  /** Which tenants / accounts exist for this email address (the same email may exist in several). */
  async findLoginCandidates(email: string): Promise<LoginCandidate[]> {
    const rows = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.login_identity as li')
        .innerJoin('identity.tenant_directory as td', 'td.tenant_id', 'li.tenant_id')
        .select(['li.tenant_id', 'li.user_id', 'td.slug', 'td.status'])
        .where('li.email_lower', '=', email.trim().toLowerCase())
        .where('li.status', '=', 'active')
        .orderBy('td.created_at')
        .execute(),
    );
    return rows.map((r) => ({
      tenantId: r.tenant_id,
      userId: r.user_id,
      tenantSlug: r.slug,
      tenantStatus: r.status,
    }));
  }

  /** `<prefix>.<secret>` Bearer keys: lookup by prefix; the caller compares the SHA-256 in constant time. */
  async findApiKeyByPrefix(keyPrefix: string): Promise<ApiKeyLookupResult | null> {
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.api_key_lookup')
        .select(['key_prefix', 'key_hash', 'tenant_id', 'api_key_id'])
        .where('key_prefix', '=', keyPrefix)
        .executeTakeFirst(),
    );
    return row
      ? {
          keyPrefix: row.key_prefix,
          keyHash: row.key_hash,
          tenantId: row.tenant_id,
          apiKeyId: row.api_key_id,
        }
      : null;
  }

  /** Session cookie token hash -> (tenant, user). Expiry/revocation are the caller's decision. */
  async findSessionByTokenHash(tokenHash: Buffer): Promise<SessionLookupResult | null> {
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.session')
        .select([
          'id',
          'tenant_id',
          'user_id',
          'auth_method',
          'mfa_verified_at',
          'idle_expires_at',
          'expires_at',
          'revoked_at',
        ])
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst(),
    );
    return row
      ? {
          sessionId: row.id,
          tenantId: row.tenant_id,
          userId: row.user_id,
          authMethod: row.auth_method,
          mfaVerifiedAt: row.mfa_verified_at,
          idleExpiresAt: new Date(row.idle_expires_at),
          expiresAt: new Date(row.expires_at),
          revokedAt: row.revoked_at,
        }
      : null;
  }

  async findInvitationByTokenHash(tokenHash: Buffer): Promise<InvitationTokenLookupResult | null> {
    const row = await this.tenancy.withPreTenantTx((trx) =>
      trx
        .selectFrom('identity.invitation_token')
        .select(['tenant_id', 'invitation_id', 'expires_at'])
        .where('token_hash', '=', tokenHash)
        .executeTakeFirst(),
    );
    return row
      ? {
          tenantId: row.tenant_id,
          invitationId: row.invitation_id,
          expiresAt: new Date(row.expires_at),
        }
      : null;
  }

  /** Failed logins and invalid API keys go to the control-plane security log, not the tenant audit log. */
  async recordSecurityEvent(event: SecurityEventInput): Promise<void> {
    await this.tenancy.withPreTenantTx((trx) => insertSecurityEvent(trx, event));
  }
}

export async function insertSecurityEvent(trx: Tx, event: SecurityEventInput): Promise<void> {
  await trx
    .insertInto('identity.security_event')
    .values({
      id: uuidv7(),
      event_type: event.eventType,
      tenant_id: event.tenantId ?? null,
      subject: event.subject ?? null,
      ip: event.ip ?? null,
      user_agent: event.userAgent ?? null,
      request_id: event.requestId ?? null,
      detail: event.detail ?? {},
    })
    .execute();
}
