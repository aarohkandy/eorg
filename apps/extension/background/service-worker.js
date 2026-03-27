/* global chrome */

if (typeof importScripts === 'function') {
  importScripts('gmail-local.js');
}

const MailitaGmailLocal = globalThis.MailitaGmailLocal || {
  oauthClientConfigured: () => false,
  connect: async () => {
    throw new Error('Mailita Gmail local adapter is unavailable.');
  },
  disconnect: async () => {},
  loadSummaries: async () => ({ summaries: [], count: 0, source: 'gmail_api_local' }),
  loadContact: async () => ({ messages: [], count: 0, source: 'gmail_api_local_contact' }),
  loadContactBodies: async () => ({ messages: [], count: 0, source: 'gmail_api_local_contact_bodies' }),
  sendMessage: async () => {
    throw new Error('Mailita Gmail local send adapter is unavailable.');
  },
  search: async () => ({ messages: [], count: 0, source: 'gmail_api_local_search' }),
  refreshIncremental: async () => ({
    changed: false,
    fullResync: false,
    messages: [],
    lastHistoryId: '',
    lastSyncTime: ''
  }),
  snapshot: async () => ({
    accountEmail: '',
    grantedScopes: [],
    lastHistoryId: '',
    lastSyncTime: ''
  })
};

const BACKEND_URL = 'http://localhost:7676';
const FETCH_TIMEOUT_MS = 12000;
const SYNC_FETCH_TIMEOUT_MS = 10000;
const SYNC_STATUS_POLL_MS = 4000;
const SYNC_ALARM_NAME = 'mailita-sync-cadence';
const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';
const SETUP_DIAGNOSTICS_KEY = 'setupDiagnostics';
const MAX_SETUP_DIAGNOSTIC_ENTRIES = 10;
const WRAPPER_FAILURE_STAGES = new Set([
  'auth_request_failed',
  'auth_disconnect_failed',
  'connect_failed',
  'disconnect_failed',
  'messages_fetch_failed',
  'messages_search_failed',
  'messages_sync_failed',
  'message_summaries_failed',
  'contact_messages_failed',
  'messages_failed',
  'search_failed',
  'sync_failed',
  'health_check_failed'
]);
const MAIL_SOURCE_GMAIL_API_LOCAL = 'gmail_api_local';
const MAIL_SOURCE_IMAP_BACKEND = 'imap_backend';
const DEFAULT_MAIL_SOURCE = MAIL_SOURCE_GMAIL_API_LOCAL;

const GUIDE_STEPS = ['connect_account'];
const GUIDE_STEP_SET = new Set(GUIDE_STEPS);
const GUIDE_STEP_ORDER = {
  connect_account: 0
};
const GUIDE_SUBSTEPS = {
  connect_account: new Set(['connect_ready', 'connect_submitted', 'connected']),
  connected: new Set(['connected'])
};

const GUIDE_ACTIONS = new Set([
  'CONNECT_GOOGLE',
  'DISCONNECT_GOOGLE',
  'CONNECT',
  'DISCONNECT',
  'FETCH_MESSAGE_SUMMARIES',
  'FETCH_CONTACT_MESSAGES',
  'FETCH_CONTACT_BODIES',
  'SEND_MESSAGE',
  'FETCH_MESSAGES',
  'DEBUG_REFETCH_CONTACT',
  'SEARCH_MESSAGES',
  'SYNC_MESSAGES',
  'HEALTH_CHECK',
  'DIAGNOSTICS_LOG',
  'GET_STORAGE',
  'GUIDE_GET_STATE',
  'GUIDE_NAVIGATE_TO_STEP',
  'GUIDE_CONFIRM_STEP',
  'GUIDE_RESET'
]);

let diagnosticsWriteChain = Promise.resolve();
const activeSyncPollers = new Map();
const FETCH_QUEUE_CONCURRENCY = 2;
const FETCH_PRIORITY_ORDER = {
  P0: 0,
  P1: 1,
  P2: 2,
  P3: 3
};
const fetchQueue = {
  counter: 0,
  pending: [],
  active: new Map(),
  idleTimer: null,
  pumpScheduled: false,
  lastUserActivityAt: Date.now()
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeFetchPriority(value) {
  return Object.prototype.hasOwnProperty.call(FETCH_PRIORITY_ORDER, value) ? value : 'P0';
}

function createFetchAbortError(message = 'Gmail API request was aborted.') {
  const error = new Error(message);
  error.code = 'GMAIL_API_ABORTED';
  return error;
}

function rejectFetchJob(job, error) {
  try {
    job.reject(error);
  } catch {
    // Ignore late rejections if the caller already disconnected.
  }
}

function clearFetchIdleTimer() {
  if (fetchQueue.idleTimer) {
    clearTimeout(fetchQueue.idleTimer);
    fetchQueue.idleTimer = null;
  }
}

function scheduleFetchPump(delayMs = 0) {
  if (delayMs > 0) {
    clearFetchIdleTimer();
    fetchQueue.idleTimer = setTimeout(() => {
      fetchQueue.idleTimer = null;
      pumpFetchQueue();
    }, delayMs);
    return;
  }
  if (fetchQueue.pumpScheduled) return;
  fetchQueue.pumpScheduled = true;
  queueMicrotask(() => {
    fetchQueue.pumpScheduled = false;
    pumpFetchQueue();
  });
}

function compareFetchJobs(left, right) {
  const leftPriority = FETCH_PRIORITY_ORDER[left.priority] ?? FETCH_PRIORITY_ORDER.P3;
  const rightPriority = FETCH_PRIORITY_ORDER[right.priority] ?? FETCH_PRIORITY_ORDER.P3;
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return left.enqueuedAt - right.enqueuedAt;
}

function hasUrgentFetchWork() {
  const jobs = [
    ...fetchQueue.pending,
    ...fetchQueue.active.values()
  ];
  return jobs.some((job) => job.priority === 'P0' || job.priority === 'P1');
}

function canRunFetchJob(job) {
  if (job.priority !== 'P3') return true;
  if (hasUrgentFetchWork()) return false;
  const idleForMs = Date.now() - fetchQueue.lastUserActivityAt;
  return idleForMs >= 2000;
}

function cancelFetchJobs(predicate, reason = 'Gmail API request was aborted.') {
  const nextPending = [];
  fetchQueue.pending.forEach((job) => {
    if (!predicate(job)) {
      nextPending.push(job);
      return;
    }
    rejectFetchJob(job, createFetchAbortError(reason));
  });
  fetchQueue.pending = nextPending;

  fetchQueue.active.forEach((job) => {
    if (!predicate(job)) return;
    try {
      job.controller.abort(reason);
    } catch {
      job.controller.abort();
    }
  });
}

function enqueueFetchJob(options = {}) {
  const job = {
    id: ++fetchQueue.counter,
    kind: String(options.kind || 'generic').trim() || 'generic',
    priority: normalizeFetchPriority(options.priority),
    contactKey: String(options.contactKey || '').trim(),
    dedupeKey: String(options.dedupeKey || '').trim() || `${options.kind || 'generic'}:${fetchQueue.counter}`,
    enqueuedAt: Date.now(),
    controller: new AbortController(),
    run: options.run
  };

  const existingPending = fetchQueue.pending.find((entry) => entry.dedupeKey === job.dedupeKey);
  if (existingPending) {
    const existingPriority = FETCH_PRIORITY_ORDER[existingPending.priority] ?? FETCH_PRIORITY_ORDER.P3;
    const nextPriority = FETCH_PRIORITY_ORDER[job.priority] ?? FETCH_PRIORITY_ORDER.P3;
    if (nextPriority < existingPriority) {
      existingPending.priority = job.priority;
      existingPending.enqueuedAt = Date.now();
      fetchQueue.pending.sort(compareFetchJobs);
      scheduleFetchPump();
    }
    return existingPending.promise;
  }
  const existingActive = [...fetchQueue.active.values()].find((entry) => entry.dedupeKey === job.dedupeKey);
  if (existingActive) {
    const existingPriority = FETCH_PRIORITY_ORDER[existingActive.priority] ?? FETCH_PRIORITY_ORDER.P3;
    const nextPriority = FETCH_PRIORITY_ORDER[job.priority] ?? FETCH_PRIORITY_ORDER.P3;
    if (nextPriority < existingPriority) {
      existingActive.priority = job.priority;
    }
    return existingActive.promise;
  }

  job.promise = new Promise((resolve, reject) => {
    job.resolve = resolve;
    job.reject = reject;
  });

  fetchQueue.pending.push(job);
  fetchQueue.pending.sort(compareFetchJobs);
  scheduleFetchPump();
  return job.promise;
}

function pumpFetchQueue() {
  clearFetchIdleTimer();
  fetchQueue.pending.sort(compareFetchJobs);

  while (fetchQueue.active.size < FETCH_QUEUE_CONCURRENCY) {
    const nextIndex = fetchQueue.pending.findIndex((job) => canRunFetchJob(job));
    if (nextIndex < 0) {
      const hasIdleWork = fetchQueue.pending.some((job) => job.priority === 'P3');
      if (hasIdleWork) {
        const idleForMs = Date.now() - fetchQueue.lastUserActivityAt;
        scheduleFetchPump(Math.max(50, 2000 - idleForMs));
      }
      return;
    }

    const [job] = fetchQueue.pending.splice(nextIndex, 1);
    fetchQueue.active.set(job.id, job);

    Promise.resolve()
      .then(() => job.run({ signal: job.controller.signal }))
      .then((result) => {
        job.resolve(result);
      })
      .catch((error) => {
        rejectFetchJob(job, error);
      })
      .finally(() => {
        fetchQueue.active.delete(job.id);
        scheduleFetchPump();
      });
  }
}

function firstPendingStep(status) {
  for (const step of GUIDE_STEPS) {
    if (status[step] !== 'done') return step;
  }
  return 'connect_account';
}

function defaultGuideStatus() {
  return {
    connect_account: 'in_progress'
  };
}

function defaultGuideEvidence() {
  return {
    oauth: {
      connectedAt: null,
      source: null
    }
  };
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
    ts: typeof entry.ts === 'string' && entry.ts ? entry.ts : nowIso(),
    source,
    level,
    stage,
    message,
    code: typeof entry.code === 'string' && entry.code ? entry.code : undefined,
    details: normalizeDiagnosticDetails(entry.details),
    replaceKey: typeof entry.replaceKey === 'string' && entry.replaceKey ? entry.replaceKey : undefined
  };
}

