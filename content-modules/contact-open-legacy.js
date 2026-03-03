(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createContactOpenLegacyApi = function createContactOpenLegacyApi(deps = {}) {
    const {
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
    } = deps;

    function openContactChatFromRowLegacy(message, root, route = {}) {
      if (!ENABLE_CONTACT_MERGE_MODE) return false;
      if (!(root instanceof HTMLElement)) return false;
      const msg = message && typeof message === "object" ? message : null;
      if (!msg) return false;
      const contactKey = normalize(contactKeyFromMessage(msg) || "");
      const contactEmail = extractEmail(contactKey || msg.senderEmail || msg.sender || "");
      if (!contactKey && !contactEmail) return false;

      const mailbox = mailboxCacheKey(route.mailbox || msg.mailbox || "inbox");
      const liveRows = collectMessages(500).items || [];
      const inboxCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("inbox")])
        ? state.scannedMailboxMessages[mailboxCacheKey("inbox")]
        : [];
      const sentCached = Array.isArray(state.scannedMailboxMessages[mailboxCacheKey("sent")])
        ? state.scannedMailboxMessages[mailboxCacheKey("sent")]
        : [];
      const baseScope = chatScopeMessages(mailbox, liveRows);
      const pool = dedupeMessagesStable([
        ...baseScope,
        ...inboxCached,
        ...sentCached,
        ...liveRows,
        msg
      ]);

      const context = activeConversationContext({
        activeAccountEmail: detectCurrentUserEmail() || state.activeAccountEmail || state.currentUserEmail || "",
        contactEmail: contactEmail || contactKey,
        conversationKey: conversationKeyFromContact(contactEmail || contactKey)
      });
      const scopedRows = pool.filter((rowMsg) => mailboxRowMatchesContactConversation(rowMsg, context));
      const rowsForGrouping = scopedRows.length > 0 ? scopedRows : [msg];
      const grouped = groupMessagesByContact(rowsForGrouping);
      const normalizedContactKey = normalize(contactKey || contactEmail || "");
      const targetEmail = extractEmail(contactEmail || contactKey || "");

      logChatDebug("contact-open:scope", {
        routeMailbox: mailbox,
        contactKey: normalizedContactKey,
        contactEmail: targetEmail,
        poolCount: pool.length,
        scopedCount: scopedRows.length,
        groupedCount: grouped.length,
        inboxCached: inboxCached.length,
        sentCached: sentCached.length,
        liveCount: liveRows.length
      }, { throttleKey: `contact-open-scope:${normalizedContactKey || targetEmail || "unknown"}`, throttleMs: 320 });

      let selectedGroup = grouped.find((group) => {
        const groupEmail = extractEmail(group && (group.contactEmail || group.contactKey) || "");
        const groupKey = normalize(group && group.contactKey || "");
        return Boolean(
          (targetEmail && groupEmail && groupEmail === targetEmail)
          || (normalizedContactKey && groupKey && groupKey === normalizedContactKey)
        );
      }) || null;

      const clickedThreadId = canonicalThreadId(msg.threadId || "") || normalize(msg.threadId || "");
      if (!selectedGroup) {
        const latestByThread = new Map();
        const pushRow = (rowMsg) => {
          const threadId = canonicalThreadId(rowMsg && rowMsg.threadId) || normalize(rowMsg && rowMsg.threadId);
          if (!threadId) return;
          const existing = latestByThread.get(threadId);
          const next = { ...rowMsg, threadId };
          if (!existing) {
            latestByThread.set(threadId, next);
            return;
          }
          const chosen = compareMailboxRowsNewestFirst(next, existing) <= 0 ? next : existing;
          latestByThread.set(threadId, chosen);
        };
        for (const rowMsg of rowsForGrouping) pushRow(rowMsg);
        pushRow(msg);
        const items = Array.from(latestByThread.values()).sort(compareMailboxRowsNewestFirst);
        const threadIds = items
          .map((item) => canonicalThreadId(item && item.threadId) || normalize(item && item.threadId))
          .filter(Boolean);
        const conversationContact = targetEmail || extractEmail(contactKey || "");
        const conversationKey = conversationKeyFromContact(conversationContact || normalizedContactKey);
        selectedGroup = {
          contactKey: conversationContact || normalizedContactKey,
          contactEmail: conversationContact,
          conversationKey,
          contactName: senderDisplayName(msg.sender || "") || conversationContact || normalizedContactKey || "Contact",
          threadIds,
          items,
          latestItem: items[0] || msg
        };
      } else {
        selectedGroup = {
          ...selectedGroup,
          items: Array.isArray(selectedGroup.items) ? selectedGroup.items.slice() : [],
          threadIds: Array.isArray(selectedGroup.threadIds) ? selectedGroup.threadIds.slice() : []
        };
        if (clickedThreadId) {
          const hasThread = selectedGroup.threadIds.some((id) => (
            (canonicalThreadId(id || "") || normalize(id || "")) === clickedThreadId
          ));
          if (!hasThread) selectedGroup.threadIds.unshift(clickedThreadId);
          const hasItem = selectedGroup.items.some((item) => (
            (canonicalThreadId(item && item.threadId || "") || normalize(item && item.threadId || "")) === clickedThreadId
          ));
          if (!hasItem) {
            selectedGroup.items.unshift({ ...msg, threadId: clickedThreadId });
          }
        }
        if (!selectedGroup.contactEmail) {
          selectedGroup.contactEmail = targetEmail || extractEmail(selectedGroup.contactKey || "");
        }
        selectedGroup.conversationKey = normalize(
          selectedGroup.conversationKey
          || conversationKeyFromContact(selectedGroup.contactEmail || selectedGroup.contactKey || "")
        );
        selectedGroup.latestItem = selectedGroup.items[0] || selectedGroup.latestItem || msg;
      }

      if (!Array.isArray(selectedGroup.threadIds) || selectedGroup.threadIds.length === 0) return false;
      loadContactChat(selectedGroup, root);
      return true;
    }

    function openContactChatFromRow(message, root, route = {}) {
      if (!ENABLE_CONTACT_MERGE_MODE) return false;
      if (isContactTimelineV2Enabled()) {
        return openContactTimelineFromRowV2(message, root, route);
      }
      return openContactChatFromRowLegacy(message, root, route);
    }

    return {
      openContactChatFromRowLegacy,
      openContactChatFromRow
    };
  };
})();
