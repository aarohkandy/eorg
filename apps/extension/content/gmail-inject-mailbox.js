const mailboxState = globalThis.state;
const mailboxSetStateCard = globalThis.setStateCard;
const mailboxColdStartMessage = globalThis.COLD_START_MESSAGE;
const mailboxAppendUiActivity = globalThis.appendUiActivity;
const mailboxSendWorker = globalThis.sendWorker;
const mailboxRenderThreads = globalThis.renderThreads;
const mailboxFilteredMessages = globalThis.filteredMessages;

function clearRetryTimer() {
  if (mailboxState.retryTimer) {
    clearInterval(mailboxState.retryTimer);
    mailboxState.retryTimer = null;
  }
  mailboxState.retrySeconds = 0;
}

function startColdStartCountdown(onDone, options = {}) {
  clearRetryTimer();
  mailboxState.retrySeconds = 60;
  mailboxSetStateCard('cold-start', mailboxColdStartMessage, true);
  mailboxAppendUiActivity({
    source: 'UI',
    level: 'warning',
    stage: 'retry_scheduled',
    message: options.message || 'Automatic retry scheduled while the backend wakes up.',
    details: 'Retrying in about 60 seconds.',
    replaceKey: 'ui-retry-scheduled'
  }).catch(() => {});

  mailboxState.retryTimer = setInterval(() => {
    mailboxState.retrySeconds -= 1;
    mailboxSetStateCard('cold-start', mailboxColdStartMessage, true);

    if (mailboxState.retrySeconds <= 0) {
      clearRetryTimer();
      onDone();
    }
  }, 1000);
}

async function loadMessages(options = {}) {
  mailboxSetStateCard('loading', 'Connecting to Gmail...');

  const response = await mailboxSendWorker('FETCH_MESSAGES', {
    folder: options.folder || 'all',
    limit: 50,
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
  });

  if (!response?.success) {
    if (response.code === 'NOT_CONNECTED') {
      mailboxSetStateCard('not-connected', 'Not set up yet. Use the setup guide to connect.');
      return;
    }

    if (response.code === 'AUTH_FAILED') {
      mailboxSetStateCard('auth-failed', 'Connection error. Reconnect your account in setup.');
      return;
    }

    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => loadMessages(options), {
        message: 'Mailbox load is waiting for the backend to wake up.'
      });
      return;
    }

    mailboxSetStateCard('error', response.error || 'Unable to load messages right now.', true);
    return;
  }

  clearRetryTimer();
  mailboxState.messages = Array.isArray(response.messages) ? response.messages : [];
  mailboxRenderThreads();
  if (options.trackActivity) {
    mailboxAppendUiActivity({
      source: 'UI',
      level: 'success',
      stage: 'mailbox_rendered',
      message: `Mailbox view rendered with ${response.count || mailboxState.messages.length || 0} messages.`,
      details: `Inbox ${response.inboxCount || 0}, Sent ${response.sentCount || 0}.`,
      replaceKey: 'ui-mailbox-rendered'
    }).catch(() => {});
  }
}

function setFilter(filter) {
  mailboxState.filter = filter;

  const buttons = document.querySelectorAll('.gmail-unified-filter-btn');
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === filter);
  });

  const visible = mailboxFilteredMessages().length;
  console.log(`[Extension] Filter changed to: ${filter} - showing ${visible} messages`);
  mailboxRenderThreads();
}

globalThis.searchDebounce = null;
async function handleSearch(query) {
  const trimmed = String(query || '').trim();
  mailboxState.searchQuery = trimmed;

  if (!trimmed) {
    await loadMessages();
    return;
  }

  mailboxSetStateCard('loading', 'Searching messages...');
  const response = await mailboxSendWorker('SEARCH_MESSAGES', {
    query: trimmed,
    limit: 20,
    trackActivity: !mailboxState.connected || mailboxState.guideReviewOpen
  });

  if (!response?.success) {
    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => handleSearch(trimmed), {
        message: 'Search is waiting for the backend to wake up.'
      });
      return;
    }

    mailboxSetStateCard('error', response.error || 'Search failed.', true);
    return;
  }

  clearRetryTimer();
  mailboxState.messages = Array.isArray(response.messages) ? response.messages : [];
  mailboxRenderThreads();
}

function startAutoRefresh() {
  if (mailboxState.autoRefreshTimer) return;

  mailboxState.autoRefreshTimer = setInterval(() => {
    if (document.hidden || !mailboxState.connected) return;
    loadMessages();
  }, 5 * 60 * 1000);
}

Object.assign(globalThis, {
  clearRetryTimer,
  startColdStartCountdown,
  loadMessages,
  setFilter,
  handleSearch,
  startAutoRefresh
});
