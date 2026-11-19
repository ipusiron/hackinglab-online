// js/main.js

// グローバル状態
// 表示の言語。js/lang.js が描く前に決めて <html lang> に書いている（?lang= → 保存した言語 → 日本語）
let currentLang = document.documentElement.lang === "en" ? "en" : "ja"; // "ja" | "en"
let tools = [];
let categories = [];
const HG = typeof HLOCategoryGroups !== "undefined" ? HLOCategoryGroups : null;
let categoryGroups = null;
let books = [];
let filters = {
  book: "",
  categoryId: "",
  fieldId: "",
  progress: "all",
  search: ""
};

// 書籍フィルターの純関数（js/books.js）。読み込めていなければ null として退避する。
const HB = typeof HLOBooks !== "undefined" ? HLOBooks : null;
// いま選択中の本の対象 id 集合（renderToolList / setBookFilter で更新）。
let bookTargetSet = null;
let filtersExpanded = true;
let filterDisclosureUsed = false;
const bookJumpStates = new Map();

// キーワード検索の純関数（js/search.js）。読み込めていなければ null とし、入力全体の部分一致で代える。
const HS = typeof HLOSearch !== "undefined" ? HLOSearch : null;
// いまの検索語（HS.parseQuery で正規化して分けたもの。filters.search はこれを空白でつないだ文字列）
let searchTerms = [];
// ツール -> 検索用の項目。データは読み込んだあとに変わらないので、初めて検索したときに1回だけ作る
let searchEntries = null;

// URL を読む・作る純関数（js/url.js）。読み込めていなければ null とし、URL に条件を書かない（?book= だけは books.js で読む）
const HU = typeof HLOUrl !== "undefined" ? HLOUrl : null;
// いま開いているタブ（"tools" | "dashboard"）。URL の ?tab= と合わせる
let currentTab = "tools";
// URL のセットと通知は、実在する公開ツールを読んでから決める。
let toolSet = { present: false, ids: [], unknown: false, truncated: false };
let linkNotices = [];
let linkedToolId = "";
let pendingNavigation = null;
let lastNavigationHref = "";
let copyGeneration = 0;
const HSH = typeof HLOShare !== "undefined" ? HLOShare : null;
let shareCopyGeneration = 0;
let shareScopeKey = "";
let navigationVersion = 0;
let interactionVersion = 0;
let historyScrollTimer = 0;
let catalogGeneratedAt = null;
function baseTitle() {
  return currentLang === "ja"
    ? "ハッキング・ラボ・オンライン｜IPUSIRONのセキュリティツールで独学"
    : "Hacking Lab Online | Self-study with IPUSIRON's security tools";
}

function formatCatalogDate(value, language) {
  // Require a timestamp with an explicit zone; do not infer a local date or use today.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return "-";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "-";
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendar = new Date(value.slice(0, 10) + "T00:00:00Z");
  if (calendar.getUTCFullYear() !== year || calendar.getUTCMonth() + 1 !== month || calendar.getUTCDate() !== day) return "-";
  return new Intl.DateTimeFormat(language === "ja" ? "ja-JP" : "en-US", {
    timeZone: "Asia/Tokyo", year: "numeric", month: language === "ja" ? "long" : "short", day: "numeric"
  }).format(date);
}

function updateCatalogDate() {
  const value = document.getElementById("last-updated-value");
  if (value) value.textContent = formatCatalogDate(catalogGeneratedAt, currentLang);
}
const LINK_TEXT = {
  partial: ["このリンクのツールのうち、見つからないものがありました。", "Some tools in this link could not be found."],
  empty: ["このリンクのツールが見つからないため、すべてのツールを表示しています。", "None of the tools in this link were found, so all tools are shown."],
  truncated: ["最初の12本だけを表示しています。", "Showing only the first 12 tools."],
  book: ["このツールは選んだ本に入っていないため、本の絞り込みを外して表示しています。", "This tool isn't in the selected book, so the book filter has been cleared to show it."],
  filters: ["リンクのツールが今の絞り込みに入っていないため、条件を外して表示しています。", "The linked tool didn't match the current filters, so the filters have been cleared to show it."],
  unknown: ["リンクで指定されたツールが見つからないため、すべてのツールを表示しています。", "The linked tool was not found, so all tools are shown."],
  copied: ["リンクをコピーしました。", "Link copied."],
  copyFailed: ["コピーできませんでした。下のリンクを選んでコピーしてください。", "Couldn't copy the link. Select the link below and copy it."]
};

// The fallback preserves the same storage contract if storage.js did not load.
function createFallbackStorage(getStorage, onFailure) {
    const dirty = new Map();
    const clean = new Map();
    function failed(key) {
      try { if (typeof onFailure === "function") onFailure(key); } catch (_) { /* Notification must not break storage access. */ }
    }
    function readFresh(key) {
      try {
        const storage = getStorage();
        if (!storage || typeof storage.getItem !== "function") throw new Error("Storage unavailable");
        const raw = storage.getItem(key);
        const value = raw == null ? null : String(raw);
        if (value === null) clean.delete(key);
        else clean.set(key, value);
        return { ok: true, value };
      } catch (_) {
        failed(key);
        return { ok: false, value: null };
      }
    }
    function getItem(key) {
      if (dirty.has(key)) return dirty.get(key);
      const result = readFresh(key);
      return result.ok ? result.value : clean.get(key) ?? null;
    }
    function setMemory(key, value) {
      dirty.set(key, String(value));
      failed(key);
      return false;
    }
    function setItem(key, value) {
      const text = String(value);
      dirty.set(key, text);
      try {
        const storage = getStorage();
        if (!storage || typeof storage.setItem !== "function") throw new Error("Storage unavailable");
        storage.setItem(key, text);
        clean.set(key, text);
        dirty.delete(key);
        return true;
      } catch (_) {
        failed(key);
        return false;
      }
    }
    function invalidate(key) {
      if (key === null) clean.clear();
      else clean.delete(key);
      // Unsaved values are deliberately kept so that an export can still rescue them.
    }
    return { getItem, setItem, readFresh, setMemory, invalidate };
  }
const progressStore = (typeof HLOStorage !== "undefined" ? HLOStorage.createSafeStorage : createFallbackStorage)(() => window.localStorage, noteStorageFailure);

// 選んだ言語を保存するキー（js/lang.js が開いたときに読む）
const LANG_KEY = typeof HLOLang !== "undefined" && HLOLang.KEY ? HLOLang.KEY : "hlo_lang";
// 「はじめ方」の開閉を覚えるキー（"open" か "closed"。js/lang.js が開いたときに読み、描く前に開閉を決める）
const START_KEY = typeof HLOLang !== "undefined" && HLOLang.START_KEY ? HLOLang.START_KEY : "hlo_start_here";

const PROGRESS_LABELS = {
  ja: ["未着手", "学習中", "一周完了", "定着済み"],
  en: ["Not started", "In progress", "First pass", "Mastered"]
};

// 狭い画面の境目。css/style.css の、「はじめ方」を描く前に畳む規則（@media）と同じ式にする
const NARROW_MQ = "(max-width: 767.98px)";

// 一覧を作り直さずに済むかを見るための、前回の表示の鍵と、進捗を変えるたびに増やす版
let lastListKey = null;
let progressVersion = 0;
let loadState = "loading";
let loadAttempt = null;
let statusTimer = 0;
let statusRepeatTimer = 0;
let statusVersion = 0;
let shownToolIds = new Set();
let outsideToolIds = new Set();
const LIST_TEXT = {
  "list_heading": [
    "ツール一覧",
    "Tool list"
  ],
  "all_count": [
    "全{total}本を表示",
    "Showing all {total} tools"
  ],
  "filtered_count": [
    "{total}本中{shown}本を表示",
    "Showing {shown} of {total} tools"
  ],
  "outside_count": [
    "{total}本中{shown}本を表示（{outside}本は条件外）",
    "Showing {shown} of {total} ({outside} no longer matches)"
  ],
  "count_announcement": [
    "{total}本中{shown}本を表示しています。",
    "Showing {shown} of {total} tools."
  ],
  "empty": [
    "条件に合うツールはありません。",
    "No tools match the current filters."
  ],
  "empty_book": [
    "「{book}」の中に、ほかの条件に合うツールはありません。",
    "No tools from “{book}” match the other filters."
  ],
  "clear_all": [
    "条件をすべて外す",
    "Clear all filters"
  ],
  "clear_except_book": [
    "カテゴリ・進捗・検索の条件を外す",
    "Clear category, progress, and search"
  ],
  "outside_label": [
    "「{progress}」の条件外",
    "No longer “{progress}”"
  ],
  "outside_announcement": [
    "「{progress}」の条件から外れました。カードは、絞り込みを変えるまで一覧に残ります。",
    "This card no longer matches the “{progress}” filter. It stays in the list until you change the filters."
  ],
  "search_label": [
    "検索",
    "Search"
  ],
  "search_placeholder": [
    "ツール名・説明・Day番号",
    "Name, description, Day number"
  ],
  "loading": [
    "ツールの一覧を読み込んでいます…",
    "Loading the tool list…"
  ],
  "load_error": [
    "ツールの一覧を読み込めませんでした。通信の状態を確かめてから、もう一度読み込んでください。",
    "Couldn't load the tool list. Check your connection, then try again."
  ],
  "retry": [
    "もう一度読み込む",
    "Try again"
  ],
  "slow_loading": [
    "表示に時間がかかっています。",
    "This is taking longer than usual."
  ],
  "reload_page": [
    "ページを読み込み直す",
    "Reload the page"
  ],
  "no_javascript": [
    "ツールの一覧と絞り込みはJavaScriptで表示しています。ブラウザーでJavaScriptを有効にしてから、このページを読み込み直してください。",
    "The tool list and filters need JavaScript. Turn on JavaScript in your browser, then reload this page."
  ]
};

function listText(key, values = {}) {
  return LIST_TEXT[key][currentLang === "ja" ? 0 : 1].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}

// Both the debounce and the short same-message reset belong to the current view.
function cancelListStatus() {
  clearTimeout(statusTimer);
  clearTimeout(statusRepeatTimer);
  statusTimer = statusRepeatTimer = 0;
  statusVersion++;
}

function announceListStatus(message, delay = 0) {
  cancelListStatus();
  if (loadState !== "ready") return;
  const version = statusVersion;
  const publish = () => {
    statusTimer = 0;
    if (version !== statusVersion || loadState !== "ready") return;
    const el = document.getElementById("book-status");
    if (!el) return;
    if (el.textContent === message) {
      el.textContent = "";
      statusRepeatTimer = setTimeout(() => {
        statusRepeatTimer = 0;
        if (version === statusVersion && loadState === "ready") el.textContent = message;
      }, 50);
    } else el.textContent = message;
  };
  if (delay) statusTimer = setTimeout(publish, delay);
  else publish();
}

function listCounts() {
  const total = toolSet.ids.length ? toolSet.ids.length : bookTargetSet ? bookTargetSet.size : new Set(tools.filter((t) => t.hub !== false).map((t) => t.id)).size;
  return { total, shown: shownToolIds.size, outside: outsideToolIds.size };
}

function updateListCount() {
  const el = document.getElementById("list-count");
  if (!el || loadState !== "ready") return;
  const counts = listCounts();
  updateCategoryGuidance(counts.shown);
  el.textContent = listText(counts.outside ? "outside_count" : counts.shown === counts.total ? "all_count" : "filtered_count", counts);
  // Reserve the longest possible outside count at the current width/font size.
  // Updating progress must not move the cards below this line.
  const space = document.getElementById("list-count-space");
  if (space) space.textContent = filters.progress !== "all" && !toolSet.ids.length && counts.shown
    ? listText("outside_count", { ...counts, outside: counts.shown }) : "";
}

function removeUnusedCategoryChoices() {
  const available = new Set(tools.filter((t) => t.hub !== false).flatMap((t) => t.category_ids || []));
  document.getElementById("filter-category")?.querySelectorAll("option").forEach((option) => {
    if (option.value && !option.value.startsWith("field:") && option.value !== filters.categoryId && !available.has(option.value)) option.remove();
  });
}

function updateCategoryGuidance(shown) {
  const guidance = document.getElementById("category-guidance");
  if (!guidance) return;
  const field = categoryGroups?.byId.get(filters.fieldId);
  const description = categoryGroups?.descriptions.get(filters.categoryId);
  const message = field ? field[currentLang === "ja" ? "description_ja" : "description_en"]
    : description ? description[currentLang] : "";
  guidance.hidden = loadState !== "ready" || !shown || !!toolSet.ids.length || !message;
  if (guidance.textContent !== message) guidance.textContent = message;
}

function announceListCount(delay = 0, userInitiated = false) {
  // Initial/history/language notices take priority; an explicit filter change reports its result.
  if (!userInitiated && !document.getElementById("book-notice")?.hidden) return;
  const counts = listCounts();
  let message;
  if (!counts.shown) {
    const book = currentBook();
    message = listText(book ? "empty_book" : "empty", { book: book && HB ? HB.bookLabel(book, currentLang) : "" });
  } else if (counts.shown === counts.total && !counts.outside) {
    message = currentLang === "ja" ? `全${counts.total}本を表示しています。` : `Showing all ${counts.total} tools.`;
  } else message = listText("count_announcement", counts);
  announceListStatus(message, delay);
}

const RECORDS_TEXT = {
  "record_location": [
    "進捗はこのブラウザーの中にだけ保存し、サーバーには送りません。ランキングも、他人との比較もありません。",
    "Your progress is saved only in this browser and is never sent to a server. No rankings, no comparing yourself with others."
  ],
  "record_location_failed": [
    "このブラウザーでは進捗を保存できないため、ページを閉じると消えます。ランキングも、他人との比較もありません。",
    "This browser can't save your progress, so it will be lost when you close the page. No rankings, no comparing yourself with others."
  ],
  "export_empty": [
    "保存する記録はありません（すべて未着手です）。",
    "Nothing to save. No tool has any progress recorded."
  ],
  "import_empty": [
    "戻す進捗はありません。このブラウザーの記録は、ファイルと同じか、ファイルより進んでいます。",
    "Nothing to restore. This browser's records are the same as or further along than the file."
  ],
  "import_invalid": [
    "このファイルは読めません。「記録をファイルに保存」で作った.jsonのファイルを選んでください。",
    "Can't read this file. Choose a .json file you saved with the “Save records to a file” button."
  ],
  "import_new_version": [
    "このファイルは、このページより新しい形式です。ページを読み込み直してから、もう一度選んでください。",
    "This file uses a newer format. Reload this page, then choose the file again."
  ]
};

// ---- Local records: file input and download stay entirely in this browser ----
const RECORDS = typeof HLORecords !== "undefined" ? HLORecords : null;
const LAST_EXPORT_KEY = "hlo_records_last_export";
let recordsBusy = false;
let recordsResult = null;
let lastExportAt = null;
let storageWarningSeen = false;
let storageWarningDismissed = false;
let storageWarningFocus = null;

function recordsText(key) {
  return RECORDS_TEXT[key][currentLang === "ja" ? 0 : 1];
}

function localRecordDate(value) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat(currentLang === "ja" ? "ja-JP" : "en-US", {
    year: "numeric", month: currentLang === "ja" ? "long" : "short", day: "numeric"
  }).format(date);
}

function recordsResultText() {
  if (!recordsResult) return "";
  const { key, count } = recordsResult;
  if (key === "exported") return currentLang === "ja" ? `${count}本の記録をファイルに保存しました。` : `Saved records for ${count} ${count === 1 ? "tool" : "tools"} to a file.`;
  if (key === "imported") return currentLang === "ja" ? `${count}本の進捗をファイルから戻しました。` : `Restored progress for ${count} ${count === 1 ? "tool" : "tools"} from the file.`;
  return recordsText(key);
}

