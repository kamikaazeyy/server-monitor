#!/bin/sh
# install.sh — zero-dependency installer for the Monitoring Dashboard.
#
# Detects distro / arch / init system, installs Node.js when missing,
# deploys the app, and registers it as a service (systemd, OpenRC, or a
# standalone nohup process as last resort).
#
#   curl -fsSL https://raw.githubusercontent.com/kamikaazeyy/server-monitor/main/install.sh | sudo sh
#   — or —
#   sudo sh install.sh [--port 3000] [--host 0.0.0.0] [--dir /opt/monitoring-dashboard] [--user monitor]
#
set -eu

PORT=3000
HOST=0.0.0.0
INSTALL_DIR=/opt/monitoring-dashboard
SVC_USER=monitor
REPO_URL=https://github.com/kamikaazeyy/server-monitor.git

while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --host) HOST="$2"; shift 2 ;;
    --dir) INSTALL_DIR="$2"; shift 2 ;;
    --user) SVC_USER="$2"; shift 2 ;;
    *) echo "unknown flag: $1" >&2; exit 2 ;;
  esac
done

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m==>\033[0m %s\n' "$*" >&2; }
die() { printf '\033[1;31m==>\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" = "0" ] || die "Run as root (sudo sh install.sh)"

# ---------- detect platform ----------
ARCH=$(uname -m)
case "$ARCH" in
  x86_64|amd64)   ARCH=x86_64 ;;
  aarch64|arm64)  ARCH=arm64 ;;
  armv7l|armv6l)  warn "32-bit ARM ($ARCH) is not a tested target — continuing anyway" ;;
  *)              warn "untested architecture: $ARCH" ;;
esac

DISTRO=unknown
if [ -r /etc/os-release ]; then
  . /etc/os-release
  DISTRO=${ID:-unknown}
fi

INIT=none
PID1=$(cat /proc/1/comm 2>/dev/null || echo unknown)
case "$PID1" in
  systemd) INIT=systemd ;;
  init)
    # could be sysv or openrc
    if command -v rc-service >/dev/null 2>&1; then INIT=openrc; else INIT=sysv; fi ;;
  *) if command -v rc-service >/dev/null 2>&1; then INIT=openrc; fi ;;
esac

log "Detected: $DISTRO / $ARCH / init=$INIT"

# ---------- dependencies ----------
pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q "$@"
  elif command -v apk >/dev/null 2>&1; then
    apk add --no-cache "$@"
  elif command -v pacman >/dev/null 2>&1; then
    pacman -Sy --noconfirm "$@"
  elif command -v zypper >/dev/null 2>&1; then
    zypper install -y "$@"
  else
    die "no supported package manager found — install $* manually"
  fi
}

# package names differ per family
case "$DISTRO" in
  alpine)      NODE_PKGS="nodejs npm";  BUILD_PKGS="python3 make g++ git" ;;
  arch|manjaro) NODE_PKGS="nodejs npm"; BUILD_PKGS="python make gcc git" ;;
  debian|ubuntu|pop|linuxmint|raspbian)
               NODE_PKGS="nodejs npm";  BUILD_PKGS="python3 make g++ git" ;;
  fedora|rhel|rocky|almalinux|centos|ol)
               NODE_PKGS="nodejs npm";  BUILD_PKGS="python3 make gcc-c++ git" ;;
  opensuse*|sles)
               NODE_PKGS="nodejs npm";  BUILD_PKGS="python3 make gcc-c++ git" ;;
  *)           NODE_PKGS="nodejs npm";  BUILD_PKGS="python3 make g++ git" ;;
esac

need_node() {
  command -v node >/dev/null 2>&1 || return 0
  MAJOR=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
  [ "${MAJOR:-0}" -lt 18 ] 2>/dev/null
}

if need_node; then
  log "Installing Node.js + build tools via package manager"
  pkg_install $NODE_PKGS $BUILD_PKGS || die "package install failed"
fi
need_node && die "Node.js 18+ still missing — install it from https://nodejs.org and re-run"
command -v git >/dev/null 2>&1 || pkg_install git || die "git install failed"
# node-pty only needs toolchains if no prebuilt binary exists — it's optional, failure is non-fatal
pkg_install $BUILD_PKGS 2>/dev/null || warn "build tools unavailable; terminal feature may be skipped"
log "Node $(node -v), npm $(npm -v)"

