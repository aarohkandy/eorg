import express from 'express';
import { supabase } from '../lib/supabase.js';
import { decrypt } from '../lib/crypto.js';
import { fetchMessages, searchMessages } from '../lib/imap.js';
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

async function getUser(userId, trace = []) {
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
  return data;
}

async function loadCachedMessages(userId, folders, limit, trace = []) {
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
    details: `Folders ${folders.join(', ')}; limit ${limit}.`
  });
  return (data || []).map(mapRowToMessage);
}

async function loadLatestCacheTimestamp(userId, folders, trace = []) {
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
    details: data?.cached_at ? `Newest cached row at ${data.cached_at}.` : 'No cached rows were found.'
  });
  return data?.cached_at ? new Date(data.cached_at).getTime() : 0;
}

async function pruneOldCache(userId, folder, trace = []) {
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
      details: error.message
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }
}

async function upsertMessages(userId, messages, trace = []) {
  if (!messages.length) return;

  const byFolder = messages.reduce((acc, message) => {
    if (!acc[message.folder]) acc[message.folder] = [];
    acc[message.folder].push(message);
    return acc;
  }, {});

  pushDbTrace(trace, 'info', 'db_messages_upsert_started', 'Saving synced messages to Supabase.', {
    details: `Rows ${messages.length}; folders ${Object.keys(byFolder).join(', ')}.`
  });
  for (const folder of Object.keys(byFolder)) {
    await pruneOldCache(userId, folder, trace);
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

  pushDbTrace(trace, 'success', 'db_messages_upsert_complete', `Saved ${rows.length} messages to Supabase.`);
}

async function fetchFromImap(user, requestedFolders, limit, trace = []) {
  const password = decrypt(user.encrypted_password);

  const tasks = requestedFolders.map(async (folder) => {
    const imapFolder = IMAP_FOLDERS[folder];
    const rawMessages = await fetchMessages(user.email, password, imapFolder, limit, trace);
    return rawMessages.map((message) => normalizeImapMessage(message, folder, user.email));
  });

  const results = await Promise.all(tasks);
  return sortByDateDesc(dedupeById(results.flat()));
}

async function updateLastSync(userId, trace = []) {
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
    details: now
  });
}

function buildCounts(messages) {
  const inboxCount = messages.filter((message) => message.folder === 'INBOX').length;
  const sentCount = messages.filter((message) => message.folder === 'SENT').length;
  return { inboxCount, sentCount };
}

