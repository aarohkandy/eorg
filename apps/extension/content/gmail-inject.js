const COLD_START_MESSAGE =
  'Mailita is refreshing Gmail in the background. Please wait a moment and try again.';
const UI_SETTINGS_STORAGE_KEY = 'mailitaUiSettings';
const SETTINGS_TABS = ['theme'];
const THEME_MODES = ['messages_glass_blue', 'messages_scenic_blue', 'messages_glass_beige'];
const THEME_LABELS = {
  messages_glass_blue: 'Messages Glass',
  messages_scenic_blue: 'Messages Scenic',
  messages_glass_beige: 'Monochrome Beige'
};
const SHOW_ACTIVITY_PANEL = false;
const DEBUG_PANEL_MAX_EVENTS = 250;
const WORKER_TIMEOUT_BY_ACTION = {
  DIAGNOSTICS_LOG: 2500,
  GET_STORAGE: 6000,
  GUIDE_GET_STATE: 6000,
  GUIDE_CONFIRM_STEP: 12000,
  HEALTH_CHECK: 6000,
  CONNECT_GOOGLE: 120000,
  FETCH_MESSAGE_SUMMARIES: 30000,
  FETCH_CONTACT_MESSAGES: 30000,
  FETCH_CONTACT_BODIES: 30000,
  FETCH_MESSAGES: 30000,
  SEARCH_MESSAGES: 30000,
  ABORT_SEND_MESSAGE: 6000,
  SEND_MESSAGE: 60000,
  SYNC_MESSAGES: 60000
};
const CONTACT_PAGE_SIZE = 5;
const SUMMARY_APPEND_TRIGGER_PX = 220;
const SUMMARY_APPEND_PAGE_SIZE = 15;
const CAMPAIGN_MODE_ENABLED = false;
const CAMPAIGN_BLAST_DELAY_MS = 8000;
const mLog = (action, details = {}) => console.log(`[Mailita ${new Date().toISOString().split('T')[1]}] ${action}`, details);
globalThis.mLog = mLog;

const GUIDE_STEPS = ['connect_account'];
const GUIDE_STEP_SET = new Set(GUIDE_STEPS);
const GUIDE_SUBSTEP_COPY = {
  connect_account: {
    connect_ready: {
      title: 'Connect account',
      body: 'Connect Mailita with Google and grant read-only Gmail access for this beta.'
    },
    connect_submitted: {
      title: 'Connecting',
      body: 'Finishing Google sign-in and loading your mailbox.'
    },
    connected: {
      title: 'Connected',
      body: 'Mailita is connected and ready to load your Gmail conversations.'
    }
  }
};

const state = {
  messages: [],
  summaryItems: [],
  summaryByThreadId: {},
  summaryOrder: [],
  summaryCursor: '',
  summaryHasMore: false,
  summaryBootstrapInFlight: false,
  summaryInitialLoadInFlight: false,
  summaryAppendInFlight: false,
  summaryAppliedGeneration: 0,
  summaryLastRequestId: 0,
  summaryLastIgnoredReason: '',
  summaryWorkerCount: 0,
  summaryNormalizedCount: 0,
  summaryRenderedCount: 0,
  summaryLoadedCount: 0,
  contactMessagesByKey: {},
  contactMessageIndexByKey: {},
  contactLoadStateByKey: {},
  summaryRequestGeneration: 0,
  summaryPageSize: 50,
  contactRequestGenerationByKey: {},
  searchRequestGeneration: 0,
  searchMessageResults: [],
  searchMessageResultsInFlight: false,
  searchMessageError: '',
  filter: 'all',
  selectedThreadId: '',
  searchQuery: '',
  retrySeconds: 0,
  retryTimer: null,
  autoRefreshTimer: null,
  connected: false,
  guideState: null,
  setupDiagnostics: { entries: [] },
  lastMailboxTrace: [],
  lastMailboxDebug: null,
  lastMailboxSource: 'mailbox',
  lastMailboxTimings: null,
  mailboxMode: 'summary',
  useLegacyMailboxFallback: false,
  mailboxAutoRefresh: {
    attempted: false,
    inFlight: false,
    before: null,
    after: null,
    failedToFillContent: false,
    error: ''
  },
  contactDebug: {},
  guideReviewOpen: false,
  connectInFlight: false,
  shellUnlocked: false,
  debugOpen: true,
  uiSettings: null,
  settingsOpen: false,
  accountSnapshot: {
    connected: false,
    accountEmail: '',
    mailSource: 'gmail_api_local',
    lastSyncTime: '',
    onboardingComplete: false
  },
  detailLastThreadId: '',
  detailSnapToLatestThreadId: '',
  composer: {
    draft: '',
    mode: 'reply',
    targetMessageId: '',
    sendInFlight: false,
    sendError: '',
    sendStatus: ''
  },
  composeOverlay: {
    open: false,
    to: '',
    subject: '',
    body: '',
    sendInFlight: false,
    sendError: '',
    sendStatus: ''
  },
  campaignMode: defaultCampaignModeState()
};
const debugState = {
  counter: 0,
  events: []
};
const contactBodyHydrationInFlightByKey = new Map();

let mailitaGlobalListenersBound = false;
let mailitaSurfaceObserver = null;
let mailitaBootRetries = 0;
let visibleBodyHydrationFrame = 0;
let adjacentContactPrefetchTimer = null;
let idleContactPrefetchTimer = null;
let debugConsoleSignature = '';
let campaignBlastTimer = 0;
let campaignBlastDelayResolve = null;
let campaignBlastRunToken = 0;
let railPaginationObserver = null;
let detailHistoryObserver = null;
let detailHydrationObserver = null;
let uiCommitFrame = 0;
let queuedUiCommit = {
  rail: false,
  detail: false,
  overlays: false,
  selectionOnly: false,
  preserveDetailScroll: false,
  detailThreadId: '',
  scrollAnchor: null,
  campaignOptions: {}
};
const pendingHydrationIdsByThread = new Map();

function isMailHost() {
  return window.location.hostname.includes('mail.google.com');
}

function debugEventPayload(input, depth = 0) {
  if (depth > 2) return '[max-depth]';
  if (input == null) return input;
  if (Array.isArray(input)) {
    return {
      kind: 'array',
      length: input.length,
      sample: input.slice(0, 6).map((item) => debugEventPayload(item, depth + 1))
    };
  }
  if (typeof input === 'object') {
    const out = {};
    Object.entries(input).slice(0, 24).forEach(([key, value]) => {
      out[key] = debugEventPayload(value, depth + 1);
    });
    return out;
  }
  if (typeof input === 'string') {
    return input.length > 240 ? `${input.slice(0, 237)}...` : input;
  }
  return input;
}

function buildDebugStateSnapshot() {
  const stateCard = document.getElementById('gmailUnifiedStateCard');
  return {
    connected: Boolean(state.connected),
    connectInFlight: Boolean(state.connectInFlight),
    shellUnlocked: Boolean(state.shellUnlocked),
    guideReviewOpen: Boolean(state.guideReviewOpen),
    mailboxMode: state.mailboxMode,
    filter: state.filter,
    searchQuery: state.searchQuery || '',
    selectedThreadId: state.selectedThreadId || '',
    summaries: Array.isArray(state.summaryItems) ? state.summaryItems.length : 0,
    summaryPageSize: numericValue(state.summaryPageSize, 50),
    summaryCursor: state.summaryCursor || '',
    summaryHasMore: Boolean(state.summaryHasMore),
    summaryInitialLoadInFlight: Boolean(state.summaryInitialLoadInFlight),
    summaryAppendInFlight: Boolean(state.summaryAppendInFlight),
    summaryAppliedGeneration: numericValue(state.summaryAppliedGeneration, 0),
    summaryLastRequestId: numericValue(state.summaryLastRequestId, 0),
    summaryLastIgnoredReason: state.summaryLastIgnoredReason || '',
    summaryWorkerCount: numericValue(state.summaryWorkerCount, 0),
    summaryNormalizedCount: numericValue(state.summaryNormalizedCount, 0),
    summaryRenderedCount: numericValue(state.summaryRenderedCount, 0),
    summaryLoadedCount: numericValue(state.summaryLoadedCount, 0),
    messages: Array.isArray(state.messages) ? state.messages.length : 0,
    accountEmail: state.accountSnapshot?.accountEmail || '',
    lastSyncTime: state.accountSnapshot?.lastSyncTime || '',
    stateCard: stateCard?.dataset?.state || '',
    stateCardText: document.getElementById('gmailUnifiedStateText')?.textContent || '',
    connectStatus: document.getElementById('gmailUnifiedConnectStatus')?.textContent || ''
  };
}

function debugConsoleEnabled() {
  try {
    return window.__mailitaDebugLogs === true || window.localStorage?.getItem('mailita.debugLogs') === '1';
  } catch {
    return window.__mailitaDebugLogs === true;
  }
}

function renderDebugPanel() {
  if (!debugConsoleEnabled()) return;

  const signature = JSON.stringify({
    counter: debugState.counter,
    selectedThreadId: state.selectedThreadId || '',
    searchQuery: state.searchQuery || '',
    summaryCursor: state.summaryCursor || '',
    summaryRenderedCount: numericValue(state.summaryRenderedCount, 0),
    composeOpen: Boolean(state.composeOverlay?.open)
  });
  if (signature === debugConsoleSignature) return;
  debugConsoleSignature = signature;

  const selectedGroup = findSelectedGroup();
  const payload = {
    state: buildDebugStateSnapshot(),
    selectedThread: selectedGroup
      ? buildThreadDebugReport(selectedGroup)
      : 'Open a conversation to inspect the active contact payload.',
    events: debugState.events.slice(0, 20).map((entry) => ({
      ts: entry.ts,
      level: entry.level,
      label: entry.label,
      message: entry.message,
      details: entry.details
    }))
  };

  console.groupCollapsed('Mailita');
  console.log('state', payload.state);
  console.log('selectedThread', payload.selectedThread);
  console.log('events', payload.events);
  console.groupEnd();
}

function setDebugText(node, text) {
  if (!node) return;
  const normalized = String(text || '');
  if ('value' in node) {
    node.value = normalized;
  } else {
    node.textContent = normalized;
  }
}

function pushDebugEvent(label, message, details = null, level = 'info') {
  const normalizedDetails = details == null
    ? ''
    : (
      typeof details === 'string'
        ? details
        : JSON.stringify(debugEventPayload(details), null, 2)
    );
  debugState.events.unshift({
    id: ++debugState.counter,
    ts: new Date().toLocaleTimeString(),
    label,
    message,
    details: normalizedDetails,
    level
  });
  if (debugState.events.length > DEBUG_PANEL_MAX_EVENTS) {
    debugState.events.length = DEBUG_PANEL_MAX_EVENTS;
  }
  renderDebugPanel();
}

function workerTimeoutMs(action, options = {}) {
  if (Number.isFinite(Number(options.timeoutMs))) return Number(options.timeoutMs);
  return WORKER_TIMEOUT_BY_ACTION[action] || 20000;
}

function summarizeWorkerResponse(action, response) {
  const base = {
    success: Boolean(response?.success),
    code: response?.code || '',
    error: response?.error || ''
  };

  if (action === 'FETCH_MESSAGE_SUMMARIES') {
    return {
      ...base,
      count: numericValue(response?.count, 0),
      loadedCount: numericValue(response?.loadedCount, 0),
      summariesLength: Array.isArray(response?.summaries) ? response.summaries.length : 0,
      nextCursor: String(response?.nextCursor || ''),
      hasMore: Boolean(response?.hasMore),
      source: response?.source || ''
    };
  }

  if (action === 'FETCH_CONTACT_MESSAGES') {
    return {
      ...base,
      count: numericValue(response?.count, 0),
      messagesLength: Array.isArray(response?.messages) ? response.messages.length : 0,
      nextCursor: String(response?.nextCursor || ''),
      hasMore: Boolean(response?.hasMore),
      source: response?.source || ''
    };
  }

  if (action === 'FETCH_CONTACT_BODIES') {
    return {
      ...base,
      count: numericValue(response?.count, 0),
      messagesLength: Array.isArray(response?.messages) ? response.messages.length : 0,
      source: response?.source || ''
    };
  }

  if (action === 'SEARCH_MESSAGES') {
    return {
      ...base,
      count: numericValue(response?.count, 0),
      messagesLength: Array.isArray(response?.messages) ? response.messages.length : 0,
      source: response?.source || ''
    };
  }

  return response;
}

function sendWorker(action, payload = {}, options = {}) {
  const requestId = debugState.counter + 1;
  const timeoutMs = workerTimeoutMs(action, options);
  const startedAt = performance.now();
  mLog(`${action}:request`, {
    requestId,
    timeout_ms: timeoutMs,
    payload
  });
  pushDebugEvent('worker:request', `${action} started`, { requestId, timeoutMs, payload });

  let timeoutId = null;
  const workerPromise = Promise.resolve().then(() => chrome.runtime.sendMessage({ action, payload }));
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = window.setTimeout(() => {
      const error = new Error(`${action} timed out after ${timeoutMs}ms`);
      error.code = 'WORKER_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });

  return Promise.race([workerPromise, timeoutPromise])
    .then((response) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      mLog(`${action}:response`, {
        requestId,
        duration_ms: Math.round(performance.now() - startedAt),
        response: summarizeWorkerResponse(action, response)
      });
      pushDebugEvent(
        response?.success === false ? 'worker:error' : 'worker:response',
        `${action} completed`,
        { requestId, response: summarizeWorkerResponse(action, response) },
        response?.success === false ? 'error' : 'success'
      );
      return response;
    })
    .catch((error) => {
      if (timeoutId) window.clearTimeout(timeoutId);
      mLog(`${action}:error`, {
        requestId,
        duration_ms: Math.round(performance.now() - startedAt),
        code: error?.code || '',
        message: error?.message || String(error)
      });
      pushDebugEvent('worker:exception', `${action} failed`, {
        requestId,
        error: {
          code: error?.code || '',
          message: error?.message || String(error)
        }
      }, 'error');
      throw error;
    });
}

function openExternalPage(url) {
  const shouldConfirm = normalizeUiSettings(state.uiSettings).confirmExternalLinks;
  if (shouldConfirm) {
    const confirmed = window.confirm('Open this link in a new tab?');
    if (!confirmed) return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function createDiagnosticId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDiagnosticDetails(details) {
  if (details == null) return undefined;
  if (typeof details === 'string') {
    const value = details.replace(/\s+/g, ' ').trim();
    return value || undefined;
  }

  try {
    return JSON.stringify(details);
  } catch {
    return String(details).replace(/\s+/g, ' ').trim();
  }
}

function normalizeDiagnosticEntry(entry) {
  if (!entry || typeof entry !== 'object') return null;

  const source = String(entry.source || '').trim().toUpperCase();
  const level = String(entry.level || '').trim().toLowerCase();
  const stage = String(entry.stage || '').trim();
  const message = String(entry.message || '').trim();

  if (!source || !level || !stage || !message) return null;

  return {
    id: typeof entry.id === 'string' && entry.id ? entry.id : createDiagnosticId(),
    ts: typeof entry.ts === 'string' && entry.ts ? entry.ts : new Date().toISOString(),
    source,
    level,
    stage,
    message,
    code: typeof entry.code === 'string' && entry.code ? entry.code : undefined,
    details: normalizeDiagnosticDetails(entry.details)
  };
}

function normalizeSetupDiagnostics(input) {
  const src = input && typeof input === 'object' ? input : {};
  const entries = Array.isArray(src.entries)
    ? src.entries.map((entry) => normalizeDiagnosticEntry(entry)).filter(Boolean)
    : [];

  return {
    entries
  };
}

function normalizeTraceEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => normalizeDiagnosticEntry(entry)).filter(Boolean)
    : [];
}

function mergeTraceEntries(...groups) {
  const combined = groups.flat().filter(Boolean);
  const merged = [];
  const seen = new Set();

  normalizeTraceEntries(combined).forEach((entry) => {
    const signature = [
      entry.ts,
      entry.source,
      entry.level,
      entry.stage,
      entry.message,
      entry.code || '',
      entry.details || ''
    ].join('|');

    if (seen.has(signature)) return;
    seen.add(signature);
    merged.push(entry);
  });

  return merged;
}

function numericValue(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function defaultUiSettings() {
  return {
    themeMode: 'messages_scenic_blue',
    loadRemoteImages: true,
    confirmExternalLinks: true
  };
}

function normalizeThemeMode(value) {
  const raw = String(value || '').trim();
  if (THEME_MODES.includes(raw)) return raw;

  if (raw === 'khaki') return 'messages_glass_beige';
  if (raw === 'sunrise') return 'messages_scenic_blue';
  if (raw === 'system') return 'messages_glass_blue';

  if (raw) {
    return 'messages_glass_blue';
  }

  return defaultUiSettings().themeMode;
}

function normalizeUiSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const defaults = defaultUiSettings();
  const themeMode = normalizeThemeMode(src.themeMode);

  return {
    themeMode,
    loadRemoteImages: src.loadRemoteImages == null
      ? (src.loadRemoteContent == null ? defaults.loadRemoteImages : Boolean(src.loadRemoteContent))
      : Boolean(src.loadRemoteImages),
    confirmExternalLinks: src.confirmExternalLinks == null ? defaults.confirmExternalLinks : Boolean(src.confirmExternalLinks)
  };
}

function resolvedThemeMode(uiSettings = state.uiSettings) {
  const settings = normalizeUiSettings(uiSettings);
  return settings.themeMode;
}

function normalizeBuildInfo(input) {
  const src = input && typeof input === 'object' ? input : {};
  return {
    version: typeof src.version === 'string' && src.version ? src.version : 'unknown',
    buildSha: typeof src.buildSha === 'string' && src.buildSha ? src.buildSha : 'unknown',
    deployedAt: typeof src.deployedAt === 'string' && src.deployedAt ? src.deployedAt : null
  };
}

function normalizeMailboxDebug(input) {
  const src = input && typeof input === 'object' ? input : {};
  const cache = src.cache && typeof src.cache === 'object' ? src.cache : {};
  const live = src.live && typeof src.live === 'object' ? src.live : {};

  return {
    backend: normalizeBuildInfo(src.backend),
    cache: {
      used: Boolean(cache.used),
      newestCachedAt: typeof cache.newestCachedAt === 'string' && cache.newestCachedAt ? cache.newestCachedAt : null,
      totalMessages: numericValue(cache.totalMessages, 0),
      missingContentCount: numericValue(cache.missingContentCount, 0),
      shortContentCount: numericValue(cache.shortContentCount, 0),
      contentCoveragePct: numericValue(cache.contentCoveragePct, 100)
    },
    live: {
      used: Boolean(live.used),
      limitPerFolder: numericValue(live.limitPerFolder, 0),
      totalMessages: numericValue(live.totalMessages, 0),
      missingContentCount: numericValue(live.missingContentCount, 0),
      shortContentCount: numericValue(live.shortContentCount, 0),
      contentCoveragePct: numericValue(live.contentCoveragePct, 100)
    }
  };
}

function blankMailboxDebug() {
  return normalizeMailboxDebug(null);
}

function defaultMailboxTimings() {
  return {
    user_lookup_ms: 0,
    cache_freshness_ms: 0,
    cache_read_ms: 0,
    grouping_ms: 0,
    imap_fetch_ms: 0,
    upsert_ms: 0,
    total_ms: 0
  };
}

function normalizeTimings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const defaults = defaultMailboxTimings();
  return {
    user_lookup_ms: numericValue(src.user_lookup_ms, defaults.user_lookup_ms),
    cache_freshness_ms: numericValue(src.cache_freshness_ms, defaults.cache_freshness_ms),
    cache_read_ms: numericValue(src.cache_read_ms, defaults.cache_read_ms),
    grouping_ms: numericValue(src.grouping_ms, defaults.grouping_ms),
    imap_fetch_ms: numericValue(src.imap_fetch_ms, defaults.imap_fetch_ms),
    upsert_ms: numericValue(src.upsert_ms, defaults.upsert_ms),
    total_ms: numericValue(src.total_ms, defaults.total_ms)
  };
}

function timeValueMs(value) {
  const parsed = Number(value);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function messageReceivedAtMs(message) {
  const parsed = Number(message?.receivedAtMs || 0);
  if (Number.isFinite(parsed) && parsed > 0) return parsed;
  return timeValueMs(message?.date);
}

function normalizeContactSummary(input) {
  const src = input && typeof input === 'object' ? input : {};
  const contactKey = String(src.contactKey || '').trim();
  return {
    contactKey,
    threadId: contactKey,
    contactEmail: String(src.contactEmail || '').trim().toLowerCase(),
    displayName: String(src.displayName || '').trim()
      || String(src.contactEmail || '').trim().toLowerCase()
      || 'Unknown contact',
    latestSubject: String(src.latestSubject || '(no subject)').trim() || '(no subject)',
    latestPreview: String(src.latestPreview || '').trim(),
    latestDate: String(src.latestDate || new Date(0).toISOString()).trim() || new Date(0).toISOString(),
    latestReceivedAtMs: numericValue(src.latestReceivedAtMs, timeValueMs(src.latestDate)),
    latestDirection: src.latestDirection === 'outgoing' ? 'outgoing' : 'incoming',
    latestMessageId: String(src.latestMessageId || '').trim(),
    messageCount: numericValue(src.messageCount, 0),
    threadCount: numericValue(src.threadCount, 0),
    unreadCount: numericValue(src.unreadCount, 0),
    hasMissingContent: Boolean(src.hasMissingContent),
    inboxCount: numericValue(src.inboxCount, 0),
    sentCount: numericValue(src.sentCount, 0),
    contactKind: src.contactKind === 'organization' ? 'organization' : 'person',
    contactDomain: String(src.contactDomain || '').trim().toLowerCase()
  };
}

function currentSummaryItems() {
  if (Array.isArray(state.summaryItems) && state.summaryItems.length === state.summaryOrder.length) {
    return state.summaryItems;
  }
  if (Array.isArray(state.summaryOrder) && state.summaryOrder.length) {
    state.summaryItems = state.summaryOrder
      .map((threadId) => state.summaryByThreadId[threadId])
      .filter(Boolean);
    return state.summaryItems;
  }
  return Array.isArray(state.summaryItems) ? state.summaryItems : [];
}

function replaceSummaryItems(items) {
  const normalized = Array.isArray(items)
    ? items.map(normalizeContactSummary).filter((summary) => summary.contactKey)
    : [];
  const sorted = [...normalized].sort((left, right) =>
    numericValue(right.latestReceivedAtMs, timeValueMs(right.latestDate))
      - numericValue(left.latestReceivedAtMs, timeValueMs(left.latestDate)));
  rebuildSummaryIndex(sorted);
  return normalized;
}

function mergeSummaryItems(existingItems, incomingItems) {
  const byKey = new Map();
  (Array.isArray(existingItems) ? existingItems : []).forEach((item) => {
    const normalized = normalizeContactSummary(item);
    if (normalized.contactKey) byKey.set(normalized.contactKey, normalized);
  });
  (Array.isArray(incomingItems) ? incomingItems : []).forEach((item) => {
    const normalized = normalizeContactSummary(item);
    if (!normalized.contactKey) return;
    const existing = byKey.get(normalized.contactKey);
    if (!existing) {
      byKey.set(normalized.contactKey, normalized);
      return;
    }
    const existingDate = numericValue(existing.latestReceivedAtMs, timeValueMs(existing.latestDate));
    const incomingDate = numericValue(normalized.latestReceivedAtMs, timeValueMs(normalized.latestDate));
    const merged = incomingDate >= existingDate
      ? { ...existing, ...normalized }
      : { ...normalized, ...existing };
    merged.messageCount = Math.max(numericValue(existing.messageCount, 0), numericValue(normalized.messageCount, 0));
    merged.threadCount = Math.max(numericValue(existing.threadCount, 0), numericValue(normalized.threadCount, 0));
    merged.unreadCount = Math.max(numericValue(existing.unreadCount, 0), numericValue(normalized.unreadCount, 0));
    merged.inboxCount = Math.max(numericValue(existing.inboxCount, 0), numericValue(normalized.inboxCount, 0));
    merged.sentCount = Math.max(numericValue(existing.sentCount, 0), numericValue(normalized.sentCount, 0));
    merged.hasMissingContent = Boolean(existing.hasMissingContent || normalized.hasMissingContent);
    byKey.set(normalized.contactKey, normalizeContactSummary(merged));
  });
  return [...byKey.values()].sort((a, b) =>
    numericValue(b.latestReceivedAtMs, timeValueMs(b.latestDate))
      - numericValue(a.latestReceivedAtMs, timeValueMs(a.latestDate)));
}

function defaultContactLoadState() {
  return {
    attempted: false,
    loaded: false,
    inFlight: false,
    errorCode: '',
    error: '',
    source: 'contact',
    scope: 'all',
    count: 0,
    trace: [],
    timings: defaultMailboxTimings(),
    backend: normalizeBuildInfo(null),
    schemaFallbackUsed: false,
    richContentSource: 'cache',
    cursorResolved: false,
    nextCursor: '',
    hasMore: false,
    requestedAt: null,
    completedAt: null
  };
}

async function readUiSettings() {
  const stored = await chrome.storage.local.get([UI_SETTINGS_STORAGE_KEY]);
  return normalizeUiSettings(stored[UI_SETTINGS_STORAGE_KEY]);
}

async function persistUiSettings(nextSettings) {
  const normalized = normalizeUiSettings(nextSettings);
  await chrome.storage.local.set({ [UI_SETTINGS_STORAGE_KEY]: normalized });
  state.uiSettings = normalized;
  return normalized;
}

function requestDetailSnapToLatest(threadId = state.selectedThreadId) {
  state.detailSnapToLatestThreadId = String(threadId || '').trim();
}

function captureDetailScrollAnchor(body) {
  if (!(body instanceof HTMLElement)) return null;
  const bodyRect = body.getBoundingClientRect();
  const anchorNode = [...body.querySelectorAll('.gmail-unified-message[data-message-id]')]
    .find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      return rect.bottom >= bodyRect.top + 8;
    });
  if (!(anchorNode instanceof HTMLElement)) return null;

  const messageId = String(anchorNode.getAttribute('data-message-id') || '').trim();
  if (!messageId) return null;

  return {
    messageId,
    offsetTop: anchorNode.getBoundingClientRect().top - bodyRect.top
  };
}

function restoreDetailScrollAnchor(body, anchor) {
  if (!(body instanceof HTMLElement) || !anchor?.messageId) return false;
  const target = body.querySelector(`.gmail-unified-message[data-message-id="${CSS.escape(anchor.messageId)}"]`);
  if (!(target instanceof HTMLElement)) return false;

  const bodyRect = body.getBoundingClientRect();
  const desiredTop = numericValue(anchor.offsetTop, 0);
  const actualTop = target.getBoundingClientRect().top - bodyRect.top;
  body.scrollTop += actualTop - desiredTop;
  return true;
}

function resetSectionedMailboxCaches(options = {}) {
  state.summaryItems = [];
  state.summaryByThreadId = {};
  state.summaryOrder = [];
  state.summaryCursor = '';
  state.summaryHasMore = false;
  state.summaryBootstrapInFlight = false;
  state.summaryInitialLoadInFlight = false;
  state.summaryAppendInFlight = false;
  state.summaryAppliedGeneration = 0;
  state.summaryLastRequestId = 0;
  state.summaryLastIgnoredReason = '';
  state.summaryWorkerCount = 0;
  state.summaryNormalizedCount = 0;
  state.summaryRenderedCount = 0;
  state.summaryLoadedCount = 0;
  state.contactMessagesByKey = {};
  state.contactMessageIndexByKey = {};
  state.contactLoadStateByKey = {};
  state.contactRequestGenerationByKey = {};
  if (options.invalidateRequests !== false) {
    state.summaryRequestGeneration += 1;
  }
  if (options.resetContactDebug !== false) {
    state.contactDebug = {};
  }
}

function accountEmailLower() {
  return String(state.accountSnapshot?.accountEmail || '').trim().toLowerCase();
}

function usingLegacyMailboxFlow() {
  return state.mailboxMode === 'legacy' || state.useLegacyMailboxFallback;
}

function activeMailboxSourceLabel() {
  if (state.mailboxMode === 'search' || state.searchQuery) return 'search';
  if (state.useLegacyMailboxFallback || state.mailboxMode === 'legacy') return 'legacy';
  return 'summary';
}

function currentMailboxScope() {
  return state.filter === 'inbox' || state.filter === 'sent'
    ? state.filter
    : 'all';
}

function messageVisibleInCurrentFilter(message) {
  if (!message) return false;
  if (message.optimisticPending || message.optimisticLocal) return true;
  if (state.filter === 'inbox') return !message.isOutgoing;
  if (state.filter === 'sent') return Boolean(message.isOutgoing);
  return true;
}

function filteredMessagesForCurrentFilter(messages) {
  return [...(Array.isArray(messages) ? messages : [])]
    .filter((message) => messageVisibleInCurrentFilter(message))
    .sort(byDateDesc);
}

function throttle(fn, waitMs = 100) {
  let lastRunAt = 0;
  let timerId = null;
  let queuedArgs = [];

  return (...args) => {
    const now = Date.now();
    const remaining = waitMs - (now - lastRunAt);
    queuedArgs = args;

    if (remaining <= 0) {
      if (timerId) {
        clearTimeout(timerId);
        timerId = null;
      }
      lastRunAt = now;
      fn(...queuedArgs);
      return;
    }

    if (timerId) return;
    timerId = window.setTimeout(() => {
      timerId = null;
      lastRunAt = Date.now();
      fn(...queuedArgs);
    }, remaining);
  };
}

function summaryVisibleInCurrentFilter(summary) {
  if (!summary) return false;
  if (state.filter === 'inbox') return numericValue(summary.inboxCount, 0) > 0;
  if (state.filter === 'sent') return numericValue(summary.sentCount, 0) > 0;
  return true;
}

function getContactLoadState(contactKey) {
  const key = String(contactKey || '').trim();
  if (!key) return defaultContactLoadState();
  if (!state.contactLoadStateByKey[key]) {
    state.contactLoadStateByKey[key] = defaultContactLoadState();
  }
  return state.contactLoadStateByKey[key];
}

function currentContactRequestGeneration(contactKey) {
  return numericValue(state.contactRequestGenerationByKey[contactKey], 0);
}

function isCurrentContactRequestGeneration(contactKey, requestGeneration) {
  return currentContactRequestGeneration(contactKey) === numericValue(requestGeneration, 0);
}

function hydrationInFlightSet(contactKey) {
  const key = String(contactKey || '').trim();
  if (!key) return null;
  if (!contactBodyHydrationInFlightByKey.has(key)) {
    contactBodyHydrationInFlightByKey.set(key, new Set());
  }
  return contactBodyHydrationInFlightByKey.get(key);
}

function releaseHydrationMessageIds(contactKey, messageIds = []) {
  const key = String(contactKey || '').trim();
  if (!key || !contactBodyHydrationInFlightByKey.has(key)) return;
  const inFlight = contactBodyHydrationInFlightByKey.get(key);
  (Array.isArray(messageIds) ? messageIds : []).forEach((messageId) => {
    inFlight.delete(String(messageId || '').trim());
  });
  if (!inFlight.size) {
    contactBodyHydrationInFlightByKey.delete(key);
  }
}

function storeContactMessages(contactKey, messages, options = {}) {
  const existing = options.replace
    ? []
    : (Array.isArray(state.contactMessagesByKey[contactKey]) ? state.contactMessagesByKey[contactKey] : []);
  const deduped = new Map();
  [...existing, ...(Array.isArray(messages) ? messages : [])].forEach((message) => {
    if (!message?.id) return;
    deduped.set(message.id, message);
  });
  const orderedMessages = [...deduped.values()].sort(byDateDesc);
  state.contactMessagesByKey[contactKey] = orderedMessages;
  state.contactMessageIndexByKey[contactKey] = Object.fromEntries(
    orderedMessages
      .filter((message) => message?.id)
      .map((message) => [message.id, message])
  );
  return state.contactMessagesByKey[contactKey];
}

function refreshContactMessageIndex(contactKey) {
  const key = String(contactKey || '').trim();
  if (!key) return;
  const messages = Array.isArray(state.contactMessagesByKey[key]) ? state.contactMessagesByKey[key] : [];
  state.contactMessageIndexByKey[key] = Object.fromEntries(
    messages
      .filter((message) => message?.id)
      .map((message) => [message.id, message])
  );
}

function replaceMessageInCollections(contactKey, messageId, updater) {
  const key = String(contactKey || '').trim();
  const targetId = String(messageId || '').trim();
  if (!targetId) return null;

  const applyUpdate = (message) => {
    if (!message || String(message.id || '').trim() !== targetId) return message;
    const next = updater(message);
    return next && next.id ? next : message;
  };

  state.messages = (Array.isArray(state.messages) ? state.messages : []).map(applyUpdate).sort(byDateDesc);

  if (key && Array.isArray(state.contactMessagesByKey[key])) {
    state.contactMessagesByKey[key] = state.contactMessagesByKey[key].map(applyUpdate).sort(byDateDesc);
    refreshContactMessageIndex(key);
    return state.contactMessagesByKey[key];
  }

  return null;
}

