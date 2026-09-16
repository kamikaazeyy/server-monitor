# Monitoring Dashboard

A lightweight, self-hosted server monitoring dashboard built with **Fastify** and **React + TypeScript**.

## Features

- **Overview**: live CPU, memory, disk, network usage and uptime with sparkline charts.
- **Containers**: running Docker containers with stats and project/service labels.
- **Projects**: Docker Compose project grouping via container labels (`com.docker.compose.project` and `com.docker.compose.service`).
- **Services**: active/failed systemd services.
- **GitHub / CI**: pull request status and recent GitHub Actions workflow runs.
- **Speed Test**: on-demand internet speed test.
- **Dark mode toggle**: switch between light and dark themes.

## Run locally

```bash
npm install
npm run build
npm start
```

Open `http://localhost:3000/monitor`.

For development, run the server and the Vite client dev server in separate terminals:

```bash
# terminal 1
npm start

# terminal 2
cd client && npm run dev
```

## Requirements

- Node.js 18+
- Linux host with `/proc` access (CPU, memory, network metrics)
- `docker` CLI (for container data)
- `systemctl` (for service data)
- `gh` CLI authenticated with GitHub (for PR/CI data)
- `curl` (for the speed test)

## Authentication

All API routes, the web terminal, and socket connections are protected by authentication. On first launch the dashboard shows a **signup screen** — the first visitor creates the username/password account, which is stored (hashed) in `.auth.json` on the server. Afterwards it works as a normal login. Sessions use a JWT valid for 30 days.

If you get locked out or want to reset the account:

```bash
sudo bash scripts/reset-auth.sh
```

This deletes `.auth.json` and restarts the service — the next visitor will see the signup screen again.

## Configuration

| Environment variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `MONITOR_REPO` | GitHub repo to watch | `kamikaazeyy/fitso` |
| `AUTH_FILE` | Path to the credentials file | `./.auth.json` |
