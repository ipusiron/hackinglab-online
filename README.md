# ハッキング・ラボ・オンライン - Hacking Lab Online

当サイトは、**「生成AIで作るセキュリティツール」プロジェクト** で誕生した教育ツール群を一覧化し、独学を支援するためのポータルサイトです。

- [「生成AIで作るセキュリティツール100」プロジェクト](https://akademeia.info/?page_id=42163)
- [「生成AIで作るセキュリティツール200」プロジェクト](https://akademeia.info/?page_id=44607)

ブラウザーで直接お試しいただけます。

- GitHubPagesに直接アクセス
  - 👉 **[https://ipusiron.github.io/hackinglab-online/](https://ipusiron.github.io/hackinglab-online/)**
- ドメインによるアクセス
  - 👉 **[https://hackinglab.online](https://hackinglab.online)**

---

## 📖 基本機能

- 🔍 ツールをカテゴリ・進捗・キーワードで検索  
- 📖 書籍・シリーズで絞り込み（本のサポートページからの `?book=` リンクで自動的に絞り込み）  
- 🧭 絞り込みの条件（書籍・カテゴリ・キーワード）と開いたタブをURLに残す（`?book=`・`?cat=`・`?q=`・`?tab=`。進捗の条件は残さない）。書籍・カテゴリ・タブを選んだあとは、ブラウザーの戻るで1つ前の一覧に戻れる  
- 📚 学習状況をlocalStorageを使って記録  
- 📊 ダッシュボードで全体進捗＋カテゴリ別・書籍別進捗を可視化  
- 🔗 X（旧Twitter）で進捗をワンクリック共有  
- 🌐 多言語対応（日本語 / 英語。選んだ言語はこの端末に覚え、`?lang=en` を付けたURLは英語で開く。英語表示では、カードの「GitHub」は英語の README を、「デモ」は `?lang=en` を付けて開く）

なお、学習プラットフォームとしては最低限の機能しか備えていません。

ランク制やゲーミフィケーション的な機能を実装する予定は今のところありません。

> ランク制を導入してしまうとどうしても他人と比較してしまいがちになります。
> 中級者以降であればそれも刺激になるかもしれませんが、超初心者から初心者まではあまり他人と比較すべきではないと考えているからです。
>
> また、正直なところ現状プラットフォームの運営・改良に私自身が興味が持てないためです。
> そのような時間があれば、多分本を書きまくります。

---

## 🔄 自動更新フロー（GitHub Actions）

`repos.txt`にツールのGitHub URLを追加すると、各READMEのYAMLマターからカタログを再生成します。
毎週月曜日の6:17（日本時間）にも実行し、READMEの変更を取り込みます。GitHub Actionsの混雑などで開始が遅れる場合があります。

1. READMEをタイムアウト付きで取得する。`main`が404の場合だけ`master`を探す。
2. 登録済みツールの取得やYAML解析に失敗した場合は、前回の有効なデータを残して報告する。前回値のない新規ツールの失敗、IDやslugの重複、不正なURLなどは生成を中止する。
3. カテゴリを日本語、英語の記載順で対応付け、重複するIDを除く。
4. はじめて掲載するIDに日本時間の日付を付け、`data/added.json`と`tools.json`に記録する。以前の日付は書き換えず、非掲載になっても履歴を残す。
5. データと全カードの描画を検査する。内容が変わった場合だけ、生成日時を更新してコミットする。
6. 最新のmainを取り込んだあとに再検査し、成功した場合だけpushする。

HTTP 401を受けた場合は、代替ブランチや次のURLへ進まず中止し、生成ファイルも更新しません。
`repos.txt`からの削除や有効な`hub: false`は、意図的な非掲載として反映します。
未知のカテゴリと不正な難易度は実行結果に警告を出し、難易度は`null`にします。PRではカテゴリの名前や別名の変更による対応漏れも検査します。

GitHub ActionsのStep Summaryには、件数、前回値を保持したツール、slugの変更、未登録カテゴリ、難易度の警告、デモURLをGETで確認した結果を出します。
デモのHTTP応答は通信の確認であり、ツール内の動作を保証する検査ではありません。

現在のPages公開元はmainブランチです。`GITHUB_TOKEN`を使った自動コミットではPagesのビルドが始まらないため、週次処理が保証するのはリポジトリの更新までです。
サイトへの反映は、Pagesの公開ジョブと公開URLで別に確認します（[GitHubの公開元設定の説明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)）。

---

## 📂 リポジトリー構成

```text
/
├ index.html                # メインHTML（ヘッダー・タブ・モーダル）
├ css/
│   └ style.css             # 全体スタイル（モバイルファースト）
├ js/
│   ├ main.js               # フロントロジック（一覧・進捗管理・ダッシュボード）
│   ├ lang.js               # 表示の言語（?lang=・保存した言語・日本語の順）と「はじめ方」の開閉（?book= なら閉じる・覚えた開閉・画面の幅の順）を描く前に決める（head で defer なしに読む）
│   ├ books.js              # 書籍フィルターの純関数（DOM非依存・テスト対象）
│   ├ search.js             # キーワード検索の純関数（DOM非依存・テスト対象）
│   ├ storage.js            # localStorage の安全なラッパー（使えない環境ではメモリーに退避）
│   ├ url.js                # 絞り込みの条件を URL から読む・URL へ書く純関数と、英語表示のときのカードのリンク（DOM非依存・テスト対象）
│   └ tabs.js               # タブのキーボード操作の純関数
├ data/
│   ├ categories.json       # カテゴリマスター（手動管理）
│   ├ books.json            # 書籍・シリーズ定義（手動管理）
│   ├ added.json            # IDごとの初掲載日（自動管理・既存日付を保持）
│   └ tools.json            # 自動生成ファイル（手動編集禁止）
├ repos.txt                 # ツールリポジトリ一覧（1行1URL）
├ package.json              # テスト設定（依存なし・node --test）
├ test/
│   ├ books.test.js         # books.json とデータ検証のテスト（categories.json の id の形と、tools.json が使う id が categories.json にあることを含む）
│   ├ site.test.js          # storage.js・tabs.js の純関数と、index.html・main.js・style.css の検査（ARIA・CSP・ヘルプの窓・強制カラー・動きを減らす設定・データの読み込みの決まり・検索欄の変換中と戻ったときの絞り込み・案内文と枠線の濃さ・結果が1件のときのカードの幅・別のタブの進捗の反映・絞り込みの条件の URL と戻る・進む（タブが切り替わったときと、一覧・バナー・ダッシュボードの本の行を作り直したときのフォーカスを含む）・はじめ方の入口・英語表示のカードのリンク・選んだ言語を覚えること・ヘッダーを固定する画面と押せる部品の大きさ（指で押す画面で44px）・「?」の丸・サイト名とタブとダッシュボードの数字の折れ方・「はじめ方」の開閉を覚えること・ダッシュボードのシェアとリセットをデータが届くまで押せないこと）
│   ├ scroll_focus.test.js  # ヘッダーの下（ヘッダーを固定しない画面では画面の上端）で止まる位置・フォーカスの移し方・言語を切り替えたときに読んでいた場所・絞り込みを変えたときに操作した欄を同じ高さに保つことの検査
│   ├ robust.test.js        # 遅い回線・遅い端末で読み込みの途中に画面がずれたり固まったりしないこと（閉じて始める「はじめ方」を描く前に畳むことを含む）、一覧の一番下へ飛んだときにフッターまで届くこと、JavaScript が動かないときの表示、結果が少ないときにフッターが画面の途中に出ないことの検査
│   ├ search.test.js        # search.js の検査（全角と半角・前後の空白・複数の語・Day 番号・カテゴリー名とその別名で探せるか。実データの検査は探す語も実データから選ぶ）
│   ├ url.test.js           # url.js の検査（絞り込みの条件を URL から読む・URL へ書く・英語表示のときのカードのリンク・?lang=）
│   ├ catalog.test.js       # カタログとカテゴリ対応、初掲載日の検査
│   ├ render.test.js        # 依存を足さずに実データで全カードと各書籍を描画
│   ├ test_update_tools.py  # 通信失敗、401、初掲載日と生成結果の保全
│   └ lang.test.js          # lang.js の検査（言語と「はじめ方」の開閉を決める順・保存できない環境）
├ scripts/
│   ├ init_added.py         # 初掲載日をmainのGit履歴から一度だけ復元
│   └ update_tools.py       # READMEからカタログを生成（取得失敗時は前回値を保持）
└ .github/
    └ workflows/
        ├ update-tools.yml  # tools.json の自動再生成（CI）
        └ test.yml          # books.json とテストの検証（CI）
```

---

## 🧩 データ仕様

### ▶ tools.json（GitHub Actions により自動生成）

`data/tools.json`の中身の例：

```json
{
  "schema_version": 1,
  "generated_at": "2025-01-01T00:00:00Z",
  "tools": [
    {
      "id": "day101",
      "slug": "color-hack-box",
      "title": "Color Hack Box",
      "subtitle_ja": "色彩基礎の可視化ツール",
      "subtitle_en": "Color theory visualizer",
      "description_ja": "...",
      "description_en": "...",
      "category_ja": ["色彩理論"],
      "category_en": ["Color Theory"],
      "category_ids": ["color-theory"],
      "difficulty": 1,
      "tags": ["color", "javascript"],
      "repo_url": "https://github.com/ipusiron/color-hack-box",
      "demo_url": "https://ipusiron.github.io/color-hack-box/",
      "hub": true,
      "added": "2025-01-01"
    }
  ]
}
```

---

### ▶ added.json（自動管理）

`data/added.json`は、`{"day001": "2025-11-24"}`のようにIDと初掲載日を記録します。
日付はmainのカタログで表示対象になった日（日本時間）であり、ツールの制作日や、公開サイトで最初に表示された時刻とは異なります。
既存分はmainのGit履歴から復元し、追加後は説明の変更や再掲載でも日付を変えません。
通常の更新でファイルが欠けたり壊れたりした場合は中止するため、すべてのツールが当日の新着になることを防げます。

### ▶ categories.json（手動管理）

`data/categories.json`の中身の例：

```json
[
  {
    "id": "classic-crypto",
    "ja": "古典暗号",
    "en": "Classical cryptography",
    "aliases_ja": ["古典的暗号", "クラシカル暗号"],
    "aliases_en": ["Classical Cipher", "classic crypto"]
  },
  {
    "id": "color-theory",
    "ja": "色彩理論",
    "en": "Color Theory"
  }
]
```

`categories.json`の各フィールドは以下の意味を持ちます。

- **id**：識別子（集計・フィルター動作に使用するキー）。絞り込みの URL の `?cat=` にもそのまま出るので、英小文字・数字・ハイフンだけで書く（`npm test` が確かめる）。変えたり消したりしたときは `tools.json` も作り直す。古い id の付いたリンクは、カテゴリーの絞り込みのない一覧で開く
- **ja / en**：UIに表示されるカテゴリー名
- **aliases_ja / aliases_en**：表記ゆれを吸収するための別名。`tools.json` を作るときに README のカテゴリー名を `id` へ対応させるのに使い、キーワード検索でもカテゴリー名と同じく探す対象にする

---

### ▶ books.json（手動管理）

書籍・シリーズのフィルターの定義です。ツールは `id`（`dayNNN`）で指すので、`tools.json` の `slug` の表記には依存しません。UTF-8・BOMなしで保存します（`tools.json` には触りません）。

`data/books.json`の最小例：

```json
{
  "schema_version": 1,
  "books": [
    {
      "slug": "security-tools-100",
      "kind": "series",
      "title_ja": "「生成AIで作るセキュリティツール100」プロジェクト",
      "title_en": "\"100 Security Tools with Generative AI\" project",
      "label_ja": "ツール100（プロジェクト）",
      "label_en": "Security Tools 100",
      "url": "https://akademeia.info/?page_id=42163",
      "id_range": ["day001", "day100"]
    }
  ]
}
```

主なフィールドは以下の意味を持ちます（必須は `slug`・`kind`・`title_ja`・`title_en`・`label_ja`・`label_en`・`url`、および `ids` か `id_range` の少なくとも一方）。

- **slug**：`?book=` の値。英小文字・数字・ハイフンのみ、40文字以内、全体で一意
- **kind**：`book`（書籍）か `series`（プロジェクト）。プルダウンのグループに使う
- **title_ja / title_en**：正式題名（バナーの見出し）。英語の正式題名がない本は説明的な英題を入れる
- **label_ja / label_en**：プルダウンに出す短い名（表示幅14以下）
- **url**：読者の入口（紹介・サポート・プロジェクトページ）。`https://` で始める
- **ids**：明示の対象ツール（`dayNNN` の配列、昇順。全件が `tools.json` にあること）
- **id_range**：対象の範囲（両端を含む）。`["day101","day200"]` のように書くと、以降 `repos.txt` に足した新ツールが自動で入る
- **relation**：`introduced`（既定）／`related`（本にツールが登場しない関連ツール。`note_ja`・`note_en` が必須）
- **chapters / refs / common_ref**：ツールが本のどこ（章・付録の節）に出るかを示す。`refs` は `{ "dayNNN": [{ "ch": "ch08", "pages": ["123"] }] }` の形。`pages` は任意で、空なら表示しない
- **dashboard**：`false` にすると書籍別進捗の行を出さない（プルダウンと `?book=` では選べる）

章ごとにツールを示す本（`book`）の例：

```json
{
  "slug": "example-book",
  "kind": "book",
  "title_ja": "書名",
  "title_en": "Book title",
  "label_ja": "書名",
  "label_en": "Book title",
  "url": "https://akademeia.info/?page_id=00000",
  "relation": "introduced",
  "ids": ["day017", "day047"],
  "chapters": [
    { "key": "ch02", "label_ja": "第2章", "label_en": "Ch. 2" },
    { "key": "ch08", "label_ja": "第8章", "label_en": "Ch. 8" }
  ],
  "refs": {
    "day017": [{ "ch": "ch02" }, { "ch": "ch08" }],
    "day047": [{ "ch": "ch08", "pages": ["123"] }]
  }
}
```

本を1件足す手順＝①対象の `dayNNN` を調べる ②`ids`（または `id_range`）と、章があれば `chapters`・`refs` を書く ③`npm test` で検証 ④PR。`npm test` が `data/books.json` の構文・`ids` の存在・`refs` の整合などを失敗で止めるので、CI のログだけで直せます。

なお共有 URL（Xシェアのボタン）には書籍の絞り込みは含まれません。

---

### 📝 README冒頭のYAMLマター

各DayXXXのREADME冒頭のYAMLマターは以下の書式で記載します。

```
<!--
---
id: dayXXX
slug: your-tool-slug

title: "Tool Name"

subtitle_ja: "日本語の副題"
subtitle_en: "English subtitle"

description_ja: "日本語の概要文"
description_en: "English description"

category_ja:
  - 日本語カテゴリ
category_en:
  - English category

difficulty: 1

tags:
  - tag1
  - tag2
  - tag3

repo_url: "https://github.com/ipusiron/[slug]"
demo_url: "https://ipusiron.github.io/[slug]/"

hub: true
---
!-->
```

---

## GitHub Actions共存環境での安全なpush手順

GitHub Actionsがmainに対して自動で`tools.json`などを更新・コミットする構造のために、「ローカルからの手動push」と「Botのpush」が衝突しやすくなっています。
そのため、push前には必ずrebase（＝最新履歴の取り込み）を行ってください。

### ⚠ push前に必ずrebaseを実行すること

手順は以下のとおりです。

1. 作業開始前（任意）

最初に `main` を最新にしておくと安心です。

```bash
$ git switch main
$ git fetch origin
$ git pull --rebase origin main
```

※必須ではありません。
push直前に行う最終同期が本番です。

2. ローカルで編集する

HTML / CSS / JS / READMEなどを自由に編集します。
この段階はGitHub Actionsが動いていても問題ありません。

3. 編集内容をステージングする（git add）

```bash
$ git add .
```

必要に応じてファイル単位でもOKです。

```bash
$ git add README.md
```

4. ローカルにコミットする（git commit）

```bash
$ git commit -m "Update: ○○ の修正"
```

この時点ではローカルmainにのみコミットが存在しています。
この状態は安全です。

5. push直前の必須儀式（最重要）

GitHub Actionsが裏でmainに更新を入れている可能性があるため、pushの直前に必ず最新を取り込みます。

```bash
$ git fetch origin
$ git pull --rebase origin main
```

ここでコンフリクトが起きた場合は、以下のコマンドを実行します。

```bash
$ git rebase --continue
```

6. 安全なpush

```bash
$ git push origin main
``` 

これでnon-fast-forwardエラーやBotの更新との競合を防止できます。

#### 📌 これで防げる問題

これにより次の問題を防げます。

* non-fast-forwardエラー
* GitHub Actionsが生成した自動コミットとの競合
* pushの失敗・履歴の分岐
* mainの破壊（force pushを回避できる）


#### 🧭 なぜ rebase が必要なのか

GitHub Actionsは、あなたのpushに関係なくmainに新しいコミットを追加します。

その間にあなたがローカルで作業してpushしようとすると、ローカルmainとorigin/mainの履歴がズレてpushが拒否されることがあります。

対応策である`git pull --rebase origin main`コマンドを実行すれば、origin/mainの最新履歴を取り込み、あなたのローカルコミットをその後ろに綺麗に並べ直します。
これにより、mainの歴史を壊さず安全にpushできる状態に整えるという効果があります。

---

## 🧪 ローカル動作確認

GitHub Pagesと同様の挙動をローカルで確認するには、以下のように簡易Webサーバーを立ち上げます。

```bash
$ python3 -m http.server
or
$ npx http-server -p 8080
or 
$ npx serve
```

`books.json` とデータ検証のテストは、依存のインストールなしで実行できます（Node 20以上）。

```bash
$ npm test
```

---

### カタログ生成の確認

生成処理にはPythonとPyYAML 6.0.3を使います。導入済みの環境では、次のコマンドで通信を使わない失敗時の検査と実際の再生成を実行できます。

```bash
npm run test:generator
python scripts/update_tools.py --check-demos --summary catalog-summary.md
```

再生成後は`AFTER_REGEN=1`を設定して`npm test`を実行します。
`HLO_BASE_COMMIT`に比較元のコミットを指定すると、既存の初掲載日が変更、削除されていないことも確認できます。
GitHub Actionsはこれらの検査をコミット前に実行します。
`init_added.py`は履歴からの初期復元専用で、既存の`added.json`を上書きしません。

画面の配色はOSのライト・ダーク設定に合わせて変わります。手動の切り替えは設けていません。

## 🚀 今後の改善予定

* category aliasの完全サポート
* カードUIのさらなる改善

---

## 👤 管理人（IPUSIRON）

* セキュリティ・暗号技術が専門の日本の技術書著者
* 福島県相馬市出身・在住
* 25年以上の執筆経験
* 商業誌・同人誌で累計30冊以上を刊行

主な著書：

* 『暗号技術のすべて』
* 『ハッキング・ラボのつくりかた 完全版』
* 『ホワイトハッカーの教科書』
* 『ハッカーの学校 鍵開けの教科書』

英語書籍：
[https://ipusiron.github.io/book_Caesar_concise_en/](https://ipusiron.github.io/book_Caesar_concise_en/)

ブログ：
[https://akademeia.info/](https://akademeia.info/)

---

## 🔗 GitHub リポジトリ

[https://github.com/ipusiron/hackinglab-online/](https://github.com/ipusiron/hackinglab-online/)
