"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { runPage, read, ROOT } = require("./helpers/page.js");
const catalog = () => JSON.parse(read("data/tools.json"));
const baseTitles = { ja: "ハッキング・ラボ・オンライン｜IPUSIRONのセキュリティツールで独学", en: "Hacking Lab Online | Self-study with IPUSIRON's security tools" };
const el = (p, id) => p.document.getElementById(id);

test("P1: base titles follow language during loading and ordinary views without replacing set/day contexts", async () => {
  const pending=await runPage({search:"?lang=en",deferData:true});
  assert.equal(pending.document.title,baseTitles.en);await pending.releaseData();
  for (const search of ["", "?book=genai-crypto", "?cat=authentication", "?tab=dashboard"]) {
    const p=await runPage({search});assert.equal(p.document.title,baseTitles.ja);
    el(p,"lang-en").click();assert.equal(p.document.title,baseTitles.en);
    el(p,"lang-ja").click();assert.equal(p.document.title,baseTitles.ja);
  }
  const p=await runPage({search:"?tools=3,8&lang=en"});
  assert.equal(p.document.title,"Tools in this link (2) | Hacking Lab Online");
  el(p,"lang-ja").click();assert.equal(p.document.title,"このリンクのツール（2本）｜ハッキング・ラボ・オンライン");
  el(p,"start-all-button").click();assert.equal(p.document.title,baseTitles.ja);
  await p.back();assert.equal(p.document.title,"このリンクのツール（2本）｜ハッキング・ラボ・オンライン");
  await p.forward();assert.equal(p.document.title,baseTitles.ja);
  await p.navigateHash("#day003");const tool=catalog().tools.find(t=>t.id==="day003");
  assert.equal(p.document.title,`${tool.title}（Day003）｜ハッキング・ラボ・オンライン`);
  el(p,"lang-en").click();assert.equal(p.document.title,`${tool.title} (Day003) | Hacking Lab Online`);
  await p.navigateHash("#");assert.equal(p.document.title,baseTitles.en);
});

test("P2: actual catalog dates use Tokyo day boundaries and reformat on language changes", async () => {
  for (const [timestamp,ja,en] of [["2026-10-31T14:59:59Z","2026年10月31日","Oct 31, 2026"],["2026-10-31T15:00:00Z","2026年11月1日","Nov 1, 2026"],["2026-11-01T00:30:00+10:00","2026年10月31日","Oct 31, 2026"],["2024-02-29T00:00:00Z","2024年2月29日","Feb 29, 2024"]]) {
    const data=catalog();data.generated_at=timestamp;
    const p=await runPage({dataOverrides:{"data/tools.json":data}});
    assert.equal(el(p,"last-updated-value").textContent,ja);
    el(p,"lang-en").click();assert.equal(el(p,"last-updated-value").textContent,en);
    el(p,"lang-ja").click();assert.equal(el(p,"last-updated-value").textContent,ja);
  }
});

test("P3: invalid or missing dates use the placeholder without inventing today's date", async () => {
  const p=await runPage();
  for(const value of [undefined,null,"",123,"not a date","2026-02-30T00:00:00Z","2026-11-01","2026-11-01T00:00:00","2026-13-01T00:00:00Z"]) {
    for(const lang of ["ja","en"])assert.equal(p.evaluate(`formatCatalogDate(${JSON.stringify(value)},${JSON.stringify(lang)})`),"-");
  }
  const data=catalog();data.generated_at="not a date";
  const invalid=await runPage({dataOverrides:{"data/tools.json":data}});
  assert.equal(el(invalid,"main-content").dataset.loadState,"ready");assert.equal(el(invalid,"last-updated-value").textContent,"-");
  el(invalid,"lang-en").click();assert.equal(el(invalid,"last-updated-value").textContent,"-");
});

