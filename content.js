(() => {
  "use strict";

  const STYLE_ID = "reskin-stylesheet";
  const ROOT_ID = "reskin-root";
  const MODE_ATTR = "data-reskin-mode";
  const MODE_VALUE = "viewer";
  const GMAIL_READY_SELECTORS = ['[role="main"]', '[aria-label="Main menu"]'];
  const ROW_SELECTORS = [
    '[role="main"] tr[role="row"][data-thread-id]',
    '[role="main"] tr[role="row"][data-legacy-thread-id]',
    '[role="main"] [role="row"][data-thread-id]',
    '[role="main"] [role="row"][data-legacy-thread-id]',
    '[role="main"] tr[data-thread-id]',
    '[role="main"] tr[data-legacy-thread-id]',
    '[gh="tl"] tr[role="row"]',
    '[gh="tl"] tr',
    '[role="row"][data-thread-id]',
    '[role="row"][data-legacy-thread-id]',
    '[role="option"][data-thread-id]',
    '[role="option"][data-legacy-thread-id]',
    '[data-thread-id]',
    '[data-legacy-thread-id]'
  ];
  const LINK_SELECTORS = [
    '[role="main"] a[href*="#inbox/"]',
    '[role="main"] a[href*="#all/"]',
    '[role="main"] a[href*="#label/"]',
    '[role="main"] a[href*="#sent/"]',
    '[role="main"] [role="link"][href*="#"]',
    '[gh="tl"] a[href*="#inbox/"]',
    '[gh="tl"] a[href*="#all/"]',
    '[gh="tl"] a[href*="#label/"]',
    '[gh="tl"] a[href*="#sent/"]',
    'a[href*="#inbox/"]',
    'a[href*="#all/"]',
    'a[href*="#label/"]',
    'a[href*="#sent/"]'
  ];
  const NAV_ITEMS = [
    { label: "Inbox", hash: "#inbox", nativeLabel: "Inbox" },
    { label: "Starred", hash: "#starred", nativeLabel: "Starred" },
    { label: "Snoozed", hash: "#snoozed", nativeLabel: "Snoozed" },
    { label: "Sent", hash: "#sent", nativeLabel: "Sent" },
    { label: "Drafts", hash: "#drafts", nativeLabel: "Drafts" },
    { label: "All Mail", hash: "#all", nativeLabel: "All Mail" },
    { label: "Spam", hash: "#spam", nativeLabel: "Spam" },
    { label: "Trash", hash: "#trash", nativeLabel: "Trash" }
  ];

  const NOISE_TEXT = new Set([
    "starred",
    "not starred",
    "read",
    "unread",
    "important",
    "inbox",
    "select",
    "open",
    "archive",
    "delete"
  ]);

  const state = {
    observer: null,
    debounceTimer: null,
    isApplying: false,
    interactionLockUntil: 0,
    lastListSignature: "",
    currentView: "list",
    activeThreadId: "",
    lockListView: false,
    lastListHash: "#inbox",
    lastRenderedCount: null,
    lastSource: "",
    loggedOnce: new Set()
  };

  function logInfo(message, extra) {
    if (typeof extra === "undefined") {
      console.info(`[reskin] ${message}`);
      return;
    }
    console.info(`[reskin] ${message}`, extra);
  }

  function logWarn(message, extra) {
    if (typeof extra === "undefined") {
      console.warn(`[reskin] ${message}`);
      return;
    }
    console.warn(`[reskin] ${message}`, extra);
  }

  function logOnce(key, level, message, extra) {
    if (state.loggedOnce.has(key)) return;
    state.loggedOnce.add(key);
    if (level === "warn") logWarn(message, extra);
    else logInfo(message, extra);
  }

  function lockInteractions(ms = 900) {
    state.interactionLockUntil = Date.now() + ms;
  }

  function interactionsLocked() {
    return Date.now() < state.interactionLockUntil;
  }

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isUseful(text) {
    const value = normalize(text);
    if (!value || value.length < 2) return false;
    if (NOISE_TEXT.has(value.toLowerCase())) return false;
    return true;
  }

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

  function removeLegacyNodes() {
    const oldRoot = document.getElementById(ROOT_ID);
    if (oldRoot) oldRoot.remove();
    for (const node of document.querySelectorAll('[data-reskin="true"]')) {
      if (node instanceof HTMLElement) node.remove();
    }
  }

  function ensureStylesheet() {
    const existing = document.getElementById(STYLE_ID);
    if (existing) return existing;

    const head = document.head || document.documentElement;
    if (!head) return null;
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = chrome.runtime.getURL("styles.css");
    head.appendChild(link);
    return link;
  }

  function ensureMode() {
    document.documentElement.setAttribute(MODE_ATTR, MODE_VALUE);
    if (document.body) document.body.setAttribute(MODE_ATTR, MODE_VALUE);
  }

  function isThreadHash() {
    const hash = normalize(window.location.hash || "");
    if (!hash) return false;
    return /#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/]+)\/[A-Za-z0-9_-]{6,}/i.test(
      hash
    );
  }

  function isAppSettingsHash() {
    const hash = normalize(window.location.hash || "").toLowerCase();
    return hash === "#app-settings";
  }

  function sanitizeListHash(hash) {
    const value = normalize(hash || "");
    if (!value) return "#inbox";
    const withoutThreadId = value.replace(/\/[A-Za-z0-9_-]{6,}(?:\?.*)?$/i, "");
    if (/^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/]+)$/i.test(withoutThreadId)) {
      return withoutThreadId;
    }
    return "#inbox";
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

  function navigateToList(targetHash, nativeLabel = "") {
    const nextHash = sanitizeListHash(targetHash);
    window.location.hash = nextHash;
    if (nativeLabel) clickNativeMailboxLink(nativeLabel);
  }

  function getActiveNavHash() {
    if (state.currentView === "thread") return sanitizeListHash(state.lastListHash || "#inbox");
    return sanitizeListHash(window.location.hash || state.lastListHash || "#inbox");
  }

  function mailboxKeyFromHash(hash) {
    const value = sanitizeListHash(hash);
    const raw = value.replace(/^#/, "");
    return raw || "inbox";
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

  function renderSidebar(root) {
    const nav = root.querySelector(".rv-nav");
    if (!(nav instanceof HTMLElement)) return;
    const activeHash = getActiveNavHash();
    nav.innerHTML = NAV_ITEMS.map((item) => {
      const isActive = item.hash === activeHash;
      return `<button type="button" class="rv-nav-item${isActive ? " is-active" : ""}" data-target-hash="${item.hash}" data-native-label="${escapeHtml(item.nativeLabel)}" data-reskin="true">${item.label}</button>`;
    }).join("");

    const settings = root.querySelector(".rv-settings");
    if (settings instanceof HTMLElement) {
      settings.classList.toggle("is-active", state.currentView === "settings");
    }
  }

  function syncViewFromHash() {
    if (isAppSettingsHash()) {
      state.currentView = "settings";
      return;
    }
    const threadHash = isThreadHash();
    if (state.lockListView) {
      if (!threadHash) {
        state.lockListView = false;
      } else {
        state.currentView = "list";
        return;
      }
    }
    state.currentView = threadHash ? "thread" : "list";
    if (state.currentView === "list") {
      state.lastListHash = sanitizeListHash(window.location.hash || "#inbox");
    }
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    if (!document.body) return null;

    root = document.createElement("section");
    root.id = ROOT_ID;
    root.setAttribute("data-reskin", "true");
    root.innerHTML = `
      <div class="rv-shell" data-reskin="true">
        <aside class="rv-sidebar" data-reskin="true">
          <div class="rv-brand" data-reskin="true">Mail Viewer</div>
          <div class="rv-nav-wrap" data-reskin="true">
            <nav class="rv-nav" data-reskin="true"></nav>
          </div>
          <button type="button" class="rv-settings" data-reskin="true">Settings</button>
        </aside>
        <main class="rv-main" data-reskin="true">
          <div class="rv-list" data-reskin="true"></div>
        </main>
      </div>
    `;
    document.body.appendChild(root);
    bindRootEvents(root);
    return root;
  }

  function bindRootEvents(root) {
    if (root.getAttribute("data-bound") === "true") return;
    root.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.closest(".rv-settings")) {
        lockInteractions(500);
        state.currentView = "settings";
        window.location.hash = "#app-settings";
        renderCurrentView(root);
        return;
      }
      if (target.closest(".rv-settings-back")) {
        lockInteractions(500);
        state.currentView = "list";
        window.location.hash = sanitizeListHash(state.lastListHash || "#inbox");
        renderCurrentView(root);
        return;
      }
      const navItem = target.closest(".rv-nav-item");
      if (!(navItem instanceof HTMLElement)) return;
      lockInteractions(900);
      const nextHash = navItem.getAttribute("data-target-hash") || "#inbox";
      const nativeLabel = navItem.getAttribute("data-native-label") || "";
      state.currentView = "list";
      state.activeThreadId = "";
      state.lockListView = false;
      state.lastListHash = sanitizeListHash(nextHash);
      navigateToList(nextHash, nativeLabel);
      const list = root.querySelector(".rv-list");
      if (list instanceof HTMLElement) {
        list.innerHTML = `<div class="rv-empty" data-reskin="true">Loading ${escapeHtml(nextHash.replace("#", ""))}...</div>`;
      }
      setTimeout(() => {
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement) applyReskin();
      }, 250);
      setTimeout(() => {
        const latestRoot = document.getElementById(ROOT_ID);
        if (latestRoot instanceof HTMLElement) applyReskin();
      }, 900);
    });
    root.setAttribute("data-bound", "true");
  }

  function selectRows() {
    const unique = new Set();
    const rows = [];
    for (const selector of ROW_SELECTORS) {
      const nodes = document.querySelectorAll(selector);
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

    const link = row.querySelector('a[href*="#"]');
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

  function extractSender(row) {
    const senderCandidates = [
      row.querySelector("span[email]"),
      row.querySelector("[email]"),
      row.querySelector("span[name]"),
      row.querySelector("[data-hovercard-id]")
    ];
    for (const node of senderCandidates) {
      if (!node) continue;
      const fromText = normalize(node.textContent);
      if (isUseful(fromText)) return fromText;
      const fromTitle = normalize(node.getAttribute("title"));
      if (isUseful(fromTitle)) return fromTitle;
    }
    return "Unknown sender";
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

  function extractSubject(row, sender) {
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
      // Prefer concise subject-like text over long snippet-like strings.
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

    const rowText = normalize(row.textContent);
    if (isUseful(rowText)) {
      const cleaned = rowText
        .replace(sender, "")
        .replace(/\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun),?\s+[A-Z][a-z]{2}\s+\d{1,2},?\s+\d{4},?\s+\d{1,2}:\d{2}\s?(AM|PM)\b/gi, "")
        .replace(/\b\d{1,2}:\d{2}\s?(AM|PM)\b/gi, "")
        .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\b/gi, "")
        .replace(/\s{2,}/g, " ")
        .trim();
      if (isUseful(cleaned)) return cleaned.slice(0, 120);
    }

    return "No subject captured";
  }

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
      .replace(/\s+[–—]\s+.*$/, "")
      .replace(/^\s*(re|fw|fwd)\s*:\s*/i, "")
      .replace(/\s{2,}/g, " ")
      .replace(/\s*[-,|:]\s*$/, "")
      .trim();

    return isUseful(value) ? value : "No subject captured";
  }

  function collectMessages(limit = 60) {
    const rows = selectRows();
    const items = [];
    const seen = new Set();
    let source = "rows";
    const mailboxKey = mailboxKeyFromHash(getActiveNavHash());
    const strictMailbox = mailboxKey !== "inbox";

    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      const threadId = extractThreadIdFromRow(row);
      if (!threadId || seen.has(threadId)) continue;
      seen.add(threadId);

      const sender = extractSender(row);
      const date = extractDate(row);
      const subject = cleanSubject(extractSubject(row, sender), sender, date);

      const rowLink = row.querySelector('a[href*="#"], a[href*="th="], a[href]');
      const href = rowLink instanceof HTMLAnchorElement ? rowLink.getAttribute("href") || "" : "";
      if (strictMailbox) {
        if (!href || !hrefMatchesMailbox(href, mailboxKey)) continue;
      }
      items.push({ threadId, sender, subject, date, href });
      if (items.length >= limit) break;
    }

    if (items.length < limit) {
      source = items.length > 0 ? "rows+links" : "links";
      for (const selector of LINK_SELECTORS) {
        const links = Array.from(document.querySelectorAll(selector));
        if (links.length === 0) continue;

        for (const link of links) {
          if (!(link instanceof HTMLElement)) continue;
          const href = link.getAttribute("href") || "";
          const threadId = threadIdFromHref(href);
          if (!threadId || seen.has(threadId)) continue;
          if (strictMailbox && !hrefMatchesMailbox(href, mailboxKey)) continue;

          const row = link.closest('[role="row"], tr, div');
          const sender = row ? extractSender(row) : "Unknown sender";
          const date = row ? extractDate(row) : "";
          const linkTitle = normalize(link.getAttribute("title"));
          const linkText = normalize(link.textContent);
          const subject =
            cleanSubject(
              (isUseful(linkTitle) && linkTitle) ||
                (isUseful(linkText) && linkText) ||
                (row ? extractSubject(row, sender) : "No subject captured"),
              sender,
              date
            );

          seen.add(threadId);
          items.push({ threadId, sender, subject, date, href });
          if (items.length >= limit) break;
        }

        if (items.length >= limit) break;
      }
    }

    return { items, source };
  }

  function openThread(threadId, href = "") {
    if (!threadId) return false;
    const link =
      document.querySelector(`[role="main"] a[href$="/${CSS.escape(threadId)}"]`) ||
      document.querySelector(`[role="main"] a[href*="/${CSS.escape(threadId)}"]`) ||
      document.querySelector(`a[href$="/${CSS.escape(threadId)}"]`) ||
      document.querySelector(`a[href*="/${CSS.escape(threadId)}"]`) ||
      document.querySelector(`a[href*="th=${CSS.escape(threadId)}"]`);
    if (link instanceof HTMLElement) {
      link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    const row =
      document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`) ||
      document.querySelector(`[data-legacy-thread-id="${CSS.escape(threadId)}"]`);
    if (row instanceof HTMLElement) {
      row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    if (href) {
      window.location.hash = href.includes("#") ? href.slice(href.indexOf("#")) : href;
      return true;
    }

    return false;
  }

  function extractOpenThreadData() {
    const main = document.querySelector('[role="main"]') || document.body;
    if (!(main instanceof HTMLElement)) {
      return { subject: "", sender: "", date: "", body: "" };
    }

    const subjectCandidates = Array.from(main.querySelectorAll("h1, h2, [role='heading']"))
      .map((node) => normalize(node.textContent))
      .filter((text) => isUseful(text) && !looksLikeDateOrTime(text));
    const subject = subjectCandidates[0] || "No subject captured";

    const senderNode = main.querySelector(
      'h3 span[email], .gD[email], span[email], [email], [data-hovercard-id]'
    );
    const sender = senderNode instanceof HTMLElement ? normalize(senderNode.innerText || senderNode.textContent) : "";

    const dateCandidates = Array.from(main.querySelectorAll("span.g3[title], time, span[title], div[title]"))
      .map((node) => normalize(node.getAttribute("title") || node.innerText || node.textContent))
      .filter((text) => looksLikeDateOrTime(text) || /\b\d{4}\b/.test(text));
    const date = dateCandidates[0] || "";

    const bodyNodes = Array.from(
      main.querySelectorAll('.a3s.aiL, .a3s, [data-message-id] .ii.gt, [role="listitem"] div[dir="ltr"], [role="listitem"] div[dir="auto"]')
    ).filter((node) => node instanceof HTMLElement);
    bodyNodes.sort((a, b) => normalize((b).innerText || "").length - normalize((a).innerText || "").length);
    const bodyNode = bodyNodes[0] || null;
    const bodyHtml = bodyNode instanceof HTMLElement ? bodyNode.innerHTML : "";
    const bodyText = bodyNode instanceof HTMLElement ? normalize(bodyNode.innerText || bodyNode.textContent) : "";

    return {
      subject: cleanSubject(subject, sender, date),
      sender: isUseful(sender) ? sender : "Unknown sender",
      date,
      bodyHtml,
      bodyText: bodyText || "Message body not captured yet."
    };
  }

  function renderThread(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;
    const thread = extractOpenThreadData();
    const backLabel = "Back to inbox";

    list.innerHTML = `
      <section class="rv-thread" data-reskin="true">
        <button type="button" class="rv-back" data-reskin="true">${backLabel}</button>
        <h2 class="rv-thread-subject" data-reskin="true">${escapeHtml(thread.subject)}</h2>
        <div class="rv-thread-meta" data-reskin="true">
          <span class="rv-thread-sender" data-reskin="true">${escapeHtml(thread.sender)}</span>
          <span class="rv-thread-date" data-reskin="true">${escapeHtml(thread.date)}</span>
        </div>
        <article class="rv-thread-body" data-reskin="true"></article>
      </section>
    `;

    const body = list.querySelector(".rv-thread-body");
    if (body instanceof HTMLElement) {
      if (thread.bodyHtml) {
        body.innerHTML = `<div class="rv-thread-html" data-reskin="true">${thread.bodyHtml}</div>`;
      } else {
        body.innerHTML = `<pre class="rv-thread-plain" data-reskin="true">${escapeHtml(thread.bodyText)}</pre>`;
      }
    }

    const back = list.querySelector(".rv-back");
    if (back instanceof HTMLElement) {
      back.addEventListener("click", () => {
        state.currentView = "list";
        state.activeThreadId = "";
        state.lockListView = true;
        const targetHash = state.lastListHash || "#inbox";
        navigateToList(targetHash);
        setTimeout(() => {
          const latestRoot = document.getElementById(ROOT_ID);
          if (latestRoot instanceof HTMLElement) applyReskin();
        }, 260);
      });
    }
  }

  function renderCurrentView(root) {
    renderSidebar(root);
    if (state.currentView === "settings") {
      renderSettings(root);
      return;
    }
    if (state.currentView === "thread") {
      renderThread(root);
      return;
    }
    renderList(root);
  }

  function renderSettings(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;
    list.innerHTML = `
      <section class="rv-settings-view" data-reskin="true">
        <h2 class="rv-settings-title" data-reskin="true">Settings</h2>
        <p class="rv-settings-copy" data-reskin="true">This settings page is fully inside your app UI.</p>
        <div class="rv-settings-grid" data-reskin="true">
          <div class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Folder Navigation</div>
            <div class="rv-settings-value" data-reskin="true">Sidebar-enabled</div>
          </div>
          <div class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Thread Viewer</div>
            <div class="rv-settings-value" data-reskin="true">Custom overlay</div>
          </div>
          <div class="rv-settings-card" data-reskin="true">
            <div class="rv-settings-label" data-reskin="true">Theme</div>
            <div class="rv-settings-value" data-reskin="true">Monochrome</div>
          </div>
        </div>
        <button type="button" class="rv-settings-back" data-reskin="true">Back to Inbox</button>
      </section>
    `;
  }

  function renderList(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;

    const result = collectMessages();
    const messages = result.items;
    const listSignature = `${getActiveNavHash()}|${messages.map((m) => m.threadId).join(",")}`;
    if (state.lastListSignature === listSignature && !interactionsLocked()) return;
    state.lastListSignature = listSignature;
    list.innerHTML = "";

    if (state.lastSource !== result.source) {
      state.lastSource = result.source;
      logInfo(`Extractor source: ${result.source}`);
    }
    if (state.lastRenderedCount !== messages.length) {
      state.lastRenderedCount = messages.length;
      logInfo(`Rendered ${messages.length} messages`);
    }

    if (messages.length === 0) {
      logWarn("No messages captured. Gmail selectors did not match this view.");
      const empty = document.createElement("div");
      empty.className = "rv-empty";
      empty.setAttribute("data-reskin", "true");
      empty.textContent = "No messages captured yet.";
      list.appendChild(empty);
      return;
    }

    for (const msg of messages) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "rv-item";
      item.setAttribute("data-reskin", "true");
      item.innerHTML = `
        <div class="rv-item-top" data-reskin="true">
          <span class="rv-sender" data-reskin="true">${msg.sender}</span>
          <span class="rv-date" data-reskin="true">${msg.date || ""}</span>
        </div>
        <div class="rv-subject" data-reskin="true">${msg.subject}</div>
      `;
      item.addEventListener("click", () => {
        lockInteractions(900);
        state.lockListView = false;
        state.currentView = "thread";
        state.activeThreadId = msg.threadId;
        renderThread(root);
        const ok = openThread(msg.threadId, msg.href);
        if (!ok) {
          logWarn("Failed to open thread from custom view.", { threadId: msg.threadId });
          state.currentView = "list";
          state.activeThreadId = "";
          renderList(root);
          return;
        }
        setTimeout(() => {
          const latestRoot = document.getElementById(ROOT_ID);
          if (!(latestRoot instanceof HTMLElement)) return;
          if (state.currentView !== "thread") return;
          renderThread(latestRoot);
        }, 220);
      });
      list.appendChild(item);
    }
  }

  function applyReskin() {
    if (state.isApplying) return;
    state.isApplying = true;
    try {
      ensureStylesheet();
      const root = ensureRoot();
      if (!root) return;
      syncViewFromHash();
      renderCurrentView(root);
      ensureMode();
    } finally {
      state.isApplying = false;
    }
  }

  function startObserver() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver((mutations) => {
      if (interactionsLocked()) return;
      if (state.isApplying) return;
      let hasExternalMutation = false;
      for (const mutation of mutations) {
        const target = mutation.target;
        if (!(target instanceof Node)) continue;
        const root = document.getElementById(ROOT_ID);
        if (root && root.contains(target)) continue;
        hasExternalMutation = true;
        break;
      }
      if (!hasExternalMutation) return;
      clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        if (interactionsLocked()) return;
        if (state.isApplying) return;
        const hasStyle = Boolean(document.getElementById(STYLE_ID));
        const hasRoot = Boolean(document.getElementById(ROOT_ID));
        if (!hasStyle || !hasRoot) {
          applyReskin();
          return;
        }
        const root = document.getElementById(ROOT_ID);
        if (root instanceof HTMLElement) renderCurrentView(root);
      }, 75);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function waitForReady() {
    removeLegacyNodes();
    window.addEventListener("hashchange", () => {
      syncViewFromHash();
      const root = document.getElementById(ROOT_ID);
      if (root instanceof HTMLElement) renderCurrentView(root);
    });
    logInfo("Waiting for Gmail landmarks...");
    const poll = setInterval(() => {
      const ready = selectFirst(GMAIL_READY_SELECTORS);
      if (!ready) return;
      clearInterval(poll);
      logInfo("Gmail ready. Applying viewer.");
      applyReskin();
      startObserver();
      logOnce("observer-started", "info", "Mutation observer started (debounced 75ms).");
    }, 200);
  }

  waitForReady();
})();
