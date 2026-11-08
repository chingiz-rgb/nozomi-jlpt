/* Shiori · card renderers shared by study sets and spaced review */
(function () {
  var S = Shiori;
  /* ---------- per-deck item helpers ---------- */
  function readingsText(k) { return k.on.concat(k.kun.map(function (x) { return x.replace(/[()]/g, ''); })).join('、'); }
  var H = {
    kanji: {
      noun: 'kanji',
      // the kanji's own readings first, then each example word
      say: function (k) { return [k.on.join('、'), k.kun.join('、')].concat((k.ex || []).map(function (e) { return firstReading(e.r); })); },
      front: function (k) { return '<div class="fc-front">' + S.esc(k.k) + '</div>'; },
      back: function (k) {
        return '<div class="fc-back"><div class="small-glyph">' + S.esc(k.k) + '</div>' +
          '<div class="big-meaning">' + S.esc(k.m) + '</div>' + reads(k) + exWords(k) + '</div>';
      },
      list: function (k, mastered) {
        return '<div class="panel item' + (mastered ? ' mastered' : '') + '"><div class="glyph">' + S.esc(k.k) + '</div><div>' +
          '<div class="meaning" style="color:var(--s-ink);font-weight:700;font-size:1.05rem">' + S.esc(k.m) + '</div>' +
          '<div class="read-row">' + (k.on.length ? '<span><b>ON</b>' + S.esc(k.on.join('・')) + '</span>' : '') +
          (k.kun.length ? '<span><b>KUN</b>' + S.esc(k.kun.join('・')) + '</span>' : '') + '</div>' + exWords(k) + '</div>' +
          '<div class="side">' + markBtn(k.id, mastered) + S.speakBtn(H.kanji.say(k), 'Listen to ' + k.k) + '</div></div>';
      }
    },
    vocab: {
      noun: 'words',
      say: function (v) { return [v.r || v.w]; },
      front: function (v) { return '<div class="fc-front word">' + wordHtml(v) + '</div>'; },
      back: function (v) {
        return '<div class="fc-back"><div class="small-glyph">' + wordHtml(v) + '</div>' +
          (v.r ? '<div class="big-reading">' + S.esc(v.r) + '</div>' : '') +
          '<div class="big-meaning">' + S.esc(v.m) + '</div></div>';
      },
      list: function (v, mastered) {
        return '<div class="panel item' + (mastered ? ' mastered' : '') + '"><div style="min-width:140px">' +
          '<div class="word">' + wordHtml(v) + '</div>' + (v.r ? '<div class="reading furi-line">' + S.esc(v.r) + '</div>' : '') + '</div>' +
          '<div class="meaning" style="font-size:1.05rem">' + S.esc(v.m) + '</div>' +
          '<div class="side">' + alsoTag(v.id) + markBtn(v.id, mastered) + S.speakBtn(H.vocab.say(v), 'Listen to ' + v.w) + '</div></div>';
      }
    },
    grammar: {
      noun: 'grammar points',
      // the pattern, then the examples shown on the card back
      say: function (g) { return [S.kana(g.pattern)].concat((g.examples || []).slice(0, 2).map(function (e) { return S.plain(e.ja); })); },
      front: function (g) { return '<div class="fc-front pattern">' + S.ruby(g.pattern) + '</div>'; },
      back: function (g) {
        return '<div class="fc-back"><div class="g-pattern">' + S.ruby(g.pattern) + '</div>' +
          '<div class="big-meaning">' + S.esc(g.meaning) + '</div>' +
          '<div class="g-form">' + S.esc(g.formation) + '</div>' +
          (g.examples || []).slice(0, 2).map(exRow).join('') + '</div>';
      },
      list: function (g, mastered) {
        return '<div class="panel g-item' + (mastered ? ' mastered' : '') + '"><div class="g-top"><div style="flex:1">' +
          '<div class="g-pattern">' + S.ruby(g.pattern) + '</div><div class="g-meaning">' + S.esc(g.meaning) + '</div>' +
          '<div class="g-form">' + S.esc(g.formation) + '</div>' + (g.note ? '<div class="g-note">' + S.esc(g.note) + '</div>' : '') +
          '</div><div class="side">' + markBtn(g.id, mastered) + S.speakBtn(S.kana(g.pattern), 'Listen to the pattern') + '</div></div>' +
          '<div class="examples">' + (g.examples || []).map(exRow).join('') + '</div></div>';
      }
    }
  };
  function reads(k) {
    return '<div class="reads">' + (k.on.length ? '<span data-say="' + S.esc(k.on.join('、')) + '" title="Listen"><b>ON</b>' + S.esc(k.on.join('・')) + '</span>' : '') +
      (k.kun.length ? '<span data-say="' + S.esc(k.kun.join('、')) + '" title="Listen"><b>KUN</b>' + S.esc(k.kun.join('・')) + '</span>' : '') + '</div>';
  }
  function exWords(k) {
    if (!k.ex || !k.ex.length) return '';
    return '<div class="ex-words">' + k.ex.map(function (e) {
      return '<span data-say="' + S.esc(firstReading(e.r)) + '" title="Listen"><b>' + S.esc(e.w) + '</b>' + S.esc(e.r) + ' · ' + S.esc(e.m) + '</span>';
    }).join('') + '</div>';
  }
  function exRow(e) {
    return '<div class="ex"><div><div class="ja tap">' + S.ruby(e.ja) + '</div><div class="en">' + S.esc(e.en) + '</div></div>' +
      S.speakBtn(S.plain(e.ja), 'Listen to the example') + '</div>';
  }
  // a word always keeps its kanji; words with kanji above this level (v.f) get furigana over the kanji part,
  // e.g. 危ない → <ruby>危<rt>あぶ</rt></ruby>ない. Words within the level have none: the reading shows when you check.
  function wordHtml(v) {
    var w = String(v.w), r = String(v.r || '').split(/[;；,、]/)[0].trim();
    if (!v.f || !r || /[;；]/.test(w)) return S.esc(w);
    var a = 0, b = 0;
    while (a < w.length && a < r.length && w[a] === r[a] && !/[㐀-鿿々]/.test(w[a])) a++;               // shared kana at the start (お茶)
    while (b < w.length - a && b < r.length - a && w[w.length - 1 - b] === r[r.length - 1 - b] && !/[㐀-鿿々]/.test(w[w.length - 1 - b])) b++;   // okurigana
    var mid = w.slice(a, w.length - b), rmid = r.slice(a, r.length - b);
    if (!mid || !rmid) return S.esc(w);
    return S.esc(w.slice(0, a)) + '<ruby>' + S.esc(mid) + '<rt>' + S.esc(rmid) + '</rt></ruby>' + S.esc(w.slice(w.length - b));
  }
  // the same word is also listed in another level; learning it once counts for both
  function alsoTag(id) {
    var t = S.twinsOf(id); if (!t.length) return '';
    var lv = t.map(function (x) { return x.slice(0, 2).toUpperCase(); }).join(' / ');
    return '<span class="also-tag" title="This word is also in ' + lv + ' — learning it once counts for both">Also ' + lv + '</span>';
  }
  // list view toggle: mark an item as already known (or take it back)
  function markBtn(id, mastered) {
    var marked = mastered && S.isMarked(id);
    return '<button class="mark-btn' + (mastered ? ' on' : '') + '" type="button" data-mark="' + id + '" aria-pressed="' + mastered + '" title="' +
      (mastered ? (marked ? 'Marked as known — tap to undo' : 'Mastered — tap to unmark') : 'Already know this? Mark it mastered') + '">' +
      S.icon(S.ICONS.check) + '<span>' + (mastered ? 'Mastered' : 'Mark mastered') + '</span></button>';
  }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function sealFor(pct) { return pct >= 80 ? '優' : pct >= 50 ? '良' : '可'; }

  /* ---------- quiz builders ----------
     each returns { ask, prompt, cls, opts: [{ html, jp, ok }], reveal, say }; no English in the question for
     grammar or kanji, the meaning is revealed after answering */
  var PAIRS = ['かが', 'きぎ', 'くぐ', 'けげ', 'こご', 'さざ', 'しじ', 'すず', 'せぜ', 'そぞ', 'ただ', 'てで', 'とど', 'はばぱ', 'ひびぴ', 'ふぶぷ', 'へべぺ', 'ほぼぽ', 'ゃゅょ'];
  var ALT = {};
  PAIRS.forEach(function (p) { p.split('').forEach(function (c) { ALT[c] = p.replace(c, '').split(''); }); });
  var O_ROW = 'おこごそぞとどのほぼぽもよろょ', GEMINATE = 'かきくけこさしすせそたちてとぱぴぷぺぽ';
  // near-miss misreadings of a kana reading: voicing, っ, long vowels, ゃゅょ — the mistakes people actually make
  function misreadings(r, avoid) {
    var out = {}, i, c;
    function add(s) { if (s && s.length > 1 && !/ゃう|っっ|んっ/.test(s) && avoid.indexOf(s) < 0) out[s] = 1; }
    for (i = 0; i < r.length; i++) {
      c = r[i];
      (ALT[c] || []).forEach(function (a) { add(r.slice(0, i) + a + r.slice(i + 1)); });
      if (c === 'っ') { add(r.slice(0, i) + r.slice(i + 1)); add(r.slice(0, i) + 'つ' + r.slice(i + 1)); }
      if (i > 0 && i < r.length - 1 && GEMINATE.indexOf(c) >= 0 && r[i - 1] !== 'っ' && r[i - 1] !== 'ん') add(r.slice(0, i) + 'っ' + r.slice(i));
      if (O_ROW.indexOf(c) >= 0) { if (r[i + 1] === 'う') add(r.slice(0, i + 1) + r.slice(i + 2)); else add(r.slice(0, i + 1) + 'う' + r.slice(i + 1)); }
      if (c === 'ん' && i > 0) add(r.slice(0, i) + r.slice(i + 1));
    }
    return shuffle(Object.keys(out));
  }
  function firstReading(r) { return String(r || '').split(/[;；,、]/)[0].trim(); }
  function allReadings(r) { return String(r || '').split(/[;；,、]/).map(function (x) { return x.trim(); }); }
  // 3 wrong readings: misreadings first, then real readings of other words of similar length
  function readingOpts(r, avoid, others) {
    var wrong = misreadings(r, avoid).slice(0, 3);
    others = shuffle(others.filter(function (o) { return /^[ぁ-ゟ]+$/.test(o) && avoid.indexOf(o) < 0 && wrong.indexOf(o) < 0 && Math.abs(o.length - r.length) <= 1; }));
    while (wrong.length < 3 && others.length) wrong.push(others.shift());
    return wrong;
  }
  function mcq(correct, wrong, jp, fmt) {
    fmt = fmt || S.esc;
    return shuffle([{ html: fmt(correct), jp: jp, ok: true }].concat(wrong.slice(0, 3).map(function (w) { return { html: fmt(w), jp: jp, ok: false }; })));
  }
  function kanjiReads(k) { return k.on.slice(0, 2).concat(k.kun.slice(0, 2).map(function (x) { return x.replace(/[()]/g, ''); })).join('・'); }
  var KANJI_ONLY = /^[㐀-鿿々〆ヶ]+$/;
  function vocabWord(v) { return String(v.w).split(/[;；]/)[0].replace(/[～〜]/g, '').trim(); }
  function vocabKind(v) { return /^to /.test(v.m) ? 'v' : /い$/.test(vocabWord(v)) ? 'a' : 'n'; }

  var Q = {
    // extra practice: read a real compound that uses this kanji (e = one of compounds(k))
    compound: function (k, items, e) {
      var r = firstReading(e.r), others = [];
      items.forEach(function (x) { (x.ex || []).forEach(function (y) { if (y.w !== e.w) others.push(firstReading(y.r)); }); });
      return { ask: 'How do you read this compound?', prompt: S.esc(e.w), cls: '', say: r,
        opts: mcq(r, readingOpts(r, allReadings(e.r), others), true),
        reveal: '<div class="q-reveal"><div class="big-reading">' + S.esc(e.w) + ' · ' + S.esc(e.r) + '</div><div class="muted">' + S.esc(e.m) + '</div>' +
          '<div class="big-meaning" style="margin-top:10px">' + S.esc(k.k) + ' — ' + S.esc(k.m) + '</div>' + reads(k) + '</div>' };
    },
    // the main kanji quiz: which readings belong to this kanji (this is what masters it)
    kanji: function (k, items) {
      var reveal = '<div class="q-reveal"><div class="big-meaning">' + S.esc(k.m) + '</div>' + reads(k) + exWords(k) + '</div>';
      var mine = kanjiReads(k), on1 = (k.on[0] || '')[0];
      // look-alike distractors: kanji whose readings start with the same sound come first
      var pool = shuffle(items.filter(function (x) { return x.id !== k.id && kanjiReads(x) !== mine; }));
      pool.sort(function (a, b) { return ((b.on[0] || '')[0] === on1) - ((a.on[0] || '')[0] === on1); });
      return { ask: 'Which readings belong to this kanji?', prompt: S.esc(k.k), cls: '', say: readingsText(k),
        opts: mcq(mine, pool.slice(0, 3).map(kanjiReads), true), reveal: reveal };
    },
    vocab: function (v, items) {
      var w = vocabWord(v), r = firstReading(v.r);
      var reveal = '<div class="q-reveal"><div class="big-reading">' + S.esc(v.w) + (v.r ? ' · ' + S.esc(v.r) : '') + '</div><div class="big-meaning">' + S.esc(v.m) + '</div></div>';
      // reading questions only for words within the level: harder words already show their furigana
      if (KANJI_ONLY.test(w) && r && !v.f) {                                 // pure kanji compound: test the reading
        var others = items.filter(function (x) { return x.id !== v.id && KANJI_ONLY.test(vocabWord(x)); }).map(function (x) { return firstReading(x.r); });
        return { ask: 'How do you read this word?', prompt: S.esc(w), cls: ' word', say: r,
          opts: mcq(r, readingOpts(r, allReadings(v.r), others), true), reveal: reveal };
      }
      var kind = vocabKind(v);                                       // a real word: test the meaning, same word type as distractors
      var pool = shuffle(items.filter(function (x) { return x.id !== v.id && x.m !== v.m; }));
      pool.sort(function (a, b) { return (vocabKind(b) === kind) - (vocabKind(a) === kind); });
      return { ask: 'What does this mean?', prompt: wordHtml(v), cls: ' word', say: v.r || v.w,
        opts: mcq(v.m, pool.slice(0, 3).map(function (x) { return x.m; }), false), reveal: reveal };
    },
    // gq: { id: [{ q, a, o, en }] } from data/nX_gquiz.js — fill the blank in a fresh sentence
    grammar: function (g, items, i, gq) {
      var list = gq && gq[g.id], meaning = '<div class="g-pattern">' + S.ruby(g.pattern) + '</div><div class="muted">' + S.esc(g.meaning) + '</div>';
      if (!list || !list.length) {
        var pool = shuffle(items.filter(function (x) { return x.id !== g.id; })).slice(0, 3);
        var ex = (g.examples || [])[0];
        return { ask: 'Which pattern is used here?', prompt: ex ? S.ruby(ex.ja) : S.ruby(g.pattern), cls: ' text tap', say: ex ? S.plain(ex.ja) : '',
          opts: mcq(g.pattern, pool.map(function (x) { return x.pattern; }), true, S.ruby), reveal: '<div class="q-reveal">' + meaning + '</div>' };
      }
      var q = list[Math.floor(Math.random() * list.length)], parts = q.q.split('＿＿');
      var blank = function (fill) { return S.ruby(parts[0]) + (fill ? '<span class="blank filled">' + S.ruby(fill) + '</span>' : '<span class="blank">　　　</span>') + S.ruby(parts[1] || ''); };
      return { ask: 'Fill in the blank', prompt: blank(), cls: ' text sentence tap', say: S.plain(parts[0] + q.a + (parts[1] || '')),
        opts: mcq(q.a, q.o, true, S.ruby), filled: blank(q.a),
        reveal: '<div class="q-reveal"><div class="en">' + S.esc(q.en) + '</div>' + meaning + '</div>' };
    }
  };

  function compounds(k) { return (k.ex || []).filter(function (e) { return KANJI_ONLY.test(e.w) && e.w.length > 1; }); }

  window.ShioriCards = { H: H, Q: Q, wordHtml: wordHtml, compounds: compounds, exRow: exRow, shuffle: shuffle, sealFor: sealFor, markBtn: markBtn };
})();
