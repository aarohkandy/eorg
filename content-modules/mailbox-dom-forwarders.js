(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createMailboxDomForwardersApi = function createMailboxDomForwardersApi(deps = {}) {
    const { getMailboxDomScanApi } = deps;

    function selectRows(scopeRoot) { return getMailboxDomScanApi().selectRows(scopeRoot); }
    function extractThreadIdFromRow(row) { return getMailboxDomScanApi().extractThreadIdFromRow(row); }
    function threadIdFromHref(href) { return getMailboxDomScanApi().threadIdFromHref(href); }
    function fallbackThreadIdFromRow(row, index = 0) { return getMailboxDomScanApi().fallbackThreadIdFromRow(row, index); }
    function messageDedupeKey(threadId, href) { return getMailboxDomScanApi().messageDedupeKey(threadId, href); }
    function extractSender(row) { return getMailboxDomScanApi().extractSender(row); }
    function extractRowRecipientEmails(row, sender = "") { return getMailboxDomScanApi().extractRowRecipientEmails(row, sender); }
    function extractDate(row) { return getMailboxDomScanApi().extractDate(row); }
    function extractSnippet(row) { return getMailboxDomScanApi().extractSnippet(row); }
    function extractSubject(row, sender) { return getMailboxDomScanApi().extractSubject(row, sender); }
    function firstPageFingerprint(limit = 8) { return getMailboxDomScanApi().firstPageFingerprint(limit); }
    function isElementVisible(node) { return getMailboxDomScanApi().isElementVisible(node); }
    function isDisabledButton(node) { return getMailboxDomScanApi().isDisabledButton(node); }
    function findPagerButton(kind) { return getMailboxDomScanApi().findPagerButton(kind); }
    function dispatchSyntheticClick(node) { return getMailboxDomScanApi().dispatchSyntheticClick(node); }
    function updateMailboxScanProgress(mailbox, patch = {}) { return getMailboxDomScanApi().updateMailboxScanProgress(mailbox, patch); }
    function schedulerScanToken(options = {}) { return getMailboxDomScanApi().schedulerScanToken(options); }
    function scheduleMailboxScanKick(root, options = {}) { return getMailboxDomScanApi().scheduleMailboxScanKick(root, options); }
    async function waitForPageChange(previousFingerprint, timeoutMs = 7000) { return getMailboxDomScanApi().waitForPageChange(previousFingerprint, timeoutMs); }
    async function scanMailboxPages(mailbox, options = {}) { return getMailboxDomScanApi().scanMailboxPages(mailbox, options); }
    function queueMailboxScan(mailbox, root, options = {}) { return getMailboxDomScanApi().queueMailboxScan(mailbox, root, options); }
    async function runMailboxScanQueue(root) { return getMailboxDomScanApi().runMailboxScanQueue(root); }
    async function runFullMailboxScan(root, options = {}) { return getMailboxDomScanApi().runFullMailboxScan(root, options); }
    function parseLastCountQuery(question) { return getMailboxDomScanApi().parseLastCountQuery(question); }
    function parseFromDateQuery(question) { return getMailboxDomScanApi().parseFromDateQuery(question); }
    function parseKeywordQuery(question) { return getMailboxDomScanApi().parseKeywordQuery(question); }
    function selectMessagesForQuestion(question, messages) { return getMailboxDomScanApi().selectMessagesForQuestion(question, messages); }
    function openThread(threadId, href = "", row = null) { return getMailboxDomScanApi().openThread(threadId, href, row); }

    return {
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
    };
  };
})();
