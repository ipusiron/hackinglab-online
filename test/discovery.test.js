"use strict";
const {test}=require("node:test"), assert=require("node:assert/strict");
const {runPage,read}=require("./helpers/page.js");
const tools=JSON.parse(read("data/tools.json")).tools.filter(t=>t.hub!==false);
const el=(p,id)=>p.document.getElementById(id);
const saved=ids=>Object.fromEntries(ids.map(id=>[`later_${id}`,"1"]));
const candidates=p=>el(p,"later-share-list").querySelectorAll("input");
function select(p,id,on=true) {const check=candidates(p).find(e=>e.dataset.toolId===id);check.checked=on;check.dispatch("change");return check;}
function shareOpen(p) {el(p,"filter-later").checked=true;el(p,"filter-later").dispatch("change");el(p,"later-share").open=true;}
function opened(p,link,type="click",button=0) {return p.document.dispatch(type,{target:link,type,button});}
const recent=p=>JSON.parse(p.values.get("hlo_recent_tools")||"[]");

test("recent tools track demo/usage/modified/middle activation, deduplicate and retain five without changing progress",async()=>{
 const p=await runPage();assert.equal(el(p,"recent-tools").hidden,true);
 const links=el(p,"tool-list").querySelectorAll('[data-part="repo"]').slice(0,6);
 for(const link of links) opened(p,link);
 const ids=links.map(a=>a.closest(".tool-card").dataset.toolId);
 assert.deepEqual(recent(p),ids.slice(1).reverse());
 opened(p,links[2],"auxclick",1);assert.deepEqual(recent(p),[ids[2],ids[5],ids[4],ids[3],ids[1]]);
 opened(p,links[0],"auxclick",2);assert.equal(recent(p)[0],ids[2]);
 const demo=p.document.querySelector('.start-demo[data-tool-id="day003"]');opened(p,demo);
 assert.equal(recent(p)[0],"day003");assert.equal(el(p,"recent-tools").hidden,false);
 assert.ok([...p.values.keys()].every(k=>!k.startsWith("progress_")&&!k.startsWith("later_")));
 const fresh=await runPage({storedValues:Object.fromEntries(p.values)});assert.equal(el(fresh,"recent-tools-list").querySelectorAll("a")[0].getAttribute("href"),"#day003");
 el(p,"recent-tools-clear").focus();el(p,"recent-tools-clear").click();assert.deepEqual(recent(p),[]);assert.equal(el(p,"recent-tools").hidden,true);assert.equal(p.document.activeElement.dataset.tabTarget,"tab-tools");
});

test("recent malformed/unknown values and unavailable storage cannot block links; dirty history survives sync/reset",async()=>{
 for(const value of ["{",'{}','["day999",null,{},"constructor"]']) {
  const p=await runPage({storedValues:{hlo_recent_tools:value}});assert.equal(el(p,"recent-tools").hidden,true);
 }
 const p=await runPage({storageFailure:"write",confirmResult:true});
 const link=p.document.querySelector('.start-demo[data-tool-id="day003"]');assert.equal(opened(p,link).defaultPrevented,false);
 p.dispatch("storage",{key:null});p.dispatch("pageshow",{persisted:true});p.evaluate("handleResetAllProgress()");
 assert.equal(el(p,"recent-tools-list").querySelectorAll("a").length,1);assert.match(el(p,"recent-tools-note").textContent,/保存できません/);
 assert.equal(p.values.get("hlo_recent_tools"),undefined);
});

test("saved selections include all saved tools, enforce 12 and build an ordered canonical URL without private filters",async()=>{
 const ids=tools.slice(0,14).map(t=>t.id),p=await runPage({search:'?q='+ids[0]+'&utm_source=private#unknown',storedValues:saved(ids)});
 assert.equal(el(p,"later-share").hidden,true);shareOpen(p);assert.equal(el(p,"later-share").hidden,false);assert.equal(candidates(p).length,14);
 const chosen=ids.slice(0,12).reverse();chosen.forEach(id=>select(p,id));
 const url=new URL(el(p,"later-share-url").value);assert.equal(url.origin,"https://hackinglab.online");assert.deepEqual([...url.searchParams.keys()],["tools"]);assert.equal(url.searchParams.get("tools"),chosen.join(","));assert.equal(url.hash,"");
 assert.equal(select(p,ids[12]).checked,false);assert.match(el(p,"later-share-status").textContent,/12本まで/);
 select(p,chosen[0],false);select(p,ids[12]);assert.equal(new URL(el(p,"later-share-url").value).searchParams.get("tools"),[...chosen.slice(1),ids[12]].join(","));
 el(p,"lang-en").click();assert.equal(new URL(el(p,"later-share-url").value).searchParams.get("lang"),"en");
 const target=new URL(el(p,"later-share-url").value);const receiver=await runPage({search:target.search});
 assert.deepEqual(el(receiver,"tool-list").querySelectorAll(".tool-card").map(c=>c.dataset.toolId),[...chosen.slice(1),ids[12]]);
});

