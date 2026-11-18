# Tenancy threat model (M1)

Scope: how a tenant's data could be read or changed by another tenant, by an unauthenticated party, or by
the platform's own components, and what stops it today. Method: STRIDE (Spoofing, Tampering, Repudiation,
Information disclosure, Denial of service, Elevation of privilege) over six areas. Every row names a
mitigation and the test or file that is the **evidence**; a row whose evidence says *none yet* is a gap, and
the gaps are collected in section 9.

Status: written 2026-11-18 against `main` at M1 wave 2b plus the wave 3 CI work. Review at every
milestone and whenever a new tenant table, a new credential type or a new background component is added
(the PR template asks). Paths are relative to the repository root; `apps/api/test` is the integration
suite (needs a database, see [`developer-guide.md`](developer-guide.md) section 5), `apps/api/src/**/*.test.ts`
are unit tests. Related: [`auth-security.md`](auth-security.md) (ASVS L2 checklist),
[`../adr/0001-data-access-and-migrations.md`](../adr/0001-data-access-and-migrations.md),
[`../adr/0004-platform-services.md`](../adr/0004-platform-services.md),
[`../03_system_architecture.md`](../03_system_architecture.md) 5 and 8.

## 1. System and trust boundaries

```text
 Browser / API client ──HTTPS──▶ [reverse proxy / CDN] ──▶ api (NestJS, Fastify)  :3000  public listener
                                                              │   ops server :9464 (/metrics) internal only
 worker, scheduler (same image) ◀── pg-boss jobs ─────────────┤
                                                              ▼
                                       PgBouncer (transaction mode) ──▶ PostgreSQL (one shared database)
                                       app_user (runtime, RLS-bound)       app_owner (DDL, migrations, scheduler)
 Mailpit/SMTP ◀── worker        MinIO/S3 ◀── api            master key file ──▶ envelope encryption
```

One database, one schema set, many tenants: isolation is **row-level security** (`app.*` tables carry
`tenant_id`, FORCE RLS), set per transaction with `set_config('app.tenant_id', ..., true)`. Assets that the
design protects: tenant business data (assets, people, locations, files), credentials and sessions, the
master key, the audit trail. Actors: anonymous internet client, authenticated user of tenant A, tenant
admin, API key, operator (self-hosted) or platform engineer (cloud), a compromised dependency or image.

Out of scope here: the cloud account and network (M6-SEC), denial of service at the network layer, physical
access, and mobile (M3). A malicious **database superuser or operator is outside the isolation boundary by
design** (section 3, T-ISO-8).

## 2. Tenant isolation (RLS, pooling, roles)

