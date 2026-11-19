# Developer guide

For people (and agents) working in this repository. The README is the five-minute version; this is the
reference: setup per operating system, ports, environment, commands, the test modes, and recipes for the
two things you will do most (a tenant table, a route). CI is described in [`ci.md`](ci.md); the security
reasoning in [`threat-model.md`](threat-model.md) and [`auth-security.md`](auth-security.md).

Placeholder used in docs: the repository owner is written `@OWNER` (replace it with the real GitHub
handle in `.github/CODEOWNERS`).

## 1. Setup

You need: Node 24 LTS (`.nvmrc`; the minimum is 22.13), Corepack (ships with Node 24), Docker with
Compose v2.24 or newer, Git. pnpm is **not** installed globally: the root `package.json` pins it
(`"packageManager": "pnpm@12.21.0"`) and Corepack provides exactly that version.

### Windows 10/11

1. Install **Git for Windows** (it provides Git Bash; the repo scripts under `scripts/ci/` are bash),
   **Docker Desktop** (WSL 2 backend) and a Node version manager (`nvm-windows` or `fnm`), then
   `nvm install 24 && nvm use 24`.
2. Enable Corepack **once from an elevated terminal** (it links `pnpm.cmd` into the Node directory):
   `corepack enable`. Without elevation use a user directory instead:
   `corepack enable --install-directory "%USERPROFILE%\bin"` and put that folder first on `PATH`.
3. Clone with Git's default line-ending handling; the repo has `* text=auto eol=lf` in `.gitattributes`
   so scripts keep LF. If a shell script fails with `$'\r': command not found`, the checkout converted
   line endings: `git config core.autocrlf false`, re-clone.
4. In Git Bash prefix Docker commands that contain Unix paths with `MSYS_NO_PATHCONV=1` (see
   troubleshooting). PowerShell needs no prefix.
5. Docker Desktop: give it at least 4 GB of memory (Postgres, PgBouncer, MinIO and the API images).

### macOS

`brew install --cask docker` (or Colima: `brew install colima docker docker-compose && colima start`),
`brew install nvm` or `fnm`, `nvm install 24`, `corepack enable`. Apple silicon runs the same images
(`linux/arm64`); the pinned base image digest in `apps/api/Dockerfile` is multi-arch.

### Linux

Install Docker Engine plus the Compose plugin (`docker compose version` must work and be 2.24 or newer),
add yourself to the `docker` group, install Node 24 with `nvm` or your package manager, `corepack enable`
(use `sudo corepack enable` if Node lives in a root-owned prefix).

### First run

```bash
corepack enable
pnpm -v                                   # must print 12.21.0
pnpm install
pnpm turbo run lint typecheck test build  # what CI runs, plus `pnpm format:check`
docker compose up -d --build              # postgres 18, pgbouncer, mailpit, minio, migrate, api, worker, scheduler
curl http://localhost:3000/readyz
curl http://localhost:3000/v1/health
```

Demo data: the compose `migrate` service runs with `SEED_DEMO_DATA=true` and creates the tenants
**Acme** and **Globex** (4 users and 50 assets each). Every demo user signs in with the dev password
`Demo-Passw0rd-2026`, for example `viewer@acme.example` or `admin@globex.example`. The Owner
(`owner@acme.example`) has MFA enrolled; its TOTP secret is `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`
(`apps/api/src/auth/demo-credentials.ts`). Dev and demo only: the seed refuses `NODE_ENV=production`.

## 2. Ports

| Port | Service                | Notes                                                                                       |
| ---- | ---------------------- | ------------------------------------------------------------------------------------------- |
| 3000 | api                    | `GET /readyz`, `/healthz`, `/v1/health`, `/v1/version`; override with `API_PORT`            |
| 3001 | web (profile `web`)    | Next.js dev server with hot reload, proxies `/v1` to the api; `WEB_PORT`                    |
| 5433 | postgres 18 (direct)   | host port; container 5432. Roles `postgres`, `app_owner`, `app_user`, password `dev`; `POSTGRES_PORT` |
| 6432 | pgbouncer              | transaction pooling; **`app_user` only**. `PGBOUNCER_PORT`                                  |
| 1025 | mailpit SMTP           | `MAILPIT_SMTP_PORT`                                                                         |
| 8025 | mailpit UI and API     | http://localhost:8025, API at `/api/v1/...`; `MAILPIT_UI_PORT`                              |
| 9000 / 9001 | minio, console  | `minioadmin` / `minioadmin-dev`; `MINIO_PORT`, `MINIO_CONSOLE_PORT`                         |
| 9464 | ops server (internal)  | `/metrics` (all roles), `/healthz` + `/readyz` (worker, scheduler). **Never published**: inside the container network only |

