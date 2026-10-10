const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const config = require('./config');
const monitorRouter = require('./monitor');
const dbRouter = require('./db');
const { requireAuth, socketAuth, statusHandler, signupHandler, loginHandler, logoutHandler } = require('./auth');
const { rateLimit } = require('./ratelimit');
const { sendError } = require('./errors');

// node-pty is an optional dependency: on platforms without a build
// toolchain (Alpine without build-base, Windows without VS tools) the
// install can skip it and the dashboard still serves — only the terminal
// tab is degraded.
let pty = null;
try {
  pty = require('node-pty');
} catch {
  console.warn('[terminal] node-pty not installed — terminal tab disabled.');
}

const app = express();
app.disable('x-powered-by');

// CORS is only needed when the client is served from a different origin
// (e.g. the Vite dev server). In production the built client is same-origin.
const CLIENT_ORIGIN = config.clientOrigin;
if (CLIENT_ORIGIN) {
  app.use(cors({ origin: CLIENT_ORIGIN }));
}
app.use(express.json({ limit: '64kb' }));

// Baseline security headers. CSP allows the fonts/avatar origins used by the
// client plus same-origin WebSocket connections for the terminal and builds.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '));
  next();
});

const httpServer = createServer(app);

// Cross-site WebSocket hijacking guard: browsers send Origin on the socket
// handshake — require it to match the request's Host (same-origin) or the
// configured dev CLIENT_ORIGIN. Non-browser clients send no Origin and are
// still gated by the auth token in socketAuth.
function isAllowedSocketOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const o = new URL(origin);
    if (CLIENT_ORIGIN && o.origin === CLIENT_ORIGIN) return true;
    return o.host === req.headers.host;
  } catch {
    return false;
  }
}

const io = new Server(httpServer, {
  // Cap any single inbound frame — the client only ever sends small
  // terminal/room-control payloads.
  maxHttpBufferSize: 100 * 1024,
  // Restore rooms + missed events on brief network drops.
  connectionStateRecovery: {},
  allowRequest: (req, callback) => {
    callback(null, isAllowedSocketOrigin(req));
  },
  ...(CLIENT_ORIGIN ? { cors: { origin: CLIENT_ORIGIN } } : {}),
});

app.get('/api/auth/status', statusHandler);
app.post('/api/auth/signup', rateLimit({ windowMs: 3600000, max: 5, message: 'Too many signup attempts' }), signupHandler);
app.post('/api/auth/login', rateLimit({ windowMs: 300000, max: 10, message: 'Too many login attempts. Try again later.' }), loginHandler);
app.post('/api/auth/logout', logoutHandler);
app.use('/api', requireAuth);

app.use(monitorRouter);
if (config.enableBuilds) {
  app.use(require('./builds')(io));
}
app.use(dbRouter);

app.get('/api/features', (req, res) => {
  res.json({ builds: config.enableBuilds, terminal: !!pty });
});

io.use(socketAuth);

if (process.getuid && process.getuid() === 0 && !config.terminalAllowRoot) {
  console.error('[terminal] Refusing to spawn shells as root. Run as a non-root user or set TERMINAL_ALLOW_ROOT=true.');
  process.exit(1);
}
const terminalAvailable = !!pty;

// Only /terminal namespace connections spawn a shell — sockets opened by
// notifications/build-log listeners on the default namespace never do.
const terminalNsp = io.of('/terminal');
terminalNsp.use(socketAuth);

// Per-IP connect-attempt throttle for the terminal namespace — each
// successful connection spawns a real shell, so handshakes get a window too.
const terminalAttempts = new Map();
terminalNsp.use((socket, next) => {
  const ip = socket.handshake.address || 'unknown';
  const now = Date.now();
  let rec = terminalAttempts.get(ip);
  if (!rec || rec.resetAt < now) {
    rec = { count: 0, resetAt: now + 60000 };
    terminalAttempts.set(ip, rec);
  }
  if (++rec.count > 30) {
    return next(new Error('Too many terminal connection attempts'));
  }
  next();
});

// Bound concurrent terminal sessions — each connection spawns a real shell.
const TERMINAL_MAX_SESSIONS = config.terminalMaxSessions;
const TERMINAL_MAX_PER_IP = config.terminalMaxPerIp;
/** @type {Map<string, string>} socket.id -> remote address */
const activeTerminals = new Map();

function pickShell() {
  if (process.env.SHELL) return process.env.SHELL;
  if (process.platform === 'win32') return 'cmd.exe';
  if (fs.existsSync('/bin/bash')) return '/bin/bash';
  return '/bin/sh';
}

// Per-socket terminal input throttle: keystrokes/pastes are small; a
// hostile client flooding `terminal:input` should not pin the pty.
const INPUT_MAX_SINGLE_BYTES = 64 * 1024;   // drop any single message > 64KB
const INPUT_BUCKET_BYTES = 256 * 1024;      // burst allowance
const INPUT_REFILL_PER_MS = 256;            // sustained ~256KB/s

terminalNsp.on('connection', (socket) => {
  if (!terminalAvailable) {
    socket.emit('terminal:data', '\r\n[terminal] Terminal is unavailable on this server (node-pty missing or running as root).\r\n');
    socket.disconnect(true);
    return;
  }

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

  const inputBucket = { bytes: INPUT_BUCKET_BYTES, last: Date.now() };

  socket.on('terminal:input', (data) => {
    if (typeof data !== 'string' || data.length > INPUT_MAX_SINGLE_BYTES) return;
    const size = Buffer.byteLength(data);
    const now = Date.now();
    inputBucket.bytes = Math.min(INPUT_BUCKET_BYTES, inputBucket.bytes + (now - inputBucket.last) * INPUT_REFILL_PER_MS);
    inputBucket.last = now;
    if (size > inputBucket.bytes) return; // rate limited — drop silently
    inputBucket.bytes -= size;
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
app.use(express.static(DIST_DIR, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    // index.html must revalidate — hashed asset URLs change every build.
    if (filePath.endsWith('index.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  },
}));

app.get('/monitor', (req, res) => {
  res.sendFile(path.join(DIST_DIR, 'index.html'));
});

// Final error handler — keeps stack traces out of responses even when
// NODE_ENV isn't 'production'.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  sendError(res, 500, err);
});

httpServer.listen(config.port, config.host, () => {
  console.log(`Server Monitor running on http://${config.host}:${config.port}/monitor`);
});
