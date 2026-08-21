const { execFile } = require('child_process');
const express = require('express');
const { Pool } = require('pg');

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_READONLY = process.env.DB_READONLY !== 'false'; // default true
const DB_POOL_MAX = parseInt(process.env.DB_POOL_MAX || '5', 10);
const DB_POOL_IDLE_TIMEOUT = parseInt(process.env.DB_POOL_IDLE_TIMEOUT || '600000', 10); // 10 min
const MAX_PAGE_SIZE = 500;
const STATEMENT_TIMEOUT_MS = 10000;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidId(str) {
  return typeof str === 'string' && /^[a-zA-Z0-9_-]+$/.test(str);
}

function isValidDbName(str) {
  return typeof str === 'string' && /^[a-zA-Z0-9_.-]+$/.test(str) && str.length <= 63;
}

function isValidTableName(str) {
  return typeof str === 'string' && /^[a-zA-Z0-9_.-]+$/.test(str) && str.length <= 63;
}

function quoteIdent(name) {
  // Double-quote identifiers, escaping any embedded double-quotes
  return '"' + String(name).replace(/"/g, '""') + '"';
}

// ---------------------------------------------------------------------------
// BaseAdapter — interface for future adapters (MySQL, Mongo, Redis, etc.)
// ---------------------------------------------------------------------------

class BaseAdapter {
  constructor(connInfo) {
    this.connInfo = connInfo;
  }
  async listDatabases() { throw new Error('not implemented'); }
  async listTables(dbName) { throw new Error('not implemented'); }
  async getSchema(dbName, tableName) { throw new Error('not implemented'); }
  async fetchPage(dbName, tableName, page, limit, sortCol, sortDir) { throw new Error('not implemented'); }
  async countRows(dbName, tableName) { throw new Error('not implemented'); }
  async testConnection() { throw new Error('not implemented'); }
  async close() {}
}

// ---------------------------------------------------------------------------
// PostgresAdapter
// ---------------------------------------------------------------------------

class PostgresAdapter extends BaseAdapter {
  /**
   * @param {string} dbName
   * @returns {Promise<Pool>}
   */
  _getPool(dbName) {
    return connectionManager.getPool(this.connInfo.containerId, dbName, {
      host: this.connInfo.host,
      port: this.connInfo.port,
      user: this.connInfo.user,
      password: this.connInfo.password,
      database: dbName,
      max: DB_POOL_MAX,
      idleTimeoutMillis: DB_POOL_IDLE_TIMEOUT,
      statement_timeout: STATEMENT_TIMEOUT_MS,
    });
  }

  async testConnection() {
    const db = this.connInfo.database || 'postgres';
    const pool = this._getPool(db);
    const client = await pool.connect();
    try {
      await client.query('SELECT 1');
      return { ok: true };
    } finally {
      client.release();
    }
  }

  async listDatabases() {
    const pool = this._getPool('postgres');
    const res = await pool.query(
      `SELECT datname FROM pg_database
       WHERE datistemplate = false
       ORDER BY datname`
    );
    return res.rows.map(r => r.datname);
  }

  async listTables(dbName) {
    const pool = this._getPool(dbName);
    const res = await pool.query(
      `SELECT
         t.table_name,
         t.table_type,
         c.reltuples::bigint AS row_estimate,
         pg_total_relation_size(quote_ident(t.table_schema) || '.' || quote_ident(t.table_name)) AS size_bytes
       FROM information_schema.tables t
       LEFT JOIN pg_class c ON c.relname = t.table_name
       LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
       WHERE t.table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_toast')
         AND t.table_type IN ('BASE TABLE', 'VIEW')
       ORDER BY t.table_name`
    );
    return res.rows.map(r => ({
      name: r.table_name,
      type: r.table_type === 'VIEW' ? 'view' : 'table',
      rowEstimate: parseInt(r.row_estimate, 10) || 0,
      sizeBytes: parseInt(r.size_bytes, 10) || 0,
    }));
  }

  async getSchema(dbName, tableName) {
    const pool = this._getPool(dbName);
    const [colRes, pkRes] = await Promise.all([
      pool.query(
        `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = $1
         ORDER BY ordinal_position`,
        [tableName]
      ),
      pool.query(
        `SELECT a.attname
         FROM pg_index i
         JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = $1::regclass AND i.indisprimary
         LIMIT 1`,
        [`public.${tableName}`]
      ),
    ]);

    const pkSet = new Set(pkRes.rows.map(r => r.attname));
    return colRes.rows.map(r => ({
      name: r.column_name,
      dataType: r.data_type,
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      isPrimaryKey: pkSet.has(r.column_name),
    }));
  }

  async fetchPage(dbName, tableName, page, limit, sortCol, sortDir) {
    const pool = this._getPool(dbName);
    const safeLimit = Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
    const safePage = Math.max(1, page);
    const offset = (safePage - 1) * safeLimit;

    // Get column names for validation of sort column
    let orderBy = '';
    if (sortCol && isValidTableName(sortCol)) {
      const dir = sortDir === 'desc' ? 'DESC' : 'ASC';
      orderBy = `ORDER BY ${quoteIdent(sortCol)} ${dir}`;
    } else {
      orderBy = `ORDER BY 1 ASC`; // order by first column as fallback
    }

    const dataRes = await pool.query(
      `SELECT * FROM ${quoteIdent(tableName)} ${orderBy} LIMIT $1 OFFSET $2`,
      [safeLimit, offset]
    );

    // Get column metadata
    const colRes = await pool.query(
      `SELECT column_name, data_type, is_nullable, column_default, ordinal_position
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1
       ORDER BY ordinal_position`,
      [tableName]
    );

    const pkRes = await pool.query(
      `SELECT a.attname
       FROM pg_index i
       JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = $1::regclass AND i.indisprimary
       LIMIT 1`,
      [`public.${tableName}`]
    );
    const pkSet = new Set(pkRes.rows.map(r => r.attname));

    const columns = colRes.rows.map(r => ({
      name: r.column_name,
      dataType: r.data_type,
      nullable: r.is_nullable === 'YES',
      defaultValue: r.column_default,
      isPrimaryKey: pkSet.has(r.column_name),
    }));

    return {
      rows: dataRes.rows,
      columns,
      totalRows: null, // filled by caller via countRows
      page: safePage,
      limit: safeLimit,
    };
  }

  async countRows(dbName, tableName) {
    const pool = this._getPool(dbName);
    const res = await pool.query(`SELECT count(*)::bigint AS cnt FROM ${quoteIdent(tableName)}`);
    return parseInt(res.rows[0].cnt, 10);
  }
}

// ---------------------------------------------------------------------------
// Adapter Registry
// ---------------------------------------------------------------------------

const adapters = {
  postgres: (connInfo) => new PostgresAdapter(connInfo),
  // Future: mysql: (connInfo) => new MySQLAdapter(connInfo),
  // Future: mongo: (connInfo) => new MongoAdapter(connInfo),
};

function getAdapter(type, connInfo) {
  const factory = adapters[type];
  if (!factory) throw new Error(`Unsupported database type: ${type}`);
  return factory(connInfo);
}

// ---------------------------------------------------------------------------
// ConnectionManager — pooled connections per (containerId, database)
// ---------------------------------------------------------------------------

class ConnectionManager {
  constructor() {
    /** @type {Map<string, { pool: Pool, lastUsed: number, adapter: BaseAdapter }>} */
    this.entries = new Map();
  }

  _key(containerId, dbName) {
    return `${containerId}:${dbName}`;
  }

  async getPool(containerId, dbName, poolConfig) {
    const key = this._key(containerId, dbName);
    let entry = this.entries.get(key);
    if (!entry) {
      const pool = new Pool(poolConfig);
      entry = { pool, lastUsed: Date.now() };
      this.entries.set(key, entry);
    }
    entry.lastUsed = Date.now();
    return entry.pool;
  }

  closePool(containerId) {
    for (const [key, entry] of this.entries) {
      if (key.startsWith(`${containerId}:`)) {
        entry.pool.end().catch(() => {});
        this.entries.delete(key);
      }
    }
  }

  cleanupIdle() {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (now - entry.lastUsed > DB_POOL_IDLE_TIMEOUT) {
        entry.pool.end().catch(() => {});
        this.entries.delete(key);
      }
    }
  }
}