5433 instead of 5432 is deliberate (a local Postgres usually owns 5432). CI uses 5432 for its service
container. Copy `.env.example` to `.env` to change host ports. To run a second stack next to the first
use another project name and other host ports: `docker compose -p other up -d` with `API_PORT=...` etc.

## 3. Environment variables

`.env.example` documents all of them. The ones you touch:

| Variable                               | Used by                | Meaning                                                                                                   |
| -------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                         | api, worker, scheduler, tests | Runtime role `app_user` (non-owner, NOBYPASSRLS), normally THROUGH PgBouncer (`...@localhost:6432/app`)  |
| `MIGRATOR_DATABASE_URL`                | migrate, scheduler, tests, CLI | Owner `app_owner`, **direct** to Postgres (`...@localhost:5433/app`), never through the pooler    |
| `MAINTENANCE_DATABASE_URL`             | scheduler              | Owner credentials for partition rotation, direct. The only long-running role that holds them             |
| `ADMIN_DATABASE_URL`                   | e2e only (optional)    | Superuser (`postgres`), used by one schema-lint test that flips BYPASSRLS inside a rolled-back transaction |
| `ISOLATION_MODE`                       | e2e                    | `direct` or `pooled` (labels the suite and selects the negative control)                                  |
| `POOLED_ONE_URL`                       | e2e, pooled mode       | `app_user` on the `app_one` PgBouncer alias (`pool_size=1`) for the negative control                      |
| `SMTP_URL`, `MAIL_FROM`                | api, worker            | `smtp://localhost:1025` for Mailpit                                                                       |
| `MAILPIT_API_URL`                      | e2e                    | `http://localhost:8025`; with `SMTP_URL` it enables the mail e2e block                                    |
| `JOBS_SCHEMA`                          | worker, scheduler, e2e | pg-boss schema. Default `pgboss`; the e2e config forces `pgboss_e2e`                                      |
| `STORAGE_DRIVER`, `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY[_FILE]`, `S3_CREATE_BUCKET` | api, worker | Object storage (M2-FILE-01): `s3` (MinIO / S3) or `local` (`FILES_LOCAL_DIR`, public base `FILES_BASE_URL`). Default: `s3` when `S3_ENDPOINT` is set. Compose points them at MinIO |
| `CLAMD_HOST`, `CLAMD_PORT`, `SCAN_REQUIRED` | worker (and e2e)   | ClamAV daemon for upload scans. `SCAN_REQUIRED=false` marks uploads clean unscanned when no scanner is configured (default `true`: stay `pending`) |
| `FILES_UPLOAD_URL_TTL_SECONDS`, `FILES_DOWNLOAD_URL_TTL_SECONDS`, `FILES_MAX_BYTES_CEILING` | api | Presigned URL lifetimes (600 s / 120 s) and the hard upload ceiling (100 MiB) over the per-plan caps |
| `SCAN_RESOLVE_MAX_MISSES`              | api                    | Scan-resolve misses per principal and throttle window before `429` (default 60, M2-TAG-01)              |
| `MASTER_KEY_FILE` (or `MASTER_KEY`)    | all roles              | Envelope-encryption master key, 32 random bytes base64. Compose mounts the dummy `docker/secrets/master_key.dev`. Production refuses to start without one; dev falls back to an ephemeral key |
| `TRUST_PROXY`                          | api                    | Default `false`. Set the proxies' addresses behind a load balancer; never `true` on a reachable API       |
| `OPS_PORT`, `OPS_HOST`, `OPS_ENABLED`  | all roles              | internal ops server; 9464 / 0.0.0.0 / on                                                                  |
| `OTEL_EXPORTER_OTLP_ENDPOINT`          | all roles              | tracing is off until set                                                                                  |
| `WEB_BASE_URL`, `TENANT_HOST_SUFFIX`   | api                    | invitation and reset links; optional per-tenant hostnames                                                 |
| `SEED_DEMO_DATA`                       | migrate                | create Acme and Globex after migrating (refused in production)                                            |

Secrets never go in compose files or the repo: `*_FILE` variants read a mounted file (Docker secret).
A real install generates its own key: `openssl rand -base64 32 > master_key && chmod 600 master_key`,
and **backs it up**, because encrypted data is unreadable without it.

## 4. Common commands

