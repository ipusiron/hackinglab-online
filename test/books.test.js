// test/books.test.js
// 依存なし（node:test / node:assert/strict / node:fs のみ）。
// 実データ（data/books.json・data/tools.json）に対する検査は D1〜D15・S1。
// F1〜F6 はこのファイル内の合成データで関数の挙動を確かめる（実データの本数や再生成の状態に依存させない）。

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const B = require("../js/books.js");

const ROOT = path.join(__dirname, "..");
const booksRaw = fs.readFileSync(path.join(ROOT, "data/books.json"));
const toolsRaw = fs.readFileSync(path.join(ROOT, "data/tools.json"));
const books = JSON.parse(booksRaw.toString("utf8"));
const toolsJson = JSON.parse(toolsRaw.toString("utf8"));
const tools = toolsJson.tools;

// ---- 実データ ----

test("D1: books.json が BOM なし UTF-8 で、schema_version=1・books が配列", () => {
  assert.notEqual(booksRaw[0], 0xef, "先頭に BOM がある");
  assert.equal(books.schema_version, 1);
  assert.ok(Array.isArray(books.books) && books.books.length >= 1);
});

test("D1: tools.json が BOM なし", () => {
  assert.notEqual(toolsRaw[0], 0xef, "tools.json の先頭に BOM がある");
});

test("D2〜D15: validateBooks が実データで空（エラーなし）", () => {
  const errs = B.validateBooks(books, tools);
  assert.deepEqual(errs, [], "検証エラー:\n" + errs.join("\n"));
});

test("S1: security-tools-100 / security-tools-200 が存在し範囲が正しい", () => {
  const byslug = Object.fromEntries(books.books.map((b) => [b.slug, b]));
  assert.ok(byslug["security-tools-100"], "security-tools-100 が無い");
  assert.ok(byslug["security-tools-200"], "security-tools-200 が無い");
  assert.deepEqual(byslug["security-tools-100"].id_range, ["day001", "day100"]);
  assert.deepEqual(byslug["security-tools-200"].id_range, ["day101", "day200"]);
});

test("実データ: 各シリーズの対象集合が tools.json のツールを拾う", () => {
  const byslug = Object.fromEntries(books.books.map((b) => [b.slug, b]));
  const s100 = B.expandTargetIds(byslug["security-tools-100"], tools);
  const s200 = B.expandTargetIds(byslug["security-tools-200"], tools);
  assert.ok(s100.size > 0, "ツール100の対象が0");
  assert.ok(s200.size > 0, "ツール200の対象が0");
  // day001〜100 と day101〜 は重ならない
  for (const id of s100) assert.ok(B.dayNum(id) <= 100);
  for (const id of s200) assert.ok(B.dayNum(id) >= 101);
});

// ---- 合成データ（関数の挙動） ----

const SYN_TOOLS = [
  { id: "day001", slug: "a", hub: true },
  { id: "day002", slug: "b", hub: true },
  { id: "day003", slug: "c" }, // hub 既定 true
  { id: "day004", slug: "d", hub: false }, // 除外される
  { id: "day010", slug: "e", hub: true },
  { id: "day200", slug: "z", hub: true }
];

test("F1: expandTargetIds（ids / 範囲 / 両方 / 欠落 / hub:false / 順序）", () => {
  // ids のみ（存在しない day999 と hub:false の day004 は落ちる）
  let s = B.expandTargetIds({ ids: ["day001", "day004", "day999"] }, SYN_TOOLS);
  assert.deepEqual([...s].sort(), ["day001"]);
  // 範囲のみ
  s = B.expandTargetIds({ id_range: ["day001", "day010"] }, SYN_TOOLS);
  assert.deepEqual([...s].sort(), ["day001", "day002", "day003", "day010"]); // day004 は hub:false
  // 両方
  s = B.expandTargetIds({ ids: ["day200"], id_range: ["day001", "day002"] }, SYN_TOOLS);
  assert.deepEqual([...s].sort(), ["day001", "day002", "day200"]);
});

