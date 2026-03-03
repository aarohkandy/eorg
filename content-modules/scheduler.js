(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createSchedulerApi = function createSchedulerApi(deps = {}) {
    const logWarn = typeof deps.logWarn === "function" ? deps.logWarn : () => {};
    const logEvent = typeof deps.logEvent === "function" ? deps.logEvent : () => {};
    const normalize = typeof deps.normalize === "function"
      ? deps.normalize
      : (value) => String(value || "").trim();
    const state = deps.state && typeof deps.state === "object" ? deps.state : {};

    function sleep(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function yieldToMainThread() {
      try {
        if (
          globalThis.scheduler
          && typeof globalThis.scheduler === "object"
          && typeof globalThis.scheduler.yield === "function"
        ) {
          await globalThis.scheduler.yield();
          return;
        }
      } catch (_) {
        // ignore scheduler.yield errors and fallback to timeout
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function scheduleDeferredWork(task, options = {}) {
      const work = typeof task === "function" ? task : null;
      if (!work) return;
      const delayMs = Math.max(0, Number(options.delayMs || 0));
      const timeoutMs = Math.max(120, Number(options.timeoutMs || 1500));
      const run = () => {
        if (typeof window.requestIdleCallback === "function") {
          window.requestIdleCallback(() => {
            try {
              work();
            } catch (error) {
              logWarn("Deferred work failed", error);
            }
          }, { timeout: timeoutMs });
          return;
        }
        setTimeout(() => {
          try {
            work();
          } catch (error) {
            logWarn("Deferred work failed", error);
          }
        }, 0);
      };
      if (delayMs > 0) {
        setTimeout(run, delayMs);
      } else {
        run();
      }
    }

    function scheduleHeavyWorkAfterIdle(task, options = {}) {
      const work = typeof task === "function" ? task : null;
      if (!work) return null;
      const minIdleMs = Math.max(0, Number(options.minIdleMs || 0));
      const hardTimeoutMs = Math.max(minIdleMs, Number(options.hardTimeoutMs || 6000));
      const reason = normalize(options.reason || "heavy-work");
      const queuedAt = Date.now();
      const run = () => {
        const waitedMs = Date.now() - queuedAt;
        logEvent("heavy-work:start", { reason, waitedMs });
        Promise.resolve()
          .then(work)
          .catch((error) => {
            logWarn(`Heavy work failed (${reason})`, error);
            logEvent("heavy-work:aborted", {
              reason,
              message: normalize(error && error.message ? error.message : String(error || ""))
            });
          })
          .finally(() => {
            logEvent("heavy-work:done", { reason, waitedMs: Date.now() - queuedAt });
          });
      };
      const scheduleIdle = () => {
        if (typeof window.requestIdleCallback === "function") {
          return window.requestIdleCallback(run, { timeout: hardTimeoutMs });
        }
        return setTimeout(run, 0);
      };
      logEvent("heavy-work:queued", { reason, minIdleMs, hardTimeoutMs });
      const delay = minIdleMs;
      const timer = setTimeout(scheduleIdle, delay);
      if (Array.isArray(state._heavyWorkTimers)) {
        state._heavyWorkTimers.push(timer);
      } else {
        state._heavyWorkTimers = [timer];
      }
      return timer;
    }

    return {
      sleep,
      yieldToMainThread,
      scheduleDeferredWork,
      scheduleHeavyWorkAfterIdle
    };
  };
})();