```bash
pnpm install                                   # frozen lockfile in CI: pnpm install --frozen-lockfile
pnpm turbo run lint typecheck test build       # the CI check (add --force to bypass the cache)
pnpm format                                    # prettier --write; `pnpm format:check` is the CI gate
pnpm --filter @assettracker/api test           # api unit tests
pnpm --filter @assettracker/api dev            # tsc watch + node --watch (needs DATABASE_URL etc. exported)
pnpm --filter @assettracker/web dev            # http://localhost:3001, /v1 proxied to :3000
pnpm --filter @assettracker/api migrate        # apply migrations as app_owner (needs MIGRATOR_DATABASE_URL, after a build)
pnpm --filter @assettracker/api schema:lint    # schema lint + role audit on the migrated database
pnpm --filter @assettracker/api db:pull        # regenerate prisma/schema.prisma from the migrated database
pnpm --filter @assettracker/api cli tenant:create --name "Acme" --admin-email admin@acme.example
pnpm seed                                      # demo tenants (idempotent)
docker compose run --rm migrate                # apply new migrations inside compose
docker compose --profile pooling run --rm pgbouncer-check
docker compose logs -f api worker              # follow logs
scripts/ci/compose-smoke.sh                    # what CI runs: up, wait for /readyz, probe, down
```

## 5. Running the e2e suites (each mode)

The database, SMTP and admin cases use `describe.skipIf(!env)`: with a variable missing they **skip and
the run is still green**. Set everything when you mean to run everything. With the compose stack up
(ports as in section 2):

```bash
export MIGRATOR_DATABASE_URL=postgres://app_owner:dev@localhost:5433/app
export ADMIN_DATABASE_URL=postgres://postgres:dev@localhost:5433/app
export SMTP_URL=smtp://localhost:1025 MAILPIT_API_URL=http://localhost:8025
# File pipeline (M2-FILE): MinIO for the S3 variants, clamd for the ClamAV variants of test/files
export S3_ENDPOINT=http://localhost:9000 CLAMD_HOST=localhost CLAMD_PORT=3310

# Direct: app_user -> Postgres
ISOLATION_MODE=direct DATABASE_URL=postgres://app_user:dev@localhost:5433/app \
  pnpm --filter @assettracker/api test:e2e

# Pooled: app_user -> PgBouncer, including the negative control (needs the app_one alias)
ISOLATION_MODE=pooled DATABASE_URL=postgres://app_user:dev@localhost:6432/app \
  POOLED_ONE_URL=postgres://app_user:dev@localhost:6432/app_one pnpm --filter @assettracker/api test:e2e
```

Prove nothing was skipped (what CI does): add `--reporter=default --reporter=json --outputFile.json=e2e.json`
to the command above, then `node scripts/ci/assert-no-skips.mjs apps/api/e2e.json`. A full run is about 570
tests in 43 files and takes two to three minutes per mode.

- **Parallelism is bounded on purpose.** Each test file boots its own app (connection pool, pg-boss pool), so the
  files in flight are the database clients. `vitest.e2e.config.ts` runs at most six files at once
  (`E2E_MAX_WORKERS` overrides) and gives each app a pool of 6. The dev/CI stack matches: PgBouncer
  `default_pool_size=16`, `max_client_conn=1000`, Postgres `max_connections=300`. At the vitest default (cores - 1)
  the suite opened 60+ pooled clients on a 4-connection pool and 300+ direct connections, so a busy machine
  produced 30 s timeouts, 500s and "remaining connection slots are reserved" errors in 8 to 22 files. After
  changing `pgbouncer.ini` run `docker compose restart pgbouncer`.

- The suite uses its own pg-boss schema (`pgboss_e2e`, provisioned by `test/support/global-setup.ts`), so
  it is safe to run while the compose `worker` and `scheduler` are up.
- Without a database the suite runs only what needs none. Without `MAILPIT_API_URL` the mail block
  skips; without `ADMIN_DATABASE_URL` one schema-lint fixture skips.
- `test/files` always runs the local-filesystem storage driver with a fake scanner. `S3_ENDPOINT`
  (MinIO, bucket `e2e-files` is created; `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` default to the
  dev `minioadmin` pair) adds the S3 variant with real presigned URLs, and `CLAMD_HOST` / `CLAMD_PORT`
  the ClamAV variants (EICAR is detected by the real daemon). Without them those variants are not
  generated, so CI sets both.
- The isolation suite is a **gate for everything after M1-TEN**: do not weaken or skip a case to get a
  change through. If the negative control stops failing the way it should, the harness has gone blind.
- Web: `pnpm --filter @assettracker/web test` (unit) and `pnpm --filter @assettracker/web test:e2e`
  (Playwright against the mock-API static export; needs `playwright install chromium` once).
