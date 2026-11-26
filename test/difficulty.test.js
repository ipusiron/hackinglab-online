"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read } = require("./helpers/page.js");
const U = require("../js/url.js");
const B = require("../js/books.js");
const catalog = JSON.parse(read("data/tools.json"));
const visible = catalog.tools.filter((t) => t.hub !== false);
const books = JSON.parse(read("data/books.json")).books;
const el = (p, id) => p.document.getElementById(id);
const ids = (p) => el(p, "tool-list").querySelectorAll(".tool-card").map((c) => c.dataset.toolId);
const select = (p, id, value) => { const input = el(p, id); input.value = value; input.dispatch("change"); };
const upTo = (limit) => visible.filter((t) => Number.isInteger(t.difficulty) && t.difficulty >= 1 && t.difficulty <= limit);
const limit = (p) => new URL(p.context.location.href).searchParams.get("maxDifficulty");

test("DF1: URL limits are strict 1–4, trimmed, canonical and independent of catalog availability", () => {
  for (const value of ["1", "2", "3", "4", " 2 "]) {
    const url = U.buildUrl("https://hackinglab.online/?q=hash&ref=keep&ref=also", { maxDifficulty: value });
    assert.equal(U.readState(new URL(url).search, {}).maxDifficulty, value.trim());
    assert.deepEqual([...new URL(url).searchParams.keys()], ["maxDifficulty", "q", "ref", "ref"]);
  }
  for (const value of ["", "0", "5", "-1", "2.0", "2.5", "+2", "02", "２", "1e0", "all", "<script>"]) {
    assert.equal(U.readState("?maxDifficulty=" + encodeURIComponent(value), {}).maxDifficulty, "", value);
    assert.equal(new URL(U.buildUrl("https://hackinglab.online/?maxDifficulty=2&ref=keep", { maxDifficulty: value })).searchParams.get("maxDifficulty"), null);
  }
  assert.equal(U.readState("?maxDifficulty=2&maxDifficulty=4", {}).maxDifficulty, "2");
  assert.equal(U.buildUrl("https://hackinglab.online/?maxDifficulty=3&ref=keep", { q: "hash" }), "https://hackinglab.online/?maxDifficulty=3&q=hash&ref=keep");
});

for (const lang of ["ja", "en"]) test(`DF2 ${lang}: inclusive limits retain catalog order, summary and all option through language/reload`, async () => {
  const p = await runPage({ search: `?lang=${lang}&ref=keep` });
  assert.deepEqual(el(p, "filter-difficulty").options.map((o) => o.value), ["", "1", "2", "3", "4"]);
  for (const maximum of [1, 2, 3, 4]) {
    select(p, "filter-difficulty", String(maximum));
    assert.deepEqual(ids(p), upTo(maximum).map((t) => t.id));
    assert.equal(limit(p), String(maximum));
    assert.match(el(p, "active-filter-summary").textContent, new RegExp(lang === "ja" ? `★${maximum}まで` : `Up to ★${maximum}`));
  }
  el(p, lang === "ja" ? "lang-en" : "lang-ja").click();
  assert.equal(el(p, "filter-difficulty").value, "4");
  const reload = await runPage({ search: p.context.location.search });
  assert.deepEqual(ids(reload), ids(p));
  assert.equal(new URL(p.context.location.href).searchParams.get("ref"), "keep");
  select(p, "filter-difficulty", ""); await p.flush();
  assert.deepEqual(ids(p), visible.map((t) => t.id)); assert.equal(limit(p), null);
});

test("DF3: unknown and invalid ratings appear in All but never count as an easy tool", async () => {
  const data = JSON.parse(JSON.stringify(catalog));
  const ratings = [null, undefined, "1", 0, -1, 1.5, 6, 1, 2, 5];
  data.tools = data.tools.slice(0, ratings.length).map((t, i) => ({ ...t, difficulty: ratings[i] }));
  const p = await runPage({ dataOverrides: { "data/tools.json": data } });
  assert.equal(ids(p).length, ratings.length);
  select(p, "filter-difficulty", "1"); assert.deepEqual(ids(p), [data.tools[7].id]);
  select(p, "filter-difficulty", "4"); assert.deepEqual(ids(p), [data.tools[7].id, data.tools[8].id]);
  select(p, "filter-difficulty", ""); await p.flush(); assert.equal(ids(p).length, ratings.length);
});