test("P4: share text uses actual whole-catalog progress independently of the selected set, without posting", async () => {
  const data=catalog();data.tools.at(-1).hub=false;
  const visible=data.tools.filter(t=>t.hub!==false), saved={};
  visible.slice(0,3).forEach((t,i)=>{saved[`progress_${t.slug}`]=String(i+1);});
  saved[`progress_${data.tools.at(-1).slug}`]="3";
  const p=await runPage({search:"?tools=3,8",storedValues:saved,dataOverrides:{"data/tools.json":data}});
  const calls=[];p.context.open=(...args)=>calls.push(args);
  for(const language of ["ja","en"]) {
    el(p,`lang-${language}`).click();el(p,"share-on-x").click();
    const [href,target,features]=calls.at(-1), url=new URL(href), lines=url.searchParams.get("text").split("\n");
    assert.equal(url.origin+url.pathname,"https://twitter.com/intent/tweet");assert.equal(target,"_blank");assert.equal(features,"noopener");
    assert.equal(lines[0],language==="ja" ? "「ハッキング・ラボ・オンライン」で、ツールを2本一周しました（うち定着済み1本）🔬📚" : "I've worked through 2 tools at Hacking Lab Online (1 mastered) 🔬");
    const shared=new URL(lines[1]);assert.equal(shared.searchParams.get("lang"),language==="en" ? "en" : null);assert.equal(shared.searchParams.has("tools"),false);
  }
  assert.equal(calls.length,2);
});

test("P5: card accessible names preserve literal tool text without inserting markup or changing starter link labels", async () => {
  const data=catalog(),tool=data.tools.find(t=>t.id==="day003");tool.title='<img src=x onerror=alert(1)> & "quoted"';
  const p=await runPage({search:"?lang=en#day003",dataOverrides:{"data/tools.json":data}});
  const card=el(p,"day003");assert.equal(card.querySelector("img"),null);
  assert.equal(card.querySelector(".tool-title").getAttribute("aria-label"),`Day003 ${tool.title}`);
  assert.equal(card.querySelector('[data-part="demo"]').getAttribute("aria-label"),`Demo (${tool.title}, opens in a new tab)`);
  assert.equal(p.document.querySelector('.start-demo[data-tool-id="day003"]').getAttribute("aria-label"),`Open demo (${tool.title}, new tab)`);
});

test("P6: static discovery metadata has one Japanese description, a large local image and the root canonical", async () => {
  const p=await runPage(),doc=p.document;
  const meta=(attr,key)=>{const found=doc.querySelectorAll(`meta[${attr}="${key}"]`);assert.equal(found.length,1);return found[0].getAttribute("content");};
  const description="『ハッキング・ラボのつくりかた』の著者IPUSIRONが生成AIで作ったセキュリティツール100本超を、カテゴリや本から探して、手を動かしながら独学できるサイトです。ツールの多くはブラウザーだけで動きます。登録は要らず、進捗は使っているブラウザーにだけ残ります。";
  assert.equal(meta("name","description"),description);assert.equal(meta("property","og:description"),description);
  assert.equal(meta("property","og:title"),baseTitles.ja);assert.equal(meta("property","og:site_name"),"ハッキング・ラボ・オンライン（Hacking Lab Online）");
  assert.equal(meta("property","og:url"),"https://hackinglab.online/");assert.equal(doc.querySelector('link[rel="canonical"]').href,"https://hackinglab.online/");
  assert.equal(meta("property","og:image"),"https://hackinglab.online/assets/social/hackinglab-online.png");
  assert.equal(meta("property","og:image:width"),"1200");assert.equal(meta("property","og:image:height"),"630");
  assert.equal(meta("property","og:image:alt"),"ハッキング・ラボ・オンライン：手を動かして仕組みを知る、IPUSIRONのセキュリティツール");assert.equal(meta("name","twitter:card"),"summary_large_image");
  assert.equal(meta("name","twitter:image"),meta("property","og:image"));
  el(p,"lang-en").click();assert.equal(meta("property","og:title"),baseTitles.ja);
});

