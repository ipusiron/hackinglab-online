// test/site.test.js
// 依存なし（node:test / node:assert/strict / node:fs / node:zlib のみ）。
// U1〜U2 は js/storage.js・js/tabs.js の純関数、H1〜H15 は index.html / js/main.js / css/style.css の静的な検査、
// H16〜H20 はデータの読み込みの決まり（ハブの CLAUDE.md の Loading data）の検査、H21〜 は検索と絞り込み・一覧の表示の静的な検査。

const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSafeStorage } = require("../js/storage.js");
const { nextTabIndex } = require("../js/tabs.js");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

// ---- U: 純関数 ----

function fakeStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _m: m
  };
}

test("U1: 使える localStorage には読み書きをそのまま渡す", () => {
  const ls = fakeStorage();
  const s = createSafeStorage(() => ls);
  assert.equal(s.getItem("progress_a"), null);
  assert.equal(s.setItem("progress_a", 2), true);
  assert.equal(ls._m.get("progress_a"), "2");
  assert.equal(s.getItem("progress_a"), "2");
});

test("U1: localStorage へのアクセス自体が例外を投げても、例外を出さずメモリーで保持する", () => {
  const s = createSafeStorage(() => {
    throw new Error("SecurityError");
  });
  assert.equal(s.getItem("progress_a"), null);
  assert.equal(s.setItem("progress_a", 3), false);
  assert.equal(s.getItem("progress_a"), "3");
});

test("U1: getItem / setItem が例外を投げても（保存の禁止・容量超過）、例外を出さない", () => {
  const throwing = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    }
  };
  const s = createSafeStorage(() => throwing);
  assert.equal(s.getItem("progress_b"), null);
  assert.equal(s.setItem("progress_b", 1), false);
  assert.equal(s.getItem("progress_b"), "1");
});

test("U1: localStorage が null / undefined でも動く", () => {
  for (const v of [null, undefined]) {
    const s = createSafeStorage(() => v);
    assert.equal(s.getItem("k"), null);
    s.setItem("k", "1");
    assert.equal(s.getItem("k"), "1");
  }
});

test("U2: タブのキーボード操作（←/→ は循環、Home/End は端、ほかのキーは -1）", () => {
  assert.equal(nextTabIndex("ArrowRight", 0, 2), 1);
  assert.equal(nextTabIndex("ArrowRight", 1, 2), 0);
  assert.equal(nextTabIndex("ArrowLeft", 0, 2), 1);
  assert.equal(nextTabIndex("ArrowLeft", 1, 2), 0);
  assert.equal(nextTabIndex("Home", 1, 3), 0);
  assert.equal(nextTabIndex("End", 0, 3), 2);
  assert.equal(nextTabIndex("Enter", 0, 2), -1);
  assert.equal(nextTabIndex("ArrowRight", 0, 0), -1);
});

// ---- H: index.html / main.js の静的な検査 ----

const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
// JS が描画時に作る要素の id（例: 書籍バナーの見出し book-banner-title）
const jsIds = new Set([...mainJs.matchAll(/\.id = "([^"]+)"/g)].map((m) => m[1]));

function openTag(idValue) {
  const m = html.match(new RegExp(`<[a-z0-9]+[^>]*\\sid="${idValue}"[^>]*>`, "s"));
  assert.ok(m, `id="${idValue}" の要素がない`);
  return m[0];
}

test("H1: aria-controls / aria-labelledby が指す id はすべて存在する", () => {
  const refs = [...html.matchAll(/aria-(?:controls|labelledby)="([^"]+)"/g)].flatMap((m) =>
    m[1].split(/\s+/)
  );
  assert.ok(refs.length > 0);
  for (const r of refs) {
    assert.ok(ids.has(r) || jsIds.has(r), `存在しない id を指している: ${r}`);
  }
});

test("H2: タブは tablist / tab / tabpanel で、tab と tabpanel が相互に指し合う", () => {
  assert.match(openTag("tab-nav"), /role="tablist"/);
  for (const [tab, panel] of [
    ["tab-tools-label", "tab-tools"],
    ["tab-dashboard-label", "tab-dashboard"]
  ]) {
    const t = openTag(tab);
    const p = openTag(panel);
    assert.match(t, /role="tab"/);
    assert.match(t, new RegExp(`aria-controls="${panel}"`));
    assert.match(p, /role="tabpanel"/);
    assert.match(p, new RegExp(`aria-labelledby="${tab}"`));
  }
});

