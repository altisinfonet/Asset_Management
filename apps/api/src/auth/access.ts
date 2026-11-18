import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PolicyService, type PolicySubject } from './policy.service.js';

/**
 * Declared access rule of a route (M1-AUTH-01). EVERY route must carry exactly one; the auth guard
 * denies a route that has none (fail closed) and `test/auth/route-rules.test.ts` fails the build
 * when a controller route has no rule or disagrees with the contract's `x-permission` /
 * `x-self-service` / `security: []`.
 *
 *  - public:        no credential (login, invitation lookup, password policy...)
 *  - authenticated: any signed-in principal, session or API key (`/auth/me`, `/auth/logout`)
 *  - self-service:  any signed-in BROWSER session, no permission needed (`x-self-service: true`)
 *  - permission:    a `resource:action` permission (`x-permission`)
 */
export type AccessRule =
  | { kind: 'public' }
  | { kind: 'authenticated' }
  | { kind: 'self-service' }
  | { kind: 'permission'; permission: string };

export const ACCESS_RULE_KEY = 'auth:access-rule';
export const LIMITED_SESSION_KEY = 'auth:allow-limited-session';
export const NO_IDEMPOTENCY_KEY = 'auth:no-idempotency-key';

export const Public = () => SetMetadata(ACCESS_RULE_KEY, { kind: 'public' } satisfies AccessRule);
export const Authenticated = () =>
  SetMetadata(ACCESS_RULE_KEY, { kind: 'authenticated' } satisfies AccessRule);
export const SelfService = () =>
  SetMetadata(ACCESS_RULE_KEY, { kind: 'self-service' } satisfies AccessRule);
/** `@RequirePermission('asset:update')`: also what feeds the role matrix test. */
export const RequirePermission = (permission: string) =>
  SetMetadata(ACCESS_RULE_KEY, { kind: 'permission', permission } satisfies AccessRule);
/** The route still works on a LIMITED session (MFA enrolment pending): `/auth/me`, logout, `/auth/mfa/enrol*`. */
export const AllowLimitedSession = () => SetMetadata(LIMITED_SESSION_KEY, true);
/** The response carries secrets: an `Idempotency-Key` would store it for replay, so the header is rejected. */
export const NoIdempotencyKey = () => SetMetadata(NO_IDEMPOTENCY_KEY, true);

export function accessRuleOf(
  reflector: Reflector,
  targets: [handler: () => unknown, cls: abstract new (...args: never[]) => unknown],
): AccessRule | undefined {
  return reflector.getAllAndOverride<AccessRule | undefined>(ACCESS_RULE_KEY, targets);
}

export interface AccessSubject extends PolicySubject {
  method: 'session' | 'api_key';
}

export type AccessDecision = 'allow' | 'unauthorized' | 'forbidden';

const policy = new PolicyService();

/**
 * The decision the guard takes for a route rule and a principal (`null` = no credential). Pure, so
 * the role matrix test calls exactly what production calls.
 */
export function decideAccess(rule: AccessRule, subject: AccessSubject | null): AccessDecision {
  if (rule.kind === 'public') return 'allow';
  if (!subject) return 'unauthorized';
  switch (rule.kind) {
    case 'authenticated':
      return 'allow';
    case 'self-service':
      return subject.method === 'session' ? 'allow' : 'forbidden';
    case 'permission':
      return policy.can(subject, rule.permission) ? 'allow' : 'forbidden';
  }
}