function updateRecordsUI() {
  ["records-export", "records-import"].forEach((id) => {
    const button = document.getElementById(id);
    if (button) button.disabled = loadState !== "ready" || !RECORDS || recordsBusy;
  });
  const saved = document.getElementById("records-last-saved");
  if (saved) {
    const date = lastExportAt && localRecordDate(lastExportAt);
    saved.hidden = !date;
    saved.textContent = date ? (currentLang === "ja" ? `最後に保存した日：${date}` : `Last saved: ${date}`) : "";
  }
  const status = document.getElementById("records-status");
  const message = recordsResultText();
  if (status && status.textContent !== message) status.textContent = message;
  const note = document.getElementById("record-location");
  if (note) {
    const copy = RECORDS_TEXT[storageWarningSeen ? "record_location_failed" : "record_location"];
    note.querySelector(".label-ja").textContent = copy[0];
    note.querySelector(".label-en").textContent = copy[1];
  }
}

function updateStorageNoticeSpace() {
  const notice = document.getElementById("storage-warning");
  const height = notice && !notice.hidden ? notice.getBoundingClientRect().height : 0;
  document.documentElement.style.setProperty("--storage-notice-h", `${height}px`);
}

function noteStorageFailure(key) {
  if (!String(key).startsWith("progress_") || storageWarningSeen) return;
  storageWarningSeen = true;
  storageWarningFocus = document.activeElement;
  const notice = document.getElementById("storage-warning");
  if (notice && !storageWarningDismissed) notice.hidden = false;
  updateRecordsUI();
  requestAnimationFrame(() => {
    updateStorageNoticeSpace();
    const active = document.activeElement;
    if (!notice || notice.hidden || !active || active === document.body || notice.contains(active)) return;
    const boundary = notice.getBoundingClientRect().top;
    const bottom = active.getBoundingClientRect().bottom;
    if (bottom > boundary && boundary > 0) window.scrollBy({ top: bottom - boundary + 8, behavior: "auto" });
  });
}

function setRecordsResult(key, count) {
  recordsResult = { key, count };
  updateRecordsUI();
}

function setupRecordsUI() {
  const saved = progressStore.getItem(LAST_EXPORT_KEY);
  if (saved && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(saved) && Number.isFinite(Date.parse(saved)) && new Date(saved).toISOString() === saved) lastExportAt = saved;
  document.getElementById("records-export")?.addEventListener("click", handleRecordsExport);
  document.getElementById("records-import")?.addEventListener("click", () => {
    if (!recordsBusy && loadState === "ready" && RECORDS) document.getElementById("records-file").click();
  });
  document.getElementById("records-file")?.addEventListener("change", handleRecordsImport);
  document.getElementById("storage-warning-close")?.addEventListener("click", () => {
    storageWarningDismissed = true;
    const notice = document.getElementById("storage-warning");
    const restore = notice.contains(document.activeElement);
    notice.hidden = true;
    updateStorageNoticeSpace();
    if (restore) {
      const target = storageWarningFocus && storageWarningFocus !== document.body && !storageWarningFocus.disabled && storageWarningFocus.isConnected && isShown(storageWarningFocus) ? storageWarningFocus : document.querySelector('.tab-button[aria-selected="true"]');
      target?.focus({ preventScroll: true });
    }
  });
  if (typeof ResizeObserver !== "undefined") new ResizeObserver(updateStorageNoticeSpace).observe(document.getElementById("storage-warning"));
  updateRecordsUI();
}

function getRecordTools() {
  return tools.filter((tool) => tool.hub !== false);
}

function recordProgressMaps(ids) {
  const effective = new Map();
  const durable = new Map();
  const wanted = ids ? new Set(ids) : null;
  for (const tool of getRecordTools()) {
    if (wanted && !wanted.has(tool.id)) continue;
    effective.set(tool.id, getProgress(tool.slug));
    const result = progressStore.readFresh(`progress_${tool.slug}`);
    durable.set(tool.id, { ok: result.ok, value: normalizeProgress(result.value) });
  }
  return { effective, durable };
}

function handleRecordsExport() {
  if (recordsBusy || loadState !== "ready" || !RECORDS) return;
  recordsBusy = true;
  recordsResult = null;
  const button = document.getElementById("records-export");
  const focused = document.activeElement === button;
  updateRecordsUI();
  let objectUrl = null;
  let anchor = null;
  try {
    const now = new Date();
    const progress = new Map(getRecordTools().map((tool) => [tool.id, getProgress(tool.slug)]));
    const result = RECORDS.createRecords(progress, now.toISOString());
    if (!result) { setRecordsResult("export_empty"); return; }
    const file = new Blob([result.json], { type: "application/json" });
    objectUrl = URL.createObjectURL(file);
    anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `hackinglab-records-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}.json`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    // This confirms download initiation, not that the user saved a file on disk.
    lastExportAt = now.toISOString();
    progressStore.setItem(LAST_EXPORT_KEY, lastExportAt);
    setRecordsResult("exported", result.count);
  } catch (_) {
    // Keep file names and exception details out of status messages; do not report a failed download as saved.
    recordsResult = null;
  } finally {
    anchor?.remove();
    if (objectUrl) setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
    recordsBusy = false;
    updateRecordsUI();
    if (focused) button.focus({ preventScroll: true });
  }
}

function importConfirmation(savedAt, count, localAhead) {
  const date = localRecordDate(savedAt);
  if (currentLang === "ja") return `${date}に保存したファイルから、${count}本の進捗を戻します。このブラウザーのほうが進んでいる${localAhead}本は、そのままにします。よろしいですか？`;
  return `This will restore progress for ${count} ${count === 1 ? "tool" : "tools"} from the file saved on ${date}. The ${localAhead} ${localAhead === 1 ? "tool that is" : "tools that are"} further along in this browser will stay as ${localAhead === 1 ? "it is" : "they are"}. Continue?`;
}

async function handleRecordsImport() {
  const input = document.getElementById("records-file");
  if (recordsBusy || loadState !== "ready" || !RECORDS) return;
  const file = input.files?.[0];
  if (!file) return;
  recordsBusy = true;
  recordsResult = null;
  const guard = { interaction: interactionVersion, navigation: navigationVersion, href: location.href };
  const active = document.activeElement;
  updateRecordsUI();
  try {
    if (!Number.isFinite(file.size) || file.size < 0 || file.size > RECORDS.MAX_BYTES) { setRecordsResult("import_invalid"); return; }
    const parsed = RECORDS.parseRecords(await file.text(), new Set(getRecordTools().map((tool) => tool.id)));
    if (!parsed.ok) { setRecordsResult(parsed.reason === "new-version" ? "import_new_version" : "import_invalid"); return; }
    const first = recordProgressMaps();
    const current = new Map([...first.effective].map(([id, value]) => [id, Math.max(value, first.durable.get(id)?.ok ? first.durable.get(id).value : 0)]));
    const plan = RECORDS.planImport(parsed.progress, current);
    if (!plan.candidates.size) { setRecordsResult("import_empty"); return; }
    if (!window.confirm(importConfirmation(parsed.savedAt, plan.candidates.size, plan.localAheadCount))) return;
    // A native confirm can delay cross-tab storage visibility. In browser tests,
    // one task exposed only part of the queued changes; give two task opportunities
    // before re-reading the fixed candidates. This is not a transaction or CAS guarantee.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    const latest = recordProgressMaps(plan.candidates.keys());
    const result = RECORDS.recheckImport(plan.candidates, latest.effective, latest.durable);
    const byId = new Map(getRecordTools().map((tool) => [tool.id, tool]));
    for (const update of result.updates) {
      const key = `progress_${byId.get(update.id).slug}`;
      if (update.persist) progressStore.setItem(key, String(update.level));
      else progressStore.setMemory(key, String(update.level));
    }
    if (result.count) refreshProgressViews();
    setRecordsResult(result.count ? "imported" : "import_empty", result.count);
  } catch (_) {
    setRecordsResult("import_invalid");
  } finally {
    input.value = "";
    recordsBusy = false;
    updateRecordsUI();
    if (guard.interaction === interactionVersion && guard.navigation === navigationVersion && guard.href === location.href &&
      (active === document.getElementById("records-import") || active === input || active === document.body)) {
      const button = document.getElementById("records-import");
      if (isShown(button)) button.focus({ preventScroll: true });
    }
  }
}


document.addEventListener("DOMContentLoaded", () => {
  setupStaticUI();
  setupRecordsUI();
  setupHelpModal();
  setupProgressSync();
  setupHistory();
  // 固定ヘッダーの高さは、データを読み込む前に書く（読み込み中と読み込みに失敗したときも、
  // Tab・Shift+Tab で移った部品がヘッダーの下に隠れないように）
  applyHeaderHeightVar();
  loadData();
});

// ---- 初期セットアップ（イベントハンドラなど） ----

function setupStaticUI() {
  // 年の表示
  const yearSpan = document.getElementById("current-year");
  if (yearSpan) {
    yearSpan.textContent = new Date().getFullYear();
  }

  setupFilterDisclosure();
  document.getElementById("back-to-filters")?.addEventListener("click", backToFilters);

  // 言語切替
  const langJaBtn = document.getElementById("lang-ja");
  const langEnBtn = document.getElementById("lang-en");

  const setLanguage = (lang) => {
    if (lang === currentLang) return;
    cancelListStatus(); // 今の言語のボタンは押しても何もしない
    const retainedIds = new Set(shownToolIds);
    const anchor = captureReadingAnchor(); // 作り直す前に、読んでいたカードと高さを覚える
    const focused = document.activeElement;
    const focusedKey = focusKey(focused);
    currentLang = lang;
    // 選んだ言語を覚え（再読み込みや、新しいタブで開いたときも同じ言語で始める）、URL の ?lang= も合わせる。
    // 保存は進捗と同じ安全なラッパー（js/storage.js）を通すので、保存できない環境でも、このページの中では切り替わる
    progressStore.setItem(LANG_KEY, lang);
    syncLangParam();
    updateLanguageUI();
    setupFilterOptions(); // ラベルが変わるのでフィルターも再生成
    renderAll(retainedIds);
    restoreReadingAnchor(anchor);
    restoreRebuiltFocus(focused, focusedKey);
  };
  langJaBtn?.addEventListener("click", () => setLanguage("ja"));
  langEnBtn?.addEventListener("click", () => setLanguage("en"));

  // タブ切替（クリック、および ←/→/Home/End のキーボード操作）。開いたタブは URL の ?tab= に残す。
  // 押して切り替えたときは履歴を積み（戻るで前のタブへ戻る）、キーで切り替えたときは積まずに書き換える
  const tabButtons = Array.from(document.querySelectorAll(".tab-button"));
  tabButtons.forEach((btn, i) => {
    btn.addEventListener("click", () => {
      const targetId = btn.getAttribute("data-tab-target");
      commitUrl({ tab: tabName(targetId) }, "push");
      switchTab(targetId);
    });
    btn.addEventListener("keydown", (e) => {
      const next = nextTabIndex(e.key, i, tabButtons.length);
      if (next < 0) return;
      e.preventDefault();
      const nextBtn = tabButtons[next];
      const targetId = nextBtn.getAttribute("data-tab-target");
      commitUrl({ tab: tabName(targetId) });
      switchTab(targetId);
      nextBtn.focus();
    });
  });
  // ?tab=dashboard で開いたときは、データを待たずにダッシュボードのタブを開く（中身はデータが届いてから描く）
  if (HU && HU.readState(window.location.search, {}).tab === "dashboard") switchTab("tab-dashboard");

  // フィルター
  const bookSelect = document.getElementById("filter-book");
  const categorySelect = document.getElementById("filter-category");
  const progressSelect = document.getElementById("filter-progress");
  const searchInput = document.getElementById("filter-search-input");

  // 絞り込みを変えると、上にある本のバナーが出入りしたり、バナーの件数や「章へ移動」の行の数が変わったりして、
  // いま操作した欄が動く（本を選ぶと、バナーの高さの分だけ下へずれ、結果のカードが画面の外へ出る）。
  // 操作した欄が画面の同じ高さに残るように、動いた分だけすぐにスクロールで戻す（なめらかに動かすと、
  // 欄がいったん下がってから戻って見える）。ページの先頭より上へは戻せないので、先頭でバナーが消えたときなどは欄が上へ動く
  const keepInPlace = (el, update) => {
    const before = el.getBoundingClientRect().top;
    update();
    scrollByInstant(el.getBoundingClientRect().top - before);
  };

  // 本とカテゴリーを選んだときは履歴を積む（戻るで1つ前の一覧へ戻る）。選択欄を矢印キーで動かすと1段ごとに変わるので、
  // 同じ欄を続けて変えたときは1つにまとめる（commitUrl）
  bookSelect?.addEventListener("change", (e) => {
    if (e.target.value) markStartSeen();
    keepInPlace(bookSelect, () => setBookFilter(e.target.value, { history: "push", source: "book" }));
  });

  categorySelect?.addEventListener("change", (e) => {
    keepInPlace(categorySelect, () => {
      clearToolHashForFilter();
      const value = e.target.value;
      const field = value.startsWith("field:") ? value.slice(6) : "";
      const nextField = field && categoryGroups?.byId.has(field) ? field : "";
      const nextCategory = !nextField && categories.some((c) => c.id === value) ? value : "";
      commitUrl({ cat: nextCategory, field: nextField }, "push", "category");
      filters.categoryId = nextCategory;
      filters.fieldId = nextField;
      renderToolList(undefined, false);
      announceListCount(0, true);
    });
  });

  // 進捗の条件はこの端末の記録で決まるので、URL に残さない
  progressSelect?.addEventListener("change", (e) => {
    keepInPlace(progressSelect, () => {
      clearToolHashForFilter();
      filters.progress = e.target.value;
      renderToolList(undefined, false);
      announceListCount(0, true);
    });
  });

  // 日本語入力の変換中（未確定）は絞らず、確定したとき（compositionend）に欄の値で絞る。
  // Chromium は確定の input も isComposing=true で出し、そのあとに compositionend を出す（後ろに input は来ない）。
  // Firefox は compositionend のあとに isComposing=false の input を出す。どちらの順でも、同じ語なら
  // applySearch が描き直さないので、絞るのは1回だけ。変換を通らない英字は、今までどおり1文字ごとに絞る。
  // Only Escape needs a composition-session guard. Ordinary input still uses the event's
  // isComposing value, so a missed compositionend cannot leave filtering disabled.
  let searchEscapeComposing = false;
  searchInput?.addEventListener("compositionstart", () => {
    searchEscapeComposing = true;
    cancelListStatus();
  });
  searchInput?.addEventListener("compositionend", () => {
    searchEscapeComposing = false;
    keepInPlace(searchInput, () => applySearch(searchInput.value));
  });
  searchInput?.addEventListener("blur", () => { searchEscapeComposing = false; });
  searchInput?.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (e.isComposing || e.keyCode === 229 || searchEscapeComposing) { e.preventDefault(); return; }
    e.preventDefault(); // Avoid a second native search-clear input event.
    if (!searchInput.value) return;
    searchInput.value = "";
    keepInPlace(searchInput, () => applySearch(""));
  });
  searchInput?.addEventListener("input", (e) => {
    if (e.isComposing) { cancelListStatus(); return; }
    keepInPlace(searchInput, () => applySearch(searchInput.value));
  });

  // URL の ?q= は、開いたときに検索欄へ入れる（データを待たずに、読み込み中から欄に語を出す）。データが届いたときは
  // 欄を書き換えずに欄の値で絞る（読み込み中に打った文字の末尾の空白や、変換中の文字を消さない）。
  // 欄にすでに同じ語があるとき（戻るボタンなどでブラウザーが戻した文字。末尾の空白も残す）はそのままにする。違う語があるときは
  // URL の語にし、URL に ?q= がなければ欄を空にする（Firefox は、同じページの別の履歴で打った語を欄に戻すことがある）。
  // ただし、欄にフォーカスがあって文字が入っているとき（main.js が動く前に打ち始めていたとき）は、打った文字を残す
  if (searchInput && HU) {
    const q = HU.readState(window.location.search, {}).q;
    const typing = document.activeElement === searchInput && searchInput.value !== "";
    if (searchInput.value.trim() !== q && !typing) searchInput.value = q;
  }

  setupStartEntries(keepInPlace);

  document.getElementById("retry-data")?.addEventListener("click", loadData);

  // X共有ボタン
  const shareBtn = document.getElementById("share-on-x");
  shareBtn?.addEventListener("click", handleShareOnX);
  document.getElementById("share-copy-link")?.addEventListener("click", copyShareLink);
  document.getElementById("share-copy-url")?.addEventListener("focus", revealShareCopyField);

  // 全体リセット
  const resetBtn = document.getElementById("reset-all-progress");
  resetBtn?.addEventListener("click", handleResetAllProgress);

  // 「はじめ方」の初めの開閉。HTML では開いている。描く前に js/lang.js が html の data-start に書いた形（?book= で来たときは
  // closed、覚えた開閉があるときはその形）にし、書いていなければ画面の幅で決める（768px 以上は開き、狭い画面は畳む）。
  // CSS は js-ready が付くまで同じ決め方で中身を隠しているので、ここで畳んでも下の部品は動かない
  const startHere = document.getElementById("start-here");
  if (startHere) {
    const decided = document.documentElement.getAttribute("data-start");
    const narrow = !!(window.matchMedia && window.matchMedia(NARROW_MQ).matches);
    startHere.open = decided === "open" || (decided !== "closed" && !narrow);
    // 利用者が開閉したら、その形を覚えて次から使う（js/lang.js が読む）。開閉は click の既定の動きで変わるので、そのあとで読む。
    // toggle イベントは使わない（上のように JS で開閉を合わせたときにも出るため）
    startHere.querySelector("summary")?.addEventListener("click", () => {
      setTimeout(() => progressStore.setItem(START_KEY, startHere.open ? "open" : "closed"), 0);
    });
  }
  document.documentElement.classList.add("js-ready");
  reserveBookBanner();

  // URL の ?lang= を、描く前に決めた言語に合わせる（保存した言語が英語なら lang=en を付ける。履歴は増やさない）
  syncLangParam();

  // 再読み込みや「戻る」で開き直したときは、いつも先頭から始める。一覧はデータが届いてから描くので、
  // ブラウザーがスクロール位置を戻そうとすると、読み込み中に取っている高さ（一覧の1画面分）の所で止まり、
  // 読んでいた所でも先頭でもない中途半端な位置になる（一覧をあとから描く作りなので、もとから位置は戻らなかった）
  try {
    if ("scrollRestoration" in window.history) window.history.scrollRestoration = "manual";
  } catch (e) {
    /* 無視 */
  }

  updateLanguageUI();
}

