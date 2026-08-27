/*
 * CrestSuite portal — unified login and launcher for ClockIT, LeaveMS and QMS.
 *
 * - LeaveMS and QMS run in-process, mounted at /leavems and /qms.
 * - ClockIT runs as its own processes (Vite build served statically at
 *   /clockit, API proxied at /clockit/api -> localhost:3000).
 * - One portal login (validated against the LeaveMS user directory, which is
 *   the superset of accounts); clicking a launcher icon mints that app's own
 *   token so the user lands inside it already signed in.
 */
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');

// Load CrestSuite/.env so real SMTP etc. can be configured without shell env vars.
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Sub-apps run in-process. Their PostgreSQL-backed stores are initialized
// (and seeded) in main() below before the portal starts listening.
const leavemsApp = require('../apps/leavems/server/server');
const leavemsDb = require('../apps/leavems/server/db');
const leavemsSeed = require('../apps/leavems/server/seed');
const qmsApp = require('../apps/qms/server');
const qmsDb = require('../apps/qms/lib/db');
const qmsAuth = require('../apps/qms/lib/auth');
const qmsSeed = require('../apps/qms/lib/seed');

// const PORT = Number(process.env.PORTAL_PORT || 8080);
const PORT = Number(process.env.PORT || process.env.PORTAL_PORT || 8080);
const PORTAL_SECRET = process.env.PORTAL_SECRET || 'crestsuite-portal-dev-secret-change-in-production';
const LEAVEMS_JWT_SECRET = process.env.JWT_SECRET || 'leavems-dev-secret-change-in-production';
const CLOCKIT_API = new URL(process.env.CLOCKIT_API_URL || 'http://127.0.0.1:3000');
const CLOCKIT_DIST = path.join(__dirname, '..', 'apps', 'clockit', 'apps', 'web', 'dist');
const PORTAL_URL = process.env.PORTAL_URL || `http://localhost:${PORT}`;

// Outbound mail for password resets. Defaults target the dev MailHog container
// (started with ClockIT's docker compose, UI at http://localhost:8025); point
// these at a real SMTP server in production via CrestSuite/.env.
const SMTP_FROM = process.env.SMTP_FROM || 'CrestSuite Portal <no-reply@crestsuite.local>';
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT || 1025),
  secure: process.env.SMTP_SECURE === 'true', // true = implicit TLS (usually port 465)
  auth: process.env.SMTP_USER
    ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
    : undefined,
});

const app = express();

// ---------- helpers ----------
function getCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
}

// ---------- User Management access ----------
// User administration lives in its own CrestSuite app rather than inside
// ClockIT / LeaveMS / QMS. These two accounts are seeded with access; anyone
// who has access can grant or revoke it for other people. The owner always
// keeps access so the workspace can never lock itself out.
const USERMGMT_BOOTSTRAP = ['raj@crest-technologies.com', 'hirkant@gmail.com'];

// Recorded on the directory record because leave entitlements depend on it
// (LeaveMS menstrual leave). Blank = not stated, which grants nothing.
const GENDERS = ['female', 'male', 'other', ''];

function canManageUsers(user) {
  return !!user && (!!user.isOwner || user.userMgmtAccess === true);
}

// Grant access to the bootstrap accounts once. Only fills in the flag when it
// has never been set, so a deliberate revoke is not undone on every restart.
function seedUserMgmtAccess() {
  const db = leavemsDb.load();
  let changed = false;
  for (const u of db.users) {
    if (u.userMgmtAccess === undefined && USERMGMT_BOOTSTRAP.includes(u.email.toLowerCase())) {
      u.userMgmtAccess = true;
      changed = true;
    }
  }
  if (changed) leavemsDb.save();
}

// Verifies the portal cookie and re-resolves the user from the directory.
// Returns { claims, user } or null.
function portalSession(req) {
  try {
    const claims = jwt.verify(getCookie(req, 'portal_token'), PORTAL_SECRET);
    const user = leavemsDb.load().users.find(
      (u) => u.email.toLowerCase() === String(claims.email).toLowerCase()
    );
    if (!user || !user.active) return null;
    return { claims, user };
  } catch {
    return null;
  }
}

