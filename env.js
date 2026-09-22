const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');
const { execFile } = require('child_process');

// ---------------------------------------------------------------------------
// Central project-wise env/secret manager.
//
// Values are encrypted at rest with AES-256-GCM. The data file (.envstore.json)
// and the key file (.envstore.key) are both written with mode 0600 next to this
// file — the data file alone does not leak secrets.
// ---------------------------------------------------------------------------

const STORE_FILE = process.env.ENV_STORE_FILE || path.join(__dirname, '.envstore.json');
const KEY_FILE = process.env.ENV_STORE_KEY_FILE || path.join(__dirname, '.envstore.key');

const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.]{0,127}$/;
const MAX_VALUE_LEN = 64 * 1024;
const CONTAINER_NAME_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.\-]{0,127}$/;

// Vars injected by the container runtime/base image — never worth importing.
const ENV_DENYLIST = new Set([
  'PATH', 'HOME', 'HOSTNAME', 'TERM', 'SHLVL', 'PWD', '_', 'OLDPWD',
  'LANG', 'LC_ALL', 'LC_CTYPE', 'GPG_KEY', 'DEBIAN_FRONTEND',
  'NODE_VERSION', 'YARN_VERSION', 'PYTHON_VERSION', 'PYTHON_PIP_VERSION',
  'PGDATA', 'PHP_VERSION', 'PHP_SHA256', 'PHP_ASC_URL', 'PHP_URL',
  'RUBY_VERSION', 'GEM_HOME', 'BUNDLE_SILENCE_ROOT_WARNING', 'RAILS_ENV',
  'JAVA_HOME', 'JDK_VERSION', 'GO_VERSION', 'GOPATH', 'CARGO_HOME', 'RUSTUP_HOME',
]);

// ---------------------------------------------------------------------------
// Encryption
// ---------------------------------------------------------------------------

function loadKey() {
  try {
    const hex = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[0-9a-f]{64}$/i.test(hex)) return Buffer.from(hex, 'hex');
  } catch {
    // missing or unreadable — generate below
  }
  const key = crypto.randomBytes(32);
  fs.writeFileSync(KEY_FILE, key.toString('hex'), { mode: 0o600 });
  return key;
}

const ENC_KEY = loadKey();

function encrypt(plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64')}.${tag.toString('base64')}.${ct.toString('base64')}`;
}

function decrypt(payload) {
  const parts = String(payload).split('.');
  if (parts.length !== 4 || parts[0] !== 'v1') throw new Error('Corrupted stored value');
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, Buffer.from(parts[1], 'base64'));
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

function loadStore() {
  try {
    const data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'));
    if (data && Array.isArray(data.projects)) return data;
  } catch {
    // missing or corrupt — start fresh
  }
  return { projects: [] };
}

