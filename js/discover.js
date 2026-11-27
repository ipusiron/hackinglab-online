(function () {
  "use strict";

  var doc = document;
  var langHelper = window.HLOLang;
  var currentLang = doc.documentElement.lang === "en" ? "en" : "ja";
  var copyGeneration = 0;
  var disclosure = doc.getElementById("share-materials");
  var shareText = doc.getElementById("share-description");
  var status = doc.getElementById("copy-status");
  var copyButton = doc.getElementById("copy-description");
  var titles = {
    ja: "見えている文字は、見たままとは限らない｜ハッキング・ラボ・オンライン",
    en: "There is more to text than meets the eye | Hacking Lab Online"
  };
  var descriptions = {
    ja: "見えない文字を見つける。文字を加工する。目立ち方を変える。無料のブラウザーツール3本で、見た目と中身の違いを確かめる小さな実験。",
    en: "Find invisible characters, distort a word, and change what stands out. Try three free browser tools that reveal differences between appearance and what is really there."
  };

  // Only the language is shared. Reading progress, history and incoming query data stay out.
  function publicUrl(lang) {
    return "https://hackinglab.online/discover.html" + (lang === "en" ? "?lang=en" : "");
  }

  function savedLanguage() {
    try { return localStorage.getItem("hlo_lang"); } catch (_) { return currentLang; }
  }

  function readLanguage() {
    if (langHelper) return langHelper.resolveLang(location.search, savedLanguage());
    var value = new URLSearchParams(location.search).get("lang");
    return value && value.trim().toLowerCase() === "en" ? "en" : "ja";
  }

  function setLinkLanguage(link, lang) {
    if (!link.dataset.originalHref) link.dataset.originalHref = link.getAttribute("href");
    var original = link.dataset.originalHref;
    if (link.hasAttribute("data-readme-link")) {
      link.setAttribute("href", original.replace(/README\.md$/, lang === "en" ? "README.en.md" : "README.md"));
      return;
    }
    var url = new URL(original, location.href);
    // An explicit JA arrival must also override the hub's saved EN preference.
    url.searchParams.set("lang", lang);
    link.setAttribute("href", url.href);
  }

  function applyLanguage(lang) {
    currentLang = lang === "en" ? "en" : "ja";
    copyGeneration += 1;
    doc.documentElement.lang = currentLang;
    doc.title = titles[currentLang];
    doc.querySelectorAll("button[data-lang]").forEach(function (button) {
      button.setAttribute("aria-pressed", String(button.dataset.lang === currentLang));
    });
    doc.querySelectorAll("[data-alt-ja]").forEach(function (image) {
      image.alt = image.getAttribute("data-alt-" + currentLang);
    });
    doc.querySelectorAll("[data-hub-link], [data-demo-link], [data-readme-link]").forEach(function (link) {
      setLinkLanguage(link, currentLang);
    });
    shareText.value = descriptions[currentLang] + "\n" + publicUrl(currentLang);
    shareText.lang = currentLang;
    status.textContent = "";
  }

  function writeHistory(push) {
    try {
      var url = new URL(location.href);
      // Explicit JA prevents a saved EN preference from changing a Back arrival.
      if (currentLang === "en" || push || url.searchParams.has("lang")) url.searchParams.set("lang", currentLang);
      var state = Object.assign({}, history.state || {}, { hloDiscoverLang: currentLang });
      history[push ? "pushState" : "replaceState"](state, "", url.href);
    } catch (_) { /* File URLs or restricted history still allow the controls to work. */ }
  }

  doc.querySelectorAll("button[data-lang]").forEach(function (button) {
    button.addEventListener("click", function () {
      var nextLang = button.dataset.lang;
      var changed = nextLang !== currentLang;
      applyLanguage(nextLang);
      try { localStorage.setItem("hlo_lang", currentLang); } catch (_) { /* Keep this page usable without storage. */ }
      if (changed) writeHistory(true);
    });
  });

  window.addEventListener("popstate", function (event) {
    var previous = event.state && event.state.hloDiscoverLang;
    applyLanguage(previous === "en" || previous === "ja" ? previous : readLanguage());
  });

  // Invalidate an unresolved clipboard request when its disclosure is closed.
  disclosure.addEventListener("toggle", function () {
    copyGeneration += 1;
    status.textContent = "";
  });
  window.addEventListener("pagehide", function () { copyGeneration += 1; });

  copyButton.addEventListener("click", async function () {
    var generation = ++copyGeneration;
    var lang = currentLang;
    var value = shareText.value;
    status.textContent = "";
    try {
      if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(value);
      if (generation !== copyGeneration || !disclosure.open) return;
      status.textContent = lang === "en" ? "Description copied." : "紹介文をコピーしました。";
    } catch (_) {
      if (generation !== copyGeneration || !disclosure.open) return;
      status.textContent = lang === "en" ? "Copy was unavailable. Select and copy the text in the box above." : "コピーできませんでした。上の欄の文字を選択してコピーしてください。";
    }
  });

  applyLanguage(currentLang);
  writeHistory(false);
  doc.querySelector(".language-controls").hidden = false;
  copyButton.hidden = false;
})();