// Start panels are visit-local. Keep their controls and focused links across language changes.
let startBooksSource = null;

function setupStartEntries(keepInPlace) {
  const choose = (panel, button) => {
    if (loadState !== "ready") return;
    markStartSeen();
    keepInPlace(button, () => {
      ["first", "books"].forEach((name) => {
        document.getElementById(`start-${name}-panel`).hidden = name !== panel;
        document.getElementById(`start-${name}-button`).setAttribute("aria-expanded", String(name === panel));
      });
    });
  };
  ["first", "books"].forEach((name) => {
    const button = document.getElementById(`start-${name}-button`);
    button.addEventListener("click", () => {
      if (!button.disabled) choose(name, button);
    });
  });
  const all = document.getElementById("start-all-button");
  all.addEventListener("click", () => {
    if (loadState !== "ready") return;
    markStartSeen();
    keepInPlace(all, () => openStartEntry(""));
    // The pushed entry needs the cleared, non-URL progress condition even if no scroll follows.
    saveViewInHistory();
  });
  document.querySelectorAll(".start-demo").forEach((link) => {
    link.addEventListener("click", (e) => {
      if (link.getAttribute("aria-disabled") === "true") e.preventDefault();
      else markStartSeen();
    });
  });
  // Book links keep the browser's modified-click behavior and use one in-page history entry.
  const list = document.getElementById("start-book-links");
  list.addEventListener("click", (e) => {
    const link = e.target.closest("a[data-book]");
    if (!link || !list.contains(link)) return;
    markStartSeen();
    if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (loadState !== "ready" || !books.some((book) => book.slug === link.dataset.book)) return;
    e.preventDefault();
    keepInPlace(link, () => openStartEntry(link.dataset.book));
  });
}

function updateStartEntries() {
  const ready = loadState === "ready";
  document.getElementById("start-first-button").disabled = !ready;
  document.getElementById("start-all-button").disabled = !ready;
  document.getElementById("start-books-button").disabled = !ready || !HB || !books.length;
  document.querySelectorAll(".start-demo").forEach((link) => {
    const tool = ready && tools.find((item) => item.hub !== false && item.id === link.dataset.toolId);
    const url = tool && tool.demo_url && (HU ? HU.demoLink(tool.demo_url, currentLang) : tool.demo_url);
    if (url) {
      link.href = url;
      link.removeAttribute("aria-disabled");
      link.removeAttribute("tabindex");
      link.setAttribute("aria-label", currentLang === "ja"
        ? `デモを開く（${tool.title}、新しいタブ）`
        : `Open demo (${tool.title}, new tab)`);
    } else {
      link.removeAttribute("href");
      link.setAttribute("aria-disabled", "true");
      link.setAttribute("tabindex", "-1");
    }
  });
  const list = document.getElementById("start-book-links");
  if (startBooksSource !== books) {
    startBooksSource = books;
    list.innerHTML = "";
    if (HB) books.forEach((book) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.dataset.book = book.slug;
      item.appendChild(link);
      list.appendChild(item);
    });
  }
  list.querySelectorAll("a[data-book]").forEach((link) => {
    const book = books.find((item) => item.slug === link.dataset.book);
    link.textContent = HB.bookLabel(book, currentLang);
    const url = new URL(window.location.pathname, window.location.origin);
    url.searchParams.set("book", book.slug);
    link.href = HU ? HU.withLang(url.toString(), currentLang) : url.toString();
  });
}

// Disclosure preference belongs to this visit, independently of a set hiding all filters.
function setupFilterDisclosure() {
  const meaningful = typeof HLOLang !== "undefined" && HLOLang.isBookArrival(location.search, location.hash);
  filtersExpanded = !meaningful;
  document.getElementById("filter-toggle").disabled = false;
  document.getElementById("filter-toggle")?.addEventListener("click", () => {
    filterDisclosureUsed = true;
    filtersExpanded = !filtersExpanded;
    updateFilterVisibility();
  });
  window.addEventListener("resize", () => {
    // Never hide the field being edited when crossing into the narrow layout.
    if (document.activeElement?.closest("#tool-filters")) filtersExpanded = true;
    updateFilterVisibility();
  });
  updateFilterVisibility();
}

function updateFilterVisibility() {
  const narrow = !!(window.matchMedia && window.matchMedia(NARROW_MQ).matches);
  const setActive = toolSet.ids.length > 0;
  const expanded = !setActive && (!narrow || filtersExpanded);
  const controls = document.getElementById("tool-filters");
  const toggle = document.getElementById("filter-toggle");
  if (controls) controls.hidden = !expanded;
  const back = document.getElementById("back-to-filters");
  if (back) back.hidden = loadState !== "ready" || setActive;
  if (toggle) {
    toggle.hidden = setActive || !narrow;
    toggle.setAttribute("aria-expanded", String(expanded));
  }
}

function backToFilters() {
  if (loadState !== "ready" || toolSet.ids.length) return;
  filterDisclosureUsed = true;
  filtersExpanded = true;
  updateFilterVisibility();
  const target = ["filter-book", "filter-category", "filter-progress", "filter-search-input"]
    .map((id) => document.getElementById(id)).find((el) => isShown(el) && !el.disabled);
  if (!target) return;
  // The document's scroll-padding keeps the region below a fixed header.
  document.getElementById("tool-filters").scrollIntoView({ block: "start", behavior: "auto" });
  target.focus({ preventScroll: true });
}

function revealFilterTarget(target) {
  if (!target?.closest("#tool-filters")) return target;
  if (toolSet.ids.length) return null;
  if (target.id === "filter-book" && document.getElementById("filter-book-group").hidden) target = document.getElementById("filter-search-input");
  filtersExpanded = true;
  updateFilterVisibility();
  return target;
}

function focusFilter(id, options, scrollToTarget = false) {
  const target = revealFilterTarget(document.getElementById(id));
  if (scrollToTarget) target?.scrollIntoView({ block: "nearest", behavior: "auto" });
  target?.focus(options);
}

// ?book= で来たときは、データが届く前にバナーの場所を取っておく（css の #book-banner.is-pending）。
// 中身は一覧と一緒に描き、本が見つからないときと読み込みに失敗したときは隠す
function reserveBookBanner() {
  let raw = null;
  try {
    raw = new URLSearchParams(window.location.search).get("book");
  } catch (e) {
    raw = null;
  }
  const v = raw ? raw.trim().toLowerCase() : "";
  if (!v || v === "all" || new URLSearchParams(window.location.search).has("tools")) return;
  const banner = document.getElementById("book-banner");
  if (!banner) return;
  banner.classList.add("is-pending");
  banner.hidden = false;
}

// 一覧の読み込み中の印（aria-busy）。CSS は "true" のあいだ一覧の高さを1画面分取り、
// カードが入ったときにフッターが画面の中から外へ飛ばないようにする。renderToolList は "true" のあいだ描かない
function setListBusy(busy) {
  const list = document.getElementById("tool-list");
  if (list) list.setAttribute("aria-busy", busy ? "true" : "false");
}

// 読み込みに失敗したときは、読み込み中のために取っておいた場所（一覧の高さ・本のバナー）を返す。
// 最初から置いている書籍・シリーズの欄も、選択肢がないまま残さないよう、books.json を読めなかったときと同じく隠す
function releaseReservedSpace() {
  setListBusy(false);
  const fallback = document.getElementById("load-fallback");
  if (fallback) fallback.hidden = false;
  const banner = document.getElementById("book-banner");
  if (banner && banner.classList.contains("is-pending")) {
    banner.classList.remove("is-pending");
    banner.hidden = true;
  }
  const bookGroup = document.getElementById("filter-book-group");
  if (bookGroup) bookGroup.hidden = true;
  const filtersEl = document.getElementById("tool-filters");
  if (filtersEl) filtersEl.classList.add("no-books");
}

// ---- ヘルプモーダル ----

function setupHelpModal() {
  const helpModal = document.getElementById("help-modal");
  const helpDialog = document.getElementById("help-dialog");
  const helpButton = document.getElementById("help-button");
  const helpClose = document.getElementById("help-close");

  if (!helpModal) return;

  // 念のため初期状態で隠しておく
  helpModal.hidden = true;

  // 開いたときにフォーカスを持っていた要素（閉じたらそこへ戻す）
  let returnFocusTo = null;

  const openHelp = () => {
    // マウスで押してもボタンへフォーカスが移らないブラウザー（Safari など）では body になるので、そのときは ? へ戻す
    const active = document.activeElement;
    returnFocusTo = active && active !== document.body ? active : helpButton;
    helpModal.hidden = false;
    // 開いているあいだは後ろのページを動かさない（css の html.help-open）。
    // スクロールバーが幅を取っていたときだけ、その幅を残して後ろのページが横にずれないようにする（css の keep-gutter）
    const root = document.documentElement;
    root.classList.toggle("keep-gutter", window.innerWidth - root.clientWidth > 1);
    root.classList.add("help-open");
    // ダイアログの中へフォーカスを移す（ダイアログ名が読み上げられる）
    (helpDialog || helpClose)?.focus();
    if (helpDialog) helpDialog.scrollTop = 0;
  };

  const closeHelp = () => {
    if (helpModal.hidden) return;
    helpModal.hidden = true;
    document.documentElement.classList.remove("help-open", "keep-gutter");
    const target =
      returnFocusTo && document.contains(returnFocusTo) ? returnFocusTo : helpButton;
    returnFocusTo = null;
    // 戻す先は固定ヘッダーの ? なので、スクロールさせない（scroll-padding-top があると Chromium がページを動かす）
    target?.focus({ preventScroll: true });
  };

  helpButton?.addEventListener("click", openHelp);
  document.getElementById("storage-warning-help")?.addEventListener("click", (e) => {
    e.currentTarget.focus({ preventScroll: true });
    openHelp();
    const heading = document.getElementById("help-storage");
    heading?.focus({ preventScroll: true });
    heading?.scrollIntoView({ block: "start", behavior: "auto" });
  });
  helpClose?.addEventListener("click", closeHelp);

  // オーバーレイ部分クリックで閉じる
  helpModal.addEventListener("click", (e) => {
    if (e.target === helpModal) closeHelp();
  });

  // Esc で閉じる。Tab / Shift+Tab はダイアログの中で循環させる（aria-modal）
  document.addEventListener("keydown", (e) => {
    if (helpModal.hidden) return;
    if (e.key === "Escape" || e.key === "Esc") {
      e.preventDefault();
      closeHelp();
      return;
    }
    if (e.key !== "Tab" || !helpDialog) return;
    const focusables = getFocusableElements(helpDialog);
    if (!focusables.length) {
      e.preventDefault();
      helpDialog.focus();
      return;
    }
    // Native Tab can skip links depending on browser/OS settings. Move every
    // step explicitly so it cannot leave the dialog before reaching our last item.
    e.preventDefault();
    const current = focusables.indexOf(document.activeElement);
    const next = current < 0
      ? (e.shiftKey ? focusables.length - 1 : 0)
      : (current + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
    focusables[next].focus();
  });
}

// 要素の中のフォーカスできる（かつ表示されている）要素を並び順で返す。
function getFocusableElements(container) {
  const selector =
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll(selector)).filter(
    (el) => el.getClientRects().length > 0
  );
}

// タブのキーボード操作で次に選ぶ位置（js/tabs.js）。読み込めていなければ同じ規則で計算する。
function nextTabIndex(key, current, count) {
  if (typeof HLOTabs !== "undefined") return HLOTabs.nextTabIndex(key, current, count);
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return -1;
}

// ---- データ読み込み ----

// A deadline includes response.json(), and Promise.race also bounds fetch implementations
// that do not observe AbortSignal. No partial response mutates the page state.
function boundedResult(promise, delay, controller, fallback) {
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      if (fallback) resolve(null);
      else reject(new Error("Catalog loading timed out"));
    }, delay);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function fetchCatalogJson(url, controller) {
  const response = await fetch(url, { signal: controller.signal });
  if (!response.ok) throw new Error(`Catalog request failed: ${response.status}`);
  return response.json();
}

function validateRequiredCatalog(nextCategories, catalog) {
  if (HG) HG.validateCategories(nextCategories);
  const text = (value) => typeof value === "string" && value.trim().length > 0;
  const strings = (value) => Array.isArray(value) && value.every((v) => typeof v === "string");
  const unique = (items, key) => new Set(items.map((item) => item[key])).size === items.length;
  const safeUrl = (value) => {
    try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password; }
    catch (_) { return false; }
  };
  if (!Array.isArray(nextCategories) || !nextCategories.length || !nextCategories.every((c) =>
    c && text(c.id) && /^[a-z0-9-]+$/.test(c.id) && text(c.ja) && text(c.en) &&
    [c.aliases_ja, c.aliases_en].every((v) => v === undefined || strings(v))) || !unique(nextCategories, "id")) throw new Error("Invalid categories catalog");
  if (!catalog || catalog.schema_version !== 1 || typeof catalog.generated_at !== "string" || !Array.isArray(catalog.tools) || !catalog.tools.some((t) => t && t.hub !== false)) throw new Error("Empty or invalid tools catalog");
  const ids = new Set(nextCategories.map((c) => c.id));
  if (!catalog.tools.every((t) => t && typeof t.id === "string" && /^day[0-9]{3}$/.test(t.id) && text(t.slug) && text(t.title) &&
    (t.hub === undefined || typeof t.hub === "boolean") && strings(t.category_ids) && t.category_ids.every((id) => ids.has(id)) &&
    [t.tags, t.category_ja, t.category_en].every((v) => v === undefined || strings(v)) &&
    [t.subtitle_ja, t.subtitle_en, t.description_ja, t.description_en].every((v) => v === undefined || typeof v === "string") &&
    safeUrl(t.repo_url) && (!t.demo_url || safeUrl(t.demo_url))) || !unique(catalog.tools, "id") || !unique(catalog.tools, "slug")) throw new Error("Invalid tools catalog");
}

function usableBooks(value) {
  // Optional data must never make a successful required catalog unusable.
  if (!HB || !value || !Array.isArray(value.books)) return [];
  try {
    if (!value.books.every((book) => book && typeof book.slug === "string" && book.slug &&
      typeof book.title_ja === "string" && typeof book.title_en === "string")) return [];
    if (HB.validateBooks(value, tools).length) return [];
    return value.books;
  } catch (_) { return []; }
}

