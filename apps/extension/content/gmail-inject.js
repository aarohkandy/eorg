const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';
const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords';
const TWO_STEP_VERIFICATION_URL = 'https://myaccount.google.com/signinoptions/two-step-verification';
// Flip this off when we're ready to remove the onboarding activity panel.
const SHOW_ACTIVITY_PANEL = true;

const GUIDE_STEPS = ['welcome', 'connect_account'];
const GUIDE_STEP_SET = new Set(GUIDE_STEPS);
const GUIDE_SUBSTEP_COPY = {
  welcome: {
    intro: {
      title: 'Welcome to Gmail Unified',
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
  connectInFlight: false
};

function isMailHost() {
  return window.location.hostname.includes('mail.google.com');
}

function sendWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

function openExternalPage(url) {
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

function threadIdToContactEmail(threadId) {
  const value = String(threadId || '').trim();
  return value.startsWith('contact:') ? value.slice('contact:'.length) : '';
}

function getGroupContactEmail(group) {
  const fromThreadId = threadIdToContactEmail(group?.threadId);
  if (fromThreadId) return fromThreadId;

  const messages = Array.isArray(group?.messages) ? group.messages : [];
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
  if (message?.isOutgoing) {
    return message.to?.[0]?.name || message.to?.[0]?.email || 'Unknown recipient';
  }

  return message?.from?.name || message?.from?.email || 'Unknown sender';
}

function threadCounterpartyKey(message) {
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

function findSelectedGroup() {
  if (!state.selectedThreadId) return null;
  return groupByThread(filteredMessages()).find((group) => group.threadId === state.selectedThreadId) || null;
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
  const text = String(message?.snippet || '').trim();
  if (!text) return 'missing';
  if (text.length < 40) return 'short';
  return 'present';
}

function buildDebugDiagnosis(group, traceEntries) {
  const messages = Array.isArray(group?.messages) ? group.messages : [];
  const missingCount = messages.filter((message) => snippetHealth(message) === 'missing').length;
  const shortCount = messages.filter((message) => snippetHealth(message) === 'short').length;
  const contactDebug = getContactDebugState(group?.threadId);
  const stages = new Set((traceEntries || []).map((entry) => entry.stage));

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
  const traceEntries = mergeTraceEntries(state.lastMailboxTrace, contactDebug.trace);
  const messages = [...(group?.messages || [])].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const selectedContactEmail = getGroupContactEmail(group);
  const backendInfo = contactDebug.attempted
    ? normalizeBuildInfo(contactDebug.backend)
    : normalizeBuildInfo(mailboxDebug.backend);
  const lines = [
    'MAILITA TEMP DEBUG',
    `generated_at: ${new Date().toISOString()}`,
    `trace_source: ${contactDebug.attempted ? 'mailbox+contact_debug' : (state.lastMailboxSource || 'mailbox')}`,
    `selected_thread_id: ${group?.threadId || 'none'}`,
    `selected_contact: ${selectedContactEmail || '(no contact email)'}`,
    `selected_subject: ${group?.messages?.[0]?.subject || '(no subject)'}`,
    `message_count: ${messages.length}`,
    `diagnosis: ${buildDebugDiagnosis(group, traceEntries)}`,
    ''
  ];

  lines.push('backend:');
  lines.push(`  version: ${backendInfo.version}`);
  lines.push(`  build_sha: ${backendInfo.buildSha}`);
  lines.push(`  deployed_at: ${backendInfo.deployedAt || 'unknown'}`);
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
      lines.push(`    downloaded_bytes: ${entry.downloadedBytes ?? 0}`);
      lines.push(`    parser_source: ${entry.parserSource || 'none'}`);
      lines.push(`    raw_text_length: ${entry.rawTextLength ?? 0}`);
      lines.push(`    sanitized_length: ${entry.sanitizedLength ?? 0}`);
      lines.push(`    empty_reason: ${entry.emptyReason || 'unknown'}`);
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
  const counts = messageContentCounts(group.messages);

  if (contactDebug.inFlight) {
    status.hidden = false;
    status.textContent = 'Refreshing this conversation live from Gmail...';
  } else {
    status.hidden = true;
    status.textContent = '';
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

  const threadGroups = groupByThread(filteredMessages());

  if (!threadGroups.length) {
    setStateCard('empty', 'No messages found.');
    return;
  }

  setStateCard('normal', '');

  list.innerHTML = '';

  threadGroups.forEach((group) => {
    const latest = group.messages[0];
    const unread = group.messages.some(isUnread);

    const row = document.createElement('button');
    row.className = 'gmail-unified-thread-row';
    row.type = 'button';
    row.dataset.threadId = group.threadId;

    const who = threadCounterparty(latest);

    row.innerHTML = `
      <div class="gmail-unified-thread-top">
        <span class="gmail-unified-thread-who ${unread ? 'unread' : ''}">${escapeHtml(who)}</span>
        <span class="gmail-unified-date">${formatDate(latest.date)}</span>
      </div>
      <div class="gmail-unified-thread-subject ${unread ? 'unread' : ''}">${escapeHtml(
      latest.subject || '(no subject)'
    )}</div>
    `;

    row.addEventListener('click', () => {
      state.selectedThreadId = group.threadId;
      renderThreadDetail(group);
    });

    list.appendChild(row);
  });

  console.log(`[Extension] Rendering message list - ${threadGroups.length} items`);
  renderThreadDebug(findSelectedGroup());
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
  if (!detail || !header || !body) return;

  detail.style.display = 'block';
  header.textContent = threadCounterparty(group.messages[0]);

  body.innerHTML = '';

  [...group.messages]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((message) => {
      const item = document.createElement('div');
      item.className = `gmail-unified-message ${message.isOutgoing ? 'outgoing' : 'incoming'}`;

      const who = message.isOutgoing
        ? `You -> ${message.to?.[0]?.name || message.to?.[0]?.email || 'recipient'}`
        : `${message.from?.name || message.from?.email || 'sender'} -> You`;

      item.innerHTML = `
      <div class="gmail-unified-message-meta">
        <span>${escapeHtml(who)}</span>
        <span>${formatDate(message.date)}</span>
      </div>
      <div class="gmail-unified-message-snippet">${escapeHtml(message.snippet || '(message content unavailable)')}</div>
    `;

      body.appendChild(item);
    });

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

async function loadMessages(options = {}) {
  setStateCard('loading', 'Connecting to Gmail...');

  const response = await sendWorker('FETCH_MESSAGES', {
    folder: options.folder || 'all',
    limit: 50,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  if (!response?.success) {
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

    setStateCard('error', response.error || 'Unable to load messages right now.', true);
    return;
  }

  clearRetryTimer();
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  if (response.debug) {
    state.lastMailboxDebug = normalizeMailboxDebug(response.debug);
  }
  state.lastMailboxSource = 'mailbox';

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

function setFilter(filter) {
  state.filter = filter;

  const buttons = document.querySelectorAll('.gmail-unified-filter-btn');
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });

  const visible = filteredMessages().length;
  console.log(`[Extension] Filter changed to: ${filter} - showing ${visible} messages`);
  renderThreads();
}

let searchDebounce = null;
async function handleSearch(query) {
  const trimmed = String(query || '').trim();
  state.searchQuery = trimmed;

  if (!trimmed) {
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
    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => handleSearch(trimmed), {
        message: 'Search is waiting for the backend to wake up.'
      });
      return;
    }

    setStateCard('error', response.error || 'Search failed.', true);
    return;
  }

  clearRetryTimer();
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  state.lastMailboxTrace = normalizeTraceEntries(response.trace);
  state.lastMailboxSource = response.source || 'search';
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
  const [storage, guide] = await Promise.all([sendWorker('GET_STORAGE'), sendWorker('GUIDE_GET_STATE')]);

  state.connected = Boolean(storage?.success && storage.userId);
  state.guideState = normalizeGuideState(guide?.success ? guide.guideState : state.guideState);
  state.setupDiagnostics = normalizeSetupDiagnostics(storage?.setupDiagnostics);

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

  const showGuide = !state.connected || state.guideReviewOpen;
  shell.hidden = !state.connected;
  onboardingOverlay.hidden = !showGuide;
  if (guideClose) guideClose.hidden = !state.connected || !state.guideReviewOpen;

  updateGuideProgressUI();
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
  sidebar.querySelector('#gmailUnifiedGuideBtn')?.addEventListener('click', () => {
    if (!state.connected) return;
    state.guideReviewOpen = true;
    appendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'guide_opened',
      message: 'Guided setup activity log reopened.'
    }).catch(() => {});
    applyGmailLayoutMode();
  });

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

  sidebar.querySelector('#gmailUnifiedSync')?.addEventListener('click', async () => {
    if (!state.connected) return;

    const result = await sendWorker('SYNC_MESSAGES', {
      trackActivity: state.guideReviewOpen
    });
    if (!result?.success) {
      if (result.code === 'BACKEND_COLD_START') {
        startColdStartCountdown(() => loadMessages({ forceSync: true, trackActivity: state.guideReviewOpen }), {
          message: 'Manual sync is waiting for the backend to wake up.'
        });
        return;
      }

      setStateCard('error', result.error || 'Sync failed.', true);
      return;
    }

    await loadMessages({ forceSync: true, trackActivity: state.guideReviewOpen });
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
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
    renderThreadDebug(null);
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
}

function buildSidebar() {
  if (document.getElementById('gmailUnifiedSidebar')) return;

  const sidebar = document.createElement('aside');
  sidebar.id = 'gmailUnifiedSidebar';
  sidebar.innerHTML = `
    <div id="gmailUnifiedShell" class="gmail-unified-shell">
      <section class="gmail-unified-left">
        <div class="gmail-unified-header">
          <h3>Gmail Unified</h3>
          <div class="gmail-unified-header-actions">
            <button id="gmailUnifiedGuideBtn" class="gmail-unified-guide-btn" type="button">Guide me</button>
            <button id="gmailUnifiedSync" class="gmail-unified-sync" type="button">↻ Sync</button>
          </div>
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
      </section>
      <section class="gmail-unified-main">
        <div id="gmailUnifiedMainEmpty" class="gmail-unified-main-empty">Select a conversation</div>
        <section id="gmailUnifiedDetail" class="gmail-unified-detail" style="display:none;">
          <div class="gmail-unified-detail-head">
            <button id="gmailUnifiedBackBtn" class="gmail-unified-back">← Back</button>
            <div id="gmailUnifiedDetailHeader"></div>
          </div>
          <div id="gmailUnifiedDetailBody" class="gmail-unified-detail-body"></div>
          <section class="gmail-unified-debug-panel">
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
      </section>
    </div>

    <section id="gmailUnifiedOnboardingOverlay" class="gmail-unified-onboarding-overlay" hidden>
      <div class="gmail-unified-modal">
        <header class="gmail-unified-modal-header">
          <div>
            <div class="gmail-unified-modal-kicker">Guided setup</div>
            <h2>Connect Gmail Unified</h2>
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
            <li>Create a new password for <strong>Gmail Unified</strong> and copy the 16-character code.</li>
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
    loadMessages();
  }, 5 * 60 * 1000);
}

async function bootGmailSurface() {
  buildSidebar();
  await refreshGuideAndAuthState();
  applyGmailLayoutMode();

  if (state.connected) {
    await loadMessages();
    startAutoRefresh();
  }

  window.addEventListener('hashchange', async () => {
    await refreshGuideAndAuthState();
    applyGmailLayoutMode();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
      refreshGuideAndAuthState()
        .then(async () => {
          applyGmailLayoutMode();
          if (state.connected && state.messages.length === 0) {
            await loadMessages();
          }
        })
        .catch(() => {});
    }
    if (changes.setupDiagnostics) {
      state.setupDiagnostics = normalizeSetupDiagnostics(changes.setupDiagnostics.newValue);
      renderActivityPanel();
    }
  });
}

if (isMailHost()) {
  waitForGmail(() => {
    bootGmailSurface().catch(() => {});
  });
}