function saveStore(store) {
  const tmp = `${STORE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, STORE_FILE);
}

function findProject(store, id) {
  return store.projects.find((p) => p.id === id);
}

function projectSummary(p) {
  return {
    id: p.id,
    name: p.name,
    description: p.description || '',
    composeProject: p.composeProject || null,
    varCount: p.vars.length,
    secretCount: p.vars.filter((v) => v.secret).length,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// dotenv parsing / serialization
// ---------------------------------------------------------------------------

function parseDotenv(content) {
  const vars = [];
  for (const rawLine of String(content).split(/\r?\n/)) {
    let line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('export ')) line = line.slice(7).trim();
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!ENV_KEY_RE.test(key)) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      value = value.slice(1, -1)
        .replace(/\\n/g, '\n')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      value = value.slice(1, -1);
    } else {
      const hashIdx = value.indexOf(' #');
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }
    if (value.length > MAX_VALUE_LEN) continue;
    vars.push({ key, value });
  }
  return vars;
}

function toDotenv(vars) {
  const lines = vars.map((v) => {
    const needsQuote = v.value === '' || /[\s#"'$`\\]/.test(v.value);
    const val = needsQuote
      ? `"${v.value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
      : v.value;
    return `${v.key}=${val}`;
  });
  return lines.join('\n') + (lines.length ? '\n' : '');
}

// ---------------------------------------------------------------------------
// Docker helpers
// ---------------------------------------------------------------------------

function runCommand(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseEnvArray(envArray) {
  const env = {};
  if (!Array.isArray(envArray)) return env;
  for (const entry of envArray) {
    const idx = String(entry).indexOf('=');
    if (idx === -1) continue;
    env[entry.slice(0, idx)] = entry.slice(idx + 1);
  }
  return env;
}

async function listComposeProjects() {
  const out = await runCommand('docker', ['ps', '-a', '--format', '{{json .}}']).catch(() => '');
  if (!out) return [];
  const counts = new Map();
  for (const line of out.split('\n')) {
    if (!line) continue;
    let c;
    try { c = JSON.parse(line); } catch { continue; }
    const labels = String(c.Labels || '');
    for (const pair of labels.split(',')) {
      const idx = pair.indexOf('=');
      if (idx === -1) continue;
      if (pair.slice(0, idx).trim() === 'com.docker.compose.project') {
        const name = pair.slice(idx + 1).trim();
        if (name) counts.set(name, (counts.get(name) || 0) + 1);
      }
    }
  }
  return [...counts.entries()].map(([name, containers]) => ({ name, containers }));
}

// ---------------------------------------------------------------------------
// .env file discovery — finds env files on disk so non-docker projects can be
// imported without copy-pasting. Roots configurable via ENV_SCAN_DIRS (colon-
// separated); defaults to the service user's home plus common deploy roots.
// ---------------------------------------------------------------------------

const SCAN_DIRS = (process.env.ENV_SCAN_DIRS ||
  [process.env.HOME, '/opt', '/srv', '/var/www'].filter(Boolean).join(':'))
  .split(':').filter(Boolean);

const ENV_FILE_RE = /^\.env(\..+)?$/;
const ENV_SKIP_RE = /\.(example|sample|template|dist|defaults|schema)(\.|$)/i;
const SKIP_DIRS = ['node_modules', '.git', 'vendor', 'dist', 'build', '.cache', '.npm', '__pycache__'];
const MAX_ENV_FILE_SIZE = 1024 * 1024;

let scanCache = { data: null, timestamp: 0 };
const SCAN_CACHE_MS = 60000;

async function scanEnvFiles() {
  if (scanCache.data && Date.now() - scanCache.timestamp < SCAN_CACHE_MS) {
    return scanCache.data;
  }

  const found = [];
  for (const dir of SCAN_DIRS) {
    try {
      if (!fs.existsSync(dir)) continue;
      const args = [dir, '-maxdepth', '6', '-type', 'f', '(', '-name', '.env', '-o', '-name', '.env.*', ')'];
      for (const skip of SKIP_DIRS) args.push('-not', '-path', `*/${skip}/*`);
      args.push('-printf', '%p\t%T@\n');
      const out = await runCommand('find', args).catch(() => '');
      for (const line of out.split('\n')) {
        if (!line) continue;
        const [filePath, mtime] = line.split('\t');
        const base = path.basename(filePath);
        if (!ENV_FILE_RE.test(base) || ENV_SKIP_RE.test(base)) continue;
        try {
          if (fs.statSync(filePath).size > MAX_ENV_FILE_SIZE) continue;
        } catch { continue; }
        found.push({
          path: filePath,
          dir: path.dirname(filePath),
          mtime: Math.round(parseFloat(mtime) * 1000) || 0,
        });
      }
    } catch {
      // unreadable root — skip
    }
  }

  const byDir = new Map();
  for (const f of found) {
    if (!byDir.has(f.dir)) byDir.set(f.dir, []);
    byDir.get(f.dir).push(f);
  }
  const data = [...byDir.entries()]
    .map(([dir, files]) => ({
      dir,
      name: path.basename(dir),
      files: files.sort((a, b) => a.path.localeCompare(b.path)),
    }))
    .sort((a, b) => a.dir.localeCompare(b.dir));

  scanCache = { data, timestamp: Date.now() };
  return data;
}

function isAllowedEnvFile(filePath) {
  if (typeof filePath !== 'string' || !filePath) return false;
  const resolved = path.resolve(filePath);
  const base = path.basename(resolved);
  if (!ENV_FILE_RE.test(base) || ENV_SKIP_RE.test(base)) return false;
  const segments = resolved.split(path.sep);
  if (SKIP_DIRS.some((s) => segments.includes(s))) return false;
  return SCAN_DIRS.some((d) => resolved.startsWith(path.resolve(d) + path.sep));
}

function applyImport(project, parsed, markSecrets) {
  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  for (const { key, value } of parsed) {
    const secret = markSecrets && SECRET_HINT_RE.test(key);
    const existing = project.vars.find((v) => v.key === key);
    if (existing) {
      existing.value = encrypt(value);
      if (secret) existing.secret = true;
      existing.updatedAt = now;
      updated++;
    } else {
      project.vars.push({ key, value: encrypt(value), secret, updatedAt: now });
      added++;
    }
  }
  project.vars.sort((a, b) => a.key.localeCompare(b.key));
  project.updatedAt = now;
  return { added, updated };
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = express.Router();

/**
 * GET /api/env/projects
 * List managed env projects plus docker-compose projects discovered on the
 * host that don't have an env space yet.
 */
