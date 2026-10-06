# Contributing

Thanks for your interest in contributing!

## Setup

```bash
npm install
cd client && npm install
```

## Development

```bash
npm run dev   # runs the API server and the Vite dev server together
```

The Vite dev server proxies `/api` and `/socket.io` to `localhost:3000`.
Build the production client with `npm run build`.

## Checks

- `node --check` on any server file you touched
- `cd client && npm run build` (runs `tsc -b` + `vite build`)
- `cd client && npx oxlint`

## Guidelines

- Keep dependencies minimal — this runs on other people's servers.
- Any new route under `/api/` is automatically behind `requireAuth`;
  mutating endpoints should also get a rate limiter (`ratelimit.js`).
- No new UI dependencies without discussion; match the existing
  Tailwind component style.
- Don't commit `.env`, `.auth.json`, or anything containing credentials.

## Reporting security issues

Please see [SECURITY.md](SECURITY.md) — do not open public issues for
vulnerabilities.
