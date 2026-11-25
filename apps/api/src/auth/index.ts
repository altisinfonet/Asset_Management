// Public facade of the auth module (M1-AUTH). Other modules import from here only.
//
// A domain controller declares ONE access rule per route:
//   @RequirePermission('asset:update')   a `resource:action` permission (the common case)
//   @Authenticated() / @SelfService()    any signed-in principal / any signed-in browser session
//   @Public()                            no credential (health probes, login...)
// and receives the caller with `@CurrentAuth() auth` (user, permissions, role grants) or just
// `@Principal() p` from the platform kernel ({tenantId, principalId}). A route without a rule is
// denied by the global AuthGuard and fails the route-rules test.
export {
  AllowLimitedSession,
  Authenticated,
  NoIdempotencyKey,
  Public,
  RequirePermission,
  SelfService,
  decideAccess,
  type AccessDecision,
  type AccessRule,
  type AccessSubject,
} from './access.js';
export { AuthModule } from './auth.module.js';
export { ThrottleService } from './throttle.service.js';
export { CurrentAuth, clientInfo, type AuthContext, type ClientInfo } from './auth-context.js';
export {
  ADMIN_MARKER_PERMISSIONS,
  BUILTIN_ROLES,
  BUILTIN_ROLE_KEYS,
  PERMISSIONS,
  ORG_ONLY_PERMISSIONS,
  WILDCARD,
  type BuiltinRole,
  type Permission,
} from './permissions.js';
export {
  PolicyService,
  grantPermissions,
  isSubset,
  locationScopeFor,
  permits,
  type GrantedRole,
  type PolicyResource,
  type PolicySubject,
} from './policy.service.js';
export { AUTH_PROBLEM_CODES, authProblem } from './problems.js';
export { SESSION_COOKIE, SESSION_COOKIE_INSECURE, sessionCookieName } from './session.service.js';
export {
  DEMO_OWNER_TOTP_SECRET,
  DEMO_PASSWORD,
  seedDemoLogins,
  type DemoLoginsResult,
} from './demo-credentials.js';
