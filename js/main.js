// js/main.js

// グローバル状態
// 表示の言語。js/lang.js が描く前に決めて <html lang> に書いている（?lang= → 保存した言語 → 日本語）
let currentLang = document.documentElement.lang === "en" ? "en" : "ja"; // "ja" | "en"
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

// localStorage を安全に使うラッパー（js/storage.js）。読み込めていなければ同等の最小実装で代える。
const progressStore =
  typeof HLOStorage !== "undefined"
    ? HLOStorage.createSafeStorage(() => window.localStorage)
    : (() => {
        const memory = new Map();
        return {
          getItem(key) {
            try {
              const v = window.localStorage.getItem(key);
              if (v !== null) return v;
            } catch (e) {
              /* メモリーへ退避 */
            }
            return memory.has(key) ? memory.get(key) : null;
          },
          setItem(key, value) {
            memory.set(key, String(value));
            try {
              window.localStorage.setItem(key, String(value));
            } catch (e) {
              /* 保存できない環境では、このページを開いているあいだだけ保持する */
            }
          }
        };
      })();

// 選んだ言語を保存するキー（js/lang.js が開いたときに読む）
const LANG_KEY = typeof HLOLang !== "undefined" && HLOLang.KEY ? HLOLang.KEY : "hlo_lang";

const PROGRESS_LABELS = {
  ja: ["未着手", "学習中", "一周完了", "定着済み"],
  en: ["Not started", "In progress", "First pass", "Mastered"]
};

// 狭い画面の境目。css/style.css の、「はじめ方」を描く前に畳む規則（@media）と同じ式にする
const NARROW_MQ = "(max-width: 767.98px)";

// 一覧を作り直さずに済むかを見るための、前回の表示の鍵と、進捗を変えるたびに増やす版
let lastListKey = null;
let progressVersion = 0;