test("F2: resolveBookParam（採用 / 大小 / 空白 / 未知 / 空 / all / 複数 / 併存）", () => {
  const bs = [{ slug: "genai-crypto" }, { slug: "cyber-ninja" }];
  assert.equal(B.resolveBookParam("?book=genai-crypto", bs), "genai-crypto");
  assert.equal(B.resolveBookParam("?book=GENAI-CRYPTO", bs), "genai-crypto");
  assert.equal(B.resolveBookParam("?book=%20genai-crypto%20", bs), "genai-crypto");
  assert.equal(B.resolveBookParam("?book=none", bs), "");
  assert.equal(B.resolveBookParam("?book=", bs), "");
  assert.equal(B.resolveBookParam("?book=all", bs), "");
  assert.equal(B.resolveBookParam("?book=cyber-ninja&book=genai-crypto", bs), "cyber-ninja");
  assert.equal(B.resolveBookParam("?x=1&book=genai-crypto&y=2", bs), "genai-crypto");
  assert.equal(B.resolveBookParam("", bs), "");
});

test("F3: buildUrlWithBook（付ける / 外す / 併存とハッシュ保持 / 空で ? が残らない / 置換）", () => {
  const base = "https://hackinglab.online/";
  assert.equal(B.buildUrlWithBook(base, "genai-crypto"), "https://hackinglab.online/?book=genai-crypto");
  assert.equal(B.buildUrlWithBook("https://hackinglab.online/?book=x", ""), "https://hackinglab.online/");
  assert.equal(
    B.buildUrlWithBook("https://hackinglab.online/?a=1#g", "genai-crypto"),
    "https://hackinglab.online/?a=1&book=genai-crypto#g"
  );
  assert.equal(B.buildUrlWithBook("https://hackinglab.online/?book=old", "new"), "https://hackinglab.online/?book=new");
});

const SYN_BOOK = {
  slug: "syn",
  kind: "book",
  title_ja: "合成本",
  title_en: "Synthetic",
  label_ja: "合成",
  label_en: "Syn",
  url: "https://example.com/",
  relation: "introduced",
  chapters: [
    { key: "ch01", label_ja: "第1章", label_en: "Ch. 1" },
    { key: "ch02", label_ja: "第2章", label_en: "Ch. 2" },
    { key: "appx", label_ja: "付録", label_en: "Appendix" }
  ],
  ids: ["day001", "day002", "day003", "day010"],
  refs: {
    day001: [{ ch: "ch01" }],
    day002: [{ ch: "ch01", pages: ["12"] }, { ch: "ch02", pages: ["30-32"] }],
    day003: [{ ch: "ch02" }],
    day010: [{ ch: "appx" }]
  }
};

test("F4: buildGroups（chapters 順 / 重複表示 / グループ枚数 / 空グループ除外 / 場所の無いツールは出さない）", () => {
  const groups = B.buildGroups(SYN_BOOK, SYN_TOOLS);
  assert.deepEqual(groups.map((g) => g.key), ["ch01", "ch02", "appx"]);
  assert.deepEqual(groups[0].items.map((t) => t.id), ["day001", "day002"]);
  assert.deepEqual(groups[1].items.map((t) => t.id), ["day002", "day003"]); // day002 は2か所に出る
  assert.deepEqual(groups[2].items.map((t) => t.id), ["day010"]);
  // 場所の無いツール day200 は対象外なので出ない
  const all = groups.flatMap((g) => g.items.map((t) => t.id));
  assert.ok(!all.includes("day200"));
});

test("F4: buildGroups は chapters の無い本で見出し無しの単一グループ", () => {
  const series = { id_range: ["day001", "day010"] };
  const g = B.buildGroups(series, SYN_TOOLS);
  assert.equal(g.length, 1);
  assert.equal(g[0].key, null);
  assert.deepEqual(g[0].items.map((t) => t.id), ["day001", "day002", "day003", "day010"]);
});

test("F4: formatRef（ページ無しで p. を出さない / 単一 p. / 範囲 pp. / related 接頭辞 / 未知の ch は空）", () => {
  assert.deepEqual(B.formatRef(SYN_BOOK, "day001", "ja"), ["第1章"]);
  assert.deepEqual(B.formatRef(SYN_BOOK, "day002", "ja"), ["第1章 p.12", "第2章 pp.30-32"]);
  assert.deepEqual(B.formatRef(SYN_BOOK, "day002", "en"), ["Ch. 1 p.12", "Ch. 2 pp.30-32"]);
  const related = Object.assign({}, SYN_BOOK, { relation: "related" });
  assert.deepEqual(B.formatRef(related, "day001", "ja"), ["関連: 第1章"]);
  assert.deepEqual(B.formatRef(related, "day001", "en"), ["Related: Ch. 1"]);
  // 未知の ch
  const bad = Object.assign({}, SYN_BOOK, { refs: { day001: [{ ch: "zzz" }] } });
  assert.deepEqual(B.formatRef(bad, "day001", "ja"), []);
});

