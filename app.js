/* Shiori · shared app script: data loading, progress, furigana, voice, navigation */
(function () {
  var LEVELS = ['n5', 'n4', 'n3', 'n2', 'n1'];
  var LEVEL_INFO = {
    n5: { jp: '入門', en: 'Beginner' },
    n4: { jp: '初級', en: 'Elementary' },
    n3: { jp: '中級', en: 'Intermediate' },
    n2: { jp: '中上級', en: 'Upper intermediate' },
    n1: { jp: '上級', en: 'Advanced' }
  };
  var DECKS = {
    grammar: { name: 'Grammar', jp: '文法', short: 'g', icon: '<path d="M4 5a2 2 0 0 1 2-2h12v16H6a2 2 0 0 0-2 2z"/><path d="M4 19V5"/>' },
    kanji: { name: 'Kanji', jp: '漢字', short: 'k', icon: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M12 9v8M9 13h6"/>' },
    vocab: { name: 'Vocabulary', jp: '語彙', short: 'v', icon: '<rect x="3" y="6" width="8" height="12" rx="2"/><rect x="13" y="6" width="8" height="12" rx="2"/>' }
  };
  var DECK_ORDER = ['grammar', 'kanji', 'vocab'];
  var KEY = 'shiori_v2';

  /* ---------- storage ---------- */
  // the same word listed in two levels (data/manifest.js twins, easiest level first) is learned once:
  // answers are copied to the other copy, and counts and reviews only use the first one
  var TWIN = null, CANON = null;
  function twinMap() {
    if (TWIN) return;
    TWIN = {}; CANON = {};
    ((window.SHIORI_MANIFEST || {}).twins || []).forEach(function (p) {
      p.forEach(function (a) { TWIN[a] = p.filter(function (b) { return b !== a; }); CANON[a] = p[0]; });
    });
  }
  function twinsOf(id) { twinMap(); return TWIN[id] || []; }
  function isCopy(id, items) { twinMap(); return !!CANON[id] && CANON[id] !== id && !!items[CANON[id]]; }
  function mirror(s, id) { twinsOf(id).forEach(function (t) { s.items[t] = JSON.parse(JSON.stringify(s.items[id])); }); }

  // parsed copy is cached until the saved text changes (pages ask for item states thousands of times)
  var cacheRaw = null, cacheObj = null;
  function readStore() {
    var raw; try { raw = localStorage.getItem(KEY) || '{}'; } catch (e) { raw = '{}'; }
    if (raw === cacheRaw && cacheObj) return cacheObj;
    try { var s = JSON.parse(raw); } catch (e) { s = {}; }
    s.items = s.items || {}; s.days = s.days || {}; s.settings = s.settings || {};
    // v3: first-try "Knew it" now masters a card; upgrade cards answered that way before the change
    if (!s.v3) {
      for (var id in s.items) { var it = s.items[id]; if (!it.m && it.s === 1 && it.t < 1792760500000) { it.m = 1; it.iv = 0; it.d = it.t + INTERVALS[0] * DAY; } }
      s.v3 = 1;
    }
    // v4: stamps got much harder; drop the old easy ones (the ones whose rules didn't change are kept)
    if (!s.v4) {
      var keep = {}; STAMPS.forEach(function (x) { keep[x[0]] = 1; });
      for (var sid in (s.stamps || {})) if (!keep[sid]) delete s.stamps[sid];
      delete s.early; delete s.late; delete s.double;
      s.v4 = 1;
    }
    // v5: one correct answer now masters an item; master the ones whose last answer was right
    if (!s.v5) {
      for (var id5 in s.items) { var x = s.items[id5]; if (!x.m && x.s >= 1) { x.m = 1; x.mt = x.t; x.iv = 0; x.d = (x.t || Date.now()) + INTERVALS[0] * DAY; } }
      s.v5 = 1;
    }
    // v6: reviews were piling up — spread a big overdue backlog over the coming days
    if (!s.v6) {
      var now6 = Date.now(), late = [];
      for (var id6 in s.items) if (isDue(s.items[id6], now6)) late.push(s.items[id6]);
      if (late.length > 20) late.forEach(function (x, i) { x.d = now6 + Math.floor(i / 20) * DAY; });
      s.v6 = 1;
    }
    // v7: n2g90 is a different grammar point now (〜て初めて duplicated N3's 〜てはじめて); old progress doesn't carry over.
    // a fresh timestamp makes this win over older account copies when syncing
    if (!s.v7) {
      if (s.items.n2g90) s.items.n2g90 = { s: 0, t: Date.now() };
      s.v7 = 1;
    }
    // v8: seven more grammar slots got new points (they duplicated a lower level), and words listed in two levels are
    // now linked, so give each pair the most recent progress of either. Needs the manifest for the pairs.
    if (!s.v8 && window.SHIORI_MANIFEST) {
      var now8 = Date.now();
      ['n3g119', 'n3g106', 'n2g41', 'n2g16', 'n2g11', 'n2g10', 'n2g18'].forEach(function (g) { if (s.items[g]) s.items[g] = { s: 0, t: now8 }; });
      (SHIORI_MANIFEST.twins || []).forEach(function (p) {
        var best = null;
        p.forEach(function (x) { var it = s.items[x]; if (it && (!best || (it.t || 0) > (best.t || 0))) best = it; });
        if (best) p.forEach(function (x) { s.items[x] = JSON.parse(JSON.stringify(best)); });
      });
      s.v8 = 1;
    }
    // v9: kanji decks were re-levelled to the official lists; progress moves with its character
    if (!s.v9 && remapKanji(s)) s.v9 = 1;
    cacheRaw = raw; cacheObj = s;
    return s;
  }
  // old kanji id (by the deck order before v9) → same character's new id; also used by sync.js on older account copies
  function remapKanji(s) {
    var M = window.SHIORI_MANIFEST;
    if (!M || !M.kanjiOld || !s || !s.items) return false;
    var newId = {}, moved = {};
    LEVELS.forEach(function (l) { Array.from(M.kanjiNew[l]).forEach(function (c, i) { newId[c] = l + 'k' + (i + 1); }); });
    for (var id in s.items) {
      var m = /^(n\d)k(\d+)$/.exec(id); if (!m) continue;
      var c = Array.from(M.kanjiOld[m[1]] || '')[m[2] - 1];
      if (c && newId[c]) moved[newId[c]] = s.items[id];
      delete s.items[id];
    }
    for (var n in moved) s.items[n] = moved[n];
    return true;
  }
  // every save also tells the cloud sync (sync.js) that progress changed; quiet saves come from the sync itself
  function writeStore(s, quiet) {
    if (!quiet) s.u = Date.now();
    var raw = JSON.stringify(s);
    try { localStorage.setItem(KEY, raw); } catch (e) {}
    cacheRaw = raw; cacheObj = s;
    if (!quiet && window.ShioriSync) ShioriSync.changed();
  }
  function today() { var d = new Date(); return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }

  /* ---------- game layer: points, levels, goal, streak, spaced review, stamps ---------- */
  var DAY = 864e5;
  var INTERVALS = [1, 3, 7, 14, 30, 60, 120];          // days until a mastered item comes back
  var XP = { practice: 5, right: 10, wrong: 2, review: 15, mastered: 20, set: 30, goal: 25 };
  var RANKS = [[1, '見習い', 'Apprentice'], [5, '門下生', 'Student'], [10, '学徒', 'Scholar'], [20, '師範代', 'Assistant master'], [35, '師範', 'Master']];

  function xpFor(level) { return 50 * (level - 1) * level; }   // total points needed to reach a level
  function levelOf(xp) { var l = 1; while (xp >= xpFor(l + 1)) l++; return l; }
  function rank(level) { var r = RANKS[0]; RANKS.forEach(function (x) { if (level >= x[0]) r = x; }); return { jp: r[1], en: r[2] }; }
  function goal() { return readStore().settings.goal || 30; }
  function dayKey(d) { return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate(); }
  function streakOf(s) {
    var met = s.met || {}, d = new Date(), n = 0;
    if (!met[dayKey(d)]) d = new Date(d - DAY);              // today not done yet: count up to yesterday
    while (met[dayKey(d)]) { n++; d = new Date(d - DAY); }
    return n;
  }
  function isDue(it, now) { return it && it.m && (!it.d || it.d <= now); }

  // next review a little before or after the nominal day, so items learned together don't all come back together
  function schedule(it, now, iv) { it.iv = iv; it.d = now + INTERVALS[iv] * DAY * (0.9 + Math.random() * 0.25); }
  function revCap() { return readStore().settings.revCap || 20; }   // most spaced reviews asked in one day
  function revDone(s) { return (s.rd || {})[today()] || 0; }
  function revLeft(s) { return Math.max(0, revCap() - revDone(s)); }

  // how long you really take: seconds between answers (gaps over 2 min = a break) per deck, and per review
  function trackPace(s, key, counts, now) {
    var gap = now - (s.lastT || 0);
    s.lastT = now;
    if (!key || gap > 12e4) return;
    s.pace = s.pace || {};
    var p = s.pace[key] || [0, 0];
    p[0] += gap / 1000; if (counts) p[1]++;
    if (p[1] > 150) { p[0] /= 2; p[1] /= 2; }              // keep it about your recent pace
    s.pace[key] = p;
  }

  var pending = [];                                         // notifications raised while answering
  // how: 'quiz' (checked answer — first review comes a bit later), 'cards' (self-graded) or 'review'
  function record(id, correct, how) {
    var s = readStore(), it = s.items[id] || { s: 0 }, now = Date.now();
    var wasM = !!it.m, due = isDue(it, now), xp, r = { newlyMastered: false, lost: false, review: due };
    if (correct) {
      it.s = (it.s || 0) + 1;
      xp = due ? XP.review : XP.right;
      delete it.k;                                            // answered for real, no longer just "marked"
      // one correct answer = mastered; spaced reviews then check it stays that way
      if (!wasM) { it.m = 1; it.mt = now; schedule(it, now, how === 'quiz' ? 1 : 0); xp += XP.mastered; r.newlyMastered = true; }
      else if (due) schedule(it, now, Math.min((it.iv || 0) + 1, INTERVALS.length - 1));
    } else {
      xp = XP.wrong; r.lost = wasM;
      it.s = 0; delete it.m; delete it.mt; delete it.d; delete it.iv; delete it.k;
    }
    if (due) { s.reviews = (s.reviews || 0) + 1; s.rd = s.rd || {}; s.rd[today()] = revDone(s) + 1; }
    var dk = /^n\d([gkv])/.exec(id);
    trackPace(s, due ? 'r' : dk && dk[1], due || r.newlyMastered, now);
    it.t = now;
    s.items[id] = it; mirror(s, id);
    xp = gain(s, tick(s, xp));
    writeStore(s);
    r.streak = it.s; r.mastered = !!it.m; r.xp = xp;
    flush();
    return r;
  }
  // extra practice (e.g. the kanji compound quiz): points and daily cards, but mastery is untouched
  function practice(correct) {
    var s = readStore(), xp = gain(s, tick(s, correct ? XP.practice : XP.wrong));
    s.lastT = Date.now();
    writeStore(s); flush(); return xp;
  }
  // "I already know these": mastered without answering (no points). They come back for a first check
  // in 2–6 weeks, spread out, so marking a whole level doesn't flood the reviews.
  // on = false unmarks; marksOnly = only undo marks, keep items mastered by actually answering
  function markMastered(ids, on, marksOnly) {
    var s = readStore(), now = Date.now(), n = 0;
    ids.forEach(function (id) {
      var it = s.items[id];
      if (on) {
        if (it && it.m) return;
        it = it || {}; it.m = 1; it.k = 1; it.mt = now; it.s = Math.max(it.s || 0, 1);
        it.iv = 3; it.d = now + (14 + Math.random() * 31) * DAY;
      } else {
        if (!it || !it.m || (marksOnly && !it.k)) return;
        delete it.m; delete it.mt; delete it.d; delete it.iv; delete it.k; it.s = 0;
      }
      it.t = now; s.items[id] = it; mirror(s, id); n++;
    });
    if (n) { checkStamps(s); writeStore(s); flush(); }
    return n;
  }
  function isMarked(id) { var it = readStore().items[id]; return !!(it && it.m && it.k); }
  // count one answered card toward today: goal, streak, early/late and marathon stamps
  function tick(s, xp) {
    var t = today();
    s.days[t] = (s.days[t] || 0) + 1;
    s.met = s.met || {};
    if (!s.met[t] && s.days[t] >= goal()) { s.met[t] = 1; xp += XP.goal; pending.push({ seal: '励', title: 'Daily goal reached', sub: goal() + ' cards today · +' + XP.goal + ' points' }); }
    var h = new Date().getHours();
    if (h < 7) { s.ed = s.ed || {}; s.ed[t] = (s.ed[t] || 0) + 1; }
    if (h >= 23) { s.ld = s.ld || {}; s.ld[t] = (s.ld[t] || 0) + 1; }
    if (s.days[t] >= Math.max(goal() * 3, 100)) s.triple = 1;
    return xp;
  }
  // add points (and check level-up + stamps) on an already-read store
  function gain(s, xp) {
    var before = levelOf(s.xp || 0);
    s.xp = (s.xp || 0) + xp;
    var after = levelOf(s.xp);
    if (after > before) { var rk = rank(after); pending.push({ seal: String(after), title: 'Level ' + after + ' · ' + rk.jp, sub: rk.en + ' — keep going', level: true }); }
    checkStamps(s);
    return xp;
  }
  function award(xp, reason) {
    var s = readStore(); gain(s, xp); writeStore(s);
    if (reason) pending.unshift({ seal: '+', title: '+' + xp + ' points', sub: reason, plain: true });
    flush(); return xp;
  }
  function completeSet(key) {                                // first time a whole set is mastered
    var s = readStore(); s.sets = s.sets || {};
    if (s.sets[key]) return 0;
    s.sets[key] = Date.now(); writeStore(s);
    return award(XP.set, 'Set mastered');
  }
  // listening / reading answers (ids like n5l3, n5r2q1) live apart from the decks: no mastery or reviews, but they
  // count toward today's goal and points
  function recordLR(id, correct) {
    var s = readStore(), now = Date.now(); s.lr = s.lr || {};
    var p = s.lr[id] || { n: 0 }; p.n++; p.ok = correct ? 1 : 0; if (correct) p.best = 1; p.t = now;
    s.lr[id] = p;
    var xp = gain(s, tick(s, correct ? XP.right : XP.wrong));
    writeStore(s); flush(); return xp;
  }
  function lrState(id) { return (readStore().lr || {})[id] || null; }
  function saveTest(result) { var s = readStore(); s.tests = s.tests || {}; s.tests[Date.now()] = result; writeStore(s); }
  function testHistory(level) {
    var t = readStore().tests || {};
    return Object.keys(t).map(function (k) { var r = t[k]; r.at = +k; return r; }).filter(function (r) { return r.level === level; }).sort(function (a, b) { return b.at - a.at; });
  }
  function perfectQuiz() { var s = readStore(); s.perfect = (s.perfect || 0) + 1; checkStamps(s); writeStore(s); flush(); }

  /* stamps (hanko) — meant to take weeks or months, not minutes */
  var STAMPS = [
    ['m50', '始', 'First steps', 'Master 50 items'],
    ['sets10', '組', 'Ten sets', 'Fully master 10 sets'],
    ['m250', '集', 'Collection', 'Master 250 items'],
    ['m1000', '千', 'Thousand', 'Master 1,000 items'],
    ['m3000', '万', 'Myriad', 'Master 3,000 items'],
    ['goal10', '励', 'Effort', 'Reach your daily goal on 10 different days'],
    ['triple', '倍', 'Marathon', 'Answer 3× your daily goal (and at least 100 cards) in one day'],
    ['s7', '週', 'One week', '7-day streak'],
    ['s30', '月', 'One month', '30-day streak'],
    ['s100', '季', 'Hundred days', '100-day streak'],
    ['s365', '年', 'One year', '365-day streak'],
    ['perfect5', '満', 'Flawless', 'Score 10 / 10 on 5 quizzes'],
    ['rev250', '復', 'Review', 'Complete 250 spaced reviews'],
    ['rev1000', '練', 'Practice', 'Complete 1,000 spaced reviews'],
    ['keep100', '堅', 'Long memory', 'Keep 100 items all the way to the 30-day review'],
    ['g100', '文', 'Grammar', 'Master 100 grammar points'],
    ['k500', '字', 'Characters', 'Master 500 kanji'],
    ['v1500', '語', 'Words', 'Master 1,500 words'],
    ['early', '朝', 'Early bird', 'Do 10+ cards before 7 am on 10 different days'],
    ['late', '夜', 'Night owl', 'Do 10+ cards after 11 pm on 10 different days'],
    ['level', '極', 'Level clear', 'Master every grammar point, kanji and word of one JLPT level'],
    ['lv15', '段', 'Rank', 'Reach level 15'],
    ['lv40', '師', 'Mastery', 'Reach level 40']
  ];
  function stats(s) {
    var c = { all: 0, g: 0, k: 0, v: 0, decks: {}, kept: 0 };
    // stamps are earned by answering: items only marked as known don't count until a review checks them
    for (var id in s.items) if (s.items[id].m && !s.items[id].k) {
      var m = /^(n\d)([gkv])\d+$/.exec(id);
      if (m) c.decks[m[1] + m[2]] = (c.decks[m[1] + m[2]] || 0) + 1;   // per deck both copies count (level clear)
      if (isCopy(id, s.items)) continue;                                // totals: a linked word counts once
      c.all++; if (m) c[m[2]]++;
      if ((s.items[id].iv || 0) >= 4) c.kept++;               // INTERVALS[4] = the 30-day review
    }
    return c;
  }
  function levelComplete(c) {
    var M = window.SHIORI_MANIFEST; if (!M) return false;
    return LEVELS.some(function (l) { return DECK_ORDER.every(function (d) {
      var n = M.counts[l][d]; return n > 0 && c.decks[l + DECKS[d].short] >= n; }); });
  }
  function daysWith(map, min) { var n = 0; for (var d in map || {}) if (map[d] >= min) n++; return n; }
  function checkStamps(s) {
    s.stamps = s.stamps || {};
    var c = stats(s), st = streakOf(s), lv = levelOf(s.xp || 0), rev = s.reviews || 0, sets = Object.keys(s.sets || {}).length;
    var ok = {
      m50: c.all >= 50, sets10: sets >= 10, m250: c.all >= 250, m1000: c.all >= 1000, m3000: c.all >= 3000,
      goal10: Object.keys(s.met || {}).length >= 10, triple: !!s.triple, s7: st >= 7, s30: st >= 30, s100: st >= 100, s365: st >= 365,
      perfect5: (s.perfect || 0) >= 5, rev250: rev >= 250, rev1000: rev >= 1000, keep100: c.kept >= 100,
      g100: c.g >= 100, k500: c.k >= 500, v1500: c.v >= 1500,
      early: daysWith(s.ed, 10) >= 10, late: daysWith(s.ld, 10) >= 10, level: levelComplete(c), lv15: lv >= 15, lv40: lv >= 40
    };
    STAMPS.forEach(function (x) {
      if (ok[x[0]] && !s.stamps[x[0]]) { s.stamps[x[0]] = Date.now(); pending.push({ seal: x[1], title: 'New stamp · ' + x[2], sub: x[3] }); }
    });
  }

  /* toast notifications */
  var toastBox = null, toastQueue = [], toastBusy = false;
  function flush() { while (pending.length) toastQueue.push(pending.shift()); showNext(); refreshStats(); }
  function showNext() {
    if (toastBusy || !toastQueue.length || !document.body) return;
    if (!toastBox) { toastBox = document.createElement('div'); toastBox.className = 'toast-box'; toastBox.setAttribute('aria-live', 'polite'); document.body.appendChild(toastBox); }
    var n = toastQueue.shift(); toastBusy = true;
    var el = document.createElement('div');
    el.className = 'toast' + (n.level ? ' lvl' : '') + (n.plain ? ' plain' : '');
    el.innerHTML = '<span class="seal press">' + esc(n.seal) + '</span><div><b>' + esc(n.title) + '</b><span>' + esc(n.sub) + '</span></div>';
    toastBox.appendChild(el);
    setTimeout(function () { el.classList.add('out'); }, n.plain ? 1600 : 3200);
    setTimeout(function () { el.remove(); toastBusy = false; showNext(); }, n.plain ? 1900 : 3600);
  }

  function game() {
    var s = readStore(), xp = s.xp || 0, lv = levelOf(xp), now = Date.now(), dueAll = 0, week = [];
    for (var id in s.items) if (isDue(s.items[id], now) && !isCopy(id, s.items)) dueAll++;
    var due = Math.min(dueAll, revLeft(s));                 // today's share; the rest waits for the next days
    for (var i = 6; i >= 0; i--) { var d = new Date(now - i * DAY); week.push({ label: '日月火水木金土'[d.getDay()], met: !!(s.met || {})[dayKey(d)], count: s.days[dayKey(d)] || 0, today: i === 0 }); }
    return {
      xp: xp, level: lv, rank: rank(lv), levelStart: xpFor(lv), levelEnd: xpFor(lv + 1),
      today: s.days[today()] || 0, goal: goal(), metToday: !!(s.met || {})[today()], streak: streakOf(s),
      due: due, dueAll: dueAll, revCap: revCap(), revDone: revDone(s), week: week, stamps: s.stamps || {}, reviews: s.reviews || 0
    };
  }
  // most overdue first; capped by what's left of today's review limit unless extra = true
  function dueIds(limit, extra) {
    var s = readStore(), items = s.items, now = Date.now(), out = [];
    for (var id in items) if (isDue(items[id], now) && !isCopy(id, items)) out.push([id, items[id].d || 0]);
    out.sort(function (a, b) { return a[1] - b[1]; });
    return out.slice(0, Math.min(limit || 1e9, extra ? 1e9 : revLeft(s))).map(function (x) { return x[0]; });
  }
  function itemState(id) { return readStore().items[id] || { s: 0 }; }
  function masteredCount(prefix) {
    var items = readStore().items, n = 0;
    for (var k in items) if (items[k].m && k.indexOf(prefix) === 0 && /\d$/.test(k)) n++;
    return n;
  }
  function deckMastered(level, deck) { return masteredCount(level + DECKS[deck].short); }
  // progress of set k (1-based) without loading the data: ids are sequential (n5k1, n5k2, …)
  // a short leftover (under half a set) joins the last set, so there's never a set of one or two
  function countSets(total, size) { var r = total % size; return total <= size ? 1 : r && r < size / 2 ? Math.floor(total / size) : Math.ceil(total / size); }
  function setProgress(level, deck, k) {
    var M = window.SHIORI_MANIFEST, size = M.setSize[deck], total = M.counts[level][deck], n = countSets(total, size);
    var from = (k - 1) * size + 1, to = k >= n ? total : Math.min(k * size, total), items = readStore().items, m = 0, seen = 0;
    for (var i = from; i <= to; i++) {
      var it = items[level + DECKS[deck].short + i];
      if (it) { seen++; if (it.m) m++; }
    }
    return { mastered: m, seen: seen, total: Math.max(0, to - from + 1) };
  }
  function setCount(level, deck) {
    var M = window.SHIORI_MANIFEST; return countSets(M.counts[level][deck], M.setSize[deck]);
  }
  function nextSet(level, deck) {
    var n = setCount(level, deck);
    for (var k = 1; k <= n; k++) { var p = setProgress(level, deck, k); if (p.mastered < p.total) return k; }
    return 1;
  }
  function totalMastered() { var items = readStore().items, n = 0; for (var k in items) if (items[k].m && !isCopy(k, items)) n++; return n; }
  function reviewedToday() { return readStore().days[today()] || 0; }
  function setLast(info) { var s = readStore(); s.last = info; writeStore(s); }
  function getLast() { return readStore().last || null; }
  function setting(name, value) {
    var s = readStore();
    if (value === undefined) return s.settings[name];
    s.settings[name] = value; writeStore(s); return value;
  }

  /* ---------- exam plan: spread what's left of a level over the days until the exam ---------- */
  function midnight(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function firstSunday(y, m) { var d = new Date(y, m, 1); d.setDate(1 + (7 - d.getDay()) % 7); return d; }
  function nextExam() {                                     // JLPT runs on the first Sunday of July and December
    var t = midnight(new Date());
    for (var y = t.getFullYear(); ; y++) for (var i = 0; i < 2; i++) { var d = firstSunday(y, i ? 11 : 6); if (d >= t) return d; }
  }
  function isoDate(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parseDate(s) { var m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(s || ''); return m ? new Date(+m[1], m[2] - 1, +m[3]) : null; }
  var MIN_PER = { grammar: 4, kanji: 1.2, vocab: 0.7, review: 0.25 };   // starting guesses, minutes per item
  // minutes per item from your own answers once there are enough of them, else the guess
  function minutesPer(s, deck) {
    var p = (s.pace || {})[deck === 'review' ? 'r' : DECKS[deck].short];
    return p && p[1] >= 15 ? Math.min(15, Math.max(0.1, p[0] / p[1] / 60)) : MIN_PER[deck];
  }
  function measured(s, deck) { var p = (s.pace || {})[deck === 'review' ? 'r' : DECKS[deck].short]; return !!(p && p[1] >= 15); }
  function examPlan() {
    var s = readStore(), ex = s.settings.exam || {}, M = window.SHIORI_MANIFEST, items = s.items;
    var level = LEVELS.indexOf(ex.level) >= 0 ? ex.level : (s.last && s.last.l) || 'n5';
    var date = parseDate(ex.date) || nextExam(), t0 = midnight(new Date()).getTime();
    var daysLeft = Math.round((date - t0) / DAY);           // study days left, today included, exam day not
    // the review block is sized from the whole plan (start → exam) so it doesn't shrink as the days pass
    var start = Math.min(t0, (parseDate(ex.start) || new Date(t0)).getTime()), span = Math.round((date - start) / DAY);
    var review = span > 2 ? Math.min(10, Math.max(1, Math.round(span * 0.15)), daysLeft) : 0;
    var learn = Math.max(0, daysLeft - review);
    var lvls = ex.lower ? LEVELS.slice(0, LEVELS.indexOf(level) + 1) : [level];
    var decks = DECK_ORDER.map(function (d) {
      var r = { deck: d, total: 0, mastered: 0, today: 0, next: null };
      lvls.forEach(function (l) {
        r.total += M.counts[l][d];
        if (!r.next && deckMastered(l, d) < M.counts[l][d]) r.next = { l: l, s: nextSet(l, d) };
      });
      for (var id in items) {
        var m = /^(n\d)([gkv])\d+$/.exec(id);
        if (m && items[id].m && m[2] === DECKS[d].short && lvls.indexOf(m[1]) >= 0) { r.mastered++; if (items[id].mt >= t0) r.today++; }
      }
      // today's target is fixed at the start of the day, so it doesn't shrink while you work through it
      r.left = r.total - r.mastered; r.startLeft = r.left + r.today;
      r.target = learn > 0 ? Math.ceil(r.startLeft / learn) : 0;
      r.todo = Math.max(0, r.target - r.today);
      r.extra = Math.max(0, r.today - r.target);
      // doing more today lowers every day after it
      r.tomorrow = learn > 1 ? Math.ceil(Math.max(0, r.left - r.todo) / (learn - 1)) : 0;
      r.per = minutesPer(s, d); r.measured = measured(s, d);
      r.sets = r.next ? setsFor(r.next.l, d, r.next.s, r.todo || 1) : [];
      return r;
    });
    var g = game(), perRev = minutesPer(s, 'review');
    var minutesLeft = g.due * perRev, minutes = (g.due + g.revDone) * perRev;
    decks.forEach(function (r) { minutesLeft += r.todo * r.per; minutes += r.target * r.per; });
    var left = decks.reduce(function (a, r) { return a + r.left; }, 0);
    // your real pace: items mastered over the last 7 days (or since the plan started, if sooner)
    var week = 0, from = t0 - 6 * DAY, pdays = Math.max(1, Math.min(7, Math.round((t0 - start) / DAY) + 1));
    for (var id in items) { var m = /^(n\d)([gkv])\d+$/.exec(id); if (m && items[id].m && items[id].mt >= from && lvls.indexOf(m[1]) >= 0) week++; }
    var rate = week / pdays, finish = rate > 0 ? new Date(t0 + Math.ceil(left / rate) * DAY) : null;
    var learnBy = new Date(date - review * DAY);
    return {
      level: level, levels: lvls, lower: !!ex.lower, saved: !!ex.date, date: date, iso: isoDate(date), daysLeft: daysLeft,
      review: review, learn: learn, learnBy: learnBy, decks: decks, due: g.due, dueAll: g.dueAll, revDone: g.revDone, left: left,
      minutes: Math.round(minutes), minutesLeft: Math.round(minutesLeft), perRev: perRev, measured: decks.some(function (r) { return r.measured; }),
      rate: rate, finish: finish, early: finish ? Math.round((learnBy - finish) / DAY) : null,
      done: g.due === 0 && decks.every(function (r) { return !r.todo; }),
      phase: daysLeft <= 0 ? 'over' : learn > 0 && left > 0 ? 'learn' : 'review'
    };
  }
  // which sets (starting at `from`) hold the next `need` unmastered items
  function setsFor(level, deck, from, need) {
    var out = [], n = setCount(level, deck);
    for (var k = from; k <= n && need > 0; k++) { var p = setProgress(level, deck, k); if (p.mastered < p.total) { out.push(k); need -= p.total - p.mastered; } }
    return out;
  }
  // the one thing to do next for today's plan: reviews first, then new items deck by deck
  function nextTask(P) {
    P = P || examPlan();
    if (P.due) return { href: 'review.html', label: 'Review ' + P.due + ' due', deck: null };
    if (P.phase !== 'learn') return null;
    for (var i = 0; i < P.decks.length; i++) {
      var r = P.decks[i];
      if (r.todo && r.next) return { href: 'study.html?l=' + r.next.l + '&d=' + r.deck + '&s=' + r.next.s + '&m=list', label: DECKS[r.deck].name + ' · Set ' + r.next.s, deck: r.deck };
    }
    return null;
  }

  /* ---------- data ---------- */
  function load(level, deck, cb) {
    var key = level + '_' + deck;
    window.SHIORI_DATA = window.SHIORI_DATA || {};
    if (SHIORI_DATA[key]) return cb(SHIORI_DATA[key]);
    var el = document.createElement('script');
    el.src = 'data/' + key + '.js';
    el.onload = function () { cb(SHIORI_DATA[key] || []); };
    el.onerror = function () { cb(null); };
    document.head.appendChild(el);
  }
  function sets(items, deck) {
    var size = (window.SHIORI_MANIFEST && SHIORI_MANIFEST.setSize[deck]) || 20, n = countSets(items.length, size), out = [];
    for (var k = 1; k <= n; k++) out.push(items.slice((k - 1) * size, k === n ? items.length : k * size));
    return out;
  }
  function params() {
    var p = new URLSearchParams(location.search);
    var level = LEVELS.indexOf(p.get('l')) >= 0 ? p.get('l') : 'n5';
    var deck = DECKS[p.get('d')] ? p.get('d') : 'vocab';
    return { level: level, deck: deck, set: Math.max(1, parseInt(p.get('s'), 10) || 1), mode: p.get('m') || 'list' };
  }

  /* ---------- text helpers ---------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  // "{漢字|かんじ}を{読|よ}む" -> ruby markup
  function ruby(s) { return esc(s).replace(/\{([^|{}]+)\|([^{}]+)\}/g, '<ruby>$1<rt>$2</rt></ruby>'); }
  function plain(s) { return String(s || '').replace(/\{([^|{}]+)\|([^{}]+)\}/g, '$1'); }
  function kana(s) { return String(s || '').replace(/\{([^|{}]+)\|([^{}]+)\}/g, '$2'); }
  function icon(path, cls) { return '<svg class="' + (cls || 'i') + '" viewBox="0 0 24 24" aria-hidden="true">' + path + '</svg>'; }
  var ICONS = {
    speaker: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    left: '<path d="M15 6l-6 6 6 6"/>', right: '<path d="M9 6l6 6-6 6"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', check: '<path d="M5 12l4 4 10-10"/>',
    shuffle: '<path d="M4 7h3c4 0 6 10 10 10h3M14 8.3C15 7.5 16 7 17 7h3M4 17h3c1.5 0 2.7-1.4 3.8-3"/><path d="M18 4l3 3-3 3M18 14l3 3-3 3"/>'
  };

  /* ---------- voice (browser speech synthesis) ---------- */
  // one main voice, plus separate voices for the women (F), men (M) and narrator (N) in listening dialogues
  // Only "natural" voices are used for dialogue (Google, Edge's Online/Natural voices, Apple's Kyoko/O-ren …): the old
  // desktop voices (Ayumi, Ichiro …) sound robotic. With one natural voice, the man is that voice at a lower pitch.
  var voice = null, VOICES = { F: null, M: null, N: null }, TUNE = { F: {}, M: {}, N: {} };
  var MALE = /ichiro|keita|kenji|otoya|daichi|naoki|takumi|hattori|\bmale/i, NATURAL = /natural|online|google|kyoko|o-ren|nanami|siri|neural|premium|enhanced/i;
  function pickVoice() {
    if (!('speechSynthesis' in window)) return;
    var vs = speechSynthesis.getVoices().filter(function (v) { return /^ja/i.test(v.lang); });
    vs.sort(function (a, b) { return score(b) - score(a); });
    voice = vs[0] || null;
    var nat = vs.filter(function (v) { return NATURAL.test(v.name); }), pool = nat.length ? nat : vs;
    var m = pool.filter(function (v) { return MALE.test(v.name); }), f = pool.filter(function (v) { return !MALE.test(v.name); });
    VOICES.F = f[0] || pool[0] || voice;
    VOICES.M = m[0] || VOICES.F;
    VOICES.N = f.filter(function (v) { return v !== VOICES.F; })[0] || VOICES.F;
    TUNE.M = m[0] ? {} : { pitch: 0.72, rate: 0.97 };                 // same voice as the woman: lower and a touch slower
    TUNE.N = VOICES.N === VOICES.F ? { pitch: 0.95, rate: 0.94 } : { rate: 0.96 };   // calm announcer pace
    function score(v) { return (NATURAL.test(v.name) ? 4 : 0) + (v.localService ? 0 : 1); }
  }
  if ('speechSynthesis' in window) { pickVoice(); speechSynthesis.onvoiceschanged = pickVoice; }
  function canSpeak() { return 'speechSynthesis' in window || /^https?:$/.test(location.protocol); }
  // speech-friendly text: no 〜, "A / B" read as two items, okurigana brackets dropped (ひと(つ) → ひとつ)
  // listening (practice + mock tests) always plays at the level's own speed, like the real exam — the speed setting
  // is only for cards and reading. Values are in the same units as the setting (0.9 = recorded speed).
  var LISTEN_RATE = { n5: 0.77, n4: 0.81, n3: 0.86, n2: 0.9, n1: 0.95 };
  function sayable(t) { return String(t || '').replace(/[〜～\-]/g, '').replace(/\s*[\/／;；]\s*/g, '、').replace(/[()（）]/g, '').trim(); }
  var utters = [], speakToken = 0;                         // kept referenced: Chrome drops utterances that get garbage-collected
  // text: a string, an array, or parts joined with "|" — each part is read in turn with a short pause.
  // A part can also be { t: text, sp: 'F' | 'M' | 'N' } to pick a speaker; opts.rate overrides the speed setting.
  // returns a promise that resolves when everything has been read (or was cut off)
  /* recorded voice: every phrase the site reads was voiced ahead of time with VOICEVOX and packed into audio/p<N>.mp3;
     audio/i<c>.json maps a clip hash to [pack, offset, length] and the clip is fetched with a range request.
     A phrase without a recording (or no network / file://) is read by the browser voice instead. */
  var AUDIO_V = 1793858664;                                                 // bump when audio/ is regenerated
  var ttsOk = /^https?:$/.test(location.protocol);
  var player = null, shards = {}, clipUrls = {};
  function useTts() { return ttsOk && setting('tts') !== false; }
  // 64-bit string hash (cyrb53-style) — must match the generator's clipHash()
  function clipHash(s) {
    var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (var i = 0; i < s.length; i++) { var c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return ('000000' + (h2 >>> 0).toString(36)).slice(-7) + ('000000' + (h1 >>> 0).toString(36)).slice(-7);
  }
  function shard(c) {
    if (!shards[c]) shards[c] = fetch('audio/i' + c + '.json?v=' + AUDIO_V).then(function (r) {
      if (!r.ok) throw new Error('index ' + r.status); return r.json();
    }).catch(function (e) { delete shards[c]; throw e; });
    return shards[c];
  }
  function lookup(key) { var h = clipHash(key); return shard(h[0]).then(function (ix) { return ix[h] || null; }); }
  // listening (opts.level) has its own recordings made at that level's exam speed: played as-is, never time-stretched
  // (the browser's stretching crackles). Returns { loc, rate } or null.
  function findClip(p, opts, rate) {
    var sp = p.sp || 'F';
    var plainClip = function () { return lookup(sp + '|' + p.t).then(function (l) { return l && { loc: l, rate: rate }; }); };
    if (!opts.level) return plainClip();
    return lookup(sp + '@' + opts.level + '|' + p.t).then(function (l) { return l ? { loc: l, rate: 1 } : plainClip(); });
  }
  function clipUrl(loc) {
    var key = loc.join(':');
    if (!clipUrls[key]) clipUrls[key] = fetch('audio/p' + loc[0] + '.mp3?v=' + AUDIO_V, { headers: { Range: 'bytes=' + loc[1] + '-' + (loc[1] + loc[2] - 1) } }).then(function (r) {
      if (!r.ok) throw new Error('audio ' + r.status);
      return r.arrayBuffer().then(function (b) {
        if (r.status !== 206) b = b.slice(loc[1], loc[1] + loc[2]);                  // server ignored the range
        return URL.createObjectURL(new Blob([b], { type: 'audio/mpeg' }));
      });
    }).catch(function (e) { delete clipUrls[key]; throw e; });
    return clipUrls[key];
  }
  // iPhone only lets audio play from an element first started by a tap: unlock one shared player on the first touch
  function getPlayer() { if (!player) { player = new Audio(); player.preload = 'auto'; } return player; }
  document.addEventListener('pointerdown', function unlock() {
    document.removeEventListener('pointerdown', unlock, true);
    if (!useTts()) return;
    var a = getPlayer(); a.src = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAESsAACJWAAACABAAZGF0YQAAAAA=';
    var pr = a.play(); if (pr && pr.catch) pr.catch(function () {});
  }, true);
  function speakTts(parts, btn, opts, token) {
    var rate = (opts.rate || setting('rate') || 0.9) / 0.9, a = getPlayer();   // recorded at "Normal" (0.9)
    if (btn) btn.classList.add('speaking');
    function off() { if (btn) btn.classList.remove('speaking'); }
    return Promise.all(parts.map(function (p) { return findClip(p, opts, rate); })).then(function (found) {
      var locs = found.map(function (f) { return f && f.loc; });
      if (token !== speakToken) return off();
      if (locs.some(function (l) { return !l; })) { off(); return speakBrowser(parts, btn, opts); }  // not recorded: one voice for the whole phrase
      return new Promise(function (done, fail) {
        function play(i) {
          if (token !== speakToken || i >= locs.length) { off(); return done(); }
          clipUrl(locs[i]).then(function (src) {
            if (token !== speakToken) { off(); return done(); }
            if (locs[i + 1]) clipUrl(locs[i + 1]).catch(function () {});          // load the next part while this one plays
            a.onended = function () { setTimeout(function () { play(i + 1); }, 220); };
            a.onerror = function () { fail(i); };
            a.src = src; a.playbackRate = found[i].rate;
            if ('preservesPitch' in a) a.preservesPitch = true;
            var pr = a.play();
            if (opts.onpart) opts.onpart(i);
            if (pr && pr.catch) pr.catch(function (e) { if (e && e.name === 'AbortError') return; fail(i); });
          }, function () { fail(i); });
        }
        play(0);
      }).catch(function (from) {
        off(); if (token !== speakToken) return;
        return speakBrowser(parts.slice(from || 0), btn, opts);
      });
    }, function () {                                                           // index unreachable: browser voice from now on
      off(); if (token !== speakToken) return;
      ttsOk = false; return speakBrowser(parts, btn, opts);
    });
  }
  function speak(text, btn, opts) {
    opts = opts || {};
    if (!canSpeak() || !text) return Promise.resolve();
    var parts = (Array.isArray(text) ? text : String(text).split('|')).map(function (p) {
      return typeof p === 'object' ? { t: sayable(p.t), sp: p.sp } : { t: sayable(p) };
    }).filter(function (p) { return p.t; });
    if (!parts.length) return Promise.resolve();
    if (useTts()) {
      var token = ++speakToken;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      if (player) { player.pause(); if (player.onended) player.onended(); }  // the cut-off call's promise resolves
      Array.prototype.forEach.call(document.querySelectorAll('.speaking'), function (x) { x.classList.remove('speaking'); });
      return speakTts(parts, btn, opts, token);
    }
    return speakBrowser(parts, btn, opts);
  }
  function speakBrowser(parts, btn, opts) {
    if (!('speechSynthesis' in window)) { if (btn) btn.classList.remove('speaking'); return Promise.resolve(); }
    if (!voice) pickVoice();
    var busy = speechSynthesis.speaking || speechSynthesis.pending, token = ++speakToken, tries = 0;
    speechSynthesis.cancel();
    Array.prototype.forEach.call(document.querySelectorAll('.speaking'), function (x) { x.classList.remove('speaking'); });
    return new Promise(function (done) {
      function go() {
        if (token !== speakToken) return done();
        var rate = opts.rate || setting('rate') || 0.9, started = false;
        utters = parts.map(function (p) {
          var u = new SpeechSynthesisUtterance(p.t), v = p.sp ? VOICES[p.sp] || voice : voice, tn = p.sp ? TUNE[p.sp] : {};
          u.lang = 'ja-JP'; u.rate = rate * (tn.rate || 1); u.pitch = tn.pitch || 1; if (v) u.voice = v;
          return u;
        });
        utters.forEach(function (u, i) { u.onstart = function () { started = true; if (opts.onpart) opts.onpart(i); }; });
        var last = utters[utters.length - 1], batch = utters;
        if (btn) btn.classList.add('speaking');
        // finished, or cut off by newer speech; ignored only while this call is retrying itself
        last.onend = last.onerror = function () { if (utters !== batch && token === speakToken) return; if (btn) btn.classList.remove('speaking'); done(); };
        if (speechSynthesis.paused) speechSynthesis.resume();
        utters.forEach(function (u) { speechSynthesis.speak(u); });
        // Chrome sometimes drops speech silently (stuck engine, voices still loading): if nothing started, try once more
        setTimeout(function () {
          if (token !== speakToken || started || speechSynthesis.speaking || tries++) return;
          speechSynthesis.cancel(); setTimeout(go, 150);
        }, 900);
      }
      // Chrome swallows speech queued in the same tick as cancel(); only wait when something was playing
      if (busy) setTimeout(go, 120); else go();
    });
  }
  function stopSpeaking() {
    speakToken++;
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    if (player) { player.pause(); if (player.onended) player.onended(); }   // lets a waiting speak() promise resolve
  }
  function speakBtn(text, label) {
    if (Array.isArray(text)) text = text.filter(Boolean).join('|');
    return '<button class="icon-btn speak" type="button" data-say="' + esc(text) + '" title="Listen" aria-label="' + esc(label || 'Listen') + '"' + (canSpeak() ? '' : ' disabled') + '>' + icon(ICONS.speaker) + '</button>';
  }
  // read aloud on its own (after flipping a card or answering) unless switched off in settings
  function autoSpeak(text) { if (setting('autoplay') !== false) speak(text); }
  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-say]');
    if (b) { e.stopPropagation(); speak(b.getAttribute('data-say'), b); }
  }, true);

  /* ---------- settings: theme (light by default), sound ---------- */
  function setTheme(t) {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('shiori_theme', t); } catch (e) {}
  }
  function openSettings() {
    var old = document.querySelector('.settings-pop');
    if (old) { old.remove(); return; }
    var theme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light', rate = setting('rate') || 0.9;
    function seg(name, opts, cur) {
      return '<div class="seg" role="group">' + opts.map(function (o) {
        return '<button type="button" data-' + name + '="' + o[0] + '"' + (String(o[0]) === String(cur) ? ' class="on" aria-pressed="true"' : ' aria-pressed="false"') + '>' + o[1] + '</button>';
      }).join('') + '</div>';
    }
    var el = document.createElement('div');
    el.className = 'panel settings-pop'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Settings');
    el.innerHTML = '<div class="sp-head"><b>設定 · Settings</b><button class="icon-btn sp-close" type="button" aria-label="Close settings">' + icon('<path d="M6 6l12 12M18 6L6 18"/>') + '</button></div>' +
      '<div class="sp-row"><span>Theme</span>' + seg('theme', [['light', 'Light'], ['dark', 'Dark']], theme) + '</div>' +
      '<div class="sp-row"><span>Play sound automatically<small>Reads the card aloud when you flip a flashcard or go to the next Browse card. Quizzes stay silent so they don’t give the answer away</small></span>' +
        '<button class="toggle" type="button" id="spAuto" aria-label="Play sound automatically" aria-pressed="' + (setting('autoplay') !== false) + '"><span class="sw"></span></button></div>' +
      '<div class="sp-row"><span>Natural voice<small>Recorded Japanese voices (VOICEVOX). Off = your device’s own voice</small></span>' +
        '<button class="toggle" type="button" id="spTts" aria-label="Natural voice" aria-pressed="' + (setting('tts') !== false) + '"><span class="sw"></span></button></div>' +
      '<div class="sp-row"><span>Voice speed<small>Cards, grammar examples and reading. Listening always plays at its level’s exam speed</small></span>' + seg('rate', [[0.7, 'Slow'], [0.9, 'Normal'], [1.1, 'Fast']], rate) + '</div>' +
      '<div class="sp-row"><span>Reviews per day<small>The most spaced-review cards asked in one day — extra ones wait for the next days</small></span>' + seg('cap', [[10, '10'], [20, '20'], [30, '30'], [50, '50']], revCap()) + '</div>' +
      '<div class="sp-row"><span>Test the voice' + (canSpeak() ? '' : '<small>This browser can’t speak Japanese</small>') + '</span>' + speakBtn('こんにちは。のぞみで、一緒に勉強しましょう。', 'Test the voice') + '</div>';
    document.body.appendChild(el);
    function close() { el.remove(); document.removeEventListener('click', outside, true); document.removeEventListener('keydown', esc); }
    function outside(e) { if (!el.contains(e.target) && !e.target.closest('.set-btn')) close(); }
    function esc(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('click', outside, true); document.addEventListener('keydown', esc);
    el.querySelector('.sp-close').onclick = close;
    el.querySelector('#spAuto').onclick = function () { var on = this.getAttribute('aria-pressed') !== 'true'; this.setAttribute('aria-pressed', on); setting('autoplay', on); };
    el.querySelector('#spTts').onclick = function () { var on = this.getAttribute('aria-pressed') !== 'true'; this.setAttribute('aria-pressed', on); setting('tts', on); if (on) ttsOk = /^https?:$/.test(location.protocol); speak('この声で読みます。'); };
    Array.prototype.forEach.call(el.querySelectorAll('.seg button'), function (b) {
      b.onclick = function () {
        Array.prototype.forEach.call(b.parentNode.children, function (x) { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
        if (b.dataset.theme) setTheme(b.dataset.theme);
        else if (b.dataset.cap) { setting('revCap', +b.dataset.cap); refreshStats(); }
        else { setting('rate', +b.dataset.rate); speak('この速さで読みます。'); }
      };
    });
  }

  /* ---------- chrome: header + study bar ---------- */
  function statsHtml() {
        var g = game(), pct = Math.min(100, g.today / g.goal * 100), lp = (g.xp - g.levelStart) / (g.levelEnd - g.levelStart) * 100;
        return (g.due ? '<a class="sh-chip due" href="review.html" title="' + g.due + ' reviews for today' + (g.dueAll > g.due ? ' (' + (g.dueAll - g.due) + ' more wait for the next days)' : '') + '">' + icon('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>') + '復習 <b>' + g.due + '</b></a>' : '') +
          '<span class="sh-chip streak' + (g.metToday ? ' lit' : '') + '" title="' + g.streak + '-day streak' + (g.metToday ? '' : ' — reach today\'s goal to keep it') + '">' +
            icon('<path d="M12 3c1 3 4 5 4 9a4 4 0 0 1-8 0c0-2 1-3 2-4 0 2 1 3 2 3 0-3-1-5 0-8z"/>') + '<b>' + g.streak + '</b><span>day' + (g.streak === 1 ? '' : 's') + '</span></span>' +
          '<span class="sh-chip goal" title="Daily goal: ' + g.today + ' / ' + g.goal + ' cards"><i class="mini-ring" style="--p:' + pct + '"></i><b>' + g.today + '</b><span>/ ' + g.goal + '</span></span>' +
          '<a class="sh-level" href="index.html#stamps" title="Level ' + g.level + ' · ' + g.rank.en + ' · ' + (g.levelEnd - g.xp) + ' points to level ' + (g.level + 1) + '">' +
            '<b>' + g.level + '</b><span><em>' + g.rank.jp + '</em><i class="xp"><i style="width:' + lp + '%"></i></i></span></a>';
  }
  function refreshStats() { var el = document.querySelector('.sh-game'); if (el) el.innerHTML = statsHtml(); }
  // big actions ask for a second tap instead of a browser confirm dialog
  function twoStep(btn, ask, fn) {
    var label = btn.innerHTML, armed = false, t;
    btn.addEventListener('click', function () {
      if (!armed) { armed = true; btn.classList.add('armed'); btn.innerHTML = ask; t = setTimeout(reset, 4000); return; }
      clearTimeout(t); reset(); fn();
    });
    function reset() { armed = false; btn.classList.remove('armed'); btn.innerHTML = label; }
  }
  // ids are sequential per deck (n5v1, n5v2, …), so a whole deck needs no data loaded
  function deckIds(level, deck) {
    var n = window.SHIORI_MANIFEST.counts[level][deck], out = [];
    for (var i = 1; i <= n; i++) out.push(level + DECKS[deck].short + i);
    return out;
  }
  function markedCount(level, deck) {
    var items = readStore().items, p = level + DECKS[deck].short, n = 0;
    for (var k in items) if (items[k].k && items[k].m && k.indexOf(p) === 0) n++;
    return n;
  }
  function header(active) {
    var nav = '<a href="index.html"' + (active === 'home' ? ' class="active"' : '') + '>' + icon('<path d="M4 11l8-7 8 7v9H4z"/><path d="M10 20v-5h4v5"/>') + 'Home</a>' +
      '<a href="plan.html"' + (active === 'plan' ? ' class="active"' : '') + '>' + icon('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/>') + 'Plan</a>';
    LEVELS.forEach(function (l) {
      nav += '<a class="lvl' + (active === l ? ' active' : '') + '" href="level.html?l=' + l + '">' + l.toUpperCase() + '</a>';
    });
    return '<header class="sh-head"><div class="sh-wrap">' +
      '<a href="index.html" class="sh-logo"><span class="sh-seal">望</span><span class="sh-word">Nozomi<small>JLPT 学習帳</small></span></a>' +
      '<nav class="sh-nav" aria-label="Levels">' + nav + '</nav>' +
      '<div class="sh-stats"><span class="sh-game">' + statsHtml() + '</span>' +
        '<a class="icon-btn acct-btn" href="account.html" title="Account &amp; sync" aria-label="Account">' + icon('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>') + '</a>' +
        '<button class="icon-btn set-btn" type="button" title="Settings — theme and sound" aria-label="Settings">' +
          icon('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>') +
        '</button>' +
      '</div></div><div class="sh-wave" aria-hidden="true"></div></header>';
  }
  // exam sections beside the decks: listening, reading and a full mock test
  var SECTIONS = {
    listen: { name: 'Listening', jp: '聴解', href: 'listening.html', icon: '<path d="M4 14v-2a8 8 0 0 1 16 0v2"/><rect x="3" y="14" width="4" height="6" rx="1.5"/><rect x="17" y="14" width="4" height="6" rx="1.5"/>' },
    read: { name: 'Reading', jp: '読解', href: 'reading.html', icon: '<path d="M3 5h6a3 3 0 0 1 3 3v12a2 2 0 0 0-2-2H3z"/><path d="M21 5h-6a3 3 0 0 0-3 3v12a2 2 0 0 1 2-2h7z"/>' },
    test: { name: 'Mock test', jp: '模試', href: 'test.html', icon: '<path d="M9 4h6v3H9z"/><path d="M8 5H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2"/><path d="M9 13l2 2 4-4"/>' }
  };
  function studyBar(level, deck) {
    var tabs = DECK_ORDER.map(function (d) {
      return '<a href="deck.html?l=' + level + '&d=' + d + '"' + (d === deck ? ' class="on" aria-current="page"' : '') + '>' +
        icon(DECKS[d].icon) + DECKS[d].name + ' <span class="jp">' + DECKS[d].jp + '</span></a>';
    }).join('') + '<span class="sb-sep" aria-hidden="true"></span>' + Object.keys(SECTIONS).map(function (k) {
      var x = SECTIONS[k];
      return '<a href="' + x.href + '?l=' + level + '"' + (k === deck ? ' class="on" aria-current="page"' : '') + '>' + icon(x.icon) + x.name + ' <span class="jp">' + x.jp + '</span></a>';
    }).join('');
    return '<nav class="sb" aria-label="Decks"><div class="sb-wrap">' +
      '<a class="sb-level' + (deck ? '' : ' on') + '" href="level.html?l=' + level + '"><b>' + level.toUpperCase() + '</b>Overview</a>' +
      '<div class="sb-decks">' + tabs + '</div></div></nav>';
  }
  function footer() {
    return '<footer class="site-footer">Nozomi · JLPT 学習帳 · 一日一歩<br>' +
      'Kanji: KANJIDIC (EDRDG, CC BY-SA 4.0), levelled by the official pre-2010 JLPT kanji lists. Vocabulary lists: Jonathan Waller, tanos.co.uk (CC BY). ' +
      'Listening, reading and mock tests are original practice material. Voices: VOICEVOX:冥鳴ひまり, VOICEVOX:玄野武宏, VOICEVOX:No.7. ' +
      'Unofficial — the JLPT does not publish official lists.</footer>';
  }
  function mount(active, level, deck) {
    var top = document.getElementById('top');
    if (top) top.innerHTML = header(active) + (level && active !== 'home' ? studyBar(level, deck) : '');
    var foot = document.getElementById('foot');
    if (foot) foot.innerHTML = footer();
    if (window.ShioriSync && ShioriSync.paint) ShioriSync.paint();
    var sb = document.querySelector('.set-btn');
    if (sb) sb.addEventListener('click', openSettings);
  }

  window.Shiori = {
    LEVELS: LEVELS, LEVEL_INFO: LEVEL_INFO, LISTEN_RATE: LISTEN_RATE, DECKS: DECKS, DECK_ORDER: DECK_ORDER, ICONS: ICONS,
    load: load, sets: sets, params: params, record: record, practice: practice, itemState: itemState,
    recordLR: recordLR, lrState: lrState, saveTest: saveTest, testHistory: testHistory, SECTIONS: SECTIONS,
    markMastered: markMastered, isMarked: isMarked, twinsOf: twinsOf, remapKanji: remapKanji, nextTask: nextTask, setsFor: setsFor, twoStep: twoStep, deckIds: deckIds, markedCount: markedCount,
    game: game, dueIds: dueIds, award: award, completeSet: completeSet, perfectQuiz: perfectQuiz, STAMPS: STAMPS, XP: XP, goal: goal,
    deckMastered: deckMastered, setProgress: setProgress, setCount: setCount, nextSet: nextSet, totalMastered: totalMastered, reviewedToday: reviewedToday,
    setLast: setLast, getLast: getLast, setting: setting, examPlan: examPlan, nextExam: nextExam, isoDate: isoDate, DAY: DAY,
    esc: esc, ruby: ruby, plain: plain, kana: kana, icon: icon, speak: speak, stopSpeaking: stopSpeaking, autoSpeak: autoSpeak, speakBtn: speakBtn, canSpeak: canSpeak,
    mount: mount, header: header, refreshStats: refreshStats,
    _read: readStore, _write: writeStore, _key: KEY
  };
})();
