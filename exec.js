// Executive tab: cash, a 13-week cash projection and the profit & loss trend. Only people listed in
// public.exec_viewers can see it: the tab is hidden for everyone else, and the data (public.exec_data) is
// locked in the database so other signed-in staff get nothing even if they look for it.
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (v) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + d3.format(',.0f')(Math.abs(v)));
  const state = { data: null, basis: 'normal', at: null };
  const rows = (id) => (state.data && state.data[id]) || [];
  const ord = (n) => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th');
  const MON = (m) => d3.timeFormat('%b %Y')(new Date(m + '-15T12:00:00'));

  const load = async () => {
    const sb = window.mpSupabase; if (!sb) return;
    const ok = await sb.rpc('is_exec');
    if (ok.error || ok.data !== true) return; // not an executive: leave the tab hidden
    const tab = document.querySelector('[data-tab="exec"]'); if (tab) tab.hidden = false;
    const r = await sb.from('exec_data').select('id,rows,updated_at');
    if (r.error) { $('exNote').textContent = 'Could not load: ' + r.error.message; return; }
    state.data = Object.fromEntries(r.data.map((x) => [x.id, x.rows]));
    state.at = d3.max(r.data, (x) => new Date(x.updated_at));
    render();
  };

  // Run rate from the last N complete months of the P&L (cash in = income + other income; cash out = COGS + expenses + other).
  // Known adjustments (exec_data 'adjust'): loan repayments that QuickBooks does not count as expenses,
  // and one-time months to leave out of the "normal months" average.
  const excluded = () => new Set(rows('adjust').filter((a) => a.KIND === 'exclude').flatMap((a) => a.MONTHS || []));
  const loanFor = (ym) => d3.sum(rows('adjust').filter((a) => a.KIND === 'loan'), (a) => {
    const [y0, m0] = a.START.split('-').map(Number), [y, m] = ym.split('-').map(Number), k = (y - y0) * 12 + (m - m0);
    return k >= 0 && k < a.MONTHS ? a.AMOUNT : 0;
  });
  const runRate = (n) => {
    const all = rows('pl_month').filter((m) => !m.PARTIAL);
    const full = n === 'normal' ? all.filter((m) => !excluded().has(m.MONTH)).slice(-6) : all.slice(-n);
    if (!full.length) return null;
    const inc = d3.mean(full, (m) => m.INCOME + (m.OTHER_INC || 0)), out = d3.mean(full, (m) => m.COGS + m.EXPENSES + (m.OTHER_EXP || 0));
    return { months: full, inc, out, net: inc - out };
  };

  const render = () => {
    if (!state.data) return;
    const cash = rows('cash'), op = d3.sum(cash.filter((c) => c.KIND === 'operating'), (c) => c.BALANCE), held = d3.sum(cash.filter((c) => c.KIND === 'escrow' || c.KIND === 'property'), (c) => c.BALANCE);
    const rr = runRate(state.basis), weekly = rr ? rr.net * 12 / 52 : 0;
    // Each week: the run rate plus that week's share of any loan payment due in its month.
    const today = new Date();
    let c = op;
    const proj = [{ w: 0, cash: op }];
    // Loan payments land on their due day (e.g. the 23rd) in the week they fall.
    const dueIn = (a, b) => d3.sum(rows('adjust').filter((x) => x.KIND === 'loan'), (x) => d3.timeDays(a, b).filter((d) => d.getDate() === (x.DAY || 1)).reduce((t, d) => t + (loanFor(d3.timeFormat('%Y-%m')(d)) ? x.AMOUNT : 0), 0));
    d3.range(1, 14).forEach((w) => { const a = d3.timeDay.offset(today, 7 * (w - 1) + 1), b = d3.timeDay.offset(today, 7 * w + 1); c += weekly + dueIn(a, b); proj.push({ w, cash: c }); });
    const low = d3.min(proj, (p) => p.cash), end = proj[13].cash;
    const loanNow = loanFor(d3.timeFormat('%Y-%m')(today)), monthly = (rr ? rr.net : 0) + loanNow;
    const runway = monthly < 0 ? op / -monthly : null;
    $('exCash').textContent = money(op);
    $('exCashN').textContent = 'Motion PMG Operating only. Held for owners and tenants (property operating accounts and deposit escrow, not counted): ' + money(held) + '.';
    $('exNet').textContent = money(monthly) + ' / mo';
    $('exNetN').textContent = 'Average of ' + (rr ? rr.months.map((m) => MON(m.MONTH).slice(0, 3)).join(', ') : '—') + ': ' + money(rr && rr.inc) + ' in, ' + money(rr && rr.out) + ' out' +
      (loanNow ? ', plus loan payment ' + money(loanNow) : '') + '.';
    $('exEnd').textContent = money(end);
    $('exEndN').textContent = (state.basis === 'normal' ? 'If normal months repeat' : 'If the last ' + state.basis + ' months repeat') + ', after loan payments. Lowest point ' + money(low) + '.';
    $('exRun').textContent = runway === null ? 'Cash growing' : runway >= 24 ? '24+ months' : d3.format('.1f')(runway) + ' months';
    $('exRunN').textContent = runway === null ? 'An average month adds cash, even after the loan payment.' : 'Company cash ÷ average monthly shortfall (including the loan payment).';
    const adj = rows('adjust'); $('exAdj').innerHTML = adj.length ? 'Built into the projection: ' + adj.map((a) => a.KIND === 'loan' ? a.LABEL + ' ' + d3.format('$,.2f')(-a.AMOUNT) + ' on the ' + ord(a.DAY || 1) + ' of each month, ' + MON(a.START) + ' to ' + MON(d3.timeFormat('%Y-%m')(d3.timeMonth.offset(new Date(a.START + '-15T12:00:00'), a.MONTHS - 1))) : a.LABEL + ': ' + a.MONTHS.map((m) => MON(m).slice(0, 3)).join(', ') + ' left out of "Normal months"').join('; ') + '.' : '';
    ['exRun'].forEach((id) => { $(id).style.color = runway !== null && runway < 6 ? 'var(--color-bad)' : ''; });
    $('exEnd').style.color = end < op ? 'var(--color-bad)' : 'var(--color-ok)';
    // Cash accounts table
    $('exCashRows').innerHTML = cash.filter((c) => c.BALANCE || c.KIND === 'operating').map((c) => '<tr><td>' + c.ACCOUNT + '</td><td>' + ({ operating: 'Company cash (counted)', property: 'Property operating (owner funds, not counted)', escrow: 'Deposit escrow (not counted)', other: 'Other company (not counted)', card: 'Credit card' }[c.KIND] || c.KIND) + '</td><td class="mp-num">' + money(c.BALANCE) + '</td></tr>').join('');
    drawProj(proj);
    drawPL();
    renderAccts();
    // P&L table
    const pm = rows('pl_month');
    $('exPLRows').innerHTML = pm.slice().reverse().map((m) => '<tr><td>' + MON(m.MONTH) + (m.PARTIAL ? ' (' + m.PARTIAL + ')' : '') + '</td><td class="mp-num">' + money(m.INCOME) + '</td><td class="mp-num">' + money(m.COGS) + '</td><td class="mp-num">' + money(m.EXPENSES + (m.OTHER_EXP || 0) - (m.OTHER_INC || 0)) +
      '</td><td class="mp-num" style="color:' + (m.NET < 0 ? 'var(--color-bad)' : 'var(--color-ok)') + '">' + money(m.NET) + '</td><td class="mp-num">' + (m.INCOME ? d3.format('.1%')(m.NET / m.INCOME) : '—') + '</td></tr>').join('');
    const tot = { inc: d3.sum(pm, (m) => m.INCOME), net: d3.sum(pm, (m) => m.NET) };
    $('exPLSum').textContent = 'Last 12½ months: ' + money(tot.inc) + ' income, ' + money(tot.net) + ' net (' + d3.format('.1%')(tot.net / tot.inc) + ' margin). ' + pm.filter((m) => m.NET < 0).length + ' of ' + pm.length + ' months lost money.';
    const lines = rows('pl_lines');
    const tbl = (sec) => lines.filter((l) => sec.includes(l.SECTION)).sort((a, b) => b.AMOUNT - a.AMOUNT).slice(0, 10).map((l) => '<tr><td>' + l.LINE + '</td><td class="mp-num">' + money(l.AMOUNT) + '</td></tr>').join('');
    $('exInRows').innerHTML = tbl(['Income']); $('exOutRows').innerHTML = tbl(['Cost of goods sold', 'Expenses', 'Other expenses']);
    const meta = rows('meta')[0] || {};
    $('exNote').textContent = 'Only you can see this tab. Cash from Ramp, profit & loss from QuickBooks (' + (meta.PL_PERIOD || '') + '), refreshed each morning' + (state.at ? '; last ' + d3.timeFormat('%b %-d, %-I:%M %p')(state.at) : '') + '. ' + (meta.NOTES || '');
  };


  // Runway by account, from Ramp daily balances (exec_data 'acct_daily': ACCOUNT, DATE, BAL).
  // Property accounts cycle every month (rent in early, owner payouts mid-month), so the trend uses each
  // month's average balance; the lowest balance shows how close the account came to zero.
  const ACCTS = ['Motion PMG Operating', 'Georgia Operating', 'Tennessee Operating', 'North Carolina Operating'];
  const renderAccts = () => {
    const tb = $('exAcctRows'); if (!tb) return;
    const daily = rows('acct_daily');
    if (!daily.length) { tb.innerHTML = '<tr><td colspan="7">Balance history loads with the next morning refresh.</td></tr>'; $('exAcctSpark').replaceChildren(); return; }
    const byAcct = d3.group(daily, (r) => r.ACCOUNT);
    const out = ACCTS.filter((a) => byAcct.has(a)).map((a) => {
      const pts = byAcct.get(a).map((r) => ({ d: new Date(r.DATE + 'T12:00:00'), v: +r.BAL })).sort((x, y) => x.d - y.d);
      const last = pts[pts.length - 1], now = last.d;
      // 30-day windows back from today: average balance in each.
      const win = (k) => pts.filter((p) => p.d > d3.timeDay.offset(now, -30 * (k + 1)) && p.d <= d3.timeDay.offset(now, -30 * k));
      const avgs = d3.range(0, 6).map((k) => d3.mean(win(k), (p) => p.v)).filter((v) => v !== undefined).reverse(); // oldest..newest
      const trend = avgs.length >= 4 ? (avgs[avgs.length - 1] - avgs[avgs.length - 4]) / 3 : null; // per month, last 3 months
      const low30 = d3.min(win(0), (p) => p.v), low90 = d3.min(pts.filter((p) => p.d > d3.timeDay.offset(now, -90)), (p) => p.v);
      const runway = trend !== null && trend < 0 ? avgs[avgs.length - 1] / -trend : null;
      return { a, cur: last.v, avg: avgs[avgs.length - 1], trend, low30, low90, runway, avgs, pts };
    });
    const rw = (r) => (r.trend === null ? 'Not enough history' : r.runway === null ? 'Not declining' : r.runway >= 24 ? '24+ months' : d3.format('.1f')(r.runway) + ' months');
    tb.innerHTML = out.map((r) => '<tr><td>' + r.a + (r.a === 'Motion PMG Operating' ? ' <span class="mp-meta">(company cash)</span>' : '') + '</td><td class="mp-num">' + money(r.cur) + '</td><td class="mp-num">' + money(r.avg) +
      '</td><td class="mp-num" style="color:' + (r.trend < 0 ? 'var(--color-bad)' : 'var(--color-ok)') + '">' + (r.trend === null ? '—' : (r.trend >= 0 ? '+' : '') + money(r.trend) + ' / mo') +
      '</td><td class="mp-num"' + (r.low30 < 5000 ? ' style="color:var(--color-bad)"' : '') + '>' + money(r.low30) + '</td><td class="mp-num"' + (r.low90 < 5000 ? ' style="color:var(--color-bad)"' : '') + '>' + money(r.low90) +
      '</td><td class="mp-num"' + (r.runway !== null && r.runway < 6 ? ' style="color:var(--color-bad);font-weight:600"' : '') + '>' + rw(r) + '</td></tr>').join('');
    // Small multiples: daily balance, last 6 months.
    const box = $('exAcctSpark'); box.replaceChildren();
    out.forEach((r) => {
      const card = document.createElement('div'); card.className = 'mp-exspark'; box.appendChild(card);
      const h = document.createElement('div'); h.className = 'mp-meta'; h.textContent = r.a; card.appendChild(h);
      const W = 280, H = 80, m = { t: 4, r: 4, b: 14, l: 4 };
      const x = d3.scaleTime().domain(d3.extent(r.pts, (p) => p.d)).range([m.l, W - m.r]);
      const y = d3.scaleLinear().domain([Math.min(0, d3.min(r.pts, (p) => p.v)), d3.max(r.pts, (p) => p.v)]).nice().range([H - m.b, m.t]);
      const svg = d3.select(card).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', r.a + ' daily balance, last 6 months');
      svg.append('path').datum(r.pts).attr('fill', 'var(--color-accent, #d4af37)').attr('opacity', 0.18).attr('d', d3.area().x((p) => x(p.d)).y0(y(0)).y1((p) => y(p.v)));
      svg.append('path').datum(r.pts).attr('fill', 'none').attr('stroke', 'var(--color-accent, #d4af37)').attr('stroke-width', 1.5).attr('d', d3.line().x((p) => x(p.d)).y((p) => y(p.v)));
      svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(6).tickSize(0).tickFormat(d3.timeFormat('%b'))).call((g) => g.select('.domain').remove());
    });
  };

  const drawProj = (proj) => {
    const el = $('exProj'); el.replaceChildren();
    const W = Math.max(300, el.clientWidth || 600), H = 220, m = { t: 12, r: 16, b: 26, l: 64 };
    const x = d3.scaleLinear().domain([0, 13]).range([m.l, W - m.r]);
    const y = d3.scaleLinear().domain([Math.min(0, d3.min(proj, (p) => p.cash)), d3.max(proj, (p) => p.cash) * 1.1]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Projected operating cash for the next 13 weeks');
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).ticks(13).tickFormat((d) => (d === 0 ? 'Now' : 'W' + d)));
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format('$,.0s')(v)));
    if (y.domain()[0] < 0) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(0)).attr('y2', y(0)).attr('stroke', 'var(--color-bad)').attr('stroke-dasharray', '4 3');
    svg.append('path').datum(proj).attr('fill', 'none').attr('stroke', 'var(--color-accent, #d4af37)').attr('stroke-width', 2.5).attr('d', d3.line().x((p) => x(p.w)).y((p) => y(p.cash)));
    svg.selectAll('circle').data(proj).join('circle').attr('cx', (p) => x(p.w)).attr('cy', (p) => y(p.cash)).attr('r', 3).attr('fill', 'var(--color-accent, #d4af37)').append('title').text((p) => (p.w ? 'Week ' + p.w : 'Now') + ': ' + money(p.cash));
  };

  const drawPL = () => {
    const el = $('exPL'); el.replaceChildren();
    const pm = rows('pl_month'); if (!pm.length) return;
    const W = Math.max(300, el.clientWidth || 600), H = 240, m = { t: 12, r: 16, b: 26, l: 64 };
    const x = d3.scaleBand().domain(pm.map((p) => p.MONTH)).range([m.l, W - m.r]).padding(0.25);
    const hi = d3.max(pm, (p) => Math.max(p.INCOME, p.COGS + p.EXPENSES + (p.OTHER_EXP || 0))), lo = d3.min(pm, (p) => Math.min(0, p.NET));
    const y = d3.scaleLinear().domain([lo * 1.1, hi * 1.08]).nice().range([H - m.b, m.t]);
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img').attr('aria-label', 'Income, costs and net income by month');
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickFormat((d) => d3.timeFormat('%b')(new Date(d + '-15T12:00:00'))));
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickFormat((v) => d3.format('$,.0s')(v)));
    const bw = x.bandwidth() / 2;
    svg.selectAll('.inc').data(pm).join('rect').attr('x', (p) => x(p.MONTH)).attr('width', bw).attr('y', (p) => y(p.INCOME)).attr('height', (p) => y(0) - y(p.INCOME)).attr('fill', 'var(--color-ok)').attr('opacity', 0.75).append('title').text((p) => MON(p.MONTH) + ' income ' + money(p.INCOME));
    svg.selectAll('.out').data(pm).join('rect').attr('x', (p) => x(p.MONTH) + bw).attr('width', bw).attr('y', (p) => y(p.COGS + p.EXPENSES + (p.OTHER_EXP || 0))).attr('height', (p) => y(0) - y(p.COGS + p.EXPENSES + (p.OTHER_EXP || 0))).attr('fill', 'var(--color-bad)').attr('opacity', 0.6).append('title').text((p) => MON(p.MONTH) + ' costs ' + money(p.COGS + p.EXPENSES + (p.OTHER_EXP || 0)));
    svg.append('path').datum(pm).attr('fill', 'none').attr('stroke', 'var(--color-accent, #d4af37)').attr('stroke-width', 2.5).attr('d', d3.line().x((p) => x(p.MONTH) + x.bandwidth() / 2).y((p) => y(p.NET)));
    svg.selectAll('.net').data(pm).join('circle').attr('cx', (p) => x(p.MONTH) + x.bandwidth() / 2).attr('cy', (p) => y(p.NET)).attr('r', 3.5).attr('fill', (p) => (p.NET < 0 ? 'var(--color-bad)' : 'var(--color-ok)')).append('title').text((p) => MON(p.MONTH) + ' net ' + money(p.NET));
  };

  document.querySelectorAll('[data-exbasis]').forEach((b) => b.addEventListener('click', () => {
    state.basis = b.getAttribute('data-exbasis') === 'normal' ? 'normal' : +b.getAttribute('data-exbasis');
    document.querySelectorAll('[data-exbasis]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    render();
  }));
  window.addEventListener('mp-tab', (e) => { if (e.detail === 'exec') setTimeout(render, 30); });
  window.mpExec = { load };
})();