test("P7: standalone recovery page is bilingual, script-free and resolves its real book links/assets from a nested missing URL", () => {
  const html=read("404.html"), origin="https://hackinglab.online/missing/deep/path", books=JSON.parse(read("data/books.json")).books;
  assert.match(html,/<title>ページが見つかりません｜ハッキング・ラボ・オンライン<\/title>/);
  assert.match(html,/<meta name="robots" content="noindex"/);assert.match(html,/default-src 'none'/);assert.match(html,/style-src 'self'/);
  assert.doesNotMatch(html,/<script|\son\w+=|\sstyle=|http-equiv="refresh"|target=/i);
  for(const lang of ["ja","en"]) {
    const section=html.match(new RegExp(`<section[^>]*lang="${lang}"[\\s\\S]*?<\\/section>`))[0];
    const links=[...section.matchAll(/<a href="([^"]+)"/g)].map(m=>new URL(m[1].replaceAll("&amp;","&"),origin));
    assert.equal(links.length,3);assert.equal(links[0].pathname,"/");assert.equal(links[0].searchParams.get("book"),null);
    assert.deepEqual(links.slice(1).map(u=>u.searchParams.get("book")),["security-tools-100","security-tools-200"]);
    for(const u of links) {assert.equal(u.origin,"https://hackinglab.online");assert.equal(u.pathname,"/");assert.equal(u.searchParams.get("lang"),lang==="en"?"en":null);if(u.searchParams.has("book"))assert.ok(books.some(b=>b.slug===u.searchParams.get("book")));}
  }
  for(const [,raw] of html.matchAll(/<link[^>]+href="([^"]+)"/g)) {
    assert.match(raw,/^\/(?!\/)/);const u=new URL(raw,origin);assert.ok(fs.existsSync(path.join(ROOT,u.pathname)));
  }
});

test("P8: the tab list starts the main landmark and filters have one localized search landmark", async () => {
  for(const language of ["ja","en"]){
    const p=await runPage({search:`?lang=${language}`,deferData:true});
    assert.equal(p.document.querySelectorAll("main").length,1);
    assert.equal(el(p,"main-content").firstElementChild.id,"tab-nav");
    assert.equal(el(p,"tab-nav").getAttribute("role"),"tablist");
    const filters=el(p,"tool-filters");
    assert.equal(p.document.querySelectorAll('[role="search"]').length,1);
    assert.equal(filters.getAttribute("role"),"search");
    assert.equal(filters.getAttribute("aria-label"),language==="ja"?"絞り込みの条件":"Filters");
    await p.releaseData();
    el(p,language==="ja"?"lang-en":"lang-ja").click();
    assert.equal(filters.getAttribute("aria-label"),language==="ja"?"Filters":"絞り込みの条件");
  }
  const book=await runPage({search:"?book=genai-crypto",width:320});
  assert.equal(el(book,"tool-filters").getClientRects().length,0,"Folded filters must not expose a landmark");
  el(book,"filter-toggle").click();
  assert.ok(el(book,"tool-filters").getClientRects().length>0);
  const set=await runPage({search:"?tools=3,8"});
  assert.equal(el(set,"tool-filters").getClientRects().length,0,"Sets exclude filters and their landmark");
});

test("P9: title language follows title text in flat, book and set cards while subtitles follow the view", async () => {
  const data=catalog();
  const examples=[
    ["Cipher Tool","en"],["暗号 Tool","ja"],["ひらがな Tool","ja"],
    ["カタカナ Tool","ja"],["ｶﾅ Tool","ja"],["\u{20000} Tool","ja"]
  ];
  const expected=new Map(examples.map(([title,lang],index)=>{
    const tool=data.tools[index];tool.title=title;tool.subtitle_ja="日本語の副題";tool.subtitle_en="English subtitle";
    return [tool.id,{title,lang}];
  }));
  for(const search of ["","?book=genai-crypto","?tools="+[...expected.keys()].join(",")]){
    const p=await runPage({search,dataOverrides:{"data/tools.json":data}});
    for(const language of ["ja","en"]){
      el(p,`lang-${language}`).click();
      const cards=p.document.querySelectorAll(".tool-card").filter(card=>expected.has(card.dataset.toolId));
      assert.ok(cards.length>0);
      for(const card of cards){
        const value=expected.get(card.dataset.toolId),heading=card.querySelector(".tool-title"),subtitle=card.querySelector(".tool-subtitle");
        assert.equal(heading.lang,value.lang);
        assert.equal(heading.textContent,value.title);
        assert.equal(heading.getAttribute("aria-label"),`Day${card.dataset.toolId.slice(3)} ${value.title}`);
        assert.equal(heading.tagName,search.includes("book=")?"H4":"H3");
        assert.equal(card.getAttribute("lang"),null,"Title language must not reach the whole card");
        assert.equal(subtitle.getAttribute("lang"),null);
        assert.equal(subtitle.textContent,language==="ja"?"日本語の副題":"English subtitle");
        assert.equal(p.document.documentElement.lang,language);
      }
    }
  }
});
