const { execFile } = require('child_process');
const fs = require('fs/promises');
const os = require('os');

const MONITOR_REPO = process.env.MONITOR_REPO || 'kamikaazeyy/fitso';
const CF_SPEED_URL = 'https://speed.cloudflare.com/__down?bytes=25000000';

function humanBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(decimals)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function humanBits(bitsPerSecond, decimals = 2) {
  if (bitsPerSecond === 0) return '0 bps';
  const k = 1000;
  const sizes = ['bps', 'Kbps', 'Mbps', 'Gbps'];
  const i = Math.floor(Math.log(Math.abs(bitsPerSecond)) / Math.log(k));
  return `${(bitsPerSecond / Math.pow(k, i)).toFixed(decimals)} ${sizes[Math.min(i, sizes.length - 1)]}`;
}

function percent(value, total) {
  if (!total) return 0;
  return Math.min(100, Math.max(0, (value / total) * 100));
}

async function readFileFirstLine(path) {
  try {
    const data = await fs.readFile(path, 'utf8');
    return data.split('\n')[0];
  } catch {
    return null;
  }
}

async function getCpuUsage() {
  try {
    const first = await readFileFirstLine('/proc/stat');
    if (!first) throw new Error('no /proc/stat');
    await new Promise(r => setTimeout(r, 500));
    const second = await readFileFirstLine('/proc/stat');
    if (!second) throw new Error('no /proc/stat');

    const parse = (line) => {
      const parts = line.trim().split(/\s+/).slice(1).map(Number);
      const idle = (parts[3] || 0) + (parts[4] || 0);
      const total = parts.reduce((a, b) => a + b, 0);
      return { idle, total };
    };

    const a = parse(first);
    const b = parse(second);
    const dTotal = b.total - a.total;
    const dIdle = b.idle - a.idle;
    const usage = dTotal > 0 ? 100 * (1 - dIdle / dTotal) : 0;
    return { usage: Math.max(0, Math.min(100, usage)), cores: os.cpus().length, load: os.loadavg() };
  } catch (err) {
    return { usage: 0, cores: os.cpus().length, load: os.loadavg(), error: err.message };
  }
}

async function getMemory() {
  try {
    const data = await fs.readFile('/proc/meminfo', 'utf8');
    const map = {};
    for (const line of data.split('\n')) {
      const m = line.match(/^(\w+):\s*(\d+)\s*kB/);
      if (m) map[m[1]] = parseInt(m[2], 10) * 1024;
    }
    const total = map.MemTotal || os.totalmem();
    const free = map.MemAvailable || map.MemFree || os.freemem();
    const used = total - free;
    return {
      total,
      free,
      used,
      percent: percent(used, total),
      totalHuman: humanBytes(total),
      usedHuman: humanBytes(used),
      freeHuman: humanBytes(free)
    };
  } catch {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return { total, free, used, percent: percent(used, total), totalHuman: humanBytes(total), usedHuman: humanBytes(used), freeHuman: humanBytes(free) };
  }
}

async function getDisk() {
  try {
    const stats = await fs.statfs('/');
    const bsize = stats.bsize;
    const total = stats.blocks * bsize;
    const available = stats.bavail * bsize;
    const used = total - available;
    return {
      path: '/',
      total,
      available,
      used,
      percent: percent(used, total),
      totalHuman: humanBytes(total),
      usedHuman: humanBytes(used),
      availableHuman: humanBytes(available)
    };
  } catch (err) {
    return { error: err.message };
  }
}

async function readNetDev() {
  try {
    const data = await fs.readFile('/proc/net/dev', 'utf8');
    const interfaces = [];
    const lines = data.split('\n');
    for (let i = 2; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const parts = line.split(/\s+/);
      const name = parts[0].replace(/:$/, '');
      if (!name || name === 'lo' || !name.match(/^(eth|en|wl|bond|team)/i)) continue;
      const rx = parseInt(parts[1], 10) || 0;
      const tx = parseInt(parts[9], 10) || 0;
      interfaces.push({ name, rx, tx });
    }
    return interfaces;
  } catch (err) {
    return [];
  }
}

