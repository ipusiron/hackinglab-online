"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const U = require("../js/url.js");
const B = require("../scripts/build_pages.js");
const { runPage, read, chooseProgress } = require("./helpers/page.js");
const catalog = JSON.parse(read("data/tools.json")), books = JSON.parse(read("data/books.json"));
const repo = "https://github.com/example/tool";
const E = (p,id) => p.document.getElementById(id);

test("UL1 optional usage metadata is strict, bounded and language-local", () => {
  for(const value of [{}, {ja:{status:"top"}}, {en:{status:"missing"}}, {ja:{status:"heading",fragment:"a".repeat(512)}}])assert.equal(U.validReadmeUsage(value),true);
  for(const value of [null,[],{fr:{status:"top"}},{ja:{}},{ja:{status:"url",href:repo}},{ja:{status:"top",fragment:"x"}},
    ...["", "#usage", "%E4%BD%BF", "x/y", "x?y", "x y", "x\n", "a".repeat(513)].map(fragment=>({ja:{status:"heading",fragment}}))])assert.equal(U.validReadmeUsage(value),false,JSON.stringify(value));
  assert.equal(U.repoLink(repo,"ja",{ja:{status:"top"},en:{status:"url",href:"https://evil.example"}}),repo+"/blob/HEAD/README.md");
});

test("UL2 raw fragments preserve observed hyphens, marks and duplicates and encode exactly once", () => {
  for(const fragment of ["-使い方","usage-1","\ufe0f-使い方","x\u200dy","e\u0301","𐐀"]){
    const usage={ja:{status:"heading",fragment},en:{status:"heading",fragment}};
    for(const lang of ["ja","en"]){
      const target=U.readmeTarget(repo,lang,usage);
      assert.equal(target.href,repo+"/blob/HEAD/README"+(lang==="en"?".en":"")+".md#"+encodeURIComponent(fragment));
      assert.equal(target.lang,lang);assert.equal(decodeURIComponent(new URL(target.href).hash.slice(1)),fragment);
    }
  }
});

test("UL3 invalid metadata cannot change the trusted repository, and invalid repositories have no target", () => {
  for(const usage of [null,[],{href:"https://evil.example"},{en:{status:"heading",fragment:"https://evil.example"}},{en:{status:"top",href:"javascript:alert(1)"}}]){
    assert.equal(U.repoLink(repo,"en",usage),repo+"/blob/HEAD/README.en.md");
  }
  for(const bad of ["javascript:alert(1)","https://github.com.evil.example/a/b","https://user@github.com/a/b","http://github.com/a/b",repo+"?x=1",repo+"#a",repo+"/tree/main",repo+"\n","https://github.com/../tool","https://github.com/user/.."]){
    assert.equal(U.repoLink(bad,"ja",{ja:{status:"heading",fragment:"usage"}}),"",bad);
  }
});

test("UL4 confirmed missing English always opens Japanese top; unknown English remains distinct", () => {
  const usage={ja:{status:"heading",fragment:"使い方"},en:{status:"missing"}};
  assert.deepEqual(U.readmeTarget(repo,"en",usage),{href:repo+"/blob/HEAD/README.md",lang:"ja"});
  assert.deepEqual(U.readmeTarget(repo,"en",{ja:usage.ja}),{href:repo+"/blob/HEAD/README.en.md",lang:"en"});
  assert.equal(U.repoLink(repo,"ja",usage),repo+"/blob/HEAD/README.md#"+encodeURIComponent("使い方"));
});

