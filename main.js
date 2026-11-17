// Sign-in (email link restricted to Motion domains) and dataset loading from Supabase.
(function () {
  const SUPABASE_URL = 'https://duzghrvvnkfxerkwyokm.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_64xUNodPw5lzPKKzQe7_Ag_GukiIoBE';
  const DOMAINS = ['motionpmg.com', 'motionpropertypreservation.com', 'motionrealty.com'];
  const okEmail = (e) => DOMAINS.some((d) => String(e || '').toLowerCase().trim().endsWith('@' + d));

  const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' } });
  const $ = (id) => document.getElementById(id);
  const app = $('app'), login = $('login'), msg = $('loginMsg');
  let updated = null;

  dash.draw('lastUpdated', (el) => {
    el.textContent = updated ? 'Data last loaded into the app: ' + d3.timeFormat('%a %b %-d, %-I:%M %p')(updated) + '.' : '';
  });

  const load = async () => {
    const { data, error } = await sb.from('datasets').select('id,kind,rows,updated_at');
    if (error) { showLogin('Could not load data: ' + error.message); return; }
    if (!data.length) { showLogin('Signed in, but no data is shared with this account. Use your @motionpmg.com, @motionpropertypreservation.com or @motionrealty.com email.'); return; }
    data.forEach((d) => dash._setDataset(d.id, 'ok', d.rows));
    updated = new Date(d3.max(data, (d) => new Date(d.updated_at)));
    dash._redraw();
  };

  const showApp = () => { login.hidden = true; app.hidden = false; load(); };
  const showLogin = (text) => { app.hidden = true; login.hidden = false; msg.textContent = text || ''; };

  $('loginForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const email = $('email').value.trim().toLowerCase();
    if (!okEmail(email)) { msg.textContent = 'Use your Motion email (@motionpmg.com, @motionpropertypreservation.com or @motionrealty.com).'; return; }
    msg.textContent = 'Sending…';
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname + location.search } });
    msg.textContent = error ? 'Could not send the email: ' + error.message : 'Check ' + email + ' for a sign-in link (and the 6-digit code, if shown). It can take a minute.';
    if (!error) $('codeRow').hidden = false;
  });
  $('codeForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const { error } = await sb.auth.verifyOtp({ email: $('email').value.trim().toLowerCase(), token: $('code').value.trim(), type: 'email' });
    if (error) msg.textContent = 'That code did not work: ' + error.message;
  });
  $('signOut').addEventListener('click', async () => { await sb.auth.signOut(); showLogin('Signed out.'); });

  let shown = false;
  sb.auth.onAuthStateChange((event, session) => {
    if (session && okEmail(session.user.email)) { if (!shown) { shown = true; showApp(); } }
    else if (session) { sb.auth.signOut(); showLogin('Only Motion email addresses can open this dashboard.'); }
    else { shown = false; showLogin(msg.textContent); }
  });
  // Pick up fresh data every 15 minutes without a reload.
  setInterval(() => { if (shown) load(); }, 15 * 60 * 1000);
})();
