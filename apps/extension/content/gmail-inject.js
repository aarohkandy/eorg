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

function byDateDesc(a, b) {
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

function groupByThread(messages) {
  const map = new Map();
  messages.forEach((message) => {
    const key = message.threadId || message.id;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(message);
  });

  return [...map.entries()]
    .map(([threadId, entries]) => ({
      threadId,
      messages: [...entries].sort(byDateDesc)
    }))
    .sort((a, b) => byDateDesc(a.messages[0], b.messages[0]));
}

function isUnread(message) {
  const flags = Array.isArray(message.flags) ? message.flags : [];
  return !flags.includes('\\Seen');
}

function filteredMessages() {
  let current = [...state.messages];

  if (state.filter === 'inbox') {
    current = current.filter((message) => !message.isOutgoing);
  }

  if (state.filter === 'sent') {
    current = current.filter((message) => message.isOutgoing);
  }

  return current.sort(byDateDesc);
}

function setStateCard(type, text, retryVisible = false) {
  const card = document.getElementById('gmailUnifiedStateCard');
  const textNode = document.getElementById('gmailUnifiedStateText');
  const retryBtn = document.getElementById('gmailUnifiedRetryBtn');
  const countdown = document.getElementById('gmailUnifiedCountdown');
  const list = document.getElementById('gmailUnifiedList');
  const detail = document.getElementById('gmailUnifiedDetail');

  if (!card || !textNode || !retryBtn || !countdown || !list || !detail) return;

  card.dataset.state = type;
  textNode.textContent = text;
  retryBtn.style.display = retryVisible ? 'inline-flex' : 'none';
  countdown.style.display = state.retrySeconds > 0 ? 'block' : 'none';
  countdown.textContent = state.retrySeconds > 0 ? `Retrying automatically in ${state.retrySeconds}s` : '';

  if (type === 'normal') {
    card.style.display = 'none';
    list.style.display = 'block';
    detail.style.display = state.selectedThreadId ? 'block' : 'none';
  } else {
    card.style.display = 'block';
    list.style.display = 'none';
    detail.style.display = 'none';
  }

  updateMainPanelVisibility();
}

function renderThreads() {
  const list = document.getElementById('gmailUnifiedList');
  if (!list) return;

  const threadGroups = groupByThread(filteredMessages());

  if (!threadGroups.length) {
    setStateCard('empty', 'No messages found.');
    return;
  }

  setStateCard('normal', '');

  list.innerHTML = '';

  threadGroups.forEach((group) => {
    const latest = group.messages[0];
    const unread = group.messages.some(isUnread);

    const row = document.createElement('button');
    row.className = 'gmail-unified-thread-row';
    row.type = 'button';
    row.dataset.threadId = group.threadId;

    const who = latest.isOutgoing
      ? `To: ${latest.to?.[0]?.name || latest.to?.[0]?.email || 'Unknown recipient'}`
      : latest.from?.name || latest.from?.email || 'Unknown sender';

    row.innerHTML = `
      <div class="gmail-unified-thread-top">
        <span class="gmail-unified-tag ${latest.isOutgoing ? 'sent' : 'inbox'}">${
      latest.isOutgoing ? 'Sent' : 'Inbox'
    }</span>
        <span class="gmail-unified-date">${formatDate(latest.date)}</span>
      </div>
      <div class="gmail-unified-thread-who">${escapeHtml(who)}</div>
      <div class="gmail-unified-thread-subject ${unread ? 'unread' : ''}">${escapeHtml(
      latest.subject || '(no subject)'
    )}</div>
      <div class="gmail-unified-thread-snippet">${escapeHtml(latest.snippet || '(no preview)')}</div>
      <div class="gmail-unified-thread-meta">
        <span>${group.messages.length} message${group.messages.length > 1 ? 's' : ''}</span>
        ${unread ? '<span class="gmail-unified-unread-dot" title="Unread"></span>' : ''}
      </div>
    `;

    row.addEventListener('click', () => {
      state.selectedThreadId = group.threadId;
      renderThreadDetail(group);
    });

    list.appendChild(row);
  });

  console.log(`[Extension] Rendering message list - ${threadGroups.length} items`);
}

function renderThreadDetail(group) {
  const detail = document.getElementById('gmailUnifiedDetail');
  const header = document.getElementById('gmailUnifiedDetailHeader');
  const body = document.getElementById('gmailUnifiedDetailBody');
  if (!detail || !header || !body) return;

  detail.style.display = 'block';
  header.textContent = group.messages[0]?.subject || '(no subject)';

  body.innerHTML = '';

  [...group.messages]
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .forEach((message) => {
      const item = document.createElement('div');
      item.className = `gmail-unified-message ${message.isOutgoing ? 'outgoing' : 'incoming'}`;

      const who = message.isOutgoing
        ? `You -> ${message.to?.[0]?.name || message.to?.[0]?.email || 'recipient'}`
        : `${message.from?.name || message.from?.email || 'sender'} -> You`;

      item.innerHTML = `
      <div class="gmail-unified-message-meta">
        <span>${escapeHtml(who)}</span>
        <span>${formatDate(message.date)}</span>
      </div>
      <div class="gmail-unified-message-snippet">${escapeHtml(message.snippet || '(no preview)')}</div>
    `;

      body.appendChild(item);
    });

  updateMainPanelVisibility();
}

function clearRetryTimer() {
  if (state.retryTimer) {
    clearInterval(state.retryTimer);
    state.retryTimer = null;
  }
  state.retrySeconds = 0;
}

function startColdStartCountdown(onDone) {
  clearRetryTimer();
  state.retrySeconds = 60;
  setStateCard('cold-start', COLD_START_MESSAGE, true);

  state.retryTimer = setInterval(() => {
    state.retrySeconds -= 1;
    setStateCard('cold-start', COLD_START_MESSAGE, true);

    if (state.retrySeconds <= 0) {
      clearRetryTimer();
      onDone();
    }
  }, 1000);
}

async function loadMessages(options = {}) {
  setStateCard('loading', 'Connecting to Gmail...');

  const response = await sendWorker('FETCH_MESSAGES', {
    folder: options.folder || 'all',
    limit: 50,
    forceSync: Boolean(options.forceSync)
  });

  if (!response?.success) {
    if (response.code === 'NOT_CONNECTED') {
      setStateCard('not-connected', 'Not set up yet. Use the setup guide to connect.');
      return;
    }

    if (response.code === 'AUTH_FAILED') {
      setStateCard('auth-failed', 'Connection error. Reconnect your account in setup.');
      return;
    }

    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => loadMessages(options));
      return;
    }

    setStateCard('error', response.error || 'Unable to load messages right now.', true);
    return;
  }

  clearRetryTimer();
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  renderThreads();
}

