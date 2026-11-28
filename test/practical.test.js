"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read } = require("./helpers/page.js");
const P = require("../js/print.js");
const catalog = JSON.parse(read("data/tools.json"));
const el = (p, id) => p.document.getElementById(id);

test("handout keeps public selection order, excludes hidden/unknown IDs, deduplicates and limits twelve", () => {
  const copy = structuredClone(catalog);
  copy.tools.find(t => t.id === "day001").hub = false;
  const selected = P.select("?tools=day003,day001,Day007,day003,day999&q=private&progress=3", copy);
  assert.deepEqual(selected.tools.map(t => t.id), ["day003", "day007"]);
  assert.equal(selected.unknown, true);
  assert.equal(selected.truncated, false);
  const ids = copy.tools.filter(t => t.hub !== false).slice(0, 13).map(t => t.id);
  const full = P.select("?tools=" + ids.join(","), copy);
  assert.deepEqual(full.tools.map(t => t.id), ids.slice(0, 12));
  assert.equal(full.truncated, true);
  assert.deepEqual(P.select("?q=day003", copy).tools, []);
  assert.throws(() => P.select("?tools=day003", { tools: [] }));
  assert.throws(() => P.select("?tools=day003", { schema_version: 1, tools: [copy.tools[1], copy.tools[1]] }));
});

test("handout links contain only public IDs/language and reject executable or credentialed destinations", () => {
  const url = new URL(P.collectionUrl(["day003", "day007"], "en"));
  assert.deepEqual([...url.searchParams.keys()], ["tools", "lang"]);
  assert.equal(url.origin, "https://hackinglab.online");
  assert.equal(new URL(P.collectionUrl(["day003"], "ja")).searchParams.get("lang"), "ja");
  for (const unsafe of ["javascript:alert(1)", "data:text/html,secret", "//example.com", "https://user:secret@example.com", "http://example.com"]) assert.equal(P.safeLink(unsafe), "");
  assert.equal(P.safeLink("https://example.com/demo/"), "https://example.com/demo/");
});

test("preparation shares the existing disclosure and survives language/history without changing progress", async () => {
  const p = await runPage({ search: "?q=day003", storedValues: { "progress_caesar-cipher-wheel": "2" } });
  let card = p.document.querySelector(".tool-card");
  let button = card.querySelector(".tool-description-toggle");
  assert.equal(card.querySelector(".tool-preparation").hidden, true);
  assert.equal(button.hidden, false);
  for (const id of button.getAttribute("aria-controls").split(" ")) assert.ok(el(p, id));
  const before = [...p.values];
  button.focus(); button.click();
  assert.equal(card.querySelector(".tool-preparation").hidden, false);
  el(p, "lang-en").click();
  card = p.document.querySelector(".tool-card"); button = card.querySelector(".tool-description-toggle");
  assert.equal(card.querySelector(".tool-preparation").hidden, false);
  assert.match(card.querySelector(".tool-preparation").textContent, /Environment/);
  assert.equal(button.getAttribute("aria-expanded"), "true");
  assert.deepEqual([...p.values].filter(([k]) => k.startsWith("progress_")), before.filter(([k]) => k.startsWith("progress_")));
});

test("saved-selection and received-set print links never inherit private URL or storage values", async () => {
  const p = await runPage({ search: "?q=secret&unknown=private", storedValues: { later_day003: "1", later_day007: "1", progress_example: "3" } });
  el(p, "filter-later").checked = true; el(p, "filter-later").dispatch("change"); el(p, "later-share").open = true;
  for (const id of ["day007", "day003"]) {
    const box = el(p, "later-share-list").querySelectorAll("input").find(c => c.dataset.toolId === id);
    box.checked = true; box.dispatch("change");
  }
  const url = new URL(el(p, "later-share-print").getAttribute("href"), "https://hackinglab.online/");
  assert.equal(url.pathname, "/print.html");
  assert.deepEqual([...url.searchParams.keys()], ["tools", "lang"]);
  assert.equal(url.searchParams.get("tools"), "day007,day003");
  const set = await runPage({ search: "?tools=day007,day003&lang=en&q=secret" });
  const received = new URL(el(set, "set-banner-print").href, "https://hackinglab.online/");
  assert.equal(received.searchParams.get("tools"), "day007,day003");
  assert.equal(received.searchParams.get("lang"), "en");
  assert.equal(received.searchParams.has("q"), false);
});

test("updates link follows explicit language and report link contains only the public form name", async () => {
  const p = await runPage({ search: "?lang=ja&q=private" });
  assert.equal(el(p, "updates-link").getAttribute("href"), "./updates.html?lang=ja");
  el(p, "lang-en").click();
  assert.equal(el(p, "updates-link").getAttribute("href"), "./updates.html?lang=en");
  const report = el(p, "help-report").querySelector("a");
  const url = new URL(report.getAttribute("href"));
  assert.equal(url.pathname, "/ipusiron/hackinglab-online/issues/new");
  assert.deepEqual([...url.searchParams], [["template", "problem.yml"]]);
  el(p, "help-button").click();
  assert.equal(p.evaluate("getFocusableElements(document.getElementById('help-dialog')).some(el=>el.href && el.href.includes('template=problem.yml'))"), false);
  el(p, "help-report").open = true;
  assert.equal(p.evaluate("getFocusableElements(document.getElementById('help-dialog')).some(el=>el.href && el.href.includes('template=problem.yml'))"), true);
});
