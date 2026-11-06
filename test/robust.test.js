// test/robust.test.js
// 依存なし（node:test / node:assert/strict / node:fs のみ）。
// RB1〜 は、遅い回線や遅い端末で開いたときに、読み込みの途中で画面がずれたり固まったりしないための直し方が、
// あとの変更で外れていないかを見る静的な検査（index.html / js/main.js / css/style.css）。

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const ROOT = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const mainJs = fs.readFileSync(path.join(ROOT, "js/main.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "css/style.css"), "utf8");
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");

function openTag(idValue) {
  const m = html.match(new RegExp(`<[a-z0-9]+[^>]*\\sid="${idValue}"[^>]*>`, "s"));
  assert.ok(m, `id="${idValue}" の要素がない`);
  return m[0];
}

// main.js の関数の本体（宣言から、行頭の "}" まで）
function fnBody(name) {
  const m = mainJs.match(new RegExp(String.raw`(?:async\s+)?function ${name}\([^)]*\)\s*\{[\s\S]*?\n\}`));
  assert.ok(m, `${name} がない`);
  return m[0];
}

test("RB1: 書籍・シリーズの欄は最初から場所を取り、一覧は読み込みが終わるまで1画面分の高さを取る", () => {
  assert.doesNotMatch(
    openTag("filter-book-group"),
    /\shidden[\s>]/,
    "書籍の欄が hidden で始まる（データが届いたときに、下の欄とフッターが押し下げられる）"
  );
  assert.match(openTag("tool-list"), /\saria-busy="true"/);
  assert.match(cssNoComments, /#tool-list\[aria-busy="true"\]\s*\{[^}]*min-height:\s*100vh/);
  // 描く前に印を外す。読み込みに失敗したときも外す（空の一覧の高さを1画面分取ったままにしない）
  assert.match(fnBody("setListBusy"), /setAttribute\("aria-busy"/);
  const load = fnBody("loadData");
  const iFree = load.indexOf("setListBusy(false)");
  assert.ok(iFree >= 0 && iFree < load.indexOf("renderAll()"), "一覧を描く前に読み込み中の印を外していない");
  assert.match(fnBody("releaseReservedSpace"), /setListBusy\(false\)/);
  assert.match(load, /catch \(err\) \{[\s\S]*?releaseReservedSpace\(\)/, "読み込みに失敗したときに取っておいた場所を返していない");
  // 再読み込み・戻るでブラウザーにスクロール位置を戻させない（読み込み中の高さの所で止まるため）
  assert.match(fnBody("setupStaticUI"), /history\.scrollRestoration = "manual"/);
});

test("RB2: 狭い画面の「はじめ方」は描く前に CSS で畳み、CSS と main.js は同じ式で幅を見る", () => {
  const m = mainJs.match(/const NARROW_MQ = "([^"]+)"/);
  assert.ok(m, "NARROW_MQ がない");
  assert.ok(
    css.includes(`@media (scripting: enabled) and ${m[1]}`),
    "CSS の @media が NARROW_MQ と同じ式でない（境目の幅で一瞬開いて見えたり、畳んだまま開かなくなったりする）"
  );
  assert.match(cssNoComments, /html:not\(\.js-ready\) #start-here > \.start-here-body\s*\{[^}]*max-height:\s*0/);
  // main.js は同じ式で畳み、html に js-ready を付ける
  const s = fnBody("setupStaticUI");
  assert.match(s, /matchMedia\(NARROW_MQ\)/);
  assert.match(s, /classList\.add\("js-ready"\)/);
  assert.doesNotMatch(s, /innerWidth\s*<\s*768/, "幅の判定が CSS と別の式になっている");
});

test("RB3: データの更新日時は、一覧と同じ時に入れる（書籍データを待つ前に入れない）", () => {
  const load = fnBody("loadData");
  const iUpdated = load.indexOf('"last-updated-value"');
  assert.ok(iUpdated >= 0, "更新日時を入れる所がない");
  assert.ok(
    iUpdated > load.lastIndexOf("await "),
    "更新日時を入れたあとに await がある（待つあいだにフッターだけが先に描き変わる）"
  );
});

test("RB4: ?book= で来たときは、データが届く前に本のバナーの場所を取り、描くときに外す", () => {
  assert.match(cssNoComments, /#book-banner\.is-pending\s*\{[^}]*min-height:\s*\d+px/);
  assert.match(fnBody("reserveBookBanner"), /classList\.add\("is-pending"\)/);
  assert.match(fnBody("setupStaticUI"), /reserveBookBanner\(\)/);
  assert.match(fnBody("renderBookBanner"), /classList\.remove\("is-pending"\)/);
  // 読み込みに失敗したときは、取っておいたバナーの場所を返す
  assert.match(fnBody("releaseReservedSpace"), /classList\.remove\("is-pending"\)/);
});

test("RB5: 画面の外のカードは描くのを後回しにする。章ごとに並べるとき（.is-grouped）は使わない", () => {
  const rulesWithAuto = [...cssNoComments.matchAll(/([^{}]*)\{([^{}]*content-visibility:\s*auto[^{}]*)\}/g)];
  assert.equal(rulesWithAuto.length, 1, "content-visibility: auto は1か所だけに書く");
  assert.equal(
    rulesWithAuto[0][1].trim(),
    "#tool-list:not(.is-grouped) > .tool-card",
    "章ごとの表示を外していない（仮の高さのまま「章へ移動」の位置を計算し、見出しが固定ヘッダーの下に隠れる）"
  );
  assert.match(rulesWithAuto[0][2], /contain-intrinsic-size:\s*auto\s+\d+px/);
  assert.match(fnBody("renderToolList"), /classList\.toggle\("is-grouped",\s*!!displayGroups\)/);
  // 言語を切り替えて読んでいた位置へ戻すときは、読んでいたカードとその上のカードを、一度描くまで後回しにしない
  assert.match(cssNoComments, /\.tool-card\.cv-hold\s*\{[^}]*content-visibility:\s*visible/);
  const restore = fnBody("restoreReadingAnchor");
  assert.match(restore, /classList\.add\("cv-hold"\)/);
  assert.match(restore, /classList\.remove\("cv-hold"\)/);
  assert.ok(
    restore.indexOf('classList.add("cv-hold")') < restore.indexOf("scrollByInstant("),
    "cv-hold を付ける前に位置を合わせている（仮の高さで合わせることになる）"
  );
});

test("RB6: 出すものが前回と同じなら一覧を作り直さない。判定には言語・本・進捗の変化を含める", () => {
  const r = fnBody("renderToolList");
  const key = r.match(/const listKey = \[([\s\S]*?)\]\.join/);
  assert.ok(key, "前回の表示と比べる鍵がない");
  for (const part of ["currentLang", "filters.book", "progressVersion"]) {
    assert.ok(key[1].includes(part), `鍵に ${part} がない（切り替えたあとに古い文字や進捗の表示が残る）`);
  }
  assert.ok(
    r.indexOf("lastListKey") < r.indexOf('listEl.innerHTML = ""'),
    "前回と比べる前に一覧を消している（同じ結果でも作り直す）"
  );
  assert.match(fnBody("setProgress"), /progressVersion\+\+/);
});
