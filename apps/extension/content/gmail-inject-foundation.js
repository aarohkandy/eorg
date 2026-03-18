const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';
const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords';
const TWO_STEP_VERIFICATION_URL = 'https://myaccount.google.com/signinoptions/two-step-verification';

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

Object.assign(globalThis, {
  COLD_START_MESSAGE,
  APP_PASSWORDS_URL,
  TWO_STEP_VERIFICATION_URL,
  GUIDE_STEPS,
  GUIDE_STEP_SET,
  GUIDE_SUBSTEP_COPY,
  state,
  isMailHost,
  sendWorker,
  openExternalPage,
  createDiagnosticId,
  normalizeDiagnosticDetails,
  normalizeDiagnosticEntry,
  normalizeSetupDiagnostics,
  appendUiActivity,
  defaultGuideState,
  normalizeGuideState,
  stepNumberFromKey,
  resolvedGuideStepForUi,
  currentPageContext,
  friendlyContextLabel,
  updateMainPanelVisibility,
  waitForGmail,
  formatDate,
  escapeHtml
});
