import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseImapError, pushTrace, sanitizeTraceDetails } from './errors.js';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const DEFAULT_HEADER_FIELDS = ['references', 'in-reply-to'];
const DEFAULT_FETCH_FIELDS = [
  'uid',
  'envelope',
  'flags',
  'internalDate',
  'bodyStructure',
  'headers'
];

export const IMAP_PROBE_ATTRIBUTE_SETS = [
  { name: 'uid-only', fields: ['uid'] },
  { name: 'uid-envelope', fields: ['uid', 'envelope'] },
  { name: 'uid-envelope-flags', fields: ['uid', 'envelope', 'flags'] },
  { name: 'uid-envelope-flags-date', fields: ['uid', 'envelope', 'flags', 'internalDate'] },
  {
    name: 'uid-envelope-flags-date-structure',
    fields: ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure']
  },
  {
    name: 'uid-envelope-flags-date-structure-headers',
    fields: ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure', 'headers']
  },
  {
    name: 'uid-envelope-flags-date-structure-headers-thread',
    fields: ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure', 'headers', 'threadId']
  }
];

export const IMAP_PROBE_RANGE_SETS = [
  { name: 'all', target: '*' },
  { name: 'recent-1', target: '*:-1' },
  { name: 'recent-5', target: '*:-5' },
  { name: 'recent-50', target: '*:-50' },
  { name: 'absolute-last-1', target: { type: 'absolute-last', count: 1 } },
  { name: 'absolute-last-5', target: { type: 'absolute-last', count: 5 } },
  { name: 'absolute-last-50', target: { type: 'absolute-last', count: 50 } }
];

function createRuntimeId(prefix = 'imap') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return '***';
  return `${value.slice(0, 1)}***${value.slice(at - 1)}`;
}

function buildClient(email, appPassword) {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false
  });
}

