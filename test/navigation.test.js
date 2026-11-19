"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { runPage, read } = require("./helpers/page.js");
const B = require("../js/books.js");
const allTools = JSON.parse(read("data/tools.json")).tools;
const visible = allTools.filter((t) => t.hub !== false);
const books = JSON.parse(read("data/books.json")).books;
const crypto = books.find((b) => b.slug === "genai-crypto");
const cards = (p) => p.document.querySelectorAll("#tool-list .tool-card");
const ids = (p) => cards(p).map((c) => c.id);
const status = (p) => p.document.getElementById("link-status").textContent;
const title = (p, id) => p.document.getElementById(id)?.querySelector(".tool-title");
const selected = (p, id, value) => { const el=p.document.getElementById(id); el.value=value; el.dispatch("change"); };
const fixture = () => JSON.parse(read("data/tools.json"));

for (const lang of ["ja", "en"]) {
  test(`N1 ${lang}: a single visible tool has a unique anchor and a focused semantic heading`, async () => {
    const p=await runPage({search:`?lang=${lang}#day3`});
    const h=title(p,"day003");
    assert.equal(h.tagName,"H3"); assert.equal(h.getAttribute("tabindex"),"-1");
    assert.equal(p.document.activeElement,h);
    assert.equal(p.document.scrollCalls.length,1);
    assert.match(p.document.title,lang==="ja" ? /（Day003）｜ハッキング/ : /\(Day003\) \| Hacking/);
    const before=p.document.scrollCalls.length;
    selected(p,"filter-category","authentication");
    assert.equal(p.document.scrollCalls.length,before,"A filter render must not reapply the hash");
  });
  test(`N2 ${lang}: set order, deduplication, notices, title and per-card position`, async () => {
    const requested=visible.slice(0,14).map((t)=>t.id).reverse();
    const p=await runPage({search:`?lang=${lang}&book=genai-crypto&cat=authentication&q=nomatch&tools=${requested.join(',')},${requested[0]},day999`});
    assert.deepEqual(ids(p),requested.slice(0,12));
    assert.equal(p.document.getElementById("book-banner").hidden,true);
    assert.equal(p.document.getElementById("tool-filters").hidden,true);
    assert.equal(p.document.getElementById("filter-book").value,"");
    assert.equal(p.document.getElementById("filter-search-input").value,"");
    assert.match(status(p),lang==="ja" ? /見つからない.*最初の12本/ : /could not be found.*first 12/);
    assert.ok(!status(p).includes("day999"));
    assert.equal(cards(p)[0].querySelector(".tool-set-position").textContent,"1 / 12");
    assert.equal(cards(p)[0].querySelector(".tool-set-position").getAttribute("aria-label"),lang==="ja" ? "12本中1本目" : "1 of 12");
    assert.equal(p.document.querySelector(".set-banner-details").open,false);
    assert.match(p.document.title,lang==="ja" ? /このリンクのツール（12本）｜/ : /Tools in this link \(12\) \|/);
    cards(p)[0].querySelector('[data-part="progress"]').dispatch("click");
    assert.deepEqual(ids(p),requested.slice(0,12),"Progress must not reorder a set");
  });
}

test("N3: hidden/unknown/empty set IDs never produce cards or raw-value notices",async()=>{
  const data=fixture(); data.tools.find((t)=>t.id==="day003").hub=false;
  const p=await runPage({search:"?book=genai-crypto&q=nomatch&tools=day003,%3Cscript%3E,999",dataOverrides:{"data/tools.json":data}});
  assert.equal(cards(p).length,visible.length-1);
  assert.equal(p.document.getElementById("day003"),null);
  assert.match(status(p),/このリンクのツールが見つからない/);
  assert.ok(!status(p).includes("script"));
  const empty=await runPage({search:"?tools="});
  assert.equal(cards(empty).length,visible.length);
  assert.match(status(empty),/このリンクのツールが見つからない/);
});

