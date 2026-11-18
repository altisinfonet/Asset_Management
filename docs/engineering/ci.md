# CI, security scanning and performance budgets

Stories: M1-CI-01 to M1-CI-05, M1-OPS-01 (the `/metrics` check). Gates are cumulative: once a gate is
a required check on `main`, it stays one (`docs/05_backlog.md` 9.3).

## 1. Workflows

| File                              | Triggers                                              | Jobs                                                                                                   |
| --------------------------------- | ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `.github/workflows/ci.yml`        | PR, push to `main`, weekly (Mon 04:17 UTC), manual    | `check`, `web-e2e` (mock API, optional), `api-e2e` (Postgres 16 and 18), `image`, `compose-smoke`, `web-e2e-real`, `image-scan`, `publish` (main only), `ci-gate` |
| `.github/workflows/security.yml`  | PR, push to `main`, daily (03:41 UTC), manual         | `dependency-audit`, `secret-scan`                                                                      |
| `.github/workflows/codeql.yml`    | PR, push to `main`, weekly (Wed), manual              | CodeQL for `javascript-typescript` and `actions`                                                       |
| `.github/workflows/perf.yml`      | nightly (01:30 UTC), manual                           | `perf` (performance budgets)                                                                           |
| `.github/actions/setup`           | composite action                                      | Node from `.nvmrc`, pnpm via corepack, cached pnpm store, `pnpm install --frozen-lockfile`            |
| `.github/dependabot.yml`          | weekly                                                | grouped updates for npm (pnpm workspace), GitHub Actions, Dockerfiles and compose images                |

Concurrency: a new push to a PR cancels the superseded run of that PR; pushes to `main` and scheduled
runs are never cancelled. Caching: the pnpm store (key = lockfile hash), the Turborepo cache `.turbo`
(key = commit, restore by prefix), the Docker layer cache (`type=gha`) and the Trivy database (daily key).

### What each job proves

