# Authentication and access: design notes and ASVS L2 checklist

Status: M1-AUTH-01 to 08 implemented in `apps/api/src/auth` (module `AuthModule`). Contract: `openapi.yaml` tags Auth and Access, ED-14 in `decisions.md`. Tests: `apps/api/test/auth/*.e2e.test.ts` and `apps/api/src/auth/*.test.ts`.

## 1. How a request is authenticated and authorised

`AuthGuard` is a global guard. For every route, in this order:

1. The route must declare one access rule (`@Public`, `@Authenticated`, `@SelfService` or `@RequirePermission('resource:action')`). No rule means the request is denied (fail closed) and the `route-rules` test fails the build.
2. Public routes pass. Otherwise the credential is resolved: `Authorization: Bearer <prefix>.<secret>` (API key) or the `__Host-at_session` cookie. These are the **only** sources of the tenant; a tenant id in a header, query or body is never read.
3. The tenant must be `active` (control plane) and, when `TENANT_HOST_SUFFIX` is set, the hostname hint must not contradict the credential's tenant.
4. A *limited* session (tenant policy requires MFA, the user has not enrolled) only reaches routes marked `@AllowLimitedSession` (`/auth/me`, logout, `/auth/mfa/enrol*`); everything else is `403 mfa-enrolment-required`.
5. Cookie-authenticated mutations need `X-CSRF-Token`.
6. `decideAccess(rule, subject)` decides (permission held, or browser session for self-service).
7. `request.principal = { tenantId, principalId }` is set and the handler runs inside `withTenantTx` for that tenant.

`PolicyService.can(subject, permission, resource?)` is the single authorisation entry point. A role assignment may be scoped to the tenant (enforced), a company or a location subtree (storage and `can()` are ready; location-scoped assignments are refused until `app.location` exists in M2, ED-07).

Built-in roles (`src/auth/permissions.ts`, seeded per tenant by `app.provision_tenant`, migration 0011): `tenant_admin` (`*`), `asset_manager`, `technician`, `auditor`, `viewer`; all hold `search:read` (ED-14). The catalogue is exactly the set of `x-permission` values of the contract (test `role-matrix`).

Privilege rules (UsersService): a grantor can never hand out a role holding permissions it does not hold itself; a user manager cannot modify, archive, reset or end sessions of a more privileged user; the last active `tenant_admin` cannot be demoted, disabled or archived (409); role change, disabling and archiving revoke the user's sessions; revoking an invitation archives the never-activated account.

## 2. Passwords

