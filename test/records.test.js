const { test } = require("node:test");
const assert = require("node:assert/strict");
const R = require("../js/records.js");
const DATE = "2026-11-20T00:00:00.000Z";
const IDS = new Set(["day001", "day002", "day003"]);
const map = entries => new Map(entries);
const file = (progress = { day001: 2 }, extras = {}) => JSON.stringify({ app: R.APP, schema_version: 1, saved_at: DATE, progress, ...extras });
const parse = text => R.parseRecords(text, IDS);
const invalid = text => assert.deepEqual(parse(text), { ok: false, reason: "invalid" });

test("RC1: export sorts nonzero catalog IDs and round-trips all four stages", () => {
  const original = map([["day003", 3], ["day001", 1], ["day002", 0]]);
  const result = R.createRecords(original, DATE);
  assert.equal(result.count, 2);
  assert.deepEqual(Object.keys(JSON.parse(result.json).progress), ["day001", "day003"]);
  assert.deepEqual(parse(result.json), { ok: true, savedAt: DATE, progress: map([["day001", 1], ["day003", 3]]), tryLater: new Set() });
  assert.deepEqual([...original], [["day003", 3], ["day001", 1], ["day002", 0]]);
  assert.deepEqual([...parse(file({ day001: 0, day002: 2 })).progress], [["day001", 0], ["day002", 2]]);
});

test("RC2: empty progress produces no file; invalid export values are refused", () => {
  for (const current of [new Map(), map([["day001", 0]])]) assert.equal(R.createRecords(current, DATE), null);
  for (const entry of [["day001", 4], ["day001", "2"], ["progress_slug", 2], ["__proto__", 3], ["day000", 1]]) {
    assert.equal(R.createRecords(map([entry]), DATE), null);
  }
  assert.equal(R.createRecords(map([["day001", 1]]), "yesterday"), null);
});

test("RC3: unknown valid IDs are ignored without deriving storage keys", () => {
  const parsed = parse(file({ day999: 3, day001: 2 }));
  assert.equal(parsed.ok, true);
  assert.deepEqual([...parsed.progress], [["day001", 2]]);
  assert.equal(parse(file({ day999: 1 })).progress.size, 0);
  invalid(file({ day999: { level: 1 } }));
});

test("RC4: malformed roots and incorrect metadata fail before any merge", () => {
  for (const input of ["", "{", "null", "[]", "1", '"string"', file({}, { app: "other" }), file({}, { schema_version: 0 }), file({}, { schema_version: "1" }), file({}, { schema_version: 1.5 }), file({}, { extra: true })]) invalid(input);
  for (const key of ["app", "schema_version", "saved_at", "progress"]) {
    const obj = JSON.parse(file()); delete obj[key]; invalid(JSON.stringify(obj));
  }
  for (const value of [null, [], "oops", 1]) invalid(file(value));
  assert.deepEqual(parse(file({}, { schema_version: 3 })), { ok: false, reason: "new-version" });
  invalid(file({}, { app: "other", schema_version: 2 }));
});

test("RC5: progress accepts only canonical IDs and integer stages 0 through 3", () => {
  for (const value of [-1, 4, 1.2, "2", true, false, null, {}, []]) invalid(file({ day001: value }));
  for (const id of ["day000", "day1", "Day001", "day1000", "day001 ", "x_day001", "progress_caesar", "constructor", "prototype", "__proto__"]) {
    invalid(file(Object.fromEntries([[id, 1]])));
  }
  assert.equal({}.polluted, undefined);
});

test("RC6: prototype-looking root keys are rejected and native duplicate-key semantics are explicit", () => {
  for (const key of ["constructor", "prototype", "__proto__"]) {
    invalid(file({}, Object.fromEntries([[key, { polluted: true }]])));
  }
  const duplicate = file().replace('"day001":2', '"day001":1,"day001":3');
  assert.equal(parse(duplicate).progress.get("day001"), 3);
  assert.equal({}.polluted, undefined);
});

