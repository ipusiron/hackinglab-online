"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const P = require("../js/preparation.js");
const root = path.join(__dirname, "..");
const catalog = JSON.parse(fs.readFileSync(path.join(root, "data/tools.json"), "utf8")).tools;
const selected = ["day003", "day007", "day015", "day023", "day033", "day039", "day041", "day050", "day077", "day113"];

test("PR1: all ten reviewed public tools have concise plain-text preparation in both languages", () => {
  const supported = catalog.filter((tool) => P.get(tool.id, "ja"));
  assert.deepEqual(supported.map((tool) => tool.id), selected);
  assert.ok(supported.every((tool) => tool.hub !== false));
  for (const id of selected) {
    for (const lang of ["ja", "en"]) {
      const value = P.get(id, lang);
      assert.deepEqual(Object.keys(value).sort(), ["environment", "prepare"]);
      for (const text of Object.values(value)) {
        assert.equal(typeof text, "string");
        assert.equal(text, text.trim());
        assert.ok(text.length > 0 && text.length <= 200, `${id}/${lang}: ${text}`);
        assert.doesNotMatch(text, /[<>\u0000-\u001f\u007f]/);
      }
    }
    assert.notDeepEqual(P.get(id, "ja"), P.get(id, "en"));
  }
});

test("PR2: unknown or malformed IDs have no inferred prerequisites, and unsupported languages fall back to Japanese", () => {
  for (const id of [null, undefined, 3, "", "day000", "day999", "Day003", "day3", " day003", "constructor", "__proto__", { toString() { throw new Error("No coercion"); } }]) {
    assert.equal(P.get(id, "en"), null);
  }
  for (const lang of [undefined, null, "", "EN", "fr", {}]) {
    assert.deepEqual(P.get("day003", lang), P.get("day003", "ja"));
  }
  const first = P.get("day003", "en");
  first.prepare = "changed by caller";
  delete first.environment;
  assert.match(P.get("day003", "en").prepare, /HELLO/);
  assert.equal(P.get("day003", "en").environment, "Web browser");
});

test("PR3: preparation distinguishes files, Colab, permissions and hardware from browser-only demonstrations", () => {
  assert.match(P.get("day007", "en").environment, /JPEG\/PNG/);
  assert.match(P.get("day015", "en").environment, /Google Colab.*Google account/);
  assert.match(P.get("day015", "en").prepare, /domains.*query count/);
  assert.match(P.get("day023", "en").prepare, /built-in sample/);
  assert.match(P.get("day033", "en").environment, /Clipboard API.*HTTPS/);
  assert.match(P.get("day033", "en").prepare, /test text.*permission/);
  assert.match(P.get("day041", "en").environment, /microphone.*HTTPS/);
  assert.match(P.get("day041", "en").prepare, /allow microphone/);
  assert.match(P.get("day050", "en").prepare, /No physical safe/);
  assert.match(P.get("day113", "en").environment, /Raspberry Pi Zero W.*Python 3.*Flask/);
  assert.match(P.get("day113", "en").prepare, /USB HID and Wi-Fi/);
  for (const id of selected) {
    assert.doesNotMatch(P.get(id, "en").prepare, /\b\d+\s*(?:minutes?|seconds?)\b/i);
    assert.doesNotMatch(P.get(id, "ja").prepare, /\d+\s*(?:分|秒)/);
  }
});

test("PR4: the browser export works without DOM, network, timers or storage", () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(root, "js/preparation.js"), "utf8"), context);
  assert.deepEqual(Object.keys(context), ["HLOPreparation"]);
  assert.equal(context.HLOPreparation.get("day999", "ja"), null);
  for (const id of selected) {
    assert.equal(JSON.stringify(context.HLOPreparation.get(id, "en")), JSON.stringify(P.get(id, "en")));
  }
});
