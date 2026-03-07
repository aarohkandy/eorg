(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createNavigationThreadContextApi = function createNavigationThreadContextApi(deps = {}) {
    const {
      MODE_ATTR,
      MODE_VALUE,
      THEME_ATTR,
      THEME_DARK,
      THEME_LIGHT,
      TRIAGE_LEVELS,
      state,
      normalize,
      extractEmail,
      getRoot,
      lockInteractions,
      logTimed,
      getMailboxCacheKey,
      getThreadHashForMailbox,
      getOpenThread,
      getThreadDomReadinessSnapshot,
      getRenderCurrentView,
      sleep
    } = deps;
    const themeAttr = normalize(THEME_ATTR || "") || "data-reskin-theme";

    const mailboxCacheKey = (...args) => {
      const fn = typeof getMailboxCacheKey === "function" ? getMailboxCacheKey() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const threadHashForMailbox = (...args) => {
      const fn = typeof getThreadHashForMailbox === "function" ? getThreadHashForMailbox() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const openThread = (...args) => {
      const fn = typeof getOpenThread === "function" ? getOpenThread() : null;
      if (typeof fn !== "function") return false;
      return fn(...args);
    };
    const threadDomReadinessSnapshot = (...args) => {
      const fn = typeof getThreadDomReadinessSnapshot === "function" ? getThreadDomReadinessSnapshot() : null;
      if (typeof fn !== "function") {
        return {
          ready: false,
          messageContainers: 0,
          bodyNodes: 0,
          iframeBodyNodes: 0,
          iframeCount: 0
        };
      }
      return fn(...args);
    };
    const renderCurrentView = (...args) => {
      const fn = typeof getRenderCurrentView === "function" ? getRenderCurrentView() : null;
      if (typeof fn !== "function") return;
      return fn(...args);
    };
  function looksLikeDateOrTime(text) {
    const value = normalize(text);
    if (!value) return false;
    return (
      /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{1,2}$/i.test(value) ||
      /^\d{1,2}:\d{2}\s?(AM|PM)$/i.test(value) ||
      /^\d+\s?(m|h|d|w)$/i.test(value) ||
      /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s/i.test(value) ||
      /\b\d{4},?\s+\d{1,2}:\d{2}\s?(AM|PM)\b/i.test(value)
    );
  }

  function selectFirst(selectors) {
    for (const selector of selectors) {
      const node = document.querySelector(selector);
      if (node) return node;
    }
    return null;
  }

  function getGmailMainRoot() {
    return (
      document.querySelector('[role="main"]') ||
      document.querySelector('[gh="tl"]') ||
      null
    );
  }

  function removeLegacyNodes() {
    const oldRoot = getRoot();
    if (oldRoot) oldRoot.remove();
    for (const node of document.querySelectorAll('[data-reskin="true"]')) {
      if (node instanceof HTMLElement) node.remove();
    }
  }

  function ensureStylesheet() {
    // No-op: styles.css is injected as a <link> inside the Shadow DOM by ensureRoot().
    // Body-hiding rules are applied as an inline <style> in document.head by ensureRoot().
  }

  function ensureMode() {
    document.documentElement.setAttribute(MODE_ATTR, MODE_VALUE);
    if (document.body) document.body.setAttribute(MODE_ATTR, MODE_VALUE);
  }

  function normalizeTheme(value) {
    return normalize(value || "").toLowerCase() === THEME_LIGHT ? THEME_LIGHT : THEME_DARK;
  }

  function activeTheme() {
    return normalizeTheme(state.settingsCache && state.settingsCache.theme);
  }

  function applyTheme(root) {
    const theme = activeTheme();
    const shell = root instanceof HTMLElement ? root : getRoot();
    if (shell instanceof HTMLElement) shell.setAttribute(themeAttr, theme);
    document.documentElement.setAttribute(themeAttr, theme);
    if (document.body) document.body.setAttribute(themeAttr, theme);
  }

  function parseListRoute(hashValue) {
    const raw = normalize(hashValue || "");
    if (!raw) return { hash: "#inbox", mailbox: "inbox", triage: "" };

    const qIndex = raw.indexOf("?");
    const withoutQuery = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const query = qIndex >= 0 ? raw.slice(qIndex + 1) : "";

    const withoutThreadId = withoutQuery.replace(/\/[A-Za-z0-9_-]{6,}$/i, "");
    const validBase = /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/]+)$/i.test(
      withoutThreadId
    )
      ? withoutThreadId
      : "#inbox";

    const mailbox = validBase.replace(/^#/, "").toLowerCase() || "inbox";
    let triage = "";

    if (mailbox === "inbox" && query) {
      const params = new URLSearchParams(query);
      const candidate = normalize(params.get("triage") || "").toLowerCase();
      if (TRIAGE_LEVELS.includes(candidate)) triage = candidate;
    }

    const hash = mailbox === "inbox" && triage ? `#inbox?triage=${triage}` : validBase;
    return { hash, mailbox, triage };
  }

  function sanitizeListHash(hashValue, options = {}) {
    const parsed = parseListRoute(hashValue);
    let mailbox = parsed.mailbox;
    let triage = parsed.triage;

    if (options.forceInbox) mailbox = "inbox";
    if (options.clearTriage) triage = "";
    if (mailbox !== "inbox") triage = "";

    return mailbox === "inbox" && triage ? `#inbox?triage=${triage}` : `#${mailbox}`;
  }

  function hashHasTriageParam(hashValue) {
    const raw = normalize(hashValue || "");
    return /\btriage=/.test(raw);
  }

  function activeMailbox() {
    return parseListRoute(state.currentView === "thread" ? state.lastListHash : window.location.hash).mailbox;
  }

  function activeTriageFilter() {
    if (activeMailbox() !== "inbox") return "";
    const fromState = normalize(state.triageFilter || "").toLowerCase();
    if (TRIAGE_LEVELS.includes(fromState)) return fromState;
    return parseListRoute(state.currentView === "thread" ? state.lastListHash : window.location.hash).triage;
  }

  function getActiveNavHash() {
    return `#${activeMailbox()}`;
  }

  function isThreadHash(hashValue = window.location.hash) {
    const hash = normalize(hashValue || "");
    if (!hash) return false;
    const clean = hash.split("?")[0];
    if (/^#thread-f:[A-Za-z0-9_-]+$/i.test(clean)) return true;
    return /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i.test(
      clean
    );
  }

  function threadIdFromHash(hash) {
    const raw = normalize(hash || window.location.hash || "");
    if (!raw) return "";
    const clean = raw.split("?")[0];
    const direct = clean.match(/^#((?:thread-)?f:[A-Za-z0-9_-]+)$/i);
    if (direct && direct[1]) return direct[1];
    const routed = clean.match(
      /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i
    );
    return routed && routed[1] ? routed[1] : "";
  }

  function normalizeThreadHashForMailbox(hashValue, mailbox = "inbox") {
    const clean = normalize((hashValue || "").split("?")[0] || "");
    if (!clean) return "";
    const box = mailboxCacheKey(mailbox || "inbox");
    const direct = clean.match(/^#((?:thread-)?f:[A-Za-z0-9_-]+)$/i);
    if (direct && direct[1]) {
      const raw = normalize(direct[1] || "");
      const routed = raw.startsWith("f:") ? `thread-${raw}` : raw;
      return `#${box}/${routed}`;
    }
    const routedMatch = clean.match(
      /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i
    );
    if (routedMatch && routedMatch[1]) {
      const raw = normalize(routedMatch[1] || "");
      const routed = raw.startsWith("f:") ? `thread-${raw}` : raw;
      return `#${box}/${routed}`;
    }
    return clean;
  }

  function isAppSettingsHash() {
    const hash = normalize(window.location.hash || "").toLowerCase();
    return hash === "#app-settings" || hash.startsWith("#app-settings?");
  }

  function mailboxKeyFromHash(hash) {
    return parseListRoute(hash).mailbox;
  }

  function hrefMatchesMailbox(href, mailboxKey) {
    const value = normalize(href);
    const box = normalize(mailboxKey).toLowerCase();
    if (!value || !box) return false;

    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) {
      const hash = value.slice(hashIndex + 1).toLowerCase();
      if (box.startsWith("label/")) return hash.startsWith(box);
      if (hash === box || hash.startsWith(`${box}/`)) return true;
    }

    try {
      const url = new URL(value, window.location.origin);
      const search = normalize(url.searchParams.get("search") || "").toLowerCase();
      const hasThread = Boolean(normalize(url.searchParams.get("th") || ""));
      if (!hasThread) return false;
      if (!search) return box === "inbox";
      if (box === "all") return search.includes("all");
      return search.includes(box);
    } catch (_) {
      return false;
    }
  }

  function clickNativeMailboxLink(nativeLabel) {
    const escaped = nativeLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`^${escaped}(\\b|\\s|,)`, "i");
    const candidates = [
      ...Array.from(document.querySelectorAll(`a[aria-label^="${nativeLabel}"]`)),
      ...Array.from(document.querySelectorAll(`a[title^="${nativeLabel}"]`)),
      ...Array.from(document.querySelectorAll("a[role='link']")),
      ...Array.from(document.querySelectorAll("a"))
    ];

    for (const node of candidates) {
      if (!(node instanceof HTMLElement)) continue;
      const label = normalize(node.getAttribute("aria-label") || node.getAttribute("title") || node.textContent);
      if (!label) continue;
      if (!re.test(label) && label.toLowerCase() !== nativeLabel.toLowerCase()) continue;
      node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }
    return false;
  }

  function navigateToList(targetHash, nativeLabel = "", options = {}) {
    const nextHash = sanitizeListHash(targetHash);
    const sx = window.scrollX, sy = window.scrollY;
    window.location.hash = nextHash;
    if (nativeLabel && options.native !== false) clickNativeMailboxLink(nativeLabel);
    window.scrollTo(sx, sy);
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }

  function openSettingsView(root) {
    lockInteractions(500);
    state.settingsPinned = true;
    state.currentView = "settings";
    window.location.hash = "#app-settings";
    renderCurrentView(root);
  }

  function triageLabelText(level) {
    const config = window.ReskinTriage && window.ReskinTriage.LEVEL_CONFIG
      ? window.ReskinTriage.LEVEL_CONFIG[level]
      : null;
    return config ? config.label : level;
  }

  function canonicalThreadId(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return "";
    const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
    if (noHash.startsWith("thread-f:")) return `f:${noHash.slice("thread-f:".length)}`;
    if (noHash.startsWith("f:")) return noHash;
    return noHash;
  }

  // Normalize any thread ID (hex or canonical) to canonical f:decimal for comparison.
  // InboxSDK returns hex; scan cache uses canonical. Use this when comparing across sources.
  function canonicalThreadIdForCompare(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return "";
    if (/^f:|^thread-f:/i.test(raw)) return canonicalThreadId(raw);
    if (/^[0-9a-f]+$/i.test(raw)) {
      try { return `f:${BigInt("0x" + raw).toString()}`; } catch (_) { return raw; }
    }
    return canonicalThreadId(raw);
  }

  function localReadKeysForThread(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return [];
    const canonical = canonicalThreadId(raw);
    const keys = [raw];
    if (canonical) {
      keys.push(canonical, `#${canonical}`);
      if (canonical.startsWith("f:")) {
        const suffix = canonical.slice(2);
        keys.push(`thread-f:${suffix}`, `#thread-f:${suffix}`);
      }
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function threadHintKeysForThread(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return [];
    const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
    const canonical = canonicalThreadId(noHash);
    const keys = [raw, noHash, `#${noHash}`];
    if (canonical) {
      keys.push(canonical, `#${canonical}`);
      if (canonical.startsWith("f:")) {
        const suffix = canonical.slice(2);
        keys.push(`thread-f:${suffix}`, `#thread-f:${suffix}`);
      }
    }
    return Array.from(new Set(keys.filter(Boolean)));
  }

  function rememberThreadNavigationHint(threadId, href = "", row = null) {
    const id = normalize(threadId || "");
    const link = normalize(href || "");
    if (!id && !link && !(row instanceof HTMLElement)) return;
    const keys = threadHintKeysForThread(id);
    if (keys.length === 0 && !link && !(row instanceof HTMLElement)) return;

    for (const key of keys) {
      if (link) {
        state.threadHintHrefByThreadId[key] = link;
      }
      if (row instanceof HTMLElement) {
        state.threadRowHintByThreadId[key] = row;
      }
    }
    if (!state.currentThreadHintHref && link && state.currentView === "thread") {
      state.currentThreadHintHref = link;
    }
  }

  function lookupThreadHintHref(threadId) {
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const href = normalize(state.threadHintHrefByThreadId[key] || "");
      if (href) return href;
    }
    return "";
  }

  function lookupThreadRowHint(threadId) {
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const row = state.threadRowHintByThreadId[key];
      if (row instanceof HTMLElement && row.isConnected) return row;
    }
    return null;
  }

  function hashFromHref(href) {
    const value = normalize(href || "");
    if (!value) return "";
    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) return normalize(value.slice(hashIndex).split("?")[0]);
    try {
      const url = new URL(value, window.location.origin);
      return normalize((url.hash || "").split("?")[0]);
    } catch (_) {
      return "";
    }
  }

  function threadContextSnapshot(threadId = "") {
    const main = getGmailMainRoot();
    const hash = normalize(window.location.hash || "");
    const hashThreadId = normalize(threadIdFromHash(hash));
    const hashThreadLike = isThreadHash(hash);
    let messageNodes = 0;
    let replyButtons = 0;
    let listRows = 0;
    if (main instanceof HTMLElement) {
      messageNodes = main.querySelectorAll("[data-message-id], .h7 .adn, .h7 .ii.gt, .adn.ads, .ii.gt").length;
      replyButtons = main.querySelectorAll('[gh="rr"], [data-tooltip*="Reply"], [aria-label*="Reply"]').length;
      listRows = main.querySelectorAll("tr.zA, [role='row'][data-thread-id], [role='row'][data-legacy-thread-id]").length;
    }
    const domReady = messageNodes > 0 || (hashThreadLike && replyButtons > 0 && listRows === 0);
    const expectedCanonical = canonicalThreadId(threadId);
    const hashCanonical = canonicalThreadId(hashThreadId || state.activeThreadId || "");
    const threadMatch = !expectedCanonical || !hashCanonical || expectedCanonical === hashCanonical;
    const ok = domReady && (hashThreadLike || replyButtons > 0) && threadMatch;
    return {
      ok,
      hash,
      hashThreadLike,
      hashThreadId,
      expectedThreadId: normalize(threadId || ""),
      threadMatch,
      dom: { messageNodes, replyButtons, listRows, domReady }
    };
  }

  async function waitForThreadContextForReply(threadId, timeoutMs = 3200) {
    const timed = logTimed("wait:thread-context", { threadId: normalize(threadId || "").slice(0, 20), timeoutMs });
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const status = threadContextSnapshot(threadId);
      if (status.ok) {
        timed.done({ ok: true });
        return status;
      }
      await sleep(120);
    }
    const final = threadContextSnapshot(threadId);
    timed.done({ ok: false });
    return final;
  }

  async function waitForThreadDomReadyForHydration(threadId, timeoutMs = 4200) {
    const timed = logTimed("wait:thread-dom-ready", { threadId: normalize(threadId || "").slice(0, 20), timeoutMs });
    const targetCanonical = canonicalThreadId(threadId || "") || normalize(threadId || "");
    const targetSynthetic = targetCanonical.startsWith("synthetic-");
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const snapshot = threadContextSnapshot(threadId);
      if (snapshot.ok) {
        timed.done({ ok: true, mode: "context" });
        return { ok: true, status: snapshot, mode: "context" };
      }
      const hash = normalize(window.location.hash || "");
      const dom = threadDomReadinessSnapshot();
      const hashCanonical = canonicalThreadId(threadIdFromHash(hash) || "") || normalize(threadIdFromHash(hash) || "");
      const threadMatch = !targetCanonical || !hashCanonical || targetCanonical === hashCanonical || targetSynthetic;
      if (isThreadHash(hash) && dom.ready && threadMatch) {
        timed.done({ ok: true, mode: "dom-ready" });
        return {
          ok: true,
          status: {
            ...snapshot,
            ok: true,
            hashThreadLike: true,
            threadMatch: true,
            dom: {
              ...(snapshot.dom || {}),
              messageNodes: Math.max(Number((snapshot.dom || {}).messageNodes || 0), Number(dom.messageContainers || 0)),
              domReady: true
            }
          },
          mode: "dom-ready"
        };
      }
      await sleep(120);
    }
    timed.done({ ok: false, mode: "timeout" });
    return { ok: false, status: threadContextSnapshot(threadId), mode: "timeout" };
  }

  function buildThreadContextHashCandidates(threadId, mailbox, hintHref = "") {
    const out = [];
    const box = mailboxCacheKey(mailbox || "inbox");
    const hintedHash = normalizeThreadHashForMailbox(hashFromHref(hintHref), box);
    if (hintedHash && isThreadHash(hintedHash)) out.push(hintedHash);
    const preferred = threadHashForMailbox(box, threadId, hintHref);
    if (preferred && isThreadHash(preferred)) out.push(preferred);
    const keys = threadHintKeysForThread(threadId);
    for (const key of keys) {
      const noHash = key.startsWith("#") ? key.slice(1) : key;
      if (!noHash) continue;
      if (/^thread-f:[A-Za-z0-9_-]+$/i.test(noHash)) {
        out.push(`#${box}/${noHash}`);
        continue;
      }
      if (/^f:[A-Za-z0-9_-]+$/i.test(noHash)) {
        out.push(`#${box}/thread-${noHash}`);
        continue;
      }
      if (/^[A-Za-z0-9_-]{8,}$/.test(noHash)) out.push(`#${box}/${noHash}`);
    }
    return Array.from(new Set(out.map((value) => normalizeThreadHashForMailbox(value, box)).filter(Boolean)));
  }

  async function ensureThreadContextForReply(threadId, mailbox, hintHref = "") {
    const timed = logTimed("lookup:thread-context", { threadId: normalize(threadId || "").slice(0, 16) });
    const targetThreadId = normalize(threadId || "");
    const bestHint = normalize(hintHref || "") || lookupThreadHintHref(targetThreadId);
    const rowHint = lookupThreadRowHint(targetThreadId);
    const initial = threadContextSnapshot(targetThreadId);
    if (initial.ok) {
      timed.done({ ok: true, step: "alreadyThreadContext" });
      return { ok: true, contextStep: "alreadyThreadContext", status: initial, tried: [] };
    }

    const tried = [];

    if (targetThreadId || bestHint || rowHint) {
      const clicked = openThread(targetThreadId, bestHint, rowHint);
      tried.push({ step: "openThread", fired: clicked });
      if (clicked) {
        const status = await waitForThreadContextForReply(targetThreadId, 3200);
        if (status.ok) {
          timed.done({ ok: true, step: "openThread" });
          return { ok: true, contextStep: "openThread", status, tried };
        }
      }
    }

    const candidates = buildThreadContextHashCandidates(targetThreadId, mailbox, bestHint);
    for (const candidate of candidates) {
      window.location.hash = candidate;
      tried.push({ step: "hashNavigate", candidate });
      const status = await waitForThreadContextForReply(targetThreadId, 2200);
      if (status.ok) {
        timed.done({ ok: true, step: "hashNavigate", candidate });
        return { ok: true, contextStep: "hashNavigate", status, tried, candidate };
      }
    }

    const finalStatus = threadContextSnapshot(targetThreadId);
    timed.done({ ok: false });
    return {
      ok: false,
      contextStep: "thread-context-not-found",
      reason: "thread-context-not-found",
      status: finalStatus,
      tried
    };
  }

  async function forceThreadContextForHydration(threadId, mailbox, hintHref = "") {
    const targetThreadId = normalize(threadId || "");
    const bestHint = normalize(hintHref || "") || lookupThreadHintHref(targetThreadId);
    const candidates = buildThreadContextHashCandidates(targetThreadId, mailbox, bestHint);
    const tried = [];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const currentHash = normalize(window.location.hash || "");
      if (currentHash !== candidate) {
        window.location.hash = candidate;
      }
      tried.push(candidate);
      await sleep(40);
      const ready = await waitForThreadDomReadyForHydration(targetThreadId, 4200);
      if (ready.ok) {
        return {
          ok: true,
          contextStep: "forced-hash",
          status: ready.status,
          readyMode: ready.mode,
          candidate,
          tried
        };
      }
    }
    return {
      ok: false,
      contextStep: "forced-hash-failed",
      reason: "thread-context-not-found",
      status: threadContextSnapshot(targetThreadId),
      tried
    };
  }


    return {
      looksLikeDateOrTime,
      selectFirst,
      getGmailMainRoot,
      removeLegacyNodes,
      ensureStylesheet,
      ensureMode,
      normalizeTheme,
      activeTheme,
      applyTheme,
      parseListRoute,
      sanitizeListHash,
      hashHasTriageParam,
      activeMailbox,
      activeTriageFilter,
      getActiveNavHash,
      isThreadHash,
      threadIdFromHash,
      normalizeThreadHashForMailbox,
      isAppSettingsHash,
      mailboxKeyFromHash,
      hrefMatchesMailbox,
      clickNativeMailboxLink,
      navigateToList,
      openSettingsView,
      triageLabelText,
      canonicalThreadId,
      canonicalThreadIdForCompare,
      localReadKeysForThread,
      threadHintKeysForThread,
      rememberThreadNavigationHint,
      lookupThreadHintHref,
      lookupThreadRowHint,
      hashFromHref,
      threadContextSnapshot,
      waitForThreadContextForReply,
      waitForThreadDomReadyForHydration,
      buildThreadContextHashCandidates,
      ensureThreadContextForReply,
      forceThreadContextForHydration
    };
  };
})();