function stringifyDetailValue(value) {
  if (value == null) return '';

  if (Array.isArray(value)) {
    return value.map((entry) => stringifyDetailValue(entry)).filter(Boolean).join(',');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function joinDetailParts(parts = {}) {
  return Object.entries(parts)
    .map(([key, value]) => {
      const normalized = sanitizeTraceDetails(stringifyDetailValue(value));
      if (!normalized) return '';
      return `${key}=${normalized}`;
    })
    .filter(Boolean)
    .join('; ');
}

function readableCapabilities(client) {
  const capabilities = client?.capabilities;
  if (!capabilities) return [];

  try {
    if (typeof capabilities[Symbol.iterator] === 'function') {
      return Array.from(capabilities).map((entry) => String(entry)).sort();
    }
  } catch {
    // Ignore capability snapshot issues.
  }

  if (Array.isArray(capabilities)) {
    return capabilities.map((entry) => String(entry)).sort();
  }

  return [];
}

function mailboxSnapshot(client, folder) {
  const mailbox = client?.mailbox && typeof client.mailbox === 'object' ? client.mailbox : {};
  return {
    folder,
    path: typeof mailbox.path === 'string' && mailbox.path ? mailbox.path : folder,
    exists: Number.isFinite(mailbox.exists) ? mailbox.exists : undefined,
    uidNext: Number.isFinite(mailbox.uidNext) ? mailbox.uidNext : undefined,
    highestModseq: mailbox.highestModseq != null ? mailbox.highestModseq : undefined
  };
}

function buildFetchQuery(fetchFields = DEFAULT_FETCH_FIELDS) {
  const query = {};
  for (const field of Array.isArray(fetchFields) ? fetchFields : DEFAULT_FETCH_FIELDS) {
    if (field === 'headers') {
      query.headers = [...DEFAULT_HEADER_FIELDS];
      continue;
    }

    if (field === 'threadId') {
      query.threadId = true;
      continue;
    }

    query[field] = true;
  }
  return query;
}

function describeFetchQuery(query) {
  const fields = [];
  if (query.uid) fields.push('uid');
  if (query.envelope) fields.push('envelope');
  if (query.flags) fields.push('flags');
  if (query.internalDate) fields.push('internalDate');
  if (query.bodyStructure) fields.push('bodyStructure');
  if (query.headers) fields.push(`headers(${query.headers.join(',')})`);
  if (query.threadId) fields.push('threadId');
  return fields.join(',');
}

function resolveFetchTarget(totalMessages, rangeInput, fallbackLimit = 50) {
  if (rangeInput && typeof rangeInput === 'object' && rangeInput.type === 'absolute-last') {
    const count = Math.max(1, Number(rangeInput.count) || Math.max(1, Number(fallbackLimit) || 50));
    const start = Math.max(1, Number(totalMessages || 0) - count + 1);
    return {
      target: `${start}:*`,
      label: `${start}:*`,
      fetchMode: 'sequence-range',
      requestedCount: count,
      resolvedStart: start
    };
  }

  if (typeof rangeInput === 'string' && rangeInput.trim()) {
    return {
      target: rangeInput,
      label: rangeInput,
      fetchMode: 'sequence-range',
      requestedCount: undefined,
      resolvedStart: undefined
    };
  }

  const count = Math.max(1, Number(fallbackLimit) || 50);
  const start = Math.max(1, Number(totalMessages || 0) - count + 1);
  return {
    target: `${start}:*`,
    label: `${start}:*`,
    fetchMode: 'sequence-range',
    requestedCount: count,
    resolvedStart: start
  };
}

function errorSnapshot(error, parsedMessage) {
  const rawMessage = sanitizeTraceDetails(error?.message);
  return {
    parsed: parsedMessage,
    errorName: error?.name,
    errorMessage: rawMessage && rawMessage !== parsedMessage ? rawMessage : undefined,
    errorCode: error?.code,
    response: error?.response,
    responseText: error?.responseText,
    serverResponseCode: error?.serverResponseCode,
    command: error?.command
  };
}

function pushImapTrace(trace, level, stage, message, details = {}, extra = {}) {
  return pushTrace(trace, 'IMAP', level, stage, message, {
    code: extra.code,
    details: joinDetailParts(details)
  });
}

function walkParts(node, acc = []) {
  if (!node) return acc;
  if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
    node.childNodes.forEach((child) => walkParts(child, acc));
    return acc;
  }

  acc.push(node);
  return acc;
}

function selectTextPart(bodyStructure) {
  const leaves = walkParts(bodyStructure, []);
  const textPlain = leaves.find((part) =>
    String(part.type || '').toLowerCase() === 'text' &&
    String(part.subtype || '').toLowerCase() === 'plain'
  );
  if (textPlain?.part) return textPlain.part;

  const textHtml = leaves.find((part) =>
    String(part.type || '').toLowerCase() === 'text' &&
    String(part.subtype || '').toLowerCase() === 'html'
  );
  return textHtml?.part || null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseHeaderValue(headers, key) {
  if (!headers) return '';

  if (typeof headers.get === 'function') {
    const value = headers.get(key);
    if (Array.isArray(value)) return value.join(' ');
    return value ? String(value) : '';
  }

  if (typeof headers === 'object') {
    const direct = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(direct)) return direct.join(' ');
    return direct ? String(direct) : '';
  }

  return '';
}

function sanitizeSnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function extractSnippet(client, message) {
  const part = selectTextPart(message.bodyStructure);
  if (!part) return '';

  try {
    const { content } = await client.download(message.uid, part, { uid: true });
    const rawBuffer = await streamToBuffer(content);
    const parsed = await simpleParser(rawBuffer);
    return sanitizeSnippet(parsed.text || parsed.html || rawBuffer.toString('utf8'));
  } catch (error) {
    console.warn(`[IMAP] Failed to parse snippet for UID ${message.uid}: ${error.message}`);
    return '';
  }
}

async function attachSnippets(email, appPassword, folder, messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages || [];
  }

  const client = buildClient(email, appPassword);

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);

    try {
      for (const message of messages) {
        message.snippet = await extractSnippet(client, message);
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    console.warn(
      `[IMAP] Failed to attach snippets in ${folder}: ${error?.message || String(error)}`
    );
    for (const message of messages) {
      message.snippet ||= '';
    }
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }

  return messages;
}

