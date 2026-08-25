// Business rules from the CREST Employee PTO Policy.
const { load } = require('./db');

const LEAVE_TYPES = {
  annual:      { label: 'Annual Leave (AL)', color: '#1d4ed8' },
  sick:        { label: 'Medical/Sick Leave (SL)', color: '#b45309' },
  compensatory:{ label: 'Compensatory Leave', color: '#0f766e' },
  bereavement: { label: 'Bereavement Leave', color: '#475569' },
  lop:         { label: 'Loss of Pay (LOP)', color: '#b91c1c' },
  maternity:   { label: 'Maternity Leave', color: '#a21caf' },
  paternity:   { label: 'Paternity Leave', color: '#4338ca' },
  // Menstrual leave: female employees only, 1 day per calendar month.
  // `gender` hides the type everywhere for anyone it does not apply to;
  // `period: 'month'` means the entitlement resets monthly and never carries.
  mpl:         { label: 'Menstrual Leave (MPL)', color: '#db2777', gender: 'female', period: 'month' }
};

// A type carrying `gender` is only offered to users whose profile matches.
// Users with no gender recorded never see gender-restricted types.
function typeAllowedFor(typeDef, user) {
  if (!typeDef || !typeDef.gender) return true;
  return !!user && String(user.gender || '').toLowerCase() === typeDef.gender;
}

// Custom leave types defined by admins (db.leaveTypes). db.js auto-creates
// known collections only, so we lazily initialise the array here.
function customLeaveTypes() {
  const db = load();
  db.leaveTypes = db.leaveTypes || [];
  return db.leaveTypes;
}

// Built-in + custom types merged into one map keyed by type key.
// Built-ins are always active; custom entries carry { custom: true, annualDays, requiresAdmin, active }.
// Pass a user to get only the types that person may use — that is what makes a
// gender-restricted type invisible in the UI. Called with no user (e.g. for
// labelling an existing record) it returns every type.
function leaveTypeMap(user) {
  const map = {};
  for (const [k, v] of Object.entries(LEAVE_TYPES)) {
    if (user !== undefined && !typeAllowedFor(v, user)) continue;
    map[k] = { ...v, custom: false, active: true };
  }
  for (const t of customLeaveTypes())
    map[t.key] = { label: t.label, color: t.color || '#64748b', custom: true,
      annualDays: t.annualDays, requiresAdmin: !!t.requiresAdmin, active: t.active !== false };
  return map;
}

// Safe label lookup — works even for a deactivated/removed custom type.
function typeLabel(type) {
  const t = leaveTypeMap()[type];
  return t ? t.label : type;
}

// Defaults come from the PTO policy document; admins can override them
// (Policy Settings page → db.settings.policy). cfg() is the single source of truth.
const DEFAULT_POLICY = {
  annual: 20,              // AL working days / year (accrued quarterly)
  sick: 5,                 // SL working days / year
  bereavement: 5,          // max workdays per occasion
  paternity: 5,            // paid days per child
  paternityWindowDays: 28, // within 4 weeks of birth/adoption
  maternityWeeks: 26,      // calendar weeks, first 2 children
  maternityWeeksThird: 12, // from the 3rd child onwards
  mplPerMonth: 1,          // menstrual leave days per calendar month (female employees)
  compoffExpiryDays: 42,   // comp-off must be taken within 6 weeks
  carryForwardMax: 5,      // AL days carried into next year
  adminThreshold: 10,      // > N days needs Director/CEO approval
  advanceNoticeDays: 90    // planned-leave notice per policy
};
function cfg() {
  const db = load();
  return { ...DEFAULT_POLICY, ...(db.settings.policy || {}) };
}
// Effective policy for one employee: defaults → global rule → personal overrides.
function cfgFor(user) {
  return { ...cfg(), ...((user && user.policyOverrides) || {}) };
}
const CARRY_FORWARD_LAPSE = '-06-30'; // CF lapses June 30

