if (globalThis.isMailHost()) {
  globalThis.waitForGmail(() => {
    globalThis.bootGmailSurface().catch(() => {});
  });
}
