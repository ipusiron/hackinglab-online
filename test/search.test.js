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

test("tool aliases find Japanese names without expanding to category peers", () => {
  for (const [query, id] of [["不可視文字", "day023"], ["ゼロ幅文字 Unicode", "day023"], ["同形異字", "day023"], ["画像認証 CAPTCHA", "day075"], ["カプチャ", "day075"], ["ﾌｨﾝｶﾞｰﾌﾟﾘﾝﾄ", "day077"], ["ブラウザ指紋", "day077"]]) {
    assert.ok(find(query).includes(id), query);
  }
  assert.deepEqual(find("不可視文字 Day23"), ["day023"]);
  assert.deepEqual(find("不可視文字 Day75"), []);
  const source=tools.find(t=>t.id==="day023");
  const peer=S.buildEntry({...source,id:"day999",title:"Peer",subtitle_ja:"",description_ja:"",tags:[]},catIndex);
  assert.equal(S.matches(peer,S.parseQuery("不可視文字")),false);
  assert.equal(S.buildEntry({id:"constructor"},catIndex).text,"constructor");
});

test("everyday password wording finds the strength checker, not token estimates or keyboard observations", () => {
  for (const query of ["パスワード 強さ", "パスワードの強さ"]) {
    assert.deepEqual(find(query), ["day001"], query);
  }
  assert.deepEqual(find("パスワード 強さ Day48"), []);
  assert.deepEqual(find("パスワード 強さ Day89"), []);
});

test("mismatching-text wording finds the Unicode inspector without broadening to other web tools", () => {
  for (const query of ["文字が一致しない", "文字列が一致しない", "文字 一致しない"]) {
    assert.deepEqual(find(query), ["day023"], query);
  }
  assert.deepEqual(find("文字が一致しない Day75"), []);
});

test("text-comparison purpose queries reach the Unicode inspector in both languages", () => {
  // The public experiment opens the tool's A/B comparison and checks an exact
  // mismatch. Test that purpose and natural variants, not the alias strings.
  for (const query of [
    "compare two strings", "compare strings", "string comparison", "text comparison",
    "文字列比較", "文字列 比較", "文字列を比較", "文字の比較", "Unicode 比較"
  ]) {
    assert.ok(find(query).includes("day023"), query);
  }
  assert.deepEqual(find("ＣＯＭＰＡＲＥ　two strings Ｄａｙ　２３"), ["day023"]);
});

test("text-comparison vocabulary does not imply image, audio, PDF or password comparison", () => {
  for (const query of [
    "image comparison", "compare images", "audio comparison", "PDF comparison",
    "password comparison", "画像 比較", "音声 比較", "パスワード 比較"
  ]) {
    assert.ok(!find(query).includes("day023"), query);
  }
});

test("comparison queries keep ordinary AND, category, title and exact Day matching", () => {
  assert.deepEqual(find("WeirdString comparison"), ["day023"]);
  assert.ok(find("Web Security text comparison").includes("day023"));
  assert.deepEqual(find("文字列 比較 フォレンジック Day23"), ["day023"]);
  assert.deepEqual(find("文字列を比較 Day23"), ["day023"]);
  assert.deepEqual(find("文字列を比較 Day75"), []);
  assert.deepEqual(find("文字列を比較 未登録の検索語"), []);
  assert.deepEqual(find("compare two strings Day23 absent-term-xyz"), []);
  assert.deepEqual(find("compare two strings Day75"), []);
  // HashViz contains these words in its valid description. Adding a suitable
  // result must not remove that existing AND match to fit this purpose query.
  assert.deepEqual(find("compare two strings Day56"), ["day056"]);
});

test("purpose phrases activate only as a complete query and do not suppress ordinary catalog words", () => {
  const inspector = S.buildEntry({ id: "day023", description_en: "Unicode text strings" }, catIndex);
  for (const query of ["comparison", "compare", "two", "image comparison", "text comparison absent-term-xyz"]) {
    assert.equal(S.matches(inspector, S.parseQuery(query)), false, query);
  }
  for (const query of ["comparison text", "comparison text text", "compare strings Day23"]) {
    assert.equal(S.matches(inspector, S.parseQuery(query)), true, query);
  }
  assert.equal(S.matches(inspector, S.parseQuery("compare strings Day56")), false);
  // A real title/description/tag/category match is still valid, even if a
  // purpose phrase would not activate for the same query.
  const ordinary = S.buildEntry({ id: "day023", description_en: "image comparison" }, catIndex);
  assert.equal(S.matches(ordinary, S.parseQuery("image comparison")), true);
  const peer = S.buildEntry({ id: "day999", description_en: "Unicode text strings" }, catIndex);
  assert.equal(S.matches(peer, S.parseQuery("text comparison")), false);
  // Entry objects without optional phrases keep the existing matching API.
  assert.equal(S.matches({ id: "day999", text: "text comparison" }, S.parseQuery("text comparison")), true);
});

