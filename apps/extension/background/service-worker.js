/* global chrome */

const BACKEND_URL = 'https://email-bcknd.onrender.com';
const FETCH_TIMEOUT_MS = 12000;
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
  'messages_failed',
  'search_failed',
  'sync_failed',
  'health_check_failed'
]);

const GUIDE_STEPS = ['welcome', 'connect_account'];
const GUIDE_STEP_SET = new Set(GUIDE_STEPS);
const GUIDE_STEP_ORDER = {
  welcome: 0,
  connect_account: 1
};
const GUIDE_SUBSTEPS = {
  welcome: new Set(['intro']),
  connect_account: new Set(['connect_ready', 'connect_submitted']),
  connected: new Set(['connected'])
};

const GUIDE_ACTIONS = new Set([
  'CONNECT',
  'DISCONNECT',
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

function nowIso() {
  return new Date().toISOString();
}

function firstPendingStep(status) {
  for (const step of GUIDE_STEPS) {
    if (status[step] !== 'done') return step;
  }
  return 'connect_account';
}

function defaultGuideStatus() {
  return {
    welcome: 'in_progress',
    connect_account: 'pending'
  };
}

function defaultGuideEvidence() {
  return {
    appPassword: {
      generatedAt: null,
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
  const appPassword = src.appPassword && typeof src.appPassword === 'object' ? src.appPassword : {};

  evidence.appPassword.generatedAt = normalizeIsoField(appPassword.generatedAt);
  evidence.appPassword.source = typeof appPassword.source === 'string' ? appPassword.source : null;

  return evidence;
}

function defaultSubstepForStep(step, status) {
  if (step === 'welcome') return 'intro';

  if (step === 'connect_account') return 'connect_ready';

  return 'intro';
}

function buildConnectedGuideState(evidence = defaultGuideEvidence()) {
  return {
    step: 'connect_account',
    substep: 'connected',
    status: {
      welcome: 'done',
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
    || src.step === 'enable_imap'
    || src.step === 'generate_app_password'
    || src.step === 'connect_account'
  );

  if (legacyProgressed && status.welcome !== 'done') {
    status.welcome = 'done';
  }

  if (legacyProgressed && status.connect_account === 'pending') {
    status.connect_account = 'in_progress';
  }

  if (status.connect_account === 'done') {
    status.welcome = 'done';
  }

  const evidence = normalizeGuideEvidence(src.evidence);
  const connected = Boolean(src.connected || hasUserId);
  if (connected) {
    return buildConnectedGuideState(evidence);
  }

  let step = GUIDE_STEP_SET.has(src.step)
    ? src.step
    : (status.welcome === 'done' ? 'connect_account' : 'welcome');

  if (step === 'welcome' && status.welcome === 'done') {
    step = 'connect_account';
  }

  if (step === 'welcome' && status.welcome === 'pending') {
    status.welcome = 'in_progress';
  }

  if (step === 'connect_account' && status.connect_account === 'pending' && status.welcome === 'done') {
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
    await chrome.action.setTitle({ title: 'Gmail Unified' });
    return;
  }

  await chrome.action.setBadgeBackgroundColor({ color: '#1a73e8' });
  await chrome.action.setBadgeText({ text: `${state.progress}/${state.total}` });
  await chrome.action.setTitle({ title: `Gmail Unified setup: ${state.progress}/${state.total} complete` });
}

async function readGuideState() {
  const stored = await chrome.storage.local.get(['onboardingGuideState', 'userId']);
  return recalcGuideState(normalizeGuideState(stored.onboardingGuideState, Boolean(stored.userId)));
}

async function persistGuideState(nextState) {
  const storage = await chrome.storage.local.get(['userId']);
  const normalized = recalcGuideState(normalizeGuideState(nextState, Boolean(storage.userId)));
  await chrome.storage.local.set({ onboardingGuideState: normalized });
  await setGuideBadge(normalized);
  return normalized;
}

function guideContextFromUrl(url) {
  const value = String(url || '').toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('mail.google.com')) return 'gmail_inbox';
  if (value.includes('myaccount.google.com')) return 'google_account';
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
  if (step === guideState.step) return true;

  if (step === 'welcome' && guideState.status.welcome !== 'done') {
    return true;
  }

  if (step === 'connect_account' && guideState.status.welcome === 'done') {
    return true;
  }

  return false;
}

function mergeEvidence(guideState, patchEvidence) {
  if (!patchEvidence || typeof patchEvidence !== 'object') return;

  if (patchEvidence.appPassword && typeof patchEvidence.appPassword === 'object') {
    const appPassword = patchEvidence.appPassword;
    if (typeof appPassword.generatedAt === 'string') {
      guideState.evidence.appPassword.generatedAt = appPassword.generatedAt;
    }
    if (typeof appPassword.source === 'string') {
      guideState.evidence.appPassword.source = appPassword.source;
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

  if (
    context === 'gmail_inbox' &&
    guide.status.welcome === 'done' &&
    guide.status.connect_account !== 'done'
  ) {
    if (guide.step !== 'connect_account') {
      guide.step = 'connect_account';
      changed = true;
    }
    if (guide.status.connect_account === 'pending') {
      guide.status.connect_account = 'in_progress';
      changed = true;
    }
    if (guide.substep !== 'connect_ready') {
      guide.substep = 'connect_ready';
      changed = true;
    }
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

async function fetchBackend(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

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
      return coldStartError();
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      return normalizeError(data, response.status === 401 ? 'NOT_CONNECTED' : 'BACKEND_UNAVAILABLE');
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError' || String(error.message || '').includes('Failed to fetch')) {
      console.error('[Extension SW ERROR] Backend cold start detected (Render sleeping). Retry in 60s.');
      return coldStartError();
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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    if ([502, 503, 504].includes(response.status)) {
      return coldStartError();
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
        code: 'BACKEND_UNAVAILABLE',
        error: 'Backend health check failed.',
        trace: []
      };
    }

    return {
      success: true,
      status: data?.status || 'ok',
      timestamp: data?.timestamp || null,
      uptime: data?.uptime,
      version: data?.version || 'unknown',
      buildSha: data?.buildSha || 'unknown',
      deployedAt: data?.deployedAt || null
    };
  } catch (error) {
    if (error.name === 'AbortError' || String(error.message || '').includes('Failed to fetch')) {
      return coldStartError();
    }
    return {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error.message || 'Backend health check failed.',
      trace: []
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getStoredUser() {
  const { userId, userEmail, lastSyncTime, onboardingComplete, onboardingGuideState, setupDiagnostics } =
    await chrome.storage.local.get([
      'userId',
      'userEmail',
      'lastSyncTime',
      'onboardingComplete',
      'onboardingGuideState',
      SETUP_DIAGNOSTICS_KEY
    ]);
  return {
    userId,
    userEmail,
    lastSyncTime,
    onboardingComplete,
    onboardingGuideState,
    setupDiagnostics: normalizeSetupDiagnostics(setupDiagnostics)
  };
}

function sanitizePayload(payload) {
  if (payload == null) return {};
  if (typeof payload === 'object' && !Array.isArray(payload)) return payload;
  return null;
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

    if (step === 'welcome') {
      guideState.status.welcome = 'done';
      guideState.step = firstPendingStep(guideState.status);
      if (guideState.status[guideState.step] === 'pending') {
        guideState.status[guideState.step] = 'in_progress';
      }
      guideState.substep = defaultSubstepForStep(guideState.step, guideState.status);
      guideState.updatedAt = nowIso();
      return { success: true, guideState: await persistGuideState(guideState) };
    }

    if (step === 'connect_account') {
      if (substep && !GUIDE_SUBSTEPS.connect_account.has(substep)) {
        return {
          success: false,
          code: 'BAD_REQUEST',
          error: 'Invalid connect substep.'
        };
      }
      if (guideState.status.welcome !== 'done') {
        guideState.status.welcome = 'done';
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

    if (step !== 'welcome' && guideState.status.welcome !== 'done') {
      guideState.status.welcome = 'done';
    }

    guideState.step = step;
    if (guideState.status[step] === 'pending') {
      guideState.status[step] = 'in_progress';
    }

    if (step === 'connect_account') {
      guideState.substep = 'connect_ready';
    } else {
      guideState.substep = 'intro';
    }

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
          : 'Connection failed before Gmail Unified finished setup.',
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
        trace: mergeTraceLists(startTrace, backendTrace, extTrace)
      };
    }

    return response;
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
        buildDiagnosticEntry('EXT', 'info', 'sync_requested', 'Starting manual mailbox sync.'),
        buildDiagnosticEntry('EXT', 'info', 'backend_request', 'Sending sync request to the backend.')
      ]
      : [];
    if (trackActivity && startTrace.length) {
      await appendSetupDiagnostics(startTrace);
    }

    const response = await fetchBackend('/api/messages/sync', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: nowIso() });
      if (trackActivity) {
        const backendTrace = normalizeTraceEntries(response.trace);
        const extTrace = [
          buildDiagnosticEntry('EXT', 'success', 'backend_response_received', 'Backend replied to the sync request.', {
            details: `Synced ${response.synced || 0} messages.`
          }),
          buildDiagnosticEntry('EXT', 'success', 'sync_complete', `Manual sync complete: ${response.synced || 0} messages.`, {
            details: 'Mailbox cache updated successfully.'
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
            : 'Manual sync failed in the extension.',
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
      onboardingGuideState: normalizeGuideState(stored.onboardingGuideState, Boolean(stored.userId))
    };
  }

  return null;
}

chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!Number.isInteger(tabId)) return;
  chrome.tabs
    .get(tabId)
    .then((tab) => syncGuideContextFromTab(tab))
    .catch(() => {});
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!Number.isInteger(tabId)) return;
  if (typeof changeInfo.url === 'string' || changeInfo.status === 'complete') {
    syncGuideContextFromTab(tab).catch(() => {});
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  const stored = await chrome.storage.local.get(['onboardingGuideState', 'userId']);
  if (!stored.onboardingGuideState) {
    await chrome.storage.local.set({ onboardingGuideState: normalizeGuideState(null, Boolean(stored.userId)) });
  }
  await setGuideBadge(normalizeGuideState(stored.onboardingGuideState, Boolean(stored.userId)));
});

chrome.runtime.onStartup?.addListener(async () => {
  const guideState = await readGuideState();
  await setGuideBadge(guideState);
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
