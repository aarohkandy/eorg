(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createBootstrapRuntimeApi = function createBootstrapRuntimeApi(deps = {}) {
    const {
      ROOT_ID,
      COL_WIDTHS_STORAGE_KEY,
      DEFAULT_COL_WIDTHS,
      MIN_COL_PX,
      MAX_COL_PX,
      GMAIL_READY_SELECTORS,
      STARTUP_PERF_MODE,
      ENABLE_BOOTSTRAP_SCAN_KICK,
      LIST_MODE,
      CHAT_MODE,
      DEBUG_BRIDGE_REQUEST_EVENT,
      DEBUG_BRIDGE_RESPONSE_EVENT,
      DEBUG_BRIDGE_SCRIPT_ID,
      state,
      normalize,
      extractEmail,
      getRoot,
      shadowRefs,
      resolveExtensionUrl,
      consumeEvent,
      clearEventLog,
      logEvent,
      logInfo,
      logWarn,
      logChatDebug,
      bindRootEvents,
      openSettingsView,
      ensureStylesheet,
      ensureMode,
      applyTheme,
      syncViewFromHash,
      renderCurrentView,
      removeLegacyNodes,
      scheduleDeferredWork,
      scheduleHeavyWorkAfterIdle,
      loadPersistedTriageMap,
      loadPersistedSummaries,
      ensureInboxSdkReady,
      getScheduleMailboxScanKick,
      scheduleMailboxScanKick,
      selectFirst,
      activeThreadTimelineContext,
      getIsContactTimelineV2Enabled,
      isContactTimelineV2Enabled,
      summarizeChatMessagesForDebug,
      getMailboxCacheKey,
      mailboxCacheKey,
      summarizePerfSamplesByStage,
      summarizePerfBudgets,
      installLongTaskObserver,
      setChatDebugEnabled,
      chatDebugEnabled,
      detectCurrentUserEmail
    } = deps;
    const resolveScheduleMailboxScanKick = () => (
      typeof getScheduleMailboxScanKick === "function"
        ? getScheduleMailboxScanKick()
        : scheduleMailboxScanKick
    );
    const resolveIsContactTimelineV2Enabled = () => (
      typeof getIsContactTimelineV2Enabled === "function"
        ? getIsContactTimelineV2Enabled()
        : isContactTimelineV2Enabled
    );
    const resolveMailboxCacheKey = () => (
      typeof getMailboxCacheKey === "function"
        ? getMailboxCacheKey()
        : mailboxCacheKey
    );

    function getColumnWidths() {
      try {
        const raw = typeof localStorage !== "undefined" ? localStorage.getItem(COL_WIDTHS_STORAGE_KEY) : null;
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            return {
              col1: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col1) || DEFAULT_COL_WIDTHS.col1)),
              col2: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col2) || DEFAULT_COL_WIDTHS.col2)),
              col3: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col3) || DEFAULT_COL_WIDTHS.col3)),
              col4: Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, Number(parsed.col4) || DEFAULT_COL_WIDTHS.col4))
            };
          }
        }
      } catch (_) {
        // ignore
      }
      return { ...DEFAULT_COL_WIDTHS };
    }

    function saveColumnWidths(widths) {
      try {
        const payload = JSON.stringify({
          col1: widths.col1,
          col2: widths.col2,
          col3: widths.col3,
          col4: widths.col4
        });
        if (typeof localStorage !== "undefined") localStorage.setItem(COL_WIDTHS_STORAGE_KEY, payload);
        if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
          chrome.storage.local.set({ [COL_WIDTHS_STORAGE_KEY]: payload }).catch(() => {});
        }
      } catch (_) {
        // ignore
      }
    }

    function applyColumnWidths(root, optionalWidths) {
      const shell = root && root.querySelector ? root.querySelector(".rv-shell") : null;
      if (!(shell instanceof HTMLElement)) return;
      const widths = optionalWidths && typeof optionalWidths === "object" ? optionalWidths : getColumnWidths();
      shell.style.setProperty("--rv-col-1", `${widths.col1}px`);
      shell.style.setProperty("--rv-col-2", `${widths.col2}px`);
      shell.style.setProperty("--rv-col-4", `${widths.col4}px`);
    }

    function ensureRoot() {
      const existing = getRoot();
      if (existing) return existing;
      if (!document.body) return null;

      const BODY_STYLE_ID = "reskin-body-style";
      if (!document.getElementById(BODY_STYLE_ID)) {
        const bodyStyle = document.createElement("style");
        bodyStyle.id = BODY_STYLE_ID;
        bodyStyle.textContent = `
          body[data-reskin-mode="viewer"] > *:not(#rv-shadow-host) {
            visibility: hidden !important;
            pointer-events: none !important;
            position: absolute !important;
            width: 0 !important; height: 0 !important;
            overflow: hidden !important;
          }
          body[data-reskin-mode="viewer"] {
            margin: 0 !important; padding: 0 !important;
            overflow: hidden !important;
            height: 100vh !important; width: 100vw !important;
            background: #000000 !important;
            font-family: "Space Grotesk","IBM Plex Sans","Segoe UI",sans-serif !important;
            color: #ffffff !important;
          }
        `;
        document.head.appendChild(bodyStyle);
      }

      shadowRefs.host = document.createElement("div");
      shadowRefs.host.id = "rv-shadow-host";
      shadowRefs.root = shadowRefs.host.attachShadow({ mode: "open" });
      document.body.appendChild(shadowRefs.host);

      shadowRefs.host.addEventListener("keydown", (event) => event.stopPropagation());
      shadowRefs.host.addEventListener("keyup", (event) => event.stopPropagation());
      shadowRefs.host.addEventListener("click", (event) => event.stopPropagation());

      const root = document.createElement("section");
      root.id = ROOT_ID;
      root.setAttribute("data-reskin", "true");
      root.style.visibility = "hidden";
      root.style.opacity = "0";
      root.style.pointerEvents = "none";
      root.innerHTML = `
        <div class="rv-shell" data-reskin="true">
          <aside class="rv-categories" data-reskin="true">
            <div class="rv-brand" data-reskin="true">Mailita</div>
            <div class="rv-categories-servers" data-reskin="true">
              <button type="button" class="rv-icon-home" data-server-id="" title="Inbox" data-reskin="true">Inbox</button>
              <div class="rv-servers-list" data-reskin="true"></div>
              <button type="button" class="rv-server-new" data-reskin="true" title="New server">+ New server</button>
            </div>
            <div class="rv-categories-nav" data-reskin="true"></div>
            <div class="rv-side-triage" data-reskin="true">
              <div class="rv-side-triage-list" data-reskin="true"></div>
              <div class="rv-side-triage-meta" data-reskin="true"></div>
            </div>
            <div class="rv-event-logs" data-reskin="true">
              <div class="rv-event-logs-head" data-reskin="true">Event log</div>
              <div class="rv-event-logs-list" data-reskin="true"></div>
            </div>
            <div class="rv-categories-footer" data-reskin="true">
              <button type="button" class="rv-settings" data-reskin="true">Settings</button>
            </div>
          </aside>
          <div class="rv-resize-grip" data-resize="1" data-reskin="true" title="Drag to resize"></div>
          <aside class="rv-mail-col" data-reskin="true">
            <div class="rv-mail-col-search" data-reskin="true">
              <input type="text" class="rv-search" placeholder="Search mail" data-reskin="true" />
            </div>
            <div class="rv-list" data-reskin="true"></div>
          </aside>
          <div class="rv-resize-grip" data-resize="2" data-reskin="true" title="Drag to resize"></div>
          <main class="rv-chat-area" data-reskin="true">
            <div class="rv-chat-placeholder" data-reskin="true">Select a conversation</div>
            <div class="rv-thread-wrap" data-reskin="true" style="display:none;"></div>
            <div class="rv-settings-wrap" data-reskin="true" style="display:none;"></div>
            <div class="rv-list-wrap rv-list-view" data-reskin="true" style="display:none;"></div>
          </main>
          <div class="rv-resize-grip" data-resize="3" data-reskin="true" title="Drag to resize"></div>
          <aside class="rv-right" data-reskin="true"></aside>
        </div>
      `;
      shadowRefs.root.appendChild(root);

      let stylePendingCount = 0;
      let stylesReady = false;
      const revealRootAfterStyles = (reason) => {
        if (stylesReady) return;
        stylesReady = true;
        root.style.visibility = "";
        root.style.opacity = "";
        root.style.pointerEvents = "";
        logEvent("styles:ready", {
          reason: normalize(reason || "unknown"),
          pending: Number(stylePendingCount || 0)
        });
      };
      const styleHrefs = [
        resolveExtensionUrl("styles-shell.css"),
        resolveExtensionUrl("styles-thread.css")
      ].filter(Boolean);
      if (styleHrefs.length === 0) {
        revealRootAfterStyles("no-styles");
      } else {
        stylePendingCount = styleHrefs.length;
        for (const href of styleHrefs) {
          const styleLink = document.createElement("link");
          styleLink.rel = "stylesheet";
          styleLink.href = href;
          styleLink.addEventListener("load", () => {
            stylePendingCount = Math.max(0, stylePendingCount - 1);
            if (stylePendingCount === 0) revealRootAfterStyles("loaded");
          }, { once: true });
          styleLink.addEventListener("error", () => {
            stylePendingCount = Math.max(0, stylePendingCount - 1);
            logWarn(`Failed to load stylesheet: ${href}`);
            if (stylePendingCount === 0) revealRootAfterStyles("error");
          }, { once: true });
          shadowRefs.root.appendChild(styleLink);
        }
        setTimeout(() => {
          revealRootAfterStyles("timeout");
        }, 2200);
      }

      clearEventLog();
      logEvent("reskin:ready", {});
      if (!state.reskinReadyAt) state.reskinReadyAt = Date.now();
      if (!shadowRefs.eventLogClickBound) {
        shadowRefs.eventLogClickBound = true;
        document.addEventListener("click", (event) => {
          const path = typeof event.composedPath === "function" ? event.composedPath() : [];
          const node = Array.isArray(path) && path.length > 0 ? path[0] : event.target;
          const target = node instanceof Element ? node : event.target;
          if (!(target instanceof Element)) return;
          if (target.closest?.(".rv-event-logs")) return;
          let targetForLog = target;
          if (Array.isArray(path) && path.length > 0) {
            for (const entry of path) {
              if (!(entry instanceof Element)) continue;
              if (entry.classList?.contains("rv-item") || entry.classList?.contains("rv-back")
                || entry.classList?.contains("rv-thread-send") || entry.classList?.contains("rv-find-history")
                || entry.tagName === "BUTTON") {
                targetForLog = entry;
                break;
              }
            }
          }
          const tag = targetForLog.tagName?.toLowerCase() || "?";
          const id = targetForLog.id ? `#${targetForLog.id}` : "";
          const cls = (targetForLog.className && typeof targetForLog.className === "string")
            ? "." + targetForLog.className.split(/\s+/).slice(0, 2).filter(Boolean).join(".")
            : "";
          const area = (targetForLog.id === "rv-shadow-host" || targetForLog.closest?.("[data-reskin]")) ? "reskin" : "gmail";
          const label = (targetForLog.textContent || "").slice(0, 30).replace(/\s+/g, " ").trim();
          const desc = [tag, id, cls].filter(Boolean).join("") || tag;
          logEvent("click", { target: desc, area, label: label || undefined });
        }, true);
      }
      applyColumnWidths(root);
      bindRootEvents(root);
      const settingsButton = root.querySelector(".rv-settings");
      if (settingsButton instanceof HTMLElement && settingsButton.getAttribute("data-bound-direct") !== "true") {
        settingsButton.addEventListener(
          "click",
          (event) => {
            consumeEvent(event);
            openSettingsView(root);
          },
          true
        );
        settingsButton.setAttribute("data-bound-direct", "true");
      }
      return root;
    }

    function applyReskin() {
      ensureStylesheet();
      const root = ensureRoot();
      if (!root) return;
      applyTheme(root);
      syncViewFromHash();
      renderCurrentView(root);
      ensureMode();
    }

    function startShadowGuardian() {
      if (!document.body) return;
      const guardian = new MutationObserver(() => {
        if (!document.getElementById("rv-shadow-host")) {
          shadowRefs.host = null;
          shadowRefs.root = null;
          ensureRoot();
          const root = getRoot();
          if (root) renderCurrentView(root);
        }
      });
      guardian.observe(document.body, { childList: true, subtree: false });
    }

    function waitForReady() {
      removeLegacyNodes();

      ensureStylesheet();
      ensureMode();
      if (document.body) {
        const earlyRoot = ensureRoot();
        if (earlyRoot instanceof HTMLElement && !earlyRoot.style.background) {
          earlyRoot.style.background = "var(--rv-bg, #1e1f22)";
        }
      }

      let lastHash = window.location.hash || "";
      window.addEventListener("hashchange", () => {
        const next = window.location.hash || "";
        logEvent("hash:change", { from: lastHash.slice(0, 60), to: next.slice(0, 60) });
        lastHash = next;
        syncViewFromHash();
        state.lastObserverSignature = "";
        const root = getRoot();
        if (root instanceof HTMLElement) renderCurrentView(root);
      });

      const bootstrap = () => {
        if (!normalize(window.location.hash || "")) {
          window.location.hash = "#inbox";
        }
        logInfo("Gmail ready. Applying viewer.");
        logEvent("bootstrap:ready", { hash: (window.location.hash || "").slice(0, 60) });
        applyReskin();
        startShadowGuardian();
        if (state.startupBootDeferredScheduled) return;
        state.startupBootDeferredScheduled = true;

        const scheduleHeavy = typeof scheduleHeavyWorkAfterIdle === "function"
          ? scheduleHeavyWorkAfterIdle
          : scheduleDeferredWork;
        const instantMode = STARTUP_PERF_MODE === "instant";
        if (!instantMode) {
          scheduleHeavy(() => {
            loadPersistedTriageMap()
              .catch((error) => logWarn("Local triage map bootstrap failed", error))
              .finally(() => {
                state.lastListSignature = "";
                state.lastObserverSignature = "";
              });
          }, {
            minIdleMs: 0,
            hardTimeoutMs: 3000,
            delayMs: 0,
            timeoutMs: 2200,
            reason: "bootstrap-triage-map"
          });

          scheduleHeavy(() => {
            loadPersistedSummaries().catch((error) => logWarn("Row summary cache bootstrap failed", error));
          }, {
            minIdleMs: 400,
            hardTimeoutMs: 3200,
            delayMs: 120,
            timeoutMs: 2200,
            reason: "bootstrap-summaries"
          });

          scheduleHeavy(() => {
            ensureInboxSdkReady().catch((error) => {
              logWarn(`InboxSDK bootstrap failed: ${normalize(error && error.message ? error.message : String(error || ""))}`);
            });
          }, {
            minIdleMs: 1000,
            hardTimeoutMs: 4200,
            delayMs: 400,
            timeoutMs: 3000,
            reason: "bootstrap-inboxsdk"
          });
        } else {
          logEvent("bootstrap:heavy-init-skipped", { mode: "instant" });
        }

        if (!state.accountRefreshTimer) {
          state.accountRefreshTimer = setInterval(() => {
            scheduleHeavy(() => {
              detectCurrentUserEmail(true);
            }, { minIdleMs: 2000, hardTimeoutMs: 8000, reason: "account-refresh" });
          }, 5 * 60 * 1000);
        }

        setTimeout(() => {
          if (STARTUP_PERF_MODE === "instant" || ENABLE_BOOTSTRAP_SCAN_KICK === false) return;
          const root = getRoot();
          if (!(root instanceof HTMLElement)) return;
          if (state.fullScanRunning) return;
          const currentHash = normalize(window.location.hash || "");
          const onThreadHash = /^#(?:thread-)?f:[A-Za-z0-9_-]+$/i.test(currentHash)
            || /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i.test(currentHash);
          if (state.currentView === "thread" || onThreadHash) {
            logEvent("bootstrap:scan-kick:skip", {
              view: normalize(state.currentView || ""),
              hash: currentHash.slice(0, 60)
            });
            return;
          }
          const scheduleScanKick = resolveScheduleMailboxScanKick();
          if (typeof scheduleScanKick !== "function") return;
          logEvent("bootstrap:scan-kick", { mailboxes: ["inbox", "sent"] });
          scheduleScanKick(root, { mailboxes: ["inbox", "sent"], delayMs: 0 });
        }, 500);
      };

      if (selectFirst(GMAIL_READY_SELECTORS)) {
        bootstrap();
        return;
      }

      logInfo("Waiting for Gmail landmarks...");
      const poll = setInterval(() => {
        if (!selectFirst(GMAIL_READY_SELECTORS)) return;
        clearInterval(poll);
        bootstrap();
      }, 100);
    }

    function buildChatDebugApi() {
      return {
        enable: () => setChatDebugEnabled(true),
        disable: () => setChatDebugEnabled(false),
        set: (enabled) => setChatDebugEnabled(enabled),
        isEnabled: () => chatDebugEnabled(),
        detectAccountNow: () => detectCurrentUserEmail(true),
        dumpState: () => ({
          view: normalize(state.currentView || ""),
          activeThreadId: normalize(state.activeThreadId || ""),
          threadContext: activeThreadTimelineContext(),
          activeAccountEmail: extractEmail(state.activeAccountEmail || state.currentUserEmail || ""),
          listMode: LIST_MODE,
          chatMode: CHAT_MODE,
          activeContactEmail: extractEmail(state.activeContactEmail || ""),
          activeConversationKey: normalize(state.activeConversationKey || ""),
          contactThreadCount: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : 0,
          contactHydrationRunId: Number(state.contactHydrationRunId || 0),
          contactTimelineV2Enabled: (
            typeof resolveIsContactTimelineV2Enabled() === "function"
              ? resolveIsContactTimelineV2Enabled()()
              : false
          ),
          contactTimelineMessageCount: Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages.length : 0,
          contactTimelineSample: summarizeChatMessagesForDebug(state.activeTimelineMessages || [], 12),
          mergedCount: Array.isArray(state.mergedMessages) ? state.mergedMessages.length : 0,
          mergedSample: summarizeChatMessagesForDebug(state.mergedMessages || [], 12),
          threadExtractRetry: Number(state.threadExtractRetry || 0),
          scanRunId: Number(state.scanRunId || 0),
          scanPaused: Boolean(state.scanPaused),
          scanPauseReason: normalize(state.scanPauseReason || ""),
          interactionEpoch: Number(state.interactionEpoch || 0),
          activeTask: normalize(state.activeTask || ""),
          contactMergeMetrics: state.lastContactMergeMetrics || null,
          contactTimelineV2Metrics: state.contactTimelineV2Metrics || null
        }),
        dumpMailboxCache: () => ({
          inboxCount: (() => {
            const cacheKey = resolveMailboxCacheKey();
            const key = typeof cacheKey === "function" ? cacheKey("inbox") : "inbox";
            return Array.isArray(state.scannedMailboxMessages[key])
              ? state.scannedMailboxMessages[key].length
              : 0;
          })(),
          sentCount: (() => {
            const cacheKey = resolveMailboxCacheKey();
            const key = typeof cacheKey === "function" ? cacheKey("sent") : "sent";
            return Array.isArray(state.scannedMailboxMessages[key])
              ? state.scannedMailboxMessages[key].length
              : 0;
          })(),
          cacheRevision: Number(state.mailboxCacheRevision || 0)
        }),
        dumpReplyDebug: () => (
          window.ReskinCompose && typeof window.ReskinCompose.getLastReplyDebug === "function"
            ? window.ReskinCompose.getLastReplyDebug()
            : null
        ),
        dumpAccountState: () => ({
          currentUserEmail: extractEmail(state.currentUserEmail || ""),
          activeAccountEmail: extractEmail(state.activeAccountEmail || ""),
          detectedAt: Number(state.currentUserEmailDetectedAt || 0),
          hash: normalize(window.location.hash || "")
        }),
        dumpPerf: () => ({
          samples: summarizePerfSamplesByStage(),
          budgets: typeof summarizePerfBudgets === "function" ? summarizePerfBudgets() : {},
          recentTraces: state.perfTraceOrder
            .slice(-10)
            .map((id) => state.perfTraces[id])
            .filter(Boolean)
            .map((trace) => ({
              id: trace.id,
              startWallAt: Number(trace.startWallAt || 0),
              meta: trace.meta || {},
              stages: Array.isArray(trace.stages) ? trace.stages.map((entry) => ({
                stage: normalize(entry && entry.stage || ""),
                durationMs: Math.round(Number(entry && entry.durationMs || 0)),
                at: Number(entry && entry.at || 0)
              })) : []
            })),
          recentLongTasks: (Array.isArray(state.perfLongTasks) ? state.perfLongTasks : []).slice(-40)
        }),
        dumpPerfBudgets: () => (
          typeof summarizePerfBudgets === "function"
            ? summarizePerfBudgets()
            : {}
        )
      };
    }

    function installDebugBridgeListener() {
      if (installDebugBridgeListener._installed) return;
      installDebugBridgeListener._installed = true;
      window.addEventListener(DEBUG_BRIDGE_REQUEST_EVENT, async (event) => {
        const detail = event && event.detail && typeof event.detail === "object" ? event.detail : {};
        const id = normalize(detail.id || "");
        const method = normalize(detail.method || "");
        const args = Array.isArray(detail.args) ? detail.args : [];
        const api = buildChatDebugApi();
        let ok = true;
        let result = null;
        let error = "";
        try {
          if (!method || typeof api[method] !== "function") {
            throw new Error(`Unknown debug method: ${method || "(empty)"}`);
          }
          result = await api[method](...args);
        } catch (err) {
          ok = false;
          error = normalize(err && err.message ? err.message : String(err || "debug bridge failure"));
        }
        window.dispatchEvent(new CustomEvent(DEBUG_BRIDGE_RESPONSE_EVENT, {
          detail: { id, ok, result, error }
        }));
      });
    }

    function installPageDebugBridge() {
      if (installPageDebugBridge._installed) return;
      installPageDebugBridge._installed = true;
      if (document.getElementById(DEBUG_BRIDGE_SCRIPT_ID)) return;
      const runtime = (
        typeof chrome !== "undefined"
        && chrome
        && chrome.runtime
        && typeof chrome.runtime.getURL === "function"
      )
        ? chrome.runtime
        : null;
      if (!runtime) return;
      const target = document.documentElement || document.head || document.body;
      if (!(target instanceof HTMLElement)) return;
      const script = document.createElement("script");
      script.id = DEBUG_BRIDGE_SCRIPT_ID;
      script.src = runtime.getURL("page-debug-bridge.js");
      script.async = false;
      script.setAttribute("data-reskin", "true");
      script.addEventListener("load", () => {
        script.remove();
      }, { once: true });
      script.addEventListener("error", () => {
        script.remove();
        logChatDebug("chat-debug:bridge-failed", {
          reason: "page-debug-script-load-failed"
        }, { throttleKey: "chat-debug-bridge-failed", throttleMs: 2000 });
      }, { once: true });
      target.appendChild(script);
    }

    function exposeChatDebugControls() {
      try {
        installLongTaskObserver();
        globalThis.ReskinChatDebug = buildChatDebugApi();
        installDebugBridgeListener();
        installPageDebugBridge();
        logChatDebug("chat-debug:controls-ready", {
          hint: "Page console: await window.ReskinChatDebug.dumpState(); Content world: window.ReskinChatDebug.dumpState()"
        }, { throttleKey: "chat-debug-controls-ready", throttleMs: 5000 });
      } catch (_) {
        // ignore global assignment failures
      }
    }

    return {
      getColumnWidths,
      saveColumnWidths,
      applyColumnWidths,
      ensureRoot,
      applyReskin,
      startShadowGuardian,
      waitForReady,
      buildChatDebugApi,
      installDebugBridgeListener,
      installPageDebugBridge,
      exposeChatDebugControls
    };
  };
})();