test("everyday purpose vocabulary finds only the tools with the described function in Japanese and English", () => {
  const cases = [
    ["day007", ["写真 位置情報 削除", "photo location remove", "geotag metadata removal"]],
    ["day033", ["コピー 文字 書き換え", "コピペ 貼り付け", "copy clipboard", "clipboard hijacking"]],
    ["day039", ["URL 追跡 除去", "追跡情報 削除", "URL tracking removal"]],
    ["day040", ["拡張子 中身 確認", "ファイル形式 確認", "file type extension check"]],
    ["day087", ["鍵 貸し借り", "鍵 返却", "key lending", "key borrowing"]]
  ];
  for (const [id, queries] of cases) {
    for (const query of queries) assert.deepEqual(find(query), [id], query);
  }
  assert.deepEqual(find("写真 位置情報 削除 Day13"), []);
  assert.deepEqual(find("COPY　CLIPBOARD　Ｄａｙ　３３"), ["day033"]);
  // Extra terms still narrow by AND; the aliases do not select a tool by themselves.
  assert.deepEqual(find("鍵 貸し借り 未登録の検索語"), []);
  assert.equal(S.matches(S.buildEntry({ id: "day999" }, catIndex), S.parseQuery("geotag")), false);
});

test("reviewed supplemental wording routes extension mismatches and password evaluation without promising safety or breach checks", () => {
  // These phrases were disclosed after the first holdout run; this is a
  // regression for the supplement, not evidence of unseen-query performance.
  for (const query of ["ファイル 拡張子 食い違い", "拡張子 食い違う"]) {
    assert.deepEqual(find(query), ["day040"], query);
  }
  assert.deepEqual(find("パスワードの安全性を評価"), ["day001"]);
  assert.deepEqual(find("パスワードの安全性を評価 Day89"), []);
  for (const query of ["パスワード 安全性 保証", "パスワードの安全性を保証", "パスワード 漏えい 検査"]) {
    assert.ok(!find(query).includes("day001"), query);
  }
});

test("known limitation sentences do not advertise CAPTCHA measurement or keyboard-based strength assessment in either language", () => {
  const captcha = tools.find((tool) => tool.id === "day075");
  const keyboard = tools.find((tool) => tool.id === "day089");
  // A regenerated description change needs a fresh review, rather than silently
  // retaining an exclusion written for a different capability statement.
  assert.ok(captcha.description_ja.includes("人やOCRの読み取り成功率は測定しません。"));
  assert.ok(captcha.description_en.includes("Does not measure human or OCR reading success."));
  assert.ok(keyboard.description_ja.includes("パスワードの強度や人物の特定には使えません。"));
  assert.ok(keyboard.description_en.includes("Not a password strength or identity assessment."));
  for (const query of ["CAPTCHA 読み取り成功率 測定", "CAPTCHA measure reading success"]) {
    assert.deepEqual(find(query), [], query);
  }
  for (const query of ["パスワード 強度", "password strength"]) {
    assert.ok(find(query).includes("day001"), query);
    assert.ok(!find(query).includes("day089"), query);
  }
  for (const query of ["CAPTCHA 画素", "CAPTCHA pixel statistics"]) assert.ok(find(query).includes("day075"), query);
  for (const query of ["キーボード 反復", "keyboard repetition"]) assert.ok(find(query).includes("day089"), query);
  // Valid shared-category words and token-strength wording remain searchable.
  assert.ok(find("トークン 強度").includes("day048"));
  assert.ok(find("token strength").includes("day048"));
});

test("description exclusions are exact, tool-specific and do not remove title, tag or category vocabulary", () => {
  const limitation = "Does not measure human or OCR reading success.";
  const query = S.parseQuery("measure reading success");
  const peer = S.buildEntry({ id: "day999", description_en: limitation }, catIndex);
  assert.equal(S.matches(peer, query), true);
  const changed = S.buildEntry({ id: "day075", description_en: "Measures human reading success." }, catIndex);
  assert.equal(S.matches(changed, query), true);
  const title = S.buildEntry({ id: "day075", title: limitation }, catIndex);
  assert.equal(S.matches(title, query), true);
  const unrelated = S.buildEntry({ id: "day075", description_en: "Does not decrypt passwords." }, catIndex);
  assert.equal(S.matches(unrelated, S.parseQuery("decrypt")), true);
  const tag = S.buildEntry({ id: "day089", tags: ["strength"] }, catIndex);
  assert.equal(S.matches(tag, S.parseQuery("strength")), true);
});

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
  assert.deepEqual(S.buildEntry({ id: "day999" }, idx), { id: "day999", text: "day999" });
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
