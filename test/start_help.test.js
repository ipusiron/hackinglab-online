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
const starterProgress = p => p.document.querySelectorAll(".start-progress");
const recordValues = p => [...p.values].filter(([key]) => /^(progress_|later_)/.test(key)).sort(([a],[b])=>a.localeCompare(b));
const progressLink = (p, group, id) => starterList(p,group).querySelector(`.start-progress[data-tool-id="${id}"]`);
const progressControl = (p, id) => p.document.querySelectorAll(".tool-card").find(card=>card.dataset.toolId===id)?.querySelector('[data-part="progress"]');
const activateProgressLink = async (p, link, fields = {}) => { const event=link.dispatch("click",fields);await p.flush();return event; };
const chooseBook = (p, link, fields = {}) => el(p, "start-book-links").dispatch("click", { target: link, ...fields });
function clock() {
  let now=0, seq=0; const tasks=new Map();
  return { setTimeout(fn, ms=0) { const id=++seq; tasks.set(id,{at:now+ms,fn}); return id; }, clearTimeout(id) { tasks.delete(id); },
    async advance(ms,p) { const end=now+ms; await p.flush(); for (;;) { const next=[...tasks].filter(([,v])=>v.at<=end).sort((a,b)=>a[1].at-b[1].at||a[0]-b[0])[0]; if(!next)break; now=next[1].at; tasks.delete(next[0]); next[1].fn(); await p.flush(); } now=end; await p.flush(); } };
}

test("starter progress mirrors every stage and duplicate without replacing links or focus", async () => {
  const tool=tools.find(t=>t.id==="day003"),p=await runPage({search:"?q=day003"});
  const demos=links(p),labels=starterProgress(p);
  assert.equal(labels.length,15);
  assert.ok(labels.every(n=>!n.hidden && n.textContent==="進捗：未着手"));
  const select=el(p,"tool-list").querySelector('[data-part="progress"]');select.focus();
  for(const [level,text] of [[1,"学習中"],[2,"一周完了"],[3,"定着済み"],[0,"未着手"]]) {
    chooseProgress(select,level);
    assert.ok(labels.filter(n=>n.dataset.toolId===tool.id).every(n=>n.textContent===`進捗：${text}`));
    assert.equal(p.document.activeElement,select);assert.deepEqual(links(p),demos);assert.deepEqual(starterProgress(p),labels);
  }
  p.values.set(`progress_${tool.slug}`,"2");p.dispatch("storage",{key:`progress_${tool.slug}`});p.dispatch("pageshow",{persisted:true});
  assert.ok(labels.filter(n=>n.dataset.toolId===tool.id).every(n=>n.textContent==="進捗：一周完了"));
  el(p,"lang-en").click();assert.ok(labels.filter(n=>n.dataset.toolId===tool.id).every(n=>n.textContent==="Progress: First pass"));
  assert.deepEqual(starterProgress(p),labels);
});

test("starter progress hides during loading and preserves effective failed writes through refresh and reset", async () => {
  const pending=await runPage({deferData:true});assert.ok(starterProgress(pending).every(n=>n.hidden));
  await pending.releaseData();assert.ok(starterProgress(pending).every(n=>!n.hidden));
  const p=await runPage({search:"?q=day003",storageFailure:"write",confirmResult:true});
  chooseProgress(el(p,"tool-list").querySelector('[data-part="progress"]'),3);
  p.dispatch("storage",{key:null});p.dispatch("pageshow",{persisted:true});
  assert.ok(starterProgress(p).filter(n=>n.dataset.toolId==="day003").every(n=>n.textContent==="進捗：定着済み"));
  p.evaluate("handleResetAllProgress()");assert.ok(starterProgress(p).every(n=>n.textContent==="進捗：未着手"));
  p.evaluate('setLoadState("error")');assert.ok(starterProgress(p).every(n=>n.hidden));
});

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

