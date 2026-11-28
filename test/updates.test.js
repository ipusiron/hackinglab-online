"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validDate, recentTools, validateUpdates, buildUpdatesPage } = require("../scripts/updates_page.js");
const root = path.resolve(__dirname, "..");
const tools = require("../data/tools.json");
const updates = require("../data/updates.json");
const html = fs.readFileSync(path.join(root, "updates.html"), "utf8");
const source = fs.readFileSync(path.join(root, "js/updates.js"), "utf8");
const copy = value => JSON.parse(JSON.stringify(value));

test("updates: generated HTML is current and catalog input order does not matter", () => {
  assert.equal(html, buildUpdatesPage(tools, updates));
  assert.equal(html, buildUpdatesPage({ ...tools, tools: [...tools.tools].reverse() }, updates));
  assert.equal(html, buildUpdatesPage({ ...tools, generated_at: "2099-01-01" }, updates));
});

test("updates: latest ten use first listing, exclude private and unknown dates, and tie by Day number", () => {
  const fixture = { tools: Array.from({ length: 12 }, (_, i) => ({ id: `day${String(i + 1).padStart(3, "0")}`, title: `Tool ${i}`, added: "2026-11-01", updated_at: `2099-01-${String(12 - i).padStart(2, "0")}` })) };
  fixture.tools.push({ id: "day013", title: "Private", added: "2026-11-28", hub: false }, { id: "day014", title: "Unknown", added: "2026-02-30" });
  fixture.tools[11].added = "2026-11-27";
  fixture.tools.reverse();
  const before = JSON.stringify(fixture);
  assert.deepEqual(recentTools(fixture).map(tool => tool.id), ["day012", "day001", "day002", "day003", "day004", "day005", "day006", "day007", "day008", "day009"]);
  assert.equal(JSON.stringify(fixture), before);
  for (const bad of ["2026-02-29", "2026-02-30", "2026-13-01", "2026-1-01", "", null]) assert.equal(validDate(bad), false);
  assert.equal(validDate("2024-02-29"), true);
});

test("updates: public listing dates and bilingual curated release records remain distinct", () => {
  assert.equal((html.match(/data-tool-id=/g) || []).length, 10);
  assert.match(html, /ツール自体の更新日ではありません/);
  assert.match(html, /Dates show first listing, not tool updates/);
  for (const item of validateUpdates(updates)) {
    if (item.source_ref === "current-release") assert.equal(item.source_url, undefined);
    else assert.match(item.source_url, /^https:\/\/github\.com\/ipusiron\/hackinglab-online\/pull\/\d+$/);
    for (const lang of ["ja", "en"]) {
      assert.ok(html.includes(item[`title_${lang}`]));
      assert.ok(html.includes(item[`description_${lang}`]));
    }
  }
  assert.equal(validateUpdates(updates)[0].id, "preparation-sharing-help");
});

test("updates: malformed records and unsafe destinations fail before generation", () => {
  for (const href of ["javascript:alert(1)", "https://outside.example/", "//outside.example/", "./index.html?next=https://outside.example", "./index.html#bad", "./discover.html?lang=en"]) {
    const data = copy(updates); data.updates[0].href = href;
    assert.throws(() => buildUpdatesPage(tools, data), /destination/);
  }
  for (const change of [data => data.updates.push(copy(data.updates[0])), data => { data.updates[0].published_on = "2026-02-30"; }, data => { data.updates[0].source_url = "http://github.com/"; }, data => { delete data.updates[0].title_en; }]) {
    const data = copy(updates); change(data); assert.throws(() => buildUpdatesPage(tools, data));
  }
});

test("updates: text content is escaped and local card links preserve language and tool identity", () => {
  const data = copy(updates); data.updates[0].title_ja = '<img src=x onerror="evil()">';
  const catalog = { tools: [{ id: "day999", title: '<script>alert("x")</script>', added: "2026-11-28", subtitle_ja: "A & B", subtitle_en: "A > B" }] };
  const output = buildUpdatesPage(catalog, data);
  assert.ok(output.includes("&lt;img src=x onerror=&quot;evil()&quot;&gt;"));
  assert.ok(output.includes("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;"));
  assert.ok(output.includes("A &amp; B"));
  for (const lang of ["ja", "en"]) assert.ok(output.includes(`./index.html?tools=day999&amp;lang=${lang}#day999`));
  assert.ok(html.includes('./index.html?tab=dashboard&amp;lang=en'));
  assert.ok(html.includes('./discover.html?lang=en'));
});

