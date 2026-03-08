(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createContactChatHydrationApi = function createContactChatHydrationApi(deps = {}) {
    const {
      STARTUP_PERF_MODE,
      ENABLE_DISCOVERY_ON_OPEN,
      CONTACT_HYDRATION_MAX_CONCURRENCY,
      THREAD_BODY_PLACEHOLDER,
      state,
      normalize,
      extractEmail,
      canonicalThreadId,
      normalizeMessageDateToken,
      hashString,
      normalizeThreadMessagesForChat,
      messageBelongsToConversation,
      activeConversationContext,
      summarizeChatMessagesForDebug,
      logChatDebug,
      logTimed,
      logEvent,
      diag,
      diagFail,
      diagStart,
      diagEnd,
      logWarn,
      mailboxCacheKey,
      parseListRoute,
      sanitizeListHash,
      detectCurrentUserEmail,
      expandContactGroupWithCachedCounterparts,
      rememberThreadNavigationHint,
      lookupThreadHintHref,
      markThreadsReadLocally,
      senderDisplayName,
      conversationKeyFromContact,
      isContactTimelineV2Enabled,
      scheduleMailboxScanKick,
      bumpInteractionEpoch,
      hydrateThreadFromPrintView,
      getThreadCache,
      hexThreadIdForThread,
      choosePreferredSender,
      applySnippetFallbackToMessages,
      hasMeaningfulCapturedMessages,
      isUseful,
      safeThreadFallbackText,
      markPerfStage,
      endPerfTrace,
      getRoot,
      getRenderList,
      getRenderCurrentView,
      getRenderThread,
      getKickContactDiscovery,
      scheduleHeavyWorkAfterIdle
    } = deps;

    const resolveRenderList = () => (
      typeof getRenderList === "function" ? getRenderList() : null
    );
    const resolveRenderCurrentView = () => (
      typeof getRenderCurrentView === "function" ? getRenderCurrentView() : null
    );
    const resolveRenderThread = () => (
      typeof getRenderThread === "function" ? getRenderThread() : null
    );
    const resolveKickContactDiscovery = () => (
      typeof getKickContactDiscovery === "function" ? getKickContactDiscovery() : null
    );
    const SENT_PROBE_IDLE_MS = 120;
    const SENT_PROBE_TIMEOUT_MS = 3200;
    const SENT_PROBE_MAX_THREAD_IDS = 3;
    const SENT_PROBE_TTL_MS = 10 * 60 * 1000;
    const SENT_PROBE_RECENCY_FILTER = "newer_than:5y";

    function gmailAccountIndex() {
      const m = window.location.pathname.match(/\/mail\/u\/(\d+)\//);
      return m ? m[1] : "0";
    }

    function toCanonicalThreadIdFromToken(value) {
      const raw = normalize(value || "");
      if (!raw) return "";
      const canonical = canonicalThreadId(raw);
      if (canonical) return canonical;
      const thMatch = raw.match(/[?&]th=([0-9a-f]{8,})/i);
      const threadFMatch = raw.match(/thread-f:([0-9]{6,})/i);
      const fMatch = raw.match(/\bf:([0-9]{6,})\b/i);
      const bareHex = raw.replace(/^#/, "");
      if (threadFMatch && threadFMatch[1]) return `f:${threadFMatch[1]}`;
      if (fMatch && fMatch[1]) return `f:${fMatch[1]}`;
      const hexToken = (thMatch && thMatch[1]) || (/^[0-9a-f]{8,}$/i.test(bareHex) ? bareHex : "");
      if (hexToken) {
        try {
          return `f:${BigInt(`0x${hexToken}`).toString()}`;
        } catch (_) {
          return "";
        }
      }
      return "";
    }

    function dedupeCanonicalThreadIds(values, limit = SENT_PROBE_MAX_THREAD_IDS) {
      const out = [];
      const seen = new Set();
      for (const value of Array.isArray(values) ? values : []) {
        const threadId = toCanonicalThreadIdFromToken(value);
        if (!threadId || seen.has(threadId)) continue;
        seen.add(threadId);
        out.push(threadId);
        if (out.length >= Math.max(1, Number(limit) || SENT_PROBE_MAX_THREAD_IDS)) break;
      }
      return out;
    }

    function extractThreadIdsFromQueryHtml(html, options = {}) {
      const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
      const collected = [];
      const contactNeedle = normalize(options.contactEmail || "").toLowerCase();
      const push = (candidate) => {
        const threadId = toCanonicalThreadIdFromToken(candidate);
        if (threadId) collected.push(threadId);
      };
      for (const row of doc.querySelectorAll("[data-thread-id], [data-legacy-thread-id], tr[role=\"row\"], tr.zA, [role=\"row\"]")) {
        const rowText = normalize(row && row.textContent ? row.textContent : "").toLowerCase();
        if (contactNeedle && rowText && !rowText.includes(contactNeedle)) continue;
        push(row.getAttribute("data-thread-id"));
        push(row.getAttribute("data-legacy-thread-id"));
        for (const link of row.querySelectorAll("a[href]")) {
          const href = normalize(link.getAttribute("href") || "");
          if (!href) continue;
          if (!(href.includes("th=") || href.includes("thread-f:") || href.includes("f:"))) continue;
          push(href);
        }
      }
      return dedupeCanonicalThreadIds(collected, SENT_PROBE_MAX_THREAD_IDS);
    }

    async function fetchThreadIdsForSearchQuery(query, options = {}) {
      const timeoutMs = Math.max(500, Number(options.timeoutMs || SENT_PROBE_TIMEOUT_MS));
      const isActive = typeof options.isActive === "function" ? options.isActive : () => true;
      const accountIndex = gmailAccountIndex();
      const encoded = encodeURIComponent(String(query || ""));
      const candidates = [
        `${window.location.origin}/mail/u/${accountIndex}/?ui=2&search=query&q=${encoded}`
      ];
      const timeoutAt = Date.now() + timeoutMs;
      let lastError = null;
      for (const url of candidates) {
        if (!isActive()) {
          const staleError = new Error("sent-probe-stale-context");
          staleError.reasonCode = 1;
          throw staleError;
        }
        const remainingMs = Math.max(120, timeoutAt - Date.now());
        if (remainingMs <= 120) {
          const timeoutError = new Error("sent-probe-timeout");
          timeoutError.reasonCode = 3;
          throw timeoutError;
        }
        const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
        const timer = setTimeout(() => {
          if (controller) controller.abort();
        }, remainingMs);
        try {
          const response = await fetch(url, {
            credentials: "include",
            signal: controller ? controller.signal : undefined
          });
          if (!response.ok) {
            const err = new Error(`sent-probe-fetch-http-${response.status}`);
            err.reasonCode = 5;
            lastError = err;
            continue;
          }
          const html = await response.text();
          const threadIds = extractThreadIdsFromQueryHtml(html, {
            contactEmail: options.contactEmail || ""
          });
          if (threadIds.length > 0) return threadIds;
        } catch (error) {
          if (error && error.name === "AbortError") {
            const timeoutError = new Error("sent-probe-timeout");
            timeoutError.reasonCode = 3;
            throw timeoutError;
          }
          const nextError = error instanceof Error ? error : new Error(String(error || "sent-probe-fetch-failed"));
          if (nextError.reasonCode == null) nextError.reasonCode = 5;
          lastError = nextError;
        } finally {
          clearTimeout(timer);
        }
      }
      if (lastError) throw lastError;
      return [];
    }
  function contactMessageSourceRank(message) {
    const source = normalize((message && (message.source || message.sourceType)) || "").toLowerCase();
    if (source === "gmail_dom" || source === "captured") return 0;
    if (source === "cache" || source === "fallback") return 1;
    if (source === "seeded") return 2;
    if (source === "inferred" || source === "optimistic") return 3;
    return 4;
  }

  function resolveHydrationThreadFallback(context = {}) {
    const ctxThreadId = canonicalThreadId(context.threadId || "") || normalize(context.threadId || "");
    if (ctxThreadId) return ctxThreadId;
    const stateThreadId = canonicalThreadId(
      state.currentThreadIdForReply
      || state.activeThreadId
      || (Array.isArray(state.contactThreadIds) ? state.contactThreadIds[0] : "")
      || ""
    ) || normalize(
      state.currentThreadIdForReply
      || state.activeThreadId
      || (Array.isArray(state.contactThreadIds) ? state.contactThreadIds[0] : "")
      || ""
    );
    return stateThreadId || "";
  }

  function normalizeHydrationMessageForConversation(message, context = {}) {
    const msg = message && typeof message === "object" ? { ...message } : {};
    const conversationContext = activeConversationContext(context);
    const activeAccountEmail = extractEmail(
      conversationContext.activeAccountEmail
      || state.activeAccountEmail
      || detectCurrentUserEmail()
      || ""
    );
    const contactEmail = extractEmail(
      conversationContext.contactEmail
      || state.activeContactEmail
      || ""
    );
    const mailbox = mailboxCacheKey(msg.mailbox || msg.mailboxHint || "");
    const outgoingHint = Boolean(
      msg.isSelf === true
      || normalize(msg.direction || "") === "outgoing"
      || mailbox === "sent"
    );
    if (!outgoingHint) return msg;
    msg.isSelf = true;
    if (!extractEmail(msg.senderEmail || "")) {
      msg.senderEmail = activeAccountEmail || "";
    }
    if (!normalize(msg.sender || "")) {
      msg.sender = msg.senderEmail || "You";
    }
    msg.direction = "outgoing";
    const recipientEmails = Array.isArray(msg.recipientEmails)
      ? msg.recipientEmails.map((value) => extractEmail(value || "")).filter(Boolean)
      : [];
    if (recipientEmails.length === 0 && contactEmail) recipientEmails.push(contactEmail);
    if (recipientEmails.length > 0) msg.recipientEmails = Array.from(new Set(recipientEmails));
    const participants = Array.from(new Set([
      extractEmail(msg.senderEmail || ""),
      ...(Array.isArray(msg.recipientEmails) ? msg.recipientEmails : []),
      ...(
        Array.isArray(msg.participants)
          ? msg.participants.map((value) => extractEmail(value || "")).filter(Boolean)
          : []
      )
    ].filter(Boolean)));
    if (participants.length > 0) msg.participants = participants;
    if (!normalize(msg.mailbox || "")) msg.mailbox = mailboxCacheKey("sent");
    if (!normalize(msg.mailboxHint || "")) msg.mailboxHint = mailboxCacheKey("sent");
    const normalizedThreadId = canonicalThreadId(msg.threadId || "") || normalize(msg.threadId || "");
    if (!normalizedThreadId) {
      const fallbackThreadId = resolveHydrationThreadFallback(context);
      if (fallbackThreadId) msg.threadId = fallbackThreadId;
    }
    return msg;
  }

  function isOutgoingHydrationMessage(message) {
    if (message && message.isSelf === true) return true;
    return normalize(message && message.direction || "") === "outgoing";
  }

  function mergeContactMessagesByThread(threadIds, byThread, context = {}) {
    const conversationContext = activeConversationContext(context);
    const seenMessageIds = new Set();
    const seenFallbackKeys = new Set();
    const merged = [];
    const perThreadDebug = [];
    let filteredOutByConversation = 0;
    let dedupByMessageId = 0;
    let dedupByFallback = 0;
    const orderedThreadIds = (Array.isArray(threadIds) ? threadIds : [])
      .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
      .filter(Boolean);
    for (let threadOrder = 0; threadOrder < orderedThreadIds.length; threadOrder += 1) {
      const threadId = orderedThreadIds[threadOrder];
      const source = byThread.get(threadId) || byThread.get(normalize(threadId || ""));
      const sourceMessages = Array.isArray(source) ? source : [];
      const normalizedSource = normalizeThreadMessagesForChat(
        sourceMessages.map((message) => normalizeHydrationMessageForConversation(message, conversationContext)),
        threadId,
        conversationContext
      );
      const normalizedThreadMessages = normalizedSource
        .filter((message) => messageBelongsToConversation(message, conversationContext));
      const filteredOutCount = Math.max(0, normalizedSource.length - normalizedThreadMessages.length);
      filteredOutByConversation += filteredOutCount;
      if (perThreadDebug.length < 12) {
        perThreadDebug.push({
          threadId,
          sourceCount: sourceMessages.length,
          normalizedCount: normalizedSource.length,
          afterConversationFilter: normalizedThreadMessages.length,
          filteredOutCount
        });
      }
      if (normalizedThreadMessages.length === 0) continue;
      const hasCapturedCanonical = normalizedThreadMessages.some(
        (msg) => !msg.isSeededPlaceholder && msg.sourceType !== "seeded"
      );
      for (let messageOrdinal = 0; messageOrdinal < normalizedThreadMessages.length; messageOrdinal += 1) {
        const message = normalizedThreadMessages[messageOrdinal];
        if (!message || typeof message !== "object") continue;
        if (hasCapturedCanonical && message.isSeededPlaceholder) continue;
        const messageId = normalize(message.messageId || message.dataMessageId || "");
        if (messageId && seenMessageIds.has(messageId)) {
          dedupByMessageId += 1;
          continue;
        }
        const bodyHash = hashString(normalize(message.cleanBodyText || "").toLowerCase());
        const stableSourceIndex = Number.isFinite(Number(message.sourceIndex))
          ? Number(message.sourceIndex)
          : messageOrdinal;
        const fallbackKey = [
          canonicalThreadId(threadId),
          normalize(message.senderEmail || message.sender || "").toLowerCase(),
          Number(message.timestampMs || 0),
          normalizeMessageDateToken(message.date || ""),
          normalize(message.direction || ""),
          bodyHash,
          stableSourceIndex
        ].join("|");
        if (!messageId && seenFallbackKeys.has(fallbackKey)) {
          dedupByFallback += 1;
          continue;
        }
        if (messageId) seenMessageIds.add(messageId);
        else seenFallbackKeys.add(fallbackKey);
        merged.push({
          ...message,
          threadId,
          __order: merged.length,
          __threadOrder: threadOrder,
          __sourceRank: contactMessageSourceRank(message),
          __sourceIndex: stableSourceIndex
        });
      }
    }
    const finalMessages = merged
      .sort((a, b) => {
        const ta = Number(a.timestampMs || 0);
        const tb = Number(b.timestampMs || 0);
        if (ta !== tb) return ta - tb;
        if (a.__sourceRank !== b.__sourceRank) return a.__sourceRank - b.__sourceRank;
        if (a.__threadOrder === b.__threadOrder && a.__sourceIndex !== b.__sourceIndex) {
          return a.__sourceIndex - b.__sourceIndex;
        }
        return Number(a.__order || 0) - Number(b.__order || 0);
      })
      .map(({ __order, __threadOrder, __sourceIndex, __sourceRank, ...rest }) => rest);
    const mergeMetrics = {
      conversationKey: conversationContext.conversationKey || "",
      contactEmail: conversationContext.contactEmail || "",
      activeAccountEmail: conversationContext.activeAccountEmail || "",
      threadCount: orderedThreadIds.length,
      mergedCount: finalMessages.length,
      filteredOutByConversation,
      dedupByMessageId,
      dedupByFallback,
      threadStats: perThreadDebug,
      sample: summarizeChatMessagesForDebug(finalMessages, 8)
    };
    state.lastContactMergeMetrics = mergeMetrics;
    logChatDebug("contact-merge:final", mergeMetrics, {
      throttleKey: `contact-merge-final:${conversationContext.conversationKey || conversationContext.contactEmail || "unknown"}`,
      throttleMs: 420
    });
    return finalMessages;
  }

  function buildSeededMessagesByThread(group) {
    const byThread = new Map();
    if (!group || !Array.isArray(group.threadIds)) return byThread;
    const fallbackSender = group.contactName || "Unknown sender";
    const itemByThread = new Map();
    for (const item of Array.isArray(group.items) ? group.items : []) {
      const tid = canonicalThreadId(item && item.threadId) || normalize(item && item.threadId);
      if (!tid || itemByThread.has(tid)) continue;
      itemByThread.set(tid, item);
    }
    for (const threadId of group.threadIds) {
      const tid = canonicalThreadId(threadId) || normalize(threadId);
      if (!tid) continue;
      const item = itemByThread.get(tid);
      const sender = isUseful(item && item.sender) ? item.sender : fallbackSender;
      const date = normalize((item && item.date) || "");
      const snippet = normalize(
        (item && item.snippet) ||
        (state.snippetByThreadId && state.snippetByThreadId[tid]) ||
        ""
      );
      const cleanedSnippet = safeThreadFallbackText(snippet);
      byThread.set(tid, [{
        sender: isUseful(sender) ? sender : "Unknown sender",
        date,
        bodyHtml: "",
        bodyText: cleanedSnippet || THREAD_BODY_PLACEHOLDER,
        isSeededPlaceholder: true
      }]);
    }
    return byThread;
  }

  async function waitForRowStability(readCount, options = {}) {
    const getCount = typeof readCount === "function"
      ? readCount
      : () => Number(readCount || 0);
    const signal = options && typeof options === "object" ? options.signal : null;
    const settleMs = Math.max(180, Number(options && options.settleMs || 420));
    const timeoutMs = Math.max(settleMs + 200, Number(options && options.timeoutMs || 4200));
    const pollMs = Math.max(40, Number(options && options.pollMs || 110));
    const startedAt = Date.now();
    let lastCount = Number(getCount() || 0);
    let stableSince = Date.now();

    while (Date.now() - startedAt < timeoutMs) {
      if (signal && signal.aborted) {
        return { stable: false, aborted: true, count: lastCount };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
      const nextCount = Number(getCount() || 0);
      if (nextCount === lastCount) {
        if (Date.now() - stableSince >= settleMs) {
          return { stable: true, aborted: false, count: nextCount };
        }
        continue;
      }
      lastCount = nextCount;
      stableSince = Date.now();
    }
    return {
      stable: false,
      aborted: Boolean(signal && signal.aborted),
      timedOut: true,
      count: lastCount
    };
  }

  async function discoverThreadIds(email, signal) {
    const sdk = state.inboxSdkInstance;
    if (!sdk) return [];
    const ids = [];
    const query = `from:${email} OR to:${email}`;
    const timed = logTimed("discovery", { email, query });
    logEvent("discovery:start", {
      email,
      query,
      currentHash: (window.location.hash || "").slice(0, 80),
      currentUrl: (window.location.href || "").slice(-60)
    });

    try {
      const gotoStart = Date.now();
      await sdk.Router.goto(sdk.Router.NativeRouteIDs.SEARCH, { query });
      logEvent("discovery:goto-done", { email, durationMs: Date.now() - gotoStart });
    } catch (_) {
      timed.done({ error: "goto-failed", count: 0 });
      return [];
    }
    if (signal?.aborted) return [];

    // Router.goto resolves when navigation is triggered, not when Gmail finishes loading
    // search results. Wait for URL to confirm we're on the search page before collecting rows.
    const urlWaitStart = Date.now();
    const urlWaitMaxMs = 5000;
    const emailEnc = encodeURIComponent(email).replace(/%20/g, "+");
    await new Promise((resolve) => {
      const check = () => {
        if (signal?.aborted) { resolve(); return; }
        const hash = (window.location.hash || "").toLowerCase();
        const href = (window.location.href || "").toLowerCase();
        const onSearch = hash.includes("search") || href.includes("/search") || href.includes("search=")
          || hash.includes("advanced-search");
        const hasQuery = hash.includes(emailEnc) || href.includes(emailEnc)
          || hash.includes("from%3a") || href.includes("from%3a")
          || hash.includes("to%3a") || href.includes("to%3a");
        if (onSearch || hasQuery) {
          logEvent("discovery:url-ready", { email, waitMs: Date.now() - urlWaitStart });
          resolve();
          return;
        }
        if (Date.now() - urlWaitStart >= urlWaitMaxMs) {
          logEvent("discovery:url-timeout", { email, waitMs: urlWaitMaxMs });
          resolve();
          return;
        }
        setTimeout(check, 50);
      };
      check();
    });
    if (signal?.aborted) return [];
    history.replaceState(null, "", window.location.href);

    let unregister;
    try {
      unregister = sdk.Lists.registerThreadRowViewHandler((row) => {
        if (typeof row.getThreadIDAsync === "function") {
          row.getThreadIDAsync().then((id) => { if (id) ids.push(id); }).catch(() => {});
        } else if (typeof row.getThreadID === "function") {
          try { const id = row.getThreadID(); if (id) ids.push(id); } catch (_) {}
        }
      });
    } catch (_) {
      unregister = null;
    }

    await waitForRowStability(() => ids.length, { signal });
    if (typeof unregister === "function") { try { unregister(); } catch (_) {} }
    if (signal?.aborted) return [];
    timed.done({ count: ids.length });
    logEvent("discovery:done", {
      email,
      count: ids.length,
      hashAfter: (window.location.hash || "").slice(0, 80),
      sampleIds: ids.slice(0, 3)
    });
    return ids;
  }

  // Append hydrated messages to the active thread timeline without replacing
  // existing messages. Merges into state.activeTimelineMessages and re-renders.
  function appendMessagesToTimeline(messages, root) {
    if (!Array.isArray(messages) || messages.length === 0) return;
    if (!(root instanceof HTMLElement)) return;

    const conversationContext = activeConversationContext();
    const normalized = normalizeThreadMessagesForChat(
      messages.map((msg) => normalizeHydrationMessageForConversation(msg, conversationContext)),
      "",
      conversationContext
    );
    const filtered = normalized.filter((msg) => messageBelongsToConversation(msg, conversationContext));
    if (filtered.length === 0) return;

    // Deduplicate by messageKey against what's already in the timeline.
    const existingKeys = new Set(
      (Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : [])
        .map((m) => normalize(m && m.messageKey || ""))
        .filter(Boolean)
    );
    const fresh = filtered.filter((m) => !existingKeys.has(normalize(m && m.messageKey || "")));
    if (fresh.length === 0) return;

    state.activeTimelineMessages = [
      ...(Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : []),
      ...fresh
    ];
    state.mergedMessages = state.activeTimelineMessages.slice();
    const renderThread = resolveRenderThread();
    if (typeof renderThread === "function") {
      renderThread(root);
    }
  }

  // Hydrate a list of thread IDs from print-view with concurrency limiting,
  // appending messages to the active timeline as each thread resolves.
  async function fetchAndRenderThreads(threadIds, root) {
    if (!Array.isArray(threadIds) || threadIds.length === 0) return;
    const CONCURRENCY = 4;
    const executing = [];

    for (const id of threadIds) {
      // InboxSDK returns hex format (e.g. 19cac3c9f7d56e00); hydrateThreadFromPrintView
      // expects canonical (f:decimal). Convert hex -> canonical when needed.
      let threadIdForHydrate = id;
      let hexId = hexThreadIdForThread(id);
      if (!hexId && /^[0-9a-f]+$/i.test(normalize(id || ""))) {
        try {
          threadIdForHydrate = `f:${BigInt("0x" + id).toString()}`;
          hexId = id;
        } catch (_) {}
      }
      if (!hexId) continue;

      const mailbox = state.currentThreadMailbox || "inbox";
      const hintHref = null;
      const accountEmail = state.activeAccountEmail
        || detectCurrentUserEmail()
        || "";

      // Check two-tier cache first.
      let cached = null;
      try { cached = await getThreadCache(hexId); } catch (_) {}
      if (cached && Array.isArray(cached.messages) && cached.messages.length > 0) {
        appendMessagesToTimeline(cached.messages, getRoot() || root);
        continue;
      }

      const p = hydrateThreadFromPrintView(threadIdForHydrate, mailbox, hintHref, accountEmail)
        .then(({ messages }) => {
          executing.splice(executing.indexOf(p), 1);
          if (Array.isArray(messages) && messages.length > 0) {
            appendMessagesToTimeline(messages, getRoot() || root);
          }
        })
        .catch((err) => {
          executing.splice(executing.indexOf(p), 1);
          logWarn(`fetchAndRenderThreads: hydration failed for ${normalize(id || "")}: ${normalize(err && err.message ? err.message : String(err || ""))}`);
        });

      executing.push(p);
      if (executing.length >= CONCURRENCY) {
        await Promise.race(executing);
      }
    }

    await Promise.allSettled(executing);
  }

  function loadContactChat(group, root, options = {}) {
    if (!group || !Array.isArray(group.threadIds) || group.threadIds.length === 0) return;
    const forceDeepHydration = Boolean(options && options.forceDeepHydration);
    const hydrationReason = normalize(options && options.reason ? options.reason : "");
    const existingTimelineSnapshot = forceDeepHydration && Array.isArray(state.activeTimelineMessages)
      ? state.activeTimelineMessages.slice()
      : [];
    const preserveExistingTimeline = Boolean(
      forceDeepHydration
      && state.currentView === "thread"
      && existingTimelineSnapshot.length > 0
    );
    if (!preserveExistingTimeline) {
      bumpInteractionEpoch("load-contact-chat");
    }
    const route = parseListRoute(window.location.hash || state.lastListHash || "#inbox");
    const defaultMailbox = route.mailbox || "inbox";
    const activeAccountEmail = detectCurrentUserEmail() || state.activeAccountEmail || state.currentUserEmail || "";
    const contactEmailFromGroup = extractEmail(
      group.contactEmail
      || group.contactKey
      || (group.latestItem && (group.latestItem.senderEmail || group.latestItem.sender))
      || ""
    );
    const contactKeyFromGroup = contactEmailFromGroup || normalize(group.contactKey || "");
    const conversationKeyFromGroup = normalize(
      group.conversationKey
      || conversationKeyFromContact(contactEmailFromGroup)
      || (contactKeyFromGroup ? `contact:${contactKeyFromGroup.toLowerCase()}` : "")
    );
    const initialContext = activeConversationContext({
      activeAccountEmail,
      contactEmail: contactEmailFromGroup,
      conversationKey: conversationKeyFromGroup
    });
    const expandedGroup = expandContactGroupWithCachedCounterparts(
      {
        ...group,
        items: Array.isArray(group.items) ? group.items.slice() : [],
        threadIds: Array.isArray(group.threadIds) ? group.threadIds.slice() : []
      },
      initialContext
    );
    const selectedGroup = {
      ...group,
      ...expandedGroup,
      items: Array.isArray(expandedGroup && expandedGroup.items) ? expandedGroup.items.slice() : (Array.isArray(group.items) ? group.items.slice() : []),
      threadIds: Array.isArray(expandedGroup && expandedGroup.threadIds) ? expandedGroup.threadIds.slice() : (Array.isArray(group.threadIds) ? group.threadIds.slice() : [])
    };
    const threadIds = selectedGroup.threadIds
      .map((id) => canonicalThreadId(id || "") || normalize(id || ""))
      .filter(Boolean);
    if (threadIds.length === 0) return;
    const hydrationRunId = Number(state.contactHydrationRunId || 0) + 1;
    const threadMailboxByThreadId = new Map();
    const threadHintByThreadId = new Map();
    for (const item of Array.isArray(selectedGroup.items) ? selectedGroup.items : []) {
      rememberThreadNavigationHint(item && item.threadId, item && item.href, item && item.row);
      const itemThread = canonicalThreadId(item && item.threadId);
      if (!itemThread) continue;
      const itemMailbox = mailboxCacheKey(item && item.mailbox ? item.mailbox : defaultMailbox);
      if (!threadMailboxByThreadId.has(itemThread)) {
        threadMailboxByThreadId.set(itemThread, itemMailbox);
      }
      const itemHint = normalize(item && item.href ? item.href : "");
      if (itemHint && !threadHintByThreadId.has(itemThread)) {
        threadHintByThreadId.set(itemThread, itemHint);
      }
    }
    const mailboxForThread = (threadId) => (
      threadMailboxByThreadId.get(canonicalThreadId(threadId)) || mailboxCacheKey(defaultMailbox)
    );
    const hintForThread = (threadId) => (
      threadHintByThreadId.get(canonicalThreadId(threadId)) || lookupThreadHintHref(threadId)
    );
    const firstThreadMailbox = mailboxForThread(threadIds[0] || "");
    const firstThreadHint = hintForThread(threadIds[0] || "");
    // Inbox list is newest-first; thread view should be oldest-first.
    let displayThreadIds = threadIds.slice().reverse();
    markThreadsReadLocally(
      threadIds,
      (selectedGroup.items || []).map((m) => m && m.row).filter((row) => row instanceof HTMLElement)
    );
    const contactEmail = extractEmail(
      selectedGroup.contactEmail
      || selectedGroup.contactKey
      || (selectedGroup.latestItem && (selectedGroup.latestItem.senderEmail || selectedGroup.latestItem.sender))
      || ""
    );
    const contactKey = contactEmail || normalize(selectedGroup.contactKey || group.contactKey || "");
    const conversationKey = normalize(
      selectedGroup.conversationKey
      || conversationKeyFromContact(contactEmail)
      || (contactKey ? `contact:${contactKey.toLowerCase()}` : "")
    );
    const conversationContext = activeConversationContext({
      activeAccountEmail,
      contactEmail,
      conversationKey
    });
    const openDiagRunId = normalize(
      (options && options.openDiagRunId)
      || state.activeOpenDiagRunId
      || ""
    );
    const hydrationDiagRunId = typeof diagStart === "function"
      ? diagStart("hydration", {
        ce: conversationContext.contactEmail || contactEmail || "",
        ck: conversationContext.conversationKey || conversationKey || "",
        tc: threadIds.length,
        rs: hydrationReason || "click"
      })
      : "";
    state.activeHydrationDiagRunId = hydrationDiagRunId;
    const inboxCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
      ? state.scannedMailboxMessages[mailboxCacheKey("inbox")].length : 0;
    const sentCacheKey = mailboxCacheKey("sent");
    const sentCachedRows = Array.isArray(state.scannedMailboxMessages[sentCacheKey])
      ? state.scannedMailboxMessages[sentCacheKey]
      : [];
    let effectiveSentCachedRows = sentCachedRows.slice();
    if (effectiveSentCachedRows.length === 0) {
      const fallbackThreadId = canonicalThreadId(
        threadIds[0]
        || state.currentThreadIdForReply
        || state.activeThreadId
        || ""
      ) || normalize(
        threadIds[0]
        || state.currentThreadIdForReply
        || state.activeThreadId
        || ""
      );
      const timelineRows = preserveExistingTimeline
        ? existingTimelineSnapshot
        : (Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : []);
      const backfilledSentRows = [];
      for (const row of timelineRows) {
        const normalizedRow = normalizeHydrationMessageForConversation(row, {
          ...conversationContext,
          threadId: fallbackThreadId
        });
        if (!isOutgoingHydrationMessage(normalizedRow)) continue;
        const rowThreadId = canonicalThreadId(normalizedRow && normalizedRow.threadId || "") || normalize(normalizedRow && normalizedRow.threadId || "");
        if (rowThreadId) {
          backfilledSentRows.push({ ...normalizedRow, threadId: rowThreadId });
          continue;
        }
        if (fallbackThreadId) {
          backfilledSentRows.push({ ...normalizedRow, threadId: fallbackThreadId });
        }
      }
      if (backfilledSentRows.length > 0) {
        effectiveSentCachedRows = backfilledSentRows;
        state.scannedMailboxMessages[sentCacheKey] = backfilledSentRows.slice();
        logChatDebug("contact-chat:sent-cache-backfill", {
          conversationKey: normalize(conversationContext.conversationKey || ""),
          contactEmail: extractEmail(conversationContext.contactEmail || ""),
          count: backfilledSentRows.length
        }, {
          throttleKey: `contact-chat-sent-cache-backfill:${normalize(conversationContext.conversationKey || contactEmail || "unknown")}`,
          throttleMs: 500
        });
      }
    }
    const sentCached = effectiveSentCachedRows.length;
    logEvent("H110", {
      runId: hydrationDiagRunId,
      or: openDiagRunId || undefined,
      contact: contactEmail || contactKey,
      tc: threadIds.length,
      inboxCached,
      sentCached,
      rs: hydrationReason || "click"
    });
    logEvent("H220", {
      runId: hydrationDiagRunId,
      phase: "hydration",
      ce: conversationContext.contactEmail || contactEmail || "",
      tc: threadIds.length,
      rs: hydrationReason || "click"
    });
    logChatDebug("contact-open:start", {
      contactEmail: conversationContext.contactEmail || contactEmail || "",
      conversationKey: conversationContext.conversationKey || "",
      activeAccountEmail: conversationContext.activeAccountEmail || "",
      clickedThreadId: canonicalThreadId((group && group.latestItem && group.latestItem.threadId) || "") || ""
    }, { throttleKey: `contact-open-start:${conversationContext.conversationKey || contactKey}`, throttleMs: 320 });
    logChatDebug("contact-open:scope", {
      contactEmail: conversationContext.contactEmail || contactEmail || "",
      conversationKey: conversationContext.conversationKey || "",
      candidateThreadCount: threadIds.length,
      itemCount: Array.isArray(selectedGroup.items) ? selectedGroup.items.length : 0,
      groupThreadCount: Array.isArray(group && group.threadIds) ? group.threadIds.length : 0
    }, { throttleKey: `contact-open-scope:${conversationContext.conversationKey || contactKey}`, throttleMs: 320 });
    logChatDebug("contact-chat:open", {
      requestedContact: contactEmailFromGroup,
      resolvedContact: conversationContext.contactEmail || contactEmail,
      accountEmail: conversationContext.activeAccountEmail || "",
      conversationKey: conversationContext.conversationKey || "",
      threadCount: threadIds.length,
      threadSample: threadIds.slice(0, 10),
      sourceItemsCount: Array.isArray(selectedGroup.items) ? selectedGroup.items.length : 0,
      originalThreadCount: Array.isArray(group.threadIds) ? group.threadIds.length : 0
    }, { throttleKey: `contact-chat-open:${conversationContext.conversationKey || contactKey}`, throttleMs: 400 });
    state.contactChatLoading = !preserveExistingTimeline;
    state.contactHydrationInFlight = true;
    state.contactHydrationRunId = hydrationRunId;
    state.threadExtractRetry = 0;
    state.contactThreadIds = threadIds.slice();
    state.contactDisplayName = selectedGroup.contactName || (selectedGroup.latestItem && senderDisplayName(selectedGroup.latestItem.sender)) || "Chat";
    state.activeContactKey = contactKey;
    state.activeContactEmail = conversationContext.contactEmail || contactEmail || "";
    state.activeConversationKey = conversationContext.conversationKey || conversationKey || "";
    state.activeAccountEmail = conversationContext.activeAccountEmail || activeAccountEmail || state.activeAccountEmail;
    state.currentView = "thread";
    state.activeThreadId = threadIds[0] || "";
    state.mergedMessages = preserveExistingTimeline ? existingTimelineSnapshot.slice() : [];
    if (isContactTimelineV2Enabled()) {
      state.activeTimelineMessages = preserveExistingTimeline ? existingTimelineSnapshot.slice() : [];
    }
    state.contactTimelineIsDeep = false;
    state.contactTimelineDeepHydratedAt = 0;
    state.contactTimelineDeepCount = 0;
    state.currentThreadIdForReply = threadIds[0] || "";
    state.currentThreadHintHref = firstThreadHint;
    state.currentThreadMailbox = firstThreadMailbox;
    // Save current list hash so Back button works; do NOT navigate away — print-view
    // fetches are same-origin background requests that need no thread DOM to be open.
    state.lastListHash = sanitizeListHash(window.location.hash || state.lastListHash || "#inbox");

    // Render instantly using list snippets, then hydrate with real bodies in background.
    const seededByThread = buildSeededMessagesByThread({
      ...selectedGroup,
      threadIds
    });
    const seededSenderByThread = new Map();
    const seededDateByThread = new Map();
    for (const threadId of threadIds) {
      const seeded = seededByThread.get(threadId);
      const seedSender = Array.isArray(seeded) && seeded[0] ? normalize(seeded[0].sender || "") : "";
      const seedDate = Array.isArray(seeded) && seeded[0] ? normalize(seeded[0].date || "") : "";
      if (seedSender) seededSenderByThread.set(threadId, seedSender);
      if (seedDate) seededDateByThread.set(threadId, seedDate);
    }
    if (!preserveExistingTimeline) {
      state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, seededByThread, conversationContext);
      if (isContactTimelineV2Enabled()) {
        state.activeTimelineMessages = state.mergedMessages.slice();
      }
    } else {
      logChatDebug("contact-chat:seed-preserved", {
        reason: hydrationReason || "fallback",
        conversationKey: conversationContext.conversationKey || "",
        threadCount: threadIds.length,
        preservedMessages: existingTimelineSnapshot.length
      }, {
        throttleKey: `contact-chat-seed-preserved:${conversationContext.conversationKey || contactKey}`,
        throttleMs: 240
      });
    }
    state.currentThreadIdForReply = threadIds[0] || "";
    state.currentThreadHintHref = firstThreadHint;
    state.currentThreadMailbox = firstThreadMailbox;
    const renderList = resolveRenderList();
    const renderCurrentView = resolveRenderCurrentView();
    if (!preserveExistingTimeline && typeof renderList === "function") {
      renderList(root);
    }
    if (!preserveExistingTimeline && typeof renderCurrentView === "function") {
      renderCurrentView(root);
    }

    // In instant mode avoid immediate scan pressure on click/open.
    if (STARTUP_PERF_MODE !== "instant" && !state.fullScanCompletedByMailbox[mailboxCacheKey("sent")] && !state.fullScanRunning) {
      const scheduleHeavy = typeof scheduleHeavyWorkAfterIdle === "function" ? scheduleHeavyWorkAfterIdle : null;
      if (scheduleHeavy) {
        scheduleHeavy(() => {
          scheduleMailboxScanKick(root, { mailboxes: ["sent"], delayMs: 0 });
        }, { minIdleMs: 1600, hardTimeoutMs: 5200, reason: "contact-chat-sent-scan" });
      } else {
        scheduleMailboxScanKick(root, { mailboxes: ["sent"], delayMs: 1800 });
      }
    }

    // Parallel InboxSDK discovery — runs after instant render, appends new threads only.
    // Cap at 10 to avoid fetching 50+ irrelevant threads.
    const kickContactDiscovery = resolveKickContactDiscovery();
    if (ENABLE_DISCOVERY_ON_OPEN && STARTUP_PERF_MODE !== "instant" && typeof kickContactDiscovery === "function") {
      kickContactDiscovery(contactEmail, root, "load-contact-chat");
    }

    const isStillActiveContactChat = () => {
      if (Number(state.contactHydrationRunId || 0) !== hydrationRunId) return false;
      if (state.currentView !== "thread") return false;
      if (forceDeepHydration) return true;
      const activeConversation = normalize(state.activeConversationKey || "");
      const expectedConversation = normalize(conversationContext.conversationKey || "");
      if (activeConversation && expectedConversation) return activeConversation === expectedConversation;
      return normalize(state.activeContactKey || "") === normalize(contactKey || "");
    };
    let hydrationRunClosed = false;
    const closeHydrationRun = (status = "complete", payload = {}) => {
      if (hydrationRunClosed) return;
      hydrationRunClosed = true;
      if (hydrationDiagRunId && typeof diagEnd === "function") {
        diagEnd(hydrationDiagRunId, status, payload);
      }
      if (normalize(state.activeHydrationDiagRunId || "") === hydrationDiagRunId) {
        state.activeHydrationDiagRunId = "";
      }
    };
    const abortHydrationRun = (reason = "stale-context") => {
      logEvent("H190", {
        runId: hydrationDiagRunId,
        rc: 1,
        rs: reason
      });
      closeHydrationRun("aborted", {
        rc: 1,
        rs: reason
      });
    };
    const getKnownThreadIdSet = () => {
      const known = new Set();
      for (const threadId of Array.isArray(displayThreadIds) ? displayThreadIds : []) {
        const canonical = canonicalThreadId(threadId || "") || normalize(threadId || "");
        if (canonical) known.add(canonical);
      }
      return known;
    };
    const appendKnownThreadIds = (threadIdsToAdd = []) => {
      const known = getKnownThreadIdSet();
      const appended = [];
      for (const threadId of dedupeCanonicalThreadIds(threadIdsToAdd, SENT_PROBE_MAX_THREAD_IDS)) {
        if (known.has(threadId)) continue;
        known.add(threadId);
        displayThreadIds.push(threadId);
        appended.push(threadId);
      }
      if (appended.length > 0) {
        const next = Array.isArray(state.contactThreadIds) ? state.contactThreadIds.slice() : [];
        for (const threadId of appended) {
          if (!next.includes(threadId)) next.push(threadId);
        }
        state.contactThreadIds = next;
      }
      return appended;
    };
    const sentProbeContextKey = normalize(conversationContext.conversationKey || conversationKey || "");
    const runConversationSentProbe = async () => {
      const contact = extractEmail(conversationContext.contactEmail || contactEmail || "");
      if (!contact) {
        return { status: "none", rc: 4, threadIds: [] };
      }
      if (!sentProbeContextKey) {
        return { status: "none", rc: 4, threadIds: [] };
      }
      if (!state.sentProbeCacheByConversation || typeof state.sentProbeCacheByConversation !== "object") {
        state.sentProbeCacheByConversation = {};
      }
      if (!state.sentProbeInFlightByConversation || typeof state.sentProbeInFlightByConversation !== "object") {
        state.sentProbeInFlightByConversation = {};
      }
      if (state.sentProbeInFlightByConversation[sentProbeContextKey]) {
        return { status: "aborted", rc: 2, threadIds: [] };
      }
      state.sentProbeInFlightByConversation[sentProbeContextKey] = Date.now();
      const startedAt = Date.now();
      try {
        if (!isStillActiveContactChat()) return { status: "aborted", rc: 1, threadIds: [] };
        await new Promise((resolve) => setTimeout(resolve, SENT_PROBE_IDLE_MS));
        if (!isStillActiveContactChat()) return { status: "aborted", rc: 1, threadIds: [] };
        logEvent("H224", {
          runId: hydrationDiagRunId,
          ce: contact,
          qm: "sent|anywhere"
        });
        const knownThreadIds = getKnownThreadIdSet();
        const cachedEntry = state.sentProbeCacheByConversation[sentProbeContextKey];
        if (
          cachedEntry
          && Number(cachedEntry.expiresAt || 0) > Date.now()
          && Array.isArray(cachedEntry.threadIds)
        ) {
          const cachedThreadIds = dedupeCanonicalThreadIds(cachedEntry.threadIds, SENT_PROBE_MAX_THREAD_IDS)
            .filter((threadId) => !knownThreadIds.has(threadId));
          if (cachedThreadIds.length > 0) {
            logEvent("H226", {
              runId: hydrationDiagRunId,
              tc: cachedThreadIds.length,
              cm: 1
            });
            return { status: "found", rc: 0, threadIds: cachedThreadIds };
          }
        }

        const queryModes = [
          {
            qm: "sent-to",
            q: `in:sent to:${contact} ${SENT_PROBE_RECENCY_FILTER}`
          },
          {
            qm: "sent-contact",
            q: `in:sent (to:${contact} OR cc:${contact} OR bcc:${contact}) ${SENT_PROBE_RECENCY_FILTER}`
          },
          {
            qm: "anywhere-contact",
            q: `in:anywhere (from:${contact} OR to:${contact})`
          }
        ];
        let foundThreadIds = [];
        let lastReasonCode = 6;
        for (const queryMode of queryModes) {
          if (!isStillActiveContactChat()) return { status: "aborted", rc: 1, threadIds: [] };
          const remainingMs = Math.max(120, SENT_PROBE_TIMEOUT_MS - (Date.now() - startedAt));
          if (remainingMs <= 120) return { status: "timeout", rc: 3, threadIds: [] };
          logEvent("H225", {
            runId: hydrationDiagRunId,
            qm: queryMode.qm,
            qh: hashString(queryMode.q || "").slice(0, 10),
            timeoutMs: remainingMs
          });
          try {
            const queryThreadIds = await fetchThreadIdsForSearchQuery(queryMode.q, {
              timeoutMs: remainingMs,
              isActive: isStillActiveContactChat,
              contactEmail: contact
            });
            if (queryThreadIds.length === 0) continue;
            foundThreadIds = dedupeCanonicalThreadIds(queryThreadIds, SENT_PROBE_MAX_THREAD_IDS)
              .filter((threadId) => !knownThreadIds.has(threadId));
            if (foundThreadIds.length > 0) break;
          } catch (error) {
            const reasonCode = Number(error && error.reasonCode != null ? error.reasonCode : 5);
            lastReasonCode = reasonCode;
            if (reasonCode === 1 || reasonCode === 2) {
              return {
                status: "aborted",
                rc: reasonCode,
                threadIds: []
              };
            }
            // Timeout or fetch errors should still allow later fallback queries.
            continue;
          }
        }

        if (foundThreadIds.length === 0) {
          return { status: "none", rc: lastReasonCode, threadIds: [] };
        }

        state.sentProbeCacheByConversation[sentProbeContextKey] = {
          threadIds: foundThreadIds.slice(),
          updatedAt: Date.now(),
          expiresAt: Date.now() + SENT_PROBE_TTL_MS
        };
        logEvent("H226", {
          runId: hydrationDiagRunId,
          tc: foundThreadIds.length,
          cm: 0
        });
        return { status: "found", rc: 0, threadIds: foundThreadIds };
      } finally {
        if (state.sentProbeInFlightByConversation && sentProbeContextKey) {
          delete state.sentProbeInFlightByConversation[sentProbeContextKey];
        }
      }
    };

    (async () => {
      const resolvedByThread = new Map();
      const preserveFallbackThreadId = canonicalThreadId(
        displayThreadIds[0]
        || threadIds[0]
        || state.currentThreadIdForReply
        || state.activeThreadId
        || ""
      ) || normalize(
        displayThreadIds[0]
        || threadIds[0]
        || state.currentThreadIdForReply
        || state.activeThreadId
        || ""
      );
      if (preserveExistingTimeline) {
        for (const message of existingTimelineSnapshot) {
          const normalizedExisting = normalizeHydrationMessageForConversation(message, {
            ...conversationContext,
            threadId: preserveFallbackThreadId
          });
          let messageThreadId = canonicalThreadId(normalizedExisting && normalizedExisting.threadId || "") || normalize(normalizedExisting && normalizedExisting.threadId || "");
          if (!messageThreadId && isOutgoingHydrationMessage(normalizedExisting) && preserveFallbackThreadId) {
            messageThreadId = preserveFallbackThreadId;
          }
          if (!messageThreadId) continue;
          if (!resolvedByThread.has(messageThreadId)) resolvedByThread.set(messageThreadId, []);
          resolvedByThread.get(messageThreadId).push({
            ...normalizedExisting,
            threadId: messageThreadId
          });
        }
      }
      for (const threadId of threadIds) {
        if (resolvedByThread.has(threadId)) continue;
        const seeded = seededByThread.get(threadId);
        resolvedByThread.set(threadId, Array.isArray(seeded) ? seeded.slice() : []);
      }

      let totalExtractAttempts = 0;
      const hydrateAccountEmail = conversationContext.activeAccountEmail || state.activeAccountEmail || "";

      if (!isStillActiveContactChat()) {
        abortHydrationRun("inactive-before-fetch");
        return;
      }

      // Helper: apply one thread's result into resolvedByThread and re-render.
      // Called the moment each individual fetch resolves — user sees progressive updates
      // instead of waiting for the slowest thread.
      const applyThreadResult = (threadId, data) => {
        if (!isStillActiveContactChat()) {
          abortHydrationRun("inactive-during-thread-merge");
          return false;
        }
        totalExtractAttempts += Number(data.extractAttempts || 0);
        const captured = applySnippetFallbackToMessages(
          Array.isArray(data.messages) ? data.messages : [],
          threadId
        );
        if (!hasMeaningfulCapturedMessages(captured)) return false;
        const seedSender = seededSenderByThread.get(threadId) || "";
        const seedDate = seededDateByThread.get(threadId) || "";
        const normalizedCaptured = normalizeThreadMessagesForChat(
          captured.map((msg) => {
            const nextSender = choosePreferredSender(msg && msg.sender, seedSender);
            const beforeNormalize = {
              ...msg,
              sender: nextSender || normalize(msg && msg.sender) || seedSender || "Unknown sender",
              date: normalize(msg && msg.date) || seedDate || ""
            };
            const afterNormalize = normalizeHydrationMessageForConversation(beforeNormalize, conversationContext);
            const shouldTrace = Boolean(
              beforeNormalize.isSelf === true
              || afterNormalize.isSelf === true
              || normalize(beforeNormalize.direction || "") === "outgoing"
              || normalize(afterNormalize.direction || "") === "outgoing"
            );
            if (shouldTrace) {
              const messageTraceId = normalize(
                beforeNormalize.messageId
                || beforeNormalize.dataMessageId
                || afterNormalize.messageId
                || afterNormalize.dataMessageId
                || `${threadId}:${normalize(beforeNormalize.date || "")}:${hashString(normalize(beforeNormalize.bodyText || "").toLowerCase())}`
              );
              const tracePayload = {
                threadId,
                messageTraceId,
                before: beforeNormalize,
                after: afterNormalize
              };
              logEvent("H230", {
                runId: hydrationDiagRunId,
                threadId,
                messageTraceId,
                bSelf: Boolean(beforeNormalize.isSelf),
                aSelf: Boolean(afterNormalize.isSelf),
                bDir: normalize(beforeNormalize.direction || ""),
                aDir: normalize(afterNormalize.direction || ""),
                bSender: extractEmail(beforeNormalize.senderEmail || beforeNormalize.sender || ""),
                aSender: extractEmail(afterNormalize.senderEmail || afterNormalize.sender || ""),
                bRecipientCount: Array.isArray(beforeNormalize.recipientEmails) ? beforeNormalize.recipientEmails.length : 0,
                aRecipientCount: Array.isArray(afterNormalize.recipientEmails) ? afterNormalize.recipientEmails.length : 0
              }, { tier: "always" });
              logChatDebug("contact-hydration:normalize-trace", tracePayload, {
                throttleKey: `contact-hydration-normalize:${threadId}:${messageTraceId || "unknown"}`,
                throttleMs: 250
              });
              try {
                console.warn("[reskin][trace][contact-hydration:normalize]", tracePayload);
              } catch (_) { /* console unavailable */ }
            }
            return afterNormalize;
          }),
          threadId,
          conversationContext
        );
        const inConversation = normalizedCaptured.filter((msg) => (
          messageBelongsToConversation(msg, conversationContext)
        ));
        if (inConversation.length > 0) {
          resolvedByThread.set(threadId, inConversation);
        } else if (
          normalizedCaptured.some((msg) => {
            if (msg && msg.isSelf === true) return true;
            const senderEmail = extractEmail(msg && (msg.senderEmail || msg.sender));
            return (
              senderEmail
              && (
                senderEmail === conversationContext.contactEmail
                || senderEmail === conversationContext.activeAccountEmail
              )
            );
          })
        ) {
          resolvedByThread.set(threadId, normalizedCaptured);
        } else {
          return false; // nothing kept — skip re-render
        }
        // Partial merge and render immediately after this thread lands
        state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, resolvedByThread, conversationContext);
        if (isContactTimelineV2Enabled()) {
          state.activeTimelineMessages = state.mergedMessages.slice();
        }
        const partialRoot = getRoot();
        const renderThread = resolveRenderThread();
        if (partialRoot instanceof HTMLElement && typeof renderThread === "function") {
          renderThread(partialRoot);
        }
        return true;
      };

      let firstHydrationApplied = false;
      const pendingThreadIds = threadIds.slice();
      const workerCount = Math.max(1, Math.min(CONTACT_HYDRATION_MAX_CONCURRENCY, pendingThreadIds.length));
      const workers = Array.from({ length: workerCount }, async () => {
        while (pendingThreadIds.length > 0) {
          const threadId = pendingThreadIds.shift();
          if (!threadId) continue;
          try {
            const data = await hydrateThreadFromPrintView(
              threadId,
              mailboxForThread(threadId),
              hintForThread(threadId),
              hydrateAccountEmail
            );
            applyThreadResult(threadId, data);
            if (!firstHydrationApplied) {
              firstHydrationApplied = true;
              if (state.activeOpenPerfTraceId) {
                markPerfStage(state.activeOpenPerfTraceId, "hydration:first-thread-landed", {
                  threadId: normalize(threadId || "")
                });
              }
            }
          } catch (err) {
            logWarn(`print-view hydration failed threadId=${normalize(threadId || "")}: ${normalize(err && err.message ? err.message : String(err || ""))}`);
          }
        }
      });
      await Promise.all(workers);

      if (!isStillActiveContactChat()) {
        abortHydrationRun("inactive-before-finalize");
        return;
      }

      // Final authoritative state after all threads have landed
      const recomputeTimeline = () => {
        state.mergedMessages = mergeContactMessagesByThread(displayThreadIds, resolvedByThread, conversationContext);
        if (isContactTimelineV2Enabled()) {
          state.activeTimelineMessages = state.mergedMessages.slice();
        }
        return Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages : [];
      };
      let finalTimeline = recomputeTimeline();
      state.contactTimelineIsDeep = true;
      state.contactTimelineDeepHydratedAt = Date.now();
      state.contactTimelineDeepCount = state.activeTimelineMessages.length;
      state.contactChatLoading = false;
      const probeRoot = getRoot();
      let outgoingCount = 0;
      for (const msg of finalTimeline) {
        if (isOutgoingHydrationMessage(msg)) outgoingCount += 1;
      }
      if (outgoingCount === 0 && isStillActiveContactChat()) {
        const sentProbe = await runConversationSentProbe();
        if (sentProbe.status === "timeout" || sentProbe.status === "aborted") {
          logEvent("H227", {
            runId: hydrationDiagRunId,
            rc: Number(sentProbe.rc || (sentProbe.status === "timeout" ? 3 : 1)),
            mc: finalTimeline.length
          });
        }
        if (sentProbe.status === "found" && Array.isArray(sentProbe.threadIds) && sentProbe.threadIds.length > 0) {
          const probeThreadIds = appendKnownThreadIds(sentProbe.threadIds);
          const pendingProbeThreadIds = probeThreadIds.slice();
          const probeWorkerCount = Math.max(1, Math.min(CONTACT_HYDRATION_MAX_CONCURRENCY, pendingProbeThreadIds.length));
          const probeWorkers = Array.from({ length: probeWorkerCount }, async () => {
            while (pendingProbeThreadIds.length > 0) {
              if (!isStillActiveContactChat()) return;
              const threadId = pendingProbeThreadIds.shift();
              if (!threadId) continue;
              try {
                const data = await hydrateThreadFromPrintView(
                  threadId,
                  "sent",
                  hintForThread(threadId),
                  hydrateAccountEmail
                );
                let applied = applyThreadResult(threadId, data);
                if (!applied) {
                  const senderEmail = extractEmail(conversationContext.activeAccountEmail || state.activeAccountEmail || "");
                  const recipientEmail = extractEmail(conversationContext.contactEmail || contactEmail || "");
                  const snippet = normalize(
                    (state.snippetByThreadId && state.snippetByThreadId[threadId]) || ""
                  );
                  const fallbackOutgoing = {
                    sender: senderEmail || "You",
                    senderEmail: senderEmail || "",
                    recipientEmails: recipientEmail ? [recipientEmail] : [],
                    bodyText: snippet || "Sent message",
                    bodyHtml: "",
                    direction: "outgoing",
                    date: "",
                    threadId,
                    source: "sent_probe",
                    sourceType: "inferred",
                    metadataOnly: false
                  };
                  applied = applyThreadResult(threadId, {
                    messages: [fallbackOutgoing],
                    extractAttempts: Number(data && data.extractAttempts || 0)
                  });
                }
              } catch (error) {
                logWarn(`sent probe hydrate failed threadId=${normalize(threadId || "")}: ${normalize(error && error.message ? error.message : String(error || ""))}`);
                const senderEmail = extractEmail(conversationContext.activeAccountEmail || state.activeAccountEmail || "");
                const recipientEmail = extractEmail(conversationContext.contactEmail || contactEmail || "");
                const snippet = normalize(
                  (state.snippetByThreadId && state.snippetByThreadId[threadId]) || ""
                );
                const fallbackOutgoing = {
                  sender: senderEmail || "You",
                  senderEmail: senderEmail || "",
                  recipientEmails: recipientEmail ? [recipientEmail] : [],
                  bodyText: snippet || "Sent message",
                  bodyHtml: "",
                  direction: "outgoing",
                  date: "",
                  threadId,
                  source: "sent_probe",
                  sourceType: "inferred",
                  metadataOnly: false
                };
                applyThreadResult(threadId, {
                  messages: [fallbackOutgoing],
                  extractAttempts: 0
                });
              }
            }
          });
          await Promise.all(probeWorkers);
          if (!isStillActiveContactChat()) {
            abortHydrationRun("inactive-after-sent-probe");
            return;
          }
          finalTimeline = recomputeTimeline();
          outgoingCount = 0;
          for (const msg of finalTimeline) {
            if (isOutgoingHydrationMessage(msg)) outgoingCount += 1;
          }
          if (outgoingCount > 0) {
            logEvent("H228", {
              runId: hydrationDiagRunId,
              ce: conversationContext.contactEmail || contactEmail || "",
              oc: outgoingCount,
              mc: finalTimeline.length
            });
          } else {
            logEvent("H229", {
              runId: hydrationDiagRunId,
              ce: conversationContext.contactEmail || contactEmail || "",
              rc: 6,
              mc: finalTimeline.length
            });
          }
        } else if (outgoingCount === 0) {
          logEvent("H229", {
            runId: hydrationDiagRunId,
            ce: conversationContext.contactEmail || contactEmail || "",
            rc: Number(sentProbe.rc || 6),
            mc: finalTimeline.length
          });
        }
      }

      if (outgoingCount > 0) {
        logEvent("H222", {
          runId: hydrationDiagRunId,
          ce: conversationContext.contactEmail || contactEmail || "",
          oc: outgoingCount,
          mc: finalTimeline.length
        });
      } else {
        logEvent("H221", {
          runId: hydrationDiagRunId,
          ce: conversationContext.contactEmail || contactEmail || "",
          oc: 0,
          mc: finalTimeline.length
        });
      }
      logChatDebug("contact-chat:hydration-finish", {
        reason: hydrationReason || (forceDeepHydration ? "fallback" : "open"),
        conversationKey: conversationContext.conversationKey || "",
        threadCount: threadIds.length,
        mergedCount: Array.isArray(state.mergedMessages) ? state.mergedMessages.length : 0,
        totalExtractAttempts
      }, {
        throttleKey: `contact-hydration-finish:${conversationContext.conversationKey || contactKey}:${hydrationRunId}`,
        throttleMs: 260
      });
      if (state.activeOpenPerfTraceId) {
        markPerfStage(state.activeOpenPerfTraceId, "hydration:complete", {
          threadCount: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : threadIds.length,
          mergedCount: Array.isArray(state.mergedMessages) ? state.mergedMessages.length : 0
        });
        endPerfTrace(state.activeOpenPerfTraceId, {
          reason: "hydration-complete"
        });
      }
      const latestRoot = probeRoot instanceof HTMLElement ? probeRoot : getRoot();
      if (latestRoot instanceof HTMLElement) {
        const renderCurrentView = resolveRenderCurrentView();
        const renderThread = resolveRenderThread();
        if (!preserveExistingTimeline && typeof renderCurrentView === "function") {
          renderCurrentView(latestRoot);
        }
        if (typeof renderThread === "function") {
          renderThread(latestRoot);
        }
      }
      logEvent("Q100", {
        vw: normalize(state.currentView || ""),
        hs: normalize(window.location.hash || "").slice(0, 60),
        mc: finalTimeline.length,
        tc: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : threadIds.length,
        oc: outgoingCount,
        ic: Math.max(0, finalTimeline.length - outgoingCount),
        ac: extractEmail(state.activeContactEmail || ""),
        cl: Boolean(state.contactChatLoading)
      });
      if (outgoingCount > 0) {
        closeHydrationRun("complete", {
          mc: finalTimeline.length,
          tc: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : threadIds.length,
          oc: outgoingCount,
          rs: hydrationReason || (forceDeepHydration ? "fallback" : "open")
        });
      } else {
        closeHydrationRun("failed", {
          rc: 6,
          rs: "no-outgoing-after-hydration",
          mc: finalTimeline.length,
          tc: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : threadIds.length,
          oc: 0
        });
      }
    })().catch((error) => {
      const stillActive = isStillActiveContactChat();
      if (stillActive) {
        state.contactChatLoading = false;
        state.contactHydrationInFlight = false;
      }
      if (typeof diagFail === "function") {
        diagFail("H199", error, {
          runId: hydrationDiagRunId,
          rc: 9,
          ce: conversationContext.contactEmail || contactEmail || "",
          ck: conversationContext.conversationKey || ""
        });
      } else {
        logEvent("H199", {
          runId: hydrationDiagRunId,
          rc: 9,
          ce: conversationContext.contactEmail || contactEmail || ""
        });
      }
      logWarn(`Contact thread merge failed: ${normalize(error && error.message ? error.message : String(error || ""))}`);
      const latestRoot = getRoot();
      if (stillActive && latestRoot instanceof HTMLElement) {
        const renderCurrentView = resolveRenderCurrentView();
        const renderThread = resolveRenderThread();
        if (typeof renderCurrentView === "function") {
          renderCurrentView(latestRoot);
        }
        if (typeof renderThread === "function") {
          renderThread(latestRoot);
        }
      }
      logEvent("Q100", {
        vw: normalize(state.currentView || ""),
        hs: normalize(window.location.hash || "").slice(0, 60),
        mc: Array.isArray(state.activeTimelineMessages) ? state.activeTimelineMessages.length : 0,
        tc: Array.isArray(state.contactThreadIds) ? state.contactThreadIds.length : 0,
        oc: 0,
        ic: 0,
        ac: extractEmail(state.activeContactEmail || ""),
        cl: Boolean(state.contactChatLoading)
      });
      closeHydrationRun("failed", {
        rc: 9,
        rs: "contact-thread-merge-failed"
      });
    }).finally(() => {
      state.contactHydrationInFlight = false;
      state.contactChatLoading = false;
      if (!hydrationRunClosed) {
        logEvent("H199", {
          runId: hydrationDiagRunId,
          rc: 9,
          rs: "missing-terminal"
        });
        closeHydrationRun("failed", {
          rc: 9,
          rs: "missing-terminal"
        });
      }
    });
  }

    return {
      contactMessageSourceRank,
      mergeContactMessagesByThread,
      buildSeededMessagesByThread,
      waitForRowStability,
      discoverThreadIds,
      appendMessagesToTimeline,
      fetchAndRenderThreads,
      loadContactChat
    };
  };
})();
