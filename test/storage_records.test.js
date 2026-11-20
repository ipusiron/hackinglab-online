"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createSafeStorage } = require("../js/storage.js");
const { runPage, read } = require("./helpers/page.js");
const catalog = JSON.parse(read("data/tools.json")).tools;
const [first, second, third] = catalog;
const key = (tool) => `progress_${tool.slug}`;
const id = (page, name) => page.document.getElementById(name);
const level = (page, tool) => page.evaluate(`getProgress(${JSON.stringify(tool.slug)})`);
const file = (progress, other = {}) => JSON.stringify({ app: "hackinglab-online", schema_version: 1, saved_at: "2026-11-07T00:00:00.000Z", progress, ...other });
async function restore(page, text, size = Buffer.byteLength(text)) {
  const input = id(page, "records-file"); input.files = [{ size, text: async () => text }];
  await page.evaluate("handleRecordsImport()"); await page.flush();
}
function writeProgress(page, tool, value) { page.evaluate(`setProgress(${JSON.stringify(tool.slug)},${value}); refreshProgressViews();`); }

const laterKey = (tool) => `later_${tool.id}`;
const later = (page, tool) => page.document.querySelector(`.tool-later-toggle[data-tool-id="${tool.id}"]`);
const savedOnly = (page, checked = true) => { const filter = id(page, "filter-later"); filter.checked = checked; filter.dispatch("change"); };
const laterFile = (progress, ids) => file(progress, { schema_version: 2, try_later: ids });
function savedCount(page, count, language = "ja") {
  const label = id(page, "filter-later-count");
  assert.equal(label.hidden, false);
  assert.equal(label.textContent, language === "ja" ? `（保存${count}本）` : `(${count} saved)`);
}

test("TL1: saved-only composes with search, keeps progress separate and never changes the URL", async () => {
  const page = await runPage();
  savedCount(page, 0);
  const originalUrl = page.evaluate("location.href");
  const button = later(page, first); button.focus(); button.click();
  assert.equal(button.getAttribute("aria-pressed"), "true");
  assert.equal(page.values.get(laterKey(first)), "1");
  assert.equal(level(page, first), 0);
  savedCount(page, 1);
  savedOnly(page);
  assert.deepEqual(page.document.querySelectorAll(".tool-card").map((card) => card.dataset.toolId), [first.id]);
  assert.equal(page.evaluate("location.href"), originalUrl);
  const input = id(page, "filter-search-input"); input.value = second.id; input.dispatch("input");
  assert.equal(page.document.querySelectorAll(".tool-card").length, 0);
  savedCount(page, 1);
  assert.match(id(page, "tool-list").textContent, /条件に合うツールはありません/);
  assert.doesNotMatch(id(page, "tool-list").textContent, /追加したツールがありません/);
  id(page, "clear-filters").click();
  assert.equal(id(page, "filter-later").checked, false);
  assert.equal(later(page, first).getAttribute("aria-pressed"), "true");
  savedCount(page, 1);
});

test("TL2: removing a saved chapter tool retains focused duplicate cards and language rebuild restores the toggle", async () => {
  const page = await runPage({ search: "?book=genai-crypto" });
  const cards = page.document.querySelectorAll(".tool-card");
  const target = cards.find((card) => cards.filter((other) => other.dataset.toolId === card.dataset.toolId).length > 1);
  const tool = catalog.find((item) => item.id === target.dataset.toolId);
  later(page, tool).click(); savedOnly(page);
  const kept = page.document.querySelectorAll(".tool-card");
  assert.ok(kept.length > 1); savedCount(page, 1);
  const control = kept.at(-1).querySelector(".tool-later-toggle"); control.focus(); control.click();
  assert.equal(page.document.activeElement, control);
  assert.deepEqual(page.document.querySelectorAll(".tool-card"), kept);
  savedCount(page, 0);
  for (const card of kept) {
    assert.equal(card.querySelector(".tool-later-toggle").getAttribute("aria-pressed"), "false");
    assert.equal(card.classList.contains("is-outside"), true);
    assert.match(card.querySelector(".tool-outside-label").textContent, /解除済み/);
  }
  id(page, "lang-en").click();
  assert.equal(page.document.activeElement.dataset.part, "later");
  assert.equal(page.document.activeElement.closest(".tool-card").dataset.group, kept.at(-1).dataset.group);
  assert.match(page.document.querySelector(".tool-outside-label").textContent, /Removed from Try later/);
  savedCount(page, 0, "en");
});

