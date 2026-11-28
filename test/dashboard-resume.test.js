"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read, chooseProgress } = require("./helpers/page.js");
const HU = require("../js/url.js");
const catalog = () => JSON.parse(read("data/tools.json"));
const tools = catalog().tools.filter((tool) => tool.hub !== false);
const el = (p, id) => p.document.getElementById(id);
const key = (tool) => `progress_${tool.slug}`;
const stored = (items) => Object.fromEntries(items.map((tool) => [key(tool), "1"]));
const rows = (p) => el(p, "dashboard-resume-list").children;
const ids = (p) => rows(p).map((row) => row.dataset.toolId);
const records = (p) => [...p.values].filter(([name]) => /^(progress_|later_)/.test(name)).sort();
const openPanel = (p) => { el(p, "dashboard-resume").open = true; };
const control = (p, tool) => p.document.querySelector(`.tool-progress-select[data-slug="${tool.slug}"]`);

test("DR1: the closed dashboard list includes every public level-1 tool in catalog order, independently of filters and sets", async () => {
  const data = catalog(); data.tools.at(-1).hub = false;
  const expected = data.tools.filter((tool) => tool.hub !== false).slice(0, 7);
  const values = { ...stored(expected), [key(data.tools.at(-1))]: "1", [key(data.tools[8])]: "2", [key(data.tools[9])]: "3" };
  for (const search of ["?tab=dashboard&q=no-matching-tools&maxDifficulty=1", "?tools=day003"]) {
    const p = await runPage({ search, storedValues: values, dataOverrides: { "data/tools.json": data } });
    assert.deepEqual(ids(p), expected.map((tool) => tool.id));
    assert.equal(el(p, "dashboard-resume").open, false);
    assert.equal(el(p, "dashboard-resume").hidden, false);
    assert.equal(el(p, "dashboard-resume").closest("section").id, "dashboard-overall");
    assert.equal(el(p, "dashboard-resume-summary").textContent, "学習中のツールから再開（7本）");
    assert.equal(p.document.querySelectorAll(".start-progress").length, 15);
  }
  const empty = await runPage();
  assert.equal(el(empty, "dashboard-resume").hidden, true);
  assert.equal(rows(empty).length, 0);
});

test("DR2: demo and usage fallback reuse localized destinations and existing recent history without changing progress", async () => {
  const data = catalog(), demo = data.tools.find((tool) => tool.demo_url), usage = data.tools.find((tool) => tool.id !== demo.id);
  usage.demo_url = ""; usage.readme_usage = { ja: { status: "heading", fragment: "使い方" }, en: { status: "missing" } };
  const p = await runPage({ search: "?tab=dashboard&lang=en", storedValues: stored([demo, usage]), dataOverrides: { "data/tools.json": data } });
  openPanel(p);
  const before = records(p);
  const demoLink = el(p, `resume-open-${demo.id}`), usageLink = el(p, `resume-open-${usage.id}`);
  assert.equal(demoLink.href, HU.demoLink(demo.demo_url, "en"));
  assert.equal(usageLink.href, HU.readmeTarget(usage.repo_url, "en", usage.readme_usage).href);
  assert.equal(usageLink.getAttribute("hreflang"), "ja");
  assert.equal(usageLink.textContent, "Open usage");
  for (const link of [demoLink, usageLink]) {
    assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener");
    assert.match(link.getAttribute("aria-label"), /opens in a new tab/);
    assert.equal(link.querySelectorAll(".external-link-icon").length, 1);
    assert.equal(link.querySelector(".external-link-icon").getAttribute("aria-hidden"), "true");
    const click = p.document.dispatch("click", { target: link, type: "click", button: 0, ctrlKey: true });
    assert.equal(click.defaultPrevented, false);
    assert.equal(JSON.parse(p.values.get("hlo_recent_tools"))[0], link.dataset.toolId);
  }
  p.document.dispatch("auxclick", { target: demoLink, type: "auxclick", button: 1 });
  assert.equal(JSON.parse(p.values.get("hlo_recent_tools"))[0], demo.id);
  assert.deepEqual(records(p), before);
  assert.ok([...p.values.keys()].every((name) => name.startsWith("progress_") || name === "hlo_recent_tools"));
  el(p, "lang-ja").click();
  assert.equal(el(p, `resume-open-${demo.id}`), demoLink);
  assert.equal(usageLink.textContent, "使い方を開く");
  p.evaluate("renderDashboard()");
  assert.equal(demoLink.querySelectorAll(".external-link-icon").length, 1);
  assert.equal(usageLink.querySelectorAll(".external-link-icon").length, 1);
});