const connectionManager = new ConnectionManager();

// Cleanup idle pools every 2 minutes
setInterval(() => connectionManager.cleanupIdle(), 120000).unref();

// ---------------------------------------------------------------------------
// DiscoveryService — auto-find database containers via docker inspect
// ---------------------------------------------------------------------------

function runCommand(cmd, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, ...options }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

const DB_IMAGE_PATTERNS = [
  { type: 'postgres', patterns: ['postgres', 'pgvector', 'postgis', 'timescale'] },
  { type: 'mysql', patterns: ['mysql', 'mariadb'] },
  { type: 'mongo', patterns: ['mongo'] },
  { type: 'redis', patterns: ['redis', 'valkey'] },
];

function detectDbType(image) {
  if (!image) return null;
  const lower = image.toLowerCase();
  for (const { type, patterns } of DB_IMAGE_PATTERNS) {
    if (patterns.some(p => lower.includes(p))) return type;
  }
  return null;
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

function extractPortMapping(portJson) {
  // Docker inspect port format: { "5432/tcp": [{ "HostIp": "0.0.0.0", "HostPort": "5432" }] }
  if (!portJson || typeof portJson !== 'object') return null;
  for (const [containerPort, bindings] of Object.entries(portJson)) {
    if (Array.isArray(bindings) && bindings.length > 0) {
      return {
        containerPort: parseInt(containerPort.split('/')[0], 10),
        hostPort: parseInt(bindings[0].HostPort, 10),
        hostIp: bindings[0].HostIp || 'localhost',
      };
    }
  }
  return null;
}

function extractCredentials(type, env) {
  switch (type) {
    case 'postgres':
      return {
        user: env.POSTGRES_USER || env.PGUSER || 'postgres',
        password: env.POSTGRES_PASSWORD || env.PGPASSWORD || '',
        database: env.POSTGRES_DB || env.PGDATABASE || 'postgres',
      };
    case 'mysql':
      return {
        user: env.MYSQL_USER || env.MYSQL_ROOT_USER || 'root',
        password: env.MYSQL_PASSWORD || env.MYSQL_ROOT_PASSWORD || '',
        database: env.MYSQL_DATABASE || '',
      };
    case 'mongo':
      return {
        user: env.MONGO_INITDB_ROOT_USERNAME || '',
        password: env.MONGO_INITDB_ROOT_PASSWORD || '',
        database: env.MONGO_INITDB_DATABASE || 'admin',
      };
    case 'redis':
      return {
        password: env.REDIS_PASSWORD || '',
        database: '0',
      };
    default:
      return {};
  }
}

const DEFAULT_PORTS = {
  postgres: 5432,
  mysql: 3306,
  mongo: 27017,
  redis: 6379,
};

let discoveryCache = { data: null, timestamp: 0 };
const DISCOVERY_CACHE_MS = 10000;

async function discoverDatabases() {
  // Cache for 10s to avoid hammering docker inspect on rapid frontend polls
  if (discoveryCache.data && Date.now() - discoveryCache.timestamp < DISCOVERY_CACHE_MS) {
    return discoveryCache.data;
  }

  try {
    const psOut = await runCommand('docker', ['ps', '--format', '{{json .}}']).catch(() => '');
    if (!psOut) {
      discoveryCache = { data: [], timestamp: Date.now() };
      return [];
    }

    const containers = psOut.split('\n').filter(Boolean).map(line => {
      try { return JSON.parse(line); } catch { return null; }
    }).filter(Boolean);

    const results = [];
    for (const c of containers) {
      const type = detectDbType(c.Image);
      if (!type) continue;

      const name = (c.Names || c.Name || '').replace(/^\//, '');
      const shortId = c.ID || '';

      // Parse labels for project info
      const labels = {};
      if (c.Labels) {
        for (const pair of String(c.Labels).split(',')) {
          const idx = pair.indexOf('=');
          if (idx !== -1) labels[pair.slice(0, idx)] = pair.slice(idx + 1);
        }
      }
      const project = labels['com.docker.compose.project'] || null;

      // docker inspect for env vars and port mappings
      let connInfo = {
        containerId: shortId,
        containerName: name,
        type,
        project,
        host: 'localhost',
        port: DEFAULT_PORTS[type],
        user: '',
        password: '',
        database: '',
      };

      try {
        const inspectOut = await runCommand('docker', ['inspect', shortId, '--format', '{{json .Config.Env}}|||{{json .NetworkSettings.Ports}}']);
        const [envJson, portsJson] = inspectOut.split('|||');
        const env = parseEnvArray(JSON.parse(envJson || '[]'));
        const creds = extractCredentials(type, env);
        connInfo = { ...connInfo, ...creds };

        const portMapping = extractPortMapping(JSON.parse(portsJson || '{}'));
        if (portMapping) {
          connInfo.port = portMapping.hostPort;
          connInfo.host = portMapping.hostIp === '0.0.0.0' ? 'localhost' : portMapping.hostIp;
        }
      } catch (err) {
        // inspect failed — use defaults, mark as needing manual config
        connInfo.error = 'Could not inspect container: ' + err.message;
      }

      results.push(connInfo);
    }

    discoveryCache = { data: results, timestamp: Date.now() };
    return results;
  } catch (err) {
    discoveryCache = { data: [], timestamp: Date.now() };
    return [];
  }
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = express.Router();

/**
 * GET /api/db
 * List all discovered database containers.
 */
router.get('/api/db', async (req, res) => {
  try {
    const containers = await discoverDatabases();
    // Test connectivity for each (quick SELECT 1)
    const enriched = await Promise.all(
      containers.map(async (c) => {
        if (c.error) {
          return { ...c, status: 'error', error: c.error };
        }
        try {
          const adapter = getAdapter(c.type, c);
          await adapter.testConnection();
          return { ...c, status: 'connected', password: undefined };
        } catch (err) {
          return { ...c, status: 'disconnected', error: err.message, password: undefined };
        }
      })
    );
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/db/:containerId/databases
 * List databases inside a database server.
 */
router.get('/api/db/:containerId/databases', async (req, res) => {
  const { containerId } = req.params;
  if (!isValidId(containerId)) {
    return res.status(400).json({ error: 'Invalid container ID' });
  }
  try {
    const containers = await discoverDatabases();
    const c = containers.find(x => x.containerId === containerId || x.containerId.startsWith(containerId));
    if (!c) return res.status(404).json({ error: 'Database container not found' });

    const adapter = getAdapter(c.type, c);
    const databases = await adapter.listDatabases();
    res.json(databases);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/db/:containerId/:dbName/tables
 * List tables in a database.
 */
router.get('/api/db/:containerId/:dbName/tables', async (req, res) => {
  const { containerId, dbName } = req.params;
  if (!isValidId(containerId)) return res.status(400).json({ error: 'Invalid container ID' });
  if (!isValidDbName(dbName)) return res.status(400).json({ error: 'Invalid database name' });

  try {
    const containers = await discoverDatabases();
    const c = containers.find(x => x.containerId === containerId || x.containerId.startsWith(containerId));
    if (!c) return res.status(404).json({ error: 'Database container not found' });

    const adapter = getAdapter(c.type, c);
    const tables = await adapter.listTables(dbName);
    res.json(tables);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/db/:containerId/:dbName/:table/schema
 * Get column schema for a table.
 */
router.get('/api/db/:containerId/:dbName/:table/schema', async (req, res) => {
  const { containerId, dbName, table } = req.params;
  if (!isValidId(containerId)) return res.status(400).json({ error: 'Invalid container ID' });
  if (!isValidDbName(dbName)) return res.status(400).json({ error: 'Invalid database name' });
  if (!isValidTableName(table)) return res.status(400).json({ error: 'Invalid table name' });

  try {
    const containers = await discoverDatabases();
    const c = containers.find(x => x.containerId === containerId || x.containerId.startsWith(containerId));
    if (!c) return res.status(404).json({ error: 'Database container not found' });

    const adapter = getAdapter(c.type, c);
    const schema = await adapter.getSchema(dbName, table);
    res.json(schema);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/db/:containerId/:dbName/:table/data
 * Fetch paginated rows from a table.
 * Query params: ?page=1&limit=50&sort=col&dir=asc
 */
router.get('/api/db/:containerId/:dbName/:table/data', async (req, res) => {
  const { containerId, dbName, table } = req.params;
  if (!isValidId(containerId)) return res.status(400).json({ error: 'Invalid container ID' });
  if (!isValidDbName(dbName)) return res.status(400).json({ error: 'Invalid database name' });
  if (!isValidTableName(table)) return res.status(400).json({ error: 'Invalid table name' });

  const page = parseInt(req.query.page, 10) || 1;
  const limit = parseInt(req.query.limit, 10) || 50;
  const sortCol = req.query.sort || null;
  const sortDir = req.query.dir === 'desc' ? 'desc' : 'asc';

  try {
    const containers = await discoverDatabases();
    const c = containers.find(x => x.containerId === containerId || x.containerId.startsWith(containerId));
    if (!c) return res.status(404).json({ error: 'Database container not found' });

    const adapter = getAdapter(c.type, c);
    const [dataResult, totalRows] = await Promise.all([
      adapter.fetchPage(dbName, table, page, limit, sortCol, sortDir),
      adapter.countRows(dbName, table),
    ]);

    res.json({ ...dataResult, totalRows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/db/:containerId/:dbName/:table/count
 * Get exact row count for a table.
 */
router.get('/api/db/:containerId/:dbName/:table/count', async (req, res) => {
  const { containerId, dbName, table } = req.params;
  if (!isValidId(containerId)) return res.status(400).json({ error: 'Invalid container ID' });
  if (!isValidDbName(dbName)) return res.status(400).json({ error: 'Invalid database name' });
  if (!isValidTableName(table)) return res.status(400).json({ error: 'Invalid table name' });

  try {
    const containers = await discoverDatabases();
    const c = containers.find(x => x.containerId === containerId || x.containerId.startsWith(containerId));
    if (!c) return res.status(404).json({ error: 'Database container not found' });

    const adapter = getAdapter(c.type, c);
    const count = await adapter.countRows(dbName, table);
    res.json({ count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