function normalizeTraceEntries(entries) {
  return Array.isArray(entries)
    ? entries.map((entry) => normalizeDiagnosticEntry(entry)).filter(Boolean)
    : [];
}

function createDiagnosticSignature(entry) {
  return [
    entry.source,
    entry.level,
    entry.stage,
    entry.message,
    entry.code || '',
    entry.details || '',
    entry.replaceKey || ''
  ].join('|');
}

function hasSpecificDiagnosticFailure(entries) {
  return entries.some((entry) =>
    entry &&
    entry.level === 'error' &&
    (entry.source === 'DB' || entry.source === 'IMAP')
  );
}

function compressTraceEntries(entries) {
  const normalized = normalizeTraceEntries(entries);
  const filtered = hasSpecificDiagnosticFailure(normalized)
    ? normalized.filter((entry) => !(entry.level === 'error' && WRAPPER_FAILURE_STAGES.has(entry.stage)))
    : normalized;

  const merged = [];
  const seen = new Set();

  for (const entry of filtered) {
    const signature = createDiagnosticSignature(entry);
    if (seen.has(signature)) continue;
    seen.add(signature);
    merged.push(entry);
  }

  return merged;
}

function defaultSetupDiagnostics() {
  return {
    runId: createDiagnosticId(),
    updatedAt: nowIso(),
    entries: []
  };
}

function normalizeSetupDiagnostics(input) {
  const src = input && typeof input === 'object' ? input : {};
  const fallback = defaultSetupDiagnostics();

  return {
    runId: typeof src.runId === 'string' && src.runId ? src.runId : fallback.runId,
    updatedAt: typeof src.updatedAt === 'string' && src.updatedAt ? src.updatedAt : fallback.updatedAt,
    entries: compressTraceEntries(src.entries).slice(-MAX_SETUP_DIAGNOSTIC_ENTRIES)
  };
}

function buildDiagnosticEntry(source, level, stage, message, extra = {}) {
  return normalizeDiagnosticEntry({
    source,
    level,
    stage,
    message,
    code: extra.code,
    details: extra.details,
    replaceKey: extra.replaceKey
  });
}

async function readSetupDiagnostics() {
  const stored = await chrome.storage.local.get([SETUP_DIAGNOSTICS_KEY]);
  return normalizeSetupDiagnostics(stored[SETUP_DIAGNOSTICS_KEY]);
}

async function persistSetupDiagnostics(nextState) {
  const normalized = normalizeSetupDiagnostics(nextState);
  await chrome.storage.local.set({ [SETUP_DIAGNOSTICS_KEY]: normalized });
  return normalized;
}

async function mutateSetupDiagnostics(mutator) {
  const task = async () => {
    const current = await readSetupDiagnostics();
    const next = await mutator(current);
    return persistSetupDiagnostics(next);
  };

  diagnosticsWriteChain = diagnosticsWriteChain.then(task, task);
  return diagnosticsWriteChain;
}

async function appendSetupDiagnostics(entries, options = {}) {
  const incoming = compressTraceEntries(Array.isArray(entries) ? entries : [entries]);

  if (!incoming.length && !options.reset) {
    return readSetupDiagnostics();
  }

  return mutateSetupDiagnostics((current) => {
    const base = options.reset
      ? {
        runId: createDiagnosticId(),
        updatedAt: nowIso(),
        entries: []
      }
      : normalizeSetupDiagnostics(current);

    let merged = [...base.entries];

    for (const entry of incoming) {
      if (entry.replaceKey) {
        const existingIndex = merged.findIndex((item) => item.replaceKey === entry.replaceKey);
        if (existingIndex >= 0) {
          merged[existingIndex] = {
            ...merged[existingIndex],
            ...entry,
            id: merged[existingIndex].id
          };
          continue;
        }
      }

      merged.push(entry);
      if (merged.length > MAX_SETUP_DIAGNOSTIC_ENTRIES) {
        merged = merged.slice(-MAX_SETUP_DIAGNOSTIC_ENTRIES);
      }
    }

    return {
      ...base,
      updatedAt: nowIso(),
      entries: merged
    };
  });
}

async function clearSetupDiagnostics() {
  return persistSetupDiagnostics(defaultSetupDiagnostics());
}

function normalizeIsoField(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function normalizeGuideEvidence(input) {
  const evidence = defaultGuideEvidence();
  const src = input && typeof input === 'object' ? input : {};
  const oauth = src.oauth && typeof src.oauth === 'object' ? src.oauth : {};

  evidence.oauth.connectedAt = normalizeIsoField(oauth.connectedAt);
  evidence.oauth.source = typeof oauth.source === 'string' ? oauth.source : null;

  return evidence;
}

function defaultSubstepForStep(step, status) {
  if (step === 'connect_account') return 'connect_ready';
  return 'connect_ready';
}

function buildConnectedGuideState(evidence = defaultGuideEvidence()) {
  return {
    step: 'connect_account',
    substep: 'connected',
    status: {
      connect_account: 'done'
    },
    evidence: normalizeGuideEvidence(evidence),
    progress: GUIDE_STEPS.length,
    total: GUIDE_STEPS.length,
    currentContext: 'connected',
    connected: true,
    updatedAt: nowIso()
  };
}

function normalizeGuideState(input, hasUserId = false) {
  const status = defaultGuideStatus();
  const src = input && typeof input === 'object' ? input : {};
  const legacyStatus = src.status && typeof src.status === 'object' ? src.status : {};

  if (legacyStatus && typeof legacyStatus === 'object') {
    for (const step of GUIDE_STEPS) {
      const value = legacyStatus[step];
      if (value === 'pending' || value === 'in_progress' || value === 'done') {
        status[step] = value;
      }
    }
  }

  const legacyProgressed = (
    legacyStatus.enable_imap === 'in_progress'
    || legacyStatus.enable_imap === 'done'
    || legacyStatus.generate_app_password === 'in_progress'
    || legacyStatus.generate_app_password === 'done'
    || src.step === 'connect_account'
  );

  if (legacyProgressed && status.connect_account === 'pending') {
    status.connect_account = 'in_progress';
  }

  const evidence = normalizeGuideEvidence(src.evidence);
  const connected = Boolean(src.connected || hasUserId);
  if (connected) {
    return buildConnectedGuideState(evidence);
  }

  let step = GUIDE_STEP_SET.has(src.step) ? src.step : 'connect_account';
  if (step === 'connect_account' && status.connect_account === 'pending') {
    status.connect_account = 'in_progress';
  }

  let substep = typeof src.substep === 'string' ? src.substep : defaultSubstepForStep(step, status);
  if (!GUIDE_SUBSTEPS[step]?.has(substep)) {
    substep = defaultSubstepForStep(step, status);
  }

  const progress = GUIDE_STEPS.reduce((count, key) => count + (status[key] === 'done' ? 1 : 0), 0);

  return {
    step,
    substep,
    status,
    evidence,
    progress,
    total: GUIDE_STEPS.length,
    currentContext: typeof src.currentContext === 'string' ? src.currentContext : 'unknown',
    connected: false,
    updatedAt: typeof src.updatedAt === 'string' ? src.updatedAt : nowIso()
  };
}

function recalcGuideState(guideState) {
  const next = normalizeGuideState(guideState, guideState?.connected);
  next.progress = GUIDE_STEPS.reduce((count, key) => count + (next.status[key] === 'done' ? 1 : 0), 0);
  return next;
}

async function setGuideBadge(guideState) {
  const state = recalcGuideState(guideState);
  if (state.connected) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Mailita' });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
  await chrome.action.setBadgeText({ text: `${state.progress}/${state.total}` });
  await chrome.action.setTitle({ title: `Mailita setup: ${state.progress}/${state.total} complete` });
}

async function readGuideState() {
  const stored = await chrome.storage.local.get(['onboardingGuideState', 'accountEmail', 'userId']);
  return recalcGuideState(normalizeGuideState(stored.onboardingGuideState, Boolean(stored.accountEmail || stored.userId)));
}

async function persistGuideState(nextState) {
  const storage = await chrome.storage.local.get(['accountEmail', 'userId']);
  const normalized = recalcGuideState(normalizeGuideState(nextState, Boolean(storage.accountEmail || storage.userId)));
  await chrome.storage.local.set({ onboardingGuideState: normalized });
  await setGuideBadge(normalized);
  return normalized;
}

function guideContextFromUrl(url) {
  const value = String(url || '').toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('mail.google.com')) return 'gmail_inbox';
  return 'other';
}

function stepTargetUrl(step) {
  if (step === 'connect_account') return 'https://mail.google.com/#inbox';
  return null;
}

function stepTargetContext(step) {
  if (step === 'connect_account') return 'gmail_inbox';
  return 'unknown';
}