router.get('/api/env/projects', async (req, res) => {
  try {
    const store = loadStore();
    const discovered = (await listComposeProjects())
      .filter((d) => !store.projects.some((p) => p.composeProject === d.name || p.name === d.name));
    const envDirs = (await scanEnvFiles())
      .filter((g) => !store.projects.some((p) => p.name === g.name))
      .slice(0, 30);
    res.json({
      projects: store.projects.map(projectSummary),
      discovered,
      envDirs,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/env/projects
 * Create a project env space. Body: { name, description?, composeProject? }
 */
router.post('/api/env/projects', (req, res) => {
  const { name, description, composeProject } = req.body || {};
  const trimmed = typeof name === 'string' ? name.trim() : '';
  if (!trimmed || trimmed.length > 64 || /[\x00-\x1f]/.test(trimmed)) {
    return res.status(400).json({ error: 'Invalid project name' });
  }

  const store = loadStore();
  if (store.projects.some((p) => p.name.toLowerCase() === trimmed.toLowerCase())) {
    return res.status(409).json({ error: 'A project with that name already exists' });
  }

  const now = new Date().toISOString();
  const project = {
    id: crypto.randomUUID(),
    name: trimmed,
    description: typeof description === 'string' ? description.slice(0, 500) : '',
    composeProject: typeof composeProject === 'string' && CONTAINER_NAME_RE.test(composeProject)
      ? composeProject
      : null,
    createdAt: now,
    updatedAt: now,
    vars: [],
  };
  store.projects.push(project);
  saveStore(store);
  res.status(201).json(projectSummary(project));
});

/**
 * PATCH /api/env/projects/:id
 * Update name/description/composeProject.
 */
router.patch('/api/env/projects/:id', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { name, description, composeProject } = req.body || {};
  if (name !== undefined) {
    const trimmed = String(name).trim();
    if (!trimmed || trimmed.length > 64 || /[\x00-\x1f]/.test(trimmed)) {
      return res.status(400).json({ error: 'Invalid project name' });
    }
    if (store.projects.some((p) => p.id !== project.id && p.name.toLowerCase() === trimmed.toLowerCase())) {
      return res.status(409).json({ error: 'A project with that name already exists' });
    }
    project.name = trimmed;
  }
  if (description !== undefined) project.description = String(description).slice(0, 500);
  if (composeProject !== undefined) {
    project.composeProject = composeProject && CONTAINER_NAME_RE.test(composeProject)
      ? composeProject
      : null;
  }
  project.updatedAt = new Date().toISOString();
  saveStore(store);
  res.json(projectSummary(project));
});

/**
 * DELETE /api/env/projects/:id
 */
router.delete('/api/env/projects/:id', (req, res) => {
  const store = loadStore();
  const idx = store.projects.findIndex((p) => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Project not found' });
  store.projects.splice(idx, 1);
  saveStore(store);
  res.json({ ok: true });
});

/**
 * GET /api/env/projects/:id/vars
 * Decrypted var list — this route is auth-gated at the app level.
 */
router.get('/api/env/projects/:id/vars', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    res.json(project.vars.map((v) => ({
      key: v.key,
      value: decrypt(v.value),
      secret: !!v.secret,
      updatedAt: v.updatedAt,
    })));
  } catch (err) {
    res.status(500).json({ error: `Failed to decrypt store: ${err.message}` });
  }
});

/**
 * PUT /api/env/projects/:id/vars
 * Upsert a variable. Body: { key, value, secret? }
 */
router.put('/api/env/projects/:id/vars', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { key, value, secret } = req.body || {};
  if (!ENV_KEY_RE.test(String(key || ''))) {
    return res.status(400).json({ error: 'Invalid variable name (letters, digits, _ . — must start with a letter or _)' });
  }
  if (typeof value !== 'string' || value.length > MAX_VALUE_LEN) {
    return res.status(400).json({ error: 'Invalid value' });
  }

  const now = new Date().toISOString();
  const existing = project.vars.find((v) => v.key === key);
  if (existing) {
    existing.value = encrypt(value);
    existing.secret = !!secret;
    existing.updatedAt = now;
  } else {
    project.vars.push({ key, value: encrypt(value), secret: !!secret, updatedAt: now });
    project.vars.sort((a, b) => a.key.localeCompare(b.key));
  }
  project.updatedAt = now;
  saveStore(store);
  res.json({ ok: true, key });
});

/**
 * DELETE /api/env/projects/:id/vars/:key
 */
router.delete('/api/env/projects/:id/vars/:key', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const idx = project.vars.findIndex((v) => v.key === req.params.key);
  if (idx === -1) return res.status(404).json({ error: 'Variable not found' });
  project.vars.splice(idx, 1);
  project.updatedAt = new Date().toISOString();
  saveStore(store);
  res.json({ ok: true });
});

/**
 * POST /api/env/projects/:id/import
 * Bulk upsert from pasted .env content. Body: { content, markSecrets? }
 * markSecrets flags vars whose key looks secret-y (TOKEN/SECRET/PASSWORD/KEY…).
 */
const SECRET_HINT_RE = /(SECRET|TOKEN|PASSWORD|PASSWD|PWD|_KEY|APIKEY|API_KEY|PRIVATE|CREDENTIAL|AUTH)/i;

router.post('/api/env/projects/:id/import', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { content, markSecrets } = req.body || {};
  if (typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'No .env content provided' });
  }

  const parsed = parseDotenv(content);
  if (!parsed.length) {
    return res.status(400).json({ error: 'No KEY=VALUE pairs found in the provided content' });
  }

  const { added, updated } = applyImport(project, parsed, markSecrets);
  saveStore(store);
  res.json({ ok: true, added, updated });
});