| Job (check name)                                       | Proves                                                                                                                                                                                  |
| ------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Lint, typecheck, test, build`                         | Prettier, ESLint (including the module-boundary and database-client import rules), typecheck, unit tests, build of every package, web static export without forbidden features (ADR 0002) |
| `API e2e + tenant isolation (Postgres 16)` and `(... 18)` | Migrations apply twice (second is a no-op), schema lint and role audit, Prisma `schema.prisma` has not drifted (Postgres 18), the isolation and e2e suites pass DIRECT and THROUGH PgBouncer 1.26.1 (with the negative control), with every environment variable set so that **no test is skipped** (`scripts/ci/assert-no-skips.mjs`), against Mailpit for the mail path; the bootstrap CLI and seed are idempotent |
| `Image build (api runtime)`                            | The runtime image builds from the monorepo root, once; the same image is used by the next three jobs                                                                                   |
| `Compose smoke`                                        | `docker compose up` with the image, `/readyz` becomes ready (database reachable, every migration applied), `GET /v1/health` is ok, unauthenticated `/v1/auth/me` is 401, the seeded demo Viewer signs in and reads `/v1/assets` (one authenticated call), `/metrics` is not served publicly and ops port 9464 is not published, worker and scheduler become healthy, `down -v` |
| `Web e2e (real stack)`                                 | The production static export against the compose stack of the same image (`/v1` proxied to the API): sign in with password and TOTP, category + custom field + model, asset with a generated tag, edit and a 412, list filter, bulk edit / archive / restore, palette search, tag numbering template, 409 with usage counts, the other tenant gets 404, invitation mail in Mailpit, sign out. Playwright project `real`, `apps/web/e2e-real/`; traces are uploaded on failure |
| `Image scan (Trivy) and SBOM`                          | No fixable HIGH or CRITICAL vulnerability in the runtime image (Debian packages and Node packages) with no exceptions (the bundled npm is removed from the image); the CycloneDX SBOM is stored as an artifact (90 days) |
| `Publish image to GHCR (main only)`                    | On merge to `main`, pushes `ghcr.io/<owner>/<repo>/api:<sha>` and `:main` after everything above passed                                                                               |
| `CI gate`                                              | All of the above succeeded (one stable name for branch protection) and reports the total pipeline time (target: under 15 minutes; a warning above that)                                |
| `Dependency audit`                                     | `pnpm audit --prod` is clean (no exceptions for what ships); `scripts/ci/audit.mjs` finds no unlisted high or critical advisory and no expired exception                                |
| `Secret scan (gitleaks)`                               | No secret in the PR's commits (or the whole history on `main`) and none in the working tree                                                                                             |
| `CodeQL (javascript-typescript)` / `CodeQL (actions)`  | CodeQL `security-extended` queries find nothing new on the code and on the workflow files                                                                                               |
| `Performance budgets` (nightly, not a PR check)        | `/v1/health` p95 within budget; asset list, search and tag lookup within budget once the registry exists (section 4)                                                                    |

## 2. Required status checks (branch protection on `main`)

Branch protection is the founder's one-time action (backlog F-01). Settings, Branches, rule for `main`:
require a pull request, require status checks to pass and the branch to be up to date, require
review from Code Owners (after replacing `@OWNER` in `.github/CODEOWNERS`), no force pushes, no deletions.

Add these as **required** status checks (names are the job names above):

1. `CI gate`
2. `Dependency audit`
3. `Secret scan (gitleaks)`
4. `CodeQL (javascript-typescript)` and `CodeQL (actions)` (leave out if code scanning is not available, see section 3)

`CI gate` aggregates the matrix and the image jobs, so Postgres 16 and 18 and the smoke test are
enforced through it. If you prefer to see each one in the required list, also add
`Lint, typecheck, test, build`, `API e2e + tenant isolation (Postgres 16)`, `API e2e + tenant isolation (Postgres 18)`,
`Compose smoke`, `Web e2e (real stack)` and `Image scan (Trivy) and SBOM`. `Web routing e2e (mock API, optional)` is
deliberately not required: it only checks deep links and refresh on the mock; the real-stack suite is the gate. A check name only appears in the
picker after it has run once, so open a first PR before configuring the rule.

## 3. Security scanning (M1-CI-03)

| Control                       | Tool                              | Gate                                                    | Exceptions                                                        |
| ----------------------------- | --------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| SCA                           | `pnpm audit` via `scripts/ci/audit.mjs` | high and critical fail; production deps never excepted | `.github/security/audit-allowlist.json`                           |
| Secret scanning               | gitleaks 8.30.1 (docker)          | any finding fails                                       | `.gitleaks.toml` (documented allow-list) and `.gitleaks-baseline.json` |
| Image vulnerabilities         | Trivy 0.76.2 (docker)             | fixable HIGH and CRITICAL fail (`--ignore-unfixed`)     | `.github/security/trivy-ignore.yaml` (empty: none needed today)   |
| SBOM                          | Trivy, CycloneDX 1.7              | n/a (artifact `sbom-api-image-cyclonedx`, 90 days)      | n/a                                                               |
| SAST                          | CodeQL, `security-extended`       | new alerts fail the PR check                            | dismiss in the Security tab with a reason                         |
| Dependency and Action updates | Dependabot                        | n/a (PRs, grouped weekly)                               | n/a                                                               |

**Exceptions expire.** Every allow-list entry carries a reason and an expiry date at most 90 days out.
`scripts/ci/audit.mjs` fails on an expired entry or one that no longer matches anything to remove; Trivy
stops honouring an entry after its `expired_at`; gitleaks entries are narrow (path plus pattern) and
reviewed through CODEOWNERS. A critical advisory in production dependencies cannot be allow-listed.

Secret scanning locally (history from a checkout, then the working tree):

```bash
# history of the current checkout (mount the repo, scan commits), then files on disk
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 detect --source /repo \
  --config /repo/.gitleaks.toml --baseline-path /repo/.gitleaks-baseline.json --redact
docker run --rm -v "$PWD:/repo" -w /repo zricethezav/gitleaks:v8.30.1 detect --no-git --source /repo \
  --config /repo/.gitleaks.toml --redact
```

The allow-list covers: `spikes/` (throwaway test passwords), `docker/secrets/master_key.dev` (the dummy
dev master key), one fake idempotency key in a unit test and one prose false positive in the backlog.
In a Git worktree the container cannot follow the `.git` file; scan from the main checkout, or use only
the `--no-git` form (and keep `node_modules` out of the scan root).

Image scan locally (Docker on Git Bash needs `MSYS_NO_PATHCONV=1`):

```bash
docker build -f apps/api/Dockerfile --target runtime -t assettracker-api:ci .
docker save assettracker-api:ci -o api-image.tar
docker run --rm -v "$PWD:/work:ro" -v "$PWD/.github/security:/sec:ro" -v trivy-cache:/root/.cache aquasec/trivy:0.76.2 \
  image --input /work/api-image.tar --severity HIGH,CRITICAL --ignore-unfixed --ignorefile /sec/trivy-ignore.yaml --exit-code 1
