const sidebarState = globalThis.state;
const sidebarAppendUiActivity = globalThis.appendUiActivity;
const sidebarApplyGmailLayoutMode = globalThis.applyGmailLayoutMode;
const sidebarOpenExternalPage = globalThis.openExternalPage;
const sidebarAppPasswordsUrl = globalThis.APP_PASSWORDS_URL;
const sidebarGuideConfirm = globalThis.guideConfirm;
const sidebarTwoStepVerificationUrl = globalThis.TWO_STEP_VERIFICATION_URL;
const sidebarConnectFromGuide = globalThis.connectFromGuide;
const sidebarSendWorker = globalThis.sendWorker;
const sidebarStartColdStartCountdown = globalThis.startColdStartCountdown;
const sidebarLoadMessages = globalThis.loadMessages;
const sidebarSetStateCard = globalThis.setStateCard;
const sidebarSetFilter = globalThis.setFilter;
const sidebarHandleSearch = globalThis.handleSearch;
const sidebarUpdateMainPanelVisibility = globalThis.updateMainPanelVisibility;

function bindGuideEvents(sidebar) {
  sidebar.querySelector('#gmailUnifiedGuideBtn')?.addEventListener('click', () => {
    if (!sidebarState.connected) return;
    sidebarState.guideReviewOpen = true;
    sidebarAppendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'guide_opened',
      message: 'Guided setup activity log reopened.'
    }).catch(() => {});
    sidebarApplyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedGuideCloseBtn')?.addEventListener('click', () => {
    sidebarState.guideReviewOpen = false;
    sidebarApplyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedWelcomeStartBtn')?.addEventListener('click', async () => {
    sidebarAppendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_app_passwords',
      message: 'Opened Google App Passwords.'
    }).catch(() => {});
    sidebarOpenExternalPage(sidebarAppPasswordsUrl);
    await sidebarGuideConfirm('welcome');
    sidebarApplyGmailLayoutMode();
  });

  sidebar.querySelector('#gmailUnifiedWelcomeTwoFactorBtn')?.addEventListener('click', () => {
    sidebarAppendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_two_factor',
      message: 'Opened Google 2-Step Verification.'
    }).catch(() => {});
    sidebarOpenExternalPage(sidebarTwoStepVerificationUrl);
  });

  sidebar.querySelector('#gmailUnifiedConnectBtn')?.addEventListener('click', async () => {
    await sidebarConnectFromGuide();
  });

  sidebar.querySelector('#gmailUnifiedConnectOpenAppBtn')?.addEventListener('click', () => {
    sidebarAppendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_app_passwords',
      message: 'Opened Google App Passwords from Step 2.'
    }).catch(() => {});
    sidebarOpenExternalPage(sidebarAppPasswordsUrl);
  });

  sidebar.querySelector('#gmailUnifiedConnectOpenTwoFactorBtn')?.addEventListener('click', () => {
    sidebarAppendUiActivity({
      source: 'UI',
      level: 'info',
      stage: 'open_two_factor',
      message: 'Opened Google 2-Step Verification from Step 2.'
    }).catch(() => {});
    sidebarOpenExternalPage(sidebarTwoStepVerificationUrl);
  });

  sidebar.querySelector('#gmailUnifiedConnectPassword')?.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      await sidebarConnectFromGuide();
    }
  });

  sidebar.querySelector('#gmailUnifiedSync')?.addEventListener('click', async () => {
    if (!sidebarState.connected) return;

    const result = await sidebarSendWorker('SYNC_MESSAGES', {
      trackActivity: sidebarState.guideReviewOpen
    });
    if (!result?.success) {
      if (result.code === 'BACKEND_COLD_START') {
        sidebarStartColdStartCountdown(() => sidebarLoadMessages({ forceSync: true, trackActivity: sidebarState.guideReviewOpen }), {
          message: 'Manual sync is waiting for the backend to wake up.'
        });
        return;
      }

      sidebarSetStateCard('error', result.error || 'Sync failed.', true);
      return;
    }

    await sidebarLoadMessages({ forceSync: true, trackActivity: sidebarState.guideReviewOpen });
  });

  sidebar.querySelectorAll('.gmail-unified-filter-btn').forEach((button) => {
    button.addEventListener('click', () => sidebarSetFilter(button.dataset.filter));
  });

  const searchInput = sidebar.querySelector('#gmailUnifiedSearchInput');
  searchInput?.addEventListener('input', (event) => {
    clearTimeout(globalThis.searchDebounce);
    const value = event.target.value;
    globalThis.searchDebounce = setTimeout(() => {
      sidebarHandleSearch(value);
    }, 400);
  });

  sidebar.querySelector('#gmailUnifiedRetryBtn')?.addEventListener('click', () => {
    sidebarLoadMessages({ forceSync: false, trackActivity: true });
  });

  sidebar.querySelector('#gmailUnifiedBackBtn')?.addEventListener('click', () => {
    sidebarState.selectedThreadId = '';
    document.getElementById('gmailUnifiedDetail').style.display = 'none';
    sidebarUpdateMainPanelVisibility();
  });
}

