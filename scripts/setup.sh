#!/usr/bin/env bash
#
# setup.sh — install the monitoring dashboard on a Linux server.
#
# Interactive when run in a terminal; fully non-interactive for scripts
# and coding agents when flags/env vars are provided.
#
#   sudo bash scripts/setup.sh                    # interactive
#   sudo bash scripts/setup.sh --non-interactive  # defaults for everything
#
# Configuration (env vars or --flag value):
#   PORT=3000            --port          HTTP port
#   HOST=127.0.0.1       --host          bind address (keep loopback for proxy/Tailscale)
#   SERVICE_USER=monitor --user          system user that runs the service
#   SERVICE_NAME=monitoring-dashboard --service-name
#   INSTALL_SERVICE=auto --service|--no-service   auto|yes|no (systemd unit)
#   ADD_DOCKER_GROUP=auto --docker-group|--no-docker-group
#   NON_INTERACTIVE=1    --non-interactive
#
# Re-running is safe: it rebuilds the client and restarts the service.
set -euo pipefail

# --- Resolve repo root (script lives in <root>/scripts/) ---------------------

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

# --- Defaults + arg parsing --------------------------------------------------

PORT="${PORT:-3000}"
HOST="${HOST:-127.0.0.1}"
SERVICE_USER="${SERVICE_USER:-monitor}"
SERVICE_NAME="${SERVICE_NAME:-monitoring-dashboard}"
INSTALL_SERVICE="${INSTALL_SERVICE:-auto}"
ADD_DOCKER_GROUP="${ADD_DOCKER_GROUP:-auto}"
NON_INTERACTIVE="${NON_INTERACTIVE:-0}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PORT="$2"; shift 2;;
    --host) HOST="$2"; shift 2;;
    --user) SERVICE_USER="$2"; shift 2;;
    --service-name) SERVICE_NAME="$2"; shift 2;;
    --service) INSTALL_SERVICE="yes"; shift;;
    --no-service) INSTALL_SERVICE="no"; shift;;
    --docker-group) ADD_DOCKER_GROUP="yes"; shift;;
    --no-docker-group) ADD_DOCKER_GROUP="no"; shift;;
    --non-interactive) NON_INTERACTIVE=1; shift;;
    -h|--help) sed -n '2,25p' "$0"; exit 0;;
    *) echo "Unknown option: $1" >&2; exit 1;;
  esac
done

if [[ ! -t 0 ]]; then NON_INTERACTIVE=1; fi

info()  { printf '\033[1;34m[setup]\033[0m %s\n' "$*"; }
warn()  { printf '\033[1;33m[setup] %s\033[0m\n' "$*" >&2; }
die()   { printf '\033[1;31m[setup] %s\033[0m\n' "$*" >&2; exit 1; }
ask()   {
  # ask VAR "Prompt" default
  local var="$1" prompt="$2" default="$3"
  if [[ "$NON_INTERACTIVE" == "1" ]]; then
    printf -v "$var" '%s' "$default"
  else
    read -rp "$prompt [$default]: " reply < /dev/tty || reply="$default"
    printf -v "$var" '%s' "${reply:-$default}"
  fi
}

[[ "$OSTYPE" == linux* ]] || warn "This installer targets Linux; on other OSes run npm ci && cd client && npm run build manually."

# --- 1. Prerequisites ---------------------------------------------------------

info "Checking prerequisites…"

if ! command -v node >/dev/null 2>&1; then
  die "node is not installed. Install Node.js 18+ first:
  Debian/Ubuntu : curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && apt install -y nodejs
  Fedora        : dnf install -y nodejs
  Or via nvm    : https://github.com/nvm-sh/nvm"
fi

NODE_MAJOR="$(node -v | sed 's/^v//; s/\..*//')"
[[ "$NODE_MAJOR" -ge 18 ]] || die "Node.js 18+ required (found $(node -v))."

command -v npm >/dev/null 2>&1 || die "npm not found."
info "Node $(node -v), npm $(npm -v)"

# node-pty needs a compiler when no prebuilt binary matches this Node ABI.
if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
  warn "No C++ toolchain found — if node-pty fails to build, install it:
  Debian/Ubuntu : apt install -y build-essential python3
  Fedora        : dnf install -y gcc-c++ make python3
  Alpine        : apk add build-base python3"
fi

# --- 2. Install dependencies + build client ----------------------------------

info "Installing server dependencies…"
npm ci --omit=dev

info "Installing client dependencies and building…"
(cd client && npm ci && npm run build)

# --- 3. Configuration ---------------------------------------------------------

ask PORT "HTTP port" "$PORT"
ask HOST "Bind address (127.0.0.1 = loopback only)" "$HOST"

