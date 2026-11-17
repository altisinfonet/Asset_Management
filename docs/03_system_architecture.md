# 03 - System Architecture: Multi-tenant SaaS and Self-hosted Asset Management & Tracking

Status: DRAFT for founding-team review. Date: 2026-11-17. Decisions adopted 2026-11-17 (plan section 12). Validated 2026-11-17 (docs/validation/): technical corrections from the desk validation and the RLS/PgBouncer/pg-boss spike are applied throughout and cited as "(validation: technical)" and "(validation: spike)".
Input: `docs/02_product_plan.md` (sections 4 module map, 5 phasing, 6 SaaS architecture, 7 data model, 9 security, and the self-hosted edition per plan decision 13 and plan 6.15; the self-hosted defaults are plan decisions 22-28). This document turns that plan into an architecture and adds Docker as the packaging and local-dev standard. It does not change the plan's scope.

## Conventions

- **Phase tags:** MVP (v1: closed beta about month 5, public GA about month 8, counted from build start at month 0; plan decision 22), v1.1 (first release after GA; the confirmed cuts), v2 (about months 9-14), v3 (year 2 onwards), as in plan section 5.1 as re-baselined by plan decisions 19 and 22. The 4-week Phase 0 is removed: validation moves in-build, with closed-beta design partners from about month 5 (decided 2026-11-17, plan decision 20 rewritten). Diagrams use colour classes: green = MVP, teal = v1.1, amber = v2, blue = v3, grey = external system.
- **Confirmed cuts (plan decisions 19 and 22):** Intune and Entra ID connector (joined by a Google Admin ChromeOS device sync in v1.1, decided 2026-11-17), Slack and Teams notifications, import undo (rollback; dry run stays in the MVP) and the label template editor (fixed templates only in the MVP) move to v1.1; self-hosted SAML (now via a bundled Keycloak broker rather than built-in libraries, proposed) and SCIM, Helm and the air-gapped install move to v2. Never cut: RLS and isolation tests, audit log, pen test, backups with a tested restore. If the team has fewer than 4 engineers, SAML also moves to v1.1 (the repair log is now an MVP Must, decided 2026-11-17, so it no longer moves).
- **"proposed (not in plan)"** marks anything this document adds that the plan does not state. A consolidated list is in Appendix B. Items from the plan carry a section reference such as (plan 6.1).
- Numbers come from the plan. Numbers added here are labelled "proposed".
- **Two editions, one codebase (plan decision 13):** **Cloud (SaaS)** and **Self-hosted** (closed source, commercial license key), both shipping in the MVP. Both are built from the same repository into the same backend Docker image; the edition is runtime configuration plus a license, never a fork (section 7.3). Self-hosted defaults that the team decided are written as "(decided, plan decision N)"; agent-added details the plan does not decide are written as "(proposed)" and stay unapproved.
- Stack (fixed by the plan; plan decision 3, one language across api, web and mobile with shared packages): TypeScript modular monolith on NestJS with the Fastify adapter, React web app (Next.js) plus an Expo (React Native) mobile app, PostgreSQL 18 with `tenant_id` + RLS (validation: technical; was 16), PgBouncer as the default pooler, Postgres-backed job queue (pg-boss), Postgres FTS (OpenSearch later), S3, AWS ECS Fargate for the Cloud edition (no Kubernetes), Terraform, GitHub Actions, Stripe, bought SAML/SCIM vendor (Cloud edition; OIDC login free on all tiers, SAML and SCIM a paid per-connection add-on on Pro and included in Enterprise, decided 2026-11-17, plan decision 7 updated), Go discovery agent (v2), customer-hosted collector container (v3), cells for EU and large tenants. The Self-hosted edition runs the same image from a Docker Compose bundle (Helm for Kubernetes is v2) and replaces the AWS and bought-service dependencies with adapters (section 7.3). Toolchain pins (Node 24 LTS, NestJS 12, Next.js 16.4.x, Expo SDK 58, PgBouncer 1.26.1+, pg-boss 12.x) are in section 8.1.
- Frontend stack (plan 6.2, 6.5, decisions 3 and 10): the web app (admin/desktop UI) is built with **Next.js (App Router) as a static export** (`output: 'export'`) on S3 + CloudFront, in a Turborepo + pnpm monorepo (section 8.6). The field app is a native **Expo (React Native, SDK 58)** app that **ships in the MVP** (decided: Expo in MVP, plan decision 10), online-first with a retry queue; full offline-first stays v2. The Capacitor option is dropped. See the decision paragraphs in section 3.

---

## 1. Overview and architecture principles

The system is one deployable backend codebase (a modular monolith) built into **one Docker image** that runs in several roles (`api`, `worker`, `scheduler`, plus `ingest` in v2 and a one-shot `migrate`). It talks to one PostgreSQL 18 database per cell (through PgBouncer once connection counts require it), S3 for files, and a small set of bought services (SSO/SCIM vendor, Stripe, SES) in the **Cloud edition**. The same image also runs as a **Self-hosted edition** on a customer's own host (single-tenant, Docker Compose bundle, license file instead of Stripe, SMTP instead of SES, S3-compatible storage such as MinIO; section 7.3), selected by runtime configuration, not by a separate build. The web client is a static Next.js web app (static export, no server-side rendering) served from S3 + CloudFront for admin and desktop use; a native Expo app for field technicians ships in the MVP (online-first with a retry queue; offline-first follows in v2). A "cell" is a complete copy of this stack; MVP runs exactly one (US).

Principles (each traces to the plan):

| # | Principle | Consequence |
|---|---|---|
| A1 | **Tenant isolation is enforced in three layers**: application scoping, Postgres RLS (fail closed, FORCE), and CI/pen-test verification (plan 6.1, 9). | No code path reaches tenant data outside `withTenantTx`. |
| A2 | **Modular monolith, extract only on evidence** (plan 6.2). | Modules talk through public facades and domain events; discovery ingest is the first extraction candidate. |
| A3 | **Boring, buyable infrastructure** for a team of 5-6 with no SRE (plan header, risk 11). | Cloud edition: managed RDS, Fargate, SES, Stripe, bought SSO/SCIM. No Kubernetes, no service mesh. Self-hosted edition: a plain Docker Compose bundle, no orchestrator required (section 7.3). |
| A4 | **One artifact, many roles.** The image that passed CI is the image that runs in every environment, every role and both editions. | Build once, promote by digest. Role differences are configuration and IAM, not code; edition differences are adapter selection and license (A10). |
| A5 | **Everything that changes data writes an audit record in the same transaction** (plan 6.10). | Audit log and the outbox event are written atomically with the change. |
| A6 | **Pooler-safe by construction.** No session state on a DB connection, ever. | Works behind PgBouncer (the default pooler, tested in the spike; validation: spike); RDS Proxy only after a staging pinning test (section 7.1). Reproducible locally (section 8.2). |
| A7 | **Cells from day one in the data model, one cell in operation** (plan 6.1, 6.14). | A tenant-to-cell lookup exists at MVP even though it always returns "us-1". |
| A8 | **Open API is the product surface.** The web UI and the Expo mobile app use the same REST API (plan P3, 6.11). | OpenAPI 3.1 is the source of truth; parity is a CI gate; both clients use the generated `packages/api-client` (section 8.6). |
| A9 | **Discovered data never writes straight into curated records** (plan 7.2). | Ingest writes staging tables; reconciliation promotes. |
| A10 | **Two editions from one codebase** (plan decision 13): Cloud (SaaS) and Self-hosted. Every infrastructure dependency sits behind an adapter interface (proposed, section 7.3). | No fork, no `if (saas)` branches in domain code. Self-hosted is single-tenant with RLS still on, so the isolation code path is identical in both editions. |

---

## 2. System context (C4 level 1)

Users are people at the customer organisation. External systems are shown with the phase in which the integration ships.

```mermaid
flowchart LR
  subgraph PEOPLE["People"]
    ADM["Admin or Asset Manager<br/>web app on desktop"]
    TECH["Technician or Auditor<br/>Expo native app on phone (MVP),<br/>scans labels"]
    ENDU["End user or Employee<br/>views own assets, acknowledges, requests (v2)"]
    MSPO["Multi-company operator (MSP console, v2 Could)<br/>manages several client tenants"]
  end

  SYS["Asset Tracker (Cloud SaaS edition)<br/>multi-tenant asset registry, check-out,<br/>stocktake, licenses, open API"]

  subgraph IDENT["Identity and billing"]
    IDP["Customer IdP<br/>Entra ID, Google Workspace, Okta<br/>SAML (MVP Should, per-connection add-on on Pro, in Enterprise),<br/>SCIM (v2, same add-on), OIDC (all tiers, free)"]
    SSOV["SSO and SCIM vendor<br/>bought, e.g. WorkOS<br/>(Cloud only; self-hosted v2 uses a bundled Keycloak broker)"]
    STRIPE["Stripe Billing<br/>subscriptions and usage"]
  end

  subgraph COMMS["Notifications"]
    MAIL["Email provider<br/>Amazon SES"]
    CHAT["Slack and Teams<br/>incoming webhooks (v1.1)"]
    PUSHX["Expo push service<br/>relays to APNs and FCM<br/>(Cloud only at MVP, Should;<br/>self-hosted via our license-gated relay, v1.1, proposed)"]
  end

  subgraph DATAIN["Data sources and sinks"]
    MDM["MDM and directory<br/>Intune and Entra ID, Google Admin ChromeOS (v1.1)<br/>Jamf, Kandji, NinjaOne (v2)"]
    SNIPE["Snipe-IT instance<br/>import source (MVP)"]
    CUSTHOOK["Customer webhook receivers<br/>Zapier, Make, scripts (MVP)"]
    ITSM["Customer ITSM<br/>Freshservice, Jira SM, ServiceNow (v3)"]
    LLM["AI model provider<br/>opt-in, zero retention (v2 to v3)"]
  end

  subgraph CUSTNET["Customer networks"]
    AGENT["Discovery agent on endpoints<br/>Win, macOS, Linux (v2)"]
    COLL["Collector container per site<br/>SNMP, WinRM, SSH, sweeps (v3)"]
  end

  ADM -->|"HTTPS"| SYS
  TECH -->|"HTTPS, camera scan"| SYS
  ENDU -->|"HTTPS"| SYS
  MSPO -->|"HTTPS, multi-company access"| SYS

  SYS <-->|"login, provisioning"| SSOV
  SSOV <-->|"SAML, SCIM"| IDP
  SYS <-->|"billing, webhooks"| STRIPE
  SYS -->|"alerts, digests, invites"| MAIL
  SYS -->|"alerts"| CHAT
  SYS -->|"push notifications"| PUSHX
  SYS <-->|"device and user sync"| MDM
  SYS -->|"pull via REST API"| SNIPE
  SYS -->|"signed webhooks"| CUSTHOOK
  SYS <-->|"incident and asset links"| ITSM
  SYS -.->|"prompts, no training"| LLM
  AGENT -->|"outbound HTTPS only"| SYS
  COLL -->|"outbound HTTPS only"| SYS

  classDef ext fill:#eceff1,stroke:#607d8b,color:#263238
  classDef sys fill:#dff5e1,stroke:#2e7d32,color:#1b3a1f
  classDef later fill:#fff3d6,stroke:#b26a00,color:#3d2a00
  classDef v3 fill:#e0ecff,stroke:#1d5fb4,color:#102a54
  class IDP,SSOV,STRIPE,MAIL,CHAT,PUSHX,MDM,SNIPE,CUSTHOOK ext
  class SYS sys
  class MSPO,AGENT later
  class ITSM,COLL,LLM v3
```

Notes:
- The SSO vendor sits between the platform and the customer IdP, so SAML metadata, certificate rotation and SCIM endpoints are the vendor's problem (plan 12 decision 4). First-party email + password, MFA and Google/Microsoft OIDC bypass the vendor. Vendor cost is billed per active connection (WorkOS about $125 per month for SSO plus $125 for Directory Sync; validation: technical), which is why SAML and SCIM are a paid per-connection add-on rather than part of the Pro base price (decided 2026-11-17, plan decision 7 updated).
- This diagram is the **Cloud edition**. The Self-hosted edition has the same actors and clients but a different set of external systems: a license file replaces Stripe, customer SMTP replaces SES, built-in OIDC replaces the SSO/SCIM vendor in the MVP (a bundled Keycloak broker adds SAML in v2, proposed), push goes through our license-gated relay in v1.1 (no push at MVP), and nothing else phones home (section 7.3 has the self-hosted deployment view).
- Agents and collectors are **outbound-only** (plan 6.4). The platform never connects into customer networks. In the self-hosted edition they point at the customer's own base URL.
- Snipe-IT is a one-time import source, not a continuing integration.

---

## 3. Container view (C4 level 2)

"Container" here is the C4 term (a separately runnable unit). The Docker mapping: API, worker, scheduler and ingest are the **same Docker image** started with different roles. The diagram and table below describe the **Cloud edition** (cell, S3, SES, Stripe, bought SSO vendor); the Self-hosted edition runs the same roles with adapters swapped (section 7.3).

```mermaid
flowchart TB
  subgraph CLIENTS["Clients"]
    WEB["Next.js web app (static export)<br/>admin and desktop UI, client-side fetching<br/>static assets on S3 + CloudFront<br/>MVP"]
    MOBILE["Expo app (React Native)<br/>technician flows, online-first with retry queue<br/>offline-first (expo-sqlite, mutation queue) v2<br/>MVP"]
    PUBAPI["API clients, scripts, Zapier<br/>API keys<br/>MVP"]
  end

  subgraph CELL["Cell us-1: one full stack (MVP). EU and dedicated cells are copies (v3)"]
    API["API role<br/>NestJS on Fastify, REST /v1<br/>authn, tenant context, RBAC<br/>includes control-plane module<br/>MVP"]
    WORKER["Worker role<br/>imports, exports, reports, webhooks,<br/>connector syncs, thumbnails, scan jobs<br/>MVP"]
    SCHED["Scheduler role<br/>cron per tenant: expiry scans, digests<br/>MVP"]
    INGEST["Ingest role<br/>agent and collector endpoint,<br/>validate, stage, enqueue reconcile<br/>v2"]
    PG[("PostgreSQL 18<br/>RLS, tenant_id, JSONB, FTS, trigram<br/>job queue tables, outbox, audit log<br/>MVP")]
    REDIS[("Redis, small<br/>rate limits, cache<br/>MVP")]
    S3[("S3 buckets<br/>attachments, exports, import files<br/>SSE-KMS, tenant-prefixed keys<br/>MVP")]
    CLAM["ClamAV service<br/>virus scan of uploads<br/>MVP"]
    SEARCH[("OpenSearch<br/>replaces Postgres FTS when thresholds hit<br/>v3, earliest v2")]
  end

  subgraph BOUGHT["Bought services"]
    SSOV2["SSO and SCIM vendor<br/>SAML MVP Should, SCIM v2<br/>per-connection add-on on Pro, in Enterprise"]
    STRIPE2["Stripe Billing<br/>MVP"]
    SES2["Amazon SES<br/>MVP"]
    PUSH["Expo push service<br/>relays to APNs and FCM<br/>MVP Should, Cloud only"]
  end

  subgraph OUTSIDE["Customer side"]
    HOOKS["Customer webhook receivers<br/>MVP"]
    AGT["Discovery agent, Go<br/>v2"]
    COL["Collector container, Go<br/>v3"]
    MDM2["MDM and directory APIs<br/>Intune, Entra ID, Google Admin ChromeOS v1.1"]
    SLACK["Slack and Teams<br/>v1.1"]
  end

  WEB -->|"HTTPS JSON, session cookie"| API
  PUBAPI -->|"HTTPS JSON, Bearer API key"| API
  WEB -->|"presigned PUT and GET"| S3
  MOBILE -->|"HTTPS JSON, Bearer access token, idempotent replay"| API
  MOBILE -->|"presigned PUT photos"| S3

  API -->|"SQL, tenant GUC per tx"| PG
  API --> REDIS
  API -->|"presign, head"| S3
  API <-->|"auth code exchange"| SSOV2
  API -->|"checkout, portal"| STRIPE2
  STRIPE2 -->|"billing webhooks"| API

  WORKER -->|"SQL, queue claim, tenant GUC"| PG
  WORKER --> S3
  WORKER -->|"INSTREAM scan"| CLAM
  WORKER --> SES2
  WORKER -->|"signed POST"| HOOKS
  WORKER --> SLACK
  WORKER -->|"connector sync"| MDM2
  WORKER -.->|"index updates"| SEARCH
  WORKER -->|"push messages (MVP Should)"| PUSH
  PUSH -.->|"APNs and FCM delivery"| MOBILE

  SCHED -->|"enqueue per-tenant jobs"| PG

  AGT -->|"HTTPS 443 outbound"| INGEST
  COL -->|"HTTPS 443 outbound"| INGEST
  INGEST -->|"stage and enqueue"| PG

  classDef mvp fill:#dff5e1,stroke:#2e7d32,color:#1b3a1f
  classDef v2 fill:#fff3d6,stroke:#b26a00,color:#3d2a00
  classDef v3 fill:#e0ecff,stroke:#1d5fb4,color:#102a54
  classDef ext fill:#eceff1,stroke:#607d8b,color:#263238
  class WEB,MOBILE,PUBAPI,API,WORKER,SCHED,PG,REDIS,S3,CLAM mvp
  class INGEST,AGT v2
  class SEARCH,COL v3
  class SSOV2,STRIPE2,SES2,PUSH,HOOKS,MDM2,SLACK ext
```

| Container | Phase | Technology | Responsibility | Scaling unit |
|---|---|---|---|---|
| Web app | MVP | Next.js (App Router) static export, React (plan 6.2, 6.5). Web camera scanning (BarcodeDetector, ZXing-js fallback because iOS Safari still lacks BarcodeDetector; validation: technical) is **Should** (raised from Could, 2026-11-17: fallback if store review slips, and it lets the beta compare native vs web scanning). The installable PWA (Serwist service worker) stays Could and needs a static-export spike before promotion (proposed). | Admin and desktop UI. Scanning on web is keyboard-wedge / USB scanner and manual tag entry (MVP), plus camera scanning when the Should item lands. Client-side fetching against `/v1` on the same origin. | CDN, nothing to scale (Cloud). Self-hosted: the same static export baked into the Caddy image (section 7.3) |
| Mobile app (Expo) | MVP (offline-first v2) | Expo SDK 58 (React Native), expo-camera (qr, code128 and datamatrix to be device-tested), expo-secure-store, EAS Build / Submit / Update (plan 6.5, decision 10); EAS Update code signing needs the **EAS Production plan** ($199/month plus usage; validation: technical); expo-sqlite arrives with offline-first in v2 | Technician and field flows only: scan, check-out/in, transfer, stocktake, photos, repair log. Online-first with a retry queue that replays with the same `Idempotency-Key` (MVP). Offline-first with a local SQLite copy and an outbound mutation queue is v2. Admin screens stay web-only. | Per device; store distribution plus MDM |
| Push relay | MVP Should (Cloud only) | Expo push service to APNs / FCM, called by the worker role (proposed). Self-hosted: **license-gated push relay operated by us, v1.1** (opt-in, needs outbound internet; air-gapped means no push; proposed) | Notifications to the mobile app. Expo push tokens belong to our Expo project, so a customer server cannot send directly (validation: technical) | Managed |
| API role | MVP | NestJS on Fastify | REST `/v1`, auth, tenant context, RBAC, presigning, control-plane endpoints, Stripe/vendor callbacks | Fargate tasks behind ALB, CPU / request-count autoscaling |
| Worker role | MVP | Same image, queue consumer | All asynchronous work (plan 6.3 items 2, 4, 5) | Tasks by queue depth |
| Scheduler role | MVP | Same image | Cron-like per-tenant job producers (plan 6.3 item 3) | 1-2 tasks. Safe to run two because schedules are singleton-keyed in the queue. |
| Ingest role | v2 | Same image, separate service and ALB target group | Agent/collector endpoint (plan 6.3 item 6). Separate service so a fleet spike cannot starve the interactive API. First extraction candidate. | Tasks by request rate |
| PostgreSQL 18 | MVP | RDS for PostgreSQL 18, Multi-AZ, PITR; PgBouncer in front once connection counts require it (section 7.1) | System of record. Queue, outbox, audit log live here too (plan 6.8, 6.10). | Vertical, then read replica (v2), then cell split |
| Redis | MVP (small) | ElastiCache | Per-tenant rate limits and short-lived caches (plan 6.2). Not a system of record; everything must work if flushed. | Single small node |
| S3 | MVP | SSE-KMS, versioning | Attachments, exports, import uploads (plan 6.6) | n/a |
| ClamAV | MVP | `clamav` container, `clamd` over TCP | Upload scanning (plan 6.6 names ClamAV). Own ECS service, deployment shape **proposed (not in plan)**. | 1-2 tasks |
| Search | MVP: Postgres FTS inside PG. v3 (earliest v2): OpenSearch | pg_trgm + tsvector; later OpenSearch (or Typesense, plan 6.2) | Global search; exact match on tag/serial is the critical path (plan 6.7) | Domain per cell |
| Control plane | MVP as module of API; separate deployable when a second cell exists | Tenant registry, plans, entitlements, billing webhooks, flags, support impersonation (plan 6.3 item 7). Self-hosted: `local` mode, one seeded tenant, entitlements read from the signed license file (section 7.3, proposed) | Source of truth for tenant to cell mapping | Global, small |
| Email | MVP | Amazon SES in the Cloud edition (plan 6.2 allows SES or Postmark; SES chosen for AWS locality); any SMTP server in the Self-hosted edition behind the `MailAdapter` (section 7.3, proposed) | Transactional and digest mail | Managed |
| Webhooks out | MVP | Worker role | Signed delivery with retries (plan 6.11) | With worker |
| Discovery agent | v2 | Go static binary, signed installers (plan 6.4) | Endpoint inventory | Customer-side |
| Collector | v3 | Go in a **Docker image** run by the customer | Agentless/network discovery per site (plan 6.4) | Customer-side |