function buildImapFailureDetails(parsed, folder, options = {}) {
  return joinDetailParts({
    requestId: options.requestId,
    folder,
    fetchStrategy: options.fetchStrategy,
    fetchMode: options.fetchMode,
    range: options.fetchTarget,
    requestedCount: options.requestedCount,
    resolvedStart: options.resolvedStart,
    attrs: options.fetchAttributes,
    mailboxExists: options.mailboxExists,
    uidNext: options.uidNext,
    highestModseq: options.highestModseq,
    capabilities: options.capabilities,
    ...errorSnapshot(options.rawError, parsed?.message)
  });
}

function logImapFailure(trace, parsed, folder, options = {}) {
  const details = buildImapFailureDetails(parsed, folder, options);

  if (parsed?.code === 'AUTH_FAILED') {
    pushTrace(trace, 'IMAP', 'error', 'imap_auth_failed', 'Gmail rejected the App Password.', {
      code: parsed.code,
      details
    });
    return;
  }

  if (parsed?.code === 'FOLDER_NOT_FOUND') {
    pushTrace(trace, 'IMAP', 'error', 'imap_folder_missing', `Required Gmail folder is missing: ${folder}.`, {
      code: parsed.code,
      details
    });
    return;
  }

  if (parsed?.code === 'CONNECTION_FAILED') {
    pushTrace(trace, 'IMAP', 'error', 'imap_connection_failed', 'Could not reach Gmail IMAP.', {
      code: parsed.code,
      details
    });
    return;
  }

  const actionLabel = options.operation === 'search'
    ? `IMAP search failed for ${folder}.`
    : (options.operation === 'fetch'
      ? `IMAP header fetch failed for ${folder}.`
      : 'IMAP request failed.');

  pushTrace(trace, 'IMAP', 'error', 'imap_failed', actionLabel, {
    code: parsed?.code || 'BACKEND_UNAVAILABLE',
    details
  });
}

function summarizeProbeError(error, folder, extra = {}) {
  const parsed = parseImapError(error, folder);
  return {
    success: false,
    code: parsed.code,
    error: parsed.message,
    raw: joinDetailParts(errorSnapshot(error, parsed.message)),
    ...extra
  };
}

