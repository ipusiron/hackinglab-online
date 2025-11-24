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
- 📚 学習状況をlocalStorageを使って記録  
- 📊 ダッシュボードで全体進捗＋カテゴリ別進捗を可視化  
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
│   └ main.js               # フロントロジック（一覧・進捗管理・ダッシュボード）
├ data/
│   ├ categories.json       # カテゴリマスター（手動管理）
│   └ tools.json            # 自動生成ファイル（手動編集禁止）
├ repos.txt                 # ツールリポジトリ一覧（1行1URL）
├ scripts/
│   └ update_tools.py       # README からメタ情報を抽出して tools.json を生成
└ .github/
    └ workflows/
        └ update-tools.yml  # GitHub Actions（CI）
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

## ⚠ push 前に「必ず rebase」を実行すること

CIが`tools.json`を自動コミットするため、手動pushとbot pushが衝突しやすい構造になっています。

そのため、push前には必ず以下の手順でgitコマンドを実行してください。

```bash
$ git pull --rebase origin main
$ git push origin main
```

これにより次の問題を防げます。

* non-fast-forwardエラー
* botの自動コミットとの競合
* pushの失敗

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
