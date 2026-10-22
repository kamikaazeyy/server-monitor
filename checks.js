// Checks engine — turns raw metrics into health states.
//
// Modelled on Checkmk's core concepts, scaled to a single host:
// - Every check produces a state: ok | warn | crit | unknown.
// - Non-OK states are SOFT until observed `attempts` times in a row
//   (max_check_attempts) — only then does the hard state flip and an
//   event get logged. Recovery to ok is immediate.
// - Thresholds come from config.thresholds (env THRESHOLDS JSON) with
//   the built-in defaults below as fallback.
// - HTTP targets (config.checkTargets) get two checks each: endpoint
//   reachability/status and TLS certificate days-to-expiry.
// - Hard transitions are appended to an events log (JSONL) and pushed
//   to socket clients via the onEvent callback.

const fsp = require('fs/promises');
const path = require('path');
const http = require('http');
const https = require('https');
const tls = require('tls');
const { EventEmitter } = require('events');
const config = require('./config');

const TICK_MS = 5000;
const EVENTS_KEEP = 500;

const DEFAULT_THRESHOLDS = {
  cpu: { warn: 85, crit: 97 },
  load: { warn: 2, crit: 4 },      // load1 per core
  memory: { warn: 90, crit: 97 },
  disk: { warn: 85, crit: 95 },
};

// Severity rank: anything worse than the current state only promotes
// after `attempts` consecutive observations; recovery is immediate.
const RANK = { ok: 0, warn: 1, unknown: 2, crit: 3 };

function threshold(key, level) {
  const t = config.thresholds[key];
  return (t && t[level] !== undefined) ? t[level] : DEFAULT_THRESHOLDS[key][level];
}

function levelFor(key, value) {
  if (value >= threshold(key, 'crit')) return 'crit';
  if (value >= threshold(key, 'warn')) return 'warn';
  return 'ok';
}

function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'target';
}

function pct(v) { return `${v.toFixed(1)}%`; }

// --- HTTP/TLS probe -------------------------------------------------

function probeTarget(target) {
  const timeoutMs = (target.timeout || 10) * 1000;
  const mod = target.url.startsWith('https:') ? https : http;
  const started = Date.now();
  return new Promise((resolve, reject) => {
    // agent: false → fresh TLS context per probe, so session resumption
    // can't return a handshake with no peer certificate.
    const req = mod.get(target.url, { timeout: timeoutMs, rejectUnauthorized: true, agent: false }, (res) => {
      res.resume(); // drain so the socket frees
      let certDays = null;
      const sock = tlsSocket || res.socket;
      if (sock && typeof sock.getPeerCertificate === 'function') {
        try {
          const cert = sock.getPeerCertificate();
          if (cert && cert.valid_to) {
            certDays = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
          }
        } catch { /* cert info optional */ }
      }
      resolve({ status: res.statusCode || 0, ms: Date.now() - started, certDays });
    });
    let tlsSocket = null;
    req.on('socket', (s) => { tlsSocket = s; });
    req.on('timeout', () => { req.destroy(new Error(`timeout after ${target.timeout || 10}s`)); });
    req.on('error', (err) => reject(err));
  });
}

// Cert expiry via a dedicated TLS handshake — independent of the HTTP
// probe so response/socket lifecycle can't lose the peer certificate.
function probeCertDays(url, timeoutSec) {
  const u = new URL(url);
  const timeoutMs = (timeoutSec || 10) * 1000;
  return new Promise((resolve, reject) => {
    const sock = tls.connect(
      {
        host: u.hostname,
        port: u.port ? Number(u.port) : 443,
        servername: u.hostname,
        rejectUnauthorized: false,
        timeout: timeoutMs,
      },
      () => {
        const cert = sock.getPeerCertificate();
        sock.end();
        if (!cert || !cert.valid_to) return reject(new Error('no certificate presented'));
        resolve(Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000));
      }
    );
    sock.on('timeout', () => sock.destroy(new Error(`timeout after ${timeoutSec || 10}s`)));
    sock.on('error', (err) => reject(err));
  });
}

// --- Event log ------------------------------------------------------

const events = [];
let eventsFile = null;
let eventWriteChain = Promise.resolve();

async function loadEvents() {
  try {
    const text = await fsp.readFile(eventsFile, 'utf8');
    const lines = text.split('\n').filter(Boolean);
    for (const line of lines.slice(-EVENTS_KEEP)) {
      try {
        const e = JSON.parse(line);
        if (e && typeof e.t === 'number') events.push(e);
      } catch { /* skip bad lines */ }
    }
  } catch { /* no events file yet */ }
}

function logEvent(evt) {
  events.push(evt);
  while (events.length > EVENTS_KEEP) events.shift();
  const line = JSON.stringify(evt) + '\n';
  eventWriteChain = eventWriteChain
    .then(() => fsp.appendFile(eventsFile, line))
    .catch((err) => console.warn('[checks] event write failed:', err.message));
}

