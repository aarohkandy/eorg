(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createDiagnosticsCoreApi = function createDiagnosticsCoreApi(deps = {}) {
    const state = deps.state && typeof deps.state === "object" ? deps.state : {};
    const normalize = typeof deps.normalize === "function"
      ? deps.normalize
      : (value) => String(value || "").trim();

    const MODE_FAIL_ONLY = "failures-only";
    const MODE_IMPORTANT = "important";
    const MODE_VERBOSE = "verbose";
    const VALID_MODES = new Set([MODE_FAIL_ONLY, MODE_IMPORTANT, MODE_VERBOSE]);
    const EVENT_CAP = 400;
    const FAILURE_CAP = 120;
    const RUN_CAP = 120;
    const LEGACY_CODE = "L000";
    const SUPPRESSION_CODE = "Z100";
    const BOOT_WINDOW_MS = 20_000;
    const BOOT_EVENT_BUDGET = 40;

    const REASON_CODES = {
      stale_epoch: 1,
      aborted_signal: 2,
      timeout: 3,
      context_miss: 4,
      fetch_http: 5,
      parse_empty: 6,
      parse_shape: 7,
      dependency_missing: 8,
      unexpected_exception: 9
    };

    const PAYLOAD_KEY_ALIASES = {
      stage: "st",
      reason: "rs",
      status: "st",
      durationMs: "ms",
      messageCount: "mc",
      threadCount: "tc",
      outgoingCount: "oc",
      incomingCount: "ic",
      conversationKey: "ck",
      contactEmail: "ce",
      activeAccountEmail: "ae",
      traceId: "x",
      runId: "r",
      mailbox: "mb",
      hash: "hs",
      source: "src",
      kind: "kd",
      budgetMs: "bg",
      waitedMs: "wm",
      count: "ct",
      mode: "md",
      view: "vw",
      processedCount: "pc",
      filteredCount: "fc",
      normalizedCount: "nc",
      poolCount: "pl"
    };

    const LEGACY_LABEL_MAP = {
      "reskin:ready": { code: "B100", k: 1, s: 1, tier: "always" },
      "bootstrap:ready": { code: "B120", k: 1, s: 1, tier: "always" },
      "startup-filter:default-all": { code: "B125", k: 1, s: 1, tier: MODE_IMPORTANT },
      "styles:ready": { code: "B130", k: 1, s: 1, tier: MODE_IMPORTANT },
      "bootstrap:heavy-init-skipped": { code: "B140", k: 1, s: 1, tier: MODE_IMPORTANT },
      "bootstrap:scan-kick": { code: "S110", k: 5, s: 1, tier: MODE_IMPORTANT },
      "bootstrap:scan-kick:skip": { code: "S111", k: 5, s: 1, tier: MODE_VERBOSE },
      "hash:change": { code: "N110", k: 1, s: 1, tier: MODE_IMPORTANT },
      click: { code: "I100", k: 2, s: 1, tier: MODE_VERBOSE },
      "click:start": { code: "I110", k: 2, s: 1, tier: "always" },
      "click:deduped": { code: "I130", k: 2, s: 1, tier: "always" },
      "interaction:epoch": { code: "I140", k: 2, s: 1, tier: MODE_IMPORTANT },
      "open:deferred-build-start": { code: "O100", k: 3, s: 1, tier: MODE_IMPORTANT },
      "open:deferred-build-chunk": { code: "O150", k: 3, s: 1, tier: MODE_VERBOSE },
      "open:deferred-build-done": { code: "O180", k: 3, s: 1, tier: MODE_IMPORTANT },
      "open:fast-shell-painted": { code: "O130", k: 3, s: 1, tier: "always" },
      "open:first-message-painted": { code: "O140", k: 3, s: 1, tier: "always" },
      "open:discovery": { code: "O210", k: 3, s: 1, tier: MODE_IMPORTANT },
      "contact-v2:open": { code: "O120", k: 3, s: 1, tier: MODE_IMPORTANT },
      "contact-v2:scope": { code: "O121", k: 3, s: 1, tier: MODE_IMPORTANT },
      "contact-v2:timeline-built": { code: "O122", k: 3, s: 1, tier: MODE_VERBOSE },
      "contact-opened": { code: "H110", k: 4, s: 1, tier: MODE_IMPORTANT },
      "contact-chat:open": { code: "H120", k: 4, s: 1, tier: MODE_IMPORTANT },
      "contact-chat:seed-preserved": { code: "H121", k: 4, s: 1, tier: MODE_IMPORTANT },
      "contact-chat:hydration-finish": { code: "H180", k: 4, s: 1, tier: "always" },
      "hydration:first-thread-landed": { code: "H150", k: 4, s: 1, tier: MODE_IMPORTANT },
      "hydration:complete": { code: "H181", k: 4, s: 1, tier: "always" },
      "fetch:print-view": { code: "P610", k: 6, s: 1, tier: MODE_VERBOSE },
      "hydrate:print-view": { code: "H130", k: 4, s: 1, tier: MODE_VERBOSE },
      "print-view:hydrated": { code: "H131", k: 4, s: 1, tier: MODE_IMPORTANT },
      "print-view:cache-hit": { code: "H132", k: 4, s: 1, tier: MODE_VERBOSE },
      "thread-render": { code: "UI300", k: 3, s: 1, tier: MODE_VERBOSE },
      "thread-render:timeline": { code: "UI301", k: 3, s: 1, tier: MODE_VERBOSE },
      "list-render:empty-retry": { code: "UI110", k: 3, s: 1, tier: MODE_IMPORTANT },
      "lookup:collect-messages": { code: "D110", k: 6, s: 1, tier: MODE_VERBOSE },
      "scan:start": { code: "S100", k: 5, s: 1, tier: "always" },
      "scan:done": { code: "S180", k: 5, s: 1, tier: "always" },
      "heavy-work:queued": { code: "W100", k: 5, s: 1, tier: MODE_VERBOSE },
      "heavy-work:start": { code: "W120", k: 5, s: 1, tier: MODE_IMPORTANT },
      "heavy-work:done": { code: "W180", k: 5, s: 1, tier: MODE_IMPORTANT },
      "heavy-work:aborted": { code: "W199", k: 5, s: 2, tier: "always" },
      "perf:longtask": { code: "P710", k: 7, s: 2, tier: MODE_IMPORTANT },
      "budget:violation": { code: "P790", k: 7, s: 2, tier: "always" },
      "trace:complete": { code: "P900", k: 7, s: 1, tier: MODE_IMPORTANT },
      "triage:start": { code: "T100", k: 5, s: 1, tier: MODE_IMPORTANT },
      "triage:done": { code: "T180", k: 5, s: 1, tier: MODE_IMPORTANT },
      "triage:failed": { code: "T199", k: 5, s: 3, tier: "always" },
      "account-detect:resolved": { code: "A110", k: 1, s: 1, tier: MODE_IMPORTANT },
      "account-detect:missing": { code: "A190", k: 1, s: 2, tier: MODE_IMPORTANT }
    };

    if (!state.__diag || typeof state.__diag !== "object") {
      state.__diag = {
        mode: MODE_IMPORTANT,
        seq: 0,
        events: [],
        counters: {},
        failures: [],
        runs: {},
        runOrder: [],
        rateLimit: {},
        pendingSuppressed: {},
        lastSuppressionFlushAt: 0,
        bootEventCount: 0,
        budgetViolations: []
      };
    }
    const diagState = state.__diag;

    function nowMs() {
      return Date.now();
    }

    function msSinceReady() {
      const readyAt = Number(state.reskinReadyAt || 0);
      if (!readyAt) return 0;
      return Math.max(0, nowMs() - readyAt);
    }

    function stableHash(input) {
      const text = String(input || "");
      let hash = 2166136261;
      for (let i = 0; i < text.length; i += 1) {
        hash ^= text.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
      }
      return (hash >>> 0).toString(36);
    }

    function shortHash(input) {
      return stableHash(input).slice(0, 8) || "0";
    }

    function compactString(value, maxLen = 140) {
      const text = String(value || "");
      if (text.length <= maxLen) return text;
      return `${text.slice(0, Math.max(8, maxLen - 12))}…#${shortHash(text)}`;
    }

    function compactObject(value, depth = 0) {
      if (value == null) return null;
      if (typeof value === "boolean") return value;
      if (typeof value === "number") return Number.isFinite(value) ? value : 0;
      if (typeof value === "string") return compactString(value, 120);
      if (Array.isArray(value)) {
        const length = value.length;
        if (length === 0) return [];
        const packed = JSON.stringify(value.slice(0, 12));
        return { n: length, h: shortHash(packed) };
      }
      if (typeof value !== "object") return compactString(String(value || ""));
      if (depth >= 1) {
        const packed = JSON.stringify(value);
        return { h: shortHash(packed) };
      }
      const out = {};
      const entries = Object.entries(value).slice(0, 10);
      for (const [key, entry] of entries) {
        out[key] = compactObject(entry, depth + 1);
      }
      return out;
    }

    function compactPayload(payload) {
      if (!payload || typeof payload !== "object") return {};
      const out = {};
      for (const [key, value] of Object.entries(payload)) {
        if (key === "traceId" || key === "runId" || key === "durationMs") continue;
        if (Array.isArray(value) && key.toLowerCase().includes("sample")) {
          const packed = JSON.stringify(value.slice(0, 12));
          out.sample_count = value.length;
          out.sample_hash = shortHash(packed);
          continue;
        }
        const alias = PAYLOAD_KEY_ALIASES[key] || key;
        out[alias] = compactObject(value, 0);
      }
      return out;
    }

    function inferCategoryFromCode(code) {
      const c = normalize(code || "").toUpperCase();
      if (c.startsWith("B") || c.startsWith("A") || c.startsWith("N")) return 1;
      if (c.startsWith("I") || c.startsWith("UI")) return 2;
      if (c.startsWith("O")) return 3;
      if (c.startsWith("H")) return 4;
      if (c.startsWith("S") || c.startsWith("W") || c.startsWith("T")) return 5;
      if (c.startsWith("D") || c.startsWith("P6")) return 6;
      if (c.startsWith("P")) return 7;
      if (c.startsWith("E") || c.startsWith("F") || c.endsWith("99") || c.startsWith("R")) return 8;
      return 8;
    }

    function looksLikeCode(input) {
      return /^[A-Z]{1,3}\d{3}$/.test(normalize(input || "").toUpperCase());
    }

    function getMode() {
      const mode = normalize(diagState.mode || MODE_IMPORTANT);
      return VALID_MODES.has(mode) ? mode : MODE_IMPORTANT;
    }

    function setMode(mode) {
      const next = normalize(mode || MODE_IMPORTANT);
      diagState.mode = VALID_MODES.has(next) ? next : MODE_IMPORTANT;
      return diagState.mode;
    }

    function shouldEmit(event) {
      const mode = getMode();
      const tier = event.tier || MODE_IMPORTANT;
      const always = tier === "always";
      if (always) return true;
      if (mode === MODE_VERBOSE) return true;
      if (mode === MODE_IMPORTANT) return tier !== MODE_VERBOSE;
      if (mode === MODE_FAIL_ONLY) return Number(event.s || 0) >= 2;
      return true;
    }

    function shouldSuppressForBudget(event) {
      if ((event.tier || MODE_IMPORTANT) === "always") return false;
      const sinceReady = Number(event.t || 0);
      if (sinceReady <= BOOT_WINDOW_MS) {
        if (diagState.bootEventCount >= BOOT_EVENT_BUDGET) {
          return true;
        }
      }
      if (!event.r) return false;
      const run = diagState.runs[event.r];
      if (!run) return false;
      const type = normalize(run.type || "");
      const cap = type === "open" ? 35 : type === "hydration" ? 45 : 0;
      if (!cap) return false;
      const projected = Number(run.eventCount || 0) + 1;
      if (projected <= cap) return false;
      return true;
    }

    function queueSuppression(code) {
      const key = normalize(code || SUPPRESSION_CODE);
      const prev = Number(diagState.pendingSuppressed[key] || 0);
      diagState.pendingSuppressed[key] = prev + 1;
    }

    function emitSuppressionSummaryIfNeeded() {
      const pending = diagState.pendingSuppressed || {};
      const keys = Object.keys(pending);
      if (keys.length === 0) return null;
      if (nowMs() - Number(diagState.lastSuppressionFlushAt || 0) < 250) return null;
      const summary = {};
      for (const key of keys) {
        summary[key] = Number(pending[key] || 0);
      }
      diagState.pendingSuppressed = {};
      diagState.lastSuppressionFlushAt = nowMs();
      return createEvent(SUPPRESSION_CODE, summary, {
        category: 8,
        severity: 1,
        tier: "always"
      });
    }

    function updateRunFromEvent(event) {
      if (!event || !event.r) return;
      const run = diagState.runs[event.r];
      if (!run) return;
      run.eventCount = Number(run.eventCount || 0) + 1;
      run.lastAt = nowMs();
    }

    function pushEvent(event) {
      if (!event) return null;
      diagState.seq = Number(diagState.seq || 0) + 1;
      event.seq = diagState.seq;
      event.at = nowMs();
      diagState.events.push(event);
      while (diagState.events.length > EVENT_CAP) diagState.events.shift();
      const code = normalize(event.c || LEGACY_CODE);
      diagState.counters[code] = Number(diagState.counters[code] || 0) + 1;
      if (event.t <= BOOT_WINDOW_MS) diagState.bootEventCount += 1;
      if (Number(event.s || 0) >= 2 || code.endsWith("99") || code.startsWith("E")) {
        diagState.failures.push(event);
        while (diagState.failures.length > FAILURE_CAP) diagState.failures.shift();
      }
      if (code === "P790") {
        diagState.budgetViolations.push(event);
        while (diagState.budgetViolations.length > 80) diagState.budgetViolations.shift();
      }
      updateRunFromEvent(event);
      return event;
    }

    function createEvent(code, payload = {}, opts = {}) {
      const normalizedCode = looksLikeCode(code) ? code.toUpperCase() : LEGACY_CODE;
      const severity = Number(opts.severity != null ? opts.severity : 1);
      const category = Number(opts.category != null ? opts.category : inferCategoryFromCode(normalizedCode));
      const runId = normalize(opts.runId || payload.runId || "");
      const traceId = normalize(opts.traceId || payload.traceId || "");
      const data = payload && typeof payload === "object" ? { ...payload } : {};
      delete data.runId;
      delete data.traceId;
      const event = {
        c: normalizedCode,
        s: Math.max(0, Math.min(3, severity)),
        k: Math.max(1, Math.min(8, category)),
        t: msSinceReady(),
        e: Number(state.interactionEpoch || 0),
        r: runId || undefined,
        x: traceId || undefined,
        v: compactPayload(data),
        tier: opts.tier || MODE_IMPORTANT,
        l: normalize(opts.legacyLabel || "")
      };
      return event;
    }

    function diag(code, payload = {}, opts = {}) {
      const event = createEvent(code, payload, opts);
      const suppression = emitSuppressionSummaryIfNeeded();
      if (!shouldEmit(event) || shouldSuppressForBudget(event)) {
        queueSuppression(event.c);
        return null;
      }
      if (suppression) pushEvent(suppression);
      return pushEvent(event);
    }

    function sanitizeError(error) {
      const message = normalize(error && error.message ? error.message : String(error || "unknown"));
      return {
        message: compactString(message, 180),
        hash: shortHash(message || "unknown")
      };
    }

    function shouldDropRateLimited(code, hash, opts = {}) {
      const maxCount = Number(opts.maxCount || 3);
      const windowMs = Number(opts.windowMs || 60_000);
      const key = `${normalize(code || "E999")}:${normalize(hash || "0")}`;
      const record = diagState.rateLimit[key] || { c: 0, t: 0 };
      const now = nowMs();
      if (now - Number(record.t || 0) > windowMs) {
        diagState.rateLimit[key] = { c: 1, t: now };
        return false;
      }
      if (Number(record.c || 0) >= maxCount) return true;
      record.c += 1;
      record.t = now;
      diagState.rateLimit[key] = record;
      return false;
    }

    function diagFail(code, error, payload = {}, opts = {}) {
      const err = sanitizeError(error);
      if (shouldDropRateLimited(code, err.hash, {
        maxCount: opts.maxCount || 3,
        windowMs: opts.windowMs || 60_000
      })) {
        queueSuppression(code || "F999");
        return null;
      }
      const merged = {
        ...(payload && typeof payload === "object" ? payload : {}),
        mh: err.hash
      };
      if (getMode() === MODE_VERBOSE) merged.em = err.message;
      if (merged.rc == null) merged.rc = REASON_CODES.unexpected_exception;
      return diag(code, merged, {
        ...opts,
        severity: opts.severity != null ? opts.severity : 3,
        tier: "always",
        category: opts.category != null ? opts.category : 8
      });
    }

    function logLegacy(label, payload = {}, opts = {}) {
      const legacyLabel = normalize(label || "");
      const mapped = LEGACY_LABEL_MAP[legacyLabel] || null;
      const explicitCode = normalize(opts.code || "");
      const code = looksLikeCode(explicitCode)
        ? explicitCode.toUpperCase()
        : (mapped ? mapped.code : (looksLikeCode(legacyLabel) ? legacyLabel.toUpperCase() : LEGACY_CODE));
      const extra = payload && typeof payload === "object" ? { ...payload } : { value: payload };
      if (code === LEGACY_CODE && legacyLabel) extra.l = legacyLabel;
      const severity = opts.severity != null ? Number(opts.severity) : Number(mapped && mapped.s != null ? mapped.s : 1);
      const category = opts.category != null ? Number(opts.category) : Number(mapped && mapped.k != null ? mapped.k : inferCategoryFromCode(code));
      const tier = normalize(opts.tier || (mapped && mapped.tier) || MODE_IMPORTANT) || MODE_IMPORTANT;
      return diag(code, extra, {
        runId: opts.runId || extra.runId || "",
        traceId: opts.traceId || extra.traceId || "",
        severity,
        category,
        tier,
        legacyLabel
      });
    }

    function diagStart(runType, context = {}) {
      const type = normalize(runType || "run") || "run";
      const runId = `r:${type}:${nowMs().toString(36)}:${Math.random().toString(36).slice(2, 8)}`;
      diagState.runs[runId] = {
        runId,
        type,
        status: "running",
        startedAt: nowMs(),
        endedAt: 0,
        eventCount: 0,
        context: compactPayload(context),
        terminal: ""
      };
      diagState.runOrder.push(runId);
      while (diagState.runOrder.length > RUN_CAP) {
        const stale = diagState.runOrder.shift();
        if (stale) delete diagState.runs[stale];
      }
      diag("R100", {
        rt: type,
        ...context
      }, {
        runId,
        category: 8,
        severity: 1,
        tier: "always",
        legacyLabel: "run:start"
      });
      return runId;
    }

    function diagEnd(runId, status = "complete", payload = {}) {
      const id = normalize(runId || "");
      if (!id) return null;
      const run = diagState.runs[id];
      const normalizedStatus = normalize(status || "complete") || "complete";
      if (run) {
        run.status = normalizedStatus;
        run.endedAt = nowMs();
      }
      const code = normalizedStatus === "complete" ? "R180" : (normalizedStatus === "aborted" ? "R190" : "R199");
      const severity = normalizedStatus === "failed" ? 3 : (normalizedStatus === "aborted" ? 2 : 1);
      const event = diag(code, {
        st: normalizedStatus,
        ...(payload && typeof payload === "object" ? payload : {})
      }, {
        runId: id,
        category: 8,
        severity,
        tier: "always",
        legacyLabel: "run:end"
      });
      if (run) run.terminal = code;
      return event;
    }

    function snapshot(payload = {}, opts = {}) {
      return diag("Q100", payload, {
        tier: "always",
        category: 1,
        severity: 1,
        runId: opts.runId || "",
        traceId: opts.traceId || ""
      });
    }

    function runSummaries(limit = 30) {
      const out = [];
      const ids = diagState.runOrder.slice(-Math.max(1, Number(limit) || 30));
      for (const runId of ids) {
        const run = diagState.runs[runId];
        if (!run) continue;
        out.push({
          runId,
          type: run.type,
          status: run.status,
          startedAt: Number(run.startedAt || 0),
          endedAt: Number(run.endedAt || 0),
          eventCount: Number(run.eventCount || 0),
          terminal: run.terminal || "",
          context: run.context || {}
        });
      }
      return out;
    }

    function dumpDiag(options = {}) {
      const verbose = Boolean(options.verbose);
      const recentLimit = Math.max(10, Number(options.recentLimit || 120));
      const recent = diagState.events.slice(-recentLimit).map((event) => {
        if (verbose) return { ...event };
        return {
          c: event.c,
          s: event.s,
          k: event.k,
          t: event.t,
          e: event.e,
          r: event.r,
          x: event.x,
          v: event.v
        };
      });
      const failures = diagState.failures.slice(-30).map((event) => ({
        c: event.c,
        s: event.s,
        t: event.t,
        r: event.r,
        x: event.x,
        v: event.v
      }));
      const counters = {};
      for (const [key, value] of Object.entries(diagState.counters || {})) {
        counters[key] = Number(value || 0);
      }
      return {
        mode: getMode(),
        recent,
        counters,
        failures,
        openRuns: runSummaries(60).filter((run) => run.type === "open"),
        hydrationRuns: runSummaries(60).filter((run) => run.type === "hydration"),
        suppressed: { ...(diagState.pendingSuppressed || {}) }
      };
    }

    function dumpDiagBudgets() {
      return {
        mode: getMode(),
        bootWindowMs: BOOT_WINDOW_MS,
        bootBudget: BOOT_EVENT_BUDGET,
        bootObserved: Number(diagState.bootEventCount || 0),
        pendingSuppressed: { ...(diagState.pendingSuppressed || {}) },
        lastViolations: (diagState.budgetViolations || []).slice(-20).map((event) => ({
          c: event.c,
          t: event.t,
          r: event.r,
          x: event.x,
          v: event.v
        }))
      };
    }

    return {
      REASON_CODES,
      getMode,
      setMode,
      logLegacy,
      diag,
      diagFail,
      diagStart,
      diagEnd,
      snapshot,
      dumpDiag,
      dumpDiagBudgets
    };
  };
})();
