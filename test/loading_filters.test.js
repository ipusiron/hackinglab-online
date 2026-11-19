"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read } = require("./helpers/page.js");
const B = require("../js/books.js");
const catalog = JSON.parse(read("data/tools.json"));
const categories = JSON.parse(read("data/categories.json"));
const books = JSON.parse(read("data/books.json")).books;
const visible = catalog.tools.filter((t) => t.hub !== false);
const clone = (value) => JSON.parse(JSON.stringify(value));
const el = (page, id) => page.document.getElementById(id);
const state = (page) => el(page, "main-content").dataset.loadState;
const cards = (page) => el(page, "tool-list").querySelectorAll(".tool-card");
const status = (page) => el(page, "book-status").textContent;
const count = (page) => el(page, "list-count").textContent;
const selected = (page, id, value) => { const input = el(page, id); input.value = value; input.dispatch("change"); };
const search = (page, value) => { const input = el(page, "filter-search-input"); input.value = value; input.dispatch("input"); };
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

test("LF1: HTML starts loading with disabled filters; all JSON starts in parallel and language changes do not render empty data", async () => {
  const p = await runPage({ deferData: true });
  assert.equal(state(p), "loading");
  assert.deepEqual([...p.fetched].sort(), ["data/books.json", "data/categories.json", "data/tools.json"]);
  for (const id of ["filter-book", "filter-category", "filter-progress", "filter-search-input", "share-on-x", "reset-all-progress"]) assert.equal(el(p, id).disabled, true);
  assert.equal(el(p, "catalog-loading").hidden, false);
  el(p, "lang-en").dispatch("click");
  assert.equal(cards(p).length, 0);
  assert.equal(el(p, "clear-filters"), null);
  assert.equal(el(p, "filter-search-input").placeholder, "Name, description, Day number");
  await p.releaseData();
  assert.equal(state(p), "ready");
  assert.equal(el(p, "catalog-loading").hidden, true);
  assert.equal(el(p, "filter-search-input").disabled, false);
});

test("LF2: the required 20s deadline aborts stalled fetch even if abort is ignored, and late old data cannot overwrite retry", async () => {
  const time = clock(); let finishOld; let oldSignal;
  const p = await runPage({ clock: time, allowLoadFailure: true, fetchResponse(name, options, attempt) {
    if (name === "data/tools.json" && attempt === 1) {
      oldSignal = options.signal;
      return new Promise((resolve) => { finishOld = resolve; });
    }
  } });
  await time.advance(19999, p); assert.equal(state(p), "loading");
  await time.advance(1, p); assert.equal(state(p), "error");
  assert.equal(oldSignal.aborted, true);
  assert.equal(el(p, "load-fallback").hidden, false);
  const retry = el(p, "retry-data"); retry.focus(); retry.dispatch("click"); retry.dispatch("click");
  await p.flush();
  assert.equal(p.fetched.length, 6, "Double-click started another attempt");
  assert.equal(state(p), "ready");
  assert.equal(p.document.activeElement, el(p, "filter-search-input"));
  finishOld({ ok: true, json: async () => ({ ...catalog, generated_at: "stale response" }) });
  await p.flush();
  assert.equal(el(p, "last-updated-value").textContent, catalog.generated_at);
  assert.equal(cards(p).length, visible.length);
});

test("LF3: receiving headers does not stop the required body deadline", async () => {
  const time = clock(); let signal;
  const p = await runPage({ clock: time, allowLoadFailure: true, fetchResponse(name, options) {
    if (name === "data/categories.json") { signal = options.signal; return { ok: true, json: () => new Promise(() => {}) }; }
  } });
  await time.advance(20000, p);
  assert.equal(state(p), "error"); assert.equal(signal.aborted, true);
  assert.equal(el(p, "tool-list").getAttribute("aria-busy"), "false");
  assert.equal(el(p, "share-on-x").disabled, true);
});

test("LF4: optional books get 3s after required bodies arrive; ignored abort and late books do not block or change the list", async () => {
  const time = clock(); let finishRequired, finishBooks, optionalSignal;
  const p = await runPage({ clock: time, allowLoadFailure: true, fetchResponse(name, options) {
    if (name === "data/tools.json") return { ok: true, json: () => new Promise((resolve) => { finishRequired = resolve; }) };
    if (name === "data/books.json") { optionalSignal = options.signal; return { ok: true, json: () => new Promise((resolve) => { finishBooks = resolve; }) }; }
  } });
  await time.advance(5000, p); assert.equal(state(p), "loading");
  finishRequired(clone(catalog)); await p.flush();
  await time.advance(2999, p); assert.equal(state(p), "loading");
  await time.advance(1, p); assert.equal(state(p), "ready");
  assert.equal(optionalSignal.aborted, true); assert.equal(el(p, "filter-book-group").hidden, true);
  finishBooks(JSON.parse(read("data/books.json"))); await p.flush();
  assert.equal(el(p, "filter-book-group").hidden, true);
  assert.equal(cards(p).length, visible.length);
});

