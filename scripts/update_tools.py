#!/usr/bin/env python3
"""
repos.txt と categories.json を元に data/tools.json を生成するスクリプト。

前提:
- repos.txt : 1行1リポジトリURL、#から始まる行はコメント
- data/categories.json : [{ "id": "...", "ja": "...", "en": "..." }, ...]
- 各リポジトリの README.md 冒頭に HTMLコメント内YAMLマターがある:

<!--
---
id: day102
slug: qrcrashtest
title: "QRCrashTest"
...
hub: true
---
-->

制限:
- README は default branch の main から取得する前提
  (https://raw.githubusercontent.com/<owner>/<repo>/main/README.md)
"""

from __future__ import annotations

import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Dict, List, Any, Optional
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import yaml  # PyYAML


ROOT = Path(__file__).resolve().parents[1]
REPOS_TXT = ROOT / "repos.txt"
DATA_DIR = ROOT / "data"
CATEGORIES_JSON = DATA_DIR / "categories.json"
TOOLS_JSON = DATA_DIR / "tools.json"


def log(msg: str) -> None:
    print(msg, file=sys.stderr)


def read_repos() -> List[str]:
    if not REPOS_TXT.exists():
        log(f"[WARN] repos.txt が見つかりません: {REPOS_TXT}")
        return []

    repos: List[str] = []
    for line in REPOS_TXT.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        repos.append(line)
    return repos


def load_categories() -> Dict[str, Dict[str, str]]:
    if not CATEGORIES_JSON.exists():
        log(f"[INFO] categories.json が存在しません（空のカテゴリとして扱います）: {CATEGORIES_JSON}")
        return {"ja_to_id": {}, "en_to_id": {}}

    try:
        raw = json.loads(CATEGORIES_JSON.read_text(encoding="utf-8"))
    except Exception as e:
        log(f"[ERROR] categories.json の読み込みに失敗: {e}")
        return {"ja_to_id": {}, "en_to_id": {}}

    ja_to_id: Dict[str, str] = {}
    en_to_id: Dict[str, str] = {}

    for cat in raw:
        cid = cat.get("id")
        ja = cat.get("ja")
        en = cat.get("en")
        if cid and ja:
            ja_to_id[ja] = cid
        if cid and en:
            en_to_id[en] = cid
        # aliases も登録
        for alias in cat.get("aliases_ja", []):
            if cid and alias:
                ja_to_id[alias] = cid
        for alias in cat.get("aliases_en", []):
            if cid and alias:
                en_to_id[alias] = cid

    return {"ja_to_id": ja_to_id, "en_to_id": en_to_id}


def parse_repo_url(url: str) -> Optional[Dict[str, str]]:
    """
    https://github.com/ipusiron/qrcrashtest(.git)
    git@github.com:ipusiron/qrcrashtest.git
    などを owner / repo_name に分解
    """
    url = url.strip()

    # https ベース
    m = re.match(r"https://github\.com/([^/]+)/([^/]+?)(\.git)?$", url)
    if m:
        owner, repo = m.group(1), m.group(2)
        return {"owner": owner, "repo": repo}

    # ssh ベース
    m = re.match(r"git@github\.com:([^/]+)/([^/]+?)(\.git)?$", url)
    if m:
        owner, repo = m.group(1), m.group(2)
        return {"owner": owner, "repo": repo}

    log(f"[WARN] GitHubリポジトリURLとして解釈できません: {url}")
    return None


def fetch_readme(owner: str, repo: str, branches: List[str] = None) -> Optional[str]:
    if branches is None:
        branches = ["main", "master"]

    for branch in branches:
        raw_url = f"https://raw.githubusercontent.com/{owner}/{repo}/{branch}/README.md"
        try:
            with urlopen(raw_url) as resp:
                charset = resp.headers.get_content_charset() or "utf-8"
                return resp.read().decode(charset, errors="replace")
        except HTTPError:
            continue  # 次のブランチを試す
        except URLError as e:
            log(f"[WARN] README取得失敗 URLError: {raw_url} ({e})")
            return None
        except Exception as e:
            log(f"[WARN] README取得中に予期しないエラー: {raw_url} ({e})")
            return None

    log(f"[WARN] README取得失敗: {owner}/{repo} (どのブランチにも見つかりません)")
    return None


