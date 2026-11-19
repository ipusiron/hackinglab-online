// Safe localStorage access. Failed writes stay effective until this page closes.
// A successful cache entry is never allowed to resurrect an externally deleted value.
(function (root) {
  "use strict";
  function createSafeStorage(getStorage, onFailure) {
    const dirty = new Map();
    const clean = new Map();
    function failed(key) {
      try { if (typeof onFailure === "function") onFailure(key); } catch (_) { /* Notification must not break storage access. */ }
    }
    function readFresh(key) {
      try {
        const storage = getStorage();
        if (!storage || typeof storage.getItem !== "function") throw new Error("Storage unavailable");
        const raw = storage.getItem(key);
        const value = raw == null ? null : String(raw);
        if (value === null) clean.delete(key);
        else clean.set(key, value);
        return { ok: true, value };
      } catch (_) {
        failed(key);
        return { ok: false, value: null };
      }
    }
    function getItem(key) {
      if (dirty.has(key)) return dirty.get(key);
      const result = readFresh(key);
      return result.ok ? result.value : clean.get(key) ?? null;
    }
    function setMemory(key, value) {
      dirty.set(key, String(value));
      failed(key);
      return false;
    }
    function setItem(key, value) {
      const text = String(value);
      dirty.set(key, text);
      try {
        const storage = getStorage();
        if (!storage || typeof storage.setItem !== "function") throw new Error("Storage unavailable");
        storage.setItem(key, text);
        clean.set(key, text);
        dirty.delete(key);
        return true;
      } catch (_) {
        failed(key);
        return false;
      }
    }
    function invalidate(key) {
      if (key === null) clean.clear();
      else clean.delete(key);
      // Unsaved values are deliberately kept so that an export can still rescue them.
    }
    return { getItem, setItem, readFresh, setMemory, invalidate };
  }
  const api = { createSafeStorage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
