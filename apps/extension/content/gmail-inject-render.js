const foundationNormalizeSetupDiagnostics = globalThis.normalizeSetupDiagnostics;
const foundationState = globalThis.state;
const foundationUpdateMainPanelVisibility = globalThis.updateMainPanelVisibility;
const foundationFormatDate = globalThis.formatDate;
const foundationEscapeHtml = globalThis.escapeHtml;

function formatActivityTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--:--';
  return date.toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit'
  });
}

function formatActivityLine(entry) {
  const parts = [
    formatActivityTime(entry.ts),
    entry.source,
    entry.level,
    entry.stage
  ];

  if (entry.code) parts.push(entry.code);
  parts.push(entry.message);
  if (entry.details) parts.push(entry.details);

  return parts
    .map((part) => String(part || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' ');
}

function renderActivityPanel() {
  const log = document.getElementById('gmailUnifiedActivityLog');
  if (!log) return;

  const entries = foundationNormalizeSetupDiagnostics(foundationState.setupDiagnostics).entries;
  if (!entries.length) {
    log.textContent = 'Activity from the UI, extension, backend, and Gmail will appear here.';
    return;
  }

  log.textContent = entries.map((entry) => formatActivityLine(entry)).join('\n');
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
  let current = [...foundationState.messages];

  if (foundationState.filter === 'inbox') {
    current = current.filter((message) => !message.isOutgoing);
  }

  if (foundationState.filter === 'sent') {
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
  countdown.style.display = foundationState.retrySeconds > 0 ? 'block' : 'none';
  countdown.textContent = foundationState.retrySeconds > 0 ? `Retrying automatically in ${foundationState.retrySeconds}s` : '';

  if (type === 'normal') {
    card.style.display = 'none';
    list.style.display = 'block';
    detail.style.display = foundationState.selectedThreadId ? 'block' : 'none';
  } else {
    card.style.display = 'block';
    list.style.display = 'none';
    detail.style.display = 'none';
  }

  foundationUpdateMainPanelVisibility();
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
        <span class="gmail-unified-date">${foundationFormatDate(latest.date)}</span>
      </div>
      <div class="gmail-unified-thread-who">${foundationEscapeHtml(who)}</div>
      <div class="gmail-unified-thread-subject ${unread ? 'unread' : ''}">${foundationEscapeHtml(
      latest.subject || '(no subject)'
    )}</div>
      <div class="gmail-unified-thread-snippet">${foundationEscapeHtml(latest.snippet || '(no preview)')}</div>
      <div class="gmail-unified-thread-meta">
        <span>${group.messages.length} message${group.messages.length > 1 ? 's' : ''}</span>
        ${unread ? '<span class="gmail-unified-unread-dot" title="Unread"></span>' : ''}
      </div>
    `;

    row.addEventListener('click', () => {
      foundationState.selectedThreadId = group.threadId;
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
        <span>${foundationEscapeHtml(who)}</span>
        <span>${foundationFormatDate(message.date)}</span>
      </div>
      <div class="gmail-unified-message-snippet">${foundationEscapeHtml(message.snippet || '(no preview)')}</div>
    `;

      body.appendChild(item);
    });

  foundationUpdateMainPanelVisibility();
}

Object.assign(globalThis, {
  formatActivityTime,
  formatActivityLine,
  renderActivityPanel,
  byDateDesc,
  groupByThread,
  isUnread,
  filteredMessages,
  setStateCard,
  renderThreads,
  renderThreadDetail
});