test("Start entry selection includes all tools, closes both guides and survives language changes", async () => {
  const p=await runPage(), demos=links(p);
  const selected = name => {
    for (const item of ["first", "books", "all"]) {
      const button=el(p,`start-${item}-button`);
      assert.equal(button.getAttribute("aria-pressed"),String(item===name));
      if(item!=="all") {
        assert.equal(button.getAttribute("aria-expanded"),String(item===name));
        assert.equal(el(p,`start-${item}-panel`).hidden,item!==name);
      } else assert.equal(button.hasAttribute("aria-expanded"),false);
    }
  };
  selected("first"); chooseGenre(p,"web");
  const href=p.context.location.href, length=p.context.history.length;
  for (const name of ["all", "all", "first", "books", "all", "books", "first"]) {
    const button=el(p,`start-${name}-button`); button.focus();button.click();
    selected(name);
    assert.equal(p.document.activeElement,button);
    assert.equal(el(p,"start-here").open,true);
    assert.equal(p.context.location.href,href);assert.equal(p.context.history.length,length);
    assert.equal(el(p,"start-genre").value,"web");assert.deepEqual(links(p),demos);
    for(const language of ["en","ja"]) {
      el(p,`lang-${language}`).click();selected(name);
    }
  }
  assert.equal(p.values.get("hlo_start_genre"),"web");
  assert.equal(p.values.get("hlo_start_here"),"closed");
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
  assert.equal(el(pending,"start-first-button").getAttribute("aria-pressed"),"true");
  assert.equal(el(pending,"start-all-button").getAttribute("aria-pressed"),"false");
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
    assert.equal(el(p,"start-all-button").getAttribute("aria-pressed"),"true");
    assert.equal(el(p,"start-first-panel").hidden,true);assert.equal(el(p,"start-books-panel").hidden,true);
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

for(const language of ["ja","en"]) {
  test(`SH23 ${language}: all fifteen named progress links reach the native control without changing records`, async () => {
    const tool=tools.find(t=>t.id==="day003");
    const p=await runPage({search:`?lang=${language}`,storedValues:{[`progress_${tool.slug}`]:"2",later_day003:"1"}});
    const nodes=starterProgress(p),ids=nodes.map(link=>link.id),records=recordValues(p);
    assert.equal(nodes.length,15);assert.equal(new Set(ids).size,15);
    for(const [group,toolIds] of Object.entries(starterGroups)) {
      chooseGenre(p,group);
      for(const id of toolIds) {
        const link=progressLink(p,group,id),target=tools.find(t=>t.id===id);
        assert.equal(link.tagName,"A");assert.equal(link.hidden,false);
        assert.ok(link.id.includes(group)&&link.id.includes(id),"Source links need distinct genre and Day identities for Back focus");
        assert.equal(link.getAttribute("href"),`#${id}`);
        const name=link.getAttribute("aria-label");
        assert.ok(name.includes(target.title)&&name.includes(`Day${id.slice(3)}`)&&name.includes(link.textContent));
        assert.match(name,language==="ja" ? /進捗欄へ移動/ : /[Gg]o to progress/);
        const before=p.document.scrollCalls?.length || 0;
        assert.equal((await activateProgressLink(p,link)).defaultPrevented,true);
        const control=progressControl(p,id);
        assert.equal(control.tagName,"SELECT");assert.equal(p.document.activeElement,control);
        assert.equal(p.context.location.hash,`#${id}`);
        assert.ok(p.document.scrollCalls.slice(before).some(call=>call.element===control),"The destination control must be scrolled into view");
        assert.deepEqual(recordValues(p),records);assert.deepEqual(starterProgress(p),nodes);
      }
    }
  });

  test(`SH24 ${language}: a progress link keeps matching filters and reaches the first duplicate book card`, async () => {
    const book=books.find(b=>b.slug==="genai-crypto"),grouped=HB.buildGroups(book,tools).flatMap(g=>g.items);
    const id=starterGroups.crypto.find(id=>grouped.filter(t=>t.id===id).length>1);
    assert.ok(id,"Fixture needs a starter that occurs in multiple chapters");
    const tool=tools.find(t=>t.id===id),cat=tool.category_ids[0];
    const p=await runPage({search:`?lang=${language}&book=${book.slug}&cat=${cat}&q=${id}`,storedValues:{[`progress_${tool.slug}`]:"2",[`later_${id}`]:"1"}});
    chooseGenre(p,"crypto");
    const filter=el(p,"filter-progress");filter.value="2";filter.dispatch("change");
    const later=el(p,"filter-later");later.checked=true;later.dispatch("change");
    const records=recordValues(p),link=progressLink(p,"crypto",id);
    await activateProgressLink(p,link,{detail:0}); // A native Enter activation dispatches a click with detail 0.
    assert.equal(el(p,"filter-book").value,book.slug);assert.equal(el(p,"filter-category").value,cat);
    assert.equal(el(p,"filter-search-input").value,id);assert.equal(filter.value,"2");assert.equal(later.checked,true);
    const matches=p.document.querySelectorAll(".tool-card").filter(card=>card.dataset.toolId===id);
    assert.ok(matches.length>1);assert.equal(p.document.activeElement,matches[0].querySelector('[data-part="progress"]'));
    const url=new URL(p.context.location.href);assert.equal(url.searchParams.has("progress"),false);assert.equal(url.searchParams.has("later"),false);
    assert.deepEqual(recordValues(p),records);
  });
}

test("SH25: progress navigation clears only conflicts; Back restores every condition and the originating duplicate link", async () => {
  const tool=tools.find(t=>t.id==="day050"),cat=tool.category_ids[0];
  const p=await runPage({search:`?book=genai-crypto&cat=${cat}&q=no-starter-can-match-this&lang=en`,storedValues:{progress_caesar:"2",later_day003:"1"}});
  el(p,"start-here").open=true;chooseGenre(p,"physical");
  const progress=el(p,"filter-progress");progress.value="3";progress.dispatch("change");
  const later=el(p,"filter-later");later.checked=true;later.dispatch("change");
  const link=progressLink(p,"physical",tool.id),before=p.context.location.href,length=p.context.history.length,records=recordValues(p);
  link.focus();p.context.scrollY=284;
  await activateProgressLink(p,link);
  assert.equal(p.context.history.length,length+1);assert.equal(el(p,"filter-book").value,"");
  assert.equal(el(p,"filter-category").value,cat,"The matching category must survive unrelated conflicts");
  assert.equal(el(p,"filter-search-input").value,"");assert.equal(progress.value,"all");assert.equal(later.checked,false);
  assert.equal(p.document.activeElement,progressControl(p,tool.id));
  const destination=p.context.location.href;
  for(let i=0;i<2;i++) {
    await p.back();
    assert.equal(p.context.location.href,before);assert.equal(el(p,"filter-book").value,"genai-crypto");
    assert.equal(el(p,"filter-category").value,cat);assert.equal(el(p,"filter-search-input").value,"no-starter-can-match-this");
    assert.equal(progress.value,"3");assert.equal(later.checked,true);
    assert.equal(p.document.activeElement,link,"Back must restore the physical link, not the recommended duplicate");
    assert.equal(p.context.scrollY,284);assert.deepEqual(recordValues(p),records);
    await p.forward();
    assert.equal(p.context.location.href,destination);assert.equal(el(p,"filter-book").value,"");
    assert.equal(el(p,"filter-search-input").value,"");assert.equal(progress.value,"all");assert.equal(later.checked,false);
    assert.equal(p.document.activeElement,progressControl(p,tool.id));assert.deepEqual(recordValues(p),records);
  }
  assert.equal(p.context.history.length,length+1);
});

test("SH26: ordinary hashes keep heading focus; repeated progress activation focuses the control without another history entry", async () => {
  const p=await runPage({search:"?lang=en#day003"}),link=progressLink(p,"recommended","day003"),records=recordValues(p);
  el(p,"start-here").open=true;
  assert.equal(p.document.activeElement,el(p,"day003").querySelector(".tool-title"));
  const length=p.context.history.length;
  for(const fields of [{},{detail:0},{}]) {
    link.focus();const before=p.document.scrollCalls.length;
    assert.equal((await activateProgressLink(p,link,fields)).defaultPrevented,true);
    assert.equal(p.context.history.length,length);assert.equal(p.document.activeElement,progressControl(p,"day003"));
    assert.ok(p.document.scrollCalls.slice(before).some(call=>call.element===progressControl(p,"day003")));
  }
  await p.navigateHash("#day008");
  assert.equal(p.document.activeElement,el(p,"day008").querySelector(".tool-title"));
  assert.deepEqual(recordValues(p),records);
});

test("SH27: progress links preserve native modified/middle activation and respect an already cancelled click", async () => {
  const p=await runPage({search:"?q=day008"}),link=progressLink(p,"recommended","day003");
  el(p,"start-here").open=true;
  const href=p.context.location.href,length=p.context.history.length,records=recordValues(p),writes=p.storageCalls.write;
  el(p,"filter-search-input").focus();const focused=p.document.activeElement;
  for(const fields of [{ctrlKey:true},{metaKey:true},{shiftKey:true},{altKey:true},{button:1},{defaultPrevented:true}]) {
    assert.equal((await activateProgressLink(p,link,fields)).defaultPrevented,!!fields.defaultPrevented);
    assert.equal(link.getAttribute("href"),"#day003");assert.equal(p.context.location.href,href);assert.equal(p.context.history.length,length);
    assert.equal(p.document.activeElement,focused);assert.deepEqual(recordValues(p),records);assert.equal(p.storageCalls.write,writes);
  }
});

test("SH28: loading and nonpublic starters cannot navigate; retry reuses the same links and public tools do not require demos", async () => {
  const pending=await runPage({deferData:true}),nodes=starterProgress(pending);
  for(const link of nodes) { assert.equal(link.hidden,true);assert.equal(link.hasAttribute("href"),false);assert.equal(link.dispatch("click").defaultPrevented,true); }
  assert.equal(pending.context.history.length,1);await pending.releaseData();
  assert.deepEqual(starterProgress(pending),nodes);assert.ok(nodes.every(link=>!link.hidden&&link.hasAttribute("href")));
  const failed=await runPage({allowLoadFailure:true,fetchResponse(name,_,attempt){if(name==="data/tools.json"&&attempt===1)return {ok:false,status:503};}});
  const failedNodes=starterProgress(failed);
  assert.ok(failedNodes.every(link=>link.hidden&&!link.hasAttribute("href")));
  for(const link of failedNodes)assert.equal(link.dispatch("click").defaultPrevented,true);
  el(failed,"retry-data").click();await failed.flush();assert.deepEqual(starterProgress(failed),failedNodes);
  el(failed,"start-here").open=true;
  await activateProgressLink(failed,failedNodes[0]);assert.equal(failed.document.activeElement,progressControl(failed,failedNodes[0].dataset.toolId));
  const data=JSON.parse(read("data/tools.json"));
  data.tools=data.tools.filter(t=>t.id!=="day003");data.tools.find(t=>t.id==="day050").hub=false;data.tools.find(t=>t.id==="day077").demo_url="";
  const p=await runPage({dataOverrides:{"data/tools.json":data}});
  el(p,"start-here").open=true;
  for(const id of ["day003","day050"])for(const link of starterProgress(p).filter(link=>link.dataset.toolId===id)) {
    assert.equal(link.hidden,true);assert.equal(link.hasAttribute("href"),false);assert.equal(link.dispatch("click").defaultPrevented,true);
  }
  const publicLink=progressLink(p,"recommended","day077");assert.equal(publicLink.hidden,false);
  await activateProgressLink(p,publicLink);assert.equal(p.document.activeElement,progressControl(p,"day077"));
});

test("SH29: progress links preserve node identity and focused source across language, storage and record import", async () => {
  const tool=tools.find(t=>t.id==="day003"),p=await runPage({search:"?q=day003",confirmResult:true});
  el(p,"start-here").open=true;
  const nodes=starterProgress(p),link=progressLink(p,"recommended",tool.id),control=progressControl(p,tool.id);
  chooseProgress(control,1);link.focus();el(p,"lang-en").click();
  assert.equal(p.document.activeElement,link);assert.deepEqual(starterProgress(p),nodes);
  p.values.set(`progress_${tool.slug}`,"2");p.dispatch("storage",{key:`progress_${tool.slug}`});p.dispatch("pageshow",{persisted:true});
  assert.equal(p.document.activeElement,link);assert.deepEqual(starterProgress(p),nodes);
  const text=JSON.stringify({app:"hackinglab-online",schema_version:2,saved_at:"2026-11-07T00:00:00.000Z",progress:{[tool.id]:3},try_later:[tool.id]});
  el(p,"records-file").files=[{size:Buffer.byteLength(text),text:async()=>text}];
  await p.evaluate("handleRecordsImport()");await p.flush();
  assert.equal(p.document.activeElement,link);assert.deepEqual(starterProgress(p),nodes);
  for(const node of nodes.filter(node=>node.dataset.toolId===tool.id)) {
    assert.equal(node.textContent,"Progress: Mastered");assert.ok(node.getAttribute("aria-label").includes(node.textContent));assert.equal(node.getAttribute("href"),`#${tool.id}`);
  }
  assert.equal(p.values.get(`progress_${tool.slug}`),"3");assert.equal(p.values.get(`later_${tool.id}`),"1");
  el(p,"records-export").click();const saved=JSON.parse(await p.downloads[0].blob.text());
  assert.deepEqual(saved.progress,{[tool.id]:3});assert.deepEqual(saved.try_later,[tool.id]);
  const records=recordValues(p);await activateProgressLink(p,link);
  assert.equal(p.document.activeElement,progressControl(p,tool.id));assert.equal(p.document.activeElement.value,"3");assert.deepEqual(recordValues(p),records);
});

test("SH30: a starter inside a shared set keeps its order; an outside starter leaves the set and Back restores it", async () => {
  const p=await runPage({search:"?tools=8,3&lang=en"}),records=recordValues(p);
  el(p,"start-here").open=true;
  const inside=progressLink(p,"recommended","day003");
  await activateProgressLink(p,inside);
  assert.deepEqual(p.document.querySelectorAll(".tool-card").map(card=>card.dataset.toolId),["day008","day003"]);
  assert.equal(p.document.activeElement,progressControl(p,"day003"));assert.equal(new URL(p.context.location.href).searchParams.get("tools"),"day008,day003");
  const before=p.context.location.href,outside=progressLink(p,"recommended","day050");
  await activateProgressLink(p,outside);
  assert.equal(el(p,"set-banner").hidden,true);assert.equal(new URL(p.context.location.href).searchParams.has("tools"),false);
  assert.equal(p.document.activeElement,progressControl(p,"day050"));
  await p.back();assert.equal(p.context.location.href,before);assert.equal(p.document.activeElement,outside);
  assert.deepEqual(p.document.querySelectorAll(".tool-card").map(card=>card.dataset.toolId),["day008","day003"]);
  await p.forward();assert.equal(p.document.activeElement,progressControl(p,"day050"));assert.deepEqual(recordValues(p),records);
});

test("SH31: progress activation waits for rapid category cancellation and keeps a single restorable destination", async () => {
  const p=await runPage({search:"?lang=en",storedValues:{progress_caesar:"2",later_day008:"1"}}),records=recordValues(p);
  el(p,"start-here").open=true;
  const progress=el(p,"filter-progress");progress.value="3";progress.dispatch("change");
  const category=el(p,"filter-category"),link=progressLink(p,"recommended","day003");
  category.value="authentication";category.dispatch("change");
  category.value="";category.dispatch("change");
  assert.ok(p.evaluate("!!droppingPush"),"Fixture must activate before the pending history.back resolves");
  assert.equal(link.dispatch("click").defaultPrevented,true);await p.flush();
  assert.equal(p.context.location.hash,"#day003");assert.equal(new URL(p.context.location.href).searchParams.has("cat"),false);
  assert.equal(category.value,"");assert.equal(progress.value,"all");assert.equal(p.document.activeElement,progressControl(p,"day003"));
  assert.equal(p.context.history.length,2);assert.deepEqual(recordValues(p),records);
  await p.back();
  assert.equal(p.context.location.hash,"");assert.equal(category.value,"");assert.equal(progress.value,"3");assert.equal(p.document.activeElement,link);
  await p.forward();assert.equal(p.context.location.hash,"#day003");assert.equal(p.document.activeElement,progressControl(p,"day003"));
  assert.deepEqual(recordValues(p),records);
});

test("SH32: a queued progress activation yields to later keyboard, pointer or wheel interaction", async () => {
  for(const action of ["keydown","pointerdown","wheel"]) {
    const p=await runPage(),records=recordValues(p),category=el(p,"filter-category"),link=progressLink(p,"recommended","day003");
    el(p,"start-here").open=true;
    category.value="authentication";category.dispatch("change");
    category.value="";category.dispatch("change");
    assert.ok(p.evaluate("!!droppingPush"));assert.equal(link.dispatch("click").defaultPrevented,true);
    const search=el(p,"filter-search-input");search.focus();p.dispatch(action,{key:"d"});
    if(action==="keydown") { search.value="day008";search.dispatch("input"); }
    await p.flush();
    assert.equal(p.context.location.hash,"",`A stale progress activation changed the URL after ${action}`);
    assert.equal(category.value,"");assert.equal(p.document.activeElement,search,`A stale progress activation stole focus after ${action}`);
    assert.equal(new URL(p.context.location.href).searchParams.get("q"),action==="keydown" ? "day008" : null);
    assert.deepEqual(recordValues(p),records);
  }
});

test("SH33: clearing a conflicting search retains post-layout correction and saves the final progress-control location", async () => {
  const p=await runPage({search:"?q=no-starter-can-match-this&lang=en"}),records=recordValues(p);
  el(p,"start-here").open=true;const link=progressLink(p,"recommended","day003");
  const before=p.document.scrollCalls?.length || 0;
  assert.equal(link.dispatch("click").defaultPrevented,true);
  const control=progressControl(p,"day003"),card=control.closest(".tool-card");
  control.getBoundingClientRect=()=>({top:-p.context.scrollY,bottom:44-p.context.scrollY});
  let released=false;const remove=card.classList.remove;
  card.classList.remove=(...names)=>{
    remove(...names);
    if(names.includes("cv-hold")) { released=true;p.context.scrollY+=394; }
  };
  await p.flush();
  assert.equal(released,true);assert.equal(el(p,"filter-search-input").value,"");
  assert.equal(new URL(p.context.location.href).searchParams.has("q"),false);
  assert.ok(Math.abs(control.getBoundingClientRect().top)<1,"Canonicalizing the cleared query must not disable the later position correction");
  assert.equal(p.document.activeElement,control);assert.equal(p.document.scrollCalls.length,before+1);
  assert.equal(p.document.querySelectorAll(".cv-hold").length,0);assert.equal(p.context.history.state.y,p.context.scrollY);
  await p.back();assert.equal(el(p,"filter-search-input").value,"no-starter-can-match-this");assert.equal(p.document.activeElement,link);
  await p.forward();assert.equal(p.document.activeElement,progressControl(p,"day003"));assert.equal(p.context.scrollY,0);
  assert.deepEqual(recordValues(p),records);
});

test("SH34: progress-control layout correction yields to later user scrolling or focus changes", async () => {
  for(const action of ["wheel","focus"]) {
    const p=await runPage({search:"?q=no-starter-can-match-this"});el(p,"start-here").open=true;
    const link=progressLink(p,"recommended","day003");link.dispatch("click");
    const control=progressControl(p,"day003"),card=control.closest(".tool-card"),remove=card.classList.remove;
    control.getBoundingClientRect=()=>({top:-p.context.scrollY,bottom:44-p.context.scrollY});
    card.classList.remove=(...names)=>{
      remove(...names);
      if(names.includes("cv-hold")) {
        p.context.scrollY=394;
        if(action==="wheel")p.dispatch("wheel");
        else el(p,"filter-search-input").focus();
      }
    };
    await p.flush();assert.equal(p.context.scrollY,394,`Progress-link correction stole scrolling after ${action}`);
    if(action==="focus")assert.equal(p.document.activeElement,el(p,"filter-search-input"));
  }
});

for(const language of ["ja","en"]) {
  test(`SH35 ${language}: Forward to a now-excluded progress card preserves filters and offers visible empty-result recovery`, async () => {
    const tool=tools.find(t=>t.id==="day003");
    const p=await runPage({search:`?lang=${language}&book=genai-crypto&cat=classic-crypto&q=day003`,storedValues:{later_day008:"1"}});
    el(p,"start-here").open=true;chooseGenre(p,"crypto");
    const progress=el(p,"filter-progress");progress.value="0";progress.dispatch("change");
    const source=progressLink(p,"crypto",tool.id),origin=p.context.location.href;
    await activateProgressLink(p,source);
    const control=progressControl(p,tool.id),duplicates=p.document.querySelectorAll(".tool-card");
    assert.equal(duplicates.length,2);assert.ok(duplicates.every(card=>card.dataset.toolId===tool.id));
    chooseProgress(control,2);
    assert.deepEqual(p.document.querySelectorAll(".tool-card"),duplicates,"Changing progress must keep both live chapter cards in place until navigation");
    assert.ok(duplicates.every(card=>card.querySelector('[data-part="progress"]').value==="2"));
    assert.equal(p.document.activeElement,control);assert.equal(progress.value,"0");
    const records=recordValues(p),destination=p.context.location.href;
    await p.back();assert.equal(p.context.location.href,origin);assert.equal(p.document.activeElement,source);
    const before=p.document.scrollCalls.length;
    await p.forward();
    assert.equal(p.context.location.href,destination);assert.equal(el(p,"filter-book").value,"genai-crypto");
    assert.equal(el(p,"filter-category").value,"classic-crypto");assert.equal(el(p,"filter-search-input").value,"day003");assert.equal(progress.value,"0");
    assert.equal(p.document.querySelectorAll(".tool-card").length,0);
    const clear=el(p,"clear-filters");assert.ok(clear&&clear.getClientRects().length>0);assert.equal(p.document.activeElement,clear);
    const scroll=p.document.scrollCalls.slice(before).find(call=>call.element===clear);
    assert.ok(scroll,"An unavailable saved card must lead to the empty result's visible recovery control");
    assert.equal(scroll.options.behavior,"instant");assert.equal(scroll.options.block,"nearest");
    assert.equal(p.document.focusCalls.filter(call=>call.element===clear).at(-1).options.preventScroll,true);
    assert.deepEqual(recordValues(p),records);
    clear.click();await p.flush();
    assert.equal(el(p,"filter-book").value,"genai-crypto");assert.equal(el(p,"filter-category").value,"");
    assert.equal(el(p,"filter-search-input").value,"");assert.equal(progress.value,"all");assert.equal(p.context.location.hash,"");
    const recovered=p.document.querySelectorAll(".tool-card").filter(card=>card.dataset.toolId===tool.id);
    assert.equal(recovered.length,2);assert.ok(recovered.every(card=>card.querySelector('[data-part="progress"]').value==="2"));
    assert.equal(p.document.activeElement,el(p,"filter-search-input"));assert.deepEqual(recordValues(p),records);
  });
}

async function savedStarterReadingPosition() {
  const timer=clock(),p=await runPage({search:"?q=day077",clock:timer,storedValues:{later_day008:"1"}});
  el(p,"start-here").open=true;
  const source=progressLink(p,"recommended","day077"),card=p.document.querySelector(".tool-card"),control=progressControl(p,"day077");
  el(p,"site-header").getBoundingClientRect=()=>({top:0,bottom:80,height:80});
  el(p,"tool-list").getBoundingClientRect=()=>({top:1500-p.context.scrollY});
  card.getBoundingClientRect=()=>({top:2000-p.context.scrollY,bottom:2300-p.context.scrollY,height:300});
  control.getBoundingClientRect=()=>({top:2040-p.context.scrollY,bottom:2084-p.context.scrollY,height:44});
  p.context.scrollY=1800;const origin=p.context.location.href;
  await activateProgressLink(p,source);await timer.advance(0,p);
  p.context.scrollY=1900;p.evaluate("saveViewInHistory()");
  assert.equal(p.context.history.state.anchor.offset,20);
  return {p,timer,card,control,source,origin,destination:p.context.location.href,records:recordValues(p)};
}

test("SH36: saved-view Back and Forward repair a release-time 81px shift without losing their reading offsets or focus", async () => {
  const {p,timer,card,control,source,origin,destination,records}=await savedStarterReadingPosition();
  const remove=card.classList.remove;let released=0;
  card.classList.remove=(...names)=>{
    const held=card.classList.contains("cv-hold");remove(...names);
    if(held&&names.includes("cv-hold")) { p.context.scrollY+=81;released++; }
  };
  const scrollCalls=p.document.scrollCalls.length,length=p.context.history.length;
  for(const [direction,href,y,offset,focus] of [["back",origin,1800,120,source],["forward",destination,1900,20,control]]) {
    await p[direction]();
    assert.equal(p.context.scrollY,y,"The existing immediate anchor restoration must still run");
    const before=released;await timer.advance(0,p);
    assert.equal(released,before+1,"Fixture must model the release after the initial restoration");
    assert.equal(p.context.scrollY,y,`${direction} left the release-time adjustment uncorrected`);
    assert.equal(card.getBoundingClientRect().top-80,offset);
    assert.equal(p.context.location.href,href);assert.equal(p.document.activeElement,focus);
    assert.equal(p.document.querySelectorAll(".cv-hold").length,0);assert.deepEqual(recordValues(p),records);
  }
  assert.equal(p.document.scrollCalls.length,scrollCalls,"Saved views must not jump to their hash again");
  assert.equal(p.context.history.length,length);
});

test("SH37: saved-view release correction yields to newer wheel, keyboard and history navigation", async () => {
  for(const action of ["wheel","keydown","navigation"]) {
    const {p,timer,card,records}=await savedStarterReadingPosition();
    const remove=card.classList.remove;let released=false;
    card.classList.remove=(...names)=>{
      const held=card.classList.contains("cv-hold");remove(...names);
      if(!held||!names.includes("cv-hold"))return;
      released=true;p.context.scrollY+=81;
      if(action==="navigation") {
        const view={y:p.context.scrollY,focus:"#filter-search-input",progress:"all",later:false};
        p.context.history.pushState(view,"","?q=day077&navigation=newer");
        p.dispatch("popstate",{state:view});
      } else {
        p.dispatch(action,{key:"ArrowDown"});
        if(action==="keydown")el(p,"filter-search-input").focus();
      }
    };
    await p.back();assert.equal(p.context.scrollY,1800);await timer.advance(0,p);
    assert.equal(released,true);assert.equal(p.context.scrollY,1881,`An old correction overrode ${action}`);
    assert.equal(p.document.querySelectorAll(".cv-hold").length,0);assert.deepEqual(recordValues(p),records);
    if(action!=="wheel")assert.equal(p.document.activeElement,el(p,"filter-search-input"));
    if(action==="navigation")assert.equal(new URL(p.context.location.href).searchParams.get("navigation"),"newer");
  }
});
