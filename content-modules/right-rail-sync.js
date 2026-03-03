(() => {
  "use strict";

  const registry = globalThis.__mailitaContentModules || (globalThis.__mailitaContentModules = {});

  registry.createRightRailSyncApi = function createRightRailSyncApi(deps = {}) {
    const {
      THREAD_MESSAGE_SELECTORS,
      BODY_SELECTORS,
      state,
      normalize,
      escapeHtml,
      applyReskin,
      getMailboxCacheKey,
      getRunFullMailboxScan,
      getGetMailboxMessages,
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
    } = deps;

    const mailboxCacheKey = (...args) => {
      const fn = typeof getMailboxCacheKey === "function" ? getMailboxCacheKey() : null;
      if (typeof fn !== "function") return "";
      return fn(...args);
    };
    const runFullMailboxScan = (...args) => {
      const fn = typeof getRunFullMailboxScan === "function" ? getRunFullMailboxScan() : null;
      if (typeof fn !== "function") return Promise.resolve();
      return fn(...args);
    };
    const getMailboxMessages = (...args) => {
      const fn = typeof getGetMailboxMessages === "function" ? getGetMailboxMessages() : null;
      if (typeof fn !== "function") return [];
      return fn(...args);
    };
  function renderRightRail(root) {
    const rail = root.querySelector(".rv-right");
    if (!(rail instanceof HTMLElement)) return;
    const messages = Array.isArray(state.aiChatMessages) ? state.aiChatMessages : [];
    const transcript = messages.length
      ? messages.map((msg) => {
        const role = normalize(msg.role || "assistant").toLowerCase() === "user" ? "user" : "assistant";
        return `<div class="rv-chat-msg is-${role}" data-reskin="true"><div class="rv-chat-bubble" data-reskin="true">${escapeHtml(normalize(msg.content || ""))}</div></div>`;
      }).join("")
      : `<div class="rv-chat-empty" data-reskin="true">Ask anything about your inbox.</div>`;

    rail.innerHTML = `
      <section class="rv-ai-chat" data-reskin="true">
        <div class="rv-ai-chat-head" data-reskin="true">
          <div class="rv-ai-head" data-reskin="true">Inbox Chat</div>
          <div class="rv-ai-copy" data-reskin="true">Type at the top, then messages flow below.</div>
        </div>
        <div class="rv-chat-composer" data-reskin="true">
          <textarea class="rv-ai-qa-input" data-reskin="true" placeholder="Start typing your inbox question...">${escapeHtml(state.aiQuestionText || "")}</textarea>
          <button type="button" class="rv-ai-qa-submit" data-reskin="true" ${state.aiAnswerBusy ? "disabled" : ""}>${state.aiAnswerBusy ? "Thinking..." : "Send"}</button>
        </div>
        <div class="rv-chat-transcript" data-reskin="true">${transcript}</div>
      </section>
    `;

    const transcriptNode = rail.querySelector(".rv-chat-transcript");
    if (transcriptNode instanceof HTMLElement) {
      transcriptNode.scrollTop = transcriptNode.scrollHeight;
    }
  }

  function buildInboxQuestionPrompt(question, messages) {
    let compact = (messages || []).slice(0, 120).map((msg, i) => ({
      i,
      threadId: msg.threadId,
      sender: msg.sender,
      subject: msg.subject,
      date: msg.date,
      snippet: normalize(msg.snippet || "").slice(0, 180),
      body: normalize(msg.bodyText || "").slice(0, 280)
    }));
    let compactJson = JSON.stringify(compact);
    while (compactJson.length > 14000 && compact.length > 10) {
      compact = compact.slice(0, Math.max(10, Math.floor(compact.length * 0.7)));
      compactJson = JSON.stringify(compact);
    }
    return [
      {
        role: "system",
        content:
          "You answer questions about inbox email context. Be concise. If evidence is missing, say you are unsure. " +
          "Support requests like last N messages, messages from a date, and keyword matches."
      },
      {
        role: "user",
        content: `Question: ${normalize(question)}\n\nInbox context JSON:\n${compactJson}`
      }
    ];
  }

  async function askInboxQuestion(root) {
    if (state.aiAnswerBusy) return;
    const viewQuestion = root.querySelector(".rv-ai-qa-input");
    const question = normalize(
      viewQuestion instanceof HTMLTextAreaElement ? viewQuestion.value : state.aiQuestionText || ""
    );
    state.aiQuestionText = question;
    if (!question) {
      state.aiChatMessages.push({ role: "assistant", content: "Type a question first." });
      applyReskin();
      return;
    }
    if (!window.ReskinAI || typeof window.ReskinAI.chat !== "function") {
      state.aiChatMessages.push({ role: "assistant", content: "AI chat is unavailable." });
      applyReskin();
      return;
    }

    state.aiChatMessages.push({ role: "user", content: question });
    state.aiAnswerBusy = true;
    state.aiChatMessages.push({ role: "assistant", content: "Thinking..." });
    applyReskin();
    try {
      if (!state.fullScanCompletedByMailbox[mailboxCacheKey("inbox")] && !state.fullScanRunning) {
        state.aiChatMessages[state.aiChatMessages.length - 1] = {
          role: "assistant",
          content: "Scanning inbox pages first so I can answer across all messages..."
        };
        applyReskin();
        await runFullMailboxScan(root, { mailboxes: ["inbox"] });
      }
      const allMessages = getMailboxMessages("inbox", 2000);
      const selected = selectMessagesForQuestion(question, allMessages);
      let prompts = buildInboxQuestionPrompt(question, selected);
      let answer = "";
      try {
        answer = await window.ReskinAI.chat(prompts, state.settingsCache || {});
      } catch (error) {
        const message = normalize(error && error.message ? error.message : String(error || ""));
        if (message.includes("413") && selected.length > 12) {
          const trimmed = selected.slice(0, Math.max(12, Math.floor(selected.length / 3)));
          prompts = buildInboxQuestionPrompt(question, trimmed);
          answer = await window.ReskinAI.chat(prompts, state.settingsCache || {});
        } else {
          throw error;
        }
      }
      state.aiChatMessages[state.aiChatMessages.length - 1] = {
        role: "assistant",
        content:
          `${normalize(answer) || "No answer returned."}\n\n(Used ${selected.length} of ${allMessages.length} cached inbox messages.)`
      };
    } catch (error) {
      const msg = error && error.message ? String(error.message) : "AI answer failed";
      state.aiChatMessages[state.aiChatMessages.length - 1] = {
        role: "assistant",
        content: `Unable to answer: ${msg.slice(0, 220)}`
      };
      logWarn("Inbox Q&A failed", error);
    } finally {
      state.aiAnswerBusy = false;
      applyReskin();
    }
  }

  function syncViewFromHash() {
    if (
      state.suspendHashSyncDuringContactHydration &&
      state.currentView === "thread" &&
      normalize(state.activeContactKey || "")
    ) {
      return;
    }

    if (state.replySendInProgress && state.currentView === "thread") {
      return;
    }

    if (state.settingsPinned) {
      state.currentView = "settings";
      return;
    }

    if (isAppSettingsHash()) {
      state.settingsPinned = true;
      state.currentView = "settings";
      return;
    }

    const rawHash = normalize(window.location.hash || "");
    if (/^#(?:thread-)?f:[A-Za-z0-9_-]+$/i.test(rawHash)) {
      const listMailbox = mailboxCacheKey(mailboxKeyFromHash(state.lastListHash || "#inbox"));
      const normalizedThreadHash = normalizeThreadHashForMailbox(rawHash, listMailbox);
      if (normalizedThreadHash && normalizedThreadHash !== rawHash) {
        window.location.hash = normalizedThreadHash;
        return;
      }
    }

    const threadHash = isThreadHash();
    if (state.lockListView) {
      if (!threadHash) {
        state.lockListView = false;
      } else {
        state.currentView = "list";
        return;
      }
    }

    if (state.currentView === "thread" && state.activeThreadId && !threadHash) {
      const main = getGmailMainRoot();
      const hasThreadDom = Boolean(
        main instanceof HTMLElement
        && (
          main.querySelector(THREAD_MESSAGE_SELECTORS)
          || main.querySelector(BODY_SELECTORS)
        )
      );
      const keepThreadView = Boolean(
        hasThreadDom
        || isContactTimelineV2Active()
        || state.replySendInProgress
      );
      if (keepThreadView) {
        return;
      }
    }

    state.currentView = threadHash ? "thread" : "list";
    if (state.currentView === "thread") {
      const previousThreadId = canonicalThreadId(state.activeThreadId || "") || normalize(state.activeThreadId || "");
      const nextThreadIdRaw = threadIdFromHash(window.location.hash) || state.activeThreadId;
      const nextThreadId = canonicalThreadId(nextThreadIdRaw || "") || normalize(nextThreadIdRaw || "");
      state.activeThreadId = nextThreadIdRaw;
      if (nextThreadId && nextThreadId !== previousThreadId) {
        bumpInteractionEpoch("hash-thread-open");
        state.threadExtractRetry = 0;
      }
    } else {
      state.activeThreadId = "";
      state.currentThreadIdForReply = "";
      state.currentThreadHintHref = "";
      state.currentThreadMailbox = "";
      clearContactConversationState();
    }
    if (state.currentView === "list") {
      const currentHash = window.location.hash || "#inbox";
      const parsed = parseListRoute(currentHash);
      state.lastListHash = sanitizeListHash(currentHash);
      if (parsed.mailbox !== "inbox") {
        state.triageFilter = "";
      } else if (hashHasTriageParam(currentHash)) {
        state.triageFilter = parsed.triage;
        state.initialCriticalApplied = true;
      } else {
        if (!state.initialCriticalApplied) {
          logChatDebug("startup-filter:default-all", {
            hash: normalize(currentHash || ""),
            mailbox: parsed.mailbox,
            triage: parsed.triage || ""
          }, { throttleKey: "startup-filter-default-all", throttleMs: 4000 });
        }
        state.initialCriticalApplied = true;
        state.triageFilter = "";
        state.lastListHash = "#inbox";
      }
    }
  }


    return {
      renderRightRail,
      buildInboxQuestionPrompt,
      askInboxQuestion,
      syncViewFromHash
    };
  };
})();