test("DF4: difficulty combines with book/category/search/progress/saved and retains chapter order", async () => {
  const book = books.find((b) => b.slug === "genai-crypto");
  const targets = B.expandTargetIds(book, catalog.tools);
  const target = upTo(2).find((t) => targets.has(t.id) && t.category_ids.length);
  assert.ok(target);
  const p = await runPage({ search: `?book=${book.slug}&maxDifficulty=2`, storedValues: { [`progress_${target.slug}`]: "1", [`later_${target.id}`]: "1" } });
  const expected = B.buildGroups(book, catalog.tools).flatMap((g) => g.items).filter((t) => t.difficulty >= 1 && t.difficulty <= 2).map((t) => t.id);
  assert.deepEqual(ids(p), expected);
  select(p, "filter-category", target.category_ids[0]);
  select(p, "filter-progress", "1");
  el(p, "filter-later").checked = true; el(p, "filter-later").dispatch("change");
  el(p, "filter-search-input").value = target.id; el(p, "filter-search-input").dispatch("input");
  assert.deepEqual([...new Set(ids(p))], [target.id]);
  assert.equal(limit(p), "2");
  assert.ok(!p.context.location.search.includes("progress")); assert.ok(!p.context.location.search.includes("later"));
  assert.equal(p.values.get(`progress_${target.slug}`), "1");
});

test("DF5: select changes coalesce, Back/Forward restore focus and local filters, and returning to All drops the extra entry", async () => {
  const p = await runPage(); const control = el(p, "filter-difficulty"); control.focus();
  select(p, "filter-progress", "0");
  select(p, "filter-difficulty", "2"); select(p, "filter-difficulty", "3");
  assert.equal(p.context.history.length, 2); assert.equal(limit(p), "3");
  await p.back(); assert.equal(limit(p), null); assert.equal(control.value, ""); assert.equal(p.document.activeElement, control);
  await p.forward(); assert.equal(limit(p), "3"); assert.equal(control.value, "3"); assert.equal(el(p, "filter-progress").value, "0");
  const rapid = await runPage();
  select(rapid, "filter-difficulty", "1"); select(rapid, "filter-difficulty", "2"); select(rapid, "filter-difficulty", ""); await rapid.flush();
  assert.equal(limit(rapid), null); assert.equal(rapid.context.history.length, 2);
  assert.deepEqual(ids(rapid), visible.map((t) => t.id));
});

test("DF6: See all and empty-result clear remove the limit in state and URL; the latter retains its book", async () => {
  for (const book of ["", "genai-crypto"]) {
    const p = await runPage({ search: `?book=${book}&maxDifficulty=1&q=no-result-xyz&ref=keep` });
    assert.equal(ids(p).length, 0); el(p, "clear-filters").click();
    assert.equal(limit(p), null); assert.equal(el(p, "filter-difficulty").value, ""); assert.equal(el(p, "filter-book").value, book);
    assert.equal(p.document.activeElement.id, "filter-search-input"); assert.ok(ids(p).length);
  }
  const p = await runPage({ search: "?maxDifficulty=2&field=cryptography&ref=keep" });
  el(p, "start-all-button").click(); assert.equal(limit(p), null); assert.equal(el(p, "filter-difficulty").value, "");
  assert.deepEqual(ids(p), visible.map((t) => t.id));
  await p.back(); assert.equal(limit(p), "2"); assert.equal(el(p, "filter-difficulty").value, "2");
  await p.forward(); assert.equal(limit(p), null);
});

