// js/search.js
//
// キーワード検索の純関数（DOM 非依存）。
// ブラウザーでは IIFE で globalThis.HLOSearch に公開し、Node のテストでは module.exports から読む。
// ここにはロジックだけを置き、検索欄の処理と一覧の描画は js/main.js が行う。
//
// - 全角と半角（英数字・空白・カタカナ）と、大文字と小文字をそろえて比べる（NFKC と小文字化）
// - 前後の空白を除き、空白（全角の空白を含む）で区切った語を、すべて含むツールを出す
// - Day 番号の語（「Day12」「day 12」「Day012」）は3桁にそろえ、その番号のツールだけに当てる
// - 探す対象は、id・題名・副題・説明・タグと、カードに出すカテゴリー名（categories.json の日英の名前と、表記ゆれ用の別名）

(function (root) {
  "use strict";

  // Tool-specific vocabulary, kept separate from category aliases. IDs are
  // stable catalog references; aliases never expand to every tool in a category.
  var TOOL_ALIASES = Object.freeze({
    // Route safety-evaluation wording to strength scoring, not a safety guarantee.
    day001: ["パスワードの強さ", "パスワードの安全性を評価"],
    day007: ["写真", "撮影場所", "GPS情報", "位置情報を消す", "photo", "geotag", "metadata removal"],
    day023: ["不可視文字", "ゼロ幅文字", "ホモグリフ", "同形異字", "文字が一致しない", "文字列が一致しない"],
    day033: ["コピー", "貼り付け", "書き換え", "コピペ", "copy", "clipboard rewriting", "clipboard hijacking"],
    day039: ["追跡情報", "追跡パラメーター", "削除", "tracking removal", "clean link"],
    day040: ["ファイルの中身", "拡張子の確認", "ファイル形式", "不一致", "食い違い", "食い違う", "file type", "file contents", "extension check"],
    day075: ["画像認証", "文字認証", "キャプチャ認証", "カプチャ"],
    day077: ["フィンガープリント", "フィンガープリンティング", "ブラウザ指紋", "ブラウザフィンガープリント"],
    day087: ["鍵の貸し借り", "鍵の貸出", "鍵の返却", "貸出台帳", "key lending", "key borrowing", "key checkout"]
  });

  // New purpose phrases require every phrase term in the query. This keeps
  // "comparison" from combining on its own with the Forensics category's
  // "Image Analysis" alias. Existing catalog and alias words remain searchable.
  // The inspector's A/B comparison checks whether text strings match.
  var TOOL_PHRASES = Object.freeze({
    day023: ["文字列比較", "文字列 比較", "文字列を比較", "文字の比較", "Unicode 比較",
      "text comparison", "string comparison", "compare two strings", "compare strings", "WeirdString comparison"]
  });

  // These exact catalog sentences name unsupported uses. Exclude them only
  // from the named tool's search description, never from displayed metadata.
  // This is not general negation parsing; changed descriptions remain searchable.
  var DESCRIPTION_EXCLUSIONS = Object.freeze({
    day075: {
      description_ja: "人やOCRの読み取り成功率は測定しません。",
      description_en: "Does not measure human or OCR reading success."
    },
    day089: {
      description_ja: "パスワードの強度や人物の特定には使えません。",
      description_en: "Not a password strength or identity assessment."
    }
  });

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

  function searchDescription(tool, toolId, field) {
    var text = tool[field];
    var excluded = Object.prototype.hasOwnProperty.call(DESCRIPTION_EXCLUSIONS, toolId)
      ? DESCRIPTION_EXCLUSIONS[toolId][field] : "";
    return excluded && typeof text === "string" ? text.split(excluded).join("\n") : text;
  }

  // 1本のツールの検索用の項目（正規化した id と、探す対象をつないだ文字列）。
  // カテゴリーは category_ids から引いた categories.json の日英の名前と、表記ゆれ用の別名（aliases_ja・aliases_en。
  // 「デジタルフォレンジック」「クラシカル暗号」など）を入れる。README にだけ書かれていてカードに出ない名前は入れない。
  function buildEntry(tool, catIndex) {
    var t = tool || {};
    var toolId = normalize(t.id);
    var parts = [t.id, t.title, t.subtitle_ja, t.subtitle_en,
      searchDescription(t, toolId, "description_ja"), searchDescription(t, toolId, "description_en")];
    if (Object.prototype.hasOwnProperty.call(TOOL_ALIASES, toolId)) parts = parts.concat(TOOL_ALIASES[toolId]);
    var i;
    if (Array.isArray(t.tags)) parts = parts.concat(t.tags);
    var ids = Array.isArray(t.category_ids) ? t.category_ids : [];
    for (i = 0; i < ids.length; i++) {
      var c = catIndex ? catIndex[ids[i]] : null;
      if (!c) continue;
      parts.push(c.ja, c.en);
      if (Array.isArray(c.aliases_ja)) parts = parts.concat(c.aliases_ja);
      if (Array.isArray(c.aliases_en)) parts = parts.concat(c.aliases_en);
    }
    var kept = [];
    for (i = 0; i < parts.length; i++) {
      if (parts[i] != null && parts[i] !== "") kept.push(String(parts[i]));
    }
    // 項目の境目は改行にする。検索語は空白を含まないので、2つの項目をまたいで当たることはない
    var entry = { id: normalize(t.id), text: normalize(kept.join("\n")) };
    if (Object.prototype.hasOwnProperty.call(TOOL_PHRASES, toolId)) {
      entry.phrases = TOOL_PHRASES[toolId].map(parseQuery);
    }
    return entry;
  }

  // entry（buildEntry の結果）が、terms（parseQuery の結果）の語をすべて含むか（語がなければ true）。
  // Day 番号の語は、その番号のツールにだけ当てる（「Day12」で Day120〜Day127 や、説明に Day012 と書いた
  // ほかのツールを出さない）。
  function matches(entry, terms) {
    if (!terms || !terms.length) return true;
    if (!entry) return false;
    var text = entry.text;
    var phrases = entry.phrases || [];
    for (var p = 0; p < phrases.length; p++) {
      var phrase = phrases[p];
      if (phrase.every(function (term) { return terms.indexOf(term) !== -1; })) {
        text += "\n" + phrase.join("\n");
      }
    }
    for (var i = 0; i < terms.length; i++) {
      var day = dayTerm(terms[i]);
      if (day) {
        if (entry.id !== day) return false;
      } else if (text.indexOf(terms[i]) === -1) {
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