function setLoadState(state) {
  loadState = state;
  if (state !== "ready") clearShareFeedback(false);
  document.getElementById("main-content").dataset.loadState = state;
  document.getElementById("catalog-loading").hidden = state !== "loading";
  document.getElementById("catalog-error").hidden = state !== "error";
  document.getElementById("load-fallback").hidden = state !== "error";
  document.getElementById("list-summary").hidden = state !== "ready";
  ["filter-book", "filter-category", "filter-progress", "filter-search-input"].forEach((id) => {
    document.getElementById(id).disabled = state !== "ready";
  });
  document.getElementById("retry-data").disabled = state !== "error";
  if (state !== "ready") ["share-on-x", "share-copy-link", "reset-all-progress"].forEach((id) => { document.getElementById(id).disabled = true; });
  updateRecordsUI();
  updateStartEntries();
}

async function loadData() {
  if (loadAttempt || loadState === "ready") return;
  cancelListStatus();
  const retry = document.getElementById("retry-data");
  const returnFocus = loadState === "error" && document.activeElement === retry;
  const focusGuard = { interaction: interactionVersion, navigation: navigationVersion, href: window.location.href };
  const attempt = { required: new AbortController(), optional: new AbortController(), groups: new AbortController() };
  loadAttempt = attempt;
  urlStateReady = false;
  setLoadState("loading");
  setListBusy(true);
  reserveBookBanner();
  const booksPromise = fetchCatalogJson("./data/books.json", attempt.optional).catch(() => null);
  const groupsPromise = fetchCatalogJson("./data/category_groups.json", attempt.groups).catch(() => null);
  const requiredPromise = Promise.all([
    fetchCatalogJson("./data/categories.json", attempt.required),
    fetchCatalogJson("./data/tools.json", attempt.required)
  ]);
  try {
    const [nextCategories, toolsJson] = await boundedResult(requiredPromise, 20000, attempt.required, false);
    validateRequiredCatalog(nextCategories, toolsJson);
    const [bJson, gJson] = await Promise.all([
      boundedResult(booksPromise, 3000, attempt.optional, true),
      boundedResult(groupsPromise, 3000, attempt.groups, true)
    ]);
    if (loadAttempt !== attempt) return;
    categories = nextCategories;
    categoryGroups = null;
    try { if (HG) categoryGroups = HG.validateGroups(gJson, nextCategories); } catch (_) { /* Optional metadata: use flat categories. */ }
    tools = toolsJson.tools;
    searchEntries = null;
    books = usableBooks(bJson);
    // （先に入れると、書籍データを待つあいだにフッターだけが先に描き変わる）
    catalogGeneratedAt = toolsJson.generated_at;
    updateCatalogDate();

    if (!HB) console.warn("books.js not loaded; book filter disabled");
    applyBooksAvailability();

    // URL の条件（?book=・?cat=・?q=・?tab=）で一覧を出す。存在しない本・カテゴリーは無視する
    const urlState = readUrlState();
    filters.book = urlState.book;
    filters.categoryId = urlState.cat;
    filters.fieldId = urlState.field;

    // 検索欄：描く前に欄の値で絞り、欄の文字と一覧を食い違わせない。URL の ?q= は開いたときに欄へ入れてあり（setupStaticUI）、
    // ここでは欄を書き換えない（読み込み中に打った文字を消さない）。戻るボタンや Firefox の再読み込みで開き直すと、ブラウザーが
    // 欄の文字を戻すことがあり、input は起きないので、その文字もここで読む
    const searchInput = document.getElementById("filter-search-input");
    if (searchInput) setSearchQuery(searchInput.value);

    // 初回または読み込み中に届いた最新の URL だけを解決する。
    const queuedNavigation = pendingNavigation;
    pendingNavigation = null;
    if (queuedNavigation && queuedNavigation.view && ["all", "0", "1", "2", "3"].includes(queuedNavigation.view.progress)) filters.progress = queuedNavigation.view.progress;
    applyToolLinks(queuedNavigation && hasSavedView(queuedNavigation.view));

    // 読めた条件だけを、URL に正規の形で書き直す（大文字や前後の空白・並びをそろえる。履歴は増やさない）。
    // カテゴリーと分野は有効な一方だけを残す。本・タブの未知値は既存の通知/表示規則に委ねる。
    const tidy = { q: searchInput ? searchInput.value : "", cat: filters.categoryId, field: filters.fieldId };
    if (urlState.book) tidy.book = filters.book;
    if (urlState.cat) tidy.cat = filters.categoryId;
    if (urlState.tab === "dashboard") tidy.tab = currentTab;
    if (toolSet.present) Object.assign(tidy, { book: filters.book, cat: filters.categoryId, q: filters.search });
    if (linkedToolId || linkNotices.includes("unknown")) Object.assign(tidy, { book: filters.book, cat: filters.categoryId, q: filters.search, tab: currentTab, tools: toolSet.ids.length ? toolSet.ids : null });
    const retryHrefUnchanged = focusGuard.href === window.location.href;
    commitUrl(tidy);
    if (!filterDisclosureUsed && (toolSet.present || linkedToolId || linkNotices.includes("unknown") ||
        (typeof HLOLang !== "undefined" && !HLOLang.hasBookParam(location.search)))) filtersExpanded = true;
    updateFilterVisibility();
    urlStateReady = true;

    setupFilterOptions();
    setLoadState("ready");
    setListBusy(false);
    renderAll();
    enableDashboardActions();
    lastNavigationHref = window.location.href;
    if (queuedNavigation && hasSavedView(queuedNavigation.view)) {
      if (queuedNavigation.interaction === interactionVersion) {
        restoreView(queuedNavigation.view, null);
        restoreFocus(queuedNavigation.view);
      }
    } else maybeScrollToHash();
    markCardsPainted();
    // Only replace focus lost with the retry button; respect any intervening interaction/navigation.
    if (returnFocus && focusGuard.interaction === interactionVersion && focusGuard.navigation === navigationVersion &&
        retryHrefUnchanged && !queuedNavigation && !linkedToolId &&
        (document.activeElement === retry || document.activeElement === document.body)) {
      const target = currentTab === "tools" && !toolSet.ids.length ? document.getElementById("filter-search-input") : document.getElementById(`tab-${currentTab}-label`);
      revealFilterTarget(target)?.focus({ preventScroll: true });
    }
  } catch (err) {
    if (loadAttempt !== attempt) return;
    console.error("Error loading data:", err);
    setLoadState("error");
    releaseReservedSpace();
  } finally {
    attempt.required.abort();
    attempt.optional.abort();
    attempt.groups.abort();
    if (loadAttempt === attempt) loadAttempt = null;
  }
}

// ダッシュボードの「Xで進捗をシェア」「すべて未着手にリセット」を押せるようにする（index.html では disabled）。
// データが届いてダッシュボードを描いたあとに呼ぶ。届く前（?tab=dashboard で開いたときや、読み込み中にタブを押したとき）に
// シェアを押すと、0本の数で投稿の文を作ってしまうため。読み込みに失敗したときは押せないまま
function enableDashboardActions() {
  ["share-on-x", "share-copy-link", "reset-all-progress"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = id !== "reset-all-progress" && !HSH;
  });
}

// 最初に一覧を描いた時刻に印を付ける（DevTools の Performance で見るため。1回だけ付け、外へは送らない）
let cardsPaintedMarked = false;
function markCardsPainted() {
  if (cardsPaintedMarked) return;
  cardsPaintedMarked = true;
  if (typeof performance === "undefined" || typeof performance.mark !== "function") return;
  // 描いたカードが画面に出たあと（次の描画が終わったあと）に付ける
  requestAnimationFrame(() =>
    setTimeout(() => {
      try {
        performance.mark("hlo:cards-painted");
      } catch (e) {
        /* 無視 */
      }
    }, 0)
  );
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

// 固定ヘッダーの高さを CSS 変数 --header-h に書く。html の scroll-padding-top がこれを使い、
// 章へ移動・Tab での移動・focus() のどれでも、ヘッダーの下に隠れない位置で止まるようにする。
// ヘッダーを固定しない画面（css の「ヘッダーを固定しない画面」。狭い画面と低い画面）では 0 を書く（画面の上端から 0.5rem の所に止まる）。
// ヘッダーの大きさが変わったとき（言語の切り替えなど）と、画面の大きさが変わったとき（高さだけが変わって、固定するかが替わる
// こともある。そのときヘッダーの大きさは変わらない）に書き直す
function applyHeaderHeightVar() {
  const header = document.getElementById("site-header");
  if (!header) return;
  const set = () => {
    const fixed = getComputedStyle(header).position === "sticky";
    document.documentElement.style.setProperty("--header-h", (fixed ? header.offsetHeight : 0) + "px");
  };
  set();
  try {
    new ResizeObserver(set).observe(header);
  } catch (e) {
    /* ResizeObserver のないブラウザーでは、画面の大きさが変わったときだけ書き直す */
  }
  window.addEventListener("resize", set);
}

// 一覧を読んでいる所の上端（画面のうち、ヘッダーに覆われていない所の上端）。ヘッダーを固定している画面ではヘッダーの下端、
// 固定しない画面では、ヘッダーが画面の外へ出たあとは画面の上端（0）
function readingTop(header) {
  return Math.max(0, header.getBoundingClientRect().bottom);
}

// 初回・URL 移動の #day / #book-group を、描いた見出しへ一度だけ移す。
function maybeScrollToHash() {
  const h = window.location.hash;
  if (!h) return;
  const card = linkedToolId && document.getElementById(linkedToolId);
  const el = card ? card.querySelector(".tool-title") : h.indexOf("#book-group-") === 0 ? document.getElementById(h.slice(1)) : null;
  if (el) {
    try {
      // 遠いカードと直前の項目を先に描き、content-visibility の仮の高さに着地しないようにする。
      const list = document.getElementById("tool-list");
      const items = list ? Array.from(list.children) : [];
      const index = items.indexOf(card || el);
      const held = index < 0 ? [] : items.slice(Math.max(0, index - 1), index + 1);
      held.forEach((item) => { item.classList.add("cv-hold"); item.getBoundingClientRect(); });
      el.scrollIntoView({ behavior: "instant", block: "start" });
      // 次の Tab がこの章から始まるように、見出しへフォーカスを移す（スクロールはし直さない）
      el.focus({ preventScroll: true });
      const href = window.location.href;
      const version = navigationVersion;
      const interaction = interactionVersion;
      const correct = () => {
        const active = document.activeElement;
        if (href === window.location.href && version === navigationVersion && interaction === interactionVersion && isShown(el) && (active === el || active === document.body)) {
          const padding = parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0;
          scrollByInstant(el.getBoundingClientRect().top - padding);
          // native fragment の既定処理が、popstate 内の focus のあとで body に戻すブラウザーがある。
          // 利用者がほかを操作していない場合だけ、同じ見出しへ戻す（URL の再解決はしない）。
          if (active === document.body) el.focus({ preventScroll: true });
        }
      };
      requestAnimationFrame(() => requestAnimationFrame(() => {
        correct();
        held.forEach((item) => item.classList.remove("cv-hold"));
        // 固定解除後にブラウザーがスクロールアンカーを補正する場合があるため、描画後に一度だけ位置を確かめる。
        requestAnimationFrame(() => requestAnimationFrame(correct));
      }));
    } catch (e) {
      /* 無視 */
    }
  }
}

// なめらかなスクロール（html の scroll-behavior: smooth）を使わずに、すぐ動かす。
function scrollByInstant(dy) {
  if (!dy || Math.abs(dy) < 1) return;
  try {
    window.scrollBy({ top: dy, left: 0, behavior: "instant" });
  } catch (e) {
    window.scrollBy(0, dy);
  }
}

// 一覧の途中で表示を作り直す前に、ヘッダーのすぐ下（ヘッダーを固定しない画面では、画面の上端）で読んでいた項目
// （カードか章の見出し）を覚える。一覧の先頭が見えているときは null（何もしない）。
// holdFrom は、作り直したあとに描くのを後回しにしない範囲の始め（restoreReadingAnchor を参照）。
// 画面の上端から1画面分の高さだけ上までにかかる、最初の項目の順番
function captureReadingAnchor() {
  const listEl = document.getElementById("tool-list");
  const header = document.getElementById("site-header");
  if (!listEl || !header || listEl.getClientRects().length === 0) return null;
  const hb = readingTop(header);
  if (listEl.getBoundingClientRect().top >= hb) return null;
  const items = listEl.children;
  let holdFrom = -1;
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (holdFrom < 0 && r.bottom > -window.innerHeight) holdFrom = i;
    if (r.top + r.height / 2 > hb) {
      return { index: i, offset: r.top - hb, holdFrom: holdFrom < 0 ? i : holdFrom };
    }
  }
  return null;
}

// 作り直したあと、同じ順番の項目がヘッダーの下（ヘッダーを固定しない画面では、画面の上端から）の同じ高さに来るようにスクロールする。
// 言語を切り替えても絞り込みの結果と並び順は変わらないので、順番で同じ項目を引ける。
function restoreReadingAnchor(anchor) {
  if (!anchor) return;
  const listEl = document.getElementById("tool-list");
  const header = document.getElementById("site-header");
  const el = listEl && listEl.children[anchor.index];
  if (!el || !header) return;
  // 画面の外のカードは描くのを後回しにしている（css の content-visibility。scroll anchoring のあるブラウザーだけ）。
  // 作り直したカードは仮の高さで並ぶので、そのまま合わせると、画面にかかるカードを描いたときに実際の高さに変わり、
  // 読んでいた項目が動く。読んでいた項目と、その上で画面にかかるカードは、一度描いて高さを覚えるまで後回しにしない
  // （css の .cv-hold）。言語で高さが変わっても足りるよう、もとの画面の上端から1画面分の高さだけ上までを含める。
  // それより上のカードは、描いて高さが変わってもブラウザーの scroll anchoring が見えている所を動かさない。
  // 上のカードを全部描くと、一覧の途中で切り替えたときに、まだ描いていないカードの分だけ遅くなる
  const from = Math.max(0, Math.min(anchor.holdFrom, anchor.index));
  const held = Array.prototype.slice.call(listEl.children, from, anchor.index + 1);
  held.forEach((c) => c.classList.add("cv-hold"));
  // 固定しないヘッダーは復元先で画面外へ流れるため、スクロール前の可視高さを引かない。
  const hb = getComputedStyle(header).position === "sticky" ? readingTop(header) : 0;
  scrollByInstant(el.getBoundingClientRect().top - hb - anchor.offset);
  // 次の描画が終わってから外す（描いたときに、カードの高さが覚えられる）
  requestAnimationFrame(() =>
    setTimeout(() => held.forEach((c) => c.classList.remove("cv-hold")), 0)
  );
}

// ---- UIレンダリング全体 ----

function renderAll(retainedIds) {
  if (loadState !== "ready") return;
  renderToolList(retainedIds);
  if (retainedIds) updateOutsideCards(false);
  renderDashboard();
}

// ---- 言語切替の表示制御 ----

function updateLanguageUI() {
  const isJa = currentLang === "ja";

  // ページの言語。.label-ja / .label-en の出し分けも、この lang を見て CSS で行う
  document.documentElement.lang = isJa ? "ja" : "en";

  // 読み上げ用のラベル（data-aria-label-ja / data-aria-label-en を持つ要素）
  document.querySelectorAll("[data-aria-label-ja]").forEach((el) => {
    const label = isJa ? el.dataset.ariaLabelJa : el.dataset.ariaLabelEn;
    if (label) el.setAttribute("aria-label", label);
  });

  // 言語ボタン
  const langJaBtn = document.getElementById("lang-ja");
  const langEnBtn = document.getElementById("lang-en");
  if (langJaBtn && langEnBtn) {
    // disabled にするとフォーカスが外れるので、押されている状態（aria-pressed）で今の言語を示す
    langJaBtn.setAttribute("aria-pressed", isJa ? "true" : "false");
    langEnBtn.setAttribute("aria-pressed", isJa ? "false" : "true");
  }

  // 検索プレースホルダ（index.html には書かない。英語で開いたときに、main.js が動く前の日本語の文を出さないため）
  const searchInput = document.getElementById("filter-search-input");
  if (searchInput) {
    searchInput.placeholder = isJa
      ? LIST_TEXT.search_placeholder[0]
      : LIST_TEXT.search_placeholder[1];
  }

  updateStartEntries();
  updateRecordsUI();
  updateCatalogDate();
  updateLinkedTitle();
}

