# Security Policy

## Reporting a Vulnerability

This project includes a **web terminal** and a **database browser** — a
vulnerability here can mean remote code execution on someone's server.
Please report security issues privately rather than opening a public
issue:

- Open a [GitHub Security Advisory](https://github.com/kamikaazeyy/server-monitor/security/advisories/new) on this repository, or
- Contact the maintainer via GitHub.

Please include the affected version/commit, steps to reproduce, and the
impact. You can expect an acknowledgement within a few days.

## Deployment security notes

By default the server binds to `127.0.0.1` and requires the account
created on the signup screen. To expose it safely:

- Put it behind a reverse proxy with TLS (nginx, Caddy) or access it via
  a private network (Tailscale, WireGuard, VPN).
- Do not run the service as `root` — it refuses to start unless
  `TERMINAL_ALLOW_ROOT` is set, and the terminal inherits the service
  user's privileges.
- If the dashboard sits behind external auth (Cloudflare Access,
  Authentik, etc.), `MONITOR_AUTH_DISABLED=true` turns off the built-in
  login — only use it when another layer authenticates every request.
- Anyone who can log in can use the terminal and browse databases with
  the discovered credentials. Treat dashboard access as admin-level.

## Scope

In scope: authentication bypass, remote code execution, secret
disclosure, stored/persistent XSS, privilege escalation paths in the
API or WebSocket handlers.

Out of scope: issues requiring an already-authenticated admin user
(e.g. an admin intentionally triggering builds), rate-limit tuning, and
vulnerabilities in dependencies (report upstream and/or file an issue
for a version bump).