// --- Engine ---------------------------------------------------------

function createEngine({ snapshot, containers, failedServices, onEvent }) {
  const bus = new EventEmitter();
  const defs = [];
  const probeCache = new Map(); // slug -> {t, result|error}

  function threshCheck({ id, name, every, attempts, metric, unit, read }) {
    return {
      id, name, category: 'system', every, attempts,
      async evaluate() {
        const snap = snapshot();
        const v = read(snap);
        if (v == null || Number.isNaN(v)) return { state: 'unknown', summary: 'no data', value: v };
        return {
          state: levelFor(metric, v),
          value: v,
          summary: `${unit === '%' ? pct(v) : v.toFixed(2)} (warn ≥ ${threshold(metric, 'warn')}${unit === '%' ? '%' : ''}, crit ≥ ${threshold(metric, 'crit')}${unit === '%' ? '%' : ''})`,
        };
      },
    };
  }

  // --- system metric checks ---
  defs.push(
    threshCheck({
      id: 'cpu', name: 'CPU usage', every: 15, attempts: 4, metric: 'cpu', unit: '%',
      read: (s) => s.cpu && !s.cpu.error ? s.cpu.usage : null,
    }),
    threshCheck({
      id: 'load', name: 'CPU load (per core)', every: 15, attempts: 4, metric: 'load', unit: '',
      read: (s) => {
        if (!s.cpu || s.cpu.error || !s.cpu.cores) return null;
        const load1 = s.cpu.load && s.cpu.load[0];
        return typeof load1 === 'number' ? load1 / s.cpu.cores : null;
      },
    }),
    threshCheck({
      id: 'memory', name: 'Memory usage', every: 15, attempts: 4, metric: 'memory', unit: '%',
      read: (s) => (s.memory ? s.memory.percent : null),
    }),
    threshCheck({
      id: 'disk', name: 'Disk usage (/)', every: 60, attempts: 2, metric: 'disk', unit: '%',
      read: (s) => (s.disk && !s.disk.error ? s.disk.percent : null),
    }),
  );

  // --- systemd failed units ---
  defs.push({
    id: 'systemd.failed', name: 'Failed systemd units', category: 'services',
    every: 60, attempts: 2,
    async evaluate() {
      const data = await failedServices();
      if (!data || data.error) return { state: 'unknown', summary: `systemctl unavailable${data && data.error ? `: ${data.error}` : ''}` };
      const failed = data.failed || [];
      if (failed.length === 0) return { state: 'ok', summary: 'no failed units', value: 0 };
      const names = failed.slice(0, 5).map(u => {
        const r = u.nRestarts != null ? ` (${u.nRestarts} restarts)` : '';
        return `${u.unit}${r}`;
      }).join(', ');
      return {
        state: 'crit',
        value: failed.length,
        summary: `${failed.length} failed: ${names}${failed.length > 5 ? ` +${failed.length - 5} more` : ''}`,
      };
    },
  });

  // --- docker container health ---
  defs.push({
    id: 'docker.containers', name: 'Container health', category: 'containers',
    every: 60, attempts: 2,
    async evaluate() {
      const list = await containers();
      if (!list || list.error) {
        return { state: 'unknown', summary: `docker unavailable${list && list.error ? `: ${list.error}` : ''}` };
      }
      if (!Array.isArray(list)) return { state: 'unknown', summary: 'unexpected docker response' };
      const dead = [];
      const restarting = [];
      const stopped = [];
      for (const c of list) {
        const st = (c.state || '').toLowerCase();
        if (st === 'restarting') restarting.push(c.name);
        else if (st === 'dead') dead.push(c.name);
        else if (st === 'exited' || st === 'created' || st === 'paused') stopped.push(`${c.name} (${c.status || st})`);
      }
      const problems = [...dead, ...restarting, ...stopped];
      if (problems.length === 0) return { state: 'ok', summary: `${list.length} containers running`, value: 0 };
      const shown = problems.slice(0, 5).join(', ');
      const extra = problems.length > 5 ? ` +${problems.length - 5} more` : '';
      return {
        state: dead.length || restarting.length ? 'crit' : 'warn',
        value: problems.length,
        summary: `${problems.length} not running: ${shown}${extra}`,
      };
    },
  });

  // --- HTTP endpoint + TLS checks ---
  async function probe(slug, target) {
    const cached = probeCache.get(slug);
    const interval = (target.interval || 300) * 1000;
    if (cached && Date.now() - cached.t < interval) return cached;
    const entry = { t: Date.now() };
    try {
      entry.result = await probeTarget(target);
    } catch (err) {
      entry.error = err;
    }
    probeCache.set(slug, entry);
    return entry;
  }

  for (const target of config.checkTargets) {
    const slug = slugify(target.name);
    const expect = target.expectStatus;
    defs.push({
      id: `http.${slug}`, name: `Endpoint ${target.name}`, category: 'endpoints',
      every: Math.max(30, target.interval || 300), attempts: 2,
      async evaluate() {
        const p = await probe(slug, target);
        if (p.error || !p.result) {
          return { state: 'crit', summary: `unreachable: ${p.error ? p.error.message : 'no response'}` };
        }
        const ok = expect !== undefined ? p.result.status === expect : (p.result.status >= 200 && p.result.status < 300);
        return ok
          ? { state: 'ok', summary: `HTTP ${p.result.status} in ${p.result.ms}ms`, value: p.result.ms }
          : { state: 'crit', summary: `HTTP ${p.result.status}${expect !== undefined ? ` (expected ${expect})` : ''} in ${p.result.ms}ms`, value: p.result.ms };
      },
    });
    if (target.url.startsWith('https:')) {
      defs.push({
        id: `tls.${slug}`, name: `TLS cert ${target.name}`, category: 'endpoints',
        every: Math.max(30, target.interval || 300), attempts: 2,
        async evaluate() {
          let d;
          try {
            d = await probeCertDays(target.url, target.timeout);
          } catch (err) {
            return { state: 'unknown', summary: `cannot read certificate: ${err.message}` };
          }
          const state = d < 7 ? 'crit' : d < 14 ? 'warn' : 'ok';
          return { state, value: d, summary: `expires in ${d} day${d === 1 ? '' : 's'}` };
        },
      });
    }
  }

  // --- runtime state per check ---
  const runtime = new Map();
  for (const def of defs) {
    runtime.set(def.id, {
      def, state: 'ok', pending: null, consec: 0,
      summary: 'pending first evaluation', value: null,
      since: Date.now(), lastRun: 0, lastOkAt: null,
    });
  }

  async function evaluateCheck(rt) {
    let observed;
    try {
      observed = await rt.def.evaluate();
    } catch (err) {
      observed = { state: 'unknown', summary: `check error: ${err.message}` };
    }
    if (!observed || !RANK.hasOwnProperty(observed.state)) {
      observed = { state: 'unknown', summary: 'check returned invalid result' };
    }

    rt.summary = observed.summary || '';
    rt.value = observed.value !== undefined ? observed.value : null;

    if (observed.state === 'ok') {
      if (rt.state !== 'ok') transition(rt, 'ok', observed.summary);
      rt.consec = 0;
      rt.pending = null;
      rt.lastOkAt = Date.now();
      return;
    }

    // Worsening (or worsening-to-different-state) path — soft until it
    // survives `attempts` consecutive observations.
    if (observed.state === rt.state && !rt.pending) {
      rt.consec = 0;
      return;
    }
    rt.pending = observed.state;
    rt.consec += 1;
    if (rt.consec >= rt.def.attempts) {
      rt.consec = 0;
      rt.pending = null;
      if (observed.state !== rt.state) transition(rt, observed.state, observed.summary);
    }
  }

  function transition(rt, to, summary) {
    const evt = { t: Date.now(), id: rt.def.id, name: rt.def.name, from: rt.state, to, summary: summary || '' };
    rt.state = to;
    rt.since = evt.t;
    logEvent(evt);
    bus.emit('transition', evt);
    if (onEvent) onEvent(evt);
  }

  async function tick() {
    const now = Date.now();
    for (const rt of runtime.values()) {
      if (now - rt.lastRun < rt.def.every * 1000) continue;
      rt.lastRun = now;
      try {
        await evaluateCheck(rt);
      } catch (err) {
        console.warn(`[checks] ${rt.def.id} failed:`, err.message);
      }
    }
  }

  function list() {
    const checks = [];
    const summary = { ok: 0, warn: 0, crit: 0, unknown: 0 };
    for (const rt of runtime.values()) {
      summary[rt.state]++;
      checks.push({
        id: rt.def.id,
        name: rt.def.name,
        category: rt.def.category,
        state: rt.state,
        pending: rt.pending,
        attempts: { count: rt.consec, needed: rt.def.attempts },
        intervalSec: rt.def.every,
        summary: rt.summary,
        value: rt.value,
        since: rt.since,
        lastOkAt: rt.lastOkAt,
      });
    }
    return { summary, checks, updatedAt: Date.now() };
  }

  function getEvents(limit) {
    const n = Math.min(Math.max(1, limit || 100), EVENTS_KEEP);
    return events.slice(-n).reverse();
  }

  const timer = setInterval(tick, TICK_MS);
  if (timer.unref) timer.unref();
  tick();

  return { list, events: getEvents, bus, stop: () => clearInterval(timer) };
}

async function init() {
  try {
    await fsp.mkdir(config.dataDir, { recursive: true });
    eventsFile = path.join(config.dataDir, 'events.jsonl');
    await loadEvents();
  } catch (err) {
    console.warn(`[checks] cannot create ${config.dataDir} (${err.message}) — event log will be memory-only`);
    eventsFile = null;
  }
}

module.exports = { init, createEngine };
