# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hacking Lab Online is a bilingual (Japanese/English) self-learning platform that aggregates security education tools created by IPUSIRON through the "100 Security Tools with Generative AI" project. It's a static web application hosted on GitHub Pages.

## Architecture

### Core Data Flow
1. `repos.txt` lists GitHub repository URLs (one per line, # for comments)
2. `scripts/update_tools.py` fetches README.md from each repo and extracts YAML frontmatter from HTML comments
3. `data/tools.json` is generated with tool metadata
4. `js/main.js` loads `data/tools.json` and `data/categories.json` to render the UI

### Tool Metadata Format
Each tool repo must have README.md with YAML in HTML comment:
```html
<!--
---
id: day001
slug: tool-slug
title: "Tool Name"
subtitle_ja: "日本語サブタイトル"
subtitle_en: "English subtitle"
description_ja: "日本語説明"
description_en: "English description"
category_ja: ["カテゴリ名"]
category_en: ["Category Name"]
difficulty: 1
tags: ["tag1", "tag2"]
hub: true
---
-->
```

### Key Files
- `data/categories.json`: Category definitions with id, ja, en fields
- `data/books.json`: Book/series filter definitions (manual). Tools are referenced by `id` (`dayNNN`), not slug
- `data/tools.json`: Auto-generated tool registry (do not edit manually)
- `repos.txt`: Master list of tool repositories
- `js/main.js`: All UI logic including filtering, progress tracking (localStorage), language switching, and X sharing
- `js/books.js`: Pure functions for the book/series filter (DOM-free); tested by `test/books.test.js`
- `js/storage.js`: Safe localStorage wrapper (never throws; falls back to in-memory when storage is unavailable)
- `js/tabs.js`: Pure keyboard logic for the tabs (←/→/Home/End)
- `test/books.test.js` + `test/site.test.js` + `package.json`: `node --test`, no dependencies. `site.test.js` covers the two modules above and static checks of `index.html` (ARIA references, dialog, h1, CSP, no inline styles/scripts)
- `index.html` has a meta CSP (`default-src 'none'`, everything else `'self'`). Do not add inline `<script>`, `style="..."` or `on*=` attributes; JS-set `element.style` is fine. Language display is driven by `<html lang>` + CSS (`.label-ja` / `.label-en`)

### Loading data (keep the first view fast)
On a slow mobile connection every extra round trip delays the cards by about 0.6 s, so keep these rules when adding data or scripts. `test/site.test.js` (H16–H20) checks them.
- Start every JSON the first view needs before the first `await` in `loadData()` (`js/main.js`). The required ones (`categories.json`, `tools.json`) go into one `Promise.all`. Optional ones (`books.json`) are started next to it and catch their own failure (`.catch(() => null)`), so a missing or broken optional file never stops the tool list. Do not put optional data into the `Promise.all`, and do not fetch anything after awaiting the others.
- JSON that the first view does not need is fetched when its screen is opened, not in `loadData()`.
- Every `<script>` in `index.html` has `defer` and never `async`. The meta CSP stops Chromium's preload scanner, so without `defer` Chromium can fetch them one by one (often on slow devices); `defer` keeps the execution order books → storage → tabs → main.
- `data/tools.json` stays at or below 80 KB gzipped (about 42 KB for 127 tools). Going over is a signal to revisit how the list is loaded, or the limit; it is not a cap on the number of tools.
- After the first list render, `main.js` sets `performance.mark("hlo:cards-painted")` once, to check the timing in DevTools. The timing is never read back or sent anywhere.

## Commands

### Generate tools.json locally
```bash
pip install pyyaml
python scripts/update_tools.py
```

### Local development
Open `index.html` directly in browser or use any static server:
```bash
python -m http.server 8000
```

### Run tests (no dependencies, Node 20+)
```bash
npm test
```

## CI/CD

GitHub Actions workflow (`.github/workflows/update-tools.yml`) automatically regenerates `data/tools.json` when:
- `repos.txt` is modified
- `data/categories.json` is modified
- `scripts/update_tools.py` is modified
- Manually triggered via workflow_dispatch

`.github/workflows/test.yml` runs `npm test` on push to `main`, on pull requests, and after the tools.json regeneration (`workflow_run`). A red run means `data/books.json` needs fixing.

## Progress System

User progress is stored in browser localStorage with keys `progress_{slug}` containing values 0-3:
- 0: 未着手 / Not started
- 1: 学習中 / In progress
- 2: 一周完了 / First pass
- 3: 定着済み / Mastered

## Adding New Tools

1. Add repository URL to `repos.txt`
2. Ensure target repo has proper YAML frontmatter in README.md
3. Add any new categories to `data/categories.json` if needed
4. Push changes - CI will regenerate tools.json

## Adding a Book

1. Add an entry to `data/books.json` (see README「books.json（手動管理）」for fields)
2. Reference tools by `id` (`dayNNN`); every `id` must already exist in `tools.json`
3. If the book maps tools to chapters, add `chapters` and `refs`
4. Run `npm test`, then open a PR (data-only change; `tools.json` is not touched)
