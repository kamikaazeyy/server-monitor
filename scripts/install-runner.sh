#!/bin/bash
set -e

REPO="${REPO:-kamikaazeyy/server-monitor}"
TOKEN="${TOKEN:?TOKEN environment variable is required}"
RUNNER_NAME="${RUNNER_NAME:-$(hostname)}"
LABELS="${LABELS:-self-hosted,Linux,X64}"
RUNNER_VERSION="${RUNNER_VERSION:-2.323.0}"

INSTALL_DIR="${INSTALL_DIR:-/opt/actions-runner}"

mkdir -p "$INSTALL_DIR"
cd "$INSTALL_DIR"

curl -fsSLo actions-runner-linux-x64.tar.gz \
  "https://github.com/actions/runner/releases/download/v${RUNNER_VERSION}/actions-runner-linux-x64-${RUNNER_VERSION}.tar.gz"

tar xzf actions-runner-linux-x64.tar.gz
rm -f actions-runner-linux-x64.tar.gz

RUNNER_ALLOW_RUNASROOT=1 ./config.sh \
  --url "https://github.com/${REPO}" \
  --token "$TOKEN" \
  --name "$RUNNER_NAME" \
  --labels "$LABELS" \
  --unattended \
  --replace

RUNNER_ALLOW_RUNASROOT=1 ./svc.sh install
RUNNER_ALLOW_RUNASROOT=1 ./svc.sh start

echo "GitHub Actions runner installed at ${INSTALL_DIR}"
