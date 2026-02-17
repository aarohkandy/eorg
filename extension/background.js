'use strict';

const SETTINGS_KEY = 'eorg_settings';
const INDEXER_KEY = 'eorg_indexer';

const PROVIDERS = {
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyRequired: true },
  groq: { label: 'Groq', baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyRequired: true },
  openrouter: { label: 'OpenRouter', baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keyRequired: true },
  ollama: { label: 'Ollama', baseURL: 'http://localhost:11434/v1', model: 'llama3.1', keyRequired: false }
};

const DEFAULT_SETTINGS = {
  schemaVersion: 1,
  provider: 'openai',
  baseURL: PROVIDERS.openai.baseURL,
  model: PROVIDERS.openai.model,
  apiKey: '',
  indexingConsent: false,
  indexingEnabled: false,
  safeMode: false,
  featureFlags: {
    reskin: true,
    commandBar: true,
    ai: true,
    indexer: true,
    semanticSearch: true
  },
  updatedAt: null
};

chrome.runtime.onInstalled.addListener(async () => {
  await ensureInitialized();
});

chrome.runtime.onStartup.addListener(async () => {
  await ensureInitialized();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  handleMessage(message)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((error) => sendResponse({ ok: false, error: error.message || 'Unknown error' }));
  return true;
});

async function handleMessage(message) {
  if (!message || typeof message !== 'object') {
    throw new Error('Invalid message payload');
  }

  switch (message.type) {
    case 'GET_SETTINGS':
      return { settings: sanitizeSettings(await getSettings()) };
    case 'SAVE_SETTINGS': {
      const saved = await saveSettings(message.settings || {});
      return { settings: sanitizeSettings(saved) };
    }
    case 'GET_PROVIDER_OPTIONS':
      return { providers: PROVIDERS };
    case 'TEST_CONNECTION': {
      const settings = await getSettings();
      const result = await testConnection(settings);
      return { result };
    }
    case 'INDEX_STATUS': {
      const status = await chrome.storage.local.get(INDEXER_KEY);
      return { status: status[INDEXER_KEY] || { state: 'idle', indexedCount: 0 } };
    }
    case 'INDEX_STATUS_SET':
      await chrome.storage.local.set({ [INDEXER_KEY]: message.status || { state: 'idle', indexedCount: 0 } });
      return {};
    default:
      throw new Error('Unsupported message type: ' + message.type);
  }
}

async function ensureInitialized() {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  const existing = raw[SETTINGS_KEY];
  if (!existing) {
    await chrome.storage.local.set({ [SETTINGS_KEY]: { ...DEFAULT_SETTINGS, updatedAt: nowIso() } });
    return;
  }
  const merged = mergeSettings(existing);
  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
}

async function getSettings() {
  const raw = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(raw[SETTINGS_KEY]);
}

async function saveSettings(input) {
  const current = await getSettings();
  const merged = mergeSettings({ ...current, ...input });

  if (input.preserveApiKey && !String(input.apiKey || '').trim()) {
    merged.apiKey = current.apiKey;
  }

  validateSettings(merged);
  merged.updatedAt = nowIso();

  await chrome.storage.local.set({ [SETTINGS_KEY]: merged });
  return merged;
}

function mergeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings || {}),
    featureFlags: {
      ...DEFAULT_SETTINGS.featureFlags,
      ...((settings && settings.featureFlags) || {})
    }
  };
}

function validateSettings(settings) {
  if (!PROVIDERS[settings.provider]) {
    throw new Error('Invalid provider');
  }

  let url;
  try {
    url = new URL(settings.baseURL);
  } catch (_e) {
    throw new Error('Base URL must be a valid URL');
  }

  if (settings.provider !== 'ollama' && url.protocol !== 'https:') {
    throw new Error('Base URL must use HTTPS for remote providers');
  }

  if (!String(settings.model || '').trim()) {
    throw new Error('Model is required');
  }

  if (PROVIDERS[settings.provider].keyRequired && !String(settings.apiKey || '').trim()) {
    throw new Error('API key is required for this provider');
  }

  if (settings.indexingEnabled && !settings.indexingConsent) {
    throw new Error('Enable indexing only after consent is checked');
  }
}

function sanitizeSettings(settings) {
  return {
    ...settings,
    hasApiKey: Boolean(settings.apiKey),
    apiKey: ''
  };
}

async function testConnection(settings) {
  const provider = PROVIDERS[settings.provider];
  if (!provider) {
    throw new Error('Unsupported provider');
  }

  const endpoint = settings.baseURL.replace(/\/$/, '') + '/chat/completions';
  const headers = { 'Content-Type': 'application/json' };
  if (settings.provider !== 'ollama') {
    headers.Authorization = 'Bearer ' + settings.apiKey;
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'user', content: 'Reply with OK.' }],
      max_tokens: 8
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error('Connection failed (' + response.status + '): ' + text.slice(0, 160));
  }

  return { ok: true, message: 'Connection successful' };
}

function nowIso() {
  return new Date().toISOString();
}