test("DR3: local changes and storage/pageshow refreshes keep surviving nodes and focus, and rescue a removed focused row", async () => {
  const [first, second, third] = tools;
  const p = await runPage({ search: "?tab=dashboard", storedValues: stored([second, third]) });
  openPanel(p);
  const panel = el(p, "dashboard-resume"), summary = el(p, "dashboard-resume-summary");
  const link = el(p, `resume-record-${third.id}`); link.focus();
  chooseProgress(control(p, first), 1);
  assert.deepEqual(ids(p), [first.id, second.id, third.id]);
  assert.equal(el(p, `resume-record-${third.id}`), link);
  assert.equal(p.document.activeElement, link); assert.equal(panel.open, true);
  el(p, "lang-en").click();
  assert.equal(p.document.activeElement, link); assert.equal(link.textContent, "Open progress");
  assert.equal(summary.textContent, "Resume tools in progress (3)");
  p.values.set(key(second), "2"); p.dispatch("storage", { key: key(second) }); p.dispatch("pageshow", { persisted: true });
  assert.deepEqual(ids(p), [first.id, third.id]); assert.equal(p.document.activeElement, link);
  p.values.set(key(third), "3"); p.dispatch("storage", { key: key(third) }); p.dispatch("pageshow", { persisted: true });
  assert.equal(p.document.activeElement, summary); assert.equal(panel.open, true);
  chooseProgress(control(p, first), 0);
  assert.equal(panel.hidden, true); assert.equal(p.document.activeElement, el(p, "tab-dashboard-label"));
});

test("DR4: import, reset and failed durable writes use effective progress without creating another record store", async () => {
  const [first, second] = tools;
  const p = await runPage({ search: "?tab=dashboard", storedValues: stored([second]), confirmResult: true });
  openPanel(p); const link = el(p, `resume-open-${second.id}`); link.focus();
  const value = JSON.stringify({ app: "hackinglab-online", schema_version: 1, saved_at: "2026-11-27T00:00:00.000Z", progress: { [first.id]: 1 } });
  el(p, "records-file").files = [{ size: Buffer.byteLength(value), text: async () => value }];
  await p.evaluate("handleRecordsImport()"); await p.flush();
  assert.deepEqual(ids(p), [first.id, second.id]); assert.equal(p.document.activeElement, link);
  assert.equal(el(p, "dashboard-resume").open, true);
  el(p, "reset-all-progress").focus(); el(p, "reset-all-progress").click(); await p.flush();
  assert.equal(el(p, "dashboard-resume").hidden, true);
  assert.equal(p.document.activeElement, el(p, "reset-all-progress"));
  const failed = await runPage({ search: "?tab=dashboard", storageFailure: "write" });
  chooseProgress(control(failed, first), 1);
  assert.deepEqual(ids(failed), [first.id]); assert.equal(failed.values.has(key(first)), false);
  assert.ok([...failed.values.keys()].every((name) => !name.includes("resume")));
});

test("DR5: record links preserve modified activation and navigate to progress with source/destination history and no progress writes", async () => {
  const tool = tools.find((item) => item.id === "day050");
  const p = await runPage({ search: "?tab=dashboard&book=genai-crypto&cat=classic-crypto&q=does-not-match", storedValues: stored([tool]), width: 320 });
  openPanel(p);
  const source = el(p, `resume-record-${tool.id}`), original = p.context.location.href, length = p.context.history.length, before = records(p);
  const writes = p.storageCalls.write;
  for (const modifier of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    const event = source.dispatch("click", modifier);
    assert.equal(event.defaultPrevented, !!modifier.defaultPrevented);
    assert.equal(p.context.location.href, original);
    assert.equal(p.storageCalls.write, writes);
  }
  source.focus(); const event = source.dispatch("click"); await p.flush();
  assert.equal(event.defaultPrevented, true);
  assert.equal(p.context.location.hash, `#${tool.id}`);
  assert.equal(p.document.activeElement, control(p, tool));
  assert.equal(p.context.history.length, length + 1);
  assert.equal(control(p, tool).value, "1"); assert.deepEqual(records(p), before);
  await p.back();
  assert.equal(p.context.location.href, original); assert.equal(p.document.activeElement, source);
  assert.equal(el(p, "dashboard-resume").open, true);
  await p.forward();
  assert.equal(p.document.activeElement, control(p, tool)); assert.deepEqual(records(p), before);
});

test("DR6: loading and error hide the resume control, recover visible focus, and safely render literal tool titles", async () => {
  const data = catalog(), tool = data.tools[0]; tool.title = '<img src=x onerror=alert(1)> & "quoted"';
  const p = await runPage({ search: "?tab=dashboard", storedValues: stored([tool]), dataOverrides: { "data/tools.json": data }, deferData: true });
  assert.equal(el(p, "dashboard-resume").hidden, true);
  await p.releaseData(); openPanel(p);
  const row = el(p, `resume-tool-${tool.id}`);
  assert.equal(row.querySelector("img"), null);
  assert.equal(row.querySelector(".resume-tool-title").textContent, `${tool.title} (Day${tool.id.slice(3)})`);
  el(p, `resume-open-${tool.id}`).focus(); p.evaluate('setLoadState("error")');
  assert.equal(el(p, "dashboard-resume").hidden, true);
  assert.equal(p.document.activeElement, el(p, "tab-dashboard-label"));
});

