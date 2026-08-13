# Server Monitor

A lightweight, self-hosted server monitoring dashboard built with Fastify.

## Features

- **Overview**: live CPU, memory, disk, and network usage plus uptime.
- **Containers**: running Docker containers with CPU, memory, and network stats.
- **Projects**: Docker Compose project/service grouping via container labels (`com.docker.compose.project` and `com.docker.compose.service`).
- **Services**: active/failed systemd services.
- **GitHub / CI**: pull request status and recent GitHub Actions workflow runs.
- **Speed Test**: on-demand internet speed test via Cloudflare.

## Run locally

```bash
npm install
npm start
```

Open `http://localhost:3000/monitor`.

## Requirements

- Node.js 18+
- Linux host with `/proc` access (CPU, memory, network metrics)
- `docker` CLI (for container data)
- `systemctl` (for service data)
- `gh` CLI authenticated with GitHub (for PR/CI data)
- `curl` (for the speed test)

## Configuration

| Environment variable | Description | Default |
|---|---|---|
| `PORT` | HTTP port | `3000` |
| `HOST` | Bind address | `0.0.0.0` |
| `MONITOR_REPO` | GitHub repo to watch | `kamikaazeyy/fitso` |
