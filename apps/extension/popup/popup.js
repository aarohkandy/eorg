const setupView = document.getElementById('setupView');
const connectedView = document.getElementById('connectedView');

const emailInput = document.getElementById('emailInput');
const passwordInput = document.getElementById('passwordInput');
const connectBtn = document.getElementById('connectBtn');
const retryConnectBtn = document.getElementById('retryConnectBtn');
const setupStatus = document.getElementById('setupStatus');
const setupColdStart = document.getElementById('setupColdStart');

const connectedEmail = document.getElementById('connectedEmail');
const lastSync = document.getElementById('lastSync');
const syncBtn = document.getElementById('syncBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const retrySyncBtn = document.getElementById('retrySyncBtn');
const connectedStatus = document.getElementById('connectedStatus');
const connectedColdStart = document.getElementById('connectedColdStart');

let pendingConnectPayload = null;

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

function showSetupStatus(message, isError = false) {
  setupStatus.textContent = message || '';
  setupStatus.className = `status ${isError ? 'error' : 'success'}`;
}

function showConnectedStatus(message, isError = false) {
  connectedStatus.textContent = message || '';
  connectedStatus.className = `status ${isError ? 'error' : 'success'}`;
}

async function callWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

async function refreshView() {
  const state = await callWorker('GET_STORAGE');
  const connected = Boolean(state?.userId);

  setVisible(setupView, !connected);
  setVisible(connectedView, connected);

  if (connected) {
    connectedEmail.textContent = `Connected: ${state.userEmail}`;
    lastSync.textContent = `Last synced: ${toRelativeTime(state.lastSyncTime)}`;
  }
}

function showColdStart(target, show) {
  setVisible(target, show);
}

async function connect(payload) {
  showSetupStatus('Connecting...', false);
  showColdStart(setupColdStart, false);

  const response = await callWorker('CONNECT', payload);
  if (!response?.success) {
    if (response.code === 'BACKEND_COLD_START') {
      showSetupStatus('', false);
      showColdStart(setupColdStart, true);
      setVisible(retryConnectBtn, true);
      pendingConnectPayload = payload;
      return;
    }

    showSetupStatus(response?.error || 'Connection failed.', true);
    return;
  }

  showSetupStatus('Connected successfully.', false);
  pendingConnectPayload = null;
  setVisible(retryConnectBtn, false);
  await refreshView();
}

connectBtn.addEventListener('click', async () => {
  const email = String(emailInput.value || '').trim();
  const appPassword = String(passwordInput.value || '').trim();
  passwordInput.value = '';

  if (!email || !appPassword) {
    showSetupStatus('Please provide both Gmail address and App Password.', true);
    return;
  }

  await connect({ email, appPassword });
});

retryConnectBtn.addEventListener('click', async () => {
  if (pendingConnectPayload) {
    await connect(pendingConnectPayload);
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
  await refreshView();
});

retrySyncBtn.addEventListener('click', async () => {
  syncBtn.click();
});

disconnectBtn.addEventListener('click', async () => {
  showConnectedStatus('Disconnecting...', false);
  const response = await callWorker('DISCONNECT');
  if (!response?.success) {
    showConnectedStatus(response?.error || 'Disconnect failed.', true);
    return;
  }

  showConnectedStatus('Disconnected.', false);
  await refreshView();
});

refreshView();
