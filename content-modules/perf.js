(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createPerfApi = function createPerfApi(deps = {}) {
    const state = deps.state && typeof deps.state === "object" ? deps.state : {};
    const normalize = typeof deps.normalize === "function" ? deps.normalize : (value) => String(value || "").trim();
    const logEvent = typeof deps.logEvent === "function" ? deps.logEvent : () => {};
    const PERF_BUDGETS = {
      "open:fast-shell-painted": 120,
      "open:first-message-painted": 450
    };
    if (!Array.isArray(state.perfBudgetViolations)) state.perfBudgetViolations = [];

    function pushBudgetViolation(entry = {}) {
      state.perfBudgetViolations.push({
        ...entry,
        at: Date.now()
      });
      while (state.perfBudgetViolations.length > 120) {
        state.perfBudgetViolations.shift();
      }
    }

    function percentile(values, p = 0.95) {
      const list = Array.isArray(values)
        ? values.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value >= 0)
        : [];
      if (list.length === 0) return 0;
      list.sort((a, b) => a - b);
      const idx = Math.max(0, Math.min(list.length - 1, Math.floor((list.length - 1) * Number(p || 0))));
      return Number(list[idx] || 0);
    }

    function pushPerfSample(stage, durationMs) {
      const key = normalize(stage || "");
      const duration = Number(durationMs || 0);
      if (!key || !Number.isFinite(duration) || duration < 0) return;
      if (!Array.isArray(state.perfSamplesByStage[key])) {
        state.perfSamplesByStage[key] = [];
      }
      state.perfSamplesByStage[key].push(duration);
      const max = 220;
      while (state.perfSamplesByStage[key].length > max) {
        state.perfSamplesByStage[key].shift();
      }
    }

    function beginPerfTrace(meta = {}) {
      const id = `trace:${Date.now()}:${Math.floor(Math.random() * 1e7).toString(36)}`;
      state.perfTraces[id] = {
        id,
        startedAt: performance.now(),
        startWallAt: Date.now(),
        meta: meta && typeof meta === "object" ? { ...meta } : {},
        stages: []
      };
      state.perfTraceOrder.push(id);
      while (state.perfTraceOrder.length > 60) {
        const stale = state.perfTraceOrder.shift();
        if (stale) delete state.perfTraces[stale];
      }
      return id;
    }

    function markPerfStage(traceId, stage, extra = {}) {
      const trace = state.perfTraces[traceId];
      const stageName = normalize(stage || "");
      if (!trace || !stageName) return;
      const nowPerf = performance.now();
      const durationMs = Math.max(0, nowPerf - Number(trace.startedAt || nowPerf));
      const payload = {
        ...(extra && typeof extra === "object" ? extra : {}),
        traceId,
        stage: stageName,
        durationMs: Math.round(durationMs)
      };
      trace.stages.push({
        stage: stageName,
        durationMs,
        at: Date.now(),
        extra: payload
      });
      pushPerfSample(stageName, durationMs);
      logEvent(stageName, payload);
      const budgetMs = Number(PERF_BUDGETS[stageName] || 0);
      if (budgetMs > 0 && durationMs > budgetMs) {
        const violation = {
          kind: "stage-threshold",
          stage: stageName,
          durationMs: Math.round(durationMs),
          budgetMs,
          traceId
        };
        logEvent("budget:violation", violation);
        pushBudgetViolation(violation);
      }
      if (stageName === "click:start") {
        state.lastClickPerfAt = Date.now();
      }
    }

    function perfTraceHasStage(traceId, stage) {
      const trace = state.perfTraces[traceId];
      const stageName = normalize(stage || "");
      if (!trace || !stageName) return false;
      return Array.isArray(trace.stages)
        && trace.stages.some((entry) => normalize(entry && entry.stage || "") === stageName);
    }

    function endPerfTrace(traceId, extra = {}) {
      const trace = state.perfTraces[traceId];
      if (!trace) return;
      markPerfStage(traceId, "trace:complete", extra);
    }

    function summarizePerfSamplesByStage() {
      const out = {};
      const entries = Object.entries(state.perfSamplesByStage || {});
      for (const [stage, values] of entries) {
        const list = Array.isArray(values) ? values.slice() : [];
        if (list.length === 0) continue;
        const avg = list.reduce((acc, value) => acc + Number(value || 0), 0) / list.length;
        out[stage] = {
          count: list.length,
          avgMs: Math.round(avg),
          p95Ms: Math.round(percentile(list, 0.95)),
          maxMs: Math.round(Math.max(...list))
        };
      }
      return out;
    }

    function summarizePerfBudgets() {
      const byStage = summarizePerfSamplesByStage();
      const out = {};
      for (const [stage, budgetMs] of Object.entries(PERF_BUDGETS)) {
        const summary = byStage[stage] || { count: 0, avgMs: 0, p95Ms: 0, maxMs: 0 };
        out[stage] = {
          budgetMs,
          count: Number(summary.count || 0),
          p95Ms: Number(summary.p95Ms || 0),
          maxMs: Number(summary.maxMs || 0),
          pass: Number(summary.p95Ms || 0) <= budgetMs
        };
      }
      const longTasks = Array.isArray(state.perfLongTasks) ? state.perfLongTasks : [];
      const violations = longTasks.filter((entry) => Number(entry && entry.durationMs || 0) > 200);
      out["click-window-longtask"] = {
        budgetMs: 200,
        count: violations.length,
        pass: violations.length === 0
      };
      out.lastViolations = (Array.isArray(state.perfBudgetViolations) ? state.perfBudgetViolations : [])
        .slice(-20)
        .map((entry) => ({
          kind: normalize(entry && entry.kind || ""),
          stage: normalize(entry && entry.stage || ""),
          durationMs: Number(entry && entry.durationMs || 0),
          budgetMs: Number(entry && entry.budgetMs || 0),
          runId: normalize(entry && entry.runId || ""),
          traceId: normalize(entry && entry.traceId || ""),
          at: Number(entry && entry.at || 0)
        }));
      return out;
    }

    function installLongTaskObserver() {
      if (state.perfLongTaskObserverInstalled) return;
      state.perfLongTaskObserverInstalled = true;
      try {
        if (typeof PerformanceObserver !== "function") return;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            const duration = Number(entry && entry.duration || 0);
            const item = {
              durationMs: duration,
              startTime: Number(entry && entry.startTime || 0),
              name: normalize(entry && entry.name || "longtask"),
              at: Date.now()
            };
            state.perfLongTasks.push(item);
            while (state.perfLongTasks.length > 200) state.perfLongTasks.shift();
            if (duration >= 50) {
              logEvent("perf:longtask", {
                durationMs: Math.round(duration),
                startTime: Math.round(item.startTime)
              });
            }
            if (duration > 200 && Date.now() - Number(state.lastClickPerfAt || 0) <= 1000) {
              const violation = {
                kind: "click-window-longtask",
                durationMs: Math.round(duration),
                budgetMs: 200,
                runId: normalize(state.activeOpenDiagRunId || ""),
                traceId: normalize(state.activeOpenPerfTraceId || "")
              };
              logEvent("budget:violation", violation);
              pushBudgetViolation(violation);
            }
          }
        });
        observer.observe({ entryTypes: ["longtask"] });
      } catch (_) {
        // ignore unsupported longtask observer environments
      }
    }

    return {
      percentile,
      pushPerfSample,
      beginPerfTrace,
      markPerfStage,
      perfTraceHasStage,
      endPerfTrace,
      summarizePerfSamplesByStage,
      summarizePerfBudgets,
      installLongTaskObserver
    };
  };
})();
