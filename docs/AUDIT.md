# Quality and security audit record

Two things in one place: **(A)** how the product audits itself (what the in-app audit log records, who can read it, what
keeps it trustworthy), and **(B)** the dated record of the verification and security audits done on the project so far, with
their results, findings, fixes and the items still open. Written from the repository: the documents and commits named in
each entry are the evidence. Related: [VERSION.md](VERSION.md) (what shipped when), [API.md](API.md),
[`engineering/threat-model.md`](engineering/threat-model.md), [`engineering/ci.md`](engineering/ci.md).

Entries are added when an audit, review or verification run is done, and when a finding is resolved. Add the entry in the
same change (see [`engineering/contributing.md`](engineering/contributing.md)). Numbers are quoted as recorded in the source
named; where no number was recorded, the entry says so.

---

## A. How the product audits itself

### A.1 What is recorded

Every state-changing operation writes one row to the **audit log** (`app.audit_log`) inside the same database transaction as the
change, so a change that rolls back leaves no audit row and a change that commits always has one. A row holds:

| Field              | Content                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| tenant             | taken from the transaction, never from the caller, so a row can only describe the tenant it belongs to                                            |
| actor              | actor type (`user`, `api_key`, `integration` or `system`) and the actor id: a signed-in user, an API key, or a background job                     |
| action             | the action name (list below)                                                                                                                      |
| entity type and id | what was changed                                                                                                                                  |
| diff               | `before` and `after` of the changed fields, plus optional `meta` (for example `bulk_operation_id`, a reason); secrets are redacted before storing |
| client details     | client IP (after the trusted-proxy rule), user agent (capped at 512 characters), request id (the `X-Request-Id` of the call)                      |
| time               | `at`, the partition key                                                                                                                           |

The outbox event that triggers notifications and later webhooks is written in the same transaction too.

**Audited actions** (as emitted by the code in `apps/api/src`; `<entity>` rows exist for each listed verb):

