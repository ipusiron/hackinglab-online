// test/lang.test.js
// 依存なし（node:test / node:assert/strict / node:fs / node:vm のみ）。
// js/lang.js（描く前に表示の言語と「はじめ方」の開閉を決める）の検査。LG1・LG2 は純関数、LG3 はブラウザーで読んだときと
// 同じように作ったページの入れ物の中で動かし、<html lang> を書くこと（保存できない環境でも止まらないこと）を確かめる。
// LG4 は「はじめ方」の開閉の決め方と、<html data-start> を書くこと。

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const L = require("../js/lang.js");
const SRC = fs.readFileSync(path.join(__dirname, "..", "js", "lang.js"), "utf8");

test("LG1: 決める順は ?lang=（ja か en）→ 保存した言語 → 日本語。ブラウザーの言語は使わない", () => {
  assert.equal(L.resolveLang("?lang=en", null), "en");
  assert.equal(L.resolveLang("?lang=ja", "en"), "ja");
  assert.equal(L.resolveLang("?lang=en", "ja"), "en");
  assert.equal(L.resolveLang("", "en"), "en");
  assert.equal(L.resolveLang("", "ja"), "ja");
  assert.equal(L.resolveLang("", null), "ja");
  assert.equal(L.resolveLang(undefined, undefined), "ja");
  // ほかのパラメーターと一緒でも読む
  assert.equal(L.resolveLang("?book=genai-crypto&lang=en", null), "en");
  // 引数はこの2つだけ（navigator.language などを受け取らない）
  assert.equal(L.resolveLang.length, 2);
  assert.doesNotMatch(SRC, /navigator/);
});

test("LG1: 大文字・前後の空白は直し、ja と en 以外の値は無視する", () => {
  assert.equal(L.resolveLang("?lang=EN", null), "en");
  assert.equal(L.resolveLang("?lang=%20Ja%20", "en"), "ja");
  assert.equal(L.resolveLang("?lang=fr", "en"), "en");
  assert.equal(L.resolveLang("?lang=", "en"), "en");
  assert.equal(L.resolveLang("?lang=en-US", null), "ja");
  assert.equal(L.resolveLang("", "fr"), "ja");
  assert.equal(L.resolveLang("", " EN "), "en");
  assert.equal(L.normalizeLang(null), "");
  assert.equal(L.langFromSearch("?lang=ja"), "ja");
});

test("LG2: 保存した言語を読む。localStorage が使えない・例外を投げるときは null", () => {
  const store = (v) => ({ getItem: (k) => (k === L.KEY ? v : null) });
  assert.equal(L.readSaved(() => store("en")), "en");
  assert.equal(L.readSaved(() => store(null)), null);
  assert.equal(L.readSaved(() => null), null);
  assert.equal(L.readSaved(() => undefined), null);
  assert.equal(
    L.readSaved(() => {
      throw new Error("SecurityError");
    }),
    null
  );
  assert.equal(
    L.readSaved(() => ({
      getItem() {
        throw new Error("blocked");
      }
    })),
    null
  );
  assert.equal(L.KEY, "hlo_lang");
});

// ブラウザーで読んだときと同じように、ページの入れ物（location・localStorage・document）の中で lang.js を動かす
function runInPage(search, storageGetter) {
  // URLSearchParams はブラウザーにはあるが、vm の入れ物には入っていないので渡す
  const attrs = {};
  const documentElement = {
    lang: "ja",
    setAttribute: (k, v) => {
      attrs[k] = String(v);
    },
    getAttribute: (k) => (k in attrs ? attrs[k] : null)
  };
  const ctx = { location: { search }, document: { documentElement }, URLSearchParams };
  Object.defineProperty(ctx, "localStorage", { get: storageGetter, configurable: true });
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  return ctx;
}

test("LG3: 読んだその場で <html lang> を書き、保存した言語が英語なら英語にする", () => {
  const saved = (v) => () => ({ getItem: (k) => (k === "hlo_lang" ? v : null) });
  assert.equal(runInPage("", saved("en")).document.documentElement.lang, "en");
  assert.equal(runInPage("", saved(null)).document.documentElement.lang, "ja");
  assert.equal(runInPage("?lang=ja", saved("en")).document.documentElement.lang, "ja");
  assert.equal(runInPage("?lang=en", saved("ja")).document.documentElement.lang, "en");
  const ctx = runInPage("", saved(null));
  assert.equal(typeof ctx.HLOLang.resolveLang, "function");
});

