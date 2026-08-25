/* QMS Suite — single-page frontend (no framework). Hash-based routing. */
'use strict';

// ================= API helper =================
const API = {
  token: localStorage.getItem('qms_token') || null,
  user: JSON.parse(localStorage.getItem('qms_user') || 'null'),
  async req(method, url, body) {
    // Mounted under /qms by the CrestSuite portal; all callers pass '/api/...'.
    const res = await fetch('/qms' + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(this.token ? { Authorization: 'Bearer ' + this.token } : {}) },
      body: body ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch (e) { /* empty */ }
    if (res.status === 401 && API.user) { logout(false); throw new Error('Session expired — please sign in again'); }
    if (!res.ok) throw new Error((data && data.error) || `Request failed (${res.status})`);
    return data;
  },
  get(u) { return this.req('GET', u); },
  post(u, b) { return this.req('POST', u, b); },
  put(u, b) { return this.req('PUT', u, b); }
};

const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = iso => iso ? new Date(iso).toLocaleDateString() : '—';
const fmtDT = iso => iso ? new Date(iso).toLocaleString() : '—';

function toast(msg, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = msg;
  $('#toast-root').appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

function badge(text, color) { return `<span class="badge ${color}">${esc(text)}</span>`; }
function statusBadge(s) {
  const map = {
    Draft: 'gray', 'In Review': 'amber', Approved: 'blue', Effective: 'green', Archived: 'red', Superseded: 'gray',
    Open: 'amber', Containment: 'blue', 'Root Cause': 'blue', Action: 'blue', Verification: 'purple', Closed: 'green',
    Planned: 'gray', 'In Progress': 'blue', Complete: 'green', Assigned: 'amber', Completed: 'green',
    Active: 'blue', Launched: 'green', Submitted: 'purple', Rejected: 'red', 'Interim Approval': 'amber',
    Released: 'green', Shipped: 'blue', Quarantined: 'red', Scrapped: 'red',
    NRND: 'amber', LTB: 'amber', EOL: 'red', Obsolete: 'red',
    Conditional: 'amber', Suspended: 'red', Pass: 'green', Fail: 'red'
  };
  return badge(s, map[s] || 'gray');
}
const roleBadge = r => badge(r === 'admin' ? 'Administrator' : r === 'quality' ? 'Quality Manager' : 'Employee', r === 'admin' ? 'purple' : r === 'quality' ? 'blue' : 'gray');
const canQ = () => API.user && ['quality', 'admin'].includes(API.user.role);
const isAdmin = () => API.user && API.user.role === 'admin';

// ================= Modal =================
function modal(html, { wide } = {}) {
  const root = $('#modal-root');
  root.innerHTML = `<div class="modal-overlay"><div class="modal ${wide ? 'wide' : ''}">${html}</div></div>`;
  root.querySelector('.modal-overlay').addEventListener('click', e => { if (e.target.classList.contains('modal-overlay')) closeModal(); });
  return root;
}
function closeModal() { $('#modal-root').innerHTML = ''; }
window.closeModal = closeModal;

// Reusable e-signature block for approval workflows
const sigFields = (meaningLabel) => `
  <div class="sig-box">
    <strong>Electronic Signature</strong> — re-enter your password to sign. This action is recorded permanently in the audit trail.
    ${meaningLabel ? `<label>Signature meaning</label><input id="sig-meaning" value="${esc(meaningLabel)}">` : ''}
    <label>Your password</label>
    <input type="password" id="sig-password" autocomplete="current-password" placeholder="Password for ${esc(API.user ? API.user.email : '')}">
  </div>`;

// ================= Router =================
const routes = {};
function navigate(hash) { location.hash = hash; }
window.addEventListener('hashchange', render);

async function render() {
  if (!API.user) return renderLogin();
  const hash = location.hash.replace(/^#\/?/, '') || 'dashboard';
  const [page, id, sub] = hash.split('/');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.page === page));
  const main = $('#main');
  if (!main) { renderLayout(); return render(); }
  main.innerHTML = '<div class="empty">Loading…</div>';
  try {
    const fn = routes[page] || routes.dashboard;
    await fn(main, id, sub);
  } catch (e) {
    main.innerHTML = `<div class="card"><h2>Error</h2><p class="muted">${esc(e.message)}</p></div>`;
  }
}

// ================= Login =================
function renderLogin() {
  $('#app').innerHTML = `
  <div class="login-wrap"><div class="login-card">
    <div class="logo">✅ QMS Suite</div>
    <div class="sub">Quality Management System — ISO 9001 · ISO 13485 · IATF 16949 · AS9100 · ISO 22163</div>
    <form id="login-form">
      <label>Email</label><input id="login-email" type="email" required autofocus>
      <label>Password</label><input id="login-password" type="password" required>
      <div style="margin-top:18px"><button class="primary" style="width:100%">Sign in</button></div>
    </form>
    <div class="login-hint">
      <strong>Accounts</strong> (click to fill):<br>
      Owner: <code data-u="hirkant@gmail.com" data-p="Owner@123">hirkant@gmail.com / Owner@123</code><br>
      Admin: <code data-u="raj@crest-technologies.com" data-p="Admin@123">raj@crest-technologies.com / Admin@123</code><br>
      Manager: <code data-u="vishal.bhandary@crestaerospace.com" data-p="Manager@123">vishal.bhandary@crestaerospace.com / Manager@123</code><br>
      <span class="muted">All admin accounts use Admin@123; all manager accounts use Manager@123.</span>
    </div>
  </div></div>`;
  document.querySelectorAll('.login-hint code').forEach(c => c.addEventListener('click', () => {
    $('#login-email').value = c.dataset.u; $('#login-password').value = c.dataset.p;
  }));
  $('#login-form').addEventListener('submit', async e => {
    e.preventDefault();
    try {
      const data = await API.post('/api/auth/login', { email: $('#login-email').value, password: $('#login-password').value });
      API.token = data.token; API.user = data.user;
      localStorage.setItem('qms_token', data.token);
      localStorage.setItem('qms_user', JSON.stringify(data.user));
      renderLayout(); navigate('#/dashboard'); render();
      toast(`Welcome, ${data.user.name}`, 'success');
    } catch (err) { toast(err.message, 'error'); }
  });
}

async function logout(callApi = true) {
  if (callApi) { try { await API.post('/api/auth/logout'); } catch (e) {} }
  API.token = null; API.user = null;
  localStorage.removeItem('qms_token'); localStorage.removeItem('qms_user');
  // Return to the CrestSuite portal launcher (consistent across all apps)
  location.href = '/';
}
window.logout = logout;

// ================= Layout =================
function renderLayout() {
  const u = API.user;
  const q = canQ(), a = isAdmin();
  $('#app').innerHTML = `
  <div class="layout">
    <nav class="sidebar">
      <div class="brand">✅ QMS Suite<small>ISO 9001 · IATF 16949 · AS9100 · ISO 22163</small></div>
      <div class="nav-group">
        <a class="nav-item" data-page="dashboard" href="#/dashboard">📊 Dashboard</a>
      </div>
      <div class="nav-group"><div class="group-label">Quality Core</div>
        <a class="nav-item" data-page="documents" href="#/documents">📄 Document Control</a>
        <a class="nav-item" data-page="capas" href="#/capas">🛠️ CAPA / 8D</a>
        <a class="nav-item" data-page="audits" href="#/audits">🔍 Audits & LPA</a>
        <a class="nav-item" data-page="training" href="#/training">🎓 Training</a>
      </div>
      <div class="nav-group"><div class="group-label">Core Tools & Traceability</div>
        <a class="nav-item" data-page="apqp" href="#/apqp">🗺️ APQP</a>
        <a class="nav-item" data-page="ppap" href="#/ppap">📦 PPAP / PSW</a>
        <a class="nav-item" data-page="fmea" href="#/fmea">⚠️ FMEA</a>
        <a class="nav-item" data-page="spc" href="#/spc">📈 SPC & MSA</a>
        <a class="nav-item" data-page="fai" href="#/fai">✈️ FAI (AS9102)</a>
        <a class="nav-item" data-page="serials" href="#/serials">🔗 Traceability</a>
        <a class="nav-item" data-page="obsolescence" href="#/obsolescence">⏳ Obsolescence</a>
        <a class="nav-item" data-page="suppliers" href="#/suppliers">🏭 Suppliers</a>
      </div>
      ${q ? `<div class="nav-group"><div class="group-label">Compliance</div>
        <a class="nav-item" data-page="trail" href="#/trail">🧾 Audit Trail</a>
        <a class="nav-item" data-page="validation" href="#/validation">📋 Validation (IQ/OQ/PQ)</a>

      </div>` : ''}
      <div class="user-box">
        <div class="name">${esc(u.name)}</div>
        <div class="muted" style="color:#8fa2bd">${esc(u.email)}</div>
        <div class="role-badge">${roleBadge(u.role)}</div>
        <div style="margin-top:10px"><button class="small" onclick="logout()">Sign out</button></div>
      </div>
    </nav>
    <main class="main" id="main"></main>
  </div>`;
}

// ================= Dashboard =================
routes.dashboard = async (main) => {
  const d = await API.get('/api/system/dashboard');
  main.innerHTML = `
  <div class="page-head"><div><h1>Quality Dashboard</h1><p>Live status across all QMS processes</p></div></div>
  <div class="grid cols-4">
    <div class="kpi good"><div class="num">${d.documents.effective}</div><div class="label">Effective documents</div></div>
    <div class="kpi ${d.documents.inReview ? 'warn' : ''}"><div class="num">${d.documents.inReview}</div><div class="label">Docs awaiting review</div></div>
    <div class="kpi ${d.capas.open ? 'warn' : 'good'}"><div class="num">${d.capas.open}</div><div class="label">Open CAPAs</div></div>
    <div class="kpi ${d.capas.overdue ? 'bad' : 'good'}"><div class="num">${d.capas.overdue}</div><div class="label">Overdue CAPAs</div></div>
    <div class="kpi"><div class="num">${d.audits.planned + d.audits.inProgress}</div><div class="label">Audits planned / running</div></div>
    <div class="kpi good"><div class="num">${d.audits.completed || 0}</div><div class="label">Audits completed</div></div>
    <div class="kpi ${d.training.overdue ? 'bad' : ''}"><div class="num">${d.training.overdue}</div><div class="label">Overdue trainings</div></div>
    <div class="kpi ${d.obsolescence.atRisk ? 'warn' : 'good'}"><div class="num">${d.obsolescence.atRisk}</div><div class="label">Components at obsolescence risk</div></div>
    <div class="kpi"><div class="num">${d.apqp.active}</div><div class="label">Active APQP projects</div></div>
  </div>
  ${d.training.myPending ? `<div class="card" style="border-left:4px solid var(--amber)"><h2>🎓 You have ${d.training.myPending} pending training assignment(s)</h2>
    <p class="muted">Complete them with your read-&-understood e-signature.</p>
    <div style="margin-top:10px"><button class="primary" onclick="location.hash='#/training'">Go to My Training</button></div></div>` : ''}
  <div class="grid cols-2">
    <div class="card"><h2>Document lifecycle</h2>
      ${['draft','inReview','effective','archived'].map(k => `<div class="checklist-item"><span class="txt">${k === 'inReview' ? 'In Review' : k[0].toUpperCase() + k.slice(1)}</span><strong>${d.documents[k]}</strong></div>`).join('')}
    </div>
    <div class="card"><h2>CAPA status</h2>
      <div class="checklist-item"><span class="txt">Total raised</span><strong>${d.capas.total}</strong></div>
      <div class="checklist-item"><span class="txt">Open</span><strong>${d.capas.open}</strong></div>
      <div class="checklist-item"><span class="txt">Closed (verified)</span><strong>${d.capas.closed}</strong></div>
      <div class="checklist-item"><span class="txt">Audit findings without CAPA</span><strong>${d.audits.openFindings}</strong></div>
    </div>
  </div>`;
};

// ================= Documents =================
const DOC_TYPES = ['SOP', 'Work Instruction', 'Form', 'Policy', 'Quality Manual', 'Control Plan', 'Specification', 'Record'];
const DOC_CATEGORIES = ['ISO 9001', 'SDLC', 'Aerospace', 'Automotive', 'Industrial', 'IEC 62443', 'Others'];