// ---------- date helpers (all dates are 'YYYY-MM-DD' strings) ----------
function parseDate(s) { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmtDate(dt) { return dt.toISOString().slice(0, 10); }
function addDays(s, n) { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); }
function daysBetween(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
function isWeekend(s) { const d = parseDate(s).getUTCDay(); return d === 0 || d === 6; }
function todayStr() { return new Date().toISOString().slice(0, 10); }
function yearOf(s) { return Number(s.slice(0, 4)); }

function mandatoryHolidaySet(year) {
  const db = load();
  return new Set(db.holidays.filter(h => h.year === year && h.type === 'mandatory').map(h => h.date));
}

// Optional holidays the user selected count as holidays for that user.
function userOptionalSet(userId, year) {
  const db = load();
  const ids = new Set(db.optionalSelections.filter(s => s.userId === userId && s.year === year).map(s => s.holidayId));
  return new Set(db.holidays.filter(h => ids.has(h.id)).map(h => h.date));
}

function isWorkingDay(dateStr, holidaySets) {
  if (isWeekend(dateStr)) return false;
  for (const set of holidaySets) if (set.has(dateStr)) return false;
  return true;
}

// Count working days in [start, end] inclusive, skipping weekends + the user's holidays.
function workingDays(start, end, userId) {
  const sets = [];
  for (let y = yearOf(start); y <= yearOf(end); y++) {
    sets.push(mandatoryHolidaySet(y));
    if (userId != null) sets.push(userOptionalSet(userId, y));
  }
  let count = 0;
  for (let d = start; d <= end; d = addDays(d, 1)) {
    if (isWorkingDay(d, sets)) count++;
  }
  return count;
}

function nextWorkingDay(dateStr, userId) {
  let d = addDays(dateStr, 1);
  for (let i = 0; i < 30; i++) {
    if (workingDays(d, d, userId) === 1) return d;
    d = addDays(d, 1);
  }
  return d;
}
function prevWorkingDay(dateStr, userId) {
  let d = addDays(dateStr, -1);
  for (let i = 0; i < 30; i++) {
    if (workingDays(d, d, userId) === 1) return d;
    d = addDays(d, -1);
  }
  return d;
}

// ---------- annual leave accrual ----------
// 5 working days credited at the start of each calendar quarter.
// Mid-quarter joiners get a prorated credit for their joining quarter,
// rounded to the nearest integer.
function annualAccrued(user, asOf) {
  const year = yearOf(asOf);
  const joining = user.joiningDate || `${year}-01-01`;
  if (yearOf(joining) > year) return 0;
  const perQuarter = cfgFor(user).annual / 4;
  let accrued = 0;
  for (let q = 0; q < 4; q++) {
    const qStart = `${year}-${String(q * 3 + 1).padStart(2, '0')}-01`;
    const qEndMonth = q * 3 + 3;
    const qEnd = fmtDate(new Date(Date.UTC(year, qEndMonth, 0))); // last day of quarter
    if (asOf < qStart) break;
    if (joining <= qStart) {
      accrued += perQuarter;
    } else if (joining <= qEnd) {
      const total = daysBetween(qStart, qEnd) + 1;
      const remaining = daysBetween(joining, qEnd) + 1;
      accrued += perQuarter * remaining / total;
    }
  }
  return Math.round(accrued);
}

function sumAdjust(userId, year, leaveType, kind) {
  const db = load();
  return db.adjustments
    .filter(a => a.userId === userId && a.year === year && a.leaveType === leaveType && (!kind || a.kind === kind))
    .reduce((s, a) => s + a.days, 0);
}

function usedDays(userId, year, type, statuses = ['approved']) {
  const db = load();
  return db.leaves
    .filter(l => l.userId === userId && l.type === type && statuses.includes(l.status) && yearOf(l.startDate) === year)
    .reduce((s, l) => s + l.days, 0);
}

// Days used in one calendar month ('YYYY-MM') — monthly entitlements only.
function usedDaysInMonth(userId, month, type, statuses = ['approved']) {
  const db = load();
  return db.leaves
    .filter(l => l.userId === userId && l.type === type && statuses.includes(l.status)
      && l.startDate.slice(0, 7) === month)
    .reduce((s, l) => s + l.days, 0);
}

// Menstrual leave: a fresh entitlement every calendar month, nothing carried
// over and nothing accrued. `month` is the month the balance describes.
function mplBalance(user, year, asOf) {
  const perMonth = cfgFor(user).mplPerMonth;
  const month = asOf.slice(0, 7);
  const used = usedDaysInMonth(user.id, month, 'mpl');
  const pending = usedDaysInMonth(user.id, month, 'mpl', ['pending']);
  return {
    perMonth, month, used, pending,
    available: Math.max(0, perMonth - used),
    usedThisYear: usedDays(user.id, year, 'mpl')
  };
}

// Comp-off credits available as of a leave start date: approved, unused, not expired.
function compoffCredits(userId, asOf) {
  const db = load();
  return db.compoffs.filter(c =>
    c.userId === userId && c.status === 'approved' && !c.usedByLeaveId && c.expiresAt >= asOf);
}

// Full balance picture for one user for a leave-year.
function balances(user, year, asOf) {
  asOf = asOf || todayStr();
  const c = cfgFor(user);
  const accrued = annualAccrued(user, `${year}-12-31` < asOf ? `${year}-12-31` : asOf);
  const cf = Math.max(0, sumAdjust(user.id, year, 'annual', 'carry_forward'));
  const adj = sumAdjust(user.id, year, 'annual', 'adjustment');
  const cfActive = asOf <= `${year}${CARRY_FORWARD_LAPSE}`;
  const alUsed = usedDays(user.id, year, 'annual');
  const alPending = usedDays(user.id, year, 'annual', ['pending']);
  const alAvailable = Math.max(0, accrued + adj + (cfActive ? cf : 0) - alUsed);

  const sickUsed = usedDays(user.id, year, 'sick');
  const sickPending = usedDays(user.id, year, 'sick', ['pending']);

  const credits = compoffCredits(user.id, asOf);

  const out = {
    year,
    annual: {
      entitlement: c.annual, accrued, carryForward: cf, carryForwardActive: cfActive,
      adjustments: adj, used: alUsed, pending: alPending, available: alAvailable
    },
    sick: {
      entitlement: c.sick, used: sickUsed, pending: sickPending,
      available: Math.max(0, c.sick + sumAdjust(user.id, year, 'sick') - sickUsed)
    },
    compensatory: {
      available: credits.length,
      credits: credits.map(x => ({ id: x.id, workDate: x.workDate, expiresAt: x.expiresAt }))
    },
    bereavement: { maxPerOccasion: c.bereavement },
    paternity: { max: c.paternity, used: usedDays(user.id, year, 'paternity') },
    lopTaken: usedDays(user.id, year, 'lop'),
    custom: customBalances(user, year)
  };
  // Only present for employees the type applies to, so it never reaches
  // anyone else's dashboard, reports or exports.
  if (typeAllowedFor(LEAVE_TYPES.mpl, user)) out.mpl = mplBalance(user, year, asOf);
  return out;
}

// Generic balance for admin-defined leave types: flat annual entitlement, no carry-forward.
function customBalances(user, year) {
  const out = {};
  for (const t of customLeaveTypes()) {
    if (t.active === false) continue;
    const used = usedDays(user.id, year, t.key);
    const pending = usedDays(user.id, year, t.key, ['pending']);
    out[t.key] = { label: t.label, entitlement: t.annualDays, used, pending,
      available: Math.max(0, t.annualDays - used) };
  }
  return out;
}

// Validate a leave application. Returns { days, requiresAdmin, warnings } or throws { status, message }.
function validateApplication(user, { type, startDate, endDate, meta }) {
  const err = (message) => { const e = new Error(message); e.status = 400; throw e; };
  const types = leaveTypeMap();
  const typeDef = types[type];
  if (!typeDef || !typeDef.active) err('Unknown leave type.');
  // Gender-restricted types are refused server-side too, so a hidden type
  // cannot be applied for by calling the API directly.
  if (!typeAllowedFor(typeDef, user))
    err(`${typeDef.label} is available to ${typeDef.gender} employees only.`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate || '') || !/^\d{4}-\d{2}-\d{2}$/.test(endDate || '')) err('Invalid dates.');
  if (endDate < startDate) err('End date must be on or after start date.');
  if (yearOf(startDate) !== yearOf(endDate) && type !== 'maternity') err('A single request cannot span leave years. Please submit one request per year.');

  const warnings = [];
  const c = cfgFor(user);
  const today = todayStr();
  const year = yearOf(startDate);
  meta = meta || {};

  // Maternity is counted in calendar days; everything else in working days.
  let days;
  if (type === 'maternity') {
    days = daysBetween(startDate, endDate) + 1;
    const maxDays = (meta.thirdChildOnwards ? c.maternityWeeksThird : c.maternityWeeks) * 7;
    if (days > maxDays) err(`Maternity leave cannot exceed ${maxDays / 7} weeks (${maxDays} calendar days) ${meta.thirdChildOnwards ? 'from the third child onwards' : 'for the first two children'}.`);
  } else {
    days = workingDays(startDate, endDate, user.id);
    if (days === 0) err('The selected range contains no working days (weekends/holidays only).');
  }

  // Overlap with any existing pending/approved leave
  const db = load();
  const overlap = db.leaves.find(l => l.userId === user.id && ['pending', 'approved'].includes(l.status)
    && l.startDate <= endDate && l.endDate >= startDate);
  if (overlap) err(`Overlaps an existing ${overlap.status} ${typeLabel(overlap.type)} request (${overlap.startDate} to ${overlap.endDate}).`);

  const bal = balances(user, year, today > startDate ? today : startDate);

  // Custom types: generic flat annual entitlement, no carry-forward.
  if (typeDef.custom) {
    const cb = bal.custom[type];
    if (days + cb.pending > cb.available)
      err(`Insufficient ${typeDef.label} balance. Available: ${cb.available} day(s)` +
        (cb.pending ? ` with ${cb.pending} day(s) already pending approval` : '') + `, requested: ${days}.`);
    const requiresAdmin = typeDef.requiresAdmin || days > c.adminThreshold;
    if (days > c.adminThreshold)
      warnings.push(`Requests exceeding ${c.adminThreshold} days require Director/CEO approval.`);
    return { days, requiresAdmin, warnings };
  }

  switch (type) {
    case 'annual': {
      if (days + bal.annual.pending > bal.annual.available)
        err(`Insufficient annual leave balance. Available: ${bal.annual.available} day(s)` +
          (bal.annual.pending ? ` with ${bal.annual.pending} day(s) already pending approval` : '') + `, requested: ${days}.`);
      if (startDate > today && daysBetween(today, startDate) < c.advanceNoticeDays)
        warnings.push(`Policy requires planned leave to be applied ${c.advanceNoticeDays} days in advance. This request is short-notice and may be denied.`);
      break;
    }
    case 'sick': {
      if (days + bal.sick.pending > bal.sick.available) {
        err(`Insufficient sick leave balance (${bal.sick.available} day(s) left${bal.sick.pending ? `, ${bal.sick.pending} pending` : ''}). Per policy, please use Annual Leave for continued absence.`);
      }
      if (days >= 2 && !meta.certificate)
        err('Sick leave of 2 or more continuous working days requires a medical certificate from a registered practitioner. Please confirm you will provide one.');
      if (days > 30) warnings.push('Sick leave longer than 1 month requires Managing Director approval with a doctor’s report.');
      break;
    }
    case 'compensatory': {
      const credits = compoffCredits(user.id, startDate).filter(c => c.expiresAt >= endDate);
      if (days > credits.length)
        err(`You have ${credits.length} comp-off credit(s) valid through the requested dates (each must be used within 6 weeks of the worked day). Requested: ${days}.`);
      // cannot be clubbed with any other leave
      const nwd = nextWorkingDay(endDate, user.id);
      const pwd = prevWorkingDay(startDate, user.id);
      const adjacent = db.leaves.find(l => l.userId === user.id && l.status === 'approved' && l.type !== 'compensatory'
        && ((l.startDate <= nwd && l.endDate >= nwd) || (l.startDate <= pwd && l.endDate >= pwd)));
      if (adjacent) err('Compensatory leave cannot be clubbed with any other type of leave/vacation.');
      break;
    }
    case 'bereavement': {
      if (days > c.bereavement) err(`Bereavement leave cannot exceed ${c.bereavement} working days.`);
      if (!meta.relation) err('Please specify the immediate family member (parent, parent-in-law, spouse, child, brother, or sister).');
      break;
    }
    case 'lop': {
      if (bal.annual.available > 0)
        err(`LOP may only be requested after exhausting available leave. You still have ${bal.annual.available} day(s) of Annual Leave.`);
      warnings.push('LOP must be sanctioned in advance by the Director/CEO and is granted only in exceptional circumstances. No pay, leave accrual or service benefits for the LOP period.');
      break;
    }
    case 'maternity': {
      warnings.push('Please inform your manager at least 60 days before starting maternity leave.');
      break;
    }
    case 'mpl': {
      // One day per calendar month, so a request cannot straddle two months —
      // otherwise a single request could spend two months' entitlement.
      if (startDate.slice(0, 7) !== endDate.slice(0, 7))
        err('A menstrual leave request cannot span two months. Please apply separately for each month.');
      const month = startDate.slice(0, 7);
      const used = usedDaysInMonth(user.id, month, 'mpl');
      const pending = usedDaysInMonth(user.id, month, 'mpl', ['pending']);
      const left = c.mplPerMonth - used - pending;
      if (days > left)
        err(`Menstrual leave is limited to ${c.mplPerMonth} day(s) per calendar month. ` +
          (used ? `${used} day(s) already taken` : `${pending} day(s) already pending approval`) +
          ` for ${month}, so ${Math.max(0, left)} day(s) remain and you requested ${days}.`);
      break;
    }
    case 'paternity': {
      if (!meta.eventDate) err('Please provide the child’s date of birth / legal adoption date.');
      const remaining = c.paternity - bal.paternity.used;
      if (days > remaining) err(`Paternity leave is limited to ${c.paternity} paid days (${remaining} remaining).`);
      if (daysBetween(meta.eventDate, endDate) > c.paternityWindowDays)
        err('Paternity leave must be taken within the first 4 weeks of the child’s birth or legal adoption date.');
      break;
    }
  }

  const requiresAdmin = type === 'lop' || days > c.adminThreshold;
  if (days > c.adminThreshold)
    warnings.push(`Requests exceeding ${c.adminThreshold} days require Director/CEO approval.`);

  return { days, requiresAdmin, warnings };
}

