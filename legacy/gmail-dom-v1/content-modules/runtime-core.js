(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createRuntimeCoreApi = function createRuntimeCoreApi(deps = {}) {
    const { getLogChatDebug } = deps;

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
    const LIST_LIVE_RENDER_GAP_MS = 520;
    const THREAD_LIST_REFRESH_GAP_MS = 1600;
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

    const TRIAGE_LEVELS = [];
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
    const STARTUP_FAST_LIST_LIMIT = 90;
    const STARTUP_WARM_LIST_DELAY_MS = 140;
    const STARTUP_PERF_MODE = "instant";
    const ENABLE_BOOTSTRAP_SCAN_KICK = false;
    const ENABLE_STARTUP_WARM_LIST_RENDER = false;
    const ENABLE_DISCOVERY_ON_OPEN = false;
    const MAILBOX_SCAN_MAX_PAGES = 120;
    const MAILBOX_SCAN_NO_CHANGE_LIMIT = 3;
    const THREAD_EXPAND_MAX_PASSES = 5;
    const THREAD_EXPAND_MAX_CLICKS_PER_PASS = 42;
    const THREAD_EXPAND_CLICK_YIELD_MS = 80;
    const THREAD_EXPAND_BODY_SETTLE_MS = 2500;
    const THREAD_EXPAND_BODY_POLL_MS = 80;
    const OPTIMISTIC_RECONCILE_WINDOW_MS = 120000;
    const INBOX_SDK_APP_ID = "sdk_reskinmail_25053b311c";
    const INBOX_SDK_THREAD_CACHE_MAX_AGE_MS = 10 * 60 * 1000;
    const CHAT_DEBUG_STORAGE_KEY = "reskin_chat_debug_v1";
    const CHAT_DEBUG_DEFAULT_ENABLED = true;
    const LIST_MODE = "contact_groups";
    const CHAT_MODE = "contact_merge_lite_v2";
    const CONTACT_TIMELINE_V2_ENABLED = true;
    const ENABLE_AI_BACKGROUND_AUTOMATION = false;
    const ENABLE_CONTACT_MERGE_MODE = (
      CHAT_MODE === "contact_merge_lite_v2"
      || CHAT_MODE === "contact_merge_on_click"
    );
    const ENABLE_CONTACT_MERGE_LEGACY = ENABLE_CONTACT_MERGE_MODE && !CONTACT_TIMELINE_V2_ENABLED;
    const ENABLE_CONTACT_GROUP_LIST = LIST_MODE === "contact_groups";
    const THREAD_READY_MAX_RETRIES = 5;
    const THREAD_READY_RETRY_BASE_MS = 80;
    const CONTACT_OPEN_FAST_ROW_LIMIT = 120;
    const CONTACT_OPEN_DEFERRED_YIELD_EVERY = 40;
    const CONTACT_OPEN_DEFERRED_BUILD_DELAY_MS = 0;
    const CONTACT_OPEN_DEEP_HYDRATION_DELAY_MS = 250;
    const CONTACT_HYDRATION_MAX_CONCURRENCY = 3;
    const INTERACTION_SCAN_COOLDOWN_MS = 1500;
    const THREAD_OPEN_TRANSITION_MS = 900;
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
      _pendingDiscovery: null,
      discoveryController: null,
      interactionLockUntil: 0,
      lastListSignature: "",
      lastListHadVisible: false,
      lastListRenderAt: 0,
      currentView: "list",
      activeThreadId: "",
      lockListView: false,
      lastListHash: "#inbox",
      lastRenderedCount: null,
      lastSource: "",
      loggedOnce: new Set(),
      triageFilter: "",
      triageCounts: {},
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
      mailboxCacheRevision: 0,
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
      scanRunId: 0,
      scanPaused: false,
      scanPauseReason: "",
      interactionEpoch: 0,
      lastInteractionAt: 0,
      activeTask: "idle",
      threadOpenTransitionUntil: 0,
      fullScanMailbox: "",
      fullScanStatus: "",
      fullScanCompletedByMailbox: {},
      mailboxScanProgress: {},
      mailboxScanQueue: [],
      mailboxScanRunner: false,
      mailboxScanKickTimer: null,
      mailboxScanKickKey: "",
      scannedMailboxMessages: {},
      inboxHashNudged: false,
      inboxEmptyRetryScheduled: false,
      listVisibleByMailbox: {},
      listChunkSize: 240,
      startupWarmListReady: false,
      startupWarmListScheduled: false,
      startupBootDeferredScheduled: false,
      reskinReadyAt: 0,
      firstStableListPaintAt: 0,
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
      lastMaintenanceRenderAt: 0,
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
      activeTimelineMessages: [],
      contactTimelineIsDeep: false,
      contactTimelineDeepHydratedAt: 0,
      contactTimelineDeepCount: 0,
      contactTimelineV2Metrics: null,
      contactTimelineRefreshTimer: null,
      currentThreadIdForReply: "",
      currentThreadHintHref: "",
      currentThreadMailbox: "",
      threadHintHrefByThreadId: {},
      threadRowHintByThreadId: {},
      inboxSdkInstance: null,
      inboxSdkLoadPromise: null,
      inboxSdkReady: false,
      inboxSdkDisabled: false,
      inboxSdkFailureReason: "",
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
      contactHydrationInFlight: false,
      contactDiscoveryInFlight: false,
      contactDisplayName: "",
      contactHydrationRunId: 0,
      contactHydrationFallbackTimer: null,
      lastContactMergeMetrics: null,
      threadExtractRetry: 0,
      snippetByThreadId: {},
      localReadUntilByThread: {},
      suspendHashSyncDuringContactHydration: false,
      perfTraces: {},
      perfTraceOrder: [],
      perfSamplesByStage: {},
      perfLongTasks: [],
      perfLongTaskObserverInstalled: false,
      activeOpenPerfTraceId: "",
      activeOpenDiagRunId: "",
      activeHydrationDiagRunId: "",
      lastOpenContactSignature: "",
      lastOpenContactAt: 0,
      _collectingIndicatorVisible: false,
      _collectingIndicatorRunId: 0,
      _collectingLastHiddenRunId: 0,
      _collectingLastHiddenAt: 0,
      pendingDiscoveryByConversation: {},
      sentProbeCacheByConversation: {},
      sentProbeInFlightByConversation: {},
      accountRefreshTimer: null,
      servers: [],
      currentServerId: null,
      e2eDiag: {
        enabled: false,
        token: "",
        expiresAt: 0,
        enabledAt: 0
      }
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

    function bumpInteractionEpoch(reason = "") {
      state.lastInteractionAt = Date.now();
      if (state.contactHydrationFallbackTimer) {
        clearTimeout(state.contactHydrationFallbackTimer);
        state.contactHydrationFallbackTimer = null;
      }
      state.interactionEpoch = Number(state.interactionEpoch || 0) + 1;
      if (reason && typeof getLogChatDebug === "function") {
        const logChatDebug = getLogChatDebug();
        if (typeof logChatDebug === "function") {
          logChatDebug("interaction:epoch", {
            epoch: state.interactionEpoch,
            reason: normalize(reason || "")
          }, { throttleKey: `interaction-epoch:${normalize(reason || "unknown")}`, throttleMs: 120 });
        }
      }
      return state.interactionEpoch;
    }

    function setActiveTask(task = "idle") {
      state.activeTask = normalize(task || "idle") || "idle";
    }

    function mailboxScanPauseReason() {
      if (state.replySendInProgress) return "reply-send";
      if (state.currentView !== "list") return `view:${normalize(state.currentView || "unknown")}`;
      if (state.contactChatLoading) return "contact-chat-loading";
      if (state.contactHydrationInFlight) return "contact-hydration-running";
      if (state.suspendHashSyncDuringContactHydration) return "contact-hydration";
      if (interactionsLocked()) return "interaction-lock";
      return "";
    }

    function shouldPauseMailboxScan() {
      return Boolean(mailboxScanPauseReason());
    }

    const normalizeWarningWindowByKey = new Map();
    function normalizeWarningHash(input) {
      const text = String(input || "");
      let hash = 2166136261;
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36).slice(0, 8);
    }

    function shouldEmitNormalizeWarning(key) {
      const normalizedKey = String(key || "unknown");
      const now = Date.now();
      const windowMs = 60_000;
      const maxCount = 3;
      const current = normalizeWarningWindowByKey.get(normalizedKey) || {
        startedAt: now,
        count: 0
      };
      if (now - Number(current.startedAt || 0) > windowMs) {
        current.startedAt = now;
        current.count = 0;
      }
      if (Number(current.count || 0) >= maxCount) {
        normalizeWarningWindowByKey.set(normalizedKey, current);
        return false;
      }
      current.count += 1;
      normalizeWarningWindowByKey.set(normalizedKey, current);
      return true;
    }

    function emitNormalizeWarning(kind, sample = "") {
      if (!shouldEmitNormalizeWarning(`${kind}:${normalizeWarningHash(sample)}`)) return;
      if (typeof getLogChatDebug !== "function") return;
      const logChatDebug = getLogChatDebug();
      if (typeof logChatDebug !== "function") return;
      logChatDebug("E910", {
        kd: String(kind || "unknown"),
        mh: normalizeWarningHash(sample || "normalize-non-string"),
        rc: 9
      }, {
        throttleKey: `normalize-warning:${String(kind || "unknown")}`,
        throttleMs: 60_000,
        tier: "important"
      });
    }

    function normalize(text) {
      let raw = "";
      if (typeof text === "string") {
        raw = text;
      } else if (text == null) {
        raw = "";
      } else if (typeof text === "number" || typeof text === "boolean" || typeof text === "bigint") {
        raw = String(text);
      } else {
        try {
          raw = String(text);
          emitNormalizeWarning(typeof text, raw);
        } catch (_) {
          emitNormalizeWarning(typeof text, "string-coerce-failed");
          raw = "";
        }
      }
      return raw.replace(/\s+/g, " ").trim();
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
        .replace(/\"/g, "&quot;")
        .replace(/'/g, "&#39;");
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

    return {
      DEBUG_THREAD_EXTRACT,
      STYLE_ID,
      ROOT_ID,
      MODE_ATTR,
      MODE_VALUE,
      THEME_ATTR,
      THEME_DARK,
      THEME_LIGHT,
      OBSERVER_DEBOUNCE_MS,
      OBSERVER_MIN_RENDER_GAP_MS,
      LIST_LIVE_RENDER_GAP_MS,
      THREAD_LIST_REFRESH_GAP_MS,
      UI_POLL_INTERVAL_MS,
      LIST_REFRESH_INTERVAL_MS,
      GMAIL_READY_SELECTORS,
      ROW_SELECTORS,
      SCOPED_ROW_SELECTORS,
      LINK_SELECTORS,
      SCOPED_LINK_SELECTORS,
      NAV_ITEMS,
      PRIMARY_NAV_HASHES,
      TRIAGE_LEVELS,
      OLD_TO_NEW_TRIAGE,
      TRIAGE_MAP_STORAGE_KEY,
      SYNC_DRAFT_STORAGE_KEY,
      SUMMARY_STORAGE_KEY,
      COL_WIDTHS_STORAGE_KEY,
      DEFAULT_COL_WIDTHS,
      MIN_COL_PX,
      MAX_COL_PX,
      RESIZE_GRIP_PX,
      SUMMARY_TTL_MS,
      SUMMARY_BATCH_SIZE,
      LOCAL_READ_HOLD_MS,
      LIST_LOAD_MORE_DISTANCE_PX,
      LIST_PREFETCH_DISTANCE_PX,
      STARTUP_FAST_LIST_LIMIT,
      STARTUP_WARM_LIST_DELAY_MS,
      STARTUP_PERF_MODE,
      ENABLE_BOOTSTRAP_SCAN_KICK,
      ENABLE_STARTUP_WARM_LIST_RENDER,
      ENABLE_DISCOVERY_ON_OPEN,
      MAILBOX_SCAN_MAX_PAGES,
      MAILBOX_SCAN_NO_CHANGE_LIMIT,
      THREAD_EXPAND_MAX_PASSES,
      THREAD_EXPAND_MAX_CLICKS_PER_PASS,
      THREAD_EXPAND_CLICK_YIELD_MS,
      THREAD_EXPAND_BODY_SETTLE_MS,
      THREAD_EXPAND_BODY_POLL_MS,
      OPTIMISTIC_RECONCILE_WINDOW_MS,
      INBOX_SDK_APP_ID,
      INBOX_SDK_THREAD_CACHE_MAX_AGE_MS,
      CHAT_DEBUG_STORAGE_KEY,
      CHAT_DEBUG_DEFAULT_ENABLED,
      LIST_MODE,
      CHAT_MODE,
      CONTACT_TIMELINE_V2_ENABLED,
      ENABLE_AI_BACKGROUND_AUTOMATION,
      ENABLE_CONTACT_MERGE_MODE,
      ENABLE_CONTACT_MERGE_LEGACY,
      ENABLE_CONTACT_GROUP_LIST,
      THREAD_READY_MAX_RETRIES,
      THREAD_READY_RETRY_BASE_MS,
      CONTACT_OPEN_FAST_ROW_LIMIT,
      CONTACT_OPEN_DEFERRED_YIELD_EVERY,
      CONTACT_OPEN_DEFERRED_BUILD_DELAY_MS,
      CONTACT_OPEN_DEEP_HYDRATION_DELAY_MS,
      CONTACT_HYDRATION_MAX_CONCURRENCY,
      INTERACTION_SCAN_COOLDOWN_MS,
      THREAD_OPEN_TRANSITION_MS,
      DEBUG_BRIDGE_REQUEST_EVENT,
      DEBUG_BRIDGE_RESPONSE_EVENT,
      DEBUG_BRIDGE_SCRIPT_ID,
      NOISE_TEXT,
      state,
      logInfo,
      logWarn,
      logOnce,
      lockInteractions,
      interactionsLocked,
      bumpInteractionEpoch,
      setActiveTask,
      mailboxScanPauseReason,
      shouldPauseMailboxScan,
      normalize,
      consumeEvent,
      escapeHtml,
      isUseful,
      extractEmail,
      extractEmails,
      normalizeEmailList
    };
  };
})();
