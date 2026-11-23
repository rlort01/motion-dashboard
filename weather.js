// Weather on the Map tab: live National Weather Service alerts (warnings, watches, advisories) for GA, TN and NC,
// drawn as shaded areas, plus a NEXRAD radar layer. Lists the properties we manage that sit inside an active alert.
// Refreshes every 10 minutes while the page is open. Public data, no keys; nothing about our properties is sent out.
(function () {
  const ALERTS = 'https://api.weather.gov/alerts/active?area=GA,TN,NC&status=actual&message_type=alert,update';
  // Live radar loop: the last 50 minutes in 5-minute frames (Iowa Environmental Mesonet NEXRAD mosaic), newest last.
  const RFRAMES = ['m50m', 'm45m', 'm40m', 'm35m', 'm30m', 'm25m', 'm20m', 'm15m', 'm10m', 'm05m', ''];
  const RURL = (f) => 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0/nexrad-n0q-900913' + (f ? '-' + f : '') + '/{z}/{x}/{y}.png';
  const zoneCache = new Map();
  const state = { alerts: [], at: null, err: null, showAlerts: true, showRadar: false };
  let map = null, alertLayer = null, radarGroup = null, radarFrames = [], radarTimer = null, radarIdx = 0, radarStamp = 0;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const kind = (ev) => /warning/i.test(ev) ? 'warning' : /watch/i.test(ev) ? 'watch' : /advisory/i.test(ev) ? 'advisory' : 'statement';
  const COLOR = { warning: '#e03131', watch: '#f76707', advisory: '#f5c400', statement: '#4dabf7' };
  const RANK = { warning: 4, watch: 3, advisory: 2, statement: 1 };
  const fmt = (s) => (s ? new Date(s).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }) : '');

  // Point in polygon (GeoJSON Polygon / MultiPolygon, [lon, lat]).
  const inRing = (x, y, ring) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const inPoly = (x, y, poly) => inRing(x, y, poly[0]) && !poly.slice(1).some((h) => inRing(x, y, h));
  const inGeom = (lon, lat, g) => !g ? false : g.type === 'Polygon' ? inPoly(lon, lat, g.coordinates) : g.type === 'MultiPolygon' ? g.coordinates.some((p) => inPoly(lon, lat, p)) : g.type === 'GeometryCollection' ? g.geometries.some((x) => inGeom(lon, lat, x)) : false;

  const getJSON = async (url) => { const r = await fetch(url, { headers: { Accept: 'application/geo+json' } }); if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); };
  const zone = async (url) => {
    if (!zoneCache.has(url)) zoneCache.set(url, getJSON(url).then((z) => z.geometry).catch(() => null));
    return zoneCache.get(url);
  };
  const refresh = async () => {
    try {
      const j = await getJSON(ALERTS);
      const feats = (j.features || []).filter((f) => f.properties && !/test/i.test(f.properties.event || ''));
      // Alerts without their own shape cover whole forecast zones or counties: fetch those shapes (cached).
      const urls = Array.from(new Set(feats.filter((f) => !f.geometry).flatMap((f) => f.properties.affectedZones || []))).slice(0, 150);
      for (let i = 0; i < urls.length; i += 10) await Promise.all(urls.slice(i, i + 10).map(zone));
      state.alerts = await Promise.all(feats.map(async (f) => {
        let geom = f.geometry;
        if (!geom) { const gs = (await Promise.all((f.properties.affectedZones || []).map((u) => zoneCache.get(u) || null))).filter(Boolean); geom = gs.length ? { type: 'GeometryCollection', geometries: gs } : null; }
        const p = f.properties;
        return { id: f.id, event: p.event, k: kind(p.event), headline: p.headline, area: p.areaDesc, sev: p.severity, ends: p.ends || p.expires, onset: p.onset || p.effective, desc: p.description, instr: p.instruction, geom };
      }));
      state.alerts.sort((a, b) => RANK[b.k] - RANK[a.k]);
      state.at = new Date(); state.err = null;
    } catch (e) { state.err = 'Weather alerts could not be loaded right now (' + e.message + ').'; }
    draw();
  };

  const props = () => {
    const d = dash.data('props_geo'); if (d.status !== 'ok' || !Array.isArray(d.data)) return [];
    const now = Date.now();
    return d.data.filter((p) => p.LAT && !(p.END && Date.parse(p.END + 'T12:00:00') <= now));
  };
  const hits = () => {
    const ps = props(), out = [];
    state.alerts.forEach((a) => { if (!a.geom) return; const inside = ps.filter((p) => inGeom(+p.LON, +p.LAT, a.geom)); if (inside.length) out.push({ a, inside }); });
    return out;
  };

  // Show the radar as a loop: step through the frames, pause on the newest one.
  const radar = (fresh) => {
    if (!map || !radarGroup) return;
    const lbl = document.getElementById('wxRadarTime');
    if (!state.showRadar) {
      if (map.hasLayer(radarGroup)) map.removeLayer(radarGroup);
      clearTimeout(radarTimer); radarTimer = null; if (lbl) lbl.textContent = '';
      return;
    }
    const stamp = Math.floor(Date.now() / 300000);
    if (fresh || stamp !== radarStamp) { radarStamp = stamp; radarFrames.forEach((l, i) => l.setUrl(RURL(RFRAMES[i]) + '?t=' + stamp)); }
    if (!map.hasLayer(radarGroup)) { radarFrames.forEach((l) => radarGroup.addLayer(l)); radarGroup.addTo(map); }
    if (radarTimer) return;
    const step = () => {
      radarFrames.forEach((l, i) => l.setOpacity(i === radarIdx ? 0.6 : 0));
      const mins = (RFRAMES.length - 1 - radarIdx) * 5, t = new Date(Math.floor(Date.now() / 300000) * 300000 - mins * 60000);
      if (lbl) lbl.textContent = 'Radar ' + t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) + (mins ? '' : ' (latest)');
      const last = radarIdx === RFRAMES.length - 1;
      radarIdx = last ? 0 : radarIdx + 1;
      radarTimer = setTimeout(step, last ? 2000 : 450);
    };
    step();
  };

  const draw = () => {
    if (!map) return;
    alertLayer.clearLayers();
    if (state.showAlerts) state.alerts.slice().reverse().forEach((a) => {
      if (!a.geom) return;
      L.geoJSON(a.geom, { pane: 'wx', style: { color: COLOR[a.k], weight: 2, opacity: 0.9, fillColor: COLOR[a.k], fillOpacity: a.k === 'statement' ? 0.08 : 0.18, interactive: true } })
        .bindPopup('<strong>' + esc(a.event) + '</strong><br>' + esc(a.headline || '') + (a.ends ? '<br>Until ' + esc(fmt(a.ends)) : '') + '<br><small>' + esc((a.area || '').slice(0, 300)) + '</small>')
        .addTo(alertLayer);
    });
    radar();
    dash.draw('wxSummary'); dash.draw('wxTable');
  };

  window.addEventListener('mp-map-ready', () => {
    map = window.mpMap;
    map.createPane('wx'); map.getPane('wx').style.zIndex = 390; // under the property pins
    alertLayer = L.layerGroup().addTo(map);
    radarGroup = L.layerGroup();
    radarFrames = RFRAMES.map((f) => L.tileLayer(RURL(f), { opacity: 0, pane: 'wx', attribution: 'Radar: Iowa Environmental Mesonet / NWS' }));
    setInterval(() => { if (state.showRadar) radar(true); }, 5 * 60 * 1000); // new frames every 5 minutes
    refresh(); setInterval(refresh, 10 * 60 * 1000);
  });

  dash.draw('wxSummary', (el) => {
    const h = hits(), n = h.reduce((x, r) => x + r.inside.length, 0), worst = h[0];
    const counts = d3.rollup(state.alerts, (v) => v.length, (a) => a.k);
    el.innerHTML = state.err ? esc(state.err) :
      !state.at ? 'Loading weather alerts…' :
      (h.length ? '<strong style="color:' + COLOR[worst.a.k] + '">' + n + ' propert' + (n === 1 ? 'y is' : 'ies are') + ' inside an active weather alert.</strong> '
        : '<strong>No managed properties are inside an active weather alert.</strong> ') +
      'Active in GA, TN and NC: ' + ['warning', 'watch', 'advisory', 'statement'].map((k) => (counts.get(k) || 0) + ' ' + k + (counts.get(k) === 1 ? '' : k === 'watch' ? 'es' : 's')).join(', ') +
      '. <span class="mp-meta">National Weather Service, checked ' + esc(fmt(state.at)) + '.</span>';
  });
  dash.draw('wxTable', (el) => {
    const h = hits();
    el.innerHTML = !h.length ? '' :
      '<table class="mp-table"><thead><tr><th>Alert</th><th>Until</th><th>Properties</th><th>What to do</th></tr></thead><tbody>' +
      h.map(({ a, inside }) => '<tr><td><span class="mp-pill" style="background:' + COLOR[a.k] + ';color:' + (a.k === 'advisory' ? '#222' : '#fff') + '">' + esc(a.event) + '</span></td><td>' + esc(fmt(a.ends)) + '</td><td>' +
        inside.map((p) => esc(p.ADDRESS) + (/^hoa$/i.test(p.TYPE || '') ? ' (HOA)' : '')).join('<br>') + '</td><td><small>' + esc((a.instr || a.headline || '').slice(0, 280)) + '</small></td></tr>').join('') +
      '</tbody></table>';
  });

  document.querySelectorAll('[data-wx]').forEach((b) => b.addEventListener('click', () => {
    const k = b.getAttribute('data-wx'); state[k] = !state[k]; b.setAttribute('aria-pressed', state[k] ? 'true' : 'false'); draw();
  }));
})();
