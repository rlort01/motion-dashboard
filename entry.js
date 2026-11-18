// "Enter numbers" tab: the team types the scorecard metrics the systems can't fill, straight into the app.
// Saved to Supabase (scorecard_entries); each save records who and when, and every change is logged.
(function () {
  const MARKETS = ['Georgia', 'Tennessee', 'North Carolina'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const YEAR = 2026;
  const $ = (id) => document.getElementById(id);
  const state = { market: 'Georgia', month: Math.min(12, new Date().getMonth() + 1), entries: [] };

  // Percentages are typed as 12.5 and stored as 0.125.
  const toStored = (unit, txt) => {
    const t = String(txt).trim().replace(/[$,%\s]/g, '');
    if (t === '' || t === '-') return null;
    const v = Number(t);
    if (!isFinite(v)) return undefined;
    return unit === 'Percentage' ? Math.round(v * 100) / 10000 : v;
  };
  const toShown = (unit, v) => (v === null || v === undefined || v === '' ? '' : unit === 'Percentage' ? String(Math.round(+v * 100000) / 1000) : String(+v));
  const suffix = (u) => ({ Percentage: '%', 'Dollar Amount': '$', Hours: 'hrs', Days: 'days', Time: 'days' }[u] || '');

  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text == null ? '' : text; tr.appendChild(c); return c; };

  const render = () => {
    const tb = $('entryRows'); if (!tb) return;
    const sc = dash.data('sc2026'), sys = dash.data('sys2026');
    tb.replaceChildren();
    if (sc.status !== 'ok') { const tr = document.createElement('tr'); td(tr, 'Loading…'); tb.appendChild(tr); return; }
    const meta = new Map(); (sc.data || []).forEach((r) => { if (!meta.has(r.ID)) meta.set(r.ID, r); });
    const auto = new Map((sys.status === 'ok' ? sys.data : []).filter((r) => r.VALUE !== '' && r.VALUE !== null && +r.MONTH === state.month && (r.MARKET === state.market || r.MARKET === 'Combined')).map((r) => [r.ID, r]));
    const wb = new Map((window.mpWorkbook || []).filter((r) => r.MARKET === state.market && +r.MONTH === state.month && r.VALUE !== '' && r.VALUE !== null).map((r) => [r.ID, r.VALUE]));
    const ent = new Map(state.entries.filter((e) => e.market === state.market && e.month === state.month).map((e) => [e.metric_id, e]));
    let section = '';
    meta.forEach((m, id) => {
      if (id === 'eom_units') return;
      if (m.SECTION !== section) {
        section = m.SECTION;
        const tr = document.createElement('tr'); tr.className = 'mp-entry-sec'; const c = td(tr, section === 'Portfolio' ? 'Door counts' : section); c.colSpan = 4; tb.appendChild(tr);
      }
      const tr = document.createElement('tr'); tr.setAttribute('data-key', id);
      td(tr, m.METRIC);
      const goal = m.GOAL === '' || m.GOAL == null ? (m.GOAL_TEXT || '') : (m.UNIT === 'Percentage' ? Math.round(+m.GOAL * 1000) / 10 + '%' : m.GOAL);
      td(tr, goal);
      const cell = td(tr, '');
      const a = auto.get(id);
      if (a) {
        cell.textContent = (m.UNIT === 'Percentage' ? Math.round(+a.VALUE * 1000) / 10 + '%' : (+a.VALUE).toLocaleString()) + '  (from ' + (a.SOURCE || 'AppFolio') + ', automatic)';
        cell.className = 'mp-entry-auto';
        td(tr, '');
      } else {
        const e = ent.get(id);
        const inp = document.createElement('input');
        inp.className = 'mp-entry-input'; inp.inputMode = 'decimal'; inp.setAttribute('aria-label', m.METRIC + ', ' + state.market + ', ' + MONTHS_LONG[state.month - 1]);
        inp.dataset.id = id; inp.dataset.unit = m.UNIT;
        inp.value = toShown(m.UNIT, e ? e.value : wb.has(id) ? wb.get(id) : '');
        inp.dataset.orig = inp.value;
        inp.addEventListener('input', () => { inp.classList.toggle('mp-entry-changed', inp.value !== inp.dataset.orig); });
        cell.appendChild(inp);
        const s = document.createElement('span'); s.className = 'mp-entry-unit'; s.textContent = suffix(m.UNIT); cell.appendChild(s);
        td(tr, e ? 'Entered by ' + (e.entered_by || '').split('@')[0] + ', ' + new Date(e.entered_at).toLocaleDateString() : wb.has(id) ? 'From the workbook' : '', 'mp-meta');
      }
      tb.appendChild(tr);
    });
  };

  const loadEntries = async () => {
    if (!window.mpSupabase) return;
    const { data, error } = await window.mpSupabase.from('scorecard_entries').select('*').eq('year', YEAR);
    if (error) { $('entryMsg').textContent = 'Could not load saved entries: ' + error.message; return; }
    state.entries = data || [];
    render();
  };

  const save = async () => {
    const msg = $('entryMsg');
    const rows = [];
    for (const inp of document.querySelectorAll('.mp-entry-input')) {
      if (inp.value === inp.dataset.orig) continue;
      const v = toStored(inp.dataset.unit, inp.value);
      if (v === undefined) { msg.textContent = 'That isn\'t a number: "' + inp.value + '". Fix it and save again.'; inp.focus(); return; }
      rows.push({ metric_id: inp.dataset.id, market: state.market, year: YEAR, month: state.month, value: v });
    }
    if (!rows.length) { msg.textContent = 'Nothing has changed.'; return; }
    msg.textContent = 'Saving…';
    const { error } = await window.mpSupabase.from('scorecard_entries').upsert(rows, { onConflict: 'metric_id,market,year,month' });
    if (error) { msg.textContent = 'Not saved: ' + error.message; return; }
    msg.textContent = 'Saved ' + rows.length + (rows.length === 1 ? ' number' : ' numbers') + ' for ' + state.market + ', ' + MONTHS_LONG[state.month - 1] + '. The scorecard is updated.';
    await loadEntries();
    if (window.mpReloadData) window.mpReloadData();
  };

  const init = () => {
    const ms = $('entryMarket'), mo = $('entryMonth');
    if (!ms || !mo) return;
    ms.replaceChildren(...MARKETS.map((m) => new Option(m, m)));
    mo.replaceChildren(...MONTHS_LONG.map((m, i) => new Option(m + ' ' + YEAR, String(i + 1))).reverse());
    ms.value = state.market; mo.value = String(state.month);
    ms.addEventListener('change', () => { state.market = ms.value; render(); });
    mo.addEventListener('change', () => { state.month = +mo.value; render(); });
    $('entrySave').addEventListener('click', save);
  };
  init();
  window.mpEntry = { load: loadEntries, render, entries: () => state.entries };
  dash.draw('entryTable', () => render());
})();
