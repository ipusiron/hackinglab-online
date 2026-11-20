"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const HB = require("../js/books.js");
const { COPY, escapeHtml, safeUrl, buildPage } = require("../scripts/build_pages.js");
const root = path.resolve(__dirname, "..");
const toolsData = JSON.parse(fs.readFileSync(path.join(root, "data/tools.json"), "utf8"));
const booksData = JSON.parse(fs.readFileSync(path.join(root, "data/books.json"), "utf8"));
const html = buildPage(toolsData, booksData);
const visible = toolsData.tools.filter(t => t.hub !== false).sort((a, b) => HB.dayNum(a.id) - HB.dayNum(b.id));

test("SL1: committed page matches deterministic generation, independent of catalog time or input tool order", () => {
  assert.equal(fs.readFileSync(path.join(root, "list.html"), "utf8"), html);
  assert.equal(buildPage({ ...toolsData, generated_at: "different", tools: [...toolsData.tools].reverse() }, booksData), html);
  const check = spawnSync(process.execPath, ["scripts/build_pages.js", "--check"], { cwd: root, encoding: "utf8" });
  assert.equal(check.status, 0, check.stderr);
});

test("SL2: all visible tools occur once in Day order; all books retain HB chapter memberships including duplicates", () => {
  assert.deepEqual([...html.matchAll(/id="sl-tool-(day\d{3})"/g)].map(m => m[1]), visible.map(t => t.id));
  for (const book of booksData.books) {
    assert.ok(html.includes(`id="sl-book-${book.slug}"`));
    for (const group of HB.buildGroups(book, visible)) {
      for (const tool of group.items) {
        const id = `sl-row-${book.slug}--${group.key || "all"}--${tool.id}`;
        assert.equal(html.split(`id="${id}"`).length - 1, 1, id);
      }
    }
  }
  const expected = visible.length + booksData.books.reduce((n, b) => n + HB.buildGroups(b, visible).reduce((s, g) => s + g.items.length, 0), 0);
  assert.equal((html.match(/class="sl-row"/g) || []).length, expected);
});

test("SL3: document ids are unique in the sl namespace and every local fragment resolves", () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every(id => /^sl-[a-z0-9-]+$/.test(id)));
  for (const [, id] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(id), id);
  assert.doesNotMatch(html, /id="(?:day\d+|book-group-)/);
});

test("SL4: both languages, notes and references remain in HTML without scripts, language hiding or inline code", () => {
  for (const text of Object.values(COPY)) assert.ok(html.includes(escapeHtml(text)), text);
  for (const book of booksData.books) {
    for (const key of ["title_ja", "title_en", "note_ja", "note_en", "url_label_ja", "url_label_en"]) {
      if (book[key]) assert.ok(html.includes(escapeHtml(book[key])), `${book.slug}: ${key}`);
    }
    for (const tool of visible) for (const lang of ["ja", "en"]) {
      for (const ref of HB.formatRef(book, tool.id, lang)) assert.ok(html.includes(escapeHtml(ref)), ref);
    }
  }
  assert.doesNotMatch(html, /<script\b|\bstyle=|\bon[a-z]+=|\blabel-(?:ja|en)\b/i);
  assert.match(html, /default-src 'none'; style-src 'self'/);
  assert.match(html, /<span lang="ja">/); assert.match(html, /<span lang="en">/);
});

test("SL4b: page-number notes appear only when the displayed book tools actually show page references", () => {
  const cyber = booksData.books.find(b => b.slug === "cyber-ninja");
  const crypto = booksData.books.find(b => b.slug === "ango-gijutsu-no-subete");
  assert.ok(!html.includes(escapeHtml(cyber.pages_note_ja)));
  assert.ok(!html.includes(escapeHtml(cyber.pages_note_en)));
  assert.ok(html.includes(escapeHtml(crypto.pages_note_ja)));
  assert.ok(html.includes(escapeHtml(crypto.pages_note_en)));
  const books = structuredClone(booksData);
  const altered = books.books.find(b => b.slug === "cyber-ninja");
  const id = Object.keys(altered.refs)[0];
  altered.refs[id][0].pages = ["12-13"];
  const changed = buildPage(toolsData, books);
  assert.ok(changed.includes(escapeHtml(altered.pages_note_ja)));
  assert.ok(changed.includes(escapeHtml(altered.pages_note_en)));
});

