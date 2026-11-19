"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read, chooseProgress } = require("./helpers/page.js");
const HB = require("../js/books.js");
const data = JSON.parse(read("data/books.json"));
const tools = JSON.parse(read("data/tools.json")).tools;
const books = data.books;
const el = (p, id) => p.document.getElementById(id);
const cards = p => el(p, "tool-list").querySelectorAll(".tool-card");
const change = (p, id, value) => { const node = el(p, id); node.value = value; node.dispatch("change"); };
const search = (p, value) => { const node = el(p, "filter-search-input"); node.value = value; node.dispatch("input"); };
const notice = p => el(p, "book-notice");

test("BV1: optional chapter titles affect headings only, with validated bilingual fallback and safe text rendering", async () => {
  const book = structuredClone(books[0]);
  const chapter = book.chapters[0];
  assert.notEqual(HB.chapterTitle(book, chapter.key, "ja"), HB.chapterLabel(book, chapter.key, "ja"));
  const id = Object.keys(book.refs).find(id => book.refs[id].some(ref => ref.ch === chapter.key));
  assert.ok(HB.formatRef(book, id, "ja").some(text => text.startsWith(chapter.label_ja)));
  const fallback = book.chapters.at(-1);
  assert.equal(HB.chapterTitle(book, fallback.key, "en"), fallback.label_en);
  delete chapter.title_en;
  assert.ok(HB.validateBooks({ schema_version: 1, books: [book] }, tools).some(e => /title/.test(e)));
  chapter.title_en = 42;
  assert.ok(HB.validateBooks({ schema_version: 1, books: [book] }, tools).some(e => /title/.test(e)));
  chapter.title_en = '<img src=x onerror=alert(1)>';
  const p = await runPage({ search: `?book=${book.slug}&lang=en`, dataOverrides: { "data/books.json": { schema_version: 1, books: [book] } } });
  assert.ok(p.document.querySelector(".book-group-heading").textContent.startsWith(chapter.title_en));
  assert.equal(p.document.querySelector("#tool-list img"), null);
});

test("BV2: narrow book arrival collapses once; resize, language, deliberate expansion and focus remain independent", async () => {
  const p = await runPage({ search: "?book=genai-crypto", width: 320 });
  assert.equal(el(p, "tool-filters").hidden, true);
  assert.equal(el(p, "filter-toggle").hidden, false);
  assert.equal(el(p, "filter-toggle").getAttribute("aria-expanded"), "false");
  p.resize(1280); assert.equal(el(p, "tool-filters").hidden, false); assert.equal(el(p, "filter-toggle").hidden, true);
  p.resize(320); assert.equal(el(p, "tool-filters").hidden, true);
  el(p, "filter-toggle").click(); el(p, "lang-en").click();
  assert.equal(el(p, "tool-filters").hidden, false);
  p.resize(1280); p.resize(320); assert.equal(el(p, "tool-filters").hidden, false);
  el(p, "filter-toggle").click(); p.resize(1280);
  el(p, "filter-search-input").focus(); p.resize(320);
  assert.equal(el(p, "tool-filters").hidden, false); assert.equal(p.document.activeElement, el(p, "filter-search-input"));
  for (const query of ["", "?book=", "?book=ALL", "?book=&book=genai-crypto"]) {
    const ordinary = await runPage({ search: query, width: 320 });
    assert.equal(el(ordinary, "tool-filters").hidden, false, query);
  }
});

