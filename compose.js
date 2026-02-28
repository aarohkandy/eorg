(() => {
  "use strict";

  // Temporary safety switch: keep a callable legacy path for quick rollback.
  const ENABLE_HARDENED_REPLY_SEND = true;
  const DEFAULT_REPLY_TIMEOUT_MS = 10000;
  const DEFAULT_SEND_VERIFY_TIMEOUT_MS = 7000;
  const REPLY_DEBUG_STORAGE_KEY = "reskin_reply_debug_v1";
  let lastReplyDebug = null;

  // Targets Gmail action controls using stable accessibility attributes because class names are obfuscated.
  const COMPOSE_BUTTON_SELECTORS = [
    'div[role="button"][gh="cm"]',
    'div[role="button"][aria-label="Compose"]',
    'div[role="button"][aria-label*="Compose"]'
  ];

  const COMPOSE_DIALOG_SELECTORS = ['div[role="dialog"]'];

  // Targets recipient fields using input semantics rather than classes for account-variant tolerance.
  const TO_FIELD_SELECTORS = [
    'input[aria-label^="To"]',
    'textarea[name="to"]',
    'input[name="to"]'
  ];

  // Targets subject input by Gmail's semantic name to avoid brittle visual selectors.
  const SUBJECT_FIELD_SELECTORS = [
    'input[name="subjectbox"]',
    'input[aria-label="Subject"]'
  ];

  // Targets compose body by role/contenteditable semantics because these are stable compared to classes.
  const BODY_FIELD_SELECTORS = [
    'div[aria-label="Message Body"][contenteditable="true"]',
    'div[contenteditable="true"][aria-label="Message Body"]',
    'div[g_editable="true"][role="textbox"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][role="textbox"]',
    'div[contenteditable="true"]'
  ];

  // Reply path must be stricter so we never type into an unrelated editable region.
  const REPLY_BODY_FIELD_SELECTORS = [
    'div[aria-label][contenteditable="true"][role="textbox"]',
    'div[g_editable="true"][role="textbox"]',
    'div[role="textbox"][g_editable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"][g_editable="true"]'
  ];

  const LEGACY_SEND_BUTTON_SELECTORS = [
    'div[role="button"][data-tooltip^="Send"]',
    'div[role="button"][data-tooltip="Send"]',
    'div[role="button"][aria-label^="Send"]',
    'div[role="button"][aria-label="Send"]',
    'button[aria-label^="Send"]',
    'button[aria-label="Send"]',
    '[data-tooltip="Send"]',
    '[aria-label="Send"]'
  ];

  // Structural pattern from InboxSDK internals: avoids locale-specific labels.
  const STRUCTURAL_SEND_BUTTON_SELECTORS = [
    '.IZ .Up div > div[role="button"]:not(.Uo):not([aria-haspopup=true]):not([class^="inboxsdk_"])',
    '.IZ .Up div > button[role="button"]:not([aria-haspopup=true])',
    '.IZ .Up [role="button"]:not(.Uo):not([aria-haspopup=true])'
  ];

  const INLINE_REPLY_ROOT_SELECTORS = [
    '.ip.adB .M9',
    '.M9'
  ];

  // Selects first available element from fallbacks and logs if Gmail structure differs.
  function selectFirst(root, selectors, label) {
    for (const selector of selectors) {
      const node = root.querySelector(selector);
      if (node) return node;
    }
    console.warn(`[reskin] Missing ${label}. Selectors:`, selectors);
    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function replyDebugEnabled() {
    try {
      if (globalThis.__RESKIN_REPLY_DEBUG === true) return true;
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(REPLY_DEBUG_STORAGE_KEY) === "1";
      }
    } catch (_) {
      // ignore storage failures
    }
    return false;
  }

  function setReplyDebugEnabled(enabled) {
    const next = Boolean(enabled);
    try {
      globalThis.__RESKIN_REPLY_DEBUG = next;
      if (typeof localStorage !== "undefined") {
        localStorage.setItem(REPLY_DEBUG_STORAGE_KEY, next ? "1" : "0");
      }
    } catch (_) {
      // ignore storage failures
    }
    return next;
  }

  function shortText(value, max = 120) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    if (!text) return "";
    return text.length > max ? `${text.slice(0, max)}…` : text;
  }

  function elementSnapshot(node) {
    if (!(node instanceof HTMLElement)) return null;
    const rect = node.getBoundingClientRect();
    return {
      tag: node.tagName.toLowerCase(),
      id: shortText(node.id || "", 40),
      className: shortText(node.className || "", 80),
      role: shortText(node.getAttribute("role") || "", 40),
      ariaLabel: shortText(node.getAttribute("aria-label") || "", 80),
      tooltip: shortText(node.getAttribute("data-tooltip") || "", 80),
      connected: node.isConnected,
      visible: isVisible(node),
      rect: {
        w: Math.round(rect.width || 0),
        h: Math.round(rect.height || 0)
      }
    };
  }

  function setLastReplyDebug(payload) {
    const next = payload && typeof payload === "object" ? { ...payload } : null;
    lastReplyDebug = next;
    try {
      globalThis.__RESKIN_LAST_REPLY_DEBUG = next;
    } catch (_) {
      // ignore
    }
    return next;
  }

  function logReplyDebug(stage, details, force = false) {
    if (!force && !replyDebugEnabled()) return;
    const label = shortText(stage || "stage", 80);
    if (typeof details === "undefined") {
      console.info(`[reskin][reply-debug] ${label}`);
      return;
    }
    console.info(`[reskin][reply-debug] ${label}`, details);
  }

  // Temporarily reveals Gmail DOM while automation runs because the reskin hides native nodes.
  async function withNativeGmailSurface(task) {
    const html = document.documentElement;
    const body = document.body;
    const root = document.getElementById("reskin-root");

    const hadHtmlMode = html instanceof HTMLElement && html.hasAttribute("data-reskin-mode");
    const hadBodyMode = body instanceof HTMLElement && body.hasAttribute("data-reskin-mode");
    const previousHtmlMode = hadHtmlMode && html instanceof HTMLElement ? html.getAttribute("data-reskin-mode") : "";
    const previousBodyMode = hadBodyMode && body instanceof HTMLElement ? body.getAttribute("data-reskin-mode") : "";
    const previousRootDisplay = root instanceof HTMLElement ? root.style.display : "";
    const previousRootPointer = root instanceof HTMLElement ? root.style.pointerEvents : "";

    if (html instanceof HTMLElement) html.removeAttribute("data-reskin-mode");
    if (body instanceof HTMLElement) body.removeAttribute("data-reskin-mode");
    if (root instanceof HTMLElement) {
      root.style.display = "none";
      root.style.pointerEvents = "none";
    }

    try {
      await sleep(90);
      return await task();
    } finally {
      if (root instanceof HTMLElement) {
        root.style.display = previousRootDisplay;
        root.style.pointerEvents = previousRootPointer;
      }

      if (html instanceof HTMLElement) {
        if (hadHtmlMode) html.setAttribute("data-reskin-mode", previousHtmlMode || "viewer");
        else html.removeAttribute("data-reskin-mode");
      }
      if (body instanceof HTMLElement) {
        if (hadBodyMode) body.setAttribute("data-reskin-mode", previousBodyMode || "viewer");
        else body.removeAttribute("data-reskin-mode");
      }
    }
  }

  function isVisible(node) {
    if (!(node instanceof HTMLElement)) return false;
    if (!node.isConnected) return false;
    const style = window.getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return false;
    if (node.offsetParent !== null) return true;
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function asResult(ok, stage, reason = "") {
    const out = { ok: Boolean(ok), stage: String(stage || "unknown") };
    if (!ok && reason) out.reason = String(reason);
    return out;
  }

  function normalizeReplyOptions(opts) {
    if (!opts || typeof opts !== "object") {
      return {
        threadId: "",
        mailbox: "",
        threadHintHref: "",
        conversationKey: "",
        contactEmail: "",
        activeAccountEmail: "",
        forceThreadContext: true,
        timeoutMs: DEFAULT_REPLY_TIMEOUT_MS
      };
    }
    const timeoutMs = Number(opts.timeoutMs);
    return {
      threadId: String(opts.threadId || ""),
      mailbox: String(opts.mailbox || ""),
      threadHintHref: String(opts.threadHintHref || ""),
      conversationKey: String(opts.conversationKey || ""),
      contactEmail: String(opts.contactEmail || ""),
      activeAccountEmail: String(opts.activeAccountEmail || ""),
      forceThreadContext: opts.forceThreadContext === false ? false : true,
      timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? Math.min(30000, Math.max(2000, timeoutMs)) : DEFAULT_REPLY_TIMEOUT_MS
    };
  }

  function dispatchMouseSequence(element) {
    if (!(element instanceof HTMLElement)) return false;
    const rect = element.getBoundingClientRect();
    const clientX = rect.left + Math.max(1, Math.min(rect.width - 1, rect.width / 2 || 1));
    const clientY = rect.top + Math.max(1, Math.min(rect.height - 1, rect.height / 2 || 1));
    const base = { bubbles: true, cancelable: true, composed: true, clientX, clientY };
    element.dispatchEvent(new MouseEvent("mousedown", base));
    element.dispatchEvent(new MouseEvent("mouseup", base));
    element.dispatchEvent(new MouseEvent("click", base));
    element.dispatchEvent(new MouseEvent("mouseleave", base));
    element.dispatchEvent(new MouseEvent("mouseout", base));
    try {
      element.blur();
    } catch (_) {
      // ignore
    }
    return true;
  }

  function findComposeDialog() {
    for (const sel of COMPOSE_DIALOG_SELECTORS) {
      const dialogs = Array.from(document.querySelectorAll(sel));
      for (const dialog of dialogs) {
        if (!(dialog instanceof HTMLElement)) continue;
        if (!isVisible(dialog)) continue;
        const body = findBodyInRoot(dialog);
        if (body) return dialog;
      }
    }
    return null;
  }

  // Waits for compose dialog using polling + observer because Gmail mounts compose asynchronously.
  function waitForComposeDialog(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const tryResolve = () => {
        const dialog = findComposeDialog();
        if (dialog) {
          cleanup();
          resolve(dialog);
          return true;
        }
        return false;
      };

      const interval = setInterval(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          resolve(null);
        }
      }, 200);

      const observer = new MutationObserver(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          resolve(null);
        }
      });

      const cleanup = () => {
        clearInterval(interval);
        observer.disconnect();
      };

      observer.observe(document.body, { childList: true, subtree: true });
      tryResolve();
    });
  }

  // Uses native input/textarea value setter and input event to update Gmail's React-like listeners correctly.
  function setNativeFieldValue(element, value) {
    if (!element) return false;
    const isTextArea = element instanceof HTMLTextAreaElement;
    const proto = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const descriptor = Object.getOwnPropertyDescriptor(proto, "value");

    if (!descriptor || typeof descriptor.set !== "function") {
      console.warn("[reskin] Unable to find native value setter for field.");
      return false;
    }

    descriptor.set.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }

  // Updates contenteditable message body with input events so Gmail marks draft state correctly.
  function setContentEditableValue(element, value) {
    if (!element) return false;
    element.focus();
    element.textContent = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }

  // Triggers compose open via Gmail's own button to keep all internal state transitions intact.
  async function openComposeDialog() {
    const composeButton = selectFirst(document, COMPOSE_BUTTON_SELECTORS, "compose button");
    if (!composeButton) return null;
    dispatchMouseSequence(composeButton);
    return waitForComposeDialog();
  }

  // Fills compose fields and clicks native send to avoid relying on unsupported Gmail internals.
  async function sendThroughGmail({ to, subject, body }) {
    const dialog = await openComposeDialog();
    if (!dialog) {
      console.warn("[reskin] Compose dialog did not appear.");
      return false;
    }

    const toField = selectFirst(dialog, TO_FIELD_SELECTORS, "recipient field");
    const subjectField = selectFirst(dialog, SUBJECT_FIELD_SELECTORS, "subject field");
    const bodyField = selectFirst(dialog, BODY_FIELD_SELECTORS, "message body");

    if (!toField || !subjectField || !bodyField) return false;

    toField.focus();
    setNativeFieldValue(toField, to || "");
    subjectField.focus();
    setNativeFieldValue(subjectField, subject || "");
    bodyField.focus();
    setContentEditableValue(bodyField, body || "");

    const sendButton = findSendInRoot(dialog);
    if (!sendButton) return false;

    dispatchMouseSequence(sendButton);
    return true;
  }

  const REPLY_BUTTON_SELECTORS = [
    '[data-tooltip="Reply"]',
    '[aria-label="Reply"]',
    'div[role="button"][data-tooltip^="Reply"]',
    'span[role="button"][data-tooltip^="Reply"]',
    'div[role="button"][aria-label="Reply"]',
    '.ams.bkH',
    '[data-tooltip="Reply to all"]',
    'span[role="button"][aria-label="Reply"]',
    '[role="button"][aria-label*="Reply"]',
    '[role="button"][data-tooltip*="Reply"]',
    'button[aria-label*="Reply"]',
    '[gh="rr"]'
  ];

  function getMainRoot(doc = document) {
    return (doc.querySelector('[role="main"]') || doc.body);
  }

  function findReplyButton() {
    const main = getMainRoot(document);
    const candidates = [];
    for (const sel of REPLY_BUTTON_SELECTORS) {
      const buttons = Array.from(main.querySelectorAll(sel));
      for (let i = buttons.length - 1; i >= 0; i -= 1) {
        const btn = buttons[i];
        if (!(btn instanceof HTMLElement)) continue;
        if (!isVisible(btn)) continue;
        candidates.push(btn);
      }
    }
    if (candidates.length === 0) return null;

    const seen = new Set();
    const deduped = candidates.filter((btn) => {
      if (seen.has(btn)) return false;
      seen.add(btn);
      return true;
    });

    const scored = deduped
      .map((btn) => {
        const label = shortText(
          `${btn.getAttribute("aria-label") || ""} ${btn.getAttribute("data-tooltip") || ""} ${btn.textContent || ""}`,
          180
        ).toLowerCase();
        let score = 1;
        if (/\breply\b/.test(label)) score += 4;
        if (/\breply all\b/.test(label)) score += 2;
        if (/\bforward\b/.test(label)) score -= 3;
        if (/\bsend\b/.test(label)) score -= 3;
        if (btn.closest(".M9")) score -= 4;
        if (btn.closest('[role="menu"], [role="dialog"]')) score -= 2;
        return { btn, score };
      })
      .sort((a, b) => b.score - a.score);

    return scored[0] ? scored[0].btn : null;
  }

  function triggerReplyShortcut() {
    const target = document.body || document.documentElement;
    if (!(target instanceof HTMLElement)) return false;
    target.focus();
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true }));
    target.dispatchEvent(new KeyboardEvent("keyup", { key: "r", code: "KeyR", bubbles: true }));
    return true;
  }

  function findBodyInRoot(root) {
    for (const sel of BODY_FIELD_SELECTORS) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function findReplyBodyInRoot(root) {
    for (const sel of REPLY_BODY_FIELD_SELECTORS) {
      const el = root.querySelector(sel);
      if (isVisible(el)) return el;
    }
    for (const sel of BODY_FIELD_SELECTORS) {
      const el = root.querySelector(sel);
      if (!(el instanceof HTMLElement)) continue;
      if (!isVisible(el)) continue;
      if (!el.isContentEditable && (el.getAttribute("contenteditable") || "").toLowerCase() !== "true") continue;
      return el;
    }
    return null;
  }

  function collectReplyBodyFields(scopeRoot) {
    const out = [];
    const seen = new Set();
    const selectors = [...REPLY_BODY_FIELD_SELECTORS, ...BODY_FIELD_SELECTORS];
    for (const sel of selectors) {
      for (const node of Array.from(scopeRoot.querySelectorAll(sel))) {
        if (!(node instanceof HTMLElement)) continue;
        if (seen.has(node)) continue;
        if (!isVisible(node)) continue;
        if (!node.isContentEditable && (node.getAttribute("contenteditable") || "").toLowerCase() !== "true") continue;
        seen.add(node);
        out.push(node);
      }
    }
    return out;
  }

  function findReplyComposeRootIn(scopeRoot) {
    for (const sel of INLINE_REPLY_ROOT_SELECTORS) {
      const roots = Array.from(scopeRoot.querySelectorAll(sel));
      for (let i = roots.length - 1; i >= 0; i -= 1) {
        const root = roots[i];
        if (!(root instanceof HTMLElement)) continue;
        if (!isVisible(root)) continue;
        const bodyField = findReplyBodyInRoot(root);
        if (!bodyField) continue;
        const sendButton = findSendInRoot(root);
        if (!sendButton) continue;
        return { root, bodyField, sendButton, replyContainer: root.closest(".ip") };
      }
    }

    const bodyFields = collectReplyBodyFields(scopeRoot);
    for (const bodyField of bodyFields) {
      let parent = bodyField;
      let depth = 0;
      while (parent instanceof HTMLElement && depth < 12) {
        const sendButton = findSendInRoot(parent);
        if (sendButton) {
          return {
            root: parent,
            bodyField,
            sendButton,
            replyContainer: parent.closest(".ip")
          };
        }
        parent = parent.parentElement;
        depth += 1;
      }
    }
    return null;
  }

  function getAllDocs() {
    const docs = [document];
    const frames = Array.from(document.querySelectorAll("iframe"));
    for (const frame of frames) {
      try {
        const doc = frame.contentDocument;
        if (doc && doc.body) docs.push(doc);
      } catch (_) {
        // cross-origin, ignore
      }
    }
    return docs;
  }

  function findExistingReplyCompose() {
    const docs = getAllDocs();
    for (const doc of docs) {
      const scope = getMainRoot(doc);
      const found = findReplyComposeRootIn(scope);
      if (found) return found;
    }
    return null;
  }

  function waitForReplyComposeInContainer(replyContainer, timeoutMs) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const scope = getMainRoot(document);
      const tryResolve = () => {
        if (!(replyContainer instanceof HTMLElement)) return false;
        const found = findReplyComposeRootIn(replyContainer);
        if (found) {
          cleanup();
          resolve(found);
          return true;
        }
        if (!scope.contains(replyContainer) && Date.now() - startedAt > 1200) {
          cleanup();
          resolve(null);
          return true;
        }
        return false;
      };
      const interval = setInterval(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          resolve(null);
        }
      }, 120);
      const observer = new MutationObserver(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          resolve(null);
        }
      });
      const cleanup = () => {
        clearInterval(interval);
        observer.disconnect();
      };
      observer.observe(scope, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style"] });
      tryResolve();
    });
  }

  async function openReplyByContainer(timeoutMs) {
    const main = getMainRoot(document);
    const containers = Array.from(main.querySelectorAll(".ip")).reverse();
    for (const container of containers) {
      if (!(container instanceof HTMLElement)) continue;
      if (container.classList.contains("adB")) {
        const existing = findReplyComposeRootIn(container);
        if (existing) return existing;
      }

      const candidates = Array.from(container.querySelectorAll('[role="button"], button'))
        .filter((node) => isVisible(node) && !node.closest(".M9"));
      for (const candidate of candidates) {
        dispatchMouseSequence(candidate);
        const opened = await waitForReplyComposeInContainer(container, Math.min(timeoutMs, 1500));
        if (opened) return opened;
      }
    }

    const globalReplyButton = findReplyButton();
    if (globalReplyButton) {
      dispatchMouseSequence(globalReplyButton);
      const opened = await waitForReplyCompose(Math.min(timeoutMs, 2200));
      if (opened) return opened;
    }

    return null;
  }

  function waitForReplyCompose(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tryResolve = () => {
        const found = findExistingReplyCompose();
        if (found) {
          cleanup();
          resolve(found);
          return true;
        }
        return false;
      };
      const interval = setInterval(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) { cleanup(); resolve(null); }
      }, 200);
      const observer = new MutationObserver(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) { cleanup(); resolve(null); }
      });
      const cleanup = () => { clearInterval(interval); observer.disconnect(); };
      observer.observe(document.body, { childList: true, subtree: true });
      tryResolve();
    });
  }

  function threadIdVariants(threadId) {
    const raw = shortText(String(threadId || "").trim(), 140);
    if (!raw) return [];
    const out = new Set([raw]);
    const noHash = raw.startsWith("#") ? raw.slice(1) : raw;
    if (noHash) out.add(noHash);
    out.add(`#${noHash}`);

    if (noHash.startsWith("thread-f:")) {
      const id = noHash.slice("thread-f:".length);
      if (id) {
        out.add(`f:${id}`);
        out.add(`#f:${id}`);
        out.add(`#thread-f:${id}`);
      }
    } else if (noHash.startsWith("f:")) {
      const id = noHash.slice(2);
      if (id) {
        out.add(`thread-f:${id}`);
        out.add(`#thread-f:${id}`);
      }
    }
    return Array.from(out).filter(Boolean);
  }

  function buildThreadHashCandidates(threadId, mailbox) {
    const variants = threadIdVariants(threadId);
    const out = [];
    const box = shortText(String(mailbox || "inbox").trim().toLowerCase(), 40) || "inbox";
    for (const variant of variants) {
      const noHash = variant.startsWith("#") ? variant.slice(1) : variant;
      if (!noHash) continue;
      out.push(`#${noHash}`);
      if (/^[A-Za-z0-9_-]{8,}$/.test(noHash)) {
        out.push(`#${box}/${noHash}`);
      }
    }
    return Array.from(new Set(out.filter(Boolean)));
  }

  function hashFromHref(href) {
    const value = shortText(String(href || "").trim(), 260);
    if (!value) return "";
    const hashIndex = value.indexOf("#");
    if (hashIndex >= 0) return shortText(value.slice(hashIndex).split("?")[0], 220);
    try {
      const url = new URL(value, window.location.origin);
      return shortText((url.hash || "").split("?")[0], 220);
    } catch (_) {
      return "";
    }
  }

  function isThreadLikeHash(hashValue) {
    const hash = shortText(String(hashValue || "").trim(), 220);
    if (!hash) return false;
    const clean = hash.split("?")[0];
    if (/^#(?:thread-)?f:[A-Za-z0-9_-]+$/i.test(clean)) return true;
    return /^#(?:inbox|all|sent|drafts|starred|snoozed|important|scheduled|spam|trash|label\/[^/?]+)\/((?:thread-)?f:[A-Za-z0-9_-]+|[A-Za-z0-9_-]+)/i.test(
      clean
    );
  }

  function detectThreadDomContext() {
    const main = getMainRoot(document);
    if (!(main instanceof HTMLElement)) {
      return { ready: false, messageNodes: 0, replyButtons: 0, listRows: 0 };
    }
    const messageNodes = main.querySelectorAll("[data-message-id], .h7 .adn, .h7 .ii.gt, .adn.ads, .ii.gt").length;
    const replyButtons = main.querySelectorAll('[gh="rr"], [data-tooltip*="Reply"], [aria-label*="Reply"]').length;
    const listRows = main.querySelectorAll("tr.zA, [role='row'][data-thread-id], [role='row'][data-legacy-thread-id]").length;
    const ready = messageNodes > 0 || (replyButtons > 0 && listRows < 8);
    return { ready, messageNodes, replyButtons, listRows };
  }

  function threadContextStatus() {
    const hash = shortText(window.location.hash || "", 220);
    const hashThreadLike = isThreadLikeHash(hash);
    const dom = detectThreadDomContext();
    const compose = findExistingReplyCompose();
    const replyButton = findReplyButton();
    const ok = Boolean(compose) || dom.ready || (hashThreadLike && Boolean(replyButton) && dom.listRows < 8);
    return {
      ok,
      hash,
      hashThreadLike,
      dom,
      hasCompose: Boolean(compose),
      hasReplyButton: Boolean(replyButton)
    };
  }

  async function waitForThreadContextReady(timeoutMs = 2800) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const status = threadContextStatus();
      if (status.ok) return status;
      await sleep(120);
    }
    return threadContextStatus();
  }

  function findHintAnchor(hintHref) {
    const hint = shortText(String(hintHref || "").trim(), 260);
    if (!hint) return null;
    const hintHash = hashFromHref(hint);
    const main = getMainRoot(document);
    const anchors = Array.from(main.querySelectorAll("a[href], [role='link'][href]"));
    for (const node of anchors) {
      if (!(node instanceof HTMLElement)) continue;
      const href = shortText(node.getAttribute("href") || "", 260);
      if (!href) continue;
      if (href === hint) return node;
      if (hintHash && hashFromHref(href) === hintHash) return node;
    }
    return null;
  }

  async function ensureNativeThreadContext(options, debug) {
    const timeoutMs = Math.min(
      Number(options && options.timeoutMs) || DEFAULT_REPLY_TIMEOUT_MS,
      6500
    );
    const threadId = shortText(options && options.threadId, 180);
    const mailbox = shortText(options && options.mailbox, 40);
    const threadHintHref = shortText(options && options.threadHintHref, 260);

    const initial = threadContextStatus();
    if (initial.ok) {
      return { ok: true, step: "alreadyThreadContext", status: initial, tried: [] };
    }

    const tried = [];

    if (threadHintHref) {
      const anchor = findHintAnchor(threadHintHref);
      if (anchor) {
        dispatchMouseSequence(anchor);
        tried.push("hintAnchorClick");
        const ready = await waitForThreadContextReady(Math.min(timeoutMs, 2600));
        if (ready.ok) {
          return { ok: true, step: "hintAnchorClick", status: ready, tried };
        }
      }

      const hintHash = hashFromHref(threadHintHref);
      if (hintHash) {
        window.location.hash = hintHash;
        tried.push(`hintHash:${hintHash}`);
        const ready = await waitForThreadContextReady(Math.min(timeoutMs, 2600));
        if (ready.ok) {
          return { ok: true, step: "hintHashNavigate", status: ready, tried };
        }
      }
    }

    if (threadId) {
      const nav = await navigateToThreadFromId(
        threadId,
        mailbox,
        Math.min(timeoutMs, 4200),
        waitForThreadContextReady
      );
      tried.push(`threadIdNavigate:${nav.candidate || "none"}`);
      if (nav.ok) {
        return { ok: true, step: "threadIdNavigate", status: nav.status || threadContextStatus(), tried, nav };
      }
    }

    const shortcutFired = triggerReplyShortcut();
    if (shortcutFired) {
      tried.push("replyShortcut");
      const ready = await waitForThreadContextReady(1800);
      if (ready.ok) {
        return { ok: true, step: "replyShortcut", status: ready, tried };
      }
    }

    const finalStatus = threadContextStatus();
    if (debug && typeof debug === "object") {
      debug.context = {
        initial,
        final: finalStatus,
        tried
      };
    }
    return {
      ok: false,
      step: "thread-context-not-found",
      reason: "thread-context-not-found",
      status: finalStatus,
      tried
    };
  }

  async function waitForReplySurface(timeoutMs = 2200) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const compose = findExistingReplyCompose();
      if (compose) return true;
      const replyBtn = findReplyButton();
      if (replyBtn) return true;
      await sleep(120);
    }
    return false;
  }

  async function navigateToThreadFromId(threadId, mailbox, timeoutMs = 3600, waitForReady = waitForReplySurface) {
    const candidates = buildThreadHashCandidates(threadId, mailbox);
    for (const candidate of candidates) {
      window.location.hash = candidate;
      const status = await waitForReady(Math.min(timeoutMs, 1800));
      const ready = Boolean(status && typeof status === "object" ? status.ok : status);
      if (ready) {
        return { ok: true, candidate, tried: candidates, status };
      }
    }
    return { ok: false, candidate: "", tried: candidates, status: null };
  }

  function findSendInRoot(root) {
    for (const sel of STRUCTURAL_SEND_BUTTON_SELECTORS) {
      const el = root.querySelector(sel);
      if (isVisible(el)) return el;
    }
    const actionArea = root.querySelector(".IZ .Up") || root.querySelector(".Up");
    if (actionArea instanceof HTMLElement) {
      const actionButtons = Array.from(actionArea.querySelectorAll('[role="button"], button'))
        .filter((el) => {
          if (!isVisible(el)) return false;
          if (el.classList.contains("Uo")) return false;
          if ((el.getAttribute("aria-haspopup") || "").toLowerCase() === "true") return false;
          return true;
        });
      if (actionButtons.length > 0) return actionButtons[0];
    }
    for (const sel of LEGACY_SEND_BUTTON_SELECTORS) {
      const el = root.querySelector(sel);
      if (isVisible(el)) return el;
    }
    const buttons = root.querySelectorAll('div[role="button"], button');
    for (const el of buttons) {
      const label = (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || el.textContent || "").trim();
      if (/^Send$/i.test(label) && isVisible(el)) return el;
    }
    return null;
  }

  function sendViaKeyboard(bodyField) {
    const target = bodyField instanceof HTMLElement ? bodyField : document.body;
    target.focus();
    const attempts = [
      { key: "Enter", ctrlKey: true, bubbles: true },
      { key: "Enter", metaKey: true, bubbles: true }
    ];
    for (const event of attempts) {
      target.dispatchEvent(new KeyboardEvent("keydown", event));
      target.dispatchEvent(new KeyboardEvent("keyup", event));
    }
    return true;
  }

  function normalizedEvidenceText(value) {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function findVisibleSendIndicator() {
    const nodes = Array.from(document.querySelectorAll('[role="alert"], [aria-live], .bAq, .vh, .aT'));
    for (const node of nodes) {
      if (!(node instanceof HTMLElement)) continue;
      if (!isVisible(node)) continue;
      const text = normalizedEvidenceText(node.textContent || node.innerText || "");
      if (!text) continue;
      if (text.includes("message sent")) return "toast-message-sent";
      if (text.includes("sent")) return "toast-sent";
    }
    return "";
  }

  function bodyFieldShowsSendEvidence(bodyField, originalText) {
    if (!(bodyField instanceof HTMLElement)) return "";
    const original = normalizedEvidenceText(originalText || "");
    if (!original) return "";
    const current = normalizedEvidenceText(bodyField.innerText || bodyField.textContent || "");
    if (!current) return "body-cleared";
    const anchor = shortText(original, 34);
    if (!anchor) return "";
    if (!current.includes(anchor) && current.length <= Math.max(24, Math.floor(original.length * 0.38))) {
      return "body-changed";
    }
    return "";
  }

  async function waitForSendCompletion(
    composeRoot,
    replyContainer,
    timeoutMs = DEFAULT_SEND_VERIFY_TIMEOUT_MS,
    options = {}
  ) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const bodyField = options && options.bodyField instanceof HTMLElement ? options.bodyField : null;
      const originalText = options && typeof options.originalText === "string" ? options.originalText : "";
      const isClosed = () => {
        if (!(composeRoot instanceof HTMLElement)) return true;
        if (!composeRoot.isConnected) return true;
        if (replyContainer instanceof HTMLElement && !replyContainer.classList.contains("adB")) return true;
        if (!isVisible(composeRoot)) return true;
        return false;
      };
      const tryResolve = () => {
        if (isClosed()) {
          cleanup();
          resolve({ ok: true, reason: "compose-closed" });
          return true;
        }
        const sendIndicator = findVisibleSendIndicator();
        if (sendIndicator) {
          cleanup();
          resolve({ ok: true, reason: sendIndicator });
          return true;
        }
        const bodyEvidence = bodyFieldShowsSendEvidence(bodyField, originalText);
        if (bodyEvidence) {
          cleanup();
          resolve({ ok: true, reason: bodyEvidence });
          return true;
        }
        return false;
      };
      const interval = setInterval(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          resolve({ ok: false, reason: "timeout" });
        }
      }, 120);
      const observer = new MutationObserver(() => {
        if (tryResolve()) return;
        if (Date.now() - startedAt > timeoutMs) {
          cleanup();
          resolve({ ok: false, reason: "timeout" });
        }
      });
      const cleanup = () => {
        clearInterval(interval);
        observer.disconnect();
      };
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "aria-hidden"] });
      tryResolve();
    });
  }

  async function replyToThreadLegacy(body) {
    const replyBtn = findReplyButton();
    if (!replyBtn) {
      console.warn("[reskin] Reply button not found. Tried:", REPLY_BUTTON_SELECTORS);
      return false;
    }
    dispatchMouseSequence(replyBtn);
    const found = await waitForReplyCompose();
    if (!found || !found.bodyField) {
      console.warn("[reskin] Reply compose area did not appear within timeout. Tried main + iframes.");
      return false;
    }
    const bodyField = found.bodyField;
    const root = found.root || bodyField.closest(".M9") || bodyField.closest('[role="dialog"]');
    bodyField.focus();
    setContentEditableValue(bodyField, body || "");
    await new Promise((r) => setTimeout(r, 400));
    const main = getMainRoot(document);
    const sendButton = root instanceof HTMLElement ? findSendInRoot(root) : findSendInRoot(main);
    if (sendButton) {
      dispatchMouseSequence(sendButton);
      return true;
    }
    sendViaKeyboard(bodyField);
    return true;
  }

  async function replyToThread(body, opts) {
    const startedAt = Date.now();
    const text = String(body || "").trim();
    const options = normalizeReplyOptions(opts);
    const debug = {
      startedAt,
      mode: ENABLE_HARDENED_REPLY_SEND ? "hardened" : "legacy",
      textLength: text.length,
      options: {
        threadId: shortText(options.threadId || "", 80),
        mailbox: shortText(options.mailbox || "", 40),
        threadHintHref: shortText(options.threadHintHref || "", 120),
        conversationKey: shortText(options.conversationKey || "", 120),
        contactEmail: shortText(options.contactEmail || "", 120),
        activeAccountEmail: shortText(options.activeAccountEmail || "", 120),
        forceThreadContext: options.forceThreadContext !== false,
        timeoutMs: options.timeoutMs
      },
      acquire: [],
      send: {},
      contextStep: ""
    };

    const finish = (result, extra = {}) => {
      const payload = {
        ...debug,
        ...extra,
        result: { ...result },
        durationMs: Date.now() - startedAt,
        hash: shortText(window.location.hash || "", 120)
      };
      setLastReplyDebug(payload);
      logReplyDebug(result.ok ? "reply-success" : "reply-failure", payload, !result.ok);
      if (!result.ok) {
        try {
          console.info(`[reskin][reply-debug-json] ${JSON.stringify(payload)}`);
        } catch (_) {
          // ignore serialization failures
        }
      }
      return result;
    };

    logReplyDebug("reply-start", {
      mode: debug.mode,
      textLength: debug.textLength,
      options: debug.options,
      hash: shortText(window.location.hash || "", 120)
    });

    if (!text) return finish(asResult(false, "validate", "empty-message"), { failurePoint: "validate" });

    if (!ENABLE_HARDENED_REPLY_SEND) {
      const legacyOk = await replyToThreadLegacy(text);
      return finish(asResult(legacyOk, "legacy", legacyOk ? "" : "legacy-failure"), { path: "legacy" });
    }

    return await withNativeGmailSurface(async () => {
      debug.surfaceTemporarilyRevealed = true;

      if (options.forceThreadContext !== false) {
        const context = await ensureNativeThreadContext(options, debug);
        debug.contextStep = shortText(context && context.step ? context.step : "", 80);
        debug.acquire.push({
          step: "ensureNativeThreadContext",
          ok: Boolean(context && context.ok),
          contextStep: debug.contextStep,
          tried: Array.isArray(context && context.tried) ? context.tried.slice(0, 10) : [],
          hash: shortText(window.location.hash || "", 120)
        });
        if (!context.ok) {
          return finish(asResult(false, "threadContext", "thread-context-not-found"), {
            failurePoint: "threadContext",
            contextStep: debug.contextStep || "thread-context-not-found"
          });
        }
      } else {
        debug.contextStep = "skipped";
      }

      let acquiredBy = "";
      let acquired = findExistingReplyCompose();
      debug.acquire.push({
        step: "existingCompose",
        found: Boolean(acquired),
        root: elementSnapshot(acquired && acquired.root)
      });
      if (acquired) acquiredBy = "existingCompose";

      if (!acquired) {
        acquired = await openReplyByContainer(options.timeoutMs);
        debug.acquire.push({
          step: "openReplyByContainer",
          found: Boolean(acquired),
          root: elementSnapshot(acquired && acquired.root)
        });
        if (acquired) acquiredBy = "openReplyByContainer";
      }

      if (!acquired) {
        const legacyBtn = findReplyButton();
        debug.acquire.push({
          step: "findReplyButton",
          found: Boolean(legacyBtn),
          button: elementSnapshot(legacyBtn)
        });
        if (legacyBtn) {
          dispatchMouseSequence(legacyBtn);
          acquired = await waitForReplyCompose(options.timeoutMs);
          debug.acquire.push({
            step: "waitAfterReplyButton",
            found: Boolean(acquired),
            root: elementSnapshot(acquired && acquired.root)
          });
          if (acquired) acquiredBy = "replyButton";
        }
      }

      if (!acquired) {
        const shortcutFired = triggerReplyShortcut();
        debug.acquire.push({
          step: "replyShortcut",
          fired: shortcutFired
        });
        acquired = await waitForReplyCompose(Math.min(options.timeoutMs, 2600));
        debug.acquire.push({
          step: "waitAfterReplyShortcut",
          found: Boolean(acquired),
          root: elementSnapshot(acquired && acquired.root)
        });
        if (acquired) acquiredBy = "replyShortcut";
      }

      if (!acquired || !(acquired.bodyField instanceof HTMLElement) || !(acquired.root instanceof HTMLElement)) {
        return finish(asResult(false, "replyCompose", "reply-compose-not-found"), {
          failurePoint: "replyCompose",
          acquiredBy
        });
      }

      debug.acquiredBy = acquiredBy || "unknown";
      debug.compose = {
        root: elementSnapshot(acquired.root),
        bodyField: elementSnapshot(acquired.bodyField),
        replyContainer: elementSnapshot(acquired.replyContainer)
      };

      const bodyField = acquired.bodyField;
      bodyField.focus();
      const wrote = setContentEditableValue(bodyField, text);
      debug.send.bodyWriteOk = wrote;
      if (!wrote) {
        return finish(asResult(false, "fillBody", "body-write-failed"), {
          failurePoint: "fillBody"
        });
      }
      await sleep(120);

      const sendButton = findSendInRoot(acquired.root);
      debug.send.sendButton = elementSnapshot(sendButton);
      if (!sendButton) {
        sendViaKeyboard(bodyField);
        debug.send.keyboardAttempted = true;
        const keyboardOnlyResult = await waitForSendCompletion(
          acquired.root,
          acquired.replyContainer,
          2200,
          { bodyField, originalText: text }
        );
        debug.send.keyboardOnlyVerified = Boolean(keyboardOnlyResult && keyboardOnlyResult.ok);
        debug.send.keyboardOnlyReason = shortText(keyboardOnlyResult && keyboardOnlyResult.reason ? keyboardOnlyResult.reason : "", 40);
        if (keyboardOnlyResult && keyboardOnlyResult.ok) {
          const keyboardOnlyStage = keyboardOnlyResult.reason === "compose-closed"
            ? "sendVerifiedKeyboardOnly"
            : "sendLikelyKeyboardOnly";
          return finish(asResult(true, keyboardOnlyStage), {
            sendMethod: "keyboardOnly",
            sendEvidence: keyboardOnlyResult.reason || ""
          });
        }
        return finish(asResult(false, "sendButton", "send-button-not-found"), {
          failurePoint: "sendButton",
          sendMethod: "keyboardOnly"
        });
      }

      dispatchMouseSequence(sendButton);
      debug.send.sendMethod = "button";
      const buttonResult = await waitForSendCompletion(
        acquired.root,
        acquired.replyContainer,
        Math.min(options.timeoutMs, DEFAULT_SEND_VERIFY_TIMEOUT_MS),
        { bodyField, originalText: text }
      );
      debug.send.buttonVerified = Boolean(buttonResult && buttonResult.ok);
      debug.send.buttonVerifyReason = shortText(buttonResult && buttonResult.reason ? buttonResult.reason : "", 40);
      if (buttonResult && buttonResult.ok) {
        const buttonStage = buttonResult.reason === "compose-closed" ? "sendVerified" : "sendLikely";
        return finish(asResult(true, buttonStage), {
          sendMethod: "button",
          sendEvidence: buttonResult.reason || ""
        });
      }

      sendViaKeyboard(bodyField);
      debug.send.keyboardFallbackAttempted = true;
      const keyboardFallbackResult = await waitForSendCompletion(
        acquired.root,
        acquired.replyContainer,
        1800,
        { bodyField, originalText: text }
      );
      debug.send.keyboardFallbackVerified = Boolean(keyboardFallbackResult && keyboardFallbackResult.ok);
      debug.send.keyboardFallbackReason = shortText(
        keyboardFallbackResult && keyboardFallbackResult.reason ? keyboardFallbackResult.reason : "",
        40
      );
      if (keyboardFallbackResult && keyboardFallbackResult.ok) {
        const keyboardStage = keyboardFallbackResult.reason === "compose-closed"
          ? "sendVerifiedKeyboard"
          : "sendLikelyKeyboard";
        return finish(asResult(true, keyboardStage), {
          sendMethod: "button+keyboardFallback",
          sendEvidence: keyboardFallbackResult.reason || ""
        });
      }

      return finish(asResult(false, "sendVerify", "compose-did-not-close"), {
        failurePoint: "sendVerify",
        sendMethod: "button+keyboardFallback"
      });
    });
  }

  window.ReskinCompose = {
    sendThroughGmail,
    replyToThread,
    replyToThreadLegacy,
    replySendMode: ENABLE_HARDENED_REPLY_SEND ? "hardened" : "legacy",
    getLastReplyDebug: () => (lastReplyDebug ? { ...lastReplyDebug } : null),
    setReplyDebug: setReplyDebugEnabled,
    isReplyDebugEnabled: replyDebugEnabled
  };
})();
