// test/lang.test.js
// 依存なし（node:test / node:assert/strict / node:fs / node:vm のみ）。
// js/lang.js（描く前に表示の言語を決める）の検査。LG1・LG2 は純関数、LG3 はブラウザーで読んだときと同じように
// 作ったページの入れ物の中で動かし、<html lang> を書くこと（保存できない環境でも止まらないこと）を確かめる。

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
  const ctx = { location: { search }, document: { documentElement: { lang: "ja" } }, URLSearchParams };
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
