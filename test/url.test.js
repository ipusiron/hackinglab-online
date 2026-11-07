// test/url.test.js
// 依存なし（node:test / node:assert/strict のみ）。
// js/url.js の純関数の検査。UR1・UR2 は一覧の条件（?book=・?cat=・?q=・?tab=）を URL から読む・URL へ書く関数、
// UR3 はカードの「GitHub」「デモ」のリンクの言語ごとの形を、この中の小さなデータで確かめる（data/*.json の中身には頼らない）。

const assert = require("node:assert/strict");
const { test } = require("node:test");

const U = require("../js/url.js");

const KNOWN = { books: ["genai-crypto", "security-tools-100"], categories: ["classic-crypto", "forensics"] };
const BASE = "https://hackinglab.online/";

test("UR1: readState は ?book=・?cat=・?q=・?tab= を読み、知っている本とカテゴリーだけを採る", () => {
  assert.deepEqual(U.readState("?book=genai-crypto&cat=forensics&q=caesar&tab=dashboard", KNOWN), {
    book: "genai-crypto",
    cat: "forensics",
    q: "caesar",
    tab: "dashboard"
  });
  // 何もなければ、条件なしの一覧
  assert.deepEqual(U.readState("", KNOWN), { book: "", cat: "", q: "", tab: "tools" });
  assert.deepEqual(U.readState(undefined, undefined), { book: "", cat: "", q: "", tab: "tools" });
});

test("UR1: 大文字・小文字と前後の空白は直し、存在しない値と all は無視する", () => {
  assert.equal(U.readState("?book=%20GENAI-Crypto%20", KNOWN).book, "genai-crypto");
  assert.equal(U.readState("?cat=Classic-Crypto", KNOWN).cat, "classic-crypto");
  assert.equal(U.readState("?tab=DASHBOARD", KNOWN).tab, "dashboard");
  assert.equal(U.readState("?book=genai-cryptoo", KNOWN).book, "");
  assert.equal(U.readState("?book=all", KNOWN).book, "");
  assert.equal(U.readState("?book=", KNOWN).book, "");
  assert.equal(U.readState("?cat=unknown", KNOWN).cat, "");
  assert.equal(U.readState("?tab=help", KNOWN).tab, "tools");
  assert.equal(U.readState("?tab=tools", KNOWN).tab, "tools");
  // データを読み込む前（知っている本・カテゴリーがない）は、本とカテゴリーを採らない
  assert.deepEqual(U.readState("?book=genai-crypto&cat=forensics&tab=dashboard", {}), { book: "", cat: "", q: "", tab: "dashboard" });
});

test("UR1: ?q= は検索欄の文字として読む（前後の空白だけを除き、+ と %20 は空白、全角はそのまま）", () => {
  assert.equal(U.readState("?q=%E6%9A%97%E5%8F%B7+%E8%A7%A3%E8%AA%AD", KNOWN).q, "暗号 解読");
  assert.equal(U.readState("?q=%20%20aes%20", KNOWN).q, "aes");
  assert.equal(U.readState("?q=%E3%80%80Day50%E3%80%80", KNOWN).q, "Day50");
  assert.equal(U.readState("?q=%EF%BC%B1%EF%BC%B2", KNOWN).q, "ＱＲ");
  assert.equal(U.readState("?q=", KNOWN).q, "");
  // 同じ名前が2つあるときは最初の値
  assert.equal(U.readState("?q=a&q=b", KNOWN).q, "a");
});

test("UR2: buildUrl は渡した条件だけを書き、book・cat・q・tab の順に並べる（空の値は書かず、何もなければ ? も付けない）", () => {
  assert.equal(U.buildUrl(BASE, { book: "genai-crypto" }), BASE + "?book=genai-crypto");
  assert.equal(U.buildUrl(BASE + "?q=aes", { book: "genai-crypto" }), BASE + "?book=genai-crypto&q=aes");
  assert.equal(U.buildUrl(BASE + "?tab=dashboard&q=aes&cat=forensics", { book: "genai-crypto" }), BASE + "?book=genai-crypto&cat=forensics&q=aes&tab=dashboard");
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto", { book: "" }), BASE);
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto&cat=forensics&q=aes", { book: "", cat: "", q: "" }), BASE);
  assert.equal(U.buildUrl(BASE + "?cat=forensics", { cat: "classic-crypto" }), BASE + "?cat=classic-crypto");
  assert.equal(U.buildUrl(BASE, { tab: "dashboard" }), BASE + "?tab=dashboard");
  assert.equal(U.buildUrl(BASE + "?tab=dashboard", { tab: "tools" }), BASE);
  // 何も変えなければ同じ URL
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto&q=aes", {}), BASE + "?book=genai-crypto&q=aes");
});