// Keep the QMS-local credential in sync with the portal password, so QMS
// e-signatures (password re-entry) and direct QMS login use the same one.
function syncQmsCredential(email, password) {
  try {
    const qu = qmsDb.coll('users').find((u) => u.email.toLowerCase() === email.toLowerCase());
    if (qu) {
      const { salt, hash } = qmsAuth.hashPassword(password);
      qu.salt = salt;
      qu.passHash = hash;
      qmsDb.save();
    }
  } catch (e) { console.warn('QMS credential sync skipped:', e.message); }
}

/**
 * Push a directory edit into ClockIT so Team → Members matches User Management.
 * Fire-and-forget: ClockIT being down must never block user administration, so
 * failures are logged and the save still succeeds. Users ClockIT has not seen
 * yet are simply skipped — they pick the values up when they first sign in.
 */
function syncClockitUser(user) {
  const payload = JSON.stringify({
    email: user.email,
    name: user.name,
    role: user.isOwner ? 'owner' : user.role,
    active: user.active !== false,
  });
  const request = http.request(
    {
      hostname: CLOCKIT_API.hostname,
      port: CLOCKIT_API.port,
      path: '/api/internal/directory-sync',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-internal-secret': PORTAL_SECRET,
      },
    },
    (res) => {
      if (res.statusCode >= 400) console.warn('ClockIT directory sync failed:', res.statusCode);
      res.resume();
    }
  );
  request.on('error', (e) => console.warn('ClockIT directory sync skipped:', e.message));
  request.end(payload);
}

// Tiny page that stores an app token in localStorage (same origin as the
// mounted app) and jumps into the app.
function ssoPage(res, script, redirect) {
  res.type('html').send(
    `<!DOCTYPE html><meta charset="utf-8"><title>Signing in…</title><script>${script}location.replace(${JSON.stringify(redirect)});</script>`
  );
}

// ---------- ClockIT API proxy (must precede any body parsing) ----------
app.use(['/clockit/api', '/clockify/api'], (req, res) => {
  // Server-to-server endpoints are never reachable from a browser
  if (/^\/internal(\/|$)/.test(req.url)) {
    return res.status(404).json({ error: 'not_found' });
  }
  const proxied = http.request(
    {
      hostname: CLOCKIT_API.hostname,
      port: CLOCKIT_API.port,
      path: '/api' + req.url,
      method: req.method,
      headers: { ...req.headers, host: CLOCKIT_API.host },
    },
    (upstream) => {
      res.writeHead(upstream.statusCode, upstream.headers);
      upstream.pipe(res);
    }
  );
  proxied.on('error', () => {
    if (!res.headersSent) {
      res.status(502).json({ error: 'ClockIT API is not running. Start it with: npm run clockit:api' });
    }
  });
  req.pipe(proxied);
});

// ---------- portal API ----------
app.post('/portal/api/login', express.json(), (req, res) => {
  const { email, password } = req.body || {};
  const user = leavemsDb
    .load()
    .users.find((u) => u.email.toLowerCase() === String(email || '').toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash)) {
    return res.status(401).json({ error: 'Invalid email or password.' });
  }
  if (!user.active) return res.status(403).json({ error: 'Account is inactive. Contact your administrator.' });
  const role = user.isOwner ? 'owner' : user.role;
  syncQmsCredential(user.email, password);
  const token = jwt.sign({ email: user.email, name: user.name, role }, PORTAL_SECRET, { expiresIn: '12h' });
  res.cookie('portal_token', token, { httpOnly: true, sameSite: 'lax', maxAge: 12 * 3600 * 1000 });
  res.json({ user: { email: user.email, name: user.name, role } });
});

