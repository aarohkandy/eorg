/* global chrome, indexedDB */

(function initMailitaGmailLocal(globalScope) {
  const GMAIL_READ_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
  const GMAIL_SEND_SCOPE = 'https://www.googleapis.com/auth/gmail.send';
  const GMAIL_API_CONCURRENCY = 2;
  const GMAIL_SCOPE = GMAIL_READ_SCOPE;
  const API_ROOT = 'https://www.googleapis.com/gmail/v1/users/me';
  const GMAIL_API_TIMEOUT_MS = 20000;
  const DB_NAME = 'mailita-local-cache';
  const DB_VERSION = 1;
  const MESSAGE_STORE = 'messages';
  const META_STORE = 'meta';
  const META_KEYS = {
    accountEmail: 'accountEmail',
    grantedScopes: 'grantedScopes',
    lastHistoryId: 'lastHistoryId',
    lastSyncTime: 'lastSyncTime',
    lastFullSyncAt: 'lastFullSyncAt',
    summaryNextCursor: 'summaryNextCursor'
  };
  const CACHE_TTL_MS = 90 * 1000;
  const PERSONAL_EMAIL_DOMAINS = new Set([
    'gmail.com',
    'googlemail.com',
    'yahoo.com',
    'outlook.com',
    'hotmail.com',
    'icloud.com',
    'me.com',
    'live.com',
    'aol.com',
    'proton.me',
    'protonmail.com',
    'hey.com'
  ]);
  const GENERIC_LOCAL_PARTS = new Set([
    'admin',
    'alerts',
    'billing',
    'help',
    'hello',
    'hi',
    'info',
    'mail',
    'news',
    'noreply',
    'no-reply',
    'notifications',
    'notify',
    'orders',
    'receipts',
    'reply',
    'security',
    'support',
    'team',
    'updates'
  ]);

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

  function uniqueScopes(...groups) {
    return [...new Set(groups.flat().filter(Boolean).map((scope) => String(scope).trim()).filter(Boolean))];
  }

  function assignErrorDetails(error, extras = {}) {
    Object.entries(extras).forEach(([key, value]) => {
      if (value == null || value === '') return;
      error[key] = value;
    });
    return error;
  }

  function bindAbortSignal(signal, controller) {
    if (!signal || typeof signal.addEventListener !== 'function') {
      return () => {};
    }
    if (signal.aborted) {
      try {
        controller.abort(signal.reason);
      } catch {
        controller.abort();
      }
      return () => {};
    }
    const onAbort = () => {
      try {
        controller.abort(signal.reason);
      } catch {
        controller.abort();
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });
    return () => signal.removeEventListener('abort', onAbort);
  }

  function emailLocalPart(value) {
    return normalizeEmail(value).split('@')[0] || '';
  }

  function domainFromEmail(value) {
    return normalizeEmail(value).split('@')[1] || '';
  }

  function registrableDomain(domain) {
    const parts = String(domain || '').trim().toLowerCase().split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    const tld = parts[parts.length - 1];
    const second = parts[parts.length - 2];
    if (tld.length === 2 && second.length <= 3 && parts.length >= 3) {
      return parts.slice(-3).join('.');
    }
    return parts.slice(-2).join('.');
  }

  function registrableDomainFromEmail(value) {
    return registrableDomain(domainFromEmail(value));
  }

  function titleCaseLabel(value) {
    return String(value || '')
      .split(/[\s._-]+/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ')
      .trim();
  }

  function domainBrandLabel(domain) {
    const registrable = registrableDomain(domain);
    const root = registrable.split('.')[0] || registrable;
    return titleCaseLabel(root);
  }

  function normalizeNameSignature(value) {
    return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  function looksHumanName(value) {
    const tokens = String(value || '').trim().split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return false;
    return tokens.every((token) => /^[A-Za-z][A-Za-z'.-]*$/.test(token));
  }

  function isGenericMailbox(email) {
    const local = emailLocalPart(email);
    if (!local) return false;
    if (GENERIC_LOCAL_PARTS.has(local)) return true;
    return /^(?:no[-_.]?reply|support|security|alerts?|billing|receipts?|team|help|update|notification)s?/.test(local);
  }

  function shouldGroupAsOrganization(email, name) {
    const domain = registrableDomainFromEmail(email);
    if (!domain || PERSONAL_EMAIL_DOMAINS.has(domain)) return false;
    if (looksHumanName(name)) return false;

    const brand = normalizeNameSignature(domainBrandLabel(domain));
    const normalizedName = normalizeNameSignature(name);

    if (isGenericMailbox(email)) return true;
    if (!normalizedName) return true;
    if (normalizedName === brand) return true;
    if (brand && (normalizedName.includes(brand) || brand.includes(normalizedName))) return true;
    return false;
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
      const groupedAsOrganization = shouldGroupAsOrganization(email, name);
      const orgDomain = registrableDomainFromEmail(email);
      return {
        contactKey: groupedAsOrganization && orgDomain ? `org:${orgDomain}` : contactKeyFromIdentity({ email, name }),
        contactEmail: email,
        contactName: groupedAsOrganization && orgDomain
          ? (name || domainBrandLabel(orgDomain) || email || 'Unknown contact')
          : (name || email || 'Unknown contact'),
        contactKind: groupedAsOrganization ? 'organization' : 'person',
        contactDomain: orgDomain
      };
    }

    const email = normalizeEmail(from?.email);
    const name = String(from?.name || '').trim();
    const groupedAsOrganization = shouldGroupAsOrganization(email, name);
    const orgDomain = registrableDomainFromEmail(email);
    return {
      contactKey: groupedAsOrganization && orgDomain ? `org:${orgDomain}` : contactKeyFromIdentity({ email, name }),
      contactEmail: email,
      contactName: groupedAsOrganization && orgDomain
        ? (name || domainBrandLabel(orgDomain) || email || 'Unknown contact')
        : (name || email || 'Unknown contact'),
      contactKind: groupedAsOrganization ? 'organization' : 'person',
      contactDomain: orgDomain
    };
  }

  function messageMatchesContact(message, contactEmail, contactKey) {
    const targetKey = String(contactKey || '').trim();
    if (targetKey && String(message?.contactKey || '').trim() === targetKey) {
      return true;
    }

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

  function previewTextFromMessage(message) {
    const source = String(message?.bodyText || message?.snippet || message?.subject || '').replace(/\s+/g, ' ').trim();
    if (!source) return '(no preview)';

    const cleaned = source
      .replace(/https?:\/\/\S+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '(no preview)';

    const sentence = cleaned.split(/(?<=[.!?])\s+/).find((part) => part.length >= 18) || cleaned;
    return sentence.slice(0, 140).trim();
  }

  function gmailQueryForContact(contactEmail, contactKey) {
    const targetKey = String(contactKey || '').trim();
    if (targetKey.startsWith('org:')) {
      const domain = targetKey.slice('org:'.length).trim();
      if (domain) return `from:${domain} OR to:${domain}`;
    }

    const email = normalizeEmail(contactEmail);
    if (email) return `from:${email} OR to:${email}`;
    return '';
  }

  function scopeQuery(scope) {
    if (scope === 'sent') return 'in:sent';
    if (scope === 'inbox') return '-in:sent';
    return '';
  }

  function mergeQueries(...parts) {
    return parts
      .map((part) => String(part || '').trim())
      .filter(Boolean)
      .join(' ');
  }

  function filterMessagesByScope(messages, scope) {
    const list = Array.isArray(messages) ? messages : [];
    if (scope === 'sent') return list.filter((message) => Boolean(message?.isOutgoing));
    if (scope === 'inbox') return list.filter((message) => !message?.isOutgoing);
    return list;
  }

  function dedupeRecipients(entries) {
    const map = new Map();
    (Array.isArray(entries) ? entries : []).forEach((entry) => {
      const email = normalizeEmail(entry?.email);
      if (!email || map.has(email)) return;
      map.set(email, {
        email,
        name: String(entry?.name || '').trim()
      });
    });
    return [...map.values()];
  }

  function sanitizeHeaderValue(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim();
  }

  function encodeBase64UrlUtf8(value) {
    const bytes = new TextEncoder().encode(String(value || ''));
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function buildReplyReferences(message) {
    const references = sanitizeHeaderValue(message?.references || '');
    const messageId = sanitizeHeaderValue(message?.rfcMessageId || '');
    if (references && messageId && references.includes(messageId)) return references;
    if (references && messageId) return `${references} ${messageId}`;
    return references || messageId;
  }

  function formatRecipientHeader(entries) {
    return dedupeRecipients(entries)
      .map((entry) => (entry.name ? `${sanitizeHeaderValue(entry.name)} <${entry.email}>` : entry.email))
      .join(', ');
  }

  function buildRawMimeMessage(payload) {
    const lines = [];
    const to = formatRecipientHeader(payload.to);
    const cc = formatRecipientHeader(payload.cc);
    const bcc = formatRecipientHeader(payload.bcc);

    if (to) lines.push(`To: ${to}`);
    if (cc) lines.push(`Cc: ${cc}`);
    if (bcc) lines.push(`Bcc: ${bcc}`);
    lines.push(`Subject: ${sanitizeHeaderValue(payload.subject)}`);
    if (payload.inReplyTo) lines.push(`In-Reply-To: ${sanitizeHeaderValue(payload.inReplyTo)}`);
    if (payload.references) lines.push(`References: ${sanitizeHeaderValue(payload.references)}`);
    lines.push('MIME-Version: 1.0');
    lines.push('Content-Type: text/plain; charset="UTF-8"');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(String(payload.bodyText || '').replace(/\r?\n/g, '\r\n'));
    return encodeBase64UrlUtf8(lines.join('\r\n'));
  }

  function normalizeMessage(message, accountEmail, options = {}) {
    const payload = message?.payload || {};
    const headers = Array.isArray(payload.headers) ? payload.headers : [];
    const from = parseAddressList(headerValue(headers, 'From'))[0] || { name: '', email: '' };
    const to = parseAddressList(headerValue(headers, 'To'));
    const cc = parseAddressList(headerValue(headers, 'Cc'));
    const replyTo = parseAddressList(headerValue(headers, 'Reply-To'))[0] || null;
    const subject = headerValue(headers, 'Subject') || '(no subject)';
    const labelIds = Array.isArray(message?.labelIds) ? message.labelIds : [];
    const isOutgoing = labelIds.includes('SENT') || normalizeEmail(from.email) === normalizeEmail(accountEmail);
    const contactIdentity = buildContactIdentity(from, to, isOutgoing);
    const contentState = options.contentState === 'metadata' ? 'metadata' : 'full';
    const bodies = contentState === 'metadata'
      ? {
        bodyText: '',
        bodyHtml: '',
        bodyFormat: 'text',
        hasRemoteImages: false,
        hasLinkedImages: false
      }
      : extractBodyFromPayload(payload);
    const date = safeDate(message?.internalDate || headerValue(headers, 'Date'));
    const receivedAtMs = Number(Date.parse(date)) || 0;

    return {
      id: `gmail-${message.id}`,
      uid: null,
      messageId: message?.id || '',
      rfcMessageId: sanitizeHeaderValue(headerValue(headers, 'Message-ID')),
      references: sanitizeHeaderValue(headerValue(headers, 'References')),
      inReplyTo: sanitizeHeaderValue(headerValue(headers, 'In-Reply-To')),
      subject,
      from,
      to,
      cc,
      replyTo,
      date,
      receivedAtMs,
      snippet: String(message?.snippet || '').trim(),
      bodyText: contentState === 'metadata' ? '' : (bodies.bodyText || String(message?.snippet || '').trim()),
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
      contactKind: contactIdentity.contactKind,
      contactDomain: contactIdentity.contactDomain,
      flags: flagsFromLabels(labelIds),
      historyId: String(message?.historyId || ''),
      contentState
    };
  }

  function messageTimeMs(message) {
    const parsed = Number(message?.receivedAtMs || 0);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return new Date(message?.date || 0).getTime();
  }

  function byDateDesc(a, b) {
    return messageTimeMs(b) - messageTimeMs(a);
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
          latestReceivedAtMs: messageTimeMs(message),
          latestDirection: message?.isOutgoing ? 'outgoing' : 'incoming',
          latestMessageId: message?.messageId || message?.id || '',
          latestPreview: previewTextFromMessage(message),
          messageCount: 0,
          unreadCount: 0,
          hasMissingContent: false,
          inboxCount: 0,
          sentCount: 0,
          threadIds: new Set(),
          contactKind: String(message?.contactKind || 'person'),
          contactDomain: String(message?.contactDomain || '')
        });
      }

      const summary = map.get(contactKey);
      summary.messageCount += 1;
      if (message?.threadId) summary.threadIds.add(String(message.threadId));
      if (message?.folder === 'INBOX') summary.inboxCount += 1;
      if (message?.folder === 'SENT') summary.sentCount += 1;
      if (!(Array.isArray(message?.flags) ? message.flags : []).includes('\\Seen')) {
        summary.unreadCount += 1;
      }
      if (!String(message?.bodyText || message?.snippet || '').trim() && !String(message?.bodyHtml || '').trim()) {
        summary.hasMissingContent = true;
      }

      const currentLatest = Number(summary.latestReceivedAtMs || 0) || new Date(summary.latestDate).getTime();
      const candidateDate = messageTimeMs(message);
      if (!Number.isFinite(currentLatest) || candidateDate >= currentLatest) {
        summary.latestSubject = message?.subject || '(no subject)';
        summary.latestDate = message?.date || summary.latestDate;
        summary.latestReceivedAtMs = candidateDate;
        summary.latestDirection = message?.isOutgoing ? 'outgoing' : 'incoming';
        summary.latestMessageId = message?.messageId || message?.id || summary.latestMessageId;
        summary.latestPreview = previewTextFromMessage(message);
        summary.displayName = String(message?.contactName || message?.contactEmail || summary.displayName).trim();
        summary.contactEmail = normalizeEmail(message?.contactEmail) || summary.contactEmail;
        summary.contactKind = String(message?.contactKind || summary.contactKind || 'person');
        summary.contactDomain = String(message?.contactDomain || summary.contactDomain || '');
      }
    });

    return [...map.values()]
      .map((summary) => {
        const { threadIds, ...rest } = summary;
        return {
          ...rest,
          threadCount: threadIds.size
        };
      })
      .sort((a, b) => (Number(b.latestReceivedAtMs || 0) || new Date(b.latestDate).getTime()) - (Number(a.latestReceivedAtMs || 0) || new Date(a.latestDate).getTime()))
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
        pageCount: Number(counts.pageCount || 0),
        loadedCount: Number(counts.loadedCount || 0),
        nextCursor: String(counts.nextCursor || ''),
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

  function summaryDebugEnvelope(mode, messages, extra = {}) {
    const coverage = contentCoverage(messages);
    return debugEnvelope(mode, {
      ...coverage,
      newestCachedAt: extra.newestCachedAt || null,
      limitPerFolder: Number(extra.limitPerFolder || 0),
      pageCount: Number(extra.pageCount || 0),
      loadedCount: Number(extra.loadedCount || 0),
      nextCursor: extra.nextCursor || '',
      cacheMessageCount: Number(extra.cacheMessageCount || 0)
    });
  }

  async function persistGrantedScopes(scopes) {
    try {
      const existing = await metaGet(META_KEYS.grantedScopes, []);
      await metaSet(META_KEYS.grantedScopes, uniqueScopes(existing, scopes));
    } catch {
      // Do not block auth if IndexedDB is temporarily unavailable.
    }
  }

  async function getAuthToken(interactive = false, scopes = [GMAIL_READ_SCOPE]) {
    const requestedScopes = uniqueScopes(scopes);
    const result = await chrome.identity.getAuthToken({
      interactive,
      scopes: requestedScopes,
      enableGranularPermissions: true
    });

    const grantedScopes = typeof result === 'string'
      ? requestedScopes
      : (
        Array.isArray(result?.grantedScopes) && result.grantedScopes.length
          ? result.grantedScopes
          : requestedScopes
      );
    await persistGrantedScopes(grantedScopes);

    if (typeof result === 'string') {
      return { token: result, grantedScopes };
    }

    return {
      token: String(result?.token || ''),
      grantedScopes
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
    const requestedScopes = uniqueScopes(options.scopes && options.scopes.length ? options.scopes : [GMAIL_READ_SCOPE]);
    const auth = await getAuthToken(attempt === 0 && Boolean(options.interactive), requestedScopes);
    if (!auth.token) {
      throw new Error('OAuth token was not returned by chrome.identity.');
    }

    try {
      await metaSet('lastToken', auth.token);
    } catch {
      // Do not block Gmail API requests on cache persistence.
    }

    const controller = new AbortController();
    const timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Number(options.timeoutMs)
      : GMAIL_API_TIMEOUT_MS;
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
    const unbindAbort = bindAbortSignal(options.signal, controller);

    let response;
    try {
      response = await fetch(`${API_ROOT}${path}`, {
        method: options.method || 'GET',
        headers: {
          Authorization: `Bearer ${auth.token}`,
          ...(options.headers || {})
        },
        body: options.body,
        signal: controller.signal
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        if (options.signal?.aborted && !timedOut) {
          throw assignErrorDetails(
            new Error('Gmail API request was aborted.'),
            {
              code: 'GMAIL_API_ABORTED',
              path
            }
          );
        }
        throw assignErrorDetails(
          new Error(`Gmail API request timed out after ${Math.round(timeoutMs / 1000)} seconds.`),
          {
            code: 'GMAIL_API_TIMEOUT',
            path,
            timeoutMs
          }
        );
      }
      throw assignErrorDetails(error instanceof Error ? error : new Error(String(error || 'Gmail API request failed.')), {
        path
      });
    } finally {
      clearTimeout(timeoutId);
      unbindAbort();
    }

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

  async function fetchThreadsPage(query, limit, pageToken = '', interactive = false, options = {}) {
    const params = new URLSearchParams({
      maxResults: String(limit)
    });
    if (query) params.set('q', query);
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetchJson(`/threads?${params.toString()}`, {
      interactive,
      signal: options.signal
    });
    if (!response.ok) {
      throw assignErrorDetails(
        new Error(response?.data?.error?.message || `Gmail threads list failed with HTTP ${response.status}.`),
        {
          status: response.status,
          stage: 'threads_list',
          path: `/threads?${params.toString()}`
        }
      );
    }

    return {
      threads: Array.isArray(response.data?.threads) ? response.data.threads : [],
      nextPageToken: String(response.data?.nextPageToken || '')
    };
  }

  async function fetchThreads(query, limit, interactive = false, options = {}) {
    const page = await fetchThreadsPage(query, limit, '', interactive, options);
    return page.threads;
  }

  async function mapWithConcurrency(items, limit, task, options = {}) {
    const results = [];
    let nextIndex = 0;

    async function worker() {
      while (nextIndex < items.length) {
        if (options.signal?.aborted) {
          throw assignErrorDetails(new Error('Parallel Gmail task aborted.'), {
            code: 'GMAIL_API_ABORTED'
          });
        }
        const index = nextIndex++;
        results[index] = await task(items[index], index);
      }
    }

    const workers = Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, () => worker());
    await Promise.all(workers);
    return results;
  }

  async function fetchThreadDetails(threadIds, metadataOnly = false, options = {}) {
    const failures = [];
    const threads = await mapWithConcurrency(threadIds, GMAIL_API_CONCURRENCY, async (threadId) => {
      try {
        const params = new URLSearchParams({
          format: metadataOnly ? 'metadata' : 'full'
        });
        if (metadataOnly) {
          [
            'From',
            'To',
            'Date',
            'Subject',
            'Message-ID',
            'In-Reply-To',
            'References'
          ].forEach((header) => params.append('metadataHeaders', header));
        }
        const path = `/threads/${threadId}?${params.toString()}`;
        const response = await fetchJson(path, {
          interactive: false,
          signal: options.signal
        });
        if (!response.ok) {
          throw assignErrorDetails(
            new Error(response?.data?.error?.message || `Gmail thread fetch failed with HTTP ${response.status}.`),
            {
              status: response.status,
              stage: 'thread_detail',
              path,
              threadId
            }
          );
        }
        return response.data;
      } catch (error) {
        failures.push({
          threadId,
          code: error?.code || '',
          status: Number(error?.status || 0) || undefined,
          stage: error?.stage || 'thread_detail',
          message: error?.message || 'Unknown thread detail failure.'
        });
        return null;
      }
    }, { signal: options.signal });

    const resolved = threads.filter(Boolean);
    if (!resolved.length && failures.length) {
      const first = failures[0];
      throw assignErrorDetails(new Error(first.message || 'Gmail thread fetch failed.'), {
        code: first.code || 'GMAIL_THREAD_FETCH_FAILED',
        status: first.status,
        stage: first.stage,
        threadId: first.threadId
      });
    }

    return resolved;
  }

  async function fetchMessageDetails(messageIds, options = {}) {
    const failures = [];
    const resolvedIds = [...new Set((Array.isArray(messageIds) ? messageIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
    const messages = await mapWithConcurrency(resolvedIds, GMAIL_API_CONCURRENCY, async (messageId) => {
      try {
        const path = `/messages/${messageId}?format=full`;
        const response = await fetchJson(path, {
          interactive: false,
          signal: options.signal
        });
        if (!response.ok) {
          throw assignErrorDetails(
            new Error(response?.data?.error?.message || `Gmail message fetch failed with HTTP ${response.status}.`),
            {
              status: response.status,
              stage: 'message_detail',
              path,
              messageId
            }
          );
        }
        return response.data;
      } catch (error) {
        failures.push({
          messageId,
          code: error?.code || '',
          status: Number(error?.status || 0) || undefined,
          stage: error?.stage || 'message_detail',
          message: error?.message || 'Unknown message detail failure.'
        });
        return null;
      }
    }, { signal: options.signal });

    const resolved = messages.filter(Boolean);
    if (!resolved.length && failures.length) {
      const first = failures[0];
      throw assignErrorDetails(new Error(first.message || 'Gmail message fetch failed.'), {
        code: first.code || 'GMAIL_MESSAGE_FETCH_FAILED',
        status: first.status,
        stage: first.stage,
        messageId: first.messageId
      });
    }

    return resolved;
  }

  async function fetchProfile(interactive = false) {
    const response = await fetchJson('/profile', { interactive });
    if (!response.ok) {
      throw assignErrorDetails(
        new Error(response?.data?.error?.message || `Gmail profile fetch failed with HTTP ${response.status}.`),
        {
          status: response.status,
          stage: 'profile',
          path: '/profile'
        }
      );
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

  async function fetchMessagesForQuery(query, limit) {
    const startedAt = Date.now();
    const threadLimit = Math.max(Number(limit || 20), 20);
    const profile = await fetchProfile(false);
    const accountEmail = normalizeEmail(profile?.emailAddress);
    const threads = await fetchThreads(String(query || ''), threadLimit, false);
    const threadDetails = await fetchThreadDetails(threads.map((thread) => thread.id).filter(Boolean));
    const messages = threadDetails
      .flatMap((thread) => Array.isArray(thread?.messages) ? thread.messages : [])
      .map((message) => normalizeMessage(message, accountEmail))
      .sort(byDateDesc);

    return {
      accountEmail,
      messages,
      timings: timingEnvelope(startedAt, { imap_fetch_ms: Date.now() - startedAt }),
      debug: debugEnvelope('live', {
        ...contentCoverage(messages),
        newestCachedAt: nowIso(),
        limitPerFolder: threadLimit
      })
    };
  }

  async function fullRefresh(options = {}) {
    const startedAt = Date.now();
    const threadLimit = Math.max(Number(options.limit || 50), 20);
    const cached = await readCachedMailbox().catch(() => ({
      messages: [],
      accountEmail: '',
      lastHistoryId: '',
      lastSyncTime: '',
      lastFullSyncAt: 0
    }));
    const profile = await fetchProfile(false);
    const accountEmail = normalizeEmail(profile?.emailAddress || cached.accountEmail);
    const threads = await fetchThreads(String(options.query || ''), threadLimit, false);
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

    const existingScopes = await metaGet(META_KEYS.grantedScopes, []).catch(() => []);
    const lastSyncTime = nowIso();
    const shouldKeepCachedMessages = !messages.length && cached.messages.length > 0;
    const finalMessages = shouldKeepCachedMessages ? cached.messages : messages;

    try {
      if (!shouldKeepCachedMessages) {
        await replaceMessages(finalMessages);
      }
      await metaSetMany([
        [META_KEYS.accountEmail, accountEmail],
        [META_KEYS.grantedScopes, uniqueScopes(existingScopes, [GMAIL_READ_SCOPE])],
        [META_KEYS.lastHistoryId, lastHistoryId],
        [META_KEYS.lastSyncTime, lastSyncTime],
        [META_KEYS.lastFullSyncAt, Date.now()]
      ]);
    } catch {
      // Do not block live data from returning if cache persistence fails.
    }

    const coverage = contentCoverage(finalMessages);
    return {
      accountEmail,
      messages: finalMessages,
      lastHistoryId,
      lastSyncTime,
      timings: timingEnvelope(startedAt, { imap_fetch_ms: Date.now() - startedAt }),
      debug: debugEnvelope('live', {
        ...coverage,
        newestCachedAt: lastSyncTime,
        limitPerFolder: threadLimit,
        usedCachedMessages: shouldKeepCachedMessages
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
    const cached = await readCachedMailbox().catch(() => ({
      messages: [],
      accountEmail: '',
      lastHistoryId: '',
      lastSyncTime: '',
      lastFullSyncAt: 0,
      timings: timingEnvelope(Date.now(), { cache_read_ms: 0 })
    }));
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

    let refreshed;
    try {
      refreshed = await fullRefresh(options);
    } catch (error) {
      if (cached.messages.length) {
        return {
          ...cached,
          debug: debugEnvelope('stale-cache', {
            ...contentCoverage(cached.messages),
            newestCachedAt: cached.lastSyncTime || null,
            refreshError: error?.message || 'Unknown refresh failure.'
          }),
          source: 'gmail_api_local_stale_cache'
        };
      }
      throw error;
    }
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

    const auth = await getAuthToken(true, [GMAIL_READ_SCOPE, GMAIL_SEND_SCOPE]);
    if (!auth.token) {
      const error = new Error('Google did not return an OAuth token.');
      error.code = 'AUTH_FAILED';
      throw error;
    }

    const profile = await fetchProfile(false);
    const accountEmail = normalizeEmail(profile?.emailAddress);
    if (!accountEmail) {
      const error = new Error('Google did not return the Gmail account address.');
      error.code = 'AUTH_FAILED';
      throw error;
    }

    try {
      await metaSetMany([
        [META_KEYS.accountEmail, accountEmail],
        [META_KEYS.grantedScopes, auth.grantedScopes],
        [META_KEYS.lastHistoryId, String(profile?.historyId || '')],
        [META_KEYS.lastSyncTime, ''],
        [META_KEYS.lastFullSyncAt, 0]
      ]);
    } catch {
      // Allow successful OAuth to continue even if cache initialization is unavailable.
    }

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
    const startedAt = Date.now();
    const folder = ['all', 'inbox', 'sent'].includes(options.folder) ? options.folder : 'all';
    const limit = Math.max(Number(options.limit || 50), 20);
    const cursor = String(options.cursor || '').trim();
    const append = Boolean(options.append);
    const bootstrapCacheOnly = Boolean(options.bootstrapCacheOnly) && !cursor;
    const query = scopeQuery(folder);
    const cached = await readCachedMailbox().catch(() => ({
      messages: [],
      accountEmail: '',
      lastHistoryId: '',
      lastSyncTime: '',
      lastFullSyncAt: 0,
      timings: timingEnvelope(Date.now(), { cache_read_ms: 0 })
    }));

    if (bootstrapCacheOnly) {
      const fallbackNextCursor = await metaGet(META_KEYS.summaryNextCursor, '').catch(() => '');
      const cachedScopedMessages = filterMessagesByScope(cached.messages, folder);
      const summaries = buildContactSummaries(cachedScopedMessages, limit);
      return {
        accountEmail: cached.accountEmail,
        summaries,
        count: summaries.length,
        loadedCount: Math.min(cachedScopedMessages.length, limit),
        nextCursor: String(fallbackNextCursor || ''),
        hasMore: Boolean(fallbackNextCursor),
        source: 'gmail_api_local_summary_bootstrap',
        debug: summaryDebugEnvelope('cache', cachedScopedMessages, {
          newestCachedAt: cached.lastSyncTime || null,
          limitPerFolder: limit,
          pageCount: summaries.length,
          loadedCount: Math.min(cachedScopedMessages.length, limit),
          nextCursor: String(fallbackNextCursor || ''),
          cacheMessageCount: cached.messages.length
        }),
        timings: cached.timings || timingEnvelope(startedAt, { cache_read_ms: 0 })
      };
    }

    try {
      const accountEmail = normalizeEmail(cached.accountEmail || (await fetchProfile(false))?.emailAddress);
      const page = await fetchThreadsPage(query, limit, cursor, false);
      const threadDetails = await fetchThreadDetails(page.threads.map((thread) => thread.id).filter(Boolean));
      const pageMessages = filterMessagesByScope(threadDetails
        .flatMap((thread) => Array.isArray(thread?.messages) ? thread.messages : [])
        .map((message) => normalizeMessage(message, accountEmail))
        .sort(byDateDesc), folder);

      if (pageMessages.length) {
        await mergeMessages(pageMessages);
      }

      const nextCursor = String(page.nextPageToken || '');
      try {
        await metaSet(META_KEYS.summaryNextCursor, nextCursor);
      } catch {
        // Cursor persistence is opportunistic.
      }

      const summaries = buildContactSummaries(pageMessages, limit);
      const lastSyncTime = nowIso();
      return {
        accountEmail,
        summaries,
        count: summaries.length,
        loadedCount: pageMessages.length,
        nextCursor,
        hasMore: Boolean(nextCursor),
        source: append ? 'gmail_api_local_summary_append' : 'gmail_api_local_summary_page',
        debug: summaryDebugEnvelope('live', pageMessages, {
          newestCachedAt: lastSyncTime,
          limitPerFolder: limit,
          pageCount: summaries.length,
          loadedCount: pageMessages.length,
          nextCursor
        }),
        timings: timingEnvelope(startedAt, {
          cache_read_ms: cached.timings?.cache_read_ms || 0,
          imap_fetch_ms: Date.now() - startedAt
        })
      };
    } catch (error) {
      if (!cursor && cached.messages.length) {
        const fallbackNextCursor = await metaGet(META_KEYS.summaryNextCursor, '').catch(() => '');
        const summaries = buildContactSummaries(filterMessagesByScope(cached.messages, folder), limit);
        return {
          accountEmail: cached.accountEmail,
          summaries,
          count: summaries.length,
          loadedCount: summaries.length,
          nextCursor: String(fallbackNextCursor || ''),
          hasMore: Boolean(fallbackNextCursor),
          source: 'gmail_api_local_summary_cache',
          debug: summaryDebugEnvelope('cache', cached.messages, {
            newestCachedAt: cached.lastSyncTime || null,
            limitPerFolder: limit,
            pageCount: summaries.length,
            loadedCount: summaries.length,
            nextCursor: String(fallbackNextCursor || ''),
            cacheMessageCount: cached.messages.length
          }),
          timings: cached.timings || timingEnvelope(startedAt, { cache_read_ms: 0 })
        };
      }
      throw error;
    }
  }

  async function loadContact(options = {}) {
    const targetKey = String(options.contactKey || '').trim();
    const targetEmail = normalizeEmail(options.contactEmail);
    const scope = ['all', 'inbox', 'sent'].includes(options.scope) ? options.scope : 'all';
    const cursor = String(options.cursor || '').trim();
    const metadataOnly = options.metadataOnly !== false;
    let cached = await readCachedMailbox();
    let matches = filterMessagesByScope(
      cached.messages.filter((message) => messageMatchesContact(message, targetEmail, targetKey)),
      scope
    );

    let nextCursor = '';
    let hasMore = false;

    if ((cursor || !matches.length || options.forceSync) && (targetEmail || targetKey)) {
      const query = mergeQueries(
        gmailQueryForContact(targetEmail, targetKey),
        scopeQuery(scope)
      );
      const page = await fetchThreadsPage(query, 5, cursor, false, {
        signal: options.signal
      });
      const threadDetails = await fetchThreadDetails(
        page.threads.map((thread) => thread.id).filter(Boolean),
        metadataOnly,
        { signal: options.signal }
      );
      const accountEmail = cached.accountEmail || normalizeEmail(await metaGet(META_KEYS.accountEmail, '').catch(() => '')) || normalizeEmail((await fetchProfile(false))?.emailAddress);
      const remoteMessages = threadDetails
        .flatMap((thread) => Array.isArray(thread?.messages) ? thread.messages : [])
        .map((message) => normalizeMessage(message, accountEmail, {
          contentState: metadataOnly ? 'metadata' : 'full'
        }))
        .sort(byDateDesc);

      if (remoteMessages.length) {
        await mergeMessages(remoteMessages);
      }

      cached = await readCachedMailbox();
      matches = filterMessagesByScope(
        cached.messages.filter((message) => messageMatchesContact(message, targetEmail, targetKey)),
        scope
      );
      nextCursor = String(page.nextPageToken || '');
      hasMore = Boolean(nextCursor);
    }

    return {
      messages: matches.sort(byDateDesc),
      count: matches.length,
      nextCursor,
      hasMore,
      source: 'gmail_api_local_contact',
      timings: cached.timings || timingEnvelope(Date.now()),
      debug: cached.debug || debugEnvelope('cache', contentCoverage(matches))
    };
  }

  async function loadContactBodies(options = {}) {
    const startedAt = Date.now();
    const targetKey = String(options.contactKey || '').trim();
    const targetEmail = normalizeEmail(options.contactEmail);
    const requestedIds = [...new Set((Array.isArray(options.messageIds) ? options.messageIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
    if (!requestedIds.length) {
      return {
        messages: [],
        count: 0,
        source: 'gmail_api_local_contact_bodies',
        timings: timingEnvelope(startedAt)
      };
    }

    const cached = await readCachedMailbox().catch(() => ({
      messages: [],
      accountEmail: '',
      lastHistoryId: '',
      lastSyncTime: '',
      lastFullSyncAt: 0,
      timings: timingEnvelope(Date.now(), { cache_read_ms: 0 })
    }));
    const accountEmail = cached.accountEmail || normalizeEmail(await metaGet(META_KEYS.accountEmail, '').catch(() => '')) || normalizeEmail((await fetchProfile(false))?.emailAddress);
    const fullMessages = await fetchMessageDetails(requestedIds, { signal: options.signal });
    const normalized = fullMessages
      .map((message) => normalizeMessage(message, accountEmail, { contentState: 'full' }))
      .filter((message) => {
        if (targetKey && String(message?.contactKey || '').trim() !== targetKey) return false;
        if (targetEmail && normalizeEmail(message?.contactEmail) !== targetEmail) return false;
        return true;
      });

    if (normalized.length) {
      await mergeMessages(normalized);
    }

    return {
      messages: normalized,
      count: normalized.length,
      source: 'gmail_api_local_contact_bodies',
      timings: timingEnvelope(startedAt, {
        cache_read_ms: cached.timings?.cache_read_ms || 0
      })
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

    const refreshed = await fetchMessagesForQuery(query, Math.max(Number(options.limit || 20), 20));
    const messages = refreshed.messages.sort(byDateDesc).slice(0, Number(options.limit || 20));

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

  async function sendMessage(payload = {}) {
    const to = dedupeRecipients(payload.to);
    if (!to.length) {
      const error = new Error('No recipient could be determined for this reply.');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const bodyText = String(payload.bodyText || '').trim();
    if (!bodyText) {
      const error = new Error('Reply body is empty.');
      error.code = 'BAD_REQUEST';
      throw error;
    }

    const raw = buildRawMimeMessage({
      to,
      cc: dedupeRecipients(payload.cc),
      bcc: dedupeRecipients(payload.bcc),
      subject: payload.subject,
      bodyText,
      inReplyTo: payload.inReplyTo,
      references: payload.references
    });

    const response = await fetchJson('/messages/send', {
      method: 'POST',
      interactive: true,
      scopes: [GMAIL_SEND_SCOPE],
      signal: payload.signal,
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        raw,
        threadId: String(payload.threadId || '').trim() || undefined
      })
    });

    if (!response.ok) {
      const error = new Error(response?.data?.error?.message || `Gmail send failed with HTTP ${response.status}.`);
      error.status = response.status;
      if (response.status === 401 || response.status === 403) {
        error.code = 'AUTH_SCOPE_REQUIRED';
      }
      throw error;
    }

    await metaSet(META_KEYS.lastSyncTime, nowIso());
    return {
      id: String(response.data?.id || ''),
      threadId: String(response.data?.threadId || payload.threadId || '')
    };
  }

  globalScope.MailitaGmailLocal = {
    GMAIL_SCOPE,
    GMAIL_READ_SCOPE,
    GMAIL_SEND_SCOPE,
    oauthClientConfigured,
    connect,
    disconnect,
    loadSummaries,
    loadContact,
    loadContactBodies,
    sendMessage,
    search,
    refreshIncremental,
    snapshot
  };
})(self);
