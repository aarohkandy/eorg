(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createContactTimelineStateApi = function createContactTimelineStateApi(deps = {}) {
    const {
      INTERACTION_SCAN_COOLDOWN_MS,
      state,
      normalize,
      extractEmail,
      activeConversationContext,
      activeConversationContactEmail,
      collectMessages,
      mailboxCacheKey,
      getOptimisticMessagesForThread,
      buildContactTimelineFromRows,
      canonicalThreadId,
      reconcileOptimisticMessagesWithCanonical,
      getRoot,
      getRenderThread,
      logChatDebug,
      isContactTimelineV2Enabled,
      isContactTimelineV2Active
    } = deps;

  function buildActiveContactTimelineV2(options = {}) {
    if (!isContactTimelineV2Enabled()) return null;
    const conversationContext = activeConversationContext({
      activeAccountEmail: options.activeAccountEmail || state.activeAccountEmail || state.currentUserEmail,
      contactEmail: options.contactEmail || state.activeContactEmail || activeConversationContactEmail(),
      conversationKey: options.conversationKey || state.activeConversationKey || ""
    });
    const contactEmail = extractEmail(conversationContext.contactEmail || "");
    if (!contactEmail) return null;

    const liveRows = Array.isArray(options.liveRows) ? options.liveRows : (collectMessages(500).items || []);
    const inboxCached = Array.isArray(options.inboxCached)
      ? options.inboxCached
      : (Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")]) ? state.scannedMailboxMessages[mailboxCacheKey("inbox")] : []);
    const sentCached = Array.isArray(options.sentCached)
      ? options.sentCached
      : (Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")]) ? state.scannedMailboxMessages[mailboxCacheKey("sent")] : []);
    const extraRows = Array.isArray(options.extraRows) ? options.extraRows : [];

    const trackedThreadIds = Array.isArray(state.contactThreadIds) ? state.contactThreadIds : [];
    const optimisticRows = [];
    for (const threadId of trackedThreadIds) {
      optimisticRows.push(...getOptimisticMessagesForThread(threadId));
    }
    if (Array.isArray(options.optimisticRows)) {
      optimisticRows.push(...options.optimisticRows);
    }

    return buildContactTimelineFromRows(conversationContext, {
      liveRows,
      inboxCached,
      sentCached,
      extraRows,
      optimisticRows
    });
  }

  function applyActiveContactTimelineV2(result, options = {}) {
    if (!result || !result.context) return false;
    const preferredThreadId = canonicalThreadId(options.preferredThreadId || "") || normalize(options.preferredThreadId || "");
    const threadIds = Array.isArray(result.threadIds) ? result.threadIds.slice() : [];

    // Deep-hydration guard: if the timeline was fully deep-hydrated recently, do not let a
    // shallow cache-refresh rebuild (which only sees list-row snippets) shrink it back down.
    const incomingCount = Array.isArray(result.messages) ? result.messages.length : 0;
    const existingDeepCount = Number(state.contactTimelineDeepCount || 0);
    const deepHydratedRecently = Boolean(
      state.contactTimelineIsDeep
      && state.contactTimelineDeepHydratedAt
      && Date.now() - state.contactTimelineDeepHydratedAt < 120000
    );
    if (deepHydratedRecently && incomingCount < existingDeepCount) {
      logChatDebug("contact-v2:shallow-rebuild-blocked", {
        reason: "deep-hydration-guard",
        existingDeepCount,
        incomingCount,
        deepHydratedAgoMs: Date.now() - state.contactTimelineDeepHydratedAt
      }, { throttleKey: `contact-v2-shallow-blocked:${normalize(state.activeConversationKey || "unknown")}`, throttleMs: 500 });
      return true;
    }

    state.activeContactEmail = extractEmail(result.context.contactEmail || "") || state.activeContactEmail;
    state.activeConversationKey = normalize(result.context.conversationKey || "") || state.activeConversationKey;
    state.activeContactKey = state.activeContactEmail || normalize(state.activeContactKey || "");
    state.activeAccountEmail = extractEmail(result.context.activeAccountEmail || "") || state.activeAccountEmail;
    state.activeTimelineMessages = Array.isArray(result.messages) ? result.messages.slice() : [];
    state.contactThreadIds = threadIds;
    state.mergedMessages = state.activeTimelineMessages.slice();
    state.contactTimelineV2Metrics = result.metrics || null;

    if (preferredThreadId && threadIds.includes(preferredThreadId)) {
      state.currentThreadIdForReply = preferredThreadId;
      state.activeThreadId = preferredThreadId;
    } else if (
      !state.currentThreadIdForReply
      || !threadIds.includes(canonicalThreadId(state.currentThreadIdForReply || "") || normalize(state.currentThreadIdForReply || ""))
    ) {
      const fallbackThreadId = threadIds[0] || "";
      state.currentThreadIdForReply = fallbackThreadId;
      state.activeThreadId = fallbackThreadId;
    }

    logChatDebug("contact-v2:timeline-built", {
      reason: normalize(options.reason || "build"),
      conversationKey: state.activeConversationKey || "",
      contactEmail: state.activeContactEmail || "",
      activeAccountEmail: state.activeAccountEmail || "",
      threadCount: threadIds.length,
      messageCount: state.activeTimelineMessages.length,
      metrics: state.contactTimelineV2Metrics || null
    }, { throttleKey: `contact-v2-built:${state.activeConversationKey || state.activeContactEmail || "unknown"}`, throttleMs: 320 });
    return true;
  }

  function rebuildActiveContactTimelineV2(options = {}) {
    if (!isContactTimelineV2Enabled()) return false;
    if (!isContactTimelineV2Active()) return false;
    const result = buildActiveContactTimelineV2(options);
    if (!result) return false;
    const removedOptimisticKeys = new Set();
    const trackedThreadIds = Array.from(new Set(
      (Array.isArray(result.threadIds) ? result.threadIds : [])
        .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
        .filter(Boolean)
    ));
    for (const threadId of trackedThreadIds) {
      const canonicalRows = (Array.isArray(result.messages) ? result.messages : []).filter((msg) => {
        const nextThreadId = canonicalThreadId(msg && msg.threadId || "") || normalize(msg && msg.threadId || "");
        if (nextThreadId !== threadId) return false;
        if (normalize(msg && msg.direction || "") !== "outgoing") return false;
        return normalize(msg && msg.source || msg && msg.sourceType || "") !== "optimistic";
      });
      const reconciliation = reconcileOptimisticMessagesWithCanonical(threadId, canonicalRows, options.optimisticMessage || null);
      if (!reconciliation || !reconciliation.changed) continue;
      for (const key of reconciliation.matchedKeys || []) {
        if (normalize(key)) removedOptimisticKeys.add(normalize(key));
      }
    }
    if (removedOptimisticKeys.size > 0) {
      result.messages = (Array.isArray(result.messages) ? result.messages : [])
        .filter((msg) => !removedOptimisticKeys.has(normalize(msg && msg.messageKey || "")));
      result.metrics = {
        ...(result.metrics || {}),
        reconciledOptimisticCount: removedOptimisticKeys.size
      };
    }
    const applied = applyActiveContactTimelineV2(result, options);
    if (!applied) return false;

    const root = options.root instanceof HTMLElement ? options.root : getRoot();
    const renderThread = typeof getRenderThread === "function" ? getRenderThread() : null;
    if (root instanceof HTMLElement && state.currentView === "thread" && typeof renderThread === "function") {
      renderThread(root);
    }
    return true;
  }

  function scheduleActiveContactTimelineRefreshV2(reason = "") {
    if (!isContactTimelineV2Enabled()) return;
    if (!isContactTimelineV2Active()) return;
    if (state.contactTimelineRefreshTimer) {
      clearTimeout(state.contactTimelineRefreshTimer);
    }
    const elapsedSinceInteraction = Date.now() - Number(state.lastInteractionAt || 0);
    const delayMs = elapsedSinceInteraction < INTERACTION_SCAN_COOLDOWN_MS
      ? Math.max(120, INTERACTION_SCAN_COOLDOWN_MS - elapsedSinceInteraction)
      : 0;
    state.contactTimelineRefreshTimer = setTimeout(() => {
      state.contactTimelineRefreshTimer = null;
      const refreshed = rebuildActiveContactTimelineV2({ reason: normalize(reason || "cache-refresh") });
      logChatDebug("contact-v2:cache-refresh", {
        reason: normalize(reason || "cache-refresh"),
        refreshed,
        conversationKey: normalize(state.activeConversationKey || ""),
        cacheRevision: Number(state.mailboxCacheRevision || 0)
      }, { throttleKey: `contact-v2-cache-refresh:${normalize(state.activeConversationKey || "")}`, throttleMs: 500 });
    }, delayMs);
  }


    return {
      buildActiveContactTimelineV2,
      applyActiveContactTimelineV2,
      rebuildActiveContactTimelineV2,
      scheduleActiveContactTimelineRefreshV2
    };
  };
})();
