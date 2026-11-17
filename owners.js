// Owner-handled work orders: AppFolio work orders assigned to the property's owner, with follow-up flags.
(function () {
  const GROUPS = { Combined: ['GA-ATL', 'GA-MAC', 'GA-FTV', 'TN-CHA', 'NC-CLT', 'NC-RAL'], Georgia: ['GA-ATL', 'GA-MAC', 'GA-FTV'], Tennessee: ['TN-CHA'], 'North Carolina': ['NC-CLT', 'NC-RAL'] };
  const DAY = 86400000, today = new Date();
  const iso = (d) => d.toISOString().slice(0, 10);
  const daysSince = (s) => (s ? Math.max(0, Math.floor((today - new Date(s + 'T12:00:00')) / DAY)) : null);
  const td = (tr, text, cls) => { const c = document.createElement('td'); if (cls) c.className = cls; c.textContent = text === null || text === undefined ? '' : text; tr.appendChild(c); return c; };
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const view = { v: 'follow' };

  dash.calc('ownerWo', {
    title: 'Work orders the owner is handling',
    description: 'AppFolio work orders in 2026 assigned to the property owner, for the selected market, with a follow-up reason: still open more than 7 days (2 for urgent), closed in the last 14 days without a vendor bill (confirm with the tenant), or a property with 3 or more owner work orders in 90 days.',
    inputs: ['owner_wo'],
    fn: (rows) => {
      const g = GROUPS[dash.params().market] || GROUPS.Combined;
      const since90 = iso(new Date(today - 90 * DAY));
      const recent = new Map();
      rows.filter((r) => r.CREATED >= since90 && !r.STATUS.startsWith('Canceled')).forEach((r) => recent.set(r.ADDRESS, (recent.get(r.ADDRESS) || 0) + 1));
      return rows.filter((r) => g.includes(r.GROUP)).map((r) => {
        const open = !/^(Completed|Canceled)/.test(r.STATUS);
        const age = daysSince(r.CREATED), closedAgo = daysSince(r.COMPLETED);
        const repeat = (recent.get(r.ADDRESS) || 0) >= 3;
        let follow = '';
        if (open && age > (r.PRIORITY === 'Urgent' ? 2 : 7)) follow = 'Open ' + age + ' days: check with the owner';
        else if (open) follow = 'Open: owner handling';
        else if (r.STATUS.startsWith('Completed') && closedAgo !== null && closedAgo <= 14) follow = 'Closed ' + closedAgo + ' days ago: confirm with the tenant';
        return { wo: r.WO, sr: r.SR, group: r.GROUP, address: r.ADDRESS, owner: r.OWNER, priority: r.PRIORITY, status: r.STATUS,
          created: r.CREATED, completed: r.COMPLETED || null, age, open, repeat, repeatN: recent.get(r.ADDRESS) || 0,
          follow, needsAction: (open && age > (r.PRIORITY === 'Urgent' ? 2 : 7)) || /confirm/.test(follow), desc: r.DESC };
      });
    }
  });
  dash.calc('ownerSum', {
    title: 'Owner-handled work orders, totals',
    description: 'Open owner work orders, how many need a follow-up, owner work orders created in the last 30 days, and properties with repeat requests.',
    inputs: ['ownerWo'],
    fn: (t) => {
      const since30 = iso(new Date(today - 30 * DAY));
      const rep = new Set(t.filter((r) => r.repeat).map((r) => r.address));
      return [{ open: t.filter((r) => r.open).length, follow: t.filter((r) => r.needsAction).length,
        new30: t.filter((r) => r.created >= since30).length, done30: t.filter((r) => r.completed && r.completed >= since30).length,
        repeatProps: rep.size, total: t.length, owners: new Set(t.map((r) => r.owner)).size }];
    }
  });

  const one = () => { const r = rowsOf('ownerSum'); return r && r[0] ? r[0] : null; };
  const tile = (name, f) => dash.draw(name, (el) => { const s = one(); el.textContent = s ? f(s) : '—'; });
  tile('oOpen', (s) => String(s.open));
  tile('oFollow', (s) => String(s.follow));
  tile('oFollowN', (s) => 'open too long, or just closed and needing a tenant check');
  tile('oNew', (s) => String(s.new30));
  tile('oNewN', (s) => s.done30 + ' closed in the last 30 days');
  tile('oRepeat', (s) => String(s.repeatProps));
  tile('oTotal', (s) => s.total + ' owner work orders in 2026 across ' + s.owners + (s.owners === 1 ? ' owner' : ' owners'));

  document.querySelectorAll('[data-oview]').forEach((b) => b.addEventListener('click', () => {
    view.v = b.getAttribute('data-oview');
    document.querySelectorAll('[data-oview]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    dash.draw('ownerRows');
  }));
  dash.draw('ownerRows', (tb) => {
    const t = rowsOf('ownerWo'); tb.replaceChildren(); if (!t) return;
    const f = { follow: (r) => r.needsAction || r.open, open: (r) => r.open, repeat: (r) => r.repeat, all: () => true }[view.v] || (() => true);
    const list = t.filter(f).sort((a, b) => (b.needsAction - a.needsAction) || (b.open - a.open) || d3.descending(a.created, b.created));
    if (!list.length) { const tr = document.createElement('tr'); td(tr, 'Nothing to follow up on right now.'); tb.appendChild(tr); return; }
    list.forEach((r) => {
      const tr = document.createElement('tr'); tr.setAttribute('data-key', r.wo); tr.className = 'mp-owner';
      td(tr, '#' + r.wo); td(tr, r.group); td(tr, r.address); td(tr, r.owner); td(tr, r.desc);
      td(tr, r.status + (r.priority === 'Urgent' ? ' · Urgent' : ''));
      td(tr, r.created); td(tr, r.completed || '—');
      const fc = td(tr, '');
      if (r.follow) { const p = document.createElement('span'); p.className = 'mp-pill ' + (r.needsAction ? 'mp-bad' : 'mp-warn'); p.textContent = r.follow; fc.appendChild(p); }
      if (r.repeat) { const p = document.createElement('span'); p.className = 'mp-pill mp-warn'; p.style.marginLeft = '4px'; p.textContent = 'Repeat: ' + r.repeatN + ' in 90 days'; fc.appendChild(p); }
      tb.appendChild(tr);
    });
  });
})();
