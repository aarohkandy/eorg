import express from 'express';
import { supabase } from '../lib/supabase.js';
import { decrypt } from '../lib/crypto.js';
import { fetchMessages, searchMessages } from '../lib/imap.js';
import {
  normalizeImapMessage,
  mapMessageToRow,
  mapRowToMessage
} from '../lib/message-normalize.js';
import { AppError, buildErrorResponse } from '../lib/errors.js';

const router = express.Router();

const IMAP_FOLDERS = {
  INBOX: 'INBOX',
  SENT: '[Gmail]/Sent Mail'
};

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

async function getUser(userId) {
  const { data, error } = await supabase
    .from('users')
    .select('id, email, encrypted_password, last_sync')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
  }

  if (!data) {
    throw new AppError('NOT_CONNECTED', 'User not found. Please reconnect the extension.', 401);
  }

  return data;
}

async function loadCachedMessages(userId, folders, limit) {
  const query = supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .in('folder', folders)
    .order('date', { ascending: false })
    .limit(limit);

  const { data, error } = await query;
  if (error) {
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
  }

  return (data || []).map(mapRowToMessage);
}

async function loadLatestCacheTimestamp(userId, folders) {
  const { data, error } = await supabase
    .from('messages')
    .select('cached_at')
    .eq('user_id', userId)
    .in('folder', folders)
    .order('cached_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
  }

  return data?.cached_at ? new Date(data.cached_at).getTime() : 0;
}

async function pruneOldCache(userId, folder) {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { error } = await supabase
    .from('messages')
    .delete()
    .eq('user_id', userId)
    .eq('folder', folder)
    .lt('cached_at', cutoff);

  if (error) {
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
  }
}

async function upsertMessages(userId, messages) {
  if (!messages.length) return;

  const byFolder = messages.reduce((acc, message) => {
    if (!acc[message.folder]) acc[message.folder] = [];
    acc[message.folder].push(message);
    return acc;
  }, {});

  for (const folder of Object.keys(byFolder)) {
    await pruneOldCache(userId, folder);
  }

  const rows = messages.map((message) => mapMessageToRow(message, userId));
  const { error } = await supabase.from('messages').upsert(rows, { onConflict: 'id' });
  if (error) {
    throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
  }
}

async function fetchFromImap(user, requestedFolders, limit) {
  const password = decrypt(user.encrypted_password);

  const tasks = requestedFolders.map(async (folder) => {
    const imapFolder = IMAP_FOLDERS[folder];
    const rawMessages = await fetchMessages(user.email, password, imapFolder, limit);
    return rawMessages.map((message) => normalizeImapMessage(message, folder, user.email));
  });

  const results = await Promise.all(tasks);
  return sortByDateDesc(dedupeById(results.flat()));
}

function buildCounts(messages) {
  const inboxCount = messages.filter((message) => message.folder === 'INBOX').length;
  const sentCount = messages.filter((message) => message.folder === 'SENT').length;
  return { inboxCount, sentCount };
}

