(function (root) {
  "use strict";
  var doc = root.document;
  var language = root.HLOLang;
  if (!doc || !language) return; // Keep both static languages if initialization is unavailable.
  doc.documentElement.classList.add("language-ready");
  function initialize() {
    var controls = doc.querySelector(".language-controls");
    var buttons = Array.from(doc.querySelectorAll("[data-lang]"));
    var current = language.resolveLang(root.location.search, language.readSaved(function () { return root.localStorage; }));
    function render(lang) {
      current = lang;
      doc.documentElement.lang = lang;
      doc.title = lang === "en" ? "What’s new | Hacking Lab Online" : "更新情報｜ハッキング・ラボ・オンライン";
      buttons.forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.lang === lang)); });
    }
    render(current);
    // Record the initial resolved language in this history entry without saving a
    // preference. Back must restore it even after the preference has changed.
    try { root.history.replaceState(Object.assign({}, root.history.state, { hloUpdatesLang: current }), ""); } catch (_) {}
    buttons.forEach(function (button) {
      button.addEventListener("click", function () {
        var lang = language.normalizeLang(button.dataset.lang);
        if (!lang) return;
        try { root.localStorage.setItem(language.KEY, lang); } catch (_) {}
        if (lang === current) return;
        render(lang);
        try {
          var url = new URL(root.location.href);
          url.searchParams.set("lang", lang);
          root.history.pushState(Object.assign({}, root.history.state, { hloUpdatesLang: lang }), "", url.pathname + url.search + url.hash);
        } catch (_) {} // Reading and switching remain available without History API.
      });
    });
    root.addEventListener("popstate", function (event) {
      render(language.normalizeLang(event.state && event.state.hloUpdatesLang) || language.resolveLang(root.location.search, language.readSaved(function () { return root.localStorage; })));
    });
    if (controls) controls.hidden = false;
  }
  if (doc.readyState === "loading") doc.addEventListener("DOMContentLoaded", initialize, { once: true });
  else initialize();
})(typeof globalThis !== "undefined" ? globalThis : this);
