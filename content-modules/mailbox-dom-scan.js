(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createMailboxDomScanApi = function createMailboxDomScanApi(deps = {}) {
    const {
      STARTUP_PERF_MODE,
      ROW_SELECTORS,
      SCOPED_ROW_SELECTORS,
      NOISE_TEXT,
      MAILBOX_SCAN_MAX_PAGES,
      MAILBOX_SCAN_NO_CHANGE_LIMIT,
      INTERACTION_SCAN_COOLDOWN_MS,
      NAV_ITEMS,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      isUseful,
      looksLikeDateOrTime,
      isGenericSenderLabel,
      canonicalThreadId,
      hashFromHref,
      mailboxKeyFromHash,
      normalizeThreadHashForMailbox,
      threadHintKeysForThread,
      getGmailMainRoot,
      sleep,
      logTimed,
      logWarn,
      logEvent,
      setActiveTask,
      mailboxScanPauseReason,
      shouldPauseMailboxScan,
      activeConversationContext,
      expandContactGroupWithCachedCounterparts,
      getLoadContactChat,
      getRenderCurrentView,
      getRenderList,
      getRenderSidebar,
      activeMailbox,
      navigateToList,
      getMailboxCacheKey,
      parseListRoute,
      getCollectMessages,
      getMergeMailboxCache,
      getRoot,
      scheduleHeavyWorkAfterIdle
    } = deps;

    const mailboxCacheKey = (...args) => {
      const fn = typeof getMailboxCacheKey === "function" ? getMailboxCacheKey() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const collectMessages = (...args) => {
      const fn = typeof getCollectMessages === "function" ? getCollectMessages() : null;
      if (typeof fn !== "function") return { source: "", items: [] };
      return fn(...args);
    };
    const mergeMailboxCache = (...args) => {
      const fn = typeof getMergeMailboxCache === "function" ? getMergeMailboxCache() : null;
      if (typeof fn !== "function") return [];
      return fn(...args);
    };
    const renderSidebar = (...args) => {
      const fn = typeof getRenderSidebar === "function" ? getRenderSidebar() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };
    const renderList = (...args) => {
      const fn = typeof getRenderList === "function" ? getRenderList() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };
    const renderCurrentView = (...args) => {
      const fn = typeof getRenderCurrentView === "function" ? getRenderCurrentView() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };
    const loadContactChat = (...args) => {
      const fn = typeof getLoadContactChat === "function" ? getLoadContactChat() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };
  function selectRows(scopeRoot) {
    const hasScopedRoot = scopeRoot instanceof HTMLElement;
    const scope = hasScopedRoot ? scopeRoot : document;
    const selectors = hasScopedRoot ? SCOPED_ROW_SELECTORS : ROW_SELECTORS;
    const unique = new Set();
    const rows = [];
    for (const selector of selectors) {
      const nodes = scope.querySelectorAll(selector);
      for (const node of nodes) {
        if (!(node instanceof HTMLElement)) continue;
        if (unique.has(node)) continue;
        unique.add(node);
        rows.push(node);
      }
    }
    return rows;
  }

  function extractThreadIdFromRow(row) {
    const fromAttr =
      row.getAttribute("data-thread-id") ||
      row.getAttribute("data-legacy-thread-id") ||
      row.getAttribute("data-article-id") ||
      "";
    if (fromAttr) return fromAttr;

    const idNode = row.querySelector("[data-thread-id], [data-legacy-thread-id], [data-article-id]");
    if (idNode instanceof HTMLElement) {
      const nestedId =
        idNode.getAttribute("data-thread-id") ||
        idNode.getAttribute("data-legacy-thread-id") ||
        idNode.getAttribute("data-article-id") ||
        "";
      if (nestedId) return nestedId;
    }

    const link = row.querySelector('a[href*="th="], a[href*="#"], a[href]');
    if (link instanceof HTMLAnchorElement) {
      const fromHref = threadIdFromHref(link.getAttribute("href"));
      if (fromHref) return fromHref;
    }

    return "";
  }

  function threadIdFromHref(href) {
    const value = normalize(href);
    if (!value) return "";

    const matchTh = value.match(/[?#&]th=([A-Za-z0-9_-]+)/);
    if (matchTh && matchTh[1]) return matchTh[1];

    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) {
      const hash = value.slice(hashIndex + 1);
      const hashWithoutQuery = hash.split("?")[0];
      const parts = hashWithoutQuery.split("/").filter(Boolean);
      const tail = (parts[parts.length - 1] || "").trim();
      const isFolder = /^(inbox|all|sent|drafts|starred|spam|trash)$/i.test(tail);
      if (!isFolder && tail.length >= 6) return tail;
    }
    return "";
  }

  function fallbackThreadIdFromRow(row, index = 0) {
    const seed = normalize(
      row.getAttribute("aria-label") ||
      row.getAttribute("data-article-id") ||
      row.getAttribute("data-thread-id") ||
      row.getAttribute("data-legacy-thread-id") ||
      row.textContent
    ).slice(0, 180);
    if (!seed) return `synthetic-${index}`;

    let hash = 0;
    for (let i = 0; i < seed.length; i += 1) {
      hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
    }
    return `synthetic-${hash.toString(36)}`;
  }

  function messageDedupeKey(threadId, href) {
    const id = canonicalThreadId(threadId || "") || normalize(threadId || "");
    const link = hashFromHref(href || "") || normalize(href || "");
    return `${id}|${link}`;
  }

  function extractSender(row) {
    const threadSpecificSelectors = [
      ".gD[email]",
      ".gD[data-hovercard-id]",
      ".gD",
      "h3 .gD[email]",
      "h3 [email][name]",
      ".go [email]",
      ".go [data-hovercard-id]"
    ];
    for (const selector of threadSpecificSelectors) {
      for (const node of Array.from(row.querySelectorAll(selector)).slice(0, 6)) {
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

    const emailNodes = [
      ...Array.from(
        row.querySelectorAll(".yW span[email], .yW [email], .zA span[email], span[email], [data-hovercard-id][email], [data-hovercard-id]")
      ),
      row
    ];
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

    const senderCandidates = [
      row.querySelector(".yW span"),
      row.querySelector(".yP"),
      row.querySelector("[data-hovercard-id]"),
      row.querySelector(".go")
    ];
    for (const node of senderCandidates) {
      if (!(node instanceof HTMLElement)) continue;
      const fromText = normalize(node.innerText || node.textContent);
      if (isUseful(fromText) && !isGenericSenderLabel(fromText) && !looksLikeDateOrTime(fromText)) return fromText;
      const fromTitle = normalize(node.getAttribute("title"));
      if (isUseful(fromTitle) && !isGenericSenderLabel(fromTitle) && !looksLikeDateOrTime(fromTitle)) return fromTitle;
      const fromAria = normalize(node.getAttribute("aria-label"));
      if (isUseful(fromAria) && !isGenericSenderLabel(fromAria) && !looksLikeDateOrTime(fromAria)) return fromAria;
    }

    const rowAria = normalize(row.getAttribute("aria-label"));
    if (rowAria) {
      const ariaEmail = extractEmail(rowAria);
      if (ariaEmail) return ariaEmail;
      const parts = rowAria.split(/[,|-]/).map((part) => normalize(part)).filter(Boolean);
      for (const part of parts) {
        if (!isUseful(part) || looksLikeDateOrTime(part) || isGenericSenderLabel(part)) continue;
        return part;
      }
    }
    return "Unknown sender";
  }

  function extractRowRecipientEmails(row, sender = "") {
    if (!(row instanceof HTMLElement)) return [];
    const senderEmail = extractEmail(sender || "");
    const userEmail = extractEmail(state.activeAccountEmail || state.currentUserEmail || "");
    const emailNodes = Array.from(
      row.querySelectorAll("[email], [data-hovercard-id], [data-hovercard-owner-email], [title*='@']")
    ).slice(0, 40);
    const nodeValues = emailNodes.map((node) => (
      node instanceof HTMLElement
        ? [
          node.getAttribute("email"),
          node.getAttribute("data-hovercard-id"),
          node.getAttribute("data-hovercard-owner-email"),
          node.getAttribute("title"),
          node.getAttribute("aria-label"),
          normalize(node.textContent || "").slice(0, 200)
        ]
        : ""
    ));
    const emails = normalizeEmailList([
      nodeValues,
      row.getAttribute("aria-label"),
      normalize(row.innerText || row.textContent || "").slice(0, 900)
    ]);
    return emails.filter((email) => {
      if (!email) return false;
      if (senderEmail && email === senderEmail) return false;
      if (emails.length > 1 && userEmail && email === userEmail) return false;
      return true;
    });
  }

  function extractDate(row) {
    const monthDay = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}$/;
    const clock = /^\d{1,2}:\d{2}\s?(AM|PM)$/i;
    const relative = /^\d+\s?(m|h|d|w)$/i;

    const nodes = Array.from(row.querySelectorAll("td, span, div"));
    const candidates = [];
    for (const node of nodes) {
      const text = normalize(node.textContent);
      if (!text || text.length > 16) continue;
      if (monthDay.test(text) || clock.test(text) || relative.test(text)) {
        candidates.push(text);
      }
    }
    if (candidates.length > 0) return candidates[candidates.length - 1];
    return "";
  }

  function extractSnippet(row) {
    const snippets = [
      row.querySelector(".y2"),
      row.querySelector("span.y2"),
      row.querySelector('[role="gridcell"] span')
    ];
    for (const node of snippets) {
      if (!(node instanceof HTMLElement)) continue;
      const text = normalize(node.innerText || node.textContent);
      if (text.length >= 6) return text;
    }
    return "";
  }

  function extractSubject(row, sender) {
    const primarySubject = normalize(
      row.querySelector(".bog, .y6 span, span.bog")?.textContent ||
      row.querySelector(".y6")?.textContent
    );
    if (
      isUseful(primarySubject) &&
      primarySubject.toLowerCase() !== sender.toLowerCase() &&
      !looksLikeDateOrTime(primarySubject)
    ) {
      return primarySubject;
    }

    const candidateSelectors = [
      '[role="link"][aria-label]',
      '[role="link"][title]',
      '[role="link"] span[title]',
      '[role="link"] span',
      "span[title]"
    ];

    const candidates = [];
    for (const selector of candidateSelectors) {
      for (const node of row.querySelectorAll(selector)) {
        const text = normalize(node.textContent);
        const title = normalize(node.getAttribute("title"));
        if (isUseful(text)) candidates.push(text);
        if (isUseful(title)) candidates.push(title);
      }
    }

    const filtered = candidates.filter((value) => {
      if (!isUseful(value)) return false;
      if (value.toLowerCase() === sender.toLowerCase()) return false;
      if (NOISE_TEXT.has(value.toLowerCase())) return false;
      if (looksLikeDateOrTime(value)) return false;
      return true;
    });

    if (filtered.length > 0) {
      filtered.sort((a, b) => a.length - b.length);
      return filtered[0];
    }

    const aria = normalize(row.getAttribute("aria-label"));
    if (aria) {
      const parts = aria
        .split(/[-,|]/)
        .map((part) => normalize(part))
        .filter(Boolean);
      for (const part of parts) {
        if (!isUseful(part)) continue;
        if (part.toLowerCase() === sender.toLowerCase()) continue;
        if (looksLikeDateOrTime(part)) continue;
        return part;
      }
    }

    return "No subject captured";
  }

  function firstPageFingerprint(limit = 8) {
    const rows = collectMessages(Math.max(10, Number(limit) || 8)).items || [];
    const head = rows.slice(0, limit).map((item) => normalize(item.threadId || item.href || ""));
    const tail = rows.slice(-Math.min(3, limit)).map((item) => normalize(item.threadId || item.href || ""));
    return `${rows.length}|${head.join(",")}|${tail.join(",")}`;
  }

  function isElementVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (!node.isConnected) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function isDisabledButton(node) {
    if (!(node instanceof HTMLElement)) return true;
    if (node.getAttribute("aria-disabled") === "true") return true;
    if (node.getAttribute("disabled") !== null) return true;
    return false;
  }

  function findPagerButton(kind) {
    const labels = kind === "next"
      ? ["older", "next page", "next"]
      : ["newer", "previous page", "previous"];
    const queryRoot = getGmailMainRoot() || document;
    const candidates = [];
    for (const label of labels) {
      const selectors = [
        `[aria-label*="${label}"][role="button"]`,
        `button[aria-label*="${label}"]`,
        `[data-tooltip*="${label}"][role="button"]`,
        `button[data-tooltip*="${label}"]`,
        `[aria-label*="${label}"]`,
        `[data-tooltip*="${label}"]`
      ];
      for (const selector of selectors) {
        for (const node of Array.from(queryRoot.querySelectorAll(selector))) {
          if (!(node instanceof HTMLElement)) continue;
          if (!isElementVisible(node)) continue;
          const haystack = normalize(
            node.getAttribute("aria-label")
            || node.getAttribute("data-tooltip")
            || node.getAttribute("title")
            || node.textContent
          ).toLowerCase();
          if (!haystack || !labels.some((token) => haystack.includes(token))) continue;
          candidates.push(node);
        }
      }
    }
    if (candidates.length === 0) {
      for (const node of Array.from(queryRoot.querySelectorAll('[role="button"], button, [aria-label], [data-tooltip]'))) {
        if (!(node instanceof HTMLElement)) continue;
        if (!isElementVisible(node)) continue;
        const haystack = normalize(
          node.getAttribute("aria-label")
          || node.getAttribute("data-tooltip")
          || node.getAttribute("title")
          || node.textContent
        ).toLowerCase();
        if (!haystack) continue;
        if (!labels.some((token) => haystack.includes(token))) continue;
        candidates.push(node);
      }
    }
    if (candidates.length === 0) return null;
    const enabled = candidates.filter((node) => !isDisabledButton(node));
    return (enabled[0] || candidates[0]) || null;
  }

  function dispatchSyntheticClick(node) {
    if (!(node instanceof HTMLElement)) return;
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  }

  function updateMailboxScanProgress(mailbox, patch = {}) {
    const key = mailboxCacheKey(mailbox);
    const existing = state.mailboxScanProgress[key] && typeof state.mailboxScanProgress[key] === "object"
      ? state.mailboxScanProgress[key]
      : { mailbox: key, pagesScanned: 0, cachedCount: 0, lastUpdatedAt: 0, status: "" };
    state.mailboxScanProgress[key] = {
      ...existing,
      ...patch,
      mailbox: key,
      lastUpdatedAt: Date.now()
    };
  }

  function schedulerScanToken(options = {}) {
    const token = Number(options.interactionEpoch);
    if (Number.isFinite(token) && token >= 0) return token;
    return Number(state.interactionEpoch || 0);
  }

  function scheduleMailboxScanKick(root, options = {}) {
    const shell = root instanceof HTMLElement ? root : getRoot();
    if (!(shell instanceof HTMLElement)) return;
    const requested = Array.isArray(options.mailboxes)
      ? options.mailboxes.map(mailboxCacheKey).filter(Boolean)
      : [];
    if (requested.length === 0) return;
    if (!options.force && state.currentView === "thread") return;
    if (!options.force && STARTUP_PERF_MODE === "instant") {
      // Aggressive instant mode: never auto-scan in the background.
      // Scans must be explicit (force=true) to avoid jank during user interaction.
      return;
    }
    const key = `${requested.join(",")}|force:${Boolean(options.force)}|pages:${Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES}`;
    let delayMs = Math.max(0, Number(options.delayMs || 0));
    const startupReadyAt = Number(state.reskinReadyAt || 0);
    if (!options.force && startupReadyAt > 0) {
      const sinceReady = Date.now() - startupReadyAt;
      if (sinceReady < 12000) {
        delayMs = Math.max(delayMs, 12000 - sinceReady);
      }
    }
    const bypassInteractionCooldown = Boolean(options.bypassInteractionCooldown);
    if (!bypassInteractionCooldown) {
      const elapsed = Date.now() - Number(state.lastInteractionAt || 0);
      if (elapsed < 6000) {
        delayMs = Math.max(delayMs, 6000 - elapsed);
      }
    }
    if (state.mailboxScanKickTimer && state.mailboxScanKickKey === key) return;
    if (state.mailboxScanKickTimer) {
      clearTimeout(state.mailboxScanKickTimer);
      state.mailboxScanKickTimer = null;
    }
    state.mailboxScanKickKey = key;
    const runKick = () => {
      state.mailboxScanKickTimer = null;
      state.mailboxScanKickKey = "";
      runFullMailboxScan(shell, {
        ...options,
        mailboxes: requested
      }).catch((error) => {
        logWarn("Scheduled mailbox scan failed", error);
      });
    };
    state.mailboxScanKickTimer = setTimeout(() => {
      const scheduleHeavy = typeof scheduleHeavyWorkAfterIdle === "function" ? scheduleHeavyWorkAfterIdle : null;
      if (scheduleHeavy && !options.force) {
        scheduleHeavy(runKick, {
          minIdleMs: 1200,
          hardTimeoutMs: 5000,
          reason: "mailbox-scan-kick"
        });
        return;
      }
      runKick();
    }, delayMs);
  }

  async function waitForPageChange(previousFingerprint, timeoutMs = 7000) {
    const timed = logTimed("wait:page-change", { timeoutMs });
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const current = firstPageFingerprint(10);
      if (current && current !== previousFingerprint) {
        timed.done({ changed: true });
        return { changed: true, fingerprint: current };
      }
      await sleep(140);
    }
    timed.done({ changed: false });
    return { changed: false, fingerprint: firstPageFingerprint(10) };
  }

  async function scanMailboxPages(mailbox, options = {}) {
    const key = mailboxCacheKey(mailbox);
    const force = Boolean(options.force);
    const scanToken = schedulerScanToken(options);
    const maxPages = Math.max(1, Math.min(MAILBOX_SCAN_MAX_PAGES, Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES));
    const root = options.root instanceof HTMLElement ? options.root : getRoot();
    const cached = Array.isArray(state.scannedMailboxMessages[key]) ? state.scannedMailboxMessages[key] : [];
    if (!force && state.fullScanCompletedByMailbox[key] && cached.length > 0) return;
    if (shouldPauseMailboxScan()) return;
    if (state.fullScanRunning && state.fullScanMailbox && state.fullScanMailbox !== key) return;
    if (scanToken !== Number(state.interactionEpoch || 0)) return;

    const returnHash = normalize(window.location.hash || state.lastListHash || "#inbox") || "#inbox";
    const targetHash = `#${key}`;
    const targetIsActive = parseListRoute(window.location.hash || state.lastListHash || "#inbox").mailbox === key;
    if (!targetIsActive) {
      const nav = NAV_ITEMS.find((item) => mailboxCacheKey((item.hash || "").replace(/^#/, "")) === key);
      navigateToList(targetHash, nav ? nav.nativeLabel : "", { native: true });
      await sleep(150);
    }

    state.scanRunId = Number(state.scanRunId || 0) + 1;
    const runId = state.scanRunId;
    state.fullScanRunning = true;
    state.scanPaused = false;
    state.scanPauseReason = "";
    state.fullScanMailbox = key;
    state.fullScanCompletedByMailbox[key] = false;
    state.fullScanStatus = `Scanning ${key}...`;
    const inboxLen = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
      ? state.scannedMailboxMessages[mailboxCacheKey("inbox")].length : 0;
    const sentLen = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
      ? state.scannedMailboxMessages[mailboxCacheKey("sent")].length : 0;
    logEvent("scan:start", { mailbox: key, inboxCached: inboxLen, sentCached: sentLen });
    setActiveTask(`scan:${key}`);
    updateMailboxScanProgress(key, {
      status: "running",
      pagesScanned: Number((state.mailboxScanProgress[key] || {}).pagesScanned || 0),
      cachedCount: cached.length
    });
    if (root instanceof HTMLElement) renderSidebar(root);

    const shouldAbort = () => {
      if (runId !== Number(state.scanRunId || 0)) return "scan-superseded";
      if (scanToken !== Number(state.interactionEpoch || 0)) return "interaction-changed";
      if (!force && Date.now() - Number(state.lastInteractionAt || 0) < 6000) {
        return "interaction-cooldown";
      }
      return mailboxScanPauseReason();
    };

    let pageCount = 0;
    let movedPages = 0;
    let noChangeStreak = 0;
    let aborted = false;
    let abortReason = "";
    try {
      while (pageCount < maxPages) {
        const earlyStop = shouldAbort();
        if (earlyStop) {
          aborted = true;
          abortReason = earlyStop;
          break;
        }
        const result = collectMessages(500);
        const merged = mergeMailboxCache(key, result.items || []);
        pageCount += 1;
        state.fullScanStatus = `Scanning ${key} page ${pageCount}... cached ${merged.length}`;
        updateMailboxScanProgress(key, {
          status: "running",
          pagesScanned: pageCount,
          cachedCount: merged.length
        });
        state.lastListSignature = "";
        if (root instanceof HTMLElement) {
          renderSidebar(root);
          if (state.currentView === "list") renderList(root);
        }

        const prePageTurnStop = shouldAbort();
        if (prePageTurnStop) {
          aborted = true;
          abortReason = prePageTurnStop;
          break;
        }
        const nextButton = findPagerButton("next");
        if (!(nextButton instanceof HTMLElement) || isDisabledButton(nextButton)) break;

        const previousFingerprint = firstPageFingerprint(10);
        dispatchSyntheticClick(nextButton);
        const changed = await waitForPageChange(previousFingerprint, 7000);
        const postPageTurnStop = shouldAbort();
        if (postPageTurnStop) {
          aborted = true;
          abortReason = postPageTurnStop;
          break;
        }
        if (!changed.changed) {
          noChangeStreak += 1;
          if (noChangeStreak >= MAILBOX_SCAN_NO_CHANGE_LIMIT) break;
          continue;
        }
        noChangeStreak = 0;
        movedPages += 1;
        await sleep(80);
      }

      if (!aborted) {
        let rewindNoChange = 0;
        for (let i = 0; i < movedPages; i += 1) {
          if (shouldAbort()) break;
          const prevButton = findPagerButton("prev");
          if (!(prevButton instanceof HTMLElement) || isDisabledButton(prevButton)) break;
          const previousFingerprint = firstPageFingerprint(10);
          dispatchSyntheticClick(prevButton);
          const changed = await waitForPageChange(previousFingerprint, 7000);
          if (!changed.changed) {
            rewindNoChange += 1;
            if (rewindNoChange >= MAILBOX_SCAN_NO_CHANGE_LIMIT) break;
            continue;
          }
          rewindNoChange = 0;
          await sleep(80);
        }
      }

      const count = Array.isArray(state.scannedMailboxMessages[key])
        ? state.scannedMailboxMessages[key].length
        : 0;
      if (aborted) {
        state.scanPaused = true;
        state.scanPauseReason = normalize(abortReason || "paused") || "paused";
        state.fullScanStatus = `Scan paused for ${key}: ${state.scanPauseReason}.`;
        updateMailboxScanProgress(key, {
          status: "paused",
          cachedCount: count
        });
      } else {
        state.fullScanCompletedByMailbox[key] = true;
        logEvent("scan:done", { mailbox: key, pagesScanned: pageCount, cachedCount: count });
        state.fullScanStatus = `Scan complete for ${key}. Cached ${count} emails.`;
        updateMailboxScanProgress(key, {
          status: "done",
          cachedCount: count
        });
      }
      const visible = Number(state.listVisibleByMailbox[key] || 0);
      if (!visible) state.listVisibleByMailbox[key] = state.listChunkSize;
    } catch (error) {
      const message = error && error.message ? String(error.message) : "Scan failed";
      state.fullScanStatus = `Scan failed for ${key}: ${message.slice(0, 120)}`;
      updateMailboxScanProgress(key, { status: "failed" });
      logWarn("Mailbox scan failed", { mailbox: key, error });
    } finally {
      state.fullScanRunning = false;
      state.fullScanMailbox = "";
      setActiveTask("idle");
      if (aborted) {
        queueMailboxScan(key, root, {
          maxPages,
          force
        });
      } else {
        state.scanPaused = false;
        state.scanPauseReason = "";
      }
      if (
        returnHash &&
        normalize(window.location.hash || "") !== normalize(returnHash) &&
        state.currentView === "list" &&
        !state.replySendInProgress &&
        !aborted
      ) {
        window.location.hash = returnHash;
        await sleep(40);
      }
      const latestRoot = getRoot();
      if (latestRoot instanceof HTMLElement) {
        // When sent scan completes and we're viewing a contact, refresh to include sent threads.
        if (key === mailboxCacheKey("sent") && state.currentView === "thread" && state.activeContactEmail) {
          const ctx = activeConversationContext();
          const baseGroup = {
            contactEmail: state.activeContactEmail,
            conversationKey: state.activeConversationKey || "",
            contactKey: state.activeContactKey || "",
            contactName: state.contactDisplayName || "",
            threadIds: (state.contactThreadIds || []).slice(),
            items: []
          };
          const expanded = expandContactGroupWithCachedCounterparts(baseGroup, ctx);
          if (expanded && Array.isArray(expanded.threadIds) && expanded.threadIds.length > (state.contactThreadIds || []).length) {
            state.contactThreadIds = expanded.threadIds.slice();
          }
          renderCurrentView(latestRoot);
        } else {
          renderCurrentView(latestRoot);
        }
      }
    }
  }

  function queueMailboxScan(mailbox, root, options = {}) {
    const key = mailboxCacheKey(mailbox);
    if (!key) return;
    const force = Boolean(options.force);
    if (state.fullScanRunning && state.fullScanMailbox === key) return;
    const alreadyQueued = state.mailboxScanQueue.some((entry) => mailboxCacheKey(entry.mailbox) === key);
    if (!force && state.fullScanCompletedByMailbox[key] && !alreadyQueued) return;
    if (alreadyQueued) return;
    state.mailboxScanQueue.push({
      mailbox: key,
      options: {
        maxPages: Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES,
        force
      },
      root: root instanceof HTMLElement ? root : null
    });
  }

  async function runMailboxScanQueue(root) {
    if (state.mailboxScanRunner) return;
    state.mailboxScanRunner = true;
    try {
      while (state.mailboxScanQueue.length > 0) {
        const pauseReason = mailboxScanPauseReason();
        if (pauseReason) {
          state.scanPaused = true;
          state.scanPauseReason = pauseReason;
          await sleep(80);
          continue;
        }
        state.scanPaused = false;
        state.scanPauseReason = "";
        const next = state.mailboxScanQueue.shift();
        if (!next) continue;
        await scanMailboxPages(next.mailbox, {
          ...(next.options || {}),
          root: next.root instanceof HTMLElement ? next.root : root,
          interactionEpoch: Number(state.interactionEpoch || 0)
        });
      }
    } finally {
      state.mailboxScanRunner = false;
      if (state.mailboxScanQueue.length === 0 && !state.fullScanRunning) {
        state.scanPaused = false;
        state.scanPauseReason = "";
      }
    }
  }

  async function runFullMailboxScan(root, options = {}) {
    const shell = root instanceof HTMLElement ? root : getRoot();
    if (!(shell instanceof HTMLElement)) return;
    if (shouldPauseMailboxScan()) return;
    const requested = Array.isArray(options.mailboxes) ? options.mailboxes.map(mailboxCacheKey).filter(Boolean) : [];
    const active = mailboxCacheKey(options.primaryMailbox || activeMailbox());
    const order = requested.length > 0
      ? requested
      : Array.from(new Set([active, "inbox", "sent"]));

    for (const mailbox of order) {
      queueMailboxScan(mailbox, shell, {
        maxPages: Number(options.maxPages) || MAILBOX_SCAN_MAX_PAGES,
        force: Boolean(options.force)
      });
    }
    await runMailboxScanQueue(shell);
  }

  function parseLastCountQuery(question) {
    const q = normalize(question).toLowerCase();
    const match = q.match(/\blast\s+(\d{1,3})\s+(emails?|messages?)\b/);
    if (!match) return 0;
    return Math.max(1, Math.min(200, Number(match[1]) || 0));
  }

  function parseFromDateQuery(question) {
    const q = normalize(question);
    const match = q.match(/\bfrom\s+([A-Za-z]{3,9}\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i);
    if (!match) return "";
    return normalize(match[1]).toLowerCase();
  }

  function parseKeywordQuery(question) {
    const q = normalize(question);
    const quoted = q.match(/"(.*?)"/);
    if (quoted && normalize(quoted[1])) return normalize(quoted[1]).toLowerCase();
    const withMatch = q.match(/\b(?:with|containing|keyword)\s+([A-Za-z0-9@._:-]{2,})\b/i);
    if (!withMatch) return "";
    return normalize(withMatch[1]).toLowerCase();
  }

  function selectMessagesForQuestion(question, messages) {
    const all = Array.isArray(messages) ? messages.slice() : [];
    if (all.length === 0) return [];
    const lastCount = parseLastCountQuery(question);
    if (lastCount > 0) return all.slice(0, lastCount);

    const dateToken = parseFromDateQuery(question);
    if (dateToken) {
      const byDate = all.filter((msg) => normalize(msg.date || "").toLowerCase().includes(dateToken));
      if (byDate.length > 0) return byDate.slice(0, 120);
    }

    const keyword = parseKeywordQuery(question);
    if (keyword) {
      const byKeyword = all.filter((msg) => {
        const haystack = `${msg.sender || ""}\n${msg.subject || ""}\n${msg.snippet || ""}\n${msg.bodyText || ""}`
          .toLowerCase();
        return haystack.includes(keyword);
      });
      if (byKeyword.length > 0) return byKeyword.slice(0, 120);
    }

    return all.slice(0, 80);
  }

  function openThread(threadId, href = "", row = null) {
    if (!threadId && !href && !(row instanceof HTMLElement)) return false;
    const variants = threadHintKeysForThread(threadId);
    const hint = normalize(href || "");
    const hintHash = hashFromHref(hint);
    const activeBox = mailboxCacheKey(mailboxKeyFromHash(window.location.hash || state.lastListHash || "#inbox"));
    const currentHash = normalize(window.location.hash || "");
    const main = getGmailMainRoot();

    // Fast path: route directly by hash when we have a thread id/hint.
    // This avoids expensive anchor scans and also works for cached rows with no DOM node.
    if (hintHash) {
      const routedHash = normalizeThreadHashForMailbox(hintHash, activeBox) || hintHash;
      if (routedHash && routedHash !== currentHash) {
        window.location.hash = routedHash;
        return true;
      }
    }
    if (variants.length > 0) {
      const primaryVariant = normalize(variants[0] || "");
      if (primaryVariant) {
        const asHash = primaryVariant.startsWith("#") ? primaryVariant : `#${primaryVariant}`;
        const routedHash = normalizeThreadHashForMailbox(asHash, activeBox);
        if (routedHash && routedHash !== currentHash) {
          window.location.hash = routedHash;
          return true;
        }
      }
    }

    if (main instanceof HTMLElement && hint) {
      const anchors = Array.from(main.querySelectorAll("a[href], [role='link'][href]"));
      for (const anchor of anchors) {
        if (!(anchor instanceof HTMLElement)) continue;
        const anchorHref = normalize(anchor.getAttribute("href") || "");
        if (!anchorHref) continue;
        if (anchorHref === hint || (hintHash && hashFromHref(anchorHref) === hintHash)) {
          anchor.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          anchor.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          anchor.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          return true;
        }
      }
    }

    for (const variant of variants) {
      const noHash = variant.startsWith("#") ? variant.slice(1) : variant;
      if (!noHash) continue;

      const link = (
        document.querySelector(`[role="main"] a[href$="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`[role="main"] a[href*="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`[role="main"] a[href*="#${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href$="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href*="/${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href*="#${CSS.escape(noHash)}"]`) ||
        document.querySelector(`a[href*="th=${CSS.escape(noHash)}"]`)
      );
      if (link instanceof HTMLElement) {
        link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }

      const domRow = (
        document.querySelector(`[data-thread-id="${CSS.escape(variant)}"]`) ||
        document.querySelector(`[data-legacy-thread-id="${CSS.escape(variant)}"]`) ||
        document.querySelector(`[data-thread-id="${CSS.escape(noHash)}"]`) ||
        document.querySelector(`[data-legacy-thread-id="${CSS.escape(noHash)}"]`)
      );
      if (domRow instanceof HTMLElement) {
        domRow.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        domRow.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        domRow.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        return true;
      }
    }

    if (row instanceof HTMLElement) {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    if (hintHash) {
      window.location.hash = normalizeThreadHashForMailbox(hintHash, activeBox) || hintHash;
      return true;
    }

    if (hint) {
      const rawHash = hint.includes("#") ? hint.slice(hint.indexOf("#")) : hint;
      window.location.hash = normalizeThreadHashForMailbox(rawHash, activeBox) || rawHash;
      return true;
    }

    return false;
  }

    return {
      selectRows,
      extractThreadIdFromRow,
      threadIdFromHref,
      fallbackThreadIdFromRow,
      messageDedupeKey,
      extractSender,
      extractRowRecipientEmails,
      extractDate,
      extractSnippet,
      extractSubject,
      firstPageFingerprint,
      isElementVisible,
      isDisabledButton,
      findPagerButton,
      dispatchSyntheticClick,
      updateMailboxScanProgress,
      schedulerScanToken,
      scheduleMailboxScanKick,
      waitForPageChange,
      scanMailboxPages,
      queueMailboxScan,
      runMailboxScanQueue,
      runFullMailboxScan,
      parseLastCountQuery,
      parseFromDateQuery,
      parseKeywordQuery,
      selectMessagesForQuestion,
      openThread
    };
  };
})();
