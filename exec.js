// Executive tab: cash, a 13-week cash projection and the profit & loss trend. Only people listed in
// public.exec_viewers can see it: the tab is hidden for everyone else, and the data (public.exec_data) is
// locked in the database so other signed-in staff get nothing even if they look for it.
(function () {
  const $ = (id) => document.getElementById(id);
  const money = (v) => (v == null || !isFinite(v) ? '—' : (v < 0 ? '-$' : '$') + d3.format(',.0f')(Math.abs(v)));
  const state = { data: null, basis: 3, at: null };
  const rows = (id) => (state.data && state.data[id]) || [];
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
  const runRate = (n) => {
    const full = rows('pl_month').filter((m) => !m.PARTIAL).slice(-n);
    if (!full.length) return null;
    const inc = d3.mean(full, (m) => m.INCOME + (m.OTHER_INC || 0)), out = d3.mean(full, (m) => m.COGS + m.EXPENSES + (m.OTHER_EXP || 0));
    return { months: full, inc, out, net: inc - out };
  };

  const render = () => {
    if (!state.data) return;
    const cash = rows('cash'), op = d3.sum(cash.filter((c) => c.KIND === 'operating'), (c) => c.BALANCE), esc = d3.sum(cash.filter((c) => c.KIND === 'escrow'), (c) => c.BALANCE);
    const rr = runRate(state.basis), weekly = rr ? rr.net * 12 / 52 : 0;
    const proj = d3.range(0, 14).map((w) => ({ w, cash: op + weekly * w }));
    const low = d3.min(proj, (p) => p.cash), end = proj[13].cash;
    const runway = weekly < 0 ? op / (-rr.net) : null;
    $('exCash').textContent = money(op);
    $('exCashN').textContent = 'Ramp operating accounts. Escrow (tenant deposits, not ours to spend): ' + money(esc) + '.';
    $('exNet').textContent = money(rr && rr.net) + ' / mo';
    $('exNetN').textContent = 'Average of ' + (rr ? rr.months.map((m) => MON(m.MONTH).slice(0, 3)).join(', ') : '—') + ': ' + money(rr && rr.inc) + ' in, ' + money(rr && rr.out) + ' out.';
    $('exEnd').textContent = money(end);
    $('exEndN').textContent = 'If the last ' + state.basis + ' months repeat. Lowest point ' + money(low) + '.';
    $('exRun').textContent = runway === null ? 'Cash growing' : runway >= 24 ? '24+ months' : d3.format('.1f')(runway) + ' months';
    $('exRunN').textContent = runway === null ? 'Average month is profitable, so cash is not being used up.' : 'Operating cash ÷ average monthly loss.';
    ['exRun'].forEach((id) => { $(id).style.color = runway !== null && runway < 6 ? 'var(--color-bad)' : ''; });
    $('exEnd').style.color = end < op ? 'var(--color-bad)' : 'var(--color-ok)';
    // Cash accounts table
    $('exCashRows').innerHTML = cash.filter((c) => c.BALANCE || c.KIND === 'operating').map((c) => '<tr><td>' + c.ACCOUNT + '</td><td>' + ({ operating: 'Operating', escrow: 'Escrow (held for others)', card: 'Credit card' }[c.KIND] || c.KIND) + '</td><td class="mp-num">' + money(c.BALANCE) + '</td></tr>').join('');
    drawProj(proj);
    drawPL();
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
    state.basis = +b.getAttribute('data-exbasis');
    document.querySelectorAll('[data-exbasis]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    render();
  }));
  window.addEventListener('mp-tab', (e) => { if (e.detail === 'exec') setTimeout(render, 30); });
  window.mpExec = { load };
})();
