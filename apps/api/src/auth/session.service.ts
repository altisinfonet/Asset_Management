import { createHash, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG } from '../config/config.module.js';
import type { AppConfig } from '../config/env.js';
import { generateToken, hashToken } from '../identity/index.js';
import { uuidv7 } from '../ids/uuidv7.js';
import { asBytes, TenancyService, type Tx } from '../tenancy/index.js';

/** `__Host-` prefix: the browser only accepts it with `Secure`, `Path=/` and no `Domain` (no subdomain sharing). */
export const SESSION_COOKIE = '__Host-at_session';

export interface CreatedSession {
  id: string;
  /** The cookie value. Only its SHA-256 is stored. */
  token: string;
  csrfToken: string;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

export interface SessionRow {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  ip: string | null;
  userAgent: string | null;
}

/** Writes at most this often per session when refreshing the idle timeout (one UPDATE a minute, not per request). */
const TOUCH_INTERVAL_MS = 60_000;

/**
 * Browser sessions (M1-AUTH-03): server-side rows in `identity.session`, an opaque 256-bit token in
 * the cookie (hashed at rest), idle and absolute expiry, rotation on login and privilege change, a
 * CSRF token derived from the token. Methods taking a `trx` run inside the caller's transaction so a
 * session change commits or rolls back together with its audit entry.
 */
@Injectable()
export class SessionService {
  private readonly idleMs: number;
  private readonly absoluteMs: number;

  constructor(
    private readonly tenancy: TenancyService,
    @Inject(APP_CONFIG) config: AppConfig,
  ) {
    this.idleMs = config.SESSION_IDLE_MINUTES * 60_000;
    this.absoluteMs = config.SESSION_ABSOLUTE_HOURS * 3_600_000;
  }

  /** CSRF token of a session: one-way derived from the cookie token, so it needs no storage and dies with the session. */
  csrfFor(token: string): string {
    return createHash('sha256').update(`csrf-v1:${token}`).digest('base64url');
  }

  csrfMatches(token: string, presented: string | undefined): boolean {
    if (!presented) return false;
    const expected = Buffer.from(this.csrfFor(token));
    const given = Buffer.from(presented);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** `Set-Cookie` value for a new session. */
  cookieFor(token: string, absoluteExpiresAt: Date): string {
    const maxAge = Math.max(0, Math.floor((absoluteExpiresAt.getTime() - Date.now()) / 1000));
    return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
  }

  clearCookie(): string {
    return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  }

  /** Session token from a `Cookie` request header. */
  tokenFromCookieHeader(header: string | undefined): string | undefined {
    if (!header) return undefined;
    for (const part of header.split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      if (part.slice(0, eq).trim() === SESSION_COOKIE) {
        const value = part.slice(eq + 1).trim();
        return value.length >= 16 && value.length <= 256 ? value : undefined;
      }
    }
    return undefined;
  }

  async create(
    trx: Tx,
    input: {
      tenantId: string;
      userId: string;
      mfaVerified: boolean;
      ip: string | null;
      userAgent: string | null;
      /** Keep the lifetime of the session being replaced (rotation must not extend the absolute limit). */
      absoluteExpiresAt?: Date;
      createdAt?: Date;
    },
  ): Promise<CreatedSession> {
    const now = Date.now();
    const absoluteExpiresAt = input.absoluteExpiresAt ?? new Date(now + this.absoluteMs);
    const idleExpiresAt = new Date(Math.min(now + this.idleMs, absoluteExpiresAt.getTime()));
    const token = generateToken();
    const id = uuidv7();
    await trx.session.create({
      data: {
        id,
        token_hash: asBytes(hashToken(token)),
        tenant_id: input.tenantId,
        user_id: input.userId,
        auth_method: 'password',
        mfa_verified_at: input.mfaVerified ? new Date(now) : null,
        idle_expires_at: idleExpiresAt,
        expires_at: absoluteExpiresAt,
        ip: input.ip,
        user_agent: input.userAgent,
      },
    });
    return { id, token, csrfToken: this.csrfFor(token), idleExpiresAt, absoluteExpiresAt };
  }

  /**
   * Replaces a session with a fresh id and token (login, MFA enrolment, privilege change): the old
   * one is revoked, so an identifier planted or leaked before the change is useless (session fixation).
   */
  async rotate(
    trx: Tx,
    current: { id: string; tenantId: string; userId: string; absoluteExpiresAt: Date },
    opts: { mfaVerified: boolean; ip: string | null; userAgent: string | null },
  ): Promise<CreatedSession> {
    const next = await this.create(trx, {
      tenantId: current.tenantId,
      userId: current.userId,
      mfaVerified: opts.mfaVerified,
      ip: opts.ip,
      userAgent: opts.userAgent,
      absoluteExpiresAt: current.absoluteExpiresAt,
    });
    await trx.session.updateMany({
      where: { id: current.id, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return next;
  }

  /** Unrevoked, unexpired sessions of a user, most recently active first. */
  async listActive(trx: Tx, tenantId: string, userId: string): Promise<SessionRow[]> {
    const now = new Date();
    const rows = await trx.session.findMany({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: now },
        idle_expires_at: { gt: now },
      },
      orderBy: [{ last_seen_at: 'desc' }, { id: 'desc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.created_at,
      lastSeenAt: r.last_seen_at,
      ip: r.ip,
      userAgent: r.user_agent,
    }));
  }

  /** Revokes one session of `userId`; false when it is not theirs, unknown or already revoked. */
  async revokeOne(trx: Tx, tenantId: string, userId: string, sessionId: string): Promise<boolean> {
    const result = await trx.session.updateMany({
      where: { id: sessionId, tenant_id: tenantId, user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    return result.count > 0;
  }

  /** Revokes every live session of a user (optionally keeping one). Returns how many. */
  async revokeAll(
    trx: Tx,
    tenantId: string,
    userId: string,
    exceptSessionId?: string,
  ): Promise<number> {
    const result = await trx.session.updateMany({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        revoked_at: null,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: { revoked_at: new Date() },
    });
    return result.count;
  }

  /** Pushes the idle timeout forward on activity (never past the absolute limit); throttled to one write a minute. */
  async touch(
    session: { id: string; lastSeenAt: Date; absoluteExpiresAt: Date },
    info: { ip: string | null; userAgent: string | null },
  ): Promise<Date> {
    const now = Date.now();
    const idle = new Date(Math.min(now + this.idleMs, session.absoluteExpiresAt.getTime()));
    if (now - session.lastSeenAt.getTime() < TOUCH_INTERVAL_MS) return idle;
    await this.tenancy.withPreTenantTx((trx) =>
      trx.session.updateMany({
        where: { id: session.id, revoked_at: null },
        data: {
          last_seen_at: new Date(now),
          idle_expires_at: idle,
          ip: info.ip,
          user_agent: info.userAgent,
        },
      }),
    );
    return idle;
  }
}
