# ハッキング・ラボ・オンライン - Hacking Lab Online

「生成AIで作るセキュリティツール」プロジェクトで誕生した **100本以上の教育ツールを集約した、独学者のための学習プラットフォーム** です。

- 🔍 ツールをカテゴリ・進捗・キーワードで検索  
- 📚 学習状況をlocalStorageを使って記録  
- 📊 ダッシュボードで全体進捗＋カテゴリ別進捗を可視化  
- 🔗 X（旧Twitter）で進捗をワンクリック共有  
- 🌐 多言語対応（日本語 / 英語）

ブラウザーで直接お試しいただけます。

👉 **[https://ipusiron.github.io/hackinglab-online/](https://ipusiron.github.io/hackinglab-online/)**

---

## 📖 プロジェクト概要

このサイトは、**「生成AIで作るセキュリティツール」プロジェクト** で制作したツール群を一覧化し、学習を支援するためのポータルサイトです。

- [「生成AIで作るセキュリティツール100」プロジェクト](https://akademeia.info/?page_id=42163)
- [「生成AIで作るセキュリティツール200」プロジェクト](https://akademeia.info/?page_id=44607)

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

---

### 📝 categories.json 各フィールドの意味

* **id**：内部識別子（集計・フィルター動作に使用するキー）
* **ja / en**：UIに表示されるカテゴリ名
* **aliases_***：表記ゆれを吸収するための候補（現在は仕様上は未使用だが、例としてclassic-cryptoにだけ残している）

---

## 🔄 自動更新フロー（GitHub Actions）

このリポジトリは **セルフアップデート方式** を採用しています。

`repos.txt`にツールのGitHub URLを1行追加してpushすると、自動的に`tools.json`が再生成され、GitHub Pagesが更新されます。

### フロー全体

1. `repos.txt` にURLを追加
2. `git push`
3. GitHub Actions（`update-tools.yml`）が起動
4. 各ツールリポジトリの README 内の YAML マターを抽出
5. `categories.json` と照合して `category_ids` を付与
6. `data/tools.json` を自動生成
7. GitHub Actions Bot が tools.json を自動コミット
8. GitHub Pages が再ビルドされサイトに反映

---

## ⚠ push 前に「必ず rebase」を実行

CI が tools.json を自動コミットするため、
手動 push と bot push が衝突しやすい構造になっています。

そのため、push 前には必ず以下を実行してください：

```
git pull --rebase origin main
git push origin main
```

これにより次の問題を防げます。

* non-fast-forward エラー
* bot の自動コミットとの競合
* push の失敗

---

## 🧪 ローカル動作確認

GitHub Pages と同様の挙動をローカルで確認するには：

```
python3 -m http.server
```

または：

```
npx serve
```

---

## 🚀 今後の改善予定

* category alias の完全サポート
* カードUIのさらなる改善
* Dark Mode 対応

---

## 👤 管理人（IPUSIRON）

* セキュリティ・暗号技術が専門の日本の技術書著者
* 福島県相馬市出身・在住
* 20年以上の執筆経験
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

