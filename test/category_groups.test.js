"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const CG = require("../js/category_groups.js");
const ROOT = path.resolve(__dirname, "..");
const json = (name) => JSON.parse(fs.readFileSync(path.join(ROOT, name), "utf8"));

test("CG1 shared Python/JavaScript metadata rejection matrix", () => {
  for (const fixture of json("test/fixtures/category_metadata.json")) {
    if (fixture.valid) assert.doesNotThrow(() => CG.validateGroups(fixture.groups, fixture.categories), fixture.name);
    else assert.throws(() => CG.validateGroups(fixture.groups, fixture.categories), fixture.name);
  }
});

test("CG2 published mapping preserves previous labels and exact ignored names", () => {
  const categories = json("data/categories.json");
  const data = json("data/category_groups.json");
  const result = CG.validateGroups(data, categories);
  const { maps } = CG.validateCategories(categories);
  assert.equal(categories.length, 55);
  assert.equal(result.groups.length, 7);
  assert.equal(result.descriptions.size, 21);
  assert.equal(result.ignored.ja.size, 18);
  assert.equal(result.ignored.en.size, 18);
  assert.equal(maps.ja.get("学習支援"), "machine-learning");
  assert.equal(maps.en.get("Learning Support"), "machine-learning");
  for (const [oldName, newName, id] of [
    ["Classical cryptography", "Classical Cryptography", "classic-crypto"],
    ["Modern cryptography", "Modern Cryptography", "modern-crypto"],
    ["Substitution cipher", "Substitution Cipher", "substitution-cipher"],
    ["Transposition cipher", "Transposition Cipher", "transposition-cipher"]
  ]) {
    assert.equal(maps.en.get(oldName), id);
    assert.equal(categories.find((c) => c.id === id).en, newName);
  }
  assert.equal(maps.en.get("phishing"), "phishing");
  for (const name of ["Network", "Classic Cryptography", "Lock Picking", "Prepper", "simulator", "Simulator "]) {
    assert.equal(result.ignored.en.has(name), false);
    assert.equal(maps.en.has(name), false);
  }
  assert.equal(result.ignored.ja.has("Simulator"), false);
  assert.equal(result.ignored.en.has("Simulator"), true);
  assert.equal(result.groups.some((g) => g.category_ids.includes("visualization")), false);
});