test("TL3: bookmark-only export works and progress reset preserves saved tools", async () => {
  const page = await runPage({ confirmResult: true, storedValues: { [laterKey(first)]: "1", [key(first)]: "2" } });
  id(page, "reset-all-progress").click();
  assert.equal(level(page, first), 0);
  assert.equal(page.values.get(laterKey(first)), "1");
  savedCount(page, 1);
  id(page, "records-export").click();
  const data = JSON.parse(await page.downloads[0].blob.text());
  assert.equal(data.schema_version, 2);
  assert.deepEqual(data.progress, {});
  assert.deepEqual(data.try_later, [first.id]);
  assert.match(id(page, "records-status").textContent, /^1本/);
});

test("TL4: bookmark restore is additive, counts each tool once and accepts legacy progress files", async () => {
  const page = await runPage({ confirmResult: true, storedValues: { [laterKey(third)]: "1" } });
  await restore(page, laterFile({ [first.id]: 2 }, [first.id, second.id]));
  for (const tool of [first, second, third]) assert.equal(page.values.get(laterKey(tool)), "1");
  assert.equal(level(page, first), 2);
  assert.match(page.confirmations[0], /2本の記録/);
  assert.equal(id(page, "records-status").textContent, "2本の記録をファイルから戻しました。");
  savedCount(page, 3);
  await restore(page, file({ [second.id]: 1 }));
  assert.equal(page.values.get(laterKey(third)), "1");
  savedCount(page, 3);
});

test("TL5: failed bookmark removal stays authoritative through storage clear and file export", async () => {
  const page = await runPage({ storageFailure: "write", storedValues: { [laterKey(first)]: "1", [laterKey(second)]: "1" } });
  later(page, first).click();
  assert.equal(id(page, "storage-warning").hidden, false);
  assert.equal(page.values.get(laterKey(first)), "1");
  page.dispatch("storage", { key: null }); page.evaluate("refreshProgressViews()");
  assert.equal(later(page, first).getAttribute("aria-pressed"), "false");
  savedCount(page, 1);
  id(page, "records-export").click();
  const data = JSON.parse(await page.downloads[0].blob.text());
  assert.deepEqual(data.try_later, [second.id]);
});

test("TL6: cross-tab additions refresh an empty saved list and move lost empty-control focus to its filter", async () => {
  const page = await runPage(); savedOnly(page);
  id(page, "clear-filters").focus();
  page.values.set(laterKey(first), "1"); page.dispatch("storage", { key: laterKey(first) });
  page.evaluate("refreshProgressViews()");
  assert.equal(later(page, first).getAttribute("aria-pressed"), "true");
  assert.equal(page.document.activeElement, id(page, "filter-later"));
  savedCount(page, 1);
});

test("TL7: confirmation rechecks bookmarks, skips candidates added elsewhere and does not restore removed non-candidates", async () => {
  const page = await runPage({ storedValues: { [laterKey(second)]: "1" }, confirmResult: (_, disk) => {
    disk.set(laterKey(first), "1"); disk.set(laterKey(second), "0"); return true;
  } });
  await restore(page, laterFile({}, [first.id, second.id, third.id]));
  assert.equal(page.values.get(laterKey(first)), "1");
  assert.equal(page.values.get(laterKey(second)), "0");
  assert.equal(page.values.get(laterKey(third)), "1");
  assert.equal(id(page, "records-status").textContent, "1本の記録をファイルから戻しました。");
  savedCount(page, 2);
});