function removeMessageFromCollections(contactKey, messageId) {
  const key = String(contactKey || '').trim();
  const targetId = String(messageId || '').trim();
  if (!targetId) return null;

  state.messages = (Array.isArray(state.messages) ? state.messages : [])
    .filter((message) => String(message?.id || '').trim() !== targetId)
    .sort(byDateDesc);

  if (key && Array.isArray(state.contactMessagesByKey[key])) {
    state.contactMessagesByKey[key] = state.contactMessagesByKey[key]
      .filter((message) => String(message?.id || '').trim() !== targetId)
      .sort(byDateDesc);
    refreshContactMessageIndex(key);
    return state.contactMessagesByKey[key];
  }

  return null;
}

function formatSyncTimestamp(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'No sync yet';
  return date.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function threadIdToContactEmail(threadId) {
  const value = String(threadId || '').trim();
  return value.startsWith('contact:') ? value.slice('contact:'.length) : '';
}

function getGroupContactEmail(group) {
  const summaryEmail = String(group?.summary?.contactEmail || '').trim().toLowerCase();
  if (summaryEmail) return summaryEmail;

  const fromThreadId = threadIdToContactEmail(group?.threadId);
  if (fromThreadId) return fromThreadId;

  const messages = Array.isArray(group?.messages) ? group.messages : [];
  const canonical = messages.find((message) => message?.contactEmail)?.contactEmail;
  if (canonical) return String(canonical).trim().toLowerCase();
  const fromIncoming = messages.find((message) => !message?.isOutgoing && message?.from?.email)?.from?.email;
  if (fromIncoming) return String(fromIncoming).trim().toLowerCase();

  const fromOutgoing = messages.find((message) => message?.isOutgoing && message?.to?.[0]?.email)?.to?.[0]?.email;
  if (fromOutgoing) return String(fromOutgoing).trim().toLowerCase();

  return '';
}

function findSummaryByContactEmail(contactEmail) {
  const target = String(contactEmail || '').trim().toLowerCase();
  if (!target) return null;
  return currentSummaryItems().find((summary) => String(summary?.contactEmail || '').trim().toLowerCase() === target) || null;
}

function removeSummaryByThreadId(threadId) {
  const key = String(threadId || '').trim();
  if (!key) return;
  delete state.summaryByThreadId[key];
  state.summaryOrder = state.summaryOrder.filter((entry) => entry !== key);
  state.summaryItems = state.summaryOrder
    .map((entry) => state.summaryByThreadId[entry])
    .filter(Boolean);
  state.summaryRenderedCount = state.summaryItems.length;
}

function buildSelectedMessageRefs(group) {
  return Array.isArray(group?.messages)
    ? group.messages.map((message) => ({
      id: message?.id || '',
      uid: message?.uid ?? null,
      folder: message?.folder || '',
      messageId: message?.messageId || ''
    }))
    : [];
}

function replaceMessagesForThread(threadId, nextMessages) {
  const remaining = state.messages.filter((message) => threadCounterpartyKey(message) !== threadId);
  const replacements = Array.isArray(nextMessages) ? nextMessages : [];
  const merged = new Map();

  [...remaining, ...replacements].forEach((message) => {
    if (!message?.id) return;
    merged.set(message.id, message);
  });

  state.messages = [...merged.values()];
  if (threadId) {
    const storedMessages = storeContactMessages(threadId, replacements, { replace: true });
    if (storedMessages.length) {
      upsertContactSummary(buildContactSummaryFromMessages(threadId, storedMessages));
    }
  }
}

function messageContentCounts(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const missing = list.filter((message) => snippetHealth(message) === 'missing').length;
  const short = list.filter((message) => snippetHealth(message) === 'short').length;
  return {
    total: list.length,
    missing,
    short,
    present: Math.max(0, list.length - missing - short)
  };
}

function defaultContactDebugState() {
  return {
    attempted: false,
    inFlight: false,
    contactEmail: '',
    beforeCount: 0,
    beforeMissingContentCount: 0,
    afterCount: 0,
    afterMissingContentCount: 0,
    backend: normalizeBuildInfo(null),
    trace: [],
    perMessageExtraction: [],
    error: '',
    requestedAt: null,
    completedAt: null
  };
}

function getContactDebugState(threadId) {
  const key = String(threadId || '');
  if (!key) return defaultContactDebugState();
  if (!state.contactDebug[key]) {
    state.contactDebug[key] = defaultContactDebugState();
  }
  return state.contactDebug[key];
}

function rebuildSummaryIndex(items = []) {
  const nextByThreadId = {};
  const nextOrder = [];

  (Array.isArray(items) ? items : []).forEach((summary) => {
    if (!summary?.contactKey) return;
    nextByThreadId[summary.contactKey] = summary;
    nextOrder.push(summary.contactKey);
  });

  state.summaryByThreadId = nextByThreadId;
  state.summaryOrder = nextOrder;
  state.summaryItems = nextOrder
    .map((threadId) => nextByThreadId[threadId])
    .filter(Boolean);
  state.summaryRenderedCount = state.summaryItems.length;
}

function resyncSummaryOrderForKey(threadId) {
  const key = String(threadId || '').trim();
  const summary = state.summaryByThreadId[key];
  if (!key || !summary) return;

  state.summaryOrder = state.summaryOrder.filter((entry) => entry !== key);
  const nextTime = numericValue(summary.latestReceivedAtMs, timeValueMs(summary.latestDate));
  let insertIndex = state.summaryOrder.findIndex((candidateKey) => {
    const candidate = state.summaryByThreadId[candidateKey];
    return numericValue(candidate?.latestReceivedAtMs, timeValueMs(candidate?.latestDate)) < nextTime;
  });
  if (insertIndex < 0) insertIndex = state.summaryOrder.length;
  state.summaryOrder.splice(insertIndex, 0, key);
  state.summaryItems = state.summaryOrder
    .map((entry) => state.summaryByThreadId[entry])
    .filter(Boolean);
  state.summaryRenderedCount = state.summaryItems.length;
}

function findSummaryByThreadId(threadId) {
  const key = String(threadId || '').trim();
  if (!key) return null;
  return state.summaryByThreadId[key] || currentSummaryItems().find((summary) => summary.contactKey === key) || null;
}

async function appendUiActivity(entry, options = {}) {
  try {
    const payload = {
      reset: Boolean(options.reset),
      entry
    };
    await sendWorker('DIAGNOSTICS_LOG', payload, { timeoutMs: 2500 });
  } catch {
    // Ignore diagnostics failures in the UI path.
  }
}

function defaultGuideState() {
  return {
    step: 'connect_account',
    substep: 'connect_ready',
    status: {
      connect_account: 'in_progress'
    },
    evidence: {
      oauth: {
        connectedAt: null,
        source: null
      }
    },
    progress: 0,
    total: 1,
    currentContext: 'unknown',
    connected: false,
    updatedAt: new Date().toISOString()
  };
}

function normalizeGuideState(input) {
  const fallback = defaultGuideState();
  const src = input && typeof input === 'object' ? input : {};
  const status = { ...fallback.status };
  const legacyStatus = src.status && typeof src.status === 'object' ? src.status : {};
  const evidence = JSON.parse(JSON.stringify(fallback.evidence));

  if (legacyStatus && typeof legacyStatus === 'object') {
    for (const key of GUIDE_STEPS) {
      const value = legacyStatus[key];
      if (value === 'pending' || value === 'in_progress' || value === 'done') {
        status[key] = value;
      }
    }
  }

  if (src.evidence && typeof src.evidence === 'object') {
    if (src.evidence.oauth && typeof src.evidence.oauth === 'object') {
      const oauth = src.evidence.oauth;
      if (typeof oauth.connectedAt === 'string') evidence.oauth.connectedAt = oauth.connectedAt;
      if (typeof oauth.source === 'string') evidence.oauth.source = oauth.source;
    }
  }

  let step = GUIDE_STEP_SET.has(src.step) ? src.step : 'connect_account';

  let substep = typeof src.substep === 'string' ? src.substep : fallback.substep;
  if (!GUIDE_SUBSTEP_COPY[step] || !GUIDE_SUBSTEP_COPY[step][substep]) {
    substep = status.connect_account === 'done' ? 'connected' : 'connect_ready';
  }

  const progress = GUIDE_STEPS.reduce((total, key) => total + (status[key] === 'done' ? 1 : 0), 0);

  return {
    step,
    substep,
    status,
    evidence,
    progress,
    total: GUIDE_STEPS.length,
    currentContext: typeof src.currentContext === 'string' ? src.currentContext : 'unknown',
    connected: Boolean(src.connected),
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : new Date().toISOString()
  };
}

function stepNumberFromKey(stepKey) {
  const index = GUIDE_STEPS.indexOf(stepKey);
  return index >= 0 ? index + 1 : 1;
}

function resolvedGuideStepForUi(guideInput = state.guideState) {
  const guide = normalizeGuideState(guideInput);
  return guide.step;
}

function currentPageContext() {
  if (isMailHost()) return 'gmail_inbox';
  return 'other';
}

function friendlyContextLabel(context) {
  if (context === 'gmail_inbox') return 'Gmail inbox';
  if (context === 'google_account') return 'Google account';
  return 'another page';
}

function updateMainPanelVisibility() {
  const detail = document.getElementById('gmailUnifiedDetail');
  const empty = document.getElementById('gmailUnifiedMainEmpty');
  if (!detail || !empty) return;

  const showDetail = detail.style.display !== 'none' && Boolean(state.selectedThreadId);
  empty.style.display = showDetail ? 'none' : 'flex';
}

function waitForGmail(callback) {
  const check = () => {
    const mainArea = document.querySelector('[role="main"]');
    if (mainArea) {
      callback();
    } else {
      setTimeout(check, 500);
    }
  };
  check();
}

function formatDate(value) {
  const date = new Date(timeValueMs(value));
  if (Number.isNaN(date.getTime())) return '';
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
}

function calendarDayLabel(value) {
  const date = new Date(timeValueMs(value));
  if (Number.isNaN(date.getTime())) return '';

  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';

  return date.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  });
}

function initialsForLabel(value) {
  const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '?';
  if (tokens.length === 1) return tokens[0].slice(0, 2).toUpperCase();
  return `${tokens[0][0] || ''}${tokens[1][0] || ''}`.toUpperCase();
}

function cleanPreviewText(value, maxLength = 120) {
  const cleaned = String(value || '')
    .replace(/\[(?:image|attachment)(?::[^\]]*)?\]\s*/gi, '')
    .replace(/https?:\/\/\S+/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.length > maxLength ? `${cleaned.slice(0, maxLength - 1).trimEnd()}…` : cleaned;
}

function messagePreviewText(message, maxLength = 120) {
  const source = cleanPreviewText(message?.bodyText || message?.snippet || message?.subject || '', maxLength);
  return source || '(no preview)';
}

function senderIdentityKey(message) {
  if (message?.isOutgoing) return 'outgoing:self';
  const replyTo = String(message?.replyTo?.email || '').trim().toLowerCase();
  if (replyTo) return `incoming:${replyTo}`;
  const fromEmail = String(message?.from?.email || '').trim().toLowerCase();
  if (fromEmail) return `incoming:${fromEmail}`;
  const fromName = String(message?.from?.name || '').trim().toLowerCase();
  return `incoming-name:${fromName}`;
}

