# 04 Validation report (consolidated)

Date: 2026-11-17. Audience: founding team. Product: asset management, Cloud SaaS plus Self-hosted edition.

Detailed reports (all claims below trace to these):
[competitor](validation/competitor_validation.md) | [market](validation/market_validation.md) | [technical](validation/technical_validation.md) | [spike](validation/spike_rls_pgbouncer.md)

Label convention: "(decided 2026-11-17, decision N)" is a team decision; "(proposed)" is a detail the team has not decided or that is not in the source reports.

---

## 1. Summary

**Why desk validation.** The team cannot run the 4-week Phase 0 (decision 20). Desk validation (4 reports) was done on 2026-11-17 instead. What desk research cannot validate moves to in-build validation with closed-beta design partners (section 6). Phase 0 is removed from the timeline: build starts at month 0, closed beta about month 5, GA about month 8 (unchanged).

**Verdict per area**

| Area | Verdict | One line |
|---|---|---|
| Competitor facts | Mostly confirmed, several corrections | Snipe-IT importer feasible; but Asset Panda, Lansweeper, Freshservice, ManageEngine facts in the plan were stale; price transparency and unlimited users are not differentiators. [report](validation/competitor_validation.md) |
| Market demand | Weak to moderate; self-hosted premium contradicted | Mobile scanning and pricing pain have the best support; "IT + physical in one tool" and paid self-hosting are weakly supported or contradicted. Evidence is secondhand. [report](validation/market_validation.md) |
| Technical assumptions | Core design sound, 8 corrections and 3 risks | PG 16 to 18, static-export routing, EAS code-signing plan, self-hosted push, SSO vendor cost, SAML libraries. [report](validation/technical_validation.md) |
| Hands-on spike | Assumption holds | RLS isolation passed 9 tests plus 1 extra on PG 18.7 and 16.16, direct and via PgBouncer 1.26.1; pg-boss 100/100 jobs, 0 RLS violations. Two hazards found (empty-string GUC, direct partition access). [report](validation/spike_rls_pgbouncer.md) |

**Most important findings**

1. **Paid self-hosting has no demand evidence, and the 1.25x premium is contradicted.** The only demonstrated self-host buyers pay $0 (Snipe-IT, Shelf.nu); ManageEngine on-prem is about 0.77x its cloud price. Result: self-hosted repriced to about 0.8x SaaS and Community raised to 250 assets (decision 1).
2. **SSO vendor cost does not fit the $149 Pro price.** WorkOS SSO is $125 per connection per month (about 84% of Pro base); SSO plus SCIM is $250. Result: SAML + SCIM become a paid per-connection add-on (decision 2).
3. **Tenant isolation holds through PgBouncer, with two required fixes.** The RLS policy must use `NULLIF(current_setting(...), '')`, and the app role must hold privileges on partitioned parents only (direct partition reads leaked in the spike).
4. **Differentiators were weaker than assumed.** Most SMB tools publish prices and several offer unlimited users; Asset Panda has a REST API and SAML. "Full REST API + signed webhooks on every tier, including Free" remains distinctive. "IT + physical in one" demand is weak, so the lead message changes.
5. **Several architecture items were wrong or costly.** PostgreSQL 18 replaces 16; the CloudFront-rewrite shell for dynamic routes is not a supported Next.js static-export pattern; EAS Update code signing needs the $199/month Production plan; self-hosted installs cannot send Expo push directly.

---

## 2. Method and limits

| Item | Detail |
|---|---|
| Date | 2026-11-17 for all access dates |
| Competitor | WebFetch/WebSearch of vendor pages, docs, repos. Fetches were summarised by a small model, so quotes are paraphrase unless in quotation marks. "Confirmed" means an official vendor page or repo states it; third-party sources are never counted as Confirmed. |
| Market | Public web only (substitute for customer interviews). Readable: Hacker News (Algolia API), GitHub API, Docker Hub API, vendor and trade pages. Evidence tagged P (opened), S (secondhand), Snip (search snippet, a lead only). |
| Technical | Official docs, npm registry metadata, vendor pricing pages, release calendars. Where an official page was silent this is stated as "unverified". |
| Spike | Hands-on in Docker: PostgreSQL 18.7 and 16.16, PgBouncer 1.26.1 (transaction mode, `max_prepared_statements=100`), pg-boss 12.38.2, node-postgres 8.23.1, Node v24.19.0. 600 interleaved transactions; 100 queued jobs per pg-boss scenario. Torn down afterwards. |

