// Access tab: the owner (public.app_owner) adds and removes who can edit numbers and goals (Admin), see the Executive
// tab, and see the Commercial and HOA tabs. Every change goes through database functions that check the owner and
// record who changed what in public.access_log; the database lists themselves stay locked to everyone else.
(function () {
  const $ = (id) => document.getElementById(id);
  const ALL = [['admin', 'Admin', 'Edit goals and enter numbers'], ['exec', 'Executive', 'Company cash, projection and P&L'], ['commercial', 'Commercial & HOA', 'Commercial tenants and HOA dues'], ['manager', 'Manage access', 'Add and remove people']];
  let AREAS = ALL, owner = false;
  const TABS = [['workorders', 'Work orders'], ['billing', 'Billing check'], ['utilreview', 'Utilities'], ['portfolio', 'Portfolio'], ['map', 'Map'], ['comms', 'Communications']];
  // Role presets: picking one checks its tabs; any box can still be changed afterwards (the role then shows Custom).
  const ROLES = [
    ['Leadership', ['workorders', 'billing', 'utilreview', 'portfolio', 'map', 'comms']],
    ['Property manager', ['workorders', 'billing', 'portfolio', 'map', 'comms']],
    ['Leasing', ['portfolio', 'map', 'comms']],
    ['Maintenance', ['workorders', 'map']],
    ['Accounting', ['billing', 'utilreview', 'portfolio']],
    ['Onboarding', ['workorders', 'portfolio', 'map']],
    ['Starter', ['workorders', 'portfolio', 'map']],
  ];
  const roleFor = (tabs) => { const k = tabs.slice().sort().join(); const r = ROLES.find(([, t]) => t.slice().sort().join() === k); return r ? r[0] : 'Custom'; };
  const label = (k) => (k.startsWith('tab:') ? (TABS.find((t) => t[0] === k.slice(4)) || [k, k])[1] + ' tab' : (ALL.find((a) => a[0] === k) || [k, k])[1]);
  const when = (s) => (s ? d3.timeFormat('%b %-d, %Y %-I:%M %p')(new Date(s)) : 'Never');
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text == null ? '' : text; tr.appendChild(c); return c; };
  let sb = null, me = '';

  const msg = (t, bad) => { const m = $('acMsg'); m.textContent = t || ''; m.style.color = bad ? 'var(--color-bad)' : 'var(--color-ok)'; };

  const set = async (email, area, on, box) => {
    box.disabled = true;
    const r = await sb.rpc('access_set', { p_email: email, p_area: area, p_on: on });
    box.disabled = false;
    if (r.error) { box.checked = !on; msg(r.error.message, true); return; }
    msg((on ? 'Gave ' : 'Removed ') + label(area) + (on ? ' access to ' : ' access from ') + email + '.');
    history();
  };

  const render = (list) => {
    const tb = $('acRows'); tb.replaceChildren();
    list.forEach((p) => {
      const tr = document.createElement('tr');
      td(tr, p.email + (p.email === me ? ' (you)' : '')); td(tr, when(p.last_sign_in));
      // Role and tabs
      const lockTabs = !owner && p.owner;
      let tabs = (p.tabs || []).slice();
      const rc = td(tr, ''); const sel = document.createElement('select'); sel.className = 'dash-select'; sel.setAttribute('aria-label', 'Role for ' + p.email);
      [...ROLES.map((r) => r[0]), 'Custom'].forEach((n) => sel.appendChild(Object.assign(document.createElement('option'), { value: n, textContent: n })));
      sel.value = p.role && p.role === roleFor(tabs) ? p.role : roleFor(tabs); sel.disabled = lockTabs; rc.appendChild(sel);
      const boxes = {};
      const saveTabs = async (role) => {
        const r = await sb.rpc('access_set_tabs', { p_email: p.email, p_role: role, p_tabs: tabs });
        if (r.error) { msg(r.error.message, true); refresh(); return; }
        msg('Saved tabs for ' + p.email + ' (' + role + ').'); history();
      };
      sel.onchange = () => { if (sel.value === 'Custom') return; tabs = ROLES.find((r) => r[0] === sel.value)[1].slice(); TABS.forEach(([k]) => { boxes[k].checked = tabs.includes(k); }); saveTabs(sel.value); };
      TABS.forEach(([k, n]) => {
        const c = td(tr, ''); c.style.textAlign = 'center';
        const b = document.createElement('input'); b.type = 'checkbox'; b.checked = tabs.includes(k); b.disabled = lockTabs; b.setAttribute('aria-label', n + ' tab for ' + p.email);
        b.onchange = () => { tabs = b.checked ? [...tabs, k] : tabs.filter((x) => x !== k); sel.value = roleFor(tabs); saveTabs(sel.value); };
        boxes[k] = b; c.appendChild(b);
      });
      AREAS.forEach(([k]) => {
        const c = td(tr, ''); c.style.textAlign = 'center';
        const b = document.createElement('input'); b.type = 'checkbox'; b.checked = !!p[k];
        b.setAttribute('aria-label', k + ' for ' + p.email);
        if (p.email === me) { b.disabled = true; b.title = 'You can\'t remove your own access'; }
        else if (!owner && (p.owner || k === 'manager')) { b.disabled = true; b.title = 'Only Robert can change this'; }
        b.onchange = () => set(p.email, k, b.checked, b);
        c.appendChild(b);
      });
      tb.appendChild(tr);
    });
  };

  const history = async () => {
    const r = await sb.rpc('access_history');
    const tb = $('acLog'); tb.replaceChildren();
    if (r.error) return;
    (r.data || []).forEach((x) => {
      const tr = document.createElement('tr');
      td(tr, when(x.at)); td(tr, x.by_email); td(tr, (x.granted ? 'Gave ' : 'Removed ') + label(x.area)); td(tr, x.email);
      tb.appendChild(tr);
    });
    if (!(r.data || []).length) { const tr = document.createElement('tr'); const c = td(tr, 'No changes yet.'); c.colSpan = 4; tb.appendChild(tr); }
  };

  const refresh = async () => {
    const r = await sb.rpc('access_list');
    if (r.error) { msg('Could not load: ' + r.error.message, true); return; }
    render(r.data || []);
    history();
  };

  const load = async () => {
    sb = window.mpSupabase; if (!sb) return;
    const ok = await sb.rpc('can_manage_access');
    const ow = await sb.rpc('is_owner'); owner = !ow.error && ow.data === true;
    AREAS = owner ? ALL : ALL.filter((a) => a[0] !== 'exec');
    if (ok.error || ok.data !== true) return; // not the owner: the tab stays hidden
    const s = await sb.auth.getSession(); me = ((s.data.session || {}).user || {}).email || ''; me = me.toLowerCase();
    const tab = document.querySelector('[data-tab="access"]'); if (tab) tab.hidden = false;
    // Build the header and the add form from the areas this person may change.
    $('acHead').replaceChildren(...['Person', 'Last signed in', 'Role'].map((t) => Object.assign(document.createElement('th'), { textContent: t })), ...TABS.map(([, n]) => { const th = document.createElement('th'); th.style.textAlign = 'center'; th.append(n, document.createElement('br'), Object.assign(document.createElement('span'), { className: 'mp-meta', textContent: 'tab' })); return th; }), ...AREAS.map(([, n, d]) => { const th = document.createElement('th'); th.style.textAlign = 'center'; th.innerHTML = ''; th.append(n, document.createElement('br'), Object.assign(document.createElement('span'), { className: 'mp-meta', textContent: d })); return th; }));
    $('acArea').replaceChildren(...ROLES.map(([n, t]) => Object.assign(document.createElement('option'), { value: 'role:' + n, textContent: 'Role: ' + n + ' (' + t.map((k) => TABS.find((x) => x[0] === k)[1]).join(', ') + ')' })), ...AREAS.filter(([k]) => owner || k !== 'manager').map(([k, n, d]) => Object.assign(document.createElement('option'), { value: k, textContent: n + ': ' + d })));
    $('acWho').textContent = owner ? 'Only you and the people you mark "Manage access" can see this tab.' : 'Robert and the people he marks "Manage access" can see this tab. Only Robert can change Executive access or who manages access.';
    $('acAdd').onsubmit = async (e) => {
      e.preventDefault();
      const email = $('acEmail').value.trim().toLowerCase(), area = $('acArea').value;
      if (!email) return;
      const r = area.startsWith('role:') ? await sb.rpc('access_set_tabs', { p_email: email, p_role: area.slice(5), p_tabs: ROLES.find((x) => x[0] === area.slice(5))[1] }) : await sb.rpc('access_set', { p_email: email, p_area: area, p_on: true });
      if (r.error) { msg(r.error.message, true); return; }
      msg((area.startsWith('role:') ? 'Set ' + email + ' up as ' + area.slice(5) + '.' : 'Gave ' + label(area) + ' access to ' + email + '.') + ' They\'ll see it the next time they open the dashboard.');
      $('acEmail').value = '';
      refresh();
    };
    refresh();
  };
  window.mpAccess = { load };
})();