test("RC7: saved_at must be a real canonical ISO date; clock skew is permitted", () => {
  for (const date of ["2026-02-30T00:00:00.000Z", "2026-11-20", "2026-11-20T00:00:00Z", "2026-11-20T00:00:00.000+00:00", 0, null]) invalid(file({}, { saved_at: date }));
  assert.equal(parse(file({}, { saved_at: "2099-01-01T00:00:00.000Z" })).ok, true);
  assert.equal(parse(file({}, { saved_at: "2024-02-29T00:00:00.000Z" })).ok, true);
});

test("RC8: byte and entry limits reject oversized input before processing it", () => {
  const exact = file().padEnd(R.MAX_BYTES, " ");
  assert.equal(parse(exact).ok, true);
  invalid(exact + " ");
  invalid(file({}, { saved_at: "漢".repeat(22000) }));
  invalid(file(Object.fromEntries(Array.from({ length: R.MAX_ENTRIES + 1 }, (_, i) => ["day" + i, 1]))));
  invalid(file({ day001: JSON.parse("[".repeat(1000) + "0" + "]".repeat(1000)) }));
});

test("RC9: all 16 stage pairs restore only higher file values and preserve inputs", () => {
  for (let local = 0; local <= 3; local++) for (let saved = 0; saved <= 3; saved++) {
    const source = map([["day001", saved]]), current = map([["day001", local]]);
    const plan = R.planImport(source, current);
    assert.deepEqual([...plan.candidates], saved > local ? [["day001", saved]] : []);
    assert.equal(plan.localAheadCount, local > saved ? 1 : 0);
    assert.deepEqual([...source], [["day001", saved]]);
    assert.deepEqual([...current], [["day001", local]]);
  }
});

test("RC10: browser-only progress counts as protected; missing file IDs are never restored", () => {
  const plan = R.planImport(map([["day001", 2]]), map([["day001", 0], ["day002", 3], ["day003", 0]]));
  assert.equal(plan.localAheadCount, 1);
  assert.deepEqual([...plan.candidates], [["day001", 2]]);
});

test("RC11: after confirmation, fresh effective and durable values can both prevent downgrades", () => {
  const candidates = map([["day001", 2], ["day002", 2], ["day003", 3]]);
  const effective = map([["day001", 3], ["day002", 0], ["day003", 1], ["day004", 0]]);
  const durable = map([["day001", { ok: true, value: 0 }], ["day002", { ok: true, value: 3 }], ["day003", { ok: true, value: 2 }]]);
  assert.deepEqual(R.recheckImport(candidates, effective, durable), { updates: [{ id: "day003", level: 3, persist: true }], count: 1 });
  assert.equal(candidates.size, 3);
  assert.equal(effective.get("day001"), 3);
});

test("RC12: unreadable durable progress uses memory only, without creating extra candidates", () => {
  const candidates = map([["day001", 2], ["day002", 3]]);
  const effective = map([["day001", 0], ["day002", 2], ["day003", 0]]);
  for (const durable of [new Map(), map([["day001", { ok: false, value: null }], ["day002", { ok: true, value: "2" }]])]) {
    assert.deepEqual(R.recheckImport(candidates, effective, durable), {
      updates: [{ id: "day001", level: 2, persist: false }, { id: "day002", level: 3, persist: false }], count: 2
    });
  }
});

test("RC13: all 64 effective, durable and file stage combinations respect both latest values", () => {
  for (let saved = 0; saved <= 3; saved++) for (let effective = 0; effective <= 3; effective++) for (let durable = 0; durable <= 3; durable++) {
    const result = R.recheckImport(map([["day001", saved]]), map([["day001", effective]]), map([["day001", { ok: true, value: durable }]]));
    assert.equal(result.count, saved > effective && saved > durable ? 1 : 0);
  }
});

