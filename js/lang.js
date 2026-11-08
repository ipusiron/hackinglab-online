// js/lang.js
//
// 表示の言語を、ページを描く前に決める。index.html の <head> で defer を付けずに読み、<html lang> を書く。
// CSS が .label-ja / .label-en をこの lang で出し分けるので、保存した言語が英語でも、最初の描画から英語になる。
// 決める順は、URL の ?lang=（ja か en。大文字・前後の空白は直し、ほかの値は無視）→ この端末に保存した言語 → 日本語。
// ブラウザーの言語では切り替えない。保存するのは JA・EN を押したときだけ（js/main.js）で、?lang= で開いただけでは保存しない。
// ブラウザーでは globalThis.HLOLang に公開し、Node のテストでは module.exports から読む。
(function (root) {
  "use strict";

  // 選んだ言語を保存する localStorage のキー
  var KEY = "hlo_lang";

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

  // 保存した言語を読む。getStorage は localStorage を返す関数（取り出すだけで例外を投げる環境があるため関数で受ける）。
  // 保存できない・読めない環境では null（そのときは ?lang= か日本語で決まる）
  function readSaved(getStorage) {
    try {
      var s = getStorage();
      return s && typeof s.getItem === "function" ? s.getItem(KEY) : null;
    } catch (e) {
      return null;
    }
  }

  var api = {
    KEY: KEY,
    normalizeLang: normalizeLang,
    langFromSearch: langFromSearch,
    resolveLang: resolveLang,
    readSaved: readSaved
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
    return;
  }
  root.HLOLang = api;
  try {
    root.document.documentElement.lang = resolveLang(
      root.location.search,
      readSaved(function () {
        return root.localStorage;
      })
    );
  } catch (e) {
    /* 決められないときは index.html の lang="ja" のまま */
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