document.addEventListener("DOMContentLoaded", () => {
  setupStaticUI();
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

  // 言語切替
  const langJaBtn = document.getElementById("lang-ja");
  const langEnBtn = document.getElementById("lang-en");

  const setLanguage = (lang) => {
    if (lang === currentLang) return; // 今の言語のボタンは押しても何もしない
    const anchor = captureReadingAnchor(); // 作り直す前に、読んでいたカードと高さを覚える
    currentLang = lang;
    // 選んだ言語を覚え（再読み込みや、新しいタブで開いたときも同じ言語で始める）、URL の ?lang= も合わせる。
    // 保存は進捗と同じ安全なラッパー（js/storage.js）を通すので、保存できない環境でも、このページの中では切り替わる
    progressStore.setItem(LANG_KEY, lang);
    syncLangParam();
    updateLanguageUI();
    setupFilterOptions(); // ラベルが変わるのでフィルターも再生成
    renderAll();
    restoreReadingAnchor(anchor);
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
    keepInPlace(bookSelect, () => setBookFilter(e.target.value, { history: "push", source: "book" }));
  });

  categorySelect?.addEventListener("change", (e) => {
    keepInPlace(categorySelect, () => {
      commitUrl({ cat: e.target.value }, "push", "category");
      filters.categoryId = e.target.value;
      renderToolList();
    });
  });

  // 進捗の条件はこの端末の記録で決まるので、URL に残さない
  progressSelect?.addEventListener("change", (e) => {
    keepInPlace(progressSelect, () => {
      filters.progress = e.target.value;
      renderToolList();
    });
  });

  // 日本語入力の変換中（未確定）は絞らず、確定したとき（compositionend）に欄の値で絞る。
  // Chromium は確定の input も isComposing=true で出し、そのあとに compositionend を出す（後ろに input は来ない）。
  // Firefox は compositionend のあとに isComposing=false の input を出す。どちらの順でも、同じ語なら
  // applySearch が描き直さないので、絞るのは1回だけ。変換を通らない英字は、今までどおり1文字ごとに絞る。
  // 「変換中」の印は自分では持たない（compositionend を取りこぼすと、検索が止まったままになるため）
  searchInput?.addEventListener("compositionend", () => {
    keepInPlace(searchInput, () => applySearch(searchInput.value));
  });
  searchInput?.addEventListener("input", (e) => {
    if (e.isComposing) return;
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

  // 「はじめ方」の入口（ツール100・ツール200・すべて）：Ctrl などを押さない左クリックのときは、ページを読み直さずに
  // 書籍の選択と同じ処理で絞り、履歴を積む（読み直すと、開いた「はじめ方」と入れた条件が初めに戻り、回線がないと
  // サイトから出てしまうため）。Ctrl・⌘・Shift・Alt を押したクリック（新しいタブや窓で開く操作など）と、本のデータを
  // 読めていないときは、これまでどおりのリンクとしてブラウザーに任せる
  document.querySelectorAll(".start-here-entries a").forEach((a) => {
    a.addEventListener("click", (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      if (!urlStateReady || !HB || !books.length) return;
      let target;
      try {
        target = new URL(a.href);
      } catch (err) {
        return;
      }
      const raw = target.searchParams.get("book");
      const slug = raw ? HB.resolveBookParam(target.search, books) : "";
      if (raw && !slug) return; // books.json にない本は、リンクのまま開く
      e.preventDefault();
      keepInPlace(a, () => openStartEntry(slug));
    });
  });

  // X共有ボタン
  const shareBtn = document.getElementById("share-on-x");
  shareBtn?.addEventListener("click", handleShareOnX);

  // 全体リセット
  const resetBtn = document.getElementById("reset-all-progress");
  resetBtn?.addEventListener("click", handleResetAllProgress);

  // はじめ方は既定で開く（HTML）。狭い画面では初期表示を圧迫しないよう畳む。
  // CSS は js-ready が付くまで狭い画面で中身を隠しているので、ここで畳んでも下の部品は動かない
  const startHere = document.getElementById("start-here");
  if (startHere && window.matchMedia && window.matchMedia(NARROW_MQ).matches) {
    startHere.open = false;
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
  if (!v || v === "all") return;
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
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    const active = document.activeElement;
    if (!helpDialog.contains(active)) {
      e.preventDefault();
      first.focus();
    } else if (e.shiftKey && (active === first || active === helpDialog)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
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

async function loadData() {
  // 最初の表示に使う JSON は、最初の await より前に全部取り始める（ほかを待ってから取ると、往復1回分カードが遅れる）。
  // 書籍データは無くても一覧を出せるので、Promise.all には入れず、失敗はここで受け止めて null にする。
  // 決まりはハブの CLAUDE.md（Loading data）にあり、test/site.test.js がこの形を確かめる
  const booksPromise = fetch("./data/books.json")
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  try {
    const [catRes, toolsRes] = await Promise.all([
      fetch("./data/categories.json"),
      fetch("./data/tools.json")
    ]);

    if (!catRes.ok || !toolsRes.ok) {
      console.warn("Failed to load JSON files");
      releaseReservedSpace();
      return;
    }

    categories = await catRes.json();
    const toolsJson = await toolsRes.json();
    tools = Array.isArray(toolsJson.tools) ? toolsJson.tools : [];
    searchEntries = null; // 検索用の項目は、このデータで作り直す

    // 書籍データ（自己完結した読み込み。失敗してもハブは従来どおり動く）
    const bJson = await booksPromise;
    books = bJson && Array.isArray(bJson.books) ? bJson.books : [];

    // 更新日時。ここから描き終えるまで await をはさまないので、一覧と同じ時に画面に出る
    // （先に入れると、書籍データを待つあいだにフッターだけが先に描き変わる）
    const lastUpdatedEl = document.getElementById("last-updated-value");
    if (lastUpdatedEl) {
      lastUpdatedEl.textContent = toolsJson.generated_at || "-";
    }

    if (!HB) console.warn("books.js not loaded; book filter disabled");
    applyBooksAvailability();

    // URL の条件（?book=・?cat=・?q=・?tab=）で一覧を出す。存在しない本・カテゴリーは無視する
    const urlState = readUrlState();
    filters.book = urlState.book;
    filters.categoryId = urlState.cat;

    // 検索欄：描く前に欄の値で絞り、欄の文字と一覧を食い違わせない。URL の ?q= は開いたときに欄へ入れてあり（setupStaticUI）、
    // ここでは欄を書き換えない（読み込み中に打った文字を消さない）。戻るボタンや Firefox の再読み込みで開き直すと、ブラウザーが
    // 欄の文字を戻すことがあり、input は起きないので、その文字もここで読む
    const searchInput = document.getElementById("filter-search-input");
    if (searchInput) setSearchQuery(searchInput.value);

    // 読めた条件だけを、URL に正規の形で書き直す（大文字や前後の空白・並びをそろえる。履歴は増やさない）。
    // 存在しない本・カテゴリー・タブの値は書き換えずに残す（絞り込みを変えると、画面の条件で書き直すので外れる）
    const tidy = { q: searchInput ? searchInput.value : "" };
    if (urlState.book) tidy.book = urlState.book;
    if (urlState.cat) tidy.cat = urlState.cat;
    if (urlState.tab === "dashboard") tidy.tab = urlState.tab;
    commitUrl(tidy);
    urlStateReady = true;

    setupFilterOptions();
    setListBusy(false);
    renderAll();
    maybeScrollToHash();
    markCardsPainted();
  } catch (err) {
    console.error("Error loading data:", err);
    releaseReservedSpace();
  }
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

// #book-group-<key> のハッシュがあればそこへスクロールし、見出しへフォーカスを移す。
function maybeScrollToHash() {
  const h = window.location.hash;
  if (!h || h.indexOf("#book-group-") !== 0) return;
  const el = document.getElementById(h.slice(1));
  if (el) {
    try {
      el.scrollIntoView();
      // 次の Tab がこの章から始まるように、見出しへフォーカスを移す（スクロールはし直さない）
      el.focus({ preventScroll: true });
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

// 一覧の途中で表示を作り直す前に、ヘッダーのすぐ下で読んでいた項目（カードか章の見出し）を覚える。
// 一覧の先頭が見えているときは null（何もしない）。
// holdFrom は、作り直したあとに描くのを後回しにしない範囲の始め（restoreReadingAnchor を参照）。
// 画面の上端から1画面分の高さだけ上までにかかる、最初の項目の順番
function captureReadingAnchor() {
  const listEl = document.getElementById("tool-list");
  const header = document.getElementById("site-header");
  if (!listEl || !header || listEl.getClientRects().length === 0) return null;
  const hb = header.getBoundingClientRect().bottom;
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

// 作り直したあと、同じ順番の項目がヘッダーの下の同じ高さに来るようにスクロールする。
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
  const hb = header.getBoundingClientRect().bottom;
  scrollByInstant(el.getBoundingClientRect().top - hb - anchor.offset);
  // 次の描画が終わってから外す（描いたときに、カードの高さが覚えられる）
  requestAnimationFrame(() =>
    setTimeout(() => held.forEach((c) => c.classList.remove("cv-hold")), 0)
  );
}

// ---- UIレンダリング全体 ----

function renderAll() {
  renderToolList();
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
      ? "タイトル・説明・タグで検索"
      : "Search by title / description / tags";
  }

  // 「はじめ方」の入口は、英語のときは ?lang=en を付けた href にする（新しいタブで開いたときや、リンクを写したときも英語で開く）。
  // もとの href は data-href に取っておき、日本語に戻したらそれに戻す
  document.querySelectorAll(".start-here-entries a").forEach((a) => {
    if (!a.dataset.href) a.dataset.href = a.getAttribute("href");
    const base = a.dataset.href;
    a.setAttribute("href", isJa || !HU ? base : HU.withLang(new URL(base, window.location.href).toString(), "en"));
  });
}

// ---- タブ切替 ----

// タブのパネルの id と、URL の ?tab= の値（"tools" | "dashboard"）の対応
function tabName(targetId) {
  return targetId === "tab-dashboard" ? "dashboard" : "tools";
}

function switchTab(targetId) {
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

// ---- 一覧の条件と URL ----

// データを読み込み、URL の条件を一覧に入れたあとは true。そのあと URL に書くときは、画面の条件をすべて書く
let urlStateReady = false;

// URL の条件を、読み込んだデータで確かめて読む（js/url.js）。url.js を読めないときは、?book= だけを books.js で読む
function readUrlState() {
  const haveBooks = !!(HB && Array.isArray(books) && books.length);
  if (HU) {
    return HU.readState(window.location.search, {
      books: haveBooks ? books.map((b) => b.slug) : [],
      categories: Array.isArray(categories) ? categories.map((c) => c.id) : []
    });
  }
  return {
    book: haveBooks ? HB.resolveBookParam(window.location.search, books) : "",
    cat: "",
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
    q: searchInput ? searchInput.value : "",
    tab: currentTab
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
  try {
    const view = { y: Math.round(window.scrollY), anchor: captureReadingAnchor(), focus: focusKey(document.activeElement) };
    window.history.replaceState(Object.assign({}, window.history.state, view), "");
  } catch (e) {
    /* 無視 */
  }
}

// ---- 戻る・進む ----

function setupHistory() {
  // commitUrl が積んだ履歴を外したとき（dropPushedEntry）の popstate では、画面がもう着いた履歴の条件なので描き直さない
  window.addEventListener("popstate", (e) => (droppingPush ? finishDropPush() : applyHistoryState(e.state)));
  // スクロールが止まったら、今の履歴に位置を書く（進むで戻ってきたときも、離れたときの位置を出すため）
  let timer = 0;
  window.addEventListener(
    "scroll",
    () => {
      clearTimeout(timer);
      timer = setTimeout(saveViewInHistory, 300);
    },
    { passive: true }
  );
}

// 戻る・進むで来た履歴の URL から、一覧の条件（本・カテゴリー・検索・タブ）を戻して描き直し、その履歴で見ていた位置を出す。
// 条件が今と同じとき（章の位置の # だけが違うときなど）は何もせず、ブラウザーに任せる
function applyHistoryState(view) {
  lastPush = null; // 戻ったあとの変更は、まとめずに積む
  // 言語は戻る・進むで変えない。前の言語のときに積んだ履歴へ来たら、URL の ?lang= を今の言語に直す
  syncLangParam();
  // 描き直す前に、フォーカスしている部品と、そのパネルと目印を覚える（タブを切り替えたり、一覧・バナーを作り直したりしたあとでは、
  // フォーカスが body に移っていることがある）。描き直したあとに settleFocus で移す
  const focused = document.activeElement;
  const focusPanel = panelOf(focused);
  const focusedKey = focusKey(focused);
  const searchInput = document.getElementById("filter-search-input");
  if (!urlStateReady) {
    // データが届く前はタブと検索欄だけを合わせる（本・カテゴリーは、データが届いたときに URL から読む）
    if (!HU) return;
    const st = HU.readState(window.location.search, {});
    if (st.tab !== currentTab) switchTab(st.tab === "dashboard" ? "tab-dashboard" : "tab-tools");
    if (searchInput && searchInput.value.trim() !== st.q) searchInput.value = st.q;
    settleFocus(view, focused, focusPanel, focusedKey);
    return;
  }
  const next = readUrlState();
  const searchChanged = !!searchInput && searchInput.value.trim() !== next.q;
  if (next.book === filters.book && next.cat === filters.categoryId && next.tab === currentTab && !searchChanged) return;

  const filtersEl = document.getElementById("tool-filters");
  const filtersTop = currentTab === "tools" && filtersEl ? filtersEl.getBoundingClientRect().top : null;
  if (next.tab !== currentTab) switchTab(next.tab === "dashboard" ? "tab-dashboard" : "tab-tools");
  filters.categoryId = next.cat;
  const categorySelect = document.getElementById("filter-category");
  if (categorySelect) categorySelect.value = next.cat;
  if (searchChanged) {
    searchInput.value = next.q;
    setSearchQuery(next.q);
  }
  if (next.book !== filters.book) setBookFilter(next.book, { history: false, cleared: !next.book });
  else renderToolList();
  restoreView(view, filtersTop);
  settleFocus(view, focused, focusPanel, focusedKey);
}

// 戻る・進むで描き直したあとのフォーカス（restoreView が戻したスクロールの位置は動かさない）。
// タブが切り替わり、フォーカスしていた部品が隠れたパネルに残る → restoreFocus（履歴に書いておいた部品か、選ばれたタブのボタン）。
// 一覧やバナーを作り直して、フォーカスしていた部品が文書から外れた → restoreRebuiltFocus（作り直した同じ部品か、先頭の見出し）。
// フォーカスが選ばれていないタブのボタンに残る → focusSelectedTab
function settleFocus(view, focused, focusPanel, key) {
  if (focusPanel && focusPanel.hidden) restoreFocus(view);
  else if (focused && !focused.isConnected) restoreRebuiltFocus(focused, key);
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
// 同じ部品が無ければ、一覧かバナーの先頭の見出しへ移す（fallbackFocusTarget）。スクロールはしない。
// フォーカスがページの部品になかったとき（ページの何もない所を押したあとなど）、prev が残っているとき、フォーカスがもうほかの
// 部品へ移っているときは何もしない
function restoreRebuiltFocus(prev, key) {
  if (!prev || prev === document.body || prev.isConnected) return;
  const active = document.activeElement;
  if (active && active !== document.body) return;
  let target = elementForFocusKey(key);
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
  let target = elementForFocusKey(view && view.focus);
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

// 「はじめ方」の入口で本を選ぶ（slug が "" の「すべてのツール」は、カテゴリー・進捗・検索の条件も外す）。履歴を1つ積む
function openStartEntry(slug) {
  if (slug) {
    setBookFilter(slug, { history: "push" });
    return;
  }
  const hadBook = !!filters.book;
  commitUrl({ book: "", cat: "", q: "" }, "push");
  clearOtherFilters();
  setBookFilter("", { history: false, cleared: hadBook });
}

// カテゴリー・進捗・検索の条件と欄を空にする（描き直しはしない）
function clearOtherFilters() {
  filters.categoryId = "";
  filters.progress = "all";
  const c = document.getElementById("filter-category");
  const p = document.getElementById("filter-progress");
  const s = document.getElementById("filter-search-input");
  if (c) c.value = "";
  if (p) p.value = "all";
  if (s) s.value = "";
  setSearchQuery("");
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
// URL の ?book= も書く（本を切り替え/解除したら、前の本の章へ移動の # は外す。js/url.js）。
// opts.history："push" は履歴を積む（選択欄・解除・「はじめ方」の入口）。false は URL に書かない（戻る・進む、
// 呼ぶ側で書いたとき）。既定は今の履歴を書き換える。opts.source は commitUrl の同じ欄の変更をまとめるための名前
function setBookFilter(slug, opts) {
  const o = opts || {};
  if (o.history !== false) commitUrl({ book: slug || "" }, o.history, o.source);
  filters.book = slug || "";
  const sel = document.getElementById("filter-book");
  if (sel) sel.value = filters.book;
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
  // データが届くまでは描かない。読み込み中に言語を切り替えたり検索欄に入力したりしても、空のデータで
  // 「一致するツールがありません」を出したり、?book= のために取っておいたバナーの場所を外したりしない
  // （外すと、データが届いたときにバナーがまた下の部品を押し下げる）。データが届くと、loadData が印を外してから描く
  if (listEl.getAttribute("aria-busy") === "true") return;

  refreshBookTarget();
  const book = currentBook();

  const baseMatch = (t) =>
    t.hub !== false &&
    filterByBook(t) &&
    filterByCategory(t) &&
    filterByProgress(t) &&
    filterBySearch(t);

  const matched = tools.filter(baseMatch);

  // 出すものが前回と同じなら作り直さない（検索の1文字ごとに全部のカードを作り直すと、遅い端末で固まる）。
  // 言語・本・進捗が変わったときは、同じツールの並びでも文字・掲載箇所・進捗の表示が変わるので作り直す
  const listKey = [
    currentLang,
    filters.book,
    progressVersion,
    matched.map((t) => t.id).join(",")
  ].join("|");
  if (listKey === lastListKey && listEl.firstElementChild) return;
  lastListKey = listKey;

  listEl.innerHTML = "";
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
      g.items.forEach((tool) => {
        const card = createToolCard(tool, book);
        // 同じツールが複数の章に出るとき、作り直したあとに同じ章のカードへフォーカスを戻すため（focusKey）
        card.dataset.group = g.key;
        listEl.appendChild(card);
      });
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
  banner.classList.remove("is-pending"); // 読み込み中に取っておいた場所を、中身で置き換える
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

  // リンク・解除・章へ移動の data-part は、バナーを作り直したあとに同じ部品へフォーカスを戻すための目印（focusKey）
  if (isHttpUrl(book.url)) {
    const link = document.createElement("a");
    link.className = "book-banner-link";
    link.dataset.part = "link";
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
  clearBtn.dataset.part = "clear";
  clearBtn.textContent = isJa ? "解除" : "Clear";
  clearBtn.setAttribute("aria-label", isJa ? "書籍の絞り込みを解除" : "Clear book filter");
  clearBtn.addEventListener("click", () => {
    setBookFilter("", { cleared: true, history: "push" });
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
    summary.dataset.part = "jump";
    summary.textContent = isJa
      ? `章へ移動${countSuffix(displayGroups.length)}`
      : `Jump to section${countSuffix(displayGroups.length)}`;
    details.appendChild(summary);
    displayGroups.forEach((g) => {
      const a = document.createElement("a");
      a.className = "book-jump-link";
      a.dataset.part = "jump:" + g.key;
      a.href = `#book-group-${g.key}`;
      const label = isJa ? g.label_ja : g.label_en;
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
  commitUrl({ q: raw });
  const before = filters.search;
  setSearchQuery(raw);
  if (filters.search === before) return;
  renderToolList();
}

function createToolCard(tool, book) {
  const card = document.createElement("article");
  card.className = "tool-card";
  // ツールの slug と、下のボタン・リンクの data-part は、一覧を作り直したあとに同じ部品へフォーカスを戻すための目印（focusKey）
  card.dataset.slug = tool.slug || "";

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
  }

  const repoBtn = document.createElement("a");
  repoBtn.href = (HU ? HU.repoLink(tool.repo_url, currentLang) : tool.repo_url) || "#";
  repoBtn.target = "_blank";
  repoBtn.rel = "noopener";
  repoBtn.className = "tool-button secondary";
  repoBtn.dataset.part = "repo";
  repoBtn.textContent = "GitHub";

  const progressBtn = document.createElement("button");
  progressBtn.type = "button";
  progressBtn.className = "tool-progress-button";
  progressBtn.dataset.part = "progress";
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

// 読み書きは progressStore 経由（例外を投げず、使えない環境ではメモリーに退避する）。
function getProgress(slug) {
  const raw = progressStore.getItem(`progress_${slug}`);
  const num = Number(raw);
  if (raw !== null && Number.isInteger(num) && num >= 0 && num <= 3) {
    return num;
  }
  return 0;
}

function setProgress(slug, level) {
  progressStore.setItem(`progress_${slug}`, String(level));
  progressVersion++; // 次に一覧を描くときは作り直す（全部リセットしたあとに、古い進捗の表示を残さない）
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

// ---- 別のタブの進捗 ----

// 同じブラウザーの別のタブで進捗が変わったら（storage イベント）、このタブの進捗ボタンとダッシュボードを描き直す。
// 押したときの次の段階は保存した値から決めるので、描き直さないと、古い表示のまま押したときに1段飛んだように見えたり、
// 別のタブで付けた「定着済み」を消したりする。全体のリセットでは本数分の知らせが続けて届くので、知らせが止まってから
// 1回だけ描き直す。一覧は作り直さない（このタブで押したときと同じく、フォーカスとスクロールの位置を動かさない）。
// ダッシュボードの本の行は作り直すので、フォーカスしていた行は、作り直した同じ行へ戻す
const PROGRESS_SYNC_DELAY_MS = 100;
let progressSyncTimer = 0;

function setupProgressSync() {
  window.addEventListener("storage", (e) => {
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
  // 一覧にあるボタンは、ここで全部今の値に合わせる（作り直しの省略で残したカードも、表示は新しい値になる）
  document.querySelectorAll(".tool-progress-button").forEach((b) => {
    if (b.dataset.slug) updateProgressButton(b, b.dataset.slug);
  });
  // 作り直す前にフォーカスしている部品と目印を覚え、作り直したあとに同じ部品へ戻す（スクロールはしない）
  const focused = document.activeElement;
  const focusedKey = focusKey(focused);
  renderDashboard();
  restoreRebuiltFocus(focused, focusedKey);
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
    title.dataset.book = s.book.slug; // 戻ってきたときに、同じ本の行へフォーカスを戻すため（focusKey）
    const rowHref = `?book=${encodeURIComponent(s.book.slug)}`;
    title.href = HU && currentLang === "en" ? HU.withLang(new URL(rowHref, window.location.href).toString(), "en") : rowHref;
    const kind = document.createElement("span");
    kind.className = "book-progress-kind";
    kind.textContent = bookKindLabel(s.book);
    title.appendChild(kind);
    title.appendChild(document.createTextNode(HB.bookLabel(s.book, currentLang)));
    title.addEventListener("click", (e) => {
      // Ctrl・⌘・Shift・Alt を押したクリック（新しいタブや窓で開く操作など）は、ふつうのリンクとしてブラウザーに任せる
      if (e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      // 一覧のタブへ移って本で絞る。履歴を1つ積み、戻るでダッシュボードへ戻れるようにする
      commitUrl({ book: s.book.slug, tab: "tools" }, "push");
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

  // 英語表示のときは ?lang=en を付ける（共有されたリンクを開いた人も英語で始まる）
  const base = window.location.origin + window.location.pathname;
  const url = HU ? HU.withLang(base, currentLang) : base;

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
