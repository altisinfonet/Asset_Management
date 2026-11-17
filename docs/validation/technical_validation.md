# Technical validation of the planned architecture

Date: 2026-11-17. Scope: `docs/03_system_architecture.md` (referred to as "arch") and plan section 6 in `docs/02_product_plan.md` (referred to as "plan"). Each item: Assumption, Finding, Verdict (Confirmed / Corrected / Risk), source. Version numbers below were read from official docs, npm registry metadata or vendor pages on 2026-11-17. Where an official page did not state a point and the answer rests on general knowledge or secondary sources, that is said explicitly ("unverified").

## Verdict summary

| # | Topic | Verdict | One-line result |
|---|---|---|---|
| 1 | PostgreSQL 16 plus app-side UUIDv7 | Corrected | PG 18 has native `uuidv7()` and is on RDS (since 2025-11-14) and Aurora (since 2026-06). Start on 18, not 16. Keep app-side UUIDv7 as the single code path. |
| 2 | RLS semantics | Confirmed (one wording fix) | FORCE, BYPASSRLS, `security_invoker`, partitions, `set_config(...,true)` all behave as the arch states. FORCE never constrains superuser or BYPASSRLS roles. |
| 3 | RDS Proxy and `set_config` pinning | Risk | AWS docs do not say that `set_config(...,true)` is unpinned on PostgreSQL. The documented "SET LOCAL does not pin" line sits in the MySQL section. No pinning filters on PostgreSQL. Make PgBouncer the default. |
| 4 | PgBouncer transaction mode | Confirmed | Transaction-scoped `set_config` is safe. Protocol-level prepared statements since 1.21. Current is 1.26.1. Pin to 1.26.1 or later. |
| 5 | pg-boss and Graphile Worker | Corrected | pg-boss is pooler-safe: it uses `pg_advisory_xact_lock`, and LISTEN is optional on a separate direct client. Graphile Worker LISTEN claim is right, and no poll-only option exists. |
| 6 | Next.js static export | Corrected / Risk | Arch's "CloudFront rewrite to one shell page" dynamic-route design is not a documented pattern. Use query-param or catch-all client routing. Middleware is now "Proxy" (unsupported in export). Headers/redirects/rewrites unsupported. |
| 7 | Serwist | Confirmed | Active (9.5.15, published 2026-11-17). Two packages: `@serwist/next` (webpack) and `@serwist/turbopack`. Static-export fit needs a spike. |
| 8 | Expo SDK, camera, push, EAS | Corrected | SDK 58. Barcode types confirmed. EAS Update code signing needs the Production plan ($199/month) or Enterprise, not Starter. Push limits as listed. |
| 9 | Expo + pnpm + Turborepo | Confirmed | Isolated installs supported since SDK 54. `nodeLinker: hoisted` remains the fallback. |
| 10 | NestJS + Fastify | Confirmed | NestJS 12.5.1, Fastify 5.12.8. v12 is ESM-first, so test tooling changes. |
| 11 | iOS Safari BarcodeDetector | Confirmed | Still disabled by default through iOS 27.2. ZXing fallback is needed. |
| 12 | Caddy without public DNS | Confirmed with Risk | `tls internal` works, but the mobile app will not trust the internal CA by default (especially Android). Default to customer-supplied certs. |
| 13 | cosign and Ed25519 | Confirmed with caveats | Key-based offline verify works in cosign v3. Node `crypto.sign/verify` supports Ed25519. Replace RFC 8785 canonicalisation with a JWS-style signed payload. |
| 14 | Self-hosted SAML libraries | Risk | node-saml: 4 advisories, 2 Critical in July 2025. samlify: 10 advisories, many on 2026-10-20 including a Critical. Treat "built-in SAML v2" as a high-risk item. |
| 15 | SSO vendor cost vs $149 Pro | Risk (margin) | WorkOS SSO is $125 per connection per month, Directory Sync another $125. One SAML connection is about 84% of Pro base price. SAML plus SCIM exceeds it. |
| 16 | App Store / Play policy | Risk (manageable) | Needs a reviewer demo tenant, account-deletion and Sign in with Apple checks, organisation Play account, and an OTA policy limit. Private Custom Apps do not suit a single shared app. |

---

## 1. PostgreSQL version and UUIDv7

**Assumption (arch 1, 7, 8.2, Appendix A.12; plan 6.2, 6.15):** Postgres 16; UUIDv7 generated in the app "because PG16 lacks it".

**Finding**
- Supported majors on 2026-11-17: 14 (final release 2026-11-12), 15 (EOL 2027-11), 16 (EOL 2028-11-09), 17 (EOL 2029-11), 18 (EOL 2030-11-14). PostgreSQL 19 is in RC; the RC 1 notice schedules GA for 2026-11-19, conditional on no further delay.
- PG 18 ships `uuidv7()` (and `uuidv4()` alias, `uuid_extract_version()`); `uuid_extract_timestamp()` handles v7 in 18. PG 17 and earlier have no native `uuidv7()`. `gen_random_uuid()` (v4) is core since 13. The PG docs page did not itself state per-function introduction versions for 18, so the intro versions came partly from release history knowledge; the existence of `uuidv7()` in current docs is confirmed.
- Amazon RDS for PostgreSQL: 18 released on RDS 2025-11-14; 17 on 2024-11-14; 16 on 2023-11-20. RDS end of standard support: 16 = 2029-02-28; 17 = 2030-02-28; 18 = 2031-02-28. RDS ships major version .1 within 30 days of community release, so PG 19 on RDS is not realistic before about Q1 2027 and should not be a launch target (GA planned about month 8, mid-2027).
- Aurora PostgreSQL 18 reached GA on 2026-06-11 (18.3); 18.4 followed in August 2026.
- Planning point: PG 16 community EOL (2028-11) falls about 16 months after planned GA, which forces a major-version upgrade (for Cloud and for self-hosted BYO Postgres) very early in the product life.
- PG 18 also adds B-tree skip scan (per the Aurora launch note), relevant to composite `(tenant_id, ...)` indexes.