function normalizedSubjectKey(subject) {
  return String(subject || '')
    .replace(/^(?:re|fwd|fw):\s*/ig, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function shouldClusterWithPrevious(previousMessage, nextMessage) {
  if (!previousMessage || !nextMessage) return false;
  if (calendarDayLabel(previousMessage.receivedAtMs || previousMessage.date) !== calendarDayLabel(nextMessage.receivedAtMs || nextMessage.date)) return false;
  if (senderIdentityKey(previousMessage) !== senderIdentityKey(nextMessage)) return false;
  if (normalizedSubjectKey(previousMessage.subject) !== normalizedSubjectKey(nextMessage.subject)) return false;

  const previousTs = messageReceivedAtMs(previousMessage);
  const nextTs = messageReceivedAtMs(nextMessage);
  if (!Number.isFinite(previousTs) || !Number.isFinite(nextTs)) return false;

  return Math.abs(nextTs - previousTs) <= 20 * 60 * 1000;
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function messageBodyPlainText(message) {
  return String(message?.bodyText || message?.snippet || '').trim();
}

function htmlToDisplayMarkup(html, options = {}) {
  const source = String(html || '').trim();
  if (!source) return '';

  const parser = new DOMParser();
  const parsed = parser.parseFromString(`<div>${source}</div>`, 'text/html');
  const root = parsed.body.firstElementChild;
  if (!root) return '';

  root.querySelectorAll('a[href]').forEach((link) => {
    const href = String(link.getAttribute('href') || '').trim();
    if (!href) return;
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener noreferrer');
    link.setAttribute('data-mailita-link', 'true');
  });

  root.querySelectorAll('img').forEach((image) => {
    const src = String(image.getAttribute('src') || '').trim();
    image.setAttribute('loading', 'lazy');
    image.setAttribute('referrerpolicy', 'no-referrer');
    image.classList.add('gmail-unified-message-image');
    if (!options.loadRemoteImages && /^https?:\/\//i.test(src)) {
      image.setAttribute('data-mailita-blocked-image', 'true');
      image.setAttribute('data-mailita-src', src);
      image.removeAttribute('src');
      image.setAttribute('alt', image.getAttribute('alt') || 'Remote image blocked');
    }
  });

  return root.innerHTML.trim();
}

function messageDisplayMarkup(message) {
  if (message?.contentState === 'metadata') {
    return {
      kind: 'metadata',
      subject: escapeHtml(String(message?.subject || '(no subject)').trim() || '(no subject)'),
      preview: escapeHtml(String(message?.snippet || '').trim() || 'Loading message...'),
      sender: escapeHtml(threadCounterparty(message)),
      date: escapeHtml(formatDate(message?.receivedAtMs || message?.date))
    };
  }

  const settings = normalizeUiSettings(state.uiSettings);
  const html = htmlToDisplayMarkup(message?.bodyHtml, {
    loadRemoteImages: settings.loadRemoteImages
  });

  if (html) {
    return {
      kind: 'html',
      content: html
    };
  }

  const plain = messageBodyPlainText(message);
  if (plain) {
    return {
      kind: 'text',
      content: escapeHtml(plain)
    };
  }

  return {
    kind: 'placeholder',
    content: escapeHtml('(message content unavailable)')
  };
}

function mountRenderedEmailCard(host, html) {
  if (!host || !html) return;

  const root = host.shadowRoot || host.attachShadow({ mode: 'open' });
  root.innerHTML = `
    <style>
      :host {
        display: block;
        width: min(100%, 880px);
      }

      .mailita-email-card {
        box-sizing: border-box;
        width: 100%;
        overflow: hidden;
        border-radius: 22px;
        border: 1px solid rgba(28, 24, 20, 0.1);
        background: linear-gradient(180deg, #fffdfa, #f6f1ea);
        color: #201912;
        box-shadow:
          0 20px 42px rgba(0, 0, 0, 0.16),
          inset 0 1px 0 rgba(255, 255, 255, 0.92);
      }

      .mailita-email-body {
        box-sizing: border-box;
        width: 100%;
        padding: 22px 24px;
        font: 400 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        color: inherit;
        overflow-wrap: anywhere;
      }

      .mailita-email-body :where(*) {
        box-sizing: border-box;
        max-width: 100%;
      }

      .mailita-email-body :where(body, table, tbody, thead, tfoot, tr, td, th, div, section, article, main, aside) {
        font: inherit;
        color: inherit;
      }

      .mailita-email-body :where(p, div, blockquote, ul, ol, table) {
        margin-top: 0;
        margin-bottom: 16px;
      }

      .mailita-email-body :where(h1, h2, h3, h4, h5, h6) {
        margin: 0 0 16px;
        color: #17120e;
        line-height: 1.24;
      }

      .mailita-email-body a {
        color: #1f5bb5;
        text-decoration: underline;
        text-underline-offset: 3px;
        cursor: pointer;
      }

      .mailita-email-body img {
        display: block;
        max-width: 100%;
        height: auto;
      }

      .mailita-email-body img[data-mailita-blocked-image="true"] {
        min-height: 88px;
        border-radius: 16px;
        background: rgba(18, 18, 20, 0.06);
        border: 1px dashed rgba(18, 18, 20, 0.16);
      }

      .mailita-email-body table {
        border-collapse: collapse;
      }
    </style>
    <div class="mailita-email-card">
      <div class="mailita-email-body">${html}</div>
    </div>
  `;

  if (!host.dataset.mailitaBound) {
    root.addEventListener('click', (event) => {
      const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
      const anchor = path.find((node) => node instanceof HTMLAnchorElement);
      if (!(anchor instanceof HTMLAnchorElement)) return;

      const href = String(anchor.getAttribute('href') || '').trim();
      if (!href) return;

      event.preventDefault();
      event.stopPropagation();
      openExternalPage(href);
    });
    host.dataset.mailitaBound = 'true';
  }
}

function shellContextLabel() {
  return state.connected ? 'Messages' : 'Setup';
}

function applyThemeSettings() {
  const sidebar = document.getElementById('gmailUnifiedSidebar');
  if (!sidebar) return;

  const themeMode = resolvedThemeMode(state.uiSettings);
  sidebar.dataset.themeMode = themeMode;
  sidebar.dataset.settingsOpen = state.settingsOpen ? 'true' : 'false';
  sidebar.style.setProperty('--mailita-scenic-image', `url("${chrome.runtime.getURL('content/hero-landscape-color.png')}")`);
}

function renderSettingsUi() {
  const settings = normalizeUiSettings(state.uiSettings);
  const context = document.getElementById('gmailUnifiedRailContext');
  const composeButton = document.getElementById('gmailUnifiedComposeBtn');
  const panel = document.getElementById('gmailUnifiedSettingsPanel');
  const accountEmail = document.getElementById('gmailUnifiedSettingsEmail');
  const accountSync = document.getElementById('gmailUnifiedSettingsSyncTime');
  const accountStatus = document.getElementById('gmailUnifiedAccountStatus');

  if (context) {
    context.textContent = shellContextLabel();
  }

  if (panel) {
    panel.hidden = !state.settingsOpen || !state.connected;
  }
  if (composeButton) {
    composeButton.disabled = !state.connected;
  }

  document.querySelectorAll('.gmail-unified-theme-option[data-theme-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeMode === settings.themeMode);
  });

  const settingsDisconnect = document.getElementById('gmailUnifiedSettingsDisconnectBtn');
  if (settingsDisconnect) settingsDisconnect.disabled = !state.connected;

  if (accountEmail) accountEmail.textContent = state.accountSnapshot.accountEmail || 'Not connected';
  if (accountSync) accountSync.textContent = formatSyncTimestamp(state.accountSnapshot.lastSyncTime);
  if (accountStatus) {
    accountStatus.textContent = state.connected ? 'Connected' : 'Setup required';
    accountStatus.dataset.connected = state.connected ? 'true' : 'false';
  }
}

function defaultComposerState() {
  return {
    draft: '',
    mode: 'reply',
    targetMessageId: '',
    sendInFlight: false,
    sendError: '',
    sendStatus: ''
  };
}

function defaultComposeOverlayState() {
  return {
    open: false,
    to: '',
    subject: '',
    body: '',
    sendInFlight: false,
    sendError: '',
    sendStatus: ''
  };
}

function buildOptimisticOutgoingMessage(options = {}) {
  const primaryRecipient = Array.isArray(options.recipients) && options.recipients.length
    ? options.recipients[0]
    : { email: '', name: '' };
  const contactKey = String(options.contactKey || '').trim() || `contact:${String(primaryRecipient?.email || '').trim().toLowerCase()}`;
  const isoNow = new Date().toISOString();
  const bodyText = String(options.bodyText || '').trim();
  const subject = String(options.subject || '').trim();

  return {
    id: String(options.id || `optimistic-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
    threadId: String(options.threadId || contactKey).trim() || contactKey,
    folder: 'SENT',
    date: isoNow,
    receivedAtMs: Date.now(),
    from: {
      name: '',
      email: state.accountSnapshot.accountEmail || ''
    },
    to: Array.isArray(options.recipients) ? options.recipients : [],
    subject,
    snippet: bodyText,
    bodyText,
    bodyHtml: '',
    bodyFormat: 'text',
    hasRemoteImages: false,
    hasLinkedImages: false,
    isOutgoing: true,
    optimisticLocal: true,
    optimisticPending: true,
    contactKey,
    contactEmail: String(options.contactEmail || primaryRecipient?.email || '').trim().toLowerCase(),
    contactName: String(options.contactName || primaryRecipient?.name || primaryRecipient?.email || 'Unknown contact').trim(),
    contactKind: options.contactKind || 'person',
    contactDomain: String(options.contactDomain || '').trim(),
    flags: ['\\Seen'],
    messageId: '',
    rfcMessageId: '',
    references: String(options.references || '').trim(),
    inReplyTo: String(options.inReplyTo || '').trim(),
    cc: Array.isArray(options.cc) ? options.cc : [],
    replyTo: null
  };
}

function seedLocalOutgoingMessage(options = {}) {
  const optimisticMessage = buildOptimisticOutgoingMessage(options);
  const contactKey = optimisticMessage.contactKey;
  const previousSelectedThreadId = String(state.selectedThreadId || '').trim();
  const existingSummary = findSummaryByThreadId(contactKey) || findSummaryByContactEmail(optimisticMessage.contactEmail);
  if (existingSummary && existingSummary.contactKey !== contactKey) {
    optimisticMessage.contactKey = existingSummary.contactKey;
    optimisticMessage.threadId = String(options.threadId || existingSummary.contactKey).trim() || existingSummary.contactKey;
  }
  const resolvedContactKey = optimisticMessage.contactKey;

  state.messages = [optimisticMessage, ...(Array.isArray(state.messages) ? state.messages : [])].sort(byDateDesc);
  const mergedMessages = storeContactMessages(resolvedContactKey, [optimisticMessage]);
  upsertContactSummary(buildContactSummaryFromMessages(resolvedContactKey, mergedMessages));
  state.selectedThreadId = resolvedContactKey;
  requestDetailSnapToLatest(resolvedContactKey);

  return {
    optimisticId: optimisticMessage.id,
    threadId: resolvedContactKey,
    previousSelectedThreadId,
    hadExistingSummary: Boolean(existingSummary),
    optimisticMessage
  };
}

function rollbackLocalOutgoingMessage(seed, options = {}) {
  const threadId = String(seed?.threadId || '').trim();
  const optimisticId = String(seed?.optimisticId || '').trim();
  if (!threadId || !optimisticId) return;

  const remainingMessages = removeMessageFromCollections(threadId, optimisticId)
    || (state.contactMessagesByKey[threadId] || []);
  if (remainingMessages.length) {
    upsertContactSummary(buildContactSummaryFromMessages(threadId, remainingMessages));
  } else if (!seed?.hadExistingSummary) {
    removeSummaryByThreadId(threadId);
  }

  const restoredThreadId = String(options.restoreSelectedThreadId || seed?.previousSelectedThreadId || '').trim();
  state.selectedThreadId = restoredThreadId;
  state.detailLastThreadId = restoredThreadId ? state.detailLastThreadId : '';
  state.detailSnapToLatestThreadId = restoredThreadId ? state.detailSnapToLatestThreadId : '';
}

function reconcileLocalOutgoingMessage(seed, sent = {}) {
  const threadId = String(seed?.threadId || '').trim();
  const optimisticId = String(seed?.optimisticId || '').trim();
  if (!threadId || !optimisticId) return [];

  const nextMessages = replaceMessageInCollections(threadId, optimisticId, (message) => ({
    ...message,
    id: String(sent.id || message.id).trim() || message.id,
    messageId: String(sent.id || message.messageId || '').trim(),
    threadId: String(sent.threadId || message.threadId || '').trim() || message.threadId,
    optimisticPending: false
  })) || (state.contactMessagesByKey[threadId] || []);

  if (nextMessages.length) {
    upsertContactSummary(buildContactSummaryFromMessages(threadId, nextMessages));
  }

  return nextMessages;
}

function defaultCampaignModeState() {
  return {
    active: false,
    subjectTemplate: '',
    bodyTemplate: '',
    headers: [],
    rows: [],
    validationErrors: [],
    missingColumns: [],
    rowErrors: {},
    mode: 'review',
    reviewStarted: false,
    blastRunning: false,
    paused: false,
    stopped: false,
    stopRequested: false,
    completed: false,
    currentRowIndex: 0,
    activeRequestId: '',
    delayMs: CAMPAIGN_BLAST_DELAY_MS,
    delayUntilMs: 0,
    exitedToBackground: false,
    statusMessage: '',
    lastError: ''
  };
}

function parseComposeRecipients(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];

  const entries = raw
    .split(/[,\n;]+/)
    .map((entry) => String(entry || '').trim())
    .filter(Boolean)
    .map((entry) => {
      const match = entry.match(/^(.*)<([^>]+)>$/);
      if (!match) {
        return {
          email: entry,
          name: ''
        };
      }
      return {
        name: String(match[1] || '').replace(/(^\"|\"$)/g, '').trim(),
        email: String(match[2] || '').trim()
      };
    })
    .filter((entry) => /\S+@\S+\.\S+/.test(String(entry.email || '').trim()));

  return uniqueRecipientEntries(entries);
}

function syncComposeOverlayDraftFromDom() {
  const toInput = document.getElementById('gmailUnifiedComposeTo');
  const subjectInput = document.getElementById('gmailUnifiedComposeSubject');
  const bodyInput = document.getElementById('gmailUnifiedComposeBody');
  const nextDraft = {
    to: toInput instanceof HTMLInputElement ? toInput.value : state.composeOverlay.to,
    subject: subjectInput instanceof HTMLInputElement ? subjectInput.value : state.composeOverlay.subject,
    body: bodyInput instanceof HTMLTextAreaElement ? bodyInput.value : state.composeOverlay.body
  };

  state.composeOverlay = {
    ...state.composeOverlay,
    ...nextDraft
  };

  return nextDraft;
}

function renderComposeOverlay(options = {}) {
  const overlay = document.getElementById('gmailUnifiedComposeOverlay');
  const toInput = document.getElementById('gmailUnifiedComposeTo');
  const subjectInput = document.getElementById('gmailUnifiedComposeSubject');
  const bodyInput = document.getElementById('gmailUnifiedComposeBody');
  const sendButton = document.getElementById('gmailUnifiedComposeSend');
  const status = document.getElementById('gmailUnifiedComposeStatus');
  if (!overlay || !toInput || !subjectInput || !bodyInput || !sendButton || !status) return;

  overlay.hidden = !state.composeOverlay.open;
  overlay.style.display = state.composeOverlay.open ? 'grid' : 'none';
  if (!state.composeOverlay.open) {
    return;
  }

  if (toInput.value !== state.composeOverlay.to) toInput.value = state.composeOverlay.to;
  if (subjectInput.value !== state.composeOverlay.subject) subjectInput.value = state.composeOverlay.subject;
  if (bodyInput.value !== state.composeOverlay.body) bodyInput.value = state.composeOverlay.body;
  sendButton.disabled = state.composeOverlay.sendInFlight;
  sendButton.textContent = state.composeOverlay.sendInFlight ? 'Sending...' : 'Send';
  status.textContent = state.composeOverlay.sendError || state.composeOverlay.sendStatus || '';
  status.dataset.state = state.composeOverlay.sendError
    ? 'error'
    : (state.composeOverlay.sendStatus ? 'success' : 'idle');

  if (options.focusTo) {
    window.requestAnimationFrame(() => {
      toInput.focus();
      toInput.select();
    });
  }
}

function openComposeOverlay() {
  if (!state.connected) return;
  state.composeOverlay = {
    ...defaultComposeOverlayState(),
    open: true
  };
  renderComposeOverlay({ focusTo: true });
}

function closeComposeOverlay() {
  state.composeOverlay = defaultComposeOverlayState();
  renderComposeOverlay();
}

async function submitComposeOverlay() {
  if (state.composeOverlay.sendInFlight) return null;

  const draft = syncComposeOverlayDraftFromDom();
  const recipients = parseComposeRecipients(draft.to);
  const bodyText = String(draft.body || '').trim();
  const subject = String(draft.subject || '').trim();

  if (!recipients.length) {
    state.composeOverlay.sendError = 'Add at least one recipient.';
    state.composeOverlay.sendStatus = '';
    renderComposeOverlay();
    return null;
  }

  if (!bodyText) {
    state.composeOverlay.sendError = 'Message body is empty.';
    state.composeOverlay.sendStatus = '';
    renderComposeOverlay();
    return null;
  }

  state.composeOverlay.sendInFlight = true;
  state.composeOverlay.sendError = '';
  state.composeOverlay.sendStatus = '';
  renderComposeOverlay();

  const optimisticSeed = seedLocalOutgoingMessage({
    recipients,
    subject,
    bodyText,
    contactEmail: recipients[0]?.email || '',
    contactName: recipients[0]?.name || recipients[0]?.email || 'Unknown contact'
  });
  const optimisticRowPatched = refreshThreadRow(optimisticSeed.threadId);
  closeComposeOverlay();
  scheduleUiCommit({
    detail: true,
    detailThreadId: optimisticSeed.threadId,
    selectionOnly: true,
    rail: !optimisticRowPatched,
    overlays: true
  });

  let response;
  try {
    response = await sendWorker('SEND_MESSAGE', {
      to: recipients,
      subject,
      bodyText
    });
  } catch (error) {
    response = {
      success: false,
      code: error?.code || 'SEND_FAILED',
      error: error?.message || String(error)
    };
  } finally {
    state.composeOverlay.sendInFlight = false;
  }

  if (!response?.success) {
    rollbackLocalOutgoingMessage(optimisticSeed);
    state.composeOverlay = {
      ...defaultComposeOverlayState(),
      open: true,
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      sendError: response?.code === 'AUTH_SCOPE_REQUIRED'
      ? 'Mailita needs Gmail send permission before it can send.'
      : failureMessageForResponse(response, 'Send failed.'),
      sendStatus: ''
    };
    const failedRowPatched = refreshThreadRow(optimisticSeed.threadId);
    scheduleUiCommit({
      detail: true,
      detailThreadId: state.selectedThreadId,
      selectionOnly: true,
      rail: !failedRowPatched,
      overlays: true
    });
    return response;
  }

  reconcileLocalOutgoingMessage(optimisticSeed, response?.sent || {});
  const sentRowPatched = refreshThreadRow(optimisticSeed.threadId);
  scheduleUiCommit({
    detail: true,
    detailThreadId: optimisticSeed.threadId,
    selectionOnly: true,
    rail: !sentRowPatched
  });
  sendWorker('SYNC_MESSAGES', {
    trackActivity: false
  }).catch(() => {});
  return response;
}

function createCampaignRow(cells = [], options = {}) {
  return {
    id: String(options.id || `campaign-row-${createDiagnosticId()}`),
    cells: [...(Array.isArray(cells) ? cells : [])].map((value) => String(value ?? '')),
    status: String(options.status || 'pending'),
    sendError: String(options.sendError || ''),
    sentAt: String(options.sentAt || '')
  };
}

function syncCampaignTemplatesFromDom() {
  const subjectInput = document.getElementById('gmailUnifiedCampaignSubject');
  const bodyInput = document.getElementById('gmailUnifiedCampaignBody');
  if (subjectInput instanceof HTMLInputElement) {
    state.campaignMode.subjectTemplate = subjectInput.value;
  }
  if (bodyInput instanceof HTMLTextAreaElement) {
    state.campaignMode.bodyTemplate = bodyInput.value;
  }
}

function parseCampaignVariables(...values) {
  const tokens = new Set();
  values.forEach((value) => {
    const text = String(value || '');
    text.replace(/\[([^\]\r\n]+)\]/g, (_, rawToken) => {
      const token = String(rawToken || '').trim();
      if (token) tokens.add(token);
      return _;
    });
  });
  return [...tokens];
}

function campaignHeaderMap(headers = state.campaignMode.headers) {
  const map = new Map();
  (Array.isArray(headers) ? headers : []).forEach((header, index) => {
    const key = String(header || '').trim();
    if (key && !map.has(key)) {
      map.set(key, index);
    }
  });
  return map;
}

function isCampaignRowBlank(row, headerCount = state.campaignMode.headers.length) {
  const cells = Array.from({ length: Math.max(0, headerCount) }, (_, index) => String(row?.cells?.[index] ?? '')).map((value) => value.trim());
  return cells.every((value) => !value);
}

function isCampaignEmailValid(value) {
  return /\S+@\S+\.\S+/.test(String(value || '').trim());
}

function campaignValidationSnapshot(campaign = state.campaignMode) {
  const headers = Array.isArray(campaign.headers) ? campaign.headers.map((header) => String(header ?? '')) : [];
  const rows = Array.isArray(campaign.rows) ? campaign.rows : [];
  const headerLookup = campaignHeaderMap(headers);
  const tokens = parseCampaignVariables(campaign.subjectTemplate, campaign.bodyTemplate);
  const emailIndex = headers.findIndex((header) => String(header || '').trim() === 'Email');
  const missingColumns = [];
  const validationErrors = [];
  const rowErrors = {};
  const actionableIndexes = [];

  if (!headers.length) {
    validationErrors.push('Paste a spreadsheet to start a campaign.');
  }

  if (emailIndex < 0 && headers.length) {
    missingColumns.push('Email');
    validationErrors.push("Add an exact 'Email' column to send.");
  }

  tokens.forEach((token) => {
    if (!headerLookup.has(token) && !missingColumns.includes(token)) {
      missingColumns.push(token);
    }
  });

  const missingTemplateColumns = missingColumns.filter((column) => column !== 'Email');
  if (missingTemplateColumns.length) {
    validationErrors.push(`Missing template columns: ${missingTemplateColumns.map((column) => `'${column}'`).join(', ')}.`);
  }

  rows.forEach((row, index) => {
    const normalizedCells = Array.from({ length: headers.length }, (_, cellIndex) => String(row?.cells?.[cellIndex] ?? ''));
    if (!normalizedCells.length || normalizedCells.every((value) => !value.trim())) {
      return;
    }

    actionableIndexes.push(index);
    const issues = [];
    if (emailIndex >= 0) {
      const emailValue = String(normalizedCells[emailIndex] || '').trim();
      if (!emailValue || !isCampaignEmailValid(emailValue)) {
        issues.push(`Row ${index + 2} has an invalid 'Email'.`);
      }
    }
    tokens.forEach((token) => {
      const tokenIndex = headerLookup.get(token);
      if (tokenIndex == null) return;
      if (!String(normalizedCells[tokenIndex] || '').trim()) {
        issues.push(`Row ${index + 2} is missing '${token}'.`);
      }
    });
    if (issues.length) {
      rowErrors[row.id] = issues;
    }
  });

  if (headers.length && rows.length && !actionableIndexes.length) {
    validationErrors.push('Paste at least one non-empty recipient row.');
  }

  return {
    headers,
    rows,
    tokens,
    headerLookup,
    emailIndex,
    missingColumns,
    validationErrors,
    rowErrors,
    actionableIndexes,
    isValid: headers.length > 0
      && actionableIndexes.length > 0
      && missingColumns.length === 0
      && Object.keys(rowErrors).length === 0
  };
}

function applyCampaignValidation() {
  const snapshot = campaignValidationSnapshot();
  state.campaignMode.validationErrors = [...snapshot.validationErrors];
  state.campaignMode.missingColumns = [...snapshot.missingColumns];
  state.campaignMode.rowErrors = snapshot.rowErrors;
  if (!snapshot.actionableIndexes.includes(state.campaignMode.currentRowIndex)) {
    state.campaignMode.currentRowIndex = snapshot.actionableIndexes[0] ?? 0;
  }
  return snapshot;
}

function campaignRowPreviewValueMap(row, snapshot = campaignValidationSnapshot()) {
  const values = new Map();
  snapshot.headers.forEach((header, index) => {
    values.set(String(header || '').trim(), String(row?.cells?.[index] ?? ''));
  });
  return values;
}

function resolveCampaignRowPreview(rowIndex = state.campaignMode.currentRowIndex, snapshot = campaignValidationSnapshot()) {
  const row = snapshot.rows[rowIndex];
  if (!row) return null;
  const values = campaignRowPreviewValueMap(row, snapshot);
  const mergeTemplate = (template) => String(template || '').replace(/\[([^\]\r\n]+)\]/g, (_match, rawToken) => {
    const token = String(rawToken || '').trim();
    return values.has(token) ? String(values.get(token) || '') : '';
  });
  const recipient = snapshot.emailIndex >= 0 ? String(row.cells?.[snapshot.emailIndex] || '').trim() : '';
  return {
    row,
    rowIndex,
    displayRowNumber: rowIndex + 2,
    recipient,
    subject: mergeTemplate(state.campaignMode.subjectTemplate),
    body: mergeTemplate(state.campaignMode.bodyTemplate)
  };
}

function findNextCampaignRowIndex(startIndex = -1, statuses = ['pending']) {
  const allowed = new Set(statuses);
  const snapshot = campaignValidationSnapshot();
  for (let index = Math.max(0, startIndex + 1); index < snapshot.rows.length; index += 1) {
    if (!snapshot.actionableIndexes.includes(index)) continue;
    if (allowed.has(String(snapshot.rows[index]?.status || 'pending'))) {
      return index;
    }
  }
  return -1;
}

function campaignStatusCounts() {
  const counts = {
    total: 0,
    pending: 0,
    sending: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    stopped: 0
  };
  const snapshot = campaignValidationSnapshot();
  snapshot.actionableIndexes.forEach((index) => {
    const status = String(snapshot.rows[index]?.status || 'pending');
    counts.total += 1;
    if (Object.prototype.hasOwnProperty.call(counts, status)) {
      counts[status] += 1;
    } else {
      counts.pending += 1;
    }
  });
  return counts;
}

function campaignProgressPercent() {
  const counts = campaignStatusCounts();
  if (!counts.total) return 0;
  const completed = counts.sent + counts.failed + counts.skipped + counts.stopped;
  return Math.max(0, Math.min(100, Math.round((completed / counts.total) * 100)));
}

function campaignProgressText() {
  const counts = campaignStatusCounts();
  const current = resolveCampaignRowPreview();
  const completed = counts.sent + counts.failed + counts.skipped + counts.stopped;
  if (state.campaignMode.stopRequested && (state.campaignMode.blastRunning || state.campaignMode.activeRequestId)) {
    return 'Stopping campaign...';
  }
  if (state.campaignMode.blastRunning && state.campaignMode.activeRequestId) {
    return `Sending ${Math.min(counts.total, completed + 1)} of ${counts.total}...`;
  }
  if (state.campaignMode.blastRunning && state.campaignMode.delayUntilMs > Date.now()) {
    return `Waiting before the next send... ${completed} of ${counts.total} attempted.`;
  }
  if (state.campaignMode.completed) {
    return `Campaign finished. ${counts.sent} sent, ${counts.failed} failed, ${counts.skipped} skipped.`;
  }
  if (state.campaignMode.stopped) {
    return 'Campaign stopped.';
  }
  if (state.campaignMode.reviewStarted && current) {
    return `Reviewing row ${current.displayRowNumber} of ${counts.total || 0}.`;
  }
  return state.campaignMode.statusMessage || 'Paste a spreadsheet to begin.';
}

function campaignTableEditable() {
  return !state.campaignMode.blastRunning && !state.campaignMode.activeRequestId && !state.campaignMode.stopRequested;
}

function clearCampaignBlastDelay() {
  if (campaignBlastTimer) {
    window.clearTimeout(campaignBlastTimer);
    campaignBlastTimer = 0;
  }
  state.campaignMode.delayUntilMs = 0;
  if (campaignBlastDelayResolve) {
    const resolve = campaignBlastDelayResolve;
    campaignBlastDelayResolve = null;
    resolve(false);
  }
}

function replaceCampaignDataset(headers, rows) {
  clearCampaignBlastDelay();
  campaignBlastRunToken += 1;
  state.campaignMode.headers = [...(Array.isArray(headers) ? headers : [])].map((header) => String(header ?? ''));
  state.campaignMode.rows = (Array.isArray(rows) ? rows : []).map((cells) =>
    createCampaignRow(Array.from({ length: state.campaignMode.headers.length }, (_, index) => String(cells?.[index] ?? '')))
  );
  state.campaignMode.mode = 'review';
  state.campaignMode.reviewStarted = false;
  state.campaignMode.blastRunning = false;
  state.campaignMode.paused = false;
  state.campaignMode.stopped = false;
  state.campaignMode.stopRequested = false;
  state.campaignMode.completed = false;
  state.campaignMode.activeRequestId = '';
  state.campaignMode.currentRowIndex = 0;
  state.campaignMode.exitedToBackground = false;
  state.campaignMode.statusMessage = state.campaignMode.rows.length ? 'Spreadsheet loaded.' : 'No spreadsheet rows detected.';
  state.campaignMode.lastError = '';
  applyCampaignValidation();
}

function buildCampaignDatasetFromText(rawText) {
  const lines = String(rawText || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .filter((line) => line.length > 0);
  if (!lines.length) {
    return { headers: [], rows: [] };
  }
  const rows = lines.map((line) => line.split('\t').map((cell) => String(cell ?? '')));
  const width = rows.reduce((maxWidth, row) => Math.max(maxWidth, row.length), 0);
  const headers = Array.from({ length: width }, (_, index) => String(rows[0]?.[index] ?? '').trim());
  const bodyRows = rows
    .slice(1)
    .map((row) => Array.from({ length: width }, (_, index) => String(row?.[index] ?? '')))
    .filter((row) => row.some((cell) => String(cell || '').trim()));
  return {
    headers,
    rows: bodyRows
  };
}

function openCampaignModeFromCompose() {
  if (!CAMPAIGN_MODE_ENABLED) return;
  if (!state.connected) return;
  const draft = syncComposeOverlayDraftFromDom();
  const existing = state.campaignMode;
  const hasExistingDraft = Boolean(existing.headers.length || existing.rows.length || existing.subjectTemplate || existing.bodyTemplate);
  state.composeOverlay = {
    ...state.composeOverlay,
    open: false,
    sendError: '',
    sendStatus: ''
  };
  if (!hasExistingDraft) {
    state.campaignMode = {
      ...defaultCampaignModeState(),
      active: true,
      subjectTemplate: String(draft.subject || ''),
      bodyTemplate: String(draft.body || '')
    };
  } else {
    state.campaignMode.active = true;
    state.campaignMode.exitedToBackground = false;
  }
  applyCampaignValidation();
  renderComposeOverlay();
  renderCampaignMode({ syncInputs: true, fullTable: true, focusTemplate: !hasExistingDraft });
  renderCampaignBanner();
}

function reopenCampaignMode() {
  if (!CAMPAIGN_MODE_ENABLED) return;
  state.campaignMode.active = true;
  state.campaignMode.exitedToBackground = false;
  renderCampaignMode({ syncInputs: true, fullTable: true });
  renderCampaignBanner();
}

function closeCampaignMode(options = {}) {
  if (!CAMPAIGN_MODE_ENABLED) {
    state.campaignMode = defaultCampaignModeState();
    renderCampaignMode({ fullTable: true });
    renderCampaignBanner();
    return;
  }
  const backgroundOnly = Boolean(options.background) || state.campaignMode.blastRunning || Boolean(state.campaignMode.activeRequestId);
  state.campaignMode.active = false;
  state.campaignMode.exitedToBackground = backgroundOnly && (state.campaignMode.blastRunning || Boolean(state.campaignMode.activeRequestId));
  renderCampaignMode({ fullTable: true });
  renderCampaignBanner();
}

function updateCampaignHeader(index, value, focusState = {}) {
  if (!campaignTableEditable()) return;
  state.campaignMode.headers[index] = String(value ?? '');
  applyCampaignValidation();
  renderCampaignMode({
    restoreFocus: {
      elementId: `gmailUnifiedCampaignHeaderInput-${index}`,
      selectionStart: focusState.selectionStart ?? null,
      selectionEnd: focusState.selectionEnd ?? focusState.selectionStart ?? null
    }
  });
}

function updateCampaignCell(rowId, cellIndex, value, focusState = {}) {
  if (!campaignTableEditable()) return;
  const target = state.campaignMode.rows.find((row) => row.id === rowId);
  if (!target) return;
  target.cells[cellIndex] = String(value ?? '');
  applyCampaignValidation();
  renderCampaignMode({
    restoreFocus: {
      elementId: `gmailUnifiedCampaignCellInput-${rowId}-${cellIndex}`,
      selectionStart: focusState.selectionStart ?? null,
      selectionEnd: focusState.selectionEnd ?? focusState.selectionStart ?? null
    }
  });
}

function addCampaignRow() {
  if (!campaignTableEditable() || !state.campaignMode.headers.length) return;
  state.campaignMode.rows.push(createCampaignRow(Array.from({ length: state.campaignMode.headers.length }, () => '')));
  applyCampaignValidation();
  renderCampaignMode({ fullTable: true });
}

function deleteCampaignRow(rowId) {
  if (!campaignTableEditable()) return;
  state.campaignMode.rows = state.campaignMode.rows.filter((row) => row.id !== rowId);
  applyCampaignValidation();
  renderCampaignMode({ fullTable: true });
}

function campaignRunActive() {
  return Boolean(state.campaignMode.blastRunning || state.campaignMode.activeRequestId || state.campaignMode.delayUntilMs > Date.now());
}

function campaignBannerVisible() {
  return Boolean(CAMPAIGN_MODE_ENABLED && state.campaignMode.exitedToBackground && (campaignRunActive() || state.campaignMode.completed || state.campaignMode.stopped));
}

function campaignStatusLabel(status) {
  switch (String(status || 'pending')) {
    case 'sending':
      return 'Sending';
    case 'sent':
      return 'Sent';
    case 'failed':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'stopped':
      return 'Stopped';
    default:
      return 'Pending';
  }
}

function campaignFocusById(elementId, selectionStart = null, selectionEnd = null) {
  if (!elementId) return;
  window.requestAnimationFrame(() => {
    const element = document.getElementById(elementId);
    if (!(element instanceof HTMLElement)) return;
    element.focus();
    if ('selectionStart' in element && selectionStart != null) {
      try {
        element.selectionStart = selectionStart;
        element.selectionEnd = selectionEnd ?? selectionStart;
      } catch {}
    }
  });
}

function renderCampaignValidation(snapshot) {
  const host = document.getElementById('gmailUnifiedCampaignValidation');
  if (!host) return;

  const info = [];
  if (snapshot.tokens.length) {
    info.push(`Variables: ${snapshot.tokens.map((token) => `[${token}]`).join(', ')}`);
  }
  if (!snapshot.headers.length) {
    info.push('Paste rows from Sheets or Excel into the data pane to build your mail merge table.');
  }

  const issueMarkup = [
    ...snapshot.validationErrors.map((message) => `<div class="gmail-unified-campaign-validation-item is-error">${escapeHtml(message)}</div>`),
    ...Object.values(snapshot.rowErrors)
      .flat()
      .slice(0, 8)
      .map((message) => `<div class="gmail-unified-campaign-validation-item is-error">${escapeHtml(message)}</div>`)
  ];

  const infoMarkup = info.map((message) => `<div class="gmail-unified-campaign-validation-item is-info">${escapeHtml(message)}</div>`);
  if (!issueMarkup.length && snapshot.headers.length) {
    infoMarkup.unshift('<div class="gmail-unified-campaign-validation-item is-success">Validation clean. Review or blast can start.</div>');
  }

  host.innerHTML = `
    <div class="gmail-unified-campaign-validation-grid">
      ${issueMarkup.join('')}
      ${infoMarkup.join('')}
    </div>
  `;
}

function renderCampaignTable(snapshot) {
  const host = document.getElementById('gmailUnifiedCampaignTableWrap');
  const pasteZone = document.getElementById('gmailUnifiedCampaignPasteZone');
  if (!host || !pasteZone) return;

  const editable = campaignTableEditable();
  pasteZone.classList.toggle('has-data', snapshot.headers.length > 0);
  pasteZone.innerHTML = snapshot.headers.length
    ? `
      <div class="gmail-unified-campaign-paste-copy">
        <strong>Spreadsheet loaded.</strong>
        <span>Paste again here to replace the table, or keep editing cells inline.</span>
      </div>
    `
    : `
      <div class="gmail-unified-campaign-paste-copy">
        <strong>Paste your spreadsheet here</strong>
        <span>Row 1 becomes headers. Use an exact <code>Email</code> column for recipients.</span>
      </div>
    `;

  if (!snapshot.headers.length) {
    host.innerHTML = `
      <div class="gmail-unified-campaign-empty-state">
        <h3>Waiting for recipient data</h3>
        <p>Paste directly from Google Sheets or Excel on the right side. Mailita will turn it into an editable table instantly.</p>
      </div>
    `;
    return;
  }

  const headerMarkup = snapshot.headers.map((header, index) => `
    <th>
      <input
        id="gmailUnifiedCampaignHeaderInput-${index}"
        class="gmail-unified-campaign-table-input gmail-unified-campaign-table-header-input"
        type="text"
        value="${escapeHtml(header)}"
        data-campaign-header-index="${index}"
        ${editable ? '' : 'disabled'}
      />
    </th>
  `).join('');

  const rowsMarkup = state.campaignMode.rows.map((row, rowIndex) => {
    const issues = snapshot.rowErrors[row.id] || [];
    const isBlank = isCampaignRowBlank(row, snapshot.headers.length);
    const status = String(row.status || 'pending');
    const cellsMarkup = Array.from({ length: snapshot.headers.length }, (_, cellIndex) => `
      <td>
        <input
          id="gmailUnifiedCampaignCellInput-${row.id}-${cellIndex}"
          class="gmail-unified-campaign-table-input"
          type="text"
          value="${escapeHtml(String(row.cells?.[cellIndex] ?? ''))}"
          data-campaign-row-id="${escapeHtml(row.id)}"
          data-campaign-cell-index="${cellIndex}"
          ${editable ? '' : 'disabled'}
        />
      </td>
    `).join('');

    return `
      <tr class="gmail-unified-campaign-table-row ${issues.length ? 'has-error' : ''} ${isBlank ? 'is-blank' : ''}" data-status="${escapeHtml(status)}">
        <td class="gmail-unified-campaign-table-row-number">${rowIndex + 2}</td>
        ${cellsMarkup}
        <td class="gmail-unified-campaign-table-status">
          <span class="gmail-unified-campaign-status-pill is-${escapeHtml(status)}">${escapeHtml(campaignStatusLabel(status))}</span>
          ${issues.length ? `<div class="gmail-unified-campaign-row-errors">${issues.map((message) => `<div>${escapeHtml(message)}</div>`).join('')}</div>` : ''}
          ${row.sendError && !issues.length ? `<div class="gmail-unified-campaign-row-errors"><div>${escapeHtml(row.sendError)}</div></div>` : ''}
        </td>
        <td class="gmail-unified-campaign-table-actions">
          <button class="gmail-unified-campaign-delete-row" type="button" data-campaign-delete-row="${escapeHtml(row.id)}" ${editable ? '' : 'disabled'}>Delete</button>
        </td>
      </tr>
    `;
  }).join('');

  host.innerHTML = `
    <div class="gmail-unified-campaign-table-scroller">
      <table class="gmail-unified-campaign-table">
        <thead>
          <tr>
            <th class="gmail-unified-campaign-table-row-number">#</th>
            ${headerMarkup}
            <th class="gmail-unified-campaign-table-status">Status</th>
            <th class="gmail-unified-campaign-table-actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          ${rowsMarkup || `
            <tr>
              <td colspan="${snapshot.headers.length + 3}" class="gmail-unified-campaign-table-empty">Add a row to start sending.</td>
            </tr>
          `}
        </tbody>
      </table>
    </div>
    <div class="gmail-unified-campaign-table-footer">
      <button id="gmailUnifiedCampaignAddRow" class="gmail-unified-secondary-btn gmail-unified-campaign-add-row" type="button" ${editable ? '' : 'disabled'}>Add Row</button>
      <div class="gmail-unified-campaign-table-summary">${escapeHtml(`${snapshot.actionableIndexes.length} actionable row${snapshot.actionableIndexes.length === 1 ? '' : 's'}`)}</div>
    </div>
  `;
}

function renderCampaignPreview(snapshot) {
  const host = document.getElementById('gmailUnifiedCampaignPreview');
  if (!host) return;

  const preview = resolveCampaignRowPreview(state.campaignMode.currentRowIndex, snapshot)
    || resolveCampaignRowPreview(snapshot.actionableIndexes[0] ?? -1, snapshot);
  const counts = campaignStatusCounts();
  const percent = campaignProgressPercent();
  const progressText = campaignProgressText();

  if (state.campaignMode.mode === 'review' && state.campaignMode.reviewStarted && preview) {
    host.innerHTML = `
      <div class="gmail-unified-campaign-preview-card">
        <div class="gmail-unified-campaign-preview-head">
          <div>
            <div class="gmail-unified-install-kicker">Review Mode</div>
            <h3>Row ${preview.displayRowNumber}</h3>
          </div>
          <div class="gmail-unified-campaign-preview-recipient">${escapeHtml(preview.recipient)}</div>
        </div>
        <div class="gmail-unified-campaign-preview-subject">${escapeHtml(preview.subject || '(no subject)')}</div>
        <pre class="gmail-unified-campaign-preview-body">${escapeHtml(preview.body || '(empty message)')}</pre>
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="gmail-unified-campaign-progress-card">
      <div class="gmail-unified-campaign-progress-head">
        <div>
          <div class="gmail-unified-install-kicker">${state.campaignMode.mode === 'blast' ? 'Blast Mode' : 'Campaign Mode'}</div>
          <h3>${escapeHtml(progressText)}</h3>
        </div>
        <div class="gmail-unified-campaign-progress-meta">${escapeHtml(`${counts.sent} sent · ${counts.failed} failed · ${counts.skipped} skipped`)}</div>
      </div>
      <div class="gmail-unified-campaign-progress-bar">
        <span style="width:${percent}%"></span>
      </div>
      <div class="gmail-unified-campaign-progress-foot">${escapeHtml(`${percent}% complete`)}</div>
    </div>
  `;
}

function renderCampaignActions(snapshot) {
  const host = document.getElementById('gmailUnifiedCampaignActions');
  if (!host) return;

  const preview = resolveCampaignRowPreview(state.campaignMode.currentRowIndex, snapshot)
    || resolveCampaignRowPreview(snapshot.actionableIndexes[0] ?? -1, snapshot);
  const controlsDisabled = !snapshot.isValid || Boolean(state.campaignMode.activeRequestId) || state.campaignMode.stopRequested;
  const stopVisible = campaignRunActive();

  if (state.campaignMode.mode === 'review' && state.campaignMode.reviewStarted && preview) {
    host.innerHTML = `
      <div class="gmail-unified-campaign-actions-row">
        <button id="gmailUnifiedCampaignReviewSend" class="gmail-unified-primary-btn gmail-unified-campaign-send-next" type="button" ${controlsDisabled ? 'disabled' : ''}>Send &amp; Next</button>
        <button id="gmailUnifiedCampaignReviewSkip" class="gmail-unified-secondary-btn gmail-unified-campaign-skip" type="button" ${controlsDisabled ? 'disabled' : ''}>Skip</button>
      </div>
    `;
    return;
  }

  host.innerHTML = `
    <div class="gmail-unified-campaign-actions-row">
      <button id="gmailUnifiedCampaignStartReview" class="gmail-unified-secondary-btn" type="button" ${controlsDisabled ? 'disabled' : ''}>Start Review</button>
      <button id="gmailUnifiedCampaignStartBlast" class="gmail-unified-primary-btn" type="button" ${controlsDisabled ? 'disabled' : ''}>Start Blast</button>
      ${stopVisible ? '<button id="gmailUnifiedCampaignBlastStop" class="gmail-unified-danger-btn gmail-unified-campaign-stop" type="button">STOP</button>' : ''}
    </div>
  `;
}

function renderCampaignMode(options = {}) {
  const overlay = document.getElementById('gmailUnifiedCampaignOverlay');
  const subjectInput = document.getElementById('gmailUnifiedCampaignSubject');
  const bodyInput = document.getElementById('gmailUnifiedCampaignBody');
  const status = document.getElementById('gmailUnifiedCampaignStatus');
  const reviewButton = document.getElementById('gmailUnifiedCampaignModeReview');
  const blastButton = document.getElementById('gmailUnifiedCampaignModeBlast');
  if (!CAMPAIGN_MODE_ENABLED) {
    if (overlay) {
      overlay.hidden = true;
      overlay.style.display = 'none';
    }
    return;
  }
  if (!overlay || !subjectInput || !bodyInput || !status || !reviewButton || !blastButton) return;

  overlay.hidden = !state.campaignMode.active;
  overlay.style.display = state.campaignMode.active ? 'grid' : 'none';
  if (!state.campaignMode.active) return;

  const snapshot = applyCampaignValidation();
  overlay.dataset.mode = state.campaignMode.mode;
  overlay.dataset.running = campaignRunActive() ? 'true' : 'false';
  status.textContent = campaignProgressText();
  status.dataset.state = snapshot.isValid ? 'ready' : 'error';
  reviewButton.classList.toggle('is-active', state.campaignMode.mode === 'review');
  blastButton.classList.toggle('is-active', state.campaignMode.mode === 'blast');
  reviewButton.disabled = campaignRunActive();
  blastButton.disabled = campaignRunActive();

  if (options.syncInputs || subjectInput.value !== state.campaignMode.subjectTemplate) {
    subjectInput.value = state.campaignMode.subjectTemplate;
  }
  if (options.syncInputs || bodyInput.value !== state.campaignMode.bodyTemplate) {
    bodyInput.value = state.campaignMode.bodyTemplate;
  }

  renderCampaignValidation(snapshot);
  renderCampaignTable(snapshot);
  renderCampaignPreview(snapshot);
  renderCampaignActions(snapshot);

  if (options.focusTemplate) {
    campaignFocusById('gmailUnifiedCampaignSubject');
  }
  if (options.restoreFocus?.elementId) {
    campaignFocusById(
      options.restoreFocus.elementId,
      options.restoreFocus.selectionStart ?? null,
      options.restoreFocus.selectionEnd ?? options.restoreFocus.selectionStart ?? null
    );
  }
}

function renderCampaignBanner() {
  const banner = document.getElementById('gmailUnifiedCampaignBanner');
  if (!banner) return;
  if (!CAMPAIGN_MODE_ENABLED) {
    banner.hidden = true;
    banner.style.display = 'none';
    return;
  }

  const visible = campaignBannerVisible();
  banner.hidden = !visible;
  banner.style.display = visible ? 'flex' : 'none';
  if (!visible) return;

  const percent = campaignProgressPercent();
  banner.innerHTML = `
    <div class="gmail-unified-campaign-banner-copy">
      <div class="gmail-unified-install-kicker">Campaign running</div>
      <div class="gmail-unified-campaign-banner-text">${escapeHtml(campaignProgressText())}</div>
      <div class="gmail-unified-campaign-banner-progress">
        <span style="width:${percent}%"></span>
      </div>
    </div>
    <div class="gmail-unified-campaign-banner-actions">
      <button id="gmailUnifiedCampaignBannerReopen" class="gmail-unified-secondary-btn" type="button">Reopen Campaign</button>
      <button id="gmailUnifiedCampaignBannerStop" class="gmail-unified-danger-btn gmail-unified-campaign-stop" type="button" ${campaignRunActive() ? '' : 'disabled'}>STOP</button>
    </div>
  `;
}

function waitForCampaignDelay(runToken, delayMs = state.campaignMode.delayMs) {
  clearCampaignBlastDelay();
  if (!delayMs) return Promise.resolve(true);
  state.campaignMode.delayUntilMs = Date.now() + delayMs;
  renderCampaignMode();
  renderCampaignBanner();
  return new Promise((resolve) => {
    campaignBlastDelayResolve = resolve;
    campaignBlastTimer = window.setTimeout(() => {
      campaignBlastTimer = 0;
      campaignBlastDelayResolve = null;
      state.campaignMode.delayUntilMs = 0;
      const shouldContinue = runToken === campaignBlastRunToken && !state.campaignMode.stopRequested;
      renderCampaignMode();
      renderCampaignBanner();
      resolve(shouldContinue);
    }, delayMs);
  });
}

async function sendCampaignRow(rowIndex, options = {}) {
  const snapshot = applyCampaignValidation();
  const preview = resolveCampaignRowPreview(rowIndex, snapshot);
  if (!preview) {
    return {
      success: false,
      code: 'CAMPAIGN_ROW_INVALID',
      error: 'This row is not ready to send.'
    };
  }

  const row = state.campaignMode.rows[rowIndex];
  if (!row) {
    return {
      success: false,
      code: 'CAMPAIGN_ROW_MISSING',
      error: 'This row no longer exists.'
    };
  }

  const requestId = `campaign-send-${createDiagnosticId()}`;
  row.status = 'sending';
  row.sendError = '';
  state.campaignMode.currentRowIndex = rowIndex;
  state.campaignMode.activeRequestId = requestId;
  state.campaignMode.lastError = '';
  state.campaignMode.statusMessage = `Sending row ${preview.displayRowNumber}...`;
  renderCampaignMode();
  renderCampaignBanner();

  let response;
  try {
    response = await sendWorker('SEND_MESSAGE', {
      requestId,
      to: [{
        email: preview.recipient,
        name: ''
      }],
      subject: preview.subject,
      bodyText: preview.body
    });
  } catch (error) {
    response = {
      success: false,
      code: error?.code || 'SEND_FAILED',
      error: error?.message || String(error)
    };
  }

  if (state.campaignMode.activeRequestId === requestId) {
    state.campaignMode.activeRequestId = '';
  }

  const currentRow = state.campaignMode.rows[rowIndex];
  if (!currentRow) {
    renderCampaignMode();
    renderCampaignBanner();
    return response;
  }

  if (response?.success) {
    currentRow.status = 'sent';
    currentRow.sendError = '';
    currentRow.sentAt = new Date().toISOString();
    state.campaignMode.statusMessage = `Sent row ${preview.displayRowNumber}.`;
    sendWorker('SYNC_MESSAGES', {
      trackActivity: false
    }).catch(() => {});
  } else if (response?.code === 'REQUEST_ABORTED' || state.campaignMode.stopRequested) {
    currentRow.status = 'stopped';
    currentRow.sendError = 'Stopped by user.';
    state.campaignMode.statusMessage = 'Campaign stopped.';
  } else {
    currentRow.status = 'failed';
    currentRow.sendError = failureMessageForResponse(response, 'Send failed.');
    state.campaignMode.lastError = currentRow.sendError;
    state.campaignMode.statusMessage = currentRow.sendError;
  }

  renderCampaignMode();
  renderCampaignBanner();
  return response;
}

function finalizeCampaignReviewCompletion(message) {
  state.campaignMode.reviewStarted = false;
  state.campaignMode.completed = true;
  state.campaignMode.stopped = false;
  state.campaignMode.statusMessage = message;
  renderCampaignMode();
  renderCampaignBanner();
}

async function startCampaignReview() {
  const snapshot = applyCampaignValidation();
  state.campaignMode.mode = 'review';
  state.campaignMode.completed = false;
  state.campaignMode.stopped = false;
  state.campaignMode.stopRequested = false;
  state.campaignMode.exitedToBackground = false;
  if (!snapshot.isValid) {
    state.campaignMode.reviewStarted = false;
    state.campaignMode.statusMessage = 'Fix the validation issues before starting review.';
    renderCampaignMode();
    renderCampaignBanner();
    return;
  }

  const nextIndex = findNextCampaignRowIndex(-1, ['pending', 'failed']);
  if (nextIndex < 0) {
    finalizeCampaignReviewCompletion('Nothing is left to review.');
    return;
  }

  state.campaignMode.reviewStarted = true;
  state.campaignMode.currentRowIndex = nextIndex;
  state.campaignMode.statusMessage = `Reviewing row ${nextIndex + 2}.`;
  renderCampaignMode();
  renderCampaignBanner();
}

function skipCampaignReviewRow() {
  if (!state.campaignMode.reviewStarted) return;
  const previousIndex = state.campaignMode.currentRowIndex;
  const row = state.campaignMode.rows[state.campaignMode.currentRowIndex];
  if (!row) return;
  row.status = 'skipped';
  row.sendError = '';
  const nextIndex = findNextCampaignRowIndex(state.campaignMode.currentRowIndex, ['pending', 'failed']);
  if (nextIndex < 0) {
    finalizeCampaignReviewCompletion('Campaign review finished.');
    return;
  }
  state.campaignMode.currentRowIndex = nextIndex;
  state.campaignMode.statusMessage = `Skipped row ${previousIndex + 2}.`;
  renderCampaignMode();
  renderCampaignBanner();
}

async function sendCurrentCampaignReviewRow() {
  if (!state.campaignMode.reviewStarted || state.campaignMode.activeRequestId) return;
  const rowIndex = state.campaignMode.currentRowIndex;
  const response = await sendCampaignRow(rowIndex, {
    mode: 'review'
  });
  if (!response?.success) {
    renderCampaignMode();
    renderCampaignBanner();
    return;
  }
  const nextIndex = findNextCampaignRowIndex(rowIndex, ['pending', 'failed']);
  if (nextIndex < 0) {
    finalizeCampaignReviewCompletion('Campaign review finished.');
    return;
  }
  state.campaignMode.currentRowIndex = nextIndex;
  state.campaignMode.reviewStarted = true;
  state.campaignMode.statusMessage = `Ready for row ${nextIndex + 2}.`;
  renderCampaignMode();
  renderCampaignBanner();
}

async function stopCampaignBlast() {
  if (!campaignRunActive() && !state.campaignMode.blastRunning) {
    state.campaignMode.stopped = true;
    state.campaignMode.statusMessage = 'Campaign stopped.';
    renderCampaignMode();
    renderCampaignBanner();
    return;
  }

  state.campaignMode.stopRequested = true;
  state.campaignMode.statusMessage = 'Stopping campaign...';
  renderCampaignMode();
  renderCampaignBanner();

  clearCampaignBlastDelay();
  campaignBlastRunToken += 1;

  const requestId = String(state.campaignMode.activeRequestId || '').trim();
  if (requestId) {
    try {
      await sendWorker('ABORT_SEND_MESSAGE', {
        requestId
      });
    } catch {}
  }

  const sendingRow = state.campaignMode.rows.find((row) => row.status === 'sending');
  if (sendingRow) {
    sendingRow.status = 'stopped';
    sendingRow.sendError = 'Stopped by user.';
  }

  state.campaignMode.activeRequestId = '';
  state.campaignMode.blastRunning = false;
  state.campaignMode.paused = false;
  state.campaignMode.stopRequested = false;
  state.campaignMode.stopped = true;
  state.campaignMode.completed = false;
  state.campaignMode.exitedToBackground = false;
  state.campaignMode.statusMessage = 'Campaign stopped.';
  renderCampaignMode();
  renderCampaignBanner();
}

async function startCampaignBlast() {
  if (state.campaignMode.blastRunning) return;
  const snapshot = applyCampaignValidation();
  state.campaignMode.mode = 'blast';
  state.campaignMode.reviewStarted = false;
  state.campaignMode.completed = false;
  state.campaignMode.stopped = false;
  state.campaignMode.stopRequested = false;
  state.campaignMode.exitedToBackground = false;
  if (!snapshot.isValid) {
    state.campaignMode.statusMessage = 'Fix the validation issues before starting blast.';
    renderCampaignMode();
    renderCampaignBanner();
    return;
  }

  const firstPendingIndex = findNextCampaignRowIndex(-1, ['pending']);
  if (firstPendingIndex < 0) {
    state.campaignMode.completed = true;
    state.campaignMode.statusMessage = 'No pending rows remain to blast.';
    renderCampaignMode();
    renderCampaignBanner();
    return;
  }

  const runToken = campaignBlastRunToken + 1;
  campaignBlastRunToken = runToken;
  state.campaignMode.blastRunning = true;
  state.campaignMode.currentRowIndex = firstPendingIndex;
  state.campaignMode.statusMessage = 'Campaign started.';
  renderCampaignMode();
  renderCampaignBanner();

  let lastIndex = -1;
  while (runToken === campaignBlastRunToken) {
    if (state.campaignMode.stopRequested) {
      break;
    }

    const nextIndex = findNextCampaignRowIndex(lastIndex, ['pending']);
    if (nextIndex < 0) {
      state.campaignMode.blastRunning = false;
      state.campaignMode.completed = true;
      state.campaignMode.statusMessage = 'Campaign finished.';
      renderCampaignMode();
      renderCampaignBanner();
      return;
    }

    state.campaignMode.currentRowIndex = nextIndex;
    renderCampaignMode();
    renderCampaignBanner();

    await sendCampaignRow(nextIndex, {
      mode: 'blast'
    });
    lastIndex = nextIndex;

    if (runToken !== campaignBlastRunToken || state.campaignMode.stopRequested) {
      return;
    }

    const pendingAfter = findNextCampaignRowIndex(lastIndex, ['pending']);
    if (pendingAfter < 0) {
      state.campaignMode.blastRunning = false;
      state.campaignMode.completed = true;
      state.campaignMode.statusMessage = 'Campaign finished.';
      renderCampaignMode();
      renderCampaignBanner();
      return;
    }

    const shouldContinue = await waitForCampaignDelay(runToken, state.campaignMode.delayMs);
    if (!shouldContinue || runToken !== campaignBlastRunToken || state.campaignMode.stopRequested) {
      return;
    }
  }
}

function handleGlobalSurfaceEscape(event) {
  if (event.key !== 'Escape') return;

  if (state.composeOverlay.open) {
    event.preventDefault();
    closeComposeOverlay();
    return;
  }

  if (state.settingsOpen) {
    event.preventDefault();
    state.settingsOpen = false;
    applyGmailLayoutMode();
    return;
  }

  if (state.guideReviewOpen) {
    event.preventDefault();
    state.guideReviewOpen = false;
    applyGmailLayoutMode();
    return;
  }

  if (CAMPAIGN_MODE_ENABLED && state.campaignMode.active) {
    event.preventDefault();
    closeCampaignMode({
      background: campaignRunActive()
    });
  }
}

function setComposerMode(mode, group) {
  const targetGroup = group || findSelectedGroup();
  const resolved = mode === 'reply_all' ? 'reply_all' : 'reply';
  state.composer.mode = resolved;
  if (targetGroup) {
    renderThreadDetail(targetGroup);
  }
}

function replyAllAvailable(message) {
  const self = accountEmailLower();
  const recipients = new Set();
  if (message?.from?.email && String(message.from.email).trim().toLowerCase() !== self) {
    recipients.add(String(message.from.email).trim().toLowerCase());
  }
  (Array.isArray(message?.to) ? message.to : []).forEach((entry) => {
    const email = String(entry?.email || '').trim().toLowerCase();
    if (email && email !== self) recipients.add(email);
  });
  return recipients.size > 1;
}

function oldestToNewestMessages(group) {
  return [...(Array.isArray(group?.messages) ? group.messages : [])]
    .sort((a, b) => messageReceivedAtMs(a) - messageReceivedAtMs(b));
}

function selectedComposerMessage(group) {
  const messages = oldestToNewestMessages(group);
  if (!messages.length) return null;
  const exact = messages.find((message) => message.id === state.composer.targetMessageId);
  return exact || messages[messages.length - 1];
}

function normalizedReplySubject(subject) {
  const text = String(subject || '').trim();
  if (!text) return 'Re:';
  return /^re:/i.test(text) ? text : `Re: ${text}`;
}

function uniqueRecipientEntries(entries) {
  const self = accountEmailLower();
  const map = new Map();
  (Array.isArray(entries) ? entries : []).forEach((entry) => {
    const email = String(entry?.email || '').trim();
    const key = email.toLowerCase();
    if (!email || key === self || map.has(key)) return;
    map.set(key, {
      email,
      name: String(entry?.name || '').trim()
    });
  });
  return [...map.values()];
}

function replyEntryForMessage(message) {
  if (message?.replyTo?.email) {
    return {
      email: String(message.replyTo.email).trim(),
      name: String(message.replyTo.name || '').trim()
    };
  }

  if (message?.from?.email) {
    return {
      email: String(message.from.email).trim(),
      name: String(message.from.name || '').trim()
    };
  }

  return null;
}

function composeRecipients(group, targetMessage, mode) {
  const fallbackEmail = getGroupContactEmail(group);
  if (!targetMessage) {
    return fallbackEmail ? [{ email: fallbackEmail, name: '' }] : [];
  }

  if (mode !== 'reply_all') {
    if (targetMessage.isOutgoing) {
      const to = uniqueRecipientEntries([...(targetMessage.to || []), ...(targetMessage.cc || [])]);
      if (to.length) return [to[0]];
    } else {
      const replyEntry = replyEntryForMessage(targetMessage);
      if (replyEntry?.email) return uniqueRecipientEntries([replyEntry]);
    }

    return fallbackEmail ? [{ email: fallbackEmail, name: '' }] : [];
  }

  const entries = [];
  const replyEntry = replyEntryForMessage(targetMessage);
  if (!targetMessage.isOutgoing && replyEntry?.email) {
    entries.push(replyEntry);
  }
  entries.push(...(Array.isArray(targetMessage.to) ? targetMessage.to : []));
  entries.push(...(Array.isArray(targetMessage.cc) ? targetMessage.cc : []));
  const deduped = uniqueRecipientEntries(entries);
  if (deduped.length) return deduped;
  return fallbackEmail ? [{ email: fallbackEmail, name: '' }] : [];
}

function buildReplyHeaders(targetMessage) {
  const inReplyTo = String(targetMessage?.rfcMessageId || targetMessage?.inReplyTo || '').trim();
  const references = [String(targetMessage?.references || '').trim(), inReplyTo]
    .filter(Boolean)
    .join(' ')
    .trim();

  return {
    threadId: String(targetMessage?.threadId || '').trim(),
    inReplyTo,
    references
  };
}

const COMPOSE_BUTTON_SELECTORS = [
  'div[role="button"][gh="cm"]',
  'div[role="button"][aria-label="Compose"]',
  'div[role="button"][aria-label*="Compose"]'
];

const COMPOSE_DIALOG_SELECTORS = ['div[role="dialog"]'];
const TO_FIELD_SELECTORS = [
  'input[aria-label^="To"]',
  'textarea[name="to"]',
  'input[name="to"]'
];
const SUBJECT_FIELD_SELECTORS = [
  'input[name="subjectbox"]',
  'input[aria-label="Subject"]'
];
const BODY_FIELD_SELECTORS = [
  'div[aria-label="Message Body"][contenteditable="true"]',
  'div[contenteditable="true"][aria-label="Message Body"]',
  'div[g_editable="true"][role="textbox"]',
  'div[role="textbox"][contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]'
];
const STRUCTURAL_SEND_BUTTON_SELECTORS = [
  '.IZ .Up div > div[role="button"]:not(.Uo):not([aria-haspopup=true])',
  '.IZ .Up div > button[role="button"]:not([aria-haspopup=true])',
  '.IZ .Up [role="button"]:not(.Uo):not([aria-haspopup=true])'
];
const LEGACY_SEND_BUTTON_SELECTORS = [
  'div[role="button"][data-tooltip^="Send"]',
  'div[role="button"][aria-label^="Send"]',
  'button[aria-label^="Send"]',
  '[data-tooltip="Send"]',
  '[aria-label="Send"]'
];

function sleep(ms) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function isVisible(node) {
  if (!(node instanceof HTMLElement)) return false;
  if (!node.isConnected) return false;
  const style = window.getComputedStyle(node);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  if (node.offsetParent !== null) return true;
  const rect = node.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function selectFirst(root, selectors) {
  for (const selector of selectors) {
    const node = root.querySelector(selector);
    if (node) return node;
  }
  return null;
}

function dispatchMouseSequence(element) {
  if (!(element instanceof HTMLElement)) return false;
  const rect = element.getBoundingClientRect();
  const clientX = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2 || 1));
  const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2 || 1));
  const base = { bubbles: true, cancelable: true, composed: true, clientX, clientY };
  element.dispatchEvent(new MouseEvent('mousedown', base));
  element.dispatchEvent(new MouseEvent('mouseup', base));
  element.dispatchEvent(new MouseEvent('click', base));
  return true;
}

async function withNativeGmailSurface(task) {
  const sidebar = document.getElementById('gmailUnifiedSidebar');
  const previousHidden = sidebar?.hidden || false;
  const hadFullscreen = document.body.classList.contains('gmail-unified-fullscreen');

  if (sidebar) {
    sidebar.hidden = true;
  }
  if (hadFullscreen) {
    document.body.classList.remove('gmail-unified-fullscreen');
  }

  try {
    await sleep(120);
    return await task();
  } finally {
    if (hadFullscreen) {
      document.body.classList.add('gmail-unified-fullscreen');
    }
    if (sidebar) {
      sidebar.hidden = previousHidden;
    }
  }
}

function findComposeDialog() {
  for (const selector of COMPOSE_DIALOG_SELECTORS) {
    const dialogs = Array.from(document.querySelectorAll(selector));
    for (const dialog of dialogs) {
      if (dialog instanceof HTMLElement && isVisible(dialog)) {
        const bodyField = selectFirst(dialog, BODY_FIELD_SELECTORS);
        if (bodyField) return dialog;
      }
    }
  }
  return null;
}

function waitForComposeDialog(timeoutMs = 10000) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tryResolve = () => {
      const dialog = findComposeDialog();
      if (dialog) {
        cleanup();
        resolve(dialog);
        return true;
      }
      return false;
    };
    const interval = window.setInterval(() => {
      if (tryResolve()) return;
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        resolve(null);
      }
    }, 200);
    const observer = new MutationObserver(() => {
      if (tryResolve()) return;
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        resolve(null);
      }
    });
    const cleanup = () => {
      window.clearInterval(interval);
      observer.disconnect();
    };
    observer.observe(document.body, { childList: true, subtree: true });
    tryResolve();
  });
}

