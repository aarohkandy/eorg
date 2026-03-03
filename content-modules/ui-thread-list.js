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

  function renderThread(root) {
    const wrap = root.querySelector(".rv-thread-wrap");
    if (!(wrap instanceof HTMLElement)) return;
    const placeholder = root.querySelector(".rv-chat-placeholder");
    if (placeholder instanceof HTMLElement) placeholder.classList.add("is-hidden");
    wrap.style.display = "";

    if (ENABLE_CONTACT_MERGE_MODE && state.contactChatLoading) {
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
      sample: summarizeChatMessagesForDebug(messages, 8)
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
    await loadPersistedTriageMap();
    const force = Boolean(options.force);
    const processAll = Boolean(options.processAll);
    const oneByOneMode = Boolean(options.oneByOne);
    const source = normalize(options.source || "unknown");
    if (source === "auto" && Date.now() < state.triageAutoPauseUntil) {
      logTriageDebug("Skipped auto triage due to cooldown", {
        cooldownMsRemaining: Math.max(0, state.triageAutoPauseUntil - Date.now())
      });
      return;
    }
    if (source === "auto" && processAll && Date.now() - Number(state.lastAutoTriageAt || 0) < 25000) {
      return;
    }
    if (state.currentView !== "list") {
      logTriageDebug("Skipped triage run because current view is not list", {
        currentView: state.currentView
      });
      return;
    }
    if (activeMailbox() !== "inbox") {
      logTriageDebug("Skipped triage run because mailbox is not inbox", {
        mailbox: activeMailbox()
      });
      return;
    }
    if (!window.ReskinAI || !window.ReskinTriage) {
      logTriageDebug("Skipped triage run because AI or triage module is missing", {
        hasAI: Boolean(window.ReskinAI),
        hasTriage: Boolean(window.ReskinTriage)
      });
      return;
    }
    if (state.triageRunning) {
      logTriageDebug("Skipped triage run because another run is already in progress");
      return;
    }

    const settings = await loadSettingsCached();
    if (!settings || !settings.enabled || !settings.consentTriage) {
      state.triageStatus = "Enable triage + consent in Settings";
      logTriageDebug("Skipped triage run because settings are disabled or consent missing", {
        hasSettings: Boolean(settings),
        enabled: Boolean(settings && settings.enabled),
        consentTriage: Boolean(settings && settings.consentTriage)
      });
      return;
    }
    logEvent("triage:start", { source, processAll, batchSize: settings.batchSize });
    logTriageDebug("Starting inbox triage run", {
      source,
      force,
      processAll,
      oneByOneMode,
      batchSize: settings.batchSize,
      provider: settings.provider,
      model: settings.model
    });

    const listRoot = getRoot();
    if (!(listRoot instanceof HTMLElement)) return;

    if (processAll && !state.fullScanCompletedByMailbox[mailboxCacheKey("inbox")] && !state.fullScanRunning) {
      state.triageStatus = "Scanning full inbox before triage...";
      renderSidebar(listRoot);
      await runFullMailboxScan(listRoot, { mailboxes: ["inbox"] });
    }

    const attempted = new Set();
    let totalApplied = 0;
    let totalScored = 0;
    let batchIndex = 0;
    let haltedOnEmptyAI = false;
    let haltedOnDuplicateQueue = false;
    let consecutiveApplyFailures = 0;
    const maxBatches = processAll ? 1200 : 1;
    state.triageRunning = true;
    if (source === "auto" && processAll) {
      state.lastAutoTriageAt = Date.now();
    }

    try {
      while (batchIndex < maxBatches) {
        const sourceItems = processAll
          ? getMailboxMessages("inbox", 6000)
          : getMailboxMessages("inbox", 200);
        const result = {
          items: sourceItems,
          source: processAll ? "cache" : "live"
        };
        logTriageDebug("Collected messages for triage pass", {
          extracted: result.items.length,
          source: result.source || "unknown"
        });
        const candidates = [];
        for (const msg of result.items) {
          const level = getTriageLevelForMessage(msg);
          msg.triageLevel = level;
          if (!level && !attempted.has(msg.threadId)) candidates.push(msg);
        }

        state.triageUntriagedCount = candidates.length;
        if (candidates.length === 0) {
          logTriageDebug("No untriaged inbox candidates found", {
            scanned: result.items.length
          });
          break;
        }

        const batchSize = oneByOneMode ? 1 : settings.batchSize;
        const batch = candidates.slice(0, batchSize);
        const queueKey = batch.map((m) => m.threadId).join(",");
        if (!force && !processAll && queueKey && queueKey === state.triageQueueKey) {
          logTriageDebug("Skipping duplicate triage queue", { queueKey });
          haltedOnDuplicateQueue = true;
          break;
        }
        state.triageQueueKey = queueKey;
        logTriageDebug("Prepared triage batch", {
          batchIndex: batchIndex + 1,
          batchSize: batch.length,
          candidatesRemaining: candidates.length,
          threadIds: batch.map((msg) => msg.threadId)
        });

        state.triageStatus = processAll
          ? `Triaging batch ${batchIndex + 1}: ${batch.length} of ${candidates.length} remaining...`
          : `Triaging ${batch.length} of ${candidates.length}...`;
        if (oneByOneMode) {
          const current = batch[0];
          state.triageStatus = processAll
            ? `Triaging 1-by-1 (${batchIndex + 1}): ${current ? current.subject || current.threadId : "message"}`
            : `Triaging 1 message...`;
        }

        let scored = [];
        try {
          scored = await window.ReskinAI.triageBatch(batch, settings);
        } catch (error) {
          const msg = normalize(error && error.message ? error.message : String(error || ""));
          const isRateLimit = msg.includes("429") || msg.toLowerCase().includes("rate limit");
          if (isRateLimit && processAll) {
            const waitMs = Number(error && error.retryAfterMs) > 0 ? Number(error.retryAfterMs) : 65000;
            state.triageStatus = `Rate limited. Waiting ${Math.ceil(waitMs / 1000)}s, then continuing...`;
            renderSidebar(listRoot);
            await new Promise((resolve) => setTimeout(resolve, waitMs));
            state.triageStatus = "Resuming triage...";
            continue;
          }
          throw error;
        }
        for (const msg of batch) attempted.add(msg.threadId);
        totalScored += batch.length;
        logTriageDebug("AI returned scored items", {
          requested: batch.length,
          returned: Array.isArray(scored) ? scored.length : 0,
          scored
        });
        if (!Array.isArray(scored) || scored.length === 0) {
          state.triageStatus = "AI returned no labels. Please retry or switch provider in Settings.";
          state.triageLastFailureStatus = state.triageStatus;
          state.triageQueueKey = "";
          haltedOnEmptyAI = true;
          logTriageDebug("Stopping triage because AI returned zero parsed labels", {
            requested: batch.length
          });
          break;
        }
        for (const item of scored) {
          if (!item || !item.urgency) continue;
          const mappedByThread = item.threadId
            ? batch.find((msg) => msg.threadId === item.threadId)
            : null;
          const mappedByIndex =
            typeof item.i === "number" && item.i >= 0 && item.i < batch.length ? batch[item.i] : null;
          const targetMessage = mappedByThread || mappedByIndex || null;
          const mappedThreadId = (targetMessage && targetMessage.threadId) || item.threadId || "";
          if (mappedThreadId) {
            triageLocalSet(mappedThreadId, item.urgency);
          }

          const ok = window.ReskinTriage && typeof window.ReskinTriage.applyLabelToMessage === "function"
            ? await window.ReskinTriage.applyLabelToMessage(
              targetMessage || { threadId: item.threadId, href: "", row: null },
              item.urgency
            )
            : await window.ReskinTriage.applyLabelToThread(item.threadId, item.urgency);
          logTriageDebug("Label apply attempt finished", {
            threadId: (targetMessage && targetMessage.threadId) || item.threadId || "",
            urgency: item.urgency,
            byThreadId: Boolean(mappedByThread),
            byIndex: Boolean(mappedByIndex),
            ok
          });
          if (ok) {
            totalApplied += 1;
            consecutiveApplyFailures = 0;
          } else {
            consecutiveApplyFailures += 1;
          }
        }

        if (consecutiveApplyFailures >= 8) {
          if (processAll) {
            state.triageStatus =
              "Gmail label controls were unstable. Retrying with a fresh pass...";
            logTriageDebug("Backing off triage after repeated apply failures", {
              consecutiveApplyFailures
            });
            consecutiveApplyFailures = 0;
            await sleep(1200);
            continue;
          }
          state.triageStatus =
            "Gmail label UI could not be controlled. Stopped after repeated failures.";
          state.triageLastFailureStatus = state.triageStatus;
          logTriageDebug("Halting triage after repeated apply failures", {
            consecutiveApplyFailures
          });
          break;
        }

        batchIndex += 1;
        if (!processAll) break;
      }
      if (haltedOnEmptyAI) {
        // Preserve the explicit user-facing AI failure status set above.
      } else if (haltedOnDuplicateQueue) {
        state.triageStatus = state.triageLastFailureStatus || "Triage waiting for new inbox changes.";
      } else if (batchIndex === 0) {
        state.triageStatus = "Inbox triage is up to date";
      } else if (totalScored > 0 && totalApplied === 0) {
        state.triageStatus = `AI triaged ${totalScored} messages locally. Gmail label sync failed.`;
      } else if (processAll) {
        state.triageStatus = `Triage complete: ${totalApplied} labels applied across ${batchIndex} batches`;
      } else {
        state.triageStatus = `Applied ${totalApplied} triage labels`;
      }
      logEvent("triage:done", { batchIndex, totalScored, totalApplied });
      logTriageDebug("Triage run finished", {
        batchIndex,
        totalScored,
        totalApplied,
        status: state.triageStatus
      });
    } catch (error) {
      const message = error && error.message ? error.message : "triage failed";
      state.triageStatus = `Triage unavailable: ${message.slice(0, 120)}`;
      state.triageLastFailureStatus = state.triageStatus;
      state.triageQueueKey = "";
      state.triageAutoPauseUntil = Date.now() + 45000;
      logEvent("triage:failed", { message: (error && error.message) || "unknown" });
      logWarn("Inbox triage run failed", error);
      logTriageDebug("Triage run failed", {
        message,
        stack: error && error.stack ? String(error.stack) : ""
      });
    } finally {
      state.triageRunning = false;
      const root = getRoot();
      if (root instanceof HTMLElement && state.currentView === "list") {
        renderCurrentView(root);
      }
    }
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

    const settings = state.settingsCache || {
      provider: "openrouter",
      apiKey: "",
      apiKeys: [],
      theme: THEME_DARK,
      model: "openrouter/free",
      enabled: true,
      consentTriage: false,
      batchSize: 25,
      timeoutMs: 30000,
      retryCount: 2,
      retryBackoffMs: 1200,
      maxInputChars: 2200
    };

    if (!state.settingsCache && !state.settingsLoadFailed && !state.settingsLoadInFlight) {
      loadSettingsCached().then(() => {
        if (state.currentView !== "settings") return;
        const latestRoot = getRoot();
        if (!(latestRoot instanceof HTMLElement)) return;
        const latestWrap = latestRoot.querySelector(".rv-settings-wrap");
        if (!(latestWrap instanceof HTMLElement)) return;
        renderSettings(latestRoot);
      });
    }

    const apiKey = normalize(settings.apiKey || "");
    const selectedProvider = normalize(settings.provider || "openrouter").toLowerCase();
    const currentTheme = normalizeTheme(settings.theme);
    const needsApiKey = providerNeedsApiKey(selectedProvider);
    const apiGuide = buildApiKeyGuide(selectedProvider);

    wrap.innerHTML = `
      <section class="rv-settings-view" data-reskin="true">
        <h2 class="rv-settings-title" data-reskin="true">Mailita Settings</h2>
        <p class="rv-settings-copy" data-reskin="true">Inbox-only triage with autosave. Already-labeled emails are never re-triaged.</p>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">API</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <label class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">Provider</div>
              <select name="provider" class="rv-field" data-reskin="true">
                <option value="openrouter" ${settings.provider === "openrouter" ? "selected" : ""}>OpenRouter (free)</option>
                <option value="groq" ${settings.provider === "groq" ? "selected" : ""}>Groq (free)</option>
                <option value="ollama" ${settings.provider === "ollama" ? "selected" : ""}>Local Ollama</option>
              </select>
            </label>
            <label class="rv-settings-card" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">API Key</div>
              <input name="apiKey" class="rv-field" data-reskin="true" type="password" value="${escapeHtml(apiKey)}" placeholder="${escapeHtml(apiKeyPlaceholderForProvider(settings.provider || "openrouter"))}" />
            </label>
          </div>
          ${needsApiKey ? `
            <div class="rv-api-permission-inline" data-reskin="true">
              <div class="rv-settings-copy" data-reskin="true">Need help getting a ${escapeHtml(apiGuide.label)} key?</div>
              <button type="button" class="rv-api-key-permission" data-reskin="true">Show Key Setup Help</button>
            </div>
          ` : ""}
          ${needsApiKey && state.apiKeyGuideGranted ? `
            <div class="rv-api-key-guide" data-reskin="true">
              <div class="rv-settings-label" data-reskin="true">${escapeHtml(apiGuide.label)} key setup</div>
              <ol class="rv-api-key-guide-steps" data-reskin="true">
                ${apiGuide.steps.map((step) => `<li data-reskin="true">${escapeHtml(step)}</li>`).join("")}
              </ol>
              <a class="rv-api-key-guide-link" data-reskin="true" href="${escapeHtml(apiGuide.href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(apiGuide.linkText)}</a>
            </div>
          ` : ""}
        </section>

        <section class="rv-settings-section" data-reskin="true">
          <div class="rv-settings-section-title" data-reskin="true">Triage</div>
          <div class="rv-settings-grid rv-settings-grid-form" data-reskin="true">
            <label class="rv-settings-card rv-settings-consent" data-reskin="true">
              <input type="checkbox" name="consentTriage" class="rv-field" data-reskin="true" ${settings.consentTriage ? "checked" : ""} />
              <span class="rv-settings-label" data-reskin="true">I consent to AI triage</span>
            </label>
          </div>
          <p class="rv-settings-copy" data-reskin="true">Allow sending inbox content to your chosen AI provider to label categories (Respond, Should read, News, Not important, Spam). Required for triage and Ask Inbox.</p>
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

        ${state.showApiKeyPermissionModal ? `
          <div class="rv-modal-backdrop" data-reskin="true">
            <div class="rv-modal" data-reskin="true">
              <h3 class="rv-modal-title" data-reskin="true">Allow API Key Setup Help?</h3>
              <p class="rv-modal-copy" data-reskin="true">If you allow this, we will show quick steps and direct links to create your provider API key.</p>
              <div class="rv-modal-actions" data-reskin="true">
                <button type="button" class="rv-api-permission-allow" data-reskin="true">Allow</button>
                <button type="button" class="rv-api-permission-decline" data-reskin="true">Not now</button>
              </div>
            </div>
          </div>
        ` : ""}
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
    if (route.mailbox !== "inbox") {
      state.triageFilter = "";
    } else if (hashHasTriageParam(window.location.hash || "")) {
      state.triageFilter = route.triage;
    } else {
      state.triageFilter = "";
    }

    if (route.mailbox === "inbox" && !state.settingsCache && !state.settingsLoadInFlight && window.ReskinAI) {
      loadSettingsCached().then(() => applyReskin());
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
      msg.triageLevel = getTriageLevelForMessage(msg);
    }

    state.triageCounts = window.ReskinTriage && typeof window.ReskinTriage.countLevels === "function"
      ? window.ReskinTriage.countLevels(allMessages)
      : { respond: 0, read: 0, news: 0, notImportant: 0, spam: 0 };

    let messages = allMessages;
    if (state.currentServerId && route.mailbox === "inbox") {
      const server = state.servers.find((s) => s.id === state.currentServerId);
      if (server) messages = messages.filter((msg) => threadIdInServer(msg.threadId, server));
    }
    const filterLevel = route.mailbox === "inbox"
      ? normalize(state.triageFilter || route.triage || "").toLowerCase()
      : "";
    if (route.mailbox === "inbox" && TRIAGE_LEVELS.includes(filterLevel)) {
      messages = messages.filter((msg) => msg.triageLevel === filterLevel);
    }
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

    const showConsentBanner = route.mailbox === "inbox" && state.settingsCache && !state.settingsCache.consentTriage && !state.consentBannerDismissed;
    if (showConsentBanner) {
      const banner = document.createElement("div");
      banner.className = "rv-consent-banner";
      banner.setAttribute("data-reskin", "true");
      banner.innerHTML = `
        <div class="rv-consent-banner-inner" data-reskin="true">
          <p class="rv-consent-banner-title" data-reskin="true">AI triage is off</p>
          <p class="rv-consent-banner-copy" data-reskin="true">Triage and Ask Inbox need your consent to send inbox content to your chosen AI provider. Enable it in Settings to run priority labels and Q&amp;A.</p>
          <div class="rv-consent-banner-actions" data-reskin="true">
            <button type="button" class="rv-consent-banner-open-settings" data-reskin="true">Open Settings</button>
            <button type="button" class="rv-consent-banner-dismiss" data-reskin="true">Dismiss</button>
          </div>
        </div>
      `;
      list.appendChild(banner);
      const openBtn = banner.querySelector(".rv-consent-banner-open-settings");
      const dismissBtn = banner.querySelector(".rv-consent-banner-dismiss");
      if (openBtn) {
        openBtn.addEventListener("click", () => {
          state.settingsPinned = true;
          state.currentView = "settings";
          window.location.hash = "#app-settings";
          applyReskin();
        });
      }
      if (dismissBtn) {
        dismissBtn.addEventListener("click", () => {
          state.consentBannerDismissed = true;
          applyReskin();
        });
      }
    }

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
      empty.textContent = TRIAGE_LEVELS.includes(filterLevel)
        ? `No ${triageLabelText(filterLevel)} inbox messages captured yet.`
        : "No messages captured yet.";
      list.appendChild(empty);
      if ((route.mailbox === "inbox" || route.mailbox === "sent") && !state.fullScanRunning && !state.fullScanCompletedByMailbox[mailbox]) {
        state.fullScanStatus = route.mailbox === "sent" ? "Loading sent…" : "Loading inbox…";
        renderSidebar(root);
        if (state.startupWarmListReady) {
          if (route.mailbox === "inbox") {
            scheduleMailboxScanKick(root, { mailboxes: ["inbox", "sent"], delayMs: 1400 });
          } else {
            scheduleMailboxScanKick(root, { mailboxes: ["sent"], delayMs: 1400 });
          }
        }
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
        }, { throttleKey: `list-empty-retry:${route.mailbox}`, throttleMs: 1400 });
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
          const level = latest.triageLevel || (g.items.some((m) => m.triageLevel === "respond") ? "respond" : "");
          const badgeClass = level ? `is-${level}` : "is-untriaged";
          const badgeText = level ? triageLabelText(level) : "Untriaged";
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
              <div class="rv-triage-row" data-reskin="true">
                <span class="rv-badge ${badgeClass}" data-reskin="true">${escapeHtml(badgeText)}</span>
              </div>
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
              perfTraceId
            });
            if (openedV2) {
              return;
            }
            if (!openedV2) {
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

          const level = msg.triageLevel;
          const badgeClass = level ? `is-${level}` : "is-untriaged";
          const badgeText = level ? triageLabelText(level) : "Untriaged";
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
              <div class="rv-triage-row" data-reskin="true">
                <span class="rv-badge ${badgeClass}" data-reskin="true">${escapeHtml(badgeText)}</span>
              </div>
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
      if (ENABLE_AI_BACKGROUND_AUTOMATION && route.mailbox === "inbox") {
        runTriageForInbox({ force: false, processAll: true, source: "auto" });
      }
    } else {
      list.onscroll = null;
    }

    state.lastListRenderAt = Date.now();
    if (!state.firstStableListPaintAt && state.currentView === "list" && hasVisible) {
      state.firstStableListPaintAt = Date.now();
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
