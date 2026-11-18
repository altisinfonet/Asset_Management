#!/usr/bin/env bash
# Compose smoke test (M1-CI-04): bring the stack up, wait for /readyz, hit /v1/health (and check that
# the internal ops port is NOT published), tear everything down. Works on Linux, macOS and Git Bash.
#
#   scripts/ci/compose-smoke.sh                 # builds the api image (once) if it is missing, then runs
#   COMPOSE_PROJECT=atw3c API_PORT=3130 scripts/ci/compose-smoke.sh
#   KEEP_STACK=1 scripts/ci/compose-smoke.sh    # leave the stack running (used by the perf job)
#
# Environment (all optional):
#   COMPOSE_PROJECT   compose project name                 (default: atsmoke)
#   API_IMAGE         image tag shared by all roles        (default: assettracker-api:ci)
#   BUILD_IMAGE       1 = always build, 0 = never, auto = build only if the tag is missing (default: auto)
#   READY_TIMEOUT     seconds to wait for /readyz           (default: 180)
#   KEEP_STACK        1 = do not tear down on success       (default: 0; always torn down on failure)
#   API_PORT POSTGRES_PORT PGBOUNCER_PORT MAILPIT_SMTP_PORT MAILPIT_UI_PORT MINIO_PORT MINIO_CONSOLE_PORT
#                     host ports (same variables as docker-compose.yml)
set -euo pipefail

# Git Bash on Windows rewrites paths in docker arguments; harmless elsewhere.
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/../.."
PROJECT="${COMPOSE_PROJECT:-atsmoke}"
export API_IMAGE="${API_IMAGE:-assettracker-api:ci}"
export API_PORT="${API_PORT:-3000}"
READY_TIMEOUT="${READY_TIMEOUT:-180}"
BUILD_IMAGE="${BUILD_IMAGE:-auto}"
KEEP_STACK="${KEEP_STACK:-0}"
BASE_URL="http://127.0.0.1:${API_PORT}"

# HTTP status code of a GET (no `-o /dev/null`: under MSYS_NO_PATHCONV a Windows curl would try to write a file called \dev\null).
http_code() { curl -s --max-time 5 -w '\n%{http_code}' "$1" | tail -n1; }
compose() { docker compose -f docker-compose.yml -f docker/compose.ci.yml -p "$PROJECT" "$@"; }

log() { printf '[smoke] %s\n' "$*"; }
fail() { printf '[smoke] FAIL: %s\n' "$*" >&2; exit 1; }

dump_and_teardown() {
  local rc=$?
  if [ "$rc" -ne 0 ]; then
    log "failed (exit $rc); service status and recent logs follow"
    compose ps -a || true
    compose logs --no-color --tail=60 || true
  fi
  if [ "$rc" -ne 0 ] || [ "$KEEP_STACK" != "1" ]; then
    log "tearing down (project $PROJECT)"
    compose down -v --remove-orphans >/dev/null 2>&1 || true
  fi
  exit "$rc"
}
trap dump_and_teardown EXIT

# 1. Build the api image once (all four roles share it).
if [ "$BUILD_IMAGE" = "1" ] || { [ "$BUILD_IMAGE" = "auto" ] && ! docker image inspect "$API_IMAGE" >/dev/null 2>&1; }; then
  log "building $API_IMAGE (runtime target)"
  docker build -f apps/api/Dockerfile --target runtime --build-arg "GIT_SHA=${GIT_SHA:-ci}" -t "$API_IMAGE" .
else
  log "using existing image $API_IMAGE"
fi

# 2. Config is valid, then up (dummy dev credentials, demo seed on).
compose config -q
log "starting stack (project $PROJECT, api on $BASE_URL)"
compose up -d

# 3. Wait for /readyz (database reachable and every migration applied).
log "waiting for $BASE_URL/readyz (timeout ${READY_TIMEOUT}s)"
deadline=$(( $(date +%s) + READY_TIMEOUT ))
until curl -fsS --max-time 3 "$BASE_URL/readyz" >/dev/null 2>&1; do
  [ "$(date +%s)" -lt "$deadline" ] || fail "/readyz did not become ready within ${READY_TIMEOUT}s"
  # A failed one-shot migrate is terminal: stop waiting early.
  state="$(compose ps -a --format '{{.Service}} {{.State}} {{.ExitCode}}' migrate 2>/dev/null || true)"
  case "$state" in "migrate exited "[1-9]*) fail "migrate exited non-zero: $state" ;; esac
  sleep 2
done
log "/readyz: $(curl -fsS "$BASE_URL/readyz")"

# 4. Public API checks.
health="$(curl -fsS "$BASE_URL/v1/health")" || fail "GET /v1/health failed"
log "/v1/health: $health"
case "$health" in *'"status":"ok"'*) ;; *) fail "unexpected /v1/health body" ;; esac
curl -fsS "$BASE_URL/healthz" >/dev/null || fail "GET /healthz failed"
# An unauthenticated call to a protected route is refused (auth guard is on).
code="$(http_code "$BASE_URL/v1/auth/me")"
[ "$code" = "401" ] || fail "GET /v1/auth/me without a session returned $code, expected 401"
log "auth guard: unauthenticated /v1/auth/me -> 401"

# 5. M1-OPS-01: /metrics must stay on the internal ops port and not be published or served publicly.
code="$(http_code "$BASE_URL/metrics")"
case "$code" in 404|401|403) log "public listener does not serve /metrics ($code)" ;; *) fail "/metrics answered $code on the public API port" ;; esac
for role in api worker scheduler; do
  if compose port "$role" 9464 2>/dev/null | grep -q .; then fail "ops port 9464 is published by the $role service"; fi
done
log "ops port 9464 is not published (api, worker, scheduler)"

# 6. Background roles are healthy (their ops server answers /healthz inside the network).
for role in worker scheduler; do
  deadline=$(( $(date +%s) + 90 ))
  until [ "$(compose ps --format '{{.Health}}' "$role" 2>/dev/null)" = "healthy" ]; do
    [ "$(date +%s)" -lt "$deadline" ] || fail "$role did not become healthy"
    sleep 2
  done
  log "$role: healthy"
done

log "PASS"
