// js/lang.js
//
// 表示の言語と、「はじめ方」（#start-here）を開いて始めるか閉じて始めるかを、ページを描く前に決める。
// index.html の <head> で defer を付けずに読み、<html lang> と <html data-start> を書く。
//
// 言語：CSS が .label-ja / .label-en をこの lang で出し分けるので、保存した言語が英語でも、最初の描画から英語になる。
// 決める順は、URL の ?lang=（ja か en。大文字・前後の空白は直し、ほかの値は無視）→ この端末に保存した言語 → 日本語。
// ブラウザーの言語では切り替えない。保存するのは JA・EN を押したときだけ（js/main.js）で、?lang= で開いただけでは保存しない。
//
// 「はじめ方」：?book= または ?tools= で来たときは閉じる（本のツールを先に見せる）→ この端末に覚えた開閉（"open" か "closed"）→
// どちらもなければ書かない（css と js/main.js が画面の幅で決める。768px 以上は開き、狭い画面は閉じる）。
// 覚えるのは js/main.js で、利用者が開閉したときはその形を、覚えた開閉のない人が一覧を使い始めたとき（入口・本を選ぶ・
// 進捗を付ける）は "closed" を残す（次に開いたときからは閉じて始める。開いただけ・見ただけでは残さない）。
// css は data-start が "closed" のとき、main.js が開閉を合わせるまで中身を出さない（開いた形で一度描いてから閉じると、
// 下の部品が上へずれるため）。
//
// ブラウザーでは globalThis.HLOLang に公開し、Node のテストでは module.exports から読む。
(function (root) {
  "use strict";

  // 選んだ言語を保存する localStorage のキー
  var KEY = "hlo_lang";
  // 「はじめ方」の開閉を覚える localStorage のキー
  var START_KEY = "hlo_start_here";

  // "ja" か "en" に直す。どちらでもなければ ""
  function normalizeLang(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "ja" || s === "en" ? s : "";
  }

  // search（location.search）の ?lang= を読む。無い・読めない・ja と en 以外は ""
  function langFromSearch(search) {
    try {
      return normalizeLang(new URLSearchParams(search || "").get("lang"));
    } catch (e) {
      return "";
    }
  }

  // 表示の言語を決める（?lang= → 保存した言語 → 日本語）
  function resolveLang(search, saved) {
    return langFromSearch(search) || normalizeLang(saved) || "ja";
  }

  // "open" か "closed" に直す。どちらでもなければ ""
  function normalizeStart(v) {
    var s = String(v == null ? "" : v).trim().toLowerCase();
    return s === "open" || s === "closed" ? s : "";
  }

  // search に本の指定（?book=）があるか。空と all は指定なし（js/main.js がバナーの場所を取るときと同じ見方）
  function hasBookParam(search) {
    try {
      var v = new URLSearchParams(search || "").get("book");
      v = v == null ? "" : String(v).trim().toLowerCase();
      return v !== "" && v !== "all";
    } catch (e) {
      return false;
    }
  }

  // 「はじめ方」を開いて始めるか（?book= → 覚えた開閉）。"open" / "closed"、決まらなければ ""（画面の幅で決める）
  function resolveStart(search, saved) {
    if (hasBookParam(search)) return "closed";
    try {
      if (new URLSearchParams(search || "").has("tools")) return "closed";
    } catch (e) {
      /* URLを読めないときは、覚えた開閉を使う */
    }
    return normalizeStart(saved);
  }

  // 保存した値を読む（key を省くと言語）。getStorage は localStorage を返す関数（取り出すだけで例外を投げる環境があるため関数で受ける）。
  // 保存できない・読めない環境では null（そのときは ?lang= か日本語で、「はじめ方」は ?book= か画面の幅で決まる）
  function readSaved(getStorage, key) {
    try {
      var s = getStorage();
      return s && typeof s.getItem === "function" ? s.getItem(key || KEY) : null;
    } catch (e) {
      return null;
    }
  }

  // A set or a single-tool hash takes priority over a book arrival.
  function isBookArrival(search, hash) {
    if (!hasBookParam(search)) return false;
    try {
      if (new URLSearchParams(search || "").has("tools")) return false;
      var fragment;
      try { fragment = decodeURIComponent(String(hash || "").replace(/^#/, "")); }
      catch (_) { fragment = String(hash || "").replace(/^#/, ""); }
      return !/^day/i.test(fragment);
    } catch (_) { return false; }
  }

  var api = {
    KEY: KEY,
    START_KEY: START_KEY,
    normalizeLang: normalizeLang,
    langFromSearch: langFromSearch,
    resolveLang: resolveLang,
    normalizeStart: normalizeStart,
    hasBookParam: hasBookParam,
    isBookArrival: isBookArrival,
    resolveStart: resolveStart,
    readSaved: readSaved
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.HLOLang = api;
  var getStorage = function () {
    return root.localStorage;
  };
  try {
    root.document.documentElement.lang = resolveLang(root.location.search, readSaved(getStorage));
  } catch (e) {
    /* 決められないときは index.html の lang="ja" のまま */
  }
  try {
    if (isBookArrival(root.location.search, root.location.hash)) root.document.documentElement.setAttribute("data-book-arrival", "true");
    var start = resolveStart(root.location.search, readSaved(getStorage, START_KEY));
    if (start) root.document.documentElement.setAttribute("data-start", start);
  } catch (e) {
    /* 決められないときは書かない（css と js/main.js が画面の幅で決める） */
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
