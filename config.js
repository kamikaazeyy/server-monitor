// Strict environment configuration.
//
// Every env var the app reads is parsed and validated here, once, at
// startup. Invalid values never silently pass through: they either fall
// back to a safe default with a warning (non-critical settings) or abort
// startup (settings that would produce a broken or insecure deployment).

function warn(msg) {
  console.warn(`[config] ${msg}`);
}

function die(msg) {
  console.error(`[config] ${msg}`);
  process.exit(1);
}

function int(name, def, { min = -Infinity, max = Infinity } = {}) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || String(n) !== raw.trim()) {
    warn(`${name}="${raw}" is not an integer — using default ${def}`);
    return def;
  }
  if (n < min || n > max) {
    warn(`${name}=${n} out of range [${min}, ${max}] — using default ${def}`);
    return def;
  }
  return n;
}

function bool(name, def) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return def;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  warn(`${name}="${raw}" is not "true"/"false" — using default ${def}`);
  return def;
}

function str(name, def, { pattern, patternHint, allowEmpty = false } = {}) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  if (raw === '' && !allowEmpty) {
    warn(`${name} is empty — using default`);
    return def;
  }
  if (pattern && raw !== '' && !pattern.test(raw)) {
    warn(`${name}="${raw}" is invalid (${patternHint || 'bad format'}) — ignored`);
    return def;
  }
  return raw;
}

// PORT is fail-fast: falling back to 3000 after asking for something else
// could silently rebind on an unintended port.
let PORT = 3000;
const rawPort = process.env.PORT;
if (rawPort !== undefined && rawPort !== '') {
  const parsed = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535 || String(parsed) !== rawPort.trim()) {
    die(`PORT="${rawPort}" is not a valid TCP port (1-65535) — refusing to start on an unintended port.`);
  }
  PORT = parsed;
}

const HOST = str('HOST', '127.0.0.1', {
  pattern: /^[a-zA-Z0-9.\-_*:]+$/,
  patternHint: 'expected an IP literal or hostname',
});

const MONITOR_REPO = str('MONITOR_REPO', '', {
  pattern: /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/,
  patternHint: 'expected owner/repo',
  allowEmpty: true,
});

const CLIENT_ORIGIN = str('CLIENT_ORIGIN', '', {
  pattern: /^https?:\/\/[a-zA-Z0-9.\-]+(:[0-9]{1,5})?$/,
  patternHint: 'expected http(s)://host[:port]',
  allowEmpty: true,
});

module.exports = {
  port: PORT,
  host: HOST,
  monitorRepo: MONITOR_REPO,
  clientOrigin: CLIENT_ORIGIN,
  authDisabled: process.env.MONITOR_AUTH_DISABLED === 'true',
  authFile: process.env.AUTH_FILE || '',
  enableBuilds: process.env.ENABLE_BUILDS
    ? process.env.ENABLE_BUILDS === 'true'
    : !!process.env.EXPO_TOKEN,
  expoToken: process.env.EXPO_TOKEN || '',
  easProjectDir: process.env.EAS_PROJECT_DIR || process.env.FITSO_MOBILE_DIR || '',
  buildsDir: process.env.BUILDS_DIR || '/opt/monitoring-builds',
  buildsKeep: int('BUILDS_KEEP', 10, { min: 1, max: 1000 }),
  dbReadOnly: process.env.DB_READONLY !== 'false',
  dbPoolMax: int('DB_POOL_MAX', 5, { min: 1, max: 100 }),
  dbPoolIdleTimeout: int('DB_POOL_IDLE_TIMEOUT', 600000, { min: 1000, max: 3600000 }),
  terminalMaxSessions: int('TERMINAL_MAX_SESSIONS', 10, { min: 1, max: 1000 }),
  terminalMaxPerIp: int('TERMINAL_MAX_PER_IP', 3, { min: 1, max: 100 }),
  terminalAllowRoot: process.env.TERMINAL_ALLOW_ROOT === 'true',
};