**Blocked or inaccessible**
- Reddit (all hosts and mirrors), G2, Capterra, TrustRadius, GetApp, Lansweeper community forum, Spiceworks (no usable result). Every Reddit or review-site item in the market report is secondhand (a vendor blog quoting Reddit, or a search snippet).
- Lansweeper official pricing page and Atera pricing page returned HTTP 403.
- Almost no first-person evidence from the plan's actual buyer (IT/ops manager at a 50-1,000 person org who is not a Snipe-IT enthusiast); everything is proxy evidence.

**Known biases (market report)**: forums over-represent complainers and self-hosting power users; most pain-point text is written by competing vendors; GitHub issues and Docker pull counts are biased (bugs; CI and re-pulls); HN skews to developers and homelab users.

**Spike limits**: one PgBouncer version and image; RDS Proxy not tested; no TLS; no `auth_query`; 600 transactions over 10 clients and 4 server connections, not a performance test; application scoping layers, `identity` schema and replicas out of scope.

**Reading the verdicts below.** Verdict key: Confirmed / Corrected (plan or architecture wrong or outdated) / Risk / Weak / Contradicts. Where a report uses a different grade, it is kept: Moderate and Strong (market signal strength), Unverified (no official evidence found), No evidence.

---

## 3. Findings by area

### 3.1 Competitor facts ([competitor](validation/competitor_validation.md))

| Claim | Verdict | Finding | Section |
|---|---|---|---|
| Snipe-IT API supports a URL + token importer | Confirmed | List endpoints for assets, models, categories, locations, users, licenses (+ seats), accessories, consumables, components, fields, fieldsets, suppliers, companies, maintenances, files, activity. Term is "API key" (Bearer). Default 120 req/min, 500 rows/page; about 42 min for 5,000 assets' history on hosted Basic (source's own arithmetic). | [s1a](validation/competitor_validation.md) |
| Snipe-IT hosted $39.99 / $99.99 / $249.99 | Confirmed | Unlimited users and assets on all three; API limits 120 / 240 / unlimited per min (mapping inferred from column order). Hosted SAML inclusion unverified. | [s1b](validation/competitor_validation.md) |
| Snipe-IT license conflict (AGPL vs GPL) | Confirmed | AGPL-3.0. API-only importer is unaffected; do not reuse its code in the closed-source Self-hosted edition. | [s1c](validation/competitor_validation.md) |
| Snipe-IT official mobile app is beta | Confirmed | Still beta on undated pages; latest release v8.8.3 (2026-10-22). Re-check before marketing copy. | [s1d](validation/competitor_validation.md) |
| Asset Panda: no confirmed API/SSO | Corrected | Documented REST API (key id + secret, admin-only, 400 calls / 3 min / IP) and SAML 2.0 SSO. Webhooks unverified. Pricing quote-only. | [s2](validation/competitor_validation.md) |
| Lansweeper: cloud vs on-prem unresolved | Corrected | Both exist: Platform/Sites (cloud) and Classic (on-prem). Pricing unverified (official page 403). QR/barcode generation in Classic; no mobile app or check-out found. | [s3](validation/competitor_validation.md) |
| Freshservice ITAM plan inclusion unclear | Corrected | ITAM and discovery start at Growth ($49/agent/mo annual); Starter not listed; Pro adds SAM and contracts; Asset Units from $125/mo per 500-unit pack. | [s4](validation/competitor_validation.md) |
| ManageEngine: free cloud 25 nodes; cloud unconfirmed | Corrected | Cloud edition exists; free 50 nodes cloud / 25 on-prem; public prices (cloud about $2,345/yr and on-prem about $1,795/yr at 500 assets). | [s5](validation/competitor_validation.md) |
| Price transparency and unlimited users differentiate us | Corrected | Reftab, Sortly, GoCodes, EZO, Assetbots, Shelf, itemit, ME and Snipe-IT publish prices; Snipe-IT, Reftab, Shelf Team, EZO offer unlimited users. | [s6](validation/competitor_validation.md) |
| "API at every tier" is unusual | Confirmed | GoCodes charges $1,200/yr, itemit GBP 699/yr, Sortly gates it to Enterprise. Still distinctive. | [s6](validation/competitor_validation.md) |
| Self-hosted at 1.25x SaaS price | Contradicts | ManageEngine on-prem about 0.77x its cloud price; Snipe-IT and Shelf self-host are free. Our $735 / $2,235 are well under ME on-prem. | [s7](validation/competitor_validation.md) |
| Starter $49 / Pro $149 price points | Moderate | Starter in line to slightly over the SMB cluster; Pro about 1.8x Snipe-IT Small Business ($999.99/yr). Premium must be justified by mobile, importer, SOC 2, support. | [s7](validation/competitor_validation.md) |
| Free tier 100 assets | Weak | Assetbots Free gives 200, Shelf Personal unlimited assets (1 user); 100 is in line only if value is users + API + mobile. | [s7](validation/competitor_validation.md) |
| New 2024-2026 SMB entrants | Unverified | Six comparators tabulated; no launch dates found. | [s6](validation/competitor_validation.md) |