test("TL8: revoked bookmark reads after confirmation retain import in memory without writing unknown disk state", async () => {
  let blocked = false;
  const page = await runPage({ confirmResult: () => { blocked = true; return true; }, storageHooks: { read(k) { if (blocked && k.startsWith("later_")) throw Error("revoked"); } } });
  const before = page.storageCalls.write;
  await restore(page, laterFile({}, [first.id]));
  assert.equal(page.storageCalls.write, before);
  assert.equal(later(page, first).getAttribute("aria-pressed"), "true");
  assert.equal(id(page, "storage-warning").hidden, false);
  savedCount(page, 1);
});

test("TL9: a valid set clears saved-only and explicit see-all clears it without deleting bookmarks", async () => {
  const page = await runPage({ storedValues: { [laterKey(first)]: "1" } }); savedOnly(page);
  id(page, "start-all-button").click();
  assert.equal(id(page, "filter-later").checked, false);
  assert.equal(later(page, first).getAttribute("aria-pressed"), "true");
  page.evaluate(`filters.later = true; history.replaceState(null, "", "?tools=${second.id}"); applyToolLinks(false); setupFilterOptions(); renderToolList();`);
  assert.equal(id(page, "filter-later").checked, false);
  assert.deepEqual(page.document.querySelectorAll(".tool-card").map((card) => card.dataset.toolId), [second.id]);
  savedCount(page, 1);
});

test("TL10: explicit restore overrides a dirty removal even if older durable state was already saved", async () => {
  const page = await runPage({ confirmResult: true, storageFailure: "write", storedValues: { [laterKey(first)]: "1" } });
  later(page, first).click();
  assert.equal(later(page, first).getAttribute("aria-pressed"), "false");
  savedCount(page, 0);
  await restore(page, laterFile({}, [first.id]));
  assert.equal(page.confirmations.length, 1);
  assert.equal(later(page, first).getAttribute("aria-pressed"), "true");
  assert.equal(id(page, "records-status").textContent, "1本の記録をファイルから戻しました。");
  savedCount(page, 1);
});

test("TL11: returning from dashboard refreshes saved-only additions without background replacement", async () => {
  const page = await runPage({ confirmResult: true, storedValues: { [laterKey(first)]: "1" } }); savedOnly(page);
  const firstCard = page.document.querySelector(".tool-card");
  id(page, "tab-dashboard-label").click();
  await restore(page, laterFile({}, [second.id]));
  assert.equal(page.document.querySelector(".tool-card"), firstCard);
  savedCount(page, 2);
  id(page, "tab-tools-label").click();
  assert.deepEqual(page.document.querySelectorAll(".tool-card").map((card) => card.dataset.toolId), [first.id, second.id]);
});

test("TL12: saved total ignores hidden and unknown IDs and invalid flags, regardless of active filters", async () => {
  const hidden = { ...first, id: "day998", slug: "hidden-count-test", title: "Hidden fixture", hub: false };
  const source = JSON.parse(read("data/tools.json")); source.tools.push(hidden);
  const page = await runPage({ search: `?q=${second.id}`, dataOverrides: { "data/tools.json": source },
    storedValues: { [laterKey(first)]: "1", [laterKey(second)]: "true", [laterKey(third)]: "01", [laterKey(hidden)]: "1", later_day999: "1" } });
  savedCount(page, 1);
  assert.deepEqual(page.document.querySelectorAll(".tool-card").map(card => card.dataset.toolId), [second.id]);
  savedOnly(page); assert.equal(page.document.querySelectorAll(".tool-card").length, 0); savedCount(page, 1);
  id(page, "lang-en").click(); savedCount(page, 1, "en");
});

test("TL13: saved total waits for required data, recovers after retry and survives optional book failure", async () => {
  const storedValues = { [laterKey(first)]: "1" };
  const pending = await runPage({ deferData: true, storedValues });
  assert.equal(id(pending, "filter-later-count").hidden, true);
  await pending.releaseData(); savedCount(pending, 1);
  const failed = await runPage({ storedValues, allowLoadFailure: true,
    fetchResponse(name, _, attempt) { if(name === "data/tools.json" && attempt === 1) return { ok: false, status: 503 }; } });
  assert.equal(id(failed, "main-content").dataset.loadState, "error");
  assert.equal(id(failed, "filter-later-count").hidden, true);
  id(failed, "retry-data").click(); await failed.flush(); savedCount(failed, 1);
  const optional = await runPage({ storedValues, dataFailures: { "data/books.json": 503 } }); savedCount(optional, 1);
});

