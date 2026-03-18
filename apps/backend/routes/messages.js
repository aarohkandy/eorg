import express from 'express';
import { supabase } from '../lib/supabase.js';
import { decrypt } from '../lib/crypto.js';
import { fetchMessages, searchMessages } from '../lib/imap.js';
import { getBuildInfo } from '../lib/build-info.js';
import {
  normalizeImapMessage,
  mapMessageToRow,
  mapRowToMessage
} from '../lib/message-normalize.js';
import { AppError, buildErrorResponse, pushTrace } from '../lib/errors.js';

const router = express.Router();

const IMAP_FOLDERS = {
  INBOX: 'INBOX',
  SENT: '[Gmail]/Sent Mail'
};

function createRequestId(prefix = 'messages') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function appendDetails(existing, extra = {}) {
  const base = String(existing || '').trim();
  const additions = Object.entries(extra)
    .map(([key, value]) => {
      if (value == null || value === '') return '';
      return `${key}=${value}`;
    })
    .filter(Boolean)
    .join('; ');

  return [base, additions].filter(Boolean).join('; ');
}

function pushDbTrace(trace, level, stage, message, extra = {}) {
  return pushTrace(trace, 'DB', level, stage, message, extra);
}

function hasSpecificFailure(trace) {
  return Array.isArray(trace) && trace.some((entry) =>
    entry &&
    entry.level === 'error' &&
    (entry.source === 'DB' || entry.source === 'IMAP')
  );
}

function parseFolder(folder) {
  const value = String(folder || 'all').toLowerCase();
  if (value === 'inbox') return 'inbox';
  if (value === 'sent') return 'sent';
  return 'all';
}

function parseLimit(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 200);
}

function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

function getRequestedFolders(folder) {
  if (folder === 'inbox') return ['INBOX'];
  if (folder === 'sent') return ['SENT'];
  return ['INBOX', 'SENT'];
}