**Verdict: Corrected.** The premise ("PG16 lacks UUIDv7") is right, but PG 16 should not be the target.

**Recommendation**
- Cloud: RDS for PostgreSQL 18 (latest minor; RDS lists 18.6 as of 2026-08-25, community lists 18.7). Do not wait for 19.
- Self-hosted: bundle `postgres:18`; document BYO support for 16, 17, 18 (N-2 matches the product's own N-2 release policy). CI matrix: 16 and 18 minimum.
- Keep UUIDv7 generation in the app as the single code path (works on every supported PG version and for client-created ids in v2 offline). Optionally add `DEFAULT uuidv7()` only as a safety net where the server is 18+. Verify the official `postgres:18` image PGDATA/volume-mount layout in the compose bundle (image layout changed for 18; unverified here).
- Note PG 18 itself needs no RLS design change.

Sources: https://www.postgresql.org/support/versioning/ ; https://www.postgresql.org/docs/current/functions-uuid.html ; https://docs.aws.amazon.com/AmazonRDS/latest/PostgreSQLReleaseNotes/postgresql-release-calendar.html ; https://aws.amazon.com/about-aws/whats-new/2026/06/amazon-aurora-postgresql-major-version-18 ; PG 19 RC 1 announcement https://www.postgresql.org/about/news/postgresql-19-rc-1-3409/

---

## 2. RLS details

**Assumption (arch 5.3, Appendix A.10; plan 6.1):** FORCE RLS applies to owners; app role is non-owner, no BYPASSRLS; `security_invoker` views (PG15+); partition parent policies do not protect direct partition access; `set_config(..., true)` is transaction-scoped.

**Finding**
- FORCE: "the table owner bypasses row security by default; FORCE makes the owner subject to policies. Superusers and roles with BYPASSRLS always bypass row security, regardless of FORCE." Confirmed, and consistent with arch Appendix A.10.
- Unique, primary-key and foreign-key checks always bypass row security ("covert channel" leak warning). This supports the arch's composite `(tenant_id, id)` FKs and per-tenant uniqueness. Policies are also not applied during internal referential-integrity checks or constraint validation.
- `security_invoker = true`: base-relation policies and permissions of the invoking user are used; the default uses the view owner's. The CREATE VIEW page does not state the introduction version in the fetched text; PG 15 is well known (unverified in the page, but consistent with the plan and arch).
- `ENABLE ROW LEVEL SECURITY` with no policy gives default-deny. `ALTER TABLE` docs do not say whether ENABLE/FORCE recurse to partitions or inheritance children. Treat as not recursing and set RLS and FORCE on every partition explicitly.
- Partitioned tables: official pages fetched do not describe parent-versus-child policy behaviour. PG mailing-list and commit history (RLS support for partitioned tables added in PG 10) and the inheritance documentation indicate: querying through the parent applies the parent's policies; direct access to a partition applies the partition's own policies (or none if RLS is not enabled on the partition). The arch statement "policies on a partitioned parent do not protect direct queries on a child partition" matches this. Secondary source only, so keep the arch's CI test for it. Also watch default privileges: if `ALTER DEFAULT PRIVILEGES` grants table rights to the app role, new partitions inherit grants and become directly queryable. Revoke or exclude partitions from default grants.
- `set_config(setting, value, is_local=true)`: "the new value will only apply during the current transaction" (same as SET LOCAL). Outside an explicit transaction the effective scope is that single statement, so the explicit `BEGIN` in `withTenantTx` is required, as the arch states. After a transaction in which a custom GUC was set locally, later reads in the same session return an empty string (not NULL); this is known behaviour and the arch's `nullif(...,'')` handles it.
- `row_security = off` does not bypass RLS; it errors if a policy would filter. Useful for per-tenant exports running under the app role.

**Verdict: Confirmed.** Wording fix: arch 5.3 "Owner / superuser bypass" row is correct; add that FORCE does not constrain superuser or BYPASSRLS (already in Appendix A.10, repeat in 5.3).

Sources: https://www.postgresql.org/docs/current/ddl-rowsecurity.html ; https://www.postgresql.org/docs/current/sql-createpolicy.html ; https://www.postgresql.org/docs/current/sql-altertable.html ; https://www.postgresql.org/docs/current/sql-createview.html ; https://www.postgresql.org/docs/current/functions-admin.html ; RLS-on-partitions history https://www.postgresql.org/message-id/14a1841e-f5d2-1911-36f4-7ebbd388daa6%40joeconway.com

---

## 3. Amazon RDS Proxy and connection pinning

**Assumption (arch 7.1, A6, Appendix A.8; plan 6.1):** RDS Proxy pins on session-level SET; a staging test must confirm `set_config(..., true)` inside a transaction does not pin.

**Finding**
- AWS PostgreSQL pinning list: `SET` commands; `PREPARE/DISCARD/DEALLOCATE/EXECUTE`; temp objects; cursors; LISTEN; loading library modules; sequence functions such as `nextval`; session advisory locks (`pg_advisory_xact_*` do not pin); "Setting a parameter, or resetting a parameter to its default. Specifically, using SET and set_config commands to assign default values to session variables."; `DISCARD ALL` reset queries; any statement text over 16 KB.
- The sentence "RDS Proxy does not pin connections when you use SET LOCAL" appears in the MySQL/MariaDB section, not the PostgreSQL one. The PostgreSQL section lists "Using SET commands" without exempting SET LOCAL. The MySQL limitations section says "SET LOCAL can change the connection state without causing pinning" (MySQL only).
- AWS says "for PostgreSQL setting a variable leads to session pinning" and that "RDS Proxy doesn't support session pinning filters for PostgreSQL", so there is no opt-out.
- No AWS statement on `set_config(name, value, true)`. A third-party blog claims SET LOCAL pins; the AWS page does not. Unresolved, so the arch's decision to test it in staging is right.
- Other PostgreSQL limits: no `CancelRequest` support; port fixed at 5432; only protocol 3.0; proxy needs the default `postgres` database; the proxy cannot attach to a read replica; 20 proxies per account.
- Statement text over 16 KB pins: bulk imports with big multi-row INSERTs will hit this.
- Pinning is observable (CloudWatch `DatabaseConnectionsCurrentlySessionPinned`).

**Verdict: Risk.** Not confirmed safe.

**Recommendation:** Make PgBouncer (transaction mode, 2 Fargate tasks behind an internal NLB) the default pooler and RDS Proxy the optional alternative, adopted only if a staging test shows zero pinned connections under the real driver and a 16 KB-statement test. Until connection counts require a pooler, connect directly (arch already says so).

Sources: https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html ; https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy.html (limitations) ; https://aws.amazon.com/blogs/database/understanding-the-differences-between-pgbouncer-and-amazon-rds-proxy-for-postgresql-connection-pooling/

---

## 4. PgBouncer transaction pooling

**Assumption (arch 5.3, 8.2, 8.3):** `set_config(...,true)` inside explicit transactions is safe in transaction mode; CI runs isolation tests through PgBouncer; prepared statements supported in 1.21+.

**Finding**
- Feature matrix, transaction pooling: SET/RESET Never; LISTEN Never; session advisory locks Never; SQL `PREPARE/DEALLOCATE` Never; protocol-level prepared plans Yes (needs `max_prepared_statements` non-zero). `SET LOCAL` is not listed; it is transaction-scoped, so the server connection is clean after COMMIT/ROLLBACK. This is what the arch relies on.
- Protocol-level prepared statements arrived in 1.21.0 (2023-10-16). Latest release: 1.26.1 (2026-10-14).
- 1.26.0 tracks all parameters PostgreSQL reports by default (including `search_path` on PG 18+); 1.26.1 lets `ignore_startup_parameters` take precedence. 1.25.1 fixed CVE-2025-12819 (malicious `search_path` in startup packet when `track_extra_parameters` includes it with `auth_user`/non-schema-qualified `auth_query`). Pin to 1.26.1 or later.
- Driver caveat (general knowledge, unverified here): postgres.js defaults to named prepared statements; with PgBouncer either set `max_prepared_statements` or disable prepare. node-postgres uses unnamed statements unless `name` is given. Kysely/Drizzle over `pg` are fine.

**Verdict: Confirmed.** The two-pass CI (direct and via PgBouncer) in arch 8.2/8.3 is the right test. Add a case where a transaction fails mid-way (ROLLBACK) and the next borrower sees no tenant.

Sources: https://www.pgbouncer.org/features.html ; https://www.pgbouncer.org/changelog.html

---

## 5. pg-boss and Graphile Worker

**Assumption (arch Appendix A.7, 7.1):** pg-boss uses plain SQL polling with SKIP LOCKED and is pooler-safe; Graphile Worker needs LISTEN/NOTIFY and session mode.

**Finding**
- pg-boss current: 12.38.2 (npm, published 2026-11-10). Requires PostgreSQL 13 or later and Node 22.12 or later (or Bun). Maintained by one person per its README (bus-factor risk), actively developed.
- Source check of `src/plans.ts` and `src/db.ts` (master): internal serialization uses `pg_advisory_xact_lock` (transaction-scoped, pooler-safe) inside a transaction, with a `noAdvisoryLocks` option. Job claiming relies on `SKIP LOCKED`/row locks. LISTEN/NOTIFY is optional: a per-queue `notify` option (default false in migrations) and a dedicated `pg.Client` listener that "falls back to polling-only" if LISTEN fails; there is a 30-second polling backstop. A listener pointed at PgBouncer transaction mode would silently get no notifications, so give that client a direct connection or leave notify off.
- It also offers an HTTP proxy package (`@pg-boss/proxy`) for pooling or platform-compatibility cases.
- Graphile Worker current: 0.18.0 (npm, 2026-09-08; still pre-1.0). Its FAQ says LISTEN/NOTIFY is on by default, that pgBouncer "might pose an issue if it's not done in 'connection' mode" because events may not be received, and that polling-only is not an option today ("we don't currently have an option for that").

**Verdict: Corrected (wording).** The arch's pick of pg-boss is right, and "plain SQL polling with SKIP LOCKED" is correct for claiming. But pg-boss does use LISTEN/NOTIFY optionally and `pg_advisory_xact_lock` internally. The doc's Graphile Worker claim is accurate, with the nuance that with a pooler between the worker and DB, workers still work by polling but latency and event delivery degrade, and there is no supported poll-only switch.

**Recommendation:** Keep worker/scheduler/migrate on direct connections (arch 7.1 already). If `notify` is enabled for low latency, give pg-boss its own direct connection string. Add Node 22.12+ to the image baseline (NestJS 12 and Expo SDK 58 raise it too). Pin the pg-boss major and add a fallback plan (Graphile Worker or SQS) because of the single-maintainer risk.

Sources: https://github.com/timgit/pg-boss ; https://raw.githubusercontent.com/timgit/pg-boss/master/src/plans.ts ; https://raw.githubusercontent.com/timgit/pg-boss/master/src/db.ts ; https://registry.npmjs.org/pg-boss/latest ; https://worker.graphile.org/docs/faq

---

## 6. Next.js static export

**Assumption (arch 3, decision paragraph; plan 6.2):** Next.js App Router with `output: 'export'`; no rewrites/middleware at runtime; dynamic routes like `/assets/:id` served by one prerendered shell page selected by a CloudFront Function rewrite, id read client-side.

**Finding** (Next.js current is 16.4.6; docs page last updated 2026-08-09)
- Unsupported with static export: dynamic routes with `dynamicParams: true`; dynamic routes without `generateStaticParams()`; route handlers that rely on the Request; cookies; rewrites; redirects; headers; Proxy (formerly middleware, renamed in v16.0.0); ISR; image optimisation with the default loader; Draft Mode; Server Actions; intercepting routes.
- Supported: Server Components (run at build), Client Components with SWR, `next/image` with a custom loader (or unoptimized), GET route handlers with `export const dynamic = 'force-static'`.
- Proxy docs: "Static export: No."
- Dynamic route output is one HTML file per `generateStaticParams` entry; the docs' own nginx example rewrites `/blog/:id` to `/blog/:id.html`. An arbitrary runtime id with a single placeholder page is not a documented pattern. Community reports (a GitHub issue on `useParams()` with export; placeholder fallback libraries) suggest the placeholder approach is fragile: `useParams()` can return the placeholder, and client-side navigation to non-prerendered ids needs the RSC payload file. Unverified in official docs; run a spike before committing.
- Because `headers` is unsupported, response headers (CSP, HSTS) must come from CloudFront response-header policies and Caddy, not Next config. `trailingSlash` and `skipTrailingSlashRedirect` are available.

**Verdict: Corrected / Risk.** The static-export decision itself is valid. The dynamic-route mechanism needs replacing with something supported.

**Recommendation:** Use query-string detail routes (`/assets/view?id=...`) or a single optional catch-all page (`[[...path]]` with `generateStaticParams` returning the empty path) that hosts a client router (TanStack Router, React Router) for in-app routing; keep the CloudFront fallback only to serve `index.html` for unknown paths (SPA fallback). Document unsupported features as a CI lint (fail the build if `proxy.ts`, `rewrites`, server actions appear).

Sources: https://nextjs.org/docs/app/guides/static-exports ; https://nextjs.org/docs/app/api-reference/file-conventions/proxy ; https://github.com/vercel/next.js/issues/54393

---

## 7. Serwist

**Assumption (arch 3):** installable PWA via a Serwist service worker (Could).

**Finding:** Serwist 9.5.15 (core, `@serwist/next`, `@serwist/turbopack`), npm-modified 2026-11-17, so actively maintained. The Next.js guide covers the webpack plugin (`@serwist/next`); Turbopack has a separate guide and package. Next.js 16 uses Turbopack by default per its release notes (stated from knowledge; not re-verified), so the webpack-based path needs the webpack build flag. I could not fetch the Turbopack page (404 on the guessed URL) and found no statement about `output: 'export'` compatibility.

**Verdict: Confirmed (maintained); static-export compatibility unverified.** Keep PWA as Could (arch already does). If it is promoted, spike `@serwist/turbopack` against `output: 'export'` early; the service worker must be emitted as a plain static file.

Sources: https://serwist.pages.dev/docs/next/getting-started ; https://github.com/serwist/serwist/releases ; npm `serwist`, `@serwist/next`, `@serwist/turbopack`

---

## 8. Expo, EAS, push

**Assumption (arch 3, 8.3, 9; plan 6.5):** Expo app with expo-camera, expo-secure-store, EAS Build/Submit/Update with EAS Update code signing in MVP (arch Appendix B item 27); Expo push from the worker; expo-sqlite in v2.

**Finding**
- Current SDK: 58 (58.0.0 docs; npm `expo` 58.0.25, `expo-camera` 58.0.14, `expo-sqlite` 58.0.17, `expo-secure-store` 58.0.3). React Native 0.88, React 19.3. Minimum Node 22.13, Xcode 26.4 or later, minimum iOS 16.4, compileSdk 37 / targetSdk 36.
- expo-camera barcode types: `aztec, ean13, ean8, qr, pdf417, upc_e, datamatrix, code39, code93, itf14, codabar, code128, upc_a`. QR, Code128 and DataMatrix are all present. The docs give no per-platform matrix for live scanning; run a device test matrix for DataMatrix and Code128 on low-end Android and older iOS.
- EAS plans (expo.dev/pricing): Free $0 (15 Android + 15 iOS builds, 1,000 update MAU, low-priority queue, no code signing); Starter $19 + usage ($45 build credit, 3,000 MAU, no code signing); Production $199 + usage ($225 build credit, 50,000 MAU, code signing included); Enterprise from $1,000 (custom). EAS Submit is included in all plans (no separate price). Update MAU overage $0.005 per MAU above the included amount, tiered down at volume; 1 MAU = one install that downloaded at least one update in the billing cycle. Build overage: Android $1 (medium) or $2 (large), iOS $2 or $4.
- EAS Update code signing: "only available to accounts subscribed to the Production or Enterprise plans." Setup: generate keypair and certificate, embed the certificate in the binary, publish with `eas update --private-key-path`.
- Expo push service: 100 messages per request; 600 notifications per second per project; payload at most 4,096 bytes; 1,000 ticket IDs per receipts request; receipts kept 24 hours; FCM v1 credentials and an APNs key required; optional access token for enhanced push security; no SLA; "ok" means accepted by FCM/APNs, not delivered.
- Apple 2.5.2 (below) and Expo's own docs both put app-store compliance of OTA content on the developer.

**Verdict: Corrected** (code signing plan requirement) **plus a self-hosted Risk.**
- The arch's EAS Update code signing is correct and valuable, but it requires the $199/month Production plan from MVP. Add that to the cost model; Starter is not enough. Alternative (unverified, check Expo's custom-update-server docs): self-host the update endpoint using the open expo-updates protocol.
- Self-hosted push: push tokens belong to our Expo project. If enhanced push security is on, customer servers cannot send without a token from our account; if it is off, anyone who learns a token can push to that device. Plan 6.5/arch 3 treat push as "optional, off when air-gapped" but do not address this. Either route self-hosted pushes through a license-gated relay run by us (adds a phone-home), or disable push on self-hosted until designed.
- OTA MAU: every installed device that fetches an update counts, including devices belonging to self-hosted customers, since one store app serves both editions.