test("F4: common_ref は全対象に付き、refs と重ねて出る", () => {
  const withCommon = {
    chapters: [
      { key: "ch01", label_ja: "第1章", label_en: "Ch. 1" },
      { key: "appa", label_ja: "付録A", label_en: "Appendix A" }
    ],
    common_ref: "appa",
    id_range: ["day001", "day002"],
    refs: { day001: [{ ch: "ch01" }] }
  };
  const groups = B.buildGroups(withCommon, SYN_TOOLS);
  const appa = groups.find((g) => g.key === "appa");
  assert.deepEqual(appa.items.map((t) => t.id), ["day001", "day002"]); // 全対象が付録Aに
  assert.deepEqual(B.formatRef(withCommon, "day001", "ja"), ["第1章", "付録A"]);
  assert.deepEqual(B.formatRef(withCommon, "day002", "ja"), ["付録A"]);
});

test("F5: bookLabel / bookTitle（言語ごとの値）", () => {
  assert.equal(B.bookTitle(SYN_BOOK, "ja"), "合成本");
  assert.equal(B.bookTitle(SYN_BOOK, "en"), "Synthetic");
  assert.equal(B.bookLabel(SYN_BOOK, "ja"), "合成");
  assert.equal(B.bookLabel(SYN_BOOK, "en"), "Syn");
});

test("F6: validateBooks が壊れたデータでエラーを返す", () => {
  // D14（tools 側の hub は boolean）に触れないよう、hub を明示したツールで検証する
  const OK_TOOLS = [
    { id: "day001", slug: "a", hub: true },
    { id: "day002", slug: "b", hub: true },
    { id: "day010", slug: "e", hub: true }
  ];
  function v(book, toolsOverride) {
    return B.validateBooks({ schema_version: 1, books: [book] }, toolsOverride || OK_TOOLS);
  }
  const ok = {
    slug: "ok", kind: "book", title_ja: "あ", title_en: "a",
    label_ja: "あ", label_en: "a", url: "https://e.com/", ids: ["day001"]
  };
  assert.deepEqual(v(ok), [], "正常データでエラーが出た");
  // 存在しない id（D9）
  assert.ok(v(Object.assign({}, ok, { ids: ["day999"] })).some((m) => m.startsWith("D9")));
  // 逆順の範囲（D8）
  assert.ok(v(Object.assign({}, ok, { ids: undefined, id_range: ["day010", "day001"] })).some((m) => m.startsWith("D8")));
  // http:（D6）
  assert.ok(v(Object.assign({}, ok, { url: "http://e.com/" })).some((m) => m.startsWith("D6")));
  // 未知キー（D2）
  assert.ok(v(Object.assign({}, ok, { page: 1 })).some((m) => m.startsWith("D2")));
  // note に本数（D7）
  assert.ok(v(Object.assign({}, ok, { note_ja: "全52本です", note_en: "52 tools" })).some((m) => m.startsWith("D7")));
  // ids に足して refs を書かない（D15）
  assert.ok(v({
    slug: "ok", kind: "book", title_ja: "あ", title_en: "a", label_ja: "あ", label_en: "a",
    url: "https://e.com/", ids: ["day001", "day002"],
    chapters: [{ key: "ch01", label_ja: "1", label_en: "1" }],
    refs: { day001: [{ ch: "ch01" }] }
  }).some((m) => m.startsWith("D15")));
  // id_range＋chapters で common_ref が無い（D15）
  assert.ok(v({
    slug: "ok", kind: "book", title_ja: "あ", title_en: "a", label_ja: "あ", label_en: "a",
    url: "https://e.com/", id_range: ["day001", "day002"],
    chapters: [{ key: "ch01", label_ja: "1", label_en: "1" }],
    refs: { day001: [{ ch: "ch01" }] }
  }).some((m) => m.startsWith("D15")));
  // slug 重複（D3）
  assert.ok(B.validateBooks({ schema_version: 1, books: [ok, ok] }, SYN_TOOLS).some((m) => m.startsWith("D3")));
  // BOM 以外の label 重複（D5）
  assert.ok(B.validateBooks({
    schema_version: 1,
    books: [ok, Object.assign({}, ok, { slug: "ok2" })]
  }, SYN_TOOLS).some((m) => m.startsWith("D5")));
});
