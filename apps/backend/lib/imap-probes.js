import { parseImapError } from './errors.js';
import {
  buildClient,
  createRuntimeId,
  mailboxSnapshot,
  maskEmail,
  readableCapabilities
} from './imap-client.js';
import {
  buildFetchQuery,
  DEFAULT_FETCH_FIELDS,
  describeFetchQuery,
  resolveFetchTarget
} from './imap-fetch-targets.js';
import { logImapFailure, pushImapTrace, summarizeProbeError } from './imap-trace.js';

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
    return summarizeProbeError(error, folder, {
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
