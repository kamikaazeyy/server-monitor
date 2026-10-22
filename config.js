const path = require('path');

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

// CHECK_TARGETS: JSON array of HTTP endpoints the checks engine probes.
// Each entry: { name, url, expectStatus?, interval?, timeout? } — name
// (display label), url (http/https), expectStatus (default: any 2xx),
// interval in seconds between probes (default 300), per-probe timeout
// in seconds (default 10). Invalid entries are skipped with a warning.
function parseCheckTargets() {
  const raw = process.env.CHECK_TARGETS;
  if (raw === undefined || raw === '') return [];
  let list;
  try {
    list = JSON.parse(raw);
  } catch {
    warn('CHECK_TARGETS is not valid JSON — no HTTP checks configured');
    return [];
  }
  if (!Array.isArray(list)) {
    warn('CHECK_TARGETS must be a JSON array — no HTTP checks configured');
    return [];
  }
  const targets = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') { warn('CHECK_TARGETS: skipping non-object entry'); continue; }
    const name = String(item.name || '').trim();
    const url = String(item.url || '').trim();
    if (!/^[\w .\/-]{1,60}$/.test(name)) { warn(`CHECK_TARGETS: skipping entry with bad name "${name}"`); continue; }
    let parsed;
    try { parsed = new URL(url); } catch { warn(`CHECK_TARGETS: "${name}" has an invalid URL — skipped`); continue; }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      warn(`CHECK_TARGETS: "${name}" URL must be http(s) — skipped`);
      continue;
    }
    const t = { name, url: parsed.toString() };
    if (item.expectStatus !== undefined) {
      const s = Number(item.expectStatus);
      if (!Number.isInteger(s) || s < 100 || s > 599) { warn(`CHECK_TARGETS: "${name}" bad expectStatus — skipped`); continue; }
      t.expectStatus = s;
    }
    if (item.interval !== undefined) {
      const s = Number(item.interval);
      if (!Number.isFinite(s) || s < 30 || s > 86400) { warn(`CHECK_TARGETS: "${name}" interval out of range [30,86400] — skipped`); continue; }
      t.interval = s;
    }
    if (item.timeout !== undefined) {
      const s = Number(item.timeout);
      if (!Number.isFinite(s) || s < 1 || s > 60) { warn(`CHECK_TARGETS: "${name}" timeout out of range [1,60] — skipped`); continue; }
      t.timeout = s;
    }
    targets.push(t);
  }
  return targets;
}

// THRESHOLDS: optional JSON object overriding check thresholds.
// Shape: { "cpu": {"warn": 85, "crit": 97}, "memory": {...}, "disk": {...},
// "load": {...} } — numbers in the check's own unit (% for cpu/memory/disk,
// load-per-core for load). Missing keys keep the built-in defaults.
function parseThresholds() {
  const raw = process.env.THRESHOLDS;
  if (raw === undefined || raw === '') return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    warn('THRESHOLDS is not valid JSON — using built-in defaults');
    return {};
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    warn('THRESHOLDS must be a JSON object — using built-in defaults');
    return {};
  }
  const out = {};
  for (const [key, val] of Object.entries(obj)) {
    if (!val || typeof val !== 'object') { warn(`THRESHOLDS.${key}: not an object — ignored`); continue; }
    const entry = {};
    for (const lvl of ['warn', 'crit']) {
      if (val[lvl] !== undefined) {
        const n = Number(val[lvl]);
        if (!Number.isFinite(n) || n < 0) { warn(`THRESHOLDS.${key}.${lvl}: invalid — ignored`); continue; }
        entry[lvl] = n;
      }
    }
    if (Object.keys(entry).length) out[key] = entry;
  }
  return out;
}

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
  // Persistent metric history + check/event state files. The service
  // user needs write access to this directory.
  dataDir: process.env.DATA_DIR || path.join(__dirname, 'data'),
  historyRetentionDays: int('HISTORY_RETENTION_DAYS', 30, { min: 1, max: 365 }),
  historyCompactAfterHours: int('HISTORY_COMPACT_AFTER_HOURS', 48, { min: 1, max: 720 }),
  checkTargets: parseCheckTargets(),
  thresholds: parseThresholds(),
};
