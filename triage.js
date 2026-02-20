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

  function threadIdVariants(threadId) {
    const raw = normalize(threadId || "");
    if (!raw) return [];
    const out = new Set([raw]);
    const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
    if (noHash) out.add(noHash);
    const withHash = noHash.startsWith("#") ? noHash : `#${noHash}`;
    out.add(withHash);

    if (noHash.startsWith("thread-f:")) {
      const id = noHash.slice("thread-f:".length);
      if (id) {
        out.add(`f:${id}`);
        out.add(`#thread-f:${id}`);
        out.add(`#f:${id}`);
      }
    } else if (noHash.startsWith("f:")) {
      const id = noHash.slice(2);
      if (id) {
        out.add(`thread-f:${id}`);
        out.add(`#thread-f:${id}`);
        out.add(`#f:${id}`);
      }
    }
    return Array.from(out).filter(Boolean);
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function logDebug(message, extra) {
    if (typeof extra === "undefined") {
      console.info(`[reskin][triage] ${message}`);
      return;
    }
    console.info(`[reskin][triage] ${message}`, extra);
  }

  function elementSnapshot(node) {
    if (!(node instanceof HTMLElement)) return null;
    return {
      tag: node.tagName.toLowerCase(),
      role: normalize(node.getAttribute("role") || ""),
      ariaLabel: normalize(node.getAttribute("aria-label") || "").slice(0, 120),
      title: normalize(node.getAttribute("title") || "").slice(0, 120),
      className: normalize(node.className || "").slice(0, 120),
      visible: node.offsetParent !== null,
      connected: node.isConnected
    };
  }

  async function withGmailInteractionScope(task) {
    const body = document.body;
    const root = document.getElementById("reskin-root");
    const hadMode = body instanceof HTMLElement && body.hasAttribute("data-reskin-mode");
    const previousMode = hadMode && body instanceof HTMLElement ? body.getAttribute("data-reskin-mode") : null;
    const previousRootDisplay = root instanceof HTMLElement ? root.style.display : "";
    const previousRootPointer = root instanceof HTMLElement ? root.style.pointerEvents : "";
    if (body instanceof HTMLElement) {
      body.removeAttribute("data-reskin-mode");
    }
    if (root instanceof HTMLElement) {
      root.style.pointerEvents = "none";
      root.style.display = "none";
    }
    try {
      await sleep(140);
      return await task();
    } finally {
      if (root instanceof HTMLElement) {
        root.style.display = previousRootDisplay;
        root.style.pointerEvents = previousRootPointer;
      }
      if (body instanceof HTMLElement && hadMode) {
        body.setAttribute("data-reskin-mode", previousMode || "viewer");
      }
    }
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
    const rect = node.getBoundingClientRect();
    const clientX = rect.left + Math.max(2, Math.min(rect.width - 2, rect.width / 2 || 2));
    const clientY = rect.top + Math.max(2, Math.min(rect.height - 2, rect.height / 2 || 2));
    try {
      node.focus();
      node.click();
    } catch (_) {
      // Fallback to synthetic events.
    }
    node.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, composed: true, clientX, clientY }));
    node.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, composed: true, clientX, clientY }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, composed: true, clientX, clientY }));
  }

  function isRowSelected(row) {
    if (!(row instanceof HTMLElement)) return false;
    const ariaSelected = normalize(row.getAttribute("aria-selected") || "").toLowerCase();
    if (ariaSelected === "true") return true;
    const checkedBox = row.querySelector('[role="checkbox"][aria-checked="true"]');
    if (checkedBox instanceof HTMLElement) return true;
    const input = row.querySelector('input[type="checkbox"]');
    if (input instanceof HTMLInputElement && input.checked) return true;
    return false;
  }

  function checkedCount(root = document) {
    if (!(root instanceof Document || root instanceof HTMLElement)) return 0;
    const ariaChecked = root.querySelectorAll('[role="checkbox"][aria-checked="true"]').length;
    const inputChecked = root.querySelectorAll('input[type="checkbox"]:checked').length;
    return ariaChecked + inputChecked;
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
    const variants = threadIdVariants(threadId);
    if (variants.length === 0) return null;
    for (const candidate of variants) {
      const row =
        document.querySelector(`[data-thread-id="${CSS.escape(candidate)}"]`) ||
        document.querySelector(`[data-legacy-thread-id="${CSS.escape(candidate)}"]`);
      if (row instanceof HTMLElement) return row;
    }
    return null;
  }

  async function waitForAppliedLevel(threadId, href, expectedLevel, fallbackRow) {
    const start = Date.now();
    const timeoutMs = 2200;
    while (Date.now() - start < timeoutMs) {
      let row = null;
      if (threadId) row = findRowByThreadId(threadId);
      if (!row && href) row = findRowByHref(href);
      if (!row && fallbackRow instanceof HTMLElement && fallbackRow.isConnected) row = fallbackRow;
      if (row instanceof HTMLElement) {
        const detected = detectLevelFromRow(row);
        if (detected === expectedLevel) {
          return true;
        }
      }
      await sleep(120);
    }
    return false;
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

  function hashFromHref(href) {
    const raw = normalize(href);
    if (!raw) return "";
    const hashIndex = raw.indexOf("#");
    if (hashIndex >= 0) return raw.slice(hashIndex);
    try {
      const url = new URL(raw, window.location.origin);
      return normalize(url.hash || "");
    } catch (_) {
      return "";
    }
  }

  function hashFromMessage(message) {
    const fromHref = hashFromHref(message && message.href ? message.href : "");
    if (fromHref) return fromHref;
    const threadId = normalize(message && message.threadId ? message.threadId : "");
    if (!threadId) return "";
    if (threadId.startsWith("#")) return threadId;
    if (threadId.startsWith("thread-")) return `#${threadId}`;
    if (threadId.startsWith("thread-f:")) return `#${threadId}`;
    if (threadId.startsWith("f:")) return `#thread-${threadId}`;
    return "";
  }

  async function waitForHash(expectedHash, timeoutMs = 2600) {
    const target = normalize(expectedHash);
    if (!target) return false;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (normalize(window.location.hash || "") === target) return true;
      await sleep(80);
    }
    return false;
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

  async function applyLabelViaThreadView(message, level, labelPath) {
    const threadHash = hashFromMessage(message || {});
    if (!threadHash) {
      logDebug("thread-view fallback skipped", {
        reason: "missing-thread-hash-from-href-and-thread-id",
        threadId: message && message.threadId ? message.threadId : "",
        href: message && message.href ? message.href : "",
        level,
        label: labelPath
      });
      return false;
    }
    const listHash = window.location.hash || "#inbox";
    const startedAt = Date.now();
    let applied = false;
    let finalResult = false;
    try {
      window.location.hash = threadHash;
      const reachedThread = await waitForHash(threadHash, 3200);
      if (!reachedThread) {
        logDebug("thread-view fallback failed", {
          stage: "navigate-thread",
          threadHash,
          currentHash: window.location.hash || "",
          level,
          label: labelPath
        });
        return false;
      }
      await sleep(420);
      const opened = await openLabelMenu();
      if (!opened) {
        logDebug("thread-view fallback failed", {
          stage: "open-menu",
          threadHash,
          level,
          label: labelPath
        });
        return false;
      }
      const picked = await pickLabelInMenu(labelPath);
      if (!picked) {
        logDebug("thread-view fallback failed", {
          stage: "pick-label",
          threadHash,
          level,
          label: labelPath
        });
        return false;
      }
      applied = true;
    } finally {
      window.location.hash = listHash;
      await waitForHash(listHash, 2800);
      await sleep(260);
      const confirmed = applied
        ? await waitForAppliedLevel(
          message && message.threadId ? message.threadId : "",
          message && message.href ? message.href : "",
          level,
          null
        )
        : false;
      if (applied && confirmed) {
        logDebug("thread-view fallback success", {
          threadHash,
          level,
          label: labelPath,
          durationMs: Date.now() - startedAt
        });
        finalResult = true;
      } else if (applied && !confirmed) {
        logDebug("thread-view fallback uncertain", {
          stage: "post-return-confirm-failed",
          threadHash,
          threadId: message && message.threadId ? message.threadId : "",
          href: message && message.href ? message.href : "",
          level,
          label: labelPath,
          durationMs: Date.now() - startedAt
        });
      }
    }
    return finalResult;
  }

  async function selectRow(row) {
    if (!(row instanceof HTMLElement)) return false;
    row.scrollIntoView({ block: "center", inline: "nearest" });
    await sleep(60);
    const hashBefore = window.location.hash || "";
    const selectionBefore = isRowSelected(row);
    const globalCheckedBefore = checkedCount(document);
    const attempts = [];

    const rawCandidateSources = [
      ...Array.from(row.querySelectorAll('td.oZ-x3 div[role="checkbox"]')),
      ...Array.from(row.querySelectorAll('.oZ-jc[role="checkbox"]')),
      ...Array.from(row.querySelectorAll('div[role="checkbox"]')),
      ...Array.from(row.querySelectorAll('input[type="checkbox"][name="t"]')),
      ...Array.from(row.querySelectorAll('div[aria-label*="Select"]'))
    ];
    const rawCandidates = rawCandidateSources.filter((node) => node instanceof HTMLElement);
    const seen = new Set();
    const checkboxCandidates = rawCandidates.filter((node) => {
      if (!(node instanceof HTMLElement)) return false;
      if (seen.has(node)) return false;
      seen.add(node);
      return true;
    });

    for (const checkbox of checkboxCandidates) {
      if (!(checkbox instanceof HTMLElement)) continue;
      const attempt = {
        via: "checkbox-only",
        target: elementSnapshot(checkbox),
        globalCheckedBefore: checkedCount(document)
      };
      const localCheckedBefore = normalize(checkbox.getAttribute("aria-checked") || "").toLowerCase();
      dispatchClick(checkbox);
      await sleep(180);
      const localCheckedAfter = normalize(checkbox.getAttribute("aria-checked") || "").toLowerCase();
      attempt.selectionAfter = isRowSelected(row);
      attempt.globalCheckedAfter = checkedCount(document);
      attempt.localCheckedBefore = localCheckedBefore;
      attempt.localCheckedAfter = localCheckedAfter;
      attempt.localBecameChecked = localCheckedAfter === "true" && localCheckedBefore !== "true";
      attempt.hashChanged = (window.location.hash || "") !== hashBefore;
      attempt.checkboxTitle = normalize(checkbox.getAttribute("title") || "");
      attempt.checkboxLabel = normalize(checkbox.getAttribute("aria-label") || "");
      attempts.push(attempt);

      if (attempt.hashChanged) {
        logDebug("selectRow failed", {
          reason: "opened-thread-unexpectedly",
          hashBefore,
          hashAfter: window.location.hash || "",
          selectionBefore,
          globalCheckedBefore,
          checkboxCandidateCount: checkboxCandidates.length,
          attempts,
          row: elementSnapshot(row)
        });
        return false;
      }

      const rowSelected = isRowSelected(row);
      const globalMoved = attempt.globalCheckedAfter > attempt.globalCheckedBefore;
      const localMoved = attempt.localBecameChecked;
      if (rowSelected || globalMoved || localMoved) {
        logDebug("selectRow success", {
          method: "checkbox-only",
          selectionBefore,
          globalCheckedBefore,
          globalCheckedAfter: checkedCount(document),
          successBy: rowSelected ? "row-selected" : (globalMoved ? "global-checked-count" : "local-checkbox"),
          checkboxCandidateCount: checkboxCandidates.length,
          attempts,
          row: elementSnapshot(row)
        });
        return true;
      }
    }

    logDebug("selectRow failed", {
      reason: "selection-not-confirmed",
      selectionBefore,
      selectionAfter: isRowSelected(row),
      globalCheckedBefore,
      globalCheckedAfter: checkedCount(document),
      checkboxCandidateCount: checkboxCandidates.length,
      rawCheckboxCount: rawCandidates.length,
      attempts,
      row: elementSnapshot(row)
    });
    return false;
  }

  async function openLabelMenu() {
    const triggerSelectors = [
      'div[gh="mtb"] [aria-label*="Label"]',
      'div[gh="tm"] [aria-label*="Label"]',
      '[aria-keyshortcuts="l"]',
      '[aria-keyshortcuts="L"]',
      'button[aria-label*="Label"]',
      '[role="button"][aria-label*="Label"]',
      '[data-tooltip*="Label"]',
      '[aria-label*="Label as"]',
      '[aria-label^="Labels"]',
      '[aria-label="Labels"]'
    ];

    const selectorResults = [];
    for (const selector of triggerSelectors) {
      const trigger = document.querySelector(selector);
      const found = trigger instanceof HTMLElement;
      selectorResults.push({ selector, found, trigger: elementSnapshot(trigger) });
      if (!(trigger instanceof HTMLElement)) continue;
      dispatchClick(trigger);
      const menu = await waitForSelector('[role="menu"], [role="dialog"], input[aria-label*="Search labels"]', 2200);
      if (menu) {
        logDebug("openLabelMenu success", {
          method: "trigger",
          selector,
          menu: elementSnapshot(menu),
          selectorResults
        });
        return true;
      }
    }

    // Fallback: Gmail keyboard shortcut "l" (label dialog), if available.
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "l", code: "KeyL", bubbles: true }));
    document.dispatchEvent(new KeyboardEvent("keyup", { key: "l", code: "KeyL", bubbles: true }));
    const keyboardMenu = await waitForSelector(
      '[role="menu"], [role="dialog"], input[aria-label*="Search labels"], input[aria-label*="Label"]',
      2200
    );
    if (keyboardMenu) {
      logDebug("openLabelMenu success", {
        method: "keyboard-l",
        menu: elementSnapshot(keyboardMenu),
        selectorResults
      });
      return true;
    }
    logDebug("openLabelMenu failed", {
      method: "keyboard-l",
      selectorResults,
      activeElement: elementSnapshot(document.activeElement)
    });
    return Boolean(keyboardMenu);
  }

  async function pickLabelInMenu(labelPath) {
    const menu =
      document.querySelector('[role="menu"], [role="dialog"]') ||
      document.querySelector('[aria-label*="Label as"], [aria-label*="Labels"]');
    if (!(menu instanceof HTMLElement)) {
      logDebug("Label menu/dialog is missing before picking", { labelPath });
      return false;
    }

    const targetLeaf = labelPath.split("/").pop();
    const options = Array.from(
      menu.querySelectorAll('[role="menuitemcheckbox"], [role="menuitem"], [role="option"], [aria-checked]')
    );
    const optionSamples = options.slice(0, 25).map((option) => {
      if (!(option instanceof HTMLElement)) return null;
      return {
        text: normalize(option.textContent || "").slice(0, 120),
        role: normalize(option.getAttribute("role") || ""),
        checked: normalize(option.getAttribute("aria-checked") || "")
      };
    }).filter(Boolean);
    for (const option of options) {
      if (!(option instanceof HTMLElement)) continue;
      const text = normalize(option.textContent || "");
      if (!text) continue;
      if (text === labelPath || text.endsWith(labelPath) || text === targetLeaf || text.endsWith("/" + targetLeaf)) {
        const clickable =
          option.querySelector('[role="checkbox"], input[type="checkbox"], [role="menuitemcheckbox"]') || option;
        const stateNode =
          clickable instanceof HTMLElement && clickable.hasAttribute("aria-checked") ? clickable : option;
        const beforeChecked = normalize(stateNode.getAttribute("aria-checked") || "").toLowerCase();
        if (clickable instanceof HTMLElement) {
          dispatchClick(clickable);
        } else {
          dispatchClick(option);
        }
        await sleep(220);
        const afterChecked = normalize(stateNode.getAttribute("aria-checked") || "").toLowerCase();
        const becameChecked = afterChecked === "true";
        const toggled = beforeChecked !== afterChecked && afterChecked.length > 0;
        const success = becameChecked || toggled || beforeChecked === "true";
        logDebug("pickLabelInMenu result", {
          labelPath,
          targetLeaf,
          optionsCount: options.length,
          matchedText: text,
          beforeChecked,
          afterChecked,
          success,
          optionSamples
        });
        if (!success) return false;
        dispatchClick(document.body);
        return true;
      }
    }

    const searchInput = menu.querySelector('input[aria-label*="Search"], input[aria-label*="label"], input[type="text"]');
    if (searchInput instanceof HTMLInputElement) {
      searchInput.focus();
      searchInput.value = labelPath;
      searchInput.dispatchEvent(new Event("input", { bubbles: true }));
      await sleep(220);
      searchInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
      searchInput.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
      await sleep(320);
      logDebug("pickLabelInMenu search-submit", {
        labelPath,
        inputLabel: normalize(searchInput.getAttribute("aria-label") || ""),
        menuStillOpen: Boolean(document.querySelector('[role="menu"], [role="dialog"]'))
      });
      return true;
    }

    const createButton = Array.from(menu.querySelectorAll("button, [role='button'], div")).find((node) => {
      if (!(node instanceof HTMLElement)) return false;
      const text = normalize(node.textContent || "").toLowerCase();
      return text.includes("create new") || text === "create";
    });

    if (createButton instanceof HTMLElement) {
      logDebug("Label not found, trying create flow", { labelPath });
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
        logDebug("Create label flow submitted", { labelPath });
        return true;
      }
    }

    logDebug("pickLabelInMenu failed", {
      labelPath,
      targetLeaf,
      optionsCount: options.length,
      optionSamples
    });
    return false;
  }

  async function applyLabelToThread(threadId, level) {
    const config = LEVEL_CONFIG[level];
    if (!config) {
      logDebug("Invalid triage level for thread apply", { threadId, level });
      return false;
    }

    return await withGmailInteractionScope(async () => {
      const row = findRowByThreadId(threadId);
      if (!(row instanceof HTMLElement)) {
        logDebug("Thread row not found for applyLabelToThread", { threadId, level, label: config.gmailLabel });
        return false;
      }

      const existing = detectLevelFromRow(row);
      if (existing) {
        logDebug("Thread already has triage label", { threadId, existing });
        return true;
      }

      const selected = await selectRow(row);
      if (!selected) {
        logDebug("applyLabelToThread failed", { stage: "select-row", threadId, level, label: config.gmailLabel });
        return false;
      }

      const opened = await openLabelMenu();
      if (!opened) {
        logDebug("applyLabelToThread failed", { stage: "open-menu", threadId, level, label: config.gmailLabel });
        return false;
      }

      const picked = await pickLabelInMenu(config.gmailLabel);
      if (!picked) {
        logDebug("applyLabelToThread failed", { stage: "pick-label", threadId, level, label: config.gmailLabel });
        return false;
      }
      const confirmed = await waitForAppliedLevel(threadId, "", level, row);
      if (!confirmed) {
        logDebug("applyLabelToThread failed", { stage: "confirm-label", threadId, level, label: config.gmailLabel });
      }
      logDebug("applyLabelToThread finished", {
        threadId,
        level,
        label: config.gmailLabel,
        picked,
        confirmed
      });
      return confirmed;
    });
  }

  async function applyLabelToMessage(message, level) {
    const config = LEVEL_CONFIG[level];
    if (!config) {
      logDebug("Invalid triage level for message apply", { level, message });
      return false;
    }

    return await withGmailInteractionScope(async () => {
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
      if (!(row instanceof HTMLElement)) {
        logDebug("Message row not found", {
          threadId: message && message.threadId ? message.threadId : "",
          href: message && message.href ? message.href : "",
          level,
          label: config.gmailLabel
        });
        return false;
      }

      const existing = detectLevelFromRow(row);
      if (existing) {
        logDebug("Message already has triage label", {
          threadId: message && message.threadId ? message.threadId : "",
          existing
        });
        return true;
      }

      const selected = await selectRow(row);
      if (!selected) {
        logDebug("applyLabelToMessage fallback", {
          stage: "select-row-failed-trying-thread-view",
          threadId: message && message.threadId ? message.threadId : "",
          href: message && message.href ? message.href : "",
          level,
          label: config.gmailLabel
        });
        const fallbackOk = await applyLabelViaThreadView(message, level, config.gmailLabel);
        if (fallbackOk) {
          return true;
        }
        logDebug("applyLabelToMessage failed", {
          stage: "select-row",
          threadId: message && message.threadId ? message.threadId : "",
          level,
          label: config.gmailLabel
        });
        return false;
      }

      const opened = await openLabelMenu();
      if (!opened) {
        logDebug("applyLabelToMessage failed", {
          stage: "open-menu",
          threadId: message && message.threadId ? message.threadId : "",
          level,
          label: config.gmailLabel
        });
        return false;
      }

      const picked = await pickLabelInMenu(config.gmailLabel);
      if (!picked) {
        logDebug("applyLabelToMessage failed", {
          stage: "pick-label",
          threadId: message && message.threadId ? message.threadId : "",
          level,
          label: config.gmailLabel,
          picked: false,
          confirmed: false
        });
        return false;
      }
      const confirmed = await waitForAppliedLevel(
        message && message.threadId ? message.threadId : "",
        message && message.href ? message.href : "",
        level,
        row
      );
      if (!confirmed) {
        logDebug("applyLabelToMessage failed", {
          stage: "confirm-label",
          threadId: message && message.threadId ? message.threadId : "",
          level,
          label: config.gmailLabel
        });
      }
      logDebug("applyLabelToMessage finished", {
        threadId: message && message.threadId ? message.threadId : "",
        level,
        label: config.gmailLabel,
        picked,
        confirmed
      });
      return confirmed;
    });
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