// ---- タブ切替 ----

// タブのパネルの id と、URL の ?tab= の値（"tools" | "dashboard"）の対応
function tabName(targetId) {
  return targetId === "tab-dashboard" ? "dashboard" : "tools";
}

function switchTab(targetId) {
  if (currentTab !== tabName(targetId)) clearShareFeedback(false);
  cancelListStatus();
  currentTab = tabName(targetId);
  const panels = document.querySelectorAll(".tab-panel");
  panels.forEach((panel) => {
    panel.hidden = panel.id !== targetId;
  });

  // 選ばれたタブだけを Tab キーで止まる位置にする（roving tabindex）
  const tabButtons = document.querySelectorAll(".tab-button");
  tabButtons.forEach((btn) => {
    const selected = btn.getAttribute("data-tab-target") === targetId;
    btn.setAttribute("aria-selected", selected ? "true" : "false");
    btn.tabIndex = selected ? 0 : -1;
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
      addGroup("series", "プロジェクト", "Projects");
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

    const available = new Set(tools.filter((t) => t.hub !== false).flatMap((t) => t.category_ids || []));
    // Keep a URL-selected empty category visible so the active condition can be cleared.
    const visible = (id) => available.has(id) || filters.categoryId === id;
    const byId = new Map(categories.map((c) => [c.id, c]));
    const grouped = new Set();
    const addCategory = (parent, cat) => {
      if (!cat || !visible(cat.id)) return;
      const opt = document.createElement("option");
      opt.value = cat.id;
      opt.textContent = currentLang === "ja" ? cat.ja : cat.en;
      parent.appendChild(opt);
    };
    if (categoryGroups) categoryGroups.groups.forEach((group) => {
      group.category_ids.forEach((id) => grouped.add(id));
      if (!group.category_ids.some(visible) && filters.fieldId !== group.id) return;
      const optgroup = document.createElement("optgroup");
      optgroup.label = currentLang === "ja" ? group.ja : group.en;
      const all = document.createElement("option");
      all.value = "field:" + group.id;
      all.textContent = currentLang === "ja" ? group.ja + "（分野全体）" : group.en + " (all)";
      optgroup.appendChild(all);
      group.category_ids.forEach((id) => addCategory(optgroup, byId.get(id)));
      categorySelect.appendChild(optgroup);
    });
    categories.filter((cat) => !grouped.has(cat.id)).forEach((cat) => addCategory(categorySelect, cat));

    categorySelect.value = filters.categoryId || (filters.fieldId ? "field:" + filters.fieldId : "");
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

// ---- 一覧の条件と URL ----

// データを読み込み、URL の条件を一覧に入れたあとは true。そのあと URL に書くときは、画面の条件をすべて書く
let urlStateReady = false;

// URL の条件を、読み込んだデータで確かめて読む（js/url.js）。url.js を読めないときは、?book= だけを books.js で読む
function readUrlState() {
  const haveBooks = !!(HB && Array.isArray(books) && books.length);
  if (HU) {
    return HU.readState(window.location.search, {
      books: haveBooks ? books.map((b) => b.slug) : [],
      categories: Array.isArray(categories) ? categories.map((c) => c.id) : [],
      fields: categoryGroups ? categoryGroups.groups.map((g) => g.id) : []
    });
  }
  return {
    book: haveBooks ? HB.resolveBookParam(window.location.search, books) : "",
    cat: "",
    field: "",
    q: "",
    tab: "tools"
  };
}

// 画面に出している一覧の条件（URL に書く形）
function currentUrlState() {
  const searchInput = document.getElementById("filter-search-input");
  return {
    book: filters.book,
    cat: filters.categoryId,
    field: filters.fieldId,
    q: searchInput ? searchInput.value : "",
    tab: currentTab,
    tools: toolSet.ids.length ? toolSet.ids : null
  };
}

// 同じ欄を続けて変えたときに、履歴を1つにまとめる長さ（選択欄を矢印キーで動かすと、1段ごとに変わるため）
const MERGE_PUSH_MS = 1000;
// 最後に積んだ履歴（source は欄の名前、time は最後に変えた時刻、from は積む前の URL）
let lastPush = null;
// 積んだ履歴を外している途中（history.back() の popstate が届くまで）の印。dropPushedEntry を参照
let droppingPush = null;

// 一覧の条件を URL に書く（js/url.js）。partial に変えた条件を入れて、画面を変える前に呼ぶ。
// how が "push" のときは履歴を1つ積む（戻るで1つ前の一覧へ戻る）。積む前に、今の履歴へ見ていた位置を書いておく。
// それ以外は今の履歴を書き換え、履歴は増やさない（検索の入力・キーでのタブの切り替え・開いたときの表記の直し）。
// source を渡すと、同じ欄の続けた変更（前の変更から1秒以内）は積まずに書き換え、1つの履歴にまとめる。まとめた変更で
// 積む前の URL に戻ったときは、積んだ履歴を外す（残すと、戻るを1回押しても URL も一覧も変わらない）。
// データが届く前は、変えた条件だけを書く（本・カテゴリーはまだ URL から読んでいないので、上書きしない）
function commitUrl(partial, how, source) {
  if (!HU) return;
  if (droppingPush) {
    // 積んだ履歴を外している途中は、まだその履歴にいるので書かない。外し終えてから、画面の条件で書く（finishDropPush）
    if (how === "push" || !droppingPush.how) droppingPush.how = how === "push" ? "push" : "replace";
    if (source) droppingPush.source = source;
    return;
  }
  const state = urlStateReady ? Object.assign(currentUrlState(), partial) : partial;
  let next;
  try {
    next = HU.buildUrl(window.location.href, state);
  } catch (e) {
    return;
  }
  if (next === window.location.href) return;
  const now = Date.now();
  let push = how === "push";
  if (push && source && lastPush && lastPush.source === source && now - lastPush.time < MERGE_PUSH_MS) {
    if (next === lastPush.from) {
      dropPushedEntry();
      return;
    }
    push = false;
  }
  const from = window.location.href;
  try {
    if (push) {
      saveViewInHistory();
      window.history.pushState({}, "", next);
    } else {
      window.history.replaceState(window.history.state, "", next);
    }
  } catch (e) {
    return; /* file:// などでは無視 */
  }
  if (push) lastPush = { source: source || "", time: now, from };
  else if (source && lastPush && lastPush.source === source) lastPush.time = now;
}

// まとめた変更で積む前の URL に戻ったときに、積んだ履歴を外す（1つ前の履歴へ戻る。外した履歴は「進む」の先に残る）。
// 画面はもう1つ前の履歴の条件なので、その popstate では描き直さない。届くまでに変えた条件は、届いてから URL に書く。
// popstate が届かないときは1秒で待つのをやめ、今の履歴を画面の条件に書き換える（同じ URL の履歴が2つ並ぶ）
function dropPushedEntry() {
  lastPush = null;
  droppingPush = { how: "", source: "", timer: setTimeout(finishDropPush, MERGE_PUSH_MS) };
  try {
    window.history.back();
  } catch (e) {
    finishDropPush();
  }
}

function finishDropPush() {
  const d = droppingPush;
  if (!d) return;
  droppingPush = null;
  clearTimeout(d.timer);
  // 外しているあいだに言語を切り替えていたら ?lang= を合わせ、条件を変えていたら書く（どちらもなければ何もしない）
  syncLangParam();
  commitUrl({}, d.how === "push" ? "push" : undefined, d.source || undefined);
}

// URL の ?lang= を今の言語に合わせる（英語なら lang=en、日本語なら付けない。?lang=ja で開いたときは残す。js/url.js）。
// 言語のほかの条件は書き換えず、履歴は増やさない
function syncLangParam() {
  if (!HU) return;
  let next;
  try {
    next = HU.buildUrl(window.location.href, { lang: currentLang });
  } catch (e) {
    return;
  }
  if (next === window.location.href) return;
  try {
    window.history.replaceState(window.history.state, "", next);
  } catch (e) {
    /* file:// などでは無視 */
  }
}

// 今の履歴に、見ている位置（スクロールの位置と、一覧でヘッダーのすぐ下にある項目）と、フォーカスしている部品を書いておく。
// 戻る・進むでこの履歴へ戻ってきたときに、同じ所を出す（restoreView・restoreFocus）
function saveViewInHistory() {
  if (!urlStateReady) return;
  try {
    const view = { y: Math.round(window.scrollY), anchor: captureReadingAnchor(), focus: focusKey(document.activeElement), progress: filters.progress };
    window.history.replaceState(Object.assign({}, window.history.state, view), "");
  } catch (e) {
    /* 無視 */
  }
}

// ---- 戻る・進む ----

function setupHistory() {
  // 遅延したスクロール・フォーカス補正で、その間に始まった利用者の操作を奪わない。
  ["pointerdown", "keydown", "wheel"].forEach((type) => {
    window.addEventListener(type, () => { interactionVersion++; }, { capture: true, passive: true });
  });
  // commitUrl が積んだ履歴を外したとき（dropPushedEntry）の popstate では、画面がもう着いた履歴の条件なので描き直さない
  window.addEventListener("popstate", (e) => {
    if (droppingPush) { finishDropPush(); lastNavigationHref = window.location.href; }
    else applyHistoryState(e.state);
  });
  // 履歴移動は popstate のあとに hashchange も出る。1回だけ解決し、保存位置を上書きしない。
  window.addEventListener("hashchange", () => {
    if (window.location.href !== lastNavigationHref) applyHistoryState(null);
  });
  // スクロールが止まったら、今の履歴に位置を書く（進むで戻ってきたときも、離れたときの位置を出すため）
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(historyScrollTimer);
      if (!urlStateReady) return;
      const href = window.location.href;
      const version = navigationVersion;
      historyScrollTimer = setTimeout(() => {
        if (href === window.location.href && version === navigationVersion) saveViewInHistory();
      }, 300);
    },
    { passive: true }
  );
}

// 戻る・進むで来た履歴の URL から、一覧の条件（本・カテゴリー・検索・タブ）を戻して描き直し、その履歴で見ていた位置を出す。
// 条件が同じでも hash を解決する。保存位置があれば、hash への移動よりそちらを優先する。
function applyHistoryState(view) {
  cancelListStatus();
  lastPush = null; // 戻ったあとの変更は、まとめずに積む
  // 言語は戻る・進むで変えない。前の言語のときに積んだ履歴へ来たら、URL の ?lang= を今の言語に直す
  syncLangParam();
  navigationVersion++;
  clearTimeout(historyScrollTimer);
  // 描き直す前に、フォーカスしている部品と、そのパネルと目印を覚える（タブを切り替えたり、一覧・バナーを作り直したりしたあとでは、
  // フォーカスが body に移っていることがある）。描き直したあとに settleFocus で移す
  const focused = document.activeElement;
  const focusPanel = panelOf(focused);
  const focusedKey = focusKey(focused);
  const searchInput = document.getElementById("filter-search-input");
  if (!urlStateReady) {
    pendingNavigation = { view, interaction: interactionVersion };
    lastNavigationHref = window.location.href;
    // データが届く前はタブと検索欄だけを合わせる（本・カテゴリーは、データが届いたときに URL から読む）
    if (!HU) return;
    const st = HU.readState(window.location.search, {});
    if (st.tab !== currentTab) switchTab(st.tab === "dashboard" ? "tab-dashboard" : "tab-tools");
    if (searchInput && searchInput.value.trim() !== st.q) searchInput.value = st.q;
    settleFocus(view, focused, focusPanel, focusedKey);
    return;
  }
  const next = readUrlState();
  const filtersEl = document.getElementById("tool-filters");
  const filtersTop = currentTab === "tools" && filtersEl ? filtersEl.getBoundingClientRect().top : null;
  if (next.tab !== currentTab) switchTab(next.tab === "dashboard" ? "tab-dashboard" : "tab-tools");
  filters.book = next.book;
  filters.categoryId = next.cat;
  filters.fieldId = next.field;
  if (view && ["all", "0", "1", "2", "3"].includes(view.progress)) filters.progress = view.progress;
  if (searchInput && searchInput.value.trim() !== next.q) searchInput.value = next.q;
  setSearchQuery(next.q);
  applyToolLinks(hasSavedView(view));
  // Canonicalize only these keys; unknown book values still drive their notice.
  if (HU) {
    try {
      const url = HU.buildUrl(window.location.href, { cat: filters.categoryId, field: filters.fieldId });
      if (url !== window.location.href) window.history.replaceState(window.history.state, "", url);
    } catch (_) { /* Keep the restored state when history is unavailable. */ }
  }
  setupFilterOptions();
  refreshBookTarget();
  renderToolList();
  updateBookStatus();
  lastNavigationHref = window.location.href;
  if (hasSavedView(view)) {
    restoreView(view, filtersTop);
    restoreFocus(view);
  } else {
    restoreView(view, filtersTop);
    settleFocus(view, focused, focusPanel, focusedKey);
    maybeScrollToHash();
  }
}

// 戻る・進むで描き直したあとのフォーカス（restoreView が戻したスクロールの位置は動かさない）。
// タブが切り替わり、フォーカスしていた部品が隠れたパネルに残る → restoreFocus（履歴に書いておいた部品か、選ばれたタブのボタン）。
// 一覧やバナーを作り直して、フォーカスしていた部品が文書から外れた → restoreRebuiltFocus（履歴に書いておいた部品か、
// 作り直した同じ部品か、先頭の見出し）。フォーカスが選ばれていないタブのボタンに残る → focusSelectedTab
function settleFocus(view, focused, focusPanel, key) {
  if (focusPanel && focusPanel.hidden) restoreFocus(view);
  else if (focused && !focused.isConnected) restoreRebuiltFocus(focused, key, view && view.focus);
  else focusSelectedTab();
}

// 部品が入っているタブのパネル（無ければ null）
function panelOf(el) {
  return el && el.closest ? el.closest(".tab-panel") : null;
}

// フォーカスしている部品の目印。作り直した一覧・バナー・ダッシュボードの中から、同じ部品を引くのに使い（elementForFocusKey）、
// 履歴にも書く（restoreFocus）。タブのパネルの中の部品だけを書く（パネルの外の部品は作り直さず、タブを切り替えても隠れない）。
//   "#<id>"                       id のある部品（絞り込みの欄、バナーの書名、章の見出しなど）
//   "book:<本の slug>"            ダッシュボードの本の行
//   "tool:<種類>:<章>:<slug>"     カードの部品（種類は data-part の progress・demo・repo。章は、章ごとに並べたときの章の key）
//   "banner:<本の slug>:<種類>"   本のバナーの部品（種類は data-part の link・clear・jump・jump:<章の key>）
function focusKey(el) {
  if (!panelOf(el)) return null;
  if (el.classList.contains("book-progress-title") && el.dataset.book) return "book:" + el.dataset.book;
  const part = el.dataset.part;
  if (part) {
    const card = el.closest(".tool-card");
    if (card) return card.dataset.slug ? `tool:${part}:${card.dataset.group || ""}:${card.dataset.slug}` : null;
    if (el.closest("#book-banner")) return filters.book ? `banner:${filters.book}:${part}` : null;
  }
  return el.id ? "#" + el.id : null;
}

function elementForFocusKey(key) {
  if (typeof key !== "string") return null;
  if (key.indexOf("book:") === 0) {
    const slug = key.slice(5);
    return Array.from(document.querySelectorAll(".book-progress-title")).find((a) => a.dataset.book === slug) || null;
  }
  if (key.indexOf("tool:") === 0) {
    // 同じツールの同じ種類の部品。同じツールが複数の章に出るときは同じ章のものを、無ければ（本や章ごとの並びが変わったときなど）
    // 一覧で最初に出るものを返す
    const [, part, group, ...rest] = key.split(":");
    const slug = rest.join(":");
    let other = null;
    for (const card of document.querySelectorAll("#tool-list .tool-card")) {
      if (card.dataset.slug !== slug) continue;
      const el = Array.from(card.querySelectorAll("[data-part]")).find((x) => x.dataset.part === part);
      if (!el) continue;
      if ((card.dataset.group || "") === group) return el;
      if (!other) other = el;
    }
    return other;
  }
  if (key.indexOf("banner:") === 0) {
    // 同じ本のバナーの同じ部品（本が替わったときは無い）。章へ移動のリンクが畳んだ中にあるときは（狭い画面では、作り直すと
    // 畳む）、開閉の見出しを返す
    const el = Array.from(document.querySelectorAll("#book-banner [data-part]")).find((x) => focusKey(x) === key) || null;
    const details = el && el.closest("details");
    return details && !details.open ? details.querySelector("summary") : el;
  }
  return key.charAt(0) === "#" ? document.getElementById(key.slice(1)) : null;
}

// 要素が文書の中にあり、画面に出ているか（隠れたパネル・隠れたバナー・畳んだ中の部品は出ていない）
function isShown(el) {
  return !!el && el.isConnected && el.getClientRects().length > 0;
}

// 一覧・バナー・ダッシュボードの本の行を作り直して、フォーカスしていた部品 prev が文書から外れたときに、作り直した同じ部品へ
// フォーカスを戻す（そのままでは body に落ち、キーボード・読み上げの利用者が位置を失う）。key は作り直す前に focusKey で取った目印。
// 戻る・進むのときは、来た履歴に書いておいた部品の目印 savedKey（その履歴から次の履歴を積む直前にフォーカスしていた部品。
// saveViewInHistory）が表に出ていれば、そちらを先に使う。戻った一覧は、戻した位置（その履歴で見ていた所）で出るので、
// 作り直した同じ部品は画面の外にあることがある（カテゴリーを選んでからカードにフォーカスして戻ると、カードは1画面以上下にある）。
// どちらも無ければ、一覧かバナーの先頭の見出しへ移す（fallbackFocusTarget）。スクロールはしない。
// フォーカスがページの部品になかったとき（ページの何もない所を押したあとなど）、prev が残っているとき、フォーカスがもうほかの
// 部品へ移っているときは何もしない
function restoreRebuiltFocus(prev, key, savedKey) {
  if (!prev || prev === document.body || prev.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  let target = savedKey ? elementForFocusKey(savedKey) : null;
  target = revealFilterTarget(target);
  if (!isShown(target)) target = revealFilterTarget(elementForFocusKey(key));
  if (!isShown(target)) target = fallbackFocusTarget(key);
  if (target) target.focus({ preventScroll: true });
}

// 作り直したあとに同じ部品が無いときの移し先。バナーの部品だったらバナーの書名、一覧の部品だったら一覧の先頭の章の見出し
// （出ていなければもう一方）。どちらも出ていなければ（本を選んでいない一覧や、ダッシュボードなど）選ばれたタブのボタン
function fallbackFocusTarget(key) {
  const title = document.getElementById("book-banner-title");
  const heading = document.querySelector("#tool-list .book-group-heading");
  const inBanner = typeof key === "string" && (key.indexOf("banner:") === 0 || key === "#book-banner-title");
  const order = inBanner ? [title, heading] : [heading, title];
  return order.find(isShown) || document.querySelector('.tab-button[aria-selected="true"]');
}

// 戻る・進むでタブが切り替わり、フォーカスしていた部品が隠れたパネルに残ったときに呼ぶ（そのままでは body にフォーカスが落ち、
// キーボード・読み上げの利用者が位置を失う。ダッシュボードの本の行から一覧へ移って戻ったときなど）。履歴に書いておいた部品
// （積む前にフォーカスしていた本の行やカードのボタンなど）が表に出ていればそこへ、無ければ選ばれたタブのボタンへ移す。
// restoreView が戻したスクロールの位置は動かさない
function restoreFocus(view) {
  let target = revealFilterTarget(elementForFocusKey(view && view.focus));
  if (!target || !panelOf(target) || panelOf(target).hidden || !target.getClientRects().length) {
    target = document.querySelector('.tab-button[aria-selected="true"]');
  }
  if (target) target.focus({ preventScroll: true });
}

// 戻る・進むでタブが切り替わったときに、フォーカスがタブのボタンに残っていれば、選ばれたタブのボタンへ移す（タブのボタンを
// 押して切り替えてから戻ると、押したボタンにフォーカスが残る。そのボタンはもう選ばれておらず、読み上げではタブが替わった
// ことが伝わらない）。restoreView が戻したスクロールの位置は動かさない
function focusSelectedTab() {
  const active = document.activeElement;
  if (!active || !active.classList || !active.classList.contains("tab-button")) return;
  if (active.getAttribute("aria-selected") === "true") return;
  const selected = document.querySelector('.tab-button[aria-selected="true"]');
  if (selected) selected.focus({ preventScroll: true });
}

// 履歴に書いておいた位置を出す。一覧の途中なら、読んでいた項目を同じ高さに戻す（作り直したカードの仮の高さに惑わされない）。
// 位置が書かれていない履歴（積んですぐに離れた履歴を、進むで開いたときなど）は、絞り込み欄を画面の同じ高さに保つ
function restoreView(view, filtersTop) {
  const listEl = document.getElementById("tool-list");
  if (view && view.anchor && currentTab === "tools" && listEl && listEl.children[view.anchor.index]) {
    restoreReadingAnchor(view.anchor);
    return;
  }
  if (view && typeof view.y === "number") {
    try {
      window.scrollTo({ top: view.y, left: 0, behavior: "instant" });
    } catch (e) {
      window.scrollTo(0, view.y);
    }
    return;
  }
  const filtersEl = document.getElementById("tool-filters");
  if (filtersTop !== null && currentTab === "tools" && filtersEl) {
    scrollByInstant(filtersEl.getBoundingClientRect().top - filtersTop);
  }
}

// はじめて来た人が一覧を使い始めたら（「はじめ方」の入口を押す・本を選ぶ・進捗を付ける）、次からは「はじめ方」を閉じて始める
// （js/lang.js が読む）。開いて見せたのが読む前に消えないよう、開いただけ・見ただけでは残さない。利用者が開閉したあと
// （覚えた開閉があるとき）は変えない。保存できない環境では、このページを開いているあいだだけ覚える（js/storage.js）
function markStartSeen() {
  if (progressStore.getItem(START_KEY) === null) progressStore.setItem(START_KEY, "closed");
}

// 「はじめ方」の入口で本を選ぶ（slug が "" の「すべてのツール」は、カテゴリー・進捗・検索の条件も外す）。履歴を1つ積む
function openStartEntry(slug) {
  if (slug) {
    setBookFilter(slug, { history: "push" });
    return;
  }
  const hadBook = !!filters.book;
  commitUrl({ book: "", cat: "", field: "", q: "", tools: null, hash: "" }, "push");
  leaveToolSet();
  clearOtherFilters();
  setBookFilter("", { history: false, cleared: hadBook });
}

// カテゴリー・進捗・検索の条件と欄を空にする（描き直しはしない）
function clearOtherFilters() {
  filters.categoryId = "";
  filters.fieldId = "";
  filters.progress = "all";
  const c = document.getElementById("filter-category");
  const p = document.getElementById("filter-progress");
  const s = document.getElementById("filter-search-input");
  if (c) c.value = "";
  if (p) p.value = "all";
  if (s) s.value = "";
  setSearchQuery("");
}


// ---- 固有リンク・セット ----

function hasSavedView(view) {
  return !!view && (typeof view.y === "number" || !!view.anchor);
}

function applyToolLinks(preserveView) {
  if (!HU || !HU.readTools || !HU.readToolHash) return;
  copyGeneration++;
  const visibleIds = tools.filter((t) => t.hub !== false).map((t) => t.id);
  toolSet = HU.readTools(window.location.search, visibleIds);
  linkNotices = [];
  linkedToolId = "";
  if (toolSet.present) {
    if (!preserveView) switchTab("tab-tools");
    filters.book = "";
    clearOtherFilters();
    if (!toolSet.ids.length) linkNotices.push("empty");
    else if (toolSet.unknown) linkNotices.push("partial");
    if (toolSet.truncated) linkNotices.push("truncated");
  }
  const hash = HU.readToolHash(window.location.hash, visibleIds);
  // 利用者が絞り込みやタブを変更して離れた履歴では、その状態と保存位置を優先する。
  if (preserveView && hash.kind === "known") {
    refreshBookTarget();
    const target = tools.find((tool) => tool.id === hash.id);
    if (toolSet.ids.length ? toolSet.ids.includes(hash.id) : filterByBook(target) && filterByCategory(target) && filterByProgress(target) && filterBySearch(target)) linkedToolId = hash.id;
    return;
  }
  if (toolSet.ids.length) {
    if (hash.kind === "known" && toolSet.ids.includes(hash.id)) {
      linkedToolId = hash.id;
      switchTab("tab-tools");
      return;
    }
    if (hash.kind !== "known" && hash.kind !== "unknown") return;
    toolSet = { present: false, ids: [], unknown: false, truncated: false };
    linkNotices = hash.kind === "known" ? ["filters"] : [];
  }
  if (toolSet.present && hash.kind !== "known" && hash.kind !== "unknown") return;
  if (toolSet.present) {
    toolSet = { present: false, ids: [], unknown: false, truncated: false };
    linkNotices = [];
  }
  if (hash.kind === "unknown") {
    filters.book = "";
    clearOtherFilters();
    switchTab("tab-tools");
    linkNotices.push("unknown");
    return;
  }
  if (hash.kind !== "known") return;
  linkedToolId = hash.id;
  const tool = tools.find((t) => t.id === hash.id && t.hub !== false);
  refreshBookTarget();
  if (!filterByBook(tool)) { filters.book = ""; linkNotices.push("book"); }
  let cleared = false;
  if (!filterByCategory(tool)) { filters.categoryId = ""; filters.fieldId = ""; cleared = true; }
  if (!filterByProgress(tool)) { filters.progress = "all"; cleared = true; }
  if (!filterBySearch(tool)) {
    const input = document.getElementById("filter-search-input");
    if (input) input.value = "";
    setSearchQuery("");
    cleared = true;
  }
  if (cleared && !linkNotices.includes("filters")) linkNotices.push("filters");
  switchTab("tab-tools");
}

function leaveToolSet() {
  toolSet = { present: false, ids: [], unknown: false, truncated: false };
  linkNotices = [];
  linkedToolId = "";
  copyGeneration++;
}

// 手動の条件変更は単体リンクや空のセットから離れる操作。章の位置と有効なセットは維持する。
function clearToolHashForFilter() {
  if (!HU || !HU.readToolHash) return;
  const hash = HU.readToolHash(window.location.hash, tools.filter((t) => t.hub !== false).map((t) => t.id));
  const clearHash = hash.kind === "known" || hash.kind === "unknown";
  const emptySet = toolSet.present && !toolSet.ids.length;
  if (!clearHash && !emptySet) return;
  const change = {};
  if (emptySet) { leaveToolSet(); change.tools = null; }
  if (clearHash) change.hash = "";
  commitUrl(change);
  linkedToolId = "";
  linkNotices = [];
  renderLinkStatus();
  updateLinkedTitle();
}

function renderLinkStatus() {
  const status = document.getElementById("link-status");
  if (!status) return;
  const text = linkNotices.map((key) => LINK_TEXT[key][currentLang === "ja" ? 0 : 1]).join(" ");
  status.hidden = !text;
  if (status.textContent !== text) status.textContent = text;
}

function setTitle(n) {
  return currentLang === "ja" ? `このリンクのツール（${n}本）` : `Tools in this link (${n})`;
}

function updateLinkedTitle() {
  const isJa = currentLang === "ja";
  let title = toolSet.ids.length ? setTitle(toolSet.ids.length) : "";
  if (!title && linkedToolId) {
    const tool = tools.find((t) => t.id === linkedToolId && t.hub !== false);
    if (tool) title = isJa ? `${tool.title}（Day${tool.id.slice(3)}）` : `${tool.title} (Day${tool.id.slice(3)})`;
  }
  document.title = title ? title + (isJa ? "｜ハッキング・ラボ・オンライン" : " | Hacking Lab Online") : baseTitle();
}

function renderSetBanner() {
  const banner = document.getElementById("set-banner");
  const active = toolSet.ids.length > 0;
  updateFilterVisibility();
  if (!banner) return;
  banner.hidden = !active;
  const key = currentLang + ":" + toolSet.ids.join(",");
  if (banner.dataset.key === key) return;
  copyGeneration++;
  linkNotices = linkNotices.filter((notice) => notice !== "copied" && notice !== "copyFailed");
  banner.dataset.key = key;
  banner.innerHTML = "";
  if (!active) return;
  const isJa = currentLang === "ja";
  const header = document.createElement("div");
  header.className = "set-banner-header";
  const badge = document.createElement("span");
  badge.className = "book-banner-badge";
  badge.textContent = isJa ? "セット" : "Set";
  const title = document.createElement("h2");
  title.id = "set-banner-title";
  title.tabIndex = -1;
  title.textContent = setTitle(toolSet.ids.length);
  header.appendChild(badge);
  header.appendChild(title);
  banner.appendChild(header);
  const actions = document.createElement("div");
  actions.className = "set-banner-actions";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.id = "set-banner-clear";
  clear.textContent = isJa ? "解除" : "Clear";
  clear.setAttribute("aria-label", isJa ? "セットを解除して、すべてのツールを表示" : "Clear the set and show all tools");
  clear.addEventListener("click", () => {
    commitUrl({ tools: null, book: "", cat: "", q: "", hash: "" }, "push");
    leaveToolSet();
    filters.book = "";
    clearOtherFilters();
    setupFilterOptions();
    renderToolList();
    focusFilter("filter-book", { preventScroll: true });
  });
  const copy = document.createElement("button");
  copy.type = "button";
  copy.id = "set-banner-copy";
  copy.textContent = isJa ? "リンクをコピー" : "Copy link";
  copy.addEventListener("click", copySetLink);
  actions.appendChild(clear);
  actions.appendChild(copy);
  banner.appendChild(actions);
  const details = document.createElement("details");
  details.className = "set-banner-details";
  const summary = document.createElement("summary");
  summary.id = "set-banner-details-summary";
  summary.textContent = isJa ? "このリンクについて" : "About this link";
  const text = document.createElement("p");
  text.textContent = isJa
    ? "リンクを作った人が選んだツールを、選んだ順に並べています。進捗は、開いたブラウザーごとに別々に残ります。"
    : "These are the tools chosen by the person who made this link, in the order they chose. Progress is saved separately in each browser that opens it.";
  details.appendChild(summary);
  details.appendChild(text);
  banner.appendChild(details);
}

async function copySetLink() {
  if (!toolSet.ids.length) return;
  // 共有する URL は公開先・検証済みの番号・言語だけ。現在の未知 query や # はコピーしない。
  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set("tools", toolSet.ids.join(","));
  url.searchParams.set("lang", currentLang);
  const value = url.toString();
  const generation = ++copyGeneration;
  let copied = false;
  try {
    await navigator.clipboard.writeText(value);
    copied = true;
  } catch (e) { /* 読み取り専用の欄からコピーできる */ }
  if (generation !== copyGeneration || !toolSet.ids.length) return;
  linkNotices = linkNotices.filter((key) => key !== "copied" && key !== "copyFailed");
  linkNotices.push(copied ? "copied" : "copyFailed");
  renderLinkStatus();
  let field = document.getElementById("set-banner-copy-url");
  if (copied) { if (field) field.hidden = true; return; }
  if (!field) {
    field = document.createElement("input");
    field.id = "set-banner-copy-url";
    field.type = "text";
    field.readOnly = true;
    document.getElementById("set-banner")?.appendChild(field);
  }
  field.hidden = false;
  field.setAttribute("aria-label", currentLang === "ja" ? "リンクをコピー" : "Copy link");
  field.value = value;
  field.focus({ preventScroll: true });
  field.select();
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

// 本の種別の札（書籍／プロジェクト）。
function bookKindLabel(book) {
  const isJa = currentLang === "ja";
  if (book.kind === "series") return isJa ? "プロジェクト" : "Project";
  return isJa ? "書籍" : "Book (in Japanese)";
}

// 件数の括弧を言語ごとに出し分ける（日本語は全角、英語は半角＋スペース）。
function countSuffix(n) {
  return currentLang === "ja" ? `（${n}本）` : ` (${n} ${n === 1 ? "tool" : "tools"})`;
}

// 本を選ぶ/外す。URL・select・読み上げを更新して再描画する。
// URL の ?book= も書く（本を切り替え/解除したら、前の本の章へ移動の # は外す。js/url.js）。
// opts.history："push" は履歴を積む（選択欄・解除・「はじめ方」の入口）。false は URL に書かない（戻る・進む、
// 呼ぶ側で書いたとき）。既定は今の履歴を書き換える。opts.source は commitUrl の同じ欄の変更をまとめるための名前
function setBookFilter(slug, opts) {
  cancelListStatus();
  const o = opts || {};
  if (o.history !== false) commitUrl({ book: slug || "", tools: null, hash: "" }, o.history, o.source);
  leaveToolSet();
  filters.book = slug || "";
  const sel = document.getElementById("filter-book");
  if (sel) sel.value = filters.book;
  refreshBookTarget();
  renderToolList();
  if (o.cleared) announceListStatus(currentLang === "ja" ? "書籍・プロジェクトの絞り込みを解除しました。" : "Book or project filter cleared.");
  else updateBookStatus();
}

// 本の選択・履歴移動も、件数と0件案内を共通のstatusで通知する。
function updateBookStatus() {
  announceListCount();
}

// ---- ツール一覧の描画 ----

function renderToolList(retainedIds, announceBookNotice = true) {
  const listEl = document.getElementById("tool-list");
  if (!listEl) return;
  // データが届くまでは描かない。読み込み中に言語を切り替えたり検索欄に入力したりしても、空のデータで
  // 「一致するツールがありません」を出したり、?book= のために取っておいたバナーの場所を外したりしない
  // （外すと、データが届いたときにバナーがまた下の部品を押し下げる）。データが届くと、loadData が印を外してから描く
  if (listEl.getAttribute("aria-busy") === "true") return;
  if (loadState !== "ready") return;

  refreshBookTarget();
  refreshShareUI();
  removeUnusedCategoryChoices();
  const book = toolSet.ids.length ? null : currentBook();
  renderSetBanner();
  renderLinkStatus();
  updateLinkedTitle();

  const baseMatch = (t) =>
    t.hub !== false &&
    filterByBook(t) &&
    filterByCategory(t) &&
    filterByProgress(t) &&
    filterBySearch(t);

  const byId = new Map(tools.filter((t) => t.hub !== false).map((t) => [t.id, t]));
  const matched = toolSet.ids.length ? toolSet.ids.map((id) => byId.get(id)).filter(Boolean) : retainedIds ? tools.filter((t) => t.hub !== false && retainedIds.has(t.id)) : tools.filter(baseMatch);

  // 出すものが前回と同じなら作り直さない（検索の1文字ごとに全部のカードを作り直すと、遅い端末で固まる）。
  // 言語・本・進捗が変わったときは、同じツールの並びでも文字・掲載箇所・進捗の表示が変わるので作り直す
  const listKey = [
    currentLang,
    filters.book,
    filters.categoryId,
    filters.fieldId,
    filters.progress,
    filters.search,
    toolSet.ids.join(","),
    progressVersion,
    matched.map((t) => t.id).join(",")
  ].join("|");
  if (listKey === lastListKey && listEl.firstElementChild) { updateListCount(); updateBookViewMetadata(announceBookNotice); return; }
  lastListKey = listKey;
  shownToolIds = new Set(matched.map((t) => t.id));
  outsideToolIds.clear();
  updateListCount();

  listEl.innerHTML = "";
  // 章の重複掲載でも同じ id は最初のカードだけに付ける。
  const renderedIds = new Set();
  const makeCard = (tool) => {
    const card = createToolCard(tool, book);
    if (!renderedIds.has(tool.id)) { card.id = tool.id; renderedIds.add(tool.id); }
    return card;
  };
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
  // 章ごとに並べるときは、画面の外のカードの描画を後回しにしない（css の .is-grouped。章へ移動の止まる位置を保つ）
  listEl.classList.toggle("is-grouped", !!displayGroups);

  if (displayGroups) {
    if (!displayGroups.length) {
      appendEmptyState(listEl, book);
      updateBookViewMetadata(announceBookNotice);
      return;
    }
    displayGroups.forEach((g) => {
      const h = document.createElement("h3");
      h.className = "book-group-heading";
      h.id = `book-group-${g.key}`;
      h.tabIndex = -1;
      const label = HB.chapterTitle(book, g.key, currentLang);
      h.textContent = `${label}${countSuffix(g.items.length)}`;
      const header = document.createElement("div");
      header.className = "book-group-header";
      header.appendChild(h);
      if (displayGroups.length >= 2) header.appendChild(createBackToSections());
      listEl.appendChild(header);
      g.items.forEach((tool) => {
        const card = makeCard(tool);
        // 同じツールが複数の章に出るとき、作り直したあとに同じ章のカードへフォーカスを戻すため（focusKey）
        card.dataset.group = g.key;
        listEl.appendChild(card);
      });
    });
    if (displayGroups.length >= 2) listEl.appendChild(createBackToSections(true));
    updateBookViewMetadata(announceBookNotice);
    return;
  }

  if (matched.length === 0) {
    appendEmptyState(listEl, book);
    updateBookViewMetadata(announceBookNotice);
    return;
  }

  matched.forEach((tool) => {
    listEl.appendChild(makeCard(tool));
  });
  updateBookViewMetadata(announceBookNotice);
}

function appendEmptyState(listEl, book) {
  const box = document.createElement("div");
  box.className = "list-empty";
  const p = document.createElement("p");
  p.textContent = listText(book ? "empty_book" : "empty", { book: book && HB ? HB.bookLabel(book, currentLang) : "" });
  const clear = document.createElement("button");
  clear.id = "clear-filters";
  clear.type = "button";
  clear.textContent = listText(book ? "clear_except_book" : "clear_all");
  clear.addEventListener("click", () => {
    cancelListStatus();
    commitUrl({ cat: "", field: "", q: "", hash: "" }, "push");
    linkedToolId = "";
    linkNotices = [];
    filters.categoryId = "";
    filters.fieldId = "";
    filters.progress = "all";
    setSearchQuery("");
    document.getElementById("filter-category").value = "";
    document.getElementById("filter-progress").value = "all";
    const search = document.getElementById("filter-search-input");
    search.value = "";
    renderToolList(undefined, false);
    focusFilter("filter-search-input", { preventScroll: true }, true);
    announceListCount(0, true);
  });
  box.appendChild(p);
  box.appendChild(clear);
  listEl.appendChild(box);
}

// 選択中の本のバナー（札・書名・件数・リンク・解除・注記・章ジャンプ）。
function renderBookBanner(book, shownCount, displayGroups) {
  const banner = document.getElementById("book-banner");
  if (!banner) return;
  banner.classList.remove("is-pending"); // 読み込み中に取っておいた場所を、中身で置き換える
  if (!book) {
    const oldJump = banner.querySelector(".book-jump");
    if (oldJump && banner.dataset.book) bookJumpStates.set(banner.dataset.book, oldJump.open);
    banner.hidden = true;
    banner.innerHTML = "";
    return;
  }
  const oldJump = banner.querySelector(".book-jump");
  if (oldJump && banner.dataset.book) bookJumpStates.set(banner.dataset.book, oldJump.open);
  banner.dataset.book = book.slug;
  banner.hidden = false;
  banner.innerHTML = "";
  const isJa = currentLang === "ja";
  const n = bookTargetSet ? bookTargetSet.size : 0;

  // 種別の札
  const badge = document.createElement("span");
  badge.className = "book-banner-badge";
  badge.textContent = bookKindLabel(book);
  banner.appendChild(badge);
  if (book.relation === "related") {
    const related = document.createElement("span");
    related.className = "book-banner-badge";
    related.textContent = isJa ? "関連ツール" : "Related tools";
    banner.appendChild(related);
  }

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
  count.textContent = isJa ? `該当${unit}` : unit;
  meta.appendChild(count);

  // リンク・解除・章へ移動の data-part は、バナーを作り直したあとに同じ部品へフォーカスを戻すための目印（focusKey）
  if (isHttpUrl(book.url)) {
    const link = document.createElement("a");
    link.className = "book-banner-link";
    link.dataset.part = "link";
    link.href = book.url;
    link.rel = "noopener";
    link.target = "_blank";
    link.textContent = isJa
      ? (book.url_label_ja || "紹介ページを開く") + "（新しいタブ）"
      : (book.url_label_en || "Open book page") + " (new tab)";
    meta.appendChild(link);
  }

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "book-banner-clear";
  clearBtn.dataset.part = "clear";
  clearBtn.textContent = isJa ? "解除" : "Clear";
  clearBtn.setAttribute("aria-label", isJa ? "書籍・プロジェクトの絞り込みを解除" : "Clear book or project filter");
  clearBtn.addEventListener("click", () => {
    setBookFilter("", { cleared: true, history: "push" });
    focusFilter("filter-book");
  });
  meta.appendChild(clearBtn);

  banner.appendChild(meta);

  const duplicateNote = document.createElement("p");
  duplicateNote.id = "book-duplicate-note";
  duplicateNote.className = "book-banner-note";
  duplicateNote.hidden = true;
  banner.appendChild(duplicateNote);

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
    details.open = bookJumpStates.get(book.slug) || false;
    const summary = document.createElement("summary");
    summary.dataset.part = "jump";
    summary.id = "book-jump-summary";
    summary.textContent = isJa ? "章・節へ移動" : "Jump to section";
    details.appendChild(summary);
    displayGroups.forEach((g) => {
      const a = document.createElement("a");
      a.className = "book-jump-link";
      a.dataset.part = "jump:" + g.key;
      a.href = `#book-group-${g.key}`;
      const label = HB.chapterTitle(book, g.key, currentLang);
      a.textContent = `${label}${countSuffix(g.items.length)}`;
      a.addEventListener("click", (e) => {
        e.preventDefault();
        const target = document.getElementById(`book-group-${g.key}`);
        if (target) {
          target.scrollIntoView();
          // なめらかなスクロールの途中で focus() が位置を計算し直さないようにする
          target.focus({ preventScroll: true });
        }
        // 章へ移動は履歴を積まずに書き換える（積んでも、戻ったときに前の章の見出しの位置には戻らず、ずれるため）。
        // 履歴に書いておいた見ていた位置（state）は消さない
        try {
          window.history.replaceState(window.history.state, "", "#book-group-" + g.key);
          linkedToolId = "";
          updateLinkedTitle();
        } catch (err) {
          /* 無視 */
        }
      });
      details.appendChild(a);
    });
    banner.appendChild(details);
  }
}

function createBackToSections(atEnd = false) {
  const link = document.createElement("a");
  link.className = "book-back-to-sections" + (atEnd ? " book-back-to-sections-end" : "");
  link.href = "#book-jump-summary";
  link.textContent = currentLang === "ja" ? "章・節の一覧へ" : "Back to sections";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    const summary = document.getElementById("book-jump-summary");
    if (!summary) return;
    summary.closest("details").open = true;
    summary.scrollIntoView();
    summary.focus({ preventScroll: true });
  });
  return link;
}

