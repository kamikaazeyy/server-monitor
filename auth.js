const crypto = require('crypto');

// Token resolution: DASHBOARD_TOKEN env var, else generate a random one and
// print it once so a first-run deployer can log in.
let token = process.env.DASHBOARD_TOKEN;
if (!token) {
  token = crypto.randomBytes(24).toString('base64url');
  console.warn('[auth] DASHBOARD_TOKEN not set — generated a random token:');
  console.warn(`[auth]   ${token}`);
  console.warn('[auth] Set DASHBOARD_TOKEN in .env to keep it stable across restarts.');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // Query param allowed so browser download links / QR codes can authenticate.
  if (typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

function requireAuth(req, res, next) {
  const candidate = extractToken(req);
  if (candidate && safeEqual(candidate, token)) return next();
  res.status(401).json({ error: 'Unauthorized' });
}

function socketAuth(socket, next) {
  const candidate = socket.handshake.auth && socket.handshake.auth.token;
  if (candidate && safeEqual(candidate, token)) return next();
  next(new Error('Unauthorized'));
}

async function loginHandler(req, res) {
  const candidate = req.body && req.body.token;
  if (candidate && safeEqual(candidate, token)) return res.json({ ok: true });
  await new Promise((resolve) => setTimeout(resolve, 500));
  res.status(401).json({ error: 'Invalid token' });
}

module.exports = { requireAuth, socketAuth, loginHandler };
