// js/main.js

// グローバル状態
let currentLang = "ja"; // "ja" | "en"
let tools = [];
let categories = [];
let books = [];
let filters = {
  book: "",
  categoryId: "",
  progress: "all",
  search: ""
};

// 書籍フィルターの純関数（js/books.js）。読み込めていなければ null として退避する。
const HB = typeof HLOBooks !== "undefined" ? HLOBooks : null;
// いま選択中の本の対象 id 集合（renderToolList / setBookFilter で更新）。
let bookTargetSet = null;

const PROGRESS_LABELS = {
  ja: ["未着手", "学習中", "一周完了", "定着済み"],
  en: ["Not started", "In progress", "First pass", "Mastered"]
};

document.addEventListener("DOMContentLoaded", () => {
  setupStaticUI();
  setupHelpModal();
  loadData();
});

// ---- 初期セットアップ（イベントハンドラなど） ----

function setupStaticUI() {
  // 年の表示
  const yearSpan = document.getElementById("current-year");
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  // 言語切替
  const langJaBtn = document.getElementById("lang-ja");
  const langEnBtn = document.getElementById("lang-en");

  langJaBtn?.addEventListener("click", () => {
    currentLang = "ja";
    updateLanguageUI();
    setupFilterOptions(); // ラベルが変わるのでフィルターも再生成
    renderAll();
  });

  langEnBtn?.addEventListener("click", () => {
    currentLang = "en";
    updateLanguageUI();
    setupFilterOptions();
    renderAll();
  });

  // タブ切替
  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab-target");
      switchTab(targetId);
    });
  });

  // フィルター
  const bookSelect = document.getElementById("filter-book");
  const categorySelect = document.getElementById("filter-category");
  const progressSelect = document.getElementById("filter-progress");
  const searchInput = document.getElementById("filter-search-input");

  bookSelect?.addEventListener("change", (e) => {
    setBookFilter(e.target.value);
  });

  categorySelect?.addEventListener("change", (e) => {
    filters.categoryId = e.target.value;
    renderToolList();
  });

  progressSelect?.addEventListener("change", (e) => {
    filters.progress = e.target.value;
    renderToolList();
  });

  searchInput?.addEventListener("input", (e) => {
    filters.search = e.target.value.toLowerCase();
    renderToolList();
  });

  // X共有ボタン
  const shareBtn = document.getElementById("share-on-x");
  shareBtn?.addEventListener("click", handleShareOnX);

  // 全体リセット
  const resetBtn = document.getElementById("reset-all-progress");
  resetBtn?.addEventListener("click", handleResetAllProgress);

  // はじめ方は既定で開く（HTML）。狭い画面では初期表示を圧迫しないよう畳む
  const startHere = document.getElementById("start-here");
  if (startHere && window.innerWidth < 768) startHere.open = false;

  updateLanguageUI();
}

// ---- ヘルプモーダル ----

function setupHelpModal() {
  const helpModal = document.getElementById("help-modal");
  const helpButton = document.getElementById("help-button");
  const helpClose = document.getElementById("help-close");

  if (!helpModal) return;

  // 念のため初期状態で隠しておく
  helpModal.hidden = true;

  helpButton?.addEventListener("click", () => {
    helpModal.hidden = false;
  });

  helpClose?.addEventListener("click", () => {
    helpModal.hidden = true;
  });

  // オーバーレイ部分クリックで閉じる
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) {
      helpModal.hidden = true;
    }
  });
}

// ---- データ読み込み ----

async function loadData() {
  try {
    const [catRes, toolsRes] = await Promise.all([
      fetch("./data/categories.json"),
      fetch("./data/tools.json")
    ]);

    if (!catRes.ok || !toolsRes.ok) {
      console.warn("Failed to load JSON files");
      return;
    }

    categories = await catRes.json();
    const toolsJson = await toolsRes.json();
    tools = Array.isArray(toolsJson.tools) ? toolsJson.tools : [];

    // 更新日時
    const lastUpdatedEl = document.getElementById("last-updated-value");
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = toolsJson.generated_at || "-";
    }

    // 書籍データ（自己完結した読み込み。失敗してもハブは従来どおり動く）
    books = [];
    try {
      const bRes = await fetch("./data/books.json");
      if (bRes.ok) {
        const bJson = await bRes.json();
        if (bJson && Array.isArray(bJson.books)) books = bJson.books;
      }
    } catch (e) {
      // 無視（no-books として続行）
    }
    if (!HB) console.warn("books.js not loaded; book filter disabled");
    applyBooksAvailability();

    // ?book= の解決（存在しない slug は無視。表記違いのときだけ正規形へ直す）
    if (HB && books.length) {
      const slug = HB.resolveBookParam(window.location.search, books);
      if (slug) {
        filters.book = slug;
        let rawBook = null;
        try {
          rawBook = new URLSearchParams(window.location.search).get("book");
        } catch (e) {
          /* 無視 */
        }
        if (rawBook !== slug) {
          try {
            window.history.replaceState(
              null,
              "",
              HB.buildUrlWithBook(window.location.href, slug)
            );
          } catch (e) {
            /* file:// などでは無視 */
          }
        }
      }
    }

    applyHeaderHeightVar();
    setupFilterOptions();
    renderAll();
    maybeScrollToHash();
  } catch (err) {
    console.error("Error loading data:", err);
  }
}

