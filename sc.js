(function () {
  const MARKETS = ['Combined', 'Georgia', 'Tennessee', 'North Carolina'];
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const mk = () => (MARKETS.includes(dash.params().market) ? dash.params().market : 'Combined');
  const mon = () => { const m = +dash.params().scMonth; return m >= 1 && m <= 12 ? m : 11; };

  const fmtVal = (v, unit) => {
    if (v === null || v === undefined || v === '' || !isFinite(v)) return '—';
    switch (unit) {
      case 'Percentage': return d3.format('.1f')(v * 100) + '%';
      case 'Dollar Amount': return d3.format('$,.2f')(v);
      case 'Hours': return d3.format('.1~f')(v) + ' hrs';
      case 'Time': case 'Days': return d3.format('.1~f')(v) + ' days';
      default: return d3.format(',.4~f')(v);
    }
  };
  const fmtGoal = (r) => {
    if (r.goal === null) return r.goalText || '';
    const pre = r.dir === 'L' ? '≤ ' : r.dir === 'H' ? '≥ ' : '';
    if (r.unit === 'Rank') return 'Top ' + r.goal;
    return pre + fmtVal(r.goal, r.unit);
  };

  dash.calc('scMerged', {
    title: '2026 scorecard, AppFolio first',
    description: 'Each market and month of the 2026 scorecard. Where AppFolio gives the metric, the AppFolio figure is used; otherwise the figure entered on the scorecard workbook.',
    inputs: ['sc2026', 'sys2026'],
    fn: (sc, sys) => {
      const num = (v) => (v === null || v === undefined || v === '' ? null : +v);
      const auto = new Map(sys.filter((r) => num(r.VALUE) !== null).map((r) => [r.ID + '|' + r.MARKET + '|' + (+r.MONTH), r]));
      return sc.map((r) => {
        const k = r.ID + '|' + r.MARKET + '|' + (+r.MONTH);
        const a = auto.get(k);
        return { ID: r.ID, MARKET: r.MARKET, MONTH: +r.MONTH, AGG: r.AGG, VALUE: a ? num(a.VALUE) : num(r.VALUE), SRC: a ? (a.SOURCE || 'AppFolio') : num(r.VALUE) !== null ? 'Entered' : '' };
      });
    }
  });

  dash.calc('scMarket', {
    title: '2026 scorecard for the selected market',
    description: 'The scorecard for the chosen market. For combined markets, counts and dollar totals are summed and rates are averaged across Georgia, Tennessee and North Carolina, weighted by each market\'s end-of-month doors.',
    inputs: ['scMerged', 'sys2026'],
    fn: (rows, sys) => {
      const market = ['Combined', 'Georgia', 'Tennessee', 'North Carolina'].includes(dash.params().market) ? dash.params().market : 'Combined';
      const companyWide = new Map(sys.filter((r) => r.MARKET === 'Combined' && r.VALUE !== null && r.VALUE !== '').map((r) => [r.ID + '|' + (+r.MONTH), r]));
      if (market !== 'Combined') return rows.filter((r) => r.MARKET === market).map((r) => ({ key: r.ID + '|' + r.MONTH, ID: r.ID, MONTH: r.MONTH, VALUE: r.VALUE, SRC: r.SRC }));
      const doors = new Map(rows.filter((r) => r.ID === 'eom_doors').map((r) => [r.MARKET + '|' + r.MONTH, r.VALUE]));
      const out = [];
      d3.group(rows, (r) => r.ID, (r) => r.MONTH).forEach((byMonth, id) => byMonth.forEach((rs, month) => {
        const vals = rs.filter((r) => r.VALUE !== null);
        let v = null;
        if (vals.length) {
          if (rs[0].AGG === 'sum') v = d3.sum(vals, (r) => r.VALUE);
          else {
            const ws = vals.map((r) => doors.get(r.MARKET + '|' + month));
            v = ws.every((w) => w > 0) ? d3.sum(vals, (r, i) => r.VALUE * ws[i]) / d3.sum(ws) : d3.mean(vals, (r) => r.VALUE);
          }
        }
        const srcs = Array.from(new Set(vals.map((r) => r.SRC)));
        const cw = companyWide.get(id + '|' + month);
        if (cw) { out.push({ key: id + '|' + month, ID: id, MONTH: month, VALUE: Math.round(+cw.VALUE * 10000) / 10000, SRC: cw.SOURCE || 'AppFolio' }); return; }
        out.push({ key: id + '|' + month, ID: id, MONTH: month, VALUE: v === null ? null : Math.round(v * 10000) / 10000, SRC: srcs.length === 1 ? srcs[0] : srcs.length ? 'Mixed' : '' });
      }));
      return out;
    }
  });

  dash.calc('scTable', {
    title: 'Scorecard for the selected market and month',
    description: 'One row per scorecard metric: the selected month, the month before, the 2026 year to date (average for rates, total for counts and dollars), whether the month met the 2026 goal, and where the figure came from.',
    inputs: ['sc2026', 'scMarket'],
    fn: (sc, mkt) => {
      const src = new Map(mkt.map((r) => [r.key, r.SRC]));
      const m = +dash.params().scMonth >= 1 ? +dash.params().scMonth : 11;
      const meta = new Map();
      sc.forEach((r) => { if (!meta.has(r.ID)) meta.set(r.ID, r); });
      const byKey = new Map(mkt.map((r) => [r.key, r.VALUE]));
      const out = [];
      meta.forEach((r, id) => {
        const goal = r.GOAL === null || r.GOAL === '' ? null : +r.GOAL;
        const v = byKey.has(id + '|' + m) ? byKey.get(id + '|' + m) : null;
        const prior = m > 1 && byKey.has(id + '|' + (m - 1)) ? byKey.get(id + '|' + (m - 1)) : null;
        const ytdVals = d3.range(1, m + 1).map((i) => byKey.get(id + '|' + i)).filter((x) => x !== null && x !== undefined);
        const ytd = id === 'eom_doors' || id === 'eom_units' ? v : ytdVals.length ? (r.AGG === 'sum' ? d3.sum(ytdVals) : d3.mean(ytdVals)) : null;
        let status = '';
        if (v !== null && goal !== null && r.DIR !== 'N') status = (r.DIR === 'H' ? v >= goal : v <= goal) ? 'On target' : 'Off target';
        out.push({ ID: id, SECTION: r.SECTION, METRIC: r.METRIC, goal, goalText: r.GOAL_TEXT, unit: r.UNIT, owner: r.OWNER, dir: r.DIR, agg: r.AGG,
          value: v, source: src.get(id + '|' + m) || '', prior, ytd: ytd === null ? null : Math.round(ytd * 10000) / 10000, status });
      });
      return out;
    }
  });

  dash.calc('scChart', {
    title: 'Selected metric by month and market',
    description: 'The chosen metric for each month of 2026 in Georgia, Tennessee, North Carolina and combined (AppFolio figures where available, otherwise the scorecard entries).',
    inputs: ['scMerged', 'sys2026'],
    fn: (rows, sys) => {
      const id = dash.params().metric || 'r18';
      const companyWide = new Map(sys.filter((r) => r.MARKET === 'Combined' && r.ID === id && r.VALUE !== null && r.VALUE !== '').map((r) => [+r.MONTH, +r.VALUE]));
      const doors = new Map(rows.filter((r) => r.ID === 'eom_doors').map((r) => [r.MARKET + '|' + r.MONTH, r.VALUE]));
      const rs = rows.filter((r) => r.ID === id);
      return d3.range(1, 12).map((m) => {
        const mr = rs.filter((r) => r.MONTH === m);
        const o = { month: m };
        ['Georgia', 'Tennessee', 'North Carolina'].forEach((k) => { const r = mr.find((x) => x.MARKET === k); o[k] = r ? r.VALUE : null; });
        const vals = mr.filter((r) => r.VALUE !== null);
        if (!vals.length) o.Combined = null;
        else if (mr[0].AGG === 'sum') o.Combined = d3.sum(vals, (r) => r.VALUE);
        else {
          const ws = vals.map((r) => doors.get(r.MARKET + '|' + m));
          o.Combined = ws.every((w) => w > 0) ? d3.sum(vals, (r, i) => r.VALUE * ws[i]) / d3.sum(ws) : d3.mean(vals, (r) => r.VALUE);
        }
        if (companyWide.has(m)) o.Combined = companyWide.get(m);
        if (o.Combined !== null) o.Combined = Math.round(o.Combined * 10000) / 10000;
        return o;
      });
    }
  });

  dash.calc('xcheck', {
    title: 'Scorecard entries vs AppFolio',
    description: 'For each metric AppFolio now fills in, the figure the team entered on the scorecard workbook next to the AppFolio figure, for the chosen market and month.',
    inputs: ['sc2026', 'sys2026'],
    fn: (sc, sys) => {
      const market = ['Combined', 'Georgia', 'Tennessee', 'North Carolina'].includes(dash.params().market) ? dash.params().market : 'Combined';
      const m = +dash.params().scMonth >= 1 ? +dash.params().scMonth : 11;
      const mk = market === 'Combined' ? ['Georgia', 'Tennessee', 'North Carolina'] : [market];
      const num = (v) => (v === null || v === undefined || v === '' ? null : +v);
      const meta = new Map(); sc.forEach((r) => { if (!meta.has(r.ID)) meta.set(r.ID, r); });
      const pick = (rows, id) => rows.filter((r) => r.ID === id && +r.MONTH === m && mk.includes(r.MARKET) && num(r.VALUE) !== null);
      const comb = (rows, id, doorRows) => {
        const vals = pick(rows, id);
        if (!vals.length) return null;
        if (meta.get(id).AGG === 'sum') return d3.sum(vals, (r) => +r.VALUE);
        const dm = new Map(pick(doorRows, 'eom_doors').map((r) => [r.MARKET, +r.VALUE]));
        const ws = vals.map((r) => dm.get(r.MARKET));
        return ws.every((w) => w > 0) ? d3.sum(vals, (r, i) => +r.VALUE * ws[i]) / d3.sum(ws) : d3.mean(vals, (r) => +r.VALUE);
      };
      const ids = Array.from(new Set(sys.map((r) => r.ID))).filter((id) => meta.has(id));
      return ids.map((id) => {
        const cw = market === 'Combined' ? sys.find((r) => r.ID === id && r.MARKET === 'Combined' && +r.MONTH === m && num(r.VALUE) !== null) : null;
        const e = comb(sc, id, sc), a = cw ? +cw.VALUE : comb(sys, id, sys);
        const src = sys.find((r) => r.ID === id) || {};
        const note = (src.NOTE || '') + (src.MARKET === 'Combined' ? ' (company-wide only)' : '');
        const u = meta.get(id).UNIT;
        const r4 = (v) => (v === null ? null : Math.round(v * 10000) / 10000);
        return { metric: meta.get(id).METRIC, unit: u, entered: r4(e), appfolio: r4(a), note,
          gap: e !== null && a !== null && Math.abs(e - a) > (u === 'Percentage' ? 0.03 : 2) };
      });
    }
  });

  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const findRow = (id) => { const t = rowsOf('scTable'); return t ? t.find((r) => r.ID === id) : null; };

  dash.draw('marketSel', (sel) => {
    sel.replaceChildren(...MARKETS.map((k) => new Option(k === 'Combined' ? 'Combined markets' : k, k)));
    sel.value = mk();
    sel.onchange = () => dash.setParams({ market: sel.value });
  });
  dash.draw('monthSel', (sel) => {
    const d = dash.data('sc2026');
    const months = d.status === 'ok' ? Array.from(new Set(d.data.map((r) => +r.MONTH))).sort((a, b) => b - a) : [];
    sel.replaceChildren(...months.map((m) => new Option(MONTHS_LONG[m - 1] + ' 2026', String(m))));
    sel.value = String(mon());
    sel.onchange = () => dash.setParams({ scMonth: +sel.value });
  });

  dash.draw('takeaway', (el) => {
    const t = rowsOf('scTable');
    if (!t) { el.textContent = '—'; return; }
    const scored = t.filter((r) => r.status);
    const on = scored.filter((r) => r.status === 'On target');
    const keyOff = ['r18', 'r22', 'r14', 'r30', 'r32', 'r47', 'r23', 'r13'].map((id) => t.find((r) => r.ID === id)).filter((r) => r && r.status === 'Off target');
    const who = mk() === 'Combined' ? 'Across all markets' : mk();
    el.textContent = who + ', ' + MONTHS_LONG[mon() - 1] + ' 2026: ' + on.length + ' of ' + scored.length + ' scored metrics met their 2026 goal.' +
      (keyOff.length ? ' Off target: ' + keyOff.slice(0, 4).map((r) => r.METRIC.replace(/\s*\(.*\)/, '').toLowerCase() + ' (' + fmtVal(r.value, r.unit) + ')').join(', ') + '.' : '');
  });

  dash.draw('tileVal', (el) => {
    const r = findRow(el.getAttribute('data-id'));
    el.textContent = r ? fmtVal(r.value, r.unit) : '—';
  });
  dash.draw('tileMeta', (el) => {
    const r = findRow(el.getAttribute('data-id'));
    el.replaceChildren();
    if (!r) { el.textContent = '—'; return; }
    const g = document.createElement('span'); g.textContent = r.goal !== null ? 'Goal ' + fmtGoal(r) : r.goalText ? 'Goal ' + r.goalText : 'No goal';
    el.appendChild(g);
    if (r.source && r.source !== 'Entered' && r.source !== 'Mixed') { const sp = document.createElement('span'); sp.textContent = ' · from ' + r.source; el.appendChild(sp); }
    if (r.status) { const p = document.createElement('span'); p.className = 'mp-pill ' + (r.status === 'On target' ? 'mp-ok' : 'mp-bad'); p.textContent = r.status; p.style.marginLeft = '6px'; el.appendChild(p); }
    if (r.value !== null && r.prior !== null) {
      const d = r.value - r.prior;
      const c = document.createElement('div');
      const better = r.dir === 'H' ? d > 0 : r.dir === 'L' ? d < 0 : null;
      c.textContent = (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + (r.unit === 'Percentage' ? d3.format('.1f')(Math.abs(d) * 100) + ' pts' : fmtVal(Math.abs(d), r.unit)) + ' vs ' + MONTHS[mon() - 2];
      if (d !== 0 && better !== null) c.style.color = better ? 'var(--color-ok)' : 'var(--color-bad)';
      el.appendChild(c);
    }
  });
  dash.draw('tileUnits', (el) => {
    const r = findRow('eom_units');
    el.textContent = r && r.value !== null ? d3.format(',')(r.value) + ' units' + (r.prior !== null && r.value !== r.prior ? ' (' + (r.value > r.prior ? '+' : '') + (r.value - r.prior) + ' vs ' + MONTHS[mon() - 2] + ')' : '') : '— units';
  });
  dash.draw('netDoors', (el) => {
    const a = findRow('doors_in'), b = findRow('doors_out');
    if (!a || !b || (a.value === null && b.value === null)) { el.textContent = '—'; return; }
    const n = (a.value || 0) - (b.value || 0);
    el.textContent = (n > 0 ? '+' : '') + n + ' (' + (a.value || 0) + ' in, ' + (b.value || 0) + ' out)';
  });

  dash.draw('scSection', (tb) => {
    const t = rowsOf('scTable');
    tb.replaceChildren();
    if (!t) return;
    const sel = dash.params().metric || 'r18';
    t.filter((r) => r.SECTION === tb.getAttribute('data-section')).forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.ID); tr.tabIndex = 0; tr.style.cursor = 'pointer';
      if (r.ID === sel) tr.style.background = 'var(--color-panel)';
      tr.onclick = () => { dash.setParams({ metric: r.ID }); const c = document.getElementById('sc-chart-card'); if (c && c.scrollIntoView) c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); };
      tr.onkeydown = (e) => { if (e.key === 'Enter') tr.onclick(); };
      td(tr, r.METRIC); td(tr, r.goal !== null ? fmtGoal(r) : r.goalText); td(tr, r.owner);
      td(tr, fmtVal(r.value, r.unit), 'mp-num'); td(tr, fmtVal(r.prior, r.unit), 'mp-num'); td(tr, fmtVal(r.ytd, r.unit), 'mp-num');
      const s = td(tr, ''); if (r.status) { const p = document.createElement('span'); p.className = 'mp-pill ' + (r.status === 'On target' ? 'mp-ok' : 'mp-bad'); p.textContent = r.status; s.appendChild(p); }
      const auto = r.source && r.source !== 'Entered' && r.source !== 'Mixed';
      const so = td(tr, auto ? r.source + ' (auto)' : r.source === 'Mixed' ? 'Auto + entered' : r.source === 'Entered' ? 'Entered' : ''); if (auto) so.style.color = 'var(--color-ok)';
      tb.appendChild(tr);
    });
  });
  dash.draw('monthHead', (th) => { th.textContent = MONTHS[mon() - 1]; });
  dash.draw('priorHead', (th) => { th.textContent = mon() > 1 ? MONTHS[mon() - 2] : 'Prior'; });

  dash.draw('chartTitle', (el) => {
    const t = rowsOf('scTable'); const r = t && t.find((x) => x.ID === (dash.params().metric || 'r18'));
    el.textContent = r ? r.METRIC + (r.goal !== null ? ' · goal ' + fmtGoal(r) : '') : '—';
  });

  dash.draw('scChartPlot', (el) => {
    const d = dash.data('scChart');
    const t = rowsOf('scTable');
    el.replaceChildren();
    if (d.status !== 'ok' || !t) { el.textContent = d.status === 'error' ? 'Failed to load' : '—'; return; }
    const meta = t.find((x) => x.ID === (dash.params().metric || 'r18'));
    const unit = meta ? meta.unit : 'Count';
    const series = ['Georgia', 'Tennessee', 'North Carolina', 'Combined'];
    const color = (s, i) => (s === 'Combined' ? 'var(--color-fg-muted)' : dash.colors[i]);
    const all = d.data.flatMap((r) => series.map((s) => r[s])).filter((v) => v !== null);
    if (!all.length) { el.textContent = 'No entries for this metric in 2026.'; return; }
    const W = Math.max(280, el.clientWidth), H = 220, m = { t: 10, r: 14, b: 24, l: 58 };
    const x = d3.scalePoint().domain(d3.range(1, 12)).range([m.l, W - m.r]).padding(0.4);
    const ext = d3.extent(all.concat(meta && meta.goal !== null ? [meta.goal] : []));
    const y = d3.scaleLinear().domain([Math.min(0, ext[0]), ext[1] === 0 ? 1 : ext[1] * 1.08]).nice().range([H - m.b, m.t]);
    const tick = (v) => (unit === 'Percentage' ? d3.format('.0f')(v * 100) + '%' : unit === 'Dollar Amount' ? d3.format('$,.0f')(v) : d3.format(',.2~f')(v));
    const svg = d3.select(el).append('svg').attr('width', '100%').attr('viewBox', `0 0 ${W} ${H}`).attr('role', 'img')
      .attr('aria-label', (meta ? meta.METRIC : 'Metric') + ' by month in 2026, by market');
    svg.append('g').attr('transform', `translate(${m.l},0)`).call(d3.axisLeft(y).ticks(5).tickSize(-(W - m.l - m.r)).tickFormat(tick))
      .call((g) => { g.select('.domain').remove(); g.selectAll('line').style('stroke', 'var(--cds-chart-grid)'); });
    const step = W < 420 ? 2 : 1;
    svg.append('g').attr('transform', `translate(0,${H - m.b})`).call(d3.axisBottom(x).tickValues(d3.range(1, 12).filter((v) => (v - 1) % step === 0)).tickFormat((v) => MONTHS[v - 1]).tickSize(0).tickPadding(6))
      .call((g) => g.select('.domain').style('stroke', 'var(--cds-chart-axis)'));
    if (meta && meta.goal !== null) svg.append('line').attr('x1', m.l).attr('x2', W - m.r).attr('y1', y(meta.goal)).attr('y2', y(meta.goal))
      .style('stroke', 'var(--cds-chart-reference)').style('stroke-dasharray', '4 3');
    series.forEach((s, i) => {
      const pts = d.data.filter((r) => r[s] !== null);
      svg.append('path').datum(pts).attr('fill', 'none').style('stroke', color(s, i)).attr('stroke-width', s === mk() ? 2.5 : 1.5)
        .style('stroke-dasharray', s === 'Combined' ? '5 3' : null)
        .attr('d', d3.line().x((r) => x(r.month)).y((r) => y(r[s])));
      svg.append('g').selectAll('circle').data(pts).join('circle').attr('cx', (r) => x(r.month)).attr('cy', (r) => y(r[s])).attr('r', 2.5).style('fill', color(s, i));
    });
    const tip = d3.select(el).append('div').attr('class', 'mp-tip').style('display', 'none');
    svg.append('rect').attr('x', m.l).attr('y', 0).attr('width', W - m.l - m.r).attr('height', H).attr('fill', 'transparent')
      .on('pointermove', (ev) => {
        const [px] = d3.pointer(ev);
        const r = d.data.reduce((b, c) => (Math.abs(x(c.month) - px) < Math.abs(x(b.month) - px) ? c : b), d.data[0]);
        tip.style('display', null).text(MONTHS[r.month - 1] + ': ' + series.map((s) => s.replace('North Carolina', 'NC') + ' ' + fmtVal(r[s], unit)).join(' · '));
        const sc = el.clientWidth / W;
        tip.style('left', Math.max(0, Math.min(x(r.month) * sc, el.clientWidth - 320)) + 'px').style('top', '0px');
      })
      .on('pointerleave', () => tip.style('display', 'none'));
    const lg = d3.select(el).append('div').attr('class', 'mp-legend');
    series.forEach((s, i) => { const it = lg.append('span'); it.append('i').style('background', color(s, i)); it.append('span').text(s === 'Combined' ? 'Combined (dashed)' : s); });
    if (meta && meta.goal !== null) { const it = lg.append('span'); it.append('i').style('background', 'var(--cds-chart-reference)'); it.append('span').text('Goal'); }
  });

  dash.draw('xcheckRows', (tb) => {
    const t = rowsOf('xcheck');
    tb.replaceChildren();
    if (!t) return;
    t.forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.metric);
      td(tr, r.metric); td(tr, fmtVal(r.entered, r.unit), 'mp-num');
      const a = td(tr, fmtVal(r.appfolio, r.unit), 'mp-num'); if (r.gap) a.style.color = 'var(--color-warn)';
      td(tr, r.note);
      tb.appendChild(tr);
    });
  });
})();
