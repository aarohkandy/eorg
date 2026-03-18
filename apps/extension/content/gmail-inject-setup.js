const setupNormalizeGuideState = globalThis.normalizeGuideState;
const setupState = globalThis.state;
const setupResolvedGuideStepForUi = globalThis.resolvedGuideStepForUi;
const setupStepNumberFromKey = globalThis.stepNumberFromKey;
const setupGuideSubstepCopy = globalThis.GUIDE_SUBSTEP_COPY;
const setupFriendlyContextLabel = globalThis.friendlyContextLabel;
const setupCurrentPageContext = globalThis.currentPageContext;
const setupRenderActivityPanel = globalThis.renderActivityPanel;
const setupSendWorker = globalThis.sendWorker;
const setupGuideStepSet = globalThis.GUIDE_STEP_SET;
const setupAppendUiActivity = globalThis.appendUiActivity;
const setupLoadMessages = globalThis.loadMessages;
const setupStartAutoRefresh = globalThis.startAutoRefresh;

function updateGuideProgressUI() {
  const guide = setupNormalizeGuideState(setupState.guideState);
  const guideStepForUi = setupResolvedGuideStepForUi(guide);
  const stepNumber = setupStepNumberFromKey(guideStepForUi);
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
    welcomeBody.textContent = setupGuideSubstepCopy.welcome.intro.body;
  }

  const connectBody = document.getElementById('gmailUnifiedConnectBody');
  if (connectBody) {
    connectBody.textContent =
      guide.substep === 'connect_submitted'
        ? setupGuideSubstepCopy.connect_account.connect_submitted.body
        : setupGuideSubstepCopy.connect_account.connect_ready.body;
  }

  const contextChip = document.getElementById('gmailUnifiedGuideContext');
  if (contextChip) {
    contextChip.textContent = `Current page: ${setupFriendlyContextLabel(guide.currentContext || setupCurrentPageContext())}`;
  }

  setupRenderActivityPanel();
}

async function refreshGuideAndAuthState() {
  const [storage, guide] = await Promise.all([setupSendWorker('GET_STORAGE'), setupSendWorker('GUIDE_GET_STATE')]);

  setupState.connected = Boolean(storage?.success && storage.userId);
  setupState.guideState = setupNormalizeGuideState(guide?.success ? guide.guideState : setupState.guideState);
  setupState.setupDiagnostics = globalThis.normalizeSetupDiagnostics(storage?.setupDiagnostics);

  return { storage, guide: setupState.guideState };
}

async function guideConfirm(step, payload = {}) {
  if (!setupGuideStepSet.has(step)) return;
  const response = await setupSendWorker('GUIDE_CONFIRM_STEP', { step, ...payload });
  if (response?.success && response.guideState) {
    setupState.guideState = setupNormalizeGuideState(response.guideState);
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
  sidebar.classList.toggle('gmail-unified-locked', !setupState.connected);

  const showGuide = !setupState.connected || setupState.guideReviewOpen;
  shell.hidden = !setupState.connected;
  onboardingOverlay.hidden = !showGuide;
  if (guideClose) guideClose.hidden = !setupState.connected || !setupState.guideReviewOpen;

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
  if (setupState.connectInFlight) return;

  const emailInput = document.getElementById('gmailUnifiedConnectEmail');
  const passInput = document.getElementById('gmailUnifiedConnectPassword');
  const connectBtn = document.getElementById('gmailUnifiedConnectBtn');

  const email = String(emailInput?.value || '').trim();
  const appPassword = String(passInput?.value || '').trim().replace(/\s+/g, '');

  if (!email || !appPassword) {
    await setupAppendUiActivity({
      source: 'UI',
      level: 'warning',
      stage: 'connect_input_missing',
      message: 'Both Gmail address and App Password are required before connecting.'
    });
    setConnectUiState('Enter your Gmail address and app password to continue.', true);
    return;
  }

  setupState.connectInFlight = true;
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
  }
  setConnectUiState('Connecting...');
  await setupAppendUiActivity({
    source: 'UI',
    level: 'info',
    stage: 'connect_button_clicked',
    message: 'Connect button clicked. Starting setup.'
  }, { reset: true });

  try {
    const response = await setupSendWorker('CONNECT', { email, appPassword });
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
    document.getElementById('gmailUnifiedSidebar')?.classList.add('gmail-unified-unlocking');

    setTimeout(async () => {
      await refreshGuideAndAuthState();
      setupState.guideReviewOpen = false;
      applyGmailLayoutMode();
      await setupLoadMessages({ forceSync: false, trackActivity: true });
      setupStartAutoRefresh();
    }, 600);
  } finally {
    if (passInput) {
      passInput.value = '';
    }
    setupState.connectInFlight = false;
    if (connectBtn) {
      connectBtn.disabled = false;
      connectBtn.textContent = 'Connect my account';
    }
  }
}

Object.assign(globalThis, {
  updateGuideProgressUI,
  refreshGuideAndAuthState,
  guideConfirm,
  applyGmailLayoutMode,
  mapConnectError,
  setConnectUiState,
  connectFromGuide
});