router.get('/', async (req, res) => {
  const trace = [];

  try {
    pushTrace(trace, 'API', 'info', 'messages_fetch_received', 'Mailbox load request received.');
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
      details: `folder=${folder}; limit=${limit}; forceSync=${forceSync}`
    });

    console.log(`[Messages] Fetching for userId ${userId}`);

    const user = await getUser(userId, trace);
    pushTrace(trace, 'API', 'success', 'messages_user_loaded', 'Connected user loaded successfully.');

    if (!forceSync) {
      const latestCacheTimestamp = await loadLatestCacheTimestamp(userId, requestedFolders, trace);
      const ageMs = latestCacheTimestamp ? Date.now() - latestCacheTimestamp : Number.POSITIVE_INFINITY;

      if (ageMs < 5 * 60 * 1000) {
        const cached = await loadCachedMessages(userId, requestedFolders, fetchLimit, trace);
        const sortedCached = sortByDateDesc(cached).slice(0, fetchLimit);
        const counts = buildCounts(sortedCached);
        const ageSec = Math.max(0, Math.floor(ageMs / 1000));
        pushTrace(trace, 'API', 'info', 'messages_cache_hit', `Using cached messages (${sortedCached.length} total).`, {
          details: `Cache age ${ageSec}s. Inbox ${counts.inboxCount}, Sent ${counts.sentCount}.`
        });
        console.log(
          `[Messages] Cache hit for userId ${userId} - returning ${sortedCached.length} cached messages (age: ${ageSec}s)`
        );

        return res.status(200).json({
          success: true,
          messages: sortedCached,
          count: sortedCached.length,
          ...counts,
          trace
        });
      }
    }

    pushTrace(trace, 'API', 'info', 'messages_cache_miss', 'Cache is stale or empty. Fetching from Gmail.');
    console.log(`[Messages] Cache miss for userId ${userId} - fetching from IMAP`);
    pushTrace(trace, 'API', 'info', 'messages_imap_fetch_start', 'Starting Gmail mailbox sync.');
    const fresh = await fetchFromImap(user, requestedFolders, limit, trace);
    await upsertMessages(userId, fresh, trace);
    await updateLastSync(userId, trace);

    const counts = buildCounts(fresh);
    pushTrace(trace, 'API', 'success', 'messages_imap_fetch_complete', `Mailbox sync complete: ${fresh.length} messages loaded.`, {
      details: `Inbox ${counts.inboxCount}, Sent ${counts.sentCount}.`
    });
    console.log(
      `[Messages] Normalized ${fresh.length} messages (${counts.inboxCount} inbox, ${counts.sentCount} sent)`
    );
    console.log(`[Messages] Returning ${fresh.length} messages to client`);

    return res.status(200).json({
      success: true,
      messages: fresh,
      count: fresh.length,
      ...counts,
      trace
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

router.get('/search', async (req, res) => {
  const trace = [];

  try {
    pushTrace(trace, 'API', 'info', 'messages_search_received', 'Search request received.');
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
      details: `limit=${limit}`
    });
    const user = await getUser(userId, trace);
    pushTrace(trace, 'API', 'success', 'messages_search_user_loaded', 'Connected user loaded successfully.');

    const ilike = `%${query}%`;
    pushDbTrace(trace, 'info', 'db_search_cache_started', 'Searching cached messages in Supabase.');
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
    pushDbTrace(trace, 'success', 'db_search_cache_complete', `Loaded ${cachedMessages.length} cached search results from Supabase.`);
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
    pushTrace(trace, 'API', 'info', 'messages_search_live_start', 'Falling back to live Gmail search.');
    const [inboxLive, sentLive] = await Promise.all([
      searchMessages(user.email, password, IMAP_FOLDERS.INBOX, query, limit, trace),
      searchMessages(user.email, password, IMAP_FOLDERS.SENT, query, limit, trace)
    ]);

    const live = [
      ...inboxLive.map((message) => normalizeImapMessage(message, 'INBOX', user.email)),
      ...sentLive.map((message) => normalizeImapMessage(message, 'SENT', user.email))
    ];

    const merged = sortByDateDesc(dedupeById([...cachedMessages, ...live])).slice(0, limit);
    pushTrace(trace, 'API', 'success', 'messages_search_complete', `Search completed with ${merged.length} results.`, {
      details: `Source=mixed; cache=${cachedMessages.length}; live=${live.length}.`
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

  try {
    pushTrace(trace, 'API', 'info', 'messages_sync_received', 'Manual sync request received.');
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      pushTrace(trace, 'API', 'error', 'messages_sync_invalid', 'A connected user ID is required to sync.', {
        code: 'NOT_CONNECTED'
      });
      throw new AppError('NOT_CONNECTED', 'userId is required.', 400, { trace });
    }

    console.log(`[Messages] Force-sync requested for userId ${userId}`);

    const user = await getUser(userId, trace);
    pushTrace(trace, 'API', 'success', 'messages_sync_user_loaded', 'Connected user loaded successfully.');
    pushTrace(trace, 'API', 'info', 'messages_sync_imap_start', 'Starting manual Gmail sync.');
    const fresh = await fetchFromImap(user, ['INBOX', 'SENT'], 100, trace);
    await upsertMessages(userId, fresh, trace);
    await updateLastSync(userId, trace);

    console.log(`[Messages] Force-sync completed - synced ${fresh.length} messages`);
    const counts = buildCounts(fresh);
    pushTrace(trace, 'API', 'success', 'messages_sync_complete', `Manual sync completed: ${fresh.length} messages.`, {
      details: `Inbox ${counts.inboxCount}, Sent ${counts.sentCount}.`
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