function tabMatchesStep(tab, step) {
  const url = String(tab?.url || '').toLowerCase();
  if (!url) return false;
  if (step === 'connect_account') {
    return url.includes('mail.google.com');
  }
  return false;
}

function canAutoConfirmTransition(guideState, step, reason) {
  if (!GUIDE_STEP_SET.has(step)) return false;
  return step === guideState.step || step === 'connect_account' || reason === 'oauth_connected';
}

function mergeEvidence(guideState, patchEvidence) {
  if (!patchEvidence || typeof patchEvidence !== 'object') return;

  if (patchEvidence.oauth && typeof patchEvidence.oauth === 'object') {
    const oauth = patchEvidence.oauth;
    if (typeof oauth.connectedAt === 'string') {
      guideState.evidence.oauth.connectedAt = oauth.connectedAt;
    }
    if (typeof oauth.source === 'string') {
      guideState.evidence.oauth.source = oauth.source;
    }
  }
}

async function syncGuideContextFromTab(tab) {
  if (!tab || typeof tab.url !== 'string') return;

  const guide = await readGuideState();
  if (guide.connected) return;

  const context = guideContextFromUrl(tab.url);
  let changed = false;

  if (context && context !== guide.currentContext) {
    guide.currentContext = context;
    changed = true;
  }

  if (context === 'gmail_inbox' && guide.status.connect_account !== 'done') {
    guide.step = 'connect_account';
    if (guide.status.connect_account === 'pending') {
      guide.status.connect_account = 'in_progress';
    }
    if (guide.substep !== 'connect_ready') {
      guide.substep = 'connect_ready';
    }
    changed = true;
  }

  if (changed) {
    guide.updatedAt = nowIso();
    await persistGuideState(guide);
  }
}

function coldStartError(trace = []) {
  return {
    success: false,
    code: 'BACKEND_COLD_START',
    error: COLD_START_MESSAGE,
    retriable: true,
    retryAfterSec: 60,
    trace: normalizeTraceEntries(trace)
  };
}

function timedOutError(message, trace = [], retryAfterSec = 15) {
  return {
    success: false,
    code: 'BACKEND_REQUEST_TIMEOUT',
    error: message || `Backend request timed out after ${Math.round(FETCH_TIMEOUT_MS / 1000)} seconds.`,
    retriable: true,
    retryAfterSec,
    trace: normalizeTraceEntries(trace)
  };
}

function networkError(code, message, trace = [], retryAfterSec = 15) {
  return {
    success: false,
    code,
    error: message || 'Backend request failed before a response was received.',
    retriable: true,
    retryAfterSec,
    trace: normalizeTraceEntries(trace)
  };
}

function normalizeError(payload, fallbackCode = 'BACKEND_UNAVAILABLE') {
  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      code: fallbackCode,
      error: 'Backend returned an invalid response.',
      trace: []
    };
  }

  return {
    success: false,
    code: payload.code || fallbackCode,
    error: payload.error || 'Backend request failed.',
    retriable: payload.retriable,
    retryAfterSec: payload.retryAfterSec,
    trace: normalizeTraceEntries(payload.trace)
  };
}