function setNativeFieldValue(element, value) {
  if (!element) return false;
  const isTextArea = element instanceof HTMLTextAreaElement;
  const proto = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
  if (!descriptor || typeof descriptor.set !== 'function') return false;
  descriptor.set.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function setContentEditableValue(element, value) {
  if (!(element instanceof HTMLElement)) return false;
  element.focus();
  element.innerHTML = '';
  const lines = String(value || '').split('\n');
  lines.forEach((line, index) => {
    if (index > 0) element.appendChild(document.createElement('div'));
    if (index === 0) {
      element.textContent = line;
    } else {
      const block = element.lastChild;
      if (block instanceof HTMLElement) block.textContent = line;
    }
  });
  if (!lines.length) {
    element.textContent = '';
  }
  element.dispatchEvent(new Event('input', { bubbles: true }));
  return true;
}

function commitRecipientField(field) {
  if (!(field instanceof HTMLElement)) return;
  field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
  field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', bubbles: true }));
}

async function openComposeDialog() {
  const existing = findComposeDialog();
  if (existing) return existing;
  const composeButton = selectFirst(document, COMPOSE_BUTTON_SELECTORS);
  if (composeButton) {
    composeButton.click();
    dispatchMouseSequence(composeButton);
    const dialogFromButton = await waitForComposeDialog(3500);
    if (dialogFromButton) return dialogFromButton;
  }

  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', code: 'KeyC', bubbles: true }));
  document.dispatchEvent(new KeyboardEvent('keyup', { key: 'c', code: 'KeyC', bubbles: true }));
  return waitForComposeDialog();
}

function findSendInRoot(root) {
  for (const selector of STRUCTURAL_SEND_BUTTON_SELECTORS) {
    const node = root.querySelector(selector);
    if (isVisible(node)) return node;
  }
  for (const selector of LEGACY_SEND_BUTTON_SELECTORS) {
    const node = root.querySelector(selector);
    if (isVisible(node)) return node;
  }
  const buttons = root.querySelectorAll('div[role="button"], button');
  for (const button of buttons) {
    const label = String(
      button.getAttribute('aria-label') || button.getAttribute('data-tooltip') || button.textContent || ''
    ).trim();
    if (/^send$/i.test(label) && isVisible(button)) return button;
  }
  return null;
}

function bodyFieldShowsSendEvidence(bodyField, originalText) {
  if (!(bodyField instanceof HTMLElement)) return '';
  const original = String(originalText || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!original) return '';
  const current = String(bodyField.innerText || bodyField.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (!current) return 'body-cleared';
  const anchor = original.slice(0, 34);
  if (anchor && !current.includes(anchor) && current.length <= Math.max(24, Math.floor(original.length * 0.38))) {
    return 'body-changed';
  }
  return '';
}

function findVisibleSendIndicator() {
  const nodes = Array.from(document.querySelectorAll('[role="alert"], [aria-live], .bAq, .vh, .aT'));
  for (const node of nodes) {
    if (!(node instanceof HTMLElement) || !isVisible(node)) continue;
    const text = String(node.textContent || node.innerText || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!text) continue;
    if (text.includes('message sent')) return 'toast-message-sent';
    if (text.includes('sent')) return 'toast-sent';
  }
  return '';
}

function waitForSendCompletion(composeRoot, timeoutMs = 7000, options = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const bodyField = options.bodyField instanceof HTMLElement ? options.bodyField : null;
    const originalText = String(options.originalText || '');
    const isClosed = () => {
      if (!(composeRoot instanceof HTMLElement)) return true;
      if (!composeRoot.isConnected) return true;
      if (!isVisible(composeRoot)) return true;
      return false;
    };
    const tryResolve = () => {
      if (isClosed()) {
        cleanup();
        resolve({ ok: true, reason: 'compose-closed' });
        return true;
      }
      const indicator = findVisibleSendIndicator();
      if (indicator) {
        cleanup();
        resolve({ ok: true, reason: indicator });
        return true;
      }
      const evidence = bodyFieldShowsSendEvidence(bodyField, originalText);
      if (evidence) {
        cleanup();
        resolve({ ok: true, reason: evidence });
        return true;
      }
      return false;
    };
    const interval = window.setInterval(() => {
      if (tryResolve()) return;
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        resolve({ ok: false, reason: 'timeout' });
      }
    }, 140);
    const observer = new MutationObserver(() => {
      if (tryResolve()) return;
      if (Date.now() - startedAt > timeoutMs) {
        cleanup();
        resolve({ ok: false, reason: 'timeout' });
      }
    });
    const cleanup = () => {
      window.clearInterval(interval);
      observer.disconnect();
    };
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'aria-hidden']
    });
    tryResolve();
  });
}

async function replyToThread(body, options = {}) {
  const recipients = Array.isArray(options.recipients) ? options.recipients : [];
  const subject = String(options.subject || '').trim();

  if (!body.trim()) {
    return { ok: false, stage: 'missing-body', reason: 'Message body is empty.' };
  }
  if (!recipients.length) {
    return { ok: false, stage: 'missing-recipient', reason: 'No recipient could be determined.' };
  }

  return withNativeGmailSurface(async () => {
    const dialog = await openComposeDialog();
    if (!dialog) {
      return { ok: false, stage: 'compose-open-failed', reason: 'Gmail compose window did not appear.' };
    }

    const toField = selectFirst(dialog, TO_FIELD_SELECTORS);
    const subjectField = selectFirst(dialog, SUBJECT_FIELD_SELECTORS);
    const bodyField = selectFirst(dialog, BODY_FIELD_SELECTORS);
    if (!toField || !subjectField || !bodyField) {
      return { ok: false, stage: 'compose-fields-missing', reason: 'Compose fields were not available.' };
    }

    const toText = recipients
      .map((entry) => entry.name ? `${entry.name} <${entry.email}>` : entry.email)
      .join(', ');

    toField.focus();
    if (!setNativeFieldValue(toField, toText)) {
      return { ok: false, stage: 'recipient-fill-failed', reason: 'Could not fill the recipient field.' };
    }
    commitRecipientField(toField);

    subjectField.focus();
    if (!setNativeFieldValue(subjectField, subject)) {
      return { ok: false, stage: 'subject-fill-failed', reason: 'Could not fill the subject field.' };
    }

    bodyField.focus();
    if (!setContentEditableValue(bodyField, body)) {
      return { ok: false, stage: 'body-fill-failed', reason: 'Could not fill the message body.' };
    }

    const sendButton = findSendInRoot(dialog);
    if (!sendButton) {
      return { ok: false, stage: 'send-button-missing', reason: 'Gmail send button was not available.' };
    }

    dispatchMouseSequence(sendButton);
    const completion = await waitForSendCompletion(dialog, 7000, { bodyField, originalText: body });
    if (!completion.ok) {
      return { ok: false, stage: 'send-verify-failed', reason: completion.reason || 'Gmail did not confirm send.' };
    }

    return { ok: true, stage: 'sent', reason: completion.reason || '' };
  });
}

async function submitThreadReply(group) {
  if (state.composer.sendInFlight) return;

  const activeGroup = group || findSelectedGroup();
  if (!activeGroup) return;

  const targetMessage = selectedComposerMessage(activeGroup);
  const recipients = composeRecipients(activeGroup, targetMessage, state.composer.mode);
  const body = String(state.composer.draft || '').trim();
  const subject = normalizedReplySubject(targetMessage?.subject || activeGroup.messages?.[0]?.subject || '');
  const replyHeaders = buildReplyHeaders(targetMessage);

  if (!recipients.length) {
    state.composer.sendError = 'Add at least one recipient.';
    renderActiveThreadDetail(activeGroup.threadId);
    return;
  }

  if (!body) {
    state.composer.sendError = 'Write a message first.';
    renderActiveThreadDetail(activeGroup.threadId);
    return;
  }

  const composerMode = state.composer.mode;
  state.composer.sendError = '';
  state.composer.sendStatus = 'Sending...';
  state.composer.sendInFlight = true;
  state.composer.draft = '';
  const optimisticSeed = seedLocalOutgoingMessage({
    threadId: activeGroup.threadId,
    contactKey: activeGroup.threadId,
    recipients,
    subject,
    bodyText: body,
    contactEmail: getGroupContactEmail(activeGroup),
    contactName: groupDisplayName(activeGroup),
    contactKind: activeGroup.summary?.contactKind || 'person',
    contactDomain: activeGroup.summary?.contactDomain || '',
    references: replyHeaders.references,
    inReplyTo: replyHeaders.inReplyTo
  });
  const optimisticRowPatched = refreshThreadRow(activeGroup.threadId);
  scheduleUiCommit({
    detail: true,
    detailThreadId: activeGroup.threadId,
    selectionOnly: true,
    rail: !optimisticRowPatched
  });

  let result = null;
  let sendResponse = null;
  try {
    sendResponse = await sendWorker('SEND_MESSAGE', {
      to: recipients,
      subject,
      bodyText: body,
      threadId: replyHeaders.threadId,
      inReplyTo: replyHeaders.inReplyTo,
      references: replyHeaders.references
    });

    if (sendResponse?.success) {
      result = { ok: true, stage: 'sent', reason: 'gmail-api-send' };
    } else if (sendResponse?.code === 'AUTH_SCOPE_REQUIRED') {
      result = {
        ok: false,
        stage: 'send-scope-required',
        reason: 'Mailita needs Gmail send permission. Add gmail.send in Google Cloud Data Access, reload the extension, and try again.'
      };
    } else {
      result = await replyToThread(body, {
        recipients,
        subject
      });
    }
  } catch (error) {
    result = {
      ok: false,
      stage: 'send-failed',
      reason: error?.message || 'Send failed.'
    };
  }

  if (!result.ok) {
    rollbackLocalOutgoingMessage(optimisticSeed, {
      restoreSelectedThreadId: activeGroup.threadId
    });
    if (activeGroup.summary) {
      upsertContactSummary(activeGroup.summary);
    }
    state.composer = {
      ...defaultComposerState(),
      draft: body,
      mode: composerMode,
      targetMessageId: targetMessage?.id || '',
      sendError: result.reason || 'Send failed.'
    };
    const failedRowPatched = refreshThreadRow(activeGroup.threadId);
    scheduleUiCommit({
      detail: true,
      detailThreadId: activeGroup.threadId,
      selectionOnly: true,
      rail: !failedRowPatched
    });
    return;
  }

  reconcileLocalOutgoingMessage(optimisticSeed, sendResponse?.sent || {});
  state.composer = {
    ...defaultComposerState(),
    mode: composerMode,
    targetMessageId: targetMessage?.id || '',
    sendStatus: 'Sent'
  };
  requestDetailSnapToLatest(activeGroup.threadId);
  const sentRowPatched = refreshThreadRow(activeGroup.threadId);
  scheduleUiCommit({
    detail: true,
    detailThreadId: activeGroup.threadId,
    selectionOnly: true,
    rail: !sentRowPatched
  });

  window.setTimeout(() => {
    state.composer.sendStatus = '';
    scheduleUiCommit({
      detail: true,
      detailThreadId: activeGroup.threadId
    });
  }, 1800);

  sendWorker('SYNC_MESSAGES', {
    trackActivity: false
  }).catch(() => {});
}

function formatActivityTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatActivityLine(entry) {
  const parts = [
    formatActivityTime(entry.ts),
    entry.source,
    entry.level,
    entry.stage
  ];

  if (entry.code) parts.push(entry.code);
  parts.push(entry.message);
  if (entry.details) parts.push(entry.details);

  return parts
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function renderActivityPanel() {
  const log = document.getElementById('gmailUnifiedActivityLog');
  if (!log) return;

  const entries = normalizeSetupDiagnostics(state.setupDiagnostics).entries;
  if (!entries.length) {
    log.textContent = 'Activity from the UI, extension, backend, and Gmail will appear here.';
    return;
  }

  log.textContent = entries.map((entry) => formatActivityLine(entry)).join('\n');
}

function buildActivityPanelMarkup() {
  if (!SHOW_ACTIVITY_PANEL) return '';

  return `
        <section class="gmail-unified-activity-panel">
          <div class="gmail-unified-activity-header">
            <div class="gmail-unified-activity-kicker">Activity</div>
          </div>
          <pre id="gmailUnifiedActivityLog" class="gmail-unified-activity-log"></pre>
        </section>
  `;
}

function byDateDesc(a, b) {
  return messageReceivedAtMs(b) - messageReceivedAtMs(a);
}

function threadCounterparty(message) {
  if (message?.contactName || message?.contactEmail) {
    return message.contactName || message.contactEmail || 'Unknown contact';
  }

  if (message?.isOutgoing) {
    return message.to?.[0]?.name || message.to?.[0]?.email || 'Unknown recipient';
  }

  return message?.from?.name || message?.from?.email || 'Unknown sender';
}

function threadCounterpartyKey(message) {
  const canonical = String(message?.contactKey || '').trim();
  if (canonical) return canonical;

  if (message?.isOutgoing) {
    const email = String(message.to?.[0]?.email || '').trim().toLowerCase();
    if (email) return `contact:${email}`;
  } else {
    const email = String(message?.from?.email || '').trim().toLowerCase();
    if (email) return `contact:${email}`;
  }

  const label = threadCounterparty(message).trim().toLowerCase();
  if (label) return `contact-label:${label}`;

  return message?.threadId || message?.id || createDiagnosticId();
}

function groupByThread(messages) {
  const map = new Map();
  messages.forEach((message) => {
    const key = threadCounterpartyKey(message);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(message);
  });

  return [...map.entries()]
    .map(([threadId, entries]) => ({
      threadId,
      messages: [...entries].sort(byDateDesc)
    }))
    .sort((a, b) => byDateDesc(a.messages[0], b.messages[0]));
}

function buildContactSummaryFromMessages(threadId, messages) {
  const entries = [...(Array.isArray(messages) ? messages : [])].sort(byDateDesc);
  const latest = entries[0] || null;
  const threadIds = new Set(entries.map((message) => String(message?.threadId || '').trim()).filter(Boolean));
  const latestContactEmail = String(
    latest?.contactEmail
    || (latest?.isOutgoing ? latest?.to?.[0]?.email : latest?.from?.email)
    || threadIdToContactEmail(threadId)
    || ''
  ).trim().toLowerCase();

  return normalizeContactSummary({
    contactKey: String(threadId || '').trim(),
    contactEmail: latestContactEmail,
    displayName: latest?.contactName || threadCounterparty(latest) || latestContactEmail || 'Unknown contact',
    latestSubject: latest?.subject || '(no subject)',
    latestPreview: latest ? previewTextFromMessage(latest) : '(no preview)',
    latestDate: latest?.date || new Date(0).toISOString(),
    latestReceivedAtMs: messageReceivedAtMs(latest),
    latestDirection: latest?.isOutgoing ? 'outgoing' : 'incoming',
    latestMessageId: latest?.messageId || latest?.id || '',
    messageCount: entries.length,
    threadCount: threadIds.size || (entries.length ? 1 : 0),
    unreadCount: entries.filter(isUnread).length,
    hasMissingContent: entries.some((message) => {
      const text = String(message?.bodyText || message?.snippet || '').trim();
      const html = String(message?.bodyHtml || '').trim();
      return !text && !html;
    }),
    inboxCount: entries.filter((message) => !message?.isOutgoing).length,
    sentCount: entries.filter((message) => Boolean(message?.isOutgoing)).length,
    contactKind: latest?.contactKind || 'person',
    contactDomain: latest?.contactDomain || ''
  });
}

function sortThreadGroups(groups) {
  return [...groups].sort((left, right) =>
    groupLatestTimeMs(right) - groupLatestTimeMs(left));
}

function currentSearchTerm() {
  return String(state.searchQuery || '').trim().toLowerCase();
}

function summaryMatchesSearch(summary, query = currentSearchTerm()) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    summary?.displayName,
    summary?.contactEmail,
    summary?.latestSubject,
    summary?.latestPreview
  ]
    .map((value) => String(value || '').trim().toLowerCase())
    .filter(Boolean)
    .join('\n');
  return haystack.includes(needle);
}

function currentSearchContactGroups() {
  const query = currentSearchTerm();
  return currentSummaryItems()
    .filter((summary) => summaryVisibleInCurrentFilter(summary))
    .filter((summary) => summaryMatchesSearch(summary, query))
    .map((summary) => {
      const allMessages = state.contactMessagesByKey[summary.contactKey] || seedMessagesForThread(summary.contactKey);
      return {
        threadId: summary.contactKey,
        summary,
        messages: filteredMessagesForCurrentFilter(allMessages),
        allMessages
      };
    });
}

function currentSearchMessageGroups() {
  return sortThreadGroups(groupByThread(state.searchMessageResults)
    .map((group) => {
      const hydratedMessages = state.contactMessagesByKey[group.threadId];
      const allMessages = Array.isArray(hydratedMessages) && hydratedMessages.length
        ? hydratedMessages
        : group.messages;
      const summary = findSummaryByThreadId(group.threadId) || buildContactSummaryFromMessages(group.threadId, allMessages);
      return {
        threadId: group.threadId,
        summary,
        messages: filteredMessagesForCurrentFilter(allMessages),
        allMessages
      };
    })
    .filter((group) => summaryVisibleInCurrentFilter(group.summary)));
}

function currentThreadGroups() {
  if (usingLegacyMailboxFlow()) {
    return sortThreadGroups(groupByThread(filteredMessages()));
  }

  if (state.mailboxMode === 'search') {
    const contactGroups = currentSearchContactGroups();
    const contactKeys = new Set(contactGroups.map((group) => group.threadId));
    const messageGroups = currentSearchMessageGroups()
      .filter((group) => !contactKeys.has(group.threadId));
    return [...contactGroups, ...messageGroups];
  }

  return currentSummaryItems()
    .filter((summary) => summaryVisibleInCurrentFilter(summary))
    .map((summary) => {
      const allMessages = state.contactMessagesByKey[summary.contactKey] || seedMessagesForThread(summary.contactKey);
      return {
        threadId: summary.contactKey,
        summary,
        messages: filteredMessagesForCurrentFilter(allMessages),
        allMessages
      };
    });
}

function buildThreadGroupForDetail(threadId) {
  const key = String(threadId || '').trim();
  if (!key) return null;

  const allMessages = Array.isArray(state.contactMessagesByKey[key]) && state.contactMessagesByKey[key].length
    ? state.contactMessagesByKey[key]
    : seedMessagesForThread(key);
  const resolvedSummary = findSummaryByThreadId(key)
    || (allMessages.length ? buildContactSummaryFromMessages(key, allMessages) : null);

  if (!resolvedSummary && !allMessages.length) return null;

  return {
    threadId: key,
    summary: resolvedSummary,
    messages: filteredMessagesForCurrentFilter(allMessages),
    allMessages
  };
}

function findSelectedGroup() {
  if (!state.selectedThreadId) return null;
  return buildThreadGroupForDetail(state.selectedThreadId);
}

function renderActiveThreadDetail(threadId = state.selectedThreadId, options = {}) {
  const activeThreadId = String(threadId || '').trim();
  if (!activeThreadId || activeThreadId !== String(state.selectedThreadId || '').trim()) return null;

  const group = findSelectedGroup() || buildThreadGroupForDetail(activeThreadId);
  if (!group) return null;

  renderThreadDetail(group, options);
  return group;
}

function upsertContactSummary(summary) {
  if (!summary?.contactKey) return;
  const next = normalizeContactSummary(summary);
  state.summaryByThreadId[next.contactKey] = next;
  if (!state.summaryOrder.includes(next.contactKey)) {
    state.summaryOrder.push(next.contactKey);
  }
  resyncSummaryOrderForKey(next.contactKey);
}

function appendRailSection(list, title) {
  const node = document.createElement('div');
  node.className = 'gmail-unified-rail-section';
  node.textContent = title;
  list.appendChild(node);
}

function appendRailStatus(list, text, variant = 'info') {
  const node = document.createElement('div');
  node.className = `gmail-unified-rail-status is-${variant}`;
  node.textContent = text;
  list.appendChild(node);
}

function createThreadRow(group, options = {}) {
  const unread = groupUnread(group);
  const unreadCount = groupUnreadCount(group);
  const selected = state.selectedThreadId === group.threadId;
  const searchKind = String(options.searchKind || '').trim();

  const row = document.createElement('div');
  row.className = 'gmail-unified-thread-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;
  row.dataset.threadId = group.threadId;
  if (searchKind) row.dataset.searchKind = searchKind;
  row.classList.toggle('is-selected', selected);
  row.setAttribute('aria-selected', selected ? 'true' : 'false');

  const who = groupDisplayName(group);
  const latestDate = groupLatestDate(group);
  const latestPreview = groupLatestPreview(group);
  const avatar = groupAvatarLabel(group);
  const metaParts = threadMetaParts(group);

  row.innerHTML = `
    <div class="gmail-unified-thread-row-shell">
      <div class="gmail-unified-thread-avatar-wrap">
        <div class="gmail-unified-thread-avatar" aria-hidden="true">${escapeHtml(avatar)}</div>
        ${unread ? `<span class="gmail-unified-thread-unread-dot" aria-hidden="true"></span>` : ''}
      </div>
      <div class="gmail-unified-thread-copy">
        <div class="gmail-unified-thread-top">
          <span class="gmail-unified-thread-who ${unread ? 'unread' : ''}">${escapeHtml(who)}</span>
          <span class="gmail-unified-date">${formatDate(latestDate)}</span>
        </div>
        <div class="gmail-unified-thread-preview ${unread ? 'unread' : ''}">${escapeHtml(latestPreview)}</div>
        <div class="gmail-unified-thread-meta">
          <span class="gmail-unified-thread-subject ${unread ? 'unread' : ''}">${escapeHtml(metaParts[0] || '')}</span>
          ${unreadCount > 0 ? `<span class="gmail-unified-thread-unread-copy">${unreadCount} unread</span>` : ''}
        </div>
      </div>
    </div>
  `;

  const openThread = () => {
    if (state.selectedThreadId !== group.threadId) {
      state.composer = defaultComposerState();
    }
    state.selectedThreadId = group.threadId;
    const seededMessages = Array.isArray(group.allMessages) && group.allMessages.length
      ? group.allMessages
      : (Array.isArray(group.messages) ? group.messages : []);
    if (seededMessages.length) {
      storeContactMessages(group.threadId, seededMessages);
    }
    requestDetailSnapToLatest(group.threadId);
    scheduleUiCommit({
      selectionOnly: true,
      detail: true,
      detailThreadId: group.threadId
    });
    if (!usingLegacyMailboxFlow()) {
      loadContactMessagesForThread(group.threadId, {
        pageSize: CONTACT_PAGE_SIZE
      }).catch(() => {});
    }
  };

  row.addEventListener('click', openThread);
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openThread();
  });

  return row;
}

