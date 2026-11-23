// Access tab: the owner (public.app_owner) adds and removes who can edit numbers and goals (Admin), see the Executive
// tab, and see the Commercial and HOA tabs. Every change goes through database functions that check the owner and
// record who changed what in public.access_log; the database lists themselves stay locked to everyone else.
(function () {
  const $ = (id) => document.getElementById(id);
  const AREAS = [['admin', 'Admin', 'Edit goals and enter numbers'], ['exec', 'Executive', 'Company cash, projection and P&L'], ['commercial', 'Commercial & HOA', 'Commercial tenants and HOA dues']];
  const when = (s) => (s ? d3.timeFormat('%b %-d, %Y %-I:%M %p')(new Date(s)) : 'Never');
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text == null ? '' : text; tr.appendChild(c); return c; };
  let sb = null, me = '';

  const msg = (t, bad) => { const m = $('acMsg'); m.textContent = t || ''; m.style.color = bad ? 'var(--color-bad)' : 'var(--color-ok)'; };

  const set = async (email, area, on, box) => {
    box.disabled = true;
    const r = await sb.rpc('access_set', { p_email: email, p_area: area, p_on: on });
    box.disabled = false;
    if (r.error) { box.checked = !on; msg(r.error.message, true); return; }
    msg((on ? 'Gave ' : 'Removed ') + AREAS.find((a) => a[0] === area)[1] + (on ? ' access to ' : ' access from ') + email + '.');
    history();
  };

  const render = (list) => {
    const tb = $('acRows'); tb.replaceChildren();
    list.forEach((p) => {
      const tr = document.createElement('tr');
      td(tr, p.email + (p.email === me ? ' (you)' : '')); td(tr, when(p.last_sign_in));
      AREAS.forEach(([k]) => {
        const c = td(tr, ''); c.style.textAlign = 'center';
        const b = document.createElement('input'); b.type = 'checkbox'; b.checked = !!p[k];
        b.setAttribute('aria-label', k + ' for ' + p.email);
        if (p.email === me) { b.disabled = true; b.title = 'You can\'t remove your own access'; }
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
      td(tr, when(x.at)); td(tr, x.by_email); td(tr, (x.granted ? 'Gave ' : 'Removed ') + AREAS.find((a) => a[0] === x.area)[1]); td(tr, x.email);
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
    const ok = await sb.rpc('is_owner');
    if (ok.error || ok.data !== true) return; // not the owner: the tab stays hidden
    const s = await sb.auth.getSession(); me = ((s.data.session || {}).user || {}).email || ''; me = me.toLowerCase();
    const tab = document.querySelector('[data-tab="access"]'); if (tab) tab.hidden = false;
    $('acAdd').onsubmit = async (e) => {
      e.preventDefault();
      const email = $('acEmail').value.trim().toLowerCase(), area = $('acArea').value;
      if (!email) return;
      const r = await sb.rpc('access_set', { p_email: email, p_area: area, p_on: true });
      if (r.error) { msg(r.error.message, true); return; }
      msg('Gave ' + AREAS.find((a) => a[0] === area)[1] + ' access to ' + email + '. They\'ll see it the next time they open the dashboard.');
      $('acEmail').value = '';
      refresh();
    };
    refresh();
  };
  window.mpAccess = { load };
})();
