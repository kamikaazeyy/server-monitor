const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const pty = require('node-pty');
const cors = require('cors');
const monitorRouter = require('./monitor');
const dbRouter = require('./db');
const { requireAuth, socketAuth, statusHandler, signupHandler, loginHandler, logoutHandler } = require('./auth');
const { rateLimit } = require('./ratelimit');
const { sendError } = require('./errors');

const app = express();
app.disable('x-powered-by');

// CORS is only needed when the client is served from a different origin
// (e.g. the Vite dev server). In production the built client is same-origin.
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;
if (CLIENT_ORIGIN) {
  app.use(cors({ origin: CLIENT_ORIGIN }));
}
app.use(express.json());

// Baseline security headers. CSP allows the fonts/avatar origins used by the
// client plus same-origin WebSocket connections for the terminal and builds.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://api.dicebear.com",
    "connect-src 'self' ws: wss:",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});

const httpServer = createServer(app);
const io = new Server(httpServer, CLIENT_ORIGIN ? {
  cors: { origin: CLIENT_ORIGIN },
} : {});

app.get('/api/auth/status', statusHandler);
app.post('/api/auth/signup', rateLimit({ windowMs: 3600000, max: 5, message: 'Too many signup attempts' }), signupHandler);
app.post('/api/auth/login', rateLimit({ windowMs: 300000, max: 10, message: 'Too many login attempts. Try again later.' }), loginHandler);
app.post('/api/auth/logout', logoutHandler);
app.use('/api', requireAuth);

// The EAS builds feature is opt-in: an explicit ENABLE_BUILDS wins,
// otherwise it auto-enables when EXPO_TOKEN is configured.
const ENABLE_BUILDS = process.env.ENABLE_BUILDS
  ? process.env.ENABLE_BUILDS === 'true'
  : !!process.env.EXPO_TOKEN;

app.use(monitorRouter);
if (ENABLE_BUILDS) {
  app.use(require('./builds')(io));
}
app.use(dbRouter);

app.get('/api/features', (req, res) => {
  res.json({ builds: ENABLE_BUILDS });
});

io.use(socketAuth);

if (process.getuid && process.getuid() === 0 && !process.env.TERMINAL_ALLOW_ROOT) {
  console.error('[terminal] Refusing to spawn shells as root. Run as a non-root user or set TERMINAL_ALLOW_ROOT=true.');
  process.exit(1);
}

// Only /terminal namespace connections spawn a shell — sockets opened by
// notifications/build-log listeners on the default namespace never do.
const terminalNsp = io.of('/terminal');
terminalNsp.use(socketAuth);

// Bound concurrent terminal sessions — each connection spawns a real shell.
const TERMINAL_MAX_SESSIONS = parseInt(process.env.TERMINAL_MAX_SESSIONS || '10', 10);
const TERMINAL_MAX_PER_IP = parseInt(process.env.TERMINAL_MAX_PER_IP || '3', 10);
/** @type {Map<string, string>} socket.id -> remote address */
const activeTerminals = new Map();

function pickShell() {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === 'win32') return 'cmd.exe';
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

terminalNsp.on('connection', (socket) => {
  const remoteIp = socket.handshake.address || 'unknown';
  let ipCount = 0;
  for (const ip of activeTerminals.values()) {
    if (ip === remoteIp) ipCount++;
  }
  if (activeTerminals.size >= TERMINAL_MAX_SESSIONS || ipCount >= TERMINAL_MAX_PER_IP) {
    socket.emit('terminal:data', '\r\n[terminal] Too many active terminal sessions. Close one and retry.\r\n');
    socket.disconnect(true);
    return;
  }
  activeTerminals.set(socket.id, remoteIp);

  const shell = pickShell();

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || '/',
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      },
    });
  } catch (err) {
    console.error('[terminal] Failed to spawn shell:', err.message);
    socket.emit('terminal:data', '\r\n[terminal] Shell not available on this system.\r\n');
    socket.disconnect(true);
    return;
  }

  ptyProcess.onData((data) => {
    socket.emit('terminal:data', data);
  });

  ptyProcess.onExit(({ exitCode }) => {
    console.log(`[terminal] Shell exited with code ${exitCode}`);
    socket.disconnect(true);
  });

  socket.on('terminal:input', (data) => {
    if (typeof data !== 'string') return;
    ptyProcess.write(data);
  });

  socket.on('terminal:resize', (data) => {
    const cols = Number(data?.cols);
    const rows = Number(data?.rows);
    if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && cols <= 500 && rows > 0 && rows <= 500) {
      ptyProcess.resize(cols, rows);
    }
  });

  socket.on('disconnect', () => {
    activeTerminals.delete(socket.id);
    try {
      ptyProcess.kill();
    } catch (err) {
      // process may already be dead
    }
  });
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok', server: 'server-monitor' });
});

const DIST_DIR = path.join(__dirname, 'client', 'dist');
app.use(express.static(DIST_DIR, { maxAge: '1d' }));

app.get('/monitor', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// Final error handler — keeps stack traces out of responses even when
// NODE_ENV isn't 'production'.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  sendError(res, 500, err);
});

const port = process.env.PORT || 3000;
const host = process.env.HOST || '127.0.0.1';

httpServer.listen(port, host, () => {
  console.log(`Server Monitor running on http://${host}:${port}/monitor`);
});