test("cross-tab saved removal reconciles candidates/URL and preserves surviving checkbox focus",async()=>{
 const ids=tools.slice(0,3).map(t=>t.id),p=await runPage({storedValues:saved(ids)});shareOpen(p);
 const first=select(p,ids[0]),second=select(p,ids[1]);first.focus();
 p.values.set(`later_${ids[2]}`,"0");p.dispatch("storage",{key:`later_${ids[2]}`});p.dispatch("pageshow",{persisted:true});
 assert.equal(candidates(p)[0],first);assert.equal(p.document.activeElement,first);
 p.values.set(`later_${ids[0]}`,"0");p.dispatch("storage",{key:`later_${ids[0]}`});p.dispatch("pageshow",{persisted:true});
 assert.equal(p.document.activeElement,el(p,"later-share-summary"));assert.equal(new URL(el(p,"later-share-url").value).searchParams.get("tools"),ids[1]);assert.equal(candidates(p)[0],second);
 p.values.set(`later_${ids[1]}`,"0");p.dispatch("pageshow",{persisted:true});assert.equal(el(p,"later-share-output").hidden,true);assert.equal(el(p,"later-share-url").value,"");
});

test("copy failure offers selected manual URL, and stale completion cannot replace feedback or focus",async()=>{
 const ids=tools.slice(0,2).map(t=>t.id),p=await runPage({storedValues:saved(ids),clipboard:"reject"});shareOpen(p);select(p,ids[0]);
 const button=el(p,"later-share-copy");button.focus();button.click();await p.flush();
 const field=el(p,"later-share-url");assert.equal(p.document.activeElement,field);assert.equal(field.selectionEnd,field.value.length);assert.match(el(p,"later-share-status").textContent,/手動/);
 let resolve;p.context.navigator.clipboard.writeText=()=>new Promise(r=>resolve=r);
 button.focus();button.click();select(p,ids[1]).focus();resolve();await p.flush();
 assert.equal(el(p,"later-share-status").textContent,"");assert.equal(p.document.activeElement.dataset.toolId,ids[1]);
 p.context.navigator.clipboard.writeText=async()=>{};button.focus();button.click();await p.flush();assert.match(el(p,"later-share-status").textContent,/コピーしました/);
});

test("history and share choices stay outside exported records, progress reset and failed data visibility",async()=>{
 const tool=tools[0],p=await runPage({storedValues:{...saved([tool.id]),[`progress_${tool.slug}`]:"2"},confirmResult:true});shareOpen(p);select(p,tool.id);
 opened(p,el(p,"tool-list").querySelector('[data-part="repo"]'));
 p.evaluate("handleResetAllProgress()");assert.equal(candidates(p)[0].checked,true);assert.equal(recent(p).length,1);
 el(p,"records-export").click();const data=JSON.parse(await p.downloads[0].blob.text());assert.deepEqual(Object.keys(data).sort(),["app","progress","saved_at","schema_version","try_later"]);
 p.evaluate('setLoadState("error")');assert.equal(el(p,"recent-tools").hidden,true);assert.equal(el(p,"later-share").hidden,true);
});

for (const lang of ["ja", "en"]) test(`saved share order ${lang} is visible and named without moving candidates`, async () => {
 const ids=tools.slice(0,3).map(t=>t.id),p=await runPage({search:`?lang=${lang}`,storedValues:saved(ids)});shareOpen(p);
 const original=candidates(p),chosen=[ids[2],ids[0],ids[1]];
 const checkOrder=expected=>{
  assert.deepEqual(candidates(p),original,"Candidate nodes and catalog order stay in place");
  for(const check of original){
   const position=expected.indexOf(check.dataset.toolId),badge=check.parentNode.querySelector(".later-share-order");
   assert.equal(check.checked,position>=0);
   assert.equal(badge.hidden,position<0);
   assert.equal(badge.textContent,position<0?"":`${position+1}.`);
   const name=check.getAttribute("aria-label");
   assert.ok(name.includes(`Day${check.dataset.toolId.slice(3)}`));
   if(position>=0)assert.ok(name.endsWith(`${lang==="ja"?"共有順":"Share order"} ${position+1}`));
   else assert.ok(!name.includes(lang==="ja"?"共有順":"Share order"));
  }
  assert.equal(new URL(el(p,"later-share-url").value).searchParams.get("tools"),expected.join(","));
 };
 chosen.forEach(id=>select(p,id));checkOrder(chosen);
 const focused=original[1];focused.focus();select(p,chosen[0],false);checkOrder(chosen.slice(1));
 assert.equal(p.document.activeElement,focused);
 select(p,chosen[0]);checkOrder([...chosen.slice(1),chosen[0]]);
 p.values.set(`later_${chosen[1]}`,"0");p.dispatch("storage",{key:`later_${chosen[1]}`});p.dispatch("pageshow",{persisted:true});
 assert.equal(p.document.activeElement,focused);
 assert.equal(focused.parentNode.querySelector(".later-share-order").textContent,"1.");
 assert.ok(focused.getAttribute("aria-label").endsWith(`${lang==="ja"?"共有順":"Share order"} 1`));
 assert.equal(new URL(el(p,"later-share-url").value).searchParams.get("tools"),[chosen[2],chosen[0]].join(","));
 el(p,lang==="ja"?"lang-en":"lang-ja").click();
 assert.ok(focused.getAttribute("aria-label").endsWith(`${lang==="ja"?"Share order":"共有順"} 1`));
});
