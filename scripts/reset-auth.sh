#!/usr/bin/env bash
#
# reset-auth.sh — delete the dashboard account and re-open signup.
# Use this if you're locked out or want to change the username/password.
# The next visitor to the dashboard will see the signup form.
#
#   sudo bash scripts/reset-auth.sh
#
set -euo pipefail

AUTH_FILE="${AUTH_FILE:-/opt/monitoring-dashboard/.auth.json}"
SERVICE_NAME="${SERVICE_NAME:-monitoring-dashboard}"

if [[ ! -f "$AUTH_FILE" ]]; then
  echo "No account found at ${AUTH_FILE} — signup is already open."
  exit 0
fi

rm -f "$AUTH_FILE"
echo "Deleted ${AUTH_FILE}."

if command -v systemctl >/dev/null 2>&1 \
  && systemctl list-unit-files 2>/dev/null | grep -q "^${SERVICE_NAME}\.service"; then
  systemctl restart "$SERVICE_NAME"
  echo "Restarted ${SERVICE_NAME}."
fi

echo "Done — the next visitor will see the signup screen to create a new account."
