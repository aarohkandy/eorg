(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createThreadReplyApi = function createThreadReplyApi(deps = {}) {
    const {
      ENABLE_CONTACT_MERGE_MODE,
      ENABLE_CONTACT_MERGE_LEGACY,
      state,
      normalize,
      canonicalThreadId,
      threadIdFromHash,
      getReplyDraft,
      setReplyDraft,
      parseListRoute,
      activeConversationContext,
      lookupThreadHintHref,
      bumpInteractionEpoch,
      setActiveTask,
      detectCurrentUserEmail,
      appendOptimisticOutgoingMessage,
      ensureContactThreadTracked,
      isContactTimelineV2Enabled,
      isContactTimelineV2Active,
      rebuildActiveContactTimelineV2,
      groupedMessagesByThreadId,
      mergeContactMessagesByThread,
      getRoot,
      getRenderThread,
      ensureThreadContextForReply,
      refreshActiveThreadAfterSend,
      markOptimisticMessageDelivered,
      updateOptimisticInMergedMessages,
      appendLocalSentCacheEntry,
      markOptimisticMessageFailed,
      logEvent,
      diagStart,
      diagEnd,
      diagFail,
      logChatDebug,
      logWarn
    } = deps;
    const resolveRenderThread = () => (
      typeof getRenderThread === "function" ? getRenderThread() : null
    );
  function normalizeReplyResult(result) {
    if (typeof result === "boolean") {
      return { ok: result, stage: result ? "legacy-ok" : "legacy-failed", reason: "" };
    }
    if (!result || typeof result !== "object") {
      return { ok: false, stage: "invalid-result", reason: "non-object-result" };
    }
    const stage = normalize(result.stage || "") || "unknown";
    const reason = normalize(result.reason || "");
    return {
      ok: Boolean(result.ok),
      stage,
      reason
    };
  }

  function isLikelyHashThreadId(threadId) {
    const id = normalize(threadId || "");
    if (!id) return false;
    if (id.startsWith("f:") || id.startsWith("thread-f:") || id.startsWith("synthetic-")) return false;
    if (id.includes(":")) return false;
    return /^[A-Za-z0-9_-]{8,}$/.test(id);
  }

  async function submitThreadReply(root) {
    if (state.replySendInProgress) {
      logChatDebug("reply:submit-skip", {
        reason: "already-in-progress",
        hash: normalize(window.location.hash || "")
      }, { throttleKey: "reply-submit-skip:in-progress", throttleMs: 900 });
      return;
    }
    const inputNodes = Array.from(root.querySelectorAll(".rv-thread-input"))
      .filter((node) => node instanceof HTMLInputElement);
    const input = inputNodes.find((node) => node === document.activeElement)
      || inputNodes.find((node) => Boolean(normalize(node.value || "")))
      || inputNodes[0]
      || null;
    if (!(input instanceof HTMLInputElement)) {
      logChatDebug("reply:submit-skip", {
        reason: "input-not-found"
      }, { throttleKey: "reply-submit-skip:input-not-found", throttleMs: 1200 });
      return;
    }
    const draftProbeThreadId = canonicalThreadId(
      state.currentThreadIdForReply
      || threadIdFromHash(window.location.hash || "")
      || state.activeThreadId
      || (Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0 ? state.contactThreadIds[0] : "")
      || ""
    ) || normalize(
      state.currentThreadIdForReply
      || threadIdFromHash(window.location.hash || "")
      || state.activeThreadId
      || (Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0 ? state.contactThreadIds[0] : "")
      || ""
    );
    const draftFallbackText = draftProbeThreadId ? normalize(getReplyDraft(draftProbeThreadId) || "") : "";
    let text = normalize(input.value || "");
    if (!text && draftFallbackText) {
      text = draftFallbackText;
      input.value = draftFallbackText;
    }
    if (!text) {
      logChatDebug("reply:submit-skip", {
        reason: "empty-text"
      }, { throttleKey: "reply-submit-skip:empty-text", throttleMs: 700 });
      return;
    }
    if (!window.ReskinCompose || typeof window.ReskinCompose.replyToThread !== "function") {
      logWarn("ReskinCompose.replyToThread not available");
      logChatDebug("reply:submit-skip", {
        reason: "compose-bridge-missing"
      }, { throttleKey: "reply-submit-skip:compose-missing", throttleMs: 1200 });
      return;
    }

    const route = parseListRoute(state.lastListHash || window.location.hash || "#inbox");
    const mailbox = normalize(state.currentThreadMailbox || route.mailbox || "inbox") || "inbox";
    const fallbackContactThreadId = Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0
      ? (canonicalThreadId(state.contactThreadIds[0] || "") || normalize(state.contactThreadIds[0] || ""))
      : "";
    const hashThreadId = normalize(threadIdFromHash(window.location.hash || ""));
    const threadId = normalize(
      state.currentThreadIdForReply ||
      hashThreadId ||
      state.activeThreadId ||
      fallbackContactThreadId
    );
    const targetThreadId = canonicalThreadId(hashThreadId || threadId || state.activeThreadId || fallbackContactThreadId || "")
      || normalize(hashThreadId || threadId || state.activeThreadId || fallbackContactThreadId || "");
    if (!targetThreadId) {
      logChatDebug("reply:submit-skip", {
        reason: "thread-id-missing",
        mailbox,
        hashThreadId,
        fallbackContactThreadId
      }, { throttleKey: "reply-submit-skip:thread-missing", throttleMs: 900 });
      return;
    }
    const conversationContext = activeConversationContext();
    const replyDraftThreadId = canonicalThreadId(targetThreadId || state.currentThreadIdForReply || state.activeThreadId || "")
      || normalize(targetThreadId || state.currentThreadIdForReply || state.activeThreadId || "");
    const threadHintHref = normalize(state.currentThreadHintHref || "") || lookupThreadHintHref(targetThreadId);
    const previousSuspendHydration = state.suspendHashSyncDuringContactHydration;
    const sendBtn = root.querySelector(".rv-thread-send");
    let failureStage = "";
    let successStageLabel = "";
    const replyDiagRunId = typeof diagStart === "function"
      ? diagStart("reply", {
        tid: targetThreadId,
        mb: mailbox,
        tl: text.length
      })
      : "";
    let replyDiagTerminalStatus = "complete";
    let replyDiagTerminalPayload = {};
    const emitReplyDiag = (code, payload = {}, options = {}) => {
      if (typeof logEvent !== "function") return;
      const mergedPayload = {
        ...(payload && typeof payload === "object" ? payload : {}),
        runId: replyDiagRunId || undefined,
        tid: targetThreadId,
        mb: mailbox
      };
      logEvent(code, mergedPayload, {
        tier: "always",
        ...(options && typeof options === "object" ? options : {})
      });
    };
    const priorInputValue = input.value || "";
    const inputWasFocused = document.activeElement === input;
    const timing = {
      startedAt: Date.now(),
      contextDurationMs: 0,
      sendDurationMs: 0,
      optimisticVisibleAtMs: 0
    };
    let optimisticMessage = null;

    bumpInteractionEpoch("send-start");
    state.replySendInProgress = true;
    state.suspendHashSyncDuringContactHydration = true;
    setActiveTask("send-reply");
    emitReplyDiag("RP100", {
      tl: text.length
    });
    if (sendBtn instanceof HTMLElement) {
      sendBtn.textContent = "Sending...";
      sendBtn.setAttribute("disabled", "true");
    }

    try {
      detectCurrentUserEmail(true);
      logChatDebug("reply:submit-start", {
        threadId: targetThreadId,
        mailbox,
        textLength: text.length,
        conversationKey: conversationContext.conversationKey || "",
        contactEmail: conversationContext.contactEmail || "",
        activeAccountEmail: conversationContext.activeAccountEmail || ""
      }, { throttleKey: `reply-submit-start:${targetThreadId}`, throttleMs: 200 });
      optimisticMessage = appendOptimisticOutgoingMessage(text, targetThreadId);
      if (optimisticMessage) {
        timing.optimisticVisibleAtMs = Date.now();
        input.value = "";
        setReplyDraft(replyDraftThreadId, "");
        if (ENABLE_CONTACT_MERGE_MODE) {
          ensureContactThreadTracked(targetThreadId);
        }
        if (isContactTimelineV2Enabled() && isContactTimelineV2Active()) {
          rebuildActiveContactTimelineV2({
            reason: "send-optimistic",
            preferredThreadId: targetThreadId
          });
        } else if (ENABLE_CONTACT_MERGE_LEGACY && Array.isArray(state.contactThreadIds) && state.contactThreadIds.length > 0) {
          const displayThreadIds = state.contactThreadIds
            .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
            .filter(Boolean)
            .reverse();
          const byThread = groupedMessagesByThreadId(state.mergedMessages);
          const existing = Array.isArray(byThread.get(targetThreadId)) ? byThread.get(targetThreadId).slice() : [];
          existing.push(optimisticMessage);
          byThread.set(targetThreadId, existing);
          state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, byThread, activeConversationContext());
        }
        const latestRoot = getRoot();
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          const renderThread = resolveRenderThread();
          if (typeof renderThread === "function") {
            renderThread(latestRoot);
          }
        }
      }

      let preflightContext = { ok: false, reason: "", contextStep: "", tried: [] };
      const contextStartedAt = Date.now();
      const context = await ensureThreadContextForReply(targetThreadId, mailbox, threadHintHref);
      timing.contextDurationMs = Date.now() - contextStartedAt;
      preflightContext = context && typeof context === "object" ? context : preflightContext;
      const delegateContextToCompose = !Boolean(preflightContext.ok);
      if (!context.ok) {
        logWarn(
          `Reply preflight context missing; delegating to compose context recovery. reason=${context.reason || "thread-context-not-found"} threadId=${targetThreadId || ""} mailbox=${mailbox || ""}`
        );
        logChatDebug("reply:preflight-context-miss", {
          threadId: targetThreadId,
          mailbox,
          reason: context.reason || "thread-context-not-found",
          contextStep: context.contextStep || "",
          tried: Array.isArray(context.tried) ? context.tried.slice(0, 8) : [],
          timing
        }, { throttleKey: `reply-preflight-miss:${targetThreadId}`, throttleMs: 250 });
      }

      const sendStartedAt = Date.now();
      const rawResult = await window.ReskinCompose.replyToThread(text, {
        threadId: targetThreadId,
        mailbox,
        forceThreadContext: delegateContextToCompose,
        threadHintHref,
        timeoutMs: 12000,
        conversationKey: conversationContext.conversationKey || "",
        contactEmail: conversationContext.contactEmail || "",
        activeAccountEmail: conversationContext.activeAccountEmail || ""
      });
      timing.sendDurationMs = Date.now() - sendStartedAt;
      const result = normalizeReplyResult(rawResult);
      logChatDebug("reply:submit-result", {
        threadId: targetThreadId,
        mailbox,
        result,
        forceThreadContext: delegateContextToCompose,
        preflightOk: Boolean(preflightContext.ok),
        timing
      }, { throttleKey: `reply-submit-result:${targetThreadId}`, throttleMs: 180 });
      if (result.ok) {
        const likelyStage = /^sendLikely/i.test(normalize(result.stage || ""));
        successStageLabel = likelyStage ? "Sent (syncing)" : "Sent";
        replyDiagTerminalStatus = "complete";
        replyDiagTerminalPayload = {
          st: normalize(result.stage || ""),
          rs: normalize(result.reason || ""),
          ok: 1
        };
        emitReplyDiag("RP180", {
          st: normalize(result.stage || ""),
          rs: normalize(result.reason || ""),
          ok: 1,
          ms: timing.sendDurationMs
        });
        setReplyDraft(replyDraftThreadId, "");
        if (optimisticMessage) {
          markOptimisticMessageDelivered(targetThreadId, optimisticMessage.messageKey);
          if (isContactTimelineV2Enabled() && isContactTimelineV2Active()) {
            rebuildActiveContactTimelineV2({
              reason: "send-mark-sent",
              preferredThreadId: targetThreadId,
              optimisticMessage
            });
          } else {
            updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
              deliveryState: "sent",
              optimisticStatus: "sent",
              optimisticDeliveredAt: Date.now(),
              optimisticUnverifiedAt: likelyStage ? Date.now() : 0
            });
          }
        }
        appendLocalSentCacheEntry(
          targetThreadId,
          text,
          conversationContext,
          Date.now(),
          threadHintHref
        );
        if (isContactTimelineV2Enabled() && isContactTimelineV2Active()) {
          rebuildActiveContactTimelineV2({
            reason: "send-local-sent-cache",
            preferredThreadId: targetThreadId,
            optimisticMessage
          });
        }
        const latestRoot = getRoot();
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          const renderThread = resolveRenderThread();
          if (typeof renderThread === "function") {
            renderThread(latestRoot);
          }
        }
        refreshActiveThreadAfterSend(targetThreadId, mailbox, optimisticMessage).catch((error) => {
          logWarn("Post-send thread refresh failed", error);
        });
      } else {
        failureStage = result.stage || "failed";
        replyDiagTerminalStatus = "failed";
        replyDiagTerminalPayload = {
          st: normalize(result.stage || "failed"),
          rs: normalize(result.reason || ""),
          rc: 9
        };
        emitReplyDiag("RP199", {
          st: normalize(result.stage || "failed"),
          rs: normalize(result.reason || ""),
          rc: 9,
          ms: timing.sendDurationMs
        });
        setReplyDraft(replyDraftThreadId, priorInputValue || text);
        if (optimisticMessage) {
          markOptimisticMessageFailed(targetThreadId, optimisticMessage.messageKey);
          if (isContactTimelineV2Enabled() && isContactTimelineV2Active()) {
            rebuildActiveContactTimelineV2({
              reason: "send-mark-failed",
              preferredThreadId: targetThreadId
            });
          } else {
            updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
              deliveryState: "failed",
              optimisticStatus: "failed",
              optimisticFailedAt: Date.now()
            });
          }
          const latestRoot = getRoot();
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
            const renderThread = resolveRenderThread();
            if (typeof renderThread === "function") {
              renderThread(latestRoot);
            }
          }
        }
        const debugSnapshot = window.ReskinCompose && typeof window.ReskinCompose.getLastReplyDebug === "function"
          ? window.ReskinCompose.getLastReplyDebug()
          : null;
        logWarn(
          `Reply failed stage=${result.stage || "unknown"} reason=${result.reason || ""} threadId=${targetThreadId || ""} mailbox=${mailbox || ""}`
        );
        if (debugSnapshot) {
          const snapshot = { ...debugSnapshot, ...timing };
          logWarn("Reply debug snapshot", snapshot);
          try {
            logWarn(`Reply debug snapshot JSON ${JSON.stringify(snapshot)}`);
          } catch (_) {
            // ignore
          }
        } else {
          logWarn("Reply timing snapshot", timing);
        }
      }
    } catch (err) {
      failureStage = "exception";
      replyDiagTerminalStatus = "failed";
      replyDiagTerminalPayload = {
        st: "exception",
        rc: 9
      };
      if (typeof diagFail === "function") {
        diagFail("RP199", err, {
          runId: replyDiagRunId,
          tid: targetThreadId,
          mb: mailbox,
          st: "exception",
          rc: 9
        });
      } else {
        emitReplyDiag("RP199", {
          st: "exception",
          rc: 9
        });
      }
      setReplyDraft(replyDraftThreadId, priorInputValue || text);
      if (optimisticMessage) {
        markOptimisticMessageFailed(targetThreadId, optimisticMessage.messageKey);
        if (isContactTimelineV2Enabled() && isContactTimelineV2Active()) {
          rebuildActiveContactTimelineV2({
            reason: "send-exception-failed",
            preferredThreadId: targetThreadId
          });
        } else {
          updateOptimisticInMergedMessages(targetThreadId, optimisticMessage.messageKey, {
            deliveryState: "failed",
            optimisticStatus: "failed",
            optimisticFailedAt: Date.now()
          });
        }
        const latestRoot = getRoot();
        if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
          const renderThread = resolveRenderThread();
          if (typeof renderThread === "function") {
            renderThread(latestRoot);
          }
        }
      }
      logWarn("Reply error", err);
      const debugSnapshot = window.ReskinCompose && typeof window.ReskinCompose.getLastReplyDebug === "function"
        ? window.ReskinCompose.getLastReplyDebug()
        : null;
      if (debugSnapshot) {
        const snapshot = { ...debugSnapshot, ...timing };
        logWarn("Reply debug snapshot", snapshot);
        try {
          logWarn(`Reply debug snapshot JSON ${JSON.stringify(snapshot)}`);
        } catch (_) {
          // ignore
        }
      } else {
        logWarn("Reply timing snapshot", timing);
      }
    } finally {
      if (replyDiagRunId && typeof diagEnd === "function") {
        diagEnd(replyDiagRunId, replyDiagTerminalStatus, replyDiagTerminalPayload);
      }
      state.replySendInProgress = false;
      state.suspendHashSyncDuringContactHydration = previousSuspendHydration;
      setActiveTask(state.fullScanRunning ? `scan:${state.fullScanMailbox || "mailbox"}` : "idle");
      const liveInput = root.querySelector(".rv-thread-input");
      if (liveInput instanceof HTMLInputElement) {
        liveInput.removeAttribute("disabled");
        if (failureStage) {
          if (!normalize(liveInput.value || "")) {
            liveInput.value = priorInputValue || text;
          }
          setReplyDraft(replyDraftThreadId, liveInput.value || priorInputValue || text);
        } else {
          setReplyDraft(replyDraftThreadId, liveInput.value || "");
        }
        if (inputWasFocused) liveInput.focus();
      }
      const liveSendBtn = root.querySelector(".rv-thread-send");
      if (liveSendBtn instanceof HTMLElement) {
        liveSendBtn.removeAttribute("disabled");
        if (failureStage) {
          liveSendBtn.textContent = `Retry (${failureStage})`;
          setTimeout(() => {
            if (liveSendBtn.isConnected) liveSendBtn.textContent = "Send";
          }, 1500);
        } else {
          liveSendBtn.textContent = successStageLabel || "Send";
          if (successStageLabel) {
            setTimeout(() => {
              if (liveSendBtn.isConnected) liveSendBtn.textContent = "Send";
            }, 1200);
          }
        }
      }
    }
  }


    return {
      normalizeReplyResult,
      isLikelyHashThreadId,
      submitThreadReply
    };
  };
})();