export async function fetchMessages(email, appPassword, folder, limit = 50, trace = [], options = {}) {
  const maskedEmail = maskEmail(email);
  const requestId = String(options.requestId || createRuntimeId('fetch')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  let capabilities = [];
  let mailboxInfo = {};
  let fetchTarget = null;

  console.log(`[IMAP] requestId=${requestId} connecting to ${IMAP_HOST}:${IMAP_PORT} for ${maskedEmail}`);
  pushImapTrace(trace, 'info', 'imap_connecting', `Connecting to Gmail for ${folder}.`, {
    requestId,
    fetchStrategy
  });

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    console.log(`[IMAP] requestId=${requestId} connected for ${maskedEmail}`);
    pushImapTrace(trace, 'success', 'imap_connected', `Connected to Gmail for ${folder}.`, {
      requestId,
      fetchStrategy,
      capabilities
    });

    const lock = await client.getMailboxLock(folder);
    mailboxInfo = mailboxSnapshot(client, folder);
    console.log(`[IMAP] requestId=${requestId} opened folder ${folder}`);
    pushImapTrace(trace, 'info', 'imap_mailbox_opened', `Opened Gmail folder ${folder}.`, {
      requestId,
      fetchStrategy,
      path: mailboxInfo.path,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq
    });

    let collected = [];

    try {
      const totalMessages = mailboxInfo.exists || 0;
      console.log(`[IMAP] requestId=${requestId} found ${totalMessages} messages in ${folder}`);
      pushImapTrace(trace, 'info', 'imap_fetch_started', `Fetching recent message headers from ${folder}.`, {
        requestId,
        fetchStrategy,
        mailboxExists: totalMessages,
        uidNext: mailboxInfo.uidNext,
        highestModseq: mailboxInfo.highestModseq
      });

      if (totalMessages === 0) {
        pushImapTrace(trace, 'success', 'imap_fetch_complete', `No messages found in ${folder}.`, {
          requestId,
          fetchStrategy
        });
        return [];
      }

      fetchTarget = resolveFetchTarget(totalMessages, options.range, limit);
      console.log(
        `[IMAP] requestId=${requestId} fetch folder=${folder} mode=${fetchTarget.fetchMode} range=${fetchTarget.label} requestedCount=${fetchTarget.requestedCount || 'n/a'} resolvedStart=${fetchTarget.resolvedStart || 'n/a'} attrs=${fetchAttributes} strategy=${fetchStrategy}`
      );
      pushImapTrace(trace, 'info', 'imap_fetch_command', `Requesting header batch from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        requestedCount: fetchTarget.requestedCount,
        resolvedStart: fetchTarget.resolvedStart,
        attrs: fetchAttributes,
        mailboxExists: mailboxInfo.exists,
        uidNext: mailboxInfo.uidNext,
        highestModseq: mailboxInfo.highestModseq
      });

      for await (const message of client.fetch(fetchTarget.target, fetchQuery)) {
        collected.push({ ...message, snippet: '' });
      }

      console.log(`[IMAP] requestId=${requestId} fetched ${collected.length} message envelopes from ${folder}`);
      pushImapTrace(trace, 'success', 'imap_fetch_complete', `Fetched ${collected.length} recent messages from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        requestedCount: fetchTarget.requestedCount,
        resolvedStart: fetchTarget.resolvedStart,
        attrs: fetchAttributes,
        count: collected.length
      });
    } finally {
      lock.release();
    }

    return collected;
  } catch (error) {
    const parsed = parseImapError(error, folder);
    console.error(`[IMAP ERROR] requestId=${requestId} ${parsed.code}: ${parsed.message}`);
    logImapFailure(trace, parsed, folder, {
      operation: 'fetch',
      requestId,
      fetchStrategy,
      fetchMode: fetchTarget?.fetchMode,
      fetchTarget: fetchTarget?.label,
      requestedCount: fetchTarget?.requestedCount,
      resolvedStart: fetchTarget?.resolvedStart,
      fetchAttributes,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq,
      capabilities,
      rawError: error
    });
    throw parsed;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
    console.log(`[IMAP] requestId=${requestId} connection closed for ${maskedEmail}`);
  }
}

