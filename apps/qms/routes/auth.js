const express = require('express');
const { coll, byId, newId, save } = require('../lib/db');
const { hashPassword, verifyPassword, signToken, authRequired, requireRole, publicUser } = require('../lib/auth');
const trail = require('../lib/audittrail');

const router = express.Router();

// Department: 2–50 chars, starts with a letter, then letters/numbers/spaces and & . , / - ( )
const DEPT_RE = /^[A-Za-z][A-Za-z0-9 &.,/()-]{1,49}$/;
const validDepartment = d => DEPT_RE.test(String(d).trim());
const DEPT_ERROR = 'Invalid department format — use 2–50 characters starting with a letter (letters, numbers, spaces and & . , / - allowed), e.g. "Quality Assurance"';

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = coll('users').find(u => u.email.toLowerCase() === String(email || '').toLowerCase());
  if (!user || !user.active || !verifyPassword(user, password)) {
    trail.record(null, 'LOGIN_FAILED', 'session', null, `Failed login attempt for ${email}`);
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const token = signToken(user);
  trail.record(user, 'LOGIN', 'session', null, 'User logged in');
  res.json({ token, user: publicUser(user) });
});

router.get('/me', authRequired, (req, res) => res.json(publicUser(req.user)));

router.post('/logout', authRequired, (req, res) => {
  trail.record(req.user, 'LOGOUT', 'session', null, 'User logged out');
  res.json({ ok: true });
});

// ---- User management (admin only) ----
router.get('/users', authRequired, requireRole('admin'), (req, res) => {
  res.json(coll('users').map(publicUser));
});

router.post('/users', authRequired, requireRole('admin'), (req, res) => {
  const { email, name, role, department, password } = req.body || {};
  if (!email || !name || !password) return res.status(400).json({ error: 'email, name and password are required' });
  const cleanEmail = String(email).trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: 'Invalid email format — enter a valid address like name@company.com' });
  }
  if (!['admin', 'quality', 'employee'].includes(role)) return res.status(400).json({ error: 'role must be admin, quality or employee' });
  if (department && !validDepartment(department)) return res.status(400).json({ error: DEPT_ERROR });
  if (coll('users').some(u => u.email.toLowerCase() === cleanEmail.toLowerCase())) {
    return res.status(409).json({ error: 'A user with that email already exists' });
  }
  const { salt, hash } = hashPassword(password);
  const user = {
    id: newId('usr'), email: cleanEmail, name, role, department: department ? String(department).trim() : '',
    salt, passHash: hash, active: true, createdAt: new Date().toISOString()
  };
  coll('users').push(user);
  save();
  trail.record(req.user, 'CREATE', 'user', user.id, `Created user ${name} (${email}) with role ${role}`);
  res.status(201).json(publicUser(user));
});

router.put('/users/:id', authRequired, requireRole('admin'), (req, res) => {
  const user = byId('users', req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { name, role, department, active, password } = req.body || {};
  if (name) user.name = name;
  if (role && ['admin', 'quality', 'employee'].includes(role)) user.role = role;
  if (department !== undefined) {
    if (department && !validDepartment(department)) return res.status(400).json({ error: DEPT_ERROR });
    user.department = department;
  }
  if (active !== undefined) user.active = !!active;
  if (password) {
    const { salt, hash } = hashPassword(password);
    user.salt = salt; user.passHash = hash;
  }
  save();
  trail.record(req.user, 'UPDATE', 'user', user.id, `Updated user ${user.name}${password ? ' (password reset)' : ''}${active === false ? ' (deactivated)' : ''}`);
  res.json(publicUser(user));
});

module.exports = router;