| ID | STRIDE | Threat | Mitigation | Evidence |
| -- | ------ | ------ | ---------- | -------- |
| T-ISO-1 | I | A query forgets its tenant filter and returns another tenant's rows | Every tenant table: ENABLE + FORCE RLS and a `tenant_isolation` policy in the NULLIF form on `USING` and `WITH CHECK`, created by the helpers `app.apply_tenant_conventions` / `app.create_tenant_table`; `app.schema_lint()` fails `migrate` and CI on any table without them | `apps/api/migrations/0002_schemas_and_helpers.sql`, `0008_provisioning_and_lint.sql`; `apps/api/test/isolation/isolation.e2e.test.ts` (a, b), `apps/api/test/schema-lint.e2e.test.ts` (every rule has a failing fixture) |
| T-ISO-2 | I, E | Tenant context leaks to the next client of a pooled connection (a session-level `SET`) | Context is only ever transaction-local (`set_config(..., true)` as the first statement of `withTenantTx`); PgBouncer in transaction mode; after a transaction the setting reads empty and the policy returns 0 rows without error | `apps/api/test/isolation/isolation.e2e.test.ts` (c: 600 interleaved transactions, i), `apps/api/test/isolation/pooling.e2e.test.ts` (b3, failed transaction, autocommit outside any transaction), `apps/api/src/tenancy/boundaries.test.ts` ("no session-level tenant context"), `docs/validation/spike_rls_pgbouncer.md` |
| T-ISO-3 | I | The isolation suite stops being able to see a leak (a false green) | A NEGATIVE CONTROL deliberately leaks a session `SET` through the `pool_size=1` alias and must observe it; a control of the control runs direct; CI also fails when any test is skipped | `apps/api/test/isolation/pooling.e2e.test.ts` (NEGATIVE CONTROL), `scripts/ci/assert-no-skips.mjs`, `.github/workflows/ci.yml` (job `api-e2e`) |
| T-ISO-4 | T | A write carries another tenant's `tenant_id`, or updates and deletes cross tenants | `WITH CHECK` on every policy; policy `USING` limits updates and deletes | `apps/api/test/isolation/isolation.e2e.test.ts` (e) |
| T-ISO-5 | T, I | A row of tenant A references a row of tenant B (foreign-key checks bypass RLS) | Composite `(tenant_id, id)` foreign keys between tenant tables; the lint requires them | `apps/api/test/isolation/isolation.e2e.test.ts` (e2), `apps/api/test/schema-lint.e2e.test.ts` |
| T-ISO-6 | I | A view or a partition is read around the policy | Views are `security_invoker`; partitions are FORCE-RLS and carry **no grants** (access is only through the parent; no `ALTER DEFAULT PRIVILEGES` anywhere so new partitions never inherit access); partition rotation keeps that true | `apps/api/test/isolation/isolation.e2e.test.ts` (f, g), `apps/api/test/schema-lint.e2e.test.ts` ("partition rotation"), `apps/api/src/db/migrations.test.ts` ("never grants through default privileges") |
| T-ISO-7 | E | Application code reaches the database outside the tenant helper, or injects SQL | Only `src/tenancy` and `src/db` may import the database client (ESLint, with fixture tests); the transaction client only exists inside `withTenantTx`; raw SQL is tagged templates only, `$queryRawUnsafe` is banned | `apps/api/src/tenancy/boundaries.test.ts`, `apps/api/src/platform/ports-boundaries.test.ts`, `apps/api/eslint.config.mjs`, ADR 0001 |
| T-ISO-8 | I, E | A role that ignores RLS reads everything: a superuser, a BYPASSRLS role, or the table owner (who can also drop a policy) | The application never connects as such: runtime is `app_user` (NOBYPASSRLS, owns nothing, no DDL); the owner `app_owner` is bound by FORCE for reads and writes; the lint rejects any superuser or BYPASSRLS application role and any object owned by `app_user`; owner credentials exist only in the `migrate` run and the `scheduler` role (direct connection, never pooled) | `apps/api/test/isolation/isolation.e2e.test.ts` (h), `apps/api/test/schema-lint.e2e.test.ts` (role audit, BYPASSRLS fixture needs `ADMIN_DATABASE_URL`), `docker/postgres/init/01-roles.sql`, `docker-compose.yml` (`MAINTENANCE_DATABASE_URL` only on `scheduler`). **Residual: see section 3** |
| T-ISO-9 | S | The tenant is chosen by the client (header, query, body, hostname) | The tenant comes only from the credential (API key or session); a credential used on another tenant's hostname is refused; suspended, pending-deletion and unknown tenants are refused for requests and jobs | `apps/api/test/auth/auth-security.e2e.test.ts` ("takes the tenant only from the credential", "refuses a credential used on another tenant's hostname", "cross-tenant access"), `apps/api/test/control-plane-identity.e2e.test.ts` (control plane) |
| T-ISO-10 | D | One tenant starves the others (connections, jobs) | PgBouncer pool of 4 server connections multiplexes clients; per-tenant fairness in job workers (`JOBS_TENANT_CONCURRENCY`); auth throttling per account and IP | `docker/pgbouncer/pgbouncer.ini`, `apps/api/src/jobs/` (worker), `apps/api/test/platform-services.e2e.test.ts` ("S3: 100 jobs across two tenants"). **No general per-tenant API rate limit yet (section 9)** |
| T-ISO-11 | R | Cannot show who did what inside a tenant | `app.audit_log` rows (actor, request id, ip, user agent, redacted diff) are written in the same transaction as the change; the runtime role can only INSERT and SELECT (append-only) | `apps/api/test/platform-services.e2e.test.ts` (audit block: "append-only: UPDATE and DELETE fail for the runtime role", "commits and rolls back WITH the transaction"), `apps/api/src/audit/redact.test.ts` |