function refreshThreadRow(threadId) {
  const list = document.getElementById('gmailUnifiedList');
  const key = String(threadId || '').trim();
  if (!list || !key || usingLegacyMailboxFlow() || state.mailboxMode === 'search') return false;

  const summary = findSummaryByThreadId(key);
  if (!summary || !summaryVisibleInCurrentFilter(summary)) return false;

  const allMessages = state.contactMessagesByKey[key] || seedMessagesForThread(key);
  const nextRow = createThreadRow({
    threadId: key,
    summary,
    messages: filteredMessagesForCurrentFilter(allMessages),
    allMessages
  });
  const existingRow = list.querySelector(`.gmail-unified-thread-row[data-thread-id="${CSS.escape(key)}"]`);
  if (!existingRow) return false;
  existingRow.replaceWith(nextRow);
  return true;
}

function appendThreadRow(list, group, options = {}) {
  const row = createThreadRow(group, options);
  list.appendChild(row);
}

function groupDisplayName(group) {
  if (group?.summary) {
    return group.summary.displayName || group.summary.contactEmail || 'Unknown contact';
  }
  if (!group?.messages?.length) return 'Unknown contact';
  return threadCounterparty(group.messages[0]);
}

function groupLatestSubject(group) {
  if (group?.summary) return group.summary.latestSubject || '(no subject)';
  return group?.messages?.[0]?.subject || '(no subject)';
}

function groupLatestPreview(group) {
  if (group?.summary?.latestPreview) return group.summary.latestPreview;
  if (group?.messages?.length) return messagePreviewText(group.messages[0]);
  return '(no preview)';
}

function groupLatestDate(group) {
  if (group?.summary) return group.summary.latestDate || new Date(0).toISOString();
  return group?.messages?.[0]?.date || new Date(0).toISOString();
}

function groupLatestTimeMs(group) {
  if (group?.summary) {
    return numericValue(group.summary.latestReceivedAtMs, timeValueMs(group.summary.latestDate));
  }
  return messageReceivedAtMs(group?.messages?.[0]);
}

function groupThreadCount(group) {
  if (group?.summary) return Math.max(1, numericValue(group.summary.threadCount, 0));
  const threadIds = new Set((group?.messages || []).map((message) => String(message?.threadId || '').trim()).filter(Boolean));
  return Math.max(1, threadIds.size || (Array.isArray(group?.messages) && group.messages.length ? 1 : 0));
}

function groupMessageCount(group) {
  if (group?.summary) return numericValue(group.summary.messageCount, 0);
  return Array.isArray(group?.messages) ? group.messages.length : 0;
}

function groupAvatarLabel(group) {
  return initialsForLabel(groupDisplayName(group));
}

function groupUnread(group) {
  if (group?.summary) return numericValue(group.summary.unreadCount, 0) > 0;
  return Array.isArray(group?.messages) ? group.messages.some(isUnread) : false;
}

function groupUnreadCount(group) {
  if (group?.summary) return numericValue(group.summary.unreadCount, 0);
  return Array.isArray(group?.messages) ? group.messages.filter(isUnread).length : 0;
}

function threadMetaParts(group) {
  const parts = [];
  const subject = groupLatestSubject(group);
  const messageCount = groupMessageCount(group);
  const threadCount = groupThreadCount(group);

  parts.push(subject || '(no subject)');
  if (messageCount > 1) parts.push(`${messageCount} messages`);
  if (threadCount > 1) parts.push(`${threadCount} topics`);
  return parts;
}

function isUnread(message) {
  const flags = Array.isArray(message.flags) ? message.flags : [];
  return !flags.includes('\\Seen');
}

function filteredMessages() {
  return [...state.messages]
    .filter((message) => messageVisibleInCurrentFilter(message))
    .sort(byDateDesc);
}

function snippetHealth(message) {
  const text = String(message?.bodyText || message?.snippet || '').trim();
  const html = String(message?.bodyHtml || '').trim();
  if (html && !text) return 'present';
  if (!text) return 'missing';
  if (text.length < 40) return 'short';
  return 'present';
}

function formatCandidatePartsShort(parts) {
  const list = Array.isArray(parts) ? parts : [];
  if (!list.length) return 'none';

  return list
    .slice(0, 8)
    .map((part) => {
      const type = `${part?.type || 'unknown'}${part?.subtype ? `/${part.subtype}` : ''}`;
      const disposition = part?.disposition || (part?.isAttachment ? 'attachment' : 'inline');
      return `${part?.part || 'root'}:${type}[${disposition}]@d${part?.pathDepth ?? 0}`;
    })
    .join(', ');
}

function buildDebugDiagnosis(group, traceEntries) {
  const messages = Array.isArray(group?.messages) ? group.messages : [];
  const missingCount = messages.filter((message) => snippetHealth(message) === 'missing').length;
  const shortCount = messages.filter((message) => snippetHealth(message) === 'short').length;
  const contactDebug = getContactDebugState(group?.threadId);
  const contactLoadState = group?.summary ? getContactLoadState(group.threadId) : defaultContactLoadState();
  const stages = new Set((traceEntries || []).map((entry) => entry.stage));

  if (!messages.length && group?.summary) {
    if (contactLoadState.inFlight) {
      return 'Mailita has the left-rail summary for this person and is currently fetching only this contact conversation.';
    }

    if (contactLoadState.error) {
      return 'Mailita loaded the summary row, but the focused contact request failed before the conversation body could render.';
    }

    if (contactLoadState.loaded) {
      return 'Mailita loaded the contact request, but no messages were returned for the currently selected filter.';
    }

    return 'Mailita has the summary row for this person, but the focused contact request has not completed yet.';
  }

  if (!messages.length) {
    return 'No selected thread was available when this debug snapshot was generated.';
  }

  if (contactDebug.inFlight) {
    return 'Mailita is refreshing this conversation live from Gmail right now to capture per-message extraction details.';
  }

  if (contactDebug.attempted && !contactDebug.inFlight) {
    if (contactDebug.error) {
      return 'Mailita attempted a live contact refetch, but that refetch failed before refreshed message text could be returned.';
    }

    if (contactDebug.afterCount > 0 && contactDebug.afterMissingContentCount === 0) {
      return 'Mailita performed a live contact refetch and recovered message content for this conversation.';
    }

    if (contactDebug.afterCount > 0 && contactDebug.afterMissingContentCount > 0) {
      return 'Mailita performed a live contact refetch, and Gmail still returned blank text for some or all messages. The extraction diagnostics below show where parsing failed.';
    }
  }

  if (state.mailboxAutoRefresh.inFlight) {
    return 'Mailita detected blank cached content and is running one live mailbox refresh from Gmail to compare cache coverage before and after.';
  }

  if (state.mailboxAutoRefresh.attempted && state.mailboxAutoRefresh.failedToFillContent) {
    return 'Mailita already retried the mailbox live, but blank message content remained. The contact-level debug refetch below is the next layer of evidence.';
  }

  if (!missingCount && !shortCount) {
    return 'The UI received message text for this thread. If the content still looks wrong, the next likely issue is formatting or HTML-to-text conversion.';
  }

  if (stages.has('messages_cache_hit') && !stages.has('messages_cache_preview_miss')) {
    return 'The backend served cached rows without refreshing from Gmail. Empty content here usually means those cached rows were saved before body extraction worked, or the active backend is still running the older build.';
  }

  if (stages.has('messages_cache_preview_miss')) {
    return 'The backend noticed weak cached preview content and attempted a live Gmail refresh. If content is still empty, the IMAP extraction path is still failing for this message structure.';
  }

  if (stages.has('messages_imap_fetch_complete') || stages.has('imap_fetch_complete')) {
    return 'The backend fetched this mailbox from Gmail, but message text still came back empty. That usually means this email has a MIME/HTML structure our extraction logic is not parsing yet.';
  }

  return 'The UI did not receive usable message text for at least one message in this thread. We need the trace below to see whether the failure happened in cache, live IMAP fetch, or parsing.';
}

function buildThreadDebugReport(group) {
  const mailboxDebug = state.lastMailboxDebug || blankMailboxDebug();
  const contactDebug = getContactDebugState(group?.threadId);
  const contactLoadState = group?.summary ? getContactLoadState(group.threadId) : defaultContactLoadState();
  const traceEntries = mergeTraceEntries(state.lastMailboxTrace, contactLoadState.trace, contactDebug.trace);
  const messages = [...(group?.messages || [])].sort((a, b) => messageReceivedAtMs(a) - messageReceivedAtMs(b));
  const selectedContactEmail = getGroupContactEmail(group);
  const backendInfo = contactDebug.attempted
    ? normalizeBuildInfo(contactDebug.backend)
    : (
      contactLoadState.loaded || contactLoadState.inFlight || contactLoadState.error
        ? normalizeBuildInfo(contactLoadState.backend)
        : normalizeBuildInfo(mailboxDebug.backend)
    );
  const lines = [
    'MAILITA TEMP DEBUG',
    `generated_at: ${new Date().toISOString()}`,
    `trace_source: ${contactDebug.attempted ? 'mailbox+contact_debug' : (state.lastMailboxSource || 'mailbox')}`,
    `mailbox_source_path: ${activeMailboxSourceLabel()}`,
    `selected_thread_id: ${group?.threadId || 'none'}`,
    `selected_contact: ${selectedContactEmail || '(no contact email)'}`,
    `selected_subject: ${group?.messages?.[0]?.subject || group?.summary?.latestSubject || '(no subject)'}`,
    `message_count: ${messages.length}`,
    `diagnosis: ${buildDebugDiagnosis(group, traceEntries)}`,
    ''
  ];

  lines.push('backend:');
  lines.push(`  version: ${backendInfo.version}`);
  lines.push(`  build_sha: ${backendInfo.buildSha}`);
  lines.push(`  deployed_at: ${backendInfo.deployedAt || 'unknown'}`);
  lines.push('');

  lines.push('mailbox_timings:');
  lines.push(`  user_lookup_ms: ${normalizeTimings(state.lastMailboxTimings).user_lookup_ms}`);
  lines.push(`  cache_freshness_ms: ${normalizeTimings(state.lastMailboxTimings).cache_freshness_ms}`);
  lines.push(`  cache_read_ms: ${normalizeTimings(state.lastMailboxTimings).cache_read_ms}`);
  lines.push(`  grouping_ms: ${normalizeTimings(state.lastMailboxTimings).grouping_ms}`);
  lines.push(`  imap_fetch_ms: ${normalizeTimings(state.lastMailboxTimings).imap_fetch_ms}`);
  lines.push(`  upsert_ms: ${normalizeTimings(state.lastMailboxTimings).upsert_ms}`);
  lines.push(`  total_ms: ${normalizeTimings(state.lastMailboxTimings).total_ms}`);
  lines.push('');

  lines.push('mailbox_cache_coverage:');
  lines.push(`  used: ${mailboxDebug.cache.used}`);
  lines.push(`  newest_cached_at: ${mailboxDebug.cache.newestCachedAt || 'none'}`);
  lines.push(`  total_messages: ${mailboxDebug.cache.totalMessages}`);
  lines.push(`  missing_content_count: ${mailboxDebug.cache.missingContentCount}`);
  lines.push(`  short_content_count: ${mailboxDebug.cache.shortContentCount}`);
  lines.push(`  content_coverage_pct: ${mailboxDebug.cache.contentCoveragePct}`);
  lines.push('');

  lines.push('mailbox_live_refresh:');
  lines.push(`  used: ${mailboxDebug.live.used}`);
  lines.push(`  limit_per_folder: ${mailboxDebug.live.limitPerFolder}`);
  lines.push(`  total_messages: ${mailboxDebug.live.totalMessages}`);
  lines.push(`  missing_content_count: ${mailboxDebug.live.missingContentCount}`);
  lines.push(`  short_content_count: ${mailboxDebug.live.shortContentCount}`);
  lines.push(`  content_coverage_pct: ${mailboxDebug.live.contentCoveragePct}`);
  lines.push('');

  lines.push('mailbox_auto_refresh:');
  lines.push(`  attempted: ${state.mailboxAutoRefresh.attempted}`);
  lines.push(`  in_flight: ${state.mailboxAutoRefresh.inFlight}`);
  lines.push(`  failed_to_fill_content: ${state.mailboxAutoRefresh.failedToFillContent}`);
  lines.push(`  error: ${state.mailboxAutoRefresh.error || 'none'}`);
  lines.push(`  before_missing_content_count: ${state.mailboxAutoRefresh.before?.cache?.missingContentCount ?? 'n/a'}`);
  lines.push(`  before_content_coverage_pct: ${state.mailboxAutoRefresh.before?.cache?.contentCoveragePct ?? 'n/a'}`);
  lines.push(`  after_missing_content_count: ${state.mailboxAutoRefresh.after?.live?.missingContentCount ?? 'n/a'}`);
  lines.push(`  after_content_coverage_pct: ${state.mailboxAutoRefresh.after?.live?.contentCoveragePct ?? 'n/a'}`);
  lines.push('');

  lines.push('selected_contact_request:');
  lines.push(`  attempted: ${contactLoadState.attempted}`);
  lines.push(`  loaded: ${contactLoadState.loaded}`);
  lines.push(`  in_flight: ${contactLoadState.inFlight}`);
  lines.push(`  source: ${contactLoadState.source || 'none'}`);
  lines.push(`  schema_fallback_used: ${Boolean(contactLoadState.schemaFallbackUsed)}`);
  lines.push(`  rich_content_source: ${contactLoadState.richContentSource || 'unknown'}`);
  lines.push(`  error: ${contactLoadState.error || 'none'}`);
  lines.push(`  count: ${contactLoadState.count}`);
  lines.push(`  user_lookup_ms: ${normalizeTimings(contactLoadState.timings).user_lookup_ms}`);
  lines.push(`  cache_freshness_ms: ${normalizeTimings(contactLoadState.timings).cache_freshness_ms}`);
  lines.push(`  cache_read_ms: ${normalizeTimings(contactLoadState.timings).cache_read_ms}`);
  lines.push(`  grouping_ms: ${normalizeTimings(contactLoadState.timings).grouping_ms}`);
  lines.push(`  imap_fetch_ms: ${normalizeTimings(contactLoadState.timings).imap_fetch_ms}`);
  lines.push(`  upsert_ms: ${normalizeTimings(contactLoadState.timings).upsert_ms}`);
  lines.push(`  total_ms: ${normalizeTimings(contactLoadState.timings).total_ms}`);
  lines.push('');

  lines.push('contact_live_refetch:');
  lines.push(`  attempted: ${contactDebug.attempted}`);
  lines.push(`  in_flight: ${contactDebug.inFlight}`);
  lines.push(`  contact_email: ${contactDebug.contactEmail || selectedContactEmail || '(none)'}`);
  lines.push(`  before_count: ${contactDebug.beforeCount}`);
  lines.push(`  after_count: ${contactDebug.afterCount}`);
  lines.push(`  before_missing_content_count: ${contactDebug.beforeMissingContentCount}`);
  lines.push(`  after_missing_content_count: ${contactDebug.afterMissingContentCount}`);
  lines.push(`  error: ${contactDebug.error || 'none'}`);
  lines.push('');

  messages.forEach((message, index) => {
    const snippet = String(message?.snippet || '');
    const preview = snippet.slice(0, 240).replace(/\n/g, '\\n') || '(empty)';
    lines.push(`message_${index + 1}:`);
    lines.push(`  id: ${message.id || ''}`);
    lines.push(`  uid: ${message.uid ?? ''}`);
    lines.push(`  message_id: ${message.messageId || ''}`);
    lines.push(`  folder: ${message.folder || ''}`);
    lines.push(`  date: ${message.date || ''}`);
    lines.push(`  from: ${message.from?.name || ''} <${message.from?.email || ''}>`);
    lines.push(`  to: ${(message.to || []).map((entry) => `${entry?.name || ''} <${entry?.email || ''}>`).join(', ')}`);
    lines.push(`  subject: ${message.subject || ''}`);
    lines.push(`  snippet_health: ${snippetHealth(message)}`);
    lines.push(`  snippet_length: ${snippet.length}`);
    lines.push(`  snippet_preview: ${preview}`);
    if (message?.debug && typeof message.debug === 'object') {
      lines.push(`  structure_summary: ${message.debug.structureSummary || 'none'}`);
      lines.push(`  selection_strategy: ${message.debug.selectionStrategy || 'none'}`);
      lines.push(`  fallback_attempted: ${Boolean(message.debug.fallbackAttempted)}`);
      lines.push(`  fallback_stage: ${message.debug.fallbackStage || 'none'}`);
      lines.push(`  fallback_trigger_reason: ${message.debug.fallbackTriggerReason || 'none'}`);
      lines.push(`  final_content_source: ${message.debug.finalContentSource || 'none'}`);
      lines.push(`  final_empty_reason: ${message.debug.finalEmptyReason || message.debug.emptyReason || 'unknown'}`);
      lines.push(`  candidate_parts: ${formatCandidatePartsShort(message.debug.candidateParts)}`);
      lines.push(`  extraction_empty_reason: ${message.debug.emptyReason || 'unknown'}`);
      lines.push(`  extraction_selected_part: ${message.debug.selectedPart || 'none'}`);
      lines.push(`  extraction_parser_source: ${message.debug.parserSource || 'none'}`);
      lines.push(`  extraction_sanitized_length: ${message.debug.sanitizedLength ?? 0}`);
    }
    lines.push('');
  });

  if (contactDebug.perMessageExtraction.length) {
    lines.push('per_message_extraction:');
    contactDebug.perMessageExtraction.forEach((entry, index) => {
      lines.push(`  extraction_${index + 1}:`);
      lines.push(`    id: ${entry.id || ''}`);
      lines.push(`    uid: ${entry.uid ?? ''}`);
      lines.push(`    folder: ${entry.folder || ''}`);
      lines.push(`    has_body_structure: ${Boolean(entry.hasBodyStructure)}`);
      lines.push(`    selected_part: ${entry.selectedPart || 'none'}`);
      lines.push(`    selected_part_type: ${entry.selectedPartType || 'none'}`);
      lines.push(`    selected_part_subtype: ${entry.selectedPartSubtype || 'none'}`);
      lines.push(`    structure_summary: ${entry.structureSummary || 'none'}`);
      lines.push(`    selection_strategy: ${entry.selectionStrategy || 'none'}`);
      lines.push(`    fallback_attempted: ${Boolean(entry.fallbackAttempted)}`);
      lines.push(`    fallback_stage: ${entry.fallbackStage || 'none'}`);
      lines.push(`    fallback_trigger_reason: ${entry.fallbackTriggerReason || 'none'}`);
      lines.push(`    downloaded_bytes: ${entry.downloadedBytes ?? 0}`);
      lines.push(`    raw_download_bytes: ${entry.rawDownloadBytes ?? 0}`);
      lines.push(`    parser_source: ${entry.parserSource || 'none'}`);
      lines.push(`    raw_fallback_parser_source: ${entry.rawFallbackParserSource || 'none'}`);
      lines.push(`    raw_text_length: ${entry.rawTextLength ?? 0}`);
      lines.push(`    sanitized_length: ${entry.sanitizedLength ?? 0}`);
      lines.push(`    final_content_source: ${entry.finalContentSource || 'none'}`);
      lines.push(`    final_empty_reason: ${entry.finalEmptyReason || entry.emptyReason || 'unknown'}`);
      lines.push(`    empty_reason: ${entry.emptyReason || 'unknown'}`);
      lines.push(`    candidate_parts: ${formatCandidatePartsShort(entry.candidateParts)}`);
    });
    lines.push('');
  }

  lines.push('recent_trace:');
  if (!traceEntries.length) {
    lines.push('  (no trace entries returned)');
  } else {
    traceEntries.slice(-25).forEach((entry) => {
      lines.push(`  ${formatActivityLine(entry)}`);
    });
  }

  return lines.join('\n');
}

function renderThreadDebug(group) {
  const log = document.getElementById('gmailUnifiedDebugLog');
  const summary = document.getElementById('gmailUnifiedDebugSummary');
  const status = document.getElementById('gmailUnifiedDebugStatus');
  if (!log || !summary || !status) return;

  if (!group) {
    summary.textContent = [
      `Rail metrics: worker ${numericValue(state.summaryWorkerCount, 0)}`,
      `normalized ${numericValue(state.summaryNormalizedCount, 0)}`,
      `rendered ${numericValue(state.summaryRenderedCount, 0)}`,
      `loaded ${numericValue(state.summaryLoadedCount, 0)}`,
      `cursor ${state.summaryCursor ? 'present' : 'none'}`,
      `hasMore ${Boolean(state.summaryHasMore)}`
    ].join(' · ');
    status.hidden = true;
    status.textContent = '';
    setDebugText(log, [
      `summary_worker_count: ${numericValue(state.summaryWorkerCount, 0)}`,
      `summary_normalized_count: ${numericValue(state.summaryNormalizedCount, 0)}`,
      `summary_rendered_count: ${numericValue(state.summaryRenderedCount, 0)}`,
      `summary_loaded_count: ${numericValue(state.summaryLoadedCount, 0)}`,
      `summary_cursor: ${state.summaryCursor || 'none'}`,
      `summary_has_more: ${Boolean(state.summaryHasMore)}`,
      `summary_initial_load_in_flight: ${Boolean(state.summaryInitialLoadInFlight)}`,
      `summary_append_in_flight: ${Boolean(state.summaryAppendInFlight)}`,
      `summary_applied_generation: ${numericValue(state.summaryAppliedGeneration, 0)}`,
      `summary_last_request_id: ${numericValue(state.summaryLastRequestId, 0)}`,
      `summary_last_ignored_reason: ${state.summaryLastIgnoredReason || 'none'}`,
      '',
      'Open a conversation to generate a per-thread debug report.'
    ].join('\n'));
    return;
  }

  const contactDebug = getContactDebugState(group.threadId);
  const contactLoadState = group?.summary ? getContactLoadState(group.threadId) : defaultContactLoadState();
  const counts = messageContentCounts(group.messages);

  if (contactLoadState.inFlight || contactDebug.inFlight) {
    status.hidden = false;
    status.textContent = contactDebug.inFlight
      ? 'Refreshing this conversation live from Gmail...'
      : 'Loading this conversation from Mailita...';
  } else {
    status.hidden = true;
    status.textContent = '';
  }

  if (group?.summary && !group.messages.length && !contactDebug.attempted) {
    if (contactLoadState.error) {
      summary.textContent = `Conversation load failed: ${contactLoadState.error}`;
    } else if (contactLoadState.inFlight) {
      summary.textContent = 'Loading this conversation from the new contact endpoint.';
    } else if (contactLoadState.loaded) {
      summary.textContent = 'The focused contact request completed, but no messages were returned for the current filter.';
    } else {
      summary.textContent = 'Select a person to trigger the focused contact request.';
    }
    setDebugText(log, buildThreadDebugReport(group));
    return;
  }

  if (contactDebug.attempted && !contactDebug.inFlight) {
    if (contactDebug.error) {
      summary.textContent = `Live contact refetch failed: ${contactDebug.error}`;
    } else if (contactDebug.afterCount > 0) {
      summary.textContent = `Live contact refetch returned ${contactDebug.afterCount} messages. ${contactDebug.afterMissingContentCount} still have blank content.`;
    } else {
      summary.textContent = 'Live contact refetch completed, but Gmail returned no refreshed messages for this contact.';
    }
  } else {
    summary.textContent = counts.missing
      ? `${counts.missing} message${counts.missing > 1 ? 's' : ''} in this conversation are missing content.`
      : 'This conversation has message text; use the log below to inspect the exact payload.';
  }

  setDebugText(log, buildThreadDebugReport(group));
}

function setStateCard(type, text, retryVisible = false) {
  const card = document.getElementById('gmailUnifiedStateCard');
  const textNode = document.getElementById('gmailUnifiedStateText');
  const retryBtn = document.getElementById('gmailUnifiedRetryBtn');
  const countdown = document.getElementById('gmailUnifiedCountdown');
  const list = document.getElementById('gmailUnifiedList');
  const detail = document.getElementById('gmailUnifiedDetail');

  if (!card || !textNode || !retryBtn || !countdown || !list || !detail) return;

  card.dataset.state = type;
  textNode.textContent = text;
  retryBtn.style.display = retryVisible ? 'inline-flex' : 'none';
  countdown.style.display = state.retrySeconds > 0 ? 'block' : 'none';
  countdown.textContent = state.retrySeconds > 0 ? `Retrying automatically in ${state.retrySeconds}s` : '';

  if (type === 'normal') {
    card.style.display = 'none';
    list.style.display = 'block';
    detail.style.display = state.selectedThreadId ? 'block' : 'none';
  } else {
    card.style.display = 'block';
    list.style.display = 'none';
    detail.style.display = 'none';
  }

  pushDebugEvent('ui', 'State card updated', { type, text, retryVisible });
  renderDebugPanel();
  updateMainPanelVisibility();
}

function supportsIntersectionObservers() {
  return typeof window.IntersectionObserver === 'function';
}

function disconnectRailPaginationObserver() {
  if (railPaginationObserver) {
    railPaginationObserver.disconnect();
    railPaginationObserver = null;
  }
}

function disconnectDetailHistoryObserver() {
  if (detailHistoryObserver) {
    detailHistoryObserver.disconnect();
    detailHistoryObserver = null;
  }
}

function disconnectDetailHydrationObserver() {
  if (detailHydrationObserver) {
    detailHydrationObserver.disconnect();
    detailHydrationObserver = null;
  }
}

function syncRailSelectionState() {
  const sidebar = document.getElementById('gmailUnifiedSidebar');
  if (sidebar) {
    sidebar.dataset.detailOpen = state.selectedThreadId ? 'true' : 'false';
  }
  document.querySelectorAll('.gmail-unified-thread-row[data-thread-id]').forEach((node) => {
    const selected = String(node.getAttribute('data-thread-id') || '').trim() === String(state.selectedThreadId || '').trim();
    node.classList.toggle('is-selected', selected);
    node.setAttribute('aria-selected', selected ? 'true' : 'false');
  });
  updateMainPanelVisibility();
}

function scheduleUiCommit(request = {}) {
  if (request.rail) queuedUiCommit.rail = true;
  if (request.detail) queuedUiCommit.detail = true;
  if (request.overlays) queuedUiCommit.overlays = true;
  if (request.selectionOnly) queuedUiCommit.selectionOnly = true;
  if (request.preserveDetailScroll) queuedUiCommit.preserveDetailScroll = true;
  if (request.detailThreadId) queuedUiCommit.detailThreadId = String(request.detailThreadId || '').trim();
  if (request.scrollAnchor && typeof request.scrollAnchor === 'object') {
    queuedUiCommit.scrollAnchor = { ...request.scrollAnchor };
  }
  if (request.campaignOptions && typeof request.campaignOptions === 'object') {
    queuedUiCommit.campaignOptions = {
      ...queuedUiCommit.campaignOptions,
      ...request.campaignOptions
    };
  }
  if (uiCommitFrame) return;
  uiCommitFrame = window.requestAnimationFrame(() => {
    uiCommitFrame = 0;
    const commit = queuedUiCommit;
    queuedUiCommit = {
      rail: false,
      detail: false,
      overlays: false,
      selectionOnly: false,
      preserveDetailScroll: false,
      detailThreadId: '',
      scrollAnchor: null,
      campaignOptions: {}
    };

    const renderedRail = commit.rail;
    if (renderedRail) {
      renderThreads();
    }

    if (commit.selectionOnly && !renderedRail) {
      syncRailSelectionState();
    }

    if (commit.detail && !renderedRail) {
      renderActiveThreadDetail(commit.detailThreadId || state.selectedThreadId, {
        preserveScroll: commit.preserveDetailScroll,
        scrollAnchor: commit.scrollAnchor
      });
    }

    if (commit.overlays) {
      renderSettingsUi();
      renderComposeOverlay();
      if (CAMPAIGN_MODE_ENABLED) {
        renderCampaignMode(commit.campaignOptions || {});
        renderCampaignBanner();
      }
    }

    updateMainPanelVisibility();
  });
}

function renderRailSkeletons(list, count = 6) {
  list.innerHTML = '';
  Array.from({ length: count }).forEach(() => {
    const row = document.createElement('div');
    row.className = 'gmail-unified-thread-row gmail-unified-thread-row-skeleton';
    row.innerHTML = `
      <div class="gmail-unified-thread-row-shell">
        <div class="gmail-unified-thread-avatar-wrap">
          <div class="gmail-unified-thread-avatar gmail-unified-thread-avatar-skeleton" aria-hidden="true"></div>
        </div>
        <div class="gmail-unified-thread-copy">
          <div class="gmail-unified-skeleton-line is-short"></div>
          <div class="gmail-unified-skeleton-line"></div>
          <div class="gmail-unified-skeleton-line is-medium"></div>
        </div>
      </div>
    `;
    list.appendChild(row);
  });
}

function renderThreads() {
  const list = document.getElementById('gmailUnifiedList');
  if (!list) return;

  const showingSearch = Boolean(state.searchQuery && !usingLegacyMailboxFlow());
  const contactSearchGroups = showingSearch ? currentSearchContactGroups() : [];
  const contactSearchKeys = new Set(contactSearchGroups.map((group) => group.threadId));
  const messageSearchGroups = showingSearch
    ? currentSearchMessageGroups().filter((group) => !contactSearchKeys.has(group.threadId))
    : [];
  const threadGroups = showingSearch
    ? [...contactSearchGroups, ...messageSearchGroups]
    : currentThreadGroups();
  const previousScrollTop = list.scrollTop;
  state.summaryRenderedCount = threadGroups.length;

  if (!threadGroups.length && !(showingSearch && (state.searchMessageResultsInFlight || state.searchMessageError))) {
    clearAdjacentContactPrefetchTimer();
    clearIdleContactPrefetchTimer();
    if (!showingSearch && (state.summaryBootstrapInFlight || state.summaryInitialLoadInFlight || (state.connected && numericValue(state.summaryAppliedGeneration, 0) === 0))) {
      setStateCard('normal', '');
      renderRailSkeletons(list);
      renderThreadDebug(null);
      renderDebugPanel();
      observeRailPagination();
      return;
    }
    if (state.summaryInitialLoadInFlight) {
      setStateCard('loading', 'Loading conversations...');
    } else if (showingSearch && state.searchQuery) {
      setStateCard('normal', '');
    } else {
      setStateCard('empty', 'No conversations found yet.');
    }
    list.innerHTML = '';
    renderThreadDebug(null);
    renderDebugPanel();
    return;
  }

  setStateCard('normal', '');

  list.innerHTML = '';

  if (showingSearch) {
    if (contactSearchGroups.length) {
      contactSearchGroups.forEach((group) => appendThreadRow(list, group, { searchKind: 'contact' }));
    } else {
      appendRailStatus(list, `No contacts match "${state.searchQuery}".`);
    }

    if (state.searchMessageResultsInFlight || state.searchMessageError || messageSearchGroups.length) {
      appendRailSection(list, 'In messages');
      if (state.searchMessageResultsInFlight) {
        appendRailStatus(list, 'Searching message bodies...');
      } else if (state.searchMessageError) {
        appendRailStatus(list, state.searchMessageError, 'error');
      } else if (messageSearchGroups.length) {
        messageSearchGroups.forEach((group) => appendThreadRow(list, group, { searchKind: 'message' }));
      } else {
        appendRailStatus(list, `No body matches for "${state.searchQuery}".`);
      }
    }
  } else {
    threadGroups.forEach((group) => appendThreadRow(list, group));
  }

  if (!showingSearch && (state.summaryAppendInFlight || state.summaryHasMore)) {
    const tail = document.createElement('div');
    tail.className = 'gmail-unified-thread-tail-loader';
    tail.textContent = state.summaryAppendInFlight ? 'Loading more conversations...' : 'Scroll for more';
    list.appendChild(tail);
  }

  list.scrollTop = previousScrollTop;

  const selectedGroup = findSelectedGroup();
  const activeDetailGroup = selectedGroup || buildThreadGroupForDetail(state.selectedThreadId);
  if (state.selectedThreadId && !activeDetailGroup) {
    state.selectedThreadId = '';
    state.detailLastThreadId = '';
    state.detailSnapToLatestThreadId = '';
    state.composer = defaultComposerState();
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
  }

  renderSettingsUi();
  if (activeDetailGroup) {
    renderThreadDetail(activeDetailGroup);
  } else {
    disconnectDetailHistoryObserver();
    disconnectDetailHydrationObserver();
    renderThreadDebug(null);
    updateMainPanelVisibility();
  }
  scheduleAdjacentContactPrefetch(threadGroups);
  scheduleIdleContactPrefetch(threadGroups);
  observeRailPagination();
  renderDebugPanel();
}

