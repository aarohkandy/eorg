(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createUiControlsApi = function createUiControlsApi(deps = {}) {
    const {
      THEME_DARK,
      MIN_COL_PX,
      MAX_COL_PX,
      TRIAGE_LEVELS,
      state,
      normalize,
      normalizeTheme,
      applyTheme,
      applyReskin,
      consumeEvent,
      openSettingsView,
      submitThreadReply,
      bumpInteractionEpoch,
      setActiveTask,
      clearContactConversationState,
      sanitizeListHash,
      navigateToList,
      lockInteractions,
      mailboxCacheKey,
      parseListRoute,
      getRoot,
      threadIdInServer,
      escapeHtml,
      canonicalThreadId,
      schedulePersistSyncDraft,
      activeMailbox,
      applyColumnWidths,
      getColumnWidths,
      saveColumnWidths,
      getRenderCurrentView,
      getRenderSettings,
      getRenderList,
      logWarn
    } = deps;
    const resolveRenderSettings = () => (
      typeof getRenderSettings === "function" ? getRenderSettings() : null
    );
    const resolveRenderCurrentView = () => (
      typeof getRenderCurrentView === "function" ? getRenderCurrentView() : null
    );
    const resolveRenderList = () => (
      typeof getRenderList === "function" ? getRenderList() : null
    );
  const LOCAL_SETTINGS_KEY = "reskin_local_settings_v1";

  function readLocalSettings() {
    try {
      const raw = localStorage.getItem(LOCAL_SETTINGS_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (_) {
      return null;
    }
  }

  function writeLocalSettings(next) {
    try {
      const payload = JSON.stringify(next && typeof next === "object" ? next : {});
      localStorage.setItem(LOCAL_SETTINGS_KEY, payload);
    } catch (_) {
      // Ignore storage write failures.
    }
  }

  async function loadSettingsCached(force = false) {
    if (!force && state.settingsCache) return state.settingsCache;
    if (!force && state.settingsLoadFailed) return null;
    if (state.settingsLoadInFlight) return state.settingsCache;
    state.settingsLoadInFlight = true;
    try {
      const local = readLocalSettings();
      if (local && typeof local === "object") {
        state.settingsCache = local;
      } else if (!state.settingsCache) {
        state.settingsCache = { theme: THEME_DARK };
      }
      applyTheme();
      state.settingsLoadFailed = false;
      return state.settingsCache;
    } catch (error) {
      state.settingsLoadFailed = true;
      logWarn("Failed to load local settings", error);
      return null;
    } finally {
      state.settingsLoadInFlight = false;
    }
  }

  async function saveSettingsFromDom(root, options = {}) {
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;

    const selectedTheme = normalizeTheme(
      view.querySelector('[name="theme"]:checked')?.value ||
      view.querySelector('[name="theme"]')?.value ||
      THEME_DARK
    );
    const localPayload = {
      ...(state.settingsCache && typeof state.settingsCache === "object" ? state.settingsCache : {}),
      theme: selectedTheme
    };
    state.settingsCache = localPayload;
    writeLocalSettings(localPayload);
    if (!options || !options.silent) {
      state.settingsStatusMessage = "Settings saved";
      applyReskin();
    }
  }

  function defaultModelForProvider() {
    return "";
  }

  function scheduleSettingsAutosave(root, delayMs = 650) {
    if (!(root instanceof HTMLElement)) return;
    if (state.settingsAutosaveTimer) {
      clearTimeout(state.settingsAutosaveTimer);
    }
    state.settingsAutosaveTimer = setTimeout(() => {
      state.settingsAutosaveTimer = null;
      if (state.currentView !== "settings") return;
      saveSettingsFromDom(root, { silent: true });
    }, Math.max(180, Number(delayMs) || 650));
  }

  function apiKeyPlaceholderForProvider() {
    return "";
  }

  function providerNeedsApiKey() {
    return false;
  }

  function buildApiKeyGuide() {
    return {
      label: "",
      linkText: "",
      href: "",
      steps: []
    };
  }

  function openApiKeyGuidePrompt() {}

  function applyProviderDefaultsToSettingsForm(root) {
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;
    const providerSelect = view.querySelector('[name="provider"]');
    const keyInput = view.querySelector('[name="apiKey"]');
    if (!(providerSelect instanceof HTMLSelectElement)) return;

    const provider = normalize(providerSelect.value || "openrouter").toLowerCase();
    if (keyInput instanceof HTMLInputElement) {
      keyInput.placeholder = apiKeyPlaceholderForProvider(provider);
    }
  }

  function bindRootEvents(root) {
    if (root.getAttribute("data-bound") === "true") return;

    root.addEventListener("mousedown", (event) => {
      const grip = event.target.closest(".rv-resize-grip");
      if (!(grip instanceof HTMLElement)) return;
      const which = parseInt(grip.getAttribute("data-resize") || "0", 10);
      if (!which || which < 1 || which > 4) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startWidths = getColumnWidths();
      let currentWidths = { ...startWidths };
      const colKey = `col${which}`;

      function onMove(e) {
        const delta = e.clientX - startX;
        const next = Math.min(MAX_COL_PX, Math.max(MIN_COL_PX, (startWidths[colKey] || 0) + delta));
        currentWidths = { ...currentWidths, [colKey]: next };
        applyColumnWidths(root, currentWidths);
      }

      function onUp() {
        saveColumnWidths(currentWidths);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        document.body.style.removeProperty("cursor");
        document.body.style.removeProperty("user-select");
      }

      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    }, true);

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (target.closest(".rv-settings")) {
        consumeEvent(event);
        openSettingsView(root);
        return;
      }

      if (target.closest(".rv-api-key-permission")) {
        consumeEvent(event);
        openApiKeyGuidePrompt(root);
        return;
      }

      if (target.closest(".rv-api-permission-allow")) {
        consumeEvent(event);
        state.apiKeyGuideGranted = true;
        state.showApiKeyPermissionModal = false;
        const renderSettings = resolveRenderSettings();
        if (typeof renderSettings === "function") {
          renderSettings(root);
        }
        return;
      }

      if (target.closest(".rv-api-permission-decline")) {
        consumeEvent(event);
        state.apiKeyGuideGranted = false;
        state.showApiKeyPermissionModal = false;
        const renderSettings = resolveRenderSettings();
        if (typeof renderSettings === "function") {
          renderSettings(root);
        }
        return;
      }

      if (target.closest(".rv-settings-open-gmail")) {
        consumeEvent(event);
        window.open("https://mail.google.com/#settings/fwdandpop", "_blank", "noopener,noreferrer");
        return;
      }

      if (target.closest(".rv-settings-open-apppasswords")) {
        consumeEvent(event);
        window.open("https://myaccount.google.com/apppasswords", "_blank", "noopener,noreferrer");
        return;
      }

      if (target.closest(".rv-settings-open-2fa")) {
        consumeEvent(event);
        window.open(
          "https://myaccount.google.com/signinoptions/two-step-verification",
          "_blank",
          "noopener,noreferrer"
        );
        return;
      }

      if (target.closest(".rv-settings-reload-mail")) {
        consumeEvent(event);
        state.settingsStatusMessage = "Refreshing mailbox view...";
        state.lastListSignature = "";
        state.lastObserverSignature = "";
        applyReskin();
        return;
      }

      if (target.closest(".rv-settings-health-check")) {
        consumeEvent(event);
        state.settingsStatusMessage = "Checking backend status...";
        applyReskin();
        (async () => {
          try {
            if (
              typeof chrome === "undefined"
              || !chrome.runtime
              || typeof chrome.runtime.sendMessage !== "function"
            ) {
              state.settingsStatusMessage = "Extension runtime messaging is unavailable.";
              applyReskin();
              return;
            }
            const response = await chrome.runtime.sendMessage({ action: "HEALTH_CHECK", payload: {} });
            if (!response || response.success === false) {
              const message = normalize(response && response.error) || "Backend health check failed.";
              state.settingsStatusMessage = message;
              if (normalize(response && response.code) === "BACKEND_COLD_START") {
                state.backendStatusMessage = "Backend server is starting up, please wait 60 seconds and try again.";
              }
            } else {
              state.settingsStatusMessage = "Backend is healthy.";
              state.backendStatusMessage = "";
            }
          } catch (error) {
            state.settingsStatusMessage = normalize(error && error.message) || "Backend health check failed.";
          }
          applyReskin();
        })();
        return;
      }

      if (target.closest(".rv-settings-sync-now")) {
        consumeEvent(event);
        state.settingsStatusMessage = "Syncing from backend...";
        applyReskin();
        (async () => {
          try {
            if (
              typeof chrome === "undefined"
              || !chrome.runtime
              || typeof chrome.runtime.sendMessage !== "function"
            ) {
              state.settingsStatusMessage = "Extension runtime messaging is unavailable.";
              applyReskin();
              return;
            }
            const response = await chrome.runtime.sendMessage({ action: "SYNC_MESSAGES", payload: {} });
            if (!response || response.success === false) {
              state.settingsStatusMessage = normalize(response && response.error) || "Sync failed.";
            } else {
              state.settingsStatusMessage = `Synced ${Number(response.synced || 0)} messages.`;
              state.backendStatusMessage = "";
            }
          } catch (error) {
            state.settingsStatusMessage = normalize(error && error.message) || "Sync failed.";
          }
          state.lastListSignature = "";
          state.lastObserverSignature = "";
          applyReskin();
        })();
        return;
      }

      if (target.closest(".rv-settings-disconnect")) {
        consumeEvent(event);
        state.settingsStatusMessage = "Disconnecting account...";
        applyReskin();
        (async () => {
          try {
            if (
              typeof chrome === "undefined"
              || !chrome.runtime
              || typeof chrome.runtime.sendMessage !== "function"
            ) {
              state.settingsStatusMessage = "Extension runtime messaging is unavailable.";
              applyReskin();
              return;
            }
            const response = await chrome.runtime.sendMessage({ action: "DISCONNECT", payload: {} });
            if (!response || response.success === false) {
              state.settingsStatusMessage = normalize(response && response.error) || "Disconnect failed.";
            } else {
              state.settingsStatusMessage = "Disconnected. Re-open popup onboarding to reconnect.";
              state.backendConnected = false;
              state.backendConnectedEmail = "";
              state.backendStatusMessage = "Not set up yet. Click the extension icon to connect.";
              state.scannedMailboxMessages = {};
              state.mailboxCacheRevision = Number(state.mailboxCacheRevision || 0) + 1;
            }
          } catch (error) {
            state.settingsStatusMessage = normalize(error && error.message) || "Disconnect failed.";
          }
          state.lastListSignature = "";
          state.lastObserverSignature = "";
          applyReskin();
        })();
        return;
      }

      if (target.closest(".rv-settings-view")) return;

      if (target.closest(".rv-back")) {
        consumeEvent(event);
        bumpInteractionEpoch("back-to-list");
        setActiveTask("back-to-list");
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = false;
        state.currentThreadIdForReply = "";
        state.currentThreadHintHref = "";
        state.currentThreadMailbox = "";
        clearContactConversationState();
        state.threadExtractRetry = 0;
        const targetHash = sanitizeListHash(state.lastListHash || "#inbox");
        state.lastListHash = targetHash;
        navigateToList(targetHash, "", { native: false });
        const renderCurrentView = resolveRenderCurrentView();
        if (typeof renderCurrentView === "function") {
          renderCurrentView(root);
        }
        return;
      }

      if (target.closest(".rv-thread-send")) {
        consumeEvent(event);
        submitThreadReply(root);
        return;
      }

      const triageItem = target.closest(".rv-triage-item");
      if (triageItem instanceof HTMLElement) {
        consumeEvent(event);
        clearContactConversationState();
        state.currentThreadMailbox = "";
        if (state.currentView === "settings") saveSettingsFromDom(root);
        lockInteractions(700);
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = false;
        const rawLevel = normalize(triageItem.getAttribute("data-triage-level") || "");
        const level = TRIAGE_LEVELS.find((l) => l.toLowerCase() === rawLevel.toLowerCase()) || rawLevel;
        const nextHash = level === "all" ? "#inbox" : `#inbox?triage=${level}`;
        if (level !== "all" && !TRIAGE_LEVELS.includes(level)) return;
        state.lastListHash = "#inbox";
        state.triageFilter = level === "all" ? "" : level;
        state.listVisibleByMailbox[mailboxCacheKey("inbox")] = state.listChunkSize;
        navigateToList(nextHash, "", { native: false });
        const list = root.querySelector(".rv-list");
        if (list instanceof HTMLElement) {
          list.innerHTML = '<div class="rv-empty" data-reskin="true">Loading inbox triage...</div>';
        }
        const latestRoot = getRoot();
        if (latestRoot instanceof HTMLElement) applyReskin();
        return;
      }

      const serverItem = target.closest(".rv-server-item, .rv-server-icon, .rv-icon-home");
      if (serverItem instanceof HTMLElement) {
        consumeEvent(event);
        clearContactConversationState();
        state.currentThreadMailbox = "";
        const id = serverItem.getAttribute("data-server-id");
        state.currentServerId = id === "" || id === null || id === undefined ? null : id;
        state.settingsPinned = false;
        state.currentView = "list";
        state.activeThreadId = "";
        applyReskin();
        return;
      }

      const serverNew = target.closest(".rv-server-new, .rv-icon-new-server");
      if (serverNew instanceof HTMLElement) {
        consumeEvent(event);
        clearContactConversationState();
        state.currentThreadMailbox = "";
        const name = window.prompt("Server name (e.g. Back deck quotes)", "");
        if (name != null && normalize(name)) {
          const id = `server-${Date.now()}`;
          state.servers = state.servers || [];
          state.servers.push({ id, name: normalize(name), threadIds: [] });
          state.currentServerId = id;
          schedulePersistSyncDraft();
          applyReskin();
        }
        return;
      }

      const serverBtn = target.closest(".rv-item-server-btn");
      if (serverBtn instanceof HTMLElement) {
        consumeEvent(event);
        const threadId = normalize(serverBtn.getAttribute("data-thread-id") || "");
        if (!threadId) return;
        const canonical = canonicalThreadId(threadId);
        let menu = root.querySelector(".rv-server-menu");
        if (menu instanceof HTMLElement) menu.remove();
        menu = document.createElement("div");
        menu.className = "rv-server-menu";
        menu.setAttribute("data-reskin", "true");
        const rect = serverBtn.getBoundingClientRect();
        const rootRect = root.getBoundingClientRect();
        menu.style.position = "absolute";
        menu.style.left = `${rect.left - rootRect.left}px`;
        menu.style.top = `${rect.bottom - rootRect.top + 4}px`;
        menu.style.minWidth = "160px";
        const server = state.currentServerId ? state.servers.find((s) => s.id === state.currentServerId) : null;
        if (server && threadIdInServer(threadId, server)) {
          menu.innerHTML = `<button type="button" class="rv-server-menu-item" data-action="remove" data-reskin="true">Remove from server</button>`;
        } else {
          const addButtons = (state.servers || []).map((s) => `<button type="button" class="rv-server-menu-item" data-action="add" data-server-id="${escapeHtml(s.id)}" data-reskin="true">Add to ${escapeHtml(s.name || "Unnamed")}</button>`).join("");
          menu.innerHTML = addButtons || `<span class="rv-server-menu-empty" data-reskin="true">No servers. Create one in the sidebar.</span>`;
        }
        root.appendChild(menu);
        const closeMenu = (ev) => {
          if (ev && ev.target instanceof Node && menu.contains(ev.target)) return;
          if (menu && menu.parentNode) menu.remove();
          root.removeEventListener("click", closeMenu);
        };
        root.addEventListener("click", closeMenu);
        setTimeout(() => {
          menu.querySelectorAll(".rv-server-menu-item").forEach((btn) => {
            btn.addEventListener("click", (e) => {
              e.stopPropagation();
              if (menu && menu.parentNode) menu.remove();
              root.removeEventListener("click", closeMenu);
              const action = btn.getAttribute("data-action");
              const serverId = btn.getAttribute("data-server-id");
              if (action === "remove" && server) {
                server.threadIds = (server.threadIds || []).filter((id) => canonicalThreadId(normalize(id)) !== canonical);
                schedulePersistSyncDraft();
              } else if (action === "add" && serverId) {
                const s = state.servers.find((sv) => sv.id === serverId);
                if (s && canonical && !(s.threadIds || []).some((id) => canonicalThreadId(normalize(id)) === canonical)) {
                  s.threadIds = s.threadIds || [];
                  s.threadIds.push(canonical);
                  schedulePersistSyncDraft();
                }
              }
              applyReskin();
            });
          });
        }, 0);
        return;
      }

      const navItem = target.closest(".rv-nav-item");
      if (!(navItem instanceof HTMLElement)) return;
      consumeEvent(event);
      if (state.currentView === "settings") saveSettingsFromDom(root);
      lockInteractions(300);
      const nextHash = navItem.getAttribute("data-target-hash") || "#inbox";
      const nativeLabel = navItem.getAttribute("data-native-label") || "";
      state.settingsPinned = false;
      state.currentView = "list";
      state.activeThreadId = "";
      state.currentThreadMailbox = "";
      state.lockListView = false;
      state.lastListHash = sanitizeListHash(nextHash, { clearTriage: true });
      state.triageFilter = "";
      state.listVisibleByMailbox[mailboxCacheKey(parseListRoute(state.lastListHash).mailbox)] = state.listChunkSize;
      navigateToList(state.lastListHash, nativeLabel);

      const list = root.querySelector(".rv-list");
      if (list instanceof HTMLElement) {
        list.innerHTML = `<div class="rv-empty" data-reskin="true">Loading ${escapeHtml(nextHash.replace("#", ""))}...</div>`;
      }

      {
        const latestRoot = getRoot();
        if (latestRoot instanceof HTMLElement) applyReskin();
      }

      return;
    });

    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const loadMore = target.closest(".rv-list-more");
      if (!(loadMore instanceof HTMLElement)) return;
      consumeEvent(event);
      const mailbox = mailboxCacheKey(activeMailbox());
      const current = Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize);
      state.listVisibleByMailbox[mailbox] = current + state.listChunkSize;
      const latestRoot = getRoot();
      if (latestRoot instanceof HTMLElement) {
        const renderCurrentView = resolveRenderCurrentView();
        if (typeof renderCurrentView === "function") {
          renderCurrentView(latestRoot);
        }
      }
    });

    root.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const providerSelect = target.closest('[name="provider"]');
      if (providerSelect instanceof HTMLSelectElement) {
        applyProviderDefaultsToSettingsForm(root);
        const view = root.querySelector(".rv-settings-view");
        if (!(view instanceof HTMLElement)) return;
        const keyInput = view.querySelector('[name="apiKey"]');
        if (keyInput instanceof HTMLInputElement) {
          keyInput.placeholder = apiKeyPlaceholderForProvider(providerSelect.value);
        }
        scheduleSettingsAutosave(root, 250);
        return;
      }

      if (target.closest(".rv-settings-view")) {
        const themeSelect = target.closest('[name="theme"]');
        if (themeSelect instanceof HTMLSelectElement || themeSelect instanceof HTMLInputElement) {
          if (!state.settingsCache) state.settingsCache = {};
          state.settingsCache.theme = normalizeTheme(themeSelect.value);
          const view = root.querySelector(".rv-settings-view");
          if (view instanceof HTMLElement) {
            for (const option of view.querySelectorAll(".rv-theme-option")) {
              if (!(option instanceof HTMLElement)) continue;
              const input = option.querySelector('input[name="theme"]');
              option.classList.toggle("is-active", input instanceof HTMLInputElement && input.checked);
            }
          }
          applyTheme(root);
        }
        scheduleSettingsAutosave(root, 450);
      }
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const view = target.closest(".rv-settings-view");
      if (!(view instanceof HTMLElement)) return;
      scheduleSettingsAutosave(root, 700);
    });

    root.setAttribute("data-bound", "true");
  }

    return {
      loadSettingsCached,
      saveSettingsFromDom,
      scheduleSettingsAutosave,
      defaultModelForProvider,
      apiKeyPlaceholderForProvider,
      providerNeedsApiKey,
      buildApiKeyGuide,
      openApiKeyGuidePrompt,
      applyProviderDefaultsToSettingsForm,
      bindRootEvents
    };
  };
})();
