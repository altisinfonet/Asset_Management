import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import type { Observable } from 'rxjs';
import { bindRequestIdentity } from '../context/request-context.js';

/**
 * Copies the authenticated principal (set by the auth guard) into the request context, so that for
 * the rest of the request the logger mixin (`tenant_id`, `actor_id`), the trace span and the audit
 * writer (actor type) know who acts. Runs after guards, before the handler. Requests without a
 * principal (probes, login) are left anonymous.
 */
@Injectable()
export class RequestIdentityInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const principal = request.principal;
    if (principal) {
      bindRequestIdentity({
        tenantId: principal.tenantId,
        actorId: principal.principalId,
        ...(principal.actorType ? { actorType: principal.actorType } : {}),
      });
    }
    return next.handle();
  }
}
