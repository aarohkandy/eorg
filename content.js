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
    contactThreadIds: [],
    mergedMessages: [],
    currentThreadIdForReply: "",
    currentThreadHintHref: "",
    currentThreadMailbox: "",
    threadHintHrefByThreadId: {},
    threadRowHintByThreadId: {},
    currentUserEmail: "",
    currentUserEmailDetectedAt: 0,
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
    if (!isLowConfidenceSender(captured) && !isLowConfidenceSender(seeded)) {
      const capturedKey = contactKeyFromMessage({ sender: captured });
      const seededKey = contactKeyFromMessage({ sender: seeded });
      if (capturedKey && seededKey && capturedKey !== seededKey) return seeded;
    }
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
      return state.currentUserEmail;
    }

    const selectors = [
      '[data-email]',
      'button[aria-label*="@"]',
      'a[aria-label*="@"]',
      'img[aria-label*="@"]',
      '[aria-label*="Google Account"]',
      '[aria-label*="account"]'
    ];
    const candidates = [];
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement)) continue;
        candidates.push(
          node.getAttribute("data-email"),
          node.getAttribute("email"),
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.textContent
        );
      }
    }
    candidates.push(document.documentElement.getAttribute("lang"));

    for (const value of candidates) {
      const email = extractEmail(value);
      if (!email) continue;
      state.currentUserEmail = email;
      state.currentUserEmailDetectedAt = now;
      return email;
    }

    if (state.currentUserEmail) return state.currentUserEmail;
    logOnce(
      "current-user-email-missing",
      "warn",
      "Current Gmail account email could not be detected; outgoing direction will use heuristic fallback."
    );
    return "";
  }

  function classifyMessageDirection(message, threadId = "") {
    const sender = normalize(message && message.sender);
    const senderEmail = extractEmail((message && message.senderEmail) || sender);
    const userEmail = detectCurrentUserEmail();
    if (senderEmail && userEmail && senderEmail === userEmail) return "outgoing";
    if (!senderEmail && userEmail) {
      const userLocal = normalize(userEmail.split("@")[0] || "").toLowerCase();
      const senderLower = sender.toLowerCase();
      if (userLocal && senderLower && senderLower.includes(userLocal)) return "outgoing";
    }

    const activeContact = normalize(state.activeContactKey || "").toLowerCase();
    if (activeContact) {
      const senderKey = senderEmail || contactKeyFromMessage({ sender });
      if (senderKey && senderKey === activeContact) return "incoming";
    }

    const thread = normalize(threadId || (message && message.threadId) || "");
    if (thread && normalize(state.activeThreadId || "") === thread && senderEmail && userEmail && senderEmail !== userEmail) {
      return "incoming";
    }
    return "unknown";
  }

  function cleanThreadMessageBody(rawText, rawHtml) {
    let htmlText = "";
    const temp = document.createElement("div");
    temp.innerHTML = rawHtml || "";
    temp.querySelectorAll("script, style, meta, link, iframe, object, embed").forEach((el) => el.remove());
    temp.querySelectorAll(".gmail_quote, .gmail_attr, blockquote").forEach((el) => el.remove());
    htmlText = temp.innerText || temp.textContent || "";

    const textSource = String(rawText || "").trim();
    const htmlSource = String(htmlText || "").trim();
    let base = textSource || htmlSource;
    if (htmlSource && (!base || /^on .+ wrote:/i.test(base) || base.length > htmlSource.length * 1.6)) {
      base = htmlSource;
    }
    if (!base) return "";
    const normalized = base
      .replace(/\u00a0/g, " ")
      .replace(/\r/g, "")
      .replace(/\t/g, " ")
      .replace(/[ \f\v]+/g, " ")
      .replace(/(\s)(On .+ wrote:)/gi, "\n$2")
      .replace(/(\s)(From:\s)/gi, "\n$2")
      .replace(/(\s)(Sent:\s)/gi, "\n$2")
      .replace(/(\s)(To:\s)/gi, "\n$2")
      .replace(/(\s)(Subject:\s)/gi, "\n$2")
      .replace(/(\s)(-{2,}\s*Forwarded message\s*-{2,})/gi, "\n$2");
    const lines = normalized
      .split("\n")
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0);

    const cutPatterns = [
      /^on .+ wrote:\s*$/i,
      /^from:\s.+$/i,
      /^sent:\s.+$/i,
      /^to:\s.+$/i,
      /^subject:\s.+$/i,
      /^-{2,}\s*forwarded message\s*-{2,}$/i
    ];

    const kept = [];
    for (const line of lines) {
      if (line.startsWith(">")) break;
      if (cutPatterns.some((re) => re.test(line))) break;
      kept.push(line);
    }

    const deduped = [];
    const seen = new Set();
    for (const line of kept) {
      const key = line.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push(line);
    }
    return deduped.join("\n").trim();
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
    if (isLikelyMetadataBlob(cleaned)) return "";
    return cleaned;
  }

  function normalizeMessageDateToken(value) {
    const raw = normalize(value || "").toLowerCase();
    if (!raw) return "";
    return raw
      .replace(/[(),]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function buildFallbackMessageKey(message, threadId = "", sourceIndex = 0) {
    const msg = message && typeof message === "object" ? message : {};
    const thread = canonicalThreadId(threadId || msg.threadId || "");
    const sender = normalize(msg.senderEmail || msg.sender || "").toLowerCase();
    const dateToken = normalizeMessageDateToken(msg.date || "");
    const sourceType = normalize(msg.sourceType || (msg.isOptimistic ? "optimistic" : "fallback")) || "fallback";
    const body = normalize(msg.cleanBodyText || msg.bodyText || "");
    const bodyHash = hashString(body.toLowerCase());
    const idx = Number.isFinite(Number(sourceIndex)) ? Number(sourceIndex) : 0;
    const idxToken = sourceType === "optimistic" ? `:${idx}` : "";
    return `fb:${thread}:${sender}:${dateToken}:${bodyHash}:${sourceType}${idxToken}`;
  }

  function buildThreadMessageKey(message, index = 0, threadId = "", sourceIndex = 0) {
    const existing = normalize(message && message.messageKey);
    if (existing) return existing;
    const dataMessageId = normalize(message && message.dataMessageId);
    if (dataMessageId) return `mid:${dataMessageId}`;
    if (normalize(message && message.clientSendId)) {
      return `opt:${normalize(message.clientSendId)}`;
    }
    return buildFallbackMessageKey(message, threadId, sourceIndex || index);
  }

  function normalizeThreadMessageForChat(message, context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const threadId = normalize(context.threadId || msg.threadId || "");
    const sender = normalize(msg.sender || "") || "Unknown sender";
    const senderEmail = extractEmail(msg.senderEmail || sender);
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
    const messageKey = buildThreadMessageKey(
      {
        ...msg,
        sender,
        senderEmail,
        cleanBodyText: bodyText,
        sourceType,
        clientSendId
      },
      Number(context.index || 0),
      threadId,
      Number(context.sourceIndex || msg.sourceIndex || 0)
    );
    return {
      ...msg,
      threadId,
      sender,
      senderEmail,
      cleanBodyText: bodyText,
      bodyText,
      bodyHtml: "",
      messageKey,
      sourceType,
      clientSendId: clientSendId || "",
      deliveryState: deliveryState || "",
      isOptimistic: sourceType === "optimistic" || Boolean(msg.isOptimistic),
      direction: direction || classifyMessageDirection({ ...msg, sender, senderEmail }, threadId) || "unknown"
    };
  }

  function normalizeThreadMessagesForChat(messages, threadId = "") {
    const out = [];
    const seenPrimary = new Set();
    const seenFallback = new Set();
    for (let i = 0; i < (Array.isArray(messages) ? messages.length : 0); i += 1) {
      const next = normalizeThreadMessageForChat(messages[i], { threadId, index: i, sourceIndex: i });
      const key = normalize(next.messageKey || "");
      if (key && seenPrimary.has(key)) continue;
      if (key) {
        seenPrimary.add(key);
      } else {
        const fallbackKey = buildFallbackMessageKey(next, threadId, i);
        if (fallbackKey && seenFallback.has(fallbackKey)) continue;
        if (fallbackKey) seenFallback.add(fallbackKey);
      }
      out.push(next);
    }
    const canonicalByThread = new Set(
      out
        .filter((msg) => !msg.isSeededPlaceholder && msg.sourceType !== "seeded" && hasUsefulBodyText(msg.cleanBodyText))
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

  function appendOptimisticOutgoingMessage(text, threadId) {
    const body = cleanThreadMessageBody(text || "", "");
    if (!body) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const clientSendId = `cs:${nowMs}:${hashString(`${threadId}|${body}|${Math.random()}`)}`;
    const userEmail = detectCurrentUserEmail();
    const optimistic = normalizeThreadMessageForChat({
      threadId: normalize(threadId || ""),
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
    }, { threadId, direction: "outgoing" });
    const current = getOptimisticMessagesForThread(threadId);
    current.push(optimistic);
    setOptimisticMessagesForThread(threadId, current);
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
      let candidateIndex = -1;
      if (preferredKey) {
        candidateIndex = pending.findIndex((msg, idx) => (
          !usedPending.has(idx)
          && normalize(msg.messageKey) === preferredKey
          && hashString(normalize(msg.cleanBodyText).toLowerCase()) === item.hash
        ));
      }
      if (candidateIndex < 0) {
        candidateIndex = pending.findIndex((msg, idx) => {
          if (usedPending.has(idx)) return false;
          const bodyHash = hashString(normalize(msg.cleanBodyText).toLowerCase());
          if (bodyHash !== item.hash) return false;
          const sentAt = Number(msg.optimisticAt || 0);
          return !sentAt || Math.abs(now - sentAt) <= OPTIMISTIC_RECONCILE_WINDOW_MS;
        });
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
      const threadId = normalize(message.threadId || "");
      if (!threadId) continue;
      if (!byThread.has(threadId)) byThread.set(threadId, []);
      byThread.get(threadId).push(message);
    }
    return byThread;
  }

  async function refreshActiveThreadAfterSend(threadId, mailbox, optimisticMessage) {
    const targetThreadId = normalize(threadId || "");
    if (!targetThreadId) return false;
    const attempts = [180, 360, 620, 900, 1300];
    let matched = false;

    for (let i = 0; i < attempts.length; i += 1) {
      await sleep(attempts[i]);
      const extracted = extractOpenThreadData();
      const normalizedExtracted = normalizeThreadMessagesForChat(
        Array.isArray(extracted.messages) ? extracted.messages : [],
        targetThreadId
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

      if (Array.isArray(state.contactThreadIds) && state.contactThreadIds.includes(targetThreadId)) {
        const displayThreadIds = state.contactThreadIds.slice().reverse();
        const byThread = groupedMessagesByThreadId(state.mergedMessages);
        if (normalizedExtracted.length > 0) {
          byThread.set(targetThreadId, normalizedExtracted.map((msg) => ({ ...msg, threadId: targetThreadId })));
          state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, byThread);
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
    if (/^#(?:thread-)?f:[A-Za-z0-9_-]+$/i.test(clean)) return true;
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
    const domReady = messageNodes > 0 || (replyButtons > 0 && listRows < 8);
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
    const box = normalize(mailbox || "inbox").toLowerCase() || "inbox";
    const fromHint = hashFromHref(hintHref);
    if (fromHint) out.push(fromHint);
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const noHash = key.startsWith("#") ? key.slice(1) : key;
      if (!noHash) continue;
      out.push(`#${noHash}`);
      if (/^[A-Za-z0-9_-]{8,}$/.test(noHash)) {
        out.push(`#${box}/${noHash}`);
      }
    }
    return Array.from(new Set(out.filter(Boolean)));
  }

  async function ensureThreadContextForReply(threadId, mailbox, hintHref = "") {
    const targetThreadId = normalize(threadId || "");
    const bestHint = normalize(hintHref || "") || lookupThreadHintHref(targetThreadId);
    const rowHint = lookupThreadRowHint(targetThreadId);
    const initial = threadContextSnapshot(targetThreadId);
    if (initial.ok) {
      return { ok: true, contextStep: "alreadyThreadContext", status: initial, tried: [] };
    }
    if (initial.hashThreadLike && initial.threadMatch) {
      return { ok: true, contextStep: "threadHashContext", status: initial, tried: [] };
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
      state.currentThreadIdForReply = "";
      state.currentThreadHintHref = "";
      state.currentThreadMailbox = "";
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
    if (state.replySendInProgress) return;
    const input = root.querySelector(".rv-thread-input");
    if (!(input instanceof HTMLInputElement)) return;
    const text = (input.value || "").trim();
    if (!text) return;
    if (!window.ReskinCompose || typeof window.ReskinCompose.replyToThread !== "function") {
      logWarn("ReskinCompose.replyToThread not available");
      return;
    }

    const route = parseListRoute(state.lastListHash || window.location.hash || "#inbox");
    const mailbox = normalize(state.currentThreadMailbox || route.mailbox || "inbox") || "inbox";
    const hashThreadId = normalize(threadIdFromHash(window.location.hash || ""));
    const threadId = normalize(
      state.currentThreadIdForReply ||
      hashThreadId ||
      state.activeThreadId
    );
    const targetThreadId = normalize(hashThreadId || threadId || state.activeThreadId || "");
    const replyDraftThreadId = normalize(targetThreadId || state.currentThreadIdForReply || state.activeThreadId || "");
    const threadHintHref = normalize(state.currentThreadHintHref || "") || lookupThreadHintHref(targetThreadId);
    const previousSuspendHydration = state.suspendHashSyncDuringContactHydration;
    const sendBtn = root.querySelector(".rv-thread-send");
    let failureStage = "";
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
      optimisticMessage = appendOptimisticOutgoingMessage(text, targetThreadId);
      if (optimisticMessage) {
        timing.optimisticVisibleAtMs = Date.now();
        input.value = "";
        setReplyDraft(replyDraftThreadId, "");
        if (Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0) {
          const displayThreadIds = state.contactThreadIds.slice().reverse();
          const byThread = groupedMessagesByThreadId(state.mergedMessages);
          const existing = Array.isArray(byThread.get(targetThreadId)) ? byThread.get(targetThreadId).slice() : [];
          existing.push(optimisticMessage);
          byThread.set(targetThreadId, existing);
          state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, byThread);
        }
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          renderThread(latestRoot);
        }
      }

      const contextStartedAt = Date.now();
      const context = await ensureThreadContextForReply(targetThreadId, mailbox, threadHintHref);
      timing.contextDurationMs = Date.now() - contextStartedAt;
      if (!context.ok) {
        failureStage = "threadContext";
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
        logWarn(
          `Reply failed stage=threadContext reason=${context.reason || "thread-context-not-found"} threadId=${targetThreadId || ""} mailbox=${mailbox || ""}`
        );
        logWarn("Reply context snapshot", { ...context, ...timing });
        return;
      }

      const sendStartedAt = Date.now();
      const rawResult = await window.ReskinCompose.replyToThread(text, {
        threadId: targetThreadId,
        mailbox,
        forceThreadContext: false,
        threadHintHref,
        timeoutMs: 12000
      });
      timing.sendDurationMs = Date.now() - sendStartedAt;
      const result = normalizeReplyResult(rawResult);
      if (result.ok) {
        setReplyDraft(replyDraftThreadId, "");
        if (optimisticMessage) {
          markOptimisticMessageDelivered(targetThreadId, optimisticMessage.messageKey);
          updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
            deliveryState: "sent",
            optimisticStatus: "sent",
            optimisticDeliveredAt: Date.now()
          });
        }
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
          liveSendBtn.textContent = "Send";
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
        state.suspendHashSyncDuringContactHydration = false;
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = false;
        state.mergedMessages = [];
        state.contactThreadIds = [];
        state.contactDisplayName = "";
        state.currentThreadIdForReply = "";
        state.currentThreadHintHref = "";
        state.currentThreadMailbox = "";
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
        state.suspendHashSyncDuringContactHydration = false;
        state.activeContactKey = "";
        state.contactThreadIds = [];
        state.mergedMessages = [];
        state.contactDisplayName = "";
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
        state.suspendHashSyncDuringContactHydration = false;
        state.activeContactKey = "";
        state.contactThreadIds = [];
        state.mergedMessages = [];
        state.contactDisplayName = "";
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
        state.suspendHashSyncDuringContactHydration = false;
        state.activeContactKey = "";
        state.contactThreadIds = [];
        state.mergedMessages = [];
        state.contactDisplayName = "";
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
      const date = extractDate(row);
      const subject = cleanSubject(extractSubject(row, sender), sender, date);
      const snippet = extractSnippet(row);
      if (sender === "Unknown sender" && subject === "No subject captured" && !isUseful(snippet)) continue;
      if (strictMailbox && (!href || !hrefMatchesMailbox(href, mailboxKey))) continue;

      seen.add(dedupeKey);
      const detectedUnread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
      const unread = detectedUnread && !isThreadMarkedReadLocally(threadId);
      items.push({ threadId, sender, subject, snippet, bodyText: "", date, href, row, triageLevel: "", unread, mailbox: mailboxKey });
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
          const detectedUnread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
          const unread = detectedUnread && !isThreadMarkedReadLocally(threadId);
          items.push({ threadId, sender, subject, snippet, bodyText: "", date, href, row, triageLevel: "", unread, mailbox: mailboxKey });
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
    const id = canonicalThreadId(msg.threadId || "") || normalize(msg.threadId || "");
    const link = hashFromHref(msg.href || "") || normalize(msg.href || "");
    return `${id}|${link}`;
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
    for (const msg of messages || []) {
      if (!msg || typeof msg !== "object") continue;
      const mailbox = mailboxCacheKey(msg.mailbox || "");
      const key = `${mailbox}|${messageCacheKey(msg)}|${normalize(msg.sender || "")}|${normalize(msg.date || "")}`;
      if (!key) continue;
      map.set(key, { ...msg, mailbox });
    }
    return Array.from(map.values());
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
      ? ["Older", "older", "Next page", "next page"]
      : ["Newer", "newer", "Previous page", "previous page"];
    const queryRoot = getGmailMainRoot() || document;
    const candidates = [];
    for (const label of labels) {
      const selectors = [
        `[aria-label="${label}"][role="button"]`,
        `[aria-label*="${label}"][role="button"]`,
        `button[aria-label="${label}"]`,
        `button[aria-label*="${label}"]`,
        `[aria-label="${label}"]`,
        `[aria-label*="${label}"]`
      ];
      for (const selector of selectors) {
        for (const node of Array.from(queryRoot.querySelectorAll(selector))) {
          if (!(node instanceof HTMLElement)) continue;
          if (!isElementVisible(node)) continue;
          candidates.push(node);
        }
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
        if (state.replySendInProgress) {
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
      window.location.hash = hintHash;
      return true;
    }

    if (hint) {
      window.location.hash = hint.includes("#") ? hint.slice(hint.indexOf("#")) : hint;
      return true;
    }

    return false;
  }

  const BODY_SELECTORS = '.a3s.aiL, .a3s, .ii.gt, .ii, div.ii, div[dir="ltr"], div[dir="auto"], div.ii.gt, [role="textbox"], [class*="a3s"], [class*=" ii "]';
  const THREAD_BODY_PLACEHOLDER = "Message body not captured yet.";
  const THREAD_NO_CONTENT = "No content";

  function hasUsefulBodyText(text) {
    const value = normalize(text);
    return Boolean(value && value !== THREAD_BODY_PLACEHOLDER && value !== THREAD_NO_CONTENT);
  }

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
      const emailNodes = scope.querySelectorAll(
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

      const selectors = [
        '.gD', 'span.gD', 'h3 span[dir="auto"]', 'h3 span', '.go', 'h4'
      ];
      for (const sel of selectors) {
        const node = scope.querySelector(sel);
        if (!(node instanceof HTMLElement)) continue;
        const text = normalize(node.innerText || node.textContent || node.getAttribute("title"));
        if (!text || !isUseful(text) || looksLikeDateOrTime(text) || isGenericSenderLabel(text)) continue;
        return text;
      }

      const aria = normalize(scope.getAttribute("aria-label"));
      if (aria) {
        const email = extractEmail(aria);
        if (email) return email;
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
        const snippet = safeThreadFallbackText((scope.innerText || scope.textContent || "").slice(0, 320));
        if (!snippet && !isUseful(sender) && !date) continue;
        bodyText = snippet || THREAD_BODY_PLACEHOLDER;
      }
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
        date: date || "",
        dataMessageId: mid || "",
        bodyHtml: bodyHtml || "",
        bodyText: bodyText || THREAD_NO_CONTENT
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
              const snippet = safeThreadFallbackText((scope.innerText || scope.textContent || "").slice(0, 320));
              if (!snippet && !isUseful(sender) && !date) continue;
              bodyText = snippet || THREAD_BODY_PLACEHOLDER;
            }
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
              date: date || "",
              dataMessageId: mid || "",
              bodyHtml: bodyHtml || "",
              bodyText: bodyText || THREAD_NO_CONTENT
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
          const snippet = safeThreadFallbackText((scope.innerText || scope.textContent || "").slice(0, 320));
          if (!snippet && !isUseful(sender) && !date) continue;
          bodyText = snippet || THREAD_BODY_PLACEHOLDER;
        }
        const senderToken = normalize(sender || "").toLowerCase();
        const dateToken = normalize(date || "").toLowerCase();
        const bodyToken = normalize(bodyText || "");
        const mid = scope.getAttribute("data-message-id") || "";
        let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
        if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
          uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
        }
        if (uniqueKey && seenBodies.has(uniqueKey)) continue;
        if (uniqueKey) seenBodies.add(uniqueKey);
        messages.push({
          sender: isUseful(sender) ? sender : "Unknown sender",
          date: date || "",
          dataMessageId: mid || "",
          bodyHtml: bodyHtml || "",
          bodyText: bodyText || THREAD_NO_CONTENT
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
        date,
        dataMessageId: "",
        bodyHtml: finalBodyText.length >= 3 ? bodyHtml : "",
        bodyText: finalBodyText
      });
    }

    const extractionThreadId = normalize(threadIdFromHash(window.location.hash || "") || state.activeThreadId || "");
    const finalMessages = normalizeThreadMessagesForChat(messages, extractionThreadId);

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
    const email = extractEmail(s);
    if (email) return email;
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
    const direct = Date.parse(raw);
    if (Number.isFinite(direct)) return direct;
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
        const ta = messageDateSortValue(a);
        const tb = messageDateSortValue(b);
        if (ta !== tb) return tb - ta;
        const da = normalize(a.date || "").toLowerCase();
        const db = normalize(b.date || "").toLowerCase();
        return db.localeCompare(da);
      });
      g.threadIds = g.items.map((m) => m.threadId).filter(Boolean);
      g.latestItem = g.items[0] || null;
    }
    return groups;
  }

  function threadHashForMailbox(mailbox, threadId) {
    const box = normalize(mailbox || "inbox").toLowerCase() || "inbox";
    const raw = normalize(threadId || "");
    const cleanThreadId = raw.startsWith("#") ? raw.slice(1) : raw;
    if (!cleanThreadId) return `#${box}`;
    return `#${box}/${cleanThreadId}`;
  }

  function applySnippetFallbackToMessages(messages, threadId) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const snippet = normalize((state.snippetByThreadId && state.snippetByThreadId[threadId]) || "");
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

  async function captureThreadDataWithRetry(threadId, mailbox, maxAttempts = 6) {
    const targetHash = threadHashForMailbox(mailbox, threadId);
    let bestData = { subject: "", messages: [] };
    let bestScore = -Infinity;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lockStartedAt = Date.now();
      while (state.replySendInProgress && Date.now() - lockStartedAt < 12000) {
        await sleep(120);
      }
      if (window.location.hash !== targetHash) window.location.hash = targetHash;
      await sleep(attempt === 0 ? 760 : 420 + Math.min(260, attempt * 40));
      const data = extractOpenThreadData();
      const messages = normalizeThreadMessagesForChat(
        applySnippetFallbackToMessages(Array.isArray(data.messages) ? data.messages : [], threadId),
        threadId
      );
      const scored = scoreExtractedMessages(messages);
      if (scored > bestScore) {
        bestScore = scored;
        bestData = { ...data, messages };
      }
      const hasCapturedBody = messages.some((m) => hasUsefulBodyText(m && m.bodyText) || normalize(m && m.bodyHtml).length > 20);
      if (hasCapturedBody) break;
    }

    return bestData;
  }

  function mergeContactMessagesByThread(threadIds, byThread) {
    const seenMessageKeys = new Set();
    const seenBodyFallback = new Set();
    const merged = [];
    for (const threadId of threadIds) {
      const source = byThread.get(threadId);
      const normalizedThreadMessages = normalizeThreadMessagesForChat(
        Array.isArray(source) ? source : [],
        threadId
      );
      if (normalizedThreadMessages.length === 0) continue;
      const hasCapturedCanonical = normalizedThreadMessages.some(
        (msg) => !msg.isSeededPlaceholder && hasUsefulBodyText(msg.cleanBodyText)
      );
      for (const message of normalizedThreadMessages) {
        if (!message || typeof message !== "object") continue;
        if (hasCapturedCanonical && message.isSeededPlaceholder) continue;
        const messageKey = normalize(message.messageKey || "");
        if (messageKey && seenMessageKeys.has(messageKey)) continue;
        if (messageKey) seenMessageKeys.add(messageKey);

        const bodyHash = hashString(normalize(message.cleanBodyText || "").toLowerCase());
        const fallbackKey = [
          canonicalThreadId(threadId),
          normalize(message.senderEmail || message.sender || "").toLowerCase(),
          normalizeMessageDateToken(message.date || ""),
          bodyHash,
          normalize(message.sourceType || "")
        ].join(":");
        if (!messageKey && seenBodyFallback.has(fallbackKey)) continue;
        seenBodyFallback.add(fallbackKey);
        merged.push({ ...message, threadId, __order: merged.length });
      }
    }
    return merged
      .sort((a, b) => {
        const ta = messageDateSortValue(a);
        const tb = messageDateSortValue(b);
        if (ta && tb && ta !== tb) return ta - tb;
        return Number(a.__order || 0) - Number(b.__order || 0);
      })
      .map(({ __order, ...rest }) => rest);
  }

  function buildSeededMessagesByThread(group) {
    const byThread = new Map();
    if (!group || !Array.isArray(group.threadIds)) return byThread;
    const fallbackSender = group.contactName || "Unknown sender";
    const itemByThread = new Map();
    for (const item of Array.isArray(group.items) ? group.items : []) {
      const tid = normalize(item && item.threadId);
      if (!tid || itemByThread.has(tid)) continue;
      itemByThread.set(tid, item);
    }
    for (const threadId of group.threadIds) {
      const tid = normalize(threadId);
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
    const threadIds = group.threadIds.map((id) => normalize(id)).filter(Boolean);
    if (threadIds.length === 0) return;
    const threadMailboxByThreadId = new Map();
    for (const item of Array.isArray(group.items) ? group.items : []) {
      rememberThreadNavigationHint(item && item.threadId, item && item.href, item && item.row);
      const itemThread = canonicalThreadId(item && item.threadId);
      if (!itemThread) continue;
      const itemMailbox = mailboxCacheKey(item && item.mailbox ? item.mailbox : defaultMailbox);
      if (!threadMailboxByThreadId.has(itemThread)) {
        threadMailboxByThreadId.set(itemThread, itemMailbox);
      }
    }
    const mailboxForThread = (threadId) => (
      threadMailboxByThreadId.get(canonicalThreadId(threadId)) || mailboxCacheKey(defaultMailbox)
    );
    const firstThreadMailbox = mailboxForThread(threadIds[0] || "");
    // Inbox list is newest-first; thread view should be oldest-first.
    const displayThreadIds = threadIds.slice().reverse();
    markThreadsReadLocally(
      threadIds,
      (group.items || []).map((m) => m && m.row).filter((row) => row instanceof HTMLElement)
    );
    const contactKey = normalize(group.contactKey || "");
    state.suspendHashSyncDuringContactHydration = true;
    state.contactChatLoading = true;
    state.contactThreadIds = threadIds.slice();
    state.contactDisplayName = group.contactName || (group.latestItem && senderDisplayName(group.latestItem.sender)) || "Chat";
    state.activeContactKey = contactKey;
    state.currentView = "thread";
    state.activeThreadId = threadIds[0] || "";
    state.mergedMessages = [];
    state.currentThreadIdForReply = "";
    state.currentThreadHintHref = lookupThreadHintHref(threadIds[0] || "");
    state.currentThreadMailbox = firstThreadMailbox;
    state.lastListHash = sanitizeListHash(window.location.hash || state.lastListHash || "#inbox");
    if (!state.replySendInProgress) {
      window.location.hash = threadHashForMailbox(firstThreadMailbox, threadIds[0] || "");
    }

    // Render instantly using list snippets, then hydrate with real bodies in background.
    const seededByThread = buildSeededMessagesByThread({
      ...group,
      threadIds
    });
    const seededSenderByThread = new Map();
    const seededDateByThread = new Map();
    const seededContactKeyByThread = new Map();
    for (const threadId of threadIds) {
      const seeded = seededByThread.get(threadId);
      const seedSender = Array.isArray(seeded) && seeded[0] ? normalize(seeded[0].sender || "") : "";
      const seedDate = Array.isArray(seeded) && seeded[0] ? normalize(seeded[0].date || "") : "";
      if (seedSender) seededSenderByThread.set(threadId, seedSender);
      if (seedDate) seededDateByThread.set(threadId, seedDate);
      const seedKey = contactKeyFromMessage({ sender: seedSender });
      if (seedKey) seededContactKeyByThread.set(threadId, seedKey);
    }
    state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, seededByThread);
    state.currentThreadIdForReply = threadIds[0] || "";
    state.currentThreadHintHref = lookupThreadHintHref(threadIds[0] || "");
    state.currentThreadMailbox = firstThreadMailbox;
    state.contactChatLoading = false;
    renderList(root);
    renderCurrentView(root);

    (async () => {
      const resolvedByThread = new Map(seededByThread);
      const primaryAttempts = threadIds.length > 8 ? 3 : 4;
      const secondaryAttempts = threadIds.length > 8 ? 2 : 3;
      for (let i = 0; i < threadIds.length; i += 1) {
        if (normalize(state.activeContactKey || "") !== contactKey) return;
        const threadId = threadIds[i];
        const threadMailbox = mailboxForThread(threadId);
        const attempts = i === 0 ? primaryAttempts : secondaryAttempts;
        const data = await captureThreadDataWithRetry(threadId, threadMailbox, attempts);
        const captured = applySnippetFallbackToMessages(Array.isArray(data.messages) ? data.messages : [], threadId);
        if (captured.length > 0) {
          const seedSender = seededSenderByThread.get(threadId) || "";
          const seedDate = seededDateByThread.get(threadId) || "";
          const seedKey = seededContactKeyByThread.get(threadId) || "";
          const normalizedCaptured = captured.map((msg) => {
            const nextSender = choosePreferredSender(msg && msg.sender, seedSender);
            return {
              ...msg,
              sender: nextSender || normalize(msg && msg.sender) || seedSender || "Unknown sender",
              date: seedDate || normalize(msg && msg.date) || ""
            };
          });
          const capturedKey = normalizedCaptured.length > 0
            ? contactKeyFromMessage({ sender: normalizedCaptured[0].sender })
            : "";
          if (seedKey && capturedKey && seedKey !== capturedKey) {
            continue;
          }
          resolvedByThread.set(threadId, normalizedCaptured);
        }
        state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, resolvedByThread);
        state.currentThreadIdForReply = threadIds[0] || "";
        state.currentThreadHintHref = lookupThreadHintHref(threadIds[0] || "");
        state.currentThreadMailbox = firstThreadMailbox;
        const shouldRefreshNow = i === 0 || i === threadIds.length - 1 || i % 2 === 1;
        const latestRoot = document.getElementById(ROOT_ID);
        if (shouldRefreshNow && latestRoot instanceof HTMLElement && state.currentView === "thread" && normalize(state.activeContactKey || "") === contactKey) {
          renderThread(latestRoot);
        }
      }
      if (normalize(state.activeContactKey || "") !== contactKey) return;
      state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, resolvedByThread);
      state.currentThreadIdForReply = threadIds[0] || "";
      state.currentThreadHintHref = lookupThreadHintHref(threadIds[0] || "");
      state.currentThreadMailbox = firstThreadMailbox;
      state.contactChatLoading = false;
      state.suspendHashSyncDuringContactHydration = false;
      if (!state.replySendInProgress) {
        window.location.hash = threadHashForMailbox(firstThreadMailbox, threadIds[0] || "");
      }
      const latestRoot = document.getElementById(ROOT_ID);
      if (latestRoot instanceof HTMLElement) {
        renderCurrentView(latestRoot);
        renderThread(latestRoot);
      }
    })().catch((error) => {
      const stillActive = normalize(state.activeContactKey || "") === contactKey;
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
    let renderThreadId = normalize(
      state.currentThreadIdForReply ||
      threadIdFromHash(window.location.hash || "") ||
      state.activeThreadId ||
      ""
    );
    if (Array.isArray(state.mergedMessages) && state.mergedMessages.length > 0) {
      thread = { subject: `Chat with ${state.contactDisplayName || "contact"}` };
      messages = normalizeThreadMessagesForChat(state.mergedMessages);
    } else {
      thread = extractOpenThreadData();
      messages = normalizeThreadMessagesForChat(Array.isArray(thread.messages) ? thread.messages : [], renderThreadId);
      // Keep Gmail DOM order; lexical date sorting can invert chronology.
      const bodyMissing = messages.length === 1 && (messages[0].bodyText || "").trim() === THREAD_BODY_PLACEHOLDER;
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
    const inContactChatMode = Boolean(
      normalize(state.activeContactKey || "") &&
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
      renderThreadId = normalize(
        state.currentThreadIdForReply ||
        activeThreadForSnippet ||
        (messages[0] && messages[0].threadId) ||
        ""
      );
    }
    messages = mergeOptimisticIntoMessages(messages, renderThreadId);
    if (messages.length > 1) {
      messages.sort((a, b) => Number(a.optimisticAt || 0) - Number(b.optimisticAt || 0));
    }
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] renderThread: displaying ${messages.length} message(s) in thread view`);
    }

    const senderName = (raw) => {
      const s = (raw || "").trim();
      const m = s.match(/^(.+?)\s*<[^>]+>$/);
      return m ? m[1].trim() : s;
    };

    const messageRows = messages.map((msg) => {
      const direction = normalize(msg && msg.direction) === "outgoing" ? "outgoing" : "incoming";
      const directionClass = direction === "outgoing" ? "rv-thread-msg--outgoing" : "rv-thread-msg--incoming";
      const status = normalize((msg && msg.deliveryState) || (msg && msg.optimisticStatus));
      const statusLabel = msg && msg.isOptimistic
        ? (status === "sent" ? "Sent" : (status === "failed" ? "Failed" : "Sending..."))
        : "";
      const senderLabel = direction === "outgoing" ? "You" : senderName(msg && msg.sender);
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
    const groupedMessages = groupMessagesByContact(groupingMessages);
    const useGroups = groupedMessages.length > 0;
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
      if (m.threadId) state.snippetByThreadId[m.threadId] = m.snippet || "";
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
            state.suspendHashSyncDuringContactHydration = false;
            state.activeContactKey = "";
            state.contactThreadIds = [];
            state.mergedMessages = [];
            state.contactDisplayName = "";
            state.lockListView = false;
            state.currentView = "thread";
            state.activeThreadId = msg.threadId;
            state.currentThreadMailbox = mailboxCacheKey(msg.mailbox || route.mailbox || "inbox");
            rememberThreadNavigationHint(msg.threadId, msg.href, msg.row);
            state.currentThreadHintHref = normalize(msg.href || "") || lookupThreadHintHref(msg.threadId);
            state.currentThreadIdForReply = normalize(msg.threadId || "");
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
              renderList(root);
              renderCurrentView(root);
              return;
            }
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
      const messageNodes = main.querySelectorAll("[data-message-id]").length;
      const bodyNodes = main.querySelectorAll(BODY_SELECTORS).length;
      let lastMessageId = "";
      const messageEls = Array.from(main.querySelectorAll("[data-message-id]"));
      if (messageEls.length > 0) {
        const lastEl = messageEls[messageEls.length - 1];
        if (lastEl instanceof HTMLElement) {
          lastMessageId = normalize(lastEl.getAttribute("data-message-id") || "");
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
        });
    }, 200);
  }

  waitForReady();
})();
