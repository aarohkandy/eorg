(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createThreadDomExtractApi = function createThreadDomExtractApi(deps = {}) {
    const {
      state,
      THREAD_MESSAGE_SELECTORS,
      BODY_SELECTORS,
      STRICT_BODY_SELECTORS,
      SECONDARY_BODY_SELECTORS,
      THREAD_BODY_PLACEHOLDER,
      THREAD_NO_CONTENT,
      THREAD_READY_MAX_RETRIES,
      THREAD_READY_RETRY_BASE_MS,
      THREAD_EXPAND_MAX_PASSES,
      THREAD_EXPAND_MAX_CLICKS_PER_PASS,
      getGmailMainRoot,
      normalize,
      threadIdFromHash,
      isThreadHash,
      isElementVisible,
      isDisabledButton,
      dispatchSyntheticClick,
      sleep,
      logChatDebug,
      threadHintKeysForThread,
      canonicalThreadId,
      cleanThreadMessageBody,
      safeThreadFallbackText,
      isLikelyMetadataBlob,
      getInboxSdkThreadMessages,
      extractEmail,
      detectCurrentUserEmail,
      isSelfSenderLabel,
      normalizeEmailList,
      isUseful,
      looksLikeDateOrTime,
      isGenericSenderLabel,
      hasMeaningfulCapturedMessages,
      cleanSubject,
      normalizeThreadMessagesForChat,
      hashString,
      logWarn,
      logEvent
    } = deps;

  const EXTRA_SENT_THREAD_SELECTORS = [
    ".adn.ads",
    ".h7 .adn.ads",
    ".adn.ads[data-message-id]",
    ".adn.ads[data-legacy-message-id]",
    ".h7.ie",
    ".h7.ie .aju",
    ".h7.ie .aju[data-message-id]",
    ".h7.ie .aju[data-legacy-message-id]",
    ".aju[data-message-id]",
    ".aju[data-legacy-message-id]",
    "[data-legacy-message-id]"
  ].join(", ");

  function threadDomReadinessSnapshot() {
    const main = getGmailMainRoot() || document.querySelector('[role="main"]') || document.body;
    const scope = main instanceof HTMLElement ? main : document;
    const messageContainers = scope.querySelectorAll(THREAD_MESSAGE_SELECTORS).length;
    const bodyNodes = scope.querySelectorAll(BODY_SELECTORS).length;
    let iframeBodyNodes = 0;
    let iframeCount = 0;
    for (const ifr of Array.from(document.querySelectorAll("iframe")).slice(0, 12)) {
      iframeCount += 1;
      try {
        const doc = ifr.contentDocument;
        if (!doc || doc === document) continue;
        iframeBodyNodes += doc.querySelectorAll(BODY_SELECTORS).length;
      } catch (_) {
        // cross-origin frames are expected
      }
    }
    const ready = messageContainers > 0 || bodyNodes > 0 || iframeBodyNodes > 0;
    return {
      ready,
      messageContainers,
      bodyNodes,
      iframeBodyNodes,
      iframeCount
    };
  }

  function waitForThreadContentReady(threadId = "") {
    const readiness = threadDomReadinessSnapshot();
    const normalizedThreadId = normalize(
      threadId
      || state.currentThreadIdForReply
      || state.activeThreadId
      || threadIdFromHash(window.location.hash || "")
      || ""
    );
    const priorAttempts = Math.max(0, Number(state.threadExtractRetry || 0));
    if (readiness.ready) {
      return {
        ready: true,
        timedOut: false,
        attempt: priorAttempts,
        waitMs: 0,
        readiness,
        threadId: normalizedThreadId
      };
    }
    if (priorAttempts >= THREAD_READY_MAX_RETRIES) {
      return {
        ready: false,
        timedOut: true,
        attempt: priorAttempts,
        waitMs: 0,
        readiness,
        threadId: normalizedThreadId
      };
    }
    const retryAttempt = priorAttempts + 1;
    const waitMs = THREAD_READY_RETRY_BASE_MS + retryAttempt * 80;
    state.threadExtractRetry = retryAttempt;
    return {
      ready: false,
      timedOut: false,
      attempt: retryAttempt,
      waitMs,
      readiness,
      threadId: normalizedThreadId
    };
  }

  function canExpandThreadContentNow() {
    return Boolean(
      state.currentView === "thread" || isThreadHash(window.location.hash || "")
    );
  }

  function collectThreadExpandTargets(scope) {
    if (!(scope instanceof HTMLElement)) return [];
    const keywordTokens = [
      "expand",
      "show trimmed",
      "show hidden",
      "show quoted",
      "show more",
      "more messages",
      "more message",
      "quoted text"
    ];
    const selectors = [
      '[role="button"]',
      'button',
      '[role="link"]',
      '.ajR',
      '.ajT',
      '.adx',
      '[aria-expanded="false"]'
    ];
    const candidates = [];
    const seen = new Set();
    for (const selector of selectors) {
      const nodes = Array.from(scope.querySelectorAll(selector));
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (!isElementVisible(node)) continue;
        if ((node.matches("button, [role='button']") || node.getAttribute("aria-expanded") === "false") && isDisabledButton(node)) {
          continue;
        }
        const haystack = normalize(
          node.getAttribute("aria-label")
          || node.getAttribute("data-tooltip")
          || node.getAttribute("title")
          || node.innerText
          || node.textContent
        ).toLowerCase();
        if (!haystack) continue;
        if (!keywordTokens.some((token) => haystack.includes(token))) continue;
        const key = `${node.tagName}|${normalize(node.getAttribute("aria-label") || "")}|${normalize(node.textContent || "").slice(0, 120)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(node);
      }
    }
    return candidates;
  }

  function collectCollapsedThreadMessageHeaders(scope) {
    if (!(scope instanceof HTMLElement)) return [];
    const containers = Array.from(scope.querySelectorAll(THREAD_MESSAGE_SELECTORS)).slice(0, 240);
    const headers = [];
    const seen = new Set();
    for (const container of containers) {
      if (!(container instanceof HTMLElement)) continue;
      const hasBody = Boolean(findBodyNodeInScope(container) || findBodyNodeInScopeIframes(container));
      if (hasBody) continue;
      const header = container.querySelector(
        '[aria-expanded="false"], [role="button"], .adx, .ajR, .ajT, h3, [tabindex]'
      );
      if (!(header instanceof HTMLElement)) continue;
      if (!isElementVisible(header)) continue;
      if (header.matches("button, [role='button']") && isDisabledButton(header)) continue;
      const marker = normalize(
        container.getAttribute("data-message-id")
        || container.getAttribute("data-legacy-message-id")
        || header.getAttribute("aria-label")
        || header.textContent
      ).slice(0, 180);
      if (!marker || seen.has(marker)) continue;
      seen.add(marker);
      headers.push(header);
    }
    return headers;
  }

  async function expandCollapsedThreadMessagesForExtraction(threadId = "", options = {}) {
    if (!canExpandThreadContentNow()) return { clicks: 0, passes: 0 };
    const main = getGmailMainRoot() || document.querySelector('[role="main"]') || document.body;
    if (!(main instanceof HTMLElement)) return { clicks: 0, passes: 0 };
    const maxPasses = Math.max(1, Math.min(10, Number(options.maxPasses) || THREAD_EXPAND_MAX_PASSES));
    const maxClicksPerPass = Math.max(8, Math.min(80, Number(options.maxClicksPerPass) || THREAD_EXPAND_MAX_CLICKS_PER_PASS));
    let totalClicks = 0;
    let passes = 0;
    const clicked = new Set();
    const threadKey = normalize(threadId || state.currentThreadIdForReply || state.activeThreadId || "");

    // No pre-wait — start scanning immediately; the caller already waits for context.

    function nodeMarker(node) {
      return `${node.tagName}|${normalize(
        node.getAttribute("data-message-id")
        || node.getAttribute("data-legacy-message-id")
        || node.getAttribute("aria-label")
        || node.textContent
      ).slice(0, 220)}`;
    }

    function collectAllCollapseTargets() {
      const seen = new Set();
      const out = [];
      function add(node) {
        if (!(node instanceof HTMLElement) || !node.isConnected) return;
        if (!isElementVisible(node)) return;
        if (node.matches(".adn.ads, .ads")) {
          const hasCollapsedToggle = Boolean(
            node.matches('[aria-expanded="false"]')
            || node.querySelector('[aria-expanded="false"], .ajR, .aH1, .adx, [data-tooltip*="trimmed"]')
          );
          if (!hasCollapsedToggle) return;
        }
        const marker = nodeMarker(node);
        if (clicked.has(marker)) return;
        if (seen.has(marker)) return;
        seen.add(marker);
        out.push(node);
      }
      // Accordion / collapsed message cards
      for (const n of main.querySelectorAll(".kv, .gK, .et, .kQ, .pG, .adx, .adn.ads, .h7.ie .aju, [data-message-id], [data-legacy-message-id]")) add(n);
      // Trimmed content ellipsis buttons
      for (const n of main.querySelectorAll('.ajR, .aH1, [data-tooltip*="trimmed"], div.aXjCH')) add(n);
      // aria-expanded=false — any collapsed interactive element
      for (const n of main.querySelectorAll('[aria-expanded="false"]')) {
        if (!(n instanceof HTMLElement)) continue;
        if (isDisabledButton(n)) continue;
        add(n);
      }
      // Existing keyword-based expand buttons
      for (const n of collectThreadExpandTargets(main)) add(n);
      // Message containers that have no rendered body yet
      for (const n of collectCollapsedThreadMessageHeaders(main)) add(n);
      return out;
    }

    while (passes < maxPasses) {
      if (!canExpandThreadContentNow()) break;
      const elementsToClick = collectAllCollapseTargets();
      if (typeof DEBUG_THREAD_EXTRACT !== "undefined" && DEBUG_THREAD_EXTRACT) {
        console.warn("[Expansion Loop] Found targets:", elementsToClick.length, "Target nodes:", elementsToClick);
      }
      if (elementsToClick.length === 0) {
        if (typeof DEBUG_THREAD_EXTRACT !== "undefined" && DEBUG_THREAD_EXTRACT) {
          console.warn("[Expansion Loop] No more collapsed elements. Breaking loop.");
        }
        break;
      }
      let clickedThisPass = 0;
      for (const node of elementsToClick) {
        if (clickedThisPass >= maxClicksPerPass) break;
        if (!node.isConnected || !isElementVisible(node)) continue;
        const marker = nodeMarker(node);
        if (clicked.has(marker)) continue;
        clicked.add(marker);
        try {
          dispatchSyntheticClick(node);
          clickedThisPass += 1;
        } catch (error) {
          logChatDebug("thread-expand:click-failed", {
            threadId: threadKey,
            nodeClass: normalize(node.className || "").slice(0, 120),
            nodeTag: normalize(node.tagName || ""),
            message: normalize(error && error.message ? error.message : String(error || "")).slice(0, 120)
          }, { throttleKey: "thread-expand-click-failed", throttleMs: 400 });
        }
      }
      if (clickedThisPass === 0) break;
      totalClicks += clickedThisPass;
      passes += 1;
      // Short yield — lets the browser paint and begin XHR without blocking clicks
      await sleep(80);
    }

    if (totalClicks > 0) {
      logChatDebug("thread-expand:applied", {
        threadId: threadKey,
        clicks: totalClicks,
        passes
      }, { throttleKey: `thread-expand:${threadKey || "unknown"}`, throttleMs: 300 });
    }
    return { clicks: totalClicks, passes };
  }

  function hasUsefulBodyText(text) {
    const value = normalize(text);
    return Boolean(value && value !== THREAD_BODY_PLACEHOLDER && value !== THREAD_NO_CONTENT);
  }

  function findFirstBodyNode(scope, selectors) {
    if (!(scope instanceof HTMLElement || scope instanceof Document)) return null;
    for (const selector of selectors) {
      const node = scope.querySelector(selector);
      if (node instanceof HTMLElement) return node;
    }
    return null;
  }

  function findBodyNodeInScope(scope) {
    return (
      findFirstBodyNode(scope, STRICT_BODY_SELECTORS)
      || findFirstBodyNode(scope, SECONDARY_BODY_SELECTORS)
      || null
    );
  }

  function findBodyNodeInScopeIframes(scope) {
    if (!(scope instanceof HTMLElement)) return null;
    for (const ifr of scope.querySelectorAll("iframe")) {
      try {
        const doc = ifr.contentDocument;
        if (!doc || doc === document) continue;
        const node = findBodyNodeInScope(doc);
        if (node instanceof HTMLElement) return node;
      } catch (_) {
        // cross-origin
      }
    }
    return null;
  }

  function threadSnippetFallback(threadIdHint) {
    const keys = threadHintKeysForThread(threadIdHint || "");
    for (const key of keys) {
      const snippet = normalize(state.snippetByThreadId && state.snippetByThreadId[key]);
      if (snippet) return snippet;
    }
    const canonical = canonicalThreadId(threadIdHint || "");
    if (canonical) {
      const direct = normalize(state.snippetByThreadId && state.snippetByThreadId[canonical]);
      if (direct) return direct;
      const hashed = normalize(state.snippetByThreadId && state.snippetByThreadId[`#${canonical}`]);
      if (hashed) return hashed;
    }
    return "";
  }

  function alphaRatio(text) {
    const value = normalize(text || "");
    if (!value) return 0;
    const alphaCount = (value.match(/[A-Za-z]/g) || []).length;
    const visibleCount = (value.match(/[A-Za-z0-9]/g) || []).length;
    if (visibleCount === 0) return 0;
    return alphaCount / visibleCount;
  }

  function extractMessageBodyFromScope(scope, threadIdHint = "") {
    let bodyNode = findBodyNodeInScope(scope);
    if (!bodyNode) {
      bodyNode = findBodyNodeInScopeIframes(scope);
    }

    const bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML || "" : "";
    const bodyTextRaw = bodyNode instanceof HTMLElement
      ? normalize(bodyNode.innerText || bodyNode.textContent || "")
      : "";
    const cleanedBody = cleanThreadMessageBody(bodyTextRaw, bodyHtml);
    if (cleanedBody) {
      return {
        bodyText: cleanedBody,
        bodyHtml: "",
        sourceType: "captured",
        hasBodyNode: true,
        metadataOnly: false
      };
    }

    const snippet = threadSnippetFallback(threadIdHint || "");
    const scopeWindow = normalize((scope && (scope.innerText || scope.textContent) || "").slice(0, 420));
    const fallbackCandidate = snippet || scopeWindow;
    const fallbackText = safeThreadFallbackText(fallbackCandidate);
    if (!fallbackText || isLikelyMetadataBlob(fallbackText)) {
      return {
        bodyText: THREAD_BODY_PLACEHOLDER,
        bodyHtml: "",
        sourceType: "fallback",
        hasBodyNode: false,
        metadataOnly: true
      };
    }
    return {
      bodyText: fallbackText,
      bodyHtml: "",
      sourceType: "fallback",
      hasBodyNode: false,
      metadataOnly: false
    };
  }

  function extractOpenThreadData() {
    let main = document.querySelector('[role="main"]') || document.body;
    if (!(main instanceof HTMLElement)) {
      return { subject: "", messages: [] };
    }
    let threadExtractFailureStats = null;
    const extractionThreadIdHint = normalize(
      threadIdFromHash(window.location.hash || "")
      || state.currentThreadIdForReply
      || state.activeThreadId
      || ""
    );
    const sdkCachedMessages = getInboxSdkThreadMessages(extractionThreadIdHint);
    const extractionAccountEmail = extractEmail(
      state.activeAccountEmail
      || state.currentUserEmail
      || detectCurrentUserEmail()
      || ""
    );

    const subjectCandidates = Array.from(main.querySelectorAll("h1, h2, [role='heading']"))
      .map((node) => normalize(node.textContent))
      .filter((text) => isUseful(text) && !looksLikeDateOrTime(text));
    const subject = subjectCandidates[0] || "No subject";

    const messages = [];
    const LOCALIZED_SELF_TOKENS = new Set([
      "me", "yo", "moi", "ich", "io", "eu", "mim", "min", "ja", "ik", "jeg", "ben",
      "mne", "menya", "меня", "я", "私", "我", "나", "저", "我自己", "내"
    ]);
    function collectThreadContainers(scope) {
      if (!(scope instanceof HTMLElement)) return [];
      const combinedSelectors = `${THREAD_MESSAGE_SELECTORS}, ${EXTRA_SENT_THREAD_SELECTORS}`;
      const out = [];
      const seen = new Set();
      for (const node of Array.from(scope.querySelectorAll(combinedSelectors))) {
        if (!(node instanceof HTMLElement)) continue;
        if (node.closest(".M9, [role='dialog']")) continue;
        if (seen.has(node)) continue;
        seen.add(node);
        out.push(node);
      }
      return out;
    }

    function looksLikeLocalizedSelfSender(value = "") {
      const token = normalize(value || "").toLowerCase();
      if (!token) return false;
      if (isSelfSenderLabel(token)) return true;
      const compact = token.replace(/\./g, "").trim();
      return LOCALIZED_SELF_TOKENS.has(compact);
    }

    function senderElementForScope(scope) {
      if (!(scope instanceof HTMLElement)) return null;
      const selectors = [
        ".h7.ie .aju .gD[email]",
        ".h7.ie .aju .gD[data-hovercard-id]",
        ".h7.ie .aju [email]",
        ".h7.ie .aju [data-hovercard-id]",
        ".aju .gD[email]",
        ".aju .gD[data-hovercard-id]",
        ".aju [email]",
        ".aju [data-hovercard-id]",
        ".adn.ads .gD[email]",
        ".adn.ads .gD[data-hovercard-id]",
        ".adn.ads [email]",
        ".adn.ads [data-hovercard-id]",
        ".gF .gD[email]",
        ".gF [email]",
        ".g2 [email]",
        ".g2 [data-hovercard-id]",
        ".hb [email]",
        ".hb [data-hovercard-id]",
        "h3 .gD[email]",
        "h3 .gD[data-hovercard-id]",
        ".go .gD[email]",
        ".go .gD[data-hovercard-id]",
        ".gD[email]",
        ".gD[data-hovercard-id]",
        "h3 [email]",
        "h3 [data-hovercard-id]",
        ".go [email]",
        ".go [data-hovercard-id]"
      ];
      for (const selector of selectors) {
        const node = scope.querySelector(selector);
        if (node instanceof HTMLElement) return node;
      }
      return null;
    }

    function evaluateOutgoingForScope(scope, senderValue = "", recipientEmails = []) {
      const senderNode = senderElementForScope(scope);
      const senderNodeEmail = extractEmail(
        senderNode instanceof HTMLElement
          ? (
            senderNode.getAttribute("email")
            || senderNode.getAttribute("data-hovercard-id")
            || senderNode.getAttribute("data-hovercard-owner-email")
            || senderNode.getAttribute("name")
            || senderNode.getAttribute("title")
            || senderNode.getAttribute("aria-label")
            || senderNode.textContent
          )
          : ""
      );
      const senderNodeText = normalize(
        senderNode instanceof HTMLElement
          ? (senderNode.innerText || senderNode.textContent || senderNode.getAttribute("title") || "")
          : ""
      );
      const senderEmail = extractEmail(senderValue || "") || senderNodeEmail;
      const headerLine = normalize([
        scope instanceof HTMLElement ? (scope.querySelector(".g2, .hb, .go, .gF, .gH, .ajv")?.textContent || "") : "",
        scope instanceof HTMLElement ? (scope.getAttribute("aria-label") || "") : "",
        senderNode instanceof HTMLElement ? (senderNode.closest("h3, .go, .gF")?.textContent || "") : ""
      ].filter(Boolean).join(" ")).toLowerCase();
      const byEmail = Boolean(
        extractionAccountEmail
        && senderEmail
        && senderEmail === extractionAccountEmail
      );
      const byLocalizedMeLabel = looksLikeLocalizedSelfSender(senderValue || "") || looksLikeLocalizedSelfSender(senderNodeText || "");
      const byStructure = Boolean(
        scope instanceof HTMLElement
        && scope.matches(".adn, .h7 .adn, [data-message-id], [data-legacy-message-id]")
        && (
          /\bto\b/.test(headerLine)
          || headerLine.includes("destinataire")
          || headerLine.includes("para ")
          || headerLine.includes("a ")
        )
        && (
          byLocalizedMeLabel
          || (extractionAccountEmail && headerLine.includes(extractionAccountEmail.split("@")[0] || ""))
          || (
            extractionAccountEmail
            && Array.isArray(recipientEmails)
            && recipientEmails.some((email) => email && email !== extractionAccountEmail)
          )
        )
      );
      const bySentContainer = Boolean(
        scope instanceof HTMLElement
        && (scope.matches(".adn.ads, .ads") || Boolean(scope.closest(".adn.ads, .ads")))
        && (
          /\bto\b/.test(headerLine)
          || headerLine.includes("destinataire")
          || headerLine.includes("para ")
          || headerLine.includes("a ")
          || (Array.isArray(recipientEmails) && recipientEmails.length > 0)
        )
      );
      const scopeNode = scope instanceof HTMLElement ? scope : null;
      const ajuNode = scopeNode && (scopeNode.matches(".aju") ? scopeNode : scopeNode.closest(".aju"));
      const inH7IeWrapper = Boolean(scopeNode && scopeNode.closest(".h7.ie"));
      const hasH7IeBodyNode = Boolean(
        scopeNode
        && (
          scopeNode.matches(".a3s.aiL, .a3s")
          || scopeNode.querySelector(".a3s.aiL, .a3s")
        )
      );
      const hasH7IeAjuMessageId = Boolean(
        ajuNode
        && normalize(
          ajuNode.getAttribute("data-message-id")
          || ajuNode.getAttribute("data-legacy-message-id")
          || ""
        )
      );
      const hasRecipientEvidence = Boolean(
        (Array.isArray(recipientEmails) && recipientEmails.length > 0)
        || /\bto\b/.test(headerLine)
        || headerLine.includes("destinataire")
        || headerLine.includes("para ")
        || headerLine.includes("a ")
      );
      const senderConflictsWithSelf = Boolean(
        extractionAccountEmail
        && senderEmail
        && senderEmail !== extractionAccountEmail
        && !byLocalizedMeLabel
      );
      const byH7IeAjuStructure = Boolean(
        inH7IeWrapper
        && (ajuNode || hasH7IeAjuMessageId)
        && hasH7IeBodyNode
        && (hasRecipientEvidence || !senderConflictsWithSelf)
      );
      const outgoing = byEmail || byLocalizedMeLabel || byStructure || bySentContainer || byH7IeAjuStructure;
      const isSelf = Boolean(
        outgoing || (senderEmail && extractionAccountEmail && senderEmail === extractionAccountEmail)
      );
      const resolvedSenderEmail = isSelf && extractionAccountEmail
        ? extractionAccountEmail
        : senderEmail;
      const resolvedRecipientEmails = normalizeEmailList(recipientEmails)
        .filter((email) => email && email !== resolvedSenderEmail);
      if (isSelf && resolvedRecipientEmails.length === 0) {
        const activeContactEmail = extractEmail(state.activeContactEmail || "");
        if (activeContactEmail && activeContactEmail !== resolvedSenderEmail) {
          resolvedRecipientEmails.push(activeContactEmail);
        }
      }
      const direction = isSelf ? "outgoing" : (resolvedSenderEmail ? "incoming" : "unknown");
      return {
        direction,
        outgoing: isSelf,
        isSelf,
        senderEmail: resolvedSenderEmail,
        recipientEmails: resolvedRecipientEmails,
        senderNode,
        senderNodeText,
        senderNodeHtml: senderNode instanceof HTMLElement ? senderNode.outerHTML : ""
      };
    }

    function warnExtractedSender(scope, sender, senderEval, mid) {
      try {
        const scopeClass = scope instanceof HTMLElement ? normalize(scope.className || "").slice(0, 160) : "";
        console.warn(
          "[reskin] Parsed message sender DOM:",
          senderEval.senderNodeHtml || "(none)",
          "sender:",
          sender || "(empty)",
          "senderEmail:",
          senderEval.senderEmail || "(empty)",
          "direction:",
          senderEval.direction,
          "outgoing:",
          Boolean(senderEval.outgoing),
          "mid:",
          normalize(mid || ""),
          "scopeClass:",
          scopeClass
        );
      } catch (_) {
        // ignore debug logging failures
      }
    }

    function headerScopesForMessage(scope) {
      const roots = [];
      const seen = new Set();
      const push = (node) => {
        if (!(node instanceof HTMLElement)) return;
        if (seen.has(node)) return;
        seen.add(node);
        roots.push(node);
      };
      push(scope.querySelector("h3"));
      push(scope.querySelector(".go"));
      push(scope.querySelector(".gF"));
      const senderNode = scope.querySelector(".gD[email], .gD[data-hovercard-id], [data-hovercard-id][email]");
      if (senderNode instanceof HTMLElement) {
        push(senderNode.closest("h3"));
        push(senderNode.closest(".go"));
        push(senderNode.closest(".gF"));
        push(senderNode.closest(".adn"));
      }
      push(scope);
      return roots;
    }

    function extractSenderFromScope(scope) {
      const threadSpecificSelectors = [
        ".gD[email]",
        ".gD[data-hovercard-id]",
        "h3 .gD[email]",
        "h3 [email][name]",
        ".go [email]",
        ".go [data-hovercard-id]"
      ];

      const candidateScopes = headerScopesForMessage(scope);
      for (const section of candidateScopes) {
        for (const selector of threadSpecificSelectors) {
          for (const node of Array.from(section.querySelectorAll(selector)).slice(0, 6)) {
            if (!(node instanceof HTMLElement)) continue;
            const email = extractEmail(
              node.getAttribute("email")
              || node.getAttribute("data-hovercard-id")
              || node.getAttribute("data-hovercard-owner-email")
              || node.getAttribute("name")
              || node.getAttribute("title")
              || node.getAttribute("aria-label")
              || node.textContent
            );
            if (!email) continue;
            const preferredName = normalize(
              node.getAttribute("name")
              || node.getAttribute("data-name")
              || node.getAttribute("title")
              || node.textContent
              || ""
            );
            if (preferredName && !isGenericSenderLabel(preferredName) && extractEmail(preferredName) !== email) {
              return `${preferredName} <${email}>`;
            }
            return email;
          }
        }
      }

      for (const section of candidateScopes) {
        const emailNodes = section.querySelectorAll(
          'h3 .gD[email], h3 span[email], h3 [data-hovercard-id], .gD[email], span.gD[email], .go [email], [data-hovercard-id][email]'
        );
        for (const node of emailNodes) {
          if (!(node instanceof HTMLElement)) continue;
          const email = extractEmail(
            node.getAttribute("email") ||
            node.getAttribute("data-hovercard-id") ||
            node.getAttribute("title") ||
            node.getAttribute("aria-label")
          );
          if (!email) continue;
          const text = normalize(
            node.innerText ||
            node.textContent ||
            node.getAttribute("title") ||
            ""
          );
          if (isUseful(text) && !isGenericSenderLabel(text) && extractEmail(text) !== email) {
            return `${text} <${email}>`;
          }
          return email;
        }
      }

      const selectors = [
        ".gD", "span.gD", 'h3 span[dir="auto"]', "h3 span", ".go", "h4"
      ];
      for (const section of candidateScopes) {
        for (const sel of selectors) {
          const node = section.querySelector(sel);
          if (!(node instanceof HTMLElement)) continue;
          const text = normalize(node.innerText || node.textContent || node.getAttribute("title"));
          if (!text || !isUseful(text) || looksLikeDateOrTime(text) || isGenericSenderLabel(text)) continue;
          return text;
        }
      }

      for (const section of candidateScopes) {
        const aria = normalize(section.getAttribute("aria-label"));
        if (aria) {
          const email = extractEmail(aria);
          if (email) return email;
        }
      }
      return "";
    }

    function extractDate(scope) {
      const selectors = ["span.g3[title]", "time", "span[title]", 'td.gH span[title]'];
      for (const sel of selectors) {
        const node = scope.querySelector(sel);
        if (!(node instanceof HTMLElement)) continue;
        const title = normalize(node.getAttribute("title") || "");
        if (title && (looksLikeDateOrTime(title) || /\b\d{4}\b/.test(title))) return title;
        const text = normalize(node.innerText || node.textContent);
        if (text && (looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text))) return text;
      }
      return "";
    }

    function extractRecipientEmails(scope, senderValue = "") {
      if (!(scope instanceof HTMLElement)) return [];
      const senderEmail = extractEmail(senderValue || "");
      const candidateScopes = headerScopesForMessage(scope);
      const headerText = candidateScopes
        .map((section) => normalize((section.innerText || section.textContent || "").slice(0, 360)))
        .filter(Boolean)
        .join(" ");
      const emails = normalizeEmailList([
        Array.from(scope.querySelectorAll("[email], [data-hovercard-id], [data-hovercard-owner-email], [title*='@']"))
          .slice(0, 24)
          .map((node) => (
            node instanceof HTMLElement
              ? [
                node.getAttribute("email"),
                node.getAttribute("data-hovercard-id"),
                node.getAttribute("data-hovercard-owner-email"),
                node.getAttribute("title"),
                node.getAttribute("aria-label"),
                normalize(node.textContent || "").slice(0, 260)
              ]
              : ""
          )),
        scope.getAttribute("aria-label"),
        headerText,
        normalize((scope.innerText || scope.textContent || "").slice(0, 420))
      ]);
      return emails.filter((email) => email && email !== senderEmail);
    }

    let topContainers;
    if (state.currentView === "thread" && document.body) {
      topContainers = collectThreadContainers(document.body);
      if (topContainers.length === 0) topContainers = collectThreadContainers(main);
    } else {
      topContainers = collectThreadContainers(main);
      if (topContainers.length === 0 && document.body && document.body !== main) {
        topContainers = collectThreadContainers(document.body);
      }
    }
    const seenBodies = new Set();
    const usedNodes = new Set();
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] === THREAD EXTRACT: message container count = ${topContainers.length} ===`);
    }
    for (const container of Array.from(topContainers)) {
      if (!(container instanceof HTMLElement)) continue;
      if (usedNodes.has(container)) continue;
      const scope = container;
      const mid = (
        scope.getAttribute("data-message-id")
        || scope.getAttribute("data-legacy-message-id")
        || "(none)"
      );
      const sender = extractSenderFromScope(scope);
      const recipientEmails = extractRecipientEmails(scope, sender);
      const senderEval = evaluateOutgoingForScope(scope, sender, recipientEmails);
      warnExtractedSender(scope, sender, senderEval, mid);
      const date = extractDate(scope);
      const extractedBody = extractMessageBodyFromScope(scope, extractionThreadIdHint);
      const bodyHtml = extractedBody.bodyHtml || "";
      const bodyText = extractedBody.bodyText || THREAD_NO_CONTENT;
      const bodyFound = hasUsefulBodyText(bodyText) || Boolean(bodyHtml);
      if (DEBUG_THREAD_EXTRACT) {
        const preview = (bodyText || "").substring(0, 50).replace(/\n/g, " ");
        console.log(`[reskin] [thread-message] mid=${mid} bodyFound=${bodyFound} sender=${(sender || "").substring(0, 30)} bodyPreview=${preview || "(empty)"}`);
      }
      if (!hasUsefulBodyText(bodyText) && !isUseful(sender) && !date) continue;
      const senderToken = normalize(sender || "").toLowerCase();
      const dateToken = normalize(date || "").toLowerCase();
      const bodyToken = normalize(bodyText || "");
      let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
      if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
        uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
      }
      if (uniqueKey && seenBodies.has(uniqueKey)) continue;
      if (uniqueKey) seenBodies.add(uniqueKey);
      usedNodes.add(container);
      messages.push({
        sender: isUseful(sender) ? sender : "Unknown sender",
        senderEmail: senderEval.senderEmail || extractEmail(sender || ""),
        recipientEmails: senderEval.recipientEmails && senderEval.recipientEmails.length > 0
          ? senderEval.recipientEmails
          : recipientEmails,
        date: date || "",
        dataMessageId: mid || "",
        bodyHtml: bodyHtml || "",
        bodyText: bodyText || THREAD_NO_CONTENT,
        sourceType: extractedBody.sourceType || "captured",
        direction: senderEval.direction,
        isSelf: Boolean(senderEval.isSelf)
      });
    }
    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] After thread-message phase: messages.length = ${messages.length}`);
    }
    if (messages.length === 0 && state.currentView === "thread") {
      for (const ifr of document.querySelectorAll("iframe")) {
        try {
          const doc = ifr.contentDocument;
          if (!doc || doc === document) continue;
          const iframeBody = doc.body;
          if (!(iframeBody instanceof HTMLElement)) continue;
          const iframeContainers = collectThreadContainers(iframeBody);
          if (iframeContainers.length === 0) continue;
          for (const container of Array.from(iframeContainers)) {
            if (!(container instanceof HTMLElement)) continue;
            const scope = container;
            const mid = (
              scope.getAttribute("data-message-id")
              || scope.getAttribute("data-legacy-message-id")
              || "(none)"
            );
            const sender = extractSenderFromScope(scope);
            const recipientEmails = extractRecipientEmails(scope, sender);
            const senderEval = evaluateOutgoingForScope(scope, sender, recipientEmails);
            warnExtractedSender(scope, sender, senderEval, mid);
            const date = extractDate(scope);
            const extractedBody = extractMessageBodyFromScope(scope, extractionThreadIdHint);
            const bodyHtml = extractedBody.bodyHtml || "";
            const bodyText = extractedBody.bodyText || THREAD_NO_CONTENT;
            if (!hasUsefulBodyText(bodyText) && !isUseful(sender) && !date) continue;
            const senderToken = normalize(sender || "").toLowerCase();
            const dateToken = normalize(date || "").toLowerCase();
            const bodyToken = normalize(bodyText || "");
            let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
            if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
              uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
            }
            if (uniqueKey && seenBodies.has(uniqueKey)) continue;
            if (uniqueKey) seenBodies.add(uniqueKey);
            messages.push({
              sender: isUseful(sender) ? sender : "Unknown sender",
              senderEmail: senderEval.senderEmail || extractEmail(sender || ""),
              recipientEmails: senderEval.recipientEmails && senderEval.recipientEmails.length > 0
                ? senderEval.recipientEmails
                : recipientEmails,
              date: date || "",
              dataMessageId: mid || "",
              bodyHtml: bodyHtml || "",
              bodyText: bodyText || THREAD_NO_CONTENT,
              sourceType: extractedBody.sourceType || "captured",
              direction: senderEval.direction,
              isSelf: Boolean(senderEval.isSelf)
            });
          }
          if (messages.length > 0) break;
        } catch (_) { /* cross-origin */ }
      }
    }
    const runFallback = messages.length === 0 || state.currentView === "thread";
    if (runFallback) {
      let fallbackContainers;
      if (state.currentView === "thread" && document.body) {
        fallbackContainers = document.body.querySelectorAll('.kv, .gs, [role="listitem"]');
        if (fallbackContainers.length === 0) fallbackContainers = main.querySelectorAll('.kv, .gs, [role="listitem"]');
      } else {
        fallbackContainers = main.querySelectorAll('.kv, .gs, [role="listitem"]');
        if (fallbackContainers.length === 0 && document.body && document.body !== main) {
          fallbackContainers = document.body.querySelectorAll('.kv, .gs, [role="listitem"]');
        }
      }
      if (DEBUG_THREAD_EXTRACT) {
        console.log(`[reskin] Fallback phase: .kv, .gs, [role="listitem"] count = ${fallbackContainers.length}`);
      }
      for (const container of Array.from(fallbackContainers)) {
        if (!(container instanceof HTMLElement)) continue;
        let dominated = false;
        for (const other of Array.from(fallbackContainers)) {
          if (other !== container && other instanceof HTMLElement && other.contains(container)) { dominated = true; break; }
        }
        if (dominated) continue;
        const scope = container;
        const sender = extractSenderFromScope(scope);
        const recipientEmails = extractRecipientEmails(scope, sender);
        const senderEval = evaluateOutgoingForScope(scope, sender, recipientEmails);
        const date = extractDate(scope);
        const extractedBody = extractMessageBodyFromScope(scope, extractionThreadIdHint);
        const bodyHtml = extractedBody.bodyHtml || "";
        const bodyText = extractedBody.bodyText || THREAD_NO_CONTENT;
        if (DEBUG_THREAD_EXTRACT) {
          const preview = (bodyText || "").substring(0, 50).replace(/\n/g, " ");
          console.log(`[reskin] fallback container tag=${scope.tagName} cls=${(scope.className || "").substring(0, 40)} bodyFound=${!!(bodyText || bodyHtml)} bodyPreview=${preview || "(empty)"}`);
        }
        const nestedMessageNode = scope.querySelector("[data-message-id], [data-legacy-message-id]");
        const nestedMessageId = nestedMessageNode instanceof HTMLElement
          ? normalize(
            nestedMessageNode.getAttribute("data-message-id")
            || nestedMessageNode.getAttribute("data-legacy-message-id")
            || ""
          )
          : "";
        const hasMessageId = Boolean(
          normalize(
            scope.getAttribute("data-message-id")
            || scope.getAttribute("data-legacy-message-id")
            || nestedMessageId
          )
        );
        const hasStrictBody = Boolean(extractedBody.hasBodyNode);
        const nonMetadataBody = hasUsefulBodyText(bodyText)
          && !isLikelyMetadataBlob(bodyText)
          && alphaRatio(bodyText) >= 0.2;
        if (!hasMessageId && !hasStrictBody && !nonMetadataBody) continue;
        if (!hasUsefulBodyText(bodyText) && !isUseful(sender) && !date) continue;
        const senderToken = normalize(sender || "").toLowerCase();
        const dateToken = normalize(date || "").toLowerCase();
        const bodyToken = normalize(bodyText || "");
        const mid = (
          scope.getAttribute("data-message-id")
          || scope.getAttribute("data-legacy-message-id")
          || nestedMessageId
          || ""
        );
        let uniqueKey = normalize(mid || "") ? `mid:${normalize(mid)}` : "";
        if (!uniqueKey && (!hasUsefulBodyText(bodyToken) || isLikelyMetadataBlob(bodyToken))) {
          uniqueKey = `meta:${senderToken}:${dateToken}:${hashString(bodyToken.toLowerCase())}`;
        }
        if (uniqueKey && seenBodies.has(uniqueKey)) continue;
        if (uniqueKey) seenBodies.add(uniqueKey);
        warnExtractedSender(scope, sender, senderEval, mid);
        messages.push({
          sender: isUseful(sender) ? sender : "Unknown sender",
          senderEmail: senderEval.senderEmail || extractEmail(sender || ""),
          recipientEmails: senderEval.recipientEmails && senderEval.recipientEmails.length > 0
            ? senderEval.recipientEmails
            : recipientEmails,
          date: date || "",
          dataMessageId: mid || "",
          bodyHtml: bodyHtml || "",
          bodyText: bodyText || THREAD_NO_CONTENT,
          sourceType: extractedBody.sourceType || (hasStrictBody ? "captured" : "fallback"),
          direction: senderEval.direction,
          isSelf: Boolean(senderEval.isSelf)
        });
      }
      if (DEBUG_THREAD_EXTRACT) {
        console.log(`[reskin] After fallback phase: messages.length = ${messages.length}`);
      }
    }

    if (messages.length === 0) {
      if (DEBUG_THREAD_EXTRACT) {
        console.log(`[reskin] Using single-message fallback (main-level body search)`);
        const mainHtmlLen = main.innerHTML ? main.innerHTML.length : 0;
        const mainChildren = Array.from(main.children).slice(0, 12).map((c) => `${c.tagName}.${(c.className || "").toString().slice(0, 40)}`);
        console.log(`[reskin] Thread DOM diagnostic: main.innerHTML.length=${mainHtmlLen}, main.children(up to 12)=${mainChildren.join(" | ")}`);
        const iframes = document.querySelectorAll("iframe");
        iframes.forEach((ifr, i) => {
          let src = (ifr.src || "").slice(0, 60);
          let docOk = false;
          let queryLen = 0;
          let bestTextLen = 0;
          try {
            const doc = ifr.contentDocument;
            docOk = !!doc && doc !== document;
            if (docOk) {
              const nodes = doc.querySelectorAll(".a3s, .ii");
              queryLen = nodes.length;
              for (const n of Array.from(nodes).slice(0, 5)) {
                const len = normalize(n.innerText || n.textContent).length;
                if (len > bestTextLen) bestTextLen = len;
              }
            }
          } catch (_) { /* ignore */ }
          console.log(`[reskin] iframe[${i}] src=${src} contentDocumentOk=${docOk} .a3s/.ii count=${queryLen} bestTextLen=${bestTextLen}`);
        });
        const broad = Array.from(main.querySelectorAll('div[class*="ii"], div[class*="a3s"]')).slice(0, 8);
        broad.forEach((el, i) => {
          const len = normalize(el.innerText || el.textContent).length;
          const cls = (el.className || "").toString().slice(0, 30);
          console.log(`[reskin] main broad[${i}] class=${cls} textLen=${len}`);
        });
      }
      const sender = extractSenderFromScope(main);
      const recipientEmails = extractRecipientEmails(main, sender);
      const senderEval = evaluateOutgoingForScope(main, sender, recipientEmails);
      const dateCandidates = Array.from(main.querySelectorAll("span.g3[title], time, span[title], div[title]"))
        .map((node) => normalize(node.getAttribute("title") || node.innerText || node.textContent))
        .filter((text) => looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text));
      const date = dateCandidates[0] || "";
      const bodySelectors = BODY_SELECTORS;
      let bodyNode = null;
      let bodyHtml = "";
      let bodyText = "";
      let bodyNodesCount = 0;
      if (state.currentView === "thread") {
        const allIframeNodes = [];
        const iframes = Array.from(document.querySelectorAll("iframe")).filter((f) => f && f.contentDocument);
        for (const ifr of iframes) {
          try {
            const doc = ifr.contentDocument;
            if (!doc || doc === document) continue;
            const nodes = Array.from(doc.querySelectorAll(bodySelectors)).filter((n) => n instanceof HTMLElement);
            allIframeNodes.push(...nodes);
          } catch (_) { /* cross-origin or detached */ }
        }
        allIframeNodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
        const best = allIframeNodes[0];
        if (best instanceof HTMLElement && normalize(best.innerText || best.textContent).length >= 3) {
          bodyNode = best;
          bodyHtml = best.innerHTML;
          bodyText = normalize(best.innerText || best.textContent);
          if (DEBUG_THREAD_EXTRACT) {
            console.log(`[reskin] Thread-view body from iframe, length=${bodyText.length}`);
          }
        }
      }
      if (!bodyText || bodyText.length < 3) {
        let bodyNodes = Array.from(main.querySelectorAll(bodySelectors)).filter((node) => node instanceof HTMLElement);
        if (bodyNodes.length === 0 && document.body && document.body !== main) {
          bodyNodes = Array.from(document.body.querySelectorAll(bodySelectors)).filter((node) => node instanceof HTMLElement);
        }
        bodyNodesCount = bodyNodes.length;
        bodyNodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
        const bestMain = bodyNodes[0];
        if (bestMain instanceof HTMLElement && normalize(bestMain.innerText || bestMain.textContent).length >= 3) {
          bodyNode = bestMain;
          bodyHtml = bestMain.innerHTML;
          bodyText = normalize(bestMain.innerText || bestMain.textContent);
        }
      }
      if (!bodyText || bodyText.length < 3) {
        const iframes = Array.from(document.querySelectorAll("iframe")).filter((f) => f && f.contentDocument);
        for (const ifr of iframes) {
          try {
            const doc = ifr.contentDocument;
            if (!doc || doc === document) continue;
            let nodes = Array.from(doc.querySelectorAll(bodySelectors)).filter((node) => node instanceof HTMLElement);
            nodes.sort((a, b) => normalize(b.innerText || "").length - normalize(a.innerText || "").length);
            const best = nodes[0];
            if (best instanceof HTMLElement) {
              const txt = normalize(best.innerText || best.textContent);
              if (txt && txt.length > (bodyText || "").length) {
                bodyNode = best;
                bodyHtml = best.innerHTML;
                bodyText = txt;
                if (DEBUG_THREAD_EXTRACT) {
                  console.log(`[reskin] Single-message body from iframe, length=${bodyText.length}`);
                }
                break;
              }
            }
          } catch (_) { /* cross-origin or detached */ }
        }
      }
      if (DEBUG_THREAD_EXTRACT && (!bodyText || bodyText.length < 3)) {
        console.log(`[reskin] Single-message fallback: bodyNodes=${bodyNodesCount}, bodyTextLen=${(bodyText || "").length}, iframesChecked=${document.querySelectorAll("iframe").length}`);
      }
      const finalBodyText = bodyText || THREAD_BODY_PLACEHOLDER;
      if (finalBodyText === THREAD_BODY_PLACEHOLDER) {
        threadExtractFailureStats = {
          dataMessageId: topContainers.length,
          bodyNodes: bodyNodesCount,
          iframes: document.querySelectorAll("iframe").length
        };
      }
      warnExtractedSender(main, sender, senderEval, "");
      messages.push({
        sender: isUseful(sender) ? sender : "Unknown sender",
        senderEmail: senderEval.senderEmail || extractEmail(sender || ""),
        recipientEmails: senderEval.recipientEmails && senderEval.recipientEmails.length > 0
          ? senderEval.recipientEmails
          : recipientEmails,
        date,
        dataMessageId: "",
        bodyHtml: finalBodyText.length >= 3 ? bodyHtml : "",
        bodyText: finalBodyText,
        direction: senderEval.direction,
        isSelf: Boolean(senderEval.isSelf)
      });
    }

    const extractionThreadId = normalize(threadIdFromHash(window.location.hash || "") || state.activeThreadId || "");
    const domHasMeaningful = hasMeaningfulCapturedMessages(messages);
    const sdkHasMeaningful = hasMeaningfulCapturedMessages(sdkCachedMessages);
    const sourceLabel = (!domHasMeaningful && sdkHasMeaningful) ? "inboxsdk" : "gmail_dom";
    const sourceMessages = sourceLabel === "inboxsdk" ? sdkCachedMessages : messages;
    logChatDebug("thread-extract:source", {
      threadId: extractionThreadId,
      source: sourceLabel,
      domCount: Array.isArray(messages) ? messages.length : 0,
      sdkCount: Array.isArray(sdkCachedMessages) ? sdkCachedMessages.length : 0,
      domHasMeaningful,
      sdkHasMeaningful
    }, { throttleKey: `thread-extract-source:${extractionThreadId || "unknown"}`, throttleMs: 500 });
    if (sourceLabel === "gmail_dom" && !sdkHasMeaningful) {
      logChatDebug("inboxsdk:fallback-dom", {
        threadId: extractionThreadId,
        reason: "sdk-empty-or-unavailable"
      }, { throttleKey: `inboxsdk-fallback-dom:${extractionThreadId || "unknown"}`, throttleMs: 1000 });
    }
    const finalMessages = normalizeThreadMessagesForChat(sourceMessages, extractionThreadId);

    if (DEBUG_THREAD_EXTRACT) {
      console.log(`[reskin] Final messages (after content dedup): ${finalMessages.length} (was ${messages.length})`);
      finalMessages.forEach((m, i) => {
        const preview = (m.bodyText || "").substring(0, 50).replace(/\n/g, " ");
        console.log(`[reskin]   [${i}] sender=${(m.sender || "").substring(0, 35)} body=${preview || "(empty)"}`);
      });
      console.log(`[reskin] === END THREAD EXTRACT ===`);
    }
    if (finalMessages.length === 1 && (finalMessages[0].bodyText || "").trim() === THREAD_BODY_PLACEHOLDER && threadExtractFailureStats) {
      const now = Date.now();
      const lastLog = state.lastThreadBodyFailLogAt || 0;
      if (now - lastLog > 5000) {
        state.lastThreadBodyFailLogAt = now;
        const s = threadExtractFailureStats;
        logWarn(
          `Thread body not captured — [message-containers]=${s.dataMessageId}, bodyNodes=${s.bodyNodes}, bodyTextLen=0, iframes=${s.iframes}, hash=${normalize(window.location.hash || "")}, view=${state.currentView}, activeThread=${normalize(state.activeThreadId || "")}. Set DEBUG_THREAD_EXTRACT=true in content.js for full diagnostics.`
        );
      }
    }

    const extractionTracePayload = {
      threadId: extractionThreadId,
      count: finalMessages.length,
      selfCount: finalMessages.filter((msg) => msg && msg.isSelf === true).length,
      outgoingCount: finalMessages.filter((msg) => normalize(msg && msg.direction || "") === "outgoing").length,
      messages: finalMessages.slice(0, 80).map((msg, index) => ({
        index,
        messageId: normalize(msg && (msg.messageId || msg.dataMessageId) || ""),
        sender: normalize(msg && msg.sender || ""),
        senderEmail: extractEmail(msg && msg.senderEmail || ""),
        recipientEmails: Array.isArray(msg && msg.recipientEmails) ? msg.recipientEmails : [],
        direction: normalize(msg && msg.direction || ""),
        isSelf: Boolean(msg && msg.isSelf),
        bodyPreview: normalize(msg && msg.bodyText || "").slice(0, 140)
      }))
    };
    logChatDebug("thread-extract:payload-trace", extractionTracePayload, {
      throttleKey: `thread-extract-payload:${extractionThreadId || "unknown"}`,
      throttleMs: 250
    });
    if (typeof logEvent === "function") {
      logEvent("D211", {
        threadId: extractionThreadId,
        count: extractionTracePayload.count,
        selfCount: extractionTracePayload.selfCount,
        outgoingCount: extractionTracePayload.outgoingCount,
        sampleHash: hashString(JSON.stringify(extractionTracePayload.messages.slice(0, 6)))
      }, { tier: "always" });
    }
    try {
      console.warn("[reskin][trace][thread-extract:payload]", extractionTracePayload);
    } catch (_) { /* console unavailable */ }

    return {
      subject: cleanSubject(subject, finalMessages[0] && finalMessages[0].sender, finalMessages[0] && finalMessages[0].date),
      messages: finalMessages
    };
  }


    return {
      threadDomReadinessSnapshot,
      waitForThreadContentReady,
      canExpandThreadContentNow,
      collectThreadExpandTargets,
      collectCollapsedThreadMessageHeaders,
      expandCollapsedThreadMessagesForExtraction,
      hasUsefulBodyText,
      findFirstBodyNode,
      findBodyNodeInScope,
      findBodyNodeInScopeIframes,
      threadSnippetFallback,
      alphaRatio,
      extractMessageBodyFromScope,
      extractOpenThreadData
    };
  };
})();
