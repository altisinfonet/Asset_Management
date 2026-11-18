# Asset Tracker

Asset management platform. Monorepo managed with **pnpm workspaces + Turborepo**. Product and
architecture docs live in [`docs/`](docs/) (start with `02_product_plan.md` and
`03_system_architecture.md`; this layout is section 8.6).

```text
apps/
  api/            NestJS 12 on Fastify, ESM. One image, roles: api | worker | scheduler | migrate
  web/            Next.js 16 App Router, static export (output: 'export'), Tailwind CSS v4
  (mobile/        Expo app, added in milestone M3)
packages/
  schemas/        zod schemas shared by api, web and mobile
  api-client/     typed fetch client, generated from docs/engineering/openapi.yaml (CI fails when stale)
  ui-tokens/      design tokens generated from docs/design/tokens.json (CSS variables, Tailwind theme)
docker/postgres/init/   roles (app_owner, app_user) and extensions for the dev database
docker/pgbouncer/        PgBouncer config for dev and CI (transaction mode, `app_one` negative-control alias)
```

## Prerequisites

- Node 24 LTS (`.nvmrc`; minimum 22.13) with Corepack: `corepack enable`
- pnpm is pinned in `package.json` (`packageManager`); Corepack installs that exact version
- Docker (Compose v2) for the local stack

## Quick start

```bash
pnpm install                      # frozen lockfile in CI: pnpm install --frozen-lockfile
pnpm turbo run lint typecheck test build
```

Everything the CI `check` job runs is `pnpm format:check` plus the command above.

### Run the stack and sign in (Docker)

```bash
docker compose up -d --build      # postgres 18, pgbouncer, mailpit, minio, migrate (+ demo seed), api, worker, scheduler
curl http://localhost:3000/v1/health
curl http://localhost:3000/v1/version
docker compose down -v            # stop and delete volumes
```

The `migrate` service seeds two demo tenants, **Acme** and **Globex** (dev only; the seed refuses production).
To use the web app on top of that stack:

```bash
docker compose --profile web up -d            # Next.js dev server on http://localhost:3001, /v1 proxied to the api
# or the production build (turbo builds the workspace packages first; a plain
# `pnpm --filter @assettracker/web build` can pick up a stale packages/*/dist):
pnpm turbo run build --filter=@assettracker/web
node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000
```

Open http://localhost:3001 and sign in. Every demo user has the password `Demo-Passw0rd-2026`:

| User                                                                                                      | Role                                         |
| --------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `owner@acme.example`, `owner@globex.example`                                                              | Owner, asks for a 6-digit authenticator code |
| `admin@acme.example`, `technician@acme.example`, `viewer@acme.example` (and the same at `globex.example`) | Admin, Technician, Viewer, password only     |

The Owner's TOTP secret is `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP` (add it to any authenticator app, or compute the
code with `apps/api/src/auth/totp.ts`). Mail (invitations, password reset) arrives in Mailpit,
http://localhost:8025. API reference: `GET http://localhost:3000/v1/openapi.json`.

| Service    | Host port        | Notes                                                                                                     |
| ---------- | ---------------- | --------------------------------------------------------------------------------------------------------- |
| api        | 3000             | `GET /v1/health` (DB check through PgBouncer), `GET /v1/version`                                          |
| postgres   | 5433             | direct; roles `app_owner` (owner) and `app_user` (RLS-bound), password `dev`                              |
| pgbouncer  | 6432             | transaction mode, `max_prepared_statements=100`, pool size 4; `app_user` uses it                          |
| mailpit    | 1025 SMTP / 8025 | UI at http://localhost:8025                                                                               |
| minio      | 9000 / 9001      | console at http://localhost:9001 (`minioadmin` / `minioadmin-dev`)                                        |
| web (opt.) | 3001             | `docker compose --profile web up -d`, hot reload, `/v1` proxied to api; sign in with the demo users above |

Ports are overridable in `.env` (copy `.env.example`); Postgres defaults to 5433 because 5432 is
often in use. Migrations always use the direct `MIGRATOR_DATABASE_URL`, never PgBouncer.
`docker compose run --rm migrate` applies new migrations.

### Develop without Docker for the apps

```bash
docker compose up -d postgres pgbouncer migrate     # just the data plane
cp .env.example .env                                # then export it in your shell
DATABASE_URL=postgres://app_user:dev@localhost:6432/app pnpm --filter @assettracker/api dev
pnpm --filter @assettracker/web dev                 # http://localhost:3001, proxies /v1 to :3000
```

`pnpm dev` runs every package's `dev` task through Turborepo.

### Web: static export and the dev proxy

`pnpm --filter @assettracker/web build` writes the static site to `apps/web/out/`. Production
serves it from S3 + CloudFront (or Caddy self-hosted) with `/v1` routed to the API at the edge,
so no API URL is baked in. Next.js `rewrites` are not allowed with `output: 'export'`, so the
dev-only `/v1` proxy exists only in the dev-server phase of `next.config.ts` (target:
`API_PROXY_URL`, default `http://localhost:3000`).