async function runHealthProbe(timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    if ([502, 503, 504].includes(response.status)) {
      return {
        success: false,
        code: 'BACKEND_COLD_START',
        status: response.status,
        error: COLD_START_MESSAGE,
        trace: [
          buildDiagnosticEntry(
            'EXT',
            'warning',
            'health_probe_cold_start',
            'Backend health probe returned a wake-up status.',
            {
              code: 'BACKEND_COLD_START',
              details: `status=${response.status}`
            }
          )
        ]
      };
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        success: false,
        code: 'BACKEND_HEALTH_FAILED',
        status: response.status,
        error: `Backend health check failed with HTTP ${response.status}.`,
        trace: [
          buildDiagnosticEntry(
            'EXT',
            'error',
            'health_probe_http_error',
            'Backend health probe returned a non-OK HTTP status.',
            {
              code: 'BACKEND_HEALTH_FAILED',
              details: `status=${response.status}`
            }
          )
        ]
      };
    }

    return {
      success: true,
      status: data?.status || 'ok',
      timestamp: data?.timestamp || null,
      uptime: data?.uptime,
      version: data?.version || 'unknown',
      buildSha: data?.buildSha || 'unknown',
      deployedAt: data?.deployedAt || null,
      trace: [
        buildDiagnosticEntry(
          'EXT',
          'success',
          'health_probe_ok',
          'Backend health probe succeeded.',
          {
            details: `status=${response.status}; version=${data?.version || 'unknown'}; buildSha=${data?.buildSha || 'unknown'}`
          }
        )
      ]
    };
  } catch (error) {
    if (error.name === 'AbortError') {
      return {
        success: false,
        code: 'BACKEND_HEALTH_TIMEOUT',
        error: `Backend health check timed out after ${Math.round(timeoutMs / 1000)} seconds.`,
        trace: [
          buildDiagnosticEntry(
            'EXT',
            'warning',
            'health_probe_timeout',
            'Backend health probe timed out.',
            {
              code: 'BACKEND_HEALTH_TIMEOUT',
              details: `timeoutMs=${timeoutMs}`
            }
          )
        ]
      };
    }

    return {
      success: false,
      code: 'BACKEND_HEALTH_UNREACHABLE',
      error: 'Browser could not reach the backend health endpoint.',
      trace: [
        buildDiagnosticEntry(
          'EXT',
          'error',
          'health_probe_network_error',
          'Backend health probe failed before a response was received.',
          {
            code: 'BACKEND_HEALTH_UNREACHABLE',
            details: error.message || 'unknown'
          }
        )
      ]
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBackend(path, options = {}) {
  const timeoutMs = Number.isFinite(Number(options.timeoutMs))
    ? Number(options.timeoutMs)
    : FETCH_TIMEOUT_MS;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if ([502, 503, 504].includes(response.status)) {
      console.error('[Extension SW ERROR] Backend cold start detected (Render sleeping). Retry in 60s.');
      return coldStartError([
        buildDiagnosticEntry(
          'EXT',
          'warning',
          'backend_http_wakeup_status',
          'Backend API returned a wake-up status.',
          {
            code: 'BACKEND_COLD_START',
            details: `path=${path}; status=${response.status}`
          }
        )
      ]);
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      const normalized = normalizeError(data, response.status === 401 ? 'NOT_CONNECTED' : 'BACKEND_UNAVAILABLE');
      normalized.trace = mergeTraceLists(
        normalized.trace,
        [
          buildDiagnosticEntry(
            'EXT',
            response.status >= 500 ? 'error' : 'info',
            'backend_http_response_error',
            'Backend API returned an error response.',
            {
              code: normalized.code,
              details: `path=${path}; status=${response.status}`
            }
          )
        ]
      );
      return normalized;
    }

    return data;
  } catch (error) {
    const message = String(error.message || '');
    const isAbort = error.name === 'AbortError';
    const isFailedFetch = message.includes('Failed to fetch');

    if (isAbort || isFailedFetch) {
      const localTrace = [
        buildDiagnosticEntry(
          'EXT',
          isAbort ? 'warning' : 'error',
          isAbort ? 'backend_request_timeout' : 'backend_request_network_error',
          isAbort
            ? 'Backend API request timed out in the browser.'
            : 'Backend API request failed before a response was received.',
          {
            code: isAbort ? 'BACKEND_REQUEST_TIMEOUT' : 'BACKEND_REQUEST_FAILED',
            details: `path=${path}; timeoutMs=${timeoutMs}; message=${message || 'unknown'}`
          }
        )
      ];

      const probe = await runHealthProbe(Math.min(timeoutMs, 5000));

      if (probe.success) {
        if (isAbort) {
          return timedOutError(
            `Backend /health is up, but ${path} timed out after ${Math.round(timeoutMs / 1000)} seconds. This points to a slow API path or a network bottleneck from this browser.`,
            mergeTraceLists(localTrace, probe.trace)
          );
        }

        return networkError(
          'BACKEND_REQUEST_FAILED',
          `Backend /health is up, but the browser could not complete ${path}. This points to a local browser/network fetch problem instead of Render sleeping.`,
          mergeTraceLists(localTrace, probe.trace)
        );
      }

      if (probe.code === 'BACKEND_COLD_START') {
        console.error('[Extension SW ERROR] Backend cold start confirmed by health probe.');
        return coldStartError(mergeTraceLists(localTrace, probe.trace));
      }

      if (isAbort) {
        return timedOutError(
          `Mailbox request timed out after ${Math.round(timeoutMs / 1000)} seconds, and /health also did not respond from this browser. This looks like a local network timeout rather than a confirmed Render sleep.`,
          mergeTraceLists(localTrace, probe.trace)
        );
      }

      return networkError(
        'BACKEND_UNREACHABLE',
        'Browser could not reach the backend API, and /health also failed from this browser. This looks like a local network or browser fetch failure.',
        mergeTraceLists(localTrace, probe.trace)
      );
    }

    return {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error.message || 'Backend request failed.',
      trace: []
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHealth() {
  const probe = await runHealthProbe(FETCH_TIMEOUT_MS);
  if (probe.success) return probe;
  if (probe.code === 'BACKEND_COLD_START') {
    return coldStartError(probe.trace);
  }
  return {
    success: false,
    code: probe.code || 'BACKEND_UNAVAILABLE',
    error: probe.error || 'Backend health check failed.',
    trace: normalizeTraceEntries(probe.trace)
  };
}

async function getStoredUser() {
  const {
    userId,
    userEmail,
    accountEmail,
    grantedScopes,
    lastHistoryId,
    mailSource,
    lastSyncTime,
    onboardingComplete,
    onboardingGuideState,
    setupDiagnostics
  } =
    await chrome.storage.local.get([
      'userId',
      'userEmail',
      'accountEmail',
      'grantedScopes',
      'lastHistoryId',
      'mailSource',
      'lastSyncTime',
      'onboardingComplete',
      'onboardingGuideState',
      SETUP_DIAGNOSTICS_KEY
    ]);
  const resolvedAccountEmail = String(accountEmail || userEmail || '').trim().toLowerCase();
  const resolvedMailSource = String(mailSource || DEFAULT_MAIL_SOURCE);
  const connected = Boolean(resolvedAccountEmail || userId);
  return {
    connected,
    mailSource: resolvedMailSource,
    userId: userId || (resolvedAccountEmail ? `local:${resolvedAccountEmail}` : ''),
    userEmail: resolvedAccountEmail,
    accountEmail: resolvedAccountEmail,
    grantedScopes: Array.isArray(grantedScopes) ? grantedScopes : [],
    lastHistoryId: String(lastHistoryId || ''),
    lastSyncTime,
    onboardingComplete,
    onboardingGuideState,
    setupDiagnostics: normalizeSetupDiagnostics(setupDiagnostics)
  };
}

function usingLocalMailSource(storedUser, explicitAction = '') {
  if (explicitAction === 'CONNECT_GOOGLE' || explicitAction === 'DISCONNECT_GOOGLE') return true;
  const mode = String(storedUser?.mailSource || DEFAULT_MAIL_SOURCE);
  return mode !== MAIL_SOURCE_IMAP_BACKEND;
}

function localTrace(level, stage, message, extra = {}) {
  return buildDiagnosticEntry('EXT', level, stage, message, extra);
}

function mapLocalError(error, fallbackCode = 'GMAIL_API_ERROR') {
  const message = String(error?.message || 'Local Gmail request failed.');
  const code = String(error?.code || '');
  const details = [
    error?.stage ? `stage=${error.stage}` : '',
    Number.isFinite(Number(error?.status)) && Number(error?.status) > 0 ? `status=${Number(error.status)}` : '',
    error?.path ? `path=${error.path}` : '',
    message
  ].filter(Boolean).join('; ');

  if (code === 'OAUTH_NOT_CONFIGURED') {
    return {
      success: false,
      code,
      error: 'Google OAuth is not configured in the extension manifest yet.',
      trace: [localTrace('error', 'oauth_not_configured', 'Google OAuth client ID is missing from manifest.json.', { code })]
    };
  }

  if (
    code === 'AUTH_FAILED'
    || /authorize|consent|approval|grant/i.test(message)
    || /not signed in/i.test(message)
  ) {
    return {
      success: false,
      code: 'AUTH_FAILED',
      error: 'Google sign-in did not complete. Try connecting again.',
      trace: [localTrace('error', 'oauth_failed', 'Google OAuth did not complete successfully.', {
        code: 'AUTH_FAILED',
        details: message
      })]
    };
  }

  if (
    code === 'AUTH_SCOPE_REQUIRED'
    || /insufficient permission|insufficient authentication scopes|scope/i.test(message)
  ) {
    return {
      success: false,
      code: 'AUTH_SCOPE_REQUIRED',
      error: 'Mailita needs Gmail send permission before it can send replies.',
      trace: [localTrace('error', 'oauth_scope_required', 'Gmail send permission is required for this action.', {
        code: 'AUTH_SCOPE_REQUIRED',
        details: message
      })]
    };
  }

  if (code === 'GMAIL_API_TIMEOUT') {
    return {
      success: false,
      code: 'GMAIL_API_ERROR',
      error: 'Gmail couldn\'t fetch this',
      retriable: true,
      retryAfterSec: 10,
      trace: [localTrace('error', 'gmail_api_timeout', 'A Gmail API request timed out in the extension.', {
        code: 'GMAIL_API_TIMEOUT',
        details
      })]
    };
  }

  if (code === 'GMAIL_API_ABORTED') {
    return {
      success: false,
      code: 'REQUEST_ABORTED',
      error: 'Request canceled.',
      trace: [localTrace('info', 'gmail_api_aborted', 'A Gmail API request was canceled in the extension.', {
        code: 'REQUEST_ABORTED',
        details
      })]
    };
  }

  return {
    success: false,
    code: fallbackCode,
    error: message,
    trace: [localTrace('error', 'gmail_api_failed', 'The Gmail API request failed in the extension.', {
      code: fallbackCode,
      details
    })]
  };
}

async function persistLocalSession(snapshot, options = {}) {
  const accountEmail = String(snapshot?.accountEmail || '').trim().toLowerCase();
  const userId = accountEmail ? `local:${accountEmail}` : '';
  const updates = {
    connected: Boolean(accountEmail),
    mailSource: MAIL_SOURCE_GMAIL_API_LOCAL,
    accountEmail,
    userEmail: accountEmail,
    userId,
    grantedScopes: Array.isArray(snapshot?.grantedScopes) ? snapshot.grantedScopes : [],
    lastHistoryId: String(snapshot?.lastHistoryId || ''),
    lastSyncTime: typeof snapshot?.lastSyncTime === 'string' ? snapshot.lastSyncTime : '',
    onboardingComplete: options.onboardingComplete == null ? true : Boolean(options.onboardingComplete)
  };

  await chrome.storage.local.set(updates);
  return updates;
}

async function clearLocalSession() {
  await chrome.storage.local.remove([
    'connected',
    'accountEmail',
    'userEmail',
    'userId',
    'grantedScopes',
    'lastHistoryId',
    'lastSyncTime'
  ]);
  await chrome.storage.local.set({
    mailSource: DEFAULT_MAIL_SOURCE,
    onboardingComplete: false
  });
}

async function runLocalSync(payload = {}) {
  const result = await MailitaGmailLocal.refreshIncremental({
    limit: Number(payload.limit || 50),
    forceSync: Boolean(payload.forceSync)
  });
  const snapshot = await MailitaGmailLocal.snapshot();
  await persistLocalSession({
    ...snapshot,
    lastSyncTime: result.lastSyncTime || snapshot.lastSyncTime || nowIso()
  });
  return {
    success: true,
    source: MAIL_SOURCE_GMAIL_API_LOCAL,
    status: 'completed',
    phase: result.fullResync ? 'full_resync' : (result.changed ? 'incremental' : 'idle'),
    counts: {
      synced: Array.isArray(result.messages) ? result.messages.length : 0,
      changed: result.changed ? 1 : 0
    },
    trace: [
      localTrace('success', result.fullResync ? 'local_sync_full_resync' : 'local_sync_complete', result.fullResync
        ? 'Local Gmail sync completed with a full resync.'
        : 'Local Gmail sync completed.', {
        details: `changed=${Boolean(result.changed)}; fullResync=${Boolean(result.fullResync)}`
      })
    ]
  };
}

async function handleLocalMailAction(action, payload = {}) {
  const stored = await getStoredUser();

  if (action === 'CONNECT_GOOGLE' || action === 'CONNECT') {
    const connectedAt = nowIso();
    const response = await MailitaGmailLocal.connect();
    await persistLocalSession({
      accountEmail: response.accountEmail,
      grantedScopes: response.grantedScopes,
      lastHistoryId: response.lastHistoryId,
      lastSyncTime: ''
    });
    await persistGuideState(buildConnectedGuideState({
      oauth: {
        connectedAt,
        source: 'chrome.identity'
      }
    }));
    return {
      success: true,
      source: MAIL_SOURCE_GMAIL_API_LOCAL,
      accountEmail: response.accountEmail,
      email: response.accountEmail,
      grantedScopes: response.grantedScopes,
      lastHistoryId: response.lastHistoryId,
      trace: [
        localTrace('info', 'oauth_started', 'Starting Google OAuth connection.'),
        localTrace('success', 'oauth_connected', 'Google OAuth connection completed in the extension.', {
          details: response.accountEmail
        })
      ]
    };
  }

  if (action === 'DISCONNECT_GOOGLE' || action === 'DISCONNECT') {
    await MailitaGmailLocal.disconnect();
    await clearLocalSession();
    await chrome.storage.local.set({ onboardingGuideState: normalizeGuideState(null, false) });
    await setGuideBadge(normalizeGuideState(null, false));
    await clearSetupDiagnostics();
    return {
      success: true,
      source: MAIL_SOURCE_GMAIL_API_LOCAL,
      trace: [localTrace('success', 'oauth_disconnected', 'Local Gmail OAuth session disconnected.')]
    };
  }

  if (!stored.connected) {
    return {
      success: false,
      code: 'NOT_CONNECTED',
      error: 'Not connected. Use Connect with Google first.',
      trace: [localTrace('error', 'not_connected', 'Local Gmail action requires a connected Google account.', {
        code: 'NOT_CONNECTED'
      })]
    };
  }

  if (action === 'FETCH_MESSAGE_SUMMARIES') {
    const response = await MailitaGmailLocal.loadSummaries({
      limit: Number(payload.limit || 50),
      cursor: payload.cursor,
      append: Boolean(payload.append),
      forceSync: Boolean(payload.forceSync)
    });
    const snapshot = await MailitaGmailLocal.snapshot();
    await persistLocalSession(snapshot);
    return {
      success: true,
      summaries: response.summaries,
      count: response.count,
      loadedCount: Number(response.loadedCount || response.count || 0),
      nextCursor: String(response.nextCursor || ''),
      hasMore: Boolean(response.hasMore),
      source: response.source,
      debug: response.debug,
      timings: response.timings,
      trace: [localTrace('success', 'local_summary_loaded', 'Loaded mailbox summaries from the Gmail API.', {
        details: `count=${response.count}; loadedCount=${Number(response.loadedCount || response.count || 0)}; hasMore=${Boolean(response.hasMore)}`
      })]
    };
  }

  if (action === 'FETCH_CONTACT_MESSAGES') {
    const priority = normalizeFetchPriority(payload.priority || 'P0');
    if (payload.userInitiated !== false || priority === 'P0' || priority === 'P1') {
      fetchQueue.lastUserActivityAt = Date.now();
    }
    if (priority === 'P0' && payload.contactKey) {
      cancelFetchJobs((job) => {
        if (!job.contactKey || job.contactKey === payload.contactKey) return false;
        return job.priority === 'P0' || job.priority === 'P1' || job.priority === 'P2' || job.priority === 'P3';
      }, 'Selection changed.');
      cancelFetchJobs((job) => job.priority === 'P2' || job.priority === 'P3', 'Higher priority contact selected.');
    }

    const response = await enqueueFetchJob({
      kind: 'contact-page',
      priority,
      contactKey: payload.contactKey,
      dedupeKey: [
        'contact-page',
        String(payload.contactKey || ''),
        String(payload.cursor || ''),
        String(payload.scope || 'all')
      ].join(':'),
      run: ({ signal }) => MailitaGmailLocal.loadContact({
        contactEmail: payload.contactEmail,
        contactKey: payload.contactKey,
        scope: payload.scope,
        cursor: payload.cursor,
        pageSize: Number(payload.pageSize || payload.limitPerFolder || 5),
        limitPerFolder: Number(payload.limitPerFolder || payload.pageSize || 5),
        forceSync: Boolean(payload.forceSync),
        metadataOnly: payload.metadataOnly !== false,
        signal
      })
    });
    return {
      success: true,
      messages: response.messages,
      count: response.count,
      nextCursor: response.nextCursor,
      hasMore: Boolean(response.hasMore),
      source: response.source,
      debug: response.debug,
      timings: response.timings,
      trace: [localTrace('success', 'local_contact_loaded', 'Loaded contact messages from the Gmail API.', {
        details: `contactEmail=${payload.contactEmail}; scope=${payload.scope || 'all'}; count=${response.count}`
      })]
    };
  }

  if (action === 'FETCH_CONTACT_BODIES') {
    const priority = normalizeFetchPriority(payload.priority || 'P1');
    if (payload.userInitiated !== false || priority === 'P0' || priority === 'P1') {
      fetchQueue.lastUserActivityAt = Date.now();
    }
    const messageIds = Array.isArray(payload.messageIds) ? payload.messageIds : [];
    const response = await enqueueFetchJob({
      kind: 'contact-bodies',
      priority,
      contactKey: payload.contactKey,
      dedupeKey: [
        'contact-bodies',
        String(payload.contactKey || ''),
        [...new Set(messageIds.map((id) => String(id || '').trim()).filter(Boolean))].sort().join(',')
      ].join(':'),
      run: ({ signal }) => MailitaGmailLocal.loadContactBodies({
        contactEmail: payload.contactEmail,
        contactKey: payload.contactKey,
        messageIds,
        signal
      })
    });
    return {
      success: true,
      messages: response.messages,
      count: response.count,
      source: response.source,
      timings: response.timings,
      trace: [localTrace('success', 'local_contact_bodies_loaded', 'Loaded visible contact bodies from the Gmail API.', {
        details: `contactEmail=${payload.contactEmail || ''}; count=${response.count}`
      })]
    };
  }

  if (action === 'DEBUG_REFETCH_CONTACT') {
    const response = await MailitaGmailLocal.loadContact({
      contactEmail: payload.contactEmail,
      contactKey: payload.contactKey,
      limitPerFolder: 50,
      forceSync: true
    });
    return {
      success: true,
      messages: response.messages,
      count: response.count,
      source: 'gmail_api_local_debug',
      backend: {
        version: chrome.runtime.getManifest().version,
        buildSha: MAIL_SOURCE_GMAIL_API_LOCAL,
        deployedAt: null
      },
      trace: [localTrace('success', 'local_contact_refetch', 'Refetched contact messages directly from the Gmail API.', {
        details: `contactEmail=${payload.contactEmail}; count=${response.count}`
      })]
    };
  }

  if (action === 'SEARCH_MESSAGES') {
    const response = await MailitaGmailLocal.search({
      query: payload.query,
      limit: Number(payload.limit || 20)
    });
    const snapshot = await MailitaGmailLocal.snapshot();
    await persistLocalSession({
      ...snapshot,
      lastSyncTime: nowIso()
    });
    return {
      success: true,
      messages: response.messages,
      count: response.count,
      source: response.source,
      timings: response.timings,
      trace: [localTrace('success', 'local_search_complete', 'Searched the mailbox through the Gmail API.', {
        details: `query=${String(payload.query || '').trim()}; count=${response.count}`
      })]
    };
  }

  if (action === 'SEND_MESSAGE') {
    const sent = await MailitaGmailLocal.sendMessage({
      to: payload.to,
      cc: payload.cc,
      bcc: payload.bcc,
      subject: payload.subject,
      bodyText: payload.bodyText,
      threadId: payload.threadId,
      inReplyTo: payload.inReplyTo,
      references: payload.references
    });
    const snapshot = await MailitaGmailLocal.snapshot();
    await persistLocalSession({
      ...snapshot,
      lastSyncTime: nowIso()
    });
    return {
      success: true,
      source: MAIL_SOURCE_GMAIL_API_LOCAL,
      sent,
      trace: [localTrace('success', 'local_send_complete', 'Sent a message directly through the Gmail API.', {
        details: `threadId=${sent.threadId || payload.threadId || ''}; id=${sent.id || ''}`
      })]
    };
  }

  if (action === 'SYNC_MESSAGES') {
    return runLocalSync(payload);
  }

  if (action === 'HEALTH_CHECK') {
    const configured = MailitaGmailLocal.oauthClientConfigured();
    return {
      success: configured,
      code: configured ? undefined : 'OAUTH_NOT_CONFIGURED',
      status: configured ? 'ok' : 'oauth_not_configured',
      source: MAIL_SOURCE_GMAIL_API_LOCAL,
      accountEmail: stored.accountEmail,
      trace: [localTrace(configured ? 'success' : 'error', configured ? 'local_health_ok' : 'oauth_not_configured', configured
        ? 'Local Gmail mail source is ready.'
        : 'Local Gmail mail source is missing an OAuth client ID.')]
    };
  }

  if (action === 'GET_STORAGE') {
    return {
      success: true,
      ...stored,
      onboardingGuideState: normalizeGuideState(stored.onboardingGuideState, Boolean(stored.connected))
    };
  }

  return null;
}

function stopSyncPoller(userId) {
  const timer = activeSyncPollers.get(userId);
  if (timer) {
    clearTimeout(timer);
    activeSyncPollers.delete(userId);
  }
}

function scheduleSyncPoller(userId, task, delay = SYNC_STATUS_POLL_MS) {
  stopSyncPoller(userId);
  const timer = setTimeout(async () => {
    activeSyncPollers.delete(userId);
    await task();
  }, delay);
  activeSyncPollers.set(userId, timer);
}

async function fetchSyncStatus(jobId, userId, trackActivity = false) {
  const params = new URLSearchParams();
  if (jobId) params.set('jobId', jobId);
  if (userId) params.set('userId', userId);

  return fetchBackend(`/api/messages/sync/status?${params.toString()}`, {
    timeoutMs: SYNC_FETCH_TIMEOUT_MS
  });
}

async function watchSyncJob(userId, jobId, options = {}) {
  if (!userId || !jobId) return;

  const trackActivity = Boolean(options.trackActivity);
  const response = await fetchSyncStatus(jobId, userId, trackActivity);
  const backendTrace = normalizeTraceEntries(response.trace);

  if (!response?.success) {
    if (trackActivity) {
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, [
        buildDiagnosticEntry('EXT', 'warning', 'sync_status_failed', 'Mailbox sync status check failed.', {
          code: response.code,
          details: response.error
        })
      ]));
    }
    if (response?.code !== 'BACKEND_COLD_START') {
      scheduleSyncPoller(userId, () => watchSyncJob(userId, jobId, options), 6000);
    }
    return;
  }

  await chrome.storage.local.set({
    mailitaSyncJob: {
      jobId: response.jobId,
      status: response.status,
      phase: response.phase,
      updatedAt: nowIso()
    }
  });

  if (response.status === 'completed') {
    stopSyncPoller(userId);
    await chrome.storage.local.set({
      lastSyncTime: nowIso(),
      mailitaSyncJob: {
        jobId: response.jobId,
        status: response.status,
        phase: response.phase,
        updatedAt: nowIso()
      }
    });
    if (trackActivity) {
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, [
        buildDiagnosticEntry('EXT', 'success', 'sync_complete', 'Automatic mailbox sync completed.', {
          details: `jobId=${response.jobId}; synced=${response.counts?.synced || 0}`
        })
      ]));
    }
    return;
  }

  if (response.status === 'failed') {
    stopSyncPoller(userId);
    if (trackActivity) {
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, [
        buildDiagnosticEntry('EXT', 'error', 'sync_failed', 'Automatic mailbox sync failed.', {
          details: response.error || 'Unknown sync failure.'
        })
      ]));
    }
    return;
  }

  scheduleSyncPoller(userId, () => watchSyncJob(userId, jobId, options));
}