app.post('/portal/api/change-password', express.json(), (req, res) => {
  const s = portalSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in.' });
  const { currentPassword, newPassword } = req.body || {};
  if (!bcrypt.compareSync(currentPassword || '', s.user.passwordHash)) {
    return res.status(400).json({ error: 'Current password is incorrect.' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  // Re-using the current password is not a password change; checked against the
  // stored hash so it holds even if the client skips its own check.
  if (bcrypt.compareSync(newPassword, s.user.passwordHash)) {
    return res.status(400).json({ error: 'New password cannot be the same as the current password.' });
  }
  s.user.passwordHash = bcrypt.hashSync(newPassword, 10);
  leavemsDb.save();
  syncQmsCredential(s.user.email, newPassword);
  res.json({ ok: true });
});

// Single-use reset tokens: the token embeds a fingerprint of the current
// password hash, so it stops working the moment the password changes.
const resetFingerprint = (u) =>
  crypto.createHash('sha256').update(u.passwordHash).digest('hex').slice(0, 16);

app.post('/portal/api/forgot-password', express.json(), (req, res) => {
  const email = String((req.body || {}).email || '').toLowerCase().trim();
  const user = leavemsDb.load().users.find((u) => u.email.toLowerCase() === email);
  // Always answer generically so the endpoint can't be used to probe accounts.
  res.json({ ok: true, message: 'If that account exists, a reset link has been emailed.' });
  if (!user || !user.active) return;
  const token = jwt.sign(
    { email: user.email, purpose: 'pwreset', fp: resetFingerprint(user) },
    PORTAL_SECRET,
    { expiresIn: '30m' }
  );
  const link = `${PORTAL_URL}/reset-password?token=${encodeURIComponent(token)}`;
  mailer
    .sendMail({
      from: SMTP_FROM,
      to: user.email,
      subject: 'CrestSuite password reset',
      text: `Hi ${user.name},\n\nA password reset was requested for your CrestSuite account.\nOpen this link within 30 minutes to choose a new password:\n\n${link}\n\nIf you did not request this, you can ignore this email.`,
      html: `<p>Hi ${user.name},</p><p>A password reset was requested for your CrestSuite account. The link below is valid for <strong>30 minutes</strong>:</p><p><a href="${link}">Reset your password</a></p><p style="color:#64748b">If you did not request this, you can ignore this email.</p>`,
    })
    .then(() => console.log(`Password reset email sent to ${user.email}`))
    .catch((err) => console.error(`Failed to send reset email to ${user.email}: ${err.message} — check SMTP_* settings in CrestSuite/.env`));
});

app.post('/portal/api/reset-password', express.json(), (req, res) => {
  const { token, newPassword } = req.body || {};
  let claims;
  try {
    claims = jwt.verify(token, PORTAL_SECRET);
    if (claims.purpose !== 'pwreset') throw new Error('wrong purpose');
  } catch {
    return res.status(400).json({ error: 'This reset link is invalid or has expired. Request a new one.' });
  }
  const user = leavemsDb.load().users.find((u) => u.email.toLowerCase() === String(claims.email).toLowerCase());
  if (!user || !user.active || resetFingerprint(user) !== claims.fp) {
    return res.status(400).json({ error: 'This reset link has already been used or is no longer valid.' });
  }
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }
  user.passwordHash = bcrypt.hashSync(newPassword, 10);
  leavemsDb.save();
  syncQmsCredential(user.email, newPassword);
  res.json({ ok: true });
});

app.get('/portal/api/me', (req, res) => {
  const s = portalSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in.' });
  res.json({
    user: {
      email: s.user.email,
      name: s.user.name,
      role: s.claims.role,
      // Drives the User Management launcher tile and route guard
      userMgmtAccess: canManageUsers(s.user),
    },
  });
});

app.post('/portal/api/logout', (req, res) => {
  res.clearCookie('portal_token');
  res.clearCookie('session'); // ClockIT's session cookie lives on this origin too
  res.json({ ok: true });
});

app.get('/portal/api/status', (req, res) => {
  const status = {
    leavems: true,
    qms: true,
    clockit: false,
    clockitWeb: fs.existsSync(path.join(CLOCKIT_DIST, 'index.html')),
  };
  let sent = false;
  const done = () => {
    if (!sent) { sent = true; res.json(status); }
  };
  const ping = http.get(
    { hostname: CLOCKIT_API.hostname, port: CLOCKIT_API.port, path: '/health', timeout: 1500 },
    (r) => { status.clockit = r.statusCode === 200; r.resume(); done(); }
  );
  ping.on('timeout', () => ping.destroy());
  ping.on('error', done);
});

// ---------- User Management app API ----------
// The CrestSuite directory (shared with LeaveMS) is the single source of
// truth for accounts and passwords across all three apps, so this is where
// people are created, edited and removed.
const requireUserMgmt = (req, res, next) => {
  const s = portalSession(req);
  if (!s) return res.status(401).json({ error: 'Not signed in.' });
  if (!canManageUsers(s.user)) {
    return res.status(403).json({ error: 'You do not have access to User Management.' });
  }
  req.portal = s;
  next();
};

const publicUser = (u) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.isOwner ? 'owner' : u.role,
  isOwner: !!u.isOwner,
  managerId: u.managerId ?? null,
  joiningDate: u.joiningDate,
  active: u.active !== false,
  gender: u.gender || '',
  userMgmtAccess: canManageUsers(u),
});

