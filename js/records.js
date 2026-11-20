// Local progress / try-later backup format and merge decisions. No DOM or storage access.
(function (root) {
  "use strict";
  const APP = "hackinglab-online";
  const SCHEMA_VERSION = 2;
  const MAX_BYTES = 65536;
  const MAX_ENTRIES = 1000;
  const ROOT_KEYS = ["app", "progress", "saved_at", "schema_version"];
  const validId = id => typeof id === "string" && /^day[0-9]{3}$/.test(id) && id !== "day000";
  const validLevel = level => Number.isInteger(level) && level >= 0 && level <= 3;
  const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
  function validDate(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
    const date = new Date(value);
    return Number.isFinite(date.getTime()) && date.toISOString() === value;
  }
  const invalid = () => ({ ok: false, reason: "invalid" });

  // Duplicate JSON keys follow native JSON.parse semantics (the last value wins).
  // Unknown well-formed tool IDs are validated, then ignored. Nothing is written.
  function parseRecords(text, knownIds) {
    if (typeof text !== "string" || text.length > MAX_BYTES || !knownIds || typeof knownIds.has !== "function") return invalid();
    if (new TextEncoder().encode(text).length > MAX_BYTES) return invalid();
    let file;
    try { file = JSON.parse(text); } catch (_) { return invalid(); }
    if (!isObject(file) || file.app !== APP || !Number.isInteger(file.schema_version) || file.schema_version < 1) return invalid();
    if (file.schema_version > SCHEMA_VERSION) return { ok: false, reason: "new-version" };
    const keys = Object.keys(file).sort();
    const expectedKeys = file.schema_version === 1 ? ROOT_KEYS : [...ROOT_KEYS, "try_later"];
    if (keys.length !== expectedKeys.length || keys.some((key, i) => key !== expectedKeys[i])) return invalid();
    if (!validDate(file.saved_at) || !isObject(file.progress)) return invalid();
    const entries = Object.entries(file.progress);
    if (entries.length > MAX_ENTRIES) return invalid();
    const progress = new Map();
    for (const [id, level] of entries) {
      if (!validId(id) || !validLevel(level)) return invalid();
      if (knownIds.has(id)) progress.set(id, level);
    }
    const tryLater = new Set();
    if (file.schema_version === 2) {
      if (!Array.isArray(file.try_later) || file.try_later.length > MAX_ENTRIES) return invalid();
      const seen = new Set();
      for (const id of file.try_later) {
        if (!validId(id) || seen.has(id)) return invalid();
        seen.add(id);
        if (knownIds.has(id)) tryLater.add(id);
      }
    }
    return { ok: true, savedAt: file.saved_at, progress, tryLater };
  }

  // Caller supplies current visible catalog IDs only, never storage key strings.
  function createRecords(progressById, savedAtISO, tryLater = new Set()) {
    if (!(progressById instanceof Map) || !validDate(savedAtISO) || progressById.size > MAX_ENTRIES) return null;
    if (!(tryLater instanceof Set) || tryLater.size > MAX_ENTRIES || [...tryLater].some(id => !validId(id))) return null;
    const entries = [...progressById];
    if (entries.some(([id, level]) => !validId(id) || !validLevel(level))) return null;
    const nonzero = entries.filter(([, level]) => level > 0).sort(([a], [b]) => a.localeCompare(b));
    const laterIds = [...tryLater].sort();
    if (!nonzero.length && !laterIds.length) return null;
    const json = JSON.stringify({ app: APP, schema_version: SCHEMA_VERSION, saved_at: savedAtISO, progress: Object.fromEntries(nonzero), try_later: laterIds }, null, 2) + "\n";
    if (new TextEncoder().encode(json).length > MAX_BYTES) return null;
    return { json, count: new Set([...nonzero.map(([id]) => id), ...laterIds]).size };
  }

  function levelAt(values, id) {
    const value = values.get(id);
    return validLevel(value) ? value : 0;
  }

  // Compare before asking once for confirmation. Missing file IDs mean no change.
  function planImport(fileProgress, currentById) {
    const candidates = new Map();
    let localAheadCount = 0;
    for (const id of new Set([...fileProgress.keys(), ...currentById.keys()])) {
      const level = levelAt(fileProgress, id);
      const current = levelAt(currentById, id);
      if (level > current) candidates.set(id, level);
      else if (current > level) localAheadCount++;
    }
    return { candidates, localAheadCount };
  }

  // Re-read both effective and durable values after confirmation. Do not add
  // candidates. A failed durable read allows an in-page update, never a blind
  // persistent write. localStorage has no atomic cross-tab compare-and-set.
  function recheckImport(candidates, effectiveById, durableById) {
    const updates = [];
    for (const [id, level] of candidates) {
      if (level <= levelAt(effectiveById, id)) continue;
      const durable = durableById.get(id);
      const known = Boolean(durable && durable.ok === true && validLevel(durable.value));
      if (known && level <= durable.value) continue;
      updates.push({ id, level, persist: known });
    }
    return { updates, count: updates.length };
  }

  // Restoring is additive: a backup never clears another local try-later entry.
  function planTryLaterImport(fileTryLater, currentTryLater) {
    return new Set([...fileTryLater].filter(id => !currentTryLater.has(id)));
  }

  // Only the additions confirmed by the user are eligible. A failed disk read
  // permits memory-only rescue, just as it does for progress above.
  function recheckTryLaterImport(candidates, effectiveTryLater, durableById) {
    const updates = [];
    for (const id of candidates) {
      if (effectiveTryLater.has(id)) continue;
      const durable = durableById.get(id);
      const known = Boolean(durable && durable.ok === true && typeof durable.value === "boolean");
      // An explicit restore also undoes a memory-only removal. Rewriting "1"
      // when disk is already saved clears that dirty value without a downgrade.
      updates.push({ id, persist: known });
    }
    return { updates, count: updates.length };
  }

  const api = { APP, SCHEMA_VERSION, MAX_BYTES, MAX_ENTRIES, parseRecords, createRecords, planImport, recheckImport, planTryLaterImport, recheckTryLaterImport };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLORecords = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
