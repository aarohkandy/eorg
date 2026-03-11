const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';

const GUIDE_STEPS = ['welcome', 'enable_imap', 'generate_app_password', 'connect_account'];
const GUIDE_STEP_SET = new Set(GUIDE_STEPS);
const IMAP_EXPECTED_ACTION = {
  NONE: '',
  ENABLE: 'imap_enable',
  SAVE: 'imap_save'
};
const IMAP_MISSING_CONTROL_TICKS_TO_AUTOCOMPLETE = 3;
const GUIDE_SUBSTEP_COPY = {
  welcome: {
    intro: {
      title: 'Welcome to Gmail Unified',
      body: 'Do this now -> click Start setup. We will move you forward automatically.'
    }
  },
  enable_imap: {
    imap_tab_open: {
      title: 'Step 2: Enable IMAP',
      body: 'Do this now -> click Enable IMAP.'
    },
    imap_enabled_selected: {
      title: 'Step 2: Save IMAP setting',
      body: 'Great. Do this now -> click Save Changes.'
    },
    imap_saved: {
      title: 'IMAP ready',
      body: 'IMAP is already enabled for this account; moving to the next step automatically.'
    }
  },
  generate_app_password: {
    app_password_page_open: {
      title: 'Step 3: Generate App Password',
      body: 'Do this now -> create a password named Gmail Unified and copy the 16-character code.'
    },
    app_password_generated: {
      title: 'Code detected',
      body: 'Great. We detected your code. Returning you to connect.'
    }
  },
  connect_account: {
    connect_ready: {
      title: 'Step 4: Connect account',
      body: 'Paste your Gmail address and app password. Then click Connect.'
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
  connectInFlight: false,
  spotlightTarget: null,
  spotlightLabel: '',
  spotlightRaf: 0,
  autoGuideTimer: null,
  autoGuideTickPending: false,
  imapExpectedAction: IMAP_EXPECTED_ACTION.NONE,
  imapExpectedTarget: null,
  imapMissingControlTicks: 0,
  imapAlwaysOnDetectedAt: 0,
  lastAutoSignalKey: '',
  lastRenderedGuideStep: ''
};

function normalize(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isMailHost() {
  return window.location.hostname.includes('mail.google.com');
}

function isMyAccountHost() {
  return window.location.hostname.includes('myaccount.google.com');
}

function isGmailSetupRoute() {
  const hash = String(window.location.hash || '').toLowerCase();
  return hash.startsWith('#settings/fwdandpop');
}

function sendWorker(action, payload = {}) {
  return chrome.runtime.sendMessage({ action, payload });
}

function defaultGuideState() {
  return {
    step: 'welcome',
    substep: 'intro',
    status: {
      welcome: 'in_progress',
      enable_imap: 'pending',
      generate_app_password: 'pending',
      connect_account: 'pending'
    },
    evidence: {
      imap: {
        tabOpenAt: null,
        enabledSelectedAt: null,
        saveClickedAt: null,
        savedAt: null,
        alreadyEnabled: false
      },
      appPassword: {
        pageOpenAt: null,
        generatedAt: null,
        source: null
      }
    },
    progress: 0,
    total: 4,
    currentContext: 'unknown',
    connected: false,
    updatedAt: new Date().toISOString()
  };
}

function normalizeGuideState(input) {
  const fallback = defaultGuideState();
  const src = input && typeof input === 'object' ? input : {};
  const status = { ...fallback.status };
  const evidence = JSON.parse(JSON.stringify(fallback.evidence));

  if (src.status && typeof src.status === 'object') {
    for (const key of GUIDE_STEPS) {
      const value = src.status[key];
      if (value === 'pending' || value === 'in_progress' || value === 'done') {
        status[key] = value;
      }
    }
  }

  if (src.evidence && typeof src.evidence === 'object') {
    if (src.evidence.imap && typeof src.evidence.imap === 'object') {
      const imap = src.evidence.imap;
      if (typeof imap.tabOpenAt === 'string') evidence.imap.tabOpenAt = imap.tabOpenAt;
      if (typeof imap.enabledSelectedAt === 'string') evidence.imap.enabledSelectedAt = imap.enabledSelectedAt;
      if (typeof imap.saveClickedAt === 'string') evidence.imap.saveClickedAt = imap.saveClickedAt;
      if (typeof imap.savedAt === 'string') evidence.imap.savedAt = imap.savedAt;
      if (typeof imap.alreadyEnabled === 'boolean') evidence.imap.alreadyEnabled = imap.alreadyEnabled;
    }
    if (src.evidence.appPassword && typeof src.evidence.appPassword === 'object') {
      const appPassword = src.evidence.appPassword;
      if (typeof appPassword.pageOpenAt === 'string') evidence.appPassword.pageOpenAt = appPassword.pageOpenAt;
      if (typeof appPassword.generatedAt === 'string') evidence.appPassword.generatedAt = appPassword.generatedAt;
      if (typeof appPassword.source === 'string') evidence.appPassword.source = appPassword.source;
    }
  }

  const step = GUIDE_STEP_SET.has(src.step) ? src.step : fallback.step;
  let substep = typeof src.substep === 'string' ? src.substep : fallback.substep;
  if (!GUIDE_SUBSTEP_COPY[step] || !GUIDE_SUBSTEP_COPY[step][substep]) {
    if (step === 'enable_imap') {
      if (status.enable_imap === 'done' || evidence.imap.savedAt) substep = 'imap_saved';
      else if (evidence.imap.enabledSelectedAt) substep = 'imap_enabled_selected';
      else substep = 'imap_tab_open';
    } else if (step === 'generate_app_password') {
      substep = status.generate_app_password === 'done' || evidence.appPassword.generatedAt
        ? 'app_password_generated'
        : 'app_password_page_open';
    } else if (step === 'connect_account') {
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

function activeGuideCopy() {
  const guide = normalizeGuideState(state.guideState);
  const stepCopy = GUIDE_SUBSTEP_COPY[guide.step] || GUIDE_SUBSTEP_COPY.welcome;
  return stepCopy[guide.substep] || stepCopy[Object.keys(stepCopy)[0]];
}

function stepTargetContext(step) {
  if (step === 'enable_imap') return 'gmail_imap_settings';
  if (step === 'generate_app_password') return 'google_app_passwords';
  if (step === 'connect_account') return 'gmail_inbox';
  return 'unknown';
}

function stepTargetLabel(step) {
  if (step === 'enable_imap') return 'Take me to Gmail IMAP settings';
  if (step === 'generate_app_password') return 'Take me to App Passwords';
  if (step === 'connect_account') return 'Take me to Gmail inbox';
  return 'Take me there';
}

function currentPageContext() {
  if (isMyAccountHost()) {
    if (window.location.href.toLowerCase().includes('/apppasswords')) return 'google_app_passwords';
    if (window.location.href.toLowerCase().includes('/signinoptions/two-step-verification')) return 'google_2fa';
    return 'other';
  }
  if (isMailHost()) {
    if (isGmailSetupRoute()) return 'gmail_imap_settings';
    return 'gmail_inbox';
  }
  return 'other';
}

function friendlyContextLabel(context) {
  if (context === 'gmail_imap_settings') return 'Gmail settings';
  if (context === 'google_app_passwords') return 'Google App Passwords';
  if (context === 'gmail_inbox') return 'Gmail inbox';
  if (context === 'google_2fa') return 'Google 2FA';
  return 'another page';
}

function isAppPasswordLike(value) {
  const clean = String(value || '').replace(/\\s+/g, '');
  return /^[a-z0-9]{16}$/i.test(clean);
}

function hasGeneratedCodeSignalInDom() {
  const bodyText = String(document.body?.innerText || '');
  if (!bodyText) return false;
  const hasAppPasswordLabel = /app\\s*password/i.test(bodyText);
  if (!hasAppPasswordLabel) return false;
  return /\\b[a-z0-9]{4}(?:\\s[a-z0-9]{4}){3}\\b/i.test(bodyText);
}

function queueSpotlightRefresh() {
  if (state.spotlightRaf) return;
  state.spotlightRaf = requestAnimationFrame(() => {
    state.spotlightRaf = 0;
    refreshSpotlightPosition();
  });
}

async function runGuideAutoProgressTick() {
  if (state.connected) {
    hideSpotlight();
    return;
  }

  if (isMailHost() && isGmailSetupRoute()) {
    await runImapAutoProgress();
    return;
  }

  if (isMyAccountHost()) {
    await runAppPasswordAutoProgress();
    return;
  }

  hideSpotlight();
}

function queueGuideAutoProgressTick() {
  if (state.autoGuideTickPending) return;
  state.autoGuideTickPending = true;
  requestAnimationFrame(() => {
    state.autoGuideTickPending = false;
    runGuideAutoProgressTick().catch(() => {});
  });
}

function startGuideAutoProgressLoop() {
  if (state.autoGuideTimer) return;
  state.autoGuideTimer = window.setInterval(() => {
    queueGuideAutoProgressTick();
  }, 850);
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

function isVisibleTarget(node) {
  if (!(node instanceof Element)) return false;
  const rect = node.getBoundingClientRect();
  if (rect.width <= 2 || rect.height <= 2) return false;
  const style = window.getComputedStyle(node);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function nodeTextForMatch(node) {
  if (!(node instanceof Element)) return '';
  const textBits = [
    node.getAttribute('aria-label') || '',
    node.getAttribute('title') || '',
    node.textContent || ''
  ];
  if (node instanceof HTMLInputElement || node instanceof HTMLButtonElement) {
    textBits.unshift(node.value || '');
  }
  return normalize(textBits.join(' ')).toLowerCase();
}

function findVisibleTarget(selectors, root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  for (const selector of selectors) {
    const nodes = scope.querySelectorAll(selector);
    for (const node of nodes) {
      if (isVisibleTarget(node)) return node;
    }
  }
  return null;
}

function findVisibleTargetByText(selectors, pattern, root = document) {
  const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
  for (const selector of selectors) {
    const nodes = scope.querySelectorAll(selector);
    for (const node of nodes) {
      if (!isVisibleTarget(node)) continue;
      const text = nodeTextForMatch(node);
      if (!text) continue;
      if (pattern.test(text)) return node;
    }
  }
  return null;
}

function getImapSettingsRoot() {
  return (
    document.querySelector('form[action*="fwdandpop" i]')
    || document.querySelector('[role="main"]')
    || document
  );
}

function ensureSpotlightElement() {
  let el = document.getElementById('gmailUnifiedSpotlight');
  if (!el) {
    el = document.createElement('div');
    el.id = 'gmailUnifiedSpotlight';
    el.className = 'gmail-unified-spotlight';
    document.body.appendChild(el);
  }
  return el;
}

function hideSpotlight() {
  const spotlight = document.getElementById('gmailUnifiedSpotlight');
  if (spotlight) {
    spotlight.style.display = 'none';
    spotlight.removeAttribute('data-label');
  }
  state.spotlightTarget = null;
  state.spotlightLabel = '';
}

function positionSpotlight(target, label = 'Click here') {
  if (!target) {
    hideSpotlight();
    return;
  }

  const rect = target.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    hideSpotlight();
    return;
  }

  const spotlight = ensureSpotlightElement();
  const pad = 16;
  const diameter = Math.max(rect.width, rect.height) + pad * 2;
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const left = Math.min(
    Math.max(0, window.innerWidth - diameter),
    Math.max(0, centerX - diameter / 2)
  );
  const top = Math.min(
    Math.max(0, window.innerHeight - diameter),
    Math.max(0, centerY - diameter / 2)
  );

  spotlight.style.display = 'block';
  spotlight.style.left = `${left}px`;
  spotlight.style.top = `${top}px`;
  spotlight.style.width = `${diameter}px`;
  spotlight.style.height = `${diameter}px`;
  const spotlightLabel = normalize(label) || 'Click here';
  spotlight.setAttribute('data-label', spotlightLabel);
  state.spotlightTarget = target;
  state.spotlightLabel = spotlightLabel;
}

function refreshSpotlightPosition() {
  if (state.spotlightTarget) {
    positionSpotlight(state.spotlightTarget, state.spotlightLabel || 'Click here');
  }
}

async function signalGuideStep(step, substep, reason, evidence = null) {
  const signalKey = `${step}|${substep}|${reason}`;
  if (state.lastAutoSignalKey === signalKey) {
    return;
  }
  state.lastAutoSignalKey = signalKey;

  const response = await sendWorker('GUIDE_CONFIRM_STEP', { step, substep, reason, evidence });
  if (response?.success && response.guideState) {
    state.guideState = normalizeGuideState(response.guideState);
  }
}

function findImapEnableControl() {
  const root = getImapSettingsRoot();
  const directMatch = findVisibleTarget([
    'input[name="bx_em"][value="1"]',
    'input[value="1"][name="bx_em"]',
    'label[for*="bx_em" i]',
    '[role="radio"][aria-label*="Enable IMAP" i]',
    '[aria-label*="Enable IMAP" i]'
  ], root);
  if (directMatch) return directMatch;
  return findVisibleTargetByText(
    ['label', 'button', '[role="radio"]', 'td', 'span'],
    /\benable\s+imap\b/i,
    root
  );
}

function isImapEnableSelected() {
  const radio = document.querySelector('input[name="bx_em"][value="1"]');
  if (radio && typeof radio.checked === 'boolean') {
    return radio.checked;
  }
  const ariaChecked = document.querySelector('[aria-label*="Enable IMAP" i][aria-checked="true"]');
  if (ariaChecked) return true;
  const text = normalize(document.body?.innerText || '').toLowerCase();
  if (/\bstatus:\s*imap\s+is\s+enabled\b/i.test(text)) return true;
  return false;
}

function findImapSaveControl() {
  const root = getImapSettingsRoot();
  const directMatch = findVisibleTarget([
    'button[name="save"]',
    'input[type="submit"][name="save"]',
    'button[guidedhelpid*="save" i]',
    'button[id*="save" i]'
  ], root);
  if (directMatch) return directMatch;
  return findVisibleTargetByText(
    ['button', 'input[type="submit"]'],
    /\bsave\s+changes\b/i,
    root
  );
}

function hasPendingImapSave(saveControl) {
  if (!saveControl) return false;
  const ariaDisabled = String(saveControl.getAttribute('aria-disabled') || '').toLowerCase() === 'true';
  const disabledProp = Boolean(saveControl.disabled);
  return !ariaDisabled && !disabledProp;
}

function clearImapExpectedTarget() {
  state.imapExpectedAction = IMAP_EXPECTED_ACTION.NONE;
  state.imapExpectedTarget = null;
}

function setImapExpectedTarget(action, target, label) {
  if (!(target instanceof Element) || !isVisibleTarget(target)) {
    clearImapExpectedTarget();
    hideSpotlight();
    return;
  }

  state.imapExpectedAction = action;
  state.imapExpectedTarget = target;
  state.imapMissingControlTicks = 0;
  state.imapAlwaysOnDetectedAt = 0;
  positionSpotlight(target, label);
}

function getImapEquivalentTargets(target) {
  if (!(target instanceof Element)) return [];

  const candidates = new Set([target]);
  const add = (node) => {
    if (node instanceof Element) candidates.add(node);
  };

  add(target.closest('label'));

  if (target instanceof HTMLLabelElement) {
    const forId = target.getAttribute('for');
    if (forId) {
      add(document.getElementById(forId));
    }
  }

  if ('labels' in target && target.labels) {
    for (const label of target.labels) add(label);
  }

  if (target.id) {
    const linkedLabels = document.querySelectorAll('label[for]');
    for (const label of linkedLabels) {
      if (label.getAttribute('for') === target.id) add(label);
    }
  }

  for (const candidate of [...candidates]) {
    add(candidate.closest('label'));
    add(candidate.querySelector('input, button, [role="radio"], [role="button"]'));
  }

  return [...candidates];
}

function matchesImapExpectedTarget(clickTarget, expectedTarget) {
  if (!(clickTarget instanceof Element) || !(expectedTarget instanceof Element)) return false;
  if (!expectedTarget.isConnected) return false;

  const candidates = getImapEquivalentTargets(expectedTarget);
  for (const candidate of candidates) {
    if (!(candidate instanceof Element) || !candidate.isConnected) continue;
    if (candidate === clickTarget) return true;
    if (candidate.contains(clickTarget)) return true;
    if (clickTarget.contains(candidate)) return true;
  }
  return false;
}

async function runImapAutoProgress() {
  let guide = normalizeGuideState(state.guideState);
  if (guide.step === 'welcome' && isGmailSetupRoute()) {
    await signalGuideStep('welcome', 'intro', 'auto_observed');
    guide = normalizeGuideState(state.guideState);
  }

  if (guide.step !== 'enable_imap' || guide.status.enable_imap === 'done') {
    clearImapExpectedTarget();
    state.imapMissingControlTicks = 0;
    state.imapAlwaysOnDetectedAt = 0;
    hideSpotlight();
    return;
  }

  await signalGuideStep('enable_imap', 'imap_tab_open', 'auto_observed', {
    imap: { tabOpenAt: new Date().toISOString() }
  });
  guide = normalizeGuideState(state.guideState);

  const enableControl = findImapEnableControl();
  const selected = isImapEnableSelected();
  const saveControl = findImapSaveControl();
  const savePending = hasPendingImapSave(saveControl);

  if (enableControl && !selected) {
    setImapExpectedTarget(IMAP_EXPECTED_ACTION.ENABLE, enableControl, 'Click "Enable IMAP"');
    return;
  }

  if (!enableControl && !savePending) {
    state.imapMissingControlTicks += 1;
    if (!state.imapAlwaysOnDetectedAt) {
      state.imapAlwaysOnDetectedAt = Date.now();
    }

    if (state.imapMissingControlTicks >= IMAP_MISSING_CONTROL_TICKS_TO_AUTOCOMPLETE) {
      await signalGuideStep('enable_imap', 'imap_saved', 'imap_always_on_personal', {
        imap: { savedAt: new Date().toISOString(), alreadyEnabled: true }
      });
      clearImapExpectedTarget();
      state.imapMissingControlTicks = 0;
      hideSpotlight();
      return;
    }

    clearImapExpectedTarget();
    hideSpotlight();
    return;
  }

  if (selected) {
    state.imapMissingControlTicks = 0;
    state.imapAlwaysOnDetectedAt = 0;
    await signalGuideStep('enable_imap', 'imap_enabled_selected', 'auto_observed', {
      imap: { enabledSelectedAt: new Date().toISOString() }
    });

    if (savePending && saveControl) {
      setImapExpectedTarget(IMAP_EXPECTED_ACTION.SAVE, saveControl, 'Click "Save Changes"');
      return;
    }

    const alreadyEnabled = !guide.evidence?.imap?.saveClickedAt;
    await signalGuideStep('enable_imap', 'imap_saved', alreadyEnabled ? 'imap_already_enabled' : 'auto_observed', {
      imap: { savedAt: new Date().toISOString(), alreadyEnabled }
    });
    clearImapExpectedTarget();
    state.imapMissingControlTicks = 0;
    state.imapAlwaysOnDetectedAt = 0;
    hideSpotlight();
    return;
  }

  clearImapExpectedTarget();
  hideSpotlight();
}

async function runAppPasswordAutoProgress() {
  const guide = normalizeGuideState(state.guideState);
  if (guide.status.generate_app_password === 'done') return;
  if (guide.step !== 'generate_app_password') return;
  if (!isMyAccountHost()) return;

  if (hasGeneratedCodeSignalInDom()) {
    await signalGuideStep('generate_app_password', 'app_password_generated', 'auto_observed', {
      appPassword: { generatedAt: new Date().toISOString(), source: 'dom_signal' }
    });
  }
}

function updateGuideProgressUI() {
  const guide = normalizeGuideState(state.guideState);
  const stepNumber = stepNumberFromKey(guide.step);

  if (state.lastRenderedGuideStep !== guide.step) {
    state.lastRenderedGuideStep = guide.step;
    state.lastAutoSignalKey = '';
  }

  const progressTextNodes = [
    document.getElementById('gmailUnifiedGuideProgressText'),
    document.getElementById('gmailUnifiedSetupProgressText')
  ];

  progressTextNodes.forEach((node) => {
    if (!node) return;
    node.textContent = `Step ${stepNumber}/4 · ${guide.progress}/4 completed`;
  });

  const progressBars = [
    document.getElementById('gmailUnifiedGuideProgressBar'),
    document.getElementById('gmailUnifiedSetupProgressBar')
  ];

  const width = `${Math.max(0, Math.min(100, (guide.progress / 4) * 100))}%`;
  progressBars.forEach((bar) => {
    if (bar) bar.style.width = width;
  });

  const guideCounter = document.getElementById('gmailUnifiedGuideCounterBadge');
  if (guideCounter) {
    guideCounter.textContent = `${guide.progress}/4`;
  }

  const stepNodes = document.querySelectorAll('.gmail-unified-guide-slide');
  stepNodes.forEach((node) => {
    const stepKey = String(node.dataset.step || '');
    node.classList.toggle('active', stepKey === guide.step);
  });

  const setupTitle = document.getElementById('gmailUnifiedSetupTitle');
  const setupBody = document.getElementById('gmailUnifiedSetupBody');
  const setupHint = document.getElementById('gmailUnifiedSetupHint');
  if (setupTitle && setupBody) {
    const copy = activeGuideCopy();
    setupTitle.textContent = copy.title;
    setupBody.textContent = copy.body;
    if (setupHint) {
      setupHint.textContent = 'Do this now -> we move you forward automatically.';
    }
  }

  const contextChip = document.getElementById('gmailUnifiedGuideContext');
  if (contextChip) {
    contextChip.textContent = `Current page: ${friendlyContextLabel(guide.currentContext || currentPageContext())}`;
  }

  const stepButtons = [
    { id: 'gmailUnifiedImapTakeBtn', step: 'enable_imap' },
    { id: 'gmailUnifiedAppTakeBtn', step: 'generate_app_password' },
    { id: 'gmailUnifiedSetupTakeBtn', step: guide.step === 'welcome' ? 'enable_imap' : guide.step },
    { id: 'gmailUnifiedExternalTakeBtn', step: guide.step === 'welcome' ? 'enable_imap' : guide.step }
  ];

  stepButtons.forEach(({ id, step }) => {
    const button = document.getElementById(id);
    if (!button) return;
    const contextMatches = guide.currentContext === stepTargetContext(step) || currentPageContext() === stepTargetContext(step);
    button.textContent = contextMatches ? 'You are on the right page' : stepTargetLabel(step);
  });
}

async function refreshGuideAndAuthState() {
  const [storage, guide] = await Promise.all([sendWorker('GET_STORAGE'), sendWorker('GUIDE_GET_STATE')]);

  state.connected = Boolean(storage?.success && storage.userId);
  state.guideState = normalizeGuideState(guide?.success ? guide.guideState : state.guideState);

  return { storage, guide: state.guideState };
}

async function guideNavigate(step) {
  if (!GUIDE_STEP_SET.has(step)) return;
  const response = await sendWorker('GUIDE_NAVIGATE_TO_STEP', { step });
  if (response?.success && response.guideState) {
    state.guideState = normalizeGuideState(response.guideState);
    return;
  }
  await refreshGuideAndAuthState();
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
  const setupHelper = document.getElementById('gmailUnifiedSetupHelper');
  const guideClose = document.getElementById('gmailUnifiedGuideCloseBtn');

  if (!sidebar || !shell || !onboardingOverlay || !setupHelper) return;

  const setupMode = !state.connected && isGmailSetupRoute();
  const shouldFullscreen = state.connected || !setupMode;

  document.body.classList.toggle('gmail-unified-fullscreen', shouldFullscreen);
  sidebar.classList.toggle('gmail-unified-setup-mode', setupMode);
  sidebar.classList.toggle('gmail-unified-locked', !state.connected);

  shell.hidden = !state.connected;

  if (state.connected) {
    onboardingOverlay.hidden = !state.guideReviewOpen;
    setupHelper.hidden = true;
    if (guideClose) guideClose.hidden = !state.guideReviewOpen;
  } else {
    onboardingOverlay.hidden = setupMode;
    setupHelper.hidden = !setupMode;
    if (guideClose) guideClose.hidden = true;
  }

  updateGuideProgressUI();

  if (!state.connected && setupMode) {
    queueGuideAutoProgressTick();
  } else {
    hideSpotlight();
  }
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

  if (isAppPasswordLike(appPassword)) {
    await guideConfirm('generate_app_password', {
      substep: 'app_password_generated',
      reason: 'connect_input_pattern',
      evidence: {
        appPassword: { generatedAt: new Date().toISOString(), source: 'connect_input_pattern' }
      }
    });
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
      reason: 'connect_submitted'
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
    await guideConfirm('welcome');
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedImapTakeBtn')?.addEventListener('click', async () => {
    await guideNavigate('enable_imap');
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedAppTakeBtn')?.addEventListener('click', async () => {
    await guideNavigate('generate_app_password');
    applyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedConnectBtn')?.addEventListener('click', async () => {
    await connectFromGuide();
  });

  sidebar.querySelector('#gmailUnifiedConnectPassword')?.addEventListener('input', async (event) => {
    const value = event?.target?.value || '';
    if (!isAppPasswordLike(value)) return;
    await guideConfirm('generate_app_password', {
      substep: 'app_password_generated',
      reason: 'connect_input_pattern',
      evidence: {
        appPassword: { generatedAt: new Date().toISOString(), source: 'connect_input_pattern' }
      }
    });
    updateGuideProgressUI();
  });

  document.addEventListener(
    'change',
    () => {
      queueGuideAutoProgressTick();
    },
    true
  );

  document.addEventListener(
    'input',
    () => {
      queueGuideAutoProgressTick();
    },
    true
  );

  sidebar.querySelector('#gmailUnifiedConnectPassword')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await connectFromGuide();
    }
  });

  sidebar.querySelector('#gmailUnifiedSetupTakeBtn')?.addEventListener('click', async () => {
    const step = state.guideState?.step === 'welcome' ? 'enable_imap' : state.guideState?.step || 'enable_imap';
    await guideNavigate(step);
    applyGmailLayoutMode();
  });

  document.addEventListener(
    'click',
    async (event) => {
      if (state.connected || !isGmailSetupRoute()) return;
      const guide = normalizeGuideState(state.guideState);
      if (guide.step !== 'enable_imap' || guide.status.enable_imap === 'done') return;

      const target = event.target;
      if (!(target instanceof Element)) return;

      const expectedAction = state.imapExpectedAction;
      const expectedTarget = state.imapExpectedTarget;
      if (!expectedAction || !(expectedTarget instanceof Element)) return;
      if (!matchesImapExpectedTarget(target, expectedTarget)) return;

      clearImapExpectedTarget();

      if (expectedAction === IMAP_EXPECTED_ACTION.ENABLE) {
        await guideConfirm('enable_imap', {
          substep: 'imap_enabled_selected',
          reason: 'imap_enable_clicked',
          evidence: { imap: { enabledSelectedAt: new Date().toISOString() } }
        });
      } else if (expectedAction === IMAP_EXPECTED_ACTION.SAVE) {
        await guideConfirm('enable_imap', {
          substep: 'imap_enabled_selected',
          reason: 'imap_save_clicked',
          evidence: { imap: { saveClickedAt: new Date().toISOString() } }
        });
      }

      queueGuideAutoProgressTick();
    },
    true
  );

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
            <span id="gmailUnifiedGuideCounterBadge" class="gmail-unified-counter-badge">0/4</span>
            <button id="gmailUnifiedGuideCloseBtn" class="gmail-unified-guide-close-modal" hidden>Close</button>
          </div>
        </header>
        <div class="gmail-unified-progress-wrap">
          <div id="gmailUnifiedGuideProgressText" class="gmail-unified-progress-text">Step 1/4 · 0/4 completed</div>
          <div class="gmail-unified-progress-track"><div id="gmailUnifiedGuideProgressBar" class="gmail-unified-progress-fill"></div></div>
          <div id="gmailUnifiedGuideContext" class="gmail-unified-guide-context">Current page: Gmail inbox</div>
        </div>

        <article class="gmail-unified-guide-slide active" data-step="welcome">
          <h3>Welcome</h3>
          <p>We will guide you click-by-click. You stay in control the whole time.</p>
          <ul>
            <li>We can take you to the right page automatically.</li>
            <li>We can highlight what to click next.</li>
            <li>We will never submit settings for you.</li>
          </ul>
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedWelcomeStartBtn" class="gmail-unified-primary-btn">Start setup</button>
          </div>
        </article>

        <article class="gmail-unified-guide-slide" data-step="enable_imap">
          <h3>Step 2: Enable IMAP</h3>
          <p>Choose Enable IMAP first. Then click Save Changes. We will move you forward automatically.</p>
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedImapTakeBtn" class="gmail-unified-secondary-btn">Take me there</button>
          </div>
        </article>

        <article class="gmail-unified-guide-slide" data-step="generate_app_password">
          <h3>Step 3: Generate App Password</h3>
          <p>Create an app password named <strong>Gmail Unified</strong>. We auto-detect the generated code.</p>
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedAppTakeBtn" class="gmail-unified-secondary-btn">Take me there</button>
          </div>
        </article>

        <article class="gmail-unified-guide-slide" data-step="connect_account">
          <h3>Step 4: Connect account</h3>
          <p>Paste your Gmail address and app password exactly as shown by Google.</p>
          <label for="gmailUnifiedConnectEmail" class="gmail-unified-field-label">Gmail address</label>
          <input id="gmailUnifiedConnectEmail" class="gmail-unified-field" type="email" placeholder="you@gmail.com" />
          <label for="gmailUnifiedConnectPassword" class="gmail-unified-field-label">App password</label>
          <input id="gmailUnifiedConnectPassword" class="gmail-unified-field" type="password" placeholder="xxxx xxxx xxxx xxxx" />
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedConnectBtn" class="gmail-unified-primary-btn">Connect my account</button>
          </div>
          <div id="gmailUnifiedConnectStatus" class="gmail-unified-connect-status"></div>
        </article>
      </div>
    </section>

    <section id="gmailUnifiedSetupHelper" class="gmail-unified-setup-helper" hidden>
      <div class="gmail-unified-setup-head">
        <span class="gmail-unified-modal-kicker">Guided setup</span>
        <div id="gmailUnifiedSetupProgressText" class="gmail-unified-progress-text">Step 1/4 · 0/4 completed</div>
      </div>
      <div class="gmail-unified-progress-track"><div id="gmailUnifiedSetupProgressBar" class="gmail-unified-progress-fill"></div></div>
      <h4 id="gmailUnifiedSetupTitle">Enable IMAP</h4>
      <p id="gmailUnifiedSetupBody">Enable IMAP in Gmail settings, then save.</p>
      <p id="gmailUnifiedSetupHint" class="gmail-unified-setup-hint">Do this now -> we move you forward automatically.</p>
      <div class="gmail-unified-guide-actions">
        <button id="gmailUnifiedSetupTakeBtn" class="gmail-unified-secondary-btn">Take me there</button>
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

  window.addEventListener('scroll', queueSpotlightRefresh, true);
  window.addEventListener('resize', queueSpotlightRefresh);
  startGuideAutoProgressLoop();
  queueGuideAutoProgressTick();

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

function renderExternalGuide(guideState, connected) {
  let root = document.getElementById('gmailUnifiedExternalGuide');
  if (!root) {
    root = document.createElement('div');
    root.id = 'gmailUnifiedExternalGuide';
    root.className = 'gmail-unified-external-guide';
    root.innerHTML = `
      <div class="gmail-unified-external-card">
        <div class="gmail-unified-modal-kicker">Gmail Unified setup</div>
        <h3 id="gmailUnifiedExternalTitle">Generate App Password</h3>
        <p id="gmailUnifiedExternalBody">Create an app password named Gmail Unified and copy the code.</p>
        <div id="gmailUnifiedExternalProgress" class="gmail-unified-progress-text">Step 3/4 · 2/4 completed</div>
        <div class="gmail-unified-progress-track"><div id="gmailUnifiedExternalProgressBar" class="gmail-unified-progress-fill"></div></div>
        <div class="gmail-unified-guide-actions">
          <button id="gmailUnifiedExternalTakeBtn" class="gmail-unified-secondary-btn">Take me there</button>
        </div>
      </div>
    `;
    document.body.appendChild(root);

    root.querySelector('#gmailUnifiedExternalTakeBtn')?.addEventListener('click', async () => {
      await guideNavigate('generate_app_password');
      await syncExternalGuide();
    });
  }

  root.style.display = connected ? 'none' : 'block';
  if (connected) {
    hideSpotlight();
    return;
  }

  const normalized = normalizeGuideState(guideState);
  const titleNode = document.getElementById('gmailUnifiedExternalTitle');
  const bodyNode = document.getElementById('gmailUnifiedExternalBody');
  const progressNode = document.getElementById('gmailUnifiedExternalProgress');
  const progressBar = document.getElementById('gmailUnifiedExternalProgressBar');

  const copy = activeGuideCopy();
  if (titleNode) titleNode.textContent = copy.title;
  if (bodyNode) bodyNode.textContent = copy.body;
  if (progressNode) progressNode.textContent = `Step ${stepNumberFromKey(normalized.step)}/4 · ${normalized.progress}/4 completed`;
  if (progressBar) progressBar.style.width = `${(normalized.progress / 4) * 100}%`;

  queueGuideAutoProgressTick();

  const target = findVisibleTarget([
    'input[type="text"]',
    'input[aria-label*="App" i]',
    'button[type="submit"]',
    'button'
  ]);

  if (target) {
    positionSpotlight(target);
  } else {
    hideSpotlight();
  }
}

async function syncExternalGuide() {
  await refreshGuideAndAuthState();
  const guide = normalizeGuideState(state.guideState);
  if (!state.connected && guide.step === 'connect_account') {
    await guideNavigate('connect_account');
    return;
  }
  renderExternalGuide(state.guideState, state.connected);
}

function bootExternalGuide() {
  startGuideAutoProgressLoop();
  syncExternalGuide();

  window.addEventListener('scroll', queueSpotlightRefresh, true);
  window.addEventListener('resize', queueSpotlightRefresh);

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
      syncExternalGuide().catch(() => {});
    }
  });
}

if (isMyAccountHost()) {
  bootExternalGuide();
} else if (isMailHost()) {
  waitForGmail(() => {
    bootGmailSurface().catch(() => {});
  });
}
