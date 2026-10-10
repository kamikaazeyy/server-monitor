# Compatibility Matrix

How the Monitoring Dashboard runs across operating systems,
architectures, and restricted environments — and what degrades vs.
what's required.

Legend: **Green** = fully supported, **Amber** = works with degraded
features, **Red** = not supported.

## OS / distro matrix

| OS | Status | Install path | Notes |
| --- | --- | --- | --- |
| Ubuntu 20.04 / 22.04 / 24.04 | Green | `install.sh` → systemd | Default target. Tested by `scripts/test-compatibility-matrix.sh`. |
| Debian 11 / 12 | Green | `install.sh` → systemd | — |
| RHEL / Rocky / Alma 8 / 9 | Green | `install.sh` → systemd | SELinux: no extra policy needed unless confining the service. |
| Fedora | Green | `install.sh` → systemd | — |
| Alpine (musl) | Amber | `install.sh` → OpenRC | `node-pty` must compile (needs `python3 make g++`); if it fails, terminal is skipped and everything else works. |
| Arch / Manjaro | Amber | `install.sh` → systemd | Rolling release; distro Node.js tested. |
| Windows Server 2019/2022, Win10/11 | Amber | `install.ps1` → NSSM service or Scheduled Task | Terminal tab unavailable (node-pty is POSIX-only); disk/network metrics use CIM/PowerShell fallbacks; docker/systemd/gh tabs need their CLIs installed. |
| macOS | Amber | `npm install && npm start` | Dev-only; systemd/docker tabs degrade. |

## Architectures

| Arch | Status | Notes |
| --- | --- | --- |
| x86_64 / amd64 | Green | Primary target; prebuilt `node-pty` binaries available. |
| aarch64 / arm64 | Green | Docker image + `install.sh` both work; `node-pty` prebuilds exist for arm64 Linux. |
| armv7 / 32-bit | Amber | Untested; all-JS parts work, native builds may not. |

## Feature availability by environment

| Feature | Bare-metal Linux | Docker container | Restricted container (no /proc mount, no docker.sock) | Windows |
| --- | --- | --- | --- | --- |
| CPU / memory / uptime | Green (`/proc`) | Green (mount `/proc` for host metrics) | Green (`os.*` fallback, cgroup-unaware) | Green (CIM/`os.*`) |
| Disk usage | Green | Green | Green | Green (CIM) |
| Network throughput | Green (`/proc/net/dev`) | Green | Amber (empty list) | Green (`Get-NetAdapterStatistics`) |
| Web terminal | Green | Green | Green (skipped if node-pty missing) | Red (degrades: tab hidden via `/api/features`) |
| Docker containers / projects | Green (`docker` CLI + socket) | Green (mount socket) | Red → inline error | Amber (needs Docker Desktop CLI) |
| systemd services | Green | Red → inline error | Red → inline error | Red → inline error |
| GitHub / CI tab | Green (needs `gh` auth) | Amber (needs `gh` in image) | Red → inline error | Amber |
| Speed test | Green | Green | Green | Green |
| DB browser | Green | Green | Amber (needs reachable Postgres) | Amber |

Degraded features never crash the server — they return structured
errors that the UI renders inline, or the tab is hidden via
`/api/features`.

## Permissions required

| Capability | Requirement |
| --- | --- |
| Bind to `PORT` | Any non-root user (default port 3000 > 1024). |
| Read `/proc`, `/sys` | Default on Linux; mount them into containers for host metrics. |
| Docker containers/projects/db tabs | Service user in `docker` group (host) or `group_add` matching the socket's GID (container). |
| systemd tab | `systemctl` accessible to the service user. |
| Terminal | Never run as root — the server refuses (`TERMINAL_ALLOW_ROOT` bypass for containers only). |

## Resource footprint

Measured on 1 vCPU / 512 MB containers (matrix script targets):

- RSS: ~60–90 MB with client build cached; npm-install-time spike higher.
- Idle CPU: < 1%.
- Poll endpoints are `rateLimit`-ed and subprocess calls carry a 30 s
  timeout, so a wedged `docker`/`gh` can't pin the event loop.

## Networking

- Binds `HOST`:`PORT` (defaults `127.0.0.1:3000` via `.env.example`;
  installers default `0.0.0.0` so the UI is reachable).
- If `PORT` is occupied the server exits with a clear `EADDRINUSE`
  error — pick another port via env.
- WebSocket origin check: browsers must connect from the same host (or
  `CLIENT_ORIGIN`); non-browser clients are unaffected.

## One-line quickstarts

```bash
# Any Linux distro/arch (detects init; systemd/OpenRC/standalone)
curl -fsSL https://raw.githubusercontent.com/kamikaazeyy/server-monitor/main/install.sh | sudo sh

# Docker
docker compose up -d

# Windows (elevated PowerShell)
powershell -ExecutionPolicy Bypass -File install.ps1

# Smoke-test every supported distro locally (Docker required)
sh scripts/test-compatibility-matrix.sh
```