router.get('/', async (req, res) => {
  try {
    const userId = String(req.query?.userId || '').trim();
    if (!userId) {
      throw new AppError('NOT_CONNECTED', 'userId query parameter is required.', 400);
    }

    const folder = parseFolder(req.query?.folder);
    const limit = parseLimit(req.query?.limit, 50);
    const forceSync = parseBoolean(req.query?.forceSync);
    const requestedFolders = getRequestedFolders(folder);
    const fetchLimit = folder === 'all' ? limit * 2 : limit;

    console.log(`[Messages] Fetching for userId ${userId}`);

    const user = await getUser(userId);

    if (!forceSync) {
      const latestCacheTimestamp = await loadLatestCacheTimestamp(userId, requestedFolders);
      const ageMs = latestCacheTimestamp ? Date.now() - latestCacheTimestamp : Number.POSITIVE_INFINITY;

      if (ageMs < 5 * 60 * 1000) {
        const cached = await loadCachedMessages(userId, requestedFolders, fetchLimit);
        const sortedCached = sortByDateDesc(cached).slice(0, fetchLimit);
        const counts = buildCounts(sortedCached);
        const ageSec = Math.max(0, Math.floor(ageMs / 1000));
        console.log(
          `[Messages] Cache hit for userId ${userId} - returning ${sortedCached.length} cached messages (age: ${ageSec}s)`
        );

        return res.status(200).json({
          success: true,
          messages: sortedCached,
          count: sortedCached.length,
          ...counts
        });
      }
    }

    console.log(`[Messages] Cache miss for userId ${userId} - fetching from IMAP`);
    const fresh = await fetchFromImap(user, requestedFolders, limit);
    await upsertMessages(userId, fresh);

    const now = new Date().toISOString();
    await supabase.from('users').update({ last_sync: now }).eq('id', userId);

    const counts = buildCounts(fresh);
    console.log(
      `[Messages] Normalized ${fresh.length} messages (${counts.inboxCount} inbox, ${counts.sentCount} sent)`
    );
    console.log(`[Messages] Returning ${fresh.length} messages to client`);

    return res.status(200).json({
      success: true,
      messages: fresh,
      count: fresh.length,
      ...counts
    });
  } catch (error) {
    const payload = buildErrorResponse(error);
    return res.status(payload.status).json(payload.body);
  }
});

router.get('/search', async (req, res) => {
  try {
    const userId = String(req.query?.userId || '').trim();
    const query = String(req.query?.query || '').trim();
    const limit = parseLimit(req.query?.limit, 20);

    if (!userId) {
      throw new AppError('NOT_CONNECTED', 'userId query parameter is required.', 400);
    }

    if (!query) {
      throw new AppError('BACKEND_UNAVAILABLE', 'query parameter is required.', 400);
    }

    const user = await getUser(userId);

    const ilike = `%${query}%`;
    const { data: cachedRows, error } = await supabase
      .from('messages')
      .select('*')
      .eq('user_id', userId)
      .or(`subject.ilike.${ilike},from_name.ilike.${ilike},from_email.ilike.${ilike},snippet.ilike.${ilike}`)
      .order('date', { ascending: false })
      .limit(limit);

    if (error) {
      throw new AppError('BACKEND_UNAVAILABLE', error.message, 500);
    }

    const cachedMessages = (cachedRows || []).map(mapRowToMessage);
    if (cachedMessages.length >= 5) {
      return res.status(200).json({
        success: true,
        messages: cachedMessages,
        count: cachedMessages.length,
        source: 'cache'
      });
    }

    const password = decrypt(user.encrypted_password);
    const [inboxLive, sentLive] = await Promise.all([
      searchMessages(user.email, password, IMAP_FOLDERS.INBOX, query, limit),
      searchMessages(user.email, password, IMAP_FOLDERS.SENT, query, limit)
    ]);

    const live = [
      ...inboxLive.map((message) => normalizeImapMessage(message, 'INBOX', user.email)),
      ...sentLive.map((message) => normalizeImapMessage(message, 'SENT', user.email))
    ];

    const merged = sortByDateDesc(dedupeById([...cachedMessages, ...live])).slice(0, limit);

    return res.status(200).json({
      success: true,
      messages: merged,
      count: merged.length,
      source: 'mixed'
    });
  } catch (error) {
    const payload = buildErrorResponse(error);
    return res.status(payload.status).json(payload.body);
  }
});

router.post('/sync', async (req, res) => {
  try {
    const userId = String(req.body?.userId || '').trim();
    if (!userId) {
      throw new AppError('NOT_CONNECTED', 'userId is required.', 400);
    }

    console.log(`[Messages] Force-sync requested for userId ${userId}`);

    const user = await getUser(userId);
    const fresh = await fetchFromImap(user, ['INBOX', 'SENT'], 100);
    await upsertMessages(userId, fresh);

    const now = new Date().toISOString();
    await supabase.from('users').update({ last_sync: now }).eq('id', userId);

    console.log(`[Messages] Force-sync completed - synced ${fresh.length} messages`);

    return res.status(200).json({
      success: true,
      synced: fresh.length
    });
  } catch (error) {
    const payload = buildErrorResponse(error);
    return res.status(payload.status).json(payload.body);
  }
});

export default router;