test("N4: single hash clears only hiding filters and reports book/filter reasons separately",async()=>{
  const target=visible.find((t)=>!B.expandTargetIds(crypto,allTools).has(t.id));
  const cat=target.category_ids[0];
  const p=await runPage({search:`?book=genai-crypto&cat=${cat}&q=unmatchable#${target.id}`});
  assert.equal(p.document.getElementById("filter-book").value,"");
  assert.equal(p.document.getElementById("filter-category").value,cat,"Matching category must remain");
  assert.equal(p.document.getElementById("filter-search-input").value,"");
  assert.match(status(p),/このツールは選んだ本に入っていない/);
  assert.match(status(p),/リンクのツールが今の絞り込みに入っていない/);
  assert.equal(p.document.activeElement,title(p,target.id));
  const onlyBook=await runPage({search:`?book=genai-crypto#${target.id}`});
  assert.match(status(onlyBook),/このツールは選んだ本に入っていない/);
  assert.ok(!status(onlyBook).includes("今の絞り込み"));
});

test("N5: duplicate book cards have one ID and single-tool focus selects the first instance",async()=>{
  const grouped=B.buildGroups(crypto,allTools).flatMap((g)=>g.items);
  const counts=new Map();grouped.forEach((t)=>counts.set(t.id,(counts.get(t.id)||0)+1));
  const duplicate=[...counts].find(([,n])=>n>1)[0];
  const p=await runPage({search:`?book=genai-crypto#${duplicate}`});
  const matches=cards(p).filter((c)=>c.dataset.slug===visible.find((t)=>t.id===duplicate).slug);
  assert.ok(matches.length>1);
  assert.equal(matches.filter((c)=>c.id===duplicate).length,1);
  assert.equal(matches[0].id,duplicate);
  assert.equal(p.document.activeElement,matches[0].querySelector(".tool-title"));
});

test("N6: a hash within a set keeps order; outside or unknown hashes clear the set",async()=>{
  const p=await runPage({search:"?tools=3,8#day008"});
  assert.deepEqual(ids(p),["day003","day008"]);
  assert.equal(p.document.activeElement,title(p,"day008"));
  await p.navigateHash("#day001");
  assert.equal(cards(p).length,visible.length);
  assert.equal(p.document.getElementById("set-banner").hidden,true);
  assert.equal(p.document.activeElement,title(p,"day001"));
  assert.match(status(p),/今の絞り込み/);
  await p.navigateHash("#day999");
  assert.equal(cards(p).length,visible.length);
  assert.match(status(p),/リンクで指定されたツールが見つからない/);
  assert.ok(!status(p).includes("day999"));
});

test("N7: Clear pushes once; Back/Forward restores set and saved view without re-jumping",async()=>{
  const p=await runPage({search:"?tools=3,8#day008"});
  const clear=p.document.getElementById("set-banner-clear");clear.focus();
  p.context.scrollY=456;
  const initialJumps=p.document.scrollCalls.length;
  clear.dispatch("click");
  assert.equal(p.context.history.length,2);
  assert.equal(cards(p).length,visible.length);
  await p.back();
  assert.deepEqual(ids(p),["day003","day008"]);
  assert.equal(p.context.scrollY,456);
  assert.equal(p.document.activeElement.id,"set-banner-clear");
  assert.equal(p.document.scrollCalls.length,initialJumps,"popstate/hashchange must not replace saved position with hash jump");
  await p.forward();
  assert.equal(cards(p).length,visible.length);
  assert.equal(p.document.getElementById("set-banner").hidden,true);
});

test("N8: hash-only history navigates exactly once and keyboard progress does not jump again",async()=>{
  const p=await runPage();
  await p.navigateHash("#day003");
  await p.navigateHash("#day008");
  assert.equal(p.document.scrollCalls.length,2);
  await p.back();
  assert.equal(p.document.activeElement,title(p,"day003"));
  assert.equal(p.document.scrollCalls.length,3,"One popstate plus hashchange must produce one jump");
  title(p,"day003").closest(".tool-card").querySelector('[data-part="progress"]').dispatch("click");
  assert.equal(p.document.scrollCalls.length,3);
});