ENV_FILE="$REPO_ROOT/.env"
if [[ ! -f "$ENV_FILE" ]]; then
  info "Writing $ENV_FILE"
  cat > "$ENV_FILE" <<EOF
PORT=$PORT
HOST=$HOST
EOF
  chmod 600 "$ENV_FILE"
else
  info "Keeping existing $ENV_FILE"
  # Refresh PORT/HOST only if the user changed them via flags/env.
  sed -i.bak -E "s/^PORT=.*/PORT=$PORT/; s/^HOST=.*/HOST=$HOST/" "$ENV_FILE" && rm -f "$ENV_FILE.bak"
fi

# --- 4. Service user ----------------------------------------------------------

IS_ROOT=0
[[ "$(id -u)" == "0" ]] && IS_ROOT=1

create_user() {
  if id "$SERVICE_USER" >/dev/null 2>&1; then
    info "User $SERVICE_USER already exists"
  else
    info "Creating service user $SERVICE_USER"
    useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  fi

  local want_docker="$ADD_DOCKER_GROUP"
  if [[ "$want_docker" == "auto" ]]; then
    want_docker=no
    command -v docker >/dev/null 2>&1 && getent group docker >/dev/null 2>&1 && want_docker=yes
  fi
  if [[ "$want_docker" == "yes" ]]; then
    usermod -aG docker "$SERVICE_USER"
    info "Added $SERVICE_USER to the docker group"
  elif ! command -v docker >/dev/null 2>&1; then
    warn "docker not found — container/database tabs will show errors. Install docker and run: usermod -aG docker $SERVICE_USER"
  fi
}

# A real login shell is needed for the web terminal — nologin shells still
# work because node-pty spawns $SHELL, but we fall back to the service user's
# shell gracefully below.

# --- 5. systemd service --------------------------------------------------------

install_service() {
  local unit="/etc/systemd/system/$SERVICE_NAME.service"
  info "Installing systemd unit $unit"
  cat > "$unit" <<EOF
[Unit]
Description=Monitoring Dashboard
After=network.target docker.service
Wants=docker.service

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$REPO_ROOT
EnvironmentFile=$REPO_ROOT/.env
ExecStart=$(command -v node) $REPO_ROOT/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  systemctl daemon-reload
  systemctl enable --now "$SERVICE_NAME"
  info "Service $SERVICE_NAME enabled and started"
}

want_service="$INSTALL_SERVICE"
if [[ "$want_service" == "auto" ]]; then
  want_service=no
  command -v systemctl >/dev/null 2>&1 && want_service=yes
fi

if [[ "$want_service" == "yes" ]]; then
  if [[ "$IS_ROOT" != "1" ]]; then
    die "Installing a systemd service requires root — re-run with sudo, or use --no-service."
  fi
  ask SERVICE_USER "Service user" "$SERVICE_USER"
  create_user

  # The service user must own the checkout — it writes .auth.json and
  # reads node_modules/.env via the unit's EnvironmentFile.
  info "Setting ownership of $REPO_ROOT to $SERVICE_USER"
  chown -R "$SERVICE_USER:" "$REPO_ROOT"

  # BUILDS_DIR lives outside the repo (default /opt/monitoring-builds) —
  # create + chown it if builds are configured.
  if grep -qE '^(EXPO_TOKEN|BUILDS_DIR)=' "$ENV_FILE" 2>/dev/null; then
    builds_dir="$(grep -E '^BUILDS_DIR=' "$ENV_FILE" | cut -d= -f2-)"
    builds_dir="${builds_dir:-/opt/monitoring-builds}"
    mkdir -p "$builds_dir"
    chown -R "$SERVICE_USER:" "$builds_dir"
    info "Prepared BUILDS_DIR $builds_dir"
  fi

  install_service
elif [[ "$want_service" == "no" ]]; then
  info "Skipping systemd service (--no-service)"
fi

# --- 6. Done ------------------------------------------------------------------

echo
info "Done."
echo "  Dashboard : http://localhost:$PORT/monitor"
if [[ "$want_service" == "yes" ]]; then
  echo "  Logs      : journalctl -u $SERVICE_NAME -f"
else
  echo "  Run it    : (cd $REPO_ROOT && set -a && . ./.env && set +a && npm start)"
fi
echo "  First visit opens the signup screen — the account you create is"
echo "  stored hashed in $REPO_ROOT/.auth.json"
echo
echo "  Next steps (optional):"
echo "   • Expose safely: reverse proxy + TLS (Caddy/nginx) or Tailscale."
echo "     The app binds to $HOST — keep 127.0.0.1 unless you know why not."
echo "   • Locked out later? sudo bash $REPO_ROOT/scripts/reset-auth.sh"
