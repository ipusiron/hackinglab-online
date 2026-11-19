"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const S = require("../js/share.js");
const tools = Array.from({ length: 5 }, (_, i) => ({ id: `day00${i + 1}`, hub: i !== 4 }));
const counts = (total, worked, mastered = 0) => ({ total, worked, mastered });

test("SP1 unique public IDs and optional target intersection determine counts without mutation", () => {
  const input = [...tools, tools[1], { id: "day000" }, { id: "wrong" }, null];
  const values = new Map([["day001", 1], ["day002", 2], ["day003", 3], ["day004", 0], ["day005", 3]]);
  const before = JSON.stringify(input);
  assert.deepEqual(S.summarizeProgress(input, values), counts(4, 2, 1));
  assert.deepEqual(S.summarizeProgress(input, values, ["day002", "day002", "day003", "day005", "day999"]), counts(2, 2, 1));
  assert.deepEqual(S.summarizeProgress(input, values, new Set()), counts(0, 0));
  assert.equal(JSON.stringify(input), before);
  assert.equal(values.size, 5);
});
test("SP2 invalid or absent progress values are not worked-through", () => {
  for (const value of [undefined, null, false, true, "2", -1, 4, 2.5, NaN, Infinity]) {
    assert.deepEqual(S.summarizeProgress(tools, new Map([["day001", value]])), counts(4, 0));
  }
  assert.deepEqual(S.summarizeProgress(tools, new Map([["day001", 2], ["day002", 3]])), counts(4, 2, 1));
});
test("SP3 zero worked has approved nonnumeric text in both scopes while selected URL/note remain", () => {
  for (const lang of ["ja", "en"]) for (const selection of [null, { slug: "example", label: "Example", related: true }]) {
    const value = S.buildShare({ lang, counts: counts(20, 0), selection });
    assert.equal(value.sentence, lang === "ja" ? "「ハッキング・ラボ・オンライン」で、セキュリティツールを使って学んでいます🔬📚" : "Learning security hands-on with the tools at Hacking Lab Online 🔬");
    assert.doesNotMatch(value.sentence, /\d|%/);
    assert.equal(new URL(value.url).searchParams.get("book"), selection ? "example" : null);
    assert.equal(!!value.scopeNote, !!selection);
  }
});
test("SP4 whole-catalog text uses worked2+3, omits zero mastered and handles English singular", () => {
  assert.equal(S.buildShare({ lang: "en", counts: counts(128, 1) }).sentence, "I've worked through 1 tool at Hacking Lab Online 🔬");
  assert.equal(S.buildShare({ lang: "en", counts: counts(128, 12, 5) }).sentence, "I've worked through 12 tools at Hacking Lab Online (5 mastered) 🔬");
  assert.equal(S.buildShare({ lang: "ja", counts: counts(128, 12, 5) }).sentence, "「ハッキング・ラボ・オンライン」で、ツールを12本一周しました（うち定着済み5本）🔬📚");
  assert.equal(S.buildShare({ lang: "ja", counts: counts(128, 1) }).sentence, "「ハッキング・ラボ・オンライン」で、ツールを1本一周しました🔬📚");
});
test("SP5 selected book/series and related labels use unique totals and singular separately", () => {
  const selection = { slug: "example", label: "Example", related: false };
  assert.equal(S.buildShare({ lang: "en", counts: counts(52, 12, 5), selection }).sentence, "I've worked through 12 of the 52 tools for “Example” at Hacking Lab Online 🔬");
  assert.equal(S.buildShare({ lang: "ja", counts: counts(52, 12, 5), selection }).sentence, "「ハッキング・ラボ・オンライン」で、「Example」のツール52本のうち12本を一周しました🔬📚");
  selection.related = true;
  assert.equal(S.buildShare({ lang: "en", counts: counts(1, 1, 1), selection }).sentence, "I've worked through 1 of the 1 tool related to “Example” at Hacking Lab Online 🔬");
  assert.equal(S.buildShare({ lang: "ja", counts: counts(20, 3, 1), selection }).sentence, "「ハッキング・ラボ・オンライン」で、「Example」の関連ツール20本のうち3本を一周しました🔬📚");
});
test("SP6 canonical URL allowlist and encoded intent preserve literal text, hashtags and no side inputs", () => {
  const selection = { slug: "book-one", label: 'A & B / "quote" <tag> 日本語', related: false };
  for (const lang of ["ja", "en"]) {
    const value = S.buildShare({ lang, counts: counts(3, 1), selection, currentUrl: "https://evil.example/?q=secret#day001" });
    const url = new URL(value.url), intent = new URL(value.intentUrl);
    assert.equal(url.origin + url.pathname, "https://hackinglab.online/");
    assert.deepEqual([...url.searchParams.keys()], lang === "en" ? ["book", "lang"] : ["book"]);
    assert.equal(url.hash, "");
    assert.equal(intent.origin + intent.pathname, "https://twitter.com/intent/tweet");
    assert.equal(intent.searchParams.get("text"), value.text);
    assert.deepEqual(value.text.split("\n"), [value.sentence, value.url, lang === "en" ? "#GenAI #SecurityTools #HackingLabOnline" : "#生成AIセキュリティツール #ハッキングラボオンライン"]);
    assert.ok(value.sentence.includes(selection.label));
    assert.ok(value.intentUrl.length < 2000);
    assert.doesNotMatch(value.text, /evil\.example|secret/);
  }
});
test("SP7 invalid counts and injected slugs cannot create malformed sharing URLs", () => {
  for (const c of [counts(1, 2), counts(2, 1, 2), counts(-1, 0), counts(2, 0.5), counts(2, NaN), counts(Infinity, 0)]) {
    assert.throws(() => S.buildShare({ lang: "en", counts: c }));
  }
  for (const slug of ["", "../", "one&tab=dashboard", "https://example.com", "UPPER", "two words"]) {
    assert.throws(() => S.buildShare({ lang: "en", counts: counts(1, 1), selection: { slug, label: "Name" } }));
  }
});