// books.json の有無でUIを出し分ける。
function applyBooksAvailability() {
  const haveBooks = !!(HB && Array.isArray(books) && books.length > 0);
  const filtersEl = document.getElementById("tool-filters");
  const bookGroup = document.getElementById("filter-book-group");
  const dashBooks = document.getElementById("dashboard-books");
  if (filtersEl) filtersEl.classList.toggle("no-books", !haveBooks);
  if (bookGroup) bookGroup.hidden = !haveBooks;
  if (!haveBooks) {
    if (dashBooks) dashBooks.hidden = true;
    filters.book = "";
    if (!Array.isArray(books)) books = [];
  }
}

// 固定ヘッダーの高さを CSS 変数 --header-h に書き、章ジャンプのスクロール位置に使う。
function applyHeaderHeightVar() {
  const header = document.getElementById("site-header");
  if (!header) return;
  const set = () =>
    document.documentElement.style.setProperty(
      "--header-h",
      header.offsetHeight + "px"
    );
  set();
  try {
    new ResizeObserver(set).observe(header);
  } catch (e) {
    window.addEventListener("resize", set);
  }
}

// #book-group-<key> のハッシュがあればそこへスクロールする。
function maybeScrollToHash() {
  const h = window.location.hash;
  if (!h || h.indexOf("#book-group-") !== 0) return;
  const el = document.getElementById(h.slice(1));
  if (el) {
    try {
      el.scrollIntoView();
    } catch (e) {
      /* 無視 */
    }
  }
}

// ---- UIレンダリング全体 ----

function renderAll() {
  renderToolList();
  renderDashboard();
}

// ---- 言語切替の表示制御 ----

function updateLanguageUI() {
  const isJa = currentLang === "ja";

  // JA/EN ラベル切替
  document.querySelectorAll(".label-ja").forEach((el) => {
    el.style.display = isJa ? "" : "none";
  });
  document.querySelectorAll(".label-en").forEach((el) => {
    el.style.display = isJa ? "none" : "";
  });

  // サイトタイトル
  const titleJa = document.getElementById("site-title-ja");
  const titleEn = document.getElementById("site-title-en");
  if (titleJa && titleEn) {
    titleJa.style.display = isJa ? "" : "none";
    titleEn.style.display = isJa ? "none" : "";
  }

  // 言語ボタン
  const langJaBtn = document.getElementById("lang-ja");
  const langEnBtn = document.getElementById("lang-en");
  if (langJaBtn && langEnBtn) {
    if (isJa) {
      langJaBtn.disabled = true;
      langEnBtn.disabled = false;
    } else {
      langJaBtn.disabled = false;
      langEnBtn.disabled = true;
    }
  }

  // 検索プレースホルダ
  const searchInput = document.getElementById("filter-search-input");
  if (searchInput) {
    searchInput.placeholder = isJa
      ? "タイトル・説明・タグで検索"
      : "Search by title / description / tags";
  }
}

// ---- タブ切替 ----

function switchTab(targetId) {
  const panels = document.querySelectorAll(".tab-panel");
  panels.forEach((panel) => {
    panel.hidden = panel.id !== targetId;
  });

  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach((btn) => {
    const target = btn.getAttribute("data-tab-target");
    btn.setAttribute("aria-selected", target === targetId ? "true" : "false");
  });
}

// ---- フィルターの選択肢セットアップ ----

