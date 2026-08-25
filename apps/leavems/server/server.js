const path = require('path');
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const nodemailer = require('nodemailer');
const { init, load, save, nextId } = require('./db');
const { seed, DEFAULT_PASSWORD } = require('./seed');
const policy = require('./policy');

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'leavems-dev-secret-change-in-production';

const app = express();
app.use(express.json({ limit: '4mb' })); // allows small supporting-document attachments
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------- helpers ----------
const pub = (u) => u && ({
  id: u.id, email: u.email, name: u.name, role: u.role, isOwner: u.isOwner,
  managerId: u.managerId, joiningDate: u.joiningDate, active: u.active,
  gender: u.gender || ''
});

const GENDERS = ['female', 'male', 'other', ''];

function findUser(id) { return load().users.find(u => u.id === id); }

function auth(req, res, next) {
  const token = (req.headers.authorization || '').replace(/^Bearer /, '');
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = findUser(payload.id);
    if (!req.user || !req.user.active) return res.status(401).json({ error: 'Account is inactive.' });
    next();
  } catch {
    res.status(401).json({ error: 'Not authenticated.' });
  }
}
const adminOnly = (req, res, next) =>
  req.user.role === 'admin' ? next() : res.status(403).json({ error: 'Admin access required.' });

// In-app notification. Caller is responsible for save().
function notify(userId, text, link) {
  const db = load();
  db.notifications.push({ id: nextId(), userId, text, link: link || null, read: false, createdAt: new Date().toISOString() });
}
function notifyAdmins(text, link, exceptId) {
  load().users.filter(u => u.role === 'admin' && u.active && u.id !== exceptId)
    .forEach(u => notify(u.id, text, link));
}
// Approval-related notifications go to BOTH the employee's manager and all admins.
function notifyApprover(requester, requiresAdmin, text, link, exceptId) {
  const notified = new Set([requester.id, exceptId].filter(Boolean));
  const mgr = requester.managerId ? findUser(requester.managerId) : null;
  if (mgr && !notified.has(mgr.id)) { notify(mgr.id, text, link); notified.add(mgr.id); }
  load().users.filter(u => u.role === 'admin' && u.active && !notified.has(u.id))
    .forEach(u => { notify(u.id, text, link); notified.add(u.id); });
}

// ---------- outgoing email (SMTP via env; defaults suit a local MailHog/Mailpit) ----------
const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'localhost',
  port: Number(process.env.SMTP_PORT) || 1025,
  secure: process.env.SMTP_SECURE === 'true', // implicit TLS
  ...(process.env.SMTP_USER ? { auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } } : {})
});
const MAIL_FROM = process.env.SMTP_FROM || 'CrestSuite Portal <no-reply@crestsuite.local>';
// Fire-and-forget: never blocks the request; failures are logged only.
function sendMail(opts) {
  mailer.sendMail({ from: MAIL_FROM, ...opts })
    .catch(err => console.error('Email send failed:', err.message));
}

// Resolve who a leave request routes to for approval.
function approverInfo(requester, requiresAdmin) {
  if (requiresAdmin) return { approverRole: 'admin' };
  if (requester.managerId) return { approverUserId: requester.managerId };
  return { approverRole: 'admin' }; // safety net
}

function canDecide(me, leave) {
  const requester = findUser(leave.userId);
  if (!requester || requester.id === me.id) return false;
  if (me.role === 'admin') return true; // admins can decide anything (Director/CEO authority)
  if (leave.requiresAdmin) return false;
  return requester.managerId === me.id;
}

function leaveView(l) {
  const u = findUser(l.userId);
  const decider = l.decidedBy ? findUser(l.decidedBy) : null;
  const applier = l.appliedBy && l.appliedBy !== l.userId ? findUser(l.appliedBy) : null;
  return { ...l, userName: u ? u.name : '?', userEmail: u ? u.email : '?', decidedByName: decider ? decider.name : null,
    appliedByName: applier ? applier.name : null, typeLabel: policy.typeLabel(l.type) };
}

// ---------- auth ----------
app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body || {};
  const db = load();
  const user = db.users.find(u => u.email.toLowerCase() === String(email || '').toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password || '', user.passwordHash))
    return res.status(401).json({ error: 'Invalid email or password.' });
  if (!user.active) return res.status(403).json({ error: 'Account is inactive. Contact your administrator.' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, user: pub(user) });
});

app.post('/api/auth/change-password', auth, (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!bcrypt.compareSync(currentPassword || '', req.user.passwordHash))
    return res.status(400).json({ error: 'Current password is incorrect.' });
  if (!newPassword || newPassword.length < 8)
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  // Re-using the current password is not a password change; checked against the
  // stored hash so it holds even if the client skips its own check.
  if (bcrypt.compareSync(newPassword, req.user.passwordHash))
    return res.status(400).json({ error: 'New password cannot be the same as the current password.' });
  req.user.passwordHash = bcrypt.hashSync(newPassword, 10);
  save();
  res.json({ ok: true });
});

