"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read, chooseProgress } = require("./helpers/page.js");
const HB = require("../js/books.js"), HU = require("../js/url.js");
const tools = JSON.parse(read("data/tools.json")).tools;
const books = JSON.parse(read("data/books.json")).books;
const el = (p, id) => p.document.getElementById(id);
const links = p => p.document.querySelectorAll(".start-demo");
const starterGroups = {
  recommended: ["day003", "day050", "day077"],
  crypto: ["day003", "day008", "day034"],
  web: ["day077", "day023", "day075"],
  physical: ["day050", "day061", "day083"],
  everyday: ["day102", "day116", "day025"]
};
const starterList = (p, group) => p.document.querySelector(`.start-first-tools[data-start-genre="${group}"]`);
const visibleDemos = p => links(p).filter(a => a.closest(".start-first-tools").hidden === false);
const chooseGenre = (p, value) => { const select=el(p,"start-genre"); select.value=value; select.dispatch("change"); };
const buttons = p => ["first", "books", "all"].map(name => el(p, `start-${name}-button`));
const state = p => el(p, "main-content").dataset.loadState;
const chooseBook = (p, link, fields = {}) => el(p, "start-book-links").dispatch("click", { target: link, ...fields });
function clock() {
  let now=0, seq=0; const tasks=new Map();
  return { setTimeout(fn, ms=0) { const id=++seq; tasks.set(id,{at:now+ms,fn}); return id; }, clearTimeout(id) { tasks.delete(id); },
    async advance(ms,p) { const end=now+ms; await p.flush(); for (;;) { const next=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0]; if(!next)break; now=next[1].at; tasks.delete(next[0]); next[1].fn(); await p.flush(); } now=end; await p.flush(); } };
}

test("SH1: initial and saved Start decisions stay independent of the visit-local first panel", async () => {
  for (const [width, search, saved, open] of [[1280,"",null,true],[320,"",null,false],[1280,"?book=genai-crypto",null,false],[1280,"?tools=3,8",null,false],[320,"","open",true],[1280,"","closed",false]]) {
    const p=await runPage({width,search,storedValues:saved ? {hlo_start_here:saved}: {}});
    assert.equal(el(p,"start-here").open,open);
    assert.equal(el(p,"start-first-panel").hidden,false); assert.equal(el(p,"start-books-panel").hidden,true);
    assert.equal(p.values.get("hlo_start_here"),saved || undefined);
  }
});

test("SH2: panel choice keeps the current Start open, URL/history and focused controls; language keeps chosen panel", async () => {
  const p=await runPage(); const href=p.context.location.href, length=p.context.history.length;
  const book=el(p,"start-books-button"); book.focus(); book.click();
  assert.equal(el(p,"start-first-heading").parentElement,el(p,"start-first-panel"));
  assert.equal(el(p,"start-here").open,true); assert.equal(el(p,"start-first-panel").hidden,true); assert.equal(el(p,"start-books-panel").hidden,false);
  assert.equal(book.getAttribute("aria-expanded"),"true"); assert.equal(p.document.activeElement,book);
  assert.equal(p.values.get("hlo_start_here"),"closed");
  const bookLinks=el(p,"start-book-links").querySelectorAll("a"); bookLinks[0].focus(); p.evaluate('currentLang="en"; updateLanguageUI()');
  assert.deepEqual(el(p,"start-book-links").querySelectorAll("a"),bookLinks); assert.equal(p.document.activeElement,bookLinks[0]);
  assert.equal(el(p,"start-books-panel").hidden,false);
  const first=el(p,"start-first-button"); first.focus(); first.click();
  assert.equal(el(p,"start-first-panel").hidden,false); assert.equal(el(p,"start-books-panel").hidden,true);
  assert.equal(p.document.activeElement,first); assert.equal(p.context.location.href,href); assert.equal(p.context.history.length,length);
});

