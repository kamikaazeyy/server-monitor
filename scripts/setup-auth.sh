#!/usr/bin/env bash
#
# setup-auth.sh — configure DASHBOARD_TOKEN for the monitoring dashboard.
#
# Interactive — asks for a token (blank = generate a random one):
#   sudo bash scripts/setup-auth.sh
#
# Non-interactive, used by CI deploys — generates a token only if none is
# set and prints it to stdout (visible in the GitHub Actions log):
#   bash scripts/setup-auth.sh --generate
#
set -euo pipefail

ENV_FILE="${ENV_FILE:-/opt/monitoring-dashboard/.env}"
SERVICE_NAME="${SERVICE_NAME:-monitoring-dashboard}"
GENERATE=0
[[ "${1:-}" == "--generate" ]] && GENERATE=1

current_token() {
  grep -E '^DASHBOARD_TOKEN=' "$ENV_FILE" 2>/dev/null | tail -1 | cut -d= -f2- || true
}

random_token() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 24
  else
    head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

write_token() {
  local token="$1"
  touch "$ENV_FILE"
  if grep -qE '^DASHBOARD_TOKEN=' "$ENV_FILE"; then
    sed -i "s|^DASHBOARD_TOKEN=.*|DASHBOARD_TOKEN=${token}|" "$ENV_FILE"
  else
    printf '\nDASHBOARD_TOKEN=%s\n' "$token" >> "$ENV_FILE"
  fi
  chmod 600 "$ENV_FILE"
}

if [[ $GENERATE -eq 1 ]]; then
  if [[ -n "$(current_token)" ]]; then
    echo "DASHBOARD_TOKEN already configured — leaving it unchanged."
    exit 0
  fi
  token="$(random_token)"
  write_token "$token"
  echo ""
  echo "======================================================================"
  echo " Generated a new dashboard token (saved to ${ENV_FILE}):"
  echo ""
  echo "   ${token}"
  echo ""
  echo " Use this to sign in at the dashboard login screen."
  echo "======================================================================"
  exit 0
fi

# --- Interactive mode ---

if [[ ! -t 0 ]]; then
  echo "Not a TTY — use --generate for non-interactive setup." >&2
  exit 1
fi

existing="$(current_token)"
if [[ -n "$existing" ]]; then
  echo "A dashboard token is already set in ${ENV_FILE}."
  read -r -p "Replace it with a new one? [y/N] " answer
  [[ "$answer" =~ ^[Yy]$ ]] || exit 0
fi

echo "Enter a new dashboard token (leave blank to generate a random one):"
read -r -s token
echo ""
if [[ -z "$token" ]]; then
  token="$(random_token)"
  echo "(generated a random token)"
fi

write_token "$token"

if command -v systemctl >/dev/null 2>&1 \
  && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl restart "$SERVICE_NAME"
  echo "Restarted ${SERVICE_NAME}."
fi

echo ""
echo "Done. Sign in at the dashboard with:"
echo ""
echo "  ${token}"
echo ""