// ---------- me / dashboard ----------
app.get('/api/me', auth, (req, res) => {
  const year = Number(req.query.year) || new Date().getFullYear();
  const manager = req.user.managerId ? findUser(req.user.managerId) : null;
  res.json({
    user: pub(req.user),
    manager: manager ? { id: manager.id, name: manager.name, email: manager.email } : null,
    balances: policy.balances(req.user, year),
    // Scoped to this user, so a type they cannot use never reaches the browser
    leaveTypes: policy.leaveTypeMap(req.user)
  });
});

// ---------- holidays & optional selection ----------
app.get('/api/holidays', auth, (req, res) => {
  const db = load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const holidays = db.holidays.filter(h => h.year === year).sort((a, b) => a.date.localeCompare(b.date));
  const settings = db.settings[String(year)] || { optionalCount: 2 };
  const mySelections = db.optionalSelections.filter(s => s.userId === req.user.id && s.year === year).map(s => s.holidayId);
  const years = [...new Set(db.holidays.map(h => h.year))].sort();
  res.json({ year, years, holidays, optionalCount: settings.optionalCount, mySelections });
});

app.post('/api/holidays/select', auth, (req, res) => {
  const { holidayId, selected } = req.body || {};
  const db = load();
  const h = db.holidays.find(x => x.id === holidayId);
  if (!h || h.type !== 'optional') return res.status(400).json({ error: 'Not an optional holiday.' });
  const existing = db.optionalSelections.find(s => s.userId === req.user.id && s.holidayId === holidayId);
  if (selected) {
    if (existing) return res.json({ ok: true });
    if (h.date < policy.todayStr())
      return res.status(400).json({ error: 'This optional holiday has already passed.' });
    const count = db.optionalSelections.filter(s => s.userId === req.user.id && s.year === h.year).length;
    const max = (db.settings[String(h.year)] || { optionalCount: 2 }).optionalCount;
    if (count >= max) return res.status(400).json({ error: `You may choose at most ${max} optional holiday(s) for ${h.year}.` });
    db.optionalSelections.push({ id: nextId(), userId: req.user.id, year: h.year, holidayId });
  } else {
    if (!existing) return res.json({ ok: true });
    if (h.date < policy.todayStr())
      return res.status(400).json({ error: 'Cannot un-select a holiday that has already passed.' });
    db.optionalSelections.splice(db.optionalSelections.indexOf(existing), 1);
  }
  // let the manager and admins know the employee's holiday plan changed
  notifyApprover(req.user, false,
    `${req.user.name} ${selected ? 'selected' : 'removed'} the optional holiday ${h.name} (${h.date}).`, '#/calendar');
  save();
  res.json({ ok: true });
});

// admin: manage holiday calendar (updated every year)
app.post('/api/admin/holidays', auth, adminOnly, (req, res) => {
  const { date, name, type } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) return res.status(400).json({ error: 'Invalid date.' });
  if (!name || !['mandatory', 'optional'].includes(type)) return res.status(400).json({ error: 'Name and type (mandatory/optional) are required.' });
  const db = load();
  if (db.holidays.find(h => h.date === date)) return res.status(400).json({ error: 'A holiday already exists on that date.' });
  const h = { id: nextId(), year: policy.yearOf(date), date, name: name.trim(), type };
  db.holidays.push(h);
  if (!db.settings[String(h.year)]) db.settings[String(h.year)] = { optionalCount: 2 };
  save();
  res.json(h);
});

app.delete('/api/admin/holidays/:id', auth, adminOnly, (req, res) => {
  const db = load();
  const idx = db.holidays.findIndex(h => h.id === Number(req.params.id));
  if (idx === -1) return res.status(404).json({ error: 'Holiday not found.' });
  const h = db.holidays[idx];
  db.holidays.splice(idx, 1);
  // drop any employee selections of a removed optional holiday
  for (let i = db.optionalSelections.length - 1; i >= 0; i--)
    if (db.optionalSelections[i].holidayId === h.id) db.optionalSelections.splice(i, 1);
  save();
  res.json({ ok: true });
});

app.put('/api/admin/settings/:year', auth, adminOnly, (req, res) => {
  const year = String(Number(req.params.year));
  const n = Number(req.body.optionalCount);
  if (!Number.isInteger(n) || n < 0 || n > 10) return res.status(400).json({ error: 'Optional holiday count must be 0-10.' });
  const db = load();
  db.settings[year] = { ...(db.settings[year] || {}), optionalCount: n };
  save();
  res.json({ ok: true });
});

