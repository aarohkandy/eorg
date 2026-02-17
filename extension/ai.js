(function initEorgAi(global) {
  'use strict';

  const DEFAULTS = {
    openai: { baseURL: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    groq: { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
    openrouter: { baseURL: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
    ollama: { baseURL: 'http://localhost:11434/v1', model: 'llama3.1' }
  };

  async function getSettings() {
    const raw = await chrome.storage.local.get('eorg_settings');
    const settings = raw.eorg_settings || {};
    const provider = settings.provider || 'openai';
    const defaults = DEFAULTS[provider] || DEFAULTS.openai;

    return {
      provider,
      baseURL: settings.baseURL || defaults.baseURL,
      model: settings.model || defaults.model,
      apiKey: settings.apiKey || ''
    };
  }

  async function fetchJSON(url, options) {
    const response = await fetch(url, options);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = data.error && data.error.message ? data.error.message : JSON.stringify(data).slice(0, 200);
      throw new Error('AI request failed (' + response.status + '): ' + detail);
    }
    return data;
  }

  async function chat(messages, options = {}) {
    const settings = await getSettings();
    const headers = { 'Content-Type': 'application/json' };
    if (settings.provider !== 'ollama' && settings.apiKey) {
      headers.Authorization = 'Bearer ' + settings.apiKey;
    }

    const body = {
      model: options.model || settings.model,
      messages,
      max_tokens: options.maxTokens || 1000,
      temperature: typeof options.temperature === 'number' ? options.temperature : 0.2
    };

    const data = await fetchJSON(settings.baseURL.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    return data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content
      : '';
  }

  async function embed(input, options = {}) {
    const settings = await getSettings();
    const headers = { 'Content-Type': 'application/json' };
    if (settings.provider !== 'ollama' && settings.apiKey) {
      headers.Authorization = 'Bearer ' + settings.apiKey;
    }

    const body = {
      model: options.model || settings.model,
      input
    };

    const data = await fetchJSON(settings.baseURL.replace(/\/$/, '') + '/embeddings', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });

    return (data.data || []).map((item) => item.embedding);
  }

  global.EorgAI = { chat, embed, getSettings };
})(window);
