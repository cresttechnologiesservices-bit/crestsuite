// Append-only, tamper-evident audit trail (21 CFR Part 11 style).
// Entries are written as JSON lines; each entry carries a SHA-256 hash chained
// to the previous entry so any retroactive edit breaks the chain.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

const TRAIL_FILE = path.join(DATA_DIR, 'audit-trail.jsonl');
let lastHash = null;

function initLastHash() {
  if (lastHash !== null) return;
  lastHash = 'GENESIS';
  if (fs.existsSync(TRAIL_FILE)) {
    const lines = fs.readFileSync(TRAIL_FILE, 'utf8').trim().split('\n').filter(Boolean);
    if (lines.length) {
      try { lastHash = JSON.parse(lines[lines.length - 1]).hash; } catch (e) { /* keep GENESIS */ }
    }
  }
}

function record(user, action, entity, entityId, details) {
  initLastHash();
  const entry = {
    ts: new Date().toISOString(),
    userId: user ? user.id : 'system',
    userName: user ? user.name : 'System',
    action,            // e.g. CREATE, UPDATE, DELETE, APPROVE, SIGN, LOGIN, ARCHIVE
    entity,            // e.g. document, capa, audit
    entityId: entityId || null,
    details: details || '',
    prevHash: lastHash
  };
  entry.hash = crypto.createHash('sha256')
    .update(entry.prevHash + JSON.stringify([entry.ts, entry.userId, entry.action, entry.entity, entry.entityId, entry.details]))
    .digest('hex');
  lastHash = entry.hash;
  fs.appendFileSync(TRAIL_FILE, JSON.stringify(entry) + '\n', 'utf8');
  return entry;
}

function readAll(filter) {
  if (!fs.existsSync(TRAIL_FILE)) return [];
  let entries = fs.readFileSync(TRAIL_FILE, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
  if (filter) {
    if (filter.entity) entries = entries.filter(e => e.entity === filter.entity);
    if (filter.entityId) entries = entries.filter(e => e.entityId === filter.entityId);
    if (filter.userId) entries = entries.filter(e => e.userId === filter.userId);
  }
  return entries.reverse(); // newest first
}

// Verify the hash chain end-to-end; returns {valid, checked, brokenAt}
function verifyChain() {
  if (!fs.existsSync(TRAIL_FILE)) return { valid: true, checked: 0, brokenAt: null };
  const lines = fs.readFileSync(TRAIL_FILE, 'utf8').trim().split('\n').filter(Boolean);
  let prev = 'GENESIS';
  for (let i = 0; i < lines.length; i++) {
    const e = JSON.parse(lines[i]);
    const expect = crypto.createHash('sha256')
      .update(prev + JSON.stringify([e.ts, e.userId, e.action, e.entity, e.entityId, e.details]))
      .digest('hex');
    if (e.prevHash !== prev || e.hash !== expect) {
      return { valid: false, checked: lines.length, brokenAt: i + 1 };
    }
    prev = e.hash;
  }
  return { valid: true, checked: lines.length, brokenAt: null };
}

module.exports = { record, readAll, verifyChain };
