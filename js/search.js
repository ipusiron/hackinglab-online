// js/search.js
//
// キーワード検索の純関数（DOM 非依存）。
// ブラウザーでは IIFE で globalThis.HLOSearch に公開し、Node のテストでは module.exports から読む。
// ここにはロジックだけを置き、検索欄の処理と一覧の描画は js/main.js が行う。
//
// - 全角と半角（英数字・空白・カタカナ）と、大文字と小文字をそろえて比べる（NFKC と小文字化）
// - 前後の空白を除き、空白（全角の空白を含む）で区切った語を、すべて含むツールを出す
// - Day 番号の語（「Day12」「day 12」「Day012」）は3桁にそろえ、その番号のツールだけに当てる
// - 探す対象は、id・題名・副題・説明・タグと、カードに出すカテゴリー名（categories.json の日英の名前）

(function (root) {
  "use strict";

  // 全角の英数字・空白と半角のカタカナを NFKC でそろえ、小文字にする。
  function normalize(s) {
    var t = String(s == null ? "" : s);
    if (typeof t.normalize === "function") t = t.normalize("NFKC");
    return t.toLowerCase();
  }

  // 正規化した語が Day 番号（「day」＋数字）なら、3桁にそろえた「day012」の形を返す。そうでなければ null。
  // 数字が0だけの語（「Day050」を打ち始めた途中の「day0」「day00」）は Day 番号として扱わず、ほかの語と同じく
  // 部分一致で探す（0番のツールはないので、そろえると打つ途中で一覧が0件になる）。
  function dayTerm(term) {
    var m = /^day(\d+)$/.exec(term);
    if (!m || !/[1-9]/.test(m[1])) return null;
    var n = String(parseInt(m[1], 10));
    return "day" + (n.length < 3 ? ("000" + n).slice(-3) : n);
  }

  // 検索欄の値を、検索語の配列にする（正規化して空白で分け、空の語は捨てる）。
  // 「Day 12」のように Day と数字のあいだにある空白は詰めて1語にし、Day 番号の語は3桁にそろえる。
  function parseQuery(raw) {
    var s = normalize(raw).replace(/\bday\s+(?=\d)/g, "day");
    var parts = s.split(/\s+/);
    var terms = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      terms.push(dayTerm(parts[i]) || parts[i]);
    }
    return terms;
  }

  // id -> カテゴリー（categories.json の1件）の索引をつくる。
  function categoryIndex(categories) {
    var map = Object.create(null);
    if (!Array.isArray(categories)) return map;
    for (var i = 0; i < categories.length; i++) {
      var c = categories[i];
      if (c && typeof c.id === "string") map[c.id] = c;
    }
    return map;
  }

  // 1本のツールの検索用の項目（正規化した id と、探す対象をつないだ文字列）。
  // カテゴリー名は category_ids から引いた categories.json の日英の名前だけを入れる
  // （README にだけ書かれていてカードに出ない名前と、表記ゆれ用の別名は入れない）。
  function buildEntry(tool, catIndex) {
    var t = tool || {};
    var parts = [t.id, t.title, t.subtitle_ja, t.subtitle_en, t.description_ja, t.description_en];
    var i;
    if (Array.isArray(t.tags)) parts = parts.concat(t.tags);
    var ids = Array.isArray(t.category_ids) ? t.category_ids : [];
    for (i = 0; i < ids.length; i++) {
      var c = catIndex ? catIndex[ids[i]] : null;
      if (c) parts.push(c.ja, c.en);
    }
    var kept = [];
    for (i = 0; i < parts.length; i++) {
      if (parts[i] != null && parts[i] !== "") kept.push(String(parts[i]));
    }
    // 項目の境目は改行にする。検索語は空白を含まないので、2つの項目をまたいで当たることはない
    return { id: normalize(t.id), text: normalize(kept.join("\n")) };
  }

  // entry（buildEntry の結果）が、terms（parseQuery の結果）の語をすべて含むか（語がなければ true）。
  // Day 番号の語は、その番号のツールにだけ当てる（「Day12」で Day120〜Day127 や、説明に Day012 と書いた
  // ほかのツールを出さない）。
  function matches(entry, terms) {
    if (!terms || !terms.length) return true;
    if (!entry) return false;
    for (var i = 0; i < terms.length; i++) {
      var day = dayTerm(terms[i]);
      if (day) {
        if (entry.id !== day) return false;
      } else if (entry.text.indexOf(terms[i]) === -1) {
        return false;
      }
    }
    return true;
  }

  var api = {
    normalize: normalize,
    dayTerm: dayTerm,
    parseQuery: parseQuery,
    categoryIndex: categoryIndex,
    buildEntry: buildEntry,
    matches: matches
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOSearch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