test("BV3: filter reveal precedes clear, empty-result, retry and saved-history focus, with unavailable-book fallback", async () => {
  const p = await runPage({ search: "?book=genai-crypto", width: 320 });
  p.document.querySelector(".book-banner-clear").click();
  assert.equal(el(p, "tool-filters").hidden, false); assert.equal(p.document.activeElement, el(p, "filter-book"));
  assert.equal(el(p, "book-status").textContent, "書籍・プロジェクトの絞り込みを解除しました。");
  change(p, "filter-book", "genai-crypto"); search(p, "zz-no-matching-tool"); el(p, "filter-toggle").click();
  el(p, "clear-filters").click();
  assert.equal(el(p, "tool-filters").hidden, false); assert.equal(el(p, "filter-book").value, "genai-crypto");
  assert.equal(p.document.activeElement, el(p, "filter-search-input"));
  el(p, "filter-toggle").click();
  p.evaluate('restoreFocus({focus: "#filter-category"})');
  assert.equal(el(p, "tool-filters").hidden, false); assert.equal(p.document.activeElement, el(p, "filter-category"));
  const q = await runPage({ search: "?book=genai-crypto", width: 320, dataFailures: { "data/books.json": 503 }, fetchResponse: (name, _, attempt) => name === "data/tools.json" && attempt === 1 ? { ok: false, status: 503 } : undefined, allowLoadFailure: true });
  el(q, "retry-data").focus(); await q.evaluate("loadData()");
  assert.equal(el(q, "tool-filters").hidden, false); assert.equal(q.document.activeElement, el(q, "filter-search-input"));
  q.evaluate('focusFilter("filter-book")'); assert.equal(q.document.activeElement, el(q, "filter-search-input"));
});

test("BV4: valid sets exclusively hide filters and clear reveals them without a stale book notice", async () => {
  const p = await runPage({ search: "?book=unknown&tools=day003,day001", width: 320 });
  assert.equal(el(p, "tool-filters").hidden, true); assert.equal(el(p, "filter-toggle").hidden, true);
  assert.equal(notice(p).hidden, true); p.resize(1280); assert.equal(el(p, "tool-filters").hidden, true);
  p.resize(320); el(p, "set-banner-clear").click();
  assert.equal(el(p, "tool-filters").hidden, false); assert.equal(notice(p).hidden, true);
  assert.equal(p.document.activeElement, el(p, "filter-book"));
});