**Decision: web as a Next.js static export on S3 + CloudFront (not a container).** The plan specifies a client-rendered React app with no server-side rendering, built with **Next.js (App Router) and `output: 'export'`** (plan 6.2). The product app has no SSR, no business logic in Next.js API routes or server actions, and Next.js never touches the database: it is a static bundle that fetches the NestJS REST API from the browser. A static bundle needs no process to patch, scale or health-check, is cheapest, and gives the web app global edge delivery. CloudFront also routes `/v1/*` to the ALB, so the browser sees one origin: no CORS, simple SameSite cookies, simple CSP. Containerising the app behind nginx or `next start` would add a Fargate service that does nothing the CDN does not. The web app is the admin/desktop UI; field scanning moves to the Expo app. Web camera scanning (BarcodeDetector, ZXing-js fallback; iOS Safari still has BarcodeDetector disabled, validation: technical) is **Should** (decided 2026-11-17, was Could), and an installable PWA (manifest plus a Serwist service worker) stays Could (proposed) and must be spiked against static export before promotion (Serwist is maintained, but its fit with `output: 'export'` is unverified; validation: technical); keyboard-wedge / USB scanners and manual tag entry cover web scanning in the MVP. **Static-export constraints (validation: technical, proposed):** Next.js 16 static export supports no dynamic routes without `generateStaticParams`, no `rewrites`, `redirects` or `headers`, no Proxy (the renamed middleware), no cookies, no Server Actions and no default image optimisation (use `images.unoptimized` or a custom loader). The earlier design, one prerendered shell page selected by a CloudFront Function rewrite for routes such as `/assets/:id`, is not a documented pattern and is dropped. Instead (proposed): detail pages use **query-string routes** (for example `/assets/view?id=...`), or the app is a single optional catch-all page (`[[...path]]`, `generateStaticParams` returning the empty path) hosting a client-side router, with CloudFront (custom error response) and Caddy serving `index.html` as an **SPA fallback** for unknown paths. Security headers (CSP, HSTS) come from the CloudFront response-headers policy in Cloud and from Caddy in self-hosted, never from Next.js config. A **week-1 spike** proves deep links, refresh, back/forward and QR-URL deep links before routes are built, and a **CI check** fails the web build if `proxy.ts`, `rewrites`, `redirects`, `headers` or Server Actions appear. A separate marketing/docs site may use Next.js SSG; it is outside the product scope. The web app still has a Dockerfile, but only for the `next dev` server and for a reproducible build stage (section 8.1). **Self-hosted exception (proposed):** the self-hosted edition has no S3 or CloudFront, so the same static export is baked into the Caddy image, which serves it and reverse-proxies `/v1` to the api container (section 7.3 and 8.7). That web container exists only in the self-hosted edition; the Cloud edition stays static on S3 + CloudFront, and the bundle is identical in both, so no API URL is baked in either way.

**Decision: native Expo app in the MVP, not a Capacitor wrapper or a PWA (plan 6.5, decision 10).** The field flows are an **Expo (React Native)** app from the MVP, because the plan's own limits for iOS PWAs (background sync, storage eviction, no Bluetooth/NFC; plan 6.5) hit the technician use case, and the app needs real push notifications. Scope is technician flows only (scan with expo-camera, check-out/in, transfer, stocktake, photos, repair log); admin screens stay web-only. The MVP app is **online-first with a retry queue** that resends failed mutations with the same `Idempotency-Key` (section 6.a). It uses the same REST API, mobile auth with OIDC + PKCE and refresh tokens in expo-secure-store (section 9), and Expo push relayed through the worker role (MVP Should). It is built and shipped by EAS (Build, Submit, Update), not Docker (section 8.3), and distributed through the App Store, Google Play and MDM (public or unlisted distribution, not Apple Custom Apps, validation: technical). Push is **Cloud-only at MVP**; self-hosted push needs a license-gated relay run by us (v1.1, proposed, section 7.3). **Full offline-first stays v2:** a local SQLite store (expo-sqlite), a per-asset mutation queue and the conflict rules (Appendix B item 24). **Pull-forward trigger resolved:** decided: Expo in MVP (plan decision 10).

---

## 4. Backend module breakdown

Modules live in one repository (the `apps/api` package of the monorepo, section 8.6) and one deployable. They map to the plan's module map (M1-M13, plan section 4) plus platform modules from plan 6.3.

Boundary rules (plan 6.2: "public-API-only rule between modules"):
1. A module owns its tables. No module reads or writes another module's tables; it calls that module's exported **facade** (a TypeScript interface) or subscribes to its **domain events**.
2. Dependencies point downward in the diagram: domain modules depend on the platform kernel; the kernel depends on nothing in the domain.
3. Cross-module reads for reporting go through read-model query facades, not table joins, except inside `reporting`, which has an explicit allow-list of views (created `security_invoker`, plan 6.1).
4. Enforced in CI with a dependency-boundary lint (for example dependency-cruiser or ESLint boundaries; tool choice **proposed**) so a violation fails the build.
5. Only the repository layer in `tenancy` may import the DB client. Controllers and services cannot obtain a connection (see section 5).

```mermaid
flowchart TB
  subgraph DOMAIN["Domain modules"]
    REG["registry M1<br/>assets, models, categories, locations,<br/>custom fields, accessories, consumables<br/>MVP"]
    LIFE["lifecycle M2<br/>check-in and out, history, stocktake,<br/>disposal, acceptance<br/>MVP"]
    TAG["tagging M3<br/>QR and barcode, label PDFs, scan lookup<br/>MVP, fixed templates (editor v1.1)"]
    LIC["licenses M5<br/>licenses, seats, expiry<br/>MVP, compliance v2"]
    MAINT["maintenance M6<br/>repair log MVP Must<br/>PM and work orders v2 and v3"]
    FIN["finance M7<br/>vendors, warranty, cost<br/>contracts and POs v2"]
    IMP["importer M4<br/>CSV and XLSX, Snipe-IT, dry run<br/>MVP, rollback v1.1"]
    CONN["connectors M4 and M11<br/>Intune, Entra ID and Google Admin ChromeOS v1.1<br/>Jamf and others v2"]
    DISC["discovery M4<br/>devices, installed software, reconcile<br/>v2"]
    REP["reporting M9<br/>standard reports, dashboard, exports<br/>MVP, builder v2"]
    WF["workflow M10<br/>rules, approvals<br/>v2"]
    REL["relationships M8<br/>asset graph, ITSM links<br/>v3"]
    AI["ai M13<br/>mapping assist MVP Could<br/>NL query and normalization v3"]
  end

  subgraph PLATFORM["Platform kernel"]
    IAM["identity-access M12<br/>sessions, MFA, OIDC, SSO adapter,<br/>API keys, RBAC policy layer"]
    TEN["tenancy M12<br/>tenant context, withTenantTx,<br/>repository base, quotas"]
    AUD["audit M12<br/>append-only audit writer and reader"]
    EVT["events<br/>domain events and outbox"]
    JOBS["jobs<br/>queue adapter over pg-boss, tenant-aware handlers"]
    FILES["files<br/>S3 presign, attachments, scan, thumbnails"]
    NOTIF["notifications M9<br/>in-app, email, digests<br/>Slack and Teams v1.1"]
    HOOK["webhooks M11<br/>endpoints, signing, delivery log"]
    SRCH["search<br/>Postgres FTS now, OpenSearch later"]
    CP["control-plane M12<br/>tenant registry, cell map, plans,<br/>entitlements, flags, impersonation"]
    BILL["billing<br/>Stripe sync, usage meter<br/>Cloud edition only"]
    CRYPTO["crypto (proposed)<br/>KeyProvider, SecretsProvider,<br/>envelope encryption"]
  end

  LIFE --> REG
  TAG --> REG
  TAG --> LIFE
  LIC --> REG
  MAINT --> REG
  FIN --> REG
  IMP --> REG
  IMP --> LIC
  IMP --> FIN
  CONN --> REG
  CONN --> IAM
  DISC --> REG
  DISC --> LIC
  REP -.->|"read-only views"| REG
  REP -.->|"read-only views"| LIFE
  REP -.->|"read-only views"| LIC
  WF --> EVT
  WF --> LIFE
  REL --> REG
  AI --> REG

  REG --> TEN
  LIFE --> TEN
  LIC --> TEN
  REG --> AUD
  LIFE --> AUD
  LIC --> AUD
  REG --> EVT
  LIFE --> EVT
  LIC --> EVT
  REG --> FILES
  MAINT --> FILES
  IMP --> JOBS
  IMP --> FILES
  CONN --> JOBS
  CONN --> CRYPTO
  HOOK --> CRYPTO
  IMP --> CRYPTO
  DISC --> JOBS
  REP --> JOBS
  REG --> SRCH
  EVT --> NOTIF
  EVT --> HOOK
  EVT --> SRCH
  NOTIF --> JOBS
  HOOK --> JOBS
  IAM --> TEN
  IAM --> CP
  BILL --> CP
  TEN --> CP

  classDef mvp fill:#dff5e1,stroke:#2e7d32,color:#1b3a1f
  classDef v11 fill:#d9f2f0,stroke:#00796b,color:#06302c
  classDef v2 fill:#fff3d6,stroke:#b26a00,color:#3d2a00
  classDef v3 fill:#e0ecff,stroke:#1d5fb4,color:#102a54
  class REG,LIFE,TAG,LIC,IMP,REP,IAM,TEN,AUD,EVT,JOBS,FILES,NOTIF,HOOK,SRCH,CP,BILL,CRYPTO,MAINT,FIN mvp
  class CONN v11
  class DISC,WF v2
  class REL,AI v3
```

| Module | Plan ref | Owns (tables) | Exposes (facade / events) | Notes |
|---|---|---|---|---|
| registry | M1, 7.1 | asset, asset_model, manufacturer, category, custom_field_def, location, status_label, accessory, consumable, stock_movement, saved_view | `AssetsFacade.get/find/create/update`, events `asset.created`, `asset.updated` | Core. Custom values in JSONB, validated by definitions. `company_id` column populated with the default company from day one (plan 6.1). Hierarchy: MVP and v2 expose parent-child only (plan 1.5, 13.2); the asset table should allow deeper trees later for CMMS/EAM, e.g. a materialized path or `ltree` column (proposed). |
| lifecycle | M2 | assignment, stocktake, stocktake_item | `checkOut`, `checkIn`, `transfer`, events `asset.checked_out`, `asset.checked_in`, `asset.status_changed`, `stocktake.completed` | Owns the exactly-one-target check constraints (plan 7.3). |
| tagging | M3 | label_template (fixed templates MVP; template editor v1.1, plan decision 22) | `resolveScan(code)`, `renderLabels(assetIds)` | QR/Code128 generation, PDF sheets (rendered in worker). |
| licenses | M5 | license, license_seat | `LicensesFacade`, event `license.expiring` | Compliance joins discovery in v2 through facades only. |
| maintenance | M6 | maintenance_record (repair log MVP Must since 2026-11-17, was Should; loaner pool also Must); schedules, work orders v2/v3 | `MaintenanceFacade` | No longer the first MVP item on the cut line (plan 5.4) now that the repair log is a Must. |
| finance | M7 | vendor; contract, purchase_order v2 | `VendorsFacade` | MVP is vendors + purchase fields on asset. |
| importer | M4 | import_job, import_row | `startImport`, `dryRun`, `commit`; `rollback` (v1.1, plan decision 22) | Writes through registry/licenses facades so validation and audit are not bypassed. |
| connectors | M4, M11 | integration_connection, sync_state | connector SPI: `pull`, `map`, `reconcile` | Runs as worker jobs; credentials envelope-encrypted. First connectors (Intune + Entra ID, and the Google Admin ChromeOS device sync decided 2026-11-17) are v1.1 (plan decisions 9 and 22); the SPI lands with them. The MVP importer ships a Google Admin ChromeOS device CSV template. |
| discovery (v2) | M4 | discovery_source, discovered_device, installed_software, software_product | `reconcile(deviceId)` | The first module that can be extracted to its own deployable (plan 6.2, 5.4). Until then it is the `ingest` role of the same image. |
| reporting | M9 | report, scheduled_report (v2) | `runReport`, `exportCsv` | Reads via security-invoker views. |
| workflow (v2) | M10 | rule, rule_execution | consumes domain events | Reuses the MVP event and webhook infrastructure (plan 5.4). |
| relationships (v3), ai (v2-v3) | M8, M13 | asset_relationship; ai_request_log | | AI is opt-in per tenant; provider is a subprocessor (plan 9, 12.16). |
| identity-access | M12, 6.12 | user_account, role, role_assignment, api_key, session, invitation, sso_connection | `Principal`, `PolicyService.can()` | Permission strings `resource:action`; scope = tenant / company / location subtree. |
| tenancy | M12, 6.1 | none (infrastructure) | `withTenantTx`, `TenantRepository` base | The only code allowed to import the DB driver. |
| audit | M12, 6.10 | audit_log | `AuditWriter.record(tx, ...)` | App role has INSERT/SELECT only. |
| events | 6.8, 6.9 | outbox_event | `publish(tx, event)` | Transactional outbox. |
| jobs | 6.8 | queue tables (pg-boss 12.x, schema `pgboss`) | `enqueue(tx, name, {tenantId, ...})` | Wrapper forces `tenantId` into every payload and opens tenant context before handlers run. Payloads are **ids only** because `pgboss` tables have no RLS (section 5.2, 5.3). Sits behind a thin **queue adapter** interface (proposed) so pg-boss can be swapped (single-maintainer risk; validation: technical). |
| files | 6.6 | attachment | `presignUpload`, `presignDownload`, `scan` | Tenant-prefixed keys; scan status gates downloads. Owns the `StorageAdapter` (S3 in Cloud; any S3-compatible store or a local-filesystem fallback in Self-hosted; proposed, section 7.3). |
| notifications, webhooks | 6.9, 6.11 | notification_rule, notification, webhook_endpoint, webhook_delivery | | Consume outbox events. `notifications` owns the `MailAdapter` (SES or SMTP) and the `PushAdapter` (Expo push; optional in Self-hosted); proposed, section 7.3. |
| crypto (proposed) | 9 | none | `KeyProvider.wrap/unwrap`, `SecretsProvider.get`, envelope-encryption helper | Platform kernel helper (proposed) that owns the `KeyProvider` (AWS KMS in Cloud; master key from a Docker secret in Self-hosted, Vault or cloud KMS adapter in v2) and the `SecretsProvider` (Secrets Manager or env / Docker secrets). Callers (connectors, webhooks, importer) never touch KMS directly. |
| search | 6.7 | tsvector columns / OpenSearch client | `index`, `query` | Every document and cache key carries `tenant_id`. |
| control-plane | 6.1, 6.3 | tenant (registry), company, plan, entitlement, cell_map, feature_flag | `resolveTenant`, `entitlementsFor` | Not RLS-scoped by tenant (it *is* the tenant registry); accessed by a restricted role/schema (section 5.3). Entitlements are module-level flags (for example `module:sam`, `module:fam`, `module:cmms`) checked via `entitlementsFor`, not hardcoded per feature (plan 13.2). Owns the `EntitlementSource` adapter: Stripe-derived entitlements (Cloud) or the signed license file (Self-hosted `local` mode, section 7.3); flags are checked identically either way. |
| billing | M12, 5.3 | usage_meter, stripe_customer | Stripe webhook handler | Cloud edition only; not loaded in Self-hosted. Plan limits enforced via entitlements. Stripe subscriptions carry the asset-band price plus one add-on subscription item per paid future module; entitlements derive from the active subscription items (plan 8.1, 13.2). |

---

## 5. Multi-tenancy and request flow

### 5.1 Request lifecycle

Tenant identity comes **only** from the authenticated principal (session or API key), never from a client-supplied header or body field. The hostname (vanity subdomain, **proposed**) is a routing hint: if it disagrees with the principal's tenant the request is rejected.

```mermaid
sequenceDiagram
  autonumber
  participant C as Client
  participant E as CloudFront and ALB
  participant A as API role (Fastify)
  participant R as Redis
  participant P as PostgreSQL

  C->>E: HTTPS request with session cookie or Bearer API key
  E->>A: forward with X-Request-Id and client IP
  A->>R: rate-limit check by tenant and key
  R-->>A: allowed
  A->>P: authn lookup in identity schema (no tenant GUC needed)
  P-->>A: principal with tenant_id, actor, scopes, roles
  A->>A: tenant resolution - tenant active, cell matches, entitlement cache
  A->>A: authorize - policy.can(principal, "asset:checkout", scope)
  A->>P: BEGIN
  A->>P: set_config app.tenant_id, app.actor_id, app.request_id (is_local = true)
  A->>P: business queries via TenantRepository
  Note over P: RLS USING and WITH CHECK filter on tenant_id. FORCE RLS applies to the owner as well
  P-->>A: rows of this tenant only
  A->>P: INSERT audit_log and INSERT outbox_event (same transaction)
  A->>P: COMMIT
  Note over P: SET LOCAL values vanish at commit, nothing leaks to the next pooled borrower
  A-->>C: 2xx with body and X-Request-Id
  Note over A,P: any error causes ROLLBACK, so data, audit row and outbox row are all discarded
```

Key points:
- **Pre-tenant lookups** (session, API key hash, SSO domain map, invitation token) cannot run under tenant RLS because the tenant is not yet known. They read small lookup tables in a separate `identity` schema that holds only hashes and ids and is granted narrowly to the app role. This is a **proposed (not in plan)** resolution of a gap in the plan (Appendix A, item 2). `SECURITY DEFINER` functions are avoided because the plan's lint bans them (plan 6.1).
- **Location scoping** (plan 6.12) is applied in the application layer by `TenantRepository` (subtree filter on an indexed location path, path encoding proposed). RLS stays tenant-only so policies remain simple and fast. Revisit if a leak-class bug appears.
- **Idempotency** (plan 6.11): POSTs carrying `Idempotency-Key` store key + response hash in a tenant-scoped table inside the same transaction (table proposed).
- `tenant_id` goes onto traces and logs as an attribute, not onto metric labels, to avoid cardinality blow-up (plan 5.3 asks for tenant_id in logs/metrics/traces; per-tenant views come from logs and traces).

### 5.2 Background job tenant context

Queue tables are not tenant-owned (plan 6.1 pitfall). Every payload carries `tenant_id`, and the worker wrapper makes tenant context mandatory.

```mermaid
sequenceDiagram
  autonumber
  participant S as Scheduler role
  participant Q as Queue tables (pg-boss)
  participant W as Worker role
  participant P as PostgreSQL
  participant CP as Control-plane registry

  S->>CP: list active tenants for this cell (id, status only)
  CP-->>S: tenant ids
  S->>Q: enqueue expiry.scan with tenant_id, singleton key tenant and day
  W->>Q: fetch job (SKIP LOCKED, polling every 1-2 s, no LISTEN/NOTIFY), per-tenant concurrency limit applies
  Q-->>W: job with payload tenant_id and entity ids only
  W->>CP: verify tenant exists and is active
  W->>P: BEGIN
  W->>P: set_config app.tenant_id, app.actor_id = system job id (is_local = true)
  W->>P: handler reads and writes via TenantRepository
  W->>P: INSERT audit_log (actor_type system) and outbox_event
  W->>P: COMMIT
  W->>Q: mark job complete
  Note over W,Q: on failure, retry with backoff, then dead-letter queue visible to admins
  Note over S,W: no BYPASSRLS role anywhere. Cross-tenant sweeps are loops of per-tenant jobs
```

Handlers for long jobs (import, export) process in batches, **one short transaction per batch**, re-setting the GUC each time, so no single tenant holds a long transaction or connection.

