// js/url.js
//
// URL を読む・作る純関数（DOM 非依存）。一覧の条件を URL に残すための読み書きと、カードのリンクの言語ごとの形を置く。
// ブラウザーでは IIFE で globalThis.HLOUrl に公開し、Node のテストでは module.exports から読む。
// 履歴（pushState・replaceState・popstate）の扱いと画面の描き直しは js/main.js が行う。
//
// 一覧の条件の URL の形（いつもこの順に並べ、値が空の条件は書かない）：
//   ?book=<本の slug>（books.json）&cat=<カテゴリーの id>（categories.json）&field=<分野の id>（category_groups.json）&q=<検索欄の文字>&tools=day001,day002&tab=dashboard&lang=en
// 進捗の条件はこの端末の記録で決まるので、URL に入れない。表示の言語は英語のときだけ lang=en を書く（決めるのは js/lang.js）。

(function (root) {
  "use strict";

  // URL に書く条件の名前（この順に並べる）
  var KEYS = ["book", "cat", "field", "q", "tools", "tab", "lang"];
  var MAX_TOOLS = 12;

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
    var requestedCategory = lower(params.get("cat"));
    if (requestedCategory === "learning-support") requestedCategory = "machine-learning";
    var cat = pick(k.categories, requestedCategory);
    return {
      book: book === "all" ? "" : pick(k.books, book),
      cat: cat,
      field: cat ? "" : pick(k.fields, params.get("field")),
      q: q == null ? "" : String(q).trim(),
      tab: lower(params.get("tab")) === "dashboard" ? "dashboard" : "tools"
    };
  }

  // 数字または Day 付きの数字を dayNNN にそろえる。URL の ID は半角数字の 1〜999。
  // 前後と Day の直後の空白は除くが、小数・符号・末尾の文字などは採らない。
  function normalizeToolId(value) {
    if (typeof value !== "string" && typeof value !== "number") return "";
    var match = /^(?:day\s*)?([0-9]{1,3})$/i.exec(String(value).trim());
    if (!match || Number(match[1]) === 0) return "";
    return "day" + String(Number(match[1])).padStart(3, "0");
  }

  // visibleIds は表示対象だけの ID 配列または Set。元の配列・Set は変更しない。
  function visibleToolIds(visibleIds) {
    var values = Array.isArray(visibleIds) ? visibleIds : visibleIds instanceof Set ? Array.from(visibleIds) : [];
    return new Set(values.map(normalizeToolId).filter(Boolean));
  }

  // 書くときも読むときも、表記をそろえてから重複を除き、最初の12本を採る。
  // allowed があるときは表示対象だけを採る。不明な入力そのものは返さない。
  function collectTools(values, allowed) {
    var result = { ids: [], unknown: false, truncated: false };
    var seen = new Set();
    values.forEach(function (value) {
      if (value == null || (typeof value === "string" && !value.trim())) return;
      var id = normalizeToolId(value);
      if (!id || (allowed && !allowed.has(id))) {
        result.unknown = true;
      } else if (!seen.has(id)) {
        seen.add(id);
        if (result.ids.length < MAX_TOOLS) result.ids.push(id);
        else result.truncated = true;
      }
    });
    return result;
  }

  // 複数の ?tools= を URL 順に読み、それぞれのカンマ区切りをつなぐ。
  // 空指定と指定なしは present で区別する。不明値や重複は12本の枠を使わない。
  function readTools(search, visibleIds) {
    var params;
    try {
      params = new URLSearchParams(search || "");
    } catch (e) {
      params = new URLSearchParams("");
    }
    if (!params.has("tools")) return { present: false, ids: [], unknown: false, truncated: false };
    var values = [];
    params.getAll("tools").forEach(function (value) {
      values = values.concat(value.split(","));
    });
    var result = collectTools(values, visibleToolIds(visibleIds));
    return { present: true, ids: result.ids, unknown: result.unknown, truncated: result.truncated };
  }

  // #day… だけをカードの位置として扱う。本の章など、ほかの # はそのまま別の処理へ渡す。
  // エスケープは一度だけ解き、既知の表示対象と確認できた場合だけ ID を返す。
  function readToolHash(hash, visibleIds) {
    if (hash == null || hash === "" || hash === "#") return { kind: "none", id: "" };
    if (typeof hash !== "string" || hash.charAt(0) !== "#") return { kind: "other", id: "" };
    var value;
    try {
      value = decodeURIComponent(hash.slice(1));
    } catch (e) {
      return { kind: /^#day/i.test(hash) ? "unknown" : "other", id: "" };
    }
    if (!/^day/i.test(value)) return { kind: "other", id: "" };
    var id = normalizeToolId(value);
    return id && visibleToolIds(visibleIds).has(id) ? { kind: "known", id: id } : { kind: "unknown", id: "" };
  }

  // href に一覧の条件を書いた URL を返す。state に入れた条件だけを書き換え、入れなかった条件とほかのパラメーターは残す。
  // 条件は KEYS の順に並べ、ほかのパラメーターはその後ろに元の順で置く。空の値は書かず、何も残らなければ "?" も付けない。
  // tools を渡さなければ、複数ある値も空の値も残す。配列を渡したときだけ正規化して1つにまとめ、空配列・空値なら外す。
  // 書く tools の実在確認は呼び出し元で行う（readTools の ids などを渡す）。
  // hash を渡したときはその値を最優先する（空なら外す）。渡さず本を変えたときは、前の本の章の位置（#book-group-…）を外す。
  // lang は "en" なら lang=en を書く。"ja" なら書かない（ただし、もとの URL が ?lang=ja ならそのまま残す。?lang=ja のリンクで
  // 開いた人が、再読み込みや絞り込みのあとも日本語のままになるように）。
  function buildUrl(href, state) {
    var url = new URL(href);
    var s = state || {};
    var cur = url.searchParams;
    var values = {};
    var i;
    for (i = 0; i < KEYS.length; i++) {
      values[KEYS[i]] = KEYS[i] === "tools" ? cur.getAll("tools") : cur.get(KEYS[i]);
    }
    if (has(s, "book")) values.book = s.book ? String(s.book) : null;
    if (has(s, "cat")) values.cat = s.cat ? String(s.cat) : null;
    if (has(s, "field")) values.field = s.field ? String(s.field) : null;
    if (has(s, "q")) values.q = String(s.q == null ? "" : s.q).trim() || null;
    if (has(s, "tools")) {
      var ids = collectTools(Array.isArray(s.tools) ? s.tools : [], null).ids;
      values.tools = ids.length ? [ids.join(",")] : [];
    }
    if (has(s, "tab")) values.tab = s.tab === "dashboard" ? "dashboard" : null;
    if (has(s, "lang")) values.lang = s.lang === "en" ? "en" : lower(cur.get("lang")) === "ja" ? "ja" : null;
    if (has(s, "hash")) {
      url.hash = s.hash == null ? "" : String(s.hash);
    } else if (has(s, "book") && lower(cur.get("book")) !== lower(values.book) && url.hash.indexOf("#book-group-") === 0) {
      url.hash = "";
    }
    var out = new URLSearchParams();
    for (i = 0; i < KEYS.length; i++) {
      if (KEYS[i] === "tools") {
        values.tools.forEach(function (value) { out.append("tools", value); });
      } else if (values[KEYS[i]]) out.append(KEYS[i], values[KEYS[i]]);
    }
    cur.forEach(function (v, key) {
      if (KEYS.indexOf(key) < 0) out.append(key, v);
    });
    var qs = out.toString();
    url.search = qs ? "?" + qs : "";
    return url.toString();
  }

  // 絶対 URL の href に、英語のときだけ ?lang=en を付ける（ほかのパラメーターと # は残す）。日本語のときと、URL として
  // 読めないときはそのまま返す（「はじめ方」の入口・ダッシュボードの本の行を新しいタブで開いたとき、Xで共有する URL）
  function withLang(href, lang) {
    var h = String(href == null ? "" : href);
    if (lang !== "en") return h;
    var url;
    try {
      url = new URL(h);
    } catch (e) {
      return h;
    }
    url.searchParams.set("lang", "en");
    return url.toString();
  }

  // ---- カードのリンク（言語ごと） ----

  // 英語表示のときの「GitHub」のリンク先。リポジトリーのトップ（https://github.com/<owner>/<repo>）なら、英語の README
  // （README.en.md）を開く。既定のブランチが main でも master でも開けるよう、ブランチの名前の代わりに HEAD を使う。
  // 日本語表示と、ほかの形の URL はそのまま返す
  function repoLink(repoUrl, lang) {
    var u = typeof repoUrl === "string" ? repoUrl : "";
    if (lang !== "en") return u;
    var m = /^(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(u);
    return m ? m[1] + "/blob/HEAD/README.en.md" : u;
  }

  // 英語表示のときの「デモ」のリンク先。ipusiron.github.io のページなら ?lang=en を付ける（ほかのパラメーターと # は残す）。
  // 日本語表示と、ほかの場所（Google Colab など）のリンクはそのまま返す
  function demoLink(demoUrl, lang) {
    var u = typeof demoUrl === "string" ? demoUrl : "";
    if (lang !== "en" || !u) return u;
    var url;
    try {
      url = new URL(u);
    } catch (e) {
      return u;
    }
    if (url.protocol !== "https:" || url.hostname !== "ipusiron.github.io") return u;
    url.searchParams.set("lang", "en");
    return url.toString();
  }

  var api = {
    KEYS: KEYS,
    readState: readState,
    normalizeToolId: normalizeToolId,
    readTools: readTools,
    readToolHash: readToolHash,
    buildUrl: buildUrl,
    withLang: withLang,
    repoLink: repoLink,
    demoLink: demoLink
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOUrl = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
