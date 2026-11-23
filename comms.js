// Communications tab: Teams Phone calls (comm_calls) and owner/tenant email reply times from Outlook (resp_email).
// Both datasets carry staff names and times only: no phone numbers, email addresses or message text.
(function () {
  const DAY = 86400000;
  const view = { days: 7 };
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const med = (a) => (a.length ? d3.median(a) : null);
  const fmtMin = (m) => (m === null || m === undefined ? '—' : m < 60 ? Math.round(m) + ' min' : m < 1440 ? (m / 60).toFixed(1) + ' hr' : (m / 1440).toFixed(1) + ' days');
  const fmtSec = (s) => (s === null || s === undefined ? '—' : s < 60 ? Math.round(s) + ' sec' : (s / 60).toFixed(1) + ' min');
  const fmtHr = (h) => (h === null || h === undefined ? '—' : h < 1 ? Math.round(h * 60) + ' min' : h.toFixed(1) + ' hr');
  const pct = (a, b) => (b ? Math.round((a / b) * 100) + '%' : '—');
  const when = (s) => d3.timeFormat('%a %b %-d, %-I:%M %p')(new Date(s));
  const inPeriod = (s) => Date.now() - new Date(s) <= view.days * DAY;
  const ET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hour12: false });
  const isBiz = (s) => { const p = Object.fromEntries(ET.formatToParts(new Date(s)).map((x) => [x.type, x.value])); const h = +p.hour % 24; return !['Sat', 'Sun'].includes(p.weekday) && h >= 8 && h < 18; };

  // The main number (8445) rings the "Motion PMG - Georgia" call queue.
  const MAIN = 'Motion PMG - Georgia';
  const isMain = (r) => r.LINE === MAIN;
  const calls = () => (rowsOf('comm_calls') || []).filter((r) => inPeriod(r.START));
  // Business hours between two times: Mon-Fri 8:00-18:00 Eastern.
  const bizH = (a, b) => {
    let t = +new Date(a); const end = +new Date(b); let ms = 0;
    while (t < end) { const n = Math.min(end, (Math.floor(t / 3600000) + 1) * 3600000); if (isBiz(t)) ms += n - t; t = n; }
    return ms / 3600000;
  };
  // A reply counts from Outlook (same email thread) or from AppFolio (checked nightly), whichever came first.
  const norm = (r) => {
    if (r._n) return r;
    const o = r.REPLIED ? +new Date(r.REPLIED) : null, a = r.AF_REPLIED ? +new Date(r.AF_REPLIED) : null;
    const useA = a && (!o || a < o);
    r._rep = useA ? r.AF_REPLIED : r.REPLIED; r._by = useA ? r.AF_REPLIED_BY : r.REPLIED_BY; r._via = r._rep ? (useA ? 'AppFolio' : 'Outlook') : null;
    r._bh = r._rep ? (useA ? bizH(r.RECEIVED, r._rep) : +r.BIZ_HOURS) : bizH(r.RECEIVED, Date.now());
    r._n = true; return r;
  };
  const mails = () => (rowsOf('resp_email') || []).filter((r) => inPeriod(r.RECEIVED)).map(norm);

  const sum = (pred) => {
    const c = calls(), inn = c.filter((r) => r.DIR === 'in' && pred(r)), out = c.filter((r) => r.DIR === 'out');
    const ans = inn.filter((r) => r.ANSWERED), miss = inn.filter((r) => !r.ANSWERED), missBiz = miss.filter((r) => isBiz(r.START));
    const back = miss.filter((r) => r.CALLBACK_MIN !== null || r.CALLED_AGAIN);
    const m = mails(), rep = m.filter((r) => r._rep);
    return {
      inN: inn.length, ans: ans.length, miss: miss.length, missBiz: missBiz.length, back: back.length, notBack: miss.length - back.length,
      cbMed: med(miss.filter((r) => r.CALLBACK_MIN !== null).map((r) => +r.CALLBACK_MIN)),
      wait: med(ans.filter((r) => r.WAIT_S !== null).map((r) => +r.WAIT_S)),
      outN: out.length, talkHr: d3.sum(c, (r) => +r.TALK_S || 0) / 3600,
      mN: m.length, mRep: rep.length, mMed: med(rep.map((r) => r._bh)), mAf: rep.filter((r) => r._via === 'AppFolio').length, mWait: m.length - rep.length,
    };
  };
  const tile = (name, f, pred) => dash.draw(name, (el) => { el.textContent = rowsOf('comm_calls') || rowsOf('resp_email') ? f(sum(pred || ((r) => !isMain(r)))) : '—'; });
  // Main line (8445)
  tile('cmMainIn', (s) => String(s.inN), isMain);
  tile('cmMainInN', (s) => pct(s.ans, s.inN) + ' answered by a person', isMain);
  tile('cmMainMiss', (s) => String(s.miss), isMain);
  tile('cmMainMissN', (s) => s.missBiz + ' during business hours · ' + s.notBack + ' never called back' + (s.cbMed !== null ? ' · callbacks took ' + fmtMin(s.cbMed) + ' (typical)' : ''), isMain);
  tile('cmMainBack', (s) => String(s.notBack), isMain);
  tile('cmMainBackN', (s) => (s.miss ? pct(s.back, s.miss) + ' of missed callers were called back or got through later' : 'No missed calls'), isMain);
  tile('cmWait', (s) => fmtSec(s.wait), isMain);
  // Everyone else: direct numbers and the Tennessee queue
  tile('cmIn', (s) => String(s.inN));
  tile('cmInN', (s) => pct(s.ans, s.inN) + ' answered by a person');
  tile('cmMiss', (s) => String(s.miss));
  tile('cmMissN', (s) => s.missBiz + ' during business hours · ' + s.notBack + ' never called back' + (s.cbMed !== null ? ' · callbacks took ' + fmtMin(s.cbMed) + ' (typical)' : ''));
  tile('cmWait', (s) => fmtSec(s.wait));
  tile('cmOut', (s) => String(s.outN));
  tile('cmOutN', (s) => s.talkHr.toFixed(1) + ' hours on the phone, in and out');
  tile('cmMail', (s) => fmtHr(s.mMed));
  tile('cmMailN', (s) => s.mN + ' owner/tenant emails · ' + s.mAf + ' answered in AppFolio · ' + s.mWait + ' with no reply found');

  // Per-person table.
  dash.draw('cmPeople', (tb) => {
    tb.replaceChildren();
    const c = calls(), m = mails();
    if (!rowsOf('comm_calls') && !rowsOf('resp_email')) return;
    const P = new Map();
    const p = (n) => { if (!P.has(n)) P.set(n, { name: n, mainAns: 0, ans: 0, miss: 0, out: 0, talk: 0, cb: [], cbN: 0, mail: 0, rep: 0, repH: [] }); return P.get(n); };
    c.forEach((r) => {
      if (r.DIR === 'in' && r.ANSWERED && r.STAFF) { const x = p(r.STAFF); if (isMain(r)) x.mainAns++; else x.ans++; x.talk += +r.TALK_S || 0; }
      if (r.DIR === 'in' && !r.ANSWERED && r.STAFF && !r.LINE) p(r.STAFF).miss++;
      if (r.DIR === 'out' && r.STAFF) { const x = p(r.STAFF); x.out++; x.talk += +r.TALK_S || 0; }
      if (r.DIR === 'in' && !r.ANSWERED && r.CALLED_BACK_BY) { const x = p(r.CALLED_BACK_BY); x.cbN++; x.cb.push(+r.CALLBACK_MIN); }
    });
    m.forEach((r) => { const x = p(r.NAME); x.mail++; });
    m.filter((r) => r._rep && r._by).forEach((r) => { const x = p(r._by); x.rep++; x.repH.push(r._bh); });
    const list = Array.from(P.values()).filter((x) => x.name && !/^Motion PMG\b/.test(x.name)).sort((a, b) => (b.mainAns + b.ans + b.out + b.mail) - (a.mainAns + a.ans + a.out + a.mail));
    if (!list.length) { const tr = document.createElement('tr'); td(tr, 'No calls or emails in this period.'); tb.appendChild(tr); return; }
    list.forEach((x) => {
      const tr = document.createElement('tr');
      td(tr, x.name); td(tr, x.mainAns || '', 'mp-num'); td(tr, x.ans || '', 'mp-num'); td(tr, x.miss || '', 'mp-num'); td(tr, x.out, 'mp-num'); td(tr, (x.talk / 3600).toFixed(1), 'mp-num');
      td(tr, x.cbN ? x.cbN + ' · ' + fmtMin(med(x.cb)) : '', 'mp-num');
      td(tr, x.mail || '', 'mp-num'); td(tr, x.rep ? x.rep + ' · ' + fmtHr(med(x.repH)) : '', 'mp-num');
      tb.appendChild(tr);
    });
  });

  // Unanswered calls, newest first.
  const missedTable = (name, pred, lineCol) => dash.draw(name, (tb) => {
    tb.replaceChildren();
    const list = calls().filter((r) => r.DIR === 'in' && !r.ANSWERED && pred(r)).sort((a, b) => d3.descending(a.START, b.START));
    if (!list.length) { const tr = document.createElement('tr'); td(tr, 'No unanswered calls in this period.'); tb.appendChild(tr); return; }
    list.forEach((r) => {
      const tr = document.createElement('tr');
      const done = r.CALLBACK_MIN !== null || r.CALLED_AGAIN;
      if (!done) tr.className = 'mp-attn';
      td(tr, when(r.START) + (isBiz(r.START) ? '' : ' · after hours')); if (lineCol) td(tr, r.LINE ? r.LINE.replace(/^Motion PMG - /, '') + ' queue' : 'Direct line'); td(tr, r.STAFF && !/^Motion PMG\b/.test(r.STAFF) ? r.STAFF : '—');
      const c = td(tr, '');
      const pill = document.createElement('span');
      pill.className = 'mp-pill ' + (done ? 'mp-ok' : 'mp-bad');
      pill.textContent = r.CALLBACK_MIN !== null ? 'Called back by ' + (r.CALLED_BACK_BY || 'team') + ' after ' + fmtMin(+r.CALLBACK_MIN) : r.CALLED_AGAIN ? 'Caller called again and got through' : (Date.now() - new Date(r.START) < 3 * DAY ? 'No callback yet' : 'No callback within 3 days');
      c.appendChild(pill);
      tb.appendChild(tr);
    });
  });
  missedTable('cmMainMissed', isMain, false);
  missedTable('cmMissed', (r) => !isMain(r), true);

  // Owner/tenant emails with no reply found in Outlook or AppFolio, longest wait first.
  dash.draw('cmMailWait', (tb) => {
    tb.replaceChildren();
    const list = mails().filter((r) => !r._rep).sort((a, b) => b._bh - a._bh);
    if (!list.length) { const tr = document.createElement('tr'); td(tr, 'Every owner and tenant email in this period has a reply.'); tb.appendChild(tr); return; }
    list.forEach((r) => {
      const tr = document.createElement('tr'); if (r._bh > 10) tr.className = 'mp-attn';
      td(tr, when(r.RECEIVED)); td(tr, r.NAME); td(tr, r.ROLE); td(tr, r.MARKET); td(tr, fmtHr(r._bh), 'mp-num');
      td(tr, r.AF_CHECKED ? 'Checked ' + d3.timeFormat('%b %-d')(new Date(r.AF_CHECKED)) + ': no reply found' : 'Not checked yet');
      tb.appendChild(tr);
    });
  });

  // Weekly trend (last 8 weeks, Monday start).
  dash.draw('cmWeeks', (tb) => {
    tb.replaceChildren();
    const c = rowsOf('comm_calls') || [], m = rowsOf('resp_email') || [];
    const wk = d3.timeMonday;
    const W = new Map();
    const w = (s) => { const k = +wk.floor(new Date(s)); if (!W.has(k)) W.set(k, { k, mIn: 0, mAns: 0, mMiss: 0, mNotBack: 0, inN: 0, ans: 0, miss: 0, notBack: 0, wait: [], out: 0, mail: 0, repH: [] }); return W.get(k); };
    c.forEach((r) => {
      const x = w(r.START);
      const nb = r.CALLBACK_MIN === null && !r.CALLED_AGAIN;
      if (r.DIR === 'in' && isMain(r)) { x.mIn++; if (r.ANSWERED) { x.mAns++; if (r.WAIT_S !== null) x.wait.push(+r.WAIT_S); } else { x.mMiss++; if (nb) x.mNotBack++; } }
      else if (r.DIR === 'in') { x.inN++; if (r.ANSWERED) x.ans++; else { x.miss++; if (nb) x.notBack++; } }
      else x.out++;
    });
    m.map(norm).forEach((r) => { const x = w(r.RECEIVED); x.mail++; if (r._rep) x.repH.push(r._bh); });
    Array.from(W.values()).sort((a, b) => b.k - a.k).slice(0, 8).forEach((x) => {
      const tr = document.createElement('tr');
      td(tr, 'Week of ' + d3.timeFormat('%b %-d')(new Date(x.k)));
      td(tr, x.mIn, 'mp-num'); td(tr, pct(x.mAns, x.mIn), 'mp-num'); td(tr, fmtSec(med(x.wait)), 'mp-num'); td(tr, x.mNotBack, 'mp-num');
      td(tr, x.inN, 'mp-num'); td(tr, pct(x.ans, x.inN), 'mp-num'); td(tr, x.notBack, 'mp-num');
      td(tr, x.out, 'mp-num'); td(tr, x.mail, 'mp-num'); td(tr, fmtHr(med(x.repH)), 'mp-num');
      tb.appendChild(tr);
    });
  });

  dash.draw('cmAsOf', (el) => {
    const T = window.mpDsTimes || {};
    const t = [T.comm_calls, T.resp_email].filter(Boolean).sort().pop();
    el.textContent = t ? 'Updated ' + when(t) + '.' : '';
  });

  document.querySelectorAll('[data-cmdays]').forEach((b) => b.addEventListener('click', () => {
    view.days = +b.getAttribute('data-cmdays');
    document.querySelectorAll('[data-cmdays]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    ['cmMainIn', 'cmMainInN', 'cmMainMiss', 'cmMainMissN', 'cmMainBack', 'cmMainBackN', 'cmMainMissed', 'cmIn', 'cmInN', 'cmMiss', 'cmMissN', 'cmWait', 'cmOut', 'cmOutN', 'cmMail', 'cmMailN', 'cmPeople', 'cmMissed', 'cmMailWait'].forEach((n) => dash.draw(n));
  }));
})();