async function maybeDebugRefetchContact(group) {
  if (!group?.threadId) return;

  const contactEmail = getGroupContactEmail(group);
  if (!contactEmail) return;

  const counts = messageContentCounts(group.messages);
  if (!counts.missing) return;

  const existing = getContactDebugState(group.threadId);
  if (existing.attempted || existing.inFlight) return;

  state.contactDebug[group.threadId] = {
    ...defaultContactDebugState(),
    attempted: true,
    inFlight: true,
    contactEmail,
    beforeCount: counts.total,
    beforeMissingContentCount: counts.missing,
    requestedAt: new Date().toISOString()
  };
  renderThreadDebug(group);

  appendUiActivity({
    source: 'UI',
    level: 'info',
    stage: 'contact_debug_refetch_started',
    message: 'Refreshing the selected conversation live from Gmail for debug.',
    details: `contactEmail=${contactEmail}; beforeCount=${counts.total}; beforeMissing=${counts.missing}`
  }).catch(() => {});

  const response = await sendWorker('DEBUG_REFETCH_CONTACT', {
    contactEmail,
    contactKey: group.threadId,
    selectedMessageIds: buildSelectedMessageRefs(group)
  });

  const nextState = {
    ...getContactDebugState(group.threadId),
    attempted: true,
    inFlight: false,
    contactEmail,
    completedAt: new Date().toISOString(),
    backend: normalizeBuildInfo(response?.backend || state.lastMailboxDebug?.backend),
    trace: normalizeTraceEntries(response?.trace),
    perMessageExtraction: Array.isArray(response?.debug?.perMessageExtraction)
      ? response.debug.perMessageExtraction
      : []
  };

  if (!response?.success) {
    nextState.error = response?.error || 'Live contact refetch failed.';
    state.contactDebug[group.threadId] = nextState;
    renderThreadDebug(findSelectedGroup());
    return;
  }

  const refreshedMessages = Array.isArray(response.messages) ? response.messages : [];
  nextState.beforeCount = numericValue(response?.debug?.beforeCount, counts.total);
  nextState.afterCount = numericValue(response?.debug?.afterCount, refreshedMessages.length);
  nextState.beforeMissingContentCount = numericValue(
    response?.debug?.beforeMissingContentCount,
    counts.missing
  );
  nextState.afterMissingContentCount = numericValue(
    response?.debug?.afterMissingContentCount,
    messageContentCounts(refreshedMessages).missing
  );
  state.contactDebug[group.threadId] = nextState;

  if (refreshedMessages.length) {
    replaceMessagesForThread(group.threadId, refreshedMessages);
  }

  const rowPatched = refreshedMessages.length ? refreshThreadRow(group.threadId) : false;
  scheduleUiCommit({
    detail: true,
    detailThreadId: group.threadId,
    selectionOnly: true,
    rail: !rowPatched && refreshedMessages.length
  });
}

function messageClusterShape(previousMessage, message, nextMessage) {
  const groupedWithPrevious = shouldClusterWithPrevious(previousMessage, message);
  const groupedWithNext = shouldClusterWithPrevious(message, nextMessage);
  const clusterShape = groupedWithPrevious
    ? (groupedWithNext ? 'middle' : 'end')
    : (groupedWithNext ? 'start' : 'single');

  return {
    groupedWithPrevious,
    groupedWithNext,
    clusterShape
  };
}

function applyMessageNodeContent(node, message, previousMessage, nextMessage) {
  if (!(node instanceof HTMLElement) || !message) return false;
  const renderedBody = messageDisplayMarkup(message);
  const { groupedWithNext, clusterShape } = messageClusterShape(previousMessage, message, nextMessage);
  const bodyMarkup = renderedBody.kind === 'html'
    ? '<div class="gmail-unified-message-html-host"></div>'
    : renderedBody.kind === 'metadata'
      ? `
        <div class="gmail-unified-message-metadata">
          <div class="gmail-unified-message-metadata-top">
            <span class="gmail-unified-message-metadata-sender">${renderedBody.sender}</span>
            <span class="gmail-unified-message-metadata-date">${renderedBody.date}</span>
          </div>
          <div class="gmail-unified-message-metadata-subject">${renderedBody.subject}</div>
          <div class="gmail-unified-message-metadata-preview">${renderedBody.preview}</div>
        </div>
      `
      : `<div class="gmail-unified-message-snippet">${renderedBody.content}</div>`;

  node.className = `gmail-unified-message ${message.isOutgoing ? 'outgoing' : 'incoming'} gmail-unified-message-${clusterShape} ${renderedBody.kind === 'html' ? 'gmail-unified-message-rich' : ''} ${renderedBody.kind === 'metadata' ? 'gmail-unified-message-metadata-row' : ''}`;
  node.dataset.messageId = message.id || '';
  node.innerHTML = `
    <div class="gmail-unified-message-bubble-shell">
      <div class="gmail-unified-message-bubble ${renderedBody.kind === 'html' ? 'gmail-unified-message-bubble-html' : ''} ${renderedBody.kind === 'metadata' ? 'gmail-unified-message-bubble-metadata' : ''}">
        ${bodyMarkup}
      </div>
    </div>
    ${groupedWithNext ? '' : `<div class="gmail-unified-message-stamp">${escapeHtml(formatDate(message.receivedAtMs || message.date))}</div>`}
  `;

  if (renderedBody.kind === 'html') {
    const host = node.querySelector('.gmail-unified-message-html-host');
    mountRenderedEmailCard(host, renderedBody.content);
  }

  return true;
}

function createMessageNode(message, previousMessage, nextMessage) {
  const item = document.createElement('div');
  applyMessageNodeContent(item, message, previousMessage, nextMessage);
  return item;
}

function patchRenderedMessageNodes(contactKey, messageIds = []) {
  const activeKey = String(contactKey || '').trim();
  if (!activeKey || state.selectedThreadId !== activeKey) return false;
  const body = document.getElementById('gmailUnifiedDetailBody');
  if (!body) return false;

  const targetIds = [...new Set((Array.isArray(messageIds) ? messageIds : []).map((messageId) => String(messageId || '').trim()).filter(Boolean))];
  if (!targetIds.length) return false;

  const messagesAsc = [...(state.contactMessagesByKey[activeKey] || [])]
    .sort((left, right) => messageReceivedAtMs(left) - messageReceivedAtMs(right));
  let patchedAny = false;

  targetIds.forEach((messageId) => {
    const index = messagesAsc.findIndex((message) => String(message?.id || '').trim() === messageId);
    if (index < 0) return;
    const node = body.querySelector(`.gmail-unified-message[data-message-id="${CSS.escape(messageId)}"]`);
    if (!(node instanceof HTMLElement)) return;
    applyMessageNodeContent(node, messagesAsc[index], messagesAsc[index - 1] || null, messagesAsc[index + 1] || null);
    patchedAny = true;
  });

  return patchedAny;
}

function captureDetailPrependAnchor(body) {
  if (!(body instanceof HTMLElement)) return null;
  const bodyRect = body.getBoundingClientRect();
  const nodes = [...body.querySelectorAll('.gmail-unified-message[data-message-id]')];
  const anchorNode = nodes.find((node) => node.getBoundingClientRect().bottom > bodyRect.top + 8)
    || nodes[0]
    || null;
  if (!(anchorNode instanceof HTMLElement)) return null;
  return {
    messageId: String(anchorNode.getAttribute('data-message-id') || '').trim(),
    offsetTop: anchorNode.getBoundingClientRect().top - bodyRect.top
  };
}

function restoreDetailPrependAnchor(body, anchor) {
  if (!(body instanceof HTMLElement) || !anchor?.messageId) return false;
  const anchorNode = body.querySelector(`.gmail-unified-message[data-message-id="${CSS.escape(anchor.messageId)}"]`);
  if (!(anchorNode instanceof HTMLElement)) return false;
  const bodyRect = body.getBoundingClientRect();
  const nextOffsetTop = anchorNode.getBoundingClientRect().top - bodyRect.top;
  body.scrollTop += nextOffsetTop - numericValue(anchor.offsetTop, 0);
  return true;
}

function renderThreadDetail(group, options = {}) {
  const detail = document.getElementById('gmailUnifiedDetail');
  const header = document.getElementById('gmailUnifiedDetailHeader');
  const body = document.getElementById('gmailUnifiedDetailBody');
  const subheader = document.getElementById('gmailUnifiedDetailSubheader');
  const composer = document.getElementById('gmailUnifiedComposer');
  const composerInput = document.getElementById('gmailUnifiedComposerInput');
  const composerReply = document.getElementById('gmailUnifiedComposerReply');
  const composerReplyAll = document.getElementById('gmailUnifiedComposerReplyAll');
  const composerStatus = document.getElementById('gmailUnifiedComposerStatus');
  const composerSend = document.getElementById('gmailUnifiedComposerSend');
  if (!detail || !header || !body || !composer || !composerInput || !composerReply || !composerStatus || !composerSend) return;
  const preserveScroll = Boolean(options.preserveScroll);
  const previousScrollTop = preserveScroll ? body.scrollTop : 0;

  const detailName = groupDisplayName(group);
  const detailEmail = getGroupContactEmail(group) || 'Conversation';
  const contactLoadState = group?.summary ? getContactLoadState(group.threadId) : defaultContactLoadState();
  const allMessages = Array.isArray(group?.allMessages) && group.allMessages.length
    ? group.allMessages
    : (state.contactMessagesByKey[group.threadId] || seedMessagesForThread(group.threadId) || group?.messages || []);
  const displayMessages = filteredMessagesForCurrentFilter(allMessages);
  const detailMessageCount = displayMessages.length
    || numericValue(contactLoadState.count, 0)
    || numericValue(group?.summary?.messageCount, 0);
  const shouldSnapToLatest = state.detailSnapToLatestThreadId === group.threadId
    || state.detailLastThreadId !== group.threadId
    || (body.scrollHeight > 0 && (body.scrollTop + body.clientHeight >= body.scrollHeight - 56));

  detail.style.display = 'flex';
  header.innerHTML = `
    <div class="gmail-unified-detail-identity">
      <div class="gmail-unified-detail-avatar" aria-hidden="true">${escapeHtml(groupAvatarLabel(group))}</div>
      <div class="gmail-unified-detail-identity-copy">
        <div class="gmail-unified-detail-title">${escapeHtml(detailName)}</div>
        <div class="gmail-unified-detail-subheader-row">
          <span>${escapeHtml(detailEmail)}</span>
          ${detailMessageCount ? `<span>${detailMessageCount} message${detailMessageCount === 1 ? '' : 's'}</span>` : ''}
        </div>
      </div>
    </div>
  `;
  subheader.innerHTML = '';

  body.innerHTML = '';
  const historySentinel = document.createElement('div');
  historySentinel.className = 'gmail-unified-history-sentinel';
  historySentinel.setAttribute('aria-hidden', 'true');
  body.appendChild(historySentinel);
  if (contactLoadState.hasMore || contactLoadState.inFlight) {
    const historyStatus = document.createElement('div');
    historyStatus.className = 'gmail-unified-history-status';
    historyStatus.textContent = contactLoadState.inFlight
      ? 'Loading older messages...'
      : 'Scroll up for earlier messages';
    body.appendChild(historyStatus);
  }

  if (!displayMessages.length) {
    if (contactLoadState.inFlight) {
      Array.from({ length: 4 }).forEach((_, index) => {
        const placeholder = document.createElement('div');
        placeholder.className = `gmail-unified-message ${index % 2 === 0 ? 'incoming' : 'outgoing'} gmail-unified-message-placeholder gmail-unified-message-single gmail-unified-message-skeleton`;
        placeholder.innerHTML = `
          <div class="gmail-unified-message-bubble-shell">
            <div class="gmail-unified-message-bubble">
              <div class="gmail-unified-skeleton-line is-short"></div>
              <div class="gmail-unified-skeleton-line"></div>
              <div class="gmail-unified-skeleton-line is-medium"></div>
            </div>
          </div>
        `;
        body.appendChild(placeholder);
      });
    } else {
      const placeholderText = (
        allMessages.length && state.filter !== 'all'
          ? `No ${state.filter} messages with ${detailName} yet.`
          : contactLoadState.error
          ? contactLoadState.error
          : (
            contactLoadState.loaded
              ? 'No messages were returned for this conversation yet.'
              : 'Open this conversation to load its history.'
          )
      );

      const placeholder = document.createElement('div');
      placeholder.className = 'gmail-unified-message incoming gmail-unified-message-placeholder gmail-unified-message-single';
      placeholder.innerHTML = `
        <div class="gmail-unified-message-bubble-shell">
          <div class="gmail-unified-message-bubble">
            <div class="gmail-unified-message-snippet">${escapeHtml(placeholderText)}</div>
          </div>
        </div>
      `;
      body.appendChild(placeholder);
    }
    composer.hidden = true;
    renderSettingsUi();
    renderThreadDebug(group);
    updateMainPanelVisibility();
    observeDetailHistory(group.threadId);
    disconnectDetailHydrationObserver();
    return;
  }

  composer.hidden = false;
  const selectedMessage = selectedComposerMessage({ ...group, messages: allMessages }) || displayMessages[displayMessages.length - 1];
  if (!state.composer.targetMessageId && selectedMessage?.id) {
    state.composer.targetMessageId = selectedMessage.id;
  }
  if (state.composer.mode === 'reply_all' && !replyAllAvailable(selectedMessage)) {
    state.composer.mode = 'reply';
  }

  let previousDayLabel = '';
  const messagesAsc = [...displayMessages].sort((a, b) => messageReceivedAtMs(a) - messageReceivedAtMs(b));
  messagesAsc.forEach((message, index) => {
    const dayLabel = calendarDayLabel(message.receivedAtMs || message.date);
    if (dayLabel && dayLabel !== previousDayLabel) {
      previousDayLabel = dayLabel;
      const separator = document.createElement('div');
      separator.className = 'gmail-unified-day-separator';
      separator.innerHTML = `<span>${escapeHtml(dayLabel)}</span>`;
      body.appendChild(separator);
    }
    body.appendChild(createMessageNode(message, messagesAsc[index - 1] || null, messagesAsc[index + 1] || null));
  });

  composerReply.classList.toggle('is-active', state.composer.mode === 'reply');
  composerReplyAll.hidden = !replyAllAvailable(selectedMessage);
  composerReplyAll.classList.toggle('is-active', state.composer.mode === 'reply_all');
  composerInput.value = state.composer.draft;
  composerInput.placeholder = 'Message';
  composerSend.disabled = state.composer.sendInFlight;
  composerSend.innerHTML = state.composer.sendInFlight ? '...' : '&#8593;';
  composerSend.setAttribute('aria-label', state.composer.sendInFlight ? 'Sending' : 'Send');
  composerStatus.textContent = state.composer.sendError || state.composer.sendStatus || '';
  composerStatus.dataset.state = state.composer.sendError ? 'error' : (state.composer.sendStatus ? 'success' : 'idle');

  renderSettingsUi();
  renderThreadDebug(group);
  updateMainPanelVisibility();

  window.requestAnimationFrame(() => {
    if (preserveScroll) {
      body.scrollTop = previousScrollTop;
    } else if (shouldSnapToLatest) {
      body.scrollTop = body.scrollHeight;
      if (state.detailSnapToLatestThreadId === group.threadId) {
        state.detailSnapToLatestThreadId = '';
      }
    }
    state.detailLastThreadId = group.threadId;
    if (!usingLegacyMailboxFlow()) {
      observeDetailHistory(group.threadId);
      observeVisibleBodyHydration(group.threadId);
      if (!supportsIntersectionObservers()) {
        scheduleVisibleBodyHydration(group.threadId);
      }
    }
  });
}

function clearRetryTimer() {
  if (state.retryTimer) {
    clearInterval(state.retryTimer);
    state.retryTimer = null;
  }
  state.retrySeconds = 0;
}

function failureMessageForResponse(response, fallback) {
  if (!response || typeof response !== 'object') return fallback;

  if (response.code === 'BACKEND_REQUEST_TIMEOUT') {
    return response.error || 'Backend request timed out before the mailbox data came back.';
  }

  if (response.code === 'BACKEND_REQUEST_FAILED' || response.code === 'BACKEND_UNREACHABLE') {
    return response.error || 'The browser could not complete the backend request.';
  }

  if (response.code === 'BACKEND_HEALTH_TIMEOUT' || response.code === 'BACKEND_HEALTH_UNREACHABLE') {
    return response.error || 'The browser could not confirm backend health from this network.';
  }

  return response.error || fallback;
}

function contactFailureMessage(response, fallback = 'Unable to load this conversation.') {
  if (!response || typeof response !== 'object') return fallback;

  if (response.code === 'WORKER_TIMEOUT') {
    return 'Still loading from Gmail...';
  }

  if (response.code === 'GMAIL_API_ERROR' || response.code === 'GMAIL_API_TIMEOUT') {
    return 'Gmail couldn\'t fetch this';
  }

  if (response.code === 'ZERO_RESULTS') {
    return 'No recent messages found.';
  }

  if (response.code === 'REQUEST_ABORTED') {
    return 'Still loading from Gmail...';
  }

  return failureMessageForResponse(response, fallback);
}

function startColdStartCountdown(onDone, options = {}) {
  clearRetryTimer();
  state.retrySeconds = 60;
  setStateCard('cold-start', COLD_START_MESSAGE, true);
  appendUiActivity({
    source: 'UI',
    level: 'warning',
    stage: 'retry_scheduled',
    message: options.message || 'Automatic retry scheduled while the backend wakes up.',
    details: 'Retrying in about 60 seconds.',
    replaceKey: 'ui-retry-scheduled'
  }).catch(() => {});

  state.retryTimer = setInterval(() => {
    state.retrySeconds -= 1;
    setStateCard('cold-start', COLD_START_MESSAGE, true);

    if (state.retrySeconds <= 0) {
      clearRetryTimer();
      onDone();
    }
  }, 1000);
}

async function loadLegacyMessages(options = {}) {
  setStateCard('loading', 'Connecting to Gmail...');

  const response = await sendWorker('FETCH_MESSAGES', {
    folder: options.folder || 'all',
    limit: 50,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  if (!response?.success) {
    state.lastMailboxTrace = normalizeTraceEntries(response?.trace);
    state.lastMailboxSource = 'mailbox-error';
    state.lastMailboxTimings = normalizeTimings(response?.timings);

    if (options.forceSync && state.mailboxAutoRefresh.inFlight) {
      state.mailboxAutoRefresh.inFlight = false;
      state.mailboxAutoRefresh.failedToFillContent = true;
      state.mailboxAutoRefresh.error = response?.error || response?.code || 'Live mailbox refresh failed.';
      renderThreadDebug(findSelectedGroup());
    }

    if (response.code === 'NOT_CONNECTED') {
      setStateCard('not-connected', 'Not set up yet. Use the setup guide to connect.');
      return;
    }

    if (response.code === 'AUTH_FAILED') {
      setStateCard('auth-failed', 'Connection error. Reconnect your account in setup.');
      return;
    }

    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => loadMessages(options), {
        message: 'Mailbox load is waiting for the backend to wake up.'
      });
      return;
    }

    setStateCard('error', failureMessageForResponse(response, 'Unable to load messages right now.'), true);
    return;
  }

  clearRetryTimer();
  state.mailboxMode = 'legacy';
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  state.lastMailboxTimings = normalizeTimings(response?.timings);
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  if (response.debug) {
    state.lastMailboxDebug = normalizeMailboxDebug(response.debug);
  }
  state.lastMailboxSource = 'legacy';

  if (options.forceSync && state.mailboxAutoRefresh.inFlight) {
    state.mailboxAutoRefresh.inFlight = false;
    state.mailboxAutoRefresh.after = state.lastMailboxDebug || blankMailboxDebug();
    state.mailboxAutoRefresh.failedToFillContent =
      numericValue(state.mailboxAutoRefresh.after?.live?.missingContentCount, 0) > 0;
    state.mailboxAutoRefresh.error = '';
  }

  renderThreads();
  if (options.trackActivity) {
    appendUiActivity({
      source: 'UI',
      level: 'success',
      stage: 'mailbox_rendered',
      message: `Mailbox view rendered with ${response.count || state.messages.length || 0} messages.`,
      details: `Inbox ${response.inboxCount || 0}, Sent ${response.sentCount || 0}.`,
      replaceKey: 'ui-mailbox-rendered'
    }).catch(() => {});
  }

  const cacheDebug = state.lastMailboxDebug?.cache;
  if (
    !options.forceSync &&
    cacheDebug?.used &&
    numericValue(cacheDebug.missingContentCount, 0) > 0 &&
    !state.mailboxAutoRefresh.attempted
  ) {
    state.mailboxAutoRefresh.attempted = true;
    state.mailboxAutoRefresh.inFlight = true;
    state.mailboxAutoRefresh.before = state.lastMailboxDebug;
    state.mailboxAutoRefresh.after = null;
    state.mailboxAutoRefresh.failedToFillContent = false;
    state.mailboxAutoRefresh.error = '';
    renderThreadDebug(findSelectedGroup());

    appendUiActivity({
      source: 'UI',
      level: 'warning',
      stage: 'mailbox_live_refresh_started',
      message: 'Blank cached content detected. Refreshing the mailbox live from Gmail.',
      details: `missing=${cacheDebug.missingContentCount}; coveragePct=${cacheDebug.contentCoveragePct}`
    }).catch(() => {});

    await loadMessages({
      ...options,
      forceSync: true
    });
  }
}

function seedMessagesForThread(threadId) {
  const key = String(threadId || '').trim();
  if (!key) return [];
  return state.messages.filter((message) => threadCounterpartyKey(message) === key);
}

function resolveThreadContactContext(threadId) {
  const summary = findSummaryByThreadId(threadId);
  if (summary) {
    return {
      summary,
      contactEmail: summary.contactEmail || threadIdToContactEmail(threadId)
    };
  }

  const seededMessages = seedMessagesForThread(threadId);
  const seededContactEmail = String(
    seededMessages.find((message) => String(message?.contactEmail || '').trim())?.contactEmail
    || seededMessages.find((message) => !message?.isOutgoing && String(message?.from?.email || '').trim())?.from?.email
    || seededMessages.find((message) => message?.isOutgoing && String(message?.to?.[0]?.email || '').trim())?.to?.[0]?.email
    || threadIdToContactEmail(threadId)
    || ''
  ).trim().toLowerCase();

  return {
    summary: seededMessages.length ? buildContactSummaryFromMessages(threadId, seededMessages) : null,
    contactEmail: seededContactEmail
  };
}

function clearIdleContactPrefetchTimer() {
  if (idleContactPrefetchTimer) {
    window.clearTimeout(idleContactPrefetchTimer);
    idleContactPrefetchTimer = null;
  }
}

function clearAdjacentContactPrefetchTimer() {
  if (adjacentContactPrefetchTimer) {
    window.clearTimeout(adjacentContactPrefetchTimer);
    adjacentContactPrefetchTimer = null;
  }
}

function prefetchableContactGroup(group) {
  if (!group?.threadId || usingLegacyMailboxFlow() || state.mailboxMode === 'search') return false;
  const contactEmail = getGroupContactEmail(group);
  if (!contactEmail) return false;
  if (state.selectedThreadId === group.threadId) return false;
  const loadState = getContactLoadState(group.threadId);
  if (loadState.inFlight || loadState.loaded) return false;
  if (Array.isArray(state.contactMessagesByKey[group.threadId]) && state.contactMessagesByKey[group.threadId].length) {
    return false;
  }
  return true;
}

async function prefetchContactMessages(group, priority = 'P2') {
  if (!prefetchableContactGroup(group)) return null;
  const contactEmail = getGroupContactEmail(group);
  const requestedAt = new Date().toISOString();
  const scope = currentMailboxScope();
  let response;

  try {
    response = await sendWorker('FETCH_CONTACT_MESSAGES', {
      contactEmail,
      contactKey: group.threadId,
      scope,
      pageSize: 5,
      limitPerFolder: 5,
      forceSync: false,
      metadataOnly: true,
      priority,
      userInitiated: false,
      trackActivity: false
    }, {
      timeoutMs: 120000
    });
  } catch (error) {
    pushDebugEvent('contact:prefetch:error', 'Contact prefetch failed', {
      threadId: group.threadId,
      priority,
      code: error?.code || '',
      message: error?.message || String(error)
    }, 'error');
    return null;
  }

  if (!response?.success || state.selectedThreadId === group.threadId) {
    return response;
  }

  if (Array.isArray(response.messages) && response.messages.length) {
    const mergedMessages = storeContactMessages(group.threadId, response.messages);
    upsertContactSummary(buildContactSummaryFromMessages(group.threadId, mergedMessages));
    state.contactLoadStateByKey[group.threadId] = {
      ...getContactLoadState(group.threadId),
      attempted: true,
      loaded: true,
      inFlight: false,
      errorCode: '',
      error: '',
      source: response?.source || 'contact-prefetch',
      count: numericValue(response?.count, mergedMessages.length),
      trace: normalizeTraceEntries(response?.trace),
      timings: normalizeTimings(response?.timings),
      backend: normalizeBuildInfo(response?.debug?.backend),
      schemaFallbackUsed: Boolean(response?.debug?.schemaFallbackUsed),
      richContentSource: String(response?.debug?.richContentSource || response?.source || 'cache').trim() || 'cache',
      cursorResolved: true,
      nextCursor: String(response?.nextCursor || ''),
      hasMore: Boolean(response?.hasMore),
      requestedAt,
      completedAt: new Date().toISOString()
    };
  }

  return response;
}

function adjacentPrefetchCandidates(threadGroups, selectedThreadId, limit = 3) {
  const groups = Array.isArray(threadGroups) ? threadGroups : [];
  const selectedIndex = groups.findIndex((group) => group.threadId === selectedThreadId);
  if (selectedIndex < 0) return [];

  const candidates = [];
  for (let offset = 1; offset < groups.length && candidates.length < limit; offset += 1) {
    const preferredIndexes = [selectedIndex + offset, selectedIndex - offset];
    preferredIndexes.forEach((index) => {
      if (candidates.length >= limit) return;
      const candidate = groups[index];
      if (!candidate || !prefetchableContactGroup(candidate)) return;
      if (candidates.some((group) => group.threadId === candidate.threadId)) return;
      candidates.push(candidate);
    });
  }
  return candidates;
}

function scheduleAdjacentContactPrefetch(threadGroups) {
  clearAdjacentContactPrefetchTimer();
  if (!state.selectedThreadId || usingLegacyMailboxFlow() || state.mailboxMode === 'search') return;
  const candidates = adjacentPrefetchCandidates(threadGroups, state.selectedThreadId, 3);
  if (!candidates.length) return;

  adjacentContactPrefetchTimer = window.setTimeout(() => {
    adjacentContactPrefetchTimer = null;
    candidates.forEach((group) => {
      prefetchContactMessages(group, 'P2').catch(() => {});
    });
  }, 120);
}

function scheduleIdleContactPrefetch(threadGroups = currentThreadGroups()) {
  clearIdleContactPrefetchTimer();
  if (document.hidden || usingLegacyMailboxFlow() || state.mailboxMode === 'search') return;
  const groups = (Array.isArray(threadGroups) ? threadGroups : [])
    .filter((group) => prefetchableContactGroup(group));
  if (!groups.length) return;

  idleContactPrefetchTimer = window.setTimeout(() => {
    idleContactPrefetchTimer = null;
    if (document.hidden || usingLegacyMailboxFlow() || state.mailboxMode === 'search') return;
    groups.forEach((group) => {
      prefetchContactMessages(group, 'P3').catch(() => {});
    });
  }, 2100);
}

function observeRailPagination() {
  disconnectRailPaginationObserver();
  if (!supportsIntersectionObservers() || usingLegacyMailboxFlow() || state.mailboxMode === 'search') return;
  const list = document.getElementById('gmailUnifiedList');
  const tail = list?.querySelector('.gmail-unified-thread-tail-loader');
  if (!list || !tail) return;

  railPaginationObserver = new window.IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    loadMoreMessageSummaries().catch(() => {});
  }, {
    root: list,
    rootMargin: '0px 0px 260px 0px',
    threshold: 0.01
  });

  railPaginationObserver.observe(tail);
}

function observeDetailHistory(threadId) {
  disconnectDetailHistoryObserver();
  if (!supportsIntersectionObservers() || usingLegacyMailboxFlow()) return;
  const body = document.getElementById('gmailUnifiedDetailBody');
  const sentinel = body?.querySelector('.gmail-unified-history-sentinel');
  if (!body || !sentinel || !threadId) return;

  detailHistoryObserver = new window.IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    const loadState = getContactLoadState(threadId);
    if (!loadState.hasMore || loadState.inFlight || !loadState.nextCursor) return;
    loadContactMessagesForThread(threadId, {
      cursor: loadState.nextCursor,
      preserveScroll: true,
      pageSize: CONTACT_PAGE_SIZE
    }).catch(() => {});
  }, {
    root: body,
    rootMargin: '220px 0px 0px 0px',
    threshold: 0.01
  });

  detailHistoryObserver.observe(sentinel);
}

function observeVisibleBodyHydration(threadId) {
  disconnectDetailHydrationObserver();
  if (!supportsIntersectionObservers() || usingLegacyMailboxFlow()) return;
  const body = document.getElementById('gmailUnifiedDetailBody');
  const contactKey = String(threadId || '').trim();
  if (!body || !contactKey || state.selectedThreadId !== contactKey) return;

  const metadataNodes = [...body.querySelectorAll('.gmail-unified-message[data-message-id]')]
    .filter((node) => {
      const messageId = String(node.getAttribute('data-message-id') || '').trim();
      const message = state.contactMessageIndexByKey[contactKey]?.[messageId];
      return Boolean(messageId && message?.contentState === 'metadata');
    });
  if (!metadataNodes.length) return;

  const preloadMargin = Math.max(body.clientHeight, 320);
  detailHydrationObserver = new window.IntersectionObserver((entries) => {
    const messageIds = entries
      .filter((entry) => entry.isIntersecting)
      .map((entry) => String(entry.target?.getAttribute('data-message-id') || '').trim())
      .filter(Boolean);
    if (!messageIds.length) return;
    scheduleVisibleBodyHydration(contactKey, messageIds);
  }, {
    root: body,
    rootMargin: `${preloadMargin}px 0px ${preloadMargin}px 0px`,
    threshold: 0.01
  });

  metadataNodes.forEach((node) => detailHydrationObserver.observe(node));
}

function scheduleVisibleBodyHydration(threadId, messageIds = []) {
  const contactKey = String(threadId || '').trim();
  if (!contactKey) return;
  const pending = pendingHydrationIdsByThread.get(contactKey) || new Set();
  (Array.isArray(messageIds) ? messageIds : []).forEach((messageId) => {
    const normalizedId = String(messageId || '').trim();
    if (normalizedId) pending.add(normalizedId);
  });
  if (pending.size) {
    pendingHydrationIdsByThread.set(contactKey, pending);
  }
  if (visibleBodyHydrationFrame) {
    window.cancelAnimationFrame(visibleBodyHydrationFrame);
  }
  visibleBodyHydrationFrame = window.requestAnimationFrame(() => {
    visibleBodyHydrationFrame = 0;
    const queuedIds = [...(pendingHydrationIdsByThread.get(contactKey) || new Set())];
    pendingHydrationIdsByThread.delete(contactKey);
    hydrateVisibleBodiesForThread(contactKey, queuedIds).catch(() => {});
  });
}

async function hydrateVisibleBodiesForThread(threadId, requestedMessageIds = []) {
  const contactKey = String(threadId || '').trim();
  if (!contactKey || state.selectedThreadId !== contactKey || usingLegacyMailboxFlow()) return null;

  const group = findSelectedGroup();
  if (!group || group.threadId !== contactKey) return null;

  const body = document.getElementById('gmailUnifiedDetailBody');
  if (!body) return null;

  const messages = Array.isArray(state.contactMessagesByKey[contactKey]) ? state.contactMessagesByKey[contactKey] : [];
  if (!messages.length) return null;

  const visibleMetadataMessageIds = (Array.isArray(requestedMessageIds) && requestedMessageIds.length
    ? requestedMessageIds
    : Array.from(body.querySelectorAll('.gmail-unified-message[data-message-id]'))
      .map((node) => String(node.getAttribute('data-message-id') || '').trim())
      .filter(Boolean))
    .map((messageId) => {
      const message = state.contactMessageIndexByKey[contactKey]?.[messageId];
      return message?.contentState === 'metadata' ? messageId : '';
    })
    .filter(Boolean);

  if (!visibleMetadataMessageIds.length) return null;

  const inFlight = hydrationInFlightSet(contactKey);
  const requestIds = [...new Set(visibleMetadataMessageIds)]
    .filter((messageId) => !inFlight?.has(messageId))
    .slice(0, 6);
  if (!requestIds.length) return null;

  requestIds.forEach((messageId) => inFlight?.add(messageId));
  const requestGeneration = currentContactRequestGeneration(contactKey);
  const contactEmail = getGroupContactEmail(group);
  let response;

  try {
    response = await sendWorker('FETCH_CONTACT_BODIES', {
      contactKey,
      contactEmail,
      messageIds: requestIds,
      priority: 'P1',
      userInitiated: false
    }, {
      timeoutMs: 60000
    });
  } catch (error) {
    releaseHydrationMessageIds(contactKey, requestIds);
    return {
      success: false,
      code: error?.code || 'GMAIL_API_ERROR',
      error: error?.message || String(error)
    };
  }

  releaseHydrationMessageIds(contactKey, requestIds);

  if (!response?.success) {
    return response;
  }

  if (!isCurrentContactRequestGeneration(contactKey, requestGeneration) || state.selectedThreadId !== contactKey) {
    return response;
  }

  if (Array.isArray(response.messages) && response.messages.length) {
    storeContactMessages(contactKey, response.messages);
    if (state.selectedThreadId === contactKey && !patchRenderedMessageNodes(contactKey, response.messages.map((message) => message?.id))) {
      scheduleUiCommit({
        detail: true,
        detailThreadId: contactKey,
        preserveDetailScroll: true
      });
    }
  }

  return response;
}

