(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createSendRefreshApi = function createSendRefreshApi(deps = {}) {
    const {
      ENABLE_CONTACT_MERGE_MODE,
      state,
      normalize,
      canonicalThreadId,
      isContactTimelineV2Enabled,
      isContactTimelineV2Active,
      rebuildActiveContactTimelineV2,
      sleep,
      extractOpenThreadData,
      normalizeThreadMessagesForChat,
      activeConversationContext,
      reconcileOptimisticMessagesWithCanonical,
      updateOptimisticInMergedMessages,
      mergeContactMessagesByThread,
      getRoot,
      getRenderThread
    } = deps;

    const renderThread = (...args) => {
      const fn = typeof getRenderThread === "function" ? getRenderThread() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };

    function groupedMessagesByThreadId(messages = []) {
      const byThread = new Map();
      for (const message of messages) {
        if (!message || typeof message !== "object") continue;
        const threadId = canonicalThreadId(message.threadId || "") || normalize(message.threadId || "");
        if (!threadId) continue;
        if (!byThread.has(threadId)) byThread.set(threadId, []);
        byThread.get(threadId).push({ ...message, threadId });
      }
      return byThread;
    }

    async function refreshActiveThreadAfterSend(threadId, mailbox, optimisticMessage) {
      const targetThreadId = normalize(threadId || "");
      if (!targetThreadId) return false;
      if (isContactTimelineV2Enabled() && isContactTimelineV2Active()) {
        const refreshed = rebuildActiveContactTimelineV2({
          reason: "send-refresh",
          preferredThreadId: targetThreadId,
          optimisticMessage
        });
        return Boolean(refreshed);
      }
      const targetCanonicalThreadId = canonicalThreadId(targetThreadId) || targetThreadId;
      const attempts = [60, 150, 280, 450, 700];
      let matched = false;

      for (let i = 0; i < attempts.length; i += 1) {
        await sleep(attempts[i]);
        const extracted = extractOpenThreadData();
        const normalizedExtracted = normalizeThreadMessagesForChat(
          Array.isArray(extracted.messages) ? extracted.messages : [],
          targetThreadId,
          activeConversationContext()
        );
        const reconciliation = reconcileOptimisticMessagesWithCanonical(
          targetThreadId,
          normalizedExtracted,
          optimisticMessage
        );
        if (reconciliation.changed) {
          matched = true;
          for (const key of reconciliation.matchedKeys) {
            updateOptimisticInMergedMessages(targetThreadId, key, null);
          }
        }

        if (
          ENABLE_CONTACT_MERGE_MODE
          && Array.isArray(state.contactThreadIds)
          && state.contactThreadIds.some((id) => (canonicalThreadId(id || "") || normalize(id || "")) === targetCanonicalThreadId)
        ) {
          const displayThreadIds = state.contactThreadIds
            .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
            .filter(Boolean)
            .reverse();
          const byThread = groupedMessagesByThreadId(state.mergedMessages);
          if (normalizedExtracted.length > 0) {
            byThread.set(
              targetCanonicalThreadId,
              normalizedExtracted.map((msg) => ({ ...msg, threadId: targetCanonicalThreadId }))
            );
            state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, byThread, activeConversationContext());
          }
        }

        const latestRoot = getRoot();
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          renderThread(latestRoot);
        }
        if (matched) return true;
      }

      const latestRoot = getRoot();
      if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
        renderThread(latestRoot);
      }
      return false;
    }

    return {
      groupedMessagesByThreadId,
      refreshActiveThreadAfterSend
    };
  };
})();
