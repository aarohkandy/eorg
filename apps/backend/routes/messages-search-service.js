import { decrypt } from '../lib/crypto.js';
import { AppError, pushTrace } from '../lib/errors.js';
import { searchMessages } from '../lib/imap.js';
import { mapRowToMessage, normalizeImapMessage } from '../lib/message-normalize.js';
import {
  IMAP_FOLDERS,
  dedupeById,
  pushDbTrace,
  sortByDateDesc
} from './messages-params.js';
import { searchCachedMessageRows } from './messages-repository.js';

export async function searchMessagesForUser(userId, user, query, limit, trace = [], requestId = '') {
  const ilike = `%${query}%`;
  pushDbTrace(trace, 'info', 'db_search_cache_started', 'Searching cached messages in Supabase.', {
    details: `requestId=${requestId}; limit=${limit}`
  });
  const { data: cachedRows, error } = await searchCachedMessageRows(userId, ilike, limit);

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
    return {
      messages: cachedMessages,
      source: 'cache'
    };
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

  return {
    messages: merged,
    source: 'mixed'
  };
}