test("TL14: storage and restored-page events update the global count without changing focus, cards or navigation", async () => {
  let sequence = 0; const timers = new Map();
  const clock = { setTimeout(fn, delay) { const token = ++sequence; timers.set(token, { fn, delay }); return token; }, clearTimeout(token) { timers.delete(token); } };
  const page = await runPage({ clock, search: `?q=${second.id}`, storedValues: { [laterKey(first)]: "1" } });
  const filter = id(page, "filter-later"), label = id(page, "filter-later-count"), cards = page.document.querySelectorAll(".tool-card");
  const href = page.context.location.href, length = page.context.history.length; filter.focus();
  page.values.set(laterKey(third), "1"); page.dispatch("storage", { key: laterKey(third) });
  const sync = [...timers].find(([, timer]) => timer.delay === 100); assert.ok(sync);
  timers.delete(sync[0]); sync[1].fn(); await page.flush(); savedCount(page, 2);
  page.values.delete(laterKey(first)); page.dispatch("pageshow", { persisted: true }); savedCount(page, 1);
  page.values.clear(); page.dispatch("storage", { key: null });
  page.document.hidden = false; page.document.dispatch("visibilitychange"); savedCount(page, 0);
  assert.deepEqual(page.document.querySelectorAll(".tool-card"), cards);
  assert.equal(page.context.location.href, href); assert.equal(page.context.history.length, length);
  id(page, "lang-en").click(); savedCount(page, 0, "en");
  assert.equal(id(page, "filter-later"), filter); assert.equal(id(page, "filter-later-count"), label);
  assert.equal(page.document.activeElement, filter);
  assert.equal(page.context.history.length, length);
});

test("SR1: failed write stays ahead of old disk value and export can read it", () => {
  const disk = new Map([["progress_a", "1"]]); let reject = true;
  const storage = createSafeStorage(() => ({ getItem: (k) => disk.get(k) ?? null, setItem(k, v) { if (reject) throw Error("quota"); disk.set(k, v); } }));
  assert.equal(storage.setItem("progress_a", "2"), false);
  assert.equal(storage.getItem("progress_a"), "2");
  assert.deepEqual(storage.readFresh("progress_a"), { ok: true, value: "1" });
  disk.clear(); storage.invalidate(null);
  assert.equal(storage.getItem("progress_a"), "2");
  reject = false; assert.equal(storage.setItem("progress_a", "0"), true);
  assert.equal(storage.getItem("progress_a"), "0");
});

test("SR2: successful read null cannot resurrect a clean cached value, and event invalidates clean cache", () => {
  const disk = new Map(); let failRead = false;
  const storage = createSafeStorage(() => ({ getItem(k) { if (failRead) throw Error("read"); return disk.get(k) ?? null; }, setItem(k, v) { disk.set(k, v); } }));
  storage.setItem("progress_a", "3"); disk.clear();
  assert.equal(storage.getItem("progress_a"), null);
  storage.setItem("progress_a", "2"); storage.invalidate("progress_a"); failRead = true;
  assert.equal(storage.getItem("progress_a"), null);
});

test("SR3: memory-only import never writes disk and notification exceptions do not escape", () => {
  let writes = 0;
  const storage = createSafeStorage(() => ({ getItem() { throw Error("read"); }, setItem() { writes++; } }), () => { throw Error("UI"); });
  assert.deepEqual(storage.readFresh("progress_a"), { ok: false, value: null });
  storage.setMemory("progress_a", 2);
  assert.equal(storage.getItem("progress_a"), "2"); assert.equal(writes, 0);
});

