/* Shiori · accounts and cloud sync (Supabase).
   Progress always lives in this browser first; when signed in it is merged with
   the copy saved to your account, so phone and laptop share one progress. */
(function () {
  var cfg = window.SHIORI_CONFIG || {};
  var enabled = !!(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  var client = enabled ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, { auth: { persistSession: true, autoRefreshToken: true } }) : null;
  var user = null, timer = null, busy = false, again = false, synced = false, status = 'local';

  /* ---------- merge two progress records without losing anything ---------- */
  function union(a, b, pick) {
    var out = {}, k;
    a = a || {}; b = b || {};
    for (k in a) out[k] = a[k];
    for (k in b) out[k] = k in out ? pick(out[k], b[k]) : b[k];
    return out;
  }
  // after a reset, a copy from before it (e.g. another device) only keeps answers given after the reset
  function since(x, r) {
    if ((x.resetAt || 0) >= r) return x;
    var items = {};
    for (var id in x.items || {}) if ((x.items[id].t || 0) >= r) items[id] = x.items[id];
    return { items: items, settings: x.settings, u: x.u };
  }
  function merge(a, b) {
    a = a || {}; b = b || {};
    // a copy saved before the kanji decks were re-levelled still uses the old kanji ids: move them first
    [a, b].forEach(function (x) { if (x.items && !x.v9 && Shiori.remapKanji(x)) x.v9 = 1; });
    var r = Math.max(a.resetAt || 0, b.resetAt || 0);
    if (r) { a = since(a, r); b = since(b, r); }
    var newer = (b.u || 0) > (a.u || 0) ? b : a;
    return {
      items: union(a.items, b.items, function (x, y) { return (y.t || 0) > (x.t || 0) ? y : x; }),
      days: union(a.days, b.days, Math.max),
      met: union(a.met, b.met, function () { return 1; }),
      stamps: currentStamps(union(a.stamps, b.stamps, Math.min)),
      sets: union(a.sets, b.sets, Math.min),
      settings: newer.settings || a.settings || b.settings || {},
      last: newer.last || a.last || b.last || null,
      xp: Math.max(a.xp || 0, b.xp || 0),
      reviews: Math.max(a.reviews || 0, b.reviews || 0),
      v3: a.v3 || b.v3, v4: a.v4 || b.v4, v5: a.v5 || b.v5, v6: a.v6 || b.v6, v7: a.v7 || b.v7, v8: a.v8 || b.v8, v9: a.v9 || b.v9,
      rd: union(a.rd, b.rd, Math.max),
      lr: union(a.lr, b.lr, function (x, y) { return (y.t || 0) > (x.t || 0) ? y : x; }), tests: union(a.tests, b.tests, function (x) { return x; }), lastT: Math.max(a.lastT || 0, b.lastT || 0),
      pace: union(a.pace, b.pace, function (x, y) { return (y[1] || 0) > (x[1] || 0) ? y : x; }),
      ed: union(a.ed, b.ed, Math.max), ld: union(a.ld, b.ld, Math.max), triple: a.triple || b.triple,
      perfect: Math.max(+a.perfect || 0, +b.perfect || 0),
      u: Math.max(a.u || 0, b.u || 0), resetAt: r || undefined
    };
  }
  // an account copy saved before the v4 stamp change may still hold the old easy stamps
  function currentStamps(st) {
    var ok = {}, out = {};
    Shiori.STAMPS.forEach(function (x) { ok[x[0]] = 1; });
    for (var k in st) if (ok[k]) out[k] = st[k];
    return out;
  }
  function canon(v) {
    if (Array.isArray(v)) return v.map(canon);
    if (v && typeof v === 'object') { var o = {}; Object.keys(v).sort().forEach(function (k) { if (v[k] !== undefined) o[k] = canon(v[k]); }); return o; }
    return v;
  }
  function same(a, b) { return JSON.stringify(canon(a)) === JSON.stringify(canon(b)); }

  /* ---------- pull / push ---------- */
  function setStatus(s) {
    status = s;
    var b = document.querySelector('.acct-btn');
    if (b) {
      b.classList.toggle('signed-in', !!user);
      b.setAttribute('title', user ? 'Signed in as ' + user.email + ' · ' + ({ synced: 'progress saved', saving: 'saving…', offline: 'offline — will sync later', error: 'sync problem' }[s] || '') : 'Sign in to save progress across devices');
      b.dataset.initial = user ? (user.email || '?').charAt(0).toUpperCase() : '';
    }
    document.dispatchEvent(new CustomEvent('shiori-sync', { detail: { status: s, user: user } }));
  }
  function remote() {
    return client.from('progress').select('data').eq('user_id', user.id).maybeSingle().then(function (r) {
      if (r.error) throw r.error;
      return r.data ? r.data.data : null;
    });
  }
  // fetch the account copy, merge with this browser, store both
  function sync() {
    if (!user) return Promise.resolve();
    if (busy) { again = true; return Promise.resolve(); }
    busy = true; setStatus('saving');
    var first = !synced; synced = true;
    return remote().then(function (cloud) {
      // read this browser's copy only now, so answers given while the fetch was running are kept
      var local = Shiori._read(), merged = merge(local, cloud);
      var localChanged = !same(merged, merge(local, null));
      Shiori._write(merged, true);
      var write = cloud && same(merge(cloud, null), merged) ? null :
        client.from('progress').upsert({ user_id: user.id, data: merged, updated_at: new Date().toISOString() });
      return Promise.resolve(write).then(function (r) {
        if (r && r.error) throw r.error;
        setStatus('synced');
        // progress arrived from another device: redraw once so the page shows it (never mid-session)
        if (first && localChanged && !sessionStorage.getItem('shiori_synced_reload')) {
          sessionStorage.setItem('shiori_synced_reload', '1');
          location.reload();
        } else sessionStorage.removeItem('shiori_synced_reload');
      });
    }).catch(function (e) {
      console.warn('Shiori sync:', e && e.message);
      setStatus(navigator.onLine ? 'error' : 'offline');
    }).then(function () {
      busy = false;
      if (again) { again = false; sync(); }
    });
  }
  function changed() {
    if (!user) return;
    clearTimeout(timer);
    timer = setTimeout(sync, 2000);
  }

  window.ShioriSync = {
    enabled: enabled, client: client, merge: merge, changed: changed, sync: sync, paint: function () { setStatus(status); },
    user: function () { return user; }, status: function () { return status; }
  };

  if (!enabled) return;
  client.auth.getSession().then(function (r) {
    user = r.data.session ? r.data.session.user : null;
    setStatus(user ? 'synced' : 'local');
    if (user) sync();
  });
  client.auth.onAuthStateChange(function (event, session) {
    var was = user && user.id;
    user = session ? session.user : null;
    setStatus(user ? status : 'local');
    if (user && user.id !== was) sync();
  });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && timer) { clearTimeout(timer); timer = null; sync(); } });
  window.addEventListener('online', function () { if (user) sync(); });
})();
