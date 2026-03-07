const BACKEND_URL = 'https://YOUR-APP-NAME.onrender.com';
const FETCH_TIMEOUT_MS = 12000;

const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';

function backendColdStartError() {
  return {
    success: false,
    code: 'BACKEND_COLD_START',
    error: COLD_START_MESSAGE,
    retriable: true,
    retryAfterSec: 60
  };
}

function normalizeApiError(response, fallbackCode = 'BACKEND_UNAVAILABLE') {
  if (!response || typeof response !== 'object') {
    return {
      success: false,
      code: fallbackCode,
      error: 'Backend returned an invalid response.'
    };
  }

  return {
    success: false,
    code: response.code || fallbackCode,
    error: response.error || 'Backend request failed.',
    retriable: response.retriable,
    retryAfterSec: response.retryAfterSec
  };
}

async function fetchBackend(path, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });

    if ([502, 503, 504].includes(response.status)) {
      console.error('[Extension SW ERROR] Backend cold start detected (Render sleeping). Retry in 60s.');
      return backendColdStartError();
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      const normalized = normalizeApiError(data, response.status === 401 ? 'NOT_CONNECTED' : 'BACKEND_UNAVAILABLE');
      console.error(`[Extension SW ERROR] ${normalized.code}: ${normalized.error}`);
      return normalized;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError' || String(error.message || '').includes('Failed to fetch')) {
      console.error('[Extension SW ERROR] Backend cold start detected (Render sleeping). Retry in 60s.');
      return backendColdStartError();
    }

    console.error(`[Extension SW ERROR] Backend unreachable: ${error.message}`);
    return {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error.message || 'Backend request failed.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function getStoredUser() {
  const { userId, userEmail, lastSyncTime } = await chrome.storage.local.get([
    'userId',
    'userEmail',
    'lastSyncTime'
  ]);
  return { userId, userEmail, lastSyncTime };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then(sendResponse)
    .catch((error) => {
      console.error(`[Extension SW ERROR] ${error.message}`);
      sendResponse({
        success: false,
        code: 'BACKEND_UNAVAILABLE',
        error: error.message || 'Unhandled service worker error.'
      });
    });

  return true;
});

async function handleMessage(message) {
  const action = message?.action;
  const payload = message?.payload || {};

  if (action === 'CONNECT') {
    console.log(`[Extension] Connecting user: ${payload.email || ''}`);
    const response = await fetchBackend('/api/auth/connect', {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    if (response.success) {
      await chrome.storage.local.set({
        userId: response.userId,
        userEmail: response.email,
        lastSyncTime: null
      });
      console.log(`[Extension] User connected successfully: ${response.email}`);
    }

    return response;
  }

  if (action === 'DISCONNECT') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const response = await fetchBackend('/api/auth/disconnect', {
      method: 'DELETE',
      body: JSON.stringify({ userId })
    });

    await chrome.storage.local.clear();
    console.log('[Extension] User disconnected');
    return response;
  }

  if (action === 'FETCH_MESSAGES') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const params = new URLSearchParams({
      userId,
      folder: payload.folder || 'all',
      limit: String(payload.limit || 50),
      forceSync: String(Boolean(payload.forceSync))
    });

    console.log(`[Extension] Fetching messages for userId: ${userId}`);
    const response = await fetchBackend(`/api/messages?${params.toString()}`);

    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
      console.log(
        `[Extension] Received ${response.count} messages (${response.inboxCount} inbox, ${response.sentCount} sent)`
      );
    }

    return response;
  }

  if (action === 'SEARCH_MESSAGES') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    const params = new URLSearchParams({
      userId,
      query: payload.query || '',
      limit: String(payload.limit || 20)
    });

    const response = await fetchBackend(`/api/messages/search?${params.toString()}`);
    if (response.success) {
      console.log(`[Extension] Search query: "${payload.query || ''}" - found ${response.count} results`);
    }

    return response;
  }

  if (action === 'SYNC_MESSAGES') {
    const { userId } = await getStoredUser();
    if (!userId) {
      return {
        success: false,
        code: 'NOT_CONNECTED',
        error: 'Not connected. Please set up the extension.'
      };
    }

    console.log('[Extension] Force-sync triggered');
    const response = await fetchBackend('/api/messages/sync', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
    }

    return response;
  }

  if (action === 'GET_STORAGE') {
    const stored = await getStoredUser();
    return { success: true, ...stored };
  }

  return {
    success: false,
    code: 'BACKEND_UNAVAILABLE',
    error: `Unknown action: ${String(action || '')}`
  };
}
