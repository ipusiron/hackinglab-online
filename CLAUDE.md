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
- `js/lang.js`: Decides the display language before the first paint and writes `<html lang>`; tested by `test/lang.test.js`. The order is `?lang=` (`ja` or `en`; case and spaces are ignored, other values too), then the language saved on this device (`localStorage` key `hlo_lang`), then Japanese. The browser language is not used. `js/main.js` saves the language only when JA/EN is pressed (through `js/storage.js`, so a blocked storage still switches the page) and keeps `?lang=en` in the URL while the page is in English (it is left out in Japanese, except that an opened `?lang=ja` stays)
- `js/books.js`: Pure functions for the book/series filter (DOM-free); tested by `test/books.test.js`
- `js/search.js`: Pure functions for the keyword search (DOM-free); tested by `test/search.test.js`. Both the query and the tool text are normalized (NFKC, lower case); every space-separated word must match; a Day number (`Day12`, `day 12`) is padded to three digits and matches only that tool's id (a number of only zeros, such as `Day0` while typing `Day050`, is matched as plain text instead); the searched text is the id, title, subtitles, descriptions, tags and the categories shown on the card (`categories.json` ja/en and their `aliases_ja`/`aliases_en`, but not names that appear only in a tool README)
- `js/url.js`: Pure functions for URLs (DOM-free); tested by `test/url.test.js`. `readState()` reads the list state from the URL (`?book=`, `?cat=`, `?q=`, `?tab=dashboard`; books and categories that do not exist are ignored) and `buildUrl()` writes it back in that fixed order, followed by `lang` (only the given keys change; other parameters are kept after them; an empty query leaves no `?`; changing the book drops the `#book-group-…` hash). The progress filter is never put in the URL. `js/main.js` makes the search box follow `?q=` when the page opens (it gets the words of `?q=`, and is emptied when there is none, unless it already holds the same words or the user has started typing; the words show while the data loads, and the box is not overwritten when the data arrives, so text typed meanwhile is kept), reads the other values when the data has loaded, and calls `commitUrl()` before it changes the state. `repoLink()` and `demoLink()` give the card links in English view only: "GitHub" opens the English README (`blob/HEAD/README.en.md`, so both `main` and `master` work) and an `ipusiron.github.io` demo gets `?lang=en` (other hosts such as Google Colab, and the Japanese view, keep the links as they are). `withLang()` adds `?lang=en` in English to the "Start here" entries, the dashboard's book rows and the URL shared on X
- `js/storage.js`: Safe localStorage wrapper (never throws; falls back to in-memory when storage is unavailable)
- `js/tabs.js`: Pure keyboard logic for the tabs (←/→/Home/End)
- `test/*.test.js` + `package.json`: `node --test`, no dependencies. `npm test` runs all seven files (the list is in `package.json`; add a new test file there too):
  - `books.test.js`: the real `data/books.json` and `data/tools.json` (D1–D15, S1) and the pure functions in `js/books.js` on synthetic data (F1–F6)
  - `site.test.js`: `js/storage.js` and `js/tabs.js` (U1–U2); static checks of `index.html`, `js/main.js` and `css/style.css` (H1–H15: ARIA references, tabs, dialog, h1, CSP, no inline styles/scripts, help dialog, forced colors, reduced motion); the data loading rules (H16–H20, see "Loading data"); the search input, the filters and the list (H21–H24: no filtering while Japanese text is still being composed, searching with the text the browser put back in the field on Back or reload, the contrast of the placeholder and the field borders, and keeping the card width when only one tool matches); progress changed in another tab (H25); the list state in the URL, Back and Forward, and the "Start here" entries (H26–H28, see "Back and Forward"); the card links in English view (H29); remembering the chosen language (H30); where the focus goes when Back or Forward switches the tab (H31, see "Back and Forward")
  - `scroll_focus.test.js`: where jumps and focus stop under the fixed header, keeping the reading position when switching languages, and keeping the changed filter at the same height on screen (SF1–SF8)
  - `robust.test.js`: no layout shifts or freezes while loading on slow connections and devices, reaching the footer when jumping to the end of the list, the view without JavaScript, and keeping the footer out of the middle of the screen when few tools match (RB1–RB8)
  - `search.test.js`: the pure functions in `js/search.js` on synthetic data (Q1–Q7) and on the real `data/tools.json` and `data/categories.json` (QD1–QD5: inputs that mean the same give the same tools; no fixed counts, and the words are taken from the data itself, such as its tags and category names, so regenerating `tools.json` alone does not break them)
  - `url.test.js`: the pure functions in `js/url.js` on small fixed data (UR1–UR2: reading the list state from the URL and writing it back; UR3: the card links in English view; UR4: `?lang=` in the URL)
  - `lang.test.js`: `js/lang.js` (LG1–LG2: the order that decides the language and reading the saved value; LG3: running the file as the browser does and writing `<html lang>`, also when storage is blocked)
- The static checks read the source text of `index.html`, `js/main.js` and `css/style.css` (comments are ignored where it matters). When you rename a function, selector or id that a check names, update the check in the same change
- `index.html` has a meta CSP (`default-src 'none'`, everything else `'self'`). Do not add inline `<script>`, `style="..."` or `on*=` attributes; JS-set `element.style` is fine. Language display is driven by `<html lang>` + CSS (`.label-ja` / `.label-en`, and the pressed look of JA/EN); `js/lang.js` sets `<html lang>` before the first paint, so do not put Japanese text in attributes that show before `js/main.js` runs (the search box placeholder is set by JS)

