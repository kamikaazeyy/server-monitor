#!/bin/sh
# test-compatibility-matrix.sh — smoke-test the dashboard across distros.
#
# For each target image it: installs Node via the distro's package manager,
# copies the repo in, npm-ci's (production deps only; client/dist must be
# built first — run `cd client && npm ci && npm run build` on the host),
# starts the server, and asserts /health + /api/auth/status respond.
#
#   sh scripts/test-compatibility-matrix.sh            # all targets
#   sh scripts/test-compatibility-matrix.sh alpine     # single target
#
set -u

REPO_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")/.." && pwd)
PORT=3100
FAILED=""

require() { command -v "$1" >/dev/null 2>&1 || { echo "missing required tool: $1" >&2; exit 1; }; }
require docker

[ -f "$REPO_DIR/client/dist/index.html" ] || {
  echo "client/dist missing — run: cd client && npm ci && npm run build" >&2
  exit 1
}

# In-container bootstrap, parameterized per distro.
BOOT_DEBIAN='apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq nodejs npm curl >/dev/null'
BOOT_RHEL='(dnf install -y -q nodejs npm curl 2>/dev/null || yum install -y -q nodejs npm curl) >/dev/null'
BOOT_ALPINE='apk add --no-cache nodejs npm curl >/dev/null'

BOOT_SCRIPT='
set -e
%s
cp -a /src /app
cd /app
npm ci --omit=dev --no-audit --no-fund >/dev/null 2>&1 || npm install --omit=dev --no-audit --no-fund >/dev/null
TERMINAL_ALLOW_ROOT=true HOST=0.0.0.0 PORT=%s nohup node index.js >/tmp/monitor.log 2>&1 &
for i in $(seq 1 30); do
  sleep 1
  if curl -fsS -o /dev/null http://127.0.0.1:%s/health 2>/dev/null; then break; fi
done
echo "-- health --"
curl -fsS -o /dev/null -w "HTTP %%{http_code}\n" http://127.0.0.1:%s/health
echo "-- auth status --"
curl -fsS http://127.0.0.1:%s/api/auth/status | head -c 200; echo
echo "-- unauth guard --"
curl -s -o /dev/null -w "HTTP %%{http_code}\n" http://127.0.0.1:%s/api/monitor/overview
'

run_target() {
  name="$1"; image="$2"; boot="$3"
  echo "=== $name ($image) ==="
  # repo is mounted read-only at /src and copied to a writable /app so
  # npm can write node_modules without polluting the host checkout
  out=$(docker run --rm \
    -v "$REPO_DIR:/src:ro" \
    "$image" sh -c "$(printf "$BOOT_SCRIPT" "$boot" "$PORT" "$PORT" "$PORT" "$PORT" "$PORT")" 2>&1)
  status=$?
  echo "$out" | sed 's/^/  /'
  if [ $status -ne 0 ]; then
    FAILED="$FAILED $name(docker-exit-$status)"
  elif echo "$out" | grep -q 'HTTP 200' && echo "$out" | grep -q 'needsSetup' && echo "$out" | grep -q 'HTTP 401'; then
    echo "  PASS"
  else
    FAILED="$FAILED $name(assert)"
    echo "  FAIL"
  fi
}

TARGETS="${*:-ubuntu2204 ubuntu2404 debian12 rocky9 alma9 alpine}"
for t in $TARGETS; do
  case "$t" in
    ubuntu2204) run_target ubuntu-22.04 ubuntu:22.04    "$BOOT_DEBIAN" ;;
    ubuntu2404) run_target ubuntu-24.04 ubuntu:24.04    "$BOOT_DEBIAN" ;;
    debian12)   run_target debian-12    debian:12-slim  "$BOOT_DEBIAN" ;;
    rocky9)     run_target rocky-9      rockylinux:9    "$BOOT_RHEL" ;;
    alma9)      run_target alma-9       almalinux:9     "$BOOT_RHEL" ;;
    alpine)     run_target alpine       alpine:latest   "$BOOT_ALPINE" ;;
    *) echo "unknown target: $t" >&2 ;;
  esac
done

echo
if [ -n "$FAILED" ]; then
  echo "FAILED targets:$FAILED"
  exit 1
fi
echo "All targets passed."