test("LG3: localStorage を取り出すだけで例外を投げる環境（保存の禁止など）でも止まらず、?lang= か日本語で決める", () => {
  const blocked = () => {
    throw new Error("SecurityError");
  };
  assert.equal(runInPage("", blocked).document.documentElement.lang, "ja");
  assert.equal(runInPage("?lang=en", blocked).document.documentElement.lang, "en");
});

test("LG4: 「はじめ方」は ?book= で来たら閉じ、なければ覚えた開閉（open か closed）。どちらもなければ決めない（画面の幅で決める）", () => {
  assert.equal(L.resolveStart("?book=genai-crypto", null), "closed");
  assert.equal(L.resolveStart("?book=genai-crypto", "open"), "closed", "覚えた開閉より ?book= を先にする（本のツールを先に見せる）");
  assert.equal(L.resolveStart("?lang=en&book=%20Security-Tools-100%20", "open"), "closed");
  assert.equal(L.resolveStart("", "closed"), "closed");
  assert.equal(L.resolveStart("", "open"), "open");
  assert.equal(L.resolveStart("?cat=classic-crypto", " OPEN "), "open");
  assert.equal(L.resolveStart("", null), "", "はじめて来た人は決めない（css と main.js が幅で決める）");
  assert.equal(L.resolveStart("", "yes"), "");
  // 本の指定が空と all のときは、指定なしと同じ
  assert.equal(L.resolveStart("?book=", "open"), "open");
  assert.equal(L.resolveStart("?book=all", null), "");
  assert.equal(L.resolveStart("?book=ALL", "closed"), "closed");
  assert.equal(L.hasBookParam("?book=x"), true);
  assert.equal(L.hasBookParam("?q=book"), false);
  assert.equal(L.normalizeStart(null), "");
  // 開閉を覚えるキーは言語と別。読むときはキーを渡す（渡さなければ言語）
  assert.equal(L.START_KEY, "hlo_start_here");
  assert.notEqual(L.START_KEY, L.KEY);
  const store = { getItem: (k) => ({ hlo_lang: "en", hlo_start_here: "closed" })[k] ?? null };
  assert.equal(L.readSaved(() => store, L.START_KEY), "closed");
  assert.equal(L.readSaved(() => store), "en");
  // 引数は search と覚えた値だけ（画面の幅は見ない。幅は css と main.js が同じ式で見る）
  assert.equal(L.resolveStart.length, 2);
  assert.doesNotMatch(SRC, /matchMedia|innerWidth/);
});

test("LG4: 読んだその場で <html data-start> を書く。決まらないとき・保存できない環境では書かず、言語は決める", () => {
  const saved = (map) => () => ({ getItem: (k) => (k in map ? map[k] : null) });
  const attr = (ctx) => ctx.document.documentElement.getAttribute("data-start");
  assert.equal(attr(runInPage("?book=genai-crypto", saved({}))), "closed");
  assert.equal(attr(runInPage("", saved({ hlo_start_here: "closed" }))), "closed");
  assert.equal(attr(runInPage("", saved({ hlo_start_here: "open" }))), "open");
  assert.equal(attr(runInPage("", saved({}))), null);
  assert.equal(attr(runInPage("", saved({ hlo_start_here: "maybe" }))), null);
  const both = runInPage("", saved({ hlo_lang: "en", hlo_start_here: "open" }));
  assert.equal(both.document.documentElement.lang, "en");
  assert.equal(attr(both), "open");
  const blocked = () => {
    throw new Error("SecurityError");
  };
  const b1 = runInPage("", blocked);
  assert.equal(attr(b1), null);
  assert.equal(b1.document.documentElement.lang, "ja");
  const b2 = runInPage("?book=genai-crypto&lang=en", blocked);
  assert.equal(attr(b2), "closed", "保存できない環境でも ?book= で来たら閉じる");
  assert.equal(b2.document.documentElement.lang, "en");
});