function setupFilterOptions() {
  const bookSelect = document.getElementById("filter-book");
  const categorySelect = document.getElementById("filter-category");
  const progressSelect = document.getElementById("filter-progress");

  if (bookSelect) {
    bookSelect.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = currentLang === "ja" ? "すべて" : "All";
    bookSelect.appendChild(optAll);

    if (HB && Array.isArray(books) && books.length) {
      const addGroup = (kind, labelJa, labelEn) => {
        const list = books.filter((b) => b.kind === kind);
        if (!list.length) return;
        const og = document.createElement("optgroup");
        og.label = currentLang === "ja" ? labelJa : labelEn;
        list.forEach((b) => {
          const opt = document.createElement("option");
          opt.value = b.slug;
          opt.textContent = HB.bookLabel(b, currentLang);
          og.appendChild(opt);
        });
        bookSelect.appendChild(og);
      };
      addGroup("book", "書籍", "Books");
      addGroup("series", "シリーズ", "Series");
    }

    // 言語切替などで作り直したあとも選択を保つ
    bookSelect.value = filters.book;
  }

  if (categorySelect) {
    categorySelect.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = currentLang === "ja" ? "すべて" : "All";
    categorySelect.appendChild(optAll);

    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = currentLang === "ja" ? cat.ja : cat.en;
      categorySelect.appendChild(opt);
    });

    categorySelect.value = filters.categoryId;
  }

  if (progressSelect) {
    progressSelect.innerHTML = "";

    const optAll = document.createElement("option");
    optAll.value = "all";
    optAll.textContent = currentLang === "ja" ? "すべて" : "All";
    progressSelect.appendChild(optAll);

    const labels = PROGRESS_LABELS[currentLang];
    labels.forEach((label, level) => {
      const opt = document.createElement("option");
      opt.value = String(level);
      opt.textContent = label;
      progressSelect.appendChild(opt);
    });

    progressSelect.value = filters.progress;
  }
}

// ---- 書籍フィルターの操作 ----

function currentBook() {
  if (!filters.book || !HB || !Array.isArray(books)) return null;
  return books.find((b) => b.slug === filters.book) || null;
}

function refreshBookTarget() {
  const book = currentBook();
  bookTargetSet = book ? HB.expandTargetIds(book, tools) : null;
}

// https:// のURLだけを許す（data由来のリンクのスキーム検証）。
function isHttpUrl(u) {
  return typeof u === "string" && /^https:\/\//i.test(u);
}

// 本の種別の札（書籍／シリーズ／関連ツール）。
function bookKindLabel(book) {
  const isJa = currentLang === "ja";
  if (book.relation === "related") {
    return isJa ? "関連ツール" : "Related tools (book in Japanese)";
  }
  if (book.kind === "series") return isJa ? "シリーズ" : "Series";
  return isJa ? "書籍" : "Book (in Japanese)";
}

// 件数の括弧を言語ごとに出し分ける（日本語は全角、英語は半角＋スペース）。
function countSuffix(n) {
  return currentLang === "ja" ? `（${n}）` : ` (${n})`;
}

// 本を選ぶ/外す。URL・select・読み上げを更新して再描画する。
function setBookFilter(slug, opts) {
  filters.book = slug || "";
  const sel = document.getElementById("filter-book");
  if (sel) sel.value = filters.book;
  // URL を更新する。本を切り替え/解除したら、前の本の章ジャンプのハッシュは外す。
  try {
    const u = new URL(window.location.href);
    if (filters.book) u.searchParams.set("book", filters.book);
    else u.searchParams.delete("book");
    if (u.hash.indexOf("#book-group-") === 0) u.hash = "";
    window.history.replaceState(null, "", u.toString());
  } catch (e) {
    /* 無視 */
  }
  refreshBookTarget();
  updateBookStatus(filters.book, opts && opts.cleared);
  renderToolList();
}

// スクリーンリーダー向けの状態通知（本の選択・解除のときだけ更新）。
function updateBookStatus(slug, cleared) {
  const el = document.getElementById("book-status");
  if (!el) return;
  if (slug) {
    const book = currentBook();
    const name = book ? HB.bookTitle(book, currentLang) : slug;
    const n = bookTargetSet ? bookTargetSet.size : 0;
    el.textContent =
      currentLang === "ja"
        ? `『${name}』で絞り込み中。該当${n}本。`
        : `Filtered by "${name}": ${n === 1 ? "1 tool" : n + " tools"}.`;
  } else if (cleared) {
    el.textContent =
      currentLang === "ja"
        ? "書籍の絞り込みを解除しました。"
        : "Book filter cleared.";
  } else {
    el.textContent = "";
  }
}

// ---- ツール一覧の描画 ----