test("UR2: ?q= は前後の空白を除いて書き、空白と日本語は URL の形に直す（読み直すと同じ文字に戻る）", () => {
  const url = U.buildUrl(BASE, { q: "  暗号 解読　" });
  assert.equal(url, BASE + "?q=%E6%9A%97%E5%8F%B7+%E8%A7%A3%E8%AA%AD");
  assert.equal(U.readState(new URL(url).search, KNOWN).q, "暗号 解読");
  assert.equal(U.buildUrl(BASE + "?q=aes", { q: "   " }), BASE);
  assert.equal(U.buildUrl(BASE + "?q=aes", { q: null }), BASE);
  for (const q of ["a&b=c", "100%", "#tag", "?x", "+plus", "Ｄａｙ１２", "シーザー 暗号"]) {
    assert.equal(U.readState(new URL(U.buildUrl(BASE, { q })).search, KNOWN).q, q, q);
  }
});

test("UR2: ほかのパラメーターは、一覧の条件の後ろに元の順で残す", () => {
  assert.equal(
    U.buildUrl(BASE + "?utm_source=blog&book=genai-crypto&ref=x", { cat: "forensics" }),
    BASE + "?book=genai-crypto&cat=forensics&utm_source=blog&ref=x"
  );
  assert.equal(U.buildUrl(BASE + "?ref=x", { book: "" }), BASE + "?ref=x");
});

test("UR2: 本を変えるときだけ、前の本の章の位置（#book-group-…）を外す。ほかの # と、本を変えないときは残す", () => {
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto#book-group-ch03", { book: "cyber-ninja" }), BASE + "?book=cyber-ninja");
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto#book-group-ch03", { book: "" }), BASE);
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto#book-group-ch03", { q: "aes" }), BASE + "?book=genai-crypto&q=aes#book-group-ch03");
  // 表記だけを直すとき（大文字・空白）は同じ本なので、章の位置を残す
  assert.equal(U.buildUrl(BASE + "?book=GENAI-CRYPTO#book-group-ch03", { book: "genai-crypto" }), BASE + "?book=genai-crypto#book-group-ch03");
  assert.equal(U.buildUrl(BASE + "?book=genai-crypto#top", { book: "" }), BASE + "#top");
});

test("UR2: パスと、読み直すと同じ条件になること（書いて読むと、渡した条件に戻る）", () => {
  const states = [
    { book: "genai-crypto", cat: "", q: "", tab: "tools" },
    { book: "", cat: "forensics", q: "Day50", tab: "tools" },
    { book: "security-tools-100", cat: "classic-crypto", q: "暗号 解読", tab: "dashboard" }
  ];
  for (const st of states) {
    const url = U.buildUrl("https://hackinglab.online/index.html?x=1", st);
    assert.equal(new URL(url).pathname, "/index.html");
    assert.deepEqual(U.readState(new URL(url).search, KNOWN), st, JSON.stringify(st));
  }
});

test("UR3: repoLink は英語表示のときだけ、リポジトリーのトップを英語の README（blob/HEAD/README.en.md）へ向ける", () => {
  const repo = "https://github.com/ipusiron/password-checker";
  assert.equal(U.repoLink(repo, "en"), repo + "/blob/HEAD/README.en.md");
  assert.equal(U.repoLink(repo + "/", "en"), repo + "/blob/HEAD/README.en.md");
  assert.equal(U.repoLink(repo + ".git", "en"), repo + "/blob/HEAD/README.en.md");
  // 日本語表示は変えない
  assert.equal(U.repoLink(repo, "ja"), repo);
  assert.equal(U.repoLink(repo, undefined), repo);
  // リポジトリーのトップ以外の形と、github.com 以外はそのまま
  for (const u of [repo + "/tree/main/docs", "https://gitlab.com/ipusiron/x", "http://github.com/ipusiron/x", "https://github.com/ipusiron", ""]) {
    assert.equal(U.repoLink(u, "en"), u, u);
  }
  assert.equal(U.repoLink(undefined, "en"), "");
});

test("UR3: demoLink は英語表示のときだけ、ipusiron.github.io のデモに ?lang=en を付ける（ほかのパラメーターと # は残す）", () => {
  const demo = "https://ipusiron.github.io/password-checker/";
  assert.equal(U.demoLink(demo, "en"), demo + "?lang=en");
  assert.equal(U.demoLink(demo + "?mode=quiz#top", "en"), demo + "?mode=quiz&lang=en#top");
  assert.equal(U.demoLink(demo + "?lang=ja", "en"), demo + "?lang=en");
  // 日本語表示は変えない（?lang=ja も付けない）
  assert.equal(U.demoLink(demo, "ja"), demo);
  // ほかの場所（Google Colab など）と、空・壊れた値はそのまま
  const colab = "https://colab.research.google.com/github/ipusiron/doh-watcher/blob/main/doh_watcher.ipynb";
  assert.equal(U.demoLink(colab, "en"), colab);
  assert.equal(U.demoLink("http://ipusiron.github.io/x/", "en"), "http://ipusiron.github.io/x/");
  assert.equal(U.demoLink("", "en"), "");
  assert.equal(U.demoLink("not a url", "en"), "not a url");
  assert.equal(U.demoLink(undefined, "en"), "");
});
