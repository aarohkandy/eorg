const onboardingView = document.getElementById('onboardingView');
const connectedView = document.getElementById('connectedView');

const wizardStepText = document.getElementById('wizardStepText');
const wizardDots = [...document.querySelectorAll('.wizard-dot')];
const wizardSteps = [...document.querySelectorAll('.wizard-step')];

const step1Continue = document.getElementById('step1Continue');
const step2Back = document.getElementById('step2Back');

const onboardingEmailInput = document.getElementById('onboardingEmailInput');
const onboardingPasswordInput = document.getElementById('onboardingPasswordInput');
const onboardingConnectBtn = document.getElementById('onboardingConnectBtn');
const onboardingError = document.getElementById('onboardingError');
const onboardingSuccess = document.getElementById('onboardingSuccess');

const connectedEmail = document.getElementById('connectedEmail');
const lastSync = document.getElementById('lastSync');
const syncBtn = document.getElementById('syncBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const retrySyncBtn = document.getElementById('retrySyncBtn');
const connectedStatus = document.getElementById('connectedStatus');
const connectedColdStart = document.getElementById('connectedColdStart');
const step1OpenTwoFactor = document.getElementById('step1OpenTwoFactor');
const step2OpenAppPasswords = document.getElementById('step2OpenAppPasswords');
const step2OpenTwoFactor = document.getElementById('step2OpenTwoFactor');

const GUIDE_STEP_KEYS = ['welcome', 'connect_account'];
const APP_PASSWORDS_URL = 'https://myaccount.google.com/apppasswords';
const TWO_STEP_VERIFICATION_URL = 'https://myaccount.google.com/signinoptions/two-step-verification';

let currentWizardStep = 1;
let reconnectMode = false;
let connectInFlight = false;

function setVisible(element, visible) {
  element.classList.toggle('hidden', !visible);
}

function setPopupMode(mode) {
  document.body.classList.toggle('onboarding', mode === 'onboarding');
}

function toRelativeTime(isoString) {
  if (!isoString) return 'Never';
  const diffMs = Date.now() - new Date(isoString).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'Just now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins === 1) return '1 minute ago';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.floor(mins / 60);
  if (hours === 1) return '1 hour ago';
  return `${hours} hours ago`;
}

function setWizardStep(step) {
  currentWizardStep = Math.min(2, Math.max(1, Number(step) || 1));

  wizardSteps.forEach((section) => {
    const active = Number(section.dataset.step) === currentWizardStep;
    section.classList.toggle('active', active);
  });

  wizardDots.forEach((dot, index) => {
    dot.classList.toggle('active', index < currentWizardStep);
  });

  wizardStepText.textContent = `Step ${currentWizardStep} of 2`;
  step2Back.classList.toggle('hidden', reconnectMode);
}

function wizardStepFromKey(stepKey) {
  const index = GUIDE_STEP_KEYS.indexOf(stepKey);
  return index >= 0 ? index + 1 : 1;
}

function applyGuideStateToWizard(guideState) {
  if (!guideState || typeof guideState !== 'object') return;
  const step = wizardStepFromKey(guideState.step);
  setWizardStep(step);
}

function showOnboarding(step = 1, useReconnectMode = false) {
  reconnectMode = useReconnectMode;
  setPopupMode('onboarding');
  setVisible(onboardingView, true);
  setVisible(connectedView, false);
  setWizardStep(step);
}

function showConnected(state) {
  setPopupMode('connected');
  setVisible(onboardingView, false);
  setVisible(connectedView, true);

  connectedEmail.textContent = `Connected: ${state.userEmail || ''}`;
  lastSync.textContent = `Last synced: ${toRelativeTime(state.lastSyncTime)}`;
}

function showOnboardingError(message) {
  onboardingError.textContent = message;
  setVisible(onboardingError, true);
  setVisible(onboardingSuccess, false);
}

function showOnboardingSuccess(message) {
  onboardingSuccess.textContent = message;
  setVisible(onboardingSuccess, true);
  setVisible(onboardingError, false);
}

function clearOnboardingMessages() {
  setVisible(onboardingError, false);
  setVisible(onboardingSuccess, false);
}

function setConnectButtonLoading(loading) {
  connectInFlight = loading;
  onboardingConnectBtn.disabled = loading;

  if (loading) {
    onboardingConnectBtn.innerHTML = '<span class="spinner"></span>Connecting...';
  } else {
    onboardingConnectBtn.textContent = 'Connect My Account';
  }
}

function showConnectedStatus(message, isError = false) {
  connectedStatus.textContent = message || '';
  connectedStatus.className = `status ${isError ? 'error' : 'success'}`;
}

function showColdStart(target, show) {
  setVisible(target, show);
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

async function callWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

async function openExternalTab(url) {
  await chrome.tabs.create({ url });
}

async function fetchGuideState() {
  const response = await callWorker('GUIDE_GET_STATE');
  return response?.success ? response.guideState : null;
}

async function confirmGuideStep(stepKey, payload = {}) {
  const response = await callWorker('GUIDE_CONFIRM_STEP', { step: stepKey, ...payload });
  if (response?.success && response.guideState) {
    applyGuideStateToWizard(response.guideState);
  }
  return response;
}

async function refreshPopupState() {
  const state = await chrome.storage.local.get([
    'userId',
    'userEmail',
    'lastSyncTime',
    'onboardingComplete',
    'pinReminderShown'
  ]);

  if (state.userId && state.onboardingComplete === true) {
    showConnected(state);
    return;
  }

  if (state.userId && !state.onboardingComplete) {
    await chrome.storage.local.set({ onboardingComplete: true });
    showConnected({ ...state, onboardingComplete: true });
    return;
  }

  if (!state.userId && !state.onboardingComplete) {
    const guideState = await fetchGuideState();
    showOnboarding(wizardStepFromKey(guideState?.step || 'welcome'), false);
    return;
  }

  // Safety fallback: onboarding was completed before but userId is missing.
  const guideState = await fetchGuideState();
  showOnboarding(wizardStepFromKey(guideState?.step || 'connect_account'), true);
}

async function connectFromOnboarding() {
  if (connectInFlight) return;

  clearOnboardingMessages();

  const email = String(onboardingEmailInput.value || '').trim();
  const appPassword = String(onboardingPasswordInput.value || '').trim().replace(/\s+/g, '');

  if (!email || !appPassword) {
    showOnboardingError('Please provide both Gmail address and App Password.');
    return;
  }

  setConnectButtonLoading(true);

  try {
    const response = await callWorker('CONNECT', { email, appPassword });

    if (!response?.success) {
      showOnboardingError(mapConnectError(response));
      return;
    }

    onboardingPasswordInput.value = '';
    await confirmGuideStep('connect_account', {
      substep: 'connect_submitted',
      reason: 'connect_submitted',
      evidence: {
        appPassword: {
          generatedAt: new Date().toISOString(),
          source: 'connect_submit'
        }
      }
    });

    const existing = await chrome.storage.local.get(['pinReminderShown']);
    const updates = {
      onboardingComplete: true,
      userId: response.userId,
      userEmail: response.email
    };

    if (!existing.pinReminderShown) {
      updates.pinReminderShown = true;
    }

    await chrome.storage.local.set(updates);

    let successMessage = 'Connected. Loading your messages...';
    if (!existing.pinReminderShown) {
      successMessage +=
        '\n\nTip: Pin this extension to your toolbar so it is always one click away.';
    }

    showOnboardingSuccess(successMessage);

    setTimeout(async () => {
      const nextState = await chrome.storage.local.get([
        'userId',
        'userEmail',
        'lastSyncTime',
        'onboardingComplete'
      ]);
      showConnected(nextState);
      showConnectedStatus('Connected successfully.', false);
      window.close();
    }, 900);
  } finally {
    onboardingPasswordInput.value = '';
    setConnectButtonLoading(false);
  }
}

step1Continue.addEventListener('click', () => {
  clearOnboardingMessages();
  openExternalTab(APP_PASSWORDS_URL)
    .catch(() => {})
    .then(() => confirmGuideStep('welcome'))
    .then(() => setWizardStep(2))
    .catch(() => setWizardStep(2));
});

step1OpenTwoFactor.addEventListener('click', async () => {
  await openExternalTab(TWO_STEP_VERIFICATION_URL);
});

step2Back.addEventListener('click', () => {
  if (reconnectMode) return;
  clearOnboardingMessages();
  setWizardStep(1);
});

onboardingConnectBtn.addEventListener('click', async () => {
  await connectFromOnboarding();
});

step2OpenAppPasswords.addEventListener('click', async () => {
  await openExternalTab(APP_PASSWORDS_URL);
});

step2OpenTwoFactor.addEventListener('click', async () => {
  await openExternalTab(TWO_STEP_VERIFICATION_URL);
});

onboardingPasswordInput.addEventListener('keydown', async (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    await connectFromOnboarding();
  }
});

syncBtn.addEventListener('click', async () => {
  showConnectedStatus('Syncing...', false);
  showColdStart(connectedColdStart, false);

  const response = await callWorker('SYNC_MESSAGES');
  if (!response?.success) {
    if (response.code === 'BACKEND_COLD_START') {
      showConnectedStatus('', false);
      showColdStart(connectedColdStart, true);
      setVisible(retrySyncBtn, true);
      return;
    }

    showConnectedStatus(response?.error || 'Sync failed.', true);
    return;
  }

  showConnectedStatus(`Done! ${response.synced} messages synced.`, false);
  setVisible(retrySyncBtn, false);
  await refreshPopupState();
});

retrySyncBtn.addEventListener('click', async () => {
  await syncBtn.click();
});

disconnectBtn.addEventListener('click', async () => {
  showConnectedStatus('Disconnecting...', false);
  const response = await callWorker('DISCONNECT');
  if (!response?.success) {
    showConnectedStatus(response?.error || 'Disconnect failed.', true);
    return;
  }

  showConnectedStatus('Disconnected.', false);
  await refreshPopupState();
});

refreshPopupState();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
    refreshPopupState().catch(() => {});
  }
});