export async function searchMessages(email, appPassword, folder, query, limit = 20, trace = [], options = {}) {
  const maskedEmail = maskEmail(email);
  const requestId = String(options.requestId || createRuntimeId('search')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  let capabilities = [];
  let mailboxInfo = {};
  let fetchTarget = null;

  console.log(`[IMAP] requestId=${requestId} connecting to ${IMAP_HOST}:${IMAP_PORT} for ${maskedEmail} (search)`);
  pushImapTrace(trace, 'info', 'imap_connecting', `Connecting to Gmail for search in ${folder}.`, {
    requestId,
    fetchStrategy
  });

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    console.log(`[IMAP] requestId=${requestId} connected for ${maskedEmail} (search)`);
    pushImapTrace(trace, 'success', 'imap_connected', `Connected to Gmail for search in ${folder}.`, {
      requestId,
      fetchStrategy,
      capabilities
    });

    const lock = await client.getMailboxLock(folder);
    mailboxInfo = mailboxSnapshot(client, folder);
    console.log(`[IMAP] requestId=${requestId} opened folder ${folder} (search)`);
    pushImapTrace(trace, 'info', 'imap_mailbox_opened', `Opened Gmail folder ${folder}.`, {
      requestId,
      fetchStrategy,
      path: mailboxInfo.path,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq
    });

    let messages = [];

    try {
      const matchedUids = await client.search({ body: query });
      const slice = matchedUids.slice(-Math.max(1, Number(limit) || 20));
      pushImapTrace(trace, 'info', 'imap_search_started', `Searching ${folder} for matching messages.`, {
        requestId,
        fetchStrategy,
        queryLength: String(query || '').trim().length,
        matched: matchedUids.length,
        requested: slice.length
      });
      if (!slice.length) {
        console.log(`[IMAP] requestId=${requestId} search returned 0 messages in ${folder}`);
        pushImapTrace(trace, 'success', 'imap_search_complete', `No search results in ${folder}.`, {
          requestId,
          fetchStrategy
        });
        return [];
      }

      fetchTarget = {
        target: slice,
        label: `uids(${slice.length})`,
        fetchMode: 'uid-list'
      };
      console.log(
        `[IMAP] requestId=${requestId} search fetch folder=${folder} mode=${fetchTarget.fetchMode} attrs=${fetchAttributes} strategy=${fetchStrategy} matched=${slice.length}`
      );
      pushImapTrace(trace, 'info', 'imap_search_fetch_command', `Requesting search result headers from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        attrs: fetchAttributes,
        requested: slice.length,
        mailboxExists: mailboxInfo.exists,
        uidNext: mailboxInfo.uidNext
      });

      for await (const message of client.fetch(slice, fetchQuery)) {
        messages.push({ ...message });
      }

      console.log(`[IMAP] requestId=${requestId} search fetched ${messages.length} message envelopes from ${folder}`);
      pushImapTrace(trace, 'success', 'imap_search_complete', `Search fetched ${messages.length} messages from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        attrs: fetchAttributes,
        count: messages.length
      });
    } finally {
      lock.release();
    }

    return await attachSnippets(email, appPassword, folder, messages);
  } catch (error) {
    const parsed = parseImapError(error, folder);
    console.error(`[IMAP ERROR] requestId=${requestId} ${parsed.code}: ${parsed.message}`);
    logImapFailure(trace, parsed, folder, {
      operation: 'search',
      requestId,
      fetchStrategy,
      fetchMode: fetchTarget?.fetchMode,
      fetchTarget: fetchTarget?.label,
      fetchAttributes,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq,
      capabilities,
      rawError: error
    });
    throw parsed;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
    console.log(`[IMAP] requestId=${requestId} connection closed for ${maskedEmail}`);
  }
}

export async function testConnection(email, appPassword, trace = [], options = {}) {
  const maskedEmail = maskEmail(email);
  const requestId = String(options.requestId || createRuntimeId('connect')).trim();
  const client = buildClient(email, appPassword);
  let capabilities = [];
  pushImapTrace(trace, 'info', 'imap_connecting', 'Connecting to Gmail to verify credentials.', {
    requestId
  });

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    console.log(`[IMAP] requestId=${requestId} connection test passed for ${maskedEmail}`);
    pushImapTrace(trace, 'success', 'imap_connected', 'Connected to Gmail successfully.', {
      requestId,
      capabilities
    });
    pushImapTrace(trace, 'success', 'imap_auth_verified', 'Gmail accepted the App Password.', {
      requestId
    });
    await client.logout();
    return { success: true, trace };
  } catch (error) {
    const parsed = parseImapError(error, '[Gmail]/Sent Mail');
    console.error(`[IMAP ERROR] requestId=${requestId} ${parsed.code}: ${parsed.message}`);
    logImapFailure(trace, parsed, '[Gmail]/Sent Mail', {
      operation: 'connect',
      requestId,
      capabilities,
      rawError: error
    });
    return { success: false, code: parsed.code, error: parsed.message, trace };
  }
}

