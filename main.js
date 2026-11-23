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
    const t0 = performance.now();
    let { data, error } = await sb.from('datasets').select('id,kind,rows,updated_at');
    // A refresh can race the sign-in token renewal; if nothing came back, wait a moment and try once more.
    if (!error && (!data || data.length < 5)) { await new Promise((ok) => setTimeout(ok, 1500)); await sb.auth.getSession(); ({ data, error } = await sb.from('datasets').select('id,kind,rows,updated_at')); }
    window.mpLoadMs = Math.round(performance.now() - t0);
    if (error) { showLogin('Could not load data: ' + error.message); return; }
    if (!data.length) { showLogin('Signed in, but no data is shared with this account. Use your @motionpmg.com, @motionpropertypreservation.com or @motionrealty.com email.'); return; }
    // Numbers typed on the "Enter numbers" tab take precedence over the workbook copy.
    const ent = await sb.from('scorecard_entries').select('metric_id,market,month,value').eq('year', 2026);
    // Goals set on the Goals tab (admins only) override the workbook goals.
    const gl = await sb.from('scorecard_goals').select('year,metric_id,goal,goal_text,dir,updated_by,updated_at');
    window.mpGoals = gl.error ? [] : (gl.data || []);
    if (window.mpIsAdmin === undefined) { const ad = await sb.rpc('is_app_admin'); window.mpIsAdmin = !ad.error && ad.data === true; }
    // Leads to showings refreshes daily from Tenant Turner (tt_funnel), ahead of the Monday copy in sys2026.
    const tt = data.find((d) => d.id === 'tt_funnel'), sys = data.find((d) => d.id === 'sys2026');
    if (tt && sys && tt.rows && sys.rows) {
      const rows = sys.rows.map((r) => Object.assign({}, r));
      const at = new Map(rows.map((r, i) => [r.ID + '|' + r.MARKET + '|' + (+r.MONTH), i]));
      const put = (id, market, mo, val, note, src) => {
        const k = id + '|' + market + '|' + mo, v = String(Math.round(val * 10000) / 10000);
        if (at.has(k)) Object.assign(rows[at.get(k)], { VALUE: v, NOTE: note, SOURCE: src });
        else { at.set(k, rows.length); rows.push({ ID: id, MARKET: market, MONTH: String(mo), VALUE: v, NOTE: note, SOURCE: src }); }
      };
      const ST = { GA: 'Georgia', TN: 'Tennessee', NC: 'North Carolina' }, apps = new Map();
      const af = data.find((d) => d.id === 'af_funnel');
      if (af && af.rows) af.rows.forEach((r) => { const k = ST[String(r.GROUP).slice(0, 2)] + '|' + r.MONTH; apps.set(k, (apps.get(k) || 0) + (+r.APPS || 0)); });
      tt.rows.forEach((t) => {
        const mo = +String(t.MONTH).slice(5, 7), yr = String(t.MONTH).slice(0, 4), leads = +t.LEADS, done = +t.SHOWINGS_DONE;
        if (yr !== '2026') return;
        if (leads) put('r24', t.MARKET, mo, done / leads, 'Tenant Turner showings that happened / new leads', 'Tenant Turner');
        const a = apps.get(t.MARKET + '|' + t.MONTH);
        if (t.RESP_MED_H !== null && t.RESP_MED_H !== undefined && +t.RESP_N) put('r15', t.MARKET, mo, +t.RESP_MED_H, 'Tenant Turner: typical hours from a lead arriving to a showing booked, ' + t.RESP_N + ' lead(s)', 'Tenant Turner');
        if (done && a !== undefined) put('r25', t.MARKET, mo, a / done, 'AppFolio applications / Tenant Turner showings that happened', 'AppFolio + Tenant Turner');
      });
      sys.rows = rows;
    }
    // More scorecard metrics filled automatically from the daily AppFolio, Outlook and AppFolio-message data
    // (they show as "automatic" on the Enter numbers tab). Months up to the current one in 2026.
    if (sys && sys.rows) {
      const rows = sys.rows.map((r) => Object.assign({}, r));
      const at = new Map(rows.map((r, i) => [r.ID + '|' + r.MARKET + '|' + (+r.MONTH), i]));
      const put = (id, market, mo, val, note, src) => {
        if (val === null || val === undefined || !isFinite(val)) return;
        const k = id + '|' + market + '|' + mo, v = String(Math.round(val * 10000) / 10000);
        if (at.has(k)) Object.assign(rows[at.get(k)], { VALUE: v, NOTE: note, SOURCE: src });
        else { at.set(k, rows.length); rows.push({ ID: id, MARKET: market, MONTH: String(mo), VALUE: v, NOTE: note, SOURCE: src }); }
      };
      const ds = (id) => { const x = data.find((d) => d.id === id); return x && Array.isArray(x.rows) ? x.rows : null; };
      const ST = { GA: 'Georgia', TN: 'Tennessee', NC: 'North Carolina' };
      const now = new Date(), curMo = now.getMonth() + 1, Y = '2026';
      const mon = (s) => (String(s || '').slice(0, 4) === Y ? +String(s).slice(5, 7) : null);
      const T = (s) => Date.parse(String(s).slice(0, 10) + 'T12:00:00');
      const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
      const each = (list, fn) => { const g = new Map(); list.forEach((r) => { const k = r.k; if (!g.has(k)) g.set(k, []); g.get(k).push(r.v); }); g.forEach((v, k) => { const [mk, mo] = k.split('|'); if (+mo <= curMo) fn(mk, +mo, v); }); };
      // Business hours between two times (Mon-Fri 8 AM-6 PM Eastern), hour by hour.
      const ETF = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false });
      const biz = (t) => { const p = Object.fromEntries(ETF.formatToParts(new Date(t)).map((x) => [x.type, x.value])); const h = +p.hour % 24; return !['Sat', 'Sun'].includes(p.weekday) && h >= 8 && h < 18; };
      const bizH = (a, b) => { let t = +new Date(a), ms = 0; const e = +new Date(b); while (t < e) { const n = Math.min(e, (Math.floor(t / 3600000) + 1) * 3600000); if (biz(t)) ms += n - t; t = n; } return ms / 3600000; };
      // r14 Lease renewals: renewed / (renewed + moved out + notice given), by month the lease ended.
      const ren = ds('renewals');
      if (ren) each(ren.filter((r) => ST[r.STATE] && mon(r.LEASE_END) && T(r.LEASE_END) <= +now && /renew|moved|notice/i.test(r.OUTCOME)).map((r) => ({ k: ST[r.STATE] + '|' + mon(r.LEASE_END), v: /renew/i.test(r.OUTCOME) ? 1 : 0 })),
        (mk, mo, v) => put('r14', mk, mo, avg(v), 'Leases that ended this month and renewed / ended (renewed, moved out or gave notice)', 'AppFolio'));
      // r16 / r17 Tenant and owner response time: average business hours to the first reply (Outlook or AppFolio).
      const em = ds('resp_email');
      if (em) ['Tenant', 'Owner'].forEach((role) => {
        const list = em.filter((r) => r.ROLE === role && ST[{ Georgia: 'GA', Tennessee: 'TN', 'North Carolina': 'NC' }[r.MARKET]] && mon(r.RECEIVED)).map((r) => {
          const o = r.REPLIED ? +new Date(r.REPLIED) : null, a = r.AF_REPLIED ? +new Date(r.AF_REPLIED) : null;
          const rep = o && a ? Math.min(o, a) : o || a;
          return rep ? { k: r.MARKET + '|' + mon(r.RECEIVED), v: bizH(r.RECEIVED, rep) } : null;
        }).filter(Boolean);
        each(list, (mk, mo, v) => put(role === 'Tenant' ? 'r16' : 'r17', mk, mo, avg(v), role + ' emails: average business hours to the first reply (Outlook or AppFolio)', 'Outlook + AppFolio'));
      });
      // r26 Application processing time: average business days from received to approval.
      const ap = ds('apps');
      if (ap) each(ap.filter((r) => ST[r.STATE] && /approved/i.test(r.DECISION) && r.BDAYS !== '' && mon(r.RECEIVED)).map((r) => ({ k: ST[r.STATE] + '|' + mon(r.RECEIVED), v: +r.BDAYS })),
        (mk, mo, v) => put('r26', mk, mo, avg(v), 'Approved applications: average business days from received to approval', 'AppFolio'));
      // r28 Owner debt: total owed by owners at month end (current balance for this month).
      const od = ds('owner_debt');
      if (od) {
        od.filter((r) => r.KIND === 'month_end' && ST[r.STATE] && mon(r.AS_OF) && mon(r.AS_OF) < curMo).forEach((r) => put('r28', ST[r.STATE], mon(r.AS_OF), +r.AMOUNT, 'Total owed by owners with a negative balance at month end', 'AppFolio'));
        Object.entries(ST).forEach(([s, mk]) => { const cur = od.filter((r) => r.KIND === 'current' && r.STATE === s); if (cur.length || od.some((r) => r.KIND === 'current')) put('r28', mk, curMo, cur.reduce((x, r) => x + (+r.AMOUNT || 0), 0), 'Total owed by owners with a negative balance right now', 'AppFolio'); });
      }
      // r47 Doors closed: rental doors whose management started in the month (HOAs not counted).
      const pr = ds('props');
      if (pr) {
        const g = new Map(); pr.filter((p) => !/^hoa$/i.test(p.TYPE || '') && ST[p.STATE] && mon(p.START)).forEach((p) => { const k = ST[p.STATE] + '|' + mon(p.START); g.set(k, (g.get(k) || 0) + (+p.UNITS || 0)); });
        Object.values(ST).forEach((mk) => { for (let mo = 1; mo <= curMo; mo++) put('r47', mk, mo, g.get(mk + '|' + mo) || 0, 'Rental doors whose management started this month', 'AppFolio'); });
      }
      // r49 Rent ready to market: average days from rent-ready to the listing going live.
      const li = ds('listings');
      if (li) each(li.filter((r) => ST[r.STATE] && r.RENT_READY && r.LISTED && mon(r.LISTED) && T(r.LISTED) >= T(r.RENT_READY)).map((r) => ({ k: ST[r.STATE] + '|' + mon(r.LISTED), v: (T(r.LISTED) - T(r.RENT_READY)) / 86400000 })),
        (mk, mo, v) => put('r49', mk, mo, avg(v), 'Average days from rent-ready to listed', 'AppFolio'));
      // r53 / r55 / r57 Social posts, engagement growth (company-wide) and Google Business Profile clicks (by market), from Windsor.ai.
      const so = ds('social');
      if (so) {
        const g = (metric, market) => new Map(so.filter((r) => r.METRIC === metric && r.MARKET === market && String(r.MONTH).startsWith(Y)).map((r) => [+String(r.MONTH).slice(5, 7), +r.VALUE]));
        g('posts', 'Combined').forEach((v, mo) => put('r53', 'Combined', mo, v, 'Facebook posts across the Motion pages', 'Windsor.ai'));
        const eng = g('engagements', 'Combined');
        eng.forEach((v, mo) => { const p = eng.get(mo - 1); if (p) put('r55', 'Combined', mo, (v - p) / p, 'Change in Facebook engagements vs the month before', 'Windsor.ai'); });
        ['Georgia', 'Tennessee', 'North Carolina'].forEach((mk) => g('gbp_clicks', mk).forEach((v, mo) => put('r57', mk, mo, v, 'Google Business Profile calls + website clicks', 'Windsor.ai')));
      }
      const MK = (x) => ST[x] || ({ Georgia: 1, Tennessee: 1, 'North Carolina': 1 }[x] ? x : null);
      const days = (a, b) => Math.round((T(b) - T(a)) / 86400000);
      // r29 Credits issued: concessions, fee waivers, refunds and other give-backs (deposit settlements and owner transfers excluded).
      const cr = ds('credits');
      if (cr) {
        const g = new Map();
        cr.forEach((r) => { const mk = MK(r.MARKET), mo = mon(r.DATE); if (mk && mo) { const k = mk + '|' + mo; g.set(k, (g.get(k) || 0) + (+r.AMOUNT || 0)); } });
        ['Georgia', 'Tennessee', 'North Carolina'].forEach((mk) => { for (let mo = 1; mo <= curMo; mo++) put('r29', mk, mo, g.get(mk + '|' + mo) || 0, 'Concessions, fee waivers, refunds and repair/utility credits given back', 'AppFolio'); });
      }
      // r19 Contract to market (new vacant only): management start to listing live, by month listed.
      const li2 = ds('listings');
      if (li2) each(li2.filter((r) => /vac/i.test(r.START_STATUS || '') && ST[r.STATE] && r.MGMT_START >= '2026-01-01' && mon(r.LISTED) && r.LISTED >= r.MGMT_START).map((r) => ({ k: ST[r.STATE] + '|' + mon(r.LISTED), v: days(r.MGMT_START, r.LISTED) })),
        (mk, mo, v) => put('r19', mk, mo, avg(v), 'Days from management start to listing live (properties vacant at takeover), ' + v.length + ' listing(s)', 'AppFolio'));
      // r20 Contract to tenant portal (occupied only): management start to first portal activation invite, by start month.
      const po = ds('portal');
      if (po) each(po.filter((r) => ST[r.STATE] && r.FIRST_INVITE && mon(r.MGMT_START)).map((r) => ({ k: ST[r.STATE] + '|' + mon(r.MGMT_START), v: Math.max(0, days(r.MGMT_START, r.FIRST_INVITE)) })),
        (mk, mo, v) => put('r20', mk, mo, avg(v), 'Days from management start to the tenant portal invite (occupied takeovers), ' + v.length + ' propert' + (v.length === 1 ? 'y' : 'ies') + '. AppFolio keeps only the latest invite per tenant.', 'AppFolio'));
      // r50-52 Active 30/60/90: open LeadSimple leads with activity in the last 30, 60 or 90 days (latest snapshot each month).
      const ll = ds('ls_leads');
      if (ll) {
        const snap = new Map();
        ll.forEach((r) => { const mo = mon(r.SNAP_DATE); if (mo && (!snap.has(mo) || r.SNAP_DATE > snap.get(mo))) snap.set(mo, r.SNAP_DATE); });
        snap.forEach((sd, mo) => ['Georgia', 'Tennessee', 'North Carolina'].forEach((mk) => {
          const open = ll.filter((r) => r.SNAP_DATE === sd && r.MARKET === mk && /active|passive/i.test(r.LIFECYCLE));
          [['r50', 30], ['r51', 60], ['r52', 90]].forEach(([id, n]) => put(id, mk, mo, open.filter((r) => r.LAST_TOUCHED && days(r.LAST_TOUCHED, sd) <= n).length,
            'Open leads in the ' + mk + ' pipeline touched in the last ' + n + ' days (of ' + open.length + ' open)', 'LeadSimple'));
        }));
      }
      // r43 Rehab profitability and r42 average rehab cost, from AppFolio rehab / make-ready groups:
      // (billed to owner - paid to outside vendors) / billed. Payments to Motion's own companies are revenue, not cost.
      const rh = ds('rehab');
      if (rh) {
        const done = rh.filter((r) => ST[r.STATE] && +r.BILLED > 0 && mon(r.END || r.START)).map((r) => ({ mk: ST[r.STATE], mo: mon(r.END || r.START), b: +r.BILLED, c: (+r.VENDOR_PAID || 0) - (+r.MOTION_PAID || 0) }));
        const g = new Map();
        done.forEach((r) => { const k = r.mk + '|' + r.mo; if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
        g.forEach((list, k) => {
          const [mk, mo] = k.split('|'); if (+mo > curMo) return;
          const b = list.reduce((x, r) => x + r.b, 0), c = list.reduce((x, r) => x + r.c, 0);
          put('r43', mk, +mo, (b - c) / b, list.length + ' rehab(s): billed $' + Math.round(b).toLocaleString() + ', outside vendors paid $' + Math.round(c).toLocaleString(), 'AppFolio');
          put('r42', mk, +mo, b / list.length, 'Average billed to the owner per rehab, ' + list.length + ' rehab(s)', 'AppFolio');
        });
      }
      // Revenue per unit = revenue per door x doors / units (same revenue, divided by units instead of doors).
      {
        const get = (id, mk, mo) => { const i = at.get(id + '|' + mk + '|' + mo); return i === undefined ? null : rows[i].VALUE === '' ? null : +rows[i].VALUE; };
        for (let mo = 1; mo <= 12; mo++) {
          let rev = 0, units = 0;
          ['Georgia', 'Tennessee', 'North Carolina'].forEach((mk) => {
            const r = get('r30', mk, mo), dr = get('eom_doors', mk, mo), u = get('eom_units', mk, mo);
            if (r === null || !dr || !u) return;
            put('r30u', mk, mo, r * dr / u, 'Same AppFolio revenue divided by ' + u + ' units (' + dr + ' doors)', 'AppFolio');
            rev += r * dr; units += u;
          });
          if (units) put('r30u', 'Combined', mo, rev / units, 'Revenue across all markets divided by ' + units + ' units', 'AppFolio');
        }
      }
      // Owner churn: doors that left that month / doors at the end of the month before (the year to date adds up to the annual rate).
      for (let mo = 1; mo <= curMo; mo++) {
        let out = 0, base = 0;
        ['Georgia', 'Tennessee', 'North Carolina'].forEach((mk) => {
          const o = mo === 1 ? null : (() => { const i = at.get('eom_doors|' + mk + '|' + (mo - 1)); return i === undefined ? null : +rows[i].VALUE; })();
          const lost = (() => { const i = at.get('doors_out|' + mk + '|' + mo); return i === undefined ? null : +rows[i].VALUE; })();
          if (!o || lost === null) return;
          put('churn', mk, mo, lost / o, lost + ' door(s) left out of ' + o + ' at the start of the month', 'AppFolio');
          out += lost; base += o;
        });
        if (base) put('churn', 'Combined', mo, out / base, out + ' door(s) left out of ' + base + ' at the start of the month', 'AppFolio');
      }
      // r36, r40-r44 from Jobber (built by jobber_metrics.py in the Jobber refresh).
      const jm = ds('jobber_metrics');
      if (jm) jm.forEach((r) => { if (+r.MONTH <= curMo) put(r.ID, r.MARKET, +r.MONTH, +r.VALUE, r.NOTE, 'Jobber'); });
      sys.rows = rows;
    }
    window.mpDsTimes = Object.fromEntries(data.map((d) => [d.id, d.updated_at]));
    data.forEach((d) => {
      if (d.id === 'sc2026') {
        // Retired metrics: search ranking and NPS (not tracked)
        const DROP = new Set(['r56', 'r58', 'r46']); // r46 Sales goal: same as Doors Closed
        d.rows = d.rows.filter((r) => !DROP.has(r.ID));
        // Revenue per unit, shown under revenue per door (track only, no goal).
        if (!d.rows.some((r) => r.ID === 'r30u')) {
          const out = []; let last = -1;
          d.rows.forEach((r, i) => { out.push(r); if (r.ID === 'r30') last = out.length; });
          if (last > 0) out.splice(last, 0, ...d.rows.filter((r) => r.ID === 'r30').map((r) => Object.assign({}, r, { ID: 'r30u', METRIC: 'Revenue Per Unit Per Month', VALUE: '', GOAL: '', GOAL_TEXT: '', DIR: 'N' })));
          d.rows = out;
        }
        // Owner churn, under the door counts.
        if (!d.rows.some((r) => r.ID === 'churn')) {
          const out = []; let last = -1;
          d.rows.forEach((r) => { out.push(r); if (r.ID === 'doors_out') last = out.length; });
          if (last > 0) out.splice(last, 0, ...d.rows.filter((r) => r.ID === 'doors_out').map((r) => Object.assign({}, r, { ID: 'churn', METRIC: 'Owner Churn (doors lost)', VALUE: '', GOAL: '', GOAL_TEXT: '', DIR: 'L', UNIT: 'Percentage', AGG: 'sum' })));
          d.rows = out;
        }
        const g26 = new Map(window.mpGoals.filter((g) => g.year === 2026).map((g) => [g.metric_id, g]));
        if (g26.size) d.rows = d.rows.map((r) => { const g = g26.get(r.ID); return g ? Object.assign({}, r, { GOAL: g.goal === null ? '' : String(g.goal), GOAL_TEXT: g.goal_text || (g.goal === null ? '' : String(g.goal)), DIR: g.dir }) : r; });
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
    if (window.mpGoalsPage) window.mpGoalsPage.render();
    if (window.mpExec) window.mpExec.load();
    if (!window.mpDiagSent) { window.mpDiagSent = true; setTimeout(sendDiag, 6000); }
    updated = new Date(d3.max(data, (d) => new Date(d.updated_at)));
    dash._redraw();
  };

  window.mpReloadData = () => safeLoad();
  window.mpSendDiag = (kind) => sendDiag(kind);
  // One small health report per visit, so display problems on other computers can be diagnosed.
  const sendDiag = async (kind) => {
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
        errors: (window.mpErrors || []).slice(0, 15),
        tab: location.hash || '#scorecard',
        // Blank or placeholder drawings per tab, to find what didn't show after a refresh.
        blanks: Object.fromEntries(q('section[data-section]').map((s, i) => [s.id || 'section' + i, Array.from(s.querySelectorAll('[data-draw]')).filter((e) => /^(|—|no data)$/.test(e.textContent.trim())).map((e) => e.getAttribute('data-draw')).slice(0, 25)])),
        loadMs: window.mpLoadMs || null,
        loaded: loadedOnce
      };
      await sb.from('client_diagnostics').insert({ kind: typeof kind === 'string' ? kind : 'load', detail });
    } catch (e) { /* diagnostics must never break the page */ }
  };
  // Load outside the sign-in callback: calling Supabase from inside onAuthStateChange can deadlock while the
  // sign-in token is being renewed (it happened after a refresh), leaving every table empty.
  let loading = null, loadedOnce = false;
  const safeLoad = () => {
    if (loading) return loading;
    loading = Promise.race([load().then(() => { loadedOnce = true; }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 20000))])
      .catch((e) => { (window.mpErrors = window.mpErrors || []).push('load: ' + (e && e.message)); })
      .finally(() => { loading = null; });
    return loading;
  };
  // If the first load stalls, try again a few times, then report it.
  const watchdog = (n) => setTimeout(async () => {
    if (loadedOnce || !shown) return;
    if (n < 3) { await sb.auth.refreshSession().catch(() => {}); safeLoad(); watchdog(n + 1); }
    else if (!window.mpDiagSent) { window.mpDiagSent = true; sendDiag(); }
  }, 8000);
  const showApp = () => { login.hidden = true; app.hidden = false; setTimeout(safeLoad, 0); watchdog(0); };
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
  setInterval(() => { if (shown) safeLoad(); }, 15 * 60 * 1000);
})();
