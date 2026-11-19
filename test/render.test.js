"use strict";
// Execute the actual HTML-connected scripts and real JSON through the small DOM in helpers/page.js.
// Layout, computed CSS, actual browser storage, Back/Forward and accessibility remain browser QA.
const { test } = require("node:test");
const assert = require("node:assert/strict");
const B = require("../js/books.js");
const U = require("../js/url.js");
const { runPage, read, chooseProgress } = require("./helpers/page.js");
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
    assert.ok(heading.textContent.includes(B.chapterTitle(book, groups[i].key, language)), "Wrong chapter language");
    assert.ok(heading.textContent.includes(String(groups[i].items.length)), "Chapter count is absent");
  });
  const assignedIds = cards.map((card) => card.id).filter(Boolean);
  assert.equal(new Set(assignedIds).size, assignedIds.length, "Card IDs must stay unique even in multiple chapters");
  assert.deepEqual([...new Set(cards.map((card) => bySlug.get(card.dataset.slug).id))].sort(), [...assignedIds].sort());
  for (const card of cards) {
    const tool = bySlug.get(card.dataset.slug);
    assert.equal(card.querySelector(".tool-title")?.textContent, tool.title);
    assert.equal(card.querySelector(".tool-title").getAttribute("aria-label"), `Day${tool.id.slice(3)} ${tool.title}`);
    assert.equal(card.querySelector(".tool-day").getAttribute("aria-hidden"), "true");
    assert.equal(card.querySelector(".tool-title").tagName, groups ? "H4" : "H3");
    assert.equal(card.querySelector(".tool-title").getAttribute("tabindex"), "-1");
    assert.equal(card.querySelector(".tool-subtitle")?.textContent, tool["subtitle_" + language]);
    const description = card.querySelector(".tool-description")?.textContent;
    assert.ok(description && tool["description_" + language].startsWith(description.replace(/…$/, "")), `${tool.id}: wrong/empty description`);
    const repo = card.querySelector('[data-part="repo"]');
    assert.equal(repo?.href, U.repoLink(tool.repo_url, language), `${tool.id}: repository link`);
    const demo = card.querySelector('[data-part="demo"]');
    assert.equal(!!demo, !!tool.demo_url, `${tool.id}: demo presence`);
    if (demo) assert.equal(demo.href, U.demoLink(tool.demo_url, language));
    for (const [link, label] of [[demo, language === "ja" ? "デモ" : "Demo"], [repo, "GitHub"]]) {
      if (!link) continue;
      assert.equal(link.getAttribute("aria-label"), language === "ja" ? `${label}（${tool.title}、新しいタブで開く）` : `${label} (${tool.title}, opens in a new tab)`);
      assert.equal(link.target, "_blank"); assert.equal(link.rel, "noopener");
    }
    const progress = card.querySelector('[data-part="progress"]');
    assert.equal(progress?.tagName, "SELECT", `${tool.id}: no native progress control`);
    assert.equal(progress.value, "0");
    const labels = language === "ja" ? ["未着手", "学習中", "一周完了", "定着済み"] : ["Not started", "In progress", "First pass", "Mastered"];
    assert.deepEqual(progress.querySelectorAll("option").map((o) => o.value), ["0", "1", "2", "3"]);
    assert.deepEqual(progress.querySelectorAll("option").map((o) => o.textContent), labels);
    assert.equal(progress.getAttribute("aria-label"), language === "ja" ? `進捗（${tool.title}）` : `Progress (${tool.title})`);
    assert.equal(progress.closest("label").querySelector(".tool-progress-caption").textContent, language === "ja" ? "進捗" : "Progress");
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
      chooseProgress(progress, 1);
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
    const cases = [null, undefined, 0, 6, "3", 1, 2, 3, 4, 5, -1, 2.5];
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
      if (Number.isInteger(value) && value >= 1 && value <= 5) {
        assert.ok(badge, `Missing valid difficulty=${value}`);
        assert.equal((badge.textContent.match(/★/g) || []).length, value);
        assert.equal((badge.textContent.match(/☆/g) || []).length, 5 - value);
        assert.equal(badge.getAttribute("role"), "img");
        assert.equal(badge.getAttribute("aria-label"), language === "ja" ? `難易度：5段階中${value}` : `Difficulty: ${value} of 5`);
        assert.equal(badge.firstElementChild.getAttribute("aria-hidden"), "true");
        assert.equal(badge.textContent, (language === "ja" ? "難易度：" : "Difficulty: ") + "★".repeat(value) + "☆".repeat(5 - value));
      } else assert.equal(badge, null, `Unknown/invalid difficulty=${String(value)} must not appear as a rating`);
    });
  });
}