async function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        const message = stderr?.trim() || err.message;
        reject(new Error(message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

function parseDockerLabels(labelString) {
  const labels = {};
  if (!labelString) return labels;
  for (const pair of labelString.split(',')) {
    const idx = pair.indexOf('=');
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    labels[key] = value;
  }
  return labels;
}

function parsePercent(str) {
  if (!str) return 0;
  const m = str.match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

async function getContainers() {
  try {
    const [psOut, statsOut] = await Promise.all([
      runCommand('docker', ['ps', '--format', '{{json .}}']).catch(() => ''),
      runCommand('docker', ['stats', '--no-stream', '--format', 'json']).catch(() => '')
    ]);

    const psList = psOut
      ? psOut.split('\n').map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean)
      : [];

    const statsList = statsOut
      ? statsOut.split('\n').map(line => {
          try { return JSON.parse(line); } catch { return null; }
        }).filter(Boolean)
      : [];

    const statsByName = new Map();
    const statsById = new Map();
    for (const s of statsList) {
      if (s.Name) statsByName.set(s.Name.toLowerCase(), s);
      if (s.ID) statsById.set(s.ID.toLowerCase(), s);
    }

    return psList.map(c => {
      const name = c.Names || c.Name || '';
      const shortId = c.ID || '';
      const stats = statsByName.get(name.toLowerCase()) || statsById.get(shortId.toLowerCase()) || statsById.get(shortId.slice(0, 12).toLowerCase()) || {};
      const labels = parseDockerLabels(c.Labels || '');
      const project = labels['com.docker.compose.project'] || labels['project'] || null;
      const service = labels['com.docker.compose.service'] || labels['service'] || c.Image || '';
      return {
        id: c.ID,
        name,
        image: c.Image,
        status: c.Status,
        state: c.State,
        ports: c.Ports,
        labels,
        project,
        service,
        cpu: parsePercent(stats.CPUPerc),
        memory: parsePercent(stats.MemPerc),
        memoryUsage: stats.MemUsage || '',
        netIO: stats.NetIO || '',
        blockIO: stats.BlockIO || '',
        pids: parseInt(stats.PIDs, 10) || 0
      };
    });
  } catch (err) {
    return { error: err.message };
  }
}

function groupByProject(containers) {
  if (Array.isArray(containers) === false) return {};
  const projects = {};
  for (const c of containers) {
    const key = c.project || 'ungrouped';
    if (!projects[key]) projects[key] = [];
    projects[key].push(c);
  }
  return projects;
}

async function getServices() {
  try {
    const out = await runCommand('systemctl', ['list-units', '--type=service', '--state=active', '--state=failed', '--no-pager', '--plain', '-o', 'json']);
    return JSON.parse(out || '[]');
  } catch (err) {
    return { error: err.message };
  }
}

async function getGitHub() {
  const result = { prs: [], runs: [], error: null };
  try {
    const [prOut, runOut] = await Promise.all([
      runCommand('gh', ['pr', 'list', '--repo', MONITOR_REPO, '--state', 'all', '--limit', '20', '--json', 'number,title,state,author,headRefName,baseRefName,mergeStateStatus,url,createdAt,statusCheckRollup']).catch(() => '[]'),
      runCommand('gh', ['run', 'list', '--repo', MONITOR_REPO, '--limit', '20', '--json', 'name,status,conclusion,event,headBranch,createdAt,url,displayTitle']).catch(() => '[]')
    ]);
    result.prs = JSON.parse(prOut || '[]');
    result.runs = JSON.parse(runOut || '[]');
  } catch (err) {
    result.error = err.message;
  }
  return result;
}

async function runSpeedTest() {
  try {
    const stdout = await runCommand('curl', ['-s', '-L', '-o', '/dev/null', '-w', '%{speed_download},%{time_total}', '--max-time', '10', '--connect-timeout', '5', CF_SPEED_URL]);
    const [speedStr, timeStr] = stdout.split(',');
    const bytesPerSecond = parseFloat(speedStr) || 0;
    const seconds = parseFloat(timeStr) || 0;
    const bitsPerSecond = bytesPerSecond * 8;
    return {
      speedBps: bytesPerSecond,
      speedMbps: bitsPerSecond / 1_000_000,
      speedHuman: humanBits(bitsPerSecond),
      duration: seconds,
      source: 'Cloudflare speed test'
    };
  } catch (err) {
    return { error: err.message };
  }
}

let cpuSnapshot = { usage: 0, cores: 0, load: [0, 0, 0] };
let netSnapshot = { interfaces: [], timestamp: 0 };

async function refreshSnapshots() {
  try {
    cpuSnapshot = await getCpuUsage();
  } catch (e) {
    cpuSnapshot.error = e.message;
  }

  try {
    const stats = await readNetDev();
    const now = Date.now();
    if (netSnapshot.timestamp) {
      const dt = (now - netSnapshot.timestamp) / 1000;
      netSnapshot = {
        timestamp: now,
        interfaces: stats.map(s => {
          const prev = netSnapshot.interfaces.find(p => p.name === s.name);
          if (!prev || dt <= 0) {
            return { name: s.name, rxSpeed: 0, txSpeed: 0, rxTotal: s.rx, txTotal: s.tx };
          }
          return {
            name: s.name,
            rxSpeed: (s.rx - prev.rxTotal) / dt,
            txSpeed: (s.tx - prev.txTotal) / dt,
            rxTotal: s.rx,
            txTotal: s.tx
          };
        })
      };
    } else {
      netSnapshot = {
        timestamp: now,
        interfaces: stats.map(s => ({ name: s.name, rxSpeed: 0, txSpeed: 0, rxTotal: s.rx, txTotal: s.tx }))
      };
    }
  } catch {
    // ignore
  }
}

setInterval(refreshSnapshots, 1000);
refreshSnapshots();

module.exports = async function monitorPlugin(app, opts) {
  app.get('/monitor', async (request, reply) => {
    const path = require('path');
    const file = path.join(__dirname, 'monitor.html');
    try {
      const html = await fs.readFile(file, 'utf8');
      return reply.type('text/html').send(html);
    } catch (err) {
      return reply.code(500).send({ error: 'Failed to load dashboard' });
    }
  });

  app.get('/api/monitor/overview', async (request, reply) => {
    const [memory, disk] = await Promise.all([getMemory(), getDisk()]);
    return {
      cpu: cpuSnapshot,
      memory,
      disk,
      uptime: os.uptime()
    };
  });

  app.get('/api/monitor/network', async (request, reply) => {
    const enriched = netSnapshot.interfaces
      .filter(iface => iface.rxTotal + iface.txTotal > 0)
      .sort((a, b) => (b.rxSpeed + b.txSpeed) - (a.rxSpeed + a.txSpeed))
      .map(iface => ({
        ...iface,
        rxSpeedHuman: `${humanBits(iface.rxSpeed * 8)}/s`,
        txSpeedHuman: `${humanBits(iface.txSpeed * 8)}/s`
      }));
    return { interfaces: enriched, timestamp: netSnapshot.timestamp };
  });

  app.get('/api/monitor/containers', async (request, reply) => {
    return getContainers();
  });

  app.get('/api/monitor/projects', async (request, reply) => {
    const containers = await getContainers();
    if (containers.error) return reply.code(500).send(containers);
    return groupByProject(containers);
  });

  app.get('/api/monitor/services', async (request, reply) => {
    return getServices();
  });

  app.get('/api/monitor/github', async (request, reply) => {
    return getGitHub();
  });

  app.post('/api/monitor/speedtest', async (request, reply) => {
    return runSpeedTest();
  });
};
