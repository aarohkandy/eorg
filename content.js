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

  function normalize(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  function isUseful(text) {
    const value = normalize(text);
    if (!value || value.length < 2) return false;
    if (NOISE_TEXT.has(value.toLowerCase())) return false;
    return true;
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

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (root) return root;
    if (!document.body) return null;

    root = document.createElement("section");
    root.id = ROOT_ID;
    root.setAttribute("data-reskin", "true");
    root.innerHTML = `
      <header class="rv-header" data-reskin="true">
        <h1 data-reskin="true">Mail Viewer</h1>
        <button class="rv-refresh" data-reskin="true" type="button">Refresh</button>
      </header>
      <div class="rv-list" data-reskin="true"></div>
    `;
    document.body.appendChild(root);
    bindRootEvents(root);
    return root;
  }

  function bindRootEvents(root) {
    if (root.getAttribute("data-bound") === "true") return;
    const refresh = root.querySelector(".rv-refresh");
    if (refresh) {
      refresh.addEventListener("click", () => {
        renderList(root);
      });
    }
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
    const titles = Array.from(row.querySelectorAll("[title]"))
      .map((node) => normalize(node.getAttribute("title")))
      .filter((value) => isUseful(value) && value.toLowerCase() !== sender.toLowerCase());
    const filteredTitles = titles.filter((value) => !NOISE_TEXT.has(value.toLowerCase()));
    if (filteredTitles.length > 0) {
      filteredTitles.sort((a, b) => b.length - a.length);
      return filteredTitles[0];
    }

    const aria = normalize(row.getAttribute("aria-label"));
    if (aria) {
      const parts = aria.split(" - ").map((part) => normalize(part));
      for (const part of parts) {
        if (!isUseful(part)) continue;
        if (part.toLowerCase() === sender.toLowerCase()) continue;
        return part;
      }
    }

    const rowText = normalize(row.textContent);
    if (isUseful(rowText)) {
      const cleaned = rowText.replace(sender, "").trim();
      if (isUseful(cleaned)) return cleaned.slice(0, 120);
    }

    return "No subject captured";
  }

  function collectMessages(limit = 60) {
    const rows = selectRows();
    const items = [];
    const seen = new Set();
    let source = "rows";

    for (const row of rows) {
      if (!(row instanceof HTMLElement)) continue;
      const threadId = extractThreadIdFromRow(row);
      if (!threadId || seen.has(threadId)) continue;
      seen.add(threadId);

      const sender = extractSender(row);
      const date = extractDate(row);
      const subject = extractSubject(row, sender);

      const rowLink = row.querySelector('a[href*="#"]');
      const href = rowLink instanceof HTMLAnchorElement ? rowLink.getAttribute("href") || "" : "";
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

          const row = link.closest('[role="row"], tr, div');
          const sender = row ? extractSender(row) : "Unknown sender";
          const date = row ? extractDate(row) : "";
          const linkTitle = normalize(link.getAttribute("title"));
          const linkText = normalize(link.textContent);
          const subject =
            (isUseful(linkTitle) && linkTitle) ||
            (isUseful(linkText) && linkText) ||
            (row ? extractSubject(row, sender) : "No subject captured");

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

  function renderList(root) {
    const list = root.querySelector(".rv-list");
    if (!(list instanceof HTMLElement)) return;
    list.innerHTML = "";

    const result = collectMessages();
    const messages = result.items;

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
        const ok = openThread(msg.threadId, msg.href);
        if (!ok) {
          logWarn("Failed to open thread from custom view.", { threadId: msg.threadId });
        }
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
      renderList(root);
      ensureMode();
    } finally {
      state.isApplying = false;
    }
  }

  function startObserver() {
    if (state.observer || !document.body) return;
    state.observer = new MutationObserver(() => {
      if (state.isApplying) return;
      clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        if (state.isApplying) return;
        const hasStyle = Boolean(document.getElementById(STYLE_ID));
        const hasRoot = Boolean(document.getElementById(ROOT_ID));
        if (!hasStyle || !hasRoot) {
          applyReskin();
          return;
        }
        const root = document.getElementById(ROOT_ID);
        if (root instanceof HTMLElement) renderList(root);
      }, 75);
    });
    state.observer.observe(document.body, { childList: true, subtree: true });
  }

  function waitForReady() {
    removeLegacyNodes();
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