async function ensureSyncJobRunning(options = {}) {
  const stored = await getStoredUser();
  if (!stored.connected) {
    return {
      success: false,
      code: 'NOT_CONNECTED',
      error: 'Not connected. Please set up the extension.'
    };
  }

  if (usingLocalMailSource(stored)) {
    return runLocalSync(options);
  }

  const { userId } = stored;
  const trackActivity = Boolean(options.trackActivity);
  const response = await fetchBackend('/api/messages/sync', {
    method: 'POST',
    body: JSON.stringify({ userId }),
    timeoutMs: SYNC_FETCH_TIMEOUT_MS
  });

  if (response?.success && response.jobId) {
    if (trackActivity) {
      await appendSetupDiagnostics(mergeTraceLists(normalizeTraceEntries(response.trace), [
        buildDiagnosticEntry('EXT', 'info', 'sync_job_started', 'Mailbox sync job is running in the background.', {
          details: `jobId=${response.jobId}; status=${response.status}; phase=${response.phase}`
        })
      ]));
    }
    watchSyncJob(userId, response.jobId, { trackActivity }).catch(() => {});
  }

  return response;
}

async function maybeKickAutomaticSync(reason = 'auto') {
  const { userId } = await getStoredUser();
  if (!userId) return;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  const activeGmail = tabs.some((tab) => typeof tab.url === 'string' && tab.url.startsWith('https://mail.google.com/'));
  if (!activeGmail) return;

  ensureSyncJobRunning({ trackActivity: false, reason }).catch(() => {});
}

