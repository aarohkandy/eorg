(() => {
  if (window.__reskinDebugBridgeReady) return;
  window.__reskinDebugBridgeReady = true;

  const REQUEST_EVENT = "reskin:debug:request";
  const RESPONSE_EVENT = "reskin:debug:response";
  let sequence = 0;

  const invoke = (method, ...args) => new Promise((resolve, reject) => {
    const id = `reskin-debug-${Date.now()}-${++sequence}`;
    let finished = false;
    const cleanup = () => {
      window.removeEventListener(RESPONSE_EVENT, onResponse);
    };
    const onResponse = (event) => {
      const detail = event && event.detail ? event.detail : {};
      if (!detail || detail.id !== id || finished) return;
      finished = true;
      cleanup();
      if (detail.ok) resolve(detail.result);
      else reject(new Error(detail.error || "debug bridge call failed"));
    };
    window.addEventListener(RESPONSE_EVENT, onResponse);
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: { id, method, args }
    }));
    setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      reject(new Error("debug bridge timeout"));
    }, 3200);
  });

  window.ReskinChatDebug = {
    enable: () => invoke("enable"),
    disable: () => invoke("disable"),
    set: (enabled) => invoke("set", enabled),
    isEnabled: () => invoke("isEnabled"),
    detectAccountNow: () => invoke("detectAccountNow"),
    dumpState: () => invoke("dumpState"),
    dumpMailboxCache: () => invoke("dumpMailboxCache"),
    dumpReplyDebug: () => invoke("dumpReplyDebug"),
    dumpAccountState: () => invoke("dumpAccountState"),
    dumpDiag: (options, sessionToken) => invoke("dumpDiag", options || {}, sessionToken || ""),
    dumpDiagBudgets: (sessionToken) => invoke("dumpDiagBudgets", sessionToken || ""),
    setDiagMode: (mode, sessionToken) => invoke("setDiagMode", mode, sessionToken || ""),
    getDiagMode: () => invoke("getDiagMode"),
    enableE2EDiag: (sessionToken, ttlMs) => invoke("enableE2EDiag", sessionToken || "", ttlMs),
    disableE2EDiag: (sessionToken) => invoke("disableE2EDiag", sessionToken || "")
  };
})();