Sources: https://docs.expo.dev/versions/latest/ ; https://docs.expo.dev/versions/latest/sdk/camera/ ; https://expo.dev/pricing ; https://docs.expo.dev/eas-update/code-signing/ ; https://docs.expo.dev/push-notifications/sending-notifications/ ; https://docs.expo.dev/eas-update/introduction/

---

## 9. Expo + Metro in a pnpm/Turborepo monorepo

**Assumption (arch 8.6; plan 6.2):** Turborepo + pnpm monorepo containing `apps/mobile` (Expo).

**Finding:** Expo's monorepo guide: pnpm and Bun isolated (default) installs are supported from SDK 54; on SDK 53 they should be disabled. Metro is auto-configured with `expo/metro-config` since SDK 52 (remove manual `watchFolders`/`nodeModulesPath` overrides). Some React Native libraries still break under isolated installs; the documented fix is `nodeLinker: hoisted` in `pnpm-workspace.yaml`. Duplicate `react-native` is unsupported and duplicate `react` breaks at runtime (`pnpm why --depth=10 react-native`). SDK 55 enables autolinking module resolution automatically for monorepo apps. The page does not discuss Turborepo setup beyond duplicate-module warnings. Current tool versions: Turborepo 2.11.11, pnpm 12.21.0.

