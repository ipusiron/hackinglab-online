"use strict";
// Real catalog/data contract. No network and no dependencies.
// AFTER_REGEN=1: missing category/difficulty metadata and lost name mappings warn; structural failures still fail.
// Unknown raw names always warn: README categories can be broader than the hub's curated categories.
// HLO_BASE_COMMIT: compare preserved added dates and formerly mapped raw names with this Git commit.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const ROOT = path.resolve(__dirname, "..");
const json = (file) => JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
const data = json("data/tools.json");
const tools = data.tools;
const categories = json("data/categories.json");
const CG = require("../js/category_groups.js");
const ignoredNames = CG.validateGroups(json("data/category_groups.json"), categories).ignored;
const AFTER_REGEN = process.env.AFTER_REGEN === "1";
const BASE = process.env.HLO_BASE_COMMIT;
const nonempty = (s) => typeof s === "string" && s.trim() !== "" && s === s.trim();
const issues = () => ({ errors: [], warnings: [] });
const quality = (result, message, regeneration) => result[regeneration ? "warnings" : "errors"].push(message);
function report(t, result) {
  if (result.warnings.length) t.diagnostic(`WARN ${result.warnings.length}: ${result.warnings.slice(0, 4).join("; ")}${result.warnings.length > 4 ? "; ..." : ""}`);
  assert.deepEqual(result.errors, [], result.errors.join("\n"));
}
function categoryMaps(definitions) {
  const result = issues();
  try { CG.validateCategories(definitions); } catch (error) { result.errors.push(error.message); }
  const maps = { ja: new Map(), en: new Map() };
  const ids = new Set();
  assert.ok(Array.isArray(definitions) && definitions.length > 0, "categories.json must be a nonempty array");
  for (const c of definitions) {
    if (!c || typeof c !== "object" || Array.isArray(c)) { result.errors.push("Invalid category object"); continue; }
    if (typeof c.id !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(c.id)) result.errors.push(`Invalid category id: ${String(c.id)}`);
    if (ids.has(c.id)) result.errors.push(`Duplicate category id: ${c.id}`);
    ids.add(c.id);
    for (const lang of ["ja", "en"]) {
      const aliases = c["aliases_" + lang] ?? [];
      if (!Array.isArray(aliases)) { result.errors.push(`${c.id}: aliases_${lang} is not an array`); continue; }
      for (const name of [c[lang], ...aliases]) {
        if (!nonempty(name)) { result.errors.push(`${c.id}: empty/untrimmed ${lang} name or alias`); continue; }
        // Match Python load_categories exactly: language-specific, case-sensitive, with no normalization.
        if (maps[lang].has(name)) result.errors.push(`${lang} name/alias ${JSON.stringify(name)} is repeated (${maps[lang].get(name)}, ${c.id})`);
        maps[lang].set(name, c.id);
      }
    }
  }
  return { ...result, maps, ids };
}
function httpsUrl(value) {
  if (!nonempty(value) || /[\s\u0000-\u001f\u007f]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !!url.hostname && !url.username && !url.password;
  } catch { return false; }
}
function validateTools(entries, definitions, regeneration) {
  const result = issues();
  const { maps, ids: categoryIds } = categoryMaps(definitions);
  const ids = new Set(); const slugs = new Set();
  assert.ok(Array.isArray(entries) && entries.length > 0, "tools.json.tools must be a nonempty array");
  for (const tool of entries) {
    if (!tool || typeof tool !== "object" || Array.isArray(tool)) { result.errors.push("Invalid tool object"); continue; }
    const who = tool.id || "(missing id)";
    if (!/^day\d{3}$/.test(tool.id || "")) result.errors.push(`Invalid/empty id: ${who}`);
    if (ids.has(tool.id)) result.errors.push(`Duplicate id: ${who}`);
    ids.add(tool.id);
    if (!nonempty(tool.slug)) result.errors.push(`${who}: empty/untrimmed slug`);
    const slug = String(tool.slug || "").toLowerCase();
    if (slugs.has(slug)) result.errors.push(`${who}: duplicate slug ${JSON.stringify(tool.slug)}`);
    slugs.add(slug);
    for (const key of ["title", "subtitle_ja", "subtitle_en", "description_ja", "description_en"]) {
      if (typeof tool[key] !== "string" || !tool[key].trim()) result.errors.push(`${who}: empty/non-text ${key}`);
    }
    if (!httpsUrl(tool.repo_url)) result.errors.push(`${who}: invalid HTTPS repo_url ${JSON.stringify(tool.repo_url)}`);
    if (tool.demo_url !== "" && tool.demo_url != null && !httpsUrl(tool.demo_url)) result.errors.push(`${who}: invalid HTTPS demo_url ${JSON.stringify(tool.demo_url)}`);
    if (tool.difficulty == null || tool.difficulty === "") quality(result, `${who}: missing difficulty`, regeneration);
    else if (!Number.isInteger(tool.difficulty) || tool.difficulty < 1 || tool.difficulty > 5) result.errors.push(`${who}: invalid difficulty ${JSON.stringify(tool.difficulty)} (1..5 required)`);
    const derived = new Set();
    for (const lang of ["ja", "en"]) {
      const names = tool["category_" + lang];
      if (!Array.isArray(names)) { result.errors.push(`${who}: category_${lang} is not an array`); continue; }
      for (const name of names) {
        if (!nonempty(name)) { result.errors.push(`${who}: invalid raw category_${lang} ${JSON.stringify(name)}`); continue; }
        const id = maps[lang].get(name);
        if (id) derived.add(id);
        else if (!ignoredNames[lang].has(name)) result.warnings.push(`${who}: unknown ${lang} category ${JSON.stringify(name)}`);
      }
    }
    if (!Array.isArray(tool.category_ids)) { result.errors.push(`${who}: category_ids is not an array`); continue; }
    if (!tool.category_ids.length) quality(result, `${who}: no mapped category`, regeneration);
    if (new Set(tool.category_ids).size !== tool.category_ids.length) result.errors.push(`${who}: duplicate category_ids`);
    for (const id of tool.category_ids) if (!categoryIds.has(id)) result.errors.push(`${who}: undefined category id ${JSON.stringify(id)}`);
    const expected = [...derived].sort();
    const actual = [...tool.category_ids].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) result.errors.push(`${who}: category_ids ${JSON.stringify(actual)} != mapped raw names ${JSON.stringify(expected)}; regenerate tools.json`);
  }
  return result;
}
function lostMappings(entries, before, after, regeneration) {
  const result = issues();
  const oldMaps = categoryMaps(before).maps; const newMaps = categoryMaps(after).maps;
  for (const tool of entries) for (const lang of ["ja", "en"]) for (const name of tool["category_" + lang] || []) {
    if (oldMaps[lang].has(name) && !newMaps[lang].has(name)) quality(result,
      `${tool.id}: category_${lang} ${JSON.stringify(name)} mapped to ${oldMaps[lang].get(name)} at base, but is now unmapped`, regeneration);
  }
  return result;
}
let baseCommit;
function baseJson(file, allowMissing = false) {
  assert.ok(BASE, "HLO_BASE_COMMIT is not set");
  const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  // Resolve once before ls-tree/show; invalid refs are errors, never treated as an absent baseline file.
  if (!baseCommit) baseCommit = git(["rev-parse", "--verify", "--end-of-options", BASE + "^{commit}"]);
  assert.match(baseCommit, /^[0-9a-f]{40,64}$/);
  const listed = git(["ls-tree", "--name-only", baseCommit, "--", file]);
  if (!listed && allowMissing) return null;
  assert.equal(listed, file, `${file} missing at HLO_BASE_COMMIT=${BASE}`);
  return JSON.parse(git(["show", `${baseCommit}:${file}`]));
}
function jstDate(now = new Date()) {
  return new Date(new Date(now).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}
function dateErrors(dates, today = jstDate()) {
  const errors = [];
  if (!dates || typeof dates !== "object" || Array.isArray(dates)) return ["added.json must be a flat object"];
  for (const [id, date] of Object.entries(dates)) {
    if (!/^day\d{3}$/.test(id)) errors.push(`Invalid added id: ${id}`);
    let valid = typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date);
    if (valid) { const parsed = new Date(date + "T00:00:00Z"); valid = Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date; }
    if (!valid) errors.push(`${id}: invalid added date ${JSON.stringify(date)}`);
    else if (date > today) errors.push(`${id}: future added date ${date} > ${today} (JST)`);
  }
  return errors;
}
function changedDates(before, after) {
  return Object.entries(before).filter(([id, date]) => after[id] !== date)
    .map(([id, date]) => `${id}: first-added date changed/removed (${date} -> ${String(after[id])})`);
}

