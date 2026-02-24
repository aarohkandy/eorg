(() => {
  "use strict";

  const SETTINGS_KEY = "reskin_ai_settings_v1";
  const LEVELS = ["critical", "high", "medium", "low", "fyi"];
  const GROQ_FREE_MODELS = [
    "llama-3.1-8b-instant",
    "llama-3.3-70b-versatile",
    "meta-llama/llama-4-scout-17b-16e-instruct",
    "meta-llama/llama-4-maverick-17b-128e-instruct"
  ];

  const DEFAULTS = {
    enabled: true,
    consentTriage: false,
    theme: "dark",
    provider: "openrouter",
    apiKey: "",
    apiKeys: [],
    baseURL: "https://openrouter.ai/api/v1",
    model: "openrouter/free",
    batchSize: 25,
    timeoutMs: 30000,
    retryCount: 2,
    retryBackoffMs: 1200,
    maxInputChars: 2200
  };

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
  }

  const keyRotationByProvider = new Map();

  function logTriageDebug(message, extra) {
    const codeMap = {
      "Sending triage request": "A01",
      "AI triage request attempt failed": "A02",
      "AI response produced zero parsed triage items": "A03",
      "Failed to parse AI triage JSON response": "A04",
      "AI triage response did not contain JSON object boundaries": "A05",
      "Retrying without response_format=json_object after 400 response": "A06"
    };
    const enabledCodes = new Set(["A02", "A03", "A04", "A05", "A06"]);
    const now = Date.now();
    if (!logTriageDebug._last) logTriageDebug._last = new Map();
    const key = `${codeMap[message] || "A00"}:${String(extra && extra.error ? extra.error : "")}`;
    const previous = logTriageDebug._last.get(key) || 0;
    const throttleMs = 2500;
    if (throttleMs && now - previous < throttleMs) return;
    logTriageDebug._last.set(key, now);

    const compact = (value) => {
      if (!value || typeof value !== "object") return value;
      const pick = ["provider", "model", "attempt", "maxAttempts", "error", "requestedMessages"];
      return pick
        .filter((k) => typeof value[k] !== "undefined")
        .map((k) => `${k}=${String(value[k]).slice(0, 64)}`)
        .join(" ");
    };

    const code = codeMap[message] || "A00";
    if (!enabledCodes.has(code)) return;
    const details = typeof extra === "undefined" ? "" : compact(extra);
    console.info(`[reskin][td:${code}] ${message}${details ? " | " + details : ""}`);
  }

  function maskKey(key) {
    const raw = normalize(key || "");
    if (!raw) return "(empty)";
    if (raw.length <= 8) return `${raw.slice(0, 2)}***`;
    return `${raw.slice(0, 6)}...${raw.slice(-4)}`;
  }

  function parseApiKeys(value) {
    if (Array.isArray(value)) {
      return value
        .map((item) => normalize(item || ""))
        .filter(Boolean);
    }
    const single = normalize(value || "");
    return single ? [single] : [];
  }

  function validApiKeysForProvider(provider, apiKeys, fallbackApiKey) {
    const fromRows = parseApiKeys(apiKeys);
    const single = normalize(fallbackApiKey || "");
    const combined = [];
    for (const key of [...fromRows, ...(single ? [single] : [])]) {
      if (!combined.includes(key)) combined.push(key);
    }
    if (provider === "openrouter") {
      return combined.filter((key) => key.startsWith("sk-or-"));
    }
    if (provider === "groq") {
      return combined;
    }
    return [];
  }

  function rotateKey(provider, validKeys, attemptOffset = 0) {
    if (!Array.isArray(validKeys) || validKeys.length === 0) return "";
    const cursor = Number(keyRotationByProvider.get(provider) || 0);
    const index = (cursor + attemptOffset) % validKeys.length;
    return validKeys[index] || "";
  }

  function advanceKeyRotation(provider) {
    const cursor = Number(keyRotationByProvider.get(provider) || 0);
    keyRotationByProvider.set(provider, cursor + 1);
  }

  async function getStorage() {
    return new Promise((resolve) => resolve(chrome.storage.local));
  }

  async function loadSettings() {
    const storage = await getStorage();
    const raw = await storage.get(SETTINGS_KEY);
    const settings = { ...DEFAULTS, ...(raw[SETTINGS_KEY] || {}) };
    return validateSettings(settings);
  }

  async function saveSettings(input) {
    const storage = await getStorage();
    const current = await loadSettings();
    const next = validateSettings({ ...current, ...(input || {}) });
    await storage.set({ [SETTINGS_KEY]: next });
    return next;
  }

  function providerDefaults(provider) {
    if (provider === "groq") {
      return {
        baseURL: "https://api.groq.com/openai/v1",
        model: "llama-3.1-8b-instant"
      };
    }
    if (provider === "ollama") {
      return {
        baseURL: "http://localhost:11434/v1",
        model: "llama3.1"
      };
    }
    return {
      baseURL: "https://openrouter.ai/api/v1",
      model: "openrouter/free"
    };
  }

  function validateSettings(input) {
    const provider = String(input.provider || "openrouter").toLowerCase();
    const defaults = providerDefaults(provider);

    const next = {
      ...DEFAULTS,
      ...input,
      provider,
      baseURL: normalize(input.baseURL || defaults.baseURL),
      model: normalize(input.model || defaults.model),
      apiKey: normalize(input.apiKey || "")
    };
    next.theme = String(next.theme || "dark").toLowerCase() === "light" ? "light" : "dark";
    next.apiKeys = parseApiKeys(input.apiKeys || next.apiKey);

    next.batchSize = clamp(Number(next.batchSize) || DEFAULTS.batchSize, 1, 100);
    next.timeoutMs = clamp(Number(next.timeoutMs) || DEFAULTS.timeoutMs, 5000, 120000);
    next.retryCount = clamp(Number(next.retryCount) || DEFAULTS.retryCount, 0, 5);
    next.retryBackoffMs = clamp(Number(next.retryBackoffMs) || DEFAULTS.retryBackoffMs, 200, 20000);
    next.maxInputChars = clamp(Number(next.maxInputChars) || DEFAULTS.maxInputChars, 400, 10000);

    if (provider === "openrouter") {
      next.baseURL = "https://openrouter.ai/api/v1";
      if (!next.model) {
        next.model = "openrouter/free";
      }
    }

    if (provider === "groq") {
      next.baseURL = "https://api.groq.com/openai/v1";
      if (!GROQ_FREE_MODELS.includes(next.model)) {
        next.model = GROQ_FREE_MODELS[0];
      }
    }

    if (provider === "ollama") {
      next.baseURL = normalize(input.baseURL || defaults.baseURL) || defaults.baseURL;
      if (!next.model) next.model = defaults.model;
    }

    // Preserve user-entered key rows across provider switches.
    // Provider-specific filtering happens at request time.
    const normalizedRows = parseApiKeys(next.apiKeys);
    next.apiKeys = normalizedRows;
    if (!next.apiKey && normalizedRows.length > 0) {
      next.apiKey = normalizedRows[0];
    }

    return next;
  }

  function buildTriagePrompt(messages) {
    const compact = messages.map((msg, index) => ({
      i: index,
      threadId: msg.threadId,
      sender: msg.sender,
      subject: msg.subject,
      date: msg.date,
      snippet: normalize(msg.snippet || "").slice(0, 600),
      body: normalize(msg.bodyText || "").slice(0, 1200)
    }));

    return [
      {
        role: "system",
        content:
          "You triage inbox messages. Return strict JSON only: {\"items\":[{\"threadId\":string,\"urgency\":\"critical\"|\"high\"|\"medium\"|\"low\"|\"fyi\",\"score\":0-100,\"reason\":string}]}."
      },
      {
        role: "user",
        content:
          "Classify these inbox emails by urgency. Use concise reasons under 100 chars. JSON only.\n" +
          JSON.stringify(compact)
      }
    ];
  }

  function buildSummaryPrompt(messages) {
    const compact = messages.map((msg) => ({
      threadId: normalize(msg.threadId || ""),
      sender: normalize(msg.sender || ""),
      subject: normalize(msg.subject || "").slice(0, 220),
      date: normalize(msg.date || "").slice(0, 120),
      snippet: normalize(msg.snippet || "").slice(0, 420),
      body: normalize(msg.bodyText || "").slice(0, 900)
    }));

    return [
      {
        role: "system",
        content:
          "You summarize inbox emails. Return strict JSON only: " +
          "{\"items\":[{\"threadId\":string,\"summary\":string}]}. " +
          "Each summary must be 5-10 sentences, factual, plain text, no markdown."
      },
      {
        role: "user",
        content:
          "Summarize each email into 5-10 sentences. Keep important details and action items. JSON only.\n" +
          JSON.stringify(compact)
      }
    ];
  }

  function parseJSONResult(text) {
    const raw = normalize(text);
    if (!raw) return [];

    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (firstError) {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          payload = JSON.parse(raw.slice(start, end + 1));
        } catch (secondError) {
          logTriageDebug("Failed to parse AI triage JSON response", {
            primaryError: firstError && firstError.message ? String(firstError.message) : String(firstError),
            fallbackError: secondError && secondError.message ? String(secondError.message) : String(secondError),
            responsePreview: raw.slice(0, 1200)
          });
          payload = null;
        }
      } else {
        logTriageDebug("AI triage response did not contain JSON object boundaries", {
          primaryError: firstError && firstError.message ? String(firstError.message) : String(firstError),
          responsePreview: raw.slice(0, 1200)
        });
      }
    }

    const items = Array.isArray(payload && payload.items)
      ? payload.items
      : (Array.isArray(payload) ? payload : []);
    return items
      .map((item) => {
        const urgency = normalize(item.urgency).toLowerCase();
        if (!LEVELS.includes(urgency)) return null;
        const threadId = normalize(item.threadId);
        const index = Number.isInteger(Number(item.i)) ? Number(item.i) : -1;
        if (!threadId && index < 0) return null;
        return {
          threadId,
          i: index,
          urgency,
          score: clamp(Number(item.score) || 50, 0, 100),
          reason: normalize(item.reason || "") || "Model triage"
        };
      })
      .filter(Boolean);
  }

  function parseSummaryResult(text) {
    const raw = normalize(text);
    if (!raw) return [];

    let payload = null;
    try {
      payload = JSON.parse(raw);
    } catch (firstError) {
      const start = raw.indexOf("{");
      const end = raw.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          payload = JSON.parse(raw.slice(start, end + 1));
        } catch (_) {
          payload = null;
        }
      }
    }

    const items = Array.isArray(payload && payload.items)
      ? payload.items
      : (Array.isArray(payload) ? payload : []);
    return items
      .map((item) => {
        const threadId = normalize(item && item.threadId ? item.threadId : "");
        const summary = normalize(item && item.summary ? item.summary : "");
        if (!threadId || !summary) return null;
        return { threadId, summary };
      })
      .filter(Boolean);
  }

  async function requestWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const error = new Error("");
        error.status = res.status;
        const retryAfterSeconds = Number(res.headers.get("retry-after") || 0);
        if (retryAfterSeconds > 0) {
          error.retryAfterMs = retryAfterSeconds * 1000;
        }
        const detail = (body.error && body.error.message) || JSON.stringify(body).slice(0, 240);
        if (res.status === 401) {
          error.message = "AI provider rejected credentials (401): " + detail;
          throw error;
        }
        if (res.status === 429) {
          error.message =
            "Rate limit reached from AI provider (429). Please wait a minute, reduce batch size, or switch provider.";
          throw error;
        }
        error.message = "AI request failed (" + res.status + "): " + detail;
        throw error;
      }
      return body;
    } finally {
      clearTimeout(timer);
    }
  }

  async function chat(messages, overrideSettings) {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error("Chat requires at least one message");
    }
    const settings = validateSettings(overrideSettings || (await loadSettings()));
    if (!settings.enabled || !settings.consentTriage) {
      throw new Error("Enable triage + consent in Settings");
    }
    const validKeys = validApiKeysForProvider(settings.provider, settings.apiKeys, settings.apiKey);
    if (settings.provider !== "ollama" && validKeys.length === 0) {
      throw new Error("Missing API key for selected provider");
    }

    const endpoint = settings.baseURL.replace(/\/$/, "") + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (settings.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://mail.google.com";
      headers["X-Title"] = "Gmail Hard Reskin";
    }

    const payload = {
      model: settings.model,
      temperature: 0.2,
      max_tokens: 900,
      messages
    };

    let attempts = 0;
    const maxAttempts = Math.max(1, validKeys.length || 1);
    let lastError = null;
    while (attempts < maxAttempts) {
      const key = settings.provider === "ollama" ? "" : rotateKey(settings.provider, validKeys, attempts);
      if (settings.provider !== "ollama") {
        headers.Authorization = "Bearer " + key;
      }
      try {
        const data = await requestWithTimeout(
          endpoint,
          {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          },
          settings.timeoutMs
        );
        const text = data && data.choices && data.choices[0] && data.choices[0].message
          ? normalize(data.choices[0].message.content || "")
          : "";
        if (!text) throw new Error("AI returned an empty response");
        advanceKeyRotation(settings.provider);
        return text;
      } catch (error) {
        lastError = error;
        attempts += 1;
        if (!error || !error.status || (error.status !== 401 && error.status !== 429)) {
          break;
        }
      }
    }
    throw lastError || new Error("AI returned an empty response");
  }

  async function triageBatch(messages, overrideSettings) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const settings = validateSettings(overrideSettings || (await loadSettings()));
    if (!settings.enabled || !settings.consentTriage) {
      throw new Error("Triage is disabled in settings");
    }

    const validKeys = validApiKeysForProvider(settings.provider, settings.apiKeys, settings.apiKey);
    if (settings.provider !== "ollama" && validKeys.length === 0) {
      throw new Error("Missing API key for selected provider");
    }

    const trimmed = messages.slice(0, settings.batchSize).map((msg) => ({
      ...msg,
      snippet: normalize(msg.snippet || "").slice(0, settings.maxInputChars),
      bodyText: normalize(msg.bodyText || "").slice(0, settings.maxInputChars)
    }));

    const endpoint = settings.baseURL.replace(/\/$/, "") + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (settings.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://mail.google.com";
      headers["X-Title"] = "Gmail Hard Reskin";
    }

    let useStructuredJSON = true;

    let attempt = 0;
    const maxAttempts = Math.max(settings.retryCount + 1, validKeys.length || 1);
    let lastError = null;
    while (attempt < maxAttempts) {
      try {
        const key = settings.provider === "ollama" ? "" : rotateKey(settings.provider, validKeys, attempt);
        if (settings.provider !== "ollama") {
          headers.Authorization = "Bearer " + key;
        }
        logTriageDebug("Sending triage request", {
          provider: settings.provider,
          model: settings.model,
          endpoint,
          keyPreview: maskKey(key || settings.apiKey),
          batchSize: trimmed.length
        });
        const payload = {
          model: settings.model,
          temperature: 0.1,
          max_tokens: 1000,
          messages: buildTriagePrompt(trimmed)
        };
        if (useStructuredJSON) {
          payload.response_format = { type: "json_object" };
        }

        const data = await requestWithTimeout(
          endpoint,
          {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          },
          settings.timeoutMs
        );

        const text = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "";
        const parsed = parseJSONResult(text);
        if (parsed.length === 0) {
          logTriageDebug("AI response produced zero parsed triage items", {
            provider: settings.provider,
            model: settings.model,
            requestedMessages: trimmed.length,
            responsePreview: normalize(text).slice(0, 1200)
          });
        }
        advanceKeyRotation(settings.provider);
        return parsed;
      } catch (error) {
        lastError = error;
        const message = error && error.message ? String(error.message) : String(error);
        const status = Number(error && error.status ? error.status : 0);
        const keyRetryable = status === 401 || status === 429;
        const retryableByCount = attempt < settings.retryCount;
        logTriageDebug("AI triage request attempt failed", {
          attempt: attempt + 1,
          maxAttempts,
          provider: settings.provider,
          model: settings.model,
          useStructuredJSON,
          error: message
        });
        if (useStructuredJSON && message.includes("AI request failed (400)")) {
          useStructuredJSON = false;
          logTriageDebug("Retrying without response_format=json_object after 400 response", {
            provider: settings.provider,
            model: settings.model
          });
          continue;
        }
        if (!keyRetryable && !retryableByCount) break;
        if (attempt >= maxAttempts - 1) break;
        const backoffMs = Number(error && error.retryAfterMs) > 0
          ? Number(error.retryAfterMs)
          : settings.retryBackoffMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      attempt += 1;
    }

    throw lastError || new Error("Triage request failed");
  }

  async function summarizeMessages(messages, overrideSettings) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const settings = validateSettings(overrideSettings || (await loadSettings()));
    if (!settings.enabled || !settings.consentTriage) {
      throw new Error("Summaries are disabled in settings");
    }

    const validKeys = validApiKeysForProvider(settings.provider, settings.apiKeys, settings.apiKey);
    if (settings.provider !== "ollama" && validKeys.length === 0) {
      throw new Error("Missing API key for selected provider");
    }

    const trimmed = messages.slice(0, 3).map((msg) => ({
      ...msg,
      snippet: normalize(msg.snippet || "").slice(0, 420),
      bodyText: normalize(msg.bodyText || "").slice(0, settings.maxInputChars)
    }));

    const endpoint = settings.baseURL.replace(/\/$/, "") + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (settings.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://mail.google.com";
      headers["X-Title"] = "Gmail Hard Reskin";
    }

    let attempt = 0;
    const maxAttempts = Math.max(settings.retryCount + 1, validKeys.length || 1);
    let lastError = null;

    while (attempt < maxAttempts) {
      try {
        const key = settings.provider === "ollama" ? "" : rotateKey(settings.provider, validKeys, attempt);
        if (settings.provider !== "ollama") {
          headers.Authorization = "Bearer " + key;
        }

        const payload = {
          model: settings.model,
          temperature: 0.2,
          max_tokens: 1700,
          response_format: { type: "json_object" },
          messages: buildSummaryPrompt(trimmed)
        };

        const data = await requestWithTimeout(
          endpoint,
          {
            method: "POST",
            headers,
            body: JSON.stringify(payload)
          },
          settings.timeoutMs
        );

        const text = data && data.choices && data.choices[0] && data.choices[0].message
          ? data.choices[0].message.content
          : "";
        const parsed = parseSummaryResult(text);
        advanceKeyRotation(settings.provider);
        return parsed;
      } catch (error) {
        lastError = error;
        const status = Number(error && error.status ? error.status : 0);
        const retryableByKey = status === 401 || status === 429;
        const retryableByStatus = status >= 500 && status < 600;
        const retryableByCount = attempt < settings.retryCount;
        if (!retryableByKey && !retryableByStatus && !retryableByCount) break;
        if (attempt >= maxAttempts - 1) break;
        const backoffMs = Number(error && error.retryAfterMs) > 0
          ? Number(error.retryAfterMs)
          : settings.retryBackoffMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
      attempt += 1;
    }

    throw lastError || new Error("Summary request failed");
  }

  async function testConnection(overrideSettings) {
    const settings = validateSettings(overrideSettings || (await loadSettings()));
    const result = await triageBatch(
      [
        {
          threadId: "test-thread",
          sender: "test@example.com",
          subject: "Can you classify this message?",
          snippet: "This is a test message for connection health.",
          bodyText: ""
        }
      ],
      { ...settings, consentTriage: true, enabled: true }
    );
    return { ok: true, result };
  }

  window.ReskinAI = {
    SETTINGS_KEY,
    DEFAULTS,
    LEVELS,
    GROQ_FREE_MODELS,
    loadSettings,
    saveSettings,
    validateSettings,
    triageBatch,
    summarizeMessages,
    chat,
    testConnection
  };
})();
