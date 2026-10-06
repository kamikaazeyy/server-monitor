#!/bin/bash
# Runs ON the target server during CI deploys (see .github/workflows/deploy.yml).
# Extracts the bundle into a staging dir first so a bad artifact cannot gut
# the live deployment, then swaps it in, restarts the service, and verifies
# it is actually serving requests.
set -euo pipefail

DEPLOY_DIR=/opt/monitoring-dashboard
WORK_DIR=/tmp/monitor-deploy
BUNDLE="$WORK_DIR/deploy-bundle.tar.gz"
EXTRACT_DIR="$WORK_DIR/extract"

# Back up server-local state before touching the deploy dir.
cp "$DEPLOY_DIR/.env" "$WORK_DIR/.env.bak" 2>/dev/null || true
cp "$DEPLOY_DIR/.auth.json" "$WORK_DIR/.auth.json.bak" 2>/dev/null || true
cp "$DEPLOY_DIR/.envstore.key" "$WORK_DIR/.envstore.key.bak" 2>/dev/null || true

# Extract into staging first — if the artifact is bad, the live dir stays intact.
rm -rf "$EXTRACT_DIR"
mkdir -p "$EXTRACT_DIR"
tar xzf "$BUNDLE" -C "$EXTRACT_DIR"

# Clear the deploy dir. Leftover root-owned files (e.g. from on-server builds
# run as root) defeat a plain rm, so prefer the sudoers-scoped helper when the
# server has been provisioned with it.
if ! sudo -n /usr/local/bin/monitoring-dashboard-clean.sh 2>/dev/null; then
  rm -rf "$DEPLOY_DIR"/*
fi

cp -a "$EXTRACT_DIR/." "$DEPLOY_DIR/"

# Restore server-local state.
cp "$WORK_DIR/.env.bak" "$DEPLOY_DIR/.env" 2>/dev/null || true
cp "$WORK_DIR/.auth.json.bak" "$DEPLOY_DIR/.auth.json" 2>/dev/null || true
cp "$WORK_DIR/.envstore.key.bak" "$DEPLOY_DIR/.envstore.key" 2>/dev/null || true

sudo -n systemctl restart monitoring-dashboard
sleep 3
systemctl is-active monitoring-dashboard

PORT="$(sed -n 's/^PORT=//p' "$DEPLOY_DIR/.env" | head -1 | tr -d '[:space:]')"
for i in 1 2 3 4 5; do
  if curl -sf "http://localhost:${PORT:-3000}/health" >/dev/null; then
    echo "Deploy complete"
    exit 0
  fi
  sleep 2
done

echo "ERROR: monitoring-dashboard did not become healthy" >&2
journalctl -u monitoring-dashboard -n 20 --no-pager >&2 || true
exit 1