**Verdict: Confirmed.** Add to arch 8.6: lockfile policy (one `react`, one `react-native`), a CI check for duplicates, and a documented fallback to `nodeLinker: hoisted` for `apps/mobile`. Re-test with pnpm 12 defaults early.

Source: https://docs.expo.dev/guides/monorepos/

---

## 10. NestJS with the Fastify adapter

**Assumption (plan decision 3; arch Appendix A.6):** NestJS on Fastify.

**Finding:** Current NestJS is 12 (`@nestjs/core` and `@nestjs/platform-fastify` 12.5.1, Fastify 5.12.8). The v12 migration guide: runtime needs Node 20.19+ or 22.12+ (not 21.x); the CLI needs Node 22.22.3+/24.15+/26+; all core packages are ESM (CommonJS apps can still load them through `require(esm)`); Jest can load ESM-only packages only on Node 24.9+ so Vitest is recommended; `@nestjs/schematics` v12 needs TypeScript 6; HTTP-adapter error mapping reworked across core, Express and Fastify; lifecycle hook order changed. The Fastify adapter is a first-party, long-standing package.

**Verdict: Confirmed.** Add to arch 8.1/8.6: pin NestJS 12 and Fastify 5; Node 24 LTS (or 22.13+) as base image; Vitest for unit tests; ESM from day one.