test("SH3: every starter group has three public catalog links in order, in both languages and safe new tabs", async () => {
  const data=JSON.parse(read("data/tools.json"));
  data.tools.find(t=>t.id==="day003").demo_url="https://ipusiron.github.io/example/?mode=test#sample";
  data.tools.find(t=>t.id==="day003").title='A <script> & "quoted" tool';
  const p=await runPage({dataOverrides:{"data/tools.json":data}});
  const demos=links(p); assert.equal(demos.length,15);
  assert.deepEqual(el(p,"start-genre").options.map(o=>o.value),Object.keys(starterGroups));
  assert.equal(el(p,"start-genre").value,"recommended");
  for (const language of ["en","ja"]) {
    el(p,`lang-${language}`).click();
    for (const [group, ids] of Object.entries(starterGroups)) {
      chooseGenre(p,group);
      const label=el(p,"start-genre").options.find(o=>o.value===group).textContent;
      assert.ok(el(p,"start-genre-status").textContent.includes(label),"Full selected topic is missing from the visible text");
      assert.deepEqual(visibleDemos(p).map(a=>a.dataset.toolId),ids);
      assert.equal(p.document.querySelectorAll(".start-first-tools").filter(list=>!list.hidden).length,1);
      for (const link of visibleDemos(p)) { const tool=data.tools.find(t=>t.id===link.dataset.toolId);
        assert.ok(tool && tool.hub!==false);
        assert.equal(link.href,HU.demoLink(tool.demo_url,language)); assert.equal(link.target,"_blank"); assert.equal(link.rel,"noopener");
        assert.equal(link.getAttribute("aria-label"),language==="ja" ? `デモを開く（${tool.title}、新しいタブ）` : `Open demo (${tool.title}, new tab)`);
        assert.equal(link.hasAttribute("aria-disabled"),false); assert.equal(link.hasAttribute("tabindex"),false);
      }
    }
  }
  assert.equal(el(p,"start-first-panel").querySelector("script"),null);
  const crypto=starterList(p,"crypto").querySelectorAll(".start-demo");
  assert.match(crypto[0].closest("li").textContent,/KHOOR ZRUOG\./); assert.match(crypto[1].closest("li").textContent,/Rank 1/); assert.match(crypto[2].closest("li").textContent,/HOELL/);
});

test("SH4: loading and required failure disable entries and remove demo navigation; retry enables them once", async () => {
  const pending=await runPage({deferData:true});
  assert.equal(el(pending,"start-genre").disabled,true);
  for (const b of buttons(pending)) assert.equal(b.disabled,true);
  for (const a of links(pending)) { assert.equal(a.hasAttribute("href"),false); assert.equal(a.dispatch("click").defaultPrevented,true); }
  el(pending,"start-all-button").dispatch("click"); assert.equal(pending.context.history.length,1);
  await pending.releaseData(); for (const b of buttons(pending)) assert.equal(b.disabled,false);
  assert.equal(el(pending,"start-genre").disabled,false);
  const p=await runPage({allowLoadFailure:true,fetchResponse(name,_,attempt) { if(name==="data/tools.json"&&attempt===1)return {ok:false,status:503}; }});
  assert.equal(state(p),"error"); for(const b of buttons(p))assert.equal(b.disabled,true);
  assert.equal(el(p,"start-genre").disabled,true);
  for(const a of links(p))assert.equal(a.hasAttribute("href"),false);
  el(p,"retry-data").click(); await p.flush(); assert.equal(state(p),"ready");
  assert.equal(el(p,"start-genre").disabled,false);
  for(const [group,ids] of Object.entries(starterGroups)) { chooseGenre(p,group);assert.deepEqual(visibleDemos(p).map(a=>a.dataset.toolId),ids);assert.ok(visibleDemos(p).every(a=>a.hasAttribute("href"))); }
  el(p,"start-books-button").click(); const link=el(p,"start-book-links").querySelector("a");
  const length=p.context.history.length; chooseBook(p,link); assert.equal(p.context.history.length,length+1);
});

