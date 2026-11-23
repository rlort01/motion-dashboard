(function () {
  const MARKETS = {
    Combined: ['GA-ATL', 'GA-MAC', 'TN-CHA', 'NC-CLT', 'NC-RAL'],
    Georgia: ['GA-ATL', 'GA-MAC'],
    Tennessee: ['TN-CHA'],
    'North Carolina': ['NC-CLT', 'NC-RAL']
  };
  const TARGET = { ins: 100, delinq: 3, vacancy: 8, dom: 28, l2a: 12, crit: 3, norm: 5, costPerDoor: 62.5 };
  const HIGHER = { ins: true, l2a: true };
  const CURRENT_MONTH = '2026-11';
  const P = () => dash.params();
  const mk = () => (MARKETS[P().market] ? P().market : 'Combined');
  const mo = () => P().month || CURRENT_MONTH;
  const num = (v) => (v === null || v === undefined || v === '' ? null : +v);
  const r1 = (v) => (v === null || !isFinite(v) ? null : Math.round(v * 10) / 10);
  const r2 = (v) => (v === null || !isFinite(v) ? null : Math.round(v * 100) / 100);
  const fmtPct = (v) => (v === null ? '—' : d3.format('.1f')(v) + '%');
  const fmtUsd = (v) => (v === null ? '—' : d3.format('$,.2f')(v));
  const fmtUsd0 = (v) => (v === null ? '—' : d3.format('$,.0f')(v));
  const fmtDays = (v) => (v === null ? '—' : d3.format('.1~f')(v) + (v === 1 ? ' day' : ' days'));
  const monthLabel = (m) => d3.utcFormat('%b %Y')(d3.utcParse('%Y-%m')(m));
  const woKey = (s) => {
    const m = String(s || '').match(/(?:#|WO:?\s)\s*(\d{3,4})(?:\s*-\s*(\d{1,2}))?/i);
    return m ? m[1] + '-' + (m[2] || '1') : null;
  };
  const addrKey = (s) => {
    const t = String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
    return t.length >= 2 ? t[0] + ' ' + t[1] : null;
  };
  window.mpHelpers = { MARKETS, woKey, addrKey };

  // ---------- loaders (reshape Jobber answers into rows) ----------
  dash.loader('jobber_jobs', {
    description: 'One row per active Jobber job; the AppFolio work order number is read from the job title.',
    fn: ({ answer }) => {
      if (answer && answer.error) throw new Error(answer.error.message || String(answer.error));
      const jobs = (answer && answer.jobs) || [];
      const rows = jobs.map((j) => {
        const a = (j.property && j.property.address) || {};
        const m = String(j.title || '').match(/(?:#|WO:?\s)\s*(\d{3,4})(?:\s*-\s*(\d{1,2}))?/i);
        return {
          job: String(j.jobNumber), title: j.title, status: j.status,
          start: j.startAt ? String(j.startAt).slice(0, 10) : null,
          address: [a.street1, a.street2].filter(Boolean).join(' ') + (a.city ? ', ' + a.city : ''),
          street: a.street1 || '', wo: m ? m[1] + '-' + (m[2] || '1') : null, url: j.jobberWebUri, client: j.client && j.client.name
        };
      });
      return { rows, truncated: !!(answer && answer.pageInfo && answer.pageInfo.hasNextPage) };
    }
  });
  const invLoader = ({ answer }) => {
    if (answer && answer.error) throw new Error(answer.error.message || String(answer.error));
    const inv = (answer && answer.invoices) || [];
    const rows = inv.map((i) => {
      const m = String(i.subject || '').match(/(?:#|WO:?\s)\s*(\d{3,4})(?:\s*-\s*(\d{1,2}))?/i);
      return {
        inv: String(i.invoiceNumber), subject: i.subject, status: i.status,
        issued: i.issuedDate ? String(i.issuedDate).slice(0, 10) : null,
        due: i.dueDate ? String(i.dueDate).slice(0, 10) : null,
        total: +i.total, balance: +i.balance, client: i.client && i.client.name,
        wo: m ? m[1] + '-' + (m[2] || '1') : null, url: i.jobberWebUri
      };
    });
    return { rows, truncated: !!(answer && answer.pageInfo && answer.pageInfo.hasNextPage) };
  };
  dash.loader('jobber_inv_open', { description: 'One row per unpaid sent Jobber invoice; the AppFolio work order number is read from the subject.', fn: invLoader });
  dash.loader('jobber_inv_draft', { description: 'One row per draft (unsent) Jobber invoice; the AppFolio work order number is read from the subject.', fn: invLoader });

  // ---------- calcs ----------
  dash.calc('kpi', {
    title: 'Scorecard figures for the selected market and month',
    description: 'Sums or door-weighted averages of the AppFolio property-group figures in the chosen market.',
    inputs: ['monthly', 'maint', 'current'],
    fn: (monthly, maint, current) => {
      const p = dash.params();
      const groups = { Combined: ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'], Georgia: ['GA-ATL', 'GA-MAC', 'GA-FTV'], Tennessee: ['TN-CHA'], 'North Carolina': ['NC-CLT', 'NC-RAL'] }[p.market] || ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'];
      const month = p.month || '2026-11';
      const m = monthly.filter((r) => r.MONTH === month && groups.includes(r.GROUP));
      const w = maint.filter((r) => r.MONTH === month && groups.includes(r.GROUP));
      const doors = d3.sum(m, (r) => +r.PROPS);
      const bal = d3.sum(m, (r) => +r.DELINQ_BAL), rent = d3.sum(m, (r) => +r.RENT_CHARGED);
      const vac = doors ? d3.sum(m, (r) => +r.VACANCY * +r.PROPS) / doors : null;
      const wmed = (field) => {
        const rs = w.filter((r) => r[field] !== null && r[field] !== '' && +r.WO_DONE > 0);
        const n = d3.sum(rs, (r) => +r.WO_DONE);
        return n ? d3.sum(rs, (r) => +r[field] * +r.WO_DONE) / n : null;
      };
      const cost = d3.sum(w, (r) => +r.WO_COST);
      let ins = null, dom = null, l2a = null;
      if (month === '2026-11') {
        const c = current.filter((r) => groups.includes(r.GROUP));
        const units = d3.sum(c, (r) => +r.UNITS);
        ins = units ? d3.sum(c, (r) => +r.INS_PCT * +r.UNITS) / units : null;
        const lc = c.filter((r) => r.MEDIAN_DOM !== null && r.MEDIAN_DOM !== '');
        const ln = d3.sum(lc, (r) => +r.LISTINGS);
        dom = ln ? d3.sum(lc, (r) => +r.MEDIAN_DOM * +r.LISTINGS) / ln : null;
        const leads = d3.sum(c, (r) => +r.LEADS30);
        l2a = leads ? d3.sum(c, (r) => +r.APPS30) / leads * 100 : null;
      }
      const round = (v, k) => (v === null || !isFinite(v) ? null : Math.round(v * k) / k);
      return [{
        doors, net: d3.sum(m, (r) => +r.ADDED - +r.REMOVED),
        delinq: round(rent ? bal / rent * 100 : null, 10), delinqBal: round(bal, 100),
        vacancy: round(vac, 10), ins: round(ins, 10), dom: round(dom, 10), l2a: round(l2a, 10),
        crit: round(wmed('URG_MED'), 10), norm: round(wmed('NORM_MED'), 10),
        costPerDoor: round(doors ? cost / doors : null, 100), woDone: d3.sum(w, (r) => +r.WO_DONE)
      }];
    }
  });

  dash.calc('trend', {
    title: '12-month trend for the selected market',
    description: 'Month-by-month sums or door-weighted averages of the AppFolio property-group figures.',
    inputs: ['monthly', 'maint'],
    fn: (monthly, maint) => {
      const p = dash.params();
      const groups = { Combined: ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'], Georgia: ['GA-ATL', 'GA-MAC', 'GA-FTV'], Tennessee: ['TN-CHA'], 'North Carolina': ['NC-CLT', 'NC-RAL'] }[p.market] || ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'];
      const months = Array.from(new Set(monthly.map((r) => r.MONTH))).sort();
      const round = (v, k) => (v === null || !isFinite(v) ? null : Math.round(v * k) / k);
      return months.map((month) => {
        const m = monthly.filter((r) => r.MONTH === month && groups.includes(r.GROUP));
        const w = maint.filter((r) => r.MONTH === month && groups.includes(r.GROUP));
        const doors = d3.sum(m, (r) => +r.PROPS);
        const bal = d3.sum(m, (r) => +r.DELINQ_BAL), rent = d3.sum(m, (r) => +r.RENT_CHARGED);
        const rs = w.filter((r) => r.NORM_MED !== null && r.NORM_MED !== '' && +r.WO_DONE > 0);
        const n = d3.sum(rs, (r) => +r.WO_DONE);
        const [y, mm] = month.split('-');
        return {
          month, label: ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][+mm - 1] + ' ' + y + (month === '2026-11' ? ' (to Nov 16)' : ''),
          doors, net: d3.sum(m, (r) => +r.ADDED - +r.REMOVED),
          vacancy: round(doors ? d3.sum(m, (r) => +r.VACANCY * +r.PROPS) / doors : null, 10),
          delinq: round(rent ? bal / rent * 100 : null, 10),
          woDone: d3.sum(w, (r) => +r.WO_DONE),
          norm: round(n ? d3.sum(rs, (r) => +r.NORM_MED * +r.WO_DONE) / n : null, 10),
          costPerDoor: round(doors ? d3.sum(w, (r) => +r.WO_COST) / doors : null, 100)
        };
      });
    }
  });

  // Request type for a work order: inspections (mid-lease, move-in/out, other), unit turns, recurring services and
  // repairs, from the AppFolio work-order list (wo_types) with a description fallback for brand-new work orders.
  // Pest, wildlife, roof and similar "inspections" by an outside vendor are real work, not routine inspections.
  const REAL_INSP = /pest|wildlife|termite|rodent|mold|roof|sewer|camera|septic|foundation|structural|hvac|chimney/i;
  const TT_CHECK = /tenant ?turner|\btt\b|lock ?box|marketing photos|showing box/i;
  const woKind = (wo, desc, types) => {
    const t = types.get(wo) || {};
    let insp = REAL_INSP.test(desc || '') ? '' : t.INSP || '';
    if (TT_CHECK.test(desc || '')) return 'Tenant Turner / lockbox check';
    if (/mid.?lease|quarterly inspection|semi.?annual inspection|annual inspection|periodic inspection/i.test(desc || '')) return 'Mid-lease inspection';
    if (!insp && /inspect/i.test(desc || '') && !REAL_INSP.test(desc || '')) insp = /mid.?lease|quarter|semi|annual|periodic/i.test(desc) ? 'Mid-lease' : /move.?in/i.test(desc) ? 'Move-in' : /move.?out/i.test(desc) ? 'Move-out' : 'Other inspection';
    if (insp === 'Mid-lease') return 'Mid-lease inspection';
    if (insp === 'Move-in' || insp === 'Move-out') return 'Move-in/out inspection';
    if (insp) return 'Other inspection';
    if (t.WTYPE === 'unit_turn' || /\bturn\b|make.?ready/i.test(desc || '')) return 'Unit turn';
    if (t.WTYPE === 'recurring_work_order') return 'Recurring service';
    return 'Repair';
  };
  window.mpWoKind = woKind;
  // Three groups: real work orders (owner or tenant requests, repairs, turns), mid-lease inspections,
  // and other inspections and checks (move-in/out, other inspections, Tenant Turner and lockbox checks).
  const WOCAT = { work: 'Work orders', mid: 'Mid-lease inspections', other: 'Other inspections & checks' };
  const woCat = (kind) => (kind === 'Mid-lease inspection' ? 'mid' : /inspection|tenant turner/i.test(kind) ? 'other' : 'work');
  window.mpWoCat = woCat;
  const woTypes = () => { const d = dash.data('wo_types'); return new Map(d.status === 'ok' ? d.data.map((r) => [r.WO, r]) : []); };

  dash.calc('board', {
    title: 'Open AppFolio work orders with their Jobber job',
    description: 'Each open AppFolio work order, joined to an active Jobber job by work order number in the job title, or else by street address.',
    inputs: ['af_wo', 'jobber_jobs', 'wo_types'],
    fn: (afWo, jobs, wt) => {
      const types = new Map((wt || []).map((r) => [r.WO, r]));
      const p = dash.params();
      const groups = { Combined: ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'], Georgia: ['GA-ATL', 'GA-MAC', 'GA-FTV'], Tennessee: ['TN-CHA'], 'North Carolina': ['NC-CLT', 'NC-RAL'] }[p.market] || ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'];
      const ak = (s) => { const t = String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return t.length >= 2 ? t[0] + ' ' + t[1] : null; };
      const byWo = new Map(), byAddr = new Map();
      jobs.forEach((j) => { if (j.wo) byWo.set(j.wo, j); const k = ak(j.street); if (k && !byAddr.has(k)) byAddr.set(k, j); });
      return afWo.filter((w) => groups.includes(w.GROUP)).map((w) => {
        const j = byWo.get(w.WO) || null;
        const ja = j ? null : byAddr.get(ak(w.ADDRESS)) || null;
        const jj = j || ja;
        return {
          wo: w.WO, group: w.GROUP, address: w.ADDRESS, desc: w.DESC, status: w.STATUS, priority: w.PRIORITY,
          kind: woKind(w.WO, w.DESC, types), cat: woCat(woKind(w.WO, w.DESC, types)), issue: (types.get(w.WO) || {}).ISSUE || '',
          days: +w.DAYS, vendor: w.VENDOR,
          jobberJob: jj ? jj.job : null, jobberStatus: jj ? jj.status : null, jobberDate: jj ? jj.start : null,
          jobberUrl: jj ? jj.url : null, match: j ? 'wo' : ja ? 'address' : null
        };
      }).sort((a, b) => b.days - a.days);
    }
  });

  // Work orders the property owner is handling themselves (AppFolio vendor = owner)
  const ownerSet = () => { const d = dash.data('owner_wo'); return new Set(d.status === 'ok' ? d.data.map((r) => r.WO) : []); };
  const isOwnerWo = (r, set) => /\(owner\)/i.test(r.vendor || '') || set.has(r.wo);
  window.mpIsOwnerWo = isOwnerWo;

  dash.calc('boardSum', {
    title: 'Work-order board totals',
    description: 'Counts from the open work-order board.',
    inputs: ['board', 'jobber_jobs', 'owner_wo'],
    fn: (board0, jobs, ow) => { const owners = new Set(ow.map((r) => r.WO)); const c = (window.mpView && window.mpView.wocat) || 'work'; const board = c === 'all' ? board0 : board0.filter((r) => r.cat === c); return [{
      open: board.length,
      linked: board.filter((r) => r.jobberJob).length,
      stale: board.filter((r) => !r.jobberJob && r.days >= 30 && !isOwnerWo(r, owners)).length,
      owner: board.filter((r) => isOwnerWo(r, owners)).length,
      jobberAttn: jobs.filter((j) => j.status === 'late' || j.status === 'action_required').length
    }]; }
  });

  dash.calc('jobberOnly', {
    title: 'Jobber jobs with no open AppFolio work order',
    description: 'Active Jobber jobs whose work order number and address match no open AppFolio work order.',
    inputs: ['af_wo', 'jobber_jobs'],
    fn: (afWo, jobs) => {
      const ak = (s) => { const t = String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return t.length >= 2 ? t[0] + ' ' + t[1] : null; };
      const wos = new Set(afWo.map((w) => w.WO)), addrs = new Set(afWo.map((w) => ak(w.ADDRESS)));
      return jobs.filter((j) => !(j.wo && wos.has(j.wo)) && !addrs.has(ak(j.street)))
        .map((j) => ({ job: j.job, title: j.title, address: j.address, status: j.status, start: j.start, url: j.url }));
    }
  });

  dash.calc('invoices', {
    title: 'Unpaid and draft Jobber invoices',
    description: 'Draft and sent-but-unpaid Jobber invoices, with whether AppFolio has a vendor bill for the same work order.',
    inputs: ['jobber_inv_open', 'jobber_inv_draft', 'gaps'],
    fn: (open, drafts, gaps) => {
      const noBill = new Set(gaps.filter((g) => g.GAP === 'No vendor bill entered').map((g) => g.WO));
      const seen = new Set();
      return drafts.concat(open).filter((i) => (seen.has(i.inv) ? false : (seen.add(i.inv), true))).map((i) => ({
        inv: i.inv, subject: i.subject, wo: i.wo, status: i.status, due: i.due, balance: i.balance, url: i.url,
        inAppfolio: i.wo && noBill.has(i.wo) ? 'Missing: WO completed, no bill' : i.wo ? 'Not flagged' : 'No WO number'
      })).sort((a, b) => ({ draft: 0, past_due: 1 }[a.status] ?? 2) - ({ draft: 0, past_due: 1 }[b.status] ?? 2) || (+a.inv) - (+b.inv));
    }
  });

  dash.calc('billSum', {
    title: 'Jobber invoice totals',
    description: 'Counts and balances of draft, past-due and all unpaid Jobber invoices.',
    inputs: ['jobber_inv_open', 'jobber_inv_draft'],
    fn: (open, drafts) => {
      const pd = open.filter((i) => i.status === 'past_due');
      const round = (v) => Math.round(v * 100) / 100;
      return [{
        draftN: drafts.length, draftAmt: round(d3.sum(drafts, (i) => i.balance)),
        pastDueN: pd.length, pastDueAmt: round(d3.sum(pd, (i) => i.balance)),
        openN: open.length, openAmt: round(d3.sum(open, (i) => i.balance))
      }];
    }
  });

  dash.calc('gapRows', {
    title: 'AppFolio billing gaps with Jobber invoice',
    description: 'Completed AppFolio work orders not billed back, in the selected market, with any Jobber invoice for the same work order.',
    inputs: ['gaps', 'jobber_inv_open', 'jobber_inv_draft'],
    fn: (gaps, open, drafts) => {
      const p = dash.params();
      const groups = { Combined: ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'], Georgia: ['GA-ATL', 'GA-MAC', 'GA-FTV'], Tennessee: ['TN-CHA'], 'North Carolina': ['NC-CLT', 'NC-RAL'] }[p.market] || ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'];
      const inv = new Map();
      drafts.concat(open).forEach((i) => { if (i.wo && !inv.has(i.wo)) inv.set(i.wo, i); });
      return gaps.filter((g) => groups.includes(g.GROUP)).map((g) => {
        const i = inv.get(g.WO);
        return { WO: g.WO, GROUP: g.GROUP, ADDRESS: g.ADDRESS, COMPLETED: g.COMPLETED, VENDOR: g.VENDOR, WO_AMOUNT: +g.WO_AMOUNT,
          GAP: g.GAP, jobberInv: i ? '#' + i.inv + ' · ' + i.status.replace(/_/g, ' ') + ' · $' + i.balance.toFixed(2) : null, jobberUrl: i ? i.url : null };
      });
    }
  });

  dash.calc('gapSum', {
    title: 'AppFolio billing gap totals',
    description: 'Counts and amounts of completed work orders not billed back, in the selected market.',
    inputs: ['gapRows'],
    fn: (rows) => {
      const v = rows.filter((r) => r.GAP === 'No vendor bill entered');
      const c = rows.filter((r) => r.GAP !== 'No vendor bill entered');
      return [{ noBill: v.length, noBillJobber: v.filter((r) => r.jobberInv).length, noCharge: c.length, noChargeAmt: Math.round(d3.sum(c, (r) => r.WO_AMOUNT) * 100) / 100 }];
    }
  });

  dash.calc('officeBills', {
    title: 'Unpaid MPP bills in AppFolio with their Jobber invoice',
    description: 'Unpaid Motion Property Preservation bills in AppFolio, matched to the Jobber invoice with the same number.',
    inputs: ['af_bills', 'jobber_inv_open', 'jobber_inv_draft'],
    fn: (bills, open, drafts) => {
      const inv = new Map(drafts.concat(open).map((i) => [i.inv, i]));
      return bills.map((b) => {
        const i = inv.get(String(b.REF));
        return { REF: String(b.REF), PROPERTY: b.PROPERTY, UNPAID: +b.UNPAID, DUE: b.DUE, jobberSubject: i ? i.subject : null, office: /office/i.test(b.PROPERTY) };
      });
    }
  });

  dash.calc('officeSum', {
    title: 'MPP bills posted to the office',
    description: 'Unpaid MPP bills in AppFolio posted to the 4495 Atlanta Hwy office rather than a rental property.',
    inputs: ['officeBills'],
    fn: (rows) => { const o = rows.filter((r) => r.office); return [{ n: o.length, amt: Math.round(d3.sum(o, (r) => r.UNPAID) * 100) / 100 }]; }
  });

  // ---------- tabs and chip views (listen + attributes only) ----------
  const showTab = (id) => {
    document.querySelectorAll('section[data-section]').forEach((s) => { s.hidden = s.id !== id; });
    document.querySelectorAll('.mp-tab').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false'));
    dash.setLink(id);
    // Only show the filters the tab actually uses.
    const useMkt = ['scorecard', 'workorders', 'billing', 'portfolio', 'map'].includes(id);
    const fm = document.getElementById('fltMarket'), fo = document.getElementById('fltMonth'), fn = document.getElementById('fltNone');
    if (fm) fm.hidden = !useMkt;
    if (fo) fo.hidden = id !== 'scorecard';
    if (fn) fn.hidden = useMkt || ['entry', 'sources'].includes(id);
    if (fn && (id === 'commercial' || id === 'exec')) fn.hidden = true;
    if (document.getElementById('filters')) document.getElementById('filters').hidden = id === 'entry' || id === 'sources';
    window.dispatchEvent(new CustomEvent('mp-tab', { detail: id }));
    // Redraw when a tab is shown, so its tables are always built from the current data.
    dash._redraw();
    // If the scorecard still shows empty tables a moment later, send one report so the cause can be found.
    if (id === 'scorecard') setTimeout(() => {
      const bodies = Array.from(document.querySelectorAll('#scorecard tbody[data-draw=scSection]'));
      if (bodies.length && (bodies.every((t) => !t.children.length) || bodies.some((t) => t.hidden)) && dash._ids().length && !window.mpBlankSent && window.mpSendDiag) { window.mpBlankSent = true; window.mpSendDiag('blank-after-tab'); }
    }, 1500);
  };
  document.querySelectorAll('.mp-tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  const h = (location.hash || '').slice(1);
  if (['scorecard', 'workorders', 'billing', 'comms', 'portfolio', 'map', 'goals', 'entry', 'exec', 'commercial'].includes(h)) showTab(h);

  window.mpView = { wo: 'all', inv: 'attention', gap: 'V', wocat: 'work' };
  const chipGroup = (attr, key, draw) => {
    document.querySelectorAll('[data-' + attr + ']').forEach((b) => b.addEventListener('click', () => {
      window.mpView[key] = b.getAttribute('data-' + attr);
      document.querySelectorAll('[data-' + attr + ']').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
      dash.draw(draw);
    }));
  };
  chipGroup('woview', 'wo', 'boardRows');
  chipGroup('wotype', 'wotype', 'boardRows');
  // Category switch: changes the board, the tiles above it and the labels.
  document.querySelectorAll('[data-wocat]').forEach((b) => b.addEventListener('click', () => {
    window.mpView.wocat = b.getAttribute('data-wocat');
    document.querySelectorAll('[data-wocat]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    const all = document.querySelector('[data-wotype="all"]'); if (all && all.getAttribute('aria-pressed') !== 'true' && !b.dataset.keepType) all.click();
    dash._redraw();
  }));
  chipGroup('invview', 'inv', 'invRows');
  chipGroup('gapview', 'gap', 'gapTable');

  // ---------- drawings ----------
  const one = (id) => { const d = dash.data(id); return d.status === 'ok' && d.data && d.data[0] ? d.data[0] : null; };
  const setText = (el, t) => { el.textContent = t; };
  const statusOf = (key, v) => {
    if (v === null) return null;
    const good = HIGHER[key] ? v >= TARGET[key] : v <= TARGET[key];
    return good;
  };

  dash.draw('marketSel', (sel) => {
    sel.replaceChildren(...Object.keys(MARKETS).map((k) => new Option(k === 'Combined' ? 'Combined markets' : k, k)));
    sel.value = mk();
    sel.onchange = () => dash.setParams({ market: sel.value });
  });
  dash.draw('monthSel', (sel) => {
    const d = dash.data('monthly');
    const months = d.status === 'ok' ? Array.from(new Set(d.data.map((r) => r.MONTH))).sort().reverse() : [];
    sel.replaceChildren(...months.map((m) => new Option(monthLabel(m) + (m === CURRENT_MONTH ? ' (to date)' : ''), m)));
    sel.value = mo();
    sel.onchange = () => dash.setParams({ month: sel.value });
  });

  dash.draw('takeaway', (el) => {
    const k = one('kpi');
    if (!k) { setText(el, '—'); return; }
    const misses = [];
    if (statusOf('delinq', k.delinq) === false) misses.push('delinquency at ' + fmtPct(k.delinq));
    if (statusOf('vacancy', k.vacancy) === false) misses.push('vacancy at ' + fmtPct(k.vacancy));
    if (statusOf('norm', k.norm) === false) misses.push('normal work orders taking ' + fmtDays(k.norm));
    if (statusOf('ins', k.ins) === false) misses.push('insurance compliance at ' + fmtPct(k.ins));
    const who = mk() === 'Combined' ? 'Across all markets' : 'In ' + mk();
    setText(el, who + ', ' + monthLabel(mo()) + (mo() === CURRENT_MONTH ? ' to date' : '') + ': ' + k.doors + ' doors' +
      (misses.length ? '. Off target: ' + misses.join(', ') + '.' : ', with every connected KPI on target.'));
  });

  const kpiText = (name, field, fmt) => dash.draw(name, (el) => {
    const k = one('kpi');
    el.classList.toggle('dash-skeleton', dash.data('kpi').status === 'loading');
    setText(el, k && k[field] !== null && k[field] !== undefined ? fmt(k[field]) : '—');
  });
  kpiText('doors', 'doors', (v) => d3.format(',')(v));
  kpiText('net', 'net', (v) => (v > 0 ? '+' : '') + v);
  kpiText('ins', 'ins', fmtPct);
  kpiText('delinq', 'delinq', fmtPct);
  kpiText('delinqBal', 'delinqBal', fmtUsd);
  kpiText('vacancy', 'vacancy', fmtPct);
  kpiText('dom', 'dom', (v) => d3.format('.1~f')(v));
  kpiText('l2a', 'l2a', fmtPct);
  kpiText('crit', 'crit', fmtDays);
  kpiText('norm', 'norm', fmtDays);
  kpiText('costPerDoor', 'costPerDoor', fmtUsd);
  kpiText('woDone', 'woDone', (v) => d3.format(',')(v));

  const statusPill = (name, key) => dash.draw(name, (el) => {
    const k = one('kpi');
    const s = k ? statusOf(key, k[key]) : null;
    el.className = 'mp-pill ' + (s === null ? '' : s ? 'mp-ok' : 'mp-bad mp-flash');
    setText(el, s === null ? (k && mo() !== CURRENT_MONTH && ['ins', 'dom', 'l2a'].includes(key) ? 'current month only' : 'no data') : s ? 'On target' : 'Off target');
  });
  statusPill('insStatus', 'ins'); statusPill('delinqStatus', 'delinq'); statusPill('vacStatus', 'vacancy');
  statusPill('domStatus', 'dom'); statusPill('l2aStatus', 'l2a'); statusPill('critStatus', 'crit');
  statusPill('normStatus', 'norm'); statusPill('mcStatus', 'costPerDoor');

  // line chart helper
  const lineChart = (name, field, fmt, target) => dash.draw(name, (el) => {
    const d = dash.data('trend');
    el.replaceChildren();
    if (d.status !== 'ok') { setText(el, d.status === 'error' ? 'Failed to load' : '—'); return; }
    const rows = d.data.filter((r) => r[field] !== null);
    if (!rows.length) { setText(el, 'No data for this market'); return; }
    const W = Math.max(240, el.clientWidth), H = 160, m = { t: 10, r: 12, b: 22, l: 44 };
    const x = d3.scalePoint().domain(d.data.map((r) => r.month)).range([m.l, W - m.r]);
    const ext = d3.extent(rows.map((r) => r[field]).concat(target !== undefined ? [target] : []));
    const y = d3.scaleLinear().domain([Math.min(0, ext[0]), ext[1] * 1.1 || 1]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', name + ' by month for ' + mk());
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(4).tickSize(-(W - m.l - m.r)).tickFormat((v) => fmt(v, true)))
      .call((g) => { g.select('.domain').remove(); g.selectAll('line').style('stroke', 'var(--cds-chart-grid)'); });
    const step = Math.ceil(d.data.length / Math.max(2, Math.floor((W - m.l) / 55)));
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(d.data.map((r) => r.month).filter((_, i) => i % step === 0)).tickFormat((v) => d3.utcFormat('%b')(d3.utcParse('%Y-%m')(v))).tickSize(0).tickPadding(6))
      .call((g) => g.select('.domain').style('stroke', 'var(--cds-chart-axis)'));
    if (target !== undefined) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(target)).attr('y2', y(target))
      .style('stroke', 'var(--cds-chart-reference)').style('stroke-dasharray', '4 3');
    svg.append('path').datum(rows).attr('fill', 'none').style('stroke', dash.colors[0]).attr('stroke-width', 2)
      .attr('d', d3.line().x((r) => x(r.month)).y((r) => y(r[field])));
    const dots = svg.selectAll('circle').data(rows).join('circle').attr('cx', (r) => x(r.month)).attr('cy', (r) => y(r[field])).attr('r', 3)
      .style('fill', (r) => (target !== undefined && r[field] > target ? 'var(--cds-chart-status-critical)' : dash.colors[0]));
    const tip = d3.select(el).append('div').attr('class', 'mp-tip').style('display', 'none');
    svg.append('rect').attr('x', m.l).attr('y', 0).attr('width', W - m.l - m.r).attr('height', H).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [px] = d3.pointer(ev);
        const r = rows.reduce((best, cur) => (Math.abs(x(cur.month) - px) < Math.abs(x(best.month) - px) ? cur : best), rows[0]);
        if (!r) return;
        tip.style('display', null).text(r.label + ': ' + fmt(r[field]));
        const tx = Math.min(x(r.month) / W * el.clientWidth, el.clientWidth - 150);
        tip.style('left', Math.max(0, tx) + 'px').style('top', (y(r[field]) / H * 160 - 30) + 'px');
      })
      .on('pointerleave', () => tip.style('display', 'none'));
  });
  lineChart('chartDoors', 'doors', (v) => d3.format(',')(v));
  lineChart('chartVac', 'vacancy', (v, t) => d3.format(t ? '.0f' : '.1f')(v) + '%', 8);
  lineChart('chartDelinq', 'delinq', (v, t) => d3.format(t ? '.0f' : '.1f')(v) + '%', 3);
  lineChart('chartCost', 'costPerDoor', (v, t) => (t ? d3.format('$,.0f')(v) : d3.format('$,.2f')(v)), 62.5);

  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const link = (cell, text, url) => {
    cell.textContent = '';
    if (url && /^https:\/\/secure\.getjobber\.com\//.test(url)) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; cell.appendChild(a); }
    else cell.textContent = text;
  };

  dash.draw('trendRows', (tb) => {
    const d = dash.data('trend');
    tb.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.slice().reverse().forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.month);
      td(tr, r.label); td(tr, d3.format(',')(r.doors), 'mp-num'); td(tr, (r.net > 0 ? '+' : '') + r.net, 'mp-num');
      td(tr, fmtPct(r.vacancy), 'mp-num'); td(tr, fmtPct(r.delinq), 'mp-num'); td(tr, r.woDone, 'mp-num');
      td(tr, r.norm === null ? '—' : d3.format('.1~f')(r.norm), 'mp-num'); td(tr, fmtUsd(r.costPerDoor), 'mp-num');
      tb.appendChild(tr);
    });
  });

  const boardNum = (name, field) => dash.draw(name, (el) => { const k = one('boardSum'); setText(el, k ? d3.format(',')(k[field]) : '—'); });
  boardNum('bOpen', 'open'); boardNum('bLinked', 'linked'); boardNum('bStale', 'stale'); boardNum('bAttn', 'jobberAttn');

  const nice = (s) => (s ? String(s).replace(/_/g, ' ') : '');
  dash.draw('boardRows', (tb) => {
    const d = dash.data('board');
    tb.replaceChildren();
    if (d.status !== 'ok') return;
    const v = window.mpView.wo, owners = ownerSet(), k = window.mpView.wotype || 'all';
    const wc = window.mpView.wocat || 'work';
    const kindOk = (r) => (wc === 'all' || r.cat === wc) && (k === 'all' || (k === 'critical' ? r.priority === 'Urgent' && !/inspection/i.test(r.kind) : k === 'inspections' ? /inspection/i.test(r.kind) : r.kind === k));
    d.data.filter(kindOk).filter((r) => v === 'all' || (v === 'linked' && r.jobberJob) || (v === 'nojob' && !r.jobberJob) || (v === 'old' && r.days >= 30) || (v === 'owner' && isOwnerWo(r, owners))).forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.wo);
      if (isOwnerWo(r, owners)) { tr.className = 'mp-owner'; tr.title = 'The owner is handling this work order'; }
      td(tr, '#' + r.wo); td(tr, r.group); td(tr, r.address);
      const rc = td(tr, r.desc); const kb = document.createElement('span'); kb.className = 'mp-pill mp-kind' + (r.priority === 'Urgent' && !/inspection/i.test(r.kind) ? ' mp-bad' : ''); kb.textContent = (r.priority === 'Urgent' && !/inspection/i.test(r.kind) ? 'Critical · ' : '') + r.kind; rc.prepend(kb, ' ');
      td(tr, r.status + (r.priority === 'Urgent' ? ' · Urgent' : ''));
      const dc = td(tr, r.days, 'mp-num'); if (r.days >= 30) dc.style.color = 'var(--color-bad)';
      td(tr, r.vendor);
      const jc = td(tr, ''); if (r.jobberJob) link(jc, '#' + r.jobberJob + (r.match === 'address' ? ' (address match)' : ''), r.jobberUrl); else jc.textContent = 'Not in Jobber';
      const sc = td(tr, nice(r.jobberStatus)); if (r.jobberStatus === 'late') sc.style.color = 'var(--color-bad)';
      td(tr, r.jobberDate);
      tb.appendChild(tr);
    });
  });

  // Work orders by request type: open now (from the board) and the last 30/90 days (from the AppFolio list).
  dash.draw('woKinds', (tb) => {
    const b = dash.data('board'), t = dash.data('wo_types');
    tb.replaceChildren();
    if (b.status !== 'ok') return;
    const types = woTypes(), now = Date.now(), DAY = 86400000;
    const K = ['Repair', 'Unit turn', 'Recurring service', 'Mid-lease inspection', 'Move-in/out inspection', 'Other inspection', 'Tenant Turner / lockbox check'];
    const S = new Map(K.map((k) => [k, { k, open: 0, crit: 0, old: 0, made: 0, done: 0, days: [] }]));
    b.data.forEach((r) => { const s = S.get(r.kind); if (!s) return; s.open++; if (r.priority === 'Urgent' && !/inspection/i.test(r.kind)) s.crit++; if (r.days >= 30) s.old++; });
    if (t.status === 'ok') t.data.forEach((r) => {
      const s = S.get(woKind(r.WO, '', types)); if (!s || /cancel/i.test(r.STATUS)) return;
      const c = Date.parse(r.CREATED), f = r.COMPLETED ? Date.parse(r.COMPLETED) : null;
      if (now - c <= 30 * DAY) s.made++;
      if (f && now - f <= 30 * DAY) s.done++;
      if (f && now - f <= 90 * DAY) s.days.push((f - c) / DAY);
    });
    let lastCat = '';
    K.forEach((k) => {
      const cat = woCat(k);
      if (cat !== lastCat) { lastCat = cat; const h = document.createElement('tr'); h.className = 'mp-entry-sec'; const c = td(h, WOCAT[cat]); c.colSpan = 7; tb.appendChild(h); }
      const s = S.get(k), tr = document.createElement('tr');
      td(tr, k); td(tr, s.open, 'mp-num'); const cc = td(tr, s.crit || '', 'mp-num'); if (s.crit) cc.style.color = 'var(--color-bad)';
      td(tr, s.old || '', 'mp-num'); td(tr, s.made, 'mp-num'); td(tr, s.done, 'mp-num');
      td(tr, s.days.length ? d3.median(s.days).toFixed(0) + ' days' : '—', 'mp-num');
      tr.style.cursor = 'pointer'; tr.title = 'Show these on the board below';
      tr.addEventListener('click', () => { const cb = document.querySelector('[data-wocat="' + woCat(k) + '"]'); if (cb) cb.click(); const btn = document.querySelector('[data-wotype="' + k + '"]'); if (btn) btn.click(); document.getElementById('board').scrollIntoView({ behavior: 'smooth' }); });
      tb.appendChild(tr);
    });
  });
  dash.draw('bCrit', (el) => { const b = dash.data('board'); el.textContent = b.status === 'ok' ? b.data.filter((r) => r.priority === 'Urgent' && r.cat === 'work').length : '—'; });
  dash.draw('bInsp', (el) => { const b = dash.data('board'); el.textContent = b.status === 'ok' ? b.data.filter((r) => r.cat !== 'work').length : '—'; });
  dash.draw('bInspN', (el) => { const b = dash.data('board'); if (b.status !== 'ok') return; el.textContent = b.data.filter((r) => r.cat === 'mid').length + ' mid-lease · ' + b.data.filter((r) => r.cat === 'other').length + ' other inspections & checks'; });
  // Counts on the three category buttons.
  dash.draw('woCatCounts', (el) => {
    const b = dash.data('board'); if (b.status !== 'ok') return;
    document.querySelectorAll('[data-wocat]').forEach((btn) => {
      const c = btn.getAttribute('data-wocat'), n = c === 'all' ? b.data.length : b.data.filter((r) => r.cat === c).length;
      btn.textContent = (c === 'all' ? 'Everything' : WOCAT[c]) + ' (' + n + ')';
    });
    el.textContent = '';
  });
  dash.draw('woCatLabel', (el) => { const c = window.mpView.wocat || 'work'; el.textContent = c === 'all' ? 'all open AppFolio work orders, inspections and checks' : WOCAT[c].toLowerCase(); });

  dash.draw('jobberOnlyRows', (tb) => {
    const d = dash.data('jobberOnly');
    tb.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.job);
      link(td(tr, ''), '#' + r.job, r.url); td(tr, r.title); td(tr, r.address); td(tr, nice(r.status)); td(tr, r.start);
      tb.appendChild(tr);
    });
  });

  const sumText = (name, src, field, fmt) => dash.draw(name, (el) => { const k = one(src); setText(el, k ? fmt(k[field]) : '—'); });
  sumText('draftN', 'billSum', 'draftN', d3.format(',')); sumText('draftAmt', 'billSum', 'draftAmt', fmtUsd);
  sumText('pastDueN', 'billSum', 'pastDueN', d3.format(',')); sumText('pastDueAmt', 'billSum', 'pastDueAmt', fmtUsd);
  sumText('openN', 'billSum', 'openN', d3.format(',')); sumText('openAmt', 'billSum', 'openAmt', fmtUsd);
  sumText('noBill', 'gapSum', 'noBill', d3.format(',')); sumText('noBillJobber', 'gapSum', 'noBillJobber', d3.format(','));
  sumText('noCharge', 'gapSum', 'noCharge', d3.format(',')); sumText('noChargeAmt', 'gapSum', 'noChargeAmt', fmtUsd);
  sumText('officeN', 'officeSum', 'n', d3.format(',')); sumText('officeAmt', 'officeSum', 'amt', fmtUsd);

  dash.draw('invRows', (tb) => {
    const d = dash.data('invoices');
    tb.replaceChildren();
    if (d.status !== 'ok') return;
    const v = window.mpView.inv;
    d.data.filter((r) => v === 'all' || r.status === 'draft' || r.status === 'past_due').forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.inv);
      link(td(tr, ''), '#' + r.inv, r.url); td(tr, r.subject); td(tr, r.wo ? '#' + r.wo : '');
      const sc = td(tr, nice(r.status)); if (r.status === 'past_due') sc.style.color = 'var(--color-bad)'; if (r.status === 'draft') sc.style.color = 'var(--color-warn)';
      td(tr, r.due || (r.status === 'draft' ? 'not sent' : '')); td(tr, fmtUsd(r.balance), 'mp-num');
      const ac = td(tr, r.inAppfolio); if (/^Missing/.test(r.inAppfolio)) ac.style.color = 'var(--color-bad)';
      tb.appendChild(tr);
    });
  });

  dash.draw('gapTable', (tb) => {
    const d = dash.data('gapRows');
    tb.replaceChildren();
    if (d.status !== 'ok') return;
    const v = window.mpView.gap;
    d.data.filter((r) => (v === 'V') === (r.GAP === 'No vendor bill entered')).forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.WO);
      td(tr, '#' + r.WO); td(tr, r.GROUP); td(tr, r.ADDRESS); td(tr, r.COMPLETED); td(tr, r.VENDOR);
      td(tr, r.WO_AMOUNT ? fmtUsd(r.WO_AMOUNT) : '—', 'mp-num');
      const jc = td(tr, ''); if (r.jobberInv) link(jc, r.jobberInv, r.jobberUrl);
      tb.appendChild(tr);
    });
  });

  dash.draw('officeRows', (tb) => {
    const d = dash.data('officeBills');
    tb.replaceChildren();
    if (d.status !== 'ok') return;
    d.data.forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.REF);
      td(tr, '#' + r.REF); const pc = td(tr, r.PROPERTY); if (r.office) pc.style.color = 'var(--color-bad)';
      td(tr, r.jobberSubject || ''); td(tr, fmtUsd(r.UNPAID), 'mp-num'); td(tr, r.DUE);
      tb.appendChild(tr);
    });
  });
})();
