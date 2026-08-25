// Seeds users, the holiday calendar and settings.
// Holidays are NOT hardcoded here: they live in ../data/holiday-calendar.json
// (editable without touching code; admins can also manage them in the UI).
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const { init, load, save, reset, nextId } = require('./db');

const HOLIDAY_FILE = path.join(__dirname, '..', 'data', 'holiday-calendar.json');

const DEFAULT_PASSWORD = 'Welcome@123';

function nameFromEmail(email) {
  return email.split('@')[0].split(/[._]/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function seed({ force = false } = {}) {
  const db = load();
  if (db.users.length > 0 && !force) return false;
  reset();
  const d = load();
  const hash = bcrypt.hashSync(DEFAULT_PASSWORD, 10);

  const addUser = (email, role, managerId, opts = {}) => {
    const u = {
      id: nextId(),
      email,
      name: opts.name || nameFromEmail(email),
      role,                       // 'admin' | 'manager' | 'employee'
      isOwner: !!opts.isOwner,
      managerId: managerId || null,
      joiningDate: opts.joiningDate || '2024-01-01',
      passwordHash: hash,
      active: true
    };
    d.users.push(u);
    return u;
  };

  // Owner / super admin
  const owner = addUser('hirkant@gmail.com', 'admin', null, { isOwner: true, name: 'Hirkant (Owner)', joiningDate: '2020-01-01' });

  // Admins (report to owner)
  const adminEmails = [
    'raj@crest-technologies.com',
    'prabha@crestaerospace.com',
    'ashwini.kumar@crestaerospace.com',
    'mayurraju.shah@crestaerospace.com',
    'pradnya.n@crestaerospace.com'
  ];
  const admins = adminEmails.map(e => addUser(e, 'admin', owner.id, { joiningDate: '2021-06-01' }));

  // Managers (report to first admin)
  const managerEmails = [
    'vishal.bhandary@crestaerospace.com',
    'jayanthkumar.singh@crestaerospace.com',
    'gundappa.chatla@crestaerospace.com',
    'prajwal.kulkarni@crestaerospace.com',
    'sooriyaprakash.m@crestaerospace.com'
  ];
  const managers = managerEmails.map(e => addUser(e, 'manager', admins[0].id, { joiningDate: '2022-03-01' }));

  // Sample employees — two per manager (for testing the employee flows)
  const employeeNames = [
    'amit.sharma', 'neha.patil', 'rohan.desai', 'kavya.iyer', 'arjun.rao',
    'sneha.kulkarni', 'vivek.menon', 'divya.nair', 'karthik.reddy', 'pooja.hegde'
  ];
  employeeNames.forEach((n, i) => {
    addUser(`${n}@crestaerospace.com`, 'employee', managers[i % managers.length].id,
      { joiningDate: i === 9 ? '2026-05-15' : '2023-08-01' }); // one mid-quarter 2026 joiner to exercise proration
  });

  // Holiday calendar from the external data file (one entry per year).
  try {
    const calendar = JSON.parse(fs.readFileSync(HOLIDAY_FILE, 'utf8'));
    for (const [year, cfg] of Object.entries(calendar)) {
      (cfg.holidays || []).forEach((h) =>
        d.holidays.push({ id: nextId(), year: Number(year), date: h.date, name: h.name, type: h.type }));
      d.settings[year] = { optionalCount: cfg.optionalCount ?? 2 };
    }
  } catch (err) {
    console.warn(`No holiday calendar seeded (${HOLIDAY_FILE}: ${err.message}). ` +
      'Admins can add holidays under Administration → Manage Holidays.');
  }

  save();
  return true;
}

if (require.main === module) {
  (async () => {
    await init();
    const created = seed({ force: process.argv.includes('--force') });
    console.log(created ? 'Database seeded.' : 'Database already exists — run with --force to re-seed.');
    process.exit(0);
  })().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { seed, DEFAULT_PASSWORD };
