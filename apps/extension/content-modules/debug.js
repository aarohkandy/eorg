(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createDebugApi = function createDebugApi(deps = {}) {
    const CHAT_DEBUG_STORAGE_KEY = String(deps.CHAT_DEBUG_STORAGE_KEY || "reskin_chat_debug_v1");
    const CHAT_DEBUG_DEFAULT_ENABLED = Boolean(deps.CHAT_DEBUG_DEFAULT_ENABLED);
    const normalize = typeof deps.normalize === "function" ? deps.normalize : (value) => String(value || "").trim();
    const extractEmail = typeof deps.extractEmail === "function"
      ? deps.extractEmail
      : (value) => {
        const text = String(value || "").trim().toLowerCase();
        const match = text.match(/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i);
        return match ? match[0].toLowerCase() : "";
      };
    const normalizeEmailList = typeof deps.normalizeEmailList === "function"
      ? deps.normalizeEmailList
      : (value) => {
        const list = Array.isArray(value) ? value : [value];
        const out = [];
        for (const item of list) {
          const email = extractEmail(item);
          if (email && !out.includes(email)) out.push(email);
        }
        return out;
      };
    const getRoot = typeof deps.getRoot === "function" ? deps.getRoot : () => null;
    const logInfo = typeof deps.logInfo === "function" ? deps.logInfo : () => {};
    const diagnostics = deps.diagnostics && typeof deps.diagnostics === "object" ? deps.diagnostics : null;

    const EVENT_LOG_MAX = 200;
    const MODE_IMPORTANT = "important";
    const MODE_VERBOSE = "verbose";
    const eventLogBuffer = [];
    let eventLogFlushScheduled = false;
    const debugThrottleMap = new Map();
    const triageThrottleMap = new Map();

    function chatDebugEnabled() {
      try {
        if (globalThis.__RESKIN_CHAT_DEBUG === true) return true;
        if (globalThis.__RESKIN_CHAT_DEBUG === false) return false;
        if (typeof localStorage !== "undefined") {
          const stored = localStorage.getItem(CHAT_DEBUG_STORAGE_KEY);
          if (stored === "1") return true;
          if (stored === "0") return false;
        }
      } catch (_) {
        // ignore storage failures
      }
      return CHAT_DEBUG_DEFAULT_ENABLED;
    }

    function setChatDebugEnabled(enabled) {
      const next = Boolean(enabled);
      try {
        globalThis.__RESKIN_CHAT_DEBUG = next;
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(CHAT_DEBUG_STORAGE_KEY, next ? "1" : "0");
        }
      } catch (_) {
        // ignore storage failures
      }
      logInfo(`Chat debug ${next ? "enabled" : "disabled"}.`);
      return next;
    }

    function summarizeChatMessageForDebug(message) {
      const msg = message && typeof message === "object" ? message : {};
      const body = normalize((msg.cleanBodyText || msg.bodyText || "").slice(0, 120));
      return {
        id: normalize(msg.id || msg.messageKey || ""),
        messageId: normalize(msg.messageId || msg.dataMessageId || ""),
        threadId: normalize(msg.threadId || ""),
        senderEmail: extractEmail(msg.senderEmail || msg.sender || ""),
        recipientEmails: normalizeEmailList(msg.recipientEmails).slice(0, 5),
        participants: normalizeEmailList(msg.participants).slice(0, 6),
        direction: normalize(msg.direction || ""),
        source: normalize(msg.source || msg.sourceType || ""),
        timestampMs: Number(msg.timestampMs || 0),
        status: normalize(msg.status || msg.deliveryState || msg.optimisticStatus || ""),
        bodyPreview: body
      };
    }

    function summarizeChatMessagesForDebug(messages, limit = 4) {
      const out = [];
      for (const msg of Array.isArray(messages) ? messages : []) {
        out.push(summarizeChatMessageForDebug(msg));
        if (out.length >= Math.max(1, Number(limit) || 4)) break;
      }
      return out;
    }

    function clearEventLog() {
      eventLogBuffer.length = 0;
      try {
        const root = getRoot();
        if (root) {
          const list = root.querySelector(".rv-event-logs-list");
          if (list instanceof HTMLElement) list.innerHTML = "";
        }
      } catch (_) {}
    }

    function eventRowText(entry) {
      if (!entry || typeof entry !== "object") return "";
      if (entry.diag && typeof entry.diag === "object") {
        const event = entry.diag;
        const parts = [];
        const durationMs = Number(event.v && event.v.ms != null ? event.v.ms : 0);
        const runId = normalize(event.r || "");
        const traceId = normalize(event.x || "");
        if (durationMs > 0) parts.push(`(${durationMs}ms)`);
        if (runId) parts.push(`r:${runId}`);
        if (traceId) parts.push(`x:${traceId}`);
        const payload = event.v && typeof event.v === "object" ? event.v : {};
        if (Object.keys(payload).length > 0) {
          try {
            parts.push(JSON.stringify(payload));
          } catch (_) {
            parts.push("[v]");
          }
        }
        return `${normalize(event.c || "L000")} ${parts.join(" ")}`.trim();
      }

      let text = normalize(entry.label || "");
      const extra = entry.extra;
      if (extra != null && typeof extra === "object" && Object.keys(extra).length > 0) {
        const durationMs = Number(extra.durationMs || 0);
        const rest = { ...extra };
        delete rest.durationMs;
        const parts = [];
        if (durationMs > 0) parts.push(`(${durationMs}ms)`);
        if (Object.keys(rest).length > 0) {
          try {
            parts.push(JSON.stringify(rest));
          } catch (_) {
            parts.push("[object]");
          }
        }
        if (parts.length > 0) text += ` ${parts.join(" ")}`;
      }
      return text;
    }

    function flushEventLogToDom() {
      eventLogFlushScheduled = false;
      if (eventLogBuffer.length === 0) return;
      try {
        const root = getRoot();
        if (!root) return;
        const list = root.querySelector(".rv-event-logs-list");
        if (!(list instanceof HTMLElement)) return;
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
        const tsBase = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${String(now.getMilliseconds()).padStart(3, "0")}`;
        for (const entryData of eventLogBuffer) {
          const tsStr = entryData && entryData.ts != null ? entryData.ts : tsBase;
          const text = eventRowText(entryData);
          const entry = document.createElement("div");
          entry.className = "rv-event-log-entry";
          entry.setAttribute("data-reskin", "true");
          entry.textContent = `[${tsStr}] ${text}`;
          list.appendChild(entry);
        }
        while (list.children.length > EVENT_LOG_MAX) list.removeChild(list.firstChild);
        list.scrollTop = list.scrollHeight;
      } catch (_) {}
      eventLogBuffer.length = 0;
    }

    function scheduleEventLogFlush() {
      if (eventLogFlushScheduled) return;
      eventLogFlushScheduled = true;
      if (typeof requestAnimationFrame !== "undefined") {
        requestAnimationFrame(flushEventLogToDom);
      } else {
        setTimeout(flushEventLogToDom, 0);
      }
    }

    function buildTimestamp() {
      const now = new Date();
      return now.toLocaleTimeString("en-GB", {
        hour12: false,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        fractionalSecondDigits: 3
      });
    }

    function appendDiagEvent(diagEvent) {
      if (!diagEvent || typeof diagEvent !== "object") return null;
      eventLogBuffer.push({
        diag: diagEvent,
        ts: buildTimestamp()
      });
      scheduleEventLogFlush();
      return diagEvent;
    }

    function appendToEventLog(label, extra = {}, options = {}) {
      const data = extra && typeof extra === "object" ? extra : { value: extra };
      if (diagnostics && typeof diagnostics.logLegacy === "function") {
        const diagEvent = diagnostics.logLegacy(label, data, options);
        if (!diagEvent) return null;
        return appendDiagEvent(diagEvent);
      }
      eventLogBuffer.push({
        label,
        extra: data,
        ts: buildTimestamp()
      });
      scheduleEventLogFlush();
      return null;
    }

    function logEvent(label, extra, options = {}) {
      return appendToEventLog(label, extra, options);
    }

    function logTimed(label, extra = {}) {
      const start = Date.now();
      return {
        done(endExtra = {}) {
          const duration = Date.now() - start;
          appendToEventLog(label, { ...extra, ...endExtra, durationMs: duration });
        }
      };
    }

    function diag(code, data = {}, options = {}) {
      if (!diagnostics || typeof diagnostics.diag !== "function") {
        return appendToEventLog(code, data, options);
      }
      const event = diagnostics.diag(code, data, options);
      return appendDiagEvent(event);
    }

    function diagFail(code, error, data = {}, options = {}) {
      if (!diagnostics || typeof diagnostics.diagFail !== "function") {
        const fallbackData = {
          ...(data && typeof data === "object" ? data : {}),
          rc: Number(data && data.rc != null ? data.rc : 9),
          em: normalize(error && error.message ? error.message : String(error || "unknown"))
        };
        return appendToEventLog(code, fallbackData, options);
      }
      const event = diagnostics.diagFail(code, error, data, options);
      return appendDiagEvent(event);
    }

    function diagStart(runType, context = {}) {
      if (!diagnostics || typeof diagnostics.diagStart !== "function") return "";
      return normalize(diagnostics.diagStart(runType, context));
    }

    function diagEnd(runId, status = "complete", data = {}) {
      if (!diagnostics || typeof diagnostics.diagEnd !== "function") return null;
      const event = diagnostics.diagEnd(runId, status, data);
      return appendDiagEvent(event);
    }

    function diagSnapshot(data = {}, options = {}) {
      if (!diagnostics || typeof diagnostics.snapshot !== "function") return null;
      const event = diagnostics.snapshot(data, options);
      return appendDiagEvent(event);
    }

    function getDiagMode() {
      if (!diagnostics || typeof diagnostics.getMode !== "function") return MODE_IMPORTANT;
      return normalize(diagnostics.getMode() || MODE_IMPORTANT);
    }

    function setDiagMode(mode) {
      if (!diagnostics || typeof diagnostics.setMode !== "function") return MODE_IMPORTANT;
      return normalize(diagnostics.setMode(mode) || MODE_IMPORTANT);
    }

    function dumpDiag(options = {}) {
      if (!diagnostics || typeof diagnostics.dumpDiag !== "function") {
        return {
          mode: MODE_IMPORTANT,
          recent: [],
          counters: {},
          failures: [],
          openRuns: [],
          hydrationRuns: []
        };
      }
      return diagnostics.dumpDiag(options);
    }

    function dumpDiagBudgets() {
      if (!diagnostics || typeof diagnostics.dumpDiagBudgets !== "function") {
        return {
          mode: MODE_IMPORTANT,
          bootWindowMs: 20_000,
          bootBudget: 40,
          bootObserved: 0,
          pendingSuppressed: {},
          lastViolations: []
        };
      }
      return diagnostics.dumpDiagBudgets();
    }

    function logChatDebug(label, extra, options = {}) {
      const throttleMs = Number(options.throttleMs || 0);
      const throttleKey = normalize(options.throttleKey || "");
      if (throttleMs > 0 && throttleKey) {
        const now = Date.now();
        const previous = Number(debugThrottleMap.get(throttleKey) || 0);
        if (now - previous < throttleMs) return;
        debugThrottleMap.set(throttleKey, now);
      }
      const tier = normalize(options.tier || MODE_VERBOSE) || MODE_VERBOSE;
      appendToEventLog(label, extra, { ...options, tier });
      if (!chatDebugEnabled()) return;
      if (typeof extra === "undefined") {
        console.info(`[reskin][chat-debug] ${label}`);
        return;
      }
      console.info(`[reskin][chat-debug] ${label}`, extra);
    }

    function logTriageDebug(message, extra) {
      const codeMap = {
        "Starting inbox triage run": "C01",
        "Collected messages for triage pass": "C02",
        "Prepared triage batch": "C03",
        "AI returned scored items": "C04",
        "Label apply attempt finished": "C05",
        "Triage run finished": "C06",
        "Triage run failed": "C07",
        "Skipping duplicate triage queue": "C08",
        "Skipped triage run because another run is already in progress": "C09"
      };
      const enabledCodes = new Set(["C05", "C07"]);
      const now = Date.now();
      const key = codeMap[message] || message;
      const previous = triageThrottleMap.get(key) || 0;
      const throttleMs = 2000;
      if (throttleMs && now - previous < throttleMs) return;
      triageThrottleMap.set(key, now);

      const code = codeMap[message] || "C00";
      if (!enabledCodes.has(code)) return;
      if (typeof extra === "undefined") {
        console.info(`[reskin][td:${code}] ${message}`);
        return;
      }
      console.info(`[reskin][td:${code}] ${message}`, extra);
    }

    return {
      chatDebugEnabled,
      setChatDebugEnabled,
      summarizeChatMessageForDebug,
      summarizeChatMessagesForDebug,
      clearEventLog,
      flushEventLogToDom,
      scheduleEventLogFlush,
      logEvent,
      logTimed,
      appendToEventLog,
      logChatDebug,
      logTriageDebug,
      diag,
      diagFail,
      diagStart,
      diagEnd,
      diagSnapshot,
      getDiagMode,
      setDiagMode,
      dumpDiag,
      dumpDiagBudgets
    };
  };
})();