async function loadContactMessagesForThread(threadId, options = {}) {
  if (!threadId || usingLegacyMailboxFlow()) return null;

  const { summary, contactEmail } = resolveThreadContactContext(threadId);
  const existing = getContactLoadState(threadId);
  const existingMessages = state.contactMessagesByKey[threadId] || [];
  const cursor = String(options.cursor || '').trim();
  const preserveScroll = Boolean(options.preserveScroll);
  const scope = options.scope || currentMailboxScope();
  const body = document.getElementById('gmailUnifiedDetailBody');
  const previousScrollTop = preserveScroll && body ? body.scrollTop : 0;
  const previousScrollHeight = preserveScroll && body ? body.scrollHeight : 0;
  const prependAnchor = preserveScroll && cursor ? captureDetailPrependAnchor(body) : null;

  if (!contactEmail && !summary) {
    state.contactLoadStateByKey[threadId] = {
      ...existing,
      attempted: true,
      loaded: false,
      inFlight: false,
      errorCode: 'CONTACT_UNRESOLVED',
      error: 'This conversation does not have a contact email yet.',
      source: 'contact-error',
      completedAt: new Date().toISOString()
    };
    if (state.selectedThreadId === threadId) {
      scheduleUiCommit({
        detail: true,
        detailThreadId: threadId
      });
    }
    return null;
  }

  mLog('contact:cache-read', {
    threadId,
    contactEmail,
    scope,
    cursor,
    cached_message_count: existingMessages.length,
    loaded: Boolean(existing.loaded),
    in_flight: Boolean(existing.inFlight),
    force_sync: Boolean(options.forceSync)
  });

  if (existing.inFlight) return null;
  if (!cursor && existing.loaded && existing.scope === scope && !options.forceSync && existing.cursorResolved) return existingMessages;

  const requestGeneration = numericValue(state.contactRequestGenerationByKey[threadId], 0) + 1;
  state.contactRequestGenerationByKey[threadId] = requestGeneration;

  const requestedAt = new Date().toISOString();
  pushDebugEvent('contact', 'Loading contact messages', {
    threadId,
    contactEmail,
    cursor,
    forceSync: Boolean(options.forceSync),
    preserveScroll
  });
  state.contactLoadStateByKey[threadId] = {
    ...existing,
    attempted: true,
    inFlight: true,
    errorCode: '',
    error: '',
    source: 'contact',
    scope,
    count: numericValue(existing.count, numericValue(summary?.messageCount, existingMessages.length)),
    requestedAt
  };

  if (state.selectedThreadId === threadId) {
    scheduleUiCommit({
      detail: true,
      detailThreadId: threadId
    });
  }

  let response;
  try {
    response = await sendWorker('FETCH_CONTACT_MESSAGES', {
      contactEmail,
      contactKey: threadId,
      scope,
      cursor,
      pageSize: options.pageSize || options.limitPerFolder || CONTACT_PAGE_SIZE,
      limitPerFolder: options.limitPerFolder || options.pageSize || CONTACT_PAGE_SIZE,
      forceSync: Boolean(options.forceSync),
      trackActivity: Boolean(options.trackActivity),
      metadataOnly: options.metadataOnly !== false
    });
  } catch (error) {
    response = {
      success: false,
      code: error?.code || 'GMAIL_API_ERROR',
      error: error?.message || String(error),
      trace: [],
      timings: normalizeTimings(null)
    };
  }

  if (state.contactRequestGenerationByKey[threadId] !== requestGeneration) {
    return response;
  }

  if (response?.success && numericValue(response?.count, Array.isArray(response?.messages) ? response.messages.length : 0) === 0) {
    response = {
      ...response,
      code: 'ZERO_RESULTS'
    };
  }

  const nextState = {
    ...defaultContactLoadState(),
    attempted: true,
    loaded: Boolean(response?.success),
    inFlight: false,
    errorCode: response?.success
      ? (response?.code === 'ZERO_RESULTS' ? 'ZERO_RESULTS' : '')
      : String(response?.code || ''),
    error: response?.success
      ? (response?.code === 'ZERO_RESULTS' ? contactFailureMessage(response) : '')
      : contactFailureMessage(response),
    source: response?.success ? (response?.source || 'contact') : 'contact-error',
    count: numericValue(response?.count, 0),
    trace: normalizeTraceEntries(response?.trace),
    timings: normalizeTimings(response?.timings),
    backend: normalizeBuildInfo(response?.debug?.backend),
    schemaFallbackUsed: Boolean(response?.debug?.schemaFallbackUsed),
    richContentSource: String(response?.debug?.richContentSource || (response?.success ? response?.source || 'cache' : 'cache')).trim() || 'cache',
    cursorResolved: Boolean(response?.success),
    scope,
    nextCursor: String(response?.nextCursor || ''),
    hasMore: Boolean(response?.hasMore),
    requestedAt,
    completedAt: new Date().toISOString()
  };

  if (response?.success && Array.isArray(response?.messages) && response.messages.length) {
    const mergedMessages = storeContactMessages(threadId, response.messages);
    upsertContactSummary(buildContactSummaryFromMessages(threadId, mergedMessages));
  }

  mLog('contact:worker-returned', {
    threadId,
    request_generation: requestGeneration,
    success: Boolean(response?.success),
    code: response?.code || '',
    count: numericValue(response?.count, Array.isArray(response?.messages) ? response.messages.length : 0),
    messages_length: Array.isArray(response?.messages) ? response.messages.length : 0,
    next_cursor: String(response?.nextCursor || ''),
    has_more: Boolean(response?.hasMore),
    source: response?.source || ''
  });

  pushDebugEvent(response?.success ? 'contact' : 'contact:error', response?.success ? 'Contact messages loaded' : 'Contact messages failed', {
    threadId,
    response
  }, response?.success ? 'success' : 'error');

  state.contactLoadStateByKey[threadId] = nextState;

  const rowPatched = response?.success && Array.isArray(response?.messages) && response.messages.length
    ? refreshThreadRow(threadId)
    : false;
  scheduleUiCommit({
    detail: true,
    detailThreadId: threadId,
    preserveDetailScroll: preserveScroll,
    selectionOnly: true,
    rail: !rowPatched && state.mailboxMode !== 'search' && Boolean(response?.success && Array.isArray(response?.messages) && response.messages.length)
  });

  if (preserveScroll && state.selectedThreadId === threadId) {
    window.requestAnimationFrame(() => {
      const currentBody = document.getElementById('gmailUnifiedDetailBody');
      if (!currentBody) return;
      if (prependAnchor && restoreDetailPrependAnchor(currentBody, prependAnchor)) {
        return;
      }
      const delta = currentBody.scrollHeight - previousScrollHeight;
      currentBody.scrollTop = Math.max(0, previousScrollTop + delta);
    });
  }

  return response;
}

async function loadMessageSummaries(options = {}) {
  const append = Boolean(options.append);
  const silent = Boolean(options.silent || append || currentSummaryItems().length > 0);
  const requestedFolder = options.folder || currentMailboxScope();
  const requestedLimit = append
    ? Math.min(20, Math.max(10, Number(options.limit || SUMMARY_APPEND_PAGE_SIZE)))
    : Math.max(Number(options.limit || state.summaryPageSize || 50), 20);
  const requestedCursor = String(options.cursor || '').trim();

  if (append) {
    if (state.summaryAppendInFlight || !state.summaryHasMore) {
      state.summaryLastIgnoredReason = state.summaryAppendInFlight ? 'append_in_flight' : 'append_without_more';
      renderDebugPanel();
      return { success: true, skipped: true, code: 'SUMMARY_APPEND_SKIPPED' };
    }
    state.summaryAppendInFlight = true;
  } else {
    if (state.summaryInitialLoadInFlight) {
      state.summaryLastIgnoredReason = 'initial_in_flight';
      renderDebugPanel();
      return { success: true, skipped: true, code: 'SUMMARY_INITIAL_SKIPPED' };
    }
    state.summaryInitialLoadInFlight = true;
  }

  const requestGeneration = numericValue(state.summaryRequestGeneration, 0) + 1;
  state.summaryRequestGeneration = requestGeneration;
  state.summaryLastRequestId = requestGeneration;

  if (!silent && !currentSummaryItems().length) {
    if (!usingLegacyMailboxFlow() && state.mailboxMode !== 'search') {
      scheduleUiCommit({ rail: true });
    } else {
      setStateCard('loading', 'Loading conversations...');
    }
  }
  pushDebugEvent('mailbox', append ? 'Requesting summary page append' : 'Requesting mailbox summaries', {
    requestGeneration,
    silent,
    append,
    requestedFolder,
    requestedLimit,
    requestedCursor,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  const response = await sendWorker('FETCH_MESSAGE_SUMMARIES', {
    folder: requestedFolder,
    limit: requestedLimit,
    cursor: requestedCursor,
    append,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  const workerCount = numericValue(response?.count, Array.isArray(response?.summaries) ? response.summaries.length : 0);
  const loadedCount = numericValue(response?.loadedCount, 0);
  const normalizedSummaries = Array.isArray(response?.summaries)
    ? response.summaries.map(normalizeContactSummary).filter((summary) => summary.contactKey)
    : [];
  state.summaryWorkerCount = workerCount;
  state.summaryLoadedCount = loadedCount;
  state.summaryNormalizedCount = normalizedSummaries.length;

  if (state.summaryRequestGeneration !== requestGeneration) {
    if (append) {
      state.summaryAppendInFlight = false;
    } else {
      state.summaryInitialLoadInFlight = false;
    }
    state.summaryLastIgnoredReason = `stale_response_${append ? 'append' : 'replace'}_${requestGeneration}`;
    pushDebugEvent('mailbox', 'Ignored stale summary response', {
      requestGeneration,
      activeGeneration: state.summaryRequestGeneration,
      append,
      workerCount,
      normalizedCount: normalizedSummaries.length
    }, 'error');
    renderDebugPanel();
    return response;
  }

  if (!response?.success) {
    if (append) {
      state.summaryAppendInFlight = false;
    } else {
      state.summaryInitialLoadInFlight = false;
    }
    state.lastMailboxTrace = normalizeTraceEntries(response?.trace);
    state.lastMailboxSource = 'summary-error';
    state.lastMailboxTimings = normalizeTimings(response?.timings);

    if (silent && currentSummaryItems().length) {
      renderSettingsUi();
      renderDebugPanel();
      return response;
    }

    if (response.code === 'NOT_CONNECTED') {
      setStateCard('not-connected', 'Not set up yet. Use the setup guide to connect.');
      return response;
    }

    if (response.code === 'AUTH_FAILED') {
      setStateCard('auth-failed', 'Connection error. Reconnect your account in setup.');
      return response;
    }

    if (response.code === 'OAUTH_NOT_CONFIGURED') {
      setStateCard('auth-failed', 'OAuth is not configured in manifest.json yet. Add the Google client ID, then reconnect.');
      return response;
    }

    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => loadMessages(options), {
        message: 'Mailbox summary load is waiting for the backend to wake up.'
      });
      return response;
    }

    setStateCard('error', failureMessageForResponse(response, 'Unable to load conversations right now.'), true);
    return response;
  }

  clearRetryTimer();
  state.mailboxMode = 'summary';
  state.useLegacyMailboxFallback = false;
  state.summaryPageSize = requestedLimit;
  state.summaryCursor = String(response?.nextCursor || '');
  state.summaryHasMore = Boolean(response?.hasMore);
  state.summaryAppliedGeneration = requestGeneration;
  state.summaryLastIgnoredReason = '';
  if (append) {
    state.summaryAppendInFlight = false;
  } else {
    state.summaryInitialLoadInFlight = false;
    state.messages = [];
    state.mailboxAutoRefresh = {
      attempted: false,
      inFlight: false,
      before: null,
      after: null,
      failedToFillContent: false,
      error: ''
    };
  }
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  state.lastMailboxSource = 'summary';
  state.lastMailboxTimings = normalizeTimings(response?.timings);
  state.lastMailboxDebug = normalizeMailboxDebug(response?.debug);

  if (workerCount > 0 && normalizedSummaries.length === 0) {
    state.summaryLastIgnoredReason = 'normalized_zero_from_nonzero_worker_count';
    pushDebugEvent('mailbox:error', 'Summary normalization dropped all worker rows', {
      requestGeneration,
      workerCount,
      response
    }, 'error');
    if (!currentSummaryItems().length) {
      setStateCard('error', 'Mailita received conversations from Gmail, but none could be rendered.', true);
      renderDebugPanel();
      return {
        success: false,
        code: 'SUMMARY_RENDER_INVALID',
        error: 'No summaries survived normalization.'
      };
    }
    renderDebugPanel();
    return {
      success: true,
      skipped: true,
      count: workerCount,
      loadedCount,
      nextCursor: state.summaryCursor,
      hasMore: state.summaryHasMore,
      source: response?.source || 'summary'
    };
  }

  if (!append && normalizedSummaries.length === 0 && currentSummaryItems().length > 0) {
    state.summaryLastIgnoredReason = 'empty_replace_preserved_existing_rows';
    pushDebugEvent('mailbox', 'Ignored empty summary replace to preserve visible rows', {
      requestGeneration,
      workerCount,
      renderedCount: currentSummaryItems().length
    }, 'error');
    renderDebugPanel();
    return {
      success: true,
      skipped: true,
      count: workerCount,
      loadedCount,
      nextCursor: state.summaryCursor,
      hasMore: state.summaryHasMore,
      source: response?.source || 'summary'
    };
  }

  const nextSummaryItems = append
    ? mergeSummaryItems(currentSummaryItems(), normalizedSummaries)
    : normalizedSummaries;
  replaceSummaryItems(nextSummaryItems);

  if (state.selectedThreadId && !findSummaryByThreadId(state.selectedThreadId)) {
    state.selectedThreadId = '';
    state.detailLastThreadId = '';
    state.detailSnapToLatestThreadId = '';
    state.composer = defaultComposerState();
  }

  if (state.connected) {
    state.shellUnlocked = true;
    state.guideReviewOpen = false;
    applyGmailLayoutMode();
  }

  renderThreads();
  state.summaryRenderedCount = currentThreadGroups().length;

  pushDebugEvent('mailbox', append ? 'Applied summary append' : 'Applied summary replace', {
    requestGeneration,
    workerCount,
    normalizedCount: normalizedSummaries.length,
    renderedCount: state.summaryRenderedCount,
    loadedCount,
    nextCursor: state.summaryCursor,
    hasMore: state.summaryHasMore
  }, 'success');

  if (options.trackActivity) {
    appendUiActivity({
      source: 'UI',
      level: 'success',
      stage: 'mailbox_summary_rendered',
      message: `Mailbox summary view rendered with ${state.summaryRenderedCount || workerCount || currentSummaryItems().length || 0} people.`,
      details: `Source ${response.source || 'unknown'}; nextCursor=${state.summaryCursor || 'none'}; hasMore=${state.summaryHasMore}.`
    }).catch(() => {});
  }

  renderDebugPanel();
  return response;
}

async function loadMoreMessageSummaries() {
  if (usingLegacyMailboxFlow() || state.mailboxMode === 'search') return null;
  if (state.summaryAppendInFlight || !state.summaryHasMore || !state.summaryCursor) return null;

  const currentList = document.getElementById('gmailUnifiedList');
  const previousScrollTop = currentList?.scrollTop || 0;
  const appendLimit = Math.min(20, Math.max(10, SUMMARY_APPEND_PAGE_SIZE));
  pushDebugEvent('mailbox', 'Requesting next summary page', {
    limit: appendLimit,
    cursor: state.summaryCursor
  });

  const response = await loadMessageSummaries({
    silent: true,
    forceSync: false,
    append: true,
    cursor: state.summaryCursor,
    limit: appendLimit
  });

  if (currentList) {
    window.requestAnimationFrame(() => {
      currentList.scrollTop = previousScrollTop;
    });
  }

  pushDebugEvent(response?.success ? 'mailbox' : 'mailbox:error', response?.success ? 'Next summary page loaded' : 'Next summary page failed', {
    cursor: state.summaryCursor,
    response
  }, response?.success ? 'success' : 'error');
  return response;
}

async function loadMessages(options = {}) {
  pushDebugEvent('mailbox', 'loadMessages entered', {
    options,
    useLegacyMailboxFallback: state.useLegacyMailboxFallback,
    mailboxMode: state.mailboxMode
  });
  if (state.useLegacyMailboxFallback && !options.forceSectionedRetry) {
    pushDebugEvent('mailbox', 'Using legacy mailbox fallback');
    return loadLegacyMessages(options);
  }

  const summaryResponse = await loadMessageSummaries(options);
  if (summaryResponse?.success) {
    pushDebugEvent('mailbox', 'loadMessages resolved via summaries', {
      count: summaryResponse.count,
      source: summaryResponse.source
    }, 'success');
    return summaryResponse;
  }

  if (
    options.allowLegacyFallback === false
    || summaryResponse?.code === 'NOT_CONNECTED'
    || summaryResponse?.code === 'AUTH_FAILED'
    || summaryResponse?.code === 'OAUTH_NOT_CONFIGURED'
    || summaryResponse?.code === 'BACKEND_COLD_START'
  ) {
    return summaryResponse;
  }

  const fallbackResponse = await loadLegacyMessages(options);
  if (fallbackResponse?.success) {
    pushDebugEvent('mailbox', 'Summary load failed; switched to legacy fallback', summaryResponse, 'error');
    state.useLegacyMailboxFallback = true;
    resetSectionedMailboxCaches();
  }
  return fallbackResponse;
}

async function loadSummaryBootstrap(options = {}) {
  if (!state.connected || state.connectInFlight || usingLegacyMailboxFlow() || state.mailboxMode === 'search') {
    return { success: true, skipped: true, code: 'SUMMARY_BOOTSTRAP_NOT_APPLICABLE' };
  }
  if (currentSummaryItems().length || state.summaryBootstrapInFlight || state.summaryInitialLoadInFlight) {
    return { success: true, skipped: true, code: 'SUMMARY_BOOTSTRAP_SKIPPED' };
  }

  state.summaryBootstrapInFlight = true;
  scheduleUiCommit({ rail: true });

  let response;
  try {
    response = await sendWorker('FETCH_MESSAGE_SUMMARIES', {
      folder: options.folder || currentMailboxScope(),
      limit: Math.max(Number(options.limit || state.summaryPageSize || 50), 20),
      cursor: '',
      append: false,
      forceSync: false,
      bootstrapCacheOnly: true,
      trackActivity: false
    });
  } finally {
    state.summaryBootstrapInFlight = false;
  }

  if (!response?.success) {
    scheduleUiCommit({ rail: true });
    return response;
  }

  const normalizedSummaries = Array.isArray(response?.summaries)
    ? response.summaries.map(normalizeContactSummary).filter((summary) => summary.contactKey)
    : [];

  if (normalizedSummaries.length) {
    replaceSummaryItems(normalizedSummaries);
    state.summaryCursor = String(response?.nextCursor || state.summaryCursor || '');
    state.summaryHasMore = Boolean(response?.hasMore || state.summaryHasMore);
    state.summaryLoadedCount = numericValue(response?.loadedCount, normalizedSummaries.length);
    state.summaryWorkerCount = numericValue(response?.count, normalizedSummaries.length);
    state.summaryNormalizedCount = normalizedSummaries.length;
  }

  scheduleUiCommit({ rail: true, selectionOnly: true });
  return response;
}

function queueBackgroundMailboxPrime(options = {}) {
  window.requestAnimationFrame(() => {
    window.setTimeout(() => {
      primeMailboxInBackground({
        allowLegacyFallback: false,
        forceVisibleRefresh: true,
        limit: Math.max(Number(options.limit || state.summaryPageSize || 50), 20)
      }).catch(() => {});
      window.setTimeout(() => {
        sendWorker('SYNC_MESSAGES', { trackActivity: false }).catch(() => {});
      }, currentSummaryItems().length ? 600 : 0);
      startAutoRefresh();
    }, 0);
  });
}

function primeMailboxInBackground(options = {}) {
  if (state.summaryInitialLoadInFlight || (currentSummaryItems().length && !options.forceVisibleRefresh)) {
    return Promise.resolve({
      success: true,
      source: state.lastMailboxSource || 'summary',
      summaries: currentSummaryItems(),
      count: currentSummaryItems().length,
      nextCursor: state.summaryCursor,
      hasMore: state.summaryHasMore,
      skipped: true
    });
  }
  const run = async () => {
    const response = await loadMessages({
      allowLegacyFallback: false,
      ...options
    });
    if (!response?.success) {
      pushDebugEvent('mailbox:error', 'Background mailbox load failed', response, 'error');
      if (!currentSummaryItems().length && !state.messages.length) {
        const errorMessage = failureMessageForResponse(response, 'Unable to load conversations right now.');
        setStateCard('error', errorMessage, true);
        setConnectUiState(`Connected, but mailbox loading failed. ${errorMessage}`, true);
      }
      return response;
    }

    pushDebugEvent('mailbox', 'Background mailbox load completed', {
      summaries: currentSummaryItems().length,
      messages: state.messages.length,
      source: response.source
    }, 'success');
    setConnectUiState('');
    startAutoRefresh();
    return response;
  };

  return run().catch((error) => {
    const message = error?.message || String(error);
    pushDebugEvent('mailbox:error', 'Background mailbox load crashed', { message }, 'error');
    if (!currentSummaryItems().length && !state.messages.length) {
      setStateCard('error', 'Unable to load conversations right now.', true);
      setConnectUiState(`Connected, but mailbox loading failed. ${message}`, true);
    }
    return {
      success: false,
      code: error?.code || 'MAILBOX_LOAD_FAILED',
      error: message
    };
  });
}

function ensureInitialSummaryLoad(options = {}) {
  const force = Boolean(options.force);
  const limit = Math.max(Number(options.limit || state.summaryPageSize || 50), 20);

  if (!state.connected || state.connectInFlight || usingLegacyMailboxFlow() || state.mailboxMode === 'search') {
    return Promise.resolve({ success: true, skipped: true, code: 'SUMMARY_BOOTSTRAP_NOT_APPLICABLE' });
  }

  if (state.summaryInitialLoadInFlight || state.summaryAppendInFlight) {
    return Promise.resolve({ success: true, skipped: true, code: 'SUMMARY_BOOTSTRAP_IN_FLIGHT' });
  }

  if (currentSummaryItems().length) {
    return Promise.resolve({ success: true, skipped: true, code: 'SUMMARY_BOOTSTRAP_ALREADY_RENDERED' });
  }

  if (!force && numericValue(state.summaryAppliedGeneration, 0) > 0) {
    return Promise.resolve({ success: true, skipped: true, code: 'SUMMARY_BOOTSTRAP_ALREADY_APPLIED' });
  }

  return primeMailboxInBackground({
    ...options,
    allowLegacyFallback: false,
    limit
  });
}

function setFilter(filter) {
  state.filter = filter;

  const buttons = document.querySelectorAll('.gmail-unified-filter-btn');
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });

  renderThreads();
  if (!usingLegacyMailboxFlow()) {
    loadMessageSummaries({
      folder: currentMailboxScope(),
      silent: true,
      forceSync: false,
      trackActivity: false
    }).catch(() => {});
  }
  if (state.selectedThreadId && !usingLegacyMailboxFlow()) {
    const loadState = getContactLoadState(state.selectedThreadId);
    if (!loadState.loaded || loadState.scope !== currentMailboxScope()) {
      loadContactMessagesForThread(state.selectedThreadId, {
        pageSize: CONTACT_PAGE_SIZE,
        scope: currentMailboxScope()
      }).catch(() => {});
    }
  }
}

let searchLocalDebounce = null;
let searchRemoteDebounce = null;

function applyLocalSearch(query) {
  const trimmed = String(query || '').trim();
  state.searchQuery = trimmed;

  if (!trimmed) {
    clearRetryTimer();
    state.searchMessageResults = [];
    state.searchMessageResultsInFlight = false;
    state.searchMessageError = '';
    state.messages = [];
    state.mailboxMode = state.useLegacyMailboxFallback ? 'legacy' : 'summary';
    renderThreads();
    if (state.connected && !usingLegacyMailboxFlow() && !currentSummaryItems().length) {
      ensureInitialSummaryLoad({
        limit: state.summaryPageSize || 50
      }).catch(() => {});
    }
    return;
  }

  state.mailboxMode = 'search';
  state.searchMessageResults = [];
  state.searchMessageResultsInFlight = false;
  state.searchMessageError = '';
  state.messages = [];
  renderThreads();
}

async function runRemoteSearch(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    return {
      success: true,
      skipped: true,
      code: 'SEARCH_CLEARED'
    };
  }

  const requestGeneration = numericValue(state.searchRequestGeneration, 0) + 1;
  state.searchRequestGeneration = requestGeneration;
  state.searchMessageResultsInFlight = true;
  state.searchMessageError = '';
  renderThreads();

  const response = await sendWorker('SEARCH_MESSAGES', {
    query: trimmed,
    limit: 20,
    trackActivity: !state.connected || state.guideReviewOpen
  });

  if (state.searchRequestGeneration !== requestGeneration || state.searchQuery !== trimmed) {
    return response;
  }

  if (!response?.success) {
    pushDebugEvent('mailbox', 'Mailbox summaries failed', response, 'error');
    state.lastMailboxTrace = normalizeTraceEntries(response?.trace);
    state.lastMailboxSource = 'search-error';
    state.lastMailboxTimings = normalizeTimings(response?.timings);
    state.searchMessageResultsInFlight = false;
    state.searchMessageResults = [];
    state.messages = [];
    state.searchMessageError = failureMessageForResponse(response, 'Search failed.');
    renderThreads();
    return response;
  }

  clearRetryTimer();
  pushDebugEvent('mailbox', 'Mailbox summaries loaded', {
    source: response.source,
    count: response.count,
    timings: response.timings
  }, 'success');
  state.mailboxMode = 'search';
  state.searchMessageResultsInFlight = false;
  state.searchMessageError = '';
  state.searchMessageResults = Array.isArray(response.messages) ? response.messages : [];
  state.messages = [...state.searchMessageResults];
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  state.lastMailboxSource = response.source || 'search';
  state.lastMailboxTimings = normalizeTimings(response?.timings);
  groupByThread(state.searchMessageResults).forEach((group) => {
    storeContactMessages(group.threadId, group.messages);
  });
  renderThreads();
  return response;
}

function updateGuideProgressUI() {
  const guide = normalizeGuideState(state.guideState);
  const guideStepForUi = resolvedGuideStepForUi(guide);
  const progressText = document.getElementById('gmailUnifiedGuideProgressText');
  if (progressText) {
    progressText.textContent = guide.connected
      ? 'Connected with Google'
      : 'Connect Gmail with Google OAuth';
  }

  const progressBar = document.getElementById('gmailUnifiedGuideProgressBar');
  const width = `${Math.max(0, Math.min(100, (guide.progress / Math.max(1, guide.total)) * 100))}%`;
  if (progressBar) progressBar.style.width = width;

  const guideCounter = document.getElementById('gmailUnifiedGuideCounterBadge');
  if (guideCounter) {
    guideCounter.textContent = guide.connected ? 'Ready' : 'Setup';
  }

  const stepNodes = document.querySelectorAll('.gmail-unified-guide-slide');
  stepNodes.forEach((node) => {
    const stepKey = String(node.dataset.step || '');
    node.classList.toggle('active', stepKey === guideStepForUi);
  });

  const connectBody = document.getElementById('gmailUnifiedConnectBody');
  if (connectBody) {
    const copy = GUIDE_SUBSTEP_COPY.connect_account[guide.substep]
      || GUIDE_SUBSTEP_COPY.connect_account.connect_ready;
    connectBody.textContent = copy.body;
  }

  const contextChip = document.getElementById('gmailUnifiedGuideContext');
  if (contextChip) {
    contextChip.textContent = `Current page: ${friendlyContextLabel(guide.currentContext || currentPageContext())}`;
  }

  renderActivityPanel();
}

async function refreshGuideAndAuthState() {
  pushDebugEvent('flow', 'Refreshing guide/auth state');
  const [storageResult, guideResult, uiSettingsResult] = await Promise.allSettled([
    sendWorker('GET_STORAGE'),
    sendWorker('GUIDE_GET_STATE'),
    readUiSettings()
  ]);
  const storage = storageResult.status === 'fulfilled' ? storageResult.value : null;
  const guide = guideResult.status === 'fulfilled' ? guideResult.value : null;
  const uiSettings = uiSettingsResult.status === 'fulfilled' ? uiSettingsResult.value : null;

  if (storageResult.status === 'rejected') {
    pushDebugEvent('flow:error', 'GET_STORAGE failed during refresh', {
      message: storageResult.reason?.message || String(storageResult.reason)
    }, 'error');
  }
  if (guideResult.status === 'rejected') {
    pushDebugEvent('flow:error', 'GUIDE_GET_STATE failed during refresh', {
      message: guideResult.reason?.message || String(guideResult.reason)
    }, 'error');
  }
  if (uiSettingsResult.status === 'rejected') {
    pushDebugEvent('flow:error', 'readUiSettings failed during refresh', {
      message: uiSettingsResult.reason?.message || String(uiSettingsResult.reason)
    }, 'error');
  }

  const storageKnown = storageResult.status === 'fulfilled' && Boolean(storage?.success);
  const storageConnected = Boolean(storageKnown && storage.connected);
  const explicitDisconnect = Boolean(
    storageKnown
      && !storageConnected
      && !String(storage?.accountEmail || storage?.userEmail || '').trim()
      && !state.connectInFlight
  );
  const preserveUnlockedShell = Boolean(
    (state.connected || state.shellUnlocked)
      && !storageConnected
      && !explicitDisconnect
  );
  state.connected = storageConnected || preserveUnlockedShell || (state.connectInFlight && state.connected);
  if (storageConnected) {
    state.shellUnlocked = true;
    state.guideReviewOpen = false;
  }
  state.guideState = normalizeGuideState(guide?.success ? guide.guideState : state.guideState);
  state.setupDiagnostics = normalizeSetupDiagnostics(storageKnown ? storage?.setupDiagnostics : state.setupDiagnostics);
  state.uiSettings = normalizeUiSettings(uiSettings);
  state.accountSnapshot = {
    connected: storageConnected || preserveUnlockedShell || (state.connectInFlight && state.accountSnapshot.connected),
    accountEmail: storageKnown
      ? (storage?.accountEmail || storage?.userEmail || ((preserveUnlockedShell || state.connectInFlight) ? state.accountSnapshot.accountEmail : ''))
      : state.accountSnapshot.accountEmail,
    mailSource: storageKnown
      ? (storage?.mailSource || state.accountSnapshot.mailSource || 'gmail_api_local')
      : (state.accountSnapshot.mailSource || 'gmail_api_local'),
    lastSyncTime: storageKnown
      ? (storage?.lastSyncTime || state.accountSnapshot.lastSyncTime || '')
      : state.accountSnapshot.lastSyncTime,
    onboardingComplete: storageKnown
      ? Boolean(storage?.onboardingComplete)
      : Boolean(state.accountSnapshot.onboardingComplete)
  };

  if (explicitDisconnect) {
    clearCampaignBlastDelay();
    campaignBlastRunToken += 1;
    state.shellUnlocked = false;
    state.selectedThreadId = '';
    state.detailLastThreadId = '';
    state.detailSnapToLatestThreadId = '';
    state.settingsOpen = false;
    state.composer = defaultComposerState();
    state.composeOverlay = defaultComposeOverlayState();
    state.campaignMode = defaultCampaignModeState();
    state.mailboxMode = 'summary';
    state.useLegacyMailboxFallback = false;
    state.messages = [];
    state.lastMailboxTimings = normalizeTimings(null);
    resetSectionedMailboxCaches();
  }

  pushDebugEvent('flow', 'Guide/auth state refreshed', {
    storageKnown,
    storageConnected,
    explicitDisconnect,
    preserveUnlockedShell,
    connected: state.connected,
    accountSnapshot: state.accountSnapshot
  }, state.connected ? 'success' : 'info');
  renderDebugPanel();

  return { storage, guide: state.guideState };
}

async function guideConfirm(step, payload = {}) {
  if (!GUIDE_STEP_SET.has(step)) return;
  const response = await sendWorker('GUIDE_CONFIRM_STEP', { step, ...payload });
  if (response?.success && response.guideState) {
    state.guideState = normalizeGuideState(response.guideState);
    return;
  }
  await refreshGuideAndAuthState();
}