# ---------- fetch source ----------
if [ -d "$INSTALL_DIR/.git" ]; then
  log "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth 1 origin main
  git -C "$INSTALL_DIR" reset --hard origin/main
elif [ -f "$INSTALL_DIR/index.js" ]; then
  log "Using existing source in $INSTALL_DIR"
elif [ -f ./index.js ] && [ -f ./package.json ]; then
  INSTALL_DIR=$(pwd)
  log "Installing from current directory $INSTALL_DIR"
else
  log "Cloning $REPO_URL → $INSTALL_DIR"
  git clone --depth 1 "$REPO_URL" "$INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ---------- service user ----------
if ! id "$SVC_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$SVC_USER" 2>/dev/null \
    || useradd -r -m -s /sbin/nologin "$SVC_USER" \
    || die "could not create user $SVC_USER"
fi
if command -v docker >/dev/null 2>&1 && getent group docker >/dev/null 2>&1; then
  usermod -aG docker "$SVC_USER" 2>/dev/null || true
fi

# ---------- systemd path: reuse the maintained setup script ----------
if [ "$INIT" = systemd ]; then
  log "Delegating to scripts/setup.sh (systemd)"
  bash scripts/setup.sh --non-interactive --user "$SVC_USER" --port "$PORT" --host "$HOST" --service-name monitoring-dashboard
else
  # ---------- generic path: build + hand-rolled service ----------
  log "Installing dependencies and building client"
  npm ci --no-audit --no-fund || npm install --no-audit --no-fund
  (cd client && npm ci --no-audit --no-fund && npm run build)

  [ -f .env ] || { [ -f .env.example ] && cp .env.example .env; } || true
  grep -q '^PORT=' .env 2>/dev/null || printf 'PORT=%s\nHOST=%s\n' "$PORT" "$HOST" >> .env
  chown -R "$SVC_USER":"$SVC_USER" "$INSTALL_DIR"

  case "$INIT" in
    openrc)
      log "Installing OpenRC service"
      cat > /etc/init.d/monitoring-dashboard <<EOF
#!/sbin/openrc-run
name="monitoring-dashboard"
command="$(command -v node)"
command_args="$INSTALL_DIR/index.js"
command_user="$SVC_USER"
directory="$INSTALL_DIR"
pidfile="/run/\${RC_SVCNAME}.pid"
command_background="yes"
output_log="/var/log/monitoring-dashboard.log"
error_log="/var/log/monitoring-dashboard.log"
depend() { need net; }
EOF
      chmod +x /etc/init.d/monitoring-dashboard
      set -a; . ./.env; set +a 2>/dev/null || true
      rc-update add monitoring-dashboard default 2>/dev/null || true
      rc-service monitoring-dashboard restart
      ;;
    *)
      log "No systemd/OpenRC — starting standalone (nohup)"
      pkill -f "$INSTALL_DIR/index.js" 2>/dev/null || true
      set -a; . ./.env; set +a
      su -s /bin/sh "$SVC_USER" -c "cd '$INSTALL_DIR' && PORT=$PORT HOST=$HOST nohup node index.js >> /var/log/monitoring-dashboard.log 2>&1 &"
      warn "Standalone mode has no auto-restart — add the node command to your init/cron"
      ;;
  esac
fi

# ---------- report ----------
SERVER_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
[ -n "${SERVER_IP:-}" ] || SERVER_IP=$(ip -4 route get 1.1.1.1 2>/dev/null | awk '{print $7; exit}')
[ -n "${SERVER_IP:-}" ] || SERVER_IP="<server-ip>"
sleep 2
if curl -fsS -o /dev/null --max-time 5 "http://127.0.0.1:$PORT/health" 2>/dev/null; then
  log "Health check passed"
else
  warn "Health check did not respond yet — check logs (journalctl -u monitoring-dashboard / /var/log/monitoring-dashboard.log)"
fi
log "Web UI accessible at http://$SERVER_IP:$PORT"
log "First visitor creates the admin account."
