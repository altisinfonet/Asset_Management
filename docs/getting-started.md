# Getting started: run, rebuild and test Asset Tracker

A practical guide to starting the whole stack on your machine, rebuilding after changes, and
running the checks. For deeper reference (environment variables, recipes, every e2e mode) see
[engineering/developer-guide.md](engineering/developer-guide.md).

## 1. One-time setup

| Need           | Version                     | Notes                                                                          |
| -------------- | --------------------------- | ------------------------------------------------------------------------------ |
| Node.js        | 24 (minimum 22.13)          | `node --version`                                                               |
| pnpm           | 12                          | `corepack enable` then `corepack prepare pnpm@latest --activate`               |
| Docker Desktop | 24+ with Compose v2         | **Docker Desktop must be running** before any `docker compose` command         |
| Shell          | Git Bash or PowerShell      | Both work; see Troubleshooting for a Git Bash quirk                            |
| Chrome         | any recent                  | Only for the browser test suites                                               |

```bash
cd E:\Sayak\asset_tracker
pnpm install
cp .env.example .env        # optional; only needed to change ports or settings
```

## 2. What runs where

| Part                                      | What it is                                                       | Runs in                         |
| ----------------------------------------- | ---------------------------------------------------------------- | ------------------------------- |
| **api** (3000)                            | NestJS backend                                                   | Docker                          |
| **worker**                                | Background jobs (sending email, outbox delivery)                 | Docker, same image as api       |
| **scheduler**                             | Timed jobs and database maintenance                              | Docker, same image as api       |
| **migrate**                               | Applies database migrations and seeds demo data, then exits      | Docker, runs automatically      |
| **postgres** (5433) / **pgbouncer** (6432) | Database and connection pooler                                   | Docker                          |
| **mailpit** (8025)                        | Catches every email the app sends; view it in the browser        | Docker                          |
| **minio** (9000 / 9001)                   | S3-compatible file storage                                       | Docker                          |
| **clamav** (3310)                         | Virus scanner (clamd) for uploaded files; first start downloads its signatures (a minute or two) | Docker |
| **web** (3001)                            | Next.js website (static export)                                  | Your machine, or Docker (4b)    |

## 3. Start everything (the normal way)

```bash
# 1. Backend, database, email catcher
docker compose up -d --build

# 2. Wait until it is ready (repeat until it says "status":"ready")
curl http://localhost:3000/readyz

# 3. Build the website (always via turbo, so shared packages are rebuilt first)
pnpm turbo run build --filter=@assettracker/web

# 4. Serve the website and forward /v1 API calls to the backend
node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000
```

Open **http://localhost:3001**. Every demo user's password is `Demo-Passw0rd-2026`.

| User                      | Role                                     | Sign-in                                                                                 |
| ------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------- |
| `owner@acme.example`      | Administrator                            | Password + authenticator code. Setup key: `JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP`            |
| `admin@acme.example`      | Asset manager                            | Password only                                                                           |
| `technician@acme.example` | Technician                               | Password only                                                                           |
| `viewer@acme.example`     | Viewer (read-only)                       | Password only                                                                           |
| `…@globex.example`        | Same users in a second organisation      | Use it to check that one organisation cannot see another's data                         |

Emails (invitations, password resets) appear at **http://localhost:8025**.

## 4. Three ways to run the website

| Mode                                   | Command                                                                                     | Use it for                                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| **a. Production build** (section 3)    | `pnpm turbo run build --filter=@assettracker/web`, then `node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000` | Testing exactly what ships. Rebuild after every change.                                      |
| **b. Dev server, hot reload**          | `pnpm --filter @assettracker/web dev` (or `docker compose --profile web up -d`)             | Day-to-day frontend work. Changes appear instantly; `/v1` is proxied to `localhost:3000`.    |
| **c. Mock mode, no backend needed**    | `pnpm --filter @assettracker/web dev:mock`                                                  | UI work with Docker stopped. Uses a built-in fake API with sample data.                      |

Mock mode has its own accounts: password `correct horse battery staple`, authenticator code always
`123456`; the account list is in `apps/web/src/mocks/fixtures.ts`.

## 5. Rebuilding after changes

| What changed                                       | What to run                                                                                                        |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **Backend code** (`apps/api/src`)                  | `docker compose up -d --build` (rebuilds the image, restarts api, worker and scheduler)                            |
| **New database migration** (`apps/api/migrations`) | `docker compose up -d --build` applies it automatically, or `docker compose run --rm migrate`                      |
| **Website code**                                   | Dev mode (4b): nothing, it reloads. Production build: rerun `pnpm turbo run build --filter=@assettracker/web`, stop the running server (Ctrl+C) and start it again with `node apps/web/scripts/serve-static.mjs apps/web/out --port=3001 --proxy=http://localhost:3000` |
| **API contract** (`docs/engineering/openapi.yaml`) | `pnpm --filter @assettracker/api-client generate`, then rebuild the website                                        |
| **After `git pull`**                               | `pnpm install` → `docker compose up -d --build` → `pnpm turbo run build --filter=@assettracker/web`                |
| **Want fresh demo data**                           | `docker compose down -v` then `docker compose up -d --build` (**wipes your local database**)                       |

## 6. Everyday Docker commands

```bash
docker compose ps                     # what is running and whether it is healthy
docker compose logs -f api worker     # follow logs
docker compose stop                   # stop, keep data
docker compose down                   # remove containers, keep data
docker compose down -v                # remove everything including the database
```

## 7. Checks and tests

```bash
pnpm format:check                                  # formatting
pnpm turbo run lint typecheck test build           # everything the CI "check" job runs
pnpm format                                        # auto-fix formatting
```

