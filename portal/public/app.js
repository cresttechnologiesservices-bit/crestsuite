/* CrestSuite portal — login + app launcher */
(() => {
  const $app = document.getElementById('app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function toast(msg, kind = '') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = msg;
    document.getElementById('toast-container').appendChild(el);
    setTimeout(() => el.remove(), 4200);
  }

  async function api(path, opts = {}) {
    const res = await fetch('/portal/api' + path, {
      ...opts,
      headers: { 'Content-Type': 'application/json' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed.');
    return data;
  }

  const APPS = [
    {
      key: 'clockit', icon: '⏱️', iconClass: 'time', name: 'ClockIT',
      desc: 'Time tracking, timesheets, projects, reports and team dashboards.',
    },
    {
      key: 'leavems', icon: '🌴', iconClass: 'leave', name: 'Leave Management',
      desc: 'Apply for leave, comp-offs and optional holidays; approvals and balances.',
    },
    {
      key: 'qms', icon: '✅', iconClass: 'qms', name: 'QMS Suite',
      desc: 'Documents, CAPAs, audits, training and manufacturing quality records.',
    },
    {
      key: 'usermgmt', icon: '🧑‍💼', iconClass: 'users', name: 'User Management',
      desc: 'Central directory for every CrestSuite app: accounts, roles and access.',
      // Its own app rather than an SSO handoff, and only for people with access
      href: '/usermgmt', restricted: true,
    },
  ];

  function renderLogin() {
    const params = new URLSearchParams(location.search);
    const err = params.get('error');
    $app.innerHTML = `
    <div class="login-card">
      <div class="brand"><span class="logo-dot">🏢</span> CrestSuite</div>
      <div class="sub">One login for ClockIT, Leave Management and QMS</div>
      ${err ? `<div class="error-banner">${esc(err)}</div>` : ''}
      <form id="login-form">
        <label>Email</label>
        <input id="email" type="email" required autofocus autocomplete="username">
        <label>Password</label>
        <input id="password" type="password" required autocomplete="current-password">
        <button class="primary" id="login-btn">Sign in</button>
      </form>
      <div class="aux-links"><a href="#" id="forgot-link">Forgot password?</a></div>
      <div class="login-hint">
        Sign in with your <strong>LeaveMS credentials</strong>.<br>
        Demo (click to fill): <code data-u="raj@crest-technologies.com" data-p="Welcome@123">raj@crest-technologies.com / Welcome@123</code><br>
        Seeded accounts use <code>Welcome@123</code> unless changed in LeaveMS.
      </div>
    </div>`;
    document.querySelectorAll('.login-hint code[data-u]').forEach((c) =>
      c.addEventListener('click', () => {
        document.getElementById('email').value = c.dataset.u;
        document.getElementById('password').value = c.dataset.p;
      })
    );
    document.getElementById('forgot-link').addEventListener('click', (e) => {
      e.preventDefault();
      renderForgot();
    });
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('login-btn');
      btn.disabled = true;
      try {
        const data = await api('/login', {
          method: 'POST',
          body: { email: document.getElementById('email').value, password: document.getElementById('password').value },
        });
        history.replaceState(null, '', '/');
        renderLauncher(data.user);
      } catch (err2) {
        toast(err2.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function renderForgot() {
    $app.innerHTML = `
    <div class="login-card">
      <div class="brand"><span class="logo-dot">🏢</span> CrestSuite</div>
      <div class="sub">Reset your password</div>
      <form id="forgot-form">
        <label>Email</label>
        <input id="email" type="email" required autofocus autocomplete="username">
        <button class="primary" id="forgot-btn">Email me a reset link</button>
      </form>
      <div class="aux-links"><a href="#" id="back-link">← Back to sign in</a></div>
    </div>`;
    document.getElementById('back-link').addEventListener('click', (e) => {
      e.preventDefault();
      renderLogin();
    });
    document.getElementById('forgot-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = document.getElementById('forgot-btn');
      btn.disabled = true;
      try {
        await api('/forgot-password', { method: 'POST', body: { email: document.getElementById('email').value } });
        toast('If that account exists, a reset link has been emailed. It is valid for 30 minutes.');
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function renderReset(token) {
    $app.innerHTML = `
    <div class="login-card">
      <div class="brand"><span class="logo-dot">🏢</span> CrestSuite</div>
      <div class="sub">Choose a new password</div>
      <form id="reset-form">
        <label>New password</label>
        <input id="pw1" type="password" required minlength="8" autofocus autocomplete="new-password">
        <label>Confirm new password</label>
        <input id="pw2" type="password" required minlength="8" autocomplete="new-password">
        <button class="primary" id="reset-btn">Set new password</button>
      </form>
      <div class="aux-links"><a href="#" id="back-link">← Back to sign in</a></div>
    </div>`;
    const backToLogin = () => {
      history.replaceState(null, '', '/');
      renderLogin();
    };
    document.getElementById('back-link').addEventListener('click', (e) => {
      e.preventDefault();
      backToLogin();
    });
    document.getElementById('reset-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw1 = document.getElementById('pw1').value;
      const pw2 = document.getElementById('pw2').value;
      if (pw1 !== pw2) return toast('Passwords do not match.', 'error');
      const btn = document.getElementById('reset-btn');
      btn.disabled = true;
      try {
        await api('/reset-password', { method: 'POST', body: { token, newPassword: pw1 } });
        toast('Password updated — sign in with your new password.');
        backToLogin();
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  function renderChangePassword(user) {
    $app.innerHTML = `
    <div class="login-card">
      <div class="brand"><span class="logo-dot">🏢</span> CrestSuite</div>
      <div class="sub">Change password for ${esc(user.email)}</div>
      <form id="change-form">
        <label>Current password</label>
        <input id="cur" type="password" required autofocus autocomplete="current-password">
        <label>New password</label>
        <input id="pw1" type="password" required minlength="8" autocomplete="new-password">
        <label>Confirm new password</label>
        <input id="pw2" type="password" required minlength="8" autocomplete="new-password">
        <button class="primary" id="change-btn">Change password</button>
      </form>
      <div class="aux-links"><a href="#" id="back-link">← Back to apps</a></div>
    </div>`;
    document.getElementById('back-link').addEventListener('click', (e) => {
      e.preventDefault();
      renderLauncher(user);
    });
    document.getElementById('change-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw1 = document.getElementById('pw1').value;
      const pw2 = document.getElementById('pw2').value;
      const cur = document.getElementById('cur').value;
      if (pw1 !== pw2) return toast('New password does not match.', 'error');
      // Caught here for immediate feedback; the server enforces it regardless.
      if (pw1 && pw1 === cur) return toast('New password cannot be the same as the current password.', 'error');
      const btn = document.getElementById('change-btn');
      btn.disabled = true;
      try {
        await api('/change-password', {
          method: 'POST',
          body: { currentPassword: cur, newPassword: pw1 },
        });
        toast('Password changed.');
        renderLauncher(user);
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    });
  }

  async function renderLauncher(user) {
    $app.innerHTML = `
    <div class="launcher">
      <div class="launcher-head">
        <div>
          <h1>Welcome, ${esc(user.name)}</h1>
          <div class="who">${esc(user.email)} · ${esc(user.role)}</div>
        </div>
        <div class="head-actions">
          <button class="btn-ghost" id="change-pw">Change password</button>
          <button class="btn-ghost" id="logout">Sign out</button>
        </div>
      </div>
      <div class="apps">
        ${APPS.filter((a) => !a.restricted || user.userMgmtAccess)
          .map(
            (a) => `
        <a class="app-card" href="${a.href || '/portal/sso/' + a.key}" data-app="${a.key}">
          <div class="app-icon ${a.iconClass}">${a.icon}</div>
          <h2>${a.name}</h2>
          <p>${a.desc}</p>
          <div class="status"><span class="dot" id="dot-${a.key}"></span><span id="status-${a.key}">Checking…</span></div>
          <div class="open-hint">Open →</div>
        </a>`
          )
          .join('')}
      </div>
    </div>`;

    document.getElementById('change-pw').addEventListener('click', () => renderChangePassword(user));
    document.getElementById('logout').addEventListener('click', async () => {
      try { await api('/logout', { method: 'POST' }); } catch {}
      // Also end the per-app sessions stored in this origin's localStorage.
      ['lms_token', 'qms_token', 'qms_user'].forEach((k) => localStorage.removeItem(k));
      renderLogin();
    });

    try {
      const s = await api('/status');
      setStatus('leavems', true, 'Ready');
      setStatus('qms', true, 'Ready');
      setStatus('usermgmt', true, 'Ready');
      if (s.clockit && s.clockitWeb) setStatus('clockit', true, 'Ready');
      else if (!s.clockit) setStatus('clockit', false, 'API offline — run: npm run clockit:api');
      else setStatus('clockit', false, 'Web app not built — see README');
    } catch {
      /* status is cosmetic */
    }
  }

  // ---------- User Management app ----------
  // The CrestSuite directory is shared by every app, so accounts are created,
  // edited and removed here instead of inside ClockIT / LeaveMS / QMS.
  async function renderUserMgmt(user) {
    if (!user.userMgmtAccess) {
      $app.innerHTML = `
      <div class="um-wrap"><div class="um-panel">
        <div class="um-bar"><div>
          <h2>User Management</h2>
          <div class="sub">Restricted application</div>
        </div>
        <a class="btn-sm" href="/">← Back to apps</a></div>
        <div class="um-empty">You do not have access to User Management.<br>
          Ask someone who does to grant you access.</div>
      </div></div>`;
      return;
    }

    // ?user=<email> opens just that person — used by "Manage" links from the
    // other apps, so the admin lands on the right record instead of hunting
    // through the whole directory. Email is the identifier the apps share.
    const focusEmail = (new URLSearchParams(location.search).get('user') || '').toLowerCase();

    let state = { users: [], me: null, search: '' };

    // Single-user view: their details, editable, without the full roster.
    const drawFocused = () => {
      const u = state.users.find((x) => x.email.toLowerCase() === focusEmail);
      if (!u) {
        $app.innerHTML = `
        <div class="um-wrap"><div class="um-panel">
          <div class="um-bar"><div>
            <h2>🧑‍💼 User Management</h2>
            <div class="sub">No account found for ${esc(focusEmail)}</div>
          </div>
          <div class="head-actions"><a class="btn-sm" href="/usermgmt">View all users</a>
          <a class="btn-sm" href="/">← Back to apps</a></div></div>
          <div class="um-empty">That person is not in the CrestSuite directory.</div>
        </div></div>`;
        return;
      }
      const managers = state.users.filter((x) => x.id !== u.id);
      const isMe = state.me && u.id === state.me.id;
      $app.innerHTML = `
      <div class="um-wrap"><div class="um-panel">
        <div class="um-bar">
          <div>
            <h2>🧑‍💼 ${esc(u.name)}</h2>
            <div class="sub">${esc(u.email)} · ${esc(u.role)}${u.active ? '' : ' · inactive'}</div>
          </div>
          <div class="head-actions">
            <a class="btn-sm" href="/usermgmt">View all users</a>
            <a class="btn-sm" href="/">← Back to apps</a>
          </div>
        </div>
        <div class="um-dialog" style="box-shadow:none;margin:0;max-width:560px">
          ${userFieldsHtml(u, managers)}
          <div class="actions">
            <button class="btn-sm" id="f-reset">Reset password</button>
            <button class="btn-sm ${u.userMgmtAccess ? '' : 'go'}" id="f-access"
              ${u.isOwner || isMe ? 'disabled title="Access for the owner and for yourself cannot be removed"' : ''}>
              ${u.userMgmtAccess ? 'Revoke User Management access' : 'Grant User Management access'}
            </button>
            <button class="primary" id="f-save" style="width:auto;margin:0;padding:9px 18px">Save</button>
          </div>
        </div>
      </div></div>`;

      const panel = document.querySelector('.um-dialog');
      document.getElementById('f-save').addEventListener('click', async () => {
        try {
          await api(`/usermgmt/users/${u.id}`, { method: 'PUT', body: readUserForm(panel, u) });
          toast('User updated.');
          await load();
        } catch (err) { toast(err.message, 'error'); }
      });
      document.getElementById('f-reset').addEventListener('click', async () => {
        if (!confirm(`Reset the password for ${u.name} to the default?`)) return;
        try {
          await api(`/usermgmt/users/${u.id}`, { method: 'PUT', body: { resetPassword: true } });
          toast('Password reset to the default.');
        } catch (err) { toast(err.message, 'error'); }
      });
      document.getElementById('f-access').addEventListener('click', async () => {
        try {
          await api(`/usermgmt/users/${u.id}/access`, { method: 'POST', body: { access: !u.userMgmtAccess } });
          toast('Access updated.');
          await load();
        } catch (err) { toast(err.message, 'error'); }
      });
    };

    const draw = () => {
      if (focusEmail) return drawFocused();
      const term = state.search.trim().toLowerCase();
      const rows = state.users.filter(
        (u) => !term || u.name.toLowerCase().includes(term) || u.email.toLowerCase().includes(term)
      );
      const body = rows.length
        ? rows
            .map((u) => {
              const isMe = state.me && u.id === state.me.id;
              return `
        <tr data-id="${u.id}">
          <td>
            <div class="um-name">${esc(u.name)}${isMe ? ' <span class="um-tag">you</span>' : ''}</div>
            <div class="um-mail">${esc(u.email)}</div>
          </td>
          <td><span class="um-tag ${u.isOwner ? 'owner' : u.role === 'admin' ? 'admin' : ''}">${esc(u.role)}</span></td>
          <td>${esc(u.managerName || '—')}</td>
          <td>${esc(u.joiningDate || '—')}</td>
          <td>${u.gender ? esc(u.gender[0].toUpperCase() + u.gender.slice(1)) : '—'}</td>
          <td><span class="um-tag ${u.active ? 'ok' : 'off'}">${u.active ? 'Active' : 'Inactive'}</span></td>
          <td>${u.userMgmtAccess ? '<span class="um-tag ok">Yes</span>' : '<span class="um-tag">No</span>'}</td>
          <td><div class="um-actions">
            <button class="btn-sm" data-edit="${u.id}">Edit</button>
            <button class="btn-sm ${u.userMgmtAccess ? '' : 'go'}" data-access="${u.id}"
              ${u.isOwner || isMe ? 'disabled title="Access for the owner and for yourself cannot be removed"' : ''}>
              ${u.userMgmtAccess ? 'Revoke access' : 'Grant access'}
            </button>
            <button class="btn-sm" data-reset="${u.id}">Reset password</button>
            <button class="btn-sm danger" data-remove="${u.id}"
              ${u.isOwner || isMe ? 'disabled' : ''}>Remove</button>
          </div></td>
        </tr>`;
            })
            .join('')
        : '<tr><td colspan="8" class="um-empty">No matching users.</td></tr>';

      $app.innerHTML = `
      <div class="um-wrap"><div class="um-panel">
        <div class="um-bar">
          <div>
            <h2>🧑‍💼 User Management</h2>
            <div class="sub">One directory for ClockIT, Leave Management and QMS ·
              ${state.users.filter((u) => u.active).length} active of ${state.users.length}</div>
          </div>
          <div class="head-actions">
            <input class="um-search" id="um-search" placeholder="Search name or email" value="${esc(state.search)}">
            <button class="btn-sm go" id="um-add">+ Add user</button>
            <a class="btn-sm" href="/">← Back to apps</a>
          </div>
        </div>
        <table class="um-table">
          <thead><tr>
            <th>User</th><th>Role</th><th>Manager</th><th>Joined</th><th>Gender</th>
            <th>Status</th><th>User Mgmt</th><th></th>
          </tr></thead>
          <tbody>${body}</tbody>
        </table>
      </div></div>`;

      const search = document.getElementById('um-search');
      search.addEventListener('input', () => {
        state.search = search.value;
        const pos = search.selectionStart;
        draw();
        const next = document.getElementById('um-search');
        next.focus();
        next.setSelectionRange(pos, pos);
      });
      document.getElementById('um-add').addEventListener('click', () => openDialog(null));
      document.querySelectorAll('[data-edit]').forEach((b) =>
        b.addEventListener('click', () =>
          openDialog(state.users.find((u) => u.id === Number(b.dataset.edit)))
        )
      );
      document.querySelectorAll('[data-access]').forEach((b) =>
        b.addEventListener('click', async () => {
          const u = state.users.find((x) => x.id === Number(b.dataset.access));
          const grant = !u.userMgmtAccess;
          if (
            !grant &&
            !confirm(`Remove ${u.name}'s access to User Management?`)
          ) return;
          try {
            await api(`/usermgmt/users/${u.id}/access`, { method: 'POST', body: { access: grant } });
            toast(grant ? `${u.name} can now manage users.` : `${u.name}'s access removed.`);
            await load();
          } catch (err) { toast(err.message, 'error'); }
        })
      );
      document.querySelectorAll('[data-reset]').forEach((b) =>
        b.addEventListener('click', async () => {
          const u = state.users.find((x) => x.id === Number(b.dataset.reset));
          if (!confirm(`Reset ${u.name}'s password to the default?`)) return;
          try {
            await api(`/usermgmt/users/${u.id}`, { method: 'PUT', body: { resetPassword: true } });
            toast(`Password reset for ${u.name}.`);
          } catch (err) { toast(err.message, 'error'); }
        })
      );
      document.querySelectorAll('[data-remove]').forEach((b) =>
        b.addEventListener('click', async () => {
          const u = state.users.find((x) => x.id === Number(b.dataset.remove));
          if (!confirm(`Permanently remove ${u.name}?\n\nTheir leave history and notifications are deleted, and their reports move to ${u.managerName || 'no manager'}. QMS records are kept but the account is deactivated.`)) return;
          try {
            await api(`/usermgmt/users/${u.id}`, { method: 'DELETE' });
            toast(`${u.name} removed.`);
            await load();
          } catch (err) { toast(err.message, 'error'); }
        })
      );
    };

    // The editable fields, shared by the modal and the single-user view opened
    // from another app's "Manage" link.
    const userFieldsHtml = (u, managers) => `
        <label>Full name</label>
        <input id="d-name" value="${u ? esc(u.name) : ''}" placeholder="Jane Doe">
        <label>Email</label>
        <input id="d-email" type="email" value="${u ? esc(u.email) : ''}" ${u ? 'disabled' : ''} placeholder="jane@crest-technologies.com">
        <div class="row">
          <div>
            <label>Role</label>
            <select id="d-role" ${u && u.isOwner ? 'disabled' : ''}>
              ${['employee', 'manager', 'admin']
                .map((r) => `<option value="${r}" ${u && u.role === r ? 'selected' : ''}>${r}</option>`)
                .join('')}
            </select>
          </div>
          <div>
            <label>Joining date</label>
            <input id="d-joined" type="date" value="${u ? esc(u.joiningDate || '') : new Date().toISOString().slice(0, 10)}">
          </div>
        </div>
        <label>Gender <span class="um-mail">— determines gender-specific leave entitlements</span></label>
        <select id="d-gender">
          ${[['', '— not stated —'], ['female', 'Female'], ['male', 'Male'], ['other', 'Other']]
            .map(([v, l]) => `<option value="${v}" ${u && (u.gender || '') === v ? 'selected' : ''}>${l}</option>`)
            .join('')}
        </select>
        <label>Manager</label>
        <select id="d-manager">
          <option value="">— none —</option>
          ${managers
            .map((m) => `<option value="${m.id}" ${u && u.managerId === m.id ? 'selected' : ''}>${esc(m.name)}</option>`)
            .join('')}
        </select>
        ${u ? `<label><input type="checkbox" id="d-active" style="width:auto" ${u.active ? 'checked' : ''} ${u.isOwner ? 'disabled' : ''}> Account active</label>` : ''}`;

    // Reads the shared form back out of whichever container holds it.
    const readUserForm = (scope, u) => {
      const body = {
        name: scope.querySelector('#d-name').value,
        role: scope.querySelector('#d-role').value,
        joiningDate: scope.querySelector('#d-joined').value,
        gender: scope.querySelector('#d-gender').value,
        managerId: scope.querySelector('#d-manager').value || null,
      };
      if (u) {
        const activeBox = scope.querySelector('#d-active');
        if (activeBox) body.active = activeBox.checked;
      }
      return body;
    };

    const openDialog = (u) => {
      const managers = state.users.filter((x) => !u || x.id !== u.id);
      const wrap = document.createElement('div');
      wrap.className = 'um-modal';
      wrap.innerHTML = `
      <div class="um-dialog">
        <h3>${u ? 'Edit ' + esc(u.name) : 'Add user'}</h3>
        ${userFieldsHtml(u, managers)}
        <div class="actions">
          <button class="btn-sm" id="d-cancel">Cancel</button>
          <button class="primary" id="d-save" style="width:auto;margin:0;padding:9px 18px">${u ? 'Save' : 'Create user'}</button>
        </div>
      </div>`;
      document.body.appendChild(wrap);
      const close = () => wrap.remove();
      wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
      wrap.querySelector('#d-cancel').addEventListener('click', close);
      wrap.querySelector('#d-save').addEventListener('click', async () => {
        const body = readUserForm(wrap, u);
        try {
          if (u) {
            await api(`/usermgmt/users/${u.id}`, { method: 'PUT', body });
            toast('User updated.');
          } else {
            body.email = wrap.querySelector('#d-email').value;
            await api('/usermgmt/users', { method: 'POST', body });
            toast('User created — they sign in with the default password.');
          }
          close();
          await load();
        } catch (err) { toast(err.message, 'error'); }
      });
    };

    const load = async () => {
      const data = await api('/usermgmt/users');
      state.users = data.users;
      state.me = data.me;
      draw();
    };

    $app.innerHTML = '<div class="um-wrap"><div class="um-panel"><div class="um-empty">Loading…</div></div></div>';
    try {
      await load();
    } catch (err) {
      toast(err.message, 'error');
      $app.innerHTML = `<div class="um-wrap"><div class="um-panel">
        <div class="um-empty">${esc(err.message)}</div>
        <div style="text-align:center"><a class="btn-sm" href="/">← Back to apps</a></div>
      </div></div>`;
    }
  }

  function setStatus(key, up, text) {
    const dot = document.getElementById('dot-' + key);
    const label = document.getElementById('status-' + key);
    if (dot) dot.className = 'dot ' + (up ? 'up' : 'down');
    if (label) label.textContent = text;
  }

  (async () => {
    // Arriving from a "Forgot password" email link.
    if (location.pathname === '/reset-password') {
      const token = new URLSearchParams(location.search).get('token');
      if (token) return renderReset(token);
    }
    try {
      const { user } = await api('/me');
      if (location.pathname === '/usermgmt') return renderUserMgmt(user);
      renderLauncher(user);
    } catch {
      renderLogin();
    }
  })();
})();