test("SL5: every external link is HTTPS, escaped, allowlisted and opened with noopener", () => {
  for (const [, href, attrs] of html.matchAll(/<a href="(https:[^"]+)"([^>]*)>/g)) {
    assert.match(attrs, /target="_blank"/);
    assert.match(attrs, /rel="noopener noreferrer"/);
    const url = new URL(href.replaceAll("&amp;", "&"));
    assert.ok(["github.com", "ipusiron.github.io", "colab.research.google.com", "akademeia.info"].includes(url.hostname));
  }
  for (const value of ["javascript:alert(1)", "http://github.com/x", "//github.com/x", "https://github.com.evil.test/x", "https://u:p@github.com/x", "https://github.com:8443/x", "https://github.com\\@evil.test/x", " https://github.com/x", "https://github.com/\nx"]) assert.throws(() => safeUrl(value, "repo"), /Unsafe/);
  assert.throws(() => safeUrl("https://github.com/x", "book"), /Unsafe/);
  assert.equal(safeUrl("https://github.com/ipusiron/test?x=1&y=2", "repo"), "https://github.com/ipusiron/test?x=1&y=2");
});

test("SL6: source text cannot create markup; unsafe catalog URLs fail generation", () => {
  const tools = structuredClone(toolsData), books = structuredClone(booksData);
  const payload = '<script>alert("&\'x")</script>';
  tools.tools[0].title = payload;
  tools.tools[0].subtitle_ja = payload;
  books.books[0].title_en = payload;
  books.books[0].note_en = payload;
  books.books[0].url = "https://akademeia.info/?a=1&b=2";
  const result = buildPage(tools, books);
  assert.ok(result.includes(escapeHtml(payload)));
  assert.ok(result.includes('href="https://akademeia.info/?a=1&amp;b=2"'));
  assert.ok(!result.includes(payload));
  assert.doesNotMatch(result, /<script\b/i);
  tools.tools[0].demo_url = "https://evil.test/";
  assert.throws(() => buildPage(tools, books), /Unsafe demo URL/);
});

test("SL7: hidden tools are absent and duplicate visible IDs fail before output", () => {
  const tools = structuredClone(toolsData);
  tools.tools.push({ id: "day999", title: "hidden", hub: false, repo_url: "javascript:ignored" });
  assert.equal(buildPage(tools, booksData), html);
  tools.tools.push({ ...tools.tools[0] });
  assert.throws(() => buildPage(tools, booksData), /duplicate|D\d/);
});

test("SL8: the static layout keeps one tool per row and all links at least 44px", () => {
  const css = fs.readFileSync(path.join(root, "css/list.css"), "utf8");
  assert.match(css, /\.sl-page a\s*\{[^}]*min-height:\s*2\.75rem/s);
  assert.match(css, /\.sl-row\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/s);
  assert.match(css, /overflow-wrap:\s*anywhere/);
  assert.doesNotMatch(css, /label-ja|label-en|display:\s*none|#[0-9a-f]{3,8}\b/i);
});

test("SL9: each title has its own language without changing bilingual subtitles or escaping", () => {
  const tools=structuredClone(toolsData);
  const examples=[["Cipher & <Tool>","en"],["暗号 Tool","ja"],["ひらがな Tool","ja"],["カタカナ Tool","ja"],["ｶﾅ Tool","ja"],["\u{20000} Tool","ja"]];
  examples.forEach(([title],index)=>{tools.tools[index].title=title;});
  const result=buildPage(tools,booksData);
  for(const [title,lang] of examples)assert.ok(result.includes(`<strong lang="${lang}">${escapeHtml(title)}</strong>`),title);
  assert.equal((result.match(/<strong lang="(?:ja|en)">/g)||[]).length,(result.match(/class="sl-row"/g)||[]).length);
  assert.match(result,/<div class="sl-subtitle"><span lang="ja">/);
  assert.doesNotMatch(result,/<(?:li|div)[^>]*\blang=/);
});