function setFilter(filter) {
  state.filter = filter;

  const buttons = document.querySelectorAll('.gmail-unified-filter-btn');
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });

  const visible = filteredMessages().length;
  console.log(`[Extension] Filter changed to: ${filter} - showing ${visible} messages`);
  renderThreads();
}

let searchDebounce = null;
async function handleSearch(query) {
  const trimmed = String(query || '').trim();
  state.searchQuery = trimmed;

  if (!trimmed) {
    await loadMessages();
    return;
  }

  setStateCard('loading', 'Searching messages...');
  const response = await sendWorker('SEARCH_MESSAGES', { query: trimmed, limit: 20 });

  if (!response?.success) {
    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => handleSearch(trimmed));
      return;
    }

    setStateCard('error', response.error || 'Search failed.', true);
    return;
  }

  clearRetryTimer();
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  renderThreads();
}

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
}

async function refreshGuideAndAuthState() {
  const [storage, guide] = await Promise.all([sendWorker('GET_STORAGE'), sendWorker('GUIDE_GET_STATE')]);

  state.connected = Boolean(storage?.success && storage.userId);
  state.guideState = normalizeGuideState(guide?.success ? guide.guideState : state.guideState);

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
  const appPassword = String(passInput?.value || '').trim();

  if (!email || !appPassword) {
    setConnectUiState('Enter your Gmail address and app password to continue.', true);
    return;
  }

  state.connectInFlight = true;
  if (connectBtn) {
    connectBtn.disabled = true;
    connectBtn.textContent = 'Connecting...';
  }
  setConnectUiState('Connecting...');

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
      await loadMessages({ forceSync: false });
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

function bindGuideEvents(sidebar) {
  sidebar.querySelector('#gmailUnifiedGuideBtn')?.addEventListener('click', () => {
    if (!state.connected) return;
    state.guideReviewOpen = true;
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedGuideCloseBtn')?.addEventListener('click', () => {
    state.guideReviewOpen = false;
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedWelcomeStartBtn')?.addEventListener('click', async () => {
    openExternalPage(APP_PASSWORDS_URL);
    await guideConfirm('welcome');
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedWelcomeTwoFactorBtn')?.addEventListener('click', () => {
    openExternalPage(TWO_STEP_VERIFICATION_URL);
  });

  sidebar.querySelector('#gmailUnifiedConnectBtn')?.addEventListener('click', async () => {
    await connectFromGuide();
  });

  sidebar.querySelector('#gmailUnifiedConnectOpenAppBtn')?.addEventListener('click', () => {
    openExternalPage(APP_PASSWORDS_URL);
  });

  sidebar.querySelector('#gmailUnifiedConnectOpenTwoFactorBtn')?.addEventListener('click', () => {
    openExternalPage(TWO_STEP_VERIFICATION_URL);
  });

  sidebar.querySelector('#gmailUnifiedConnectPassword')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await connectFromGuide();
    }
  });

  sidebar.querySelector('#gmailUnifiedSync')?.addEventListener('click', async () => {
    if (!state.connected) return;

    const result = await sendWorker('SYNC_MESSAGES');
    if (!result?.success) {
      if (result.code === 'BACKEND_COLD_START') {
        startColdStartCountdown(() => loadMessages({ forceSync: true }));
        return;
      }

      setStateCard('error', result.error || 'Sync failed.', true);
      return;
    }

    await loadMessages({ forceSync: true });
  });

  sidebar.querySelectorAll('.gmail-unified-filter-btn').forEach((button) => {
    button.addEventListener('click', () => setFilter(button.dataset.filter));
  });

  const searchInput = sidebar.querySelector('#gmailUnifiedSearchInput');
  searchInput?.addEventListener('input', (event) => {
    clearTimeout(searchDebounce);
    const value = event.target.value;
    searchDebounce = setTimeout(() => {
      handleSearch(value);
    }, 400);
  });

  sidebar.querySelector('#gmailUnifiedRetryBtn')?.addEventListener('click', () => {
    loadMessages({ forceSync: false });
  });

  sidebar.querySelector('#gmailUnifiedBackBtn')?.addEventListener('click', () => {
    state.selectedThreadId = '';
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
    updateMainPanelVisibility();
  });
}

