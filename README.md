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
- 📚 学習状況をlocalStorageを使って記録  
- 📊 ダッシュボードで全体進捗＋カテゴリ別・書籍別進捗を可視化  
- 🔗 X（旧Twitter）で進捗をワンクリック共有  
- 🌐 多言語対応（日本語 / 英語）

なお、学習プラットフォームとしては最低限の機能しか備えていません。

ランク制やゲーミフィケーション的な機能を実装する予定は今のところありません。

> ランク制を導入してしまうとどうしても他人と比較してしまいがちになります。
> 中級者以降であればそれも刺激になるかもしれませんが、超初心者から初心者まではあまり他人と比較すべきではないと考えているからです。
>
> また、正直なところ現状プラットフォームの運営・改良に私自身が興味が持てないためです。
> そのような時間があれば、多分本を書きまくります。

---

## 🔄 自動更新フロー（GitHub Actions）

このリポジトリは **セルフアップデート方式** を採用しています。

`repos.txt`にツールのGitHub URLを1行追加してpushすると、自動的に`tools.json`が再生成され、GitHub Pagesが更新されます。

### フロー全体

1. `repos.txt` にURLを追加
2. `git push`
3. GitHub Actions（`update-tools.yml`）が起動
4. 各ツールリポジトリのREADME内のYAMLマターを抽出
5. `categories.json`と照合して`category_ids`を付与
6. `data/tools.json`を自動生成
7. GitHub Actions Botが`tools.json`を自動コミット
8. GitHub Pagesが再ビルドされサイトに反映

---

## 📂 リポジトリー構成

```text
/
├ index.html                # メインHTML（ヘッダー・タブ・モーダル）
├ css/
│   └ style.css             # 全体スタイル（モバイルファースト）
├ js/
│   ├ main.js               # フロントロジック（一覧・進捗管理・ダッシュボード）
│   └ books.js              # 書籍フィルターの純関数（DOM非依存・テスト対象）
├ data/
│   ├ categories.json       # カテゴリマスター（手動管理）
│   ├ books.json            # 書籍・シリーズ定義（手動管理）
│   └ tools.json            # 自動生成ファイル（手動編集禁止）
├ repos.txt                 # ツールリポジトリ一覧（1行1URL）
├ package.json              # テスト設定（依存なし・node --test）
├ test/
│   └ books.test.js         # books.json とデータ検証のテスト
├ scripts/
│   └ update_tools.py       # README からメタ情報を抽出して tools.json を生成
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
      "hub": true
    }
  ]
}
```

---

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

- **id**：内部識別子（集計・フィルター動作に使用するキー）
- **ja / en**：UIに表示されるカテゴリー名
- **aliases_**：表記ゆれを吸収するための候補（現在は仕様上は未使用だが、例としてclassic-cryptoにだけ残している）

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
- **title_ja / title_en**：正式題名（バナーの見出し）。英語の正式題名が無い本は説明的な英題を入れる
- **label_ja / label_en**：プルダウンに出す短い名（表示幅14以下）
- **url**：読者の入口（紹介・サポート・プロジェクトページ）。`https://` で始める
- **ids**：明示の対象ツール（`dayNNN` の配列、昇順。全件が `tools.json` にあること）
- **id_range**：対象の範囲（両端を含む）。`["day101","day200"]` のように書くと、以降 `repos.txt` に足した新ツールが自動で入る
- **relation**：`introduced`（既定）／`related`（本にツールが登場しない関連ツール。`note_ja`・`note_en` が必須）
- **chapters / refs / common_ref**：ツールが本のどこ（章・付録の節）に出るかを示す。`refs` は `{ "dayNNN": [{ "ch": "ch08", "pages": ["123"] }] }` の形。`pages` は任意で、空なら表示しない
- **dashboard**：`false` にすると書籍別進捗の行を出さない（プルダウンと `?book=` では選べる）

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

## 🚀 今後の改善予定

* category aliasの完全サポート
* カードUIのさらなる改善
* Dark Mode対応

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