test("updates: static bilingual content and restrictive resources require no data fetch", () => {
  assert.match(html, /lang="ja"/); assert.match(html, /lang="en"/);
  assert.match(html, /default-src 'none'; script-src 'self'/);
  assert.doesNotMatch(html, /<script(?! src=)|\son\w+=|<style/i);
  assert.doesNotMatch(source, /\bfetch\s*\(|XMLHttpRequest|innerHTML|hlo_records/);
  for (const match of html.matchAll(/(?:src|href)="(\.\/(?:js|css|favicon)\/[^"?#]+)"/g)) assert.ok(fs.existsSync(path.join(root, match[1])));
  const css = fs.readFileSync(path.join(root, "css/updates.css"), "utf8");
  assert.match(css, /html\.language-ready/);
  assert.match(css, /html:not\(\.language-ready\)/);
});

function browser({ query = "", saved = null, blocked = false, noHistory = false } = {}) {
  const listeners = {}, buttons = ["ja", "en"].map(lang => ({ dataset: { lang }, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, addEventListener(event, fn) { this[event] = fn; } }));
  const controls = { hidden: true }, writes = [], entries = [], calls = [];
  const location = new URL("https://hackinglab.online/updates.html" + query);
  const document = { readyState: "complete", documentElement: { lang: "ja", classList: { add() {} } }, querySelector: () => controls, querySelectorAll: () => buttons };
  let index = -1;
  const history = {
    state: null,
    replaceState(state) { if (noHistory) throw Error("blocked"); this.state = state; entries[++index] = { state, url: location.href }; calls.push("replace"); },
    pushState(state, _, url) { if (noHistory) throw Error("blocked"); this.state = state; location.href = new URL(url, location).href; entries.splice(++index); entries[index] = { state, url: location.href }; calls.push("push"); }
  };
  const context = { document, location, history, URL, HLOLang: require("../js/lang.js"), addEventListener: (event, fn) => { listeners[event] = fn; } };
  Object.defineProperty(context, "localStorage", { get() { if (blocked) throw Error("blocked"); return { getItem: () => saved, setItem: (key, value) => { writes.push([key, value]); saved = value; } }; } });
  vm.runInNewContext(source, context);
  return { document, controls, buttons, writes, calls, location, back() { const entry = entries[--index]; location.href = entry.url; listeners.popstate({ state: entry.state }); } };
}

test("updates: explicit language beats saved preference, opening writes no preference", () => {
  const page = browser({ query: "?lang=en", saved: "ja" });
  assert.equal(page.document.documentElement.lang, "en");
  assert.equal(page.buttons[1].attributes["aria-pressed"], "true");
  assert.equal(page.controls.hidden, false);
  assert.deepEqual(page.writes, []);
  assert.equal(browser({ saved: "en" }).document.documentElement.lang, "en");
});

test("updates: language switch and Back preserve the initial language, unrelated query and fragment", () => {
  const page = browser({ query: "?campaign=demo#recent-tools" });
  page.buttons[1].click();
  assert.equal(page.location.search, "?campaign=demo&lang=en");
  assert.equal(page.location.hash, "#recent-tools");
  assert.deepEqual(page.writes, [["hlo_lang", "en"]]);
  page.buttons[1].click();
  assert.equal(page.calls.filter(call => call === "push").length, 1);
  page.back();
  assert.equal(page.document.documentElement.lang, "ja");
  assert.equal(page.buttons[0].attributes["aria-pressed"], "true");
});

test("updates: blocked storage and history do not prevent reading or language selection", () => {
  const page = browser({ query: "?lang=en", blocked: true, noHistory: true });
  assert.equal(page.document.documentElement.lang, "en");
  assert.doesNotThrow(() => page.buttons[0].click());
  assert.equal(page.document.documentElement.lang, "ja");
});

test("updates: generation and deployment include updates and the companion print page", () => {
  const deploy = fs.readFileSync(path.join(root, ".github/workflows/deploy-pages.yml"), "utf8");
  assert.match(deploy, /find index\.html[^\n]*updates\.html[^\n]*print\.html/);
  assert.match(deploy, /cp index\.html[^\n]*updates\.html[^\n]*print\.html/);
  const update = fs.readFileSync(path.join(root, ".github/workflows/update-tools.yml"), "utf8");
  for (const line of update.split(/\r?\n/).filter(line => /git (diff|add)/.test(line))) assert.ok(line.includes("updates.html"));
});