Source: https://docs.nestjs.com/migration-guide ; npm registry metadata.

---

## 11. BarcodeDetector on iOS Safari

**Finding:** caniuse (2026-11-17): Safari iOS "disabled by default" from 17.0 through 27.2; Safari macOS likewise through 27.3; Firefox unsupported; Chrome and Android browsers supported (partial). MDN: not Baseline, experimental.

**Verdict: Confirmed.** ZXing-js fallback is still required for web camera scanning; the native Expo app remains the primary scanner.

Sources: https://caniuse.com/mdn-api_barcodedetector ; https://developer.mozilla.org/en-US/docs/Web/API/Barcode_Detection_API

---

## 12. Caddy automatic TLS for on-prem without public DNS

**Assumption (arch 7.3, 8.7; plan 6.15):** bundled Caddy gives auto-TLS "or customer certificate".

**Finding**
- For IPs and local names (`localhost`, `.local`, `.internal`, `.home.arpa`) Caddy uses its internal local CA automatically; no ACME or DNS involved; the root is trusted only where it is installed (Caddy tries to install it in the host trust store; unreliable in containers). `tls internal` selects the internal CA explicitly; `tls cert.pem key.pem` loads customer certificates (and disables automatic HTTPS for those names).
- Internal leaf certificates default to 12 hours (do not change); root 10 years, intermediate 7 days.
- Public names need reachable ports 80/443 for HTTP-01/TLS-ALPN, or a DNS challenge (needs a provider module and credentials; Let's Encrypt requires DNS challenge for wildcards). On-prem customers behind firewalls often cannot do either.
- Mobile trust: Android apps targeting API 24+ ignore user-installed CAs unless a `network_security_config` opts in; an MDM-pushed CA is generally in the user store. An Expo app would need a config plugin to add that, with a security cost (broader trust). iOS needs the root installed and enabled as fully trusted (general knowledge; not in a fetched page). The Expo web view case is worse on Android. No Expo-specific guidance found.

**Verdict: Confirmed, with a Risk.** The Caddy claims are right. The unaddressed gap is the mobile app trusting an internal CA.

**Recommendation:** Install wizard offers three modes: (1) customer-supplied cert/key (recommended default, works with enterprise PKI already trusted on managed devices), (2) public ACME (HTTP-01 or DNS-01 with a DNS-plugin Caddy build), (3) `tls internal` for evaluation only, with docs warning that the mobile app will not trust it. Add a mobile TLS test to the self-hosted CI matrix.

Sources: https://caddyserver.com/docs/automatic-https ; https://caddyserver.com/docs/caddyfile/directives/tls ; Android user CA behaviour from developer forum reports (secondary).

---

## 13. cosign key-based verification and Node Ed25519

**Assumption (arch 7.3, 8.3; plan 6.15):** images signed with cosign key-based keys, public key shipped in the bundle, verification works offline; license file Ed25519-signed JSON verified in Node.

**Finding**
- Cosign v3 is current (docs and blog). The new protobuf bundle format is now the default; it needs the OCI 1.1 referrers API and cannot use tag-based storage. A v3 change: "Don't require a trusted root to verify offline with a key." Key-based `cosign verify --key cosign.pub <image>` is the basic form; transparency-log checks are skipped for key-based use with `--insecure-ignore-tlog` in guides (confirm in `cosign verify --help` for your version). CVE-2026-22703 concerns bundle verification; advisories say default-flag v3 users are not affected; keep cosign patched.
- Offline/air-gapped note: signatures stored as OCI referrers are not in a `docker save` tarball, so the offline bundle must ship signature bundle files and the verify step must use them. Confirm the license-gated registry supports referrers.
- Node.js crypto (v26.13.1 docs; 26.x, 24.x and 22.x are marked LTS): Ed25519 is a supported key type; `sign(null, data, privateKey)` and `verify(null, data, publicKey, signature)` are the documented usage; formats include pem, der, jwk (and `raw-public` in current docs). Use SPKI PEM/DER or JWK for portability across Node versions.
- The arch's RFC 8785 canonicalisation step adds a library and canonicalisation-bug risk.

**Verdict: Confirmed with caveats.**

**Recommendation:** Sign the exact bytes (a compact JWS with EdDSA, via `jose`, with `kid` in the header) rather than canonicalised JSON; this removes RFC 8785 from the trust path. Verify images with cosign v3, `--key`, and the signature bundle for offline.

Sources: https://blog.sigstore.dev/cosign-3-0-available/ ; https://docs.sigstore.dev/cosign/verifying/verify/ ; https://nodejs.org/api/crypto.html

---

## 14. Self-hosted SAML libraries for Node

**Assumption (plan 6.12, decision 27; arch 7.3):** built-in SAML + SCIM libraries in the self-hosted edition (v2).

**Finding**
- `@node-saml/node-saml` 5.2.0 (2026-10-26). GitHub advisories: GHSA-4mxg-3p6v-xgq3 and GHSA-m837-g268-mmv7 (both Critical, signature verification, July 2025); GHSA-vx8m-6fhw-pccw (Moderate, 2023); GHSA-5p8w-2mvw-38pv (High, signature bypass via multiple root elements, 2022). CVE-2025-54419: node-saml before 5.1.0 could be bypassed by combining an xml-crypto parsing deviation with a parser differential (assertion data read from the unsigned original document). Underlying `xml-crypto` has its own signature-bypass CVEs (CVE-2024-32962, CVE-2025-29774, CVE-2025-29775).
- `samlify` 2.15.1 (2026-10-21). CVE-2025-47949 (signature wrapping, fixed in 2.10.0). On 2026-10-20 the repository published ten more advisories: Critical (attacker-controlled signing cert accepted via RSAKeyValue in IdP metadata), High (XML comment node splitting enabling impersonation; Redirect/SimpleSign signatures not bound to message; unbounded DEFLATE DoS; missing InResponseTo validation enabling replay; missing AudienceRestriction enforcement enabling cross-SP takeover; XML injection in AttributeValue), Moderate (signature wrapping for Logout/AuthnRequest; RSA-1.5/3DES accepted). I could not open individual advisory pages for affected and patched ranges; check them before any use.
- Pattern: both libraries have repeated signature-validation flaws; assertion parsing and XML signature handling is a recurring weak point, and a freshly fixed cluster of 10 in samlify one month ago means its design was not hardened.

**Verdict: Risk (high).** Decision 27 (built-in SAML in v2) is feasible but carries ongoing CVE-response cost for a product that will be run in customer environments where patching is slow.

**Recommendation:** Do not use samlify. If built-in, use node-saml (patched, 5.1.0 or later and current xml-crypto), fixed behind a thin adapter with a SAML conformance and negative-test suite (wrapping, comment injection, replay, audience), mandatory signed assertions, and a security-advisory feed in the release process. Offer a lower-risk alternative: ship an optional bundled identity broker (for example Keycloak, already named as an open-source option in plan 6.2) so SAML parsing lives in a mature, widely scrutinised component, and keep the product on OIDC only. Make a go/no-go decision on that before v2 planning.

Sources: https://github.com/node-saml/node-saml/security/advisories ; https://github.com/tngan/samlify/security/advisories ; https://www.securing.pl/en/cve-2025-54419-how-two-bugs-combine-to-break-saml-authentication-in-node-saml-5-0-1/ ; https://github.com/advisories/GHSA-r683-v43c-6xqv ; npm registry.

---

## 15. SSO vendor pricing versus the $149 Pro tier

**Assumption (plan 8.2, decision 7; arch 2, 6.d):** SAML SSO (MVP Should) and SCIM (v2) from the Pro tier at $149/month base (2,500 assets), target gross margin at least 75-80% per Pro tenant.

**Finding** (vendor pricing pages, 2026-11-17)
| Vendor | SSO connection | SCIM / directory | Notes |
|---|---|---|---|
| WorkOS | $125 per connection (1-15), $100 (16-30), $80 (31-50), $65 (51-100) | Directory Sync priced the same tiers, per connection | First 1M MAU on AuthKit free. No minimum. The pricing page did not say "per month" explicitly for SSO; WorkOS bills these per active connection per month. |
| Auth0 / Okta CIC (B2B) | Free: 1 enterprise connection. Essentials from $150/month incl. 3 connections. Professional from $800/month incl. 5. Extra connections $100/month each. | Inbound SCIM included in all plans | Priced by MAU as well; makes Auth0 the primary IdP, not just an SSO add-on. |
| Clerk | 1 connection included per app on Pro ($25/mo) and Business; then $75/month each (2-15), $60 (16-100), $48 (101-250) | Directory Sync billed separately starting 2027-01-01, same tiers | Per-app, not per-tenant, inclusion. |
| Stytch | 5 SSO or SCIM connections included in free tier; extra $125 each | Counts against the same allowance | Verify current ownership and roadmap; not checked. |

- Margin arithmetic at $149 base: WorkOS SSO only = $125, which is 84% of base price (gross margin before any infra or payments = 16%); SSO + SCIM = $250, which exceeds the whole base price. Even at the annual-billing equivalent and including some extra-asset revenue, a Pro tenant that enables SAML is unprofitable on vendor cost alone. Auth0 at $100/connection beyond the plan's included connections is similar. Clerk's $75 is lower but still half the price; its included connection is per app, not per tenant.

**Verdict: Risk (margin), not a technical block.**

**Recommendation:** Do one of: (a) move SAML/SCIM to an Enterprise-tier or priced add-on (for example $99-$199 per connection per month passed through with margin); (b) keep SAML in Pro but limit to one connection and charge an annual SSO fee; (c) decide on the self-hosted library route for Cloud too (see item 14 for its risk). Update plan 8.2 and decision 7 and add a COGS line for the vendor in the unit-economics check. Negotiate vendor volume pricing before GA. Remember each vendor charges per active connection, so the cost lands only on tenants that use SSO, which fits an add-on model.

Sources: https://workos.com/pricing ; https://auth0.com/pricing ; https://clerk.com/pricing ; https://stytch.com/pricing

---

## 16. App Store and Google Play policy for a B2B app with server URL and login

**Assumption (plan 6.5, decision 28):** one store app for both editions; user enters the server URL or scans a setup QR on first launch; MDM can preset the URL; distribution via App Store, Play Store and MDM.

**Finding: Apple**
- App Review Guideline 2.1: apps with account-based features must give "an active demo account or fully-featured demo mode, plus any other hardware or resources... (such as login credentials or a sample QR code)". A built-in demo mode in place of an account needs prior approval.
- 5.1.1(v): if the app supports account creation, it must offer in-app account deletion.
- 4.8: apps using a third-party/social login for the primary account must offer an equivalent privacy-preserving login (Sign in with Apple style), except apps that "exclusively use your company's own account setup and sign-in systems" or are "education, enterprise, or business" apps requiring an existing enterprise account. The app offers Google/Microsoft OIDC and email+password, so this exception may not cleanly apply; get ahead of it.
- 3.1.3(c): apps sold directly to organisations may allow enterprise users to access previously purchased content; no in-app purchase needed; avoid in-app pricing/upgrade flows.
- 2.5.2: apps may not download or execute code "which introduces or changes features or functionality" after install. EAS Update must be limited to fixes and non-feature changes, and features described in review notes (2.1).
- 2.5.19 and 2.1(a): no hidden or dormant features; describe new features in review notes.
- Custom Apps (private distribution to specific organisations through Apple Business/School Manager) require choosing an Organization ID before approval and are for one app per organisation list; the page says private distribution is "only available before your app has been approved". A single shared app for all customers does not fit.
- Unlisted app distribution: link-only, not searchable, works on managed and unmanaged devices and through Apple Business Manager; requires the app to be submitted or live and a request form; Apple recommends an in-app mechanism to prevent unauthorised use (the server-URL plus login satisfies this).

**Finding: Google Play**
- App access: reviewers need working, reusable credentials that bypass 2-step verification and one-time passwords, valid from anywhere; QR or barcode-based access needs a static URL. Expired credentials can cause rejection.
- Personal developer accounts created after 2023-11-13 must run a closed test with at least 12 testers for 14 continuous days before production access (secondary sources; not on a fetched Google page). Organisation accounts are reported as exempt; verify the D-U-N-S requirement in Google's registration docs.
- Private apps through Managed Google Play can be targeted to specific organisation IDs (help pages say up to 1,000 per app); the package name must be globally unique.

**Verdict: Risk (manageable).**

**Recommendations**
- Operate a permanent, resettable "App Review" demo tenant in the Cloud edition with a non-expiring account that has no MFA; put its server URL and credentials in App Store Connect and Play Console review notes, and pre-fill it via the setup QR. Keep it clean of real data.
- Register the Play account as an organisation. Start TestFlight and Play internal testing in month 4 as plan 6.5 already says.
- Decide now whether mobile supports self sign-up; if not, say so and skip the account-deletion work, if yes build in-app deletion.
- Confirm Sign in with Apple need once the auth design is final, or restrict mobile login to email+password and tenant OIDC.
- Treat EAS Update as fixes only; record this in the release checklist.
- Use public (or Unlisted) distribution; do not use Apple Custom Apps for the shared app. Offer managed-app configuration for URL presets.

Sources: https://developer.apple.com/app-store/review/guidelines/ ; https://developer.apple.com/business/custom-apps/ ; https://developer.apple.com/support/unlisted-app-distribution/ ; https://support.google.com/googleplay/android-developer/answer/15748846 ; https://support.google.com/googleplay/work/answer/6145139

---

## Changes the architecture/plan should make

References are to `docs/03_system_architecture.md` (arch) and `docs/02_product_plan.md` (plan).

1. **Database version (arch Conventions stack line, 1, 3 container table, 5.3 "Views and functions" row, 7.1, 7.3 adapter table, 8.1 `postgres:16`, 8.2, 8.3 CI service container, Appendix A.12; plan 6.2 DB row, 6.15 table).** Change PostgreSQL 16 to PostgreSQL 18 (RDS for PostgreSQL 18). Self-hosted: bundle `postgres:18`; support BYO 16-18; CI matrix 16 and 18. Keep app-generated UUIDv7 as the single path; rewrite Appendix A.12 to say "PG 18 has native `uuidv7()`; app-side generation is kept for portability with PG 16/17 BYO and for client-created ids in v2". Check the PG 18 image volume layout in 8.7.
2. **Pooler (arch 7.1, 8.2, Appendix A.8; plan 6.1 first pitfall).** Make PgBouncer 1.26.1+ (transaction mode, `max_prepared_statements` set) the default pooler; RDS Proxy becomes optional and requires a staging proof of zero pinning with the production driver, plus a test of statements over 16 KB (bulk import). Correct plan 6.1 wording: AWS lists `SET` as pinning on PostgreSQL and offers no pinning filters; `SET LOCAL` exemption is documented only for MySQL. Make the driver choice explicit (no named prepared statements unless `max_prepared_statements` is on).
3. **Queue (arch Appendix A.7, 7.1, 5.2; plan 6.2, 6.8).** Keep pg-boss, but correct the rationale: pg-boss uses `pg_advisory_xact_lock` and optional LISTEN/NOTIFY on a dedicated client; give worker/scheduler direct connections and give any LISTEN client a direct string. Record pg-boss 12.x requirements (Node 22.12+, PG 13+) and the single-maintainer risk with a documented fallback (Graphile Worker 0.x or SQS).
4. **Static-export routing (arch 3 "Decision: web as a Next.js static export" paragraph, 7.1 CloudFront Function, 8.6; plan 6.2 Web row).** Replace "one prerendered shell page selected by a CloudFront Function rewrite" with query-string detail routes or a catch-all client-routed shell, plus an SPA fallback; state that `headers`, `redirects`, `rewrites`, Proxy (the renamed middleware), cookies, Server Actions and default image optimisation are unavailable; set security headers via CloudFront response-header policy and Caddy; use `images.unoptimized` or a custom loader. Add a spike (week 1) for deep-link refresh, back/forward and QR-URL deep links. Add a CI check against unsupported features.
5. **Expo and EAS cost and policy (arch 8.3 EAS section, 9 "EAS Update code signing", Appendix B item 27; plan 6.5, 8.2 cost model).** Add EAS Production plan ($199/month plus usage) as an MVP cost because code signing requires it; model update MAU across Cloud and self-hosted devices (50,000 included; $0.005 overage). Add "EAS Update fixes only" to the release checklist (Apple 2.5.2). Use Expo SDK 58 (Node 22.13+), and add a device test matrix for QR, Code128 and DataMatrix scanning.
6. **Self-hosted push (arch 3 Push relay row, 7.3 adapter table "Push"; plan 6.5, 6.15).** Resolve the Expo push credential model: Expo push tokens belong to our Expo project, so customer servers either use an access token we cannot hand out or send unauthenticated. Either specify a license-gated push relay operated by us (needs phone-home), or declare push Cloud-only for v1 of self-hosted.
7. **TLS on self-hosted (arch 7.3, 8.7 Caddy; plan 6.15 TLS row).** Specify three modes: customer certificate (default recommendation), public ACME (HTTP-01 or DNS-01 with a DNS-plugin Caddy build), `tls internal` (evaluation only). Document that the Expo app does not trust a private CA by default on Android (user-store CAs ignored for API 24+) and add either a config plugin with `network_security_config` or an MDM-installed system trust requirement; add a mobile-over-internal-CA test to the self-hosted CI matrix.
8. **License signing format (arch 7.3 License verification, Appendix B item 29; plan 6.15 License file).** Replace "Ed25519 over RFC 8785 canonical JSON" with a compact JWS (`alg: EdDSA`, `kid` in header) verified with Node `crypto.verify(null, ...)` or `jose`; drop RFC 8785 from the trust path. Cite Node 22/24/26 Ed25519 support.
9. **Release signing (arch 7.3 Install and upgrade, 8.3 release pipeline; plan 6.15 Releases).** State cosign v3 key-based signing with `--key` verification; the registry must support OCI 1.1 referrers; the offline tarball must include signature bundle files; keep cosign patched (CVE-2026-22703 context).
10. **SAML decision (arch 7.3 Dependency abstraction SSO row, Appendix B; plan 6.12, decision 27, risks in section 11).** Mark "built-in SAML v2" as a high-risk item. Forbid samlify. If built-in, use node-saml 5.1.0+ with current xml-crypto behind an adapter, a negative-test conformance suite and a CVE-watch step in release; or replace it with a bundled identity broker (Keycloak) and keep the product on OIDC. Decide before v2 planning.
11. **SSO vendor economics (plan 8.2 Pro column, 8.2 unit-economics check, decision 7; arch 2 notes, 6.d).** Pro at $149 cannot absorb a $125/connection SSO vendor fee (SCIM would double it). Move SAML/SCIM to a priced add-on or Enterprise tier, or cap and charge per connection; add vendor COGS to the margin model. Negotiate pricing before GA.
12. **Store-policy readiness (plan 6.5 app-store paragraph; arch 6.a and 7.3 "Mobile app and API clients").** Add: a permanent Cloud demo tenant with a non-expiring non-MFA reviewer account (Apple 2.1, Play App access), Play organisation account, Sign in with Apple assessment for OIDC social login (guideline 4.8), account-deletion decision (5.1.1(v)), unlisted-or-public distribution (not Apple Custom Apps), MDM managed config for server URL.
13. **Toolchain baselines (arch 8.1, 8.6; plan 6.2).** Pin NestJS 12 and Fastify 5 (ESM-first; Vitest; TypeScript 6 for schematics); Node 24 LTS image base (minimum 22.13); Next.js 16.4.x; PgBouncer 1.26.1+; add duplicate `react`/`react-native` CI check and a `nodeLinker: hoisted` fallback note for the Expo app.
14. **RLS wording (arch 5.3).** Add: FORCE does not bind superusers or BYPASSRLS roles; set RLS and FORCE on each partition explicitly (ALTER TABLE docs do not state recursion); exclude partitions from `ALTER DEFAULT PRIVILEGES` grants; keep `row_security = on` for per-tenant exports.
15. **Web scanning (arch 3 Web app row; plan 6.5).** No change: iOS Safari BarcodeDetector is still disabled by default through iOS 27.2, so ZXing-js stays the web fallback. Serwist stays a Could; add a static-export spike before promoting it.
