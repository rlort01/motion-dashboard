// Commercial tab: commercial tenants, who paid this month, open work orders, vacancies, lease dates and owner funds.
// Only people listed in public.commercial_viewers can see it: the tab stays hidden for everyone else, and the data
// (public.commercial_data) is locked in the database so other signed-in staff get nothing even if they look for it.
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (v) => (v == null || v === '' || !isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + d3.format(',.2f')(Math.abs(v)));
  const day = (s) => (s ? d3.timeFormat('%b %-d, %Y')(new Date(String(s).slice(0, 10) + 'T12:00:00')) : '—');
  const daysTo = (s) => (s ? Math.round((new Date(String(s).slice(0, 10) + 'T12:00:00') - new Date()) / 86400000) : null);
  const state = { data: null, at: null };
  const rows = (id) => (state.data && state.data[id]) || [];
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text == null ? '' : text; tr.appendChild(c); return c; };
  const pill = (cell, text, ok) => { const p = document.createElement('span'); p.className = 'mp-pill ' + (ok === true ? 'mp-ok' : ok === false ? 'mp-bad' : ''); p.textContent = text; cell.appendChild(p); };
  const empty = (tb, n, text) => { const tr = document.createElement('tr'); const c = td(tr, text); c.colSpan = n; tb.appendChild(tr); };

  const load = async () => {
    const sb = window.mpSupabase; if (!sb) return;
    const ok = await sb.rpc('is_commercial');
    if (ok.error || ok.data !== true) return; // not allowed: leave the tab hidden
    const tab = document.querySelector('[data-tab="commercial"]'); if (tab) tab.hidden = false;
    const r = await sb.from('commercial_data').select('id,rows,updated_at');
    if (r.error) { $('coNote').textContent = 'Could not load: ' + r.error.message; return; }
    state.data = Object.fromEntries(r.data.map((x) => [x.id, x.rows]));
    state.at = d3.max(r.data, (x) => new Date(x.updated_at));
    render();
  };

  const render = () => {
    const t = rows('tenants'), v = rows('vacant'), w = rows('work_orders'), f = rows('owner_funds'), pl = rows('pl');
    $('coNote').textContent = state.at ? 'From AppFolio, updated ' + d3.timeFormat('%a %b %-d, %-I:%M %p')(state.at) + '.' : '';
    const charged = t.filter((r) => r.PAID === 'Paid' || r.PAID === 'Unpaid');
    const unpaid = t.filter((r) => r.PAID === 'Unpaid' || +r.BAL > 0);
    $('coPaid').textContent = charged.filter((r) => r.PAID === 'Paid').length + ' of ' + charged.length;
    $('coPaidN').textContent = 'tenants paid this month\'s rent · ' + (t.length - charged.length) + ' with no rent charge posted';
    $('coOwed').textContent = money(d3.sum(t, (r) => +r.BAL || 0));
    $('coOwedN').textContent = unpaid.length ? unpaid.length + ' tenant(s) owe · ' + money(d3.sum(t, (r) => (+r.A30 || 0) + (+r.A60 || 0) + (+r.A90 || 0))) + ' over 30 days' : 'Nobody owes anything';
    const rentable = v.length + t.length;
    const open = v.filter((r) => /unrented/i.test(r.STATUS));
    $('coVac').textContent = open.length + ' suite' + (open.length === 1 ? '' : 's');
    $('coVacN').textContent = 'vacant and not leased · ' + money(d3.sum(open, (r) => +r.MARKET_RENT || 0)) + '/month at market rent';
    const soon = t.filter((r) => { const d = daysTo(r.END); return d !== null && d <= 180; });
    $('coExp').textContent = String(soon.length);
    $('coExpN').textContent = 'leases ending in the next 6 months (or already ended)';
    $('coWo').textContent = String(w.length);
    $('coWoN').textContent = w.filter((r) => /work done/i.test(r.STATUS)).length + ' marked Work Done but not closed';
    const last = pl[pl.length - 1];
    $('coNet').textContent = last ? money(last.INCOME - last.EXPENSES) : '—';
    $('coNetN').textContent = last ? 'net in ' + d3.timeFormat('%B')(new Date(last.MONTH + '-15T12:00:00')) + ' (cash basis) · ' + money(d3.sum(pl, (m) => m.INCOME - m.EXPENSES)) + ' since management started' : '';

    // Tenants: who paid, balances, lease dates.
    const tb = $('coTenants'); tb.replaceChildren();
    t.slice().sort((a, b) => (+b.BAL || 0) - (+a.BAL || 0) || String(a.SUITE).localeCompare(String(b.SUITE))).forEach((r) => {
      const tr = document.createElement('tr');
      if (r.PAID === 'Unpaid' || +r.BAL > 0) tr.className = 'mp-attn';
      td(tr, r.TENANT); td(tr, r.SUITE); td(tr, r.RENT ? money(r.RENT) : '—', 'mp-num');
      pill(td(tr, ''), r.PAID === 'Paid' ? 'Paid' : r.PAID === 'Unpaid' ? 'Not paid' : 'No charge posted', r.PAID === 'Paid' ? true : r.PAID === 'Unpaid' ? false : null);
      td(tr, +r.BAL ? money(r.BAL) : '', 'mp-num');
      td(tr, r.LAST_PAY ? day(r.LAST_PAY) + (r.LAST_AMT != null ? ' · ' + money(r.LAST_AMT) : '') : '—');
      const d = daysTo(r.END);
      const c = td(tr, r.END ? day(r.END) : 'Month to month');
      if (d !== null && d < 0) c.appendChild(Object.assign(document.createElement('span'), { className: 'mp-pill mp-bad', textContent: ' Ended', style: 'margin-left:6px' }));
      else if (d !== null && d <= 180) c.appendChild(Object.assign(document.createElement('span'), { className: 'mp-pill mp-bad', textContent: ' ' + d + ' days', style: 'margin-left:6px' }));
      td(tr, +r.DEPOSIT ? money(r.DEPOSIT) : 'None', 'mp-num');
      tb.appendChild(tr);
    });
    if (!t.length) empty(tb, 8, 'No commercial tenants.');

    const wb = $('coWos'); wb.replaceChildren();
    w.forEach((r) => {
      const tr = document.createElement('tr');
      const c = td(tr, ''); const a = document.createElement('a'); a.href = 'https://motionpropmgmtgrp.appfolio.com' + r.LINK; a.target = '_blank'; a.rel = 'noopener'; a.textContent = '#' + r.WO; c.appendChild(a);
      td(tr, r.SUITE); td(tr, r.DESC); td(tr, r.PRIORITY); td(tr, r.STATUS); td(tr, day(r.CREATED)); td(tr, r.VENDOR || '—');
      wb.appendChild(tr);
    });
    if (!w.length) empty(wb, 7, 'No open work orders.');

    const vb = $('coVacant'); vb.replaceChildren();
    v.forEach((r) => {
      const tr = document.createElement('tr');
      td(tr, r.SUITE); td(tr, /unrented/i.test(r.STATUS) ? 'Vacant' : 'Leased, not moved in'); td(tr, r.SQFT ? d3.format(',')(r.SQFT) : '—', 'mp-num');
      td(tr, r.MARKET_RENT ? money(r.MARKET_RENT) : 'Not set', 'mp-num'); td(tr, r.DAYS != null ? r.DAYS : '—', 'mp-num');
      vb.appendChild(tr);
    });
    if (!v.length) empty(vb, 5, 'No vacant suites.');

    const ob = $('coFunds'); ob.replaceChildren();
    f.forEach((r) => {
      const tr = document.createElement('tr');
      if (+r.AVAILABLE < +r.RESERVE) tr.className = 'mp-attn';
      td(tr, r.PROPERTY); td(tr, r.OWNER); td(tr, money(r.CASH), 'mp-num'); td(tr, money(r.AVAILABLE), 'mp-num'); td(tr, money(r.RESERVE), 'mp-num');
      ob.appendChild(tr);
    });
    const pb = $('coPl'); pb.replaceChildren();
    pl.forEach((m) => { const tr = document.createElement('tr'); td(tr, d3.timeFormat('%b %Y')(new Date(m.MONTH + '-15T12:00:00'))); td(tr, money(m.INCOME), 'mp-num'); td(tr, money(m.EXPENSES), 'mp-num'); td(tr, money(m.INCOME - m.EXPENSES), 'mp-num'); pb.appendChild(tr); });
  };

  window.mpCommercial = { load };
})();