// Count retained DOM cards, including those now outside the progress condition.
// Updating this metadata never replaces the focused card or banner controls.
function updateBookViewMetadata(announceNotice = true) {
  const note = document.getElementById("book-duplicate-note");
  const cards = Array.from(document.querySelectorAll("#tool-list .tool-card"));
  const unique = new Set(cards.map((card) => card.dataset.toolId)).size;
  if (note) {
    const duplicate = cards.length > unique;
    note.hidden = !duplicate;
    const text = !duplicate ? "" : currentLang === "ja"
      ? `複数の章・節に関係するツールは、それぞれの章・節にカードを並べています（カードは${cards.length}枚）。`
      : `Tools related to more than one chapter or section appear under each of them (${cards.length} cards).`;
    if (note.textContent !== text) note.textContent = text;
  }
  renderBookNotice(unique, announceNotice);
}

function renderBookNotice(shown, announce = true) {
  const notice = document.getElementById("book-notice");
  if (!notice) return;
  const requested = typeof HLOLang !== "undefined" && HLOLang.hasBookParam(location.search);
  // Resolve notices after set/hash precedence. Never expose an unknown raw value.
  const applicable = requested && !filters.book && !toolSet.present && !linkedToolId && !linkNotices.includes("unknown");
  if (!applicable) {
    notice.hidden = true;
    if (notice.dataset.key) {
      cancelListStatus();
      const status = document.getElementById("book-status");
      const oldMessage = document.getElementById("book-notice-title").textContent + " " + document.getElementById("book-notice-text").textContent;
      if (status && status.textContent === oldMessage) status.textContent = "";
      document.getElementById("book-notice-title").textContent = "";
      document.getElementById("book-notice-text").textContent = "";
      notice.dataset.key = "";
    }
    return;
  }
  const isJa = currentLang === "ja";
  const unknown = books.length > 0;
  const all = shown === new Set(tools.filter((t) => t.hub !== false).map((t) => t.id)).size;
  const key = [navigationVersion, currentLang, unknown, all].join(":");
  notice.hidden = false;
  if (notice.dataset.key === key) return;
  notice.dataset.key = key;
  document.getElementById("book-notice-title").textContent = unknown
    ? (isJa ? "指定された本が見つからない" : "Book not found")
    : (isJa ? "本の一覧を読み込めなかった" : "Couldn't load the book list");
  document.getElementById("book-notice-text").textContent = unknown
    ? (all ? (isJa ? "リンクで指定された本やプロジェクトが見つからないため、すべてのツールを表示しています。" : "The book or project in this link was not found, so all tools are shown. ") : "") + (isJa ? "「書籍・プロジェクト」から選べます。" : "You can choose one under “Books & projects.”")
    : (all ? (isJa ? "そのため、すべてのツールを表示しています。" : "All tools are shown instead. ") : "") + (isJa ? "しばらくしてから、ページを読み込み直してください。" : "Please reload the page in a little while.");
  if (announce) announceListStatus(document.getElementById("book-notice-title").textContent + " " + document.getElementById("book-notice-text").textContent);
}