function buildSidebar() {
  if (document.getElementById('gmailUnifiedSidebar')) return;

  const sidebar = document.createElement('aside');
  sidebar.id = 'gmailUnifiedSidebar';
  sidebar.innerHTML = `
    <div id="gmailUnifiedShell" class="gmail-unified-shell">
      <section class="gmail-unified-left">
        <div class="gmail-unified-header">
          <h3>Gmail Unified</h3>
          <div class="gmail-unified-header-actions">
            <button id="gmailUnifiedGuideBtn" class="gmail-unified-guide-btn" type="button">Guide me</button>
            <button id="gmailUnifiedSync" class="gmail-unified-sync" type="button">↻ Sync</button>
          </div>
        </div>
        <div class="gmail-unified-search">
          <input id="gmailUnifiedSearchInput" type="text" placeholder="Search messages..." />
        </div>
        <div class="gmail-unified-filters">
          <button class="gmail-unified-filter-btn active" data-filter="all">All</button>
          <button class="gmail-unified-filter-btn" data-filter="inbox">Inbox</button>
          <button class="gmail-unified-filter-btn" data-filter="sent">Sent</button>
        </div>
        <div id="gmailUnifiedStateCard" class="gmail-unified-state-card" data-state="loading">
          <div id="gmailUnifiedStateText">Connecting to Gmail...</div>
          <button id="gmailUnifiedRetryBtn" class="gmail-unified-retry" type="button">Retry now</button>
          <div id="gmailUnifiedCountdown" class="gmail-unified-countdown"></div>
        </div>
        <div id="gmailUnifiedList" class="gmail-unified-list"></div>
      </section>
      <section class="gmail-unified-main">
        <div id="gmailUnifiedMainEmpty" class="gmail-unified-main-empty">Select a conversation</div>
        <section id="gmailUnifiedDetail" class="gmail-unified-detail" style="display:none;">
          <div class="gmail-unified-detail-head">
            <button id="gmailUnifiedBackBtn" class="gmail-unified-back">← Back</button>
            <div id="gmailUnifiedDetailHeader"></div>
          </div>
          <div id="gmailUnifiedDetailBody" class="gmail-unified-detail-body"></div>
        </section>
      </section>
    </div>

    <section id="gmailUnifiedOnboardingOverlay" class="gmail-unified-onboarding-overlay" hidden>
      <div class="gmail-unified-modal">
        <header class="gmail-unified-modal-header">
          <div>
            <div class="gmail-unified-modal-kicker">Guided setup</div>
            <h2>Connect Gmail Unified</h2>
          </div>
          <div class="gmail-unified-modal-right">
            <span id="gmailUnifiedGuideCounterBadge" class="gmail-unified-counter-badge">0/2</span>
            <button id="gmailUnifiedGuideCloseBtn" class="gmail-unified-guide-close-modal" hidden>Close</button>
          </div>
        </header>
        <div class="gmail-unified-progress-wrap">
          <div id="gmailUnifiedGuideProgressText" class="gmail-unified-progress-text">Step 1/2 · 0/2 completed</div>
          <div class="gmail-unified-progress-track"><div id="gmailUnifiedGuideProgressBar" class="gmail-unified-progress-fill"></div></div>
          <div id="gmailUnifiedGuideContext" class="gmail-unified-guide-context">Current page: Gmail inbox</div>
        </div>

        <article class="gmail-unified-guide-slide active" data-step="welcome">
          <h3>Step 1: Before you connect</h3>
          <p id="gmailUnifiedWelcomeBody">Use this step to turn on 2-Step Verification if needed, then create your Gmail App Password.</p>
          <ol>
            <li>Open Google App Passwords.</li>
            <li>If Google says App Passwords is unavailable, turn on <strong>2-Step Verification</strong> first.</li>
            <li>Create a new password for <strong>Gmail Unified</strong> and copy the 16-character code.</li>
            <li>Come back here and connect with your Gmail address and that code.</li>
          </ol>
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedWelcomeStartBtn" class="gmail-unified-primary-btn">Open App Passwords</button>
          </div>
          <div class="gmail-unified-guide-helper">
            <span>Need to turn on 2-Step Verification first?</span>
            <button id="gmailUnifiedWelcomeTwoFactorBtn" class="gmail-unified-link-btn" type="button">
              Open 2-Step Verification
            </button>
          </div>
        </article>

        <article class="gmail-unified-guide-slide" data-step="connect_account">
          <h3>Step 2: Connect account</h3>
          <p id="gmailUnifiedConnectBody">Paste the Gmail address you want to sync and the 16-character App Password from Google.</p>
          <label for="gmailUnifiedConnectEmail" class="gmail-unified-field-label">Gmail address</label>
          <input id="gmailUnifiedConnectEmail" class="gmail-unified-field" type="email" placeholder="you@gmail.com" />
          <label for="gmailUnifiedConnectPassword" class="gmail-unified-field-label">App password</label>
          <input id="gmailUnifiedConnectPassword" class="gmail-unified-field" type="password" placeholder="xxxx xxxx xxxx xxxx" />
          <div class="gmail-unified-guide-actions">
            <button id="gmailUnifiedConnectBtn" class="gmail-unified-primary-btn">Connect my account</button>
          </div>
          <div class="gmail-unified-guide-helper">
            <span>No App Password yet?</span>
            <button id="gmailUnifiedConnectOpenAppBtn" class="gmail-unified-link-btn" type="button">
              Open App Passwords
            </button>
            <button id="gmailUnifiedConnectOpenTwoFactorBtn" class="gmail-unified-link-btn" type="button">
              Open 2-Step Verification
            </button>
          </div>
          <div id="gmailUnifiedConnectStatus" class="gmail-unified-connect-status"></div>
        </article>

        <section class="gmail-unified-activity-panel">
          <div class="gmail-unified-activity-header">
            <div class="gmail-unified-activity-kicker">Activity</div>
          </div>
          <pre id="gmailUnifiedActivityLog" class="gmail-unified-activity-log"></pre>
        </section>
      </div>
    </section>
  `;

  document.body.appendChild(sidebar);
  bindGuideEvents(sidebar);

  sidebarUpdateMainPanelVisibility();
}

Object.assign(globalThis, {
  bindGuideEvents,
  buildSidebar
});
