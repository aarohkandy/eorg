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
    provider: "openrouter",
    apiKey: "",
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

    const items = Array.isArray(payload && payload.items) ? payload.items : [];
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

  async function requestWithTimeout(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const detail = (body.error && body.error.message) || JSON.stringify(body).slice(0, 240);
        if (res.status === 401) {
          throw new Error(
            "AI provider rejected credentials (401): " + detail
          );
        }
        if (res.status === 429) {
          throw new Error(
            "Rate limit reached from AI provider (429). Please wait a minute, reduce batch size, or switch provider."
          );
        }
        throw new Error("AI request failed (" + res.status + "): " + detail);
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
    if (settings.provider !== "ollama" && !settings.apiKey) {
      throw new Error("Missing API key for selected provider");
    }
    if (settings.provider === "openrouter" && !settings.apiKey.startsWith("sk-or-")) {
      throw new Error("OpenRouter requires an OpenRouter key (starts with 'sk-or-').");
    }

    const endpoint = settings.baseURL.replace(/\/$/, "") + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (settings.provider !== "ollama") {
      headers.Authorization = "Bearer " + settings.apiKey;
    }
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
    return text;
  }

  async function triageBatch(messages, overrideSettings) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const settings = validateSettings(overrideSettings || (await loadSettings()));
    if (!settings.enabled || !settings.consentTriage) {
      throw new Error("Triage is disabled in settings");
    }

    if (settings.provider !== "ollama" && !settings.apiKey) {
      throw new Error("Missing API key for selected provider");
    }
    if (settings.provider === "openrouter" && !settings.apiKey.startsWith("sk-or-")) {
      throw new Error("OpenRouter requires an OpenRouter key (starts with 'sk-or-').");
    }

    const trimmed = messages.slice(0, settings.batchSize).map((msg) => ({
      ...msg,
      snippet: normalize(msg.snippet || "").slice(0, settings.maxInputChars),
      bodyText: normalize(msg.bodyText || "").slice(0, settings.maxInputChars)
    }));

    const endpoint = settings.baseURL.replace(/\/$/, "") + "/chat/completions";
    const headers = { "Content-Type": "application/json" };
    if (settings.provider !== "ollama") {
      headers.Authorization = "Bearer " + settings.apiKey;
    }
    if (settings.provider === "openrouter") {
      headers["HTTP-Referer"] = "https://mail.google.com";
      headers["X-Title"] = "Gmail Hard Reskin";
    }

    let useStructuredJSON = true;

    let attempt = 0;
    let lastError = null;
    while (attempt <= settings.retryCount) {
      try {
        logTriageDebug("Sending triage request", {
          provider: settings.provider,
          model: settings.model,
          endpoint,
          keyPreview: maskKey(settings.apiKey),
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
        return parsed;
      } catch (error) {
        lastError = error;
        const message = error && error.message ? String(error.message) : String(error);
        logTriageDebug("AI triage request attempt failed", {
          attempt: attempt + 1,
          maxAttempts: settings.retryCount + 1,
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
        if (attempt >= settings.retryCount) break;
        await new Promise((resolve) => setTimeout(resolve, settings.retryBackoffMs * (attempt + 1)));
      }
      attempt += 1;
    }

    throw lastError || new Error("Triage request failed");
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
    chat,
    testConnection
  };
})();
