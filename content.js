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
  const LOCAL_READ_HOLD_MS = 8 * 60 * 1000;

  const LIST_LOAD_MORE_DISTANCE_PX = 280;
  const LIST_PREFETCH_DISTANCE_PX = 900;
  const MAILBOX_SCAN_MAX_PAGES = 120;
  const MAILBOX_SCAN_NO_CHANGE_LIMIT = 3;
  const OPTIMISTIC_RECONCILE_WINDOW_MS = 120000;
  const INBOX_SDK_APP_ID = "sdk_reskinmail_25053b311c";
  const INBOX_SDK_THREAD_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
  const CHAT_DEBUG_STORAGE_KEY = "reskin_chat_debug_v1";
  const CHAT_DEBUG_DEFAULT_ENABLED = true;
  // Deprecated compatibility switch: keep false for strict thread-first rendering.
  const ENABLE_CONTACT_MERGE_MODE = false;
  const THREAD_READY_MAX_RETRIES = 5;
  const THREAD_READY_RETRY_BASE_MS = 260;
  const DEBUG_BRIDGE_REQUEST_EVENT = "reskin:debug:request";
  const DEBUG_BRIDGE_RESPONSE_EVENT = "reskin:debug:response";
  const DEBUG_BRIDGE_SCRIPT_ID = "reskin-debug-bridge";

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
    fullScanMailbox: "",
    fullScanStatus: "",
    fullScanCompletedByMailbox: {},
    mailboxScanProgress: {},
    mailboxScanQueue: [],
    mailboxScanRunner: false,
    scannedMailboxMessages: {},
    inboxHashNudged: false,
    inboxEmptyRetryScheduled: false,
    listVisibleByMailbox: {},
    listChunkSize: 240,
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
    activeContactEmail: "",
    activeConversationKey: "",
    contactThreadIds: [],
    mergedMessages: [],
    currentThreadIdForReply: "",
    currentThreadHintHref: "",
    currentThreadMailbox: "",
    threadHintHrefByThreadId: {},
    threadRowHintByThreadId: {},
    inboxSdkInstance: null,
    inboxSdkLoadPromise: null,
    inboxSdkReady: false,
    inboxSdkThreadMessages: {},
    inboxSdkThreadUpdatedAt: {},
    inboxSdkThreadViewById: {},
    currentUserEmail: "",
    currentUserEmailDetectedAt: 0,
    activeAccountEmail: "",
    optimisticMessagesByThread: {},
    replyDraftByThread: {},
    replySendInProgress: false,
    contactChatLoading: false,
    contactDisplayName: "",
    threadExtractRetry: 0,
    snippetByThreadId: {},
    localReadUntilByThread: {},
    suspendHashSyncDuringContactHydration: false,
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

  function chatDebugEnabled() {
    try {
      if (globalThis.__RESKIN_CHAT_DEBUG === true) return true;
      if (globalThis.__RESKIN_CHAT_DEBUG === false) return false;
      if (typeof localStorage !== "undefined") {
        const stored = localStorage.getItem(CHAT_DEBUG_STORAGE_KEY);
        if (stored === "1") return true;
        if (stored === "0") return false;
      }
    } catch (_) {
      // ignore storage failures
    }
    return CHAT_DEBUG_DEFAULT_ENABLED;
  }

  function setChatDebugEnabled(enabled) {
    const next = Boolean(enabled);
    try {
      globalThis.__RESKIN_CHAT_DEBUG = next;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(CHAT_DEBUG_STORAGE_KEY, next ? "1" : "0");
      }
    } catch (_) {
      // ignore storage failures
    }
    logInfo(`Chat debug ${next ? "enabled" : "disabled"}.`);
    return next;
  }

  function summarizeChatMessageForDebug(message) {
    const msg = message && typeof message === "object" ? message : {};
    const body = normalize((msg.cleanBodyText || msg.bodyText || "").slice(0, 120));
    return {
      id: normalize(msg.id || msg.messageKey || ""),
      messageId: normalize(msg.messageId || msg.dataMessageId || ""),
      threadId: normalize(msg.threadId || ""),
      senderEmail: extractEmail(msg.senderEmail || msg.sender || ""),
      recipientEmails: normalizeEmailList(msg.recipientEmails).slice(0, 5),
      participants: normalizeEmailList(msg.participants).slice(0, 6),
      direction: normalize(msg.direction || ""),
      source: normalize(msg.source || msg.sourceType || ""),
      timestampMs: Number(msg.timestampMs || 0),
      status: normalize(msg.status || msg.deliveryState || msg.optimisticStatus || ""),
      bodyPreview: body
    };
  }

  function summarizeChatMessagesForDebug(messages, limit = 4) {
    const out = [];
    for (const msg of Array.isArray(messages) ? messages : []) {
      out.push(summarizeChatMessageForDebug(msg));
      if (out.length >= Math.max(1, Number(limit) || 4)) break;
    }
    return out;
  }

  function logChatDebug(label, extra, options = {}) {
    if (!chatDebugEnabled()) return;
    const throttleMs = Number(options.throttleMs || 0);
    const throttleKey = normalize(options.throttleKey || "");
    if (throttleMs > 0 && throttleKey) {
      if (!logChatDebug._last) logChatDebug._last = new Map();
      const now = Date.now();
      const previous = Number(logChatDebug._last.get(throttleKey) || 0);
      if (now - previous < throttleMs) return;
      logChatDebug._last.set(throttleKey, now);
    }
    if (typeof extra === "undefined") {
      console.info(`[reskin][chat-debug] ${label}`);
      return;
    }
    console.info(`[reskin][chat-debug] ${label}`, extra);
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

  function extractEmail(value) {
    const raw = normalize(value || "");
    if (!raw) return "";
    const match = raw.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? normalize(match[0]).toLowerCase() : "";
  }

  function extractEmails(value, limit = 20) {
    const raw = String(value || "");
    if (!raw) return [];
    const regex = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/ig;
    const out = [];
    const seen = new Set();
    let match;
    while ((match = regex.exec(raw)) !== null) {
      const email = normalize(match[0] || "").toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      out.push(email);
      if (out.length >= Math.max(1, Number(limit) || 20)) break;
    }
    return out;
  }

  function normalizeEmailList(values, limit = 40) {
    const queue = Array.isArray(values) ? values.slice() : [values];
    const out = [];
    const seen = new Set();
    const cap = Math.max(1, Number(limit) || 40);
    while (queue.length > 0 && out.length < cap) {
      const next = queue.shift();
      if (Array.isArray(next)) {
        queue.unshift(...next);
        continue;
      }
      if (typeof next === "undefined" || next === null) continue;
      if (next && typeof next === "object") {
        if (typeof next.emailAddress === "string") queue.unshift(next.emailAddress);
        if (typeof next.email === "string") queue.unshift(next.email);
        if (typeof next.address === "string") queue.unshift(next.address);
        if (typeof next.name === "string") queue.unshift(next.name);
        if (typeof next.value === "string") queue.unshift(next.value);
        continue;
      }
      const emails = extractEmails(String(next || ""), cap);
      for (const email of emails) {
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= cap) break;
      }
    }
    return out;
  }

  function collectEmailsFromUnknownValue(value, out = [], depth = 0, seen = new Set()) {
    if (depth > 4 || out.length >= 50) return out;
    if (typeof value === "undefined" || value === null) return out;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const candidates = extractEmails(String(value || ""), 8);
      for (const email of candidates) {
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= 50) break;
      }
      return out;
    }
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 80);
      for (let i = 0; i < limit && out.length < 50; i += 1) {
        collectEmailsFromUnknownValue(value[i], out, depth + 1, seen);
      }
      return out;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).slice(0, 60);
      for (const key of keys) {
        if (out.length >= 50) break;
        collectEmailsFromUnknownValue(value[key], out, depth + 1, seen);
      }
      return out;
    }
    return out;
  }

  function chooseLikelyAccountEmail(candidates) {
    const emails = normalizeEmailList(candidates, 40);
    if (emails.length === 0) return "";
    const scored = emails
      .map((email, index) => {
        let score = 0;
        if (!isSystemNoReplyEmail(email)) score += 3;
        if (/@gmail\.com$/i.test(email) || /@googlemail\.com$/i.test(email)) score += 2;
        if (!/^(no-?reply|noreply|notifications?)@/i.test(email)) score += 1;
        score += Math.max(0, 12 - index) * 0.01;
        return { email, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].email : "";
  }

  function collectAccountEmailCandidatesFromNode(node) {
    if (!(node instanceof HTMLElement)) return [];
    return normalizeEmailList([
      node.getAttribute("data-email"),
      node.getAttribute("email"),
      node.getAttribute("data-og-email"),
      node.getAttribute("data-account-email"),
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.textContent
    ], 10);
  }

  function detectAccountEmailFromChromeControls() {
    const selectors = [
      'a[aria-label*="Google Account"]',
      'button[aria-label*="Google Account"]',
      '[role="button"][aria-label*="Google Account"]',
      '[aria-label*="Google Account"][data-email]',
      '[aria-label*="Google Account"][title*="@"]',
      'a[href*="SignOutOptions"][aria-label*="@"]',
      'button[aria-label*="@gmail.com"]',
      'button[aria-label*="@googlemail.com"]'
    ];
    const scored = [];
    const seenNode = new Set();
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement)) continue;
        if (seenNode.has(node)) continue;
        seenNode.add(node);
        const candidates = collectAccountEmailCandidatesFromNode(node);
        if (candidates.length === 0) continue;
        const rect = node.getBoundingClientRect();
        const nearTop = rect.top >= -24 && rect.top <= 220;
        const nearRight = rect.left >= (window.innerWidth * 0.55);
        const label = normalize(node.getAttribute("aria-label") || "").toLowerCase();
        for (const email of candidates) {
          let score = 0;
          if (nearTop) score += 3;
          if (nearRight) score += 3;
          if (label.includes("google account")) score += 5;
          if (/@gmail\.com$/i.test(email) || /@googlemail\.com$/i.test(email)) score += 2;
          if (!isSystemNoReplyEmail(email)) score += 1;
          scored.push({ email, score });
        }
      }
    }
    if (scored.length === 0) return "";
    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].email : "";
  }

  function conversationKeyFromContact(contactEmail) {
    const email = extractEmail(contactEmail || "");
    if (!email) return "";
    return `contact:${email}`;
  }

  function contactEmailFromConversationKey(conversationKey) {
    const raw = normalize(conversationKey || "").toLowerCase();
    if (!raw) return "";
    if (raw.startsWith("contact:")) return extractEmail(raw.slice("contact:".length));
    return extractEmail(raw);
  }

  function activeConversationContactEmail() {
    return (
      extractEmail(state.activeContactEmail || "")
      || contactEmailFromConversationKey(state.activeConversationKey || "")
      || extractEmail(state.activeContactKey || "")
      || ""
    );
  }

  function activeConversationContext(overrides = {}) {
    const fallbackAccount = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
    const activeAccountEmail = extractEmail(
      overrides.activeAccountEmail
      || fallbackAccount
      || detectCurrentUserEmail()
    );
    const contactEmail = extractEmail(
      overrides.contactEmail
      || state.activeContactEmail
      || contactEmailFromConversationKey(overrides.conversationKey || "")
      || activeConversationContactEmail()
    );
    const inferredConversationKey = normalize(
      overrides.conversationKey
      || state.activeConversationKey
      || conversationKeyFromContact(contactEmail)
    );
    return {
      activeAccountEmail,
      contactEmail,
      conversationKey: inferredConversationKey,
      includeGroups: true
    };
  }

  function clearContactConversationState() {
    state.activeContactKey = "";
    state.activeContactEmail = "";
    state.activeConversationKey = "";
    state.contactThreadIds = [];
    state.mergedMessages = [];
    state.contactDisplayName = "";
    state.contactChatLoading = false;
    state.suspendHashSyncDuringContactHydration = false;
  }

  function activeThreadTimelineContext(overrides = {}) {
    const threadId = canonicalThreadId(
      overrides.threadId
      || state.currentThreadIdForReply
      || state.activeThreadId
      || threadIdFromHash(window.location.hash || "")
      || ""
    ) || normalize(
      overrides.threadId
      || state.currentThreadIdForReply
      || state.activeThreadId
      || threadIdFromHash(window.location.hash || "")
      || ""
    );
    const mailbox = mailboxCacheKey(
      overrides.mailbox
      || state.currentThreadMailbox
      || mailboxKeyFromHash(state.lastListHash || window.location.hash || "#inbox")
      || "inbox"
    );
    const activeAccountEmail = extractEmail(
      overrides.activeAccountEmail
      || state.activeAccountEmail
      || state.currentUserEmail
      || detectCurrentUserEmail()
    );
    const threadHintHref = normalize(
      overrides.threadHintHref
      || state.currentThreadHintHref
      || lookupThreadHintHref(threadId)
      || ""
    );
    return {
      threadId,
      mailbox,
      activeAccountEmail,
      threadHintHref
    };
  }

  function isSelfSenderLabel(value) {
    const raw = normalize(value || "").toLowerCase();
    if (!raw) return false;
    return /^(you|me|myself)(\b|$)/i.test(raw) || /^to me(\b|$)/i.test(raw);
  }

  function messagePartySnapshot(message, context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const sender = normalize(msg.sender || "");
    const ctx = activeConversationContext(context);
    const mailbox = mailboxCacheKey(msg.mailbox || "");
    let senderEmail = extractEmail(msg.senderEmail || msg.from || sender);
    if (
      !senderEmail
      && ctx.activeAccountEmail
      && (
        isSelfSenderLabel(sender)
        || mailbox === "sent"
        || normalize(msg.direction || "").toLowerCase() === "outgoing"
        || normalize(msg.sourceType || "").toLowerCase() === "optimistic"
      )
    ) {
      senderEmail = ctx.activeAccountEmail;
    }

    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.bcc,
      msg.replyTo,
      msg.deliveredTo,
      msg.headerText,
      msg.scopeText,
      msg.ariaLabel
    ]);
    const recipientSet = new Set(recipientEmails);
    if (senderEmail) recipientSet.delete(senderEmail);

    // Gmail DOM extraction does not always expose recipients; infer the counterpart for 1:1 messages.
    if (ctx.contactEmail && ctx.activeAccountEmail) {
      if (senderEmail === ctx.activeAccountEmail && !recipientSet.has(ctx.contactEmail)) {
        recipientSet.add(ctx.contactEmail);
      }
      if (senderEmail === ctx.contactEmail && !recipientSet.has(ctx.activeAccountEmail)) {
        recipientSet.add(ctx.activeAccountEmail);
      }
    }

    const participants = normalizeEmailList([
      senderEmail,
      Array.from(recipientSet),
      msg.participants
    ]);
    return {
      senderEmail,
      recipientEmails: Array.from(recipientSet),
      participants,
      context: ctx
    };
  }

  function messageBelongsToConversation(message, context = {}) {
    const snapshot = messagePartySnapshot(message, context);
    const contactEmail = extractEmail(snapshot.context.contactEmail || "");
    const activeAccountEmail = extractEmail(snapshot.context.activeAccountEmail || "");
    const messageMailbox = mailboxCacheKey(message && message.mailbox ? message.mailbox : "");
    const sourceType = normalize(message && message.sourceType ? message.sourceType : "").toLowerCase();
    const optimisticDirection = normalize(message && message.direction ? message.direction : "").toLowerCase();
    const optimisticOutgoing = Boolean(
      sourceType === "optimistic"
      || Boolean(message && message.isOptimistic)
      || optimisticDirection === "outgoing"
    );
    const inferredContactKey = extractEmail(contactKeyFromMessage(message || {}));
    const inferredContactMatch = Boolean(contactEmail && inferredContactKey && inferredContactKey === contactEmail);
    if (!contactEmail) return true;
    if (optimisticOutgoing) {
      logChatDebug("conversation-filter:include-optimistic-outgoing", {
        contactEmail,
        activeAccountEmail,
        sourceType,
        optimisticDirection,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `include-optimistic:${contactEmail}`, throttleMs: 800 });
      return true;
    }

    const participantSet = new Set(snapshot.participants || []);
    const hasContact = participantSet.has(contactEmail) || snapshot.senderEmail === contactEmail;
    if (!hasContact) {
      const keepSparseOutgoing = Boolean(
        activeAccountEmail
        && snapshot.senderEmail === activeAccountEmail
        && (inferredContactMatch || messageMailbox === "sent")
      );
      const keepUnknownSelfOutgoing = Boolean(
        !activeAccountEmail
        && (isSelfSenderLabel(message && message.sender ? message.sender : "") || optimisticOutgoing)
      );
      if (keepSparseOutgoing) {
        logChatDebug("conversation-filter:include-sparse-outgoing", {
          contactEmail,
          activeAccountEmail,
          inferredContactKey,
          mailbox: messageMailbox,
          snapshot: summarizeChatMessageForDebug(message)
        }, { throttleKey: `include-sparse-outgoing:${contactEmail}:${messageMailbox}`, throttleMs: 900 });
        return true;
      }
      if (keepUnknownSelfOutgoing) {
        logChatDebug("conversation-filter:include-self-outgoing-no-account", {
          contactEmail,
          activeAccountEmail,
          inferredContactKey,
          mailbox: messageMailbox,
          snapshot: summarizeChatMessageForDebug(message)
        }, { throttleKey: `include-self-outgoing-no-account:${contactEmail}`, throttleMs: 900 });
        return true;
      }
      logChatDebug("conversation-filter:drop-no-contact", {
        contactEmail,
        activeAccountEmail,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `drop-no-contact:${contactEmail}:${snapshot.senderEmail || ""}`, throttleMs: 1200 });
      return false;
    }
    if (!activeAccountEmail) {
      if (inferredContactMatch) {
        logChatDebug("conversation-filter:include-inferred-contact-no-account", {
          contactEmail,
          inferredContactKey,
          snapshot: summarizeChatMessageForDebug(message)
        }, { throttleKey: `include-inferred-no-account:${contactEmail}`, throttleMs: 1400 });
        return true;
      }
      logChatDebug("conversation-filter:include-no-account", {
        contactEmail,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `include-no-account:${contactEmail}`, throttleMs: 1800 });
      return hasContact;
    }

    const hasAccount = participantSet.has(activeAccountEmail) || snapshot.senderEmail === activeAccountEmail;
    if (hasAccount) return true;

    // Keep incoming rows from the selected contact even when Gmail omits recipient metadata.
    const keepAsIncoming = snapshot.senderEmail === contactEmail;
    const keepAsOutgoing = Boolean(
      snapshot.senderEmail === activeAccountEmail
      && (inferredContactMatch || messageMailbox === "sent")
    );
    if (keepAsIncoming || keepAsOutgoing) {
      logChatDebug("conversation-filter:include-fallback-match", {
        contactEmail,
        activeAccountEmail,
        inferredContactKey,
        mailbox: messageMailbox,
        fallback: keepAsIncoming ? "incoming" : "outgoing",
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `include-fallback-match:${contactEmail}:${messageMailbox}`, throttleMs: 1000 });
      return true;
    }
    if (!keepAsIncoming && !keepAsOutgoing) {
      logChatDebug("conversation-filter:drop-no-account-match", {
        contactEmail,
        activeAccountEmail,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `drop-no-account-match:${contactEmail}:${activeAccountEmail}`, throttleMs: 1200 });
    }
    return false;
  }

  function isGenericSenderLabel(value) {
    const v = normalize(value || "").toLowerCase();
    if (!v) return true;
    if (["google", "gmail", "inbox", "chat", "calendar", "meet", "you", "me", "to me"].includes(v)) return true;
    if (NOISE_TEXT.has(v)) return true;
    return false;
  }

  function isSystemNoReplyEmail(email) {
    const v = normalize(email || "").toLowerCase();
    if (!v) return false;
    return (
      /^no-?reply@accounts\.google\.com$/i.test(v) ||
      /^no-?reply@google\.com$/i.test(v) ||
      /^noreply@googlemail\.com$/i.test(v)
    );
  }

  function isLowConfidenceSender(sender) {
    const value = normalize(sender || "");
    if (!value) return true;
    if (isGenericSenderLabel(value)) return true;
    const email = extractEmail(value);
    if (email && isSystemNoReplyEmail(email)) return true;
    return false;
  }

  function choosePreferredSender(capturedSender, seededSender) {
    const captured = normalize(capturedSender || "");
    const seeded = normalize(seededSender || "");
    if (!captured) return seeded || captured;
    if (!seeded) return captured;
    if (isLowConfidenceSender(captured) && !isLowConfidenceSender(seeded)) return seeded;
    const capturedEmail = extractEmail(captured);
    const seededEmail = extractEmail(seeded);
    if (
      capturedEmail &&
      seededEmail &&
      capturedEmail !== seededEmail &&
      isSystemNoReplyEmail(capturedEmail) &&
      !isSystemNoReplyEmail(seededEmail)
    ) {
      return seeded;
    }
    return captured;
  }

  function hashString(input) {
    const text = String(input || "");
    if (!text) return "0";
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  function detectCurrentUserEmail(force = false) {
    const now = Date.now();
    if (!force && state.currentUserEmail && now - Number(state.currentUserEmailDetectedAt || 0) < 60000) {
      state.activeAccountEmail = state.currentUserEmail;
      return state.currentUserEmail;
    }

    const foundFromChrome = detectAccountEmailFromChromeControls();
    if (foundFromChrome) {
      state.currentUserEmail = foundFromChrome;
      state.activeAccountEmail = foundFromChrome;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "chrome-controls",
        email: foundFromChrome
      }, { throttleKey: `account-detect:chrome:${foundFromChrome}`, throttleMs: 2200 });
      return foundFromChrome;
    }

    const selectors = [
      '[data-email]',
      '[data-og-email]',
      '[data-account-email]',
      'button[aria-label*="@"]',
      'a[aria-label*="@"]',
      'img[aria-label*="@"]',
      '[aria-label*="Google Account"]'
    ];
    const candidates = [];
    const mainRoot = getGmailMainRoot();
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement)) continue;
        if (mainRoot instanceof HTMLElement && mainRoot.contains(node)) continue;
        candidates.push(
          node.getAttribute("data-email"),
          node.getAttribute("email"),
          node.getAttribute("data-og-email"),
          node.getAttribute("data-account-email"),
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.textContent
        );
      }
    }

    const foundFromDom = chooseLikelyAccountEmail(candidates);
    if (foundFromDom) {
      state.currentUserEmail = foundFromDom;
      state.activeAccountEmail = foundFromDom;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "dom",
        email: foundFromDom,
        candidateCount: normalizeEmailList(candidates).length
      }, { throttleKey: `account-detect:dom:${foundFromDom}`, throttleMs: 2200 });
      return foundFromDom;
    }

    const globalCandidates = [];
    try {
      if (Array.isArray(globalThis.GLOBALS)) {
        collectEmailsFromUnknownValue(globalThis.GLOBALS, globalCandidates);
      }
      if (typeof globalThis.APP_INITIALIZATION_STATE !== "undefined") {
        collectEmailsFromUnknownValue(globalThis.APP_INITIALIZATION_STATE, globalCandidates);
      }
      if (typeof globalThis.VIEW_DATA !== "undefined") {
        collectEmailsFromUnknownValue(globalThis.VIEW_DATA, globalCandidates);
      }
      if (globalThis.gbar && typeof globalThis.gbar.getEmail === "function") {
        globalCandidates.push(globalThis.gbar.getEmail());
      }
    } catch (_) {
      // ignore global access errors
    }
    const fromGlobals = chooseLikelyAccountEmail(globalCandidates);
    if (fromGlobals) {
      state.currentUserEmail = fromGlobals;
      state.activeAccountEmail = fromGlobals;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "globals",
        email: fromGlobals,
        candidateCount: normalizeEmailList(globalCandidates).length
      }, { throttleKey: `account-detect:globals:${fromGlobals}`, throttleMs: 2200 });
      return fromGlobals;
    }

    const scriptCandidates = [];
    try {
      const scripts = Array.from(document.querySelectorAll("script:not([src]), script[type='application/json']")).slice(0, 20);
      for (const script of scripts) {
        if (!(script instanceof HTMLScriptElement)) continue;
        const text = String(script.textContent || "");
        if (text.length < 5) continue;
        const sample = text.length > 14000 ? text.slice(0, 14000) : text;
        collectEmailsFromUnknownValue(sample, scriptCandidates);
        if (scriptCandidates.length >= 20) break;
      }
    } catch (_) {
      // ignore script parse failures
    }
    const fromScripts = chooseLikelyAccountEmail(scriptCandidates);
    if (fromScripts) {
      state.currentUserEmail = fromScripts;
      state.activeAccountEmail = fromScripts;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "scripts",
        email: fromScripts,
        candidateCount: normalizeEmailList(scriptCandidates).length
      }, { throttleKey: `account-detect:scripts:${fromScripts}`, throttleMs: 2200 });
      return fromScripts;
    }

    if (state.currentUserEmail) {
      state.activeAccountEmail = state.currentUserEmail;
      return state.currentUserEmail;
    }
    if (state.activeAccountEmail) return state.activeAccountEmail;
    logOnce(
      "current-user-email-missing",
      "warn",
      "Current Gmail account email could not be detected; outgoing direction will use heuristic fallback."
    );
    logChatDebug("account-detect:missing", {
      source: "none",
      hash: normalize(window.location.hash || ""),
      activeConversationKey: normalize(state.activeConversationKey || ""),
      activeContactEmail: extractEmail(state.activeContactEmail || "")
    }, { throttleKey: "account-detect-missing", throttleMs: 2200 });
    return "";
  }

  function classifyMessageDirection(message, threadId = "", context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const sender = normalize(msg.sender || "");
    const parties = messagePartySnapshot(msg, context);
    const senderEmail = parties.senderEmail;
    const recipientSet = new Set(Array.isArray(parties.recipientEmails) ? parties.recipientEmails : []);
    const participantSet = new Set(Array.isArray(parties.participants) ? parties.participants : []);
    const userEmail = extractEmail(parties.context.activeAccountEmail || detectCurrentUserEmail());
    const mailbox = mailboxCacheKey(msg.mailbox || "");

    if (!senderEmail && isSelfSenderLabel(sender)) {
      logChatDebug("direction:outgoing-you-label", {
        threadId: normalize(threadId || msg.threadId || ""),
        sender
      }, { throttleKey: "direction-you-label", throttleMs: 1400 });
      return "outgoing";
    }
    if (senderEmail && userEmail && senderEmail === userEmail) {
      return "outgoing";
    }
    if (!senderEmail && userEmail) {
      const userLocal = normalize(userEmail.split("@")[0] || "").toLowerCase();
      const senderLower = sender.toLowerCase();
      if (userLocal && senderLower && senderLower.includes(userLocal)) {
        logChatDebug("direction:outgoing-local-heuristic", {
          userEmail,
          sender,
          senderEmail,
          threadId: normalize(threadId || msg.threadId || "")
        }, { throttleKey: `direction-local:${userLocal}`, throttleMs: 1800 });
        return "outgoing";
      }
    }
    if (mailbox === "sent") {
      const senderLooksSelf = Boolean(
        !senderEmail
        || (userEmail && senderEmail === userEmail)
        || isSelfSenderLabel(sender)
      );
      if (senderLooksSelf || !userEmail) {
        logChatDebug("direction:outgoing-sent-mailbox", {
          threadId: normalize(threadId || msg.threadId || ""),
          sender,
          senderEmail,
          userEmail
        }, { throttleKey: `direction-outgoing-sent:${normalize(threadId || msg.threadId || "")}`, throttleMs: 1100 });
        return "outgoing";
      }
    }

    if (
      senderEmail
      && userEmail
      && senderEmail !== userEmail
      && (recipientSet.has(userEmail) || participantSet.has(userEmail))
    ) {
      return "incoming";
    }

    // Thread-first mode: if sender differs from active account, treat as incoming.
    if (senderEmail && userEmail && senderEmail !== userEmail) {
      return "incoming";
    }
    if (senderEmail && !userEmail && mailbox !== "sent") {
      return "incoming";
    }
    if (normalize(msg.sourceType || "") === "optimistic") return "outgoing";
    logChatDebug("direction:unknown", {
      threadId: normalize(threadId || msg.threadId || ""),
      sender,
      senderEmail,
      userEmail,
      recipientEmails: Array.from(recipientSet),
      participants: Array.from(participantSet),
      message: summarizeChatMessageForDebug(msg)
    }, {
      throttleKey: `direction-unknown:${normalize(threadId || msg.threadId || "")}:${senderEmail || sender || "unknown"}`,
      throttleMs: 1200
    });
    return "unknown";
  }

  function inboxSdkCacheKeyForThread(threadId) {
    return canonicalThreadId(threadId || "") || normalize(threadId || "");
  }

  function getInboxSdkThreadMessages(threadId) {
    const key = inboxSdkCacheKeyForThread(threadId);
    if (!key) return [];
    const updatedAt = Number(state.inboxSdkThreadUpdatedAt[key] || 0);
    if (updatedAt > 0 && Date.now() - updatedAt > INBOX_SDK_THREAD_CACHE_MAX_AGE_MS) {
      delete state.inboxSdkThreadMessages[key];
      delete state.inboxSdkThreadUpdatedAt[key];
      return [];
    }
    const list = state.inboxSdkThreadMessages[key];
    return Array.isArray(list) ? list.slice() : [];
  }

  function setInboxSdkThreadMessages(threadId, messages) {
    const key = inboxSdkCacheKeyForThread(threadId);
    if (!key) return;
    const next = Array.isArray(messages) ? messages.filter((item) => item && typeof item === "object") : [];
    if (next.length === 0) {
      delete state.inboxSdkThreadMessages[key];
      delete state.inboxSdkThreadUpdatedAt[key];
      return;
    }
    state.inboxSdkThreadMessages[key] = next;
    state.inboxSdkThreadUpdatedAt[key] = Date.now();
  }

  function hasMeaningfulCapturedMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    return messages.some((msg) => {
      const text = normalize((msg && (msg.cleanBodyText || msg.bodyText)) || "");
      return (
        hasUsefulBodyText(text)
        && text !== THREAD_BODY_PLACEHOLDER
        && text !== THREAD_NO_CONTENT
        && !isLikelyMetadataBlob(text)
      );
    });
  }

  function senderLabelFromInboxSdkContact(contact) {
    if (!contact || typeof contact !== "object") return "";
    const email = extractEmail(contact.emailAddress || contact.email || "");
    const name = normalize(contact.name || contact.fullName || contact.title || "");
    if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} <${email}>`;
    return name || email;
  }

  function emailsFromInboxSdkContactValue(value) {
    return normalizeEmailList(value);
  }

  async function snapshotInboxSdkThreadView(threadView) {
    if (!threadView || typeof threadView !== "object") return [];
    let threadId = "";
    try {
      if (typeof threadView.getThreadIDAsync === "function") {
        threadId = normalize(await threadView.getThreadIDAsync());
      } else if (typeof threadView.getThreadID === "function") {
        threadId = normalize(threadView.getThreadID());
      }
    } catch (_) {
      threadId = "";
    }
    const canonicalTid = inboxSdkCacheKeyForThread(threadId);
    if (!canonicalTid) return [];

    let messageViews = [];
    try {
      if (typeof threadView.getMessageViewsAll === "function") {
        messageViews = threadView.getMessageViewsAll();
      } else if (typeof threadView.getMessageViews === "function") {
        messageViews = threadView.getMessageViews();
      }
    } catch (_) {
      messageViews = [];
    }
    if (!Array.isArray(messageViews) || messageViews.length === 0) return [];

    const extracted = [];
    for (let i = 0; i < messageViews.length; i += 1) {
      const view = messageViews[i];
      if (!view || typeof view !== "object") continue;
      if (typeof view.isLoaded === "function" && !view.isLoaded()) continue;
      let dataMessageId = "";
      try {
        if (typeof view.getMessageIDAsync === "function") {
          dataMessageId = normalize(await view.getMessageIDAsync());
        } else if (typeof view.getMessageID === "function") {
          dataMessageId = normalize(view.getMessageID());
        }
      } catch (_) {
        dataMessageId = "";
      }
      let sender = "";
      try {
        if (typeof view.getSender === "function") {
          sender = senderLabelFromInboxSdkContact(view.getSender());
        }
      } catch (_) {
        sender = "";
      }
      let recipientEmails = [];
      try {
        if (typeof view.getRecipients === "function") {
          recipientEmails = emailsFromInboxSdkContactValue(view.getRecipients());
        } else if (typeof view.getRecipientEmailAddresses === "function") {
          recipientEmails = normalizeEmailList(view.getRecipientEmailAddresses());
        }
      } catch (_) {
        recipientEmails = [];
      }
      let date = "";
      try {
        if (typeof view.getDateString === "function") {
          date = normalize(view.getDateString() || "");
        }
      } catch (_) {
        date = "";
      }
      let bodyText = "";
      let bodyHtml = "";
      try {
        const bodyElement = typeof view.getBodyElement === "function" ? view.getBodyElement() : null;
        if (bodyElement instanceof HTMLElement) {
          bodyHtml = bodyElement.innerHTML || "";
          bodyText = normalize(bodyElement.innerText || bodyElement.textContent || "");
        }
      } catch (_) {
        bodyText = "";
        bodyHtml = "";
      }
      const cleanedBody = cleanThreadMessageBody(bodyText, bodyHtml);
      if (!hasUsefulBodyText(cleanedBody)) continue;
      extracted.push({
        sender: sender || "Unknown sender",
        senderEmail: extractEmail(sender || ""),
        recipientEmails,
        date,
        dataMessageId,
        bodyHtml: "",
        bodyText: cleanedBody,
        sourceType: "captured"
      });
    }

    const normalized = normalizeThreadMessagesForChat(extracted, canonicalTid);
    if (normalized.length === 0) return [];
    setInboxSdkThreadMessages(canonicalTid, normalized);
    return normalized;
  }

  async function waitForInboxSdkThreadMessages(threadId, timeoutMs = 1200) {
    const canonicalTid = inboxSdkCacheKeyForThread(threadId);
    if (!canonicalTid) return [];
    const existing = getInboxSdkThreadMessages(canonicalTid);
    if (existing.length > 0) return existing;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const cached = getInboxSdkThreadMessages(canonicalTid);
      if (cached.length > 0) return cached;
      const view = state.inboxSdkThreadViewById[canonicalTid];
      if (view && typeof view === "object") {
        try {
          const snapshot = await snapshotInboxSdkThreadView(view);
          if (snapshot.length > 0) return snapshot;
        } catch (_) {
          // ignore; continue polling cache
        }
      }
      await sleep(120);
    }
    return getInboxSdkThreadMessages(canonicalTid);
  }

  async function ensureInboxSdkReady() {
    if (state.inboxSdkReady && state.inboxSdkInstance) return state.inboxSdkInstance;
    if (state.inboxSdkLoadPromise) return state.inboxSdkLoadPromise;
    if (!window.InboxSDK || typeof window.InboxSDK.load !== "function") {
      return null;
    }
    state.inboxSdkLoadPromise = window.InboxSDK.load(2, INBOX_SDK_APP_ID, {
      eventTracking: false,
      globalErrorLogging: false
    }).then((sdk) => {
      if (!sdk || !sdk.Conversations || typeof sdk.Conversations.registerThreadViewHandler !== "function") {
        state.inboxSdkReady = false;
        return null;
      }
      state.inboxSdkInstance = sdk;
      state.inboxSdkReady = true;
      sdk.Conversations.registerThreadViewHandler((threadView) => {
        (async () => {
          try {
            const tid = normalize(
              typeof threadView.getThreadIDAsync === "function"
                ? await threadView.getThreadIDAsync()
                : (typeof threadView.getThreadID === "function" ? threadView.getThreadID() : "")
            );
            const canonicalTid = inboxSdkCacheKeyForThread(tid);
            if (canonicalTid) {
              state.inboxSdkThreadViewById[canonicalTid] = threadView;
            }
            await snapshotInboxSdkThreadView(threadView);
            if (typeof threadView.on === "function") {
              threadView.on("destroy", () => {
                if (canonicalTid && state.inboxSdkThreadViewById[canonicalTid] === threadView) {
                  delete state.inboxSdkThreadViewById[canonicalTid];
                }
              });
            }
          } catch (_) {
            // ignore thread handler extraction errors
          }
        })();
      });
      return sdk;
    }).catch((error) => {
      state.inboxSdkReady = false;
      logWarn(`InboxSDK initialization failed: ${normalize(error && error.message ? error.message : String(error || ""))}`);
      return null;
    }).finally(() => {
      if (!state.inboxSdkReady) {
        state.inboxSdkInstance = null;
      }
      state.inboxSdkLoadPromise = null;
    });
    return state.inboxSdkLoadPromise;
  }

  function cleanThreadMessageBody(rawText, rawHtml) {
    const temp = document.createElement("div");
    temp.innerHTML = rawHtml || "";
    temp.querySelectorAll("script, style, meta, link, iframe, object, embed").forEach((el) => el.remove());
    temp.querySelectorAll(".gmail_quote, .gmail_attr, blockquote").forEach((el) => el.remove());
    const htmlText = temp.innerText || temp.textContent || "";

    const textSource = String(rawText || "").trim();
    const htmlSource = String(htmlText || "").trim();
    let text = textSource || htmlSource;
    if (htmlSource && (!text || /^on\s.+\swrote:/i.test(text) || text.length > htmlSource.length * 1.6)) {
      text = htmlSource;
    }
    if (!text) return "";

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const markerPatterns = [
      /\bOn\s.+\swrote:\s*/i,
      /^\s*From:\s.+$/im,
      /^\s*Sent:\s.+$/im,
      /^\s*To:\s.+$/im,
      /^\s*Subject:\s.+$/im,
      /^-{2,}\s*Forwarded message\s*-{2,}/im
    ];
    let markerIndex = -1;
    for (const pattern of markerPatterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      if (markerIndex === -1 || match.index < markerIndex) {
        markerIndex = match.index;
      }
    }
    if (markerIndex >= 0) {
      text = text.slice(0, markerIndex).trim();
    }

    const lines = text.split("\n");
    const kept = [];
    for (const rawLine of lines) {
      if (rawLine.trimStart().startsWith(">")) break;
      const line = rawLine.trim();
      if (!line) {
        if (kept.length === 0 || kept[kept.length - 1] === "") continue;
        kept.push("");
        continue;
      }
      kept.push(line);
    }

    const dedupedAdjacent = [];
    for (const line of kept) {
      const prev = dedupedAdjacent[dedupedAdjacent.length - 1];
      if (
        typeof prev === "string"
        && prev !== ""
        && line !== ""
        && prev.toLowerCase() === line.toLowerCase()
      ) {
        continue;
      }
      if (line === "" && prev === "") continue;
      dedupedAdjacent.push(line);
    }

    return dedupedAdjacent.join("\n").trim();
  }

  function isLikelyMetadataBlob(text) {
    const value = normalize(text || "");
    if (!value) return false;
    const lower = value.toLowerCase();
    const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
    const hasDate = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(value);
    const hasTime = /\b\d{1,2}:\d{2}\s?(?:am|pm)\b/i.test(lower);
    const hasAgo = /\(\d+\s+(?:minute|hour|day|week|month)s?\s+ago\)/i.test(value);
    const hasWriteHeader = /\bon .+ wrote:\b/i.test(lower);
    const repeatedPhrase = /(.*\b.{12,}\b).*\1/i.test(value);
    if (hasWriteHeader) return true;
    if (hasAgo && hasTime) return true;
    if (hasEmail && (hasDate || hasTime || hasAgo)) return true;
    if (hasDate && hasTime && value.length > 120) return true;
    if (repeatedPhrase && (hasDate || hasTime)) return true;
    return false;
  }

  function safeThreadFallbackText(text) {
    const cleaned = cleanThreadMessageBody(text || "", "");
    if (!cleaned) return "";
    const stripped = cleaned.replace(/^\s*[-*]+\s+/, "").trim();
    if (!stripped) return "";
    if (isLikelyMetadataBlob(stripped)) return "";
    return stripped;
  }

  function normalizeMessageDateToken(value) {
    const raw = normalize(value || "").toLowerCase();
    if (!raw) return "";
    return raw
      .replace(/[(),]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseThreadTimestampForOrder(value) {
    const raw = normalize(value || "");
    if (!raw) return 0;
    const hasExplicitYear = /\b\d{4}\b/.test(raw) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(raw);
    if (!hasExplicitYear) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildFallbackMessageKey(message, threadId = "", sourceIndex = 0) {
    const msg = message && typeof message === "object" ? message : {};
    const thread = canonicalThreadId(threadId || msg.threadId || "");
    const sender = normalize(msg.senderEmail || msg.sender || "").toLowerCase();
    const dateToken = normalizeMessageDateToken(msg.date || "");
    const sourceType = normalize(msg.sourceType || (msg.isOptimistic ? "optimistic" : "fallback")) || "fallback";
    const body = normalize(msg.cleanBodyText || msg.bodyText || "");
    const bodyHash = hashString(body.toLowerCase());
    const stableSourceIndex = Number.isFinite(Number(sourceIndex)) ? Number(sourceIndex) : 0;
    return `fb:${thread}:${sender}:${dateToken}:${bodyHash}:${sourceType}:${stableSourceIndex}`;
  }

  function messageSourceForChat(sourceType) {
    const source = normalize(sourceType || "").toLowerCase();
    if (source === "captured") return "gmail_dom";
    if (source === "fallback" || source === "seeded") return "cache";
    return "inferred";
  }

  function buildThreadMessageKey(message, index = 0, threadId = "", sourceIndex = 0) {
    const existing = normalize(message && message.messageKey);
    if (existing) return existing;
    const dataMessageId = normalize(message && (message.messageId || message.dataMessageId));
    if (dataMessageId) return `mid:${dataMessageId}`;
    if (normalize(message && message.clientSendId)) {
      return `opt:${normalize(message.clientSendId)}`;
    }
    return buildFallbackMessageKey(message, threadId, sourceIndex || index);
  }

  function normalizeThreadMessageForChat(message, context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const threadId = canonicalThreadId(context.threadId || msg.threadId || "") || normalize(context.threadId || msg.threadId || "");
    const sender = normalize(msg.sender || "") || "Unknown sender";
    const cleanedBody = cleanThreadMessageBody(msg.bodyText || "", msg.bodyHtml || "");
    const bodyText = cleanedBody || normalize(msg.bodyText || "") || THREAD_NO_CONTENT;
    const direction = normalize(context.direction || msg.direction || "");
    const sourceType = normalize(context.sourceType || msg.sourceType || "")
      || (
        msg.isOptimistic ? "optimistic"
          : (msg.isSeededPlaceholder ? "seeded" : (normalize(msg.dataMessageId || "") ? "captured" : "fallback"))
      );
    const deliveryState = normalize(msg.deliveryState || msg.optimisticStatus || (msg.isOptimistic ? "pending" : ""));
    const clientSendId = normalize(msg.clientSendId || "");
    const sourceIndex = Number.isFinite(Number(context.sourceIndex || msg.sourceIndex))
      ? Number(context.sourceIndex || msg.sourceIndex)
      : Number(context.index || 0);
    const explicitTimestamp = Number(msg.timestampMs || msg.optimisticAt || msg.optimisticDeliveredAt || msg.optimisticFailedAt || 0);
    const timestampMs = explicitTimestamp > 0 ? explicitTimestamp : parseThreadTimestampForOrder(msg.date || "");
    const conversationContext = activeConversationContext({
      ...context,
      activeAccountEmail: context.activeAccountEmail || msg.activeAccountEmail || state.activeAccountEmail,
      contactEmail: context.contactEmail || msg.contactEmail || state.activeContactEmail,
      conversationKey: context.conversationKey || msg.conversationKey || state.activeConversationKey
    });
    const parties = messagePartySnapshot(
      {
        ...msg,
        sender
      },
      conversationContext
    );
    const senderEmail = parties.senderEmail || extractEmail(msg.senderEmail || sender);
    const recipientEmails = parties.recipientEmails || [];
    const participants = parties.participants || [];
    const conversationKey = normalize(
      context.conversationKey
      || msg.conversationKey
      || conversationContext.conversationKey
      || conversationKeyFromContact(conversationContext.contactEmail || "")
    );
    const messageId = normalize(msg.messageId || msg.dataMessageId || "");
    const status = deliveryState || "";
    const messageKey = buildThreadMessageKey(
      {
        ...msg,
        sender,
        senderEmail,
        recipientEmails,
        participants,
        conversationKey,
        messageId,
        cleanBodyText: bodyText,
        sourceType,
        clientSendId
      },
      Number(context.index || 0),
      threadId,
      sourceIndex
    );
    return {
      ...msg,
      threadId,
      sender,
      senderEmail,
      recipientEmails,
      participants,
      messageId,
      id: normalize(msg.id || messageKey) || messageKey,
      conversationKey,
      cleanBodyText: bodyText,
      bodyText,
      bodyHtml: "",
      messageKey,
      sourceType,
      source: messageSourceForChat(sourceType),
      clientSendId: clientSendId || "",
      deliveryState: status,
      status,
      timestampMs,
      sourceIndex,
      isOptimistic: sourceType === "optimistic" || Boolean(msg.isOptimistic),
      direction: direction || classifyMessageDirection(
        { ...msg, sender, senderEmail, recipientEmails, participants },
        threadId,
        conversationContext
      ) || "unknown"
    };
  }

  function normalizeThreadMessagesForChat(messages, threadId = "", context = {}) {
    const out = [];
    const seenKeys = new Set();
    for (let i = 0; i < (Array.isArray(messages) ? messages.length : 0); i += 1) {
      const next = normalizeThreadMessageForChat(messages[i], { ...context, threadId, index: i, sourceIndex: i });
      const key = normalize(next.messageKey || "");
      if (key && seenKeys.has(key)) continue;
      if (key) seenKeys.add(key);
      out.push(next);
    }
    const canonicalByThread = new Set(
      out
        .filter((msg) => !msg.isSeededPlaceholder && msg.sourceType !== "seeded")
        .map((msg) => canonicalThreadId(msg.threadId || threadId))
        .filter(Boolean)
    );
    return out.filter((msg) => {
      if (!msg.isSeededPlaceholder && msg.sourceType !== "seeded") return true;
      const key = canonicalThreadId(msg.threadId || threadId);
      return !key || !canonicalByThread.has(key);
    });
  }

  function optimisticStoreKeyForThread(threadId) {
    const key = canonicalThreadId(threadId);
    return normalize(key || threadId || "");
  }

  function replyDraftStoreKey(threadId) {
    return optimisticStoreKeyForThread(threadId);
  }

  function getReplyDraft(threadId) {
    const key = replyDraftStoreKey(threadId);
    if (!key) return "";
    return normalize(state.replyDraftByThread[key] || "") ? state.replyDraftByThread[key] : "";
  }

  function setReplyDraft(threadId, text) {
    const key = replyDraftStoreKey(threadId);
    if (!key) return;
    const value = String(text || "");
    if (!normalize(value)) {
      delete state.replyDraftByThread[key];
      return;
    }
    state.replyDraftByThread[key] = value;
  }

  function getOptimisticMessagesForThread(threadId) {
    const key = optimisticStoreKeyForThread(threadId);
    if (!key) return [];
    const list = state.optimisticMessagesByThread[key];
    return Array.isArray(list) ? list.slice() : [];
  }

  function setOptimisticMessagesForThread(threadId, messages) {
    const key = optimisticStoreKeyForThread(threadId);
    if (!key) return;
    const next = Array.isArray(messages) ? messages.filter((m) => m && typeof m === "object") : [];
    if (next.length === 0) {
      delete state.optimisticMessagesByThread[key];
      return;
    }
    state.optimisticMessagesByThread[key] = next;
  }

  function ensureContactThreadTracked(threadId) {
    const canonical = canonicalThreadId(threadId || "") || normalize(threadId || "");
    if (!canonical) return;
    if (!Array.isArray(state.contactThreadIds)) {
      state.contactThreadIds = [canonical];
      return;
    }
    const exists = state.contactThreadIds.some((value) => {
      const next = canonicalThreadId(value || "") || normalize(value || "");
      return next === canonical;
    });
    if (!exists) {
      state.contactThreadIds.push(canonical);
      logChatDebug("contact-chat:thread-appended", {
        addedThreadId: canonical,
        totalThreads: state.contactThreadIds.length,
        conversationKey: normalize(state.activeConversationKey || "")
      }, { throttleKey: `contact-thread-appended:${canonical}`, throttleMs: 500 });
    }
  }

  function formatTimeForMessageDate(timestampMs) {
    const ts = Number(timestampMs || 0);
    if (ts > 0) {
      try {
        return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } catch (_) {
        // ignore locale formatting errors
      }
    }
    return "";
  }

  function appendLocalSentCacheEntry(threadId, bodyText, context = {}, timestampMs = Date.now(), hintHref = "") {
    const canonical = canonicalThreadId(threadId || "") || normalize(threadId || "");
    const text = normalize(bodyText || "");
    if (!canonical || !text) return;
    const conversationContext = activeConversationContext(context);
    const accountEmail = extractEmail(conversationContext.activeAccountEmail || detectCurrentUserEmail() || "");
    const contactEmail = extractEmail(conversationContext.contactEmail || activeConversationContactEmail() || "");
    const dateLabel = formatTimeForMessageDate(timestampMs);
    const subjectFallback = contactEmail ? `Chat with ${contactEmail}` : "Sent message";
    const entry = {
      threadId: canonical,
      sender: accountEmail || "You",
      senderEmail: accountEmail || "",
      recipientEmails: contactEmail ? [contactEmail] : [],
      subject: subjectFallback,
      snippet: text.slice(0, 220),
      bodyText: text,
      date: dateLabel,
      href: normalize(hintHref || lookupThreadHintHref(canonical) || threadHashForMailbox("sent", canonical, hintHref || "")),
      row: null,
      triageLevel: "",
      unread: false,
      mailbox: "sent"
    };
    mergeMailboxCache("sent", [entry]);
    logChatDebug("sent-cache:append-local", {
      threadId: canonical,
      contactEmail,
      activeAccountEmail: accountEmail,
      snippetLen: entry.snippet.length
    }, { throttleKey: `sent-cache-append:${canonical}`, throttleMs: 500 });
  }

  function appendOptimisticOutgoingMessage(text, threadId) {
    const body = cleanThreadMessageBody(text || "", "");
    if (!body) return null;
    const canonicalThreadIdForMessage = canonicalThreadId(threadId || "") || normalize(threadId || "");
    if (!canonicalThreadIdForMessage) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const clientSendId = `cs:${nowMs}:${hashString(`${canonicalThreadIdForMessage}|${body}|${Math.random()}`)}`;
    const userEmail = detectCurrentUserEmail();
    const optimistic = normalizeThreadMessageForChat({
      threadId: canonicalThreadIdForMessage,
      sender: userEmail || "You",
      senderEmail: userEmail || "",
      date: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      bodyText: body,
      messageKey: `opt:${clientSendId}`,
      clientSendId,
      isOptimistic: true,
      sourceType: "optimistic",
      deliveryState: "pending",
      optimisticStatus: "pending",
      optimisticAt: nowMs,
      direction: "outgoing"
    }, { threadId: canonicalThreadIdForMessage, direction: "outgoing" });
    const current = getOptimisticMessagesForThread(canonicalThreadIdForMessage);
    current.push(optimistic);
    setOptimisticMessagesForThread(canonicalThreadIdForMessage, current);
    return optimistic;
  }

  function removeOptimisticMessage(threadId, messageKey) {
    const key = normalize(messageKey || "");
    if (!key) return;
    const current = getOptimisticMessagesForThread(threadId);
    const next = current.filter((item) => normalize(item && item.messageKey) !== key);
    setOptimisticMessagesForThread(threadId, next);
  }

  function markOptimisticMessageDelivered(threadId, messageKey) {
    const key = normalize(messageKey || "");
    if (!key) return;
    const current = getOptimisticMessagesForThread(threadId);
    const next = current.map((item) => (
      normalize(item && item.messageKey) === key
        ? { ...item, deliveryState: "sent", optimisticStatus: "sent", optimisticDeliveredAt: Date.now() }
        : item
    ));
    setOptimisticMessagesForThread(threadId, next);
  }

  function markOptimisticMessageFailed(threadId, messageKey) {
    const key = normalize(messageKey || "");
    if (!key) return;
    const current = getOptimisticMessagesForThread(threadId);
    const next = current.map((item) => (
      normalize(item && item.messageKey) === key
        ? { ...item, deliveryState: "failed", optimisticStatus: "failed", optimisticFailedAt: Date.now() }
        : item
    ));
    setOptimisticMessagesForThread(threadId, next);
  }

  function updateOptimisticInMergedMessages(threadId, messageKey, patch = null) {
    if (!Array.isArray(state.mergedMessages) || state.mergedMessages.length === 0) return;
    const canonicalTarget = canonicalThreadId(threadId);
    const key = normalize(messageKey || "");
    if (!key) return;
    let changed = false;
    state.mergedMessages = state.mergedMessages
      .map((msg) => {
        if (!msg || typeof msg !== "object") return msg;
        if (canonicalThreadId(msg.threadId || "") !== canonicalTarget) return msg;
        if (normalize(msg.messageKey || "") !== key) return msg;
        changed = true;
        if (!patch) return null;
        return { ...msg, ...patch };
      })
      .filter(Boolean);
    if (!changed) return;
  }

  function mergeOptimisticIntoMessages(messages, threadId) {
    const list = Array.isArray(messages) ? messages.slice() : [];
    const optimistic = getOptimisticMessagesForThread(threadId);
    if (optimistic.length === 0) return list;
    const existingKeys = new Set(
      list.map((msg) => normalize(msg && msg.messageKey)).filter(Boolean)
    );
    const merged = list.slice();
    for (const item of optimistic) {
      const key = normalize(item && item.messageKey);
      if (key && existingKeys.has(key)) continue;
      merged.push(item);
    }
    return merged;
  }

  function reconcileOptimisticMessagesWithCanonical(threadId, canonicalMessages, preferredOptimistic = null) {
    const current = getOptimisticMessagesForThread(threadId);
    if (current.length === 0) return { changed: false, matchedKeys: [] };
    const outgoingCanonical = (Array.isArray(canonicalMessages) ? canonicalMessages : [])
      .filter((msg) => normalize(msg && msg.direction) === "outgoing")
      .map((msg) => ({
        hash: hashString(normalize(msg && msg.cleanBodyText).toLowerCase()),
        timestampMs: Number(msg && msg.timestampMs || 0),
        message: msg
      }))
      .filter((item) => Boolean(item.hash));

    if (outgoingCanonical.length === 0) return { changed: false, matchedKeys: [] };

    const preferredKey = normalize(preferredOptimistic && preferredOptimistic.messageKey);
    const pending = current.slice().sort((a, b) => Number(a.optimisticAt || 0) - Number(b.optimisticAt || 0));
    const matchedKeys = [];
    const usedPending = new Set();
    const now = Date.now();
    for (const item of outgoingCanonical) {
      const canonicalTs = item.timestampMs > 0 ? item.timestampMs : now;
      let candidateIndex = -1;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (let idx = 0; idx < pending.length; idx += 1) {
        if (usedPending.has(idx)) continue;
        const msg = pending[idx];
        const bodyHash = hashString(normalize(msg && msg.cleanBodyText).toLowerCase());
        if (bodyHash !== item.hash) continue;
        const optimisticTs = Number(msg && msg.optimisticAt || 0);
        const delta = optimisticTs > 0 ? Math.abs(canonicalTs - optimisticTs) : 0;
        if (optimisticTs > 0 && delta > OPTIMISTIC_RECONCILE_WINDOW_MS) continue;
        if (preferredKey && normalize(msg && msg.messageKey) === preferredKey) {
          candidateIndex = idx;
          bestDelta = -1;
          break;
        }
        if (delta < bestDelta) {
          bestDelta = delta;
          candidateIndex = idx;
        }
      }
      if (candidateIndex < 0) continue;
      usedPending.add(candidateIndex);
      const candidate = pending[candidateIndex];
      if (candidate && normalize(candidate.messageKey)) {
        matchedKeys.push(normalize(candidate.messageKey));
      }
    }

    if (matchedKeys.length === 0) return { changed: false, matchedKeys: [] };

    const matchedSet = new Set(matchedKeys);
    const next = current.filter((msg) => !matchedSet.has(normalize(msg && msg.messageKey)));
    setOptimisticMessagesForThread(threadId, next);
    return { changed: true, matchedKeys };
  }

  function groupedMessagesByThreadId(messages = []) {
    const byThread = new Map();
    for (const message of messages) {
      if (!message || typeof message !== "object") continue;
      const threadId = canonicalThreadId(message.threadId || "") || normalize(message.threadId || "");
      if (!threadId) continue;
      if (!byThread.has(threadId)) byThread.set(threadId, []);
      byThread.get(threadId).push({ ...message, threadId });
    }
    return byThread;
  }

  async function refreshActiveThreadAfterSend(threadId, mailbox, optimisticMessage) {
    const targetThreadId = normalize(threadId || "");
    if (!targetThreadId) return false;
    const targetCanonicalThreadId = canonicalThreadId(targetThreadId) || targetThreadId;
    const attempts = [180, 360, 620, 900, 1300];
    let matched = false;

    for (let i = 0; i < attempts.length; i += 1) {
      await sleep(attempts[i]);
      const extracted = extractOpenThreadData();
      const normalizedExtracted = normalizeThreadMessagesForChat(
        Array.isArray(extracted.messages) ? extracted.messages : [],
        targetThreadId,
        activeConversationContext()
      );
      const reconciliation = reconcileOptimisticMessagesWithCanonical(
        targetThreadId,
        normalizedExtracted,
        optimisticMessage
      );
      if (reconciliation.changed) {
        matched = true;
        for (const key of reconciliation.matchedKeys) {
          updateOptimisticInMergedMessages(targetThreadId, key, null);
        }
      }

      if (
        ENABLE_CONTACT_MERGE_MODE &&
        Array.isArray(state.contactThreadIds)
        && state.contactThreadIds.some((id) => (canonicalThreadId(id || "") || normalize(id || "")) === targetCanonicalThreadId)
      ) {
        const displayThreadIds = state.contactThreadIds
          .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
          .filter(Boolean)
          .reverse();
        const byThread = groupedMessagesByThreadId(state.mergedMessages);
        if (normalizedExtracted.length > 0) {
          byThread.set(
            targetCanonicalThreadId,
            normalizedExtracted.map((msg) => ({ ...msg, threadId: targetCanonicalThreadId }))
          );
          state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, byThread, activeConversationContext());
        }
      }

      const latestRoot = document.getElementById(ROOT_ID);
      if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
        renderThread(latestRoot);
      }
      if (matched) return true;
    }

    const latestRoot = document.getElementById(ROOT_ID);
    if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
      renderThread(latestRoot);
    }
    return false;
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

  function isThreadHash(hashValue = window.location.hash) {
    const hash = normalize(hashValue || "");
    if (!hash) return false;
    const clean = hash.split("?")[0];
    if (/^#thread-f:[A-Za-z0-9_-]+$/i.test(clean)) return true;
    return /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i.test(
      clean
    );
  }

  function threadIdFromHash(hash) {
    const raw = normalize(hash || window.location.hash || "");
    if (!raw) return "";
    const clean = raw.split("?")[0];
    const direct = clean.match(/^#((?:thread-)?f:[A-Za-z0-9_-]+)$/i);
    if (direct && direct[1]) return direct[1];
    const routed = clean.match(
      /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i
    );
    return routed && routed[1] ? routed[1] : "";
  }

  function normalizeThreadHashForMailbox(hashValue, mailbox = "inbox") {
    const clean = normalize((hashValue || "").split("?")[0] || "");
    if (!clean) return "";
    const box = mailboxCacheKey(mailbox || "inbox");
    const direct = clean.match(/^#((?:thread-)?f:[A-Za-z0-9_-]+)$/i);
    if (direct && direct[1]) {
      const raw = normalize(direct[1] || "");
      const routed = raw.startsWith("f:") ? `thread-${raw}` : raw;
      return `#${box}/${routed}`;
    }
    const routedMatch = clean.match(
      /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i
    );
    if (routedMatch && routedMatch[1]) {
      const raw = normalize(routedMatch[1] || "");
      const routed = raw.startsWith("f:") ? `thread-${raw}` : raw;
      return `#${box}/${routed}`;
    }
    return clean;
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

  function localReadKeysForThread(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return [];
    const canonical = canonicalThreadId(raw);
    const keys = [raw];
    if (canonical) {
      keys.push(canonical, `#${canonical}`);
      if (canonical.startsWith("f:")) {
        const suffix = canonical.slice(2);
        keys.push(`thread-f:${suffix}`, `#thread-f:${suffix}`);
      }
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function threadHintKeysForThread(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return [];
    const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
    const canonical = canonicalThreadId(noHash);
    const keys = [raw, noHash, `#${noHash}`];
    if (canonical) {
      keys.push(canonical, `#${canonical}`);
      if (canonical.startsWith("f:")) {
        const suffix = canonical.slice(2);
        keys.push(`thread-f:${suffix}`, `#thread-f:${suffix}`);
      }
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function rememberThreadNavigationHint(threadId, href = "", row = null) {
    const id = normalize(threadId || "");
    const link = normalize(href || "");
    if (!id && !link && !(row instanceof HTMLElement)) return;
    const keys = threadHintKeysForThread(id);
    if (keys.length === 0 && !link && !(row instanceof HTMLElement)) return;

    for (const key of keys) {
      if (link) {
        state.threadHintHrefByThreadId[key] = link;
      }
      if (row instanceof HTMLElement) {
        state.threadRowHintByThreadId[key] = row;
      }
    }
    if (!state.currentThreadHintHref && link && state.currentView === "thread") {
      state.currentThreadHintHref = link;
    }
  }

  function lookupThreadHintHref(threadId) {
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const href = normalize(state.threadHintHrefByThreadId[key] || "");
      if (href) return href;
    }
    return "";
  }

  function lookupThreadRowHint(threadId) {
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const row = state.threadRowHintByThreadId[key];
      if (row instanceof HTMLElement && row.isConnected) return row;
    }
    return null;
  }

  function hashFromHref(href) {
    const value = normalize(href || "");
    if (!value) return "";
    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) return normalize(value.slice(hashIndex).split("?")[0]);
    try {
      const url = new URL(value, window.location.origin);
      return normalize((url.hash || "").split("?")[0]);
    } catch (_) {
      return "";
    }
  }

  function threadContextSnapshot(threadId = "") {
    const main = getGmailMainRoot();
    const hash = normalize(window.location.hash || "");
    const hashThreadId = normalize(threadIdFromHash(hash));
    const hashThreadLike = isThreadHash(hash);
    let messageNodes = 0;
    let replyButtons = 0;
    let listRows = 0;
    if (main instanceof HTMLElement) {
      messageNodes = main.querySelectorAll("[data-message-id], .h7 .adn, .h7 .ii.gt, .adn.ads, .ii.gt").length;
      replyButtons = main.querySelectorAll('[gh="rr"], [data-tooltip*="Reply"], [aria-label*="Reply"]').length;
      listRows = main.querySelectorAll("tr.zA, [role='row'][data-thread-id], [role='row'][data-legacy-thread-id]").length;
    }
    const domReady = messageNodes > 0 || (hashThreadLike && replyButtons > 0 && listRows === 0);
    const expectedCanonical = canonicalThreadId(threadId);
    const hashCanonical = canonicalThreadId(hashThreadId || state.activeThreadId || "");
    const threadMatch = !expectedCanonical || !hashCanonical || expectedCanonical === hashCanonical;
    const ok = domReady && (hashThreadLike || replyButtons > 0) && threadMatch;
    return {
      ok,
      hash,
      hashThreadLike,
      hashThreadId,
      expectedThreadId: normalize(threadId || ""),
      threadMatch,
      dom: { messageNodes, replyButtons, listRows, domReady }
    };
  }

  async function waitForThreadContextForReply(threadId, timeoutMs = 3200) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const status = threadContextSnapshot(threadId);
      if (status.ok) return status;
      await sleep(120);
    }
    return threadContextSnapshot(threadId);
  }

  function buildThreadContextHashCandidates(threadId, mailbox, hintHref = "") {
    const out = [];
    const box = mailboxCacheKey(mailbox || "inbox");
    const hintedHash = normalizeThreadHashForMailbox(hashFromHref(hintHref), box);
    if (hintedHash && isThreadHash(hintedHash)) out.push(hintedHash);
    const preferred = threadHashForMailbox(box, threadId, hintHref);
    if (preferred && isThreadHash(preferred)) out.push(preferred);
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const noHash = key.startsWith("#") ? key.slice(1) : key;
      if (!noHash) continue;
      if (/^thread-f:[A-Za-z0-9_-]+$/i.test(noHash)) {
        out.push(`#${box}/${noHash}`);
        continue;
      }
      if (/^f:[A-Za-z0-9_-]+$/i.test(noHash)) {
        out.push(`#${box}/thread-${noHash}`);
        continue;
      }
      if (/^[A-Za-z0-9_-]{8,}$/.test(noHash)) out.push(`#${box}/${noHash}`);
    }
    return Array.from(new Set(out.map((value) => normalizeThreadHashForMailbox(value, box)).filter(Boolean)));
  }

  async function ensureThreadContextForReply(threadId, mailbox, hintHref = "") {
    const targetThreadId = normalize(threadId || "");
    const bestHint = normalize(hintHref || "") || lookupThreadHintHref(targetThreadId);
    const rowHint = lookupThreadRowHint(targetThreadId);
    const initial = threadContextSnapshot(targetThreadId);
    if (initial.ok) {
      return { ok: true, contextStep: "alreadyThreadContext", status: initial, tried: [] };
    }

    const tried = [];

    if (targetThreadId || bestHint || rowHint) {
      const clicked = openThread(targetThreadId, bestHint, rowHint);
      tried.push({ step: "openThread", fired: clicked });
      if (clicked) {
        const status = await waitForThreadContextForReply(targetThreadId, 3200);
        if (status.ok) {
          return { ok: true, contextStep: "openThread", status, tried };
        }
      }
    }

    const candidates = buildThreadContextHashCandidates(targetThreadId, mailbox, bestHint);
    for (const candidate of candidates) {
      window.location.hash = candidate;
      tried.push({ step: "hashNavigate", candidate });
      const status = await waitForThreadContextForReply(targetThreadId, 2200);
      if (status.ok) {
        return { ok: true, contextStep: "hashNavigate", status, tried, candidate };
      }
    }

    const finalStatus = threadContextSnapshot(targetThreadId);
    return {
      ok: false,
      contextStep: "thread-context-not-found",
      reason: "thread-context-not-found",
      status: finalStatus,
      tried
    };
  }

  function markThreadReadLocally(threadId, holdMs = LOCAL_READ_HOLD_MS) {
    const keys = localReadKeysForThread(threadId);
    if (keys.length === 0) return;
    const until = Date.now() + Math.max(1000, Number(holdMs) || LOCAL_READ_HOLD_MS);
    state.localReadUntilByThread = state.localReadUntilByThread || {};
    for (const key of keys) {
      state.localReadUntilByThread[key] = until;
    }
  }

  function isThreadMarkedReadLocally(threadId) {
    const keys = localReadKeysForThread(threadId);
    if (keys.length === 0) return false;
    const now = Date.now();
    const map = state.localReadUntilByThread || {};
    let marked = false;
    for (const key of keys) {
      const until = Number(map[key] || 0);
      if (!until) continue;
      if (until < now) {
        delete map[key];
        continue;
      }
      marked = true;
    }
    return marked;
  }

  function clearUnreadClassesInRow(row) {
    if (!(row instanceof HTMLElement)) return;
    row.classList.remove("zE");
    for (const node of row.querySelectorAll(".zE")) {
      if (node instanceof HTMLElement) node.classList.remove("zE");
    }
  }

  function markThreadsReadLocally(threadIds, rows = []) {
    const ids = Array.from(new Set((threadIds || []).map((id) => normalize(id)).filter(Boolean)));
    if (ids.length === 0) return;
    const canonicalIds = new Set(ids.map((id) => canonicalThreadId(id)).filter(Boolean));
    for (const id of ids) markThreadReadLocally(id);

    const rowCandidates = [];
    for (const row of rows || []) {
      if (row instanceof HTMLElement) rowCandidates.push(row);
    }
    for (const id of ids) {
      try {
        const escaped = CSS.escape(id);
        const byAttr = document.querySelector(`[data-thread-id="${escaped}"], [data-legacy-thread-id="${escaped}"]`);
        if (byAttr instanceof HTMLElement) rowCandidates.push(byAttr);
      } catch (_) { /* ignore invalid selector input */ }
    }
    for (const row of rowCandidates) {
      const targetRow = row.closest('[role="row"], tr, .zA, [data-thread-id], [data-legacy-thread-id]') || row;
      clearUnreadClassesInRow(targetRow);
    }

    for (const mailboxKey of Object.keys(state.scannedMailboxMessages || {})) {
      const list = state.scannedMailboxMessages[mailboxKey];
      if (!Array.isArray(list) || list.length === 0) continue;
      for (const msg of list) {
        const canonical = canonicalThreadId(msg && msg.threadId);
        if (!canonical || !canonicalIds.has(canonical)) continue;
        msg.unread = false;
      }
    }

    state.lastListSignature = "";
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
      const inboxProgress = state.mailboxScanProgress[mailboxCacheKey("inbox")] || {};
      const sentProgress = state.mailboxScanProgress[mailboxCacheKey("sent")] || {};
      const inboxCount = Number(inboxProgress.cachedCount || (state.scannedMailboxMessages.inbox || []).length || 0);
      const sentCount = Number(sentProgress.cachedCount || (state.scannedMailboxMessages.sent || []).length || 0);
      const summaryParts = [];
      if (inboxCount > 0 || state.fullScanCompletedByMailbox.inbox) summaryParts.push(`inbox ${inboxCount}`);
      if (sentCount > 0 || state.fullScanCompletedByMailbox.sent) summaryParts.push(`sent ${sentCount}`);
      const scanSummary = summaryParts.length > 0
        ? `Scan cache: ${summaryParts.join(" • ")}`
        : "Auto-scan loads inbox + sent pages in the background.";
      sideTriageMeta.innerHTML = `
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.triageStatus || "Auto-triage runs in the background.")}</div>
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.fullScanStatus || scanSummary)}</div>
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
        await runFullMailboxScan(root, { mailboxes: ["inbox"] });
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
    if (
      state.suspendHashSyncDuringContactHydration &&
      state.currentView === "thread" &&
      normalize(state.activeContactKey || "")
    ) {
      return;
    }

    if (state.replySendInProgress && state.currentView === "thread") {
      return;
    }

    if (state.settingsPinned) {
      state.currentView = "settings";
      return;
    }

    if (isAppSettingsHash()) {
      state.settingsPinned = true;
      state.currentView = "settings";
      return;
    }

    const rawHash = normalize(window.location.hash || "");
    if (/^#(?:thread-)?f:[A-Za-z0-9_-]+$/i.test(rawHash)) {
      const listMailbox = mailboxCacheKey(mailboxKeyFromHash(state.lastListHash || "#inbox"));
      const normalizedThreadHash = normalizeThreadHashForMailbox(rawHash, listMailbox);
      if (normalizedThreadHash && normalizedThreadHash !== rawHash) {
        window.location.hash = normalizedThreadHash;
        return;
      }
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
      const previousThreadId = canonicalThreadId(state.activeThreadId || "") || normalize(state.activeThreadId || "");
      const nextThreadIdRaw = threadIdFromHash(window.location.hash) || state.activeThreadId;
      const nextThreadId = canonicalThreadId(nextThreadIdRaw || "") || normalize(nextThreadIdRaw || "");
      state.activeThreadId = nextThreadIdRaw;
      if (nextThreadId && nextThreadId !== previousThreadId) {
        state.threadExtractRetry = 0;
      }
    } else {
      state.activeThreadId = "";
      state.currentThreadIdForReply = "";
      state.currentThreadHintHref = "";
      state.currentThreadMailbox = "";
      clearContactConversationState();
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

  function normalizeReplyResult(result) {
    if (typeof result === "boolean") {
      return { ok: result, stage: result ? "legacy-ok" : "legacy-failed", reason: "" };
    }
    if (!result || typeof result !== "object") {
      return { ok: false, stage: "invalid-result", reason: "non-object-result" };
    }
    const stage = normalize(result.stage || "") || "unknown";
    const reason = normalize(result.reason || "");
    return {
      ok: Boolean(result.ok),
      stage,
      reason
    };
  }

  function isLikelyHashThreadId(threadId) {
    const id = normalize(threadId || "");
    if (!id) return false;
    if (id.startsWith("f:") || id.startsWith("thread-f:") || id.startsWith("synthetic-")) return false;
    if (id.includes(":")) return false;
    return /^[A-Za-z0-9_-]{8,}$/.test(id);
  }

  async function submitThreadReply(root) {
    if (state.replySendInProgress) {
      logChatDebug("reply:submit-skip", {
        reason: "already-in-progress",
        hash: normalize(window.location.hash || "")
      }, { throttleKey: "reply-submit-skip:in-progress", throttleMs: 900 });
      return;
    }
    const input = root.querySelector(".rv-thread-input");
    if (!(input instanceof HTMLInputElement)) {
      logChatDebug("reply:submit-skip", {
        reason: "input-not-found"
      }, { throttleKey: "reply-submit-skip:input-not-found", throttleMs: 1200 });
      return;
    }
    const text = (input.value || "").trim();
    if (!text) {
      logChatDebug("reply:submit-skip", {
        reason: "empty-text"
      }, { throttleKey: "reply-submit-skip:empty-text", throttleMs: 700 });
      return;
    }
    if (!window.ReskinCompose || typeof window.ReskinCompose.replyToThread !== "function") {
      logWarn("ReskinCompose.replyToThread not available");
      logChatDebug("reply:submit-skip", {
        reason: "compose-bridge-missing"
      }, { throttleKey: "reply-submit-skip:compose-missing", throttleMs: 1200 });
      return;
    }

    const route = parseListRoute(state.lastListHash || window.location.hash || "#inbox");
    const mailbox = normalize(state.currentThreadMailbox || route.mailbox || "inbox") || "inbox";
    const fallbackContactThreadId = Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0
      ? (canonicalThreadId(state.contactThreadIds[0] || "") || normalize(state.contactThreadIds[0] || ""))
      : "";
    const hashThreadId = normalize(threadIdFromHash(window.location.hash || ""));
    const threadId = normalize(
      state.currentThreadIdForReply ||
      hashThreadId ||
      state.activeThreadId ||
      fallbackContactThreadId
    );
    const targetThreadId = canonicalThreadId(hashThreadId || threadId || state.activeThreadId || fallbackContactThreadId || "")
      || normalize(hashThreadId || threadId || state.activeThreadId || fallbackContactThreadId || "");
    if (!targetThreadId) {
      logChatDebug("reply:submit-skip", {
        reason: "thread-id-missing",
        mailbox,
        hashThreadId,
        fallbackContactThreadId
      }, { throttleKey: "reply-submit-skip:thread-missing", throttleMs: 900 });
      return;
    }
    const conversationContext = activeConversationContext();
    const replyDraftThreadId = canonicalThreadId(targetThreadId || state.currentThreadIdForReply || state.activeThreadId || "")
      || normalize(targetThreadId || state.currentThreadIdForReply || state.activeThreadId || "");
    const threadHintHref = normalize(state.currentThreadHintHref || "") || lookupThreadHintHref(targetThreadId);
    const previousSuspendHydration = state.suspendHashSyncDuringContactHydration;
    const sendBtn = root.querySelector(".rv-thread-send");
    let failureStage = "";
    let successStageLabel = "";
    const priorInputValue = input.value || "";
    const inputWasFocused = document.activeElement === input;
    const timing = {
      startedAt: Date.now(),
      contextDurationMs: 0,
      sendDurationMs: 0,
      optimisticVisibleAtMs: 0
    };
    let optimisticMessage = null;

    state.replySendInProgress = true;
    state.suspendHashSyncDuringContactHydration = true;
    if (sendBtn instanceof HTMLElement) {
      sendBtn.textContent = "Sending...";
      sendBtn.setAttribute("disabled", "true");
    }

    try {
      detectCurrentUserEmail(true);
      logChatDebug("reply:submit-start", {
        threadId: targetThreadId,
        mailbox,
        textLength: text.length,
        conversationKey: conversationContext.conversationKey || "",
        contactEmail: conversationContext.contactEmail || "",
        activeAccountEmail: conversationContext.activeAccountEmail || ""
      }, { throttleKey: `reply-submit-start:${targetThreadId}`, throttleMs: 200 });
      optimisticMessage = appendOptimisticOutgoingMessage(text, targetThreadId);
      if (optimisticMessage) {
        timing.optimisticVisibleAtMs = Date.now();
        input.value = "";
        setReplyDraft(replyDraftThreadId, "");
        if (ENABLE_CONTACT_MERGE_MODE) {
          ensureContactThreadTracked(targetThreadId);
        }
        if (ENABLE_CONTACT_MERGE_MODE && Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0) {
          const displayThreadIds = state.contactThreadIds
            .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
            .filter(Boolean)
            .reverse();
          const byThread = groupedMessagesByThreadId(state.mergedMessages);
          const existing = Array.isArray(byThread.get(targetThreadId)) ? byThread.get(targetThreadId).slice() : [];
          existing.push(optimisticMessage);
          byThread.set(targetThreadId, existing);
          state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, byThread, activeConversationContext());
        }
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          renderThread(latestRoot);
        }
      }

      let preflightContext = { ok: false, reason: "", contextStep: "", tried: [] };
      const contextStartedAt = Date.now();
      const context = await ensureThreadContextForReply(targetThreadId, mailbox, threadHintHref);
      timing.contextDurationMs = Date.now() - contextStartedAt;
      preflightContext = context && typeof context === "object" ? context : preflightContext;
      const delegateContextToCompose = !Boolean(preflightContext.ok);
      if (!context.ok) {
        logWarn(
          `Reply preflight context missing; delegating to compose context recovery. reason=${context.reason || "thread-context-not-found"} threadId=${targetThreadId || ""} mailbox=${mailbox || ""}`
        );
        logChatDebug("reply:preflight-context-miss", {
          threadId: targetThreadId,
          mailbox,
          reason: context.reason || "thread-context-not-found",
          contextStep: context.contextStep || "",
          tried: Array.isArray(context.tried) ? context.tried.slice(0, 8) : [],
          timing
        }, { throttleKey: `reply-preflight-miss:${targetThreadId}`, throttleMs: 250 });
      }

      const sendStartedAt = Date.now();
      const rawResult = await window.ReskinCompose.replyToThread(text, {
        threadId: targetThreadId,
        mailbox,
        forceThreadContext: delegateContextToCompose,
        threadHintHref,
        timeoutMs: 12000,
        conversationKey: conversationContext.conversationKey || "",
        contactEmail: conversationContext.contactEmail || "",
        activeAccountEmail: conversationContext.activeAccountEmail || ""
      });
      timing.sendDurationMs = Date.now() - sendStartedAt;
      const result = normalizeReplyResult(rawResult);
      logChatDebug("reply:submit-result", {
        threadId: targetThreadId,
        mailbox,
        result,
        forceThreadContext: delegateContextToCompose,
        preflightOk: Boolean(preflightContext.ok),
        timing
      }, { throttleKey: `reply-submit-result:${targetThreadId}`, throttleMs: 180 });
      if (result.ok) {
        const likelyStage = /^sendLikely/i.test(normalize(result.stage || ""));
        successStageLabel = likelyStage ? "Sent (syncing)" : "Sent";
        setReplyDraft(replyDraftThreadId, "");
        if (optimisticMessage) {
          markOptimisticMessageDelivered(targetThreadId, optimisticMessage.messageKey);
          updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
            deliveryState: "sent",
            optimisticStatus: "sent",
            optimisticDeliveredAt: Date.now(),
            optimisticUnverifiedAt: likelyStage ? Date.now() : 0
          });
        }
        appendLocalSentCacheEntry(
          targetThreadId,
          text,
          conversationContext,
          Date.now(),
          threadHintHref
        );
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          renderThread(latestRoot);
        }
        refreshActiveThreadAfterSend(targetThreadId, mailbox, optimisticMessage).catch((error) => {
          logWarn("Post-send thread refresh failed", error);
        });
      } else {
        failureStage = result.stage || "failed";
        setReplyDraft(replyDraftThreadId, priorInputValue || text);
        if (optimisticMessage) {
          markOptimisticMessageFailed(targetThreadId, optimisticMessage.messageKey);
          updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
            deliveryState: "failed",
            optimisticStatus: "failed",
            optimisticFailedAt: Date.now()
          });
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
            renderThread(latestRoot);
          }
        }
        const debugSnapshot = window.ReskinCompose && typeof window.ReskinCompose.getLastReplyDebug === "function"
          ? window.ReskinCompose.getLastReplyDebug()
          : null;
        logWarn(
          `Reply failed stage=${result.stage || "unknown"} reason=${result.reason || ""} threadId=${targetThreadId || ""} mailbox=${mailbox || ""}`
        );
        if (debugSnapshot) {
          const snapshot = { ...debugSnapshot, ...timing };
          logWarn("Reply debug snapshot", snapshot);
          try {
            logWarn(`Reply debug snapshot JSON ${JSON.stringify(snapshot)}`);
          } catch (_) {
            // ignore
          }
        } else {
          logWarn("Reply timing snapshot", timing);
        }
      }
    } catch (err) {
      failureStage = "exception";
      setReplyDraft(replyDraftThreadId, priorInputValue || text);
      if (optimisticMessage) {
        markOptimisticMessageFailed(targetThreadId, optimisticMessage.messageKey);
        updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
          deliveryState: "failed",
          optimisticStatus: "failed",
          optimisticFailedAt: Date.now()
        });
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          renderThread(latestRoot);
        }
      }
      logWarn("Reply error", err);
      const debugSnapshot = window.ReskinCompose && typeof window.ReskinCompose.getLastReplyDebug === "function"
        ? window.ReskinCompose.getLastReplyDebug()
        : null;
      if (debugSnapshot) {
        const snapshot = { ...debugSnapshot, ...timing };
        logWarn("Reply debug snapshot", snapshot);
        try {
          logWarn(`Reply debug snapshot JSON ${JSON.stringify(snapshot)}`);
        } catch (_) {
          // ignore
        }
      } else {
        logWarn("Reply timing snapshot", timing);
      }
    } finally {
      state.replySendInProgress = false;
      state.suspendHashSyncDuringContactHydration = previousSuspendHydration;
      const liveInput = root.querySelector(".rv-thread-input");
      if (liveInput instanceof HTMLInputElement) {
        if (failureStage) {
          if (!normalize(liveInput.value || "")) {
            liveInput.value = priorInputValue || text;
          }
          setReplyDraft(replyDraftThreadId, liveInput.value || priorInputValue || text);
        } else {
          setReplyDraft(replyDraftThreadId, liveInput.value || "");
        }
        if (inputWasFocused) liveInput.focus();
      }
      const liveSendBtn = root.querySelector(".rv-thread-send");
      if (liveSendBtn instanceof HTMLElement) {
        liveSendBtn.removeAttribute("disabled");
        if (failureStage) {
          liveSendBtn.textContent = `Retry (${failureStage})`;
          setTimeout(() => {
            if (liveSendBtn.isConnected) liveSendBtn.textContent = "Send";
          }, 1500);
        } else {
          liveSendBtn.textContent = successStageLabel || "Send";
          if (successStageLabel) {
            setTimeout(() => {
              if (liveSendBtn.isConnected) liveSendBtn.textContent = "Send";
            }, 1200);
          }
        }
      }
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
        state.currentThreadIdForReply = "";
        state.currentThreadHintHref = "";
        state.currentThreadMailbox = "";
        clearContactConversationState();
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
        submitThreadReply(root);
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
        clearContactConversationState();
        state.currentThreadMailbox = "";
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
        clearContactConversationState();
        state.currentThreadMailbox = "";
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
        clearContactConversationState();
        state.currentThreadMailbox = "";
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
      state.currentThreadMailbox = "";
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
    const id = canonicalThreadId(threadId || "") || normalize(threadId || "");
    const link = hashFromHref(href || "") || normalize(href || "");
    return `${id}|${link}`;
  }

  function extractSender(row) {
    const threadSpecificSelectors = [
      ".gD[email]",
      ".gD[data-hovercard-id]",
      ".gD",
      "h3 .gD[email]",
      "h3 [email][name]",
      ".go [email]",
      ".go [data-hovercard-id]"
    ];
    for (const selector of threadSpecificSelectors) {
      for (const node of Array.from(row.querySelectorAll(selector)).slice(0, 6)) {
        if (!(node instanceof HTMLElement)) continue;
        const email = extractEmail(
          node.getAttribute("email")
          || node.getAttribute("data-hovercard-id")
          || node.getAttribute("data-hovercard-owner-email")
          || node.getAttribute("name")
          || node.getAttribute("title")
          || node.getAttribute("aria-label")
          || node.textContent
        );
        if (!email) continue;
        const preferredName = normalize(
          node.getAttribute("name")
          || node.getAttribute("data-name")
          || node.getAttribute("title")
          || node.textContent
          || ""
        );
        if (preferredName && !isGenericSenderLabel(preferredName) && extractEmail(preferredName) !== email) {
          return `${preferredName} <${email}>`;
        }
        return email;
      }
    }

    const emailNodes = [
      ...Array.from(
        row.querySelectorAll(".yW span[email], .yW [email], .zA span[email], span[email], [data-hovercard-id][email], [data-hovercard-id]")
      ),
      row
    ];
    for (const node of emailNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const email = extractEmail(
        node.getAttribute("email") ||
        node.getAttribute("data-hovercard-id") ||
        node.getAttribute("title") ||
        node.getAttribute("aria-label")
      );
      if (!email) continue;
      const text = normalize(
        node.innerText ||
        node.textContent ||
        node.getAttribute("title") ||
        ""
      );
      if (isUseful(text) && !isGenericSenderLabel(text) && extractEmail(text) !== email) {
        return `${text} <${email}>`;
      }
      return email;
    }

    const senderCandidates = [
      row.querySelector(".yW span"),
      row.querySelector(".yP"),
      row.querySelector("[data-hovercard-id]"),
      row.querySelector(".go")
    ];
    for (const node of senderCandidates) {
      if (!(node instanceof HTMLElement)) continue;
      const fromText = normalize(node.innerText || node.textContent);
      if (isUseful(fromText) && !isGenericSenderLabel(fromText) && !looksLikeDateOrTime(fromText)) return fromText;
      const fromTitle = normalize(node.getAttribute("title"));
      if (isUseful(fromTitle) && !isGenericSenderLabel(fromTitle) && !looksLikeDateOrTime(fromTitle)) return fromTitle;
      const fromAria = normalize(node.getAttribute("aria-label"));
      if (isUseful(fromAria) && !isGenericSenderLabel(fromAria) && !looksLikeDateOrTime(fromAria)) return fromAria;
    }

    const rowAria = normalize(row.getAttribute("aria-label"));
    if (rowAria) {
      const ariaEmail = extractEmail(rowAria);
      if (ariaEmail) return ariaEmail;
      const parts = rowAria.split(/[,|-]/).map((part) => normalize(part)).filter(Boolean);
      for (const part of parts) {
        if (!isUseful(part) || looksLikeDateOrTime(part) || isGenericSenderLabel(part)) continue;
        return part;
      }
    }
    return "Unknown sender";
  }

  function extractRowRecipientEmails(row, sender = "") {
    if (!(row instanceof HTMLElement)) return [];
    const senderEmail = extractEmail(sender || "");
    const userEmail = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
    const emailNodes = Array.from(
      row.querySelectorAll("[email], [data-hovercard-id], [data-hovercard-owner-email], [title*='@']")
    ).slice(0, 40);
    const nodeValues = emailNodes.map((node) => (
      node instanceof HTMLElement
        ? [
          node.getAttribute("email"),
          node.getAttribute("data-hovercard-id"),
          node.getAttribute("data-hovercard-owner-email"),
          node.getAttribute("title"),
          node.getAttribute("aria-label"),
          normalize(node.textContent || "").slice(0, 200)
        ]
        : ""
    ));
    const emails = normalizeEmailList([
      nodeValues,
      row.getAttribute("aria-label"),
      normalize(row.innerText || row.textContent || "").slice(0, 900)
    ]);
    return emails.filter((email) => {
      if (!email) return false;
      if (senderEmail && email === senderEmail) return false;
      if (emails.length > 1 && userEmail && email === userEmail) return false;
      return true;
    });
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

  function collectMessages(limit = 400) {
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
      const senderEmail = extractEmail(sender || "");
      const recipientEmails = extractRowRecipientEmails(row, sender);
      const date = extractDate(row);
      const subject = cleanSubject(extractSubject(row, sender), sender, date);
      const snippet = extractSnippet(row);
      if (sender === "Unknown sender" && subject === "No subject captured" && !isUseful(snippet)) continue;
      if (strictMailbox && (!href || !hrefMatchesMailbox(href, mailboxKey))) continue;

      seen.add(dedupeKey);
      const detectedUnread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
      const unread = detectedUnread && !isThreadMarkedReadLocally(threadId);
      items.push({
        threadId,
        sender,
        senderEmail,
        recipientEmails,
        subject,
        snippet,
        bodyText: "",
        date,
        href,
        row,
        triageLevel: "",
        unread,
        mailbox: mailboxKey
      });
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
          const senderEmail = extractEmail(sender || "");
          const recipientEmails = row ? extractRowRecipientEmails(row, sender) : [];
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
          const detectedUnread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
          const unread = detectedUnread && !isThreadMarkedReadLocally(threadId);
          items.push({
            threadId,
            sender,
            senderEmail,
            recipientEmails,
            subject,
            snippet,
            bodyText: "",
            date,
            href,
            row,
            triageLevel: "",
            unread,
            mailbox: mailboxKey
          });
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
    return canonicalThreadKey(msg.threadId || "", msg.href || "");
  }

  function canonicalThreadKey(threadId, href) {
    const thread = canonicalThreadId(threadId || threadIdFromHref(href) || "");
    const hash = hashFromHref(href || "");
    return `${thread}|${hash || ""}`;
  }

  function canonicalRowKey(msg) {
    if (!msg || typeof msg !== "object") return "";
    const threadKey = canonicalThreadKey(msg.threadId || "", msg.href || "");
    const sender = normalize(msg.senderEmail || msg.sender || "").toLowerCase();
    const recipientToken = normalizeEmailList(msg.recipientEmails).slice(0, 3).join(",");
    const date = normalizeMessageDateToken(msg.date || "");
    const subject = normalize(msg.subject || "");
    const snippet = normalize(msg.snippet || msg.bodyText || "");
    const sigHash = hashString(`${subject.toLowerCase()}|${snippet.toLowerCase()}`);
    return `${threadKey}|${sender}|${recipientToken}|${date}|${sigHash}`;
  }

  function scoreMailboxMessageCandidate(msg) {
    let score = 0;
    const snippet = normalize(msg && (msg.snippet || msg.bodyText));
    if (snippet && !isLikelyMetadataBlob(snippet)) score += 3;
    if (Boolean(msg && msg.unread)) score += 2;
    if (normalize(msg && msg.href)) score += 1;
    if (mailboxCacheKey(msg && msg.mailbox) === "inbox") score += 1;
    return score;
  }

  function mergeMailboxCache(mailbox, incoming) {
    const key = mailboxCacheKey(mailbox);
    const existing = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    const map = new Map();
    for (const msg of existing) {
      const id = messageCacheKey(msg);
      if (!id) continue;
      map.set(id, {
        ...msg,
        mailbox: normalize(msg.mailbox || key) || key,
        unread: isThreadMarkedReadLocally(msg.threadId) ? false : Boolean(msg.unread)
      });
    }
    for (const msg of incoming || []) {
      const id = messageCacheKey(msg);
      if (!id) continue;
      map.set(id, {
        threadId: msg.threadId || "",
        sender: msg.sender || "",
        senderEmail: msg.senderEmail || extractEmail(msg.sender || ""),
        recipientEmails: normalizeEmailList(msg.recipientEmails),
        subject: msg.subject || "",
        snippet: msg.snippet || "",
        bodyText: msg.bodyText || "",
        date: msg.date || "",
        href: msg.href || "",
        row: msg.row || null,
        triageLevel: msg.triageLevel || "",
        unread: isThreadMarkedReadLocally(msg.threadId) ? false : Boolean(msg.unread),
        mailbox: normalize(msg.mailbox || key) || key
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

  function dedupeMessagesStable(messages) {
    const map = new Map();
    const list = Array.isArray(messages) ? messages : [];
    for (let index = 0; index < list.length; index += 1) {
      const msg = list[index];
      if (!msg || typeof msg !== "object") continue;
      const mailbox = mailboxCacheKey(msg.mailbox || "");
      const key = canonicalRowKey(msg);
      if (!key) continue;
      const nextMsg = { ...msg, mailbox };
      const nextScore = scoreMailboxMessageCandidate(nextMsg);
      const nextSubjectLen = normalize(nextMsg.subject || "").length;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { msg: nextMsg, score: nextScore, subjectLen: nextSubjectLen, index });
        continue;
      }
      if (nextScore > existing.score) {
        map.set(key, { msg: nextMsg, score: nextScore, subjectLen: nextSubjectLen, index });
        continue;
      }
      if (nextScore === existing.score && nextSubjectLen > existing.subjectLen) {
        map.set(key, { msg: nextMsg, score: nextScore, subjectLen: nextSubjectLen, index });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.msg);
  }

  function mailboxMessagesForList(mailbox, liveMessages = []) {
    const key = mailboxCacheKey(mailbox);
    const cached = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    const live = Array.isArray(liveMessages) ? liveMessages : [];
    return cached.length >= live.length ? cached.slice() : live.slice();
  }

  function chatScopeMessages(routeMailbox, liveMessages = []) {
    const mailbox = mailboxCacheKey(routeMailbox);
    if (mailbox !== "inbox" && mailbox !== "sent") {
      return mailboxMessagesForList(mailbox, liveMessages);
    }
    const inbox = mailboxMessagesForList("inbox", mailbox === "inbox" ? liveMessages : []);
    const sent = mailboxMessagesForList("sent", mailbox === "sent" ? liveMessages : []);
    return dedupeMessagesStable([...inbox, ...sent]);
  }

  function firstPageFingerprint(limit = 8) {
    const rows = collectMessages(Math.max(10, Number(limit) || 8)).items || [];
    const head = rows.slice(0, limit).map((item) => normalize(item.threadId || item.href || ""));
    const tail = rows.slice(-Math.min(3, limit)).map((item) => normalize(item.threadId || item.href || ""));
    return `${rows.length}|${head.join(",")}|${tail.join(",")}`;
  }

  function isElementVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (!node.isConnected) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabledButton(node) {
    if (!(node instanceof HTMLElement)) return true;
    if (node.getAttribute("aria-disabled") === "true") return true;
    if (node.getAttribute("disabled") !== null) return true;
    return false;
  }

  function findPagerButton(kind) {
    const labels = kind === "next"
      ? ["older", "next page", "next"]
      : ["newer", "previous page", "previous"];
    const queryRoot = getGmailMainRoot() || document;
    const candidates = [];
    for (const label of labels) {
      const selectors = [
        `[aria-label*="${label}"][role="button"]`,
        `button[aria-label*="${label}"]`,
        `[data-tooltip*="${label}"][role="button"]`,
        `button[data-tooltip*="${label}"]`,
        `[aria-label*="${label}"]`,
        `[data-tooltip*="${label}"]`
      ];
      for (const selector of selectors) {
        for (const node of Array.from(queryRoot.querySelectorAll(selector))) {
          if (!(node instanceof HTMLElement)) continue;
          if (!isElementVisible(node)) continue;
          const haystack = normalize(
            node.getAttribute("aria-label")
            || node.getAttribute("data-tooltip")
            || node.getAttribute("title")
            || node.textContent
          ).toLowerCase();
          if (!haystack || !labels.some((token) => haystack.includes(token))) continue;
          candidates.push(node);
        }
      }
    }
    if (candidates.length === 0) {
      for (const node of Array.from(queryRoot.querySelectorAll('[role="button"], button, [aria-label], [data-tooltip]'))) {
        if (!(node instanceof HTMLElement)) continue;
        if (!isElementVisible(node)) continue;
        const haystack = normalize(
          node.getAttribute("aria-label")
          || node.getAttribute("data-tooltip")
          || node.getAttribute("title")
          || node.textContent
        ).toLowerCase();
        if (!haystack) continue;
        if (!labels.some((token) => haystack.includes(token))) continue;
        candidates.push(node);
      }
    }
    if (candidates.length === 0) return null;
    const enabled = candidates.filter((node) => !isDisabledButton(node));
    return (enabled[0] || candidates[0]) || null;
  }

  function dispatchSyntheticClick(node) {
    if (!(node instanceof HTMLElement)) return;
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  function updateMailboxScanProgress(mailbox, patch = {}) {
    const key = mailboxCacheKey(mailbox);
    const existing = state.mailboxScanProgress[key] && typeof state.mailboxScanProgress[key] === "object"
      ? state.mailboxScanProgress[key]
      : { mailbox: key, pagesScanned: 0, cachedCount: 0, lastUpdatedAt: 0, status: "" };
    state.mailboxScanProgress[key] = {
      ...existing,
      ...patch,
      mailbox: key,
      lastUpdatedAt: Date.now()
    };
  }

  async function waitForPageChange(previousFingerprint, timeoutMs = 7000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = firstPageFingerprint(10);
      if (current && current !== previousFingerprint) return { changed: true, fingerprint: current };
      await sleep(140);
    }
    return { changed: false, fingerprint: firstPageFingerprint(10) };
  }

  async function scanMailboxPages(mailbox, options = {}) {
    const key = mailboxCacheKey(mailbox);
    const force = Boolean(options.force);
    const maxPages = Math.max(1, Math.min(MAILBOX_SCAN_MAX_PAGES, Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES));
    const root = options.root instanceof HTMLElement ? options.root : document.getElementById(ROOT_ID);
    const cached = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    if (!force && state.fullScanCompletedByMailbox[key] && cached.length > 0) return;
    if (state.replySendInProgress) return;
    if (state.currentView !== "list" || state.contactChatLoading || state.suspendHashSyncDuringContactHydration) return;
    if (state.fullScanRunning && state.fullScanMailbox && state.fullScanMailbox !== key) return;

    const returnHash = normalize(window.location.hash || state.lastListHash || "#inbox") || "#inbox";
    const targetHash = `#${key}`;
    const targetIsActive = parseListRoute(window.location.hash || state.lastListHash || "#inbox").mailbox === key;
    if (!targetIsActive) {
      const nav = NAV_ITEMS.find((item) => mailboxCacheKey((item.hash || "").replace(/^#/, "")) === key);
      navigateToList(targetHash, nav ? nav.nativeLabel : "", { native: true });
      await sleep(520);
    }

    state.fullScanRunning = true;
    state.fullScanMailbox = key;
    state.fullScanCompletedByMailbox[key] = false;
    state.fullScanStatus = `Scanning ${key}...`;
    updateMailboxScanProgress(key, {
      status: "running",
      pagesScanned: Number((state.mailboxScanProgress[key] || {}).pagesScanned || 0),
      cachedCount: cached.length
    });
    if (root instanceof HTMLElement) renderSidebar(root);

    let pageCount = 0;
    let movedPages = 0;
    let noChangeStreak = 0;
    try {
      while (pageCount < maxPages) {
        const result = collectMessages(500);
        const merged = mergeMailboxCache(key, result.items || []);
        pageCount += 1;
        state.fullScanStatus = `Scanning ${key} page ${pageCount}... cached ${merged.length}`;
        updateMailboxScanProgress(key, {
          status: "running",
          pagesScanned: pageCount,
          cachedCount: merged.length
        });
        state.lastListSignature = "";
        if (root instanceof HTMLElement) {
          renderSidebar(root);
          if (state.currentView === "list") renderList(root);
        }

        const nextButton = findPagerButton("next");
        if (!(nextButton instanceof HTMLElement) || isDisabledButton(nextButton)) break;

        const previousFingerprint = firstPageFingerprint(10);
        dispatchSyntheticClick(nextButton);
        const changed = await waitForPageChange(previousFingerprint, 7000);
        if (!changed.changed) {
          noChangeStreak += 1;
          if (noChangeStreak >= MAILBOX_SCAN_NO_CHANGE_LIMIT) break;
          continue;
        }
        noChangeStreak = 0;
        movedPages += 1;
        await sleep(220);
      }

      let rewindNoChange = 0;
      for (let i = 0; i < movedPages; i += 1) {
        const prevButton = findPagerButton("prev");
        if (!(prevButton instanceof HTMLElement) || isDisabledButton(prevButton)) break;
        const previousFingerprint = firstPageFingerprint(10);
        dispatchSyntheticClick(prevButton);
        const changed = await waitForPageChange(previousFingerprint, 7000);
        if (!changed.changed) {
          rewindNoChange += 1;
          if (rewindNoChange >= MAILBOX_SCAN_NO_CHANGE_LIMIT) break;
          continue;
        }
        rewindNoChange = 0;
        await sleep(180);
      }

      const count = Array.isArray(state.scannedMailboxMessages[key])
        ? state.scannedMailboxMessages[key].length
        : 0;
      state.fullScanCompletedByMailbox[key] = true;
      state.fullScanStatus = `Scan complete for ${key}. Cached ${count} emails.`;
      updateMailboxScanProgress(key, {
        status: "done",
        cachedCount: count
      });
      const visible = Number(state.listVisibleByMailbox[key] || 0);
      if (!visible) state.listVisibleByMailbox[key] = state.listChunkSize;
    } catch (error) {
      const message = error && error.message ? String(error.message) : "Scan failed";
      state.fullScanStatus = `Scan failed for ${key}: ${message.slice(0, 120)}`;
      updateMailboxScanProgress(key, { status: "failed" });
      logWarn("Mailbox scan failed", { mailbox: key, error });
    } finally {
      state.fullScanRunning = false;
      state.fullScanMailbox = "";
      if (
        returnHash &&
        normalize(window.location.hash || "") !== normalize(returnHash) &&
        state.currentView === "list" &&
        !state.replySendInProgress
      ) {
        window.location.hash = returnHash;
        await sleep(220);
      }
      const latestRoot = document.getElementById(ROOT_ID);
      if (latestRoot instanceof HTMLElement) renderCurrentView(latestRoot);
    }
  }

  function queueMailboxScan(mailbox, root, options = {}) {
    const key = mailboxCacheKey(mailbox);
    if (!key) return;
    const force = Boolean(options.force);
    if (state.fullScanRunning && state.fullScanMailbox === key) return;
    const alreadyQueued = state.mailboxScanQueue.some((entry) => mailboxCacheKey(entry.mailbox) === key);
    if (!force && state.fullScanCompletedByMailbox[key] && !alreadyQueued) return;
    if (alreadyQueued) return;
    state.mailboxScanQueue.push({
      mailbox: key,
      options: {
        maxPages: Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES,
        force
      },
      root: root instanceof HTMLElement ? root : null
    });
  }

  async function runMailboxScanQueue(root) {
    if (state.mailboxScanRunner) return;
    state.mailboxScanRunner = true;
    try {
      while (state.mailboxScanQueue.length > 0) {
        if (
          state.replySendInProgress
          || state.currentView !== "list"
          || state.contactChatLoading
          || state.suspendHashSyncDuringContactHydration
        ) {
          await sleep(260);
          continue;
        }
        const next = state.mailboxScanQueue.shift();
        if (!next) continue;
        await scanMailboxPages(next.mailbox, {
          ...(next.options || {}),
          root: next.root instanceof HTMLElement ? next.root : root
        });
      }
    } finally {
      state.mailboxScanRunner = false;
    }
  }

  async function runFullMailboxScan(root, options = {}) {
    const shell = root instanceof HTMLElement ? root : document.getElementById(ROOT_ID);
    if (!(shell instanceof HTMLElement)) return;
    if (state.currentView !== "list") return;
    const requested = Array.isArray(options.mailboxes) ? options.mailboxes.map(mailboxCacheKey).filter(Boolean) : [];
    const active = mailboxCacheKey(options.primaryMailbox || activeMailbox());
    const order = requested.length > 0
      ? requested
      : Array.from(new Set([active, "inbox", "sent"]));

    for (const mailbox of order) {
      queueMailboxScan(mailbox, shell, {
        maxPages: Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES,
        force: Boolean(options.force)
      });
    }
    await runMailboxScanQueue(shell);
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
    const variants = threadHintKeysForThread(threadId);
    const hint = normalize(href || "");
    const hintHash = hashFromHref(hint);
    const main = getGmailMainRoot();

    if (main instanceof HTMLElement && hint) {
      const anchors = Array.from(main.querySelectorAll("a[href], [role='link'][href]"));
      for (const anchor of anchors) {
        if (!(anchor instanceof HTMLElement)) continue;
        const anchorHref = normalize(anchor.getAttribute("href") || "");
        if (!anchorHref) continue;
        if (anchorHref === hint || (hintHash && hashFromHref(anchorHref) === hintHash)) {
          anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return true;
        }
      }
    }

    for (const variant of variants) {
      const noHash = variant.startsWith("#") ? variant.slice(1) : variant;
      if (!noHash) continue;

      const link = (
        document.querySelector(`[role="main"] a[href$="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`[role="main"] a[href*="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`[role="main"] a[href*="#${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href$="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href*="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href*="#${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href*="th=${CSS.escape(noHash)}"]`)
      );
      if (link instanceof HTMLElement) {
        link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }

      const domRow = (
        document.querySelector(`[data-thread-id="${CSS.escape(variant)}"]`) ||
        document.querySelector(`[data-legacy-thread-id="${CSS.escape(variant)}"]`) ||
        document.querySelector(`[data-thread-id="${CSS.escape(noHash)}"]`) ||
        document.querySelector(`[data-legacy-thread-id="${CSS.escape(noHash)}"]`)
      );
      if (domRow instanceof HTMLElement) {
        domRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        domRow.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        domRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }
    }

    if (row instanceof HTMLElement) {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    if (hintHash) {
      const activeBox = mailboxCacheKey(mailboxKeyFromHash(window.location.hash || state.lastListHash || "#inbox"));
      window.location.hash = normalizeThreadHashForMailbox(hintHash, activeBox) || hintHash;
      return true;
    }

    if (hint) {
      const activeBox = mailboxCacheKey(mailboxKeyFromHash(window.location.hash || state.lastListHash || "#inbox"));
      const rawHash = hint.includes("#") ? hint.slice(hint.indexOf("#")) : hint;
      window.location.hash = normalizeThreadHashForMailbox(rawHash, activeBox) || rawHash;
      return true;
    }

    return false;
  }

  const THREAD_MESSAGE_SELECTORS = [
    "[data-message-id]",
    "[data-legacy-message-id]",
    ".adn[data-message-id]",
    ".adn[data-legacy-message-id]",
    ".h7 .adn",
    ".nH.hx .adn",
    '[role="main"] .adn',
    '[role="listitem"][data-message-id]',
    '[role="listitem"][data-legacy-message-id]'
  ].join(", ");
  const STRICT_BODY_SELECTORS = [
    ".a3s.aiL",
    ".a3s",
    ".ii.gt .a3s.aiL",
    ".ii.gt .a3s",
    "div[dir='ltr'].a3s.aiL",
    "div[dir='ltr'].a3s",
    "[data-legacy-message-id] .a3s.aiL",
    "[data-legacy-message-id] .a3s",
    "[data-message-id] .a3s.aiL",
    "[data-message-id] .a3s",
    ".adn .a3s.aiL",
    ".adn .a3s",
    ".adn [data-message-id] .a3s.aiL",
    ".adn [data-message-id] .a3s"
  ];
  const SECONDARY_BODY_SELECTORS = [
    ".ii.gt > .a3s",
    ".adn .a3s",
    ".adn .ii.gt .a3s",
    ".h7 .a3s"
  ];
  const BODY_SELECTORS = Array.from(
    new Set([...STRICT_BODY_SELECTORS, ...SECONDARY_BODY_SELECTORS])
  ).join(", ");
  const THREAD_BODY_PLACEHOLDER = "Message body not captured yet.";
  const THREAD_NO_CONTENT = "No content";

  function threadDomReadinessSnapshot() {
    const main = getGmailMainRoot() || document.querySelector('[role="main"]') || document.body;
    const scope = main instanceof HTMLElement ? main : document;
    const messageContainers = scope.querySelectorAll(THREAD_MESSAGE_SELECTORS).length;
    const bodyNodes = scope.querySelectorAll(BODY_SELECTORS).length;
    let iframeBodyNodes = 0;
    let iframeCount = 0;
    for (const ifr of Array.from(document.querySelectorAll("iframe")).slice(0, 12)) {
      iframeCount += 1;
      try {
        const doc = ifr.contentDocument;
        if (!doc || doc === document) continue;
        iframeBodyNodes += doc.querySelectorAll(BODY_SELECTORS).length;
      } catch (_) {
        // cross-origin frames are expected
      }
    }
    const ready = messageContainers > 0 || bodyNodes > 0 || iframeBodyNodes > 0;
    return {
      ready,
      messageContainers,
      bodyNodes,
      iframeBodyNodes,
      iframeCount
    };
  }

  function waitForThreadContentReady(threadId = "") {
    const readiness = threadDomReadinessSnapshot();
    const normalizedThreadId = normalize(
      threadId
      || state.currentThreadIdForReply
      || state.activeThreadId
      || threadIdFromHash(window.location.hash || "")
      || ""
    );
    const priorAttempts = Math.max(0, Number(state.threadExtractRetry || 0));
    if (readiness.ready) {
      return {
        ready: true,
        timedOut: false,
        attempt: priorAttempts,
        waitMs: 0,
        readiness,
        threadId: normalizedThreadId
      };
    }
    if (priorAttempts >= THREAD_READY_MAX_RETRIES) {
      return {
        ready: false,
        timedOut: true,
        attempt: priorAttempts,
        waitMs: 0,
        readiness,
        threadId: normalizedThreadId
      };
    }
    const retryAttempt = priorAttempts + 1;
    const waitMs = THREAD_READY_RETRY_BASE_MS + retryAttempt * 190;
    state.threadExtractRetry = retryAttempt;
    return {
      ready: false,
      timedOut: false,
      attempt: retryAttempt,
      waitMs,
      readiness,
      threadId: normalizedThreadId
    };
  }

  function hasUsefulBodyText(text) {
    const value = normalize(text);
    return Boolean(value && value !== THREAD_BODY_PLACEHOLDER && value !== THREAD_NO_CONTENT);
  }

  function findFirstBodyNode(scope, selectors) {
    if (!(scope instanceof HTMLElement || scope instanceof Document)) return null;
    for (const selector of selectors) {
      const node = scope.querySelector(selector);
      if (node instanceof HTMLElement) return node;
    }
    return null;
  }

  function findBodyNodeInScope(scope) {
    return (
      findFirstBodyNode(scope, STRICT_BODY_SELECTORS)
      || findFirstBodyNode(scope, SECONDARY_BODY_SELECTORS)
      || null
    );
  }

  function findBodyNodeInScopeIframes(scope) {
    if (!(scope instanceof HTMLElement)) return null;
    for (const ifr of scope.querySelectorAll("iframe")) {
      try {
        const doc = ifr.contentDocument;
        if (!doc || doc === document) continue;
        const node = findBodyNodeInScope(doc);
        if (node instanceof HTMLElement) return node;
      } catch (_) {
        // cross-origin
      }
    }
    return null;
  }

  function threadSnippetFallback(threadIdHint) {
    const keys = threadHintKeysForThread(threadIdHint || "");
    for (const key of keys) {
      const snippet = normalize(state.snippetByThreadId && state.snippetByThreadId[key]);
      if (snippet) return snippet;
    }
    const canonical = canonicalThreadId(threadIdHint || "");
    if (canonical) {
      const direct = normalize(state.snippetByThreadId && state.snippetByThreadId[canonical]);
      if (direct) return direct;
      const hashed = normalize(state.snippetByThreadId && state.snippetByThreadId[`#${canonical}`]);
      if (hashed) return hashed;
    }
    return "";
  }

  function alphaRatio(text) {
    const value = normalize(text || "");
    if (!value) return 0;
    const alphaCount = (value.match(/[A-Za-z]/g) || []).length;
    const visibleCount = (value.match(/[A-Za-z0-9]/g) || []).length;
    if (visibleCount === 0) return 0;
    return alphaCount / visibleCount;
  }

  function extractMessageBodyFromScope(scope, threadIdHint = "") {
    let bodyNode = findBodyNodeInScope(scope);
    if (!bodyNode) {
      bodyNode = findBodyNodeInScopeIframes(scope);
    }

    const bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML || "" : "";
    const bodyTextRaw = bodyNode instanceof HTMLElement
      ? normalize(bodyNode.innerText || bodyNode.textContent || "")
      : "";
    const cleanedBody = cleanThreadMessageBody(bodyTextRaw, bodyHtml);
    if (cleanedBody) {
      return {
        bodyText: cleanedBody,
        bodyHtml: "",
        sourceType: "captured",
        hasBodyNode: true,
        metadataOnly: false
      };
    }

    const snippet = threadSnippetFallback(threadIdHint || "");
    const scopeWindow = normalize((scope && (scope.innerText || scope.textContent) || "").slice(0, 420));
    const fallbackCandidate = snippet || scopeWindow;
    const fallbackText = safeThreadFallbackText(fallbackCandidate);
    if (!fallbackText || isLikelyMetadataBlob(fallbackText)) {
      return {
        bodyText: THREAD_BODY_PLACEHOLDER,
        bodyHtml: "",
        sourceType: "fallback",
        hasBodyNode: false,
        metadataOnly: true
      };
    }
    return {
      bodyText: fallbackText,
      bodyHtml: "",
      sourceType: "fallback",
      hasBodyNode: false,
      metadataOnly: false
    };
  }

  function extractOpenThreadData() {
    let main = document.querySelector('[role="main"]') || document.body;
    if (!(main instanceof HTMLElement)) {
      return { subject: "", messages: [] };
    }
    let threadExtractFailureStats = null;
    const extractionThreadIdHint = normalize(
      threadIdFromHash(window.location.hash || "")
      || state.currentThreadIdForReply
      || state.activeThreadId
      || ""
    );
    const sdkCachedMessages = getInboxSdkThreadMessages(extractionThreadIdHint);

    const subjectCandidates = Array.from(main.querySelectorAll("h1, h2, [role='heading']"))
      .map((node) => normalize(node.textContent))
      .filter((text) => isUseful(text) && !looksLikeDateOrTime(text));
    const subject = subjectCandidates[0] || "No subject";

    const messages = [];
    function headerScopesForMessage(scope) {
      const roots = [];
      const seen = new Set();
      const push = (node) => {
        if (!(node instanceof HTMLElement)) return;
        if (seen.has(node)) return;
        seen.add(node);
        roots.push(node);
      };
      push(scope.querySelector("h3"));
      push(scope.querySelector(".go"));
      push(scope.querySelector(".gF"));
      const senderNode = scope.querySelector(".gD[email], .gD[data-hovercard-id], [data-hovercard-id][email]");
      if (senderNode instanceof HTMLElement) {
        push(senderNode.closest("h3"));
        push(senderNode.closest(".go"));
        push(senderNode.closest(".gF"));
        push(senderNode.closest(".adn"));
      }
      push(scope);
      return roots;
    }

    function extractSenderFromScope(scope) {
      const threadSpecificSelectors = [
        ".gD[email]",
        ".gD[data-hovercard-id]",
        "h3 .gD[email]",
        "h3 [email][name]",
        ".go [email]",
        ".go [data-hovercard-id]"
      ];

      const candidateScopes = headerScopesForMessage(scope);
      for (const section of candidateScopes) {
        for (const selector of threadSpecificSelectors) {
          for (const node of Array.from(section.querySelectorAll(selector)).slice(0, 6)) {
            if (!(node instanceof HTMLElement)) continue;
            const email = extractEmail(
              node.getAttribute("email")
              || node.getAttribute("data-hovercard-id")
              || node.getAttribute("data-hovercard-owner-email")
              || node.getAttribute("name")
              || node.getAttribute("title")
              || node.getAttribute("aria-label")
              || node.textContent
            );
            if (!email) continue;
            const preferredName = normalize(
              node.getAttribute("name")
              || node.getAttribute("data-name")
              || node.getAttribute("title")
              || node.textContent
              || ""
            );
            if (preferredName && !isGenericSenderLabel(preferredName) && extractEmail(preferredName) !== email) {
              return `${preferredName} <${email}>`;
            }
            return email;
          }
        }
      }

      for (const section of candidateScopes) {
        const emailNodes = section.querySelectorAll(
          'h3 .gD[email], h3 span[email], h3 [data-hovercard-id], .gD[email], span.gD[email], .go [email], [data-hovercard-id][email]'
        );
        for (const node of emailNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const email = extractEmail(
            node.getAttribute("email") ||
            node.getAttribute("data-hovercard-id") ||
            node.getAttribute("title") ||
            node.getAttribute("aria-label")
          );
          if (!email) continue;
          const text = normalize(
            node.innerText ||
            node.textContent ||
            node.getAttribute("title") ||
            ""
          );
          if (isUseful(text) && !isGenericSenderLabel(text) && extractEmail(text) !== email) {
            return `${text} <${email}>`;
          }
          return email;
        }
      }

      const selectors = [
        ".gD", "span.gD", 'h3 span[dir="auto"]', "h3 span", ".go", "h4"
      ];
      for (const section of candidateScopes) {
        for (const sel of selectors) {
          const node = section.querySelector(sel);
          if (!(node instanceof HTMLElement)) continue;
          const text = normalize(node.innerText || node.textContent || node.getAttribute("title"));
          if (!text || !isUseful(text) || looksLikeDateOrTime(text) || isGenericSenderLabel(text)) continue;
          return text;
        }
      }

      for (const section of candidateScopes) {
        const aria = normalize(section.getAttribute("aria-label"));
        if (aria) {
          const email = extractEmail(aria);
          if (email) return email;
        }
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

    function extractRecipientEmails(scope, senderValue = "") {
      if (!(scope instanceof HTMLElement)) return [];
      const senderEmail = extractEmail(senderValue || "");
      const candidateScopes = headerScopesForMessage(scope);
      const headerText = candidateScopes
        .map((section) => normalize((section.innerText || section.textContent || "").slice(0, 360)))
        .filter(Boolean)
        .join(" ");
      const emails = normalizeEmailList([
        Array.from(scope.querySelectorAll("[email], [data-hovercard-id], [data-hovercard-owner-email], [title*='@']"))
          .slice(0, 24)
          .map((node) => (
            node instanceof HTMLElement
              ? [
                node.getAttribute("email"),
                node.getAttribute("data-hovercard-id"),
                node.getAttribute("data-hovercard-owner-email"),
                node.getAttribute("title"),
                node.getAttribute("aria-label"),
                normalize(node.textContent || "").slice(0, 260)
              ]
              : ""
          )),
        scope.getAttribute("aria-label"),
        headerText,
        normalize((scope.innerText || scope.textContent || "").slice(0, 420))
      ]);
      return emails.filter((email) => email && email !== senderEmail);
    }

    let topContainers;
    if (state.currentView === "thread" && document.body) {
      topContainers = document.body.querySelectorAll(THREAD_MESSAGE_SELECTORS);
      if (topContainers.length === 0) topContainers = main.querySelectorAll(THREAD_MESSAGE_SELECTORS);
    } else {
      topContainers = main.querySelectorAll(THREAD_MESSAGE_SELECTORS);
      if (topContainers.length === 0 && document.body && document.body !== main) {
        topContainers = document.body.querySelectorAll(THREAD_MESSAGE_SELECTORS);
      }
    }
    const seenBodies = new Set();
    const usedNodes = new Set();
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] === THREAD EXTRACT: message container count = ${topContainers.length} ===`);
    }
    for (const container of Array.from(topContainers)) {
      if (!(container instanceof HTMLElement)) continue;
      if (usedNodes.has(container)) continue;
      const scope = container;
      const mid = (
        scope.getAttribute("data-message-id")
        || scope.getAttribute("data-legacy-message-id")
        || "(none)"
      );
      const sender = extractSenderFromScope(scope);
      const recipientEmails = extractRecipientEmails(scope, sender);
      const date = extractDate(scope);
      const extractedBody = extractMessageBodyFromScope(scope, extractionThreadIdHint);
      const bodyHtml = extractedBody.bodyHtml || "";
      const bodyText = extractedBody.bodyText || THREAD_NO_CONTENT;
      const bodyFound = hasUsefulBodyText(bodyText) || Boolean(bodyHtml);
      if (DEBUG_THREAD_EXTRACT) {
        const preview = (bodyText || "").substring(0, 50).replace(/\n/g, " ");
        console.log(`[reskin] [thread-message] mid=${mid} bodyFound=${bodyFound} sender=${(sender || "").substring(0, 30)} bodyPreview=${preview || "(empty)"}`);
      }
      if (!hasUsefulBodyText(bodyText) && !isUseful(sender) && !date) continue;
      const senderToken = normalize(sender || "").toLowerCase();
      const dateToken = normalize(date || "").toLowerCase();
      const bodyToken = normalize(bodyText || "");
      let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
      if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
        uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
      }
      if (uniqueKey && seenBodies.has(uniqueKey)) continue;
      if (uniqueKey) seenBodies.add(uniqueKey);
      usedNodes.add(container);
      messages.push({
        sender: isUseful(sender) ? sender : "Unknown sender",
        senderEmail: extractEmail(sender || ""),
        recipientEmails,
        date: date || "",
        dataMessageId: mid || "",
        bodyHtml: bodyHtml || "",
        bodyText: bodyText || THREAD_NO_CONTENT,
        sourceType: extractedBody.sourceType || "captured"
      });
    }
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] After thread-message phase: messages.length = ${messages.length}`);
    }
    if (messages.length === 0 && state.currentView === "thread") {
      for (const ifr of document.querySelectorAll("iframe")) {
        try {
          const doc = ifr.contentDocument;
          if (!doc || doc === document) continue;
          const iframeBody = doc.body;
          if (!(iframeBody instanceof HTMLElement)) continue;
          const iframeContainers = iframeBody.querySelectorAll(THREAD_MESSAGE_SELECTORS);
          if (iframeContainers.length === 0) continue;
          for (const container of Array.from(iframeContainers)) {
            if (!(container instanceof HTMLElement)) continue;
            const scope = container;
            const mid = (
              scope.getAttribute("data-message-id")
              || scope.getAttribute("data-legacy-message-id")
              || "(none)"
            );
            const sender = extractSenderFromScope(scope);
            const recipientEmails = extractRecipientEmails(scope, sender);
            const date = extractDate(scope);
            const extractedBody = extractMessageBodyFromScope(scope, extractionThreadIdHint);
            const bodyHtml = extractedBody.bodyHtml || "";
            const bodyText = extractedBody.bodyText || THREAD_NO_CONTENT;
            if (!hasUsefulBodyText(bodyText) && !isUseful(sender) && !date) continue;
            const senderToken = normalize(sender || "").toLowerCase();
            const dateToken = normalize(date || "").toLowerCase();
            const bodyToken = normalize(bodyText || "");
            let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
            if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
              uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
            }
            if (uniqueKey && seenBodies.has(uniqueKey)) continue;
            if (uniqueKey) seenBodies.add(uniqueKey);
            messages.push({
              sender: isUseful(sender) ? sender : "Unknown sender",
              senderEmail: extractEmail(sender || ""),
              recipientEmails,
              date: date || "",
              dataMessageId: mid || "",
              bodyHtml: bodyHtml || "",
              bodyText: bodyText || THREAD_NO_CONTENT,
              sourceType: extractedBody.sourceType || "captured"
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
        const sender = extractSenderFromScope(scope);
        const recipientEmails = extractRecipientEmails(scope, sender);
        const date = extractDate(scope);
        const extractedBody = extractMessageBodyFromScope(scope, extractionThreadIdHint);
        const bodyHtml = extractedBody.bodyHtml || "";
        const bodyText = extractedBody.bodyText || THREAD_NO_CONTENT;
        if (DEBUG_THREAD_EXTRACT) {
          const preview = (bodyText || "").substring(0, 50).replace(/\n/g, " ");
          console.log(`[reskin] fallback container tag=${scope.tagName} cls=${(scope.className || "").substring(0, 40)} bodyFound=${!!(bodyText || bodyHtml)} bodyPreview=${preview || "(empty)"}`);
        }
        const nestedMessageNode = scope.querySelector("[data-message-id], [data-legacy-message-id]");
        const nestedMessageId = nestedMessageNode instanceof HTMLElement
          ? normalize(
            nestedMessageNode.getAttribute("data-message-id")
            || nestedMessageNode.getAttribute("data-legacy-message-id")
            || ""
          )
          : "";
        const hasMessageId = Boolean(
          normalize(
            scope.getAttribute("data-message-id")
            || scope.getAttribute("data-legacy-message-id")
            || nestedMessageId
          )
        );
        const hasStrictBody = Boolean(extractedBody.hasBodyNode);
        const nonMetadataBody = hasUsefulBodyText(bodyText)
          && !isLikelyMetadataBlob(bodyText)
          && alphaRatio(bodyText) >= 0.2;
        if (!hasMessageId && !hasStrictBody && !nonMetadataBody) continue;
        if (!hasUsefulBodyText(bodyText) && !isUseful(sender) && !date) continue;
        const senderToken = normalize(sender || "").toLowerCase();
        const dateToken = normalize(date || "").toLowerCase();
        const bodyToken = normalize(bodyText || "");
        const mid = (
          scope.getAttribute("data-message-id")
          || scope.getAttribute("data-legacy-message-id")
          || nestedMessageId
          || ""
        );
        let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
        if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
          uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
        }
        if (uniqueKey && seenBodies.has(uniqueKey)) continue;
        if (uniqueKey) seenBodies.add(uniqueKey);
        messages.push({
          sender: isUseful(sender) ? sender : "Unknown sender",
          senderEmail: extractEmail(sender || ""),
          recipientEmails,
          date: date || "",
          dataMessageId: mid || "",
          bodyHtml: bodyHtml || "",
          bodyText: bodyText || THREAD_NO_CONTENT,
          sourceType: extractedBody.sourceType || (hasStrictBody ? "captured" : "fallback")
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
      const sender = extractSenderFromScope(main);
      const recipientEmails = extractRecipientEmails(main, sender);
      const dateCandidates = Array.from(main.querySelectorAll("span.g3[title], time, span[title], div[title]"))
        .map((node) => normalize(node.getAttribute("title") || node.innerText || node.textContent))
        .filter((text) => looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text));
      const date = dateCandidates[0] || "";
      const bodySelectors = BODY_SELECTORS;
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
      const finalBodyText = bodyText || THREAD_BODY_PLACEHOLDER;
      if (finalBodyText === THREAD_BODY_PLACEHOLDER) {
        threadExtractFailureStats = {
          dataMessageId: topContainers.length,
          bodyNodes: bodyNodesCount,
          iframes: document.querySelectorAll("iframe").length
        };
      }
      messages.push({
        sender: isUseful(sender) ? sender : "Unknown sender",
        senderEmail: extractEmail(sender || ""),
        recipientEmails,
        date,
        dataMessageId: "",
        bodyHtml: finalBodyText.length >= 3 ? bodyHtml : "",
        bodyText: finalBodyText
      });
    }

    const extractionThreadId = normalize(threadIdFromHash(window.location.hash || "") || state.activeThreadId || "");
    const domHasMeaningful = hasMeaningfulCapturedMessages(messages);
    const sdkHasMeaningful = hasMeaningfulCapturedMessages(sdkCachedMessages);
    const sourceLabel = (!domHasMeaningful && sdkHasMeaningful) ? "inboxsdk" : "gmail_dom";
    const sourceMessages = sourceLabel === "inboxsdk" ? sdkCachedMessages : messages;
    logChatDebug("thread-extract:source", {
      threadId: extractionThreadId,
      source: sourceLabel,
      domCount: Array.isArray(messages) ? messages.length : 0,
      sdkCount: Array.isArray(sdkCachedMessages) ? sdkCachedMessages.length : 0,
      domHasMeaningful,
      sdkHasMeaningful
    }, { throttleKey: `thread-extract-source:${extractionThreadId || "unknown"}`, throttleMs: 500 });
    if (sourceLabel === "gmail_dom" && !sdkHasMeaningful) {
      logChatDebug("inboxsdk:fallback-dom", {
        threadId: extractionThreadId,
        reason: "sdk-empty-or-unavailable"
      }, { throttleKey: `inboxsdk-fallback-dom:${extractionThreadId || "unknown"}`, throttleMs: 1000 });
    }
    const finalMessages = normalizeThreadMessagesForChat(sourceMessages, extractionThreadId);

    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] Final messages (after content dedup): ${finalMessages.length} (was ${messages.length})`);
      finalMessages.forEach((m, i) => {
        const preview = (m.bodyText || "").substring(0, 50).replace(/\n/g, " ");
        console.log(`[reskin]   [${i}] sender=${(m.sender || "").substring(0, 35)} body=${preview || "(empty)"}`);
      });
      console.log(`[reskin] === END THREAD EXTRACT ===`);
    }
    if (finalMessages.length === 1 && (finalMessages[0].bodyText || "").trim() === THREAD_BODY_PLACEHOLDER && threadExtractFailureStats) {
      const now = Date.now();
      const lastLog = state.lastThreadBodyFailLogAt || 0;
      if (now - lastLog > 5000) {
        state.lastThreadBodyFailLogAt = now;
        const s = threadExtractFailureStats;
        logWarn(
          `Thread body not captured — [message-containers]=${s.dataMessageId}, bodyNodes=${s.bodyNodes}, bodyTextLen=0, iframes=${s.iframes}, hash=${normalize(window.location.hash || "")}, view=${state.currentView}, activeThread=${normalize(state.activeThreadId || "")}. Set DEBUG_THREAD_EXTRACT=true in content.js for full diagnostics.`
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
    const userEmail = extractEmail(state.activeAccountEmail || state.currentUserEmail || detectCurrentUserEmail());
    const senderValue = normalize(msg.senderEmail || msg.sender || "").trim();
    const senderEmail = extractEmail(senderValue);
    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.ariaLabel,
      msg.row instanceof HTMLElement ? msg.row.getAttribute("aria-label") : "",
      msg.row instanceof HTMLElement ? normalize(msg.row.innerText || msg.row.textContent || "").slice(0, 700) : ""
    ]);
    const mailbox = mailboxCacheKey(msg.mailbox || "");
    const senderLooksLikeSelf = Boolean(
      (senderEmail && userEmail && senderEmail === userEmail)
      || isSelfSenderLabel(msg.sender || "")
    );
    if ((mailbox === "sent" || senderLooksLikeSelf) && recipientEmails.length > 0) {
      const counterpart = recipientEmails.find((value) => value && (!userEmail || value !== userEmail));
      if (counterpart) return counterpart;
    }
    if (senderEmail) return senderEmail;
    if (recipientEmails.length > 0) {
      const counterpart = recipientEmails.find((value) => value && (!userEmail || value !== userEmail));
      if (counterpart) return counterpart;
      if (recipientEmails[0]) return recipientEmails[0];
    }
    const s = normalize(msg.sender || "").trim();
    const display = senderDisplayName(s);
    if (display && !isGenericSenderLabel(display)) return display.toLowerCase();
    return "";
  }

  function senderDisplayName(raw) {
    const s = (raw || "").trim();
    const m = s.match(/^(.+?)\s*<[^>]+>$/);
    const name = m ? m[1].trim() : (s || "");
    const email = extractEmail(s);
    if (email && isGenericSenderLabel(name)) return email;
    return name;
  }

  function messageDateSortValue(msg) {
    const raw = normalize(msg && msg.date ? msg.date : "");
    if (!raw) return 0;
    const direct = parseThreadTimestampForOrder(raw);
    if (direct > 0) return direct;
    const relative = raw.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
    if (relative) {
      const value = Number(relative[1] || 0);
      const unit = normalize(relative[2] || "").toLowerCase();
      const multipliers = {
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000
      };
      const delta = multipliers[unit] || 0;
      return delta > 0 ? Date.now() - value * delta : 0;
    }
    return 0;
  }

  function compareMailboxRowsNewestFirst(a, b) {
    const ta = messageDateSortValue(a);
    const tb = messageDateSortValue(b);
    if (ta !== tb) return tb - ta;
    const da = normalize(a && a.date ? a.date : "").toLowerCase();
    const db = normalize(b && b.date ? b.date : "").toLowerCase();
    return db.localeCompare(da);
  }

  function mailboxRowMatchesContactConversation(msg, context = {}) {
    if (!msg || typeof msg !== "object") return false;
    const conversationContext = activeConversationContext(context);
    const contactEmail = extractEmail(conversationContext.contactEmail || "");
    if (!contactEmail) return false;
    const accountEmail = extractEmail(conversationContext.activeAccountEmail || "");
    const senderEmail = extractEmail(msg.senderEmail || msg.sender || "");
    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.ariaLabel
    ]);
    const participants = new Set(normalizeEmailList([senderEmail, recipientEmails]));
    const inferredContactKey = extractEmail(contactKeyFromMessage(msg));
    const includesContact = participants.has(contactEmail) || inferredContactKey === contactEmail;
    if (!includesContact) return false;
    if (!accountEmail) return true;
    if (participants.has(accountEmail)) return true;
    const mailbox = mailboxCacheKey(msg.mailbox || "");
    const senderLooksSelf = senderEmail === accountEmail || isSelfSenderLabel(msg.sender || "");
    return mailbox === "sent" && senderLooksSelf;
  }

  function expandContactGroupWithCachedCounterparts(group, context = {}) {
    const baseGroup = group && typeof group === "object" ? group : null;
    if (!baseGroup) return group;
    const conversationContext = activeConversationContext({
      ...context,
      contactEmail: context.contactEmail || baseGroup.contactEmail || baseGroup.contactKey
    });
    const contactEmail = extractEmail(conversationContext.contactEmail || "");
    if (!contactEmail) return baseGroup;

    const seededItems = Array.isArray(baseGroup.items) ? baseGroup.items.slice() : [];
    const inboxCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
      ? state.scannedMailboxMessages[mailboxCacheKey("inbox")]
      : [];
    const sentCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
      ? state.scannedMailboxMessages[mailboxCacheKey("sent")]
      : [];
    const liveRows = collectMessages(320).items || [];
    const cachedRows = dedupeMessagesStable([...inboxCached, ...sentCached, ...liveRows]);
    const counterpartRows = cachedRows.filter((msg) => mailboxRowMatchesContactConversation(msg, conversationContext));
    if (counterpartRows.length === 0) return {
      ...baseGroup,
      contactEmail: contactEmail || baseGroup.contactEmail || "",
      conversationKey: conversationKeyFromContact(contactEmail || baseGroup.contactEmail || "")
    };

    const rowByThread = new Map();
    const pushRow = (msg) => {
      const threadId = canonicalThreadId(msg && msg.threadId) || normalize(msg && msg.threadId);
      if (!threadId) return;
      const existing = rowByThread.get(threadId);
      const next = { ...msg, threadId };
      if (!existing) {
        rowByThread.set(threadId, next);
        return;
      }
      const chosen = compareMailboxRowsNewestFirst(next, existing) <= 0 ? next : existing;
      rowByThread.set(threadId, chosen);
    };
    for (const item of seededItems) pushRow(item);
    for (const row of counterpartRows) pushRow(row);

    const mergedItems = Array.from(rowByThread.values()).sort(compareMailboxRowsNewestFirst);
    const mergedThreadIds = mergedItems
      .map((item) => canonicalThreadId(item && item.threadId) || normalize(item && item.threadId))
      .filter(Boolean);
    const mergedContactName = (
      normalize(baseGroup.contactName || "")
      || senderDisplayName((mergedItems[0] && mergedItems[0].sender) || "")
      || contactEmail
    );
    logChatDebug("contact-group:counterpart-expansion", {
      contactEmail,
      accountEmail: conversationContext.activeAccountEmail || "",
      beforeThreadCount: Array.isArray(baseGroup.threadIds) ? baseGroup.threadIds.length : 0,
      afterThreadCount: mergedThreadIds.length,
      addedThreadCount: Math.max(0, mergedThreadIds.length - (Array.isArray(baseGroup.threadIds) ? baseGroup.threadIds.length : 0)),
      inboxCached: inboxCached.length,
      sentCached: sentCached.length,
      liveRows: liveRows.length,
      matchedRows: counterpartRows.length,
      sampleThreads: mergedThreadIds.slice(0, 8)
    }, { throttleKey: `counterpart-expansion:${contactEmail}`, throttleMs: 700 });
    return {
      ...baseGroup,
      contactEmail,
      conversationKey: conversationKeyFromContact(contactEmail),
      contactName: mergedContactName,
      items: mergedItems,
      threadIds: mergedThreadIds,
      latestItem: mergedItems[0] || baseGroup.latestItem || null
    };
  }

  function groupMessagesByContact(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const byKey = new Map();
    for (const msg of messages) {
      const key = contactKeyFromMessage(msg);
      if (!key) continue;
      const contactEmail = extractEmail(key || msg.senderEmail || msg.sender || "");
      if (!byKey.has(key)) {
        const senderName = senderDisplayName(msg.sender) || "";
        const senderEmail = extractEmail(msg.senderEmail || msg.sender || "");
        const userEmail = extractEmail(state.activeAccountEmail || state.currentUserEmail || detectCurrentUserEmail());
        const senderIsSelf = Boolean(senderEmail && userEmail && senderEmail === userEmail);
        const name = senderName && !senderIsSelf && !isGenericSenderLabel(senderName)
          ? senderName
          : key;
        byKey.set(key, {
          contactKey: key,
          contactEmail,
          conversationKey: conversationKeyFromContact(contactEmail),
          contactName: name,
          threadIds: [],
          items: [],
          _threadIdSet: new Set()
        });
      }
      const g = byKey.get(key);
      if (!g.contactEmail && contactEmail) {
        g.contactEmail = contactEmail;
        g.conversationKey = conversationKeyFromContact(contactEmail);
      }
      const canonicalTid = canonicalThreadId(msg && msg.threadId);
      const threadKey = canonicalTid || normalize(msg && msg.threadId);
      if (!threadKey) continue;
      if (!g._threadIdSet.has(threadKey)) {
        g._threadIdSet.add(threadKey);
        g.threadIds.push(threadKey);
        g.items.push({ ...msg, threadId: threadKey });
      }
    }
    const groups = Array.from(byKey.values());
    for (const g of groups) {
      g.items.sort((a, b) => {
        const ta = messageDateSortValue(a);
        const tb = messageDateSortValue(b);
        if (ta !== tb) return tb - ta;
        const da = normalize(a.date || "").toLowerCase();
        const db = normalize(b.date || "").toLowerCase();
        return db.localeCompare(da);
      });
      g.threadIds = g.items.map((m) => canonicalThreadId(m.threadId) || normalize(m.threadId || "")).filter(Boolean);
      if (!g.contactEmail) {
        const head = g.items[0] || null;
        const inferred = extractEmail((head && (head.senderEmail || head.sender)) || g.contactKey || "");
        if (inferred) g.contactEmail = inferred;
      }
      g.conversationKey = conversationKeyFromContact(g.contactEmail || "");
      delete g._threadIdSet;
      g.latestItem = g.items[0] || null;
    }
    return groups;
  }

  function threadHashForMailbox(mailbox, threadId, hintHref = "") {
    const box = mailboxCacheKey(mailbox || "inbox");
    const hintedHash = normalizeThreadHashForMailbox(hashFromHref(hintHref || ""), box);
    if (hintedHash && isThreadHash(hintedHash)) return hintedHash;
    const raw = normalize(threadId || "");
    let cleanThreadId = raw.startsWith("#") ? raw.slice(1) : raw;
    if (/^f:[A-Za-z0-9_-]+$/i.test(cleanThreadId)) {
      cleanThreadId = `thread-${cleanThreadId}`;
    }
    if (!cleanThreadId) return `#${box}`;
    return `#${box}/${cleanThreadId}`;
  }

  function applySnippetFallbackToMessages(messages, threadId) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const snippet = normalize(threadSnippetFallback(threadId) || "");
    if (!snippet) return messages;
    return messages.map((msg) => {
      const bodyText = normalize(msg && msg.bodyText);
      if (hasUsefulBodyText(bodyText)) return msg;
      return { ...msg, bodyHtml: "", bodyText: snippet };
    });
  }

  function scoreExtractedMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return -5;
    let score = 0;
    for (const msg of messages) {
      const bodyText = normalize(msg && msg.bodyText);
      const htmlLen = normalize(msg && msg.bodyHtml).length;
      if (hasUsefulBodyText(bodyText)) {
        score += 3 + Math.min(4, Math.floor(bodyText.length / 120));
      } else if (!bodyText || bodyText === THREAD_BODY_PLACEHOLDER || bodyText === THREAD_NO_CONTENT) {
        score -= 1;
      }
      if (htmlLen > 20) score += 1;
    }
    return score;
  }

  async function captureThreadDataWithRetry(threadId, mailbox, maxAttempts = 6, hintHref = "") {
    const threadHintHref = normalize(hintHref || "") || lookupThreadHintHref(threadId);
    const targetHash = threadHashForMailbox(mailbox, threadId, threadHintHref);
    let bestData = { subject: "", messages: [] };
    let bestScore = -Infinity;
    await ensureInboxSdkReady();

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lockStartedAt = Date.now();
      while (state.replySendInProgress && Date.now() - lockStartedAt < 12000) {
        await sleep(120);
      }
      const context = await ensureThreadContextForReply(threadId, mailbox, threadHintHref);
      if (!context.ok && window.location.hash !== targetHash) {
        window.location.hash = targetHash;
      }
      let contextReady = context.ok ? (context.status || threadContextSnapshot(threadId)) : threadContextSnapshot(threadId);
      if (!contextReady.ok) {
        contextReady = await waitForThreadContextForReply(threadId, 5200);
      }
      if (!contextReady.ok) {
        const reopened = openThread(threadId, threadHintHref, lookupThreadRowHint(threadId));
        if (reopened) {
          contextReady = await waitForThreadContextForReply(threadId, 3600);
        }
      }
      if (!contextReady.ok) {
        await sleep(220 + Math.min(380, attempt * 80));
        continue;
      }

      await waitForInboxSdkThreadMessages(threadId, attempt === 0 ? 1200 : 520);
      await sleep(attempt === 0 ? 900 : 520 + Math.min(320, attempt * 55));
      const data = extractOpenThreadData();
      const messages = normalizeThreadMessagesForChat(
        applySnippetFallbackToMessages(Array.isArray(data.messages) ? data.messages : [], threadId),
        threadId
      );
      const sdkMessages = getInboxSdkThreadMessages(threadId);
      const scoredDom = scoreExtractedMessages(messages);
      const scoredSdk = scoreExtractedMessages(sdkMessages);
      if (scoredSdk > scoredDom && hasMeaningfulCapturedMessages(sdkMessages)) {
        if (scoredSdk > bestScore) {
          bestScore = scoredSdk;
          bestData = { ...data, messages: sdkMessages };
        }
      } else if (scoredDom > bestScore) {
        bestScore = scoredDom;
        bestData = { ...data, messages };
      }
      const hasCapturedBody = messages.some((m) => hasUsefulBodyText(m && m.bodyText) || normalize(m && m.bodyHtml).length > 20);
      const hasSdkBody = hasMeaningfulCapturedMessages(sdkMessages);
      if (hasCapturedBody) break;
      if (hasSdkBody) break;
    }

    if (!Array.isArray(bestData.messages) || bestData.messages.length === 0) {
      logWarn(`Thread hydration failed threadId=${normalize(threadId || "")} mailbox=${normalize(mailbox || "")} hint=${threadHintHref ? "yes" : "no"}`);
    }
    return bestData;
  }

  function contactMessageSourceRank(message) {
    const source = normalize((message && (message.source || message.sourceType)) || "").toLowerCase();
    if (source === "gmail_dom" || source === "captured") return 0;
    if (source === "cache" || source === "fallback") return 1;
    if (source === "seeded") return 2;
    if (source === "inferred" || source === "optimistic") return 3;
    return 4;
  }

  function mergeContactMessagesByThread(threadIds, byThread, context = {}) {
    const conversationContext = activeConversationContext(context);
    const seenMessageIds = new Set();
    const seenFallbackKeys = new Set();
    const merged = [];
    const perThreadDebug = [];
    let filteredOutByConversation = 0;
    let dedupByMessageId = 0;
    let dedupByFallback = 0;
    const orderedThreadIds = (Array.isArray(threadIds) ? threadIds : [])
      .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
      .filter(Boolean);
    for (let threadOrder = 0; threadOrder < orderedThreadIds.length; threadOrder += 1) {
      const threadId = orderedThreadIds[threadOrder];
      const source = byThread.get(threadId) || byThread.get(normalize(threadId || ""));
      const sourceMessages = Array.isArray(source) ? source : [];
      const normalizedSource = normalizeThreadMessagesForChat(
        Array.isArray(source) ? source : [],
        threadId,
        conversationContext
      );
      const normalizedThreadMessages = normalizedSource
        .filter((message) => messageBelongsToConversation(message, conversationContext));
      const filteredOutCount = Math.max(0, normalizedSource.length - normalizedThreadMessages.length);
      filteredOutByConversation += filteredOutCount;
      if (perThreadDebug.length < 12) {
        perThreadDebug.push({
          threadId,
          sourceCount: sourceMessages.length,
          normalizedCount: normalizedSource.length,
          afterConversationFilter: normalizedThreadMessages.length,
          filteredOutCount
        });
      }
      if (normalizedThreadMessages.length === 0) continue;
      const hasCapturedCanonical = normalizedThreadMessages.some(
        (msg) => !msg.isSeededPlaceholder && msg.sourceType !== "seeded"
      );
      for (const message of normalizedThreadMessages) {
        if (!message || typeof message !== "object") continue;
        if (hasCapturedCanonical && message.isSeededPlaceholder) continue;
        const messageId = normalize(message.messageId || message.dataMessageId || "");
        if (messageId && seenMessageIds.has(messageId)) {
          dedupByMessageId += 1;
          continue;
        }
        const bodyHash = hashString(normalize(message.cleanBodyText || "").toLowerCase());
        const fallbackKey = [
          canonicalThreadId(threadId),
          normalize(message.senderEmail || message.sender || "").toLowerCase(),
          Number(message.timestampMs || 0),
          bodyHash
        ].join("|");
        if (!messageId && seenFallbackKeys.has(fallbackKey)) {
          dedupByFallback += 1;
          continue;
        }
        if (messageId) seenMessageIds.add(messageId);
        else seenFallbackKeys.add(fallbackKey);
        merged.push({
          ...message,
          threadId,
          __order: merged.length,
          __threadOrder: threadOrder,
          __sourceRank: contactMessageSourceRank(message),
          __sourceIndex: Number.isFinite(Number(message.sourceIndex)) ? Number(message.sourceIndex) : 0
        });
      }
    }
    const finalMessages = merged
      .sort((a, b) => {
        const ta = Number(a.timestampMs || 0);
        const tb = Number(b.timestampMs || 0);
        if (ta !== tb) return ta - tb;
        if (a.__sourceRank !== b.__sourceRank) return a.__sourceRank - b.__sourceRank;
        if (a.__threadOrder === b.__threadOrder && a.__sourceIndex !== b.__sourceIndex) {
          return a.__sourceIndex - b.__sourceIndex;
        }
        return Number(a.__order || 0) - Number(b.__order || 0);
      })
      .map(({ __order, __threadOrder, __sourceIndex, __sourceRank, ...rest }) => rest);
    logChatDebug("contact-merge:final", {
      conversationKey: conversationContext.conversationKey || "",
      contactEmail: conversationContext.contactEmail || "",
      activeAccountEmail: conversationContext.activeAccountEmail || "",
      threadCount: orderedThreadIds.length,
      mergedCount: finalMessages.length,
      filteredOutByConversation,
      dedupByMessageId,
      dedupByFallback,
      threadStats: perThreadDebug,
      sample: summarizeChatMessagesForDebug(finalMessages, 8)
    }, {
      throttleKey: `contact-merge-final:${conversationContext.conversationKey || conversationContext.contactEmail || "unknown"}`,
      throttleMs: 420
    });
    return finalMessages;
  }

  function buildSeededMessagesByThread(group) {
    const byThread = new Map();
    if (!group || !Array.isArray(group.threadIds)) return byThread;
    const fallbackSender = group.contactName || "Unknown sender";
    const itemByThread = new Map();
    for (const item of Array.isArray(group.items) ? group.items : []) {
      const tid = canonicalThreadId(item && item.threadId) || normalize(item && item.threadId);
      if (!tid || itemByThread.has(tid)) continue;
      itemByThread.set(tid, item);
    }
    for (const threadId of group.threadIds) {
      const tid = canonicalThreadId(threadId) || normalize(threadId);
      if (!tid) continue;
      const item = itemByThread.get(tid);
      const sender = isUseful(item && item.sender) ? item.sender : fallbackSender;
      const date = normalize((item && item.date) || "");
      const snippet = normalize(
        (item && item.snippet) ||
        (state.snippetByThreadId && state.snippetByThreadId[tid]) ||
        ""
      );
      const cleanedSnippet = safeThreadFallbackText(snippet);
      byThread.set(tid, [{
        sender: isUseful(sender) ? sender : "Unknown sender",
        date,
        bodyHtml: "",
        bodyText: cleanedSnippet || THREAD_BODY_PLACEHOLDER,
        isSeededPlaceholder: true
      }]);
    }
    return byThread;
  }

  function loadContactChat(group, root) {
    if (!group || !Array.isArray(group.threadIds) || group.threadIds.length === 0) return;
    const route = parseListRoute(window.location.hash || state.lastListHash || "#inbox");
    const defaultMailbox = route.mailbox || "inbox";
    const activeAccountEmail = detectCurrentUserEmail(true) || detectCurrentUserEmail();
    const contactEmailFromGroup = extractEmail(
      group.contactEmail
      || group.contactKey
      || (group.latestItem && (group.latestItem.senderEmail || group.latestItem.sender))
      || ""
    );
    const contactKeyFromGroup = contactEmailFromGroup || normalize(group.contactKey || "");
    const conversationKeyFromGroup = normalize(
      group.conversationKey
      || conversationKeyFromContact(contactEmailFromGroup)
      || (contactKeyFromGroup ? `contact:${contactKeyFromGroup.toLowerCase()}` : "")
    );
    const initialContext = activeConversationContext({
      activeAccountEmail,
      contactEmail: contactEmailFromGroup,
      conversationKey: conversationKeyFromGroup
    });
    const expandedGroup = expandContactGroupWithCachedCounterparts(
      {
        ...group,
        items: Array.isArray(group.items) ? group.items.slice() : [],
        threadIds: Array.isArray(group.threadIds) ? group.threadIds.slice() : []
      },
      initialContext
    );
    const selectedGroup = {
      ...group,
      ...expandedGroup,
      items: Array.isArray(expandedGroup && expandedGroup.items) ? expandedGroup.items.slice() : (Array.isArray(group.items) ? group.items.slice() : []),
      threadIds: Array.isArray(expandedGroup && expandedGroup.threadIds) ? expandedGroup.threadIds.slice() : (Array.isArray(group.threadIds) ? group.threadIds.slice() : [])
    };
    const threadIds = selectedGroup.threadIds
      .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
      .filter(Boolean);
    if (threadIds.length === 0) return;
    const threadMailboxByThreadId = new Map();
    const threadHintByThreadId = new Map();
    for (const item of Array.isArray(selectedGroup.items) ? selectedGroup.items : []) {
      rememberThreadNavigationHint(item && item.threadId, item && item.href, item && item.row);
      const itemThread = canonicalThreadId(item && item.threadId);
      if (!itemThread) continue;
      const itemMailbox = mailboxCacheKey(item && item.mailbox ? item.mailbox : defaultMailbox);
      if (!threadMailboxByThreadId.has(itemThread)) {
        threadMailboxByThreadId.set(itemThread, itemMailbox);
      }
      const itemHint = normalize(item && item.href ? item.href : "");
      if (itemHint && !threadHintByThreadId.has(itemThread)) {
        threadHintByThreadId.set(itemThread, itemHint);
      }
    }
    const mailboxForThread = (threadId) => (
      threadMailboxByThreadId.get(canonicalThreadId(threadId)) || mailboxCacheKey(defaultMailbox)
    );
    const hintForThread = (threadId) => (
      threadHintByThreadId.get(canonicalThreadId(threadId)) || lookupThreadHintHref(threadId)
    );
    const firstThreadMailbox = mailboxForThread(threadIds[0] || "");
    const firstThreadHint = hintForThread(threadIds[0] || "");
    // Inbox list is newest-first; thread view should be oldest-first.
    const displayThreadIds = threadIds.slice().reverse();
    markThreadsReadLocally(
      threadIds,
      (selectedGroup.items || []).map((m) => m && m.row).filter((row) => row instanceof HTMLElement)
    );
    const contactEmail = extractEmail(
      selectedGroup.contactEmail
      || selectedGroup.contactKey
      || (selectedGroup.latestItem && (selectedGroup.latestItem.senderEmail || selectedGroup.latestItem.sender))
      || ""
    );
    const contactKey = contactEmail || normalize(selectedGroup.contactKey || group.contactKey || "");
    const conversationKey = normalize(
      selectedGroup.conversationKey
      || conversationKeyFromContact(contactEmail)
      || (contactKey ? `contact:${contactKey.toLowerCase()}` : "")
    );
    const conversationContext = activeConversationContext({
      activeAccountEmail,
      contactEmail,
      conversationKey
    });
    logChatDebug("contact-chat:open", {
      requestedContact: contactEmailFromGroup,
      resolvedContact: conversationContext.contactEmail || contactEmail,
      accountEmail: conversationContext.activeAccountEmail || "",
      conversationKey: conversationContext.conversationKey || "",
      threadCount: threadIds.length,
      threadSample: threadIds.slice(0, 10),
      sourceItemsCount: Array.isArray(selectedGroup.items) ? selectedGroup.items.length : 0,
      originalThreadCount: Array.isArray(group.threadIds) ? group.threadIds.length : 0
    }, { throttleKey: `contact-chat-open:${conversationContext.conversationKey || contactKey}`, throttleMs: 400 });
    state.suspendHashSyncDuringContactHydration = true;
    state.contactChatLoading = true;
    state.contactThreadIds = threadIds.slice();
    state.contactDisplayName = selectedGroup.contactName || (selectedGroup.latestItem && senderDisplayName(selectedGroup.latestItem.sender)) || "Chat";
    state.activeContactKey = contactKey;
    state.activeContactEmail = conversationContext.contactEmail || contactEmail || "";
    state.activeConversationKey = conversationContext.conversationKey || conversationKey || "";
    state.activeAccountEmail = conversationContext.activeAccountEmail || activeAccountEmail || state.activeAccountEmail;
    state.currentView = "thread";
    state.activeThreadId = threadIds[0] || "";
    state.mergedMessages = [];
    state.currentThreadIdForReply = "";
    state.currentThreadHintHref = firstThreadHint;
    state.currentThreadMailbox = firstThreadMailbox;
    state.lastListHash = sanitizeListHash(window.location.hash || state.lastListHash || "#inbox");
    if (!state.replySendInProgress) {
      window.location.hash = threadHashForMailbox(firstThreadMailbox, threadIds[0] || "", firstThreadHint);
    }

    // Render instantly using list snippets, then hydrate with real bodies in background.
    const seededByThread = buildSeededMessagesByThread({
      ...selectedGroup,
      threadIds
    });
    const seededSenderByThread = new Map();
    const seededDateByThread = new Map();
    for (const threadId of threadIds) {
      const seeded = seededByThread.get(threadId);
      const seedSender = Array.isArray(seeded) && seeded[0] ? normalize(seeded[0].sender || "") : "";
      const seedDate = Array.isArray(seeded) && seeded[0] ? normalize(seeded[0].date || "") : "";
      if (seedSender) seededSenderByThread.set(threadId, seedSender);
      if (seedDate) seededDateByThread.set(threadId, seedDate);
    }
    state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, seededByThread, conversationContext);
    state.currentThreadIdForReply = threadIds[0] || "";
    state.currentThreadHintHref = firstThreadHint;
    state.currentThreadMailbox = firstThreadMailbox;
    state.contactChatLoading = false;
    renderList(root);
    renderCurrentView(root);

    const isStillActiveContactChat = () => {
      const activeConversation = normalize(state.activeConversationKey || "");
      const expectedConversation = normalize(conversationContext.conversationKey || "");
      if (activeConversation && expectedConversation) return activeConversation === expectedConversation;
      return normalize(state.activeContactKey || "") === normalize(contactKey || "");
    };

    (async () => {
      const resolvedByThread = new Map(seededByThread);
      const primaryAttempts = threadIds.length > 8 ? 3 : 4;
      const secondaryAttempts = threadIds.length > 8 ? 2 : 3;
      for (let i = 0; i < threadIds.length; i += 1) {
        if (!isStillActiveContactChat()) return;
        const threadId = threadIds[i];
        const threadMailbox = mailboxForThread(threadId);
        const threadHint = hintForThread(threadId);
        const attempts = i === 0 ? primaryAttempts : secondaryAttempts;
        const data = await captureThreadDataWithRetry(threadId, threadMailbox, attempts, threadHint);
        const captured = applySnippetFallbackToMessages(Array.isArray(data.messages) ? data.messages : [], threadId);
        const meaningfulCaptured = hasMeaningfulCapturedMessages(captured);
        let keptMode = "none";
        let keptCount = 0;
        if (meaningfulCaptured) {
          const seedSender = seededSenderByThread.get(threadId) || "";
          const seedDate = seededDateByThread.get(threadId) || "";
          const normalizedCaptured = normalizeThreadMessagesForChat(
            captured.map((msg) => {
              const nextSender = choosePreferredSender(msg && msg.sender, seedSender);
              return {
                ...msg,
                sender: nextSender || normalize(msg && msg.sender) || seedSender || "Unknown sender",
                date: normalize(msg && msg.date) || seedDate || ""
              };
            }),
            threadId,
            conversationContext
          );
          const inConversation = normalizedCaptured.filter((msg) => (
            messageBelongsToConversation(msg, conversationContext)
          ));
          if (inConversation.length > 0) {
            resolvedByThread.set(threadId, inConversation);
            keptMode = "conversation-filtered";
            keptCount = inConversation.length;
          } else if (
            normalizedCaptured.some((msg) => {
              const senderEmail = extractEmail(msg && (msg.senderEmail || msg.sender));
              return (
                senderEmail
                && (
                  senderEmail === conversationContext.contactEmail
                  || senderEmail === conversationContext.activeAccountEmail
                )
              );
            })
          ) {
            resolvedByThread.set(threadId, normalizedCaptured);
            keptMode = "sender-fallback";
            keptCount = normalizedCaptured.length;
          }
        } else if (DEBUG_THREAD_EXTRACT) {
          console.log(`[reskin] Hydration skipped placeholder-only capture for thread ${threadId}`);
        }
        state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, resolvedByThread, conversationContext);
        logChatDebug("contact-chat:hydration-step", {
          threadId,
          index: i,
          totalThreads: threadIds.length,
          mailbox: threadMailbox,
          attempts,
          capturedCount: Array.isArray(captured) ? captured.length : 0,
          meaningfulCaptured,
          keptMode,
          keptCount,
          mergedCount: Array.isArray(state.mergedMessages) ? state.mergedMessages.length : 0
        }, { throttleKey: `contact-hydration-step:${conversationContext.conversationKey || contactKey}:${threadId}`, throttleMs: 300 });
        state.currentThreadIdForReply = threadIds[0] || "";
        state.currentThreadHintHref = firstThreadHint;
        state.currentThreadMailbox = firstThreadMailbox;
        const shouldRefreshNow = i === 0 || i === threadIds.length - 1 || i % 2 === 1;
        const latestRoot = document.getElementById(ROOT_ID);
        if (shouldRefreshNow && latestRoot instanceof HTMLElement && state.currentView === "thread" && isStillActiveContactChat()) {
          renderThread(latestRoot);
        }
      }
      if (!isStillActiveContactChat()) return;
      state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, resolvedByThread, conversationContext);
      state.currentThreadIdForReply = threadIds[0] || "";
      state.currentThreadHintHref = firstThreadHint;
      state.currentThreadMailbox = firstThreadMailbox;
      state.contactChatLoading = false;
      state.suspendHashSyncDuringContactHydration = false;
      if (!state.replySendInProgress) {
        window.location.hash = threadHashForMailbox(firstThreadMailbox, threadIds[0] || "", firstThreadHint);
      }
      const latestRoot = document.getElementById(ROOT_ID);
      if (latestRoot instanceof HTMLElement) {
        renderCurrentView(latestRoot);
        renderThread(latestRoot);
      }
    })().catch((error) => {
      const stillActive = isStillActiveContactChat();
      if (stillActive) {
        state.contactChatLoading = false;
        state.suspendHashSyncDuringContactHydration = false;
      }
      logWarn(`Contact thread merge failed: ${normalize(error && error.message ? error.message : String(error || ""))}`);
      const latestRoot = document.getElementById(ROOT_ID);
      if (stillActive && latestRoot instanceof HTMLElement) {
        renderCurrentView(latestRoot);
        renderThread(latestRoot);
      }
    });
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

    if (ENABLE_CONTACT_MERGE_MODE && state.contactChatLoading) {
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
    let renderThreadId = canonicalThreadId(
      state.currentThreadIdForReply ||
      threadIdFromHash(window.location.hash || "") ||
      state.activeThreadId ||
      ""
    ) || normalize(
      state.currentThreadIdForReply ||
      threadIdFromHash(window.location.hash || "") ||
      state.activeThreadId ||
      ""
    );
    if (renderThreadId && !isThreadHash(window.location.hash || "") && !state.replySendInProgress) {
      const targetMailbox = mailboxCacheKey(
        state.currentThreadMailbox
        || activeMailbox()
        || "inbox"
      );
      const targetHash = threadHashForMailbox(
        targetMailbox,
        renderThreadId,
        state.currentThreadHintHref || lookupThreadHintHref(renderThreadId)
      );
      if (normalize(targetHash) && normalize(targetHash) !== normalize(window.location.hash || "")) {
        window.location.hash = targetHash;
      }
    }
    const readyState = waitForThreadContentReady(renderThreadId || normalize(state.activeThreadId || ""));
    const readiness = readyState.readiness;
    logChatDebug("thread-extract:containers", {
      threadId: renderThreadId || normalize(state.activeThreadId || ""),
      readiness
    }, {
      throttleKey: `thread-extract-containers:${renderThreadId || normalize(state.activeThreadId || "unknown")}`,
      throttleMs: 260
    });

    if (!readyState.ready && !readyState.timedOut) {
      const retryAttempt = readyState.attempt;
      const waitMs = readyState.waitMs;
      logChatDebug("thread-open:timeout", {
        threadId: renderThreadId || normalize(state.activeThreadId || ""),
        attempt: retryAttempt,
        waitMs,
        readiness
      }, { throttleKey: `thread-open-timeout:${renderThreadId || "unknown"}:${retryAttempt}`, throttleMs: 220 });
      wrap.innerHTML = `
        <section class="rv-thread rv-thread-chat" data-reskin="true">
          <div class="rv-thread-chat-header" data-reskin="true">
            <button type="button" class="rv-back" data-reskin="true">\u2190 Back</button>
            <h2 class="rv-thread-subject" data-reskin="true">Loading thread…</h2>
          </div>
          <div class="rv-thread-messages" data-reskin="true" style="display:flex;align-items:center;justify-content:center;padding:40px;">
            <p class="rv-thread-empty" data-reskin="true" style="color:#949ba4;">Waiting for Gmail thread content…</p>
          </div>
        </section>
      `;
      setTimeout(() => {
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          renderThread(latestRoot);
        }
      }, waitMs);
      return;
    }
    if (readyState.ready && readyState.attempt > 0) {
      logChatDebug("thread-open:ready", {
        threadId: renderThreadId || normalize(state.activeThreadId || ""),
        attempts: readyState.attempt,
        readiness
      }, { throttleKey: `thread-open-ready:${renderThreadId || "unknown"}`, throttleMs: 420 });
      state.threadExtractRetry = 0;
    }
    if (!readyState.ready && readyState.timedOut) {
      logChatDebug("thread-open:timeout", {
        threadId: renderThreadId || normalize(state.activeThreadId || ""),
        attempt: readyState.attempt,
        waitMs: 0,
        readiness,
        maxRetries: THREAD_READY_MAX_RETRIES
      }, { throttleKey: `thread-open-timeout-final:${renderThreadId || "unknown"}`, throttleMs: 1000 });
    }

    if (ENABLE_CONTACT_MERGE_MODE && Array.isArray(state.mergedMessages) && state.mergedMessages.length > 0) {
      thread = { subject: `Chat with ${state.contactDisplayName || "contact"}` };
      messages = normalizeThreadMessagesForChat(state.mergedMessages, renderThreadId, activeConversationContext());
    } else {
      thread = extractOpenThreadData();
      messages = normalizeThreadMessagesForChat(
        Array.isArray(thread.messages) ? thread.messages : [],
        renderThreadId,
        activeConversationContext()
      );
      // Keep Gmail DOM order; lexical date sorting can invert chronology.
      const bodyMissing = messages.length === 1 && (messages[0].bodyText || "").trim() === THREAD_BODY_PLACEHOLDER;
      if (bodyMissing && state.threadExtractRetry < THREAD_READY_MAX_RETRIES) {
        state.threadExtractRetry += 1;
        setTimeout(() => {
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
            renderThread(latestRoot);
          }
        }, THREAD_READY_RETRY_BASE_MS + 420);
      } else if (!bodyMissing) {
        state.threadExtractRetry = 0;
      }
    }
    const inContactChatMode = Boolean(
      ENABLE_CONTACT_MERGE_MODE &&
      (normalize(state.activeConversationKey || "") || normalize(state.activeContactKey || "")) &&
      Array.isArray(state.contactThreadIds) &&
      state.contactThreadIds.length > 0
    );
    const headerTitle = inContactChatMode
      ? `Chat with ${state.contactDisplayName || senderDisplayName((messages[0] && messages[0].sender) || "") || "contact"}`
      : (
        (Array.isArray(messages) && messages.length > 0 && senderDisplayName(messages[0].sender))
          ? `Chat with ${senderDisplayName(messages[0].sender)}`
          : (thread.subject || "Chat")
      );
    const placeholderBody = THREAD_BODY_PLACEHOLDER;
    const activeThreadForSnippet = threadIdFromHash(window.location.hash) || state.activeThreadId;
    if (messages.length > 1) {
      const usefulCount = messages.filter((msg) => hasUsefulBodyText(msg && msg.cleanBodyText)).length;
      if (usefulCount > 0) {
        messages = messages.filter((msg) => hasUsefulBodyText(msg && msg.cleanBodyText));
      }
    }
    if (!renderThreadId) {
      renderThreadId = canonicalThreadId(
        state.currentThreadIdForReply ||
        activeThreadForSnippet ||
        (messages[0] && messages[0].threadId) ||
        ""
      ) || normalize(
        state.currentThreadIdForReply ||
        activeThreadForSnippet ||
        (messages[0] && messages[0].threadId) ||
        ""
      );
    }
    messages = mergeOptimisticIntoMessages(messages, renderThreadId);
    const emptyOrPlaceholder = messages.length === 0 || messages.every((msg) => (
      !hasUsefulBodyText(msg && msg.cleanBodyText)
      || normalize((msg && msg.cleanBodyText) || "") === THREAD_BODY_PLACEHOLDER
    ));
    if (emptyOrPlaceholder) {
      logChatDebug("thread-extract:empty", {
        threadId: renderThreadId,
        messageCount: messages.length,
        readiness
      }, { throttleKey: `thread-extract-empty:${renderThreadId || "unknown"}`, throttleMs: 700 });
    }
    const directionCounts = { incoming: 0, outgoing: 0, unknown: 0 };
    for (const msg of messages) {
      const direction = normalize(msg && msg.direction || "");
      if (direction === "outgoing") directionCounts.outgoing += 1;
      else if (direction === "incoming") directionCounts.incoming += 1;
      else directionCounts.unknown += 1;
    }
    logChatDebug("thread-render:timeline", {
      conversationKey: state.activeConversationKey || "",
      contactEmail: state.activeContactEmail || "",
      activeAccountEmail: state.activeAccountEmail || "",
      renderThreadId,
      totalMessages: messages.length,
      directionCounts,
      sample: summarizeChatMessagesForDebug(messages, 8)
    }, {
      throttleKey: `thread-render:${state.activeConversationKey || renderThreadId || "single-thread"}`,
      throttleMs: 350
    });
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] renderThread: displaying ${messages.length} message(s) in thread view`);
    }

    const senderName = (raw) => {
      const s = (raw || "").trim();
      const m = s.match(/^(.+?)\s*<[^>]+>$/);
      return m ? m[1].trim() : s;
    };

    const stableContactLabel = (() => {
      const explicit = normalize(state.contactDisplayName || "");
      if (explicit && !isGenericSenderLabel(explicit)) return explicit;
      const contactEmail = extractEmail(state.activeContactEmail || activeConversationContactEmail() || "");
      if (!contactEmail) return "Contact";
      const local = normalize(contactEmail.split("@")[0] || "");
      return local || contactEmail;
    })();

    const stableIncomingLabelBySenderEmail = new Map();
    for (const msg of messages) {
      const direction = normalize(msg && msg.direction) === "outgoing" ? "outgoing" : "incoming";
      if (direction === "outgoing") continue;
      const senderEmail = extractEmail((msg && msg.senderEmail) || (msg && msg.sender) || "");
      if (!senderEmail || stableIncomingLabelBySenderEmail.has(senderEmail)) continue;
      const candidate = normalize(senderName(msg && msg.sender));
      if (candidate && !isGenericSenderLabel(candidate)) {
        stableIncomingLabelBySenderEmail.set(senderEmail, candidate);
        continue;
      }
      const fallback = normalize(senderDisplayName((msg && msg.sender) || "")) || senderEmail;
      stableIncomingLabelBySenderEmail.set(senderEmail, fallback);
    }

    const messageRows = messages.map((msg) => {
      const direction = normalize(msg && msg.direction) === "outgoing" ? "outgoing" : "incoming";
      const directionClass = direction === "outgoing" ? "rv-thread-msg--outgoing" : "rv-thread-msg--incoming";
      const status = normalize((msg && msg.deliveryState) || (msg && msg.optimisticStatus));
      const isUnverifiedSent = Boolean(msg && msg.optimisticUnverifiedAt);
      const statusLabel = msg && msg.isOptimistic
        ? (status === "sent" ? (isUnverifiedSent ? "Sent (syncing)" : "Sent") : (status === "failed" ? "Failed" : "Sending..."))
        : "";
      const incomingSenderEmail = extractEmail((msg && msg.senderEmail) || (msg && msg.sender) || "");
      const incomingFallbackLabel = normalize(
        senderName(msg && msg.sender)
        || senderDisplayName((msg && msg.sender) || "")
        || stableContactLabel
      ) || "Contact";
      const senderLabel = direction === "outgoing"
        ? "You"
        : (
          inContactChatMode
            ? stableContactLabel
            : (
              incomingSenderEmail
                ? (stableIncomingLabelBySenderEmail.get(incomingSenderEmail) || incomingFallbackLabel)
                : incomingFallbackLabel
            )
        );
      const bodyText = normalize((msg && msg.cleanBodyText) || (msg && msg.bodyText) || "");
      const initial = initialForSender(senderLabel || (msg && msg.sender));
      return `
        <div class="rv-thread-msg ${directionClass}${msg && msg.isOptimistic ? " rv-thread-msg--optimistic" : ""}${status === "failed" ? " rv-thread-msg--failed" : ""}" data-reskin="true" data-message-key="${escapeHtml(msg && msg.messageKey)}" data-thread-id="${escapeHtml(msg && msg.threadId)}">
          <div class="rv-thread-msg-avatar" data-reskin="true" title="${escapeHtml(senderLabel || "")}">${escapeHtml(initial)}</div>
          <div class="rv-thread-msg-content" data-reskin="true">
            <div class="rv-thread-msg-head" data-reskin="true">
              <span class="rv-thread-msg-sender" data-reskin="true">${escapeHtml(senderLabel || "Unknown sender")}</span>
              <span class="rv-thread-msg-date" data-reskin="true">${escapeHtml(msg && msg.date)}</span>
              ${statusLabel ? `<span class="rv-thread-msg-status" data-reskin="true">${escapeHtml(statusLabel)}</span>` : ""}
            </div>
            <div class="rv-thread-msg-body rv-thread-msg-plain" data-reskin="true">${escapeHtml(bodyText || THREAD_NO_CONTENT)}</div>
          </div>
        </div>
      `;
    }).join("");
    const inputDisabledAttr = state.replySendInProgress ? ' disabled="true"' : "";
    const sendDisabledAttr = state.replySendInProgress ? ' disabled="true"' : "";
    const sendLabel = state.replySendInProgress ? "Sending..." : "Send";

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
          <input type="text" class="rv-thread-input" placeholder="Type a message..." data-reskin="true"${inputDisabledAttr} />
          <button type="button" class="rv-thread-send" data-reskin="true"${sendDisabledAttr}>${escapeHtml(sendLabel)}</button>
        </div>
      </section>
    `;

    const threadInput = wrap.querySelector(".rv-thread-input");
    const replyDraftThreadId = normalize(renderThreadId || state.currentThreadIdForReply || state.activeThreadId || "");
    if (threadInput instanceof HTMLInputElement) {
      const draftValue = getReplyDraft(replyDraftThreadId);
      if (draftValue && threadInput.value !== draftValue) {
        threadInput.value = draftValue;
      }
      threadInput.addEventListener("input", () => {
        setReplyDraft(replyDraftThreadId, threadInput.value || "");
      });
      threadInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitThreadReply(root);
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
      await runFullMailboxScan(listRoot, { mailboxes: ["inbox"] });
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
    const result = collectMessages(500);
    const liveMessages = result.items || [];
    const mergedCache = mergeMailboxCache(mailbox, liveMessages);
    const sourcePool = mailboxMessagesForList(mailbox, mergedCache.length >= liveMessages.length ? mergedCache : liveMessages);
    const allMessages = sourcePool.slice();
    const scanProgress = state.mailboxScanProgress[mailbox] || {};
    const scanMarker = `${scanProgress.pagesScanned || 0}:${scanProgress.cachedCount || mergedCache.length}:${scanProgress.lastUpdatedAt || 0}`;

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

    let groupingMessages = mailbox === "inbox" ? chatScopeMessages(mailbox, liveMessages) : messages.slice();
    if (state.currentServerId && mailbox === "inbox") {
      const server = state.servers.find((s) => s.id === state.currentServerId);
      if (server) groupingMessages = groupingMessages.filter((msg) => threadIdInServer(msg.threadId, server));
    }
    if (q) {
      groupingMessages = groupingMessages.filter((msg) => {
        const s = normalize(msg.sender || "").toLowerCase();
        const subj = normalize(msg.subject || "").toLowerCase();
        const snip = normalize(msg.snippet || "").toLowerCase();
        return s.includes(q) || subj.includes(q) || snip.includes(q);
      });
    }

    const visibleLimit = Math.max(state.listChunkSize, Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize));
    const groupedMessages = ENABLE_CONTACT_MERGE_MODE ? groupMessagesByContact(groupingMessages) : [];
    const useGroups = ENABLE_CONTACT_MERGE_MODE && groupedMessages.length > 0;
    const visibleMessages = messages.slice(0, visibleLimit);
    const visibleGroups = groupedMessages.slice(0, visibleLimit);

    const listSignature = useGroups
      ? `${route.hash}|g|${groupingMessages.length}|${visibleGroups.length}|${scanMarker}|${visibleGroups.map((g) => `${g.contactKey}:${g.threadIds.length}:${(g.latestItem && g.latestItem.threadId) || ""}`).join(",")}`
      : `${route.hash}|m|${messages.length}|${visibleMessages.length}|${scanMarker}|${visibleMessages.map((m) => `${m.threadId}:${m.triageLevel || "u"}:${m.unread ? "1" : "0"}`).join(",")}`;
    const hasVisible = useGroups ? visibleGroups.length > 0 : visibleMessages.length > 0;
    if (state.lastListSignature === listSignature && !interactionsLocked() && hasVisible) return;
    state.lastListSignature = listSignature;
    state.snippetByThreadId = state.snippetByThreadId || {};
    const hintMessages = useGroups
      ? visibleGroups.flatMap((g) => Array.isArray(g.items) ? g.items : [])
      : visibleMessages;
    for (const m of hintMessages) {
      const snippet = normalize(m && m.snippet) ? m.snippet : "";
      if (m && m.threadId && snippet) {
        for (const key of threadHintKeysForThread(m.threadId)) {
          state.snippetByThreadId[key] = snippet;
        }
      }
      rememberThreadNavigationHint(m.threadId, m.href, m.row);
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

    const renderedCount = useGroups ? visibleGroups.length : visibleMessages.length;
    if (state.lastRenderedCount !== renderedCount) {
      state.lastRenderedCount = renderedCount;
      logInfo(`Rendered ${renderedCount} messages`);
    }

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rv-empty";
      empty.setAttribute("data-reskin", "true");
      empty.textContent = TRIAGE_LEVELS.includes(filterLevel)
        ? `No ${triageLabelText(filterLevel)} inbox messages captured yet.`
        : "No messages captured yet.";
      list.appendChild(empty);
      if ((route.mailbox === "inbox" || route.mailbox === "sent") && !state.fullScanRunning && !state.fullScanCompletedByMailbox[mailbox]) {
        state.fullScanStatus = route.mailbox === "sent" ? "Loading sent…" : "Loading inbox…";
        renderSidebar(root);
        if (route.mailbox === "inbox") {
          setTimeout(() => runFullMailboxScan(root, { mailboxes: ["inbox", "sent"] }), 400);
        } else {
          setTimeout(() => runFullMailboxScan(root, { mailboxes: ["sent"] }), 400);
        }
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
      const displayItems = useGroups
        ? visibleGroups.map((g) => ({ type: "contact", group: g }))
        : visibleMessages.map((msg) => ({ type: "single", msg }));

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
            clearContactConversationState();
            state.lockListView = false;
            state.currentView = "thread";
            state.threadExtractRetry = 0;
            state.activeThreadId = msg.threadId;
            state.currentThreadMailbox = mailboxCacheKey(msg.mailbox || route.mailbox || "inbox");
            rememberThreadNavigationHint(msg.threadId, msg.href, msg.row);
            state.currentThreadHintHref = normalize(msg.href || "") || lookupThreadHintHref(msg.threadId);
            state.currentThreadIdForReply = normalize(msg.threadId || "");
            logChatDebug("thread-open:start", {
              threadId: normalize(msg.threadId || ""),
              mailbox: state.currentThreadMailbox,
              hash: normalize(window.location.hash || ""),
              hintHref: state.currentThreadHintHref || ""
            }, { throttleKey: `thread-open-start:${normalize(msg.threadId || "")}`, throttleMs: 400 });
            const threadHash = msg.href && msg.href.includes("#")
              ? msg.href.slice(msg.href.indexOf("#"))
              : (msg.threadId ? `#${state.currentThreadMailbox}/${msg.threadId}` : "");
            if (threadHash && isThreadHash(threadHash)) {
              state.lastListHash = `#${mailboxCacheKey(route.mailbox || "inbox")}`;
              window.location.hash = threadHash;
            } else if (msg.threadId) {
              state.lastListHash = `#${mailboxCacheKey(route.mailbox || "inbox")}`;
              window.location.hash = `#${state.currentThreadMailbox}/${msg.threadId}`;
            }
            renderList(root);
            renderCurrentView(root);
            const ok = openThread(msg.threadId, msg.href, msg.row);
            if (!ok) {
              logWarn("Failed to open thread from custom view.", { threadId: msg.threadId });
              state.currentView = "list";
              state.activeThreadId = "";
              state.currentThreadIdForReply = "";
              state.currentThreadHintHref = "";
              state.currentThreadMailbox = "";
              clearContactConversationState();
              renderList(root);
              renderCurrentView(root);
              return;
            }
            logChatDebug("thread-open:ready", {
              threadId: normalize(msg.threadId || ""),
              mailbox: state.currentThreadMailbox,
              via: "openThread"
            }, { throttleKey: `thread-open-ready-immediate:${normalize(msg.threadId || "")}`, throttleMs: 300 });
            markThreadsReadLocally([msg.threadId], [msg.row]);
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

      const summaryTargets = useGroups
        ? visibleGroups.map((g) => g.latestItem).filter(Boolean).slice(0, 30)
        : visibleMessages.slice(0, 30);
      queueSummariesForMessages(summaryTargets);

      const renderedCount = useGroups ? visibleGroups.length : visibleMessages.length;
      const totalCount = useGroups ? groupedMessages.length : messages.length;
      if (renderedCount < totalCount) {
        const loadMore = document.createElement("button");
        loadMore.type = "button";
        loadMore.className = "rv-list-more";
        loadMore.setAttribute("data-reskin", "true");
        loadMore.textContent = `Load more (${renderedCount}/${totalCount})`;
        list.appendChild(loadMore);
      }
    }

    if (route.mailbox === "inbox" || route.mailbox === "sent") {
      list.onscroll = () => {
        if (state.currentView !== "list") return;
        const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_LOAD_MORE_DISTANCE_PX;
        const nearEndPrefetch =
          list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_PREFETCH_DISTANCE_PX;
        if (!nearBottom && !nearEndPrefetch) return;
        const current = Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize);
        const totalCount = useGroups ? groupedMessages.length : messages.length;
        if (nearBottom && current < totalCount) {
          state.listVisibleByMailbox[mailbox] = current + state.listChunkSize;
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement) renderList(latestRoot);
          return;
        }
        if (nearEndPrefetch && !state.fullScanCompletedByMailbox[mailbox] && !state.fullScanRunning) {
          if (route.mailbox === "inbox") runFullMailboxScan(root, { mailboxes: ["inbox", "sent"] });
          else runFullMailboxScan(root, { mailboxes: ["sent"] });
        }
      };
      if (!state.fullScanCompletedByMailbox[mailbox] && !state.fullScanRunning) {
        if (route.mailbox === "inbox") {
          setTimeout(() => runFullMailboxScan(root, { mailboxes: ["inbox", "sent"] }), 220);
        } else {
          setTimeout(() => runFullMailboxScan(root, { mailboxes: ["sent"] }), 220);
        }
      }
      if (route.mailbox === "inbox") {
        setTimeout(() => {
          runTriageForInbox({ force: false, processAll: true, source: "auto" });
        }, 120);
      }
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
    const busy = normalize(main.getAttribute("aria-busy") || "");
    if (isThreadHash(hash) || state.currentView === "thread") {
      const messageNodes = main.querySelectorAll(THREAD_MESSAGE_SELECTORS).length;
      const bodyNodes = main.querySelectorAll(BODY_SELECTORS).length;
      let lastMessageId = "";
      const messageEls = Array.from(main.querySelectorAll(THREAD_MESSAGE_SELECTORS));
      if (messageEls.length > 0) {
        const lastEl = messageEls[messageEls.length - 1];
        if (lastEl instanceof HTMLElement) {
          lastMessageId = normalize(
            lastEl.getAttribute("data-message-id")
            || lastEl.getAttribute("data-legacy-message-id")
            || ""
          );
        }
      }
      let lastBodyPreview = "";
      const bodyEls = Array.from(main.querySelectorAll(BODY_SELECTORS));
      if (bodyEls.length > 0) {
        const lastBodyEl = bodyEls[bodyEls.length - 1];
        if (lastBodyEl instanceof HTMLElement) {
          lastBodyPreview = normalize(lastBodyEl.innerText || lastBodyEl.textContent).slice(0, 96);
        }
      }
      return `${hash}|${state.currentView}|thread|${busy}|${messageNodes}|${bodyNodes}|${lastMessageId}|${lastBodyPreview}`;
    }
    const firstRow =
      main.querySelector('[data-thread-id], [data-legacy-thread-id], tr[role="row"], [role="option"]') || null;
    const visibleRows = main.querySelectorAll('tr.zA, [role="row"][data-thread-id], [role="row"][data-legacy-thread-id], [role="option"][data-thread-id], [role="option"][data-legacy-thread-id]').length;
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
    const mailbox = mailboxCacheKey(mailboxKeyFromHash(hash || state.lastListHash || "#inbox"));
    const cachedCount = Array.isArray(state.scannedMailboxMessages[mailbox]) ? state.scannedMailboxMessages[mailbox].length : 0;
    const progress = state.mailboxScanProgress[mailbox] || {};
    const progressMarker = `${progress.pagesScanned || 0}:${progress.cachedCount || cachedCount}:${progress.lastUpdatedAt || 0}`;
    return `${hash}|${state.currentView}|${busy}|${visibleRows}|${firstRowId}|${cachedCount}|${progressMarker}`;
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
          ensureInboxSdkReady().catch((error) => {
            logWarn(`InboxSDK bootstrap failed: ${normalize(error && error.message ? error.message : String(error || ""))}`);
          });
          setTimeout(() => {
            const root = document.getElementById(ROOT_ID);
            if (!(root instanceof HTMLElement)) return;
            if (state.currentView !== "list") return;
            if (state.fullScanRunning) return;
            runFullMailboxScan(root, { mailboxes: ["inbox", "sent"] });
          }, 600);
        });
    }, 200);
  }

  function buildChatDebugApi() {
    return {
      enable: () => setChatDebugEnabled(true),
      disable: () => setChatDebugEnabled(false),
      set: (enabled) => setChatDebugEnabled(enabled),
      isEnabled: () => chatDebugEnabled(),
      detectAccountNow: () => detectCurrentUserEmail(true),
      dumpState: () => ({
        view: normalize(state.currentView || ""),
        activeThreadId: normalize(state.activeThreadId || ""),
        threadContext: activeThreadTimelineContext(),
        activeAccountEmail: extractEmail(state.activeAccountEmail || state.currentUserEmail || ""),
        mergedCount: Array.isArray(state.mergedMessages) ? state.mergedMessages.length : 0,
        mergedSample: summarizeChatMessagesForDebug(state.mergedMessages || [], 12),
        threadExtractRetry: Number(state.threadExtractRetry || 0)
      }),
      dumpMailboxCache: () => ({
        inboxCount: Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
          ? state.scannedMailboxMessages[mailboxCacheKey("inbox")].length
          : 0,
        sentCount: Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
          ? state.scannedMailboxMessages[mailboxCacheKey("sent")].length
          : 0
      }),
      dumpReplyDebug: () => (
        window.ReskinCompose && typeof window.ReskinCompose.getLastReplyDebug === "function"
          ? window.ReskinCompose.getLastReplyDebug()
          : null
      ),
      dumpAccountState: () => ({
        currentUserEmail: extractEmail(state.currentUserEmail || ""),
        activeAccountEmail: extractEmail(state.activeAccountEmail || ""),
        detectedAt: Number(state.currentUserEmailDetectedAt || 0),
        hash: normalize(window.location.hash || "")
      })
    };
  }

  function installDebugBridgeListener() {
    if (installDebugBridgeListener._installed) return;
    installDebugBridgeListener._installed = true;
    window.addEventListener(DEBUG_BRIDGE_REQUEST_EVENT, async (event) => {
      const detail = event && event.detail && typeof event.detail === "object" ? event.detail : {};
      const id = normalize(detail.id || "");
      const method = normalize(detail.method || "");
      const args = Array.isArray(detail.args) ? detail.args : [];
      const api = buildChatDebugApi();
      let ok = true;
      let result = null;
      let error = "";
      try {
        if (!method || typeof api[method] !== "function") {
          throw new Error(`Unknown debug method: ${method || "(empty)"}`);
        }
        result = await api[method](...args);
      } catch (err) {
        ok = false;
        error = normalize(err && err.message ? err.message : String(err || "debug bridge failure"));
      }
      window.dispatchEvent(new CustomEvent(DEBUG_BRIDGE_RESPONSE_EVENT, {
        detail: { id, ok, result, error }
      }));
    });
  }

  function installPageDebugBridge() {
    if (installPageDebugBridge._installed) return;
    installPageDebugBridge._installed = true;
    if (document.getElementById(DEBUG_BRIDGE_SCRIPT_ID)) return;
    const runtime = (
      typeof chrome !== "undefined"
      && chrome
      && chrome.runtime
      && typeof chrome.runtime.getURL === "function"
    )
      ? chrome.runtime
      : null;
    if (!runtime) return;
    const target = document.documentElement || document.head || document.body;
    if (!(target instanceof HTMLElement)) return;
    const script = document.createElement("script");
    script.id = DEBUG_BRIDGE_SCRIPT_ID;
    script.src = runtime.getURL("page-debug-bridge.js");
    script.async = false;
    script.setAttribute("data-reskin", "true");
    script.addEventListener("load", () => {
      script.remove();
    }, { once: true });
    script.addEventListener("error", () => {
      script.remove();
      logChatDebug("chat-debug:bridge-failed", {
        reason: "page-debug-script-load-failed"
      }, { throttleKey: "chat-debug-bridge-failed", throttleMs: 2000 });
    }, { once: true });
    target.appendChild(script);
  }

  function exposeChatDebugControls() {
    try {
      globalThis.ReskinChatDebug = buildChatDebugApi();
      installDebugBridgeListener();
      installPageDebugBridge();
      logChatDebug("chat-debug:controls-ready", {
        hint: "Page console: await window.ReskinChatDebug.dumpState(); Content world: window.ReskinChatDebug.dumpState()"
      }, { throttleKey: "chat-debug-controls-ready", throttleMs: 5000 });
    } catch (_) {
      // ignore global assignment failures
    }
  }

  exposeChatDebugControls();
  waitForReady();
})();
