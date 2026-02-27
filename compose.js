(() => {
  "use strict";

  // Targets Gmail action controls using stable accessibility attributes because class names are obfuscated.
  const COMPOSE_BUTTON_SELECTORS = [
    'div[role="button"][gh="cm"]',
    'div[role="button"][aria-label="Compose"]',
    'div[role="button"][aria-label*="Compose"]'
  ];

  // Targets Gmail compose root as a dialog with editable body because this structure is consistent across rerenders.
  const COMPOSE_DIALOG_SELECTORS = [
    'div[role="dialog"]:has(div[aria-label="Message Body"][contenteditable="true"])',
    'div[role="dialog"]:has(div[g_editable="true"][role="textbox"])'
  ];

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

  // Targets native Gmail send controls by aria/tooltip behavior to trigger official send logic safely.
  const SEND_BUTTON_SELECTORS = [
    'div[role="button"][data-tooltip^="Send"]',
    'div[role="button"][data-tooltip="Send"]',
    'div[role="button"][aria-label^="Send"]',
    'div[role="button"][aria-label="Send"]',
    'button[aria-label^="Send"]',
    'button[aria-label="Send"]',
    '[data-tooltip="Send"]',
    '[aria-label="Send"]'
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

  // Waits for compose dialog using polling + observer because Gmail mounts compose asynchronously.
  function waitForComposeDialog(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();

      const tryResolve = () => {
        const dialog = selectFirst(document, COMPOSE_DIALOG_SELECTORS, "compose dialog");
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
    composeButton.click();
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

    const sendButton = selectFirst(dialog, SEND_BUTTON_SELECTORS, "send button");
    if (!sendButton) return false;

    sendButton.click();
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
    'span[role="button"][aria-label="Reply"]'
  ];

  function findReplyButton() {
    const main = document.querySelector('[role="main"]') || document.body;
    for (const sel of REPLY_BUTTON_SELECTORS) {
      const buttons = Array.from(main.querySelectorAll(sel));
      const btn = buttons[buttons.length - 1];
      if (btn) return btn;
    }
    return null;
  }

  function findBodyInRoot(root) {
    for (const sel of BODY_FIELD_SELECTORS) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    return null;
  }

  function waitForReplyCompose(timeoutMs = 10000) {
    return new Promise((resolve) => {
      const startedAt = Date.now();
      const tryResolve = () => {
        const main = document.querySelector('[role="main"]') || document.body;
        let body = findBodyInRoot(main);
        if (body) { cleanup(); resolve(body); return true; }
        const iframes = document.querySelectorAll('iframe');
        for (const frame of iframes) {
          try {
            const doc = frame.contentDocument;
            if (doc && doc.body) {
              body = findBodyInRoot(doc);
              if (body) { cleanup(); resolve(body); return true; }
            }
          } catch (_) { /* cross-origin */ }
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

  function findSendInRoot(root) {
    for (const sel of SEND_BUTTON_SELECTORS) {
      const el = root.querySelector(sel);
      if (el && el.offsetParent !== null) return el;
    }
    const buttons = root.querySelectorAll('div[role="button"], button');
    for (const el of buttons) {
      const label = (el.getAttribute("aria-label") || el.getAttribute("data-tooltip") || el.textContent || "").trim();
      if (/^Send$/i.test(label)) return el;
    }
    return null;
  }

  function sendViaKeyboard() {
    const main = document.querySelector('[role="main"]') || document.body;
    const bodyField = findBodyInRoot(main);
    if (bodyField) {
      bodyField.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
      bodyField.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", ctrlKey: true, bubbles: true }));
      return true;
    }
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }));
    document.body.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", ctrlKey: true, bubbles: true }));
    return true;
  }

  async function replyToThread(body) {
    const replyBtn = findReplyButton();
    if (!replyBtn) {
      console.warn("[reskin] Reply button not found. Tried:", REPLY_BUTTON_SELECTORS);
      return false;
    }
    console.log("[reskin] Reply button found, clicking.");
    replyBtn.click();
    const bodyField = await waitForReplyCompose();
    if (!bodyField) {
      console.warn("[reskin] Reply compose area did not appear within timeout. Tried main + iframes.");
      return false;
    }
    console.log("[reskin] Reply body field found, filling.");
    bodyField.focus();
    setContentEditableValue(bodyField, body || "");
    await new Promise((r) => setTimeout(r, 400));
    const main = document.querySelector('[role="main"]') || document.body;
    let sendButton = findSendInRoot(main);
    if (!sendButton) {
      const iframes = document.querySelectorAll('iframe');
      for (const frame of iframes) {
        try {
          const doc = frame.contentDocument;
          if (doc && doc.body) {
            sendButton = findSendInRoot(doc);
            if (sendButton) break;
          }
        } catch (_) { }
      }
    }
    if (sendButton) {
      console.log("[reskin] Send button found, clicking.");
      sendButton.click();
      return true;
    }
    console.log("[reskin] Send button not found, trying Ctrl+Enter.");
    sendViaKeyboard();
    return true;
  }

  window.ReskinCompose = { sendThroughGmail, replyToThread };
})();