test("SR4: download is local JSON for known nonzero progress and starts before the date is recorded", async () => {
  const page = await runPage({ storedValues: { [key(first)]: "2", [key(second)]: "1", progress_unknown: "3" }, search: "?tab=dashboard&lang=en" });
  const button = id(page, "records-export"); button.focus(); button.click();
  assert.equal(page.downloads.length, 1);
  assert.match(page.downloads[0].filename, /^hackinglab-records-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(await page.downloads[0].blob.text());
  assert.equal(data.app, "hackinglab-online"); assert.equal(data.schema_version, 2);
  assert.deepEqual(data.progress, { [first.id]: 2, [second.id]: 1 });
  assert.equal(page.values.get("hlo_records_last_export"), data.saved_at);
  assert.equal(id(page, "records-status").textContent, "Saved records for 2 tools to a file.");
  assert.equal(page.document.activeElement, button);
  assert.ok(page.fetched.every((url) => url.startsWith("data/")));
});

test("SR5: all-zero export and API exceptions create no success or saved date", async () => {
  const empty = await runPage(); id(empty, "records-export").click();
  assert.equal(empty.downloads.length, 0); assert.equal(empty.values.has("hlo_records_last_export"), false);
  assert.equal(id(empty, "records-status").textContent, "保存する記録はありません。進捗や「あとで試す」を付けると保存できます。");
  for (const downloadFailure of ["create", "click"]) {
    const page = await runPage({ downloadFailure, storedValues: { [key(first)]: "1" }, search: "?tab=dashboard" });
    const button = id(page, "records-export"); button.focus(); button.click();
    assert.equal(page.downloads.length, 0); assert.equal(page.values.has("hlo_records_last_export"), false);
    assert.equal(id(page, "records-status").textContent, ""); assert.equal(button.disabled, false);
    assert.equal(page.document.activeElement, button);
  }
});

test("SR6: write denial shows one dismissible notice, preserves dirty progress across clear and rescues it via file", async () => {
  const page = await runPage({ storageFailure: "write", storedValues: { [key(first)]: "1" }, search: "?tab=dashboard" });
  writeProgress(page, first, 2); assert.equal(level(page, first), 2);
  assert.equal(id(page, "storage-warning").hidden, false);
  assert.match(id(page, "record-location").textContent, /保存できないため/);
  const close = id(page, "storage-warning-close"); close.focus(); close.click();
  writeProgress(page, second, 3); assert.equal(id(page, "storage-warning").hidden, true);
  page.values.clear(); page.dispatch("storage", { key: null });
  page.evaluate("refreshProgressViews()"); assert.equal(level(page, first), 2);
  id(page, "records-export").click();
  const text = await page.downloads[0].blob.text();
  const next = await runPage({ confirmResult: true }); await restore(next, text);
  assert.equal(level(next, first), 2); assert.equal(level(next, second), 3);
});

test("SR7: storage explanation opens its heading and closes back to the notice control", async () => {
  const page = await runPage({ storageFailure: "write" }); writeProgress(page, first, 1);
  const help = id(page, "storage-warning-help"); help.focus(); help.click();
  assert.equal(id(page, "help-modal").hidden, false);
  assert.equal(page.document.activeElement, id(page, "help-storage"));
  page.document.dispatch("keydown", { key: "Escape" });
  assert.equal(page.document.activeElement, help);
});

test("SR8: invalid/oversized/new-format files validate before writing or confirming", async () => {
  const page = await runPage({ confirmResult: true });
  for (const text of ["no JSON", file({ [first.id]: 9 }), file({ __proto__: 1 }, { extra: true }), file({ [first.id]: 2 }, { saved_at: "not a date" })]) {
    const before = page.storageCalls.write; await restore(page, text);
    assert.equal(page.storageCalls.write, before); assert.equal(page.confirmations.length, 0);
    assert.match(id(page, "records-status").textContent, /このファイルは読めません/);
  }
  let reads = 0; id(page, "records-file").files = [{ size: 65537, text: async () => { reads++; return "{}"; } }];
  await page.evaluate("handleRecordsImport()"); assert.equal(reads, 0);
  await restore(page, file({}, { schema_version: 3 }));
  assert.match(id(page, "records-status").textContent, /新しい形式/);
});

test("SR9: same/older or unknown-only files do not confirm, cancel leaves progress unchanged", async () => {
  const page = await runPage({ storedValues: { [key(first)]: "3" }, confirmResult: false });
  await restore(page, file({ [first.id]: 2, day999: 3 }));
  assert.equal(page.confirmations.length, 0); assert.equal(level(page, first), 3);
  await restore(page, file({ [second.id]: 2 }));
  assert.equal(page.confirmations.length, 1); assert.equal(level(page, second), 0);
});

test("SR10: confirmation rechecks latest disk and never adds a new candidate", async () => {
  const page = await runPage({ storedValues: { [key(second)]: "3" }, confirmResult: (_, disk) => {
    disk.set(key(first), "3"); disk.set(key(second), "0"); return true;
  } });
  await restore(page, file({ [first.id]: 2, [second.id]: 2, [third.id]: 1 }));
  assert.equal(page.confirmations.length, 1);
  assert.equal(level(page, first), 3); assert.equal(level(page, second), 0); assert.equal(level(page, third), 1);
  assert.equal(id(page, "records-status").textContent, "1本の記録をファイルから戻しました。");
});

test("SR11: unreadable durable values import into memory only, without lowering hidden disk progress", async () => {
  const page = await runPage({ storedValues: { [key(first)]: "3" }, storageFailure: "read", confirmResult: true });
  const writes = page.storageCalls.write;
  await restore(page, file({ [first.id]: 1 }));
  assert.equal(page.storageCalls.write, writes); assert.equal(page.values.get(key(first)), "3");
  assert.equal(level(page, first), 1); assert.equal(id(page, "storage-warning").hidden, false);
  id(page, "records-export").click();
  assert.equal(JSON.parse(await page.downloads[0].blob.text()).progress[first.id], 1);
});

test("SR12: partial import writes retain all applied values and report actual count", async () => {
  const page = await runPage({ confirmResult: true, storageHooks: { write(k) { if (k === key(second)) throw Error("quota"); } } });
  await restore(page, file({ [first.id]: 1, [second.id]: 2, [third.id]: 3 }));
  assert.equal(page.values.get(key(first)), "1"); assert.equal(page.values.has(key(second)), false); assert.equal(page.values.get(key(third)), "3");
  assert.equal(level(page, second), 2);
  assert.equal(id(page, "records-status").textContent, "3本の記録をファイルから戻しました。");
  assert.equal(id(page, "storage-warning").hidden, false);
});

test("SR13: import is single-flight, uses latest language, and does not steal focus after navigation", async () => {
  const page = await runPage({ confirmResult: true, search: "?tab=dashboard" });
  let release; let reads = 0;
  const promise = new Promise((resolve) => { release = resolve; });
  const input = id(page, "records-file"); input.files = [{ size: 200, text: () => { reads++; return promise; } }];
  id(page, "records-import").focus();
  const pending = page.evaluate("handleRecordsImport()"); await page.evaluate("handleRecordsImport()");
  assert.equal(reads, 1); assert.equal(id(page, "records-import").disabled, true);
  id(page, "lang-en").click(); id(page, "tab-tools-label").focus(); id(page, "tab-tools-label").click();
  release(file({ [first.id]: 1 })); await pending; await page.flush();
  assert.match(page.confirmations[0], /^This will restore records for 1 tool/);
  assert.equal(page.document.activeElement, id(page, "tab-tools-label"));
  assert.equal(id(page, "records-import").disabled, false); assert.equal(input.value, "");
});

test("SR14: records stay disabled until catalog ready and after required failure", async () => {
  const page = await runPage({ deferData: true });
  assert.equal(id(page, "records-export").disabled, true);
  await page.releaseData(); assert.equal(id(page, "records-export").disabled, false);
  const failed = await runPage({ dataFailures: { "data/tools.json": 503 }, allowLoadFailure: true });
  assert.equal(id(failed, "records-import").disabled, true);
});

test("SR15: language change preserves results and first-warning dismissal", async () => {
  const page = await runPage({ storageFailure: "write" }); writeProgress(page, first, 1);
  id(page, "storage-warning-close").click(); id(page, "records-export").click(); id(page, "lang-en").click();
  assert.equal(id(page, "records-status").textContent, "Saved records for 1 tool to a file.");
  assert.equal(id(page, "storage-warning").hidden, true);
  assert.match(id(page, "record-location").querySelector(".label-en").textContent, /can't save your records/);
});

test("SR16: read access lost during confirmation uses memory only and preserves durable data", async () => {
  let blocked = false;
  const page = await runPage({ confirmResult: (_, disk) => { disk.set(key(first), "3"); blocked = true; return true; }, storageHooks: { read(k) { if (blocked && k.startsWith("progress_")) throw Error("revoked"); } } });
  const before = page.storageCalls.write;
  await restore(page, file({ [first.id]: 2 }));
  assert.equal(page.storageCalls.write, before); assert.equal(page.values.get(key(first)), "3");
  assert.equal(level(page, first), 2); assert.equal(id(page, "storage-warning").hidden, false);
});

test("SR17: restored progress synchronizes chapter duplicates and outside count without rebuilding cards", async () => {
  const page = await runPage({ search: "?book=genai-crypto", confirmResult: true });
  id(page, "filter-progress").value = "0"; id(page, "filter-progress").dispatch("change");
  const cards = page.document.querySelectorAll(".tool-card");
  const target = cards.find((card) => cards.filter((other) => other.dataset.toolId === card.dataset.toolId).length > 1);
  await restore(page, file({ [target.dataset.toolId]: 2 }));
  assert.deepEqual(page.document.querySelectorAll(".tool-card"), cards);
  for (const copy of cards.filter((card) => card.dataset.toolId === target.dataset.toolId)) {
    assert.equal(copy.querySelector('[data-part="progress"]').value, "2");
    assert.equal(copy.querySelector(".tool-outside-label").hidden, false);
  }
  assert.match(id(page, "list-count").textContent, /（1本は条件外）$/);
});

test("SR18: object URLs survive initiation and are revoked at the scheduled one-second cleanup", async () => {
  let seq = 0; const timers = new Map();
  const clock = { setTimeout(fn, delay) { timers.set(++seq, { fn, delay }); return seq; }, clearTimeout(token) { timers.delete(token); } };
  const page = await runPage({ clock, storedValues: { [key(first)]: "1" } });
  id(page, "records-export").click(); assert.equal(page.revokedUrls.length, 0);
  const cleanup = [...timers.values()].filter((timer) => timer.delay === 1000);
  assert.equal(cleanup.length, 1); cleanup[0].fn();
  assert.deepEqual(page.revokedUrls, [page.downloads[0].href]);
  assert.equal(page.document.querySelectorAll('a[download]').length, 0);
});

test("SR19: one operation produces one final live-text mutation, and close after initial read failure returns to a visible tab", async () => {
  const page = await runPage({ storedValues: { [key(first)]: "1" }, search: "?tab=dashboard" });
  const status = id(page, "records-status");
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(status), "textContent");
  let writes = 0;
  Object.defineProperty(status, "textContent", { get() { return descriptor.get.call(this); }, set(value) { writes++; descriptor.set.call(this, value); } });
  id(page, "records-export").click();
  assert.equal(writes, 1); page.evaluate("updateRecordsUI(); renderDashboard(); updateRecordsUI();"); assert.equal(writes, 1);
  const readFailure = await runPage({ storageFailure: "getter" });
  const close = id(readFailure, "storage-warning-close"); close.focus(); close.click();
  assert.equal(readFailure.document.activeElement, id(readFailure, "tab-tools-label"));
});


test("SR20: backup covers the public catalog independently of active filters and ignores hidden catalog records", async () => {
  const hidden = { ...first, id: "day998", slug: "hidden-record-test", title: "Hidden fixture", hub: false };
  const source = JSON.parse(read("data/tools.json")); source.tools.push(hidden);
  const page = await runPage({ search: `?q=${first.id}&tools=${first.id}`, dataOverrides: { "data/tools.json": source }, storedValues: { [key(hidden)]: "3", [key(first)]: "1", [key(second)]: "2" }, confirmResult: true });
  id(page, "records-export").click();
  assert.deepEqual(JSON.parse(await page.downloads[0].blob.text()).progress, { [first.id]: 1, [second.id]: 2 });
  const before = page.storageCalls.write;
  await restore(page, file({ [hidden.id]: 3 }));
  assert.equal(page.storageCalls.write, before); assert.equal(page.confirmations.length, 0);
  await restore(page, file({ [first.id]: 2 }));
  assert.equal(page.confirmations.length, 1);
  assert.match(page.confirmations[0], /進んでいる1本の進捗は/);
  assert.equal(page.values.get(key(hidden)), "3");
});

test("SR21: two task opportunities expose both queued durable updates before candidate-only recheck", async () => {
  const observations = [];
  let page;
  page = await runPage({ search: "?tab=dashboard", storedValues: { [key(first)]: "1", [key(second)]: "1", [key(third)]: "3" }, confirmResult: (_, disk) => {
    observations.push(["sync", disk.get(key(first)), disk.get(key(second))]);
    setTimeout(() => {
      disk.set(key(first), "3");
      observations.push(["first-task", disk.get(key(first)), disk.get(key(second))]);
      assert.equal(id(page, "records-import").disabled, true);
      setTimeout(() => { disk.set(key(second), "3"); disk.delete(key(third)); observations.push(["second-task", disk.get(key(first)), disk.get(key(second))]); }, 0);
    }, 0);
    return true;
  } });
  const writes = page.storageCalls.write;
  const button = id(page, "records-import"); button.focus();
  await restore(page, file({ [first.id]: 2, [second.id]: 2, [third.id]: 2 }));
  assert.deepEqual(observations, [["sync", "1", "1"], ["first-task", "3", "1"], ["second-task", "3", "3"]]);
  assert.equal(page.storageCalls.write, writes, "Both original candidates became unnecessary; do not overwrite either one");
  assert.equal(level(page, first), 3); assert.equal(level(page, second), 3);
  assert.equal(level(page, third), 0, "A newly eligible record was not in the confirmed candidates");
  assert.equal(page.confirmations.length, 1); assert.equal(id(page, "records-status").textContent, "戻す記録はありません。進捗はファイルと同じか、それより進んでいて、「あとで試す」も追加済みです。");
  assert.equal(button.disabled, false); assert.equal(page.document.activeElement, button);
});

test("SR22: delayed partial read failure stays memory-only while busy and post-confirm navigation retains focus", async () => {
  let blocked = false; let page; let duplicateAttempt;
  page = await runPage({ search: "?tab=dashboard", storedValues: { [key(first)]: "1", [key(second)]: "1" }, storageHooks: {
    read(k) { if (blocked && k === key(second)) throw Error("Storage read access revoked"); }
  }, confirmResult: (_, disk) => {
    setTimeout(() => {
      disk.set(key(first), "3");
      assert.equal(id(page, "records-import").disabled, true);
      duplicateAttempt = page.evaluate("handleRecordsImport()");
      setTimeout(() => {
        blocked = true;
        id(page, "tab-tools-label").focus(); id(page, "tab-tools-label").click();
      }, 0);
    }, 0);
    return true;
  } });
  const writes = page.storageCalls.write;
  id(page, "records-import").focus();
  await restore(page, file({ [first.id]: 2, [second.id]: 2 })); await duplicateAttempt;
  assert.equal(page.confirmations.length, 1); assert.equal(page.storageCalls.write, writes);
  assert.equal(page.values.get(key(first)), "3"); assert.equal(page.values.get(key(second)), "1");
  assert.equal(level(page, second), 2); assert.equal(id(page, "storage-warning").hidden, false);
  assert.equal(id(page, "records-status").textContent, "1本の記録をファイルから戻しました。");
  assert.equal(page.document.activeElement, id(page, "tab-tools-label"));
  assert.equal(id(page, "records-import").disabled, false);
});
