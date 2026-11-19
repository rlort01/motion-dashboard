// Map tab: every property managed now or since January 2025 (props_geo), colored by status, with off-target
// properties (a unit vacant 30+ days or a critical work order open) flashing red. Also builds a KML file that can
// be imported into Google My Maps.
(function () {
  const DAY = 86400000;
  const COLORS = { urgent: '#e03131', vacant: '#fcc419', oldwo: '#fd7e14', leaving: '#343a40', newp: '#1c7ed6', active: '#2b8a3e', hoa: '#7048e8', left: '#adb5bd' };
  const FLASH = { urgent: 1, vacant: 1, oldwo: 1 };
  const LABEL = { urgent: 'Urgent work order open (flashing)', vacant: 'Unit vacant 30+ days (flashing)', oldwo: 'Work order open 30+ days (flashing)', leaving: 'Leaving (end date set)', newp: 'Onboarded in the last 90 days', active: 'Managed', hoa: 'HOA (not counted as doors)', left: 'Offboarded' };
  const view = { show: 'current' };
  let map = null, layer = null;
  const rowsOf = (id) => { const d = dash.data(id); return d.status === 'ok' && Array.isArray(d.data) ? d.data : null; };
  const t = (s) => (s ? Date.parse(String(s).slice(0, 10) + 'T12:00:00') : NaN);
  const fmtD = (s) => (s ? d3.timeFormat('%b %-d, %Y')(new Date(t(s))) : '');
  const key = (a) => { const w = String(a || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean); return w.length >= 2 ? w[0] + ' ' + w[1] : ''; };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ST = { Georgia: 'GA', Tennessee: 'TN', 'North Carolina': 'NC' };

  const points = () => {
    const props = rowsOf('props_geo') || [], now = Date.now();
    const vac = (rowsOf('vacancy') || []).filter((v) => /^vacant/i.test(v.STATUS || ''));
    const vacBy = d3.group(vac, (v) => key(v.ADDRESS));
    const board = rowsOf('board') || [];
    const crit = d3.group(board.filter((r) => r.priority === 'Urgent' && !/inspection/i.test(r.kind || '')), (r) => key(r.address));
    const oldWo = d3.group(board.filter((r) => r.days >= 30 && r.priority !== 'Urgent' && !/inspection/i.test(r.kind || '')), (r) => key(r.address));
    const m = dash.params().market;
    return props.filter((p) => p.LAT && (!m || m === 'Combined' || ST[m] === p.STATE)).map((p) => {
      const k = key(p.ADDRESS), ended = p.END && t(p.END) <= now, leaving = p.END && t(p.END) > now;
      const v = (vacBy.get(k) || []).map((x) => ({ unit: x.UNIT, days: +x.DAYS || (x.MOVE_OUT ? Math.round((now - t(x.MOVE_OUT)) / DAY) : null) }));
      const c = crit.get(k) || [], old = (oldWo.get(k) || []);
      const why = [];
      const long = ended ? [] : v.filter((x) => (x.days || 0) >= 30);
      if (!ended) {
        if (c.length) why.push(c.length + ' urgent work order' + (c.length > 1 ? 's' : '') + ' open (' + c.map((r) => '#' + r.wo).join(', ') + ')');
        if (long.length) why.push(long.length + ' unit' + (long.length > 1 ? 's' : '') + ' vacant 30+ days (longest ' + Math.max(...long.map((x) => x.days)) + ')');
        if (old.length) why.push(old.length + ' work order' + (old.length > 1 ? 's' : '') + ' open 30+ days (' + old.map((r) => '#' + r.wo).join(', ') + ')');
      }
      const issue = ended ? null : c.length ? 'urgent' : long.length ? 'vacant' : old.length ? 'oldwo' : null;
      const isNew = p.START && now - t(p.START) <= 90 * DAY && t(p.START) <= now;
      const hoa = /^hoa$/i.test(p.TYPE || '');
      const status = ended ? 'left' : issue ? issue : hoa ? 'hoa' : leaving ? 'leaving' : isNew ? 'newp' : 'active';
      return { p, status, why, vac: v, isNew, leaving, ended, zip: /^ZIP /.test(p.MATCHED || '') };
    });
  };
  const visible = (pts) => pts.filter((x) => view.show === 'all' ? true : view.show === 'offtarget' ? !!FLASH[x.status] : view.show === 'changes' ? (x.isNew || x.leaving || (x.ended && Date.now() - t(x.p.END) <= 90 * DAY)) : !x.ended);

  const popup = (x) => {
    const p = x.p;
    return '<strong>' + esc(p.ADDRESS) + '</strong><br>' + esc(p.OWNER || '') + '<br>' + esc(p.UNITS) + (/^hoa$/i.test(p.TYPE || '') ? ' HOA homes' : ' door' + (+p.UNITS === 1 ? '' : 's')) + ' · ' + esc(p.TYPE || '') +
      '<br>Managed ' + (p.START ? 'since ' + fmtD(p.START) : '') + (p.END ? (x.ended ? ' until ' : ' · ends ') + fmtD(p.END) : '') +
      (x.why.length ? '<br><span style="color:' + COLORS.urgent + '"><strong>Needs attention:</strong> ' + esc(x.why.join('; ')) + '</span>' : '') +
      (x.vac.length && !x.why.length ? '<br>Vacant: ' + x.vac.map((v) => esc(v.unit) + (v.days !== null ? ' (' + v.days + ' days)' : '')).join(', ') : '');
  };

  dash.draw('mapLegend', (el) => {
    const pts = rowsOf('props_geo') ? points() : [];
    const n = d3.rollup(pts, (v) => v.length, (x) => x.status);
    el.innerHTML = Object.keys(LABEL).map((k) => '<span><i style="background:' + COLORS[k] + '"></i>' + LABEL[k] + ' (' + (n.get(k) || 0) + ')</span>').join('');
  });

  dash.draw('propMap', (el) => {
    if (!window.L || !rowsOf('props_geo')) return;
    if (!map) {
      map = L.map(el, { scrollWheelZoom: true }).setView([34.4, -83.5], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
      layer = L.layerGroup().addTo(map);
      window.addEventListener('mp-tab', (e) => { if (e.detail === 'map') setTimeout(() => { map.invalidateSize(); fit(); }, 50); });
    }
    layer.clearLayers();
    const pts = visible(points());
    // Off-target pins last so they sit on top.
    const rank = { urgent: 3, vacant: 2, oldwo: 1 };
    pts.sort((a, b) => (rank[a.status] || 0) - (rank[b.status] || 0)).forEach((x) => {
      // Round SVG pins: a colored dot with a white ring; properties with issues get a soft pulsing halo.
      const flash = !!FLASH[x.status], d = flash ? 16 : 12, box = flash ? 44 : 16, c = COLORS[x.status], r = d / 2;
      const dot = x.zip
        ? '<circle cx="' + box / 2 + '" cy="' + box / 2 + '" r="' + (r - 1) + '" fill="#fff" stroke="' + c + '" stroke-width="3"/>'
        : '<circle cx="' + box / 2 + '" cy="' + box / 2 + '" r="' + r + '" fill="' + c + '" stroke="#fff" stroke-width="2"/>';
      const halo = flash ? '<circle class="mp-halo' + (x.status === 'urgent' ? ' mp-halo-fast' : '') + '" cx="' + box / 2 + '" cy="' + box / 2 + '" r="' + r + '" fill="' + c + '"/>' : '';
      const icon = L.divIcon({ className: 'mp-pin-wrap', iconSize: [box, box], iconAnchor: [box / 2, box / 2],
        html: '<svg width="' + box + '" height="' + box + '" viewBox="0 0 ' + box + ' ' + box + '" style="overflow:visible;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35))">' + halo + dot + '</svg>' });
      L.marker([+x.p.LAT, +x.p.LON], { icon, title: x.p.ADDRESS, zIndexOffset: (rank[x.status] || 0) * 1000 }).bindPopup(popup(x)).addTo(layer);
    });
    fit = () => { const b = pts.map((x) => [+x.p.LAT, +x.p.LON]); if (b.length) map.fitBounds(b, { padding: [30, 30], maxZoom: 12 }); };
    if (!el.dataset.fitted || el.dataset.view !== view.show) { el.dataset.fitted = '1'; el.dataset.view = view.show; if (el.offsetWidth) fit(); }
    kml(points());
  });
  let fit = () => {};

  // KML for Google My Maps (File > Import in My Maps). One folder per status; off target in red.
  const kml = (pts) => {
    const a = document.getElementById('map-kml'); if (!a) return;
    const hex = (c) => 'ff' + c.slice(5, 7) + c.slice(3, 5) + c.slice(1, 3); // KML colors are aabbggrr
    const styles = Object.keys(COLORS).map((k) => '<Style id="' + k + '"><IconStyle><color>' + hex(COLORS[k]) + '</color><Icon><href>https://maps.google.com/mapfiles/kml/paddle/wht-blank.png</href></Icon></IconStyle></Style>').join('');
    const folders = Object.keys(LABEL).map((k) => '<Folder><name>' + LABEL[k] + '</name>' + pts.filter((x) => x.status === k).map((x) =>
      '<Placemark><name>' + esc(x.p.ADDRESS) + '</name><styleUrl>#' + k + '</styleUrl><description>' + esc([x.p.OWNER, x.p.UNITS + ' doors', x.p.START ? 'Since ' + x.p.START : '', x.p.END ? 'End ' + x.p.END : '', x.why.join('; ')].filter(Boolean).join(' | ')) +
      '</description><Point><coordinates>' + x.p.LON + ',' + x.p.LAT + ',0</coordinates></Point></Placemark>').join('') + '</Folder>').join('');
    const doc = '<?xml version="1.0" encoding="UTF-8"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>Motion properties ' + new Date().toISOString().slice(0, 10) + '</name>' + styles + folders + '</Document></kml>';
    if (a.dataset.url) URL.revokeObjectURL(a.dataset.url);
    a.dataset.url = URL.createObjectURL(new Blob([doc], { type: 'application/vnd.google-earth.kml+xml' }));
    a.href = a.dataset.url;
  };

  document.querySelectorAll('[data-mapshow]').forEach((b) => b.addEventListener('click', () => {
    view.show = b.getAttribute('data-mapshow');
    document.querySelectorAll('[data-mapshow]').forEach((x) => x.setAttribute('aria-pressed', x === b ? 'true' : 'false'));
    dash.draw('propMap');
  }));
})();