function sanitizePayload(payload) {
  if (payload == null) return {};
  if (typeof payload === 'object' && !Array.isArray(payload)) return payload;
  return null;
}

async function ensureSyncAlarm() {
  if (!chrome.alarms?.create) return;
  await chrome.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: 10 });
}

async function handleGuideAction(action, payload = {}) {
  if (action === 'GUIDE_GET_STATE') {
    const guideState = await readGuideState();
    return { success: true, guideState };
  }

  if (action === 'GUIDE_RESET') {
    const guideState = await persistGuideState(normalizeGuideState(null, false));
    await chrome.storage.local.set({ onboardingComplete: false });
    await clearSetupDiagnostics();
    return { success: true, guideState };
  }

  if (action === 'GUIDE_CONFIRM_STEP') {
    const step = String(payload.step || '').trim();
    const substep = String(payload.substep || '').trim();
    const reason = String(payload.reason || 'auto_observed').trim();

    if (!GUIDE_STEP_SET.has(step)) {
      return {
        success: false,
        code: 'BAD_REQUEST',
        error: 'Invalid guide step.'
      };
    }

    const guideState = await readGuideState();

    if (!canAutoConfirmTransition(guideState, step, reason)) {
      return {
        success: false,
        code: 'BAD_REQUEST',
        error: 'Invalid step transition.'
      };
    }

    mergeEvidence(guideState, payload.evidence);

    if (step === 'connect_account') {
      if (substep && !GUIDE_SUBSTEPS.connect_account.has(substep)) {
        return {
          success: false,
          code: 'BAD_REQUEST',
          error: 'Invalid connect substep.'
        };
      }
      guideState.status.connect_account = 'done';
      guideState.connected = true;
      guideState.substep = 'connect_submitted';
      const finalState = await persistGuideState(buildConnectedGuideState(guideState.evidence));
      await chrome.storage.local.set({ onboardingComplete: true });
      return { success: true, guideState: finalState };
    }
  }

  if (action === 'GUIDE_NAVIGATE_TO_STEP') {
    const step = String(payload.step || '').trim();
    if (!GUIDE_STEP_SET.has(step)) {
      return {
        success: false,
        code: 'BAD_REQUEST',
        error: 'Invalid guide step.'
      };
    }

    const guideState = await readGuideState();

    if (GUIDE_STEP_ORDER[step] > GUIDE_STEP_ORDER[firstPendingStep(guideState.status)]) {
      return {
        success: false,
        code: 'BAD_REQUEST',
        error: 'Cannot jump to that step yet.'
      };
    }

    guideState.step = step;
    if (guideState.status[step] === 'pending') {
      guideState.status[step] = 'in_progress';
    }

    guideState.substep = 'connect_ready';

    const url = stepTargetUrl(step);
    if (!url) {
      guideState.currentContext = stepTargetContext(step);
      guideState.updatedAt = nowIso();
      return { success: true, guideState: await persistGuideState(guideState) };
    }

    const tabs = await chrome.tabs.query({});
    const existing = tabs.find((tab) => tabMatchesStep(tab, step));
    let targetTab = null;

    if (existing && Number.isInteger(existing.id)) {
      targetTab = await chrome.tabs.update(existing.id, { active: true });
      if (Number.isInteger(existing.windowId)) {
        await chrome.windows.update(existing.windowId, { focused: true });
      }
    } else {
      targetTab = await chrome.tabs.create({ url, active: true });
    }

    guideState.currentContext = stepTargetContext(step);
    guideState.updatedAt = nowIso();
    const nextState = await persistGuideState(guideState);

    return {
      success: true,
      guideState: nextState,
      tabId: Number.isInteger(targetTab?.id) ? targetTab.id : null,
      url
    };
  }

  return {
    success: false,
    code: 'BAD_REQUEST',
    error: `Unsupported guide action: ${action}`
  };
}

function mergeTraceLists(...groups) {
  return compressTraceEntries(groups.flat());
}

function shouldTrackActivity(payload) {
  return Boolean(payload?.trackActivity);
}

