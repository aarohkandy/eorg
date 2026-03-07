(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createThreadHydrationApi = function createThreadHydrationApi(deps = {}) {
    const {
      state,
      THREAD_BODY_PLACEHOLDER,
      THREAD_NO_CONTENT,
      THREAD_EXPAND_MAX_PASSES,
      THREAD_EXPAND_MAX_CLICKS_PER_PASS,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      mailboxCacheKey,
      isSelfSenderLabel,
      isGenericSenderLabel,
      activeConversationContext,
      conversationKeyFromContact,
      dedupeMessagesStable,
      collectMessages,
      detectCurrentUserEmail,
      hashFromHref,
      normalizeThreadHashForMailbox,
      isThreadHash,
      lookupThreadHintHref,
      lookupThreadRowHint,
      logTimed,
      logChatDebug,
      logEvent,
      diagFail,
      logWarn,
      sleep,
      parseThreadTimestampForOrder,
      threadContextSnapshot,
      ensureInboxSdkReady,
      ensureThreadContextForReply,
      forceThreadContextForHydration,
      waitForThreadDomReadyForHydration,
      waitForInboxSdkThreadMessages,
      getInboxSdkThreadMessages,
      hasMeaningfulCapturedMessages,
      normalizeThreadMessagesForChat,
      threadSnippetFallback,
      hasUsefulBodyText,
      expandCollapsedThreadMessagesForExtraction,
      extractOpenThreadData
    } = deps;

  function initialForSender(sender) {
    const s = normalize(sender || "").trim();
    const match = s.match(/\b([A-Za-z])/);
    return match ? match[1].toUpperCase() : "?";
  }

  function contactKeyFromMessage(msg) {
    if (!msg || typeof msg !== "object") return "";
    const userEmail = extractEmail(state.activeAccountEmail || state.currentUserEmail || detectCurrentUserEmail());
    const senderValue = normalize(msg.senderEmail || msg.sender || "").trim();
    const senderEmail = extractEmail(senderValue);
    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.ariaLabel,
      msg.row instanceof HTMLElement ? msg.row.getAttribute("aria-label") : "",
      msg.row instanceof HTMLElement ? normalize(msg.row.innerText || msg.row.textContent || "").slice(0, 700) : ""
    ]);
    const mailbox = mailboxCacheKey(msg.mailbox || "");
    const senderLooksLikeSelf = Boolean(
      (senderEmail && userEmail && senderEmail === userEmail)
      || isSelfSenderLabel(msg.sender || "")
    );
    if ((mailbox === "sent" || senderLooksLikeSelf) && recipientEmails.length > 0) {
      const counterpart = recipientEmails.find((value) => value && (!userEmail || value !== userEmail));
      if (counterpart) return counterpart;
    }
    if (senderEmail) return senderEmail;
    if (recipientEmails.length > 0) {
      const counterpart = recipientEmails.find((value) => value && (!userEmail || value !== userEmail));
      if (counterpart) return counterpart;
      if (recipientEmails[0]) return recipientEmails[0];
    }
    const s = normalize(msg.sender || "").trim();
    const display = senderDisplayName(s);
    if (display && !isGenericSenderLabel(display)) return display.toLowerCase();
    return "";
  }

  function senderDisplayName(raw) {
    const s = (raw || "").trim();
    const m = s.match(/^(.+?)\s*<[^>]+>$/);
    const name = m ? m[1].trim() : (s || "");
    const email = extractEmail(s);
    if (email && isGenericSenderLabel(name)) return email;
    return name;
  }

  function messageDateSortValue(msg) {
    const raw = normalize(msg && msg.date ? msg.date : "");
    if (!raw) return 0;
    const direct = parseThreadTimestampForOrder(raw);
    if (direct > 0) return direct;
    const relative = raw.match(/(\d+)\s+(minute|hour|day|week|month|year)s?\s+ago/i);
    if (relative) {
      const value = Number(relative[1] || 0);
      const unit = normalize(relative[2] || "").toLowerCase();
      const multipliers = {
        minute: 60 * 1000,
        hour: 60 * 60 * 1000,
        day: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
        year: 365 * 24 * 60 * 60 * 1000
      };
      const delta = multipliers[unit] || 0;
      return delta > 0 ? Date.now() - value * delta : 0;
    }
    return 0;
  }

  function compareMailboxRowsNewestFirst(a, b) {
    const ta = messageDateSortValue(a);
    const tb = messageDateSortValue(b);
    if (ta !== tb) return tb - ta;
    const da = normalize(a && a.date ? a.date : "").toLowerCase();
    const db = normalize(b && b.date ? b.date : "").toLowerCase();
    return db.localeCompare(da);
  }

  function mailboxRowMatchesContactConversation(msg, context = {}) {
    if (!msg || typeof msg !== "object") return false;
    const conversationContext = activeConversationContext(context);
    const contactEmail = extractEmail(conversationContext.contactEmail || "");
    if (!contactEmail) return false;
    const accountEmail = extractEmail(conversationContext.activeAccountEmail || "");
    const senderEmail = extractEmail(msg.senderEmail || msg.sender || "");
    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.ariaLabel
    ]);
    const participants = new Set(normalizeEmailList([senderEmail, recipientEmails]));
    const inferredContactKey = extractEmail(contactKeyFromMessage(msg));
    const includesContact = participants.has(contactEmail) || inferredContactKey === contactEmail;
    const isOutgoingLike = Boolean(
      msg.isSelf === true
      || normalize(msg.direction || "") === "outgoing"
    );
    const threadScope = new Set(
      (Array.isArray(state.contactThreadIds) ? state.contactThreadIds : [])
        .map((threadId) => canonicalThreadId(threadId || "") || normalize(threadId || ""))
        .filter(Boolean)
    );
    const activeThreadId = canonicalThreadId(state.currentThreadIdForReply || state.activeThreadId || "")
      || normalize(state.currentThreadIdForReply || state.activeThreadId || "");
    if (activeThreadId) threadScope.add(activeThreadId);
    const messageThreadId = canonicalThreadId(msg.threadId || "") || normalize(msg.threadId || "");
    const inThreadScope = Boolean(
      messageThreadId
      && threadScope.size > 0
      && threadScope.has(messageThreadId)
    );
    if (!includesContact) {
      const senderLooksSelf = Boolean(
        msg.isSelf === true
        || (accountEmail && senderEmail === accountEmail)
        || isSelfSenderLabel(msg.sender || "")
      );
      if (!(isOutgoingLike && senderLooksSelf && inThreadScope)) return false;
    }
    if (!accountEmail) return true;
    if (participants.has(accountEmail)) return true;
    const mailbox = mailboxCacheKey(msg.mailbox || "");
    const senderLooksSelf = Boolean(
      msg.isSelf === true
      || senderEmail === accountEmail
      || isSelfSenderLabel(msg.sender || "")
    );
    if (isOutgoingLike && senderLooksSelf && inThreadScope) return true;
    return mailbox === "sent" && senderLooksSelf;
  }

  function expandContactGroupWithCachedCounterparts(group, context = {}) {
    const baseGroup = group && typeof group === "object" ? group : null;
    if (!baseGroup) return group;
    const conversationContext = activeConversationContext({
      ...context,
      contactEmail: context.contactEmail || baseGroup.contactEmail || baseGroup.contactKey
    });
    const contactEmail = extractEmail(conversationContext.contactEmail || "");
    if (!contactEmail) return baseGroup;

    const seededItems = Array.isArray(baseGroup.items) ? baseGroup.items.slice() : [];
    const inboxCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
      ? state.scannedMailboxMessages[mailboxCacheKey("inbox")]
      : [];
    const sentCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
      ? state.scannedMailboxMessages[mailboxCacheKey("sent")]
      : [];
    const liveRows = collectMessages(320).items || [];
    const cachedRows = dedupeMessagesStable([...inboxCached, ...sentCached, ...liveRows]);
    const counterpartRows = cachedRows.filter((msg) => mailboxRowMatchesContactConversation(msg, conversationContext));
    if (counterpartRows.length === 0) return {
      ...baseGroup,
      contactEmail: contactEmail || baseGroup.contactEmail || "",
      conversationKey: conversationKeyFromContact(contactEmail || baseGroup.contactEmail || "")
    };

    const rowByThread = new Map();
    const pushRow = (msg) => {
      const threadId = canonicalThreadId(msg && msg.threadId) || normalize(msg && msg.threadId);
      if (!threadId) return;
      const existing = rowByThread.get(threadId);
      const next = { ...msg, threadId };
      if (!existing) {
        rowByThread.set(threadId, next);
        return;
      }
      const chosen = compareMailboxRowsNewestFirst(next, existing) <= 0 ? next : existing;
      rowByThread.set(threadId, chosen);
    };
    for (const item of seededItems) pushRow(item);
    for (const row of counterpartRows) pushRow(row);

    const mergedItems = Array.from(rowByThread.values()).sort(compareMailboxRowsNewestFirst);
    const mergedThreadIds = mergedItems
      .map((item) => canonicalThreadId(item && item.threadId) || normalize(item && item.threadId))
      .filter(Boolean);
    const mergedContactName = (
      normalize(baseGroup.contactName || "")
      || senderDisplayName((mergedItems[0] && mergedItems[0].sender) || "")
      || contactEmail
    );
    logChatDebug("contact-group:counterpart-expansion", {
      contactEmail,
      accountEmail: conversationContext.activeAccountEmail || "",
      beforeThreadCount: Array.isArray(baseGroup.threadIds) ? baseGroup.threadIds.length : 0,
      afterThreadCount: mergedThreadIds.length,
      addedThreadCount: Math.max(0, mergedThreadIds.length - (Array.isArray(baseGroup.threadIds) ? baseGroup.threadIds.length : 0)),
      inboxCached: inboxCached.length,
      sentCached: sentCached.length,
      liveRows: liveRows.length,
      matchedRows: counterpartRows.length,
      sampleThreads: mergedThreadIds.slice(0, 8)
    }, { throttleKey: `counterpart-expansion:${contactEmail}`, throttleMs: 700 });
    return {
      ...baseGroup,
      contactEmail,
      conversationKey: conversationKeyFromContact(contactEmail),
      contactName: mergedContactName,
      items: mergedItems,
      threadIds: mergedThreadIds,
      latestItem: mergedItems[0] || baseGroup.latestItem || null
    };
  }

  function groupMessagesByContact(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const byKey = new Map();
    for (const msg of messages) {
      const key = contactKeyFromMessage(msg);
      if (!key) continue;
      const contactEmail = extractEmail(key || msg.senderEmail || msg.sender || "");
      if (!byKey.has(key)) {
        const senderName = senderDisplayName(msg.sender) || "";
        const senderEmail = extractEmail(msg.senderEmail || msg.sender || "");
        const userEmail = extractEmail(state.activeAccountEmail || state.currentUserEmail || detectCurrentUserEmail());
        const senderIsSelf = Boolean(senderEmail && userEmail && senderEmail === userEmail);
        const name = senderName && !senderIsSelf && !isGenericSenderLabel(senderName)
          ? senderName
          : key;
        byKey.set(key, {
          contactKey: key,
          contactEmail,
          conversationKey: conversationKeyFromContact(contactEmail),
          contactName: name,
          threadIds: [],
          items: [],
          _threadIdSet: new Set()
        });
      }
      const g = byKey.get(key);
      if (!g.contactEmail && contactEmail) {
        g.contactEmail = contactEmail;
        g.conversationKey = conversationKeyFromContact(contactEmail);
      }
      const canonicalTid = canonicalThreadId(msg && msg.threadId);
      const threadKey = canonicalTid || normalize(msg && msg.threadId);
      if (!threadKey) continue;
      if (!g._threadIdSet.has(threadKey)) {
        g._threadIdSet.add(threadKey);
        g.threadIds.push(threadKey);
        g.items.push({ ...msg, threadId: threadKey });
      }
    }
    const groups = Array.from(byKey.values());
    for (const g of groups) {
      g.items.sort((a, b) => {
        const ta = messageDateSortValue(a);
        const tb = messageDateSortValue(b);
        if (ta !== tb) return tb - ta;
        const da = normalize(a.date || "").toLowerCase();
        const db = normalize(b.date || "").toLowerCase();
        return db.localeCompare(da);
      });
      g.threadIds = g.items.map((m) => canonicalThreadId(m.threadId) || normalize(m.threadId || "")).filter(Boolean);
      if (!g.contactEmail) {
        const head = g.items[0] || null;
        const inferred = extractEmail((head && (head.senderEmail || head.sender)) || g.contactKey || "");
        if (inferred) g.contactEmail = inferred;
      }
      g.conversationKey = conversationKeyFromContact(g.contactEmail || "");
      delete g._threadIdSet;
      g.latestItem = g.items[0] || null;
    }
    return groups;
  }

  function threadHashForMailbox(mailbox, threadId, hintHref = "") {
    const box = mailboxCacheKey(mailbox || "inbox");
    const hintedHash = normalizeThreadHashForMailbox(hashFromHref(hintHref || ""), box);
    if (hintedHash && isThreadHash(hintedHash)) return hintedHash;
    const raw = normalize(threadId || "");
    let cleanThreadId = raw.startsWith("#") ? raw.slice(1) : raw;
    if (/^f:[A-Za-z0-9_-]+$/i.test(cleanThreadId)) {
      cleanThreadId = `thread-${cleanThreadId}`;
    }
    if (!cleanThreadId) return `#${box}`;
    return `#${box}/${cleanThreadId}`;
  }

  function applySnippetFallbackToMessages(messages, threadId) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    const snippet = normalize(threadSnippetFallback(threadId) || "");
    if (!snippet) return messages;
    return messages.map((msg) => {
      const bodyText = normalize(msg && msg.bodyText);
      if (hasUsefulBodyText(bodyText)) return msg;
      return { ...msg, bodyHtml: "", bodyText: snippet };
    });
  }

  function scoreExtractedMessages(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return -5;
    let score = 0;
    for (const msg of messages) {
      const bodyText = normalize(msg && msg.bodyText);
      const htmlLen = normalize(msg && msg.bodyHtml).length;
      if (hasUsefulBodyText(bodyText)) {
        score += 3 + Math.min(4, Math.floor(bodyText.length / 120));
      } else if (!bodyText || bodyText === THREAD_BODY_PLACEHOLDER || bodyText === THREAD_NO_CONTENT) {
        score -= 1;
      }
      if (htmlLen > 20) score += 1;
    }
    return score;
  }

  function gmailAccountIndex() {
    const m = window.location.pathname.match(/\/mail\/u\/(\d+)\//);
    return m ? m[1] : "0";
  }

  function hexThreadIdForThread(threadId) {
    // 1. Try the stored list-row element's data-legacy-thread-id (already a hex string)
    const rowHint = lookupThreadRowHint(threadId);
    if (rowHint instanceof HTMLElement) {
      const legacyAttr = normalize(rowHint.getAttribute("data-legacy-thread-id") || "");
      if (legacyAttr && /^[0-9a-f]+$/i.test(legacyAttr)) return legacyAttr;
    }
    // 2. Try parsing th= from the stored hint href
    const hintHref = lookupThreadHintHref(threadId);
    if (hintHref) {
      const thMatch = hintHref.match(/[?&]th=([0-9A-Fa-f]+)/);
      if (thMatch && thMatch[1]) return thMatch[1];
      // Also try bare hex segment in hash-style href (#inbox/17abc...)
      const hashSegMatch = hintHref.match(/#[^/]+\/([0-9a-f]{8,})/i);
      if (hashSegMatch && hashSegMatch[1] && !/^thread-f:/i.test(hashSegMatch[1])) {
        const seg = hashSegMatch[1];
        if (/^[0-9a-f]+$/i.test(seg)) return seg;
      }
    }
    // 3. BigInt fallback: convert decimal f: sync ID to hex
    try {
      const canonical = canonicalThreadId(threadId) || normalize(threadId || "");
      const decStr = canonical.replace(/^(thread-f:|f:)/i, "");
      if (decStr && /^\d+$/.test(decStr)) {
        return BigInt(decStr).toString(16);
      }
    } catch (_) {
      // ignore BigInt parse error
    }
    return "";
  }

  const THREAD_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
  const THREAD_CACHE_SCHEMA_VERSION = 2;
  // L1: in-memory map — synchronous, zero-latency, lives for the tab session.
  // L2: chrome.storage.local — persists across sessions, checked when L1 misses.
  const printViewMemCache = new Map();

  async function getThreadCache(hexId) {
    try {
      const key = `rv_thread_v${THREAD_CACHE_SCHEMA_VERSION}_${hexId}`;
      const result = await chrome.storage.local.get(key);
      const cached = result[key];
      if (cached && typeof cached === "object" && Date.now() - (cached.fetchedAt || 0) < THREAD_CACHE_TTL_MS) {
        return { subject: cached.subject || "", messages: Array.isArray(cached.messages) ? cached.messages : [] };
      }
    } catch (_) {}
    return null;
  }

  async function setThreadCache(hexId, subject, messages) {
    try {
      const key = `rv_thread_v${THREAD_CACHE_SCHEMA_VERSION}_${hexId}`;
      await chrome.storage.local.set({ [key]: { subject, messages, fetchedAt: Date.now() } });
    } catch (_) {}
  }

  async function fetchThreadPrintView(hexId) {
    const timed = logTimed("fetch:print-view", { hexId });
    const url = `${window.location.origin}/mail/u/${gmailAccountIndex()}/?ui=2&view=pt&search=all&th=${hexId}`;
    const res = await fetch(url, { credentials: "include" });
    if (!res.ok) {
      timed.done({ error: res.status });
      throw new Error(`print-view fetch failed: ${res.status}`);
    }
    const text = await res.text();
    timed.done({ size: text?.length || 0 });
    return text;
  }

  function extractMessagesFromPrintView(html, accountEmail, threadId, mailbox = "") {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const subject = normalize(doc.title || "");

    // Remove script/style/head so their text cannot poison the email regex
    doc.querySelectorAll("script, style, head").forEach((el) => el.remove());

    const normalizedAccount = normalize(
      extractEmail(accountEmail || "") || (typeof accountEmail === "string" ? accountEmail : "")
    ).toLowerCase();

    const EMAIL_RE_GLOBAL = /([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})/g;
    const DATE_PATTERN = /(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+\w+\.?\s+\d{1,2},?\s+\d{4}[^<\n]{0,40}/i;
    const normalizedMailbox = mailboxCacheKey(mailbox || "");
    const extractHeaderSegment = (rawText, label) => {
      const match = String(rawText || "").match(
        new RegExp(`\\b${label}:\\s*([\\s\\S]*?)(?=\\b(?:From|To|Cc|Bcc|Date|Subject):|$)`, "i")
      );
      return normalize(match && match[1] ? match[1] : "");
    };
    const extractEmails = (rawText) => {
      const out = [];
      const seen = new Set();
      let match = null;
      while ((match = EMAIL_RE_GLOBAL.exec(String(rawText || ""))) !== null) {
        const email = normalize(match[1] || "").toLowerCase();
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= 12) break;
      }
      EMAIL_RE_GLOBAL.lastIndex = 0;
      return out;
    };
    const inferDirection = (senderEmail, recipientEmails = []) => {
      if (normalizedMailbox === "sent") return "outgoing";
      if (normalizedAccount && senderEmail && senderEmail === normalizedAccount) return "outgoing";
      if (normalizedAccount && recipientEmails.includes(normalizedAccount)) return "incoming";
      return "incoming";
    };
    const tables = Array.from(doc.querySelectorAll("table"));
    const tableSet = new Set(tables);
    const looksLikeHeaderTable = (table, structural = false) => {
      if (!(table instanceof HTMLElement)) return false;
      const text = normalize(table.textContent || "");
      if (!text) return false;
      const emails = extractEmails(text);
      if (emails.length === 0) return false;
      if (/\b(?:From|To|Cc|Bcc|Date|Subject):/i.test(text)) return true;
      if (structural) return emails.length >= 1 && text.length >= 24;
      return emails.length >= 2 && text.length >= 24;
    };
    const extractBodyFromHeaderTable = (table, structural = false) => {
      let bodyText = "";
      let currentNode = table.nextSibling;
      while (currentNode) {
        if (
          currentNode.nodeName === "TABLE"
          && currentNode instanceof HTMLElement
          && tableSet.has(currentNode)
          && looksLikeHeaderTable(currentNode, structural)
        ) {
          break;
        }
        const nodeClass = typeof currentNode.className === "string" ? currentNode.className : "";
        if (
          currentNode.nodeName === "BLOCKQUOTE"
          || nodeClass.includes("gmail_quote")
          || normalize(currentNode.textContent || "").includes("Quoted text hidden")
        ) {
          currentNode = currentNode.nextSibling;
          continue;
        }
        if (currentNode.textContent) bodyText += `${currentNode.textContent}\n`;
        currentNode = currentNode.nextSibling;
      }
      return bodyText.replace(/On\s+.+?wrote:/gi, "").trim();
    };
    const messages = [];

    const pushMessageFromTable = (table, structural = false) => {
      if (!(table instanceof HTMLElement)) return;
      const text = table.textContent || "";
      if (!looksLikeHeaderTable(table, structural)) return;
      const headerEmails = extractEmails(text);
      const fromSegment = extractHeaderSegment(text, "From");
      const toSegment = extractHeaderSegment(text, "To");
      const ccSegment = extractHeaderSegment(text, "Cc");
      const bccSegment = extractHeaderSegment(text, "Bcc");
      let senderEmail = (
        extractEmails(fromSegment)[0]
        || headerEmails[0]
        || ""
      ).toLowerCase();
      let recipientEmails = normalizeEmailList([
        extractEmails(toSegment),
        extractEmails(ccSegment),
        extractEmails(bccSegment)
      ]).filter((email) => email && email !== senderEmail);
      if (recipientEmails.length === 0 && headerEmails.length > 1) {
        recipientEmails = normalizeEmailList(headerEmails.filter((email) => email && email !== senderEmail));
      }
      if (!senderEmail && normalizedMailbox === "sent" && normalizedAccount) {
        senderEmail = normalizedAccount;
      }
      if (!senderEmail && recipientEmails.length > 0) {
        senderEmail = recipientEmails[0];
      }
      if (!senderEmail) return;
      const senderLine = fromSegment || text;
      let senderName = senderEmail;
      const firstEmailIdx = senderLine.toLowerCase().indexOf(senderEmail);
      if (firstEmailIdx > 0) {
        const beforeEmail = senderLine.slice(0, firstEmailIdx).trim();
        const nameLine = beforeEmail.split(/[\r\n]/).reverse().find((line) => line.trim().length > 0) || "";
        const cleaned = normalize(nameLine.replace(/^.*(?:From|Sender):\s*/i, "").replace(/[<>"]/g, "").trim());
        if (cleaned && !isGenericSenderLabel(cleaned)) senderName = cleaned;
      }
      const dateMatch = DATE_PATTERN.exec(text);
      const date = dateMatch ? normalize(dateMatch[0].trim()) : "";
      const bodyText = extractBodyFromHeaderTable(table, structural);
      messages.push({
        sender: senderName || senderEmail,
        senderEmail,
        recipientEmails,
        bodyText: bodyText || THREAD_BODY_PLACEHOLDER,
        bodyHtml: "",
        direction: inferDirection(senderEmail, recipientEmails),
        date,
        threadId: normalize(threadId || ""),
        source: "print_view",
        sourceType: "captured",
        metadataOnly: !bodyText
      });
    };

    for (const table of tables) {
      pushMessageFromTable(table, false);
    }
    if (messages.length === 0) {
      for (const table of tables) {
        pushMessageFromTable(table, true);
        if (messages.length >= 20) break;
      }
    }

    return { subject, messages };
  }

  async function hydrateThreadFromPrintView(threadId, mailbox, hintHref, accountEmail) {
    const hexId = hexThreadIdForThread(threadId);
    if (!hexId) throw new Error(`no hex thread ID available for threadId=${normalize(threadId || "")}`);

    // L1: in-memory cache — synchronous, zero-latency.
    const memHit = printViewMemCache.get(hexId);
    if (memHit && Date.now() - memHit.fetchedAt < THREAD_CACHE_TTL_MS) {
      logChatDebug("print-view:cache-hit", {
        threadId: normalize(threadId || ""),
        hexId,
        messageCount: memHit.messages.length,
        tier: "memory"
      }, { throttleKey: `print-view-cache-hit:${normalize(threadId || "")}`, throttleMs: 300 });
      return { subject: memHit.subject, messages: memHit.messages, extractAttempts: 0, contextHits: 1, fromCache: true };
    }

    // L2: chrome.storage.local — persists across sessions.
    const storageHit = await getThreadCache(hexId);
    if (storageHit) {
      printViewMemCache.set(hexId, { ...storageHit, fetchedAt: Date.now() });
      logChatDebug("print-view:cache-hit", {
        threadId: normalize(threadId || ""),
        hexId,
        messageCount: storageHit.messages.length,
        tier: "storage"
      }, { throttleKey: `print-view-cache-hit:${normalize(threadId || "")}`, throttleMs: 300 });
      return { subject: storageHit.subject, messages: storageHit.messages, extractAttempts: 0, contextHits: 1, fromCache: true };
    }

    const timed = logTimed("hydrate:print-view", { hexId, threadId: normalize(threadId || "").slice(0, 16) });
    const html = await fetchThreadPrintView(hexId);
    // Yield so the browser can process clicks/input before the synchronous
    // DOMParser + querySelectorAll work runs.
    await Promise.resolve();
    const { subject, messages } = extractMessagesFromPrintView(html, accountEmail, threadId, mailbox);
    timed.done({ messageCount: messages.length });

    // Populate both cache tiers — fire-and-forget so rendering is never blocked.
    printViewMemCache.set(hexId, { subject, messages, fetchedAt: Date.now() });
    setThreadCache(hexId, subject, messages).catch(() => {});
    const outgoingCount = messages.filter((msg) => normalize(msg && msg.direction || "") === "outgoing").length;
    const incomingCount = messages.filter((msg) => normalize(msg && msg.direction || "") === "incoming").length;

    logChatDebug("print-view:hydrated", {
      threadId: normalize(threadId || ""),
      hexId,
      messageCount: messages.length,
      outgoingCount,
      incomingCount,
      subject
    }, { throttleKey: `print-view-hydrated:${normalize(threadId || "")}`, throttleMs: 300 });
    return { subject, messages, extractAttempts: 1, contextHits: 1 };
  }

  async function captureThreadDataWithRetry(threadId, mailbox, maxAttempts = 6, hintHref = "", options = {}) {
    const threadHintHref = normalize(hintHref || "") || lookupThreadHintHref(threadId);
    const targetHash = threadHashForMailbox(mailbox, threadId, threadHintHref);
    let bestData = { subject: "", messages: [] };
    let bestScore = -Infinity;
    let extractAttempts = 0;
    let contextHits = 0;
    const forceExtractAttempt = Boolean(options && options.forceExtractAttempt);
    try {
      await ensureInboxSdkReady();
    } catch (error) {
      if (typeof diagFail === "function") {
        diagFail("P199", error, {
          rc: 8,
          rs: "inboxsdk-warmup-failed",
          threadId: normalize(threadId || ""),
          mailbox: mailboxCacheKey(mailbox)
        });
      } else if (typeof logEvent === "function") {
        logEvent("P199", {
          rc: 8,
          rs: "inboxsdk-warmup-failed",
          threadId: normalize(threadId || ""),
          mailbox: mailboxCacheKey(mailbox)
        });
      }
      logWarn(`InboxSDK warmup failed during hydration; continuing with DOM extraction only: ${normalize(error && error.message ? error.message : String(error || ""))}`);
    }

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const lockStartedAt = Date.now();
      while (state.replySendInProgress && Date.now() - lockStartedAt < 12000) {
        await sleep(120);
      }
      let context = await ensureThreadContextForReply(threadId, mailbox, threadHintHref);
      let contextReady = context.ok ? (context.status || threadContextSnapshot(threadId)) : threadContextSnapshot(threadId);
      let contextMode = context.ok ? "ensure-context" : "ensure-context-failed";

      if (!contextReady.ok) {
        if (window.location.hash !== targetHash) {
          window.location.hash = targetHash;
          await sleep(40);
        }
        const forced = await forceThreadContextForHydration(threadId, mailbox, threadHintHref);
        if (forced.ok) {
          context = forced;
          contextReady = forced.status || threadContextSnapshot(threadId);
          contextMode = normalize(forced.readyMode || forced.contextStep || "") || "forced-hash";
        }
      }

      if (!contextReady.ok) {
        const domWait = await waitForThreadDomReadyForHydration(threadId, 4200);
        if (domWait.ok) {
          contextReady = domWait.status || threadContextSnapshot(threadId);
          contextMode = normalize(domWait.mode || "") || "dom-wait";
        }
      }
      if (!contextReady.ok) {
        logChatDebug("contact-hydration:context-miss", {
          threadId: normalize(threadId || ""),
          mailbox: mailboxCacheKey(mailbox),
          hintHref: Boolean(threadHintHref),
          attempt,
          mode: contextMode,
          hash: normalize(window.location.hash || ""),
          status: contextReady || null,
          tried: Array.isArray(context && context.tried) ? context.tried.slice(0, 8) : []
        }, { throttleKey: `contact-hydration-context-miss:${normalize(threadId || "")}`, throttleMs: 220 });
        await sleep(80 + Math.min(200, attempt * 40));
        continue;
      }
      contextHits += 1;
      logChatDebug("contact-hydration:context-ready", {
        threadId: normalize(threadId || ""),
        mailbox: mailboxCacheKey(mailbox),
        hintHref: Boolean(threadHintHref),
        attempt,
        mode: contextMode,
        hash: normalize(window.location.hash || ""),
        dom: contextReady && contextReady.dom ? contextReady.dom : null
      }, { throttleKey: `contact-hydration-context-ready:${normalize(threadId || "")}`, throttleMs: 220 });

      const expansion = await expandCollapsedThreadMessagesForExtraction(threadId, {
        maxPasses: attempt === 0 ? THREAD_EXPAND_MAX_PASSES : Math.max(2, THREAD_EXPAND_MAX_PASSES - 1),
        maxClicksPerPass: attempt === 0 ? THREAD_EXPAND_MAX_CLICKS_PER_PASS : Math.max(18, THREAD_EXPAND_MAX_CLICKS_PER_PASS - 10)
      });
      await waitForInboxSdkThreadMessages(threadId, attempt === 0 ? 350 : 150);
      if (expansion.clicks > 0) {
        await sleep(60 + Math.min(120, expansion.clicks * 2));
      }
      await sleep(attempt === 0 ? 120 : 100 + Math.min(120, attempt * 20));
      logChatDebug("contact-hydration:extract-run", {
        threadId: normalize(threadId || ""),
        mailbox: mailboxCacheKey(mailbox),
        attempt,
        hash: normalize(window.location.hash || ""),
        expansionClicks: expansion.clicks,
        expansionPasses: expansion.passes
      }, { throttleKey: `contact-hydration-extract-run:${normalize(threadId || "")}`, throttleMs: 220 });
      const data = extractOpenThreadData();
      extractAttempts += 1;
      const messages = normalizeThreadMessagesForChat(
        applySnippetFallbackToMessages(Array.isArray(data.messages) ? data.messages : [], threadId),
        threadId
      );
      const sdkMessages = getInboxSdkThreadMessages(threadId);
      const scoredDom = scoreExtractedMessages(messages);
      const scoredSdk = scoreExtractedMessages(sdkMessages);
      if (scoredSdk > scoredDom && hasMeaningfulCapturedMessages(sdkMessages)) {
        if (scoredSdk > bestScore) {
          bestScore = scoredSdk;
          bestData = { ...data, messages: sdkMessages };
        }
      } else if (scoredDom > bestScore) {
        bestScore = scoredDom;
        bestData = { ...data, messages };
      }
      const hasCapturedBody = messages.some((m) => hasUsefulBodyText(m && m.bodyText) || normalize(m && m.bodyHtml).length > 20);
      const hasSdkBody = hasMeaningfulCapturedMessages(sdkMessages);
      if (hasCapturedBody) break;
      if (hasSdkBody) break;
    }

    if (forceExtractAttempt && extractAttempts === 0) {
      logChatDebug("contact-hydration:last-chance-start", {
        threadId: normalize(threadId || ""),
        mailbox: mailboxCacheKey(mailbox),
        hintHref: Boolean(threadHintHref),
        hash: normalize(window.location.hash || "")
      }, { throttleKey: `contact-hydration-last-chance-start:${normalize(threadId || "")}`, throttleMs: 260 });
      if (window.location.hash !== targetHash) {
        window.location.hash = targetHash;
        await sleep(40);
      }
      await forceThreadContextForHydration(threadId, mailbox, threadHintHref);
      await waitForThreadDomReadyForHydration(threadId, 2200);
      await expandCollapsedThreadMessagesForExtraction(threadId, {
        maxPasses: Math.max(2, THREAD_EXPAND_MAX_PASSES - 1),
        maxClicksPerPass: Math.max(18, THREAD_EXPAND_MAX_CLICKS_PER_PASS - 10)
      });
      await waitForInboxSdkThreadMessages(threadId, 200);
      const data = extractOpenThreadData();
      extractAttempts += 1;
      const messages = normalizeThreadMessagesForChat(
        applySnippetFallbackToMessages(Array.isArray(data.messages) ? data.messages : [], threadId),
        threadId
      );
      const sdkMessages = getInboxSdkThreadMessages(threadId);
      const scoredDom = scoreExtractedMessages(messages);
      const scoredSdk = scoreExtractedMessages(sdkMessages);
      if (scoredSdk > scoredDom && hasMeaningfulCapturedMessages(sdkMessages)) {
        if (scoredSdk > bestScore) {
          bestScore = scoredSdk;
          bestData = { ...data, messages: sdkMessages };
        }
      } else if (scoredDom > bestScore) {
        bestScore = scoredDom;
        bestData = { ...data, messages };
      }
      logChatDebug("contact-hydration:last-chance-finish", {
        threadId: normalize(threadId || ""),
        mailbox: mailboxCacheKey(mailbox),
        domCount: Array.isArray(messages) ? messages.length : 0,
        sdkCount: Array.isArray(sdkMessages) ? sdkMessages.length : 0,
        bestScore
      }, { throttleKey: `contact-hydration-last-chance-finish:${normalize(threadId || "")}`, throttleMs: 260 });
    }

    if (!Array.isArray(bestData.messages) || bestData.messages.length === 0) {
      if (typeof logEvent === "function") {
        logEvent("H199", {
          rc: 6,
          rs: "hydration-empty-messages",
          threadId: normalize(threadId || ""),
          mailbox: mailboxCacheKey(mailbox),
          hint: threadHintHref ? "yes" : "no"
        });
      }
      logWarn(`Thread hydration failed threadId=${normalize(threadId || "")} mailbox=${normalize(mailbox || "")} hint=${threadHintHref ? "yes" : "no"}`);
    }
    return {
      ...bestData,
      extractAttempts,
      contextHits
    };
  }


    return {
      initialForSender,
      contactKeyFromMessage,
      senderDisplayName,
      messageDateSortValue,
      compareMailboxRowsNewestFirst,
      mailboxRowMatchesContactConversation,
      expandContactGroupWithCachedCounterparts,
      groupMessagesByContact,
      threadHashForMailbox,
      applySnippetFallbackToMessages,
      scoreExtractedMessages,
      gmailAccountIndex,
      hexThreadIdForThread,
      getThreadCache,
      setThreadCache,
      fetchThreadPrintView,
      extractMessagesFromPrintView,
      hydrateThreadFromPrintView,
      captureThreadDataWithRetry
    };
  };
})();