| Area                  | Action names                                                                                                                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in and sessions  | `auth.login.succeeded`, `auth.logout`, `auth.password.reset_requested`, `auth.password.reset`, `session.revoked`                                                                                                                                                                                                                   |
| Two-step verification | `auth.mfa.enabled`, `auth.mfa.disabled`, `auth.mfa.recovery_codes_regenerated`, `auth.mfa.reset` (an administrator resets another user's)                                                                                                                                                                                          |
| Users and invitations | `user.created`, `user.invited`, `user.updated`, `user.role_changed`, `user.archived`, `invitation.accepted`, `invitation.resent`, `invitation.revoked`                                                                                                                                                                             |
| API keys              | `api_key.created`, `api_key.revoked`                                                                                                                                                                                                                                                                                               |
| Settings              | `tenant_settings.files_updated`, `tenant_settings.asset_tag_template_updated`, `notification_rule.updated`                                                                                                                                                                                                                         |
| Catalogue             | `category.*`, `manufacturer.*`, `model.*`, `vendor.*`, `status_label.*`, `custom_field.*` with `created`, `updated`, `archived`                                                                                                                                                                                                    |
| Assets                | `asset.created`, `asset.updated`, `asset.archived`, `asset.restored`, `asset.cloned`, `asset.moved`, `asset.disposed`, `asset.marked_lost`, `asset.marked_found`, `asset.bulk_update`, `asset.bulk_archive`, `asset.bulk_restore`, `asset.bulk_move` (a bulk action also writes the per-asset rows, linked by `bulk_operation_id`) |
| Custody               | `asset.checked_out`, `asset.checked_in`, `asset.transferred`, `asset.custody_undone`                                                                                                                                                                                                                                                                       |
| Locations and people  | `location.created`, `location.updated`, `location.moved`, `location.archived`, `person.created`, `person.updated`, `person.archived`, `person.user_linked`, `person.user_unlinked`                                                                                                                                                                                               |
| Repairs               | `repair.opened`, `repair.updated`, `repair.completed`, `repair.cancelled`, `repair.archived`                                                                                                                                                                                                                                       |
| Stock                 | `accessory.created`, `accessory.updated`, `accessory.archived`, `accessory.checked_out`, `accessory.checked_in`, `consumable.created`, `consumable.updated`, `consumable.archived`, `consumable.stock_moved`                                                                                                                       |
| Files                 | `attachment.created`, `attachment.uploaded`, `attachment.linked`, `attachment.scanned`, `attachment.scan_skipped`, `attachment.infected`, `attachment.rejected`, `attachment.abandoned`, `attachment.archived`                                                                                                                     |
| Labels                | `label.batch.requested`, `label.batch.ready`, `label.batch.failed`, `label.batch.expired`, `label.template.calibrated`                                                                                                                                                                                                             |
| Views and exports     | `saved_view.created`, `saved_view.updated`, `saved_view.deleted`, `saved_view.shared`, `saved_view.unshared`, `export.requested`, `export.completed`, `export.failed`, `export.downloaded`                                                                                                                                         |

The list is derived from the code at version 0.2.3. New features add actions; the rule (backlog Definition of Done, item 7) is
that every state-changing endpoint writes an audit record, and the role-matrix and route tests walk every route.

Two neighbouring records are **not** the audit log:

- **Asset history** (`app.asset_history`): the user-facing chain of custody and lifecycle events shown on asset and person
  pages (created, updated, status and location changes, checked out and in, transferred, archived, repair opened and
  completed, and so on). It is append-only and partitioned like the audit log, and is written in the same transaction.
- **Security events** (`identity.security_event`): things that happen before a tenant is known or that fail: `login_failed`,
  `mfa_failed`, `account_locked`, `api_key_invalid`, `csrf_rejected`, `session_invalid`, `tenant_inactive`,
  `password_reset_requested`, `password_reset_failed`. The subject is a lower-cased e-mail or a key prefix, never a secret.
  Writes are best effort so a logging failure cannot turn a 401 into a 500.

### A.2 Who can read it

- **Permission:** `audit:read`, held by the Administrator (all permissions), Asset manager and Auditor roles ([API.md](API.md#4-permissions-model)).
- **Today there is no way to read the audit log from the product.** The contract specifies `GET /v1/audit-log` but it is not
  implemented, and there is no audit screen or export; both are story M5-AUD-01 (filter by actor, entity, action and date,
  before/after view, CSV export that is itself audited). Until then the rows can only be read by someone with database access
  (the application role sees only its own tenant's rows through row-level security). The user-facing asset and person history
  timelines are available now.
- Reading is tenant-scoped: an administrator sees only their own organisation's rows.

### A.3 Append-only guarantees and their limits

What is enforced and tested (evidence in the threat model, T-ISO-11, and in the isolation suite):

- The application database role holds `SELECT` and `INSERT` on the partitioned parent table only. `UPDATE` and `DELETE` fail
  with SQLSTATE 42501; a test checks it. There are no grants on any monthly partition, partitions carry row-level security
  with the tenant policy, and a direct read of a partition is denied (the RLS spike found that a partition grant would leak,
  see B.2).
- Insert rows are tied to the transaction's tenant, actor and request id by the database (`WITH CHECK` on the policy), not by
  application arguments.
- Sensitive values (passwords, tokens, keys) are redacted from the diff and from logs; a unit test covers the redactor.
- Monthly partitions are created ahead of time by a scheduled job (12 months at install plus a default partition).

What is **not** guaranteed today:

- **Retention is not enforced.** Rows are kept indefinitely. The plan is retention by tier (30 days Free, 1 year Starter,
  3 years Pro, custom Enterprise) through a dedicated retention role that holds `DELETE` on the audit tables only, is still
  scoped by row-level security and whose own purges are audited (decision ED-06, ADR 0004; stories M4-DB-02 and M5-AUD-02).
  The application role will never gain `DELETE`.
- **No tamper evidence.** Someone holding the database owner or a superuser role can alter or drop rows. There is no hash chain
  (planned for v3 in the architecture). In self-hosted mode the operator owns the database (threat model exposure 3).
- **Not every read is audited.** Exports are (`export.requested`, `export.downloaded`); ordinary reads and searches are not.

---

## B. Audit and verification log

Chronological, oldest first. Dates are the commit or document dates in the repository. "Result" is what the source recorded.

| #    | Date       | Scope                                                              | Outcome                                                                    |
| ---- | ---------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| B.1  | 2026-11-17 | Desk validation: competitors, market, technical assumptions        | Core design sound; 8 corrections, 3 risks                                  |
| B.2  | 2026-11-17 | Spike: row-level security through PgBouncer and pg-boss            | Assumption holds; 2 hazards found and fixed by design                      |
| B.3  | 2026-11-17 | SQL schema and isolation suite (Sprint 0)                          | 102 of 102 checks on PostgreSQL 16, 17 and 18                              |
| B.4  | 2026-11-17 | Web routing under static export (ADR 0002)                         | 8 of 8 on the chosen design                                                |
| B.5  | 2026-11-18 | Authentication and access design review (ASVS 4.0 level 2)         | Checklist done or n/a with reasons; gaps listed                            |
| B.6  | 2026-11-18 | Tenancy threat model                                               | 11 isolation and 10 authentication threats mapped to tests                 |
| B.7  | 2026-11-18 | M1 registry review and fixes                                       | ReDoS guard, `500` inputs and filter findings fixed                        |
| B.8  | 2026-11-18 | M1 CI security baseline: dependency audit, gitleaks, Trivy, CodeQL | Trivy found 6 HIGH, removed at the source the same day                     |
| B.9  | 2026-11-18 | Trusted proxy default                                              | `TRUST_PROXY` defaults to `false`                                          |
| B.10 | 2026-11-18 | M1 verification: isolation, performance, real-stack browser run    | Performance within budget; isolation green direct and pooled               |
| B.11 | 2026-11-19 | M1 founder acceptance walk-through                                 | Accepted; two findings fixed                                               |
| B.12 | 2026-11-19 | M2 wave 1 verification                                             | Concurrency, upload security and isolation tests added; no totals recorded |
| B.13 | 2026-11-19 | M2 wave 2 verification                                             | API e2e 566 of 566, browser 30 of 30; one unexplained intermittent failure |
| B.14 | 2026-11-19 | Test stability and scanner false positives                         | Four root causes fixed                                                     |
| B.15 | 2026-11-24 | Founder review of M2 and fixes (0.2.3)                             | UX and data consistency fixes; slow-test flake root cause fixed            |
| B.16 | 2026-11-24 | Managed departments and location edit fixes (0.2.4)                | 588/588 API e2e pooled, 54/54 real-stack; edit error root cause found      |
| B.17 | 2026-11-24 | Loaner pool backend                                                | 627/627 API e2e pooled and direct; alert job tested with an advancing clock |
| B.18 | 2026-11-24 | Three deferred M2 stories: list sorts, link a login, undo toast    | 622/622 API e2e pooled and direct, 59/59 real-stack; sort p95 50-100 ms    |
| B.19 | 2026-11-24 | Import backend (CSV / XLSX, dry run, Google Admin preset)          | importer e2e suites green on the branch; two defects found in B.20          |
| B.20 | 2026-11-24 | Wave 3 part 1 integration (four branches, follow-ups a-f)          | 699/699 API e2e direct and pooled, 21/21 clean builds, real-stack 64/64 |

### B.1 Desk validation - 2026-11-17

- **Scope:** `docs/validation/competitor_validation.md`, `market_validation.md`, `technical_validation.md`, consolidated in
  [04_validation_report.md](04_validation_report.md).
- **Method:** official vendor pages, repositories, npm metadata, release calendars and public forums; evidence graded
  Confirmed / Corrected / Risk / Weak / Contradicts. Reddit and review sites were not reachable, so market evidence is
  second-hand; no first-person evidence from the target buyer.
- **Result:** competitor facts mostly confirmed with several corrections; market demand weak to moderate (paid self-hosting
  has no demand evidence); technical design sound with 8 corrections and 3 risks (PostgreSQL 18 instead of 16, Next.js
  static-export routing, EAS update signing plan, self-hosted push, SSO vendor cost, SAML libraries).
- **Follow-ups:** 28 plan decisions adopted (decided 2026-11-17); pricing and edition changes; real-customer validation moves
  to the M4 beta with design partners (report section 6). Market validation by interview is still open.

### B.2 Spike: RLS through PgBouncer and pg-boss - 2026-11-17

- **Scope:** [spike_rls_pgbouncer.md](validation/spike_rls_pgbouncer.md): does tenant isolation hold with PgBouncer in
  transaction mode, and does the job queue work through the pooler.
- **Method:** hands-on in Docker on PostgreSQL 18.7 and 16.16, PgBouncer 1.26.1, pg-boss 12.38.2: nine isolation tests plus a
  prepared-statement test, direct and pooled; 600 interleaved transactions across two tenants; 100 queued jobs per scenario.
- **Result:** all tests passed on both versions, direct and pooled; pg-boss 100 of 100 jobs, 0 policy violations. Findings:
  F1 (medium) an empty-string tenant setting on a reused connection makes the policy error instead of returning no rows; F2
  (high if ever granted) querying a partition directly bypasses the parent's policy; F3 (high, confirms the rule) a
  session-level `SET` leaks the tenant across pooled clients, reproduced; F4 `FORCE ROW LEVEL SECURITY` neutralises owner and
  definer-view bypasses; F5 pg-boss works through the pooler except listen/notify (off by default).
- **Resolution:** policies use `NULLIF(current_setting('app.tenant_id', true), '')::uuid` (generated by the migration helper and
  checked by the schema lint); the application role is granted on partitioned parents only, enforced by the lint and a
  direct-partition test; the isolation suite runs through PgBouncer with a **negative control** (a deliberate session-level leak
  that must be observed, so a green run cannot be vacuous); PgBouncer `max_prepared_statements` is set; job payloads carry ids only.
- **Limits and follow-ups:** one PgBouncer version and image, no TLS, not a performance test; RDS Proxy not tested (the architecture
  requires a staging test; M6-SEC-01 reruns the isolation suite on the staging cell through the production PgBouncer
  configuration).

### B.3 SQL schema and isolation suite - 2026-11-17 (`ba8dc0d`)

- **Scope:** `docs/engineering/schema.sql` and `docs/engineering/tests/`.
- **Method:** `tests/run_one.sh <16|17|18>` starts a throwaway database, applies the schema and runs the isolation and
  constraint checks (tenant isolation, direct partition denial, append-only audit and history, partition factory, composite
  foreign keys, partial returns).
- **Result:** 102 of 102 checks pass on PostgreSQL 16, 17 and 18 (the earlier run had 70).
- **Follow-ups:** none open; the same rules are now enforced by the migrations' schema lint in CI.

### B.4 Web routing under static export - 2026-11-17

- **Scope:** [ADR 0002](adr/0002-web-routing-static-export.md), story M1-WEB-10.
- **Method:** eight browser routing cases (`apps/web/e2e/routing.spec.ts`, kept as a permanent test) run against five hosting
  behaviours: the dev server, a static export whose unknown paths return `404.html` with status 200, the same with status 404,
  a Caddy-style trailing-slash redirect, and a fallback that serves `index.html` for every unknown path.
- **Result:** 8 of 8 on the first four behaviours with the chosen query-string design; the "serve `index.html` for
  everything" mode passes only 5 of 8 and is therefore not supported (QR links `/s/<code>` need the edge fallback). A CI
  feature check fails the build on features static export cannot use. ADR accepted by the founder 2026-11-18.

### B.5 Authentication and access review (ASVS) - 2026-11-18

- **Scope:** [`engineering/auth-security.md`](engineering/auth-security.md), stories M1-AUTH-01 to 08.
- **Method:** design walk-through plus an OWASP ASVS 4.0 level 2 checklist for authentication, session management and access
  control, each row tied to a named test (`apps/api/test/auth/*`, unit tests); an auth security suite covers enumeration,
  fixation, CSRF, replayed tokens, MFA bypass, cross-tenant access and throttling.
- **Result:** every applicable row `done` with a test; `n/a` rows have reasons (passkeys and mobile tokens later, no SMS or
  e-mail codes by design).
- **Follow-ups (recorded gaps):** the breached-password list is a 10,000 entry subset (the optional online check covers the
  rest); passkeys later; per-tenant rate limits not built (M5-API-02); the pre-tenant lookups still use the application role
  with narrow grants until the dedicated role and pool of decision ED-05, a hard gate before M4.

### B.6 Tenancy threat model - 2026-11-18

- **Scope:** [`engineering/threat-model.md`](engineering/threat-model.md): isolation, authentication, jobs and outbox, mail,
  secrets and supply chain, self-hosted deployment.
- **Method:** STRIDE table per area; each mitigation names the test or file that proves it; a mitigation without a test is
  listed as a gap.
- **Result:** isolation rows T-ISO-1 to 11, authentication rows T-AUTH-1 to 10, plus jobs, mail, secrets and self-hosted rows.
  Six accepted exposures recorded: job-queue tables have no RLS (ids-only payloads compensate), non-RLS identity tables,
  superuser and owner bypass, the partition rule, whole-database restore granularity, and storage-level encryption only.
- **Follow-ups (section 9 of the document):** no general rate limit; no load test of concurrent argon2 logins; no
  single-tenant restore test (M6-TOPS-02); no production Compose or "refuse default password" check (M4); SPF/DKIM guidance
  (M4); CODEOWNERS and branch protection inactive until the founder acts. T-SH-4 and section 9 used to describe the six npm
  findings as accepted exceptions although they were removed the same day (B.8); corrected on 2026-11-24.

### B.7 M1 registry review - 2026-11-18 (`4fd487d`)

- **Scope:** the asset registry module (M1-REG-01..11).
- **Method:** a review pass on the merged module (the Definition of Done asks for a separate reviewer that gets the diff, not
  the author's conclusion), followed by tests: registry end-to-end, a contract walk, a route-replay harness that replays every
  registry route with foreign ids, and a 50,000-asset performance suite.
- **Result:** findings fixed: a ReDoS guard on search input, a shared sort term, NUL and date inputs that caused `500`,
  filter behaviour and edits of archived assets, scan with a slash; forged-cursor guard added (`e8f92a6`, ADR 0005); key
  columns made leak-proof for lookups under RLS.
- **Follow-ups:** none recorded as open.

### B.8 M1 CI security baseline - 2026-11-18

- **Scope:** [`engineering/ci.md`](engineering/ci.md): dependency audit (`pnpm audit` with an expiring allow-list), gitleaks
  8.30.1 (secrets, history and tree), Trivy 0.76.2 (image, fixable HIGH and CRITICAL) plus a CycloneDX SBOM, CodeQL
  `security-extended`, Dependabot.
- **Method:** each command run locally; workflows linted with `actionlint`; allow-list entries must have a reason and expire
  within 90 days.
- **Result:** the first Trivy scan found **six HIGH findings in the npm CLI bundled in the Node base image** (not run at
  runtime). They were first excepted with an expiry (2026-12-18), then **removed at the source on the same day** by deleting
  `npm` and `npx` from the runtime stage (`7078baf`): scan result 0 HIGH or CRITICAL with **no exceptions**
  (`.github/security/trivy-ignore.yaml` is empty). One dependency exception remains: `picomatch` GHSA-fc5q-39xc-vjpf (ReDoS,
  no patched release, dev tooling only, never in the runtime image), expires 2027-01-15. A strict `permissions` default and no
  `pull_request_target` in the workflows.
- **Follow-ups:** the hosted behaviour of these workflows is unverified (see "What could not be verified" in ci.md section 6);
  CodeQL on a private repository needs GitHub Advanced Security: **CodeQL status is unknown**, the founder is to check the first
  runs and set `CODEQL_DISABLED=true` if unavailable; review the open Dependabot pull requests; replace `@OWNER` in
  `.github/CODEOWNERS` and set branch protection (backlog F-01).

### B.9 Trusted proxy default - 2026-11-18 (`70e7be0`)

- **Scope:** client address handling for per-IP throttling, security events and audit rows.
- **Finding:** trusting every `X-Forwarded-For` would let a client forge its address and dodge per-IP throttling.
- **Resolution:** `TRUST_PROXY` defaults to `false` (the header is ignored); it accepts a hop count or a list of proxy
  addresses and is validated at start-up. An end-to-end test proves a spoofed header is ignored by default.
- **Follow-up:** self-hosted operators behind a reverse proxy must set it (documented in `auth-security.md`).

### B.10 M1 verification - 2026-11-18

- **Scope:** the M1 build (merge `6634c54`).
- **Method:** API end-to-end suites with every environment variable set and a no-skipped-tests gate, **direct and through
  PgBouncer** on PostgreSQL 16 and 18 in the CI matrix; route-replay isolation suite; perf budgets on 2 x 50,000 assets
  (`scripts/ci/perf-check.mjs`); real-stack Playwright smoke against the Compose stack of the production image; Compose smoke.
- **Result (as recorded):** asset list p95 61 ms (budget 500 ms), search p95 89 ms (budget 200 ms), tag lookup p95 56 ms
  (budget 150 ms), measured locally. The number of tests passing was not recorded in the documents for M1.
- **Follow-up:** the first hosted CI run and the first nightly performance run were pending when recorded.

### B.11 M1 founder acceptance - 2026-11-19 (`c682619`)

- **Scope:** M1-UX-01, the founder's walk-through of the running stack.
- **Result:** accepted. Two findings fixed during it: cramped inline role selects and a stray tab-list scrollbar (`d36a5e2`);
  no way to turn off two-step verification or regenerate recovery codes (`3d30054`). A follow-up became M2-AUTH-01 (show the
  organisation's MFA policy).

### B.12 M2 wave 1 verification - 2026-11-19 (`916b15c`)

- **Scope:** locations, people, custody, files with virus scanning, scan codes and their screens.
- **Method:** wave-1 end-to-end and contract walk (every operation of the new tags called live), route replay and isolation
  for the new tables, a concurrency test (50 simultaneous check-outs of one asset), the ClamAV test with the EICAR file against a
  real scanner, upload-security tests (type sniffing, SVG and HTML refused, signed links, enumeration throttle on scan
  resolve), real-stack browser tests for the new flows including photos through MinIO and ClamAV and the second tenant.
- **Result:** 50 concurrent check-outs gave one `201` and 49 `asset-already-checked-out`. Overall totals were not recorded for
  this wave.
- **Follow-ups:** the real USB scanner test (backlog F-02) is still open.

### B.13 M2 wave 2 verification - 2026-11-19 (`2f7c467`)

- **Scope:** labels, accessories and consumables, repairs, notifications, saved views, CSV export, MFA policy.
- **Method:** API end-to-end in both modes (direct, and through PgBouncer) with the full environment and 0 skipped, a contract
  walk of the new tags, tenant-isolation tests for the new tables, real-stack browser tests, label PDFs rasterised with every
  QR and Code128 decoded back.
- **Result:** **API e2e 566 of 566** (direct and through PgBouncer) and **real-stack browser tests 30 of 30** on the merged
  code ([STATUS.md](STATUS.md)). Label rendering: 500 labels in about 2 s, every sampled code decodes.
- **Open finding:** **one unidentified intermittent API test failure was seen in 1 of 5 runs under extra load**; the cause is
  not known. Follow-up: watch the first CI runs; if it recurs, capture the test name and logs. (A flake root cause fixed on
  2026-11-24, B.15, may or may not be the same one; this is not confirmed.)
- **Other follow-ups:** label die-line geometry is unverified until the founder's print test (M2-TAG-04).

### B.14 Test stability and scanner false positives - 2026-11-19

Root causes found and fixed after the wave 2 runs showed flaky behaviour under load:

- **Database starved by the e2e suite** (`d920186`): every test file booted its own app, so a busy machine opened 60 or more
  pooled and 300 or more direct connections on a pool of 4. Fixed with bounded parallelism (at most six files, pool of 6 each),
  PgBouncer pool 16, Postgres `max_connections` 300, partition DDL retries, and a partition test that cleans both tables.
- **Stale static web server** (`155c592`): the real-stack browser test could reuse a leftover static server that was proxying to
  a different API. It now never reuses one.
- **Tight timing in web tests** (`46becfa`, `953544e`, `b650623`): debounced search and scanner tests and toast counts depended
  on machine load; `findBy`/`waitFor` now wait up to 5 s and assertions are exact.
- **Shared demo data** (`d6a308f`): a seed test asserted exact counts on tenants other suites change; it now seeds its own.
- **gitleaks false positives** (`14ceb94`, `7f53ccb`): a label template key, a fake storage key and a fixture idempotency key were
  flagged as secrets; allow-listed narrowly (path plus pattern), the scan itself is unchanged.

### B.15 Founder review of M2 and fixes - 2026-11-24 (`2d9a14b`, version 0.2.3)

- **Scope:** the founder's review of the M2 wave 2 build; dashboard, naming and data consistency.
- **Method:** fixes with unit, component, API and real-stack browser tests (real-stack tests for the demo repairs, the
  no-open-repair hint and the banner).
- **Result:** see [VERSION.md](VERSION.md) 0.2.3. Slow API unit tests that flaked under a loaded parallel run were traced to a
  scan that walked the generated Prisma client (5 s down to 36 ms) and to PDF decoding budgets (`c583591`); two web assertions
  fixed (`a147719`, `e5bd3e8`).
- **Follow-up:** after the timeout fixes, three consecutive clean-state `pnpm turbo run lint typecheck test build --force`
  runs passed 21/21 at default concurrency (orchestrator run, 2026-11-24, before merging `2d9a14b`).

### B.16 Managed departments and location edit fixes - 2026-11-24 (`000b648`, version 0.2.4)

- **Scope:** founder requests: the location edit error and managed departments (migration `0100`, new tenant table
  `app.department`, permissions `department:read` / `department:manage`).
- **Method:** the change author reproduced 15+ location-edit scenarios against a real stack before and after the fix; new API
  e2e, web unit, mock e2e and real-stack scenarios; migration of free-text departments tested twice on messy values. The
  orchestrator re-ran the checks independently on the branch before merging.
- **Result:** clean-state build 21/21; API e2e **588/588 through PgBouncer**, 0 skipped (orchestrator run; the author also
  reports 588/588 direct); real-stack browser tests **54/54** (orchestrator run); mock browser tests 559/559 (author). Root
  cause of the founder's error: an address value over its limit (a country name instead of the two-letter code) produced a
  validation error the dialog could not attach to a field. No server error (5xx) on any edit path.
- **Follow-ups:** a department-name saved-view warning and department search are not built; viewers and technicians can open
  Settings → Departments only by URL (read-only).
- **Incident noted:** during this work the founder's local default Compose stack (containers and named volumes) was found
  removed. All automated runs used their own project names and ports; the cause was not determined. Only local demo data was
  affected; `docker compose up -d --build` recreates it.

### B.17 Loaner pool backend - 2026-11-24 (branch from `f687c04`, released in 0.2.5)

- **Scope:** M2-LOAN-01 and -03, the API of M2-LOAN-02 and -04, M2-LIFE-09 (migration `0120`, tables `loaner_pool`,
  `loaner_pool_member`, `loan_alert`, the assignment -> pool foreign key, queue `loan.alerts`, ED-20, ED-21, ADR 0011).
- **Method:** new API e2e (34 loaner tests plus a live contract walk of all 18 Loaners operations and the custody settings, with
  response bodies validated against the contract schemas), role matrix, route rules and route replay extended (tenant B against
  tenant A's pool, members, loans and settings), seed counts, the SQL design suite on `schema.sql` (`run_one.sh 18`), an own
  Compose project on alternate ports with the demo seed run by the migrate service.
- **Result:** clean-state build 21/21 (API unit 586, web 590, client 14); API e2e 627/627 through PgBouncer and direct, 0
  skipped (one run of the 100k-asset performance budget missed its search p95 under load and passed alone); SQL suite
  102/102; `schema:lint` 0 violations; drift check clean; Redocly lint 0 errors. The alert job was tested with an advancing
  clock: exactly one notification per loan, recipient and day, none on a second run, the reminder re-armed by an extension.
- **Follow-ups:** the tenant day is UTC (no tenant time zone); the demo tenants have 210 assets (web tests that count demo
  assets may need the new number); web screens for pools, quick loan, bulk return, the dashboard and the dialog pre-fill.

### B.18 Sort by location / assignee / due, link a person and a login, undo toast - 2026-11-24 (0.2.5)

- **Scope:** M2-REG-03, M2-USR-03 and M2-UX-02 (ED-22, ED-23): keyset paging with empty values last, `link-user` / `undo-custody`
  operations, migration `0130` (history event type), three new groups of problem codes.
- **Method:** each story built end to end (API, contract through `gen.mjs`, web, MSW mock) with its own tests: API e2e that
  compare every page of every sort with an independent SQL order, replay of every new route as another tenant, a contract
  walk of the new operations, mock-handler tests, web unit tests with axe, mock browser tests (axe in light and dark) and real-stack
  browser tests. The 50,000-asset performance suite gained the sort scenarios (15 scenarios x 120 samples, plans captured).
- **Result:** clean-state build 21/21; API unit 565, web unit 606; API e2e **622/622 through PgBouncer and 622/622 direct**, 0
  skipped; mock browser tests **572/572**; real-stack browser tests **59/59**; `schema:lint` 0 violations, Prisma drift clean.
  Sort p95 between 50 and 100 ms on 50,000 assets per tenant (budget 500 ms; table in ED-22).
- **Findings fixed during the work:** (1) the first version of the sorts sorted wide rows (100-500 ms): now two-phase, index-only
  scan of the existing partial indexes; (2) a join to a derived location-path table was evaluated once per asset when the planner
  under-estimated a tenant (RLS makes the tenant unknown at plan time): 450 ms in the full suite although 38 ms alone, now a single
  jsonb map; (3) the new perf test updated 45,000 assets and slowed the search measurements that followed: it is now the last test.
- **Known flake:** one pooled run of the full API e2e suite failed the pre-existing "custody check-in p95 < 300 ms" check (p95
  573 ms, max 4.7 s; p50 28 ms) and the next two pooled runs passed, as did the direct run; the host was shared with other
  Compose stacks. The perf suite measures wall-clock time and is sensitive to a busy machine.
- **Follow-ups:** scan-batch mode has no undo; there is no person merge; the web sorts of Location sort by the whole path, not the
  leaf name.

### B.19 Import backend - 2026-11-24 (branch from `f687c04`, integrated in B.20)

- **Scope:** M2-IMP-01..07 (migration `0110`, ADR 0010, ED-18, ED-19): import framework, file analysis (CSV encodings, XLSX
  through a streaming reader), column and value mapping, dry run with the real validators, batched resumable commit, Google
  Admin ChromeOS preset, generic templates, saved mappings, notification, 19 operations.
- **Method:** importer e2e suites (assets, entities, flows, a 100,000-row compose run with the worker killed mid-commit),
  isolation and route-replay cases for every operation, an in-process performance test with scaled gates (commit >= 10,000
  rows/min, dry run of 100,000 rows < 10 min) that the nightly job enforces.
- **Result:** all green on its branch (written before this record: the branch did not update AUDIT.md; the numbers are in the
  M2-IMP-04 and M2-IMP-05 backlog entries).
- **Findings after integration (B.20):** two defects that only the real-stack Google Admin run showed, both fixed (a row
  undone at commit left its created references in the resolver cache; the dry run did not report a tag another asset
  already has when matching on the serial).
- **Follow-ups:** imports do not undo (v1.1); the founder's real files (F-09) are still missing.

### B.20 Wave 3 part 1 integration - 2026-11-24 (version 0.2.4 plus four merges, released as 0.2.5)

- **Scope:** merged import backend (B.19), loaner backend (B.17), deferred items (B.18) and the web of wave 3 in that order;
  regenerated the contract (203 operations), the client and API.md; then the follow-ups: the import wizard against the real
  API (real MSW mock, `.xlsx`), the founder's loaner decisions (ED-24, migration `0140`), import data retention (ED-25,
  migration `0141`), performance suites that enforce budgets only with `PERF`, real-stack specs for the import wizard and
  the loaner desk, docs.
- **Conflicts:** gen.mjs (all backend blocks kept, the web proposal block dropped), problem catalogue, scheduler, registry
  module exports, subscriptions comment, route-replay, custody service (two methods added at the same place), docs;
  generated files regenerated, never merged.
- **Method:** clean-state build twice, API e2e direct and pooled (pooled twice) with the full environment, mock browser
  suite, real-stack suite on a fresh stack, drift check, schema lint, Redocly, generator reproducibility.
- **Result:** clean-state `turbo run lint typecheck test build --force` 21/21 twice (API unit 635, web 780, client 14); API
  e2e 699/699 direct, pooled and pooled again, 0 skipped; mock browser suite 719 of 719 (axe in light and dark);
  real-stack run 64 of 64 on a fresh stack; drift clean, schema lint 0, Redocly 0 errors, generator reproduces the yaml.
- **Findings fixed during the work:** (1) the real Google Admin run committed 22 of 48 rows: a row undone by its savepoint left
  the model it had created in the reference cache and the next rows hit a foreign key error: the resolvers are dropped
  after an undone row (regression test in flows); (2) the dry run said "create" for rows whose tag another asset already
  had (matching on serial): now an error in the dry run; (3) the mail tests of the loaner alerts failed when another test
  file's outbox relay claimed the events (its mail went to its own fakes): the tests hand the events to the subscriptions
  in-process; (4) real-stack tests that count "In repair" assets now ignore assets an import made.
- **Known flakes closed:** the perf suites (registry, custody, search) record numbers and assert a 10x sanity ceiling unless
  `PERF` is set; the nightly job sets it and runs them.
- **Follow-ups:** API details the web works around are listed in STATUS.md section 5; `a11y-w3` axe scenarios for the import
  wizard were edited by the web agent and run in the mock suite.

### B.21 Release 0.2.5 independent verification - 2026-11-24 (version 0.2.5)

- **Method:** a second pass on the merged code by a separate verifier, then the release checks on `main`.
- **Result:** 21/21 turbo tasks; API e2e direct 699/699; pooled 699/699 on the rerun; real-stack browser suite 64 passed; contract and drift checks clean.
- **Findings:** (1) one pooled run saw 5 schema-lint violations for temporary far-future partitions (for example `app.asset_history_2044_01`) that `schema-lint.e2e.test.ts` creates while a parallel file's lint ran: test-only flake, fixed by a shared helper that the six isolation files use (the product lint function is unchanged); (2) `docs/engineering/tools/gen.mjs` failed from a plain checkout (`yaml` not installed): `yaml` is now a pinned root devDependency and contributing.md names the commands.

### B.22 Location scoping for roles (M2-LOC-03) - 2026-11-25 (released in 0.2.6, branch `worktree-agent-a06c49586ab451805`)

- **Scope:** role assignments limited to a location subtree, enforced per permission by an application-layer predicate
  (`location_id IN` the subtree; RLS stays tenant-only; ED-26), on every scoped surface: assets, custody, people,
  locations, stock, repairs, loaner pools, loans and the loaner dashboard, labels, exports, imports, search, scan resolve,
  attachments, counts, saved views and notification recipients. Org-only permissions are never granted by a scoped
  assignment. Migration 0150, contract (`Me.location_scope`, scope notes), web (users screen, "Scoped to", forms).
- **Method:** API e2e per surface with a negative case each (`test/scoping`, 23 tests); a scoped route replay of every route
  as a location administrator against another site's records and records without a location: it fails on any marker of
  them in a response, on any write to them (version snapshot), and on any route without a scoped case. Independent code
  review by a separate agent on the diff. Clean-state build, API e2e direct once and pooled twice on the final code, mock
  browser suite, real-stack suite on a fresh stack, drift check, schema lint, generator reproducibility.
- **Result:** clean-state `turbo run lint typecheck test build --force` 21/21 (0 cached; API unit 647, web 792, client 14,
  ui-tokens 15, schemas 3); `format:check` clean; gen.mjs reproduces openapi.yaml with no diff, `gen-api-md --check` and
  client `generate:check` up to date, Redocly valid; API e2e on the final code: 725/725 in 58 files direct, pooled and
  pooled again, 0 skipped; mock browser suite 736 passed, 0 skipped; real-stack suite 65 passed on a fresh stack (the new
  spec: an administrator scopes a technician to one site, who then sees only that site's assets); drift clean, schema
  lint 0 violations.
- **Findings fixed during the work (review):** (1) the scope came from the route's permission only, so a bundle holding
  `export:run`, `import:run` or `search:read` org-wide but the data permission at a location could export, import or find
  records outside the scope. Scopes are now intersected with the records' own permission (exports, imports, search types,
  stock in scan resolve, the check-in half of a forced repair, undo). (2) A user with an org-wide `user:manage` and a
  location-scoped role could grant that role org-wide, including to themselves; grants now need each permission held as
  widely as granted. (3) A loan return sent the device to the pool's home even when that place lay outside the caller's
  scope; it now stays where it is. Regression tests for all three (custom role bundles inserted by SQL, since custom
  roles are v2). A reported issue about undo restoring an out-of-scope holder was already covered (the holder is
  resolved through the scoped target check).
- **Flake root-caused:** the first pooled run had two check-ins answer 500. The Postgres log showed `deadlock detected` on
  `UPDATE app.asset` against a process holding a table lock: the schema-lint e2e fixture for foreign keys created a table
  referencing the live `app.asset` inside its transaction (SHARE ROW EXCLUSIVE lock until rollback). The fixture now
  references a table of its own transaction. A mock browser run done while Docker rebuilt three images in parallel had
  one axe scenario time out waiting for a list (CPU contention caused by the verifier); the same spec passed 332/332 with
  four repeats, and the full suite 736/736 without the contention.
- **By design (ED-26):** catalogue records stay tenant-wide; uniqueness conflicts (tag, serial, email) remain tenant-wide
  signals; an in-scope asset's own history and current holder may name places or people outside the scope; company
  scope is still not enforced.
- **Independent verification and security review (2026-11-25):** every check passed again (API e2e 725/725 direct and
  pooled twice, real-stack 65, contract and drift checks). The founder confirmed the three ED-26 questions as built (a
  scoped Administrator is a site administrator; records without a location stay hidden; the holder's name shows on
  in-scope assets). Review findings and what was done:
  (1) **Accepted and documented:** an in-scope asset names an out-of-scope holder (id and name in `current_assignment`,
  history, custody list, CSV export), and filtering by that holder id returns those in-scope assets; the person record stays
  `404`. ED-26 states it, an e2e test asserts the boundary, and the scoped replay now has an in-scope asset lent to a
  person outside the scope (the holder is reachable on the asset and `404` as a person).
  (2) **Fixed:** the saved-view reference check was an existence oracle (an out-of-scope location or person gave no
  warning, an unknown id `not-found`); both now warn `not-found`.
  (3) **Fixed:** the import default location accepted an out-of-scope id (200) where an unknown id was `422`, and the value
  mapping by id resolved out-of-scope locations and people (their names in the dry-run preview); both now behave exactly
  like an unknown id. While fixing it, a second bug of the same family was found and fixed: a Prisma `where` of the form
  `{ id: x, ...locationScopeWhere(trx, 'id') }` lets the spread replace the `id` match, so any in-scope location matched;
  those filters are now `AND: [...]` (the saved-view check had passed by accident).
  (4) **Info items:** ED-26 now documents the ancestor path in `/auth/me` and that a location filter on an ancestor of the
  scope root returns the in-scope descendants (the earlier wording "outside the scope returns nothing" is corrected).
  Scan resolve's `allowed_actions` now follows the scope of each action's permission (small change, tested).
  Regression tests: 5 more in `test/scoping` (28), the scoped replay 4 tests.
- **Re-verification after the fixes:** clean-state `turbo run lint typecheck test build --force` 21/21 (0 cached; API unit
  647, web 792, client 14, ui-tokens 15, schemas 3); `format:check` clean; gen.mjs reproduces openapi.yaml with no diff,
  `gen-api-md --check` and client `generate:check` up to date, Redocly valid; drift clean, schema lint 0 violations; API
  e2e 731/731 in 58 files direct, pooled and pooled again, 0 skipped. No web code changed after the earlier mock (736) and
  real-stack (65) runs.


### B.23 Release 0.2.6 verification - 2026-11-25 (version 0.2.6)

- **Method:** the branch of B.22 merged to `main` with a no-fast-forward merge, the six `package.json` versions set to 0.2.6, then the release checks on `main` in the order of `contributing.md`, from a clean state (`next-env.d.ts`, `.next`, `src/generated` and `openapi.generated.json` removed), on a separate compose project (`atrel6`, alternate ports) that was torn down with `down -v` afterwards; the founder's stack was not touched.
- **Result:** `pnpm install --frozen-lockfile` clean; `turbo run lint typecheck test build --force` 21/21 (0 cached; API unit 647, web 792, api-client 14, ui-tokens 15, schemas 3); `format:check` clean; `gen.mjs` reproduces `openapi.yaml` with no diff (203 operations), `gen-api-md --check` and api-client `generate:check` up to date; `db:pull` drift clean, `schema:lint` 0 violations and role audit OK; API e2e through PgBouncer, default settings, full environment: 731/731 in 58 files, 0 skipped, twice (both runs green, no rerun needed); real-stack browser suite 65 passed on a fresh stack (port 4174 free before the run).
- **Findings:** none. The deadlock flake of B.13 / B.22 did not recur in the two pooled runs.

### B.27 Guide-writing fixes (ED-29) - 2026-11-25 (unreleased, branch `worktree-agent-a57e722d6ff88727d`)

- **Scope:** seven issues found while writing the user guides: next available device at the loaner desk, not-deployable devices refused when scanned, the per-row "checked at commit" noise and the commit-only failures of the import dry run, the Google Admin mapping (org unit -> department, disabled -> Retired), the People table at 1280 px, the two meanings of "Overdue", and the hint of the loan default.
- **Method:** unit, mock e2e (with axe in light and dark for the new desk states) and API e2e for each fix; the dry-run rehearsal is tested to leave every registry, audit and outbox count unchanged, to find a failure the old dry run left to the commit (a required custom field of a row whose model and location are new), and to agree with the commit row for row; the import throughput suite was run with its gates (3,000 rows: dry run 7.2 s, projected 4 min per 100,000 rows against a 10-minute budget; commit 15,009 rows/min against 10,000). Verification on a separate compose project (`atfix`, ports 17000-17099), torn down with `down -v`; the founder's stack was not touched.
- **Result:** from a clean state `turbo run lint typecheck test build --force` 21/21 (API unit 650, web 800); `format:check` clean; `gen.mjs` reproduces `openapi.yaml` with no diff, redocly lint valid, `gen-api-md --check` and api-client `generate:check` up to date; `db:pull` no drift, `schema:lint` 0 violations and role audit OK; API e2e with the full environment on a fresh stack, 735/735 in 59 files with 0 skipped: once direct and twice through PgBouncer (after the fix of finding 2; the first direct run, before it, had the one deadlock failure); mock web e2e 749 passed with the two timing cases of finding 6 (scan burst passed on its retry; the auth axe file 54/54 twice alone); real-stack browser suite 65/65 on a fresh stack (port 4174 free before the run).
- **Findings:** (1) the contract still described the next available device as "lowest asset tag first" (ED-24 changed the rule); corrected in `gen.mjs`. (2) **Root cause of the deadlock flake of B.13 / B.22:** the first direct API e2e run had one failure, a 500 on a check-in in `custody-undo.e2e.test.ts`. The Postgres log showed a deadlock between the check-in (holding `app.asset`, inserting into `asset_history`) and `app.ensure_partitions`, called by the partition-rotation test in `schema-lint.e2e.test.ts` (holding `asset_history` while creating a partition, waiting for `SHARE ROW EXCLUSIVE` on `app.asset` for the cloned foreign key). `ensurePartitions` retries its own deadlocks, but when Postgres picked the check-in as the victim the user got a 500; the monthly rotation and the migrate step can meet live traffic the same way. Fixed by migration 0180: the function takes every lock first, with NOWAIT, and never waits while holding one, so it cannot be part of a cycle (55P03, retried by the caller). A regression test (`schema-lint.e2e.test.ts`, "never deadlocks with a custody write") holds a writer's locks in the order of a check-in with a 400 ms lock timeout; it fails on the 0006 definition (the writer times out behind the rotation) and passes on 0180. (3) **Web unit flake** (`scan.test.tsx`, "reports a code nobody has"; seen once while the turbo run shared the machine with a Docker build): the wedge detector reads `event.timeStamp` and treats a gap over 80 ms as typing, and every `fireEvent` in the test flushes a React render of the shell, which took longer than that on the saturated machine, so the burst read as typing. Reproduced by giving the keys 100 ms gaps (5 of 14 tests fail the same way); the test now gives the burst its own clock (5 ms per key). (4) **Issue 3 seen on the real stack:** the real-stack Google Admin import now reports 4 errors in its dry run: the demo's Chromebook cart already holds the tags CHR-00001, -04, -07 and -10 of the sample file. Before this change those four rows showed "Create" (their new models made the dry run skip the facade, and so the tag check) and failed at commit; the old spec only asserted "at least 40 assets", which hid it. The spec now pins 44 created, 4 errors, 16 Retired, none in repair, the org-unit departments and no new location. (5) The mock e2e found a real bug in the new review sentence (the count was passed as a formatted string, so the plural form was not chosen and the key showed) and a mock gap (it did not count a location below a new parent given as a path); both fixed. (6) Two mock e2e failures outside this change, both timing on a shared machine: the scan spec's real keyboard burst (documented in the spec, passes on its retry) and one axe case of the auth pages whose page was still "Starting the mock API" after the 5 s `expect` timeout (the service worker's cold start); the file passes 54/54 twice alone. Left as is, recorded here.

---

## C. Open items

| Item                                                                                                     | Why it matters                                                        | Owner / where tracked                                                                                    |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Intermittent API test failure seen once in 5 runs (B.13): very likely the schema-lint fixture deadlock fixed in B.22; did not recur in the two pooled runs of B.23 | Confirm it does not recur | Claude; watch CI |
| Label die-lines and print calibration unverified                                                         | Labels may be off the physical stock until printed and measured       | Founder 👤, M2-TAG-04, F-02                                                                              |
| Real USB scanner not yet tested                                                                          | Scanner input timing is only simulated                                | Founder 👤, LIFE-08, F-02                                                                                |
| **External penetration test** before the Cloud launch                                                    | Independent test of a multi-tenant internet-facing service            | M6-SEC-02; vendor to be booked at the start of M5 (F-21); no open cross-tenant finding allowed at launch |
| Isolation re-verification on the real cloud stack, RDS Proxy test                                        | The spike covered PgBouncer only                                      | M6-SEC-01                                                                                                |
| Hosted CI never observed; CodeQL availability unknown; branch protection and CODEOWNERS inactive         | Gates exist but are not enforced on the hosted repository             | Founder 👤, F-01; STATUS.md section 4                                                                    |
| ADRs 0003 to 0009 still `PROPOSED`                                                                       | Decisions are built but not signed off                                | Founder 👤                                                                                               |
| No audit-log read endpoint, screen or export; no retention enforcement                                   | The record cannot be inspected in the product; it grows without bound | M5-AUD-01, M5-AUD-02, M4-DB-02                                                                           |
| No general per-tenant rate limiting                                                                      | Only sign-in and scan-resolve throttling exist                        | M5-API-02                                                                                                |
| Pre-tenant lookups share the application role                                                            | A SQL-injection bug in a tenant query could reach identity tables     | ED-05, M4-DB-01 (hard gate before M4)                                                                    |
| No production Compose bundle, "refuse default password" check, restore drill, single-tenant restore test | Needed before real users and before Cloud                             | M4-BND, M4-REL, M6-MON-03, M6-TOPS-02                                                                    |
| Load test of concurrent argon2 logins                                                                    | CPU and memory exhaustion by logins not measured                      | threat model T-AUTH-10                                                                                   |
| `picomatch` advisory allow-listed (dev tooling) until 2027-01-15                                         | Expires and then fails the build unless a fix exists                  | `.github/security/audit-allowlist.json`                                                                  |
| Read-only root filesystem for the runtime container not set                                              | Hardening                                                             | M1-REPO-04 (partial)                                                                                     |
| Two open Dependabot pull requests (GitHub Actions; OpenTelemetry exporter)                               | The exporter was pinned on purpose                                    | Founder 👤, STATUS.md                                                                                    |