// ---------- leave requests ----------
app.get('/api/leaves', auth, (req, res) => {
  const db = load();
  const mine = db.leaves.filter(l => l.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(mine.map(leaveView));
});

app.post('/api/leaves', auth, (req, res) => {
  const { type, startDate, endDate, reason, meta, userId } = req.body || {};
  // Admins/owner may apply on behalf of any user
  let target = req.user;
  if (userId && Number(userId) !== req.user.id) {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Only admins can apply leave on behalf of another employee.' });
    target = findUser(Number(userId));
    if (!target || !target.active) return res.status(400).json({ error: 'Employee not found or inactive.' });
  }
  if (meta && meta.attachment) {
    const a = meta.attachment;
    if (!a.name || typeof a.dataUrl !== 'string' || !a.dataUrl.startsWith('data:') || a.dataUrl.length > 2_800_000)
      return res.status(400).json({ error: 'Attachment must be a file under ~2 MB.' });
    a.name = String(a.name).slice(0, 120);
  }
  let result;
  try {
    result = policy.validateApplication(target, { type, startDate, endDate, meta });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
  const db = load();
  const leave = {
    id: nextId(), userId: target.id, appliedBy: req.user.id, type, startDate, endDate,
    days: result.days, reason: (reason || '').trim(), meta: meta || {},
    requiresAdmin: result.requiresAdmin, ...approverInfo(target, result.requiresAdmin),
    status: 'pending', createdAt: new Date().toISOString(),
    warnings: result.warnings
  };
  db.leaves.push(leave);
  const onBehalf = target.id !== req.user.id;
  notifyApprover(target, leave.requiresAdmin,
    `${target.name} requested ${leave.days} day(s) of ${policy.typeLabel(type)} (${startDate} → ${endDate})${onBehalf ? ` — applied by ${req.user.name} on their behalf` : ''}.`,
    '#/approvals', req.user.id);
  if (onBehalf)
    notify(target.id, `${req.user.name} applied for ${leave.days} day(s) of ${policy.typeLabel(type)} (${startDate} → ${endDate}) on your behalf.`, '#/my-leaves');
  save();
  res.json({ leave: leaveView(leave), warnings: result.warnings });
});

app.post('/api/leaves/:id/cancel', auth, (req, res) => {
  const db = load();
  const leave = db.leaves.find(l => l.id === Number(req.params.id));
  if (!leave || leave.userId !== req.user.id) return res.status(404).json({ error: 'Request not found.' });
  if (leave.status === 'pending') leave.status = 'cancelled';
  else if (leave.status === 'approved' && leave.startDate > policy.todayStr()) leave.status = 'cancelled';
  else return res.status(400).json({ error: 'Only pending requests or approved future leave can be cancelled.' });
  leave.cancelledAt = new Date().toISOString();
  notifyApprover(req.user, leave.requiresAdmin,
    `${req.user.name} cancelled their ${policy.typeLabel(leave.type)} request (${leave.startDate} → ${leave.endDate}).`, '#/approvals');
  save();
  res.json(leaveView(leave));
});

// ---------- approvals ----------
app.get('/api/approvals', auth, (req, res) => {
  const db = load();
  const pending = db.leaves.filter(l => l.status === 'pending' && canDecide(req.user, l));
  const compPending = db.compoffs.filter(c => {
    if (c.status !== 'pending') return false;
    const u = findUser(c.userId);
    if (!u || u.id === req.user.id) return false;
    return req.user.role === 'admin' || u.managerId === req.user.id;
  }).map(c => ({ ...c, userName: (findUser(c.userId) || {}).name }));
  const now = Date.now();
  const withContext = pending.map(l => {
    const requester = findUser(l.userId);
    // other approved leave in the same team overlapping these dates — coverage conflict signal
    const overlaps = db.leaves.filter(o => o.status === 'approved' && o.userId !== l.userId
      && o.startDate <= l.endDate && o.endDate >= l.startDate
      && (findUser(o.userId) || {}).managerId === requester.managerId)
      .map(o => ({ name: (findUser(o.userId) || {}).name, type: o.type, startDate: o.startDate, endDate: o.endDate }));
    return { ...leaveView(l), agingDays: Math.floor((now - Date.parse(l.createdAt)) / 86400000), overlaps };
  });
  res.json({
    leaves: withContext.sort((a, b) => a.startDate.localeCompare(b.startDate)),
    compoffs: compPending
  });
});

app.post('/api/leaves/:id/decision', auth, (req, res) => {
  const { decision, note } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Decision must be approved or rejected.' });
  const db = load();
  const leave = db.leaves.find(l => l.id === Number(req.params.id));
  if (!leave) return res.status(404).json({ error: 'Request not found.' });
  if (leave.status !== 'pending') return res.status(400).json({ error: 'Request is not pending.' });
  if (!canDecide(req.user, leave)) return res.status(403).json({ error: 'You are not authorised to decide this request.' });

  if (decision === 'approved' && ['annual', 'sick'].includes(leave.type)) {
    // re-check balance at approval time (other requests may have been approved meanwhile)
    const requester = findUser(leave.userId);
    const asOf = leave.startDate > policy.todayStr() ? leave.startDate : policy.todayStr();
    const bal = policy.balances(requester, policy.yearOf(leave.startDate), asOf);
    const avail = leave.type === 'annual' ? bal.annual.available : bal.sick.available;
    if (leave.days > avail)
      return res.status(400).json({ error: `Cannot approve: the employee's ${leave.type} leave balance is now ${avail} day(s), less than the ${leave.days} requested.` });
  }
  if (decision === 'approved' && leave.type === 'compensatory') {
    // consume the oldest valid comp-off credits
    const credits = policy.compoffCredits(leave.userId, leave.startDate)
      .filter(c => c.expiresAt >= leave.endDate)
      .sort((a, b) => a.workDate.localeCompare(b.workDate));
    if (credits.length < leave.days) return res.status(400).json({ error: 'The employee no longer has enough valid comp-off credits.' });
    credits.slice(0, leave.days).forEach(c => {
      const rec = db.compoffs.find(x => x.id === c.id);
      rec.usedByLeaveId = leave.id;
    });
  }
  leave.status = decision;
  leave.decidedBy = req.user.id;
  leave.decidedAt = new Date().toISOString();
  leave.decisionNote = (note || '').trim();
  const requester = findUser(leave.userId);
  notify(leave.userId,
    `Your ${policy.typeLabel(leave.type)} request (${leave.startDate} → ${leave.endDate}) was ${decision} by ${req.user.name}${leave.decisionNote ? ': "' + leave.decisionNote + '"' : '.'}`,
    '#/my-leaves');
  // keep the manager and admins in the loop on every decision
  notifyApprover(requester, leave.requiresAdmin,
    `${requester.name}'s ${policy.typeLabel(leave.type)} request (${leave.startDate} → ${leave.endDate}) was ${decision} by ${req.user.name}.`,
    '#/approvals', req.user.id);
  // email the employee (async, never blocks the response); CC their manager
  // when an admin decided so the manager stays informed
  const mgr = requester.managerId ? findUser(requester.managerId) : null;
  sendMail({
    to: requester.email,
    ...(req.user.role === 'admin' && mgr && mgr.id !== req.user.id ? { cc: mgr.email } : {}),
    subject: `Leave ${decision}: ${policy.typeLabel(leave.type)} ${leave.startDate} → ${leave.endDate}`,
    text: `Hi ${requester.name},\n\nYour ${policy.typeLabel(leave.type)} request for ${leave.days} day(s) ` +
      `(${leave.startDate} → ${leave.endDate}) was ${decision} by ${req.user.name}.` +
      (leave.decisionNote ? `\n\nNote from the approver: "${leave.decisionNote}"` : '') +
      `\n\n— CrestSuite Leave Management`
  });
  save();
  res.json(leaveView(leave));
});

// ---------- comp-off credits ----------
app.get('/api/compoffs', auth, (req, res) => {
  const db = load();
  res.json(db.compoffs.filter(c => c.userId === req.user.id).sort((a, b) => b.workDate.localeCompare(a.workDate)));
});

app.post('/api/compoffs', auth, (req, res) => {
  const { workDate, note } = req.body || {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workDate || '')) return res.status(400).json({ error: 'Invalid work date.' });
  if (workDate > policy.todayStr()) return res.status(400).json({ error: 'Work date cannot be in the future.' });
  // must be a NON-working day (weekend or holiday)
  if (policy.workingDays(workDate, workDate, req.user.id) === 1)
    return res.status(400).json({ error: 'Comp-off is only for work done on a non-working day (weekend or holiday).' });
  const db = load();
  if (db.compoffs.find(c => c.userId === req.user.id && c.workDate === workDate && c.status !== 'rejected'))
    return res.status(400).json({ error: 'You already have a comp-off claim for that date.' });
  const expiresAt = policy.addDays(workDate, policy.cfgFor(req.user).compoffExpiryDays);
  const c = { id: nextId(), userId: req.user.id, workDate, note: (note || '').trim(),
    status: 'pending', expiresAt, usedByLeaveId: null, createdAt: new Date().toISOString() };
  db.compoffs.push(c);
  notifyApprover(req.user, false, `${req.user.name} claimed a comp-off credit for working on ${workDate}.`, '#/approvals');
  save();
  res.json(c);
});

app.post('/api/compoffs/:id/decision', auth, (req, res) => {
  const { decision } = req.body || {};
  if (!['approved', 'rejected'].includes(decision)) return res.status(400).json({ error: 'Invalid decision.' });
  const db = load();
  const c = db.compoffs.find(x => x.id === Number(req.params.id));
  if (!c) return res.status(404).json({ error: 'Not found.' });
  if (c.status !== 'pending') return res.status(400).json({ error: 'Not pending.' });
  const u = findUser(c.userId);
  if (!(req.user.role === 'admin' || (u && u.managerId === req.user.id)) || c.userId === req.user.id)
    return res.status(403).json({ error: 'Not authorised.' });
  c.status = decision;
  c.decidedBy = req.user.id;
  c.decidedAt = new Date().toISOString();
  notify(c.userId, `Your comp-off claim for ${c.workDate} was ${decision} by ${req.user.name}.${decision === 'approved' ? ` Use it before ${c.expiresAt}.` : ''}`, '#/compoff');
  save();
  res.json(c);
});

// ---------- notifications ----------
app.get('/api/notifications', auth, (req, res) => {
  const db = load();
  const mine = db.notifications.filter(n => n.userId === req.user.id)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
  res.json({ notifications: mine, unread: mine.filter(n => !n.read).length });
});

app.post('/api/notifications/read', auth, (req, res) => {
  const db = load();
  db.notifications.forEach(n => { if (n.userId === req.user.id) n.read = true; });
  save();
  res.json({ ok: true });
});

app.post('/api/notifications/clear', auth, (req, res) => {
  const db = load();
  for (let i = db.notifications.length - 1; i >= 0; i--)
    if (db.notifications[i].userId === req.user.id) db.notifications.splice(i, 1);
  save();
  res.json({ ok: true });
});

// ---------- team calendar (who's out) ----------
app.get('/api/calendar', auth, (req, res) => {
  const db = load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const month = Number(req.query.month) || new Date().getMonth() + 1;
  const first = `${year}-${String(month).padStart(2, '0')}-01`;
  const last = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  let visible;
  if (req.user.role === 'admin') visible = db.users.filter(u => u.active);
  else if (req.user.role === 'manager')
    visible = db.users.filter(u => u.active && (u.id === req.user.id || u.managerId === req.user.id));
  else // employees see themselves, their peers and their manager
    visible = db.users.filter(u => u.active &&
      (u.id === req.user.id || u.id === req.user.managerId ||
       (req.user.managerId && u.managerId === req.user.managerId)));
  const visibleIds = new Set(visible.map(u => u.id));

  // A gender-restricted type (e.g. menstrual leave) is shown as a generic
  // absence to colleagues it does not apply to — they can still see the person
  // is away. The employee themselves, and the managers/admins who approve and
  // report on it, see the real type.
  const allTypes = policy.leaveTypeMap();
  const showsRealType = (l) => {
    const def = allTypes[l.type];
    if (!def || !def.gender) return true;
    if (l.userId === req.user.id) return true;
    if (req.user.role === 'admin' || req.user.role === 'manager') return true;
    return policy.typeAllowedFor(def, req.user);
  };

  const leaves = db.leaves.filter(l => l.status === 'approved' && visibleIds.has(l.userId)
    && l.startDate <= last && l.endDate >= first)
    .map(l => showsRealType(l)
      ? { userId: l.userId, userName: (findUser(l.userId) || {}).name, type: l.type,
          typeLabel: policy.typeLabel(l.type), startDate: l.startDate, endDate: l.endDate }
      : { userId: l.userId, userName: (findUser(l.userId) || {}).name, type: 'private',
          typeLabel: 'On leave', startDate: l.startDate, endDate: l.endDate });
  const holidays = db.holidays.filter(h => h.date >= first && h.date <= last);
  res.json({ year, month, first, last, people: visible.map(pub), leaves, holidays });
});

// ---------- leave ledger ----------
app.get('/api/ledger', auth, (req, res) => {
  const userId = req.query.userId ? Number(req.query.userId) : req.user.id;
  if (userId !== req.user.id && req.user.role !== 'admin')
    return res.status(403).json({ error: 'You can only view your own ledger.' });
  const u = findUser(userId);
  if (!u) return res.status(404).json({ error: 'User not found.' });
  const year = Number(req.query.year) || new Date().getFullYear();
  res.json({ user: pub(u), year, entries: policy.ledger(u, year) });
});

// ---------- team (manager) ----------
app.get('/api/team', auth, (req, res) => {
  const db = load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const reports = db.users.filter(u => u.managerId === req.user.id && u.active);
  res.json(reports.map(u => ({
    user: pub(u),
    balances: policy.balances(u, year),
    upcoming: db.leaves.filter(l => l.userId === u.id && l.status === 'approved' && l.endDate >= policy.todayStr())
      .map(l => ({ type: l.type, startDate: l.startDate, endDate: l.endDate, days: l.days }))
  })));
});

// ---------- admin: users ----------
app.get('/api/admin/users', auth, adminOnly, (req, res) => {
  const db = load();
  res.json(db.users.map(u => ({
    ...pub(u),
    managerName: (findUser(u.managerId) || {}).name || null,
    hasPolicyOverrides: Object.keys(u.policyOverrides || {}).length > 0
  })));
});

app.post('/api/admin/users', auth, adminOnly, (req, res) => {
  const { email, name, role, managerId, joiningDate, password, gender } = req.body || {};
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email || '')) return res.status(400).json({ error: 'Valid email required.' });
  if (gender !== undefined && !GENDERS.includes(String(gender || '').toLowerCase()))
    return res.status(400).json({ error: 'Gender must be female, male or other.' });
  if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'Role must be admin, manager or employee.' });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate || '')) return res.status(400).json({ error: 'Joining date required (YYYY-MM-DD).' });
  const db = load();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase()))
    return res.status(400).json({ error: 'A user with that email already exists.' });
  if (managerId && !findUser(Number(managerId))) return res.status(400).json({ error: 'Manager not found.' });
  const u = {
    id: nextId(), email: email.trim(), name: (name || '').trim() || email.split('@')[0],
    role, isOwner: false, managerId: managerId ? Number(managerId) : null,
    joiningDate, passwordHash: bcrypt.hashSync(password || DEFAULT_PASSWORD, 10), active: true,
    gender: String(gender || '').toLowerCase()
  };
  db.users.push(u);
  save();
  res.json(pub(u));
});

