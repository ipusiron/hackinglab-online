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
    assert.equal(lines[0],language==="ja" ? "「ハッキング・ラボ・オンライン」で学習進捗を管理中🔬📚" : "Tracking my progress on Hacking Lab Online 🔬");
    assert.equal(lines[1],language==="ja" ? `全${visible.length}ツール：未着手${visible.length-3}／学習中1／一周完了1／定着済み1` : `All ${visible.length} tools: Not started ${visible.length-3} / In progress 1 / First pass 1 / Mastered 1`);
    const shared=new URL(lines[2]);assert.equal(shared.searchParams.get("lang"),language==="en" ? "en" : null);assert.equal(shared.searchParams.has("tools"),false);
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

test("P6: static discovery metadata has one Japanese description, the existing local image and the root canonical", async () => {
  const p=await runPage(),doc=p.document;
  const meta=(attr,key)=>{const found=doc.querySelectorAll(`meta[${attr}="${key}"]`);assert.equal(found.length,1);return found[0].getAttribute("content");};
  const description="『ハッキング・ラボのつくりかた』の著者IPUSIRONが生成AIで作ったセキュリティツール100本超を、カテゴリや本から探して、手を動かしながら独学できるサイトです。ツールの多くはブラウザーだけで動きます。登録は要らず、進捗は使っているブラウザーにだけ残ります。";
  assert.equal(meta("name","description"),description);assert.equal(meta("property","og:description"),description);
  assert.equal(meta("property","og:title"),baseTitles.ja);assert.equal(meta("property","og:site_name"),"ハッキング・ラボ・オンライン（Hacking Lab Online）");
  assert.equal(meta("property","og:url"),"https://hackinglab.online/");assert.equal(doc.querySelector('link[rel="canonical"]').href,"https://hackinglab.online/");
  assert.equal(meta("property","og:image"),"https://hackinglab.online/favicon/HLO_glitch_hex.png");
  assert.equal(meta("property","og:image:alt"),"ハッキング・ラボ・オンラインのロゴ");assert.equal(meta("name","twitter:card"),"summary");
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
