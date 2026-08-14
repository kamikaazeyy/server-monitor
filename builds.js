const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const express = require('express');

const BUILDS_DIR = process.env.BUILDS_DIR || '/opt/monitoring-dashboard/builds';
const BUILDS_KEEP = parseInt(process.env.BUILDS_KEEP || '10', 10);
const FITSO_MOBILE_DIR = process.env.FITSO_MOBILE_DIR || '/home/kamikaazeyy/fitso/mobile';
const EAS_TOKEN = process.env.EXPO_TOKEN;
const LOG_BUFFER_CAP = 2000;
const POLL_INTERVAL_MS = 30000;
const POLL_MAX_ATTEMPTS = 60; // 30 minutes cap

if (!EAS_TOKEN) {
  console.warn('[builds] EXPO_TOKEN not set — EAS build endpoints will be degraded (local history still served)');
}

try {
  fs.mkdirSync(BUILDS_DIR, { recursive: true });
} catch (err) {
  console.error(`[builds] Failed to create BUILDS_DIR ${BUILDS_DIR}:`, err.message);
}

// --- In-memory state --------------------------------------------------------

/** @type {Map<string, string[]>} buildId -> ring buffer of "stream|line" entries */
const logBuffers = new Map();

// --- Path helpers ------------------------------------------------------------

function getIndexPath() { return path.join(BUILDS_DIR, 'index.json'); }
function getApkPath(buildId) { return path.join(BUILDS_DIR, `${buildId}.apk`); }
function getLogFilePath(buildId) { return path.join(BUILDS_DIR, `${buildId}.log`); }

// --- Index persistence -------------------------------------------------------

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(getIndexPath(), 'utf8'));
  } catch {
    return [];
  }
}

function writeIndex(entries) {
  const tmp = getIndexPath() + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(entries, null, 2));
  fs.renameSync(tmp, getIndexPath());
}

function upsertIndexEntry(entry) {
  const index = readIndex();
  const idx = index.findIndex(e => e.easBuildId === entry.easBuildId);
  if (idx >= 0) {
    index[idx] = { ...index[idx], ...entry };
  } else {
    index.push(entry);
  }
  writeIndex(index);
}

function updateIndexEntry(buildId, updates) {
  const index = readIndex();
  const idx = index.findIndex(e => e.easBuildId === buildId);
  if (idx >= 0) {
    index[idx] = { ...index[idx], ...updates };
    writeIndex(index);
  }
}

// --- Log helpers -------------------------------------------------------------

function maskSecrets(line) {
  return line
    .replace(/EXPO_TOKEN[=:]\s*\S+/gi, 'EXPO_TOKEN=***')
    .replace(/Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi, 'Bearer ***');
}

function appendLog(buildId, line, stream) {
  const masked = maskSecrets(String(line));
  let buf = logBuffers.get(buildId);
  if (!buf) { buf = []; logBuffers.set(buildId, buf); }
  buf.push(`${stream}|${masked}`);
  if (buf.length > LOG_BUFFER_CAP) buf.shift();
  try {
    fs.appendFileSync(getLogFilePath(buildId), `${stream}|${masked}\n`);
  } catch (err) {
    console.error(`[builds] Failed to append log for ${buildId}:`, err.message);
  }
}

function readLogFile(buildId) {
  try {
    return fs.readFileSync(getLogFilePath(buildId), 'utf8');
  } catch {
    return '';
  }
}

// --- EAS command helper (execFile for JSON commands) -------------------------