### 3.2 Market demand ([market](validation/market_validation.md))

| Hypothesis | Verdict | Finding | Section |
|---|---|---|---|
| SMB teams want IT + physical assets in one tool | Weak | Vendor supply and some non-IT usage; almost no buyer-voiced demand; sysadmin threads frame the problem as IT-device accuracy. | [Q1](validation/market_validation.md) |
| Pain: setup / migration | Weak | Not supported; one reviewer reports a simple import. Self-host upgrade pain is real but separate. | [Q2a](validation/market_validation.md) |
| Pain: opaque pricing | Moderate | Quote-only and conflicting third-party prices are the norm; Lansweeper price-shock complaints are buyer-voiced. | [Q2b](validation/market_validation.md) |
| Pain: per-user pricing | Weak | No per-user complaints found; the loudest anger is about per-asset minimums and jumps (Lansweeper). | [Q2c](validation/market_validation.md) |
| Pain: no good mobile scanning | Moderate | Real versus Snipe-IT (official app beta); rivals already ship apps with mixed reviews. Gap is quality, not market-wide absence. | [Q2d](validation/market_validation.md) |
| Pain: weak API | No evidence | No buyer complaint either way; developers like Snipe-IT's API. | [Q2e](validation/market_validation.md) |
| Pain: self-hosting burden | Moderate | Upgrade failures on big version jumps are well documented; many users call self-hosting easy. | [Q2f](validation/market_validation.md) |
| Self-hosted demand | Strong (free) / Weak (paid) | Snipe-IT 15.2k stars, about 30M Docker pulls (overstates installs); no evidence anyone pays to self-host. | [Q3](validation/market_validation.md) |
| K-12 privacy drives self-host | Weak | State laws found regulate contracts and DPAs, not hosting; cost explains self-host. Primary statutes not read. | [Q3](validation/market_validation.md) |
| Native mobile app beats web/PWA | Moderate / Weak | Supports "scan from a phone"; cannot distinguish native from a good PWA. | [Q4](validation/market_validation.md) |
| WTP $0 / $49 / $149 | Moderate (SaaS) / Contradicts (self-hosted premium) | Anchors cluster around $400-$1,500/yr for small orgs; free Snipe-IT is the alternative. | [Q5](validation/market_validation.md) |
| Education/nonprofit as first vertical | Moderate (need) / Weak (MVP fit) | Concrete 1:1 Chromebook workflows; buyers expect Google Admin sync, loaners, fees; free or bundled rivals (CTL Rocket, Incident IQ). Nonprofit: Weak. | [Q6](validation/market_validation.md) |
| MSPs want a multi-tenant asset tool | Weak (leaning Contradicts) | Served by RMM/PSA/documentation suites; no practitioner demand found. | [Q7](validation/market_validation.md) |

### 3.3 Technical assumptions ([technical](validation/technical_validation.md))

