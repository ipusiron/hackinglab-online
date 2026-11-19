// Pure progress-sharing text and URLs. No DOM, storage or current-page URL.
(function (root) {
  "use strict";
  const PUBLIC_ROOT = "https://hackinglab.online/";
  function summarizeProgress(tools, progressById, targetIds = null) {
    const targets = targetIds === null ? null : new Set(targetIds);
    const seen = new Set();
    const counts = { total: 0, worked: 0, mastered: 0 };
    for (const tool of tools) {
      if (!tool || tool.hub === false || typeof tool.id !== "string" ||
          !/^day(?!000)[0-9]{3}$/.test(tool.id) || seen.has(tool.id)) continue;
      seen.add(tool.id);
      if (targets && !targets.has(tool.id)) continue;
      const value = progressById.get(tool.id);
      const level = Number.isInteger(value) && value >= 0 && value <= 3 ? value : 0;
      counts.total++;
      if (level >= 2) counts.worked++;
      if (level === 3) counts.mastered++;
    }
    return counts;
  }
  function buildShare({ lang, counts, selection = null }) {
    const { total, worked, mastered } = counts;
    if (![total, worked, mastered].every(Number.isSafeInteger) || mastered < 0 ||
        worked < mastered || total < worked) throw new Error("Invalid share counts");
    if (selection && (typeof selection.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(selection.slug) ||
        typeof selection.label !== "string" || !selection.label.trim())) throw new Error("Invalid share selection");
    const ja = lang !== "en";
    const destination = new URL(PUBLIC_ROOT);
    if (selection) destination.searchParams.set("book", selection.slug);
    if (!ja) destination.searchParams.set("lang", "en");
    let sentence;
    if (!worked) {
      sentence = ja ? "「ハッキング・ラボ・オンライン」で、セキュリティツールを使って学んでいます🔬📚"
        : "Learning security hands-on with the tools at Hacking Lab Online 🔬";
    } else if (selection) {
      sentence = ja
        ? `「ハッキング・ラボ・オンライン」で、「${selection.label}」の${selection.related ? "関連ツール" : "ツール"}${total}本のうち${worked}本を一周しました🔬📚`
        : `I've worked through ${worked} of the ${total} ${total === 1 ? "tool" : "tools"} ${selection.related ? "related to" : "for"} “${selection.label}” at Hacking Lab Online 🔬`;
    } else {
      sentence = ja
        ? `「ハッキング・ラボ・オンライン」で、ツールを${worked}本一周しました${mastered ? `（うち定着済み${mastered}本）` : ""}🔬📚`
        : `I've worked through ${worked} ${worked === 1 ? "tool" : "tools"} at Hacking Lab Online${mastered ? ` (${mastered} mastered)` : ""} 🔬`;
    }
    const scopeNote = !selection ? "" : ja
      ? `いま選んでいる「${selection.label}」のツールの数で共有します。`
      : `Sharing will use your numbers for your current selection, “${selection.label}.”`;
    const hashtags = ja ? "#生成AIセキュリティツール #ハッキングラボオンライン" : "#GenAI #SecurityTools #HackingLabOnline";
    const url = destination.toString();
    const text = `${sentence}\n${url}\n${hashtags}`;
    return { sentence, url, text, scopeNote, intentUrl: "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text) };
  }
  const api = { summarizeProgress, buildShare };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOShare = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