```

Dependency audit locally: `node scripts/ci/audit.mjs` (exit 0 clean, 1 findings, 2 registry not reachable).

CodeQL on a **private** repository needs GitHub Advanced Security. If it is not available, set the
repository variable `CODEQL_DISABLED=true` (the job is skipped instead of failing) and drop the two
CodeQL names from the required checks until it is.

Pins: the workflow actions use major tags (`actions/checkout@v4`, ...) and Dependabot bumps them. Pinning
every action to a commit SHA is the stricter option and a good follow-up once the repository exists
(Dependabot can maintain SHA pins with the version in a comment).

## 4. Performance budgets (M1-CI-05)

`.github/workflows/perf.yml` runs nightly. It builds the image, brings the Compose stack up with
`scripts/ci/compose-smoke.sh` (`KEEP_STACK=1`), seeds, runs `scripts/ci/perf-check.mjs` and uploads
`perf-results.json` (90 days, one per night = the trend) plus a summary table. The script is
dependency-free (Node 22+, global `fetch`): `PERF_CONNECTIONS` (default 10) concurrent connections for
`PERF_DURATION` (default 10) seconds per endpoint after a warm-up, p50/p95/p99, error rate. Budgets live in
`scripts/ci/perf-budgets.json`.

| Endpoint                          | Budget (p95, server side)  | Source                         | State today                                                             |
| --------------------------------- | -------------------------- | ------------------------------ | ----------------------------------------------------------------------- |
| `GET /v1/health`                  | < 100 ms                   | proposed by this repo          | enforced                                                                |
| `GET /v1/assets` (list)           | < 500 ms                   | backlog 9.3, plan P9           | enforced (2 x 50,000 assets); p95 61 ms measured locally on 2026-11-18  |
| `GET /v1/assets?q=` (search)      | < 200 ms                   | backlog 9.3                    | enforced; p95 89 ms measured locally                                    |
| `GET /v1/assets?tag=` (tag lookup)| < 150 ms                   | backlog 9.3                    | enforced; p95 56 ms measured locally                                    |

Later budgets from the backlog (check-out < 300 ms, import throughput and dry run) are added by M2-OPS-01.
The backlog measures on **two tenants of 50,000 assets each**: `scripts/ci/perf-seed.sh` inserts them (one
`INSERT .. SELECT generate_series` per demo tenant, idempotent, then `VACUUM ANALYZE`) and the workflow
sets `PERF_REQUIRE_REGISTRY=1` by default, so a registry endpoint that cannot be measured fails the night
instead of being skipped (set the repository variable `PERF_REQUIRE_REGISTRY=0` to skip them). On a slow
laptop use `PERF_BUDGET_SCALE=2`; never in CI.

Local run:

```bash
COMPOSE_PROJECT=atperf KEEP_STACK=1 scripts/ci/compose-smoke.sh
COMPOSE_PROJECT=atperf scripts/ci/perf-seed.sh                       # 2 x 50,000 (PERF_ASSETS=2000 for a quick run)
PERF_REQUIRE_REGISTRY=1 PERF_BASE_URL=http://127.0.0.1:3000 node scripts/ci/perf-check.mjs
docker compose -f docker-compose.yml -f docker/compose.ci.yml -p atperf down -v
```

## 5. Compose smoke test (M1-CI-04)

`scripts/ci/compose-smoke.sh` is the same script CI runs. It builds the api image once if missing
(`BUILD_IMAGE=auto`), starts `docker-compose.yml` plus `docker/compose.ci.yml` (which points every role at
the one prebuilt image and removes the `build:` sections), waits for `/readyz`, checks the public API and
the ops port, waits for worker and scheduler to be healthy and tears the stack down (also on failure, after
printing service status and the last log lines). Host ports follow the same variables as compose
(`API_PORT`, `POSTGRES_PORT`, ...), so it can run next to another stack:

```bash
COMPOSE_PROJECT=smoke2 API_PORT=3130 POSTGRES_PORT=5533 PGBOUNCER_PORT=6532 MAILPIT_SMTP_PORT=1125 \
  MAILPIT_UI_PORT=8125 MINIO_PORT=9100 MINIO_CONSOLE_PORT=9101 scripts/ci/compose-smoke.sh
```

The backlog also asks for "one authenticated API call". The smoke test proves the auth guard (an
unauthenticated call is 401); the authenticated call arrives with the Compose Playwright suite
(M1-WEB-11), and the perf job already logs in as the demo viewer.

`/metrics` (M1-OPS-01): the Prometheus endpoint is served only by the internal ops server (`OPS_PORT`
9464, `OPS_HOST` 0.0.0.0 inside the container). Compose does not publish it for any role and the smoke test
fails if it is published or if the public listener serves `/metrics`. Scrape it from inside the Compose
network or a sidecar.

## 6. What cannot be verified before the repository is on GitHub

Everything in the workflows was linted with `actionlint` and each command was run locally, but these only
run on GitHub: the `services:` containers and the runner's host-gateway PgBouncer wiring, `actions/cache`
and `type=gha` Docker caching, artifact hand-over between jobs, GHCR login and push, CodeQL (and whether the
plan includes it), Dependabot parsing of the config (check Insights, Dependency graph, Dependabot after the
first push), the gitleaks pull-request range scan, branch protection and CODEOWNERS (needs `@OWNER`
replaced), the real pipeline time against the 15 minute target, and the Trivy database download (GitHub
runners share rate limits on `mirror.gcr.io`; the daily cache key keeps it to one pull a day).
