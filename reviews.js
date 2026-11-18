// Google review ratings per location, shown under the title on the main page.
(function () {
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const stars = (r) => { const full = Math.round(r); return '★'.repeat(full) + '☆'.repeat(5 - full); };
  dash.draw('reviews', (el) => {
    const rows = rowsOf('reviews');
    if (!rows) { el.textContent = ''; return; }
    const mk = dash.params().market;
    const show = rows.filter((r) => !mk || mk === 'Combined' || r.MARKET === mk);
    el.innerHTML = '';
    show.forEach((r) => {
      const rating = +r.RATING, low = rating < 4.2;
      const a = document.createElement('a');
      a.className = 'mp-review' + (low ? ' mp-review-low' : '');
      a.href = r.MAPS; a.target = '_blank'; a.rel = 'noopener';
      a.title = r.LOCATION + ': open on Google Maps';
      const name = document.createElement('span'); name.className = 'mp-review-name'; name.textContent = r.MARKET;
      const val = document.createElement('span'); val.className = 'mp-review-val'; val.textContent = rating.toFixed(1);
      const st = document.createElement('span'); st.className = 'mp-review-stars'; st.textContent = stars(rating);
      const n = document.createElement('span'); n.className = 'mp-review-n';
      n.textContent = r.TOTAL + ' reviews' + (+r.NEW_30D ? ' · ' + r.NEW_30D + ' new in 30 days' : '');
      a.append(name, val, st, n);
      el.appendChild(a);
    });
    if (show.length) {
      const asof = document.createElement('span'); asof.className = 'mp-review-asof';
      asof.textContent = 'Google reviews as of ' + rows[0].AS_OF + (mk === 'Georgia' || !mk || mk === 'Combined' ? '. Georgia is the Loganville profile.' : '.');
      el.appendChild(asof);
    }
  });
})();
