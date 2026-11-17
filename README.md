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
  api-client/     typed fetch client (placeholder; to be generated from the OpenAPI document)
  ui-tokens/      design tokens (placeholder until docs/design/tokens.json lands)
docker/postgres/init/   roles (migrator, app) and extensions for the dev database
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

### Run the stack (Docker)

```bash
docker compose up -d --build      # postgres 18, pgbouncer, mailpit, minio, migrate, api
curl http://localhost:3000/v1/health
curl http://localhost:3000/v1/version
docker compose down -v            # stop and delete volumes
```

| Service    | Host port        | Notes                                                                   |
| ---------- | ---------------- | ----------------------------------------------------------------------- |
| api        | 3000             | `GET /v1/health` (DB check through PgBouncer), `GET /v1/version`        |
| postgres   | 5433             | direct; roles `migrator` (owner) and `app` (RLS-bound), password `dev`  |
| pgbouncer  | 6432             | transaction mode, `max_prepared_statements=100`; the `app` role uses it |
| mailpit    | 1025 SMTP / 8025 | UI at http://localhost:8025                                             |
| minio      | 9000 / 9001      | console at http://localhost:9001 (`minioadmin` / `minioadmin-dev`)      |
| web (opt.) | 3001             | `docker compose --profile web up -d`, hot reload, `/v1` proxied to api  |

Ports are overridable in `.env` (copy `.env.example`); Postgres defaults to 5433 because 5432 is
often in use. Migrations always use the direct `MIGRATOR_DATABASE_URL`, never PgBouncer.
`docker compose run --rm migrate` applies new migrations.

### Develop without Docker for the apps

```bash
docker compose up -d postgres pgbouncer migrate     # just the data plane
cp .env.example .env                                # then export it in your shell
DATABASE_URL=postgres://app:dev@localhost:6432/app pnpm --filter @assettracker/api dev
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
- `pnpm test:e2e` runs the API e2e tests. The health test needs a real database through
  PgBouncer: `DATABASE_URL=postgres://app:dev@localhost:6432/app pnpm test:e2e` (without
  `DATABASE_URL` the database-backed cases are skipped, the degraded-health cases still run).

## API roles

One image, role chosen by command (or `APP_ROLE`):

```bash
node dist/main.js api         # HTTP on :3000
node dist/main.js worker      # stub: logs and idles (queue handlers come later)
node dist/main.js scheduler   # stub: logs and idles
node dist/main.js migrate     # applies apps/api/migrations/*.sql as the migrator role, exits
```

Configuration is validated at start-up with zod (`apps/api/src/config/env.ts`); see
`.env.example`. Logs are structured JSON (pino). Tenant context for row-level security is set
with `DbService.withTenant(tenantId, fn)`, which runs `select set_config('app.tenant_id', $1, true)`
inside a transaction (never a session-level `SET`, which leaks through a transaction pooler).

### Migrations

SQL-first, numbered files in `apps/api/migrations/` (`0001_init.sql`, ...), applied in order by a
small runner (`apps/api/src/db/migrator.ts`): one direct connection, a session advisory lock,
each file in a transaction with `lock_timeout`/`statement_timeout`, history in
`schema_migrations` with checksums (editing an applied file fails). Start a file with
`-- migrate:no-transaction` for statements such as `CREATE INDEX CONCURRENTLY`.

## CI

`.github/workflows/ci.yml`: `check` (format, lint, typecheck, test, build, uploads the static
export), `api-e2e` (Postgres 16 and 18 service containers plus a PgBouncer service in
transaction mode, roles script, migrate twice, e2e as the `app` role), and `docker-build`.