test("SH5: optional book failure cannot disable the first three or all-tools navigation", async () => {
  for (const failure of [{dataFailures:{"data/books.json":503}},{dataOverrides:{"data/books.json":{schema_version:1,books:"invalid"}}}]) {
    const p=await runPage({search:"?book=unknown&q=day003&lang=en",...failure});
    assert.equal(state(p),"ready"); assert.equal(el(p,"start-books-button").disabled,true);
    assert.equal(el(p,"start-first-button").disabled,false); assert.equal(el(p,"start-all-button").disabled,false);
    assert.equal(el(p,"start-genre").disabled,false);
    for(const [group,ids] of Object.entries(starterGroups)) { chooseGenre(p,group);assert.deepEqual(visibleDemos(p).map(a=>a.dataset.toolId),ids); }
    assert.equal(links(p).every(a=>a.hasAttribute("href")),true);
    el(p,"start-all-button").click(); assert.equal(el(p,"filter-search-input").value,"");
    assert.equal(el(p,"tool-list").querySelectorAll(".tool-card").length,tools.filter(t=>t.hub!==false).length);
  }
});

test("SH6: every group refuses navigation for absent, hidden and empty-demo catalog entries", async () => {
  for(const [group,ids] of Object.entries(starterGroups)) {
    const data=JSON.parse(read("data/tools.json"));
    data.tools=data.tools.filter(t=>t.id!==ids[0]);
    data.tools.find(t=>t.id===ids[1]).hub=false;
    data.tools.find(t=>t.id===ids[2]).demo_url="";
    const p=await runPage({dataOverrides:{"data/tools.json":data}}); chooseGenre(p,group);
    for(const a of visibleDemos(p)) {
      assert.equal(a.hasAttribute("href"),false);assert.equal(a.getAttribute("aria-disabled"),"true");
      assert.equal(a.getAttribute("tabindex"),"-1");assert.equal(a.dispatch("click").defaultPrevented,true);
    }
  }
});

