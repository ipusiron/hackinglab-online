// test/site.test.js
// 依存なし（node:test / node:assert/strict / node:fs のみ）。
// U1〜U2 は js/storage.js・js/tabs.js の純関数、H1〜H8 は index.html / js/main.js の静的な検査。

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const { createSafeStorage } = require("../js/storage.js");
const { nextTabIndex } = require("../js/tabs.js");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");

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
