// Persistent metric history.
//
// monitor.js samples every second; this module rolls those samples into
// one aggregate point per minute and appends it to a per-day JSONL file
// under DATA_DIR/history/. Files older than HISTORY_COMPACT_AFTER_HOURS
// are compacted to 5-minute resolution; files older than
// HISTORY_RETENTION_DAYS are deleted. Loaded files are served from an
// in-memory index so range queries don't touch disk.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const config = require('./config');

const RESOLUTION_MS = 60_000;              // live write resolution: 1 point/min
const COMPACT_RESOLUTION_MS = 300_000;     // compacted resolution: 1 point/5min
const FILE_RE = /^history-(\d{4}-\d{2}-\d{2})\.jsonl$/;

const retentionMs = config.historyRetentionDays * 86_400_000;
const compactAfterMs = config.historyCompactAfterHours * 3_600_000;

let dir = null;
let points = [];          // [{t,cpu,mem,disk,rx,tx}] sorted by t — all retained data
let bucket = null;        // current minute accumulator
let writeChain = Promise.resolve();
let ready = false;

function fileNameFor(ts) {
  const d = new Date(ts);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `history-${y}-${m}-${day}.jsonl`;
}

function parseLine(line) {
  try {
    const p = JSON.parse(line);
    if (typeof p.t !== 'number') return null;
    return {
      t: p.t,
      cpu: +p.cpu || 0,
      mem: +p.mem || 0,
      disk: p.disk == null ? null : +p.disk,
      rx: +p.rx || 0,
      tx: +p.tx || 0,
    };
  } catch {
    return null;
  }
}

function toApiPoint(p) {
  return {
    time: p.t,
    cpu: p.cpu,
    memory: p.mem,
    disk: p.disk,
    networkRx: p.rx,
    networkTx: p.tx,
  };
}

function appendLine(line) {
  writeChain = writeChain
    .then(() => fsp.appendFile(path.join(dir, fileNameFor(Date.now())), line))
    .catch((err) => console.warn('[history] write failed:', err.message));
}

async function load() {
  const cutoff = Date.now() - retentionMs;
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => FILE_RE.test(f)).sort();
  } catch (err) {
    console.warn('[history] cannot read data dir:', err.message);
  }
  const loaded = [];
  for (const file of files) {
    try {
      const text = await fsp.readFile(path.join(dir, file), 'utf8');
      for (const line of text.split('\n')) {
        if (!line) continue;
        const p = parseLine(line);
        if (p && p.t >= cutoff) loaded.push(p);
      }
    } catch (err) {
      console.warn(`[history] cannot read ${file}:`, err.message);
    }
  }
  loaded.sort((a, b) => a.t - b.t);
  points = loaded;
}

// Compact files older than compactAfterMs to COMPACT_RESOLUTION_MS
// buckets (mean per bucket) and delete files past the retention window.
async function compact() {
  const now = Date.now();
  let files = [];
  try {
    files = (await fsp.readdir(dir)).filter((f) => FILE_RE.test(f));
  } catch {
    return;
  }
  for (const file of files) {
    const filePath = path.join(dir, file);
    const dayStart = Date.parse(`${FILE_RE.exec(file)[1]}T00:00:00Z`);
    if (dayStart + 86_400_000 < now - retentionMs) {
      await fsp.unlink(filePath).catch(() => {});
      continue;
    }
    if (dayStart + 86_400_000 >= now - compactAfterMs) continue;
    try {
      const text = await fsp.readFile(filePath, 'utf8');
      const buckets = new Map();
      for (const line of text.split('\n')) {
        if (!line) continue;
        const p = parseLine(line);
        if (!p) continue;
        const key = Math.floor(p.t / COMPACT_RESOLUTION_MS);
        let b = buckets.get(key);
        if (!b) { b = { n: 0, cpu: 0, mem: 0, disk: 0, diskN: 0, rx: 0, tx: 0 }; buckets.set(key, b); }
        b.n++;
        b.cpu += p.cpu; b.mem += p.mem; b.rx += p.rx; b.tx += p.tx;
        if (p.disk != null) { b.disk += p.disk; b.diskN++; }
      }
      const out = [];
      for (const [key, b] of [...buckets.entries()].sort((a, b2) => a[0] - b2[0])) {
        out.push(JSON.stringify({
          t: key * COMPACT_RESOLUTION_MS,
          cpu: +(b.cpu / b.n).toFixed(2),
          mem: +(b.mem / b.n).toFixed(2),
          disk: b.diskN ? +(b.disk / b.diskN).toFixed(2) : null,
          rx: Math.round(b.rx / b.n),
          tx: Math.round(b.tx / b.n),
        }));
      }
      const tmp = `${filePath}.tmp`;
      await fsp.writeFile(tmp, out.join('\n') + (out.length ? '\n' : ''));
      await fsp.rename(tmp, filePath);
    } catch (err) {
      console.warn(`[history] compaction of ${file} failed:`, err.message);
    }
  }
}

// Called once per second by monitor.js with the latest sample. Rolls a
// completed minute into a persisted aggregate point.
function record(sample) {
  if (!ready || !sample || typeof sample.time !== 'number') return;
  const minute = Math.floor(sample.time / RESOLUTION_MS);
  if (!bucket || bucket.minute !== minute) {
    flush();
    bucket = { minute, n: 0, cpu: 0, mem: 0, disk: 0, diskN: 0, rx: 0, tx: 0 };
  }
  bucket.n++;
  bucket.cpu += sample.cpu || 0;
  bucket.mem += sample.memory || 0;
  bucket.rx += sample.networkRx || 0;
  bucket.tx += sample.networkTx || 0;
  if (sample.disk != null) { bucket.disk += sample.disk; bucket.diskN++; }
}

// Write the current minute bucket (also called on shutdown so the last
// partial minute isn't lost).
function flush() {
  if (!bucket || bucket.n === 0) return;
  const b = bucket;
  bucket = null;
  const p = {
    t: b.minute * RESOLUTION_MS,
    cpu: +(b.cpu / b.n).toFixed(2),
    mem: +(b.mem / b.n).toFixed(2),
    disk: b.diskN ? +(b.disk / b.diskN).toFixed(2) : null,
    rx: Math.round(b.rx / b.n),
    tx: Math.round(b.tx / b.n),
  };
  points.push(p);
  // Keep the in-memory index inside the retention window.
  const cutoff = Date.now() - retentionMs;
  while (points.length && points[0].t < cutoff) points.shift();
  appendLine(JSON.stringify(p) + '\n');
}

function getRange(rangeMs) {
  const cutoff = Date.now() - rangeMs;
  const out = [];
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i].t < cutoff) break;
    out.push(toApiPoint(points[i]));
  }
  return out.reverse();
}

async function init() {
  dir = path.join(config.dataDir, 'history');
  try {
    await fsp.mkdir(dir, { recursive: true });
  } catch (err) {
    console.warn(`[history] cannot create ${dir} (${err.message}) — history persistence disabled`);
    return;
  }
  ready = true;
  await load();
  compact();  // fire-and-forget at boot, then daily
  const daily = setInterval(compact, 86_400_000);
  if (daily.unref) daily.unref();
}

module.exports = { init, record, flush, getRange };
