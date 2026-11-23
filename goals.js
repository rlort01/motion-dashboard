// Goals tab: scorecard goals by year. Admins (public.app_admins) can change them; everyone else sees them read-only.
// Saved to Supabase (scorecard_goals); a database trigger stamps who/when and logs every change.
(function () {
  const $ = (id) => document.getElementById(id);
  const DIRS = [['H', 'Higher is better'], ['L', 'Lower is better'], ['B', 'Target range (±5 pts)'], ['N', 'No goal (track only)']];
  const UNIT = { Percentage: '%', 'Dollar Amount': '$', Hours: 'hours', Days: 'days', Time: 'days', Count: 'count', Ratio: 'ratio', Rank: 'rank' };
  const toShown = (u, v) => (v === null || v === undefined || v === '' ? '' : u === 'Percentage' ? String(Math.round(+v * 100000) / 1000) : String(+v));
  const toStored = (u, t) => { t = String(t).trim().replace(/[$,%\s]/g, ''); if (t === '') return null; const v = Number(t); if (!isFinite(v)) return undefined; return u === 'Percentage' ? Math.round(v * 100000) / 10000000 : v; };
  const td = (tr, x) => { const c = document.createElement('td'); if (x instanceof Node) c.appendChild(x); else c.textContent = x == null ? '' : x; tr.appendChild(c); return c; };

  const year = () => +($('goalsYear') || {}).value || 2026;
  const metas = () => {
    const sc = window.mpWorkbook || []; const m = new Map();
    sc.forEach((r) => { if (!m.has(r.ID) && r.ID !== 'eom_units') m.set(r.ID, r); });
    return m;
  };
  // The goal to show for a metric and year: saved goal, else (2026) the workbook goal.
  const current = (id, y, meta) => {
    const g = (window.mpGoals || []).find((x) => x.year === y && x.metric_id === id);
    if (g) return { goal: g.goal, text: g.goal_text || '', dir: g.dir, by: g.updated_by, at: g.updated_at };
    if (y === 2026 && meta) return { goal: meta.GOAL === '' || meta.GOAL == null ? null : +meta.GOAL, text: meta.GOAL_TEXT || '', dir: meta.DIR || 'N', by: null, at: null, workbook: true };
    return null;
  };

  const render = () => {
    const tb = $('goalsRows'); if (!tb) return;
    const admin = window.mpIsAdmin === true, y = year(), mm = metas();
    $('goalsSave').hidden = !admin; $('goalsCopy').hidden = !admin || y === 2026;
    $('goalsNote').textContent = admin
      ? 'You are an admin: change any goal below and press Save. Percentages are typed as 12.5 for 12.5%. Every change is saved with who made it and when.'
      : 'Scorecard goals by year. Only admins can change goals; ask Robert if one needs updating.';
    tb.replaceChildren();
    if (!mm.size) { const tr = document.createElement('tr'); td(tr, 'Loading…'); tb.appendChild(tr); return; }
    let sec = '';
    mm.forEach((m, id) => {
      if (m.SECTION !== sec) { sec = m.SECTION; const tr = document.createElement('tr'); tr.className = 'mp-entry-sec'; td(tr, sec === 'Portfolio' ? 'Door counts' : sec).colSpan = 6; tb.appendChild(tr); }
      const c = current(id, y, m), prev = current(id, y - 1, mm.get(id));
      const tr = document.createElement('tr'); tr.dataset.id = id; tr.dataset.unit = m.UNIT;
      td(tr, m.METRIC); td(tr, UNIT[m.UNIT] || m.UNIT || '');
      const dir = document.createElement('select'); dir.className = 'dash-select'; DIRS.forEach(([v, l]) => dir.add(new Option(l, v)));
      dir.value = c ? c.dir : prev ? prev.dir : 'N'; dir.disabled = !admin; dir.dataset.orig = c ? dir.value : '';
      td(tr, dir);
      const g = document.createElement('input'); g.className = 'mp-entry-input'; g.inputMode = 'decimal'; g.disabled = !admin;
      g.value = c ? toShown(m.UNIT, c.goal) : ''; g.dataset.orig = g.value;
      if (!c && prev && prev.goal !== null) g.placeholder = toShown(m.UNIT, prev.goal) + ' (' + (y - 1) + ')';
      g.setAttribute('aria-label', 'Goal for ' + m.METRIC + ' in ' + y);
      const gc = td(tr, g); const u = document.createElement('span'); u.className = 'mp-entry-unit'; u.textContent = m.UNIT === 'Percentage' ? '%' : m.UNIT === 'Dollar Amount' ? '$' : ''; gc.appendChild(u);
      const t = document.createElement('input'); t.className = 'mp-entry-input'; t.style.width = '9em'; t.disabled = !admin; t.placeholder = 'e.g. Top 10';
      t.value = c ? c.text : ''; t.dataset.orig = t.value; td(tr, t);
      td(tr, c && c.by ? c.by.split('@')[0] + ', ' + new Date(c.at).toLocaleDateString() : c && c.workbook ? 'From the workbook' : 'Not set');
      [dir, g, t].forEach((el) => el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => tr.classList.add('mp-goal-changed')));
      tb.appendChild(tr);
    });
  };

  const save = async () => {
    const y = year(), rows = Array.from(document.querySelectorAll('#goalsRows tr.mp-goal-changed')), msg = $('goalsMsg');
    if (!rows.length) { msg.textContent = 'Nothing changed.'; return; }
    const out = [];
    for (const tr of rows) {
      const [dir, g, t] = tr.querySelectorAll('select, input');
      const v = toStored(tr.dataset.unit, g.value);
      if (v === undefined) { msg.textContent = 'Check the goal for ' + tr.firstChild.textContent + ': it must be a number.'; g.focus(); return; }
      out.push({ year: y, metric_id: tr.dataset.id, goal: v, goal_text: t.value.trim() || null, dir: dir.value });
    }
    msg.textContent = 'Saving…';
    const { error } = await window.mpSupabase.from('scorecard_goals').upsert(out, { onConflict: 'year,metric_id' });
    if (error) { msg.textContent = 'Could not save: ' + error.message; return; }
    msg.textContent = 'Saved ' + out.length + ' goal' + (out.length === 1 ? '' : 's') + '. Updating the scorecard…';
    if (window.mpReloadData) await window.mpReloadData();
    msg.textContent = 'Saved ' + out.length + ' goal' + (out.length === 1 ? '' : 's') + '.';
  };

  const copyPrev = () => {
    document.querySelectorAll('#goalsRows tr[data-id]').forEach((tr) => {
      const [, g] = tr.querySelectorAll('select, input');
      if (g.value === '' && g.placeholder) { g.value = g.placeholder.replace(/\s*\(\d{4}\)$/, ''); tr.classList.add('mp-goal-changed'); }
    });
    $('goalsMsg').textContent = 'Filled from the year before. Review, then press Save.';
  };

  window.mpGoalsPage = { render };
  document.addEventListener('DOMContentLoaded', () => {
    if ($('goalsYear')) $('goalsYear').addEventListener('change', render);
    if ($('goalsSave')) $('goalsSave').addEventListener('click', save);
    if ($('goalsCopy')) $('goalsCopy').addEventListener('click', copyPrev);
  });
  if (document.readyState !== 'loading') setTimeout(() => {
    $('goalsYear').addEventListener('change', render); $('goalsSave').addEventListener('click', save); $('goalsCopy').addEventListener('click', copyPrev);
  }, 0);
})();
