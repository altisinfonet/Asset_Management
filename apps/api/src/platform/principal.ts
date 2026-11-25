import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { ActorType } from '../context/request-context.js';
import { problem } from './problem.js';

/**
 * Who a request acts for, as established by authentication (M1-AUTH: session cookie or API key).
 * The tenant comes ONLY from the credential, never from a header or body field. The platform kernel
 * depends on this minimal shape, not on the auth module: the auth guard sets `request.principal`.
 */
export interface RequestPrincipal {
  tenantId: string;
  /** user id or api key id: the scope of an Idempotency-Key and `app.actor_id` of the transaction. */
  principalId: string;
  /** Who this is, for the audit trail (`audit_log.actor_type`). Defaults to `user` when absent. */
  actorType?: ActorType;
  /**
   * M2-LOC-03 (ED-26): root location ids of the subtrees this request is limited to; null/absent =
   * not limited. Computed by the auth guard from the grants that give the route's permission.
   */
  locationScope?: readonly string[] | null;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: RequestPrincipal;
  }
}

/** `@Principal() p: RequestPrincipal` (401 when the route was reached without authentication). */
export const Principal = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const principal = ctx.switchToHttp().getRequest<FastifyRequest>().principal;
  if (!principal) throw problem.unauthorized();
  return principal;
});
