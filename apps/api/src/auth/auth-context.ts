import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { problem } from '../platform/index.js';
import type { GrantedRole } from './policy.service.js';

/** Everything the guard established about the caller; set on `request.auth` next to `request.principal`. */
export interface AuthContext {
  method: 'session' | 'api_key';
  tenantId: string;
  /** The user (also for an API key: the user that created it). */
  userId: string;
  /** user id for sessions, api key id for keys: the idempotency scope and `app.actor_id`. */
  principalId: string;
  sessionId: string | null;
  apiKeyId: string | null;
  apiKeyScopes: readonly string[] | null;
  /** The raw cookie token of the current session (never logged, never returned). */
  sessionToken: string | null;
  user: {
    id: string;
    email: string;
    displayName: string;
    status: string;
    locale: string | null;
    timezone: string | null;
    mfaEnabled: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    version: number;
  };
  grants: readonly GrantedRole[];
  /** Effective permissions (role union; for keys, the key scopes the creator still holds). */
  permissions: readonly string[];
  mfaVerified: boolean;
  /** The tenant requires MFA for this user and they have not enrolled: the session is limited. */
  mfaEnrolmentRequired: boolean;
  session: { idleExpiresAt: Date; absoluteExpiresAt: Date } | null;
  csrfToken: string | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
}

/** `@CurrentAuth() auth: AuthContext` (401 when the route was reached without authentication). */
export const CurrentAuth = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const auth = ctx.switchToHttp().getRequest<FastifyRequest>().auth;
  if (!auth) throw problem.unauthorized();
  return auth;
});

export interface ClientInfo {
  ip: string | null;
  userAgent: string | null;
  /** The Host header (tenant hostname hint), if any. */
  host: string | null;
}

/** Client address as Fastify resolved it (trustProxy is on) and the user agent, truncated. */
export function clientInfo(request: FastifyRequest): ClientInfo {
  const ua = request.headers['user-agent'];
  return {
    ip: request.ip || null,
    userAgent: typeof ua === 'string' ? ua.slice(0, 300) : null,
    host: request.headers.host ?? null,
  };
}

/** `@Client() info: ClientInfo`. */
export const Client = createParamDecorator((_data: unknown, ctx: ExecutionContext) =>
  clientInfo(ctx.switchToHttp().getRequest<FastifyRequest>()),
);
