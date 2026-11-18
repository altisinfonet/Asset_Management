# 05 - Build Backlog (Milestones M1-M6)

Status: DRAFT for founder review. Date: 2026-11-17. Written by the product/engineering lead for a team of one human founder (developer) plus Claude (AI engineer and designer orchestrating sub-agents).
Inputs: `docs/02_product_plan.md` (sections 4, 5, 6, 7, 6.15, 12), `docs/03_system_architecture.md` (sections 4, 5, 6, 7.3, 8), `docs/validation/spike_rls_pgbouncer.md`.

**Authoritative milestone definition (supersedes the plan's single "MVP" bucket for scheduling purposes):**

| Milestone | Scope in one line |
|---|---|
| M1 | Monorepo + tenancy/RLS + auth (email/password + MFA-ready) + asset registry (assets, categories, manufacturers, models, custom fields, status labels) + web admin; runs locally via Docker Compose |
| M2 | Locations, users/people, check-out/check-in/transfer, history, QR/Code128 labels (PDF sheets), CSV import with dry run, Google Admin ChromeOS CSV template, accessories/consumables, loaner pool, repair log |
| M3 | Expo mobile app (scan, check-out/in, stocktake, photos), online-first with retry queue |
| M4 | Self-hosted edition bundle (Compose, Caddy, PgBouncer, license JWS, adapters, install/upgrade tests): first edition to reach real users |
| M5 | Snipe-IT importer, reports + dashboard, webhooks, licenses (seats/expiry), audit log UI, REST API completeness + OpenAPI |
| M6 | Cloud SaaS launch on AWS (multi-tenant ops, Stripe billing, monitoring), app-store submission, SAML/SCIM add-on |

No calendar dates are attached to milestones. The plan's month markers (closed beta ~month 5, GA ~month 8) were set for a 5-6 engineer team; this backlog is sized for founder + Claude, so treat sizes (below) as the planning currency and re-baseline dates after M1 (section 13, "Re-baselining").

Contents: 1 Conventions - 2 M1 - 3 M2 - 4 M3 - 5 M4 - 6 M5 - 7 M6 - 8 Founder-only tasks - 9 Cross-cutting - 10 Sprint 0 checklist - 11 Parked beyond M6 - 12 Open questions - 13 Re-baselining.

---

## 1. Conventions

### 1.1 Story ID format

`M<milestone>-<AREA>-<nn>`, for example `M1-TEN-02`. `S0-` prefixes Sprint 0 items, `F-nn` founder-only tasks. IDs are never reused; a dropped story is marked `DROPPED`, not renumbered.

| Area code | Meaning |
|---|---|
| REPO | Monorepo, Docker, local dev environment |
| DB | Database access layer, migrations, roles |
| TEN | Tenancy, RLS, isolation tests, control plane |
| PLAT | Platform kernel (API conventions, audit, events, jobs, crypto, mail) |
| AUTH | Identity, sessions, MFA, RBAC |
| REG | Registry domain (assets, categories, models, custom fields, statuses, vendors) |
| WEB | Next.js web admin |
| LOC / USR | Locations / people |
| LIFE | Lifecycle (check-out, check-in, transfer, history, stocktake) |
| FILE | Files and attachments |
| ACC | Accessories and consumables |
| LOAN | Loaner pool |
| MNT | Repair log / maintenance |
| TAG | Labels, codes, scan resolve |
| IMP | Importers |
| NOT | Notifications and alerts |
| MOB / SCAN / FLOW / STK | Expo app foundation / scanning / flows / stocktake |
| LIC | License system (M4) or software licenses (M5): the milestone prefix disambiguates |
| BND / REL / SHA | Self-hosted bundle / release engineering / self-hosted auth+export |
| RPT / HOOK / AUD / API / SNIPE | Reports+dashboard / webhooks / audit log / REST API / Snipe-IT importer (M5) |
| INF / TOPS / BILL / MON / SEC / SSO / MOBL / GTM / LAUNCH | M6 areas |
| CI / OPS / DOC / UX / QA | CI gates / observability / docs / founder acceptance / quality |

### 1.2 Size

Sizes are of focused AI-engineer effort including tests and verification, not calendar time. **S**: under half a day. **M**: 1-2 days. **L**: 3-5 days. Anything larger than L must be split before it is started. Rough planning weights for re-baselining: S = 0.5, M = 1.5, L = 4 working days.

### 1.3 Owner

- **Claude**: Claude implements (orchestrating sub-agents) and verifies; the founder reviews at the milestone acceptance walk-through, not per PR.
- **Founder**: only the founder can do it (accounts, money, legal, physical devices, external parties).
- **Both**: Claude implements, but the founder must supply an input, make a decision, or accept the result during the story (for example UX acceptance, sample data, device testing).

### 1.4 Priority and status

Priority uses the plan's MoSCoW: every story is **Must** unless tagged **(Should)** or **(Could)**. A Should slips before any Must (plan 5.4 cut order). Status values: `todo`, `doing`, `blocked`, `done`, `partial` (works, with a stated gap), `dropped`. M1 stories carry a `Status:` line with a one-line note (state of 2026-11-18).

### 1.5 Definition of Done (applies to every story)

A story is done only when all of these hold:

1. **Code** merged to `main` through a PR with a clear description; no TODOs left without a linked story ID.
2. **Tests**: unit tests for logic, integration tests for DB/API behaviour, and the story's acceptance criteria each covered by at least one automated test unless the criterion is explicitly marked `(manual)`.
3. **CI green** on the full required pipeline (section 9.3 gates active at that milestone), not a subset.
4. **Docs**: API changes reflected in the generated OpenAPI; user-visible behaviour in the docs/changelog; schema changes in the data model doc; new decisions as an ADR.
5. **Verified by Claude**: Claude runs the feature end to end against the Docker Compose stack (not only unit tests), and a separate review pass (a different sub-agent given the diff, not Claude's conclusion) finds no unresolved correctness or security issues.
6. **Tenant tables**: any story that adds or alters a tenant-owned table must also (a) use the `createTenantTable` helper (M1-TEN-01), (b) pass the schema lint, and (c) be covered by the cross-tenant isolation suite, both direct and through PgBouncer. A story that adds a route must be registered with the route-replay harness (foreign-ID requests return 404/403).
7. **Audit and events**: every state-changing endpoint writes an audit record and an outbox event in the same transaction as the change.
8. **Founder acceptance** for UX stories (those tagged `UX` or owned `Both` for screens): the founder has used the flow in the running stack and accepted it in the milestone acceptance story (`Mn-UX-01`). Un-accepted UX stories do not block merging but do block closing the milestone.

### 1.6 Story template used below

```
#### M1-XXX-NN - Title
Size: S|M|L - Owner: Claude|Founder|Both - Deps: story IDs - Priority: Must|(Should)|(Could)
Description.
- [ ] Acceptance criteria (checkable)
```

Milestones 3-6 use a compact form (key stories with 2-4 acceptance bullets) because their detail will change with what M1-M2 teach us.

---

## 2. Milestone M1 - Foundations: tenancy, auth, asset registry, web admin

**Goal.** Prove the riskiest assumptions first (shared-database multi-tenancy with RLS through PgBouncer; static-export web app) and deliver a usable asset registry that runs entirely on a laptop with `docker compose up`.

**Exit criteria (demoable outcome).** From a clean clone, `docker compose --profile pooling up` starts Postgres 18, PgBouncer, API, worker, web, MinIO, Mailpit and Redis and seeds two demo tenants. The founder can: (1) log in as an Owner with password plus TOTP, invite an Admin by email (captured in Mailpit) and see role-restricted navigation; (2) create a category with typed custom fields, a manufacturer, a model, status labels and a tag-numbering template; (3) create, search, filter, clone, bulk-edit and archive assets in the web UI, including 50,000 seeded assets within the performance budgets; (4) do the same through the REST API using the generated `packages/api-client`; (5) see every write in the audit log API; and (6) watch the CI isolation suite pass on PostgreSQL 16 and 18, direct and through PgBouncer, including the negative control that proves a session-level `SET` leak would be caught.

**Out of scope for M1** (deliberately): locations, people, check-out, files, imports, mobile, billing, SSO/OIDC, API keys, webhooks.

**Epics**

| Epic | Area | Stories |
|---|---|---|
| E1.1 Repo and local environment | REPO | 5 |
| E1.2 Database and migrations | DB | 2 |
| E1.3 Tenancy and isolation (never cut) | TEN | 9 |
| E1.4 Platform kernel | PLAT | 9 |
| E1.5 Identity and access | AUTH | 8 |
| E1.6 Registry domain | REG | 11 |
| E1.7 Web admin | WEB | 11 |
| E1.8 CI quality gates | CI | 5 |
| E1.9 Observability, docs, acceptance | OPS, DOC, UX | 3 |

**Suggested build order.** (1) REPO-01..04, DB-01..02, WEB-10 (static-export spike runs in week 1 in parallel); (2) TEN-01..06 plus CI-01..02 so the isolation suite exists before the first domain table; (3) PLAT-01..08, TEN-07..09; (4) AUTH-01..08; (5) REG-01..11 with WEB-01..09 alongside; (6) CI-03..05, OPS, DOC, UX-01. The isolation suite is a gate for everything after step 2.

### E1.1 Repo and local environment

#### M1-REPO-01 - Shared workspace tooling
Size: M - Owner: Claude - Deps: S0-REPO-01
Status: done - Turborepo, shared tsconfig, ESLint flat config, Prettier, Vitest; Dependabot instead of Renovate.
Sprint 0 creates the empty Turborepo + pnpm workspaces (`apps/api`, `apps/web`, `apps/mobile` placeholder, `packages/api-client`, `packages/schemas`, `packages/ui-tokens`). This story adds the shared configuration every package uses.
- [ ] One base `tsconfig` (TypeScript 6, strict, ESM), ESLint flat config and Prettier shared by all packages; `pnpm lint`, `pnpm typecheck`, `pnpm test` run through Turborepo with remote-cache-ready config.
- [ ] Node 24 LTS pinned in `.nvmrc` and `engines` (minimum 22.13); a CI check fails if a different major is used.
- [ ] Vitest configured for unit and integration projects; coverage reported, no threshold yet.
- [ ] Renovate (or Dependabot) config with major bumps of NestJS, Next.js, Expo and pg-boss set to manual.
- [ ] `pnpm install` on a clean clone and `pnpm build` succeed on Windows (Git Bash) and Linux CI.

#### M1-REPO-02 - Docker Compose dev stack
Size: L - Owner: Claude - Deps: M1-REPO-01, M1-REPO-04, M1-DB-02
Status: partial - Compose runs postgres 18, pgbouncer, migrate, api, worker, scheduler, mailpit, minio; the web dev server only with `--profile web`; no redis service (throttling lives in Postgres); roles are `app_owner` / `app_user`.
The developer Compose file from architecture 8.2 (not the self-hosted bundle).
- [ ] `docker compose up` starts `postgres:18`, `migrate` (one-shot), `api`, `worker`, `scheduler`, `web`, `minio`+`minio-init`, `mailpit`, `redis`, with health checks and correct `depends_on` (`service_completed_successfully` for migrate).
- [ ] Postgres init script creates roles `migrator` (owner) and `app` (non-owner, NOBYPASSRLS, not superuser) and extension `pg_trgm`; the PG 18 data-directory/volume layout is verified (volume survives `down`/`up`).
- [ ] API hot reload works from bind-mounted sources; web runs `next dev` on 3001 with a dev-only way to reach `/v1` (env toggle or small reverse proxy; Next.js rewrites are unavailable with `output: 'export'`).
- [ ] Only dummy credentials in the repo; real values come from an uncommitted `.env.local`.
- [ ] `docker compose down -v && docker compose up` reaches a healthy state in under 5 minutes on the founder's machine (manual).

#### M1-REPO-03 - PgBouncer `pooling` profile
Size: M - Owner: Claude - Deps: M1-REPO-02
Status: done - PgBouncer 1.26.1 is always in the api path (transaction mode); `--profile pooling run pgbouncer-check` asserts the settings and the `app_one` alias.
- [ ] Profile `pooling` runs PgBouncer 1.26.1 or later in transaction mode with `max_prepared_statements=100`, `server_reset_query` empty, and `default_pool_size` small enough (4) to force multiplexing.
- [ ] A second database alias `app_one` with `pool_size=1` exists solely for the negative-control test.
- [ ] With the profile on, `api`/`worker`/`scheduler` use the PgBouncer URL; `migrate` and pg-boss schema/maintenance use the direct URL.
- [ ] `docker compose --profile pooling up` works end to end and `SHOW POOLS` shows `pool_mode=transaction`.

#### M1-REPO-04 - Backend Dockerfile (one image, many roles)
Size: M - Owner: Claude - Deps: M1-REPO-01, M1-PLAT-01
Status: partial - One image, four roles, digest-pinned Node 24 slim, non-root, bundled npm removed (Trivy: 0 HIGH/CRITICAL with no exceptions); the read-only root filesystem is not set yet.
- [ ] Multi-stage `apps/api/Dockerfile` with stages `base` (Node 24 slim pinned by digest, non-root), `deps` (lockfile-only layer with BuildKit cache), `build`, `dev` (watch, never pushed), `runtime` (compiled output, prod deps, migrations, non-root, no secrets).
- [ ] `APP_ROLE` (`api`, `worker`, `scheduler`, `migrate`) selects behaviour; unknown role exits non-zero with a clear message.
- [ ] Runtime image builds from the monorepo root in CI with layer caching; image size and a Trivy scan result are recorded in the PR (gate comes in M1-CI-03).
- [ ] Container runs with a read-only root filesystem (writable tmp only).

#### M1-REPO-05 - Seed data and demo tenants
Size: S - Owner: Claude - Deps: M1-TEN-09, M1-REG-05
Status: done - `pnpm seed` / `SEED_DEMO_DATA=true` creates Acme and Globex with Owner (TOTP), Admin, Technician, Viewer and 50 assets each; idempotent, refuses production.
- [ ] `pnpm seed` (also run by `migrate` in dev) creates tenants "Acme" and "Globex", each with an Owner, an Admin, a Technician, a Viewer, default status labels, categories, models and 50 assets with custom fields.
- [ ] Seed is idempotent (running twice changes nothing) and refuses to run when `NODE_ENV=production`.
- [ ] Both tenants have deliberately overlapping tags/serials so uniqueness-per-tenant bugs surface immediately.

### E1.2 Database and migrations

#### M1-DB-01 - ADR and implementation: data access layer and migration tool
Size: M - Owner: Both - Deps: S0-ADR-01
Status: done - ADR 0001 accepted: Prisma 7 with the pg driver adapter over raw SQL migrations and a checksum ledger.
Architecture 8.5 leaves Kysely vs Drizzle and node-pg-migrate vs Atlas open. Decide on evidence, then implement.
- [ ] A written ADR compares the options against three requirements: per-transaction `set_config(..., true)`, no session state behind PgBouncer, SQL-first migrations that Claude can review; founder approves the choice.
- [ ] Chosen query layer wired into `tenancy` only (nothing else imports the driver); chosen migration tool runs as `migrator` with `lock_timeout`/`statement_timeout`.
- [ ] A migration can be applied, and rolled forward (expand/contract) in CI against an empty database and against the previous release's schema.
- [ ] Named prepared statements are either not used or verified working with `max_prepared_statements=100`.

#### M1-DB-02 - Roles, extensions and UUIDv7
Size: M - Owner: Claude - Deps: M1-REPO-02
Status: done - Roles `app_owner` / `app_user` (NOBYPASSRLS), pg_trgm, app-side UUIDv7; 14 migrations.
- [ ] Roles `migrator` (owner of all objects) and `app` (non-owner, no BYPASSRLS, no CREATE) created by a bootstrap migration/script; `app` has no privileges by default, only explicit grants per table.
- [ ] A role-audit script asserts: `app` and any future reporting/support roles are neither superuser nor BYPASSRLS; runs in CI.
- [ ] UUIDv7 generated app-side (single code path for PG 16 and 18); a unit test shows ids sort by creation time; `pg_trgm` installed.
- [ ] Documented procedure for a controlled superuser path for backfills (FORCE makes the owner see 0 rows without a tenant).

### E1.3 Tenancy and isolation (never cut)

#### M1-TEN-01 - `createTenantTable` migration helper and the NULLIF policy
Size: M - Owner: Claude - Deps: M1-DB-01, M1-DB-02
Status: done - Tenant-table helper, NULLIF policies, FORCE RLS.
The single approved way to create a tenant table (spike finding F1).
- [ ] Helper emits `tenant_id uuid NOT NULL`, `created_at`, `updated_at`, `created_by`, `archived_at`, `company_id`, `ENABLE` + `FORCE ROW LEVEL SECURITY`, and policy `tenant_isolation` with both `USING` and `WITH CHECK` of `tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid)`.
- [ ] Helper adds an index with `tenant_id` as the leading column and supports composite keys `(tenant_id, id)` and composite foreign keys.
- [ ] Unit tests prove: unset GUC returns 0 rows; a used pooled connection (GUC `''`) returns 0 rows and does not raise error 22P02; inserting a foreign `tenant_id` fails with 42501.
- [ ] Granting privileges to `app` is part of the helper (DML only, no DDL, no grants on partitions).

#### M1-TEN-02 - `withTenantTx` and `TenantRepository`
Size: L - Owner: Claude - Deps: M1-TEN-01
Status: done - `TenancyService.withTenantTx` and `TenantRepository`.
The only code path to tenant data (architecture A1, A6).
- [ ] `withTenantTx(ctx, fn)` opens an explicit transaction and calls `set_config('app.tenant_id' | 'app.actor_id' | 'app.request_id', value, true)` before any query; no session-level `SET` exists anywhere (a grep-based test fails the build if `SET app.` without `LOCAL` appears).
- [ ] `TenantRepository` base class exposes the query builder only inside a transaction; calling it outside throws.
- [ ] ESLint rule (or dependency-boundary rule) forbids importing the DB driver outside `tenancy`; a deliberate violation in a fixture fails lint.
- [ ] Errors roll back data, audit row and outbox row together (test with a forced failure after the audit insert).

#### M1-TEN-03 - Schema lint
Size: L - Owner: Claude - Deps: M1-TEN-01
Status: done - `app.schema_lint()` and the role audit run in CI.
Runs in CI against a freshly migrated database (architecture 5.3, 8.5).
- [ ] Every table is classified `tenant`, `non-tenant` or `partition`; an unclassified table fails the build.
- [ ] Tenant tables must have `tenant_id`, RLS enabled and forced, a policy in the NULLIF form with `WITH CHECK`, and a leading-`tenant_id` index; foreign keys between tenant tables must be composite `(tenant_id, id)`.
- [ ] Views must be `security_invoker = true`; any `SECURITY DEFINER` function fails the build.
- [ ] Any role other than the owner holding privileges on a partition fails the build; `app`/support/reporting roles with BYPASSRLS or superuser fail the build.
- [ ] Each rule has a failing fixture migration proving the rule fires.

#### M1-TEN-04 - Two-tenant isolation harness (direct connection)
Size: L - Owner: Claude - Deps: M1-TEN-02, M1-TEN-03
Status: done - Two-tenant isolation harness plus the route-replay harness for registry routes.
Ports the spike tests (`docs/validation/spike_rls_pgbouncer.md` tests a, b, b3, c, e, f, h) into the permanent suite.
- [ ] Fixtures create two tenants with overlapping data; tests cover: A sees only A; unset context returns 0 rows and inserts fail with 42501; NULLIF case (connection reused after a tenant tx returns 0 rows, not 22P02); 600 interleaved concurrent transactions with zero cross-tenant reads; `WITH CHECK` blocks writing a foreign `tenant_id`; `security_invoker` view respects RLS; owner without a tenant sees 0 rows (FORCE).
- [ ] **Route replay**: every registered HTTP route is called with tenant B's credentials against tenant A's resource IDs and must return 404/403; the harness fails if a route is not registered with it.
- [ ] Runs on PostgreSQL 16 and 18 in CI (matrix) and locally with `make test-isolation`.
- [ ] Suite is the first required status check on every PR.

#### M1-TEN-05 - Isolation suite through PgBouncer with negative control
Size: M - Owner: Claude - Deps: M1-TEN-04, M1-REPO-03
Status: done - Isolation suite also runs through PgBouncer with the negative control.
- [ ] The same suite runs through PgBouncer 1.26.1+ in transaction mode (`max_prepared_statements=100`).
- [ ] **Negative control**: a deliberate session-level `SET app.tenant_id` through the `pool_size=1` alias must be detected as a leak; the test passes only if the leak is observed, so a green run proves the harness can fail.
- [ ] Added cases: a transaction that fails mid-way and the next borrower sees no tenant; no GUC value visible to 80 autocommit queries outside any transaction; named prepared statements survive pooling.
- [ ] CI fails if the negative control stops detecting the leak (for example if pooling is accidentally bypassed).

#### M1-TEN-06 - Partition grant rule and direct-partition test
Size: M - Owner: Claude - Deps: M1-TEN-03, M1-PLAT-04
Status: done - Partition grant rule in the schema lint; direct-partition test.
(Spike finding F2.)
- [ ] `audit_log` is range-partitioned by month; partitions are created by the `migrator` role (rotation job runs as the owner) with no grants to `app`; `app` holds privileges on the parent only.
- [ ] Optional defence in depth: each partition has `FORCE` RLS and the same policy.
- [ ] Isolation test: as `app`, `SELECT` from a named partition returns permission denied (42501); via the parent, select and insert routing still work.
- [ ] Schema lint (M1-TEN-03) fails if a migration grants anything on a partition; default privileges do not cover partitions.
- [ ] Creating next month's partition works with no manual step (job tested by advancing the clock).

#### M1-TEN-07 - Control-plane module (minimal)
Size: M - Owner: Claude - Deps: M1-TEN-02
Status: done - Control-plane module.
- [ ] Tables `tenant`, `company` (default company per tenant), `cell_map` with `resolveTenant(tenantId)` always returning cell `us-1` (a constant `local` in Self-hosted later); `entitlementsFor(tenantId)` returns an "all modules on" stub behind the `EntitlementSource` interface.
- [ ] Tenant status (`active`, `suspended`, `deleting`); requests and jobs for a non-active tenant are rejected.
- [ ] Control-plane tables are accessed by a restricted role/schema path and classified `non-tenant` in the lint, with justification recorded.

#### M1-TEN-08 - `identity` schema for pre-tenant lookups
Size: M - Owner: Claude - Deps: M1-TEN-07
Status: done - `identity` schema for pre-tenant lookups.
Resolves architecture Appendix A item 2 (authn runs before the tenant is known).
- [ ] Schema `identity` holds only hashes and ids needed before tenant resolution: session lookup, invitation token lookup, API-key hash lookup (table created, populated in M5), SSO domain map.
- [ ] `app` has the minimum grants (no unrelated columns), tables are classified `non-tenant` with an explicit reason, and no `SECURITY DEFINER` is used.
- [ ] Test: with no tenant set, `app` can resolve a session token hash to `{tenant_id, user_id}` and cannot read any tenant table.
- [ ] Failed logins and invalid API keys write to a control-plane security log table, not the tenant audit log.

#### M1-TEN-09 - Tenant bootstrap
Size: M - Owner: Claude - Deps: M1-TEN-07, M1-AUTH-01
Status: done - Tenant bootstrap CLI and service.
- [ ] CLI/API-internal `bootstrapTenant({name, ownerEmail})` creates tenant, default company, Owner user (invite email sent), built-in roles, default status labels, default categories; idempotent on rerun.
- [ ] The same function is what Self-hosted first-run will call (M4); there is no separate code path.
- [ ] Two tenants bootstrapped back to back share no rows (isolation test).

### E1.4 Platform kernel

#### M1-PLAT-01 - NestJS 12 + Fastify 5 application skeleton
Size: L - Owner: Claude - Deps: M1-REPO-01
Status: done - NestJS 12 on Fastify 5, ESM, zod-validated config.
- [ ] ESM-first NestJS 12 on Fastify 5 with a typed config module (env validated with zod, fails fast), graceful shutdown, `APP_ROLE` bootstrap for `api`, `worker`, `scheduler`, `migrate`.
- [ ] Module layout from architecture 4 (`registry`, `identity-access`, `tenancy`, `audit`, `events`, `jobs`, `files`, `notifications`, `control-plane`, ...) with public facades only.
- [ ] Boundary lint (dependency-cruiser or ESLint boundaries; tool chosen in an ADR): a module importing another module's internals fails CI; platform kernel never imports domain modules.
- [ ] `GET /healthz` (liveness) and `GET /readyz` (DB reachable, migrations current) work for the `api` role.

#### M1-PLAT-02 - API conventions
Size: L - Owner: Claude - Deps: M1-PLAT-01, M1-TEN-02
Status: done - problem+json, request id, zod pipe, cursor pagination, ETag/If-Match, Idempotency-Key, bulk convention (ADR 0003).
Pulled forward from M5 because M2 check-out and the M3 retry queue depend on them.
- [ ] `/v1` prefix; errors as RFC 9457 `application/problem+json` with stable `type` codes; request id echoed as `X-Request-Id`.
- [ ] Cursor pagination, filter/sort/field-selection query conventions, a shared list helper used by every list endpoint.
- [ ] `ETag` on resources and `If-Match` on updates (412 on mismatch); tested on assets.
- [ ] `Idempotency-Key` on POST: key and response hash stored in a tenant-scoped table inside the same transaction; replay returns the stored response; same key with different body returns 422; tested with concurrent duplicates.
- [ ] Bulk endpoint convention (up to N items, per-item results) documented and implemented once as a helper.

#### M1-PLAT-03 - OpenAPI 3.1 generation, typed client and API docs
Size: M - Owner: Claude - Deps: M1-PLAT-02
Status: partial - `docs/engineering/openapi.yaml` (generated by `docs/engineering/tools/gen.mjs`, Redocly-linted) is bundled and served at `GET /v1/openapi.json`; `packages/api-client` is generated from it and `generate:check` fails when stale; contract tests walk every route. Not derived from controllers and no static API reference artifact yet.
- [ ] The API build emits an OpenAPI 3.1 document from controllers and zod schemas (`packages/schemas`); required permission per operation appears in the document.
- [ ] `packages/api-client` is generated from the document; CI regenerates it and fails the PR if it differs from the committed client.
- [ ] A static API reference (for example Scalar or Redoc) is built from the document and published as a CI artifact.
- [ ] Web (and later mobile) call the API only through the generated client.

#### M1-PLAT-04 - Audit module
Size: L - Owner: Claude - Deps: M1-TEN-02, M1-TEN-01
Status: done - Audit module and append-only log.
- [ ] `AuditWriter.record(tx, ...)` writes actor (user, api_key, integration, system), action, entity type/id, before/after diff with sensitive fields redacted, IP, user agent, request id, in the same transaction as the change.
- [ ] `audit_log` is an append-only monthly partitioned table; `app` has INSERT and SELECT only (a test proves UPDATE and DELETE fail).
- [ ] `GET /v1/audit-events` with filters (entity, actor, date range) and cursor pagination, requiring `audit:read`.
- [ ] A lint/test fails when a state-changing controller action does not call the audit writer (checked through the route registry).
- [ ] A retention-purge role design is recorded in an ADR (the `app` role cannot delete); purge job itself is M6.

#### M1-PLAT-05 - Events and transactional outbox
Size: M - Owner: Claude - Deps: M1-TEN-02
Status: done - Transactional outbox and relay.
- [ ] `outbox_event` tenant table and `EventsFacade.publish(tx, event)`; events carry tenant id, entity ids, a version and the API representation reference.
- [ ] Outbox relay (worker role) claims rows per tenant under tenant context and dispatches to in-process subscribers; failed dispatch retries with backoff.
- [ ] A test proves a rolled-back transaction leaves no outbox row and a committed one is delivered exactly once to a test subscriber.

#### M1-PLAT-06 - Jobs module on pg-boss 12.x
Size: L - Owner: Claude - Deps: M1-TEN-02, M1-DB-01
Status: done - pg-boss 12 jobs module.
Implements the rules from architecture 5.2 and spike findings F5.
- [ ] pg-boss sits behind a queue adapter interface; runtime uses `createSchema: false, migrate: false, supervise: false, schedule: false`; schema creation and upgrades run in `migrate` over the direct connection as `migrator`; one maintenance instance runs as the owner.
- [ ] `useListenNotify` stays false and no queue is created with `notify: true`; workers poll every 1-2 s; a test or lint fails if `notify` is enabled.
- [ ] Runtime role has `USAGE` on schema `pgboss`, DML on tables/sequences and `EXECUTE` on functions, via `ALTER DEFAULT PRIVILEGES FOR ROLE migrator`; a post-upgrade test re-verifies grants.
- [ ] `enqueue(tx, name, {tenantId, ...ids})` uses `send(..., {db: {executeSql}})` inside the tenant transaction (committed together or not at all); handlers run only inside `withTenantTx` and the wrapper refuses to run a handler without tenant context.
- [ ] Payload lint: job payloads may contain ids only (no free-text fields); a failing fixture proves it.
- [ ] Dead-letter queue exists and is readable through an admin API.
- [ ] Spike scenario S3 is reproduced as an integration test: 100 jobs across two tenants through PgBouncer, zero RLS violations.

#### M1-PLAT-07 - Worker and scheduler role skeletons
Size: M - Owner: Claude - Deps: M1-PLAT-06
Status: done - Worker and scheduler roles with ops server.
- [ ] `worker` registers handlers and exposes a heartbeat health file/endpoint; per-tenant concurrency limit and priority classes (interactive > scheduled > bulk) configurable.
- [ ] `scheduler` registers singleton-keyed cron producers that enumerate tenants from the control plane and enqueue one job per tenant; running two schedulers does not duplicate jobs (test).
- [ ] First real jobs: partition rotation (M1-TEN-06) and a no-op `tenant.heartbeat` used by tests.

#### M1-PLAT-08 - Crypto module (KeyProvider, envelope encryption)
Size: M - Owner: Claude - Deps: M1-PLAT-01
Status: done - SecretBox envelope encryption with a file-based master key.
Needed in M1 because TOTP secrets are encrypted at rest; reused by webhooks and importers later.
- [ ] `KeyProvider.wrap/unwrap` with a file/env master-key implementation (the Self-hosted default) and an interface ready for AWS KMS (M6).
- [ ] AES-256-GCM envelope helper binds an encryption context of `tenant_id` + `purpose`; ciphertext copied to another tenant or purpose fails to decrypt (test); key version stored for rotation; rotation re-wraps data keys without re-encrypting payloads.
- [ ] `SecretsProvider.get` reads env/Docker-secret files; no secret is ever logged (log-redaction test).

#### M1-PLAT-09 - Mail adapter and templates
Size: M - Owner: Claude - Deps: M1-PLAT-06
Status: done - Mail adapter, templates and the `mail.send` job; Mailpit in dev and CI.
- [ ] `MailAdapter` with an SMTP implementation (Mailpit in dev); sending happens via a worker job, never inline in a request.
- [ ] Localised template mechanism (English catalogue only) for invitation and password reset emails; plain-text and HTML parts.
- [ ] Dev e2e test reads the message from the Mailpit API.

### E1.5 Identity and access

#### M1-AUTH-01 - RBAC model and policy layer
Size: L - Owner: Claude - Deps: M1-TEN-01, M1-PLAT-01
Status: done - Roles, permissions and the policy layer; role x operation matrix test.
- [ ] Tables `user_account`, `role`, `role_assignment` (scope columns `scope_type` tenant|company|location, `scope_id` nullable; only tenant scope enforced in M1, location scope lands in M2-LOC-03).
- [ ] Permission catalogue as `resource:action` strings; built-in roles Owner, Admin, Asset Manager, Technician/Auditor, Viewer/Employee seeded per tenant with documented permission bundles.
- [ ] `PolicyService.can(principal, permission, resource)` is the only authorisation entry point; controllers declare required permissions in a decorator that also feeds OpenAPI.
- [ ] Auto-generated role x endpoint matrix test fails if a route has no declared permission.

#### M1-AUTH-02 - Email and password authentication
Size: M - Owner: Claude - Deps: M1-AUTH-01, M1-TEN-08
Status: done - Argon2id passwords, breached-password check; throttling and lockout are stored in Postgres, not Redis.
- [ ] argon2id password hashing with documented parameters; login endpoint with constant-time failure behaviour for unknown accounts.
- [ ] Breached-password check through a pluggable provider: a bundled local list (works offline, needed by Self-hosted) and an optional online k-anonymity provider.
- [ ] Throttling and lockout per account and per IP using Redis; failures logged to the security log (M1-TEN-08).
- [ ] Password policy (minimum length, no composition rules) documented; tests cover timing parity for unknown vs known email.

#### M1-AUTH-03 - Browser sessions
Size: L - Owner: Claude - Deps: M1-AUTH-02
Status: done - Cookie sessions with idle/absolute timeouts, CSRF token, rotation on MFA.
- [ ] Server-side sessions in the `identity` schema, token stored hashed; cookie `__Host-` prefixed, `HttpOnly`, `Secure`, `SameSite`; idle and absolute timeouts configurable.
- [ ] CSRF protection on every cookie-authenticated mutation (test: mutation without token rejected).
- [ ] Device list endpoint with last-seen, IP, user agent; user and admin can revoke a session; revoked sessions fail on the next request.
- [ ] Session fixation test: session id changes on login and on privilege change.

#### M1-AUTH-04 - MFA (TOTP)
Size: M - Owner: Claude - Deps: M1-AUTH-03, M1-PLAT-08
Status: done - TOTP with replay protection and recovery codes; demo Owner is MFA-enrolled.
Interprets "MFA-ready" as TOTP fully working plus enforcement hooks; passkeys are out of M1 (Should, later).
- [ ] Enrolment returns a provisioning URI/QR; secret stored envelope-encrypted; verify-then-activate flow; 10 single-use recovery codes stored hashed.
- [ ] Login with MFA enabled requires a valid TOTP or recovery code; replay of the same code within its window is rejected; attempts are throttled.
- [ ] Tenant setting `mfa_required` (Owner/Admin roles at minimum) blocks access to non-MFA endpoints until enrolment; disable/reset flow requires re-authentication.
- [ ] Seed users include one MFA-enrolled Owner for demos.

#### M1-AUTH-05 - Invitations and password reset
Size: M - Owner: Claude - Deps: M1-AUTH-02, M1-PLAT-09
Status: done - Invitations and password reset by mail.
- [ ] Admin creates an invitation (email, role); token stored hashed with expiry; accepting sets the password and (if required) forces MFA enrolment.
- [ ] Password reset request never reveals whether an email exists; reset invalidates all sessions; tokens are single-use.
- [ ] Re-sending and revoking invitations works; expired tokens give a clear error.

#### M1-AUTH-06 - Tenant resolution middleware
Size: M - Owner: Claude - Deps: M1-AUTH-03, M1-TEN-07
Status: done - Tenant derived from the credential only.
- [ ] Tenant comes only from the authenticated principal (never a client header/body); the request pipeline is: rate limit, authn lookup in `identity`, tenant active/cell check, authorise, then `withTenantTx`.
- [ ] If a hostname hint is present and disagrees with the principal's tenant the request is rejected.
- [ ] Test: a request carrying tenant B's id in header, query and body while authenticated as tenant A still operates only on tenant A.

#### M1-AUTH-07 - User management API
Size: M - Owner: Claude - Deps: M1-AUTH-05
Status: done - User management API.
- [ ] CRUD for login users (list, get, update name/role, deactivate/reactivate); the last Owner cannot be removed or demoted.
- [ ] Role changes and deactivation revoke the user's sessions; both are audited.
- [ ] Permissions enforced per role matrix (Admin cannot grant Owner).

#### M1-AUTH-08 - Auth security test suite
Size: M - Owner: Claude - Deps: M1-AUTH-04, M1-AUTH-06
Status: done - Auth security suite.
- [ ] Automated tests: brute force throttling, session fixation, CSRF, expired/revoked session, MFA bypass attempts (skipping the challenge endpoint), privilege escalation through role endpoints.
- [ ] OWASP ASVS L2 checklist file created with authentication/session items marked and linked to tests.
- [ ] Run as part of the integration job, not optional.

### E1.6 Registry domain

#### M1-REG-01 - Categories
Size: M - Owner: Claude - Deps: M1-TEN-01, M1-AUTH-01
Status: done - Categories (asset kinds, tag prefix).
- [ ] `category` tenant table with `kind` (asset now; accessory, consumable, component, license reserved), name unique per tenant, optional parent display grouping not required.
- [ ] CRUD API with permissions, audit, ETag; deleting a category in use is refused with a problem response listing counts.
- [ ] Isolation suite covers the new routes and table automatically.

#### M1-REG-02 - Manufacturers and models
Size: M - Owner: Claude - Deps: M1-REG-01
Status: done - Manufacturers and models.
- [ ] `manufacturer` and `asset_model` tables (model: manufacturer, default category, model number, default depreciation months, default EOL date, image reference nullable until M2).
- [ ] CRUD API; composite foreign keys; uniqueness per tenant (manufacturer name, model number within manufacturer).
- [ ] Models can be filtered by category/manufacturer and text-searched.

#### M1-REG-03 - Status labels with fixed state types
Size: M - Owner: Both - Deps: M1-REG-01, S0-DATA-01
Status: done - Status labels with fixed state types; `StatusLabel.color` is still stored and returned.
Configurable names mapped to fixed state types (plan 5.3).
- [ ] State types are fixed in code: ready, assigned, pending, in_repair, archived (retired/disposed), lost (final set confirmed in S0-DATA-01; the plan lists two slightly different sets).
- [ ] Tenant admins create/rename/reorder/colour labels, each mapped to exactly one state type; a default label per state type is seeded and cannot be deleted; labels in use cannot be deleted.
- [ ] Business rules reference the state type, never the label name (unit test).

#### M1-REG-04 - Custom field definitions and validation
Size: L - Owner: Claude - Deps: M1-REG-01
Status: done - Custom field definitions and validation.
- [ ] `custom_field_definition` per category with types text, number, date, select, multi-select, checkbox, URL; required flag, default, options, help text, display order, filterable flag.
- [ ] Values live in `asset.custom_data` JSONB, validated server-side from the definitions (type coercion, unknown keys rejected, select values checked); a GIN index supports filtering.
- [ ] Changing a field type is refused when values exist; deleting a field archives it and keeps stored values readable in history.
- [ ] Definitions and values appear in the OpenAPI schema for the asset resource as an open-but-typed object.

#### M1-REG-05 - Assets: create, read, update
Size: L - Owner: Claude - Deps: M1-REG-02, M1-REG-03, M1-REG-04, M1-PLAT-02, M1-PLAT-04
Status: done - Assets create/read/update with ETag, audit and outbox in one transaction.
- [ ] `asset` tenant table: tag (unique per tenant), serial, name, model, category (via model or explicit), status label, purchase date, purchase cost (integer minor units + ISO currency), order number, warranty end, vendor (nullable), notes, `custom_data`, `parent_asset_id` (column only), `external_source`/`external_id`, `company_id`, `archived_at`.
- [ ] Create/update through `AssetsFacade` with ETag/If-Match, audit and `asset.created`/`asset.updated` outbox events in the same transaction.
- [ ] Duplicate tag in the same tenant returns 409 with a problem type; the same tag in another tenant is allowed (seed proves it).
- [ ] Validation errors list field-level problems including custom fields.

#### M1-REG-06 - Asset tag auto-numbering with templates
Size: M - Owner: Claude - Deps: M1-REG-05
Status: done - Per-tenant template via `GET/PUT /v1/settings/asset-tag-template`, counters per full prefix.
- [ ] Tenant setting for a template (prefix, zero-padded counter width, optional category prefix); counter stored in a per-tenant row locked per allocation, not a global Postgres sequence.
- [ ] 100 parallel creates in one tenant produce 100 distinct, gap-tolerant tags; two tenants allocate independently.
- [ ] Manual tag entry overrides the template; template changes never rewrite existing tags.

#### M1-REG-07 - Asset list, filters and performance budget
Size: L - Owner: Claude - Deps: M1-REG-05
Status: done - List p95 61 ms on 2 x 50,000 assets (budget 500 ms), measured with `scripts/ci/perf-check.mjs`.
- [ ] `GET /v1/assets` supports filters (status, state type, category, model, manufacturer, vendor, archived, text) plus custom-field filters through JSONB, sorting and cursor pagination.
- [ ] Indexes lead with `tenant_id`; query plans captured in a test fixture.
- [ ] On a seeded 50,000-asset tenant (with a second 50,000-asset tenant present), list p95 < 500 ms server side (plan P9) measured by the perf job (M1-CI-05).
- [ ] Results never include another tenant's rows (isolation test on the perf dataset).

#### M1-REG-08 - Search and exact tag/serial lookup
Size: M - Owner: Claude - Deps: M1-REG-05
Status: done - Search p95 89 ms (budget 200 ms), tag lookup p95 56 ms (budget 150 ms) on 2 x 50,000 assets.
- [ ] `tsvector` + `pg_trgm` indexes (tenant-scoped); `GET /v1/search?q=` returns assets now and is structured to add more entity types later.
- [ ] Exact-match fast path `GET /v1/assets?tag=` and `?serial=` (the scan/keyboard-wedge critical path) with p95 < 150 ms on the 50k dataset.
- [ ] Global search p95 < 200 ms on the 50k dataset; ranking puts exact tag/serial first.

#### M1-REG-09 - Clone and bulk operations
Size: M - Owner: Claude - Deps: M1-REG-05, M1-PLAT-02
Status: done - `POST /v1/assets/{id}/clone` and `bulk-update|bulk-archive|bulk-restore` (100 ids, per-item results); the web uses the bulk endpoints.
- [ ] Clone creates N copies from a source asset with fresh tags (template) and cleared serials; choose which fields to copy.
- [ ] Bulk update (status, category, model, custom fields) and bulk archive on up to the documented N items per request with per-item results; one audit entry per asset plus a parent bulk-operation record.
- [ ] A failure in one item does not roll back the others and is reported in the response; idempotent with `Idempotency-Key`.

#### M1-REG-10 - Archive and restore
Size: S - Owner: Claude - Deps: M1-REG-05
Status: done - Archive and restore, single and bulk.
- [ ] Soft delete via `archived_at`; archived assets are hidden by default, retrievable with a filter, and restorable.
- [ ] Hard delete does not exist for users; archive/restore are audited and emit events.
- [ ] Archived assets are excluded from "active asset" counts (needed for billing and Free-tier limits later).

#### M1-REG-11 - Vendors (simple)
Size: S - Owner: Claude - Deps: M1-TEN-01
Status: done - Vendors.
- [ ] `vendor` tenant table (name, contact name/email/phone, URL, notes) with CRUD API; assets reference vendors through a composite FK.
- [ ] Deleting a vendor in use is refused with counts.

### E1.7 Web admin

#### M1-WEB-10 - Static-export spike and CI feature check (do first)
Size: M - Owner: Claude - Deps: M1-REPO-01
Status: done - ADR 0002 and the forbidden-feature check.
Week-1 spike required by architecture section 3.
- [ ] A minimal Next.js 16 `output: 'export'` app proves deep links, hard refresh, back/forward and QR-style deep links (`/s/<code>`) using query-string detail routes (for example `/assets/view?id=`) and SPA fallback; Playwright tests keep these cases forever.
- [ ] A CI check fails the web build if `proxy.ts`/middleware, `rewrites`, `redirects`, `headers`, Server Actions, cookies APIs or the default image loader appear.
- [ ] Decision recorded as an ADR: query-string routes vs single optional catch-all page; the choice is applied by M1-WEB-01.
- [ ] Notes on how Caddy (M4) and CloudFront (M6) must provide the SPA fallback and security headers.

#### M1-WEB-01 - Web app shell, routing, API client, i18n
Size: L - Owner: Claude - Deps: M1-WEB-10, M1-PLAT-03
Status: done - Static-export shell, generated typed client, i18n; the legacy zod client is gone.
- [ ] Next.js 16 App Router static export; client-side data layer over the generated `api-client` with typed errors, optimistic concurrency (ETag) handling and request-id display in error toasts.
- [ ] i18n framework wired with an English catalogue only; locale, timezone and currency formatting helpers; no hard-coded user-facing strings (lint rule).
- [ ] Auth guard and session bootstrap (`/me`), idle-timeout handling, tenant name/branding header.
- [ ] No API base URL baked into the bundle (same-origin `/v1`).

#### M1-WEB-02 - Design system components
Size: L - Owner: Both - Deps: S0-DES-01, M1-REPO-01
Status: done - Design-system components; founder acceptance is M1-UX-01.
Implements the Sprint 0 design system from `packages/ui-tokens`.
- [ ] Tokens (colour, spacing, type, radius, elevation) compiled to CSS variables with light/dark themes; components: button, input, select/combobox, checkbox, date input, table, tabs, dialog, drawer, toast, badge, empty state, form layout, skeleton.
- [ ] Every component is keyboard-operable and passes automated axe checks (WCAG 2.2 AA target); focus management is tested for dialogs.
- [ ] Storybook (or equivalent) catalogue builds in CI.
- [ ] Layouts verified at 375, 768 and 1440 px (responsive requirement).
- [ ] Founder accepts the look and feel in M1-UX-01.

#### M1-WEB-03 - Authentication screens
Size: M - Owner: Both - Deps: M1-WEB-01, M1-AUTH-05
Status: done - Login, MFA, invitation accept, password reset, enrolment.
- [ ] Login, MFA challenge (TOTP and recovery code), accept invitation, forgot/reset password, MFA enrolment with QR, session/device list with revoke.
- [ ] Error states do not reveal whether an account exists; lockout and throttle messages are clear.
- [ ] Playwright covers login to logout including MFA.

#### M1-WEB-04 - Navigation shell and command palette
Size: M - Owner: Both - Deps: M1-WEB-02, M1-REG-08
Status: done - Navigation shell and command palette with live search.
- [ ] Role-aware navigation and empty states; user menu; responsive collapse.
- [ ] Command palette (Ctrl/Cmd+K): navigate to screens, search assets by tag/serial/name, run "new asset"; palette results come from `/v1/search`.
- [ ] Keyboard-first: documented shortcuts, no keyboard traps.

#### M1-WEB-05 - Category and custom-field admin
Size: L - Owner: Both - Deps: M1-REG-04, M1-WEB-02
Status: done - Categories and custom-field builder.
- [ ] Categories list/create/edit; field builder supports all types, ordering by drag or buttons, options editor, required/filterable flags, with a live preview of the form.
- [ ] Destructive actions explain impact (counts of assets affected).
- [ ] Playwright creates a category with one field of each type.

#### M1-WEB-06 - Models, status labels, tag numbering and vendors screens
Size: M - Owner: Both - Deps: M1-REG-02, M1-REG-03, M1-REG-06, M1-REG-11, M1-WEB-02
Status: done - Models, status labels, vendors, tag numbering (template + category prefix).
- [ ] CRUD screens for manufacturers, models, status labels (state type picker), tag template with live example, vendors.
- [ ] Inline validation matches API problem responses.

#### M1-WEB-07 - Assets list screen
Size: L - Owner: Both - Deps: M1-REG-07, M1-WEB-02
Status: done - Assets list with filters, saved views, columns, bulk actions.
- [ ] Virtualised table with column chooser, filters including custom fields, sort, cursor pagination and row selection with bulk actions (edit, archive).
- [ ] Remains responsive with the 50k dataset (first meaningful paint under 1 s on the founder's machine, manual measurement recorded).
- [ ] Keyboard navigation of rows and a "copy tag" affordance.

#### M1-WEB-08 - Asset detail, create and edit
Size: L - Owner: Both - Deps: M1-REG-05, M1-REG-09, M1-WEB-07
Status: partial - Detail, create, edit (412 handling) and clone work; the history tab and the location pickers are empty on the M1 API (their endpoints are M2) and fill in once those exist.
- [ ] Detail page on a query-string route (`/assets/view?id=`) with sections for core fields, purchase info, custom fields and a placeholder "history" tab (filled in M2).
- [ ] Create/edit forms render custom fields dynamically, handle ETag conflicts (412) with a merge prompt, and support clone and archive/restore.
- [ ] Usable at 375 px width.

#### M1-WEB-09 - Users, roles and invitations screens
Size: M - Owner: Both - Deps: M1-AUTH-07, M1-WEB-02
Status: done - Users, roles, invitations.
- [ ] User list, invite dialog, role change, deactivate; pending invitations list with resend/revoke; MFA-required setting.
- [ ] Controls hidden/disabled per permission and enforced server side.

#### M1-WEB-11 - End-to-end smoke suite
Size: M - Owner: Claude - Deps: M1-WEB-03, M1-WEB-08, M1-CI-04
Status: done - Playwright project `real` (`apps/web/e2e-real`) against the compose stack; CI job `web-e2e-real`. Includes model creation, bulk edit, the second tenant getting 404, the invitation mail in Mailpit.
- [ ] Playwright against the Compose stack: login, create category + field, create model, create asset, search by tag, bulk edit, archive, logout; second tenant cannot reach the first tenant's asset URL.
- [ ] Runs in CI on every PR to `main` with traces and screenshots on failure.

### E1.8 CI quality gates

#### M1-CI-01 - PR pipeline (lint, typecheck, unit)
Size: M - Owner: Claude - Deps: M1-REPO-01
Status: done - PR pipeline with Turborepo cache and the CI gate; verified locally, branch protection is the founder's (F-01) and the first hosted run is pending.
- [ ] GitHub Actions workflow runs lint, typecheck, boundary lint and unit tests with Turborepo caching; required status checks configured on `main` (branch protection set by the founder, F-01).
- [ ] Total PR pipeline time reported; target under 15 minutes.

#### M1-CI-02 - Integration job with PostgreSQL matrix
Size: M - Owner: Claude - Deps: M1-CI-01, M1-TEN-04
Status: done - Postgres 16/18 matrix, direct and pooled, no skipped tests; verified locally, first hosted run pending.
- [ ] Matrix of `postgres:16` and `postgres:18` service containers; migrations applied as `migrator`, tests run as `app`; schema lint and isolation suite included.
- [ ] A second pass runs the suite through PgBouncer 1.26.1+ (M1-TEN-05).

#### M1-CI-03 - Security scanning
Size: M - Owner: Claude - Deps: M1-CI-01, M1-REPO-04
Status: done - CodeQL, dependency audit with an expiring allow-list, gitleaks, Trivy (0 exceptions) and a CycloneDX SBOM; verified locally.
- [ ] SAST (CodeQL or Semgrep), SCA (osv-scanner or `pnpm audit` with allow-list), secret scanning (gitleaks) on every PR.
- [ ] Trivy scans the runtime image and fails on fixable critical/high; SBOM generated (syft) and stored as an artifact.
- [ ] Exceptions require an expiring entry in a reviewed allow-list file.

#### M1-CI-04 - Image build and Compose smoke test
Size: M - Owner: Claude - Deps: M1-REPO-02, M1-CI-01
Status: done - Image built once and reused by smoke, real-stack e2e, scan and GHCR push; the smoke makes an authenticated call.
- [ ] On merge to `main`, build the backend runtime image, tag with the git SHA, push to GHCR (dev registry); build the static web export as an artifact.
- [ ] A job brings up the Compose stack in CI and hits `/readyz` plus one authenticated API call.

#### M1-CI-05 - Performance budget job
Size: M - Owner: Claude - Deps: M1-REG-07, M1-REG-08
Status: done - `scripts/ci/perf-seed.sh` seeds 2 x 50,000; registry budgets are enforced; first nightly run pending.
- [ ] Nightly job seeds 2 x 50,000 assets and measures asset list p95, search p95, tag lookup p95 with k6 or autocannon; fails on budget breach (list < 500 ms, search < 200 ms, tag lookup < 150 ms).
- [ ] Results trend is stored as a CI artifact/summary.

### E1.9 Observability, docs and acceptance

#### M1-OPS-01 - Logging, metrics, tracing and health basics
Size: M - Owner: Claude - Deps: M1-PLAT-01, M1-AUTH-06
Status: done - pino with redaction, metrics on an internal port, health and readiness probes.
- [ ] Structured JSON logs (pino) with `request_id`, `tenant_id`, `actor_id`; a redaction test proves passwords, tokens and keys never appear.
- [ ] OpenTelemetry tracing with `tenant_id` as a span/log attribute and not a metric label; Prometheus `/metrics` (RED metrics per route, DB pool, queue depth) on an internal port.
- [ ] Optional Sentry via env var; errors carry request id.

#### M1-DOC-01 - ADRs, developer guide and tenancy threat model
Size: M - Owner: Claude - Deps: M1-TEN-05
Status: done - ADR index (0001-0005), developer guide, tenancy threat model.
- [ ] `docs/adr/` with ADRs for data access layer, migration tool, boundary-lint tool, web routing, ID strategy, state types, breached-password provider.
- [ ] Developer guide (setup, `make test-isolation`, how to add a tenant table and a route, expand/contract rules) and a repo-level agent guide for Claude's workflow and sub-agent conventions.
- [ ] Short tenancy threat model recording known exposures: `pgboss.*` has no RLS (ids-only payloads), `identity` and control-plane tables are non-RLS, superuser/BYPASSRLS ignores FORCE, partition rule, restore granularity.

#### M1-UX-01 - M1 founder acceptance walk-through
Size: S - Owner: Founder - Deps: all M1 stories
Status: todo - Founder walk-through; `docker compose up` then sign in as `owner@acme.example` (README quick start).
- [ ] Founder completes the exit-criteria script from a clean clone and records findings as new stories or defects.
- [ ] Look and feel (design system) and screen flows accepted or change requests logged.
- [ ] Founder confirms the isolation demo: a second-tenant user cannot reach the first tenant's data through UI and API.

---

## 3. Milestone M2 - Custody, labels and import

**Goal.** Make the registry useful on a real desk: know where every asset is and who has it, print labels, and get an existing spreadsheet (including a Google Admin ChromeOS export) in with a safe dry run. Add the K-12 workflows (loaner pool, repair log, accessories/consumables) that decision 1 made Musts.

**Exit criteria (demoable outcome).** Using only the web app on the Compose stack, the founder: (1) imports a real spreadsheet and a real Google Admin ChromeOS CSV (founder-supplied, F-09) through the wizard, reviews the dry-run preview and error report, then commits; (2) builds a location tree (site > building > room) and moves assets between locations; (3) checks a laptop out to a person, transfers it, checks it in with a photo, and sees the full chain-of-custody timeline; (4) generates a PDF label sheet with QR and Code128 labels, prints it on the real label stock (F-02), and resolves a printed label with a USB keyboard-wedge scanner and with a phone camera (opens the web scan landing page); (5) runs a loaner day: quick check-out of five loaner Chromebooks with default due dates, one goes overdue and triggers an email/in-app alert, bulk check-in; (6) opens a repair record with cost and attachment, which sets the asset to "in repair", and closes it; (7) checks out accessories and consumes consumables, with a low-stock alert; and (8) the isolation suite (direct and pooled) still passes with every new table and route covered.

**Out of scope for M2:** mobile app, stocktake, licenses, reports/dashboard, webhooks, API keys, Snipe-IT importer, import undo (v1.1, but before-images are recorded), label template editor (v1.1; fixed templates only).

**Epics**

| Epic | Area | Stories |
|---|---|---|
| E2.1 Locations and people | LOC, USR | 6 |
| E2.2 Lifecycle: check-out, check-in, transfer, history | LIFE | 8 |
| E2.3 Files and attachments | FILE | 4 |
| E2.4 Accessories and consumables | ACC | 4 |
| E2.5 Loaner pool | LOAN | 4 |
| E2.6 Repair log | MNT | 2 |
| E2.7 Codes and labels | TAG | 4 |
| E2.8 CSV import with dry run | IMP | 9 |
| E2.9 Notifications and saved views | NOT, REG | 4 |
| E2.10 Quality, docs, acceptance | SEC, OPS, DOC, UX | 5 |

**Suggested build order.** LOC-01/02, USR-01, LIFE-01..03 and FILE-01 first (everything else depends on custody and files); then TAG, ACC, MNT, NOT-01 in parallel; IMP-01..05 in parallel with the UI work; LOAN after NOT-01; LOC-03 (scoping) last because it touches every query path.

### E2.1 Locations and people

#### M2-LOC-01 - Location hierarchy
Size: L - Owner: Claude - Deps: M1-TEN-01, M1-REG-05
- [ ] `location` tenant table with parent, type (site, building, floor, room, other), address/notes, optional geo; unique name per parent; a subtree path encoding chosen by ADR (materialized path or `ltree`) with an index that supports "all descendants" queries.
- [ ] Cycle creation and reparenting under a descendant are rejected; reparenting updates descendant paths in one transaction; depth limit documented.
- [ ] CRUD API with `asset_count` per node (including descendants), audit and events.
- [ ] Deleting a location with assets or children is refused with counts.

#### M2-LOC-02 - Asset location and moves
Size: M - Owner: Claude - Deps: M2-LOC-01
- [ ] Expand migration adds nullable `asset.location_id` (composite FK) using the expand/contract pattern; `asset_model` and category gain an optional default location.
- [ ] `POST /v1/assets/{id}/move` changes location with a note, writing a history event, audit and outbox event; bulk move through the bulk helper.
- [ ] List and search filters include location with "include sublocations".

#### M2-LOC-03 - Location scoping for roles (Should)
Size: L - Owner: Claude - Deps: M2-LOC-01, M1-AUTH-01
- [ ] Role assignments with `scope_type=location` restrict a principal to a location subtree; `TenantRepository` adds the subtree predicate to every asset-related query for scoped principals.
- [ ] Out-of-scope resources return 404 (not 403), including scan resolve and check-out targets.
- [ ] Added to the route-replay harness with a scoped-user fixture; RLS stays tenant-only (scoping is an additional app-layer filter).
- [ ] A scoped Technician can check out only inside their subtree (test).

#### M2-LOC-04 - Locations admin UI
Size: M - Owner: Both - Deps: M2-LOC-01, M1-WEB-02
- [ ] Tree view with expand/collapse, create/edit/move (drag or picker), per-node asset count and click-through to a filtered asset list.
- [ ] Keyboard accessible; usable at 375 px.

#### M2-USR-01 - People (assignable users)
Size: M - Owner: Claude - Deps: M1-AUTH-01, M2-LOC-01
Assignable-only people share the user model with login users (decision to be recorded in the data model doc).
- [ ] `user_account` supports records without credentials ("person"): name, email, employee id, department (text field), job title, home location, manager (optional), status active/inactive; a person can be linked to a login account later.
- [ ] CRUD API with unique email and employee id per tenant; deactivating a person with assets checked out is refused unless forced with a reason.
- [ ] Persons never receive login emails; audit and events emitted.

#### M2-USR-02 - People UI
Size: M - Owner: Both - Deps: M2-USR-01, M1-WEB-02
- [ ] People list/detail with "assets currently held" and a history tab; create/edit; link-to-login action for Admins.
- [ ] Person picker component (type-ahead, used by check-out dialogs) with keyboard selection.

### E2.2 Lifecycle: check-out, check-in, transfer, history

#### M2-LIFE-01 - Assignment model
Size: M - Owner: Claude - Deps: M2-USR-01, M2-LOC-01
- [ ] `assignment` tenant table with exactly one target (`user_id` xor `location_id` xor `parent_asset_id`, enforced by a check constraint), `expected_return_at`, checked-out/in timestamps and actors, notes, quantity (for accessories), acceptance state placeholder.
- [ ] Partial unique index guarantees at most one open assignment per individual asset.
- [ ] Composite foreign keys; schema lint and isolation suite pass without exceptions.

#### M2-LIFE-02 - Check-out API
Size: L - Owner: Claude - Deps: M2-LIFE-01, M1-PLAT-02
- [ ] `POST /v1/assets/{id}/checkout` with `Idempotency-Key` and `If-Match`; verifies the asset's state type allows check-out (ready only), locks the row (`SELECT ... FOR UPDATE`), inserts the assignment, moves status to an "assigned" label, writes audit and `asset.checked_out`.
- [ ] 50 concurrent check-outs of the same asset yield exactly one 201 and 49 clean 409 responses (test).
- [ ] Replaying a request with the same `Idempotency-Key` returns the original response and creates no second assignment.
- [ ] Server-side p95 < 300 ms on the 50k dataset (perf job).

#### M2-LIFE-03 - Check-in API
Size: M - Owner: Claude - Deps: M2-LIFE-02, M2-FILE-01
- [ ] `POST /v1/assets/{id}/checkin` with target status label, optional location, condition notes and attachment ids (photo); closes the open assignment; audit and `asset.checked_in`.
- [ ] Check-in of an asset with no open assignment returns a clear 409; idempotent replay works.
- [ ] Overdue state is derived from `expected_return_at` and exposed as a computed field and filter.

#### M2-LIFE-04 - Transfer
Size: M - Owner: Claude - Deps: M2-LIFE-02, M2-LIFE-03
- [ ] `POST /v1/assets/{id}/transfer` performs check-in and check-out in a single transaction (user to user, user to location, location to user) with one audit entry and one history event "transferred".
- [ ] A failure in either half rolls back both (test); the asset is never left unassigned.

#### M2-LIFE-05 - Retirement, disposal, lost and found
Size: S - Owner: Claude - Deps: M2-LIFE-03
- [ ] Disposal action sets an archived-type status with reason (enum + free text) and date; disposed assets are excluded from active counts and hidden from default lists.
- [ ] Mark lost / mark found actions with notes; lost assets cannot be checked out; found returns them to a chosen ready status.
- [ ] All transitions covered by a state-machine test table (which state types allow which actions).

#### M2-LIFE-06 - Chain-of-custody history
Size: M - Owner: Claude - Deps: M2-LIFE-04
- [ ] `GET /v1/assets/{id}/history` returns a unified, cursor-paginated timeline derived from assignments, moves, status changes, repairs and attachments, with actor and note; also available per person.
- [ ] Timeline entries are reproducible from audit/events (a test rebuilds the timeline from audit rows and compares).
- [ ] Respects location scoping (M2-LOC-03) when enabled.

#### M2-LIFE-07 - Check-out/in/transfer UI
Size: L - Owner: Both - Deps: M2-LIFE-04, M2-USR-02, M2-FILE-04
- [ ] Actions on asset detail and from list selection (bulk check-out to one person); dialogs for assignee, expected return (with tenant default), notes, photo on check-in.
- [ ] Optimistic-concurrency conflicts (409/412) show a clear refresh path.
- [ ] History tab on the asset detail page and on person pages; flows work at 375 px.

#### M2-LIFE-08 - Keyboard-wedge scanner and manual tag entry
Size: M - Owner: Both - Deps: M2-TAG-01, M1-WEB-04
- [ ] A global "Scan or type tag" input (focus shortcut) accepts Enter-terminated input from USB/Bluetooth keyboard-wedge scanners, resolves tag, serial or scan-URL via `scan/resolve`, and opens the asset or offers check-out/in.
- [ ] A "batch mode" keeps focus for repeated scans (check-in many, check-out many to one person).
- [ ] Founder tests with the real USB scanner (F-02) and accepts speed and error feedback.

### E2.3 Files and attachments

#### M2-FILE-01 - Storage adapter and attachments
Size: L - Owner: Claude - Deps: M1-PLAT-06, M1-PLAT-08
- [ ] `StorageAdapter` interface with S3-compatible (MinIO in dev) and local-filesystem implementations (both required; the latter is the Self-hosted fallback).
- [ ] Presigned PUT with size and content-type conditions; keys `t/<tenant_id>/<yyyy>/<uuid>`; `attachment` tenant table (polymorphic target, mime, size, checksum, `scan_status`); presigned GET only when `scan_status = clean` and short-lived.
- [ ] Type allow-list (images, PDF, office formats, CSV) and size caps configurable per tenant tier.
- [ ] Isolation test: tenant A cannot presign or fetch tenant B's attachment ids or keys.

#### M2-FILE-02 - Virus scanning
Size: M - Owner: Claude - Deps: M2-FILE-01
- [ ] Worker job streams new objects to ClamAV (`clamd` INSTREAM); `clean` flips status and enqueues thumbnailing; `infected` deletes the object, audits and notifies the uploader.
- [ ] Scheduler sweep handles uploads whose completion call never arrived; scan status is visible in the API.
- [ ] `scan` Compose profile runs ClamAV; with the profile off, behaviour is configurable (`SCAN_REQUIRED=false` marks clean with a warning event) and documented.
- [ ] Test uses the EICAR test string.

#### M2-FILE-03 - Thumbnails, model images and EXIF handling
Size: M - Owner: Claude - Deps: M2-FILE-02
- [ ] Server-side thumbnail generation (sharp) in the worker, re-encoding images (neutralises payloads); optional per-tenant EXIF stripping.
- [ ] Model image and asset photo fields on `asset_model` and `asset` (primary image) wired to attachments.
- [ ] Non-image downloads are served with `Content-Disposition: attachment`; a cookie-less file host setting is supported.

#### M2-FILE-04 - Attachments UI component
Size: M - Owner: Both - Deps: M2-FILE-03, M1-WEB-02
- [ ] Reusable upload/list/preview component (drag-drop, progress, scan-pending state, delete with confirmation) used on asset, repair and check-in dialogs.
- [ ] Rejected types/sizes show the server's problem message.

### E2.4 Accessories and consumables

#### M2-ACC-01 - Accessories
Size: L - Owner: Claude - Deps: M2-LIFE-01, M1-REG-01
- [ ] `accessory` table (category kind=accessory, total quantity, minimum quantity, location, purchase info); checkout/checkin of N units to a person, location or asset using `assignment.quantity`; remaining quantity derived transactionally.
- [ ] Over-checkout is refused (409); concurrent checkouts never exceed stock (test).
- [ ] Audit and events; list API shows total, checked out, available.

#### M2-ACC-02 - Consumables
Size: L - Owner: Claude - Deps: M1-REG-01, M2-LOC-01
- [ ] `consumable` and append-only `stock_movement` ledger (receive, consume, adjust) with actor, note, optional assignee; on-hand quantity derived from the ledger and protected by a non-negative CHECK.
- [ ] Minimum-stock threshold per consumable; consume log queryable per consumable and per person.
- [ ] Concurrent consumes cannot drive stock negative (test).

#### M2-ACC-03 - Minimum-stock alerts
Size: S - Owner: Claude - Deps: M2-ACC-02, M2-NOT-01
- [ ] Crossing below minimum emits `stock.low` once per crossing (not per movement); the notification goes to subscribed roles in-app and by email, and is folded into the daily digest.

#### M2-ACC-04 - Accessories and consumables UI
Size: L - Owner: Both - Deps: M2-ACC-01, M2-ACC-02, M2-USR-02
- [ ] List/detail/create/edit for both; quantity-aware checkout/checkin and consume/receive/adjust dialogs; movement history.
- [ ] Low-stock indicators and filter; usable at 375 px.

### E2.5 Loaner pool

Modelled with the existing asset and assignment tables; no new entity (plan 5.3).

#### M2-LOAN-01 - Loaner pool model and defaults
Size: M - Owner: Both - Deps: M2-LIFE-02
- [ ] An asset can belong to the loaner pool (flag or pool membership defined by ADR; filterable and bulk-assignable); tenant settings: default loan length, maximum loan length, reminder lead time.
- [ ] Loaner check-out applies the default due date automatically; extending a loan is a logged action.
- [ ] Founder confirms the K-12 workflow vocabulary (borrower, homeroom, device number) so UI labels match.

#### M2-LOAN-02 - Quick loaner flows (web)
Size: M - Owner: Both - Deps: M2-LOAN-01, M2-LIFE-08
- [ ] Quick check-out screen: scan/type person, scan device(s), confirm; due date defaults; multiple devices per borrower supported.
- [ ] Bulk check-in screen: scan many devices in a row with per-scan success/failure feedback and a summary.
- [ ] Covered by a Playwright script that checks 10 devices out and in.

#### M2-LOAN-03 - Overdue alerts
Size: M - Owner: Claude - Deps: M2-LOAN-01, M2-NOT-01, M1-PLAT-07
- [ ] Scheduler job (per tenant, daily, singleton-keyed) detects overdue loans and emits `loan.overdue` once per loan per day with escalating copy; due-soon reminder before expiry.
- [ ] Recipients configurable (borrower if they have an email, manager, pool owner); in-app plus email; opt-out per user preference.
- [ ] Test advances the clock and asserts exactly one notification per overdue loan per day.

#### M2-LOAN-04 - Loaner dashboard page
Size: S - Owner: Both - Deps: M2-LOAN-02
- [ ] Page showing pool size, available, out, overdue and due today, with click-through lists.

### E2.6 Repair log

#### M2-MNT-01 - Repair and maintenance records
Size: L - Owner: Claude - Deps: M1-REG-05, M2-FILE-01
- [ ] `maintenance_record` tenant table: asset, opened/closed dates, type (repair, maintenance, inspection note), description, cost (minor units + currency), vendor, status open/closed, attachments.
- [ ] Opening a repair optionally moves the asset to an in-repair status (and blocks check-out); closing restores a chosen status; both write history, audit and events.
- [ ] CRUD API and filters (open, by asset, by vendor, date range); total repair cost per asset exposed.
- [ ] A checked-out asset goes to repair through check-in first, or through an explicit "force with note" permission (documented).

#### M2-MNT-02 - Repair log UI
Size: M - Owner: Both - Deps: M2-MNT-01, M2-FILE-04
- [ ] Repair tab on the asset page; "open repairs" list screen; cost totals; attachment support.

### E2.7 Codes and labels

#### M2-TAG-01 - Public code and scan resolve
Size: M - Owner: Claude - Deps: M1-REG-05, M1-REG-08
- [ ] Each asset gets an opaque, non-guessable `public_code` (short, URL-safe, unique per tenant) generated at creation and backfilled for existing assets.
- [ ] Label QR encodes `<PUBLIC_URL>/s/<public_code>` (no internal ids); Code128 encodes the human tag; `GET /v1/scan/resolve?code=` resolves either form and returns the asset card with allowed actions for the caller.
- [ ] Web route `/s/<code>` (static export, client-side) sends logged-out users to login first and reveals nothing; after login it opens the asset.
- [ ] p95 < 150 ms on the 50k dataset; unknown or out-of-scope codes return 404.

#### M2-TAG-02 - Label rendering worker
Size: L - Owner: Claude - Deps: M2-TAG-01, M2-FILE-01
- [ ] Worker job renders QR and Code128 (bwip-js or equivalent) into PDF sheets with fixed templates (at least Avery 5160 Letter 30-up, A4 3x8, and a single-label 2x1 inch page for thermal/roll printers), with per-template offset calibration values.
- [ ] Label content: tag, asset name, organisation name, optional logo; text auto-shrinks to fit.
- [ ] A 500-label job completes under 30 s and is written as an attachment (tenant-scoped, short-lived download).
- [ ] The template editor is explicitly out (v1.1); templates are code/config constants with tests that snapshot-compare geometry.

#### M2-TAG-03 - Label generation UI
Size: M - Owner: Both - Deps: M2-TAG-02, M1-WEB-07
- [ ] Select assets in the list (or a saved filter), choose template and start position on a partly used sheet, generate; progress and download.
- [ ] Reprint history per asset (who printed when).

#### M2-TAG-04 - Print and scan calibration (founder)
Size: S - Owner: Founder - Deps: M2-TAG-03, F-02
- [ ] Founder prints each template on real label stock; geometry is within 1 mm of the die lines or calibration values are reported back to Claude.
- [ ] Printed labels scan with a USB scanner, an iPhone camera and an Android camera (QR opens `/s/<code>`; Code128 scans into the keyboard-wedge input).

### E2.8 CSV import with dry run

#### M2-IMP-01 - Import framework
Size: L - Owner: Claude - Deps: M2-FILE-01, M1-PLAT-06, M1-REG-05
- [ ] `import_job` and `import_row` tenant tables (state machine: uploaded, analyzed, mapped, dry_run_done, committing, completed, failed, cancelled); rows keep raw values, mapped values, outcome, error, created ids and before-image (recorded now so v1.1 undo needs no migration).
- [ ] Writes go only through registry/people/location facades so validation, audit and events are never bypassed; each commit batch audit entry carries the `import_job_id`.
- [ ] Per-tenant import quotas (rows, concurrent jobs) and the low-priority `bulk` queue class; status polling endpoint with counts.
- [ ] Jobs are resumable after a worker restart (test kills the worker mid-batch).

#### M2-IMP-02 - File parsing and analysis
Size: M - Owner: Claude - Deps: M2-IMP-01
- [ ] Streaming CSV and XLSX readers handle BOM, UTF-8/UTF-16/Windows-1252 detection, delimiter sniffing, quoted newlines, empty trailing rows and 100,000-row files without loading the file into memory.
- [ ] Analysis job stores headers, 50 sample rows and basic column statistics (distinct count, date/number detection).
- [ ] Malformed files produce an actionable error (line number and reason), never a stack trace.

#### M2-IMP-03 - Column and value mapping
Size: L - Owner: Claude - Deps: M2-IMP-02, M1-REG-04
- [ ] Heuristic suggestions (synonyms such as "Serial No", "S/N", "Service Tag"; case/punctuation-insensitive) map columns to core fields and category custom fields; the mapping is editable and can be saved as a named template per tenant.
- [ ] Value mapping for status names to status labels, and a find-or-create vs must-exist policy per reference (category, manufacturer, model, location, person, vendor).
- [ ] Date, number and currency parsing with a tenant locale hint and a preview of parsed values; ambiguous dates require an explicit format choice.
- [ ] AI-assisted mapping is (Could) and out unless explicitly scheduled.

#### M2-IMP-04 - Validation and dry run
Size: L - Owner: Claude - Deps: M2-IMP-03
The invariant: a dry run touches no registry data.
- [ ] Every row is validated against the same rules as the API (including custom fields) and classified create / update / skip / error; de-duplication on serial and tag both within the file and against existing assets, with a configurable policy (skip, update, error).
- [ ] A test asserts zero changes in registry tables (and no audit rows other than the import job's) after a dry run.
- [ ] Preview shows counts by outcome, the first N rows per outcome and a downloadable error CSV with row numbers and messages.
- [ ] A 100,000-row dry run completes in under 10 minutes on the CI perf runner.

#### M2-IMP-05 - Commit
Size: L - Owner: Claude - Deps: M2-IMP-04
- [ ] Commit runs in batches of N rows, one short transaction per batch with the tenant context re-set each time; failed rows are recorded without aborting the job; the job can be cancelled between batches.
- [ ] Idempotent and resumable: re-running commit after a crash does not create duplicates (keyed by row id and de-dupe keys).
- [ ] Throughput at least 10,000 rows per minute on the CI perf runner; interactive p95 is unaffected in a mixed-load test.
- [ ] Completion notification (in-app and email) with a summary and the error report.

#### M2-IMP-06 - Google Admin ChromeOS CSV template
Size: M - Owner: Both - Deps: M2-IMP-03, F-09
- [ ] Downloadable template and a one-click mapping preset for the Google Admin device export: serial number, asset ID (to tag), annotated user (person lookup), annotated location and organisational unit (location), status (status label), model, OS version, last sync, MAC/IP optional (custom fields).
- [ ] Created ChromeOS devices map to a "Chromebook" category with defined custom fields; re-importing the same file updates by serial and creates no duplicates.
- [ ] Validated against the founder-supplied real export (anonymised) with results recorded.

#### M2-IMP-07 - Generic templates (assets, people, locations)
Size: M - Owner: Claude - Deps: M2-IMP-03, M2-USR-01, M2-LOC-01
- [ ] Downloadable CSV/XLSX templates with example rows and a data dictionary for assets, people and locations; the importer supports each entity type, including parent resolution for locations.
- [ ] A recommended import order (locations, people, models, assets) is documented and surfaced as a warning when references are missing.

#### M2-IMP-08 - Import wizard UI
Size: L - Owner: Both - Deps: M2-IMP-05, M2-IMP-06, M1-WEB-02
- [ ] Steps: choose type and file, review mapping, dry-run preview, commit, results; progress bars from polling; leave and resume from an import list.
- [ ] Error report download and a "fix and re-upload" loop; clear copy that dry run changes nothing.
- [ ] Founder runs the wizard on real data and accepts it in M2-UX-01.

#### M2-IMP-09 - Import test corpus and real-data trial
Size: M - Owner: Both - Deps: M2-IMP-05, F-09
- [ ] Corpus of messy fixtures (BOM, mixed encodings, duplicate serials, European decimals and dates, merged header rows, 100k rows) stored in the repo and run in CI.
- [ ] Founder-supplied real files imported end to end; defects are fixed or logged as stories; time from file to labelled assets is recorded as the baseline for the "100 labelled assets under 30 minutes" target.

### E2.9 Notifications and saved views

#### M2-NOT-01 - Notification module
Size: L - Owner: Claude - Deps: M1-PLAT-05, M1-PLAT-09
- [ ] `notification_rule` and `notification` tenant tables; outbox subscribers create in-app notifications and send email via `MailAdapter` through worker jobs; per-user preferences (immediate, daily digest, off) per event type.
- [ ] Throttling and de-duplication (one digest of 50 items, not 50 emails); a delivery log is visible to admins through the API.
- [ ] Event types registered by modules (`stock.low`, `loan.overdue`, `import.completed`, `attachment.infected`), localised templates (English).

#### M2-NOT-02 - Notification UI
Size: M - Owner: Both - Deps: M2-NOT-01, M1-WEB-04
- [ ] Notification bell with unread count, list, mark read/all; user preferences screen; admin delivery-log view.

#### M2-REG-01 - Saved views
Size: M - Owner: Both - Deps: M1-WEB-07
- [ ] `saved_view` per user (filters, columns, sort), optionally shared tenant-wide with a `view:share` permission; API and UI to save, rename, delete and apply views on the asset list.
- [ ] Views referencing deleted fields/statuses degrade gracefully with a warning.

#### M2-REG-02 - List export to CSV
Size: M - Owner: Claude - Deps: M1-REG-07, M1-PLAT-06
- [ ] Any asset/people/location list (with current filters) can be exported to CSV through a worker job and a short-lived download; permission-gated and audited as a sensitive read.
- [ ] Exported files re-import cleanly through the importer (round-trip test).

### E2.10 Quality, docs and acceptance

#### M2-SEC-01 - Isolation harness extension
Size: M - Owner: Claude - Deps: M1-TEN-05, all new M2 tables
- [ ] Every new M2 table and route is auto-discovered by the schema lint and route-replay harness; a story cannot merge with an unregistered route.
- [ ] Extra cases: composite FK blocks cross-tenant references (inserting an assignment that points at another tenant's asset fails), storage keys are tenant-prefixed and fuzzed IDs in file URLs fail, import rows and notifications are invisible across tenants, and the job payload lint covers the new job types.
- [ ] Runs direct and through PgBouncer with the negative control; both green.

#### M2-SEC-02 - Upload and file-serving security
Size: M - Owner: Claude - Deps: M2-FILE-03
- [ ] Content sniffing rejects mismatched extension/mime; SVG and HTML uploads are blocked or served as downloads only; size caps are enforced server-side regardless of presign conditions.
- [ ] Fuzz tests on attachment URLs and keys; tests prove infected, pending and foreign-tenant attachments cannot be downloaded.
- [ ] Security headers on file responses are documented and tested.

#### M2-OPS-01 - Performance harness extension
Size: S - Owner: Claude - Deps: M1-CI-05, M2-IMP-05, M2-TAG-02
- [ ] Nightly job adds: check-out p95 < 300 ms, scan resolve p95 < 150 ms, 500-label PDF < 30 s, import commit throughput >= 10,000 rows/min, dry run of 100k rows < 10 min.

#### M2-DOC-01 - User guides (drafts)
Size: S - Owner: Claude - Deps: M2-IMP-08, M2-TAG-03, M2-LOAN-02
- [ ] Task-based guides: import your spreadsheet, import from Google Admin, print and apply labels, run a loaner day, log a repair; each with screenshots generated from the seeded stack.

#### M2-UX-01 - M2 founder acceptance walk-through
Size: S - Owner: Founder - Deps: all M2 stories
- [ ] Founder completes the exit-criteria script (items 1 to 8) on the Compose stack with real data and real hardware.
- [ ] UX change requests are logged as stories; the founder rates import and check-out speed against the "30 minutes to 100 labelled assets" target.

---

## 4. Milestone M3 - Expo mobile app (field flows)

**Goal.** A technician can walk a room with a phone: scan a label, see the asset, check it out/in or transfer it, photograph it, run a stocktake and log a repair, over the same REST API as the web app. Online-first: failed writes retry safely with the same `Idempotency-Key`; true offline is v2 (plan 6.5).

**Exit criteria (demoable outcome).** On a real iPhone (TestFlight internal) and a real Android phone (Play internal testing), pointed at the founder's Compose stack through a setup QR: scan a printed M2 label, check the device out to a person with a photo, kill the network mid-request and watch it complete exactly once after reconnect, run a 50-asset stocktake by continuous scanning and see the variance in the web app, and open a repair. The device test matrix (QR, Code128, DataMatrix on a low-end Android and an older iPhone) is recorded.

**Epics:** E3.1 App foundation and distribution (MOB, AUTH) - E3.2 Scanning and lookup (SCAN) - E3.3 Custody flows and retry queue (FLOW) - E3.4 Stocktake (STK) - E3.5 Quality and store readiness (QA, WEB). 22 stories.

**Not in M3:** push notifications (M6, Cloud only), store submission (M6), offline-first (v2), admin screens (web only), signature capture.

### E3.1 App foundation and distribution

- **M3-MOB-01** - Expo SDK 58 app scaffold in the monorepo. Size: L - Owner: Claude - Deps: M1-REPO-01, M1-PLAT-03
  - [ ] `apps/mobile` builds and runs in a development build; uses `packages/api-client`, `packages/schemas` and `packages/ui-tokens`; React Native navigation, theming (light/dark) and an RN component kit consistent with the web tokens.
  - [ ] CI job `mobile`: typecheck, unit tests and the duplicate-React check (`pnpm why --depth=10 react-native` and `react` must each resolve to exactly one version); documented `nodeLinker: hoisted` fallback tried and recorded if isolated installs break a library.
  - [ ] Minimum OS targets recorded (iOS 16.4+, Xcode 26.4 requirement noted); Node 22.13+ satisfied.
- **M3-MOB-02** - EAS build profiles and first internal builds. Size: M - Owner: Both - Deps: M3-MOB-01, F-06, F-07, F-08
  - [ ] EAS profiles `development`, `staging`, `production` with per-profile API base URL; signing credentials managed by EAS; builds triggered from CI on mobile-path changes.
  - [ ] First TestFlight (internal testers only; no Beta App Review needed) and Play internal-testing builds installed on the founder's phones.
  - [ ] Release checklist doc started (accounts, signing, listings, privacy forms) for M6.
- **M3-MOB-03** - Server URL onboarding, setup QR and MDM config. Size: M - Owner: Claude - Deps: M3-MOB-01, M1-PLAT-03
  - [ ] First launch asks for a server URL or scans a setup QR (generated in the web admin); the app validates `/v1/health` and a version/capability endpoint and stores the URL.
  - [ ] MDM managed app configuration key (iOS AppConfig, Android managed configurations) pre-fills the URL; documented for Intune.
  - [ ] Works for one store app serving both Cloud and Self-hosted servers; HTTPS required (HTTP only in development builds).
- **M3-AUTH-01** - Mobile authentication API. Size: L - Owner: Claude - Deps: M1-AUTH-03, M1-AUTH-04
  - [ ] Authorization-code + PKCE flow against first-party auth (password + MFA) returning a short-lived access token (about 15 min) and a rotating refresh token stored hashed; reuse of a rotated token revokes the whole family.
  - [ ] Mobile devices appear in the same device/session list as browsers and can be revoked by user or admin; revoked or expired tokens are rejected with a distinguishable error.
  - [ ] Auth security tests extended (refresh replay, PKCE downgrade, token binding to device id).
- **M3-MOB-04** - Login and token handling in the app. Size: M - Owner: Both - Deps: M3-AUTH-01, M3-MOB-03
  - [ ] Login (password, TOTP) in the app; tokens only in `expo-secure-store`; automatic refresh; logout and revocation wipe tokens and every on-device cache.
  - [ ] Biometric unlock on resume is optional and off by default.
- **M3-MOB-05** - App navigation, UI kit and role-aware home. Size: M - Owner: Both - Deps: M3-MOB-01, S0-DES-03
  - [ ] Home with Scan, Check out, Check in, Stocktake, Repairs, Recent; items hidden per role (Technician/Auditor, Asset Manager, Viewer).
  - [ ] Accessible labels, dynamic type, 44 pt touch targets, safe-area handling; founder accepts look and feel in M3-QA-04.

### E3.2 Scanning and lookup

- **M3-SCAN-01** - Camera scanner component. Size: M - Owner: Claude - Deps: M3-MOB-01
  - [ ] `expo-camera` scanning for QR, Code128 and DataMatrix with continuous mode, torch toggle, haptic/sound feedback, debounce of repeated reads and a manual-entry fallback.
  - [ ] Permission denied/blocked flows have clear recovery UX.
  - [ ] Scan-to-result time measured and logged for the beta comparison (M3-QA-04).
- **M3-SCAN-02** - Scan resolve and asset card. Size: M - Owner: Claude - Deps: M3-SCAN-01, M2-TAG-01
  - [ ] `scan/resolve` result shows asset summary, status, holder, location and the actions allowed for the caller's role; out-of-scope or unknown codes show "not found" without leaking existence.
  - [ ] Both label forms work (QR URL and Code128 tag); scanning a label from another tenant shows not found.

### E3.3 Custody flows and retry queue

- **M3-FLOW-01** - Check-out, check-in and transfer. Size: L - Owner: Both - Deps: M3-SCAN-02, M2-LIFE-04
  - [ ] Assignee picker with search (people API), expected return default, notes; check-in with target status, location and condition notes; transfer in one step.
  - [ ] 409/412 conflicts (asset changed or already checked out) refresh the card and explain what happened.
  - [ ] Server calls use `Idempotency-Key` and `If-Match`; verified against a staging API in an e2e (Maestro or Detox) script.
- **M3-FLOW-02** - Photo capture and upload. Size: M - Owner: Claude - Deps: M3-FLOW-01, M2-FILE-01
  - [ ] Camera/gallery capture, client-side downscale, presigned PUT upload with progress and retry, attached to check-out/in and repairs; scan-pending state handled.
  - [ ] Uploads survive app backgrounding; failures do not block the custody action when the photo is optional.
- **M3-FLOW-03** - Retry queue (online-first). Size: L - Owner: Claude - Deps: M3-FLOW-01
  - [ ] Failed mutations (network error/timeout only, never 4xx) are persisted and replayed with the same `Idempotency-Key`, in order per asset, with a visible "pending" indicator and manual retry/discard.
  - [ ] Chaos tests: drop the connection after request send and before response, replay, assert exactly one assignment exists; app kill during queue drain resumes safely.
  - [ ] Queue holds only the minimum payload and is wiped on logout/revocation.
- **M3-FLOW-04** - Loaner quick flows on mobile. Size: M - Owner: Both - Deps: M3-FLOW-03, M2-LOAN-02
  - [ ] Scan person then scan devices to check out; scan devices to bulk check-in; due date defaults and overdue badge.
- **M3-FLOW-05** - Repair log on mobile. Size: M - Owner: Claude - Deps: M3-FLOW-02, M2-MNT-01
  - [ ] Open/close a repair from a scan with notes, cost and photos.
- **M3-FLOW-06** - Quick-create from scan. Size: M - Owner: Both - Deps: M3-SCAN-02, M1-REG-05
  - [ ] Scanning an unknown tag offers "create asset" with category/model pickers and photo; permission-gated (Asset Manager and above).

### E3.4 Stocktake

- **M3-STK-01** - Stocktake backend. Size: L - Owner: Claude - Deps: M2-LOC-02, M1-PLAT-02
  - [ ] `stocktake` and `stocktake_item` tenant tables; sessions created by location (with sublocations) or saved filter, snapshotting the expected set; states open, in_progress, completed, cancelled.
  - [ ] Scan-confirm endpoint is idempotent; classifications: found, missing, unexpected (asset exists elsewhere), unknown (no match); multiple auditors can scan one session concurrently.
  - [ ] Complete step offers per-item resolution (mark lost, move to scanned location, ignore) with audit and history events; variance summary endpoint.
  - [ ] Isolation suite and route replay cover all new routes.
- **M3-STK-02** - Mobile stocktake. Size: L - Owner: Both - Deps: M3-STK-01, M3-SCAN-01, M3-FLOW-03
  - [ ] Pick a session, continuous scanning with running counts (found/remaining/unexpected), tap to inspect, sound/haptic feedback, resume after interruption.
  - [ ] Scans queue through the retry queue; 200 scans in a session remain responsive.
- **M3-STK-03** - Web stocktake screens. Size: M - Owner: Both - Deps: M3-STK-01, M1-WEB-02
  - [ ] Create/close sessions, live progress, variance list with resolutions, CSV export of the variance.

### E3.5 Quality, store readiness and web scanning

- **M3-WEB-01** - Web camera scanning (Should). Size: M - Owner: Claude - Deps: M2-LIFE-08
  - [ ] `BarcodeDetector` with a ZXing-js fallback for iOS Safari in the web scan input; usable as a fallback if store review slips.
  - [ ] Same decode-time logging as the mobile scanner for the native-vs-web comparison.
- **M3-QA-01** - Device test matrix. Size: M - Owner: Both - Deps: M3-SCAN-01, M2-TAG-04, F-02
  - [ ] QR, Code128 and DataMatrix read-rate tested on a low-end Android, a mid-range Android and an older iPhone with printed M2 labels (sizes, glossy and matte, low light); results table committed to the docs.
  - [ ] Defects (for example Code128 on a specific device) become stories or documented limits.
- **M3-QA-02** - Store-readiness assessment. Size: M - Owner: Both - Deps: M3-MOB-04
  - [ ] Written assessment of Apple guideline 4.8 (Sign in with Apple, since OIDC login arrives in M4/M6), in-app account deletion (5.1.1(v)) and self sign-up rules; decisions recorded as ADRs.
  - [ ] Draft privacy nutrition label and Play data-safety answers; permission strings reviewed; public/unlisted distribution (not Apple Custom Apps) confirmed.
- **M3-QA-03** - OTA updates, code signing and minimum client version. Size: M - Owner: Both - Deps: M3-MOB-02, F-08
  - [ ] EAS Update channels per environment with code signing (key in the protected CI environment, certificate embedded in the binary), runtime versions, fixes-only policy written down (Apple 2.5.2).
  - [ ] API returns a minimum supported client version; the app forces an update screen when below it; tested against a mocked version.
- **M3-QA-04** - M3 founder field acceptance (UX). Size: S - Owner: Founder - Deps: all M3 stories
  - [ ] Founder runs a 50-asset stocktake and a loaner check-out/in with the phone, records task times and scan error rate, and accepts or logs changes.
  - [ ] Exit-criteria script passes on both iOS and Android.

---

## 5. Milestone M4 - Self-hosted edition (first real users)

**Goal.** Ship the single-tenant edition as a verified, signed, upgradable Docker Compose bundle that a design partner can install in under 30 minutes on a Linux host, with offline licence verification and no mandatory phone-home.

**Exit criteria (demoable outcome).** On a clean Linux VM the founder follows only the install guide: pulls signed images from the licence-gated registry, supplies a licence file and TLS certificate, runs `install.sh`, logs in as the bootstrapped Owner, imports a spreadsheet, scans with the Expo app via a setup QR, then runs `upgrade.sh` to a newer release without data loss. CI proves the same automatically: a fresh install, an N-2 to latest upgrade with seeded data, the licence state machine (valid, 90% warning, expiring, grace, read-only, tampered, unknown `kid`, clock rollback) and the mobile TLS test. At least one design partner is running it on their own host.

**Epics:** E4.1 Bundle and adapters (BND) - E4.2 Licence system (LIC) - E4.3 Release engineering and tests (REL) - E4.4 Self-hosted auth, export, docs, partners (SHA) - E4.5 Database roles and retention (DB). 24 stories.

**Not in M4 (v2, per plan decision 27):** Helm chart, air-gapped install, self-hosted SAML/SCIM via Keycloak, Vault/KMS key adapter; push relay is v1.1.

### E4.1 Bundle and adapters

- **M4-BND-01** - Self-hosted adapters and secrets. Size: M - Owner: Claude - Deps: M1-PLAT-08, M2-FILE-01
  - [ ] `KeyProvider` master key from a Docker secret file; `SecretsProvider` from env/secret files; `EntitlementSource` reads the licence (M4-LIC-01); `PushAdapter` is a no-op; S3-compatible and local-filesystem storage both verified in the bundle.
  - [ ] Key rotation procedure (re-wrap data keys) tested; loss of the master key is documented as unrecoverable for encrypted credentials.
- **M4-BND-02** - Observability for operators. Size: S - Owner: Claude - Deps: M1-OPS-01
  - [ ] JSON logs to stdout, Prometheus `/metrics` on an internal port, optional OTLP exporter via env; `support-bundle.sh` collects redacted logs, versions, config (secrets stripped) and licence status.
- **M4-BND-03** - First-run bootstrap. Size: M - Owner: Claude - Deps: M1-TEN-09, M4-BND-01
  - [ ] `migrate` seeds exactly one tenant (`CONTROL_PLANE_MODE=local`, cell `local`) and the Owner from `ADMIN_EMAIL`, using the same `bootstrapTenant` as Cloud; idempotent on restart.
  - [ ] Owner receives a setup link by SMTP (or a one-time console link when SMTP is unconfigured) and is forced through MFA enrolment per tenant setting.
- **M4-BND-04** - Compose bundle. Size: L - Owner: Claude - Deps: M4-BND-03, M1-REPO-03
  - [ ] Versioned bundle: `docker-compose.yml`, `.env.example`, `Caddyfile`, profiles `bundled-db`, `bundled-storage`, `scan`; services caddy, api, worker, scheduler, migrate, postgres 18, PgBouncer 1.26.1+ (transaction mode, `max_prepared_statements` set), redis, minio, clamav; images by digest, no dev targets or bind-mounted sources.
  - [ ] Only `caddy` publishes ports; containers run non-root with read-only root filesystems where possible; secrets as files.
  - [ ] Bring-your-own Postgres 16/17/18 (`PGBOUNCER_UPSTREAM_URL`, `MIGRATOR_DATABASE_URL`) and bring-your-own S3 documented and tested in CI (matrix 16 and 18 minimum).
  - [ ] Minimum host (4 vCPU, 8 GB RAM, about 10k assets) verified by a load test.
- **M4-BND-05** - `caddy-web` image. Size: L - Owner: Claude - Deps: M1-WEB-10, M4-BND-04
  - [ ] Caddy image with the static export baked in, SPA fallback, `/v1` reverse proxy, security headers with CSP using build-time script hashes, HSTS.
  - [ ] TLS modes: customer certificate (default), public ACME (plus a DNS-plugin build), `tls internal` (evaluation only, clearly labelled).
  - [ ] Browser tests (Playwright) pass against each TLS mode; headers asserted.
- **M4-BND-06** - Operator scripts. Size: M - Owner: Claude - Deps: M4-BND-04
  - [ ] `install.sh` (preflight: Docker 24+, Compose v2, ports, disk, RAM, DNS), `upgrade.sh` (version check against N-2, backup prompt, migrate, health gate, rollback by digest), `backup.sh`/`restore.sh` (pg_dump + object store + master key reminder), `support-bundle.sh`.
  - [ ] A scripted restore drill on a clean host reproduces data exactly; documented timings.

### E4.2 Licence system

- **M4-LIC-01** - Licence format and verifier. Size: L - Owner: Claude - Deps: M4-BND-01
  - [ ] Compact JWS signed EdDSA (Ed25519) with a `kid` header carrying customer, edition, asset-band limit, enabled modules, expiry, support tier; verified offline with `jose`/Node crypto and embedded public keys (multiple kids for rotation).
  - [ ] Tampered payload, wrong key, unknown `kid` and malformed tokens are rejected with distinct errors; verified at boot and daily by the scheduler.
- **M4-LIC-02** - Enforcement states. Size: M - Owner: Claude - Deps: M4-LIC-01
  - [ ] State machine: ok, warning at 90% of asset limit, warning 30 days before expiry, grace for 30 days after expiry, then read-only; never lockout of export; Community licence (250 assets, core features only) supported.
  - [ ] Clock-rollback detection (monotonic high-water mark) does not extend a licence; asset-limit counts exclude archived/disposed assets.
  - [ ] Read-only mode blocks writes with a clear problem type while reads, login and export still work; full state table covered by tests (also run in the PR pipeline).
- **M4-LIC-03** - Licence issuing tool and key custody. Size: M - Owner: Both - Deps: M4-LIC-01, F-12
  - [ ] Offline CLI (founder-run) issues licences from a customer record; signing key never in the repo or CI; documented rotation and revocation story (expiry-based, since no phone-home).
  - [ ] Issues the Community licence template and a 30-day evaluation licence.
- **M4-LIC-04** - Licence UI and notices. Size: M - Owner: Both - Deps: M4-LIC-02
  - [ ] Admin screen shows customer, edition, limits, usage, expiry, state, and an upload-new-licence action (hot reload without restart); warnings appear as in-app banner and email to Owners.

### E4.3 Release engineering and tests

- **M4-REL-01** - Release pipeline. Size: L - Owner: Claude - Deps: M1-CI-04, M4-BND-05
  - [ ] A semver tag on a commit that passed staging promotes the backend digest (no rebuild) and builds `caddy-web` from the same commit; both pass the Trivy gate, get an SBOM and are signed with cosign v3 key-based (`--key`); the public key ships in the bundle for offline verification.
  - [ ] Release notes and an upgrade guide are generated from templates and attached; the pipeline never blocks the main (dev) track.
- **M4-REL-02** - Licence-gated registry. Size: M - Owner: Both - Deps: M4-REL-01, F-13
  - [ ] Private registry supporting OCI 1.1 referrers (signatures verifiable); per-customer pull credentials issued by the licence tool, revocable; documented `cosign verify` commands.
- **M4-REL-03** - Upgrade mechanics. Size: M - Owner: Claude - Deps: M4-BND-06
  - [ ] Expand/contract-only migrations enforced by a CI migration classifier (contract steps allowed only in a later release); any supported version upgrades directly to latest.
  - [ ] Pre-upgrade backup prompt, automatic migration, health-gated rollback by digest; downtime under 5 minutes measured.
- **M4-REL-04** - Fresh-install test. Size: M - Owner: Claude - Deps: M4-BND-06
  - [ ] CI job installs the bundle on a clean ephemeral Linux host and runs the smoke flow (login, import, scan resolve, export, licence page); install time under 30 minutes recorded.
- **M4-REL-05** - N-2 to latest upgrade test. Size: L - Owner: Claude - Deps: M4-REL-03
  - [ ] Installs each supported prior release (N-2, N-1) with seeded data, upgrades to the candidate, then reruns the isolation suite, the smoke flow and the licence state checks.
  - [ ] Pre-release tags (for example 0.1 to 0.3) are cut early so the test is not vacuous before three real releases exist.
- **M4-REL-06** - Mobile TLS test. Size: M - Owner: Both - Deps: M4-BND-05, M3-MOB-03
  - [ ] Expo app tested against a customer-supplied cert chained to a private CA and against `tls internal`; the latter is expected to fail on Android without MDM-installed trust and the docs say so.

### E4.4 Self-hosted auth, export, docs and partners

- **M4-SHA-01** - Built-in OIDC login. Size: L - Owner: Claude - Deps: M1-AUTH-03
  - [ ] Admin configures Google, Microsoft or a generic OIDC provider (discovery URL, client id/secret envelope-encrypted); login via authorization code + PKCE; account linking by verified email; just-in-time user creation optional and role-mapped.
  - [ ] Works in the web app and for the mobile app (system browser); security tests for state/nonce, redirect-URI validation and email-verification claims.
- **M4-SHA-02** - Full tenant data export. Size: M - Owner: Claude - Deps: M2-IMP-01
  - [ ] Owner-only job exports every entity as CSV plus a JSON bundle (and attachments) as a downloadable archive; works in read-only licence mode.
  - [ ] Export re-imports into a new install through the M2 importers for the core entities (round-trip test).
- **M4-SHA-03** - Operator documentation set. Size: L - Owner: Claude - Deps: M4-BND-06
  - [ ] Install, upgrade, backup/restore, TLS modes, BYO Postgres/S3, licence management, shared-responsibility matrix, hardening guide (non-root, firewall, only 80/443), troubleshooting, supported-versions policy (N-2).
  - [ ] Docs verified by following them verbatim on a clean host (M4-SHA-06).
- **M4-SHA-04** - Security review before real users. Size: L - Owner: Both - Deps: M4-REL-04
  - [ ] ASVS L2 self-assessment completed with evidence links; dependency, secret and container scans clean; manual tenant-isolation attack session by a fresh sub-agent given only the repo (no prior context), findings fixed.
  - [ ] Threat model updated for the self-hosted deployment; interim external review is a founder decision (see section 12), since the formal pen test is scheduled in M6.
- **M4-SHA-05** - Design-partner onboarding kit. Size: M - Owner: Both - Deps: M4-SHA-03, F-10, F-11
  - [ ] Partner agreement and licence terms (F-11) attached to each issued licence; a guided first-install call checklist; feedback channel; weekly check-in template.
  - [ ] Manual capture of the decision-20 keep/kill metrics (import success on real data, scanning comparison, willingness to pay vs Snipe-IT hosted) in a tracker.
- **M4-SHA-06** - M4 founder acceptance (UX). Size: S - Owner: Founder - Deps: all M4 stories, F-14
  - [ ] Founder installs on a clean VM using only the docs, upgrades once, restores a backup, and signs off; at least one external partner has completed an install.

### E4.5 Database roles and retention

- **M4-DB-01** - Narrow DB role and separate pool for identity-schema lookups. Size: M - Owner: Claude - Deps: M1-TEN-08, M1-AUTH-02
  - [ ] The `app` role cannot SELECT `identity.credential` (permission denied, 42501); the app role loses access to `identity.credential` and `identity.session`.
  - [ ] Login still works through a separate identity pool that uses the narrow role; the isolation suite is updated for the new grants (direct and through PgBouncer).
- **M4-DB-02** - Retention DB role for audit/asset_history partition drops, tenant offboarding purge and DSAR deletion. Size: M - Owner: Claude - Deps: M1-TEN-06, M1-PLAT-04
  - [ ] A dedicated retention role runs partition drops, offboarding purge and DSAR deletion; the `app` role still cannot DELETE or DROP.
  - [ ] Each purge is audited and tested with two tenants (purging one leaves the other's rows intact).

---

## 6. Milestone M5 - Importer, licences, reports, webhooks, API completeness

**Goal.** Close the feature gaps that make Snipe-IT migrations and daily operation credible: a one-click Snipe-IT importer, software licences with seats and expiry, reports and a dashboard, signed webhooks, an audit log UI, and a REST API that is complete, documented and conformance-tested. Shipped as monthly self-hosted releases to the design partners.

**Exit criteria (demoable outcome).** (1) A seeded Snipe-IT instance with 5,000 assets, users, licences, accessories, consumables and history is imported through the wizard (URL + token) with progress, resumability after a forced restart, and a verified object-count reconciliation; (2) licences with seats are assigned to people/assets and an expiring licence triggers an alert; (3) the dashboard and ten standard reports render with filters and export to CSV/XLSX; (4) a webhook endpoint receives HMAC-signed events, survives a failing receiver with retries, and the delivery log shows replay; (5) the audit log screen filters and exports; (6) a script using only the generated client and an API key performs the full custody workflow, and the CI parity gate proves every UI action has an endpoint.

**Epics:** E5.1 Snipe-IT importer (SNIPE) - E5.2 Licences (LIC) - E5.3 Reports and dashboard (RPT) - E5.4 Webhooks (HOOK) - E5.5 Audit log (AUD) - E5.6 REST API completeness (API) - E5.7 Quality and partners (QA, BUF, UX). 27 stories.

### E5.1 Snipe-IT importer

- **M5-SNIPE-01** - Snipe-IT API client. Size: L - Owner: Claude - Deps: M2-IMP-01, M1-PLAT-08
  - [ ] Bearer-token client that respects 120 requests/min and 500 rows/page by default (configurable for self-hosted sources), backs off on 429, is resumable and SSRF-safe (validated DNS, no private ranges unless an explicit self-hosted allow-list); token stored envelope-encrypted in `integration_connection` (M5-SNIPE-05); for a one-off import the connection row and its credentials are purged when the job completes or is cancelled, unless the admin explicitly saves the connection for repeat imports.
  - [ ] Contract tests against a recorded Snipe-IT API fixture set and against a dockerised Snipe-IT in CI.
  - [ ] No Snipe-IT code is copied (AGPL-3.0); only the public API is used.
- **M5-SNIPE-02** - Object mapping and staged import. Size: L - Owner: Claude - Deps: M5-SNIPE-01, M5-LIC-02
  - [ ] Pulls in dependency order: fieldsets and custom fields, status labels, suppliers, companies, categories, manufacturers, models, locations, users, assets, accessories, consumables, licences and seats, maintenances, files; stages into `import_row`.
  - [ ] Per-object reconciliation report (source count vs staged vs created vs skipped with reasons); `external_source`/`external_id` set for idempotent re-runs.
  - [ ] ChromeOS devices loaded by google2snipe import correctly.
- **M5-SNIPE-03** - History and activity import. Size: M - Owner: Claude - Deps: M5-SNIPE-02
  - [ ] Optional last stage importing per-asset history (checkouts, check-ins) into the custody timeline; `/reports/activity` evaluated as a cheaper source and the decision recorded.
  - [ ] Time estimate shown before starting (about 42 minutes for 5,000 assets at 120 req/min) and the stage can be skipped.
- **M5-SNIPE-04** - Wizard, dry run and import test bench. Size: L - Owner: Both - Deps: M5-SNIPE-02, M2-IMP-08
  - [ ] Wizard: URL + token, connection test, object selection, dry run preview using the M2 dry-run machinery, progress UI, resume after restart.
  - [ ] CI test bench seeds a dockerised Snipe-IT with 5,000 assets and compares counts; founder runs it against a design partner's real (or anonymised) instance and records results.

- **M5-SNIPE-05** - `integration_connection` table with envelope-encrypted credentials; Snipe-IT importer reads credentials from it. Size: M - Owner: Claude - Deps: M5-SNIPE-01, M1-PLAT-08
  - [ ] Tenant table `integration_connection` (provider, base URL, credential envelope-encrypted with tenant and purpose context, key version); CRUD API with audit; credential never returned after save.
  - [ ] The Snipe-IT importer loads its token from `integration_connection` at run time; a run without a connection fails with a clear problem response.
  - [ ] One-off import credentials purged on completion/cancel; saved connections only on explicit opt-in.
  - [ ] Isolation suite covers the new table and routes (direct and through PgBouncer).

### E5.2 Licences

- **M5-LIC-01** - Software licence records. Size: M - Owner: Claude - Deps: M1-REG-01, M1-REG-11
  - [ ] `license` tenant table (product, vendor, key stored envelope-encrypted, seats, purchase date/cost, expiry, notes, category kind=license); CRUD API, audit, events.
- **M5-LIC-02** - Seat assignment. Size: M - Owner: Claude - Deps: M5-LIC-01, M2-USR-01
  - [ ] `license_seat` assigned to a person or an asset; over-assignment refused; unassign/reassign with history; concurrent assignment cannot exceed seats (test).
- **M5-LIC-03** - Expiry and renewal alerts. Size: M - Owner: Claude - Deps: M5-LIC-01, M2-NOT-01
  - [ ] Scheduler emits `license.expiring` at configurable lead times (for example 60/30/7 days) once each; included in digests; warranty-expiry alerts for assets added on the same mechanism.
- **M5-LIC-04** - Licence UI and CSV import. Size: L - Owner: Both - Deps: M5-LIC-02, M2-IMP-08
  - [ ] List/detail/seat management UI, filter by expiring/over-assigned; licence key reveal is permission-gated and audited.
  - [ ] CSV template and importer support for licences and seats.

### E5.3 Reports and dashboard

- **M5-RPT-01** - Standard report framework and ten reports. Size: L - Owner: Claude - Deps: M2-LIFE-06, M5-LIC-02
  - [ ] Reports: inventory, by location, by assignee, aging, warranty expiry, licence expiry, checkout history, stocktake variance, cost summary, loaner/overdue; implemented through `security_invoker` views or tenant-scoped queries only, listed in the schema lint.
  - [ ] Each report is filterable, paginated, exportable, permission-gated and exercised with 50k-asset data within the performance budget.
- **M5-RPT-02** - Reports UI and export. Size: M - Owner: Both - Deps: M5-RPT-01
  - [ ] Report picker, filters, column control, CSV and XLSX export through a worker job; exports audited.
- **M5-RPT-03** - Dashboard (fixed widgets). Size: M - Owner: Both - Deps: M5-RPT-01
  - [ ] Counts by status/category/location, expiring items, overdue returns, recent activity, low stock; widgets lazy-load and respect role and location scope; p95 < 500 ms server side.
- **M5-RPT-04** - Straight-line depreciation (Should). Size: M - Owner: Claude - Deps: M1-REG-05
  - [ ] Per-model or per-asset depreciation months and residual value; current value computed on read; depreciation report.

### E5.4 Webhooks

- **M5-HOOK-01** - Endpoint management and event catalogue. Size: M - Owner: Claude - Deps: M1-PLAT-05, M1-PLAT-08
  - [ ] `webhook_endpoint` CRUD with event filters and per-endpoint secret (envelope-encrypted, shown once); catalogue includes `asset.created/updated/checked_out/checked_in/status_changed`, `license.expiring`, `stocktake.completed`, `loan.overdue`; payloads equal the API representation.
- **M5-HOOK-02** - Signed delivery with retries. Size: L - Owner: Claude - Deps: M5-HOOK-01, M1-PLAT-06
  - [ ] HMAC-SHA256 over `timestamp.body`, headers `X-Signature`, `X-Timestamp`, `X-Event-Id`; 10 s timeout; exponential backoff with jitter (about 8 attempts over about 24 h), then dead; repeated failure auto-pauses the endpoint and notifies admins.
  - [ ] SSRF controls: DNS resolved once, private/link-local/metadata ranges blocked, connection pinned to the validated IP, no redirects to blocked ranges; tested with hostile fixtures.
  - [ ] First-attempt latency p95 < 30 s after commit.
- **M5-HOOK-03** - Delivery log, replay and rotation. Size: M - Owner: Both - Deps: M5-HOOK-02
  - [ ] `webhook_delivery` log (partitioned, parent-only grants) with status, latency, attempt history; admin replay creates a new delivery; secret rotation keeps the old secret valid for an overlap window; UI and API.

### E5.5 Audit log

- **M5-AUD-01** - Audit log UI and export. Size: M - Owner: Both - Deps: M1-PLAT-04
  - [ ] Filter by actor, entity, action, date; drill-through to the entity; before/after diff view with redaction; CSV export (audited as a sensitive read).
- **M5-AUD-02** - Retention and purge. Size: M - Owner: Claude - Deps: M5-AUD-01, M1-TEN-06
  - [ ] Retention per tier (30 days Free, 1 year Starter, 3 years Pro, custom Enterprise) enforced by dropping old partitions or a narrowly granted retention role (the `app` role still cannot delete); purge is audited and tested with two tenants.

### E5.6 REST API completeness

- **M5-API-01** - API keys. Size: L - Owner: Claude - Deps: M1-TEN-08, M1-AUTH-01
  - [ ] Scoped keys (`resource:action`), expiry, optional name/owner, shown once, stored hashed, looked up by prefix through `identity`; revocation and last-used tracking; UI.
  - [ ] Key principals appear as `api_key` actors in audit; a key never exceeds its creator's permissions.
- **M5-API-02** - Rate limiting. Size: M - Owner: Claude - Deps: M5-API-01
  - [ ] Per-tenant limits by tier (Free 60, Starter 120, Pro 600 requests/min as configuration) via Redis, with `RateLimit-*` headers and 429 problem responses; Self-hosted unlimited by default.
- **M5-API-03** - UI-API parity gate. Size: M - Owner: Claude - Deps: M1-PLAT-03
  - [ ] CI check enumerates UI actions (declared in a manifest used by the web app) and fails if any lacks an OpenAPI operation; gaps found are filled in this story.
- **M5-API-04** - OpenAPI polish and developer docs. Size: M - Owner: Claude - Deps: M5-API-03
  - [ ] Examples for every operation, error catalogue, auth guide, pagination/idempotency/ETag guides, webhook verification samples (Node, Python, PowerShell), published docs site, Postman/Insomnia collection, TypeScript client published (OpenAPI-generated Python client is a Could).
  - [ ] Changelog and a 12-month deprecation policy page.
- **M5-API-05** - API conformance suite. Size: M - Owner: Claude - Deps: M5-API-03
  - [ ] Automated conformance tests assert on every resource: RFC 9457 errors, cursor pagination, ETag/If-Match, `Idempotency-Key` where specified, bulk semantics, audit and outbox emission.
- **M5-API-06** - Isolation suite extension. Size: M - Owner: Claude - Deps: M5-API-01, M5-HOOK-02, M5-RPT-01
  - [ ] Suite covers API-key auth (a key from tenant A against tenant B ids), webhook SSRF fixtures, report views (security_invoker verified), Snipe-IT import rows, and webhook delivery partitions (direct-partition test); direct and pooled passes green.

### E5.7 Quality and partners

- **M5-QA-01** - Performance regression pass. Size: S - Owner: Claude - Deps: M5-RPT-03, M5-LIC-02
  - [ ] Nightly perf budgets (list, search, scan, reports, dashboard) re-run on the full data model with 2 x 50k assets and 5k licences; regressions fixed or budgets consciously amended.
- **M5-BUF-01** - Partner feedback buffer. Size: L - Owner: Both - Deps: M4-SHA-05
  - [ ] Reserved capacity (about 20% of the milestone) for defects and top-voted requests from design partners; each monthly self-hosted release ships with notes.
- **M5-UX-01** - M5 founder acceptance. Size: S - Owner: Founder - Deps: all M5 stories
  - [ ] Founder runs the exit-criteria script, including a Snipe-IT migration of a real instance if a partner supplies one.

---

## 7. Milestone M6 - Cloud SaaS launch

**Goal.** Run the same image as a multi-tenant Cloud service on AWS with self-serve signup, Stripe billing, monitoring, tested backups and an external penetration test, and get the Expo app through store review. Cloud is the default way to buy; Self-hosted continues unchanged.

**Exit criteria (demoable outcome).** A stranger signs up at the public URL, verifies email, lands in an onboarding wizard, imports a spreadsheet, pays through Stripe (or stays on Free with 250 active assets), invites a colleague, signs in on the store-installed mobile app and scans a label. Operationally: dashboards and alerts are live; a timed PITR restore drill has been executed and recorded; the external pen test with multi-tenant scope reports zero open cross-tenant findings; the isolation suite passes against the staging cell through PgBouncer; the store apps are approved; the status page and support inbox exist; the go/no-go checklist is signed.

**Epics:** E6.1 Cloud infrastructure (INF) - E6.2 Multi-tenant operations (TOPS) - E6.3 Billing and entitlements (BILL) - E6.4 Monitoring, backups, capacity (MON) - E6.5 Security and compliance (SEC) - E6.6 SSO add-on (SSO) - E6.7 Mobile launch (MOBL) - E6.8 Go-to-market and launch (GTM, LAUNCH). 32 stories.

### E6.1 Cloud infrastructure

- **M6-INF-01** - Terraform baseline. Size: L - Owner: Claude - Deps: F-16
  - [ ] Terraform (state in S3 with locking) for accounts/environments (dev, staging, prod), VPC with private subnets, KMS keys per environment, ECR, S3 buckets (attachments/exports/imports with SSE-KMS and versioning), IAM least privilege, GitHub OIDC roles; plan on PR, apply on merge with approval.
- **M6-INF-02** - Data tier. Size: L - Owner: Claude - Deps: M6-INF-01
  - [ ] RDS PostgreSQL 18 Multi-AZ with PITR, roles `migrator`/`app` created, parameter group; PgBouncer 1.26.1+ as an ECS service in transaction mode with `max_prepared_statements` (RDS Proxy not used); small ElastiCache Redis; connection limits sized from load tests.
- **M6-INF-03** - Application tier and edge. Size: L - Owner: Claude - Deps: M6-INF-02, M1-WEB-10
  - [ ] ECS Fargate services `api`, `worker`, `scheduler`, ClamAV; ALB accepting only CloudFront; CloudFront serving the static web export from S3 with SPA fallback, `/v1/*` routed to the ALB, response-headers policy for CSP/HSTS; cookie-less file domain.
  - [ ] Deep-link, refresh and QR-URL Playwright tests pass against the deployed edge.
- **M6-INF-04** - Delivery pipeline. Size: M - Owner: Claude - Deps: M6-INF-03, M1-CI-04
  - [ ] Merge to `main` builds, scans, pushes by SHA; staging deploy runs the `migrate` task first, then services by digest with circuit-breaker rollback; manual approval promotes the same digest to prod; smoke and synthetic checks gate promotion.
- **M6-INF-05** - Cloud adapters in production. Size: M - Owner: Claude - Deps: M6-INF-01, M1-PLAT-08, M1-PLAT-09
  - [ ] KMS `KeyProvider` with `tenant_id` + purpose encryption context, Secrets Manager `SecretsProvider`, SES `MailAdapter` (SPF/DKIM/DMARC, bounce/complaint handling), S3 storage in production configuration; existing encrypted data migrates without loss in staging rehearsal.

### E6.2 Multi-tenant operations

- **M6-TOPS-01** - Self-serve signup and onboarding. Size: L - Owner: Both - Deps: M1-TEN-09, M6-INF-05
  - [ ] Signup with email verification, bot/abuse controls and rate limits; tenant bootstrapped in seconds; onboarding wizard (organisation type templates, import prompt, invite teammates, print first labels).
  - [ ] Funnel events captured (signup, first asset, 100 assets, first label printed) for the activation metric.
- **M6-TOPS-02** - Tenant lifecycle. Size: M - Owner: Claude - Deps: M6-TOPS-01
  - [ ] Suspend, cancel, retention window, scheduled purge (all data, files, search/cache entries) as audited per-tenant jobs; per-tenant logical export used for single-tenant restore requests with a documented runbook.
- **M6-TOPS-03** - Quotas and noisy-neighbour controls. Size: M - Owner: Claude - Deps: M5-API-02
  - [ ] Per-tenant concurrency limits for jobs, import/export quotas, storage quotas by tier; per-tenant usage and error views from logs/traces to find noisy tenants.
- **M6-TOPS-04** - Support console and impersonation. Size: M - Owner: Claude - Deps: M1-TEN-07
  - [ ] Time-boxed, tenant-approved, fully audited impersonation; staff access protected by SSO + MFA; no standing production access.

### E6.3 Billing and entitlements

- **M6-BILL-01** - Stripe products and checkout. Size: L - Owner: Both - Deps: F-17, M6-TOPS-01
  - [ ] Products/prices for Free (250), Starter (500), Pro (2,500), Enterprise (custom) in test then live mode; Checkout, customer portal, idempotent webhook handler (signature verified, replay safe).
- **M6-BILL-02** - Entitlements and active-asset meter. Size: L - Owner: Claude - Deps: M6-BILL-01, M4-LIC-02
  - [ ] `EntitlementSource` backed by active Stripe subscription items; usage meter counts active assets (retired/disposed excluded) and enforces the Free limit with a clear UX; module flags checked identically to the Self-hosted licence path.
- **M6-BILL-03** - Plan changes, dunning and tax. Size: M - Owner: Both - Deps: M6-BILL-01
  - [ ] Upgrade/downgrade with proration, failed-payment dunning and grace, invoices, tax configuration; "no minimum band" and "retired assets don't count" verified by tests.
- **M6-BILL-04** - Entitlement parity tests. Size: S - Owner: Claude - Deps: M6-BILL-02
  - [ ] One test matrix runs the same feature-flag assertions against the Stripe source and the licence source; asset-limit and read-only behaviours match the specified rules.

### E6.4 Monitoring, backups and capacity

- **M6-MON-01** - Observability stack. Size: M - Owner: Both - Deps: M6-INF-03, F-22
  - [ ] OpenTelemetry to the chosen backend, golden-signal dashboards, per-route and per-queue panels, `tenant_id` as trace/log attribute only; Sentry wired for api, web and mobile.
- **M6-MON-02** - Alerting, status page and runbooks. Size: M - Owner: Both - Deps: M6-MON-01
  - [ ] Alarms on availability SLO (99.9% proposal), p95 budgets, queue age, DB saturation, failed deploys; on-call route to the founder; public status page; synthetic checks for login and scan flow; runbooks for the top ten incident types.
- **M6-MON-03** - Backups and timed restore drill (never cut). Size: M - Owner: Both - Deps: M6-INF-02
  - [ ] PITR, daily snapshots retained 35 days, cross-region encrypted copy, S3 versioning; a timed restore into a fresh environment is executed and recorded against RPO 15 min / RTO 4 h; quarterly repeat scheduled.
- **M6-MON-04** - Load test and capacity model. Size: M - Owner: Claude - Deps: M6-INF-03
  - [ ] Load tests approximate one cell at 500 active tenants, 2M assets and 100 requests/s sustained; capacity limits and cost per 1,000 assets and per tenant are measured for the gross-margin model.

### E6.5 Security and compliance

- **M6-SEC-01** - Isolation verification on the real stack. Size: M - Owner: Claude - Deps: M6-INF-02
  - [ ] The full isolation suite (direct-partition, NULLIF, negative control) runs against the staging cell through the production PgBouncer configuration; role audit confirms `app` has no BYPASSRLS and no privileges on partitions in RDS.
- **M6-SEC-02** - External penetration test. Size: L - Owner: Both - Deps: M6-SEC-01, F-21
  - [ ] Scope document (tenant isolation first, then auth, files, webhooks, import) delivered to the vendor with two test tenants; test runs on staging; all critical/high findings fixed and retested; zero open cross-tenant findings before launch.
- **M6-SEC-03** - DAST, WAF and hardening. Size: M - Owner: Claude - Deps: M6-INF-03
  - [ ] Nightly DAST against staging; WAF managed rules and bot control on CloudFront; ASVS L2 checklist complete; CSP/HSTS verified.
- **M6-SEC-04** - Compliance pack. Size: M - Owner: Both - Deps: F-11, F-20
  - [ ] Trust/security page, DPA, subprocessor list, incident-response plan with 72 h notification, access-review process; compliance-automation tooling connected and policies adopted for SOC 2 Type I readiness.

### E6.6 SSO add-on

- **M6-SSO-01** - SAML via the SSO vendor. Size: L - Owner: Claude - Deps: M1-TEN-08, F-18
  - [ ] SSO behind an adapter (vendor swappable); per-tenant SAML connection setup, JIT provisioning with role mapping, domain verification, enforce-SSO setting; entitlement-gated (Pro add-on, Enterprise included).
- **M6-SSO-02** - SCIM directory sync (Could). Size: L - Owner: Claude - Deps: M6-SSO-01
  - [ ] Directory sync add-on provisioning/deprovisioning users and groups through the vendor; deprovisioned users lose sessions immediately.
- **M6-SSO-03** - SSO admin UI and docs. Size: M - Owner: Both - Deps: M6-SSO-01
  - [ ] Guided setup with IdP-specific instructions (Entra ID, Google Workspace, Okta) and a test-login step; per-connection add-on shown in billing.

### E6.7 Mobile launch

- **M6-MOBL-01** - App Review demo tenant. Size: M - Owner: Claude - Deps: M6-TOPS-01
  - [ ] Permanent Cloud demo tenant with a non-expiring, no-MFA reviewer account, resettable and free of real data; reviewer notes and setup QR prepared.
- **M6-MOBL-02** - Store submission. Size: L - Owner: Both - Deps: M3-QA-02, M6-MOBL-01, F-24
  - [ ] Apple 4.8 and account-deletion decisions implemented in the app; listings, screenshots, privacy forms, support/privacy URLs submitted for both stores; approved builds released (public or unlisted distribution).
- **M6-MOBL-03** - Push notifications (Should, Cloud only). Size: M - Owner: Claude - Deps: M6-MOBL-02
  - [ ] Expo push via the worker with tenant-scoped device tokens removed on logout/revocation; payloads contain ids and generic text only; opt-in per user.
- **M6-MOBL-04** - Production OTA channel. Size: S - Owner: Both - Deps: M3-QA-03
  - [ ] Staged rollout staging to production channel with signed updates, fixes only; rollback procedure rehearsed.

### E6.8 Go-to-market and launch

- **M6-GTM-01** - Public docs, pricing and migration content. Size: L - Owner: Both - Deps: M5-API-04, F-23, F-25
  - [ ] Public docs site, changelog, pricing page ("no minimum band", "retired assets don't count", API on every tier), "Migrate from Snipe-IT" guide, Google Admin import guide; comparison pages reviewed for facts and legal.
- **M6-GTM-02** - Support process. Size: S - Owner: Both - Deps: F-27
  - [ ] Support inbox and ticket workflow, response targets per tier, incident communication templates.
- **M6-LAUNCH-01** - Launch readiness review. Size: M - Owner: Both - Deps: all M6 stories except LAUNCH-02
  - [ ] Go/no-go checklist covering pen-test closure, restore drill, store approval, billing in live mode, status page, support readiness, DPA and legal pages; open risks accepted in writing.
- **M6-LAUNCH-02** - M6 founder acceptance (UX). Size: S - Owner: Founder - Deps: M6-LAUNCH-01
  - [ ] Founder completes the exit-criteria script as a new customer, end to end, including a real payment refund test.

---

## 8. Founder-only tasks (human track)

These cannot be done by Claude and several have long external lead times, so their **start-by** date is earlier than the milestone that needs them. "Start by" is the latest start that still avoids blocking the story; start earlier when cheap.

| ID | Task | Start by | Needed before | Lead time / notes | Blocks |
|---|---|---|---|---|---|
| F-01 | GitHub organisation and repository, 2FA on all accounts, branch protection and required checks, Actions enabled | Sprint 0 | M1 start | Hours | S0-REPO-01, M1-CI-01 |
| F-02 | Dev environment and test hardware: Docker Desktop, Node 24, pnpm; USB keyboard-wedge barcode scanner (and optionally Bluetooth), a label printer or laser printer plus label sheets (Avery 5160 / A4 3x8 / 2x1 roll), one low-end Android phone, one older iPhone, a current phone of each OS | Order during M1 | M2-TAG-04 (hardware), M3-QA-01 | 1-2 weeks shipping | M2 acceptance, M3 device matrix |
| F-03 | Working product name, domain registration and DNS provider, business email on the domain | Sprint 0 (working name); final name/trademark check by M3 | Apple/Google org enrollment (M2), M4 registry/docs naming | Domain: same day; trademark search: days | F-05, F-06, F-07, M4-REL-02, M6 launch |
| F-04 | Confirm legal entity, bank account, business address, tax IDs exist (prerequisite for D-U-N-S, store org accounts, Stripe) | Sprint 0 | M1 end | If an entity must be formed: weeks | F-05, F-06, F-07, F-17 |
| F-05 | Request a D-U-N-S number for the legal entity (free) | Start of M1 | Apple/Google enrollment in M2 | Can take weeks (verify current turnaround) | F-06, F-07 |
| F-06 | Apple Developer Program organisation enrollment (needs entity, D-U-N-S, website, domain email) | Start of M2 | M3 week 1 (TestFlight internal builds) | Verification can take 1-2+ weeks | M3-MOB-02 |
| F-07 | Google Play Console organisation account; check current closed-testing requirements for new accounts and plan for them | Start of M2 | M3 week 1 (internal testing) | Verification days to weeks | M3-MOB-02 |
| F-08 | Expo account and EAS. The free plan covers M3 development builds. Subscribe to the EAS Production plan (about $199/month plus usage, budgeted) before enabling OTA code signing (M3-QA-03); if OTA is not needed before launch, deferring to M6 saves cost: founder decision | Start of M3 | M3-QA-03 (or M6-MOBL-04) | Immediate | OTA, signed updates |
| F-09 | Sample data: a real (anonymised) Google Admin ChromeOS device export and a real asset spreadsheet from the founder or a friendly organisation | Start of M2 | M2-IMP-06, M2-IMP-09 | Depends on contacts; ask early | Import acceptance |
| F-10 | Design-partner recruitment: target list of 30, discovery interviews using the decision-20 questions, commit 5-10 partners (K-12/nonprofit/SMB IT, at least some with Google Admin and some currently on Snipe-IT) | List during M1, outreach during M2-M3 | Signed partners by start of M4 | Weeks; partners need a pilot window | M4-SHA-05 |
| F-11 | Legal documents with lawyer review: Terms of Service, Privacy Policy, DPA template, subprocessor list, self-hosted commercial licence/EULA, Community licence terms, design-partner agreement, security disclosure policy | Engage lawyer by end of M2; drafts by M3 | First partner install (M4) | 2-6 weeks incl. review | M4-SHA-05, M6-SEC-04 |
| F-12 | Generate and secure the licence-signing (Ed25519) and cosign key pairs: offline or hardware-backed custody, encrypted backups in two places, written rotation plan | Start of M4 | M4-LIC-03, M4-REL-01 | Days; losing the key forces a re-issue to every customer | Licence issuing, signed releases |
| F-13 | Distribution accounts: private container registry (GHCR org or ECR) with per-customer credentials, docs hosting, support@ mailbox | Start of M4 | M4-REL-02 | Hours | M4 release |
| F-14 | A clean Linux VM (and ideally one partner-like host) for manual install and upgrade rehearsals | M4 week 1 | M4-SHA-06 | Hours | M4 acceptance |
| F-15 | Brand assets: logo, app icon, colour approval, store screenshots source | M3 | M6-MOBL-02, M6-GTM-01 | Design time | Store listing, docs site |
| F-16 | AWS: organisation with separate accounts, root MFA, billing alarms, budget, support plan; seek startup credits | Start of M5 | M6-INF-01 | Account setup days; credits weeks | All M6 infra |
| F-17 | Stripe account with business verification, tax settings, bank payout | Start of M5 | M6-BILL-01 | Verification days to weeks | Billing |
| F-18 | SSO/SCIM vendor (WorkOS or alternative): evaluate and negotiate volume pricing; keep the add-on priced above vendor cost | Evaluate in M5, sign in M6 | M6-SSO-01 | Sales cycle days to weeks | SAML/SCIM add-on |
| F-19 | Amazon SES production access request and domain authentication (SPF/DKIM/DMARC) | Early M6 | M6-INF-05 | Days; can be rejected and resubmitted | Cloud email |
| F-20 | Compliance automation platform and auditor selection (SOC 2 Type I at GA, Type II window after) | Start of M5 | M6-SEC-04 | Weeks to engage an auditor | Trust page, Type I |
| F-21 | External penetration test: select vendor, scope (multi-tenant isolation first), budget, book a slot | Book at start of M5 | M6-SEC-02 | Vendor queues are commonly 4-8 weeks | Launch |
| F-22 | Monitoring and ops accounts: Sentry, Grafana Cloud or Datadog, status page, on-call/paging | Start of M6 | M6-MON-01 | Hours | Monitoring |
| F-23 | Pricing validation with design partners (willingness to pay vs Snipe-IT hosted, self-host demand) and the final pricing decision | Interviews through M4-M5 | M6-GTM-01, M6-BILL-01 | Needs partner data | Pricing page |
| F-24 | Store listing work: descriptions, screenshots, privacy policy and support URLs, age rating, privacy/data-safety answers, reviewer notes | Draft during M3, finish in M6 | M6-MOBL-02 | Review cycles can take days per round | App approval |
| F-25 | Marketing site and docs-site domain/hosting, comparison-page legal review | M4 (docs), M6 (marketing) | M6-GTM-01 | Days | Launch |
| F-26 | Acceptance sessions: block time at the end of each milestone for `Mn-UX-01` and run it with real data | Each milestone end | Milestone close | Half to one day each | Milestone close |
| F-27 | Support operations: inbox, response targets, incident communication templates, on-call plan | M6 | M6-GTM-02 | Days | Launch |
| F-28 | Business insurance (cyber/tech E&O) before paid Cloud customers | M5 | M6 launch | Days to weeks | Launch |
| F-29 | Decide interim security review before design partners run M4 on real data (see section 12, question 2) | End of M3 | M4-SHA-04 | Decision only | M4 |
| F-30 | Decide product name and primary colour before M3 store testing (placeholders "Asset Tracker" and blue #2A55D6 / #7AA2FF; see `docs/design/design_system.md` section 11) | M3 start | M3-MOB-02 (first TestFlight and Play internal builds) | Decision only; a rename touches one config | M3-MOB-02, M3-QA-02 |

---

## 9. Cross-cutting: security, tenancy, CI gates, observability

### 9.1 Standing rules (apply to every story from M1)

1. Tenant data is reached only through `withTenantTx` and `TenantRepository`; the driver is importable only inside `tenancy`.
2. Every tenant table is created with `createTenantTable`, passes the schema lint, and is covered by the two-tenant harness before merge. No exceptions; a table that cannot be tenant-scoped is classified `non-tenant` with a written reason.
3. Every route is registered with the route-replay harness and declares a permission; every state-changing route writes audit and outbox rows in the same transaction.
4. Job payloads carry ids only; handlers run inside a tenant transaction.
5. Migrations are expand/contract; a backfill iterates tenants and sets the tenant context per run (FORCE makes an unscoped owner see 0 rows).
6. Never cut (plan 5.1/5.4): RLS and the isolation harness, the audit log, the external pen test, backups with a tested restore.

### 9.2 Tenancy and security stories (where they live)

| Concern | Story | Milestone |
|---|---|---|
| Policy form `NULLIF(current_setting('app.tenant_id', true), '')::uuid` in `USING` and `WITH CHECK`, wrapped in `(SELECT ...)`, plus FORCE and leading-`tenant_id` index | M1-TEN-01 | M1 |
| `withTenantTx`, no session state, driver import ban | M1-TEN-02 | M1 |
| Schema lint (policy shape, FORCE, security_invoker, no SECURITY DEFINER, composite FKs, role audit, partition privileges) | M1-TEN-03 | M1 |
| Isolation harness direct on PG 16 and 18 with route replay | M1-TEN-04 | M1 |
| Isolation suite through PgBouncer 1.26.1+ with `pool_size=1` negative control, failed-tx case, NULLIF case | M1-TEN-05 | M1 |
| Partition rule: grants on parents only, partitions created by `migrator`, direct-partition test expects 42501 | M1-TEN-06 | M1 |
| pg-boss rules: no LISTEN/NOTIFY behind the pooler, migrator owns schema, ids-only payloads, transactional enqueue | M1-PLAT-06 | M1 |
| Pre-tenant lookups in `identity` schema | M1-TEN-08 | M1 |
| Envelope encryption with tenant/purpose context | M1-PLAT-08 | M1 |
| Upload scanning, type allow-list, tenant-prefixed keys | M2-FILE-01..03, M2-SEC-02 | M2 |
| Harness extended per new table/route | M2-SEC-01, M5-API-06 | M2, M5 |
| Mobile token security (PKCE, rotation, reuse detection) | M3-AUTH-01 | M3 |
| Isolation suite re-run after every upgrade path | M4-REL-05 | M4 |
| Pre-user security review | M4-SHA-04 | M4 |
| API keys, SSRF-safe outbound, security_invoker report views | M5-API-01, M5-HOOK-02, M5-RPT-01 | M5 |
| Isolation on the real cloud stack, pen test, DAST/WAF | M6-SEC-01..03 | M6 |

### 9.3 CI gates

Gates are cumulative: once introduced they are required status checks on `main` forever. Each gate is a hard failure unless marked nightly.

| Gate | Introduced | Notes |
|---|---|---|
| Lint, typecheck, module-boundary lint, unit tests | M1-CI-01 | Turborepo cache; DB-driver import ban |
| Schema lint | M1-TEN-03 | Runs on a freshly migrated database |
| Isolation suite, direct, PostgreSQL 16 and 18 | M1-TEN-04, M1-CI-02 | Includes route replay |
| Isolation suite through PgBouncer with negative control and direct-partition test | M1-TEN-05/06 | Fails if the negative control stops detecting the leak |
| SAST, SCA, secret scan | M1-CI-03 | Allow-list entries expire |
| Image build, Trivy (fixable critical/high), SBOM | M1-CI-03/04 | Weekly rebuild for base-image patches |
| OpenAPI emission and generated-client diff | M1-PLAT-03 | Fails if the client is stale |
| Web static-export feature check and deep-link Playwright tests | M1-WEB-10 | Forbids `proxy.ts`, rewrites, redirects, headers, Server Actions |
| Compose e2e smoke (Playwright) | M1-WEB-11 | Traces on failure |
| Performance budgets (nightly): list < 500 ms, search < 200 ms, tag lookup/scan < 150 ms, check-out < 300 ms, import throughput, dry run | M1-CI-05, M2-OPS-01 | p95 on 2 x 50k-asset tenants |
| Mobile typecheck/tests and duplicate-React check | M3-MOB-01 | Only on mobile-path changes |
| Licence state-machine tests | M4-LIC-02 | Valid, 90%, expiring, grace, read-only, tampered, unknown `kid`, clock rollback |
| Fresh-install and N-2 upgrade tests, mobile TLS test | M4-REL-04/05/06 | On every semver tag (not every PR) |
| Migration classifier (expand/contract only) | M4-REL-03 | Contract steps only in a later release |
| UI-API parity and API conformance suite | M5-API-03/05 | 100% of UI actions have an operation |
| DAST (nightly) | M6-SEC-03 | Against staging |

### 9.4 Observability basics

- **M1:** JSON logs with `request_id`, `tenant_id`, `actor_id`; redaction tested; OpenTelemetry traces with `tenant_id` as an attribute (never a metric label); Prometheus `/metrics` (RED per route, DB pool, queue depth); `/healthz` and `/readyz`; optional Sentry (M1-OPS-01).
- **M4:** operator-facing: stdout logs, `/metrics`, optional OTLP, support bundle (M4-BND-02).
- **M6:** full stack: dashboards, SLOs (availability 99.9% proposal), alarms, on-call, synthetic checks, status page, per-tenant usage views, runbooks (M6-MON-01..04).
- **Always:** every outbound call (webhook, SMTP, Snipe-IT, Stripe) logs request id, target host (not full URL with secrets) and outcome.

---

## 10. Sprint 0 checklist (the current work)

Goal: leave Sprint 0 with everything M1 needs to start without further decisions: a buildable empty repo, a reviewed data model and API contract draft, a design system and wireframes the founder has signed off, and this backlog agreed. Planning documents already exist: `docs/01_feature_matrix.md`, `docs/02_product_plan.md`, `docs/03_system_architecture.md`, `docs/04_validation_report.md`, `docs/validation/`.

Status legend: [x] done, [~] in progress, [ ] todo.

**Repo scaffold**
- [ ] **S0-REPO-01** (Claude, after F-01) `git init`, GitHub remote, pnpm workspaces + Turborepo with empty `apps/api`, `apps/web`, `apps/mobile` (placeholder), `packages/api-client`, `packages/schemas`, `packages/ui-tokens`; Node 24 pin; proprietary `LICENSE`, `.gitignore`, `.editorconfig`, `CODEOWNERS`, PR template containing the Definition of Done checklist; a hello-world CI workflow green on `main`.
- [ ] **S0-REPO-02** (Both) Founder machine verified: Docker Desktop running, Node 24, pnpm, Git Bash; `docker run hello-world` and a throwaway `postgres:18` container start.
- [ ] **S0-SPK-01** (Claude) Preserve the RLS/PgBouncer spike as reusable test fixtures: the spike's files (docker-compose, `pgbouncer.ini`, `init/01_schema.sql`, `rls_test.mjs`, `boss_test.mjs`) lived in a session scratchpad, so copy or recreate them under the repo (for example `spikes/rls_pgbouncer/`) before M1-TEN-04/05 reuse them.

**Data model and API contract draft**
- [ ] **S0-DATA-01** (Both) Data model draft for M1 and M2 entities: ERD, column lists, tenancy classification (tenant / non-tenant / partition), keys and composite FKs, state-type enum, person vs login-user shape, location path encoding options, loaner-pool options; proposed path `docs/06_data_model.md`. Resolves the status state-type inconsistency (question 3, section 12).
- [ ] **S0-API-01** (Claude) API contract draft: resource list for M1-M2, URL conventions, problem types, auth (cookie and bearer), pagination/filter/idempotency/ETag rules, permission catalogue, OpenAPI skeleton; proposed path `docs/07_api_contract.md` plus a draft OpenAPI file consumed later by M1-PLAT-03.
- [ ] **S0-ADR-01** (Both) Decision stubs with a recommendation each, ready for founder sign-off: data access layer (Kysely vs Drizzle), migration tool, boundary-lint tool, i18n library for static export, web detail-route strategy, breached-password provider, loaner-pool model, location path encoding, working product name.

**Design system and wireframes**
- [ ] **S0-DES-01** (Both) Design system v0 in `packages/ui-tokens`: colour (light/dark), type scale, spacing, radius, elevation, iconography, motion; component inventory with states; accessibility rules (WCAG 2.2 AA target); founder approves the visual direction.
- [ ] **S0-DES-02** (Both) Low-fidelity wireframes: M1 (login, MFA, nav shell, assets list with filters, asset detail/create, category + custom-field builder, settings, users) and M2 (location tree, check-out dialog, history timeline, import wizard, label sheet generator, loaner quick flow); founder sign-off.
- [ ] **S0-DES-03** (Both, can trail into M2) Mobile wireframes for M3 (home, scan, asset card, check-out, stocktake) so M3-MOB-05 starts with direction.

**Backlog and docs**
- [~] **S0-BKL-01** (Claude/Founder) This backlog (`docs/05_backlog.md`) written; founder reviews sizes, order and the open questions in section 12.
- [~] **S0-DOC-01** (Claude; another agent in progress) Update `docs/02_product_plan.md` and `docs/03_system_architecture.md` to the M1-M6 milestone language; add a doc map; keep a changelog line per change.
- [x] **S0-DOC-02** Validation reports and decisions 1-28 are in the plan.

**Founder actions that start now**
- [ ] F-01 GitHub org and branch protection; F-03 working name and domain; F-04 legal entity status check; F-05 D-U-N-S request (start of M1 at the latest).

**Sprint 0 exit:** S0-REPO-01, S0-SPK-01, S0-DATA-01, S0-API-01, S0-ADR-01, S0-DES-01, S0-DES-02 and S0-BKL-01 done; F-01 done. M1-REPO-01 can then start the same day.

---

## 11. Parked beyond M6 (not scheduled)

From the plan's confirmed cuts and later phases; not part of any milestone above. Listed so they are not silently lost.

- **v1.1 (after Cloud launch):** Intune + Entra ID sync and Google Admin ChromeOS device sync (connector SPI), Slack/Teams notifications, import undo (rollback; before-images already stored by M2-IMP-01), label template editor, self-hosted push relay (licence-gated), end-user acceptance/e-signature, passkeys, web installable PWA (Could), SAML slip-over if the team shrinks.
- **v2:** discovery agent and installed-software inventory, offline-first Expo app, Helm chart, air-gapped install, self-hosted SAML via Keycloak broker and SCIM, Vault/KMS key adapter, contracts, PM schedules, work orders (light), rules/approvals, no-code report builder, multi-company UI, custom roles.
- **v3+:** agentless/cloud/SaaS discovery, AI features, EU cell, ITSM connectors.

---

## 12. Open questions and ambiguities found in the plan (for founder decision)

1. **Closed beta vs milestones.** The plan runs a Cloud closed beta at about month 5 with 5-10 design partners; the new milestones put the first real users on the Self-hosted bundle (M4) and the Cloud launch at M6. Assumption used here: design partners run the Self-hosted bundle on their own host (or a founder-run Compose instance per partner) between M4 and M6, and the decision-20 keep/kill metrics are collected from those installs. Confirm, because "Cloud beta" and "Self-hosted beta" produce different support loads.
2. **Security assurance before M4.** M4 puts real customer data on installs before the external pen test (M6). This backlog adds an internal review (M4-SHA-04). Decide whether to pay for an interim external review of tenant isolation before partners install (F-29).
3. **State types.** Plan 5.3 lists "ready, assigned, in repair, archived/disposed, lost"; plan 7.1 lists "deployable, deployed, pending, archived, lost". M1-REG-03 uses ready, assigned, pending, in_repair, archived, lost; confirm in S0-DATA-01. **Resolved 2026-11-17 — see docs/engineering/decisions.md.**
4. **"MFA-ready" in M1.** Interpreted as TOTP fully implemented with per-tenant enforcement; passkeys deferred. Confirm.
5. **OIDC social login (a plan Must)** is not named in any milestone. Placed in M4 (Self-hosted needs it); Cloud reuses it in M6. If Cloud design partners need Google/Microsoft login earlier, move M4-SHA-01 into M2.
6. **Stocktake (a plan Must)** is not named in M2 or M3. Placed in M3 because mobile scanning is its main use, with web screens alongside. **Resolved 2026-11-17 — see docs/engineering/decisions.md.**
7. **Items not named in any milestone** and where they were placed: attachments/ClamAV and notifications (M2, needed by repair log, check-in photos and loaner alerts), vendors (M1, referenced by assets), saved views and list export (M2), command palette (M1), location scoping (M2, Should), straight-line depreciation (M5, Should), full tenant export (M4, because Self-hosted guarantees export in read-only mode), audit log write path (M1) vs UI (M5).
8. **Idempotency-Key and ETag** are pulled forward into M1-PLAT-02 although "REST API completeness" is M5, because M2 check-out and the M3 retry queue need them. M5 completes parity, API keys, rate limits and docs.
9. **Signup and onboarding wizard.** Plan lists tenant signup under the MVP; milestones place self-serve signup at M6 (Cloud) and a bootstrap CLI/first-run at M1/M4. Confirm that M1-M5 need no self-serve signup.
10. **SCIM in M6.** The milestone says "SAML/SCIM add-on", but the plan makes SCIM a v2 item; M6-SSO-02 is therefore marked (Could).
11. **Unlisted breached-password check.** Online breach lists conflict with offline Self-hosted installs; M1-AUTH-02 uses a bundled local list plus an optional online provider.
12. **N-2 upgrade test is vacuous early.** With no prior releases there is nothing to upgrade from; M4-REL-05 cuts early pre-release tags to make the test meaningful.
13. **QR links and mobile deep links.** Labels encode `<PUBLIC_URL>/s/<code>`; one store app serves many self-hosted domains, so iOS universal links/Android app links cannot be pre-associated with every customer domain. Assumption: the phone camera opens the web landing page, and in-app scanning uses `expo-camera`. Confirm that is acceptable.
14. **EAS Production plan timing.** The plan implies it is needed for OTA code signing from M3; if OTA is unused until launch, paying from M6 saves cost (F-08). Founder decision.
15. **Spike artifacts.** The RLS/PgBouncer spike files were created in a session scratchpad, not the repo (S0-SPK-01).
16. **Product name.** Documents use "Asset Tracker" as a placeholder; the name affects the domain (F-03), registry naming (M4-REL-02), store listings and licence customer records.
17. **Calendar mapping.** The plan's month markers assume 5-6 engineers; this backlog has no dates. Re-baseline after M1 using actual velocity (sizes S/M/L converted at 0.5/1.5/4 working days) and compare with the plan's GA target.
18. **Data access layer and migration tool** remain open in architecture 8.5; M1-DB-01 decides them.

---

## 13. Re-baselining

After M1-UX-01, record actual days spent per size class and recompute remaining effort; publish the result as a changelog entry at the top of this document. Scope changes between milestones are made by editing this file (add stories with new IDs, mark dropped ones `DROPPED`), never by silently reusing IDs.