test("H3: ヘルプは role=dialog・aria-modal=true・見出しを指す aria-labelledby を持つ", () => {
  const d = openTag("help-dialog");
  assert.match(d, /role="dialog"/);
  assert.match(d, /aria-modal="true"/);
  const label = d.match(/aria-labelledby="([^"]+)"/);
  assert.ok(label, "aria-labelledby がない");
  assert.match(openTag(label[1]), /^<h2\b/);
  // Esc とフォーカスの出し入れを main.js が扱っている
  assert.match(mainJs, /"Escape"/);
  assert.match(mainJs, /returnFocusTo/);
});

test("H4: h1 がちょうど1つあり、サイト名（日英）を含む", () => {
  const h1s = html.match(/<h1\b[\s\S]*?<\/h1>/g) || [];
  assert.equal(h1s.length, 1);
  assert.match(h1s[0], /ハッキング・ラボ・オンライン/);
  assert.match(h1s[0], /Hacking Lab Online/);
});

test("H5: 言語切替で html の lang を切り替える", () => {
  assert.match(html, /<html lang="ja">/);
  assert.match(mainJs, /document\.documentElement\.lang\s*=/);
});

test("H6: フッターの文言に英語版がある", () => {
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)[0];
  const ja = (footer.match(/class="label-ja"/g) || []).length;
  const en = (footer.match(/class="label-en"/g) || []).length;
  assert.ok(ja > 0 && ja === en, `label-ja ${ja} 個に対し label-en ${en} 個`);
  assert.match(footer, /GitHub repository/);
});

test("H7: 英語のサブタイトルが「100」だけを名乗らない", () => {
  const sub = html.match(/<div class="site-subtitle">[\s\S]*?<\/div>/)[0];
  assert.match(sub, /Security\s+Tools with Generative AI/);
  assert.doesNotMatch(sub, /100/);
});

test("H8: CSP が meta にあり、インラインのスクリプト・style 属性・イベント属性がない", () => {
  const m = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  assert.ok(m, "CSP の meta がない");
  const csp = m[1];
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /script-src 'self'(;|$)/);
  assert.match(csp, /style-src 'self'(;|$)/);
  assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|\*/);
  assert.doesNotMatch(html, /<script(?![^>]*\ssrc=)[^>]*>/, "インラインの script がある");
  assert.doesNotMatch(html, /\sstyle="/, "style 属性がある");
  assert.doesNotMatch(html, /\son[a-z]+="/, "イベント属性がある");
  // 読み込むスクリプトはすべて同一オリジン
  for (const s of html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)) {
    assert.match(s[1], /^\.\//, `外部スクリプト: ${s[1]}`);
    assert.ok(fs.existsSync(path.join(ROOT, s[1])), `存在しないスクリプト: ${s[1]}`);
  }
});

test("H9: main.js が localStorage を直接読み書きしない（try/catch のある経路だけ）", () => {
  // progressStore の代替実装（try で囲んだ2か所）以外に localStorage.getItem / setItem がない
  const calls = mainJs.match(/localStorage\.(getItem|setItem)\(/g) || [];
  assert.ok(calls.length <= 2, `localStorage の直接呼び出しが ${calls.length} か所`);
  assert.match(mainJs, /progressStore\.getItem/);
  assert.match(mainJs, /progressStore\.setItem/);
});

// ---- css/style.css の静的な検査 ----

// CSS の規則を { selector, body } の配列にする（コメントを除き、@media の中も平らに拾う簡易版）
function cssRules(text) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(text))) out.push({ selector: m[1].trim(), body: m[2] });
  return out;
}
const rules = cssRules(cssNoComments);
const bodyOf = (sel) =>
  rules
    .filter((r) => r.selector.split(",").map((s) => s.trim()).includes(sel))
    .map((r) => r.body)
    .join("\n");
// @media (...) { ... } の中身（ファイルの先頭の段で閉じる "\n}" まで）
const mediaBlocks = (condRe) =>
  [...cssNoComments.matchAll(new RegExp(String.raw`@media\s*\(${condRe.source}\)\s*\{([\s\S]*?)\n\}`, "g"))].map(
    (m) => ({ index: m.index, body: m[1] })
  );

