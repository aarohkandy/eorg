/* global chrome */

const BACKEND_URL = 'https://email-bcknd.onrender.com';
const FETCH_TIMEOUT_MS = 12000;
const COLD_START_MESSAGE =
  'Backend server is starting up, please wait 60 seconds and try again.';

function coldStartError() {
  return {
    success: false,
    code: 'BACKEND_COLD_START',
    error: COLD_START_MESSAGE,
    retriable: true,
    retryAfterSec: 60
  };
}

function normalizeError(payload, fallbackCode = 'BACKEND_UNAVAILABLE') {
  if (!payload || typeof payload !== 'object') {
    return {
      success: false,
      code: fallbackCode,
      error: 'Backend returned an invalid response.'
    };
  }

  return {
    success: false,
    code: payload.code || fallbackCode,
    error: payload.error || 'Backend request failed.',
    retriable: payload.retriable,
    retryAfterSec: payload.retryAfterSec
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
      return coldStartError();
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok || !data?.success) {
      return normalizeError(data, response.status === 401 ? 'NOT_CONNECTED' : 'BACKEND_UNAVAILABLE');
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError' || String(error.message || '').includes('Failed to fetch')) {
      console.error('[Extension SW ERROR] Backend cold start detected (Render sleeping). Retry in 60s.');
      return coldStartError();
    }

    return {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error.message || 'Backend request failed.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchHealth() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      signal: controller.signal
    });

    if ([502, 503, 504].includes(response.status)) {
      return coldStartError();
    }

    let data = null;
    try {
      data = await response.json();
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        success: false,
        code: 'BACKEND_UNAVAILABLE',
        error: 'Backend health check failed.'
      };
    }

    return {
      success: true,
      status: data?.status || 'ok',
      timestamp: data?.timestamp || null,
      uptime: data?.uptime
    };
  } catch (error) {
    if (error.name === 'AbortError' || String(error.message || '').includes('Failed to fetch')) {
      return coldStartError();
    }
    return {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error.message || 'Backend health check failed.'
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

async function handleBackendAction(message) {
  const action = message?.action;
  const payload = message?.payload || {};

  if (action === 'CONNECT') {
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

    if (response.success) {
      await chrome.storage.local.clear();
    }

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

    const response = await fetchBackend(`/api/messages?${params.toString()}`);
    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
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
    return fetchBackend(`/api/messages/search?${params.toString()}`);
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

    const response = await fetchBackend('/api/messages/sync', {
      method: 'POST',
      body: JSON.stringify({ userId })
    });

    if (response.success) {
      await chrome.storage.local.set({ lastSyncTime: new Date().toISOString() });
    }

    return response;
  }

  if (action === 'HEALTH_CHECK') {
    return fetchHealth();
  }

  if (action === 'GET_STORAGE') {
    const stored = await getStoredUser();
    return { success: true, ...stored };
  }

  return null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message) {
    return false;
  }

  // Preserve legacy InboxSDK page-world injection.
  if (message.type === 'inboxsdk__injectPageWorld') {
    const tabId = sender && sender.tab && Number.isInteger(sender.tab.id)
      ? Number(sender.tab.id)
      : null;

    if (tabId === null) {
      sendResponse(false);
      return false;
    }

    (async () => {
      try {
        const target = { tabId };
        if (Number.isInteger(sender.frameId) && sender.frameId >= 0) {
          target.frameIds = [sender.frameId];
        }

        await chrome.scripting.executeScript({
          target,
          files: ['pageWorld.js'],
          world: 'MAIN'
        });

        sendResponse(true);
      } catch (error) {
        console.warn('[reskin] Failed to inject InboxSDK pageWorld.js', error);
        sendResponse(false);
      }
    })();

    return true;
  }

  if (typeof message.action === 'string') {
    handleBackendAction(message)
      .then((result) => {
        if (result) {
          sendResponse(result);
        } else {
          sendResponse({
            success: false,
            code: 'BACKEND_UNAVAILABLE',
            error: `Unknown action: ${message.action}`
          });
        }
      })
      .catch((error) => {
        console.error('[Extension SW ERROR]', error?.message || error);
        sendResponse({
          success: false,
          code: 'BACKEND_UNAVAILABLE',
          error: error?.message || 'Unhandled background error.'
        });
      });

    return true;
  }

  return false;
});
