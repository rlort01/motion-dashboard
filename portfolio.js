// Portfolio tab: owner retention (doors gained and lost, why owners leave, who to check in with), vacancy and turn
// speed, and renewals. Data comes from AppFolio each morning: props, doors_month, doors_lost, vacancy, renewals.
(function () {
  const DAY = 86400000, now = Date.now();
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const empty = (tb, cols, msg) => { const tr = document.createElement('tr'); const c = td(tr, msg); c.colSpan = cols; tb.appendChild(tr); };
  const t = (s) => (s ? Date.parse(String(s).slice(0, 10) + 'T12:00:00') : NaN);
  const fmtD = (s) => (s ? d3.timeFormat('%b %-d, %Y')(new Date(t(s))) : '');
  const usd = d3.format('$,.0f');
  const med = (a) => (a.length ? d3.median(a) : null);
  const ST = { Georgia: 'GA', Tennessee: 'TN', 'North Carolina': 'NC' };
  const inMarket = (state) => { const m = dash.params().market; return !m || m === 'Combined' || ST[m] === state; };
  // Street key for joining AppFolio addresses written slightly differently ("126 Ronald Pride Blvd - A1 Fort Valley").
  const key = (a) => { const w = String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return w.length >= 2 ? w[0] + ' ' + w[1] : ''; };
  const units = (r) => +r.UNITS || 0;
    const isHoa = (p) => /^hoa$/i.test(p.TYPE || '');
  const rentals = () => (rowsOf('props') || []).filter((p) => !isHoa(p));
  const managed = () => rentals().filter((p) => !p.END || t(p.END) > now);
  const leftKeys = () => new Set(rentals().filter((p) => p.END && t(p.END) <= now).map((p) => key(p.ADDRESS)));
  const activeKeys = () => new Set(managed().map((p) => key(p.ADDRESS)));

  // ---------- Owner retention ----------
  const ret = () => {
    const props = rentals(), lost = (rowsOf('doors_lost') || []).filter((r) => inMarket(r.STATE) && !/hoa/i.test(r.ADDRESS + ' ' + (r.TYPE || '')));
    const yr = new Date().getFullYear() + '';
    const p = props.filter((r) => inMarket(r.STATE));
    const doorsNow = d3.sum(p.filter((r) => !r.END || t(r.END) > now), units);
    const gained90 = d3.sum(p.filter((r) => r.START && now - t(r.START) <= 90 * DAY && t(r.START) <= now), units);
    const lost90 = d3.sum(lost.filter((r) => t(r.END) <= now && now - t(r.END) <= 90 * DAY), units);
    const lostYtd = lost.filter((r) => String(r.END).startsWith(yr) && t(r.END) <= now);
    const soon = p.filter((r) => r.END && t(r.END) > now);
    const reasons = d3.rollups(lostYtd, (v) => d3.sum(v, units), (r) => r.REASON || 'Not recorded').sort((a, b) => b[1] - a[1]);
    return { doorsNow, gained90, lost90, lostYtd: d3.sum(lostYtd, units), lostYtdN: lostYtd.length, soon, soonDoors: d3.sum(soon, units), reasons };
  };
  dash.draw('pfDoors', (el) => { el.textContent = rowsOf('props') ? d3.format(',')(ret().doorsNow) : '—'; });
  dash.draw('pfDoorsN', (el) => { if (!rowsOf('props')) return; const r = ret(); el.textContent = '+' + r.gained90 + ' added, −' + r.lost90 + ' lost in the last 90 days'; });
  dash.draw('pfLost', (el) => { el.textContent = rowsOf('doors_lost') ? String(ret().lostYtd) : '—'; });
  dash.draw('pfLostN', (el) => { if (!rowsOf('doors_lost')) return; const r = ret(); el.textContent = r.lostYtdN + ' properties this year' + (r.reasons[0] ? ' · most often: ' + r.reasons[0][0] : ''); });
  dash.draw('pfSoon', (el) => { el.textContent = rowsOf('doors_lost') ? String(ret().soonDoors) : '—'; });
  dash.draw('pfSoonN', (el) => { if (!rowsOf('doors_lost')) return; const r = ret(); el.textContent = r.soon.length + ' properties with a management end date coming up'; });

  // Rental doors at each month end, worked out from management start/end dates (HOA communities not counted).
  dash.draw('pfMonths', (tb) => {
    tb.replaceChildren();
    const props = rentals(); if (!props.length) return;
    const ends = []; const d = new Date(); d.setDate(1); d.setHours(12);
    for (let i = 0; i < 13; i++) { const e = new Date(d.getFullYear(), d.getMonth() - i, 0, 12); ends.push(e); }
    const at = (e) => { const s = { GA: 0, TN: 0, NC: 0 }; props.forEach((p) => { if (p.START && t(p.START) <= +e && (!p.END || t(p.END) > +e) && s[p.STATE] !== undefined) s[p.STATE] += units(p); }); return s; };
    const rows = ends.map((e) => ({ e, s: at(e) }));
    rows.slice(0, 12).forEach((r, i) => {
      const tot = r.s.GA + r.s.TN + r.s.NC, p0 = rows[i + 1], prev = p0 ? p0.s.GA + p0.s.TN + p0.s.NC : null;
      const tr = document.createElement('tr');
      td(tr, d3.timeFormat('%b %Y')(r.e)); td(tr, r.s.GA, 'mp-num'); td(tr, r.s.TN, 'mp-num'); td(tr, r.s.NC, 'mp-num'); td(tr, tot, 'mp-num');
      const c = td(tr, prev === null ? '' : (tot - prev >= 0 ? '+' : '') + (tot - prev), 'mp-num'); if (prev !== null && tot < prev) c.style.color = 'var(--color-bad)';
      tb.appendChild(tr);
    });
  });
  dash.draw('pfHoa', (el) => { const h = (rowsOf('props') || []).filter((p) => isHoa(p) && (!p.END || t(p.END) > now) && inMarket(p.STATE)); el.textContent = rowsOf('props') ? String(h.length) : '—'; });
  dash.draw('pfHoaN', (el) => { const h = (rowsOf('props') || []).filter((p) => isHoa(p) && (!p.END || t(p.END) > now) && inMarket(p.STATE)); if (!rowsOf('props')) return; el.textContent = h.length ? d3.sum(h, units) + ' homes in ' + h.map((p) => p.ADDRESS.replace(/,.*$/, '')).join(', ') + ' (not counted as doors)' : 'None'; });
  dash.draw('pfReasons', (tb) => {
    tb.replaceChildren();
    const lost = rowsOf('doors_lost'); if (!lost) return;
    const yr = new Date().getFullYear() + '';
    const rows = lost.filter((r) => inMarket(r.STATE) && t(r.END) <= now);
    const R = d3.rollups(rows, (v) => ({ ytd: v.filter((r) => String(r.END).startsWith(yr)), all: v }), (r) => r.REASON || 'Not recorded')
      .sort((a, b) => d3.sum(b[1].ytd, units) - d3.sum(a[1].ytd, units));
    R.forEach(([reason, v]) => {
      const tr = document.createElement('tr');
      const tenure = med(v.all.filter((r) => r.START).map((r) => (t(r.END) - t(r.START)) / (30.4 * DAY)));
      td(tr, reason); td(tr, v.ytd.length, 'mp-num'); td(tr, d3.sum(v.ytd, units), 'mp-num'); td(tr, v.all.length, 'mp-num');
      td(tr, tenure === null ? '—' : tenure.toFixed(0) + ' months', 'mp-num');
      tb.appendChild(tr);
    });
  });
  dash.draw('pfLeft', (tb) => {
    tb.replaceChildren();
    const lost = rowsOf('doors_lost'); if (!lost) return;
    const rows = lost.filter((r) => inMarket(r.STATE) && now - t(r.END) <= 120 * DAY).sort((a, b) => d3.descending(a.END, b.END));
    if (!rows.length) return empty(tb, 6, 'No properties left in the last 120 days.');
    rows.forEach((r) => {
      const tr = document.createElement('tr'); if (t(r.END) > now) tr.className = 'mp-attn';
      td(tr, fmtD(r.END) + (t(r.END) > now ? ' (upcoming)' : '')); td(tr, r.ADDRESS); td(tr, r.OWNER); td(tr, r.REASON || 'Not recorded');
      td(tr, units(r), 'mp-num'); td(tr, r.START ? ((t(r.END) - t(r.START)) / (30.4 * DAY)).toFixed(0) + ' mo' : '—', 'mp-num');
      tb.appendChild(tr);
    });
  });

  // Owners to check in with: currently managed properties showing warning signs.
  const risks = () => {
    const vac = rowsOf('vacancy') || [], board = rowsOf('board') || [], lostKeys = leftKeys();
    const vacBy = d3.group(vac.filter((v) => /^vacant/i.test(v.STATUS || '') && !lostKeys.has(key(v.ADDRESS))), (v) => key(v.ADDRESS));
    const crit = d3.group(board.filter((r) => r.priority === 'Urgent' && !/inspection/i.test(r.kind || '')), (r) => key(r.address));
    const openWo = d3.group(board.filter((r) => !/inspection/i.test(r.kind || '')), (r) => key(r.address));
    const out = [];
    managed().filter((p) => inMarket(p.STATE)).forEach((p) => {
      const k = key(p.ADDRESS), why = [];
      const v = (vacBy.get(k) || []).map((x) => +x.DAYS || (x.MOVE_OUT ? (now - t(x.MOVE_OUT)) / DAY : 0));
      const longest = v.length ? Math.max(...v) : 0;
      if (longest >= 30) why.push(v.length + ' vacant unit' + (v.length > 1 ? 's' : '') + ', longest ' + Math.round(longest) + ' days');
      const c = crit.get(k) || []; if (c.length) why.push(c.length + ' critical work order' + (c.length > 1 ? 's' : '') + ' open');
      const o = (openWo.get(k) || []).filter((r) => r.days >= 30); if (o.length) why.push(o.length + ' work order' + (o.length > 1 ? 's' : '') + ' open 30+ days');
      const isNew = p.START && now - t(p.START) <= 90 * DAY;
      if (p.END && t(p.END) > now) why.push('management ends ' + fmtD(p.END));
      if (why.length) out.push({ p, why, score: (longest >= 60 ? 3 : longest >= 30 ? 2 : 0) + c.length * 2 + o.length + (isNew ? 1 : 0) + (p.END ? 3 : 0), isNew });
    });
    return out.sort((a, b) => b.score - a.score);
  };
  dash.draw('pfRisk', (tb) => {
    tb.replaceChildren();
    if (!rowsOf('props')) return;
    const r = risks();
    if (!r.length) return empty(tb, 4, 'No warning signs right now.');
    r.slice(0, 40).forEach((x) => {
      const tr = document.createElement('tr'); if (x.score >= 4) tr.className = 'mp-attn';
      td(tr, x.p.OWNER); td(tr, x.p.ADDRESS); td(tr, x.why.join(' · ') + (x.isNew ? ' · new owner (first 90 days)' : ''));
      td(tr, x.p.START ? fmtD(x.p.START) : '');
      tb.appendChild(tr);
    });
  });
  window.mpPortfolioRisks = risks;

  // ---------- Vacancy and turn speed ----------
  const vacNow = () => {
    const v = rowsOf('vacancy') || [], left = leftKeys(), act = activeKeys();
    return v.filter((r) => /^vacant/i.test(r.STATUS || '') && inMarket(r.STATE) && !left.has(key(r.ADDRESS)) && (!act.size || act.has(key(r.ADDRESS))) && !/test/i.test(r.UNIT + r.ADDRESS))
      .map((r) => ({ ...r, d: +r.DAYS || (r.MOVE_OUT ? Math.round((now - t(r.MOVE_OUT)) / DAY) : null) }));
  };
  const turns = () => (rowsOf('vacancy') || []).filter((r) => r.MOVE_OUT && inMarket(r.STATE) && String(r.MOVE_OUT) >= new Date().getFullYear() + '');
  const gap = (a, b) => (a && b && t(b) >= t(a) ? (t(b) - t(a)) / DAY : null);
  dash.draw('pfVac', (el) => { el.textContent = rowsOf('vacancy') ? String(vacNow().length) : '—'; });
  dash.draw('pfVacN', (el) => {
    if (!rowsOf('vacancy')) return;
    const v = vacNow(), lostRent = d3.sum(v, (r) => (r.d || 0) * (+r.MARKET_RENT || +r.RENT || 0) / 30.4);
    el.textContent = v.filter((r) => (r.d || 0) >= 30).length + ' vacant 30+ days · ' + usd(lostRent) + ' rent missed so far';
  });
  dash.draw('pfTurn', (el) => { if (!rowsOf('vacancy')) { el.textContent = '—'; return; } const m = med(turns().map((r) => gap(r.MOVE_OUT, r.MOVE_IN)).filter((x) => x !== null)); el.textContent = m === null ? '—' : Math.round(m) + ' days'; });
  dash.draw('pfTurnN', (el) => {
    if (!rowsOf('vacancy')) return;
    const tv = turns(), a = med(tv.map((r) => gap(r.MOVE_OUT, r.RENT_READY)).filter((x) => x !== null)), b = med(tv.map((r) => gap(r.RENT_READY, r.LEASE_SIGNED)).filter((x) => x !== null));
    el.textContent = 'Move-out to rent-ready ' + (a === null ? '—' : Math.round(a) + ' days') + ' · rent-ready to lease signed ' + (b === null ? '—' : Math.round(b) + ' days');
  });
  dash.draw('pfVacRows', (tb) => {
    tb.replaceChildren();
    if (!rowsOf('vacancy')) return;
    const v = vacNow().sort((a, b) => (b.d || -1) - (a.d || -1));
    if (!v.length) return empty(tb, 7, 'No vacant units.');
    v.forEach((r) => {
      const tr = document.createElement('tr'); if ((r.d || 0) >= 45) tr.className = 'mp-attn';
      td(tr, r.ADDRESS); td(tr, r.UNIT); td(tr, r.STATUS === 'Vacant-Rented' ? 'Rented, move-in ' + fmtD(r.MOVE_IN) : 'Not rented');
      td(tr, fmtD(r.MOVE_OUT) || 'No move-out recorded'); td(tr, r.RENT_READY ? fmtD(r.RENT_READY) : r.MOVE_OUT ? 'Not yet' : '');
      td(tr, r.d === null ? '—' : r.d, 'mp-num'); td(tr, (+r.MARKET_RENT || +r.RENT) ? usd(+r.MARKET_RENT || +r.RENT) : '', 'mp-num');
      tb.appendChild(tr);
    });
  });

  // ---------- Renewals ----------
  const ren = () => (rowsOf('renewals') || []).filter((r) => inMarket(r.STATE));
  dash.draw('pfRenRate', (el) => {
    const r = ren(); if (!rowsOf('renewals')) { el.textContent = '—'; return; }
    const past = r.filter((x) => t(x.LEASE_END) <= now), ok = past.filter((x) => /renew/i.test(x.OUTCOME)).length, gone = past.filter((x) => /moved|notice/i.test(x.OUTCOME)).length;
    el.textContent = ok + gone ? Math.round((ok / (ok + gone)) * 100) + '%' : '—';
  });
  dash.draw('pfRenRateN', (el) => {
    const r = ren(); if (!rowsOf('renewals')) return;
    const inc = r.filter((x) => /renew/i.test(x.OUTCOME) && +x.OLD_RENT > 100 && +x.NEW_RENT > 0).map((x) => (+x.NEW_RENT - +x.OLD_RENT) / +x.OLD_RENT);
    el.textContent = 'Leases ended this year that renewed · typical increase ' + (inc.length ? d3.format('+.1%')(d3.median(inc)) : '—');
  });
  const upcoming = () => ren().filter((x) => t(x.LEASE_END) > now - 7 * DAY && t(x.LEASE_END) <= now + 90 * DAY);
  dash.draw('pfRenDue', (el) => { el.textContent = rowsOf('renewals') ? String(upcoming().filter((x) => /pending|month/i.test(x.OUTCOME) && !x.OFFER_SENT).length) : '—'; });
  dash.draw('pfRenDueN', (el) => { if (!rowsOf('renewals')) return; el.textContent = 'of ' + upcoming().length + ' leases ending in the next 90 days have no decision and no renewal offer sent'; });
  dash.draw('pfRenRows', (tb) => {
    tb.replaceChildren();
    if (!rowsOf('renewals')) return;
    const r = upcoming().sort((a, b) => d3.ascending(a.LEASE_END, b.LEASE_END));
    if (!r.length) return empty(tb, 6, 'No leases ending in the next 90 days.');
    r.forEach((x) => {
      const tr = document.createElement('tr');
      const daysLeft = Math.round((t(x.LEASE_END) - now) / DAY);
      if (/pending|month/i.test(x.OUTCOME) && !x.OFFER_SENT && daysLeft <= 60) tr.className = 'mp-attn';
      td(tr, fmtD(x.LEASE_END) + ' (' + (daysLeft >= 0 ? daysLeft + ' days' : 'ended') + ')'); td(tr, x.ADDRESS); td(tr, x.UNIT); td(tr, x.OUTCOME);
      td(tr, x.OFFER_SENT ? fmtD(x.OFFER_SENT) : 'Not sent');
      td(tr, (+x.OLD_RENT ? usd(+x.OLD_RENT) : '') + (+x.NEW_RENT ? ' → ' + usd(+x.NEW_RENT) : ''), 'mp-num');
      tb.appendChild(tr);
    });
  });
})();
