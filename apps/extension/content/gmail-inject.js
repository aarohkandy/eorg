if (isMailHost()) {
  waitForGmail(() => {
    bootGmailSurface().catch(() => {});
  });
}
