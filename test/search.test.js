// test/search.test.js
// 依存なし（node:test / node:assert/strict / node:fs のみ）。
// js/search.js のキーワード検索の純関数の検査。
// Q1〜Q7 は小さな合成データで関数の動きを、QD1〜QD5 は実データ（data/tools.json・data/categories.json）で
// 「同じ意味の入力は同じ結果になる」ことを確かめる。実データの検査は、ツールの本数や件数の固定値に頼らず、
// 探す語も実データ（タグ・カテゴリー名）から選ぶ。tools.json を作り直してツールや語が入れ替わっても、それだけでは落ちない。

const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { test } = require("node:test");

const S = require("../js/search.js");

const ROOT = path.join(__dirname, "..");
const tools = JSON.parse(fs.readFileSync(path.join(ROOT, "data/tools.json"), "utf8")).tools.filter(
  (t) => t.hub !== false
);
const categories = JSON.parse(fs.readFileSync(path.join(ROOT, "data/categories.json"), "utf8"));
const catIndex = S.categoryIndex(categories);
const entries = new Map(tools.map((t) => [t.id, S.buildEntry(t, catIndex)]));

// 検索欄にそのまま打った文字列で絞ったときに出るツールの id（一覧と同じ並び）
function find(raw) {
  const terms = S.parseQuery(raw);
  return tools.filter((t) => S.matches(entries.get(t.id), terms)).map((t) => t.id);
}

// ---- Q: 合成データ ----

test("Q1: normalize は全角と半角（英数字・空白・カタカナ）と大文字・小文字をそろえる", () => {
  assert.equal(S.normalize("ＡＢＣ１２３"), "abc123");
  assert.equal(S.normalize("QR Code"), "qr code");
  assert.equal(S.normalize("ｼｰｻﾞｰ"), "シーザー");
  assert.equal(S.normalize("暗号　解読"), "暗号 解読");
  assert.equal(S.normalize(null), "");
  assert.equal(S.normalize(undefined), "");
});

test("Q2: parseQuery は前後の空白を除き、半角・全角の空白で語に分ける（空の欄は語なし）", () => {
  assert.deepEqual(S.parseQuery("  ＡＥＳ　"), ["aes"]);
  assert.deepEqual(S.parseQuery("暗号　解読"), ["暗号", "解読"]);
  assert.deepEqual(S.parseQuery(" caesar   Brute "), ["caesar", "brute"]);
  assert.deepEqual(S.parseQuery("   "), []);
  assert.deepEqual(S.parseQuery("　"), []);
  assert.deepEqual(S.parseQuery(""), []);
});

test("Q3: parseQuery は Day 番号を3桁にそろえ、Day と数字のあいだの空白を詰める", () => {
  for (const [raw, want] of [
    ["Day12", ["day012"]],
    ["day12", ["day012"]],
    ["Day 12", ["day012"]],
    ["Day1", ["day001"]],
    ["Day50", ["day050"]],
    ["Day050", ["day050"]],
    ["DAY0050", ["day050"]],
    ["ｄａｙ５０", ["day050"]],
    ["Ｄａｙ　５０", ["day050"]],
    ["Day120", ["day120"]],
    ["Day12 aes", ["day012", "aes"]]
  ]) {
    assert.deepEqual(S.parseQuery(raw), want, JSON.stringify(raw));
  }
  // Day 番号でない語は変えない。数字が0だけの語（「Day050」を打つ途中の「Day0」）も Day 番号として扱わない
  assert.deepEqual(S.parseQuery("today 50"), ["today", "50"]);
  assert.deepEqual(S.parseQuery("day"), ["day"]);
  assert.deepEqual(S.parseQuery("012"), ["012"]);
  assert.deepEqual(S.parseQuery("Day0"), ["day0"]);
  assert.deepEqual(S.parseQuery("Day00"), ["day00"]);
  assert.equal(S.dayTerm("day12x"), null);
  assert.equal(S.dayTerm("day000"), null);
});