test("UL5 actual cards use the language target, exact accessible name and decorative icons only on card actions", async () => {
  const data=JSON.parse(JSON.stringify(catalog)), tool=data.tools.find(t=>t.id==="day003");
  tool.readme_usage={ja:{status:"heading",fragment:"-使い方"},en:{status:"missing"}};
  const p=await runPage({search:"?q=day003&lang=en",dataOverrides:{"data/tools.json":data}});
  for(const lang of ["en","ja"]){
    E(p,"lang-"+lang).click();const card=p.document.querySelector(".tool-card"),usage=card.querySelector('[data-part="repo"]');
    assert.equal(usage.textContent,lang==="ja"?"使い方":"Usage");
    assert.equal(usage.href,U.repoLink(tool.repo_url,lang,tool.readme_usage));
    assert.equal(usage.getAttribute("hreflang"),"ja");
    assert.equal(usage.getAttribute("aria-label"),lang==="ja"?`使い方（${tool.title}のREADME、新しいタブで開く）`:`Usage (${tool.title} README, opens in a new tab)`);
    for(const link of card.querySelectorAll("a.tool-button")){
      assert.equal(link.target,"_blank");assert.equal(link.rel,"noopener");
      const icon=link.querySelector("svg");assert.equal(icon.namespaceURI,"http://www.w3.org/2000/svg");
      assert.equal(icon.getAttribute("aria-hidden"),"true");assert.equal(icon.getAttribute("focusable"),"false");
      assert.equal(icon.querySelectorAll("marker").length,0);assert.equal(icon.querySelector("polygon").getAttribute("fill"),"currentColor");
    }
    assert.equal(p.document.querySelectorAll(".external-link-icon").length,card.querySelectorAll("a.tool-button").length);
  }
  assert.equal(E(p,"help-dialog").querySelectorAll("svg").length,0);
});

test("UL6 malformed optional metadata never blocks required catalog loading", async () => {
  for(const usage of [undefined,null,{ja:{status:"heading",fragment:"%20"}},{en:{status:"missing",fragment:"x"}}]){
    const data=JSON.parse(JSON.stringify(catalog)),tool=data.tools.find(t=>t.id==="day003");tool.readme_usage=usage;
    const p=await runPage({search:"?q=day003&lang=en",dataOverrides:{"data/tools.json":data}});
    assert.equal(p.evaluate("loadState"),"ready");assert.equal(p.document.querySelector('[data-part="repo"]').href,U.repoLink(tool.repo_url,"en",usage));
  }
});

test("UL7 duplicate retained cards preserve progress focus and language-specific README targets", async () => {
  const data=JSON.parse(JSON.stringify(catalog));
  const book=books.books.find(b=>b.slug==="genai-crypto"),id=Object.keys(book.refs).find(id=>new Set(book.refs[id].map(ref=>ref.ch)).size>1);
  const tool=data.tools.find(t=>t.id===id);
  tool.readme_usage={ja:{status:"heading",fragment:"使い方"},en:{status:"heading",fragment:"usage"}};
  const p=await runPage({search:"?book=genai-crypto&lang=en",dataOverrides:{"data/tools.json":data}});
  E(p,"filter-progress").value="0";E(p,"filter-progress").dispatch("change");
  const cards=p.document.querySelectorAll(`.tool-card[data-slug="${tool.slug}"]`);assert.ok(cards.length>1);
  const control=cards[0].querySelector("select");control.focus();chooseProgress(control,2);await p.flush();
  assert.equal(p.document.activeElement,control);
  for(const card of cards){assert.equal(card.isConnected,true);assert.equal(card.classList.contains("is-outside"),true);assert.equal(card.querySelector('[data-part="repo"]').href,U.repoLink(tool.repo_url,"en",tool.readme_usage));}
  E(p,"lang-ja").click();for(const card of p.document.querySelectorAll(`.tool-card[data-slug="${tool.slug}"]`))assert.equal(card.querySelector('[data-part="repo"]').href,U.repoLink(tool.repo_url,"ja",tool.readme_usage));
});

test("UL8 static list shares the Japanese target without new controls or icons", () => {
  const data=JSON.parse(JSON.stringify(catalog)),tool=data.tools.find(t=>t.id==="day003");
  tool.readme_usage={ja:{status:"heading",fragment:"使い方"},en:{status:"heading",fragment:"usage"}};
  const output=B.buildPage(data,books),old=B.buildPage(catalog,books);
  assert.ok(output.includes(U.repoLink(tool.repo_url,"ja",tool.readme_usage)));
  assert.equal((output.match(/>GitHub README<\/a>/g)||[]).length,(old.match(/>GitHub README<\/a>/g)||[]).length);
  assert.doesNotMatch(output,/<svg|README\.en\.md/);assert.equal(output,B.buildPage(data,books));
});
