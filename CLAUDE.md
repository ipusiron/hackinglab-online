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
- `data/tools.json`: Auto-generated tool registry (do not edit manually)
- `repos.txt`: Master list of tool repositories
- `js/main.js`: All UI logic including filtering, progress tracking (localStorage), language switching, and X sharing

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

## CI/CD

GitHub Actions workflow (`.github/workflows/update-tools.yml`) automatically regenerates `data/tools.json` when:
- `repos.txt` is modified
- `data/categories.json` is modified
- `scripts/update_tools.py` is modified
- Manually triggered via workflow_dispatch

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
