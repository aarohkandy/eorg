(() => {
  "use strict";

  const LEVEL_CONFIG = {
    critical: { label: "Critical", gmailLabel: "Triage/Critical" },
    high: { label: "High", gmailLabel: "Triage/High" },
    medium: { label: "Medium", gmailLabel: "Triage/Medium" },
    low: { label: "Low", gmailLabel: "Triage/Low" },
    fyi: { label: "FYI", gmailLabel: "Triage/FYI" }
  };

  const LEVELS = Object.keys(LEVEL_CONFIG);

  function normalize(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function levelFromText(text) {
    const value = normalize(text).toLowerCase();
    if (!value) return "";
    if (value.includes("triage/critical")) return "critical";
    if (value.includes("triage/high")) return "high";
    if (value.includes("triage/medium")) return "medium";
    if (value.includes("triage/low")) return "low";
    if (value.includes("triage/fyi")) return "fyi";
    return "";
  }

  function detectLevelFromRow(row) {
    if (!(row instanceof HTMLElement)) return "";
    const candidates = [
      row.getAttribute("aria-label"),
      row.getAttribute("title"),
      row.textContent
    ];

    const labelNodes = row.querySelectorAll("[aria-label], [title], span, div");
    for (const node of labelNodes) {
      if (!(node instanceof HTMLElement)) continue;
      const aria = node.getAttribute("aria-label");
      const title = node.getAttribute("title");
      if (aria) candidates.push(aria);
      if (title) candidates.push(title);
      if (node.className && /ar|at|av|xS/i.test(String(node.className))) {
        candidates.push(node.textContent || "");
      }
    }

    for (const text of candidates) {
      const level = levelFromText(text || "");
      if (level) return level;
    }
    return "";
  }

  function dispatchClick(node) {
    if (!(node instanceof HTMLElement)) return;
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  async function waitForSelector(selector, timeoutMs = 2500) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const node = document.querySelector(selector);
      if (node instanceof HTMLElement) return node;
      await sleep(80);
    }
    return null;
  }

  function findRowByThreadId(threadId) {
    if (!threadId) return null;
    return (
      document.querySelector(`[data-thread-id="${CSS.escape(threadId)}"]`) ||
      document.querySelector(`[data-legacy-thread-id="${CSS.escape(threadId)}"]`)
    );
  }

  function normalizedHref(href) {
    const raw = normalize(href);
    if (!raw) return "";
    try {
      return new URL(raw, window.location.origin).toString();
    } catch (_) {
      return raw;
    }
  }

  function findRowByHref(href) {
    const target = normalizedHref(href);
    if (!target) return null;

    const links = Array.from(document.querySelectorAll('a[href], [role="link"][href]'));
    for (const link of links) {
      if (!(link instanceof HTMLElement)) continue;
      const candidate = normalizedHref(link.getAttribute("href") || "");
      if (!candidate) continue;
      if (candidate === target || candidate.endsWith(target) || target.endsWith(candidate)) {
        const row = link.closest('[role="row"], tr, .zA, [data-thread-id], [data-legacy-thread-id]');
        if (row instanceof HTMLElement) return row;
      }
    }
    return null;
  }

  async function selectRow(row) {
    if (!(row instanceof HTMLElement)) return false;
    const checkbox =
      row.querySelector('[role="checkbox"]') ||
      row.querySelector('div[aria-label*="Select"]') ||
      row.querySelector('input[type="checkbox"]');
    if (checkbox instanceof HTMLElement) {
      dispatchClick(checkbox);
      await sleep(120);
      return true;
    }
    dispatchClick(row);
    await sleep(120);
    return true;
  }

  async function openLabelMenu() {
    const trigger =
      document.querySelector('div[gh="mtb"] [aria-label*="Labels"]') ||
      document.querySelector('div[gh="tm"] [aria-label*="Labels"]') ||
      document.querySelector('button[aria-label*="Label"]') ||
      document.querySelector('[role="button"][aria-label*="Label"]');

    if (!(trigger instanceof HTMLElement)) return false;
    dispatchClick(trigger);
    const menu = await waitForSelector('[role="menu"], [role="dialog"]');
    return Boolean(menu);
  }

  async function pickLabelInMenu(labelPath) {
    const menu = document.querySelector('[role="menu"], [role="dialog"]');
    if (!(menu instanceof HTMLElement)) return false;

    const targetLeaf = labelPath.split("/").pop();
    const options = Array.from(menu.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"], div'));
    for (const option of options) {
      if (!(option instanceof HTMLElement)) continue;
      const text = normalize(option.textContent || "");
      if (!text) continue;
      if (text === labelPath || text.endsWith(labelPath) || text === targetLeaf || text.endsWith("/" + targetLeaf)) {
        dispatchClick(option);
        await sleep(140);
        dispatchClick(document.body);
        return true;
      }
    }

    const createButton = options.find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const text = normalize(node.textContent || "").toLowerCase();
      return text.includes("create new") || text === "create";
    });

    if (createButton instanceof HTMLElement) {
      dispatchClick(createButton);
      await sleep(120);
      const input =
        document.querySelector('input[aria-label*="new label"]') ||
        document.querySelector('input[aria-label*="Label name"]') ||
        document.querySelector('input[type="text"]');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.value = labelPath;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await sleep(80);
      }

      const confirm = Array.from(document.querySelectorAll("button, div[role='button']")).find((node) => {
        if (!(node instanceof HTMLElement)) return false;
        const text = normalize(node.textContent || "").toLowerCase();
        return text === "create" || text === "ok";
      });

      if (confirm instanceof HTMLElement) {
        dispatchClick(confirm);
        await sleep(260);
        return true;
      }
    }

    return false;
  }

  async function applyLabelToThread(threadId, level) {
    const config = LEVEL_CONFIG[level];
    if (!config) return false;

    const row = findRowByThreadId(threadId);
    if (!(row instanceof HTMLElement)) return false;

    const existing = detectLevelFromRow(row);
    if (existing) return true;

    const selected = await selectRow(row);
    if (!selected) return false;

    const opened = await openLabelMenu();
    if (!opened) return false;

    const picked = await pickLabelInMenu(config.gmailLabel);
    return picked;
  }

  async function applyLabelToMessage(message, level) {
    const config = LEVEL_CONFIG[level];
    if (!config) return false;

    let row = null;
    if (message && message.row instanceof HTMLElement && message.row.isConnected) {
      row = message.row;
    }
    if (!row && message && message.threadId) {
      row = findRowByThreadId(message.threadId);
    }
    if (!row && message && message.href) {
      row = findRowByHref(message.href);
    }
    if (!(row instanceof HTMLElement)) return false;

    const existing = detectLevelFromRow(row);
    if (existing) return true;

    const selected = await selectRow(row);
    if (!selected) return false;

    const opened = await openLabelMenu();
    if (!opened) return false;

    const picked = await pickLabelInMenu(config.gmailLabel);
    return picked;
  }

  function countLevels(messages) {
    const counts = { critical: 0, high: 0, medium: 0, low: 0, fyi: 0 };
    for (const msg of messages || []) {
      const level = normalize(msg && msg.triageLevel).toLowerCase();
      if (counts[level] >= 0) counts[level] += 1;
    }
    return counts;
  }

  window.ReskinTriage = {
    LEVELS,
    LEVEL_CONFIG,
    detectLevelFromRow,
    applyLabelToThread,
    applyLabelToMessage,
    countLevels
  };
})();