**pg-boss configuration (pg-boss 12.x, Node 22.12+, PostgreSQL 13+; validation: technical, validation: spike).** pg-boss serialises internally with `pg_advisory_xact_lock` (transaction-scoped, so pooler-safe) and claims jobs with `SKIP LOCKED`; the spike ran 100 of 100 jobs through PgBouncer in transaction mode with zero RLS violations. Rules (proposed):
- **No LISTEN/NOTIFY behind a pooler.** Leave `useListenNotify` at false and create no queues with `notify: true`; LISTEN does not work in transaction pooling and fails silently (no warning). Workers **poll every 1-2 s**. If low latency is ever needed, give pg-boss its own direct (non-pooled) connection string for LISTEN.
- **Schema creation and pg-boss upgrades run in the `migrate` step over a direct connection as `migrator`.** Runtime instances start with `createSchema: false`, `migrate: false`, `supervise: false`, `schedule: false` as the `app` role. **One maintenance instance** (supervise on) runs as the owner role, for example inside the scheduler role.
- **Grants:** the runtime role gets `USAGE` on schema `pgboss`, DML on its tables and sequences and `EXECUTE` on its functions; re-run the grant after each pg-boss upgrade, or use `ALTER DEFAULT PRIVILEGES FOR ROLE migrator IN SCHEMA pgboss`.
- **Transactional enqueue:** `send(..., { db: { executeSql } })` inside the tenant transaction, so the job and the data change commit or roll back together (alongside the outbox, A5).
- **`pgboss` tables have no RLS**, so the `app` role can read every tenant's job payloads: payloads carry **ids only** (`tenantId`, entity ids), never PII or secrets (section 5.3).
- **Queue adapter:** `jobs` hides pg-boss behind an adapter interface (single maintainer is a bus-factor risk; fallbacks are Graphile Worker 0.x, which has no poll-only mode, or SQS).

### 5.3 Summary of RLS safeguards

Each safeguard maps to the pitfalls in plan 6.1 and the isolation tests in plan 9.

