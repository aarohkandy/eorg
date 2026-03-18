const mainBuildSidebar = globalThis.buildSidebar;
const mainRefreshGuideAndAuthState = globalThis.refreshGuideAndAuthState;
const mainApplyGmailLayoutMode = globalThis.applyGmailLayoutMode;
const mainState = globalThis.state;
const mainLoadMessages = globalThis.loadMessages;
const mainStartAutoRefresh = globalThis.startAutoRefresh;
const mainNormalizeSetupDiagnostics = globalThis.normalizeSetupDiagnostics;
const mainRenderActivityPanel = globalThis.renderActivityPanel;

async function bootGmailSurface() {
  mainBuildSidebar();
  await mainRefreshGuideAndAuthState();
  mainApplyGmailLayoutMode();

  if (mainState.connected) {
    await mainLoadMessages();
    mainStartAutoRefresh();
  }

  window.addEventListener('hashchange', async () => {
    await mainRefreshGuideAndAuthState();
    mainApplyGmailLayoutMode();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    if (changes.onboardingGuideState || changes.userId || changes.onboardingComplete) {
      mainRefreshGuideAndAuthState()
        .then(async () => {
          mainApplyGmailLayoutMode();
          if (mainState.connected && mainState.messages.length === 0) {
            await mainLoadMessages();
          }
        })
        .catch(() => {});
    }
    if (changes.setupDiagnostics) {
      mainState.setupDiagnostics = mainNormalizeSetupDiagnostics(changes.setupDiagnostics.newValue);
      mainRenderActivityPanel();
    }
  });
}

globalThis.bootGmailSurface = bootGmailSurface;
