/* global chrome */

const BACKEND_URL = 'https://email-bcknd.onrender.com';
const FETCH_TIMEOUT_MS = 12000;
const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';

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
  'SEARCH_MESSAGES',
  'SYNC_MESSAGES',
  'HEALTH_CHECK',
  'GET_STORAGE',
  'GUIDE_GET_STATE',
  'GUIDE_NAVIGATE_TO_STEP',
  'GUIDE_CONFIRM_STEP',
  'GUIDE_RESET'
]);

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

function coldStartError() {
  return {
    success: false,
    code: 'BACKEND_COLD_START',
    error: COLD_START_MESSAGE,
    retriable: true,
    retryAfterSec: 60
  };
}

function normalizeError(payload, fallbackCode = 'BACKEND_UNAVAILABLE') {
  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      code: fallbackCode,
      error: 'Backend returned an invalid response.'
    };
  }

  return {
    success: false,
    code: payload.code || fallbackCode,
    error: payload.error || 'Backend request failed.',
    retriable: payload.retriable,
    retryAfterSec: payload.retryAfterSec
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
      error: error.message || 'Backend request failed.'
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
        error: 'Backend health check failed.'
      };
    }

    return {
      success: true,
      status: data?.status || 'ok',
      timestamp: data?.timestamp || null,
      uptime: data?.uptime
    };
  } catch (error) {
    if (error.name === 'AbortError' || String(error.message || '').includes('Failed to fetch')) {
      return coldStartError();
    }
    return {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error.message || 'Backend health check failed.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getStoredUser() {
  const { userId, userEmail, lastSyncTime, onboardingComplete, onboardingGuideState } =
    await chrome.storage.local.get([
      'userId',
      'userEmail',
      'lastSyncTime',
      'onboardingComplete',
      'onboardingGuideState'
    ]);
  return {
    userId,
    userEmail,
    lastSyncTime,
    onboardingComplete,
    onboardingGuideState
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

async function handleBackendAction(message) {
  const action = message?.action;
  const payload = message?.payload || {};

  if (action && action.startsWith('GUIDE_')) {
    return handleGuideAction(action, payload);
  }

  if (action === 'CONNECT') {
    const response = await fetchBackend('/api/auth/connect', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (response.success) {
      await chrome.storage.local.set({
        userId: response.userId,
        userEmail: response.email,
        lastSyncTime: null,
        onboardingComplete: true
      });
      await persistGuideState(buildConnectedGuideState());
    }

    return response;
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
    }

    return response;
  }

  if (action === 'FETCH_MESSAGES') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
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
    }

    return response;
  }

  if (action === 'SEARCH_MESSAGES') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const params = new URLSearchParams({
      userId,
      query: payload.query || '',
      limit: String(payload.limit || 20)
    });
    return fetchBackend(`/api/messages/search?${params.toString()}`);
  }

  if (action === 'SYNC_MESSAGES') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const response = await fetchBackend('/api/messages/sync', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: nowIso() });
    }

    return response;
  }

  if (action === 'HEALTH_CHECK') {
    return fetchHealth();
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
