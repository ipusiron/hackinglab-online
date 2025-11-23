// js/main.js

// グローバル状態
let currentLang = "ja"; // "ja" | "en"
let tools = [];
let categories = [];
let filters = {
  categoryId: "",
  progress: "all",
  search: ""
};

const PROGRESS_LABELS = {
  ja: ["未着手", "学習中", "一周完了", "定着済み"],
  en: ["Not started", "In progress", "First pass", "Mastered"]
};

document.addEventListener("DOMContentLoaded", () => {
  setupStaticUI();
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
    renderAll();
  });

  langEnBtn?.addEventListener("click", () => {
    currentLang = "en";
    updateLanguageUI();
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

  // フィルタ
  const categorySelect = document.getElementById("filter-category");
  const progressSelect = document.getElementById("filter-progress");
  const searchInput = document.getElementById("filter-search-input");

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

  updateLanguageUI();
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

    setupFilterOptions();
    renderAll();
  } catch (err) {
    console.error("Error loading data:", err);
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

  // 言語ボタンの状態
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

// ---- フィルタの選択肢セットアップ ----

function setupFilterOptions() {
  const categorySelect = document.getElementById("filter-category");
  const progressSelect = document.getElementById("filter-progress");

  if (categorySelect) {
    categorySelect.innerHTML = "";

    // 「すべて」オプション
    const optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = currentLang === "ja" ? "すべて" : "All";
    categorySelect.appendChild(optAll);

    // categories.json から
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = currentLang === "ja" ? cat.ja : cat.en;
      categorySelect.appendChild(opt);
    });
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
      opt.value = String(level); // "0"〜"3"
      opt.textContent = label;
      progressSelect.appendChild(opt);
    });
  }
}

// ---- ツール一覧の描画 ----

function renderToolList() {
  const listEl = document.getElementById("tool-list");
  if (!listEl) return;

  listEl.innerHTML = "";

  const filtered = tools
    .filter((t) => t.hub !== false) // hub が false なら除外
    .filter((t) => filterByCategory(t))
    .filter((t) => filterByProgress(t))
    .filter((t) => filterBySearch(t));

  if (filtered.length === 0) {
    const p = document.createElement("p");
    p.textContent =
      currentLang === "ja"
        ? "条件に一致するツールがありません。"
        : "No tools match the current filters.";
    listEl.appendChild(p);
    return;
  }

  filtered.forEach((tool) => {
    const card = createToolCard(tool);
    listEl.appendChild(card);
  });
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

function createToolCard(tool) {
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

  // 難易度
  const diffSpan = document.createElement("span");
  diffSpan.className = "tool-difficulty";
  const stars = "★".repeat(tool.difficulty || 1);
  if (currentLang === "ja") {
    diffSpan.textContent = `難易度: ${stars}`;
  } else {
    diffSpan.textContent = `Level: ${stars}`;
  }

  // カテゴリ（表示は categories.json を使っても、tool.category_ja/en でもOK）
  const catSpan = document.createElement("span");
  catSpan.className = "tool-categories";
  const labels = getCategoryLabels(tool);
  catSpan.textContent = labels.join(", ");

  meta.appendChild(diffSpan);
  meta.appendChild(catSpan);

  // ボタンエリア
  const footer = document.createElement("div");
  footer.className = "tool-footer";

  const demoBtn = document.createElement("a");
  demoBtn.href = tool.demo_url || "#";
  demoBtn.target = "_blank";
  demoBtn.rel = "noopener";
  demoBtn.className = "tool-button";
  demoBtn.textContent = currentLang === "ja" ? "デモを開く" : "Open demo";

  const repoBtn = document.createElement("a");
  repoBtn.href = tool.repo_url || "#";
  repoBtn.target = "_blank";
  repoBtn.rel = "noopener";
  repoBtn.className = "tool-button secondary";
  repoBtn.textContent = "GitHub";

  const progressBtn = document.createElement("button");
  progressBtn.type = "button";
  progressBtn.className = "tool-progress-button";
  updateProgressButton(progressBtn, tool.slug);

  progressBtn.addEventListener("click", () => {
    const level = (getProgress(tool.slug) + 1) % 4; // 0→1→2→3→0
    setProgress(tool.slug, level);
    updateProgressButton(progressBtn, tool.slug);
    renderDashboard(); // ダッシュボード再計算
  });

  footer.appendChild(demoBtn);
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

  // 今のところグラフは未実装なのでダミー文言だけ入れておく
  const chartContainer = document.getElementById("overall-chart-container");
  if (chartContainer) {
    chartContainer.textContent =
      currentLang === "ja"
        ? "※グラフ表示は今後実装予定です。"
        : "Charts will be implemented later.";
  }

  // カテゴリ別の枠も今はダミー
  const catList = document.getElementById("category-progress-list");
  if (catList) {
    catList.textContent =
      currentLang === "ja"
        ? "カテゴリ別の進捗可視化は今後実装予定です。"
        : "Per-category progress visualization will be implemented later.";
  }
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

///////////////////////////////////////////////////////////////////////////
// ---- ヘルプモーダル ----
///////////////////////////////////////////////////////////////////////////

document.addEventListener("DOMContentLoaded", () => {
  const helpModal = document.getElementById("help-modal");
  const helpButton = document.getElementById("help-button");
  const helpClose = document.getElementById("help-close");

  // 念のため初期は必ず隠す
  helpModal.hidden = true;

  helpButton?.addEventListener("click", () => {
    helpModal.hidden = false;
  });

  helpClose?.addEventListener("click", () => {
    helpModal.hidden = true;
  });

  // 背景クリックで閉じたい場合
  helpModal?.addEventListener("click", (e) => {
    if (e.target === helpModal) helpModal.hidden = true;
  });
});
