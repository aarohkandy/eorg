(() => {
  "use strict";

  const DEBUG_THREAD_EXTRACT = false;
  const STYLE_ID = "reskin-stylesheet";
  const ROOT_ID = "reskin-root";
  const MODE_ATTR = "data-reskin-mode";
  const MODE_VALUE = "viewer";
  const THEME_ATTR = "data-reskin-theme";
  const THEME_DARK = "dark";
  const THEME_LIGHT = "light";
  const OBSERVER_DEBOUNCE_MS = 180;
  const OBSERVER_MIN_RENDER_GAP_MS = 320;
  const UI_POLL_INTERVAL_MS = 900;
  const LIST_REFRESH_INTERVAL_MS = 12000;
  const GMAIL_READY_SELECTORS = ['[role="main"]', '[aria-label="Main menu"]'];
  const ROW_SELECTORS = [
    '[role="main"] tr[role="row"][data-thread-id]',
    '[role="main"] tr[role="row"][data-legacy-thread-id]',
    '[role="main"] [role="row"][data-thread-id]',
    '[role="main"] [role="row"][data-legacy-thread-id]',
    '[role="main"] tr[role="row"]',
    '[role="main"] tr.zA',
    '[role="main"] [role="row"]',
    '[role="main"] tr[data-thread-id]',
    '[role="main"] tr[data-legacy-thread-id]',
    '[gh="tl"] tr[role="row"]',
    '[gh="tl"] tr',
    '[role="row"][data-thread-id]',
    '[role="row"][data-legacy-thread-id]',
    'tr[role="row"]',
    'tr.zA',
    '[role="option"][data-thread-id]',
    '[role="option"][data-legacy-thread-id]',
    '[data-thread-id]',
    '[data-legacy-thread-id]'
  ];
  const SCOPED_ROW_SELECTORS = [
    'tr[role="row"][data-thread-id]',
    'tr[role="row"][data-legacy-thread-id]',
    '[role="row"][data-thread-id]',
    '[role="row"][data-legacy-thread-id]',
    'tr[role="row"]',
    'tr.zA',
    '[role="row"]',
    'tr[data-thread-id]',
    'tr[data-legacy-thread-id]',
    '[role="option"][data-thread-id]',
    '[role="option"][data-legacy-thread-id]',
    '[data-thread-id]',
    '[data-legacy-thread-id]'
  ];
  const LINK_SELECTORS = [
    '[role="main"] a[href*="th="]',
    '[role="main"] a[href*="#inbox/"]',
    '[role="main"] a[href*="#all/"]',
    '[role="main"] a[href*="#label/"]',
    '[role="main"] a[href*="#sent/"]',
    '[role="main"] [role="link"][href*="#"]',
    '[gh="tl"] a[href*="th="]',
    '[gh="tl"] a[href*="#inbox/"]',
    '[gh="tl"] a[href*="#all/"]',
    '[gh="tl"] a[href*="#label/"]',
    '[gh="tl"] a[href*="#sent/"]',
    'a[href*="th="]',
    'a[href*="#inbox/"]',
    'a[href*="#all/"]',
    'a[href*="#label/"]',
    'a[href*="#sent/"]'
  ];
  const SCOPED_LINK_SELECTORS = [
    'a[href*="th="]',
    'a[href*="#inbox/"]',
    'a[href*="#all/"]',
    'a[href*="#label/"]',
    'a[href*="#sent/"]',
    '[role="link"][href*="#"]'
  ];
  const NAV_ITEMS = [
    { label: "Inbox", hash: "#inbox", nativeLabel: "Inbox" },
    { label: "Starred", hash: "#starred", nativeLabel: "Starred" },
    { label: "Snoozed", hash: "#snoozed", nativeLabel: "Snoozed" },
    { label: "Sent", hash: "#sent", nativeLabel: "Sent" },
    { label: "Drafts", hash: "#drafts", nativeLabel: "Drafts" },
    { label: "All Mail", hash: "#all", nativeLabel: "All Mail" },
    { label: "Spam", hash: "#spam", nativeLabel: "Spam" },
    { label: "Trash", hash: "#trash", nativeLabel: "Trash" }
  ];
  const PRIMARY_NAV_HASHES = new Set(["#inbox", "#sent", "#drafts"]);

  const TRIAGE_LEVELS = ["respond", "read", "news", "notImportant", "spam"];
  const OLD_TO_NEW_TRIAGE = { critical: "respond", high: "read", medium: "news", low: "notImportant", fyi: "spam" };
  const TRIAGE_MAP_STORAGE_KEY = "reskin_triage_map_v1";
  const SYNC_DRAFT_STORAGE_KEY = "reskin_sync_draft_v1";
  const SUMMARY_STORAGE_KEY = "reskin_row_summaries_v1";
  const COL_WIDTHS_STORAGE_KEY = "reskin_column_widths_v1";
  const DEFAULT_COL_WIDTHS = { col1: 160, col2: 260, col3: 0, col4: 260 };
  const MIN_COL_PX = 100;
  const MAX_COL_PX = 600;
  const RESIZE_GRIP_PX = 6;
  const SUMMARY_TTL_MS = 24 * 60 * 60 * 1000;
  const SUMMARY_BATCH_SIZE = 3;

  const LIST_LOAD_MORE_DISTANCE_PX = 280;
  const LIST_PREFETCH_DISTANCE_PX = 900;

  const NOISE_TEXT = new Set([
    "starred",
    "not starred",
    "read",
    "unread",
    "important",
    "inbox",
    "select",
    "open",
    "archive",
    "delete"
  ]);

  const state = {
    observer: null,
    pollTimer: null,
    debounceTimer: null,
    isApplying: false,
    interactionLockUntil: 0,
    lastListSignature: "",
    currentView: "list",
    activeThreadId: "",
    lockListView: false,
    lastListHash: "#inbox",
    lastRenderedCount: null,
    lastSource: "",
    loggedOnce: new Set(),
    triageFilter: "",
    triageCounts: { respond: 0, read: 0, news: 0, notImportant: 0, spam: 0 },
    triageStatus: "",
    triageRunning: false,
    triageQueueKey: "",
    triageAutoPauseUntil: 0,
    triageLastFailureStatus: "",
    triageUntriagedCount: 0,
    triageLocalMap: {},
    triageMapLoaded: false,
    triageMapLoadInFlight: false,
    triageMapPersistTimer: null,
    initialCriticalApplied: false,
    summaryByThreadId: {},
    summaryMetaByThreadId: {},
    summaryStatusByThreadId: {},
    summaryQueue: [],
    summaryWorkerRunning: false,
    summaryCooldownUntil: 0,
    summaryLoadInFlight: false,
    summaryLoaded: false,
    summaryPersistTimer: null,
    fullScanRunning: false,
    fullScanStatus: "",
    fullScanCompletedByMailbox: {},
    scannedMailboxMessages: {},
    inboxHashNudged: false,
    inboxEmptyRetryScheduled: false,
    listVisibleByMailbox: {},
    listChunkSize: 120,
    aiQuestionText: "",
    aiAnswerBusy: false,
    aiChatMessages: [],
    settingsCache: null,
    settingsLoadInFlight: false,
    settingsLoadFailed: false,
    settingsAutosaveTimer: null,
    settingsPinned: false,
    settingsTab: "api",
    apiKeyGuideGranted: false,
    showApiKeyPermissionModal: false,
    lastAutoTriageAt: 0,
    lastAutoTriageKickAt: 0,
    lastObserverRenderAt: 0,
    pendingObserverTimer: null,
    lastObserverSignature: "",
    lastSeenHash: "",
    consentBannerDismissed: false,
    searchQuery: "",
    activeContactKey: "",
    contactThreadIds: [],
    mergedMessages: [],
    currentThreadIdForReply: "",
    contactChatLoading: false,
    contactDisplayName: "",
    threadExtractRetry: 0,
    snippetByThreadId: {},
    servers: [],
    currentServerId: null
  };

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function logInfo(message, extra) {
    if (typeof extra === "undefined") {
      console.info(`[reskin] ${message}`);
      return;
    }
    console.info(`[reskin] ${message}`, extra);
  }

  function logWarn(message, extra) {
    if (typeof extra === "undefined") {
      console.warn(`[reskin] ${message}`);
      return;
    }
    console.warn(`[reskin] ${message}`, extra);
  }

  function logTriageDebug(message, extra) {
    const codeMap = {
      "Starting inbox triage run": "C01",
      "Collected messages for triage pass": "C02",
      "Prepared triage batch": "C03",
      "AI returned scored items": "C04",
      "Label apply attempt finished": "C05",
      "Triage run finished": "C06",
      "Triage run failed": "C07",
      "Skipping duplicate triage queue": "C08",
      "Skipped triage run because another run is already in progress": "C09"
    };
    const enabledCodes = new Set(["C05", "C07"]);
    const now = Date.now();
    if (!logTriageDebug._last) logTriageDebug._last = new Map();
    const key = codeMap[message] || message;
    const previous = logTriageDebug._last.get(key) || 0;
    const throttleMs = 2000;
    if (throttleMs && now - previous < throttleMs) return;
    logTriageDebug._last.set(key, now);

    const code = codeMap[message] || "C00";
    if (!enabledCodes.has(code)) return;
    if (typeof extra === "undefined") {
      console.info(`[reskin][td:${code}] ${message}`);
      return;
    }
    console.info(`[reskin][td:${code}] ${message}`, extra);
  }

  function logOnce(key, level, message, extra) {
    if (state.loggedOnce.has(key)) return;
    state.loggedOnce.add(key);
    if (level === "warn") logWarn(message, extra);
    else logInfo(message, extra);
  }

  function lockInteractions(ms = 900) {
    state.interactionLockUntil = Date.now() + ms;
  }

  function interactionsLocked() {
    return Date.now() < state.interactionLockUntil;
  }

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function consumeEvent(event) {
    if (!event) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function resolveExtensionUrl(path) {
    const chromeRuntime =
      globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.getURL === "function"
        ? globalThis.chrome.runtime
        : null;
    if (chromeRuntime) return chromeRuntime.getURL(path);

    const browserRuntime =
      globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getURL === "function"
        ? globalThis.browser.runtime
        : null;
    if (browserRuntime) return browserRuntime.getURL(path);

    return path;
  }

  function isUseful(text) {
    const value = normalize(text);
    if (!value || value.length < 2) return false;
    if (NOISE_TEXT.has(value.toLowerCase())) return false;
    return true;
  }

  function looksLikeDateOrTime(text) {
    const value = normalize(text);
    if (!value) return false;
    return (
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}$/i.test(value) ||
      /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(value) ||
      /^\d+\s?(m|h|d|w)$/i.test(value) ||
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s/i.test(value) ||
      /\b\d{4},?\s+\d{1,2}:\d{2}\s?(AM|PM)\b/i.test(value)
    );
  }

  function selectFirst(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function getGmailMainRoot() {
    return (
      document.querySelector('[role="main"]') ||
      document.querySelector('[gh="tl"]') ||
      null
    );
  }

  function removeLegacyNodes() {
    const oldRoot = document.getElementById(ROOT_ID);
    if (oldRoot) oldRoot.remove();
    for (const node of document.querySelectorAll('[data-reskin="true"]')) {
      if (node instanceof HTMLElement) node.remove();
    }
  }

  function ensureStylesheet() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) return existing;

    const head = document.head || document.documentElement;
    if (!head) return null;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = resolveExtensionUrl("styles.css");
    head.appendChild(link);
    return link;
  }

  function ensureMode() {
    document.documentElement.setAttribute(MODE_ATTR, MODE_VALUE);
    if (document.body) document.body.setAttribute(MODE_ATTR, MODE_VALUE);
  }

  function normalizeTheme(value) {
    return normalize(value || "").toLowerCase() === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
  }

  function activeTheme() {
    return normalizeTheme(state.settingsCache && state.settingsCache.theme);
  }

  function applyTheme(root) {
    const theme = activeTheme();
    const shell = root instanceof HTMLElement ? root : document.getElementById(ROOT_ID);
    if (shell instanceof HTMLElement) shell.setAttribute(THEME_ATTR, theme);
    document.documentElement.setAttribute(THEME_ATTR, theme);
    if (document.body) document.body.setAttribute(THEME_ATTR, theme);
  }

  function parseListRoute(hashValue) {
    const raw = normalize(hashValue || "");
    if (!raw) return { hash: "#inbox", mailbox: "inbox", triage: "" };

    const qIndex = raw.indexOf("?");
    const withoutQuery = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const query = qIndex >= 0 ? raw.slice(qIndex + 1) : "";

    const withoutThreadId = withoutQuery.replace(/\/[A-Za-z0-9_-]{6,}$/i, "");
    const validBase = /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/]+)$/i.test(
      withoutThreadId
    )
      ? withoutThreadId
      : "#inbox";

    const mailbox = validBase.replace(/^#/, "").toLowerCase() || "inbox";
    let triage = "";

    if (mailbox === "inbox" && query) {
      const params = new URLSearchParams(query);
      const candidate = normalize(params.get("triage") || "").toLowerCase();
      if (TRIAGE_LEVELS.includes(candidate)) triage = candidate;
    }

    const hash = mailbox === "inbox" && triage ? `#inbox?triage=${triage}` : validBase;
    return { hash, mailbox, triage };
  }

  function sanitizeListHash(hashValue, options = {}) {
    const parsed = parseListRoute(hashValue);
    let mailbox = parsed.mailbox;
    let triage = parsed.triage;

    if (options.forceInbox) mailbox = "inbox";
    if (options.clearTriage) triage = "";
    if (mailbox !== "inbox") triage = "";

    return mailbox === "inbox" && triage ? `#inbox?triage=${triage}` : `#${mailbox}`;
  }

  function hashHasTriageParam(hashValue) {
    const raw = normalize(hashValue || "");
    return /\btriage=/.test(raw);
  }

  function activeMailbox() {
    return parseListRoute(state.currentView === "thread" ? state.lastListHash : window.location.hash).mailbox;
  }

  function activeTriageFilter() {
    if (activeMailbox() !== "inbox") return "";
    const fromState = normalize(state.triageFilter || "").toLowerCase();
    if (TRIAGE_LEVELS.includes(fromState)) return fromState;
    return parseListRoute(state.currentView === "thread" ? state.lastListHash : window.location.hash).triage;
  }

  function getActiveNavHash() {
    return `#${activeMailbox()}`;
  }

  function isThreadHash() {
    const hash = normalize(window.location.hash || "");
    if (!hash) return false;
    return /#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/[A-Za-z0-9_-]+/i.test(
      hash
    );
  }

  function threadIdFromHash(hash) {
    const raw = normalize(hash || window.location.hash || "");
    if (!raw) return "";
    const m = raw.match(/#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/([A-Za-z0-9_-]+)/i);
    return m && m[1] ? m[1] : "";
  }

  function isAppSettingsHash() {
    const hash = normalize(window.location.hash || "").toLowerCase();
    return hash === "#app-settings" || hash.startsWith("#app-settings?");
  }

  function mailboxKeyFromHash(hash) {
    return parseListRoute(hash).mailbox;
  }

  function hrefMatchesMailbox(href, mailboxKey) {
    const value = normalize(href);
    const box = normalize(mailboxKey).toLowerCase();
    if (!value || !box) return false;

    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) {
      const hash = value.slice(hashIndex + 1).toLowerCase();
      if (box.startsWith("label/")) return hash.startsWith(box);
      if (hash === box || hash.startsWith(`${box}/`)) return true;
    }

    try {
      const url = new URL(value, window.location.origin);
      const search = normalize(url.searchParams.get("search") || "").toLowerCase();
      const hasThread = Boolean(normalize(url.searchParams.get("th") || ""));
      if (!hasThread) return false;
      if (!search) return box === "inbox";
      if (box === "all") return search.includes("all");
      return search.includes(box);
    } catch (_) {
      return false;
    }
  }

  function clickNativeMailboxLink(nativeLabel) {
    const escaped = nativeLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped}(\\b|\\s|,)`, "i");
    const candidates = [
      ...Array.from(document.querySelectorAll(`a[aria-label^="${nativeLabel}"]`)),
      ...Array.from(document.querySelectorAll(`a[title^="${nativeLabel}"]`)),
      ...Array.from(document.querySelectorAll("a[role='link']")),
      ...Array.from(document.querySelectorAll("a"))
    ];

    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const label = normalize(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent);
      if (!label) continue;
      if (!re.test(label) && label.toLowerCase() !== nativeLabel.toLowerCase()) continue;
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }
    return false;
  }

  function navigateToList(targetHash, nativeLabel = "", options = {}) {
    const nextHash = sanitizeListHash(targetHash);
    const sx = window.scrollX, sy = window.scrollY;
    window.location.hash = nextHash;
    if (nativeLabel && options.native !== false) clickNativeMailboxLink(nativeLabel);
    window.scrollTo(sx, sy);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function openSettingsView(root) {
    lockInteractions(500);
    state.settingsPinned = true;
    state.currentView = "settings";
    window.location.hash = "#app-settings";
    renderCurrentView(root);
  }

  function triageLabelText(level) {
    const config = window.ReskinTriage && window.ReskinTriage.LEVEL_CONFIG
      ? window.ReskinTriage.LEVEL_CONFIG[level]
      : null;
    return config ? config.label : level;
  }

  function canonicalThreadId(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return "";
    const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
    if (noHash.startsWith("thread-f:")) return `f:${noHash.slice("thread-f:".length)}`;
    if (noHash.startsWith("f:")) return noHash;
    return noHash;
  }

  function triageLocalGet(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return "";
    const canonical = canonicalThreadId(raw);
    const direct = state.triageLocalMap[raw];
    if (direct && TRIAGE_LEVELS.includes(direct)) return direct;
    const byCanonical = state.triageLocalMap[canonical];
    if (byCanonical && TRIAGE_LEVELS.includes(byCanonical)) return byCanonical;
    return "";
  }

  function triageLocalSet(threadId, level) {
    const raw = normalize(threadId || "");
    const urgency = normalize(level || "").toLowerCase();
    if (!raw || !TRIAGE_LEVELS.includes(urgency)) return;
    const canonical = canonicalThreadId(raw);
    state.triageLocalMap[raw] = urgency;
    if (canonical) {
      state.triageLocalMap[canonical] = urgency;
      state.triageLocalMap[`#${canonical}`] = urgency;
      if (canonical.startsWith("f:")) {
        const id = canonical.slice(2);
        state.triageLocalMap[`thread-f:${id}`] = urgency;
        state.triageLocalMap[`#thread-f:${id}`] = urgency;
      }
    }
    schedulePersistTriageMap();
  }

  function normalizePersistedTriageMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [threadId, level] of Object.entries(input)) {
      const id = normalize(threadId || "");
      const rawUrgency = normalize(level || "").toLowerCase();
      const urgency = OLD_TO_NEW_TRIAGE[rawUrgency] || rawUrgency;
      if (!id || !TRIAGE_LEVELS.includes(urgency)) continue;
      out[id] = urgency;
      const canonical = canonicalThreadId(id);
      if (canonical) {
        out[canonical] = urgency;
        out[`#${canonical}`] = urgency;
        if (canonical.startsWith("f:")) {
          const suffix = canonical.slice(2);
          out[`thread-f:${suffix}`] = urgency;
          out[`#thread-f:${suffix}`] = urgency;
        }
      }
    }
    return out;
  }

  async function loadPersistedTriageMap() {
    if (state.triageMapLoaded || state.triageMapLoadInFlight) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    state.triageMapLoadInFlight = true;
    try {
      const raw = await chrome.storage.local.get(TRIAGE_MAP_STORAGE_KEY);
      const input = raw[TRIAGE_MAP_STORAGE_KEY];
      const map = normalizePersistedTriageMap(input);
      state.triageLocalMap = map;
      state.triageMapLoaded = true;
      const hadOldKeys = input && typeof input === "object" && Object.values(input).some((v) => OLD_TO_NEW_TRIAGE[normalize(v || "").toLowerCase()]);
      if (hadOldKeys && Object.keys(map).length > 0) {
        const compact = {};
        for (const [key, level] of Object.entries(map)) {
          const canonical = canonicalThreadId(key);
          if (canonical && canonical.startsWith("f:")) compact[canonical] = level;
        }
        await chrome.storage.local.set({ [TRIAGE_MAP_STORAGE_KEY]: compact });
        logTriageDebug("Migrated triage map to new level keys and persisted", { keys: Object.keys(compact).length });
      } else {
        logTriageDebug("Loaded local triage map", { keys: Object.keys(map).length });
      }
      await loadSyncDraft();
    } catch (error) {
      logWarn("Failed to load local triage map", error);
    } finally {
      state.triageMapLoadInFlight = false;
    }
  }

  let syncDraftPersistTimer = null;
  async function loadSyncDraft() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    try {
      const raw = await chrome.storage.local.get(SYNC_DRAFT_STORAGE_KEY);
      const payload = raw[SYNC_DRAFT_STORAGE_KEY];
      if (!payload || typeof payload !== "object") return;
      const v = Number(payload.v) || 0;
      if (v < 1) return;
      if (Array.isArray(payload.servers)) state.servers = payload.servers;
      if (payload.triage && typeof payload.triage === "object") {
        const map = normalizePersistedTriageMap(payload.triage);
        for (const [id, level] of Object.entries(map)) state.triageLocalMap[id] = level;
      }
    } catch (error) {
      logWarn("Failed to load sync draft", error);
    }
  }

  function schedulePersistSyncDraft() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    if (syncDraftPersistTimer) clearTimeout(syncDraftPersistTimer);
    syncDraftPersistTimer = setTimeout(async () => {
      syncDraftPersistTimer = null;
      try {
        const compactTriage = {};
        for (const [key, level] of Object.entries(state.triageLocalMap)) {
          const canonical = canonicalThreadId(key);
          if (canonical && canonical.startsWith("f:")) compactTriage[canonical] = level;
        }
        const payload = { v: 1, triage: compactTriage, servers: state.servers || [] };
        await chrome.storage.local.set({ [SYNC_DRAFT_STORAGE_KEY]: payload });
      } catch (error) {
        logWarn("Failed to persist sync draft", error);
      }
    }, 400);
  }

  function schedulePersistTriageMap() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    if (state.triageMapPersistTimer) {
      clearTimeout(state.triageMapPersistTimer);
    }
    state.triageMapPersistTimer = setTimeout(async () => {
      state.triageMapPersistTimer = null;
      try {
        const compact = {};
        for (const [key, level] of Object.entries(state.triageLocalMap)) {
          const canonical = canonicalThreadId(key);
          if (!canonical || !canonical.startsWith("f:")) continue;
          compact[canonical] = level;
        }
        await chrome.storage.local.set({ [TRIAGE_MAP_STORAGE_KEY]: compact });
        logTriageDebug("Persisted local triage map", {
          keys: Object.keys(compact).length
        });
        schedulePersistSyncDraft();
      } catch (error) {
        logWarn("Failed to persist local triage map", error);
      }
    }, 250);
  }

  function summaryThreadKey(threadId) {
    const canonical = canonicalThreadId(threadId);
    return normalize(canonical || threadId || "");
  }

  function normalizePersistedSummaryMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    const now = Date.now();
    for (const [rawThreadId, rawValue] of Object.entries(input)) {
      const threadId = summaryThreadKey(rawThreadId);
      if (!threadId) continue;
      const value = rawValue && typeof rawValue === "object" ? rawValue : {};
      const summary = normalize(value.summary || "");
      const updatedAt = Number(value.updatedAt || 0);
      if (!summary || !updatedAt) continue;
      if (now - updatedAt > SUMMARY_TTL_MS) continue;
      out[threadId] = { summary, updatedAt };
    }
    return out;
  }

  async function loadPersistedSummaries() {
    if (state.summaryLoaded || state.summaryLoadInFlight) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    state.summaryLoadInFlight = true;
    try {
      const raw = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
      const map = normalizePersistedSummaryMap(raw[SUMMARY_STORAGE_KEY]);
      const summaries = {};
      const meta = {};
      for (const [threadId, value] of Object.entries(map)) {
        summaries[threadId] = value.summary;
        meta[threadId] = { updatedAt: Number(value.updatedAt || 0) };
      }
      state.summaryByThreadId = summaries;
      state.summaryMetaByThreadId = meta;
      state.summaryLoaded = true;
    } catch (error) {
      logWarn("Failed to load row summaries", error);
    } finally {
      state.summaryLoadInFlight = false;
    }
  }

  function schedulePersistSummaries() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    if (state.summaryPersistTimer) clearTimeout(state.summaryPersistTimer);
    state.summaryPersistTimer = setTimeout(async () => {
      state.summaryPersistTimer = null;
      try {
        const payload = {};
        const now = Date.now();
        const keys = Object.keys(state.summaryByThreadId || {});
        for (const threadId of keys) {
          const summary = normalize(state.summaryByThreadId[threadId] || "");
          if (!summary) continue;
          const updatedAt = Number((state.summaryMetaByThreadId[threadId] || {}).updatedAt || now);
          if (now - updatedAt > SUMMARY_TTL_MS) continue;
          payload[threadId] = { summary, updatedAt };
        }
        await chrome.storage.local.set({ [SUMMARY_STORAGE_KEY]: payload });
      } catch (error) {
        logWarn("Failed to persist row summaries", error);
      }
    }, 350);
  }

  function getSummaryForMessage(msg) {
    if (!msg) return "";
    const key = summaryThreadKey(msg.threadId);
    if (!key) return "";
    const summary = normalize(state.summaryByThreadId[key] || "");
    const updatedAt = Number((state.summaryMetaByThreadId[key] || {}).updatedAt || 0);
    if (!summary || !updatedAt) return "";
    if (Date.now() - updatedAt > SUMMARY_TTL_MS) {
      delete state.summaryByThreadId[key];
      delete state.summaryMetaByThreadId[key];
      return "";
    }
    return summary;
  }

  function summaryBackoffMsFromError(error) {
    const status = Number(error && error.status ? error.status : 0);
    if (status === 429) {
      const retryMs = Number(error && error.retryAfterMs ? error.retryAfterMs : 0);
      return retryMs > 0 ? retryMs : 60000;
    }
    const message = normalize(error && error.message ? String(error.message) : "").toLowerCase();
    if (message.includes("rate limit")) return 60000;
    if (status >= 500 && status < 600) return 25000;
    if (message.includes("missing api key") || message.includes("disabled in settings")) return 120000;
    return 20000;
  }

  function findMessageForSummary(threadId) {
    const key = summaryThreadKey(threadId);
    if (!key) return null;
    const mailbox = mailboxCacheKey(activeMailbox());
    const candidates = Array.isArray(state.scannedMailboxMessages[mailbox]) ? state.scannedMailboxMessages[mailbox] : [];
    for (const msg of candidates) {
      if (summaryThreadKey(msg.threadId) === key) return msg;
    }
    const live = collectMessages(260).items || [];
    for (const msg of live) {
      if (summaryThreadKey(msg.threadId) === key) return msg;
    }
    return null;
  }

  function queueSummariesForMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    loadPersistedSummaries()
      .catch((error) => logWarn("Row summary bootstrap failed", error))
      .finally(() => {
        const now = Date.now();
        const nextQueue = Array.isArray(state.summaryQueue) ? state.summaryQueue.slice() : [];
        for (const msg of messages) {
          const key = summaryThreadKey(msg && msg.threadId);
          if (!key) continue;
          if (getSummaryForMessage(msg)) continue;
          const status = normalize(state.summaryStatusByThreadId[key] || "idle").toLowerCase();
          if (status === "pending") continue;
          if (!nextQueue.includes(key)) nextQueue.push(key);
          if (!state.summaryStatusByThreadId[key]) state.summaryStatusByThreadId[key] = "idle";
        }
        state.summaryQueue = nextQueue;
        if (state.summaryWorkerRunning) return;
        if (now < Number(state.summaryCooldownUntil || 0)) return;
        const root = document.getElementById(ROOT_ID);
        runSummaryWorker(root);
      });
  }

  async function runSummaryWorker(root) {
    if (state.summaryWorkerRunning) return;
    if (!window.ReskinAI || typeof window.ReskinAI.summarizeMessages !== "function") return;
    if (Date.now() < Number(state.summaryCooldownUntil || 0)) return;

    state.summaryWorkerRunning = true;
    try {
      while (Array.isArray(state.summaryQueue) && state.summaryQueue.length > 0) {
        if (Date.now() < Number(state.summaryCooldownUntil || 0)) break;
        const ids = [];
        while (state.summaryQueue.length > 0 && ids.length < SUMMARY_BATCH_SIZE) {
          const nextId = state.summaryQueue.shift();
          const key = summaryThreadKey(nextId);
          if (!key) continue;
          if (state.summaryStatusByThreadId[key] === "pending") continue;
          if (state.summaryByThreadId[key]) continue;
          ids.push(key);
          state.summaryStatusByThreadId[key] = "pending";
        }
        if (ids.length === 0) continue;

        const batch = [];
        for (const threadId of ids) {
          const msg = findMessageForSummary(threadId);
          if (!msg) {
            state.summaryStatusByThreadId[threadId] = "failed";
            continue;
          }
          batch.push({
            threadId,
            sender: normalize(msg.sender || ""),
            subject: normalize(msg.subject || ""),
            date: normalize(msg.date || ""),
            snippet: normalize(msg.snippet || ""),
            bodyText: normalize(msg.bodyText || "")
          });
        }
        if (batch.length === 0) continue;

        try {
          const summaries = await window.ReskinAI.summarizeMessages(batch, state.settingsCache || {});
          const now = Date.now();
          const map = {};
          for (const item of Array.isArray(summaries) ? summaries : []) {
            const key = summaryThreadKey(item && item.threadId ? item.threadId : "");
            const summary = normalize(item && item.summary ? item.summary : "");
            if (!key || !summary) continue;
            map[key] = summary;
          }
          for (const input of batch) {
            const key = summaryThreadKey(input.threadId);
            if (map[key]) {
              state.summaryByThreadId[key] = map[key];
              state.summaryMetaByThreadId[key] = { updatedAt: now };
              state.summaryStatusByThreadId[key] = "done";
            } else {
              state.summaryStatusByThreadId[key] = "failed";
            }
          }
          schedulePersistSummaries();
          if (root instanceof HTMLElement && state.currentView === "list") {
            renderList(root);
          }
        } catch (error) {
          const backoffMs = summaryBackoffMsFromError(error);
          state.summaryCooldownUntil = Date.now() + backoffMs;
          for (const input of batch) {
            const key = summaryThreadKey(input.threadId);
            state.summaryStatusByThreadId[key] = "idle";
            if (!state.summaryQueue.includes(key)) state.summaryQueue.push(key);
          }
          logWarn("Row summary generation paused", error);
          break;
        }

        await sleep(650 + Math.floor(Math.random() * 250));
      }
    } finally {
      state.summaryWorkerRunning = false;
    }
  }

  function getTriageLevelForMessage(msg) {
    if (!msg || !msg.threadId) return "";
    const local = triageLocalGet(msg.threadId);
    if (local && TRIAGE_LEVELS.includes(local)) return local;

    const fromRow = window.ReskinTriage && typeof window.ReskinTriage.detectLevelFromRow === "function"
      ? window.ReskinTriage.detectLevelFromRow(msg.row)
      : "";
    if (fromRow) {
      triageLocalSet(msg.threadId, fromRow);
      return fromRow;
    }
    return "";
  }

  function threadIdInServer(threadId, server) {
    if (!server || !Array.isArray(server.threadIds)) return false;
    const canonical = canonicalThreadId(normalize(threadId || ""));
    if (!canonical) return false;
    const set = new Set(server.threadIds.map((id) => canonicalThreadId(normalize(id))));
    return set.has(canonical) || set.has(threadId) || set.has(normalize(threadId));
  }

  function getCurrentServerThreadIds() {
    if (!state.currentServerId) return null;
    const server = state.servers.find((s) => s.id === state.currentServerId);
    return server && Array.isArray(server.threadIds) ? server.threadIds : [];
  }

  function renderSidebar(root) {
    const iconHome = root.querySelector(".rv-categories .rv-icon-home");
    if (iconHome instanceof HTMLElement) {
      iconHome.classList.toggle("is-active", !(state.currentServerId || ""));
    }
    const serversList = root.querySelector(".rv-servers-list");
    if (serversList instanceof HTMLElement) {
      const items = (state.servers || []).map((server) => {
        const active = state.currentServerId === server.id;
        const initial = (server.name || "?").trim().charAt(0).toUpperCase();
        return `<button type="button" class="rv-server-item rv-server-icon${active ? " is-active" : ""}" data-server-id="${escapeHtml(server.id)}" title="${escapeHtml(server.name || "Unnamed")}" data-reskin="true">${escapeHtml(initial)} ${escapeHtml(server.name || "Unnamed")}</button>`;
      });
      serversList.innerHTML = items.join("");
    }

    const searchInput = root.querySelector(".rv-search");
    if (searchInput instanceof HTMLInputElement && searchInput.getAttribute("data-bound-search") !== "true") {
      searchInput.value = state.searchQuery || "";
      searchInput.setAttribute("data-bound-search", "true");
      searchInput.addEventListener("input", () => {
        state.searchQuery = normalize(searchInput.value || "");
        applyReskin();
      });
    } else if (searchInput instanceof HTMLInputElement) {
      if (searchInput.value !== (state.searchQuery || "")) searchInput.value = state.searchQuery || "";
    }

    const categoriesNav = root.querySelector(".rv-categories-nav");
    if (categoriesNav instanceof HTMLElement) {
      const activeHash = getActiveNavHash();
      categoriesNav.innerHTML = NAV_ITEMS.filter((item) => PRIMARY_NAV_HASHES.has(item.hash)).map((item) => {
        const isActive = item.hash === activeHash;
        return `<button type="button" class="rv-nav-item${isActive ? " is-active" : ""}" data-target-hash="${item.hash}" data-native-label="${escapeHtml(item.nativeLabel)}" data-reskin="true">${item.label}</button>`;
      }).join("");
    }

    const settings = root.querySelector(".rv-settings");
    if (settings instanceof HTMLElement) {
      settings.classList.toggle("is-active", state.currentView === "settings");
    }

    const sideTriageList = root.querySelector(".rv-side-triage-list");
    const sideTriageMeta = root.querySelector(".rv-side-triage-meta");
    if (sideTriageList instanceof HTMLElement) {
      const currentFilter = activeTriageFilter();
      const total = TRIAGE_LEVELS.reduce((sum, level) => sum + (state.triageCounts[level] || 0), 0);
      const rows = [
        `<button type="button" class="rv-triage-item rv-side-triage-item${!currentFilter ? " is-active" : ""}" data-triage-level="all" data-reskin="true"><span class="rv-triage-label" data-reskin="true">All</span><span class="rv-triage-count" data-reskin="true">${total}</span></button>`
      ];
      for (const level of TRIAGE_LEVELS) {
        const count = state.triageCounts[level] || 0;
        const active = currentFilter === level;
        rows.push(
          `<button type="button" class="rv-triage-item rv-side-triage-item${active ? " is-active" : ""}" data-triage-level="${level}" data-reskin="true"><span class="rv-triage-label" data-reskin="true">${triageLabelText(level)}</span><span class="rv-triage-count" data-reskin="true">${count}</span></button>`
        );
      }
      sideTriageList.innerHTML = rows.join("");
    }
    if (sideTriageMeta instanceof HTMLElement) {
      sideTriageMeta.innerHTML = `
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.triageStatus || "Auto-triage runs in the background.")}</div>
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.fullScanStatus || "Auto-scan loads all inbox pages in the background.")}</div>
      `;
    }
  }

  function renderRightRail(root) {
    const rail = root.querySelector(".rv-right");
    if (!(rail instanceof HTMLElement)) return;
    const messages = Array.isArray(state.aiChatMessages) ? state.aiChatMessages : [];
    const transcript = messages.length
      ? messages.map((msg) => {
        const role = normalize(msg.role || "assistant").toLowerCase() === "user" ? "user" : "assistant";
        return `<div class="rv-chat-msg is-${role}" data-reskin="true"><div class="rv-chat-bubble" data-reskin="true">${escapeHtml(normalize(msg.content || ""))}</div></div>`;
      }).join("")
      : `<div class="rv-chat-empty" data-reskin="true">Ask anything about your inbox.</div>`;

    rail.innerHTML = `
      <section class="rv-ai-chat" data-reskin="true">
        <div class="rv-ai-chat-head" data-reskin="true">
          <div class="rv-ai-head" data-reskin="true">Inbox Chat</div>
          <div class="rv-ai-copy" data-reskin="true">Type at the top, then messages flow below.</div>
        </div>
        <div class="rv-chat-composer" data-reskin="true">
          <textarea class="rv-ai-qa-input" data-reskin="true" placeholder="Start typing your inbox question...">${escapeHtml(state.aiQuestionText || "")}</textarea>
          <button type="button" class="rv-ai-qa-submit" data-reskin="true" ${state.aiAnswerBusy ? "disabled" : ""}>${state.aiAnswerBusy ? "Thinking..." : "Send"}</button>
        </div>
        <div class="rv-chat-transcript" data-reskin="true">${transcript}</div>
      </section>
    `;

    const transcriptNode = rail.querySelector(".rv-chat-transcript");
    if (transcriptNode instanceof HTMLElement) {
      transcriptNode.scrollTop = transcriptNode.scrollHeight;
    }
  }

  function buildInboxQuestionPrompt(question, messages) {
    let compact = (messages || []).slice(0, 120).map((msg, i) => ({
      i,
      threadId: msg.threadId,
      sender: msg.sender,
      subject: msg.subject,
      date: msg.date,
      snippet: normalize(msg.snippet || "").slice(0, 180),
      body: normalize(msg.bodyText || "").slice(0, 280)
    }));
    let compactJson = JSON.stringify(compact);
    while (compactJson.length > 14000 && compact.length > 10) {
      compact = compact.slice(0, Math.max(10, Math.floor(compact.length * 0.7)));
      compactJson = JSON.stringify(compact);
    }
    return [
      {
        role: "system",
        content:
          "You answer questions about inbox email context. Be concise. If evidence is missing, say you are unsure. " +
          "Support requests like last N messages, messages from a date, and keyword matches."
      },
      {
        role: "user",
        content: `Question: ${normalize(question)}\n\nInbox context JSON:\n${compactJson}`
      }
    ];
  }

  async function askInboxQuestion(root) {
    if (state.aiAnswerBusy) return;
    const viewQuestion = root.querySelector(".rv-ai-qa-input");
    const question = normalize(
      viewQuestion instanceof HTMLTextAreaElement ? viewQuestion.value : state.aiQuestionText || ""
    );
    state.aiQuestionText = question;
    if (!question) {
      state.aiChatMessages.push({ role: "assistant", content: "Type a question first." });
      applyReskin();
      return;
    }
    if (!window.ReskinAI || typeof window.ReskinAI.chat !== "function") {
      state.aiChatMessages.push({ role: "assistant", content: "AI chat is unavailable." });
      applyReskin();
      return;
    }

    state.aiChatMessages.push({ role: "user", content: question });
    state.aiAnswerBusy = true;
    state.aiChatMessages.push({ role: "assistant", content: "Thinking..." });
    applyReskin();
    try {
      if (!state.fullScanCompletedByMailbox[mailboxCacheKey("inbox")] && !state.fullScanRunning) {
        state.aiChatMessages[state.aiChatMessages.length - 1] = {
          role: "assistant",
          content: "Scanning inbox pages first so I can answer across all messages..."
        };
        applyReskin();
        await runFullMailboxScan(root);
      }
      const allMessages = getMailboxMessages("inbox", 2000);
      const selected = selectMessagesForQuestion(question, allMessages);
      let prompts = buildInboxQuestionPrompt(question, selected);
      let answer = "";
      try {
        answer = await window.ReskinAI.chat(prompts, state.settingsCache || {});
      } catch (error) {
        const message = normalize(error && error.message ? error.message : String(error || ""));
        if (message.includes("413") && selected.length > 12) {
          const trimmed = selected.slice(0, Math.max(12, Math.floor(selected.length / 3)));
          prompts = buildInboxQuestionPrompt(question, trimmed);
          answer = await window.ReskinAI.chat(prompts, state.settingsCache || {});
        } else {
          throw error;
        }
      }
      state.aiChatMessages[state.aiChatMessages.length - 1] = {
        role: "assistant",
        content:
          `${normalize(answer) || "No answer returned."}\n\n(Used ${selected.length} of ${allMessages.length} cached inbox messages.)`
      };
    } catch (error) {
      const msg = error && error.message ? String(error.message) : "AI answer failed";
      state.aiChatMessages[state.aiChatMessages.length - 1] = {
        role: "assistant",
        content: `Unable to answer: ${msg.slice(0, 220)}`
      };
      logWarn("Inbox Q&A failed", error);
    } finally {
      state.aiAnswerBusy = false;
      applyReskin();
    }
  }

  function syncViewFromHash() {
    if (state.settingsPinned) {
      state.currentView = "settings";
      return;
    }

    if (isAppSettingsHash()) {
      state.settingsPinned = true;
      state.currentView = "settings";
      return;
    }

    const threadHash = isThreadHash();
    if (state.lockListView) {
      if (!threadHash) {
        state.lockListView = false;
      } else {
        state.currentView = "list";
        return;
      }
    }

    if (state.currentView === "thread" && state.activeThreadId && !threadHash) {
      return;
    }

    state.currentView = threadHash ? "thread" : "list";
    if (state.currentView === "thread") {
      state.activeThreadId = threadIdFromHash(window.location.hash) || state.activeThreadId;
    } else {
      state.activeThreadId = "";
    }
    if (state.currentView === "list") {
      const currentHash = window.location.hash || "#inbox";
      const parsed = parseListRoute(currentHash);
      state.lastListHash = sanitizeListHash(currentHash);
      if (parsed.mailbox !== "inbox") {
        state.triageFilter = "";
      } else if (hashHasTriageParam(currentHash)) {
        state.triageFilter = parsed.triage;
        state.initialCriticalApplied = true;
      } else if (!state.initialCriticalApplied) {
        state.initialCriticalApplied = true;
        state.triageFilter = "critical";
        state.lastListHash = "#inbox?triage=critical";
        if (window.location.hash !== "#inbox?triage=critical") {
          window.location.hash = "#inbox?triage=critical";
        }
      }
    }
  }

  function getColumnWidths() {
    try {
      const raw = typeof localStorage !== "undefined" ? localStorage.getItem(COL_WIDTHS_STORAGE_KEY) : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") {
          return {
            col1: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col1) || DEFAULT_COL_WIDTHS.col1)),
            col2: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col2) || DEFAULT_COL_WIDTHS.col2)),
            col3: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col3) || DEFAULT_COL_WIDTHS.col3)),
            col4: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col4) || DEFAULT_COL_WIDTHS.col4))
          };
        }
      }
    } catch (e) { /* ignore */ }
    return { ...DEFAULT_COL_WIDTHS };
  }

  function saveColumnWidths(widths) {
    try {
      const payload = JSON.stringify({
        col1: widths.col1,
        col2: widths.col2,
        col3: widths.col3,
        col4: widths.col4
      });
      if (typeof localStorage !== "undefined") localStorage.setItem(COL_WIDTHS_STORAGE_KEY, payload);
      if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
        chrome.storage.local.set({ [COL_WIDTHS_STORAGE_KEY]: payload }).catch(() => {});
      }
    } catch (e) { /* ignore */ }
  }

  function applyColumnWidths(root, optionalWidths) {
    const shell = root && root.querySelector ? root.querySelector(".rv-shell") : null;
    if (!(shell instanceof HTMLElement)) return;
    const w = optionalWidths && typeof optionalWidths === "object" ? optionalWidths : getColumnWidths();
    shell.style.setProperty("--rv-col-1", `${w.col1}px`);
    shell.style.setProperty("--rv-col-2", `${w.col2}px`);
    shell.style.setProperty("--rv-col-4", `${w.col4}px`);
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    if (!document.body) return null;

    root = document.createElement("section");
    root.id = ROOT_ID;
    root.setAttribute("data-reskin", "true");
    root.innerHTML = `
      <div class="rv-shell" data-reskin="true">
        <aside class="rv-categories" data-reskin="true">
          <div class="rv-brand" data-reskin="true">Mailita</div>
          <div class="rv-categories-servers" data-reskin="true">
            <button type="button" class="rv-icon-home" data-server-id="" title="Inbox" data-reskin="true">Inbox</button>
            <div class="rv-servers-list" data-reskin="true"></div>
            <button type="button" class="rv-server-new" data-reskin="true" title="New server">+ New server</button>
          </div>
          <div class="rv-categories-nav" data-reskin="true"></div>
          <div class="rv-side-triage" data-reskin="true">
            <div class="rv-side-triage-list" data-reskin="true"></div>
            <div class="rv-side-triage-meta" data-reskin="true"></div>
          </div>
          <div class="rv-categories-footer" data-reskin="true">
            <button type="button" class="rv-settings" data-reskin="true">Settings</button>
          </div>
        </aside>
        <div class="rv-resize-grip" data-resize="1" data-reskin="true" title="Drag to resize"></div>
        <aside class="rv-mail-col" data-reskin="true">
          <div class="rv-mail-col-search" data-reskin="true">
            <input type="text" class="rv-search" placeholder="Search mail" data-reskin="true" />
          </div>
          <div class="rv-list" data-reskin="true"></div>
        </aside>
        <div class="rv-resize-grip" data-resize="2" data-reskin="true" title="Drag to resize"></div>
        <main class="rv-chat-area" data-reskin="true">
          <div class="rv-chat-placeholder" data-reskin="true">Select a conversation</div>
          <div class="rv-thread-wrap" data-reskin="true" style="display:none;"></div>
          <div class="rv-settings-wrap" data-reskin="true" style="display:none;"></div>
          <div class="rv-list-wrap rv-list-view" data-reskin="true" style="display:none;"></div>
        </main>
        <div class="rv-resize-grip" data-resize="3" data-reskin="true" title="Drag to resize"></div>
        <aside class="rv-right" data-reskin="true"></aside>
      </div>
    `;

    document.body.appendChild(root);
    applyColumnWidths(root);
    bindRootEvents(root);
    const settingsButton = root.querySelector(".rv-settings");
    if (settingsButton instanceof HTMLElement && settingsButton.getAttribute("data-bound-direct") !== "true") {
      settingsButton.addEventListener(
        "click",
        (event) => {
          consumeEvent(event);
          openSettingsView(root);
        },
        true
      );
      settingsButton.setAttribute("data-bound-direct", "true");
    }
    return root;
  }

  async function loadSettingsCached(force = false) {
    if (!force && state.settingsCache) return state.settingsCache;
    if (!force && state.settingsLoadFailed) return null;
    if (state.settingsLoadInFlight) return state.settingsCache;
    if (!window.ReskinAI || typeof window.ReskinAI.loadSettings !== "function") return null;
    state.settingsLoadInFlight = true;
    try {
      state.settingsCache = await window.ReskinAI.loadSettings();
      applyTheme();
      state.settingsLoadFailed = false;
      return state.settingsCache;
    } catch (error) {
      state.settingsLoadFailed = true;
      logWarn("Failed to load AI settings", error);
      return null;
    } finally {
      state.settingsLoadInFlight = false;
    }
  }

  async function saveSettingsFromDom(root, options = {}) {
    if (!window.ReskinAI || typeof window.ReskinAI.saveSettings !== "function") return;
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;

    const provider = normalize(view.querySelector('[name="provider"]')?.value || "openrouter");
    const apiKey = normalize(view.querySelector('[name="apiKey"]')?.value || "");
    const selectedTheme = normalizeTheme(
      view.querySelector('[name="theme"]:checked')?.value ||
      view.querySelector('[name="theme"]')?.value ||
      THEME_DARK
    );
    const consentCheckbox = view.querySelector('[name="consentTriage"]');
    const consentTriage = consentCheckbox instanceof HTMLInputElement && consentCheckbox.checked;
    const payload = {
      provider,
      apiKey,
      apiKeys: apiKey ? [apiKey] : [],
      theme: selectedTheme,
      model: defaultModelForProvider(provider),
      consentTriage: Boolean(consentTriage)
    };

    try {
      const saved = await window.ReskinAI.saveSettings(payload);
      state.settingsCache = saved;
      if (!options || !options.silent) {
        state.triageStatus = "Settings saved";
        applyReskin();
      }
    } catch (error) {
      state.triageStatus = "Settings save failed";
      logWarn("Save settings failed", error);
      applyReskin();
    }
  }

  function scheduleSettingsAutosave(root, delayMs = 650) {
    if (!(root instanceof HTMLElement)) return;
    if (state.settingsAutosaveTimer) {
      clearTimeout(state.settingsAutosaveTimer);
    }
    state.settingsAutosaveTimer = setTimeout(() => {
      state.settingsAutosaveTimer = null;
      if (state.currentView !== "settings") return;
      saveSettingsFromDom(root, { silent: true });
    }, Math.max(180, Number(delayMs) || 650));
  }

  function defaultModelForProvider(provider) {
    const value = normalize(provider).toLowerCase();
    if (value === "groq") {
      const options = window.ReskinAI && Array.isArray(window.ReskinAI.GROQ_FREE_MODELS)
        ? window.ReskinAI.GROQ_FREE_MODELS
        : [];
      return options[0] || "llama-3.1-8b-instant";
    }
    if (value === "ollama") return "llama3.1";
    return "openrouter/free";
  }

  function apiKeyPlaceholderForProvider(provider) {
    const value = normalize(provider).toLowerCase();
    if (value === "groq") return "Groq API key";
    if (value === "ollama") return "Not required for local Ollama";
    return "OpenRouter API key";
  }

  function providerNeedsApiKey(provider) {
    return normalize(provider).toLowerCase() !== "ollama";
  }

  function buildApiKeyGuide(provider) {
    const value = normalize(provider).toLowerCase();
    if (value === "groq") {
      return {
        label: "Groq",
        linkText: "Open Groq Console",
        href: "https://console.groq.com/keys",
        steps: [
          "Sign in to your Groq account.",
          "Open API Keys and create a new key.",
          "Copy the key once shown.",
          "Paste it into API Key below."
        ]
      };
    }
    return {
      label: "OpenRouter",
      linkText: "Open OpenRouter Keys",
      href: "https://openrouter.ai/keys",
      steps: [
        "Sign in to your OpenRouter account.",
        "Create a new API key from the keys page.",
        "Copy the key value.",
        "Paste it into API Key below."
      ]
    };
  }

  function openApiKeyGuidePrompt(root) {
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;
    const provider = normalize(view.querySelector('[name="provider"]')?.value || "openrouter");
    if (!providerNeedsApiKey(provider)) return;
    state.showApiKeyPermissionModal = true;
    renderSettings(root);
  }

  function applyProviderDefaultsToSettingsForm(root) {
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;
    const providerSelect = view.querySelector('[name="provider"]');
    const keyInput = view.querySelector('[name="apiKey"]');
    if (!(providerSelect instanceof HTMLSelectElement)) return;

    const provider = normalize(providerSelect.value || "openrouter").toLowerCase();
    if (keyInput instanceof HTMLInputElement) {
      keyInput.placeholder = apiKeyPlaceholderForProvider(provider);
    }
  }

  function bindRootEvents(root) {
    if (root.getAttribute("data-bound") === "true") return;

    root.addEventListener("mousedown", (event) => {
      const grip = event.target.closest(".rv-resize-grip");
      if (!(grip instanceof HTMLElement)) return;
      const which = parseInt(grip.getAttribute("data-resize") || "0", 10);
      if (!which || which < 1 || which > 4) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidths = getColumnWidths();
      let currentWidths = { ...startWidths };
      const colKey = `col${which}`;

      function onMove(e) {
        const delta = e.clientX - startX;
        const next = Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, (startWidths[colKey] || 0) + delta));
        currentWidths = { ...currentWidths, [colKey]: next };
        applyColumnWidths(root, currentWidths);
      }

      function onUp() {
        saveColumnWidths(currentWidths);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }, true);

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest(".rv-settings")) {
        consumeEvent(event);
        openSettingsView(root);
        return;
      }

      if (target.closest(".rv-api-key-permission")) {
        consumeEvent(event);
        openApiKeyGuidePrompt(root);
        return;
      }

      if (target.closest(".rv-api-permission-allow")) {
        consumeEvent(event);
        state.apiKeyGuideGranted = true;
        state.showApiKeyPermissionModal = false;
        renderSettings(root);
        return;
      }

      if (target.closest(".rv-api-permission-decline")) {
        consumeEvent(event);
        state.apiKeyGuideGranted = false;
        state.showApiKeyPermissionModal = false;
        renderSettings(root);
        return;
      }

      if (target.closest(".rv-settings-view")) return;

      if (target.closest(".rv-back")) {
        consumeEvent(event);
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = false;
        state.mergedMessages = [];
        state.contactThreadIds = [];
        state.contactDisplayName = "";
        state.currentThreadIdForReply = "";
        state.activeContactKey = "";
        state.contactChatLoading = false;
        state.threadExtractRetry = 0;
        const targetHash = sanitizeListHash(state.lastListHash || "#inbox");
        state.lastListHash = targetHash;
        navigateToList(targetHash, "", { native: false });
        renderCurrentView(root);
        return;
      }

      if (target.closest(".rv-ai-qa-submit")) {
        consumeEvent(event);
        askInboxQuestion(root);
        return;
      }

      if (target.closest(".rv-thread-send")) {
        consumeEvent(event);
        const input = root.querySelector(".rv-thread-input");
        if (!(input instanceof HTMLInputElement)) return;
        const text = (input.value || "").trim();
        if (!text) return;
        if (!window.ReskinCompose || typeof window.ReskinCompose.replyToThread !== "function") {
          logWarn("ReskinCompose.replyToThread not available");
          return;
        }
        input.disabled = true;
        const sendBtn = root.querySelector(".rv-thread-send");
        if (sendBtn instanceof HTMLElement) { sendBtn.textContent = "Sending..."; sendBtn.setAttribute("disabled", "true"); }
        window.ReskinCompose.replyToThread(text).then((ok) => {
          if (ok) {
            input.value = "";
            setTimeout(() => {
              const latestRoot = document.getElementById(ROOT_ID);
              if (latestRoot instanceof HTMLElement) renderThread(latestRoot);
            }, 2000);
          } else {
            logWarn("Reply failed — Gmail reply UI not found");
          }
        }).catch((err) => {
          logWarn("Reply error", err);
        }).finally(() => {
          input.disabled = false;
          if (sendBtn instanceof HTMLElement) { sendBtn.textContent = "Send"; sendBtn.removeAttribute("disabled"); }
        });
        return;
      }

      const chatShell = target.closest(".rv-ai-chat");
      if (chatShell instanceof HTMLElement) {
        const interactive = target.closest("button, a, textarea, input, select, [role='button']");
        if (!interactive) {
          const input = root.querySelector(".rv-ai-qa-input");
          if (input instanceof HTMLTextAreaElement) input.focus();
        }
      }

      const triageItem = target.closest(".rv-triage-item");
      if (triageItem instanceof HTMLElement) {
        consumeEvent(event);
        if (state.currentView === "settings") saveSettingsFromDom(root);
        lockInteractions(700);
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = false;
        const rawLevel = normalize(triageItem.getAttribute("data-triage-level") || "");
        const level = TRIAGE_LEVELS.find((l) => l.toLowerCase() === rawLevel.toLowerCase()) || rawLevel;
        const nextHash = level === "all" ? "#inbox" : `#inbox?triage=${level}`;
        if (level !== "all" && !TRIAGE_LEVELS.includes(level)) return;
        state.lastListHash = "#inbox";
        state.triageFilter = level === "all" ? "" : level;
        state.listVisibleByMailbox[mailboxCacheKey("inbox")] = state.listChunkSize;
        navigateToList(nextHash, "", { native: false });
        const list = root.querySelector(".rv-list");
        if (list instanceof HTMLElement) {
          list.innerHTML = '<div class="rv-empty" data-reskin="true">Loading inbox triage...</div>';
        }
        setTimeout(() => {
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement) applyReskin();
        }, 320);
        return;
      }

      const serverItem = target.closest(".rv-server-item, .rv-server-icon, .rv-icon-home");
      if (serverItem instanceof HTMLElement) {
        consumeEvent(event);
        const id = serverItem.getAttribute("data-server-id");
        state.currentServerId = id === "" || id === null || id === undefined ? null : id;
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        applyReskin();
        return;
      }

      const serverNew = target.closest(".rv-server-new, .rv-icon-new-server");
      if (serverNew instanceof HTMLElement) {
        consumeEvent(event);
        const name = window.prompt("Server name (e.g. Back deck quotes)", "");
        if (name != null && normalize(name)) {
          const id = `server-${Date.now()}`;
          state.servers = state.servers || [];
          state.servers.push({ id, name: normalize(name), threadIds: [] });
          state.currentServerId = id;
          schedulePersistSyncDraft();
          applyReskin();
        }
        return;
      }

      const serverBtn = target.closest(".rv-item-server-btn");
      if (serverBtn instanceof HTMLElement) {
        consumeEvent(event);
        const threadId = normalize(serverBtn.getAttribute("data-thread-id") || "");
        if (!threadId) return;
        const canonical = canonicalThreadId(threadId);
        let menu = root.querySelector(".rv-server-menu");
        if (menu instanceof HTMLElement) menu.remove();
        menu = document.createElement("div");
        menu.className = "rv-server-menu";
        menu.setAttribute("data-reskin", "true");
        const rect = serverBtn.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        menu.style.position = "absolute";
        menu.style.left = `${rect.left - rootRect.left}px`;
        menu.style.top = `${rect.bottom - rootRect.top + 4}px`;
        menu.style.minWidth = "160px";
        const server = state.currentServerId ? state.servers.find((s) => s.id === state.currentServerId) : null;
        if (server && threadIdInServer(threadId, server)) {
          menu.innerHTML = `<button type="button" class="rv-server-menu-item" data-action="remove" data-reskin="true">Remove from server</button>`;
        } else {
          const addButtons = (state.servers || []).map((s) => `<button type="button" class="rv-server-menu-item" data-action="add" data-server-id="${escapeHtml(s.id)}" data-reskin="true">Add to ${escapeHtml(s.name || "Unnamed")}</button>`).join("");
          menu.innerHTML = addButtons || `<span class="rv-server-menu-empty" data-reskin="true">No servers. Create one in the sidebar.</span>`;
        }
        root.appendChild(menu);
        const closeMenu = (ev) => {
          if (ev && ev.target instanceof Node && menu.contains(ev.target)) return;
          if (menu && menu.parentNode) menu.remove();
          root.removeEventListener("click", closeMenu);
        };
        root.addEventListener("click", closeMenu);
        setTimeout(() => {
          menu.querySelectorAll(".rv-server-menu-item").forEach((btn) => {
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (menu && menu.parentNode) menu.remove();
              root.removeEventListener("click", closeMenu);
              const action = btn.getAttribute("data-action");
              const serverId = btn.getAttribute("data-server-id");
              if (action === "remove" && server) {
                server.threadIds = (server.threadIds || []).filter((id) => canonicalThreadId(normalize(id)) !== canonical);
                schedulePersistSyncDraft();
              } else if (action === "add" && serverId) {
                const s = state.servers.find((sv) => sv.id === serverId);
                if (s && canonical && !(s.threadIds || []).some((id) => canonicalThreadId(normalize(id)) === canonical)) {
                  s.threadIds = s.threadIds || [];
                  s.threadIds.push(canonical);
                  schedulePersistSyncDraft();
                }
              }
              applyReskin();
            });
          });
        }, 0);
        return;
      }

      const navItem = target.closest(".rv-nav-item");
      if (!(navItem instanceof HTMLElement)) return;
      consumeEvent(event);
      if (state.currentView === "settings") saveSettingsFromDom(root);
      lockInteractions(900);
      const nextHash = navItem.getAttribute("data-target-hash") || "#inbox";
      const nativeLabel = navItem.getAttribute("data-native-label") || "";
      state.settingsPinned = false;
      state.currentView = "list";
      state.activeThreadId = "";
      state.lockListView = false;
      state.lastListHash = sanitizeListHash(nextHash, { clearTriage: true });
      state.triageFilter = "";
      state.listVisibleByMailbox[mailboxCacheKey(parseListRoute(state.lastListHash).mailbox)] = state.listChunkSize;
      navigateToList(state.lastListHash, nativeLabel);

      const list = root.querySelector(".rv-list");
      if (list instanceof HTMLElement) {
        list.innerHTML = `<div class="rv-empty" data-reskin="true">Loading ${escapeHtml(nextHash.replace("#", ""))}...</div>`;
      }

      setTimeout(() => {
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement) applyReskin();
      }, 250);

      setTimeout(() => {
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement) applyReskin();
      }, 900);

      return;
    });

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const loadMore = target.closest(".rv-list-more");
      if (!(loadMore instanceof HTMLElement)) return;
      consumeEvent(event);
      const mailbox = mailboxCacheKey(activeMailbox());
      const current = Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize);
      state.listVisibleByMailbox[mailbox] = current + state.listChunkSize;
      const latestRoot = document.getElementById(ROOT_ID);
      if (latestRoot instanceof HTMLElement) renderCurrentView(latestRoot);
    });

    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const providerSelect = target.closest('[name="provider"]');
      if (providerSelect instanceof HTMLSelectElement) {
        applyProviderDefaultsToSettingsForm(root);
        const view = root.querySelector(".rv-settings-view");
        if (!(view instanceof HTMLElement)) return;
        const keyInput = view.querySelector('[name="apiKey"]');
        if (keyInput instanceof HTMLInputElement) {
          keyInput.placeholder = apiKeyPlaceholderForProvider(providerSelect.value);
        }
        scheduleSettingsAutosave(root, 250);
        return;
      }

      if (target.closest(".rv-settings-view")) {
        const themeSelect = target.closest('[name="theme"]');
        if (themeSelect instanceof HTMLSelectElement || themeSelect instanceof HTMLInputElement) {
          if (!state.settingsCache) state.settingsCache = {};
          state.settingsCache.theme = normalizeTheme(themeSelect.value);
          const view = root.querySelector(".rv-settings-view");
          if (view instanceof HTMLElement) {
            for (const option of view.querySelectorAll(".rv-theme-option")) {
              if (!(option instanceof HTMLElement)) continue;
              const input = option.querySelector('input[name="theme"]');
              option.classList.toggle("is-active", input instanceof HTMLInputElement && input.checked);
            }
          }
          applyTheme(root);
        }
        scheduleSettingsAutosave(root, 450);
      }
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      state.aiQuestionText = target.value || "";
      target.classList.toggle("is-has-text", Boolean(normalize(target.value || "")));
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const view = target.closest(".rv-settings-view");
      if (!(view instanceof HTMLElement)) return;
      if (target.classList.contains("rv-ai-qa-input")) return;
      scheduleSettingsAutosave(root, 700);
    });

    root.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      if (event.key !== "Enter" || event.shiftKey) return;
      consumeEvent(event);
      askInboxQuestion(root);
    });

    root.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      target.classList.add("is-focused");
    });

    root.addEventListener("focusout", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      target.classList.remove("is-focused");
    });

    root.setAttribute("data-bound", "true");
  }

  function selectRows(scopeRoot) {
    const hasScopedRoot = scopeRoot instanceof HTMLElement;
    const scope = hasScopedRoot ? scopeRoot : document;
    const selectors = hasScopedRoot ? SCOPED_ROW_SELECTORS : ROW_SELECTORS;
    const unique = new Set();
    const rows = [];
    for (const selector of selectors) {
      const nodes = scope.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (unique.has(node)) continue;
        unique.add(node);
        rows.push(node);
      }
    }
    return rows;
  }

  function extractThreadIdFromRow(row) {
    const fromAttr =
      row.getAttribute("data-thread-id") ||
      row.getAttribute("data-legacy-thread-id") ||
      row.getAttribute("data-article-id") ||
      "";
    if (fromAttr) return fromAttr;

    const idNode = row.querySelector("[data-thread-id], [data-legacy-thread-id], [data-article-id]");
    if (idNode instanceof HTMLElement) {
      const nestedId =
        idNode.getAttribute("data-thread-id") ||
        idNode.getAttribute("data-legacy-thread-id") ||
        idNode.getAttribute("data-article-id") ||
        "";
      if (nestedId) return nestedId;
    }

    const link = row.querySelector('a[href*="th="], a[href*="#"], a[href]');
    if (link instanceof HTMLAnchorElement) {
      const fromHref = threadIdFromHref(link.getAttribute("href"));
      if (fromHref) return fromHref;
    }

    return "";
  }

  function threadIdFromHref(href) {
    const value = normalize(href);
    if (!value) return "";

    const matchTh = value.match(/[?#&]th=([A-Za-z0-9_-]+)/);
    if (matchTh && matchTh[1]) return matchTh[1];

    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) {
      const hash = value.slice(hashIndex + 1);
      const hashWithoutQuery = hash.split("?")[0];
      const parts = hashWithoutQuery.split("/").filter(Boolean);
      const tail = (parts[parts.length - 1] || "").trim();
      const isFolder = /^(inbox|all|sent|drafts|starred|spam|trash)$/i.test(tail);
      if (!isFolder && tail.length >= 6) return tail;
    }
    return "";
  }

  function fallbackThreadIdFromRow(row, index = 0) {
    const seed = normalize(
      row.getAttribute("aria-label") ||
      row.getAttribute("data-article-id") ||
      row.getAttribute("data-thread-id") ||
      row.getAttribute("data-legacy-thread-id") ||
      row.textContent
    ).slice(0, 180);
    if (!seed) return `synthetic-${index}`;

    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return `synthetic-${hash.toString(36)}`;
  }

  function messageDedupeKey(threadId, href) {
    const id = normalize(threadId || "");
    const link = normalize(href || "");
    return `${id}|${link}`;
  }

  function extractSender(row) {
    const senderCandidates = [
      row.querySelector(".yW span[email]"),
      row.querySelector(".yP"),
      row.querySelector("span[email]"),
      row.querySelector("[email]"),
      row.querySelector("span[name]"),
      row.querySelector("[data-hovercard-id]")
    ];
    for (const node of senderCandidates) {
      if (!node) continue;
      const fromEmail = normalize(node.getAttribute("email"));
      if (isUseful(fromEmail)) return fromEmail;
      const fromHovercard = normalize(node.getAttribute("data-hovercard-id"));
      if (isUseful(fromHovercard)) return fromHovercard;
      const fromText = normalize(node.textContent);
      if (isUseful(fromText)) return fromText;
      const fromTitle = normalize(node.getAttribute("title"));
      if (isUseful(fromTitle)) return fromTitle;
      const fromAria = normalize(node.getAttribute("aria-label"));
      if (isUseful(fromAria)) return fromAria;
    }

    const rowAria = normalize(row.getAttribute("aria-label"));
    if (rowAria) {
      const first = normalize(rowAria.split(/[,|-]/)[0]);
      if (isUseful(first) && !looksLikeDateOrTime(first)) return first;
    }
    return "Unknown sender";
  }

  function extractDate(row) {
    const monthDay = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}$/;
    const clock = /^\d{1,2}:\d{2}\s?(AM|PM)$/i;
    const relative = /^\d+\s?(m|h|d|w)$/i;

    const nodes = Array.from(row.querySelectorAll("td, span, div"));
    const candidates = [];
    for (const node of nodes) {
      const text = normalize(node.textContent);
      if (!text || text.length > 16) continue;
      if (monthDay.test(text) || clock.test(text) || relative.test(text)) {
        candidates.push(text);
      }
    }
    if (candidates.length > 0) return candidates[candidates.length - 1];
    return "";
  }

  function extractSnippet(row) {
    const snippets = [
      row.querySelector(".y2"),
      row.querySelector("span.y2"),
      row.querySelector('[role="gridcell"] span')
    ];
    for (const node of snippets) {
      if (!(node instanceof HTMLElement)) continue;
      const text = normalize(node.innerText || node.textContent);
      if (text.length >= 6) return text;
    }
    return "";
  }

  function extractSubject(row, sender) {
    const primarySubject = normalize(
      row.querySelector(".bog, .y6 span, span.bog")?.textContent ||
      row.querySelector(".y6")?.textContent
    );
    if (
      isUseful(primarySubject) &&
      primarySubject.toLowerCase() !== sender.toLowerCase() &&
      !looksLikeDateOrTime(primarySubject)
    ) {
      return primarySubject;
    }

    const candidateSelectors = [
      '[role="link"][aria-label]',
      '[role="link"][title]',
      '[role="link"] span[title]',
      '[role="link"] span',
      "span[title]"
    ];

    const candidates = [];
    for (const selector of candidateSelectors) {
      for (const node of row.querySelectorAll(selector)) {
        const text = normalize(node.textContent);
        const title = normalize(node.getAttribute("title"));
        if (isUseful(text)) candidates.push(text);
        if (isUseful(title)) candidates.push(title);
      }
    }

    const filtered = candidates.filter((value) => {
      if (!isUseful(value)) return false;
      if (value.toLowerCase() === sender.toLowerCase()) return false;
      if (NOISE_TEXT.has(value.toLowerCase())) return false;
      if (looksLikeDateOrTime(value)) return false;
      return true;
    });

    if (filtered.length > 0) {
      filtered.sort((a, b) => a.length - b.length);
      return filtered[0];
    }

    const aria = normalize(row.getAttribute("aria-label"));
    if (aria) {
      const parts = aria
        .split(/[-,|]/)
        .map((part) => normalize(part))
        .filter(Boolean);
      for (const part of parts) {
        if (!isUseful(part)) continue;
        if (part.toLowerCase() === sender.toLowerCase()) continue;
        if (looksLikeDateOrTime(part)) continue;
        return part;
      }
    }

    return "No subject captured";
  }

  function cleanSubject(subject, sender, date) {
    let value = normalize(subject);
    if (!value) return "No subject captured";

    if (sender) {
      const escapedSender = sender.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`^${escapedSender}\\s*[-,:]?\\s*`, "i"), "");
    }

    if (date) {
      const escapedDate = date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`\\s*[-,|]?\\s*${escapedDate}\\s*$`, "i"), "");
    }

    value = value
      .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi, "")
      .replace(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi, "")
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/gi, "")
      .replace(/\s+[|-]\s+.*$/, "")
      .replace(/^\s*(re|fw|fwd)\s*:\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s*[-,|:]\s*$/, "")
      .trim();

    return isUseful(value) ? value : "No subject captured";
  }

  function collectMessages(limit = 200) {
    const mainRoot = getGmailMainRoot();
    const queryRoot = mainRoot instanceof HTMLElement ? mainRoot : document;
    const linkSelectors = mainRoot instanceof HTMLElement ? SCOPED_LINK_SELECTORS : LINK_SELECTORS;
    const rows = selectRows(mainRoot);
    const items = [];
    const seen = new Set();
    let source = "rows";
    const mailboxKey = mailboxKeyFromHash(state.lastListHash || window.location.hash || "#inbox");
    const strictMailbox = mailboxKey !== "inbox";

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!(row instanceof HTMLElement)) continue;
      const rowLink = row.querySelector('a[href*="th="], a[href*="#inbox/"], a[href*="#all/"], a[href*="#label/"], a[href*="#sent/"], a[href*="#"], [role="link"][data-thread-id], [role="link"][data-legacy-thread-id]');
      const href = rowLink instanceof HTMLElement ? (rowLink.getAttribute("href") || "") : "";
      const threadId =
        extractThreadIdFromRow(row) ||
        threadIdFromHref(href) ||
        fallbackThreadIdFromRow(row, index);
      const dedupeKey = messageDedupeKey(threadId, href);
      if (seen.has(dedupeKey)) continue;

      const sender = extractSender(row);
      const date = extractDate(row);
      const subject = cleanSubject(extractSubject(row, sender), sender, date);
      const snippet = extractSnippet(row);
      if (sender === "Unknown sender" && subject === "No subject captured" && !isUseful(snippet)) continue;
      if (strictMailbox && (!href || !hrefMatchesMailbox(href, mailboxKey))) continue;

      seen.add(dedupeKey);
      const unread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
      items.push({ threadId, sender, subject, snippet, bodyText: "", date, href, row, triageLevel: "", unread });
      if (items.length >= limit) break;
    }

    if (items.length < limit) {
      source = items.length > 0 ? "rows+links" : "links";
      for (const selector of linkSelectors) {
        const links = Array.from(queryRoot.querySelectorAll(selector));
        if (links.length === 0) continue;

        for (const link of links) {
          if (!(link instanceof HTMLElement)) continue;
          const href = link.getAttribute("href") || "";
          const threadId = threadIdFromHref(href);
          const dedupeKey = messageDedupeKey(threadId, href);
          if (!threadId || seen.has(dedupeKey)) continue;
          if (strictMailbox && !hrefMatchesMailbox(href, mailboxKey)) continue;

          const row = link.closest('[role="row"], tr, [data-thread-id], [data-legacy-thread-id], .zA');
          const sender = row ? extractSender(row) : "Unknown sender";
          const date = row ? extractDate(row) : "";
          const snippet = row ? extractSnippet(row) : "";
          const linkTitle = normalize(link.getAttribute("title"));
          const linkText = normalize(link.textContent);
          const subject = cleanSubject(
            (isUseful(linkTitle) && linkTitle) ||
              (isUseful(linkText) && linkText) ||
              (row ? extractSubject(row, sender) : "No subject captured"),
            sender,
            date
          );
          if (sender === "Unknown sender" && subject === "No subject captured" && !isUseful(snippet)) continue;

          seen.add(dedupeKey);
          const unread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
          items.push({ threadId, sender, subject, snippet, bodyText: "", date, href, row, triageLevel: "", unread });
          if (items.length >= limit) break;
        }

        if (items.length >= limit) break;
      }
    }

    return { items, source };
  }

  function mailboxCacheKey(mailbox) {
    const value = normalize(mailbox || "").toLowerCase();
    return value || "inbox";
  }

  function messageCacheKey(msg) {
    if (!msg || typeof msg !== "object") return "";
    return `${normalize(msg.threadId || "")}|${normalize(msg.href || "")}`;
  }

  function mergeMailboxCache(mailbox, incoming) {
    const key = mailboxCacheKey(mailbox);
    const existing = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    const map = new Map();
    for (const msg of existing) {
      const id = messageCacheKey(msg);
      if (!id) continue;
      map.set(id, msg);
    }
    for (const msg of incoming || []) {
      const id = messageCacheKey(msg);
      if (!id) continue;
      map.set(id, {
        threadId: msg.threadId || "",
        sender: msg.sender || "",
        subject: msg.subject || "",
        snippet: msg.snippet || "",
        bodyText: msg.bodyText || "",
        date: msg.date || "",
        href: msg.href || "",
        row: msg.row || null,
        triageLevel: msg.triageLevel || "",
        unread: Boolean(msg.unread)
      });
    }
    const merged = Array.from(map.values());
    state.scannedMailboxMessages[key] = merged;
    return merged;
  }

  function getMailboxMessages(mailbox, limit = 300) {
    const key = mailboxCacheKey(mailbox);
    const cached = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    if (cached.length > 0) return cached.slice(0, limit);
    const live = collectMessages(limit).items || [];
    return mergeMailboxCache(key, live).slice(0, limit);
  }

  function firstPageFingerprint() {
    const rows = collectMessages(5).items || [];
    return rows.map((item) => normalize(item.threadId || item.href || "")).join("|");
  }

  function isDisabledButton(node) {
    if (!(node instanceof HTMLElement)) return true;
    if (node.getAttribute("aria-disabled") === "true") return true;
    if (node.getAttribute("disabled") !== null) return true;
    return false;
  }

  function findPagerButton(kind) {
    const labels = kind === "next" ? ["Older", "older"] : ["Newer", "newer"];
    const candidates = [];
    for (const label of labels) {
      candidates.push(
        `[aria-label="${label}"][role="button"]`,
        `[aria-label*="${label}"][role="button"]`,
        `[aria-label="${label}"]`,
        `[aria-label*="${label}"]`
      );
    }
    for (const selector of candidates) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) return node;
    }
    return null;
  }

  function dispatchSyntheticClick(node) {
    if (!(node instanceof HTMLElement)) return;
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  async function waitForPageChange(previousFingerprint, timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = firstPageFingerprint();
      if (current && current !== previousFingerprint) return true;
      await sleep(140);
    }
    return false;
  }

  async function runFullMailboxScan(root) {
    if (state.fullScanRunning) return;
    if (!(root instanceof HTMLElement)) return;
    const mailbox = mailboxCacheKey(activeMailbox());
    const cacheEmpty = !Array.isArray(state.scannedMailboxMessages[mailbox]) || state.scannedMailboxMessages[mailbox].length === 0;
    if (state.currentView !== "list" && !cacheEmpty) return;
    if (activeMailbox() !== "inbox") {
      state.fullScanStatus = "Full scan currently supports Inbox only.";
      renderSidebar(root);
      return;
    }

    state.fullScanRunning = true;
    state.fullScanStatus = "Starting full inbox scan...";
    state.fullScanCompletedByMailbox[mailbox] = false;
    renderSidebar(root);

    let pageCount = 0;
    let movedPages = 0;
    const maxPages = 120;
    try {
      while (pageCount < maxPages) {
        const result = collectMessages(250);
        const merged = mergeMailboxCache(mailbox, result.items || []);
        state.fullScanStatus = `Scanning page ${pageCount + 1}... found ${merged.length} emails`;
        renderSidebar(root);

        const nextButton = findPagerButton("next");
        if (!(nextButton instanceof HTMLElement) || isDisabledButton(nextButton)) {
          break;
        }
        const previousFingerprint = firstPageFingerprint();
        dispatchSyntheticClick(nextButton);
        const changed = await waitForPageChange(previousFingerprint, 7000);
        if (!changed) break;
        movedPages += 1;
        pageCount += 1;
        await sleep(220);
      }

      for (let i = 0; i < movedPages; i += 1) {
        const prevButton = findPagerButton("prev");
        if (!(prevButton instanceof HTMLElement) || isDisabledButton(prevButton)) break;
        const previousFingerprint = firstPageFingerprint();
        dispatchSyntheticClick(prevButton);
        const changed = await waitForPageChange(previousFingerprint, 7000);
        if (!changed) break;
        await sleep(180);
      }

      const count = Array.isArray(state.scannedMailboxMessages[mailbox])
        ? state.scannedMailboxMessages[mailbox].length
        : 0;
      state.fullScanCompletedByMailbox[mailbox] = true;
      state.fullScanStatus = `Full scan complete. Cached ${count} inbox emails.`;
      const visible = Number(state.listVisibleByMailbox[mailbox] || 0);
      if (!visible) state.listVisibleByMailbox[mailbox] = state.listChunkSize;
    } catch (error) {
      const message = error && error.message ? String(error.message) : "Scan failed";
      state.fullScanStatus = `Full scan failed: ${message.slice(0, 120)}`;
      logWarn("Full mailbox scan failed", error);
    } finally {
      state.fullScanRunning = false;
      const latestRoot = document.getElementById(ROOT_ID);
      if (latestRoot instanceof HTMLElement) renderCurrentView(latestRoot);
    }
  }

  function parseLastCountQuery(question) {
    const q = normalize(question).toLowerCase();
    const match = q.match(/\blast\s+(\d{1,3})\s+(emails?|messages?)\b/);
    if (!match) return 0;
    return Math.max(1, Math.min(200, Number(match[1]) || 0));
  }

  function parseFromDateQuery(question) {
    const q = normalize(question);
    const match = q.match(/\bfrom\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i);
    if (!match) return "";
    return normalize(match[1]).toLowerCase();
  }

  function parseKeywordQuery(question) {
    const q = normalize(question);
    const quoted = q.match(/"(.*?)"/);
    if (quoted && normalize(quoted[1])) return normalize(quoted[1]).toLowerCase();
    const withMatch = q.match(/\b(?:with|containing|keyword)\s+([A-Za-z0-9@._:-]{2,})\b/i);
    if (!withMatch) return "";
    return normalize(withMatch[1]).toLowerCase();
  }

  function selectMessagesForQuestion(question, messages) {
    const all = Array.isArray(messages) ? messages.slice() : [];
    if (all.length === 0) return [];
    const lastCount = parseLastCountQuery(question);
    if (lastCount > 0) return all.slice(0, lastCount);

    const dateToken = parseFromDateQuery(question);
    if (dateToken) {
      const byDate = all.filter((msg) => normalize(msg.date || "").toLowerCase().includes(dateToken));
      if (byDate.length > 0) return byDate.slice(0, 120);
    }

    const keyword = parseKeywordQuery(question);
    if (keyword) {
      const byKeyword = all.filter((msg) => {
        const haystack = `${msg.sender || ""}\n${msg.subject || ""}\n${msg.snippet || ""}\n${msg.bodyText || ""}`
          .toLowerCase();
        return haystack.includes(keyword);
      });
      if (byKeyword.length > 0) return byKeyword.slice(0, 120);
    }

    return all.slice(0, 80);
  }

  function openThread(threadId, href = "", row = null) {
    if (!threadId && !href && !(row instanceof HTMLElement)) return false;

    const link = threadId
      ? (
        document.querySelector(`[role="main"] a[href$="/${CSS.escape(threadId)}"]`) ||
        document.querySelector(`[role="main"] a[href*="/${CSS.escape(threadId)}"]`) ||
        document.querySelector(`a[href$="/${CSS.escape(threadId)}"]`) ||
        document.querySelector(`a[href*="/${CSS.escape(threadId)}"]`) ||
        document.querySelector(`a[href*="th=${CSS.escape(threadId)}"]`)
      )
      : null;

    if (link instanceof HTMLElement) {
      link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    const domRow = threadId
      ? (
        document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`) ||
        document.querySelector(`[data-legacy-thread-id="${CSS.escape(threadId)}"]`)
      )
      : null;
    if (domRow instanceof HTMLElement) {
      domRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      domRow.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      domRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    if (row instanceof HTMLElement) {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    if (href) {
      window.location.hash = href.includes("#") ? href.slice(href.indexOf("#")) : href;
      return true;
    }

    return false;
  }

  const BODY_SELECTORS = '.a3s.aiL, .a3s, .ii.gt, .ii, div.ii, div[dir="ltr"], div[dir="auto"], div.ii.gt, [role="textbox"], [class*="a3s"], [class*=" ii "]';

  function extractOpenThreadData() {
    let main = document.querySelector('[role="main"]') || document.body;
    if (!(main instanceof HTMLElement)) {
      return { subject: "", messages: [] };
    }
    let threadExtractFailureStats = null;

    const subjectCandidates = Array.from(main.querySelectorAll("h1, h2, [role='heading']"))
      .map((node) => normalize(node.textContent))
      .filter((text) => isUseful(text) && !looksLikeDateOrTime(text));
    const subject = subjectCandidates[0] || "No subject";

    const messages = [];
    function extractSender(scope) {
      const selectors = [
        '.gD[email]', 'span[email]', '[email]',
        '[data-hovercard-id]', 'h3 span[dir="auto"]',
        'h3 span', '.go', 'h4', 'span.gD'
      ];
      for (const sel of selectors) {
        const node = scope.querySelector(sel);
        if (!(node instanceof HTMLElement)) continue;
        const emailAttr = node.getAttribute("email") || node.getAttribute("data-hovercard-id") || "";
        const text = normalize(node.innerText || node.textContent);
        if (emailAttr && isUseful(emailAttr)) {
          return text && isUseful(text) ? `${text} <${emailAttr}>` : emailAttr;
        }
        if (text && isUseful(text)) return text;
      }
      return "";
    }

    function extractDate(scope) {
      const selectors = ["span.g3[title]", "time", "span[title]", 'td.gH span[title]'];
      for (const sel of selectors) {
        const node = scope.querySelector(sel);
        if (!(node instanceof HTMLElement)) continue;
        const title = normalize(node.getAttribute("title") || "");
        if (title && (looksLikeDateOrTime(title) || /\b\d{4}\b/.test(title))) return title;
        const text = normalize(node.innerText || node.textContent);
        if (text && (looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text))) return text;
      }
      return "";
    }

    let topContainers;
    if (state.currentView === "thread" && document.body) {
      topContainers = document.body.querySelectorAll('[data-message-id]');
      if (topContainers.length === 0) topContainers = main.querySelectorAll('[data-message-id]');
    } else {
      topContainers = main.querySelectorAll('[data-message-id]');
      if (topContainers.length === 0 && document.body && document.body !== main) {
        topContainers = document.body.querySelectorAll('[data-message-id]');
      }
    }
    const seenBodies = new Set();
    const usedNodes = new Set();
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] === THREAD EXTRACT: [data-message-id] count = ${topContainers.length} ===`);
    }
    for (const container of Array.from(topContainers)) {
      if (!(container instanceof HTMLElement)) continue;
      if (usedNodes.has(container)) continue;
      const scope = container;
      const mid = scope.getAttribute("data-message-id") || "(none)";
      const sender = extractSender(scope);
      const date = extractDate(scope);
      let bodyNode = scope.querySelector(BODY_SELECTORS);
      let bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML : "";
      let bodyText = bodyNode instanceof HTMLElement ? normalize(bodyNode.innerText || bodyNode.textContent) : "";
      if ((!bodyText || !bodyHtml) && bodyText.length < 3) {
        const iframes = scope.querySelectorAll("iframe");
        for (const ifr of iframes) {
          try {
            const doc = ifr.contentDocument;
            if (!doc || doc === document) continue;
            const innerBody = doc.querySelector(BODY_SELECTORS);
            if (innerBody instanceof HTMLElement) {
              const txt = normalize(innerBody.innerText || innerBody.textContent);
              if (txt && txt.length > bodyText.length) {
                bodyNode = innerBody;
                bodyHtml = innerBody.innerHTML;
                bodyText = txt;
                break;
              }
            }
          } catch (_) { /* cross-origin */ }
        }
      }
      const bodyFound = !!(bodyText || bodyHtml);
      if (DEBUG_THREAD_EXTRACT) {
        const preview = (bodyText || "").substring(0, 50).replace(/\n/g, " ");
        console.log(`[reskin] [data-message-id] mid=${mid} bodyFound=${bodyFound} sender=${(sender || "").substring(0, 30)} bodyPreview=${preview || "(empty)"}`);
      }
      if (!bodyText && !bodyHtml) {
        const snippet = normalize(scope.innerText || scope.textContent).slice(0, 300);
        if (!snippet && !isUseful(sender) && !date) continue;
        bodyText = snippet || "No content";
      }
      const dedupKey = (bodyText || "").replace(/\s+/g, "").substring(0, 300).toLowerCase();
      const uniqueKey = dedupKey || `${mid}-${date}-${(sender || "").slice(0, 20)}`;
      if (seenBodies.has(uniqueKey)) continue;
      seenBodies.add(uniqueKey);
      usedNodes.add(container);
      messages.push({
        sender: isUseful(sender) ? sender : "Unknown sender",
        date: date || "",
        bodyHtml: bodyHtml || "",
        bodyText: bodyText || "No content"
      });
    }
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] After [data-message-id] phase: messages.length = ${messages.length}`);
    }
    if (messages.length === 0 && state.currentView === "thread") {
      for (const ifr of document.querySelectorAll("iframe")) {
        try {
          const doc = ifr.contentDocument;
          if (!doc || doc === document) continue;
          const iframeBody = doc.body;
          if (!(iframeBody instanceof HTMLElement)) continue;
          const iframeContainers = iframeBody.querySelectorAll('[data-message-id]');
          if (iframeContainers.length === 0) continue;
          for (const container of Array.from(iframeContainers)) {
            if (!(container instanceof HTMLElement)) continue;
            const scope = container;
            const mid = scope.getAttribute("data-message-id") || "(none)";
            const sender = extractSender(scope);
            const date = extractDate(scope);
            let bodyNode = scope.querySelector(BODY_SELECTORS);
            let bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML : "";
            let bodyText = bodyNode instanceof HTMLElement ? normalize(bodyNode.innerText || bodyNode.textContent) : "";
            if ((!bodyText || bodyText.length < 3) && !bodyHtml) {
              for (const innerIfr of scope.querySelectorAll("iframe")) {
                try {
                  const idoc = innerIfr.contentDocument;
                  if (!idoc || idoc === document) continue;
                  const innerBody = idoc.querySelector(BODY_SELECTORS);
                  if (innerBody instanceof HTMLElement) {
                    const txt = normalize(innerBody.innerText || innerBody.textContent);
                    if (txt && txt.length > bodyText.length) {
                      bodyNode = innerBody;
                      bodyHtml = innerBody.innerHTML;
                      bodyText = txt;
                      break;
                    }
                  }
                } catch (_) {}
              }
            }
            if (!bodyText && !bodyHtml) {
              const snippet = normalize(scope.innerText || scope.textContent).slice(0, 300);
              if (!snippet && !isUseful(sender) && !date) continue;
              bodyText = snippet || "No content";
            }
            const dedupKey = (bodyText || "").replace(/\s+/g, "").substring(0, 300).toLowerCase();
            const uniqueKey = dedupKey || `ifr-${mid}-${date}-${(sender || "").slice(0, 20)}`;
            if (seenBodies.has(uniqueKey)) continue;
            seenBodies.add(uniqueKey);
            messages.push({
              sender: isUseful(sender) ? sender : "Unknown sender",
              date: date || "",
              bodyHtml: bodyHtml || "",
              bodyText: bodyText || "No content"
            });
          }
          if (messages.length > 0) break;
        } catch (_) { /* cross-origin */ }
      }
    }
    const runFallback = messages.length === 0 || state.currentView === "thread";
    if (runFallback) {
      let fallbackContainers;
      if (state.currentView === "thread" && document.body) {
        fallbackContainers = document.body.querySelectorAll('.kv, .gs, [role="listitem"]');
        if (fallbackContainers.length === 0) fallbackContainers = main.querySelectorAll('.kv, .gs, [role="listitem"]');
      } else {
        fallbackContainers = main.querySelectorAll('.kv, .gs, [role="listitem"]');
        if (fallbackContainers.length === 0 && document.body && document.body !== main) {
          fallbackContainers = document.body.querySelectorAll('.kv, .gs, [role="listitem"]');
        }
      }
      if (DEBUG_THREAD_EXTRACT) {
        console.log(`[reskin] Fallback phase: .kv, .gs, [role="listitem"] count = ${fallbackContainers.length}`);
      }
      for (const container of Array.from(fallbackContainers)) {
        if (!(container instanceof HTMLElement)) continue;
        let dominated = false;
        for (const other of Array.from(fallbackContainers)) {
          if (other !== container && other instanceof HTMLElement && other.contains(container)) { dominated = true; break; }
        }
        if (dominated) continue;
        const scope = container;
        const sender = extractSender(scope);
        const date = extractDate(scope);
        let bodyNode = scope.querySelector(BODY_SELECTORS);
        let bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML : "";
        let bodyText = bodyNode instanceof HTMLElement ? normalize(bodyNode.innerText || bodyNode.textContent) : "";
        if ((!bodyText || bodyText.length < 3) && !bodyHtml) {
          for (const ifr of scope.querySelectorAll("iframe")) {
            try {
              const doc = ifr.contentDocument;
              if (!doc || doc === document) continue;
              const innerBody = doc.querySelector(BODY_SELECTORS);
              if (innerBody instanceof HTMLElement) {
                const txt = normalize(innerBody.innerText || innerBody.textContent);
                if (txt && txt.length > (bodyText || "").length) {
                  bodyNode = innerBody;
                  bodyHtml = innerBody.innerHTML;
                  bodyText = txt;
                  break;
                }
              }
            } catch (_) { /* cross-origin */ }
          }
        }
        if (DEBUG_THREAD_EXTRACT) {
          const preview = (bodyText || "").substring(0, 50).replace(/\n/g, " ");
          console.log(`[reskin] fallback container tag=${scope.tagName} cls=${(scope.className || "").substring(0, 40)} bodyFound=${!!(bodyText || bodyHtml)} bodyPreview=${preview || "(empty)"}`);
        }
        if (!bodyText && !bodyHtml) {
          const snippet = normalize(scope.innerText || scope.textContent).slice(0, 300);
          if (!snippet && !isUseful(sender) && !date) continue;
          bodyText = snippet || "No content";
        }
        const dedupKey = (bodyText || "").replace(/\s+/g, "").substring(0, 300).toLowerCase();
        const uniqueKey = dedupKey || `fb-${date}-${(sender || "").slice(0, 20)}-${scope.className || ""}`;
        if (seenBodies.has(uniqueKey)) continue;
        seenBodies.add(uniqueKey);
        messages.push({
          sender: isUseful(sender) ? sender : "Unknown sender",
          date: date || "",
          bodyHtml: bodyHtml || "",
          bodyText: bodyText || "No content"
        });
      }
      if (DEBUG_THREAD_EXTRACT) {
        console.log(`[reskin] After fallback phase: messages.length = ${messages.length}`);
      }
    }

    if (messages.length === 0) {
      if (DEBUG_THREAD_EXTRACT) {
        console.log(`[reskin] Using single-message fallback (main-level body search)`);
        const mainHtmlLen = main.innerHTML ? main.innerHTML.length : 0;
        const mainChildren = Array.from(main.children).slice(0, 12).map((c) => `${c.tagName}.${(c.className || "").toString().slice(0, 40)}`);
        console.log(`[reskin] Thread DOM diagnostic: main.innerHTML.length=${mainHtmlLen}, main.children(up to 12)=${mainChildren.join(" | ")}`);
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach((ifr, i) => {
          let src = (ifr.src || "").slice(0, 60);
          let docOk = false;
          let queryLen = 0;
          let bestTextLen = 0;
          try {
            const doc = ifr.contentDocument;
            docOk = !!doc && doc !== document;
            if (docOk) {
              const nodes = doc.querySelectorAll(".a3s, .ii");
              queryLen = nodes.length;
              for (const n of Array.from(nodes).slice(0, 5)) {
                const len = normalize(n.innerText || n.textContent).length;
                if (len > bestTextLen) bestTextLen = len;
              }
            }
          } catch (_) { /* ignore */ }
          console.log(`[reskin] iframe[${i}] src=${src} contentDocumentOk=${docOk} .a3s/.ii count=${queryLen} bestTextLen=${bestTextLen}`);
        });
        const broad = Array.from(main.querySelectorAll('div[class*="ii"], div[class*="a3s"]')).slice(0, 8);
        broad.forEach((el, i) => {
          const len = normalize(el.innerText || el.textContent).length;
          const cls = (el.className || "").toString().slice(0, 30);
          console.log(`[reskin] main broad[${i}] class=${cls} textLen=${len}`);
        });
      }
      const sender = extractSender(main);
      const dateCandidates = Array.from(main.querySelectorAll("span.g3[title], time, span[title], div[title]"))
        .map((node) => normalize(node.getAttribute("title") || node.innerText || node.textContent))
        .filter((text) => looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text));
      const date = dateCandidates[0] || "";
      const bodySelectors = `${BODY_SELECTORS}, [data-message-id] .ii.gt, [data-message-id] .a3s, [role="listitem"] div[dir="ltr"], [role="listitem"] div[dir="auto"]`;
      let bodyNode = null;
      let bodyHtml = "";
      let bodyText = "";
      let bodyNodesCount = 0;
      if (state.currentView === "thread") {
        const allIframeNodes = [];
        const iframes = Array.from(document.querySelectorAll("iframe")).filter((f) => f && f.contentDocument);
        for (const ifr of iframes) {
          try {
            const doc = ifr.contentDocument;
            if (!doc || doc === document) continue;
            const nodes = Array.from(doc.querySelectorAll(bodySelectors)).filter((n) => n instanceof HTMLElement);
            allIframeNodes.push(...nodes);
            if (nodes.length === 0 && doc.body) {
              const divs = Array.from(doc.body.querySelectorAll("div")).filter((d) => d instanceof HTMLElement);
              let bestDiv = null;
              let bestLen = 0;
              for (const d of divs) {
                const t = normalize(d.innerText || d.textContent);
                if (t.length > bestLen && t.length >= 20 && !d.querySelector("script")) {
                  bestLen = t.length;
                  bestDiv = d;
                }
              }
              if (bestDiv && bestLen > (bodyText || "").length) {
                allIframeNodes.push(bestDiv);
              }
            }
          } catch (_) { /* cross-origin or detached */ }
        }
        allIframeNodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
        const best = allIframeNodes[0];
        if (best instanceof HTMLElement && normalize(best.innerText || best.textContent).length >= 3) {
          bodyNode = best;
          bodyHtml = best.innerHTML;
          bodyText = normalize(best.innerText || best.textContent);
          if (DEBUG_THREAD_EXTRACT) {
            console.log(`[reskin] Thread-view body from iframe, length=${bodyText.length}`);
          }
        }
      }
      if (!bodyText || bodyText.length < 3) {
        let bodyNodes = Array.from(main.querySelectorAll(bodySelectors)).filter((node) => node instanceof HTMLElement);
        if (bodyNodes.length === 0 && document.body && document.body !== main) {
          bodyNodes = Array.from(document.body.querySelectorAll(bodySelectors)).filter((node) => node instanceof HTMLElement);
        }
        bodyNodesCount = bodyNodes.length;
        bodyNodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
        const bestMain = bodyNodes[0];
        if (bestMain instanceof HTMLElement && normalize(bestMain.innerText || bestMain.textContent).length >= 3) {
          bodyNode = bestMain;
          bodyHtml = bestMain.innerHTML;
          bodyText = normalize(bestMain.innerText || bestMain.textContent);
        }
      }
      if (!bodyText || bodyText.length < 3) {
        const iframes = Array.from(document.querySelectorAll("iframe")).filter((f) => f && f.contentDocument);
        for (const ifr of iframes) {
          try {
            const doc = ifr.contentDocument;
            if (!doc || doc === document) continue;
            let nodes = Array.from(doc.querySelectorAll(bodySelectors)).filter((node) => node instanceof HTMLElement);
            if (nodes.length === 0 && doc.body) {
              const divs = Array.from(doc.body.querySelectorAll("div")).filter((d) => d instanceof HTMLElement);
              let bestDiv = null;
              let bestLen = 0;
              for (const d of divs) {
                const t = normalize(d.innerText || d.textContent);
                if (t.length > bestLen && t.length >= 20 && !d.querySelector("script")) {
                  bestLen = t.length;
                  bestDiv = d;
                }
              }
              if (bestDiv) nodes = [bestDiv];
            }
            nodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
            const best = nodes[0];
            if (best instanceof HTMLElement) {
              const txt = normalize(best.innerText || best.textContent);
              if (txt && txt.length > (bodyText || "").length) {
                bodyNode = best;
                bodyHtml = best.innerHTML;
                bodyText = txt;
                if (DEBUG_THREAD_EXTRACT) {
                  console.log(`[reskin] Single-message body from iframe, length=${bodyText.length}`);
                }
                break;
              }
            }
          } catch (_) { /* cross-origin or detached */ }
        }
      }
      if (DEBUG_THREAD_EXTRACT && (!bodyText || bodyText.length < 3)) {
        console.log(`[reskin] Single-message fallback: bodyNodes=${bodyNodesCount}, bodyTextLen=${(bodyText || "").length}, iframesChecked=${document.querySelectorAll("iframe").length}`);
      }
      const finalBodyText = bodyText || "Message body not captured yet.";
      if (finalBodyText === "Message body not captured yet.") {
        threadExtractFailureStats = {
          dataMessageId: topContainers.length,
          bodyNodes: bodyNodesCount,
          iframes: document.querySelectorAll("iframe").length
        };
      }
      messages.push({
        sender: isUseful(sender) ? sender : "Unknown sender",
        date,
        bodyHtml: finalBodyText.length >= 3 ? bodyHtml : "",
        bodyText: finalBodyText
      });
    }

    // Final dedup: one message per unique body content so identical text (e.g. same bubble repeated in DOM) shows once.
    // For empty/placeholder body, use date+sender so we keep every message in the thread.
    const dedupByContent = [];
    const seenBodyKeys = new Set();
    for (const m of messages) {
      const raw = (m.bodyText || "").trim();
      const bodyKey = raw && raw !== "No content" && raw !== "Message body not captured yet."
        ? raw.replace(/\s+/g, "").substring(0, 300).toLowerCase()
        : `\0${m.date}-${(m.sender || "").slice(0, 40)}`;
      if (seenBodyKeys.has(bodyKey)) continue;
      seenBodyKeys.add(bodyKey);
      dedupByContent.push(m);
    }
    const finalMessages = dedupByContent.length ? dedupByContent : messages;

    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] Final messages (after content dedup): ${finalMessages.length} (was ${messages.length})`);
      finalMessages.forEach((m, i) => {
        const preview = (m.bodyText || "").substring(0, 50).replace(/\n/g, " ");
        console.log(`[reskin]   [${i}] sender=${(m.sender || "").substring(0, 35)} body=${preview || "(empty)"}`);
      });
      console.log(`[reskin] === END THREAD EXTRACT ===`);
    }
    if (finalMessages.length === 1 && (finalMessages[0].bodyText || "").trim() === "Message body not captured yet." && threadExtractFailureStats) {
      const now = Date.now();
      const lastLog = state.lastThreadBodyFailLogAt || 0;
      if (now - lastLog > 5000) {
        state.lastThreadBodyFailLogAt = now;
        const s = threadExtractFailureStats;
        logWarn(
          `Thread body not captured — [data-message-id]=${s.dataMessageId}, bodyNodes=${s.bodyNodes}, bodyTextLen=0, iframes=${s.iframes}. Set DEBUG_THREAD_EXTRACT=true in content.js for full diagnostics.`
        );
      }
    }

    return {
      subject: cleanSubject(subject, finalMessages[0] && finalMessages[0].sender, finalMessages[0] && finalMessages[0].date),
      messages: finalMessages
    };
  }

  function initialForSender(sender) {
    const s = normalize(sender || "").trim();
    const match = s.match(/\b([A-Za-z])/);
    return match ? match[1].toUpperCase() : "?";
  }

  function contactKeyFromMessage(msg) {
    if (!msg || typeof msg !== "object") return "";
    const s = normalize(msg.sender || "").trim();
    const emailMatch = s.match(/<([^>]+)>/);
    if (emailMatch) return emailMatch[1].toLowerCase().trim();
    if (s.length > 0) return s.toLowerCase();
    return "";
  }

  function senderDisplayName(raw) {
    const s = (raw || "").trim();
    const m = s.match(/^(.+?)\s*<[^>]+>$/);
    return m ? m[1].trim() : (s || "");
  }

  function groupMessagesByContact(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const byKey = new Map();
    for (const msg of messages) {
      const key = contactKeyFromMessage(msg);
      if (!key) continue;
      if (!byKey.has(key)) {
        const name = senderDisplayName(msg.sender) || key;
        byKey.set(key, { contactKey: key, contactName: name, threadIds: [], items: [] });
      }
      const g = byKey.get(key);
      if (!g.threadIds.includes(msg.threadId)) {
        g.threadIds.push(msg.threadId);
        g.items.push(msg);
      }
    }
    const groups = Array.from(byKey.values());
    for (const g of groups) {
      g.items.sort((a, b) => {
        const da = normalize(a.date || "").toLowerCase();
        const db = normalize(b.date || "").toLowerCase();
        return db.localeCompare(da);
      });
      g.threadIds = g.items.map((m) => m.threadId).filter(Boolean);
      g.latestItem = g.items[0] || null;
    }
    return groups;
  }

  function loadContactChat(group, root) {
    if (!group || !Array.isArray(group.threadIds) || group.threadIds.length === 0) return;
    state.contactChatLoading = true;
    state.contactThreadIds = group.threadIds.slice();
    state.contactDisplayName = group.contactName || (group.latestItem && senderDisplayName(group.latestItem.sender)) || "Chat";
    state.activeContactKey = group.contactKey || "";
    state.currentView = "thread";
    state.activeThreadId = group.threadIds[0] || "";
    state.mergedMessages = [];
    state.currentThreadIdForReply = "";
    state.lastListHash = "#inbox";
    window.location.hash = `#inbox/${group.threadIds[0]}`;
    renderList(root);
    renderCurrentView(root);

    const accumulated = [];
    let index = 0;

    function next() {
      if (index >= group.threadIds.length) {
        const seenKey = new Set();
        const merged = [];
        for (const m of accumulated) {
          const bodyKey = (m.bodyText || "").replace(/\s+/g, "").substring(0, 300).toLowerCase();
          const threadIdPart = m._threadId || "";
          const datePart = (m.date || "").trim().slice(0, 50);
          const key = `${threadIdPart}-${datePart}-${bodyKey || "\0empty"}`;
          if (seenKey.has(key)) continue;
          seenKey.add(key);
          const { _threadId, ...rest } = m;
          merged.push(rest);
        }
        merged.sort((a, b) => {
          const da = (a.date || "").trim().toLowerCase();
          const db = (b.date || "").trim().toLowerCase();
          return da.localeCompare(db);
        });
        state.mergedMessages = merged;
        state.currentThreadIdForReply = group.threadIds[0] || "";
        state.contactChatLoading = false;
        window.location.hash = `#inbox/${group.threadIds[0]}`;
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement) {
          renderCurrentView(latestRoot);
          renderThread(latestRoot);
        }
        return;
      }
      const threadId = group.threadIds[index];
      window.location.hash = `#inbox/${threadId}`;
      index += 1;
      setTimeout(() => {
        const data = extractOpenThreadData();
        if (Array.isArray(data.messages)) {
          for (const m of data.messages) {
            accumulated.push({ ...m, _threadId: threadId });
          }
        }
        next();
      }, 800);
    }

    setTimeout(next, 800);
  }

  function stripGmailHtmlToClean(html) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    temp.querySelectorAll("style, script, link, meta, head, title, iframe, object, embed, video, audio, canvas, svg, form").forEach((el) => el.remove());

    temp.querySelectorAll("img").forEach((img) => {
      const src = (img.getAttribute("src") || "").toLowerCase();
      const w = parseInt(img.getAttribute("width") || "999", 10);
      const h = parseInt(img.getAttribute("height") || "999", 10);
      if (w <= 3 || h <= 3 || src.includes("spacer") || src.includes("pixel") || src.includes("track") || src.startsWith("data:")) {
        img.remove();
        return;
      }
      const alt = (img.getAttribute("alt") || "").trim();
      if (alt && alt.length > 1) {
        const span = document.createElement("span");
        span.textContent = `[${alt}]`;
        img.replaceWith(span);
      }
    });

    temp.querySelectorAll(".gmail_quote, blockquote").forEach((el) => {
      const text = (el.textContent || "").trim();
      if (!text) { el.remove(); return; }
      const marker = document.createElement("div");
      marker.className = "rv-quoted-block";
      marker.setAttribute("data-reskin", "true");
      marker.textContent = text.substring(0, 200) + (text.length > 200 ? "..." : "");
      el.replaceWith(marker);
    });

    temp.querySelectorAll("*").forEach((el) => {
      if (!(el instanceof HTMLElement)) return;
      const tag = el.tagName.toLowerCase();
      if (tag !== "a") {
        el.removeAttribute("style");
        el.removeAttribute("class");
        el.removeAttribute("bgcolor");
        el.removeAttribute("background");
        el.removeAttribute("color");
        el.removeAttribute("width");
        el.removeAttribute("height");
        el.removeAttribute("align");
        el.removeAttribute("valign");
        el.removeAttribute("cellpadding");
        el.removeAttribute("cellspacing");
        el.removeAttribute("border");
        el.removeAttribute("face");
        el.removeAttribute("size");
      }
    });

    const tables = temp.querySelectorAll("table");
    tables.forEach((table) => {
      const rows = Array.from(table.querySelectorAll("tr"));
      const lines = [];
      rows.forEach((row) => {
        const cells = Array.from(row.querySelectorAll("td, th"));
        const parts = cells.map((c) => {
          const links = Array.from(c.querySelectorAll("a[href]"));
          if (links.length) {
            return links.map((a) => {
              const text = (a.textContent || "").trim();
              const href = a.getAttribute("href") || "";
              return text ? `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>` : "";
            }).filter(Boolean).join(" ");
          }
          return (c.textContent || "").trim();
        }).filter(Boolean);
        if (parts.length) lines.push(parts.join("  "));
      });
      if (lines.length) {
        const div = document.createElement("div");
        div.innerHTML = lines.join("<br>");
        table.replaceWith(div);
      } else {
        const text = (table.textContent || "").trim();
        if (text) {
          const div = document.createElement("div");
          div.textContent = text;
          table.replaceWith(div);
        } else {
          table.remove();
        }
      }
    });

    let result = temp.innerHTML;
    result = result.replace(/<(div|p|br|hr)\s*\/?>\s*<\/(div|p)>\s*/gi, "");
    result = result.replace(/(<br\s*\/?>){3,}/gi, "<br><br>");
    return result;
  }

  function sanitizeForShadow(html) {
    const temp = document.createElement("div");
    temp.innerHTML = html || "";
    temp.querySelectorAll("script, meta, link[rel='stylesheet']").forEach((el) => el.remove());
    temp.querySelectorAll("img").forEach((img) => {
      const src = (img.getAttribute("src") || "").toLowerCase();
      const w = parseInt(img.getAttribute("width") || "999", 10);
      const h = parseInt(img.getAttribute("height") || "999", 10);
      if (w <= 2 || h <= 2 || src.includes("spacer") || src.includes("pixel") || src.includes("track")) {
        img.remove();
      }
    });
    return temp.innerHTML;
  }

  const SHADOW_EMBED_STYLE = `
    :host { display: inline-block; max-width: 100%; pointer-events: auto; }
    .rv-embed-inner {
      background: #111;
      color: #ddd;
      padding: 10px 14px;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 14px;
      line-height: 1.5;
      overflow-x: auto;
      word-break: break-word;
      pointer-events: auto;
    }
    .rv-embed-inner a { color: #00a8fc; pointer-events: auto; }
    .rv-embed-inner img {
      max-width: 100%;
      height: auto;
      border-radius: 4px;
    }
    .rv-embed-inner table {
      border-collapse: collapse;
      max-width: 100%;
    }
    .rv-embed-inner blockquote,
    .rv-embed-inner .gmail_quote {
      border-left: 3px solid #4e5058;
      padding-left: 12px;
      margin: 8px 0;
      color: #999;
    }
  `;

  function renderThread(root) {
    const wrap = root.querySelector(".rv-thread-wrap");
    if (!(wrap instanceof HTMLElement)) return;
    const placeholder = root.querySelector(".rv-chat-placeholder");
    if (placeholder instanceof HTMLElement) placeholder.classList.add("is-hidden");
    wrap.style.display = "";

    if (state.contactChatLoading) {
      wrap.innerHTML = `
        <section class="rv-thread rv-thread-chat" data-reskin="true">
          <div class="rv-thread-chat-header" data-reskin="true">
            <button type="button" class="rv-back" data-reskin="true">\u2190 Back</button>
            <h2 class="rv-thread-subject" data-reskin="true">${escapeHtml(state.contactDisplayName || "Chat")}</h2>
          </div>
          <div class="rv-thread-messages" data-reskin="true" style="display:flex;align-items:center;justify-content:center;padding:40px;">
            <p class="rv-thread-empty" data-reskin="true" style="color:#949ba4;">Loading conversation…</p>
          </div>
        </section>
      `;
      return;
    }

    let thread;
    let messages;
    if (Array.isArray(state.mergedMessages) && state.mergedMessages.length > 0) {
      thread = { subject: `Chat with ${state.contactDisplayName || "contact"}` };
      messages = state.mergedMessages;
    } else {
      thread = extractOpenThreadData();
      messages = Array.isArray(thread.messages) ? thread.messages : [];
      messages.sort((a, b) => {
        const da = (a.date || "").trim().toLowerCase();
        const db = (b.date || "").trim().toLowerCase();
        return da.localeCompare(db);
      });
      const bodyMissing = messages.length === 1 && (messages[0].bodyText || "").trim() === "Message body not captured yet.";
      if (bodyMissing && state.threadExtractRetry < 3) {
        state.threadExtractRetry += 1;
        setTimeout(() => {
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
            renderThread(latestRoot);
          }
        }, 1100);
      } else if (!bodyMissing) {
        state.threadExtractRetry = 0;
      }
    }
    const headerTitle =
      (Array.isArray(messages) && messages.length > 0 && senderDisplayName(messages[0].sender))
        ? `Chat with ${senderDisplayName(messages[0].sender)}`
        : (thread.subject || "Chat");
    const placeholderBody = "Message body not captured yet.";
    if (messages.length === 1 && (messages[0].bodyText || "").trim() === placeholderBody && state.activeThreadId && state.snippetByThreadId && state.snippetByThreadId[state.activeThreadId]) {
      const snippet = normalize(state.snippetByThreadId[state.activeThreadId]);
      if (snippet) {
        messages[0].bodyText = snippet;
        messages[0].bodyHtml = "";
      }
    }
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] renderThread: displaying ${messages.length} message(s) in thread view`);
    }

    const senderName = (raw) => {
      const s = (raw || "").trim();
      const m = s.match(/^(.+?)\s*<[^>]+>$/);
      return m ? m[1].trim() : s;
    };

    const messageRows = messages.map((msg, idx) => {
      const initial = initialForSender(msg.sender);
      const name = senderName(msg.sender);
      const separator = idx > 0 ? '<div class="rv-thread-msg-sep" data-reskin="true"></div>' : "";
      const useEmbed = msg.bodyHtml && (msg.bodyText || "").trim() !== placeholderBody;
      const bodySlot = useEmbed
        ? `<div class="rv-thread-msg-embed" data-reskin="true" data-msg-idx="${idx}"></div>`
        : `<div class="rv-thread-msg-body rv-thread-msg-plain" data-reskin="true">${escapeHtml(msg.bodyText || "")}</div>`;
      return `${separator}
        <div class="rv-thread-msg" data-reskin="true">
          <div class="rv-thread-msg-avatar" data-reskin="true" title="${escapeHtml(msg.sender)}">${escapeHtml(initial)}</div>
          <div class="rv-thread-msg-content" data-reskin="true">
            <div class="rv-thread-msg-head" data-reskin="true">
              <span class="rv-thread-msg-sender" data-reskin="true">${escapeHtml(name)}</span>
              <span class="rv-thread-msg-date" data-reskin="true">${escapeHtml(msg.date)}</span>
            </div>
            ${bodySlot}
          </div>
        </div>
      `;
    }).join("");

    wrap.innerHTML = `
      <section class="rv-thread rv-thread-chat" data-reskin="true">
        <div class="rv-thread-chat-header" data-reskin="true">
          <button type="button" class="rv-back" data-reskin="true">\u2190 Back</button>
          <h2 class="rv-thread-subject" data-reskin="true">${escapeHtml(headerTitle)}</h2>
        </div>
        <div class="rv-thread-messages" data-reskin="true">
          ${messageRows || '<div class="rv-thread-empty" data-reskin="true">No messages in this thread.</div>'}
        </div>
        <div class="rv-thread-input-bar" data-reskin="true">
          <input type="text" class="rv-thread-input" placeholder="Type a message..." data-reskin="true" />
          <button type="button" class="rv-thread-send" data-reskin="true">Send</button>
        </div>
      </section>
    `;

    const embeds = wrap.querySelectorAll(".rv-thread-msg-embed");
    embeds.forEach((el) => {
      const idx = parseInt(el.getAttribute("data-msg-idx") || "0", 10);
      const msg = messages[idx];
      if (!msg || !msg.bodyHtml) return;
      const shadow = el.attachShadow({ mode: "open" });
      const sanitized = sanitizeForShadow(msg.bodyHtml);
      shadow.innerHTML = `<style>${SHADOW_EMBED_STYLE}</style><div class="rv-embed-inner">${sanitized}</div>`;
    });

    const threadInput = wrap.querySelector(".rv-thread-input");
    if (threadInput instanceof HTMLInputElement) {
      threadInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const sendBtn = wrap.querySelector(".rv-thread-send");
          if (sendBtn instanceof HTMLElement) sendBtn.click();
        }
      });
    }

    const msgContainer = wrap.querySelector(".rv-thread-messages");
    if (msgContainer instanceof HTMLElement) {
      requestAnimationFrame(() => {
        msgContainer.scrollTop = msgContainer.scrollHeight;
      });
    }
  }

  async function runTriageForInbox(options = {}) {
    await loadPersistedTriageMap();
    const force = Boolean(options.force);
    const processAll = Boolean(options.processAll);
    const oneByOneMode = Boolean(options.oneByOne);
    const source = normalize(options.source || "unknown");
    if (source === "auto" && Date.now() < state.triageAutoPauseUntil) {
      logTriageDebug("Skipped auto triage due to cooldown", {
        cooldownMsRemaining: Math.max(0, state.triageAutoPauseUntil - Date.now())
      });
      return;
    }
    if (source === "auto" && processAll && Date.now() - Number(state.lastAutoTriageAt || 0) < 25000) {
      return;
    }
    if (state.currentView !== "list") {
      logTriageDebug("Skipped triage run because current view is not list", {
        currentView: state.currentView
      });
      return;
    }
    if (activeMailbox() !== "inbox") {
      logTriageDebug("Skipped triage run because mailbox is not inbox", {
        mailbox: activeMailbox()
      });
      return;
    }
    if (!window.ReskinAI || !window.ReskinTriage) {
      logTriageDebug("Skipped triage run because AI or triage module is missing", {
        hasAI: Boolean(window.ReskinAI),
        hasTriage: Boolean(window.ReskinTriage)
      });
      return;
    }
    if (state.triageRunning) {
      logTriageDebug("Skipped triage run because another run is already in progress");
      return;
    }

    const settings = await loadSettingsCached();
    if (!settings || !settings.enabled || !settings.consentTriage) {
      state.triageStatus = "Enable triage + consent in Settings";
      logTriageDebug("Skipped triage run because settings are disabled or consent missing", {
        hasSettings: Boolean(settings),
        enabled: Boolean(settings && settings.enabled),
        consentTriage: Boolean(settings && settings.consentTriage)
      });
      return;
    }
    logTriageDebug("Starting inbox triage run", {
      source,
      force,
      processAll,
      oneByOneMode,
      batchSize: settings.batchSize,
      provider: settings.provider,
      model: settings.model
    });

    const listRoot = document.getElementById(ROOT_ID);
    if (!(listRoot instanceof HTMLElement)) return;

    if (processAll && !state.fullScanCompletedByMailbox[mailboxCacheKey("inbox")] && !state.fullScanRunning) {
      state.triageStatus = "Scanning full inbox before triage...";
      renderSidebar(listRoot);
      await runFullMailboxScan(listRoot);
    }

    const attempted = new Set();
    let totalApplied = 0;
    let totalScored = 0;
    let batchIndex = 0;
    let haltedOnEmptyAI = false;
    let haltedOnDuplicateQueue = false;
    let consecutiveApplyFailures = 0;
    const maxBatches = processAll ? 1200 : 1;
    state.triageRunning = true;
    if (source === "auto" && processAll) {
      state.lastAutoTriageAt = Date.now();
    }

    try {
      while (batchIndex < maxBatches) {
        const sourceItems = processAll
          ? getMailboxMessages("inbox", 6000)
          : getMailboxMessages("inbox", 200);
        const result = {
          items: sourceItems,
          source: processAll ? "cache" : "live"
        };
        logTriageDebug("Collected messages for triage pass", {
          extracted: result.items.length,
          source: result.source || "unknown"
        });
        const candidates = [];
        for (const msg of result.items) {
          const level = getTriageLevelForMessage(msg);
          msg.triageLevel = level;
          if (!level && !attempted.has(msg.threadId)) candidates.push(msg);
        }

        state.triageUntriagedCount = candidates.length;
        if (candidates.length === 0) {
          logTriageDebug("No untriaged inbox candidates found", {
            scanned: result.items.length
          });
          break;
        }

        const batchSize = oneByOneMode ? 1 : settings.batchSize;
        const batch = candidates.slice(0, batchSize);
        const queueKey = batch.map((m) => m.threadId).join(",");
        if (!force && !processAll && queueKey && queueKey === state.triageQueueKey) {
          logTriageDebug("Skipping duplicate triage queue", { queueKey });
          haltedOnDuplicateQueue = true;
          break;
        }
        state.triageQueueKey = queueKey;
        logTriageDebug("Prepared triage batch", {
          batchIndex: batchIndex + 1,
          batchSize: batch.length,
          candidatesRemaining: candidates.length,
          threadIds: batch.map((msg) => msg.threadId)
        });

        state.triageStatus = processAll
          ? `Triaging batch ${batchIndex + 1}: ${batch.length} of ${candidates.length} remaining...`
          : `Triaging ${batch.length} of ${candidates.length}...`;
        if (oneByOneMode) {
          const current = batch[0];
          state.triageStatus = processAll
            ? `Triaging 1-by-1 (${batchIndex + 1}): ${current ? current.subject || current.threadId : "message"}`
            : `Triaging 1 message...`;
        }

        let scored = [];
        try {
          scored = await window.ReskinAI.triageBatch(batch, settings);
        } catch (error) {
          const msg = normalize(error && error.message ? error.message : String(error || ""));
          const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit");
          if (isRateLimit && processAll) {
            const waitMs = Number(error && error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 65000;
            state.triageStatus = `Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s, then continuing...`;
            renderSidebar(listRoot);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            state.triageStatus = "Resuming triage...";
            continue;
          }
          throw error;
        }
        for (const msg of batch) attempted.add(msg.threadId);
        totalScored += batch.length;
        logTriageDebug("AI returned scored items", {
          requested: batch.length,
          returned: Array.isArray(scored) ? scored.length : 0,
          scored
        });
        if (!Array.isArray(scored) || scored.length === 0) {
          state.triageStatus = "AI returned no labels. Please retry or switch provider in Settings.";
          state.triageLastFailureStatus = state.triageStatus;
          state.triageQueueKey = "";
          haltedOnEmptyAI = true;
          logTriageDebug("Stopping triage because AI returned zero parsed labels", {
            requested: batch.length
          });
          break;
        }
        for (const item of scored) {
          if (!item || !item.urgency) continue;
          const mappedByThread = item.threadId
            ? batch.find((msg) => msg.threadId === item.threadId)
            : null;
          const mappedByIndex =
            typeof item.i === "number" && item.i >= 0 && item.i < batch.length ? batch[item.i] : null;
          const targetMessage = mappedByThread || mappedByIndex || null;
          const mappedThreadId = (targetMessage && targetMessage.threadId) || item.threadId || "";
          if (mappedThreadId) {
            triageLocalSet(mappedThreadId, item.urgency);
          }

          const ok = window.ReskinTriage && typeof window.ReskinTriage.applyLabelToMessage === "function"
            ? await window.ReskinTriage.applyLabelToMessage(
              targetMessage || { threadId: item.threadId, href: "", row: null },
              item.urgency
            )
            : await window.ReskinTriage.applyLabelToThread(item.threadId, item.urgency);
          logTriageDebug("Label apply attempt finished", {
            threadId: (targetMessage && targetMessage.threadId) || item.threadId || "",
            urgency: item.urgency,
            byThreadId: Boolean(mappedByThread),
            byIndex: Boolean(mappedByIndex),
            ok
          });
          if (ok) {
            totalApplied += 1;
            consecutiveApplyFailures = 0;
          } else {
            consecutiveApplyFailures += 1;
          }
        }

        if (consecutiveApplyFailures >= 8) {
          if (processAll) {
            state.triageStatus =
              "Gmail label controls were unstable. Retrying with a fresh pass...";
            logTriageDebug("Backing off triage after repeated apply failures", {
              consecutiveApplyFailures
            });
            consecutiveApplyFailures = 0;
            await sleep(1200);
            continue;
          }
          state.triageStatus =
            "Gmail label UI could not be controlled. Stopped after repeated failures.";
          state.triageLastFailureStatus = state.triageStatus;
          logTriageDebug("Halting triage after repeated apply failures", {
            consecutiveApplyFailures
          });
          break;
        }

        batchIndex += 1;
        if (!processAll) break;
      }
      if (haltedOnEmptyAI) {
        // Preserve the explicit user-facing AI failure status set above.
      } else if (haltedOnDuplicateQueue) {
        state.triageStatus = state.triageLastFailureStatus || "Triage waiting for new inbox changes.";
      } else if (batchIndex === 0) {
        state.triageStatus = "Inbox triage is up to date";
      } else if (totalScored > 0 && totalApplied === 0) {
        state.triageStatus = `AI triaged ${totalScored} messages locally. Gmail label sync failed.`;
      } else if (processAll) {
        state.triageStatus = `Triage complete: ${totalApplied} labels applied across ${batchIndex} batches`;
      } else {
        state.triageStatus = `Applied ${totalApplied} triage labels`;
      }
      logTriageDebug("Triage run finished", {
        batchIndex,
        totalScored,
        totalApplied,
        status: state.triageStatus
      });
    } catch (error) {
      const message = error && error.message ? error.message : "triage failed";
      state.triageStatus = `Triage unavailable: ${message.slice(0, 120)}`;
      state.triageLastFailureStatus = state.triageStatus;
      state.triageQueueKey = "";
      state.triageAutoPauseUntil = Date.now() + 45000;
      logWarn("Inbox triage run failed", error);
      logTriageDebug("Triage run failed", {
        message,
        stack: error && error.stack ? String(error.stack) : ""
      });
    } finally {
      state.triageRunning = false;
      const root = document.getElementById(ROOT_ID);
      if (root instanceof HTMLElement && state.currentView === "list") {
        renderCurrentView(root);
      }
    }
  }

  function renderCurrentView(root) {
    // Route hash is the source of truth for Settings, so stale state cannot pin us back to list view.
    if (isAppSettingsHash()) {
      state.settingsPinned = true;
      state.currentView = "settings";
    }

    renderSidebar(root);
    renderRightRail(root);
    const placeholder = root.querySelector(".rv-chat-placeholder");
    const threadWrap = root.querySelector(".rv-thread-wrap");
    const settingsWrap = root.querySelector(".rv-settings-wrap");
    if (placeholder) placeholder.classList.toggle("is-hidden", state.currentView !== "list");
    if (threadWrap) threadWrap.style.display = state.currentView === "thread" ? "" : "none";
    if (settingsWrap) settingsWrap.style.display = state.currentView === "settings" ? "" : "none";
    if (state.currentView === "settings") {
      renderSettings(root);
      return;
    }
    /* Always update the list column (left) so it shows current messages even when a thread is open. */
    renderList(root);
    if (state.currentView === "thread") {
      renderThread(root);
      return;
    }
  }

  function renderSettings(root) {
    const wrap = root.querySelector(".rv-settings-wrap");
    if (!(wrap instanceof HTMLElement)) return;

    const settings = state.settingsCache || {
      provider: "openrouter",
      apiKey: "",
      apiKeys: [],
      theme: THEME_DARK,
      model: "openrouter/free",
      enabled: true,
      consentTriage: false,
      batchSize: 25,
      timeoutMs: 30000,
      retryCount: 2,
      retryBackoffMs: 1200,
      maxInputChars: 2200
    };

    if (!state.settingsCache && !state.settingsLoadFailed && !state.settingsLoadInFlight) {
      loadSettingsCached().then(() => {
        if (state.currentView !== "settings") return;
        const latestRoot = document.getElementById(ROOT_ID);
        if (!(latestRoot instanceof HTMLElement)) return;
        const latestWrap = latestRoot.querySelector(".rv-settings-wrap");
        if (!(latestWrap instanceof HTMLElement)) return;
        renderSettings(latestRoot);
      });
    }

    const apiKey = normalize(settings.apiKey || "");
    const selectedProvider = normalize(settings.provider || "openrouter").toLowerCase();
    const currentTheme = normalizeTheme(settings.theme);
    const needsApiKey = providerNeedsApiKey(selectedProvider);
    const apiGuide = buildApiKeyGuide(selectedProvider);

    wrap.innerHTML = `
      <section class="rv-settings-view" data-reskin="true">
        <h2 class="rv-settings-title" data-reskin="true">Mailita Settings</h2>
        <p class="rv-settings-copy" data-reskin="true">Inbox-only triage with autosave. Already-labeled emails are never re-triaged.</p>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">API</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <label class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">Provider</div>
              <select name="provider" class="rv-field" data-reskin="true">
                <option value="openrouter" ${settings.provider === "openrouter" ? "selected" : ""}>OpenRouter (free)</option>
                <option value="groq" ${settings.provider === "groq" ? "selected" : ""}>Groq (free)</option>
                <option value="ollama" ${settings.provider === "ollama" ? "selected" : ""}>Local Ollama</option>
              </select>
            </label>
            <label class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">API Key</div>
              <input name="apiKey" class="rv-field" data-reskin="true" type="password" value="${escapeHtml(apiKey)}" placeholder="${escapeHtml(apiKeyPlaceholderForProvider(settings.provider || "openrouter"))}" />
            </label>
          </div>
          ${needsApiKey ? `
            <div class="rv-api-permission-inline" data-reskin="true">
              <div class="rv-settings-copy" data-reskin="true">Need help getting a ${escapeHtml(apiGuide.label)} key?</div>
              <button type="button" class="rv-api-key-permission" data-reskin="true">Show Key Setup Help</button>
            </div>
          ` : ""}
          ${needsApiKey && state.apiKeyGuideGranted ? `
            <div class="rv-api-key-guide" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">${escapeHtml(apiGuide.label)} key setup</div>
              <ol class="rv-api-key-guide-steps" data-reskin="true">
                ${apiGuide.steps.map((step) => `<li data-reskin="true">${escapeHtml(step)}</li>`).join("")}
              </ol>
              <a class="rv-api-key-guide-link" data-reskin="true" href="${escapeHtml(apiGuide.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(apiGuide.linkText)}</a>
            </div>
          ` : ""}
        </section>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">Triage</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <label class="rv-settings-card rv-settings-consent" data-reskin="true">
              <input type="checkbox" name="consentTriage" class="rv-field" data-reskin="true" ${settings.consentTriage ? "checked" : ""} />
              <span class="rv-settings-label" data-reskin="true">I consent to AI triage</span>
            </label>
          </div>
          <p class="rv-settings-copy" data-reskin="true">Allow sending inbox content to your chosen AI provider to label categories (Respond, Should read, News, Not important, Spam). Required for triage and Ask Inbox.</p>
        </section>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">Appearance</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <div class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">Theme</div>
              <div class="rv-theme-picker" data-reskin="true">
                <label class="rv-theme-option${currentTheme === THEME_DARK ? " is-active" : ""}" data-reskin="true">
                  <input type="radio" name="theme" value="${THEME_DARK}" ${currentTheme === THEME_DARK ? "checked" : ""} />
                  <span data-reskin="true">Dark</span>
                </label>
                <label class="rv-theme-option${currentTheme === THEME_LIGHT ? " is-active" : ""}" data-reskin="true">
                  <input type="radio" name="theme" value="${THEME_LIGHT}" ${currentTheme === THEME_LIGHT ? "checked" : ""} />
                  <span data-reskin="true">Light</span>
                </label>
              </div>
            </div>
          </div>
          <p class="rv-settings-copy" data-reskin="true">Theme changes apply immediately and autosave.</p>
        </section>

        ${state.showApiKeyPermissionModal ? `
          <div class="rv-modal-backdrop" data-reskin="true">
            <div class="rv-modal" data-reskin="true">
              <h3 class="rv-modal-title" data-reskin="true">Allow API Key Setup Help?</h3>
              <p class="rv-modal-copy" data-reskin="true">If you allow this, we will show quick steps and direct links to create your provider API key.</p>
              <div class="rv-modal-actions" data-reskin="true">
                <button type="button" class="rv-api-permission-allow" data-reskin="true">Allow</button>
                <button type="button" class="rv-api-permission-decline" data-reskin="true">Not now</button>
              </div>
            </div>
          </div>
        ` : ""}
      </section>
    `;
  }

  function renderList(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;

    const route = parseListRoute(window.location.hash || state.lastListHash || "#inbox");
    if (route.mailbox !== "inbox") {
      state.triageFilter = "";
    } else if (hashHasTriageParam(window.location.hash || "")) {
      state.triageFilter = route.triage;
    }

    if (route.mailbox === "inbox" && !state.settingsCache && !state.settingsLoadInFlight && window.ReskinAI) {
      loadSettingsCached().then(() => applyReskin());
    }

    const mailbox = mailboxCacheKey(route.mailbox);
    const result = collectMessages();
    const liveMessages = result.items || [];
    const mergedCache = mergeMailboxCache(mailbox, liveMessages);
    const useCached = Boolean(state.fullScanRunning || state.fullScanCompletedByMailbox[mailbox]);
    const sourcePool = useCached ? mergedCache : liveMessages;
    const allMessages = sourcePool.slice();

    for (const msg of allMessages) {
      msg.triageLevel = getTriageLevelForMessage(msg);
    }

    state.triageCounts = window.ReskinTriage && typeof window.ReskinTriage.countLevels === "function"
      ? window.ReskinTriage.countLevels(allMessages)
      : { respond: 0, read: 0, news: 0, notImportant: 0, spam: 0 };

    let messages = allMessages;
    if (state.currentServerId && route.mailbox === "inbox") {
      const server = state.servers.find((s) => s.id === state.currentServerId);
      if (server) messages = messages.filter((msg) => threadIdInServer(msg.threadId, server));
    }
    const filterLevel = route.mailbox === "inbox"
      ? normalize(state.triageFilter || route.triage || "").toLowerCase()
      : "";
    if (route.mailbox === "inbox" && TRIAGE_LEVELS.includes(filterLevel)) {
      messages = messages.filter((msg) => msg.triageLevel === filterLevel);
    }
    const q = normalize(state.searchQuery || "").toLowerCase();
    if (q) {
      messages = messages.filter((msg) => {
        const s = normalize(msg.sender || "").toLowerCase();
        const subj = normalize(msg.subject || "").toLowerCase();
        const snip = normalize(msg.snippet || "").toLowerCase();
        return s.includes(q) || subj.includes(q) || snip.includes(q);
      });
    }

    const visibleLimit = Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize);
    const visibleMessages = messages.slice(0, Math.max(state.listChunkSize, visibleLimit));

    const listSignature = `${route.hash}|${visibleMessages.length}|${visibleMessages.map((m) => `${m.threadId}:${m.triageLevel || "u"}`).join(",")}`;
    if (state.lastListSignature === listSignature && !interactionsLocked() && visibleMessages.length > 0) return;
    state.lastListSignature = listSignature;
    state.snippetByThreadId = state.snippetByThreadId || {};
    for (const m of visibleMessages) {
      if (m.threadId) state.snippetByThreadId[m.threadId] = m.snippet || "";
    }

    list.innerHTML = "";

    const showConsentBanner = route.mailbox === "inbox" && state.settingsCache && !state.settingsCache.consentTriage && !state.consentBannerDismissed;
    if (showConsentBanner) {
      const banner = document.createElement("div");
      banner.className = "rv-consent-banner";
      banner.setAttribute("data-reskin", "true");
      banner.innerHTML = `
        <div class="rv-consent-banner-inner" data-reskin="true">
          <p class="rv-consent-banner-title" data-reskin="true">AI triage is off</p>
          <p class="rv-consent-banner-copy" data-reskin="true">Triage and Ask Inbox need your consent to send inbox content to your chosen AI provider. Enable it in Settings to run priority labels and Q&amp;A.</p>
          <div class="rv-consent-banner-actions" data-reskin="true">
            <button type="button" class="rv-consent-banner-open-settings" data-reskin="true">Open Settings</button>
            <button type="button" class="rv-consent-banner-dismiss" data-reskin="true">Dismiss</button>
          </div>
        </div>
      `;
      list.appendChild(banner);
      const openBtn = banner.querySelector(".rv-consent-banner-open-settings");
      const dismissBtn = banner.querySelector(".rv-consent-banner-dismiss");
      if (openBtn) {
        openBtn.addEventListener("click", () => {
          state.settingsPinned = true;
          state.currentView = "settings";
          window.location.hash = "#app-settings";
          applyReskin();
        });
      }
      if (dismissBtn) {
        dismissBtn.addEventListener("click", () => {
          state.consentBannerDismissed = true;
          applyReskin();
        });
      }
    }

    if (state.lastSource !== result.source) {
      state.lastSource = result.source;
      logInfo(`Extractor source: ${result.source}`);
    }

    if (state.lastRenderedCount !== visibleMessages.length) {
      state.lastRenderedCount = visibleMessages.length;
      logInfo(`Rendered ${visibleMessages.length} messages`);
    }

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rv-empty";
      empty.setAttribute("data-reskin", "true");
      empty.textContent = TRIAGE_LEVELS.includes(filterLevel)
        ? `No ${triageLabelText(filterLevel)} inbox messages captured yet.`
        : "No messages captured yet.";
      list.appendChild(empty);
      if (route.mailbox === "inbox" && !state.fullScanRunning && !state.fullScanCompletedByMailbox[mailbox]) {
        state.fullScanStatus = "Loading inbox…";
        renderSidebar(root);
        setTimeout(() => runFullMailboxScan(root), 400);
      }
      if (route.mailbox === "inbox" && state.currentView === "list" && !state.inboxHashNudged) {
        const hash = (window.location.hash || "").trim() || "#inbox";
        if (hash !== "#inbox" && hash.startsWith("#inbox")) {
          state.inboxHashNudged = true;
          state.lastListHash = "#inbox";
          window.location.hash = "#inbox";
          setTimeout(() => applyReskin(), 600);
        }
      }
      if (route.mailbox === "inbox" && !state.inboxEmptyRetryScheduled) {
        state.inboxEmptyRetryScheduled = true;
        setTimeout(() => {
          state.lastListSignature = "";
          applyReskin();
        }, 900);
      }
    } else {
      const groups = groupMessagesByContact(visibleMessages);
      const useGroups = groups.length > 0;
      const displayItems = useGroups ? groups.map((g) => ({ type: "contact", group: g })) : visibleMessages.map((msg) => ({ type: "single", msg }));

      for (const entry of displayItems) {
        if (entry.type === "contact") {
          const g = entry.group;
          const latest = g.latestItem;
          if (!latest) continue;
          const item = document.createElement("button");
          item.type = "button";
          const anyUnread = g.items.some((m) => m.unread);
          const isActive = g.threadIds.includes(state.activeThreadId);
          item.className = "rv-item" + (anyUnread ? " is-unread" : "") + (isActive ? " is-active" : "");
          item.setAttribute("data-reskin", "true");
          const level = latest.triageLevel || (g.items.some((m) => m.triageLevel === "respond") ? "respond" : "");
          const badgeClass = level ? `is-${level}` : "is-untriaged";
          const badgeText = level ? triageLabelText(level) : "Untriaged";
          const summaryText = getSummaryForMessage(latest);
          const previewText = normalize(latest.snippet || "") || "No preview";
          const hasSummary = Boolean(summaryText);
          const displayName = g.contactName + (g.threadIds.length > 1 ? ` (${g.threadIds.length})` : "");
          const initial = initialForSender(latest.sender);
          const previewLine = hasSummary ? summaryText : previewText;

          item.innerHTML = `
            <div class="rv-item-avatar" data-reskin="true" title="${escapeHtml(g.contactName)}">${escapeHtml(initial)}</div>
            <div class="rv-item-content" data-reskin="true">
              <div class="rv-item-top" data-reskin="true">
                <span class="rv-item-name" data-reskin="true">${escapeHtml(displayName)}</span>
                <span class="rv-item-meta" data-reskin="true">
                  <span class="rv-date" data-reskin="true">${escapeHtml(latest.date || "")}</span>
                  <button type="button" class="rv-item-server-btn" aria-label="Add or remove from server" data-reskin="true" data-thread-id="${escapeHtml(latest.threadId || "")}">⋯</button>
                </span>
              </div>
              <div class="rv-item-preview" data-reskin="true">${escapeHtml(previewLine.slice(0, 120))}${previewLine.length > 120 ? "…" : ""}</div>
              <div class="rv-triage-row" data-reskin="true">
                <span class="rv-badge ${badgeClass}" data-reskin="true">${escapeHtml(badgeText)}</span>
              </div>
            </div>
          `;

          item.setAttribute("data-contact-key", g.contactKey || "");
          item.addEventListener("click", (e) => {
            if (e.target.closest(".rv-item-server-btn")) return;
            lockInteractions(900);
            state.lockListView = false;
            loadContactChat(g, root);
          });
          list.appendChild(item);
        } else {
          const msg = entry.msg;
          const item = document.createElement("button");
          item.type = "button";
          item.className = "rv-item" + (msg.unread ? " is-unread" : "") + (state.activeThreadId === msg.threadId ? " is-active" : "");
          item.setAttribute("data-reskin", "true");
          if (msg.unread) item.setAttribute("title", "Unread");

          const level = msg.triageLevel;
          const badgeClass = level ? `is-${level}` : "is-untriaged";
          const badgeText = level ? triageLabelText(level) : "Untriaged";
          const summaryText = getSummaryForMessage(msg);
          const previewText = normalize(msg.snippet || "") || "No preview";
          const hasSummary = Boolean(summaryText);
          const displayName = senderDisplayName(msg.sender) || normalize(msg.subject || "") || "No subject";
          const initial = initialForSender(msg.sender);
          const previewLine = hasSummary ? summaryText : previewText;

          item.innerHTML = `
            <div class="rv-item-avatar" data-reskin="true" title="${escapeHtml(msg.sender)}">${escapeHtml(initial)}</div>
            <div class="rv-item-content" data-reskin="true">
              <div class="rv-item-top" data-reskin="true">
                <span class="rv-item-name" data-reskin="true">${escapeHtml(displayName)}</span>
                <span class="rv-item-meta" data-reskin="true">
                  <span class="rv-date" data-reskin="true">${escapeHtml(msg.date || "")}</span>
                  <button type="button" class="rv-item-server-btn" aria-label="Add or remove from server" data-reskin="true" data-thread-id="${escapeHtml(msg.threadId || "")}">⋯</button>
                </span>
              </div>
              <div class="rv-item-preview" data-reskin="true">${escapeHtml(previewLine.slice(0, 120))}${previewLine.length > 120 ? "…" : ""}</div>
              <div class="rv-triage-row" data-reskin="true">
                <span class="rv-badge ${badgeClass}" data-reskin="true">${escapeHtml(badgeText)}</span>
              </div>
            </div>
          `;

          item.addEventListener("click", (e) => {
            if (e.target.closest(".rv-item-server-btn")) return;
            lockInteractions(900);
            state.lockListView = false;
            state.currentView = "thread";
            state.activeThreadId = msg.threadId;
            const threadHash = msg.href && msg.href.includes("#")
              ? msg.href.slice(msg.href.indexOf("#"))
              : (msg.threadId ? `#inbox/${msg.threadId}` : "");
            if (threadHash && isThreadHash(threadHash)) {
              state.lastListHash = "#inbox";
              window.location.hash = threadHash;
            } else if (msg.threadId) {
              state.lastListHash = "#inbox";
              window.location.hash = `#inbox/${msg.threadId}`;
            }
            renderList(root);
            renderCurrentView(root);
            const ok = openThread(msg.threadId, msg.href, msg.row);
            if (!ok) {
              logWarn("Failed to open thread from custom view.", { threadId: msg.threadId });
              state.currentView = "list";
              state.activeThreadId = "";
              renderList(root);
              renderCurrentView(root);
              return;
            }
            setTimeout(() => {
              const latestRoot = document.getElementById(ROOT_ID);
              if (!(latestRoot instanceof HTMLElement)) return;
              if (state.currentView !== "thread") return;
              renderThread(latestRoot);
            }, 800);
          });

          list.appendChild(item);
        }
      }

      queueSummariesForMessages(visibleMessages.slice(0, 30));

      if (visibleMessages.length < messages.length) {
        const loadMore = document.createElement("button");
        loadMore.type = "button";
        loadMore.className = "rv-list-more";
        loadMore.setAttribute("data-reskin", "true");
        loadMore.textContent = `Load more (${visibleMessages.length}/${messages.length})`;
        list.appendChild(loadMore);
      }
    }

    if (route.mailbox === "inbox") {
      list.onscroll = () => {
        if (state.currentView !== "list") return;
        const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_LOAD_MORE_DISTANCE_PX;
        const nearEndPrefetch =
          list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_PREFETCH_DISTANCE_PX;
        if (!nearBottom && !nearEndPrefetch) return;
        const current = Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize);
        if (nearBottom && current < messages.length) {
          state.listVisibleByMailbox[mailbox] = current + state.listChunkSize;
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement) renderList(latestRoot);
          return;
        }
        if (nearEndPrefetch && !state.fullScanCompletedByMailbox[mailbox] && !state.fullScanRunning) {
          runFullMailboxScan(root);
        }
      };
      if (!state.fullScanCompletedByMailbox[mailbox] && !state.fullScanRunning) {
        setTimeout(() => runFullMailboxScan(root), 220);
      }
      setTimeout(() => {
        runTriageForInbox({ force: false, processAll: true, source: "auto" });
      }, 120);
    } else {
      list.onscroll = null;
    }

    renderSidebar(root);
  }

  function applyReskin() {
    if (state.isApplying) return;
    state.isApplying = true;
    try {
      ensureStylesheet();
      const root = ensureRoot();
      if (!root) return;
      applyTheme(root);
      syncViewFromHash();
      renderCurrentView(root);
      ensureMode();
    } finally {
      state.isApplying = false;
    }
  }

  function observerDomSignature() {
    const hash = normalize(window.location.hash || "");
    const main = getGmailMainRoot();
    if (!(main instanceof HTMLElement)) return `${hash}|0|${state.currentView}`;
    const firstRow =
      main.querySelector('[data-thread-id], [data-legacy-thread-id], tr[role="row"], [role="option"]') || null;
    const firstRowId = firstRow instanceof HTMLElement
      ? normalize(
        firstRow.getAttribute("data-thread-id") ||
        firstRow.getAttribute("data-legacy-thread-id") ||
        firstRow.getAttribute("data-article-id") ||
        firstRow.getAttribute("aria-rowindex") ||
        firstRow.id ||
        firstRow.textContent
      ).slice(0, 80)
      : "";
    const busy = normalize(main.getAttribute("aria-busy") || "");
    return `${hash}|${state.currentView}|${busy}|${firstRowId}`;
  }

  function renderFromObserver() {
    if (document.hidden) return;
    if (state.currentView === "settings" && state.settingsPinned && isAppSettingsHash()) return;

    const root = document.getElementById(ROOT_ID);
    if (!(root instanceof HTMLElement)) return;

    const signature = observerDomSignature();
    if (signature === state.lastObserverSignature) return;
    state.lastObserverSignature = signature;
    state.lastObserverRenderAt = Date.now();
    renderCurrentView(root);
  }

  function startObserver() {
    if (state.pollTimer || !document.body) return;
    state.lastSeenHash = normalize(window.location.hash || "");

    state.pollTimer = window.setInterval(() => {
      if (document.hidden) return;
      if (interactionsLocked()) return;
      if (state.isApplying) return;

      const hasStyle = Boolean(document.getElementById(STYLE_ID));
      const hasRoot = Boolean(document.getElementById(ROOT_ID));
      if (!hasStyle || !hasRoot) {
        applyReskin();
        return;
      }

      const currentHash = normalize(window.location.hash || "");
      if (isAppSettingsHash()) {
        if (!state.settingsPinned || state.currentView !== "settings") {
          state.settingsPinned = true;
          state.currentView = "settings";
          state.lastObserverSignature = "";
          const root = document.getElementById(ROOT_ID);
          if (root instanceof HTMLElement) {
            renderCurrentView(root);
          }
        }
        state.lastSeenHash = currentHash;
        return;
      }

      if (currentHash !== state.lastSeenHash) {
        state.lastSeenHash = currentHash;
        syncViewFromHash();
        state.lastObserverSignature = "";
        const root = document.getElementById(ROOT_ID);
        if (root instanceof HTMLElement) {
          renderCurrentView(root);
        }
        return;
      }

      const canAutoKickTriage =
        state.currentView === "list" &&
        activeMailbox() === "inbox" &&
        !state.triageRunning &&
        !state.fullScanRunning;
      if (canAutoKickTriage && Date.now() - Number(state.lastAutoTriageKickAt || 0) > 15000) {
        state.lastAutoTriageKickAt = Date.now();
        runTriageForInbox({ force: false, processAll: true, source: "auto" });
      }

      const elapsed = Date.now() - state.lastObserverRenderAt;
      const listIsEmpty = state.currentView === "list" && state.lastListSignature && state.lastListSignature.indexOf("|0|") !== -1;
      const renderGap = listIsEmpty ? 1500 : Math.max(OBSERVER_MIN_RENDER_GAP_MS, LIST_REFRESH_INTERVAL_MS);
      if (elapsed >= renderGap) {
        if (listIsEmpty) state.lastObserverSignature = "";
        renderFromObserver();
      }
    }, UI_POLL_INTERVAL_MS);
  }

  function waitForReady() {
    removeLegacyNodes();

    window.addEventListener("hashchange", () => {
      syncViewFromHash();
      state.lastObserverSignature = "";
      const root = document.getElementById(ROOT_ID);
      if (root instanceof HTMLElement) renderCurrentView(root);
    });

    logInfo("Waiting for Gmail landmarks...");
    const poll = setInterval(() => {
      const ready = selectFirst(GMAIL_READY_SELECTORS);
      if (!ready) return;
      clearInterval(poll);
      logInfo("Gmail ready. Applying viewer.");
      loadPersistedTriageMap()
        .catch((error) => logWarn("Local triage map bootstrap failed", error))
        .finally(() => {
          loadPersistedSummaries().catch((error) => logWarn("Row summary cache bootstrap failed", error));
          applyReskin();
          startObserver();
        });
    }, 200);
  }

  waitForReady();
})();