app.get('/portal/api/usermgmt/users', requireUserMgmt, (req, res) => {
  const db = leavemsDb.load();
  const byId = new Map(db.users.map((u) => [u.id, u]));
  res.json({
    me: { id: req.portal.user.id, email: req.portal.user.email },
    users: db.users
      .map((u) => ({
        ...publicUser(u),
        managerName: (byId.get(u.managerId) || {}).name || null,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  });
});

app.post('/portal/api/usermgmt/users', requireUserMgmt, express.json(), (req, res) => {
  const { email, name, role, managerId, joiningDate, password, gender } = req.body || {};
  const cleanEmail = String(email || '').trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Enter a valid email address.' });
  }
  if (!['admin', 'manager', 'employee'].includes(role)) {
    return res.status(400).json({ error: 'Role must be admin, manager or employee.' });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate || '')) {
    return res.status(400).json({ error: 'Joining date is required (YYYY-MM-DD).' });
  }
  if (!GENDERS.includes(String(gender || '').toLowerCase())) {
    return res.status(400).json({ error: 'Gender must be female, male or other.' });
  }
  const db = leavemsDb.load();
  if (db.users.some((u) => u.email.toLowerCase() === cleanEmail.toLowerCase())) {
    return res.status(400).json({ error: 'A user with that email already exists.' });
  }
  if (managerId && !db.users.some((u) => u.id === Number(managerId))) {
    return res.status(400).json({ error: 'Manager not found.' });
  }
  const user = {
    id: leavemsDb.nextId(),
    email: cleanEmail,
    name: String(name || '').trim() || cleanEmail.split('@')[0],
    role,
    isOwner: false,
    managerId: managerId ? Number(managerId) : null,
    joiningDate,
    passwordHash: bcrypt.hashSync(password || leavemsSeed.DEFAULT_PASSWORD, 10),
    active: true,
    userMgmtAccess: false,
    // Drives gender-specific leave entitlements in LeaveMS (e.g. menstrual leave)
    gender: String(gender || '').toLowerCase(),
  };
  db.users.push(user);
  leavemsDb.save();
  res.json(publicUser(user));
});

app.put('/portal/api/usermgmt/users/:id', requireUserMgmt, express.json(), (req, res) => {
  const db = leavemsDb.load();
  const user = db.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.isOwner && !req.portal.user.isOwner) {
    return res.status(403).json({ error: 'Only the owner can modify the owner account.' });
  }
  const { name, role, managerId, joiningDate, active, resetPassword, gender } = req.body || {};
  if (name !== undefined) user.name = String(name).trim() || user.name;
  if (gender !== undefined) {
    const g = String(gender || '').toLowerCase();
    if (!GENDERS.includes(g)) return res.status(400).json({ error: 'Gender must be female, male or other.' });
    user.gender = g;
  }
  if (role !== undefined) {
    if (!['admin', 'manager', 'employee'].includes(role)) {
      return res.status(400).json({ error: 'Invalid role.' });
    }
    if (user.isOwner && role !== 'admin') {
      return res.status(400).json({ error: 'The owner must remain an admin.' });
    }
    user.role = role;
  }
  if (managerId !== undefined) {
    const mid = managerId ? Number(managerId) : null;
    if (mid === user.id) return res.status(400).json({ error: 'A user cannot be their own manager.' });
    if (mid && !db.users.some((u) => u.id === mid)) {
      return res.status(400).json({ error: 'Manager not found.' });
    }
    user.managerId = mid;
  }
  if (joiningDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) {
      return res.status(400).json({ error: 'Invalid joining date.' });
    }
    user.joiningDate = joiningDate;
  }
  if (active !== undefined) {
    if (user.isOwner && !active) {
      return res.status(400).json({ error: 'The owner account cannot be deactivated.' });
    }
    user.active = !!active;
    // Keep the QMS copy in step so a deactivated person cannot sign in there
    try {
      const qu = qmsDb.coll('users').find((u) => u.email.toLowerCase() === user.email.toLowerCase());
      if (qu) { qu.active = user.active; qmsDb.save(); }
    } catch (e) { console.warn('QMS active sync skipped:', e.message); }
  }
  if (resetPassword) {
    user.passwordHash = bcrypt.hashSync(leavemsSeed.DEFAULT_PASSWORD, 10);
    syncQmsCredential(user.email, leavemsSeed.DEFAULT_PASSWORD);
  }
  leavemsDb.save();
  // Keep ClockIT's Team list in step with the directory
  syncClockitUser(user);
  res.json(publicUser(user));
});

