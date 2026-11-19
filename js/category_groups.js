// Category mappings and optional field metadata. No DOM or network access.
(function (root) {
  "use strict";
  const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const text = (s) => typeof s === "string" && s.length > 0 && s === s.trim();
  const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
  function keys(value, required, optional = []) {
    if (!object(value) || required.some((k) => !Object.hasOwn(value, k)) ||
        Object.keys(value).some((k) => !required.includes(k) && !optional.includes(k))) throw new Error("Invalid metadata properties");
  }
  function validateCategories(categories) {
    if (!Array.isArray(categories) || !categories.length) throw new Error("Invalid categories");
    const ids = new Set();
    const maps = { ja: new Map(), en: new Map() };
    for (const c of categories) {
      keys(c, ["id", "ja", "en"], ["aliases_ja", "aliases_en"]);
      if (!text(c.id) || !idPattern.test(c.id) || ids.has(c.id)) throw new Error("Invalid category id");
      ids.add(c.id);
      for (const lang of ["ja", "en"]) {
        const aliases = c["aliases_" + lang] === undefined ? [] : c["aliases_" + lang];
        if (!Array.isArray(aliases)) throw new Error("Invalid aliases");
        for (const label of [c[lang], ...aliases]) {
          if (!text(label) || maps[lang].has(label)) throw new Error("Invalid or duplicate category label");
          maps[lang].set(label, c.id);
        }
      }
    }
    return { ids, maps };
  }
  function validateGroups(data, categories) {
    const { ids, maps } = validateCategories(categories);
    keys(data, ["schema_version", "groups", "category_descriptions", "ignored_raw_names"]);
    if (data.schema_version !== 1 || !Array.isArray(data.groups) || !data.groups.length ||
        !Array.isArray(data.category_descriptions) || !Array.isArray(data.ignored_raw_names)) throw new Error("Invalid field metadata");
    const byId = new Map(); const members = new Set(); const descriptions = new Map(); const ignored = { ja: new Set(), en: new Set() };
    for (const g of data.groups) {
      keys(g, ["id", "ja", "en", "description_ja", "description_en", "category_ids"]);
      if (!text(g.id) || !idPattern.test(g.id) || byId.has(g.id) ||
          ![g.ja, g.en, g.description_ja, g.description_en].every(text) ||
          !Array.isArray(g.category_ids) || !g.category_ids.length) throw new Error("Invalid field");
      for (const id of g.category_ids) {
        if (!ids.has(id) || members.has(id)) throw new Error("Unknown or repeated field category");
        members.add(id);
      }
      byId.set(g.id, g);
    }
    for (const d of data.category_descriptions) {
      keys(d, ["category_id", "ja", "en"]);
      if (!ids.has(d.category_id) || descriptions.has(d.category_id) || !text(d.ja) || !text(d.en)) throw new Error("Invalid category description");
      descriptions.set(d.category_id, d);
    }
    for (const pair of data.ignored_raw_names) {
      keys(pair, ["lang", "name"]);
      if (!["ja", "en"].includes(pair.lang) || !text(pair.name) ||
          ignored[pair.lang].has(pair.name) || maps[pair.lang].has(pair.name)) throw new Error("Invalid ignored category name");
      ignored[pair.lang].add(pair.name);
    }
    return { groups: data.groups, byId, descriptions, ignored };
  }
  const api = { validateCategories, validateGroups };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOCategoryGroups = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
