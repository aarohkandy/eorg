import { supabase } from '../lib/supabase.js';
import { AppError } from '../lib/errors.js';
import { appendDetails, pushDbTrace } from './messages-params.js';

export async function getUser(userId, trace = [], requestId = '') {
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

export async function loadCachedMessageRows(userId, folders, limit) {
  const query = supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .in('folder', folders)
    .order('date', { ascending: false })
    .limit(limit);

  return query;
}

export async function loadLatestCacheTimestampRow(userId, folders) {
  return supabase
    .from('messages')
    .select('cached_at')
    .eq('user_id', userId)
    .in('folder', folders)
    .order('cached_at', { ascending: false })
    .limit(1)
    .maybeSingle();
}

export async function deleteCachedMessageRowsBefore(userId, folder, cutoff) {
  return supabase
    .from('messages')
    .delete()
    .eq('user_id', userId)
    .eq('folder', folder)
    .lt('cached_at', cutoff);
}

export async function upsertMessageRows(rows) {
  return supabase.from('messages').upsert(rows, { onConflict: 'id' });
}

export async function updateLastSync(userId, trace = [], requestId = '') {
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

export async function searchCachedMessageRows(userId, ilike, limit) {
  return supabase
    .from('messages')
    .select('*')
    .eq('user_id', userId)
    .or(`subject.ilike.${ilike},from_name.ilike.${ilike},from_email.ilike.${ilike},snippet.ilike.${ilike}`)
    .order('date', { ascending: false })
    .limit(limit);
}