test("BV5: jump is closed at every width; back links open and focus it without changing history; state survives rebuild", async () => {
  for (const width of [320,1280]) {
    const p = await runPage({ search: "?book=genai-crypto", width });
    assert.equal(p.document.querySelector(".book-jump").open, false);
    const before = p.context.location.href, length = p.context.history.length;
    const back = p.document.querySelector(".book-back-to-sections");
    assert.equal(back.dispatch("click").defaultPrevented, true);
    assert.equal(p.document.querySelector(".book-jump").open, true); assert.equal(p.document.activeElement, el(p, "book-jump-summary"));
    assert.equal(p.context.location.href, before); assert.equal(p.context.history.length, length);
    el(p, "lang-en").click(); assert.equal(p.document.querySelector(".book-jump").open, true);
    assert.equal(el(p, "book-jump-summary").textContent, "Jump to section");
    p.document.querySelector(".book-jump-link").click();
    assert.equal(p.context.history.length, length); assert.match(p.context.location.hash, /^#book-group-/);
    p.document.querySelector(".book-back-to-sections-end").click();
    assert.match(p.context.location.hash, /^#book-group-/);
    search(p, "day003"); assert.equal(p.document.querySelector(".book-jump").open, true);
  }
  const single = await runPage({ search: "?book=ango-gijutsu-no-subete" });
  assert.equal(single.document.querySelector(".book-jump"), null); assert.equal(single.document.querySelector(".book-back-to-sections"), null);
});

test("BV6: unique book totals and actual duplicate cards are distinct, including empty and single-tool filters", async () => {
  const p = await runPage({ search: "?book=genai-crypto" });
  assert.equal(p.document.querySelector(".book-banner-count").textContent, "該当52本");
  assert.equal(cards(p).length, 74); assert.match(el(p, "book-duplicate-note").textContent, /74枚/);
  search(p, "day003"); assert.equal(cards(p).length, 2); assert.match(el(p, "book-duplicate-note").textContent, /2枚/);
  assert.equal(p.document.querySelector(".book-banner-count").textContent, "該当52本");
  el(p, "lang-en").click();
  assert.match(p.document.querySelector(".book-group-heading").textContent, /\(1 tool\)$/);
  assert.match(el(p, "book-duplicate-note").textContent, /\(2 cards\)/);
  search(p, "zz-no-match"); assert.equal(cards(p).length, 0); assert.equal(el(p, "book-duplicate-note").hidden, true);
  const single = await runPage({ search: "?book=ango-gijutsu-no-subete" });
  assert.equal(el(single, "book-duplicate-note").hidden, true);
});

test("BV7: local, cross-tab and imported progress retain duplicate DOM/counts/focus; language keeps outside cards", async () => {
  const p = await runPage({ search: "?book=genai-crypto&q=day003", width: 320, confirmResult: true });
  change(p, "filter-progress", "0");
  const control = cards(p)[0].querySelector(".tool-progress-select"), allCards = cards(p);
  const banner = p.document.querySelector(".book-banner-clear");
  control.focus(); chooseProgress(control, 3);
  assert.equal(cards(p)[0], allCards[0]); assert.equal(cards(p)[1], allCards[1]); assert.equal(p.document.activeElement, control);
  assert.match(el(p, "book-duplicate-note").textContent, /2枚/); assert.equal(p.document.querySelector(".book-banner-clear"), banner);
  const tool = tools.find(t => t.id === "day003"); p.values.set("progress_" + tool.slug, "0");
  p.dispatch("storage", { key: "progress_" + tool.slug }); p.dispatch("pageshow", { persisted: true });
  assert.equal(control.value, "0"); assert.equal(cards(p)[0], allCards[0]);
  const file = JSON.stringify({ app: "hackinglab-online", schema_version: 1, saved_at: "2026-11-20T00:00:00.000Z", progress: { day003: 2 } });
  el(p, "records-file").files = [{ size: Buffer.byteLength(file), text: async () => file }];
  await p.evaluate("handleRecordsImport()");
  assert.equal(control.value, "2"); assert.equal(cards(p)[0], allCards[0]); assert.equal(p.document.activeElement, control);
  el(p, "lang-en").click(); assert.equal(cards(p).length, 2); assert.match(el(p, "book-duplicate-note").textContent, /2 cards/);
  change(p, "filter-progress", "0"); assert.equal(cards(p).length, 0);
});

test("BV8: unknown requests and unavailable books are distinct; blank/all requests stay quiet and never echo raw input", async () => {
  const p = await runPage({ search: "?book=%3Cimg%20src%3Dx%3E&lang=en" });
  assert.equal(el(p, "book-notice-title").textContent, "Book not found"); assert.doesNotMatch(notice(p).textContent, /<img|src=/);
  const titleNode = el(p, "book-notice-title").childNodes[0]; p.evaluate("renderToolList(); refreshProgressViews()");
  assert.equal(el(p, "book-notice-title").childNodes[0], titleNode, "Same notice must not mutate the live region again");
  el(p, "lang-ja").click(); assert.equal(el(p, "book-notice-title").textContent, "指定された本が見つからない");
  for (const fault of [{ dataFailures: { "data/books.json": 503 } }, { dataFailures: { "data/books.json": "reject" } }, { dataOverrides: { "data/books.json": {} } }]) {
    const failed = await runPage({ search: "?book=genai-crypto&lang=en", ...fault });
    assert.equal(el(failed, "book-notice-title").textContent, "Couldn't load the book list");
    assert.equal(el(failed, "main-content").dataset.loadState, "ready");
    for (const search of ["", "?book=", "?book=ALL", "?book=&book=genai-crypto"]) assert.equal(notice(await runPage({ search, ...fault })).hidden, true);
  }
});

test("BV9: book notices preserve category/search/progress and omit the all-tools claim when it is false", async () => {
  for (const failure of [false,true]) {
    const p = await runPage({ search: "?book=missing&q=day003&cat=classic-crypto&lang=en", dataFailures: failure ? { "data/books.json": 503 } : {} });
    assert.equal(el(p, "filter-category").value, "classic-crypto"); assert.equal(el(p, "filter-search-input").value, "day003");
    assert.equal(cards(p).length, 1); assert.doesNotMatch(notice(p).textContent, /all tools are shown|All tools are shown/);
    assert.equal(new URL(p.context.location.href).searchParams.get("book"), "missing");
    p.context.history.pushState({ progress: "3", y: 0 }, "", "?book=missing&lang=en"); p.dispatch("popstate", { state: { progress: "3", y: 0 } });
    assert.equal(el(p, "filter-progress").value, "3"); assert.equal(cards(p).length, 0);
    assert.doesNotMatch(notice(p).textContent, /all tools are shown|All tools are shown/);
  }
});

test("BV10: tools and single hashes have priority over book notices, including empty/unknown sets; latest pending URL wins", async () => {
  for (const suffix of ["&tools=day003", "&tools=", "&tools=missing", "#day003", "#day999"]) {
    for (const failure of [false,true]) {
      const p = await runPage({ search: "?book=missing" + suffix, width: 320, dataFailures: failure ? { "data/books.json": 503 } : {} });
      assert.equal(notice(p).hidden, true, suffix);
      assert.equal(el(p, "tool-filters").hidden, suffix === "&tools=day003", suffix);
      p.evaluate("renderToolList(); refreshProgressViews()"); assert.equal(notice(p).hidden, true, suffix);
    }
  }
  const p = await runPage({ search: "?book=missing", deferData: true });
  p.context.history.pushState(null, "", "?book=genai-crypto"); p.dispatch("popstate", { state: null }); await p.releaseData();
  assert.equal(notice(p).hidden, true); assert.equal(el(p, "filter-book").value, "genai-crypto");
  p.context.history.pushState(null, "", "?book=unknown#book-group-ch01"); p.dispatch("popstate", { state: null });
  assert.equal(notice(p).hidden, false); change(p, "filter-book", "genai-crypto"); assert.equal(notice(p).hidden, true);
  await p.back(); assert.equal(notice(p).hidden, false);
});

test("BV11: all nine banner links retain their role and new-tab contract, related badges are separate from book type", async () => {
  for (const book of books) for (const lang of ["ja","en"]) {
    const p = await runPage({ search: `?book=${book.slug}&lang=${lang}` });
    const link = p.document.querySelector(".book-banner-link");
    assert.equal(link.href, book.url); assert.equal(link.target, "_blank"); assert.match(link.rel, /\bnoopener\b/);
    assert.equal(link.textContent, book["url_label_"+lang] + (lang === "ja" ? "（新しいタブ）" : " (new tab)"));
    const badges = p.document.querySelectorAll(".book-banner-badge");
    assert.equal(badges.length, book.relation === "related" ? 2 : 1);
    if (book.relation === "related") assert.equal(badges[0].textContent, lang === "ja" ? "書籍" : "Book (in Japanese)");
    if (book.kind === "series") assert.equal(badges[0].textContent, lang === "ja" ? "プロジェクト" : "Project");
  }
});

function clock() {
  let now = 0, seq = 0;
  const pending = new Map();
  return {
    setTimeout(fn, delay = 0) { const id = ++seq; pending.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms, page) {
      const end = now + ms;
      await page.flush();
      while (true) {
        const job = [...pending.entries()].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!job) break;
        now = job[1].at; pending.delete(job[0]); job[1].fn(); await page.flush();
      }
      now = end; await page.flush();
    }
  };
}

test("BV12: optional body failure/deadline stays ready, publishes once through the shared status, and ignores a late book body", async () => {
  for (const mode of ["reject", "timeout"]) {
    const time = clock(); let finish;
    const body = new Promise(resolve => { finish = resolve; });
    const p = await runPage({ search: "?book=genai-crypto&lang=en", clock: time, allowLoadFailure: true,
      fetchResponse: name => name === "data/books.json" ? { ok: true, json: () => mode === "reject" ? Promise.reject(Error("Broken JSON body")) : body } : undefined });
    await time.advance(3000, p);
    assert.equal(el(p, "main-content").dataset.loadState, "ready");
    const message = "Couldn't load the book list All tools are shown instead. Please reload the page in a little while.";
    assert.equal(el(p, "book-status").textContent, message);
    assert.equal(notice(p).getAttribute("role"), null);
    const first = el(p, "book-status").childNodes[0];
    p.evaluate("renderToolList(); updateBookStatus(); refreshProgressViews()"); await time.advance(1000, p);
    assert.equal(el(p, "book-status").childNodes[0], first);
    finish(data); await p.flush(); assert.equal(el(p, "filter-book-group").hidden, true);
    assert.equal(el(p, "book-status").textContent, message);
  }
});

test("BV13: history repeats one applicable notice, then book choice cancels its pending same-message reset", async () => {
  const time = clock(); const p = await runPage({ search: "?book=unknown&lang=en", clock: time });
  const message = el(p, "book-status").textContent;
  p.context.history.pushState(null, "", "?book=another-unknown&lang=en"); p.dispatch("popstate", { state: null });
  assert.equal(el(p, "book-status").textContent, "");
  await time.advance(49, p); assert.equal(el(p, "book-status").textContent, "");
  change(p, "filter-book", "genai-crypto"); const count = el(p, "book-status").textContent;
  assert.notEqual(count, message); await time.advance(1000, p);
  assert.equal(notice(p).hidden, true); assert.equal(el(p, "book-status").textContent, count);
  assert.match(count, /Showing all 52 tools/);
});

test("BV14: static headings use long titles while reference chips keep short labels and public book identities stay stable", () => {
  const { buildPage, escapeHtml } = require("../scripts/build_pages.js");
  const html = buildPage(JSON.parse(read("data/tools.json")), data);
  for (const book of books) for (const chapter of book.chapters || []) for (const lang of ["ja", "en"]) {
    if (chapter["title_" + lang]) assert.ok(html.includes(escapeHtml(chapter["title_" + lang])));
  }
  assert.match(read("css/style.css"), /html\[data-book-arrival="true"\]:not\(\.js-ready\) #tool-filters \{ display: none;/);
  assert.match(read("index.html"), /id="filter-toggle"[^>]+aria-expanded="false"[^>]+disabled hidden/);
});

test("BV15: the end button opens filters and focuses the first usable field without changing URL/history or chapter jump", async () => {
  for (const [query, failure, target] of [["", false, "filter-book"], ["?book=genai-crypto", false, "filter-book"], ["?book=genai-crypto", true, "filter-category"], ["?tools=unknown", false, "filter-book"]]) {
    const p = await runPage({ search: query, width: 320, dataFailures: failure ? { "data/books.json": 503 } : {} });
    const button = el(p, "back-to-filters");
    assert.equal(button.tagName, "BUTTON"); assert.equal(button.type, "button"); assert.equal(button.hidden, false);
    assert.equal(button.querySelector('[aria-hidden="true"]').textContent, "▲");
    const jump = p.document.querySelector(".book-jump"), open = jump?.open;
    const href = p.context.location.href, length = p.context.history.length;
    button.focus(); button.click();
    assert.equal(el(p, "tool-filters").hidden, false); assert.equal(el(p, "filter-toggle").getAttribute("aria-expanded"), "true");
    assert.equal(p.document.activeElement, el(p, target));
    assert.equal(p.document.scrollCalls.at(-1).element, el(p, "tool-filters"));
    assert.equal(p.document.scrollCalls.at(-1).options.block, "start");
    assert.equal(p.document.focusCalls.at(-1).options.preventScroll, true);
    assert.equal(p.context.location.href, href); assert.equal(p.context.history.length, length);
    assert.equal(p.document.querySelector(".book-jump"), jump); assert.equal(jump?.open, open);
    el(p, "lang-en").click(); assert.equal(el(p, "back-to-filters"), button, "Static return control survives language rendering");
    assert.equal(button.querySelector(".label-en").textContent, " Back to filters");
  }
});

test("BV16: return-to-filters stays hidden during load/error and a valid set, then follows set clear/history", async () => {
  const loading = await runPage({ deferData: true }); assert.equal(el(loading, "back-to-filters").hidden, true);
  await loading.releaseData(); assert.equal(el(loading, "back-to-filters").hidden, false);
  const failed = await runPage({ dataFailures: { "data/tools.json": 503 }, allowLoadFailure: true });
  assert.equal(el(failed, "back-to-filters").hidden, true);
  const p = await runPage({ search: "?tools=day003,day001", width: 320 });
  const button = el(p, "back-to-filters"); assert.equal(button.hidden, true);
  const active = p.document.activeElement; button.click();
  assert.equal(el(p, "tool-filters").hidden, true); assert.equal(p.document.activeElement, active);
  el(p, "set-banner-clear").click(); assert.equal(button.hidden, false);
  await p.back(); assert.equal(button.hidden, true); assert.equal(el(p, "tool-filters").hidden, true);
  await p.forward(); assert.equal(button.hidden, false);
});

test("BV17: empty-result clear scrolls the revealed search into view, without altering history focus restoration", async () => {
  const p = await runPage({ search: "?book=genai-crypto&q=no-match-probe", width: 320 });
  assert.equal(el(p, "tool-filters").hidden, true);
  el(p, "clear-filters").click();
  assert.equal(p.document.activeElement, el(p, "filter-search-input"));
  assert.equal(p.document.scrollCalls.at(-1).element, el(p, "filter-search-input"));
  assert.equal(p.document.scrollCalls.at(-1).options.block, "nearest");
  const scrolls = p.document.scrollCalls.length;
  p.evaluate('restoreFocus({ focus: "#filter-category" })');
  assert.equal(p.document.scrollCalls.length, scrolls, "History restoration must preserve the restored reading position");
});

test("BV18: explicit progress changes announce count/zero results ahead of unknown/unavailable-book notices, without later revival", async () => {
  for (const unavailable of [false, true]) {
    const time = clock();
    const p = await runPage({ search: "?book=missing&lang=en", clock: time, dataFailures: unavailable ? { "data/books.json": 503 } : {}, confirmResult: true });
    assert.match(el(p, "book-status").textContent, unavailable ? /Couldn't load the book list/ : /Book not found/);
    const status = el(p, "book-status"), descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(status), "textContent");
    const writes = [];
    Object.defineProperty(status, "textContent", { get() { return descriptor.get.call(this); }, set(value) { writes.push(value); descriptor.set.call(this, value); } });
    change(p, "filter-progress", "3");
    assert.equal(cards(p).length, 0); assert.match(status.textContent, /No tools match/);
    assert.equal(writes.length, 1, "Manual progress must publish only the result, not a book notice followed by a result");
    const result = status.textContent;
    p.evaluate("renderToolList(); refreshProgressViews()"); await time.advance(1000, p);
    assert.equal(status.textContent, result); assert.equal(writes.length, 1);
    change(p, "filter-progress", "all"); assert.equal(status.textContent, "Showing all 128 tools.");
    const first = cards(p)[0].querySelector(".tool-progress-select"); chooseProgress(first, 1);
    p.dispatch("pageshow", { persisted: true }); await time.advance(1000, p);
    assert.equal(status.textContent, "Showing all 128 tools.");
    const importedText = JSON.stringify({ app: "hackinglab-online", schema_version: 1, saved_at: "2026-11-20T00:00:00.000Z", progress: { day003: 2 } });
    el(p, "records-file").files = [{ size: Buffer.byteLength(importedText), text: async () => importedText }];
    const imported = p.evaluate("handleRecordsImport()"); await p.flush(); await time.advance(0, p); await imported;
    assert.equal(status.textContent, "Showing all 128 tools.", "Import must not revive the old book notice");
    p.context.history.pushState({ y: 0, progress: "all" }, "", "?book=missing&lang=en");
    p.dispatch("popstate", { state: { y: 0, progress: "all" } });
    assert.match(status.textContent, unavailable ? /Couldn't load the book list/ : /Book not found/);
  }
});