function applyGmailLayoutMode() {
  const sidebar = document.getElementById('gmailUnifiedSidebar');
  const shell = document.getElementById('gmailUnifiedShell');
  const onboardingOverlay = document.getElementById('gmailUnifiedOnboardingOverlay');
  const guideClose = document.getElementById('gmailUnifiedGuideCloseBtn');

  if (!sidebar || !shell || !onboardingOverlay) return;

  document.body.classList.add('gmail-unified-fullscreen');
  sidebar.classList.toggle('gmail-unified-locked', !state.connected);
  sidebar.dataset.detailOpen = state.selectedThreadId ? 'true' : 'false';
  if (!state.connected) {
    state.settingsOpen = false;
  }
  if (!CAMPAIGN_MODE_ENABLED && (state.campaignMode.active || state.campaignMode.exitedToBackground || campaignRunActive())) {
    clearCampaignBlastDelay();
    campaignBlastRunToken += 1;
    state.campaignMode = defaultCampaignModeState();
  }
  applyThemeSettings();

  const shellAccessible = state.connected || state.shellUnlocked;
  const showGuide = !shellAccessible || state.guideReviewOpen;
  shell.hidden = !shellAccessible;
  onboardingOverlay.hidden = !showGuide;
  shell.style.display = shellAccessible ? '' : 'none';
  onboardingOverlay.style.display = showGuide ? 'grid' : 'none';
  shell.setAttribute('aria-hidden', state.campaignMode.active ? 'true' : 'false');
  if (guideClose) guideClose.hidden = !state.connected || !state.guideReviewOpen;

  updateGuideProgressUI();
  renderSettingsUi();
  renderComposeOverlay();
  if (CAMPAIGN_MODE_ENABLED) {
    renderCampaignMode();
    renderCampaignBanner();
  }
  updateMainPanelVisibility();
}

function mapConnectError(response) {
  if (response?.code === 'OAUTH_NOT_CONFIGURED') {
    return 'Mailita OAuth is not configured yet. Add the Google client ID in the extension manifest first.';
  }

  if (response?.code === 'AUTH_FAILED') {
    return 'Google sign-in did not complete. Try connecting again.';
  }

  if (response?.code === 'BACKEND_COLD_START') {
    return 'Mailita is refreshing Gmail in the background. Please wait a moment and try again.';
  }

  return response?.error || 'Google connection failed. Please try again.';
}

function setConnectUiState(status, error = false) {
  const statusNode = document.getElementById('gmailUnifiedConnectStatus');
  if (!statusNode) return;

  statusNode.textContent = status || '';
  statusNode.classList.toggle('is-error', Boolean(error));
  statusNode.classList.toggle('is-success', !error && Boolean(status));
  pushDebugEvent('ui', 'Connect status updated', { status, error }, error ? 'error' : 'info');
}

function bindGuideEvents(sidebar) {
  sidebar.querySelector('#gmailUnifiedGuideCloseBtn')?.addEventListener('click', () => {
    state.guideReviewOpen = false;
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedConnectBtn')?.addEventListener('click', async () => {
    await connectFromGuide();
  });

  sidebar.querySelectorAll('.gmail-unified-filter-btn').forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  const searchInput = sidebar.querySelector('#gmailUnifiedSearchInput');
  searchInput?.addEventListener('input', (event) => {
    scheduleIdleContactPrefetch([]);
    clearTimeout(searchLocalDebounce);
    clearTimeout(searchRemoteDebounce);
    const value = event.target.value;
    searchLocalDebounce = setTimeout(() => {
      applyLocalSearch(value);
    }, 200);
    searchRemoteDebounce = setTimeout(() => {
      runRemoteSearch(value).catch(() => {});
    }, 400);
  });

  sidebar.querySelector('#gmailUnifiedRetryBtn')?.addEventListener('click', () => {
    loadMessages({
      forceSync: false,
      trackActivity: true,
      limit: state.summaryPageSize || 50,
      allowLegacyFallback: false
    });
  });

  if (!supportsIntersectionObservers()) {
    const handleListScroll = throttle(() => {
      scheduleIdleContactPrefetch();
      if (usingLegacyMailboxFlow() || state.mailboxMode === 'search') return;
      const list = document.getElementById('gmailUnifiedList');
      if (!list) return;
      const nearBottom = (list.scrollHeight - list.scrollTop - list.clientHeight) <= SUMMARY_APPEND_TRIGGER_PX;
      if (!nearBottom) return;
      loadMoreMessageSummaries().catch(() => {});
    }, 100);
    sidebar.querySelector('#gmailUnifiedList')?.addEventListener('scroll', handleListScroll, { passive: true });
  }

  sidebar.querySelector('#gmailUnifiedBackBtn')?.addEventListener('click', () => {
    state.selectedThreadId = '';
    state.detailLastThreadId = '';
    state.detailSnapToLatestThreadId = '';
    state.composer = defaultComposerState();
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
    renderThreadDebug(null);
    renderThreads();
    updateMainPanelVisibility();
  });

  const settingsButton = sidebar.querySelector('#gmailUnifiedSettingsBtn');
  const settingsPanel = sidebar.querySelector('#gmailUnifiedSettingsPanel');

  settingsButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    state.settingsOpen = !state.settingsOpen;
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedSettingsCloseBtn')?.addEventListener('click', () => {
    state.settingsOpen = false;
    applyGmailLayoutMode();
  });

  sidebar.querySelectorAll('.gmail-unified-theme-option[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', async () => {
      await persistUiSettings({
        ...state.uiSettings,
        themeMode: button.dataset.themeMode
      });
      applyGmailLayoutMode();
    });
  });

  sidebar.querySelector('#gmailUnifiedSettingsDisconnectBtn')?.addEventListener('click', async () => {
    const response = await sendWorker('DISCONNECT_GOOGLE');
    if (!response?.success) return;
    clearCampaignBlastDelay();
    campaignBlastRunToken += 1;
    state.shellUnlocked = false;
    state.messages = [];
    state.searchMessageResults = [];
    state.searchMessageResultsInFlight = false;
    state.searchMessageError = '';
    resetSectionedMailboxCaches();
    state.selectedThreadId = '';
    state.detailLastThreadId = '';
    state.detailSnapToLatestThreadId = '';
    state.composer = defaultComposerState();
    state.composeOverlay = defaultComposeOverlayState();
    state.campaignMode = defaultCampaignModeState();
    state.useLegacyMailboxFallback = false;
    state.mailboxMode = 'summary';
    state.settingsOpen = false;
    await refreshGuideAndAuthState();
    applyGmailLayoutMode();
    renderThreads();
    renderThreadDebug(null);
    renderComposeOverlay();
  });

  sidebar.querySelector('#gmailUnifiedComposeBtn')?.addEventListener('click', () => {
    openComposeOverlay();
  });

  sidebar.querySelector('#gmailUnifiedComposeCloseBtn')?.addEventListener('click', () => {
    closeComposeOverlay();
  });

  sidebar.querySelector('#gmailUnifiedComposeCancelBtn')?.addEventListener('click', () => {
    closeComposeOverlay();
  });

  sidebar.querySelector('#gmailUnifiedComposeTo')?.addEventListener('input', (event) => {
    state.composeOverlay.to = event.target.value;
    state.composeOverlay.sendError = '';
    state.composeOverlay.sendStatus = '';
  });

  sidebar.querySelector('#gmailUnifiedComposeSubject')?.addEventListener('input', (event) => {
    state.composeOverlay.subject = event.target.value;
    state.composeOverlay.sendError = '';
    state.composeOverlay.sendStatus = '';
  });

  sidebar.querySelector('#gmailUnifiedComposeBody')?.addEventListener('input', (event) => {
    state.composeOverlay.body = event.target.value;
    state.composeOverlay.sendError = '';
    state.composeOverlay.sendStatus = '';
  });

  sidebar.querySelector('#gmailUnifiedComposeBody')?.addEventListener('keydown', async (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      await submitComposeOverlay();
    }
    if (event.key === 'Escape') {
      closeComposeOverlay();
    }
  });

  sidebar.querySelector('#gmailUnifiedComposeSend')?.addEventListener('click', async () => {
    await submitComposeOverlay();
  });

  if (CAMPAIGN_MODE_ENABLED) {
    sidebar.querySelector('#gmailUnifiedComposeCampaignBtn')?.addEventListener('click', () => {
      openCampaignModeFromCompose();
    });
  }

  sidebar.querySelector('#gmailUnifiedComposerReply')?.addEventListener('click', () => {
    setComposerMode('reply');
  });

  sidebar.querySelector('#gmailUnifiedComposerReplyAll')?.addEventListener('click', () => {
    setComposerMode('reply_all');
  });

  sidebar.querySelector('#gmailUnifiedComposerInput')?.addEventListener('input', (event) => {
    state.composer.draft = event.target.value;
  });

  sidebar.querySelector('#gmailUnifiedComposerInput')?.addEventListener('keydown', async (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      await submitThreadReply(findSelectedGroup());
    }
  });

  sidebar.querySelector('#gmailUnifiedComposerSend')?.addEventListener('click', async () => {
    await submitThreadReply(findSelectedGroup());
  });

  if (CAMPAIGN_MODE_ENABLED) {
    sidebar.querySelector('#gmailUnifiedCampaignDataPane')?.addEventListener('paste', (event) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const rawText = event.clipboardData?.getData('text/plain') || '';
      if (!String(rawText || '').trim()) return;
      event.preventDefault();
      const dataset = buildCampaignDatasetFromText(rawText);
      replaceCampaignDataset(dataset.headers, dataset.rows);
      renderCampaignMode({ syncInputs: true, fullTable: true });
      renderCampaignBanner();
    });

    sidebar.querySelector('#gmailUnifiedCampaignOverlay')?.addEventListener('input', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement)) return;

      if (target.id === 'gmailUnifiedCampaignSubject') {
        state.campaignMode.subjectTemplate = target.value;
        applyCampaignValidation();
        renderCampaignMode();
        renderCampaignBanner();
        return;
      }

      if (target.id === 'gmailUnifiedCampaignBody') {
        state.campaignMode.bodyTemplate = target.value;
        applyCampaignValidation();
        renderCampaignMode();
        renderCampaignBanner();
        return;
      }

      if (target.dataset.campaignHeaderIndex != null) {
        updateCampaignHeader(Number(target.dataset.campaignHeaderIndex), target.value, {
          selectionStart: target.selectionStart,
          selectionEnd: target.selectionEnd
        });
        return;
      }

      if (target.dataset.campaignRowId && target.dataset.campaignCellIndex != null) {
        updateCampaignCell(target.dataset.campaignRowId, Number(target.dataset.campaignCellIndex), target.value, {
          selectionStart: target.selectionStart,
          selectionEnd: target.selectionEnd
        });
      }
    });

    sidebar.querySelector('#gmailUnifiedCampaignOverlay')?.addEventListener('click', async (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!(button instanceof HTMLButtonElement)) return;

      if (button.id === 'gmailUnifiedCampaignCloseBtn') {
        closeCampaignMode({
          background: campaignRunActive()
        });
        return;
      }

      if (button.id === 'gmailUnifiedCampaignModeReview') {
        if (campaignRunActive()) return;
        state.campaignMode.mode = 'review';
        renderCampaignMode();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignModeBlast') {
        if (campaignRunActive()) return;
        state.campaignMode.mode = 'blast';
        renderCampaignMode();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignStartReview') {
        await startCampaignReview();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignStartBlast') {
        await startCampaignBlast();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignReviewSend') {
        await sendCurrentCampaignReviewRow();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignReviewSkip') {
        skipCampaignReviewRow();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignBlastStop') {
        await stopCampaignBlast();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignAddRow') {
        addCampaignRow();
        return;
      }

      if (button.dataset.campaignDeleteRow) {
        deleteCampaignRow(button.dataset.campaignDeleteRow);
      }
    });

    sidebar.querySelector('#gmailUnifiedCampaignBanner')?.addEventListener('click', async (event) => {
      const button = event.target instanceof Element ? event.target.closest('button') : null;
      if (!(button instanceof HTMLButtonElement)) return;

      if (button.id === 'gmailUnifiedCampaignBannerReopen') {
        reopenCampaignMode();
        return;
      }

      if (button.id === 'gmailUnifiedCampaignBannerStop') {
        await stopCampaignBlast();
      }
    });
  }

  sidebar.querySelector('#gmailUnifiedDetailBody')?.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-mailita-link]');
    if (!anchor) return;
    event.preventDefault();
    event.stopPropagation();
    const href = String(anchor.getAttribute('href') || '').trim();
    if (href) {
      openExternalPage(href);
    }
  });

  if (!supportsIntersectionObservers()) {
    const handleDetailScroll = throttle(() => {
      scheduleIdleContactPrefetch();
      if (!state.selectedThreadId || usingLegacyMailboxFlow()) return;
      const currentBody = document.getElementById('gmailUnifiedDetailBody');
      scheduleVisibleBodyHydration(state.selectedThreadId);
      if (!currentBody || currentBody.scrollTop > 120) return;
      const loadState = getContactLoadState(state.selectedThreadId);
      if (!loadState.hasMore || loadState.inFlight || !loadState.nextCursor) return;
      loadContactMessagesForThread(state.selectedThreadId, {
        cursor: loadState.nextCursor,
        preserveScroll: true,
        pageSize: CONTACT_PAGE_SIZE
      }).catch(() => {});
    }, 100);
    sidebar.querySelector('#gmailUnifiedDetailBody')?.addEventListener('scroll', handleDetailScroll, { passive: true });
  }

  if (!window.__mailitaPointerCloseBound) {
    document.addEventListener('pointerdown', (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const liveSettingsButton = document.getElementById('gmailUnifiedSettingsBtn');
      const liveSettingsPanel = document.getElementById('gmailUnifiedSettingsPanel');
      const insideSettings = liveSettingsButton?.contains(target) || liveSettingsPanel?.contains(target);
      const liveComposeCard = document.querySelector('.gmail-unified-compose-card');
      const liveComposeButton = document.getElementById('gmailUnifiedComposeBtn');
      const insideCompose = liveComposeCard?.contains(target) || liveComposeButton?.contains(target);
      if (!insideSettings && state.settingsOpen) {
        state.settingsOpen = false;
        applyGmailLayoutMode();
      }
      if (!insideCompose && state.composeOverlay.open) {
        closeComposeOverlay();
      }
    });
    window.__mailitaPointerCloseBound = true;
  }
}

function buildSidebar() {
  if (document.getElementById('gmailUnifiedSidebar')) return;

  const sidebar = document.createElement('aside');
  sidebar.id = 'gmailUnifiedSidebar';
  sidebar.innerHTML = `
    <div id="gmailUnifiedShell" class="gmail-unified-shell">
      <div class="gmail-unified-body">
        <section class="gmail-unified-left">
          <div class="gmail-unified-left-head">
            <div id="gmailUnifiedRailContext" class="gmail-unified-rail-context">Messages</div>
            <button id="gmailUnifiedComposeBtn" class="gmail-unified-icon-btn gmail-unified-compose-launch" type="button" aria-label="Compose">&#9998;</button>
          </div>
          <div class="gmail-unified-search">
            <input id="gmailUnifiedSearchInput" type="text" placeholder="Search" />
          </div>
          <div class="gmail-unified-filters">
            <button class="gmail-unified-filter-btn active" data-filter="all">All</button>
            <button class="gmail-unified-filter-btn" data-filter="inbox">Inbox</button>
            <button class="gmail-unified-filter-btn" data-filter="sent">Sent</button>
          </div>
          <div id="gmailUnifiedStateCard" class="gmail-unified-state-card" data-state="loading">
            <div id="gmailUnifiedStateText">Connecting to Gmail...</div>
            <button id="gmailUnifiedRetryBtn" class="gmail-unified-retry" type="button">Retry</button>
            <div id="gmailUnifiedCountdown" class="gmail-unified-countdown"></div>
          </div>
          <div id="gmailUnifiedList" class="gmail-unified-list"></div>
          <div class="gmail-unified-left-footer">
            <button id="gmailUnifiedSettingsBtn" class="gmail-unified-secondary-btn gmail-unified-settings-launch" type="button" aria-label="Settings">
              Settings
            </button>
          </div>
          <aside id="gmailUnifiedSettingsPanel" class="gmail-unified-settings-panel" hidden>
            <div class="gmail-unified-settings-panel-head">
              <div>
                <div class="gmail-unified-settings-kicker">Appearance</div>
                <h3>Messages style</h3>
              </div>
              <button id="gmailUnifiedSettingsCloseBtn" class="gmail-unified-icon-btn" type="button" aria-label="Close settings">x</button>
            </div>
            <div class="gmail-unified-settings-content">
              <div class="gmail-unified-theme-options">
                <button class="gmail-unified-theme-option" data-theme-mode="messages_glass_blue" type="button">Messages Glass</button>
                <button class="gmail-unified-theme-option" data-theme-mode="messages_scenic_blue" type="button">Messages Scenic</button>
                <button class="gmail-unified-theme-option" data-theme-mode="messages_glass_beige" type="button">Monochrome Beige</button>
              </div>
              <div class="gmail-unified-account-card">
                <div id="gmailUnifiedAccountStatus" class="gmail-unified-account-status" data-connected="false">Setup required</div>
                <div id="gmailUnifiedSettingsEmail" class="gmail-unified-account-email">Not connected</div>
                <div class="gmail-unified-account-meta">Last sync · <span id="gmailUnifiedSettingsSyncTime">No sync yet</span></div>
              </div>
              <button id="gmailUnifiedSettingsDisconnectBtn" class="gmail-unified-secondary-btn gmail-unified-danger-btn" type="button">Disconnect</button>
            </div>
          </aside>
        </section>
        <section class="gmail-unified-main">
          <div id="gmailUnifiedMainEmpty" class="gmail-unified-main-empty">
            <div class="gmail-unified-main-empty-copy">
              <div class="gmail-unified-main-empty-kicker">Mailita</div>
              <h2>Select a person to open your conversation.</h2>
            </div>
          </div>
          <section id="gmailUnifiedDetail" class="gmail-unified-detail" style="display:none;">
            <div class="gmail-unified-detail-head">
              <button id="gmailUnifiedBackBtn" class="gmail-unified-back">&#8592; Back</button>
              <div class="gmail-unified-detail-head-copy">
                <div id="gmailUnifiedDetailHeader"></div>
                <div id="gmailUnifiedDetailSubheader" class="gmail-unified-detail-subheader"></div>
              </div>
            </div>
            <div id="gmailUnifiedDetailBody" class="gmail-unified-detail-body"></div>
            <div id="gmailUnifiedComposer" class="gmail-unified-composer">
              <div class="gmail-unified-composer-row">
                <div class="gmail-unified-composer-modes">
                  <button id="gmailUnifiedComposerReply" class="gmail-unified-composer-mode is-active" type="button">Reply</button>
                  <button id="gmailUnifiedComposerReplyAll" class="gmail-unified-composer-mode" type="button">All</button>
                </div>
                <div class="gmail-unified-composer-field-wrap">
                  <textarea id="gmailUnifiedComposerInput" class="gmail-unified-composer-input" placeholder="Message" spellcheck="true"></textarea>
                </div>
                <button id="gmailUnifiedComposerSend" class="gmail-unified-primary-btn gmail-unified-composer-send" type="button" aria-label="Send">&#8593;</button>
              </div>
              <div id="gmailUnifiedComposerStatus" class="gmail-unified-composer-status" data-state="idle"></div>
            </div>
          </section>
        </section>
      </div>
    </div>

    <section id="gmailUnifiedOnboardingOverlay" class="gmail-unified-onboarding-overlay" hidden>
      <div class="gmail-unified-install-card">
        <div class="gmail-unified-install-kicker">Mailita</div>
        <h2>Email, like Messages.</h2>
        <p>Connect your Google account to open every person as a real conversation.</p>
        <button id="gmailUnifiedConnectBtn" class="gmail-unified-primary-btn" type="button">Connect with Google</button>
        <div id="gmailUnifiedConnectStatus" class="gmail-unified-connect-status"></div>
        <button id="gmailUnifiedGuideCloseBtn" class="gmail-unified-guide-close-modal" hidden type="button">Close</button>
      </div>
    </section>

    <section id="gmailUnifiedComposeOverlay" class="gmail-unified-compose-overlay" hidden>
      <div class="gmail-unified-compose-card">
        <div class="gmail-unified-compose-head">
          <div>
            <div class="gmail-unified-install-kicker">Compose</div>
            <h3>New message</h3>
          </div>
          <button id="gmailUnifiedComposeCloseBtn" class="gmail-unified-icon-btn" type="button" aria-label="Close compose">x</button>
        </div>
        <label class="gmail-unified-compose-field">
          <span>To</span>
          <input id="gmailUnifiedComposeTo" type="text" placeholder="name@example.com" />
        </label>
        <label class="gmail-unified-compose-field">
          <span>Subject</span>
          <input id="gmailUnifiedComposeSubject" type="text" placeholder="Subject" />
        </label>
        <label class="gmail-unified-compose-field is-body">
          <span>Message</span>
          <textarea id="gmailUnifiedComposeBody" placeholder="Write your message" spellcheck="true"></textarea>
        </label>
        <div class="gmail-unified-compose-actions">
          <div id="gmailUnifiedComposeStatus" class="gmail-unified-compose-status" data-state="idle"></div>
          <div class="gmail-unified-compose-action-buttons">
            ${CAMPAIGN_MODE_ENABLED ? '<button id="gmailUnifiedComposeCampaignBtn" class="gmail-unified-secondary-btn gmail-unified-compose-campaign" type="button">Campaign Mode</button>' : ''}
            <button id="gmailUnifiedComposeCancelBtn" class="gmail-unified-secondary-btn" type="button">Cancel</button>
            <button id="gmailUnifiedComposeSend" class="gmail-unified-primary-btn" type="button">Send</button>
          </div>
        </div>
      </div>
    </section>

    ${CAMPAIGN_MODE_ENABLED ? `
    <section id="gmailUnifiedCampaignOverlay" class="gmail-unified-campaign-overlay" hidden>
      <div class="gmail-unified-campaign-shell">
        <div class="gmail-unified-campaign-head">
          <div class="gmail-unified-campaign-head-copy">
            <div class="gmail-unified-install-kicker">Campaign Mode</div>
            <h2>Focus Mode</h2>
            <p>Paste a spreadsheet, merge variables like [Company], then review or blast with safe pacing.</p>
          </div>
          <div class="gmail-unified-campaign-head-actions">
            <div id="gmailUnifiedCampaignStatus" class="gmail-unified-campaign-status" data-state="idle"></div>
            <button id="gmailUnifiedCampaignCloseBtn" class="gmail-unified-icon-btn" type="button" aria-label="Close campaign mode">x</button>
          </div>
        </div>
        <div class="gmail-unified-campaign-layout">
          <section class="gmail-unified-campaign-pane gmail-unified-campaign-template-pane">
            <div class="gmail-unified-campaign-pane-head">
              <div>
                <div class="gmail-unified-install-kicker">Template</div>
                <h3>Write the template</h3>
              </div>
              <div class="gmail-unified-campaign-mode-switch">
                <button id="gmailUnifiedCampaignModeReview" class="gmail-unified-campaign-mode-btn is-active" type="button">Review</button>
                <button id="gmailUnifiedCampaignModeBlast" class="gmail-unified-campaign-mode-btn" type="button">Blast</button>
              </div>
            </div>
            <label class="gmail-unified-compose-field">
              <span>Subject</span>
              <input id="gmailUnifiedCampaignSubject" type="text" placeholder="Application for [Company]" />
            </label>
            <label class="gmail-unified-compose-field is-body gmail-unified-campaign-body-field">
              <span>Body</span>
              <textarea id="gmailUnifiedCampaignBody" placeholder="Hi [Name],&#10;&#10;I’m excited to apply for [Company]..." spellcheck="true"></textarea>
            </label>
            <div id="gmailUnifiedCampaignValidation" class="gmail-unified-campaign-validation"></div>
          </section>
          <section id="gmailUnifiedCampaignDataPane" class="gmail-unified-campaign-pane gmail-unified-campaign-data-pane">
            <div class="gmail-unified-campaign-pane-head">
              <div>
                <div class="gmail-unified-install-kicker">Data</div>
                <h3>Paste the spreadsheet</h3>
              </div>
            </div>
            <div id="gmailUnifiedCampaignPasteZone" class="gmail-unified-campaign-paste-zone" tabindex="0"></div>
            <div id="gmailUnifiedCampaignTableWrap" class="gmail-unified-campaign-table-wrap"></div>
          </section>
        </div>
        <div class="gmail-unified-campaign-footer">
          <div id="gmailUnifiedCampaignPreview" class="gmail-unified-campaign-preview"></div>
          <div id="gmailUnifiedCampaignActions" class="gmail-unified-campaign-actions"></div>
        </div>
      </div>
    </section>

    <div id="gmailUnifiedCampaignBanner" class="gmail-unified-campaign-banner" hidden></div>
    ` : ''}
  `;

  document.body.appendChild(sidebar);
  state.composeOverlay = defaultComposeOverlayState();
  bindGuideEvents(sidebar);
  if (!window.__mailitaDebugHooksBound) {
    window.addEventListener('error', (event) => {
      pushDebugEvent('window:error', 'Unhandled window error', {
        message: event.message,
        file: event.filename,
        line: event.lineno,
        column: event.colno
      }, 'error');
    });
    window.addEventListener('unhandledrejection', (event) => {
      pushDebugEvent('window:rejection', 'Unhandled promise rejection', {
        reason: event.reason?.message || String(event.reason)
      }, 'error');
    });
    window.__mailitaDebugHooksBound = true;
  }
  pushDebugEvent('boot', 'Sidebar built', {
    mailHost: isMailHost(),
    href: window.location.href
  }, 'success');
  renderDebugPanel();
  renderComposeOverlay();
  renderCampaignMode({ syncInputs: true, fullTable: true });
  renderCampaignBanner();
  updateMainPanelVisibility();
}

async function connectFromGuide() {
  if (state.connectInFlight) return;

  const connectBtn = document.getElementById('gmailUnifiedConnectBtn');

  state.connectInFlight = true;
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
  }
  setConnectUiState('Connecting...');
  pushDebugEvent('connect', 'Connect flow started');
  appendUiActivity({
    source: 'UI',
    level: 'info',
    stage: 'connect_button_clicked',
    message: 'Connect button clicked. Starting setup.'
  }, { reset: true });

  try {
    sendWorker('HEALTH_CHECK', {}, { timeoutMs: 6000 })
      .then((health) => {
        pushDebugEvent('connect', 'Pre-connect health check finished', health, health?.success ? 'success' : 'error');
      })
      .catch((error) => {
        pushDebugEvent('connect', 'Pre-connect health check failed', {
          code: error?.code || 'HEALTH_CHECK_FAILED',
          error: error?.message || 'Health check failed.'
        }, 'error');
      });

    const response = await sendWorker('CONNECT_GOOGLE');
    if (!response?.success) {
      setConnectUiState(mapConnectError(response), true);
      return;
    }
    pushDebugEvent('connect', 'CONNECT_GOOGLE succeeded', response, 'success');

    try {
      await guideConfirm('connect_account', {
        substep: 'connect_submitted',
        reason: 'oauth_connected',
        evidence: {
          oauth: {
            connectedAt: new Date().toISOString(),
            source: 'guide_connect'
          }
        }
      });
      pushDebugEvent('connect', 'Guide confirm completed', null, 'success');
    } catch (error) {
      pushDebugEvent('connect', 'Guide confirm failed', {
        message: error?.message || String(error)
      }, 'error');
    }
    state.connected = true;
    state.shellUnlocked = true;
    state.accountSnapshot = {
      ...state.accountSnapshot,
      connected: true,
      accountEmail: String(response.accountEmail || response.email || state.accountSnapshot.accountEmail || '').trim().toLowerCase(),
      mailSource: 'gmail_api_local',
      onboardingComplete: true
    };
    state.guideReviewOpen = false;
    setConnectUiState('');
    const sidebar = document.getElementById('gmailUnifiedSidebar');
    sidebar?.classList.add('gmail-unified-unlocking');
    applyGmailLayoutMode();
    if (currentSummaryItems().length || state.messages.length) {
      renderThreads();
    } else {
      setStateCard('loading', 'Loading conversations...');
    }
    window.setTimeout(() => {
      sidebar?.classList.remove('gmail-unified-unlocking');
    }, 500);
    try {
      await refreshGuideAndAuthState();
    } catch (error) {
      pushDebugEvent('connect', 'refreshGuideAndAuthState failed after auth', {
        message: error?.message || String(error)
      }, 'error');
    }
    state.useLegacyMailboxFallback = false;
    state.mailboxMode = 'summary';
    applyGmailLayoutMode();
    pushDebugEvent('connect', 'Starting first mailbox load after auth', {
      mailboxMode: state.mailboxMode
    });

    setConnectUiState('');
    ensureInitialSummaryLoad({
      forceSync: false,
      trackActivity: true,
      limit: 50
    }).then((mailboxResponse) => {
      if (!mailboxResponse?.success) return;
      pushDebugEvent('connect', 'Connect flow completed', {
        summaries: currentSummaryItems().length,
        messages: state.messages.length
      }, 'success');
    });
  } catch (error) {
    pushDebugEvent('connect', 'Connect flow crashed', {
      code: error?.code || '',
      message: error?.message || String(error)
    }, 'error');
    setConnectUiState(String(error?.message || 'Connected, but mailbox loading failed. Retry.'), true);
    setStateCard('error', 'Unable to load conversations right now.', true);
  } finally {
    state.connectInFlight = false;
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect with Google';
    }
  }
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) return;

  state.autoRefreshTimer = setInterval(() => {
    if (document.hidden || !state.connected) return;
    sendWorker('SYNC_MESSAGES', { trackActivity: false }).catch(() => {});
  }, 10 * 60 * 1000);
}

function updateBootSentinels(booting, ready) {
  window.__mailitaBooting = Boolean(booting);
  window.__mailitaContentReady = Boolean(ready);
}

function waitForGmailRoot(timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tryResolve = () => {
      if (document.querySelector('[role="main"]')) {
        cleanup();
        resolve();
        return true;
      }
      if (Date.now() - startedAt >= timeoutMs) {
        cleanup();
        reject(new Error('Gmail main area did not become ready in time.'));
        return true;
      }
      return false;
    };
    const interval = window.setInterval(() => {
      tryResolve();
    }, 250);
    const observer = new MutationObserver(() => {
      tryResolve();
    });
    const cleanup = () => {
      window.clearInterval(interval);
      observer.disconnect();
    };
    observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    tryResolve();
  });
}

function ensureMailitaSurfaceObserver() {
  if (mailitaSurfaceObserver) return;
  mailitaSurfaceObserver = new MutationObserver(() => {
    if (!isMailHost()) return;
    const sidebar = document.getElementById('gmailUnifiedSidebar');
    if (!sidebar && !window.__mailitaBooting) {
      updateBootSentinels(false, false);
      bootGmailSurface().catch(() => {});
    }
  });
  mailitaSurfaceObserver.observe(document.documentElement || document.body, {
    childList: true,
    subtree: true
  });
}

async function bootGmailSurface() {
  if (window.__mailitaBooting) return;
  updateBootSentinels(true, false);

  try {
    await waitForGmailRoot();
    buildSidebar();
    await refreshGuideAndAuthState();
    applyGmailLayoutMode();

    if (!mailitaGlobalListenersBound) {
      mailitaGlobalListenersBound = true;

      window.addEventListener('hashchange', async () => {
        if (!state.connected || state.guideReviewOpen) {
          await refreshGuideAndAuthState();
        }
        applyGmailLayoutMode();
      });

      document.addEventListener('keydown', handleGlobalSurfaceEscape, true);

      chrome.storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== 'local') return;
        if (changes.onboardingGuideState || changes.connected || changes.accountEmail || changes.onboardingComplete) {
          refreshGuideAndAuthState()
            .then(async () => {
              applyGmailLayoutMode();
              if (state.connectInFlight) {
                return;
              }
              await ensureInitialSummaryLoad({ limit: state.summaryPageSize || 50 });
            })
            .catch(() => {});
        }
        if (changes.lastSyncTime && state.connected && !state.searchQuery && !usingLegacyMailboxFlow()) {
          state.accountSnapshot.lastSyncTime = changes.lastSyncTime.newValue || '';
          renderSettingsUi();
          ensureInitialSummaryLoad({ limit: state.summaryPageSize || 50 }).catch(() => {});
        }
        if (changes.setupDiagnostics) {
          state.setupDiagnostics = normalizeSetupDiagnostics(changes.setupDiagnostics.newValue);
          renderActivityPanel();
        }
        if (changes[UI_SETTINGS_STORAGE_KEY]) {
          state.uiSettings = normalizeUiSettings(changes[UI_SETTINGS_STORAGE_KEY].newValue);
          applyGmailLayoutMode();
          const group = findSelectedGroup();
          if (group) renderThreadDetail(group);
        }
      });
    }

    ensureMailitaSurfaceObserver();

    if (state.connected) {
      await loadSummaryBootstrap({ limit: 50 }).catch(() => {});
      queueBackgroundMailboxPrime({ limit: 50 });
    }

    mailitaBootRetries = 0;
    updateBootSentinels(false, true);
  } catch (error) {
    console.error('[Mailita] boot failed', error);
    updateBootSentinels(false, false);
    mailitaBootRetries += 1;
    if (mailitaBootRetries <= 3) {
      window.setTimeout(() => {
        bootGmailSurface().catch(() => {});
      }, mailitaBootRetries * 400);
    }
  }
}

if (isMailHost()) {
  updateBootSentinels(false, false);
  ensureMailitaSurfaceObserver();
  bootGmailSurface().catch(() => {});
}
