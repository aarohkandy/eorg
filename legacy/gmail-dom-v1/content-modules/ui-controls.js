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
      askInboxQuestion,
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
  async function loadSettingsCached(force = false) {
    if (!force && state.settingsCache) return state.settingsCache;
    if (!force && state.settingsLoadFailed) return null;
    if (state.settingsLoadInFlight) return state.settingsCache;
    if (!window.ReskinAI || typeof window.ReskinAI.loadSettings !== "function") return null;
    state.settingsLoadInFlight = true;
    try {
      state.settingsCache = await window.ReskinAI.loadSettings();
      applyTheme();
      state.settingsLoadFailed = false;
      return state.settingsCache;
    } catch (error) {
      state.settingsLoadFailed = true;
      logWarn("Failed to load AI settings", error);
      return null;
    } finally {
      state.settingsLoadInFlight = false;
    }
  }

  async function saveSettingsFromDom(root, options = {}) {
    if (!window.ReskinAI || typeof window.ReskinAI.saveSettings !== "function") return;
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;

    const provider = normalize(view.querySelector('[name="provider"]')?.value || "openrouter");
    const apiKey = normalize(view.querySelector('[name="apiKey"]')?.value || "");
    const selectedTheme = normalizeTheme(
      view.querySelector('[name="theme"]:checked')?.value ||
      view.querySelector('[name="theme"]')?.value ||
      THEME_DARK
    );
    const consentCheckbox = view.querySelector('[name="consentTriage"]');
    const consentTriage = consentCheckbox instanceof HTMLInputElement && consentCheckbox.checked;
    const payload = {
      provider,
      apiKey,
      apiKeys: apiKey ? [apiKey] : [],
      theme: selectedTheme,
      model: defaultModelForProvider(provider),
      consentTriage: Boolean(consentTriage)
    };

    try {
      const saved = await window.ReskinAI.saveSettings(payload);
      state.settingsCache = saved;
      if (!options || !options.silent) {
        state.triageStatus = "Settings saved";
        applyReskin();
      }
    } catch (error) {
      state.triageStatus = "Settings save failed";
      logWarn("Save settings failed", error);
      applyReskin();
    }
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

  function defaultModelForProvider(provider) {
    const value = normalize(provider).toLowerCase();
    if (value === "groq") {
      const options = window.ReskinAI && Array.isArray(window.ReskinAI.GROQ_FREE_MODELS)
        ? window.ReskinAI.GROQ_FREE_MODELS
        : [];
      return options[0] || "llama-3.1-8b-instant";
    }
    if (value === "ollama") return "llama3.1";
    return "openrouter/free";
  }

  function apiKeyPlaceholderForProvider(provider) {
    const value = normalize(provider).toLowerCase();
    if (value === "groq") return "Groq API key";
    if (value === "ollama") return "Not required for local Ollama";
    return "OpenRouter API key";
  }

  function providerNeedsApiKey(provider) {
    return normalize(provider).toLowerCase() !== "ollama";
  }

  function buildApiKeyGuide(provider) {
    const value = normalize(provider).toLowerCase();
    if (value === "groq") {
      return {
        label: "Groq",
        linkText: "Open Groq Console",
        href: "https://console.groq.com/keys",
        steps: [
          "Sign in to your Groq account.",
          "Open API Keys and create a new key.",
          "Copy the key once shown.",
          "Paste it into API Key below."
        ]
      };
    }
    return {
      label: "OpenRouter",
      linkText: "Open OpenRouter Keys",
      href: "https://openrouter.ai/keys",
      steps: [
        "Sign in to your OpenRouter account.",
        "Create a new API key from the keys page.",
        "Copy the key value.",
        "Paste it into API Key below."
      ]
    };
  }

  function openApiKeyGuidePrompt(root) {
    const view = root.querySelector(".rv-settings-view");
    if (!(view instanceof HTMLElement)) return;
    const provider = normalize(view.querySelector('[name="provider"]')?.value || "openrouter");
    if (!providerNeedsApiKey(provider)) return;
    state.showApiKeyPermissionModal = true;
    const renderSettings = resolveRenderSettings();
    if (typeof renderSettings === "function") {
      renderSettings(root);
    }
  }

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

      if (target.closest(".rv-ai-qa-submit")) {
        consumeEvent(event);
        askInboxQuestion(root);
        return;
      }

      if (target.closest(".rv-thread-send")) {
        consumeEvent(event);
        submitThreadReply(root);
        return;
      }

      const chatShell = target.closest(".rv-ai-chat");
      if (chatShell instanceof HTMLElement) {
        const interactive = target.closest("button, a, textarea, input, select, [role='button']");
        if (!interactive) {
          const input = root.querySelector(".rv-ai-qa-input");
          if (input instanceof HTMLTextAreaElement) input.focus();
        }
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
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      state.aiQuestionText = target.value || "";
      target.classList.toggle("is-has-text", Boolean(normalize(target.value || "")));
    });

    root.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const view = target.closest(".rv-settings-view");
      if (!(view instanceof HTMLElement)) return;
      if (target.classList.contains("rv-ai-qa-input")) return;
      scheduleSettingsAutosave(root, 700);
    });

    root.addEventListener("keydown", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      if (event.key !== "Enter" || event.shiftKey) return;
      consumeEvent(event);
      askInboxQuestion(root);
    });

    root.addEventListener("focusin", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      target.classList.add("is-focused");
    });

    root.addEventListener("focusout", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLTextAreaElement)) return;
      if (!target.classList.contains("rv-ai-qa-input")) return;
      target.classList.remove("is-focused");
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