/**
 * POST /api/env/projects/:id/import-file
 * Import a .env file that already exists on this server. Body: { path, markSecrets? }
 * Path must live under one of the ENV_SCAN_DIRS roots.
 */
router.post('/api/env/projects/:id/import-file', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });

  const { path: filePath, markSecrets } = req.body || {};
  if (!isAllowedEnvFile(filePath)) {
    return res.status(400).json({ error: 'Path is not a .env file under a configured scan root' });
  }

  let content;
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > MAX_ENV_FILE_SIZE) {
      return res.status(400).json({ error: 'Not a regular .env file' });
    }
    content = fs.readFileSync(filePath, 'utf8');
  } catch (err) {
    return res.status(400).json({ error: `Cannot read file: ${err.message}` });
  }

  const parsed = parseDotenv(content);
  if (!parsed.length) {
    return res.status(400).json({ error: 'No KEY=VALUE pairs found in that file' });
  }

  const { added, updated } = applyImport(project, parsed, markSecrets !== false);
  saveStore(store);
  res.json({ ok: true, added, updated, path: filePath });
});

/**
 * GET /api/env/scan
 * All .env files found under ENV_SCAN_DIRS, grouped by directory.
 */
router.get('/api/env/scan', async (req, res) => {
  try {
    res.json(await scanEnvFiles());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/env/projects/:id/export
 * Download the project's vars as a .env file.
 */
router.get('/api/env/projects/:id/export', (req, res) => {
  const store = loadStore();
  const project = findProject(store, req.params.id);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  try {
    const vars = project.vars.map((v) => ({ key: v.key, value: decrypt(v.value) }));
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${project.name.replace(/[^a-zA-Z0-9_.-]/g, '_')}.env"`);
    res.send(toDotenv(vars));
  } catch (err) {
    res.status(500).json({ error: `Failed to decrypt store: ${err.message}` });
  }
});

/**
 * GET /api/env/containers
 * All containers with their compose project and importable env-var count.
 */
router.get('/api/env/containers', async (req, res) => {
  try {
    const ids = (await runCommand('docker', ['ps', '-aq'])).split('\n').filter(Boolean);
    if (!ids.length) return res.json([]);

    const out = await runCommand('docker', [
      'inspect', ...ids,
      '--format', '{{.Name}}|||{{.Config.Image}}|||{{.State.Status}}|||{{json .Config.Env}}|||{{json .Config.Labels}}',
    ]);

    const containers = out.split('\n').filter(Boolean).map((line) => {
      const [name, image, state, envJson, labelsJson] = line.split('|||');
      const env = parseEnvArray(JSON.parse(envJson || '[]'));
      const labels = JSON.parse(labelsJson || '{}');
      return {
        name: name.replace(/^\//, ''),
        image,
        state,
        project: labels['com.docker.compose.project'] || null,
        envCount: Object.keys(env).filter((k) => !ENV_DENYLIST.has(k)).length,
      };
    });
    res.json(containers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/env/containers/:name/vars
 * Preview a container's env vars (runtime-injected vars filtered out).
 */
router.get('/api/env/containers/:name/vars', async (req, res) => {
  const { name } = req.params;
  if (!CONTAINER_NAME_RE.test(name)) {
    return res.status(400).json({ error: 'Invalid container name' });
  }
  try {
    const out = await runCommand('docker', ['inspect', name, '--format', '{{json .Config.Env}}']);
    const env = parseEnvArray(JSON.parse(out || '[]'));
    const vars = Object.entries(env)
      .filter(([key]) => !ENV_DENYLIST.has(key))
      .map(([key, value]) => ({ key, value, secret: SECRET_HINT_RE.test(key) }))
      .sort((a, b) => a.key.localeCompare(b.key));
    res.json(vars);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