| Claim | Verdict | Finding | Section |
|---|---|---|---|
| PostgreSQL 16 + app-side UUIDv7 | Corrected | PG 18 has native `uuidv7()`, on RDS since 2025-11-14. PG 16 community EOL 2028-11 is about 16 months after planned GA. | [1](validation/technical_validation.md) |
| RLS semantics (FORCE, BYPASSRLS, security_invoker, partitions) | Confirmed | FORCE never binds superuser or BYPASSRLS. Docs silent on ENABLE/FORCE recursing to partitions, so set per partition. | [2](validation/technical_validation.md) |
| RDS Proxy does not pin on `set_config(..., true)` | Risk | AWS lists SET as pinning on PostgreSQL, no pinning filters; the SET LOCAL exemption is documented for MySQL only. Statements over 16 KB pin. | [3](validation/technical_validation.md) |
| PgBouncer transaction mode is safe | Confirmed | Transaction-scoped `set_config` is safe; current 1.26.1; pin 1.26.1+ (CVE-2025-12819 fixed in 1.25.1). | [4](validation/technical_validation.md) |
| pg-boss vs Graphile Worker rationale | Corrected | pg-boss uses `pg_advisory_xact_lock` and optional LISTEN/NOTIFY; 12.38.2, Node 22.12+; single maintainer. Graphile Worker has no poll-only option. | [5](validation/technical_validation.md) |
| Next.js static export + CloudFront rewrite to one shell | Corrected / Risk | Not a documented pattern; headers, redirects, rewrites, Proxy, cookies, Server Actions unsupported. Use query-string or catch-all client routing. | [6](validation/technical_validation.md) |
| Serwist PWA | Confirmed | Maintained (9.5.15); static-export fit unverified, needs spike. | [7](validation/technical_validation.md) |
| Expo, EAS, push | Corrected | SDK 58; barcode types confirmed. EAS Update code signing needs Production ($199/mo) or Enterprise. Self-hosted push unresolved (tokens belong to our Expo project). | [8](validation/technical_validation.md) |
| Expo + pnpm + Turborepo | Confirmed | Isolated installs supported since SDK 54; `nodeLinker: hoisted` fallback. | [9](validation/technical_validation.md) |
| NestJS + Fastify | Confirmed | NestJS 12.5.1, Fastify 5.12.8; ESM-first, Vitest recommended. | [10](validation/technical_validation.md) |
| iOS Safari BarcodeDetector | Confirmed | Still disabled by default through iOS 27.2; ZXing fallback needed. | [11](validation/technical_validation.md) |
| Caddy auto-TLS without public DNS | Confirmed with Risk | `tls internal` works, but Android apps ignore user-installed CAs by default; mobile app will not trust it. | [12](validation/technical_validation.md) |
| cosign + Ed25519 licence signing | Confirmed with caveats | Key-based offline verify works in cosign v3; replace RFC 8785 canonical JSON with compact JWS. Signatures as referrers are not in `docker save` tarballs. | [13](validation/technical_validation.md) |
| Built-in SAML libraries (v2) | Risk (high) | node-saml: 4 advisories incl. 2 Critical (July 2025). samlify: 10 advisories on 2026-10-20 incl. a Critical. | [14](validation/technical_validation.md) |
| SSO vendor cost fits $149 Pro | Risk (margin) | WorkOS $125/connection SSO, $125 Directory Sync; SAML + SCIM exceeds Pro base price. | [15](validation/technical_validation.md) |
| App Store / Play policy | Risk (manageable) | Reviewer demo tenant, Sign in with Apple (4.8) and account-deletion (5.1.1(v)) checks, Play organisation account, OTA limit (2.5.2); Apple Custom Apps unsuitable. | [16](validation/technical_validation.md) |

### 3.4 Hands-on spike ([spike](validation/spike_rls_pgbouncer.md))