test("DF7: Day links clear only a conflicting limit; starter progress lands without changing progress", async () => {
  const easy = upTo(1)[0], harder = visible.find((t) => t.difficulty > 1);
  for (const [tool, expected] of [[easy, "1"], [harder, null]]) {
    const p = await runPage({ search: `?maxDifficulty=1&ref=keep#${tool.id}` });
    assert.equal(limit(p), expected); assert.ok(ids(p).includes(tool.id));
    assert.equal(p.document.activeElement, el(p, tool.id).querySelector(".tool-title"));
  }
  const starter = visible.find((t) => t.id === "day050"); assert.ok(starter.difficulty > 1);
  const p = await runPage({ search: "?maxDifficulty=1" });
  const link = el(p, "start-progress-recommended-day050"); link.focus(); link.click(); await p.flush();
  assert.equal(limit(p), null); assert.equal(p.document.activeElement.closest(".tool-card").dataset.toolId, starter.id);
  assert.equal(p.document.activeElement.dataset.part, "progress"); assert.equal(p.values.get(`progress_${starter.slug}`), undefined);
  await p.back(); assert.equal(limit(p), "1"); assert.equal(p.document.activeElement, link);
  await p.forward(); assert.equal(limit(p), null);
  const unknown = await runPage({ search: "?maxDifficulty=1#day999" }); assert.equal(limit(unknown), null); assert.equal(ids(unknown).length, visible.length);
});

test("DF8: sets clear difficulty and preserve their given order, including empty sets and Clear", async () => {
  for (const values of ["3,8", "", "999"]) {
    const p = await runPage({ search: `?maxDifficulty=1&tools=${values}&ref=keep` });
    assert.equal(limit(p), null); assert.equal(el(p, "filter-difficulty").value, "");
    if (values === "3,8") {
      assert.deepEqual(ids(p), ["day003", "day008"]); el(p, "set-banner-clear").click();
    }
    assert.equal(ids(p).length, visible.length); assert.equal(limit(p), null);
  }
});

test("DF9: latest loading/retry URLs resolve the limit and optional books failure keeps the filter usable", async () => {
  const p = await runPage({ search: "?maxDifficulty=1", deferData: true });
  assert.equal(el(p, "filter-difficulty").disabled, true);
  p.context.history.pushState(null, "", "?maxDifficulty=3&ref=keep"); p.dispatch("popstate", { state: null });
  await p.releaseData(); assert.equal(el(p, "filter-difficulty").disabled, false); assert.equal(el(p, "filter-difficulty").value, "3");
  assert.deepEqual(ids(p), upTo(3).map((t) => t.id));
  const retry = await runPage({ search: "?maxDifficulty=2", allowLoadFailure: true, fetchResponse: (name, _, attempt) => name === "data/tools.json" && attempt === 1 ? { ok: false, status: 503 } : undefined });
  assert.equal(el(retry, "filter-difficulty").disabled, true);
  el(retry, "retry-data").click(); await retry.flush(); assert.equal(el(retry, "filter-difficulty").disabled, false);
  assert.deepEqual(ids(retry), upTo(2).map((t) => t.id));
  const missing = await runPage({ search: "?book=genai-crypto&maxDifficulty=2", dataFailures: { "data/books.json": 503 } });
  assert.equal(el(missing, "filter-book-group").hidden, true); assert.deepEqual(ids(missing), upTo(2).map((t) => t.id));
  select(missing, "filter-difficulty", "1"); assert.deepEqual(ids(missing), upTo(1).map((t) => t.id));
});

test("DF10: dashboard, saved-selection and set share URLs exclude difficulty and unrelated conditions", async () => {
  const p = await runPage({ search: "?maxDifficulty=2&lang=en&ref=private", storedValues: { later_day003: "1", later_day050: "1" } });
  el(p, "tab-dashboard-label").click(); el(p, "share-copy-link").click(); await p.flush();
  assert.equal(p.copied.at(-1), "https://hackinglab.online/?lang=en");
  el(p, "tab-tools-label").click(); el(p, "filter-later").checked = true; el(p, "filter-later").dispatch("change");
  const candidate = el(p, "later-share-list").querySelector("input"); candidate.checked = true; candidate.dispatch("change");
  const share = new URL(el(p, "later-share-url").value);
  assert.deepEqual([...share.searchParams.keys()], ["tools", "lang"]); assert.equal(share.hash, "");
  const set = await runPage({ search: "?maxDifficulty=1&tools=3,50&lang=en&ref=private" });
  el(set, "set-banner-copy").click(); await set.flush();
  assert.deepEqual([...new URL(set.copied.at(-1)).searchParams.keys()], ["tools", "lang"]);
});