function renderToolList() {
  const listEl = document.getElementById("tool-list");
  if (!listEl) return;

  listEl.innerHTML = "";
  refreshBookTarget();
  const book = currentBook();

  const baseMatch = (t) =>
    t.hub !== false &&
    filterByBook(t) &&
    filterByCategory(t) &&
    filterByProgress(t) &&
    filterBySearch(t);

  const matched = tools.filter(baseMatch);
  const matchedIds = new Set(matched.map((t) => t.id));

  // chapters を持つ本は、章の順にグループ分けして見出しを挟む
  let displayGroups = null;
  if (book && Array.isArray(book.chapters) && book.chapters.length && HB) {
    displayGroups = HB.buildGroups(book, tools)
      .map((g) => ({
        key: g.key,
        label_ja: g.label_ja,
        label_en: g.label_en,
        items: g.items.filter((t) => matchedIds.has(t.id))
      }))
      .filter((g) => g.items.length);
  }

  renderBookBanner(book, matched.length, displayGroups);

  if (displayGroups) {
    if (!displayGroups.length) {
      appendEmptyState(listEl, book);
      return;
    }
    displayGroups.forEach((g) => {
      const h = document.createElement("h3");
      h.className = "book-group-heading";
      h.id = `book-group-${g.key}`;
      h.tabIndex = -1;
      const label = currentLang === "ja" ? g.label_ja : g.label_en;
      h.textContent = `${label}${countSuffix(g.items.length)}`;
      listEl.appendChild(h);
      g.items.forEach((tool) => listEl.appendChild(createToolCard(tool, book)));
    });
    return;
  }

  if (matched.length === 0) {
    appendEmptyState(listEl, book);
    return;
  }

  matched.forEach((tool) => {
    listEl.appendChild(createToolCard(tool, book));
  });
}

function appendEmptyState(listEl, book) {
  const p = document.createElement("p");
  if (book) {
    const label = HB ? HB.bookLabel(book, currentLang) : "";
    p.textContent =
      currentLang === "ja"
        ? `「${label}」の中に、ほかの条件に一致するツールがありません。`
        : `No tools from "${label}" match the other filters.`;
  } else {
    p.textContent =
      currentLang === "ja"
        ? "条件に一致するツールがありません。"
        : "No tools match the current filters.";
  }
  listEl.appendChild(p);
}

// 選択中の本のバナー（札・書名・件数・リンク・解除・注記・章ジャンプ）。
function renderBookBanner(book, shownCount, displayGroups) {
  const banner = document.getElementById("book-banner");
  if (!banner) return;
  if (!book) {
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  banner.hidden = false;
  banner.innerHTML = "";
  const isJa = currentLang === "ja";
  const n = bookTargetSet ? bookTargetSet.size : 0;

  // 種別の札
  const badge = document.createElement("span");
  badge.className = "book-banner-badge";
  badge.textContent = bookKindLabel(book);
  banner.appendChild(badge);

  // 書名
  const h2 = document.createElement("h2");
  h2.id = "book-banner-title";
  h2.className = "book-banner-title";
  h2.tabIndex = -1;
  h2.textContent = HB.bookTitle(book, currentLang);
  if (!isJa && book.title_ja) {
    const sub = document.createElement("span");
    sub.className = "book-banner-subtitle";
    sub.lang = "ja";
    sub.textContent = book.title_ja;
    h2.appendChild(document.createTextNode(" "));
    h2.appendChild(sub);
  }
  banner.appendChild(h2);

  // メタ行（件数・リンク・解除）
  const meta = document.createElement("div");
  meta.className = "book-banner-meta";

  const count = document.createElement("span");
  count.className = "book-banner-count";
  const unit = isJa ? `${n}本` : n === 1 ? "1 tool" : `${n} tools`;
  const hit = isJa ? `該当 ${unit}` : `${unit}`;
  count.textContent =
    shownCount !== n
      ? isJa
        ? `${hit}（表示中 ${shownCount}本）`
        : `${hit} (${shownCount} shown)`
      : hit;
  meta.appendChild(count);

  if (isHttpUrl(book.url)) {
    const link = document.createElement("a");
    link.className = "book-banner-link";
    link.href = book.url;
    link.rel = "noopener";
    link.textContent = isJa
      ? book.url_label_ja || "紹介ページを開く"
      : book.url_label_en || "Open book page";
    meta.appendChild(link);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "book-banner-clear";
  clearBtn.textContent = isJa ? "解除" : "Clear";
  clearBtn.setAttribute("aria-label", isJa ? "書籍の絞り込みを解除" : "Clear book filter");
  clearBtn.addEventListener("click", () => {
    setBookFilter("", { cleared: true });
    const sel = document.getElementById("filter-book");
    if (sel) sel.focus();
  });
  meta.appendChild(clearBtn);

  banner.appendChild(meta);

  // 注記
  const noteText = isJa ? book.note_ja : book.note_en;
  if (noteText) {
    const note = document.createElement("p");
    note.className = "book-banner-note";
    note.textContent = noteText;
    banner.appendChild(note);
  }
  const hasPages = displayGroups && book.refs
    ? Object.keys(book.refs).some((k) =>
        (book.refs[k] || []).some((r) => Array.isArray(r.pages) && r.pages.length)
      )
    : false;
  const pagesNote = isJa ? book.pages_note_ja : book.pages_note_en;
  if (hasPages && pagesNote) {
    const pn = document.createElement("p");
    pn.className = "book-banner-note book-banner-pages-note";
    pn.textContent = pagesNote;
    banner.appendChild(pn);
  }

  // 章ジャンプ（章が2つ以上あるときだけ。畳んでおく）
  if (displayGroups && displayGroups.length >= 2) {
    const details = document.createElement("details");
    details.className = "book-jump";
    if (window.matchMedia && window.matchMedia("(min-width: 768px)").matches) {
      details.open = true;
    }
    const summary = document.createElement("summary");
    summary.textContent = isJa
      ? `章へ移動${countSuffix(displayGroups.length)}`
      : `Jump to section${countSuffix(displayGroups.length)}`;
    details.appendChild(summary);
    displayGroups.forEach((g) => {
      const a = document.createElement("a");
      a.className = "book-jump-link";
      a.href = `#book-group-${g.key}`;
      const label = isJa ? g.label_ja : g.label_en;
      a.textContent = `${label}${countSuffix(g.items.length)}`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(`book-group-${g.key}`);
        if (target) {
          target.scrollIntoView();
          target.focus();
        }
        try {
          window.history.replaceState(null, "", "#book-group-" + g.key);
        } catch (err) {
          /* 無視 */
        }
      });
      details.appendChild(a);
    });
    banner.appendChild(details);
  }
}