test("H10: 折りたたみの見出し（summary）は開閉の印を消さない（display を変えない・list-style: none にしない）", () => {
  const sums = rules.filter(
    (r) => /summary(?!::)/.test(r.selector) && !/::(?:marker|-webkit-details-marker)/.test(r.selector)
  );
  assert.ok(sums.length > 0);
  for (const r of sums) {
    assert.doesNotMatch(r.body, /(^|[;\s])display\s*:\s*(?!list-item)/, `${r.selector} が display を変えている（印が消える）`);
    assert.doesNotMatch(r.body, /list-style(-type)?\s*:\s*none/, `${r.selector} が印を消している`);
  }
});

test("H11: ヘルプを開いているあいだ後ろのページを動かさず、「×」は本文と一緒に流れない", () => {
  assert.match(bodyOf(".modal-content"), /overscroll-behavior\s*:\s*contain/);
  assert.match(bodyOf("html.help-open"), /overflow\s*:\s*hidden/);
  assert.match(bodyOf(".modal-close"), /position\s*:\s*sticky/);
  assert.match(mainJs, /classList\.add\("help-open"\)/);
  // 外すのは閉じる処理（closeHelp）の1か所だけ。ほかの経路で閉じると、ページがスクロールできないまま残る
  const removes = mainJs.match(/classList\.remove\("help-open"[,)]/g) || [];
  assert.equal(removes.length, 1);
  assert.match(mainJs, /const closeHelp = \(\) => \{[^}]*classList\.remove\("help-open"[,)]/);
});

test("H12: 強制カラーでも、選ばれたタブと円グラフ・凡例・進捗の棒を見分けられる", () => {
  const forced = mediaBlocks(/forced-colors:\s*active/).map((b) => b.body).join("\n");
  assert.match(forced, /\.tab-button\[aria-selected="true"\]\s*\{[^}]*border-bottom-color:\s*Highlight/);
  assert.match(forced, /\.tab-button\[aria-selected="true"\]\s*\{[^}]*font-weight:\s*700/);
  for (const sel of [".pie-chart", ".pie-legend-color", ".category-progress-bar"]) {
    assert.ok(forced.includes(sel), `${sel} の指定がない`);
  }
  assert.match(forced, /forced-color-adjust:\s*none/);
});

test("H13: 動きを減らす設定では、カードとカードのボタンをホバーで浮かせない（ホバーの規則より後ろで打ち消す）", () => {
  const blocks = mediaBlocks(/prefers-reduced-motion:\s*reduce/);
  assert.ok(blocks.length > 0, "prefers-reduced-motion: reduce の指定がない");
  const last = blocks[blocks.length - 1];
  for (const sel of [".tool-card:hover", ".tool-footer .tool-button:hover", ".tool-progress-button:hover"]) {
    assert.ok(last.body.includes(sel), `${sel} を打ち消していない`);
  }
  assert.match(last.body, /transform:\s*none/);
  assert.match(last.body, /transition:\s*none/);
  // 浮かせるホバーの規則（translateY）より後ろにある（前にあると同じ詳細度のホバーの規則が勝つ）
  const lifts = [...cssNoComments.matchAll(/:hover\s*\{[^}]*transform:\s*translateY/g)].map((m) => m.index);
  assert.ok(lifts.length > 0);
  assert.ok(last.index > Math.max(...lifts), "ホバーの規則より前にある");
});

test("H14: ヘルプを閉じたら、開く前にフォーカスがなかったとき（マウスで押した Safari など）も ? へフォーカスを戻す", () => {
  const open = mainJs.match(/const openHelp = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(open, "openHelp がない");
  assert.match(open[0], /returnFocusTo\s*=\s*[^;]*document\.body[^;]*helpButton/);
});

test("H15: ヘルプを開いたとき、スクロールバーの幅を残すのは開く前にスクロールバーが幅を取っていたときだけ", () => {
  // いつも残すと、スクロールバーのない短いページで開いたときに後ろのページが横にずれる
  assert.doesNotMatch(bodyOf("html.help-open"), /scrollbar-gutter/);
  assert.match(bodyOf("html.help-open.keep-gutter"), /scrollbar-gutter\s*:\s*stable/);
  const open = mainJs.match(/const openHelp = \(\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(open, "openHelp がない");
  assert.match(open[0], /classList\.toggle\("keep-gutter",\s*window\.innerWidth\s*-\s*[\w.]+\.clientWidth\s*>\s*1\)/);
  // keep-gutter を付けてから help-open を付ける（スクロールバーが消える前に測る）
  assert.ok(open[0].indexOf('"keep-gutter"') < open[0].indexOf('classList.add("help-open")'));
  assert.match(mainJs, /classList\.remove\("help-open",\s*"keep-gutter"\)/);
});

// ---- データの読み込みの決まり（ハブの CLAUDE.md の Loading data） ----

// JS のコメント（// と /* */）を空白に置き換える。文字列の中はそのまま（位置は変えない）
function blankComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      for (; j < src.length && src[j] !== c; j++) if (src[j] === "\\") j++;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === "/" && src[i + 1] === "/") {
      let j = src.indexOf("\n", i);
      if (j < 0) j = src.length;
      out += " ".repeat(j - i);
      i = j - 1;
    } else if (c === "/" && src[i + 1] === "*") {
      let j = src.indexOf("*/", i + 2);
      j = j < 0 ? src.length : j + 2;
      out += src.slice(i, j).replace(/[^\n]/g, " ");
      i = j - 1;
    } else {
      out += c;
    }
  }
  return out;
}

