(function () {
  const usd = (v) => (v === null || v === undefined || v === '' || !isFinite(+v) ? '—' : d3.format('$,.2f')(+v));
  const usd0 = (v) => d3.format('$,.0f')(v);
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const view = { r: 'gap' };

  dash.calc('rampSum', {
    title: 'Ramp bill-back summary',
    description: 'Totals of 2026 Ramp utility and materials spend by bill-back status.',
    inputs: ['ramp_util', 'ramp_mat', 'ramp_util_props'],
    fn: (u, m, p) => {
      const sum = (rows, f) => d3.sum(rows.filter(f), (r) => +r.AMOUNT);
      const cnt = (rows, f) => rows.filter(f).length;
      const gapProps = p.filter((r) => +r.GAP > 5);
      return [{
        utilTotal: sum(u, () => true), utilN: u.length,
        utilOk: sum(u, (r) => r.STATUS === 'Billed back' || r.STATUS === 'Covered at property level'),
        utilGap: d3.sum(gapProps, (r) => +r.GAP), utilGapProps: gapProps.length,
        utilNoProp: sum(u, (r) => r.STATUS === 'No property in memo'), utilNoPropN: cnt(u, (r) => r.STATUS === 'No property in memo'),
        matTotal: sum(m, () => true), matN: m.length,
        matNoProp: sum(m, (r) => r.STATUS === 'No property in memo'), matNoPropN: cnt(m, (r) => r.STATUS === 'No property in memo'),
        matNoBill: sum(m, (r) => r.STATUS.startsWith('No Motion bill')), matNoBillN: cnt(m, (r) => r.STATUS.startsWith('No Motion bill'))
      }];
    }
  });

  const one = () => { const d = dash.data('rampSum'); return d.status === 'ok' && d.data[0] ? d.data[0] : null; };
  const tile = (name, f) => dash.draw(name, (el) => { const s = one(); el.textContent = s ? f(s) : '—'; });
  tile('rUtilTotal', (s) => usd0(s.utilTotal));
  tile('rUtilTotalN', (s) => s.utilN + ' payments; ' + usd0(s.utilOk) + ' matched to a bill-back');
  tile('rUtilGap', (s) => usd0(s.utilGap));
  tile('rUtilGapN', (s) => 'across ' + s.utilGapProps + ' properties');
  tile('rUtilNoProp', (s) => usd0(s.utilNoProp));
  tile('rUtilNoPropN', (s) => s.utilNoPropN + ' payments');
  tile('rMatTotal', (s) => usd0(s.matTotal));
  tile('rMatNoProp', (s) => usd0(s.matNoProp) + ' (' + s.matNoPropN + ' purchases) name no property');
  tile('rMatNoBill', (s) => usd0(s.matNoBill));
  tile('rMatNoBillN', (s) => s.matNoBillN + ' purchases');

  document.querySelectorAll('[data-rview]').forEach((b) => b.addEventListener('click', () => {
    view.r = b.getAttribute('data-rview');
    document.querySelectorAll('[data-rview]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    dash.draw('rampRows'); dash.draw('rampHead');
  }));

  const COLS = {
    gap: ['Property', 'Market', 'Paid in Ramp', 'Billed back in AppFolio', 'Gap'],
    unbilled: ['Date', 'Utility', 'Property', 'Amount', 'Status', 'Spender'],
    noprop: ['Date', 'Utility', 'Memo', 'Amount', 'Spender'],
    matnoprop: ['Date', 'Store', 'Memo', 'Amount', 'Spender'],
    matnobill: ['Date', 'Store', 'Property', 'Memo', 'Amount']
  };
  dash.draw('rampHead', (tr) => {
    tr.replaceChildren(...COLS[view.r].map((c) => { const th = document.createElement('th'); th.textContent = c; if (/Paid|Billed|Gap|Amount/.test(c)) th.className = 'mp-num'; return th; }));
  });
  dash.draw('rampRows', (tb) => {
    tb.replaceChildren();
    const u = dash.data('ramp_util'), m = dash.data('ramp_mat'), p = dash.data('ramp_util_props');
    if (u.status !== 'ok' || m.status !== 'ok' || p.status !== 'ok') return;
    const add = (key, cells) => { const tr = document.createElement('tr'); tr.setAttribute('data-key', key); cells.forEach(([t, c]) => td(tr, t, c)); tb.appendChild(tr); };
    const v = view.r;
    if (v === 'gap') p.data.filter((r) => +r.GAP > 5).forEach((r) => add(r.PROPKEY, [[r.PROPERTY], [r.MARKET], [usd(r.RAMP_PAID), 'mp-num'], [usd(r.BILLED_BACK), 'mp-num'], [usd(r.GAP), 'mp-num']]));
    if (v === 'unbilled') u.data.filter((r) => r.STATUS === 'No bill-back found' || r.STATUS === 'Property under-billed').slice().reverse().forEach((r, i) => add(r.DATE + r.AMOUNT + i, [[r.DATE], [r.VENDOR], [r.PROPERTY], [usd(r.AMOUNT), 'mp-num'], [r.STATUS], [r.SPENDER]]));
    if (v === 'noprop') u.data.filter((r) => r.STATUS === 'No property in memo').slice().reverse().forEach((r, i) => add(r.DATE + r.AMOUNT + i, [[r.DATE], [r.VENDOR], [r.MEMO || '(no memo)'], [usd(r.AMOUNT), 'mp-num'], [r.SPENDER]]));
    if (v === 'matnoprop') m.data.filter((r) => r.STATUS === 'No property in memo').slice().reverse().forEach((r, i) => add(r.DATE + r.AMOUNT + i, [[r.DATE], [r.VENDOR], [r.MEMO || '(no memo)'], [usd(r.AMOUNT), 'mp-num'], [r.SPENDER]]));
    if (v === 'matnobill') m.data.filter((r) => r.STATUS.startsWith('No Motion bill')).slice().reverse().forEach((r, i) => add(r.DATE + r.AMOUNT + i, [[r.DATE], [r.VENDOR], [r.PROPKEY], [r.MEMO], [usd(r.AMOUNT), 'mp-num']]));
  });
})();