// Transaction-style ledger of everything affecting a user's balances in a year.
function ledger(user, year) {
  const db = load();
  const entries = [];
  const c = cfgFor(user);
  const perQuarter = c.annual / 4;
  const cap = todayStr() < `${year}-12-31` ? todayStr() : `${year}-12-31`;
  const joining = user.joiningDate || `${year}-01-01`;
  if (yearOf(joining) <= year) {
    entries.push({ date: joining > `${year}-01-01` ? joining : `${year}-01-01`, label: 'Annual sick leave entitlement', leaveType: 'sick', delta: c.sick });
    customLeaveTypes().filter(t => t.active !== false).forEach(t =>
      entries.push({ date: joining > `${year}-01-01` ? joining : `${year}-01-01`, label: `${t.label} annual entitlement`, leaveType: t.key, delta: t.annualDays }));
    // Menstrual leave is credited monthly rather than once a year
    if (typeAllowedFor(LEAVE_TYPES.mpl, user) && c.mplPerMonth > 0) {
      for (let m = 1; m <= 12; m++) {
        const mStart = `${year}-${String(m).padStart(2, '0')}-01`;
        if (mStart > cap) break;
        if (mStart < joining) continue;
        entries.push({ date: mStart, label: 'Menstrual leave monthly entitlement', leaveType: 'mpl', delta: c.mplPerMonth });
      }
    }
    for (let q = 0; q < 4; q++) {
      const qStart = `${year}-${String(q * 3 + 1).padStart(2, '0')}-01`;
      const qEnd = fmtDate(new Date(Date.UTC(year, q * 3 + 3, 0)));
      if (cap < qStart) break;
      let credit = 0;
      if (joining <= qStart) credit = perQuarter;
      else if (joining <= qEnd) {
        const total = daysBetween(qStart, qEnd) + 1;
        credit = perQuarter * (daysBetween(joining, qEnd) + 1) / total;
      }
      credit = Math.round(credit * 100) / 100;
      if (credit > 0) entries.push({ date: joining > qStart ? joining : qStart, label: `Quarterly AL accrual (Q${q + 1}${credit < perQuarter ? ', prorated' : ''})`, leaveType: 'annual', delta: credit });
    }
  }
  db.adjustments.filter(a => a.userId === user.id && a.year === year).forEach(a =>
    entries.push({
      date: a.createdAt.slice(0, 10),
      label: (a.kind === 'carry_forward' ? 'Carry-forward credit (lapses 30 Jun)' : 'Balance adjustment') + (a.note ? ' — ' + a.note : ''),
      leaveType: a.leaveType, delta: a.days
    }));
  const types = leaveTypeMap();
  db.leaves.filter(l => l.userId === user.id && l.status === 'approved' && yearOf(l.startDate) === year).forEach(l =>
    entries.push({
      date: l.startDate, label: `${typeLabel(l.type)} taken (${l.startDate} → ${l.endDate})`,
      leaveType: l.type, delta: -l.days,
      // does not draw from an accrued balance (custom types DO draw from their flat entitlement)
      info: !['annual', 'sick', 'compensatory', 'mpl'].includes(l.type) && !(types[l.type] && types[l.type].custom)
    }));
  db.compoffs.filter(c => c.userId === user.id && c.status === 'approved' && yearOf(c.workDate) === year).forEach(c =>
    entries.push({ date: c.workDate, label: `Comp-off credit earned (expires ${c.expiresAt})`, leaveType: 'compensatory', delta: 1 }));
  return entries.sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = {
  LEAVE_TYPES, DEFAULT_POLICY, cfg, cfgFor,
  customLeaveTypes, leaveTypeMap, typeLabel, typeAllowedFor,
  parseDate, fmtDate, addDays, daysBetween, isWeekend, todayStr, yearOf,
  workingDays, balances, validateApplication, compoffCredits, annualAccrued, ledger
};