function filterByBook(tool) {
  if (!filters.book) return true;
  if (!bookTargetSet) return true; // 本が解決できないときは絞らない
  return bookTargetSet.has(tool.id);
}

function filterByCategory(tool) {
  if (!filters.categoryId) return true;
  const ids = tool.category_ids || [];
  return ids.includes(filters.categoryId);
}

function filterByProgress(tool) {
  if (filters.progress === "all") return true;
  const level = getProgress(tool.slug);
  return String(level) === filters.progress;
}

function filterBySearch(tool) {
  if (!filters.search) return true;
  const q = filters.search;

  const textParts = [
    tool.id || "",
    tool.title || "",
    tool.subtitle_ja || "",
    tool.subtitle_en || "",
    tool.description_ja || "",
    tool.description_en || "",
    ...(tool.tags || [])
  ];

  const text = textParts.join(" ").toLowerCase();
  return text.includes(q);
}

function createToolCard(tool, book) {
  const card = document.createElement("article");
  card.className = "tool-card";

  const header = document.createElement("div");
  header.className = "tool-card-header";

  const daySpan = document.createElement("span");
  daySpan.className = "tool-day";
  const dayNumber = tool.id?.startsWith("day")
    ? tool.id.slice(3)
    : tool.id || "";
  daySpan.textContent = `Day${dayNumber}`;

  const titleSpan = document.createElement("span");
  titleSpan.className = "tool-title";
  titleSpan.textContent = tool.title || "";

  header.appendChild(daySpan);
  header.appendChild(titleSpan);

  const subtitle = document.createElement("div");
  subtitle.className = "tool-subtitle";
  subtitle.textContent =
    currentLang === "ja" ? tool.subtitle_ja || "" : tool.subtitle_en || "";

  const desc = document.createElement("div");
  desc.className = "tool-description";
  desc.textContent = getShortDescription(tool);

  const meta = document.createElement("div");
  meta.className = "tool-meta";

  const diffSpan = document.createElement("span");
  diffSpan.className = "tool-difficulty";
  const stars = "★".repeat(tool.difficulty || 1);
  if (currentLang === "ja") {
    diffSpan.textContent = `難易度: ${stars}`;
  } else {
    diffSpan.textContent = `Level: ${stars}`;
  }

  const catSpan = document.createElement("span");
  catSpan.className = "tool-categories";
  const labels = getCategoryLabels(tool);
  catSpan.textContent = labels.join(", ");

  meta.appendChild(diffSpan);
  meta.appendChild(catSpan);

  // 本を選んでいるときだけ、その本での掲載箇所（章・ページ）を1場所1チップで出す
  if (book && HB) {
    HB.formatRef(book, tool.id, currentLang).forEach((txt) => {
      const chip = document.createElement("span");
      chip.className = "tool-book-ref";
      chip.textContent = txt;
      meta.appendChild(chip);
    });
  }

  const footer = document.createElement("div");
  footer.className = "tool-footer";

  // デモ URL があるツールだけ「デモ」ボタンを出す。
  // ハードウェア／バックエンド系など、ブラウザーで動かないツールは demo_url が空で、
  // その場合はボタンを出さず GitHub への導線だけにする（404 のデモボタンを避ける）。
  let demoBtn = null;
  if (tool.demo_url) {
    demoBtn = document.createElement("a");
    demoBtn.href = tool.demo_url;
    demoBtn.target = "_blank";
    demoBtn.rel = "noopener";
    demoBtn.className = "tool-button";
    demoBtn.textContent = currentLang === "ja" ? "デモ" : "Demo";
  }

  const repoBtn = document.createElement("a");
  repoBtn.href = tool.repo_url || "#";
  repoBtn.target = "_blank";
  repoBtn.rel = "noopener";
  repoBtn.className = "tool-button secondary";
  repoBtn.textContent = "GitHub";

  const progressBtn = document.createElement("button");
  progressBtn.type = "button";
  progressBtn.className = "tool-progress-button";
  progressBtn.dataset.slug = tool.slug;
  updateProgressButton(progressBtn, tool.slug);

  progressBtn.addEventListener("click", () => {
    const level = (getProgress(tool.slug) + 1) % 4;
    setProgress(tool.slug, level);
    // 同じツールが複数の章に出ているときは、全部のボタンを同期する
    syncProgressButtons(tool.slug);
    renderDashboard();
  });

  if (demoBtn) footer.appendChild(demoBtn);
  footer.appendChild(repoBtn);
  footer.appendChild(progressBtn);

  card.appendChild(header);
  card.appendChild(subtitle);
  card.appendChild(desc);
  card.appendChild(meta);
  card.appendChild(footer);

  return card;
}

