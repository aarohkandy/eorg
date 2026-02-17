'use strict';

const state = {
  settings: null,
  providers: {}
};

const el = {
  form: document.getElementById('settings-form'),
  provider: document.getElementById('provider'),
  model: document.getElementById('model'),
  baseURL: document.getElementById('base-url'),
  apiKey: document.getElementById('api-key'),
  preserveKey: document.getElementById('preserve-key'),
  indexingConsent: document.getElementById('indexing-consent'),
  indexingEnabled: document.getElementById('indexing-enabled'),
  safeMode: document.getElementById('safe-mode'),
  status: document.getElementById('status'),
  testConnection: document.getElementById('test-connection')
};

init().catch((error) => setStatus(error.message, true));

async function init() {
  const providersRes = await sendMessage({ type: 'GET_PROVIDER_OPTIONS' });
  state.providers = providersRes.providers || {};

  for (const [id, info] of Object.entries(state.providers)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = info.label;
    el.provider.appendChild(option);
  }

  const settingsRes = await sendMessage({ type: 'GET_SETTINGS' });
  state.settings = settingsRes.settings;
  hydrateForm(state.settings);

  el.provider.addEventListener('change', onProviderChange);
  el.testConnection.addEventListener('click', onTestConnection);
  el.form.addEventListener('submit', onSave);
}

function hydrateForm(settings) {
  el.provider.value = settings.provider;
  el.model.value = settings.model;
  el.baseURL.value = settings.baseURL;
  el.apiKey.value = '';
  el.preserveKey.checked = settings.hasApiKey;
  el.preserveKey.disabled = !settings.hasApiKey;
  el.indexingConsent.checked = Boolean(settings.indexingConsent);
  el.indexingEnabled.checked = Boolean(settings.indexingEnabled);
  el.safeMode.checked = Boolean(settings.safeMode);
}

function onProviderChange() {
  const current = state.providers[el.provider.value];
  if (!current) {
    return;
  }
  el.baseURL.value = current.baseURL;
  el.model.value = current.model;
}

async function onTestConnection() {
  const old = el.testConnection.textContent;
  el.testConnection.disabled = true;
  el.testConnection.textContent = 'Testing...';
  setStatus('Testing provider connection...');

  try {
    await sendMessage({ type: 'SAVE_SETTINGS', settings: collectPayload() });
    const result = await sendMessage({ type: 'TEST_CONNECTION' });
    setStatus(result.result.message || 'Connection successful');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    el.testConnection.disabled = false;
    el.testConnection.textContent = old;
  }
}

async function onSave(event) {
  event.preventDefault();
  setStatus('Saving settings...');

  try {
    const result = await sendMessage({ type: 'SAVE_SETTINGS', settings: collectPayload() });
    state.settings = result.settings;
    hydrateForm(state.settings);
    setStatus('Settings saved');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function collectPayload() {
  return {
    provider: el.provider.value,
    baseURL: el.baseURL.value.trim(),
    model: el.model.value.trim(),
    apiKey: el.apiKey.value.trim(),
    preserveApiKey: Boolean(el.preserveKey.checked),
    indexingConsent: Boolean(el.indexingConsent.checked),
    indexingEnabled: Boolean(el.indexingEnabled.checked),
    safeMode: Boolean(el.safeMode.checked)
  };
}

function setStatus(message, isError) {
  el.status.textContent = message || '';
  el.status.classList.toggle('error', Boolean(isError));
}

function sendMessage(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!response || !response.ok) {
        reject(new Error((response && response.error) || 'Unknown extension error'));
        return;
      }
      resolve(response);
    });
  });
}