| Claim | Verdict | Finding | Section |
|---|---|---|---|
| Tenant isolation holds via `set_config(..., true)` through PgBouncer | Confirmed | 600 interleaved transactions over 10 clients / 4 server connections: 0 cross-tenant reads; no GUC outside a transaction. Same on PG 16 and 18, direct and pooled. | [s3 a, c](validation/spike_rls_pgbouncer.md) |
| Policy expression `current_setting('app.tenant_id', true)::uuid` | Corrected | After any tenant transaction the GUC is `''`, so the policy errors with 22P02 instead of returning 0 rows. Use `NULLIF(..., '')`. Still fail-closed. | [F1](validation/spike_rls_pgbouncer.md) |
| Partition parent policy protects partitions | Risk | Direct partition read leaked (3 rows, 2 tenants) when the app role held privileges. Parent-only grants fix it; selects, inserts and routing still work. | [F2](validation/spike_rls_pgbouncer.md) |
| "No session state" rule is load-bearing | Confirmed | Session `SET` leaked tenant A to a different client, silently (negative control). | [F3](validation/spike_rls_pgbouncer.md) |
| FORCE RLS backstops owner and definer views | Confirmed | Without FORCE, a definer view returned 10 rows / 2 tenants; with FORCE, 5 / 1. Side effect: owner with no tenant set sees 0 rows. | [F4](validation/spike_rls_pgbouncer.md) |
| pg-boss works through transaction pooling | Confirmed | 100/100 jobs, 0 violations; transactional enqueue worked (20/20). LISTEN/NOTIFY does not work through the pooler (latency 27-51 s with 30 s poll vs 8-27 ms direct); failure can be silent. | [F5, s4](validation/spike_rls_pgbouncer.md) |
| Named prepared statements through the pooler | Confirmed | Work with `max_prepared_statements=100`; fail at 0 (`prepared statement "q1" already exists`). | [test i](validation/spike_rls_pgbouncer.md) |
| pg-boss job tables are tenant-safe | Risk | `pgboss.*` tables carry no RLS; the app role can read all payloads. Payloads must be ids only. | [s6 item 6](validation/spike_rls_pgbouncer.md) |
| RDS Proxy compatibility | Unverified | Not tested in the spike. | [s9](validation/spike_rls_pgbouncer.md) |

---

## 4. Decisions taken after validation (decided 2026-11-17)

| # | Topic | Before | After | Evidence |
|---|---|---|---|---|
| 1 | Self-hosted edition (updates decisions 13, 23, 24) | In MVP; priced at 1.25x SaaS (about $735/yr for 500 assets, $2,235/yr for 2,500); Community licence 100 assets | Stays in MVP, repriced to about 0.8x SaaS: about $470/yr (500-asset band), about $1,430/yr (2,500-asset band), Enterprise custom. Community licence 250 assets (matches new Free tier). Review 6 months post-GA | ManageEngine on-prem about 0.77x cloud; no paid self-host demand found; Snipe-IT/Shelf self-host are free ([competitor s7](validation/competitor_validation.md), [market Q3, Q5](validation/market_validation.md)) |
| 2 | SSO (updates decision 7; decision 27 detail) | SAML (Should) and SCIM (v2) from Pro tier at $149 | SAML + SCIM become a paid per-connection add-on on Pro, included in Enterprise. OIDC (Google/Microsoft) stays free on every tier. Self-hosted SAML (v2): bundled Keycloak broker with OIDC-only app core (proposed) instead of in-app SAML libraries | WorkOS $125/connection SSO + $125 Directory Sync; node-saml / samlify advisories ([technical 14, 15](validation/technical_validation.md)) |
| 3 | Cloud pricing and claims (updates decisions 8, 14) | Free 100 assets; price transparency and unlimited users used as differentiators | Free 250 active assets; Starter $49 (500) and Pro $149 (2,500) kept as list-price hypotheses; promises "no minimum band" and "retired/disposed assets don't count". Stop claiming price transparency or unlimited users as differentiators; distinctive claim is "full REST API + signed webhooks on every tier, including Free". Unlimited users justified by broad check-out access. Premium over Snipe-IT hosted must be justified by mobile app, importer, SOC 2, support | Price transparency is the SMB norm; API-on-every-tier still unusual; per-user pain not found; Lansweeper minimums are the cautionary tale ([competitor s6, s7](validation/competitor_validation.md), [market Q2c, Q5](validation/market_validation.md)) |
| 4 | Vertical: add Google, drop MSP (updates decisions 1, 6, 9) | Google sync v2; repair log Should; MSP console v2 Must | Importer ships a Google Admin ChromeOS device CSV template (MVP); Google Admin (ChromeOS) device sync in v1.1 alongside Intune; loaner pool and repair log become MVP Must; MSP console downgraded to v2 Could pending demand, capability renamed "multi-company" (`company_id` column stays). Education discount: keep 30% as proposed; consider enrollment-based district plan after district conversations (proposed) | K-12 buyers expect Google Admin sync, loaners, repair tracking; MSP demand Weak / leaning Contradicts ([market Q6, Q7](validation/market_validation.md)) |
| 5 | Phase 0 (decision 20 rewritten) | 4-week Phase 0 before build | Removed from timeline. Build starts month 0; closed beta about month 5, GA about month 8 unchanged. Unvalidated items move to in-build validation with 5-10 design partners (section 6) | Team could not run Phase 0; desk research limits ([market s0, s4](validation/market_validation.md)) |

