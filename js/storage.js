// js/storage.js
// localStorage を安全に使うための小さなラッパー（DOM 非依存）。
// プライベートウィンドウや保存の禁止などで localStorage が使えない・例外を投げるときは、
// このページを開いているあいだだけメモリーに保持して、画面が壊れないようにする。
// ブラウザーでは globalThis.HLOStorage に公開し、Node のテストでは module.exports から読む。
(function (root) {
  "use strict";

  // getStorage: localStorage を返す関数。アクセスそのものが例外を投げる環境があるので関数で受ける。
  function createSafeStorage(getStorage) {
    const memory = new Map();

    function storage() {
      try {
        const s = getStorage();
        return s && typeof s.getItem === "function" ? s : null;
      } catch (e) {
        return null;
      }
    }

    function getItem(key) {
      const s = storage();
      if (s) {
        try {
          const v = s.getItem(key);
          if (v !== null && v !== undefined) return String(v);
        } catch (e) {
          /* メモリーへ退避 */
        }
      }
      return memory.has(key) ? memory.get(key) : null;
    }

    function setItem(key, value) {
      const v = String(value);
      memory.set(key, v);
      const s = storage();
      if (!s) return false;
      try {
        s.setItem(key, v);
        return true;
      } catch (e) {
        return false;
      }
    }

    return { getItem, setItem };
  }

  const api = { createSafeStorage };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOStorage = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