async function handleBackendAction(message) {
  const action = message?.action;
  const payload = message?.payload || {};

  if (action && action.startsWith('GUIDE_')) {
    return handleGuideAction(action, payload);
  }

  if (action === 'DIAGNOSTICS_LOG') {
    const entries = Array.isArray(payload.entries)
      ? payload.entries
      : [payload.entry || payload];
    const setupDiagnostics = await appendSetupDiagnostics(entries, { reset: Boolean(payload.reset) });
    return { success: true, setupDiagnostics };
  }

  const storedUser = await getStoredUser();
  if (usingLocalMailSource(storedUser, action)) {
    try {
      const localResult = await handleLocalMailAction(action, payload);
      if (localResult) {
        if (Array.isArray(localResult.trace) && localResult.trace.length) {
          await appendSetupDiagnostics(localResult.trace);
        }
        return localResult;
      }
    } catch (error) {
      const localError = mapLocalError(error);
      if (Array.isArray(localError.trace) && localError.trace.length) {
        await appendSetupDiagnostics(localError.trace);
      }
      return localError;
    }
  }

  if (action === 'CONNECT') {
    const startTrace = [
      buildDiagnosticEntry('EXT', 'info', 'connect_started', 'Starting Gmail connection.'),
      buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Sending connection request to the backend.')
    ];
    await appendSetupDiagnostics(startTrace);

    const response = await fetchBackend('/api/auth/connect', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const backendTrace = normalizeTraceEntries(response.trace);
    const responseTrace = buildDiagnosticEntry(
      'EXT',
      response.success ? 'success' : (response.code === 'BACKEND_COLD_START' ? 'warning' : 'info'),
      'backend_response_received',
      'Backend replied to the connection request.',
      {
        code: response.success ? undefined : response.code,
        details: response.success ? 'Connection was verified successfully.' : response.error,
        replaceKey: response.code === 'BACKEND_COLD_START' ? 'connect-cold-start' : undefined
      }
    );

    if (response.success) {
      await chrome.storage.local.set({
        userId: response.userId,
        userEmail: response.email,
        lastSyncTime: null,
        onboardingComplete: true
      });
      await persistGuideState(buildConnectedGuideState());
      const extTrace = [
        responseTrace,
        buildDiagnosticEntry('EXT', 'success', 'local_auth_updated', 'Connected account saved in the extension.')
      ];
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
      ensureSyncJobRunning({ trackActivity: true }).catch(() => {});
      return {
        ...response,
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    const extTrace = [
      responseTrace,
      ...(
        hasSpecificDiagnosticFailure(backendTrace)
          ? []
          : [buildDiagnosticEntry(
          'EXT',
          response.code === 'BACKEND_COLD_START' ? 'warning' : 'error',
          response.code === 'BACKEND_COLD_START' ? 'backend_cold_start' : 'connect_failed',
        response.code === 'BACKEND_COLD_START'
          ? 'Backend is waking up. Retry in about 60 seconds.'
          : 'Connection failed before Mailita finished setup.',
          {
            code: response.code,
            details: response.error,
            replaceKey: response.code === 'BACKEND_COLD_START' ? 'connect-cold-start' : undefined
          }
        )]
      )
    ];
    await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
    return {
      ...response,
      trace: mergeTraceLists(startTrace, backendTrace, extTrace)
    };
  }

  if (action === 'DISCONNECT') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    await appendSetupDiagnostics([
      buildDiagnosticEntry('EXT', 'info', 'disconnect_started', 'Disconnecting the current account.')
    ]);

    const response = await fetchBackend('/api/auth/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ userId })
    });

    if (response.success) {
      await chrome.storage.local.clear();
      await chrome.storage.local.set({
        onboardingComplete: false,
        onboardingGuideState: normalizeGuideState(null, false)
      });
      await setGuideBadge(normalizeGuideState(null, false));
      await clearSetupDiagnostics();
      return response;
    }

    const backendTrace = normalizeTraceEntries(response.trace);
    const extTrace = [
      buildDiagnosticEntry('EXT', 'info', 'backend_response_received', 'Backend replied to the disconnect request.', {
        code: response.code,
        details: response.error
      }),
      ...(
        hasSpecificDiagnosticFailure(backendTrace)
          ? []
          : [buildDiagnosticEntry('EXT', 'error', 'disconnect_failed', 'Disconnect failed in the extension.', {
            code: response.code,
            details: response.error
          })]
      )
    ];
    await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
    return {
      ...response,
      trace: mergeTraceLists(backendTrace, extTrace)
    };
  }

  if (action === 'FETCH_MESSAGES') {
    const trackActivity = shouldTrackActivity(payload);
    const { userId } = await getStoredUser();
    if (!userId) {
      if (trackActivity) {
        await appendSetupDiagnostics([
          buildDiagnosticEntry('EXT', 'error', 'messages_not_connected', 'Mailbox load is unavailable until setup finishes.', {
            code: 'NOT_CONNECTED'
          })
        ]);
      }
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const startTrace = trackActivity
      ? [
        buildDiagnosticEntry('EXT', 'info', 'messages_requested', 'Loading mailbox data.'),
        buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Requesting messages from the backend.')
      ]
      : [];
    if (trackActivity && startTrace.length) {
      await appendSetupDiagnostics(startTrace);
    }

    const params = new URLSearchParams({
      userId,
      folder: payload.folder || 'all',
      limit: String(payload.limit || 50),
      forceSync: String(Boolean(payload.forceSync))
    });
    if (payload.cursor) {
      params.set('cursor', String(payload.cursor));
    }
    if (payload.append) {
      params.set('append', 'true');
    }

    const response = await fetchBackend(`/api/messages?${params.toString()}`);
    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: nowIso() });
      if (trackActivity) {
        const backendTrace = normalizeTraceEntries(response.trace);
        const extTrace = [
          buildDiagnosticEntry('EXT', 'success', 'backend_response_received', 'Backend replied to the mailbox request.', {
            details: `Loaded ${response.count || 0} messages.`
          }),
          buildDiagnosticEntry('EXT', 'success', 'messages_loaded', `Mailbox load complete: ${response.count || 0} messages.`, {
            details: `Inbox ${response.inboxCount || 0}, Sent ${response.sentCount || 0}.`
          })
        ];
        await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
        return {
          ...response,
          trace: mergeTraceLists(startTrace, backendTrace, extTrace)
        };
      }
    }

    if (trackActivity) {
      const backendTrace = normalizeTraceEntries(response.trace);
      const extTrace = [
        buildDiagnosticEntry(
          'EXT',
          response.code === 'BACKEND_COLD_START' ? 'warning' : 'info',
          'backend_response_received',
          'Backend replied to the mailbox request.',
          {
            code: response.code,
            details: response.error,
            replaceKey: response.code === 'BACKEND_COLD_START' ? 'fetch-cold-start' : undefined
          }
        ),
        ...(
          hasSpecificDiagnosticFailure(backendTrace)
            ? []
            : [buildDiagnosticEntry(
          'EXT',
          response.code === 'BACKEND_COLD_START' ? 'warning' : 'error',
          response.code === 'BACKEND_COLD_START' ? 'backend_cold_start' : 'messages_failed',
          response.code === 'BACKEND_COLD_START'
            ? 'Backend is waking up before mailbox load can continue.'
            : 'Mailbox load failed in the extension.',
          {
            code: response.code,
            details: response.error,
            replaceKey: response.code === 'BACKEND_COLD_START' ? 'fetch-cold-start' : undefined
          }
        )]
        )
      ];
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
      return {
        ...response,
        loadedCount: Number(response.loadedCount || response.count || (Array.isArray(response.summaries) ? response.summaries.length : 0)),
        nextCursor: String(response.nextCursor || ''),
        hasMore: Boolean(response.hasMore),
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    return response;
  }

  if (action === 'FETCH_MESSAGE_SUMMARIES') {
    const trackActivity = shouldTrackActivity(payload);
    const { userId } = await getStoredUser();
    if (!userId) {
      if (trackActivity) {
        await appendSetupDiagnostics([
          buildDiagnosticEntry('EXT', 'error', 'summaries_not_connected', 'Summary load is unavailable until setup finishes.', {
            code: 'NOT_CONNECTED'
          })
        ]);
      }
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const startTrace = trackActivity
      ? [
        buildDiagnosticEntry('EXT', 'info', 'summaries_requested', 'Loading mailbox summaries.'),
        buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Requesting message summaries from the backend.')
      ]
      : [];
    if (trackActivity && startTrace.length) {
      await appendSetupDiagnostics(startTrace);
    }

    const params = new URLSearchParams({
      userId,
      folder: payload.folder || 'all',
      limit: String(payload.limit || 50),
      forceSync: String(Boolean(payload.forceSync))
    });

    const response = await fetchBackend(`/api/messages/summary?${params.toString()}`);
    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: nowIso() });
      const backendTrace = normalizeTraceEntries(response.trace);
      const extTrace = [
        buildDiagnosticEntry('EXT', 'success', 'backend_response_received', 'Backend replied to the mailbox summary request.', {
          details: `Loaded ${response.count || 0} summaries.`
        }),
        buildDiagnosticEntry('EXT', 'success', 'message_summaries_loaded', `Mailbox summary load complete: ${response.count || 0} summaries.`, {
          details: `Source ${response.source || 'unknown'}.`
        })
      ];

      if (trackActivity) {
        await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
      }

      return {
        ...response,
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    const backendTrace = normalizeTraceEntries(response.trace);
    const extTrace = [
      buildDiagnosticEntry(
        'EXT',
        response.code === 'BACKEND_COLD_START' ? 'warning' : 'info',
        'backend_response_received',
        'Backend replied to the mailbox summary request.',
        {
          code: response.code,
          details: response.error,
          replaceKey: response.code === 'BACKEND_COLD_START' ? 'summary-cold-start' : undefined
        }
      ),
      ...(
        hasSpecificDiagnosticFailure(backendTrace)
          ? []
          : [buildDiagnosticEntry(
            'EXT',
            response.code === 'BACKEND_COLD_START' ? 'warning' : 'error',
            response.code === 'BACKEND_COLD_START' ? 'backend_cold_start' : 'message_summaries_failed',
            response.code === 'BACKEND_COLD_START'
              ? 'Backend is waking up before mailbox summary load can continue.'
              : 'Mailbox summary load failed in the extension.',
            {
              code: response.code,
              details: response.error,
              replaceKey: response.code === 'BACKEND_COLD_START' ? 'summary-cold-start' : undefined
            }
          )]
      )
    ];

    if (trackActivity) {
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
    }

    return {
      ...response,
      trace: mergeTraceLists(startTrace, backendTrace, extTrace)
    };
  }

  if (action === 'FETCH_CONTACT_MESSAGES') {
    const trackActivity = shouldTrackActivity(payload);
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const startTrace = trackActivity
      ? [
        buildDiagnosticEntry('EXT', 'info', 'contact_messages_requested', 'Loading contact messages.'),
        buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Requesting contact messages from the backend.')
      ]
      : [];
    if (trackActivity && startTrace.length) {
      await appendSetupDiagnostics(startTrace);
    }

    const params = new URLSearchParams({
      userId,
      contactEmail: String(payload.contactEmail || ''),
      limitPerFolder: String(payload.limitPerFolder || 50),
      forceSync: String(Boolean(payload.forceSync))
    });
    const response = await fetchBackend(`/api/messages/contact?${params.toString()}`);
    const backendTrace = normalizeTraceEntries(response.trace);
    const extTrace = [
      buildDiagnosticEntry(
        'EXT',
        response.success ? 'success' : (response.code === 'BACKEND_COLD_START' ? 'warning' : 'info'),
        response.success ? 'contact_messages_loaded' : 'contact_messages_failed',
        response.success
          ? 'Backend returned contact messages.'
          : 'Backend contact message load failed.',
        {
          code: response.success ? undefined : response.code,
          details: response.success
            ? `Returned ${Array.isArray(response.messages) ? response.messages.length : 0} messages.`
            : response.error
        }
      )
    ];

    if (trackActivity) {
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
    }

    return {
      ...response,
      trace: mergeTraceLists(startTrace, backendTrace, extTrace)
    };
  }

  if (action === 'DEBUG_REFETCH_CONTACT') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const response = await fetchBackend('/api/messages/debug/contact', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        contactEmail: payload.contactEmail,
        selectedMessageIds: Array.isArray(payload.selectedMessageIds) ? payload.selectedMessageIds : []
      })
    });

    const backendTrace = normalizeTraceEntries(response.trace);
    const extTrace = [
      buildDiagnosticEntry(
        'EXT',
        response.success ? 'success' : 'info',
        response.success ? 'contact_debug_refetch_complete' : 'contact_debug_refetch_failed',
        response.success
          ? 'Backend returned the live contact debug refresh payload.'
          : 'Backend contact debug refresh failed.',
        {
          code: response.success ? undefined : response.code,
          details: response.success
            ? `Returned ${Array.isArray(response.messages) ? response.messages.length : 0} messages.`
            : response.error
        }
      )
    ];

    return {
      ...response,
      trace: mergeTraceLists(backendTrace, extTrace)
    };
  }

  if (action === 'SEARCH_MESSAGES') {
    const trackActivity = shouldTrackActivity(payload);
    const { userId } = await getStoredUser();
    if (!userId) {
      if (trackActivity) {
        await appendSetupDiagnostics([
          buildDiagnosticEntry('EXT', 'error', 'search_not_connected', 'Search is unavailable until setup finishes.', {
            code: 'NOT_CONNECTED'
          })
        ]);
      }
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const startTrace = trackActivity
      ? [
        buildDiagnosticEntry('EXT', 'info', 'search_requested', 'Searching mailbox data.'),
        buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Sending search request to the backend.')
      ]
      : [];
    if (trackActivity && startTrace.length) {
      await appendSetupDiagnostics(startTrace);
    }

    const params = new URLSearchParams({
      userId,
      query: payload.query || '',
      limit: String(payload.limit || 20)
    });
    const response = await fetchBackend(`/api/messages/search?${params.toString()}`);

    if (trackActivity) {
      const backendTrace = normalizeTraceEntries(response.trace);
      const extTrace = [
        buildDiagnosticEntry(
          'EXT',
          response.success ? 'success' : (response.code === 'BACKEND_COLD_START' ? 'warning' : 'info'),
          'backend_response_received',
          'Backend replied to the search request.',
          {
            code: response.success ? undefined : response.code,
            details: response.success ? `Returned ${response.count || 0} results.` : response.error,
            replaceKey: response.code === 'BACKEND_COLD_START' ? 'search-cold-start' : undefined
          }
        ),
        ...(
          response.success || !hasSpecificDiagnosticFailure(backendTrace)
            ? [buildDiagnosticEntry(
              'EXT',
              response.success ? 'success' : (response.code === 'BACKEND_COLD_START' ? 'warning' : 'error'),
              response.success ? 'search_complete' : (response.code === 'BACKEND_COLD_START' ? 'backend_cold_start' : 'search_failed'),
              response.success
                ? `Search complete: ${response.count || 0} results.`
                : (response.code === 'BACKEND_COLD_START'
                  ? 'Backend is waking up before search can continue.'
                  : 'Search failed in the extension.'),
              {
                code: response.success ? undefined : response.code,
                details: response.success ? `Source ${response.source || 'unknown'}.` : response.error,
                replaceKey: response.code === 'BACKEND_COLD_START' ? 'search-cold-start' : undefined
              }
            )]
            : []
        )
      ];
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
      return {
        ...response,
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    return response;
  }

  if (action === 'SYNC_MESSAGES') {
    const trackActivity = shouldTrackActivity(payload);
    const { userId } = await getStoredUser();
    if (!userId) {
      if (trackActivity) {
        await appendSetupDiagnostics([
          buildDiagnosticEntry('EXT', 'error', 'sync_not_connected', 'Sync is unavailable until setup finishes.', {
            code: 'NOT_CONNECTED'
          })
        ]);
      }
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const startTrace = trackActivity
      ? [
        buildDiagnosticEntry('EXT', 'info', 'sync_requested', 'Starting automatic mailbox sync.'),
        buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Starting or resuming a background sync job.')
      ]
      : [];
    if (trackActivity && startTrace.length) {
      await appendSetupDiagnostics(startTrace);
    }

    const response = await ensureSyncJobRunning({ trackActivity });

    if (response.success) {
      const backendTrace = normalizeTraceEntries(response.trace);
      const extTrace = [
        buildDiagnosticEntry('EXT', 'success', 'backend_response_received', 'Backend replied to the sync start request.', {
          details: `jobId=${response.jobId}; status=${response.status}; phase=${response.phase}`
        }),
        buildDiagnosticEntry('EXT', 'success', 'sync_job_running', 'Mailbox sync is now running in the background.', {
          details: `jobId=${response.jobId}`
        })
      ];
      if (trackActivity) {
        await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
      }
      return {
        ...response,
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    if (trackActivity) {
      const backendTrace = normalizeTraceEntries(response.trace);
      const extTrace = [
        buildDiagnosticEntry(
          'EXT',
          response.code === 'BACKEND_COLD_START' ? 'warning' : 'info',
          'backend_response_received',
          'Backend replied to the sync request.',
          {
            code: response.code,
            details: response.error,
            replaceKey: response.code === 'BACKEND_COLD_START' ? 'sync-cold-start' : undefined
          }
        ),
        ...(
          hasSpecificDiagnosticFailure(backendTrace)
            ? []
            : [buildDiagnosticEntry(
          'EXT',
          response.code === 'BACKEND_COLD_START' ? 'warning' : 'error',
          response.code === 'BACKEND_COLD_START' ? 'backend_cold_start' : 'sync_failed',
          response.code === 'BACKEND_COLD_START'
            ? 'Backend is waking up before sync can continue.'
            : 'Automatic sync failed in the extension.',
          {
            code: response.code,
            details: response.error,
            replaceKey: response.code === 'BACKEND_COLD_START' ? 'sync-cold-start' : undefined
          }
        )]
        )
      ];
      await appendSetupDiagnostics(mergeTraceLists(backendTrace, extTrace));
      return {
        ...response,
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    return response;
  }

  if (action === 'HEALTH_CHECK') {
    const response = await fetchHealth();
    const extTrace = [
      buildDiagnosticEntry(
        'EXT',
        response.success ? 'success' : (response.code === 'BACKEND_COLD_START' ? 'warning' : 'error'),
        response.success ? 'health_check_complete' : (response.code === 'BACKEND_COLD_START' ? 'backend_cold_start' : 'health_check_failed'),
        response.success ? 'Backend health check succeeded.' : response.error || 'Backend health check failed.',
        {
          code: response.success ? undefined : response.code,
          details: response.success ? `Uptime ${Math.floor(Number(response.uptime || 0))}s.` : response.error,
          replaceKey: response.code === 'BACKEND_COLD_START' ? 'health-cold-start' : undefined
        }
      )
    ];
    await appendSetupDiagnostics(extTrace);
    return {
      ...response,
      trace: mergeTraceLists(response.trace, extTrace)
    };
  }

  if (action === 'GET_STORAGE') {
    const stored = await getStoredUser();
    return {
      success: true,
      ...stored,
      onboardingGuideState: normalizeGuideState(stored.onboardingGuideState, Boolean(stored.connected))
    };
  }

  return null;
}

function isGmailTabUrl(url) {
  return typeof url === 'string' && url.startsWith('https://mail.google.com/');
}

async function shouldInjectMailita(tabId) {
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => Boolean(
        document.getElementById('gmailUnifiedSidebar')
        || window.__mailitaBooting
        || window.__mailitaContentReady
      )
    });
    return !Boolean(result);
  } catch {
    return true;
  }
}

async function ensureMailitaInjected(tabId, url = '') {
  if (!Number.isInteger(tabId) || !isGmailTabUrl(url)) return;
  const needsInjection = await shouldInjectMailita(tabId);
  if (!needsInjection) return;

  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content/styles.css']
    });
  } catch {
    // Ignore duplicate CSS injection failures while Gmail is navigating.
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content/gmail-inject.js']
    });
  } catch {
    // Ignore injection failures while Gmail is still swapping documents.
  }
}

