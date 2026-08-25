// Authentication & authorization: scrypt password hashing, HMAC-signed session
// tokens (stateless), and role-based access middleware.
// Roles: admin > quality > employee
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { coll, byId } = require('./db');

const SECRET_FILE = path.join(__dirname, '..', 'data', 'secret.key');
let SECRET = null;
function getSecret() {
  if (SECRET) return SECRET;
  const dir = path.dirname(SECRET_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(SECRET_FILE)) {
    SECRET = fs.readFileSync(SECRET_FILE, 'utf8');
  } else {
    SECRET = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, SECRET, 'utf8');
  }
  return SECRET;
}

const ROLE_RANK = { employee: 1, quality: 2, admin: 3 };

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPassword(user, password) {
  if (!user || typeof password !== 'string' || !password) return false;
  if (user.salt && user.passHash) {
    const test = crypto.scryptSync(password, user.salt, 64).toString('hex');
    if (crypto.timingSafeEqual(Buffer.from(test, 'hex'), Buffer.from(user.passHash, 'hex'))) return true;
  }
  // CrestSuite: the portal directory (LeaveMS) is the master credential store.
  // SSO-provisioned users have a random local hash, so e-signatures and direct
  // login fall back to their portal password. No-op when running standalone.
  try {
    const bcrypt = require('bcryptjs');
    const dir = require('../../leavems/server/db').load().users
      .find(u => u.email.toLowerCase() === user.email.toLowerCase());
    if (dir && dir.active && bcrypt.compareSync(password, dir.passwordHash)) return true;
  } catch (e) { /* portal directory unavailable — standalone mode */ }
  return false;
}

// Token: base64url(payload).hmac — payload {uid, exp}
function signToken(user, hours = 12) {
  const payload = Buffer.from(JSON.stringify({
    uid: user.id, exp: Date.now() + hours * 3600 * 1000
  })).toString('base64url');
  const sig = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  return `${payload}.${sig}`;
}

function verifyToken(token) {
  if (!token || !token.includes('.')) return null;
  const [payload, sig] = token.split('.');
  const expect = crypto.createHmac('sha256', getSecret()).update(payload).digest('base64url');
  if (sig !== expect) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (data.exp < Date.now()) return null;
    const user = byId('users', data.uid);
    if (!user || !user.active) return null;
    return user;
  } catch (e) { return null; }
}

// Express middleware
function authRequired(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  const user = verifyToken(token);
  if (!user) return res.status(401).json({ error: 'Not authenticated' });
  req.user = user;
  next();
}

function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user || ROLE_RANK[req.user.role] < ROLE_RANK[minRole]) {
      return res.status(403).json({ error: `Requires ${minRole} role or higher` });
    }
    next();
  };
}

// Electronic signature: re-verify the acting user's password (Part 11 style
// two-component signature: identity token + password at time of signing).
function verifySignature(req) {
  const { signaturePassword } = req.body || {};
  if (!signaturePassword) return { ok: false, error: 'Electronic signature requires password re-entry' };
  if (!verifyPassword(req.user, signaturePassword)) return { ok: false, error: 'Electronic signature failed: invalid password' };
  const sigHash = crypto.createHash('sha256')
    .update(`${req.user.id}|${req.user.email}|${new Date().toISOString()}`)
    .digest('hex').slice(0, 16);
  return { ok: true, signature: { userId: req.user.id, name: req.user.name, email: req.user.email, signedAt: new Date().toISOString(), sigHash } };
}

function publicUser(u) {
  return { id: u.id, email: u.email, name: u.name, role: u.role, department: u.department, active: u.active, createdAt: u.createdAt };
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken, authRequired, requireRole, verifySignature, publicUser, ROLE_RANK };
