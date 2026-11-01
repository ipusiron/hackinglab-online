// js/tabs.js
// タブのキーボード操作（WAI-ARIA の tabs パターン）で、次に選ぶタブの位置を決める純関数。
// ブラウザーでは globalThis.HLOTabs に公開し、Node のテストでは module.exports から読む。
(function (root) {
  "use strict";

  // key: KeyboardEvent.key、current: 今のタブの位置、count: タブの数。
  // 対象外のキーなら -1 を返す（呼び出し側は何もしない）。
  function nextTabIndex(key, current, count) {
    if (!(count > 0)) return -1;
    switch (key) {
      case "ArrowRight":
        return (current + 1) % count;
      case "ArrowLeft":
        return (current - 1 + count) % count;
      case "Home":
        return 0;
      case "End":
        return count - 1;
      default:
        return -1;
    }
  }

  const api = { nextTabIndex };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOTabs = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