const { runPage, read, chooseProgress } = require("./helpers/page.js");
const U = require("../js/url.js");
const catalog = json("data/tools.json");
const definitions = json("data/categories.json");
const metadata = json("data/category_groups.json");
const tools = catalog.tools.filter((t) => t.hub !== false);
const el = (p, id) => p.document.getElementById(id);
const cards = (p) => el(p, "tool-list").querySelectorAll(".tool-card");
const shown = (p) => [...new Set(cards(p).map((c) => c.dataset.toolId))];
const change = (p, id, value) => { const node = el(p, id); node.value = value; node.dispatch("change"); };
const search = (p, value) => { const input = el(p, "filter-search-input"); input.value = value; input.dispatch("input"); };
function fakeClock() {
  let now = 0, id = 0; const pending = new Map();
  return {
    setTimeout(fn, delay = 0) { pending.set(++id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { pending.delete(id); },
    async advance(ms, p) {
      await p.flush(); const end = now + ms;
      for (;;) {
        const next = [...pending.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].at; pending.delete(next[0]); next[1].fn(); await p.flush();
      }
      now = end; await p.flush();
    }
  };
}

test("CG3 seven optgroups expose unique field unions, hide unused categories and retain visualization", async () => {
  const p = await runPage(); const select = el(p, "filter-category");
  assert.equal(select.querySelectorAll("optgroup").length, 7);
  for (const [i, g] of metadata.groups.entries()) {
    const group = select.querySelectorAll("optgroup")[i];
    assert.equal(group.firstElementChild.value, "field:" + g.id);
    assert.equal(group.firstElementChild.textContent, g.ja + "（分野全体）");
    change(p, "filter-category", "field:" + g.id);
    const ids = tools.filter((t) => t.category_ids.some((id) => g.category_ids.includes(id))).map((t) => t.id);
    assert.deepEqual(shown(p), ids, g.id);
    assert.equal(el(p, "category-guidance").textContent, g.description_ja);
    assert.equal(el(p, "category-guidance").hidden, false);
  }
  const visualization = select.querySelectorAll("option").find((o) => o.value === "visualization");
  assert.equal(visualization.parentNode, select);
  change(p, "filter-category", "visualization");
  const visualizationIds = tools.filter((t) => t.category_ids.includes("visualization")).map((t) => t.id);
  assert.ok(visualizationIds.includes("day128"));
  assert.deepEqual(shown(p), visualizationIds);
  assert.equal(el(p, "category-guidance").hidden, true);
  for (const c of definitions.filter((c) => !tools.some((t) => t.category_ids.includes(c.id)))) assert.equal(select.querySelectorAll("option").some((o) => o.value === c.id), false);
});

test("CG4 category URL priority and legacy ID resolution are deterministic and preserve unrelated state", () => {
  const known = { categories: definitions.map((c) => c.id), fields: metadata.groups.map((g) => g.id), books: ["genai-crypto"] };
  for (const [query, cat, field] of [
    ["?cat=learning-support&field=cryptography", "machine-learning", ""],
    ["?cat=%20LEARNING-SUPPORT%20&field=cryptography", "machine-learning", ""],
    ["?cat=classic-crypto&field=authentication", "classic-crypto", ""],
    ["?cat=missing&field=CRYPTOGRAPHY", "", "cryptography"],
    ["?field=missing", "", ""]
  ]) {
    const state = U.readState(query, known); assert.equal(state.cat, cat); assert.equal(state.field, field);
  }
  const input = "https://hackinglab.online/?book=genai-crypto&cat=unknown&field=CRYPTOGRAPHY&q=day003&tab=dashboard&lang=en&ref=x#book-group-ch01";
  const canonical = new URL(U.buildUrl(input, U.readState(new URL(input).search, known)));
  assert.equal(canonical.searchParams.get("cat"), null);
  for (const [key, value] of Object.entries({book:"genai-crypto",field:"cryptography",q:"day003",tab:"dashboard",lang:"en",ref:"x"})) assert.equal(canonical.searchParams.get(key), value);
  assert.equal(canonical.hash, "#book-group-ch01");
});

test("CG5 initial and history field canonicalization replace without extra entries", async () => {
  for (const [query, selected, expectedField, expectedCat] of [
    ["?cat=learning-support&field=cryptography&lang=en", "machine-learning", null, "machine-learning"],
    ["?cat=unknown&field=%20CRYPTOGRAPHY%20&lang=en", "field:cryptography", "cryptography", null],
    ["?cat=unknown&field=unknown&q=day003&lang=en", "", null, null]
  ]) {
    const p = await runPage({ search: query });
    assert.equal(p.context.history.length, 1);
    assert.equal(el(p, "filter-category").value, selected);
    assert.equal(p.context.location.searchParams.get("field"), expectedField);
    assert.equal(p.context.location.searchParams.get("cat"), expectedCat);
    assert.equal(p.context.location.searchParams.get("lang"), "en");
  }
});

test("CG6 field/category changes preserve other filters and survive Back/Forward and language", async () => {
  const p = await runPage({ search: "?book=genai-crypto&q=day003&lang=en" });
  const select = el(p, "filter-category"); select.focus();
  change(p, "filter-category", "field:cryptography");
  assert.equal(p.document.activeElement, select);
  assert.equal(p.context.location.searchParams.get("cat"), null);
  assert.equal(p.context.location.searchParams.get("book"), "genai-crypto");
  assert.equal(p.context.location.searchParams.get("q"), "day003");
  assert.deepEqual(shown(p), ["day003"]);
  p.evaluate("lastPush = null");
  change(p, "filter-category", "classic-crypto");
  assert.equal(p.context.location.searchParams.get("field"), null);
  await p.back(); assert.equal(select.value, "field:cryptography");
  await p.forward(); assert.equal(select.value, "classic-crypto");
  await p.back(); el(p, "lang-ja").click();
  assert.equal(select.value, "field:cryptography");
  assert.equal(el(p, "category-guidance").textContent, metadata.groups[0].description_ja);
});

test("CG7 a URL-selected zero-tool category stays visible until clear and returns through history", async () => {
  const p = await runPage({ search: "?cat=hardening&lang=en" });
  const select = el(p, "filter-category");
  const has = () => select.querySelectorAll("option").some((o) => o.value === "hardening");
  assert.equal(select.value, "hardening"); assert.equal(has(), true); assert.deepEqual(shown(p), []);
  el(p, "lang-ja").click(); assert.equal(select.value, "hardening"); assert.equal(has(), true);
  el(p, "clear-filters").click(); assert.equal(select.value, ""); assert.equal(has(), false);
  assert.equal(shown(p).length, tools.length); assert.equal(p.document.activeElement, el(p, "filter-search-input"));
  await p.back(); assert.equal(select.value, "hardening"); assert.equal(has(), true); assert.deepEqual(shown(p), []);
  await p.forward(); assert.equal(select.value, ""); assert.equal(has(), false);
});

test("CG8 zero results take guidance priority and clear retains the selected book", async () => {
  const p = await runPage({ search: "?book=genai-crypto&field=cryptography&lang=en", width:320 });
  assert.equal(el(p,"category-guidance").hidden,false);
  search(p, "no-match-category-test");
  assert.equal(el(p, "category-guidance").hidden, true);
  assert.ok(el(p, "clear-filters"));
  el(p, "clear-filters").click();
  assert.equal(p.context.location.searchParams.get("field"), null);
  assert.equal(p.context.location.searchParams.get("book"), "genai-crypto");
  assert.equal(el(p, "category-guidance").hidden, true);
  assert.equal(p.document.activeElement, el(p, "filter-search-input"));
});

test("CG9 the cached-list path still updates safe plain-text guidance without replacing cards", async () => {
  const p = await runPage({ search: "?cat=steganography&lang=en" });
  const first = cards(p)[0];
  p.evaluate('categoryGroups.descriptions.get("steganography").en = "<img src=x onerror=alert(1)>"; renderToolList()');
  assert.equal(cards(p)[0], first);
  assert.equal(el(p, "category-guidance").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(el(p, "category-guidance").querySelector("img"), null);
  assert.equal(el(p, "category-guidance").hasAttribute("aria-live"), false);
});

test("CG10 optional group failure and invalid schema fall back flat while preserving book/search/category", async () => {
  const invalid = structuredClone(metadata); invalid.groups[0].category_ids.push("missing");
  for (const options of [
    {dataFailures:{"data/category_groups.json":503}},
    {dataOverrides:{"data/category_groups.json":invalid}},
    {fetchResponse:name=>name === "data/category_groups.json" ? {ok:true,json:async()=>{throw new SyntaxError("Broken body");}}:undefined}
  ]) {
    const p = await runPage({search:"?book=genai-crypto&field=cryptography&q=day003&lang=en", ...options});
    assert.equal(el(p,"main-content").dataset.loadState,"ready");
    assert.equal(el(p,"filter-category").querySelectorAll("optgroup").length,0);
    assert.equal(p.context.location.searchParams.get("field"),null);
    assert.equal(p.context.location.searchParams.get("book"),"genai-crypto");
    assert.equal(el(p,"filter-search-input").value,"day003"); assert.deepEqual(shown(p),["day003"]);
    assert.equal(el(p,"category-guidance").hidden,true);
  }
  const p = await runPage({search:"?cat=learning-support&field=cryptography",dataFailures:{"data/category_groups.json":503}});
  assert.equal(el(p,"filter-category").value,"machine-learning");
  assert.deepEqual(shown(p),tools.filter(t=>t.category_ids.includes("machine-learning")).map(t=>t.id));
});

test("CG11 books and groups share the same optional deadline and late ignored-abort bodies stay ignored", async () => {
  const clock = fakeClock(); const signals = {}; const finishes = {};
  const p = await runPage({search:"?field=cryptography&q=day003",clock,allowLoadFailure:true,fetchResponse(name, options) {
    if (["data/books.json","data/category_groups.json","data/tools.json"].includes(name)) {
      signals[name] = options.signal;
      return {ok:true,json:()=>new Promise(resolve=>{finishes[name]=resolve;})};
    }
  }});
  assert.equal(p.fetched.length,4);
  await clock.advance(5000,p); assert.equal(el(p,"main-content").dataset.loadState,"loading");
  finishes["data/tools.json"](catalog); await p.flush();
  await clock.advance(2999,p); assert.equal(el(p,"main-content").dataset.loadState,"loading");
  await clock.advance(1,p); assert.equal(el(p,"main-content").dataset.loadState,"ready");
  for (const name of ["data/books.json","data/category_groups.json"]) assert.equal(signals[name].aborted,true);
  assert.equal(el(p,"filter-category").querySelectorAll("optgroup").length,0);
  finishes["data/books.json"](JSON.parse(read("data/books.json"))); finishes["data/category_groups.json"](metadata); await p.flush();
  assert.equal(el(p,"filter-category").querySelectorAll("optgroup").length,0);
  assert.deepEqual(shown(p),["day003"]);
});

test("CG12 required failure/retry ignores stale optional metadata and uses the latest URL", async () => {
  const clock=fakeClock(); let staleGroups;
  const p=await runPage({clock,allowLoadFailure:true,fetchResponse(name,options,attempt){
    if(attempt===1&&name==="data/tools.json")return new Promise(()=>{});
    if(attempt===1&&name==="data/category_groups.json")return {ok:true,json:()=>new Promise(resolve=>{staleGroups=resolve;})};
  }});
  await clock.advance(20000,p); assert.equal(el(p,"main-content").dataset.loadState,"error");
  p.context.history.pushState(null,"","?field=authentication&lang=en");p.dispatch("popstate",{state:null});
  el(p,"retry-data").click();await p.flush();
  assert.equal(el(p,"filter-category").value,"field:authentication");
  const ready=shown(p);staleGroups({...metadata,schema_version:999});await p.flush();
  assert.deepEqual(shown(p),ready);assert.equal(el(p,"filter-category").value,"field:authentication");
});

test("CG13 field filtering preserves duplicate outside cards and focused controls across progress sync", async () => {
  const p=await runPage({search:"?book=genai-crypto&field=cryptography&lang=en"});
  change(p,"filter-progress","0");
  const card=cards(p).find(c=>cards(p).filter(x=>x.dataset.toolId===c.dataset.toolId).length>1);
  assert.ok(card);const id=card.dataset.toolId;const duplicates=cards(p).filter(c=>c.dataset.toolId===id);
  const control=card.querySelector(".tool-progress-select");control.focus();chooseProgress(control,1);
  assert.equal(p.document.activeElement,control);
  for(const c of duplicates){assert.ok(cards(p).includes(c));assert.equal(c.classList.contains("is-outside"),true);}
  const before=shown(p);el(p,"lang-ja").click();assert.deepEqual(shown(p),before);
  assert.equal(el(p,"filter-category").value,"field:cryptography");
  assert.equal(cards(p).filter(c=>c.dataset.toolId===id).length,duplicates.length);
  change(p,"filter-category","classic-crypto");assert.equal(shown(p).includes(id),false);
});

test("CG14 set and Day precedence include field clearing while compatible links retain it", async () => {
  for(const query of ["?field=authentication&tools=3,8","?field=authentication&tools=","?field=authentication&tools=999","?field=authentication#day003","?field=authentication#day999"]){
    const p=await runPage({search:query});assert.equal(p.context.location.searchParams.get("field"),null,query);
    assert.equal(el(p,"category-guidance").hidden,true,query);
  }
  const p=await runPage({search:"?field=authentication#day001"});
  assert.equal(el(p,"filter-category").value,"field:authentication");assert.ok(shown(p).includes("day001"));
  el(p,"start-all-button").click();assert.equal(p.context.location.searchParams.get("field"),null);assert.equal(shown(p).length,tools.length);
  await p.back();assert.equal(el(p,"filter-category").value,"field:authentication");
  await p.forward();assert.equal(el(p,"filter-category").value,"");assert.equal(shown(p).length,tools.length);
});

test("CG15 history canonicalizes only category/field and preserves unknown-book notices", async () => {
  const p=await runPage({search:"?book=missing&field=CRYPTOGRAPHY&lang=en"});
  assert.equal(el(p,"book-notice").hidden,false);
  p.context.history.pushState(null,"","?book=missing&cat=unknown&field=authentication&q=day001&lang=en&ref=keep");
  p.dispatch("popstate",{state:null});await p.flush();
  assert.equal(p.context.location.searchParams.get("book"),"missing");
  assert.equal(p.context.location.searchParams.get("ref"),"keep");
  assert.equal(p.context.location.searchParams.get("cat"),null);
  assert.equal(p.context.location.searchParams.get("field"),"authentication");
  assert.equal(el(p,"book-notice").hidden,false);assert.deepEqual(shown(p),["day001"]);
  assert.equal(p.context.history.length,2);
});