function getShortDescription(tool) {
  const full =
    currentLang === "ja"
      ? tool.description_ja || ""
      : tool.description_en || "";

  const maxLen = 120;
  if (full.length <= maxLen) return full;
  return full.slice(0, maxLen) + "…";
}

function getCategoryLabels(tool) {
  const ids = tool.category_ids || [];
  if (!ids.length) return [];

  const labelField = currentLang === "ja" ? "ja" : "en";
  const labels = [];

  ids.forEach((id) => {
    const cat = categories.find((c) => c.id === id);
    if (cat && cat[labelField]) {
      labels.push(cat[labelField]);
    }
  });

  return labels;
}

// ---- 進捗管理（localStorage） ----

function getProgress(slug) {
  const key = `progress_${slug}`;
  const raw = localStorage.getItem(key);
  const num = Number(raw);
  if (Number.isInteger(num) && num >= 0 && num <= 3) {
    return num;
  }
  return 0;
}

function setProgress(slug, level) {
  const key = `progress_${slug}`;
  localStorage.setItem(key, String(level));
}

function updateProgressButton(btn, slug) {
  const level = getProgress(slug);
  const label = PROGRESS_LABELS[currentLang][level];
  btn.textContent =
    currentLang === "ja" ? `進捗: ${label}` : `Progress: ${label}`;

  // 進捗状態の色分けクラスを更新
  btn.classList.remove("progress-0", "progress-1", "progress-2", "progress-3");
  btn.classList.add(`progress-${level}`);
}

// 同じ slug の進捗ボタンをすべて更新する（章をまたいで同じツールが出る場合の同期）。
function syncProgressButtons(slug) {
  let sel;
  try {
    sel = `.tool-progress-button[data-slug="${CSS.escape(slug)}"]`;
  } catch (e) {
    sel = ".tool-progress-button";
  }
  document.querySelectorAll(sel).forEach((b) => {
    if (b.dataset.slug === slug) updateProgressButton(b, slug);
  });
}

// ---- ダッシュボード描画 ----

function renderDashboard() {
  const total = tools.filter((t) => t.hub !== false).length;

  let n0 = 0,
    n1 = 0,
    n2 = 0,
    n3 = 0;

  tools
    .filter((t) => t.hub !== false)
    .forEach((tool) => {
      const lvl = getProgress(tool.slug);
      if (lvl === 0) n0++;
      else if (lvl === 1) n1++;
      else if (lvl === 2) n2++;
      else if (lvl === 3) n3++;
    });

  const totalEl = document.getElementById("overall-total");
  const n0El = document.getElementById("overall-n0");
  const n1El = document.getElementById("overall-n1");
  const n2El = document.getElementById("overall-n2");
  const n3El = document.getElementById("overall-n3");

  if (totalEl) {
    totalEl.textContent =
      currentLang === "ja"
        ? `全ツール数: ${total}`
        : `Total tools: ${total}`;
  }
  if (n0El) {
    n0El.textContent =
      currentLang === "ja" ? `未着手: ${n0}` : `Not started: ${n0}`;
  }
  if (n1El) {
    n1El.textContent =
      currentLang === "ja" ? `学習中: ${n1}` : `In progress: ${n1}`;
  }
  if (n2El) {
    n2El.textContent =
      currentLang === "ja" ? `一周完了: ${n2}` : `First pass: ${n2}`;
  }
  if (n3El) {
    n3El.textContent =
      currentLang === "ja" ? `定着済み: ${n3}` : `Mastered: ${n3}`;
  }

  const chartContainer = document.getElementById("overall-chart-container");
  if (chartContainer) {
    renderPieChart(chartContainer, n0, n1, n2, n3, total);
  }

  renderCategoryProgress();
  renderBookProgress();
}