test("LF5: failed, broken-body and invalid optional books still render the required catalog", async () => {
  for (const response of [{ ok: false, status: 503 }, { ok: true, json: async () => { throw new SyntaxError("Broken optional JSON"); } }, { ok: true, json: async () => ({ books: [{ slug: "invalid" }] }) }]) {
    const p = await runPage({ fetchResponse: (name) => name === "data/books.json" ? response : undefined });
    assert.equal(state(p), "ready"); assert.equal(cards(p).length, visible.length);
    assert.equal(el(p, "filter-book-group").hidden, true);
  }
});

test("LF6: malformed or empty required catalogs are failures, including duplicated identities and unsafe links", async () => {
  const duplicate = clone(catalog); duplicate.tools.push(clone(duplicate.tools[0]));
  const badUrl = clone(catalog); badUrl.tools[0].repo_url = "javascript:alert(1)";
  const badShape = clone(catalog); badShape.tools[0].category_ids = "authentication";
  const hidden = clone(catalog); hidden.tools.forEach((t) => { t.hub = false; });
  for (const dataOverrides of [
    { "data/categories.json": [] }, { "data/categories.json": { categories } },
    { "data/tools.json": { ...catalog, tools: [] } }, { "data/tools.json": duplicate },
    { "data/tools.json": badUrl }, { "data/tools.json": badShape }, { "data/tools.json": hidden }
  ]) {
    const p = await runPage({ dataOverrides, allowLoadFailure: true });
    assert.equal(state(p), "error"); assert.equal(cards(p).length, 0);
    assert.equal(el(p, "catalog-error").getAttribute("role"), "alert");
    assert.equal(el(p, "retry-data").disabled, false);
  }
});

test("LF7: retry reloads only data, keeps listeners single, and works from an initial dashboard", async () => {
  const p = await runPage({ search: "?tab=dashboard&lang=en", allowLoadFailure: true,
    fetchResponse: (name, _, attempt) => name === "data/tools.json" && attempt === 1 ? { ok: false, status: 503 } : undefined });
  assert.equal(state(p), "error"); assert.equal(el(p, "tab-dashboard").hidden, false);
  assert.equal(el(p, "catalog-error").closest('[role="tabpanel"]'), null);
  el(p, "retry-data").focus(); el(p, "retry-data").dispatch("click"); await p.flush();
  assert.equal(state(p), "ready"); assert.equal(p.document.activeElement.id, "tab-dashboard-label");
  for (const [id, event] of [["retry-data", "click"], ["filter-category", "change"], ["filter-search-input", "input"]]) assert.equal(el(p, id).listeners.get(event).length, 1);
  const before = p.fetched.length; await p.context.loadData(); assert.equal(p.fetched.length, before);
});

test("LF8: retry uses the latest queued URL/search/progress and does not steal focus from new interaction", async () => {
  let finish;
  const p = await runPage({ allowLoadFailure: true, fetchResponse(name, _, attempt) {
    if (name === "data/tools.json" && attempt === 1) return { ok: false, status: 503 };
    if (name === "data/tools.json") return { ok: true, json: () => new Promise((resolve) => { finish = resolve; }) };
  } });
  el(p, "retry-data").focus(); el(p, "retry-data").dispatch("click"); await p.flush();
  p.context.history.pushState({ progress: "0", y: 300 }, "", "?book=genai-crypto&q=day003");
  p.dispatch("popstate", { state: { progress: "0", y: 300 } });
  el(p, "lang-en").focus(); p.dispatch("pointerdown");
  finish(clone(catalog)); await p.flush();
  assert.equal(state(p), "ready"); assert.equal(el(p, "filter-book").value, "genai-crypto");
  assert.equal(el(p, "filter-search-input").value, "day003"); assert.equal(el(p, "filter-progress").value, "0");
  assert.deepEqual([...new Set(cards(p).map((card) => card.dataset.toolId))], ["day003"]);
  assert.equal(p.document.activeElement.id, "lang-en");
  assert.equal(p.context.location.search, "?book=genai-crypto&q=day003");
});

