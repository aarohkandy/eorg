const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';
const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords';
const TWO_STEP_VERIFICATION_URL = 'https://myaccount.google.com/signinoptions/two-step-verification';
const UI_SETTINGS_STORAGE_KEY = 'mailitaUiSettings';
const SETTINGS_TABS = ['theme', 'privacy', 'account'];
// Flip this off when we're ready to remove the onboarding activity panel.
const SHOW_ACTIVITY_PANEL = true;

const GUIDE_STEPS = ['welcome', 'connect_account'];
const GUIDE_STEP_SET = new Set(GUIDE_STEPS);
const GUIDE_SUBSTEP_COPY = {
  welcome: {
    intro: {
      title: 'Welcome to Mailita',
      body: 'Use this step to turn on 2-Step Verification if needed, then create your Gmail App Password.'
    }
  },
  connect_account: {
    connect_ready: {
      title: 'Step 2: Connect account',
      body: 'Paste the Gmail address you want to sync and the 16-character App Password from Google.'
    },
    connect_submitted: {
      title: 'Connecting',
      body: 'Finishing setup and loading your mailbox.'
    }
  }
};

const state = {
  messages: [],
  contactSummaries: [],
  contactMessagesByKey: {},
  contactLoadStateByKey: {},
  summaryRequestGeneration: 0,
  contactRequestGenerationByKey: {},
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
  uiSettings: null,
  settingsOpen: false,
  settingsPreviewOpen: false,
  settingsPreviewTimer: null,
  activeSettingsTab: 'theme',
  accountSnapshot: {
    userId: '',
    userEmail: '',
    lastSyncTime: '',
    onboardingComplete: false
  },
  composer: {
    draft: '',
    mode: 'reply',
    targetMessageId: '',
    sendInFlight: false,
    sendError: '',
    sendStatus: ''
  }
};

function isMailHost() {
  return window.location.hostname.includes('mail.google.com');
}

function sendWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
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
    themeMode: 'dark',
    showDebugPanel: false,
    loadRemoteImages: true,
    confirmExternalLinks: true
  };
}

function normalizeUiSettings(input) {
  const src = input && typeof input === 'object' ? input : {};
  const defaults = defaultUiSettings();
  const themeMode = ['dark', 'khaki', 'system'].includes(src.themeMode) ? src.themeMode : defaults.themeMode;

  return {
    themeMode,
    showDebugPanel: src.showDebugPanel == null ? defaults.showDebugPanel : Boolean(src.showDebugPanel),
    loadRemoteImages: src.loadRemoteImages == null
      ? (src.loadRemoteContent == null ? defaults.loadRemoteImages : Boolean(src.loadRemoteContent))
      : Boolean(src.loadRemoteImages),
    confirmExternalLinks: src.confirmExternalLinks == null ? defaults.confirmExternalLinks : Boolean(src.confirmExternalLinks)
  };
}

function resolvedThemeMode(uiSettings = state.uiSettings) {
  const settings = normalizeUiSettings(uiSettings);
  if (settings.themeMode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'khaki';
  }
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
    latestDate: String(src.latestDate || new Date(0).toISOString()).trim() || new Date(0).toISOString(),
    latestDirection: src.latestDirection === 'outgoing' ? 'outgoing' : 'incoming',
    latestMessageId: String(src.latestMessageId || '').trim(),
    messageCount: numericValue(src.messageCount, 0),
    unreadCount: numericValue(src.unreadCount, 0),
    hasMissingContent: Boolean(src.hasMissingContent),
    inboxCount: numericValue(src.inboxCount, 0),
    sentCount: numericValue(src.sentCount, 0)
  };
}

