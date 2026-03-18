import { AppError } from '../lib/errors.js';
import { mapMessageToRow, mapRowToMessage } from '../lib/message-normalize.js';
import { appendDetails, pushDbTrace } from './messages-params.js';
import {
  deleteCachedMessageRowsBefore,
  loadCachedMessageRows,
  loadLatestCacheTimestampRow,
  upsertMessageRows
} from './messages-repository.js';

export async function loadCachedMessages(userId, folders, limit, trace = [], requestId = '') {
  pushDbTrace(trace, 'info', 'db_cache_read_started', 'Loading cached messages from Supabase.');
  const { data, error } = await loadCachedMessageRows(userId, folders, limit);
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

export async function loadLatestCacheTimestamp(userId, folders, trace = [], requestId = '') {
  pushDbTrace(trace, 'info', 'db_cache_freshness_started', 'Checking cached message freshness in Supabase.');
  const { data, error } = await loadLatestCacheTimestampRow(userId, folders);

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

export async function pruneOldCache(userId, folder, trace = [], requestId = '') {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error } = await deleteCachedMessageRowsBefore(userId, folder, cutoff);

  if (error) {
    pushDbTrace(trace, 'error', 'db_cache_prune_failed', `Could not prune cached ${folder} messages.`, {
      code: 'BACKEND_UNAVAILABLE',
      details: appendDetails(error.message, { requestId, folder, cutoff })
    });
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500, { trace });
  }
}

export async function upsertMessages(userId, messages, trace = [], requestId = '') {
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
  const { error } = await upsertMessageRows(rows);
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
