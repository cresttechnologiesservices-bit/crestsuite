// QMS data access — PostgreSQL-backed via the shared CrestSuite store.
// Same synchronous API as before (load/coll/byId/save/...); call init() once
// (and await it) before the app handles requests. Legacy data/db.json is
// imported on first run and used as a fallback when PostgreSQL is down.
const path = require('path');
const { JsonPgStore } = require('../../../shared/jsonpg');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const COLLECTIONS = [
  'users', 'documents', 'capas', 'audits', 'trainings',
  'apqp', 'ppap', 'fmea', 'spc', 'msa', 'fai',
  'serials', 'obsolescence', 'suppliers', 'counters'
];

const EMPTY = {};
for (const c of COLLECTIONS) EMPTY[c] = c === 'counters' ? {} : [];

const store = new JsonPgStore('qms', { jsonFile: DB_FILE, empty: EMPTY });

async function init() { await store.init(); }

function load() { return store.data; }

function save() { store.save(); }

function saveNow() { return store.flushNow(); }

function coll(name) { return load()[name]; }

function byId(name, id) { return coll(name).find(x => x.id === id); }

let idSeq = 0;
function newId(prefix) {
  idSeq = (idSeq + 1) % 46656;
  return `${prefix}_${Date.now().toString(36)}${idSeq.toString(36).padStart(3, '0')}`;
}

// Sequential business numbers per record type, e.g. CAPA-2026-0007
function nextNumber(kind, prefix) {
  const d = load();
  const year = new Date().getFullYear();
  const key = `${kind}-${year}`;
  d.counters[key] = (d.counters[key] || 0) + 1;
  save();
  return `${prefix}-${year}-${String(d.counters[key]).padStart(4, '0')}`;
}

module.exports = { init, load, save, saveNow, coll, byId, newId, nextNumber, DATA_DIR };