function defaultContactLoadState() {
  return {
    attempted: false,
    loaded: false,
    inFlight: false,
    error: '',
    source: 'contact',
    count: 0,
    trace: [],
    timings: defaultMailboxTimings(),
    backend: normalizeBuildInfo(null),
    schemaFallbackUsed: false,
    richContentSource: 'cache',
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

function resetSectionedMailboxCaches(options = {}) {
  state.contactSummaries = [];
  state.contactMessagesByKey = {};
  state.contactLoadStateByKey = {};
  state.contactRequestGenerationByKey = {};
  state.summaryRequestGeneration += 1;
  if (options.resetContactDebug !== false) {
    state.contactDebug = {};
  }
}

function accountEmailLower() {
  return String(state.accountSnapshot?.userEmail || '').trim().toLowerCase();
}

function usingLegacyMailboxFlow() {
  return state.mailboxMode === 'legacy' || state.mailboxMode === 'search' || state.useLegacyMailboxFallback;
}

function activeMailboxSourceLabel() {
  if (state.mailboxMode === 'search' || state.searchQuery) return 'search';
  if (state.useLegacyMailboxFallback || state.mailboxMode === 'legacy') return 'legacy';
  return 'summary';
}

function filteredMessagesForCurrentFilter(messages) {
  let current = [...(Array.isArray(messages) ? messages : [])];

  if (state.filter === 'inbox') {
    current = current.filter((message) => !message.isOutgoing);
  }

  if (state.filter === 'sent') {
    current = current.filter((message) => message.isOutgoing);
  }

  return current.sort(byDateDesc);
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

function storeContactMessages(contactKey, messages) {
  const deduped = new Map();
  (Array.isArray(messages) ? messages : []).forEach((message) => {
    if (!message?.id) return;
    deduped.set(message.id, message);
  });
  state.contactMessagesByKey[contactKey] = [...deduped.values()].sort(byDateDesc);
}

function settingsHoverAllowed() {
  return window.matchMedia('(min-width: 900px) and (hover: hover)').matches;
}

function clearSettingsPreviewTimer() {
  if (state.settingsPreviewTimer) {
    window.clearTimeout(state.settingsPreviewTimer);
    state.settingsPreviewTimer = null;
  }
}

function setSettingsPreviewOpen(open) {
  clearSettingsPreviewTimer();
  state.settingsPreviewOpen = Boolean(open) && !state.settingsOpen && settingsHoverAllowed();
  applyGmailLayoutMode();
}

function scheduleSettingsPreviewClose(delay = 140) {
  clearSettingsPreviewTimer();
  state.settingsPreviewTimer = window.setTimeout(() => {
    state.settingsPreviewOpen = false;
    applyGmailLayoutMode();
  }, delay);
}

function setSettingsPanelOpen(open) {
  state.settingsOpen = Boolean(open);
  if (state.settingsOpen) {
    state.settingsPreviewOpen = false;
    clearSettingsPreviewTimer();
  }
  applyGmailLayoutMode();
}

function setActiveSettingsTab(tab) {
  if (!SETTINGS_TABS.includes(tab)) return;
  state.activeSettingsTab = tab;
  applyGmailLayoutMode();
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
    storeContactMessages(threadId, replacements);
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

function findSummaryByThreadId(threadId) {
  return state.contactSummaries.find((summary) => summary.contactKey === threadId) || null;
}

async function appendUiActivity(entry, options = {}) {
  try {
    const payload = {
      reset: Boolean(options.reset),
      entry
    };
    await sendWorker('DIAGNOSTICS_LOG', payload);
  } catch {
    // Ignore diagnostics failures in the UI path.
  }
}

function defaultGuideState() {
  return {
    step: 'welcome',
    substep: 'intro',
    status: {
      welcome: 'in_progress',
      connect_account: 'pending'
    },
    evidence: {
      appPassword: {
        generatedAt: null,
        source: null
      }
    },
    progress: 0,
    total: 2,
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
    if (src.evidence.appPassword && typeof src.evidence.appPassword === 'object') {
      const appPassword = src.evidence.appPassword;
      if (typeof appPassword.generatedAt === 'string') evidence.appPassword.generatedAt = appPassword.generatedAt;
      if (typeof appPassword.source === 'string') evidence.appPassword.source = appPassword.source;
    }
  }

  if (status.connect_account === 'done') {
    status.welcome = 'done';
  }

  let step = GUIDE_STEP_SET.has(src.step)
    ? src.step
    : (status.welcome === 'done' ? 'connect_account' : 'welcome');
  if (step === 'welcome' && status.welcome === 'done') {
    step = 'connect_account';
  }

  let substep = typeof src.substep === 'string' ? src.substep : fallback.substep;
  if (!GUIDE_SUBSTEP_COPY[step] || !GUIDE_SUBSTEP_COPY[step][substep]) {
    if (step === 'connect_account') {
      substep = status.connect_account === 'done' ? 'connect_submitted' : 'connect_ready';
    } else {
      substep = 'intro';
    }
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
  const date = new Date(value);
  const now = new Date();

  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }

  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
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
  if (state.accountSnapshot?.userEmail) {
    return state.accountSnapshot.userEmail;
  }

  return state.connected ? 'Inbox' : 'Setup';
}

function applyThemeSettings() {
  const sidebar = document.getElementById('gmailUnifiedSidebar');
  if (!sidebar) return;

  const themeMode = resolvedThemeMode(state.uiSettings);
  sidebar.dataset.themeMode = themeMode;
  sidebar.dataset.settingsOpen = state.settingsOpen ? 'true' : 'false';
}

function renderSettingsUi() {
  const settings = normalizeUiSettings(state.uiSettings);
  const context = document.getElementById('gmailUnifiedRailContext');
  const preview = document.getElementById('gmailUnifiedSettingsPreview');
  const panel = document.getElementById('gmailUnifiedSettingsPanel');
  const debugPanel = document.getElementById('gmailUnifiedDebugPanel');
  const previewTheme = document.getElementById('gmailUnifiedSettingsPreviewTheme');
  const previewPrivacy = document.getElementById('gmailUnifiedSettingsPreviewPrivacy');
  const previewAccount = document.getElementById('gmailUnifiedSettingsPreviewAccount');
  const accountEmail = document.getElementById('gmailUnifiedSettingsEmail');
  const accountSync = document.getElementById('gmailUnifiedSettingsSyncTime');
  const accountStatus = document.getElementById('gmailUnifiedAccountStatus');

  if (context) {
    context.textContent = shellContextLabel();
  }

  if (preview) {
    preview.hidden = !state.settingsPreviewOpen || state.settingsOpen;
  }

  if (panel) {
    panel.hidden = !state.settingsOpen;
  }

  if (debugPanel) {
    debugPanel.hidden = !settings.showDebugPanel;
  }

  if (previewTheme) {
    const label = settings.themeMode === 'system'
      ? `System (${resolvedThemeMode(settings)})`
      : `${settings.themeMode.charAt(0).toUpperCase()}${settings.themeMode.slice(1)}`;
    previewTheme.textContent = `Theme · ${label}`;
  }

  if (previewPrivacy) {
    const debugLabel = settings.showDebugPanel ? 'debug visible' : 'debug hidden';
    const imageLabel = settings.loadRemoteImages ? 'images on' : 'images off';
    previewPrivacy.textContent = `Privacy · ${debugLabel}, ${imageLabel}`;
  }

  if (previewAccount) {
    previewAccount.textContent = state.accountSnapshot.userEmail
      ? `Account · ${state.accountSnapshot.userEmail}`
      : 'Account · not connected';
  }

  document.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.settingsTab === state.activeSettingsTab);
  });

  document.querySelectorAll('.gmail-unified-settings-section').forEach((section) => {
    section.hidden = section.dataset.settingsSection !== state.activeSettingsTab;
  });

  document.querySelectorAll('.gmail-unified-theme-option[data-theme-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.themeMode === settings.themeMode);
  });

  const debugToggle = document.getElementById('gmailUnifiedToggleDebug');
  const remoteToggle = document.getElementById('gmailUnifiedToggleRemoteImages');
  const linksToggle = document.getElementById('gmailUnifiedToggleConfirmLinks');
  const settingsDisconnect = document.getElementById('gmailUnifiedSettingsDisconnectBtn');
  if (debugToggle) debugToggle.checked = settings.showDebugPanel;
  if (remoteToggle) remoteToggle.checked = settings.loadRemoteImages;
  if (linksToggle) linksToggle.checked = settings.confirmExternalLinks;
  if (settingsDisconnect) settingsDisconnect.disabled = !state.connected;

  if (accountEmail) accountEmail.textContent = state.accountSnapshot.userEmail || 'Not connected';
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
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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

function composeRecipients(group, targetMessage, mode) {
  const fallbackEmail = getGroupContactEmail(group);
  if (!targetMessage) {
    return fallbackEmail ? [{ email: fallbackEmail, name: '' }] : [];
  }

  if (mode !== 'reply_all') {
    if (targetMessage.isOutgoing) {
      const to = uniqueRecipientEntries(targetMessage.to);
      if (to.length) return [to[0]];
    } else if (targetMessage.from?.email) {
      return uniqueRecipientEntries([targetMessage.from]);
    }

    return fallbackEmail ? [{ email: fallbackEmail, name: '' }] : [];
  }

  const entries = [];
  if (!targetMessage.isOutgoing && targetMessage.from?.email) {
    entries.push(targetMessage.from);
  }
  entries.push(...(Array.isArray(targetMessage.to) ? targetMessage.to : []));
  const deduped = uniqueRecipientEntries(entries);
  if (deduped.length) return deduped;
  return fallbackEmail ? [{ email: fallbackEmail, name: '' }] : [];
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
  const previousDisplay = sidebar?.style.display || '';
  const hadFullscreen = document.body.classList.contains('gmail-unified-fullscreen');

  if (sidebar) {
    sidebar.style.display = 'none';
  }
  if (hadFullscreen) {
    document.body.classList.remove('gmail-unified-fullscreen');
  }

  try {
    await sleep(90);
    return await task();
  } finally {
    if (hadFullscreen) {
      document.body.classList.add('gmail-unified-fullscreen');
    }
    if (sidebar) {
      sidebar.style.display = previousDisplay;
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
  const composeButton = selectFirst(document, COMPOSE_BUTTON_SELECTORS);
  if (!composeButton) return null;
  dispatchMouseSequence(composeButton);
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

  state.composer.sendError = '';
  state.composer.sendStatus = '';
  state.composer.sendInFlight = true;
  renderThreadDetail(activeGroup);

  const result = await replyToThread(body, {
    recipients,
    subject
  });

  state.composer.sendInFlight = false;

  if (!result.ok) {
    state.composer.sendError = result.reason || 'Send failed.';
    state.composer.sendStatus = '';
    renderThreadDetail(activeGroup);
    return;
  }

  const optimisticMessage = {
    id: `optimistic-${Date.now()}`,
    threadId: activeGroup.threadId,
    folder: 'SENT',
    date: new Date().toISOString(),
    from: {
      name: '',
      email: state.accountSnapshot.userEmail || ''
    },
    to: recipients,
    subject,
    snippet: body,
    bodyText: body,
    bodyHtml: '',
    bodyFormat: 'text',
    hasRemoteImages: false,
    hasLinkedImages: false,
    isOutgoing: true,
    contactKey: activeGroup.threadId,
    contactEmail: getGroupContactEmail(activeGroup),
    contactName: groupDisplayName(activeGroup),
    flags: ['\\Seen'],
    messageId: ''
  };

  state.messages = [optimisticMessage, ...state.messages];
  if (activeGroup?.threadId) {
    const existing = state.contactMessagesByKey[activeGroup.threadId] || [];
    storeContactMessages(activeGroup.threadId, [optimisticMessage, ...existing]);
  }
  state.composer = {
    ...defaultComposerState(),
    mode: state.composer.mode,
    sendStatus: 'Sent'
  };
  renderThreads();
  const nextGroup = findSelectedGroup();
  if (nextGroup) {
    renderThreadDetail(nextGroup);
  }

  window.setTimeout(() => {
    state.composer.sendStatus = '';
    const currentGroup = findSelectedGroup();
    if (currentGroup) renderThreadDetail(currentGroup);
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
  return new Date(b.date).getTime() - new Date(a.date).getTime();
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

function currentThreadGroups() {
  if (usingLegacyMailboxFlow()) {
    return groupByThread(filteredMessages());
  }

  return state.contactSummaries
    .filter((summary) => summaryVisibleInCurrentFilter(summary))
    .map((summary) => {
    const allMessages = state.contactMessagesByKey[summary.contactKey] || [];
    return {
      threadId: summary.contactKey,
      summary,
      messages: filteredMessagesForCurrentFilter(allMessages),
      allMessages
    };
    });
}

function findSelectedGroup() {
  if (!state.selectedThreadId) return null;
  return currentThreadGroups().find((group) => group.threadId === state.selectedThreadId) || null;
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

function groupLatestDate(group) {
  if (group?.summary) return group.summary.latestDate || new Date(0).toISOString();
  return group?.messages?.[0]?.date || new Date(0).toISOString();
}

function groupUnread(group) {
  if (group?.summary) return numericValue(group.summary.unreadCount, 0) > 0;
  return Array.isArray(group?.messages) ? group.messages.some(isUnread) : false;
}

function isUnread(message) {
  const flags = Array.isArray(message.flags) ? message.flags : [];
  return !flags.includes('\\Seen');
}

function filteredMessages() {
  let current = [...state.messages];

  if (state.filter === 'inbox') {
    current = current.filter((message) => !message.isOutgoing);
  }

  if (state.filter === 'sent') {
    current = current.filter((message) => message.isOutgoing);
  }

  return current.sort(byDateDesc);
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
  const messages = [...(group?.messages || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
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
    summary.textContent = 'Open a conversation to inspect exactly what the UI received.';
    status.hidden = true;
    status.textContent = '';
    log.value = 'Select a conversation to generate a debug report.';
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
    log.value = buildThreadDebugReport(group);
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

  log.value = buildThreadDebugReport(group);
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

  updateMainPanelVisibility();
}

function renderThreads() {
  const list = document.getElementById('gmailUnifiedList');
  if (!list) return;

  const threadGroups = currentThreadGroups();

  if (!threadGroups.length) {
    setStateCard('empty', 'No messages found.');
    return;
  }

  setStateCard('normal', '');

  list.innerHTML = '';

  threadGroups.forEach((group) => {
    const unread = groupUnread(group);
    const selected = state.selectedThreadId === group.threadId;

    const row = document.createElement('button');
    row.className = 'gmail-unified-thread-row';
    row.type = 'button';
    row.dataset.threadId = group.threadId;
    row.classList.toggle('is-selected', selected);

    const who = groupDisplayName(group);
    const latestDate = groupLatestDate(group);
    const latestSubject = groupLatestSubject(group);

    row.innerHTML = `
      <div class="gmail-unified-thread-row-shell">
        <div class="gmail-unified-thread-top">
          <span class="gmail-unified-thread-who ${unread ? 'unread' : ''}">${escapeHtml(who)}</span>
          <span class="gmail-unified-date">${formatDate(latestDate)}</span>
        </div>
        <div class="gmail-unified-thread-subject ${unread ? 'unread' : ''}">${escapeHtml(
          latestSubject || '(no subject)'
        )}</div>
      </div>
    `;

    row.addEventListener('click', () => {
      if (state.selectedThreadId !== group.threadId) {
        state.composer = defaultComposerState();
      }
      state.selectedThreadId = group.threadId;
      if (usingLegacyMailboxFlow()) {
        state.composer.targetMessageId = selectedComposerMessage(group)?.id || '';
      }
      renderThreads();
      if (!usingLegacyMailboxFlow()) {
        loadContactMessagesForThread(group.threadId).catch(() => {});
      }
    });

    list.appendChild(row);
  });

  const selectedGroup = findSelectedGroup();
  if (state.selectedThreadId && !selectedGroup) {
    state.selectedThreadId = '';
    state.composer = defaultComposerState();
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
  }

  renderSettingsUi();
  if (selectedGroup) {
    renderThreadDetail(selectedGroup);
  } else {
    renderThreadDebug(null);
    updateMainPanelVisibility();
  }
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

  renderThreads();
  const selectedGroup = findSelectedGroup();
  if (selectedGroup) {
    renderThreadDetail(selectedGroup);
  } else {
    renderThreadDebug(null);
    updateMainPanelVisibility();
  }
}

function renderThreadDetail(group) {
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

  const detailName = groupDisplayName(group);
  const detailEmail = getGroupContactEmail(group) || 'Conversation';
  const contactLoadState = group?.summary ? getContactLoadState(group.threadId) : defaultContactLoadState();

  detail.style.display = 'block';
  header.textContent = detailName;
  subheader.textContent = detailEmail;

  body.innerHTML = '';
  if (group?.summary && !group.messages.length) {
    const placeholderText = contactLoadState.inFlight
      ? 'Loading this conversation from Mailita...'
      : (
        group?.allMessages?.length && state.filter !== 'all'
          ? `No ${state.filter} messages in this conversation yet.`
          : contactLoadState.error
          ? contactLoadState.error
          : (
            contactLoadState.loaded
              ? 'No cached messages were returned for this contact yet.'
              : 'Open this conversation to load its cached messages.'
          )
      );

    body.innerHTML = `
      <div class="gmail-unified-message incoming gmail-unified-message-placeholder">
        <div class="gmail-unified-message-meta">
          <span class="gmail-unified-message-subject">${escapeHtml(group.summary.latestSubject || '(no subject)')}</span>
          <span class="gmail-unified-message-time">${formatDate(group.summary.latestDate)}</span>
        </div>
        <div class="gmail-unified-message-bubble-shell">
          <div class="gmail-unified-message-bubble">
            <div class="gmail-unified-message-snippet">${escapeHtml(placeholderText)}</div>
          </div>
        </div>
      </div>
    `;
    composer.hidden = true;
    renderSettingsUi();
    renderThreadDebug(group);
    updateMainPanelVisibility();
    return;
  }

  composer.hidden = false;
  const selectedMessage = selectedComposerMessage(group) || group.messages[0];
  if (!state.composer.targetMessageId && selectedMessage?.id) {
    state.composer.targetMessageId = selectedMessage.id;
  }
  if (state.composer.mode === 'reply_all' && !replyAllAvailable(selectedMessage)) {
    state.composer.mode = 'reply';
  }

  [...group.messages]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((message) => {
      const item = document.createElement('div');
      const renderedBody = messageDisplayMarkup(message);
      item.className = `gmail-unified-message ${message.isOutgoing ? 'outgoing' : 'incoming'} ${renderedBody.kind === 'html' ? 'gmail-unified-message-rich' : ''}`;
      item.dataset.messageId = message.id || '';
      const canReplyAll = replyAllAvailable(message);
      const bodyMarkup = renderedBody.kind === 'html'
        ? '<div class="gmail-unified-message-html-host"></div>'
        : `<div class="gmail-unified-message-snippet">${renderedBody.content}</div>`;

      item.innerHTML = `
        <div class="gmail-unified-message-meta">
          <span class="gmail-unified-message-subject">${escapeHtml(message.subject || '(no subject)')}</span>
          <span class="gmail-unified-message-time">${formatDate(message.date)}</span>
        </div>
        <div class="gmail-unified-message-bubble-shell">
          <div class="gmail-unified-message-bubble ${renderedBody.kind === 'html' ? 'gmail-unified-message-bubble-html' : ''}">
            ${bodyMarkup}
          </div>
          <div class="gmail-unified-message-actions" aria-hidden="true">
            <button class="gmail-unified-message-action" data-message-action="reply" data-message-id="${escapeHtml(message.id || '')}" type="button">Reply</button>
            ${canReplyAll ? `<button class="gmail-unified-message-action" data-message-action="reply_all" data-message-id="${escapeHtml(message.id || '')}" type="button">Reply all</button>` : ''}
          </div>
        </div>
      `;

      body.appendChild(item);

      if (renderedBody.kind === 'html') {
        const host = item.querySelector('.gmail-unified-message-html-host');
        mountRenderedEmailCard(host, renderedBody.content);
      }
    });

  composerReply.classList.toggle('is-active', state.composer.mode === 'reply');
  composerReplyAll.hidden = !replyAllAvailable(selectedMessage);
  composerReplyAll.classList.toggle('is-active', state.composer.mode === 'reply_all');
  composerInput.value = state.composer.draft;
  composerInput.placeholder = `Write back to ${threadCounterparty(group.messages[0])}...`;
  composerSend.disabled = state.composer.sendInFlight;
  composerSend.textContent = state.composer.sendInFlight ? 'Sending…' : 'Send';
  composerStatus.textContent = state.composer.sendError || state.composer.sendStatus || '';
  composerStatus.dataset.state = state.composer.sendError ? 'error' : (state.composer.sendStatus ? 'success' : 'idle');

  renderSettingsUi();
  renderThreadDebug(group);
  updateMainPanelVisibility();
  maybeDebugRefetchContact(group).catch(() => {});
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

async function loadContactMessagesForThread(threadId, options = {}) {
  if (!threadId || state.searchQuery || usingLegacyMailboxFlow()) return null;

  const summary = findSummaryByThreadId(threadId);
  if (!summary) return null;

  const contactEmail = summary.contactEmail || threadIdToContactEmail(threadId);
  const existing = getContactLoadState(threadId);

  if (!contactEmail) {
    state.contactLoadStateByKey[threadId] = {
      ...existing,
      attempted: true,
      loaded: false,
      inFlight: false,
      error: 'This conversation does not have a contact email yet.',
      source: 'contact-error',
      completedAt: new Date().toISOString()
    };
    if (state.selectedThreadId === threadId) {
      const selectedGroup = findSelectedGroup();
      if (selectedGroup) renderThreadDetail(selectedGroup);
    }
    return null;
  }

  if (existing.inFlight) return null;
  if (existing.loaded && !options.forceSync) return state.contactMessagesByKey[threadId] || [];

  const requestGeneration = numericValue(state.contactRequestGenerationByKey[threadId], 0) + 1;
  state.contactRequestGenerationByKey[threadId] = requestGeneration;

  const requestedAt = new Date().toISOString();
  state.contactLoadStateByKey[threadId] = {
    ...existing,
    attempted: true,
    inFlight: true,
    error: '',
    source: 'contact',
    requestedAt
  };

  if (state.selectedThreadId === threadId) {
    const selectedGroup = findSelectedGroup();
    if (selectedGroup) renderThreadDetail(selectedGroup);
  }

  const response = await sendWorker('FETCH_CONTACT_MESSAGES', {
    contactEmail,
    limitPerFolder: options.limitPerFolder || 50,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  if (state.contactRequestGenerationByKey[threadId] !== requestGeneration) {
    return response;
  }

  const nextState = {
    ...defaultContactLoadState(),
    attempted: true,
    loaded: Boolean(response?.success),
    inFlight: false,
    error: response?.success ? '' : failureMessageForResponse(response, 'Unable to load this conversation.'),
    source: response?.success ? (response?.source || 'contact') : 'contact-error',
    count: numericValue(response?.count, 0),
    trace: normalizeTraceEntries(response?.trace),
    timings: normalizeTimings(response?.timings),
    backend: normalizeBuildInfo(response?.debug?.backend),
    schemaFallbackUsed: Boolean(response?.debug?.schemaFallbackUsed),
    richContentSource: String(response?.debug?.richContentSource || (response?.success ? response?.source || 'cache' : 'cache')).trim() || 'cache',
    requestedAt,
    completedAt: new Date().toISOString()
  };

  if (response?.success) {
    storeContactMessages(threadId, response.messages);
  }

  state.contactLoadStateByKey[threadId] = nextState;

  renderThreads();
  const selectedGroup = findSelectedGroup();
  if (selectedGroup) {
    renderThreadDetail(selectedGroup);
  }

  return response;
}

async function loadMessageSummaries(options = {}) {
  const silent = Boolean(options.silent);
  const requestGeneration = numericValue(state.summaryRequestGeneration, 0) + 1;
  state.summaryRequestGeneration = requestGeneration;
  const requestedFolder = options.folder || 'all';

  if (!silent) {
    setStateCard('loading', 'Loading conversations...');
  }

  const response = await sendWorker('FETCH_MESSAGE_SUMMARIES', {
    folder: requestedFolder,
    limit: 50,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  if (state.summaryRequestGeneration !== requestGeneration) {
    return response;
  }

  if (!response?.success) {
    state.lastMailboxTrace = normalizeTraceEntries(response?.trace);
    state.lastMailboxSource = 'summary-error';
    state.lastMailboxTimings = normalizeTimings(response?.timings);

    if (silent) {
      renderSettingsUi();
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
  state.messages = [];
  state.mailboxAutoRefresh = {
    attempted: false,
    inFlight: false,
    before: null,
    after: null,
    failedToFillContent: false,
    error: ''
  };
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  state.lastMailboxSource = 'summary';
  state.lastMailboxTimings = normalizeTimings(response?.timings);
  state.lastMailboxDebug = normalizeMailboxDebug(response?.debug);
  state.contactSummaries = Array.isArray(response.summaries)
    ? response.summaries.map(normalizeContactSummary).filter((summary) => summary.contactKey)
    : [];

  if (state.selectedThreadId && !findSummaryByThreadId(state.selectedThreadId)) {
    state.selectedThreadId = '';
    state.composer = defaultComposerState();
  }

  renderThreads();

  if (options.trackActivity) {
    appendUiActivity({
      source: 'UI',
      level: 'success',
      stage: 'mailbox_summary_rendered',
      message: `Mailbox summary view rendered with ${response.count || state.contactSummaries.length || 0} people.`,
      details: `Source ${response.source || 'unknown'}.`
    }).catch(() => {});
  }

  if (state.selectedThreadId) {
    loadContactMessagesForThread(state.selectedThreadId, {
      trackActivity: Boolean(options.trackActivity)
    }).catch(() => {});
  }

  return response;
}

async function loadMessages(options = {}) {
  if (state.useLegacyMailboxFallback && !options.forceSectionedRetry) {
    return loadLegacyMessages(options);
  }

  const summaryResponse = await loadMessageSummaries(options);
  if (summaryResponse?.success) {
    return summaryResponse;
  }

  if (
    options.allowLegacyFallback === false
    || summaryResponse?.code === 'NOT_CONNECTED'
    || summaryResponse?.code === 'AUTH_FAILED'
    || summaryResponse?.code === 'BACKEND_COLD_START'
  ) {
    return summaryResponse;
  }

  const fallbackResponse = await loadLegacyMessages(options);
  if (fallbackResponse?.success) {
    state.useLegacyMailboxFallback = true;
    resetSectionedMailboxCaches();
  }
  return fallbackResponse;
}

function setFilter(filter) {
  state.filter = filter;

  const buttons = document.querySelectorAll('.gmail-unified-filter-btn');
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });

  renderThreads();
}

let searchDebounce = null;
async function handleSearch(query) {
  const trimmed = String(query || '').trim();
  state.searchQuery = trimmed;

  if (!trimmed) {
    state.mailboxMode = state.useLegacyMailboxFallback ? 'legacy' : 'summary';
    await loadMessages();
    return;
  }

  setStateCard('loading', 'Searching messages...');
  const response = await sendWorker('SEARCH_MESSAGES', {
    query: trimmed,
    limit: 20,
    trackActivity: !state.connected || state.guideReviewOpen
  });

  if (!response?.success) {
    state.lastMailboxTrace = normalizeTraceEntries(response?.trace);
    state.lastMailboxSource = 'search-error';
    state.lastMailboxTimings = normalizeTimings(response?.timings);

    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => handleSearch(trimmed), {
        message: 'Search is waiting for the backend to wake up.'
      });
      return;
    }

    setStateCard('error', failureMessageForResponse(response, 'Search failed.'), true);
    return;
  }

  clearRetryTimer();
  state.mailboxMode = 'search';
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  state.lastMailboxSource = response.source || 'search';
  state.lastMailboxTimings = normalizeTimings(response?.timings);
  renderThreads();
}

function updateGuideProgressUI() {
  const guide = normalizeGuideState(state.guideState);
  const guideStepForUi = resolvedGuideStepForUi(guide);
  const stepNumber = stepNumberFromKey(guideStepForUi);
  const progressText = document.getElementById('gmailUnifiedGuideProgressText');
  if (progressText) {
    progressText.textContent = `Step ${stepNumber}/2 · ${guide.progress}/2 completed`;
  }

  const progressBar = document.getElementById('gmailUnifiedGuideProgressBar');
  const width = `${Math.max(0, Math.min(100, (guide.progress / 2) * 100))}%`;
  if (progressBar) progressBar.style.width = width;

  const guideCounter = document.getElementById('gmailUnifiedGuideCounterBadge');
  if (guideCounter) {
    guideCounter.textContent = `${guide.progress}/2`;
  }

  const stepNodes = document.querySelectorAll('.gmail-unified-guide-slide');
  stepNodes.forEach((node) => {
    const stepKey = String(node.dataset.step || '');
    node.classList.toggle('active', stepKey === guideStepForUi);
  });

  const welcomeBody = document.getElementById('gmailUnifiedWelcomeBody');
  if (welcomeBody) {
    welcomeBody.textContent = GUIDE_SUBSTEP_COPY.welcome.intro.body;
  }

  const connectBody = document.getElementById('gmailUnifiedConnectBody');
  if (connectBody) {
    connectBody.textContent =
      guide.substep === 'connect_submitted'
        ? GUIDE_SUBSTEP_COPY.connect_account.connect_submitted.body
        : GUIDE_SUBSTEP_COPY.connect_account.connect_ready.body;
  }

  const contextChip = document.getElementById('gmailUnifiedGuideContext');
  if (contextChip) {
    contextChip.textContent = `Current page: ${friendlyContextLabel(guide.currentContext || currentPageContext())}`;
  }

  renderActivityPanel();
}

async function refreshGuideAndAuthState() {
  const [storage, guide, uiSettings] = await Promise.all([
    sendWorker('GET_STORAGE'),
    sendWorker('GUIDE_GET_STATE'),
    readUiSettings()
  ]);

  state.connected = Boolean(storage?.success && storage.userId);
  state.guideState = normalizeGuideState(guide?.success ? guide.guideState : state.guideState);
  state.setupDiagnostics = normalizeSetupDiagnostics(storage?.setupDiagnostics);
  state.uiSettings = normalizeUiSettings(uiSettings);
  state.accountSnapshot = {
    userId: storage?.userId || '',
    userEmail: storage?.userEmail || '',
    lastSyncTime: storage?.lastSyncTime || '',
    onboardingComplete: Boolean(storage?.onboardingComplete)
  };

  if (!state.connected) {
    state.selectedThreadId = '';
    state.settingsOpen = false;
    state.settingsPreviewOpen = false;
    state.composer = defaultComposerState();
    state.mailboxMode = 'summary';
    state.useLegacyMailboxFallback = false;
    state.messages = [];
    state.lastMailboxTimings = normalizeTimings(null);
    resetSectionedMailboxCaches();
  }

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
  applyThemeSettings();

  const showGuide = !state.connected || state.guideReviewOpen;
  shell.hidden = !state.connected;
  onboardingOverlay.hidden = !showGuide;
  if (guideClose) guideClose.hidden = !state.connected || !state.guideReviewOpen;

  updateGuideProgressUI();
  renderSettingsUi();
  updateMainPanelVisibility();
}

function mapConnectError(response) {
  if (response?.code === 'AUTH_FAILED') {
    return 'Wrong email or App Password. Double-check the code from Google and try again.';
  }

  if (response?.code === 'CONNECTION_FAILED') {
    return "Can't reach Gmail. Check your internet connection.";
  }

  if (response?.code === 'BACKEND_COLD_START') {
    return 'The server is waking up (this takes ~60 seconds). Please wait and try again.';
  }

  return 'Something went wrong. Please try again.';
}

function setConnectUiState(status, error = false) {
  const statusNode = document.getElementById('gmailUnifiedConnectStatus');
  if (!statusNode) return;

  statusNode.textContent = status || '';
  statusNode.classList.toggle('is-error', Boolean(error));
  statusNode.classList.toggle('is-success', !error && Boolean(status));
}

async function connectFromGuide() {
  if (state.connectInFlight) return;

  const emailInput = document.getElementById('gmailUnifiedConnectEmail');
  const passInput = document.getElementById('gmailUnifiedConnectPassword');
  const connectBtn = document.getElementById('gmailUnifiedConnectBtn');

  const email = String(emailInput?.value || '').trim();
  const appPassword = String(passInput?.value || '').trim().replace(/\s+/g, '');

  if (!email || !appPassword) {
    await appendUiActivity({
      source: 'UI',
      level: 'warning',
      stage: 'connect_input_missing',
      message: 'Both Gmail address and App Password are required before connecting.'
    });
    setConnectUiState('Enter your Gmail address and app password to continue.', true);
    return;
  }

  state.connectInFlight = true;
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
  }
  setConnectUiState('Connecting...');
  await appendUiActivity({
    source: 'UI',
    level: 'info',
    stage: 'connect_button_clicked',
    message: 'Connect button clicked. Starting setup.'
  }, { reset: true });

  try {
    const response = await sendWorker('CONNECT', { email, appPassword });
    if (!response?.success) {
      setConnectUiState(mapConnectError(response), true);
      return;
    }

    if (passInput) {
      passInput.value = '';
    }

    await guideConfirm('connect_account', {
      substep: 'connect_submitted',
      reason: 'connect_submitted',
      evidence: {
        appPassword: {
          generatedAt: new Date().toISOString(),
          source: 'connect_submit'
        }
      }
    });
    setConnectUiState('Connected. Loading your messages...');
    state.connected = true;
    state.guideReviewOpen = false;
    const sidebar = document.getElementById('gmailUnifiedSidebar');
    sidebar?.classList.add('gmail-unified-unlocking');
    applyGmailLayoutMode();
    window.setTimeout(() => {
      sidebar?.classList.remove('gmail-unified-unlocking');
    }, 500);

    setTimeout(async () => {
      await refreshGuideAndAuthState();
      state.useLegacyMailboxFallback = false;
      state.mailboxMode = 'summary';
      resetSectionedMailboxCaches();
      applyGmailLayoutMode();
      await loadMessages({ forceSync: false, trackActivity: true });
      startAutoRefresh();
    }, 600);
  } finally {
    if (passInput) {
      passInput.value = '';
    }
    state.connectInFlight = false;
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect my account';
    }
  }
}

function bindGuideEvents(sidebar) {
  sidebar.querySelector('#gmailUnifiedGuideCloseBtn')?.addEventListener('click', () => {
    state.guideReviewOpen = false;
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedWelcomeStartBtn')?.addEventListener('click', async () => {
    appendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_app_passwords',
      message: 'Opened Google App Passwords.'
    }).catch(() => {});
    openExternalPage(APP_PASSWORDS_URL);
    await guideConfirm('welcome');
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedWelcomeTwoFactorBtn')?.addEventListener('click', () => {
    appendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_two_factor',
      message: 'Opened Google 2-Step Verification.'
    }).catch(() => {});
    openExternalPage(TWO_STEP_VERIFICATION_URL);
  });

  sidebar.querySelector('#gmailUnifiedConnectBtn')?.addEventListener('click', async () => {
    await connectFromGuide();
  });

  sidebar.querySelector('#gmailUnifiedConnectOpenAppBtn')?.addEventListener('click', () => {
    appendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_app_passwords',
      message: 'Opened Google App Passwords from Step 2.'
    }).catch(() => {});
    openExternalPage(APP_PASSWORDS_URL);
  });

  sidebar.querySelector('#gmailUnifiedConnectOpenTwoFactorBtn')?.addEventListener('click', () => {
    appendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_two_factor',
      message: 'Opened Google 2-Step Verification from Step 2.'
    }).catch(() => {});
    openExternalPage(TWO_STEP_VERIFICATION_URL);
  });

  sidebar.querySelector('#gmailUnifiedConnectPassword')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await connectFromGuide();
    }
  });

  sidebar.querySelectorAll('.gmail-unified-filter-btn').forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  const searchInput = sidebar.querySelector('#gmailUnifiedSearchInput');
  searchInput?.addEventListener('input', (event) => {
    clearTimeout(searchDebounce);
    const value = event.target.value;
    searchDebounce = setTimeout(() => {
      handleSearch(value);
    }, 400);
  });

  sidebar.querySelector('#gmailUnifiedRetryBtn')?.addEventListener('click', () => {
    loadMessages({ forceSync: false, trackActivity: true });
  });

  sidebar.querySelector('#gmailUnifiedBackBtn')?.addEventListener('click', () => {
    state.selectedThreadId = '';
    state.composer = defaultComposerState();
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
    renderThreadDebug(null);
    renderThreads();
    updateMainPanelVisibility();
  });

  sidebar.querySelector('#gmailUnifiedCopyDebugBtn')?.addEventListener('click', async () => {
    const log = document.getElementById('gmailUnifiedDebugLog');
    const button = document.getElementById('gmailUnifiedCopyDebugBtn');
    if (!log || !button) return;

    try {
      await navigator.clipboard.writeText(log.value || '');
      button.textContent = 'Copied';
      window.setTimeout(() => {
        button.textContent = 'Copy log';
      }, 1200);
    } catch {
      button.textContent = 'Select text';
      window.setTimeout(() => {
        button.textContent = 'Copy log';
      }, 1200);
    }

    updateMainPanelVisibility();
  });

  const settingsButton = sidebar.querySelector('#gmailUnifiedSettingsBtn');
  const settingsPreview = sidebar.querySelector('#gmailUnifiedSettingsPreview');
  const settingsPanel = sidebar.querySelector('#gmailUnifiedSettingsPanel');

  settingsButton?.addEventListener('mouseenter', () => {
    if (!settingsHoverAllowed() || state.settingsOpen) return;
    setSettingsPreviewOpen(true);
  });

  settingsButton?.addEventListener('mouseleave', () => {
    if (!settingsHoverAllowed() || state.settingsOpen) return;
    scheduleSettingsPreviewClose();
  });

  settingsButton?.addEventListener('focus', () => {
    if (!settingsHoverAllowed() || state.settingsOpen) return;
    setSettingsPreviewOpen(true);
  });

  settingsButton?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSettingsPanelOpen(!state.settingsOpen);
  });

  settingsPreview?.addEventListener('mouseenter', () => {
    clearSettingsPreviewTimer();
    if (settingsHoverAllowed() && !state.settingsOpen) {
      state.settingsPreviewOpen = true;
      applyGmailLayoutMode();
    }
  });

  settingsPreview?.addEventListener('mouseleave', () => {
    if (state.settingsOpen) return;
    scheduleSettingsPreviewClose();
  });

  sidebar.querySelector('#gmailUnifiedSettingsOpenPreviewBtn')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    setSettingsPanelOpen(true);
  });

  sidebar.querySelector('#gmailUnifiedSettingsCloseBtn')?.addEventListener('click', () => {
    setSettingsPanelOpen(false);
  });

  sidebar.querySelectorAll('[data-settings-tab]').forEach((button) => {
    button.addEventListener('click', () => setActiveSettingsTab(button.dataset.settingsTab));
  });

  sidebar.querySelectorAll('[data-theme-mode]').forEach((button) => {
    button.addEventListener('click', async () => {
      await persistUiSettings({
        ...state.uiSettings,
        themeMode: button.dataset.themeMode
      });
      applyGmailLayoutMode();
    });
  });

  sidebar.querySelector('#gmailUnifiedToggleDebug')?.addEventListener('change', async (event) => {
    await persistUiSettings({
      ...state.uiSettings,
      showDebugPanel: Boolean(event.target.checked)
    });
    applyGmailLayoutMode();
    const group = findSelectedGroup();
    if (group) renderThreadDetail(group);
  });

  sidebar.querySelector('#gmailUnifiedToggleRemoteImages')?.addEventListener('change', async (event) => {
    await persistUiSettings({
      ...state.uiSettings,
      loadRemoteImages: Boolean(event.target.checked)
    });
    applyGmailLayoutMode();
    const group = findSelectedGroup();
    if (group) renderThreadDetail(group);
  });

  sidebar.querySelector('#gmailUnifiedToggleConfirmLinks')?.addEventListener('change', async (event) => {
    await persistUiSettings({
      ...state.uiSettings,
      confirmExternalLinks: Boolean(event.target.checked)
    });
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedSettingsGuideBtn')?.addEventListener('click', () => {
    state.guideReviewOpen = true;
    setSettingsPanelOpen(false);
    appendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'guide_opened',
      message: 'Guided setup activity log reopened.'
    }).catch(() => {});
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedSettingsDisconnectBtn')?.addEventListener('click', async () => {
    const response = await sendWorker('DISCONNECT');
    if (!response?.success) return;
    state.messages = [];
    resetSectionedMailboxCaches();
    state.selectedThreadId = '';
    state.composer = defaultComposerState();
    state.useLegacyMailboxFallback = false;
    state.mailboxMode = 'summary';
    await refreshGuideAndAuthState();
    applyGmailLayoutMode();
    renderThreads();
    renderThreadDebug(null);
  });

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

  sidebar.querySelector('#gmailUnifiedDetailBody')?.addEventListener('click', (event) => {
    const anchor = event.target.closest('a[data-mailita-link]');
    if (anchor) {
      event.preventDefault();
      event.stopPropagation();
      const href = String(anchor.getAttribute('href') || '').trim();
      if (href) {
        openExternalPage(href);
      }
      return;
    }

    const actionButton = event.target.closest('[data-message-action]');
    if (!actionButton) return;
    state.composer.targetMessageId = actionButton.dataset.messageId || '';
    state.composer.mode = actionButton.dataset.messageAction === 'reply_all' ? 'reply_all' : 'reply';
    const group = findSelectedGroup();
    if (group) {
      renderThreadDetail(group);
      document.getElementById('gmailUnifiedComposerInput')?.focus();
    }
  });

  document.addEventListener('pointerdown', (event) => {
    const target = event.target;
    if (!(target instanceof Node)) return;
    const insideSettings = settingsButton?.contains(target) || settingsPreview?.contains(target) || settingsPanel?.contains(target);
    if (!insideSettings && state.settingsOpen) {
      setSettingsPanelOpen(false);
    }
  });
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
            <div class="gmail-unified-wordmark">Mailita</div>
            <div id="gmailUnifiedRailContext" class="gmail-unified-rail-context">Inbox</div>
          </div>
          <div class="gmail-unified-search">
            <input id="gmailUnifiedSearchInput" type="text" placeholder="Search messages..." />
          </div>
          <div class="gmail-unified-filters">
            <button class="gmail-unified-filter-btn active" data-filter="all">All</button>
            <button class="gmail-unified-filter-btn" data-filter="inbox">Inbox</button>
            <button class="gmail-unified-filter-btn" data-filter="sent">Sent</button>
          </div>
          <div id="gmailUnifiedStateCard" class="gmail-unified-state-card" data-state="loading">
            <div id="gmailUnifiedStateText">Connecting to Gmail...</div>
            <button id="gmailUnifiedRetryBtn" class="gmail-unified-retry" type="button">Retry now</button>
            <div id="gmailUnifiedCountdown" class="gmail-unified-countdown"></div>
          </div>
          <div id="gmailUnifiedList" class="gmail-unified-list"></div>
          <div class="gmail-unified-left-footer">
            <div class="gmail-unified-settings-anchor gmail-unified-settings-anchor-footer">
              <button id="gmailUnifiedSettingsBtn" class="gmail-unified-secondary-btn gmail-unified-settings-launch" type="button" aria-label="Settings">
                Settings
              </button>
              <div id="gmailUnifiedSettingsPreview" class="gmail-unified-settings-preview gmail-unified-settings-preview-footer" hidden>
                <div class="gmail-unified-settings-preview-row" id="gmailUnifiedSettingsPreviewTheme">Theme · Dark</div>
                <div class="gmail-unified-settings-preview-row" id="gmailUnifiedSettingsPreviewPrivacy">Privacy · debug panel hidden</div>
                <div class="gmail-unified-settings-preview-row" id="gmailUnifiedSettingsPreviewAccount">Account · not connected</div>
                <button id="gmailUnifiedSettingsOpenPreviewBtn" class="gmail-unified-secondary-btn gmail-unified-settings-preview-cta" type="button">
                  Open settings
                </button>
              </div>
            </div>
          </div>
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
              <button id="gmailUnifiedBackBtn" class="gmail-unified-back">← Back</button>
              <div class="gmail-unified-detail-head-copy">
                <div id="gmailUnifiedDetailHeader"></div>
                <div id="gmailUnifiedDetailSubheader" class="gmail-unified-detail-subheader"></div>
              </div>
            </div>
            <div id="gmailUnifiedDetailBody" class="gmail-unified-detail-body"></div>
            <div id="gmailUnifiedComposer" class="gmail-unified-composer">
              <div class="gmail-unified-composer-top">
                <div class="gmail-unified-composer-modes">
                  <button id="gmailUnifiedComposerReply" class="gmail-unified-composer-mode is-active" type="button">Reply</button>
                  <button id="gmailUnifiedComposerReplyAll" class="gmail-unified-composer-mode" type="button">Reply all</button>
                </div>
                <div id="gmailUnifiedComposerStatus" class="gmail-unified-composer-status" data-state="idle"></div>
              </div>
              <div class="gmail-unified-composer-row">
                <textarea id="gmailUnifiedComposerInput" class="gmail-unified-composer-input" placeholder="Write your reply..." spellcheck="true"></textarea>
                <button id="gmailUnifiedComposerSend" class="gmail-unified-primary-btn gmail-unified-composer-send" type="button">Send</button>
              </div>
            </div>
          </section>
        </section>
        <aside id="gmailUnifiedSettingsPanel" class="gmail-unified-settings-panel" hidden>
          <div class="gmail-unified-settings-panel-head">
            <div>
              <div class="gmail-unified-settings-kicker">Mailita settings</div>
              <h3>Preferences</h3>
            </div>
            <button id="gmailUnifiedSettingsCloseBtn" class="gmail-unified-icon-btn" type="button" aria-label="Close settings">✕</button>
          </div>
          <div class="gmail-unified-settings-tabs">
            <button class="gmail-unified-settings-tab is-active" data-settings-tab="theme" type="button">Theme</button>
            <button class="gmail-unified-settings-tab" data-settings-tab="privacy" type="button">Privacy</button>
            <button class="gmail-unified-settings-tab" data-settings-tab="account" type="button">Account</button>
          </div>
          <div class="gmail-unified-settings-content">
            <section class="gmail-unified-settings-section" data-settings-section="theme">
              <h4>Theme</h4>
              <p>Choose the Mailita material direction that should drive the whole shell.</p>
              <div class="gmail-unified-theme-options">
                <button class="gmail-unified-theme-option is-active" data-theme-mode="dark" type="button">Dark</button>
                <button class="gmail-unified-theme-option" data-theme-mode="khaki" type="button">Khaki</button>
                <button class="gmail-unified-theme-option" data-theme-mode="system" type="button">System</button>
              </div>
            </section>
            <section class="gmail-unified-settings-section" data-settings-section="privacy" hidden>
              <h4>Privacy</h4>
              <label class="gmail-unified-setting-toggle">
                <span>Show temporary debug panel</span>
                <input id="gmailUnifiedToggleDebug" type="checkbox" />
              </label>
              <label class="gmail-unified-setting-toggle">
                <span>Load remote images automatically</span>
                <input id="gmailUnifiedToggleRemoteImages" type="checkbox" />
              </label>
              <label class="gmail-unified-setting-toggle">
                <span>Confirm before opening external links</span>
                <input id="gmailUnifiedToggleConfirmLinks" type="checkbox" />
              </label>
              <section id="gmailUnifiedDebugPanel" class="gmail-unified-debug-panel" hidden>
                <div class="gmail-unified-debug-header">
                  <div>
                    <div class="gmail-unified-debug-kicker">Temporary Debug Log</div>
                    <div id="gmailUnifiedDebugSummary" class="gmail-unified-debug-summary">
                      Open a conversation to inspect exactly what the UI received.
                    </div>
                    <div id="gmailUnifiedDebugStatus" class="gmail-unified-debug-status" hidden></div>
                  </div>
                  <button id="gmailUnifiedCopyDebugBtn" class="gmail-unified-secondary-btn gmail-unified-debug-copy" type="button">
                    Copy log
                  </button>
                </div>
                <textarea
                  id="gmailUnifiedDebugLog"
                  class="gmail-unified-debug-log"
                  readonly
                  spellcheck="false"
                >Select a conversation to generate a debug report.</textarea>
              </section>
            </section>
            <section class="gmail-unified-settings-section" data-settings-section="account" hidden>
              <h4>Account</h4>
              <div class="gmail-unified-account-card">
                <div id="gmailUnifiedAccountStatus" class="gmail-unified-account-status" data-connected="false">Setup required</div>
                <div id="gmailUnifiedSettingsEmail" class="gmail-unified-account-email">Not connected</div>
                <div class="gmail-unified-account-meta">Last sync · <span id="gmailUnifiedSettingsSyncTime">No sync yet</span></div>
              </div>
              <div class="gmail-unified-account-actions">
                <button id="gmailUnifiedSettingsGuideBtn" class="gmail-unified-secondary-btn" type="button">Open guide</button>
                <button id="gmailUnifiedSettingsDisconnectBtn" class="gmail-unified-secondary-btn gmail-unified-danger-btn" type="button">Disconnect</button>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </div>

    <section id="gmailUnifiedOnboardingOverlay" class="gmail-unified-onboarding-overlay" hidden>
      <div class="gmail-unified-modal">
        <header class="gmail-unified-modal-header">
          <div>
            <div class="gmail-unified-modal-kicker">Guided setup</div>
            <h2>Connect Mailita</h2>
          </div>
          <div class="gmail-unified-modal-right">
            <span id="gmailUnifiedGuideCounterBadge" class="gmail-unified-counter-badge">0/2</span>
            <button id="gmailUnifiedGuideCloseBtn" class="gmail-unified-guide-close-modal" hidden>Close</button>
          </div>
        </header>
        <div class="gmail-unified-progress-wrap">
          <div id="gmailUnifiedGuideProgressText" class="gmail-unified-progress-text">Step 1/2 · 0/2 completed</div>
          <div class="gmail-unified-progress-track"><div id="gmailUnifiedGuideProgressBar" class="gmail-unified-progress-fill"></div></div>
          <div id="gmailUnifiedGuideContext" class="gmail-unified-guide-context">Current page: Gmail inbox</div>
        </div>

        <article class="gmail-unified-guide-slide active" data-step="welcome">
          <h3>Step 1: Before you connect</h3>
          <p id="gmailUnifiedWelcomeBody">Use this step to turn on 2-Step Verification if needed, then create your Gmail App Password.</p>
          <ol>
            <li>Open Google App Passwords.</li>
            <li>If Google says App Passwords is unavailable, turn on <strong>2-Step Verification</strong> first.</li>
            <li>Create a new password for <strong>Mailita</strong> and copy the 16-character code.</li>
            <li>Come back here and connect with your Gmail address and that code.</li>
          </ol>
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedWelcomeStartBtn" class="gmail-unified-primary-btn">Open App Passwords</button>
          </div>
          <div class="gmail-unified-guide-helper">
            <span>Need to turn on 2-Step Verification first?</span>
            <button id="gmailUnifiedWelcomeTwoFactorBtn" class="gmail-unified-link-btn" type="button">
              Open 2-Step Verification
            </button>
          </div>
        </article>

        <article class="gmail-unified-guide-slide" data-step="connect_account">
          <h3>Step 2: Connect account</h3>
          <p id="gmailUnifiedConnectBody">Paste the Gmail address you want to sync and the 16-character App Password from Google.</p>
          <label for="gmailUnifiedConnectEmail" class="gmail-unified-field-label">Gmail address</label>
          <input id="gmailUnifiedConnectEmail" class="gmail-unified-field" type="email" placeholder="you@gmail.com" />
          <label for="gmailUnifiedConnectPassword" class="gmail-unified-field-label">App password</label>
          <input id="gmailUnifiedConnectPassword" class="gmail-unified-field" type="password" placeholder="xxxx xxxx xxxx xxxx" />
          <div class="gmail-unified-guide-actions gmail-unified-connect-actions">
            <button id="gmailUnifiedConnectBtn" class="gmail-unified-primary-btn">Connect my account</button>
            <button id="gmailUnifiedConnectOpenAppBtn" class="gmail-unified-secondary-btn" type="button">
              Open App Passwords
            </button>
          </div>
          <div class="gmail-unified-guide-helper">
            <span>Need 2-Step Verification first?</span>
            <button id="gmailUnifiedConnectOpenTwoFactorBtn" class="gmail-unified-link-btn" type="button">
              Open 2-Step Verification
            </button>
          </div>
          <div id="gmailUnifiedConnectStatus" class="gmail-unified-connect-status"></div>
        </article>

        ${buildActivityPanelMarkup()}
      </div>
    </section>
  `;

  document.body.appendChild(sidebar);
  bindGuideEvents(sidebar);

  updateMainPanelVisibility();
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) return;

  state.autoRefreshTimer = setInterval(() => {
    if (document.hidden || !state.connected) return;
    sendWorker('SYNC_MESSAGES', { trackActivity: false }).catch(() => {});
  }, 10 * 60 * 1000);
}

async function bootGmailSurface() {
  buildSidebar();
  await refreshGuideAndAuthState();
  applyGmailLayoutMode();

  if (state.connected) {
    await loadMessages();
    sendWorker('SYNC_MESSAGES', { trackActivity: false }).catch(() => {});
    startAutoRefresh();
  }

  window.addEventListener('hashchange', async () => {
    if (!state.connected || state.guideReviewOpen) {
      await refreshGuideAndAuthState();
    }
    applyGmailLayoutMode();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
      refreshGuideAndAuthState()
        .then(async () => {
          applyGmailLayoutMode();
          if (state.connected && state.messages.length === 0 && state.contactSummaries.length === 0) {
            await loadMessages();
          }
        })
        .catch(() => {});
    }
    if (changes.lastSyncTime && state.connected && !state.searchQuery && !usingLegacyMailboxFlow()) {
      state.accountSnapshot.lastSyncTime = changes.lastSyncTime.newValue || '';
      renderSettingsUi();
      loadMessageSummaries({
        forceSync: false,
        trackActivity: false,
        silent: true
      }).catch(() => {});
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

  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (normalizeUiSettings(state.uiSettings).themeMode === 'system') {
      applyGmailLayoutMode();
    }
  });
}

if (isMailHost()) {
  waitForGmail(() => {
    bootGmailSurface().catch(() => {});
  });
}