def extract_yaml_from_readme(text: str) -> Optional[Dict[str, Any]]:
    """
    README 全文から、最初の <!-- ... --> 内の --- ... --- を YAML としてパース
    """
    m_comment = re.search(r"<!--(.*?)-->", text, flags=re.DOTALL)
    if not m_comment:
        log("[WARN] README内に HTML コメントブロックが見つかりません")
        return None

    comment_body = m_comment.group(1)
    m_yaml = re.search(r"---(.*?)---", comment_body, flags=re.DOTALL)
    if not m_yaml:
        log("[WARN] コメントブロック内に YAMLマターが見つかりません")
        return None

    yaml_text = m_yaml.group(1)
    try:
        data = yaml.safe_load(yaml_text)
        if not isinstance(data, dict):
            log("[WARN] YAMLマターが辞書ではありません")
            return None
        return data
    except yaml.YAMLError as e:
        log(f"[WARN] YAMLのパースに失敗: {e}")
        return None


def build_tool_entry(y: Dict[str, Any], cat_maps: Dict[str, Dict[str, str]]) -> Dict[str, Any]:
    ja_to_id = cat_maps["ja_to_id"]
    en_to_id = cat_maps["en_to_id"]

    cat_ids = set()

    for name in y.get("category_ja", []) or []:
        cid = ja_to_id.get(name)
        if cid:
            cat_ids.add(cid)
        else:
            log(f"[INFO] 未知のカテゴリ名(ja): {name}")

    for name in y.get("category_en", []) or []:
        cid = en_to_id.get(name)
        if cid:
            cat_ids.add(cid)
        else:
            log(f"[INFO] 未知のカテゴリ名(en): {name}")

    category_ids = sorted(cat_ids)

    entry = {
        "id": y.get("id", ""),
        "slug": y.get("slug", ""),
        "title": y.get("title", ""),
        "subtitle_ja": y.get("subtitle_ja", ""),
        "subtitle_en": y.get("subtitle_en", ""),
        "description_ja": y.get("description_ja", ""),
        "description_en": y.get("description_en", ""),
        "category_ja": y.get("category_ja", []) or [],
        "category_en": y.get("category_en", []) or [],
        "category_ids": category_ids,
        "difficulty": int(y.get("difficulty") or 1),
        "tags": y.get("tags", []) or [],
        "repo_url": y.get("repo_url", ""),
        "demo_url": y.get("demo_url", ""),
        "hub": bool(y.get("hub", True)),
    }

    return entry


def main() -> int:
    repos = read_repos()
    cat_maps = load_categories()

    tools: List[Dict[str, Any]] = []

    for url in repos:
        info = parse_repo_url(url)
        if not info:
            continue

        owner = info["owner"]
        repo = info["repo"]

        log(f"[INFO] 処理中: {owner}/{repo}")

        readme = fetch_readme(owner, repo)
        if readme is None:
            continue

        y = extract_yaml_from_readme(readme)
        if y is None:
            continue

        # YAMLに repo_url/demo_url がなければここで補完も可能
        y.setdefault("repo_url", f"https://github.com/{owner}/{repo}")
        y.setdefault("demo_url", f"https://{owner}.github.io/{repo}/")

        tool_entry = build_tool_entry(y, cat_maps)

        if not tool_entry["id"]:
            log(f"[WARN] id が空のためスキップ: {owner}/{repo}")
            continue

        tools.append(tool_entry)

    # id でソート
    tools.sort(key=lambda t: t["id"])

    data = {
        "schema_version": 1,
        "generated_at": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "tools": tools,
    }

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TOOLS_JSON.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")

    log(f"[INFO] tools.json を更新しました: {TOOLS_JSON} (tools={len(tools)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