- Web against the **real stack** (M1-WEB-11): `docker compose up -d --build`, `pnpm --filter @assettracker/web build`,
  then `pnpm --filter @assettracker/web test:e2e:real` (Playwright project `real`, `apps/web/e2e-real`). It serves
  `out/` with `/v1` proxied to the API, signs in as `owner@acme.example` (password + TOTP computed from the demo
  secret, see `support.ts`) and reads invitation mail from Mailpit. Names carry a per-run suffix, so it can run again
  on the same database; a rerun inside the same 30 s TOTP step waits for the next step (replay protection).
- Performance: `scripts/ci/perf-seed.sh` (2 x 50,000 assets in the demo tenants) then `scripts/ci/perf-check.mjs`
  (see `docs/engineering/ci.md` section 4).

### Mailpit

Mailpit catches every outgoing mail: UI http://localhost:8025, REST API http://localhost:8025/api/v1/messages.
Invitation and password-reset mails appear there while you develop; the e2e mail tests read them through
the same API. Clear it with `curl -X DELETE http://localhost:8025/api/v1/messages`. Mail is sent by the
**worker** (a job queued in the same transaction as the business change), so if nothing arrives check
`docker compose logs worker` first.

## 6. Resetting the database

```bash
docker compose down -v          # removes the pgdata and miniodata volumes: everything is recreated empty
docker compose up -d --build    # roles and extensions via docker/postgres/init, migrations, demo seed
```

Without deleting volumes, to start from an empty database but keep the containers:

```bash
MSYS_NO_PATHCONV=1 docker compose exec postgres psql -U postgres -d postgres -c "drop database app with (force)" \
  -c "create database app"
MSYS_NO_PATHCONV=1 docker compose exec -T postgres psql -U postgres -d app -v ON_ERROR_STOP=1 \
  -f /docker-entrypoint-initdb.d/01-roles.sql
docker compose run --rm migrate               # migrates and re-seeds the demo tenants
docker compose restart api worker scheduler    # they hold connections to the dropped database
```

Only the data plane, for working on the api outside Docker: `docker compose up -d postgres pgbouncer migrate`.
A database that was initialised by an older Postgres major (the `pgdata` volume layout changed in 18)
must be deleted with `down -v`, not reused.

## 7. Recipes

### Add a tenant table

Every table with tenant data is created in a migration through the conventions helpers; the schema lint
(runs in `migrate`, in CI and as `pnpm --filter @assettracker/api schema:lint`) fails the deploy if a
step is missing. See migration `0004_catalog.sql` for the pattern.

1. New file `apps/api/migrations/NNNN_name.sql` with the next free number (files are checksummed: never edit
   one that has been applied, add a new one).
2. `create table app.thing (id uuid primary key, tenant_id uuid not null references app.tenant (id), ...,
   created_at, updated_at, version integer not null default 1, unique (tenant_id, id))`. Ids are UUIDv7
   generated by the application, no database default. Foreign keys to other tenant tables are composite
   `(tenant_id, other_id)` so a row cannot point at another tenant (FK checks bypass RLS).
3. `select app.apply_tenant_conventions('app.thing');` (ENABLE + FORCE RLS, the `tenant_isolation` policy
   in the NULLIF form on `USING` and `WITH CHECK`, the version trigger, the DML grants for `app_user`).
   Or create the table with `app.create_tenant_table(...)`. Add at least one index that **leads with
   `tenant_id`**. Never grant on a partition, never `SECURITY DEFINER`, views use `security_invoker`.
4. A table that is deliberately not per tenant is classified `non-tenant` in the lint's classification
   list and needs a justification in review (the threat model lists the existing ones).
5. `docker compose run --rm migrate` (or `pnpm --filter @assettracker/api migrate`), then `schema:lint`, then
   `db:pull` and commit the regenerated `apps/api/prisma/schema.prisma` (CI fails on drift).
6. Add isolation cases for it in `apps/api/test/isolation` (two tenants with overlapping values, unset
   context gives 0 rows, a foreign `tenant_id` is refused with 42501).
7. **Expand/contract**: a migration must keep the previous release working. Adding tables, nullable columns
   and indexes is an *expand* and ships alone. Renaming or dropping a column, tightening a constraint or
   changing a type is a *contract*: first release writes both shapes and reads the new one, a later release
   removes the old one. Never rename in place, never drop in the same release that stops using it
   (`docs/03_system_architecture.md` 8.5, `docs/02_product_plan.md` 6.13). Long index builds use
   `-- migrate:no-transaction` with `CREATE INDEX CONCURRENTLY`.

### Add a route

