# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hacking Lab Online is a bilingual (Japanese/English) self-learning platform that aggregates security education tools created by IPUSIRON through the "Security Tools with Generative AI" project (100 and 200). It's a static web application hosted on GitHub Pages.

## Architecture

### Core Data Flow
1. `repos.txt` lists GitHub repository URLs (one per line, # for comments)
2. `scripts/update_tools.py` fetches README.md for tool metadata and both README languages for usage headings; `scripts/readme_usage.py` parses bounded Markdown heading candidates
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
- `data/categories.json`: Category definitions with id, ja, en fields (and optional `aliases_ja`/`aliases_en`). The id appears in the URL as `?cat=`, so it uses only lower-case letters, digits and hyphens (checked by C1). Renaming or removing an id needs a regenerated `tools.json` in the same change. Keep an explicit URL alias when compatibility is required; `learning-support` normalizes to `machine-learning`. Other unknown category IDs do not filter the list
- `data/books.json`: Book/project filter definitions (manual). Tools are referenced by `id` (`dayNNN`), not slug
- `data/tools.json`: Auto-generated tool registry (do not edit manually)
- `repos.txt`: Master list of tool repositories
- `js/main.js`: All UI logic including filtering, progress tracking (localStorage), language switching, and X sharing
- `js/lang.js`: Decides the display language and whether "Start here" opens, before the first paint, and writes `<html lang>` and `<html data-start>`; tested by `test/lang.test.js`. The language order is `?lang=` (`ja` or `en`; case and spaces are ignored, other values too), then the language saved on this device (`localStorage` key `hlo_lang`), then Japanese. The browser language is not used. `js/main.js` saves the language only when JA/EN is pressed (through `js/storage.js`, so a blocked storage still switches the page) and keeps `?lang=en` in the URL while the page is in English (it is left out in Japanese, except that an opened `?lang=ja` stays). For "Start here", see "Start here" below
- `js/books.js`: Pure functions for the book/project filter (DOM-free); tested by `test/books.test.js`
- `js/search.js`: Pure functions for the keyword search (DOM-free); tested by `test/search.test.js`. Both the query and the tool text are normalized (NFKC, lower case); every space-separated word must match; a Day number (`Day12`, `day 12`) is padded to three digits and matches only that tool's id (a number of only zeros, such as `Day0` while typing `Day050`, is matched as plain text instead); the searched text is the id, title, subtitles, descriptions, tags and the categories shown on the card (`categories.json` ja/en and their `aliases_ja`/`aliases_en`, but not names that appear only in a tool README)
- `js/url.js`: Pure functions for URLs (DOM-free); tested by `test/url.test.js`. `readState()` reads the list state from the URL (`?book=`, `?cat=`, `?field=`, `?q=`, `?tab=dashboard`; books and categories that do not exist are ignored) and `buildUrl()` writes the fixed order `book`, `cat`, `field`, `q`, `tools`, `tab`, `lang` (only the given keys change; other parameters are kept after them; an empty query leaves no `?`; changing the book drops the `#book-group-…` hash). The progress filter is never put in the URL. `js/main.js` uses `?q=` and `?tab=dashboard` when the page opens, without waiting for the data: the search box gets the words of `?q=` (and is emptied when there is none) unless it already holds the same words or the user has started typing, and the dashboard tab opens; the box is not overwritten when the data arrives, so text typed meanwhile is kept. The book and the category are read when the data has loaded, and `commitUrl()` is called before the state changes. `readmeTarget()` returns a validated HEAD README URL and its actual language; `repoLink()` returns that URL for shared static generation. Optional `readme_usage.{ja,en}` contains heading/top/missing, with a raw fragment only for heading. Encode the fragment once; never accept a destination URL from metadata. Confirmed missing English opens the Japanese README top; absent or invalid metadata opens the requested language top. Card labels are Usage in English and 使い方 in Japanese, while the static list keeps GitHub README. `demoLink()` adds `?lang=en` only to an `ipusiron.github.io` demo in English; other hosts and Japanese links are unchanged. `withLang()` adds `?lang=en` in English to the "Start here" entries, the dashboard's book rows
- `js/storage.js`: Safe localStorage wrapper. Failed writes remain in a dirty map and take priority over disk reads; successful cached values are invalidated on deletion or storage events. `readFresh` distinguishes unavailable storage from an absent key; `setMemory` retains an import without writing unknown durable state.
- `js/records.js`: DOM-free local backup validation and merge decisions; tested by `test/records.test.js`. No uploads, dependencies, or custom JSON parser.
- `test/storage_records.test.js`: storage failure, file download/import and help/focus integration. The page helper explicitly models Blob downloads, file input and confirmation; it does not verify native file dialogs or screen reader output.
- `js/tabs.js`: Pure keyboard logic for the tabs (←/→/Home/End)
- `test/*.test.js` + `package.json`: `node --test`, no dependencies. `npm test` runs all twenty-one Node test files (the list is in `package.json`; add a new test file there too):
  - `books.test.js`: the real `data/books.json` and `data/tools.json` (D1–D15, S1), the category ids of `data/categories.json` and the ones used in `tools.json` (C1), and the pure functions in `js/books.js` on synthetic data (F1–F6)
  - `site.test.js`: `js/storage.js` and `js/tabs.js` (U1–U2); static checks of `index.html`, `js/main.js` and `css/style.css` (H1–H15: ARIA references, tabs, dialog, h1, CSP, no inline styles/scripts, help dialog, forced colors, reduced motion); the data loading rules (H16–H20, see "Loading data"); the search input, the filters and the list (H21–H24: no filtering while Japanese text is still being composed, searching with the text the browser put back in the field on Back or reload, the contrast of the placeholder and the field borders, and keeping the card width when only one tool matches); progress changed in another tab (H25); the list state in the URL, Back and Forward, and the "Start here" entries (H26–H28, see "Back and Forward"); the card links in English view (H29); remembering the chosen language (H30); where the focus goes when Back or Forward switches the tab (H31) and when the list, the book banner or the dashboard's book rows are rebuilt (H32, see "Back and Forward"); the header and the touch targets (H33–H36, see "Header and touch targets": the round "?" in `rem`, fixing the header only on wide and tall screens, 44px targets and their place after the "?" rule, and where the site title, the tabs and the dashboard numbers may break); what "Start here" remembers (H37, see "Start here"); the dashboard's share and reset buttons waiting for the data (H38)
  - `scroll_focus.test.js`: where jumps and focus stop under the header (0.5rem below the top of the screen where the header is not fixed), keeping the reading position when switching languages, and keeping the changed filter at the same height on screen (SF1–SF8); restoring the reading position with fixed and non-fixed headers by executing the restoration function (SF9)
  - `robust.test.js`: no layout shifts or freezes while loading on slow connections and devices (RB2: a "Start here" that starts closed is drawn closed from the first paint), reaching the footer when jumping to the end of the list, the view without JavaScript, and keeping the footer out of the middle of the screen when few tools match (RB1–RB8)
  - `search.test.js`: the pure functions in `js/search.js` on synthetic data (Q1–Q7) and on the real `data/tools.json` and `data/categories.json` (QD1–QD5: inputs that mean the same give the same tools; no fixed counts, and the words are taken from the data itself, such as its tags and category names, so regenerating `tools.json` alone does not break them)
  - `url.test.js`: the pure functions in `js/url.js` on small fixed data (UR1–UR2: reading the list state from the URL and writing it back; UR3: the card links in English view; UR4: `?lang=` in the URL)
  - `lang.test.js`: `js/lang.js` (LG1–LG2: the order that decides the language and reading the saved value; LG3: running the file as the browser does and writing `<html lang>`, also when storage is blocked; LG4: the order that decides whether "Start here" opens, and writing `<html data-start>`)
- The static checks read the source text of `index.html`, `js/main.js` and `css/style.css` (comments are ignored where it matters). When you rename a function, selector or id that a check names, update the check in the same change
- `index.html` has a meta CSP (`default-src 'none'`, everything else `'self'`). Do not add inline `<script>`, `style="..."` or `on*=` attributes; JS-set `element.style` is fine. Language display is driven by `<html lang>` + CSS (`.label-ja` / `.label-en`, and the pressed look of JA/EN); `js/lang.js` sets `<html lang>` (and `<html data-start>`, see "Start here") before the first paint, so do not put Japanese text in attributes that show before `js/main.js` runs (the search box placeholder is set by JS)

### Loading data (keep the first view fast)
On a slow mobile connection every extra round trip delays the cards by about 0.6 s, so keep these rules when adding data or scripts. `test/site.test.js` (H16–H20) checks them.
- Start every JSON the first view needs before the first `await` in `loadData()` (`js/main.js`). Required categories/tools use one `Promise.all`, bounded by a 20-second deadline through the completion of both JSON bodies. Abort requests and race the result against the deadline so an implementation that ignores abort cannot keep the page loading. Start optional books and category groups alongside them, catch each failure independently, and give both the same concurrent 3-second grace period after required data arrives; never wait six seconds in series. Malformed optional books are unavailable; malformed or empty required catalogs are failures. Do not fetch anything after awaiting the others.
- JSON that the first view does not need is fetched when its screen is opened, not in `loadData()`.
- Every `<script>` in `index.html` is in `<head>` (after the CSP meta and the stylesheet) and has `defer`, never `async`. The meta CSP stops Chromium's preload scanner, so without `defer` Chromium can fetch them one by one, each waiting for the one before (a round trip each on a slow connection); `defer` keeps the execution order books → search → storage → records → tabs → url → category_groups → share → main.
- The only exception is `js/lang.js`: it has no `defer` because it must set `<html lang>` and `<html data-start>` before the first paint (so a saved English never shows Japanese for a moment, and "Start here" is never drawn open and then closed). Keep it the last script, after the deferred ones, and keep `fetchpriority="high"` on the deferred ones. Put after `lang.js`, they may be found only after `lang.js` has arrived; without `fetchpriority="high"`, Chromium holds back deferred scripts in `<head>` while `lang.js` blocks the parser. Either way the cards came about one round trip later on a slow connection when measured with Chromium. Add no other script without `defer`.
- Compare loading times over HTTP/2, as GitHub Pages serves the site. A local HTTP/1.x server (`python -m http.server` speaks HTTP/1.0) lets Chromium open only six connections per host, so the stylesheet and deferred scripts can wait for connection slots there. Do not infer public loading time from that local queue.
- `data/tools.json` stays at or below 80 KB gzipped (127 tools were about 42 KB in November 2026). Going over is a signal to revisit how the list is loaded, or the limit; it is not a cap on the number of tools.
- After the first list render, `main.js` sets `performance.mark("hlo:cards-painted")` once, to check the timing in DevTools. The timing is never read back or sent anywhere.

### Header and touch targets
`test/site.test.js` (H33–H36) checks these rules.
- The header is fixed (`position: sticky`) only on screens at least 768px wide and more than 500px tall. On narrower or lower screens (`@media (max-width: 767.98px), (max-height: 500px)`) it scrolls away with the page, and `--header-h` is 0 there, so jumps and focus stop 0.5rem below the top of the screen. `applyHeaderHeightVar()` in `js/main.js` writes the header height only while the header is fixed (0 otherwise) and rewrites it when the header or the window is resized. The reading position kept when switching languages is measured from the top of the part of the screen that the header does not cover (`readingTop()`). Do not add `scroll-margin-top` to headings; the offset lives only in the `scroll-padding-top` of `html`
- Below 480px, JA/EN/? move to a row above the site title, and the title is 1.25rem
- On screens up to 767px wide and on touch devices (`pointer: coarse`), the buttons and links of the header, the tabs, the cards, the book banner, the dashboard and the footer are at least 2.75rem (44px) high, and JA/EN/?, the card buttons and the banner and footer links are also at least 2.75rem wide. The dashboard's book rows stay `inline-block` and get their height from padding (as flex items, the kind badge would get the link underline). Screens from 768px used with a mouse keep their compact buttons. That block comes after the `.header-controls .help-button` rule that keeps the "?" round in `rem` (1.75rem, `aspect-ratio: 1`); placed before it, the "?" stays 28px. The help dialog's close button is 2.75rem at every width
- The Japanese site title has `<wbr>` only after "・", with `word-break: keep-all` and `line-break: strict`, so it breaks only there. The dashboard numbers keep "定着済み0" and "（全44）" together, and below 360px the tabs have less side padding so that "学習ダッシュボード" stays on one line at 320px

### Start here
`test/lang.test.js` (LG4), `test/robust.test.js` (RB2) and `test/site.test.js` (H37) check these rules.
- "Start here" (`#start-here`) is open in the HTML. Whether it starts open is decided before the first paint: closed when the URL has `?book=` (other than empty or `all`), then the state remembered on this device (`localStorage` key `hlo_start_here`, `open` or `closed`), then by width (open from 768px, closed below). `js/lang.js` writes the first two as `<html data-start>`; without it, CSS and `js/main.js` use the width (`NARROW_MQ`). Until `js/main.js` sets the state and adds `js-ready`, CSS draws a "Start here" that starts closed with its content hidden, so nothing moves when it closes
- `js/main.js` remembers the state (through `js/storage.js`) when the user opens or closes it with its summary (a `click`; the `toggle` event also fires when JS sets `open`, so it is not used). It remembers `closed` when a visitor with nothing remembered starts using the list (an entry, a book from the select or the dashboard, or a progress choice). Only opening the page or looking at "Start here" remembers nothing

### Back and Forward
The list state is kept in the URL (`js/url.js`), and `js/main.js` decides when a change adds a history entry. `test/site.test.js` (H26–H28, H31–H32) checks these rules.
- Choosing a book (the select, the banner's Clear button, the "Start here" entries, a book row of the dashboard), choosing a category, or clicking a tab pushes one entry, so Back returns to the previous list. Changes of the same select within one second are merged into one entry (moving a select with the arrow keys changes it one step at a time). When the merged changes bring the URL back to what it was before the push, the pushed entry is taken off with `history.back()` (it stays as the Forward entry), so that one Back is not spent on an entry with the same list. That `popstate` does not rebuild the list, and changes made before it arrives are written to the URL once it has arrived.
- Typing in the search box, switching tabs with the arrow keys, jumping to a chapter and tidying the URL when the page opens replace the current entry. With no action, one Back still leaves the hub (for example, back to a book's support page).
- On Back and Forward (`popstate`), the list is rebuilt from the URL and the scroll position saved in `history.state` is restored. Only category/field canonicalization and the current language are written back there; preserve other URL parameters, including unknown book values used by notices. Before the data has loaded, only the tab and the search box follow the URL.
- When Back or Forward switches the tab and the focused element is left in the hidden panel (for example, Back after a book row of the dashboard opened the list), the focus moves to the element that was focused when `history.state` was last written for that entry (before the next entry was pushed, or when scrolling stopped; here the same book row), or else to the selected tab. When the focus is on the tab button that is no longer selected (for example, Back after a tab was chosen with Enter), it moves to the selected tab button. Neither move scrolls.
- When Back or Forward rebuilds the list or the book banner and the focused element was inside it, the focus moves to the element saved in that history entry (written right before the next entry was pushed or when scrolling stopped, such as the category select used to filter) when it is shown, because the restored scroll position is that entry's and the same element in the rebuilt list can be far off screen. The Start panel controls keep stable IDs; dynamically created book links have no focus key. Otherwise it moves to the same element in the rebuilt one (`focusKey()`: a card's progress, demo or Usage button of the same tool, preferring the same chapter; the book link, the Clear button, the jump-to-section toggle or a jump link of the same book's banner, where a jump link folded away on a narrow screen gives its toggle; an element with an id), or, if it is gone, to the first chapter heading of the list or the book title of the banner (if neither is shown, to the selected tab). The move does not scroll, and nothing moves when no element of the page had the focus (for example, after a click on an empty part of the page).
- The book links within "Start here" keep their `href`. Only a plain left click is handled in JS (no reload); clicks with Ctrl/⌘/Shift/Alt and middle clicks are left to the browser. The native "See all tools" button clears book/category/field/progress/search/set/hash through the existing history path; it does not depend on optional books.

## Commands

### Generate tools.json locally
```bash
python -m pip install PyYAML==6.0.3
python scripts/update_tools.py --check-demos --summary catalog-summary.md
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
- `scripts/update_tools.py` or `scripts/readme_usage.py` is modified
- `data/added.json` is modified
- Every Monday at 06:17 JST (the start may be delayed)
- Manually triggered via workflow_dispatch

`.github/workflows/test.yml` runs `npm run test:generator` (Python unittest, mocked network) and `npm test` on push to `main`, on pull requests, and after the tools.json regeneration (`workflow_run`). When a run is red, open the log and find the failing test's ID; its message says which rule broke and why:
- `D*` or `S1` (`books.test.js`), typically right after a regeneration: `data/books.json` refers to a tool id that is no longer in `tools.json`, or a book entry is broken. Fix `data/books.json`. If D1 reports a BOM in `tools.json`, fix `scripts/update_tools.py` instead. Never edit `tools.json` by hand
- `C1` (`books.test.js`): a category id in `data/categories.json` uses characters other than lower-case letters, digits and hyphens or appears twice, or `tools.json` has a category id that is not in `categories.json` (an id was renamed or removed without regenerating `tools.json`). Regenerate `tools.json` in the same change. If the change reached `main` without it, the regeneration workflow fixes it and the test run after it passes
- `H19` (`site.test.js`): `tools.json` grew past 80 KB gzipped. Revisit how the list is loaded, or the limit (see "Loading data"); it is not a reason to stop adding tools
- Any other ID (`F*`, `U*`, `UR*`, `LG*`, `H*`, `SF*`, `RB*`, `Q*`, `QD*`): a change to `index.html`, `js/` or `css/style.css` broke a rule. Fix the change, or update the check if the rule itself was changed on purpose

## Progress System

User progress is stored in browser localStorage with keys `progress_{slug}` containing values 0-3:
- 0: 未着手 / Not started
- 1: 学習中 / In progress
- 2: 一周完了 / First pass
- 3: 定着済み / Mastered

Each card uses a native select with four options (`0` through `3`), a visible Progress label and a tool-specific accessible name. A `change` writes the selected stage directly; unchanged or malformed values do not write. Keep the select and its options in place during local changes, cross-tab sync and record import so focus and the native control remain intact. Language-only list rendering retains outside cards and restores focus through the existing `data-part="progress"` key. Do not restore the old cycling click handler or hidden copies of all stage labels.

The shared four-stage explanation is static HTML in help (`help-progress`) and at the top of the dashboard (`progress-guide`, a closed native details). Rendering the dashboard or changing language must not replace this disclosure or reset its open state. Native progress selects stay at least 1rem and 44px tall at all widths; verify full selected text including the native arrow at 320px with 200% text, not just document overflow. `PS*` runtime tests cover the direct-choice contracts; actual OS pickers, touch and screen-reader output require separate manual testing.

When another tab of the same browser changes the progress, the open page redraws its progress selects and the dashboard (`storage` event, `setupProgressSync()` in `js/main.js`). The many events of a full reset are merged into one redraw, and the tool list itself is not rebuilt. The dashboard's book rows are rebuilt, so a focused row hands the focus to the same book's new row, without scrolling.

## Adding New Tools

1. Add repository URL to `repos.txt`
2. Ensure target repo has proper YAML frontmatter in README.md
3. Add any new categories to `data/categories.json` if needed
4. Push changes - CI will regenerate tools.json

## Adding a Book

1. Add an entry to `data/books.json` (see README「books.json（手動管理）」for fields)
2. Reference tools by `id` (`dayNNN`); every `id` must already exist in `tools.json`
3. If the book maps tools to chapters, add `chapters` and `refs`
4. Run `npm run build:pages`, then `npm test`. Include `data/books.json` and the generated `list.html` in the same PR; do not refetch tool READMEs or hand-edit `tools.json`.

## Catalog regeneration and first-listed dates

- `scripts/update_tools.py` reads README metadata with a timeout, trying `master` only after a 404 on `main`. Existing entries retain their previous valid metadata after an ordinary fetch or YAML failure; failures for a new repository stop generation. HTTP 401 stops all processing immediately with no output file changes.
- `repos.txt` is authoritative: removal and a valid `hub: false` are intentional. Reject empty or duplicate ids/slugs and non-HTTPS links before writing. Warn about unknown categories and missing/out-of-range difficulty; use null for invalid difficulty. Keep category order from the Japanese array, then the English array, with first-occurrence deduplication.
- `data/added.json` is an append-only mapping of tool id to the first listed JST date. Never reset existing dates or remove an entry. `scripts/init_added.py` initializes it once from first-parent Git history (visible tools only) and refuses to overwrite an existing file. The date describes presence in the main catalog, not the exact live deployment time. Normal updates fail if the stored dates are missing or invalid.
- An unchanged catalog keeps its existing `generated_at`. The update workflow serializes runs, checks out current main, uses PyYAML 6.0.3, validates before committing, rebases and validates again before pushing. The Step Summary includes tool and English-usage retention, confirmed missing English READMEs, category/difficulty warnings, slug changes and optional GET results for demos.
- `test/catalog.test.js` checks schema, raw category mappings and first-listed dates; `test/render.test.js` executes the real page scripts with a small DOM against all tools and books, including blocked storage. Unknown raw category names are warnings except for exact language/name pairs in `ignored_raw_names`. `AFTER_REGEN=1` also allows an empty mapped category list and invalid difficulty as warnings; structural and rendering errors still fail. PR checks reject lost mappings for previously recognized raw category names. The rendered card omits an unknown difficulty rather than displaying one star. `HLO_BASE_COMMIT` enables immutable-date comparisons; a base without added.json is allowed only for its initial introduction.
- Pages currently publishes from the main branch. GITHUB_TOKEN bot pushes do not start a Pages build, so successful scheduled regeneration guarantees the repository update only. Verify Pages deployment separately; do not claim automatic live publication from the update job alone.

### Color schemes

- Colors use semantic CSS custom properties. The dark palette follows `prefers-color-scheme: dark`; there is no theme storage or manual switch.
- Pie charts, legends, and progress bars share `--progress-n0` through `--progress-n3`. Keep CSS variables inside the inline gradient so an OS setting change updates an existing chart without rebuilding it.
- Check both palettes in browser QA, including native form controls, focus, progress states, the help dialog, and 200% text. Do not rely on `color-scheme` alone to set backgrounds and text.


### Tool links, sets, and the static list

- `js/url.js` normalizes tool ids and reads `#dayNNN` and all `tools` query parameters. Resolve against visible tools only, deduplicate in URL order, then keep at most 12. Never render raw unknown URL values. Keep missing, empty, unknown, and truncated sets distinct.
- Resolve a tool hash on initial load, hash navigation, and history navigation, not on every redraw. A known target must be visible: clear only conflicting filters, or clear a set if the target is outside it. On Back/Forward a saved reading position takes precedence over scrolling to the hash again. Card ids must be unique even when a book lists a tool in several chapters.
- Sets hide the normal filters, keep the supplied order, and put the position inside each card. Their details start closed. Clearing a set returns to all tools. Copy only validated tool ids and the current language; do not copy other query parameters, personal text, or progress. Clipboard rejection exposes a selectable URL and a visible status.
- `js/lang.js` also closes Start here before paint when `tools` is present. Do not save this automatic state as a user preference.
- `scripts/build_pages.js` uses `js/books.js` to generate `list.html` from the current tools and all books. Keep both languages visible without JavaScript, include book notes and introduction links, and use unique ids and escaped text. The generated page has no runtime JavaScript, inline styles, or generation timestamp. External links use HTTPS and `rel="noopener"` in a new tab.
- Regenerate with `npm run build:pages` after changing tools, books, or the generator. `test/static_list.test.js` rejects a stale generated file; do not automatically rebuild it in the test and hide an omitted change. A book-only PR must not trigger a full README fetch.
- The catalog update workflow generates the list before validation and again after rebasing. It commits the generated list together with the catalog. Existing Pages bot-push limitations still apply.
- `test/navigation.test.js` exercises URL-driven page behavior with the page harness. Browser QA remains necessary for hash position, history, focus, copy rejection, 320px/200% text, and blocked JavaScript. The static-list fallback is reachable from noscript, load failure, and the footer.

### Loading states, list counts, and retained progress cards

- `main-content[data-load-state]` is `loading`, `ready`, or `error`. Initial HTML disables all four filters and dashboard actions. Loading/error guidance and the retry button are outside tab panels, so initial dashboard URLs can recover. Retry reuses event setup, starts only one data attempt, ignores late results, and preserves the latest URL, search field and queued history. Restore focus from a removed retry control only when no intervening interaction or navigation has occurred. URL normalization by the successful attempt itself must not prevent focus recovery.
- The CSS-only 25-second guidance is for `main.js` not starting; reduced-motion must not suppress this deadline. Keep the bilingual noscript explanation and static-list links. No inline handlers, dependency, or extra runtime request is needed.
- `list-count` is visible but not live. Count unique public tool IDs, using the selected book or valid ordered set as the denominator. Update counts even when the list-render cache returns early. Keep the list heading visually hidden; chapter headings are h3 with h4 card titles, and flat cards use h3 below the list h2.
- Zero results include a 44px clear button. It retains the book, clears category/progress/search, commits one history entry and focuses the search input. `book-status` is the sole count/progress-outside live region: immediate category/progress updates, a 700ms search debounce, and a cancellable 50ms same-message reset. Cancel pending notifications on IME start and view/language/retry changes. Announce the all-tools sentence for an unfiltered full result and the zero-result explanation for no matches.
- A progress change retains displayed cards and marks tools outside the active progress condition. Synchronize all chapter copies but count an ID once. Reserve the label area when a progress filter is selected so adding the overlay does not move the card or its controls. Announce only newly marked tools; remove marks when they match again. Cross-tab updates follow the same rules. Set views ignore normal progress filters. A filter/history redraw re-evaluates current conditions. A language-only redraw retains the displayed IDs, including chapter duplicates and outside marks in the new language; it does not announce those marks again.
- `test/loading_filters.test.js` executes the actual page with controlled timers and fetch/JSON responses. It covers ignored abort, body stalls, optional failures, stale responses, retry/history/focus, counts, zero-result clearing, duplicate progress cards, cross-tab updates, and notification cancellation. The harness models event dispatch and DOM behavior explicitly; it is not a layout engine or a screen reader. Actual assistive-technology speech and real-device manual interaction remain unverified by these tests and require separate QA.


### Local progress backup

The dashboard records controls are disabled until the required catalog is ready. Keep them outside the dashboard containers rebuilt by progress updates. A file contains `app`, `schema_version`, `saved_at` (canonical UTC ISO), and a flat `progress` object keyed by known catalog Day IDs. Use the whole public catalog (`hub !== false`), independently of book/search/progress/set filters. Export only nonzero effective progress; do not enumerate unrelated localStorage keys. Accept at most 65,536 UTF-8 bytes and 1,000 entries. Validate before confirmation or any progress writes, use native JSON.parse duplicate-key semantics, and ignore only well-formed unknown Day IDs.

Confirm once for the fixed candidate set. After acceptance, yield through two nested zero-delay timer tasks before comparing effective and freshly read durable progress. Native confirm delayed storage visibility in Chromium: a synchronous read or microtask saw old values, and one timer exposed only part of a queued cross-tab update. These two opportunities are measured mitigation, not an acknowledgement that all storage events have arrived or a transaction guarantee. Keep the confirmed candidate set and busy guard throughout both tasks. Preserve higher local values and never expand the candidates. An unreadable durable value must be kept in memory only, because writing it could downgrade hidden disk progress. Partial write failures stay effective and can be exported. This is not a cross-tab transaction or compare-and-swap guarantee. Ordinary progress changes/reset continue to set the chosen level directly.

Show the storage warning once per page, preserve its dismissed state, and use the existing help dialog to reach `#help-storage` and return focus. Keep the current-language record status in one live region; avoid assigning identical text repeatedly. Blob download success means initiation only: do not update the date or announce success when initiation throws, and never expose file names or exception details in status messages. Native save completion, real OS file-picker behavior, long-term Safari storage policy and actual screen-reader announcements remain manual verification boundaries.

### Book view and chapter navigation
- `kind: "series"` remains the data value for a project. Public labels say Project/Projects; do not rename slugs, chapter keys or tool memberships for a wording change.
- Chapter `title_ja`/`title_en` are an optional validated pair. `chapterTitle` uses them for group headings, jump links and the generated static list. `chapterLabel` and `formatRef` keep short card references.
- Narrow meaningful book arrivals collapse filters before paint using `lang.js` and `data-book-arrival`. Sets (including empty or unknown sets) and day hashes take precedence. The disclosure preference, wide-screen visibility and set exclusion are separate; resize must not hide a focused field. All filter focus paths reveal it first, with search as the fallback if books are unavailable.
- Chapter jumps start closed at every width and retain state for the same book. Back-to-sections opens/focuses the summary without changing URL/history. Existing chapter IDs and replaceState navigation remain stable. The static end-of-list Back-to-filters button opens the filter region, scrolls it below the header and focuses its first usable field without changing the URL/history. Its triangle is decorative; hide the button while loading, on error, or while a valid set excludes filters.
- The banner total is the unique full-book target. Duplicate notes count actual retained DOM cards against their unique IDs. Local progress, storage events and imports update metadata without replacing cards or banner controls.
- Unknown-book and unavailable-books notices apply only after set/hash precedence. Keep other filters and omit the all-tools sentence when it is false. A normal visible section supplies one message to the existing `book-status`; do not add a second live region or repeat it during ordinary progress redraws. Explicit filter changes instead announce the resulting count/empty state once. Empty-result clear reveals and scrolls the search field into view; history focus restoration still preserves the saved reading position.
- `test/book_view.test.js` executes these contracts with the page harness. First-paint geometry, native keyboard behavior, browser accessibility trees and actual screen-reader announcements require browser/manual verification; Node does not establish them.

### Start panels and help

- Start with three tools, Browse by book and See all tools are native buttons. Panel choice changes neither URL nor history, keeps the control focused and leaves the current Start disclosure open. First use records only the next visit's closed preference. The first-three panel is initially selected; the book names are hidden until the book action is chosen. Panel choice is visit-local, with no new storage key. Language changes update existing links without recreating them or resetting the selected panel.
- Required catalog loading/error disables the entry buttons and starter demo links. Optional-book failure disables only Browse by book; the first three and all-tools action stay usable. Day003, Day008 and Day034 demo URLs come from the public catalog and use `demoLink` for the current language. New tabs have `noopener`. Missing or hidden catalog tools never acquire a demo link.
- The closed-summary hint follows the same pre-paint width/saved/book decision as the Start body. If main never starts, collapse the hint when the body becomes visible at 25 seconds; do not rely on animating display or suppress this deadline for reduced motion. Keep the existing `lang.js` decision and summary click persistence intact. The Start storage sentence uses the actual storage-failure flag, including failures after initial load.
- Help has eight ordered sections: usage, stuck, progress, records, list, keyboard, approach and administrator. Preserve `help-progress`, `help-storage`, modal focus trapping, Escape/close focus return and the storage-notice deep link. For every modal Tab or Shift+Tab, prevent the native default and explicitly move through the currently visible, enabled focusable elements; endpoint-only wrapping fails when native Tab skips links. From the dialog or a section heading, use the first or last eligible element according to direction. Progress guidance stays identical to the dashboard guide. Keep biography facts and external destinations when rearranging sections.
- Search Escape prevents the native search-clear default and applies the normal search replacement/debounce path. During composition, `isComposing`, keyCode 229 and an Escape-only session guard prevent clearing; composition end and blur clear the guard. Ordinary input filtering still relies on each input event, so a missed composition end cannot permanently stop search.
- `test/start_help.test.js` executes initial/saved states, panel focus/history, optional/required data failure and retry, catalog links, storage failure, help structure, modal Tab cycling/focus return and Escape/IME event sequences. It does not establish first-paint geometry, actual OS IME behavior, real Safari keyboard settings or screen-reader speech; browser and manual checks remain separate.


### Card names, dates and recovery

- Card headings keep their visible tool names and include DayNNN in their accessible names; the separate Day badge is decorative. Demo/GitHub names include the tool and new-tab behavior without changing language-aware destinations. Valid integer difficulty 1–5 uses five filled/empty stars with one numeric accessible name; invalid/missing difficulty remains omitted.
- Base document titles follow the selected language. Preserve the existing set/day context titles; do not introduce book/category/dashboard title variants. Discovery metadata remains static Japanese with the root canonical and existing local icon.
- Format the catalog's actual generated_at date in Asia/Tokyo and reformat on language changes. Missing, ambiguous or invalid timestamps use the existing placeholder; never substitute today's date. The required catalog schema remains unchanged.
- X share text counts the resolved selected book/project or the whole public catalog, independently of category/search/progress filters. Sets use the whole catalog. Tests inspect the constructed intent URL without posting.
- 404.html is standalone, bilingual and script-free. Keep root-absolute assets/links, real book slugs, noindex and the restrictive CSP. Test keyboard use and nested-path asset resolution; a local successful response is not proof of the deployed HTTP404 status.
- test/presentation.test.js covers contextual titles/history, timezone/date validity, share payloads, literal accessible names, metadata and recovery contracts. Browser accessibility trees, actual screen-reader speech and deployed error responses require separate checks.


### Category fields and metadata

- `data/categories.json` is the normalization/search mapping. Keep former canonical names as aliases exactly once; `learning-support` URLs resolve to `machine-learning`. Do not invent aliases for unmatched raw names.
- `data/category_groups.json` has version 1, seven groups, 21 bilingual category descriptions and 36 exact language/name ignore entries. `js/category_groups.js` and `scripts/category_groups.py` enforce matching property/type/trim/duplicate/reference rules; the shared fixture includes Unicode whitespace and numeric version boundaries. Validate before any generator fetch or output write. The runtime treats failed/invalid group data as optional and retains the usable required catalog with flat choices.
- The native category select uses `field:<id>` for field-wide options and category IDs for individual options. Fields use `?field=`, categories use `?cat=`. A valid category wins; otherwise a valid field applies. Canonicalize only these keys with replace during history restoration, preserving unknown-book notices and other filters. Sets, Day links, empty-result clear and See all tools include field state in their existing precedence rules.
- Hide unused category choices except the current valid URL-selected category; keep that choice through language/history so the condition is visible and can be cleared. Ungrouped populated categories such as visualization remain reachable. Count field unions by unique tool ID.
- `#category-guidance` is one ordinary text block, with no extra live region. It shows the selected field or a supported category description; zero-result guidance and sets take priority. Refresh it on the cached-list path as well. Keep outside progress cards, duplicates and focused controls through existing synchronization paths.
- `test/category_groups.test.js`, the shared metadata fixture and `test/test_category_groups.py` cover field UI/URLs/history, optional deadlines/stale responses, exact ignored names, strict aliases and pre-fetch rejection. Browser layout, OS-native menus and actual screen-reader speech remain separate verification boundaries.


### Selection-aware progress sharing

- `js/share.js` is DOM/storage-independent. `summarizeProgress` counts unique visible IDs, with optional target IDs and effective integer0..3 values; worked means2+3, mastered means3. `buildShare` formats approved text and constructs a new canonical `https://hackinglab.online/` URL containing only a resolved book slug and English `lang=en`. No current URL, filters, progress values or tracking parameters enter it.
- Main resolves the current book after set/hash precedence, expands its public unique targets and reads `getProgress` so dirty memory is included. No selected book (including a set or unavailable optional books) shares the whole public catalog. Category/field/search/progress filters never change share counts. Related books use related-tool wording; series use ordinary selected wording. Zero worked uses the same nonnumeric sentence in either scope, while a selected URL/note remains.
- The dashboard's static share controls hold a selected-scope note, one X button, one URL-only Copy link button, one status region and one readonly manual-copy field. Progress sync/import/reset redraws never replace them. Copy fallback and selected text persist when the URL does not change; scope/language changes clear stale feedback and rescue an active fallback to the copy button. Async clipboard results are guarded by generation, scope, navigation, interaction, focus, active tab and ready state. A focus event on the manual field schedules one guarded animation-frame correction to stop an earlier smooth scroll and reveal the field with nearest alignment, preserving its selected text. New interactions, focus, navigation or scope invalidate this correction. Clipboard absence/rejection uses the manual field; no extra permissions, execCommand or OS-share API.
- Sharing remains disabled until required data is ready; optional books failure uses whole-catalog sharing. Only a user activating X opens its intent, never a background request or automatic post. Tests capture the intent with an explicit popup spy while the default integration harness still rejects unexpected popups. Pure and runtime coverage lives in `test/share.test.js` and `test/sharing.test.js`; native clipboard permission prompts and real screen-reader output require separate testing.

### README usage links and decorative icons

- `scripts/readme_usage.py` separates heading parsing, visible text, duplicate slug allocation and semantic selection. It is a bounded parser, not a full GitHub renderer. Unsupported or uncertain syntax falls back to the README top. Keep code spans protected from comment stripping and bound nested inline parsing. Unicode categories vary between Python versions; do not make tests depend on a particular character being unassigned.
- `readme_usage` is generated from fetched bodies, not YAML. Successful extraction with no matching heading replaces an old fragment with top. A Japanese metadata failure retains the whole old tool and does not fetch English. Recoverable English failure preserves only a valid old English entry; both branch 404s mean missing, while 401 at either language/branch stops all output changes and further requests.
- `test/test_readme_usage.py` covers the parser; `test/test_usage_pipeline.py` covers fetch and retention boundaries. `test/usage_links.test.js` covers safe URLs, invalid optional data, language fallback, duplicate card progress/focus, and static-list consistency. Keep the catalog validator strict while the page tolerates absent or invalid optional metadata.
- Only card Demo/Usage links get the decorative currentColor SVG. Its explicit shaft ends at the polygon arrowhead base; no SVG marker, external asset, accessible name or keyboard focus. Keep Start, help, banner, footer and static-list links free of this icon. Verify small and enlarged views, narrow 44px targets and 200% text. Real OS pickers and screen readers remain separate manual checks.
- HEAD links can change after catalog generation. Mocked tests and cached observations do not prove every current GitHub renderer or every future heading. A CI regeneration with the current runtime must be checked for semantic changes.