async function reinjectOpenGmailTabs() {
  const tabs = await chrome.tabs.query({ url: ['https://mail.google.com/*'] });
  await Promise.all(
    tabs
      .filter((tab) => Number.isInteger(tab.id) && isGmailTabUrl(tab.url))
      .map((tab) => ensureMailitaInjected(tab.id, tab.url))
  );
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs
    .get(tabId)
    .then((tab) => Promise.allSettled([
      syncGuideContextFromTab(tab),
      ensureMailitaInjected(tab.id, tab.url)
    ]))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!Number.isInteger(tabId)) return;
  if (typeof changeInfo.url === 'string' || changeInfo.status === 'complete') {
    syncGuideContextFromTab(tab).catch(() => {});
  }
  if (changeInfo.status === 'complete' && isGmailTabUrl(tab?.url)) {
    ensureMailitaInjected(tabId, tab.url).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['onboardingGuideState', 'userId', 'accountEmail', 'mailSource']);
  if (!stored.onboardingGuideState) {
    await chrome.storage.local.set({
      onboardingGuideState: normalizeGuideState(null, Boolean(stored.accountEmail || stored.userId)),
      mailSource: stored.mailSource || DEFAULT_MAIL_SOURCE
    });
  }
  await setGuideBadge(normalizeGuideState(stored.onboardingGuideState, Boolean(stored.accountEmail || stored.userId)));
  await ensureSyncAlarm();
  await reinjectOpenGmailTabs();
});

chrome.runtime.onStartup?.addListener(async () => {
  const guideState = await readGuideState();
  await setGuideBadge(guideState);
  await ensureSyncAlarm();
  await reinjectOpenGmailTabs();
});

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm?.name !== SYNC_ALARM_NAME) return;
  maybeKickAutomaticSync('alarm').catch(() => {});
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message) {
    return false;
  }

  if (typeof message.action === 'string') {
    if (!GUIDE_ACTIONS.has(message.action)) {
      sendResponse({
        success: false,
        code: 'BAD_REQUEST',
        error: `Unknown action: ${message.action}`
      });
      return false;
    }

    const payload = sanitizePayload(message.payload);
    if (!payload) {
      sendResponse({
        success: false,
        code: 'BAD_REQUEST',
        error: 'Invalid payload.'
      });
      return false;
    }

    handleBackendAction({ action: message.action, payload })
      .then((result) => {
        if (result) {
          sendResponse(result);
        } else {
          sendResponse({
            success: false,
            code: 'BACKEND_UNAVAILABLE',
            error: `Unknown action: ${message.action}`
          });
        }
      })
      .catch((error) => {
        console.error('[Extension SW ERROR]', error?.message || error);
        appendSetupDiagnostics([
          buildDiagnosticEntry('EXT', 'error', 'background_unhandled_error', 'Unhandled extension error.', {
            code: 'BACKEND_UNAVAILABLE',
            details: error?.message || 'Unhandled background error.'
          })
        ]).catch(() => {});
        sendResponse({
          success: false,
          code: 'BACKEND_UNAVAILABLE',
          error: error?.message || 'Unhandled background error.'
        });
      });

    return true;
  }

  return false;
});

readGuideState()
  .then((guideState) => setGuideBadge(guideState))
  .catch(() => {});