* argon2id (`@node-rs/argon2`, prebuilt binaries, no install script), parameters `m=19456 KiB, t=2, p=1` (OWASP minimum), configurable by `ARGON2_*`. The PHC string stores the parameters.
* Policy: 12 to 128 Unicode code points after NFKC, no composition rules (`GET /v1/auth/password-policy`).
* Breached passwords: bundled list `src/auth/data/breached-passwords.ts` (10,000 entries of 12 or more characters, lower-cased, most frequent first). Sources, both from SecLists (MIT licence, https://github.com/danielmiessler/SecLists): `Passwords/Common-Credentials/100k-most-used-passwords-NCSC.txt` (UK NCSC, Open Government Licence v3.0) and `xato-net-10-million-passwords-1000000.txt` (Mark Burnett's public release). Shorter entries are omitted because the minimum length already rejects them. Optional online provider: `BREACHED_PASSWORD_ONLINE=true` (Have I Been Pwned range API, k-anonymity: only the first 5 hex characters of the SHA-1 leave the server; a network failure fails open and is logged).
* Login: unknown email and wrong password give the same `401 invalid-credentials`, with one argon2 verification of equal cost either way (a dummy hash with the current parameters). Failures are throttled per account (hash of the email, so an unknown email locks identically) and per IP: `LOGIN_MAX_FAILURES_PER_ACCOUNT` (5) then `429 account-locked`, `LOGIN_MAX_FAILURES_PER_IP` (30) then `429 too-many-requests`, both with `Retry-After`, window `AUTH_THROTTLE_WINDOW_MINUTES` (15). Counters live in `identity.auth_throttle` (Redis is in the backlog text but not in the M1 stack; the store is behind `ThrottleService`). Failed attempts go to the control-plane `identity.security_event` log, never to the tenant audit log.
* Client address and `TRUST_PROXY`: per-IP throttling, security events and audit rows use the address Fastify resolves from `X-Forwarded-For`, which a client can forge unless only trusted proxies are believed. `TRUST_PROXY` (env, `apps/api/src/config/trust-proxy.ts`) defaults to **`false`**: the header is ignored and the TCP peer is the client. Behind a load balancer or reverse proxy set it to the proxies' addresses (`TRUST_PROXY=10.0.0.0/8,172.16.0.0/12`, comma-separated IPs/CIDRs; this is the recommended form), or to a hop count (`TRUST_PROXY=1`) when the API is reachable *only* through those proxies (the TCP peer itself is not validated in that mode). `true` trusts every hop and is for tests only; an unparsable value stops the process at startup. Fastify treats a bare number as "trust nobody", so the hop count is mapped to its function form (`toFastifyTrustProxy`). `test/auth/trust-proxy.e2e.test.ts` proves a spoofed header is ignored by default. Local `docker compose` leaves it unset (the browser reaches the API through the web dev proxy; every dev client then shares one address). The per-account lock does not depend on the IP.

## 3. Sessions

Opaque 256-bit token in a `__Host-at_session` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`, no `Domain`); only its SHA-256 is stored in `identity.session`. Idle timeout (`SESSION_IDLE_MINUTES`, 30) slides on activity, written at most once a minute; absolute timeout (`SESSION_ABSOLUTE_HOURS`, 12) never moves. Both are returned in `Me.session`. A new id is issued at login and when MFA is enrolled (rotation keeps the absolute limit); password reset, role change, disabling and archiving revoke sessions. CSRF token = one-way hash of the session token (no storage, dies with the session); returned by login and `me`. After MFA enrolment the session is rotated, so the confirm response carries a fresh `csrf_token` (an addition to the contract).

## 4. MFA (TOTP) and tenant enforcement

RFC 6238 TOTP (SHA-1, 6 digits, 30 s, window of one step either side), implemented in `totp.ts` and checked against the RFC vectors. The secret is encrypted through the `SECRET_BOX` port with context `mfa-totp:<tenant>:<user>`. A code of a time step at or before the last accepted one is a replay and is rejected (`last_used_step`). Ten recovery codes (80 bits each) are stored as SHA-256 hashes and are single use. A login challenge is a random token (hashed at rest), valid 5 minutes, 5 attempts, single use. Disable and regenerate need the password or a TOTP code in the body (`403 reauth-failed`, counted toward the lockout). Tenant policy is `app.tenant.settings.mfa_required` = `off | admins | all` (admins = roles holding `*` or `user:manage`); set it with `cli tenant:mfa-policy --slug <slug> --mode <mode>`. The demo seed enrols each demo Owner (`DEMO_OWNER_TOTP_SECRET`).

## 5. ASVS 4.0 L2 checklist (authentication, session, access control)

Legend: done = implemented and tested; n/a = out of M1 scope with the reason.

| ASVS | Requirement | Status | Test |
|---|---|---|---|
| 2.1.1 | Passwords at least 12 characters | done | `password.service.test`, `auth-flow` invitation weak password |
| 2.1.2 | Passwords up to 128 characters allowed | done | `password.service.test` |
| 2.1.7 | Check against breached passwords | done | `password.service.test` (list and online provider), `auth-security` "does not let a rejected password consume the invitation" |
| 2.1.8 | Strength meter | n/a | web concern; the live policy is public (`password-policy`) |
| 2.1.9 | No composition rules | done | `password.service.test` |
| 2.2.1 | Anti-automation (throttling, lockout) | done | `auth-security` "throttling and lockout" |
| 2.2.2 | Weak authenticators not the only factor | done | TOTP and recovery codes only; SMS is not offered |
| 2.3.1 | System-generated initial credentials single use, expiring | done | invitation tokens: `auth-security` "replayed and stale tokens", `auth-flow` expired invitation |
| 2.4.1 | Salted, one-way password storage with an approved KDF | done | `auth-security` "stores the TOTP secret encrypted, recovery codes hashed, the password argon2id-hashed" |
| 2.5.1 | Reset secret not sent in clear except the link token; 2.5.2 no password hints | done | `auth-flow` password reset |
| 2.5.4 | No shared or default accounts | done | none seeded outside the dev-only demo seed |
| 2.5.6 | Forgotten-password flow does not reveal account existence | done | `auth-security` "account enumeration resistance" |
| 2.7.x | Out-of-band authenticators | n/a | none offered |
| 2.8.1 | Time-based OTP has a defined lifetime; 2.8.3 not reusable within the window | done | `totp.test`, `auth-security` "MFA bypass attempts" |
| 2.8.4 | Approved crypto for OTP verification, constant-time compare | done | `totp.ts` (`timingSafeEqual`), RFC vectors in `totp.test` |
| 2.8.5 | Re-authentication or MFA for sensitive changes | done | `auth-flow` "needs re-authentication", `auth-security` "counts failed re-authentication" |
| 2.9.x | Cryptographic authenticators | n/a | passkeys are out of M1 |
| 2.10.x | Service authentication | done | API keys hashed, scoped, expiring (`auth-flow` API keys) |
| 3.1.1 | Session token never in URLs | done | cookie only |
| 3.2.1 | New session token on authentication | done | `auth-security` "session fixation" |
| 3.2.2 | At least 64 bits of entropy | done | 256-bit token, `auth-security` cookie test |
| 3.2.3 | Token stored in the browser using secure methods | done | `__Host-` cookie, HttpOnly, Secure, SameSite=Lax |
| 3.2.4 | Generated with an approved CSPRNG | done | `generateToken` (`crypto.randomBytes`) |
| 3.3.1 | Logout and expiry invalidate the session | done | `auth-flow` logout, `auth-security` "expired and revoked sessions" |
| 3.3.2 | Re-authentication after 12 hours or 30 minutes idle (L2) | done | defaults 12 h and 30 min, `auth-security` idle test |
| 3.3.3 | Option to end all other sessions | done | `DELETE /auth/sessions`, `auth-flow` sessions |
| 3.3.4 | User can see and end active sessions | done | `GET /auth/sessions`, admin variants |
| 3.4.1 | `Secure` attribute; 3.4.2 `HttpOnly`; 3.4.3 `SameSite`; 3.4.4 `__Host-` prefix | done | `auth-security` cookie flags |
| 3.5.x | Token-based sessions | n/a | mobile tokens are M3 |
| 3.7.1 | Full or re-authentication for sensitive transactions | done | disable MFA, regenerate codes |
| 4.1.1 | Access control enforced on a trusted service layer | done | `AuthGuard`, `route-rules` test |
| 4.1.2 | Access attributes cannot be manipulated by end users | done | tenant only from the credential: `auth-security` "takes the tenant only from the credential" |
| 4.1.3 | Least privilege | done | role matrix |
| 4.1.5 | Access controls fail securely | done | route without a rule is denied |
| 4.2.1 | IDOR protection (foreign ids look missing) | done | `auth-security` "cross-tenant access" |
| 4.2.2 | CSRF protection | done | `auth-security` CSRF |
| 4.3.1 | MFA for administrative interfaces | done | tenant policy `admins`: `auth-security` "tenant MFA enforcement" |
| 7.1.x | No credentials or tokens in logs | done | security events carry the email or key prefix only (asserted); tokens only as hashes |
| 8.3.x | Sensitive data in responses not cached | done | `Cache-Control: no-store` on auth responses |
| 13.2.x | RESTful input validation | done | strict zod bodies, problem+json |

Known gaps, tracked: breached-password list is a 10k subset (the online provider covers the rest); no SMS/email OTP (by design); WebAuthn/passkeys later; `Idempotent-Replayed` responses of `POST /v1/api-keys` store the secret as the contract allows (clients should not send `Idempotency-Key` there); per-tenant rate limits (`RateLimit-*` headers) belong to M1-PLAT.