function filterByBook(tool) {
  if (!filters.book) return true;
  if (!bookTargetSet) return true; // 本が解決できないときは絞らない
  return bookTargetSet.has(tool.id);
}

function filterByCategory(tool) {
  const ids = tool.category_ids || [];
  if (filters.categoryId) return ids.includes(filters.categoryId);
  const field = categoryGroups?.byId.get(filters.fieldId);
  return !field || field.category_ids.some((id) => ids.includes(id));
}

function filterByProgress(tool) {
  if (filters.progress === "all") return true;
  const level = getProgress(tool.slug);
  return String(level) === filters.progress;
}

function filterBySearch(tool) {
  if (!filters.search) return true;

  // 全角と半角・大文字と小文字をそろえ、空白で区切った語をすべて含むツールを出す（js/search.js）
  if (HS) {
    if (!searchEntries) {
      const catIndex = HS.categoryIndex(categories);
      searchEntries = new Map(tools.map((t) => [t, HS.buildEntry(t, catIndex)]));
    }
    return HS.matches(searchEntries.get(tool), searchTerms);
  }

  // js/search.js を読めないときは、これまでどおり入力全体を部分一致で探す（前後の空白は setSearchQuery で除く）
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
  return text.includes(filters.search);
}

// 検索欄の値を検索語にして filters に入れる（描き直しはしない）。
function setSearchQuery(raw) {
  if (HS) {
    searchTerms = HS.parseQuery(raw);
    filters.search = searchTerms.join(" ");
  } else {
    filters.search = String(raw == null ? "" : raw).trim().toLowerCase();
  }
}

// 検索欄の値で絞り込む。正規化した検索語が前と同じとき（後ろに空白を足しただけなど）は描き直さない。
// URL の ?q= は欄の文字に合わせる（打つたびに履歴を増やさないよう、今の履歴を書き換える）
function applySearch(raw) {
  clearToolHashForFilter();
  commitUrl({ q: raw });
  const before = filters.search;
  setSearchQuery(raw);
  if (filters.search === before) return;
  renderToolList(undefined, false);
  announceListCount(700, true);
}