app.put('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const db = load();
  const u = findUser(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.isOwner && !req.user.isOwner) return res.status(403).json({ error: 'Only the owner can modify the owner account.' });
  const { name, role, managerId, joiningDate, active, resetPassword, gender } = req.body || {};
  if (name !== undefined) u.name = String(name).trim() || u.name;
  if (gender !== undefined) {
    const g = String(gender || '').toLowerCase();
    if (!GENDERS.includes(g)) return res.status(400).json({ error: 'Gender must be female, male or other.' });
    u.gender = g;
  }
  if (role !== undefined) {
    if (!['admin', 'manager', 'employee'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    if (u.isOwner && role !== 'admin') return res.status(400).json({ error: 'The owner must remain an admin.' });
    u.role = role;
  }
  if (managerId !== undefined) {
    const mid = managerId ? Number(managerId) : null;
    if (mid === u.id) return res.status(400).json({ error: 'A user cannot be their own manager.' });
    if (mid && !findUser(mid)) return res.status(400).json({ error: 'Manager not found.' });
    u.managerId = mid;
  }
  if (joiningDate !== undefined) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(joiningDate)) return res.status(400).json({ error: 'Invalid joining date.' });
    u.joiningDate = joiningDate;
  }
  if (active !== undefined) {
    if (u.isOwner && !active) return res.status(400).json({ error: 'The owner account cannot be deactivated.' });
    u.active = !!active;
  }
  if (resetPassword) u.passwordHash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);
  save();
  res.json(pub(u));
});