routes.documents = async (main, id) => {
  if (id) return docDetail(main, id);
  const docs = await API.get('/api/documents');
  const allStandards = [...new Set(docs.flatMap(d => d.standards || []))].sort();
  main.innerHTML = `
  <div class="page-head"><div><h1>Document Control</h1><p>Centralized repository with revisions, e-sign approval, update &amp; archive</p></div>
    ${canQ() ? '<button class="primary" id="new-doc">+ New Document</button>' : ''}</div>
  <div class="tabs" id="doc-tabs">
    <div class="tab active" data-cat="">All</div>
    ${DOC_CATEGORIES.map(c => `<div class="tab" data-cat="${esc(c)}">${esc(c)}</div>`).join('')}
  </div>
  <div class="toolbar">
    <input id="doc-q" placeholder="Search title or number…" style="width:220px">
    <select id="doc-status"><option value="">All statuses</option>${['Draft','In Review','Approved','Effective','Archived'].map(s => `<option>${s}</option>`).join('')}</select>
    <select id="doc-type"><option value="">All types</option>${DOC_TYPES.map(t => `<option>${t}</option>`).join('')}</select>
    <select id="doc-standard"><option value="">All standards</option>${allStandards.map(s => `<option>${esc(s)}</option>`).join('')}</select>
  </div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Number</th><th>Title</th><th>Category</th><th>Type</th><th>Rev</th><th>Status</th><th>Standards</th><th>Updated</th></tr></thead>
    <tbody id="doc-rows"></tbody>
  </table></div>`;
  let activeCat = '';
  const draw = () => {
    const q = $('#doc-q').value.toLowerCase(), status = $('#doc-status').value,
      type = $('#doc-type').value, standard = $('#doc-standard').value;
    const list = docs.filter(d =>
      (!activeCat || (d.category || 'Others') === activeCat) &&
      (!status || d.status === status) &&
      (!type || d.type === type) &&
      (!standard || (d.standards || []).includes(standard)) &&
      (!q || d.title.toLowerCase().includes(q) || d.docNumber.toLowerCase().includes(q))
    );
    $('#doc-rows').innerHTML = list.length ? list.map(d => `
      <tr class="clickable" onclick="location.hash='#/documents/${d.id}'">
        <td><strong>${esc(d.docNumber)}</strong></td><td>${esc(d.title)}</td>
        <td>${badge(d.category || 'Others', 'purple')}</td><td>${esc(d.type)}</td>
        <td>${esc(d.rev)}</td><td>${statusBadge(d.status)}</td>
        <td class="muted">${(d.standards || []).map(esc).join(', ')}</td><td>${fmtDate(d.updatedAt)}</td>
      </tr>`).join('') : '<tr><td colspan="8" class="empty">No documents found</td></tr>';
  };
  draw();
  document.querySelectorAll('#doc-tabs .tab').forEach(t => t.addEventListener('click', () => {
    document.querySelectorAll('#doc-tabs .tab').forEach(x => x.classList.remove('active'));
    t.classList.add('active');
    activeCat = t.dataset.cat;
    draw();
  }));
  ['doc-q', 'doc-status', 'doc-type', 'doc-standard'].forEach(idSel => {
    $('#' + idSel).addEventListener(idSel === 'doc-q' ? 'input' : 'change', draw);
  });
  const nb = $('#new-doc');
  if (nb) nb.addEventListener('click', () => docForm());
};

// Read a modal's <input type="file"> into { name, mime, dataUrl } (10 MB max).
function readAttachment(sel) {
  return new Promise((resolve, reject) => {
    const input = $(sel);
    const file = input && input.files && input.files[0];
    if (!file) return resolve(undefined);
    if (file.size > 10 * 1024 * 1024) return reject(new Error('File exceeds the 10 MB limit'));
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, mime: file.type || 'application/octet-stream', dataUrl: reader.result });
    reader.onerror = () => reject(new Error('Could not read the selected file'));
    reader.readAsDataURL(file);
  });
}

// Promise-based confirmation built on the app's own modal, so callers can
// await a decision instead of using a browser dialog.
function confirmModal({ title, message, confirmLabel = 'Confirm', danger = false }) {
  return new Promise(resolve => {
    modal(`<h2>${esc(title)}</h2>
      <div class="modal-sub" style="white-space:pre-line">${esc(message)}</div>
      <div class="modal-actions">
        <button id="cm-cancel">Cancel</button>
        <button class="${danger ? 'danger' : 'primary'}" id="cm-ok">${esc(confirmLabel)}</button>
      </div>`);
    const finish = value => { closeModal(); resolve(value); };
    $('#cm-cancel').addEventListener('click', () => finish(false));
    $('#cm-ok').addEventListener('click', () => finish(true));
  });
}

// Guidance shown before downloading a revision that is not Effective, so an
// uncontrolled copy is never taken without the reader knowing its status.
const NON_EFFECTIVE_WARNING = {
  Draft: 'This revision is a DRAFT. It has not been reviewed, approved or released, and it must not be used to perform work.',
  'In Review': 'This revision is IN REVIEW. It is not approved or released yet, and its content may still change.',
  Approved: 'This revision is APPROVED but not yet EFFECTIVE. It must not be used to perform work until it is released.',
  Archived: 'This document is ARCHIVED. It is superseded or withdrawn and is retained for reference only.',
  Superseded: 'This revision is SUPERSEDED. A newer revision is the controlled copy.',
  Rejected: 'This revision was REJECTED and returned to Draft.'
};

// Authenticated download (the file endpoint requires the bearer token).
// Non-effective revisions require an explicit confirmation first.
async function downloadAttachment(docId, rev, name, status) {
  if (status && status !== 'Effective') {
    const detail = NON_EFFECTIVE_WARNING[status] || `This revision is ${status} and is not an effective, released document.`;
    const ok = await confirmModal({
      title: `Download a ${status} document?`,
      message: `${detail}\n\nOnly EFFECTIVE documents are controlled copies approved for use. Download this ${status} copy anyway?`,
      confirmLabel: 'Download anyway',
      danger: true
    });
    if (!ok) return;
  }
  try {
    const res = await fetch(`/qms/api/documents/${docId}/attachment/${encodeURIComponent(rev)}`,
      { headers: { Authorization: 'Bearer ' + API.token } });
    if (!res.ok) throw new Error('Download failed (' + res.status + ')');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name || 'attachment';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  } catch (e) { toast(e.message, 'error'); }
}
window.downloadAttachment = downloadAttachment;

// The revision's own status drives the warning: a document can be Effective at
// rev A while a newer rev B is still a draft.
const attachmentChip = (d, rev) => {
  if (!rev.attachment) return '';
  const status = rev.status || d.status;
  return `<div class="sig-box">📎 <strong>${esc(rev.attachment.name)}</strong> (${Math.round(rev.attachment.size / 1024)} KB)
      ${status !== 'Effective' ? `${statusBadge(status)} <span class="muted">not a controlled copy</span>` : ''}
      <button style="margin-left:8px" onclick="downloadAttachment('${d.id}','${esc(rev.rev)}','${esc(rev.attachment.name)}','${esc(status)}')">Download</button></div>`;
};

function docForm() {
  modal(`<h2>New Document</h2><div class="modal-sub">Created as Draft rev A; submit for review when ready.</div>
    <label>Title</label><input id="f-title">
    <div class="form-row">
      <div><label>Type</label><select id="f-type">${DOC_TYPES.map(t => `<option>${t}</option>`).join('')}</select></div>
      <div><label>Category</label><select id="f-cat">${DOC_CATEGORIES.map(c => `<option ${c === 'Others' ? 'selected' : ''}>${c}</option>`).join('')}</select></div>
      <div><label>Department</label><input id="f-dept"></div>
    </div>
    <label>Applicable standards (comma-separated)</label><input id="f-std" placeholder="ISO 9001:2015 §7.5, IATF 16949 §8.5.1">
    <label>Content</label><textarea id="f-content" placeholder="# Purpose&#10;…"></textarea>
    <label>Attached file (optional, max 10 MB — PDF, Office, images…)</label><input type="file" id="f-file">
    <label><input type="checkbox" id="f-training" style="width:auto"> Requires read-&amp;-understand training on release</label>
    <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="f-save">Create Draft</button></div>`);
  $('#f-save').addEventListener('click', async () => {
    try {
      const attachment = await readAttachment('#f-file');
      await API.post('/api/documents', {
        title: $('#f-title').value, type: $('#f-type').value, category: $('#f-cat').value, department: $('#f-dept').value,
        standards: $('#f-std').value.split(',').map(s => s.trim()).filter(Boolean),
        content: $('#f-content').value, trainingRequired: $('#f-training').checked, attachment
      });
      closeModal(); toast('Document created as Draft', 'success'); render();
    } catch (e) { toast(e.message, 'error'); }
  });
}

