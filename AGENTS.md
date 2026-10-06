# AGENTS.md — deploy & maintain this project

Instructions for coding agents deploying or working on this repo.

## What this is

A self-hosted server monitoring dashboard. Node.js **Express** API +
**Socket.io** (web terminal via `node-pty`, live build events) +
**React/TypeScript** client built with Vite into `client/dist`, served
statically by the same Express server.

## File map

- `index.js` — entrypoint: HTTP server, socket.io auth + terminal PTY
  sessions, security headers, feature flags (`/api/features`)
- `auth.js` — first-run signup, login, JWT sessions (`.auth.json`),
  `requireAuth` + `socketAuth`, `MONITOR_AUTH_DISABLED`
- `ratelimit.js` — per-IP fixed-window limiter for expensive routes
- `monitor.js` — system metrics + docker/systemd/`gh` data + speedtest
- `db.js` — DB browser: docker discovery, pg pools (read-only enforced)
- `builds.js` — optional EAS build trigger/mirror/log streaming
- `errors.js` — sanitized client error responses
- `client/` — Vite React app; `src/hooks/useApi.ts` calls `authFetch`
- `scripts/setup.sh` — idempotent installer (interactive or flag-driven)
- `scripts/reset-auth.sh` — delete `.auth.json` to reopen signup

## Deploy on a fresh Linux server (unattended)

```bash
# 1. Install Node.js 18+ and git (Node 20+ recommended; node-pty needs
#    python3/make/g++ when no prebuilt binary exists)
# 2. Clone and run the installer:
git clone https://github.com/kamikaazeyy/server-monitor.git /opt/monitoring-dashboard
cd /opt/monitoring-dashboard
sudo bash scripts/setup.sh --non-interactive --user monitor
# Optional flags: --port 3000 --host 127.0.0.1 --service-name NAME
#                 --no-service (skip systemd) --no-docker-group
```

The installer: `npm ci`, builds `client/dist`, creates the service user
(+docker group when docker exists), writes `.env`, installs a systemd
unit, and starts it. Re-running is safe (rebuild + restart).

## Verify a deployment

```bash
systemctl status monitoring-dashboard          # or: curl localhost:PORT/health
curl -s localhost:3000/api/auth/status         # {"needsSetup":true,...} before signup
curl -s localhost:3000/api/monitor/overview    # expect 401 (auth on)
```

The first HTTP visitor creates the admin account on the signup screen;
credentials are stored scrypt-hashed in `.auth.json` in the repo root.
Sessions are 30-day JWTs (Bearer, or `?token=` for downloads).

## Environment configuration

All config is env vars — see `.env.example`. The app does **not** load
dotenv itself; set vars via systemd `EnvironmentFile` (default:
`<repo>/.env`) or export them. Key vars: `PORT`, `HOST`,
`MONITOR_AUTH_DISABLED`, `AUTH_FILE`, `MONITOR_REPO`, `EXPO_TOKEN`,
`EAS_PROJECT_DIR`, `ENABLE_BUILDS`, `BUILDS_DIR`, `DB_READONLY`,
`TERMINAL_MAX_SESSIONS`, `TERMINAL_MAX_PER_IP`.

## Requirements / caveats

- **Linux + systemd** target: `/proc` for metrics, `systemctl` for the
  Services tab and the unit install. macOS dev works (metrics degrade).
- Service user needs `docker` group membership for Containers/Projects/
  Database tabs; without docker those endpoints return errors (harmless).
- GitHub tab needs `gh` CLI authenticated on the host + `MONITOR_REPO`.
- Builds tab is opt-in (`ENABLE_BUILDS` or presence of `EXPO_TOKEN`).
- Never run as root — terminal spawns real shells; startup refuses
  unless `TERMINAL_ALLOW_ROOT=true`.

## Dev workflow

```bash
npm run dev        # API (:3000) + Vite dev server (:5173, proxied)
npm run build      # client production build into client/dist
node --check x.js  # syntax check server files
cd client && npx oxlint && npm run build   # lint + typecheck client
```

## Rules for agents

- All `/api/*` routes sit behind `requireAuth`; keep it that way. New
  mutating endpoints need a `rateLimit({...})` too.
- Never commit `.env`, `.auth.json`, or credentials of any kind.
- Don't loosen `DB_READONLY`, CORS, or the security headers to "fix"
  errors — fix the caller instead.
