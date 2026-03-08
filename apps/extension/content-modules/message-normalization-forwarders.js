(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createMessageNormalizationForwardersApi = function createMessageNormalizationForwardersApi(deps = {}) {
    const { getMessageNormalizationApi } = deps;

    function cleanThreadMessageBody(rawText, rawHtml) { return getMessageNormalizationApi().cleanThreadMessageBody(rawText, rawHtml); }
    function isLikelyMetadataBlob(text) { return getMessageNormalizationApi().isLikelyMetadataBlob(text); }
    function safeThreadFallbackText(text) { return getMessageNormalizationApi().safeThreadFallbackText(text); }
    function normalizeMessageDateToken(value) { return getMessageNormalizationApi().normalizeMessageDateToken(value); }
    function parseThreadTimestampForOrder(value) { return getMessageNormalizationApi().parseThreadTimestampForOrder(value); }
    function buildFallbackMessageKey(message, threadId = "", sourceIndex = 0) { return getMessageNormalizationApi().buildFallbackMessageKey(message, threadId, sourceIndex); }
    function messageSourceForChat(sourceType) { return getMessageNormalizationApi().messageSourceForChat(sourceType); }
    function buildThreadMessageKey(message, index = 0, threadId = "", sourceIndex = 0) { return getMessageNormalizationApi().buildThreadMessageKey(message, index, threadId, sourceIndex); }
    function normalizeThreadMessageForChat(message, context = {}) { return getMessageNormalizationApi().normalizeThreadMessageForChat(message, context); }
    function normalizeThreadMessagesForChat(messages, threadId = "", context = {}) { return getMessageNormalizationApi().normalizeThreadMessagesForChat(messages, threadId, context); }
    function optimisticStoreKeyForThread(threadId) { return getMessageNormalizationApi().optimisticStoreKeyForThread(threadId); }
    function replyDraftStoreKey(threadId) { return getMessageNormalizationApi().replyDraftStoreKey(threadId); }
    function getReplyDraft(threadId) { return getMessageNormalizationApi().getReplyDraft(threadId); }
    function setReplyDraft(threadId, text) { return getMessageNormalizationApi().setReplyDraft(threadId, text); }
    function getOptimisticMessagesForThread(threadId) { return getMessageNormalizationApi().getOptimisticMessagesForThread(threadId); }
    function setOptimisticMessagesForThread(threadId, messages) { return getMessageNormalizationApi().setOptimisticMessagesForThread(threadId, messages); }
    function ensureContactThreadTracked(threadId) { return getMessageNormalizationApi().ensureContactThreadTracked(threadId); }
    function formatTimeForMessageDate(timestampMs) { return getMessageNormalizationApi().formatTimeForMessageDate(timestampMs); }
    function appendLocalSentCacheEntry(threadId, bodyText, context = {}, timestampMs = Date.now(), hintHref = "") {
      return getMessageNormalizationApi().appendLocalSentCacheEntry(threadId, bodyText, context, timestampMs, hintHref);
    }
    function appendOptimisticOutgoingMessage(text, threadId) { return getMessageNormalizationApi().appendOptimisticOutgoingMessage(text, threadId); }
    function removeOptimisticMessage(threadId, messageKey) { return getMessageNormalizationApi().removeOptimisticMessage(threadId, messageKey); }
    function markOptimisticMessageDelivered(threadId, messageKey) { return getMessageNormalizationApi().markOptimisticMessageDelivered(threadId, messageKey); }
    function markOptimisticMessageFailed(threadId, messageKey) { return getMessageNormalizationApi().markOptimisticMessageFailed(threadId, messageKey); }
    function updateOptimisticInMergedMessages(threadId, messageKey, patch = null) {
      return getMessageNormalizationApi().updateOptimisticInMergedMessages(threadId, messageKey, patch);
    }
    function mergeOptimisticIntoMessages(messages, threadId) { return getMessageNormalizationApi().mergeOptimisticIntoMessages(messages, threadId); }
    function reconcileOptimisticMessagesWithCanonical(threadId, canonicalMessages, preferredOptimistic = null) {
      return getMessageNormalizationApi().reconcileOptimisticMessagesWithCanonical(threadId, canonicalMessages, preferredOptimistic);
    }

    return {
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
    };
  };
})();
