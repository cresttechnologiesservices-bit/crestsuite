/* CREST Leave Management System — SPA frontend */
(() => {
  const $app = document.getElementById('app');
  let token = localStorage.getItem('lms_token');
  let me = null;            // { user, manager, balances, leaveTypes }
  let approvalCount = 0;
  let unreadCount = 0;

  // ---------- utilities ----------
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (d) => d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
  const fmtDT = (iso) => iso ? new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const curYear = () => new Date().getFullYear();

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  // Styled in-app dialogs replacing the browser confirm()/prompt() popups.
  // uiConfirm(message) -> Promise<boolean>; uiPrompt(message) -> Promise<string|null>.
  function uiDialog({ message, withInput = false, confirmLabel = 'Confirm', danger = false }) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:16px';
      wrap.innerHTML = `
        <div style="background:#fff;border-radius:10px;box-shadow:0 20px 50px rgba(0,0,0,.3);max-width:420px;width:100%;padding:22px">
          <div style="white-space:pre-line;color:#334155;font-size:14px;line-height:1.5">${esc(message)}</div>
          ${withInput ? '<input id="uidlg-input" class="input" style="width:100%;margin-top:12px;padding:8px 10px;border:1px solid #cbd5e1;border-radius:6px;font-size:14px">' : ''}
          <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
            <button id="uidlg-cancel" class="btn btn-sm">Cancel</button>
            <button id="uidlg-ok" class="btn btn-sm ${danger ? 'btn-red' : 'btn-green'}">${esc(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(wrap);
      const input = wrap.querySelector('#uidlg-input');
      const done = (value) => { wrap.remove(); document.removeEventListener('keydown', onKey); resolve(value); };
      const cancelValue = withInput ? null : false;
      const okValue = () => (withInput ? (input.value || '') : true);
      const onKey = (e) => {
        if (e.key === 'Escape') done(cancelValue);
        if (e.key === 'Enter' && withInput) done(okValue());
      };
      document.addEventListener('keydown', onKey);
      wrap.onclick = (e) => { if (e.target === wrap) done(cancelValue); };
      wrap.querySelector('#uidlg-cancel').onclick = () => done(cancelValue);
      wrap.querySelector('#uidlg-ok').onclick = () => done(okValue());
      if (input) input.focus();
    });
  }
  const uiConfirm = (message, opts = {}) => uiDialog({ message, ...opts });
  const uiPrompt = (message, opts = {}) => uiDialog({ message, withInput: true, confirmLabel: 'OK', ...opts });

  async function api(path, opts = {}) {
    const res = await fetch('/leavems/api' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && token) { logout(); throw new Error('Session expired. Please log in again.'); }
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  function logout() {
    token = null; me = null;
    localStorage.removeItem('lms_token');
    // Return to the CrestSuite portal launcher (consistent across all apps)
    location.href = '/';
  }

  // ---------- routing ----------
  window.addEventListener('hashchange', render);

  // Leave types come from the API (/me → leaveTypes): built-ins plus any
  // admin-defined custom types, each with { label, color, custom, active }.
  const activeLeaveTypes = () =>
    Object.entries(me?.leaveTypes || {}).filter(([, t]) => t.active !== false);

  async function render() {
    if (!token) { renderLogin(); return; }
    if (!me) {
      try { me = await api('/me'); }
      catch (e) { if (token) { toast(e.message, 'error'); } return; }
    }
    const route = (location.hash || '#/dashboard').slice(2) || 'dashboard';
    const isMgr = me.user.role === 'manager' || me.user.role === 'admin';
    const isAdmin = me.user.role === 'admin';

    try {
      const [a, n] = await Promise.all([api('/approvals'), api('/notifications')]);
      approvalCount = a.leaves.length + a.compoffs.length;
      unreadCount = n.unread;
    } catch { approvalCount = 0; unreadCount = 0; }

    const nav = [
      { id: 'dashboard', label: '🏠 Dashboard' },
      { id: 'notifications', label: '🔔 Notifications', badge: unreadCount },
      { id: 'apply', label: '📝 Apply Leave' },
      { id: 'my-leaves', label: '📋 My Requests' },
      { id: 'compoff', label: '⏱️ Comp-Off' },
      { id: 'holidays', label: '📅 Holiday Calendar' },
      { id: 'calendar', label: '🗓️ Team Calendar' },
      { id: 'ledger', label: '📒 My Ledger' },
      ...(isMgr ? [{ section: me.user.role === 'admin' ? 'Management' : 'Manager' },
        { id: 'approvals', label: '✅ Approvals', badge: approvalCount },
        { id: 'team', label: '👥 My Team' }] : []),
      ...(isAdmin ? [{ section: 'Administration' },
        { id: 'admin-users', label: '🧑‍💼 Employee Policies' },
        { id: 'admin-holidays', label: '🗓️ Manage Holidays' },
        { id: 'admin-policy', label: '⚙️ Policy Settings' },
        { id: 'admin-reports', label: '📊 Reports' }] : [])
    ];

    $app.innerHTML = `
      <div class="layout">
        <aside class="sidebar">
          <div class="brand">CREST<span>Leave Management</span></div>
          <nav class="nav">
            ${nav.map(n => n.section
              ? `<div class="nav-section">${esc(n.section)}</div>`
              : `<a href="#/${n.id}" class="${route === n.id ? 'active' : ''}">${n.label}
                  ${n.badge ? `<span class="badge">${n.badge}</span>` : ''}</a>`).join('')}
          </nav>
          <div class="sidebar-user">
            <div class="u-name">${esc(me.user.name)}</div>
            <div class="u-role">${esc(me.user.role)}${me.user.isOwner ? ' · owner' : ''}</div>
            <button id="btn-password">Change password</button>
            <button id="btn-logout">Sign out</button>
          </div>
        </aside>
        <main class="main" id="view"></main>
      </div>`;
    document.getElementById('btn-logout').onclick = logout;
    document.getElementById('btn-password').onclick = () => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal"><h3>Change password</h3>
        <div class="form-grid">
          <div class="field full"><label>Current password</label><input type="password" id="pw-cur"></div>
          <div class="field full"><label>New password (min 8 characters)</label><input type="password" id="pw-new"></div>
          <div class="field full"><label>Confirm new password</label><input type="password" id="pw-conf"></div>
        </div>
        <div class="mt flex">
          <button class="btn btn-primary" id="pw-save">Update password</button>
          <button class="btn btn-ghost" id="pw-cancel">Cancel</button>
        </div></div>`;
      document.body.appendChild(wrap);
      wrap.querySelector('#pw-cancel').onclick = () => wrap.remove();
      wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
      wrap.querySelector('#pw-save').onclick = async () => {
        const cur = wrap.querySelector('#pw-cur').value;
        const nw = wrap.querySelector('#pw-new').value;
        if (nw !== wrap.querySelector('#pw-conf').value) { toast('New password does not match.', 'error'); return; }
        // Caught here for immediate feedback; the server enforces it regardless.
        if (nw && nw === cur) { toast('New password cannot be the same as the current password.', 'error'); return; }
        try {
          await api('/auth/change-password', { method: 'POST', body: {
            currentPassword: cur, newPassword: nw } });
          toast('Password updated.', 'success'); wrap.remove();
        } catch (e) { toast(e.message, 'error'); }
      };
    };

    const view = document.getElementById('view');
    const pages = {
      'dashboard': pageDashboard, 'apply': pageApply, 'my-leaves': pageMyLeaves, 'compoff': pageCompoff,
      'holidays': pageHolidays, 'approvals': pageApprovals, 'team': pageTeam,
      'notifications': pageNotifications, 'calendar': pageCalendar, 'ledger': pageLedger,
      'admin-users': pageAdminUsers, 'admin-holidays': pageAdminHolidays, 'admin-reports': pageAdminReports,
      'admin-policy': pageAdminPolicy
    };
    const fn = pages[route] || pageDashboard;
    try { await fn(view); } catch (e) { view.innerHTML = `<div class="alert error">${esc(e.message)}</div>`; }
  }

  // ---------- login ----------
  function renderLogin() {
    $app.innerHTML = `
      <div class="login-wrap">
        <div class="login-card">
          <h1>🌴 CREST Leave Management</h1>
          <div class="sub">Sign in with your company account</div>
          <form id="login-form">
            <div class="field" style="margin-bottom:12px">
              <label>Email</label>
              <input type="email" id="login-email" placeholder="you@crestaerospace.com" required autofocus>
            </div>
            <div class="field" style="margin-bottom:18px">
              <label>Password</label>
              <input type="password" id="login-password" required>
            </div>
            <div id="login-error"></div>
            <button class="btn btn-primary" style="width:100%" type="submit">Sign in</button>
          </form>
          <div class="login-hint">
            <b>Test accounts</b> (password <code>Welcome@123</code>):<br>
            Owner: <code>hirkant@gmail.com</code><br>
            Admin: <code>raj@crest-technologies.com</code><br>
            Manager: <code>vishal.bhandary@crestaerospace.com</code><br>
            Employee: <code>amit.sharma@crestaerospace.com</code><br>
            You can change your password from the sidebar after signing in; if you forgot it, an admin can reset it.
          </div>
        </div>
      </div>`;
    document.getElementById('login-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        const data = await api('/auth/login', { method: 'POST', body: {
          email: document.getElementById('login-email').value,
          password: document.getElementById('login-password').value } });
        token = data.token; localStorage.setItem('lms_token', token);
        me = null; location.hash = '#/dashboard'; render();
      } catch (err) {
        document.getElementById('login-error').innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
    };
  }

  // ---------- dashboard ----------
  async function pageDashboard(view) {
    me = await api('/me');
    const b = me.balances;
    const now = new Date();
    const weekEnd = new Date(now.getTime() + 6 * 86400000).toISOString().slice(0, 10);
    const calReqs = [api(`/calendar?year=${now.getFullYear()}&month=${now.getMonth() + 1}`)];
    if (weekEnd.slice(0, 7) !== today().slice(0, 7))
      calReqs.push(api(`/calendar?year=${weekEnd.slice(0, 4)}&month=${Number(weekEnd.slice(5, 7))}`));
    const [hol, leaves, ...cals] = await Promise.all([api('/holidays?year=' + curYear()), api('/leaves'), ...calReqs]);
    const outMap = new Map();
    cals.flatMap(c => c.leaves).forEach(l => {
      if (l.startDate <= weekEnd && l.endDate >= today()) outMap.set(l.userId + l.startDate, l);
    });
    const outThisWeek = [...outMap.values()].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const upcoming = hol.holidays.filter(h => h.date >= today() &&
      (h.type === 'mandatory' || hol.mySelections.includes(h.id))).slice(0, 5);
    const recent = leaves.slice(0, 5);
    const cfNote = b.annual.carryForward > 0
      ? (b.annual.carryForwardActive ? `incl. ${b.annual.carryForward} carried forward (use by 30 Jun)` : `${b.annual.carryForward} carry-forward lapsed 30 Jun`) : '';

    view.innerHTML = `
      <div class="page-head">
        <div><h2>Welcome, ${esc(me.user.name.split(' ')[0])} 👋</h2>
        <div class="sub">Leave year ${b.year} · ${me.manager ? 'Reports to ' + esc(me.manager.name) : 'Top of reporting line'}</div></div>
        <a class="btn btn-primary" href="#/apply">+ Apply for Leave</a>
      </div>
      <div class="grid cols-4">
        <div class="stat accent"><div class="label">Annual Leave</div>
          <div class="value">${b.annual.available}</div>
          <div class="detail">available of ${b.annual.accrued + (b.annual.carryForwardActive ? b.annual.carryForward : 0) + b.annual.adjustments} accrued · ${b.annual.used} used${b.annual.pending ? ` · ${b.annual.pending} pending` : ''}${cfNote ? '<br>' + cfNote : ''}</div></div>
        <div class="stat"><div class="label">Sick Leave</div>
          <div class="value">${b.sick.available}</div>
          <div class="detail">of ${b.sick.entitlement} days · ${b.sick.used} used</div></div>
        <div class="stat"><div class="label">Comp-Off Credits</div>
          <div class="value">${b.compensatory.available}</div>
          <div class="detail">${b.compensatory.credits.length ? 'earliest expires ' + fmt(b.compensatory.credits.map(c => c.expiresAt).sort()[0]) : 'work a non-working day to earn'}</div></div>
        ${b.mpl ? `
        <div class="stat"><div class="label">Menstrual Leave</div>
          <div class="value">${b.mpl.available}</div>
          <div class="detail">of ${b.mpl.perMonth} day(s) this month · ${b.mpl.used} used${b.mpl.pending ? ` · ${b.mpl.pending} pending` : ''}<br>resets on the 1st</div></div>` : ''}
        <div class="stat"><div class="label">Optional Holidays</div>
          <div class="value">${hol.mySelections.length}/${hol.optionalCount}</div>
          <div class="detail">chosen for ${hol.year} · <a href="#/holidays">select</a></div></div>
      </div>
      <div class="card" style="margin-top:18px"><h3>Who's out this week</h3>
        ${outThisWeek.length ? `<div class="flex">${outThisWeek.map(l => `
          <div class="out-chip"><b>${esc(l.userName)}${l.userId === me.user.id ? ' (you)' : ''}</b>
            <span class="muted small">${esc(l.typeLabel)} · ${fmt(l.startDate)}${l.startDate !== l.endDate ? ' – ' + fmt(l.endDate) : ''}</span></div>`).join('')}</div>`
          : '<div class="muted small">Nobody on your team is on approved leave in the next 7 days.</div>'}
        <div class="muted small mt"><a href="#/calendar">Open the team calendar →</a></div>
      </div>
      <div class="grid" style="grid-template-columns: 1fr 1fr;">
        <div class="card mb0"><h3>Upcoming holidays</h3>
          ${upcoming.length ? `<table>${upcoming.map(h => `<tr>
            <td><b>${fmt(h.date)}</b></td><td>${esc(h.name)}</td>
            <td><span class="pill ${h.type}">${h.type === 'optional' ? 'optional ✓' : 'mandatory'}</span></td></tr>`).join('')}</table>`
            : '<div class="empty">No upcoming holidays this year.</div>'}
        </div>
        <div class="card mb0"><h3>Recent requests</h3>
          ${recent.length ? `<table>${recent.map(l => `<tr>
            <td>${esc(l.typeLabel)}</td>
            <td class="small">${fmt(l.startDate)}${l.startDate !== l.endDate ? ' – ' + fmt(l.endDate) : ''}</td>
            <td><span class="pill ${l.status}">${l.status}</span></td></tr>`).join('')}</table>`
            : '<div class="empty">No leave requests yet.</div>'}
        </div>
      </div>`;
  }

  // ---------- apply leave ----------
  let holidayCache = {};
  async function getHolidays(year) {
    if (!holidayCache[year]) holidayCache[year] = await api('/holidays?year=' + year);
    return holidayCache[year];
  }
  async function calcDays(type, start, end) {
    if (!start || !end || end < start) return null;
    if (type === 'maternity')
      return Math.round((new Date(end) - new Date(start)) / 86400000) + 1;
    const years = new Set([+start.slice(0, 4), +end.slice(0, 4)]);
    const skip = new Set();
    for (const y of years) {
      const h = await getHolidays(y);
      h.holidays.forEach(x => { if (x.type === 'mandatory' || h.mySelections.includes(x.id)) skip.add(x.date); });
    }
    let n = 0;
    for (let d = new Date(start + 'T00:00:00Z'); ; d.setUTCDate(d.getUTCDate() + 1)) {
      const s = d.toISOString().slice(0, 10);
      if (s > end) break;
      const dow = d.getUTCDay();
      if (dow !== 0 && dow !== 6 && !skip.has(s)) n++;
    }
    return n;
  }

  async function pageApply(view) {
    const b = me.balances;
    const isAdmin = me.user.role === 'admin';
    const allUsers = isAdmin ? (await api('/admin/users')).filter(u => u.active) : [];
    view.innerHTML = `
      <div class="page-head"><div><h2>Apply for Leave</h2>
        <div class="sub">Approver: ${me.manager ? esc(me.manager.name) : 'Director/CEO'} · long requests go to the Director/CEO</div></div></div>
      <div class="card" style="max-width: 760px">
        <form id="apply-form">
          <div class="form-grid">
            ${isAdmin ? `<div class="field full"><label>Apply for</label>
              <select id="f-user">
                <option value="">Myself (${esc(me.user.name)})</option>
                ${allUsers.filter(u => u.id !== me.user.id).map(u => `<option value="${u.id}">${esc(u.name)} — ${esc(u.email)}</option>`).join('')}
              </select>
              <div class="muted small mt">As an admin you can submit a leave request on any employee's behalf; they will be notified.</div></div>` : ''}
            <div class="field"><label>Leave type</label>
              <select id="f-type">${activeLeaveTypes().map(([k, t]) => `<option value="${k}">${esc(t.label)}</option>`).join('')}</select></div>
            <div class="field"><label>&nbsp;</label>
              <div class="days-preview" id="f-days">Select dates to see day count</div></div>
            <div class="field"><label>Start date</label><input type="date" id="f-start"></div>
            <div class="field"><label>End date</label><input type="date" id="f-end"></div>
            <div class="field full" id="f-extra"></div>
            <div class="field full"><label>Reason</label>
              <textarea id="f-reason" rows="2" placeholder="Brief reason for the leave"></textarea></div>
            <div class="field full"><label>Supporting document <span class="muted">(optional — e.g. medical certificate, max 2 MB)</span></label>
              <input type="file" id="f-file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"></div>
          </div>
          <div class="mt" id="f-hint"></div>
          <div class="mt flex">
            <button class="btn btn-primary" type="submit">Submit request</button>
            <span class="muted small">AL available: <b>${b.annual.available}</b> · SL: <b>${b.sick.available}</b> · Comp credits: <b>${b.compensatory.available}</b></span>
          </div>
        </form>
      </div>`;

    const $type = document.getElementById('f-type'), $start = document.getElementById('f-start'),
      $end = document.getElementById('f-end'), $extra = document.getElementById('f-extra'),
      $days = document.getElementById('f-days'), $hint = document.getElementById('f-hint');

    function renderExtra() {
      const t = $type.value;
      const blocks = {
        sick: `<label class="checkbox-row"><input type="checkbox" id="f-cert">
          I will provide a medical certificate from a registered practitioner (required for 2+ continuous days)</label>`,
        bereavement: `<label>Immediate family member</label>
          <select id="f-relation"><option value="">— select —</option>
          ${['parent', 'parent-in-law', 'spouse', 'child', 'brother', 'sister'].map(r => `<option>${r}</option>`).join('')}</select>
          <div class="muted small mt">Bereavement leave is paid, max 5 workdays, not deducted from other leave.</div>`,
        paternity: `<label>Child's date of birth / legal adoption date</label><input type="date" id="f-event">
          <div class="muted small mt">Up to 5 paid days, within 4 weeks of birth/adoption.</div>`,
        maternity: `<label class="checkbox-row"><input type="checkbox" id="f-third">
          This is my third child or beyond (entitlement 12 weeks instead of 26)</label>
          <div class="muted small mt">Counted in calendar days. Inform your manager at least 60 days in advance. AL may be prefixed/suffixed via a separate request.</div>`,
        mpl: `<div class="muted small">${me.balances?.mpl
          ? `${me.balances.mpl.perMonth} day per calendar month — ${me.balances.mpl.available} available for ${me.balances.mpl.month}.`
          : 'One day per calendar month.'} The entitlement resets on the 1st and is never carried over, so a request cannot span two months.</div>`,
        compensatory: `<div class="muted small">Uses your approved comp-off credits; each credit is valid 6 weeks from the day worked. Cannot be clubbed with other leave. <a href="#/compoff">Manage credits</a></div>`,
        lop: `<div class="muted small">Loss of Pay is only granted after all leave is exhausted, in exceptional cases, and needs Director/CEO sanction.</div>`,
        annual: `<div class="muted small">Whole days only (no half days). Policy asks for 90 days' notice for planned leave; short-notice requests may be denied. Max 5 unused days carry forward, lapsing 30 June.</div>`
      };
      const def = me.leaveTypes?.[t];
      $extra.innerHTML = blocks[t] || (def?.custom
        ? `<div class="muted small">${esc(def.label)}: flat entitlement of ${def.annualDays} working day(s) per year, no carry-forward.${def.requiresAdmin ? ' Requires Director/CEO approval.' : ''}</div>` : '');
    }

    async function updateDays() {
      const n = await calcDays($type.value, $start.value, $end.value);
      if (n === null) { $days.textContent = 'Select dates to see day count'; return; }
      const unit = $type.value === 'maternity' ? 'calendar day(s)' : 'working day(s)';
      $days.textContent = `${n} ${unit}`;
      $hint.innerHTML = n > 10 && $type.value !== 'maternity'
        ? `<div class="alert warn mb0">Over 10 days — this request will be routed to the Director/CEO for approval.</div>` : '';
    }

    $type.onchange = () => { renderExtra(); updateDays(); };
    $start.onchange = () => { if (!$end.value || $end.value < $start.value) $end.value = $start.value; updateDays(); };
    $end.onchange = updateDays;
    renderExtra();

    document.getElementById('apply-form').onsubmit = async (e) => {
      e.preventDefault();
      const t = $type.value;
      const meta = {};
      if (t === 'sick') meta.certificate = !!document.getElementById('f-cert')?.checked;
      if (t === 'bereavement') meta.relation = document.getElementById('f-relation')?.value;
      if (t === 'paternity') meta.eventDate = document.getElementById('f-event')?.value;
      if (t === 'maternity') meta.thirdChildOnwards = !!document.getElementById('f-third')?.checked;
      const file = document.getElementById('f-file').files[0];
      if (file) {
        if (file.size > 2 * 1024 * 1024) { toast('Attachment must be under 2 MB.', 'error'); return; }
        meta.attachment = await new Promise((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve({ name: file.name, dataUrl: r.result });
          r.onerror = reject;
          r.readAsDataURL(file);
        });
      }
      const behalfSel = document.getElementById('f-user');
      const behalfId = behalfSel && behalfSel.value ? Number(behalfSel.value) : undefined;
      try {
        const res = await api('/leaves', { method: 'POST', body: {
          type: t, startDate: $start.value, endDate: $end.value, userId: behalfId,
          reason: document.getElementById('f-reason').value, meta } });
        toast(behalfId ? 'Leave request submitted on the employee\'s behalf.' : 'Leave request submitted for approval.', 'success');
        (res.warnings || []).forEach(w => toast(w));
        me = null; location.hash = '#/my-leaves'; render();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  const attachLink = (l) => l.meta?.attachment
    ? `<a href="${l.meta.attachment.dataUrl}" download="${esc(l.meta.attachment.name)}">📎 ${esc(l.meta.attachment.name)}</a>` : '';

  // ---------- my leaves ----------
  async function pageMyLeaves(view) {
    const leaves = await api('/leaves');
    view.innerHTML = `
      <div class="page-head"><div><h2>My Leave Requests</h2></div>
        <a class="btn btn-primary" href="#/apply">+ Apply for Leave</a></div>
      <div class="card table-wrap">
        ${leaves.length ? `<table>
          <tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Decided by</th><th>Note</th><th></th></tr>
          ${leaves.map(l => `<tr>
            <td><b>${esc(l.typeLabel)}</b>${l.requiresAdmin ? '<div class="small muted">Director/CEO approval</div>' : ''}
              ${l.appliedByName ? `<div class="small muted">applied by ${esc(l.appliedByName)}</div>` : ''}</td>
            <td class="small">${fmt(l.startDate)}${l.startDate !== l.endDate ? '<br>→ ' + fmt(l.endDate) : ''}</td>
            <td>${l.days}</td>
            <td><span class="pill ${l.status}">${l.status}</span></td>
            <td class="small">${esc(l.decidedByName || '—')}</td>
            <td class="small muted">${esc(l.decisionNote || l.reason || '—')}${l.meta?.attachment ? '<br>' + attachLink(l) : ''}</td>
            <td>${(l.status === 'pending' || (l.status === 'approved' && l.startDate > today()))
              ? `<button class="btn btn-red btn-sm" data-cancel="${l.id}">Withdraw</button>` : ''}</td>
          </tr>`).join('')}</table>` : '<div class="empty">You have not applied for any leave yet.</div>'}
      </div>`;
    view.querySelectorAll('[data-cancel]').forEach(btn => btn.onclick = async () => {
      if (!(await uiConfirm('Withdraw this leave request?', { confirmLabel: 'Withdraw', danger: true }))) return;
      try { await api(`/leaves/${btn.dataset.cancel}/cancel`, { method: 'POST' }); toast('Request withdrawn.', 'success'); me = null; render(); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------- comp-off ----------
  async function pageCompoff(view) {
    const list = await api('/compoffs');
    const status = (c) => c.status !== 'approved' ? c.status
      : c.usedByLeaveId ? 'used' : (c.expiresAt < today() ? 'expired' : 'approved');
    view.innerHTML = `
      <div class="page-head"><div><h2>Compensatory Off</h2>
        <div class="sub">Claim a credit for working a non-working day; use it within 6 weeks of the day worked.</div></div></div>
      <div class="card" style="max-width:680px"><h3>Claim a comp-off credit</h3>
        <form id="co-form" class="form-grid">
          <div class="field"><label>Date worked (weekend / holiday)</label><input type="date" id="co-date" max="${today()}"></div>
          <div class="field"><label>What did you work on?</label><input type="text" id="co-note" placeholder="e.g. production release support"></div>
          <div class="field" style="align-self:end"><button class="btn btn-primary" type="submit">Submit claim</button></div>
        </form>
        <div class="muted small mt">Your manager verifies ~8 hours of work were done and that no other benefit was claimed for the day.</div>
      </div>
      <div class="card table-wrap"><h3>My credits</h3>
        ${list.length ? `<table><tr><th>Worked on</th><th>Note</th><th>Valid until</th><th>Status</th></tr>
          ${list.map(c => `<tr><td><b>${fmt(c.workDate)}</b></td><td class="small">${esc(c.note || '—')}</td>
            <td class="small">${fmt(c.expiresAt)}</td>
            <td><span class="pill ${status(c)}">${status(c)}</span></td></tr>`).join('')}</table>`
          : '<div class="empty">No comp-off claims yet.</div>'}
      </div>`;
    document.getElementById('co-form').onsubmit = async (e) => {
      e.preventDefault();
      try {
        await api('/compoffs', { method: 'POST', body: {
          workDate: document.getElementById('co-date').value,
          note: document.getElementById('co-note').value } });
        toast('Comp-off claim submitted for manager approval.', 'success'); render();
      } catch (err) { toast(err.message, 'error'); }
    };
  }

  // ---------- holidays ----------
  async function pageHolidays(view, yearArg) {
    const year = yearArg || curYear();
    const data = await api('/holidays?year=' + year);
    const years = data.years.length ? data.years : [year];
    const mand = data.holidays.filter(h => h.type === 'mandatory');
    const opt = data.holidays.filter(h => h.type === 'optional');
    view.innerHTML = `
      <div class="page-head"><div><h2>Holiday Calendar ${year}</h2>
        <div class="sub">${mand.length} mandatory holidays · choose any ${data.optionalCount} optional holiday(s)</div></div>
        <select id="hol-year" class="btn btn-ghost">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select>
      </div>
      <div class="grid" style="grid-template-columns: 1fr 1fr;">
        <div class="card mb0"><h3>Mandatory holidays</h3>
          <table><tr><th>Date</th><th>Day</th><th>Occasion</th></tr>
          ${mand.map(h => `<tr ${h.date < today() ? 'style="opacity:.55"' : ''}>
            <td><b>${fmt(h.date)}</b></td>
            <td class="small">${new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' })}</td>
            <td>${esc(h.name)}</td></tr>`).join('')}</table></div>
        <div class="card mb0"><h3>Optional holidays — ${data.mySelections.length}/${data.optionalCount} chosen</h3>
          ${opt.length ? `<table><tr><th></th><th>Date</th><th>Day</th><th>Occasion</th></tr>
          ${opt.map(h => {
            const sel = data.mySelections.includes(h.id);
            const past = h.date < today();
            return `<tr ${past ? 'style="opacity:.55"' : ''}>
              <td><input type="checkbox" data-opt="${h.id}" ${sel ? 'checked' : ''} ${past ? 'disabled' : ''}></td>
              <td><b>${fmt(h.date)}</b></td>
              <td class="small">${new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' })}</td>
              <td>${esc(h.name)}</td></tr>`;
          }).join('')}</table>
          <div class="muted small mt">Selected optional holidays count as holidays for you — they are excluded from your leave day counts.</div>`
          : '<div class="empty">No optional holidays listed for this year.</div>'}
        </div>
      </div>`;
    document.getElementById('hol-year').onchange = (e) => pageHolidays(view, Number(e.target.value));
    view.querySelectorAll('[data-opt]').forEach(cb => cb.onchange = async () => {
      try {
        await api('/holidays/select', { method: 'POST', body: { holidayId: Number(cb.dataset.opt), selected: cb.checked } });
        holidayCache = {}; toast(cb.checked ? 'Optional holiday selected.' : 'Optional holiday removed.', 'success');
        pageHolidays(view, year);
      } catch (e) { cb.checked = !cb.checked; toast(e.message, 'error'); }
    });
  }

  // ---------- approvals ----------
  async function pageApprovals(view) {
    const data = await api('/approvals');
    view.innerHTML = `
      <div class="page-head"><div><h2>Pending Approvals</h2>
        <div class="sub">${data.leaves.length} leave request(s) · ${data.compoffs.length} comp-off claim(s)</div></div></div>
      <div class="card table-wrap"><h3>Leave requests</h3>
        ${data.leaves.length ? `<table>
          <tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Flags</th><th>Decision</th></tr>
          ${data.leaves.map(l => `<tr>
            <td><b>${esc(l.userName)}</b><div class="small muted">${esc(l.userEmail)}</div>
              <div class="small ${l.agingDays >= 3 ? 'aging' : 'muted'}">applied ${l.agingDays === 0 ? 'today' : l.agingDays + 'd ago'}${l.appliedByName ? ' by ' + esc(l.appliedByName) : ''}</div></td>
            <td>${esc(l.typeLabel)}</td>
            <td class="small">${fmt(l.startDate)}${l.startDate !== l.endDate ? '<br>→ ' + fmt(l.endDate) : ''}</td>
            <td><b>${l.days}</b></td>
            <td class="small muted" style="max-width:180px">${esc(l.reason || '—')}
              ${l.meta?.relation ? `<br>Relation: ${esc(l.meta.relation)}` : ''}
              ${l.meta?.certificate ? '<br>Will provide medical certificate' : ''}
              ${l.meta?.eventDate ? `<br>Child DOB/adoption: ${fmt(l.meta.eventDate)}` : ''}
              ${l.meta?.attachment ? '<br>' + attachLink(l) : ''}</td>
            <td class="small">${l.requiresAdmin ? '<span class="pill pending">Director/CEO</span>' : ''}
              ${(l.overlaps || []).map(o => `<div class="conflict">⚠ ${esc(o.name)} is also out ${fmt(o.startDate)}${o.startDate !== o.endDate ? ' – ' + fmt(o.endDate) : ''}</div>`).join('')}
              ${(l.warnings || []).map(w => `<div class="muted" style="max-width:170px">⚠ ${esc(w)}</div>`).join('')}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-green btn-sm" data-dec="approved" data-id="${l.id}">Approve</button>
              <button class="btn btn-red btn-sm" data-dec="rejected" data-id="${l.id}">Reject</button></td>
          </tr>`).join('')}</table>` : '<div class="empty">No pending leave requests. 🎉</div>'}
      </div>
      <div class="card table-wrap"><h3>Comp-off claims</h3>
        ${data.compoffs.length ? `<table>
          <tr><th>Employee</th><th>Worked on</th><th>Note</th><th>Decision</th></tr>
          ${data.compoffs.map(c => `<tr>
            <td><b>${esc(c.userName)}</b></td><td>${fmt(c.workDate)}</td><td class="small muted">${esc(c.note || '—')}</td>
            <td style="white-space:nowrap">
              <button class="btn btn-green btn-sm" data-codec="approved" data-id="${c.id}">Approve</button>
              <button class="btn btn-red btn-sm" data-codec="rejected" data-id="${c.id}">Reject</button></td>
          </tr>`).join('')}</table>` : '<div class="empty">No pending comp-off claims.</div>'}
      </div>`;
    view.querySelectorAll('[data-dec]').forEach(btn => btn.onclick = async () => {
      const note = btn.dataset.dec === 'rejected' ? await uiPrompt('Reason for rejection (shown to the employee):') : ((await uiPrompt('Optional note for the employee:')) ?? '');
      if (btn.dataset.dec === 'rejected' && note === null) return;
      try {
        await api(`/leaves/${btn.dataset.id}/decision`, { method: 'POST', body: { decision: btn.dataset.dec, note: note || '' } });
        toast('Request ' + btn.dataset.dec + '.', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
    view.querySelectorAll('[data-codec]').forEach(btn => btn.onclick = async () => {
      try {
        await api(`/compoffs/${btn.dataset.id}/decision`, { method: 'POST', body: { decision: btn.dataset.codec } });
        toast('Comp-off claim ' + btn.dataset.codec + '.', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------- team ----------
  async function pageTeam(view) {
    const team = await api('/team');
    view.innerHTML = `
      <div class="page-head"><div><h2>My Team</h2><div class="sub">Direct reports and their leave position for ${curYear()}</div></div></div>
      <div class="card table-wrap">
        ${team.length ? `<table>
          <tr><th>Employee</th><th>Role</th><th>AL available</th><th>AL used</th><th>SL left</th><th>Comp</th><th>Upcoming leave</th></tr>
          ${team.map(t => `<tr>
            <td><b>${esc(t.user.name)}</b><div class="small muted">${esc(t.user.email)}</div></td>
            <td style="text-transform:capitalize">${esc(t.user.role)}</td>
            <td><b>${t.balances.annual.available}</b></td>
            <td>${t.balances.annual.used}</td>
            <td>${t.balances.sick.available}</td>
            <td>${t.balances.compensatory.available}</td>
            <td class="small">${t.upcoming.length ? t.upcoming.map(u => `${fmt(u.startDate)} (${u.days}d ${esc(u.type)})`).join('<br>') : '—'}</td>
          </tr>`).join('')}</table>` : '<div class="empty">No direct reports.</div>'}
      </div>`;
  }

  // ---------- notifications ----------
  async function pageNotifications(view) {
    const data = await api('/notifications');
    view.innerHTML = `
      <div class="page-head"><div><h2>Notifications</h2>
        <div class="sub">${data.unread ? data.unread + ' unread' : 'You are all caught up'}</div></div>
        ${data.notifications.length ? '<button class="btn btn-ghost" id="notif-clear">Clear all</button>' : ''}</div>
      <div class="card">
        ${data.notifications.length ? data.notifications.map(n => `
          <div class="notif ${n.read ? '' : 'unread'}">
            <div>${esc(n.text)}</div>
            <div class="small muted">${fmtDT(n.createdAt)}${n.link ? ` · <a href="${esc(n.link)}">view</a>` : ''}</div>
          </div>`).join('') : '<div class="empty">No notifications yet.</div>'}
      </div>`;
    const clearBtn = document.getElementById('notif-clear');
    if (clearBtn) clearBtn.onclick = async () => {
      if (!(await uiConfirm('Delete all your notifications? This cannot be undone.', { confirmLabel: 'Delete all', danger: true }))) return;
      try { await api('/notifications/clear', { method: 'POST' }); unreadCount = 0; toast('Notifications cleared.', 'success'); render(); }
      catch (e) { toast(e.message, 'error'); }
    };
    if (data.unread) { try { await api('/notifications/read', { method: 'POST' }); unreadCount = 0; } catch {} }
  }

  // ---------- team calendar ----------
  async function pageCalendar(view, y, m) {
    const now = new Date();
    y = y || now.getFullYear(); m = m || now.getMonth() + 1;
    const data = await api(`/calendar?year=${y}&month=${m}`);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const firstDow = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const typeColors = {};
    Object.entries(me.leaveTypes || {}).forEach(([k, t]) => { typeColors[k] = t.color || '#64748b'; });
    const monthName = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

    let cells = '';
    let peakCount = 0, peakDate = null, totalLeaveDays = 0;
    for (let i = 0; i < firstDow; i++) cells += '<div class="cal-cell blank"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dow = new Date(ds + 'T00:00:00Z').getUTCDay();
      const hols = data.holidays.filter(h => h.date === ds);
      const out = data.leaves.filter(l => l.startDate <= ds && l.endDate >= ds);
      if (out.length > peakCount) { peakCount = out.length; peakDate = ds; }
      totalLeaveDays += out.length;
      cells += `<div class="cal-cell ${dow === 0 || dow === 6 ? 'weekend' : ''} ${ds === today() ? 'today' : ''}">
        <div class="cal-date">${d}${out.length ? `<span class="cal-count" title="${out.length} ${out.length === 1 ? 'person' : 'people'} on approved leave">${out.length} out</span>` : ''}</div>
        ${hols.map(h => `<div class="cal-holiday ${h.type}">${esc(h.name)}</div>`).join('')}
        ${out.map(l => `<div class="cal-chip" style="border-left-color:${typeColors[l.type] || '#64748b'}" title="${esc(l.typeLabel)}">${esc((l.userName || '').split(' ')[0])}${l.userId === me.user.id ? ' (you)' : ''}</div>`).join('')}
      </div>`;
    }
    const scope = me.user.role === 'admin' ? 'whole organisation' : me.user.role === 'manager' ? 'you and your reports' : 'you, your peers and your manager';
    const countSummary = peakCount
      ? `<div class="cal-summary">Leave count this month: <b>${totalLeaveDays}</b> person-day(s) · Busiest day: <b>${fmt(peakDate)}</b> with <b>${peakCount}</b> ${peakCount === 1 ? 'person' : 'people'} out</div>`
      : '<div class="cal-summary">Nobody is on approved leave this month.</div>';
    const legend = `<div class="cal-legend">${activeLeaveTypes().map(([k, t]) =>
      `<span class="legend-item"><span class="legend-swatch" style="background:${typeColors[k]}"></span>${esc(t.label)}</span>`).join('')}</div>`;
    view.innerHTML = `
      <div class="page-head"><div><h2>Team Calendar</h2><div class="sub">Approved leave for ${scope} · holidays included</div></div>
        <div class="flex">
          <button class="btn btn-ghost" id="cal-prev">← Prev</button>
          <b style="min-width:150px;text-align:center">${monthName}</b>
          <button class="btn btn-ghost" id="cal-next">Next →</button>
        </div></div>
      <div class="card">
        ${countSummary}
        ${legend}
        <div class="cal-grid">
          ${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="cal-head">${d}</div>`).join('')}
          ${cells}
        </div>
      </div>`;
    document.getElementById('cal-prev').onclick = () => pageCalendar(view, m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1);
    document.getElementById('cal-next').onclick = () => pageCalendar(view, m === 12 ? y + 1 : y, m === 12 ? 1 : m + 1);
  }

  // ---------- leave ledger ----------
  function ledgerTable(entries) {
    return entries.length ? `<table><tr><th>Date</th><th>Event</th><th>Leave type</th><th style="text-align:right">Days</th></tr>
      ${entries.map(e => `<tr>
        <td class="small" style="white-space:nowrap">${fmt(e.date)}</td>
        <td>${esc(e.label)}${e.info ? ' <span class="small muted">(entitlement-based, no balance impact)</span>' : ''}</td>
        <td class="small" style="text-transform:capitalize">${esc(e.leaveType)}</td>
        <td style="text-align:right;font-weight:600;color:${e.delta > 0 ? 'var(--green)' : 'var(--red)'}">${e.delta > 0 ? '+' : ''}${e.delta}</td>
      </tr>`).join('')}</table>` : '<div class="empty">No ledger entries for this year.</div>';
  }

  async function pageLedger(view, yearArg) {
    const year = yearArg || curYear();
    const data = await api('/ledger?year=' + year);
    view.innerHTML = `
      <div class="page-head"><div><h2>My Leave Ledger</h2>
        <div class="sub">Every credit and debit on your leave account, ${year}</div></div>
        <select id="led-year" class="btn btn-ghost">${[year - 1, year, year + 1].map(yy => `<option ${yy === year ? 'selected' : ''}>${yy}</option>`).join('')}</select></div>
      <div class="card table-wrap">${ledgerTable(data.entries)}</div>`;
    document.getElementById('led-year').onchange = (e) => pageLedger(view, Number(e.target.value));
  }

  // ---------- admin: users ----------
  async function pageAdminUsers(view) {
    const users = await api('/admin/users');
    const roleRank = { admin: 0, manager: 1, employee: 2 };
    users.sort((a, b) => roleRank[a.role] - roleRank[b.role] || a.name.localeCompare(b.name));
    view.innerHTML = `
      <div class="page-head"><div><h2>Employee Policies</h2>
        <div class="sub">${users.filter(u => u.active).length} active users · personal leave policy overrides</div></div>
        <a class="btn btn-ghost" href="/usermgmt">Manage accounts →</a></div>
      <div class="card mb" style="border-left:3px solid var(--accent)">
        <b>Accounts are managed centrally.</b>
        <div class="small muted mt-2">Adding, editing and removing people — and their roles,
        managers and passwords — now happens in the CrestSuite <a href="/usermgmt">User Management</a>
        app, which covers ClockiT, Leave Management and QMS. This page sets each employee's
        <b>leave policy overrides</b>.</div>
      </div>
      <div class="card table-wrap">
        <table><tr><th>Name</th><th>Email</th><th>Role</th><th>Manager</th><th>Joined</th><th>Status</th><th></th></tr>
        ${users.map(u => `<tr ${u.active ? '' : 'style="opacity:.5"'}>
          <td><b>${esc(u.name)}</b>${u.isOwner ? ' <span class="pill mandatory">owner</span>' : ''}</td>
          <td class="small">${esc(u.email)}</td>
          <td style="text-transform:capitalize">${esc(u.role)}</td>
          <td class="small">${esc(u.managerName || '—')}</td>
          <td class="small">${fmt(u.joiningDate)}</td>
          <td><span class="pill ${u.active ? 'approved' : 'cancelled'}">${u.active ? 'active' : 'inactive'}</span>
            ${u.hasPolicyOverrides ? '<div class="mt-2"><span class="pill optional" title="This employee has a personal leave policy">custom policy</span></div>' : ''}</td>
          <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-policy="${u.id}" data-name="${esc(u.name)}">Policy</button></td>
        </tr>`).join('')}</table>
      </div>`;

    view.querySelectorAll('[data-policy]').forEach(btn => btn.onclick = async () => {
      const id = Number(btn.dataset.policy);
      let data;
      try { data = await api(`/admin/users/${id}/policy`); }
      catch (e) { toast(e.message, 'error'); return; }
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal" style="max-width:640px">
        <h3>Personal leave policy — ${esc(btn.dataset.name)}</h3>
        <div class="muted small" style="margin-bottom:14px">Leave a field <b>blank</b> to follow the company-wide rule (shown as placeholder). Enter a value to override it for this employee only.</div>
        <div class="form-grid">
          ${POLICY_FIELDS.map(([k, label]) => `
            <div class="field"><label>${label}</label>
              <input type="number" id="upol-${k}" min="0" placeholder="global: ${data.global[k]}"
                value="${data.overrides[k] !== undefined ? data.overrides[k] : ''}">
            </div>`).join('')}
        </div>
        <div class="mt flex spread">
          <span class="flex">
            <button class="btn btn-primary" id="upol-save">Save personal policy</button>
            <button class="btn btn-ghost" id="upol-cancel">Cancel</button>
          </span>
          <button class="btn btn-red" id="upol-clear">Clear all overrides</button>
        </div></div>`;
      document.body.appendChild(wrap);
      wrap.querySelector('#upol-cancel').onclick = () => wrap.remove();
      wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
      const put = async (overrides, okMsg) => {
        try {
          await api(`/admin/users/${id}/policy`, { method: 'PUT', body: { overrides } });
          toast(okMsg, 'success'); wrap.remove(); render();
        } catch (e) { toast(e.message, 'error'); }
      };
      wrap.querySelector('#upol-save').onclick = () => {
        const overrides = {};
        POLICY_FIELDS.forEach(([k]) => {
          const v = wrap.querySelector('#upol-' + k).value.trim();
          if (v !== '') overrides[k] = Number(v);
        });
        put(overrides, Object.keys(overrides).length ? 'Personal policy saved.' : 'All overrides cleared — global rule applies.');
      };
      wrap.querySelector('#upol-clear').onclick = async () => {
        if (await uiConfirm(`Remove all personal policy overrides for ${btn.dataset.name}? The company-wide rule will apply.`, { confirmLabel: 'Clear overrides', danger: true })) put({}, 'Overrides cleared — global rule applies.');
      };
    });
  }

  // ---------- admin: holidays ----------
  async function pageAdminHolidays(view, yearArg) {
    const year = yearArg || curYear();
    const data = await api('/holidays?year=' + year);
    const years = [...new Set([...data.years, year, curYear() + 1])].sort();
    view.innerHTML = `
      <div class="page-head"><div><h2>Manage Holiday Calendar</h2>
        <div class="sub">The calendar is updated every year — add next year's holidays here.</div></div>
        <select id="ah-year" class="btn btn-ghost">${years.map(y => `<option ${y === year ? 'selected' : ''}>${y}</option>`).join('')}</select></div>
      <div class="grid" style="grid-template-columns: 1fr 340px; align-items:start">
        <div class="card mb0 table-wrap">
          <h3>Holidays in ${year} (${data.holidays.length})</h3>
          ${data.holidays.length ? `<table><tr><th>Date</th><th>Occasion</th><th>Type</th><th></th></tr>
          ${data.holidays.map(h => `<tr>
            <td><b>${fmt(h.date)}</b><div class="small muted">${new Date(h.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'long' })}</div></td>
            <td>${esc(h.name)}</td>
            <td><span class="pill ${h.type}">${h.type}</span></td>
            <td><button class="btn btn-red btn-sm" data-del="${h.id}">Remove</button></td></tr>`).join('')}</table>`
            : `<div class="empty">No holidays for ${year} yet — add them on the right.</div>`}
        </div>
        <div>
          <div class="card"><h3>Add holiday</h3>
            <div class="field" style="margin-bottom:10px"><label>Date</label><input type="date" id="ah-date" value="${year}-01-01"></div>
            <div class="field" style="margin-bottom:10px"><label>Occasion</label><input id="ah-name" placeholder="e.g. Diwali"></div>
            <div class="field" style="margin-bottom:14px"><label>Type</label>
              <select id="ah-type"><option value="mandatory">Mandatory</option><option value="optional">Optional</option></select></div>
            <button class="btn btn-primary" id="ah-add" style="width:100%">Add holiday</button>
          </div>
          <div class="card mb0"><h3>Optional holiday allowance</h3>
            <div class="muted small" style="margin-bottom:10px">How many optional holidays may each employee choose in ${year}?</div>
            <div class="flex">
              <input type="number" min="0" max="10" id="ah-count" value="${data.optionalCount}" style="width:80px;border:1px solid #cbd5e1;border-radius:8px;padding:8px 11px">
              <button class="btn btn-primary" id="ah-save-count">Save</button>
            </div>
          </div>
        </div>
      </div>`;
    document.getElementById('ah-year').onchange = (e) => pageAdminHolidays(view, Number(e.target.value));
    document.getElementById('ah-add').onclick = async () => {
      try {
        await api('/admin/holidays', { method: 'POST', body: {
          date: document.getElementById('ah-date').value,
          name: document.getElementById('ah-name').value,
          type: document.getElementById('ah-type').value } });
        holidayCache = {}; toast('Holiday added.', 'success');
        pageAdminHolidays(view, Number(document.getElementById('ah-date').value.slice(0, 4)));
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('ah-save-count').onclick = async () => {
      try {
        await api('/admin/settings/' + year, { method: 'PUT', body: { optionalCount: Number(document.getElementById('ah-count').value) } });
        holidayCache = {}; toast('Optional holiday allowance updated.', 'success');
      } catch (e) { toast(e.message, 'error'); }
    };
    view.querySelectorAll('[data-del]').forEach(btn => btn.onclick = async () => {
      if (!(await uiConfirm('Remove this holiday? Employee selections of it will also be removed.', { confirmLabel: 'Remove', danger: true }))) return;
      try { await api('/admin/holidays/' + btn.dataset.del, { method: 'DELETE' }); holidayCache = {}; toast('Holiday removed.', 'success'); pageAdminHolidays(view, year); }
      catch (e) { toast(e.message, 'error'); }
    });
  }

  // ---------- admin: policy settings ----------
  const POLICY_FIELDS = [
      ['annual', 'Annual Leave — days per year', 'Accrued quarterly (¼ each quarter), prorated for mid-quarter joiners'],
      ['sick', 'Sick Leave — days per year', 'No carry-over; certificate needed for 2+ continuous days'],
      ['bereavement', 'Bereavement — max workdays per occasion', 'Paid, not deducted from other balances'],
      ['mplPerMonth', 'Menstrual Leave (MPL) — days per month', 'Female employees only; resets monthly, never carried over'],
      ['paternity', 'Paternity — paid days per child', ''],
      ['paternityWindowDays', 'Paternity window — days after birth/adoption', ''],
      ['maternityWeeks', 'Maternity — weeks (first two children)', 'Counted in calendar weeks'],
      ['maternityWeeksThird', 'Maternity — weeks (third child onwards)', ''],
      ['carryForwardMax', 'Annual Leave carry-forward — max days', 'Carried days lapse 30 June'],
      ['compoffExpiryDays', 'Comp-off validity — days from day worked', 'Policy default is 42 (6 weeks)'],
      ['adminThreshold', 'Director/CEO approval — for requests over (days)', ''],
      ['advanceNoticeDays', 'Planned-leave notice — days', 'Shorter notice is flagged to the approver, not blocked']
  ];

  async function pageAdminPolicy(view) {
    const [{ policy, defaults }, types] = await Promise.all([api('/admin/policy'), api('/admin/leave-types')]);
    view.innerHTML = `
      <div class="page-head"><div><h2>Policy Settings — global rule</h2>
        <div class="sub">Applies to every employee without a personal override · set per-employee policies from <a href="#/admin-users">Employees → Policy</a></div></div></div>
      <div class="card" style="max-width:820px">
        <div class="form-grid">
          ${POLICY_FIELDS.map(([k, label, hint]) => `
            <div class="field"><label>${label}</label>
              <input type="number" id="pol-${k}" value="${policy[k]}" min="0">
              <div class="muted small">${hint ? hint + ' · ' : ''}default ${defaults[k]}</div>
            </div>`).join('')}
        </div>
        <div class="mt flex">
          <button class="btn btn-primary" id="pol-save">Save global policy</button>
          <button class="btn btn-ghost" id="pol-reset">Restore defaults</button>
          <span class="muted small">Employees with a personal override keep their override for those values.</span>
        </div>
      </div>
      <div class="card table-wrap" style="max-width:820px">
        <div class="flex spread"><h3>Leave Types</h3>
          <button class="btn btn-primary btn-sm" id="lt-add">+ Add leave type</button></div>
        <div class="muted small" style="margin-bottom:10px">Built-in types follow the PTO policy rules above. Custom types get a flat annual entitlement (working days, no carry-forward) and appear in the Apply Leave form and team calendar.</div>
        <table><tr><th>Type</th><th>Entitlement</th><th>Approval</th><th>Status</th><th></th></tr>
        ${types.builtin.map(t => `<tr>
          <td><span class="legend-swatch" style="background:${t.color}"></span> <b>${esc(t.label)}</b></td>
          <td class="small muted" colspan="2">built-in — governed by the policy values above</td>
          <td><span class="pill approved">active</span></td><td></td></tr>`).join('')}
        ${types.custom.map(t => `<tr ${t.active === false ? 'style="opacity:.5"' : ''}>
          <td><span class="legend-swatch" style="background:${esc(t.color)}"></span> <b>${esc(t.label)}</b></td>
          <td>${t.annualDays} day(s)/year</td>
          <td class="small">${t.requiresAdmin ? 'Director/CEO' : 'Manager'}</td>
          <td><span class="pill ${t.active === false ? 'cancelled' : 'approved'}">${t.active === false ? 'inactive' : 'active'}</span></td>
          <td style="white-space:nowrap"><button class="btn btn-ghost btn-sm" data-lt-edit="${t.id}">Edit</button>
            <button class="btn ${t.active === false ? 'btn-green' : 'btn-red'} btn-sm" data-lt-toggle="${t.id}">${t.active === false ? 'Reactivate' : 'Deactivate'}</button></td>
        </tr>`).join('')}</table>
        ${types.custom.length ? '' : '<div class="muted small mt">No custom leave types yet.</div>'}
      </div>`;

    const openTypeModal = (t) => {
      const isNew = !t;
      t = t || { label: '', annualDays: 5, requiresAdmin: false, color: '#0f766e' };
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal"><h3>${isNew ? 'Add leave type' : 'Edit ' + esc(t.label)}</h3>
        <div class="form-grid">
          <div class="field"><label>Label</label><input id="lt-label" value="${esc(t.label)}" placeholder="e.g. Study Leave"></div>
          <div class="field"><label>Annual entitlement (working days)</label><input type="number" id="lt-days" min="0" max="365" value="${t.annualDays}"></div>
          <div class="field"><label>Calendar colour</label><input type="color" id="lt-color" value="${esc(t.color)}"></div>
          <div class="field" style="align-self:end"><label class="checkbox-row"><input type="checkbox" id="lt-admin" ${t.requiresAdmin ? 'checked' : ''}>
            Requires Director/CEO approval</label></div>
        </div>
        <div class="muted small mt">Flat entitlement per calendar year, counted in working days, no carry-forward.</div>
        <div class="mt flex">
          <button class="btn btn-primary" id="lt-save">${isNew ? 'Create type' : 'Save changes'}</button>
          <button class="btn btn-ghost" id="lt-cancel">Cancel</button>
        </div></div>`;
      document.body.appendChild(wrap);
      wrap.querySelector('#lt-cancel').onclick = () => wrap.remove();
      wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
      wrap.querySelector('#lt-save').onclick = async () => {
        const body = {
          label: wrap.querySelector('#lt-label').value,
          annualDays: Number(wrap.querySelector('#lt-days').value),
          color: wrap.querySelector('#lt-color').value,
          requiresAdmin: wrap.querySelector('#lt-admin').checked
        };
        try {
          if (isNew) await api('/admin/leave-types', { method: 'POST', body });
          else await api('/admin/leave-types/' + t.id, { method: 'PUT', body });
          toast(isNew ? 'Leave type created.' : 'Leave type updated.', 'success');
          wrap.remove(); me = null; render();
        } catch (e) { toast(e.message, 'error'); }
      };
    };
    document.getElementById('lt-add').onclick = () => openTypeModal(null);
    view.querySelectorAll('[data-lt-edit]').forEach(btn =>
      btn.onclick = () => openTypeModal(types.custom.find(x => x.id === Number(btn.dataset.ltEdit))));
    view.querySelectorAll('[data-lt-toggle]').forEach(btn => btn.onclick = async () => {
      const t = types.custom.find(x => x.id === Number(btn.dataset.ltToggle));
      const deactivating = t.active !== false;
      if (deactivating && !(await uiConfirm(`Deactivate "${t.label}"? Employees can no longer apply for it; existing requests keep their history.`, { confirmLabel: 'Deactivate', danger: true }))) return;
      try {
        await api('/admin/leave-types/' + t.id, { method: 'PUT', body: { active: !deactivating } });
        toast(deactivating ? 'Leave type deactivated.' : 'Leave type reactivated.', 'success');
        me = null; render();
      } catch (e) { toast(e.message, 'error'); }
    });
    document.getElementById('pol-save').onclick = async () => {
      const body = {};
      POLICY_FIELDS.forEach(([k]) => body[k] = Number(document.getElementById('pol-' + k).value));
      try {
        await api('/admin/policy', { method: 'PUT', body });
        toast('Policy updated for all employees.', 'success');
        me = null; render();
      } catch (e) { toast(e.message, 'error'); }
    };
    document.getElementById('pol-reset').onclick = async () => {
      if (!(await uiConfirm('Restore all policy values to the PTO policy document defaults?', { confirmLabel: 'Restore defaults' }))) return;
      try {
        await api('/admin/policy', { method: 'PUT', body: defaults });
        toast('Policy restored to defaults.', 'success');
        me = null; render();
      } catch (e) { toast(e.message, 'error'); }
    };
  }

  // ---------- admin: reports ----------
  async function pageAdminReports(view) {
    const data = await api('/admin/report?year=' + curYear());
    view.innerHTML = `
      <div class="page-head"><div><h2>Reports — ${data.year}</h2>
        <div class="sub">Organisation-wide leave balances and history</div></div>
        <div class="flex">
          <button class="btn btn-ghost" id="btn-export-bal">⬇ Balances CSV</button>
          <button class="btn btn-ghost" id="btn-export-leaves">⬇ Requests CSV</button>
          <button class="btn btn-ghost" id="btn-yearend">Run year-end carry-forward</button>
          <button class="btn btn-primary" id="btn-adjust">Balance adjustment</button>
        </div></div>
      <div class="card table-wrap"><h3>Balances</h3>
        <table><tr><th>Employee</th><th>Role</th><th>Manager</th><th>AL accrued</th><th>CF</th><th>AL used</th><th>AL avail</th><th>SL left</th><th>Comp</th><th>LOP</th><th>Bradford</th><th></th></tr>
        ${data.rows.map(r => `<tr>
          <td><b>${esc(r.user.name)}</b><div class="small muted">${esc(r.user.email)}</div></td>
          <td style="text-transform:capitalize">${esc(r.user.role)}</td>
          <td class="small">${esc(r.managerName || '—')}</td>
          <td>${r.balances.annual.accrued}</td>
          <td>${r.balances.annual.carryForward}${r.balances.annual.carryForwardActive ? '' : ' <span class="small muted">(lapsed)</span>'}</td>
          <td>${r.balances.annual.used}</td>
          <td><b>${r.balances.annual.available}</b></td>
          <td>${r.balances.sick.available}</td>
          <td>${r.balances.compensatory.available}</td>
          <td>${r.balances.lopTaken}</td>
          <td>${r.bradford > 0 ? `<span class="${r.bradford >= 50 ? 'bradford-high' : ''}" title="Bradford factor (spells² × sick days) — higher = more disruptive absence pattern">${r.bradford}</span>` : '—'}</td>
          <td><button class="btn btn-ghost btn-sm" data-ledger="${r.user.id}" data-name="${esc(r.user.name)}">Ledger</button></td>
        </tr>`).join('')}</table>
        <div class="muted small mt">Bradford factor = spells² × total sick days this year; ≥ 50 (highlighted) suggests a pattern of frequent short absences worth a conversation.</div>
      </div>
      <div class="card table-wrap"><h3>All leave requests</h3>
        ${data.leaves.length ? `<table><tr><th>Employee</th><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Applied</th><th>Decided by</th></tr>
        ${data.leaves.map(l => `<tr>
          <td><b>${esc(l.userName)}</b></td><td class="small">${esc(l.typeLabel)}</td>
          <td class="small">${fmt(l.startDate)}${l.startDate !== l.endDate ? ' – ' + fmt(l.endDate) : ''}</td>
          <td>${l.days}</td><td><span class="pill ${l.status}">${l.status}</span></td>
          <td class="small">${fmtDT(l.createdAt)}</td><td class="small">${esc(l.decidedByName || '—')}</td>
        </tr>`).join('')}</table>` : '<div class="empty">No leave requests yet.</div>'}
      </div>`;

    const download = async (path, filename) => {
      const res = await fetch('/leavems/api' + path, { headers: { Authorization: 'Bearer ' + token } });
      if (!res.ok) { toast('Export failed.', 'error'); return; }
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = filename; a.click();
      URL.revokeObjectURL(a.href);
    };
    document.getElementById('btn-export-bal').onclick = () => download(`/admin/export/balances?year=${data.year}`, `leave-balances-${data.year}.csv`);
    document.getElementById('btn-export-leaves').onclick = () => download(`/admin/export/leaves?year=${data.year}`, `leave-requests-${data.year}.csv`);

    document.getElementById('btn-yearend').onclick = async () => {
      const fromYear = data.year - 0;
      if (!(await uiConfirm(`Run year-end processing for ${fromYear}?\n\nEach active employee's unused Annual Leave (max 5 days) will be carried forward to ${fromYear + 1}, lapsing 30 June ${fromYear + 1}. Already-processed employees are skipped.`, { confirmLabel: 'Run year-end' }))) return;
      try {
        const r = await api('/admin/yearend', { method: 'POST', body: { fromYear } });
        toast(`Year-end done: carry-forward granted to ${r.processed} employee(s).`, 'success');
        render();
      } catch (e) { toast(e.message, 'error'); }
    };

    view.querySelectorAll('[data-ledger]').forEach(btn => btn.onclick = async () => {
      try {
        const led = await api(`/ledger?userId=${btn.dataset.ledger}&year=${data.year}`);
        const wrap = document.createElement('div');
        wrap.className = 'modal-backdrop';
        wrap.innerHTML = `<div class="modal" style="max-width:680px">
          <h3>Leave ledger — ${esc(btn.dataset.name)} (${data.year})</h3>
          <div class="table-wrap">${ledgerTable(led.entries)}</div>
          <div class="mt"><button class="btn btn-ghost" id="led-close">Close</button></div></div>`;
        document.body.appendChild(wrap);
        wrap.querySelector('#led-close').onclick = () => wrap.remove();
        wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
      } catch (e) { toast(e.message, 'error'); }
    });

    document.getElementById('btn-adjust').onclick = () => {
      const wrap = document.createElement('div');
      wrap.className = 'modal-backdrop';
      wrap.innerHTML = `<div class="modal"><h3>Balance adjustment</h3>
        <div class="muted small" style="margin-bottom:12px">Use <b>carry-forward</b> to grant AL carried from last year (max 5, lapses 30 June). Use <b>adjustment</b> to correct a balance (positive or negative days).</div>
        <div class="form-grid">
          <div class="field full"><label>Employee</label><select id="adj-user">
            ${data.rows.map(r => `<option value="${r.user.id}">${esc(r.user.name)} — ${esc(r.user.email)}</option>`).join('')}</select></div>
          <div class="field"><label>Kind</label><select id="adj-kind">
            <option value="carry_forward">Carry-forward (AL)</option><option value="adjustment">Adjustment</option></select></div>
          <div class="field"><label>Leave type</label><select id="adj-type">
            <option value="annual">Annual</option><option value="sick">Sick</option></select></div>
          <div class="field"><label>Days (+/−)</label><input type="number" id="adj-days" value="1" step="1"></div>
          <div class="field"><label>Year</label><input type="number" id="adj-year" value="${data.year}"></div>
          <div class="field full"><label>Note</label><input id="adj-note" placeholder="Reason for adjustment"></div>
        </div>
        <div class="mt flex">
          <button class="btn btn-primary" id="adj-save">Apply</button>
          <button class="btn btn-ghost" id="adj-cancel">Cancel</button>
        </div></div>`;
      document.body.appendChild(wrap);
      wrap.querySelector('#adj-cancel').onclick = () => wrap.remove();
      wrap.onclick = (e) => { if (e.target === wrap) wrap.remove(); };
      wrap.querySelector('#adj-save').onclick = async () => {
        try {
          await api('/admin/adjustments', { method: 'POST', body: {
            userId: Number(wrap.querySelector('#adj-user').value),
            kind: wrap.querySelector('#adj-kind').value,
            leaveType: wrap.querySelector('#adj-type').value,
            days: Number(wrap.querySelector('#adj-days').value),
            year: Number(wrap.querySelector('#adj-year').value),
            note: wrap.querySelector('#adj-note').value } });
          toast('Adjustment applied.', 'success'); wrap.remove(); render();
        } catch (e) { toast(e.message, 'error'); }
      };
    };
  }

  render();
})();
