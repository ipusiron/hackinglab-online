"use strict";
// Execute the actual HTML-connected scripts and real JSON through the small DOM in helpers/page.js.
// Layout, computed CSS, actual browser storage, Back/Forward and accessibility remain browser QA.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const B = require("../js/books.js");
const U = require("../js/url.js");
const { runPage, read } = require("./helpers/page.js");
const allTools = JSON.parse(read("data/tools.json")).tools;
const visible = allTools.filter((t) => t.hub !== false);
const books = JSON.parse(read("data/books.json")).books;
const bySlug = new Map(visible.map((t) => [t.slug, t]));

function checkCards(document, language, book = null) {
  const list = document.getElementById("tool-list");
  const cards = list.querySelectorAll(".tool-card");
  const selected = book ? B.expandTargetIds(book, allTools) : new Set(visible.map((t) => t.id));
  const groups = book?.chapters?.length ? B.buildGroups(book, allTools).filter((g) => g.items.length) : null;
  const expected = groups ? groups.flatMap((g) => g.items.map((t) => ({ slug: t.slug, group: g.key })))
    : visible.filter((t) => selected.has(t.id)).map((t) => ({ slug: t.slug, group: "" }));
  assert.ok(expected.length > 0, "Fixture must exercise at least one card");
  assert.deepEqual(cards.map((c) => ({ slug: c.dataset.slug, group: c.dataset.group || "" })), expected,
    `Missing, duplicate or out-of-order cards (${language}, ${book?.slug || "all"})`);
  const headings = list.querySelectorAll(".book-group-heading");
  assert.deepEqual(headings.map((h) => h.id), groups ? groups.map((g) => "book-group-" + g.key) : []);
  headings.forEach((heading, i) => {
    assert.ok(heading.textContent.includes(groups[i]["label_" + language]), "Wrong chapter language");
    assert.ok(heading.textContent.includes(String(groups[i].items.length)), "Chapter count is absent");
  });
  const assignedIds = cards.map((card) => card.id).filter(Boolean);
  assert.equal(new Set(assignedIds).size, assignedIds.length, "Card IDs must stay unique even in multiple chapters");
  assert.deepEqual([...new Set(cards.map((card) => bySlug.get(card.dataset.slug).id))].sort(), [...assignedIds].sort());
  for (const card of cards) {
    const tool = bySlug.get(card.dataset.slug);
    assert.equal(card.querySelector(".tool-title")?.textContent, tool.title);
    assert.equal(card.querySelector(".tool-title").tagName, "H3");
    assert.equal(card.querySelector(".tool-title").getAttribute("tabindex"), "-1");
    assert.equal(card.querySelector(".tool-subtitle")?.textContent, tool["subtitle_" + language]);
    const description = card.querySelector(".tool-description")?.textContent;
    assert.ok(description && tool["description_" + language].startsWith(description.replace(/…$/, "")), `${tool.id}: wrong/empty description`);
    const repo = card.querySelector('[data-part="repo"]');
    assert.equal(repo?.href, U.repoLink(tool.repo_url, language), `${tool.id}: repository link`);
    const demo = card.querySelector('[data-part="demo"]');
    assert.equal(!!demo, !!tool.demo_url, `${tool.id}: demo presence`);
    if (demo) assert.equal(demo.href, U.demoLink(tool.demo_url, language));
    const progress = card.querySelector('[data-part="progress"]');
    assert.equal(progress?.tagName, "BUTTON", `${tool.id}: no progress control`);
    assert.ok(progress.textContent.length > 0);
    assert.deepEqual(card.querySelectorAll(".tool-book-ref").map((n) => n.textContent),
      book ? B.formatRef(book, tool.id, language) : [], `${tool.id}: book references`);
  }
  const banner = document.getElementById("book-banner");
  assert.equal(banner.hidden, !book);
  if (book) assert.ok(banner.textContent.includes(B.bookTitle(book, language)), "Book title missing from banner");
  return cards;
}

for (const language of ["ja", "en"]) {
  test(`R1: all ${visible.length} visible tools render in ${language} from index.html`, async () => {
    const { document, fetched } = await runPage({ search: `?lang=${language}` });
    assert.equal(document.documentElement.lang, language);
    checkCards(document, language);
    assert.ok(document.getElementById("overall-total").textContent.includes(String(visible.length)), "Dashboard total");
    assert.deepEqual([...new Set(fetched)].sort(), ["data/books.json", "data/categories.json", "data/tools.json"]);
  });
  for (const book of books) {
    test(`R2: ${book.slug} renders its real cards/chapters in ${language}`, async () => {
      const { document } = await runPage({ search: `?lang=${language}&book=${encodeURIComponent(book.slug)}` });
      checkCards(document, language, book);
      assert.equal(document.getElementById("filter-book").value, book.slug, "Book selector and rendered list disagree");
    });
  }
  for (const storageFailure of ["getter", "read", "write"]) {
    test(`R3: ${language} renders and progress/book actions survive localStorage ${storageFailure} throwing`, async () => {
      const page = await runPage({ search: `?lang=${language}`, storageFailure });
      const cards = checkCards(page.document, language);
      const progress = cards[0].querySelector('[data-part="progress"]');
      progress.dispatch("click");
      assert.ok(progress.classList.contains("progress-1"), "Progress did not update using the memory fallback");
      assert.ok(page.document.getElementById("overall-n1").textContent.endsWith("1"), "Dashboard did not update after progress");
      const select = page.document.getElementById("filter-book");
      select.value = books[0].slug;
      select.dispatch("change");
      checkCards(page.document, language, books[0]);
      assert.ok(page.storageCalls[storageFailure] > 0, `The test never exercised ${storageFailure}`);
      assert.deepEqual(page.messages.filter((m) => ["warn", "error"].includes(m.level)), []);
    });
  }
}

for (const language of ["ja", "en"]) {
  test(`R4: ${language} keeps every card visible and omits unknown/invalid difficulty badges`, async () => {
    const fixture = JSON.parse(read("data/tools.json"));
    const cases = [null, undefined, 0, 6, "3", 1, 5];
    cases.forEach((value, i) => {
      if (value === undefined) delete fixture.tools[i].difficulty;
      else fixture.tools[i].difficulty = value;
    });
    const { document } = await runPage({ search: `?lang=${language}`, dataOverrides: { "data/tools.json": fixture } });
    const cards = checkCards(document, language);
    cases.forEach((value, i) => {
      const card = cards.find((c) => c.dataset.slug === fixture.tools[i].slug);
      assert.ok(card, `Card disappeared for difficulty=${String(value)}`);
      const badge = card.querySelector(".tool-difficulty");
      if (value === 1 || value === 5) {
        assert.ok(badge, `Missing valid difficulty=${value}`);
        assert.equal((badge.textContent.match(/★/g) || []).length, value);
      } else assert.equal(badge, null, `Unknown/invalid difficulty=${String(value)} must not appear as a rating`);
    });
  });
}
