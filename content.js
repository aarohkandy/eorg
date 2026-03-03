(() => {
  "use strict";
  const contentModuleRegistry = (
    globalThis.__mailitaContentModules
    && typeof globalThis.__mailitaContentModules === "object"
  )
    ? globalThis.__mailitaContentModules
    : {};
  let debugLogChatDebug = null;
  const createRuntimeCoreApi = typeof contentModuleRegistry.createRuntimeCoreApi === "function"
    ? contentModuleRegistry.createRuntimeCoreApi
    : null;
  if (!createRuntimeCoreApi) {
    throw new Error("[reskin] Missing runtime core module. Verify content script order.");
  }
  const {
    DEBUG_THREAD_EXTRACT,
    STYLE_ID,
    ROOT_ID,
    MODE_ATTR,
    MODE_VALUE,
    THEME_ATTR,
    THEME_DARK,
    THEME_LIGHT,
    OBSERVER_DEBOUNCE_MS,
    OBSERVER_MIN_RENDER_GAP_MS,
    LIST_LIVE_RENDER_GAP_MS,
    THREAD_LIST_REFRESH_GAP_MS,
    UI_POLL_INTERVAL_MS,
    LIST_REFRESH_INTERVAL_MS,
    GMAIL_READY_SELECTORS,
    ROW_SELECTORS,
    SCOPED_ROW_SELECTORS,
    LINK_SELECTORS,
    SCOPED_LINK_SELECTORS,
    NAV_ITEMS,
    PRIMARY_NAV_HASHES,
    TRIAGE_LEVELS,
    OLD_TO_NEW_TRIAGE,
    TRIAGE_MAP_STORAGE_KEY,
    SYNC_DRAFT_STORAGE_KEY,
    SUMMARY_STORAGE_KEY,
    COL_WIDTHS_STORAGE_KEY,
    DEFAULT_COL_WIDTHS,
    MIN_COL_PX,
    MAX_COL_PX,
    RESIZE_GRIP_PX,
    SUMMARY_TTL_MS,
    SUMMARY_BATCH_SIZE,
    LOCAL_READ_HOLD_MS,
    LIST_LOAD_MORE_DISTANCE_PX,
    LIST_PREFETCH_DISTANCE_PX,
    STARTUP_FAST_LIST_LIMIT,
    STARTUP_WARM_LIST_DELAY_MS,
    STARTUP_PERF_MODE,
    ENABLE_BOOTSTRAP_SCAN_KICK,
    ENABLE_STARTUP_WARM_LIST_RENDER,
    ENABLE_DISCOVERY_ON_OPEN,
    MAILBOX_SCAN_MAX_PAGES,
    MAILBOX_SCAN_NO_CHANGE_LIMIT,
    THREAD_EXPAND_MAX_PASSES,
    THREAD_EXPAND_MAX_CLICKS_PER_PASS,
    THREAD_EXPAND_CLICK_YIELD_MS,
    THREAD_EXPAND_BODY_SETTLE_MS,
    THREAD_EXPAND_BODY_POLL_MS,
    OPTIMISTIC_RECONCILE_WINDOW_MS,
    INBOX_SDK_APP_ID,
    INBOX_SDK_THREAD_CACHE_MAX_AGE_MS,
    CHAT_DEBUG_STORAGE_KEY,
    CHAT_DEBUG_DEFAULT_ENABLED,
    LIST_MODE,
    CHAT_MODE,
    CONTACT_TIMELINE_V2_ENABLED,
    ENABLE_AI_BACKGROUND_AUTOMATION,
    ENABLE_CONTACT_MERGE_MODE,
    ENABLE_CONTACT_MERGE_LEGACY,
    ENABLE_CONTACT_GROUP_LIST,
    THREAD_READY_MAX_RETRIES,
    THREAD_READY_RETRY_BASE_MS,
    CONTACT_OPEN_FAST_ROW_LIMIT,
    CONTACT_OPEN_DEFERRED_YIELD_EVERY,
    CONTACT_OPEN_DEFERRED_BUILD_DELAY_MS,
    CONTACT_OPEN_DEEP_HYDRATION_DELAY_MS,
    CONTACT_HYDRATION_MAX_CONCURRENCY,
    INTERACTION_SCAN_COOLDOWN_MS,
    THREAD_OPEN_TRANSITION_MS,
    DEBUG_BRIDGE_REQUEST_EVENT,
    DEBUG_BRIDGE_RESPONSE_EVENT,
    DEBUG_BRIDGE_SCRIPT_ID,
    NOISE_TEXT,
    state,
    logInfo,
    logWarn,
    logOnce,
    lockInteractions,
    interactionsLocked,
    bumpInteractionEpoch,
    setActiveTask,
    mailboxScanPauseReason,
    shouldPauseMailboxScan,
    normalize,
    consumeEvent,
    escapeHtml,
    isUseful,
    extractEmail,
    extractEmails,
    normalizeEmailList
  } = createRuntimeCoreApi({
    getLogChatDebug: () => debugLogChatDebug
  });
  const shadowRefs = {
    host: null,
    root: null,
    eventLogClickBound: false
  };
  function getRoot() {
    return shadowRefs.root ? shadowRefs.root.getElementById(ROOT_ID) : null;
  }
  function resolveExtensionUrl(path) {
    const chromeRuntime =
      globalThis.chrome && globalThis.chrome.runtime && typeof globalThis.chrome.runtime.getURL === "function"
        ? globalThis.chrome.runtime
        : null;
    if (chromeRuntime) return chromeRuntime.getURL(path);
    const browserRuntime =
      globalThis.browser && globalThis.browser.runtime && typeof globalThis.browser.runtime.getURL === "function"
        ? globalThis.browser.runtime
        : null;
    if (browserRuntime) return browserRuntime.getURL(path);
    return path;
  }
  const createSchedulerApi = typeof contentModuleRegistry.createSchedulerApi === "function"
    ? contentModuleRegistry.createSchedulerApi
    : null;
  if (!createSchedulerApi) {
    throw new Error("[reskin] Missing scheduler module. Verify content script order.");
  }
  let runtimeLogEvent = () => {};
  const {
    sleep,
    yieldToMainThread,
    scheduleDeferredWork,
    scheduleHeavyWorkAfterIdle
  } = createSchedulerApi({
    logWarn,
    state,
    normalize,
    logEvent: (...args) => runtimeLogEvent(...args)
  });
  const createDebugApi = typeof contentModuleRegistry.createDebugApi === "function"
    ? contentModuleRegistry.createDebugApi
    : null;
  if (!createDebugApi) {
    throw new Error("[reskin] Missing debug module. Verify content script order.");
  }
  const {
    chatDebugEnabled,
    setChatDebugEnabled,
    summarizeChatMessageForDebug,
    summarizeChatMessagesForDebug,
    clearEventLog,
    flushEventLogToDom,
    scheduleEventLogFlush,
    logEvent,
    logTimed,
    appendToEventLog,
    logChatDebug,
    logTriageDebug
  } = createDebugApi({
    CHAT_DEBUG_STORAGE_KEY,
    CHAT_DEBUG_DEFAULT_ENABLED,
    normalize,
    extractEmail,
    normalizeEmailList,
    getRoot,
    logInfo
  });
  runtimeLogEvent = logEvent;
  debugLogChatDebug = logChatDebug;
  const createPerfApi = typeof contentModuleRegistry.createPerfApi === "function"
    ? contentModuleRegistry.createPerfApi
    : null;
  if (!createPerfApi) {
    throw new Error("[reskin] Missing perf module. Verify content script order.");
  }
  const {
    percentile,
    pushPerfSample,
    beginPerfTrace,
    markPerfStage,
    perfTraceHasStage,
    endPerfTrace,
    summarizePerfSamplesByStage,
    summarizePerfBudgets,
    installLongTaskObserver
  } = createPerfApi({
    state,
    normalize,
    logEvent
  });
  const createConversationContextApi = typeof contentModuleRegistry.createConversationContextApi === "function"
    ? contentModuleRegistry.createConversationContextApi
    : null;
  if (!createConversationContextApi) {
    throw new Error("[reskin] Missing conversation context module. Verify content script order.");
  }
  let conversationContextApi = null;
  function getConversationContextApi() {
    if (conversationContextApi) return conversationContextApi;
    conversationContextApi = createConversationContextApi({
      NOISE_TEXT,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      threadIdFromHash,
      mailboxKeyFromHash,
      lookupThreadHintHref,
      getMailboxCacheKey: () => mailboxCacheKey,
      getContactKeyFromMessage: () => contactKeyFromMessage,
      getGmailMainRoot,
      logOnce,
      logChatDebug,
      summarizeChatMessageForDebug
    });
    return conversationContextApi;
  }
  function collectEmailsFromUnknownValue(value, out = [], depth = 0, seen = new Set()) {
    return getConversationContextApi().collectEmailsFromUnknownValue(value, out, depth, seen);
  }
  function chooseLikelyAccountEmail(candidates) {
    return getConversationContextApi().chooseLikelyAccountEmail(candidates);
  }
  function collectAccountEmailCandidatesFromNode(node) {
    return getConversationContextApi().collectAccountEmailCandidatesFromNode(node);
  }
  function detectAccountEmailFromChromeControls() {
    return getConversationContextApi().detectAccountEmailFromChromeControls();
  }
  function conversationKeyFromContact(contactEmail) {
    return getConversationContextApi().conversationKeyFromContact(contactEmail);
  }
  function contactEmailFromConversationKey(conversationKey) {
    return getConversationContextApi().contactEmailFromConversationKey(conversationKey);
  }
  function activeConversationContactEmail() {
    return getConversationContextApi().activeConversationContactEmail();
  }
  function activeConversationContext(overrides = {}) {
    return getConversationContextApi().activeConversationContext(overrides);
  }
  function clearContactConversationState() {
    return getConversationContextApi().clearContactConversationState();
  }
  function activeThreadTimelineContext(overrides = {}) {
    return getConversationContextApi().activeThreadTimelineContext(overrides);
  }
  function isSelfSenderLabel(value) {
    return getConversationContextApi().isSelfSenderLabel(value);
  }
  function messagePartySnapshot(message, context = {}) {
    return getConversationContextApi().messagePartySnapshot(message, context);
  }
  function messageBelongsToConversation(message, context = {}) {
    return getConversationContextApi().messageBelongsToConversation(message, context);
  }
  function isGenericSenderLabel(value) {
    return getConversationContextApi().isGenericSenderLabel(value);
  }
  function isSystemNoReplyEmail(email) {
    return getConversationContextApi().isSystemNoReplyEmail(email);
  }
  function isLowConfidenceSender(sender) {
    return getConversationContextApi().isLowConfidenceSender(sender);
  }
  function choosePreferredSender(capturedSender, seededSender) {
    return getConversationContextApi().choosePreferredSender(capturedSender, seededSender);
  }
  function hashString(input) {
    return getConversationContextApi().hashString(input);
  }
  function detectCurrentUserEmail(force = false) {
    return getConversationContextApi().detectCurrentUserEmail(force);
  }
  function classifyMessageDirection(message, threadId = "", context = {}) {
    return getConversationContextApi().classifyMessageDirection(message, threadId, context);
  }
  const createInboxSdkApi = typeof contentModuleRegistry.createInboxSdkApi === "function"
    ? contentModuleRegistry.createInboxSdkApi
    : null;
  if (!createInboxSdkApi) {
    throw new Error("[reskin] Missing InboxSDK module. Verify content script order.");
  }
  let inboxSdkApi = null;
  function getInboxSdkApi() {
    if (inboxSdkApi) return inboxSdkApi;
    inboxSdkApi = createInboxSdkApi({
      INBOX_SDK_THREAD_CACHE_MAX_AGE_MS,
      INBOX_SDK_APP_ID,
      THREAD_BODY_PLACEHOLDER,
      THREAD_NO_CONTENT,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      hasUsefulBodyText,
      isLikelyMetadataBlob,
      cleanThreadMessageBody,
      normalizeThreadMessagesForChat,
      sleep,
      logWarn,
      getRoot,
      canonicalThreadIdForCompare,
      getDiscoverThreadIds: () => discoverThreadIds,
      getFetchAndRenderThreads: () => fetchAndRenderThreads
    });
    return inboxSdkApi;
  }
  function inboxSdkCacheKeyForThread(threadId) { return getInboxSdkApi().inboxSdkCacheKeyForThread(threadId); }
  function getInboxSdkThreadMessages(threadId) { return getInboxSdkApi().getInboxSdkThreadMessages(threadId); }
  function setInboxSdkThreadMessages(threadId, messages) { return getInboxSdkApi().setInboxSdkThreadMessages(threadId, messages); }
  function hasMeaningfulCapturedMessages(messages) { return getInboxSdkApi().hasMeaningfulCapturedMessages(messages); }
  function senderLabelFromInboxSdkContact(contact) { return getInboxSdkApi().senderLabelFromInboxSdkContact(contact); }
  function emailsFromInboxSdkContactValue(value) { return getInboxSdkApi().emailsFromInboxSdkContactValue(value); }
  async function snapshotInboxSdkThreadView(threadView) { return getInboxSdkApi().snapshotInboxSdkThreadView(threadView); }
  async function waitForInboxSdkThreadMessages(threadId, timeoutMs = 1200) { return getInboxSdkApi().waitForInboxSdkThreadMessages(threadId, timeoutMs); }
  function isFatalInboxSdkInjectionError(error) { return getInboxSdkApi().isFatalInboxSdkInjectionError(error); }
  async function ensureInboxSdkReady() { return getInboxSdkApi().ensureInboxSdkReady(); }
  const createMessageNormalizationApi = typeof contentModuleRegistry.createMessageNormalizationApi === "function"
    ? contentModuleRegistry.createMessageNormalizationApi
    : null;
  if (!createMessageNormalizationApi) {
    throw new Error("[reskin] Missing message normalization module. Verify content script order.");
  }
  let messageNormalizationApi = null;
  function getMessageNormalizationApi() {
    if (messageNormalizationApi) return messageNormalizationApi;
    messageNormalizationApi = createMessageNormalizationApi({
      THREAD_NO_CONTENT,
      OPTIMISTIC_RECONCILE_WINDOW_MS,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      canonicalThreadId,
      hashString,
      activeConversationContext,
      classifyMessageDirection,
      messagePartySnapshot,
      conversationKeyFromContact,
      activeConversationContactEmail,
      detectCurrentUserEmail,
      lookupThreadHintHref,
      getThreadHashForMailbox: () => threadHashForMailbox,
      getMergeMailboxCache: () => mergeMailboxCache,
      logChatDebug
    });
    return messageNormalizationApi;
  }
  const createMessageNormalizationForwardersApi = typeof contentModuleRegistry.createMessageNormalizationForwardersApi === "function"
    ? contentModuleRegistry.createMessageNormalizationForwardersApi
    : null;
  if (!createMessageNormalizationForwardersApi) {
    throw new Error("[reskin] Missing message normalization forwarders module. Verify content script order.");
  }
  const {
    cleanThreadMessageBody,
    isLikelyMetadataBlob,
    safeThreadFallbackText,
    normalizeMessageDateToken,
    parseThreadTimestampForOrder,
    buildFallbackMessageKey,
    messageSourceForChat,
    buildThreadMessageKey,
    normalizeThreadMessageForChat,
    normalizeThreadMessagesForChat,
    optimisticStoreKeyForThread,
    replyDraftStoreKey,
    getReplyDraft,
    setReplyDraft,
    getOptimisticMessagesForThread,
    setOptimisticMessagesForThread,
    ensureContactThreadTracked,
    formatTimeForMessageDate,
    appendLocalSentCacheEntry,
    appendOptimisticOutgoingMessage,
    removeOptimisticMessage,
    markOptimisticMessageDelivered,
    markOptimisticMessageFailed,
    updateOptimisticInMergedMessages,
    mergeOptimisticIntoMessages,
    reconcileOptimisticMessagesWithCanonical
  } = createMessageNormalizationForwardersApi({
    getMessageNormalizationApi
  });
  const createSendRefreshApi = typeof contentModuleRegistry.createSendRefreshApi === "function"
    ? contentModuleRegistry.createSendRefreshApi
    : null;
  if (!createSendRefreshApi) {
    throw new Error("[reskin] Missing send refresh module. Verify content script order.");
  }
  let sendRefreshApi = null;
  function getSendRefreshApi() {
    if (sendRefreshApi) return sendRefreshApi;
    sendRefreshApi = createSendRefreshApi({
      ENABLE_CONTACT_MERGE_MODE,
      state,
      normalize,
      canonicalThreadId,
      isContactTimelineV2Enabled,
      isContactTimelineV2Active,
      rebuildActiveContactTimelineV2,
      sleep,
      extractOpenThreadData,
      normalizeThreadMessagesForChat,
      activeConversationContext,
      reconcileOptimisticMessagesWithCanonical,
      updateOptimisticInMergedMessages,
      mergeContactMessagesByThread,
      getRoot,
      getRenderThread: () => renderThread
    });
    return sendRefreshApi;
  }
  function groupedMessagesByThreadId(messages = []) { return getSendRefreshApi().groupedMessagesByThreadId(messages); }
  async function refreshActiveThreadAfterSend(threadId, mailbox, optimisticMessage) { return getSendRefreshApi().refreshActiveThreadAfterSend(threadId, mailbox, optimisticMessage); }
  const createNavigationThreadContextApi = typeof contentModuleRegistry.createNavigationThreadContextApi === "function"
    ? contentModuleRegistry.createNavigationThreadContextApi
    : null;
  if (!createNavigationThreadContextApi) {
    throw new Error("[reskin] Missing navigation thread context module. Verify content script order.");
  }
  let navigationThreadContextApi = null;
  function getNavigationThreadContextApi() {
    if (navigationThreadContextApi) return navigationThreadContextApi;
    navigationThreadContextApi = createNavigationThreadContextApi({
      MODE_ATTR,
      MODE_VALUE,
      THEME_ATTR,
      THEME_DARK,
      THEME_LIGHT,
      TRIAGE_LEVELS,
      state,
      normalize,
      extractEmail,
      getRoot,
      lockInteractions,
      logTimed,
      getMailboxCacheKey: () => mailboxCacheKey,
      getThreadHashForMailbox: () => threadHashForMailbox,
      getOpenThread: () => openThread,
      getThreadDomReadinessSnapshot: () => threadDomReadinessSnapshot,
      getRenderCurrentView: () => renderCurrentView,
      sleep
    });
    return navigationThreadContextApi;
  }
  function looksLikeDateOrTime(text) { return getNavigationThreadContextApi().looksLikeDateOrTime(text); }
  function selectFirst(selectors) { return getNavigationThreadContextApi().selectFirst(selectors); }
  function getGmailMainRoot() { return getNavigationThreadContextApi().getGmailMainRoot(); }
  function removeLegacyNodes() { return getNavigationThreadContextApi().removeLegacyNodes(); }
  function ensureStylesheet() { return getNavigationThreadContextApi().ensureStylesheet(); }
  function ensureMode() { return getNavigationThreadContextApi().ensureMode(); }
  function normalizeTheme(value) { return getNavigationThreadContextApi().normalizeTheme(value); }
  function activeTheme() { return getNavigationThreadContextApi().activeTheme(); }
  function applyTheme(root) { return getNavigationThreadContextApi().applyTheme(root); }
  function parseListRoute(hashValue) { return getNavigationThreadContextApi().parseListRoute(hashValue); }
  function sanitizeListHash(hashValue, options = {}) { return getNavigationThreadContextApi().sanitizeListHash(hashValue, options); }
  function hashHasTriageParam(hashValue) { return getNavigationThreadContextApi().hashHasTriageParam(hashValue); }
  function activeMailbox() { return getNavigationThreadContextApi().activeMailbox(); }
  function activeTriageFilter() { return getNavigationThreadContextApi().activeTriageFilter(); }
  function getActiveNavHash() { return getNavigationThreadContextApi().getActiveNavHash(); }
  function isThreadHash(hashValue = window.location.hash) { return getNavigationThreadContextApi().isThreadHash(hashValue); }
  function threadIdFromHash(hash) { return getNavigationThreadContextApi().threadIdFromHash(hash); }
  function normalizeThreadHashForMailbox(hashValue, mailbox = "inbox") { return getNavigationThreadContextApi().normalizeThreadHashForMailbox(hashValue, mailbox); }
  function isAppSettingsHash() { return getNavigationThreadContextApi().isAppSettingsHash(); }
  function mailboxKeyFromHash(hash) { return getNavigationThreadContextApi().mailboxKeyFromHash(hash); }
  function hrefMatchesMailbox(href, mailboxKey) { return getNavigationThreadContextApi().hrefMatchesMailbox(href, mailboxKey); }
  function clickNativeMailboxLink(nativeLabel) { return getNavigationThreadContextApi().clickNativeMailboxLink(nativeLabel); }
  function navigateToList(targetHash, nativeLabel = "", options = {}) { return getNavigationThreadContextApi().navigateToList(targetHash, nativeLabel, options); }
  function openSettingsView(root) { return getNavigationThreadContextApi().openSettingsView(root); }
  function triageLabelText(level) { return getNavigationThreadContextApi().triageLabelText(level); }
  function canonicalThreadId(threadId) { return getNavigationThreadContextApi().canonicalThreadId(threadId); }
  function canonicalThreadIdForCompare(threadId) { return getNavigationThreadContextApi().canonicalThreadIdForCompare(threadId); }
  function localReadKeysForThread(threadId) { return getNavigationThreadContextApi().localReadKeysForThread(threadId); }
  function threadHintKeysForThread(threadId) { return getNavigationThreadContextApi().threadHintKeysForThread(threadId); }
  function rememberThreadNavigationHint(threadId, href = "", row = null) { return getNavigationThreadContextApi().rememberThreadNavigationHint(threadId, href, row); }
  function lookupThreadHintHref(threadId) { return getNavigationThreadContextApi().lookupThreadHintHref(threadId); }
  function lookupThreadRowHint(threadId) { return getNavigationThreadContextApi().lookupThreadRowHint(threadId); }
  function hashFromHref(href) { return getNavigationThreadContextApi().hashFromHref(href); }
  function threadContextSnapshot(threadId = "") { return getNavigationThreadContextApi().threadContextSnapshot(threadId); }
  async function waitForThreadContextForReply(threadId, timeoutMs = 3200) { return getNavigationThreadContextApi().waitForThreadContextForReply(threadId, timeoutMs); }
  async function waitForThreadDomReadyForHydration(threadId, timeoutMs = 4200) { return getNavigationThreadContextApi().waitForThreadDomReadyForHydration(threadId, timeoutMs); }
  function buildThreadContextHashCandidates(threadId, mailbox, hintHref = "") { return getNavigationThreadContextApi().buildThreadContextHashCandidates(threadId, mailbox, hintHref); }
  async function ensureThreadContextForReply(threadId, mailbox, hintHref = "") { return getNavigationThreadContextApi().ensureThreadContextForReply(threadId, mailbox, hintHref); }
  async function forceThreadContextForHydration(threadId, mailbox, hintHref = "") { return getNavigationThreadContextApi().forceThreadContextForHydration(threadId, mailbox, hintHref); }
  const createSidebarPersistenceApi = typeof contentModuleRegistry.createSidebarPersistenceApi === "function"
    ? contentModuleRegistry.createSidebarPersistenceApi
    : null;
  if (!createSidebarPersistenceApi) {
    throw new Error("[reskin] Missing sidebar persistence module. Verify content script order.");
  }
  let sidebarPersistenceApi = null;
  function getSidebarPersistenceApi() {
    if (sidebarPersistenceApi) return sidebarPersistenceApi;
    sidebarPersistenceApi = createSidebarPersistenceApi({
      LOCAL_READ_HOLD_MS,
      TRIAGE_LEVELS,
      OLD_TO_NEW_TRIAGE,
      TRIAGE_MAP_STORAGE_KEY,
      SYNC_DRAFT_STORAGE_KEY,
      SUMMARY_STORAGE_KEY,
      SUMMARY_TTL_MS,
      SUMMARY_BATCH_SIZE,
      PRIMARY_NAV_HASHES,
      NAV_ITEMS,
      state,
      normalize,
      canonicalThreadId,
      localReadKeysForThread,
      activeMailbox,
      activeTriageFilter,
      getActiveNavHash,
      triageLabelText,
      escapeHtml,
      applyReskin,
      getRoot,
      sleep,
      getMailboxCacheKey: () => mailboxCacheKey,
      getCollectMessages: () => collectMessages,
      getRenderList: () => renderList,
      logWarn,
      logTriageDebug
    });
    return sidebarPersistenceApi;
  }
  function markThreadReadLocally(threadId, holdMs = LOCAL_READ_HOLD_MS) { return getSidebarPersistenceApi().markThreadReadLocally(threadId, holdMs); }
  function isThreadMarkedReadLocally(threadId) { return getSidebarPersistenceApi().isThreadMarkedReadLocally(threadId); }
  function clearUnreadClassesInRow(row) { return getSidebarPersistenceApi().clearUnreadClassesInRow(row); }
  function markThreadsReadLocally(threadIds, rows = []) { return getSidebarPersistenceApi().markThreadsReadLocally(threadIds, rows); }
  function triageLocalGet(threadId) { return getSidebarPersistenceApi().triageLocalGet(threadId); }
  function triageLocalSet(threadId, level) { return getSidebarPersistenceApi().triageLocalSet(threadId, level); }
  function normalizePersistedTriageMap(input) { return getSidebarPersistenceApi().normalizePersistedTriageMap(input); }
  async function loadPersistedTriageMap() { return getSidebarPersistenceApi().loadPersistedTriageMap(); }
  async function loadSyncDraft() { return getSidebarPersistenceApi().loadSyncDraft(); }
  function schedulePersistSyncDraft() { return getSidebarPersistenceApi().schedulePersistSyncDraft(); }
  function schedulePersistTriageMap() { return getSidebarPersistenceApi().schedulePersistTriageMap(); }
  function summaryThreadKey(threadId) { return getSidebarPersistenceApi().summaryThreadKey(threadId); }
  function normalizePersistedSummaryMap(input) { return getSidebarPersistenceApi().normalizePersistedSummaryMap(input); }
  async function loadPersistedSummaries() { return getSidebarPersistenceApi().loadPersistedSummaries(); }
  function schedulePersistSummaries() { return getSidebarPersistenceApi().schedulePersistSummaries(); }
  function getSummaryForMessage(msg) { return getSidebarPersistenceApi().getSummaryForMessage(msg); }
  function summaryBackoffMsFromError(error) { return getSidebarPersistenceApi().summaryBackoffMsFromError(error); }
  function findMessageForSummary(threadId) { return getSidebarPersistenceApi().findMessageForSummary(threadId); }
  function queueSummariesForMessages(messages) { return getSidebarPersistenceApi().queueSummariesForMessages(messages); }
  async function runSummaryWorker(root) { return getSidebarPersistenceApi().runSummaryWorker(root); }
  function getTriageLevelForMessage(msg) { return getSidebarPersistenceApi().getTriageLevelForMessage(msg); }
  function threadIdInServer(threadId, server) { return getSidebarPersistenceApi().threadIdInServer(threadId, server); }
  function getCurrentServerThreadIds() { return getSidebarPersistenceApi().getCurrentServerThreadIds(); }
  function renderSidebar(root) { return getSidebarPersistenceApi().renderSidebar(root); }
  const createRightRailSyncApi = typeof contentModuleRegistry.createRightRailSyncApi === "function"
    ? contentModuleRegistry.createRightRailSyncApi
    : null;
  if (!createRightRailSyncApi) {
    throw new Error("[reskin] Missing right rail/sync module. Verify content script order.");
  }
  let rightRailSyncApi = null;
  function getRightRailSyncApi() {
    if (rightRailSyncApi) return rightRailSyncApi;
    rightRailSyncApi = createRightRailSyncApi({
      THREAD_MESSAGE_SELECTORS,
      BODY_SELECTORS,
      state,
      normalize,
      escapeHtml,
      applyReskin,
      getMailboxCacheKey: () => mailboxCacheKey,
      getRunFullMailboxScan: () => runFullMailboxScan,
      getGetMailboxMessages: () => getMailboxMessages,
      selectMessagesForQuestion,
      logWarn,
      isAppSettingsHash,
      isThreadHash,
      getGmailMainRoot,
      isContactTimelineV2Active,
      canonicalThreadId,
      threadIdFromHash,
      bumpInteractionEpoch,
      clearContactConversationState,
      parseListRoute,
      sanitizeListHash,
      hashHasTriageParam,
      logChatDebug,
      normalizeThreadHashForMailbox,
      mailboxKeyFromHash
    });
    return rightRailSyncApi;
  }
  function renderRightRail(root) { return getRightRailSyncApi().renderRightRail(root); }
  function buildInboxQuestionPrompt(question, messages) { return getRightRailSyncApi().buildInboxQuestionPrompt(question, messages); }
  async function askInboxQuestion(root) { return getRightRailSyncApi().askInboxQuestion(root); }
  function syncViewFromHash() { return getRightRailSyncApi().syncViewFromHash(); }
  const createBootstrapRuntimeApi = typeof contentModuleRegistry.createBootstrapRuntimeApi === "function"
    ? contentModuleRegistry.createBootstrapRuntimeApi
    : null;
  if (!createBootstrapRuntimeApi) {
    throw new Error("[reskin] Missing bootstrap runtime module. Verify content script order.");
  }
  const {
    getColumnWidths,
    saveColumnWidths,
    applyColumnWidths,
    ensureRoot,
    applyReskin,
    startShadowGuardian,
    waitForReady,
    buildChatDebugApi,
    installDebugBridgeListener,
    installPageDebugBridge,
    exposeChatDebugControls
  } = createBootstrapRuntimeApi({
    ROOT_ID,
    COL_WIDTHS_STORAGE_KEY,
    DEFAULT_COL_WIDTHS,
    MIN_COL_PX,
    MAX_COL_PX,
    GMAIL_READY_SELECTORS,
    STARTUP_PERF_MODE,
    ENABLE_BOOTSTRAP_SCAN_KICK,
    LIST_MODE,
    CHAT_MODE,
    DEBUG_BRIDGE_REQUEST_EVENT,
    DEBUG_BRIDGE_RESPONSE_EVENT,
    DEBUG_BRIDGE_SCRIPT_ID,
    state,
    normalize,
    extractEmail,
    getRoot,
    shadowRefs,
    resolveExtensionUrl,
    consumeEvent,
    clearEventLog,
    logEvent,
    logInfo,
    logWarn,
    logChatDebug,
    bindRootEvents,
    openSettingsView,
    ensureStylesheet,
    ensureMode,
    applyTheme,
    syncViewFromHash,
    renderCurrentView,
    removeLegacyNodes,
    scheduleDeferredWork,
    scheduleHeavyWorkAfterIdle,
    loadPersistedTriageMap,
    loadPersistedSummaries,
    ensureInboxSdkReady,
    getScheduleMailboxScanKick: () => scheduleMailboxScanKick,
    selectFirst,
    activeThreadTimelineContext,
    getIsContactTimelineV2Enabled: () => isContactTimelineV2Enabled,
    summarizeChatMessagesForDebug,
    getMailboxCacheKey: () => mailboxCacheKey,
    summarizePerfSamplesByStage,
    summarizePerfBudgets,
    installLongTaskObserver,
    setChatDebugEnabled,
    chatDebugEnabled,
    detectCurrentUserEmail
  });
  const createUiControlsApi = typeof contentModuleRegistry.createUiControlsApi === "function"
    ? contentModuleRegistry.createUiControlsApi
    : null;
  if (!createUiControlsApi) {
    throw new Error("[reskin] Missing UI controls module. Verify content script order.");
  }
  let uiControlsApi = null;
  function getUiControlsApi() {
    if (uiControlsApi) return uiControlsApi;
    uiControlsApi = createUiControlsApi({
      THEME_DARK,
      MIN_COL_PX,
      MAX_COL_PX,
      TRIAGE_LEVELS,
      state,
      normalize,
      normalizeTheme,
      applyTheme,
      applyReskin,
      consumeEvent,
      openSettingsView,
      askInboxQuestion,
      submitThreadReply,
      bumpInteractionEpoch,
      setActiveTask,
      clearContactConversationState,
      sanitizeListHash,
      navigateToList,
      lockInteractions,
      mailboxCacheKey,
      parseListRoute,
      getRoot,
      threadIdInServer,
      escapeHtml,
      canonicalThreadId,
      schedulePersistSyncDraft,
      activeMailbox,
      applyColumnWidths,
      getColumnWidths,
      saveColumnWidths,
      getRenderCurrentView: () => renderCurrentView,
      getRenderSettings: () => renderSettings,
      getRenderList: () => renderList,
      logWarn
    });
    return uiControlsApi;
  }
  async function loadSettingsCached(force = false) { return getUiControlsApi().loadSettingsCached(force); }
  async function saveSettingsFromDom(root, options = {}) { return getUiControlsApi().saveSettingsFromDom(root, options); }
  function scheduleSettingsAutosave(root, delayMs = 650) { return getUiControlsApi().scheduleSettingsAutosave(root, delayMs); }
  function defaultModelForProvider(provider) { return getUiControlsApi().defaultModelForProvider(provider); }
  function apiKeyPlaceholderForProvider(provider) { return getUiControlsApi().apiKeyPlaceholderForProvider(provider); }
  function providerNeedsApiKey(provider) { return getUiControlsApi().providerNeedsApiKey(provider); }
  function buildApiKeyGuide(provider) { return getUiControlsApi().buildApiKeyGuide(provider); }
  function openApiKeyGuidePrompt(root) { return getUiControlsApi().openApiKeyGuidePrompt(root); }
  function applyProviderDefaultsToSettingsForm(root) { return getUiControlsApi().applyProviderDefaultsToSettingsForm(root); }
  function bindRootEvents(root) { return getUiControlsApi().bindRootEvents(root); }
  const createThreadReplyApi = typeof contentModuleRegistry.createThreadReplyApi === "function"
    ? contentModuleRegistry.createThreadReplyApi
    : null;
  if (!createThreadReplyApi) {
    throw new Error("[reskin] Missing thread reply module. Verify content script order.");
  }
  let threadReplyApi = null;
  function getThreadReplyApi() {
    if (threadReplyApi) return threadReplyApi;
    threadReplyApi = createThreadReplyApi({
      ENABLE_CONTACT_MERGE_MODE,
      ENABLE_CONTACT_MERGE_LEGACY,
      state,
      normalize,
      canonicalThreadId,
      threadIdFromHash,
      getReplyDraft,
      setReplyDraft,
      parseListRoute,
      activeConversationContext,
      lookupThreadHintHref,
      bumpInteractionEpoch,
      setActiveTask,
      detectCurrentUserEmail,
      appendOptimisticOutgoingMessage,
      ensureContactThreadTracked,
      isContactTimelineV2Enabled,
      isContactTimelineV2Active,
      rebuildActiveContactTimelineV2,
      groupedMessagesByThreadId,
      mergeContactMessagesByThread,
      getRoot,
      getRenderThread: () => renderThread,
      ensureThreadContextForReply,
      refreshActiveThreadAfterSend,
      markOptimisticMessageDelivered,
      updateOptimisticInMergedMessages,
      appendLocalSentCacheEntry,
      markOptimisticMessageFailed,
      logChatDebug,
      logWarn
    });
    return threadReplyApi;
  }
  function normalizeReplyResult(result) { return getThreadReplyApi().normalizeReplyResult(result); }
  function isLikelyHashThreadId(threadId) { return getThreadReplyApi().isLikelyHashThreadId(threadId); }
  async function submitThreadReply(root) { return getThreadReplyApi().submitThreadReply(root); }
  const createMailboxDomScanApi = typeof contentModuleRegistry.createMailboxDomScanApi === "function"
    ? contentModuleRegistry.createMailboxDomScanApi
    : null;
  if (!createMailboxDomScanApi) {
    throw new Error("[reskin] Missing mailbox DOM scan module. Verify content script order.");
  }
  let mailboxDomScanApi = null;
  function getMailboxDomScanApi() {
    if (mailboxDomScanApi) return mailboxDomScanApi;
    mailboxDomScanApi = createMailboxDomScanApi({
      STARTUP_PERF_MODE,
      ROW_SELECTORS,
      SCOPED_ROW_SELECTORS,
      NOISE_TEXT,
      MAILBOX_SCAN_MAX_PAGES,
      MAILBOX_SCAN_NO_CHANGE_LIMIT,
      INTERACTION_SCAN_COOLDOWN_MS,
      NAV_ITEMS,
      state,
      normalize,
      extractEmail,
      normalizeEmailList,
      isUseful,
      looksLikeDateOrTime,
      isGenericSenderLabel,
      canonicalThreadId,
      hashFromHref,
      mailboxKeyFromHash,
      normalizeThreadHashForMailbox,
      threadHintKeysForThread,
      getGmailMainRoot,
      sleep,
      logTimed,
      logWarn,
      logEvent,
      setActiveTask,
      mailboxScanPauseReason,
      shouldPauseMailboxScan,
      activeConversationContext,
      expandContactGroupWithCachedCounterparts,
      getLoadContactChat: () => loadContactChat,
      getRenderCurrentView: () => renderCurrentView,
      getRenderList: () => renderList,
      getRenderSidebar: () => renderSidebar,
      activeMailbox,
      navigateToList,
      getMailboxCacheKey: () => mailboxCacheKey,
      parseListRoute,
      getCollectMessages: () => collectMessages,
      getMergeMailboxCache: () => mergeMailboxCache,
      getRoot,
      scheduleHeavyWorkAfterIdle
    });
    return mailboxDomScanApi;
  }
  const createMailboxDomForwardersApi = typeof contentModuleRegistry.createMailboxDomForwardersApi === "function"
    ? contentModuleRegistry.createMailboxDomForwardersApi
    : null;
  if (!createMailboxDomForwardersApi) {
    throw new Error("[reskin] Missing mailbox DOM forwarders module. Verify content script order.");
  }
  const {
    selectRows,
    extractThreadIdFromRow,
    threadIdFromHref,
    fallbackThreadIdFromRow,
    messageDedupeKey,
    extractSender,
    extractRowRecipientEmails,
    extractDate,
    extractSnippet,
    extractSubject,
    firstPageFingerprint,
    isElementVisible,
    isDisabledButton,
    findPagerButton,
    dispatchSyntheticClick,
    updateMailboxScanProgress,
    schedulerScanToken,
    scheduleMailboxScanKick,
    waitForPageChange,
    scanMailboxPages,
    queueMailboxScan,
    runMailboxScanQueue,
    runFullMailboxScan,
    parseLastCountQuery,
    parseFromDateQuery,
    parseKeywordQuery,
    selectMessagesForQuestion,
    openThread
  } = createMailboxDomForwardersApi({
    getMailboxDomScanApi
  });
  const createMailboxDataApi = typeof contentModuleRegistry.createMailboxDataApi === "function"
    ? contentModuleRegistry.createMailboxDataApi
    : null;
  if (!createMailboxDataApi) {
    throw new Error("[reskin] Missing mailbox data module. Verify content script order.");
  }
  const {
    cleanSubject,
    collectMessages,
    mailboxCacheKey,
    messageCacheKey,
    canonicalThreadKey,
    canonicalRowKey,
    scoreMailboxMessageCandidate,
    mergeMailboxCache,
    getMailboxMessages,
    dedupeMessagesStable,
    mailboxMessagesForList,
    chatScopeMessages
  } = createMailboxDataApi({
    normalize,
    isUseful,
    getGmailMainRoot,
    SCOPED_LINK_SELECTORS,
    LINK_SELECTORS,
    selectRows,
    mailboxKeyFromHash,
    state,
    extractThreadIdFromRow,
    threadIdFromHref,
    fallbackThreadIdFromRow,
    messageDedupeKey,
    extractSender,
    extractEmail,
    extractRowRecipientEmails,
    extractDate,
    extractSubject,
    extractSnippet,
    hrefMatchesMailbox,
    isThreadMarkedReadLocally,
    canonicalThreadId,
    hashFromHref,
    normalizeEmailList,
    normalizeMessageDateToken,
    hashString,
    isLikelyMetadataBlob,
    getScheduleActiveContactTimelineRefreshV2: () => scheduleActiveContactTimelineRefreshV2,
    logTimed
  });
  const THREAD_MESSAGE_SELECTORS = [
    "[data-message-id]",
    "[data-legacy-message-id]",
    ".adn[data-message-id]",
    ".adn[data-legacy-message-id]",
    ".h7 .adn",
    ".nH.hx .adn",
    '[role="main"] .adn',
    '[role="listitem"][data-message-id]',
    '[role="listitem"][data-legacy-message-id]'
  ].join(", ");
  const STRICT_BODY_SELECTORS = [
    ".a3s.aiL",
    ".a3s",
    ".ii.gt .a3s.aiL",
    ".ii.gt .a3s",
    "div[dir='ltr'].a3s.aiL",
    "div[dir='ltr'].a3s",
    "[data-legacy-message-id] .a3s.aiL",
    "[data-legacy-message-id] .a3s",
    "[data-message-id] .a3s.aiL",
    "[data-message-id] .a3s",
    ".adn .a3s.aiL",
    ".adn .a3s",
    ".adn [data-message-id] .a3s.aiL",
    ".adn [data-message-id] .a3s"
  ];
  const SECONDARY_BODY_SELECTORS = [
    ".ii.gt > .a3s",
    ".adn .a3s",
    ".adn .ii.gt .a3s",
    ".h7 .a3s"
  ];
  const BODY_SELECTORS = Array.from(
    new Set([...STRICT_BODY_SELECTORS, ...SECONDARY_BODY_SELECTORS])
  ).join(", ");
  const THREAD_BODY_PLACEHOLDER = "Message body not captured yet.";
  const THREAD_NO_CONTENT = "No content";
  const createThreadDomExtractApi = typeof contentModuleRegistry.createThreadDomExtractApi === "function"
    ? contentModuleRegistry.createThreadDomExtractApi
    : null;
  if (!createThreadDomExtractApi) {
    throw new Error("[reskin] Missing thread DOM extraction module. Verify content script order.");
  }
  const {
    threadDomReadinessSnapshot,
    waitForThreadContentReady,
    canExpandThreadContentNow,
    collectThreadExpandTargets,
    collectCollapsedThreadMessageHeaders,
    expandCollapsedThreadMessagesForExtraction,
    hasUsefulBodyText,
    findFirstBodyNode,
    findBodyNodeInScope,
    findBodyNodeInScopeIframes,
    threadSnippetFallback,
    alphaRatio,
    extractMessageBodyFromScope,
    extractOpenThreadData
  } = createThreadDomExtractApi({
    state,
    THREAD_MESSAGE_SELECTORS,
    BODY_SELECTORS,
    STRICT_BODY_SELECTORS,
    SECONDARY_BODY_SELECTORS,
    THREAD_BODY_PLACEHOLDER,
    THREAD_NO_CONTENT,
    THREAD_READY_MAX_RETRIES,
    THREAD_READY_RETRY_BASE_MS,
    THREAD_EXPAND_MAX_PASSES,
    THREAD_EXPAND_MAX_CLICKS_PER_PASS,
    getGmailMainRoot,
    normalize,
    threadIdFromHash,
    isThreadHash,
    isElementVisible,
    isDisabledButton,
    dispatchSyntheticClick,
    sleep,
    logChatDebug,
    threadHintKeysForThread,
    canonicalThreadId,
    cleanThreadMessageBody,
    safeThreadFallbackText,
    isLikelyMetadataBlob,
    getInboxSdkThreadMessages,
    extractEmail,
    detectCurrentUserEmail,
    isSelfSenderLabel,
    normalizeEmailList,
    isUseful,
    looksLikeDateOrTime,
    isGenericSenderLabel,
    hasMeaningfulCapturedMessages,
    cleanSubject,
    normalizeThreadMessagesForChat,
    hashString,
    logWarn
  });
  const createThreadHydrationApi = typeof contentModuleRegistry.createThreadHydrationApi === "function"
    ? contentModuleRegistry.createThreadHydrationApi
    : null;
  if (!createThreadHydrationApi) {
    throw new Error("[reskin] Missing thread hydration module. Verify content script order.");
  }
  const {
    initialForSender,
    contactKeyFromMessage,
    senderDisplayName,
    messageDateSortValue,
    compareMailboxRowsNewestFirst,
    mailboxRowMatchesContactConversation,
    expandContactGroupWithCachedCounterparts,
    groupMessagesByContact,
    threadHashForMailbox,
    applySnippetFallbackToMessages,
    scoreExtractedMessages,
    gmailAccountIndex,
    hexThreadIdForThread,
    getThreadCache,
    setThreadCache,
    fetchThreadPrintView,
    extractMessagesFromPrintView,
    hydrateThreadFromPrintView,
    captureThreadDataWithRetry
  } = createThreadHydrationApi({
    state,
    THREAD_BODY_PLACEHOLDER,
    THREAD_NO_CONTENT,
    THREAD_EXPAND_MAX_PASSES,
    THREAD_EXPAND_MAX_CLICKS_PER_PASS,
    normalize,
    extractEmail,
    normalizeEmailList,
    canonicalThreadId,
    mailboxCacheKey,
    isSelfSenderLabel,
    isGenericSenderLabel,
    activeConversationContext,
    conversationKeyFromContact,
    dedupeMessagesStable,
    collectMessages,
    detectCurrentUserEmail,
    hashFromHref,
    normalizeThreadHashForMailbox,
    isThreadHash,
    lookupThreadHintHref,
    lookupThreadRowHint,
    logTimed,
    logChatDebug,
    logWarn,
    sleep,
    parseThreadTimestampForOrder,
    threadContextSnapshot,
    ensureInboxSdkReady,
    ensureThreadContextForReply,
    forceThreadContextForHydration,
    waitForThreadDomReadyForHydration,
    waitForInboxSdkThreadMessages,
    getInboxSdkThreadMessages,
    hasMeaningfulCapturedMessages,
    normalizeThreadMessagesForChat,
    threadSnippetFallback,
    hasUsefulBodyText,
    expandCollapsedThreadMessagesForExtraction,
    extractOpenThreadData
  });
  const createContactChatHydrationApi = typeof contentModuleRegistry.createContactChatHydrationApi === "function"
    ? contentModuleRegistry.createContactChatHydrationApi
    : null;
  if (!createContactChatHydrationApi) {
    throw new Error("[reskin] Missing contact chat hydration module. Verify content script order.");
  }
  let contactChatHydrationApi = null;
  function getContactChatHydrationApi() {
    if (contactChatHydrationApi) return contactChatHydrationApi;
    contactChatHydrationApi = createContactChatHydrationApi({
      STARTUP_PERF_MODE,
      ENABLE_DISCOVERY_ON_OPEN,
      CONTACT_HYDRATION_MAX_CONCURRENCY,
      THREAD_BODY_PLACEHOLDER,
      state,
      normalize,
      extractEmail,
      canonicalThreadId,
      normalizeMessageDateToken,
      hashString,
      normalizeThreadMessagesForChat,
      messageBelongsToConversation,
      activeConversationContext,
      summarizeChatMessagesForDebug,
      logChatDebug,
      logTimed,
      logEvent,
      logWarn,
      mailboxCacheKey,
      parseListRoute,
      sanitizeListHash,
      detectCurrentUserEmail,
      expandContactGroupWithCachedCounterparts,
      rememberThreadNavigationHint,
      lookupThreadHintHref,
      markThreadsReadLocally,
      senderDisplayName,
      conversationKeyFromContact,
      isContactTimelineV2Enabled,
      scheduleMailboxScanKick,
      bumpInteractionEpoch,
      hydrateThreadFromPrintView,
      getThreadCache,
      hexThreadIdForThread,
      choosePreferredSender,
      applySnippetFallbackToMessages,
      hasMeaningfulCapturedMessages,
      isUseful,
      safeThreadFallbackText,
      markPerfStage,
      endPerfTrace,
      getRoot,
      getRenderList: () => renderList,
      getRenderCurrentView: () => renderCurrentView,
      getRenderThread: () => renderThread,
      getKickContactDiscovery: () => kickContactDiscovery,
      scheduleHeavyWorkAfterIdle
    });
    return contactChatHydrationApi;
  }
  function contactMessageSourceRank(message) {
    return getContactChatHydrationApi().contactMessageSourceRank(message);
  }
  function mergeContactMessagesByThread(threadIds, byThread, context = {}) {
    return getContactChatHydrationApi().mergeContactMessagesByThread(threadIds, byThread, context);
  }
  function buildSeededMessagesByThread(group) {
    return getContactChatHydrationApi().buildSeededMessagesByThread(group);
  }
  async function waitForRowStability(getCount, options = {}) {
    return getContactChatHydrationApi().waitForRowStability(getCount, options);
  }
  async function discoverThreadIds(email, signal) {
    return getContactChatHydrationApi().discoverThreadIds(email, signal);
  }
  function appendMessagesToTimeline(messages, root) {
    return getContactChatHydrationApi().appendMessagesToTimeline(messages, root);
  }
  async function fetchAndRenderThreads(threadIds, root) {
    return getContactChatHydrationApi().fetchAndRenderThreads(threadIds, root);
  }
  function loadContactChat(group, root, options = {}) {
    return getContactChatHydrationApi().loadContactChat(group, root, options);
  }
  const createContactTimelineCoreApi = typeof contentModuleRegistry.createContactTimelineCoreApi === "function"
    ? contentModuleRegistry.createContactTimelineCoreApi
    : null;
  if (!createContactTimelineCoreApi) {
    throw new Error("[reskin] Missing contact timeline core module. Verify content script order.");
  }
  const {
    isContactTimelineV2Enabled,
    isContactTimelineV2Active,
    contactTimelineSourceRank,
    parseTimelineRowTimestampMs,
    normalizeTimelineRowMessageV2,
    messageBelongsToContactTimelineV2,
    buildContactTimelineFromRows,
    buildContactTimelineFromRowsChunked
  } = createContactTimelineCoreApi({
    ENABLE_CONTACT_MERGE_MODE,
    CONTACT_TIMELINE_V2_ENABLED,
    CONTACT_OPEN_DEFERRED_YIELD_EVERY,
    state,
    normalize,
    activeConversationContext,
    mailboxCacheKey,
    canonicalThreadId,
    extractEmail,
    normalizeEmailList,
    normalizeMessageDateToken,
    parseThreadTimestampForOrder,
    messageDateSortValue,
    hashString,
    hashFromHref,
    normalizeThreadMessageForChat,
    detectCurrentUserEmail,
    messagePartySnapshot,
    contactKeyFromMessage,
    isSelfSenderLabel,
    summarizeChatMessagesForDebug,
    yieldToMainThread
  });
  const createContactTimelineStateApi = typeof contentModuleRegistry.createContactTimelineStateApi === "function"
    ? contentModuleRegistry.createContactTimelineStateApi
    : null;
  if (!createContactTimelineStateApi) {
    throw new Error("[reskin] Missing contact timeline state module. Verify content script order.");
  }
  const {
    buildActiveContactTimelineV2,
    applyActiveContactTimelineV2,
    rebuildActiveContactTimelineV2,
    scheduleActiveContactTimelineRefreshV2
  } = createContactTimelineStateApi({
    INTERACTION_SCAN_COOLDOWN_MS,
    state,
    normalize,
    extractEmail,
    activeConversationContext,
    activeConversationContactEmail,
    collectMessages,
    mailboxCacheKey,
    getOptimisticMessagesForThread,
    buildContactTimelineFromRows,
    canonicalThreadId,
    reconcileOptimisticMessagesWithCanonical,
    getRoot,
    getRenderThread: () => renderThread,
    logChatDebug,
    isContactTimelineV2Enabled,
    isContactTimelineV2Active
  });
  const createContactOpenApi = typeof contentModuleRegistry.createContactOpenApi === "function"
    ? contentModuleRegistry.createContactOpenApi
    : null;
  if (!createContactOpenApi) {
    throw new Error("[reskin] Missing contact open module. Verify content script order.");
  }
  const {
    buildContactTimelineFastSeed,
    kickContactDiscovery,
    triggerPendingContactDiscovery,
    markOpenPaintStages,
    scheduleContactTimelineDeferredBuild,
    openContactTimelineFromRowV2
  } = createContactOpenApi({
    STARTUP_PERF_MODE,
    ENABLE_DISCOVERY_ON_OPEN,
    CONTACT_OPEN_FAST_ROW_LIMIT,
    CONTACT_OPEN_DEFERRED_YIELD_EVERY,
    CONTACT_OPEN_DEFERRED_BUILD_DELAY_MS,
    CONTACT_OPEN_DEEP_HYDRATION_DELAY_MS,
    THREAD_OPEN_TRANSITION_MS,
    state,
    normalize,
    extractEmail,
    canonicalThreadId,
    canonicalRowKey,
    mailboxRowMatchesContactConversation,
    mailboxCacheKey,
    buildContactTimelineFromRows,
    buildContactTimelineFromRowsChunked,
    normalizeTimelineRowMessageV2,
    activeConversationContext,
    conversationKeyFromContact,
    detectCurrentUserEmail,
    applyActiveContactTimelineV2,
    lookupThreadHintHref,
    senderDisplayName,
    sanitizeListHash,
    rememberThreadNavigationHint,
    markThreadsReadLocally,
    scheduleMailboxScanKick,
    logChatDebug,
    threadHashForMailbox,
    getRenderCurrentView: () => renderCurrentView,
    getRenderThread: () => renderThread,
    perfTraceHasStage,
    markPerfStage,
    getRoot,
    discoverThreadIds,
    canonicalThreadIdForCompare,
    fetchAndRenderThreads,
    logEvent,
    logWarn,
    loadContactChat,
    collectMessages,
    bumpInteractionEpoch,
    beginPerfTrace,
    contactKeyFromMessage,
    isContactTimelineV2Enabled,
    scheduleHeavyWorkAfterIdle
  });
  const createContactOpenLegacyApi = typeof contentModuleRegistry.createContactOpenLegacyApi === "function"
    ? contentModuleRegistry.createContactOpenLegacyApi
    : null;
  if (!createContactOpenLegacyApi) {
    throw new Error("[reskin] Missing contact open legacy module. Verify content script order.");
  }
  const {
    openContactChatFromRowLegacy,
    openContactChatFromRow
  } = createContactOpenLegacyApi({
    ENABLE_CONTACT_MERGE_MODE,
    state,
    normalize,
    extractEmail,
    canonicalThreadId,
    contactKeyFromMessage,
    mailboxCacheKey,
    collectMessages,
    chatScopeMessages,
    dedupeMessagesStable,
    activeConversationContext,
    detectCurrentUserEmail,
    conversationKeyFromContact,
    mailboxRowMatchesContactConversation,
    groupMessagesByContact,
    senderDisplayName,
    compareMailboxRowsNewestFirst,
    loadContactChat,
    isContactTimelineV2Enabled,
    openContactTimelineFromRowV2,
    logChatDebug
  });
  const createThreadHtmlUtilsApi = typeof contentModuleRegistry.createThreadHtmlUtilsApi === "function"
    ? contentModuleRegistry.createThreadHtmlUtilsApi
    : null;
  if (!createThreadHtmlUtilsApi) {
    throw new Error("[reskin] Missing thread HTML utils module. Verify content script order.");
  }
  const {
    stripGmailHtmlToClean: stripGmailHtmlToCleanShared,
    sanitizeForShadow: sanitizeForShadowShared,
    SHADOW_EMBED_STYLE: SHADOW_EMBED_STYLE_SHARED
  } = createThreadHtmlUtilsApi({
    escapeHtml
  });
  const createUiThreadListApi = typeof contentModuleRegistry.createUiThreadListApi === "function"
    ? contentModuleRegistry.createUiThreadListApi
    : null;
  if (!createUiThreadListApi) {
    throw new Error("[reskin] Missing UI thread/list module. Verify content script order.");
  }
  let uiThreadListApi = null;
  function getUiThreadListApi() {
    if (uiThreadListApi) return uiThreadListApi;
    uiThreadListApi = createUiThreadListApi({
      DEBUG_THREAD_EXTRACT,
      ENABLE_AI_BACKGROUND_AUTOMATION,
      ENABLE_CONTACT_GROUP_LIST,
      ENABLE_CONTACT_MERGE_LEGACY,
      ENABLE_CONTACT_MERGE_MODE,
      LIST_LOAD_MORE_DISTANCE_PX,
      LIST_PREFETCH_DISTANCE_PX,
      STARTUP_FAST_LIST_LIMIT,
      STARTUP_WARM_LIST_DELAY_MS,
      STARTUP_PERF_MODE,
      ENABLE_STARTUP_WARM_LIST_RENDER,
      THEME_DARK,
      THEME_LIGHT,
      THREAD_BODY_PLACEHOLDER,
      THREAD_LIST_REFRESH_GAP_MS,
      THREAD_NO_CONTENT,
      THREAD_READY_MAX_RETRIES,
      THREAD_READY_RETRY_BASE_MS,
      TRIAGE_LEVELS,
      state,
      normalize,
      escapeHtml,
      parseListRoute,
      hashHasTriageParam,
      loadSettingsCached,
      mailboxCacheKey,
      collectMessages,
      mergeMailboxCache,
      mailboxMessagesForList,
      getTriageLevelForMessage,
      threadIdInServer,
      chatScopeMessages,
      groupMessagesByContact,
      interactionsLocked,
      threadHintKeysForThread,
      rememberThreadNavigationHint,
      getSummaryForMessage,
      scheduleMailboxScanKick,
      triageLabelText,
      lockInteractions,
      bumpInteractionEpoch,
      setActiveTask,
      beginPerfTrace,
      markPerfStage,
      extractEmail,
      canonicalThreadId,
      openContactTimelineFromRowV2,
      triggerPendingContactDiscovery,
      loadContactChat,
      clearContactConversationState,
      openContactChatFromRow,
      lookupThreadHintHref,
      openThread,
      logChatDebug,
      logWarn,
      markThreadsReadLocally,
      getRoot,
      queueSummariesForMessages,
      getReplyDraft,
      setReplyDraft,
      submitThreadReply,
      applyReskin,
      scheduleDeferredWork,
      activeMailbox,
      isContactTimelineV2Enabled,
      activeConversationContext,
      normalizeThreadMessagesForChat,
      extractOpenThreadData,
      mergeOptimisticIntoMessages,
      senderDisplayName,
      activeConversationContactEmail,
      initialForSender,
      summarizeChatMessagesForDebug,
      logEvent,
      isGenericSenderLabel,
      hasUsefulBodyText,
      threadIdFromHash,
      isThreadHash,
      waitForThreadContentReady,
      threadHashForMailbox,
      sleep,
      normalizeTheme,
      providerNeedsApiKey,
      apiKeyPlaceholderForProvider,
      buildApiKeyGuide,
      loadPersistedTriageMap,
      getMailboxMessages,
      runFullMailboxScan,
      selectMessagesForQuestion,
      logTriageDebug,
      triageLocalSet,
      isAppSettingsHash,
      logInfo,
      renderSidebar,
      renderRightRail,
      stripGmailHtmlToClean: stripGmailHtmlToCleanShared,
      sanitizeForShadow: sanitizeForShadowShared,
      SHADOW_EMBED_STYLE: SHADOW_EMBED_STYLE_SHARED
    });
    return uiThreadListApi;
  }
  function stripGmailHtmlToClean(html) { return getUiThreadListApi().stripGmailHtmlToClean(html); }
  function sanitizeForShadow(html) { return getUiThreadListApi().sanitizeForShadow(html); }
  const SHADOW_EMBED_STYLE = "";
  function renderThread(root) { return getUiThreadListApi().renderThread(root); }
  async function runTriageForInbox(options = {}) { return getUiThreadListApi().runTriageForInbox(options); }
  function renderCurrentView(root) { return getUiThreadListApi().renderCurrentView(root); }
  function renderSettings(root) { return getUiThreadListApi().renderSettings(root); }
  function scheduleStartupWarmListRender(reason = "") { return getUiThreadListApi().scheduleStartupWarmListRender(reason); }
  function renderList(root) { return getUiThreadListApi().renderList(root); }
  exposeChatDebugControls();
  waitForReady();
})();