test("RC14: v2 exports bookmarked-only tools, sorts IDs and counts the union once", () => {
  const progress = map([["day001", 2], ["day002", 0]]);
  const later = new Set(["day003", "day001"]);
  const output = R.createRecords(progress, DATE, later);
  assert.equal(output.count, 2);
  assert.deepEqual(JSON.parse(output.json), {
    app: R.APP, schema_version: 2, saved_at: DATE,
    progress: { day001: 2 }, try_later: ["day001", "day003"]
  });
  assert.deepEqual(parse(output.json), { ok: true, savedAt: DATE, progress: map([["day001", 2]]), tryLater: new Set(["day001", "day003"]) });
  const bookmarksOnly = R.createRecords(new Map(), DATE, new Set(["day002"]));
  assert.equal(bookmarksOnly.count, 1);
  assert.deepEqual(JSON.parse(bookmarksOnly.json).progress, {});
  assert.deepEqual([...later], ["day003", "day001"]);
});

test("RC15: v1 records stay readable; versions require their exact fields", () => {
  assert.deepEqual([...parse(file()).tryLater], []);
  invalid(file({}, { try_later: [] }));
  invalid(file({}, { schema_version: 2 }));
  invalid(file({}, { schema_version: 2, try_later: [], extra: true }));
  assert.equal(parse(file({}, { schema_version: 2, try_later: [] })).ok, true);
  assert.deepEqual(parse(file({}, { schema_version: 99 })), { ok: false, reason: "new-version" });
});

test("RC16: v2 validates every bookmark before ignoring unknown catalog IDs", () => {
  const v2 = try_later => file({}, { schema_version: 2, try_later });
  for (const value of [null, {}, "day001", 1, true, [null], [1], ["day000"], ["day1"], ["Day001"], ["day001 "], ["__proto__"], ["later_day001"], ["day001", "day001"], ["day999", "day999"]]) invalid(v2(value));
  invalid(v2(Array(R.MAX_ENTRIES + 1).fill("day001")));
  const parsed = parse(v2(["day999", "day002"]));
  assert.deepEqual([...parsed.tryLater], ["day002"]);
  for (const value of [[], {}, null, new Set(["day000"]), new Set(["__proto__"]), new Set([false])]) {
    assert.equal(R.createRecords(new Map(), DATE, value), null);
  }
});

test("RC17: bookmark import adds only confirmed file IDs and preserves local-only entries", () => {
  const fileSet = new Set(["day001", "day002"]), local = new Set(["day002", "day003"]);
  const candidates = R.planTryLaterImport(fileSet, local);
  assert.deepEqual([...candidates], ["day001"]);
  assert.deepEqual([...local], ["day002", "day003"]);
  assert.deepEqual([...fileSet], ["day001", "day002"]);
  assert.deepEqual([...R.planTryLaterImport(parse(file()).tryLater, local)], []);
  // A local-only removal after confirmation must not be resurrected.
  const result = R.recheckTryLaterImport(candidates, new Set(), map([["day001", { ok: true, value: false }], ["day003", { ok: true, value: false }]]));
  assert.deepEqual(result, { updates: [{ id: "day001", persist: true }], count: 1 });
});

test("RC18: bookmark recheck honors explicit restores after dirty removals and unreadable disk", () => {
  for (const effective of [false, true]) for (const durable of [false, true]) {
    const result = R.recheckTryLaterImport(new Set(["day001"]), new Set(effective ? ["day001"] : []), map([["day001", { ok: true, value: durable }]]));
    assert.deepEqual(result, effective ? { updates: [], count: 0 } : { updates: [{ id: "day001", persist: true }], count: 1 });
  }
  for (const record of [undefined, { ok: false, value: null }, { ok: true, value: "1" }]) {
    const result = R.recheckTryLaterImport(new Set(["day001"]), new Set(), map([["day001", record]]));
    assert.deepEqual(result, { updates: [{ id: "day001", persist: false }], count: 1 });
  }
});
