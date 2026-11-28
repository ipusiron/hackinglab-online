(function (root) {
  "use strict";
  var U = typeof module !== "undefined" && module.exports ? require("./url.js") : root.HLOUrl;
  function catalogTools(data) {
    if (!data || data.schema_version !== 1 || !Array.isArray(data.tools)) throw new Error("Invalid catalog");
    var seen = new Set();
    return data.tools.filter(function (tool) {
      if (!tool || typeof tool !== "object" || !/^day\d{3}$/.test(tool.id) || typeof tool.title !== "string" || !tool.title.trim() || seen.has(tool.id)) throw new Error("Invalid tool");
      seen.add(tool.id);
      return tool.hub !== false;
    });
  }
  function select(search, data) {
    var tools = catalogTools(data);
    var selection = U.readTools(search, tools.map(function (tool) { return tool.id; }));
    var map = new Map(tools.map(function (tool) { return [tool.id, tool]; }));
    return { tools: selection.ids.map(function (id) { return map.get(id); }), unknown: selection.unknown, truncated: selection.truncated };
  }
  function collectionUrl(ids, lang) {
    var url = new URL(U.buildUrl("https://hackinglab.online/", { tools: ids }));
    url.searchParams.set("lang", lang === "en" ? "en" : "ja");
    return url.href;
  }
  function safeLink(value) {
    try { var url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; } catch (_) { return ""; }
  }
  var api = { select: select, collectionUrl: collectionUrl, safeLink: safeLink };
  if (typeof module !== "undefined" && module.exports) { module.exports = api; return; }
  root.HLOPrint = api;
  var doc = root.document, data = null, state = "loading", selected = [];
  var selectionSearch = root.location.search;
  var lang = doc.documentElement.lang === "en" ? "en" : "ja";
  var list = doc.getElementById("handout-list"), status = doc.getElementById("handout-status");
  var printButton = doc.getElementById("handout-print"), retry = doc.getElementById("handout-retry");
  function text(ja, en) { return lang === "ja" ? ja : en; }
  function paragraph(parent, value, className) {
    var p = doc.createElement("p"); p.textContent = value; if (className) p.className = className; parent.appendChild(p); return p;
  }
  function readLanguage() { return root.HLOLang.resolveLang(root.location.search, root.HLOLang.readSaved(function () { return root.localStorage; })); }
  function languageHistory() { return Object.assign({}, root.history.state, { hloPrintLang: lang }); }
  function render() {
    doc.documentElement.lang = lang;
    doc.title = text("ツールセットの配布資料｜ハッキング・ラボ・オンライン", "Tool set handout | Hacking Lab Online");
    doc.querySelectorAll("[data-lang]").forEach(function (button) { button.setAttribute("aria-pressed", String(button.dataset.lang === lang)); });
    list.replaceChildren(); selected = [];
    var result = data ? select(selectionSearch, data) : null;
    if (result) selected = result.tools;
    var ids = selected.map(function (tool) { return tool.id; });
    var url = collectionUrl(ids, lang);
    if (state === "ready") {
      // Browser-generated print headers must not reproduce unrelated incoming query strings.
      var clean = new URL(root.location.href); clean.search = new URL(url).search; clean.hash = "";
      try { root.history.replaceState(languageHistory(), "", clean.href); } catch (_) { /* Restricted history. */ }
    }
    // A relative same-origin return link also works for local previews. Only public IDs and language are retained.
    var back = new URL("./", root.location.href); back.search = new URL(url).search; back.searchParams.set("lang", lang);
    doc.getElementById("handout-back").href = back.href;
    var source = doc.getElementById("handout-source"); source.hidden = !selected.length;
    source.textContent = text("このセット：", "This set: ") + url;
    printButton.disabled = state !== "ready" || !selected.length;
    retry.hidden = state !== "error";
    list.setAttribute("aria-busy", String(state === "loading"));
    if (state === "loading") status.textContent = text("ツールを読み込んでいます。", "Loading tools.");
    else if (state === "unauthorized") status.textContent = text("読み込みが認証エラーで止まりました。ツール一覧へ戻ってください。", "Loading stopped after an authorization error. Return to the tool list.");
    else if (state === "error") status.textContent = text("ツールを読み込めませんでした。通信を確認して、やり直してください。", "Tools could not be loaded. Check your connection and try again.");
    else if (!selected.length) status.textContent = text("印刷するツールがありません。一覧の共有セットから開いてください。", "There are no tools to print. Open a shared set from the tool list.");
    else status.textContent = text(selected.length + "本の配布資料です。", "Handout with " + selected.length + " tools.") + (result.unknown ? text(" 見つからないツールは省きました。", " Unavailable tools were omitted.") : "") + (result.truncated ? text(" 先頭の12本を表示しています。", " Showing the first 12 tools.") : "");
    selected.forEach(function (tool) {
      var item = doc.createElement("li"); item.className = "handout-tool"; item.dataset.toolId = tool.id;
      var heading = doc.createElement("h2"); heading.textContent = tool.id.replace("day", "Day") + " — " + tool.title; item.appendChild(heading);
      paragraph(item, (lang === "en" ? tool.description_en : tool.description_ja) || (lang === "en" ? tool.subtitle_en : tool.subtitle_ja) || "");
      var prep = root.HLOPreparation && root.HLOPreparation.get(tool.id, lang);
      if (prep) paragraph(item, text("準備：", "Preparation: ") + prep.environment + " " + prep.prepare);
      var links = doc.createElement("div"); links.className = "handout-tool-links";
      [[text("デモ", "Demo"), U.demoLink(tool.demo_url, lang)], [text("使い方", "Usage"), U.repoLink(tool.repo_url, lang, tool.readme_usage)]].forEach(function (entry) {
        var href = safeLink(entry[1]); if (!href) return;
        var link = doc.createElement("a"); link.href = href; link.textContent = entry[0]; link.target = "_blank"; link.rel = "noopener noreferrer"; links.appendChild(link);
      });
      item.appendChild(links);
      paragraph(item, collectionUrl([tool.id], lang) + "#" + tool.id, "handout-url");
      var notes = doc.createElement("div"); notes.className = "handout-notes";
      paragraph(notes, text("気づいたこと・次に試したいこと", "Observations / What to try next"));
      for (var i = 0; i < 2; i++) { var line = doc.createElement("div"); line.className = "handout-note-line"; line.setAttribute("aria-hidden", "true"); notes.appendChild(line); }
      item.appendChild(notes); list.appendChild(item);
    });
  }
  async function load() {
    var restoreFocus = doc.activeElement === retry;
    if (restoreFocus) status.focus();
    state = "loading"; data = null; render();
    var controller = new AbortController(), timer;
    try {
      var timeout = new Promise(function (_, reject) { timer = root.setTimeout(function () { controller.abort(); reject(new Error("Catalog timeout")); }, 12000); });
      var request = (async function () {
        var response = await fetch("./data/tools.json", { signal: controller.signal });
        if (response.status === 401) return { unauthorized: true };
        if (!response.ok) throw new Error("Catalog request failed");
        var next = await response.json(); catalogTools(next); return { data: next };
      })();
      var result = await Promise.race([request, timeout]);
      if (result.unauthorized) state = "unauthorized";
      else { data = result.data; state = "ready"; }
    } catch (_) { state = "error"; }
    finally {
      root.clearTimeout(timer); render();
      if (restoreFocus && doc.activeElement === status) {
        if (state === "error") retry.focus();
        else if (!printButton.disabled) printButton.focus();
      }
    }
  }
  doc.querySelectorAll("[data-lang]").forEach(function (button) {
    button.addEventListener("click", function () {
      var next = button.dataset.lang; if (next === lang) return; lang = next;
      try { root.localStorage.setItem("hlo_lang", lang); } catch (_) { /* Language still switches. */ }
      var url = new URL(root.location.href); url.searchParams.set("lang", lang);
      try { root.history.pushState(languageHistory(), "", url); } catch (_) { /* Restricted history. */ }
      render();
    });
  });
  root.addEventListener("popstate", function (event) {
    selectionSearch = root.location.search;
    var previous = event.state && event.state.hloPrintLang;
    lang = previous === "ja" || previous === "en" ? previous : readLanguage();
    render();
  });
  retry.addEventListener("click", load);
  printButton.addEventListener("click", function () { if (state === "ready" && selected.length) root.print(); });
  // Remember this entry's resolved language before loading, without saving a
  // preference. Back must restore it even if a language button changes storage.
  try { root.history.replaceState(languageHistory(), ""); } catch (_) { /* Restricted history. */ }
  load();
})(typeof globalThis !== "undefined" ? globalThis : this);