### Tests

- `pnpm test` runs unit tests (Vitest) across packages.
- `pnpm test:e2e` runs the API e2e tests, including the two-tenant isolation suite
  (`apps/api/test/isolation`). Without `DATABASE_URL` the database-backed cases are skipped. Against
  the compose stack, direct and through PgBouncer (the second run includes the negative control):

  ```bash
  export MIGRATOR_DATABASE_URL=postgres://app_owner:dev@localhost:5433/app
  ISOLATION_MODE=direct DATABASE_URL=postgres://app_user:dev@localhost:5433/app pnpm test:e2e
  ISOLATION_MODE=pooled DATABASE_URL=postgres://app_user:dev@localhost:6432/app     POOLED_ONE_URL=postgres://app_user:dev@localhost:6432/app_one pnpm test:e2e
  ```

  The e2e suite runs on its own pg-boss schema (`JOBS_SCHEMA=pgboss_e2e`, provisioned by
  `apps/api/test/support/global-setup.ts`), so it is safe to run while the compose `worker` and
  `scheduler` are up: they poll the default `pgboss` schema and never see the suite's jobs.

- `pnpm --filter @assettracker/web test:e2e` runs the mock-API Playwright suites (build included);
  `pnpm --filter @assettracker/web build` followed by `pnpm --filter @assettracker/web test:e2e:real` runs the
  **real-stack** smoke suite (project `real`: category, asset, edit with a 412, bulk actions, invite + Mailpit, logout)
  against `docker compose up`; set `PW_CHANNEL=chrome` to use an installed Chrome.
- `scripts/ci/compose-smoke.sh` (the CI smoke test), `scripts/ci/perf-seed.sh` + `scripts/ci/perf-check.mjs` (performance budgets
  on 2 x 50,000 assets).
- `docker compose --profile pooling run --rm pgbouncer-check` asserts the PgBouncer settings
  (transaction mode, `max_prepared_statements=100`, empty `server_reset_query`, pool size 4).
- `pnpm --filter @assettracker/api schema:lint` runs `app.schema_lint()` plus the role audit
  (needs `MIGRATOR_DATABASE_URL`); CI runs it after migrating.

## API roles

One image, role chosen by command (or `APP_ROLE`):

```bash
node dist/main.js api         # HTTP on :3000
node dist/main.js worker      # stub: logs and idles (queue handlers come later)
node dist/main.js scheduler   # stub: logs and idles
node dist/main.js migrate     # applies apps/api/migrations/*.sql as app_owner, rolls the partition window, runs the schema lint, exits
```

Configuration is validated at start-up with zod (`apps/api/src/config/env.ts`); see
`.env.example`. Logs are structured JSON (pino). Tenant context for row-level security is set
with `TenancyService.withTenantTx({ tenantId }, fn)`, which opens a transaction and runs
`set_config('app.tenant_id' | 'app.actor_id' | 'app.request_id', $n, true)` first (never a
session-level `SET`, which leaks through a transaction pooler). Repositories extend
`TenantRepository`, whose Prisma transaction client only exists inside that transaction. Data access is Prisma 7 (driver adapter, SQL migrations stay the source of truth, `pnpm --filter @assettracker/api db:pull` regenerates `schema.prisma`)
(ADR 0001); only `src/tenancy` and `src/db` may import the database client (ESLint).

Operator CLI (after `pnpm build`):

```bash
pnpm --filter @assettracker/api cli tenant:create --name "Acme" --admin-email admin@acme.example
pnpm seed          # demo tenants Acme and Globex (idempotent, refuses NODE_ENV=production)
```

### Migrations

SQL-first, numbered files in `apps/api/migrations/` (`0001_init.sql`, ...), applied in order by a
small runner (`apps/api/src/db/migrator.ts`): one direct connection, a session advisory lock,
each file in a transaction with `lock_timeout`/`statement_timeout`, history in
`public.schema_migrations` with checksums (editing an applied file fails). Start a file with
`-- migrate:no-transaction` for statements such as `CREATE INDEX CONCURRENTLY`.

## CI

`.github/workflows/ci.yml` (`check`, `api-e2e` on Postgres 16 and 18 direct and through PgBouncer,
`image`, `compose-smoke`, `web-e2e-real`, `image-scan` with SBOM, `publish`, `ci-gate`), `security.yml` (dependency
audit, gitleaks), `codeql.yml` and the nightly `perf.yml`. Required checks, security exceptions,
performance budgets and what only GitHub can verify: [`docs/engineering/ci.md`](docs/engineering/ci.md).
Developer reference (setup per OS, ports, e2e modes, troubleshooting):
[`docs/engineering/developer-guide.md`](docs/engineering/developer-guide.md); threat model:
[`docs/engineering/threat-model.md`](docs/engineering/threat-model.md); decisions:
[`docs/adr/`](docs/adr/README.md).
