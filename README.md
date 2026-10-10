# Monitoring Dashboard

A lightweight, self-hosted server monitoring dashboard built with **Express**, **Socket.io** and **React + TypeScript**.

## Features

- **Overview**: live CPU, memory, disk, network usage and uptime with sparkline charts.
- **Containers**: running Docker containers with stats and project/service labels, plus start/stop/restart controls.
- **Projects**: Docker Compose project grouping via container labels (`com.docker.compose.project` and `com.docker.compose.service`).
- **Services**: active/failed systemd services.
- **GitHub / CI**: pull request status and recent GitHub Actions workflow runs (via `gh` CLI).
- **Terminal**: full xterm.js web terminal over Socket.io (`node-pty`).
- **Database browser**: auto-discovers DB containers (Postgres today), browses schemas and paginated table data — read-only enforced at the session level.
- **App builds** (optional): trigger and mirror EAS builds, stream build logs, download APKs via QR code.
- **Speed Test**: on-demand internet speed test (rate-limited).
- **Auth**: first-run signup creates the login; all API routes and sockets are authenticated. Dark/light theme included.

## Quick start

Any Linux distro / architecture (detects distro, init system, and
installs Node.js if missing):

```bash
curl -fsSL https://raw.githubusercontent.com/kamikaazeyy/server-monitor/main/install.sh | sudo sh
```

Or with Docker:

```bash
docker compose up -d
```

Windows Server / Windows 10-11 (elevated PowerShell — registers an NSSM
service or Scheduled Task and adds a firewall rule):

```powershell
.\install.ps1
```

The classic Linux installer is still there for flag-driven/automation use
(systemd only):

```bash
git clone https://github.com/kamikaazeyy/server-monitor.git /opt/monitoring-dashboard
cd /opt/monitoring-dashboard
sudo bash scripts/setup.sh
```

Non-interactive for scripts/agents (see `AGENTS.md`):

```bash
sudo bash scripts/setup.sh --non-interactive --user monitor --port 3000
```

Or run it manually:

```bash
npm install
npm run build   # builds client/
npm start
```

Open `http://localhost:3000/monitor`. The first visitor sees a **signup
screen** — that account is stored (scrypt-hashed) in `.auth.json` on the
server. Afterwards it's a normal login; sessions are JWTs valid for 30
days.

For development, the API and the Vite dev server run together:

```bash
npm run dev
```

(Vite proxies `/api` and `/socket.io` to `localhost:3000`.)

## Deployment notes

- The server binds to `127.0.0.1` by default. To expose it, either set
  `HOST` to a private interface or put it behind a reverse proxy with
  TLS (nginx, Caddy) or a private network (Tailscale, WireGuard).
- An example `monitoring-dashboard.service` systemd unit is included —
  adjust `User`, `WorkingDirectory` and `EnvironmentFile` before
  installing it. The service user needs `/proc` access and membership in
  the `docker` group for container data.
- Do not run as `root`: the terminal spawns real shells with the service
  user's privileges, and the server refuses to start as root unless
  `TERMINAL_ALLOW_ROOT=true` is set.
- If the app sits behind external auth (Cloudflare Access, Authentik,
  VPN-only network), set `MONITOR_AUTH_DISABLED=true`.
- Locked out? `sudo bash scripts/reset-auth.sh` deletes `.auth.json` and
  re-opens signup.
- **OS/arch compatibility**: see `COMPATIBILITY.md` for the supported
  distro matrix, permission requirements, and graceful-degradation notes
  (Windows, containers without /proc, Alpine/musl, etc.). Run
  `sh scripts/test-compatibility-matrix.sh` to smoke-test all distros
  locally via Docker.

## Requirements

- Node.js 18+
- Linux host with `/proc` access (CPU, memory, network metrics)
- `docker` CLI (for container data + DB discovery)
- `systemctl` (for service data)
- `gh` CLI authenticated with GitHub (for PR/CI data)
- `curl` (for the speed test)
- Optional: `eas` CLI + `EXPO_TOKEN` (for the app builds feature)
- `node-pty` needs build tools (`python3`, `make`, C++ compiler) if no
  prebuilt binary is available for your platform

## Configuration

| Environment variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `127.0.0.1` |
| `MONITOR_AUTH_DISABLED` | Skip built-in auth (external auth only) | `false` |
| `AUTH_FILE` | Path to the credentials file | `./.auth.json` |
| `MONITOR_REPO` | GitHub repo shown in the CI tab (`owner/repo`) | unset |
| `CLIENT_ORIGIN` | Allowed CORS origin (dev only; prod is same-origin) | unset |
| `EXPO_TOKEN` | Expo access token for EAS builds | unset |
| `EAS_PROJECT_DIR` | Mobile app directory for builds (legacy: `FITSO_MOBILE_DIR`) | unset |
| `ENABLE_BUILDS` | Force the builds feature on/off | auto via `EXPO_TOKEN` |
| `BUILDS_DIR` | Where mirrored APKs/logs are stored | `/opt/monitoring-builds` |
| `BUILDS_KEEP` | Number of APKs to keep | `10` |
| `DB_READONLY` | Enforce read-only DB sessions | `true` |
| `DB_POOL_MAX` | Max connections per DB pool | `5` |
| `TERMINAL_MAX_SESSIONS` | Max concurrent terminal sessions | `10` |
| `TERMINAL_MAX_PER_IP` | Max terminal sessions per IP | `3` |

Copy `.env.example` to `.env` to get started. Env vars are read from the
process environment (e.g. systemd `EnvironmentFile`) — if you want a
dotenv file loaded automatically, set it in your service unit.

## Security

See [SECURITY.md](SECURITY.md). In short: everything is behind auth, the
terminal is a real shell — treat dashboard access as admin-level, and
report vulnerabilities privately.