// Grant or revoke access to User Management itself
app.post('/portal/api/usermgmt/users/:id/access', requireUserMgmt, express.json(), (req, res) => {
  const db = leavemsDb.load();
  const user = db.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  const grant = !!(req.body || {}).access;
  if (!grant) {
    if (user.id === req.portal.user.id) {
      return res.status(400).json({ error: 'You cannot remove your own access.' });
    }
    if (user.isOwner) {
      return res.status(400).json({ error: "The owner's access cannot be removed." });
    }
  }
  if (grant && !user.active) {
    return res.status(400).json({ error: 'Activate the account before granting access.' });
  }
  user.userMgmtAccess = grant;
  leavemsDb.save();
  res.json(publicUser(user));
});

app.delete('/portal/api/usermgmt/users/:id', requireUserMgmt, (req, res) => {
  const db = leavemsDb.load();
  const user = db.users.find((u) => u.id === Number(req.params.id));
  if (!user) return res.status(404).json({ error: 'User not found.' });
  if (user.isOwner) return res.status(400).json({ error: 'The owner account cannot be removed.' });
  if (user.id === req.portal.user.id) {
    return res.status(400).json({ error: 'You cannot remove your own account.' });
  }
  // Re-parent this person's reports so the org structure stays intact
  db.users.forEach((x) => { if (x.managerId === user.id) x.managerId = user.managerId || null; });
  const drop = (arr, key = 'userId') => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] === user.id) arr.splice(i, 1);
  };
  drop(db.leaves); drop(db.compoffs); drop(db.optionalSelections);
  drop(db.adjustments); drop(db.notifications);
  db.users.splice(db.users.indexOf(user), 1);
  leavemsDb.save();
  // Deactivate the QMS copy — its quality records must be retained for audit
  try {
    const qu = qmsDb.coll('users').find((u) => u.email.toLowerCase() === user.email.toLowerCase());
    if (qu) { qu.active = false; qmsDb.save(); }
  } catch (e) { console.warn('QMS deactivate skipped:', e.message); }
  res.json({ ok: true });
});

// ---------- SSO handoffs (launcher icons point here) ----------
app.get('/portal/sso/leavems', (req, res) => {
  const s = portalSession(req);
  if (!s) return res.redirect('/');
  const token = jwt.sign({ id: s.user.id }, LEAVEMS_JWT_SECRET, { expiresIn: '12h' });
  ssoPage(res, `localStorage.setItem('lms_token', ${JSON.stringify(token)});`, '/leavems/#/dashboard');
});