| Risk (plan 6.1) | Safeguard in this architecture | Verified by |
|---|---|---|
| Pooling leaks tenant GUC | `set_config(..., true)` only inside an explicit transaction opened by `withTenantTx`; no session-level `SET`; app never holds session state | Test: fresh pooled connection sees no tenant, including after a transaction that failed mid-way and rolled back. CI runs the isolation suite against direct Postgres **and** through PgBouncer 1.26.1+ in transaction mode (section 8.2), and the pooled pass includes a **negative control** (a deliberate session-level `SET` leak on a `pool_size=1` alias that the harness must detect), so a green run proves the harness can see a leak (validation: spike). |
| Unset GUC | Policy uses `NULLIF(current_setting('app.tenant_id', true), '')::uuid` in both `USING` and `WITH CHECK`, so unset or `''` (what a reused pooled connection returns after a `SET LOCAL` transaction) gives NULL and zero rows. A bare `''::uuid` cast would raise error 22P02 instead (validation: technical). | Test: query without context returns 0 rows, insert fails, and a query on a connection reused after a tenant transaction returns 0 rows without error |
| Owner / superuser bypass | App role: non-owner, no BYPASSRLS. Migrations run as a separate `migrator` role. `ALTER TABLE ... FORCE ROW LEVEL SECURITY` on every tenant table. **FORCE does not bind superusers or BYPASSRLS roles**, so no application, replica, support or reporting role may be either (Appendix A.10). **FORCE side effect:** the owner with no tenant set sees 0 rows, so backfills and cleanup must set the tenant per run or use a controlled superuser path outside the application (section 8.5; validation: spike). | Schema lint in CI; role audit |
| Extra roles | Replica, reporting, support tooling and (v3) BI endpoint use roles that are themselves subject to RLS; no shared BYPASSRLS role | Role audit script in CI; quarterly access review |
| Views and functions | Views are `security_invoker = true` (PG15+, we run 18); `SECURITY DEFINER` banned | Schema lint |
| Cross-tenant FK | Composite FKs `(tenant_id, id)`; uniqueness is per tenant | Schema lint |
| Partitions | Querying the parent applies the parent's policies, but a query naming a **partition directly** uses only that partition's own RLS state (off by default) and leaks every tenant's rows if the app role holds privileges on it (spike: direct access returned all tenants; validation: spike). Rule: **grant the app role privileges on partitioned parents only, never on partitions.** Partitions (audit log, history, webhook deliveries) are created by the `migrator` role with no grants to `app` (new partitions do not inherit them), and `ALTER DEFAULT PRIVILEGES` must not cover partitions. Defence in depth (optional): enable `FORCE` plus the policy on each partition explicitly, because ENABLE/FORCE are not documented to recurse. | Schema lint fails if any role other than the owner holds privileges on a partition; **direct-partition test in the CI isolation suite** (expects permission denied) |
| Migrations/backfills | New table migration must include `tenant_id`, policy, FORCE and a leading-`tenant_id` index in the same change; backfills loop tenants explicitly and set the tenant per run (with FORCE an unscoped owner sees 0 rows, so a backfill or cleanup run without a tenant silently matches nothing) | Migration lint; two-tenant test of each backfill |
| Jobs/schedulers | Section 5.2. Payload IDs only; wrapper refuses to run a handler without tenant context. **`pgboss` tables carry no RLS** (the `app` role can read every tenant's job payloads), so payloads hold ids only, never PII or secrets (validation: spike). | Worker tests assert context; payload lint (ids only) |
| Caches and search | Keys and documents carry `tenant_id` | Test + review checklist |
| Application bug (wrong tenant id) | `TenantRepository` is the only DB access path; ESLint rule forbids importing the driver elsewhere | Lint; two-tenant harness replays every route with foreign tenant ids and tokens (expects 404/403) on each PR |
| Restore granularity | PITR restores the whole shared DB; single-tenant restore uses the per-tenant logical export (manual, slower) and is stated in the SLA | Quarterly restore drills |
| Unknown unknowns | External pen test with isolation scope before GA and annually; cell architecture bounds blast radius | Plan 5.1 exit criterion |

Policy shape (illustrative):

```sql
ALTER TABLE asset ENABLE ROW LEVEL SECURITY;
ALTER TABLE asset FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON asset
  USING      (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid))
  WITH CHECK (tenant_id = (SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid));
-- NULLIF is mandatory: after a SET LOCAL transaction a pooled connection returns '' (not NULL),
-- and a bare ''::uuid cast raises 22P02. The (SELECT ...) wrapper evaluates it once per statement.
-- Partitioned tables: GRANT to the app role on the parent only; never on partitions.
```

**Self-hosted runs single-tenant, and RLS stays on (proposed, plan decision 13).** A self-hosted install has exactly one tenant row, seeded at install time, but it uses the same schema, the same `withTenantTx` path, the same `app` and `migrator` roles, the same FORCE RLS policies and the same `TenantRepository` as the Cloud edition. There is deliberately no "single-tenant shortcut" that skips the tenant context: one code path means the isolation suite, schema lint and migration lint that protect Cloud also protect every self-hosted release, and a later move from self-hosted to Cloud (or the reverse) needs no schema change. `company_id` scoping stays available inside the one tenant. Cells do not apply (the tenant-to-cell lookup returns a constant `local`). Details in section 7.3.

---

## 6. Key flows

### 6.a Mobile QR scan and check-out (MVP, Expo app online-first)

The MVP flow runs in the Expo app, online-first with a retry queue (plan decision 10). The label QR encodes a URL containing an opaque per-asset code (not the internal id, not guessable; **proposed**). Scanning while logged out goes to login first and reveals nothing. Code128 labels encode the human asset tag and use `GET /v1/assets?tag=`.

```mermaid
sequenceDiagram
  autonumber
  actor T as Technician
  participant APP as Expo app (expo-camera, retry queue)
  participant API as API role
  participant PG as PostgreSQL
  participant S3 as S3
  participant W as Worker role
  participant CL as ClamAV

  T->>APP: scan label with camera (expo-camera)
  APP->>API: GET /v1/scan/resolve?code=...
  API->>PG: tenant tx, find asset by code (RLS + location scope)
  PG-->>API: asset, status, current assignment, allowed actions
  API-->>APP: asset card with Check out action
  T->>APP: pick assignee, expected return, take photo
  APP->>API: POST /v1/attachments (type, size) to request upload
  API->>PG: insert attachment row, scan_status pending
  API-->>APP: presigned PUT URL (size and type conditions, tenant-prefixed key)
  APP->>S3: PUT photo
  APP->>API: POST /v1/assets/:id/checkout with Idempotency-Key and If-Match ETag
  API->>PG: BEGIN, set tenant context
  API->>PG: SELECT asset FOR UPDATE, verify state deployable
  API->>PG: INSERT assignment, UPDATE asset status, link attachment
  API->>PG: INSERT audit_log and outbox_event asset.checked_out
  API->>PG: COMMIT
  API-->>APP: 201 checkout record
  Note over APP,API: on network failure the app retry queue resends with the same Idempotency-Key. A concurrent checkout returns 409 and the app refreshes the card
  PG-->>W: outbox relay and queued jobs (attachment.scan, notify, webhooks)
  W->>S3: stream photo
  W->>CL: INSTREAM scan
  CL-->>W: clean
  W->>PG: set scan_status clean, enqueue thumbnail
  W->>PG: notify assignee (email and in-app), deliver webhooks
```

The photo is shown only after `scan_status = clean`; until then the check-out is already committed (the record is not blocked on the scan).

**v2 variant: offline-first (proposed).** The server-side steps are identical (same endpoints, same `Idempotency-Key` and `If-Match` handling); what changes is that the app works from a local SQLite copy and replays queued mutations when connectivity returns.

```mermaid
sequenceDiagram
  autonumber
  actor T as Technician
  participant APP as Expo app (expo-camera)
  participant DB as Local SQLite and mutation queue
  participant API as API role
  participant PG as PostgreSQL

  T->>APP: scan label while offline
  APP->>DB: resolve code from the synced asset cache
  DB-->>APP: asset card as of last sync, with ETag
  T->>APP: pick assignee, take photo
  APP->>DB: apply change locally, store photo on device, enqueue checkout mutation with new Idempotency-Key and base ETag
  APP-->>T: shown as pending sync (unsynced items list)
  Note over APP,DB: connectivity returns, queue drains in order
  APP->>API: upload queued photos via presigned PUT, then POST /v1/assets/:id/checkout with Idempotency-Key and If-Match
  API->>PG: BEGIN, tenant context, SELECT asset FOR UPDATE, check state and ETag
  alt applies cleanly
    API->>PG: INSERT assignment, audit_log, outbox_event, COMMIT
    API-->>APP: 201 checkout record
    APP->>DB: mark mutation done, refresh local row
  else conflict (asset already checked out or changed)
    API-->>APP: 409 with current server state
    APP->>DB: mark mutation conflicted, keep local intent
    APP-->>T: surface conflict, technician retries or discards
  end
  Note over APP,API: a retry after a lost response reuses the same Idempotency-Key and gets the stored response
```

Conflict rules (v2, proposed): field edits to the same asset resolve **last-writer-wins per field**, with each overwritten value kept in the audit log; **check-out, check-in and transfer never merge**: a stale or contradictory one is rejected with 409 and surfaced to the technician (reject-and-surface). The queue is ordered per asset, mutations carry client timestamps for audit only (the server clock decides order), and photos upload before the mutation that references them.

### 6.b CSV and Snipe-IT import with dry run (MVP)

Import is a flagship feature (plan P1, risk 9). The invariant: **dry run touches no registry data**; commit records before-images so that undo can be added in v1.1 (import undo is cut from the MVP, plan decision 22; the dry run stays).

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin
  participant UI as Web app
  participant API as API role
  participant S3 as S3
  participant PG as PostgreSQL
  participant W as Worker role
  participant SN as Snipe-IT API

  alt CSV or XLSX source
    A->>UI: choose file
    UI->>API: POST /v1/imports (source csv)
    API-->>UI: import id and presigned PUT
    UI->>S3: upload file
    UI->>API: POST /v1/imports/:id/analyze
    API->>PG: enqueue analyze job
    W->>S3: read header and sample rows
    W->>PG: store suggested column mapping (heuristics, AI assist optional)
    Note over W: AI mapping is Could. Sample cells go to the model provider only if the tenant opted in
  else Snipe-IT source
    A->>UI: enter Snipe-IT URL and API token
    UI->>API: POST /v1/imports (source snipeit)
    API->>PG: store token envelope-encrypted, enqueue pull job
    W->>SN: paginated GET in dependency order (categories, models, locations, users, assets, licenses, accessories, consumables, history)
    Note over W,SN: SSRF-safe HTTP client, rate-limit aware, resumable
    W->>PG: write staged rows (import_row)
  end
  A->>UI: review and edit mapping
  UI->>API: POST /v1/imports/:id/dry-run
  API->>PG: enqueue dry-run job
  W->>PG: per batch tx, validate every row, de-dupe on serial and tag, record outcome create or update or skip or error
  W-->>UI: progress via polling
  UI-->>A: preview, counts, downloadable error report
  A->>UI: Commit
  UI->>API: POST /v1/imports/:id/commit
  API->>PG: enqueue commit job
  loop batches of N rows
    W->>PG: BEGIN, set tenant context
    W->>PG: apply via registry and licenses facades, record created ids and before-images in import_row
    W->>PG: audit_log with import_job_id, outbox events
    W->>PG: COMMIT
  end
  W->>PG: state completed, delete Snipe-IT token
  opt Undo requested (v1.1, not in the MVP)
    A->>UI: Rollback
    UI->>API: POST /v1/imports/:id/rollback
    W->>PG: archive created rows, restore updated rows from before-images (batched, audited)
  end
```

Notes: imports are quota-limited per tenant; commit batches use the low-priority "bulk" queue class so interactive traffic wins (plan 6.8). Rollback (v1.1) restores rows still in the state the import left them; rows edited afterwards are flagged for review instead of overwritten (behaviour proposed).

### 6.c Outbound webhook delivery with signing and retry (MVP)

```mermaid
sequenceDiagram
  autonumber
  participant D as Domain module
  participant PG as PostgreSQL
  participant R as Outbox relay (worker)
  participant Q as Queue
  participant W as Delivery worker
  participant K as AWS KMS
  participant X as Customer endpoint

  D->>PG: same tx as the change - INSERT outbox_event (asset.checked_out)
  R->>PG: claim new outbox rows per tenant
  R->>PG: find active endpoints subscribed to event type (tenant context)
  R->>PG: INSERT webhook_delivery (pending, attempt 0) per endpoint
  R->>Q: enqueue webhook.deliver with tenant_id and delivery id
  W->>Q: fetch job
  W->>PG: BEGIN, set tenant context, load endpoint and payload
  W->>K: Decrypt wrapped data key for the endpoint secret (encryption context tenant_id)
  K-->>W: data key
  W->>W: body = API representation. signature = HMAC-SHA256(secret, timestamp + "." + body)
  W->>W: resolve DNS, reject private and link-local IPs, pin connection to the validated IP
  W->>X: POST body with X-Signature, X-Timestamp, X-Event-Id, 10 s timeout
  alt 2xx
    X-->>W: 200
    W->>PG: delivery succeeded, store status code and latency
  else non-2xx or timeout
    X-->>W: error or no response
    W->>PG: delivery failed, attempt + 1
    W->>Q: re-enqueue with exponential backoff and jitter
    Note over W,Q: retry schedule proposed - about 8 attempts over about 24 h, then dead
    W->>PG: after final attempt mark dead and notify tenant admins
  end
  Note over W,X: receiver verifies signature, rejects timestamps older than 5 min, de-dupes on X-Event-Id (at-least-once delivery)
  opt Admin replay
    D->>PG: admin clicks Replay on a delivery, new delivery row created and enqueued
  end
```

Semantics: at-least-once, per-endpoint ordering not guaranteed (event id and timestamp are included for the receiver). Secret rotation keeps the old secret valid for a short overlap window (plan 6.11 per-endpoint rotation; overlap length proposed). Repeatedly failing endpoints are auto-paused (threshold proposed). In the self-hosted edition the `KeyProvider` adapter (master key from a Docker secret) replaces AWS KMS in the decrypt step, with the same encryption-context check (section 7.3, 9).

### 6.d SSO login (SAML via vendor, MVP Should; self-hosted SAML via Keycloak broker, v2)

OIDC (Google, Microsoft) is first-party and follows the same shape without the vendor hop. SAML/SCIM use the bought vendor (plan 12 decision 4) in the Cloud edition, sold as a **per-connection add-on on Pro and included in Enterprise** (decided 2026-11-17, plan decision 7 updated; OIDC login stays free on every tier; the vendor bills per active connection, so the cost lands only on tenants that use SSO, validation: technical). The add-on is an entitlement item per connection (proposed). The self-hosted edition cannot depend on an internet-reachable vendor, so it uses the built-in OIDC flow in the MVP (customer IdP such as Entra ID, Okta or Keycloak, same code path as above minus the vendor hop). **Self-hosted SAML (v2) goes through an optional bundled Keycloak broker** (compose profile `sso`) that speaks SAML to the customer IdP and OIDC to the app, so the app core stays **OIDC-only** and no in-app SAML library is shipped (proposed; updates the detail of plan decision 27, which named built-in libraries). Reason: `node-saml` and `samlify` both have recent critical signature-validation advisories (validation: technical), and patching in customer environments is slow; SAML parsing belongs in a widely scrutinised component. Self-hosted SCIM stays v2 and its mechanism is open (Keycloak or a first-party endpoint).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant B as Browser (web app)
  participant A as API role
  participant PG as PostgreSQL
  participant V as SSO vendor
  participant I as Customer IdP

  U->>B: enter work email
  B->>A: POST /v1/auth/start with email
  A->>PG: lookup SSO connection by email domain (identity schema)
  PG-->>A: tenant, connection id, SSO enforced flag
  A->>A: create state, nonce and PKCE verifier, store short-lived in Redis
  A-->>B: 302 to vendor authorize URL (connection id, state)
  B->>V: authorize
  V->>I: SAML AuthnRequest
  I->>U: login and MFA at IdP
  I-->>V: SAML assertion
  V-->>B: 302 to our callback with code and state
  B->>A: GET /v1/auth/callback?code=...&state=...
  A->>A: verify state, nonce, PKCE
  A->>V: exchange code for profile (email, idp subject, groups)
  V-->>A: verified profile
  A->>PG: BEGIN, set tenant context from the connection, not from the profile
  A->>PG: match user by idp subject or email, else JIT-provision with default role
  A->>PG: INSERT session, audit_log auth.login (method saml, ip, device)
  A->>PG: COMMIT
  A-->>B: Set-Cookie host-prefixed, HttpOnly, Secure, SameSite
  B-->>U: signed in, redirect to original page
  Note over A,PG: when SSO is enforced for the tenant, password and OIDC logins for that domain are refused. Break-glass owner account exempt (proposed)
```

SCIM (v2): the vendor calls our SCIM endpoint or pushes events to a vendor webhook; handler maps them to user and role-assignment changes in a tenant transaction. Deprovisioning revokes sessions and API keys of that user. In the self-hosted v2 variant, the "SSO vendor" participant `V` is the bundled Keycloak broker: the sequence is unchanged except that `V` runs on the customer host and the app only ever sees OIDC.

### 6.e Agent discovery ingest and reconciliation (v2)

```mermaid
sequenceDiagram
  autonumber
  actor A as Admin
  participant UI as Web app
  participant API as API role
  participant AG as Discovery agent
  participant IN as Ingest role
  participant PG as PostgreSQL
  participant W as Worker role

  A->>UI: create enrollment token (short-lived, per tenant)
  UI->>API: POST /v1/discovery/enrollment-tokens
  API->>PG: store token hash with expiry and policy toggles
  API-->>UI: token (shown once)
  A->>AG: deploy installer via MDM or GPO with token
  AG->>IN: POST /ingest/v1/enroll with token and device identifiers
  IN->>PG: validate token, create device credential (hash stored), tenant derived from token
  IN-->>AG: per-device credential
  loop daily with jitter, delta reports
    AG->>IN: POST /ingest/v1/report (gzip, signed with device credential)
    IN->>PG: resolve credential to tenant, BEGIN, set tenant context
    IN->>IN: validate schema, size limits, per-tenant and per-device rate limit
    IN->>PG: UPSERT discovered_device and installed_software (staging tables only)
    IN->>PG: enqueue reconcile job, COMMIT
    IN-->>AG: 202 with next-report hints and policy
  end
  W->>PG: reconcile job - match by serial, hardware UUID, MAC with confidence score
  alt high confidence match
    W->>PG: update allowed asset fields per source-precedence rules (manual over MDM over agent for curated fields)
    W->>PG: audit_log actor_type integration
  else no or weak match
    W->>PG: create review-queue item (discovered but not in registry)
  end
  W->>PG: recompute license compliance (installed vs owned), enqueue alerts
  Note over W,PG: scheduler job flags in registry but not seen in 60 days
  A->>UI: resolve review queue, accept as new asset, merge, or ignore
```

Agent self-update (signed, staged rings) is fetched from a versioned manifest endpoint on the ingest role; the signing keys live in KMS-backed signing (key custody detail proposed).

---

## 7. Deployment architecture (AWS, plus self-hosted in 7.3)

Sections 7.1 and 7.2 describe the **Cloud edition** on AWS. Section 7.3 describes the **Self-hosted edition**, which runs the same backend image on a customer's host.

### 7.1 One cell

One region (us-east), one VPC, three AZs available, two used at MVP (cost). Everything below except CloudFront and the DR vault is inside the region. Tasks get no public IPs.

```mermaid
flowchart TB
  USERS["Browsers, Expo app, API clients"]
  AGENTS["Agents v2 and collectors v3"]
  R53["Route 53<br/>vanity subdomain per tenant (proposed)"]
  GH["GitHub Actions<br/>OIDC role, no stored AWS keys"]

  subgraph EDGE["Edge"]
    CF["CloudFront<br/>/ to S3 web (Next.js static export, SPA fallback to index.html), /v1/* to ALB<br/>response-headers policy (CSP, HSTS)"]
    WAF["AWS WAF<br/>managed rules, bot control<br/>(proposed)"]
  end

  subgraph REGION["AWS region us-east: cell us-1"]
    S3WEB[("S3 web bucket<br/>hashed assets, OAC only")]
    S3FILES[("S3 files bucket<br/>SSE-KMS, versioning, tenant prefixes")]
    ECR["ECR<br/>immutable tags, scan on push"]
    SM["Secrets Manager<br/>DB credentials, Stripe, vendor keys"]
    KMS["KMS<br/>per-environment CMKs<br/>envelope encryption for app secrets"]
    SES["Amazon SES"]
    OBS["CloudWatch<br/>logs, metrics, alarms<br/>+ ADOT collector to APM"]

    subgraph VPC["VPC 10.0.0.0/16"]
      subgraph PUB["Public subnets, 2 AZ"]
        ALB["Application Load Balancer<br/>accepts only CloudFront"]
        NAT["NAT gateway"]
      end

      subgraph APP["Private app subnets, 2 AZ"]
        SAPI["ECS service: api<br/>Fargate, 2+ tasks"]
        SWORK["ECS service: worker<br/>Fargate, 2+ tasks"]
        SSCHED["ECS service: scheduler<br/>Fargate, 1-2 tasks"]
        SINGEST["ECS service: ingest (v2)<br/>Fargate, own target group"]
        SCLAM["ECS service: clamav"]
        TMIG["ECS one-off task: migrate<br/>role migrator"]
      end

      subgraph DATA["Private data subnets, 2 AZ"]
        POOL["Pooler: PgBouncer 1.26.1+ on Fargate (default)<br/>transaction mode, max_prepared_statements set<br/>2 tasks behind internal NLB<br/>(enabled when connection count requires)<br/>RDS Proxy optional after pinning test"]
        RDS[("RDS PostgreSQL 18<br/>Multi-AZ, PITR, KMS encrypted")]
        REDIS3[("ElastiCache Redis, small")]
        OS3[("OpenSearch domain (v3)")]
      end

      VPCE["VPC endpoints (proposed)<br/>S3, ECR, Secrets Manager, KMS, Logs"]
    end
  end

  subgraph DR["DR region (proposed: us-west)"]
    VAULT[("AWS Backup vault<br/>encrypted cross-region copies<br/>RDS snapshots and S3 replication")]
    ECRDR["ECR replica of images"]
  end

  USERS --> R53 --> WAF --> CF
  AGENTS --> R53
  CF -->|"static"| S3WEB
  CF -->|"/v1/*"| ALB
  AGENTS -->|"/ingest/*"| ALB
  ALB --> SAPI
  ALB --> SINGEST

  SAPI --> POOL
  SINGEST --> POOL
  SWORK -->|"direct connection"| RDS
  SSCHED -->|"direct connection"| RDS
  TMIG -->|"direct connection"| RDS
  POOL --> RDS
  SAPI --> REDIS3
  SAPI --> S3FILES
  SWORK --> S3FILES
  SWORK --> SCLAM
  SWORK -->|"via NAT"| NAT
  NAT -->|"webhooks, MDM, Slack, Snipe-IT, Stripe"| EXT["Internet"]
  SWORK --> SES
  SAPI --> SM
  SWORK --> KMS
  SAPI --> KMS
  SAPI --> OBS
  SWORK --> OBS
  GH -->|"push image, run task, update service"| ECR
  GH -->|"sync assets, invalidate"| S3WEB
  ECR -.-> SAPI
  RDS -.->|"snapshots, log shipping"| VAULT
  S3FILES -.->|"replication"| VAULT
  ECR -.->|"replication"| ECRDR

  classDef mvp fill:#dff5e1,stroke:#2e7d32,color:#1b3a1f
  classDef v2 fill:#fff3d6,stroke:#b26a00,color:#3d2a00
  classDef v3 fill:#e0ecff,stroke:#1d5fb4,color:#102a54
  classDef prop fill:#f3e5f5,stroke:#7b1fa2,color:#311b3f
  class SAPI,SWORK,SSCHED,SCLAM,TMIG,RDS,REDIS3,ALB,CF,S3WEB,S3FILES,ECR,SM,KMS,SES,OBS,NAT mvp
  class SINGEST v2
  class OS3 v3
  class WAF,VPCE,POOL,VAULT,ECRDR prop
```

(Purple = infrastructure details proposed beyond the plan, though the plan names the capability, such as cross-region backups and pooling.)

Design points:
- **Why direct connections for worker/scheduler/migrate:** pg-boss claims jobs with `SKIP LOCKED` and serialises with `pg_advisory_xact_lock`, both pooler-safe (validation: spike), but long batch transactions are simpler on direct connections, schema creation and pg-boss upgrades belong to the `migrator` role (section 5.2), and it keeps pooled slots for interactive traffic. The API and ingest roles go through the pooler once connection count demands it. At MVP scale (a few tasks) the API may connect directly; the code is pooler-safe either way (A6).
- **Pooler decision: PgBouncer is the default for Cloud, RDS Proxy is optional (validation: technical, validation: spike).** PgBouncer 1.26.1 or later in transaction mode passed the full isolation suite (9 tests plus a prepared-statement test) on PostgreSQL 16 and 18, and runs on Fargate (2 tasks behind an internal NLB, proposed) and in local Compose. Set `max_prepared_statements` (for example 100): at 0, drivers that use named prepared statements break (`prepared statement "q1" already exists`); require PgBouncer 1.21+ and pin 1.26.1+ (earlier releases carry CVE-2025-12819). RDS Proxy is **not** adopted by default: AWS lists `SET` and `set_config` as pinning for PostgreSQL, offers no pinning filters there, and the "SET LOCAL does not pin" statement is documented only for MySQL; statements over 16 KB also pin (bulk imports). It may replace PgBouncer only after a **staging pinning test** shows zero pinned connections (CloudWatch `DatabaseConnectionsCurrentlySessionPinned`) with the production driver and a 16 KB-statement test. Graphile Worker is not used (it relies on LISTEN/NOTIFY with no poll-only mode); this document assumes **pg-boss** (Appendix A.7).
- **Database:** RDS for PostgreSQL 18 (latest minor; PG 16 community EOL is 2028-11, about 16 months after planned GA, and 18 has native `uuidv7()` and B-tree skip scan helpful for `(tenant_id, ...)` indexes; validation: technical) rather than Aurora at MVP (plan 6.2 allows either): simpler cost model for a small team; Aurora PostgreSQL 18 is GA and a candidate if read-replica or failover time becomes a constraint (proposed). PostgreSQL 19 is not a launch target. The spike showed identical RLS behaviour on 16 and 18.
- **ALB only accepts CloudFront** (managed prefix list plus a shared secret header, proposed) so WAF/headers cannot be bypassed. Agent traffic uses the same CloudFront distribution or a dedicated hostname with its own ALB listener rule (v2).
- **Egress:** workers reach the internet via NAT for webhooks, MDM, Snipe-IT and Stripe. The HTTP client validates resolved IPs against private, link-local and metadata ranges (plan 9 SSRF control). An egress proxy such as Smokescreen is a possible later hardening (proposed).
- **Observability** (plan 6.13): JSON logs to CloudWatch Logs; OpenTelemetry SDK exporting OTLP to an ADOT collector sidecar; APM backend (Grafana Cloud or Datadog) and Sentry per plan 6.2, final choice open. Alarms on 5xx, p95 latency, queue depth and age, DLQ size, RDS CPU/connections/replica lag, backup success. Synthetic checks run the scan flow and login (plan 6.13). Public status page.
- **Fargate sizing (proposed starting point):** api 0.5 vCPU / 1 GB, worker 1 vCPU / 2 GB, scheduler 0.25 vCPU / 0.5 GB, clamav 1 vCPU / 3 GB. Tune with load tests against the plan's p95 budgets.
- **IAM per role:** each role has its own ECS task role. api: presign S3 get/put, KMS decrypt/encrypt for its keys, read secrets. worker: S3 read/write, SES send, KMS. scheduler: queue only. migrate: no S3, no KMS; only the `migrator` DB secret. Roles are configuration of the same image (A4).
- **Backups and DR** (plan 9): RDS automated backups with PITR; daily snapshots kept 35 days; AWS Backup copy to a second region (encrypted); S3 versioning and cross-region replication of the files bucket; ECR replication so images exist in the DR region. Quarterly restore drills, timed. Regional-failure recovery means restoring from the DR vault and applying the Terraform cell module in the DR region (pilot-light is not pre-provisioned; consistent with RTO 4 h).

### 7.2 Cells (EU, large tenants)

A cell is one instance of the Terraform `cell` module: VPC, Fargate services, RDS, S3 buckets, KMS keys, Redis, (v3) OpenSearch. The platform runs one cell at MVP. A cell can be (a) a **regional cell** (EU, v3, plan 6.14) or (b) a **dedicated cell** for a large tenant, which is database-per-tenant in effect (plan 6.1 option C).

```mermaid
flowchart TB
  CLIENT["Browsers, Expo app, API clients, agents"]

  subgraph GLOBAL["Global control plane (small, US)"]
    CPDB[("Tenant registry<br/>tenant, cell, plan, region lock<br/>multi-company parent-child links (v2 Could)")]
    CPAPP["Control-plane service<br/>tenant creation, billing webhooks,<br/>entitlements, flags, support impersonation"]
    DNS["DNS and routing<br/>per-tenant host record or per-cell hostname<br/>(proposed)"]
    LOOK["Login directory<br/>email domain and tenant to cell<br/>(proposed)"]
  end

  subgraph CELLUS["Cell us-1 (MVP)"]
    US_APP["api, worker, scheduler, ingest"]
    US_DB[("RDS Postgres, S3, KMS")]
  end

  subgraph CELLEU["Cell eu-1 Frankfurt (v3)"]
    EU_APP["api, worker, scheduler, ingest"]
    EU_DB[("RDS Postgres, S3, KMS")]
  end

  subgraph CELLDED["Dedicated cell for a large tenant (v3)"]
    DED_APP["api, worker, scheduler, ingest"]
    DED_DB[("RDS Postgres, S3, KMS<br/>single tenant")]
  end

  CLIENT --> DNS
  DNS --> US_APP
  DNS --> EU_APP
  DNS --> DED_APP
  CPAPP --> CPDB
  CPAPP --> LOOK
  CPAPP -.->|"push entitlement snapshot"| US_APP
  CPAPP -.->|"push entitlement snapshot"| EU_APP
  CPAPP -.->|"push entitlement snapshot"| DED_APP
  US_APP --> US_DB
  EU_APP --> EU_DB
  DED_APP --> DED_DB

  classDef mvp fill:#dff5e1,stroke:#2e7d32,color:#1b3a1f
  classDef v3 fill:#e0ecff,stroke:#1d5fb4,color:#102a54
  classDef prop fill:#f3e5f5,stroke:#7b1fa2,color:#311b3f
  class CPDB,CPAPP,US_APP,US_DB mvp
  class EU_APP,EU_DB,DED_APP,DED_DB v3
  class DNS,LOOK prop
```

How it works:
- **Same image everywhere.** All cells run the same image digest and Terraform module with different variables (region, sizing, KMS keys). No application change to add a cell (plan 6.1).
- **Tenant to cell mapping** is a control-plane row set at tenant creation and immutable without a migration (plan 6.14). The mapping exists at MVP.
- **Routing (proposed):** the control plane creates a per-tenant hostname record (`acme.<domain>`) pointing at the tenant's cell edge, so there is no runtime router to operate. Login at a global hostname uses the login directory to bounce a user to the right cell. API keys carry a cell hint in their prefix (proposed). Agent enrollment tokens embed the cell endpoint.
- **Entitlements** are pushed to each cell as a small snapshot so a cell keeps serving if the global control plane is down (proposed). Stripe webhooks land at the control plane only.
- **Constraints to state up front (proposed):** a multi-company (MSP console) parent and its child tenants must live in the same cell (plan 6.1 MSP link is a control-plane relation; the console itself is a v2 Could, decided 2026-11-17, and the `company_id` column stays; cross-cell delegated access is out of scope); EU tenants' personal data never leaves the EU cell except the minimised control-plane metadata documented in the DPA (plan 6.14).
- **Account topology (proposed):** separate AWS accounts for shared-services (ECR, GitHub OIDC), dev/staging, prod-us, and later prod-eu and dedicated cells, managed with AWS Organizations.
- **Rollouts across cells:** Terraform and migrations are applied cell by cell, a low-risk cell first (canary), then the rest.

### 7.3 Self-hosted deployment

Plan decision 13 (design in plan 6.15) puts a **Self-hosted edition** in the MVP alongside Cloud: closed source, sold under a commercial license key. This subsection is the architecture for it. Principles:

- **One codebase, one backend image, two editions.** The image with roles `api`, `worker`, `scheduler` and one-shot `migrate` is the same image the Cloud edition runs (A4, A10). The edition is runtime configuration plus a license, never a fork.
- **Single-tenant per install**, RLS still on (below).
- **MVP packaging is a Docker Compose bundle** (`docker-compose.yml`, `.env` template, install and upgrade docs; section 8.7). Helm for Kubernetes is v2 and an air-gapped install (offline image tarball plus offline license) is v2 Enterprise (decided, plan decision 27).
- **No mandatory phone-home.** Licensing is verified offline; outbound traffic is limited to optional integrations the customer enables.
- The customer operates the infrastructure (shared-responsibility model in section 9).

#### Deployment view of a customer host

```mermaid
flowchart TB
  subgraph CLIENTS["Customer users and clients"]
    BROW["Browsers<br/>admin and desktop UI"]
    EXPO["Expo app (store build)<br/>server URL, setup QR or MDM config"]
    APIC["API clients and scripts<br/>Bearer API key"]
  end

  subgraph HOST["Customer host: Linux, Docker Engine 24+ with Compose v2"]
    CADDY["Caddy (TLS, static web)<br/>customer certificate (default), public ACME,<br/>or tls internal (evaluation only)<br/>serves Next.js static export with SPA fallback<br/>sets security headers, proxies /v1 to api"]

    subgraph ONEIMG["Backend image, one image, four roles"]
      API["api"]
      WORKER["worker"]
      SCHED["scheduler"]
      MIGR["migrate (one-shot)"]
    end

    PGB["PgBouncer 1.26.1+ (proposed)<br/>transaction mode<br/>max_prepared_statements set"]
    PG[("PostgreSQL 18<br/>bundled container or bring-your-own 16-18")]
    REDIS[("Redis<br/>bundled container")]
    MINIO[("MinIO<br/>or customer S3-compatible store")]
    CLAM["ClamAV<br/>optional compose profile"]
    LICV[("License file volume<br/>mounted read-only")]
    SECR["Docker secrets<br/>master key, DB passwords"]
    KC["Keycloak broker<br/>optional compose profile sso (v2)<br/>SAML to IdP, OIDC to app"]
  end

  SMTP["Customer SMTP relay"]

  subgraph OPT["Optional outbound, customer opt-in"]
    OTEL["OTel collector<br/>or Prometheus scrape of /metrics"]
  end

  subgraph OURS["Our side"]
    REG["Signed image registry<br/>license-gated, cosign v3 signatures (OCI 1.1 referrers), SBOM"]
    ART["Release artifacts<br/>compose bundle, .env template,<br/>release notes, upgrade guide"]
    PUSHRELAY["Push relay (v1.1, proposed)<br/>license-gated, opt-in<br/>forwards to Expo push, APNs and FCM"]
  end

  BROW -->|"HTTPS 443"| CADDY
  EXPO -->|"HTTPS 443"| CADDY
  APIC -->|"HTTPS 443"| CADDY
  CADDY -->|"/v1 proxy"| API

  API -->|"pooled"| PGB
  WORKER -->|"pooled"| PGB
  SCHED -->|"pooled"| PGB
  PGB --> PG
  MIGR -->|"migrator role, direct (no pooler)"| PG
  API --> REDIS
  API -->|"presign, head"| MINIO
  WORKER --> MINIO
  WORKER -->|"INSTREAM scan"| CLAM
  WORKER -->|"SMTP"| SMTP
  API -->|"verify at boot and daily"| LICV
  SECR -.-> API
  SECR -.-> WORKER
  WORKER -.->|"push via relay (v1.1), none at MVP, off when air-gapped"| PUSHRELAY
  API -.->|"OIDC (v2)"| KC
  API -.->|"OTLP"| OTEL

  REG -->|"docker pull, cosign verify"| ONEIMG
  ART -->|"download bundle"| HOST

  classDef mvp fill:#dff5e1,stroke:#2e7d32,color:#1b3a1f
  classDef ext fill:#eceff1,stroke:#607d8b,color:#263238
  classDef prop fill:#f3e5f5,stroke:#7b1fa2,color:#311b3f
  classDef v2 fill:#fff3d6,stroke:#b26a00,color:#3d2a00
  class CADDY,API,WORKER,SCHED,MIGR,PG,REDIS,MINIO,CLAM,LICV,SECR mvp
  class BROW,EXPO,APIC,SMTP,OTEL ext
  class REG,ART,PUSHRELAY,PGB prop
  class KC v2
```

Notes: the web container exists only here (Caddy with the static export baked in); in Cloud the same export is served from S3 + CloudFront. ClamAV is on by default in the compose `scan` profile but optional; with it off, uploads skip scanning and the admin UI shows a warning (behaviour proposed). Bring-your-own Postgres 16, 17 or 18 is supported (the customer creates the `migrator` and `app` roles using a provided SQL script; the bundled container does it automatically, as in section 8.2; CI covers 16 and 18, validation: technical). The bundled image is `postgres:18`; verify its PGDATA and volume-mount layout in the compose bundle, which changed in 18 (unverified). The Keycloak broker is an optional v2 compose profile, not part of the MVP bundle (section 6.d). PgBouncer sits between the app roles and Postgres so self-hosted runs the same pooled code path that CI tests (proposed); the migrator, and with it pg-boss schema creation and maintenance, connect to Postgres directly, and bring-your-own Postgres installs may point PgBouncer at their database.

#### TLS modes (proposed; validation: technical)

The install wizard offers three modes for the bundled Caddy:

| Mode | When | Notes |
|---|---|---|
| 1. Customer-provided certificate and key (default recommendation) | Enterprise PKI already trusted on managed devices | Mounted as a volume (`TLS_CERT_FILE`, `TLS_KEY_FILE`); Caddy automatic HTTPS is disabled for those names. Works with the Expo app when the issuing CA is trusted on the device. |
| 2. Public ACME via Caddy | Host has a public DNS name | HTTP-01 or TLS-ALPN needs reachable ports 80 and 443; hosts with no inbound access use a **Caddy build with a DNS-provider plugin** (DNS-01, needs provider credentials). |
| 3. `tls internal` | Evaluation only | Caddy's internal CA. The root is trusted only where installed, and **Android apps ignore user-installed CAs by default** (API 24+ without a `network_security_config` opt-in), so the Expo app will not trust it unless MDM installs trust or a config plugin adds the opt-in (a broader-trust security cost). Docs warn that mode 3 is not for devices in the field. |

A **mobile TLS test** runs in the self-hosted CI matrix (section 8.3): the app against a server on a customer-supplied certificate chained to a private CA, and against `tls internal`, so regressions in trust handling show up before release.

#### Dependency abstraction (adapters)

Each infrastructure dependency is a TypeScript interface in the module that owns it, with a Cloud and a Self-hosted implementation compiled into the one image. A boot-time `EDITION` setting plus per-adapter settings pick the implementation; domain modules only see the interface (A10). All adapter interfaces (the six infrastructure adapters plus the `QueueAdapter` over pg-boss) and their owners are proposed (not in plan); the dependency choices come from the team's self-hosted decision (plan decision 13).

| Concern | Adapter (owner module) | Cloud (SaaS) | Self-hosted |
|---|---|---|---|
| Database | none (plain Postgres 18 in both) | RDS Postgres 18 behind PgBouncer | Bundled `postgres:18` container or bring-your-own Postgres 16-18 (CI matrix 16 and 18), behind a bundled PgBouncer 1.26.1+ (proposed) |
| Object storage | `StorageAdapter` (files) | S3 | Any S3-compatible store: bundled MinIO, or customer S3 / Azure via the S3 API. Fallback (decided, plan decision 28): local filesystem volume adapter |
| Email | `MailAdapter` (notifications) | SES | Any SMTP server |
| Encryption keys | `KeyProvider` (crypto) | AWS KMS envelope encryption | Master key from file or env (Docker secret). HashiCorp Vault or cloud KMS adapter in v2 |
| Secrets | `SecretsProvider` (crypto) | Secrets Manager | Env and Docker secrets |
| Entitlements and billing | `EntitlementSource` (control-plane; `billing` loads only in Cloud) | Stripe subscription items | `LicenseFile` (signed file, no Stripe) |
| Push | `PushAdapter` (notifications) | Expo push from the worker | **None at MVP (Cloud-only push).** v1.1: license-gated push relay operated by us, opt-in, needs outbound internet; off when air-gapped (proposed). Expo push tokens belong to our Expo project, so a customer server cannot send directly (validation: technical) |
| Jobs | `QueueAdapter` over pg-boss (jobs; proposed) | pg-boss | pg-boss |
| Search | none (Postgres FTS, unchanged) | Postgres FTS | Postgres FTS (OpenSearch optional later) |
| Cache and rate limit | none (Redis client) | Redis (small) | Bundled Redis container (decided, plan decision 28) |
| AV scan | none (ClamAV over TCP) | ClamAV service | Optional ClamAV container, on by default in the compose `scan` profile |
| SSO | `SsoAdapter` in identity-access (existing "SSO adapter", section 4) | Bought SSO/SCIM vendor (per-connection add-on on Pro, in Enterprise) | Built-in OIDC in the MVP; SAML in v2 through an optional **bundled Keycloak broker** (compose profile `sso`) with an OIDC-only app core, instead of in-app SAML libraries (proposed; node-saml and samlify have recent critical advisories, validation: technical); SCIM v2 (a bought vendor needs internet; plan decisions 4 and 28, decision 27 detail updated) |
| Observability | none (OTel SDK) | CloudWatch + OTel | stdout JSON logs, Prometheus `/metrics`, optional OTel exporter |
| TLS and ingress | none (infrastructure) | CloudFront + ALB (response-headers policy) | Bundled Caddy with three TLS modes (customer certificate by default, public ACME, `tls internal` for evaluation only; see TLS modes above); serves the Next.js static export with SPA fallback; sets security headers; reverse-proxies `/v1` to api |
| Web app | none (static export) | Static on S3 + CloudFront | Baked into the Caddy image (web container exists only in self-hosted) |

Rules (proposed): adapters are chosen once at boot and never switched at request time; each adapter has a contract-test suite that runs against every implementation in CI (for example `StorageAdapter` against S3 and MinIO); domain modules may not import AWS SDK clients directly (extends the boundary lint, section 4 rule 4).

#### License verification

Design (proposed except where noted; enforcement thresholds are plan decision 26, decided 2026-11-17):

- **Format.** A license is a **compact JWS** (`alg: EdDSA`, Ed25519, with the signing key id in the `kid` header) whose payload carries: customer, edition (Community, Standard, Enterprise), asset band limit, enabled modules (for example `module:sam`, same flags as Cloud, plan 13.2), expiry, support tier and issue date. The signature covers the exact signed bytes, so there is no JSON canonicalisation step (RFC 8785 is dropped from the trust path, removing a library and a canonicalisation-bug risk; validation: technical). It is verified with Node `crypto.verify(null, ...)` or `jose` (Node 22, 24 and 26 support Ed25519). Licenses are issued from a license service on our side; the private signing key lives in our KMS/HSM and never leaves it.
- **Offline verification.** The app embeds one or more Ed25519 **public keys** (by `kid`, so signing keys can be rotated by shipping a new public key before issuing licenses with it; SPKI PEM or JWK for portability across Node versions). The license file is read from a mounted volume (`LICENSE_FILE`) and verified at boot, then re-verified **daily** by the scheduler role and whenever the file changes. There is no mandatory phone-home (decided, plan decision 26); optional, opt-in usage telemetry (counts only, never tenant data) may be added later (decided, plan decision 26).
- **Where it plugs in.** The `control-plane` module runs in **`local` mode** (`CONTROL_PLANE_MODE=local`): the `LicenseFile` implementation of `EntitlementSource` reads and verifies the file and produces the same entitlement snapshot that `entitlementsFor` returns in Cloud (derived from Stripe). Module-level flags (`module:sam` and so on) are unchanged, so feature gating code has no edition branch. Local mode also disables what has no meaning on a single host: the Stripe webhook handler and `billing` module, plan checkout, cell map management, support impersonation and the tenant-creation API.
- **Enforcement states (decided, plan decision 26).**

| State | Entered when | Behaviour |
|---|---|---|
| ok | Valid license, under 90% of the asset limit, more than 30 days to expiry | Normal |
| warning | At or above 90% of the asset limit, or 30 days or fewer before expiry | Banner in the web and mobile apps and an email to admins; everything still works |
| grace | After expiry, for 30 days | Warning stays; everything still works. Above 100% of the asset limit, creating new assets is refused (edits, check-in/out and imports of existing data continue) |
| read-only | Grace ended without a renewed license | Writes are refused with a clear `license_read_only` error. Reads, search and **export always work**; installing a new license file lifts the state immediately. No data is ever deleted or hidden |

- **Export is always allowed** in every state, including read-only and with no valid license.
- **Tamper and failure handling.** A file with a bad signature, an unknown `kid`, or malformed content is treated as "no valid license": the install falls back to the free **Community** entitlements (up to 250 assets, core features only, no add-on modules; plan decision 24), an `license.invalid` audit event and admin alert are raised, and the previous valid license keeps applying until it expires if the file is only unreadable (for example a volume problem). Tampering with the embedded public key requires modifying the signed image, which cosign verification and our support policy treat as unsupported. Clock rollback is guarded by storing the highest observed time in the database and refusing to move expiry evaluation backwards. Because the code is closed source but runs on customer hardware, licensing is a contractual and support control with technical friction, not DRM; the design never trades customer data availability for enforcement.
- **Community license (decided, plan decision 24; raised from 100 to 250 assets on 2026-11-17 to match the new Free tier; the paid self-hosted price is repriced to about 0.8x the SaaS equivalent, decided 2026-11-17, plan decisions 13, 23 and 24 updated, rationale: ManageEngine on-prem is about 0.77x its cloud and there is no evidence of a premium for self-hosting; validation: competitor):** a free self-hosted license up to 250 assets is a signed license like any other, so the Community path exercises the same verification code. It receives all releases including security patches; support is docs and community only (no SLA); it is limited to core features (no add-on modules) and OIDC login only (no SAML or SCIM). Paid licenses are priced at about $470/yr for the 500-asset band and $1,430/yr for the 2,500-asset band, Enterprise custom (list-price hypothesis, validate before publishing; plan decision 23 as updated 2026-11-17; kill/continue review 6 months after GA, proposed threshold at least 10 paying self-hosted customers).

#### Single-tenant mode

- **One tenant row per install**, seeded by the `migrate` role at first install together with a bootstrap Owner (invite link printed once to the container log, or `ADMIN_EMAIL` plus a one-time setup token; mechanism proposed).
- **RLS stays on.** Same FORCE RLS policies, same `app` and `migrator` roles, same `withTenantTx`, same `TenantRepository`. There is no special-casing of the single-tenant case in code, so every isolation test and lint that guards Cloud also guards self-hosted (section 5). `company_id` scoping remains available for customers with several entities.
- **Cells are not applicable.** The tenant-to-cell lookup is a constant `local`; no routing, vanity subdomains, login directory or entitlement push apply. The tenant-creation endpoint is disabled by `local` mode, so a second tenant cannot be created on a self-hosted install. The multi-company (MSP) console (v2 Could) is not offered in self-hosted (proposed).
- **Support access.** No impersonation. Customers can generate a redacted diagnostics bundle (logs, versions, health, migration state; proposed) to attach to a support case.

#### Install and upgrade

The upgrade path uses the same expand/contract discipline as Cloud (section 8.5), with two additions for self-hosted: a **pre-upgrade backup prompt** and a **direct-upgrade rule**. Releases are semver, monthly minors by default with security patch releases as needed; the supported set is the current minor plus the previous two (**N-2**; decided, plan decision 25).

```mermaid
sequenceDiagram
  autonumber
  actor ADM as Customer admin
  participant REG as Our registry (license-gated)
  participant CMP as Compose host
  participant MIG as migrate (one-shot)
  participant PG as PostgreSQL
  participant SVC as api, worker, scheduler

  ADM->>REG: docker login with license-gated token, pull images and bundle
  REG-->>ADM: signed images, SBOM, release notes, upgrade guide
  ADM->>ADM: cosign verify image signatures against the published public key
  ADM->>CMP: run upgrade script (compose pull and up)
  CMP-->>ADM: prompt for a backup (pg_dump, MinIO backup script) and confirm
  ADM->>CMP: backup confirmed
  CMP->>MIG: run migrate with new image digest
  MIG->>PG: check installed version is within N-2 of this release
  MIG->>PG: apply all outstanding expand migrations in order (expand only)
  alt migration fails
    MIG-->>CMP: exit non-zero
    CMP-->>ADM: abort, old services keep running, restore from backup only if needed
  else migration succeeds
    MIG-->>CMP: exit 0
    CMP->>SVC: recreate api, worker and scheduler on the new digest
    SVC->>PG: connect, verify license, report ready
    CMP->>SVC: health check (readiness endpoint)
    alt unhealthy
      CMP-->>ADM: roll back to previous digest, schema stays compatible because only expand ran
    else healthy
      CMP-->>ADM: upgrade complete, version and license state shown
    end
  end
  Note over MIG,PG: contract migrations (drop old columns) ship in a later release, once no supported source version still reads the old shape
```

Rules (proposed; N-2 and the backup prompt are from the team's decision, the rest are details):

- **Expand/contract only.** A release applies only backward-compatible expand migrations, so the previous app version keeps working against the new schema and a failed health check can roll back by digest. Contract migrations ship in a later release, no earlier than the first release whose minimum supported upgrade source (N-2) no longer reads the old shape (in practice three minors after the expand).
- **Any supported version upgrades directly to latest.** The `migrate` role applies every outstanding migration in order, so a customer on N-2 does not need to hop through N-1. Anything older than N-2 must first upgrade to the oldest supported minor (bridge release), and the upgrade script refuses otherwise.
- **Backup prompt.** The upgrade script will not run migrations until the admin confirms a backup (or passes an explicit `--skip-backup` flag, which is logged). Backups are the customer's responsibility; the bundle provides a documented `pg_dump` plus MinIO backup script.
- **Verify before run.** Images and the bundle are signed with **cosign v3, key-based** (`cosign verify --key`) and carry an SBOM; the upgrade script verifies signatures against a public key shipped in the bundle (offline-capable; proposed; validation: technical). The license-gated registry must support **OCI 1.1 referrers**, which cosign v3's bundle format requires, and cosign is kept patched. Referrer signatures are not part of a `docker save` tarball, so the v2 air-gapped offline tarball ships the **signature bundle files** and the verify step uses them. Registry access is gated by the license (decided, plan decision 25).
- **Downtime.** Expand migrations run while the old services still serve; the visible outage is the container recreate (target in section 11).

#### Mobile app and API clients

The Expo app is **the same store app for both editions**. Self-hosted points it at the customer's server (proposed, with MDM presetting of the server URL decided, plan decision 28):

- **First launch:** the user enters the **server URL** or scans a **setup QR** shown in the web admin UI (the QR encodes the server URL and optionally an invite token). The app fetches a small unauthenticated discovery document from the server (`/.well-known/asset-tracker`: edition, API version range, auth methods, minimum client version) and shows "server not supported" if the versions do not overlap. Cloud keeps its default URL, with a "Use my company's server" entry on the sign-in screen.
- **MDM managed app config** (iOS managed app configuration, Android managed configurations) can preset the server URL so field devices need no manual entry.
- **Private CAs and self-signed certificates:** the app trusts the device certificate store only; customers with an internal CA deploy it to devices via MDM. No pinning bypass is provided. **Android caveat (validation: technical):** apps targeting API 24+ ignore user-installed CAs unless a `network_security_config` opts in, so an internal CA works only if MDM installs it into the system trust or the app ships a config plugin with that opt-in (broader trust, a security cost); iOS needs the root installed and fully trusted. This is why customer-provided certificates are the default TLS mode and `tls internal` is evaluation only (TLS modes in 7.3), and why a mobile TLS test runs in CI.
- **Push:** no push at MVP for self-hosted installs (push is Cloud-only). In v1.1 an opt-in, license-gated push relay operated by us forwards notifications to the Expo push service (proposed); it needs outbound internet from the customer's worker, payloads stay ids and generic text, and air-gapped installs get no push.
- **Store apps and OTA:** the same store app serves both editions, so EAS Update MAU counts self-hosted devices too (modelled with the Cloud devices against the Production plan's included MAU). OTA is for fixes only (Apple 2.5.2; section 8.3).
- **Version skew:** because customers upgrade on their own schedule (N-2 window) while store apps and EAS Update ship continuously, the API stays additive within `/v1` and the app declares the server API range it supports. EAS Update channels follow the app, not the server.
- The v2 discovery agent and customer API clients and webhook receivers simply use the self-hosted base URL; nothing else changes.

---

## 8. Docker and environments

### 8.1 Image strategy

Two Dockerfiles (api and web) and one published collector image. No Kubernetes; images run on ECS Fargate in the Cloud edition (and locally in Compose). In the Cloud edition only the API image is deployed as a container: the web app is a static build artifact, and the Expo app (MVP) is built by EAS, not Docker. The **Self-hosted edition publishes two runtime images** to the license-gated registry: the same backend image (all roles) and a `caddy-web` image (Caddy with the static export baked in; section 8.7).

**Backend image (`apps/api/Dockerfile`, built from the monorepo root), one image, many roles.** Multi-stage:

| Stage | Purpose |
|---|---|
| `base` | Node 24 LTS slim image (minimum Node 22.13, the floor set by Expo SDK 58 and NestJS 12) **pinned by digest** (Renovate/Dependabot bumps it). Non-root user. |
| `deps` | Copy lockfile and manifests only; `npm ci` (or pnpm equivalent) with a BuildKit cache mount, so the layer is reused until dependencies change. |
| `build` | Copy sources; compile TypeScript; generate the OpenAPI document; prune dev dependencies. |
| `dev` | Target used by Compose: includes dev dependencies and a watch command; source is bind-mounted. Never pushed to ECR. |
| `runtime` | Final target: only compiled output, production `node_modules`, migrations and entrypoint. Minimal base (slim or distroless), non-root, read-only root filesystem friendly, `NODE_ENV=production`, no secrets, no shell tooling beyond what ops needs. ECS `initProcessEnabled` handles signals and zombie reaping. |

Role selection happens at start-up via the container command or `APP_ROLE`:

| Role | Command (illustrative) | HTTP | Notes |
|---|---|---|---|
| `api` | `node dist/main.js api` | Listens on 3000 behind ALB | Builds the full HTTP module graph |
| `worker` | `node dist/main.js worker` | None (health via queue heartbeat) | NestJS application context only, registers queue handlers |
| `scheduler` | `node dist/main.js scheduler` | None | Registers cron producers; singleton keys make two copies safe |
| `ingest` (v2) | `node dist/main.js ingest` | Listens on 3000, separate target group | Only ingest controllers mounted |
| `migrate` | `node dist/main.js migrate` | None | One-shot; exits 0 or non-zero; uses `migrator` credentials |

Rules: build once per commit; the immutable tag is the git SHA; deployments reference the **digest**; every environment runs the same digest after promotion. Configuration comes from environment variables and Secrets Manager injected by ECS at task start, never baked in. Images carry an SBOM and are scanned (section 8.3).

**Toolchain pins (validation: technical; versions as of 2026-11-17).**

| Component | Pin | Notes |
|---|---|---|
| Node.js | 24 LTS, minimum 22.13 | Also satisfies pg-boss (22.12+) and Expo SDK 58 (22.13+) |
| NestJS and Fastify | NestJS 12 (ESM-first), Fastify 5 | Vitest for unit tests (Jest cannot load ESM-only packages before Node 24.9); ESM from day one; TypeScript 6 for schematics |
| Next.js | 16.4.x | Static export only; Turbopack is the default bundler, which matters for any PWA plugin spike |
| Expo | SDK 58 (React Native 0.88, React 19.3) | Minimum Xcode 26.4, iOS 16.4; EAS Production plan for update code signing |
| PgBouncer | 1.26.1 or later | `max_prepared_statements` set; 1.25.1 fixed CVE-2025-12819 |
| pg-boss | 12.x | Behind the queue adapter (section 5.2) |
| PostgreSQL | 18 (BYO 16-18) | CI matrix 16 and 18 |
| cosign | v3, key-based | OCI 1.1 referrers (section 7.3) |

Renovate or Dependabot bumps the pins; a major bump of NestJS, Next.js, Expo or pg-boss is a planned task, not an automatic merge.

**Web (`apps/web/Dockerfile`).** Targets: `dev` (runs `next dev` with hot reload for Compose) and `build` (runs `next build` with `output: 'export'` to produce the static bundle; CI exports it with `docker build --output` or builds it directly with pnpm, uploads it to S3 and invalidates CloudFront). No runtime web image is published for the Cloud edition (decision in section 3). For the Self-hosted edition, a small `caddy-web` stage (proposed) copies the same static export into a Caddy image with a `Caddyfile` that serves it (with SPA fallback and the security headers) and proxies `/v1` (section 8.7; a DNS-plugin Caddy build is available for ACME DNS-01 without inbound access, proposed); this is the only web container and it is not deployed to AWS.

**Mobile (MVP, no Dockerfile).** The Expo app is built, submitted and updated by EAS (Build, Submit, Update), not Docker. Local mobile development uses Expo Go or a dev client pointed at the Compose API (section 8.2).

**Collector image (v3, `collector/Dockerfile`).** Separate repository/pipeline, since customers pull it. Go static binary on a minimal or distroless base, non-root, multi-arch (amd64 and arm64), published to a public registry (ECR Public or GHCR; choice open) with tags by semver and digest, SBOM, and a cosign signature (signing proposed). Open-sourcing is consistent with plan decision 5. Runtime contract:
- Outbound HTTPS only; config via env and a mounted `/config` volume; enrollment token exchanged for a per-collector credential at first start (same pattern as the agent, plan 6.4).
- Target credentials (SNMP communities, WinRM/SSH secrets) stay on the collector, encrypted at rest with a key supplied by the customer through a mounted secret (plan 6.4 "OS-protected store", container equivalent).
- Network discovery (ARP and ping sweeps) needs `NET_RAW` and usually host networking, so the supported runtime is a Linux host or VM. Docker Desktop on Windows/macOS cannot see the LAN's L2 and is not supported for sweeps (documented limitation).
- Update model: customers pin a tag or digest and update by pulling; the collector reports its version and the UI flags outdated collectors.
- The Go **discovery agent (v2) is not a container.** It is a native binary with signed MSI/PKG/DEB/RPM installers (plan 6.4).

### 8.2 Local development with Docker Compose

Goal: `docker compose up` yields a working stack with seed data, using the same image targets as CI.

| Service | Image / target | Ports | Purpose |
|---|---|---|---|
| `postgres` | `postgres:18` | 5432 | Init script creates roles `migrator` (owner) and `app` (non-owner, no BYPASSRLS) and extensions (`pg_trgm`) so the RLS model matches production from the first run. UUIDv7 is generated in the app (single code path for PostgreSQL 16 and 17, which have no native `uuidv7()`, and for client-created ids in v2; PG 18's `uuidv7()` is an optional `DEFAULT` safety net). Check the official image's PGDATA and volume-mount layout, which changed in 18. |
| `migrate` | backend `dev` target | none | One-shot, `depends_on` postgres healthy; runs migrations then seed (two demo tenants so isolation bugs show up immediately) |
| `api` | backend `dev`, `APP_ROLE=api` | 3000 | Hot reload, source bind-mounted |
| `worker` | backend `dev`, `APP_ROLE=worker` | none | Same code, queue consumer |
| `scheduler` | backend `dev`, `APP_ROLE=scheduler` | none | Optional; can be folded into worker locally |
| `web` | web `dev` target | 3001 | `next dev` with hot reload; `/v1` reaches api through a dev-only proxy (mechanism proposed: Next.js rewrites are not available with `output: 'export'`, so use an env toggle or a small reverse proxy) |
| `minio` + `minio-init` | `minio/minio`, `minio/mc` | 9000, 9001 | S3-compatible storage; init creates buckets and CORS to mimic presigned upload |
| `mailpit` | `axllent/mailpit` | 1025 SMTP, 8025 UI | Captures all email (invites, digests) |
| `redis` | `redis:7` | 6379 | Rate limits (plan 6.2) |
| `pgbouncer` (profile `pooling`) | `edoburu/pgbouncer` or similar, **1.26.1 or later** | 6432 | Transaction pooling in front of Postgres, with `max_prepared_statements` set (for example 100; at 0 named statements break); `api` points here when the profile is active. Reproduces the pooling leak class (plan 6.1). Includes a `pool_size=1` alias used only by the negative-control test (validation: spike) |
| `clamav` (profile `scan`) | `clamav/clamav` | 3310 | Heavy (signature download, about 1-2 GB RAM); off by default, on to test uploads |
| `collector` (profile `collector`, v3) | collector image | none | Test the collector against the local api |

Illustrative excerpt (not a complete file):

```yaml
services:
  postgres:
    image: postgres:18
    volumes: ["./docker/postgres/init:/docker-entrypoint-initdb.d:ro"]   # roles, extensions
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U postgres"], interval: 5s }
  pgbouncer:
    profiles: ["pooling"]
    environment: { POOL_MODE: transaction, MAX_PREPARED_STATEMENTS: "100" }   # >= 1.26.1
    depends_on: { postgres: { condition: service_healthy } }
  migrate:
    build: { context: ., dockerfile: apps/api/Dockerfile, target: dev }
    command: ["node", "dist/main.js", "migrate"]
    environment: { DATABASE_URL: "postgres://migrator:dev@postgres:5432/app" }
  api:
    build: { context: ., dockerfile: apps/api/Dockerfile, target: dev }
    environment:
      APP_ROLE: api
      DATABASE_URL: "postgres://app:dev@postgres:5432/app"   # point at pgbouncer:6432 with --profile pooling
      S3_ENDPOINT: http://minio:9000
      SMTP_URL: smtp://mailpit:1025
    depends_on: { migrate: { condition: service_completed_successfully } }
  web:
    build: { context: ., dockerfile: apps/web/Dockerfile, target: dev }
    command: ["pnpm", "--filter", "web", "dev"]   # next dev, hot reload
    ports: ["3001:3000"]
    depends_on: [api]
```

Developer workflows: `docker compose --profile pooling up` to run everything through PgBouncer; `make test-isolation` runs the two-tenant harness against both direct and pooled URLs (the pooled pass includes the negative control that proves a session-level `SET` leak would be detected); `docker compose run --rm migrate` applies new migrations. The compose file contains only dummy credentials. Real third-party integrations (Stripe, SSO vendor) use test-mode keys supplied through an uncommitted `.env.local`. Mobile (v2) is not a Compose service: developers run the Expo dev server on the host and open the app in Expo Go or a dev client, pointed at the Compose API by LAN URL (`apps/mobile`, section 8.6).

### 8.3 CI/CD pipeline

GitHub Actions authenticates to AWS with OIDC (no long-lived keys, proposed hardening of plan 9 "least privilege IAM"). Pull requests run checks only; merges to `main` build, scan, push and deploy.

```mermaid
flowchart LR
  subgraph PR["Pull request checks"]
    LINT["lint, typecheck<br/>module boundary lint"]
    UNIT["unit tests"]
    SCHEMA["schema lint<br/>tenant_id, policy, FORCE,<br/>security_invoker, composite FK"]
    INTEG["integration and isolation tests<br/>Postgres 16 and 18 matrix<br/>direct and PgBouncer with negative control<br/>direct-partition test"]
    SEC["SAST, SCA, secret scan"]
    OAPI["OpenAPI diff and UI-API parity check"]
    WEBT["web build and tests<br/>typecheck, next build, static-export feature check,<br/>generated client check"]
    MOBT["mobile typecheck and tests<br/>duplicate react check (MVP)"]
    LICT["license verification tests<br/>valid, expiring, grace, read-only,<br/>tampered, unknown key id"]
  end

  subgraph MAIN["Merge to main"]
    BUILD["docker buildx build<br/>backend runtime target<br/>layer cache"]
    SCAN["Trivy image scan<br/>fail on fixable critical and high<br/>SBOM generated"]
    PUSH["push to ECR<br/>immutable tag git SHA<br/>sign image (cosign v3, proposed)"]
    WEBB["web static build<br/>next build, output export<br/>(CI artifact, not a Docker image)"]
    EASB["EAS Build and Submit<br/>store and MDM binaries<br/>(MVP)"]
  end

  subgraph DEV["Staging deploy"]
    MIGS["ECS RunTask: migrate<br/>role migrator"]
    DEPS["update ECS services by digest<br/>api, worker, scheduler<br/>circuit breaker with auto rollback"]
    WEBS["upload to S3 web bucket<br/>CloudFront invalidation<br/>index, assets (service worker and manifest if PWA enabled)"]
    EASUS["EAS Update (OTA)<br/>staging channel (MVP)"]
    SMOKE["smoke and synthetic checks<br/>login, scan flow"]
  end

  subgraph PROD["Production deploy"]
    GATE["manual approval"]
    MIGP["migrate task<br/>same digest"]
    DEPP["rolling deploy by digest"]
    WEBP["web upload to S3 and<br/>CloudFront invalidation"]
    EASUP["EAS Update (OTA)<br/>production channel, signed, fixes only (MVP)"]
    SMOKEP["post-deploy smoke<br/>alarms watch, auto rollback"]
  end

  subgraph SHR["Self-hosted release (semver tag vX.Y.Z)"]
    TAGR["semver tag on a commit<br/>that passed staging"]
    SIGN["sign images with cosign v3 (key-based), attach SBOM<br/>backend digest from main,<br/>caddy-web built from the tag"]
    FRESH["fresh-install test<br/>compose bundle on a clean host"]
    UPGT["upgrade test, N-2 to latest<br/>seeded data, license state checks"]
    TLST["mobile TLS test<br/>customer cert on private CA, tls internal"]
    PUBR["publish to license-gated registry<br/>bundle, release notes, upgrade guide"]
  end

  LINT --> UNIT --> SCHEMA --> INTEG --> LICT --> SEC --> OAPI --> WEBT
  SMOKE -.->|"tag a release"| TAGR
  TAGR --> SIGN --> FRESH --> UPGT --> TLST --> PUBR
  SCAN -.->|"same scan gate"| SIGN
  WEBT -->|"merge"| BUILD --> SCAN --> PUSH --> MIGS --> DEPS --> WEBS --> SMOKE
  WEBB --> WEBS
  SMOKE --> GATE --> MIGP --> DEPP --> WEBP --> SMOKEP
  BUILD --> WEBB
  WEBT --> MOBT
  MOBT -.->|"merge, mobile paths changed"| EASB
  EASB -.-> EASUS
  GATE -.-> EASUP
```

Details:
- **Postgres in CI:** the integration job runs a **matrix of `postgres:16` and `postgres:18`** service containers (the bundle ships 18 and BYO supports 16-18; the spike showed identical RLS behaviour on both), applies migrations as `migrator`, and runs the isolation harness as the `app` role (plan 9 items 1-5). A second pass runs the **same suite through a PgBouncer 1.26.1+ container in transaction mode** with `max_prepared_statements` set, and includes (a) the **negative control** (a session-level `SET` through a `pool_size=1` alias must be detected as a leak, proving the harness can fail), (b) a case where a transaction fails mid-way and the next borrower sees no tenant, (c) the NULLIF case (a connection reused after a tenant transaction returns 0 rows, not error 22P02), and (d) the **direct-partition test** (the app role gets permission denied on a partition). Schema lint also fails if any non-owner role holds privileges on a partition (validation: spike).
- **Static-export check:** the web build fails if `proxy.ts`/middleware, `rewrites`, `redirects`, `headers`, Server Actions or the default image loader appear (section 3; validation: technical). The week-1 routing spike's deep-link, refresh and back/forward cases are kept as Playwright tests.
- **Store readiness (MVP, proposed; validation: technical).** Before the first store submission the release checklist requires: a **permanent Cloud demo tenant** (App Review) with a non-expiring reviewer account that has no MFA, kept free of real data and resettable, whose server URL and credentials go in App Store Connect and Play Console review notes (pre-filled through the setup QR); a Play Console **organisation** account; an assessment of Apple 4.8 (Sign in with Apple, given Google/Microsoft OIDC login) and of in-app account deletion (5.1.1(v)) depending on whether mobile supports self sign-up; **public or unlisted distribution**, not Apple Custom Apps (one shared app for all customers); and MDM managed configuration for the server URL. TestFlight and Play internal testing start in month 4 (plan 6.5). Scanning symbologies (QR, Code128, DataMatrix) are verified on a **device test matrix** of low-end Android and older iOS, since expo-camera documents no per-platform matrix.
- **Scanning:** Trivy (or equivalent) fails the build on fixable critical/high vulnerabilities; ECR scan-on-push and optional continuous scanning back it up (patch SLA critical 7 days, plan 9). Weekly rebuild picks up base-image patches. DAST (for example OWASP ZAP) runs nightly against staging (plan 9 asks for DAST).
- **Promotion, not rebuild:** production deploys the digest that passed staging. Terraform changes run in a separate pipeline: plan on PR, apply on merge with approval; state in S3 with locking.
- **Deploy strategy:** ECS rolling deployment with the deployment circuit breaker and alarm-based rollback at MVP; blue/green (CodeDeploy) once there is a reason (plan 6.13 allows either).
- **Web delivery:** the static export is built once in CI (no web image), uploaded to the S3 web bucket, then CloudFront is invalidated for the HTML entry points. Hashed asset files (`_next/static/*`) are uploaded with long immutable cache headers; HTML pages (and `sw.js` and the manifest if the installable PWA, a Could, is enabled) are `no-cache`; security headers come from the CloudFront response-headers policy, not Next.js config, and unknown paths fall back to `index.html` (SPA fallback); previous releases' assets are retained for a retention window so already-open browser sessions can still lazy-load their chunks. The API enforces a minimum supported client version and prompts a reload (proposed).
- **Mobile delivery (MVP):** EAS Build produces store and MDM binaries and EAS Submit sends them to App Store Connect and Google Play. EAS Update ships JavaScript-only changes over the air, **for fixes and non-feature changes only** (Apple 2.5.2 forbids downloading code that changes features; the release checklist records this and features are described in review notes), signed with the code-signing key, which requires the **EAS Production plan** ($199/month plus usage, with 50,000 update MAU included and $0.005 per MAU above that; budgeted as an MVP cost and modelled across Cloud and self-hosted devices, since one store app serves both; validation: technical), through channels per environment (`development`, `staging`, `production`) and only to binaries with a matching runtime version; native changes need a new binary. The API's minimum-client-version check also applies to the app, so an incompatible binary is forced to update (proposed).
- **Collector** has its own pipeline: test, multi-arch build, scan, sign, publish.
- **Self-hosted release pipeline (proposed; monthly cadence and N-2 are decided, plan decision 25).** A semver tag on a commit that already passed staging starts the release: (1) the backend image is the digest built from that commit on `main` (promotion, not rebuild, A4) and the `caddy-web` image is built from the same commit's static export; both pass the same Trivy gate (fail on fixable critical/high), are signed with cosign v3 (key-based `--key`, public key shipped in the bundle so verification also works offline; the registry must support OCI 1.1 referrers) and get an SBOM; (2) a **fresh-install test** brings up the compose bundle on a clean host and runs the smoke flow (login, import, scan, export); (3) an **upgrade test** installs each supported prior version (N-2, N-1) with seeded data, upgrades to the candidate, and re-runs the isolation harness, the smoke flow and the license state checks; (3b) a **mobile TLS test** runs the Expo app against the candidate on a customer-supplied certificate chained to a private CA and against `tls internal` (the latter expected to be untrusted without MDM trust, to catch regressions in the documented behaviour); (4) images, bundle, release notes and an upgrade guide are published to the license-gated registry. Security patch releases use the same pipeline. License verification tests (valid, expiring, grace, read-only, tampered, unknown `kid`, clock rollback) run on every PR (`LICT` in the diagram). The self-hosted track never blocks the Cloud track: Cloud continues to deploy on every merge.

### 8.4 Environments

| Environment | Purpose | Data | Sizing | Deploy trigger |
|---|---|---|---|---|
| local | Development with Compose | Seed data, two demo tenants | Laptop | `docker compose up` |
| CI | Ephemeral per job | Created by tests | GitHub runner | Every PR |
| dev | Shared integration | Synthetic | Minimal, single-AZ allowed | Every merge to `main` |
| staging | Prod-like, release candidate, pen-test target, restore drills | Synthetic or anonymised, **never production data** | Same topology as prod, smaller | After dev smoke passes |
| prod (cell us-1) | Customers | Real | Multi-AZ, PITR, DR copies | Manual approval of the staging digest |
| self-hosted release test | Fresh-install and N-2 upgrade tests of the compose bundle (proposed) | Seeded synthetic | Ephemeral Linux host or VM per run, minimum supported sizing | Every semver tag |

Dev and staging may be collapsed into one environment at MVP to save cost (proposed). Separate AWS accounts per environment are proposed (section 7.2).

Frontend per environment (proposed): the web static build is promoted like the API image (build once, same artifact in every environment); because the API is same-origin through CloudFront, no API URL is baked into the bundle. The Expo app has EAS build profiles and OTA channels that mirror the environments (`development` against local/dev, `staging`, `production`), and each profile carries its own API base URL since the app is not same-origin.

### 8.5 Migrations strategy

- **Tool:** SQL-first, versioned migrations run by the `migrate` role (tool such as node-pg-migrate or Atlas, chosen with the Kysely/Drizzle decision; open). Migrations run as the `migrator` role, which owns the tables; the app role cannot alter schema (plan 6.1).
- **Order in every deploy:** run `migrate` as a one-off ECS task **before** updating services. A failed migration stops the pipeline; services remain on the previous version.
- **Expand/contract** (plan 6.13): old and new code run side by side during a rolling deploy, so each migration is backward compatible with the previous release. Breaking changes are split across releases: add (expand) -> backfill and dual-write -> switch reads -> remove (contract) in a later release.
- **Locking safety:** `lock_timeout` and `statement_timeout` on migrations, `CREATE INDEX CONCURRENTLY`, batched backfills.
- **Backfills** are worker jobs that iterate tenants one at a time with tenant context (plan 6.1 pitfall), idempotent and resumable, tested against two tenants. **FORCE side effect (validation: spike):** the owner role with no tenant set matches 0 rows (a `DELETE` or `UPDATE` as `migrator` silently does nothing), so backfills and test cleanup must set the tenant per run, or use a one-off, controlled superuser path outside the application; FORCE never binds a superuser or BYPASSRLS role.
- **pg-boss schema:** creation and pg-boss upgrades run in the `migrate` step over a direct connection as `migrator`; the runtime-role grant on schema `pgboss` is re-applied after each upgrade (section 5.2).
- **Partitions:** partitions are created by the `migrator` role (the partition-rotation job runs as the owner) with no grants to `app`; the schema lint rejects any other privilege holder on a partition (section 5.3).
- **Schema lint gates** every migration (plan 6.1): new tenant tables must include `tenant_id`, policy with `WITH CHECK`, `FORCE`, leading-`tenant_id` index; views must be `security_invoker`; no `SECURITY DEFINER`.
- **Pre-prod rehearsal:** each migration is applied in staging against a representative data volume before production; destructive ones require a fresh snapshot (or a PITR bookmark) noted in the release.
- **Cells:** migrations roll cell by cell with a canary cell first (v3).
- **Self-hosted (proposed):** the same migrations run through the `migrate` container of the compose bundle, after a pre-upgrade backup prompt, and only expand migrations ship in a release; contract migrations follow in a later release, and any version within N-2 can upgrade directly to the latest because all outstanding migrations are applied in order (section 7.3). The upgrade test in CI covers this path with seeded data (section 8.3).

### 8.6 Monorepo layout

One repository managed with Turborepo and pnpm workspaces (proposed). Clients share generated and validated types so the OpenAPI contract (A8) is enforced at compile time.

```text
apps/
  api/            NestJS modular monolith (the single Docker image, all roles)
  web/            Next.js 16 App Router, static export, query-string or client-routed detail pages (admin/desktop UI)
  mobile/         Expo SDK 58 (React Native) field app (MVP)
packages/
  api-client/     TypeScript client generated from the OpenAPI 3.1 document
  schemas/        zod schemas shared by api, web and mobile
  ui-tokens/      design tokens (colour, spacing, type) shared by web and mobile
```

- `packages/api-client` is regenerated in CI from the OpenAPI document that the API build emits; a diff against the committed client fails the PR (part of the parity check in section 8.3).
- Turborepo caches builds and tests per package, so a PR touching only `apps/mobile` does not rebuild the API image.
- Business logic lives in `apps/api` only. `apps/web` and `apps/mobile` call the REST API and hold UI state, never domain rules.
- **Expo in the monorepo (validation: technical):** pnpm isolated installs are supported from Expo SDK 54; CI runs a duplicate check (`pnpm why --depth=10 react-native` and `react`: exactly one of each, since a duplicate `react` breaks at runtime), and `apps/mobile` has a documented fallback to `nodeLinker: hoisted` in `pnpm-workspace.yaml` for libraries that break under isolated installs. Re-test with the current pnpm defaults early.

### 8.7 Self-hosted compose bundle (proposed)

The MVP self-hosted packaging (plan decision 13) is a versioned **bundle**: `docker-compose.yml`, an `.env.example` template, a `Caddyfile`, helper scripts (`install.sh`, `upgrade.sh`, `backup.sh`, `restore.sh`, `support-bundle.sh`) and install, upgrade and hardening docs. It is distinct from the developer Compose file in section 8.2: images are pulled by digest from the license-gated registry, there are no bind-mounted sources, no `dev` targets and no dummy credentials.

Supported host (decided, plan decision 28): Linux x86_64 or arm64 with Docker Engine 24+ and Compose v2; minimum 4 vCPU and 8 GB RAM for up to about 10,000 assets (targets in section 11). Bring-your-own Postgres 16, 17 or 18 is supported by disabling the `postgres` profile and setting `PGBOUNCER_UPSTREAM_URL` (the database PgBouncer connects to) and `MIGRATOR_DATABASE_URL` (direct).

| Service | Image | Compose profile | Role | Notes |
|---|---|---|---|---|
| `caddy` (web) | `caddy-web` (Caddy plus the Next.js static export) | default | Ingress, auto-TLS, static web, `/v1` reverse proxy | Ports 80 and 443. Three TLS modes (section 7.3): customer certificate mounted as a volume (default), public ACME (needs a public DNS name, or the DNS-plugin build for hosts with no inbound access), or `tls internal` for evaluation only. Serves the static export with SPA fallback and sets the security headers (CSP with build-time script hashes, HSTS). The only web container; in Cloud the same export is served from S3 + CloudFront. |
| `api` | backend image, `APP_ROLE=api` | default | REST `/v1`, auth, control-plane `local` mode, license verification | Not published on the host; reached only through `caddy`. |
| `worker` | backend image, `APP_ROLE=worker` | default | Imports, exports, webhooks, mail, scan jobs, thumbnails | Outbound SMTP. Push via our relay from v1.1 (none at MVP). |
| `scheduler` | backend image, `APP_ROLE=scheduler` | default | Cron producers, daily license re-check | One instance; safe to run two (singleton keys). |
| `migrate` | backend image, `APP_ROLE=migrate` | default (one-shot) | Applies migrations as `migrator`, seeds the single tenant on first install | `depends_on` postgres healthy; `api`, `worker` and `scheduler` wait for `service_completed_successfully`. |
| `postgres` | `postgres:18` | `bundled-db` (on by default) | System of record | Init script creates `migrator` and `app` roles and `pg_trgm`, as in section 8.2. Verify the PG 18 image's data directory and volume mount layout. Disable the profile for bring-your-own Postgres (16-18). |
| `pgbouncer` | `edoburu/pgbouncer` or similar, **1.26.1 or later** | default | Transaction-mode pooler between `api`, `worker`, `scheduler` and Postgres, so self-hosted runs the same pooled code path that CI tests (proposed) | Listens on 6432 (internal only); `max_prepared_statements` set (for example 100; at 0 named prepared statements break). `DATABASE_URL` points at it; `migrate` and pg-boss schema and maintenance use a direct Postgres connection (`MIGRATOR_DATABASE_URL`). Bring-your-own Postgres installs may point it at their database. |
| `redis` | `redis:7` | default | Rate limits and short-lived caches | Everything must work if flushed (section 3). |
| `minio` + `minio-init` | `minio/minio`, `minio/mc` | `bundled-storage` (on by default) | S3-compatible object storage | Init creates buckets. Disable the profile and set `S3_ENDPOINT` and credentials for a customer S3-compatible store. |
| `clamav` | `clamav/clamav` | `scan` (on by default in the bundle) | Upload virus scanning | Needs about 1-2 GB RAM; optional, remove the profile to turn it off. |
| `keycloak` | Keycloak (version pinned per release) | `sso` (off by default; **v2**, not in the MVP bundle) | Optional SAML broker: SAML to the customer IdP, OIDC to the app | The app core stays OIDC-only (section 6.d). Own database schema or container; adds RAM and an upgrade surface the customer patches (proposed). |

Volumes: `pgdata` (Postgres), `miniodata` (objects), `caddy_data` and `caddy_config` (certificates and Caddy state), `clamav_db` (signatures), `license` (the license file, mounted read-only into `api` and `scheduler`), and `backups` (target of `backup.sh`). Secrets (Docker secrets, files under `./secrets`, never in the image): `master_key` (the `KeyProvider` master key; back it up separately, losing it makes encrypted integration credentials unrecoverable), `db_app_password`, `db_migrator_password`, `smtp_password`, `s3_secret_key`.

`.env.example` keys (illustrative; secrets are files, not env values; `COMPOSE_PROFILES` adds `sso` in v2 for the Keycloak broker):

```text
EDITION=selfhosted
CONTROL_PLANE_MODE=local
PUBLIC_URL=https://assets.example.com
TLS_MODE=customer                       # customer (default) | acme | internal (evaluation only)
TLS_CERT_FILE=/run/tls/tls.crt          # TLS_MODE=customer
TLS_KEY_FILE=/run/tls/tls.key
ACME_EMAIL=admin@example.com            # TLS_MODE=acme
LICENSE_FILE=/run/license/license.json
IMAGE_TAG=1.4.2                         # pin a version; upgrade script compares against N-2
DATABASE_URL=postgres://app@pgbouncer:6432/app            # pooled path used by api, worker, scheduler
PGBOUNCER_UPSTREAM_URL=postgres://app@postgres:5432/app   # BYO Postgres: point at the customer database
PGBOUNCER_POOL_MODE=transaction
PGBOUNCER_MAX_PREPARED_STATEMENTS=100
PGBOUNCER_DEFAULT_POOL_SIZE=20
PGBOUNCER_MAX_CLIENT_CONN=200
MIGRATOR_DATABASE_URL=postgres://migrator@postgres:5432/app   # direct, no pooler (migrations, pg-boss schema and maintenance)
S3_ENDPOINT=http://minio:9000
S3_BUCKET=assets
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_FROM=assets@example.com
ADMIN_EMAIL=owner@example.com           # bootstrap Owner at first install
PUSH_ENABLED=false                      # no push at MVP; v1.1: true uses our license-gated push relay (needs outbound internet)
OTEL_EXPORTER_OTLP_ENDPOINT=            # optional
COMPOSE_PROFILES=bundled-db,bundled-storage,scan
```

Notes: services never run as root, root filesystems are read-only where the image allows, and only `caddy` publishes ports (hardening guide, section 9). Helm for Kubernetes and the air-gapped bundle (offline image tarball plus offline license) are v2 (section 10; decided, plan decision 27).

---

## 9. Security architecture

Aligned with plan 6.12 and section 9; SOC 2 evidence collection is out of scope here. The controls below name AWS services because they describe the **Cloud edition**; the self-hosted equivalents and the shared-responsibility split are in the "Self-hosted edition" paragraph near the end of this section.

**Authentication.**
- First party: email + password (argon2id, breached-password check), MFA (TOTP; passkeys optional at MVP), Google and Microsoft OIDC (plan 5.3, 6.12).
- SSO: OIDC login is free on all tiers. SAML via the SSO vendor and SCIM are a **paid per-connection add-on on Pro, included in Enterprise** (decided 2026-11-17, plan decision 7 updated; proposed add-on prices $199/month per SAML connection and $299/month for SAML plus SCIM, which must stay above vendor cost, about $125 per connection per month for WorkOS SSO plus $125 for Directory Sync; validation: technical). SAML is MVP Should (moves to v1.1 if the team has fewer than 4 engineers, plan decision 22), SCIM v2; enforce SSO per tenant on tenants with the add-on or Enterprise (plan 8.2). Self-hosted SAML (v2) uses a bundled Keycloak broker with an OIDC-only app core (section 6.d).
- Browser sessions: server-side sessions (session table in the `identity` schema, token stored hashed), cookie `__Host-` prefixed, HttpOnly, Secure, SameSite; device list and revoke (plan 6.12). CSRF protection on cookie-authenticated mutations. Same-origin API via CloudFront simplifies this.
- Mobile app (MVP, proposed): the Expo app does not use cookies. It signs in with OAuth/OIDC authorization code + PKCE in the system browser against the same auth endpoints (SAML and OIDC logins still complete through the vendor or provider callback, section 6.d), and receives a short-lived access token (about 15 minutes) plus a rotating refresh token. Both live only in `expo-secure-store` (iOS Keychain, Android Keystore), never in SQLite or async storage. Refresh tokens are stored hashed server-side, rotate on use with reuse detection (a replayed token revokes the family), and appear in the same device list as browser sessions so a user or admin can revoke a lost phone. Any on-device cache (the MVP retry queue and, in v2, the local SQLite copy) holds only the user's location-scoped working set and is wiped on logout or revocation.
- API: scoped keys (`resource:action` scopes, expiry), stored **hashed**, presented as Bearer; lookup by key prefix through the `identity` schema; optional IP restriction Pro+ (v2); OAuth2 client-credentials (v2). Agents and collectors use per-device credentials derived from short-lived enrollment tokens, revocable in the UI (plan 6.4).
- Support access: time-boxed, tenant-approved, fully audited impersonation, implemented in the control plane (plan 6.12).

**Authorization.**
- One central policy layer (`PolicyService.can(principal, permission, resource)`); controllers declare required permissions and the same declaration generates the OpenAPI docs (plan 6.12 "mirrored in API docs").
- RBAC: permissions `resource:action`; built-in roles at MVP (Owner, Admin, Asset Manager, Technician/Auditor, Viewer/Employee); custom roles v2 (plan 5.3, 5.2).
- **Location scoping:** each role assignment has a scope (tenant, company, or location subtree). `TenantRepository` adds the subtree predicate to every query for scoped principals; check-out and stocktake endpoints verify the target is inside scope. Mobile scan of an out-of-scope asset returns 404 (not 403) so existence is not leaked. Tenant isolation never depends on this layer; it is an additional filter inside RLS.
- Authorization failures and sensitive reads (exports) are audited.

**Encryption.**
- In transit: TLS 1.2+ with HSTS; internal ALB-to-task traffic stays inside the VPC (TLS between ALB and task proposed for the ingest path).
- At rest: RDS and S3 (SSE-KMS), EBS/Fargate ephemeral storage encrypted.
- **Application-level envelope encryption (KMS)** for integration credentials, license keys, webhook secrets, Snipe-IT tokens (plan 9): the service requests a data key from KMS with an **encryption context containing `tenant_id` and purpose**, encrypts with AES-256-GCM, and stores ciphertext + wrapped key + key version. Decrypt requires the same context, so a ciphertext copied between tenants fails to decrypt (proposed use of encryption context). Data keys are cached in memory for seconds and never logged. Per-environment CMKs at MVP, per-tenant CMKs (BYOK) as an Enterprise option later (plan 6.6, 9).
- Passwords argon2id; API keys hashed; session tokens hashed.

**Secrets.**
- AWS Secrets Manager for DB credentials (separate secrets for `app` and `migrator`, rotation), Stripe and vendor keys; injected by ECS at task start. No secrets in images, repository, or Compose (dummy dev values only). CI uses GitHub OIDC to assume scoped IAM roles; secret scanning in CI (plan 9).

**Network.**
- Private subnets for all tasks and data; security-group chain ALB -> api/ingest -> pooler/RDS; RDS and Redis have no public access; ALB accepts only CloudFront; VPC endpoints for AWS services (proposed). WAF managed rules and bot control on CloudFront (proposed; plan lists rate limiting and security headers, not WAF).
- Egress controls for webhook/connector fetches: validated DNS resolution, block private/link-local/metadata IPs, no redirects to blocked ranges (plan 9 SSRF).
- Agent/collector endpoints are internet-facing but authenticated per device, payload-size and rate limited per tenant and device.
- Security headers via CloudFront response-headers policy in Cloud and via Caddy in self-hosted (Next.js `headers` is unavailable under static export): CSP, HSTS, frame-ancestors, referrer policy (plan 9). A Next.js static export emits inline bootstrap scripts, so the CSP uses build-time script hashes rather than `unsafe-inline` (proposed).

**Audit.**
- `audit_log` partitioned monthly, written in the same transaction as the change; INSERT/SELECT only for the app role; before/after diff with sensitive fields redacted; request id, IP, user agent, actor type (user, api key, integration, system) (plan 6.10). UI + API + CSV export; retention by tier; SIEM streaming and optional hash chain in v3.
- Security events that happen **before** a tenant is known (failed logins for unknown accounts, invalid API keys) go to a separate control-plane security log (proposed).
- Asset history (chain of custody) is a derived view of the same events.
- **Retention purge** requires a dedicated, narrowly granted retention role because the app role cannot delete; see Appendix A, item 1.

**File upload scanning.**
- Upload path: presigned PUT with content-length and content-type conditions, key `t/<tenant_id>/<yyyy>/<uuid>`, type allow-list (images, PDF, common office formats, CSV), size caps by tier.
- New objects are `scan_status = pending`. A scan job streams the object to ClamAV; `clean` flips the flag and enqueues thumbnailing; `infected` deletes the object, writes an audit entry and notifies the uploader. Downloads are only presigned (short-lived) after `clean`; a scheduler sweep handles uploads whose "complete" call never arrived (plan 6.6).
- Files are served from a separate cookie-less domain with `Content-Disposition: attachment` for anything not an image, so uploaded content cannot run in the app origin (proposed). Thumbnails are generated server-side (re-encoding also neutralises image payloads); EXIF stripping optional per tenant (plan 6.6).

**Mobile app and over-the-air updates (MVP, proposed; push notifications MVP Should).**
- **EAS Update code signing:** OTA bundles are signed with a private key held in the protected CI environment (secret store, not the repository); the matching certificate is embedded in each binary, and the app refuses unsigned or wrongly signed updates. This keeps a compromised Expo account or channel from pushing arbitrary code to field devices. Key rotation ships with a new binary. Code signing is available only on the EAS Production plan or above (validation: technical), so the Production plan is an MVP cost (section 8.3).
- **Push notifications (Cloud only at MVP):** the worker role sends through the Expo push service to APNs/FCM. Self-hosted installs have no push at MVP because Expo push tokens belong to our Expo project; v1.1 adds an opt-in, license-gated relay operated by us (proposed, section 7.3). Device push tokens are tenant-scoped rows tied to a user and device, removed on logout and revocation. Payloads carry ids and generic text only, so the app fetches details over the authenticated API (nothing sensitive transits the push providers).
- OTA updates are limited to JavaScript and assets compatible with the installed runtime version, and to **fixes and non-feature changes** (Apple 2.5.2); releases are staged through the staging channel before production (section 8.3).

**Self-hosted edition (proposed except where marked decided, plan decisions 22-28).** The customer operates the infrastructure, so the security model has a documented split rather than one owner.
- **Shared responsibility.** A shared-responsibility document ships with the bundle (summarised below).

| Area | Vendor (us) | Customer |
|---|---|---|
| Application code and images | Secure development, SAST/SCA/secret scan, Trivy gate, signed images, SBOM, tenant-isolation tests on every release | Verify signatures, pull and apply releases within the supported window (N-2) |
| Host, Docker, network | Hardening guide, secure defaults in the bundle | Patch the OS and Docker, firewall, restrict who reaches the host and ports 80 and 443 |
| TLS and DNS | Caddy with three modes (customer certificate default, public ACME, `tls internal` for evaluation only); mobile TLS test in CI | Public DNS name or enterprise PKI trusted on devices (MDM-installed trust for private CAs, Android caveat in 7.3), certificate renewal for customer certificates |
| Data at rest | Application-level envelope encryption of integration credentials and webhook secrets | Disk or volume encryption for Postgres and object storage, if required |
| Backups and DR | Documented `pg_dump` and MinIO backup scripts, restore guide | Schedule, store, test and secure backups, including the master key. Backups are the customer's responsibility |
| Identity | Built-in OIDC, RBAC, MFA, audit log; v2 optional Keycloak broker for SAML (we pin and ship it, advisories in the feed) | IdP configuration, user lifecycle, admin account hygiene, patching the broker |
| Vulnerability response | Security advisories and patch releases | Install patch releases |

- **Key management.** The `KeyProvider` master key comes from a Docker secret (file), never the image or `.env`. Application keys are wrapped under it with the same encryption-context binding as in Cloud (`tenant_id` plus purpose). Key rotation re-wraps data keys without re-encrypting payloads (procedure documented). A HashiCorp Vault or cloud KMS `KeyProvider` adapter is v2 (decided, plan decision 27). The license verification public key is embedded in the image (section 7.3).
- **Hardening guide.** Non-root containers, read-only root filesystems where possible, only `caddy` published, Postgres and Redis not exposed on the host, minimum Linux capabilities, secrets as files, TLS 1.2+ with HSTS, security headers set by Caddy (the same CSP with build-time script hashes as the Cloud web app), recommended firewall rules, log forwarding, and a checklist for admins. Cloud-only controls (WAF, VPC endpoints, CloudFront-only ALB) have no self-hosted counterpart; the guide recommends a customer WAF or reverse proxy for internet-exposed installs (proposed).
- **Advisories and patch SLA.** Security advisories are published for self-hosted releases with severity, affected versions and the fixed release. Default SLA (decided, plan decision 25): a patch release for critical vulnerabilities within 7 days, the same as the Cloud SLA (plan 9). Patch adoption depends on the customer; the admin UI shows the running version, newer available versions need no phone-home (the customer reads the advisory feed or release notes), and the release notes state clearly which versions are supported.
- **SOC 2 scope (plan decision 15).** SOC 2 covers the Cloud service and our build and release pipeline (the supply chain: source control, CI, signing keys, registry, license issuing service), not customer environments.
- **SAML risk (v2, proposed).** No in-app SAML libraries are shipped: `node-saml` (two Critical signature-verification advisories in July 2025) and `samlify` (ten advisories on 2026-10-20 including a Critical) show repeated XML-signature flaws, and samlify is not to be used at all (validation: technical). Self-hosted SAML goes through the bundled Keycloak broker; the release process includes a security-advisory watch for it. A go/no-go on the broker is taken before v2 planning.
- **Backups.** The Cloud backup and DR commitments in section 11 do not apply to self-hosted installs; the bundle ships backup and restore scripts and a documented restore drill (proposed).

**Other.** OWASP ASVS L2 checklist, CI SAST/SCA/secret scan, container image scanning (section 8.3), patch SLAs, external pen test with isolation scope before GA (plan 9).

---

## 10. Scalability and evolution path

| Dimension | MVP (beta about month 5, GA about month 8) | v2 (about months 9-14) | v3 (year 2 onwards) |
|---|---|---|---|
| Topology | One cell (US). Containers: api, worker, scheduler. Control plane is a module. Expo app released through EAS (not a container). | + `ingest` service (same image). Control plane still a module. | EU cell, dedicated cells, global control plane as its own small deployable. |
| Database | RDS PostgreSQL 18 Multi-AZ, PITR. PgBouncer (default pooler) enabled when connections require; RDS Proxy only after a staging pinning test. Monthly partitions (parent-only grants) on audit log, history, webhook deliveries. | Read replica for reports/exports (role still subject to RLS). Partition discovery tables by time. Hash-partition `asset` only if one tenant reaches millions of rows (plan 6.1). | Read-only SQL/BI endpoint through RLS-subject per-tenant views (plan 6.1, 9.9). Larger instance or Aurora if justified. |
| Search | Postgres FTS + trigram, tenant-scoped indexes; JSONB GIN for custom fields | Same; add suggestions. | OpenSearch per cell (earliest v2) when p95 search, index size or relevance require (plan 6.7). Search indexer consumes outbox events. |
| Jobs | pg-boss 12.x on Postgres (polling, no LISTEN/NOTIFY behind the pooler, queue adapter); priority classes interactive > scheduled > bulk; per-tenant concurrency | More job types (reconcile, compliance, PM schedules). Worker autoscaling by queue age. | Move queue to SQS/Redis only if Postgres queue contention shows (plan 6.2). |
| Cache | Small Redis | Same | Same |
| Mobile | Expo (React Native) app for technician flows, online-first with retry queue (Idempotency-Key replay); EAS Build/Submit/Update and store/MDM distribution; Expo push via the worker (MVP Should, Cloud only; self-hosted push via a license-gated relay in v1.1); OIDC + PKCE, expo-secure-store, signed EAS Update (Production plan, fixes only). Web app (Next.js static export) is the admin/desktop UI; web camera scanning is Should (was Could) and the installable PWA stays Could (decided: Expo in MVP, plan decision 10). | Same Expo app becomes offline-first (expo-sqlite, mutation queue, conflict rules in 6.a). Admin stays web-only. | Same Expo app; native modules for Bluetooth label printers, NFC and RFID readers as needed (plan 6.5 triggers). No Capacitor wrapper. |
| Discovery | None in the MVP (importer ships a Google Admin ChromeOS CSV template); MDM and directory connectors (Intune + Entra ID, and Google Admin ChromeOS device sync) in v1.1 (plan decisions 9 and 22; Google sync decided 2026-11-17) | Go agent (Win/macOS/Linux); ingest role; reconciliation | Collector container (distributed probe), cloud and SaaS discovery |
| Isolation/blast radius | RLS + app scoping + tests | Per-tenant quotas hardened; noisy-neighbour views | Cells; per-tenant KMS keys for Enterprise |
| Deploy | Rolling with circuit breaker | Optional blue/green | Cell-by-cell canary |
| Self-hosted (decided, plan decisions 13 and 22-28; details beyond those decisions are proposed) | Docker Compose bundle (caddy-web, api, worker, scheduler, migrate, postgres, redis, minio, optional clamav); single-tenant with RLS on; compact-JWS (EdDSA) license file verified offline; built-in OIDC; three TLS modes; no push (v1.1: license-gated push relay); cosign v3 signed images and SBOM; monthly semver releases, N-2 direct upgrades; Expo app server URL, setup QR and MDM config. | Helm chart for Kubernetes; air-gapped install (offline image tarball with cosign signature bundles plus offline license, Enterprise); SAML through an optional bundled Keycloak broker (OIDC-only app core) and SCIM; HashiCorp Vault or cloud KMS `KeyProvider`; Discovery agent and collector point at the self-hosted URL. | As needed, driven by customer demand: additional orchestrators, optional OpenSearch, further Enterprise packaging. |

**When to extract a service** (only on evidence, plan 6.2): candidates in order: (1) `ingest/discovery` (spiky, internet-facing, different scaling and security profile; already a separate role), (2) the webhook delivery worker (customer-endpoint slowness), (3) the search indexer. Triggers (proposed): sustained CPU/memory contention between roles that role-level task scaling cannot fix, a module needing a different runtime, or a team boundary. Extraction preserves the module facade as the service contract; because roles already deploy separately and the DB is shared per cell, the first step is giving the role its own repository and release cadence, not its own database.

**Thresholds that trigger changes (proposed):** introduce the pooler (PgBouncer) when API+ingest connections approach about 60% of `max_connections`; read replica when report/export queries affect p95 of interactive routes; OpenSearch when search p95 exceeds the 200 ms budget at the 95th-percentile tenant size or tenant-scoped GIN/trigram indexes dominate storage; second cell when a signed EU customer needs residency or a tenant's load justifies isolation.

**Future modules (post-v3, plan section 13):** SAM, FAM and CMMS are added as new modules inside the same modular monolith, behind the existing module-boundary rule (plan 6.2, 13.2). They reuse the registry, locations, vendors, audit log, API and webhooks, workflow engine and company scoping (plan 13), with no new services by default. Likely extraction triggers: FAM's GL/ERP sync (QuickBooks, Xero, NetSuite, SAP; plan 7.9) as an integration worker (proposed), and EAM IoT/sensor ingestion, which is high-volume time-series data that would need a dedicated ingest path and probably a time-series store (proposed). DAM is out of scope: it would need a media processing pipeline and is a separate product (plan 13.1).

---

## 11. Non-functional targets

Numbers from the plan are marked **[plan]** with the section; additions are marked **proposed**. Unless a row says self-hosted, targets apply to the Cloud edition; the self-hosted rows are at the end of the table.

| Area | Target | Source |
|---|---|---|
| RPO | 15 minutes (MVP), tightened in v2 | [plan 9] |
| RTO | 4 hours (MVP), tightened in v2 | [plan 9] |
| Backups | PITR; daily snapshots retained 35 days; cross-region encrypted copy; S3 versioning; quarterly timed restore drills | [plan 9] |
| Single-tenant restore | Manual via per-tenant logical export; slower; stated in SLA | [plan 6.1, 9] |
| API availability | 99.9% (SLO) | [plan 6.13, proposal] |
| List view of 50k assets | p95 < 500 ms | [plan P9] |
| Global search | p95 < 200 ms | [plan P9, 6.7] |
| Time to first value | First 100 assets imported and labeled in under 30 minutes; median signup to 100 labeled assets under 1 day | [plan P1, 5.1] |
| API rate limits | Free 60, Starter 120, Pro 600 requests/min per tenant; returned in headers | [plan 8.2, 6.11] |
| Webhooks | HMAC-SHA256 signed with timestamp, exponential retry, dead-letter, delivery log with replay | [plan 6.11] |
| Audit log retention | 30 days Free, 1 year Starter, 3 years Pro, custom Enterprise | [plan 6.10] |
| Patch SLA | Critical vulnerabilities within 7 days | [plan 9] |
| Incident notification | 72 hours (GDPR) | [plan 9] |
| Deprecation policy | 12 months | [plan 6.11] |
| Tenant isolation | Zero cross-tenant findings in external pen test before GA; isolation harness on every PR | [plan 5.1, 9] |
| Accessibility / i18n | WCAG 2.2 AA target; i18n framework, English only at launch | [plan P4, 5.3] |
| Scan lookup latency (server side) | p95 < 150 ms for resolve-by-code | proposed |
| Check-out write | p95 < 300 ms server side | proposed |
| Webhook delivery latency | First attempt p95 < 30 s after commit | proposed |
| Interactive job queue wait | p95 < 5 s for interactive class | proposed |
| Import throughput | At least 10,000 rows/minute in commit phase; 100k-row dry run under 10 minutes | proposed |
| Attachment scan | Clean-file scan completes p95 < 60 s | proposed |
| Deployment (Cloud) | Zero-downtime rolling deploys; automatic rollback on alarm | [plan 6.13] with thresholds proposed |
| Capacity (one cell, MVP) | 500 active tenants, 2M assets total, 100 requests/second sustained | proposed (validate with load tests; plan states no sizing) |
| Infrastructure cost | Measured cost per 1,000 assets and per tenant to support the 75-80% gross-margin target | [plan 8.2 requires measurement] |
| Self-hosted minimum host | Linux x86_64 or arm64, Docker Engine 24+, Compose v2, 4 vCPU and 8 GB RAM for up to about 10,000 assets; bring-your-own Postgres 16-18 supported | decided (plan decision 28); Postgres range updated (validation: technical) |
| Self-hosted install time | Under 30 minutes from a clean supported host with DNS ready to first admin login, using the bundle | proposed |
| Self-hosted upgrade downtime | Under 5 minutes of API unavailability per upgrade excluding the customer's backup step; expand migrations run while the old version still serves; automatic rollback by digest on failed health check | proposed |
| Self-hosted support window | Current minor plus previous two (N-2), direct upgrade to latest from any supported version; monthly minor releases, security patch releases as needed | decided (plan decision 25) |
| Self-hosted patch SLA | Critical vulnerability patch release within 7 days, same as Cloud | decided (plan decision 25) |
| Self-hosted license check | Offline verification at boot and daily; no phone-home; read-only only after expiry plus a 30-day grace; export always allowed | decided (plan decision 26) |

---

## Appendix A. Inconsistencies, gaps and clarifications found in the plan

1. **Audit-log immutability vs. retention and deletion.** Plan 6.10 gives the app role INSERT/SELECT only, partitions the audit log by month, and sets retention per tier (30 days to 3 years). Retention is per tenant but partitions are shared by all tenants, so dropping a partition cannot honour different tiers, and tenant offboarding purge and DSAR deletion (plan 7.2, 9) also need DELETE. A dedicated retention role (INSERT-never, DELETE-only, audited, still subject to RLS) or per-tier partitioning is required. Hash chaining (v3) must tolerate retention.
2. **Pre-authentication lookups vs. RLS.** Login by email, API-key hash lookup, sessions, SSO domain mapping, invitation tokens and agent enrollment all happen before a tenant is known, yet `USER_ACCOUNT`, `API_KEY`, `INVITATION` are tenant tables under RLS (plan 7.3) and `SECURITY DEFINER` is banned (plan 6.1). This document introduces an `identity` schema of non-RLS lookup tables (hashes and ids only). The plan should state it.
3. **User identity is per tenant.** `USER_ACCOUNT` belongs to one tenant (plan 7.1), but multi-company operators (MSP console, v2 Could) and consultants need access to several tenants, and the same email may exist in several tenants. A global person/identity record (control plane) or an explicit tenant picker is missing from the plan.
4. **Multi-company (MSP) across cells.** The MSP console is now a v2 Could (decided 2026-11-17), so this is a deferred gap. Plan 6.1 models MSP parent-child as a control-plane link, and 6.14 lets tenants live in different cells. Delegated access across cells is undefined; this document constrains parent and children to the same cell.
5. **Redis.** Plan 6.2 lists Redis (small) for cache/rate limit, but the executive summary and 6.8 describe a Postgres-only MVP. Treated here as MVP infrastructure; if the team wants to drop Redis, rate limits can use Postgres at low volume.
6. **Framework wording.** Plan 6.2 says "NestJS (or Fastify)"; decision 3 says "NestJS/Fastify". Read as NestJS on the Fastify adapter. **Resolved by plan decision 3 (2026-11-17):** TypeScript modular monolith, NestJS on the Fastify adapter; the Django/DRF alternative is dropped.
7. **Queue library constraint.** Plan 6.2 offers pg-boss or Graphile Worker. Graphile Worker relies on LISTEN/NOTIFY by default and has no poll-only option, which degrades under the transaction-mode pooling that the plan's own pitfall list assumes (validation: technical). This document picks pg-boss. The earlier rationale ("plain SQL polling with SKIP LOCKED") was incomplete and is corrected (validation: technical, validation: spike): pg-boss claims jobs with `SKIP LOCKED` and serialises with `pg_advisory_xact_lock` (transaction-scoped, so pooler-safe), and LISTEN/NOTIFY is optional (off by default, opt-in per queue) and does not work through transaction pooling, so it stays off and workers poll. Its `pgboss` tables carry no RLS (ids-only payloads), and its single-maintainer status is a bus-factor risk, hence the queue adapter (section 5.2).
8. **RDS vs Aurora; RDS Proxy vs PgBouncer** are both left open in plan 6.2 and 6.1. Chosen here: RDS PostgreSQL 18, and **PgBouncer 1.26.1+ as the default pooler** (the spike passed the isolation suite through it). The plan's wording that RDS Proxy "does not pin on `SET LOCAL`" is not supported for PostgreSQL: AWS documents `SET` and `set_config` as pinning, offers no pinning filters, and pins statements over 16 KB; the exemption is documented only for MySQL. RDS Proxy stays optional behind a staging pinning test (section 7.1).
9. **Collector priority.** Plan 6.4 and the product brief place the customer-hosted collector in v3, but plan 5.2 rates distributed probes/collectors only "S" (Should) in v3. It is a Should, not a committed v3 deliverable.
10. **Migration role and FORCE RLS.** Plan 6.1 says migrations run as the owner role which "bypasses RLS (unless FORCE is set for that role path)". FORCE makes the *owner* subject to RLS but does not constrain superuser or BYPASSRLS roles; the migrator should be a plain owner role (not a superuser or BYPASSRLS), so backfills are tenant-explicit. Stated as a rule in section 8.5.
11. **Technical tables missing from the entity model (plan 7).** Outbox, idempotency keys, sessions, enrollment tokens, usage meter, queue tables and the `identity` lookup tables are needed but not listed. They should be added to the schema and the RLS lint classification (tenant-owned vs. non-tenant).
12. **UUIDv7 and the PostgreSQL version.** Plan 7.2 specifies UUIDv7 primary keys. PostgreSQL 18 has a native `uuidv7()` and is the target (RDS for PostgreSQL 18 since 2025-11-14; PG 16 community EOL is 2028-11, about 16 months after planned GA; validation: technical). IDs are still generated in the application as the single code path: it works on every supported version (self-hosted bring-your-own Postgres 16 and 17 have no native generator) and for client-created ids in the v2 offline app; `DEFAULT uuidv7()` is an optional safety net only where the server is 18 or later.
13. **"Cells need no application change" (plan 6.1) understates the work.** Cross-cell login routing, API-key and agent endpoint routing, entitlement distribution and Stripe-to-control-plane flow are needed (section 7.2).
14. **Webhook payloads and location scoping.** Plan 6.11 says payloads are identical to API representations, while RBAC has location scoping (plan 6.12). Webhook endpoints are tenant-level, created by Admin roles; payloads are not filtered per recipient. This should be stated in the event catalogue docs.
15. **The plan's earlier "no self-hosting" stance vs. AWS-only and bought-service dependencies.** Before plan decision 13 the plan excluded self-hosting, and its stack leaned on services a customer host cannot assume: S3, KMS, SES, Secrets Manager, Stripe, CloudFront + ALB, a bought SSO/SCIM vendor (internet-reachable), and a control plane built around cells and Stripe entitlements. With self-hosted now in the MVP, this document resolves the conflict without forking: every such dependency sits behind an adapter interface (`StorageAdapter`, `MailAdapter`, `KeyProvider`, `SecretsProvider`, `EntitlementSource`, `PushAdapter`) with a Cloud and a self-hosted implementation in one image; the control plane gains a `local` mode that reads a signed license file instead of Stripe and has one seeded tenant and no cells; the web app is served by a bundled Caddy container instead of S3 + CloudFront; SSO uses built-in OIDC in self-hosted (the vendor needs internet; self-hosted SAML is v2 via a bundled Keycloak broker with an OIDC-only app core, and SCIM is v2; the original plan had built-in SAML libraries, which validation: technical flagged as high risk). Sections 3, 4, 5, 6.d, 7.3, 8, 9 and 11 mark which statements are Cloud-edition only. The plan's remaining "SaaS" wording (executive summary, positioning, P11, non-goals, risks, 12.7 MoSCoW) is updated in the plan itself.

## Appendix B. Proposed additions (not in plan)

| # | Addition | Where | Why |
|---|---|---|---|
| 1 | `identity` schema of non-RLS pre-auth lookup tables | 5.1 | Resolve gap A.2 |
| 2 | Control-plane security log for pre-tenant events | 9 | Failed logins with no tenant |
| 3 | Vanity subdomain per tenant, per-tenant DNS record, login directory, cell hint in API-key prefix | 7.2 | Routing without a runtime router |
| 4 | Entitlement snapshots pushed to cells | 7.2 | Cell survives control-plane outage |
| 5 | Same-cell rule for multi-company (MSP) parent/child; the console itself is a v2 Could (decided 2026-11-17) | 7.2 | Gap A.4 |
| 6 | Separate AWS accounts per environment/cell (AWS Organizations) | 7.2, 8.4 | Blast radius, least privilege |
| 7 | AWS WAF on CloudFront; ALB accepts only CloudFront | 7.1, 9 | Perimeter hardening |
| 8 | VPC endpoints for S3, ECR, Secrets Manager, KMS, Logs | 7.1 | Cost and reduced NAT exposure |
| 9 | ClamAV as its own ECS service; completion callback and orphan sweep; separate cookie-less files domain | 3, 9 | Concrete shape for plan 6.6 |
| 10 | KMS encryption context binding ciphertext to `tenant_id` | 9 | Cryptographic tenant binding |
| 11 | Idempotency-key table; outbox table; usage-meter table | 5.1, 6 | Implement plan 6.11, 6.8, 5.3 |
| 12 | Opaque per-asset code in QR URLs | 6.a | Non-guessable, no id leakage |
| 13 | Import rollback behaviour for rows edited after import (feature ships in v1.1, plan decision 22) | 6.b | Safe undo semantics |
| 14 | Webhook retry schedule, auto-pause threshold, secret-rotation overlap | 6.c | Concrete parameters for plan 6.11 |
| 15 | Break-glass owner exempt from enforced SSO | 6.d | Prevent lockout |
| 16 | Dependency-boundary lint tooling (dependency-cruiser or ESLint boundaries) | 4 | Enforce plan 6.2 rule |
| 17 | Trivy scanning, SBOM, cosign v3 key-based image signing (verify with `--key`; registry with OCI 1.1 referrers), ECR cross-region replication, GitHub OIDC to AWS | 7.1, 8.3 | Supply-chain and DR readiness |
| 18 | Minimum client version check for the web app and the Expo app | 8.3 | Version skew with long-lived browser sessions and installed binaries |
| 19 | Fargate sizing starting points; extraction and scale-out thresholds | 7.1, 10 | Planning aids, to be validated |
| 20 | Additional NFR targets in section 11 marked proposed | 11 | Make performance goals testable |
| 21 | Collector image supply-chain signing; supported-runtime constraints (Linux, NET_RAW) | 8.1 | Customer-pulled artifact |
| 22 | Egress proxy (e.g. Smokescreen) as later SSRF hardening | 7.1 | Defence in depth |
| 23 | Materialized path or `ltree` column for asset hierarchy; dedicated time-series store and ingest path for EAM sensor data | 4, 10 | Deeper trees for CMMS/EAM (plan 13.2); high-volume IoT data (plan 13.1) |
| 24 | Offline sync conflict rules for the v2 offline-first Expo app (MVP is online-first with a retry queue): last-writer-wins per field with audit; check-out, check-in and transfer rejected with 409 and surfaced; per-asset ordered mutation queue replayed with idempotency keys | 6.a | Safe offline writes without silent overwrites |
| 25 | Expo push notifications (MVP Should, Cloud only) sent by the worker role through the Expo push service to APNs/FCM; tenant-scoped device push tokens; id-only payloads (self-hosted push: see item 43) | 3, 9 | Push for field technicians without a new service |
| 26 | Mobile token storage (MVP): OAuth/OIDC code + PKCE, short-lived access token plus rotating refresh token with reuse detection, held in `expo-secure-store`; cache wipe on logout or revocation | 9 | No cookies on native; revocable lost devices |
| 27 | EAS Update code signing (MVP; key in the protected CI secret store, certificate embedded in binaries; requires the EAS Production plan, $199/month plus usage; OTA for fixes only); EAS channels and runtime versions per environment | 8.3, 9 | OTA code delivery to field devices must be authentic |
| 28 | Adapter interfaces `StorageAdapter`, `MailAdapter`, `KeyProvider`, `SecretsProvider`, `EntitlementSource`, `PushAdapter`, plus `QueueAdapter` over pg-boss; `EDITION` runtime setting; contract tests per implementation; new `crypto` kernel module owning key and secret providers | 4, 7.3 | Run one image in both editions without edition branches in domain code |
| 29 | License file design: compact JWS (EdDSA/Ed25519, `kid` in the header, verified with Node `crypto` or `jose`; replaces the earlier Ed25519 over RFC 8785 canonical JSON), embedded public keys with `kid` for rotation, offline verification at boot and daily, highest-seen-time clock guard, Community fallback on invalid file | 7.3 | Offline licensing with no phone-home |
| 30 | Enforcement states ok, warning, grace, read-only (90% asset limit and 30 days before expiry warnings, 30-day grace, refuse new assets above band in grace, export always allowed) (decided, plan decision 26) | 7.3 | Enforce the license without data lockout |
| 31 | Control-plane `local` mode: one seeded tenant, tenant-creation API, Stripe and billing, cell map and impersonation disabled; RLS and `withTenantTx` unchanged; diagnostics bundle instead of impersonation | 5, 7.3 | Single-tenant self-hosted on the same code path |
| 32 | Self-hosted compose bundle: service list, profiles (`bundled-db`, `bundled-storage`, `scan`), volumes, Docker secrets, `.env.example`, helper scripts, `caddy-web` image with the static export baked in | 7.3, 8.7 | Customer installs from one bundle with no AWS |
| 33 | Self-hosted release pipeline: semver tag promotes the staged backend digest, cosign v3 key-based signing with public key in the bundle (OCI 1.1 referrers; signature bundles in offline tarballs in v2), SBOM, fresh-install, N-2 upgrade and mobile TLS tests, license-gated registry | 8.3 | Verifiable, tested releases for hosts we do not operate |
| 34 | Self-hosted upgrade rules: expand-only releases, contract no earlier than three minors later, direct upgrade from any N-2 version (decided, plan decision 25), bridge release for older versions and backup prompt before migrate (proposed) | 7.3, 8.5 | Safe customer-driven upgrades |
| 35 | Mobile server selection: server URL entry, setup QR, MDM managed config (decided, plan decision 28), `/.well-known/asset-tracker` discovery document (proposed), app and server API-range check | 7.3 | One store app for both editions |
| 36 | Self-hosted security model: shared-responsibility split, hardening guide, advisory feed and 7-day critical patch SLA (decided, plan decision 25), SOC 2 scope limited to Cloud and the build and release pipeline (decided, plan decision 15); master key from a Docker secret with Vault or cloud KMS adapter in v2 (decided, plan decision 27) | 9 | Clear accountability when the customer runs the infrastructure |
| 37 | Self-hosted NFR targets: minimum host sizing, install under 30 minutes, upgrade downtime under 5 minutes, N-2 support window | 11 | Make the self-hosted promise testable |
| 38 | PostgreSQL 18 as the target (RDS for PostgreSQL 18; bundled `postgres:18`; BYO 16-18; CI matrix 16 and 18); app-side UUIDv7 kept as the single code path (validation: technical) | Conventions, 7.1, 7.3, 8.2, 8.3, A.12 | PG 16 community EOL falls about 16 months after GA; native `uuidv7()` on 18 |
| 39 | PgBouncer 1.26.1+ as the default pooler for Cloud (2 Fargate tasks behind an internal NLB), `max_prepared_statements` set; RDS Proxy optional after a staging pinning test (validation: technical, validation: spike) | 7.1, 8.2, A.8 | AWS documents `SET` and `set_config` as pinning on PostgreSQL; the spike passed through PgBouncer |
| 40 | pg-boss runtime rules: polling, no LISTEN/NOTIFY behind a pooler, schema creation and upgrades by `migrator` over a direct connection, runtime flags off, one maintenance instance, `pgboss` grants re-applied after upgrades, transactional enqueue, ids-only payloads, `QueueAdapter` (validation: spike) | 5.2, 4, A.7 | `pgboss` tables have no RLS; single-maintainer risk |
| 41 | RLS additions: `NULLIF` policy form in `USING` and `WITH CHECK`, parent-only grants on partitions with lint and direct-partition test, optional per-partition FORCE, FORCE side effects for backfills, isolation suite through PgBouncer with a negative control (validation: spike) | 5.3, 8.3, 8.5 | Direct partition access leaked; pooled connections return `''` after a tenant transaction |
| 42 | Static-export routing: query-string detail routes or a catch-all client-routed shell with SPA fallback (replaces the CloudFront Function shell rewrite); headers from CloudFront and Caddy; week-1 routing spike; CI check for unsupported features (validation: technical) | 3, 7.1, 8.3 | The shell-page rewrite is not a documented Next.js pattern; `headers`, `rewrites`, Proxy are unsupported in export |
| 43 | License-gated push relay operated by us for self-hosted (v1.1, opt-in, no push at MVP, none when air-gapped) | 3, 7.3, 9 | Expo push tokens belong to our Expo project |
| 44 | Self-hosted TLS: three modes (customer certificate default, public ACME with optional DNS-plugin Caddy build, `tls internal` for evaluation only); Android user-CA caveat; mobile TLS test in CI | 7.3, 8.3, 8.7 | The Expo app does not trust an internal CA by default on Android |
| 45 | Bundled Keycloak broker as an optional v2 compose profile (`sso`) with an OIDC-only app core; no in-app SAML libraries; SAML and SCIM on Cloud as a per-connection entitlement item | 6.d, 7.3, 8.7, 9 | node-saml and samlify advisories; vendor cost is per connection |
| 46 | Store readiness: permanent Cloud demo tenant and no-MFA reviewer account, Play organisation account, Apple 4.8 and 5.1.1(v) assessment, public or unlisted distribution, MDM managed config; scanning symbology device test matrix | 8.3 | App Review and Play app-access requirements |
| 47 | Toolchain pins (Node 24 LTS min 22.13, NestJS 12 and Fastify 5 with Vitest, Next.js 16.4.x, Expo SDK 58, PgBouncer 1.26.1+, pg-boss 12.x, cosign v3); duplicate `react`/`react-native` CI check; `nodeLinker: hoisted` fallback | 8.1, 8.6 | Current versions per validation; Expo in a pnpm monorepo |
| 48 | Google Admin (ChromeOS) device sync as a v1.1 connector next to Intune and Entra ID; MVP Google Admin CSV importer template | 3, 4, 10 | Education and nonprofit vertical (decided 2026-11-17) |
