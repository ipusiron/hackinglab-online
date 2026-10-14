// js/books.js
//
// 書籍・シリーズフィルターの純関数（DOM 非依存）。
// ブラウザーでは IIFE で globalThis.HLOBooks に公開し、Node のテストでは module.exports から読む。
// ここにはロジックだけを置き、画面の描画は js/main.js が行う。

(function (root) {
  "use strict";

  // "dayNNN" を数値に。該当しなければ null。
  function dayNum(id) {
    var m = /^day(\d{3})$/.exec(typeof id === "string" ? id : "");
    return m ? parseInt(m[1], 10) : null;
  }

  // tools.json の id -> ツール（hub!==false のものだけ）の索引をつくる。
  function presentMap(tools) {
    var map = Object.create(null);
    if (!Array.isArray(tools)) return map;
    for (var i = 0; i < tools.length; i++) {
      var t = tools[i];
      if (t && typeof t.id === "string" && t.hub !== false) map[t.id] = t;
    }
    return map;
  }

  // 本の対象集合（ids ∪ id_range のうち tools.json に存在し hub!==false の id の Set）。
  function expandTargetIds(book, tools) {
    var present = presentMap(tools);
    var set = new Set();
    var i;
    if (book && Array.isArray(book.ids)) {
      for (i = 0; i < book.ids.length; i++) {
        if (present[book.ids[i]]) set.add(book.ids[i]);
      }
    }
    if (book && Array.isArray(book.id_range) && book.id_range.length === 2) {
      var lo = dayNum(book.id_range[0]);
      var hi = dayNum(book.id_range[1]);
      if (lo !== null && hi !== null && lo <= hi) {
        for (var id in present) {
          var n = dayNum(id);
          if (n !== null && n >= lo && n <= hi) set.add(id);
        }
      }
    }
    return set;
  }

  // ?book= の値を解決する。大文字・前後空白は正規化し、slug に完全一致したときだけ採用する。
  // 空・未知・"all" は未選択（""）。
  function resolveBookParam(search, books) {
    var params;
    try {
      params = new URLSearchParams(search || "");
    } catch (e) {
      return "";
    }
    var raw = params.get("book");
    if (raw == null) return "";
    var v = String(raw).trim().toLowerCase();
    if (!v || v === "all") return "";
    if (!Array.isArray(books)) return "";
    for (var i = 0; i < books.length; i++) {
      if (books[i] && String(books[i].slug).toLowerCase() === v) return books[i].slug;
    }
    return "";
  }

  // 現在の URL に ?book= を付ける/外す。ほかのパラメーターとハッシュは保つ。空になれば "?" を残さない。
  function buildUrlWithBook(href, slug) {
    var url = new URL(href);
    if (slug) url.searchParams.set("book", slug);
    else url.searchParams.delete("book");
    return url.toString();
  }

  function bookTitle(book, lang) {
    if (!book) return "";
    return lang === "en" ? (book.title_en || book.title_ja || "") : (book.title_ja || "");
  }

  function bookLabel(book, lang) {
    if (!book) return "";
    return lang === "en"
      ? (book.label_en || book.title_en || "")
      : (book.label_ja || book.title_ja || "");
  }

  // chapters の key -> ラベル。無ければ ""。
  function chapterLabel(book, key, lang) {
    if (book && Array.isArray(book.chapters)) {
      for (var i = 0; i < book.chapters.length; i++) {
        if (book.chapters[i].key === key) {
          return lang === "en" ? book.chapters[i].label_en : book.chapters[i].label_ja;
        }
      }
    }
    return "";
  }

  // ページ配列を "p.123" / "pp.123-125" に整える。複数は言語ごとの区切りでつなぐ。
  function formatPages(pages, lang) {
    if (!Array.isArray(pages) || !pages.length) return "";
    var parts = [];
    for (var i = 0; i < pages.length; i++) {
      var p = String(pages[i]);
      if (/^\d+-\d+$/.test(p)) parts.push("pp." + p);
      else if (/^\d+$/.test(p)) parts.push("p." + p);
    }
    return parts.join(lang === "en" ? ", " : "、");
  }

  // あるツールの、選択中の本での掲載チップ（場所ごとに1つ）。related の本は接頭辞を付ける。
  function formatRef(book, toolId, lang) {
    var out = [];
    if (!book) return out;
    var list = [];
    if (book.refs && Array.isArray(book.refs[toolId])) {
      for (var i = 0; i < book.refs[toolId].length; i++) list.push(book.refs[toolId][i]);
    }
    if (book.common_ref) list.push({ ch: book.common_ref });
    for (var j = 0; j < list.length; j++) {
      var ref = list[j];
      var label = chapterLabel(book, ref.ch, lang);
      if (!label) continue;
      var text = label;
      var pg = formatPages(ref.pages, lang);
      if (pg) text += " " + pg;
      if (book.relation === "related") text = (lang === "en" ? "Related: " : "関連: ") + text;
      out.push(text);
    }
    return out;
  }

  // 本の対象ツールを、chapters の順にグループへ分ける。
  // 各グループの items は tools.json の順。1つのツールは出る場所すべてに現れる。
  // chapters が無い本（シリーズ）は、見出し無しの単一グループ。
  function buildGroups(book, tools) {
    var target = expandTargetIds(book, tools);
    var ordered = Array.isArray(tools) ? tools : [];
    var i;
    if (!book || !Array.isArray(book.chapters) || !book.chapters.length) {
      var flat = [];
      for (i = 0; i < ordered.length; i++) {
        var t0 = ordered[i];
        if (t0 && t0.hub !== false && target.has(t0.id)) flat.push(t0);
      }
      return [{ key: null, label_ja: "", label_en: "", items: flat }];
    }
    var groups = [];
    for (var c = 0; c < book.chapters.length; c++) {
      var key = book.chapters[c].key;
      var items = [];
      for (i = 0; i < ordered.length; i++) {
        var t = ordered[i];
        if (!t || t.hub === false || !target.has(t.id)) continue;
        if (locationsOf(book, t.id).indexOf(key) !== -1) items.push(t);
      }
      if (items.length) {
        groups.push({
          key: key,
          label_ja: book.chapters[c].label_ja,
          label_en: book.chapters[c].label_en,
          items: items
        });
      }
    }
    return groups;
  }

  // あるツールが本の中で出る場所（ch）の一覧。refs ＋ common_ref。
  function locationsOf(book, toolId) {
    var out = [];
    if (book && book.refs && Array.isArray(book.refs[toolId])) {
      for (var i = 0; i < book.refs[toolId].length; i++) {
        var ch = book.refs[toolId][i].ch;
        if (out.indexOf(ch) === -1) out.push(ch);
      }
    }
    if (book && book.common_ref && out.indexOf(book.common_ref) === -1) out.push(book.common_ref);
    return out;
  }

  // 表示幅（非ASCII 1・ASCII 0.5）。
  function displayWidth(s) {
    var w = 0;
    s = String(s == null ? "" : s);
    for (var i = 0; i < s.length; i++) {
      w += s.charCodeAt(i) <= 0x7f ? 0.5 : 1;
    }
    return w;
  }

  var SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
  var DAY_RE = /^day\d{3}$/;
  var PAGE_RE = /^\d+(-\d+)?$/;
  var BOOK_KEYS = {
    slug: 1, kind: 1, title_ja: 1, title_en: 1, label_ja: 1, label_en: 1,
    url: 1, url_label_ja: 1, url_label_en: 1, relation: 1,
    note_ja: 1, note_en: 1, pages_note_ja: 1, pages_note_en: 1,
    dashboard: 1, ids: 1, id_range: 1, chapters: 1, common_ref: 1, refs: 1
  };
  var REF_KEYS = { ch: 1, pages: 1 };

  // books.json 全体を検証し、エラー文の配列を返す（空なら合格）。D1〜D15 に対応。
  function validateBooks(data, tools) {
    var errs = [];
    function e(msg) { errs.push(msg); }

    // D1
    if (!data || typeof data !== "object") { e("D1: ルートがオブジェクトでない"); return errs; }
    if (data.schema_version !== 1) e("D1: schema_version が 1 でない");
    if (!Array.isArray(data.books) || data.books.length < 1) { e("D1: books が1件以上の配列でない"); return errs; }

    // D14: tools.json 側
    var present = Object.create(null);
    if (Array.isArray(tools)) {
      var seenTool = Object.create(null);
      for (var ti = 0; ti < tools.length; ti++) {
        var tt = tools[ti];
        if (!tt || typeof tt.id !== "string" || !DAY_RE.test(tt.id)) { e("D14: tools.json の id が不正: " + (tt && tt.id)); continue; }
        if (seenTool[tt.id]) e("D14: tools.json の id が重複: " + tt.id);
        seenTool[tt.id] = true;
        if (typeof tt.hub !== "boolean") e("D14: tools.json の hub が真偽値でない: " + tt.id);
        if (tt.hub !== false) present[tt.id] = tt;
      }
    }

    var slugSeen = Object.create(null);
    var labelJaSeen = Object.create(null);
    var labelEnSeen = Object.create(null);

    for (var bi = 0; bi < data.books.length; bi++) {
      var b = data.books[bi];
      var where = "books[" + bi + "]" + (b && b.slug ? "(" + b.slug + ")" : "");
      if (!b || typeof b !== "object") { e("D2: " + where + " がオブジェクトでない"); continue; }

      // D2: 未知キー
      for (var k in b) { if (!BOOK_KEYS[k]) e("D2: " + where + " に未知のキー: " + k); }

      // D3: slug
      if (typeof b.slug !== "string" || !SLUG_RE.test(b.slug)) e("D3: " + where + " slug の形式が不正");
      else {
        if (b.slug.length > 40) e("D3: " + where + " slug が40文字超");
        if (b.slug.toLowerCase() === "all") e("D3: " + where + " slug は all 不可");
        if (slugSeen[b.slug.toLowerCase()]) e("D3: " + where + " slug が重複");
        slugSeen[b.slug.toLowerCase()] = true;
      }

      // D4: kind / relation / dashboard
      if (b.kind !== "book" && b.kind !== "series") e("D4: " + where + " kind が book/series でない");
      if (b.relation != null && b.relation !== "introduced" && b.relation !== "related") e("D4: " + where + " relation が introduced/related でない");
      if (b.dashboard != null && typeof b.dashboard !== "boolean") e("D4: " + where + " dashboard が真偽値でない");

      // D5: title / label
      if (!b.title_ja) e("D5: " + where + " title_ja が空");
      if (!b.title_en) e("D5: " + where + " title_en が空");
      if (!b.label_ja) e("D5: " + where + " label_ja が空");
      if (!b.label_en) e("D5: " + where + " label_en が空");
      if (b.label_ja && displayWidth(b.label_ja) > 14) e("D5: " + where + " label_ja の表示幅が14超");
      if (b.label_en && displayWidth(b.label_en) > 14) e("D5: " + where + " label_en の表示幅が14超");
      if (b.label_ja) { if (labelJaSeen[b.label_ja]) e("D5: " + where + " label_ja が重複"); labelJaSeen[b.label_ja] = true; }
      if (b.label_en) { if (labelEnSeen[b.label_en]) e("D5: " + where + " label_en が重複"); labelEnSeen[b.label_en] = true; }

      // D6: url / 両言語そろえ
      if (typeof b.url !== "string" || b.url.indexOf("https://") !== 0) e("D6: " + where + " url が https:// で始まらない");
      pairCheck(b, "url_label", where, e);
      pairCheck(b, "note", where, e);
      pairCheck(b, "pages_note", where, e);

      // D7: related の注記 / 注記の数字 / pages_note
      if (b.relation === "related" && !b.note_ja) e("D7: " + where + " related なのに note が無い");
      if (b.note_ja && /\d\s*本/.test(b.note_ja)) e("D7: " + where + " note_ja に『N本』がある");
      if (b.note_en && /\d\s*tools?/.test(b.note_en)) e("D7: " + where + " note_en に『N tools』がある");

      // D8: ids / id_range
      var hasIds = Array.isArray(b.ids);
      var hasRange = Array.isArray(b.id_range);
      if (!hasIds && !hasRange) e("D8: " + where + " ids も id_range も無い");
      var idSet = Object.create(null);
      if (hasIds) {
        var prevN = -1;
        for (var ii = 0; ii < b.ids.length; ii++) {
          var id = b.ids[ii];
          if (!DAY_RE.test(id)) { e("D8: " + where + " ids の形式が不正: " + id); continue; }
          if (idSet[id]) e("D8: " + where + " ids に重複: " + id);
          idSet[id] = true;
          var n = dayNum(id);
          if (n <= prevN) e("D8: " + where + " ids が昇順でない: " + id);
          prevN = n;
          // D9
          if (!present[id]) e("D9: " + where + " ids の " + id + " が tools.json に無い（または hub:false）");
        }
      }
      var rLo = null, rHi = null;
      if (hasRange) {
        if (b.id_range.length !== 2 || !DAY_RE.test(b.id_range[0]) || !DAY_RE.test(b.id_range[1])) e("D8: " + where + " id_range の形式が不正");
        else {
          rLo = dayNum(b.id_range[0]); rHi = dayNum(b.id_range[1]);
          if (rLo > rHi) e("D8: " + where + " id_range が逆順");
          // D10
          var inRange = 0;
          for (var pid in present) { var pn = dayNum(pid); if (pn >= rLo && pn <= rHi) inRange++; }
          if (!inRange) e("D10: " + where + " id_range 内に tools.json のツールが無い");
          // ids と range の重なり
          if (hasIds) for (var id2 in idSet) { var n2 = dayNum(id2); if (n2 >= rLo && n2 <= rHi) e("D8: " + where + " ids が id_range と重なる: " + id2); }
        }
      }

      // 対象集合
      var target = expandTargetIds(b, tools || []);

      // chapters
      var hasChapters = Array.isArray(b.chapters) && b.chapters.length;
      var hasRefs = b.refs && typeof b.refs === "object";
      var hasCommon = typeof b.common_ref === "string" && b.common_ref;
      var chapterKeys = Object.create(null);
      if (hasChapters) {
        var kSeen = Object.create(null);
        for (var ci = 0; ci < b.chapters.length; ci++) {
          var ch = b.chapters[ci];
          if (!ch || !SLUG_RE.test(ch.key || "")) { e("D11: " + where + " chapters の key が不正"); continue; }
          if (kSeen[ch.key]) e("D11: " + where + " chapters の key が重複: " + ch.key);
          kSeen[ch.key] = true;
          chapterKeys[ch.key] = true;
          if (!ch.label_ja || !ch.label_en) e("D11: " + where + " chapters[" + ch.key + "] の label が空");
        }
      }

      // D11: refs/common_ref があれば chapters が要る
      if ((hasRefs || hasCommon) && !hasChapters) e("D11: " + where + " refs/common_ref があるのに chapters が無い");

      // D13: common_ref は chapters の key で、明示 refs に同じ key を書かない
      if (hasCommon) {
        if (!chapterKeys[b.common_ref]) e("D13: " + where + " common_ref が chapters に無い: " + b.common_ref);
        if (hasRefs) {
          for (var rid in b.refs) {
            var arr = b.refs[rid];
            if (Array.isArray(arr)) for (var ri = 0; ri < arr.length; ri++) if (arr[ri].ch === b.common_ref) e("D13: " + where + " refs の " + rid + " に common_ref と同じ key がある");
          }
        }
      }

      // D12: refs の中身
      var usedKeys = Object.create(null);
      if (hasRefs) {
        for (var rkid in b.refs) {
          if (!target.has(rkid)) e("D12: " + where + " refs の " + rkid + " が対象集合に無い（または tools.json に無い）");
          var refArr = b.refs[rkid];
          if (!Array.isArray(refArr) || !refArr.length) { e("D12: " + where + " refs の " + rkid + " が空配列"); continue; }
          var chSeen = Object.create(null);
          for (var fi = 0; fi < refArr.length; fi++) {
            var rf = refArr[fi];
            for (var rk in rf) if (!REF_KEYS[rk]) e("D12: " + where + " refs の " + rkid + " に未知のキー: " + rk);
            if (hasChapters && !chapterKeys[rf.ch]) e("D12: " + where + " refs の " + rkid + " の ch が chapters に無い: " + rf.ch);
            if (chSeen[rf.ch]) e("D12: " + where + " refs の " + rkid + " に同じ ch が2回: " + rf.ch);
            chSeen[rf.ch] = true;
            usedKeys[rf.ch] = true;
            if (rf.pages != null) {
              if (!Array.isArray(rf.pages)) e("D12: " + where + " refs の " + rkid + " の pages が配列でない");
              else for (var pi = 0; pi < rf.pages.length; pi++) {
                var pstr = String(rf.pages[pi]);
                if (!PAGE_RE.test(pstr)) e("D12: " + where + " refs の " + rkid + " の pages 形式が不正: " + pstr);
                else if (pstr.indexOf("-") !== -1) { var pp = pstr.split("-"); if (parseInt(pp[0], 10) > parseInt(pp[1], 10)) e("D12: " + where + " refs の " + rkid + " の pages が逆順: " + pstr); }
              }
            }
          }
        }
      }
      if (hasCommon) usedKeys[b.common_ref] = true;

      // D11: どこからも使われない chapter key
      if (hasChapters) for (var ck in chapterKeys) if (!usedKeys[ck]) e("D11: " + where + " chapters の " + ck + " がどこからも使われていない");

      // D15: chapters があり common_ref が無い本は、対象集合の全 id に refs が要る。id_range＋chapters は common_ref 必須。
      if (hasChapters) {
        if (hasRange && !hasCommon) e("D15: " + where + " id_range と chapters を持つのに common_ref が無い");
        if (!hasCommon) {
          target.forEach(function (tid) {
            var has = hasRefs && Array.isArray(b.refs[tid]) && b.refs[tid].length;
            if (!has) e("D15: " + where + " 対象の " + tid + " に refs が無い");
          });
        }
      }
    }
    return errs;
  }

  function pairCheck(b, base, where, e) {
    var ja = b[base + "_ja"], en = b[base + "_en"];
    if ((ja == null) !== (en == null)) e("D6: " + where + " " + base + " の日英がそろっていない");
  }

  var api = {
    dayNum: dayNum,
    expandTargetIds: expandTargetIds,
    resolveBookParam: resolveBookParam,
    buildUrlWithBook: buildUrlWithBook,
    bookTitle: bookTitle,
    bookLabel: bookLabel,
    chapterLabel: chapterLabel,
    formatPages: formatPages,
    formatRef: formatRef,
    buildGroups: buildGroups,
    locationsOf: locationsOf,
    displayWidth: displayWidth,
    validateBooks: validateBooks
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOBooks = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