function buildSidebar() {
  if (document.getElementById('gmailUnifiedSidebar')) return;

  const sidebar = document.createElement('aside');
  sidebar.id = 'gmailUnifiedSidebar';
  sidebar.innerHTML = `
    <div id="gmailUnifiedShell" class="gmail-unified-shell">
      <section class="gmail-unified-left">
        <div class="gmail-unified-header">
          <h3>Gmail Unified</h3>
          <div class="gmail-unified-header-actions">
            <button id="gmailUnifiedGuideBtn" class="gmail-unified-guide-btn" type="button">Guide me</button>
            <button id="gmailUnifiedSync" class="gmail-unified-sync" type="button">↻ Sync</button>
          </div>
        </div>
        <div class="gmail-unified-search">
          <input id="gmailUnifiedSearchInput" type="text" placeholder="Search messages..." />
        </div>
        <div class="gmail-unified-filters">
          <button class="gmail-unified-filter-btn active" data-filter="all">All</button>
          <button class="gmail-unified-filter-btn" data-filter="inbox">Inbox</button>
          <button class="gmail-unified-filter-btn" data-filter="sent">Sent</button>
        </div>
        <div id="gmailUnifiedStateCard" class="gmail-unified-state-card" data-state="loading">
          <div id="gmailUnifiedStateText">Connecting to Gmail...</div>
          <button id="gmailUnifiedRetryBtn" class="gmail-unified-retry" type="button">Retry now</button>
          <div id="gmailUnifiedCountdown" class="gmail-unified-countdown"></div>
        </div>
        <div id="gmailUnifiedList" class="gmail-unified-list"></div>
      </section>
      <section class="gmail-unified-main">
        <div id="gmailUnifiedMainEmpty" class="gmail-unified-main-empty">Select a conversation</div>
        <section id="gmailUnifiedDetail" class="gmail-unified-detail" style="display:none;">
          <div class="gmail-unified-detail-head">
            <button id="gmailUnifiedBackBtn" class="gmail-unified-back">← Back</button>
            <div id="gmailUnifiedDetailHeader"></div>
          </div>
          <div id="gmailUnifiedDetailBody" class="gmail-unified-detail-body"></div>
        </section>
      </section>
    </div>

    <section id="gmailUnifiedOnboardingOverlay" class="gmail-unified-onboarding-overlay" hidden>
      <div class="gmail-unified-modal">
        <header class="gmail-unified-modal-header">
          <div>
            <div class="gmail-unified-modal-kicker">Guided setup</div>
            <h2>Connect Gmail Unified</h2>
          </div>
          <div class="gmail-unified-modal-right">
            <span id="gmailUnifiedGuideCounterBadge" class="gmail-unified-counter-badge">0/2</span>
            <button id="gmailUnifiedGuideCloseBtn" class="gmail-unified-guide-close-modal" hidden>Close</button>
          </div>
        </header>
        <div class="gmail-unified-progress-wrap">
          <div id="gmailUnifiedGuideProgressText" class="gmail-unified-progress-text">Step 1/2 · 0/2 completed</div>
          <div class="gmail-unified-progress-track"><div id="gmailUnifiedGuideProgressBar" class="gmail-unified-progress-fill"></div></div>
          <div id="gmailUnifiedGuideContext" class="gmail-unified-guide-context">Current page: Gmail inbox</div>
        </div>

        <article class="gmail-unified-guide-slide active" data-step="welcome">
          <h3>Step 1: Before you connect</h3>
          <p id="gmailUnifiedWelcomeBody">Use this step to turn on 2-Step Verification if needed, then create your Gmail App Password.</p>
          <ol>
            <li>Open Google App Passwords.</li>
            <li>If Google says App Passwords is unavailable, turn on <strong>2-Step Verification</strong> first.</li>
            <li>Create a new password for <strong>Gmail Unified</strong> and copy the 16-character code.</li>
            <li>Come back here and connect with your Gmail address and that code.</li>
          </ol>
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedWelcomeStartBtn" class="gmail-unified-primary-btn">Open App Passwords</button>
          </div>
          <div class="gmail-unified-guide-helper">
            <span>Need to turn on 2-Step Verification first?</span>
            <button id="gmailUnifiedWelcomeTwoFactorBtn" class="gmail-unified-link-btn" type="button">
              Open 2-Step Verification
            </button>
          </div>
        </article>

        <article class="gmail-unified-guide-slide" data-step="connect_account">
          <h3>Step 2: Connect account</h3>
          <p id="gmailUnifiedConnectBody">Paste the Gmail address you want to sync and the 16-character App Password from Google.</p>
          <label for="gmailUnifiedConnectEmail" class="gmail-unified-field-label">Gmail address</label>
          <input id="gmailUnifiedConnectEmail" class="gmail-unified-field" type="email" placeholder="you@gmail.com" />
          <label for="gmailUnifiedConnectPassword" class="gmail-unified-field-label">App password</label>
          <input id="gmailUnifiedConnectPassword" class="gmail-unified-field" type="password" placeholder="xxxx xxxx xxxx xxxx" />
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedConnectBtn" class="gmail-unified-primary-btn">Connect my account</button>
          </div>
          <div class="gmail-unified-guide-helper">
            <span>No App Password yet?</span>
            <button id="gmailUnifiedConnectOpenAppBtn" class="gmail-unified-link-btn" type="button">
              Open App Passwords
            </button>
            <button id="gmailUnifiedConnectOpenTwoFactorBtn" class="gmail-unified-link-btn" type="button">
              Open 2-Step Verification
            </button>
          </div>
          <div id="gmailUnifiedConnectStatus" class="gmail-unified-connect-status"></div>
        </article>
      </div>
    </section>
  `;

  document.body.appendChild(sidebar);
  bindGuideEvents(sidebar);

  updateMainPanelVisibility();
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) return;

  state.autoRefreshTimer = setInterval(() => {
    if (document.hidden || !state.connected) return;
    loadMessages();
  }, 5 * 60 * 1000);
}

async function bootGmailSurface() {
  buildSidebar();
  await refreshGuideAndAuthState();
  applyGmailLayoutMode();

  if (state.connected) {
    await loadMessages();
    startAutoRefresh();
  }

  window.addEventListener('hashchange', async () => {
    await refreshGuideAndAuthState();
    applyGmailLayoutMode();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
      refreshGuideAndAuthState()
        .then(async () => {
          applyGmailLayoutMode();
          if (state.connected && state.messages.length === 0) {
            await loadMessages();
          }
        })
        .catch(() => {});
    }
  });
}

if (isMailHost()) {
  waitForGmail(() => {
    bootGmailSurface().catch(() => {});
  });
}