function sortByDateDesc(messages) {
  return [...messages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

function dedupeById(messages) {
  const byId = new Map();
  messages.forEach((message) => {
    byId.set(message.id, message);
  });
  return [...byId.values()];
}

function hasPreviewContent(messages) {
  if (!Array.isArray(messages) || !messages.length) return false;

  const populated = messages.filter((message) => String(message?.snippet || '').trim().length >= 20).length;
  return populated / messages.length >= 0.8;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function messageMatchesContact(message, contactEmail) {
  const target = normalizeEmail(contactEmail);
  if (!target) return false;

  const fromEmail = normalizeEmail(message?.from?.email);
  const toEmails = Array.isArray(message?.to)
    ? message.to.map((entry) => normalizeEmail(entry?.email)).filter(Boolean)
    : [];

  return fromEmail === target || toEmails.includes(target);
}

function filterMessagesByContact(messages, contactEmail) {
  return sortByDateDesc((messages || []).filter((message) => messageMatchesContact(message, contactEmail)));
}

function buildContentCoverage(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const totalMessages = list.length;
  const missingContentCount = list.filter((message) => String(message?.snippet || '').trim().length === 0).length;
  const shortContentCount = list.filter((message) => {
    const length = String(message?.snippet || '').trim().length;
    return length > 0 && length < 40;
  }).length;
  const presentCount = Math.max(0, totalMessages - missingContentCount - shortContentCount);
  const contentCoveragePct = totalMessages ? Math.round((presentCount / totalMessages) * 100) : 100;

  return {
    totalMessages,
    missingContentCount,
    shortContentCount,
    presentCount,
    contentCoveragePct
  };
}

function buildMailboxDebug(options = {}) {
  const build = getBuildInfo();
  return {
    backend: build,
    cache: {
      used: Boolean(options.cacheUsed),
      newestCachedAt: options.newestCachedAt || null,
      totalMessages: options.cacheCoverage?.totalMessages || 0,
      missingContentCount: options.cacheCoverage?.missingContentCount || 0,
      shortContentCount: options.cacheCoverage?.shortContentCount || 0,
      contentCoveragePct: options.cacheCoverage?.contentCoveragePct ?? 100
    },
    live: {
      used: Boolean(options.liveUsed),
      limitPerFolder: options.limitPerFolder || 0,
      totalMessages: options.liveCoverage?.totalMessages || 0,
      missingContentCount: options.liveCoverage?.missingContentCount || 0,
      shortContentCount: options.liveCoverage?.shortContentCount || 0,
      contentCoveragePct: options.liveCoverage?.contentCoveragePct ?? 100
    }
  };
}

async function getUser(userId, trace = [], requestId = '') {
  pushDbTrace(trace, 'info', 'db_user_lookup_started', 'Loading connected user from Supabase.');
  const { data, error } = await supabase
    .from('users')
    .select('id, email, encrypted_password, last_sync')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    pushDbTrace(trace, 'error', 'db_user_lookup_failed', 'Could not load the connected user from Supabase.', {
      code: 'BACKEND_UNAVAILABLE',
      details: error.message
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }

  if (!data) {
    pushDbTrace(trace, 'error', 'db_user_missing', 'Connected user record was not found in Supabase.', {
      code: 'NOT_CONNECTED'
    });
    throw new AppError('NOT_CONNECTED', 'User not found. Please reconnect the extension.', 401, { trace });
  }

  pushDbTrace(trace, 'success', 'db_user_lookup_complete', 'Connected user loaded from Supabase.');
  if (requestId) {
    pushDbTrace(trace, 'info', 'db_user_lookup_context', 'Connected user lookup context.', {
      details: `requestId=${requestId}; userId=${userId}`
    });
  }
  return data;
}

async function loadCachedMessages(userId, folders, limit, trace = [], requestId = '') {
  pushDbTrace(trace, 'info', 'db_cache_read_started', 'Loading cached messages from Supabase.');
  const query = supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .in('folder', folders)
    .order('date', { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) {
    pushDbTrace(trace, 'error', 'db_cache_read_failed', 'Could not load cached messages from Supabase.', {
      code: 'BACKEND_UNAVAILABLE',
      details: error.message
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }

  pushDbTrace(trace, 'success', 'db_cache_read_complete', `Loaded ${(data || []).length} cached messages from Supabase.`, {
    details: appendDetails(`folders=${folders.join(',')}; limit=${limit}`, { requestId })
  });
  return (data || []).map(mapRowToMessage);
}

async function loadLatestCacheTimestamp(userId, folders, trace = [], requestId = '') {
  pushDbTrace(trace, 'info', 'db_cache_freshness_started', 'Checking cached message freshness in Supabase.');
  const { data, error } = await supabase
    .from('messages')
    .select('cached_at')
    .eq('user_id', userId)
    .in('folder', folders)
    .order('cached_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    pushDbTrace(trace, 'error', 'db_cache_freshness_failed', 'Could not check cached message freshness.', {
      code: 'BACKEND_UNAVAILABLE',
      details: error.message
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }

  pushDbTrace(trace, 'success', 'db_cache_freshness_complete', 'Checked cached message freshness.', {
    details: appendDetails(
      data?.cached_at ? `newestCachedAt=${data.cached_at}` : 'newestCachedAt=none',
      { requestId }
    )
  });
  return data?.cached_at ? new Date(data.cached_at).getTime() : 0;
}

async function pruneOldCache(userId, folder, trace = [], requestId = '') {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('user_id', userId)
    .eq('folder', folder)
    .lt('cached_at', cutoff);

  if (error) {
    pushDbTrace(trace, 'error', 'db_cache_prune_failed', `Could not prune cached ${folder} messages.`, {
      code: 'BACKEND_UNAVAILABLE',
      details: appendDetails(error.message, { requestId, folder, cutoff })
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }
}

async function upsertMessages(userId, messages, trace = [], requestId = '') {
  if (!messages.length) return;

  const byFolder = messages.reduce((acc, message) => {
    if (!acc[message.folder]) acc[message.folder] = [];
    acc[message.folder].push(message);
    return acc;
  }, {});

  pushDbTrace(trace, 'info', 'db_messages_upsert_started', 'Saving synced messages to Supabase.', {
    details: appendDetails(`rows=${messages.length}; folders=${Object.keys(byFolder).join(',')}`, { requestId })
  });
  for (const folder of Object.keys(byFolder)) {
    await pruneOldCache(userId, folder, trace, requestId);
  }

  const rows = messages.map((message) => mapMessageToRow(message, userId));
  const { error } = await supabase.from('messages').upsert(rows, { onConflict: 'id' });
  if (error) {
    pushDbTrace(trace, 'error', 'db_messages_upsert_failed', 'Could not save synced messages to Supabase.', {
      code: 'BACKEND_UNAVAILABLE',
      details: error.message
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }

  pushDbTrace(trace, 'success', 'db_messages_upsert_complete', `Saved ${rows.length} messages to Supabase.`, {
    details: requestId ? `requestId=${requestId}` : undefined
  });
}

async function fetchFromImap(user, requestedFolders, limit, trace = [], options = {}) {
  const password = decrypt(user.encrypted_password);
  const requestId = String(options.requestId || '').trim();
  const fetchStrategy = String(options.fetchStrategy || (requestedFolders.length > 1 ? 'parallel' : 'single')).trim();

  const taskFactory = (folder) => async () => {
    const imapFolder = IMAP_FOLDERS[folder];
    const rawMessages = await fetchMessages(user.email, password, imapFolder, limit, trace, {
      requestId: requestId ? `${requestId}-${folder.toLowerCase()}` : undefined,
      fetchStrategy,
      includeExtractionDebug: Boolean(options.includeExtractionDebug)
    });
    return rawMessages.map((message) => normalizeImapMessage(message, folder, user.email));
  };

  const tasks = requestedFolders.map((folder) => taskFactory(folder));
  const results = fetchStrategy === 'sequential'
    ? await tasks.reduce(async (accPromise, task) => {
      const acc = await accPromise;
      const next = await task();
      acc.push(next);
      return acc;
    }, Promise.resolve([]))
    : await Promise.all(tasks.map((task) => task()));
  return sortByDateDesc(dedupeById(results.flat()));
}

async function updateLastSync(userId, trace = [], requestId = '') {
  const now = new Date().toISOString();
  pushDbTrace(trace, 'info', 'db_last_sync_started', 'Updating last sync time in Supabase.');
  const { error } = await supabase.from('users').update({ last_sync: now }).eq('id', userId);
  if (error) {
    pushDbTrace(trace, 'error', 'db_last_sync_failed', 'Could not update last sync time in Supabase.', {
      code: 'BACKEND_UNAVAILABLE',
      details: error.message
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }
  pushDbTrace(trace, 'success', 'db_last_sync_complete', 'Updated last sync time in Supabase.', {
    details: appendDetails(now, { requestId })
  });
}

function buildCounts(messages) {
  const inboxCount = messages.filter((message) => message.folder === 'INBOX').length;
  const sentCount = messages.filter((message) => message.folder === 'SENT').length;
  return { inboxCount, sentCount };
}

router.get('/', async (req, res) => {
  const trace = [];
  const requestId = createRequestId('mailbox');

  try {
    pushTrace(trace, 'API', 'info', 'messages_fetch_received', 'Mailbox load request received.', {
      details: `requestId=${requestId}`
    });
    const userId = String(req.query?.userId || '').trim();
    if (!userId) {
      pushTrace(trace, 'API', 'error', 'messages_fetch_invalid', 'A connected user ID is required to load messages.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'userId query parameter is required.', 400, { trace });
    }

    const folder = parseFolder(req.query?.folder);
    const limit = parseLimit(req.query?.limit, 50);
    const forceSync = parseBoolean(req.query?.forceSync);
    const requestedFolders = getRequestedFolders(folder);
    const fetchLimit = folder === 'all' ? limit * 2 : limit;
    pushTrace(trace, 'API', 'success', 'messages_fetch_valid', 'Mailbox load request validated.', {
      details: `requestId=${requestId}; folder=${folder}; limit=${limit}; forceSync=${forceSync}; requestedFolders=${requestedFolders.join(',')}`
    });

    console.log(`[Messages] requestId=${requestId} fetching for userId ${userId}`);

    const user = await getUser(userId, trace, requestId);
    pushTrace(trace, 'API', 'success', 'messages_user_loaded', 'Connected user loaded successfully.');

    let latestCacheTimestamp = 0;
    let newestCachedAt = null;

    if (!forceSync) {
      latestCacheTimestamp = await loadLatestCacheTimestamp(userId, requestedFolders, trace, requestId);
      newestCachedAt = latestCacheTimestamp ? new Date(latestCacheTimestamp).toISOString() : null;
      const ageMs = latestCacheTimestamp ? Date.now() - latestCacheTimestamp : Number.POSITIVE_INFINITY;

      if (ageMs < 5 * 60 * 1000) {
        const cached = await loadCachedMessages(userId, requestedFolders, fetchLimit, trace, requestId);
        const sortedCached = sortByDateDesc(cached).slice(0, fetchLimit);
        const cacheCoverage = buildContentCoverage(sortedCached);
        if (sortedCached.length && hasPreviewContent(sortedCached)) {
          const counts = buildCounts(sortedCached);
          const ageSec = Math.max(0, Math.floor(ageMs / 1000));
          if (cacheCoverage.missingContentCount > 0) {
            pushTrace(trace, 'API', 'info', 'messages_cache_hit_blank_content', 'Cached mailbox rows still contain blank message content.', {
              details: `requestId=${requestId}; missing=${cacheCoverage.missingContentCount}; short=${cacheCoverage.shortContentCount}; coveragePct=${cacheCoverage.contentCoveragePct}`
            });
          }
          pushTrace(trace, 'API', 'info', 'messages_cache_hit', `Using cached messages (${sortedCached.length} total).`, {
            details: `requestId=${requestId}; cacheAgeSec=${ageSec}; inbox=${counts.inboxCount}; sent=${counts.sentCount}`
          });
          console.log(
            `[Messages] requestId=${requestId} cache hit for userId ${userId} - returning ${sortedCached.length} cached messages (age: ${ageSec}s)`
          );

          return res.status(200).json({
            success: true,
            messages: sortedCached,
            count: sortedCached.length,
            ...counts,
            trace,
            debug: buildMailboxDebug({
              cacheUsed: true,
              newestCachedAt,
              cacheCoverage,
              liveUsed: false,
              limitPerFolder: limit
            })
          });
        }

        if (sortedCached.length) {
          pushTrace(
            trace,
            'API',
            'info',
            'messages_cache_preview_miss',
            'Cached messages are missing preview content. Refreshing from Gmail.',
            {
              details: `requestId=${requestId}; cached=${sortedCached.length}`
            }
          );
        }
      }
    }

    pushTrace(trace, 'API', 'info', 'messages_cache_miss', 'Cache is stale or empty. Fetching from Gmail.');
    pushTrace(trace, 'API', 'info', 'messages_live_refresh_started', 'Starting live mailbox refresh from Gmail.', {
      details: `requestId=${requestId}; limitPerFolder=${limit}`
    });
    console.log(`[Messages] requestId=${requestId} cache miss for userId ${userId} - fetching from IMAP`);
    pushTrace(trace, 'API', 'info', 'messages_imap_fetch_start', 'Starting Gmail mailbox sync.', {
      details: `requestId=${requestId}; fetchStrategy=parallel; requestedFolders=${requestedFolders.join(',')}`
    });
    const fresh = await fetchFromImap(user, requestedFolders, limit, trace, {
      requestId,
      fetchStrategy: 'parallel'
    });
    await upsertMessages(userId, fresh, trace, requestId);
    await updateLastSync(userId, trace, requestId);

    const counts = buildCounts(fresh);
    const liveCoverage = buildContentCoverage(fresh);
    pushTrace(trace, 'API', 'success', 'messages_imap_fetch_complete', `Mailbox sync complete: ${fresh.length} messages loaded.`, {
      details: `requestId=${requestId}; inbox=${counts.inboxCount}; sent=${counts.sentCount}`
    });
    pushTrace(trace, 'API', 'success', 'messages_live_refresh_complete', 'Live mailbox refresh completed.', {
      details: `requestId=${requestId}; missing=${liveCoverage.missingContentCount}; short=${liveCoverage.shortContentCount}; coveragePct=${liveCoverage.contentCoveragePct}`
    });
    console.log(
      `[Messages] requestId=${requestId} normalized ${fresh.length} messages (${counts.inboxCount} inbox, ${counts.sentCount} sent)`
    );
    console.log(`[Messages] requestId=${requestId} returning ${fresh.length} messages to client`);

    return res.status(200).json({
      success: true,
      messages: fresh,
      count: fresh.length,
      ...counts,
      trace,
      debug: buildMailboxDebug({
        cacheUsed: false,
        newestCachedAt,
        cacheCoverage: buildContentCoverage([]),
        liveUsed: true,
        limitPerFolder: limit,
        liveCoverage
      })
    });
  } catch (error) {
    if (!hasSpecificFailure(trace)) {
      pushTrace(trace, 'API', 'error', 'messages_fetch_failed', 'Mailbox load failed.', {
        code: error?.code || 'BACKEND_UNAVAILABLE',
        details: error?.message || 'Unexpected backend error'
      });
    }
    const payload = buildErrorResponse(error, trace);
    return res.status(payload.status).json(payload.body);
  }
});

router.post('/debug/contact', async (req, res) => {
  const trace = [];
  const requestId = createRequestId('contact-debug');

  try {
    pushTrace(trace, 'API', 'info', 'contact_debug_refetch_received', 'Contact debug refetch request received.', {
      details: `requestId=${requestId}`
    });

    const userId = String(req.body?.userId || '').trim();
    const contactEmail = normalizeEmail(req.body?.contactEmail);
    const selectedMessageIds = Array.isArray(req.body?.selectedMessageIds)
      ? req.body.selectedMessageIds.filter((entry) => entry && typeof entry === 'object')
      : [];
    const limitPerFolder = 250;

    if (!userId) {
      throw new AppError('NOT_CONNECTED', 'userId is required.', 400, { trace });
    }

    if (!contactEmail) {
      throw new AppError('BACKEND_UNAVAILABLE', 'contactEmail is required.', 400, { trace });
    }

    pushTrace(trace, 'API', 'success', 'contact_debug_refetch_valid', 'Contact debug refetch request validated.', {
      details: `requestId=${requestId}; contactEmail=${contactEmail}; selectedMessageIds=${selectedMessageIds.length}; limitPerFolder=${limitPerFolder}`
    });

    const user = await getUser(userId, trace, requestId);
    const cached = await loadCachedMessages(userId, ['INBOX', 'SENT'], limitPerFolder * 2, trace, requestId);
    const beforeMessages = filterMessagesByContact(cached, contactEmail);
    const beforeCoverage = buildContentCoverage(beforeMessages);

    pushTrace(trace, 'API', 'info', 'contact_debug_refetch_started', 'Starting live contact debug refresh from Gmail.', {
      details: `requestId=${requestId}; contactEmail=${contactEmail}; beforeCount=${beforeMessages.length}; beforeMissing=${beforeCoverage.missingContentCount}`
    });

    const live = await fetchFromImap(user, ['INBOX', 'SENT'], limitPerFolder, trace, {
      requestId,
      fetchStrategy: 'parallel',
      includeExtractionDebug: true
    });
    const contactMessages = filterMessagesByContact(live, contactEmail);
    const afterCoverage = buildContentCoverage(contactMessages);
    const perMessageExtraction = contactMessages.map((message) => ({
      id: message.id,
      uid: message.uid,
      folder: message.folder,
      ...(
        message.debug && typeof message.debug === 'object'
          ? message.debug
          : {}
      )
    }));

    if (contactMessages.length) {
      await upsertMessages(userId, contactMessages, trace, requestId);
    }

    pushTrace(trace, 'API', 'success', 'contact_debug_refetch_complete', 'Live contact debug refresh completed.', {
      details: `requestId=${requestId}; contactEmail=${contactEmail}; afterCount=${contactMessages.length}; afterMissing=${afterCoverage.missingContentCount}; coveragePct=${afterCoverage.contentCoveragePct}`
    });

    return res.status(200).json({
      success: true,
      messages: contactMessages,
      trace,
      backend: getBuildInfo(),
      debug: {
        contactEmail,
        beforeCount: beforeMessages.length,
        afterCount: contactMessages.length,
        beforeMissingContentCount: beforeCoverage.missingContentCount,
        afterMissingContentCount: afterCoverage.missingContentCount,
        foldersFetched: ['INBOX', 'SENT'],
        limitPerFolder,
        perMessageExtraction
      }
    });
  } catch (error) {
    if (!hasSpecificFailure(trace)) {
      pushTrace(trace, 'API', 'error', 'contact_debug_refetch_failed', 'Contact debug refetch failed.', {
        code: error?.code || 'BACKEND_UNAVAILABLE',
        details: error?.message || 'Unexpected backend error'
      });
    }
    const payload = buildErrorResponse(error, trace);
    return res.status(payload.status).json(payload.body);
  }
});

router.get('/search', async (req, res) => {
  const trace = [];
  const requestId = createRequestId('search');

  try {
    pushTrace(trace, 'API', 'info', 'messages_search_received', 'Search request received.', {
      details: `requestId=${requestId}`
    });
    const userId = String(req.query?.userId || '').trim();
    const query = String(req.query?.query || '').trim();
    const limit = parseLimit(req.query?.limit, 20);

    if (!userId) {
      pushTrace(trace, 'API', 'error', 'messages_search_invalid', 'A connected user ID is required to search.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'userId query parameter is required.', 400, { trace });
    }

    if (!query) {
      pushTrace(trace, 'API', 'error', 'messages_search_missing_query', 'A search query is required.', {
        code: 'BACKEND_UNAVAILABLE'
      });
      throw new AppError('BACKEND_UNAVAILABLE', 'query parameter is required.', 400, { trace });
    }

    pushTrace(trace, 'API', 'success', 'messages_search_valid', 'Search request validated.', {
      details: `requestId=${requestId}; limit=${limit}`
    });
    const user = await getUser(userId, trace, requestId);
    pushTrace(trace, 'API', 'success', 'messages_search_user_loaded', 'Connected user loaded successfully.');

    const ilike = `%${query}%`;
    pushDbTrace(trace, 'info', 'db_search_cache_started', 'Searching cached messages in Supabase.', {
      details: `requestId=${requestId}; limit=${limit}`
    });
    const { data: cachedRows, error } = await supabase
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .or(`subject.ilike.${ilike},from_name.ilike.${ilike},from_email.ilike.${ilike},snippet.ilike.${ilike}`)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      pushDbTrace(trace, 'error', 'db_search_cache_failed', 'Cached search failed in Supabase.', {
        code: 'BACKEND_UNAVAILABLE',
        details: error.message
      });
      throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
    }

    const cachedMessages = (cachedRows || []).map(mapRowToMessage);
    pushDbTrace(trace, 'success', 'db_search_cache_complete', `Loaded ${cachedMessages.length} cached search results from Supabase.`, {
      details: `requestId=${requestId}`
    });
    if (cachedMessages.length >= 5) {
      pushTrace(trace, 'API', 'info', 'messages_search_cache_hit', `Search returned ${cachedMessages.length} cached results.`);
      return res.status(200).json({
        success: true,
        messages: cachedMessages,
        count: cachedMessages.length,
        source: 'cache',
        trace
      });
    }

    const password = decrypt(user.encrypted_password);
    pushTrace(trace, 'API', 'info', 'messages_search_live_start', 'Falling back to live Gmail search.', {
      details: `requestId=${requestId}; fetchStrategy=parallel`
    });
    const [inboxLive, sentLive] = await Promise.all([
      searchMessages(user.email, password, IMAP_FOLDERS.INBOX, query, limit, trace, {
        requestId: `${requestId}-inbox`,
        fetchStrategy: 'parallel'
      }),
      searchMessages(user.email, password, IMAP_FOLDERS.SENT, query, limit, trace, {
        requestId: `${requestId}-sent`,
        fetchStrategy: 'parallel'
      })
    ]);

    const live = [
      ...inboxLive.map((message) => normalizeImapMessage(message, 'INBOX', user.email)),
      ...sentLive.map((message) => normalizeImapMessage(message, 'SENT', user.email))
    ];

    const merged = sortByDateDesc(dedupeById([...cachedMessages, ...live])).slice(0, limit);
    pushTrace(trace, 'API', 'success', 'messages_search_complete', `Search completed with ${merged.length} results.`, {
      details: `requestId=${requestId}; source=mixed; cache=${cachedMessages.length}; live=${live.length}`
    });

    return res.status(200).json({
      success: true,
      messages: merged,
      count: merged.length,
      source: 'mixed',
      trace
    });
  } catch (error) {
    if (!hasSpecificFailure(trace)) {
      pushTrace(trace, 'API', 'error', 'messages_search_failed', 'Search failed.', {
        code: error?.code || 'BACKEND_UNAVAILABLE',
        details: error?.message || 'Unexpected backend error'
      });
    }
    const payload = buildErrorResponse(error, trace);
    return res.status(payload.status).json(payload.body);
  }
});

router.post('/sync', async (req, res) => {
  const trace = [];
  const requestId = createRequestId('sync');

  try {
    pushTrace(trace, 'API', 'info', 'messages_sync_received', 'Manual sync request received.', {
      details: `requestId=${requestId}`
    });
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      pushTrace(trace, 'API', 'error', 'messages_sync_invalid', 'A connected user ID is required to sync.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'userId is required.', 400, { trace });
    }

    console.log(`[Messages] requestId=${requestId} force-sync requested for userId ${userId}`);

    const user = await getUser(userId, trace, requestId);
    pushTrace(trace, 'API', 'success', 'messages_sync_user_loaded', 'Connected user loaded successfully.');
    pushTrace(trace, 'API', 'info', 'messages_sync_imap_start', 'Starting manual Gmail sync.', {
      details: `requestId=${requestId}; fetchStrategy=parallel`
    });
    const fresh = await fetchFromImap(user, ['INBOX', 'SENT'], 100, trace, {
      requestId,
      fetchStrategy: 'parallel'
    });
    await upsertMessages(userId, fresh, trace, requestId);
    await updateLastSync(userId, trace, requestId);

    console.log(`[Messages] requestId=${requestId} force-sync completed - synced ${fresh.length} messages`);
    const counts = buildCounts(fresh);
    pushTrace(trace, 'API', 'success', 'messages_sync_complete', `Manual sync completed: ${fresh.length} messages.`, {
      details: `requestId=${requestId}; inbox=${counts.inboxCount}; sent=${counts.sentCount}`
    });

    return res.status(200).json({
      success: true,
      synced: fresh.length,
      trace
    });
  } catch (error) {
    if (!hasSpecificFailure(trace)) {
      pushTrace(trace, 'API', 'error', 'messages_sync_failed', 'Manual sync failed.', {
        code: error?.code || 'BACKEND_UNAVAILABLE',
        details: error?.message || 'Unexpected backend error'
      });
    }
    const payload = buildErrorResponse(error, trace);
    return res.status(payload.status).json(payload.body);
  }
});

export default router;
