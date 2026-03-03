(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createContactOpenApi = function createContactOpenApi(deps = {}) {
    const {
      STARTUP_PERF_MODE,
      ENABLE_DISCOVERY_ON_OPEN,
      CONTACT_OPEN_FAST_ROW_LIMIT,
      CONTACT_OPEN_DEFERRED_YIELD_EVERY,
      CONTACT_OPEN_DEFERRED_BUILD_DELAY_MS,
      CONTACT_OPEN_DEEP_HYDRATION_DELAY_MS,
      THREAD_OPEN_TRANSITION_MS,
      state,
      normalize,
      extractEmail,
      canonicalThreadId,
      canonicalRowKey,
      mailboxRowMatchesContactConversation,
      mailboxCacheKey,
      buildContactTimelineFromRows,
      buildContactTimelineFromRowsChunked,
      normalizeTimelineRowMessageV2,
      activeConversationContext,
      conversationKeyFromContact,
      detectCurrentUserEmail,
      applyActiveContactTimelineV2,
      lookupThreadHintHref,
      senderDisplayName,
      sanitizeListHash,
      rememberThreadNavigationHint,
      markThreadsReadLocally,
      scheduleMailboxScanKick,
      logChatDebug,
      threadHashForMailbox,
      getRenderCurrentView,
      getRenderThread,
      perfTraceHasStage,
      markPerfStage,
      getRoot,
      discoverThreadIds,
      canonicalThreadIdForCompare,
      fetchAndRenderThreads,
      logEvent,
      logWarn,
      loadContactChat,
      collectMessages,
      bumpInteractionEpoch,
      beginPerfTrace,
      contactKeyFromMessage,
      isContactTimelineV2Enabled,
      scheduleHeavyWorkAfterIdle
    } = deps;

  function buildContactTimelineFastSeed(context, message, seedRows = [], options = {}) {
    const maxRows = Math.max(1, Number(options.maxRows || CONTACT_OPEN_FAST_ROW_LIMIT));
    const clickedMessage = message && typeof message === "object" ? message : null;
    const collected = [];
    const seen = new Set();
    const pushRow = (row) => {
      if (!row || typeof row !== "object") return;
      const key = canonicalRowKey(row);
      if (!key || seen.has(key)) return;
      seen.add(key);
      collected.push(row);
    };
    if (clickedMessage) pushRow(clickedMessage);
    for (const row of Array.isArray(seedRows) ? seedRows : []) {
      if (mailboxRowMatchesContactConversation(row, context)) pushRow(row);
      if (collected.length >= maxRows) break;
    }
    const inboxCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
      ? state.scannedMailboxMessages[mailboxCacheKey("inbox")]
      : [];
    const sentCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
      ? state.scannedMailboxMessages[mailboxCacheKey("sent")]
      : [];
    if (collected.length < maxRows) {
      for (const row of [...inboxCached, ...sentCached]) {
        if (!mailboxRowMatchesContactConversation(row, context)) continue;
        pushRow(row);
        if (collected.length >= maxRows) break;
      }
    }
    const result = buildContactTimelineFromRows(context, {
      liveRows: [],
      inboxCached: [],
      sentCached: [],
      extraRows: collected.slice(0, maxRows),
      optimisticRows: []
    });
    if (result && result.metrics) {
      result.metrics.fastSeed = true;
      result.metrics.fastSeedCount = collected.length;
    }
    return result;
  }

  function kickContactDiscovery(contactEmail, root, reason = "") {
    const normalizedEmail = extractEmail(contactEmail || "");
    if (!normalizedEmail) return;
    if (!state.inboxSdkReady || !state.inboxSdkInstance) {
      if (!state.inboxSdkReady) state._pendingDiscovery = { contactEmail: normalizedEmail };
      return;
    }
    const run = () => {
      state.contactDiscoveryInFlight = true;
      state.discoveryController?.abort();
      state.discoveryController = new AbortController();
      discoverThreadIds(normalizedEmail, state.discoveryController.signal).then((newIds) => {
        const alreadyDisplayed = new Set((state.contactThreadIds || []).map(canonicalThreadIdForCompare));
        const freshIds = newIds.filter((id) => !alreadyDisplayed.has(canonicalThreadIdForCompare(id)));
        if (freshIds.length > 0) {
          fetchAndRenderThreads(freshIds.slice(0, 10), getRoot() || root);
        }
        logEvent("open:discovery", {
          reason: normalize(reason || "open"),
          freshCount: freshIds.length
        });
      }).catch((err) => {
        logWarn(`discoverThreadIds (${normalize(reason || "open")}) failed`, err);
      }).finally(() => {
        state.contactDiscoveryInFlight = false;
      });
    };
    const scheduleHeavy = typeof scheduleHeavyWorkAfterIdle === "function" ? scheduleHeavyWorkAfterIdle : null;
    if (scheduleHeavy) {
      scheduleHeavy(run, {
        minIdleMs: 800,
        hardTimeoutMs: 4500,
        reason: `discover:${normalize(reason || "open")}`
      });
      return;
    }
    state.discoveryController?.abort();
    state.discoveryController = new AbortController();
    state.contactDiscoveryInFlight = true;
    discoverThreadIds(normalizedEmail, state.discoveryController.signal).then((newIds) => {
      const alreadyDisplayed = new Set((state.contactThreadIds || []).map(canonicalThreadIdForCompare));
      const freshIds = newIds.filter((id) => !alreadyDisplayed.has(canonicalThreadIdForCompare(id)));
      if (freshIds.length > 0) {
        fetchAndRenderThreads(freshIds.slice(0, 10), getRoot() || root);
      }
      logEvent("open:discovery", {
        reason: normalize(reason || "open"),
        freshCount: freshIds.length
      });
    }).catch((err) => {
      logWarn(`discoverThreadIds (${normalize(reason || "open")}) failed`, err);
    }).finally(() => {
      state.contactDiscoveryInFlight = false;
    });
  }

  function queuePendingContactDiscovery(contactEmail, conversationKey = "") {
    const email = extractEmail(contactEmail || "");
    if (!email) return;
    const key = normalize(conversationKey || conversationKeyFromContact(email) || "");
    if (!key) return;
    const next = state.pendingDiscoveryByConversation && typeof state.pendingDiscoveryByConversation === "object"
      ? state.pendingDiscoveryByConversation
      : {};
    next[key] = {
      email,
      queuedAt: Date.now()
    };
    state.pendingDiscoveryByConversation = next;
  }

  function triggerPendingContactDiscovery(root, options = {}) {
    const context = activeConversationContext(options.context || {});
    const conversationKey = normalize(context.conversationKey || state.activeConversationKey || "");
    const pending = state.pendingDiscoveryByConversation && conversationKey
      ? state.pendingDiscoveryByConversation[conversationKey]
      : null;
    const email = extractEmail((pending && pending.email) || context.contactEmail || state.activeContactEmail || "");
    if (!email) return false;
    if (pending && conversationKey && state.pendingDiscoveryByConversation) {
      delete state.pendingDiscoveryByConversation[conversationKey];
    }
    kickContactDiscovery(email, root, normalize(options.reason || "manual"));
    return true;
  }

  function markOpenPaintStages(root, interactionEpoch, perfTraceId = "") {
    if (!(root instanceof HTMLElement) || !perfTraceId) return;
    requestAnimationFrame(() => {
      if (Number(state.interactionEpoch || 0) !== Number(interactionEpoch || 0)) return;
      if (!perfTraceHasStage(perfTraceId, "open:fast-shell-painted")) {
        markPerfStage(perfTraceId, "open:fast-shell-painted", {
          epoch: Number(interactionEpoch || 0)
        });
      }
      const start = Date.now();
      const poll = () => {
        if (Number(state.interactionEpoch || 0) !== Number(interactionEpoch || 0)) return;
        if (perfTraceHasStage(perfTraceId, "open:first-message-painted")) return;
        const latestRoot = getRoot() || root;
        const firstMessageNode = latestRoot && latestRoot.querySelector(".rv-thread-msg .rv-thread-msg-body");
        if (firstMessageNode) {
          markPerfStage(perfTraceId, "open:first-message-painted", {
            epoch: Number(interactionEpoch || 0)
          });
          return;
        }
        if (Date.now() - start > 2200) return;
        setTimeout(poll, 32);
      };
      poll();
    });
  }

  function scheduleContactTimelineDeferredBuild(options = {}) {
    const root = options.root instanceof HTMLElement ? options.root : getRoot();
    if (!(root instanceof HTMLElement)) return;
    const message = options.message && typeof options.message === "object" ? options.message : null;
    if (!message) return;
    const context = activeConversationContext(options.context || {});
    const conversationKey = normalize(context.conversationKey || options.conversationKey || "");
    const interactionEpoch = Number(options.interactionEpoch || state.interactionEpoch || 0);
    const seedRows = Array.isArray(options.seedRows) ? options.seedRows.slice() : [];
    const preferredThreadId = canonicalThreadId(options.preferredThreadId || "") || normalize(options.preferredThreadId || "");
    const perfTraceId = normalize(options.perfTraceId || "");
    const isStale = () => {
      if (Number(state.interactionEpoch || 0) !== interactionEpoch) return true;
      if (state.currentView !== "thread") return true;
      if (conversationKey && normalize(state.activeConversationKey || "") !== conversationKey) return true;
      return false;
    };
    const run = async () => {
      if (isStale()) return;
      if (perfTraceId) {
        markPerfStage(perfTraceId, "open:deferred-build-start", {
          epoch: interactionEpoch,
          conversationKey
        });
      }
      logEvent("open:deferred-build-start", {
        epoch: interactionEpoch,
        conversationKey
      });
      const liveRows = collectMessages(260).items || [];
      const inboxCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
        ? state.scannedMailboxMessages[mailboxCacheKey("inbox")]
        : [];
      const sentCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
        ? state.scannedMailboxMessages[mailboxCacheKey("sent")]
        : [];
      const result = await buildContactTimelineFromRowsChunked(context, {
        liveRows,
        inboxCached,
        sentCached,
        extraRows: [message, ...seedRows]
      }, {
        yieldEvery: CONTACT_OPEN_DEFERRED_YIELD_EVERY,
        isStale,
        onChunk: (chunk) => {
          if (isStale()) return;
          logEvent("open:deferred-build-chunk", {
            stage: normalize(chunk && chunk.stage || ""),
            processedCount: Number(chunk && chunk.processedCount || 0),
            poolCount: Number(chunk && chunk.poolCount || 0)
          });
        }
      });
      if (!result || isStale()) return;
      if (!Array.isArray(result.messages) || result.messages.length === 0) {
        const fallback = normalizeTimelineRowMessageV2(message, context, "row_live", 0);
        if (fallback) {
          result.messages = [fallback];
          result.threadIds = [canonicalThreadId(fallback.threadId || "") || normalize(fallback.threadId || "")].filter(Boolean);
          result.metrics = {
            ...(result.metrics || {}),
            finalCount: 1,
            threadCount: result.threadIds.length,
            fallbackIncludedClickedRow: true
          };
        }
      }
      applyActiveContactTimelineV2(result, {
        reason: "open-deferred",
        preferredThreadId
      });
      if (isStale()) return;
      const renderThread = typeof getRenderThread === "function" ? getRenderThread() : null;
      const latestRoot = getRoot() || root;
      if (latestRoot instanceof HTMLElement && state.currentView === "thread" && typeof renderThread === "function") {
        renderThread(latestRoot);
      }
      if (perfTraceId) {
        markPerfStage(perfTraceId, "open:deferred-build-done", {
          epoch: interactionEpoch,
          messageCount: Array.isArray(result.messages) ? result.messages.length : 0,
          threadCount: Array.isArray(result.threadIds) ? result.threadIds.length : 0
        });
      }
      if (state.contactHydrationFallbackTimer) {
        clearTimeout(state.contactHydrationFallbackTimer);
      }
      state.contactHydrationFallbackTimer = setTimeout(() => {
        state.contactHydrationFallbackTimer = null;
        if (isStale()) return;
        if (state.contactChatLoading || state.replySendInProgress) return;
        const timeline = Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : [];
        const hasOutgoing = timeline.some((msg) => normalize(msg && msg.direction || "") === "outgoing");
        const shouldHydrate = Boolean(
          Array.isArray(state.contactThreadIds)
          && state.contactThreadIds.length > 0
          && timeline.length > 0
          && !hasOutgoing
        );
        if (!shouldHydrate) return;
        const hydrationGroup = {
          contactEmail: extractEmail(context.contactEmail || state.activeContactEmail || ""),
          contactKey: extractEmail(context.contactEmail || state.activeContactEmail || ""),
          conversationKey: normalize(context.conversationKey || state.activeConversationKey || ""),
          contactName: state.contactDisplayName || senderDisplayName(message.sender || ""),
          threadIds: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.slice() : [],
          items: [message, ...seedRows].filter((row) => row && typeof row === "object"),
          latestItem: message
        };
        const nextRoot = getRoot() || root;
        if (!(nextRoot instanceof HTMLElement)) return;
        loadContactChat(hydrationGroup, nextRoot, {
          forceDeepHydration: true,
          reason: "contact-v2-hydrate-fallback"
        });
      }, CONTACT_OPEN_DEEP_HYDRATION_DELAY_MS);
      logEvent("open:deferred-build-done", {
        epoch: interactionEpoch,
        conversationKey,
        messageCount: Array.isArray(result.messages) ? result.messages.length : 0
      });
    };
    requestAnimationFrame(() => {
      setTimeout(() => {
        run().catch((error) => {
          logWarn("deferred contact timeline build failed", error);
        });
      }, CONTACT_OPEN_DEFERRED_BUILD_DELAY_MS);
    });
  }

  function openContactTimelineFromRowV2(message, root, route = {}, options = {}) {
    if (!isContactTimelineV2Enabled()) return false;
    if (!(root instanceof HTMLElement)) return false;
    const msg = message && typeof message === "object" ? message : null;
    if (!msg) return false;
    const guardKey = `${contactKeyFromMessage(msg) || msg.threadId || ""}`.toLowerCase();
    const now = Date.now();
    if (
      normalize(state.currentView || "") === "thread"
      && normalize(state._lastContactOpenGuardKey || "") === guardKey
      && now - Number(state._lastContactOpenGuardAt || 0) < 420
    ) {
      return true;
    }
    state._lastContactOpenGuardKey = guardKey;
    state._lastContactOpenGuardAt = now;
    const interactionEpoch = bumpInteractionEpoch("open-contact-v2");
    const perfTraceId = normalize(options.perfTraceId || state.activeOpenPerfTraceId || "") || beginPerfTrace({
      type: "contact-open",
      reason: "open-contact-v2"
    });
    state.activeOpenPerfTraceId = perfTraceId;
    if (!perfTraceHasStage(perfTraceId, "click:start")) {
      markPerfStage(perfTraceId, "click:start", { epoch: interactionEpoch });
    }

    const contactKey = normalize(contactKeyFromMessage(msg) || "");
    const contactEmail = extractEmail(contactKey || msg.senderEmail || msg.sender || "");
    if (!contactEmail) return false;

    const activeAccountEmail = state.activeAccountEmail || state.currentUserEmail || detectCurrentUserEmail() || "";
    state.activeAccountEmail = extractEmail(activeAccountEmail || "") || state.activeAccountEmail;
    state.activeContactEmail = contactEmail || state.activeContactEmail;
    const conversationKey = conversationKeyFromContact(contactEmail);
    const context = activeConversationContext({
      activeAccountEmail,
      contactEmail,
      conversationKey
    });
    const mailbox = mailboxCacheKey(route.mailbox || msg.mailbox || "inbox");
    const seedRows = Array.isArray(options.seedRows)
      ? options.seedRows
      : (Array.isArray(msg.seedRows) ? msg.seedRows : []);

    const result = buildContactTimelineFastSeed(context, msg, seedRows, {
      maxRows: CONTACT_OPEN_FAST_ROW_LIMIT
    });
    if (!result || !Array.isArray(result.messages)) return false;
    if (result.messages.length === 0) {
      const fallback = normalizeTimelineRowMessageV2(msg, context, "row_live", 0);
      if (fallback) {
        result.messages = [fallback];
        result.threadIds = [canonicalThreadId(fallback.threadId || "") || normalize(fallback.threadId || "")].filter(Boolean);
        result.metrics = {
          ...(result.metrics || {}),
          finalCount: 1,
          threadCount: result.threadIds.length,
          fallbackIncludedClickedRow: true
        };
      }
    }

    const clickedThreadId = canonicalThreadId(msg.threadId || "") || normalize(msg.threadId || "");
    const latestThreadId = Array.isArray(result.threadIds) && result.threadIds[0]
      ? (canonicalThreadId(result.threadIds[0]) || normalize(result.threadIds[0]))
      : "";
    const preferredThreadId = latestThreadId || clickedThreadId;
    const preferredMessage = (Array.isArray(result.messages) ? result.messages : []).find((entry) => (
      (canonicalThreadId(entry && entry.threadId || "") || normalize(entry && entry.threadId || "")) === preferredThreadId
    ));
    const preferredHint = lookupThreadHintHref(preferredThreadId) || normalize(msg.href || "") || lookupThreadHintHref(clickedThreadId);
    const preferredMailbox = mailboxCacheKey(
      (preferredMessage && preferredMessage.mailbox)
      || msg.mailbox
      || mailbox
      || "inbox"
    );

    state.suspendHashSyncDuringContactHydration = false;
    state.contactChatLoading = false;
    state.contactHydrationRunId = Number(state.contactHydrationRunId || 0) + 1;
    state.currentView = "thread";
    state.contactDisplayName = senderDisplayName(msg.sender || "") || contactEmail;
    state.currentThreadMailbox = preferredMailbox;
    state.currentThreadHintHref = preferredHint;
    state.lastListHash = sanitizeListHash(window.location.hash || state.lastListHash || "#inbox");
    applyActiveContactTimelineV2(result, {
      reason: "open",
      preferredThreadId
    });
    if (preferredThreadId) {
      state.currentThreadIdForReply = preferredThreadId;
      state.activeThreadId = preferredThreadId;
      rememberThreadNavigationHint(preferredThreadId, preferredHint, msg.row);
    }
    markThreadsReadLocally(
      result.threadIds || [],
      [msg.row].filter((row) => row instanceof HTMLElement)
    );

    logChatDebug("contact-v2:open", {
      contactEmail,
      conversationKey: normalize(context.conversationKey || ""),
      activeAccountEmail: extractEmail(context.activeAccountEmail || ""),
      clickedThreadId,
      clickedMailbox: preferredMailbox,
      preferredThreadId
    }, { throttleKey: `contact-v2-open:${normalize(context.conversationKey || contactEmail)}`, throttleMs: 240 });
    logChatDebug("contact-v2:scope", {
      routeMailbox: mailbox,
      fastSeedCount: Number(result && result.metrics && result.metrics.fastSeedCount || 0),
      threadCount: Array.isArray(result.threadIds) ? result.threadIds.length : 0,
      messageCount: Array.isArray(result.messages) ? result.messages.length : 0
    }, { throttleKey: `contact-v2-scope:${normalize(context.conversationKey || contactEmail)}`, throttleMs: 240 });
    queuePendingContactDiscovery(contactEmail, conversationKey);

    // Keep contact-open in local thread mode to avoid expensive Gmail route transitions.
    // Thread context is resolved only when explicitly needed (reply/hydration).
    state.threadOpenTransitionUntil = Date.now() + THREAD_OPEN_TRANSITION_MS;
    const renderCurrentView = typeof getRenderCurrentView === "function" ? getRenderCurrentView() : null;
    if (typeof renderCurrentView === "function") {
      renderCurrentView(root);
    }
    markOpenPaintStages(root, interactionEpoch, perfTraceId);

    if (ENABLE_DISCOVERY_ON_OPEN && STARTUP_PERF_MODE !== "instant") {
      kickContactDiscovery(contactEmail, root, "open-contact-v2");
    }
    scheduleContactTimelineDeferredBuild({
      root,
      message: msg,
      context,
      conversationKey,
      seedRows,
      preferredThreadId,
      interactionEpoch,
      perfTraceId
    });

    return true;
  }


    return {
      buildContactTimelineFastSeed,
      kickContactDiscovery,
      queuePendingContactDiscovery,
      triggerPendingContactDiscovery,
      markOpenPaintStages,
      scheduleContactTimelineDeferredBuild,
      openContactTimelineFromRowV2
    };
  };
})();