app.get('/portal/sso/qms', (req, res) => {
  const s = portalSession(req);
  if (!s) return res.redirect('/');
  const users = qmsDb.coll('users');
  let qu = users.find((u) => u.email.toLowerCase() === s.user.email.toLowerCase());
  if (!qu) {
    // First visit from the portal: auto-provision with a role mapped from the
    // directory role. Password is random — QMS is only entered via SSO, and an
    // admin can set one from the QMS user screen if direct login is wanted.
    const role = s.claims.role === 'owner' || s.claims.role === 'admin' ? 'admin'
      : s.claims.role === 'manager' ? 'quality' : 'employee';
    const { salt, hash } = qmsAuth.hashPassword(crypto.randomBytes(24).toString('hex'));
    qu = {
      id: qmsDb.newId('usr'), email: s.user.email, name: s.user.name, role,
      department: '', salt, passHash: hash, active: true, createdAt: new Date().toISOString(),
    };
    users.push(qu);
    qmsDb.saveNow();
  }
  if (!qu.active) return res.redirect('/?error=' + encodeURIComponent('Your QMS account is inactive.'));
  const token = qmsAuth.signToken(qu);
  ssoPage(
    res,
    `localStorage.setItem('qms_token', ${JSON.stringify(token)});` +
      `localStorage.setItem('qms_user', ${JSON.stringify(JSON.stringify(qmsAuth.publicUser(qu)))});`,
    '/qms/#/dashboard'
  );
});

app.get(['/portal/sso/clockit', '/portal/sso/clockify'], (req, res) => {
  const s = portalSession(req);
  if (!s) return res.redirect('/');
  const token = jwt.sign(
    { email: s.user.email, name: s.user.name, role: s.claims.role },
    PORTAL_SECRET,
    { expiresIn: '120s' }
  );
  res.redirect('/clockit/?sso=' + encodeURIComponent(token));
});

// ---------- sub-applications ----------
app.use('/leavems', leavemsApp);
app.use('/qms', qmsApp);

// ---------- ClockIT web (built SPA) ----------
// Anything still pointing at the old /clockify path lands on /clockit
app.get(['/clockify', '/clockify/*'], (req, res) =>
  res.redirect(308, '/clockit' + req.originalUrl.slice('/clockify'.length))
);
app.use('/clockit', express.static(CLOCKIT_DIST));
app.get(['/clockit', '/clockit/*'], (req, res) => {
  const index = path.join(CLOCKIT_DIST, 'index.html');
  if (fs.existsSync(index)) return res.sendFile(index);
  res.status(503).type('html').send(`<!DOCTYPE html><meta charset="utf-8"><title>ClockIT not built</title>
<body style="font-family:system-ui;max-width:640px;margin:80px auto;line-height:1.6">
<h2>⏱ ClockIT web app is not built yet</h2>
<p>From <code>apps/clockit</code> run:</p>
<pre>npm install
docker compose up -d
npm run db:migrate
npm -w apps/web run build</pre>
<p>and start the API with <code>npm run dev:api</code>. Then reload this page, or go
<a href="/">back to the portal</a>.</p></body>`);
});

// ---------- portal launcher ----------
app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

async function main() {
  await leavemsDb.init();
  leavemsSeed.seed();          // no-op when users already exist
  seedUserMgmtAccess();        // bootstrap User Management access once
  await qmsDb.init();
  qmsSeed.ensureSeed();        // no-op when users already exist
  app.listen(PORT, () => {
    console.log(`CrestSuite portal running at http://localhost:${PORT}`);
    console.log('  LeaveMS  -> /leavems   QMS -> /qms   ClockIT -> /clockit');
    console.log('  User Management -> /usermgmt (restricted)');
  });
}

main().catch((err) => {
  console.error('Portal failed to start:', err);
  process.exit(1);
});
