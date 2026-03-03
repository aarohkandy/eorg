(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createContactTimelineCoreApi = function createContactTimelineCoreApi(deps = {}) {
    const {
      ENABLE_CONTACT_MERGE_MODE,
      CONTACT_TIMELINE_V2_ENABLED,
      CONTACT_OPEN_DEFERRED_YIELD_EVERY,
      state,
      normalize,
      activeConversationContext,
      mailboxCacheKey,
      canonicalThreadId,
      extractEmail,
      normalizeEmailList,
      normalizeMessageDateToken,
      parseThreadTimestampForOrder,
      messageDateSortValue,
      hashString,
      hashFromHref,
      normalizeThreadMessageForChat,
      detectCurrentUserEmail,
      messagePartySnapshot,
      contactKeyFromMessage,
      isSelfSenderLabel,
      summarizeChatMessagesForDebug,
      yieldToMainThread
    } = deps;

  function isContactTimelineV2Enabled() {
    return Boolean(ENABLE_CONTACT_MERGE_MODE && CONTACT_TIMELINE_V2_ENABLED);
  }

  function isContactTimelineV2Active() {
    return Boolean(
      isContactTimelineV2Enabled()
      && normalize(state.activeConversationKey || "")
      && normalize(state.activeContactEmail || "")
    );
  }

  function contactTimelineSourceRank(source) {
    const normalized = normalize(source || "").toLowerCase();
    // Prefer mailbox cache ordering over transient live-row snapshots for tie-break stability.
    if (normalized === "row_cache") return 0;
    if (normalized === "row_live") return 1;
    if (normalized === "optimistic") return 2;
    return 3;
  }

  function parseTimelineRowTimestampMs(rowMessage) {
    const msg = rowMessage && typeof rowMessage === "object" ? rowMessage : {};
    const explicit = Number(msg.timestampMs || msg.optimisticAt || 0);
    if (explicit > 0) return explicit;
    const rawDate = normalize(msg.date || "");
    if (!rawDate) return 0;

    const parsedExplicit = parseThreadTimestampForOrder(rawDate);
    if (parsedExplicit > 0) return parsedExplicit;

    const fallbackMessageSort = messageDateSortValue({ date: rawDate });
    if (fallbackMessageSort > 0) return fallbackMessageSort;

    const direct = Date.parse(rawDate);
    if (Number.isFinite(direct) && direct > 0) return direct;

    if (/^[A-Za-z]{3}\s+\d{1,2}$/i.test(rawDate)) {
      const year = new Date().getFullYear();
      const withYear = Date.parse(`${rawDate}, ${year} 12:00 PM`);
      if (Number.isFinite(withYear) && withYear > 0) return withYear;
    }

    if (/^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(rawDate)) {
      const today = new Date();
      const withToday = Date.parse(`${today.toDateString()} ${rawDate}`);
      if (Number.isFinite(withToday) && withToday > 0) return withToday;
    }

    return 0;
  }

  function normalizeTimelineRowMessageV2(rowMessage, context = {}, source = "row_live", rowOrder = 0) {
    const msg = rowMessage && typeof rowMessage === "object" ? rowMessage : {};
    const conversationContext = activeConversationContext(context);
    const mailbox = mailboxCacheKey(msg.mailbox || "inbox");
    const threadId = canonicalThreadId(msg.threadId || "") || normalize(msg.threadId || "");
    if (!threadId) return null;

    const senderRaw = normalize(msg.sender || "");
    let senderEmail = extractEmail(msg.senderEmail || senderRaw);
    if (!senderEmail && mailbox === "sent" && conversationContext.activeAccountEmail) {
      senderEmail = conversationContext.activeAccountEmail;
    }
    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.ariaLabel,
      msg.row instanceof HTMLElement ? msg.row.getAttribute("aria-label") : "",
      msg.row instanceof HTMLElement ? normalize(msg.row.innerText || msg.row.textContent || "").slice(0, 620) : ""
    ]).filter((email) => email && email !== senderEmail);
    const participants = normalizeEmailList([
      senderEmail,
      recipientEmails,
      msg.participants
    ]);

    const bodyText = normalize(msg.bodyText || msg.snippet || "");
    const dateLabel = normalize(msg.date || "");
    const dateToken = normalizeMessageDateToken(dateLabel);
    const timestampMs = parseTimelineRowTimestampMs(msg);
    const messageId = normalize(msg.messageId || msg.dataMessageId || "");
    const snippetHash = hashString(`${normalize(msg.subject || "").toLowerCase()}|${bodyText.toLowerCase()}`);
    const hrefToken = normalize(hashFromHref(msg.href || "") || msg.href || "");
    const fallbackDiscriminator = hrefToken || `ord:${Number(rowOrder || 0)}`;
    const rowKey = messageId
      ? `mid:${messageId}`
      : [
        "row",
        mailbox,
        threadId,
        normalize(senderEmail || senderRaw).toLowerCase(),
        dateToken,
        snippetHash,
        fallbackDiscriminator
      ].join("|");

    let direction = "unknown";
    const activeEmail = extractEmail(conversationContext.activeAccountEmail || "");
    if (source === "optimistic") {
      if (!senderEmail) {
        senderEmail = extractEmail(
          conversationContext.activeAccountEmail
          || msg.senderEmail
          || detectCurrentUserEmail()
          || ""
        );
      }
      direction = "outgoing";
    } else if (senderEmail && activeEmail && senderEmail === activeEmail) {
      direction = "outgoing";
    } else if (senderEmail && (!activeEmail || senderEmail !== activeEmail)) {
      direction = "incoming";
    }

    const normalized = normalizeThreadMessageForChat({
      threadId,
      mailbox,
      sender: senderRaw || senderEmail || "Unknown sender",
      senderEmail: senderEmail || "",
      recipientEmails,
      participants,
      date: dateLabel,
      bodyText,
      snippet: normalize(msg.snippet || ""),
      subject: normalize(msg.subject || ""),
      messageId,
      dataMessageId: messageId,
      conversationKey: normalize(conversationContext.conversationKey || ""),
      messageKey: rowKey,
      direction,
      sourceType: source === "optimistic" ? "optimistic" : "fallback",
      isOptimistic: source === "optimistic" || Boolean(msg.isOptimistic),
      deliveryState: normalize(msg.deliveryState || msg.optimisticStatus || ""),
      optimisticStatus: normalize(msg.optimisticStatus || ""),
      optimisticAt: Number(msg.optimisticAt || 0),
      clientSendId: normalize(msg.clientSendId || ""),
      timestampMs,
      sourceIndex: Number(rowOrder || 0)
    }, {
      ...conversationContext,
      threadId,
      sourceIndex: Number(rowOrder || 0),
      index: Number(rowOrder || 0),
      direction
    });

    return {
      ...normalized,
      id: rowKey,
      messageKey: rowKey,
      conversationKey: normalize(conversationContext.conversationKey || ""),
      source,
      sourceType: source,
      mailbox,
      dateToken,
      timestampMs,
      rowOrder: Number(rowOrder || 0)
    };
  }

  function messageBelongsToContactTimelineV2(message, context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const conversationContext = activeConversationContext(context);
    const contactEmail = extractEmail(conversationContext.contactEmail || "");
    const activeAccountEmail = extractEmail(conversationContext.activeAccountEmail || "");
    if (!contactEmail) return false;
    const sourceType = normalize(msg.sourceType || msg.source || "").toLowerCase();
    if (sourceType === "optimistic" || Boolean(msg.isOptimistic)) return true;

    const parties = messagePartySnapshot(msg, conversationContext);
    const participantSet = new Set(Array.isArray(parties.participants) ? parties.participants : []);
    const senderEmail = extractEmail(parties.senderEmail || "");
    const inferredContact = extractEmail(contactKeyFromMessage(msg));
    const hasContact = participantSet.has(contactEmail) || senderEmail === contactEmail || inferredContact === contactEmail;
    if (!hasContact) return false;

    const isGroup = participantSet.size > 2;
    if (!activeAccountEmail) {
      if (isGroup) return false;
      return hasContact;
    }
    if (isGroup) {
      return participantSet.has(contactEmail) && participantSet.has(activeAccountEmail);
    }
    if (participantSet.has(activeAccountEmail) || senderEmail === activeAccountEmail) return true;

    const mailbox = mailboxCacheKey(msg.mailbox || "");
    const senderLooksSelf = senderEmail === activeAccountEmail || isSelfSenderLabel(msg.sender || "");
    const senderLooksContact = senderEmail === contactEmail;
    if (senderLooksSelf && (mailbox === "sent" || inferredContact === contactEmail)) return true;
    if (senderLooksContact && mailbox !== "sent") return true;
    return false;
  }

  function buildContactTimelineFromRows(context = {}, sources = {}) {
    const conversationContext = activeConversationContext(context);
    const liveRows = Array.isArray(sources.liveRows) ? sources.liveRows : [];
    const inboxCached = Array.isArray(sources.inboxCached) ? sources.inboxCached : [];
    const sentCached = Array.isArray(sources.sentCached) ? sources.sentCached : [];
    const extraRows = Array.isArray(sources.extraRows) ? sources.extraRows : [];
    const optimisticRows = Array.isArray(sources.optimisticRows) ? sources.optimisticRows : [];

    const normalizedPool = [];
    const sourceStats = { row_live: 0, row_cache: 0, optimistic: 0 };
    const pushRows = (rows, source) => {
      for (let index = 0; index < rows.length; index += 1) {
        const normalized = normalizeTimelineRowMessageV2(rows[index], conversationContext, source, index);
        if (!normalized) continue;
        normalizedPool.push(normalized);
        sourceStats[source] = Number(sourceStats[source] || 0) + 1;
      }
    };

    pushRows(liveRows, "row_live");
    pushRows(inboxCached, "row_cache");
    pushRows(sentCached, "row_cache");
    pushRows(extraRows, "row_live");
    pushRows(optimisticRows, "optimistic");

    const filtered = [];
    let droppedNoContactMatch = 0;
    for (const message of normalizedPool) {
      if (!messageBelongsToContactTimelineV2(message, conversationContext)) {
        droppedNoContactMatch += 1;
        continue;
      }
      filtered.push(message);
    }

    const deduped = [];
    const seenMessageIds = new Set();
    const seenFallbackKeys = new Set();
    let dedupByMessageId = 0;
    let dedupByFallback = 0;
    for (const message of filtered) {
      const messageId = normalize(message.messageId || message.dataMessageId || "");
      if (messageId) {
        if (seenMessageIds.has(messageId)) {
          dedupByMessageId += 1;
          continue;
        }
        seenMessageIds.add(messageId);
      } else {
        const canonicalThread = canonicalThreadId(message.threadId || "") || normalize(message.threadId || "");
        const senderEmail = extractEmail(message.senderEmail || message.sender || "");
        const direction = normalize(message.direction || "");
        const timestampMs = Number(message.timestampMs || 0);
        const dateToken = normalizeMessageDateToken(message.date || "");
        const bodyFingerprint = hashString(normalize(
          message.cleanBodyText
          || message.bodyText
          || message.snippet
          || ""
        ).toLowerCase());
        const fallbackKey = [
          canonicalThread,
          senderEmail,
          direction,
          timestampMs,
          dateToken,
          bodyFingerprint
        ].join("|");
        if (!fallbackKey) continue;
        if (seenFallbackKeys.has(fallbackKey)) {
          dedupByFallback += 1;
          continue;
        }
        seenFallbackKeys.add(fallbackKey);
      }
      deduped.push(message);
    }

    const messages = deduped
      .slice()
      .sort((a, b) => {
        const ta = Number(a.timestampMs || 0);
        const tb = Number(b.timestampMs || 0);
        if (ta !== tb) return ta - tb;
        const sa = contactTimelineSourceRank(a.source || a.sourceType || "");
        const sb = contactTimelineSourceRank(b.source || b.sourceType || "");
        if (sa !== sb) return sa - sb;
        const ra = Number(a.rowOrder || 0);
        const rb = Number(b.rowOrder || 0);
        if (ra !== rb) return ra - rb;
        return normalize(a.id || a.messageKey || "").localeCompare(normalize(b.id || b.messageKey || ""));
      });

    const threadLatestAt = new Map();
    for (const message of messages) {
      const threadId = canonicalThreadId(message.threadId || "") || normalize(message.threadId || "");
      if (!threadId) continue;
      const stamp = Number(message.timestampMs || 0);
      const current = Number(threadLatestAt.get(threadId) || 0);
      if (stamp >= current) threadLatestAt.set(threadId, stamp);
    }
    const threadIds = Array.from(threadLatestAt.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]));
      })
      .map((entry) => entry[0]);

    const metrics = {
      conversationKey: normalize(conversationContext.conversationKey || ""),
      contactEmail: extractEmail(conversationContext.contactEmail || ""),
      activeAccountEmail: extractEmail(conversationContext.activeAccountEmail || ""),
      sourceCounts: sourceStats,
      poolCount: normalizedPool.length,
      filteredCount: filtered.length,
      droppedNoContactMatch,
      dedupByMessageId,
      dedupByFallback,
      finalCount: messages.length,
      threadCount: threadIds.length,
      sample: summarizeChatMessagesForDebug(messages, 8)
    };

    return { context: conversationContext, messages, threadIds, metrics };
  }

  async function buildContactTimelineFromRowsChunked(context = {}, sources = {}, options = {}) {
    const conversationContext = activeConversationContext(context);
    const liveRows = Array.isArray(sources.liveRows) ? sources.liveRows : [];
    const inboxCached = Array.isArray(sources.inboxCached) ? sources.inboxCached : [];
    const sentCached = Array.isArray(sources.sentCached) ? sources.sentCached : [];
    const extraRows = Array.isArray(sources.extraRows) ? sources.extraRows : [];
    const optimisticRows = Array.isArray(sources.optimisticRows) ? sources.optimisticRows : [];
    const yieldEvery = Math.max(8, Number(options.yieldEvery || CONTACT_OPEN_DEFERRED_YIELD_EVERY));
    const isStale = typeof options.isStale === "function" ? options.isStale : () => false;
    const onChunk = typeof options.onChunk === "function" ? options.onChunk : null;
    if (isStale()) return null;

    const normalizedPool = [];
    const sourceStats = { row_live: 0, row_cache: 0, optimistic: 0 };
    let processedCount = 0;
    const maybeYield = async (stage) => {
      if (isStale()) return false;
      if (processedCount > 0 && processedCount % yieldEvery === 0) {
        if (onChunk) {
          onChunk({
            stage,
            processedCount,
            poolCount: normalizedPool.length
          });
        }
        await yieldToMainThread();
      }
      return !isStale();
    };
    const pushRows = async (rows, source) => {
      for (let index = 0; index < rows.length; index += 1) {
        if (isStale()) return false;
        const normalized = normalizeTimelineRowMessageV2(rows[index], conversationContext, source, index);
        processedCount += 1;
        if (normalized) {
          normalizedPool.push(normalized);
          sourceStats[source] = Number(sourceStats[source] || 0) + 1;
        }
        if (!(await maybeYield("normalize"))) return false;
      }
      return true;
    };
    if (!(await pushRows(liveRows, "row_live"))) return null;
    if (!(await pushRows(inboxCached, "row_cache"))) return null;
    if (!(await pushRows(sentCached, "row_cache"))) return null;
    if (!(await pushRows(extraRows, "row_live"))) return null;
    if (!(await pushRows(optimisticRows, "optimistic"))) return null;

    const filtered = [];
    let droppedNoContactMatch = 0;
    for (let i = 0; i < normalizedPool.length; i += 1) {
      if (isStale()) return null;
      const message = normalizedPool[i];
      if (!messageBelongsToContactTimelineV2(message, conversationContext)) {
        droppedNoContactMatch += 1;
      } else {
        filtered.push(message);
      }
      processedCount += 1;
      if (!(await maybeYield("filter"))) return null;
    }

    const deduped = [];
    const seenMessageIds = new Set();
    const seenFallbackKeys = new Set();
    let dedupByMessageId = 0;
    let dedupByFallback = 0;
    for (let i = 0; i < filtered.length; i += 1) {
      if (isStale()) return null;
      const message = filtered[i];
      const messageId = normalize(message.messageId || message.dataMessageId || "");
      if (messageId) {
        if (seenMessageIds.has(messageId)) {
          dedupByMessageId += 1;
          processedCount += 1;
          if (!(await maybeYield("dedupe"))) return null;
          continue;
        }
        seenMessageIds.add(messageId);
      } else {
        const canonicalThread = canonicalThreadId(message.threadId || "") || normalize(message.threadId || "");
        const senderEmail = extractEmail(message.senderEmail || message.sender || "");
        const direction = normalize(message.direction || "");
        const timestampMs = Number(message.timestampMs || 0);
        const dateToken = normalizeMessageDateToken(message.date || "");
        const bodyFingerprint = hashString(normalize(
          message.cleanBodyText
          || message.bodyText
          || message.snippet
          || ""
        ).toLowerCase());
        const fallbackKey = [
          canonicalThread,
          senderEmail,
          direction,
          timestampMs,
          dateToken,
          bodyFingerprint
        ].join("|");
        if (!fallbackKey) {
          processedCount += 1;
          if (!(await maybeYield("dedupe"))) return null;
          continue;
        }
        if (seenFallbackKeys.has(fallbackKey)) {
          dedupByFallback += 1;
          processedCount += 1;
          if (!(await maybeYield("dedupe"))) return null;
          continue;
        }
        seenFallbackKeys.add(fallbackKey);
      }
      deduped.push(message);
      processedCount += 1;
      if (!(await maybeYield("dedupe"))) return null;
    }

    if (onChunk) {
      onChunk({
        stage: "sort",
        processedCount,
        poolCount: normalizedPool.length,
        filteredCount: filtered.length,
        dedupedCount: deduped.length
      });
    }
    await yieldToMainThread();
    if (isStale()) return null;

    const messages = deduped
      .slice()
      .sort((a, b) => {
        const ta = Number(a.timestampMs || 0);
        const tb = Number(b.timestampMs || 0);
        if (ta !== tb) return ta - tb;
        const sa = contactTimelineSourceRank(a.source || a.sourceType || "");
        const sb = contactTimelineSourceRank(b.source || b.sourceType || "");
        if (sa !== sb) return sa - sb;
        const ra = Number(a.rowOrder || 0);
        const rb = Number(b.rowOrder || 0);
        if (ra !== rb) return ra - rb;
        return normalize(a.id || a.messageKey || "").localeCompare(normalize(b.id || b.messageKey || ""));
      });

    const threadLatestAt = new Map();
    for (const message of messages) {
      if (isStale()) return null;
      const threadId = canonicalThreadId(message.threadId || "") || normalize(message.threadId || "");
      if (!threadId) continue;
      const stamp = Number(message.timestampMs || 0);
      const current = Number(threadLatestAt.get(threadId) || 0);
      if (stamp >= current) threadLatestAt.set(threadId, stamp);
    }
    const threadIds = Array.from(threadLatestAt.entries())
      .sort((a, b) => {
        if (a[1] !== b[1]) return b[1] - a[1];
        return String(a[0]).localeCompare(String(b[0]));
      })
      .map((entry) => entry[0]);

    const metrics = {
      conversationKey: normalize(conversationContext.conversationKey || ""),
      contactEmail: extractEmail(conversationContext.contactEmail || ""),
      activeAccountEmail: extractEmail(conversationContext.activeAccountEmail || ""),
      sourceCounts: sourceStats,
      poolCount: normalizedPool.length,
      filteredCount: filtered.length,
      droppedNoContactMatch,
      dedupByMessageId,
      dedupByFallback,
      finalCount: messages.length,
      threadCount: threadIds.length,
      sample: summarizeChatMessagesForDebug(messages, 8),
      chunkedBuild: true
    };

    return { context: conversationContext, messages, threadIds, metrics };
  }


    return {
      isContactTimelineV2Enabled,
      isContactTimelineV2Active,
      contactTimelineSourceRank,
      parseTimelineRowTimestampMs,
      normalizeTimelineRowMessageV2,
      messageBelongsToContactTimelineV2,
      buildContactTimelineFromRows,
      buildContactTimelineFromRowsChunked
    };
  };
})();
