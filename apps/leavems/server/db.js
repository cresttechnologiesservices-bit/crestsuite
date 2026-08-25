// LeaveMS data access — PostgreSQL-backed via the shared CrestSuite store.
// Same synchronous API as before (load/save/nextId/reset); call init() once
// (and await it) before the app handles requests. Legacy data/db.json is
// imported on first run and used as a fallback when PostgreSQL is down.
const path = require('path');
const { JsonPgStore } = require('../../../shared/jsonpg');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

const EMPTY = {
  users: [],
  holidays: [],          // { id, year, date: 'YYYY-MM-DD', name, type: 'mandatory'|'optional' }
  settings: {},          // { [year]: { optionalCount } }
  leaves: [],            // leave requests
  compoffs: [],          // comp-off work-day credits
  optionalSelections: [],// { id, userId, year, holidayId }
  adjustments: [],       // { id, userId, year, kind: 'carry_forward'|'adjustment', leaveType, days, note, byUserId, createdAt }
  notifications: [],     // { id, userId, text, link, read, createdAt }
  nextId: 1
};

const store = new JsonPgStore('leavems', { jsonFile: DB_FILE, empty: EMPTY });

async function init() { await store.init(); }

function load() { return store.data; }

function save() { store.save(); }

function nextId() {
  const d = load();
  return d.nextId++;
}

function reset(initial) {
  return store.reset(initial);
}

module.exports = { init, load, save, nextId, reset, DB_FILE };