### Loading data (keep the first view fast)
On a slow mobile connection every extra round trip delays the cards by about 0.6 s, so keep these rules when adding data or scripts. `test/site.test.js` (H16–H20) checks them.
- Start every JSON the first view needs before the first `await` in `loadData()` (`js/main.js`). The required ones (`categories.json`, `tools.json`) go into one `Promise.all`. Optional ones (`books.json`) are started next to it and catch their own failure (`.catch(() => null)`), so a missing or broken optional file never stops the tool list. Do not put optional data into the `Promise.all`, and do not fetch anything after awaiting the others.
- JSON that the first view does not need is fetched when its screen is opened, not in `loadData()`.
- Every `<script>` in `index.html` is in `<head>` (after the CSP meta and the stylesheet) and has `defer`, never `async`. The meta CSP stops Chromium's preload scanner, so without `defer` Chromium can fetch them one by one, each waiting for the one before (a round trip each on a slow connection); `defer` keeps the execution order books → search → storage → tabs → url → main.
- The only exception is `js/lang.js`: it has no `defer` because it must set `<html lang>` before the first paint (so a saved English never shows Japanese for a moment). Keep it the last script, after the deferred ones, and keep `fetchpriority="high"` on the deferred ones. Put after `lang.js`, they may be found only after `lang.js` has arrived; without `fetchpriority="high"`, Chromium holds back deferred scripts in `<head>` while `lang.js` blocks the parser. Either way the cards came about one round trip later on a slow connection when measured with Chromium. Add no other script without `defer`.
- Compare loading times over HTTP/2, as GitHub Pages serves the site. A local HTTP/1.x server (`python -m http.server` speaks HTTP/1.0) lets Chromium open only six connections per host, so the eight files in `<head>` (the stylesheet and seven scripts) wait about one more round trip there than on the site.
- `data/tools.json` stays at or below 80 KB gzipped (127 tools were about 42 KB in November 2026). Going over is a signal to revisit how the list is loaded, or the limit; it is not a cap on the number of tools.
- After the first list render, `main.js` sets `performance.mark("hlo:cards-painted")` once, to check the timing in DevTools. The timing is never read back or sent anywhere.

### Back and Forward
The list state is kept in the URL (`js/url.js`), and `js/main.js` decides when a change adds a history entry. `test/site.test.js` (H26–H28, H31) checks these rules.
- Choosing a book (the select, the banner's Clear button, the "Start here" entries, a book row of the dashboard), choosing a category, or clicking a tab pushes one entry, so Back returns to the previous list. Changes of the same select within one second are merged into one entry (moving a select with the arrow keys changes it one step at a time). When the merged changes bring the URL back to what it was before the push, the pushed entry is taken off with `history.back()` (it stays as the Forward entry), so that one Back is not spent on an entry with the same list. That `popstate` does not rebuild the list, and changes made before it arrives are written to the URL once it has arrived.
- Typing in the search box, switching tabs with the arrow keys, jumping to a chapter and tidying the URL when the page opens replace the current entry. With no action, one Back still leaves the hub (for example, back to a book's support page).
- On Back and Forward (`popstate`), the list is rebuilt from the URL and the scroll position saved in `history.state` is restored. The list state is not written to the URL there; only `?lang=` is set to the current language. Before the data has loaded, only the tab and the search box follow the URL.
- When Back or Forward switches the tab and the focused element is left in the hidden panel (for example, Back after a book row of the dashboard opened the list), the focus moves to the element that was focused when `history.state` was last written for that entry (before the next entry was pushed, or when scrolling stopped; here the same book row), or else to the selected tab. When the focus is on the tab button that is no longer selected (for example, Back after a tab was chosen with Enter), it moves to the selected tab button. Neither move scrolls.
- The "Start here" entries keep their `href`. Only a plain left click is handled in JS (no reload); clicks with Ctrl/⌘/Shift/Alt and middle clicks are left to the browser (a new tab or window, for example). "All tools" also clears the category, progress and search filters.

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

`.github/workflows/test.yml` runs `npm test` on push to `main`, on pull requests, and after the tools.json regeneration (`workflow_run`). When a run is red, open the log and find the failing test's ID; its message says which rule broke and why:
- `D*` or `S1` (`books.test.js`), typically right after a regeneration: `data/books.json` refers to a tool id that is no longer in `tools.json`, or a book entry is broken. Fix `data/books.json`. If D1 reports a BOM in `tools.json`, fix `scripts/update_tools.py` instead. Never edit `tools.json` by hand
- `H19` (`site.test.js`): `tools.json` grew past 80 KB gzipped. Revisit how the list is loaded, or the limit (see "Loading data"); it is not a reason to stop adding tools
- Any other ID (`F*`, `U*`, `UR*`, `LG*`, `H*`, `SF*`, `RB*`, `Q*`, `QD*`): a change to `index.html`, `js/` or `css/style.css` broke a rule. Fix the change, or update the check if the rule itself was changed on purpose

## Progress System

User progress is stored in browser localStorage with keys `progress_{slug}` containing values 0-3:
- 0: 未着手 / Not started
- 1: 学習中 / In progress
- 2: 一周完了 / First pass
- 3: 定着済み / Mastered

When another tab of the same browser changes the progress, the open page redraws its progress buttons and the dashboard (`storage` event, `setupProgressSync()` in `js/main.js`). The many events of a full reset are merged into one redraw, and the tool list itself is not rebuilt.

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