test("DR7: rejected README destinations never fall back to raw repository URLs; an empty demo destination uses only valid usage", async () => {
  const data = catalog(), unavailable = data.tools[0], fallback = data.tools[1];
  unavailable.demo_url = ""; unavailable.repo_url = "https://example.test/unrecognized-repository";
  const p = await runPage({ search: "?tab=dashboard", storedValues: stored([unavailable, fallback]), dataOverrides: { "data/tools.json": data } });
  openPanel(p);
  const link = el(p, `resume-open-${unavailable.id}`), before = records(p);
  assert.equal(link.hasAttribute("href"), false);
  assert.equal(link.getAttribute("aria-disabled"), "true");
  assert.equal(link.getAttribute("tabindex"), "-1");
  assert.equal(link.querySelector(".external-link-icon"), null);
  assert.equal(link.textContent, "リンクを利用できません");
  assert.doesNotMatch(link.getAttribute("aria-label"), /新しいタブ/);
  p.document.dispatch("click", { target: link, type: "click", button: 0 });
  assert.equal(p.values.has("hlo_recent_tools"), false);
  p.evaluate('HU.demoLink = () => ""; updateDashboardResume()');
  const usageLink = el(p, `resume-open-${fallback.id}`);
  assert.equal(usageLink.href, HU.readmeTarget(fallback.repo_url, "ja", fallback.readme_usage).href);
  assert.equal(usageLink.dataset.part, "repo");
  assert.equal(usageLink.textContent, "使い方を開く");
  assert.equal(usageLink.querySelectorAll(".external-link-icon").length, 1);
  el(p, "lang-en").click();
  assert.equal(link.textContent, "Link unavailable");
  assert.equal(link.hasAttribute("href"), false);
  el(p, `resume-record-${unavailable.id}`).dispatch("click"); await p.flush();
  assert.equal(p.document.activeElement, control(p, unavailable));
  assert.deepEqual(records(p), before);
});

test("DS1: start guidance requires at least one public tool and no public progress, independent of saved tools and filters", async () => {
  const data = catalog(), hidden = data.tools.at(-1); hidden.hub = false;
  for (const search of ["?tab=dashboard&q=no-match&maxDifficulty=1", "?tab=dashboard&book=genai-crypto", "?tools=day003"]) {
    const p = await runPage({ search, dataOverrides: { "data/tools.json": data }, storedValues: {
      [key(hidden)]: "3", later_day003: "1", later_day050: "1"
    } });
    assert.equal(el(p, "dashboard-start").hidden, false);
    assert.equal(el(p, "dashboard-start").closest("section").id, "dashboard-overall");
    assert.equal(el(p, "dashboard-resume").hidden, true);
    for (const level of [1, 2, 3]) {
      p.values.set(key(data.tools[0]), String(level)); p.dispatch("pageshow", { persisted: true });
      assert.equal(el(p, "dashboard-start").hidden, true, `public stage ${level} suppresses the initial invitation`);
      assert.equal(el(p, "dashboard-resume").hidden, level !== 1);
    }
    p.values.delete(key(data.tools[0])); p.dispatch("storage", { key: null }); p.dispatch("pageshow", { persisted: true });
    assert.equal(el(p, "dashboard-start").hidden, false);
  }
  for (const toolList of [[], data.tools.map((tool) => ({ ...tool, hub: false }))]) {
    const p = await runPage({ dataOverrides: { "data/tools.json": { ...data, tools: toolList } }, allowLoadFailure: true });
    assert.equal(el(p, "dashboard-start").hidden, true, "an empty public catalog is not a first-learning state");
  }
});

test("DS2: required loading and errors hide start guidance and rescue its focus; ready recovery restores it", async () => {
  const p = await runPage({ search: "?tab=dashboard", deferData: true });
  assert.equal(el(p, "dashboard-start").hidden, true);
  await p.releaseData();
  assert.equal(el(p, "dashboard-start").hidden, false);
  for (const state of ["loading", "error"]) {
    el(p, "dashboard-start-link").focus(); p.evaluate(`setLoadState("${state}")`);
    assert.equal(el(p, "dashboard-start").hidden, true);
    assert.equal(p.document.activeElement, el(p, "tab-dashboard-label"));
    p.evaluate('setLoadState("ready")');
    assert.equal(el(p, "dashboard-start").hidden, false);
  }
  const failed = await runPage({ search: "?tab=dashboard", dataFailures: { "data/tools.json": 500 }, allowLoadFailure: true });
  assert.equal(el(failed, "dashboard-start").hidden, true);
});