## 3. Known exposures (accepted, recorded, monitored)

These follow from the design and are not defects. Each has a compensating control and a place where it is
watched. This section is the answer to backlog M1-DOC-01 ("known exposures").

1. **`pgboss.*` has no RLS.** pg-boss is a third-party schema shared by all tenants; the runtime role must
   read and write job rows across tenants. Compensation: payloads are **ids only** (the enqueue refuses
   free text, emails, URLs, names and secrets, and a payload naming another tenant than the open
   transaction); workers re-establish the tenant context from the job and refuse suspended tenants; the
   runtime role cannot do DDL in the schema. Impact if read: opaque ids and job names, no business data.
   Evidence: `apps/api/src/ids/ids-only.test.ts`, `apps/api/test/platform-services.e2e.test.ts` ("refuses to
   enqueue for tenant B inside tenant A transaction, and non-ids payloads", "the runtime role cannot do DDL
   in the pg-boss schema"), `apps/api/src/jobs/jobs.test.ts`.
2. **`identity.*` and the control plane are non-RLS.** Login, session, API-key and invitation lookups must
   work before the tenant is known (`identity.tenant_directory`, `login_identity`, `credential`, `session`,
   `api_key_lookup`, `invitation_token`, `mfa_*`, `security_event`, `auth_throttle`). Compensation: they hold
   hashes and ids only, `app_user` has exactly the per-table grants authentication needs (for example no
   UPDATE on `api_key_lookup`, no DELETE on `credential`), rows carry `tenant_id` with composite FKs so they
   cannot dangle across tenants, and the lint requires every non-tenant table to be classified with a reason
   (`COMMENT ON TABLE ... IS 'non-tenant: <reason>'`). The risk that remains is a bug in the pre-tenant
   lookups themselves; ED-05 moves them to a separate narrow role and pool before M4.
   Evidence: `apps/api/migrations/0007_identity.sql`, `0010_auth_support.sql`;
   `apps/api/test/control-plane-identity.e2e.test.ts` ("resolves ... with NO tenant set, and cannot read any
   tenant table", "app_user has only the narrow identity grants"), `docs/engineering/decisions.md` ED-05.
3. **A superuser or BYPASSRLS role ignores FORCE RLS; the owner can change policies.** RLS defends against
   application bugs and other tenants, not against whoever holds database superuser or owner credentials.
   Compensation: the application never runs as those roles (lint and role audit), the owner's credentials
   are used by `migrate` and `scheduler` only, over a direct connection. Cloud: the roles live in the
   secrets manager and a human reaches them only through audited break-glass access (M6). **Self-hosted:
   the operator is the owner of the data; isolation does not protect a tenant from its own operator.**
   Evidence: `apps/api/test/schema-lint.e2e.test.ts` (BYPASSRLS fixture), T-ISO-8.
4. **Partition rule.** RLS on a partitioned parent does not apply when a partition is queried directly. So
   partitions get FORCE RLS, no grants, and are never created through a path that grants (`ensure_partitions`
   is owner-only; there are no default privileges). A future migration that grants on a partition would
   reopen the hole; the lint rule and the partition test exist to catch exactly that. Evidence: T-ISO-6.
5. **Restore granularity.** Point-in-time recovery restores the **whole shared database**; restoring one
   tenant means the per-tenant logical export (manual, slower), which the SLA states. There is no automated
   test of a single-tenant restore yet; quarterly restore drills and the runbook belong to M6-TOPS-02 and
   `docs/03_system_architecture.md` (restore granularity, line 453).
6. **Per-tenant data is encrypted at rest only by the storage layer** (database volume, S3), plus envelope
   encryption for the specific secrets in section 7 (TOTP secrets, mail envelopes). There is no
   per-tenant key for business data (`docs/03_system_architecture.md` records the decision).

## 4. Authentication, sessions and access control

| ID | STRIDE | Threat | Mitigation | Evidence |
| -- | ------ | ------ | ---------- | -------- |
| T-AUTH-1 | S | Password guessing and credential stuffing | argon2id (m=19456 KiB, t=2, p=1) with a 12 to 128 character policy and a bundled breached-password list; failures throttled per account (hash of the email, so an unknown email locks the same) and per IP; `429` with `Retry-After` | `apps/api/test/auth/auth-security.e2e.test.ts` ("throttling and lockout"), `apps/api/src/auth/password.service.test.ts`, `docs/engineering/auth-security.md` section 2 |
| T-AUTH-2 | I | Account enumeration through responses or timing (login, reset, invitation) | Same `401 invalid-credentials` body and one argon2 verification either way; reset requests and invitation tokens answer identically for unknown and known values | `apps/api/test/auth/auth-security.e2e.test.ts` ("account enumeration resistance") |
| T-AUTH-3 | S | The client forges its IP to dodge per-IP throttling | `TRUST_PROXY` defaults to `false` (nobody's `X-Forwarded-For` is believed); behind a proxy it takes an allow-list or a hop count | `apps/api/test/auth/trust-proxy.e2e.test.ts`, `apps/api/src/config/trust-proxy.test.ts`, `.env.example` |
| T-AUTH-4 | S | Session fixation or theft | Opaque 256-bit token in a `__Host-` cookie (`HttpOnly; Secure; SameSite=Lax; Path=/`, no Domain); only its SHA-256 is stored; a new id at login and when MFA is enrolled; idle and absolute timeouts; revoked on password reset, role change, deactivation | `apps/api/test/auth/auth-security.e2e.test.ts` ("session fixation and cookie hygiene", "expired and revoked sessions"), `apps/api/test/auth/auth-flow.e2e.test.ts` (sessions, password reset) |
| T-AUTH-5 | S | Second factor bypass or replay | No session before the second factor; TOTP codes at or before the last accepted step are rejected; challenges are single use and expire; guesses throttled; TOTP secret encrypted, recovery codes hashed; tenant policy can require MFA and limits the session until enrolment | `apps/api/test/auth/auth-security.e2e.test.ts` ("MFA bypass attempts", "tenant MFA enforcement"), `apps/api/src/auth/totp.test.ts` |
| T-AUTH-6 | T | CSRF on cookie-authenticated mutations | `X-CSRF-Token` required for cookie sessions; API keys use the `Authorization` header | `apps/api/test/auth/auth-security.e2e.test.ts` ("CSRF") |
| T-AUTH-7 | I | Reset, invitation and API-key tokens leak from the database | Stored only as hashes; shown once; reset links of older requests are invalidated | `apps/api/test/auth/auth-security.e2e.test.ts` ("replayed and stale tokens", "stores reset and invitation tokens only as hashes") |
| T-AUTH-8 | E | A privileged action reachable without the permission, or a user grants more than they hold | Deny by default: a route with no declared access rule is refused and a unit test fails the build; permission catalogue equals the OpenAPI `x-permission` set; no grants above the grantor's own, the last active administrator is protected | `apps/api/src/auth/route-rules.test.ts`, `apps/api/src/auth/role-matrix.test.ts`, `apps/api/test/auth/auth-security.e2e.test.ts` ("privilege escalation through the role endpoints") |
| T-AUTH-9 | R | Security events are not attributable | Tenant-scoped events are audited in the tenant transaction; failures before the tenant is known (bad logins, invalid API keys) go to `identity.security_event`, not the tenant log | `apps/api/test/auth/auth-security.e2e.test.ts` ("writes audit entries for the security events"), `apps/api/test/control-plane-identity.e2e.test.ts` ("failed logins and invalid API keys go to the control-plane security log") |
| T-AUTH-10 | D | Expensive hashing used to exhaust CPU or memory | Throttles bound attempts per account and IP; argon2 memory is fixed per verification. Not load-tested | none yet (section 9) |

## 5. Jobs and the outbox

| ID | STRIDE | Threat | Mitigation | Evidence |
| -- | ------ | ------ | ---------- | -------- |
| T-JOB-1 | S, E | A job runs under the wrong tenant or enqueues for another | The worker opens the transaction for the tenant named by the job; enqueue inside a tenant transaction refuses another tenant's id | `apps/api/test/platform-services.e2e.test.ts` ("processed by the worker under THAT tenant", "refuses to enqueue for tenant B inside tenant A transaction") |
| T-JOB-2 | T | A payload carries data or a secret that then sits outside RLS (see exposure 1) | Ids-only payload rule, enforced at enqueue and in the outbox, with failing fixtures | `apps/api/src/ids/ids-only.test.ts`, `apps/api/test/platform-services.e2e.test.ts` ("refuses a payload that is not ids only") |
| T-JOB-3 | R | An event is lost, duplicated or published for a change that rolled back | Transactional outbox: the event row commits or rolls back with the data and the audit row; the relay delivers exactly once even with concurrent relays | `apps/api/test/isolation/isolation.e2e.test.ts` ("M1-TEN-02: data, audit row and outbox row roll back together"), `apps/api/test/platform-services.e2e.test.ts` (outbox block) |
| T-JOB-4 | D | A poison message blocks the queue; two schedulers duplicate cron work | Retry with backoff, then dead-letter queue readable through the admin API; a failed event waits out its backoff while later ones flow; singleton-keyed producers | `apps/api/test/platform-services.e2e.test.ts` ("a failing job is retried then lands in the dead-letter queue", "SCHEDULERS: two schedulers never duplicate", "a failed event waits out its backoff") |
| T-JOB-5 | E | The runtime role alters the job schema, or loses access after a pg-boss upgrade | Runtime role has no DDL in the pg-boss schema; grants are re-applied idempotently by provisioning and survive upgrades | `apps/api/test/platform-services.e2e.test.ts` ("pgboss grants survive upgrades") |
| T-JOB-6 | I | A job or event handler logs or stores sensitive data | Handlers receive ids and read inside the tenant transaction; logs redact secrets | `apps/api/src/logging/logger.test.ts` (REDACTION) |

## 6. Mail

| ID | STRIDE | Threat | Mitigation | Evidence |
| -- | ------ | ------ | ---------- | -------- |
| T-MAIL-1 | T | A queued mail is altered before it is sent (recipient, link) | The stored envelope is authenticated by the SecretBox; a tampered one is not sent | `apps/api/test/platform-services.e2e.test.ts` ("a mail whose stored envelope was tampered with is NOT sent") |
| T-MAIL-2 | I | Mail content or tokens sit in the queue in clear | The queue holds only ids (`{ tenantId, mailId }`); the message is stored encrypted (context-bound to tenant and mail id) and **dropped after delivery**, so no reset or invitation token outlives its mail; tokens are hashed in the database. Delivery is at-least-once: a crash between the SMTP acknowledgement and the commit sends the mail twice | `apps/api/test/platform-services.e2e.test.ts` ("nothing sensitive in the queue"), `apps/api/src/mail/mail-job.ts` |
| T-MAIL-3 | S | Links point to an attacker's host (Host-header injection) | Links are built from the configured `WEB_BASE_URL`, never from request headers | `apps/api/src/auth/auth-mailer.service.ts`, `.env.example` |
| T-MAIL-4 | T | Template data injects headers or markup | Templates are fixed and typed; bad template data fails in the caller before anything is queued | `apps/api/src/mail/templates.test.ts`, `apps/api/test/platform-services.e2e.test.ts` ("bad template data fails in the caller") |
| T-MAIL-5 | R | A mail is sent for a change that rolled back, or outside a tenant | `send()` runs in the tenant transaction and queues the job with it; outside one it is refused | `apps/api/test/platform-services.e2e.test.ts` ("a rolled-back transaction sends no mail", "send() outside a tenant transaction is refused") |
| T-MAIL-6 | D | The reset or invitation endpoints are used to flood a mailbox | Per-email and per-IP throttles on reset requests | `apps/api/test/auth/auth-security.e2e.test.ts` ("throttles password reset requests per email") |
| T-MAIL-7 | S | Mail is forged or lands in spam because the sender domain is not authenticated | An operator concern: `MAIL_FROM` and the SMTP relay are configured per install; SPF, DKIM and DMARC guidance is not written yet | none yet (section 9) |

## 7. Secrets and supply chain

| ID | STRIDE | Threat | Mitigation | Evidence |
| -- | ------ | ------ | ---------- | -------- |
| T-SEC-1 | I | Encrypted fields (TOTP secrets, mail envelopes, later integration credentials) are read with the database alone | Envelope encryption: a fresh data key per value, wrapped by a master key held outside the database; context-bound to tenant and purpose so a value cannot be replayed for another tenant or purpose | `apps/api/src/crypto/secret-box.test.ts` ("fails when decrypted for another tenant or purpose", "uses a fresh data key and IV") |
| T-SEC-2 | T | Ciphertext is modified | Authenticated encryption; any change anywhere in the envelope fails | `apps/api/src/crypto/secret-box.test.ts` ("fails on a tampered ciphertext") |
| T-SEC-3 | I | The master key is exposed (env dump, image layer, repo) | Loaded from a file (`MASTER_KEY_FILE`, a Docker secret), not from compose environment; production refuses to start without one; the repo holds only a dummy dev key; gitleaks and Trivy's secret scanner run in CI | `apps/api/src/crypto/secret-box.test.ts` ("production refuses to start without a master key"), `docker-compose.yml`, `.gitleaks.toml`, `.github/workflows/security.yml` |
| T-SEC-4 | D | Key rotation or loss makes data unreadable | Rotation re-wraps data keys under a new master key with the old one kept as `MASTER_KEY_PREVIOUS` during the window; the key id is stored in the header. **Losing the key loses the data: backup is the operator's duty** (documented in compose and `.env.example`) | `apps/api/src/crypto/secret-box.test.ts` ("rotation", "loads the current and the previous master key") |
| T-SEC-5 | I | Passwords, tokens, keys appear in logs or audit diffs | pino redaction at any nesting level; the audit diff is redacted before it is stored | `apps/api/src/logging/logger.test.ts` ("REDACTION"), `apps/api/src/audit/redact.test.ts` |
| T-SEC-6 | I | Dev or demo credentials work in production | The demo seed (and its fixed password and TOTP secret) refuses `NODE_ENV=production`; the dev master key is only mounted by the dev compose file | `apps/api/test/control-plane-identity.e2e.test.ts` ("seed refuses to run in production"), `apps/api/test/auth/demo-seed.e2e.test.ts` |
| T-SEC-7 | T, E | A vulnerable or malicious dependency or base image | Exact version pins, `minimumReleaseAge`, `pnpm audit` gate with expiring allow-list, Dependabot (grouped, 3-day cooldown), Trivy gate on fixable HIGH/CRITICAL, SBOM per build, CodeQL | `.github/workflows/security.yml`, `ci.yml` (`image-scan`), `codeql.yml`, `.github/security/`, `.github/dependabot.yml`, `docs/engineering/ci.md` section 3 |
| T-SEC-8 | T | A workflow change leaks secrets or widens permissions | Default `permissions: contents read`, extra scopes per job only; no `pull_request_target`; CodeQL scans the workflow files; `.github/` is CODEOWNERS-protected | `.github/workflows/*.yml`, `.github/CODEOWNERS`, `.github/workflows/codeql.yml` (`actions` language) |

## 8. Self-hosted deployment

| ID | STRIDE | Threat | Mitigation | Evidence |
| -- | ------ | ------ | ---------- | -------- |
| T-SH-1 | I | Metrics and health detail are exposed to the network | `/metrics` is served only by the internal ops server on port 9464, which no compose service publishes; the public listener answers 404 for `/metrics`; `tenant_id` is never a metric label. The smoke test fails if either regresses | `scripts/ci/compose-smoke.sh`, `apps/api/src/observability/ops-server.test.ts` ("never uses tenant_id as a metric label"), `docker-compose.yml` |
| T-SH-2 | S, I | The API is reachable directly and believes forged `X-Forwarded-For`, or serves plain HTTP | `TRUST_PROXY=false` by default; TLS terminates at the operator's reverse proxy (Caddy in the self-hosted bundle, M4) and `__Host-` cookies are `Secure` | T-AUTH-3; reverse-proxy bundle: M4-REL (not built yet) |
| T-SH-3 | E | Default credentials stay in place (`dev` database password, `minioadmin`) | They are dev values in `docker-compose.yml` and CI service containers only, flagged "DUMMY credentials only". There is **no production compose or installer yet** that generates credentials, and nothing refuses a `dev` password at start-up | none yet (section 9) |
| T-SH-4 | E | The container runs as root or carries build tooling | Runtime stage is the slim Node image, non-root user `node`, no secrets in the image; Trivy scans it on every build | `apps/api/Dockerfile`, `.github/workflows/ci.yml` (`image-scan`). **First scan found six HIGH findings in the npm CLI bundled in the base image (not executed at runtime); exceptions expire 2026-12-18** |
| T-SH-5 | T | A migration is edited after it ran, or a rolling upgrade breaks the old version | Checksummed migration ledger; expand/contract discipline; `migrate` runs the schema lint and fails the deploy | `apps/api/src/db/migrator.test.ts`, `apps/api/test/schema-lint.e2e.test.ts` ("migrating again is a no-op"), `docs/03_system_architecture.md` 8.5 |
| T-SH-6 | D | Data loss: no backup, lost master key | Backup and restore tooling, drills and the support bundle are M4 work; today the operator must back up Postgres and the master key | none yet (section 9) |
| T-SH-7 | I | The operator reads tenant data | Not a threat the platform defends against in self-hosted mode (operator holds the database); stated in the self-hosted terms. Multi-tenant isolation matters when one install serves several tenants | T-ISO-8, exposure 3 |

## 9. Gaps and follow-ups

| Gap | Where it should land |
| --- | -------------------- |
| No general per-tenant request rate limit (only auth throttling) | M1-PLAT follow-up or M4 hardening; add a test beside T-ISO-10 |
| No load test of concurrent argon2 logins (T-AUTH-10) | M1-CI-05 performance job once login is in the scripted scenarios |
| Pre-tenant lookups still use `app_user` with narrow grants | ED-05: separate role and pool before M4 |
| No single-tenant restore test or runbook | M6-TOPS-02, restore drills (architecture section 8) |
| No production compose, credential generation or "refuse default password" start-up check | M4-REL (self-hosted bundle) |
| SPF/DKIM/DMARC and SMTP relay guidance | M4 operator documentation |
| Sentry (optional, M1-OPS-01) is not implemented; errors already carry the request id | optional, post M1 |
| Trivy exceptions for the npm CLI in the base image | remove npm in the runtime stage or bump the base digest (`apps/api/Dockerfile`); entries expire 2026-12-18 |
| picomatch advisory GHSA-fc5q-39xc-vjpf (dev tooling only) allow-listed | until upstream releases a fix; expires 2027-01-15 |
| CODEOWNERS and branch protection are not active until `@OWNER` is replaced and the founder sets the rule | founder, backlog F-01 |

## 10. Keeping this current

When a PR adds a tenant table, a credential type, a background component, an outbound integration or a
public route, it adds or edits the rows above (the PR template has the checkbox) and names the test that
proves the mitigation. A mitigation without a test is written down as a gap in section 9, not claimed.
