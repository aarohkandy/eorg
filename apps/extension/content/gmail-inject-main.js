async function bootGmailSurface() {
  buildSidebar();
  await refreshGuideAndAuthState();
  applyGmailLayoutMode();

  if (state.connected) {
    await loadMessages();
    startAutoRefresh();
  }

  window.addEventListener('hashchange', async () => {
    await refreshGuideAndAuthState();
    applyGmailLayoutMode();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
      refreshGuideAndAuthState()
        .then(async () => {
          applyGmailLayoutMode();
          if (state.connected && state.messages.length === 0) {
            await loadMessages();
          }
        })
        .catch(() => {});
    }
    if (changes.setupDiagnostics) {
      state.setupDiagnostics = normalizeSetupDiagnostics(changes.setupDiagnostics.newValue);
      renderActivityPanel();
    }
  });
}
