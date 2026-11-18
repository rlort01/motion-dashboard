// Stand-in for the Claude artifact runtime: the same dash.calc / loader / draw / data /
// params API the page scripts were written against, reading datasets from Supabase.
(function () {
  const loaders = new Map(), calcs = new Map(), draws = new Map();
  const raw = new Map();      // id -> { status, data, error }
  let cache = new Map();      // computed results for loaders and calcs
  const PKEY = 'motion-dash-params';
  const DEFAULTS = { market: 'Combined', metric: 'r18', month: '2026-11', scMonth: 11, company: 'pmg' };

  const readParams = () => {
    let p = {};
    try { p = JSON.parse(localStorage.getItem(PKEY) || '{}'); } catch (e) { p = {}; }
    const q = new URLSearchParams(location.search);
    ['market', 'metric', 'month', 'scMonth', 'company'].forEach((k) => { if (q.has(k)) p[k] = q.get(k); });
    if (q.get('tv') !== null || location.pathname.endsWith('/tv') || location.pathname.endsWith('/tv/')) p.company = 'tv';
    return Object.assign({}, DEFAULTS, p);
  };
  let params = readParams();

  const toRows = (v) => (v && !Array.isArray(v) && Array.isArray(v.rows) ? v.rows : v);
  const get = (id, seen) => {
    if (cache.has(id)) return cache.get(id);
    let out;
    if (calcs.has(id)) {
      if (seen.has(id)) return { status: 'error', error: 'cycle' };
      seen.add(id);
      const c = calcs.get(id);
      const ins = c.inputs.map((i) => get(i, seen));
      const bad = ins.find((r) => r.status !== 'ok');
      if (bad) out = { status: bad.status === 'error' ? 'error' : 'loading', error: bad.error };
      else {
        try { out = { status: 'ok', data: toRows(c.fn(...ins.map((r) => r.data))) }; }
        catch (e) { console.error('calc ' + id, e); out = { status: 'error', error: String(e) }; }
      }
      seen.delete(id);
    } else {
      const r = raw.get(id);
      if (!r) out = { status: 'loading' };
      else if (r.status !== 'ok') out = r;
      else if (loaders.has(id)) {
        try { out = { status: 'ok', data: toRows(loaders.get(id).fn({ answer: r.data })) }; }
        catch (e) { console.error('loader ' + id, e); out = { status: 'error', error: String(e) }; }
      } else out = { status: 'ok', data: r.data };
    }
    cache.set(id, out);
    return out;
  };

  const runDraw = (name) => {
    const fn = draws.get(name);
    if (!fn) return;
    document.querySelectorAll('[data-draw="' + name + '"]').forEach((el) => {
      try { fn(el); } catch (e) { console.error('draw ' + name, e); }
    });
  };
  let scheduled = false;
  const redrawAll = () => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => { scheduled = false; cache = new Map(); draws.forEach((_, n) => runDraw(n)); fitNumbers(); });
  };
  // Shrink a tile's big number until it fits its tile (long values, narrow screens).
  const fitNumbers = () => {
    document.querySelectorAll('.mp-big, .tv-big').forEach((el) => {
      if (!el.offsetParent) return;
      el.style.fontSize = '';
      let fs = parseFloat(getComputedStyle(el).fontSize), n = 0;
      while (el.scrollWidth > el.clientWidth + 1 && fs > 12 && n++ < 40) { fs -= 1; el.style.fontSize = fs + 'px'; }
    });
  };
  window.mpFitNumbers = fitNumbers;
  ['click', 'change'].forEach((t) => document.addEventListener(t, () => setTimeout(fitNumbers, 60), true));

  window.dash = {
    colors: ['#f0cd86', '#8fb8e8', '#8fd3a8', '#e2ae54', '#c9a0dc', '#f2968c'],
    calc: (name, def) => { calcs.set(name, { inputs: def.inputs || [], fn: def.fn }); },
    loader: (name, def) => { loaders.set(name, def); },
    draw: (name, fn) => { if (fn) { if (!draws.has(name)) draws.set(name, fn); } else { runDraw(name); setTimeout(fitNumbers, 0); } }, // first registration wins, as in the artifact page
    data: (id) => get(id, new Set()),
    params: () => params,
    setParams: (p) => {
      params = Object.assign({}, params, p);
      try { localStorage.setItem(PKEY, JSON.stringify(params)); } catch (e) { /* private mode */ }
      redrawAll();
    },
    setLink: (id) => { if (history.replaceState) history.replaceState(null, '', '#' + id); },
    _setDataset: (id, status, data, error) => { raw.set(id, { status, data, error }); },
    _redraw: redrawAll,
    _ids: () => Array.from(raw.keys())
  };
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(redrawAll, 200); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fitNumbers());
})();