test("LF9: retry yields focus to pointer, keyboard, wheel, or a newly focused control without navigation", async () => {
  for (const action of ["pointerdown", "keydown", "wheel", "focus"]) {
    let finish;
    const p = await runPage({ allowLoadFailure: true, fetchResponse(name, _, attempt) {
      if (name !== "data/tools.json") return;
      if (attempt === 1) return { ok: false, status: 503 };
      return { ok: true, json: () => new Promise((resolve) => { finish = resolve; }) };
    } });
    el(p, "retry-data").focus(); el(p, "retry-data").dispatch("click"); await p.flush();
    if (action === "focus") el(p, "help-button").focus(); else { p.document.activeElement = p.document.body; p.dispatch(action); }
    const focus = p.document.activeElement; finish(clone(catalog)); await p.flush();
    assert.equal(p.document.activeElement, focus, action);
  }
});

test("LF10: visible count uses unique IDs for all tools, chapter books, sets and a cached render", async () => {
  const p = await runPage({ search: "?lang=en" });
  assert.equal(count(p), `Showing all ${visible.length} tools`);
  selected(p, "filter-book", "genai-crypto");
  const total = B.expandTargetIds(books.find((b) => b.slug === "genai-crypto"), catalog.tools).size;
  assert.ok(cards(p).length > total); assert.equal(count(p), `Showing all ${total} tools`);
  el(p, "list-count").textContent = "stale count"; p.context.renderToolList();
  assert.equal(count(p), `Showing all ${total} tools`);
  const set = await runPage({ search: "?tools=3,3,8&lang=en" });
  assert.equal(count(set), "Showing all 2 tools");
  selected(set, "filter-progress", "3"); assert.equal(cards(set).length, 2);
});

test("LF11: zero-result clear preserves the selected book, clears other filters, focuses search and restores through Back", async () => {
  for (const book of ["", "genai-crypto"]) {
    const p = await runPage({ search: `?q=unmatchable&lang=en${book ? "&book=" + book : ""}` });
    selected(p, "filter-progress", "1");
    assert.equal(cards(p).length, 0);
    const clear = el(p, "clear-filters"); assert.ok(clear);
    assert.equal(clear.textContent, book ? "Clear category, progress, and search" : "Clear all filters");
    clear.focus(); clear.dispatch("click");
    assert.equal(el(p, "filter-book").value, book); assert.equal(el(p, "filter-progress").value, "all");
    assert.equal(el(p, "filter-category").value, ""); assert.equal(el(p, "filter-search-input").value, "");
    assert.equal(p.document.activeElement.id, "filter-search-input");
    assert.equal(new URL(p.context.location.href).searchParams.get("q"), null);
    await p.back(); assert.equal(cards(p).length, 0); assert.equal(el(p, "filter-search-input").value, "unmatchable");
    assert.equal(el(p, "filter-progress").value, "1");
  }
});

test("LF12: progress changes keep every duplicate in place, count outside once, notify only on addition and remove the mark on return", async () => {
  const p = await runPage({ search: "?book=genai-crypto&lang=en" });
  selected(p, "filter-progress", "0");
  const all = cards(p); const card = all.find((item) => all.filter((c) => c.dataset.toolId === item.dataset.toolId).length > 1);
  const copies = all.filter((c) => c.dataset.toolId === card.dataset.toolId);
  const total = new Set(all.map((c) => c.dataset.toolId)).size;
  const button = card.querySelector('[data-part="progress"]'); button.focus(); button.dispatch("click");
  assert.deepEqual(cards(p), all); assert.equal(p.document.activeElement, button);
  for (const item of copies) { assert.equal(item.querySelector(".tool-outside-label").hidden, false); assert.ok(item.querySelector(".tool-outside-space")); }
  assert.equal(count(p), `Showing ${total} of ${total} (1 no longer matches)`);
  assert.equal(status(p), 'This card no longer matches the “Not started” filter. It stays in the list until you change the filters.');
  el(p, "book-status").textContent = "already announced"; button.dispatch("click"); assert.equal(status(p), "already announced");
  button.dispatch("click"); button.dispatch("click");
  for (const item of copies) assert.equal(item.querySelector(".tool-outside-label").hidden, true);
  assert.equal(count(p), `Showing all ${total} tools`);
  button.dispatch("click"); selected(p, "filter-category", "classic-crypto");
  assert.equal(cards(p).some((c) => c.dataset.toolId === card.dataset.toolId), false);
});