test("SH7: book links use all existing short names, language-safe URLs and modified-click behavior", async () => {
  const p=await runPage({search:"?q=day003&lang=en"}); const list=el(p,"start-book-links"), entries=list.querySelectorAll("a");
  assert.equal(entries.length,books.length);
  entries.forEach((a,i)=> { assert.equal(a.textContent,HB.bookLabel(books[i],"en")); const u=new URL(a.href); assert.equal(u.searchParams.get("book"),books[i].slug); assert.equal(u.searchParams.get("lang"),"en"); assert.equal(u.searchParams.has("q"),false); });
  for (const modifier of [{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{button:1}]) { const href=p.context.location.href,length=p.context.history.length; assert.equal(chooseBook(p,entries[0],modifier).defaultPrevented,false); assert.equal(p.context.location.href,href); assert.equal(p.context.history.length,length); }
  entries[0].focus(); assert.equal(chooseBook(p,entries[0]).defaultPrevented,true);
  assert.equal(el(p,"filter-book").value,books[0].slug); assert.equal(p.document.activeElement,entries[0]); assert.equal(el(p,"filter-search-input").value,"day003");
});

test("SH8: all-tools clears book/category/search/progress/set/hash with one push and Back restores the preceding view", async () => {
  for(const search of ["?book=genai-crypto&cat=classic-crypto&q=day003&lang=en","?tools=3,8&lang=en#day003"]) {
    const p=await runPage({search}); el(p,"start-here").open=true;
    const progress=el(p,"filter-progress");progress.value="0";progress.dispatch("change");
    const before=p.context.location.href,length=p.context.history.length,all=el(p,"start-all-button"); all.focus();all.click();
    assert.equal(p.context.history.length,length+1); assert.equal(p.context.location.search,"?lang=en");assert.equal(p.context.location.hash,"");
    assert.equal(el(p,"filter-book").value,"");assert.equal(progress.value,"all"); assert.equal(p.document.activeElement,all);assert.equal(el(p,"start-here").open,true);
    await p.back(); assert.equal(p.context.location.href,before);
  }
});

test("SH9: Escape clears through ordinary search replacement and cancels the stale delayed announcement", async () => {
  const time=clock(),p=await runPage({search:"?lang=en",clock:time}),input=el(p,"filter-search-input");
  input.focus();input.value="day003";input.dispatch("input");await time.advance(300,p);
  const length=p.context.history.length;
  assert.equal(input.dispatch("keydown",{key:"Escape"}).defaultPrevented,true);
  assert.equal(input.value,"");assert.equal(p.context.location.search,"?lang=en");assert.equal(p.context.history.length,length);assert.equal(p.document.activeElement,input);
  await time.advance(699,p);assert.equal(el(p,"book-status").textContent,"");await time.advance(1,p);
  assert.equal(el(p,"book-status").textContent,`Showing all ${tools.filter(t=>t.hub!==false).length} tools.`);
  const href=p.context.location.href;input.dispatch("keydown",{key:"Escape"});assert.equal(p.context.location.href,href);
});

test("SH10: composing Escape preserves text, URL and cards; blur resets only the Escape guard", async () => {
  for(const fields of [{isComposing:true},{keyCode:229},{}]) {
    const p=await runPage({search:"?q=day003"}),input=el(p,"filter-search-input"); const href=p.context.location.href,card=el(p,"tool-list").children[0];
    if(!Object.keys(fields).length)input.dispatch("compositionstart");input.value="未確定"; input.dispatch("input",{isComposing:true});
    assert.equal(input.dispatch("keydown",{key:"Escape",...fields}).defaultPrevented,true);assert.equal(input.value,"未確定");assert.equal(p.context.location.href,href);assert.equal(el(p,"tool-list").children[0],card);
    input.value="day008";input.dispatch("input",{isComposing:false});assert.match(p.context.location.search,/day008/);
    input.dispatch("blur");input.dispatch("keydown",{key:"Escape"});assert.equal(input.value,"");
  }
});

test("SH11: help has nine ordered sections, retains progress/storage deep links, and Escape returns focus", async () => {
  const p=await runPage(); const dialog=el(p,"help-dialog");
  assert.deepEqual(dialog.querySelectorAll("h3").map(n=>n.id),["help-usage","help-stuck","help-progress","help-later","help-storage","help-list","help-keyboard","help-approach","help-admin"]);
  el(p,"help-button").focus();el(p,"help-button").click(); assert.equal(el(p,"help-modal").hidden,false);assert.equal(p.document.activeElement,el(p,"help-body"));
  p.document.dispatch("keydown",{key:"Escape"});assert.equal(el(p,"help-modal").hidden,true);assert.equal(p.document.activeElement,el(p,"help-button"));
  assert.match(el(p,"help-storage").closest("section").textContent,/click, tap, or type/);assert.match(el(p,"help-storage").closest("section").textContent,/Start here.*open or closed/);
  assert.match(el(p,"help-approach").closest("section").textContent,/Most tools live on GitHub Pages/);
  assert.match(el(p,"help-list").closest("section").textContent,/They do not show a learning order/);
});

test("SH12: later storage failure updates the Start sentence in both languages without losing panel choice or the full notice", async () => {
  let fail=false;const p=await runPage({storageHooks:{write(){if(fail)throw new Error("blocked");}}});
  el(p,"start-books-button").click();fail=true;
  chooseProgress(el(p,"tool-list").querySelector('[data-part="progress"]'),1);
  assert.match(el(p,"record-location").textContent,/このブラウザーでは記録を保存できない/);assert.equal(el(p,"storage-warning").hidden,false);
  el(p,"lang-en").click();assert.match(el(p,"record-location").textContent,/This browser can't save your records/);assert.equal(el(p,"start-books-panel").hidden,false);
  el(p,"storage-warning-help").click();assert.equal(p.document.activeElement,el(p,"help-storage"));el(p,"help-close").click();assert.equal(p.document.activeElement,el(p,"storage-warning-help"));
});

test("SH13: all-tools Forward restores cleared non-URL progress even when no scroll event saved the new entry", async () => {
  const tool=tools.find(t=>t.id==="day003");
  const p=await runPage({search:"?book=genai-crypto&q=day003&lang=en",storedValues:{[`progress_${tool.slug}`]:"1"}});
  const progress=el(p,"filter-progress");progress.value="1";progress.dispatch("change");
  const before=p.context.location.href, count=el(p,"tool-list").querySelectorAll(".tool-card").length, length=p.context.history.length;
  assert.ok(count>0);
  const all=el(p,"start-all-button");all.focus();all.click();
  const allHref=p.context.location.href;
  assert.equal(progress.value,"all");assert.equal(el(p,"tool-list").querySelectorAll(".tool-card").length,tools.filter(t=>t.hub!==false).length);
  await p.back();
  assert.equal(p.context.location.href,before);assert.equal(progress.value,"1");assert.equal(el(p,"filter-search-input").value,"day003");
  assert.equal(el(p,"tool-list").querySelectorAll(".tool-card").length,count);
  await p.forward();
  assert.equal(p.context.location.href,allHref);assert.equal(p.context.history.length,length+1);
  assert.equal(progress.value,"all");assert.equal(el(p,"filter-book").value,"");assert.equal(el(p,"filter-search-input").value,"");
  assert.equal(el(p,"tool-list").querySelectorAll(".tool-card").length,tools.filter(t=>t.hub!==false).length);
  assert.equal(p.document.activeElement,all);
});


test("SH14: every modal Tab moves explicitly, even when native Tab would skip links and leave the dialog", async () => {
  const p=await runPage(), dialog=el(p,"help-dialog"), close=el(p,"help-close"), opener=el(p,"help-button");
  opener.focus();opener.click();
  const anchors=dialog.querySelectorAll("a[href]");assert.ok(anchors.length>=2);
  const body=el(p,"help-body");
  const order=[close,body,...anchors];
  // Opening focuses the scroll region for immediate Arrow/Page navigation.
  assert.equal(p.document.activeElement,body);
  dialog.focus();
  const tab=(shiftKey=false)=> {
    const event=p.document.dispatch("keydown",{key:"Tab",shiftKey});
    // Model the browser setting that skips anchors and would otherwise reach the page.
    if(!event.defaultPrevented)p.document.body.focus();
    assert.equal(event.defaultPrevented,true);
    assert.equal(dialog.contains(p.document.activeElement),true);
  };
  for(const expected of [...order,...order]) {tab();assert.equal(p.document.activeElement,expected);}
  for(const expected of [...order.slice(0,-1).reverse(),order.at(-1)]) {tab(true);assert.equal(p.document.activeElement,expected);}
  for(const origin of [dialog,el(p,"help-storage"),p.document.body]) {
    origin.focus();tab();assert.equal(p.document.activeElement,close);
    origin.focus();tab(true);assert.equal(p.document.activeElement,anchors.at(-1));
  }
  p.document.dispatch("keydown",{key:"Escape"});assert.equal(p.document.activeElement,opener);assert.equal(el(p,"help-modal").hidden,true);
  assert.equal(p.document.dispatch("keydown",{key:"Tab"}).defaultPrevented,false);
  el(p,"storage-warning-help").click();assert.equal(p.document.activeElement,el(p,"help-storage"));
  tab();assert.equal(p.document.activeElement,close);close.click();assert.equal(p.document.activeElement,el(p,"storage-warning-help"));
});

test("SH15: modal Tab recomputes hidden and disabled controls and keeps focus in an empty dialog", async () => {
  const p=await runPage(), dialog=el(p,"help-dialog"), close=el(p,"help-close");
  el(p,"help-button").click();
  const anchors=dialog.querySelectorAll("a[href]");
  anchors.forEach(a=>{a.hidden=true;});
  el(p,"help-body").setAttribute("tabindex","-1");
  const disabled=p.document.createElement("button");disabled.disabled=true;dialog.appendChild(disabled);
  for(const shiftKey of [false,true]) {
    assert.equal(p.document.dispatch("keydown",{key:"Tab",shiftKey}).defaultPrevented,true);
    assert.equal(p.document.activeElement,close);
  }
  const last=anchors.at(-1);last.hidden=false;
  p.document.dispatch("keydown",{key:"Tab"});assert.equal(p.document.activeElement,last);
  close.hidden=true;last.hidden=true;
  for(const shiftKey of [false,true]) {
    assert.equal(p.document.dispatch("keydown",{key:"Tab",shiftKey}).defaultPrevented,true);
    assert.equal(p.document.activeElement,dialog);
  }
});

test("SH16: reopening help resets its body scroll and every close path restores the opener", async () => {
  const p=await runPage(), body=el(p,"help-body"), close=el(p,"help-close"), modal=el(p,"help-modal"), opener=el(p,"help-button");
  assert.equal(body.contains(close),false);
  assert.equal(body.getAttribute("role"),"region");
  assert.equal(body.getAttribute("aria-labelledby"),"help-title");
  for (const dismiss of [()=>close.click(),()=>p.document.dispatch("keydown",{key:"Escape"}),()=>modal.click()]) {
    body.scrollTop=500;
    opener.focus();opener.click();
    assert.equal(p.document.activeElement,body);
    assert.equal(body.scrollTop,0);
    body.scrollTop=500;
    dismiss();
    assert.equal(modal.hidden,true);
    assert.equal(p.document.activeElement,opener);
    assert.equal(p.document.documentElement.classList.contains("help-open"),false);
  }
});

test("SH17: genre selection preserves focused select, open panel, list filters, URL, history and stored records", async () => {
  const p=await runPage({search:"?book=genai-crypto&cat=classic-crypto&q=day003",storedValues:{hlo_start_here:"open",later_day003:"1",progress_caesar:"2"}});
  el(p,"start-here").open=true;
  const progress=el(p,"filter-progress");progress.value="0";progress.dispatch("change");
  const later=el(p,"filter-later");later.checked=true;later.dispatch("change");
  const href=p.context.location.href, history=p.context.history.length, disk=[...p.values];
  const cards=el(p,"tool-list").children.slice(), fields=p.evaluate("JSON.stringify(filters)");
  const select=el(p,"start-genre"), lists=p.document.querySelectorAll(".start-first-tools");
  assert.equal(select.tagName,"SELECT");assert.equal(select.getAttribute("aria-controls"),"start-first-lists");
  assert.ok(p.document.querySelector('label[for="start-genre"]'));
  for(const group of Object.keys(starterGroups)) {
    select.focus();chooseGenre(p,group);
    assert.equal(p.document.activeElement,select);assert.equal(el(p,"start-here").open,true);
    assert.equal(el(p,"start-first-panel").hidden,false);assert.equal(el(p,"start-books-panel").hidden,true);
    assert.equal(p.context.location.href,href);assert.equal(p.context.history.length,history);
    assert.equal(p.evaluate("JSON.stringify(filters)"),fields);assert.deepEqual(el(p,"tool-list").children,cards);
    assert.deepEqual(p.document.querySelectorAll(".start-first-tools"),lists);
    assert.deepEqual([...p.values].filter(([key])=>key!=="hlo_start_genre"),disk);
    if(group!=="recommended")assert.equal(p.values.get("hlo_start_genre"),group);
  }
  const writes=p.storageCalls.write;
  chooseGenre(p,"unknown");assert.equal(select.value,"everyday");assert.equal(p.document.activeElement,select);
  chooseGenre(p,"everyday");assert.equal(p.storageCalls.write,writes);
});

test("SH18: genre and demo focus survive language and panel changes, and a fresh visit restores the saved genre", async () => {
  const p=await runPage(), select=el(p,"start-genre");
  assert.match(el(p,"start-genre-status").textContent,/おすすめ（分野横断）/);
  assert.equal(el(p,"start-genre-status").classList.contains("visually-hidden"),false);
  select.focus();chooseGenre(p,"physical");
  assert.equal(p.values.get("hlo_start_here"),"closed");assert.equal(el(p,"start-here").open,true);
  assert.deepEqual([...p.values.keys()],["hlo_start_here","hlo_start_genre"]);
  assert.equal(el(p,"start-genre-status").getAttribute("aria-live"),"polite");
  assert.match(el(p,"start-genre-status").textContent,/物理的セキュリティ/);
  const link=visibleDemos(p)[1];link.focus();el(p,"lang-en").click();
  assert.equal(p.document.activeElement,link);assert.equal(select.value,"physical");
  assert.match(el(p,"start-genre-status").textContent,/Physical security/);
  assert.equal(link.href,HU.demoLink(tools.find(t=>t.id===link.dataset.toolId).demo_url,"en"));
  el(p,"start-books-button").click();el(p,"start-first-button").click();
  assert.equal(select.value,"physical");assert.deepEqual(visibleDemos(p).map(a=>a.dataset.toolId),starterGroups.physical);
  const next=await runPage({storedValues:Object.fromEntries(p.values)});
  assert.equal(el(next,"start-genre").value,"physical");assert.deepEqual(visibleDemos(next).map(a=>a.dataset.toolId),starterGroups.physical);
});

test("SH19: only the five saved genres restore, without rewriting storage or overriding Start disclosure", async () => {
  for(const saved of [...Object.keys(starterGroups),"Web","web ","","unknown","__proto__","constructor"]) {
    const p=await runPage({width:320,storedValues:{hlo_start_genre:saved,hlo_start_here:"closed"}});
    const expected=Object.hasOwn(starterGroups,saved) ? saved : "recommended";
    assert.equal(el(p,"start-genre").value,expected);
    assert.deepEqual(visibleDemos(p).map(a=>a.dataset.toolId),starterGroups[expected]);
    assert.equal(el(p,"start-here").open,false);
    assert.equal(p.values.get("hlo_start_genre"),saved);assert.equal(p.storageCalls.write,0);
  }
});

test("SH20: preference-only storage refusal keeps the page usable without a record-loss notice", async () => {
  const unreadable=await runPage({storedValues:{hlo_start_genre:"web"},storageHooks:{read(key){if(key==="hlo_start_genre")throw Error("blocked preference read");}}});
  assert.equal(state(unreadable),"ready");assert.equal(el(unreadable,"start-genre").value,"recommended");
  assert.equal(el(unreadable,"storage-warning").hidden,true);
  const p=await runPage({storedValues:{hlo_start_genre:"web"},storageHooks:{write(key){if(key==="hlo_start_genre")throw Error("blocked preference write");}}});
  chooseGenre(p,"crypto");el(p,"lang-en").click();el(p,"start-books-button").click();el(p,"start-first-button").click();
  assert.equal(el(p,"start-genre").value,"crypto");assert.deepEqual(visibleDemos(p).map(a=>a.dataset.toolId),starterGroups.crypto);
  assert.equal(p.values.get("hlo_start_genre"),"web");assert.equal(el(p,"storage-warning").hidden,true);
  const next=await runPage({storedValues:Object.fromEntries(p.values)});
  assert.equal(el(next,"start-genre").value,"web");
});

test("SH21: another tab's saved genre and storage clear affect the next visit, not the current selection", async () => {
  const p=await runPage({storedValues:{hlo_start_genre:"crypto"}}), select=el(p,"start-genre");select.focus();
  p.values.set("hlo_start_genre","web");p.dispatch("storage",{key:"hlo_start_genre"});p.dispatch("pageshow",{persisted:true});
  el(p,"lang-en").click();
  assert.equal(select.value,"crypto");assert.equal(p.document.activeElement,select);
  const next=await runPage({storedValues:Object.fromEntries(p.values)});assert.equal(el(next,"start-genre").value,"web");
  p.values.clear();p.dispatch("storage",{key:null});p.dispatch("pageshow",{persisted:true});
  el(p,"lang-ja").click();assert.equal(select.value,"crypto");
  const cleared=await runPage({storedValues:Object.fromEntries(p.values)});assert.equal(el(cleared,"start-genre").value,"recommended");
});

test("SH22: remembered genre stays out of the record export and sharing URL", async () => {
  const tool=tools.find(t=>t.id==="day003");
  const p=await runPage({search:"?q=day003&lang=en",storedValues:{[`progress_${tool.slug}`]:"2",[`later_${tool.id}`]:"1"}});
  const href=p.context.location.href,history=p.context.history.length;
  chooseGenre(p,"everyday");el(p,"records-export").click();
  const data=JSON.parse(await p.downloads[0].blob.text());
  assert.equal(data.schema_version,2);assert.deepEqual(data.progress,{[tool.id]:2});assert.deepEqual(data.try_later,[tool.id]);
  assert.deepEqual(Object.keys(data).sort(),["app","progress","saved_at","schema_version","try_later"]);
  assert.equal(p.values.get("hlo_start_genre"),"everyday");
  assert.equal(p.context.location.href,href);assert.equal(p.context.history.length,history);
});