// loadData の本体（宣言から、行頭の "}" まで。コメントは空白にする）
function loadDataBody() {
  const m = mainJs.match(/async function loadData\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(m, "loadData がない");
  return blankComments(m[0]);
}

// main.js の関数の本体（宣言から、行頭の "}" まで。コメントは空白にする）
function fnBody(name) {
  const m = mainJs.match(new RegExp(String.raw`(?:async\s+)?function ${name}\([^)]*\)\s*\{[\s\S]*?\n\}`));
  assert.ok(m, `${name} がない`);
  return blankComments(m[0]);
}

// 文字列の中を飛ばしながら、pos にある "(" に対応する ")" の位置を返す
function matchParen(src, pos) {
  let depth = 0;
  for (let i = pos; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return i;
  }
  return -1;
}

test("H16: script はすべて defer で async なし。books → search → storage → tabs → main の順に書き、main.js が最後", () => {
  const tags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => m[0]);
  const srcs = tags.map((t) => (t.match(/\ssrc="([^"]+)"/) || [])[1]);
  for (const t of tags) {
    assert.match(t, /\sdefer[\s>]/, `defer がない（meta の CSP で Chromium の先読みが止まり、1本ずつ取りに行くことがある）: ${t}`);
    assert.doesNotMatch(t, /\sasync[\s>=]/, `async は実行の順番を保たない（main.js が books.js より先に動くと書籍の絞り込みが消える）: ${t}`);
  }
  const order = ["./js/books.js", "./js/search.js", "./js/storage.js", "./js/tabs.js", "./js/main.js"].map((s) => srcs.indexOf(s));
  assert.ok(order.every((i) => i >= 0), `読み込む script が足りない: ${srcs.join(", ")}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "script の順番が books → search → storage → tabs → main でない");
  assert.equal(srcs[srcs.length - 1], "./js/main.js", "main.js が最後の script でない");
});

test("H17: 最初の表示に使う data/*.json は、loadData の最初の await が終わる前に全部取り始める", () => {
  const body = loadDataBody();
  const urls = [...body.matchAll(/["'`](\.\/data\/[^"'`]+\.json)["'`]/g)].map((m) => ({ url: m[1], at: m.index }));
  assert.ok(urls.length >= 3, "loadData に data/*.json が3本そろっていない");
  const aw = body.search(/\bawait\b/);
  assert.ok(aw > 0, "loadData に await がない");
  // 最初の await が Promise.all(...) なら、その閉じかっこまでを「同時に取り始めた範囲」とみなす
  let limit = aw;
  const pa = body.slice(aw).match(/^await\s+Promise\.all\s*\(/);
  if (pa) limit = matchParen(body, aw + pa[0].length - 1);
  const late = urls.filter((u) => u.at > limit).map((u) => u.url);
  assert.deepEqual(late, [], `ほかの JSON を待ってから取りに行っている（往復1回分カードが遅れる）: ${late.join(", ")}`);
});

test("H18: なくても一覧を出せる books.json は Promise.all に入れず、取り始めるところで失敗を受け止める", () => {
  const body = loadDataBody();
  const i = body.indexOf('"./data/books.json"');
  assert.ok(i >= 0, "loadData で books.json を取っていない");
  const aw = body.search(/await\s+Promise\.all\s*\(/);
  assert.ok(aw > 0, "loadData に await Promise.all がない");
  const open = body.indexOf("(", aw);
  const close = matchParen(body, open);
  assert.ok(i < open || i > close, "books.json が Promise.all の中にある（books.json の失敗で一覧まで出なくなる）");
  assert.match(body.slice(i, body.indexOf(";", i)), /\.catch\(/, "books.json の失敗を、取り始める文の中で受け止めていない");
});

test("H19: tools.json は gzip で 80KB 以下（超えたら読み込み方か上限を見直す知らせ。ツールの数の上限ではない）", () => {
  const raw = fs.readFileSync(path.join(ROOT, "data/tools.json"));
  const gz = zlib.gzipSync(raw, { level: 6 }).length;
  assert.ok(
    gz <= 80 * 1024,
    `tools.json が gzip で ${gz} バイト（上限 ${80 * 1024}）。ハブの CLAUDE.md の Loading data を見て、読み込み方か上限を見直す`
  );
});

test("H20: 最初に一覧を描いた時刻は performance.mark で1回だけ残し、外へは送らない", () => {
  assert.equal((mainJs.match(/performance\.mark\(/g) || []).length, 1, "performance.mark は1か所だけ");
  assert.match(mainJs, /performance\.mark\("hlo:cards-painted"\)/);
  const load = loadDataBody();
  const iMark = load.indexOf("markCardsPainted()");
  assert.ok(iMark > load.indexOf("renderAll()"), "一覧を描いたあとに印を付けていない");
  // 読み込みをやり直しても付け直さない
  assert.match(mainJs, /function markCardsPainted\(\)\s*\{\s*if \(cardsPaintedMarked\) return;/);
  // 測った値を読み出して送る処理がない。CSP の connect-src も 'self' だけ
  assert.doesNotMatch(mainJs, /sendBeacon|XMLHttpRequest|getEntries(?:ByName|ByType)?\(/);
  const csp = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]+)"/)[1];
  assert.match(csp, /connect-src 'self'(;|$)/);
});

// ---- 検索と絞り込み・一覧の表示 ----

test("H21: 検索欄は日本語の変換中（isComposing の input）に絞らず、変換を確定したとき（compositionend）に欄の値で絞る", () => {
  const s = fnBody("setupStaticUI");
  const handler = (type) => {
    const i = s.indexOf(`searchInput?.addEventListener("${type}"`);
    assert.ok(i >= 0, `検索欄の ${type} の処理がない`);
    return s.slice(i, s.indexOf("\n  });", i));
  };
  // 変換中の input では絞らない（未確定のかなで0件になったり、1文字ごとに一覧を作り直したりしない）
  assert.match(handler("input"), /if \(e\.isComposing\) return;[\s\S]*applySearch\(/, "変換中の input でも絞っている");
  // Chromium は確定の input も isComposing=true で出すので、compositionend で絞る処理が要る
  assert.match(handler("compositionend"), /applySearch\(searchInput\.value\)/, "確定したときに絞っていない");
  // 「変換中」の印を自分で持たない（compositionend を取りこぼすと、検索が止まったままになる）
  assert.doesNotMatch(s, /compositionstart/, "compositionstart で変換中の印を持っている");
  // Firefox は compositionend のあとにも input を出すので、同じ語なら描き直さない
  assert.match(fnBody("applySearch"), /if \(filters\.search === before\) return;/, "同じ語でも描き直している");
});

test("H22: 戻るボタンなどでブラウザーが検索欄の文字だけを戻したときも、一覧をその語で絞る（loadData が描く前に欄の値を読む）", () => {
  const load = loadDataBody();
  const iRead = load.indexOf('getElementById("filter-search-input")');
  assert.ok(iRead >= 0, "loadData で検索欄を読んでいない（欄の文字と一覧が食い違う）");
  const iSet = load.indexOf("setSearchQuery(", iRead);
  assert.ok(iSet > iRead, "検索欄の値を検索語にしていない");
  assert.ok(iSet < load.indexOf("renderAll()"), "一覧を描いたあとで検索欄を読んでいる");
});

// WCAG のコントラスト比（色は #rrggbb）
function contrastRatio(a, b) {
  const lum = (hex) => {
    const [r, g, bl] = [1, 3, 5]
      .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test("H23: 検索欄の案内文は検索欄の地に 4.5:1 以上、入力欄・選択欄の枠線は絞り込みの枠の地と検索欄の地に 3:1 以上", () => {
  const color = (body, prop) => (body.match(new RegExp(`(?:^|[;\\s])${prop}:\\s*(#[0-9a-f]{6})\\b`, "i")) || [])[1];
  const fieldBg = color(bodyOf('.filter-search input[type="search"]'), "background-color");
  const boxBg = color(bodyOf("#tool-filters"), "background-color");
  assert.ok(fieldBg && boxBg, "検索欄か絞り込みの枠の地の色がない");
  const ph = bodyOf('.filter-search input[type="search"]::placeholder');
  const phColor = color(ph, "color");
  assert.ok(phColor, "案内文の色の指定がない（ブラウザーの既定の色は薄い）");
  assert.match(ph, /opacity:\s*1\s*(?:;|$)/, "古い Firefox の opacity による半透明を打ち消していない");
  const r = contrastRatio(phColor, fieldBg);
  assert.ok(r >= 4.5, `案内文 ${phColor} と検索欄の地 ${fieldBg} の比が ${r.toFixed(2)}:1`);
  for (const sel of ["#tool-filters select", '#tool-filters input[type="search"]']) {
    const border = (bodyOf(sel).match(/border:\s*1px solid (#[0-9a-f]{6})\b/i) || [])[1];
    assert.ok(border, `${sel} の枠線の色がない`);
    for (const bg of [boxBg, fieldBg]) {
      const rb = contrastRatio(border, bg);
      assert.ok(rb >= 3, `${sel} の枠線 ${border} と地 ${bg} の比が ${rb.toFixed(2)}:1`);
    }
  }
});

test("H24: PC幅の一覧は auto-fill で列を作り（結果が1件でもカードを横幅いっぱいに伸ばさない）、0件の文は横幅いっぱいに出す", () => {
  const cols = rules
    .filter((r) => r.selector === "#tool-list")
    .map((r) => (r.body.match(/grid-template-columns:\s*([^;]+)/) || [])[1])
    .filter(Boolean);
  assert.ok(cols.some((c) => /^repeat\(auto-fill,/.test(c.trim())), `#tool-list の列が auto-fill でない: ${cols.join(" / ")}`);
  assert.ok(!cols.some((c) => /auto-fit/.test(c)), "auto-fit は空いた列を畳み、1件のカードが横幅いっぱいに伸びる");
  // 0件の文（#tool-list の中の p）は、狭い列に入って折れないよう、すべての列にまたがる
  assert.match(bodyOf("#tool-list > p"), /grid-column:\s*1\s*\/\s*-1/);
  assert.match(fnBody("appendEmptyState"), /document\.createElement\("p"\)/, "0件の文が p でない（CSS の #tool-list > p が当たらない）");
});

// ---- 進捗の記録 ----

test("H25: 別のタブで進捗が変わったら（storage イベント）、進捗ボタンとダッシュボードを描き直す。続けて届く知らせは1回にまとめ、一覧は作り直さない", () => {
  const setup = fnBody("setupProgressSync");
  const i = setup.indexOf('addEventListener("storage"');
  assert.ok(i >= 0, "storage イベントを受けていない（別のタブの変更を知らないまま押すと、1段飛んだり、別のタブの記録を消したりする）");
  const handler = setup.slice(i, setup.indexOf("\n  });", i));
  // 進捗のキー（progress_…）と、まとめて消されたとき（key が null）だけを見る
  assert.match(handler, /e\.key !== null && String\(e\.key\)\.indexOf\("progress_"\) !== 0\) return;/);
  // 全体のリセットで本数分届く知らせは、止まってから1回だけ描き直す（前の予約を取り消してから予約し直す）
  assert.match(handler, /clearTimeout\(progressSyncTimer\);\s*progressSyncTimer = setTimeout\(refreshProgressViews,/);
  assert.match(fnBody("setupStaticUI") + fnBody("setupHelpModal") + mainJs.match(/document\.addEventListener\("DOMContentLoaded"[\s\S]*?\n\}\);/)[0], /setupProgressSync\(\)/);
  const refresh = fnBody("refreshProgressViews");
  assert.match(refresh, /querySelectorAll\("\.tool-progress-button"\)[\s\S]*updateProgressButton\(/, "進捗ボタンを描き直していない");
  assert.match(refresh, /renderDashboard\(\)/, "ダッシュボードを描き直していない");
  assert.doesNotMatch(refresh, /renderToolList\(|renderAll\(/, "一覧を作り直している（焦点とスクロールの位置が動く）");
});
