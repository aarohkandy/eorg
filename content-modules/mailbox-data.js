(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createMailboxDataApi = function createMailboxDataApi(deps = {}) {
    const {
      normalize,
      isUseful,
      getGmailMainRoot,
      SCOPED_LINK_SELECTORS,
      LINK_SELECTORS,
      selectRows,
      mailboxKeyFromHash,
      state,
      extractThreadIdFromRow,
      threadIdFromHref,
      fallbackThreadIdFromRow,
      messageDedupeKey,
      extractSender,
      extractEmail,
      extractRowRecipientEmails,
      extractDate,
      extractSubject,
      extractSnippet,
      hrefMatchesMailbox,
      isThreadMarkedReadLocally,
      canonicalThreadId,
      hashFromHref,
      normalizeEmailList,
      normalizeMessageDateToken,
      hashString,
      isLikelyMetadataBlob,
      getScheduleActiveContactTimelineRefreshV2,
      logTimed
    } = deps;

  function cleanSubject(subject, sender, date) {
    let value = normalize(subject);
    if (!value) return "No subject captured";

    if (sender) {
      const escapedSender = sender.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`^${escapedSender}\\s*[-,:]?\\s*`, "i"), "");
    }

    if (date) {
      const escapedDate = date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      value = value.replace(new RegExp(`\\s*[-,|]?\\s*${escapedDate}\\s*$`, "i"), "");
    }

    value = value
      .replace(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi, "")
      .replace(/\b\d{1,2}:\d{2}\s?(?:AM|PM)\b/gi, "")
      .replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/gi, "")
      .replace(/\s+[|-]\s+.*$/, "")
      .replace(/^\s*(re|fw|fwd)\s*:\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s*[-,|:]\s*$/, "")
      .trim();

    return isUseful(value) ? value : "No subject captured";
  }

  function collectMessages(limit = 400) {
    if (!collectMessages._lastLog) collectMessages._lastLog = 0;
    const now = Date.now();
    const throttleMs = 400;
    const timed = (now - collectMessages._lastLog >= throttleMs)
      ? logTimed("lookup:collect-messages", { limit })
      : { done: () => {} };
    const mainRoot = getGmailMainRoot();
    const queryRoot = mainRoot instanceof HTMLElement ? mainRoot : document;
    const linkSelectors = mainRoot instanceof HTMLElement ? SCOPED_LINK_SELECTORS : LINK_SELECTORS;
    const rows = selectRows(mainRoot);
    const items = [];
    const seen = new Set();
    let source = "rows";
    const mailboxKey = mailboxKeyFromHash(state.lastListHash || window.location.hash || "#inbox");
    const strictMailbox = mailboxKey !== "inbox";

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      if (!(row instanceof HTMLElement)) continue;
      const rowLink = row.querySelector('a[href*="th="], a[href*="#inbox/"], a[href*="#all/"], a[href*="#label/"], a[href*="#sent/"], a[href*="#"], [role="link"][data-thread-id], [role="link"][data-legacy-thread-id]');
      const href = rowLink instanceof HTMLElement ? (rowLink.getAttribute("href") || "") : "";
      const threadId =
        extractThreadIdFromRow(row) ||
        threadIdFromHref(href) ||
        fallbackThreadIdFromRow(row, index);
      const dedupeKey = messageDedupeKey(threadId, href);
      if (seen.has(dedupeKey)) continue;

      const sender = extractSender(row);
      const senderEmail = extractEmail(sender || "");
      const recipientEmails = extractRowRecipientEmails(row, sender);
      const date = extractDate(row);
      const subject = cleanSubject(extractSubject(row, sender), sender, date);
      const snippet = extractSnippet(row);
      if (sender === "Unknown sender" && subject === "No subject captured" && !isUseful(snippet)) continue;
      if (strictMailbox && (!href || !hrefMatchesMailbox(href, mailboxKey))) continue;

      seen.add(dedupeKey);
      const detectedUnread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
      const unread = detectedUnread && !isThreadMarkedReadLocally(threadId);
      items.push({
        threadId,
        sender,
        senderEmail,
        recipientEmails,
        subject,
        snippet,
        bodyText: "",
        date,
        href,
        row,
        triageLevel: "",
        unread,
        mailbox: mailboxKey
      });
      if (items.length >= limit) break;
    }

    if (items.length < limit) {
      source = items.length > 0 ? "rows+links" : "links";
      for (const selector of linkSelectors) {
        const links = Array.from(queryRoot.querySelectorAll(selector));
        if (links.length === 0) continue;

        for (const link of links) {
          if (!(link instanceof HTMLElement)) continue;
          const href = link.getAttribute("href") || "";
          const threadId = threadIdFromHref(href);
          const dedupeKey = messageDedupeKey(threadId, href);
          if (!threadId || seen.has(dedupeKey)) continue;
          if (strictMailbox && !hrefMatchesMailbox(href, mailboxKey)) continue;

          const row = link.closest('[role="row"], tr, [data-thread-id], [data-legacy-thread-id], .zA');
          const sender = row ? extractSender(row) : "Unknown sender";
          const senderEmail = extractEmail(sender || "");
          const recipientEmails = row ? extractRowRecipientEmails(row, sender) : [];
          const date = row ? extractDate(row) : "";
          const snippet = row ? extractSnippet(row) : "";
          const linkTitle = normalize(link.getAttribute("title"));
          const linkText = normalize(link.textContent);
          const subject = cleanSubject(
            (isUseful(linkTitle) && linkTitle) ||
              (isUseful(linkText) && linkText) ||
              (row ? extractSubject(row, sender) : "No subject captured"),
            sender,
            date
          );
          if (sender === "Unknown sender" && subject === "No subject captured" && !isUseful(snippet)) continue;

          seen.add(dedupeKey);
          const detectedUnread = row && row.classList ? (row.classList.contains("zE") || Boolean(row.querySelector(".zE"))) : false;
          const unread = detectedUnread && !isThreadMarkedReadLocally(threadId);
          items.push({
            threadId,
            sender,
            senderEmail,
            recipientEmails,
            subject,
            snippet,
            bodyText: "",
            date,
            href,
            row,
            triageLevel: "",
            unread,
            mailbox: mailboxKey
          });
          if (items.length >= limit) break;
        }

        if (items.length >= limit) break;
      }
    }

    if (now - collectMessages._lastLog >= throttleMs) {
      collectMessages._lastLog = now;
      timed.done({ count: items.length, source });
    }
    return { items, source };
  }

  function mailboxCacheKey(mailbox) {
    const value = normalize(mailbox || "").toLowerCase();
    return value || "inbox";
  }

  function messageCacheKey(msg) {
    if (!msg || typeof msg !== "object") return "";
    return canonicalThreadKey(msg.threadId || "", msg.href || "");
  }

  function canonicalThreadKey(threadId, href) {
    const thread = canonicalThreadId(threadId || threadIdFromHref(href) || "");
    const hash = hashFromHref(href || "");
    return `${thread}|${hash || ""}`;
  }

  function canonicalRowKey(msg) {
    if (!msg || typeof msg !== "object") return "";
    const threadKey = canonicalThreadKey(msg.threadId || "", msg.href || "");
    const sender = normalize(msg.senderEmail || msg.sender || "").toLowerCase();
    const recipientToken = normalizeEmailList(msg.recipientEmails).slice(0, 3).join(",");
    const date = normalizeMessageDateToken(msg.date || "");
    const subject = normalize(msg.subject || "");
    const snippet = normalize(msg.snippet || msg.bodyText || "");
    const sigHash = hashString(`${subject.toLowerCase()}|${snippet.toLowerCase()}`);
    return `${threadKey}|${sender}|${recipientToken}|${date}|${sigHash}`;
  }

  function scoreMailboxMessageCandidate(msg) {
    let score = 0;
    const snippet = normalize(msg && (msg.snippet || msg.bodyText));
    if (snippet && !isLikelyMetadataBlob(snippet)) score += 3;
    if (Boolean(msg && msg.unread)) score += 2;
    if (normalize(msg && msg.href)) score += 1;
    if (mailboxCacheKey(msg && msg.mailbox) === "inbox") score += 1;
    return score;
  }

  function mergeMailboxCache(mailbox, incoming) {
    const key = mailboxCacheKey(mailbox);
    const existing = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    const map = new Map();
    let changed = false;
    for (const msg of existing) {
      const id = messageCacheKey(msg);
      if (!id) continue;
      map.set(id, {
        ...msg,
        mailbox: normalize(msg.mailbox || key) || key,
        unread: isThreadMarkedReadLocally(msg.threadId) ? false : Boolean(msg.unread)
      });
    }
    for (const msg of incoming || []) {
      const id = messageCacheKey(msg);
      if (!id) continue;
      const nextEntry = {
        threadId: msg.threadId || "",
        sender: msg.sender || "",
        senderEmail: msg.senderEmail || extractEmail(msg.sender || ""),
        recipientEmails: normalizeEmailList(msg.recipientEmails),
        subject: msg.subject || "",
        snippet: msg.snippet || "",
        bodyText: msg.bodyText || "",
        date: msg.date || "",
        href: msg.href || "",
        row: msg.row || null,
        triageLevel: msg.triageLevel || "",
        unread: isThreadMarkedReadLocally(msg.threadId) ? false : Boolean(msg.unread),
        mailbox: normalize(msg.mailbox || key) || key
      };
      const prev = map.get(id);
      if (!prev) {
        changed = true;
      } else {
        const prevRowKey = canonicalRowKey(prev);
        const nextRowKey = canonicalRowKey(nextEntry);
        if (
          prevRowKey !== nextRowKey
          || normalize(prev.snippet || "") !== normalize(nextEntry.snippet || "")
          || normalize(prev.date || "") !== normalize(nextEntry.date || "")
          || Boolean(prev.unread) !== Boolean(nextEntry.unread)
        ) {
          changed = true;
        }
      }
      map.set(id, nextEntry);
    }
    const merged = Array.from(map.values());
    if (merged.length !== existing.length) changed = true;
    if (changed) {
      state.mailboxCacheRevision = Number(state.mailboxCacheRevision || 0) + 1;
      if (key === mailboxCacheKey("inbox") || key === mailboxCacheKey("sent")) {
        const refreshFn = typeof getScheduleActiveContactTimelineRefreshV2 === "function"
          ? getScheduleActiveContactTimelineRefreshV2()
          : null;
        if (typeof refreshFn === "function") refreshFn(`cache:${key}`);
      }
    }
    state.scannedMailboxMessages[key] = merged;
    return merged;
  }

  function getMailboxMessages(mailbox, limit = 300) {
    const key = mailboxCacheKey(mailbox);
    const cached = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    if (cached.length > 0) return cached.slice(0, limit);
    const live = collectMessages(limit).items || [];
    return mergeMailboxCache(key, live).slice(0, limit);
  }

  function dedupeMessagesStable(messages) {
    const map = new Map();
    const list = Array.isArray(messages) ? messages : [];
    for (let index = 0; index < list.length; index += 1) {
      const msg = list[index];
      if (!msg || typeof msg !== "object") continue;
      const mailbox = mailboxCacheKey(msg.mailbox || "");
      const key = canonicalRowKey(msg);
      if (!key) continue;
      const nextMsg = { ...msg, mailbox };
      const nextScore = scoreMailboxMessageCandidate(nextMsg);
      const nextSubjectLen = normalize(nextMsg.subject || "").length;
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { msg: nextMsg, score: nextScore, subjectLen: nextSubjectLen, index });
        continue;
      }
      if (nextScore > existing.score) {
        map.set(key, { msg: nextMsg, score: nextScore, subjectLen: nextSubjectLen, index });
        continue;
      }
      if (nextScore === existing.score && nextSubjectLen > existing.subjectLen) {
        map.set(key, { msg: nextMsg, score: nextScore, subjectLen: nextSubjectLen, index });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => a.index - b.index)
      .map((entry) => entry.msg);
  }

  function mailboxMessagesForList(mailbox, liveMessages = []) {
    const key = mailboxCacheKey(mailbox);
    const cached = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    const live = Array.isArray(liveMessages) ? liveMessages : [];
    if (cached.length === 0) return live.slice();
    if (live.length === 0) return cached.slice();
    // Prefer fresh DOM rows while retaining warmed cache coverage.
    return dedupeMessagesStable([...live, ...cached]);
  }

  function chatScopeMessages(routeMailbox, liveMessages = []) {
    const mailbox = mailboxCacheKey(routeMailbox);
    if (mailbox !== "inbox" && mailbox !== "sent") {
      return mailboxMessagesForList(mailbox, liveMessages);
    }
    const inbox = mailboxMessagesForList("inbox", mailbox === "inbox" ? liveMessages : []);
    const sent = mailboxMessagesForList("sent", mailbox === "sent" ? liveMessages : []);
    return dedupeMessagesStable([...inbox, ...sent]);
  }


    return {
      cleanSubject,
      collectMessages,
      mailboxCacheKey,
      messageCacheKey,
      canonicalThreadKey,
      canonicalRowKey,
      scoreMailboxMessageCandidate,
      mergeMailboxCache,
      getMailboxMessages,
      dedupeMessagesStable,
      mailboxMessagesForList,
      chatScopeMessages
    };
  };
})();
