const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');

const scryptAsync = promisify(crypto.scrypt);

// Credentials live in .auth.json next to this file: { username, salt, hash,
// jwtSecret, createdAt }. Created once via the signup endpoint; deleting it
// (scripts/reset-auth.sh) re-opens signup.
const AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, '.auth.json');
const TOKEN_TTL = '30d';
const SCRYPT_KEYLEN = 64;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;
const AUTH_DISABLED = process.env.MONITOR_AUTH_DISABLED === 'true';

if (AUTH_DISABLED) {
  console.warn('[auth] WARNING: MONITOR_AUTH_DISABLED=true — all endpoints and the terminal are UNAUTHENTICATED. Only use this behind external auth (Cloudflare Access, VPN, etc.).');
}

// Credentials are cached in memory — avoid sync file I/O on every request.
// External resets (scripts/reset-auth.sh) restart the service anyway.
let credsCache = null;
let credsCacheLoaded = false;

function loadCreds() {
  if (credsCacheLoaded) return credsCache;
  try {
    credsCache = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    credsCache = null;
  }
  credsCacheLoaded = true;
  return credsCache;
}

async function hashPassword(password, salt) {
  return (await scryptAsync(String(password), salt, SCRYPT_KEYLEN)).toString('hex');
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function issueToken(username, secret) {
  return jwt.sign({ sub: username }, secret, { expiresIn: TOKEN_TTL });
}

function verifyToken(raw) {
  const creds = loadCreds();
  if (!creds || !raw) return null;
  try {
    return jwt.verify(raw, creds.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    return null;
  }
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // Query-param tokens only allowed on the APK download route, so browser
  // links / QR codes work without a header — everywhere else would just
  // leak JWTs into access logs.
  // (requireAuth is mounted under /api, so req.path is relative to /api.)
  if (
    typeof req.query.token === 'string' && req.query.token &&
    /^\/builds\/[a-zA-Z0-9-]+\/apk$/.test(req.path)
  ) {
    return req.query.token;
  }
  return null;
}

function statusHandler(req, res) {
  // Deliberately does NOT return the username — this endpoint is public
  // and revealing it would hand brute-force attempts half the credential.
  res.json({ needsSetup: !loadCreds(), authDisabled: AUTH_DISABLED });
}

async function signupHandler(req, res) {
  if (AUTH_DISABLED) return res.status(400).json({ error: 'Auth is disabled on this server' });
  const { username, password } = req.body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME_RE.test(name)) {
    return res.status(400).json({ error: 'Username must be 3-32 chars: letters, numbers, . _ -' });
  }
  if (typeof password !== 'string' || password.length < 12) {
    return res.status(400).json({ error: 'Password must be at least 12 characters' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const record = {
    username: name,
    salt,
    hash: await hashPassword(password, salt),
    jwtSecret: crypto.randomBytes(32).toString('hex'),
    createdAt: new Date().toISOString(),
  };

  try {
    // 'wx' fails if the file already exists — first signup wins.
    fs.writeFileSync(AUTH_FILE, JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      return res.status(403).json({ error: 'Account already exists — sign in instead' });
    }
    throw err;
  }
  credsCache = record;
  credsCacheLoaded = true;

  res.json({ token: issueToken(name, record.jwtSecret), username: name });
}

async function loginHandler(req, res) {
  if (AUTH_DISABLED) return res.status(400).json({ error: 'Auth is disabled on this server' });
  const creds = loadCreds();
  if (!creds) {
    return res.status(400).json({ error: 'No account yet — complete setup first' });
  }
  const { username, password } = req.body || {};
  // scrypt stays async — a sync version would let login floods block the
  // event loop and stall the whole server.
  const candidateHash = await hashPassword(password || '', creds.salt);
  const ok =
    safeEqual(String(username || '').trim(), creds.username) &&
    safeEqual(candidateHash, creds.hash);
  if (ok) {
    return res.json({ token: issueToken(creds.username, creds.jwtSecret), username: creds.username });
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  res.status(401).json({ error: 'Invalid username or password' });
}

// Logout rotates the JWT secret — every outstanding token dies. For a
// single-admin dashboard that is exactly "sign out everywhere".
function logoutHandler(req, res) {
  if (AUTH_DISABLED) return res.json({ ok: true });
  if (!verifyToken(extractToken(req))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const creds = loadCreds();
  if (creds) {
    creds.jwtSecret = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(AUTH_FILE, JSON.stringify(creds, null, 2), { mode: 0o600 });
    credsCache = creds;
  }
  res.json({ ok: true });
}

function requireAuth(req, res, next) {
  if (AUTH_DISABLED) {
    req.user = 'external';
    return next();
  }
  const payload = verifyToken(extractToken(req));
  if (payload) {
    req.user = payload.sub;
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function socketAuth(socket, next) {
  if (AUTH_DISABLED) return next();
  const payload = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
  if (payload) return next();
  next(new Error('Unauthorized'));
}

module.exports = { requireAuth, socketAuth, statusHandler, signupHandler, loginHandler, logoutHandler };
