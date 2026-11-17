(function () {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const usd = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? '—' : d3.format('$,.2f')(+v));
  const usd0 = (v) => (v === null || v === undefined || !isFinite(+v) ? '—' : d3.format('$,.0f')(+v));
  const days = (v) => (v === null || v === undefined || !isFinite(v) ? '—' : d3.format('.1f')(v) + ' days');
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const DAY = 86400000;
  const today = new Date();

  // ---------- company switch (listen + attributes only) ----------
  const COS = ['pmg', 'mpp', 'mr', 'tv'];
  // TV board: reload every 10 minutes so the screen picks up the hourly Jobber refresh.
  if (dash.params().company === 'tv') setInterval(() => location.reload(), 10 * 60 * 1000);
  dash.draw('tvStamp', (el) => { el.textContent = 'Updated ' + d3.timeFormat('%a %b %-d, %-I:%M %p')(new Date()) + ' · refreshes every 10 minutes'; });
  const applyCo = (co) => {
    COS.forEach((c) => { const el = document.getElementById('co-' + c); if (el) el.hidden = c !== co; });
    const sel = document.getElementById('companySel'); if (sel && sel.value !== co) sel.value = co;
  };
  const sel = document.getElementById('companySel');
  if (sel) sel.addEventListener('change', () => { applyCo(sel.value); dash.setParams({ company: sel.value }); });
  applyCo(COS.includes(dash.params().company) ? dash.params().company : 'pmg');

  // ---------- Jobber loaders ----------
  const jobLoader = ({ answer }) => {
    if (answer && answer.error) throw new Error(answer.error.message || String(answer.error));
    const jobs = (answer && answer.jobs) || [];
    return jobs.map((j) => {
      const a = (j.property && j.property.address) || {};
      const c = j.createdAt ? new Date(j.createdAt) : null, f = j.completedAt ? new Date(j.completedAt) : null;
      return {
        job: String(j.jobNumber), title: j.title, status: j.status,
        created: j.createdAt ? String(j.createdAt).slice(0, 10) : null,
        completed: j.completedAt ? String(j.completedAt).slice(0, 10) : null,
        closeDays: c && f ? Math.max(0, (f - c) / DAY) : null,
        ageDays: c ? (today - c) / DAY : null,
        total: +j.total || 0,
        address: [a.street1, a.street2].filter(Boolean).join(' ') + (a.city ? ', ' + a.city : ''),
        client: j.client && j.client.name, url: j.jobberWebUri
      };
    });
  };
  ['mpp_done_1', 'mpp_done_2', 'mpp_done_3', 'mpp_done_4'].forEach((id) => dash.loader(id, { description: 'One row per Jobber job completed in 2026, with days from creation to completion.', fn: jobLoader }));
  dash.loader('mpp_open', { description: 'One row per active Jobber job, with days since it was created.', fn: jobLoader });
  dash.loader('mpp_reqinv', { description: 'One row per Jobber job that is done but not invoiced.', fn: jobLoader });
  const invLoader = ({ answer }) => {
    if (answer && answer.error) throw new Error(answer.error.message || String(answer.error));
    const inv = (answer && answer.invoices) || [];
    return inv.map((i) => ({
      inv: String(i.invoiceNumber), subject: i.subject, status: i.status,
      issued: i.issuedDate ? String(i.issuedDate).slice(0, 10) : null,
      due: i.dueDate ? String(i.dueDate).slice(0, 10) : null,
      total: +i.total || 0, paid: +i.paid || 0, balance: +i.balance || 0, url: i.jobberWebUri
    }));
  };
  ['mpp_inv_1', 'mpp_inv_2', 'mpp_inv_3', 'mpp_inv_4'].forEach((id) => dash.loader(id, { description: 'One row per Jobber invoice issued in 2026.', fn: invLoader }));

  // ---------- MPP calcs ----------
  dash.calc('mppJobs', {
    title: 'Jobber jobs completed in 2026',
    description: 'All Jobber jobs completed this year (up to 200), with days from creation to completion.',
    inputs: ['mpp_done_1', 'mpp_done_2', 'mpp_done_3', 'mpp_done_4'],
    fn: (a, b, c, d) => { const seen = new Set(); return [].concat(a, b, c, d).filter((r) => (seen.has(r.job) ? false : seen.add(r.job))); }
  });
  dash.calc('mppInv', {
    title: 'Jobber invoices issued in 2026',
    description: 'All Jobber invoices issued this year (up to 200).',
    inputs: ['mpp_inv_1', 'mpp_inv_2', 'mpp_inv_3', 'mpp_inv_4'],
    fn: (a, b, c, d) => { const seen = new Set(); return [].concat(a, b, c, d).filter((r) => (seen.has(r.inv) ? false : seen.add(r.inv))); }
  });
  dash.calc('mppMonthly', {
    title: 'Motion Property Preservation by month',
    description: 'Per month: Jobber jobs completed, median days from job creation to completion, share closed within 7 days, amount invoiced and collected (by invoice month), and QuickBooks MPP income, labor and supplies (MPP accounts start in October 2026).',
    inputs: ['mppJobs', 'mppInv', 'qb_lines'],
    fn: (jobs, inv, qb) => {
      const q = (line, m) => { const r = qb.find((x) => x.LINE === line && +x.MONTH === m); return r ? +r.AMOUNT : null; };
      const out = [];
      for (let m = 1; m <= today.getMonth() + 1; m++) {
        const key = '2026-' + String(m).padStart(2, '0');
        const js = jobs.filter((j) => j.completed && j.completed.startsWith(key));
        const iv = inv.filter((i) => i.issued && i.issued.startsWith(key));
        const cd = js.map((j) => j.closeDays).filter((v) => v !== null);
        const inc = q('MPP Income', m), lab = q('MPP Labor', m), sup = q('MPP Supplies', m);
        if (!js.length && !iv.length && inc === null) continue;
        out.push({ month: m, label: MONTHS[m - 1] + ' 2026', jobs: js.length, medianClose: cd.length ? d3.median(cd) : null,
          within7: cd.length ? cd.filter((v) => v <= 7).length / cd.length : null,
          invoiced: d3.sum(iv, (i) => i.total), collected: d3.sum(iv, (i) => i.paid),
          income: inc, labor: lab, supplies: sup,
          margin: inc ? (inc - (lab || 0) - (sup || 0)) / inc : null });
      }
      return out;
    }
  });
  dash.calc('mppSum', {
    title: 'Motion Property Preservation headline figures',
    description: 'Last 30 days of completed jobs and close time, open jobs, jobs needing an invoice, and unpaid and past-due invoice balances.',
    inputs: ['mppJobs', 'mppInv', 'mpp_open', 'mpp_reqinv'],
    fn: (jobs, inv, open, req) => {
      const since = new Date(today - 30 * DAY).toISOString().slice(0, 10);
      const recent = jobs.filter((j) => j.completed && j.completed >= since);
      const cd = recent.map((j) => j.closeDays).filter((v) => v !== null);
      const unpaid = inv.filter((i) => i.balance > 0);
      const t = today.toISOString().slice(0, 10);
      const pastDue = unpaid.filter((i) => i.due && i.due < t);
      return [{ done30: recent.length, median30: cd.length ? d3.median(cd) : null, within7: cd.length ? cd.filter((v) => v <= 7).length / cd.length : null,
        open: open.length, open14: open.filter((j) => j.ageDays > 14).length, reqinv: req.length,
        unpaidN: unpaid.length, unpaidAmt: d3.sum(unpaid, (i) => i.balance), pastDueN: pastDue.length, pastDueAmt: d3.sum(pastDue, (i) => i.balance),
        totalJobs: jobs.length, totalInv: inv.length }];
    }
  });

  const one = (id) => { const r = rowsOf(id); return r && r[0] ? r[0] : null; };
  const tile = (name, src, f) => dash.draw(name, (el) => { const s = one(src); el.textContent = s ? f(s) : '—'; });
  tile('mDone', 'mppSum', (s) => String(s.done30));
  tile('mMedian', 'mppSum', (s) => days(s.median30));
  tile('mWithin7', 'mppSum', (s) => (s.within7 === null ? '—' : d3.format('.0%')(s.within7) + ' closed within 7 days'));
  tile('mOpen', 'mppSum', (s) => String(s.open));
  tile('mOpen14', 'mppSum', (s) => s.open14 + ' open more than 14 days');
  tile('mReqInv', 'mppSum', (s) => String(s.reqinv));
  tile('mUnpaid', 'mppSum', (s) => usd0(s.unpaidAmt));
  tile('mUnpaidN', 'mppSum', (s) => s.unpaidN + ' invoices; ' + s.pastDueN + ' past due (' + usd0(s.pastDueAmt) + ')');

  dash.draw('mppMonthRows', (tb) => {
    const t = rowsOf('mppMonthly'); tb.replaceChildren(); if (!t) return;
    t.slice().reverse().forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', String(r.month));
      td(tr, r.label); td(tr, r.jobs, 'mp-num'); td(tr, days(r.medianClose), 'mp-num'); td(tr, r.within7 === null ? '—' : d3.format('.0%')(r.within7), 'mp-num');
      td(tr, usd0(r.invoiced), 'mp-num'); td(tr, usd0(r.collected), 'mp-num');
      td(tr, usd0(r.income), 'mp-num'); td(tr, usd0(r.labor), 'mp-num'); td(tr, usd0(r.supplies), 'mp-num'); td(tr, r.margin === null ? '—' : d3.format('.0%')(r.margin), 'mp-num');
      tb.appendChild(tr);
    });
  });
  const linkCell = (tr, text, url) => { const c = td(tr, ''); if (url) { const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = text; c.appendChild(a); } else c.textContent = text; };
  dash.draw('mppOpenRows', (tb) => {
    const t = rowsOf('mpp_open'); tb.replaceChildren(); if (!t) return;
    t.slice().sort((a, b) => (b.ageDays || 0) - (a.ageDays || 0)).forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.job);
      linkCell(tr, '#' + r.job, r.url); td(tr, r.title); td(tr, r.address); td(tr, r.created); const a = td(tr, d3.format('.0f')(r.ageDays), 'mp-num'); if (r.ageDays > 14) a.style.color = 'var(--color-bad)';
      tb.appendChild(tr);
    });
  });
  dash.draw('mppReqRows', (tb) => {
    const t = rowsOf('mpp_reqinv'); tb.replaceChildren(); if (!t) return;
    if (!t.length) { const tr = document.createElement('tr'); td(tr, 'Every finished job has been invoiced.'); tb.appendChild(tr); return; }
    t.forEach((r) => { const tr = document.createElement('tr'); tr.setAttribute('data-key', r.job); linkCell(tr, '#' + r.job, r.url); td(tr, r.title); td(tr, r.address); td(tr, r.completed || ''); td(tr, usd(r.total), 'mp-num'); tb.appendChild(tr); });
  });

  // ---------- Motion Realty ----------
  dash.calc('mrMonthly', {
    title: 'Motion Realty by month (QuickBooks)',
    description: 'Brokerage Services income and Commissions & fees paid, by month, from the QuickBooks P&L.',
    inputs: ['qb_lines'],
    fn: (qb) => d3.range(1, today.getMonth() + 2).map((m) => {
      const g = (l) => { const r = qb.find((x) => x.LINE === l && +x.MONTH === m); return r ? +r.AMOUNT : 0; };
      return { month: m, label: MONTHS[m - 1] + ' 2026', income: g('Brokerage Services'), commissions: g('Commissions & fees') };
    }).filter((r) => r.income || r.commissions)
  });
  dash.calc('mrYtdSum', { title: 'Motion Realty year to date', description: 'Brokerage income and commissions so far in 2026.', inputs: ['mrMonthly'], fn: (t) => [{ income: d3.sum(t, (r) => r.income), commissions: d3.sum(t, (r) => r.commissions) }] });
  dash.draw('mrRows', (tb) => {
    const t = rowsOf('mrMonthly'); tb.replaceChildren(); if (!t) return;
    if (!t.length) { const tr = document.createElement('tr'); td(tr, 'No brokerage income or commissions recorded in 2026.'); tb.appendChild(tr); return; }
    t.forEach((r) => { const tr = document.createElement('tr'); tr.setAttribute('data-key', String(r.month)); td(tr, r.label); td(tr, usd(r.income), 'mp-num'); td(tr, usd(r.commissions), 'mp-num'); td(tr, usd(r.income - r.commissions), 'mp-num'); tb.appendChild(tr); });
  });
  tile('mrYtd', 'mrYtdSum', (s) => usd0(s.income));
  tile('mrYtdNet', 'mrYtdSum', (s) => usd0(s.income - s.commissions) + ' after commissions');

  // ---------- Fort Valley balances ----------
  const fview = { v: 'all' };
  document.querySelectorAll('[data-fview]').forEach((b) => b.addEventListener('click', () => {
    fview.v = b.getAttribute('data-fview');
    document.querySelectorAll('[data-fview]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    dash.draw('ftvRows');
  }));
  const neverPaid = (r) => !r.LAST_PAYMENT_DATE && r.STATUS === 'Current';
  dash.calc('ftvSum', {
    title: 'Fort Valley balances owed',
    description: 'Total owed by Fort Valley tenants, how much is from current tenants who have never paid, tenants in eviction, past tenants, and balances over 90 days.',
    inputs: ['ftv_balances'],
    fn: (r) => {
      const s = (f) => d3.sum(r.filter(f), (x) => +x.BALANCE);
      return [{ total: s(() => true), n: r.length, never: s(neverPaid), neverN: r.filter(neverPaid).length,
        evict: s((x) => x.STATUS === 'Evict'), evictN: r.filter((x) => x.STATUS === 'Evict').length,
        past: s((x) => x.STATUS === 'Past'), pastN: r.filter((x) => x.STATUS === 'Past').length,
        over90: d3.sum(r, (x) => +x.D90_PLUS) }];
    }
  });
  tile('fTotal', 'ftvSum', (s) => usd0(s.total));
  tile('fTotalN', 'ftvSum', (s) => s.n + ' tenants; ' + usd0(s.over90) + ' over 90 days');
  tile('fNever', 'ftvSum', (s) => usd0(s.never));
  tile('fNeverN', 'ftvSum', (s) => s.neverN + ' current tenants with no payment at all');
  tile('fEvict', 'ftvSum', (s) => usd0(s.evict));
  tile('fEvictN', 'ftvSum', (s) => s.evictN + ' tenants in eviction');
  tile('fPast', 'ftvSum', (s) => usd0(s.past));
  tile('fPastN', 'ftvSum', (s) => s.pastN + ' moved-out tenants');
  dash.draw('ftvRows', (tb) => {
    const t = rowsOf('ftv_balances'); tb.replaceChildren(); if (!t) return;
    const f = { all: () => true, never: neverPaid, evict: (x) => x.STATUS === 'Evict', past: (x) => x.STATUS === 'Past', camellia: (x) => /Camellia/.test(x.PROPERTY) }[fview.v] || (() => true);
    t.filter(f).slice().sort((a, b) => +b.BALANCE - +a.BALANCE).forEach((r, i) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.TENANT + '|' + r.UNIT + '|' + i);
      td(tr, r.PROPERTY); td(tr, r.UNIT); td(tr, r.TENANT); td(tr, r.STATUS); td(tr, usd(r.BALANCE), 'mp-num');
      td(tr, usd(r.D0_30), 'mp-num'); td(tr, usd(r.D31_60), 'mp-num'); td(tr, usd(r.D61_90), 'mp-num'); const o = td(tr, usd(r.D90_PLUS), 'mp-num'); if (+r.D90_PLUS > 0) o.style.color = 'var(--color-bad)';
      td(tr, r.LAST_PAYMENT_DATE ? r.LAST_PAYMENT_DATE + ' (' + usd(r.LAST_PAYMENT_AMT) + ')' : 'Never'); td(tr, r.NOTE || '');
      tb.appendChild(tr);
    });
  });

  // ---------- Utilities to review ----------
  const uview = { p: 'all' };
  document.querySelectorAll('[data-uview]').forEach((b) => b.addEventListener('click', () => {
    uview.p = b.getAttribute('data-uview');
    document.querySelectorAll('[data-uview]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    dash.draw('utilRows');
  }));
  dash.calc('utilSum', {
    title: 'Utilities to review, by priority',
    description: 'Count and total of Ramp utility payments still needing a reimbursement check, by priority.',
    inputs: ['util_review'],
    fn: (rows) => Array.from(d3.rollup(rows, (v) => ({ n: v.length, amt: d3.sum(v, (r) => +r.AMOUNT) }), (r) => r.PRIORITY), ([p, s]) => ({ p, n: s.n, amt: Math.round(s.amt * 100) / 100 })).sort((a, b) => d3.ascending(a.p, b.p))
  });
  const pr = (p) => { const t = rowsOf('utilSum'); return t ? t.find((r) => r.p === p) || { n: 0, amt: 0 } : null; };
  [['uHigh', '1 High'], ['uMed', '2 Medium'], ['uCheck', '3 Check'], ['uCoding', '5 Coding']].forEach(([n, p]) => {
    dash.draw(n, (el) => { const s = pr(p); el.textContent = s ? usd0(s.amt) : '—'; });
    dash.draw(n + 'N', (el) => { const s = pr(p); el.textContent = s ? s.n + ' payments' : '—'; });
  });
  dash.draw('utilRows', (tb) => {
    const t = rowsOf('util_review'); tb.replaceChildren(); if (!t) return;
    const f = uview.p === 'all' ? t.filter((r) => r.PRIORITY !== '4 Low') : t.filter((r) => r.PRIORITY.startsWith(uview.p));
    f.forEach((r, i) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.DATE + '|' + r.AMOUNT + '|' + i);
      const p = td(tr, ''); const pill = document.createElement('span'); pill.className = 'mp-pill ' + (r.PRIORITY.startsWith('1') ? 'mp-bad' : r.PRIORITY.startsWith('2') || r.PRIORITY.startsWith('5') ? 'mp-warn' : ''); pill.textContent = r.PRIORITY.replace(/^\d\s/, ''); p.appendChild(pill);
      td(tr, r.DATE); td(tr, r.VENDOR); td(tr, r.PROPERTY || '—'); td(tr, r.MARKET); td(tr, usd(r.AMOUNT), 'mp-num'); td(tr, r.MEMO || '(no memo)'); td(tr, r.SPENDER); td(tr, r.REASON);
      tb.appendChild(tr);
    });
  });
  dash.draw('qbUtilRows', (tb) => {
    const qb = rowsOf('qb_lines'); tb.replaceChildren(); if (!qb) return;
    d3.range(1, today.getMonth() + 2).forEach((m) => {
      const g = (l) => { const r = qb.find((x) => x.LINE === l && +x.MONTH === m); return r ? +r.AMOUNT : null; };
      const paid = g('Owner Utilities Paid'), re = g('Owner Utilities Reimbursement');
      if (paid === null && re === null) return;
      const tr = document.createElement('tr'); tr.setAttribute('data-key', String(m));
      td(tr, MONTHS[m - 1] + ' 2026'); td(tr, usd0(paid), 'mp-num'); td(tr, re === null ? 'not booked' : usd0(re), 'mp-num');
      const gap = paid !== null && re !== null ? paid - re : null; const c = td(tr, gap === null ? '—' : usd0(gap), 'mp-num'); if (gap > 0) c.style.color = 'var(--color-bad)';
      tb.appendChild(tr);
    });
  });
})();
