const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');
const pty = require('node-pty');
const cors = require('cors');
const monitorRouter = require('./monitor');

const app = express();
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || '*',
  credentials: true,
}));
app.use(express.json());

app.use(monitorRouter);

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.CLIENT_ORIGIN || '*',
    credentials: true,
  },
});

// ---------------------------------------------------------------------------
// SECURITY NOTICE: Terminal access is powerful. Authentication middleware
// MUST be added here BEFORE the WebSocket upgrade so unauthorized clients cannot
// connect at all. Example:
//
// io.use((socket, next) => {
//   const token = socket.handshake.auth?.token;
//   if (!validateToken(token)) return next(new Error('Unauthorized'));
//   next();
// });
//
// This is a placeholder only. Replace `validateToken` with your JWT/session
// or reverse-proxy auth check. No database auth implementation is included.
// ---------------------------------------------------------------------------

if (process.getuid && process.getuid() === 0 && !process.env.TERMINAL_ALLOW_ROOT) {
  console.error('[terminal] Refusing to spawn shells as root. Run as a non-root user or set TERMINAL_ALLOW_ROOT=true.');
  process.exit(1);
}

io.on('connection', (socket) => {
  const shell = process.env.SHELL || '/bin/bash';

  const ptyProcess = pty.spawn(shell, [], {
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

  socket.on('terminal:resize', ({ cols, rows }) => {
    if (cols > 0 && rows > 0) {
      ptyProcess.resize(cols, rows);
    }
  });

  socket.on('disconnect', () => {
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

const port = process.env.PORT || 3000;
const host = process.env.HOST || '0.0.0.0';

httpServer.listen(port, host, () => {
  console.log(`Server Monitor running on http://${host}:${port}/monitor`);
});
