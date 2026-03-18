function clearRetryTimer() {
  if (state.retryTimer) {
    clearInterval(state.retryTimer);
    state.retryTimer = null;
  }
  state.retrySeconds = 0;
}

function startColdStartCountdown(onDone, options = {}) {
  clearRetryTimer();
  state.retrySeconds = 60;
  setStateCard('cold-start', COLD_START_MESSAGE, true);
  appendUiActivity({
    source: 'UI',
    level: 'warning',
    stage: 'retry_scheduled',
    message: options.message || 'Automatic retry scheduled while the backend wakes up.',
    details: 'Retrying in about 60 seconds.',
    replaceKey: 'ui-retry-scheduled'
  }).catch(() => {});

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
    forceSync: Boolean(options.forceSync),
    trackActivity: Boolean(options.trackActivity)
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
      startColdStartCountdown(() => loadMessages(options), {
        message: 'Mailbox load is waiting for the backend to wake up.'
      });
      return;
    }

    setStateCard('error', response.error || 'Unable to load messages right now.', true);
    return;
  }

  clearRetryTimer();
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  renderThreads();
  if (options.trackActivity) {
    appendUiActivity({
      source: 'UI',
      level: 'success',
      stage: 'mailbox_rendered',
      message: `Mailbox view rendered with ${response.count || state.messages.length || 0} messages.`,
      details: `Inbox ${response.inboxCount || 0}, Sent ${response.sentCount || 0}.`,
      replaceKey: 'ui-mailbox-rendered'
    }).catch(() => {});
  }
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
  const response = await sendWorker('SEARCH_MESSAGES', {
    query: trimmed,
    limit: 20,
    trackActivity: !state.connected || state.guideReviewOpen
  });

  if (!response?.success) {
    if (response.code === 'BACKEND_COLD_START') {
      startColdStartCountdown(() => handleSearch(trimmed), {
        message: 'Search is waiting for the backend to wake up.'
      });
      return;
    }

    setStateCard('error', response.error || 'Search failed.', true);
    return;
  }

  clearRetryTimer();
  state.messages = Array.isArray(response.messages) ? response.messages : [];
  renderThreads();
}

function startAutoRefresh() {
  if (state.autoRefreshTimer) return;

  state.autoRefreshTimer = setInterval(() => {
    if (document.hidden || !state.connected) return;
    loadMessages();
  }, 5 * 60 * 1000);
}
