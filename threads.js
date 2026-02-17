(() => {
  "use strict";

  // Targets Gmail conversation links because they are the most reliable clickable representation of a message thread.
  const THREAD_LINK_SELECTORS = [
    '[role="main"] a[href*="#inbox/"]',
    '[role="main"] a[href*="#all/"]',
    '[role="main"] a[href*="#label/"]',
    '[role="main"] [role="link"][href*="#"]'
  ];

  // Targets thread rows by stable thread-id attributes because these persist across Gmail updates better than classes.
  const THREAD_ROW_SELECTORS = [
    '[role="main"] tr[role="row"][data-thread-id]',
    '[role="main"] tr[role="row"][data-legacy-thread-id]',
    '[role="main"] tr[data-thread-id]',
    '[role="main"] tr[data-legacy-thread-id]',
    '[role="main"] [role="row"][data-thread-id]',
    '[role="main"] [role="row"][data-legacy-thread-id]',
    '[role="main"] [data-thread-id]',
    '[role="main"] [data-legacy-thread-id]'
  ];

  // Targets likely conversation text sources by semantic attributes and accessible labels.
  const TITLE_HINT_SELECTORS = [
    '[role="link"][title]',
    '[role="link"] span[title]',
    'span[email]',
    '[role="link"] span',
    'span[title]'
  ];

  const NOISE_TEXT = new Set(["starred", "inbox", "important", "unread", "read"]);

  // Derives a stable-ish thread key from Gmail hash URLs so links can be deduplicated and reopened.
  function getThreadKeyFromHref(href) {
    if (!href) return null;
    const hashIndex = href.indexOf("#");
    if (hashIndex === -1) return null;
    const hash = href.slice(hashIndex + 1);
    const parts = hash.split("/");
    const maybeId = parts[parts.length - 1];
    if (!maybeId || maybeId.length < 6) return null;
    return maybeId;
  }

  // Selects all rows with fallbacks and warns if Gmail structure differs.
  function selectAllRows() {
    for (const selector of THREAD_ROW_SELECTORS) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length > 0) return nodes;
    }
    console.warn("[reskin] No thread rows found using fallback selectors.");
    return [];
  }

  // Normalizes candidate text by trimming and collapsing spaces before ranking.
  function normalizeText(text) {
    return (text || "").replace(/\s+/g, " ").trim();
  }

  // Filters out obvious non-subject labels from Gmail row metadata.
  function isUsefulTitle(text) {
    if (!text) return false;
    const lower = text.toLowerCase();
    if (NOISE_TEXT.has(lower)) return false;
    if (lower.length < 3) return false;
    return true;
  }

  // Extracts readable thread title from aria/title/text sources with guarded fallbacks.
  function extractThreadTitle(row) {
    const aria = normalizeText(row.getAttribute("aria-label"));
    if (isUsefulTitle(aria)) return aria;

    for (const selector of TITLE_HINT_SELECTORS) {
      const node = row.querySelector(selector);
      if (!node) continue;
      const fromTitle = normalizeText(node.getAttribute("title"));
      if (isUsefulTitle(fromTitle)) return fromTitle;

      const text = normalizeText(node.textContent);
      if (isUsefulTitle(text)) return text;
    }

    const rowText = normalizeText(row.textContent);
    if (isUsefulTitle(rowText)) {
      return rowText.slice(0, 140);
    }

    return "Conversation";
  }

  // Extracts title from an anchor first because Gmail places message text in its link subtree.
  function extractTitleFromLink(link) {
    const aria = normalizeText(link.getAttribute("aria-label"));
    if (isUsefulTitle(aria)) return aria;

    const titleAttr = normalizeText(link.getAttribute("title"));
    if (isUsefulTitle(titleAttr)) return titleAttr;

    const text = normalizeText(link.textContent);
    if (isUsefulTitle(text)) return text;

    return null;
  }

  // Builds thread models from Gmail conversation links to maximize title accuracy across layout variants.
  function collectFromLinks(limit, seen) {
    const items = [];

    for (const selector of THREAD_LINK_SELECTORS) {
      const links = Array.from(document.querySelectorAll(selector));
      if (links.length === 0) continue;

      for (const link of links) {
        if (!(link instanceof HTMLAnchorElement)) continue;
        const href = link.getAttribute("href") || "";
        const key = getThreadKeyFromHref(href);
        if (!key || seen.has(key)) continue;

        const title = extractTitleFromLink(link);
        if (!isUsefulTitle(title)) continue;

        seen.add(key);
        items.push({ id: key, title, href });
        if (items.length >= limit) return items;
      }
    }

    return items;
  }

  // Builds thread models from Gmail DOM without mutating Gmail nodes to keep app logic safe.
  function collectThreads(limit = 40) {
    const items = [];
    const seen = new Set();
    const linkItems = collectFromLinks(limit, seen);
    items.push(...linkItems);
    if (items.length >= limit) return items;

    const rows = selectAllRows();

    for (const row of rows) {
      if (!row || !(row instanceof HTMLElement)) continue;

      const threadId = row.getAttribute("data-thread-id") || row.getAttribute("data-legacy-thread-id");
      if (!threadId) continue;
      if (seen.has(threadId)) continue;
      seen.add(threadId);

      const title = extractThreadTitle(row);
      if (!isUsefulTitle(title)) continue;

      items.push({
        id: threadId,
        title
      });

      if (items.length >= limit) break;
    }

    return items;
  }

  // Opens a thread by clicking Gmail's own row element so Gmail navigation state remains correct.
  function openThread(threadId) {
    if (!threadId) return false;

    const link =
      document.querySelector(`[role="main"] a[href$="/${CSS.escape(threadId)}"]`) ||
      document.querySelector(`[role="main"] a[href*="/${CSS.escape(threadId)}"]`);
    if (link instanceof HTMLElement) {
      link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return true;
    }

    const row =
      document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`) ||
      document.querySelector(`[data-legacy-thread-id="${CSS.escape(threadId)}"]`);

    if (!row) {
      console.warn("[reskin] Thread row missing for id:", threadId);
      return false;
    }

    row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    row.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    return true;
  }

  // Renders resilient custom list UI outside Gmail containers and tags all nodes for cleanup/debugging.
  function renderThreadList(container) {
    if (!container) return;
    container.innerHTML = "";

    const threads = collectThreads();
    if (threads.length === 0) {
      const empty = document.createElement("div");
      empty.dataset.reskin = "true";
      empty.className = "reskin-empty-state";
      empty.textContent = "No threads detected yet.";
      container.appendChild(empty);
      return;
    }

    for (const thread of threads) {
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.reskin = "true";
      button.className = "reskin-thread-item";
      button.dataset.threadId = thread.id;
      button.textContent = thread.title;
      button.addEventListener("click", () => {
        openThread(thread.id);
      });
      container.appendChild(button);
    }
  }

  window.ReskinThreads = { collectThreads, renderThreadList, openThread };
})();
