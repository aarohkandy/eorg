import express from 'express';
import { AppError, buildErrorResponse, pushTrace } from '../lib/errors.js';
import {
  buildCounts,
  createRequestId,
  getRequestedFolders,
  hasSpecificFailure,
  parseBoolean,
  parseFolder,
  parseLimit,
  sortByDateDesc
} from './messages-params.js';
import { loadCachedMessages, loadLatestCacheTimestamp, upsertMessages } from './messages-cache.js';
import { getUser, updateLastSync } from './messages-repository.js';
import { searchMessagesForUser } from './messages-search-service.js';
import { fetchFromImap } from './messages-sync-service.js';

const router = express.Router();

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

    if (!forceSync) {
      const latestCacheTimestamp = await loadLatestCacheTimestamp(userId, requestedFolders, trace, requestId);
      const ageMs = latestCacheTimestamp ? Date.now() - latestCacheTimestamp : Number.POSITIVE_INFINITY;

      if (ageMs < 5 * 60 * 1000) {
        const cached = await loadCachedMessages(userId, requestedFolders, fetchLimit, trace, requestId);
        const sortedCached = sortByDateDesc(cached).slice(0, fetchLimit);
        const counts = buildCounts(sortedCached);
        const ageSec = Math.max(0, Math.floor(ageMs / 1000));
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
          trace
        });
      }
    }

    pushTrace(trace, 'API', 'info', 'messages_cache_miss', 'Cache is stale or empty. Fetching from Gmail.');
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
    pushTrace(trace, 'API', 'success', 'messages_imap_fetch_complete', `Mailbox sync complete: ${fresh.length} messages loaded.`, {
      details: `requestId=${requestId}; inbox=${counts.inboxCount}; sent=${counts.sentCount}`
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

    const result = await searchMessagesForUser(userId, user, query, limit, trace, requestId);

    return res.status(200).json({
      success: true,
      messages: result.messages,
      count: result.messages.length,
      source: result.source,
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