export async function probeImapConnection(email, appPassword, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-connect')).trim();
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();

  try {
    await client.connect();
    return {
      success: true,
      requestId,
      durationMs: Date.now() - startedAt,
      capabilities: readableCapabilities(client)
    };
  } catch (error) {
    return summarizeProbeError(error, 'INBOX', {
      requestId,
      durationMs: Date.now() - startedAt
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function probeMailboxOpen(email, appPassword, folder, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-open')).trim();
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const mailboxInfo = mailboxSnapshot(client, folder);
      return {
        success: true,
        requestId,
        folder,
        durationMs: Date.now() - startedAt,
        capabilities: readableCapabilities(client),
        mailboxInfo
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    return summarizeProbeError(error, folder, {
      requestId,
      folder,
      durationMs: Date.now() - startedAt
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function probeFetch(email, appPassword, folder, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-fetch')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();
  let capabilities = [];
  let mailboxInfo = {};
  let fetchTarget = null;
  let count = 0;

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    const lock = await client.getMailboxLock(folder);
    try {
      mailboxInfo = mailboxSnapshot(client, folder);
      fetchTarget = resolveFetchTarget(mailboxInfo.exists || 0, options.range, options.limit || 5);

      for await (const _message of client.fetch(fetchTarget.target, fetchQuery)) {
        count += 1;
      }

      return {
        success: true,
        requestId,
        folder,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        requestedCount: fetchTarget.requestedCount,
        resolvedStart: fetchTarget.resolvedStart,
        attrs: fetchAttributes,
        count,
        durationMs: Date.now() - startedAt,
        capabilities,
        mailboxInfo
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    const failure = summarizeProbeError(error, folder, {
      requestId,
      folder,
      fetchStrategy,
      fetchMode: fetchTarget?.fetchMode,
      range: fetchTarget?.label,
      requestedCount: fetchTarget?.requestedCount,
      resolvedStart: fetchTarget?.resolvedStart,
      attrs: fetchAttributes,
      durationMs: Date.now() - startedAt,
      capabilities,
      mailboxInfo
    });
    return failure;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function probeSearch(email, appPassword, folder, query, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-search')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();
  let capabilities = [];
  let mailboxInfo = {};
  let matched = 0;
  let requested = 0;
  let count = 0;

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    const lock = await client.getMailboxLock(folder);
    try {
      mailboxInfo = mailboxSnapshot(client, folder);
      const matchedUids = await client.search({ body: query });
      matched = matchedUids.length;
      const limit = Math.max(1, Number(options.limit) || 5);
      const slice = matchedUids.slice(-limit);
      requested = slice.length;

      for await (const _message of client.fetch(slice, fetchQuery)) {
        count += 1;
      }

      return {
        success: true,
        requestId,
        folder,
        fetchStrategy,
        fetchMode: 'uid-list',
        range: `uids(${requested})`,
        attrs: fetchAttributes,
        matched,
        requested,
        count,
        query,
        durationMs: Date.now() - startedAt,
        capabilities,
        mailboxInfo
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    return summarizeProbeError(error, folder, {
      requestId,
      folder,
      fetchStrategy,
      fetchMode: 'uid-list',
      range: `uids(${requested})`,
      attrs: fetchAttributes,
      matched,
      requested,
      query,
      durationMs: Date.now() - startedAt,
      capabilities,
      mailboxInfo
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export function deriveThreadId(message) {
  const headers = message?.headers;
  const refs = parseHeaderValue(headers, 'references')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (refs.length > 0) {
    return refs[0];
  }

  const inReplyTo = parseHeaderValue(headers, 'in-reply-to').trim();
  if (inReplyTo) {
    return inReplyTo;
  }

  return message?.envelope?.messageId || `uid-${message?.uid || 'unknown'}`;
}