test("LF13: cross-tab progress applies and removes outside labels without rebuilding; sets never use the progress condition", async () => {
  const time = clock(); const p = await runPage({ clock: time, search: "?lang=en" });
  selected(p, "filter-progress", "0"); const first = cards(p)[0]; const slug = first.dataset.slug;
  p.values.set(`progress_${slug}`, "1"); p.dispatch("storage", { key: `progress_${slug}` });
  await time.advance(100, p); assert.equal(cards(p)[0], first); assert.equal(first.querySelector(".tool-outside-label").hidden, false);
  p.values.set(`progress_${slug}`, "0"); p.dispatch("storage", { key: `progress_${slug}` });
  await time.advance(100, p); assert.equal(first.querySelector(".tool-outside-label").hidden, true);
  const set = await runPage({ search: "?tools=3,8" }); selected(set, "filter-progress", "0");
  cards(set)[0].querySelector('[data-part="progress"]').dispatch("click");
  assert.equal(cards(set).some((c) => c.classList.contains("is-outside")), false);
});

test("LF14: search announces once at 700ms; category/progress immediately; repeated same text waits 50ms and can be canceled", async () => {
  const time = clock(); const p = await runPage({ clock: time, search: "?lang=en" });
  search(p, "day003"); assert.equal(status(p), "");
  await time.advance(699, p); assert.equal(status(p), "");
  await time.advance(1, p); assert.equal(status(p), `Showing 1 of ${visible.length} tools.`);
  search(p, "day003 "); await time.advance(800, p); assert.equal(status(p), `Showing 1 of ${visible.length} tools.`);
  selected(p, "filter-progress", "all"); assert.equal(status(p), "");
  await time.advance(49, p); assert.equal(status(p), "");
  el(p, "lang-ja").dispatch("click"); await time.advance(1, p); assert.equal(status(p), "");
  selected(p, "filter-category", "authentication");
  assert.equal(status(p), "条件に合うツールはありません。");
});

test("LF15: book, tab, history, language and composition cancel stale search announcements; IME completion announces once", async () => {
  for (const action of ["book", "tab", "history", "language", "composition"]) {
    const time = clock(); const p = await runPage({ clock: time, search: "?lang=en" }); search(p, "day003");
    await time.advance(300, p);
    if (action === "book") selected(p, "filter-book", "genai-crypto");
    if (action === "tab") el(p, "tab-dashboard-label").dispatch("click");
    if (action === "history") { p.context.history.pushState(null, "", "?lang=en#day008"); p.dispatch("hashchange"); }
    if (action === "language") el(p, "lang-ja").dispatch("click");
    if (action === "composition") { const input = el(p, "filter-search-input"); input.dispatch("compositionstart"); input.value = "未確定"; input.dispatch("input", { isComposing: true }); assert.equal(cards(p)[0].dataset.toolId, "day003"); }
    const after = status(p); await time.advance(500, p); assert.equal(status(p), after, action);
    if (action === "composition") {
      const input = el(p, "filter-search-input"); input.value = "day008"; input.dispatch("compositionend"); input.dispatch("input", { isComposing: false });
      await time.advance(699, p); assert.equal(status(p), after); await time.advance(1, p);
      assert.equal(status(p), `Showing 1 of ${visible.length} tools.`);
    }
  }
});