test("CT1: category IDs, names and aliases are nonempty and unambiguous", (t) => report(t, categoryMaps(categories)));
test("CT2: tool identity, HTTPS links, content and mapped categories are valid", (t) => {
  assert.equal(data.schema_version, 1);
  report(t, validateTools(tools, categories, AFTER_REGEN));
});
test("CT3: changing category definitions does not lose previously mapped raw names", { skip: BASE ? false : "Set HLO_BASE_COMMIT to check category changes" }, (t) => {
  report(t, lostMappings(tools, baseJson("data/categories.json"), categories, AFTER_REGEN));
});
function canonicalRepo(value) {
  const match = String(value).match(/^(?:https:\/\/github\.com\/|git@github\.com:)([^/]+)\/([^/]+?)\/?$/i);
  return match ? `${match[1]}/${match[2].replace(/\.git$/, "")}`.toLowerCase() : null;
}
function duplicateRepositories(urls) {
  const keys = urls.map(canonicalRepo);
  return [...new Set(keys.filter((key, i) => keys.indexOf(key) !== i))].sort();
}
function repositoryDifference(expectedUrls, actualUrls) {
  const expected = new Set(expectedUrls.map(canonicalRepo));
  const actual = new Set(actualUrls.map(canonicalRepo));
  return { missing: [...expected].filter((key) => !actual.has(key)).sort(), stale: [...actual].filter((key) => !expected.has(key)).sort() };
}
test("CT4: regenerated repository set exactly matches repos.txt", { skip: AFTER_REGEN ? false : "Checked after regeneration (AFTER_REGEN=1)" }, () => {
  const expected = fs.readFileSync(path.join(ROOT, "repos.txt"), "utf8").split(/\r?\n/).map((s) => s.trim()).filter((s) => s && !s.startsWith("#"));
  const actual = tools.map((tool) => tool.repo_url);
  for (const repo of [...expected, ...actual]) assert.ok(canonicalRepo(repo), `Invalid repository URL: ${repo}`);
  assert.deepEqual(duplicateRepositories(expected), [], "repos.txt contains duplicate canonical repositories");
  assert.deepEqual(repositoryDifference(expected, actual), { missing: [], stale: [] },
    "Generated catalog has missing repositories or retains removed repositories");
});
test("AD1: added.json has valid ISO dates, no future dates and covers every visible tool", () => {
  const dates = json("data/added.json");
  assert.deepEqual(dateErrors(dates), []);
  for (const tool of tools) {
    if (tool.hub !== false) assert.ok(Object.hasOwn(dates, tool.id), `${tool.id}: missing first-added date`);
    if (tool.hub !== false || Object.hasOwn(dates, tool.id)) assert.equal(tool.added, dates[tool.id], `${tool.id}: tools.added disagrees with added.json`);
  }
});
test("AD2: existing first-added dates are never changed or removed", { skip: BASE ? false : "Set HLO_BASE_COMMIT to compare first-added dates" }, (t) => {
  const previous = baseJson("data/added.json", true);
  if (previous === null) { t.skip("Base commit predates added.json (initial introduction only)"); return; }
  assert.deepEqual(dateErrors(previous), [], "Baseline added.json is malformed");
  assert.deepEqual(changedDates(previous, json("data/added.json")), []);
});
test("CT5: regeneration softens metadata omissions, never identity, URL or mapping corruption", () => {
  const defs = [{ id: "one", ja: "一", en: "One" }];
  const entry = { id: "day001", slug: "one", title: "One", subtitle_ja: "一", subtitle_en: "One", description_ja: "一", description_en: "One", repo_url: "https://example.com/one", demo_url: "", category_ja: ["一"], category_en: ["One"], category_ids: ["one"], difficulty: 1 };
  const incomplete = { ...entry, category_ja: ["未知"], category_en: [], category_ids: [], difficulty: null };
  assert.equal(validateTools([incomplete], defs, false).errors.length, 2);
  assert.equal(validateTools([incomplete], defs, true).errors.length, 0);
  assert.equal(validateTools([incomplete], defs, true).warnings.length, 3);
  for (const bad of [{ id: "" }, { slug: "" }, { repo_url: "javascript:alert(1)" }, { demo_url: "http://example.com" }, { category_ids: [] }, { difficulty: -1 }]) {
    assert.ok(validateTools([{ ...entry, ...bad }], defs, true).errors.length > 0, `Hard failure was softened: ${JSON.stringify(bad)}`);
  }
  assert.ok(validateTools([entry, { ...entry }], defs, true).errors.some((s) => s.includes("Duplicate id")));
  const renamed = [{ id: "one", ja: "壱", en: "One" }];
  assert.equal(lostMappings([entry], defs, renamed, false).errors.length, 1);
  assert.equal(lostMappings([entry], defs, renamed, true).warnings.length, 1);
  assert.ok(categoryMaps([...defs, { id: "two", ja: "二", en: "Two", aliases_en: ["One"] }]).errors.length > 0);
});
test("AD3: impossible/future dates and lost or rewritten historical entries are rejected", () => {
  assert.deepEqual(dateErrors({ day001: "2024-02-29" }, "2026-11-19"), []);
  for (const value of ["2025-02-29", "2026-13-01", "2026-11-20", "2026-1-01", null]) assert.ok(dateErrors({ day001: value }, "2026-11-19").length > 0);
  assert.equal(changedDates({ day001: "2024-01-01" }, {}).length, 1);
  assert.equal(changedDates({ day001: "2024-01-01" }, { day001: "2024-01-02" }).length, 1);
});