test("PS1: direct choices skip stages, keep focus and history, and ignore unchanged/invalid values", async () => {
  const writes = [];
  const p = await runPage({ storedValues: { hlo_start_here: "closed" }, storageHooks: { write(key, value) { if (key.startsWith("progress_")) writes.push([key, value]); } } });
  const card = p.document.querySelector(".tool-card");
  const control = card.querySelector('[data-part="progress"]');
  const key = `progress_${card.dataset.slug}`;
  const href = p.context.location.href, history = p.context.history.length;
  const options = control.querySelectorAll("option");
  control.focus(); control.dispatch("click");
  assert.equal(control.value, "0", "Opening the picker must not cycle progress");
  chooseProgress(control, 3);
  assert.equal(p.values.get(key), "3");
  assert.equal(p.document.getElementById("overall-n3").textContent.endsWith("1"), true);
  chooseProgress(control, 3);
  for (const invalid of ["", "4", "-1", "1.5", "01", " 2", "NaN"]) {
    chooseProgress(control, invalid);
    assert.equal(control.value, "3", `Invalid choice ${JSON.stringify(invalid)} was not restored`);
  }
  assert.deepEqual(writes, [[key, "3"]]);
  chooseProgress(control, 0);
  assert.deepEqual(writes, [[key, "3"], [key, "0"]]);
  assert.equal(p.document.activeElement, control);
  assert.deepEqual(control.querySelectorAll("option"), options);
  assert.equal(p.context.location.href, href); assert.equal(p.context.history.length, history);
});

test("PS2: direct backward choices synchronize every chapter copy and outside mark without rebuilding controls", async () => {
  const p = await runPage({ search: "?book=genai-crypto" });
  const filter = p.document.getElementById("filter-progress"); filter.value = "0"; filter.dispatch("change");
  const cards = p.document.querySelectorAll(".tool-card");
  const target = cards.find((c) => cards.filter((d) => d.dataset.slug === c.dataset.slug).length > 1);
  const copies = cards.filter((c) => c.dataset.slug === target.dataset.slug);
  const controls = copies.map((c) => c.querySelector('[data-part="progress"]'));
  const options = controls.map((c) => c.querySelectorAll("option"));
  controls[1].focus();
  for (const level of [3, 1, 0]) {
    chooseProgress(controls[1], level);
    assert.deepEqual(p.document.querySelectorAll(".tool-card"), cards);
    controls.forEach((control, i) => {
      assert.equal(control.value, String(level));
      assert.deepEqual(control.querySelectorAll("option"), options[i]);
      assert.equal(copies[i].querySelector(".tool-outside-label").hidden, level === 0);
    });
    assert.equal(p.document.activeElement, controls[1]);
  }
  chooseProgress(controls[1], 3);
  p.document.getElementById("lang-en").dispatch("click");
  const rebuilt = p.document.querySelectorAll('.tool-progress-select').filter((c) => c.dataset.slug === target.dataset.slug);
  assert.equal(rebuilt.length, copies.length);
  for (const control of rebuilt) {
    assert.equal(control.value, "3");
    assert.equal(control.querySelectorAll("option")[3].textContent, "Mastered");
    assert.match(control.getAttribute("aria-label"), /^Progress \(.+\)$/);
  }
  assert.equal(p.document.activeElement.dataset.slug, target.dataset.slug);
  assert.equal(p.document.activeElement.closest(".tool-card").dataset.group, copies[1].dataset.group);
});

test("PS3: direct choices remain usable after a storage write failure and can be backed up", async () => {
  const p = await runPage({ storageFailure: "write" });
  const card = p.document.querySelector(".tool-card"), control = card.querySelector('[data-part="progress"]');
  control.focus(); chooseProgress(control, 3);
  assert.equal(control.value, "3"); assert.equal(p.document.activeElement, control);
  assert.equal(p.document.getElementById("storage-warning").hidden, false);
  assert.equal(p.evaluate(`getProgress(${JSON.stringify(card.dataset.slug)})`), 3);
  p.document.getElementById("records-export").click();
  assert.equal(p.downloads.length, 1);
  chooseProgress(control, 0);
  assert.equal(p.evaluate(`getProgress(${JSON.stringify(card.dataset.slug)})`), 0);
  assert.equal(control.value, "0");
});

test("PS4: the same stage guide appears in help and a closed dashboard disclosure that survives updates", async () => {
  const p = await runPage({ search: "?tab=dashboard" });
  const guide = p.document.getElementById("progress-guide");
  const help = p.document.getElementById("help-progress").closest("section");
  assert.equal(guide.tagName, "DETAILS"); assert.equal(guide.open, false);
  assert.equal(guide.parentNode.children[0], guide, "The guide belongs at the top of the dashboard");
  for (const language of ["ja", "en"]) {
    const content = (section) => section.querySelectorAll("p, li").map((el) => el.querySelector(`.label-${language}`).textContent);
    assert.deepEqual(content(guide), content(help));
    assert.equal(content(guide).length, 5);
  }
  assert.equal(guide.querySelector("summary .label-ja").textContent, "進捗の4段階の目安");
  assert.equal(guide.querySelector("summary .label-en").textContent, "What the four stages mean");
  const summary = guide.querySelector("summary"); summary.dispatch("click");
  assert.equal(guide.open, true);
  p.document.getElementById("lang-en").dispatch("click");
  p.document.getElementById("tab-tools-label").dispatch("click");
  chooseProgress(p.document.querySelector('[data-part="progress"]'), 3);
  p.document.getElementById("tab-dashboard-label").dispatch("click");
  assert.equal(p.document.getElementById("progress-guide"), guide);
  assert.equal(guide.querySelector("summary"), summary); assert.equal(guide.open, true);
  p.values.set(`progress_${visible[0].slug}`, "2"); p.evaluate("refreshProgressViews()");
  assert.equal(guide.open, true);
  summary.dispatch("click"); assert.equal(guide.open, false);
});
