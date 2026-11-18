import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
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
