const onboardingView = document.getElementById('onboardingView');
const connectedView = document.getElementById('connectedView');
const connectGoogleBtn = document.getElementById('connectGoogleBtn');
const reconnectBtn = document.getElementById('reconnectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const openGmailBtn = document.getElementById('openGmailBtn');
const connectedOpenGmailBtn = document.getElementById('connectedOpenGmailBtn');
const openSetupBtn = document.getElementById('openSetupBtn');
const onboardingError = document.getElementById('onboardingError');
const onboardingSuccess = document.getElementById('onboardingSuccess');
const connectedEmail = document.getElementById('connectedEmail');
const connectedSource = document.getElementById('connectedSource');
const lastSync = document.getElementById('lastSync');
const connectedStatus = document.getElementById('connectedStatus');

let connectInFlight = false;

function setVisible(element, visible) {
  element.classList.toggle('hidden', !visible);
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

function clearOnboardingMessages() {
  setVisible(onboardingError, false);
  setVisible(onboardingSuccess, false);
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

function showConnectedStatus(message, isError = false) {
  connectedStatus.textContent = message || '';
  connectedStatus.className = `status ${message ? (isError ? 'error' : 'success') : 'muted'}`;
}

function mapConnectError(response) {
  if (response?.code === 'OAUTH_NOT_CONFIGURED') {
    return 'Set the Google OAuth client ID in manifest.json before connecting.';
  }

  if (response?.code === 'AUTH_FAILED') {
    return 'Google sign-in did not complete. Try connecting again.';
  }

  return response?.error || 'Google connection failed.';
}

async function callWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

async function openGmail() {
  await chrome.tabs.create({ url: 'https://mail.google.com/#inbox' });
}

function setConnectLoading(loading) {
  connectInFlight = loading;
  if (connectGoogleBtn) {
    connectGoogleBtn.disabled = loading;
    connectGoogleBtn.innerHTML = loading
      ? '<span class="spinner"></span>Connecting...'
      : 'Connect with Google';
  }
  if (reconnectBtn) {
    reconnectBtn.disabled = loading;
    reconnectBtn.innerHTML = loading
      ? '<span class="spinner"></span>Connecting...'
      : 'Reconnect with Google';
  }
}

async function refreshPopupState() {
  const storage = await callWorker('GET_STORAGE');
  const connected = Boolean(storage?.success && storage.connected);

  setVisible(onboardingView, !connected);
  setVisible(connectedView, connected);

  if (!connected) {
    showConnectedStatus('');
    return;
  }

  connectedEmail.textContent = storage.accountEmail || 'Not connected';
  connectedSource.textContent = storage.mailSource || 'gmail_api_local';
  lastSync.textContent = toRelativeTime(storage.lastSyncTime);
}

async function connectWithGoogle() {
  if (connectInFlight) return;

  clearOnboardingMessages();
  setConnectLoading(true);

  try {
    const response = await callWorker('CONNECT_GOOGLE');
    if (!response?.success) {
      showOnboardingError(mapConnectError(response));
      return;
    }

    await callWorker('GUIDE_CONFIRM_STEP', {
      step: 'connect_account',
      substep: 'connect_submitted',
      reason: 'oauth_connected',
      evidence: {
        oauth: {
          connectedAt: new Date().toISOString(),
          source: 'popup'
        }
      }
    });

    showOnboardingSuccess('Connected. Open Gmail to load your conversations.');
    await refreshPopupState();
  } finally {
    setConnectLoading(false);
  }
}

connectGoogleBtn?.addEventListener('click', async () => {
  await connectWithGoogle();
});

reconnectBtn?.addEventListener('click', async () => {
  await connectWithGoogle();
});

openGmailBtn?.addEventListener('click', async () => {
  await openGmail();
});

connectedOpenGmailBtn?.addEventListener('click', async () => {
  await openGmail();
});

openSetupBtn?.addEventListener('click', async () => {
  await openGmail();
  window.close();
});

disconnectBtn?.addEventListener('click', async () => {
  showConnectedStatus('Disconnecting...');
  const response = await callWorker('DISCONNECT_GOOGLE');
  if (!response?.success) {
    showConnectedStatus(response?.error || 'Disconnect failed.', true);
    return;
  }
  showConnectedStatus('');
  await refreshPopupState();
});

refreshPopupState();

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.connected || changes.accountEmail || changes.lastSyncTime || changes.mailSource) {
    refreshPopupState().catch(() => {});
  }
});