function runEas(args, options = {}) {
  return new Promise((resolve, reject) => {
    const env = { ...process.env, EXPO_TOKEN: EAS_TOKEN };
    execFile('eas', args, {
      cwd: FITSO_MOBILE_DIR,
      env,
      maxBuffer: 10 * 1024 * 1024,
      ...options,
    }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr?.trim() || err.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

// --- Socket.io emit helpers --------------------------------------------------

function emitLog(io, buildId, line, stream) {
  appendLog(buildId, line, stream);
  io.to(`build:${buildId}`).emit('build:log', { buildId, line: maskSecrets(line), stream });
}

function emitStatus(io, buildId, status, extra = {}) {
  io.to(`build:${buildId}`).emit('build:status', { buildId, status, ...extra });
}

function emitProgress(io, buildId, received, total) {
  io.to(`build:${buildId}`).emit('build:progress', { buildId, received, total });
}

// --- Artifact download -------------------------------------------------------

function downloadArtifact(io, buildId, artifactUrl) {
  return new Promise((resolve, reject) => {
    const apkPath = getApkPath(buildId);
    const partPath = apkPath + '.part';
    const file = fs.createWriteStream(partPath);
    const protocol = artifactUrl.startsWith('https') ? https : http;

    const req = protocol.get(artifactUrl, (response) => {
      if (response.statusCode !== 200) {
        file.close();
        try { fs.unlinkSync(partPath); } catch {}
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      const total = parseInt(response.headers['content-length'] || '0', 10);
      let received = 0;

      response.on('data', (chunk) => {
        received += chunk.length;
        emitProgress(io, buildId, received, total);
      });

      response.pipe(file);

      file.on('finish', () => {
        file.close(() => {
          try {
            fs.renameSync(partPath, apkPath);
          } catch (err) {
            reject(new Error(`Failed to finalize download: ${err.message}`));
            return;
          }
          let sizeBytes = 0;
          try {
            sizeBytes = fs.statSync(apkPath).size;
          } catch {}
          upsertIndexEntry({
            id: buildId,
            easBuildId: buildId,
            sizeBytes,
            downloadedAt: new Date().toISOString(),
            status: 'downloaded',
          });
          emitStatus(io, buildId, 'downloaded', { sizeBytes });
          pruneBuilds();
          resolve(sizeBytes);
        });
      });

      file.on('error', (err) => {
        file.close();
        try { fs.unlinkSync(partPath); } catch {}
        reject(err);
      });
    });

    req.on('error', (err) => {
      file.close();
      try { fs.unlinkSync(partPath); } catch {}
      reject(err);
    });
  });
}

// --- Build status polling ----------------------------------------------------

function pollBuildStatus(io, buildId) {
  let attempts = 0;
  let lastStatus = null;

  const poll = async () => {
    if (attempts >= POLL_MAX_ATTEMPTS) {
      emitLog(io, buildId, 'Polling timed out after 30 minutes — check EAS dashboard manually', 'stderr');
      return;
    }
    attempts++;

    try {
      const raw = await runEas(['build:view', buildId, '--json', '--non-interactive']);
      const b = JSON.parse(raw);
      const status = (b.status || '').toLowerCase();

      if (status !== lastStatus) {
        lastStatus = status;
        emitStatus(io, buildId, status);
        emitLog(io, buildId, `Status: ${b.status}`, 'stdout');
      }

      if (status === 'finished') {
        const artifactUrl = b.artifacts?.artifactUrl;
        if (!artifactUrl) {
          emitLog(io, buildId, 'Build finished but no artifact URL found', 'stderr');
          return;
        }
        // Persist metadata before download
        upsertIndexEntry({
          id: buildId,
          easBuildId: buildId,
          gitCommitHash: b.gitCommitHash || '',
          branch: b.gitBranch || b.channel || '',
          profile: b.buildProfile || '',
          appVersion: b.appVersion || '',
          sizeBytes: 0,
          createdAt: b.createdAt || new Date().toISOString(),
          downloadedAt: null,
          status: 'finished',
        });
        emitStatus(io, buildId, 'downloading');
        emitLog(io, buildId, `Downloading artifact from ${artifactUrl}`, 'stdout');
        try {
          const size = await downloadArtifact(io, buildId, artifactUrl);
          emitLog(io, buildId, `Artifact downloaded successfully (${size} bytes)`, 'stdout');
        } catch (err) {
          emitLog(io, buildId, `Download failed: ${err.message}`, 'stderr');
        }
        return;
      }

      if (status === 'errored' || status === 'canceled' || status === 'cancelled') {
        emitLog(io, buildId, `Build ${b.status}`, 'stderr');
        upsertIndexEntry({
          id: buildId,
          easBuildId: buildId,
          gitCommitHash: b.gitCommitHash || '',
          branch: b.gitBranch || b.channel || '',
          profile: b.buildProfile || '',
          appVersion: b.appVersion || '',
          sizeBytes: 0,
          createdAt: b.createdAt || new Date().toISOString(),
          downloadedAt: null,
          status,
        });
        return;
      }

      setTimeout(poll, POLL_INTERVAL_MS);
    } catch (err) {
      emitLog(io, buildId, `Poll error: ${err.message}`, 'stderr');
      setTimeout(poll, POLL_INTERVAL_MS);
    }
  };

  setTimeout(poll, POLL_INTERVAL_MS);
}

// --- Pruning -----------------------------------------------------------------

function pruneBuilds() {
  const index = readIndex();
  if (index.length <= BUILDS_KEEP) return;

  const sorted = [...index].sort((a, b) => {
    const aTime = new Date(a.downloadedAt || a.createdAt).getTime();
    const bTime = new Date(b.downloadedAt || b.createdAt).getTime();
    return bTime - aTime;
  });

  const toRemove = sorted.slice(BUILDS_KEEP);
  for (const entry of toRemove) {
    const id = entry.easBuildId;
    try { fs.unlinkSync(getApkPath(id)); } catch {}
    try { fs.unlinkSync(getLogFilePath(id)); } catch {}
    logBuffers.delete(id);
  }

  writeIndex(sorted.slice(0, BUILDS_KEEP));
}

// --- Build mapping helper ----------------------------------------------------

function mapEasBuild(b, localEntry) {
  return {
    id: b.id,
    profile: b.buildProfile,
    platform: b.platform,
    status: b.status,
    distribution: b.distribution,
    buildType: b.buildType,
    sdkVersion: b.sdkVersion,
    appVersion: b.appVersion,
    gitCommitHash: b.gitCommitHash,
    gitCommitMessage: b.gitCommitMessage,
    channel: b.channel,
    message: b.message,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
    artifacts: b.artifacts,
    submissionStatus: b.submissionStatus,
    localApkAvailable: localEntry ? fs.existsSync(getApkPath(b.id)) : false,
    sizeBytes: localEntry?.sizeBytes || null,
    downloadedAt: localEntry?.downloadedAt || null,
  };
}

function mapLocalEntry(e) {
  return {
    id: e.easBuildId,
    profile: e.profile,
    platform: 'android',
    status: e.status,
    distribution: '',
    buildType: '',
    sdkVersion: '',
    appVersion: e.appVersion,
    gitCommitHash: e.gitCommitHash,
    gitCommitMessage: '',
    channel: '',
    message: '',
    createdAt: e.createdAt,
    updatedAt: e.downloadedAt || e.createdAt,
    artifacts: null,
    submissionStatus: null,
    localApkAvailable: fs.existsSync(getApkPath(e.easBuildId)),
    sizeBytes: e.sizeBytes || null,
    downloadedAt: e.downloadedAt || null,
  };
}

// --- Router factory ----------------------------------------------------------

module.exports = function createBuildsRouter(io) {
  const router = express.Router();

  // Socket.io: build room join/leave
  io.on('connection', (socket) => {
    socket.on('build:join', (buildId) => {
      if (typeof buildId !== 'string' || !/^[a-zA-Z0-9-]+$/.test(buildId)) return;
      socket.join(`build:${buildId}`);
    });
    socket.on('build:leave', (buildId) => {
      if (typeof buildId !== 'string') return;
      socket.leave(`build:${buildId}`);
    });
  });

  /**
   * GET /api/builds
   * Merge live EAS list with local index. Degrades to local-only when
   * EXPO_TOKEN is missing or EAS is unreachable.
   */
  router.get('/api/builds', async (req, res) => {
    const localIndex = readIndex();
    const localMap = new Map(localIndex.map(e => [e.easBuildId, e]));

    if (!EAS_TOKEN) {
      return res.json(localIndex.map(mapLocalEntry));
    }

    try {
      const raw = await runEas([
        'build:list',
        '--platform', 'android',
        '--limit', '20',
        '--json',
        '--non-interactive',
      ]);
      const builds = JSON.parse(raw || '[]');
      const mapped = builds.map(b => mapEasBuild(b, localMap.get(b.id)));

      // Include local-only builds not in the EAS list
      const easIds = new Set(builds.map(b => b.id));
      for (const e of localIndex) {
        if (!easIds.has(e.easBuildId)) mapped.push(mapLocalEntry(e));
      }

      res.json(mapped);
    } catch (err) {
      // EAS unreachable — serve local history
      res.json(localIndex.map(mapLocalEntry));
    }
  });

  /**
   * GET /api/builds/:id
   * View a single build by ID.
   */
  router.get('/api/builds/:id', async (req, res) => {
    if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid build ID' });
    }
    try {
      const raw = await runEas(['build:view', id, '--json', '--non-interactive']);
      const b = JSON.parse(raw);
      const localEntry = readIndex().find(e => e.easBuildId === id);
      res.json(mapEasBuild(b, localEntry));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * GET /api/builds/:id/log
   * Returns the build log as plain text (stream|line format per line).
   */
  router.get('/api/builds/:id/log', (req, res) => {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid build ID' });
    }
    const log = readLogFile(id);
    res.type('text/plain').send(log);
  });

  /**
   * GET /api/builds/:id/apk
   * Serve the locally mirrored APK. Validates :id against the index to
   * prevent path traversal. Supports range requests via res.sendFile.
   */
  router.get('/api/builds/:id/apk', (req, res) => {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid build ID' });
    }
    const entry = readIndex().find(e => e.easBuildId === id);
    if (!entry) {
      return res.status(404).json({ error: 'Build not found in local index' });
    }
    const apkPath = getApkPath(id);
    if (!fs.existsSync(apkPath)) {
      return res.status(404).json({ error: 'APK file not found. Use POST /api/builds/:id/mirror to download it.' });
    }
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Disposition', `attachment; filename="${id}.apk"`);
    res.setHeader('Cache-Control', 'no-store');
    res.sendFile(apkPath);
  });

  /**
   * POST /api/builds/:id/mirror
   * Manually (re-)download an already-finished EAS build's artifact.
   */
  router.post('/api/builds/:id/mirror', async (req, res) => {
    if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid build ID' });
    }
    try {
      const raw = await runEas(['build:view', id, '--json', '--non-interactive']);
      const b = JSON.parse(raw);
      if ((b.status || '').toLowerCase() !== 'finished') {
        return res.status(400).json({ error: `Build status is ${b.status}, must be finished to mirror` });
      }
      const artifactUrl = b.artifacts?.artifactUrl;
      if (!artifactUrl) {
        return res.status(400).json({ error: 'No artifact URL available for this build' });
      }

      upsertIndexEntry({
        id,
        easBuildId: id,
        gitCommitHash: b.gitCommitHash || '',
        branch: b.gitBranch || b.channel || '',
        profile: b.buildProfile || '',
        appVersion: b.appVersion || '',
        sizeBytes: 0,
        createdAt: b.createdAt || new Date().toISOString(),
        downloadedAt: null,
        status: 'mirroring',
      });

      emitStatus(io, id, 'downloading');
      emitLog(io, id, `Mirroring artifact from ${artifactUrl}`, 'stdout');

      downloadArtifact(io, id, artifactUrl)
        .then(size => emitLog(io, id, `Mirror complete (${size} bytes)`, 'stdout'))
        .catch(err => {
          emitLog(io, id, `Mirror failed: ${err.message}`, 'stderr');
          updateIndexEntry(id, { status: 'mirror_failed' });
        });

      res.json({ ok: true, id, message: 'Mirroring started' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * DELETE /api/builds/:id
   * Remove the APK, log file, and index entry for a build.
   */
  router.delete('/api/builds/:id', (req, res) => {
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid build ID' });
    }
    const index = readIndex();
    const entry = index.find(e => e.easBuildId === id);
    if (!entry) {
      return res.status(404).json({ error: 'Build not found in local index' });
    }
    try { fs.unlinkSync(getApkPath(id)); } catch {}
    try { fs.unlinkSync(getLogFilePath(id)); } catch {}
    logBuffers.delete(id);
    writeIndex(index.filter(e => e.easBuildId !== id));
    res.json({ ok: true, id });
  });

  /**
   * POST /api/builds
   * Trigger a new EAS build using spawn for live stdout/stderr capture.
   * Body: { profile: 'preview' | 'development', message?: string }
   */
  router.post('/api/builds', (req, res) => {
    if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
    const { profile, message } = req.body || {};
    const validProfiles = ['preview', 'development'];
    if (!validProfiles.includes(profile)) {
      return res.status(400).json({ error: `Invalid profile. Must be one of: ${validProfiles.join(', ')}` });
    }

    const args = [
      'build',
      '--platform', 'android',
      '--profile', profile,
      '--no-wait',
      '--json',
      '--non-interactive',
    ];
    if (message) {
      args.push('--message', String(message).slice(0, 240));
    }

    const env = { ...process.env, EXPO_TOKEN: EAS_TOKEN };
    const child = spawn('eas', args, { cwd: FITSO_MOBILE_DIR, env });

    let stdout = '';
    const pendingLogs = [];

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      data.toString().split('\n').forEach(line => {
        if (line.trim()) pendingLogs.push(line);
      });
    });

    child.on('error', (err) => {
      if (!res.headersSent) {
        res.status(500).json({ error: `Failed to spawn eas: ${err.message}` });
      }
    });

    child.on('close', (code) => {
      if (code !== 0 && !stdout.trim()) {
        const errMsg = pendingLogs.join('\n') || `eas build exited with code ${code}`;
        if (!res.headersSent) {
          res.status(500).json({ error: errMsg });
        }
        return;
      }

      let build;
      try {
        const builds = JSON.parse(stdout || '[]');
        build = Array.isArray(builds) ? builds[0] : builds;
      } catch {
        if (!res.headersSent) {
          res.status(500).json({ error: 'Failed to parse EAS build output' });
        }
        return;
      }

      if (!build) {
        if (!res.headersSent) {
          res.status(500).json({ error: 'No build was created' });
        }
        return;
      }

      // Emit buffered stderr lines to the build's log
      for (const line of pendingLogs) {
        emitLog(io, build.id, line, 'stderr');
      }
      emitLog(io, build.id, `Build triggered: ${build.id} (profile: ${profile})`, 'stdout');
      emitStatus(io, build.id, build.status || 'new');

      if (!res.headersSent) {
        res.json({
          id: build.id,
          profile: build.buildProfile,
          status: build.status,
          message: 'Build started. Logs are streaming via socket.io.',
        });
      }

      // Start polling for status updates
      pollBuildStatus(io, build.id);
    });
  });

  /**
   * POST /api/builds/:id/cancel
   * Cancel a running build.
   */
  router.post('/api/builds/:id/cancel', async (req, res) => {
    if (!EAS_TOKEN) return res.status(500).json({ error: 'EXPO_TOKEN not configured' });
    const { id } = req.params;
    if (!id || !/^[a-zA-Z0-9-]+$/.test(id)) {
      return res.status(400).json({ error: 'Invalid build ID' });
    }
    try {
      await runEas(['build:cancel', id, '--non-interactive']);
      emitLog(io, id, 'Build cancelled', 'stderr');
      emitStatus(io, id, 'canceled');
      res.json({ ok: true, id, message: 'Build cancelled' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
};
