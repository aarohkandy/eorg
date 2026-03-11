const onboardingView = document.getElementById('onboardingView');
const connectedView = document.getElementById('connectedView');

const wizardStepText = document.getElementById('wizardStepText');
const wizardDots = [...document.querySelectorAll('.wizard-dot')];
const wizardSteps = [...document.querySelectorAll('.wizard-step')];

const step1Next = document.getElementById('step1Next');
const step2Back = document.getElementById('step2Back');
const step2Open = document.getElementById('step2Open');
const step3Back = document.getElementById('step3Back');
const step3Open = document.getElementById('step3Open');
const step4Back = document.getElementById('step4Back');

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

const GUIDE_STEP_KEYS = ['welcome', 'enable_imap', 'generate_app_password', 'connect_account'];

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
  currentWizardStep = Math.min(4, Math.max(1, Number(step) || 1));

  wizardSteps.forEach((section) => {
    const active = Number(section.dataset.step) === currentWizardStep;
    section.classList.toggle('active', active);
  });

  wizardDots.forEach((dot, index) => {
    dot.classList.toggle('active', index < currentWizardStep);
  });

  wizardStepText.textContent = `Step ${currentWizardStep} of 4`;

  if (reconnectMode) {
    step4Back.classList.add('hidden');
  } else {
    step4Back.classList.remove('hidden');
  }
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

async function fetchGuideState() {
  const response = await callWorker('GUIDE_GET_STATE');
  return response?.success ? response.guideState : null;
}

async function navigateGuideStep(stepKey) {
  const response = await callWorker('GUIDE_NAVIGATE_TO_STEP', { step: stepKey });
  if (response?.success && response.guideState) {
    applyGuideStateToWizard(response.guideState);
  }
  return response;
}

async function confirmGuideStep(stepKey) {
  const response = await callWorker('GUIDE_CONFIRM_STEP', { step: stepKey });
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
  const appPassword = String(onboardingPasswordInput.value || '').trim();

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
    await confirmGuideStep('connect_account');

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

    let successMessage = '✓ Connected! Loading your messages...';
    if (!existing.pinReminderShown) {
      successMessage +=
        '\n\n💡 Tip: Pin this extension to your toolbar so it is always one click away. Right-click the puzzle piece 🧩 in Chrome\'s toolbar, find Gmail Unified, then click the pin icon.';
    }

    showOnboardingSuccess(successMessage);

    setTimeout(async () => {
      const state = await chrome.storage.local.get([
        'userId',
        'userEmail',
        'lastSyncTime',
        'onboardingComplete'
      ]);
      showConnected(state);
      showConnectedStatus('Connected successfully.', false);
    }, 1500);
  } finally {
    onboardingPasswordInput.value = '';
    setConnectButtonLoading(false);
  }
}

step1Next.addEventListener('click', () => {
  clearOnboardingMessages();
  confirmGuideStep('welcome').catch(() => {
    setWizardStep(2);
  });
});

step2Back.addEventListener('click', () => {
  clearOnboardingMessages();
  setWizardStep(1);
});

step2Open.addEventListener('click', async () => {
  clearOnboardingMessages();
  await navigateGuideStep('enable_imap');
});

step3Back.addEventListener('click', () => {
  clearOnboardingMessages();
  setWizardStep(2);
});

step3Open.addEventListener('click', async () => {
  clearOnboardingMessages();
  await navigateGuideStep('generate_app_password');
});

step4Back.addEventListener('click', () => {
  if (reconnectMode) return;
  clearOnboardingMessages();
  setWizardStep(3);
});

onboardingConnectBtn.addEventListener('click', async () => {
  await connectFromOnboarding();
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
