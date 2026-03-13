(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createUiThreadListApi = function createUiThreadListApi(deps = {}) {
    const {
      DEBUG_THREAD_EXTRACT,
      ENABLE_AI_BACKGROUND_AUTOMATION,
      ENABLE_CONTACT_GROUP_LIST,
      ENABLE_CONTACT_MERGE_LEGACY,
      ENABLE_CONTACT_MERGE_MODE,
      LIST_LOAD_MORE_DISTANCE_PX,
      LIST_PREFETCH_DISTANCE_PX,
      STARTUP_PERF_MODE,
      ENABLE_STARTUP_WARM_LIST_RENDER,
      STARTUP_FAST_LIST_LIMIT,
      STARTUP_WARM_LIST_DELAY_MS,
      THEME_DARK,
      THEME_LIGHT,
      THREAD_BODY_PLACEHOLDER,
      THREAD_LIST_REFRESH_GAP_MS,
      THREAD_NO_CONTENT,
      THREAD_READY_MAX_RETRIES,
      THREAD_READY_RETRY_BASE_MS,
      TRIAGE_LEVELS,
      state,
      normalize,
      escapeHtml,
      parseListRoute,
      hashHasTriageParam,
      loadSettingsCached,
      mailboxCacheKey,
      collectMessages,
      mergeMailboxCache,
      mailboxMessagesForList,
      getTriageLevelForMessage,
      threadIdInServer,
      chatScopeMessages,
      groupMessagesByContact,
      interactionsLocked,
      threadHintKeysForThread,
      rememberThreadNavigationHint,
      getSummaryForMessage,
      scheduleMailboxScanKick,
      triageLabelText,
      lockInteractions,
      bumpInteractionEpoch,
      setActiveTask,
      beginPerfTrace,
      markPerfStage,
      diagStart,
      diagEnd,
      diagSnapshot,
      extractEmail,
      canonicalThreadId,
      openContactTimelineFromRowV2,
      triggerPendingContactDiscovery,
      loadContactChat,
      clearContactConversationState,
      openContactChatFromRow,
      lookupThreadHintHref,
      openThread,
      logChatDebug,
      logWarn,
      markThreadsReadLocally,
      getRoot,
      queueSummariesForMessages,
      getReplyDraft,
      setReplyDraft,
      submitThreadReply,
      applyReskin,
      scheduleDeferredWork,
      activeMailbox,
      isContactTimelineV2Enabled,
      activeConversationContext,
      normalizeThreadMessagesForChat,
      extractOpenThreadData,
      mergeOptimisticIntoMessages,
      senderDisplayName,
      activeConversationContactEmail,
      initialForSender,
      summarizeChatMessagesForDebug,
      logEvent,
      diag,
      diagFail,
      isGenericSenderLabel,
      hasUsefulBodyText,
      threadIdFromHash,
      isThreadHash,
      waitForThreadContentReady,
      threadHashForMailbox,
      sleep,
      normalizeTheme,
      providerNeedsApiKey,
      apiKeyPlaceholderForProvider,
      buildApiKeyGuide,
      loadPersistedTriageMap,
      getMailboxMessages,
      runFullMailboxScan,
      selectMessagesForQuestion,
      logTriageDebug,
      triageLocalSet,
      isAppSettingsHash,
      logInfo,
      renderSidebar,
      renderRightRail,
      stripGmailHtmlToClean,
      sanitizeForShadow,
      SHADOW_EMBED_STYLE
    } = deps;

  function stableHash(input) {
    const text = String(input || "");
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function threadSampleDigest(messages, limit = 10) {
    const rows = Array.isArray(messages) ? messages.slice(0, Math.max(1, Number(limit) || 10)) : [];
    const packed = rows.map((msg) => ([
      normalize(msg && msg.messageKey || ""),
      normalize(msg && msg.threadId || ""),
      normalize(msg && msg.direction || ""),
      Number(msg && msg.timestampMs || 0)
    ].join("|"))).join("~");
    return {
      sample_count: rows.length,
      sample_hash: stableHash(packed)
    };
  }

  function extensionMessagingAvailable() {
    return Boolean(
      typeof chrome !== "undefined"
      && chrome.runtime
      && typeof chrome.runtime.sendMessage === "function"
    );
  }

  function formatBackendDateToken(value) {
    const date = new Date(value || 0);
    if (!Number.isFinite(date.getTime())) return "";
    const now = new Date();
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    if (date.getFullYear() === now.getFullYear()) {
      return date.toLocaleDateString([], { month: "short", day: "numeric" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
  }

  function backendThreadId(rawThreadId, fallbackToken = "") {
    const raw = normalize(rawThreadId || "");
    if (/^(?:thread-)?f:[A-Za-z0-9_-]+$/i.test(raw)) return raw;
    const compact = raw
      .replace(/^<|>$/g, "")
      .replace(/[^A-Za-z0-9_-]/g, "");
    if (compact) return compact.slice(0, 64);
    const fallback = normalize(fallbackToken || "") || "message";
    return `ext-${stableHash(fallback).slice(0, 12)}`;
  }

  function backendMessageToRow(message, mailbox) {
    const from = message && message.from && typeof message.from === "object" ? message.from : {};
    const to = Array.isArray(message && message.to) ? message.to : [];
    const fromEmail = extractEmail(from.email || "");
    const outgoing = Boolean(message && message.isOutgoing);

    const primaryRecipient = to.find((entry) => extractEmail(entry && entry.email));
    const contactName = outgoing
      ? normalize(primaryRecipient && (primaryRecipient.name || primaryRecipient.email))
      : normalize(from.name || from.email);
    const contactEmail = outgoing
      ? extractEmail(primaryRecipient && primaryRecipient.email)
      : fromEmail;
    const recipientEmails = outgoing
      ? [contactEmail].filter(Boolean)
      : to.map((entry) => extractEmail(entry && entry.email)).filter(Boolean);
    const safeThreadId = backendThreadId(
      message && message.threadId,
      `${normalize(message && message.id)}|${normalize(message && message.messageId)}|${normalize(message && message.uid)}`
    );
    const routeMailbox = mailboxCacheKey(mailbox || "inbox");

    return {
      threadId: safeThreadId,
      sender: contactName || contactEmail || "Unknown sender",
      senderEmail: contactEmail || "",
      recipientEmails,
      subject: normalize(message && message.subject) || "No subject captured",
      snippet: normalize(message && message.snippet) || "",
      bodyText: "",
      date: formatBackendDateToken(message && message.date),
      href: `#${routeMailbox}/${safeThreadId}`,
      row: null,
      triageLevel: "",
      unread: !Array.isArray(message && message.flags) || !message.flags.includes("\\Seen"),
      mailbox: routeMailbox
    };
  }

  async function refreshBackendAccountState() {
    if (!extensionMessagingAvailable()) return;
    const now = Date.now();
    if (Number(state.backendAccountRefreshedAt || 0) > 0 && now - Number(state.backendAccountRefreshedAt || 0) < 20000) return;
    try {
      const response = await chrome.runtime.sendMessage({ action: "GET_STORAGE", payload: {} });
      if (!response || response.success === false) return;
      state.backendConnected = Boolean(response.userId);
      state.backendConnectedEmail = normalize(response.userEmail || "");
      state.backendAccountRefreshedAt = Date.now();
    } catch (_) {
      // Ignore extension storage probe failures.
    }
  }

  async function refreshMailboxFromBackend(root, mailbox, options = {}) {
    if (!extensionMessagingAvailable()) return;
    const key = mailboxCacheKey(mailbox || "inbox");
    if (key !== "inbox" && key !== "sent") return;
    state.backendMailboxSync = state.backendMailboxSync || {};
    const syncState = state.backendMailboxSync[key] || { inFlight: false, lastAt: 0 };
    const now = Date.now();
    const hasCache = Array.isArray(state.scannedMailboxMessages[key]) && state.scannedMailboxMessages[key].length > 0;
    const staleMs = Number(options.staleMs || 90000);
    if (!options.force && syncState.inFlight) return;
    if (!options.force && hasCache && now - Number(syncState.lastAt || 0) < staleMs) return;

    state.backendMailboxSync[key] = { ...syncState, inFlight: true, lastAt: syncState.lastAt || 0 };
    let syncSucceeded = false;
    try {
      await refreshBackendAccountState();
      const response = await chrome.runtime.sendMessage({
        action: "FETCH_MESSAGES",
        payload: {
          folder: key,
          limit: Number(options.limit || 500),
          forceSync: Boolean(options.force)
        }
      });

      if (!response || response.success === false) {
        const code = normalize(response && response.code || "");
        if (code === "NOT_CONNECTED") {
          state.backendStatusMessage = "Not set up yet. Click the extension icon to connect.";
          state.backendConnected = false;
        } else if (code === "BACKEND_COLD_START") {
          state.backendStatusMessage = "Backend server is starting up, please wait 60 seconds and try again.";
        } else {
          state.backendStatusMessage = normalize(response && response.error) || "Backend fetch failed.";
        }
        return;
      }

      const messages = Array.isArray(response.messages) ? response.messages : [];
      const mapped = messages.map((msg) => backendMessageToRow(msg, key));
      mergeMailboxCache(key, mapped);
      state.backendStatusMessage = "";
      state.backendConnected = true;
      state.fullScanCompletedByMailbox[key] = true;
      state.fullScanStatus = `Loaded ${mapped.length} ${key} messages from backend`;
      state.backendMailboxSync[key] = { inFlight: false, lastAt: Date.now() };
      syncSucceeded = true;
      if (root instanceof HTMLElement && state.currentView === "list") {
        state.lastListSignature = "";
        state.lastObserverSignature = "";
        applyReskin();
      }
      return;
    } catch (error) {
      state.backendStatusMessage = normalize(error && error.message) || "Backend fetch failed.";
    } finally {
      const latest = state.backendMailboxSync[key] || {};
      const fallbackLastAt = syncSucceeded ? Date.now() : Math.max(0, Date.now() - 45000);
      state.backendMailboxSync[key] = { inFlight: false, lastAt: Number(latest.lastAt || fallbackLastAt) };
    }
  }

  function emitSnapshot() {
    if (typeof diagSnapshot !== "function") return;
    const timeline = Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : [];
    let outgoing = 0;
    let incoming = 0;
    for (const msg of timeline) {
      const direction = normalize(msg && msg.direction || "");
      if (direction === "outgoing") outgoing += 1;
      else if (direction === "incoming") incoming += 1;
    }
    diagSnapshot({
      vw: normalize(state.currentView || ""),
      hs: normalize(window.location.hash || "").slice(0, 60),
      mc: timeline.length,
      tc: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : 0,
      oc: outgoing,
      ic: incoming,
      ac: extractEmail(state.activeContactEmail || ""),
      cl: Boolean(state.contactChatLoading)
    });
  }

  function renderThread(root) {
    const wrap = root.querySelector(".rv-thread-wrap");
    if (!(wrap instanceof HTMLElement)) return;
    const placeholder = root.querySelector(".rv-chat-placeholder");
    if (placeholder instanceof HTMLElement) placeholder.classList.add("is-hidden");
    wrap.style.display = "";
    const hydrationRunId = Number(state.contactHydrationRunId || 0);
    const nowMs = Date.now();

    if (ENABLE_CONTACT_MERGE_MODE && state.contactChatLoading) {
      if (!state._collectingIndicatorVisible) {
        if (
          Number(state._collectingLastHiddenRunId || 0) === hydrationRunId
          && nowMs - Number(state._collectingLastHiddenAt || 0) < 2200
        ) {
          logEvent("UI190", {
            runId: hydrationRunId,
            gapMs: nowMs - Number(state._collectingLastHiddenAt || 0)
          });
        }
        logEvent("UI120", { runId: hydrationRunId });
      }
      state._collectingIndicatorVisible = true;
      state._collectingIndicatorRunId = hydrationRunId;
      wrap.innerHTML = `
        <section class="rv-thread rv-thread-chat" data-reskin="true">
          <div class="rv-thread-chat-header" data-reskin="true">
            <button type="button" class="rv-back" data-reskin="true">\u2190 Back</button>
            <h2 class="rv-thread-subject" data-reskin="true">${escapeHtml(state.contactDisplayName || "Chat")}</h2>
          </div>
          <div class="rv-thread-messages" data-reskin="true" style="display:flex;align-items:center;justify-content:center;padding:40px;">
            <p class="rv-thread-empty" data-reskin="true" style="color:#949ba4;">Loading conversation…</p>
          </div>
        </section>
      `;
      return;
    }
    if (state._collectingIndicatorVisible) {
      logEvent("UI121", {
        runId: Number(state._collectingIndicatorRunId || hydrationRunId || 0)
      });
      state._collectingLastHiddenRunId = Number(state._collectingIndicatorRunId || hydrationRunId || 0);
      state._collectingLastHiddenAt = nowMs;
      state._collectingIndicatorVisible = false;
      state._collectingIndicatorRunId = 0;
    }

    let thread;
    let messages;
    let renderThreadId = canonicalThreadId(
      state.currentThreadIdForReply ||
      threadIdFromHash(window.location.hash || "") ||
      state.activeThreadId ||
      ""
    ) || normalize(
      state.currentThreadIdForReply ||
      threadIdFromHash(window.location.hash || "") ||
      state.activeThreadId ||
      ""
    );
    const inContactChatMode = Boolean(
      ENABLE_CONTACT_MERGE_MODE &&
      (normalize(state.activeConversationKey || "") || normalize(state.activeContactKey || "")) &&
      Array.isArray(state.contactThreadIds) &&
      state.contactThreadIds.length > 0
    );
    // Only navigate the hash to open the Gmail thread DOM when we actually need
    // Gmail DOM content — i.e. when NOT in contact-chat mode. In contact-chat mode
    // all data comes from print-view fetches so we must never touch the user's
    // visible Gmail URL or wait for .BltHke containers to appear.
    if (!inContactChatMode && renderThreadId && !isThreadHash(window.location.hash || "") && !state.replySendInProgress) {
      const targetMailbox = mailboxCacheKey(
        state.currentThreadMailbox
        || activeMailbox()
        || "inbox"
      );
      const targetHash = threadHashForMailbox(
        targetMailbox,
        renderThreadId,
        state.currentThreadHintHref || lookupThreadHintHref(renderThreadId)
      );
      if (normalize(targetHash) && normalize(targetHash) !== normalize(window.location.hash || "")) {
        window.location.hash = targetHash;
      }
    }
    // Skip waitForThreadContentReady whenever we are in contact-chat mode (loading
    // or loaded) — we never read the Gmail DOM in that path.
    const inContactTimelineV2 = Boolean(
      isContactTimelineV2Enabled()
      && inContactChatMode
    );
    let readiness = {
      ready: true,
      messageContainers: 0,
      bodyNodes: 0,
      iframeBodyNodes: 0,
      iframeCount: 0
    };
    if (!inContactTimelineV2) {
      const readyState = waitForThreadContentReady(renderThreadId || normalize(state.activeThreadId || ""));
      readiness = readyState.readiness;
      logChatDebug("thread-extract:containers", {
        threadId: renderThreadId || normalize(state.activeThreadId || ""),
        readiness
      }, {
        throttleKey: `thread-extract-containers:${renderThreadId || normalize(state.activeThreadId || "unknown")}`,
        throttleMs: 260
      });

      if (!readyState.ready && !readyState.timedOut) {
        const retryAttempt = readyState.attempt;
        const waitMs = readyState.waitMs;
        logChatDebug("thread-open:timeout", {
          threadId: renderThreadId || normalize(state.activeThreadId || ""),
          attempt: retryAttempt,
          waitMs,
          readiness
        }, { throttleKey: `thread-open-timeout:${renderThreadId || "unknown"}:${retryAttempt}`, throttleMs: 220 });
        wrap.innerHTML = `
          <section class="rv-thread rv-thread-chat" data-reskin="true">
            <div class="rv-thread-chat-header" data-reskin="true">
              <button type="button" class="rv-back" data-reskin="true">\u2190 Back</button>
              <h2 class="rv-thread-subject" data-reskin="true">Loading thread…</h2>
            </div>
            <div class="rv-thread-messages" data-reskin="true" style="display:flex;align-items:center;justify-content:center;padding:40px;">
              <p class="rv-thread-empty" data-reskin="true" style="color:#949ba4;">Waiting for Gmail thread content…</p>
            </div>
          </section>
        `;
        setTimeout(() => {
          const latestRoot = getRoot();
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
            renderThread(latestRoot);
          }
        }, waitMs);
        return;
      }
      if (readyState.ready && readyState.attempt > 0) {
        logChatDebug("thread-open:ready", {
          threadId: renderThreadId || normalize(state.activeThreadId || ""),
          attempts: readyState.attempt,
          readiness
        }, { throttleKey: `thread-open-ready:${renderThreadId || "unknown"}`, throttleMs: 420 });
        state.threadExtractRetry = 0;
      }
      if (!readyState.ready && readyState.timedOut) {
        logChatDebug("thread-open:timeout", {
          threadId: renderThreadId || normalize(state.activeThreadId || ""),
          attempt: readyState.attempt,
          waitMs: 0,
          readiness,
          maxRetries: THREAD_READY_MAX_RETRIES
        }, { throttleKey: `thread-open-timeout-final:${renderThreadId || "unknown"}`, throttleMs: 1000 });
      }
    }

    if (inContactTimelineV2) {
      thread = { subject: `Chat with ${state.contactDisplayName || "contact"}` };
      messages = normalizeThreadMessagesForChat(
        Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : [],
        renderThreadId,
        activeConversationContext()
      );
    } else if (ENABLE_CONTACT_MERGE_LEGACY && Array.isArray(state.mergedMessages) && state.mergedMessages.length > 0) {
      thread = { subject: `Chat with ${state.contactDisplayName || "contact"}` };
      messages = normalizeThreadMessagesForChat(state.mergedMessages, renderThreadId, activeConversationContext());
    } else {
      thread = extractOpenThreadData();
      messages = normalizeThreadMessagesForChat(
        Array.isArray(thread.messages) ? thread.messages : [],
        renderThreadId,
        activeConversationContext()
      );
      // Keep Gmail DOM order; lexical date sorting can invert chronology.
      const bodyMissing = messages.length === 1 && (messages[0].bodyText || "").trim() === THREAD_BODY_PLACEHOLDER;
      if (bodyMissing && state.threadExtractRetry < THREAD_READY_MAX_RETRIES) {
        state.threadExtractRetry += 1;
        setTimeout(() => {
          const latestRoot = getRoot();
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") {
            renderThread(latestRoot);
          }
        }, THREAD_READY_RETRY_BASE_MS + 80);
      } else if (!bodyMissing) {
        state.threadExtractRetry = 0;
      }
    }

    const headerTitle = inContactChatMode
      ? `Chat with ${state.contactDisplayName || senderDisplayName((messages[0] && messages[0].sender) || "") || "contact"}`
      : (
        (Array.isArray(messages) && messages.length > 0 && senderDisplayName(messages[0].sender))
          ? `Chat with ${senderDisplayName(messages[0].sender)}`
          : (thread.subject || "Chat")
      );
    const activeThreadForSnippet = threadIdFromHash(window.location.hash) || state.activeThreadId;
    if (messages.length > 1) {
      const usefulCount = messages.filter((msg) => hasUsefulBodyText(msg && msg.cleanBodyText)).length;
      if (usefulCount > 0) {
        messages = messages.filter((msg) => hasUsefulBodyText(msg && msg.cleanBodyText));
      }
    }
    if (!renderThreadId) {
      renderThreadId = canonicalThreadId(
        state.currentThreadIdForReply ||
        activeThreadForSnippet ||
        (messages[0] && messages[0].threadId) ||
        ""
      ) || normalize(
        state.currentThreadIdForReply ||
        activeThreadForSnippet ||
        (messages[0] && messages[0].threadId) ||
        ""
      );
    }
    if (!inContactTimelineV2) {
      messages = mergeOptimisticIntoMessages(messages, renderThreadId);
    }
    const emptyOrPlaceholder = messages.length === 0 || messages.every((msg) => (
      !hasUsefulBodyText(msg && msg.cleanBodyText)
      || normalize((msg && msg.cleanBodyText) || "") === THREAD_BODY_PLACEHOLDER
    ));
    if (emptyOrPlaceholder) {
      logChatDebug("thread-extract:empty", {
        threadId: renderThreadId,
        messageCount: messages.length,
        readiness
      }, { throttleKey: `thread-extract-empty:${renderThreadId || "unknown"}`, throttleMs: 700 });
    }
    const directionCounts = { incoming: 0, outgoing: 0, unknown: 0 };
    for (const msg of messages) {
      const direction = normalize(msg && msg.direction || "");
      if (direction === "outgoing") directionCounts.outgoing += 1;
      else if (direction === "incoming") directionCounts.incoming += 1;
      else directionCounts.unknown += 1;
    }
    logChatDebug("thread-render:timeline", {
      conversationKey: state.activeConversationKey || "",
      contactEmail: state.activeContactEmail || "",
      activeAccountEmail: state.activeAccountEmail || "",
      renderThreadId,
      totalMessages: messages.length,
      directionCounts,
      ...threadSampleDigest(messages, 8)
    }, {
      throttleKey: `thread-render:${state.activeConversationKey || renderThreadId || "single-thread"}`,
      throttleMs: 350
    });
    if (!renderThread._lastLog || Date.now() - renderThread._lastLog >= 400) {
      renderThread._lastLog = Date.now();
      logEvent("thread-render", {
        messageCount: messages.length,
        directionCounts,
        hash: (window.location.hash || "").slice(0, 50),
        contactMode: inContactTimelineV2
      });
    }
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] renderThread: displaying ${messages.length} message(s) in thread view`);
    }

    const senderName = (raw) => {
      const s = (raw || "").trim();
      const m = s.match(/^(.+?)\s*<[^>]+>$/);
      return m ? m[1].trim() : s;
    };

    const stableContactLabel = (() => {
      const explicit = normalize(state.contactDisplayName || "");
      if (explicit && !isGenericSenderLabel(explicit)) return explicit;
      const contactEmail = extractEmail(state.activeContactEmail || activeConversationContactEmail() || "");
      if (!contactEmail) return "Contact";
      const local = normalize(contactEmail.split("@")[0] || "");
      return local || contactEmail;
    })();

    const stableIncomingLabelBySenderEmail = new Map();
    for (const msg of messages) {
      const direction = normalize(msg && msg.direction) === "outgoing" ? "outgoing" : "incoming";
      if (direction === "outgoing") continue;
      const senderEmail = extractEmail((msg && msg.senderEmail) || (msg && msg.sender) || "");
      if (!senderEmail || stableIncomingLabelBySenderEmail.has(senderEmail)) continue;
      const candidate = normalize(senderName(msg && msg.sender));
      if (candidate && !isGenericSenderLabel(candidate)) {
        stableIncomingLabelBySenderEmail.set(senderEmail, candidate);
        continue;
      }
      const fallback = normalize(senderDisplayName((msg && msg.sender) || "")) || senderEmail;
      stableIncomingLabelBySenderEmail.set(senderEmail, fallback);
    }

    const messageRows = messages.map((msg) => {
      const direction = normalize(msg && msg.direction) === "outgoing" ? "outgoing" : "incoming";
      const directionClass = direction === "outgoing" ? "rv-thread-msg--outgoing" : "rv-thread-msg--incoming";
      const status = normalize((msg && msg.deliveryState) || (msg && msg.optimisticStatus));
      const isUnverifiedSent = Boolean(msg && msg.optimisticUnverifiedAt);
      const statusLabel = msg && msg.isOptimistic
        ? (status === "sent" ? (isUnverifiedSent ? "Sent (syncing)" : "Sent") : (status === "failed" ? "Failed" : "Sending..."))
        : "";
      const incomingSenderEmail = extractEmail((msg && msg.senderEmail) || (msg && msg.sender) || "");
      const incomingFallbackLabel = normalize(
        senderName(msg && msg.sender)
        || senderDisplayName((msg && msg.sender) || "")
        || stableContactLabel
      ) || "Contact";
      const activeContactEmail = extractEmail(state.activeContactEmail || activeConversationContactEmail() || "");
      const mappedIncomingLabel = incomingSenderEmail
        ? (stableIncomingLabelBySenderEmail.get(incomingSenderEmail) || incomingFallbackLabel)
        : incomingFallbackLabel;
      const senderLabel = direction === "outgoing"
        ? "You"
        : (
          inContactChatMode && incomingSenderEmail && activeContactEmail && incomingSenderEmail === activeContactEmail
            ? stableContactLabel
            : mappedIncomingLabel
        );
      const bodyText = normalize((msg && msg.cleanBodyText) || (msg && msg.bodyText) || "");
      const initial = initialForSender(senderLabel || (msg && msg.sender));
      return `
        <div class="rv-thread-msg ${directionClass}${msg && msg.isOptimistic ? " rv-thread-msg--optimistic" : ""}${status === "failed" ? " rv-thread-msg--failed" : ""}" data-reskin="true" data-message-key="${escapeHtml(msg && msg.messageKey)}" data-thread-id="${escapeHtml(msg && msg.threadId)}">
          <div class="rv-thread-msg-avatar" data-reskin="true" title="${escapeHtml(senderLabel || "")}">${escapeHtml(initial)}</div>
          <div class="rv-thread-msg-content" data-reskin="true">
            <div class="rv-thread-msg-head" data-reskin="true">
              <span class="rv-thread-msg-sender" data-reskin="true">${escapeHtml(senderLabel || "Unknown sender")}</span>
              <span class="rv-thread-msg-date" data-reskin="true">${escapeHtml(msg && msg.date)}</span>
              ${statusLabel ? `<span class="rv-thread-msg-status" data-reskin="true">${escapeHtml(statusLabel)}</span>` : ""}
            </div>
            <div class="rv-thread-msg-body rv-thread-msg-plain" data-reskin="true">${escapeHtml(bodyText || THREAD_NO_CONTENT)}</div>
          </div>
        </div>
      `;
    }).join("");
    const inputDisabledAttr = state.replySendInProgress ? ' disabled="true"' : "";
    const sendDisabledAttr = state.replySendInProgress ? ' disabled="true"' : "";
    const sendLabel = state.replySendInProgress ? "Sending..." : "Send";
    const showFindHistory = Boolean(ENABLE_CONTACT_MERGE_MODE && normalize(state.activeConversationKey || ""));
    const findHistoryDisabledAttr = state.contactDiscoveryInFlight ? ' disabled="true"' : "";
    const findHistoryLabel = state.contactDiscoveryInFlight ? "Finding..." : "Find more history";

    wrap.innerHTML = `
      <section class="rv-thread rv-thread-chat" data-reskin="true">
        <div class="rv-thread-chat-header" data-reskin="true">
          <button type="button" class="rv-back" data-reskin="true">\u2190 Back</button>
          <h2 class="rv-thread-subject" data-reskin="true">${escapeHtml(headerTitle)}</h2>
          ${showFindHistory ? `<button type="button" class="rv-find-history" data-reskin="true"${findHistoryDisabledAttr}>${escapeHtml(findHistoryLabel)}</button>` : ""}
        </div>
        <div class="rv-thread-messages" data-reskin="true">
          ${messageRows || '<div class="rv-thread-empty" data-reskin="true">No messages in this thread.</div>'}
        </div>
        <div class="rv-thread-input-bar" data-reskin="true">
          <input type="text" class="rv-thread-input" placeholder="Type a message..." data-reskin="true"${inputDisabledAttr} />
          <button type="button" class="rv-thread-send" data-reskin="true"${sendDisabledAttr}>${escapeHtml(sendLabel)}</button>
        </div>
      </section>
    `;

    const threadInput = wrap.querySelector(".rv-thread-input");
    const replyDraftThreadId = normalize(renderThreadId || state.currentThreadIdForReply || state.activeThreadId || "");
    if (threadInput instanceof HTMLInputElement) {
      const draftValue = getReplyDraft(replyDraftThreadId);
      if (draftValue && threadInput.value !== draftValue) {
        threadInput.value = draftValue;
      }
      threadInput.addEventListener("input", () => {
        setReplyDraft(replyDraftThreadId, threadInput.value || "");
      });
      threadInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          submitThreadReply(root);
        }
      });
    }

    const msgContainer = wrap.querySelector(".rv-thread-messages");
    if (msgContainer instanceof HTMLElement) {
      requestAnimationFrame(() => {
        msgContainer.scrollTop = msgContainer.scrollHeight;
      });
    }
    const findHistoryBtn = wrap.querySelector(".rv-find-history");
    if (findHistoryBtn instanceof HTMLButtonElement) {
      findHistoryBtn.addEventListener("click", () => {
        if (state.contactDiscoveryInFlight) return;
        state.contactDiscoveryInFlight = true;
        renderThread(root);
        let started = false;
        if (typeof triggerPendingContactDiscovery === "function") {
          started = Boolean(triggerPendingContactDiscovery(root, { reason: "manual-find-history" }));
        }
        if (!started) {
          state.contactDiscoveryInFlight = false;
          logEvent("open:discovery", {
            reason: "manual-find-history",
            freshCount: 0,
            started: false
          });
        }
        setTimeout(() => {
          if (!started) {
            state.contactDiscoveryInFlight = false;
          }
          const latestRoot = getRoot();
          if (latestRoot instanceof HTMLElement && state.currentView === "thread") renderThread(latestRoot);
        }, 900);
      });
    }
  }

  async function runTriageForInbox(options = {}) {
    void options;
    state.triageStatus = "";
  }

  function renderCurrentView(root) {
    // Route hash is the source of truth for Settings, so stale state cannot pin us back to list view.
    if (isAppSettingsHash()) {
      state.settingsPinned = true;
      state.currentView = "settings";
    }

    const now = Date.now();
    const inOpenTransition = (
      state.currentView === "thread"
      && now < Number(state.threadOpenTransitionUntil || 0)
    );
    if (!inOpenTransition) {
      renderSidebar(root);
      renderRightRail(root);
    }
    const placeholder = root.querySelector(".rv-chat-placeholder");
    const threadWrap = root.querySelector(".rv-thread-wrap");
    const settingsWrap = root.querySelector(".rv-settings-wrap");
    if (placeholder) placeholder.classList.toggle("is-hidden", state.currentView !== "list");
    if (threadWrap) threadWrap.style.display = state.currentView === "thread" ? "" : "none";
    if (settingsWrap) settingsWrap.style.display = state.currentView === "settings" ? "" : "none";
    if (state.currentView === "settings") {
      renderSettings(root);
      return;
    }
    if (state.currentView === "thread") {
      if (!inOpenTransition && !isThreadHash(window.location.hash || "")) {
        renderList(root);
      }
      renderThread(root);
      if (!inOpenTransition && Number(state.threadOpenTransitionUntil || 0) > 0) {
        state.threadOpenTransitionUntil = 0;
      }
      if (
        !state.fullScanRunning &&
        !state.replySendInProgress &&
        /^open-|^back-to-list$/.test(normalize(state.activeTask || ""))
      ) {
        setActiveTask("idle");
      }
      return;
    }
    renderList(root);
    if (
      !state.fullScanRunning &&
      !state.replySendInProgress &&
      /^open-|^back-to-list$/.test(normalize(state.activeTask || ""))
    ) {
      setActiveTask("idle");
    }
  }

  function renderSettings(root) {
    const wrap = root.querySelector(".rv-settings-wrap");
    if (!(wrap instanceof HTMLElement)) return;
    const settings = state.settingsCache || { theme: THEME_DARK };
    const currentTheme = normalizeTheme(settings.theme);
    const connected = Boolean(state.backendConnected);
    const connectedEmail = normalize(state.backendConnectedEmail || "");
    const backendStatus = normalize(state.backendStatusMessage || state.settingsStatusMessage || state.fullScanStatus || "");

    if (!state.settingsAccountProbeInFlight) {
      state.settingsAccountProbeInFlight = true;
      refreshBackendAccountState().finally(() => {
        state.settingsAccountProbeInFlight = false;
        if (state.currentView !== "settings") return;
        const latestRoot = getRoot();
        if (!(latestRoot instanceof HTMLElement)) return;
        renderSettings(latestRoot);
      });
    }

    wrap.innerHTML = `
      <section class="rv-settings-view" data-reskin="true">
        <h2 class="rv-settings-title" data-reskin="true">Mailita Settings</h2>
        <p class="rv-settings-copy" data-reskin="true">Complete setup and keep mailbox sync healthy from one place.</p>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">Connection</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <div class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">Account</div>
              <div class="rv-settings-copy" data-reskin="true">${connected ? `Connected as ${escapeHtml(connectedEmail || "your Gmail account")}` : "Not connected yet. Use the extension popup onboarding first."}</div>
              ${backendStatus ? `<div class="rv-settings-copy" data-reskin="true" style="margin-top:6px;">${escapeHtml(backendStatus)}</div>` : ""}
            </div>
            <div class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">Actions</div>
              <div class="rv-settings-copy" data-reskin="true">Use health check + sync after connecting, or when data looks stale.</div>
              <div class="rv-modal-actions" data-reskin="true" style="margin-top:8px;">
                <button type="button" class="rv-settings-health-check" data-reskin="true">Check backend status</button>
                <button type="button" class="rv-settings-sync-now" data-reskin="true"${connected ? "" : " disabled"}>Sync now</button>
                <button type="button" class="rv-settings-reload-mail" data-reskin="true">Reload mailbox</button>
                <button type="button" class="rv-settings-disconnect" data-reskin="true"${connected ? "" : " disabled"}>Disconnect</button>
              </div>
            </div>
          </div>
        </section>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">Setup Guide</div>
          <ol class="rv-api-key-guide-steps" data-reskin="true">
            <li data-reskin="true">Enable IMAP in Gmail settings.</li>
            <li data-reskin="true">Generate an App Password named <strong>Gmail Unified</strong>.</li>
            <li data-reskin="true">Open the extension popup and complete onboarding.</li>
            <li data-reskin="true">Return here and press <strong>Check backend status</strong>, then <strong>Sync now</strong>.</li>
          </ol>
          <p class="rv-settings-copy" data-reskin="true" style="margin-top:8px;">
            If backend status shows a cold start, wait about 60 seconds and run Check backend status again.
          </p>
          <div class="rv-modal-actions" data-reskin="true" style="margin-top:8px;">
            <button type="button" class="rv-settings-open-gmail" data-reskin="true">Open Gmail IMAP settings</button>
            <button type="button" class="rv-settings-open-apppasswords" data-reskin="true">Open App Passwords</button>
            <button type="button" class="rv-settings-open-2fa" data-reskin="true">Open 2FA settings</button>
          </div>
        </section>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">Appearance</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <div class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">Theme</div>
              <div class="rv-theme-picker" data-reskin="true">
                <label class="rv-theme-option${currentTheme === THEME_DARK ? " is-active" : ""}" data-reskin="true">
                  <input type="radio" name="theme" value="${THEME_DARK}" ${currentTheme === THEME_DARK ? "checked" : ""} />
                  <span data-reskin="true">Dark</span>
                </label>
                <label class="rv-theme-option${currentTheme === THEME_LIGHT ? " is-active" : ""}" data-reskin="true">
                  <input type="radio" name="theme" value="${THEME_LIGHT}" ${currentTheme === THEME_LIGHT ? "checked" : ""} />
                  <span data-reskin="true">Light</span>
                </label>
              </div>
            </div>
          </div>
          <p class="rv-settings-copy" data-reskin="true">Theme changes apply immediately and autosave.</p>
        </section>
      </section>
    `;
  }

  function scheduleStartupWarmListRender(reason = "") {
    if (state.startupWarmListReady || state.startupWarmListScheduled) return;
    state.startupWarmListScheduled = true;
    scheduleDeferredWork(() => {
      state.startupWarmListScheduled = false;
      if (state.startupWarmListReady) return;
      state.startupWarmListReady = true;
      state.lastListSignature = "";
      state.lastObserverSignature = "";
      const root = getRoot();
      if (!(root instanceof HTMLElement)) return;
      if (state.currentView !== "list") return;
      logChatDebug("startup:warm-list-render", {
        reason: normalize(reason || "startup"),
        mailbox: mailboxCacheKey(activeMailbox()),
        hash: normalize(window.location.hash || "")
      }, { throttleKey: "startup-warm-list-render", throttleMs: 500 });
      renderList(root);
      renderSidebar(root);
    }, { delayMs: STARTUP_WARM_LIST_DELAY_MS, timeoutMs: 1800 });
  }

  function renderList(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;
    if (state.currentView === "thread" && isThreadHash(window.location.hash || "")) return;
    const route = parseListRoute(window.location.hash || state.lastListHash || "#inbox");
    state.triageFilter = "";

    if (!state.backendInitialWarmScheduled) {
      state.backendInitialWarmScheduled = true;
      refreshMailboxFromBackend(root, "inbox", { staleMs: 0 }).catch(() => {});
      refreshMailboxFromBackend(root, "sent", { staleMs: 0 }).catch(() => {});
    } else if (route.mailbox === "inbox" || route.mailbox === "sent") {
      refreshMailboxFromBackend(root, route.mailbox, { staleMs: 45000 }).catch(() => {});
    }
    const mailbox = mailboxCacheKey(route.mailbox);
    const currentVisible = Math.max(state.listChunkSize, Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize));
    const startupFastMode = STARTUP_PERF_MODE === "instant"
      ? (currentVisible <= state.listChunkSize && !state.startupWarmListReady)
      : !state.startupWarmListReady;
    const collectLimit = startupFastMode ? STARTUP_FAST_LIST_LIMIT : 500;
    const result = collectMessages(collectLimit);
    const liveMessages = result.items || [];
    const mergedCache = mergeMailboxCache(mailbox, liveMessages);
    const sourcePool = mailboxMessagesForList(mailbox, mergedCache.length >= liveMessages.length ? mergedCache : liveMessages);
    const allMessages = sourcePool.slice();
    const scanProgress = state.mailboxScanProgress[mailbox] || {};
    const scanMarker = `${scanProgress.pagesScanned || 0}:${scanProgress.cachedCount || mergedCache.length}:${scanProgress.lastUpdatedAt || 0}`;

    for (const msg of allMessages) {
      msg.triageLevel = "";
    }

    state.triageCounts = {};

    let messages = allMessages;
    if (state.currentServerId && route.mailbox === "inbox") {
      const server = state.servers.find((s) => s.id === state.currentServerId);
      if (server) messages = messages.filter((msg) => threadIdInServer(msg.threadId, server));
    }
    const filterLevel = "";
    const q = normalize(state.searchQuery || "").toLowerCase();
    if (q) {
      messages = messages.filter((msg) => {
        const s = normalize(msg.sender || "").toLowerCase();
        const subj = normalize(msg.subject || "").toLowerCase();
        const snip = normalize(msg.snippet || "").toLowerCase();
        return s.includes(q) || subj.includes(q) || snip.includes(q);
      });
    }

    let groupingMessages = mailbox === "inbox" ? chatScopeMessages(mailbox, liveMessages) : messages.slice();
    if (state.currentServerId && mailbox === "inbox") {
      const server = state.servers.find((s) => s.id === state.currentServerId);
      if (server) groupingMessages = groupingMessages.filter((msg) => threadIdInServer(msg.threadId, server));
    }
    if (q) {
      groupingMessages = groupingMessages.filter((msg) => {
        const s = normalize(msg.sender || "").toLowerCase();
        const subj = normalize(msg.subject || "").toLowerCase();
        const snip = normalize(msg.snippet || "").toLowerCase();
        return s.includes(q) || subj.includes(q) || snip.includes(q);
      });
    }

    const visibleLimit = currentVisible;
    const listSupportsContactGroups = ENABLE_CONTACT_GROUP_LIST && ENABLE_CONTACT_MERGE_MODE
      && (mailbox === mailboxCacheKey("inbox") || mailbox === mailboxCacheKey("sent"));
    const groupedMessages = listSupportsContactGroups
      ? groupMessagesByContact(groupingMessages)
      : [];
    const useGroups = listSupportsContactGroups && groupedMessages.length > 0;
    const visibleMessages = messages.slice(0, visibleLimit);
    const visibleGroups = groupedMessages.slice(0, visibleLimit);

    const signatureItems = useGroups
      ? visibleGroups.slice(0, 40).map((g) => `${g.contactKey}:${g.threadIds.length}:${(g.latestItem && g.latestItem.threadId) || ""}`)
      : visibleMessages.slice(0, 40).map((m) => `${m.threadId}:${m.triageLevel || "u"}:${m.unread ? "1" : "0"}`);
    let signatureHash = 0;
    for (const token of signatureItems) {
      for (let i = 0; i < token.length; i += 1) {
        signatureHash = (signatureHash * 31 + token.charCodeAt(i)) >>> 0;
      }
    }
    const listSignature = `${route.hash}|${useGroups ? "g" : "m"}|${messages.length}|${useGroups ? visibleGroups.length : visibleMessages.length}|${scanMarker}|rev:${Number(state.mailboxCacheRevision || 0)}|h:${signatureHash.toString(36)}`;
    const hasVisible = useGroups ? visibleGroups.length > 0 : visibleMessages.length > 0;
    if (
      state.lastListSignature === listSignature
      && !interactionsLocked()
      && hasVisible
      && state.lastListHadVisible
    ) {
      return;
    }
    state.lastListSignature = listSignature;
    state.lastListHadVisible = hasVisible;
    state.snippetByThreadId = state.snippetByThreadId || {};
    const hintMessages = useGroups
      ? visibleGroups.flatMap((g) => Array.isArray(g.items) ? g.items : [])
      : visibleMessages;
    for (const m of hintMessages) {
      const snippet = normalize(m && m.snippet) ? m.snippet : "";
      if (m && m.threadId && snippet) {
        for (const key of threadHintKeysForThread(m.threadId)) {
          state.snippetByThreadId[key] = snippet;
        }
      }
      rememberThreadNavigationHint(m.threadId, m.href, m.row);
    }

    list.innerHTML = "";

    if (state.lastSource !== result.source) {
      state.lastSource = result.source;
      logInfo(`Extractor source: ${result.source}`);
    }

    const renderedCount = useGroups ? visibleGroups.length : visibleMessages.length;
    if (state.lastRenderedCount !== renderedCount) {
      state.lastRenderedCount = renderedCount;
      logInfo(`Rendered ${renderedCount} messages`);
    }

    if (messages.length === 0) {
      const empty = document.createElement("div");
      empty.className = "rv-empty";
      empty.setAttribute("data-reskin", "true");
      empty.textContent = normalize(state.backendStatusMessage || "")
        || "No messages captured yet.";
      list.appendChild(empty);
      if ((route.mailbox === "inbox" || route.mailbox === "sent") && !state.fullScanRunning && !state.fullScanCompletedByMailbox[mailbox]) {
        state.fullScanStatus = route.mailbox === "sent" ? "Loading sent from backend…" : "Loading inbox from backend…";
        renderSidebar(root);
        refreshMailboxFromBackend(root, route.mailbox, { force: true, staleMs: 0 }).catch(() => {});
      }
      if (route.mailbox === "inbox" && state.currentView === "list" && !state.inboxHashNudged) {
        const hash = (window.location.hash || "").trim() || "#inbox";
        if (hash !== "#inbox" && hash.startsWith("#inbox")) {
          state.inboxHashNudged = true;
          state.lastListHash = "#inbox";
          window.location.hash = "#inbox";
          applyReskin();
        }
      }
      if (route.mailbox === "inbox" && !state.inboxEmptyRetryScheduled) {
        state.inboxEmptyRetryScheduled = true;
        logChatDebug("list-render:empty-retry", {
          mailbox: route.mailbox,
          hash: normalize(window.location.hash || ""),
          triageFilter: normalize(filterLevel || ""),
          messageCount: messages.length
        }, { throttleKey: `list-empty-retry:${route.mailbox}`, throttleMs: 10000 });
        setTimeout(() => {
          state.lastListSignature = "";
          applyReskin();
        }, 150);
      }
    } else {
      const displayItems = useGroups
        ? visibleGroups.map((g) => ({ type: "contact", group: g }))
        : visibleMessages.map((msg) => ({ type: "single", msg }));

      for (const entry of displayItems) {
        if (entry.type === "contact") {
          const g = entry.group;
          const latest = g.latestItem;
          if (!latest) continue;
          const item = document.createElement("button");
          item.type = "button";
          const anyUnread = g.items.some((m) => m.unread);
          const isActive = g.threadIds.includes(state.activeThreadId);
          item.className = "rv-item" + (anyUnread ? " is-unread" : "") + (isActive ? " is-active" : "");
          item.setAttribute("data-reskin", "true");
          const summaryText = getSummaryForMessage(latest);
          const previewText = normalize(latest.snippet || "") || "No preview";
          const hasSummary = Boolean(summaryText);
          const displayName = g.contactName + (g.threadIds.length > 1 ? ` (${g.threadIds.length})` : "");
          const initial = initialForSender(latest.sender);
          const previewLine = hasSummary ? summaryText : previewText;

          item.innerHTML = `
            <div class="rv-item-avatar" data-reskin="true" title="${escapeHtml(g.contactName)}">${escapeHtml(initial)}</div>
            <div class="rv-item-content" data-reskin="true">
              <div class="rv-item-top" data-reskin="true">
                <span class="rv-item-name" data-reskin="true">${escapeHtml(displayName)}</span>
                <span class="rv-item-meta" data-reskin="true">
                  <span class="rv-date" data-reskin="true">${escapeHtml(latest.date || "")}</span>
                  <button type="button" class="rv-item-server-btn" aria-label="Add or remove from server" data-reskin="true" data-thread-id="${escapeHtml(latest.threadId || "")}">⋯</button>
                </span>
              </div>
              <div class="rv-item-preview" data-reskin="true">${escapeHtml(previewLine.slice(0, 120))}${previewLine.length > 120 ? "…" : ""}</div>
            </div>
          `;

          item.setAttribute("data-contact-key", g.contactKey || "");
          item.setAttribute("data-thread-id", normalize((latest && latest.threadId) || ""));
          item.addEventListener("click", (e) => {
            if (e.target.closest(".rv-item-server-btn")) return;
            const dedupeContact = extractEmail(g.contactEmail || g.contactKey || "");
            const dedupeThread = normalize((latest && latest.threadId) || "");
            const dedupeMailbox = mailboxCacheKey((latest && latest.mailbox) || route.mailbox || "inbox");
            const dedupeSig = `${dedupeContact}|${dedupeThread}|${dedupeMailbox}`;
            const now = Date.now();
            if (state.lastOpenContactSignature === dedupeSig && now - Number(state.lastOpenContactAt || 0) < 600) {
              logEvent("click:deduped", { source: "list-contact-click", signature: dedupeSig });
              return;
            }
            state.lastOpenContactSignature = dedupeSig;
            state.lastOpenContactAt = now;
            lockInteractions(300);
            bumpInteractionEpoch("open-contact");
            setActiveTask("open-contact");
            const openDiagRunId = typeof diagStart === "function"
              ? diagStart("open", {
                ce: dedupeContact,
                tid: dedupeThread,
                mb: dedupeMailbox
              })
              : "";
            state.activeOpenDiagRunId = openDiagRunId;
            const perfTraceId = beginPerfTrace({
              type: "contact-open",
              reason: "list-click",
              contact: extractEmail(g.contactEmail || g.contactKey || "")
            });
            state.activeOpenPerfTraceId = perfTraceId;
            markPerfStage(perfTraceId, "click:start", {
              source: "list-contact-click"
            });
            state.lockListView = false;
            const openedV2 = openContactTimelineFromRowV2(latest, root, route, {
              seedRows: g.items,
              perfTraceId,
              diagRunId: openDiagRunId
            });
            if (openedV2) {
              return;
            }
            if (!openedV2) {
              if (openDiagRunId && typeof diagEnd === "function") {
                diagEnd(openDiagRunId, "aborted", {
                  rc: 8,
                  rs: "v2-open-unavailable"
                });
                if (normalize(state.activeOpenDiagRunId || "") === openDiagRunId) {
                  state.activeOpenDiagRunId = "";
                }
              }
              loadContactChat(g, root);
            }
          });
          list.appendChild(item);
        } else {
          const msg = entry.msg;
          const item = document.createElement("button");
          item.type = "button";
          item.className = "rv-item" + (msg.unread ? " is-unread" : "") + (state.activeThreadId === msg.threadId ? " is-active" : "");
          item.setAttribute("data-reskin", "true");
          item.setAttribute("data-thread-id", normalize(msg.threadId || ""));
          if (msg.unread) item.setAttribute("title", "Unread");

          const summaryText = getSummaryForMessage(msg);
          const previewText = normalize(msg.snippet || "") || "No preview";
          const hasSummary = Boolean(summaryText);
          const displayName = senderDisplayName(msg.sender) || normalize(msg.subject || "") || "No subject";
          const initial = initialForSender(msg.sender);
          const previewLine = hasSummary ? summaryText : previewText;

          item.innerHTML = `
            <div class="rv-item-avatar" data-reskin="true" title="${escapeHtml(msg.sender)}">${escapeHtml(initial)}</div>
            <div class="rv-item-content" data-reskin="true">
              <div class="rv-item-top" data-reskin="true">
                <span class="rv-item-name" data-reskin="true">${escapeHtml(displayName)}</span>
                <span class="rv-item-meta" data-reskin="true">
                  <span class="rv-date" data-reskin="true">${escapeHtml(msg.date || "")}</span>
                  <button type="button" class="rv-item-server-btn" aria-label="Add or remove from server" data-reskin="true" data-thread-id="${escapeHtml(msg.threadId || "")}">⋯</button>
                </span>
              </div>
              <div class="rv-item-preview" data-reskin="true">${escapeHtml(previewLine.slice(0, 120))}${previewLine.length > 120 ? "…" : ""}</div>
            </div>
          `;

          item.addEventListener("click", (e) => {
            if (e.target.closest(".rv-item-server-btn")) return;
            lockInteractions(300);
            bumpInteractionEpoch("open-thread");
            setActiveTask("open-thread");
            state.lockListView = false;
            if (ENABLE_CONTACT_MERGE_MODE && openContactChatFromRow(msg, root, route)) {
              return;
            }
            clearContactConversationState();
            state.currentView = "thread";
            state.threadExtractRetry = 0;
            state.activeThreadId = msg.threadId;
            state.currentThreadMailbox = mailboxCacheKey(msg.mailbox || route.mailbox || "inbox");
            rememberThreadNavigationHint(msg.threadId, msg.href, msg.row);
            state.currentThreadHintHref = normalize(msg.href || "") || lookupThreadHintHref(msg.threadId);
            state.currentThreadIdForReply = normalize(msg.threadId || "");
            logChatDebug("thread-open:start", {
              threadId: normalize(msg.threadId || ""),
              mailbox: state.currentThreadMailbox,
              hash: normalize(window.location.hash || ""),
              hintHref: state.currentThreadHintHref || ""
            }, { throttleKey: `thread-open-start:${normalize(msg.threadId || "")}`, throttleMs: 400 });
            const threadHash = msg.href && msg.href.includes("#")
              ? msg.href.slice(msg.href.indexOf("#"))
              : (msg.threadId ? `#${state.currentThreadMailbox}/${msg.threadId}` : "");
            if (threadHash && isThreadHash(threadHash)) {
              state.lastListHash = `#${mailboxCacheKey(route.mailbox || "inbox")}`;
              window.location.hash = threadHash;
            } else if (msg.threadId) {
              state.lastListHash = `#${mailboxCacheKey(route.mailbox || "inbox")}`;
              window.location.hash = `#${state.currentThreadMailbox}/${msg.threadId}`;
            }
            renderCurrentView(root);
            const ok = openThread(msg.threadId, msg.href, msg.row);
            if (!ok) {
              logWarn("Failed to open thread from custom view.", { threadId: msg.threadId });
              state.currentView = "list";
              state.activeThreadId = "";
              state.currentThreadIdForReply = "";
              state.currentThreadHintHref = "";
              state.currentThreadMailbox = "";
              clearContactConversationState();
              renderList(root);
              renderCurrentView(root);
              return;
            }
            logChatDebug("thread-open:ready", {
              threadId: normalize(msg.threadId || ""),
              mailbox: state.currentThreadMailbox,
              via: "openThread"
            }, { throttleKey: `thread-open-ready-immediate:${normalize(msg.threadId || "")}`, throttleMs: 300 });
            markThreadsReadLocally([msg.threadId], [msg.row]);
            setTimeout(() => {
              const latestRoot = getRoot();
              if (!(latestRoot instanceof HTMLElement)) return;
              if (state.currentView !== "thread") return;
              renderThread(latestRoot);
            }, 60);
          });

          list.appendChild(item);
        }
      }

      const summaryTargets = useGroups
        ? visibleGroups.map((g) => g.latestItem).filter(Boolean).slice(0, 30)
        : visibleMessages.slice(0, 30);
      queueSummariesForMessages(summaryTargets);

      const renderedCount = useGroups ? visibleGroups.length : visibleMessages.length;
      const totalCount = useGroups ? groupedMessages.length : messages.length;
      if (renderedCount < totalCount) {
        const loadMore = document.createElement("button");
        loadMore.type = "button";
        loadMore.className = "rv-list-more";
        loadMore.setAttribute("data-reskin", "true");
        loadMore.textContent = `Load more (${renderedCount}/${totalCount})`;
        list.appendChild(loadMore);
      }
    }

    if (route.mailbox === "inbox" || route.mailbox === "sent") {
      list.onscroll = () => {
        if (state.currentView !== "list") return;
        const nearBottom = list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_LOAD_MORE_DISTANCE_PX;
        const nearEndPrefetch =
          list.scrollTop + list.clientHeight >= list.scrollHeight - LIST_PREFETCH_DISTANCE_PX;
        if (!nearBottom && !nearEndPrefetch) return;
        const current = Number(state.listVisibleByMailbox[mailbox] || state.listChunkSize);
        const totalCount = useGroups ? groupedMessages.length : messages.length;
        if (nearBottom && current < totalCount) {
          state.listVisibleByMailbox[mailbox] = current + state.listChunkSize;
          const latestRoot = getRoot();
          if (latestRoot instanceof HTMLElement) renderList(latestRoot);
          return;
        }
        if (nearEndPrefetch && !state.fullScanCompletedByMailbox[mailbox] && !state.fullScanRunning) {
          if (route.mailbox === "inbox") {
            scheduleMailboxScanKick(root, { mailboxes: ["inbox", "sent"], delayMs: 0 });
          } else {
            scheduleMailboxScanKick(root, { mailboxes: ["sent"], delayMs: 0 });
          }
        }
      };
      if (!state.fullScanCompletedByMailbox[mailbox] && !state.fullScanRunning) {
        if (route.mailbox === "inbox") {
          scheduleMailboxScanKick(root, { mailboxes: ["inbox", "sent"], delayMs: 180 });
        } else {
          scheduleMailboxScanKick(root, { mailboxes: ["sent"], delayMs: 180 });
        }
      }
    } else {
      list.onscroll = null;
    }

    state.lastListRenderAt = Date.now();
    if (!state.firstStableListPaintAt && state.currentView === "list" && hasVisible) {
      state.firstStableListPaintAt = Date.now();
      emitSnapshot();
    }
    if (ENABLE_STARTUP_WARM_LIST_RENDER && startupFastMode && state.currentView === "list") {
      scheduleStartupWarmListRender("initial-list");
    }
    renderSidebar(root);
  }


    return {
      stripGmailHtmlToClean,
      sanitizeForShadow,
      SHADOW_EMBED_STYLE,
      renderThread,
      runTriageForInbox,
      renderCurrentView,
      renderSettings,
      scheduleStartupWarmListRender,
      renderList
    };
  };
})();