test("CT6: repository comparison canonicalizes GitHub URLs and detects both missing and stale repos", () => {
  const a = "https://github.com/ipusiron/a";
  const b = "https://github.com/ipusiron/b";
  assert.equal(canonicalRepo("git@github.com:IPUSIRON/a.git"), canonicalRepo(a));
  assert.equal(canonicalRepo(a + "/"), canonicalRepo(a));
  assert.deepEqual(duplicateRepositories([a, "git@github.com:IPUSIRON/a.git"]), ["ipusiron/a"]);
  assert.deepEqual(repositoryDifference([a, b], [a]), { missing: ["ipusiron/b"], stale: [] });
  assert.deepEqual(repositoryDifference([a], [a, b]), { missing: [], stale: ["ipusiron/b"] });
});
test("AD4: future-date checks use the generator's JST calendar across 15:00 UTC", () => {
  assert.equal(jstDate("2026-11-19T14:59:59.999Z"), "2026-11-19");
  assert.equal(jstDate("2026-11-19T15:00:00.000Z"), "2026-11-20");
  assert.equal(dateErrors({ day001: "2026-11-20" }, jstDate("2026-11-19T14:59:59.999Z")).length, 1);
  assert.deepEqual(dateErrors({ day001: "2026-11-20" }, jstDate("2026-11-19T15:00:00.000Z")), []);
});
