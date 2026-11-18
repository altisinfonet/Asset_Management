import { type CanActivate, type ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import {
  ACCESS_RULE_KEY,
  type AccessRule,
  LIMITED_SESSION_KEY,
  NO_IDEMPOTENCY_KEY,
  decideAccess,
} from './access.js';
import { clientInfo } from './auth-context.js';
import { AuthenticationService } from './authentication.service.js';
import { authProblem } from './problems.js';
import { ApiProblem, problem } from '../platform/index.js';
import { SecurityLogService } from './security-log.service.js';
import { SessionService } from './session.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * The request pipeline's authentication and authorisation step (M1-AUTH-01, -03, -06), registered
 * globally. For every route, in this order:
 *
 *  1. the route's declared access rule (none: denied, fail closed);
 *  2. public routes pass untouched;
 *  3. authenticate: session cookie or API key; this is the ONLY place `request.principal` is set;
 *  4. a limited session (tenant requires MFA, user not enrolled) may only reach routes marked so;
 *  5. CSRF for cookie-authenticated mutations (`X-CSRF-Token` bound to the session);
 *  6. authorise: `decideAccess(rule, subject)` (permission / self-service / authenticated).
 *
 * The handler then runs inside `withTenantTx` for `request.principal.tenantId`.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly authentication: AuthenticationService,
    private readonly sessions: SessionService,
    private readonly securityLog: SecurityLogService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const targets = [context.getHandler(), context.getClass()];
    const rule = this.reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE_KEY, targets);

    if (!rule) {
      this.logger.error(
        `route ${request.method} ${request.url.split('?')[0]} has no declared access rule: denied`,
      );
      throw problem.forbidden('This route has no declared access rule.');
    }
    if (rule.kind === 'public') return true;

    if (
      this.reflector.getAllAndOverride<boolean | undefined>(NO_IDEMPOTENCY_KEY, targets) &&
      request.headers['idempotency-key'] !== undefined
    ) {
      throw new ApiProblem({
        code: 'idempotency-key-invalid',
        detail: 'This operation returns secrets and does not accept an Idempotency-Key.',
      });
    }

    const auth = await this.authentication.authenticate(request);
    if (!auth) throw problem.unauthorized();

    if (
      auth.mfaEnrolmentRequired &&
      !this.reflector.getAllAndOverride<boolean | undefined>(LIMITED_SESSION_KEY, targets)
    ) {
      throw authProblem.mfaEnrolmentRequired();
    }

    if (auth.method === 'session' && !SAFE_METHODS.has(request.method)) {
      const header = request.headers['x-csrf-token'];
      const presented = Array.isArray(header) ? header[0] : header;
      if (!this.sessions.csrfMatches(auth.sessionToken!, presented)) {
        await this.securityLog.record({
          eventType: 'csrf_rejected',
          tenantId: auth.tenantId,
          client: clientInfo(request),
          detail: { path: request.url.split('?')[0], method: request.method },
        });
        throw authProblem.csrfInvalid();
      }
    }

    const decision = decideAccess(rule, {
      method: auth.method,
      grants: auth.grants,
      keyScopes: auth.apiKeyScopes,
    });
    if (decision !== 'allow') {
      throw decision === 'unauthorized'
        ? problem.unauthorized()
        : problem.forbidden(
            rule.kind === 'self-service'
              ? 'This operation needs a browser session, not an API key.'
              : undefined,
          );
    }

    request.auth = auth;
    request.principal = { tenantId: auth.tenantId, principalId: auth.principalId };
    return true;
  }
}