| Suite                              | Command                                                              | Needs                                  |
| ---------------------------------- | -------------------------------------------------------------------- | -------------------------------------- |
| Website against the fake API       | `PW_CHANNEL=chrome pnpm --filter @assettracker/web test:e2e`         | Chrome                                 |
| Website against the real backend   | `PW_CHANNEL=chrome pnpm --filter @assettracker/web test:e2e:real`    | `docker compose up` running            |
| Backend end-to-end (direct/pooled) | see [developer guide §5](engineering/developer-guide.md) for the env | `docker compose up` running            |

The backend end-to-end suite runs at most six test files at a time (`apps/api/vitest.e2e.config.ts`, override with
`E2E_MAX_WORKERS`): every file is a database client, and the dev stack (PgBouncer pool of 16, Postgres
`max_connections=300`) is sized for that. After pulling a change of `docker/pgbouncer/pgbouncer.ini` or the Postgres
settings, recreate the containers: `docker compose up -d` and `docker compose restart pgbouncer`.

## 8. Ports

| Port | Service                                                                            |
| ---- | ---------------------------------------------------------------------------------- |
| 3000 | API (`/v1/health`, `/readyz`, `/v1/openapi.json`)                                  |
| 3001 | Website                                                                            |
| 5433 | Postgres, direct (not 5432, which is often taken)                                  |
| 6432 | PgBouncer                                                                          |
| 8025 | Mailpit (emails); SMTP on 1025                                                     |
| 9001 | MinIO console (`minioadmin` / `minioadmin-dev`); S3 API on 9000                    |
| 3310 | ClamAV daemon (clamd), published on localhost only                                 |

Change any of them in `.env`: `API_PORT`, `WEB_PORT`, `POSTGRES_PORT`, `PGBOUNCER_PORT`,
`MAILPIT_SMTP_PORT`, `MAILPIT_UI_PORT`, `MINIO_PORT`, `MINIO_CONSOLE_PORT`, `CLAMD_PORT`.

Uploaded files (attachments, photos) go to MinIO and are scanned by ClamAV before anyone can download
them: a new upload shows `scan_status: pending` until the `worker` has scanned it (a few seconds once
ClamAV is `healthy`; `docker compose ps` shows it). To develop without ClamAV, stop it and set
`SCAN_REQUIRED=false` for the api and worker: uploads are then marked clean without a scan and a
`attachment.scan_skipped` audit row records it. Design: [ADR 0006](adr/0006-files-scanning-and-thumbnails.md).

The browser uploads straight to MinIO with a presigned URL, so the S3 endpoint the api signs for
(`S3_PUBLIC_ENDPOINT`, `http://localhost:${MINIO_PORT}`) must be reachable from your browser: if you change
`MINIO_PORT` in `.env`, the compose file follows it. The **first ClamAV start downloads the signature
database and can take several minutes** (it needs internet and 1-2 GB of RAM); uploads wait as `pending`
until it is `healthy`. The signatures live in the `clamdata` volume, so later starts are fast.

### What is new in the website (M2 wave 2)

| Page (signed in as the demo `admin@acme.example`)   | What to try                                                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Assets** > select rows > **Print labels**            | Pick a sheet template, start the batch: it renders in the background (worker); the dialog polls and offers the PDF when it is ready. A notification arrives too. |
| **Stock** (`/stock`)                                    | Accessories (check out several units, return some) and consumables (receive, issue, adjust with a note). Issue below the minimum: the stock managers get a "Low stock" notification. |
| **Repairs** (`/repairs`)                                | Open a repair on an asset (its status changes, "restore" on completion), complete it with a cost.    |
| **Bell** in the header, **Account > Notifications**    | The in-app list, mark read, and per type choose in-app and email (immediate, daily digest, off). **Settings > Notifications** (administrators) turns types off or re-addresses them to other roles. |
| **Assets** > **Views**, **Export**                     | Save the current filters as a personal view and share it with the organisation (needs `view:share`); export the list as CSV (needs `export:run`), the file is ready after a few seconds and removed after 24 hours. |
| **Account > Security**                                 | Shows whether the organisation policy requires two-step verification for you.                        |

**Notification emails** are caught by Mailpit like every other mail: open http://localhost:8025 (port
`MAILPIT_UI_PORT`). Immediate notifications arrive as soon as the worker has processed the event (a second or two);
digest mails are sent once a day by the scheduler. If nothing arrives, check `docker compose logs worker`: the
outbox relay (events to notifications) and the `label.render` / `export.run` jobs run in the worker role.

## 9. Troubleshooting

| Symptom                                                                                | Fix                                                                                              |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Website build fails with "Export … doesn't exist" or "Can't resolve @assettracker/…"   | You built only the website. Use `pnpm turbo run build --filter=@assettracker/web`.               |
| `docker compose` says it cannot connect                                                | Start Docker Desktop.                                                                            |
| `/readyz` is not 200                                                                   | `docker compose logs migrate api` and look for a failed migration.                               |
| Build fails mentioning `mockServiceWorker.js`                                          | Delete `apps/web/public/mockServiceWorker.js` (left behind when mock mode is force-killed).      |
| A port is already in use                                                               | Change it in `.env` (see section 8).                                                             |
| Authenticator code rejected                                                            | Each code works once; wait about 30 seconds for the next one.                                    |
| Account locked after wrong passwords                                                   | Wait for the time shown, or reset with `docker compose down -v`.                                 |
| Git Bash mangles paths in `docker exec` / `docker cp`                                  | Prefix the command with `MSYS_NO_PATHCONV=1`.                                                    |
| An upload stays `pending`                                                              | ClamAV is still downloading signatures or is down: `docker compose ps clamav`, `logs clamav worker`. |