// ---- 書籍・シリーズ別進捗 ----

function renderBookProgress() {
  const section = document.getElementById("dashboard-books");
  const container = document.getElementById("book-progress-list");
  if (!section || !container) return;
  container.innerHTML = "";

  if (!HB || !Array.isArray(books) || !books.length) {
    section.hidden = true;
    return;
  }

  const stats = [];
  books
    .filter((b) => b.dashboard !== false)
    .forEach((b) => {
      const target = HB.expandTargetIds(b, tools);
      if (!target.size) return;
      let n0 = 0,
        n1 = 0,
        n2 = 0,
        n3 = 0;
      tools.forEach((t) => {
        if (t.hub === false || !target.has(t.id)) return;
        const lvl = getProgress(t.slug);
        if (lvl === 0) n0++;
        else if (lvl === 1) n1++;
        else if (lvl === 2) n2++;
        else n3++;
      });
      stats.push({ book: b, n0, n1, n2, n3, total: target.size });
    });

  section.hidden = stats.length === 0;
  if (!stats.length) return;

  stats.forEach((s) => {
    const item = document.createElement("div");
    item.className = "category-progress-item book-progress-item";

    const title = document.createElement("a");
    title.className = "category-progress-title book-progress-title";
    title.href = `?book=${encodeURIComponent(s.book.slug)}`;
    const kind = document.createElement("span");
    kind.className = "book-progress-kind";
    kind.textContent = bookKindLabel(s.book);
    title.appendChild(kind);
    title.appendChild(document.createTextNode(HB.bookLabel(s.book, currentLang)));
    title.addEventListener("click", (e) => {
      e.preventDefault();
      switchTab("tab-tools");
      setBookFilter(s.book.slug);
      const h2 = document.getElementById("book-banner-title");
      if (h2) h2.focus();
    });

    const bar = document.createElement("div");
    bar.className = "category-progress-bar";
    [["bar-n0", s.n0], ["bar-n1", s.n1], ["bar-n2", s.n2], ["bar-n3", s.n3]].forEach(
      ([cls, v]) => {
        const seg = document.createElement("div");
        seg.className = cls;
        seg.style.flex = v;
        bar.appendChild(seg);
      }
    );

    const detail = document.createElement("div");
    detail.className = "category-progress-detail";
    detail.textContent =
      currentLang === "ja"
        ? `未着手${s.n0} / 学習中${s.n1} / 一周完了${s.n2} / 定着済み${s.n3} （全${s.total}）`
        : `Not started ${s.n0} / In progress ${s.n1} / First pass ${s.n2} / Mastered ${s.n3} (total ${s.total})`;

    item.appendChild(title);
    item.appendChild(bar);
    item.appendChild(detail);
    container.appendChild(item);
  });
}

// ---- 円グラフ描画 ----

function renderPieChart(container, n0, n1, n2, n3, total) {
  container.innerHTML = "";

  // 円グラフ本体
  const pie = document.createElement("div");
  pie.className = "pie-chart";

  if (total > 0) {
    // パーセンテージを計算
    const p0 = (n0 / total) * 100;
    const p1 = (n1 / total) * 100;
    const p2 = (n2 / total) * 100;
    const p3 = (n3 / total) * 100;

    // 累積パーセンテージでconic-gradientを生成
    // 色: n0=グレー, n1=青, n2=オレンジ, n3=緑
    const end0 = p0;
    const end1 = end0 + p1;
    const end2 = end1 + p2;
    const end3 = end2 + p3;

    pie.style.background = `conic-gradient(
      #d1d5db 0% ${end0}%,
      #3b82f6 ${end0}% ${end1}%,
      #f59e0b ${end1}% ${end2}%,
      #10b981 ${end2}% ${end3}%
    )`;
  }

  container.appendChild(pie);

  // 凡例
  const legend = document.createElement("div");
  legend.className = "pie-legend";

  const labels = currentLang === "ja"
    ? ["未着手", "学習中", "一周完了", "定着済み"]
    : ["Not started", "In progress", "First pass", "Mastered"];

  const counts = [n0, n1, n2, n3];
  const classes = ["color-n0", "color-n1", "color-n2", "color-n3"];

  labels.forEach((label, i) => {
    const item = document.createElement("div");
    item.className = "pie-legend-item";

    const colorBox = document.createElement("span");
    colorBox.className = `pie-legend-color ${classes[i]}`;

    const text = document.createElement("span");
    text.textContent = `${label}: ${counts[i]}`;

    item.appendChild(colorBox);
    item.appendChild(text);
    legend.appendChild(item);
  });

  container.appendChild(legend);
}

// ---- カテゴリ別進捗 ----