async function docDetail(main, id) {
  const d = await API.get('/api/documents/' + id);
  const rev = d.revisions[d.revisions.length - 1];
  const lifecycle = ['Draft', 'In Review', 'Approved', 'Effective'];
  const curIdx = d.status === 'Archived' ? -1 : lifecycle.indexOf(d.status);
  main.innerHTML = `
  <a class="back-link" href="#/documents">← All documents</a>
  <div class="page-head"><div><h1>${esc(d.docNumber)} — ${esc(d.title)}</h1>
    <p>${esc(d.type)} · Rev ${esc(rev.rev)} · ${(d.standards || []).map(esc).join(' · ')}</p></div>
    <div class="pill-row">${badge(d.category || 'Others', 'purple')} ${statusBadge(d.status)}</div></div>
  ${d.status === 'Archived' ? `<div class="card" style="border-left:4px solid var(--red)"><strong>Archived</strong> ${fmtDT(d.archivedAt)} by ${esc(d.archivedBy)} — ${esc(d.archiveReason || 'no reason recorded')}
    ${isAdmin() ? '<div style="margin-top:8px"><button id="btn-restore">Restore from archive</button></div>' : ''}</div>` : `
  <div class="steps">${lifecycle.map((s, i) => `<div class="step ${i < curIdx ? 'done' : i === curIdx ? 'current' : ''}">${s}</div>`).join('')}</div>`}
  <div class="card">
    <h2>Content — Rev ${esc(rev.rev)}</h2>
    <p class="muted">Change: ${esc(rev.changeSummary)} · by ${esc(rev.createdBy)} on ${fmtDate(rev.createdAt)}</p>
    <div class="doc-content" style="margin-top:8px">${esc(rev.content) || '<em>No content</em>'}</div>
    ${attachmentChip(d, rev)}
    ${rev.approvals.length ? `<div class="section-title">Electronic signatures</div>` + rev.approvals.map(a =>
      `<div class="sig-box">✍️ <strong>${esc(a.name)}</strong> (${esc(a.email)}) — ${esc(a.meaning || 'Approved')} · ${fmtDT(a.signedAt)} · <span class="hash">sig:${esc(a.sigHash)}</span></div>`).join('') : ''}
    ${canQ() && d.status !== 'Archived' ? `<div class="modal-actions" style="justify-content:flex-start">
      ${d.status === 'Draft' ? `<button class="primary" id="btn-edit">Edit draft</button><button id="btn-submit">Submit for review</button>` : ''}
      ${d.status === 'In Review' ? `<button class="primary" id="btn-approve">Approve & e-sign</button><button id="btn-reject">Reject to Draft</button>` : ''}
      ${['Effective', 'Approved'].includes(d.status) ? `<button class="primary" id="btn-revise">Update (new revision)</button>` : ''}
      <button class="danger" id="btn-archive">Archive</button>
    </div>` : ''}
  </div>
  <div class="card"><h2>Revision history</h2><div class="table-scroll"><table>
    <thead><tr><th>Rev</th><th>Change summary</th><th>Author</th><th>Date</th><th>Status</th><th>Signatures</th></tr></thead>
    <tbody>${d.revisions.slice().reverse().map(r => `<tr><td><strong>${esc(r.rev)}</strong></td><td>${esc(r.changeSummary)}</td>
      <td>${esc(r.createdBy)}</td><td>${fmtDate(r.createdAt)}</td><td>${statusBadge(r.status)}</td>
      <td class="muted">${r.approvals.map(a => esc(a.name)).join(', ') || '—'}</td></tr>`).join('')}</tbody>
  </table></div></div>
  <div class="card"><h2>Record history (audit trail)</h2><div id="doc-trail" class="muted">Loading…</div></div>`;

  API.get(`/api/system/trail/record/document/${id}`).then(entries => {
    $('#doc-trail').innerHTML = entries.length ? `<div class="table-scroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead><tbody>` +
      entries.map(e => `<tr><td>${fmtDT(e.ts)}</td><td>${esc(e.userName)}</td><td>${badge(e.action, 'blue')}</td><td>${esc(e.details)}</td></tr>`).join('') + '</tbody></table></div>' : 'No history yet';
  }).catch(() => { $('#doc-trail').textContent = 'History unavailable'; });

  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  on('#btn-submit', async () => { try { await API.post(`/api/documents/${id}/submit-review`); toast('Submitted for review', 'success'); render(); } catch (e) { toast(e.message, 'error'); } });
  on('#btn-reject', () => {
    modal(`<h2>Reject ${esc(d.docNumber)} to Draft</h2>
      <label>Rejection reason</label><input id="rj-reason" placeholder="Why is this document being rejected?">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="danger" id="rj-go">Reject to Draft</button></div>`);
    $('#rj-go').addEventListener('click', async () => {
      try { await API.post(`/api/documents/${id}/reject`, { reason: $('#rj-reason').value }); closeModal(); toast('Rejected to Draft'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#btn-restore', async () => { try { await API.post(`/api/documents/${id}/restore`); toast('Document restored', 'success'); render(); } catch (e) { toast(e.message, 'error'); } });
  on('#btn-edit', () => {
    modal(`<h2>Edit Draft — ${esc(d.docNumber)}</h2>
      <label>Title</label><input id="e-title" value="${esc(d.title)}">
      <label>Content</label><textarea id="e-content" style="min-height:220px">${esc(rev.content)}</textarea>
      <label>Change summary</label><input id="e-summary" value="${esc(rev.changeSummary)}">
      <label>Replace attached file (optional, max 10 MB)${rev.attachment ? ` — current: ${esc(rev.attachment.name)}` : ''}</label><input type="file" id="e-file">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="e-save">Save</button></div>`, { wide: true });
    $('#e-save').addEventListener('click', async () => {
      try {
        const attachment = await readAttachment('#e-file');
        await API.put(`/api/documents/${id}/draft`, { title: $('#e-title').value, content: $('#e-content').value, changeSummary: $('#e-summary').value, attachment });
        closeModal(); toast('Draft saved', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#btn-approve', () => {
    modal(`<h2>Approve ${esc(d.docNumber)} rev ${esc(rev.rev)}</h2>
      <div class="modal-sub">Two signatures (or one admin signature) release the document to Effective. ${d.trainingRequired ? 'Release will auto-assign read-&-understand training to all staff.' : ''}</div>
      ${sigFields('Approved')}
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="a-sign">Sign & Approve</button></div>`);
    $('#a-sign').addEventListener('click', async () => {
      try {
        const r = await API.post(`/api/documents/${id}/approve`, { meaning: $('#sig-meaning').value, signaturePassword: $('#sig-password').value });
        closeModal(); toast(`Signed — document now ${r.status}`, 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#btn-revise', () => {
    modal(`<h2>Update ${esc(d.docNumber)} — new revision ${String.fromCharCode(rev.rev.charCodeAt(0) + 1)}</h2>
      <div class="modal-sub">Creates a new Draft revision; the current revision stays effective until the new one is approved.</div>
      <label>Updated content</label><textarea id="r-content" style="min-height:220px">${esc(rev.content)}</textarea>
      <label>Change summary (required)</label><input id="r-summary" placeholder="What changed and why">
      <label>Replace attached file (optional — keeps the current one if empty)${rev.attachment ? ` — current: ${esc(rev.attachment.name)}` : ''}</label><input type="file" id="r-file">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="r-save">Create revision</button></div>`, { wide: true });
    $('#r-save').addEventListener('click', async () => {
      try {
        const attachment = await readAttachment('#r-file');
        await API.post(`/api/documents/${id}/revise`, { content: $('#r-content').value, changeSummary: $('#r-summary').value, attachment });
        closeModal(); toast('New revision created as Draft', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#btn-archive', () => {
    modal(`<h2>Archive ${esc(d.docNumber)}</h2>
      <div class="modal-sub">Archived documents are read-only and hidden from employees. Requires e-signature.</div>
      <label>Reason for archiving</label><input id="ar-reason" placeholder="e.g. superseded by …">
      ${sigFields()}
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="danger" id="ar-go">Archive document</button></div>`);
    $('#ar-go').addEventListener('click', async () => {
      try { await API.post(`/api/documents/${id}/archive`, { reason: $('#ar-reason').value, signaturePassword: $('#sig-password').value }); closeModal(); toast('Document archived', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
}

// ================= CAPA =================
routes.capas = async (main, id) => {
  if (id) return capaDetail(main, id);
  const capas = await API.get('/api/capas');
  main.innerHTML = `
  <div class="page-head"><div><h1>CAPA / 8D Problem Solving</h1><p>Corrective &amp; preventive actions with 8D, 5-Why and verification</p></div>
    <button class="primary" id="new-capa">+ Raise CAPA</button></div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Number</th><th>Title</th><th>Type</th><th>Source</th><th>Severity</th><th>Status</th><th>Owner</th><th>Due</th><th>Open actions</th></tr></thead>
    <tbody>${capas.length ? capas.map(c => `<tr class="clickable" onclick="location.hash='#/capas/${c.id}'">
      <td><strong>${esc(c.capaNumber)}</strong></td><td>${esc(c.title)}</td>
      <td>${badge(c.type, c.type === 'preventive' ? 'purple' : 'blue')}</td><td class="muted">${esc(c.source)}</td>
      <td>${badge(c.severity, c.severity === 'Major' ? 'red' : 'amber')}</td><td>${statusBadge(c.status)}</td>
      <td>${esc(c.owner)}</td><td>${esc(c.dueDate)}</td><td>${c.openActions}</td></tr>`).join('') : '<tr><td colspan="9" class="empty">No CAPAs</td></tr>'}</tbody>
  </table></div>`;
  $('#new-capa').addEventListener('click', () => {
    modal(`<h2>Raise CAPA / Nonconformance</h2>
      <label>Title</label><input id="c-title">
      <label>Description of problem</label><textarea id="c-desc"></textarea>
      <div class="form-row">
        <div><label>Type</label><select id="c-type"><option value="corrective">Corrective</option><option value="preventive">Preventive</option></select></div>
        <div><label>Severity</label><select id="c-sev"><option>Minor</option><option>Major</option><option>Critical</option></select></div>
      </div>
      <div class="form-row">
        <div><label>Source</label><input id="c-src" placeholder="e.g. Customer complaint, SPC, Audit"></div>
        <div><label>Due date</label><input id="c-due" type="date"></div>
      </div>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="c-save">Raise CAPA</button></div>`);
    $('#c-save').addEventListener('click', async () => {
      try {
        await API.post('/api/capas', { title: $('#c-title').value, description: $('#c-desc').value, type: $('#c-type').value, severity: $('#c-sev').value, source: $('#c-src').value, dueDate: $('#c-due').value });
        closeModal(); toast('CAPA raised', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
};

async function capaDetail(main, id) {
  const c = await API.get('/api/capas/' + id);
  const dKeys = Object.keys(c.eightD);
  const doneD = dKeys.filter(k => c.eightD[k].complete).length;
  main.innerHTML = `
  <a class="back-link" href="#/capas">← All CAPAs</a>
  <div class="page-head"><div><h1>${esc(c.capaNumber)} — ${esc(c.title)}</h1>
    <p>${badge(c.type, 'blue')} · Source: ${esc(c.source)} · Raised by ${esc(c.raisedBy)} on ${fmtDate(c.createdAt)} · Owner ${esc(c.owner)} · Due ${esc(c.dueDate)}</p></div>
    <div>${statusBadge(c.status)}</div></div>
  <div class="card"><h2>Problem description</h2><p>${esc(c.description)}</p></div>
  <div class="card"><h2>8D Workflow <span class="muted">(${doneD}/8 complete)</span></h2>
    <div class="steps">${dKeys.map(k => `<div class="step ${c.eightD[k].complete ? 'done' : ''}">${k.toUpperCase()}</div>`).join('')}</div>
    ${dKeys.map(k => {
      const s = c.eightD[k];
      return `<div class="checklist-item"><div class="txt"><strong>${esc(s.name)}</strong>
        <div class="muted">${esc(s.content) || 'Not documented yet'}${s.complete ? ` — ✅ ${esc(s.completedBy)} ${fmtDate(s.completedAt)}` : ''}</div></div>
        ${canQ() && c.status !== 'Closed' ? `<button class="small" data-dstep="${k}">Edit</button>` : ''}</div>`;
    }).join('')}
  </div>
  <div class="grid cols-2">
    <div class="card"><h2>5-Why Analysis</h2>
      ${c.fiveWhys.length ? c.fiveWhys.map(w => `<div class="checklist-item"><span class="txt">${esc(w)}</span></div>`).join('') : '<div class="empty">Not started</div>'}
      ${canQ() && c.status !== 'Closed' ? '<div style="margin-top:10px"><button class="small" id="edit-whys">Edit 5-Whys</button></div>' : ''}
    </div>
    <div class="card"><h2>Root Cause</h2>
      <p>${esc(c.rootCause) || '<em class="muted">Not determined yet</em>'}</p>
      <div class="section-title">Fishbone (6M)</div>
      ${Object.entries(c.fishbone).map(([k, v]) => v ? `<div class="checklist-item"><span class="txt"><strong>${k[0].toUpperCase() + k.slice(1)}:</strong> ${esc(v)}</span></div>` : '').join('') || '<span class="muted">No causes recorded</span>'}
      ${canQ() && c.status !== 'Closed' ? '<div style="margin-top:10px"><button class="small" id="edit-rc">Edit root cause</button></div>' : ''}
    </div>
  </div>
  <div class="card"><h2>Actions</h2>
    ${c.actions.length ? c.actions.map(a => `<div class="checklist-item">
      <input type="checkbox" style="width:auto" data-action="${a.id}" ${a.done ? 'checked' : ''} ${c.status === 'Closed' ? 'disabled' : ''}>
      <div class="txt"><strong>${esc(a.description)}</strong> ${badge(a.kind, a.kind === 'preventive' ? 'purple' : 'blue')}
        <div class="muted">Owner ${esc(a.owner)} · due ${esc(a.dueDate)}${a.done ? ` · done by ${esc(a.doneBy)} ${fmtDate(a.doneAt)}` : ''}</div></div></div>`).join('') : '<div class="empty">No actions yet</div>'}
    ${canQ() && c.status !== 'Closed' ? '<div style="margin-top:10px"><button class="small primary" id="add-action">+ Add action</button></div>' : ''}
  </div>
  ${c.verification ? `<div class="card"><h2>Verification & Closure</h2>
    <div class="detail-grid">
      <div><div class="dt">Method</div><div class="dd">${esc(c.verification.method)}</div></div>
      <div><div class="dt">Result</div><div class="dd">${esc(c.verification.result)}</div></div>
      <div><div class="dt">Effective?</div><div class="dd">${c.verification.effective ? '✅ Yes' : '❌ No'}</div></div>
      <div><div class="dt">Closed</div><div class="dd">${fmtDT(c.closedAt)} by ${esc(c.closedBy)}</div></div>
    </div>
    <div class="sig-box">✍️ <strong>${esc(c.verification.name)}</strong> · ${fmtDT(c.verification.signedAt)} · <span class="hash">sig:${esc(c.verification.sigHash)}</span></div>
  </div>` : canQ() && c.status !== 'Closed' ? `<div class="card"><h2>Verification & Closure</h2>
    <p class="muted">Requires all 8D steps complete and all actions done. Closure is e-signed.</p>
    <div style="margin-top:10px"><button class="primary" id="verify-close">Verify & Close CAPA</button></div></div>` : ''}`;

  document.querySelectorAll('[data-dstep]').forEach(btn => btn.addEventListener('click', () => {
    const k = btn.dataset.dstep, s = c.eightD[k];
    modal(`<h2>${esc(s.name)}</h2>
      <label>Content</label><textarea id="d-content">${esc(s.content)}</textarea>
      <label><input type="checkbox" id="d-complete" style="width:auto" ${s.complete ? 'checked' : ''}> Mark step complete</label>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="d-save">Save</button></div>`);
    $('#d-save').addEventListener('click', async () => {
      try { await API.put('/api/capas/' + id, { eightDStep: k, content: $('#d-content').value, complete: $('#d-complete').checked }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  }));
  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  on('#edit-whys', () => {
    modal(`<h2>5-Why Analysis</h2><div class="modal-sub">One "why" per line.</div>
      <textarea id="w-text" style="min-height:160px">${esc(c.fiveWhys.join('\n'))}</textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="w-save">Save</button></div>`);
    $('#w-save').addEventListener('click', async () => {
      try { await API.put('/api/capas/' + id, { fiveWhys: $('#w-text').value.split('\n').map(s => s.trim()).filter(Boolean) }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#edit-rc', () => {
    modal(`<h2>Root Cause & Fishbone</h2>
      <label>Root cause statement</label><textarea id="rc-text">${esc(c.rootCause)}</textarea>
      ${['man','machine','method','material','measurement','environment'].map(k => `<label>${k[0].toUpperCase() + k.slice(1)}</label><input id="fb-${k}" value="${esc(c.fishbone[k])}">`).join('')}
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="rc-save">Save</button></div>`);
    $('#rc-save').addEventListener('click', async () => {
      const fishbone = Object.fromEntries(['man','machine','method','material','measurement','environment'].map(k => [k, $('#fb-' + k).value]));
      try { await API.put('/api/capas/' + id, { rootCause: $('#rc-text').value, fishbone }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#add-action', () => {
    modal(`<h2>Add Action</h2>
      <label>Description</label><input id="a-desc">
      <div class="form-row">
        <div><label>Kind</label><select id="a-kind"><option value="corrective">Corrective</option><option value="preventive">Preventive</option><option value="containment">Containment</option></select></div>
        <div><label>Owner</label><input id="a-owner" value="${esc(c.owner)}"></div>
        <div><label>Due</label><input id="a-due" type="date" value="${esc(c.dueDate)}"></div>
      </div>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="a-save">Add</button></div>`);
    $('#a-save').addEventListener('click', async () => {
      try { await API.post(`/api/capas/${id}/actions`, { description: $('#a-desc').value, kind: $('#a-kind').value, owner: $('#a-owner').value, dueDate: $('#a-due').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-action]').forEach(cb => cb.addEventListener('change', async () => {
    try { await API.put(`/api/capas/${id}/actions/${cb.dataset.action}`, { done: cb.checked }); render(); } catch (e) { toast(e.message, 'error'); render(); }
  }));
  on('#verify-close', () => {
    modal(`<h2>Verify & Close ${esc(c.capaNumber)}</h2>
      <label>Verification method</label><input id="v-method" placeholder="e.g. 30-day SPC capability review">
      <label>Verification result</label><textarea id="v-result"></textarea>
      <label><input type="checkbox" id="v-eff" style="width:auto" checked> Actions verified effective</label>
      ${sigFields()}
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="v-go">Sign & Close</button></div>`);
    $('#v-go').addEventListener('click', async () => {
      try {
        await API.post(`/api/capas/${id}/verify-close`, { method: $('#v-method').value, result: $('#v-result').value, effective: $('#v-eff').checked, signaturePassword: $('#sig-password').value });
        closeModal(); toast('CAPA verified and closed', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
}

// ================= Audits =================
routes.audits = async (main, id) => {
  if (id) return auditDetail(main, id);
  const audits = await API.get('/api/audits');
  main.innerHTML = `
  <div class="page-head"><div><h1>Audit Management</h1><p>Internal, external, supplier and Layered Process Audits (LPA)</p></div>
    ${canQ() ? '<button class="primary" id="new-audit">+ Schedule Audit</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Number</th><th>Title</th><th>Type</th><th>Standard</th><th>Auditor</th><th>Scheduled</th><th>Status</th><th>Findings</th></tr></thead>
    <tbody>${audits.length ? audits.map(a => `<tr class="clickable" onclick="location.hash='#/audits/${a.id}'">
      <td><strong>${esc(a.auditNumber)}</strong></td><td>${esc(a.title)}</td>
      <td>${badge(a.type + (a.layer ? ' · ' + a.layer : ''), a.type === 'LPA' ? 'purple' : a.type === 'External' ? 'amber' : 'blue')}</td>
      <td class="muted">${esc(a.standard)}</td><td>${esc(a.auditor)}</td><td>${esc(String(a.scheduledDate).slice(0, 10))}</td>
      <td>${statusBadge(a.status)}</td><td>${a.findingCount} (${a.ncCount} NC)</td></tr>`).join('') : '<tr><td colspan="8" class="empty">No audits</td></tr>'}</tbody>
  </table></div>`;
  const nb = $('#new-audit');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>Schedule Audit</h2>
      <label>Title</label><input id="au-title">
      <div class="form-row">
        <div><label>Type</label><select id="au-type"><option>Internal</option><option>External</option><option>Supplier</option><option>LPA</option></select></div>
        <div><label>LPA layer</label><select id="au-layer"><option>Operator</option><option selected>Supervisor</option><option>Manager</option><option>Executive</option></select></div>
      </div>
      <div class="form-row">
        <div><label>Standard</label><input id="au-std" value="ISO 9001:2015"></div>
        <div><label>Scheduled date</label><input id="au-date" type="date"></div>
      </div>
      <div class="form-row">
        <div><label>Auditor</label><input id="au-auditor" value="${esc(API.user.name)}"></div>
        <div><label>Auditee / area</label><input id="au-auditee"></div>
      </div>
      <label>Scope</label><input id="au-scope">
      <label>Checklist items (one per line, optional "| clause" suffix)</label>
      <textarea id="au-checklist" placeholder="Are records retained per procedure? | 7.5.3"></textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="au-save">Schedule</button></div>`);
    $('#au-save').addEventListener('click', async () => {
      const checklist = $('#au-checklist').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [item, clause] = l.split('|').map(s => s.trim());
        return { item, clause: clause || '' };
      });
      try {
        await API.post('/api/audits', { title: $('#au-title').value, type: $('#au-type').value, layer: $('#au-layer').value, standard: $('#au-std').value, scheduledDate: $('#au-date').value, auditor: $('#au-auditor').value, auditee: $('#au-auditee').value, scope: $('#au-scope').value, checklist });
        closeModal(); toast('Audit scheduled', 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
};

async function auditDetail(main, id) {
  const a = await API.get('/api/audits/' + id);
  main.innerHTML = `
  <a class="back-link" href="#/audits">← All audits</a>
  <div class="page-head"><div><h1>${esc(a.auditNumber)} — ${esc(a.title)}</h1>
    <p>${esc(a.type)}${a.layer ? ' (' + esc(a.layer) + ' layer)' : ''} · ${esc(a.standard)} · Auditor: ${esc(a.auditor)} · Scheduled ${esc(String(a.scheduledDate).slice(0, 10))}</p>
    <p class="muted">Scope: ${esc(a.scope) || '—'}</p></div>
    <div>${statusBadge(a.status)}</div></div>
  ${canQ() && a.status === 'Planned' ? `<div class="card"><button class="primary" id="au-start">Start audit</button></div>` : ''}
  <div class="card"><h2>Checklist</h2>
    ${a.checklist.length ? a.checklist.map(item => `<div class="checklist-item">
      <div class="txt"><strong>${esc(item.item)}</strong>${item.clause ? ` <span class="muted">(§${esc(item.clause)})</span>` : ''}
        ${item.notes ? `<div class="muted">${esc(item.notes)}</div>` : ''}</div>
      ${item.result ? badge(item.result, item.result === 'Confirm' ? 'green' : item.result === 'Nonconfirm' ? 'red' : 'amber') : ''}
      ${canQ() && a.status === 'In Progress' ? `<button class="small" data-chk="${item.id}">Record</button>` : ''}
    </div>`).join('') : '<div class="empty">No checklist items</div>'}
    ${canQ() && a.status === 'In Progress' ? '<div style="margin-top:10px"><button class="small" id="add-chk">+ Add item</button></div>' : ''}
  </div>
  <div class="card"><h2>Findings</h2>
    ${a.findings.length ? a.findings.map(f => `<div class="checklist-item">
      <div class="txt"><strong>${esc(f.description)}</strong>${f.clause ? ` <span class="muted">(§${esc(f.clause)})</span>` : ''}
        ${f.capaNumber ? `<div class="muted">→ CAPA <a href="#/capas/${f.capaId}">${esc(f.capaNumber)}</a></div>` : ''}</div>
      ${badge(f.classification, f.classification === 'Major NC' ? 'red' : f.classification === 'Minor NC' ? 'amber' : 'gray')}
    </div>`).join('') : '<div class="empty">No findings recorded</div>'}
    ${canQ() && a.status === 'In Progress' ? '<div style="margin-top:10px"><button class="small primary" id="add-finding">+ Add finding</button></div>' : ''}
  </div>
  ${a.status === 'In Progress' && canQ() ? `<div class="card"><h2>Complete audit</h2>
    <label>Summary / report</label><textarea id="au-summary"></textarea>
    <div style="margin-top:10px"><button class="primary" id="au-complete">Complete audit</button></div></div>` : ''}
  ${a.summary ? `<div class="card"><h2>Audit report</h2><p>${esc(a.summary)}</p><p class="muted">Completed ${fmtDT(a.completedAt)}</p></div>` : ''}`;

  const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
  on('#au-start', async () => { try { await API.post(`/api/audits/${id}/start`); toast('Audit started', 'success'); render(); } catch (e) { toast(e.message, 'error'); } });
  document.querySelectorAll('[data-chk]').forEach(btn => btn.addEventListener('click', () => {
    const item = a.checklist.find(x => x.id === btn.dataset.chk);
    modal(`<h2>Record result</h2><p class="modal-sub">${esc(item.item)}</p>
      <label>Result</label><select id="chk-result">${['Confirm','Nonconfirm','Observation','N/A'].map(r => `<option ${item.result === r ? 'selected' : ''}>${r}</option>`).join('')}</select>
      <label>Notes / evidence</label><textarea id="chk-notes">${esc(item.notes)}</textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="chk-save">Save</button></div>`);
    $('#chk-save').addEventListener('click', async () => {
      try { await API.put(`/api/audits/${id}/checklist/${item.id}`, { result: $('#chk-result').value, notes: $('#chk-notes').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  }));
  on('#add-chk', () => {
    modal(`<h2>Add checklist item</h2><label>Item</label><input id="nc-item"><label>Clause</label><input id="nc-clause">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="nc-save">Add</button></div>`);
    $('#nc-save').addEventListener('click', async () => {
      try { await API.post(`/api/audits/${id}/checklist`, { item: $('#nc-item').value, clause: $('#nc-clause').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#add-finding', () => {
    modal(`<h2>Add Finding</h2>
      <label>Description</label><textarea id="fn-desc"></textarea>
      <div class="form-row">
        <div><label>Classification</label><select id="fn-cls"><option>Major NC</option><option selected>Minor NC</option><option>Observation</option></select></div>
        <div><label>Clause</label><input id="fn-clause"></div>
      </div>
      <label><input type="checkbox" id="fn-capa" style="width:auto" checked> Auto-raise linked CAPA (for NCs)</label>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="fn-save">Add finding</button></div>`);
    $('#fn-save').addEventListener('click', async () => {
      try { await API.post(`/api/audits/${id}/findings`, { description: $('#fn-desc').value, classification: $('#fn-cls').value, clause: $('#fn-clause').value, raiseCapa: $('#fn-capa').checked }); closeModal(); toast('Finding recorded', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  on('#au-complete', async () => {
    try { await API.post(`/api/audits/${id}/complete`, { summary: $('#au-summary').value }); toast('Audit completed', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
  });
}

// ================= Training =================
routes.training = async (main) => {
  const mine = await API.get('/api/trainings');
  let matrixHtml = '', usersOpt = '';
  if (canQ()) {
    const [matrix, users] = await Promise.all([API.get('/api/trainings/matrix'), API.get('/api/auth/users').catch(() => [])]);
    usersOpt = (users || []).filter(u => u.active).map(u => `<option value="${u.id}">${esc(u.name)} (${esc(u.role)})</option>`).join('');
    matrixHtml = `<div class="card"><h2>Competency matrix</h2><div class="table-scroll"><table>
      <thead><tr><th>Person</th><th>Role</th><th>Department</th><th>Assigned</th><th>Completed</th><th>Overdue</th></tr></thead>
      <tbody>${matrix.map(m => `<tr><td>${esc(m.name)}</td><td>${roleBadge(m.role)}</td><td class="muted">${esc(m.department)}</td>
        <td>${m.assigned}</td><td>${m.completed}</td><td>${m.overdue ? badge(m.overdue, 'red') : '0'}</td></tr>`).join('')}</tbody></table></div></div>`;
  }
  const isMine = t => t.userId === API.user.id;
  main.innerHTML = `
  <div class="page-head"><div><h1>Training Management</h1><p>Assignments, SOP acknowledgments and competency tracking</p></div>
    ${canQ() ? '<button class="primary" id="assign-trn">+ Assign training</button>' : ''}</div>
  <div class="card"><h2>${canQ() ? 'All training records' : 'My training'}</h2><div class="table-scroll"><table>
    <thead><tr><th>Person</th><th>Training</th><th>Type</th><th>Linked doc</th><th>Due</th><th>Status</th><th></th></tr></thead>
    <tbody>${mine.length ? mine.map(t => `<tr>
      <td>${esc(t.userName)}</td><td>${esc(t.title)}</td><td class="muted">${esc(t.type)}</td>
      <td>${t.docNumber ? `<a href="#/documents/${t.docId}">${esc(t.docNumber)}</a>` : '—'}</td>
      <td>${esc(t.dueDate)}</td><td>${statusBadge(t.status)}</td>
      <td>${t.status === 'Assigned' && (isMine(t) || canQ()) ? `<button class="small primary" data-trn="${t.id}">Complete & sign</button>` :
        t.acknowledgment ? `<span class="hash" title="${esc(t.acknowledgment.statement || '')}">sig:${esc(t.acknowledgment.sigHash)}</span>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="7" class="empty">No training records</td></tr>'}</tbody>
  </table></div></div>
  ${matrixHtml}`;
  document.querySelectorAll('[data-trn]').forEach(btn => btn.addEventListener('click', () => {
    const t = mine.find(x => x.id === btn.dataset.trn);
    modal(`<h2>Complete training</h2><p class="modal-sub">${esc(t.title)}</p>
      <p>By signing you acknowledge: <em>"I have read and understood this material and will comply with it."</em></p>
      ${sigFields()}
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="t-sign">Sign & complete</button></div>`);
    $('#t-sign').addEventListener('click', async () => {
      try { await API.post(`/api/trainings/${t.id}/complete`, { signaturePassword: $('#sig-password').value }); closeModal(); toast('Training completed & acknowledged', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  }));
  const ab = $('#assign-trn');
  if (ab) ab.addEventListener('click', async () => {
    const docs = await API.get('/api/documents');
    modal(`<h2>Assign training</h2>
      <label>Person</label><select id="tr-user">${usersOpt}</select>
      <label>Title</label><input id="tr-title">
      <div class="form-row">
        <div><label>Type</label><select id="tr-type"><option>Classroom</option><option>On-the-job</option><option>Document Acknowledgment</option><option>e-Learning</option></select></div>
        <div><label>Due date</label><input id="tr-due" type="date"></div>
      </div>
      <label>Linked document (optional)</label>
      <select id="tr-doc"><option value="">— none —</option>${docs.map(d => `<option value="${d.id}">${esc(d.docNumber)} ${esc(d.title)}</option>`).join('')}</select>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="tr-save">Assign</button></div>`);
    $('#tr-save').addEventListener('click', async () => {
      try { await API.post('/api/trainings', { userId: $('#tr-user').value, title: $('#tr-title').value, type: $('#tr-type').value, dueDate: $('#tr-due').value, docId: $('#tr-doc').value || null }); closeModal(); toast('Training assigned', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
};

// ================= APQP =================
routes.apqp = async (main, id) => {
  const projects = await API.get('/api/mfg/apqp');
  if (id) {
    const p = projects.find(x => x.id === id) || await API.get('/api/mfg/apqp/' + id);
    main.innerHTML = `
    <a class="back-link" href="#/apqp">← All APQP projects</a>
    <div class="page-head"><div><h1>${esc(p.projectNumber)} — ${esc(p.name)}</h1>
      <p>Part ${esc(p.partNumber)} · Customer ${esc(p.customer) || '—'} · Target SOP ${esc(String(p.targetSOP).slice(0, 10)) || '—'}</p></div>
      <div>${statusBadge(p.status)} ${badge('Phase ' + p.currentPhase, 'blue')}</div></div>
    <div class="steps">${p.phases.map(ph => `<div class="step ${ph.gateApproved ? 'done' : ph.number === p.currentPhase ? 'current' : ''}">P${ph.number}</div>`).join('')}</div>
    ${p.phases.map(ph => `<div class="card"><h2>${esc(ph.name)} ${ph.gateApproved ? badge('Gate approved ✓', 'green') : ph.number === p.currentPhase ? badge('Current', 'blue') : ''}</h2>
      ${ph.gateApproved ? `<p class="muted">Gate approved by ${esc(ph.gateApprovedBy)} on ${fmtDate(ph.gateApprovedAt)}</p>` : ''}
      ${ph.tasks.length ? ph.tasks.map(t => `<div class="checklist-item">
        <div class="txt"><strong>${esc(t.name)}</strong><div class="muted">${esc(t.owner)} · due ${esc(t.dueDate) || '—'}</div></div>
        ${statusBadge(t.status)}
        ${canQ() && t.status !== 'Complete' ? `<button class="small" data-task="${t.id}">Mark complete</button>` : ''}</div>`).join('') : '<div class="empty">No tasks</div>'}
      ${canQ() ? `<div style="margin-top:10px">
        <button class="small" data-addtask="${ph.number}">+ Task</button>
        ${!ph.gateApproved && ph.number === p.currentPhase ? `<button class="small primary" data-gate="${ph.number}">Approve gate</button>` : ''}</div>` : ''}
    </div>`).join('')}`;
    document.querySelectorAll('[data-task]').forEach(b => b.addEventListener('click', async () => {
      try { await API.put(`/api/mfg/apqp/${p.id}/tasks/${b.dataset.task}`, { status: 'Complete' }); render(); } catch (e) { toast(e.message, 'error'); }
    }));
    document.querySelectorAll('[data-gate]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post(`/api/mfg/apqp/${p.id}/gate/${b.dataset.gate}`); toast('Gate approved', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    }));
    document.querySelectorAll('[data-addtask]').forEach(b => b.addEventListener('click', () => {
      modal(`<h2>Add task — Phase ${b.dataset.addtask}</h2>
        <label>Task</label><input id="tk-name"><div class="form-row">
        <div><label>Owner</label><input id="tk-owner"></div><div><label>Due</label><input id="tk-due" type="date"></div></div>
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="tk-save">Add</button></div>`);
      $('#tk-save').addEventListener('click', async () => {
        try { await API.post(`/api/mfg/apqp/${p.id}/tasks`, { phase: b.dataset.addtask, name: $('#tk-name').value, owner: $('#tk-owner').value, dueDate: $('#tk-due').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
      });
    }));
    return;
  }
  main.innerHTML = `
  <div class="page-head"><div><h1>APQP — Advanced Product Quality Planning</h1><p>Phased launch management with gate approvals</p></div>
    ${canQ() ? '<button class="primary" id="new-apqp">+ New project</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Number</th><th>Project</th><th>Customer</th><th>Part</th><th>Phase</th><th>Status</th></tr></thead>
    <tbody>${projects.length ? projects.map(p => `<tr class="clickable" onclick="location.hash='#/apqp/${p.id}'">
      <td><strong>${esc(p.projectNumber)}</strong></td><td>${esc(p.name)}</td><td>${esc(p.customer)}</td><td>${esc(p.partNumber)}</td>
      <td>${badge('Phase ' + p.currentPhase + ' / 5', 'blue')}</td><td>${statusBadge(p.status)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No APQP projects</td></tr>'}</tbody>
  </table></div>`;
  const nb = $('#new-apqp');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>New APQP Project</h2>
      <label>Project name</label><input id="ap-name">
      <div class="form-row"><div><label>Customer</label><input id="ap-cust"></div><div><label>Part number</label><input id="ap-part"></div></div>
      <label>Target SOP (start of production)</label><input id="ap-sop" type="date">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="ap-save">Create</button></div>`);
    $('#ap-save').addEventListener('click', async () => {
      try { await API.post('/api/mfg/apqp', { name: $('#ap-name').value, customer: $('#ap-cust').value, partNumber: $('#ap-part').value, targetSOP: $('#ap-sop').value }); closeModal(); toast('APQP project created', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
};

// ================= PPAP =================
routes.ppap = async (main, id) => {
  const list = await API.get('/api/mfg/ppap');
  if (id) {
    const p = list.find(x => x.id === id) || await API.get('/api/mfg/ppap/' + id);
    const reqPending = p.elements.filter(e => e.required && e.status === 'Pending').length;
    main.innerHTML = `
    <a class="back-link" href="#/ppap">← All PPAPs</a>
    <div class="page-head"><div><h1>${esc(p.ppapNumber)} — ${esc(p.partName)}</h1>
      <p>Part ${esc(p.partNumber)} · Customer ${esc(p.customer)} · Submission level ${p.level} · ${esc(p.reason)}</p></div>
      <div>${statusBadge(p.status)}</div></div>
    <div class="card"><h2>PPAP elements <span class="muted">(${p.elements.filter(e => e.status === 'Complete').length}/${p.elements.length} complete, ${reqPending} required pending)</span></h2>
      ${p.elements.map(el => `<div class="checklist-item">
        <div class="txt"><strong>${esc(el.name)}</strong>${el.required ? '' : ' <span class="muted">(not required)</span>'}
          ${el.evidence ? `<div class="muted">Evidence: ${esc(el.evidence)}</div>` : ''}</div>
        ${badge(el.status, el.status === 'Complete' ? 'green' : el.status === 'N/A' ? 'gray' : 'amber')}
        ${canQ() && !['Approved'].includes(p.status) ? `<button class="small" data-el="${el.id}">Update</button>` : ''}
      </div>`).join('')}
    </div>
    ${p.psw ? `<div class="card"><h2>Part Submission Warrant (PSW)</h2>
      <div class="detail-grid">
        <div><div class="dt">Part</div><div class="dd">${esc(p.partNumber)} — ${esc(p.partName)}</div></div>
        <div><div class="dt">Customer</div><div class="dd">${esc(p.customer)}</div></div>
        <div><div class="dt">Level</div><div class="dd">${p.level}</div></div>
        <div><div class="dt">Result</div><div class="dd">${esc(p.psw.submissionResult)}</div></div>
      </div>
      <p><em>${esc(p.psw.declaration)}</em></p>
      <div class="sig-box">✍️ <strong>${esc(p.psw.signature.name)}</strong> · ${fmtDT(p.psw.signature.signedAt)} · <span class="hash">sig:${esc(p.psw.signature.sigHash)}</span></div>
      ${canQ() && p.status === 'Submitted' ? `<div style="margin-top:12px" class="pill-row">
        <button class="primary" data-disp="Approved">Customer: Approve</button>
        <button data-disp="Interim Approval">Interim approval</button>
        <button class="danger" data-disp="Rejected">Reject</button></div>` : ''}
    </div>` : canQ() ? `<div class="card"><h2>Part Submission Warrant</h2>
      <p class="muted">All required elements must be complete before the PSW can be generated and signed.</p>
      <div style="margin-top:10px"><button class="primary" id="gen-psw" ${reqPending > 1 ? 'disabled' : ''}>Generate & sign PSW</button></div></div>` : ''}`;
    document.querySelectorAll('[data-el]').forEach(b => b.addEventListener('click', () => {
      const el = p.elements.find(x => x.id === b.dataset.el);
      modal(`<h2>${esc(el.name)}</h2>
        <label>Status</label><select id="el-status">${['Pending','Complete','N/A'].map(s => `<option ${el.status === s ? 'selected' : ''}>${s}</option>`).join('')}</select>
        <label>Evidence / reference</label><input id="el-ev" value="${esc(el.evidence)}">
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="el-save">Save</button></div>`);
      $('#el-save').addEventListener('click', async () => {
        try { await API.put(`/api/mfg/ppap/${p.id}/elements/${el.id}`, { status: $('#el-status').value, evidence: $('#el-ev').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
      });
    }));
    const gp = $('#gen-psw');
    if (gp) gp.addEventListener('click', () => {
      modal(`<h2>Generate Part Submission Warrant</h2>
        <label>Declaration</label><textarea id="psw-decl">The results meet all design record requirements and this part is submitted for approval.</textarea>
        ${sigFields()}
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="psw-go">Sign & submit</button></div>`);
      $('#psw-go').addEventListener('click', async () => {
        try { await API.post(`/api/mfg/ppap/${p.id}/psw`, { declaration: $('#psw-decl').value, signaturePassword: $('#sig-password').value }); closeModal(); toast('PSW generated and submitted', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
      });
    });
    document.querySelectorAll('[data-disp]').forEach(b => b.addEventListener('click', async () => {
      try { await API.post(`/api/mfg/ppap/${p.id}/disposition`, { disposition: b.dataset.disp }); toast('Disposition recorded', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    }));
    return;
  }
  main.innerHTML = `
  <div class="page-head"><div><h1>PPAP — Production Part Approval</h1><p>18-element packages with Part Submission Warrant generation</p></div>
    ${canQ() ? '<button class="primary" id="new-ppap">+ New PPAP</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Number</th><th>Part</th><th>Customer</th><th>Level</th><th>Reason</th><th>Status</th></tr></thead>
    <tbody>${list.length ? list.map(p => `<tr class="clickable" onclick="location.hash='#/ppap/${p.id}'">
      <td><strong>${esc(p.ppapNumber)}</strong></td><td>${esc(p.partNumber)} — ${esc(p.partName)}</td><td>${esc(p.customer)}</td>
      <td>${p.level}</td><td class="muted">${esc(p.reason)}</td><td>${statusBadge(p.status)}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No PPAPs</td></tr>'}</tbody>
  </table></div>`;
  const nb = $('#new-ppap');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>New PPAP</h2>
      <div class="form-row"><div><label>Part number</label><input id="pp-num"></div><div><label>Part name</label><input id="pp-name"></div></div>
      <div class="form-row"><div><label>Customer</label><input id="pp-cust"></div><div><label>Submission level (1–5)</label><input id="pp-level" type="number" value="3" min="1" max="5"></div></div>
      <label>Reason</label><input id="pp-reason" value="Initial submission">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="pp-save">Create</button></div>`);
    $('#pp-save').addEventListener('click', async () => {
      try { await API.post('/api/mfg/ppap', { partNumber: $('#pp-num').value, partName: $('#pp-name').value, customer: $('#pp-cust').value, level: $('#pp-level').value, reason: $('#pp-reason').value }); closeModal(); toast('PPAP created', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
};

// ================= FMEA =================
routes.fmea = async (main, id) => {
  const list = await API.get('/api/mfg/fmea');
  if (id) {
    const f = list.find(x => x.id === id) || await API.get('/api/mfg/fmea/' + id);
    main.innerHTML = `
    <a class="back-link" href="#/fmea">← All FMEAs</a>
    <div class="page-head"><div><h1>${esc(f.fmeaNumber)} — ${esc(f.subject)}</h1>
      <p>${esc(f.type)} · Part ${esc(f.partNumber) || '—'} · Team: ${esc(f.team)}</p></div>
      ${canQ() ? '<button class="primary" id="add-row">+ Add failure mode</button>' : ''}</div>
    <div class="card table-scroll"><table>
      <thead><tr><th>Item / Step</th><th>Failure mode</th><th>Effect</th><th>S</th><th>Cause</th><th>O</th><th>Controls</th><th>D</th><th>RPN</th><th>AP</th><th>Action</th><th>Revised RPN</th><th></th></tr></thead>
      <tbody>${f.rows.length ? f.rows.map(r => `<tr>
        <td>${esc(r.item)}</td><td><strong>${esc(r.failureMode)}</strong></td><td>${esc(r.effect)}</td><td>${r.severity}</td>
        <td>${esc(r.cause)}</td><td>${r.occurrence}</td><td>${esc(r.controls)}</td><td>${r.detection}</td>
        <td><strong>${r.rpn}</strong></td><td>${badge(r.ap, r.ap === 'H' ? 'red' : r.ap === 'M' ? 'amber' : 'green')}</td>
        <td class="muted">${esc(r.recommendedAction)}${r.actionTaken ? `<br><em>Taken: ${esc(r.actionTaken)}</em>` : ''}</td>
        <td>${r.revised ? `<strong>${r.revised.rpn}</strong> ${badge(r.revised.ap, r.revised.ap === 'H' ? 'red' : r.revised.ap === 'M' ? 'amber' : 'green')}` : '—'}</td>
        <td>${canQ() ? `<button class="small" data-row="${r.id}">Mitigate</button>` : ''}</td>
      </tr>`).join('') : '<tr><td colspan="13" class="empty">No failure modes yet</td></tr>'}</tbody>
    </table></div>`;
    const ar = $('#add-row');
    if (ar) ar.addEventListener('click', () => {
      modal(`<h2>Add failure mode</h2>
        <div class="form-row"><div><label>Item / process step</label><input id="fm-item"></div><div><label>Failure mode</label><input id="fm-mode"></div></div>
        <label>Effect of failure</label><input id="fm-effect">
        <div class="form-row">
          <div><label>Severity (1–10)</label><input id="fm-s" type="number" min="1" max="10" value="5"></div>
          <div><label>Occurrence (1–10)</label><input id="fm-o" type="number" min="1" max="10" value="3"></div>
          <div><label>Detection (1–10)</label><input id="fm-d" type="number" min="1" max="10" value="3"></div>
        </div>
        <label>Potential cause</label><input id="fm-cause">
        <label>Current controls</label><input id="fm-controls">
        <label>Recommended action</label><input id="fm-action">
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="fm-save">Add</button></div>`);
      $('#fm-save').addEventListener('click', async () => {
        try {
          await API.post(`/api/mfg/fmea/${f.id}/rows`, { item: $('#fm-item').value, failureMode: $('#fm-mode').value, effect: $('#fm-effect').value, severity: $('#fm-s').value, occurrence: $('#fm-o').value, detection: $('#fm-d').value, cause: $('#fm-cause').value, controls: $('#fm-controls').value, recommendedAction: $('#fm-action').value });
          closeModal(); render();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
    document.querySelectorAll('[data-row]').forEach(b => b.addEventListener('click', () => {
      const r = f.rows.find(x => x.id === b.dataset.row);
      modal(`<h2>Mitigation — ${esc(r.failureMode)}</h2>
        <label>Action taken</label><textarea id="mt-taken">${esc(r.actionTaken)}</textarea>
        <div class="form-row">
          <div><label>Revised S</label><input id="mt-s" type="number" min="1" max="10" value="${r.revised ? r.revised.severity : r.severity}"></div>
          <div><label>Revised O</label><input id="mt-o" type="number" min="1" max="10" value="${r.revised ? r.revised.occurrence : r.occurrence}"></div>
          <div><label>Revised D</label><input id="mt-d" type="number" min="1" max="10" value="${r.revised ? r.revised.detection : r.detection}"></div>
        </div>
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="mt-save">Save</button></div>`);
      $('#mt-save').addEventListener('click', async () => {
        try { await API.put(`/api/mfg/fmea/${f.id}/rows/${r.id}`, { actionTaken: $('#mt-taken').value, revisedSeverity: $('#mt-s').value, revisedOccurrence: $('#mt-o').value, revisedDetection: $('#mt-d').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
      });
    }));
    return;
  }
  main.innerHTML = `
  <div class="page-head"><div><h1>FMEA — Failure Mode & Effects Analysis</h1><p>DFMEA / PFMEA risk matrices with RPN and Action Priority</p></div>
    ${canQ() ? '<button class="primary" id="new-fmea">+ New FMEA</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Number</th><th>Type</th><th>Subject</th><th>Part</th><th>Rows</th><th>High-risk (AP=H)</th></tr></thead>
    <tbody>${list.length ? list.map(f => `<tr class="clickable" onclick="location.hash='#/fmea/${f.id}'">
      <td><strong>${esc(f.fmeaNumber)}</strong></td><td>${badge(f.type, f.type === 'DFMEA' ? 'purple' : 'blue')}</td>
      <td>${esc(f.subject)}</td><td>${esc(f.partNumber)}</td><td>${f.rows.length}</td>
      <td>${f.rows.filter(r => (r.revised ? r.revised.ap : r.ap) === 'H').length ? badge(f.rows.filter(r => (r.revised ? r.revised.ap : r.ap) === 'H').length, 'red') : '0'}</td>
    </tr>`).join('') : '<tr><td colspan="6" class="empty">No FMEAs</td></tr>'}</tbody>
  </table></div>`;
  const nb = $('#new-fmea');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>New FMEA</h2>
      <div class="form-row"><div><label>Type</label><select id="nf-type"><option>PFMEA</option><option>DFMEA</option></select></div>
      <div><label>Part number</label><input id="nf-part"></div></div>
      <label>Subject / process</label><input id="nf-subject">
      <label>Team</label><input id="nf-team">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="nf-save">Create</button></div>`);
    $('#nf-save').addEventListener('click', async () => {
      try { await API.post('/api/mfg/fmea', { type: $('#nf-type').value, subject: $('#nf-subject').value, partNumber: $('#nf-part').value, team: $('#nf-team').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
};

// ================= SPC & MSA =================
function svgChart(points, ucl, lcl, cl, title, height = 180) {
  if (!points.length) return '<div class="empty">No data</div>';
  const w = Math.max(560, points.length * 46 + 80), h = height, padL = 58, padR = 16, padT = 24, padB = 26;
  const all = [...points, ucl, lcl, cl];
  const min = Math.min(...all), max = Math.max(...all);
  const span = (max - min) || 1;
  const y = v => padT + (h - padT - padB) * (1 - (v - min) / span);
  const x = i => padL + (w - padL - padR) * (points.length === 1 ? 0.5 : i / (points.length - 1));
  const line = (v, color, label) => `<line x1="${padL}" y1="${y(v)}" x2="${w - padR}" y2="${y(v)}" stroke="${color}" stroke-dasharray="5,4" stroke-width="1.2"/>
    <text x="${w - padR}" y="${y(v) - 4}" text-anchor="end" font-size="10" fill="${color}">${label} ${v}</text>`;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p)}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" style="font-family:inherit">
    <text x="${padL}" y="14" font-size="12" font-weight="700" fill="#1c2733">${title}</text>
    ${line(ucl, '#c0392b', 'UCL')}${line(lcl, '#c0392b', 'LCL')}${line(cl, '#178a4c', 'CL')}
    <path d="${path}" fill="none" stroke="#1d5fd1" stroke-width="1.8"/>
    ${points.map((p, i) => `<circle cx="${x(i)}" cy="${y(p)}" r="3.4" fill="${p > ucl || p < lcl ? '#c0392b' : '#1d5fd1'}"><title>#${i + 1}: ${p}</title></circle>`).join('')}
    ${points.map((p, i) => `<text x="${x(i)}" y="${h - 8}" text-anchor="middle" font-size="9" fill="#64748b">${i + 1}</text>`).join('')}
  </svg>`;
}

routes.spc = async (main, id) => {
  const [charts, msas] = await Promise.all([API.get('/api/mfg/spc'), API.get('/api/mfg/msa')]);
  if (id) {
    const ch = charts.find(x => x.id === id);
    if (!ch) { main.innerHTML = '<div class="empty">Chart not found</div>'; return; }
    const st = ch.stats;
    main.innerHTML = `
    <a class="back-link" href="#/spc">← SPC & MSA</a>
    <div class="page-head"><div><h1>${esc(ch.chartNumber || 'Control chart')} — ${esc(ch.partNumber)} / ${esc(ch.characteristic)}</h1>
      <p>USL ${ch.usl ?? '—'} / LSL ${ch.lsl ?? '—'} ${esc(ch.unit)} · subgroup n=${ch.subgroupSize} · ${ch.subgroups.length} subgroups</p></div>
      <button class="primary" id="add-subgroup">+ Record subgroup</button></div>
    ${st ? `<div class="grid cols-4">
      <div class="kpi"><div class="num">${st.xbarbar}</div><div class="label">Process mean (X̿)</div></div>
      <div class="kpi ${st.cp !== null && st.cp < 1.33 ? 'warn' : 'good'}"><div class="num">${st.cp ?? '—'}</div><div class="label">Cp</div></div>
      <div class="kpi ${st.cpk !== null && st.cpk < 1.33 ? 'warn' : 'good'}"><div class="num">${st.cpk ?? '—'}</div><div class="label">Cpk</div></div>
      <div class="kpi ${st.outOfControl.length ? 'bad' : 'good'}"><div class="num">${st.outOfControl.length}</div><div class="label">Out-of-control points</div></div>
    </div>
    ${st.cpk !== null && st.cpk < 1.33 ? `<div class="card" style="border-left:4px solid var(--amber)"><strong>⚠️ Capability below 1.33</strong> — process may not meet automotive capability requirements. Consider raising a CAPA.</div>` : ''}
    <div class="card"><h2>X-bar chart</h2><div class="chart-box">${svgChart(st.xbars, st.xUCL, st.xLCL, st.xbarbar, 'Subgroup means')}</div></div>
    <div class="card"><h2>R chart</h2><div class="chart-box">${svgChart(st.ranges, st.rUCL, st.rLCL, st.rbar, 'Subgroup ranges')}</div></div>` : '<div class="card"><div class="empty">Record subgroups to see charts and capability</div></div>'}
    <div class="card"><h2>Data</h2><div class="table-scroll"><table>
      <thead><tr><th>#</th><th>Values</th><th>Mean</th><th>Range</th><th>By</th><th>When</th></tr></thead>
      <tbody>${ch.subgroups.map((g, i) => `<tr><td>${i + 1}</td><td>${g.values.join(', ')}</td>
        <td>${st ? st.xbars[i] : ''}</td><td>${st ? st.ranges[i] : ''}</td><td>${esc(g.recordedBy)}</td><td>${fmtDT(g.at)}</td></tr>`).join('')}</tbody>
    </table></div></div>`;
    $('#add-subgroup').addEventListener('click', () => {
      modal(`<h2>Record subgroup</h2><div class="modal-sub">Enter ${ch.subgroupSize} measurements, comma-separated.</div>
        <input id="sg-values" placeholder="${Array(ch.subgroupSize).fill('25.02').join(', ')}">
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="sg-save">Record</button></div>`);
      $('#sg-save').addEventListener('click', async () => {
        try {
          const r = await API.post(`/api/mfg/spc/${ch.id}/subgroups`, { values: $('#sg-values').value.split(',').map(s => s.trim()) });
          closeModal();
          if (r.stats && r.stats.outOfControl.length) toast('⚠️ Out-of-control point detected!', 'error');
          else toast('Subgroup recorded', 'success');
          render();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
    return;
  }
  main.innerHTML = `
  <div class="page-head"><div><h1>SPC & MSA</h1><p>Live control charts (X-bar / R), capability indices and Gage R&amp;R studies</p></div>
    ${canQ() ? '<button class="primary" id="new-spc">+ New control chart</button>' : ''}</div>
  <div class="card"><h2>Control charts</h2><div class="table-scroll"><table>
    <thead><tr><th>Chart</th><th>Part</th><th>Characteristic</th><th>Subgroups</th><th>Cp</th><th>Cpk</th><th>In control?</th></tr></thead>
    <tbody>${charts.length ? charts.map(ch => `<tr class="clickable" onclick="location.hash='#/spc/${ch.id}'">
      <td><strong>${esc(ch.chartNumber || '—')}</strong></td><td>${esc(ch.partNumber)}</td><td>${esc(ch.characteristic)}</td><td>${ch.subgroups.length}</td>
      <td>${ch.stats ? ch.stats.cp ?? '—' : '—'}</td>
      <td>${ch.stats && ch.stats.cpk !== null ? (ch.stats.cpk < 1.33 ? badge(ch.stats.cpk, 'amber') : badge(ch.stats.cpk, 'green')) : '—'}</td>
      <td>${ch.stats ? (ch.stats.outOfControl.length ? badge('No — ' + ch.stats.outOfControl.length + ' pts', 'red') : badge('Yes', 'green')) : '—'}</td>
    </tr>`).join('') : '<tr><td colspan="7" class="empty">No charts</td></tr>'}</tbody>
  </table></div></div>
  <div class="card"><h2>MSA — Gage R&amp;R studies</h2><div class="table-scroll"><table>
    <thead><tr><th>Study</th><th>Gage</th><th>Characteristic</th><th>%GRR</th><th>Verdict</th><th>By</th><th></th></tr></thead>
    <tbody>${msas.length ? msas.map(m => `<tr>
      <td><strong>${esc(m.studyNumber)}</strong></td><td>${esc(m.gage)}</td><td>${esc(m.characteristic)}</td>
      <td>${m.results.pctGRR ?? '—'}%</td>
      <td>${badge(m.results.verdict, m.results.verdict === 'Acceptable' ? 'green' : m.results.verdict === 'Marginal' ? 'amber' : 'red')}</td>
      <td>${esc(m.performedBy)}</td>
      <td>${canQ() ? `<button class="small" data-msa="${m.id}">Edit</button>` : ''}</td></tr>`).join('') : '<tr><td colspan="7" class="empty">No studies</td></tr>'}</tbody>
  </table></div>
  ${canQ() ? '<div style="margin-top:10px"><button class="small primary" id="new-msa">+ New Gage R&R study</button></div>' : ''}</div>`;
  const ns = $('#new-spc');
  if (ns) ns.addEventListener('click', () => {
    modal(`<h2>New control chart</h2>
      <div class="form-row"><div><label>Part number</label><input id="sc-part"></div><div><label>Characteristic</label><input id="sc-char"></div></div>
      <div class="form-row">
        <div><label>LSL</label><input id="sc-lsl" type="number" step="any"></div>
        <div><label>USL</label><input id="sc-usl" type="number" step="any"></div>
        <div><label>Unit</label><input id="sc-unit" value="mm"></div>
        <div><label>Subgroup size</label><input id="sc-n" type="number" value="5" min="2" max="10"></div>
      </div>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="sc-save">Create</button></div>`);
    $('#sc-save').addEventListener('click', async () => {
      try { await API.post('/api/mfg/spc', { partNumber: $('#sc-part').value, characteristic: $('#sc-char').value, lsl: $('#sc-lsl').value, usl: $('#sc-usl').value, unit: $('#sc-unit').value, subgroupSize: $('#sc-n').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  const msaForm = (m) => {
    const dataLines = m ? (m.measurements || []).map(x => [x.appraiser, x.part, ...x.values].join(', ')).join('\n') : '';
    modal(`<h2>${m ? `Edit ${esc(m.studyNumber)} — Gage R&amp;R study` : 'New Gage R&amp;R study (range method)'}</h2>
      ${m ? '<div class="modal-sub">%GRR and verdict are recomputed from the updated data on save.</div>' : ''}
      <div class="form-row"><div><label>Gage</label><input id="ms-gage" value="${m ? esc(m.gage) : ''}"></div><div><label>Characteristic</label><input id="ms-char" value="${m ? esc(m.characteristic) : ''}"></div></div>
      <div class="form-row"><div><label>Part number</label><input id="ms-part" value="${m ? esc(m.partNumber) : ''}"></div><div><label>Tolerance (USL−LSL)</label><input id="ms-tol" type="number" step="any" value="${m && m.tolerance != null ? m.tolerance : ''}"></div></div>
      <label>Measurements — one line per appraiser/part cell: <code>appraiser, part, v1, v2, v3</code></label>
      <textarea id="ms-data" placeholder="Gundappa, 1, 25.019, 25.020, 25.019&#10;Gundappa, 2, 25.024, 25.025, 25.024&#10;Vishal, 1, 25.020, 25.019, 25.021">${esc(dataLines)}</textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="ms-save">${m ? 'Save changes' : 'Run study'}</button></div>`);
    $('#ms-save').addEventListener('click', async () => {
      const lines = $('#ms-data').value.split('\n').map(l => l.trim()).filter(Boolean);
      // Accept commas, semicolons or tabs (e.g. data pasted from Excel) as separators.
      const measurements = lines.map(l => {
        const parts = l.split(/[,;\t]/).map(s => s.trim()).filter(Boolean);
        return { appraiser: parts[0], part: parts[1], values: parts.slice(2).map(Number).filter(v => !isNaN(v)) };
      }).filter(x => x.values.length >= 2);
      if (!measurements.length) {
        return toast(lines.length
          ? 'Could not read the measurements — use one line per cell: appraiser, part, then 2–3 numeric trial values (e.g. "Gundappa, 1, 25.019, 25.020, 25.019")'
          : 'Enter at least one measurement line', 'error');
      }
      const payload = { gage: $('#ms-gage').value, characteristic: $('#ms-char').value, partNumber: $('#ms-part').value, tolerance: $('#ms-tol').value, measurements };
      try {
        const r = m ? await API.put('/api/mfg/msa/' + m.id, payload) : await API.post('/api/mfg/msa', payload);
        closeModal(); toast(`%GRR = ${r.results.pctGRR ?? 'n/a'} — ${r.results.verdict}`, 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  };
  const nm = $('#new-msa');
  if (nm) nm.addEventListener('click', () => msaForm(null));
  document.querySelectorAll('[data-msa]').forEach(b => b.addEventListener('click', () => msaForm(msas.find(x => x.id === b.dataset.msa))));
};

// ================= FAI =================
routes.fai = async (main, id) => {
  const list = await API.get('/api/mfg/fai');
  if (id) {
    const f = list.find(x => x.id === id) || await API.get('/api/mfg/fai/' + id);
    main.innerHTML = `
    <a class="back-link" href="#/fai">← All FAIRs</a>
    <div class="page-head"><div><h1>${esc(f.fairNumber)} — ${esc(f.form1.partName)}</h1>
      <p>AS9102 First Article Inspection Report</p></div>
      <div>${statusBadge(f.status)} ${f.result ? statusBadge(f.result) : ''}</div></div>
    <div class="card"><h2>Form 1 — Part Number Accountability</h2>
      <div class="detail-grid">
        <div><div class="dt">Part number</div><div class="dd">${esc(f.form1.partNumber)}</div></div>
        <div><div class="dt">Revision</div><div class="dd">${esc(f.form1.revision)}</div></div>
        <div><div class="dt">Drawing</div><div class="dd">${esc(f.form1.drawingNumber) || '—'}</div></div>
        <div><div class="dt">Serial number</div><div class="dd">${esc(f.form1.serialNumber) || '—'}</div></div>
        <div><div class="dt">FAI type</div><div class="dd">${f.form1.fullFAI ? 'Full FAI' : 'Partial FAI'}</div></div>
        <div><div class="dt">Reason</div><div class="dd">${esc(f.form1.reason)}</div></div>
      </div></div>
    <div class="card"><h2>Form 2 — Materials & Processes</h2>
      ${f.form2.length ? `<div class="table-scroll"><table><thead><tr><th>Material / Process</th><th>Specification</th><th>Cert #</th><th>Supplier</th></tr></thead>
      <tbody>${f.form2.map(m => `<tr><td>${esc(m.materialOrProcess)}</td><td>${esc(m.specification)}</td><td>${esc(m.certNumber)}</td><td>${esc(m.supplier)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">None recorded</div>'}
      ${canQ() && f.status !== 'Complete' ? '<div style="margin-top:10px"><button class="small" id="add-f2">+ Add material/process</button></div>' : ''}</div>
    <div class="card"><h2>Form 3 — Characteristic Accountability</h2>
      ${f.characteristics.length ? `<div class="table-scroll"><table><thead><tr><th>#</th><th>Requirement</th><th>Actual</th><th>Tooling</th><th>Result</th></tr></thead>
      <tbody>${f.characteristics.map(c => `<tr><td>${esc(c.charNumber)}</td><td>${esc(c.requirement)}</td><td>${esc(c.actual)}</td><td>${esc(c.tooling)}</td><td>${statusBadge(c.result)}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">None recorded</div>'}
      ${canQ() && f.status !== 'Complete' ? '<div style="margin-top:10px"><button class="small" id="add-char">+ Add characteristic</button><button class="primary small" id="fai-complete" style="margin-left:8px">Complete FAIR & sign</button></div>' : ''}</div>
    ${f.signature ? `<div class="sig-box">✍️ <strong>${esc(f.signature.name)}</strong> · ${fmtDT(f.signature.signedAt)} · <span class="hash">sig:${esc(f.signature.sigHash)}</span></div>` : ''}`;
    const on = (sel, fn) => { const el = $(sel); if (el) el.addEventListener('click', fn); };
    on('#add-f2', () => {
      modal(`<h2>Add material / process</h2>
        <label>Material or process</label><input id="f2-mp"><label>Specification</label><input id="f2-spec">
        <div class="form-row"><div><label>Cert number</label><input id="f2-cert"></div><div><label>Supplier</label><input id="f2-sup"></div></div>
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="f2-save">Add</button></div>`);
      $('#f2-save').addEventListener('click', async () => {
        try { await API.post(`/api/mfg/fai/${f.id}/form2`, { materialOrProcess: $('#f2-mp').value, specification: $('#f2-spec').value, certNumber: $('#f2-cert').value, supplier: $('#f2-sup').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
      });
    });
    on('#add-char', () => {
      modal(`<h2>Add characteristic</h2>
        <label>Requirement (with tolerance)</label><input id="ch-req" placeholder="Length 220.0 ±0.1 mm">
        <div class="form-row"><div><label>Actual measured</label><input id="ch-act"></div><div><label>Tooling / method</label><input id="ch-tool"></div></div>
        <label>Result</label><select id="ch-res"><option>Pass</option><option>Fail</option></select>
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="ch-save">Add</button></div>`);
      $('#ch-save').addEventListener('click', async () => {
        try { await API.post(`/api/mfg/fai/${f.id}/characteristics`, { requirement: $('#ch-req').value, actual: $('#ch-act').value, tooling: $('#ch-tool').value, result: $('#ch-res').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
      });
    });
    on('#fai-complete', () => {
      modal(`<h2>Complete ${esc(f.fairNumber)}</h2><div class="modal-sub">Overall result computed from characteristics. Requires e-signature.</div>
        ${sigFields()}
        <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="fc-go">Sign & complete</button></div>`);
      $('#fc-go').addEventListener('click', async () => {
        try { const r = await API.post(`/api/mfg/fai/${f.id}/complete`, { signaturePassword: $('#sig-password').value }); closeModal(); toast(`FAIR complete — ${r.result}`, r.result === 'Pass' ? 'success' : 'error'); render(); } catch (e) { toast(e.message, 'error'); }
      });
    });
    return;
  }
  main.innerHTML = `
  <div class="page-head"><div><h1>FAI — First Article Inspection (AS9102)</h1><p>Forms 1–3: part, materials/processes, characteristic accountability</p></div>
    ${canQ() ? '<button class="primary" id="new-fai">+ New FAIR</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>FAIR</th><th>Part</th><th>Rev</th><th>Characteristics</th><th>Status</th><th>Result</th></tr></thead>
    <tbody>${list.length ? list.map(f => `<tr class="clickable" onclick="location.hash='#/fai/${f.id}'">
      <td><strong>${esc(f.fairNumber)}</strong></td><td>${esc(f.form1.partNumber)} — ${esc(f.form1.partName)}</td>
      <td>${esc(f.form1.revision)}</td><td>${f.characteristics.length}</td><td>${statusBadge(f.status)}</td>
      <td>${f.result ? statusBadge(f.result) : '—'}</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No FAIRs</td></tr>'}</tbody>
  </table></div>`;
  const nb = $('#new-fai');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>New First Article Inspection</h2>
      <div class="form-row"><div><label>Part number</label><input id="fa-num"></div><div><label>Part name</label><input id="fa-name"></div></div>
      <div class="form-row"><div><label>Revision</label><input id="fa-rev" value="A"></div><div><label>Drawing number</label><input id="fa-dwg"></div><div><label>Serial number</label><input id="fa-sn"></div></div>
      <label>Reason</label><input id="fa-reason" value="New part introduction">
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="fa-save">Open FAIR</button></div>`);
    $('#fa-save').addEventListener('click', async () => {
      try { await API.post('/api/mfg/fai', { partNumber: $('#fa-num').value, partName: $('#fa-name').value, revision: $('#fa-rev').value, drawingNumber: $('#fa-dwg').value, serialNumber: $('#fa-sn').value, reason: $('#fa-reason').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
};

// ================= Traceability =================
routes.serials = async (main) => {
  const list = await API.get('/api/mfg/serials');
  main.innerHTML = `
  <div class="page-head"><div><h1>Serialization & Traceability</h1><p>Serial/batch genealogy down to raw-material mill certificates</p></div>
    <button class="primary" id="new-serial">+ Record unit</button></div>
  <div class="toolbar"><input id="ser-q" placeholder="Search serial, part or batch…" style="width:280px"></div>
  <div id="ser-list">${serialCards(list)}</div>`;
  $('#ser-q').addEventListener('input', async () => {
    const r = await API.get('/api/mfg/serials?q=' + encodeURIComponent($('#ser-q').value));
    $('#ser-list').innerHTML = serialCards(r);
    bindSerialStatus();
  });
  $('#new-serial').addEventListener('click', () => {
    modal(`<h2>Record serialized unit</h2>
      <div class="form-row"><div><label>Serial number</label><input id="sn-sn"></div><div><label>Part number</label><input id="sn-part"></div></div>
      <div class="form-row"><div><label>Part revision</label><input id="sn-rev" value="A"></div><div><label>Batch</label><input id="sn-batch"></div><div><label>Build date</label><input id="sn-date" type="date"></div></div>
      <label>Components — one per line: <code>component | serial/lot | supplier | mill cert</code></label>
      <textarea id="sn-comp" placeholder="Raw forging F-7745 | Lot L-2231 | ForgeWorks | MC-55710"></textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="sn-save">Record</button></div>`);
    $('#sn-save').addEventListener('click', async () => {
      const components = $('#sn-comp').value.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
        const [componentPart, serialOrLot, supplier, millCertRef] = l.split('|').map(s => s.trim());
        return { componentPart, serialOrLot, supplier, millCertRef };
      });
      try { await API.post('/api/mfg/serials', { serialNumber: $('#sn-sn').value, partNumber: $('#sn-part').value, partRevision: $('#sn-rev').value, batch: $('#sn-batch').value, buildDate: $('#sn-date').value, components }); closeModal(); toast('Unit recorded', 'success'); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  function bindSerialStatus() {
    document.querySelectorAll('[data-serstatus]').forEach(sel => sel.addEventListener('change', async () => {
      try { await API.put('/api/mfg/serials/' + sel.dataset.serstatus, { status: sel.value }); toast('Status updated', 'success'); } catch (e) { toast(e.message, 'error'); render(); }
    }));
  }
  bindSerialStatus();
};

function serialCards(list) {
  if (!list.length) return '<div class="card"><div class="empty">No serialized units</div></div>';
  return list.map(s => `<div class="card">
    <div class="page-head" style="margin-bottom:8px"><div><h2>🔗 ${esc(s.serialNumber)}</h2>
      <p class="muted">${esc(s.partNumber)} rev ${esc(s.partRevision)} · batch ${esc(s.batch) || '—'} · built ${esc(s.buildDate)} · by ${esc(s.recordedBy)}</p></div>
      <div>${canQ() ? `<select data-serstatus="${s.id}" style="width:auto">${['In Production','Released','Shipped','Quarantined','Scrapped'].map(st => `<option ${s.status === st ? 'selected' : ''}>${st}</option>`).join('')}</select>` : statusBadge(s.status)}</div></div>
    <div class="table-scroll"><table><thead><tr><th>Component</th><th>Serial / lot</th><th>Supplier</th><th>Mill cert</th></tr></thead>
      <tbody>${s.components.length ? s.components.map(c => `<tr><td>${esc(c.componentPart)}</td><td>${esc(c.serialOrLot)}</td><td>${esc(c.supplier)}</td><td class="hash">${esc(c.millCertRef)}</td></tr>`).join('') : '<tr><td colspan="4" class="muted">No components traced</td></tr>'}</tbody></table></div>
  </div>`).join('');
}

// ================= Obsolescence =================
routes.obsolescence = async (main) => {
  const list = await API.get('/api/mfg/obsolescence');
  main.innerHTML = `
  <div class="page-head"><div><h1>Obsolescence Management</h1><p>ISO 22163 / IRIS long-lifecycle component monitoring with redesign alerts</p></div>
    ${canQ() ? '<button class="primary" id="new-obs">+ Track component</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Component</th><th>Manufacturer / MPN</th><th>Lifecycle</th><th>LTB date</th><th>EOL date</th><th>Used in</th><th>Alert</th><th>Mitigation</th><th></th></tr></thead>
    <tbody>${list.length ? list.map(o => `<tr>
      <td><strong>${esc(o.component)}</strong></td><td class="muted">${esc(o.manufacturer)} ${esc(o.mpn)}</td>
      <td>${statusBadge(o.lifecycle)}</td><td>${o.ltbDate ? esc(String(o.ltbDate).slice(0, 10)) : '—'}</td>
      <td>${o.eolDate ? esc(String(o.eolDate).slice(0, 10)) : '—'}</td>
      <td class="muted">${(o.usedIn || []).map(esc).join(', ')}</td>
      <td>${o.alert ? badge(o.alert, o.alert.includes('PASSED') || o.alert.includes('REDESIGN') ? 'red' : 'amber') : badge('OK', 'green')}</td>
      <td class="muted">${esc(o.mitigation) || '—'}</td>
      <td>${canQ() ? `<button class="small" data-obs="${o.id}">Update</button>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">No components tracked</td></tr>'}</tbody>
  </table></div>`;
  const nb = $('#new-obs');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>Track component</h2>
      <label>Component</label><input id="ob-comp">
      <div class="form-row"><div><label>Manufacturer</label><input id="ob-mfr"></div><div><label>MPN</label><input id="ob-mpn"></div></div>
      <div class="form-row">
        <div><label>Lifecycle</label><select id="ob-lc">${['Active','NRND','LTB','EOL','Obsolete'].map(l => `<option>${l}</option>`).join('')}</select></div>
        <div><label>LTB date</label><input id="ob-ltb" type="date"></div>
        <div><label>EOL date</label><input id="ob-eol" type="date"></div>
      </div>
      <label>Used in (comma-separated)</label><input id="ob-used">
      <label>Mitigation plan</label><textarea id="ob-mit"></textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="ob-save">Track</button></div>`);
    $('#ob-save').addEventListener('click', async () => {
      try { await API.post('/api/mfg/obsolescence', { component: $('#ob-comp').value, manufacturer: $('#ob-mfr').value, mpn: $('#ob-mpn').value, lifecycle: $('#ob-lc').value, ltbDate: $('#ob-ltb').value || null, eolDate: $('#ob-eol').value || null, usedIn: $('#ob-used').value.split(',').map(s => s.trim()).filter(Boolean), mitigation: $('#ob-mit').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  });
  document.querySelectorAll('[data-obs]').forEach(b => b.addEventListener('click', () => {
    const o = list.find(x => x.id === b.dataset.obs);
    modal(`<h2>Update ${esc(o.component)}</h2>
      <label>Lifecycle</label><select id="uo-lc">${['Active','NRND','LTB','EOL','Obsolete'].map(l => `<option ${o.lifecycle === l ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <div class="form-row"><div><label>LTB date</label><input id="uo-ltb" type="date" value="${o.ltbDate ? String(o.ltbDate).slice(0, 10) : ''}"></div>
      <div><label>EOL date</label><input id="uo-eol" type="date" value="${o.eolDate ? String(o.eolDate).slice(0, 10) : ''}"></div></div>
      <label>Mitigation</label><textarea id="uo-mit">${esc(o.mitigation)}</textarea>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="uo-save">Save</button></div>`);
    $('#uo-save').addEventListener('click', async () => {
      try { await API.put('/api/mfg/obsolescence/' + o.id, { lifecycle: $('#uo-lc').value, ltbDate: $('#uo-ltb').value || null, eolDate: $('#uo-eol').value || null, mitigation: $('#uo-mit').value }); closeModal(); render(); } catch (e) { toast(e.message, 'error'); }
    });
  }));
};

// ================= Suppliers =================
routes.suppliers = async (main) => {
  const list = await API.get('/api/mfg/suppliers');
  main.innerHTML = `
  <div class="page-head"><div><h1>Supplier Quality</h1><p>Approved supplier list with counterfeit-part avoidance checks</p></div>
    ${canQ() ? '<button class="primary" id="new-sup">+ Add supplier</button>' : ''}</div>
  <div class="card table-scroll"><table>
    <thead><tr><th>Supplier</th><th>Category</th><th>Certifications</th><th>Authorized distributor</th><th>CoC required</th><th>Test reports</th><th>Counterfeit risk</th><th>Status</th><th></th></tr></thead>
    <tbody>${list.length ? list.map(s => `<tr>
      <td><strong>${esc(s.name)}</strong></td><td>${esc(s.category)}</td>
      <td class="muted">${(s.certifications || []).map(esc).join(', ') || '—'}</td>
      <td>${s.counterfeitChecks.authorizedDistributor ? '✅' : '❌'}</td>
      <td>${s.counterfeitChecks.cocRequired ? '✅' : '❌'}</td>
      <td>${s.counterfeitChecks.testReportsRequired ? '✅' : '❌'}</td>
      <td>${badge(s.counterfeitRisk, s.counterfeitRisk === 'High' ? 'red' : s.counterfeitRisk === 'Medium' ? 'amber' : 'green')}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${canQ() ? `<select data-supstatus="${s.id}" style="width:auto">${['Approved','Conditional','Suspended'].map(st => `<option ${s.status === st ? 'selected' : ''}>${st}</option>`).join('')}</select>` : ''}</td>
    </tr>`).join('') : '<tr><td colspan="9" class="empty">No suppliers</td></tr>'}</tbody>
  </table></div>`;
  document.querySelectorAll('[data-supstatus]').forEach(sel => sel.addEventListener('change', async () => {
    try { await API.put('/api/mfg/suppliers/' + sel.dataset.supstatus, { status: sel.value }); toast('Supplier status updated', 'success'); render(); } catch (e) { toast(e.message, 'error'); render(); }
  }));
  const nb = $('#new-sup');
  if (nb) nb.addEventListener('click', () => {
    modal(`<h2>Add supplier</h2>
      <div class="form-row"><div><label>Name</label><input id="sp-name"></div><div><label>Category</label><input id="sp-cat" value="Component"></div></div>
      <label>Certifications (comma-separated)</label><input id="sp-certs" placeholder="ISO 9001:2015, AS9100D">
      <div class="section-title">Counterfeit-part avoidance checks</div>
      <label><input type="checkbox" id="sp-auth" style="width:auto" checked> Authorized distributor / direct from OCM</label>
      <label><input type="checkbox" id="sp-coc" style="width:auto" checked> Certificate of Conformance required on every shipment</label>
      <label><input type="checkbox" id="sp-test" style="width:auto"> Independent test reports required</label>
      <div class="modal-actions"><button onclick="closeModal()">Cancel</button><button class="primary" id="sp-save">Add</button></div>`);
    $('#sp-save').addEventListener('click', async () => {
      try {
        const r = await API.post('/api/mfg/suppliers', { name: $('#sp-name').value, category: $('#sp-cat').value, certifications: $('#sp-certs').value.split(',').map(s => s.trim()).filter(Boolean), authorizedDistributor: $('#sp-auth').checked, cocRequired: $('#sp-coc').checked, testReportsRequired: $('#sp-test').checked });
        closeModal(); toast(`Supplier added — counterfeit risk ${r.counterfeitRisk}`, r.counterfeitRisk === 'High' ? 'error' : 'success'); render();
      } catch (e) { toast(e.message, 'error'); }
    });
  });
};

// ================= Audit trail =================
routes.trail = async (main) => {
  const entries = await API.get('/api/system/trail?limit=300');
  let verifyHtml = '';
  if (isAdmin()) {
    const v = await API.get('/api/system/trail/verify');
    verifyHtml = `<div class="card" style="border-left:4px solid ${v.valid ? 'var(--green)' : 'var(--red)'}">
      <strong>${v.valid ? '🔒 Hash chain verified' : '🚨 HASH CHAIN BROKEN'}</strong> — ${v.checked} entries checked${v.brokenAt ? `, broken at entry ${v.brokenAt}` : ''}.
      <span class="muted">Each entry is SHA-256 chained to the previous one; any retroactive edit invalidates the chain.</span></div>`;
  }
  main.innerHTML = `
  <div class="page-head"><div><h1>Audit Trail</h1><p>Append-only, tamper-evident log of every quality-record action</p></div></div>
  ${verifyHtml}
  <div class="toolbar">
    <select id="tr-entity"><option value="">All entities</option>${['document','capa','audit','training','user','session','apqp','ppap','fmea','spc','msa','fai','serial','obsolescence','supplier'].map(e => `<option>${e}</option>`).join('')}</select>
  </div>
  <div class="card table-scroll"><table>
    <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Entity</th><th>Details</th><th>Hash</th></tr></thead>
    <tbody id="tr-rows"></tbody></table></div>`;
  const draw = list => {
    $('#tr-rows').innerHTML = list.length ? list.map(e => `<tr>
      <td style="white-space:nowrap">${fmtDT(e.ts)}</td><td>${esc(e.userName)}</td>
      <td>${badge(e.action, e.action.includes('FAIL') || e.action === 'ARCHIVE' ? 'red' : e.action === 'SIGN' || e.action === 'APPROVE' ? 'green' : 'blue')}</td>
      <td class="muted">${esc(e.entity)}</td><td>${esc(e.details)}</td>
      <td class="hash" title="prev: ${esc(e.prevHash)}">${esc((e.hash || '').slice(0, 12))}…</td></tr>`).join('') : '<tr><td colspan="6" class="empty">No entries</td></tr>';
  };
  draw(entries);
  $('#tr-entity').addEventListener('change', async () => {
    draw(await API.get('/api/system/trail?limit=300&entity=' + encodeURIComponent($('#tr-entity').value)));
  });
};

// ================= Validation docs =================
routes.validation = async (main, id) => {
  if (id) {
    const doc = await API.get('/api/system/validation/' + id);
    main.innerHTML = `<a class="back-link" href="#/validation">← Validation documents</a>
      <div class="card"><div class="doc-content" style="max-height:none">${esc(doc.content)}</div></div>`;
    return;
  }
  const files = await API.get('/api/system/validation');
  main.innerHTML = `
  <div class="page-head"><div><h1>Software Validation (IQ / OQ / PQ)</h1><p>Documentation proving the QMS software performs per intended use</p></div></div>
  <div class="card">${files.length ? files.map(f => `<div class="checklist-item">
    <div class="txt"><strong>${esc(f.name)}</strong></div>
    <button class="small" onclick="location.hash='#/validation/${esc(f.file)}'">Open</button></div>`).join('') : '<div class="empty">No validation documents</div>'}</div>`;
};

// ================= Users (moved to CrestSuite User Management) =================
// Accounts are administered centrally for every CrestSuite app, so QMS no
// longer creates or edits users. Existing bookmarks land on this pointer.
routes.users = async (main) => {
  main.innerHTML = `
  <div class="page-head"><div><h1>User Management</h1>
    <p>User accounts moved to the central CrestSuite User Management app</p></div></div>
  <div class="card">
    <p>Accounts, roles and access are now managed in one place for ClockiT, Leave
    Management and QMS. QMS keeps each person's quality role and e-signature
    identity, but people are added, edited and removed centrally.</p>
    <div style="margin-top:14px"><a class="btn" href="/usermgmt">Open User Management →</a></div>
    <p class="muted" style="margin-top:10px">Access to that app is restricted; ask an
    administrator who has it if you need access.</p>
  </div>`;
};

// ================= Boot =================
if (API.user) { renderLayout(); render(); } else renderLogin();
