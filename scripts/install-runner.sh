#!/bin/bash
# Install a GitHub Actions self-hosted runner on a machine.
#
# WARNING: RUNNER_ALLOW_RUNASROOT=1 is used below so this works when run
# as root (common on fresh VPS images). A self-hosted runner executes CI
# jobs on this machine — on a PUBLIC repository that means anyone who can
# trigger a workflow may get code execution here. Prefer a dedicated VM,
# a non-root user, and never attach a self-hosted runner to a public repo
# unless you understand the risk.
#
# Required env:
#   REPO  — owner/repo to register the runner against
#   TOKEN — registration token from GitHub (Settings > Actions > Runners)
set -e

REPO="${REPO:?REPO environment variable is required (owner/repo)}"
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
