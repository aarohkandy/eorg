(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createMessageNormalizationApi = function createMessageNormalizationApi(deps = {}) {
    const {
      THREAD_NO_CONTENT,
      OPTIMISTIC_RECONCILE_WINDOW_MS,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      hashString,
      activeConversationContext,
      classifyMessageDirection,
      messagePartySnapshot,
      conversationKeyFromContact,
      activeConversationContactEmail,
      detectCurrentUserEmail,
      lookupThreadHintHref,
      getThreadHashForMailbox,
      getMergeMailboxCache,
      logChatDebug
    } = deps;
    const threadHashForMailbox = (...args) => {
      const fn = typeof getThreadHashForMailbox === "function" ? getThreadHashForMailbox() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const mergeMailboxCache = (...args) => {
      const fn = typeof getMergeMailboxCache === "function" ? getMergeMailboxCache() : null;
      if (typeof fn !== "function") return [];
      return fn(...args);
    };
  function cleanThreadMessageBody(rawText, rawHtml) {
    const temp = document.createElement("div");
    temp.innerHTML = rawHtml || "";
    temp.querySelectorAll("script, style, meta, link, iframe, object, embed").forEach((el) => el.remove());
    temp.querySelectorAll(".gmail_quote, .gmail_attr, blockquote").forEach((el) => el.remove());
    const htmlText = temp.innerText || temp.textContent || "";

    const textSource = String(rawText || "").trim();
    const htmlSource = String(htmlText || "").trim();
    let text = textSource || htmlSource;
    if (htmlSource && (!text || /^on\s.+\swrote:/i.test(text) || text.length > htmlSource.length * 1.6)) {
      text = htmlSource;
    }
    if (!text) return "";

    text = text
      .replace(/\u00a0/g, " ")
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t\f\v]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const markerPatterns = [
      /\bOn\s.+\swrote:\s*/i,
      /^\s*From:\s.+$/im,
      /^\s*Sent:\s.+$/im,
      /^\s*To:\s.+$/im,
      /^\s*Subject:\s.+$/im,
      /^-{2,}\s*Forwarded message\s*-{2,}/im
    ];
    let markerIndex = -1;
    for (const pattern of markerPatterns) {
      const match = pattern.exec(text);
      if (!match) continue;
      if (markerIndex === -1 || match.index < markerIndex) {
        markerIndex = match.index;
      }
    }
    if (markerIndex >= 0) {
      text = text.slice(0, markerIndex).trim();
    }

    const lines = text.split("\n");
    const kept = [];
    for (const rawLine of lines) {
      if (rawLine.trimStart().startsWith(">")) break;
      const line = rawLine.trim();
      if (!line) {
        if (kept.length === 0 || kept[kept.length - 1] === "") continue;
        kept.push("");
        continue;
      }
      kept.push(line);
    }

    const dedupedAdjacent = [];
    for (const line of kept) {
      const prev = dedupedAdjacent[dedupedAdjacent.length - 1];
      if (
        typeof prev === "string"
        && prev !== ""
        && line !== ""
        && prev.toLowerCase() === line.toLowerCase()
      ) {
        continue;
      }
      if (line === "" && prev === "") continue;
      dedupedAdjacent.push(line);
    }

    return dedupedAdjacent.join("\n").trim();
  }

  function isLikelyMetadataBlob(text) {
    const value = normalize(text || "");
    if (!value) return false;
    const lower = value.toLowerCase();
    const hasEmail = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(value);
    const hasDate = /\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b/i.test(value);
    const hasTime = /\b\d{1,2}:\d{2}\s?(?:am|pm)\b/i.test(lower);
    const hasAgo = /\(\d+\s+(?:minute|hour|day|week|month)s?\s+ago\)/i.test(value);
    const hasWriteHeader = /\bon .+ wrote:\b/i.test(lower);
    const repeatedPhrase = /(.*\b.{12,}\b).*\1/i.test(value);
    if (hasWriteHeader) return true;
    if (hasAgo && hasTime) return true;
    if (hasEmail && (hasDate || hasTime || hasAgo)) return true;
    if (hasDate && hasTime && value.length > 120) return true;
    if (repeatedPhrase && (hasDate || hasTime)) return true;
    return false;
  }

  function safeThreadFallbackText(text) {
    const cleaned = cleanThreadMessageBody(text || "", "");
    if (!cleaned) return "";
    const stripped = cleaned.replace(/^\s*[-*]+\s+/, "").trim();
    if (!stripped) return "";
    if (isLikelyMetadataBlob(stripped)) return "";
    return stripped;
  }

  function normalizeMessageDateToken(value) {
    const raw = normalize(value || "").toLowerCase();
    if (!raw) return "";
    return raw
      .replace(/[(),]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function parseThreadTimestampForOrder(value) {
    const raw = normalize(value || "");
    if (!raw) return 0;
    const hasExplicitYear = /\b\d{4}\b/.test(raw) || /\b\d{1,2}\/\d{1,2}\/\d{2,4}\b/.test(raw);
    if (!hasExplicitYear) return 0;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function buildFallbackMessageKey(message, threadId = "", sourceIndex = 0) {
    const msg = message && typeof message === "object" ? message : {};
    const thread = canonicalThreadId(threadId || msg.threadId || "");
    const sender = normalize(msg.senderEmail || msg.sender || "").toLowerCase();
    const dateToken = normalizeMessageDateToken(msg.date || "");
    const sourceType = normalize(msg.sourceType || (msg.isOptimistic ? "optimistic" : "fallback")) || "fallback";
    const body = normalize(msg.cleanBodyText || msg.bodyText || "");
    const bodyHash = hashString(body.toLowerCase());
    const stableSourceIndex = Number.isFinite(Number(sourceIndex)) ? Number(sourceIndex) : 0;
    return `fb:${thread}:${sender}:${dateToken}:${bodyHash}:${sourceType}:${stableSourceIndex}`;
  }

  function messageSourceForChat(sourceType) {
    const source = normalize(sourceType || "").toLowerCase();
    if (source === "captured") return "gmail_dom";
    if (source === "fallback" || source === "seeded") return "cache";
    return "inferred";
  }

  function buildThreadMessageKey(message, index = 0, threadId = "", sourceIndex = 0) {
    const existing = normalize(message && message.messageKey);
    if (existing) return existing;
    const dataMessageId = normalize(message && (message.messageId || message.dataMessageId));
    if (dataMessageId) return `mid:${dataMessageId}`;
    if (normalize(message && message.clientSendId)) {
      return `opt:${normalize(message.clientSendId)}`;
    }
    return buildFallbackMessageKey(message, threadId, sourceIndex || index);
  }

  function normalizeThreadMessageForChat(message, context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const threadId = canonicalThreadId(context.threadId || msg.threadId || "") || normalize(context.threadId || msg.threadId || "");
    const sender = normalize(msg.sender || "") || "Unknown sender";
    const cleanedBody = cleanThreadMessageBody(msg.bodyText || "", msg.bodyHtml || "");
    const bodyText = cleanedBody || normalize(msg.bodyText || "") || THREAD_NO_CONTENT;
    const direction = normalize(context.direction || msg.direction || "");
    const sourceType = normalize(context.sourceType || msg.sourceType || "")
      || (
        msg.isOptimistic ? "optimistic"
          : (msg.isSeededPlaceholder ? "seeded" : (normalize(msg.dataMessageId || "") ? "captured" : "fallback"))
      );
    const deliveryState = normalize(msg.deliveryState || msg.optimisticStatus || (msg.isOptimistic ? "pending" : ""));
    const clientSendId = normalize(msg.clientSendId || "");
    const sourceIndex = Number.isFinite(Number(context.sourceIndex || msg.sourceIndex))
      ? Number(context.sourceIndex || msg.sourceIndex)
      : Number(context.index || 0);
    const explicitTimestamp = Number(msg.timestampMs || msg.optimisticAt || msg.optimisticDeliveredAt || msg.optimisticFailedAt || 0);
    const timestampMs = explicitTimestamp > 0 ? explicitTimestamp : parseThreadTimestampForOrder(msg.date || "");
    const conversationContext = activeConversationContext({
      ...context,
      activeAccountEmail: context.activeAccountEmail || msg.activeAccountEmail || state.activeAccountEmail,
      contactEmail: context.contactEmail || msg.contactEmail || state.activeContactEmail,
      conversationKey: context.conversationKey || msg.conversationKey || state.activeConversationKey
    });
    const parties = messagePartySnapshot(
      {
        ...msg,
        sender
      },
      conversationContext
    );
    const senderEmail = parties.senderEmail || extractEmail(msg.senderEmail || sender);
    const recipientEmails = parties.recipientEmails || [];
    const participants = parties.participants || [];
    const conversationKey = normalize(
      context.conversationKey
      || msg.conversationKey
      || conversationContext.conversationKey
      || conversationKeyFromContact(conversationContext.contactEmail || "")
    );
    const messageId = normalize(msg.messageId || msg.dataMessageId || "");
    const status = deliveryState || "";
    const messageKey = buildThreadMessageKey(
      {
        ...msg,
        sender,
        senderEmail,
        recipientEmails,
        participants,
        conversationKey,
        messageId,
        cleanBodyText: bodyText,
        sourceType,
        clientSendId
      },
      Number(context.index || 0),
      threadId,
      sourceIndex
    );
    return {
      ...msg,
      threadId,
      sender,
      senderEmail,
      recipientEmails,
      participants,
      messageId,
      id: normalize(msg.id || messageKey) || messageKey,
      conversationKey,
      cleanBodyText: bodyText,
      bodyText,
      bodyHtml: "",
      messageKey,
      sourceType,
      source: messageSourceForChat(sourceType),
      clientSendId: clientSendId || "",
      deliveryState: status,
      status,
      timestampMs,
      sourceIndex,
      isOptimistic: sourceType === "optimistic" || Boolean(msg.isOptimistic),
      direction: direction || classifyMessageDirection(
        { ...msg, sender, senderEmail, recipientEmails, participants },
        threadId,
        conversationContext
      ) || "unknown"
    };
  }

  function normalizeThreadMessagesForChat(messages, threadId = "", context = {}) {
    const out = [];
    const seenKeys = new Set();
    for (let i = 0; i < (Array.isArray(messages) ? messages.length : 0); i += 1) {
      const next = normalizeThreadMessageForChat(messages[i], { ...context, threadId, index: i, sourceIndex: i });
      const key = normalize(next.messageKey || "");
      if (key && seenKeys.has(key)) continue;
      if (key) seenKeys.add(key);
      out.push(next);
    }
    const canonicalByThread = new Set(
      out
        .filter((msg) => !msg.isSeededPlaceholder && msg.sourceType !== "seeded")
        .map((msg) => canonicalThreadId(msg.threadId || threadId))
        .filter(Boolean)
    );
    return out.filter((msg) => {
      if (!msg.isSeededPlaceholder && msg.sourceType !== "seeded") return true;
      const key = canonicalThreadId(msg.threadId || threadId);
      return !key || !canonicalByThread.has(key);
    });
  }

  function optimisticStoreKeyForThread(threadId) {
    const key = canonicalThreadId(threadId);
    return normalize(key || threadId || "");
  }

  function replyDraftStoreKey(threadId) {
    return optimisticStoreKeyForThread(threadId);
  }

  function getReplyDraft(threadId) {
    const key = replyDraftStoreKey(threadId);
    if (!key) return "";
    return normalize(state.replyDraftByThread[key] || "") ? state.replyDraftByThread[key] : "";
  }

  function setReplyDraft(threadId, text) {
    const key = replyDraftStoreKey(threadId);
    if (!key) return;
    const value = String(text || "");
    if (!normalize(value)) {
      delete state.replyDraftByThread[key];
      return;
    }
    state.replyDraftByThread[key] = value;
  }

  function getOptimisticMessagesForThread(threadId) {
    const key = optimisticStoreKeyForThread(threadId);
    if (!key) return [];
    const list = state.optimisticMessagesByThread[key];
    return Array.isArray(list) ? list.slice() : [];
  }

  function setOptimisticMessagesForThread(threadId, messages) {
    const key = optimisticStoreKeyForThread(threadId);
    if (!key) return;
    const next = Array.isArray(messages) ? messages.filter((m) => m && typeof m === "object") : [];
    if (next.length === 0) {
      delete state.optimisticMessagesByThread[key];
      return;
    }
    state.optimisticMessagesByThread[key] = next;
  }

  function ensureContactThreadTracked(threadId) {
    const canonical = canonicalThreadId(threadId || "") || normalize(threadId || "");
    if (!canonical) return;
    if (!Array.isArray(state.contactThreadIds)) {
      state.contactThreadIds = [canonical];
      return;
    }
    const exists = state.contactThreadIds.some((value) => {
      const next = canonicalThreadId(value || "") || normalize(value || "");
      return next === canonical;
    });
    if (!exists) {
      state.contactThreadIds.push(canonical);
      logChatDebug("contact-chat:thread-appended", {
        addedThreadId: canonical,
        totalThreads: state.contactThreadIds.length,
        conversationKey: normalize(state.activeConversationKey || "")
      }, { throttleKey: `contact-thread-appended:${canonical}`, throttleMs: 500 });
    }
  }

  function formatTimeForMessageDate(timestampMs) {
    const ts = Number(timestampMs || 0);
    if (ts > 0) {
      try {
        return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      } catch (_) {
        // ignore locale formatting errors
      }
    }
    return "";
  }

  function appendLocalSentCacheEntry(threadId, bodyText, context = {}, timestampMs = Date.now(), hintHref = "") {
    const canonical = canonicalThreadId(threadId || "") || normalize(threadId || "");
    const text = normalize(bodyText || "");
    if (!canonical || !text) return;
    const conversationContext = activeConversationContext(context);
    const accountEmail = extractEmail(conversationContext.activeAccountEmail || detectCurrentUserEmail() || "");
    const contactEmail = extractEmail(conversationContext.contactEmail || activeConversationContactEmail() || "");
    const dateLabel = formatTimeForMessageDate(timestampMs);
    const subjectFallback = contactEmail ? `Chat with ${contactEmail}` : "Sent message";
    const entry = {
      threadId: canonical,
      sender: accountEmail || "You",
      senderEmail: accountEmail || "",
      recipientEmails: contactEmail ? [contactEmail] : [],
      subject: subjectFallback,
      snippet: text.slice(0, 220),
      bodyText: text,
      date: dateLabel,
      href: normalize(hintHref || lookupThreadHintHref(canonical) || threadHashForMailbox("sent", canonical, hintHref || "")),
      row: null,
      triageLevel: "",
      unread: false,
      mailbox: "sent"
    };
    mergeMailboxCache("sent", [entry]);
    logChatDebug("sent-cache:append-local", {
      threadId: canonical,
      contactEmail,
      activeAccountEmail: accountEmail,
      snippetLen: entry.snippet.length
    }, { throttleKey: `sent-cache-append:${canonical}`, throttleMs: 500 });
  }

  function appendOptimisticOutgoingMessage(text, threadId) {
    const body = cleanThreadMessageBody(text || "", "");
    if (!body) return null;
    const canonicalThreadIdForMessage = canonicalThreadId(threadId || "") || normalize(threadId || "");
    if (!canonicalThreadIdForMessage) return null;
    const nowMs = Date.now();
    const now = new Date(nowMs);
    const clientSendId = `cs:${nowMs}:${hashString(`${canonicalThreadIdForMessage}|${body}|${Math.random()}`)}`;
    const userEmail = detectCurrentUserEmail();
    const optimistic = normalizeThreadMessageForChat({
      threadId: canonicalThreadIdForMessage,
      sender: userEmail || "You",
      senderEmail: userEmail || "",
      date: now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
      bodyText: body,
      messageKey: `opt:${clientSendId}`,
      clientSendId,
      isOptimistic: true,
      sourceType: "optimistic",
      deliveryState: "pending",
      optimisticStatus: "pending",
      optimisticAt: nowMs,
      direction: "outgoing"
    }, { threadId: canonicalThreadIdForMessage, direction: "outgoing" });
    const current = getOptimisticMessagesForThread(canonicalThreadIdForMessage);
    current.push(optimistic);
    setOptimisticMessagesForThread(canonicalThreadIdForMessage, current);
    return optimistic;
  }

  function removeOptimisticMessage(threadId, messageKey) {
    const key = normalize(messageKey || "");
    if (!key) return;
    const current = getOptimisticMessagesForThread(threadId);
    const next = current.filter((item) => normalize(item && item.messageKey) !== key);
    setOptimisticMessagesForThread(threadId, next);
  }

  function markOptimisticMessageDelivered(threadId, messageKey) {
    const key = normalize(messageKey || "");
    if (!key) return;
    const current = getOptimisticMessagesForThread(threadId);
    const next = current.map((item) => (
      normalize(item && item.messageKey) === key
        ? { ...item, deliveryState: "sent", optimisticStatus: "sent", optimisticDeliveredAt: Date.now() }
        : item
    ));
    setOptimisticMessagesForThread(threadId, next);
  }

  function markOptimisticMessageFailed(threadId, messageKey) {
    const key = normalize(messageKey || "");
    if (!key) return;
    const current = getOptimisticMessagesForThread(threadId);
    const next = current.map((item) => (
      normalize(item && item.messageKey) === key
        ? { ...item, deliveryState: "failed", optimisticStatus: "failed", optimisticFailedAt: Date.now() }
        : item
    ));
    setOptimisticMessagesForThread(threadId, next);
  }

  function updateOptimisticInMergedMessages(threadId, messageKey, patch = null) {
    if (!Array.isArray(state.mergedMessages) || state.mergedMessages.length === 0) return;
    const canonicalTarget = canonicalThreadId(threadId);
    const key = normalize(messageKey || "");
    if (!key) return;
    let changed = false;
    state.mergedMessages = state.mergedMessages
      .map((msg) => {
        if (!msg || typeof msg !== "object") return msg;
        if (canonicalThreadId(msg.threadId || "") !== canonicalTarget) return msg;
        if (normalize(msg.messageKey || "") !== key) return msg;
        changed = true;
        if (!patch) return null;
        return { ...msg, ...patch };
      })
      .filter(Boolean);
    if (!changed) return;
  }

  function mergeOptimisticIntoMessages(messages, threadId) {
    const list = Array.isArray(messages) ? messages.slice() : [];
    const optimistic = getOptimisticMessagesForThread(threadId);
    if (optimistic.length === 0) return list;
    const existingKeys = new Set(
      list.map((msg) => normalize(msg && msg.messageKey)).filter(Boolean)
    );
    const merged = list.slice();
    for (const item of optimistic) {
      const key = normalize(item && item.messageKey);
      if (key && existingKeys.has(key)) continue;
      merged.push(item);
    }
    return merged;
  }

  function reconcileOptimisticMessagesWithCanonical(threadId, canonicalMessages, preferredOptimistic = null) {
    const current = getOptimisticMessagesForThread(threadId);
    if (current.length === 0) return { changed: false, matchedKeys: [] };
    const outgoingCanonical = (Array.isArray(canonicalMessages) ? canonicalMessages : [])
      .filter((msg) => normalize(msg && msg.direction) === "outgoing")
      .map((msg) => ({
        hash: hashString(normalize(msg && msg.cleanBodyText).toLowerCase()),
        timestampMs: Number(msg && msg.timestampMs || 0),
        message: msg
      }))
      .filter((item) => Boolean(item.hash));

    if (outgoingCanonical.length === 0) return { changed: false, matchedKeys: [] };

    const preferredKey = normalize(preferredOptimistic && preferredOptimistic.messageKey);
    const pending = current.slice().sort((a, b) => Number(a.optimisticAt || 0) - Number(b.optimisticAt || 0));
    const matchedKeys = [];
    const usedPending = new Set();
    const now = Date.now();
    for (const item of outgoingCanonical) {
      const canonicalTs = item.timestampMs > 0 ? item.timestampMs : now;
      let candidateIndex = -1;
      let bestDelta = Number.POSITIVE_INFINITY;
      for (let idx = 0; idx < pending.length; idx += 1) {
        if (usedPending.has(idx)) continue;
        const msg = pending[idx];
        const bodyHash = hashString(normalize(msg && msg.cleanBodyText).toLowerCase());
        if (bodyHash !== item.hash) continue;
        const optimisticTs = Number(msg && msg.optimisticAt || 0);
        const delta = optimisticTs > 0 ? Math.abs(canonicalTs - optimisticTs) : 0;
        if (optimisticTs > 0 && delta > OPTIMISTIC_RECONCILE_WINDOW_MS) continue;
        if (preferredKey && normalize(msg && msg.messageKey) === preferredKey) {
          candidateIndex = idx;
          bestDelta = -1;
          break;
        }
        if (delta < bestDelta) {
          bestDelta = delta;
          candidateIndex = idx;
        }
      }
      if (candidateIndex < 0) continue;
      usedPending.add(candidateIndex);
      const candidate = pending[candidateIndex];
      if (candidate && normalize(candidate.messageKey)) {
        matchedKeys.push(normalize(candidate.messageKey));
      }
    }

    if (matchedKeys.length === 0) return { changed: false, matchedKeys: [] };

    const matchedSet = new Set(matchedKeys);
    const next = current.filter((msg) => !matchedSet.has(normalize(msg && msg.messageKey)));
    setOptimisticMessagesForThread(threadId, next);
    return { changed: true, matchedKeys };
  }


    return {
      cleanThreadMessageBody,
      isLikelyMetadataBlob,
      safeThreadFallbackText,
      normalizeMessageDateToken,
      parseThreadTimestampForOrder,
      buildFallbackMessageKey,
      messageSourceForChat,
      buildThreadMessageKey,
      normalizeThreadMessageForChat,
      normalizeThreadMessagesForChat,
      optimisticStoreKeyForThread,
      replyDraftStoreKey,
      getReplyDraft,
      setReplyDraft,
      getOptimisticMessagesForThread,
      setOptimisticMessagesForThread,
      ensureContactThreadTracked,
      formatTimeForMessageDate,
      appendLocalSentCacheEntry,
      appendOptimisticOutgoingMessage,
      removeOptimisticMessage,
      markOptimisticMessageDelivered,
      markOptimisticMessageFailed,
      updateOptimisticInMergedMessages,
      mergeOptimisticIntoMessages,
      reconcileOptimisticMessagesWithCanonical
    };
  };
})();
