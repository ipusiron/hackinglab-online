// js/url.js
//
// URL を読む・作る純関数（DOM 非依存）。一覧の条件を URL に残すための読み書きを置く。
// ブラウザーでは IIFE で globalThis.HLOUrl に公開し、Node のテストでは module.exports から読む。
// 履歴（pushState・replaceState・popstate）の扱いと画面の描き直しは js/main.js が行う。
//
// 一覧の条件の URL の形（いつもこの順に並べ、値が空の条件は書かない）：
//   ?book=<本の slug>（books.json）&cat=<カテゴリーの id>（categories.json）&q=<検索欄の文字>&tab=dashboard
// 進捗の条件はこの端末の記録で決まるので、URL に入れない。

(function (root) {
  "use strict";

  // URL に書く一覧の条件の名前（この順に並べる）
  var KEYS = ["book", "cat", "q", "tab"];

  function lower(v) {
    return String(v == null ? "" : v).trim().toLowerCase();
  }

  function has(o, key) {
    return Object.prototype.hasOwnProperty.call(o, key);
  }

  // list（文字列の配列）の中から、大文字・小文字と前後の空白を無視して v と同じものを返す。無ければ ""。
  function pick(list, v) {
    var key = lower(v);
    if (!key || !Array.isArray(list)) return "";
    for (var i = 0; i < list.length; i++) {
      if (typeof list[i] === "string" && list[i].toLowerCase() === key) return list[i];
    }
    return "";
  }

  // search（location.search）から一覧の条件を読む。
  // known.books（本の slug の配列）・known.categories（カテゴリーの id の配列）にない値は無視して "" にする（"all" も ""）。
  // q は前後の空白を除いた検索欄の文字、tab は "dashboard" か "tools"（ほかの値は "tools"）。
  function readState(search, known) {
    var params;
    try {
      params = new URLSearchParams(search || "");
    } catch (e) {
      params = new URLSearchParams("");
    }
    var k = known || {};
    var book = lower(params.get("book"));
    var q = params.get("q");
    return {
      book: book === "all" ? "" : pick(k.books, book),
      cat: pick(k.categories, params.get("cat")),
      q: q == null ? "" : String(q).trim(),
      tab: lower(params.get("tab")) === "dashboard" ? "dashboard" : "tools"
    };
  }

  // href に一覧の条件を書いた URL を返す。state に入れた条件だけを書き換え、入れなかった条件とほかのパラメーターは残す。
  // 条件は KEYS の順に並べ、ほかのパラメーターはその後ろに元の順で置く。空の値は書かず、何も残らなければ "?" も付けない。
  // 本を変えるときは、前の本の章の位置（#book-group-…）を外す。ほかの # はそのまま残す。
  function buildUrl(href, state) {
    var url = new URL(href);
    var s = state || {};
    var cur = url.searchParams;
    var values = {};
    var i;
    for (i = 0; i < KEYS.length; i++) values[KEYS[i]] = cur.get(KEYS[i]);
    if (has(s, "book")) values.book = s.book ? String(s.book) : null;
    if (has(s, "cat")) values.cat = s.cat ? String(s.cat) : null;
    if (has(s, "q")) values.q = String(s.q == null ? "" : s.q).trim() || null;
    if (has(s, "tab")) values.tab = s.tab === "dashboard" ? "dashboard" : null;
    if (has(s, "book") && lower(cur.get("book")) !== lower(values.book) && url.hash.indexOf("#book-group-") === 0) {
      url.hash = "";
    }
    var out = new URLSearchParams();
    for (i = 0; i < KEYS.length; i++) {
      if (values[KEYS[i]]) out.append(KEYS[i], values[KEYS[i]]);
    }
    cur.forEach(function (v, key) {
      if (KEYS.indexOf(key) < 0) out.append(key, v);
    });
    var qs = out.toString();
    url.search = qs ? "?" + qs : "";
    return url.toString();
  }

  var api = {
    KEYS: KEYS,
    readState: readState,
    buildUrl: buildUrl
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOUrl = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
