// test/scroll_focus.test.js
// 依存なし（node:test / node:assert/strict / node:fs のみ）。
// SF1〜SF6 は、固定ヘッダーの下で止まる位置・フォーカスの移し方・言語の切り替えの直し方が、
// あとの変更で外れていないかを見る静的な検査（index.html / js/main.js / css/style.css）。

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");

// CSS の規則（セレクター { 中身 }）を探す。コメントは外して比べる
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
function cssBlock(selectorRe) {
  const m = cssNoComments.match(new RegExp(selectorRe.source + String.raw`\s*\{([^}]*)\}`));
  return m ? m[1] : null;
}

test("SF1: scrollIntoView() のすぐ後の focus() は preventScroll 付き（章へ移動・章の位置つき URL）", () => {
  // 「scrollIntoView(...);」の次の文が「X.focus()」（引数なし）になっている所がない
  const bad = mainJs.match(/scrollIntoView\([^)]*\);\s*(?:\/\/[^\n]*\n\s*)*[\w.]+\.focus\(\s*\)/g) || [];
  assert.equal(bad.length, 0, `preventScroll のない focus(): ${bad.join(" / ")}`);
  // 章の位置つき URL で開いたときも見出しへフォーカスを移す（Firefox・Safari で次の Tab がページの先頭から始まらないように）
  const fn = mainJs.match(/function maybeScrollToHash\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "maybeScrollToHash がない");
  assert.match(fn[0], /\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

test("SF2: 固定ヘッダーの分を html の scroll-padding-top で空け、見出しの scroll-margin-top と二重にしない", () => {
  const h = cssBlock(/(?:^|\n)html/);
  assert.ok(h, "html の規則がない");
  assert.match(h, /scroll-padding-top:\s*calc\(var\(--header-h/);
  const g = cssBlock(/\.book-group-heading/);
  assert.ok(g, ".book-group-heading の規則がない");
  assert.doesNotMatch(g, /scroll-margin-top/, "scroll-padding-top と足し算になり、見出しがヘッダーの2倍下に止まる");
  // 止まる位置の余白は html の1か所だけにする（ほかの要素に scroll-margin-top を足さない）
  assert.doesNotMatch(cssNoComments, /scroll-margin-top/);
  // --header-h を書く処理が残っている
  assert.match(mainJs, /setProperty\(\s*"--header-h"/);
});

test("SF3: ヘルプを閉じて固定ヘッダーの ? へフォーカスを戻すとき、ページを動かさない", () => {
  assert.match(mainJs, /target\?\.focus\(\{\s*preventScroll:\s*true\s*\}\)/);
});

test("SF4: JA／EN は disabled にせず、aria-pressed で今の言語を示す（押してもフォーカスが外れない）", () => {
  for (const id of ["lang-ja", "lang-en"]) {
    const tag = html.match(new RegExp(`<button[^>]*\\sid="${id}"[^>]*>`));
    assert.ok(tag, `#${id} がない`);
    assert.match(tag[0], /aria-pressed="(true|false)"/);
  }
  assert.doesNotMatch(mainJs, /lang(Ja|En)Btn\.disabled\s*=/);
  assert.match(mainJs, /setAttribute\("aria-pressed"/);
  assert.doesNotMatch(cssNoComments, /\.header-controls button\[disabled\]/);
  assert.match(cssNoComments, /\.header-controls button\[aria-pressed="true"\]/);
  // 強制カラーでも今の言語がわかる
  assert.match(cssNoComments, /@media \(forced-colors: active\)[\s\S]*aria-pressed="true"/);
});

test("SF5: 言語を切り替えるとき、読んでいたカードを覚えて同じ高さに戻す（今の言語なら何もしない）", () => {
  const fn = mainJs.match(/const setLanguage = \(lang\) => \{[\s\S]*?\n {2}\};/);
  assert.ok(fn, "setLanguage がない");
  assert.match(fn[0], /captureReadingAnchor\(\)/);
  assert.match(fn[0], /restoreReadingAnchor\(/);
  assert.match(fn[0], /if \(lang === currentLang\) return/);
});

test("SF6: フォーカスが固定ヘッダーの中にあるあいだは scroll-padding-top を 0 にする（Tab で JA・EN・? へ移ってもページを動かさない）", () => {
  const b = cssBlock(/(?:^|\n)html:has\(#site-header :focus\)/);
  assert.ok(b, "html:has(#site-header :focus) の規則がない");
  assert.match(b, /scroll-padding-top:\s*0(?:px)?\s*(?:;|$)/);
  // scroll-padding-top を書くのは html の規則とこの規則の2か所だけ（ほかで足すと、どちらが勝つかが詳細度しだいになる）
  assert.equal((cssNoComments.match(/scroll-padding-top\s*:/g) || []).length, 2);
});
