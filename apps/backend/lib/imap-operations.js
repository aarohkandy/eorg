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
import { attachSnippets } from './imap-snippets.js';
import { logImapFailure, pushImapTrace } from './imap-trace.js';

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

  console.log(`[IMAP] requestId=${requestId} connecting to imap.gmail.com:993 for ${maskedEmail}`);
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

  console.log(`[IMAP] requestId=${requestId} connecting to imap.gmail.com:993 for ${maskedEmail} (search)`);
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
