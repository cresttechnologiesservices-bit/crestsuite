/*
 * Shared persistence layer for LeaveMS and QMS.
 *
 * The apps keep their original synchronous data model (one in-memory object,
 * mutate + save()), but the durable copy now lives in PostgreSQL — the same
 * server ClockIT uses — in a `crestsuite` database:
 *   app_records: one row per record   (app, collection, id, seq, data jsonb)
 *   app_meta:    non-array values     (app, key, data jsonb)
 *
 * On first start the existing data/db.json is imported automatically.
 * If PostgreSQL is unreachable at boot, the store falls back to the JSON file
 * (with a loud warning) so `npm start` still works without Docker.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DEFAULT_URL = 'postgresql://clockit:clockit@localhost:5433/crestsuite';

const DDL = `
CREATE TABLE IF NOT EXISTS app_records (
  app        TEXT NOT NULL,
  collection TEXT NOT NULL,
  id         TEXT NOT NULL,
  seq        INTEGER NOT NULL,
  data       JSONB NOT NULL,
  PRIMARY KEY (app, collection, id)
);
CREATE TABLE IF NOT EXISTS app_meta (
  app  TEXT NOT NULL,
  key  TEXT NOT NULL,
  data JSONB NOT NULL,
  PRIMARY KEY (app, key)
);
`;

class JsonPgStore {
  /**
   * @param {string} appName  namespace inside the shared tables ('leavems'|'qms')
   * @param {object} opts     { jsonFile, empty }
   */
  constructor(appName, opts) {
    this.app = appName;
    this.jsonFile = opts.jsonFile;
    this.empty = opts.empty || {};
    this.url = process.env.CRESTSUITE_DATABASE_URL || DEFAULT_URL;
    this.mode = null; // 'pg' | 'file'
    this._data = null;
    this._pool = null;
    this._timer = null;
    this._flushChain = Promise.resolve();
  }

  get data() {
    if (!this._data) {
      throw new Error(`[${this.app}] store used before init() — call and await init() first`);
    }
    return this._data;
  }

  async init() {
    if (this._data) return this; // idempotent
    try {
      await this._connect();
      await this._pool.query(DDL);
      this._data = await this._loadFromPg();
      if (this._data === null) {
        // Nothing in Postgres yet: import the legacy JSON file if present.
        this._data = this._readJsonFile() || deepClone(this.empty);
        await this._flushToPg();
        console.log(`[${this.app}] imported existing data into PostgreSQL`);
      }
      this.mode = 'pg';
      console.log(`[${this.app}] storage: PostgreSQL (${this.url.replace(/:[^:@/]+@/, ':***@')})`);
    } catch (err) {
      this.mode = 'file';
      this._data = this._readJsonFile() || deepClone(this.empty);
      console.warn(`[${this.app}] WARNING: PostgreSQL unavailable (${err.message}). ` +
        `Falling back to JSON file storage at ${this.jsonFile}. ` +
        `Start the database (docker compose up -d) and restart to use PostgreSQL.`);
    }
    // Fill in any newly added collections (schema drift), mirroring old load().
    for (const k of Object.keys(this.empty)) {
      if (this._data[k] === undefined) this._data[k] = deepClone(this.empty[k]);
    }
    return this;
  }

  async _connect() {
    // Ensure the crestsuite database exists, then connect to it.
    const target = new URL(this.url);
    const dbName = target.pathname.replace(/^\//, '') || 'crestsuite';
    const probe = new Pool({ connectionString: this.url, max: 1, connectionTimeoutMillis: 3000 });
    try {
      await probe.query('SELECT 1');
      await probe.end();
      this._pool = new Pool({ connectionString: this.url, max: 4 });
      return;
    } catch (err) {
      await probe.end().catch(() => {});
      if (err.code !== '3D000') throw err; // not "database does not exist"
    }
    const adminUrl = new URL(this.url);
    adminUrl.pathname = '/' + (process.env.CRESTSUITE_ADMIN_DB || 'clockit');
    const admin = new Pool({ connectionString: adminUrl.toString(), max: 1, connectionTimeoutMillis: 3000 });
    try {
      const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
      if (!rows.length) await admin.query(`CREATE DATABASE "${dbName}"`);
    } finally {
      await admin.end().catch(() => {});
    }
    this._pool = new Pool({ connectionString: this.url, max: 4 });
    await this._pool.query('SELECT 1');
  }

  async _loadFromPg() {
    const recs = await this._pool.query(
      'SELECT collection, data FROM app_records WHERE app = $1 ORDER BY collection, seq', [this.app]);
    const metas = await this._pool.query(
      'SELECT key, data FROM app_meta WHERE app = $1', [this.app]);
    if (!recs.rows.length && !metas.rows.length) return null;
    const out = {};
    for (const r of recs.rows) (out[r.collection] = out[r.collection] || []).push(r.data);
    for (const m of metas.rows) out[m.key] = m.data;
    return out;
  }

  _readJsonFile() {
    try {
      if (this.jsonFile && fs.existsSync(this.jsonFile)) {
        return JSON.parse(fs.readFileSync(this.jsonFile, 'utf8'));
      }
    } catch (err) {
      console.warn(`[${this.app}] could not read ${this.jsonFile}: ${err.message}`);
    }
    return null;
  }

  /** Debounced persist — same call-and-forget contract the apps already use. */
  save() {
    if (this._timer) clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._timer = null;
      this.flushNow();
    }, 100);
  }

  /** Serialize flushes so writes never interleave. Returns a promise. */
  flushNow() {
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
    const snapshot = deepClone(this._data);
    this._flushChain = this._flushChain
      .then(() => (this.mode === 'pg' ? this._flushToPg(snapshot) : this._flushToFile(snapshot)))
      .catch((err) => console.error(`[${this.app}] persist failed: ${err.message}`));
    return this._flushChain;
  }

  async _flushToPg(snapshot) {
    const data = snapshot || this._data;
    const client = await this._pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM app_records WHERE app = $1', [this.app]);
      await client.query('DELETE FROM app_meta WHERE app = $1', [this.app]);
      for (const [key, value] of Object.entries(data)) {
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            const rec = value[i];
            const id = rec && rec.id !== undefined ? String(rec.id) : String(i);
            await client.query(
              'INSERT INTO app_records (app, collection, id, seq, data) VALUES ($1,$2,$3,$4,$5)',
              [this.app, key, id, i, JSON.stringify(rec)]
            );
          }
        } else {
          await client.query(
            'INSERT INTO app_meta (app, key, data) VALUES ($1,$2,$3)',
            [this.app, key, JSON.stringify(value)]
          );
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  }

  _flushToFile(snapshot) {
    const dir = path.dirname(this.jsonFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const tmp = this.jsonFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(snapshot || this._data, null, 2));
    fs.renameSync(tmp, this.jsonFile);
  }

  /** Replace the whole dataset (used by LeaveMS reset()). */
  reset(initial) {
    this._data = initial || deepClone(this.empty);
    this.flushNow();
    return this._data;
  }
}

const deepClone = (o) => JSON.parse(JSON.stringify(o));

module.exports = { JsonPgStore };
