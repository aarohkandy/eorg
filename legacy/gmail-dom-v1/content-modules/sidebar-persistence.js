(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createSidebarPersistenceApi = function createSidebarPersistenceApi(deps = {}) {
    const {
      LOCAL_READ_HOLD_MS,
      TRIAGE_LEVELS,
      OLD_TO_NEW_TRIAGE,
      TRIAGE_MAP_STORAGE_KEY,
      SYNC_DRAFT_STORAGE_KEY,
      SUMMARY_STORAGE_KEY,
      SUMMARY_TTL_MS,
      SUMMARY_BATCH_SIZE,
      PRIMARY_NAV_HASHES,
      NAV_ITEMS,
      state,
      normalize,
      canonicalThreadId,
      localReadKeysForThread,
      activeMailbox,
      activeTriageFilter,
      getActiveNavHash,
      triageLabelText,
      escapeHtml,
      applyReskin,
      getRoot,
      sleep,
      getMailboxCacheKey,
      getCollectMessages,
      getRenderList,
      logWarn,
      logTriageDebug
    } = deps;

    const mailboxCacheKey = (...args) => {
      const fn = typeof getMailboxCacheKey === "function" ? getMailboxCacheKey() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const collectMessages = (...args) => {
      const fn = typeof getCollectMessages === "function" ? getCollectMessages() : null;
      if (typeof fn !== "function") return { source: "", items: [] };
      return fn(...args);
    };
    const renderList = (...args) => {
      const fn = typeof getRenderList === "function" ? getRenderList() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };
  function markThreadReadLocally(threadId, holdMs = LOCAL_READ_HOLD_MS) {
    const keys = localReadKeysForThread(threadId);
    if (keys.length === 0) return;
    const until = Date.now() + Math.max(1000, Number(holdMs) || LOCAL_READ_HOLD_MS);
    state.localReadUntilByThread = state.localReadUntilByThread || {};
    for (const key of keys) {
      state.localReadUntilByThread[key] = until;
    }
  }

  function isThreadMarkedReadLocally(threadId) {
    const keys = localReadKeysForThread(threadId);
    if (keys.length === 0) return false;
    const now = Date.now();
    const map = state.localReadUntilByThread || {};
    let marked = false;
    for (const key of keys) {
      const until = Number(map[key] || 0);
      if (!until) continue;
      if (until < now) {
        delete map[key];
        continue;
      }
      marked = true;
    }
    return marked;
  }

  function clearUnreadClassesInRow(row) {
    if (!(row instanceof HTMLElement)) return;
    row.classList.remove("zE");
    for (const node of row.querySelectorAll(".zE")) {
      if (node instanceof HTMLElement) node.classList.remove("zE");
    }
  }

  function markThreadsReadLocally(threadIds, rows = []) {
    const ids = Array.from(new Set((threadIds || []).map((id) => normalize(id)).filter(Boolean)));
    if (ids.length === 0) return;
    const canonicalIds = new Set(ids.map((id) => canonicalThreadId(id)).filter(Boolean));
    for (const id of ids) markThreadReadLocally(id);

    const rowCandidates = [];
    for (const row of rows || []) {
      if (row instanceof HTMLElement) rowCandidates.push(row);
    }
    for (const id of ids) {
      try {
        const escaped = CSS.escape(id);
        const byAttr = document.querySelector(`[data-thread-id="${escaped}"], [data-legacy-thread-id="${escaped}"]`);
        if (byAttr instanceof HTMLElement) rowCandidates.push(byAttr);
      } catch (_) { /* ignore invalid selector input */ }
    }
    for (const row of rowCandidates) {
      const targetRow = row.closest('[role="row"], tr, .zA, [data-thread-id], [data-legacy-thread-id]') || row;
      clearUnreadClassesInRow(targetRow);
    }

    for (const mailboxKey of Object.keys(state.scannedMailboxMessages || {})) {
      const list = state.scannedMailboxMessages[mailboxKey];
      if (!Array.isArray(list) || list.length === 0) continue;
      for (const msg of list) {
        const canonical = canonicalThreadId(msg && msg.threadId);
        if (!canonical || !canonicalIds.has(canonical)) continue;
        msg.unread = false;
      }
    }

    state.lastListSignature = "";
  }

  function triageLocalGet(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return "";
    const canonical = canonicalThreadId(raw);
    const direct = state.triageLocalMap[raw];
    if (direct && TRIAGE_LEVELS.includes(direct)) return direct;
    const byCanonical = state.triageLocalMap[canonical];
    if (byCanonical && TRIAGE_LEVELS.includes(byCanonical)) return byCanonical;
    return "";
  }

  function triageLocalSet(threadId, level) {
    const raw = normalize(threadId || "");
    const urgency = normalize(level || "").toLowerCase();
    if (!raw || !TRIAGE_LEVELS.includes(urgency)) return;
    const canonical = canonicalThreadId(raw);
    state.triageLocalMap[raw] = urgency;
    if (canonical) {
      state.triageLocalMap[canonical] = urgency;
      state.triageLocalMap[`#${canonical}`] = urgency;
      if (canonical.startsWith("f:")) {
        const id = canonical.slice(2);
        state.triageLocalMap[`thread-f:${id}`] = urgency;
        state.triageLocalMap[`#thread-f:${id}`] = urgency;
      }
    }
    schedulePersistTriageMap();
  }

  function normalizePersistedTriageMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    for (const [threadId, level] of Object.entries(input)) {
      const id = normalize(threadId || "");
      const rawUrgency = normalize(level || "").toLowerCase();
      const urgency = OLD_TO_NEW_TRIAGE[rawUrgency] || rawUrgency;
      if (!id || !TRIAGE_LEVELS.includes(urgency)) continue;
      out[id] = urgency;
      const canonical = canonicalThreadId(id);
      if (canonical) {
        out[canonical] = urgency;
        out[`#${canonical}`] = urgency;
        if (canonical.startsWith("f:")) {
          const suffix = canonical.slice(2);
          out[`thread-f:${suffix}`] = urgency;
          out[`#thread-f:${suffix}`] = urgency;
        }
      }
    }
    return out;
  }

  async function loadPersistedTriageMap() {
    if (state.triageMapLoaded || state.triageMapLoadInFlight) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    state.triageMapLoadInFlight = true;
    try {
      const raw = await chrome.storage.local.get(TRIAGE_MAP_STORAGE_KEY);
      const input = raw[TRIAGE_MAP_STORAGE_KEY];
      const map = normalizePersistedTriageMap(input);
      state.triageLocalMap = map;
      state.triageMapLoaded = true;
      const hadOldKeys = input && typeof input === "object" && Object.values(input).some((v) => OLD_TO_NEW_TRIAGE[normalize(v || "").toLowerCase()]);
      if (hadOldKeys && Object.keys(map).length > 0) {
        const compact = {};
        for (const [key, level] of Object.entries(map)) {
          const canonical = canonicalThreadId(key);
          if (canonical && canonical.startsWith("f:")) compact[canonical] = level;
        }
        await chrome.storage.local.set({ [TRIAGE_MAP_STORAGE_KEY]: compact });
        logTriageDebug("Migrated triage map to new level keys and persisted", { keys: Object.keys(compact).length });
      } else {
        logTriageDebug("Loaded local triage map", { keys: Object.keys(map).length });
      }
      await loadSyncDraft();
    } catch (error) {
      logWarn("Failed to load local triage map", error);
    } finally {
      state.triageMapLoadInFlight = false;
    }
  }

  let syncDraftPersistTimer = null;
  async function loadSyncDraft() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    try {
      const raw = await chrome.storage.local.get(SYNC_DRAFT_STORAGE_KEY);
      const payload = raw[SYNC_DRAFT_STORAGE_KEY];
      if (!payload || typeof payload !== "object") return;
      const v = Number(payload.v) || 0;
      if (v < 1) return;
      if (Array.isArray(payload.servers)) state.servers = payload.servers;
      if (payload.triage && typeof payload.triage === "object") {
        const map = normalizePersistedTriageMap(payload.triage);
        for (const [id, level] of Object.entries(map)) state.triageLocalMap[id] = level;
      }
    } catch (error) {
      logWarn("Failed to load sync draft", error);
    }
  }

  function schedulePersistSyncDraft() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    if (syncDraftPersistTimer) clearTimeout(syncDraftPersistTimer);
    syncDraftPersistTimer = setTimeout(async () => {
      syncDraftPersistTimer = null;
      try {
        const compactTriage = {};
        for (const [key, level] of Object.entries(state.triageLocalMap)) {
          const canonical = canonicalThreadId(key);
          if (canonical && canonical.startsWith("f:")) compactTriage[canonical] = level;
        }
        const payload = { v: 1, triage: compactTriage, servers: state.servers || [] };
        await chrome.storage.local.set({ [SYNC_DRAFT_STORAGE_KEY]: payload });
      } catch (error) {
        logWarn("Failed to persist sync draft", error);
      }
    }, 400);
  }

  function schedulePersistTriageMap() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    if (state.triageMapPersistTimer) {
      clearTimeout(state.triageMapPersistTimer);
    }
    state.triageMapPersistTimer = setTimeout(async () => {
      state.triageMapPersistTimer = null;
      try {
        const compact = {};
        for (const [key, level] of Object.entries(state.triageLocalMap)) {
          const canonical = canonicalThreadId(key);
          if (!canonical || !canonical.startsWith("f:")) continue;
          compact[canonical] = level;
        }
        await chrome.storage.local.set({ [TRIAGE_MAP_STORAGE_KEY]: compact });
        logTriageDebug("Persisted local triage map", {
          keys: Object.keys(compact).length
        });
        schedulePersistSyncDraft();
      } catch (error) {
        logWarn("Failed to persist local triage map", error);
      }
    }, 250);
  }

  function summaryThreadKey(threadId) {
    const canonical = canonicalThreadId(threadId);
    return normalize(canonical || threadId || "");
  }

  function normalizePersistedSummaryMap(input) {
    if (!input || typeof input !== "object") return {};
    const out = {};
    const now = Date.now();
    for (const [rawThreadId, rawValue] of Object.entries(input)) {
      const threadId = summaryThreadKey(rawThreadId);
      if (!threadId) continue;
      const value = rawValue && typeof rawValue === "object" ? rawValue : {};
      const summary = normalize(value.summary || "");
      const updatedAt = Number(value.updatedAt || 0);
      if (!summary || !updatedAt) continue;
      if (now - updatedAt > SUMMARY_TTL_MS) continue;
      out[threadId] = { summary, updatedAt };
    }
    return out;
  }

  async function loadPersistedSummaries() {
    if (state.summaryLoaded || state.summaryLoadInFlight) return;
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    state.summaryLoadInFlight = true;
    try {
      const raw = await chrome.storage.local.get(SUMMARY_STORAGE_KEY);
      const map = normalizePersistedSummaryMap(raw[SUMMARY_STORAGE_KEY]);
      const summaries = {};
      const meta = {};
      for (const [threadId, value] of Object.entries(map)) {
        summaries[threadId] = value.summary;
        meta[threadId] = { updatedAt: Number(value.updatedAt || 0) };
      }
      state.summaryByThreadId = summaries;
      state.summaryMetaByThreadId = meta;
      state.summaryLoaded = true;
    } catch (error) {
      logWarn("Failed to load row summaries", error);
    } finally {
      state.summaryLoadInFlight = false;
    }
  }

  function schedulePersistSummaries() {
    if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) return;
    if (state.summaryPersistTimer) clearTimeout(state.summaryPersistTimer);
    state.summaryPersistTimer = setTimeout(async () => {
      state.summaryPersistTimer = null;
      try {
        const payload = {};
        const now = Date.now();
        const keys = Object.keys(state.summaryByThreadId || {});
        for (const threadId of keys) {
          const summary = normalize(state.summaryByThreadId[threadId] || "");
          if (!summary) continue;
          const updatedAt = Number((state.summaryMetaByThreadId[threadId] || {}).updatedAt || now);
          if (now - updatedAt > SUMMARY_TTL_MS) continue;
          payload[threadId] = { summary, updatedAt };
        }
        await chrome.storage.local.set({ [SUMMARY_STORAGE_KEY]: payload });
      } catch (error) {
        logWarn("Failed to persist row summaries", error);
      }
    }, 350);
  }

  function getSummaryForMessage(msg) {
    if (!msg) return "";
    const key = summaryThreadKey(msg.threadId);
    if (!key) return "";
    const summary = normalize(state.summaryByThreadId[key] || "");
    const updatedAt = Number((state.summaryMetaByThreadId[key] || {}).updatedAt || 0);
    if (!summary || !updatedAt) return "";
    if (Date.now() - updatedAt > SUMMARY_TTL_MS) {
      delete state.summaryByThreadId[key];
      delete state.summaryMetaByThreadId[key];
      return "";
    }
    return summary;
  }

  function summaryBackoffMsFromError(error) {
    const status = Number(error && error.status ? error.status : 0);
    if (status === 429) {
      const retryMs = Number(error && error.retryAfterMs ? error.retryAfterMs : 0);
      return retryMs > 0 ? retryMs : 60000;
    }
    const message = normalize(error && error.message ? String(error.message) : "").toLowerCase();
    if (message.includes("rate limit")) return 60000;
    if (status >= 500 && status < 600) return 25000;
    if (message.includes("missing api key") || message.includes("disabled in settings")) return 120000;
    return 20000;
  }

  function findMessageForSummary(threadId) {
    const key = summaryThreadKey(threadId);
    if (!key) return null;
    const mailbox = mailboxCacheKey(activeMailbox());
    const candidates = Array.isArray(state.scannedMailboxMessages[mailbox]) ? state.scannedMailboxMessages[mailbox] : [];
    for (const msg of candidates) {
      if (summaryThreadKey(msg.threadId) === key) return msg;
    }
    const live = collectMessages(260).items || [];
    for (const msg of live) {
      if (summaryThreadKey(msg.threadId) === key) return msg;
    }
    return null;
  }

  function queueSummariesForMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    loadPersistedSummaries()
      .catch((error) => logWarn("Row summary bootstrap failed", error))
      .finally(() => {
        const now = Date.now();
        const nextQueue = Array.isArray(state.summaryQueue) ? state.summaryQueue.slice() : [];
        for (const msg of messages) {
          const key = summaryThreadKey(msg && msg.threadId);
          if (!key) continue;
          if (getSummaryForMessage(msg)) continue;
          const status = normalize(state.summaryStatusByThreadId[key] || "idle").toLowerCase();
          if (status === "pending") continue;
          if (!nextQueue.includes(key)) nextQueue.push(key);
          if (!state.summaryStatusByThreadId[key]) state.summaryStatusByThreadId[key] = "idle";
        }
        state.summaryQueue = nextQueue;
        if (state.summaryWorkerRunning) return;
        if (now < Number(state.summaryCooldownUntil || 0)) return;
        const root = getRoot();
        runSummaryWorker(root);
      });
  }

  async function runSummaryWorker(root) {
    if (state.summaryWorkerRunning) return;
    if (!window.ReskinAI || typeof window.ReskinAI.summarizeMessages !== "function") return;
    if (Date.now() < Number(state.summaryCooldownUntil || 0)) return;

    state.summaryWorkerRunning = true;
    try {
      while (Array.isArray(state.summaryQueue) && state.summaryQueue.length > 0) {
        if (Date.now() < Number(state.summaryCooldownUntil || 0)) break;
        const ids = [];
        while (state.summaryQueue.length > 0 && ids.length < SUMMARY_BATCH_SIZE) {
          const nextId = state.summaryQueue.shift();
          const key = summaryThreadKey(nextId);
          if (!key) continue;
          if (state.summaryStatusByThreadId[key] === "pending") continue;
          if (state.summaryByThreadId[key]) continue;
          ids.push(key);
          state.summaryStatusByThreadId[key] = "pending";
        }
        if (ids.length === 0) continue;

        const batch = [];
        for (const threadId of ids) {
          const msg = findMessageForSummary(threadId);
          if (!msg) {
            state.summaryStatusByThreadId[threadId] = "failed";
            continue;
          }
          batch.push({
            threadId,
            sender: normalize(msg.sender || ""),
            subject: normalize(msg.subject || ""),
            date: normalize(msg.date || ""),
            snippet: normalize(msg.snippet || ""),
            bodyText: normalize(msg.bodyText || "")
          });
        }
        if (batch.length === 0) continue;

        try {
          const summaries = await window.ReskinAI.summarizeMessages(batch, state.settingsCache || {});
          const now = Date.now();
          const map = {};
          for (const item of Array.isArray(summaries) ? summaries : []) {
            const key = summaryThreadKey(item && item.threadId ? item.threadId : "");
            const summary = normalize(item && item.summary ? item.summary : "");
            if (!key || !summary) continue;
            map[key] = summary;
          }
          for (const input of batch) {
            const key = summaryThreadKey(input.threadId);
            if (map[key]) {
              state.summaryByThreadId[key] = map[key];
              state.summaryMetaByThreadId[key] = { updatedAt: now };
              state.summaryStatusByThreadId[key] = "done";
            } else {
              state.summaryStatusByThreadId[key] = "failed";
            }
          }
          schedulePersistSummaries();
          if (root instanceof HTMLElement && state.currentView === "list") {
            renderList(root);
          }
        } catch (error) {
          const backoffMs = summaryBackoffMsFromError(error);
          state.summaryCooldownUntil = Date.now() + backoffMs;
          for (const input of batch) {
            const key = summaryThreadKey(input.threadId);
            state.summaryStatusByThreadId[key] = "idle";
            if (!state.summaryQueue.includes(key)) state.summaryQueue.push(key);
          }
          logWarn("Row summary generation paused", error);
          break;
        }

        await sleep(650 + Math.floor(Math.random() * 250));
      }
    } finally {
      state.summaryWorkerRunning = false;
    }
  }

  function getTriageLevelForMessage(msg) {
    if (!msg || !msg.threadId) return "";
    const local = triageLocalGet(msg.threadId);
    if (local && TRIAGE_LEVELS.includes(local)) return local;

    const fromRow = window.ReskinTriage && typeof window.ReskinTriage.detectLevelFromRow === "function"
      ? window.ReskinTriage.detectLevelFromRow(msg.row)
      : "";
    if (fromRow) {
      triageLocalSet(msg.threadId, fromRow);
      return fromRow;
    }
    return "";
  }

  function threadIdInServer(threadId, server) {
    if (!server || !Array.isArray(server.threadIds)) return false;
    const canonical = canonicalThreadId(normalize(threadId || ""));
    if (!canonical) return false;
    const set = new Set(server.threadIds.map((id) => canonicalThreadId(normalize(id))));
    return set.has(canonical) || set.has(threadId) || set.has(normalize(threadId));
  }

  function getCurrentServerThreadIds() {
    if (!state.currentServerId) return null;
    const server = state.servers.find((s) => s.id === state.currentServerId);
    return server && Array.isArray(server.threadIds) ? server.threadIds : [];
  }

  function renderSidebar(root) {
    const iconHome = root.querySelector(".rv-categories .rv-icon-home");
    if (iconHome instanceof HTMLElement) {
      iconHome.classList.toggle("is-active", !(state.currentServerId || ""));
    }
    const serversList = root.querySelector(".rv-servers-list");
    if (serversList instanceof HTMLElement) {
      const items = (state.servers || []).map((server) => {
        const active = state.currentServerId === server.id;
        const initial = (server.name || "?").trim().charAt(0).toUpperCase();
        return `<button type="button" class="rv-server-item rv-server-icon${active ? " is-active" : ""}" data-server-id="${escapeHtml(server.id)}" title="${escapeHtml(server.name || "Unnamed")}" data-reskin="true">${escapeHtml(initial)} ${escapeHtml(server.name || "Unnamed")}</button>`;
      });
      serversList.innerHTML = items.join("");
    }

    const searchInput = root.querySelector(".rv-search");
    if (searchInput instanceof HTMLInputElement && searchInput.getAttribute("data-bound-search") !== "true") {
      searchInput.value = state.searchQuery || "";
      searchInput.setAttribute("data-bound-search", "true");
      searchInput.addEventListener("input", () => {
        state.searchQuery = normalize(searchInput.value || "");
        applyReskin();
      });
    } else if (searchInput instanceof HTMLInputElement) {
      if (searchInput.value !== (state.searchQuery || "")) searchInput.value = state.searchQuery || "";
    }

    const categoriesNav = root.querySelector(".rv-categories-nav");
    if (categoriesNav instanceof HTMLElement) {
      const activeHash = getActiveNavHash();
      categoriesNav.innerHTML = NAV_ITEMS.filter((item) => PRIMARY_NAV_HASHES.has(item.hash)).map((item) => {
        const isActive = item.hash === activeHash;
        return `<button type="button" class="rv-nav-item${isActive ? " is-active" : ""}" data-target-hash="${item.hash}" data-native-label="${escapeHtml(item.nativeLabel)}" data-reskin="true">${item.label}</button>`;
      }).join("");
    }

    const settings = root.querySelector(".rv-settings");
    if (settings instanceof HTMLElement) {
      settings.classList.toggle("is-active", state.currentView === "settings");
    }

    const sideTriageList = root.querySelector(".rv-side-triage-list");
    const sideTriageMeta = root.querySelector(".rv-side-triage-meta");
    if (sideTriageList instanceof HTMLElement) {
      const currentFilter = activeTriageFilter();
      const total = TRIAGE_LEVELS.reduce((sum, level) => sum + (state.triageCounts[level] || 0), 0);
      const rows = [
        `<button type="button" class="rv-triage-item rv-side-triage-item${!currentFilter ? " is-active" : ""}" data-triage-level="all" data-reskin="true"><span class="rv-triage-label" data-reskin="true">All</span><span class="rv-triage-count" data-reskin="true">${total}</span></button>`
      ];
      for (const level of TRIAGE_LEVELS) {
        const count = state.triageCounts[level] || 0;
        const active = currentFilter === level;
        rows.push(
          `<button type="button" class="rv-triage-item rv-side-triage-item${active ? " is-active" : ""}" data-triage-level="${level}" data-reskin="true"><span class="rv-triage-label" data-reskin="true">${triageLabelText(level)}</span><span class="rv-triage-count" data-reskin="true">${count}</span></button>`
        );
      }
      sideTriageList.innerHTML = rows.join("");
    }
    if (sideTriageMeta instanceof HTMLElement) {
      const inboxProgress = state.mailboxScanProgress[mailboxCacheKey("inbox")] || {};
      const sentProgress = state.mailboxScanProgress[mailboxCacheKey("sent")] || {};
      const inboxCount = Number(inboxProgress.cachedCount || (state.scannedMailboxMessages.inbox || []).length || 0);
      const sentCount = Number(sentProgress.cachedCount || (state.scannedMailboxMessages.sent || []).length || 0);
      const summaryParts = [];
      if (inboxCount > 0 || state.fullScanCompletedByMailbox.inbox) summaryParts.push(`inbox ${inboxCount}`);
      if (sentCount > 0 || state.fullScanCompletedByMailbox.sent) summaryParts.push(`sent ${sentCount}`);
      const scanSummary = summaryParts.length > 0
        ? `Scan cache: ${summaryParts.join(" • ")}`
        : "Auto-scan loads inbox + sent pages in the background.";
      sideTriageMeta.innerHTML = `
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.triageStatus || "Auto-triage runs in the background.")}</div>
        <div class="rv-triage-status" data-reskin="true">${escapeHtml(state.fullScanStatus || scanSummary)}</div>
      `;
    }
  }


    return {
      markThreadReadLocally,
      isThreadMarkedReadLocally,
      clearUnreadClassesInRow,
      markThreadsReadLocally,
      triageLocalGet,
      triageLocalSet,
      normalizePersistedTriageMap,
      loadPersistedTriageMap,
      loadSyncDraft,
      schedulePersistSyncDraft,
      schedulePersistTriageMap,
      summaryThreadKey,
      normalizePersistedSummaryMap,
      loadPersistedSummaries,
      schedulePersistSummaries,
      getSummaryForMessage,
      summaryBackoffMsFromError,
      findMessageForSummary,
      queueSummariesForMessages,
      runSummaryWorker,
      getTriageLevelForMessage,
      threadIdInServer,
      getCurrentServerThreadIds,
      renderSidebar
    };
  };
})();