---

## 5. Changes applied to the plan and architecture

### 5.1 Positioning and go-to-market (from market validation)
- Lead message: "outgrew spreadsheets or Snipe-IT: scan from a phone, no-ops hosting (or self-host), import in minutes, API on every tier". "IT + physical in one tool" is demoted to a supporting claim.
- Complaint themes "import pain" and "weak API" marked assumed/untested; pricing opacity and mobile (versus Snipe-IT's beta app) are the best supported.
- Add Shelf.nu (AGPL, free self-host) as a second free anchor in risk 2; add Assetbots, Reftab, Sortly, GoCodes, EZOfficeInventory to the comparator set.
- K-12 timing: closed beta about May-June 2027 suits a summer-collection pilot; GA about month 8 misses most 2027 school budget cycles (proposed: pilot summer 2027, target 2028 budgets).
- Web camera scanning moves from Could to Should (fallback if store review slips; lets the beta compare native vs web scanning).

### 5.2 Competitor facts (matrix and plan)
- Asset Panda: REST API (key id + secret, admin-only, 400 calls / 3 min / IP), SAML SSO, CSV/Excel/PDF export; webhooks unverified; pricing quote-only.
- Lansweeper: both cloud (Platform/Sites) and on-prem (Classic); pricing quote-only; QR/barcode generation in Classic; no mobile app or check-out found.
- Freshservice: ITAM and discovery from Growth ($49/agent/mo, annual); Starter not listed; Pro adds SAM and contracts; Asset Units from $125/mo per 500.
- ManageEngine: cloud confirmed; free 50 nodes cloud / 25 on-prem; public prices (cloud about $2,345/yr and on-prem about $1,795/yr at 500 assets).
- Snipe-IT: AGPL-3.0 confirmed; hosted $39.99 / $99.99 / $249.99 with API limits 120 / 240 / unlimited per minute; mobile app still beta; latest v8.8.3.
- Snipe-IT importer design: Bearer API key; 120 req/min and 500 rows/page on hosted Basic; full object set (incl. fieldsets, status labels, suppliers, companies, maintenances, files); bulk lists first, history last and optional; backoff, resumable, progress UI; test `/reports/activity` for history; self-hosted sources can raise `API_THROTTLE_PER_MINUTE` and `MAX_RESULTS`. About 42 min for 5,000 assets' history at 120 req/min.

### 5.3 Data layer and tenancy (technical + spike)
- **PostgreSQL 18** (RDS supports it; native `uuidv7()`; PG 16 community EOL 2028-11). Self-hosted bundle `postgres:18`; BYO 16-18 supported; CI matrix 16 and 18. App-side UUIDv7 stays for portability and client-created ids.
- **RLS policy** uses `tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid` in USING and WITH CHECK; add test (used pooled connection, no tenant: 0 rows, inserts fail 42501 not 22P02).
- **Partitions**: app role granted privileges on partitioned parents only; partitions created by migrator with no grants; lint plus direct-partition test in CI; optional per-partition FORCE + policy as defence in depth.
- **CI isolation suite** runs through PgBouncer and includes the negative control (session SET leak with `pool_size=1` alias).
- **FORCE side effect**: owner with no tenant sees 0 rows; backfills and cleanup set tenant per run or use a controlled superuser path. FORCE never binds superuser/BYPASSRLS.
- **Pooler**: PgBouncer 1.26.1+ is the default for Cloud too; RDS Proxy optional only after a staging pinning test. Set `max_prepared_statements` (e.g. 100); at 0 named statements break.

### 5.4 Jobs
- pg-boss 12.x (Node 22.12+): keep `useListenNotify` false and no `notify: true` queues behind a pooler; poll 1-2 s.
- Schema creation and pg-boss upgrades in the migrator over a direct connection; runtime instances with `createSchema/migrate/supervise/schedule` false; one maintenance instance as owner; grant runtime role on `pgboss` schema (re-grant after upgrades).
- Transactional enqueue via `send(..., {db:{executeSql}})` inside the tenant transaction.
- `pgboss` tables have no RLS, so job payloads carry ids only. Single-maintainer risk: keep a queue adapter so it can be swapped.

### 5.5 Web and mobile
- **Next.js 16 static export**: replace "shell page + CloudFront Function rewrite" with query-string detail routes (e.g. `/assets/view?id=...`) or a single catch-all client-routed shell with SPA fallback (proposed). Security headers set by CloudFront (Cloud) and Caddy (self-hosted). Week-1 spike for deep links and refresh; CI check for unsupported features. Serwist (Could) spiked against static export before promotion.
- **Expo SDK 58** (Node 22.13+): expo-camera supports qr/code128/datamatrix (device-test them). EAS Update code signing requires Production plan ($199/mo + usage): budget it and model update MAUs across Cloud and self-hosted devices. OTA for fixes only (Apple 2.5.2).
- iOS Safari still lacks BarcodeDetector, so the ZXing fallback stays.
- **Store readiness**: permanent Cloud demo tenant with a non-expiring, no-MFA reviewer account; Play Console organisation account; assess Apple 4.8 (Sign in with Apple) and in-app account deletion (5.1.1(v)); public or unlisted distribution (not Apple Custom Apps); MDM managed config for server URL.

### 5.6 Self-hosted edition
- **Push**: Cloud-only in MVP; v1.1 license-gated push relay operated by us for self-hosted (opt-in, needs outbound internet); air-gapped means no push (proposed).
- **TLS**: three modes: customer-provided cert (default), public ACME via Caddy (DNS-plugin build for no-inbound setups), `tls internal` for evaluation only. Android apps ignore user-installed CAs by default, so MDM must install trust or `network_security_config`; add a mobile TLS test to CI.
- **License format**: compact JWS (EdDSA/Ed25519, `kid` header) verified with Node crypto or `jose`, instead of hand-canonicalised JSON.
- **Release signing**: cosign v3 key-based (`--key`); registry with OCI 1.1 referrers; signature bundles shipped inside offline tarballs (v2 air-gapped).

### 5.7 Toolchain pins
Node 24 LTS (minimum 22.13), NestJS 12 (ESM, Vitest) + Fastify 5, Next.js 16.4.x, Expo SDK 58, PgBouncer 1.26.1+, pg-boss 12.x; duplicate-`react` check in the monorepo; pnpm `nodeLinker: hoisted` fallback for Expo.

---

## 6. Not yet validated: in-build validation plan

Replaces Phase 0 (decision 20 rewritten, decided 2026-11-17). Recruit 5-10 design partners for closed beta (about month 5). Metrics and thresholds are proposed in the change brief; the "When" mapping is (proposed) except where noted. Desk validation remains limited (review sites and Reddit blocked; evidence mostly secondhand).

| Hypothesis | Metric / keep-kill threshold (proposed) | When |
|---|---|---|
| Buyers own both IT and non-IT assets in practice | At least 6 of the first 15-20 prospects own both | Prospect screening ahead of and during closed beta (about month 5) (proposed) |
| Paid self-hosted demand versus free Snipe-IT | At least 3 prospects would pay for Self-hosted vs free Snipe-IT | Closed beta (about month 5) (proposed) |
| Paid self-hosted conversion (repriced licence) | At least 10 paying self-hosted customers, or reconsider | 6 months post-GA (decided review point; threshold proposed) |
| Google sync is a purchase requirement for K-12 / nonprofit | At least 5 K-12 or nonprofit prospects treat Google sync as required | Closed beta (about month 5) (proposed) |
| Native scanning beats web camera scanning | Native vs web scanning comparison in beta (task time and error rate); threshold not set | Closed beta (about month 5) |
| Import works on real messy data (target: 100 assets in 30 minutes) | Import success on real messy data and Snipe-IT exports; threshold not set | Closed beta (about month 5) (proposed) |
| WTP versus Snipe-IT hosted and free alternatives | WTP interviews anchored on Snipe-IT hosted $39.99 / $99.99, spreadsheet, bundled tools; threshold not set | Closed beta, re-check at GA (about month 8) (proposed) |
| Premium over Snipe-IT hosted is justified (mobile, importer, SOC 2, support) | Qualitative test in WTP interviews; threshold not set | Closed beta (about month 5) (proposed) |
| K-12 enrollment-based or district plan | Conversations with 5-8 district IT staff (market report) | Before GA (about month 8) (proposed) |
| API / webhook value to a non-developer SMB buyer | No metric defined | Closed beta and after GA (proposed) |

Also not testable from the desk (market report s4): K-12 procurement and DPA/SOC 2 expectations, offline needs, Expo store-review friction, MSP and multi-company demand, hands-on trials of Snipe-IT app, Asset Panda mobile, Reftab, Incident IQ, CTL Rocket.

Still unverified competitor facts: Lansweeper list prices; Asset Panda prices, API plan inclusion and webhooks; Freshservice monthly prices and included Asset Units; hosted Snipe-IT SAML tier, token expiry, `/reports/activity` completeness; EZO and Reftab API plan inclusion; Atera/NinjaOne asset features; Oomnitza/Device42 prices.

---

## 7. Open risks surfaced by validation

| Risk | Source | Why it matters | Current handling |
|---|---|---|---|
| SSO vendor margin | [technical 15](validation/technical_validation.md) | WorkOS SSO $125 per connection (84% of Pro base); SSO + SCIM $250 exceeds it | Paid add-on, proposed $199/mo SAML and $299/mo SAML + SCIM (proposed); negotiate vendor volume pricing; add vendor COGS to unit economics |
| Paid self-hosted demand unproven | [market Q3](validation/market_validation.md) | Only free self-host demand evidenced; MVP self-hosted ships without LDAP and (until v2) SAML/SCIM while free Snipe-IT includes them | Repriced to 0.8x, Community 250 assets; kill/continue review 6 months post-GA; engineering already committed in MVP |
| pg-boss single maintainer | [technical 5](validation/technical_validation.md) | Bus-factor risk on the job queue | Pin major; queue adapter so it can be swapped; fallback Graphile Worker 0.x or SQS |
| RDS Proxy untested | [technical 3](validation/technical_validation.md), [spike s9](validation/spike_rls_pgbouncer.md) | Pinning on `set_config` undocumented; 16 KB statements pin | PgBouncer is the default; RDS Proxy only after staging test showing zero pinning |
| SAML library CVEs | [technical 14](validation/technical_validation.md) | Repeated signature-validation flaws; slow patching in customer environments | Bundled Keycloak broker with OIDC-only core (proposed); if in-app, node-saml 5.1.0+ behind adapter, never samlify; go/no-go before v2 planning |
| App-store review | [technical 16](validation/technical_validation.md) | Reviewer access, 4.8, 5.1.1(v), 2.5.2 can block or delay release | Demo tenant, org Play account, fixes-only OTA, web camera scanning as Should fallback; TestFlight and Play internal testing from month 4 per plan |
| K-12 budget timing | [market Q6](validation/market_validation.md) | GA about month 8 misses most 2027 budget decisions; June 30 fiscal-year renewals | Summer 2027 pilot via closed beta; target 2028 budgets (proposed) |

Other items to watch: EAS Production plan cost ($199/month plus usage) is now an MVP cost; the mobile app will not trust a private CA by default (self-hosted `tls internal`); desk evidence is secondhand, so the section 6 metrics carry the real validation.
