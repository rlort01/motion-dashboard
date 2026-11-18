// Sign-in (email link restricted to Motion domains) and dataset loading from Supabase.
(function () {
  const SUPABASE_URL = 'https://duzghrvvnkfxerkwyokm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_64xUNodPw5lzPKKzQe7_Ag_GukiIoBE';
  const DOMAINS = ['motionpmg.com', 'motionpropertypreservation.com', 'motionrealty.com'];
  const okEmail = (e) => DOMAINS.some((d) => String(e || '').toLowerCase().trim().endsWith('@' + d));

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  window.mpSupabase = sb;
  const $ = (id) => document.getElementById(id);
  const app = $('app'), login = $('login'), msg = $('loginMsg');
  let updated = null;

  dash.draw('lastUpdated', (el) => {
    el.textContent = updated ? 'Data last loaded into the app: ' + d3.timeFormat('%a %b %-d, %-I:%M %p')(updated) + '.' : '';
  });

  const load = async () => {
    const { data, error } = await sb.from('datasets').select('id,kind,rows,updated_at');
    if (error) { showLogin('Could not load data: ' + error.message); return; }
    if (!data.length) { showLogin('Signed in, but no data is shared with this account. Use your @motionpmg.com, @motionpropertypreservation.com or @motionrealty.com email.'); return; }
    // Numbers typed on the "Enter numbers" tab take precedence over the workbook copy.
    const ent = await sb.from('scorecard_entries').select('metric_id,market,month,value').eq('year', 2026);
    data.forEach((d) => {
      if (d.id === 'sc2026') {
        window.mpWorkbook = d.rows;
        if (!ent.error && ent.data && ent.data.length) {
          const rows = d.rows.map((r) => Object.assign({}, r));
          const at = new Map(rows.map((r, i) => [r.ID + '|' + r.MARKET + '|' + (+r.MONTH), i]));
          const meta = new Map(); rows.forEach((r) => { if (!meta.has(r.ID)) meta.set(r.ID, r); });
          ent.data.forEach((e) => {
            const k = e.metric_id + '|' + e.market + '|' + e.month, v = e.value === null ? '' : String(e.value);
            if (at.has(k)) rows[at.get(k)].VALUE = v;
            else if (meta.has(e.metric_id)) rows.push(Object.assign({}, meta.get(e.metric_id), { MARKET: e.market, MONTH: String(e.month), VALUE: v }));
          });
          return dash._setDataset(d.id, 'ok', rows);
        }
      }
      dash._setDataset(d.id, 'ok', d.rows);
    });
    if (window.mpEntry) window.mpEntry.load();
    if (!window.mpDiagSent) { window.mpDiagSent = true; setTimeout(sendDiag, 4000); }
    updated = new Date(d3.max(data, (d) => new Date(d.updated_at)));
    dash._redraw();
  };

  window.mpReloadData = () => load();
  // One small health report per visit, so display problems on other computers can be diagnosed.
  const sendDiag = async () => {
    try {
      const q = (s) => Array.from(document.querySelectorAll(s));
      const st = (id) => dash.data(id).status;
      const detail = {
        ua: navigator.userAgent, w: innerWidth, h: innerHeight, dpr: devicePixelRatio, zoom: Math.round(outerWidth / innerWidth * 100) / 100,
        params: dash.params(), datasets: dash._ids().length, sc2026: st('sc2026'), scTable: st('scTable'), scMarket: st('scMarket'),
        scRows: (dash.data('scTable').data || []).length,
        sections: q('tbody[data-draw=scSection]').map((t) => t.children.length),
        sectionBoxes: q('tbody[data-draw=scSection]').map((t) => Math.round(t.getBoundingClientRect().height)),
        tableOverflow: q('#scorecard .mp-wrap').map((w) => w.scrollWidth - w.clientWidth),
        tiles: q('#scorecard .mp-big').map((e) => e.textContent.slice(0, 20)),
        tileOverflow: q('.mp-big').filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 1).length,
        scorecardHidden: document.getElementById('scorecard').hidden, version: (document.querySelector('script[src^="dash.js"]') || {}).src,
        errors: (window.mpErrors || []).slice(0, 15)
      };
      await sb.from('client_diagnostics').insert({ kind: 'load', detail });
    } catch (e) { /* diagnostics must never break the page */ }
  };
  const showApp = () => { login.hidden = true; app.hidden = false; load(); };
  const showLogin = (text) => { app.hidden = true; login.hidden = false; msg.textContent = text || ''; };

  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('email').value.trim().toLowerCase();
    if (!okEmail(email)) { msg.textContent = 'Use your Motion email (@motionpmg.com, @motionpropertypreservation.com or @motionrealty.com).'; return; }
    msg.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
    msg.textContent = error ? 'Could not send the email: ' + error.message : 'Check ' + email + ' for a sign-in link (and the 6-digit code, if shown). It can take a minute.';
    if (!error) $('codeRow').hidden = false;
  });
  $('codeForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.verifyOtp({ email: $('email').value.trim().toLowerCase(), token: $('code').value.trim(), type: 'email' });
    if (error) msg.textContent = 'That code did not work: ' + error.message;
  });
  $('signOut').addEventListener('click', async () => { await sb.auth.signOut(); showLogin('Signed out.'); });

  let shown = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (session && okEmail(session.user.email)) { if (!shown) { shown = true; showApp(); } }
    else if (session) { sb.auth.signOut(); showLogin('Only Motion email addresses can open this dashboard.'); }
    else { shown = false; showLogin(msg.textContent); }
  });
  // Pick up fresh data every 15 minutes without a reload.
  setInterval(() => { if (shown) load(); }, 15 * 60 * 1000);
})();
