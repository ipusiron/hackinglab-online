"use strict";

// Only catalog first-listing dates are generated. Site improvements are curated
// separately with a published source; neither is a tool's last-modified date.
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function validDate(value) {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + "T00:00:00Z"))
    && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
function recentTools(toolsData, limit = 10) {
  if (!Array.isArray(toolsData?.tools)) throw new Error("Missing tools array");
  const tools = toolsData.tools.filter(tool => tool.hub !== false && validDate(tool.added));
  const seen = new Set();
  for (const tool of tools) {
    if (!/^day\d{3,}$/.test(tool.id) || typeof tool.title !== "string" || !tool.title.trim() || seen.has(tool.id)) {
      throw new Error("Invalid or duplicate recent tool");
    }
    seen.add(tool.id);
  }
  return tools.slice().sort((a, b) => b.added.localeCompare(a.added) || Number(a.id.slice(3)) - Number(b.id.slice(3))).slice(0, limit);
}
function validateUpdates(data) {
  if (data?.schema_version !== 1 || !Array.isArray(data.updates)) throw new Error("Invalid updates schema");
  const seen = new Set();
  for (const item of data.updates) {
    if (!/^[a-z][a-z0-9-]*$/.test(item.id) || seen.has(item.id) || !validDate(item.published_on)) throw new Error("Invalid update ID or date");
    seen.add(item.id);
    for (const field of ["title_ja", "title_en", "description_ja", "description_en", "link_ja", "link_en"]) {
      if (typeof item[field] !== "string" || !item[field].trim()) throw new Error("Missing update field: " + field);
    }
    // These are deliberate destinations, not arbitrary external links.
    if (!/^\.\/(?:index\.html(?:\?(?:tab=dashboard|maxDifficulty=[1-4]|tools=day\d{3,}(?:,day\d{3,}){0,11}))?|discover\.html)$/.test(item.href)) throw new Error("Invalid update destination");
    const publishedSource = /^https:\/\/github\.com\/ipusiron\/hackinglab-online\/pull\/[1-9]\d*$/.test(item.source_url) && item.source_ref === undefined;
    const sameRelease = item.source_ref === "current-release" && item.source_url === undefined;
    if (!publishedSource && !sameRelease) throw new Error("Missing published update source or current-release reference");
  }
  return data.updates.slice().sort((a, b) => b.published_on.localeCompare(a.published_on));
}
function bilingual(ja, en) {
  return `<span class="label-ja" lang="ja">${escapeHtml(ja)}</span><span class="label-en" lang="en">${escapeHtml(en)}</span>`;
}
function localLink(href, ja, en, className = "text-link") {
  const make = (lang, label) => {
    const url = new URL(href, "https://hackinglab.online/");
    url.searchParams.set("lang", lang);
    return `<a class="${className} label-${lang}" lang="${lang}" href=".${escapeHtml(url.pathname + url.search + url.hash)}">${escapeHtml(label)}</a>`;
  };
  return make("ja", ja) + make("en", en);
}
function buildUpdatesPage(toolsData, updatesData) {
  const updates = validateUpdates(updatesData);
  const tools = recentTools(toolsData);
  const lines = [
    "<!DOCTYPE html>", '<html lang="ja">', "  <head>", '    <meta charset="UTF-8">',
    '    <meta name="viewport" content="width=device-width, initial-scale=1">',
    "    <title>更新情報｜ハッキング・ラボ・オンライン</title>",
    '    <meta name="description" content="ハッキング・ラボ・オンラインの主な改良と、最近追加されたツールを確認できます。">',
    '    <link rel="canonical" href="https://hackinglab.online/updates.html">',
    '    <meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\'; img-src \'self\'; base-uri \'none\'; form-action \'none\'; object-src \'none\'">',
    '    <link rel="icon" href="./favicon/HLO.ico" sizes="any">',
    '    <link rel="stylesheet" href="./css/updates.css">',
    '    <script src="./js/lang.js"></script>', '    <script src="./js/updates.js"></script>',
    "  </head>", "  <body>",
    `    <a class="skip-link" href="#main-content">${bilingual("本文へ", "Skip to content")}</a>`,
    '    <header class="updates-header">',
    `      <div class="brand-links">${localLink("./index.html", "ハッキング・ラボ・オンライン", "Hacking Lab Online", "brand")}</div>`,
    '      <nav class="language-controls" aria-label="言語 / Language" hidden>',
    '        <button type="button" data-lang="ja" aria-pressed="true" lang="ja">JA<span class="visually-hidden"> 日本語</span></button>',
    '        <button type="button" data-lang="en" aria-pressed="false" lang="en">EN<span class="visually-hidden"> English</span></button>',
    '      </nav>', '    </header>', '    <main id="main-content" tabindex="-1">',
    `      <h1>${bilingual("更新情報", "What’s new")}</h1>`,
    `      <p class="intro">${bilingual("サイトの主な改良と、新しく掲載されたツールを紹介します。", "See notable site improvements and newly listed tools.")}</p>`,
    '      <section aria-labelledby="site-improvements">',
    `        <h2 id="site-improvements">${bilingual("サイトの主な改良", "Site improvements")}</h2>`,
    '        <ol class="update-list">'
  ];
  for (const item of updates) {
    lines.push(`          <li id="${escapeHtml(item.id)}"><time datetime="${item.published_on}">${item.published_on}</time>`,
      `            <h3>${bilingual(item.title_ja, item.title_en)}</h3>`,
      `            <p>${bilingual(item.description_ja, item.description_en)}</p>`,
      `            <div class="entry-links">${localLink(item.href, item.link_ja, item.link_en)}</div>`, "          </li>");
  }
  lines.push('        </ol>', '      </section>', '      <section aria-labelledby="recent-tools">',
    `        <h2 id="recent-tools">${bilingual("最近追加されたツール", "Recently added tools")}</h2>`,
    `        <p class="section-note">${bilingual("この一覧への初掲載日が新しい10本です。ツール自体の更新日ではありません。同じ日のツールはDay順に表示します。", "The 10 tools most recently listed in this catalog. Dates show first listing, not tool updates. Tools listed on the same day appear in Day order.")}</p>`,
    '        <ol class="tool-list">');
  for (const tool of tools) {
    const day = "Day" + tool.id.slice(3);
    lines.push(`          <li data-tool-id="${escapeHtml(tool.id)}">`,
      `            <p class="tool-meta">${escapeHtml(day)} · ${bilingual("初掲載", "First listed")} <time datetime="${tool.added}">${tool.added}</time></p>`,
      `            <h3>${localLink(`./index.html?tools=${tool.id}#${tool.id}`, tool.title, tool.title, "tool-link")}</h3>`,
      `            <p>${bilingual(tool.subtitle_ja || "", tool.subtitle_en || "")}</p>`, "          </li>");
  }
  lines.push('        </ol>', '      </section>', '    </main>',
    `    <footer>${localLink("./index.html", "ツール一覧に戻る", "Back to the tool catalog")}</footer>`,
    '  </body>', '</html>', '');
  return lines.join("\n");
}
module.exports = { escapeHtml, validDate, recentTools, validateUpdates, buildUpdatesPage };