test("Q4: buildEntry は id・題名・副題・説明・タグと、categories.json の日英のカテゴリー名と別名を含み、README にだけある名前は含まない", () => {
  const idx = S.categoryIndex([
    { id: "lock", ja: "鍵開け", en: "Lockpicking", aliases_ja: ["ロックピッキング"], aliases_en: ["Lock Picking"] }
  ]);
  const e = S.buildEntry(
    {
      id: "day050",
      title: "Pin Tumbler Ｓｉｍ",
      subtitle_ja: "副題",
      subtitle_en: "Subtitle",
      description_ja: "説明",
      description_en: "Description",
      tags: ["Tag1"],
      category_ids: ["lock", "unknown-id"],
      category_ja: ["鍵開け", "錠前"],
      category_en: ["Lockpicking", "Locks"]
    },
    idx
  );
  assert.equal(e.id, "day050");
  for (const w of ["day050", "pin tumbler sim", "副題", "subtitle", "説明", "description", "tag1", "鍵開け", "lockpicking", "ロックピッキング", "lock picking"]) {
    assert.ok(e.text.includes(w), `${w} がない`);
  }
  for (const w of ["錠前", "locks"]) {
    assert.ok(!e.text.includes(w), `${w} が入っている（README にだけあってカードに出ない名前で当たる）`);
  }
  // 別名が配列でないときは無視する
  const e2 = S.buildEntry({ id: "day051", category_ids: ["odd"] }, S.categoryIndex([{ id: "odd", ja: "名前", en: "Name", aliases_ja: "別名" }]));
  assert.ok(!e2.text.includes("別名"));
  // 欠けた項目があっても例外を出さない
  assert.deepEqual(S.buildEntry({ id: "day001" }, idx), { id: "day001", text: "day001" });
  assert.deepEqual(S.buildEntry(null, idx), { id: "", text: "" });
});

test("Q5: matches は語をすべて含むときだけ true（語がなければ true）。2つの項目をまたいでは当たらない", () => {
  const e = S.buildEntry({ id: "day008", title: "Caesar", subtitle_ja: "暗号", subtitle_en: "brute force" }, {});
  assert.equal(S.matches(e, S.parseQuery("caesar brute")), true);
  assert.equal(S.matches(e, S.parseQuery("caesar vigenere")), false);
  assert.equal(S.matches(e, []), true);
  assert.equal(S.matches(e, S.parseQuery("   ")), true);
  assert.equal(S.matches(null, ["caesar"]), false);
  // 「暗号」は副題、「brute」は英語の副題。つないだ「暗号brute」では当たらない
  assert.equal(S.matches(e, S.parseQuery("暗号brute")), false);
  assert.equal(S.matches(e, S.parseQuery("暗号 brute")), true);
});

test("Q6: Day 番号の語は、その番号のツールにだけ当たる（前方一致や説明の中の番号では当たらない）", () => {
  const list = [
    { id: "day012", title: "A" },
    { id: "day120", title: "B" },
    { id: "day121", title: "C", description_ja: "Day012 の結果を使う" },
    { id: "day001", title: "D" }
  ].map((t) => S.buildEntry(t, {}));
  const hit = (raw) => list.filter((e) => S.matches(e, S.parseQuery(raw))).map((e) => e.id);
  assert.deepEqual(hit("Day12"), ["day012"]);
  assert.deepEqual(hit("day 12"), ["day012"]);
  assert.deepEqual(hit("Day012"), ["day012"]);
  assert.deepEqual(hit("Day1"), ["day001"]);
  assert.deepEqual(hit("Day120"), ["day120"]);
  // 数字だけの語は、これまでどおり部分一致（id の「day012」にも当たる）
  assert.deepEqual(hit("012"), ["day012", "day121"]);
  // 「Day050」を打つ途中の「Day0」は部分一致なので、打っているあいだに一覧が0件にならない
  assert.deepEqual(hit("Day0"), ["day012", "day121", "day001"]);
});

test("Q7: 決まった小さなデータで、全角・小文字の「ＱＲ」「ｑｒ」と、2語の「暗号 解読」「caesar brute」が期待どおりのツールを出す", () => {
  const list = [
    { id: "day001", title: "QR Code Lab", tags: ["qr"] },
    { id: "day002", title: "Caesar Cipher", subtitle_ja: "暗号の解読", tags: ["brute-force"] },
    { id: "day003", title: "Vigenere", subtitle_ja: "暗号化だけ" },
    { id: "day004", title: "Brute Timer", subtitle_ja: "解読の時間" }
  ].map((t) => S.buildEntry(t, {}));
  const hit = (raw) => list.filter((e) => S.matches(e, S.parseQuery(raw))).map((e) => e.id);
  assert.deepEqual(hit("QR"), ["day001"]);
  assert.deepEqual(hit("ＱＲ"), ["day001"]);
  assert.deepEqual(hit("ｑｒ"), ["day001"]);
  assert.deepEqual(hit("暗号 解読"), ["day002"]);
  assert.deepEqual(hit("暗号　解読"), ["day002"]);
  assert.deepEqual(hit("caesar brute"), ["day002"]);
  assert.deepEqual(hit("ＣＡＥＳＡＲ　ｂｒｕｔｅ"), ["day002"]);
});

