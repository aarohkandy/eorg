(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createInboxSdkApi = function createInboxSdkApi(deps = {}) {
    const {
      INBOX_SDK_THREAD_CACHE_MAX_AGE_MS,
      INBOX_SDK_APP_ID,
      THREAD_BODY_PLACEHOLDER,
      THREAD_NO_CONTENT,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      hasUsefulBodyText,
      isLikelyMetadataBlob,
      cleanThreadMessageBody,
      normalizeThreadMessagesForChat,
      sleep,
      logWarn,
      getRoot,
      canonicalThreadIdForCompare,
      getDiscoverThreadIds,
      getFetchAndRenderThreads
    } = deps;

    const discoverThreadIds = (...args) => {
      const fn = typeof getDiscoverThreadIds === "function" ? getDiscoverThreadIds() : null;
      if (typeof fn !== "function") return Promise.resolve([]);
      return fn(...args);
    };
    const fetchAndRenderThreads = (...args) => {
      const fn = typeof getFetchAndRenderThreads === "function" ? getFetchAndRenderThreads() : null;
      if (typeof fn !== "function") return Promise.resolve();
      return fn(...args);
    };
  function inboxSdkCacheKeyForThread(threadId) {
    return canonicalThreadId(threadId || "") || normalize(threadId || "");
  }

  function getInboxSdkThreadMessages(threadId) {
    const key = inboxSdkCacheKeyForThread(threadId);
    if (!key) return [];
    const updatedAt = Number(state.inboxSdkThreadUpdatedAt[key] || 0);
    if (updatedAt > 0 && Date.now() - updatedAt > INBOX_SDK_THREAD_CACHE_MAX_AGE_MS) {
      delete state.inboxSdkThreadMessages[key];
      delete state.inboxSdkThreadUpdatedAt[key];
      return [];
    }
    const list = state.inboxSdkThreadMessages[key];
    return Array.isArray(list) ? list.slice() : [];
  }

  function setInboxSdkThreadMessages(threadId, messages) {
    const key = inboxSdkCacheKeyForThread(threadId);
    if (!key) return;
    const next = Array.isArray(messages) ? messages.filter((item) => item && typeof item === "object") : [];
    if (next.length === 0) {
      delete state.inboxSdkThreadMessages[key];
      delete state.inboxSdkThreadUpdatedAt[key];
      return;
    }
    state.inboxSdkThreadMessages[key] = next;
    state.inboxSdkThreadUpdatedAt[key] = Date.now();
  }

  function hasMeaningfulCapturedMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return false;
    return messages.some((msg) => {
      const text = normalize((msg && (msg.cleanBodyText || msg.bodyText)) || "");
      return (
        hasUsefulBodyText(text)
        && text !== THREAD_BODY_PLACEHOLDER
        && text !== THREAD_NO_CONTENT
        && !isLikelyMetadataBlob(text)
      );
    });
  }

  function senderLabelFromInboxSdkContact(contact) {
    if (!contact || typeof contact !== "object") return "";
    const email = extractEmail(contact.emailAddress || contact.email || "");
    const name = normalize(contact.name || contact.fullName || contact.title || "");
    if (name && email && name.toLowerCase() !== email.toLowerCase()) return `${name} <${email}>`;
    return name || email;
  }

  function emailsFromInboxSdkContactValue(value) {
    return normalizeEmailList(value);
  }

  async function snapshotInboxSdkThreadView(threadView) {
    if (!threadView || typeof threadView !== "object") return [];
    let threadId = "";
    try {
      if (typeof threadView.getThreadIDAsync === "function") {
        threadId = normalize(await threadView.getThreadIDAsync());
      } else if (typeof threadView.getThreadID === "function") {
        threadId = normalize(threadView.getThreadID());
      }
    } catch (_) {
      threadId = "";
    }
    const canonicalTid = inboxSdkCacheKeyForThread(threadId);
    if (!canonicalTid) return [];

    let messageViews = [];
    try {
      if (typeof threadView.getMessageViewsAll === "function") {
        messageViews = threadView.getMessageViewsAll();
      } else if (typeof threadView.getMessageViews === "function") {
        messageViews = threadView.getMessageViews();
      }
    } catch (_) {
      messageViews = [];
    }
    if (!Array.isArray(messageViews) || messageViews.length === 0) return [];

    const extracted = [];
    for (let i = 0; i < messageViews.length; i += 1) {
      const view = messageViews[i];
      if (!view || typeof view !== "object") continue;
      if (typeof view.isLoaded === "function" && !view.isLoaded()) continue;
      let dataMessageId = "";
      try {
        if (typeof view.getMessageIDAsync === "function") {
          dataMessageId = normalize(await view.getMessageIDAsync());
        } else if (typeof view.getMessageID === "function") {
          dataMessageId = normalize(view.getMessageID());
        }
      } catch (_) {
        dataMessageId = "";
      }
      let sender = "";
      try {
        if (typeof view.getSender === "function") {
          sender = senderLabelFromInboxSdkContact(view.getSender());
        }
      } catch (_) {
        sender = "";
      }
      let recipientEmails = [];
      try {
        if (typeof view.getRecipients === "function") {
          recipientEmails = emailsFromInboxSdkContactValue(view.getRecipients());
        } else if (typeof view.getRecipientEmailAddresses === "function") {
          recipientEmails = normalizeEmailList(view.getRecipientEmailAddresses());
        }
      } catch (_) {
        recipientEmails = [];
      }
      let date = "";
      try {
        if (typeof view.getDateString === "function") {
          date = normalize(view.getDateString() || "");
        }
      } catch (_) {
        date = "";
      }
      let bodyText = "";
      let bodyHtml = "";
      try {
        const bodyElement = typeof view.getBodyElement === "function" ? view.getBodyElement() : null;
        if (bodyElement instanceof HTMLElement) {
          bodyHtml = bodyElement.innerHTML || "";
          bodyText = normalize(bodyElement.innerText || bodyElement.textContent || "");
        }
      } catch (_) {
        bodyText = "";
        bodyHtml = "";
      }
      const cleanedBody = cleanThreadMessageBody(bodyText, bodyHtml);
      if (!hasUsefulBodyText(cleanedBody)) continue;
      extracted.push({
        sender: sender || "Unknown sender",
        senderEmail: extractEmail(sender || ""),
        recipientEmails,
        date,
        dataMessageId,
        bodyHtml: "",
        bodyText: cleanedBody,
        sourceType: "captured"
      });
    }

    const normalized = normalizeThreadMessagesForChat(extracted, canonicalTid);
    if (normalized.length === 0) return [];
    setInboxSdkThreadMessages(canonicalTid, normalized);
    return normalized;
  }

  async function waitForInboxSdkThreadMessages(threadId, timeoutMs = 1200) {
    const canonicalTid = inboxSdkCacheKeyForThread(threadId);
    if (!canonicalTid) return [];
    const existing = getInboxSdkThreadMessages(canonicalTid);
    if (existing.length > 0) return existing;
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const cached = getInboxSdkThreadMessages(canonicalTid);
      if (cached.length > 0) return cached;
      const view = state.inboxSdkThreadViewById[canonicalTid];
      if (view && typeof view === "object") {
        try {
          const snapshot = await snapshotInboxSdkThreadView(view);
          if (snapshot.length > 0) return snapshot;
        } catch (_) {
          // ignore; continue polling cache
        }
      }
      await sleep(120);
    }
    return getInboxSdkThreadMessages(canonicalTid);
  }

  function isFatalInboxSdkInjectionError(error) {
    const text = normalize(error && error.message ? error.message : String(error || "")).toLowerCase();
    if (!text) return false;
    return (
      text.includes("couldn't inject pageworld.js")
      || text.includes("could not establish connection")
      || text.includes("receiving end does not exist")
      || text.includes("inboxsdk__injectpageworld")
      || text.includes("runtime.lasterror")
      || text.includes("extension context invalidated")
    );
  }

  async function ensureInboxSdkReady() {
    if (state.inboxSdkDisabled) return null;
    if (state.inboxSdkReady && state.inboxSdkInstance) return state.inboxSdkInstance;
    if (state.inboxSdkLoadPromise) return state.inboxSdkLoadPromise;
    if (!window.InboxSDK || typeof window.InboxSDK.load !== "function") {
      return null;
    }
    let loadPromise = null;
    try {
      loadPromise = window.InboxSDK.load(2, INBOX_SDK_APP_ID, {
        eventTracking: false,
        globalErrorLogging: false
      });
    } catch (error) {
      state.inboxSdkReady = false;
      state.inboxSdkDisabled = isFatalInboxSdkInjectionError(error);
      state.inboxSdkFailureReason = normalize(error && error.message ? error.message : String(error || ""));
      if (state.inboxSdkDisabled) {
        logWarn(`InboxSDK disabled after fatal injection error: ${state.inboxSdkFailureReason}`);
      } else {
        logWarn(`InboxSDK initialization failed: ${state.inboxSdkFailureReason}`);
      }
      return null;
    }
    state.inboxSdkLoadPromise = Promise.resolve(loadPromise).then((sdk) => {
      if (!sdk || !sdk.Conversations || typeof sdk.Conversations.registerThreadViewHandler !== "function") {
        state.inboxSdkReady = false;
        return null;
      }
      state.inboxSdkInstance = sdk;
      state.inboxSdkReady = true;
      state.inboxSdkFailureReason = "";

      // Flush any contact discovery that was queued before InboxSDK was ready.
      if (state._pendingDiscovery) {
        const { contactEmail } = state._pendingDiscovery;
        state._pendingDiscovery = null;
        state.discoveryController?.abort();
        state.discoveryController = new AbortController();
        discoverThreadIds(contactEmail, state.discoveryController.signal).then((newIds) => {
          const alreadyDisplayed = new Set((state.contactThreadIds || []).map(canonicalThreadIdForCompare));
          const freshIds = newIds.filter((id) => !alreadyDisplayed.has(canonicalThreadIdForCompare(id)));
          if (freshIds.length > 0) {
            fetchAndRenderThreads(freshIds.slice(0, 10), getRoot());
          }
        }).catch((err) => logWarn("discoverThreadIds (deferred) failed", err));
      }

      sdk.Conversations.registerThreadViewHandler((threadView) => {
        (async () => {
          try {
            const tid = normalize(
              typeof threadView.getThreadIDAsync === "function"
                ? await threadView.getThreadIDAsync()
                : (typeof threadView.getThreadID === "function" ? threadView.getThreadID() : "")
            );
            const canonicalTid = inboxSdkCacheKeyForThread(tid);
            if (canonicalTid) {
              state.inboxSdkThreadViewById[canonicalTid] = threadView;
            }
            await snapshotInboxSdkThreadView(threadView);
            if (typeof threadView.on === "function") {
              threadView.on("destroy", () => {
                if (canonicalTid && state.inboxSdkThreadViewById[canonicalTid] === threadView) {
                  delete state.inboxSdkThreadViewById[canonicalTid];
                }
              });
            }
          } catch (_) {
            // ignore thread handler extraction errors
          }
        })();
      });
      return sdk;
    }).catch((error) => {
      state.inboxSdkReady = false;
      state.inboxSdkFailureReason = normalize(error && error.message ? error.message : String(error || ""));
      if (isFatalInboxSdkInjectionError(error)) {
        state.inboxSdkDisabled = true;
        logWarn(`InboxSDK disabled after fatal injection error: ${state.inboxSdkFailureReason}`);
      } else {
        logWarn(`InboxSDK initialization failed: ${state.inboxSdkFailureReason}`);
      }
      return null;
    }).finally(() => {
      if (!state.inboxSdkReady) {
        state.inboxSdkInstance = null;
      }
      state.inboxSdkLoadPromise = null;
    });
    return state.inboxSdkLoadPromise;
  }


    return {
      inboxSdkCacheKeyForThread,
      getInboxSdkThreadMessages,
      setInboxSdkThreadMessages,
      hasMeaningfulCapturedMessages,
      senderLabelFromInboxSdkContact,
      emailsFromInboxSdkContactValue,
      snapshotInboxSdkThreadView,
      waitForInboxSdkThreadMessages,
      isFatalInboxSdkInjectionError,
      ensureInboxSdkReady
    };
  };
})();