test("LF16: fallback and zero-result controls retain no-JS links, 44px targets, and the CSS deadline under reduced motion", () => {
  const html = read("index.html"), css = read("css/style.css");
  assert.match(html, /<noscript>[\s\S]*?The tool list and filters need JavaScript[\s\S]*?href="\.\/list\.html"[\s\S]*?<\/noscript>/);
  assert.match(html, /id="slow-loading"[\s\S]*?<a href="">/);
  assert.match(css, /html:not\(\.js-ready\) #slow-loading\s*\{\s*animation: hlo-slow-loading 0s linear 25s forwards/);
  assert.match(css, /#retry-data, #clear-filters, #slow-loading a\s*\{[^}]*min-height: 44px/);
  assert.match(css, /\.tool-outside-label\s*\{[^}]*position: absolute/);
  assert.match(css, /\.tool-outside-space\s*\{[^}]*visibility: hidden/);
  const reduced = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\n\}/)?.[0] || "";
  assert.doesNotMatch(reduced, /animation:\s*none|#slow-loading/);
});

test("LF17: a required JSON parse failure reaches error and a normalized URL still returns retry focus", async () => {
  for (const query of ["?q=%20day003%20&lang=en", "?book=%20GENAI-CRYPTO%20&lang=en"]) {
    const p = await runPage({ search: query, allowLoadFailure: true, fetchResponse(name, _, attempt) {
      if (name === "data/tools.json" && attempt === 1) return { ok: true, json: async () => { throw new SyntaxError("Broken required JSON"); } };
    } });
    assert.equal(state(p), "error"); el(p, "retry-data").focus(); el(p, "retry-data").dispatch("click"); await p.flush();
    assert.equal(state(p), "ready"); assert.equal(p.document.activeElement.id, "filter-search-input");
    assert.equal(p.context.location.search.includes("%20"), false);
  }
});

test("LF18: all-results and zero-results use their approved full spoken sentences", async () => {
  for (const language of ["ja", "en"]) {
    const time = clock(); const p = await runPage({ clock: time, search: `?lang=${language}` });
    selected(p, "filter-progress", "all");
    assert.equal(status(p), language === "ja" ? `全${visible.length}本を表示しています。` : `Showing all ${visible.length} tools.`);
    search(p, "unmatchable"); await time.advance(700, p);
    assert.equal(status(p), el(p, "tool-list").querySelector(".list-empty p").textContent);
    selected(p, "filter-book", "genai-crypto");
    assert.equal(status(p), el(p, "tool-list").querySelector(".list-empty p").textContent);
  }
});

test("LF19: language-only redraw retains outside IDs and chapter duplicates without re-announcing marks", async () => {
  const p = await runPage({ search: "?book=genai-crypto" }); selected(p, "filter-progress", "0");
  const before = cards(p); const item = before.find((c) => before.filter((x) => x.dataset.toolId === c.dataset.toolId).length > 1);
  item.querySelector('[data-part="progress"]').dispatch("click");
  const identities = before.map((c) => `${c.dataset.toolId}/${c.dataset.group}`);
  const priorStatus = status(p); el(p, "lang-en").dispatch("click");
  assert.deepEqual(cards(p).map((c) => `${c.dataset.toolId}/${c.dataset.group}`), identities);
  assert.equal(status(p), priorStatus, "Language change must not re-announce an existing mark");
  const copies = cards(p).filter((c) => c.dataset.toolId === item.dataset.toolId);
  for (const card of copies) assert.equal(card.querySelector(".tool-outside-label").textContent, 'No longer “Not started”');
  assert.match(count(p), /\(1 no longer matches\)$/);
  el(p, "lang-ja").dispatch("click");
  assert.deepEqual(cards(p).map((c) => `${c.dataset.toolId}/${c.dataset.group}`), identities);
  for (const card of cards(p).filter((c) => c.dataset.toolId === item.dataset.toolId)) assert.equal(card.querySelector(".tool-outside-label").textContent, '「未着手」の条件外');
  selected(p, "filter-progress", "0");
  assert.equal(cards(p).some((c) => c.dataset.toolId === item.dataset.toolId), false);
});

test("LF20: reserved count and progress text are hidden from accessibility, while only the current stage changes", async () => {
  for (const language of ["ja", "en"]) {
    const p = await runPage({ search: `?lang=${language}` });
    assert.equal(el(p, "list-count-space").textContent, "");
    selected(p, "filter-progress", "0");
    const reserved = el(p, "list-count-space").textContent;
    assert.equal(el(p, "list-count-space").getAttribute("aria-hidden"), "true");
    assert.equal(reserved, language === "ja" ? `${visible.length}本中${visible.length}本を表示（${visible.length}本は条件外）` : `Showing ${visible.length} of ${visible.length} (${visible.length} no longer matches)`);
    const button = cards(p)[0].querySelector('[data-part="progress"]');
    const labels = language === "ja" ? ["未着手", "学習中", "一周完了", "定着済み"] : ["Not started", "In progress", "First pass", "Mastered"];
    const label = (stage) => language === "ja" ? `進捗: ${stage}` : `Progress: ${stage}`;
    const spaces = button.querySelectorAll(".tool-progress-space");
    assert.deepEqual(spaces.map((space) => space.textContent), labels.map(label));
    for (const space of spaces) assert.equal(space.getAttribute("aria-hidden"), "true");
    for (const stage of [1, 2, 3, 0]) {
      button.dispatch("click");
      assert.equal(button.querySelector(".tool-progress-label").textContent, label(labels[stage]));
      assert.deepEqual(button.querySelectorAll(".tool-progress-space"), spaces);
      assert.equal(el(p, "list-count-space").textContent, reserved);
    }
  }
  const css = read("css/style.css");
  assert.match(css, /#list-count-space, \.tool-progress-space\s*\{\s*visibility: hidden/);
  assert.match(css, /\.tool-progress-button\s*\{[^}]*display: inline-grid/);
});