// ---- QD: 実データ ----

const toFull = (s) => s.replace(/[0-9A-Za-z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0));

// 実データのタグのうち、英字で始まり空白を含まないもの（探す語に使う。そのタグを持つツールは必ず出る）
const asciiTags = [...new Set(tools.flatMap((t) => (t.tags || []).filter((g) => /^[A-Za-z][A-Za-z0-9]+$/.test(g))))].slice(0, 40);

test("QD1: どのツールも、Day 番号をゼロ埋めの有無・大文字小文字・空白・全角に関係なく打てば、そのツールだけが出る", () => {
  let checked = 0;
  for (const t of tools) {
    const m = /^day(\d{3})$/.exec(t.id);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    for (const raw of [`Day${n}`, `day ${n}`, `DAY${m[1]}`, ` Day${m[1]} `, toFull(`Day${n}`)]) {
      assert.deepEqual(find(raw), [t.id], JSON.stringify(raw));
    }
    checked++;
  }
  assert.ok(checked > 0, "id が dayNNN のツールが1本もない");
});

test("QD2: 全角と半角、大文字と小文字を区別しない（実データのタグで確かめる）", () => {
  assert.ok(asciiTags.length > 0, "英字のタグを持つツールがない");
  for (const tag of asciiTags) {
    const base = find(tag);
    const owners = tools.filter((t) => (t.tags || []).includes(tag)).map((t) => t.id);
    for (const id of owners) assert.ok(base.includes(id), `タグ ${tag} で、そのタグを持つ ${id} が出ない`);
    assert.deepEqual(find(toFull(tag)), base, `全角の ${toFull(tag)}`);
    assert.deepEqual(find(tag.toUpperCase()), base, tag.toUpperCase());
    assert.deepEqual(find(toFull(tag.toUpperCase())), base, `全角の大文字の ${tag}`);
  }
});

test("QD3: 前後の空白（半角・全角）は結果を変えない", () => {
  for (const q of ["aes", "暗号", "パスワード", "Day050"]) {
    for (const raw of [`${q} `, ` ${q}`, `${q}　`, `　${q}　`]) {
      assert.deepEqual(find(raw), find(q), JSON.stringify(raw));
    }
  }
});

test("QD4: 空白で区切った語は、すべての語を含むツールを出す（それぞれの語の結果の重なりと同じ。語は同じツールの2つのタグ）", () => {
  const pairs = [];
  for (const t of tools) {
    const tags = (t.tags || []).filter((g) => /^\S+$/.test(g));
    if (tags.length >= 2) pairs.push([tags[0], tags[1], t.id]);
    if (pairs.length >= 30) break;
  }
  assert.ok(pairs.length > 0, "タグを2つ以上持つツールがない");
  for (const [a, b, id] of pairs) {
    const both = find(`${a} ${b}`);
    const inB = new Set(find(b));
    assert.deepEqual(both, find(a).filter((x) => inB.has(x)), `${a} ${b}`);
    assert.ok(both.includes(id), `${a} ${b} で、2つのタグを持つ ${id} が出ない`);
    assert.deepEqual(find(`${a}　${b}`), both, "全角の空白");
  }
});

test("QD5: カテゴリー名（日英）と別名で探すと、そのカテゴリーのツールがすべて出る", () => {
  let checked = 0;
  for (const c of categories) {
    const members = tools.filter((t) => (t.category_ids || []).includes(c.id)).map((t) => t.id);
    if (!members.length) continue;
    for (const name of [c.ja, c.en, ...(c.aliases_ja || []), ...(c.aliases_en || [])]) {
      const got = new Set(find(name));
      for (const id of members) assert.ok(got.has(id), `「${name}」で ${id} が出ない`);
    }
    checked++;
  }
  assert.ok(checked > 0, "ツールのあるカテゴリーが1つもない");
});
