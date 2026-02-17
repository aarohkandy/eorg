(function initEorgContent(global) {
  'use strict';

  const root = (global.__EORG__ = global.__EORG__ || {});
  if (root.started) {
    return;
  }
  root.started = true;

  const modules = (root.modules = root.modules || {});
  root.runtime = root.runtime || {};

  const state = {
    mounted: {},
    observer: null,
    refreshTimer: null,
    url: location.href,
    settings: null,
    indexStatus: { state: 'idle', indexedCount: 0 },
    onboardingDismissed: false
  };

  async function loadSettings() {
    const response = await sendRuntimeMessage({ type: 'GET_SETTINGS' }).catch(() => null);
    state.settings = response ? response.settings : null;
  }

  function sendRuntimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (!response || !response.ok) {
          reject(new Error((response && response.error) || 'Unknown runtime error'));
          return;
        }
        resolve(response);
      });
    });
  }

  function isGmailReady() {
    return Boolean(document.querySelector('div[role="main"], .nH'));
  }

  function scheduleRefresh(reason) {
    clearTimeout(state.refreshTimer);
    state.refreshTimer = setTimeout(() => refresh(reason), 70);
  }

  function mount(name) {
    const mod = modules[name];
    if (!mod || typeof mod.mount !== 'function') {
      return;
    }

    if (state.mounted[name] && typeof state.mounted[name].refresh === 'function') {
      state.mounted[name].refresh();
      return;
    }

    state.mounted[name] = mod.mount({ document, window: global, root });
  }

  function refresh(reason) {
    if (!isGmailReady()) {
      return;
    }

    const safeMode = state.settings && state.settings.safeMode;
    document.documentElement.classList.toggle('eorg-safe-mode', Boolean(safeMode));
    document.documentElement.classList.add('eorg-active');
    document.documentElement.setAttribute('data-eorg-route', location.pathname + location.hash);

    root.runtime.indexStatus = state.indexStatus;

    if (!safeMode) {
      mount('toolbar');
      mount('sidebar');
      mount('compose');
    }

    mount('commandbar');
    renderOnboardingBanner();

    if (reason === 'route') {
      maybeStartIndexer();
    }
  }

  function notify(message, variant) {
    let host = document.getElementById('eorg-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'eorg-toast-host';
      host.className = 'eorg-toast-host';
      document.body.appendChild(host);
    }

    const toast = document.createElement('div');
    toast.className = 'eorg-toast' + (variant ? ' ' + variant : '');
    toast.textContent = message;
    host.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('out');
      setTimeout(() => toast.remove(), 180);
    }, 2600);
  }

  function renderOnboardingBanner() {
    if (state.onboardingDismissed) {
      return;
    }

    const needsOnboarding = !state.settings
      || !state.settings.hasApiKey
      || !state.settings.indexingConsent;

    const existing = document.getElementById('eorg-onboarding-banner');
    if (!needsOnboarding) {
      if (existing) {
        existing.remove();
      }
      return;
    }

    if (existing) {
      return;
    }

    const banner = document.createElement('div');
    banner.id = 'eorg-onboarding-banner';
    banner.className = 'eorg-onboarding';
    banner.innerHTML = [
      '<div class="eorg-onboarding-title">Welcome to Eorg Mail</div>',
      '<div class="eorg-onboarding-text">Paste your AI key or use Ollama, then enable local indexing for private semantic features.</div>',
      '<div class="eorg-onboarding-actions">',
      '<button type="button" data-eorg-open-settings>Open settings</button>',
      '<button type="button" data-eorg-dismiss>Dismiss</button>',
      '</div>'
    ].join('');

    banner.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) {
        return;
      }
      if (target.hasAttribute('data-eorg-open-settings')) {
        chrome.runtime.openOptionsPage();
      }
      if (target.hasAttribute('data-eorg-dismiss')) {
        state.onboardingDismissed = true;
        banner.remove();
      }
    });

    document.body.appendChild(banner);
  }

  function observeSpa() {
    if (state.observer) {
      return;
    }

    state.observer = new MutationObserver(() => {
      if (state.url !== location.href) {
        state.url = location.href;
        scheduleRefresh('route');
        return;
      }
      scheduleRefresh('mutation');
    });

    state.observer.observe(document.body, { childList: true, subtree: true });

    const oldPush = history.pushState;
    const oldReplace = history.replaceState;

    history.pushState = function () {
      const result = oldPush.apply(this, arguments);
      scheduleRefresh('route');
      return result;
    };

    history.replaceState = function () {
      const result = oldReplace.apply(this, arguments);
      scheduleRefresh('route');
      return result;
    };

    addEventListener('popstate', () => scheduleRefresh('route'));
  }

  async function maybeStartIndexer() {
    if (root.runtime.indexerStarted) {
      return;
    }

    if (!state.settings || !state.settings.indexingConsent || !state.settings.indexingEnabled) {
      return;
    }

    if (!global.EorgDB || !global.EorgAI || !global.EorgIndexer) {
      return;
    }

    const db = new global.EorgDB();
    const ai = global.EorgAI;
    const indexer = new global.EorgIndexer.EorgIndexer({
      db,
      ai,
      documentRef: document,
      statusCallback(status) {
        state.indexStatus = status;
        root.runtime.indexStatus = status;
        scheduleRefresh('index-status');
      }
    });

    root.runtime.db = db;
    root.runtime.ai = ai;
    root.runtime.indexer = indexer;
    root.runtime.indexerStarted = true;

    indexer.start();
  }

  async function init() {
    await loadSettings();

    if (!root.runtime.db && global.EorgDB) {
      root.runtime.db = new global.EorgDB();
    }
    if (!root.runtime.ai && global.EorgAI) {
      root.runtime.ai = global.EorgAI;
    }
    root.runtime.notify = notify;

    observeSpa();
    scheduleRefresh('boot');
    maybeStartIndexer();

    chrome.runtime.sendMessage({ type: 'INDEX_STATUS' }, (response) => {
      if (response && response.ok && response.status) {
        state.indexStatus = response.status;
        root.runtime.indexStatus = response.status;
        scheduleRefresh('index-status');
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})(window);
