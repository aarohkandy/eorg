(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createConversationContextApi = function createConversationContextApi(deps = {}) {
    const {
      NOISE_TEXT,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      threadIdFromHash,
      mailboxKeyFromHash,
      lookupThreadHintHref,
      getMailboxCacheKey,
      getContactKeyFromMessage,
      getGmailMainRoot,
      logOnce,
      logChatDebug,
      summarizeChatMessageForDebug
    } = deps;

    const mailboxCacheKey = (...args) => {
      const fn = typeof getMailboxCacheKey === "function" ? getMailboxCacheKey() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const contactKeyFromMessage = (...args) => {
      const fn = typeof getContactKeyFromMessage === "function" ? getContactKeyFromMessage() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
  function collectEmailsFromUnknownValue(value, out = [], depth = 0, seen = new Set()) {
    if (depth > 4 || out.length >= 50) return out;
    if (typeof value === "undefined" || value === null) return out;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      const candidates = extractEmails(String(value || ""), 8);
      for (const email of candidates) {
        if (!email || seen.has(email)) continue;
        seen.add(email);
        out.push(email);
        if (out.length >= 50) break;
      }
      return out;
    }
    if (Array.isArray(value)) {
      const limit = Math.min(value.length, 80);
      for (let i = 0; i < limit && out.length < 50; i += 1) {
        collectEmailsFromUnknownValue(value[i], out, depth + 1, seen);
      }
      return out;
    }
    if (typeof value === "object") {
      const keys = Object.keys(value).slice(0, 60);
      for (const key of keys) {
        if (out.length >= 50) break;
        collectEmailsFromUnknownValue(value[key], out, depth + 1, seen);
      }
      return out;
    }
    return out;
  }

  function chooseLikelyAccountEmail(candidates) {
    const emails = normalizeEmailList(candidates, 40);
    if (emails.length === 0) return "";
    const scored = emails
      .map((email, index) => {
        let score = 0;
        if (!isSystemNoReplyEmail(email)) score += 3;
        if (/@gmail\.com$/i.test(email) || /@googlemail\.com$/i.test(email)) score += 2;
        if (!/^(no-?reply|noreply|notifications?)@/i.test(email)) score += 1;
        score += Math.max(0, 12 - index) * 0.01;
        return { email, score };
      })
      .sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].email : "";
  }

  function collectAccountEmailCandidatesFromNode(node) {
    if (!(node instanceof HTMLElement)) return [];
    return normalizeEmailList([
      node.getAttribute("data-email"),
      node.getAttribute("email"),
      node.getAttribute("data-og-email"),
      node.getAttribute("data-account-email"),
      node.getAttribute("aria-label"),
      node.getAttribute("title"),
      node.textContent
    ], 10);
  }

  function detectAccountEmailFromChromeControls() {
    const selectors = [
      'a[aria-label*="Google Account"]',
      'button[aria-label*="Google Account"]',
      '[role="button"][aria-label*="Google Account"]',
      '[aria-label*="Google Account"][data-email]',
      '[aria-label*="Google Account"][title*="@"]',
      'a[href*="SignOutOptions"][aria-label*="@"]',
      'button[aria-label*="@gmail.com"]',
      'button[aria-label*="@googlemail.com"]'
    ];
    const scored = [];
    const seenNode = new Set();
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement)) continue;
        if (seenNode.has(node)) continue;
        seenNode.add(node);
        const candidates = collectAccountEmailCandidatesFromNode(node);
        if (candidates.length === 0) continue;
        const rect = node.getBoundingClientRect();
        const nearTop = rect.top >= -24 && rect.top <= 220;
        const nearRight = rect.left >= (window.innerWidth * 0.55);
        const label = normalize(node.getAttribute("aria-label") || "").toLowerCase();
        for (const email of candidates) {
          let score = 0;
          if (nearTop) score += 3;
          if (nearRight) score += 3;
          if (label.includes("google account")) score += 5;
          if (/@gmail\.com$/i.test(email) || /@googlemail\.com$/i.test(email)) score += 2;
          if (!isSystemNoReplyEmail(email)) score += 1;
          scored.push({ email, score });
        }
      }
    }
    if (scored.length === 0) return "";
    scored.sort((a, b) => b.score - a.score);
    return scored[0] ? scored[0].email : "";
  }

  function conversationKeyFromContact(contactEmail) {
    const email = extractEmail(contactEmail || "");
    if (!email) return "";
    return `contact:${email}`;
  }

  function contactEmailFromConversationKey(conversationKey) {
    const raw = normalize(conversationKey || "").toLowerCase();
    if (!raw) return "";
    if (raw.startsWith("contact:")) return extractEmail(raw.slice("contact:".length));
    return extractEmail(raw);
  }

  function activeConversationContactEmail() {
    return (
      extractEmail(state.activeContactEmail || "")
      || contactEmailFromConversationKey(state.activeConversationKey || "")
      || extractEmail(state.activeContactKey || "")
      || ""
    );
  }

  function activeConversationContext(overrides = {}) {
    const fallbackAccount = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
    const activeAccountEmail = extractEmail(
      overrides.activeAccountEmail
      || fallbackAccount
      || detectCurrentUserEmail()
    );
    const contactEmail = extractEmail(
      overrides.contactEmail
      || state.activeContactEmail
      || contactEmailFromConversationKey(overrides.conversationKey || "")
      || activeConversationContactEmail()
    );
    const inferredConversationKey = normalize(
      overrides.conversationKey
      || state.activeConversationKey
      || conversationKeyFromContact(contactEmail)
    );
    return {
      activeAccountEmail,
      contactEmail,
      conversationKey: inferredConversationKey,
      includeGroups: true
    };
  }

  function clearContactConversationState() {
    if (state.contactTimelineRefreshTimer) {
      clearTimeout(state.contactTimelineRefreshTimer);
      state.contactTimelineRefreshTimer = null;
    }
    state.contactHydrationRunId = Number(state.contactHydrationRunId || 0) + 1;
    state.activeContactKey = "";
    state.activeContactEmail = "";
    state.activeConversationKey = "";
    state.contactThreadIds = [];
    state.mergedMessages = [];
    state.activeTimelineMessages = [];
    state.contactTimelineIsDeep = false;
    state.contactTimelineDeepHydratedAt = 0;
    state.contactTimelineDeepCount = 0;
    state.contactTimelineV2Metrics = null;
    state.contactDisplayName = "";
    state.contactChatLoading = false;
    state.suspendHashSyncDuringContactHydration = false;
    state.threadExtractRetry = 0;
  }

  function activeThreadTimelineContext(overrides = {}) {
    const threadId = canonicalThreadId(
      overrides.threadId
      || state.currentThreadIdForReply
      || state.activeThreadId
      || threadIdFromHash(window.location.hash || "")
      || ""
    ) || normalize(
      overrides.threadId
      || state.currentThreadIdForReply
      || state.activeThreadId
      || threadIdFromHash(window.location.hash || "")
      || ""
    );
    const mailbox = mailboxCacheKey(
      overrides.mailbox
      || state.currentThreadMailbox
      || mailboxKeyFromHash(state.lastListHash || window.location.hash || "#inbox")
      || "inbox"
    );
    const activeAccountEmail = extractEmail(
      overrides.activeAccountEmail
      || state.activeAccountEmail
      || state.currentUserEmail
      || detectCurrentUserEmail()
    );
    const threadHintHref = normalize(
      overrides.threadHintHref
      || state.currentThreadHintHref
      || lookupThreadHintHref(threadId)
      || ""
    );
    return {
      threadId,
      mailbox,
      activeAccountEmail,
      threadHintHref
    };
  }

  function isSelfSenderLabel(value) {
    const raw = normalize(value || "").toLowerCase();
    if (!raw) return false;
    return /^(you|me|myself)(\b|$)/i.test(raw) || /^to me(\b|$)/i.test(raw);
  }

  function messagePartySnapshot(message, context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const sender = normalize(msg.sender || "");
    const ctx = activeConversationContext(context);
    const mailbox = mailboxCacheKey(msg.mailbox || "");
    let senderEmail = extractEmail(msg.senderEmail || msg.from || sender);
    if (
      !senderEmail
      && ctx.activeAccountEmail
      && (
        isSelfSenderLabel(sender)
        || mailbox === "sent"
        || normalize(msg.direction || "").toLowerCase() === "outgoing"
        || normalize(msg.sourceType || "").toLowerCase() === "optimistic"
      )
    ) {
      senderEmail = ctx.activeAccountEmail;
    }

    const recipientEmails = normalizeEmailList([
      msg.recipientEmails,
      msg.recipients,
      msg.to,
      msg.cc,
      msg.bcc,
      msg.replyTo,
      msg.deliveredTo,
      msg.headerText,
      msg.scopeText,
      msg.ariaLabel
    ]);
    const recipientSet = new Set(recipientEmails);
    if (senderEmail) recipientSet.delete(senderEmail);

    // Gmail DOM extraction does not always expose recipients; infer the counterpart for 1:1 messages.
    if (ctx.contactEmail && ctx.activeAccountEmail) {
      if (senderEmail === ctx.activeAccountEmail && !recipientSet.has(ctx.contactEmail)) {
        recipientSet.add(ctx.contactEmail);
      }
      if (senderEmail === ctx.contactEmail && !recipientSet.has(ctx.activeAccountEmail)) {
        recipientSet.add(ctx.activeAccountEmail);
      }
    }

    const participants = normalizeEmailList([
      senderEmail,
      Array.from(recipientSet),
      msg.participants
    ]);
    return {
      senderEmail,
      recipientEmails: Array.from(recipientSet),
      participants,
      context: ctx
    };
  }

  function messageBelongsToConversation(message, context = {}) {
    const snapshot = messagePartySnapshot(message, context);
    const contactEmail = extractEmail(snapshot.context.contactEmail || "");
    const activeAccountEmail = extractEmail(snapshot.context.activeAccountEmail || "");
    const messageMailbox = mailboxCacheKey(message && message.mailbox ? message.mailbox : "");
    const sourceType = normalize(message && message.sourceType ? message.sourceType : "").toLowerCase();
    const optimisticOutgoing = Boolean(
      sourceType === "optimistic"
      || Boolean(message && message.isOptimistic)
      || normalize(message && message.clientSendId ? message.clientSendId : "")
    );
    const inferredContactKey = extractEmail(contactKeyFromMessage(message || {}));
    const inferredContactMatch = Boolean(contactEmail && inferredContactKey && inferredContactKey === contactEmail);
    if (!contactEmail) return true;
    if (optimisticOutgoing) {
      logChatDebug("conversation-filter:include-optimistic-outgoing", {
        contactEmail,
        activeAccountEmail,
        sourceType,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `include-optimistic:${contactEmail}`, throttleMs: 800 });
      return true;
    }

    const participantSet = new Set(snapshot.participants || []);
    const hasContact = participantSet.has(contactEmail) || snapshot.senderEmail === contactEmail;
    if (!hasContact) {
      const keepSparseOutgoing = Boolean(
        activeAccountEmail
        && snapshot.senderEmail === activeAccountEmail
        && (inferredContactMatch || messageMailbox === "sent")
      );
      const keepUnknownSelfOutgoing = Boolean(
        !activeAccountEmail
        && (isSelfSenderLabel(message && message.sender ? message.sender : "") || optimisticOutgoing)
      );
      if (keepSparseOutgoing) {
        logChatDebug("conversation-filter:include-sparse-outgoing", {
          contactEmail,
          activeAccountEmail,
          inferredContactKey,
          mailbox: messageMailbox,
          snapshot: summarizeChatMessageForDebug(message)
        }, { throttleKey: `include-sparse-outgoing:${contactEmail}:${messageMailbox}`, throttleMs: 900 });
        return true;
      }
      if (keepUnknownSelfOutgoing) {
        logChatDebug("conversation-filter:include-self-outgoing-no-account", {
          contactEmail,
          activeAccountEmail,
          inferredContactKey,
          mailbox: messageMailbox,
          snapshot: summarizeChatMessageForDebug(message)
        }, { throttleKey: `include-self-outgoing-no-account:${contactEmail}`, throttleMs: 900 });
        return true;
      }
      logChatDebug("conversation-filter:drop-no-contact", {
        contactEmail,
        activeAccountEmail,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `drop-no-contact:${contactEmail}:${snapshot.senderEmail || ""}`, throttleMs: 1200 });
      return false;
    }
    if (!activeAccountEmail) {
      if (inferredContactMatch) {
        logChatDebug("conversation-filter:include-inferred-contact-no-account", {
          contactEmail,
          inferredContactKey,
          snapshot: summarizeChatMessageForDebug(message)
        }, { throttleKey: `include-inferred-no-account:${contactEmail}`, throttleMs: 1400 });
        return true;
      }
      logChatDebug("conversation-filter:include-no-account", {
        contactEmail,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `include-no-account:${contactEmail}`, throttleMs: 1800 });
      return hasContact;
    }

    const hasAccount = participantSet.has(activeAccountEmail) || snapshot.senderEmail === activeAccountEmail;
    if (hasAccount) return true;

    // Keep incoming rows from the selected contact even when Gmail omits recipient metadata.
    const keepAsIncoming = snapshot.senderEmail === contactEmail;
    const keepAsOutgoing = Boolean(
      snapshot.senderEmail === activeAccountEmail
      && (inferredContactMatch || messageMailbox === "sent")
    );
    if (keepAsIncoming || keepAsOutgoing) {
      logChatDebug("conversation-filter:include-fallback-match", {
        contactEmail,
        activeAccountEmail,
        inferredContactKey,
        mailbox: messageMailbox,
        fallback: keepAsIncoming ? "incoming" : "outgoing",
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `include-fallback-match:${contactEmail}:${messageMailbox}`, throttleMs: 1000 });
      return true;
    }
    if (!keepAsIncoming && !keepAsOutgoing) {
      logChatDebug("conversation-filter:drop-no-account-match", {
        contactEmail,
        activeAccountEmail,
        snapshot: summarizeChatMessageForDebug(message)
      }, { throttleKey: `drop-no-account-match:${contactEmail}:${activeAccountEmail}`, throttleMs: 1200 });
    }
    return false;
  }

  function isGenericSenderLabel(value) {
    const v = normalize(value || "").toLowerCase();
    if (!v) return true;
    if (["google", "gmail", "inbox", "chat", "calendar", "meet", "you", "me", "to me"].includes(v)) return true;
    if (NOISE_TEXT.has(v)) return true;
    return false;
  }

  function isSystemNoReplyEmail(email) {
    const v = normalize(email || "").toLowerCase();
    if (!v) return false;
    return (
      /^no-?reply@accounts\.google\.com$/i.test(v) ||
      /^no-?reply@google\.com$/i.test(v) ||
      /^noreply@googlemail\.com$/i.test(v)
    );
  }

  function isLowConfidenceSender(sender) {
    const value = normalize(sender || "");
    if (!value) return true;
    if (isGenericSenderLabel(value)) return true;
    const email = extractEmail(value);
    if (email && isSystemNoReplyEmail(email)) return true;
    return false;
  }

  function choosePreferredSender(capturedSender, seededSender) {
    const captured = normalize(capturedSender || "");
    const seeded = normalize(seededSender || "");
    if (!captured) return seeded || captured;
    if (!seeded) return captured;
    if (isLowConfidenceSender(captured) && !isLowConfidenceSender(seeded)) return seeded;
    const capturedEmail = extractEmail(captured);
    const seededEmail = extractEmail(seeded);
    if (
      capturedEmail &&
      seededEmail &&
      capturedEmail !== seededEmail &&
      isSystemNoReplyEmail(capturedEmail) &&
      !isSystemNoReplyEmail(seededEmail)
    ) {
      return seeded;
    }
    return captured;
  }

  function hashString(input) {
    const text = String(input || "");
    if (!text) return "0";
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }

  function detectCurrentUserEmail(force = false) {
    const ACCOUNT_DETECT_CACHE_MS = 5 * 60 * 1000;
    const now = Date.now();
    if (!force && state.currentUserEmail && now - Number(state.currentUserEmailDetectedAt || 0) < ACCOUNT_DETECT_CACHE_MS) {
      state.activeAccountEmail = state.currentUserEmail;
      return state.currentUserEmail;
    }
    if (!force && now - Number(state.lastInteractionAt || 0) < 6000) {
      const cached = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
      if (cached) return cached;
    }
    if (force && now - Number(state.lastInteractionAt || 0) < 1200) {
      const recent = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
      if (recent) return recent;
    }

    const foundFromChrome = detectAccountEmailFromChromeControls();
    if (foundFromChrome) {
      state.currentUserEmail = foundFromChrome;
      state.activeAccountEmail = foundFromChrome;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "chrome-controls",
        email: foundFromChrome
      }, { throttleKey: `account-detect:chrome:${foundFromChrome}`, throttleMs: 2200 });
      return foundFromChrome;
    }
    const cachedAfterChrome = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
    if (!force) {
      // Non-forced paths run during frequent render/normalization loops.
      // Keep those paths cheap and defer deep scans to explicit background/forced refresh.
      return cachedAfterChrome;
    }
    const lastDeepLookupAt = Number(state.currentUserEmailDeepLookupAt || 0);
    if (lastDeepLookupAt > 0 && now - lastDeepLookupAt < 30000) {
      return cachedAfterChrome;
    }
    state.currentUserEmailDeepLookupAt = now;

    const selectors = [
      '[data-email]',
      '[data-og-email]',
      '[data-account-email]',
      'button[aria-label*="@"]',
      'a[aria-label*="@"]',
      'img[aria-label*="@"]',
      '[aria-label*="Google Account"]'
    ];
    const candidates = [];
    const mainRoot = getGmailMainRoot();
    for (const selector of selectors) {
      for (const node of Array.from(document.querySelectorAll(selector))) {
        if (!(node instanceof HTMLElement)) continue;
        if (mainRoot instanceof HTMLElement && mainRoot.contains(node)) continue;
        candidates.push(
          node.getAttribute("data-email"),
          node.getAttribute("email"),
          node.getAttribute("data-og-email"),
          node.getAttribute("data-account-email"),
          node.getAttribute("aria-label"),
          node.getAttribute("title"),
          node.textContent
        );
      }
    }

    const foundFromDom = chooseLikelyAccountEmail(candidates);
    if (foundFromDom) {
      state.currentUserEmail = foundFromDom;
      state.activeAccountEmail = foundFromDom;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "dom",
        email: foundFromDom,
        candidateCount: normalizeEmailList(candidates).length
      }, { throttleKey: `account-detect:dom:${foundFromDom}`, throttleMs: 2200 });
      return foundFromDom;
    }

    const globalCandidates = [];
    try {
      if (Array.isArray(globalThis.GLOBALS)) {
        collectEmailsFromUnknownValue(globalThis.GLOBALS, globalCandidates);
      }
      if (typeof globalThis.APP_INITIALIZATION_STATE !== "undefined") {
        collectEmailsFromUnknownValue(globalThis.APP_INITIALIZATION_STATE, globalCandidates);
      }
      if (typeof globalThis.VIEW_DATA !== "undefined") {
        collectEmailsFromUnknownValue(globalThis.VIEW_DATA, globalCandidates);
      }
      if (globalThis.gbar && typeof globalThis.gbar.getEmail === "function") {
        globalCandidates.push(globalThis.gbar.getEmail());
      }
    } catch (_) {
      // ignore global access errors
    }
    const fromGlobals = chooseLikelyAccountEmail(globalCandidates);
    if (fromGlobals) {
      state.currentUserEmail = fromGlobals;
      state.activeAccountEmail = fromGlobals;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "globals",
        email: fromGlobals,
        candidateCount: normalizeEmailList(globalCandidates).length
      }, { throttleKey: `account-detect:globals:${fromGlobals}`, throttleMs: 2200 });
      return fromGlobals;
    }

    const scriptCandidates = [];
    try {
      const scripts = Array.from(document.querySelectorAll("script:not([src]), script[type='application/json']")).slice(0, 20);
      for (const script of scripts) {
        if (!(script instanceof HTMLScriptElement)) continue;
        const text = String(script.textContent || "");
        if (text.length < 5) continue;
        const sample = text.length > 14000 ? text.slice(0, 14000) : text;
        collectEmailsFromUnknownValue(sample, scriptCandidates);
        if (scriptCandidates.length >= 20) break;
      }
    } catch (_) {
      // ignore script parse failures
    }
    const fromScripts = chooseLikelyAccountEmail(scriptCandidates);
    const activeContactEmail = extractEmail(state.activeContactEmail || activeConversationContactEmail() || "");
    if (fromScripts && activeContactEmail && fromScripts === activeContactEmail) {
      logChatDebug("account-detect:script-candidate-rejected", {
        source: "scripts",
        candidate: fromScripts,
        activeContactEmail
      }, { throttleKey: `account-detect-script-rejected:${fromScripts}`, throttleMs: 1800 });
    } else if (fromScripts) {
      state.currentUserEmail = fromScripts;
      state.activeAccountEmail = fromScripts;
      state.currentUserEmailDetectedAt = now;
      logChatDebug("account-detect:resolved", {
        source: "scripts",
        email: fromScripts,
        candidateCount: normalizeEmailList(scriptCandidates).length
      }, { throttleKey: `account-detect:scripts:${fromScripts}`, throttleMs: 2200 });
      return fromScripts;
    }

    if (state.currentUserEmail) {
      state.activeAccountEmail = state.currentUserEmail;
      return state.currentUserEmail;
    }
    if (state.activeAccountEmail) return state.activeAccountEmail;
    logOnce(
      "current-user-email-missing",
      "warn",
      "Current Gmail account email could not be detected; outgoing direction will use heuristic fallback."
    );
    logChatDebug("account-detect:missing", {
      source: "none",
      hash: normalize(window.location.hash || ""),
      activeConversationKey: normalize(state.activeConversationKey || ""),
      activeContactEmail: extractEmail(state.activeContactEmail || "")
    }, { throttleKey: "account-detect-missing", throttleMs: 2200 });
    return "";
  }

  function classifyMessageDirection(message, threadId = "", context = {}) {
    const msg = message && typeof message === "object" ? message : {};
    const sender = normalize(msg.sender || "");
    const parties = messagePartySnapshot(msg, context);
    const senderEmail = parties.senderEmail;
    const recipientSet = new Set(Array.isArray(parties.recipientEmails) ? parties.recipientEmails : []);
    const participantSet = new Set(Array.isArray(parties.participants) ? parties.participants : []);
    const userEmail = extractEmail(parties.context.activeAccountEmail || detectCurrentUserEmail());
    const mailbox = mailboxCacheKey(msg.mailbox || "");

    if (!senderEmail && isSelfSenderLabel(sender)) {
      logChatDebug("direction:outgoing-you-label", {
        threadId: normalize(threadId || msg.threadId || ""),
        sender
      }, { throttleKey: "direction-you-label", throttleMs: 1400 });
      return "outgoing";
    }
    if (senderEmail && userEmail && senderEmail === userEmail) {
      return "outgoing";
    }
    if (!senderEmail && userEmail) {
      const userLocal = normalize(userEmail.split("@")[0] || "").toLowerCase();
      const senderLower = sender.toLowerCase();
      if (userLocal && senderLower && senderLower.includes(userLocal)) {
        logChatDebug("direction:outgoing-local-heuristic", {
          userEmail,
          sender,
          senderEmail,
          threadId: normalize(threadId || msg.threadId || "")
        }, { throttleKey: `direction-local:${userLocal}`, throttleMs: 1800 });
        return "outgoing";
      }
    }
    if (mailbox === "sent") {
      const senderLooksSelf = Boolean(
        !senderEmail
        || (userEmail && senderEmail === userEmail)
        || isSelfSenderLabel(sender)
      );
      if (senderLooksSelf || !userEmail) {
        logChatDebug("direction:outgoing-sent-mailbox", {
          threadId: normalize(threadId || msg.threadId || ""),
          sender,
          senderEmail,
          userEmail
        }, { throttleKey: `direction-outgoing-sent:${normalize(threadId || msg.threadId || "")}`, throttleMs: 1100 });
        return "outgoing";
      }
    }

    if (
      senderEmail
      && userEmail
      && senderEmail !== userEmail
      && (recipientSet.has(userEmail) || participantSet.has(userEmail))
    ) {
      return "incoming";
    }

    // Thread-first mode: if sender differs from active account, treat as incoming.
    if (senderEmail && userEmail && senderEmail !== userEmail) {
      return "incoming";
    }
    if (senderEmail && !userEmail && mailbox !== "sent") {
      return "incoming";
    }
    if (normalize(msg.sourceType || "") === "optimistic") return "outgoing";
    logChatDebug("direction:unknown", {
      threadId: normalize(threadId || msg.threadId || ""),
      sender,
      senderEmail,
      userEmail,
      recipientEmails: Array.from(recipientSet),
      participants: Array.from(participantSet),
      message: summarizeChatMessageForDebug(msg)
    }, {
      throttleKey: `direction-unknown:${normalize(threadId || msg.threadId || "")}:${senderEmail || sender || "unknown"}`,
      throttleMs: 1200
    });
    return "unknown";
  }


    return {
      collectEmailsFromUnknownValue,
      chooseLikelyAccountEmail,
      collectAccountEmailCandidatesFromNode,
      detectAccountEmailFromChromeControls,
      conversationKeyFromContact,
      contactEmailFromConversationKey,
      activeConversationContactEmail,
      activeConversationContext,
      clearContactConversationState,
      activeThreadTimelineContext,
      isSelfSenderLabel,
      messagePartySnapshot,
      messageBelongsToConversation,
      isGenericSenderLabel,
      isSystemNoReplyEmail,
      isLowConfidenceSender,
      choosePreferredSender,
      hashString,
      detectCurrentUserEmail,
      classifyMessageDirection
    };
  };
})();
