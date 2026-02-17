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
    'div[g_editable="true"][role="textbox"]'
  ];

  // Targets native Gmail send controls by aria/tooltip behavior to trigger official send logic safely.
  const SEND_BUTTON_SELECTORS = [
    'div[role="button"][data-tooltip^="Send"]',
    'div[role="button"][aria-label^="Send"]',
    'button[aria-label^="Send"]'
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

  window.ReskinCompose = { sendThroughGmail };
})();