app.delete('/api/admin/users/:id', auth, adminOnly, (req, res) => {
  const db = load();
  const u = findUser(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  if (u.isOwner) return res.status(400).json({ error: 'The owner account cannot be removed.' });
  if (u.id === req.user.id) return res.status(400).json({ error: 'You cannot remove your own account.' });
  // re-parent this person's reports to their manager so the structure stays intact
  db.users.forEach(x => { if (x.managerId === u.id) x.managerId = u.managerId || null; });
  const drop = (arr, key = 'userId') => {
    for (let i = arr.length - 1; i >= 0; i--) if (arr[i][key] === u.id) arr.splice(i, 1);
  };
  drop(db.leaves); drop(db.compoffs); drop(db.optionalSelections); drop(db.adjustments); drop(db.notifications);
  db.users.splice(db.users.indexOf(u), 1);
  save();
  res.json({ ok: true });
});

// ---------- admin: policy settings (leave counts per type) ----------
app.get('/api/admin/policy', auth, adminOnly, (req, res) => {
  res.json({ policy: policy.cfg(), defaults: policy.DEFAULT_POLICY });
});

const POLICY_LIMITS = {
  annual: [0, 60], sick: [0, 30], bereavement: [0, 15], paternity: [0, 30], mplPerMonth: [0, 5],
  paternityWindowDays: [1, 180], maternityWeeks: [1, 52], maternityWeeksThird: [1, 52],
  compoffExpiryDays: [7, 365], carryForwardMax: [0, 30], adminThreshold: [1, 60], advanceNoticeDays: [0, 365]
};
// Validate a partial policy object. Throws {status, message} on bad values.
function validatePolicyValues(body) {
  const next = {};
  for (const [key, [lo, hi]] of Object.entries(POLICY_LIMITS)) {
    if (body[key] === undefined || body[key] === null || body[key] === '') continue;
    const n = Number(body[key]);
    if (!Number.isInteger(n) || n < lo || n > hi) {
      const e = new Error(`${key} must be an integer between ${lo} and ${hi}.`);
      e.status = 400; throw e;
    }
    next[key] = n;
  }
  return next;
}

app.put('/api/admin/policy', auth, adminOnly, (req, res) => {
  let next;
  try { next = validatePolicyValues(req.body || {}); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const db = load();
  db.settings.policy = { ...(db.settings.policy || {}), ...next };
  save();
  res.json({ policy: policy.cfg() });
});

// ---------- admin: custom leave types ----------
// Built-in types stay code-defined (their rules are policy-specific); admins can
// add generic types with a flat annual entitlement, no carry-forward.
// Validate a leave-type body. Throws {status, message} on bad values.
function validateLeaveTypeBody(body) {
  const err = (message) => { const e = new Error(message); e.status = 400; throw e; };
  const label = String(body.label || '').trim();
  if (!label || label.length > 60) err('Label is required (max 60 characters).');
  const days = Number(body.annualDays);
  if (!Number.isInteger(days) || days < 0 || days > 365) err('Annual entitlement must be an integer between 0 and 365.');
  const color = String(body.color || '#64748b').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) err('Color must be a hex value like #0f766e.');
  return { label, annualDays: days, color, requiresAdmin: !!body.requiresAdmin };
}

app.get('/api/admin/leave-types', auth, adminOnly, (req, res) => {
  res.json({
    builtin: Object.entries(policy.LEAVE_TYPES).map(([key, t]) => ({ key, ...t })),
    custom: policy.customLeaveTypes()
  });
});

app.post('/api/admin/leave-types', auth, adminOnly, (req, res) => {
  let vals;
  try { vals = validateLeaveTypeBody(req.body || {}); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  const types = policy.customLeaveTypes();
  const id = nextId();
  let key = 'custom-' + vals.label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  if (!key.replace('custom-', '') || policy.leaveTypeMap()[key]) key = 'custom-' + id;
  const t = { id, key, ...vals, active: true, createdAt: new Date().toISOString() };
  types.push(t);
  save();
  res.json(t);
});

app.put('/api/admin/leave-types/:id', auth, adminOnly, (req, res) => {
  const t = policy.customLeaveTypes().find(x => x.id === Number(req.params.id));
  if (!t) return res.status(404).json({ error: 'Leave type not found.' });
  const body = req.body || {};
  let vals;
  try { vals = validateLeaveTypeBody({ ...t, ...body }); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  Object.assign(t, vals);
  if (body.active !== undefined) t.active = !!body.active; // deactivate keeps history; key stays stable
  save();
  res.json(t);
});

// ---------- admin: per-employee policy overrides ----------
app.get('/api/admin/users/:id/policy', auth, adminOnly, (req, res) => {
  const u = findUser(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  res.json({
    user: pub(u),
    global: policy.cfg(),
    overrides: u.policyOverrides || {},
    effective: policy.cfgFor(u)
  });
});

// Body: { overrides: { annual: 24, ... } } — full replacement; omitted/blank keys revert to the global rule.
app.put('/api/admin/users/:id/policy', auth, adminOnly, (req, res) => {
  const u = findUser(Number(req.params.id));
  if (!u) return res.status(404).json({ error: 'User not found.' });
  let overrides;
  try { overrides = validatePolicyValues((req.body || {}).overrides || {}); }
  catch (e) { return res.status(e.status || 500).json({ error: e.message }); }
  if (Object.keys(overrides).length) u.policyOverrides = overrides;
  else delete u.policyOverrides;
  notify(u.id, Object.keys(overrides).length
    ? `${req.user.name} set a personal leave policy for you (${Object.entries(overrides).map(([k, v]) => `${k}: ${v}`).join(', ')}). Other values follow the company rule.`
    : `${req.user.name} removed your personal leave policy — the company-wide rule now applies to you.`, '#/ledger');
  save();
  res.json({ overrides: u.policyOverrides || {}, effective: policy.cfgFor(u) });
});

// ---------- admin: balance adjustments & reports ----------
app.post('/api/admin/adjustments', auth, adminOnly, (req, res) => {
  const { userId, year, kind, leaveType, days, note } = req.body || {};
  const u = findUser(Number(userId));
  if (!u) return res.status(400).json({ error: 'User not found.' });
  if (!['carry_forward', 'adjustment'].includes(kind)) return res.status(400).json({ error: 'Kind must be carry_forward or adjustment.' });
  if (!['annual', 'sick'].includes(leaveType)) return res.status(400).json({ error: 'Leave type must be annual or sick.' });
  const n = Number(days);
  if (!Number.isFinite(n) || n === 0) return res.status(400).json({ error: 'Days must be a non-zero number.' });
  if (kind === 'carry_forward') {
    if (leaveType !== 'annual') return res.status(400).json({ error: 'Carry-forward applies to annual leave only.' });
    const db0 = load();
    const existing = db0.adjustments.filter(a => a.userId === u.id && a.year === Number(year) && a.kind === 'carry_forward')
      .reduce((s, a) => s + a.days, 0);
    const cfMax = policy.cfgFor(u).carryForwardMax;
    if (existing + n > cfMax)
      return res.status(400).json({ error: `Carry-forward cannot exceed ${cfMax} days (already ${existing}).` });
  }
  const db = load();
  db.adjustments.push({
    id: nextId(), userId: u.id, year: Number(year), kind, leaveType, days: n,
    note: (note || '').trim(), byUserId: req.user.id, createdAt: new Date().toISOString()
  });
  notify(u.id, `Your ${leaveType} leave balance for ${year} was ${kind === 'carry_forward' ? 'credited with a carry-forward of' : 'adjusted by'} ${n > 0 ? '+' : ''}${n} day(s) by ${req.user.name}.`, '#/ledger');
  save();
  res.json({ ok: true });
});

app.get('/api/admin/report', auth, adminOnly, (req, res) => {
  const db = load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = db.users.filter(u => u.active).map(u => {
    // Bradford factor S² × D over the year's approved sick leave — flags frequent short absences
    const spells = db.leaves.filter(l => l.userId === u.id && l.type === 'sick' && l.status === 'approved' && policy.yearOf(l.startDate) === year);
    const sickDays = spells.reduce((s, l) => s + l.days, 0);
    return {
      user: pub(u),
      managerName: (findUser(u.managerId) || {}).name || null,
      balances: policy.balances(u, year),
      bradford: spells.length * spells.length * sickDays
    };
  });
  const allLeaves = db.leaves.map(leaveView).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json({ year, rows, leaves: allLeaves });
});

// ---------- admin: CSV exports ----------
function toCsv(rows) {
  const escCell = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return rows.map(r => r.map(escCell).join(',')).join('\r\n');
}

app.get('/api/admin/export/balances', auth, adminOnly, (req, res) => {
  const db = load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = [['Name', 'Email', 'Role', 'Manager', 'Joining date', 'AL accrued', 'AL carry-forward', 'AL used', 'AL available', 'SL used', 'SL available', 'Comp-off credits', 'LOP days']];
  db.users.filter(u => u.active).forEach(u => {
    const b = policy.balances(u, year);
    rows.push([u.name, u.email, u.role, (findUser(u.managerId) || {}).name || '', u.joiningDate,
      b.annual.accrued, b.annual.carryForward, b.annual.used, b.annual.available,
      b.sick.used, b.sick.available, b.compensatory.available, b.lopTaken]);
  });
  res.type('text/csv').set('Content-Disposition', `attachment; filename="leave-balances-${year}.csv"`).send(toCsv(rows));
});

app.get('/api/admin/export/leaves', auth, adminOnly, (req, res) => {
  const db = load();
  const year = Number(req.query.year) || new Date().getFullYear();
  const rows = [['Employee', 'Email', 'Leave type', 'Start', 'End', 'Days', 'Status', 'Applied on', 'Decided by', 'Decision note', 'Reason']];
  db.leaves.filter(l => policy.yearOf(l.startDate) === year).forEach(l => {
    const u = findUser(l.userId) || {};
    rows.push([u.name, u.email, policy.typeLabel(l.type), l.startDate, l.endDate, l.days, l.status,
      (l.createdAt || '').slice(0, 10), l.decidedBy ? (findUser(l.decidedBy) || {}).name : '', l.decisionNote || '', l.reason || '']);
  });
  res.type('text/csv').set('Content-Disposition', `attachment; filename="leave-requests-${year}.csv"`).send(toCsv(rows));
});

// ---------- admin: year-end carry-forward processing ----------
app.post('/api/admin/yearend', auth, adminOnly, (req, res) => {
  const fromYear = Number(req.body.fromYear);
  if (!Number.isInteger(fromYear) || fromYear < 2000) return res.status(400).json({ error: 'Valid fromYear required.' });
  const db = load();
  const tag = `Year-end carry-forward from ${fromYear}`;
  const results = [];
  db.users.filter(u => u.active).forEach(u => {
    if (db.adjustments.find(a => a.userId === u.id && a.year === fromYear + 1 && a.kind === 'carry_forward' && a.note === tag))
      return; // already processed — idempotent
    // remaining AL at 31 Dec (own-year carry-forward has lapsed by then)
    const b = policy.balances(u, fromYear, `${fromYear}-12-31`);
    const remaining = b.annual.accrued + b.annual.adjustments - b.annual.used;
    const existingCf = db.adjustments.filter(a => a.userId === u.id && a.year === fromYear + 1 && a.kind === 'carry_forward')
      .reduce((s, a) => s + a.days, 0);
    const carry = Math.min(policy.cfgFor(u).carryForwardMax - existingCf, Math.max(0, remaining));
    if (carry <= 0) return;
    db.adjustments.push({
      id: nextId(), userId: u.id, year: fromYear + 1, kind: 'carry_forward', leaveType: 'annual',
      days: carry, note: tag, byUserId: req.user.id, createdAt: new Date().toISOString()
    });
    notify(u.id, `${carry} unused Annual Leave day(s) from ${fromYear} were carried forward to ${fromYear + 1}. They lapse on 30 June ${fromYear + 1}.`, '#/ledger');
    results.push({ user: u.name, carried: carry });
  });
  save();
  res.json({ processed: results.length, results });
});

// ---------- fallback ----------
app.use((req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found.' });
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

if (require.main === module) {
  (async () => {
    await init();
    seed(); // no-op if data already exists
    app.listen(PORT, () => console.log(`LeaveMS running at http://localhost:${PORT}`));
  })().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = app;