test("DS3: the normal discovery link keeps explicit language and anchor without intercepting navigation or writing progress", async () => {
  const p = await runPage({ search: "?tab=dashboard", storedValues: { later_day003: "1" } });
  const link = el(p, "dashboard-start-link"), before = records(p);
  assert.equal(link.href, "https://hackinglab.online/discover.html?lang=ja#day023");
  link.focus(); el(p, "lang-en").click();
  assert.equal(el(p, "dashboard-start-link"), link);
  assert.equal(p.document.activeElement, link);
  assert.equal(link.href, "https://hackinglab.online/discover.html?lang=en#day023");
  const writes = p.storageCalls.write;
  for (const modifier of [{}, { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { button: 1 }]) {
    assert.equal(link.dispatch("click", modifier).defaultPrevented, false);
  }
  assert.deepEqual(records(p), before); assert.equal(p.storageCalls.write, writes);
  assert.equal(link.hasAttribute("target"), false);
  assert.ok(read("discover.html").includes('id="day023"'));
});

test("DS4: cross-tab progress and pageshow update guidance, rescue only its removed focus, and keep resume closed", async () => {
  const p = await runPage({ search: "?tab=dashboard" });
  const panel = el(p, "dashboard-start"), link = el(p, "dashboard-start-link"), first = tools[0];
  link.focus(); p.values.set(key(first), "1"); p.dispatch("storage", { key: key(first) });
  await new Promise((resolve) => setTimeout(resolve, 120)); await p.flush();
  assert.equal(panel.hidden, true);
  assert.equal(p.document.activeElement, el(p, "dashboard-resume-summary"));
  assert.equal(el(p, "dashboard-resume").open, false);
  p.values.delete(key(first)); p.dispatch("pageshow", { persisted: true });
  assert.equal(panel.hidden, false);
  link.focus(); p.values.set(key(first), "2"); p.dispatch("pageshow", { persisted: true });
  assert.equal(panel.hidden, true); assert.equal(p.document.activeElement, el(p, "tab-dashboard-label"));
  p.values.delete(key(first)); p.dispatch("pageshow", { persisted: true });
  el(p, "records-export").focus(); p.values.set(key(first), "3"); p.dispatch("pageshow", { persisted: true });
  assert.equal(panel.hidden, true); assert.equal(p.document.activeElement, el(p, "records-export"));
});

test("DS5: explicit imports and resets synchronize the initial invitation, including memory-only progress", async () => {
  const p = await runPage({ search: "?tab=dashboard", confirmResult: true });
  const value = JSON.stringify({ app: "hackinglab-online", schema_version: 2, saved_at: "2026-11-28T00:00:00.000Z", progress: { day003: 1 }, try_later: ["day050"] });
  el(p, "dashboard-start-link").focus();
  el(p, "records-file").files = [{ size: Buffer.byteLength(value), text: async () => value }];
  await p.evaluate("handleRecordsImport()"); await p.flush();
  assert.equal(el(p, "dashboard-start").hidden, true);
  assert.equal(p.document.activeElement, el(p, "dashboard-resume-summary"));
  assert.equal(el(p, "dashboard-resume").open, false);
  el(p, "reset-all-progress").focus(); el(p, "reset-all-progress").click(); await p.flush();
  assert.equal(el(p, "dashboard-start").hidden, false);
  assert.equal(p.values.get("later_day050"), "1");
  assert.equal(p.document.activeElement, el(p, "reset-all-progress"));
  const failed = await runPage({ search: "?tab=dashboard", storageFailure: "write" });
  chooseProgress(control(failed, tools[0]), 1);
  assert.equal(el(failed, "dashboard-start").hidden, true);
  assert.equal(failed.values.has(key(tools[0])), false);
});

test("DS6: returning through tab history preserves the current language and reflects progress changed since the visit", async () => {
  const p = await runPage({ search: "?tab=dashboard", confirmResult: true });
  const link = el(p, "dashboard-start-link"); link.focus();
  el(p, "tab-tools-label").click(); await p.flush();
  chooseProgress(control(p, tools[0]), 1);
  el(p, "lang-en").click();
  await p.back();
  assert.equal(el(p, "tab-dashboard").hidden, false);
  assert.equal(el(p, "dashboard-start").hidden, true);
  assert.equal(link.href, "https://hackinglab.online/discover.html?lang=en#day023");
  assert.equal(p.document.activeElement, el(p, "tab-dashboard-label"));
  await p.forward();
  chooseProgress(control(p, tools[0]), 0);
  await p.back();
  assert.equal(el(p, "dashboard-start").hidden, false);
  assert.equal(link.href, "https://hackinglab.online/discover.html?lang=en#day023");
  assert.equal(p.document.activeElement, link);
});
