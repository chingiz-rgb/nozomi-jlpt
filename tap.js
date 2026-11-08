/* Shiori · tap a word in a Japanese sentence to see what it means.
   Any element with class "tap" is tappable. The dictionary (data/dict.js: every level's vocab,
   kanji and grammar) loads the first time you tap; conjugated forms are traced back to the
   dictionary form (食べました → 食べる, 高かった → 高い). */
(function () {
  var S = Shiori, INDEX = null, loading = null, pop = null;
  var PARTICLES = {
    'は': 'topic marker (pronounced wa)', 'が': 'subject marker; but', 'を': 'object marker (pronounced o)', 'に': 'at / to / in (time, place, target)',
    'で': 'at / in / by means of', 'と': 'and / with / quoting', 'も': 'also, too; even', 'へ': 'toward (pronounced e)', 'の': 'possessive (’s); nominalizer',
    'や': 'and (among others)', 'か': 'question marker; or', 'ね': 'right? isn’t it?', 'よ': 'emphasis — I tell you', 'から': 'from; because',
    'まで': 'until; up to', 'より': 'than; from', 'だけ': 'only', 'しか': 'only (with a negative)', 'など': 'etc., and so on', 'ので': 'because, since',
    'のに': 'even though; in order to', 'けど': 'but, although', 'けれど': 'but, although', 'でも': 'but; even', 'ても': 'even if', 'だ': 'is (plain copula)',
    'です': 'is (polite copula)', 'でした': 'was (polite)', 'だった': 'was (plain)', 'じゃない': 'is not', 'ではない': 'is not', 'ばかり': 'only, nothing but; just did', 'ほど': 'to the extent; about', 'くらい': 'about, approximately', 'ぐらい': 'about, approximately', 'ごろ': 'around (a time)', 'ずつ': 'each, at a time'
  };

  // everyday words usually written in kana that the JLPT lists leave out; conjugations find them too (しています → する)
  var BASIC = [['する', 'to do'], ['いる', 'to be, to exist (people, animals); ~ing (after て)'], ['ある', 'to be, to exist (things); to have'],
    ['なる', 'to become'], ['くる', 'to come'], ['できる', 'to be able to; to be done'], ['いう', 'to say; to be called'], ['もらう', 'to receive'],
    ['くれる', 'to give (to me)'], ['あげる', 'to give'], ['しまう', 'to finish; to do completely (after て)'], ['みる', 'to try doing (after て)'],
    ['おく', 'to do in advance (after て)'], ['いい', 'good'], ['ない', 'not; there isn’t'], ['こと', 'thing, matter'], ['もの', 'thing; because'],
    ['ところ', 'place; just about to / just did'], ['よう', 'like, as if; so that'], ['それ', 'that'], ['これ', 'this'], ['あれ', 'that (over there)'], ['どれ', 'which']];

  /* ---------- dictionary ---------- */
  function load(cb) {
    if (INDEX) return cb();
    if (loading) return loading.push(cb);
    loading = [cb];
    function done() { var q = loading; loading = null; q.forEach(function (f) { f(); }); }
    var el = document.createElement('script');
    el.src = 'data/dict.js';
    el.onload = function () { build(); done(); };
    el.onerror = function () { INDEX = {}; done(); };
    document.head.appendChild(el);
  }
  function build() {
    INDEX = {};
    function put(k, e) { k = k.trim(); if (k) (INDEX[k] = INDEX[k] || []).push(e); }
    BASIC.forEach(function (b) { put(b[0], [b[0], '', b[1], 'c']); });
    (window.SHIORI_DICT || []).forEach(function (e) {
      e[0].split(/[;；]/).forEach(function (w) { put(w, e); });
      // kana readings are keys too (so わたし finds 私) — but not kanji on/kun lists
      if (e[3][0] !== 'k') e[1].split(/[;；]/).forEach(function (r) { put(r, e); });
    });
  }

  /* ---------- conjugation → dictionary form ---------- */
  var U = 'うくぐすつぬぶむる', A = 'わかがさたなばまら', I = 'いきぎしちにびみり', E = 'えけげせてねべめれ', O = 'おこごそとのぼもろ';
  var RULES = [];
  function rule(from, to) { RULES.push([from, to]); }
  (function () {
    var j, x;
    for (j = 0; j < 9; j++) {
      ['ます', 'ました', 'ません', 'ませんでした', 'ましょう', 'たい', 'たかった', 'たくない', 'たくて', 'ながら', 'なさい', 'そう', ''].forEach(function (s) { rule(I[j] + s, U[j]); });
      ['ない', 'なかった', 'なくて', 'なければ', 'なきゃ', 'ず', 'ずに', 'せる', 'れる', 'れた', 'せた', 'ないで', 'されて', 'れて'].forEach(function (s) { rule(A[j] + s, U[j]); });
      ['る', 'た', 'て', 'ない', 'ば', 'ます'].forEach(function (s) { rule(E[j] + s, U[j]); });
      rule(O[j] + 'う', U[j]);
    }
    ['て', 'た', 'たら', 'たり'].forEach(function (t) {
      var d = t.replace('て', 'で').replace('た', 'だ');
      rule('い' + t, 'く'); rule('い' + d, 'ぐ'); rule('し' + t, 'す');
      rule('っ' + t, 'う'); rule('っ' + t, 'つ'); rule('っ' + t, 'る'); rule('っ' + t, 'く');
      rule('ん' + d, 'ぬ'); rule('ん' + d, 'ぶ'); rule('ん' + d, 'む');
    });
    ['ます', 'ました', 'ません', 'ませんでした', 'ましょう', 'たい', 'たかった', 'ない', 'なかった', 'なくて', 'なければ', 'て', 'た', 'たら', 'たり',
      'れる', 'られる', 'させる', 'られた', 'させた', 'よう', 'れば', 'ろ', 'ず', 'ずに', 'ないで', 'ながら', 'なさい', 'そう', ''].forEach(function (s) { rule(s, 'る'); });
    ['ている', 'ていて', 'ていた', 'ています', 'ていました', 'ていない', 'てる', 'てた', 'てしまう', 'てしまった', 'ちゃう', 'ちゃった', 'てください', 'ておく', 'てある', 'てみる', 'てみた', 'てから', 'ても']
      .forEach(function (s) { rule(s, 'て'); rule(s.replace(/^て/, 'で').replace(/^ちゃ/, 'じゃ'), 'で'); });
    ['くない', 'かった', 'くなかった', 'くて', 'く', 'ければ', 'さ', 'そう', 'すぎる', 'すぎた', 'くなる', 'くなった', 'かったら'].forEach(function (s) { rule(s, 'い'); });
    ['します', 'しました', 'しません', 'して', 'していて', 'した', 'しない', 'しなかった', 'しよう', 'される', 'させる', 'しています', 'している', 'できる', 'できます', 'しましょう', 'したい', 'すれば'].forEach(function (s) { rule(s, 'する'); });
    ['きます', 'きました', 'きて', 'きた', 'こない', 'こなかった', 'こよう', 'きたい'].forEach(function (s) { rule(s, 'くる'); });
    for (x in { '行って': 1, '行った': 1 }) rule(x, '行く');
  })();
  function forms(s) {
    var out = [s], seen = {}; seen[s] = 1;
    for (var depth = 0, from = 0; depth < 3; depth++) {
      var to = out.length;
      for (var i = from; i < to; i++) {
        var w = out[i];
        RULES.forEach(function (r) {
          if (r[0] ? r[0].length <= w.length && w.slice(-r[0].length) === r[0] : w.length > 1) {
            var f = w.slice(0, w.length - r[0].length) + r[1];
            if (!seen[f]) { seen[f] = 1; out.push(f); }
          }
        });
      }
      from = to;
    }
    return out;
  }
  var KANA_ONLY = /^[぀-ヿ]+$/;
  // longest dictionary word at text[p...]
  function matchAt(text, p) {
    for (var n = Math.min(10, text.length - p); n >= 1; n--) {
      var s = text.substr(p, n);
      if (!/^[぀-ヿ㐀-鿿々〆ヶー]+$/.test(s)) continue;
      if (PARTICLES[s]) return { p: p, n: n, word: s, hits: [[s, '', PARTICLES[s], 'p']] };
      if (n === 1 && KANA_ONLY.test(s)) continue;      // lone kana: only particles, never homophones
      // of all dictionary forms this could come from, prefer basic kana words, then words written exactly
      // this way; a kana stretch that only matches someone else's reading (しています → 知る) is a last resort
      var fs = forms(s), best = null, kana = KANA_ONLY.test(s);
      for (var i = 0; i < fs.length; i++) {
        var h = INDEX[fs[i]];
        if (!h) continue;
        var exact = h.some(function (e) { return e[0] === fs[i]; });
        if (kana && !exact && n < 3) continue;
        var score = (h[0][3] === 'c' ? 4 : 0) + (exact ? 2 : 0) + (i === 0 ? 1 : 0);
        if (!best || score > best.score) best = { p: p, n: n, word: fs[i], hits: h, score: score };
      }
      if (best && !(kana && best.score < 2)) return best;
    }
    return null;
  }
  // the best word covering position off: tries starting a few characters earlier too (tap on 強 in 勉強)
  function lookup(text, off) {
    var best = null;
    for (var p = Math.max(0, off - 5); p <= off; p++) {
      var m = matchAt(text, p);
      // a grammar pattern reaching back before the tapped word (に行く) shouldn't beat the plain word (行く)
      if (m) m.w = m.n - (m.p < off && /^g/.test(m.hits[0][3]) ? 2 : 0);
      if (m && m.p + m.n > off && (!best || m.w > best.w)) best = m;
    }
    return best;
  }

  /* ---------- tap → character offset in the sentence (ruby furigana ignored) ---------- */
  function textNodes(root) {
    var out = [], w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: function (n) { return n.parentNode.closest('rt, button, .tap-skip') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT; }
    });
    while (w.nextNode()) out.push(w.currentNode);
    return out;
  }
  function caretAt(x, y) {
    if (document.caretPositionFromPoint) { var c = document.caretPositionFromPoint(x, y); return c && { node: c.offsetNode, off: c.offset }; }
    if (document.caretRangeFromPoint) { var r = document.caretRangeFromPoint(x, y); return r && { node: r.startContainer, off: r.startOffset }; }
    return null;
  }
  function charRect(node, i) { var r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + 1); return r.getBoundingClientRect(); }
  function inside(rc, x, y) { return x >= rc.left - 1 && x <= rc.right + 1 && y >= rc.top - 2 && y <= rc.bottom + 2; }

  function onTap(e) {
    if (e.target.closest('.word-pop')) return;
    var root = e.target.closest('.tap');
    if (!root || e.target.closest('button, a, [data-say]')) { close(); return; }
    var c = caretAt(e.clientX, e.clientY);
    if (!c || c.node.nodeType !== 3) { close(); return; }
    var node = c.node, off = c.off;
    var rt = node.parentNode.closest('rt');
    if (rt) {                                            // tapped the furigana: use the kanji under it
      var base = textNodes(rt.parentNode)[0]; if (!base) return close();
      node = base; off = 0;
    } else {
      // the caret sits between characters: pick the character actually under the finger
      if (off < node.length && inside(charRect(node, off), e.clientX, e.clientY)) {}
      else if (off > 0 && inside(charRect(node, off - 1), e.clientX, e.clientY)) off--;
      else if (off >= node.length) return close();
    }
    var nodes = textNodes(root), text = '', at = -1, starts = [];
    nodes.forEach(function (n) { starts.push(text.length); if (n === node) at = text.length + off; text += n.data; });
    if (at < 0) return close();
    var x = e.clientX, y = e.clientY;
    load(function () {
      var m = lookup(text, at);
      if (!m) return show(x, y, null, text.charAt(at));
      highlight(nodes, starts, m.p, m.n);
      show(x, y, m, text.substr(m.p, m.n));
    });
  }

  /* ---------- popup ---------- */
  var TAG = { p: 'particle', c: 'basic word', g5: 'N5 grammar', g4: 'N4 grammar', g3: 'N3 grammar', g2: 'N2 grammar', g1: 'N1 grammar', k5: 'N5 kanji', k4: 'N4 kanji', k3: 'N3 kanji', k2: 'N2 kanji', k1: 'N1 kanji' };
  function show(x, y, m, surface) {
    close(true);
    pop = document.createElement('div');
    pop.className = 'panel word-pop'; pop.setAttribute('role', 'dialog');
    if (!m) pop.innerHTML = '<div class="wp-word">' + S.esc(surface) + '</div><div class="muted">Not in the dictionary — it may be part of a longer word or a name.</div>';
    else {
      // words before kanji; at most 3 meanings so the popup stays small
      var hits = m.hits.slice().sort(function (a, b) { return (a[3][0] === 'k') - (b[3][0] === 'k'); }).slice(0, 3);
      var say = hits[0][1] && hits[0][3][0] !== 'k' ? hits[0][1].split(/[;；]/)[0] : m.word;
      pop.innerHTML = '<div class="wp-top"><div><div class="wp-word">' + S.esc(m.word) + '</div>' +
        (surface !== m.word ? '<div class="wp-form">from ' + S.esc(surface) + '</div>' : '') + '</div>' + S.speakBtn(say, 'Listen to ' + m.word) + '</div>' +
        hits.map(function (h) {
          return '<div class="wp-entry">' + (h[1] ? '<div class="wp-read">' + S.esc(h[1]) + '</div>' : '') +
            '<div class="wp-mean">' + S.esc(h[2]) + '</div><span class="wp-tag">' + S.esc(TAG[h[3]] || h[3].toUpperCase()) + '</span></div>';
        }).join('');
    }
    document.body.appendChild(pop);
    var w = pop.offsetWidth, h = pop.offsetHeight, vw = document.documentElement.clientWidth, vh = window.innerHeight;
    var left = Math.min(Math.max(10, x - w / 2), vw - w - 10), top = y + 18;
    if (top + h > vh - 10) top = Math.max(10, y - h - 14);
    pop.style.left = left + 'px'; pop.style.top = top + 'px';
  }
  function highlight(nodes, starts, p, n) {
    if (!window.CSS || !CSS.highlights || !window.Highlight) return;
    var r = document.createRange(), set = 0;
    for (var i = 0; i < nodes.length; i++) {
      var a = starts[i], b = a + nodes[i].data.length;
      if (!(set & 1) && p >= a && p < b) { r.setStart(nodes[i], p - a); set |= 1; }
      if (set & 1 && p + n > a && p + n <= b) { r.setEnd(nodes[i], p + n - a); set |= 2; break; }
    }
    if (set === 3) CSS.highlights.set('tap-word', new Highlight(r));
  }
  function close() {
    if (pop) { pop.remove(); pop = null; }
    if (window.CSS && CSS.highlights) CSS.highlights.delete('tap-word');
  }
  document.addEventListener('click', onTap);
  window.addEventListener('scroll', function () { close(); }, { passive: true });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

  window.ShioriTap = { lookup: function (text, at, cb) { load(function () { cb(lookup(text, at)); }); }, forms: forms };
})();
