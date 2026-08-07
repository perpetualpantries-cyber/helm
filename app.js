const tokenInput = document.getElementById('token');
const pendingList = document.getElementById('pending-list');
const activityList = document.getElementById('activity-list');

tokenInput.value = localStorage.getItem('helm_admin_token') ?? '';

document.getElementById('save-token').addEventListener('click', () => {
  localStorage.setItem('helm_admin_token', tokenInput.value);
  refresh();
});

document.getElementById('run-review').addEventListener('click', async (e) => {
  const btn = e.target;
  btn.disabled = true;
  btn.textContent = 'Running…';
  try {
    const res = await authFetch('/api/review', { method: 'POST' });
    if (!res.ok) throw new Error((await res.json()).error ?? res.statusText);
    await refresh();
  } catch (err) {
    alert(`Review failed: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Run review now';
  }
});

function authFetch(url, opts = {}) {
  const token = localStorage.getItem('helm_admin_token') ?? '';
  return fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'x-helm-token': token, ...(opts.headers ?? {}) },
  });
}

function fmtTime(iso) {
  if (!iso) return '';
  return new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z').toLocaleString();
}

function timerBadge(action) {
  if (!action.auto_execute_at || action.status !== 'pending') return '';
  const ms = new Date(action.auto_execute_at.includes('T') ? action.auto_execute_at : action.auto_execute_at.replace(' ', 'T') + 'Z') - Date.now();
  if (ms <= 0) return '<p class="meta">Auto-executes any moment now (timer expired) unless declined.</p>';
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  return `<p class="meta">Auto-executes in ${days}d ${hours}h unless declined.</p>`;
}

function actionCard(action, { showButtons }) {
  const div = document.createElement('div');
  div.className = 'card';
  const payload = safeParse(action.payload_json);

  div.innerHTML = `
    <div class="top">
      <div>
        <span class="badge ${action.risk}">${action.risk}</span>
        <span class="meta">${action.domain} · ${action.action_type} · ${fmtTime(action.created_at)}</span>
      </div>
      <span class="meta">#${action.id} · ${action.status}</span>
    </div>
    <p class="summary">${escapeHtml(action.summary)}</p>
    ${action.recommendation ? `<p class="recommendation">${escapeHtml(action.recommendation)}</p>` : ''}
    ${timerBadge(action)}
    ${Object.keys(payload).length ? `<pre class="meta">${escapeHtml(JSON.stringify(payload, null, 2))}</pre>` : ''}
    ${action.resolution_note ? `<p class="meta">Resolution: ${escapeHtml(action.resolution_note)}</p>` : ''}
  `;

  if (showButtons) {
    const row = document.createElement('div');
    row.className = 'actions-row';

    const approve = button('Approve', 'approve', () => resolve(action.id, 'approve'));
    const edit = button('Edit & approve', '', () => {
      const raw = prompt('Edit payload JSON before approving:', JSON.stringify(payload, null, 2));
      if (raw === null) return;
      try {
        const editedPayload = JSON.parse(raw);
        resolve(action.id, 'edit', editedPayload);
      } catch {
        alert('That was not valid JSON — nothing changed.');
      }
    });
    const decline = button('Decline', 'decline', () => resolve(action.id, 'decline'));

    row.append(approve, edit, decline);
    div.appendChild(row);
  }

  return div;
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', onClick);
  return b;
}

async function resolve(id, decision, payload) {
  const note = prompt(`Optional note for this ${decision}:`, '') ?? undefined;
  const res = await authFetch(`/api/actions/${id}/${decision}`, {
    method: 'POST',
    body: JSON.stringify({ note, payload }),
  });
  if (!res.ok) {
    alert(`Failed: ${(await res.json()).error ?? res.statusText}`);
    return;
  }
  await refresh();
}

function safeParse(json) {
  try {
    return JSON.parse(json ?? '{}');
  } catch {
    return {};
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function refresh() {
  const [pendingRes, recentRes] = await Promise.all([
    fetch('/api/actions?status=pending'),
    fetch('/api/actions'),
  ]);
  const pending = await pendingRes.json();
  const recent = (await recentRes.json()).filter((a) => a.status !== 'pending').slice(0, 30);

  pendingList.innerHTML = '';
  if (pending.length === 0) {
    pendingList.innerHTML = '<p class="empty">Nothing waiting on you right now.</p>';
  } else {
    pending.forEach((a) => pendingList.appendChild(actionCard(a, { showButtons: true })));
  }

  activityList.innerHTML = '';
  if (recent.length === 0) {
    activityList.innerHTML = '<p class="empty">No activity yet — run a review to get started.</p>';
  } else {
    recent.forEach((a) => activityList.appendChild(actionCard(a, { showButtons: false })));
  }
}

refresh();