function createToolCard(tool, book) {
  const card = document.createElement("article");
  card.className = "tool-card";
  // ツールの slug と、下のボタン・リンクの data-part は、一覧を作り直したあとに同じ部品へフォーカスを戻すための目印（focusKey）
  card.dataset.slug = tool.slug || "";
  card.dataset.toolId = tool.id;
  const outside = document.createElement("span");
  outside.className = "tool-outside-label";
  outside.hidden = true;
  card.appendChild(outside);
  if (!toolSet.ids.length && filters.progress !== "all") {
    const space = document.createElement("span");
    space.className = "tool-outside-space";
    space.setAttribute("aria-hidden", "true");
    space.textContent = listText("outside_label", { progress: PROGRESS_LABELS[currentLang][Number(filters.progress)] });
    card.appendChild(space);
  }

  const header = document.createElement("div");
  header.className = "tool-card-header";

  const daySpan = document.createElement("span");
  daySpan.className = "tool-day";
  const dayNumber = tool.id?.startsWith("day")
    ? tool.id.slice(3)
    : tool.id || "";
  daySpan.textContent = `Day${dayNumber}`;
  daySpan.setAttribute("aria-hidden", "true");

  const titleSpan = document.createElement(book && Array.isArray(book.chapters) && book.chapters.length ? "h4" : "h3");
  titleSpan.className = "tool-title";
  titleSpan.tabIndex = -1;
  titleSpan.dataset.part = "title";
  titleSpan.textContent = tool.title || "";
  titleSpan.setAttribute("aria-label", `Day${dayNumber} ${tool.title || ""}`);

  if (toolSet.ids.length) {
    const position = document.createElement("span");
    position.className = "tool-set-position";
    const i = toolSet.ids.indexOf(tool.id) + 1;
    position.textContent = `${i} / ${toolSet.ids.length}`;
    position.setAttribute("aria-label", currentLang === "ja" ? `${toolSet.ids.length}本中${i}本目` : `${i} of ${toolSet.ids.length}`);
    header.appendChild(position);
  }
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

  // 不明な難易度を星1つとして表示しない。
  if (Number.isInteger(tool.difficulty) && tool.difficulty >= 1 && tool.difficulty <= 5) {
    const diffSpan = document.createElement("span");
    diffSpan.className = "tool-difficulty";
    diffSpan.setAttribute("role", "img");
    diffSpan.setAttribute("aria-label", currentLang === "ja" ? `難易度：5段階中${tool.difficulty}` : `Difficulty: ${tool.difficulty} of 5`);
    const visibleRating = document.createElement("span");
    visibleRating.setAttribute("aria-hidden", "true");
    const stars = "★".repeat(tool.difficulty) + "☆".repeat(5 - tool.difficulty);
    visibleRating.textContent = currentLang === "ja" ? `難易度：${stars}` : `Difficulty: ${stars}`;
    diffSpan.appendChild(visibleRating);
    meta.appendChild(diffSpan);
  }

  const catSpan = document.createElement("span");
  catSpan.className = "tool-categories";
  const labels = getCategoryLabels(tool);
  catSpan.textContent = labels.join(", ");

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
  // 英語表示のときは、デモに ?lang=en を付け、GitHub は英語の README を開く（js/url.js。日本語表示のリンクは変えない）
  let demoBtn = null;
  if (tool.demo_url) {
    demoBtn = document.createElement("a");
    demoBtn.href = HU ? HU.demoLink(tool.demo_url, currentLang) : tool.demo_url;
    demoBtn.target = "_blank";
    demoBtn.rel = "noopener";
    demoBtn.className = "tool-button";
    demoBtn.dataset.part = "demo";
    demoBtn.textContent = currentLang === "ja" ? "デモ" : "Demo";
    demoBtn.setAttribute("aria-label", currentLang === "ja" ? `デモ（${tool.title}、新しいタブで開く）` : `Demo (${tool.title}, opens in a new tab)`);
  }

  const repoBtn = document.createElement("a");
  repoBtn.href = (HU ? HU.repoLink(tool.repo_url, currentLang) : tool.repo_url) || "#";
  repoBtn.target = "_blank";
  repoBtn.rel = "noopener";
  repoBtn.className = "tool-button secondary";
  repoBtn.dataset.part = "repo";
  repoBtn.textContent = "GitHub";
  repoBtn.setAttribute("aria-label", currentLang === "ja" ? `GitHub（${tool.title}、新しいタブで開く）` : `GitHub (${tool.title}, opens in a new tab)`);

  const progressLabel = document.createElement("label");
  progressLabel.className = "tool-progress-control";
  const progressCaption = document.createElement("span");
  progressCaption.className = "tool-progress-caption";
  progressCaption.textContent = currentLang === "ja" ? "進捗" : "Progress";
  const progressSelect = document.createElement("select");
  progressSelect.className = "tool-progress-select";
  progressSelect.dataset.part = "progress";
  progressSelect.dataset.slug = tool.slug;
  progressSelect.setAttribute("aria-label", currentLang === "ja" ? `進捗（${tool.title}）` : `Progress (${tool.title})`);
  PROGRESS_LABELS[currentLang].forEach((stage, level) => {
    const option = document.createElement("option");
    option.value = String(level);
    option.textContent = stage;
    progressSelect.appendChild(option);
  });
  updateProgressSelect(progressSelect, tool.slug);
  progressLabel.appendChild(progressCaption);
  progressLabel.appendChild(progressSelect);

  progressSelect.addEventListener("change", () => {
    // A native choice changes directly to that stage; malformed or unchanged values do not write.
    if (!/^[0-3]$/.test(progressSelect.value)) {
      updateProgressSelect(progressSelect, tool.slug);
      return;
    }
    const level = Number(progressSelect.value);
    if (level === getProgress(tool.slug)) return;
    setProgress(tool.slug, level);
    markStartSeen();
    syncProgressControls(tool.slug);
    renderDashboard();
  });

  if (demoBtn) footer.appendChild(demoBtn);
  footer.appendChild(repoBtn);
  footer.appendChild(progressLabel);

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

// 読み書きは progressStore 経由（例外を投げず、使えない環境ではメモリーに退避する）。
function normalizeProgress(raw) {
  const num = Number(raw);
  return raw !== null && Number.isInteger(num) && num >= 0 && num <= 3 ? num : 0;
}

function getProgress(slug) {
  return normalizeProgress(progressStore.getItem(`progress_${slug}`));
}

function setProgress(slug, level) {
  progressStore.setItem(`progress_${slug}`, String(level));
  progressVersion++; // 次に一覧を描くときは作り直す（全部リセットしたあとに、古い進捗の表示を残さない）
}

function updateProgressSelect(select, slug) {
  const level = getProgress(slug);
  // Keep options and the focused native control in place during local/cross-tab updates.
  select.value = String(level);
  select.classList.remove("progress-0", "progress-1", "progress-2", "progress-3");
  select.classList.add(`progress-${level}`);
}

// 同じ slug の進捗選択欄をすべて更新する（章をまたいで同じツールが出る場合の同期）。
function syncProgressControls(slug) {
  let sel;
  try {
    sel = `.tool-progress-select[data-slug="${CSS.escape(slug)}"]`;
  } catch (e) {
    sel = ".tool-progress-select";
  }
  document.querySelectorAll(sel).forEach((control) => {
    if (control.dataset.slug === slug) updateProgressSelect(control, slug);
  });
  updateOutsideCards();
}

// Keep progress changes in place until another list render, including chapter duplicates.
function updateOutsideCards(announce = true) {
  if (loadState !== "ready") return;
  const next = new Set();
  const progress = PROGRESS_LABELS[currentLang][Number(filters.progress)];
  document.querySelectorAll("#tool-list .tool-card").forEach((card) => {
    const outside = !toolSet.ids.length && filters.progress !== "all" && String(getProgress(card.dataset.slug)) !== filters.progress;
    const label = card.querySelector(".tool-outside-label");
    card.classList.toggle("is-outside", outside);
    label.hidden = !outside;
    label.textContent = outside ? listText("outside_label", { progress }) : "";
    if (outside) next.add(card.dataset.toolId);
  });
  const newlyOutside = [...next].some((id) => !outsideToolIds.has(id));
  if (!newlyOutside && [...outsideToolIds].some((id) => !next.has(id))) cancelListStatus();
  outsideToolIds = next;
  updateListCount();
  updateBookViewMetadata();
  if (newlyOutside && announce) announceListStatus(listText("outside_announcement", { progress }));
}

// ---- 別のタブの進捗 ----

// Reflect another tab's stored stages in the native selects and dashboard.
// Coalesce full-reset events, then synchronize once without rebuilding the list
// or its controls, preserving focus and scroll position.
const PROGRESS_SYNC_DELAY_MS = 100;
let progressSyncTimer = 0;

function setupProgressSync() {
  window.addEventListener("storage", (e) => {
    try { if (e.storageArea && e.storageArea !== window.localStorage) return; } catch (_) { /* Invalidate clean cache even if access was revoked. */ }
    progressStore.invalidate(e.key);
    // key が null のときは、別のタブで保存した値がまとめて消された
    if (e.key !== null && String(e.key).indexOf("progress_") !== 0) return;
    clearTimeout(progressSyncTimer);
    progressSyncTimer = setTimeout(refreshProgressViews, PROGRESS_SYNC_DELAY_MS);
  });
  // 隠れていたタブでは、知らせのあとの描き直しが遅れることがある。表に出たときは待たずに描き直す
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && progressSyncTimer) refreshProgressViews();
  });
  // 戻る・進むでページがそのまま戻ったとき（bfcache）は、離れていたあいだの知らせが届かないので描き直す
  window.addEventListener("pageshow", (e) => {
    if (e.persisted) refreshProgressViews();
  });
}

function refreshProgressViews() {
  clearTimeout(progressSyncTimer);
  progressSyncTimer = 0;
  if (!tools.length) return; // データが届く前は描くものがない（届いたときに、保存された値で描く）
  // Synchronize every retained select, including cards whose render was cached.
  document.querySelectorAll(".tool-progress-select").forEach((b) => {
    if (b.dataset.slug) updateProgressSelect(b, b.dataset.slug);
  });
  updateOutsideCards();
  progressVersion++;
  // 作り直す前にフォーカスしている部品と目印を覚え、作り直したあとに同じ部品へ戻す（スクロールはしない）
  const focused = document.activeElement;
  const focusedKey = focusKey(focused);
  renderDashboard();
  restoreRebuiltFocus(focused, focusedKey);
}

// ---- ダッシュボード描画 ----

function renderDashboard() {
  if (loadState !== "ready") return;
  refreshShareUI();
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
    title.dataset.book = s.book.slug; // 戻ってきたときに、同じ本の行へフォーカスを戻すため（focusKey）
    const rowHref = `?book=${encodeURIComponent(s.book.slug)}`;
    title.href = HU && currentLang === "en" ? HU.withLang(new URL(rowHref, window.location.href).toString(), "en") : rowHref;
    const kind = document.createElement("span");
    kind.className = "book-progress-kind";
    kind.textContent = bookKindLabel(s.book);
    title.appendChild(kind);
    title.appendChild(document.createTextNode(HB.bookLabel(s.book, currentLang)));
    title.addEventListener("click", (e) => {
      markStartSeen(); // 本を選んだので、次からは「はじめ方」を閉じて始める
      // Ctrl・⌘・Shift・Alt を押したクリック（新しいタブや窓で開く操作など）は、ふつうのリンクとしてブラウザーに任せる
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // 一覧のタブへ移って本で絞る。履歴を1つ積み、戻るでダッシュボードへ戻れるようにする
      commitUrl({ book: s.book.slug, tab: "tools", tools: null, hash: "" }, "push");
      switchTab("tab-tools");
      setBookFilter(s.book.slug, { history: false });
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
      var(--progress-n0) 0% ${end0}%,
      var(--progress-n1) ${end0}% ${end1}%,
      var(--progress-n2) ${end1}% ${end2}%,
      var(--progress-n3) ${end2}% ${end3}%
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

// ---- 選択範囲の共有 ----

function shareData() {
  if (!HSH || loadState !== "ready") return null;
  const book = currentBook();
  const progress = new Map();
  tools.filter((tool) => tool.hub !== false).forEach((tool) => {
    if (!progress.has(tool.id)) progress.set(tool.id, getProgress(tool.slug));
  });
  const counts = HSH.summarizeProgress(tools, progress, book ? HB.expandTargetIds(book, tools) : null);
  const selection = book ? { slug: book.slug, label: HB.bookLabel(book, currentLang), related: book.relation === "related" } : null;
  return HSH.buildShare({ lang: currentLang, counts, selection });
}

function clearShareFeedback(rescueFocus) {
  shareCopyGeneration++;
  const field = document.getElementById("share-copy-url");
  const button = document.getElementById("share-copy-link");
  if (rescueFocus && field && document.activeElement === field && currentTab === "dashboard" && button && !button.disabled) {
    button.focus({ preventScroll: true });
  }
  if (field) { field.hidden = true; field.value = ""; }
  const status = document.getElementById("share-copy-status");
  if (status) { status.hidden = true; status.textContent = ""; }
}

function refreshShareUI() {
  const data = shareData();
  if (!data) return;
  const key = currentLang + ":" + data.url + ":" + data.scopeNote;
  if (key !== shareScopeKey) {
    clearShareFeedback(true);
    shareScopeKey = key;
  }
  const note = document.getElementById("share-scope-note");
  if (note) {
    note.hidden = !data.scopeNote;
    if (note.textContent !== data.scopeNote) note.textContent = data.scopeNote;
  }
}

function handleShareOnX() {
  const data = shareData();
  if (data) window.open(data.intentUrl, "_blank", "noopener");
}

// Native focus can return while a previous smooth scroll is still moving away.
// Stop the earlier scroll only while this field still owns focus, then reveal it once.
function revealShareCopyField() {
  const field = document.getElementById("share-copy-url");
  if (!field || document.activeElement !== field || !isShown(field)) return;
  const guard = { generation: shareCopyGeneration, key: shareScopeKey,
    navigation: navigationVersion, interaction: interactionVersion };
  requestAnimationFrame(() => {
    if (guard.generation !== shareCopyGeneration || guard.key !== shareScopeKey ||
        guard.navigation !== navigationVersion || guard.interaction !== interactionVersion ||
        document.activeElement !== field || !isShown(field) || loadState !== "ready" || currentTab !== "dashboard") return;
    window.scrollTo({ top: window.scrollY, left: window.scrollX || 0, behavior: "instant" });
    field.scrollIntoView({ block: "nearest", behavior: "instant" });
  });
}

async function copyShareLink() {
  if (currentTab !== "dashboard") return;
  const data = shareData();
  if (!data) return;
  refreshShareUI();
  const guard = { generation: ++shareCopyGeneration, key: shareScopeKey,
    navigation: navigationVersion, interaction: interactionVersion, focus: document.activeElement };
  const status = document.getElementById("share-copy-status");
  const field = document.getElementById("share-copy-url");
  if (!status || !field) return;
  status.hidden = true;
  status.textContent = "";
  let copied = false;
  try {
    await navigator.clipboard.writeText(data.url);
    copied = true;
  } catch (_) { /* The readonly field is the manual copy path. */ }
  if (guard.generation !== shareCopyGeneration || guard.key !== shareScopeKey ||
      guard.navigation !== navigationVersion || guard.interaction !== interactionVersion ||
      guard.focus !== document.activeElement || loadState !== "ready" || currentTab !== "dashboard") return;
  status.textContent = LINK_TEXT[copied ? "copied" : "copyFailed"][currentLang === "ja" ? 0 : 1];
  status.hidden = false;
  if (copied && document.activeElement === field) {
    document.getElementById("share-copy-link").focus({ preventScroll: true });
  }
  field.hidden = copied;
  if (!copied) {
    field.value = data.url;
    if (document.activeElement === document.getElementById("share-copy-link")) {
      field.focus({ preventScroll: true });
      field.select();
    }
  }
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
