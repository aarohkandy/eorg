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
    document.getElementById('gmailUnifiedSidebar')?.classList.add('gmail-unified-unlocking');

    setTimeout(async () => {
      await refreshGuideAndAuthState();
      state.guideReviewOpen = false;
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
