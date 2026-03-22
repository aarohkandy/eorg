/* global chrome, indexedDB */

(function initMailitaGmailLocal(globalScope) {
  const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const API_ROOT = 'https://www.googleapis.com/gmail/v1/users/me';
  const DB_NAME = 'mailita-local-cache';
  const DB_VERSION = 1;
  const MESSAGE_STORE = 'messages';
  const META_STORE = 'meta';
  const META_KEYS = {
    accountEmail: 'accountEmail',
    grantedScopes: 'grantedScopes',
    lastHistoryId: 'lastHistoryId',
    lastSyncTime: 'lastSyncTime',
    lastFullSyncAt: 'lastFullSyncAt'
  };
  const CACHE_TTL_MS = 90 * 1000;

  let dbPromise = null;

  function nowIso() {
    return new Date().toISOString();
  }

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;

        if (!db.objectStoreNames.contains(MESSAGE_STORE)) {
          const messages = db.createObjectStore(MESSAGE_STORE, { keyPath: 'id' });
          messages.createIndex('byContactEmail', 'contactEmail', { unique: false });
          messages.createIndex('byDate', 'date', { unique: false });
          messages.createIndex('byThreadId', 'threadId', { unique: false });
        }

        if (!db.objectStoreNames.contains(META_STORE)) {
          db.createObjectStore(META_STORE, { keyPath: 'key' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });

    return dbPromise;
  }

  async function withStore(storeName, mode, task) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);

      let settled = false;
      const finish = (value, isError = false) => {
        if (settled) return;
        settled = true;
        if (isError) reject(value);
        else resolve(value);
      };

      tx.oncomplete = () => finish(undefined);
      tx.onerror = () => finish(tx.error || new Error(`IndexedDB transaction failed: ${storeName}`), true);
      tx.onabort = () => finish(tx.error || new Error(`IndexedDB transaction aborted: ${storeName}`), true);

      Promise.resolve()
        .then(() => task(store, tx))
        .then((value) => {
          tx.__mailitaResult = value;
        })
        .catch((error) => {
          finish(error, true);
          try {
            tx.abort();
          } catch {
            // Ignore abort failures.
          }
        });

      tx.oncomplete = () => finish(tx.__mailitaResult);
    });
  }

  async function metaGet(key, fallback = null) {
    return withStore(META_STORE, 'readonly', (store) => new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result ? request.result.value : fallback);
      request.onerror = () => reject(request.error);
    }));
  }

  async function metaSet(key, value) {
    return withStore(META_STORE, 'readwrite', (store) => store.put({ key, value }));
  }

  async function metaSetMany(entries) {
    return withStore(META_STORE, 'readwrite', (store) => {
      entries.forEach(([key, value]) => {
        store.put({ key, value });
      });
    });
  }

  async function listMessages() {
    return withStore(MESSAGE_STORE, 'readonly', (store) => new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : []);
      request.onerror = () => reject(request.error);
    }));
  }

  async function replaceMessages(messages) {
    return withStore(MESSAGE_STORE, 'readwrite', (store) => {
      store.clear();
      (Array.isArray(messages) ? messages : []).forEach((message) => {
        store.put(message);
      });
    });
  }

  async function mergeMessages(messages) {
    return withStore(MESSAGE_STORE, 'readwrite', (store) => {
      (Array.isArray(messages) ? messages : []).forEach((message) => {
        store.put(message);
      });
    });
  }

  async function clearAll() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([MESSAGE_STORE, META_STORE], 'readwrite');
      tx.objectStore(MESSAGE_STORE).clear();
      tx.objectStore(META_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function displayNameFromIdentity(identity) {
    const name = String(identity?.name || '').trim();
    const email = normalizeEmail(identity?.email);
    return name || email || 'Unknown contact';
  }

  function contactKeyFromIdentity(identity) {
    const email = normalizeEmail(identity?.email);
    if (email) return `contact:${email}`;

    const label = String(identity?.name || '').trim().toLowerCase();
    if (label) return `contact-label:${label}`;

    return '';
  }

  function buildContactIdentity(from, to, isOutgoing) {
    if (isOutgoing) {
      const primaryRecipient = Array.isArray(to) ? to[0] : null;
      const email = normalizeEmail(primaryRecipient?.email);
      const name = String(primaryRecipient?.name || '').trim();
      return {
        contactKey: contactKeyFromIdentity({ email, name }),
        contactEmail: email,
        contactName: name || email || 'Unknown contact'
      };
    }

    const email = normalizeEmail(from?.email);
    const name = String(from?.name || '').trim();
    return {
      contactKey: contactKeyFromIdentity({ email, name }),
      contactEmail: email,
      contactName: name || email || 'Unknown contact'
    };
  }

  function messageMatchesContact(message, contactEmail) {
    const target = normalizeEmail(contactEmail);
    if (!target) return false;

    const canonical = normalizeEmail(message?.contactEmail);
    if (canonical) return canonical === target;

    const fromEmail = normalizeEmail(message?.from?.email);
    const toEmails = Array.isArray(message?.to)
      ? message.to.map((entry) => normalizeEmail(entry?.email)).filter(Boolean)
      : [];

    return fromEmail === target || toEmails.includes(target);
  }

  function parseAddressToken(token) {
    const value = String(token || '').trim();
    if (!value) return { name: '', email: '' };

    const match = value.match(/^(.*?)(?:<([^>]+)>)$/);
    if (match) {
      const name = String(match[1] || '').replace(/^"+|"+$/g, '').trim();
      const email = normalizeEmail(match[2]);
      return { name, email };
    }

    return {
      name: '',
      email: normalizeEmail(value.replace(/^"+|"+$/g, ''))
    };
  }

  function parseAddressList(raw) {
    const value = String(raw || '').trim();
    if (!value) return [];

    const tokens = value.match(/(?:[^,"<]|"[^"]*"|<[^>]*>)+/g) || [];
    return tokens
      .map((token) => parseAddressToken(token))
      .filter((entry) => entry.email || entry.name);
  }

  function safeDate(value) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return new Date(parsed).toISOString();
    }

    const date = value ? new Date(value) : new Date(0);
    return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
  }

  function decodeBase64Url(input) {
    const value = String(input || '').replace(/-/g, '+').replace(/_/g, '/');
    if (!value) return '';

    const padded = value + '='.repeat((4 - (value.length % 4 || 4)) % 4);
    try {
      return decodeURIComponent(escape(atob(padded)));
    } catch {
      try {
        return atob(padded);
      } catch {
        return '';
      }
    }
  }

  function flattenParts(payload, parts = []) {
    if (!payload || typeof payload !== 'object') return parts;
    parts.push(payload);
    if (Array.isArray(payload.parts)) {
      payload.parts.forEach((part) => flattenParts(part, parts));
    }
    return parts;
  }

  function partBodyText(part) {
    return decodeBase64Url(part?.body?.data || '');
  }

  function extractBodyFromPayload(payload) {
    const parts = flattenParts(payload, []);
    const htmlPart = parts.find((part) => String(part?.mimeType || '').toLowerCase() === 'text/html' && part?.body?.data);
    const textPart = parts.find((part) => String(part?.mimeType || '').toLowerCase() === 'text/plain' && part?.body?.data);
    const bodyHtml = htmlPart ? partBodyText(htmlPart) : '';
    const bodyText = textPart ? partBodyText(textPart) : '';
    const fallback = !bodyHtml && !bodyText && payload?.body?.data ? partBodyText(payload) : '';
    const html = bodyHtml || (String(payload?.mimeType || '').toLowerCase() === 'text/html' ? fallback : '');
    const text = bodyText || (html ? html.replace(/<[^>]+>/g, ' ') : fallback);
    const normalizedText = String(text || '').replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    const remoteImages = /<img\b[^>]+src=["']https?:\/\//i.test(html);
    const linkedImages = /<img\b[^>]+src=["'](?:cid:|data:)/i.test(html);

    return {
      bodyText: normalizedText,
      bodyHtml: String(html || '').trim(),
      bodyFormat: html ? 'html' : 'text',
      hasRemoteImages: remoteImages,
      hasLinkedImages: linkedImages
    };
  }

  function headerValue(headers, name) {
    const target = String(name || '').toLowerCase();
    const entry = Array.isArray(headers)
      ? headers.find((header) => String(header?.name || '').toLowerCase() === target)
      : null;
    return entry ? String(entry.value || '') : '';
  }

  function flagsFromLabels(labelIds) {
    const labels = new Set(Array.isArray(labelIds) ? labelIds.map((label) => String(label)) : []);
    const flags = [];
    if (!labels.has('UNREAD')) flags.push('\\Seen');
    if (labels.has('STARRED')) flags.push('\\Flagged');
    return flags;
  }

  function normalizeMessage(message, accountEmail) {
    const payload = message?.payload || {};
    const headers = Array.isArray(payload.headers) ? payload.headers : [];
    const from = parseAddressList(headerValue(headers, 'From'))[0] || { name: '', email: '' };
    const to = parseAddressList(headerValue(headers, 'To'));
    const subject = headerValue(headers, 'Subject') || '(no subject)';
    const labelIds = Array.isArray(message?.labelIds) ? message.labelIds : [];
    const isOutgoing = labelIds.includes('SENT') || normalizeEmail(from.email) === normalizeEmail(accountEmail);
    const contactIdentity = buildContactIdentity(from, to, isOutgoing);
    const bodies = extractBodyFromPayload(payload);
    const date = safeDate(message?.internalDate || headerValue(headers, 'Date'));

    return {
      id: `gmail-${message.id}`,
      uid: null,
      messageId: message?.id || '',
      subject,
      from,
      to,
      date,
      snippet: String(message?.snippet || '').trim(),
      bodyText: bodies.bodyText || String(message?.snippet || '').trim(),
      bodyHtml: bodies.bodyHtml,
      bodyFormat: bodies.bodyFormat,
      hasRemoteImages: bodies.hasRemoteImages,
      hasLinkedImages: bodies.hasLinkedImages,
      isOutgoing,
      folder: isOutgoing ? 'SENT' : 'INBOX',
      threadId: String(message?.threadId || message?.id || ''),
      contactKey: contactIdentity.contactKey,
      contactEmail: contactIdentity.contactEmail,
      contactName: contactIdentity.contactName,
      flags: flagsFromLabels(labelIds),
      historyId: String(message?.historyId || '')
    };
  }

  function byDateDesc(a, b) {
    return new Date(b.date).getTime() - new Date(a.date).getTime();
  }

  function buildContactSummaries(messages, limit = 50) {
    const map = new Map();

    (Array.isArray(messages) ? messages : []).forEach((message) => {
      const contactKey = String(message?.contactKey || '').trim();
      if (!contactKey) return;

      if (!map.has(contactKey)) {
        map.set(contactKey, {
          contactKey,
          threadId: contactKey,
          contactEmail: normalizeEmail(message?.contactEmail),
          displayName: String(message?.contactName || message?.contactEmail || 'Unknown contact').trim(),
          latestSubject: message?.subject || '(no subject)',
          latestDate: message?.date || new Date(0).toISOString(),
          latestDirection: message?.isOutgoing ? 'outgoing' : 'incoming',
          latestMessageId: message?.messageId || message?.id || '',
          messageCount: 0,
          unreadCount: 0,
          hasMissingContent: false,
          inboxCount: 0,
          sentCount: 0
        });
      }

      const summary = map.get(contactKey);
      summary.messageCount += 1;
      if (message?.folder === 'INBOX') summary.inboxCount += 1;
      if (message?.folder === 'SENT') summary.sentCount += 1;
      if (!(Array.isArray(message?.flags) ? message.flags : []).includes('\\Seen')) {
        summary.unreadCount += 1;
      }
      if (!String(message?.bodyText || message?.snippet || '').trim() && !String(message?.bodyHtml || '').trim()) {
        summary.hasMissingContent = true;
      }

      const currentLatest = new Date(summary.latestDate).getTime();
      const candidateDate = new Date(message?.date || 0).getTime();
      if (!Number.isFinite(currentLatest) || candidateDate >= currentLatest) {
        summary.latestSubject = message?.subject || '(no subject)';
        summary.latestDate = message?.date || summary.latestDate;
        summary.latestDirection = message?.isOutgoing ? 'outgoing' : 'incoming';
        summary.latestMessageId = message?.messageId || message?.id || summary.latestMessageId;
        summary.displayName = String(message?.contactName || message?.contactEmail || summary.displayName).trim();
        summary.contactEmail = normalizeEmail(message?.contactEmail) || summary.contactEmail;
      }
    });

    return [...map.values()]
      .sort((a, b) => new Date(b.latestDate).getTime() - new Date(a.latestDate).getTime())
      .slice(0, limit);
  }

  function timingEnvelope(startedAt, extra = {}) {
    return {
      user_lookup_ms: Number(extra.user_lookup_ms || 0),
      cache_freshness_ms: Number(extra.cache_freshness_ms || 0),
      cache_read_ms: Number(extra.cache_read_ms || 0),
      grouping_ms: Number(extra.grouping_ms || 0),
      imap_fetch_ms: Number(extra.imap_fetch_ms || 0),
      upsert_ms: Number(extra.upsert_ms || 0),
      total_ms: Math.max(0, Date.now() - startedAt)
    };
  }

  function debugEnvelope(mode, counts = {}) {
    return {
      backend: {
        version: chrome.runtime.getManifest().version,
        buildSha: mode,
        deployedAt: null
      },
      cache: {
        used: mode !== 'live',
        newestCachedAt: counts.newestCachedAt || null,
        totalMessages: Number(counts.totalMessages || 0),
        missingContentCount: Number(counts.missingContentCount || 0),
        shortContentCount: Number(counts.shortContentCount || 0),
        contentCoveragePct: Number(counts.contentCoveragePct ?? 100)
      },
      live: {
        used: mode === 'live',
        limitPerFolder: Number(counts.limitPerFolder || 0),
        totalMessages: Number(counts.totalMessages || 0),
        missingContentCount: Number(counts.missingContentCount || 0),
        shortContentCount: Number(counts.shortContentCount || 0),
        contentCoveragePct: Number(counts.contentCoveragePct ?? 100)
      }
    };
  }

  function contentCoverage(messages) {
    const list = Array.isArray(messages) ? messages : [];
    const totalMessages = list.length;
    const missingContentCount = list.filter((message) => {
      const text = String(message?.bodyText || message?.snippet || '').trim();
      const html = String(message?.bodyHtml || '').trim();
      return !text && !html;
    }).length;
    const shortContentCount = list.filter((message) => {
      const text = String(message?.bodyText || message?.snippet || '').trim();
      return text.length > 0 && text.length < 40;
    }).length;
    const contentCoveragePct = totalMessages
      ? Math.round(((totalMessages - missingContentCount - shortContentCount) / totalMessages) * 100)
      : 100;

    return {
      totalMessages,
      missingContentCount,
      shortContentCount,
      contentCoveragePct
    };
  }

  async function getAuthToken(interactive = false) {
    const result = await chrome.identity.getAuthToken({
      interactive,
      scopes: [GMAIL_SCOPE]
    });

    if (typeof result === 'string') {
      return { token: result, grantedScopes: [GMAIL_SCOPE] };
    }

    return {
      token: String(result?.token || ''),
      grantedScopes: Array.isArray(result?.grantedScopes) && result.grantedScopes.length
        ? result.grantedScopes
        : [GMAIL_SCOPE]
    };
  }

  async function clearCachedTokens() {
    if (typeof chrome.identity.clearAllCachedAuthTokens === 'function') {
      try {
        await chrome.identity.clearAllCachedAuthTokens();
        return;
      } catch {
        // Fall back to removing the last token below.
      }
    }

    const token = await metaGet('lastToken', '');
    if (!token) return;

    try {
      await chrome.identity.removeCachedAuthToken({ token });
    } catch {
      // Ignore token eviction failures during disconnect.
    }
  }

  function oauthClientConfigured() {
    const manifest = chrome.runtime.getManifest();
    const clientId = String(manifest?.oauth2?.client_id || '').trim();
    if (!clientId) return false;
    return !/^REPLACE_WITH_/i.test(clientId) && !/^YOUR_/i.test(clientId);
  }

  async function authorizedFetch(path, options = {}, attempt = 0) {
    const auth = await getAuthToken(attempt === 0 && Boolean(options.interactive));
    if (!auth.token) {
      throw new Error('OAuth token was not returned by chrome.identity.');
    }

    await metaSet('lastToken', auth.token);

    const response = await fetch(`${API_ROOT}${path}`, {
      method: options.method || 'GET',
      headers: {
        Authorization: `Bearer ${auth.token}`,
        ...(options.headers || {})
      },
      body: options.body
    });

    if (response.status === 401 && attempt === 0) {
      try {
        await chrome.identity.removeCachedAuthToken({ token: auth.token });
      } catch {
        // Ignore token eviction failures.
      }
      return authorizedFetch(path, options, attempt + 1);
    }

    return response;
  }

  async function fetchJson(path, options = {}) {
    const response = await authorizedFetch(path, options);
    const text = await response.text();
    let payload = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    return {
      ok: response.ok,
      status: response.status,
      data: payload
    };
  }

  async function fetchThreads(query, limit) {
    const params = new URLSearchParams({
      maxResults: String(limit)
    });
    if (query) params.set('q', query);

    const response = await fetchJson(`/threads?${params.toString()}`, { interactive: true });
    if (!response.ok) {
      const error = new Error(response?.data?.error?.message || `Gmail threads list failed with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }

    return Array.isArray(response.data?.threads) ? response.data.threads : [];
  }

  async function mapWithConcurrency(items, limit, task) {
    const results = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        const index = nextIndex++;
        results[index] = await task(items[index], index);
      }
    }

    const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async function fetchThreadDetails(threadIds) {
    return mapWithConcurrency(threadIds, 6, async (threadId) => {
      const response = await fetchJson(`/threads/${threadId}?format=full`, { interactive: false });
      if (!response.ok) {
        const error = new Error(response?.data?.error?.message || `Gmail thread fetch failed with HTTP ${response.status}.`);
        error.status = response.status;
        throw error;
      }
      return response.data;
    });
  }

  async function fetchProfile() {
    const response = await fetchJson('/profile', { interactive: true });
    if (!response.ok) {
      const error = new Error(response?.data?.error?.message || `Gmail profile fetch failed with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return response.data;
  }

  async function fetchHistory(startHistoryId) {
    const params = new URLSearchParams({
      startHistoryId: String(startHistoryId)
    });
    const response = await fetchJson(`/history?${params.toString()}`, { interactive: false });
    if (!response.ok) {
      const error = new Error(response?.data?.error?.message || `Gmail history fetch failed with HTTP ${response.status}.`);
      error.status = response.status;
      throw error;
    }
    return response.data || {};
  }

  async function fullRefresh(options = {}) {
    const startedAt = Date.now();
    const threadLimit = Math.max(Number(options.limit || 50) * 2, 50);
    const profile = await fetchProfile();
    const accountEmail = normalizeEmail(profile?.emailAddress);
    const threads = await fetchThreads(String(options.query || ''), threadLimit);
    const threadDetails = await fetchThreadDetails(threads.map((thread) => thread.id).filter(Boolean));
    const messages = threadDetails
      .flatMap((thread) => Array.isArray(thread?.messages) ? thread.messages : [])
      .map((message) => normalizeMessage(message, accountEmail))
      .sort(byDateDesc);
    const historyIds = threadDetails
      .flatMap((thread) => Array.isArray(thread?.messages) ? thread.messages : [])
      .map((message) => Number(message?.historyId || 0))
      .filter((value) => Number.isFinite(value) && value > 0);
    const lastHistoryId = historyIds.length ? String(Math.max(...historyIds)) : String(profile?.historyId || '');

    await replaceMessages(messages);
    await metaSetMany([
      [META_KEYS.accountEmail, accountEmail],
      [META_KEYS.grantedScopes, [GMAIL_SCOPE]],
      [META_KEYS.lastHistoryId, lastHistoryId],
      [META_KEYS.lastSyncTime, nowIso()],
      [META_KEYS.lastFullSyncAt, Date.now()]
    ]);

    const coverage = contentCoverage(messages);
    return {
      accountEmail,
      messages,
      lastHistoryId,
      lastSyncTime: nowIso(),
      timings: timingEnvelope(startedAt, { imap_fetch_ms: Date.now() - startedAt }),
      debug: debugEnvelope('live', {
        ...coverage,
        newestCachedAt: nowIso(),
        limitPerFolder: threadLimit
      })
    };
  }

  async function readCachedMailbox() {
    const startedAt = Date.now();
    const [messages, accountEmail, lastHistoryId, lastSyncTime, lastFullSyncAt] = await Promise.all([
      listMessages(),
      metaGet(META_KEYS.accountEmail, ''),
      metaGet(META_KEYS.lastHistoryId, ''),
      metaGet(META_KEYS.lastSyncTime, ''),
      metaGet(META_KEYS.lastFullSyncAt, 0)
    ]);

    return {
      messages: messages.sort(byDateDesc),
      accountEmail: normalizeEmail(accountEmail),
      lastHistoryId: String(lastHistoryId || ''),
      lastSyncTime: typeof lastSyncTime === 'string' ? lastSyncTime : '',
      lastFullSyncAt: Number(lastFullSyncAt || 0),
      timings: timingEnvelope(startedAt, { cache_read_ms: Date.now() - startedAt })
    };
  }

  async function ensureFreshMailbox(options = {}) {
    const cached = await readCachedMailbox();
    const useCache = !options.forceSync && cached.messages.length > 0 && (Date.now() - cached.lastFullSyncAt) < CACHE_TTL_MS;
    if (useCache) {
      return {
        ...cached,
        debug: debugEnvelope('cache', {
          ...contentCoverage(cached.messages),
          newestCachedAt: cached.lastSyncTime || null
        }),
        source: 'gmail_api_local_cache'
      };
    }

    const refreshed = await fullRefresh(options);
    return {
      ...refreshed,
      source: 'gmail_api_local'
    };
  }

  async function connect() {
    if (!oauthClientConfigured()) {
      const error = new Error('Mailita OAuth is not configured in manifest.json yet.');
      error.code = 'OAUTH_NOT_CONFIGURED';
      throw error;
    }

    const auth = await getAuthToken(true);
    if (!auth.token) {
      const error = new Error('Google did not return an OAuth token.');
      error.code = 'AUTH_FAILED';
      throw error;
    }

    const profile = await fetchProfile();
    const accountEmail = normalizeEmail(profile?.emailAddress);

    await metaSetMany([
      [META_KEYS.accountEmail, accountEmail],
      [META_KEYS.grantedScopes, auth.grantedScopes],
      [META_KEYS.lastHistoryId, String(profile?.historyId || '')],
      [META_KEYS.lastSyncTime, ''],
      [META_KEYS.lastFullSyncAt, 0]
    ]);

    return {
      accountEmail,
      grantedScopes: auth.grantedScopes,
      lastHistoryId: String(profile?.historyId || '')
    };
  }

  async function disconnect() {
    await clearCachedTokens();
    await clearAll();
  }

  async function loadSummaries(options = {}) {
    const mailbox = await ensureFreshMailbox(options);
    const summaries = buildContactSummaries(mailbox.messages, Number(options.limit || 50));
    return {
      accountEmail: mailbox.accountEmail,
      summaries,
      count: summaries.length,
      source: mailbox.source,
      debug: mailbox.debug,
      timings: mailbox.timings
    };
  }

  async function loadContact(options = {}) {
    const targetEmail = normalizeEmail(options.contactEmail);
    let cached = await readCachedMailbox();
    let matches = cached.messages.filter((message) => messageMatchesContact(message, targetEmail));

    if ((!matches.length || options.forceSync) && targetEmail) {
      const refreshed = await fullRefresh({
        query: `from:${targetEmail} OR to:${targetEmail}`,
        limit: Math.max(Number(options.limitPerFolder || 25), 20),
        forceSync: true
      });
      cached = refreshed;
      matches = refreshed.messages.filter((message) => messageMatchesContact(message, targetEmail));
    }

    return {
      messages: matches.sort(byDateDesc),
      count: matches.length,
      source: 'gmail_api_local_contact',
      timings: cached.timings || timingEnvelope(Date.now()),
      debug: cached.debug || debugEnvelope('cache', contentCoverage(matches))
    };
  }

  async function search(options = {}) {
    const query = String(options.query || '').trim();
    if (!query) {
      return {
        messages: [],
        count: 0,
        source: 'gmail_api_local_search',
        timings: timingEnvelope(Date.now())
      };
    }

    const refreshed = await fullRefresh({
      query,
      limit: Math.max(Number(options.limit || 20), 20),
      forceSync: true
    });
    const messages = refreshed.messages.sort(byDateDesc).slice(0, Number(options.limit || 20));
    await mergeMessages(messages);

    return {
      messages,
      count: messages.length,
      source: 'gmail_api_local_search',
      timings: refreshed.timings,
      debug: refreshed.debug
    };
  }

  async function refreshIncremental(options = {}) {
    const cached = await readCachedMailbox();

    if (options.forceSync || !cached.lastHistoryId) {
      const refreshed = await fullRefresh({ limit: Number(options.limit || 50), forceSync: true });
      return {
        changed: true,
        fullResync: true,
        messages: refreshed.messages,
        lastHistoryId: refreshed.lastHistoryId,
        lastSyncTime: refreshed.lastSyncTime
      };
    }

    try {
      const history = await fetchHistory(cached.lastHistoryId);
      const nextHistoryId = String(history?.historyId || cached.lastHistoryId || '');
      const entries = Array.isArray(history?.history) ? history.history : [];
      if (!entries.length) {
        await metaSetMany([
          [META_KEYS.lastHistoryId, nextHistoryId],
          [META_KEYS.lastSyncTime, nowIso()]
        ]);
        return {
          changed: false,
          fullResync: false,
          messages: cached.messages,
          lastHistoryId: nextHistoryId,
          lastSyncTime: nowIso()
        };
      }

      const refreshed = await fullRefresh({ limit: Number(options.limit || 50), forceSync: true });
      return {
        changed: true,
        fullResync: false,
        messages: refreshed.messages,
        lastHistoryId: refreshed.lastHistoryId,
        lastSyncTime: refreshed.lastSyncTime
      };
    } catch (error) {
      if (Number(error?.status) === 404) {
        const refreshed = await fullRefresh({ limit: Number(options.limit || 50), forceSync: true });
        return {
          changed: true,
          fullResync: true,
          messages: refreshed.messages,
          lastHistoryId: refreshed.lastHistoryId,
          lastSyncTime: refreshed.lastSyncTime
        };
      }
      throw error;
    }
  }

  async function snapshot() {
    const [accountEmail, grantedScopes, lastHistoryId, lastSyncTime] = await Promise.all([
      metaGet(META_KEYS.accountEmail, ''),
      metaGet(META_KEYS.grantedScopes, []),
      metaGet(META_KEYS.lastHistoryId, ''),
      metaGet(META_KEYS.lastSyncTime, '')
    ]);

    return {
      accountEmail: normalizeEmail(accountEmail),
      grantedScopes: Array.isArray(grantedScopes) ? grantedScopes : [],
      lastHistoryId: String(lastHistoryId || ''),
      lastSyncTime: typeof lastSyncTime === 'string' ? lastSyncTime : ''
    };
  }

  globalScope.MailitaGmailLocal = {
    GMAIL_SCOPE,
    oauthClientConfigured,
    connect,
    disconnect,
    loadSummaries,
    loadContact,
    search,
    refreshIncremental,
    snapshot
  };
})(self);
