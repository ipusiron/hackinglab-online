"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read } = require("./helpers/page.js");
const tools = JSON.parse(read("data/tools.json")).tools;
const books = JSON.parse(read("data/books.json")).books;
const HB = require("../js/books.js");
const totalFor = slug => HB.expandTargetIds(books.find(b => b.slug === slug), tools).size;
const el = (p, id) => p.document.getElementById(id);
const tool = id => tools.find(t => t.id === id);
const saved = Object.fromEntries(Object.entries({ day003: 2, day008: 3, day034: 1, day101: 3, day111: 2 }).map(([id, level]) => [`progress_${tool(id).slug}`, String(level)]));
const change = (p, id, value) => { el(p, id).value = value; el(p, id).dispatch("change"); };
function share(p) {
  const calls = []; p.context.open = (...args) => calls.push(args); el(p, "share-on-x").click();
  assert.equal(calls.length, 1); const [href, target, features] = calls[0];
  assert.equal(target, "_blank"); assert.equal(features, "noopener");
  const intent = new URL(href); assert.equal(intent.origin + intent.pathname, "https://twitter.com/intent/tweet");
  const lines = intent.searchParams.get("text").split("\n"); return { sentence: lines[0], url: new URL(lines[1]), text: intent.searchParams.get("text") };
}
async function copy(p) { el(p, "share-copy-link").focus(); el(p, "share-copy-link").click(); await p.flush(); }
async function restore(p, progress) {
  const text = JSON.stringify({ app: "hackinglab-online", schema_version: 1, saved_at: "2026-11-07T00:00:00.000Z", progress });
  el(p, "records-file").files = [{ size: Buffer.byteLength(text), text: async () => text }];
  await p.evaluate("handleRecordsImport()"); await p.flush();
}
test("SI1 whole scope ignores field/category/search/progress and copies canonical URL only", async () => {
  const p = await runPage({ search: "?field=cryptography&q=day003&tab=dashboard&lang=en&private=discard#chapter", storedValues: saved });
  change(p, "filter-progress", "3");
  const value = share(p);
  assert.equal(value.sentence, "I've worked through 4 tools at Hacking Lab Online (2 mastered) 🔬");
  assert.equal(value.url.href, "https://hackinglab.online/?lang=en");
  assert.equal(el(p, "share-scope-note").hidden, true);
  await copy(p); assert.deepEqual(p.copied, [value.url.href]);
  assert.equal(el(p, "share-copy-status").textContent, "Link copied.");
  assert.equal(p.document.activeElement, el(p, "share-copy-link"));
  assert.deepEqual(p.fetched, ["data/books.json", "data/category_groups.json", "data/categories.json", "data/tools.json"]);
});
test("SI2 selected book counts52 unique despite duplicate cards and filters; projects use current public totals", async () => {
  for (const [slug, total, worked] of [["genai-crypto",totalFor("genai-crypto"),2],["security-tools-100",totalFor("security-tools-100"),2],["security-tools-200",totalFor("security-tools-200"),2]]) {
    const p = await runPage({ search: `?book=${slug}&q=day003&tab=dashboard&lang=en`, storedValues: saved });
    const value = share(p);
    assert.match(value.sentence, new RegExp(`worked through ${worked} of the ${total} tools for`));
    assert.equal(value.url.searchParams.get("book"), slug);
    assert.equal(el(p, "share-scope-note").hidden, false);
    change(p, "filter-category", "field:authentication"); change(p, "filter-progress", "0");
    assert.equal(share(p).sentence, value.sentence);
  }
});
test("SI3 zero selected related scope retains URL/note; related singleton uses tool singular", async () => {
  const p = await runPage({ search: "?book=cyber-ninja&tab=dashboard&lang=en", storedValues: saved });
  assert.equal(share(p).sentence, "Learning security hands-on with the tools at Hacking Lab Online 🔬");
  assert.equal(share(p).url.searchParams.get("book"), "cyber-ninja");
  assert.equal(el(p, "share-scope-note").hidden, false);
  change(p, "filter-book", "ango-gijutsu-no-subete");
  p.evaluate(`setProgress(${JSON.stringify(tool("day123").slug)},3);refreshProgressViews()`);
  assert.match(share(p).sentence, /1 of the 1 tool related to/);
  el(p,"lang-ja").click(); assert.match(share(p).sentence, /関連ツール1本のうち1本/);
});
test("SI4 unknown book, optional books failure, sets and incompatible Day resolve share scope without raw input", async () => {
  for (const options of [
    { search: "?book=%3Cscript%3E&tab=dashboard&lang=en&ref=secret" },
    { search: "?book=genai-crypto&tab=dashboard&lang=en", dataFailures: { "data/books.json":503 } },
    { search: "?book=genai-crypto&tools=3,8&lang=en" },
    { search: "?book=ango-gijutsu-no-subete&lang=en#day003" }
  ]) {
    const p = await runPage({ ...options, storedValues:saved });
    const value=share(p);
    assert.equal(value.sentence,"I've worked through 4 tools at Hacking Lab Online (2 mastered) 🔬");
    assert.equal(value.url.href,"https://hackinglab.online/?lang=en");
    assert.equal(el(p,"share-scope-note").hidden,true);
    assert.doesNotMatch(value.text,/script|secret/);
  }
});
test("SI5 fallback uses approved status-before-readonly-field and keyboard focus for denied/absent clipboard", async()=>{
  for(const missing of [false,true]) {
    const p=await runPage({search:"?book=genai-crypto&tab=dashboard",clipboard:"reject"});
    if(missing)p.context.navigator.clipboard=undefined;
    await copy(p);const field=el(p,"share-copy-url"),status=el(p,"share-copy-status");
    assert.equal(status.textContent,"コピーできませんでした。下のリンクを選んでコピーしてください。");
    assert.equal(status.hidden,false);assert.equal(field.hidden,false);assert.equal(field.hasAttribute("readonly"),true);
    assert.equal(field.value,"https://hackinglab.online/?book=genai-crypto");
    assert.equal(p.document.activeElement,field);assert.equal(field.selectionStart,0);assert.equal(field.selectionEnd,field.value.length);
    const siblings=el(p,"share-controls").children;assert.ok(siblings.indexOf(status)<siblings.indexOf(field));
  }
});
test("SI6 progress sync/import/reset preserve fallback node/focus/selection and use latest effective counts",async()=>{
  const p=await runPage({search:"?tab=dashboard&lang=en",clipboard:"reject",confirmResult:true});
  await copy(p);const field=el(p,"share-copy-url"),button=el(p,"share-copy-link"),status=el(p,"share-copy-status");
  field.selectionStart=3;field.selectionEnd=11;
  const assertStable=()=>{assert.equal(el(p,"share-copy-url"),field);assert.equal(el(p,"share-copy-link"),button);assert.equal(el(p,"share-copy-status"),status);assert.equal(p.document.activeElement,field);assert.equal(field.hidden,false);assert.equal(field.selectionStart,3);assert.equal(field.selectionEnd,11);};
  p.values.set(`progress_${tool("day003").slug}`,"3");p.dispatch("storage",{key:`progress_${tool("day003").slug}`});
  await new Promise(r=>setTimeout(r,130));await p.flush();assertStable();assert.match(share(p).sentence,/1 tool.*1 mastered/);
  await restore(p,{day008:2});assertStable();assert.match(share(p).sentence,/2 tools.*1 mastered/);
  p.evaluate("handleResetAllProgress()");assertStable();assert.equal(share(p).sentence,"Learning security hands-on with the tools at Hacking Lab Online 🔬");
});
test("SI7 failed write dirty memory controls sharing rather than stale durable progress",async()=>{
  const p=await runPage({search:"?tab=dashboard&lang=en",storageFailure:"write",storedValues:{[`progress_${tool("day003").slug}`]:"1"}});
  p.evaluate(`setProgress(${JSON.stringify(tool("day003").slug)},3);refreshProgressViews()`);
  assert.equal(p.values.get(`progress_${tool("day003").slug}`),"1");
  assert.equal(share(p).sentence,"I've worked through 1 tool at Hacking Lab Online (1 mastered) 🔬");
});
test("SI8 scope/lang changes clear stale fallback and rescue its focused field without rebuilding buttons",async()=>{
  const p=await runPage({search:"?tab=dashboard&lang=en",clipboard:"reject"});
  const button=el(p,"share-copy-link");await copy(p);const field=el(p,"share-copy-url");
  el(p,"lang-ja").click();assert.equal(field.hidden,true);assert.equal(p.document.activeElement,button);assert.equal(el(p,"share-copy-status").hidden,true);
  await copy(p);change(p,"filter-book","genai-crypto");
  assert.equal(field.hidden,true);assert.equal(p.document.activeElement,button);
  assert.ok(el(p,"share-scope-note").textContent.includes("生成AI時代の暗号技術入門"));
  await copy(p);assert.equal(field.value,"https://hackinglab.online/?book=genai-crypto");
});
test("SI9 late clipboard resolution/rejection cannot survive language, tab, history or user focus changes",async()=>{
  const actions=[
    p=>el(p,"lang-ja").click(),
    p=>{el(p,"tab-tools-label").click();el(p,"tab-dashboard-label").click();},
    async p=>{p.context.history.pushState(null,"","?book=genai-crypto&tab=dashboard&lang=en");p.dispatch("popstate",{state:null});await p.flush();},
    p=>{p.dispatch("keydown",{key:"Tab"});el(p,"records-export").focus();},
    p=>el(p,"records-export").focus()
  ];
  for(const action of actions)for(const reject of [false,true]){
    const p=await runPage({search:"?tab=dashboard&lang=en"});let finish;
    p.context.navigator.clipboard={writeText:()=>new Promise((resolve,no)=>{finish=()=>reject?no(Error("denied")):resolve();})};
    el(p,"share-copy-link").focus();el(p,"share-copy-link").click();await action(p);const focus=p.document.activeElement;
    finish();await p.flush();assert.equal(el(p,"share-copy-status").hidden,true);assert.equal(el(p,"share-copy-url").hidden,true);assert.equal(p.document.activeElement,focus);
  }
});
test("SI10 latest copy wins when an earlier request completes later",async()=>{
  const p=await runPage({search:"?tab=dashboard&lang=en"});const pending=[];
  p.context.navigator.clipboard={writeText:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))};
  el(p,"share-copy-link").focus();el(p,"share-copy-link").click();el(p,"share-copy-link").click();
  pending[1].reject(Error("denied"));await p.flush();const field=el(p,"share-copy-url");
  assert.equal(field.hidden,false);pending[0].resolve();await p.flush();assert.equal(field.hidden,false);assert.match(el(p,"share-copy-status").textContent,/Couldn't copy/);
});
test("SI11 initial loading/error disable both controls and retry enables the latest resolved scope",async()=>{
  const p=await runPage({search:"?tab=dashboard&lang=en",deferData:true});
  for(const name of ["share-on-x","share-copy-link"])assert.equal(el(p,name).disabled,true);
  p.context.open=()=>assert.fail("Loading shared");p.evaluate("handleShareOnX()");await p.evaluate("copyShareLink()");assert.equal(p.copied.length,0);
  await p.releaseData();for(const name of ["share-on-x","share-copy-link"])assert.equal(el(p,name).disabled,false);
  const failed=await runPage({search:"?tab=dashboard&lang=en",allowLoadFailure:true,fetchResponse:(name,_,attempt)=>name==="data/tools.json"&&attempt===1?{ok:false,status:503}:undefined});
  for(const name of ["share-on-x","share-copy-link"])assert.equal(el(failed,name).disabled,true);
  failed.context.history.pushState(null,"","?book=genai-crypto&tab=dashboard&lang=en");failed.dispatch("popstate",{state:null});
  el(failed,"retry-data").click();await failed.flush();assert.equal(el(failed,"share-copy-link").disabled,false);assert.equal(share(failed).url.searchParams.get("book"),"genai-crypto");
});
test("SI12 actual Back/Forward and language update scope without carrying filters into share URL",async()=>{
  const p=await runPage({search:"?book=genai-crypto&tab=dashboard&lang=en",storedValues:saved});
  change(p,"filter-book","security-tools-200");assert.match(share(p).sentence,new RegExp(`2 of the ${totalFor("security-tools-200")} tools`));
  await p.back();assert.match(share(p).sentence,new RegExp(`2 of the ${totalFor("genai-crypto")} tools`));
  await p.forward();assert.match(share(p).sentence,new RegExp(`2 of the ${totalFor("security-tools-200")} tools`));
  el(p,"lang-ja").click();assert.match(share(p).sentence,new RegExp(`${totalFor("security-tools-200")}本のうち2本`));assert.equal(share(p).url.searchParams.has("lang"),false);
});

test("SI13 successful retry rescues the still-focused manual field before hiding it",async()=>{
  const p=await runPage({search:"?tab=dashboard&lang=en",clipboard:"reject"});
  await copy(p);const field=el(p,"share-copy-url"),button=el(p,"share-copy-link");
  assert.equal(p.document.activeElement,field);
  p.context.navigator.clipboard={writeText:async()=>{}};
  // Native pointer activation can leave the manual input focused.
  button.click();await p.flush();
  assert.equal(field.hidden,true);assert.equal(p.document.activeElement,button);
  assert.equal(el(p,"share-copy-status").textContent,"Link copied.");
});