test("N9: navigation before data uses only the latest hash and never announces false unknown",async()=>{
  const p=await runPage({search:"?tools=3,8#day003",deferData:true});
  assert.equal(status(p),"");
  await p.navigateHash("#day008");
  await p.navigateHash("#day001");
  assert.equal(status(p),"");
  assert.equal(p.document.getElementById("load-fallback").hidden,true);
  await p.releaseData();
  assert.equal(p.document.activeElement,title(p,"day001"));
  assert.equal(p.document.scrollCalls.length,1);
  assert.equal(cards(p).length,visible.length);
});

test("N10: hash normalization is applied once and unrelated chapter hashes retain chapter behavior",async()=>{
  const p=await runPage({search:"#%64ay003"});
  assert.equal(p.document.activeElement,title(p,"day003"));
  const q=await runPage({search:"?book=genai-crypto#book-group-ch01"});
  assert.equal(q.document.activeElement.id,"book-group-ch01");
  const link=q.document.querySelector('.book-jump-link[href="#book-group-ch02"]');
  const length=q.context.history.length;link.dispatch("click");
  assert.equal(q.context.history.length,length);
  assert.equal(q.context.location.hash,"#book-group-ch02");
});

for(const mode of ["success","reject"])test(`N11 ${mode}: set copy allowlists IDs/language and supports denied clipboard`,async()=>{
  const p=await runPage({search:"?lang=en&tools=8,3,8&book=genai-crypto&secret=not-copied#day008",clipboard:mode});
  p.document.getElementById("set-banner-copy").dispatch("click");await p.flush();
  const expected="https://hackinglab.online/?tools=day008%2Cday003&lang=en";
  if(mode==="success"){
    assert.deepEqual(p.copied,[expected]);assert.match(status(p),/Link copied\./);
  }else{
    assert.deepEqual(p.copied,[]);assert.match(status(p),/Couldn't copy the link/);
    const field=p.document.getElementById("set-banner-copy-url");
    assert.equal(field.value,expected);assert.equal(field.readOnly,true);
    assert.equal(field.selectionStart,0);assert.equal(field.selectionEnd,expected.length);
    assert.equal(p.document.activeElement,field);
  }
});

test("N12: language switches retain set order/notices and refresh title without navigation",async()=>{
  const p=await runPage({search:"?tools=8,3,999"});
  p.document.getElementById("lang-en").dispatch("click");
  assert.deepEqual(ids(p),["day008","day003"]);
  assert.match(status(p),/Some tools in this link could not be found/);
  assert.equal(p.document.title,"Tools in this link (2) | Hacking Lab Online");
  assert.equal(p.context.history.length,1);
  assert.equal(p.document.scrollCalls?.length||0,0);
});

test("N13: required-data failures reveal only the static-list fallback, even on dashboard",async()=>{
  for(const failure of [404,"reject"]){
    const p=await runPage({search:"?tab=dashboard&tools=999#day999",dataFailures:{"data/tools.json":failure},allowLoadFailure:true});
    assert.equal(p.document.getElementById("load-fallback").hidden,false);
    assert.equal(p.document.getElementById("set-banner").hidden,true);
    assert.equal(status(p),"");
    assert.equal(cards(p).length,0);
    assert.equal(p.document.getElementById("share-on-x").disabled,true);
  }
});

test("N14: selecting a book from the dashboard exits the set and Back restores it",async()=>{
  const p=await runPage({search:"?tools=3,8"});
  p.document.querySelector('[data-tab-target="tab-dashboard"]').dispatch("click");
  p.document.querySelector(".book-progress-title").dispatch("click");
  assert.equal(p.document.getElementById("set-banner").hidden,true);
  assert.ok(!new URLSearchParams(p.context.location.search).has("tools"));
  await p.back();
  assert.equal(p.document.getElementById("tab-dashboard").hidden,false);
  assert.ok(new URLSearchParams(p.context.location.search).has("tools"));
});

test("N15: initial set links open Tools; saved dashboard history still wins on return",async()=>{
  const p=await runPage({search:"?tools=3,8&tab=dashboard#day008"});
  assert.equal(p.document.getElementById("tab-tools").hidden,false);
  p.document.querySelector('[data-tab-target="tab-dashboard"]').dispatch("click");
  p.context.scrollY=123;
  p.document.querySelector(".book-progress-title").dispatch("click");
  await p.back();
  assert.equal(p.document.getElementById("tab-dashboard").hidden,false);
  assert.equal(p.context.scrollY,123);
});

test("N16: manual category/search/progress changes clear single hashes; reload respects the chosen filter",async()=>{
  for(const kind of ["category","search","progress"]){
    const p=await runPage({search:"#day003"});
    if(kind==="category") selected(p,"filter-category",visible.find((t)=>t.id==="day003").category_ids[0]);
    if(kind==="progress") selected(p,"filter-progress","1");
    if(kind==="search") { const el=p.document.getElementById("filter-search-input");el.value="unlikelymatch";el.dispatch("input"); }
    assert.equal(p.context.location.hash,"");
    assert.ok(!p.document.title.includes("Day003"));
    if(kind!=="progress"){
      const again=await runPage({search:p.context.location.search});
      assert.deepEqual(ids(again),ids(p));
    }
  }
  const p=await runPage({search:"?book=genai-crypto#book-group-ch01"});
  selected(p,"filter-progress","1");
  assert.equal(p.context.location.hash,"#book-group-ch01","Existing chapter hash behavior stays unchanged");
});

test("N17: progress filters are restored in history state without entering shared URLs",async()=>{
  const p=await runPage();
  cards(p)[0].querySelector('[data-part="progress"]').dispatch("click");
  selected(p,"filter-progress","1");
  assert.equal(cards(p).length,1);
  p.document.querySelector('[data-tab-target="tab-dashboard"]').dispatch("click");
  p.document.querySelector('[data-tab-target="tab-tools"]').dispatch("click");
  selected(p,"filter-progress","all");
  await p.back(); await p.back();
  assert.equal(p.document.getElementById("filter-progress").value,"1");
  assert.equal(cards(p).length,1);
  assert.ok(!p.context.location.search.includes("progress"));
});

test("N18: delayed-data history preserves the newest saved position/progress",async()=>{
  const p=await runPage({search:"#day003",deferData:true});
  p.context.history.replaceState({y:321,focus:"#filter-progress",progress:"1"},"","#day003");
  p.context.history.pushState(null,"","#day008");
  await p.back(); await p.releaseData();
  assert.equal(p.context.scrollY,321);
  assert.equal(p.document.getElementById("filter-progress").value,"1");
  assert.equal(p.document.activeElement.id,"filter-progress");
  assert.equal(p.document.scrollCalls?.length||0,0);
});

test("N19: clipboard failure or an old async result cannot outlive a language change",async()=>{
  const p=await runPage({search:"?tools=3,8",clipboard:"reject"});
  p.document.getElementById("set-banner-copy").dispatch("click");await p.flush();
  assert.ok(p.document.getElementById("set-banner-copy-url"));
  p.document.getElementById("lang-en").dispatch("click");
  assert.equal(p.document.getElementById("set-banner-copy-url"),null);
  assert.ok(!status(p).includes("copy the link"));
  let resolve;
  p.context.navigator.clipboard.writeText=()=>new Promise((r)=>{resolve=r;});
  p.document.getElementById("set-banner-copy").dispatch("click");
  p.document.getElementById("lang-ja").dispatch("click");
  resolve();await p.flush();
  assert.equal(status(p),"");
});

test("N20: set details survive ordinary redraw and have a reusable focus key",async()=>{
  const p=await runPage({search:"?tools=3,8"});
  const summary=p.document.getElementById("set-banner-details-summary");
  summary.dispatch("click");summary.focus();
  cards(p)[0].querySelector('[data-part="progress"]').dispatch("click");
  assert.equal(p.document.querySelector(".set-banner-details").open,true);
  assert.equal(p.document.getElementById("set-banner-details-summary"),summary);
  p.document.getElementById("lang-en").dispatch("click");
  assert.equal(p.document.activeElement.id,"set-banner-details-summary");
});

test("N21: ordinary category/tab history and rapid-select cancellation use real history events",async()=>{
  const p=await runPage();
  const first=visible[0].category_ids[0];
  selected(p,"filter-category",first);
  assert.equal(p.context.history.length,2);
  selected(p,"filter-category",""); await p.flush();
  assert.equal(p.context.location.search,"");
  assert.equal(cards(p).length,visible.length);
  assert.ok(p.events.includes("popstate"));
  p.document.querySelector('[data-tab-target="tab-dashboard"]').dispatch("click");
  await p.back();
  assert.equal(p.document.getElementById("tab-tools").hidden,false);
});

test("N22: native fragment BODY reset is repaired once without resolving the URL twice",async()=>{
  const p=await runPage({search:"#day003"});
  const scrolls=p.document.scrollCalls.length;
  await p.navigateHash("#day045",()=>{p.document.activeElement=p.document.body;});
  assert.equal(p.document.activeElement,title(p,"day045"));
  assert.equal(p.document.scrollCalls.length,scrolls+1);
  const focuses=p.document.focusCalls.filter((call)=>call.element===title(p,"day045"));
  assert.equal(focuses.length,2,"Initial focus plus one post-native repair");
  assert.ok(focuses.every((call)=>call.options.preventScroll));
});

test("N23: delayed native-focus repair respects pointer, keyboard, wheel and language changes",async()=>{
  for(const action of ["pointerdown","keydown","wheel","language"]){
    const p=await runPage({search:"?lang=en#day003"});
    let expected;
    await p.navigateHash("#day045",()=>{
      p.document.activeElement=p.document.body;
      if(action==="language") p.document.getElementById("lang-ja").dispatch("click");
      else {
        if(action==="keydown") p.document.getElementById("filter-search-input").focus();
        p.dispatch(action);
      }
      expected=p.document.activeElement;
    });
    assert.equal(p.document.activeElement,expected,`Focus stolen after ${action}`);
    assert.notEqual(p.document.activeElement,title(p,"day045"));
  }
});

test("N24: layout anchoring after releasing a distant card is corrected without a second fragment scroll",async()=>{
  const p=await runPage({search:"#day003"});
  const count=p.document.scrollCalls.length;
  let released=false;
  await p.navigateHash("#day045",()=>{
    const card=p.document.getElementById("day045");
    const heading=title(p,"day045");
    heading.getBoundingClientRect=()=>({top:-p.context.scrollY,bottom:90-p.context.scrollY});
    const remove=card.classList.remove;
    card.classList.remove=(...names)=>{
      remove(...names);
      if(names.includes("cv-hold")){
        released=true;
        p.context.scrollY+=394; // Model the browser anchoring adjustment observed after paint.
      }
    };
  });
  assert.equal(released,true);
  assert.ok(Math.abs(title(p,"day045").getBoundingClientRect().top)<1);
  assert.equal(p.document.activeElement,title(p,"day045"));
  assert.equal(p.document.scrollCalls.length,count+1);
  assert.equal(p.document.querySelectorAll(".cv-hold").length,0);
});

test("N25: post-layout correction yields to newer navigation, focus or user scrolling",async()=>{
  for(const action of ["wheel","focus","url"]){
    const p=await runPage({search:"#day003"});
    await p.navigateHash("#day045",()=>{
      const card=p.document.getElementById("day045");
      title(p,"day045").getBoundingClientRect=()=>({top:-p.context.scrollY,bottom:90-p.context.scrollY});
      const remove=card.classList.remove;
      card.classList.remove=(...names)=>{
        remove(...names);
        if(names.includes("cv-hold")){
          p.context.scrollY=394;
          if(action==="wheel") p.dispatch("wheel");
          if(action==="focus") p.document.getElementById("filter-search-input").focus();
          if(action==="url") p.context.history.replaceState(null,"","#day050");
        }
      };
    });
    assert.equal(p.context.scrollY,394,`Scroll stolen after ${action}`);
    if(action==="focus") assert.equal(p.document.activeElement.id,"filter-search-input");
  }
});