function buildCategoryStats() {
  const stats = [];

  categories.forEach((cat) => {
    const id = cat.id;
    let n0 = 0,
      n1 = 0,
      n2 = 0,
      n3 = 0;

    tools
      .filter((t) => t.hub !== false)
      .filter((t) => (t.category_ids || []).includes(id))
      .forEach((tool) => {
        const lvl = getProgress(tool.slug);
        if (lvl === 0) n0++;
        else if (lvl === 1) n1++;
        else if (lvl === 2) n2++;
        else if (lvl === 3) n3++;
      });

    const total = n0 + n1 + n2 + n3;
    if (total === 0) return; // このカテゴリに属するツールがない場合はスキップ

    stats.push({
      id,
      labelJa: cat.ja,
      labelEn: cat.en,
      n0,
      n1,
      n2,
      n3,
      total
    });
  });

  return stats;
}

function renderCategoryProgress() {
  const container = document.getElementById("category-progress-list");
  if (!container) return;

  container.innerHTML = "";

  const stats = buildCategoryStats();

  if (stats.length === 0) {
    const p = document.createElement("p");
    p.textContent =
      currentLang === "ja"
        ? "カテゴリ別の進捗はまだありません。"
        : "No category-level progress data yet.";
    container.appendChild(p);
    return;
  }

  stats.forEach((cat) => {
    const item = document.createElement("div");
    item.className = "category-progress-item";

    // カテゴリ名
    const title = document.createElement("div");
    title.className = "category-progress-title";
    title.textContent = currentLang === "ja" ? cat.labelJa : cat.labelEn;

    // 進捗バー
    const bar = document.createElement("div");
    bar.className = "category-progress-bar";

    // 各セグメント（flex で比率表示）
    const segN0 = document.createElement("div");
    segN0.className = "bar-n0";
    segN0.style.flex = cat.n0;

    const segN1 = document.createElement("div");
    segN1.className = "bar-n1";
    segN1.style.flex = cat.n1;

    const segN2 = document.createElement("div");
    segN2.className = "bar-n2";
    segN2.style.flex = cat.n2;

    const segN3 = document.createElement("div");
    segN3.className = "bar-n3";
    segN3.style.flex = cat.n3;

    bar.appendChild(segN0);
    bar.appendChild(segN1);
    bar.appendChild(segN2);
    bar.appendChild(segN3);

    // 数値テキスト
    const detail = document.createElement("div");
    detail.className = "category-progress-detail";

    if (currentLang === "ja") {
      detail.textContent =
        `未着手${cat.n0} / 学習中${cat.n1} / 一周完了${cat.n2} / 定着済み${cat.n3} （全${cat.total}）`;
    } else {
      detail.textContent =
        `Not started ${cat.n0} / In progress ${cat.n1} / First pass ${cat.n2} / Mastered ${cat.n3} (total ${cat.total})`;
    }

    item.appendChild(title);
    item.appendChild(bar);
    item.appendChild(detail);
    container.appendChild(item);
  });
}

// ---- X共有 ----

function handleShareOnX() {
  const total = tools.filter((t) => t.hub !== false).length;

  let n0 = 0,
    n1 = 0,
    n2 = 0,
    n3 = 0;

  tools
    .filter((t) => t.hub !== false)
    .forEach((tool) => {
      const lvl = getProgress(tool.slug);
      if (lvl === 0) n0++;
      else if (lvl === 1) n1++;
      else if (lvl === 2) n2++;
      else if (lvl === 3) n3++;
    });

  const url = window.location.origin + window.location.pathname;

  let text;
  if (currentLang === "ja") {
    text = `「ハッキング・ラボ・オンライン」で学習進捗を管理中🔬📚
全 ${total} ツール：未着手${n0}／学習中${n1}／一周完了${n2}／定着済み${n3}
${url}
#生成AIセキュリティツール #ハッキングラボオンライン`;
  } else {
    text = `Tracking my progress on ${total}+ tools at Hacking Lab Online 🔬
Not started ${n0} / In progress ${n1} / First pass ${n2} / Mastered ${n3}
${url}
#GenAI #SecurityTools #HackingLabOnline`;
  }

  const shareUrl =
    "https://twitter.com/intent/tweet?text=" + encodeURIComponent(text);

  window.open(shareUrl, "_blank", "noopener");
}

// ---- 全体リセット ----

function handleResetAllProgress() {
  const confirmTextJa =
    "本当にすべてのツールの進捗を「未着手」にリセットしますか？";
  const confirmTextEn =
    'Are you sure you want to reset all tools to "Not started"?';

  const ok = window.confirm(
    currentLang === "ja" ? confirmTextJa : confirmTextEn
  );
  if (!ok) return;

  tools
    .filter((t) => t.hub !== false)
    .forEach((tool) => {
      setProgress(tool.slug, 0);
    });

  renderToolList();
  renderDashboard();
}
