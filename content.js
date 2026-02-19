(() => {
  "use strict";

  const STYLE_ID = "reskin-stylesheet";
  const ROOT_ID = "reskin-root";
  const MODE_ATTR = "data-reskin-mode";
  const MODE_VALUE = "viewer";
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

  const TRIAGE_LEVELS = ["critical", "high", "medium", "low", "fyi"];

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
    triageCounts: { critical: 0, high: 0, medium: 0, low: 0, fyi: 0 },
    triageStatus: "",
    triageRunning: false,
    triageQueueKey: "",
    triageUntriagedCount: 0,
    triageLocalMap: {},
    settingsCache: null,
    settingsLoadInFlight: false,
    settingsLoadFailed: false,
    settingsPinned: false,
    lastObserverRenderAt: 0,
    pendingObserverTimer: null,
    lastObserverSignature: "",
    lastSeenHash: ""
  };

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

  function activeMailbox() {
    return parseListRoute(state.currentView === "thread" ? state.lastListHash : window.location.hash).mailbox;
  }

  function activeTriageFilter() {
    return parseListRoute(state.currentView === "thread" ? state.lastListHash : window.location.hash).triage;
  }

  function getActiveNavHash() {
    return `#${activeMailbox()}`;
  }

  function isThreadHash() {
    const hash = normalize(window.location.hash || "");
    if (!hash) return false;
    return /#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/[A-Za-z0-9_-]{6,}/i.test(
      hash
    );
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

  function navigateToList(targetHash, nativeLabel = "") {
    const nextHash = sanitizeListHash(targetHash);
    window.location.hash = nextHash;
    if (nativeLabel) clickNativeMailboxLink(nativeLabel);
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

  function getTriageLevelForMessage(msg) {
    if (!msg || !msg.threadId) return "";
    const local = state.triageLocalMap[msg.threadId];
    if (local && TRIAGE_LEVELS.includes(local)) return local;

    const fromRow = window.ReskinTriage && typeof window.ReskinTriage.detectLevelFromRow === "function"
      ? window.ReskinTriage.detectLevelFromRow(msg.row)
      : "";
    if (fromRow) {
      state.triageLocalMap[msg.threadId] = fromRow;
      return fromRow;
    }
    return "";
  }

  function renderSidebar(root) {
    const nav = root.querySelector(".rv-nav");
    if (!(nav instanceof HTMLElement)) return;

    const activeHash = getActiveNavHash();
    nav.innerHTML = NAV_ITEMS.map((item) => {
      const isActive = item.hash === activeHash;
      return `<button type="button" class="rv-nav-item${isActive ? " is-active" : ""}" data-target-hash="${item.hash}" data-native-label="${escapeHtml(item.nativeLabel)}" data-reskin="true">${item.label}</button>`;
    }).join("");

    const settings = root.querySelector(".rv-settings");
    if (settings instanceof HTMLElement) {
      settings.classList.toggle("is-active", state.currentView === "settings");
    }
  }

  function renderRightRail(root) {
    const rail = root.querySelector(".rv-right");
    if (!(rail instanceof HTMLElement)) return;

    const isInbox = activeMailbox() === "inbox";
    const currentFilter = activeTriageFilter();
    const rows = TRIAGE_LEVELS.map((level) => {
      const count = state.triageCounts[level] || 0;
      const active = currentFilter === level;
      return `<button type="button" class="rv-triage-item${active ? " is-active" : ""}" data-triage-level="${level}" data-reskin="true"><span data-reskin="true">${triageLabelText(level)}</span><span class="rv-triage-count" data-reskin="true">${count}</span></button>`;
    }).join("");
    const startDisabled = !isInbox || state.triageRunning;
    const startLabel = state.triageRunning ? "Running..." : "Start";

    rail.innerHTML = `
      <section class="rv-ai-panel" data-reskin="true">
        <div class="rv-ai-head" data-reskin="true">AI Copilot</div>
        <div class="rv-ai-copy" data-reskin="true">Inbox-only triage is active. Existing labels are never re-triaged.</div>
      </section>
      <section class="rv-triage rv-triage-right" data-reskin="true">
        <div class="rv-triage-head" data-reskin="true">
          <span data-reskin="true">Triage</span>
          <button type="button" class="rv-triage-start" data-reskin="true" ${startDisabled ? "disabled" : ""}>${startLabel}</button>
        </div>
        <div class="rv-triage-list${isInbox ? "" : " is-off-inbox"}" data-reskin="true">${rows}</div>
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.triageStatus || (state.triageRunning ? "Triage running..." : "Press Start to organize untriaged inbox messages"))}</div>
      </section>
    `;
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

    state.currentView = threadHash ? "thread" : "list";
    if (state.currentView === "list") {
      state.lastListHash = sanitizeListHash(window.location.hash || "#inbox");
      state.triageFilter = activeTriageFilter();
    }
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
        <aside class="rv-sidebar" data-reskin="true">
          <div class="rv-brand" data-reskin="true">Mail Viewer</div>
          <div class="rv-nav-wrap" data-reskin="true">
            <nav class="rv-nav" data-reskin="true"></nav>
          </div>
          <button type="button" class="rv-settings" data-reskin="true">Settings</button>
        </aside>
        <main class="rv-main" data-reskin="true">
          <div class="rv-list" data-reskin="true"></div>
        </main>
        <aside class="rv-right" data-reskin="true"></aside>
      </div>
    `;

    document.body.appendChild(root);
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

  async function saveSettingsFromDom(root) {
    if (!window.ReskinAI || typeof window.ReskinAI.saveSettings !== "function") return;
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;

    const provider = normalize(view.querySelector('[name="provider"]')?.value || "openrouter");
    const payload = {
      provider,
      apiKey: normalize(view.querySelector('[name="apiKey"]')?.value || ""),
      model: normalize(view.querySelector('[name="model"]')?.value || ""),
      batchSize: Number(view.querySelector('[name="batchSize"]')?.value || 25),
      timeoutMs: Number(view.querySelector('[name="timeoutMs"]')?.value || 30000),
      retryCount: Number(view.querySelector('[name="retryCount"]')?.value || 2),
      retryBackoffMs: Number(view.querySelector('[name="retryBackoffMs"]')?.value || 1200),
      maxInputChars: Number(view.querySelector('[name="maxInputChars"]')?.value || 2200),
      enabled: Boolean(view.querySelector('[name="enabled"]')?.checked),
      consentTriage: Boolean(view.querySelector('[name="consentTriage"]')?.checked)
    };

    try {
      const saved = await window.ReskinAI.saveSettings(payload);
      state.settingsCache = saved;
      state.triageStatus = "Settings saved";
      applyReskin();
    } catch (error) {
      state.triageStatus = "Settings save failed";
      logWarn("Save settings failed", error);
      applyReskin();
    }
  }

  async function testSettingsFromDom(root) {
    if (!window.ReskinAI || typeof window.ReskinAI.testConnection !== "function") return;
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;

    const provider = normalize(view.querySelector('[name="provider"]')?.value || "openrouter");
    const payload = {
      provider,
      apiKey: normalize(view.querySelector('[name="apiKey"]')?.value || ""),
      model: normalize(view.querySelector('[name="model"]')?.value || ""),
      enabled: true,
      consentTriage: true,
      batchSize: Number(view.querySelector('[name="batchSize"]')?.value || 25),
      timeoutMs: Number(view.querySelector('[name="timeoutMs"]')?.value || 30000),
      retryCount: Number(view.querySelector('[name="retryCount"]')?.value || 2),
      retryBackoffMs: Number(view.querySelector('[name="retryBackoffMs"]')?.value || 1200),
      maxInputChars: Number(view.querySelector('[name="maxInputChars"]')?.value || 2200)
    };

    try {
      await window.ReskinAI.testConnection(payload);
      state.triageStatus = "Connection successful";
      applyReskin();
    } catch (error) {
      state.triageStatus = "Connection failed";
      logWarn("Connection test failed", error);
      applyReskin();
    }
  }

  function bindRootEvents(root) {
    if (root.getAttribute("data-bound") === "true") return;

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest(".rv-settings")) {
        consumeEvent(event);
        openSettingsView(root);
        return;
      }

      if (target.closest(".rv-settings-back")) {
        consumeEvent(event);
        lockInteractions(500);
        state.settingsPinned = false;
        state.currentView = "list";
        window.location.hash = sanitizeListHash(state.lastListHash || "#inbox");
        renderCurrentView(root);
        return;
      }

      if (target.closest(".rv-settings-save")) {
        consumeEvent(event);
        saveSettingsFromDom(root);
        return;
      }

      if (target.closest(".rv-settings-test")) {
        consumeEvent(event);
        testSettingsFromDom(root);
        return;
      }

      const triageStart = target.closest(".rv-triage-start");
      if (triageStart instanceof HTMLElement) {
        consumeEvent(event);
        state.triageQueueKey = "";
        runTriageForInbox({ force: true, processAll: true, source: "manual-start" });
        return;
      }

      const triageItem = target.closest(".rv-triage-item");
      if (triageItem instanceof HTMLElement) {
        consumeEvent(event);
        lockInteractions(700);
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = false;
        const level = normalize(triageItem.getAttribute("data-triage-level") || "").toLowerCase();
        if (!TRIAGE_LEVELS.includes(level)) return;
        const nextHash = `#inbox?triage=${level}`;
        state.lastListHash = nextHash;
        state.triageFilter = level;
        navigateToList(nextHash, "Inbox");
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

      const navItem = target.closest(".rv-nav-item");
      if (!(navItem instanceof HTMLElement)) return;
      consumeEvent(event);
      lockInteractions(900);
      const nextHash = navItem.getAttribute("data-target-hash") || "#inbox";
      const nativeLabel = navItem.getAttribute("data-native-label") || "";
      state.settingsPinned = false;
      state.currentView = "list";
      state.activeThreadId = "";
      state.lockListView = false;
      state.lastListHash = sanitizeListHash(nextHash, { clearTriage: true });
      state.triageFilter = "";
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

  function collectMessages(limit = 60) {
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
      items.push({ threadId, sender, subject, snippet, bodyText: "", date, href, row, triageLevel: "" });
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
          items.push({ threadId, sender, subject, snippet, bodyText: "", date, href, row, triageLevel: "" });
          if (items.length >= limit) break;
        }

        if (items.length >= limit) break;
      }
    }

    return { items, source };
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

  function extractOpenThreadData() {
    const main = document.querySelector('[role="main"]') || document.body;
    if (!(main instanceof HTMLElement)) {
      return { subject: "", sender: "", date: "", body: "" };
    }

    const subjectCandidates = Array.from(main.querySelectorAll("h1, h2, [role='heading']"))
      .map((node) => normalize(node.textContent))
      .filter((text) => isUseful(text) && !looksLikeDateOrTime(text));
    const subject = subjectCandidates[0] || "No subject captured";

    const senderNode = main.querySelector('h3 span[email], .gD[email], span[email], [email], [data-hovercard-id]');
    const sender = senderNode instanceof HTMLElement ? normalize(senderNode.innerText || senderNode.textContent) : "";

    const dateCandidates = Array.from(main.querySelectorAll("span.g3[title], time, span[title], div[title]"))
      .map((node) => normalize(node.getAttribute("title") || node.innerText || node.textContent))
      .filter((text) => looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text));
    const date = dateCandidates[0] || "";

    const bodyNodes = Array.from(
      main.querySelectorAll('.a3s.aiL, .a3s, [data-message-id] .ii.gt, [role="listitem"] div[dir="ltr"], [role="listitem"] div[dir="auto"]')
    ).filter((node) => node instanceof HTMLElement);
    bodyNodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
    const bodyNode = bodyNodes[0] || null;
    const bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML : "";
    const bodyText = bodyNode instanceof HTMLElement ? normalize(bodyNode.innerText || bodyNode.textContent) : "";

    return {
      subject: cleanSubject(subject, sender, date),
      sender: isUseful(sender) ? sender : "Unknown sender",
      date,
      bodyHtml,
      bodyText: bodyText || "Message body not captured yet."
    };
  }

  function renderThread(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;
    const thread = extractOpenThreadData();

    list.innerHTML = `
      <section class="rv-thread" data-reskin="true">
        <button type="button" class="rv-back" data-reskin="true">Back to inbox</button>
        <h2 class="rv-thread-subject" data-reskin="true">${escapeHtml(thread.subject)}</h2>
        <div class="rv-thread-meta" data-reskin="true">
          <span class="rv-thread-sender" data-reskin="true">${escapeHtml(thread.sender)}</span>
          <span class="rv-thread-date" data-reskin="true">${escapeHtml(thread.date)}</span>
        </div>
        <article class="rv-thread-body" data-reskin="true"></article>
      </section>
    `;

    const body = list.querySelector(".rv-thread-body");
    if (body instanceof HTMLElement) {
      if (thread.bodyHtml) {
        body.innerHTML = `<div class="rv-thread-html" data-reskin="true">${thread.bodyHtml}</div>`;
      } else {
        body.innerHTML = `<pre class="rv-thread-plain" data-reskin="true">${escapeHtml(thread.bodyText)}</pre>`;
      }
    }

    const back = list.querySelector(".rv-back");
    if (back instanceof HTMLElement) {
      back.addEventListener("click", () => {
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = true;
        const targetHash = state.lastListHash || "#inbox";
        navigateToList(targetHash, "Inbox");
        setTimeout(() => {
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement) applyReskin();
        }, 260);
      });
    }
  }

  async function runTriageForInbox(options = {}) {
    const force = Boolean(options.force);
    const processAll = Boolean(options.processAll);
    if (state.currentView !== "list") return;
    if (activeMailbox() !== "inbox") return;
    if (!window.ReskinAI || !window.ReskinTriage) return;
    if (state.triageRunning) return;

    const settings = await loadSettingsCached();
    if (!settings || !settings.enabled || !settings.consentTriage) {
      state.triageStatus = "Enable triage + consent in Settings";
      return;
    }

    const listRoot = document.getElementById(ROOT_ID);
    if (!(listRoot instanceof HTMLElement)) return;

    const attempted = new Set();
    let totalApplied = 0;
    let totalScored = 0;
    let batchIndex = 0;
    const maxBatches = processAll ? 30 : 1;
    state.triageRunning = true;

    try {
      while (batchIndex < maxBatches) {
        const result = collectMessages(160);
        const candidates = [];
        for (const msg of result.items) {
          const level = getTriageLevelForMessage(msg);
          msg.triageLevel = level;
          if (!level && !attempted.has(msg.threadId)) candidates.push(msg);
        }

        state.triageUntriagedCount = candidates.length;
        if (candidates.length === 0) break;

        const batch = candidates.slice(0, settings.batchSize);
        const queueKey = batch.map((m) => m.threadId).join(",");
        if (!force && !processAll && queueKey && queueKey === state.triageQueueKey) break;
        state.triageQueueKey = queueKey;
        for (const msg of batch) attempted.add(msg.threadId);

        state.triageStatus = processAll
          ? `Triaging batch ${batchIndex + 1}: ${batch.length} of ${candidates.length} remaining...`
          : `Triaging ${batch.length} of ${candidates.length}...`;

        const scored = await window.ReskinAI.triageBatch(batch, settings);
        totalScored += batch.length;
        for (const item of scored) {
          if (!item || !item.urgency) continue;
          const mappedByThread = item.threadId
            ? batch.find((msg) => msg.threadId === item.threadId)
            : null;
          const mappedByIndex =
            typeof item.i === "number" && item.i >= 0 && item.i < batch.length ? batch[item.i] : null;
          const targetMessage = mappedByThread || mappedByIndex || null;

          const ok = window.ReskinTriage && typeof window.ReskinTriage.applyLabelToMessage === "function"
            ? await window.ReskinTriage.applyLabelToMessage(
              targetMessage || { threadId: item.threadId, href: "", row: null },
              item.urgency
            )
            : await window.ReskinTriage.applyLabelToThread(item.threadId, item.urgency);
          if (ok) {
            const mappedThreadId = (targetMessage && targetMessage.threadId) || item.threadId;
            if (mappedThreadId) state.triageLocalMap[mappedThreadId] = item.urgency;
            totalApplied += 1;
          }
        }

        batchIndex += 1;
        if (!processAll) break;
      }
      if (batchIndex === 0) {
        state.triageStatus = "Inbox triage is up to date";
      } else if (processAll) {
        state.triageStatus = `Triage complete: ${totalApplied} labels applied across ${batchIndex} batches`;
      } else {
        state.triageStatus = `Applied ${totalApplied} triage labels`;
      }
    } catch (error) {
      const message = error && error.message ? error.message : "triage failed";
      state.triageStatus = `Triage unavailable: ${message.slice(0, 120)}`;
      logWarn("Inbox triage run failed", error);
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
    if (state.currentView === "settings") {
      renderSettings(root);
      return;
    }
    if (state.currentView === "thread") {
      renderThread(root);
      return;
    }
    renderList(root);
  }

  function renderSettings(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;

    const settings = state.settingsCache || {
      provider: "openrouter",
      apiKey: "",
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
        const latestList = latestRoot.querySelector(".rv-list");
        if (!(latestList instanceof HTMLElement)) return;
        renderSettings(latestRoot);
      });
    }

    const groqOptions = window.ReskinAI && Array.isArray(window.ReskinAI.GROQ_FREE_MODELS)
      ? window.ReskinAI.GROQ_FREE_MODELS
      : ["llama-3.1-8b-instant"];

    list.innerHTML = `
      <section class="rv-settings-view" data-reskin="true">
        <h2 class="rv-settings-title" data-reskin="true">AI Settings</h2>
        <p class="rv-settings-copy" data-reskin="true">Inbox-only triage. Already-labeled emails are never re-triaged.</p>
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
            <input name="apiKey" class="rv-field" data-reskin="true" type="password" value="${escapeHtml(settings.apiKey || "")}" placeholder="Required for Groq/OpenRouter" />
          </label>
          <label class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Model</div>
            <input name="model" class="rv-field" data-reskin="true" value="${escapeHtml(settings.provider === "openrouter" ? "openrouter/free" : settings.model || groqOptions[0])}" placeholder="Model id" />
          </label>
          <label class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Batch Size</div>
            <input name="batchSize" class="rv-field" data-reskin="true" type="number" min="1" max="100" value="${Number(settings.batchSize) || 25}" />
          </label>
          <label class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Timeout (ms)</div>
            <input name="timeoutMs" class="rv-field" data-reskin="true" type="number" min="5000" max="120000" value="${Number(settings.timeoutMs) || 30000}" />
          </label>
          <label class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Retry Count</div>
            <input name="retryCount" class="rv-field" data-reskin="true" type="number" min="0" max="5" value="${Number(settings.retryCount) || 2}" />
          </label>
          <label class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Retry Backoff (ms)</div>
            <input name="retryBackoffMs" class="rv-field" data-reskin="true" type="number" min="200" max="20000" value="${Number(settings.retryBackoffMs) || 1200}" />
          </label>
          <label class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Max Input Chars</div>
            <input name="maxInputChars" class="rv-field" data-reskin="true" type="number" min="400" max="10000" value="${Number(settings.maxInputChars) || 2200}" />
          </label>
        </div>
        <label class="rv-toggle" data-reskin="true"><input name="enabled" type="checkbox" ${settings.enabled ? "checked" : ""} /> Enable triage</label>
        <label class="rv-toggle" data-reskin="true"><input name="consentTriage" type="checkbox" ${settings.consentTriage ? "checked" : ""} /> I consent to send inbox content to the selected AI provider for triage.</label>
        <div class="rv-settings-actions" data-reskin="true">
          <button type="button" class="rv-settings-test" data-reskin="true">Test Connection</button>
          <button type="button" class="rv-settings-save" data-reskin="true">Save Settings</button>
          <button type="button" class="rv-settings-back" data-reskin="true">Back to Inbox</button>
        </div>
      </section>
    `;
  }

  function renderList(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;

    const route = parseListRoute(window.location.hash || state.lastListHash || "#inbox");
    state.triageFilter = route.triage;

    const result = collectMessages();
    const allMessages = result.items;

    for (const msg of allMessages) {
      msg.triageLevel = getTriageLevelForMessage(msg);
    }

    state.triageCounts = window.ReskinTriage && typeof window.ReskinTriage.countLevels === "function"
      ? window.ReskinTriage.countLevels(allMessages)
      : { critical: 0, high: 0, medium: 0, low: 0, fyi: 0 };

    let messages = allMessages;
    if (route.mailbox === "inbox" && route.triage) {
      messages = allMessages.filter((msg) => msg.triageLevel === route.triage);
    }

    const listSignature = `${route.hash}|${messages.map((m) => `${m.threadId}:${m.triageLevel || "u"}`).join(",")}`;
    if (state.lastListSignature === listSignature && !interactionsLocked()) return;
    state.lastListSignature = listSignature;

    list.innerHTML = "";

    if (state.lastSource !== result.source) {
      state.lastSource = result.source;
      logInfo(`Extractor source: ${result.source}`);
    }

    if (state.lastRenderedCount !== messages.length) {
      state.lastRenderedCount = messages.length;
      logInfo(`Rendered ${messages.length} messages`);
    }

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rv-empty";
      empty.setAttribute("data-reskin", "true");
      empty.textContent = route.triage
        ? `No ${triageLabelText(route.triage)} inbox messages captured yet.`
        : "No messages captured yet.";
      list.appendChild(empty);
    } else {
      for (const msg of messages) {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "rv-item";
        item.setAttribute("data-reskin", "true");

        const level = msg.triageLevel;
        const badgeClass = level ? `is-${level}` : "is-untriaged";
        const badgeText = level ? triageLabelText(level) : "Untriaged";

        item.innerHTML = `
          <div class="rv-item-top" data-reskin="true">
            <span class="rv-sender" data-reskin="true">${escapeHtml(msg.sender)}</span>
            <span class="rv-date" data-reskin="true">${escapeHtml(msg.date || "")}</span>
          </div>
          <div class="rv-subject" data-reskin="true">${escapeHtml(msg.subject)}</div>
          <div class="rv-triage-row" data-reskin="true">
            <span class="rv-badge ${badgeClass}" data-reskin="true">${escapeHtml(badgeText)}</span>
            <span class="rv-snippet" data-reskin="true">${escapeHtml(msg.snippet || "")}</span>
          </div>
        `;

        item.addEventListener("click", () => {
          lockInteractions(900);
          state.lockListView = false;
          state.currentView = "thread";
          state.activeThreadId = msg.threadId;
          renderThread(root);
          const ok = openThread(msg.threadId, msg.href, msg.row);
          if (!ok) {
            logWarn("Failed to open thread from custom view.", { threadId: msg.threadId });
            state.currentView = "list";
            state.activeThreadId = "";
            renderList(root);
            return;
          }
          setTimeout(() => {
            const latestRoot = document.getElementById(ROOT_ID);
            if (!(latestRoot instanceof HTMLElement)) return;
            if (state.currentView !== "thread") return;
            renderThread(latestRoot);
          }, 220);
        });

        list.appendChild(item);
      }
    }

    if (route.mailbox === "inbox") {
      setTimeout(() => {
        runTriageForInbox({ force: false, processAll: false, source: "auto" });
      }, 120);
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

      const elapsed = Date.now() - state.lastObserverRenderAt;
      if (elapsed >= Math.max(OBSERVER_MIN_RENDER_GAP_MS, LIST_REFRESH_INTERVAL_MS)) {
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
      applyReskin();
      startObserver();
      logOnce("observer-started", "info", "Low-power UI poller started (900ms interval).");
    }, 200);
  }

  waitForReady();
})();
