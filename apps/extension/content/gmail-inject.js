const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';

const state = {
  messages: [],
  filter: 'all',
  selectedThreadId: '',
  searchQuery: '',
  retrySeconds: 0,
  retryTimer: null,
  autoRefreshTimer: null,
  guideOpen: false
};

function isGmailSetupRoute() {
  const hash = String(window.location.hash || '').toLowerCase();
  return hash.startsWith('#settings');
}

function updateMainPanelVisibility() {
  const detail = document.getElementById('gmailUnifiedDetail');
  const empty = document.getElementById('gmailUnifiedMainEmpty');
  if (!detail || !empty) return;

  const showDetail = detail.style.display !== 'none' && Boolean(state.selectedThreadId);
  empty.style.display = showDetail ? 'none' : 'flex';
}

function setGuideOpen(nextOpen) {
  state.guideOpen = Boolean(nextOpen);
  const panel = document.getElementById('gmailUnifiedGuide');
  const trigger = document.getElementById('gmailUnifiedGuideBtn');
  if (!panel || !trigger) return;
  panel.hidden = !state.guideOpen;
  trigger.classList.toggle('is-active', state.guideOpen);
  trigger.setAttribute('aria-expanded', state.guideOpen ? 'true' : 'false');
}

function applyRouteMode() {
  const setupMode = isGmailSetupRoute();
  const sidebar = document.getElementById('gmailUnifiedSidebar');

  document.body.classList.toggle('gmail-unified-fullscreen', !setupMode);
  if (sidebar) {
    sidebar.classList.toggle('gmail-unified-setup-mode', setupMode);
  }

  if (setupMode) {
    setGuideOpen(true);
  }
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

function sendWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
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

  detail.style.display = 'block';
  header.textContent = group.messages[0]?.subject || '(no subject)';

  body.innerHTML = '';

  [...group.messages].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()).forEach((message) => {
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
      setStateCard('not-connected', 'Not set up yet. Click the extension icon to connect.');
      return;
    }

    if (response.code === 'AUTH_FAILED') {
      setStateCard('auth-failed', 'Connection error. Please reconnect in the extension popup.');
      return;
    }

    if (response.code === 'BACKEND_COLD_START') {
      console.log('[Extension] Showing cold-start state in sidebar');
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

function buildSidebar() {
  if (document.getElementById('gmailUnifiedSidebar')) return;

  applyRouteMode();

  const sidebar = document.createElement('aside');
  sidebar.id = 'gmailUnifiedSidebar';
  sidebar.innerHTML = `
    <div class="gmail-unified-shell">
      <section class="gmail-unified-left">
        <div class="gmail-unified-header">
          <h3>Gmail Unified</h3>
          <div class="gmail-unified-header-actions">
            <button id="gmailUnifiedGuideBtn" class="gmail-unified-guide-btn" aria-expanded="false">Guide me</button>
            <button id="gmailUnifiedSync" class="gmail-unified-sync">↻ Sync</button>
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
        <section id="gmailUnifiedGuide" class="gmail-unified-guide" hidden>
          <div class="gmail-unified-guide-head">
            <span>Setup guide</span>
            <button id="gmailUnifiedGuideClose" class="gmail-unified-guide-close" type="button">×</button>
          </div>
          <ol class="gmail-unified-guide-steps">
            <li>Click the extension icon in Chrome and connect your Gmail account.</li>
            <li>Enable IMAP in Gmail settings.</li>
            <li>Create a Google App Password named <strong>Gmail Unified</strong>.</li>
            <li>Come back here and click <strong>Retry now</strong> or <strong>Sync</strong>.</li>
          </ol>
          <div class="gmail-unified-guide-links">
            <button id="gmailUnifiedGuideImap" type="button">Open Gmail IMAP settings</button>
            <button id="gmailUnifiedGuideAppPassword" type="button">Open App Passwords</button>
            <button id="gmailUnifiedGuide2fa" type="button">Open 2FA settings</button>
            <button id="gmailUnifiedGuideInbox" type="button">Back to inbox</button>
          </div>
        </section>
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
      </div>
    </div>
  `;

  document.body.appendChild(sidebar);

  sidebar.querySelector('#gmailUnifiedGuideBtn').addEventListener('click', () => {
    setGuideOpen(!state.guideOpen);
  });
  sidebar.querySelector('#gmailUnifiedGuideClose').addEventListener('click', () => {
    setGuideOpen(false);
  });
  sidebar.querySelector('#gmailUnifiedGuideImap').addEventListener('click', () => {
    window.open('https://mail.google.com/#settings/fwdandpop', '_blank', 'noopener,noreferrer');
  });
  sidebar.querySelector('#gmailUnifiedGuideAppPassword').addEventListener('click', () => {
    window.open('https://myaccount.google.com/apppasswords', '_blank', 'noopener,noreferrer');
  });
  sidebar.querySelector('#gmailUnifiedGuide2fa').addEventListener('click', () => {
    window.open(
      'https://myaccount.google.com/signinoptions/two-step-verification',
      '_blank',
      'noopener,noreferrer'
    );
  });
  sidebar.querySelector('#gmailUnifiedGuideInbox').addEventListener('click', () => {
    window.location.hash = '#inbox';
    applyRouteMode();
  });

  sidebar.querySelector('#gmailUnifiedSync').addEventListener('click', async () => {
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
  searchInput.addEventListener('input', (event) => {
    clearTimeout(searchDebounce);
    const value = event.target.value;
    searchDebounce = setTimeout(() => {
      handleSearch(value);
    }, 400);
  });

  sidebar.querySelector('#gmailUnifiedRetryBtn').addEventListener('click', () => {
    loadMessages({ forceSync: false });
  });

  sidebar.querySelector('#gmailUnifiedBackBtn').addEventListener('click', () => {
    state.selectedThreadId = '';
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
    updateMainPanelVisibility();
  });

  updateMainPanelVisibility();
  setGuideOpen(false);
  applyRouteMode();
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) return;

  state.autoRefreshTimer = setInterval(() => {
    if (document.hidden) return;
    loadMessages();
  }, 5 * 60 * 1000);
}

waitForGmail(() => {
  buildSidebar();
  loadMessages();
  startAutoRefresh();
  window.addEventListener('hashchange', applyRouteMode);
});
