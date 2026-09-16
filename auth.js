const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const jwt = require('jsonwebtoken');

// Credentials live in .auth.json next to this file: { username, salt, hash,
// jwtSecret, createdAt }. Created once via the signup endpoint; deleting it
// (scripts/reset-auth.sh) re-opens signup.
const AUTH_FILE = process.env.AUTH_FILE || path.join(__dirname, '.auth.json');
const TOKEN_TTL = '30d';
const SCRYPT_KEYLEN = 64;
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,32}$/;

function loadCreds() {
  try {
    return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
  } catch {
    return null;
  }
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, SCRYPT_KEYLEN).toString('hex');
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
    return jwt.verify(raw, creds.jwtSecret);
  } catch {
    return null;
  }
}

function extractToken(req) {
  const header = req.headers.authorization;
  if (header && header.startsWith('Bearer ')) return header.slice(7);
  // Query param allowed so browser download links / QR codes can authenticate.
  if (typeof req.query.token === 'string' && req.query.token) return req.query.token;
  return null;
}

function statusHandler(req, res) {
  const creds = loadCreds();
  res.json({ needsSetup: !creds, username: creds ? creds.username : null });
}

function signupHandler(req, res) {
  const { username, password } = req.body || {};
  const name = typeof username === 'string' ? username.trim() : '';
  if (!USERNAME_RE.test(name)) {
    return res.status(400).json({ error: 'Username must be 3-32 chars: letters, numbers, . _ -' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  const salt = crypto.randomBytes(16).toString('hex');
  const record = {
    username: name,
    salt,
    hash: hashPassword(password, salt),
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

  res.json({ token: issueToken(name, record.jwtSecret), username: name });
}

async function loginHandler(req, res) {
  const creds = loadCreds();
  if (!creds) {
    return res.status(400).json({ error: 'No account yet — complete setup first' });
  }
  const { username, password } = req.body || {};
  const ok =
    safeEqual(String(username || '').trim(), creds.username) &&
    safeEqual(hashPassword(password || '', creds.salt), creds.hash);
  if (ok) {
    return res.json({ token: issueToken(creds.username, creds.jwtSecret), username: creds.username });
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  res.status(401).json({ error: 'Invalid username or password' });
}

function requireAuth(req, res, next) {
  const payload = verifyToken(extractToken(req));
  if (payload) {
    req.user = payload.sub;
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
}

function socketAuth(socket, next) {
  const payload = verifyToken(socket.handshake.auth && socket.handshake.auth.token);
  if (payload) return next();
  next(new Error('Unauthorized'));
}

module.exports = { requireAuth, socketAuth, statusHandler, signupHandler, loginHandler };