1. Put it in the module that owns the data (`apps/api/src/<module>/`); other modules reach it through its
   `index.ts` facade only. ESLint enforces the boundaries (ADR 0003), and only `src/tenancy` and `src/db`
   may import the database client (ADR 0001).
2. Declare exactly one access rule on the handler: `@Public()`, `@Authenticated()`, `@SelfService()` or
   `@RequirePermission('resource:action')` (the permission must exist in the OpenAPI `x-permission` set).
   A route with no rule is denied and the `route-rules` unit test fails the build.
3. Do the work inside `TenancyService.withTenantTx({ tenantId }, fn)` (the auth guard sets the principal
   from the credential, never from a header, query or body), validate input with a zod schema through
   `ZodValidationPipe`, return problem+json errors through the platform helpers, use `listPage` for
   cursor pagination, ETag/`If-Match` for updates and `Idempotency-Key` for creates (ADR 0003).
4. Write audit rows and outbox events in the same transaction as the change (ADR 0004). Enqueue jobs
   with ids-only payloads, inside the transaction.
5. Update `docs/engineering/openapi.yaml` (and the generated client when it exists), add unit tests next to
   the code and e2e cases under `apps/api/test`, including a cross-tenant attempt.
6. Logs: use the injected pino logger; never log credentials. `tenant_id` goes into log fields and trace
   attributes, **never** into a metric label.

## 8. Troubleshooting

**Git Bash rewrites my Docker paths.** MSYS converts anything that looks like a Unix path in arguments
(`-v /var/run/docker.sock:...`, `docker exec ... /docker-entrypoint-initdb.d/x.sql`, `-w /repo`) into
`C:/Program Files/Git/...`. Prefix the command with `MSYS_NO_PATHCONV=1` (or `export` it for the session);
the scripts under `scripts/ci/` already do. The same switch also stops `/dev/null` being translated for
native Windows programs: do not pass `-o /dev/null` to `curl.exe` under it, redirect the output instead
(`> /dev/null`). Bind-mount sources must be Windows-style (`E:/path/...`) or relative.

**`pnpm: command not found`, or `pnpm -v` is not 12.21.0.** Corepack is not enabled (`corepack enable`; on
Windows from an elevated terminal, or with `--install-directory`), or an older global pnpm shadows the
Corepack shim (`where pnpm` / `which -a pnpm`; uninstall the global one: `npm rm -g pnpm`). If Corepack
reports `Cannot find matching keyid`, update it: `npm i -g corepack@latest`. Inside a directory with a
different `packageManager` Corepack will insist on that version, which is the intent.

**pnpm 12 refuses to install a package.** Two pnpm 12 defaults apply here (`pnpm-workspace.yaml`):
`minimumReleaseAge` rejects versions published in the last days (add a deliberately fresh pin to
`minimumReleaseAgeExclude` with a reason), and lifecycle scripts only run for packages listed in
`allowBuilds`. `ERR_PNPM_OUTDATED_LOCKFILE` means `pnpm-lock.yaml` was not updated with the change:
run `pnpm install` and commit it. Always pin exact versions (no `^`).

**Port already allocated / address already in use.** Something owns 5433, 6432, 3000 or 8025. Find it
(`netstat -ano | findstr :5433` on Windows, `lsof -i :5433` elsewhere) or change the host port in `.env`.
On Windows, Hyper-V and WSL can reserve ranges: `netsh interface ipv4 show excludedportrange protocol=tcp`.

**e2e: everything passes but nothing ran.** A variable is missing and the suites skipped (section 5). Use
`assert-no-skips.mjs`. **e2e: `password authentication failed`** on the pooled run: PgBouncer reads
`docker/pgbouncer/userlist.txt`; after changing a role password in the database update the file too.
**e2e: `role "app_owner" does not exist`**: the data directory was initialised before `01-roles.sql` existed
or the volume is from another project; `docker compose down -v` and start again.

**`/readyz` stays 503.** The body says why: `db` (Postgres or PgBouncer not reachable, wrong
`DATABASE_URL`) or `migrations` with the list of pending ones (the `migrate` service failed or did not run:
`docker compose logs migrate`). The api starts before migrations finish on purpose; readiness is the gate.

**Prisma client missing (`Cannot find module .../generated/prisma`).** It is generated and gitignored:
`pnpm --filter @assettracker/api db:generate` (the `build`, `test` and `typecheck` scripts do it for you).

**MinIO image.** `minio/minio` is no longer published on Docker Hub; compose uses `chainguard/minio` and
`MINIO_IMAGE` overrides it.

**Docker out of space or slow builds.** `docker builder prune`; the Dockerfile uses a BuildKit cache mount
for the pnpm store, so keep BuildKit on (the default).
