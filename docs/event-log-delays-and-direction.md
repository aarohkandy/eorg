# Event log delays and direction – answers and fixes

## 1. Why does discovery:start fire 25 seconds after contact click?

**What triggers discoverThreadIds**

- **From loadContactChat** (around 8683–8694): when `state.inboxSdkReady && state.inboxSdkInstance`, we call `discoverThreadIds(contactEmail, signal)` in a `.then()` after the main sync work. So discovery runs when loadContactChat runs.
- **From the list click handler** (around 10034–10075): on a **contact group** we call `openContactTimelineFromRowV2(latest, root, { seedRows: g.items })`. We do **not** call loadContactChat unless `shouldHydrate` is true (timeline has ≥2 messages, no outgoing, etc.). So for a normal open we never called loadContactChat, and discovery only ran when something else did (e.g. sent-scan complete calling `loadContactChat(expanded, …, { reason: "sent-scan-complete" })`), hence the ~25 s delay.

**Fix applied:** In `openContactTimelineFromRowV2`, after `renderList` / `renderCurrentView`, we now kick discovery the same way as in loadContactChat: if InboxSDK is ready we call `discoverThreadIds(contactEmail, signal)` and then `fetchAndRenderThreads(freshIds.slice(0, 10), getRoot())`; if not ready we set `state._pendingDiscovery = { contactEmail }`. So discovery runs as soon as you open a contact, not only when loadContactChat runs later.

---

## 2. Why does bootstrap:scan-kick fire 40 seconds after reskin:ready?

**Where bootstrap:scan-kick is called**

- In `waitForReady()` → `bootstrap()` (around 10293–10332). When Gmail is “ready” we set `state.startupBootDeferredScheduled = true` and then call several `scheduleDeferredWork(…, { delayMs: …, timeoutMs: … })`.
- The scan kick was one of those: `scheduleDeferredWork(() => { … logEvent("bootstrap:scan-kick", …); scheduleMailboxScanKick(…); }, { delayMs: 500, timeoutMs: 8000 })`.

**What actually delays it**

- `scheduleDeferredWork` (around 289–316) uses **requestIdleCallback** when available: it runs the task in `requestIdleCallback(work, { timeout: timeoutMs })`. So the work runs when the browser considers the main thread “idle”, or when the timeout (8 s) is hit. If the tab is busy (e.g. Gmail still loading), idle can be a long time (e.g. 40 s), so bootstrap:scan-kick was effectively delayed until then.

**Fix applied:** The scan kick is no longer scheduled with `scheduleDeferredWork`. In `bootstrap()` we now use a simple **setTimeout** (500 ms) to run the same logic (get root, log bootstrap:scan-kick, call `scheduleMailboxScanKick(root, { mailboxes: ["inbox", "sent"], delayMs: 0 })`). So the kick runs 500 ms after bootstrap regardless of idle.

---

## 3. ~2 second gap between contact-v2:open and thread-render

**What runs in that path**

- `openContactTimelineFromRowV2` does sync work, then `applyActiveContactTimelineV2(result, { reason: "open", preferredThreadId })`, then `renderList(root)` and `renderCurrentView(root)`.
- For contact timeline v2, `renderCurrentView` → `renderThread` uses `inContactTimelineV2 === true`, so it **skips** `waitForThreadContentReady` and builds messages from `state.activeTimelineMessages` only. There is no explicit 2 s setTimeout in that v2 path.
- Other places that can delay thread render:
  - **Non-v2 path:** `waitForThreadContentReady` can return `ready: false` and a `waitMs`; `renderThread` then does `setTimeout(() => renderThread(latestRoot), waitMs)`. `waitMs` is `THREAD_READY_RETRY_BASE_MS + retryAttempt * 80` (base 80 ms), so that’s small.
  - **Single-message row click** (non-group): there is a `setTimeout(…, 60)` before calling `renderThread` (around 10121–10126).

So the ~2 s gap is not explained by a single obvious 2 s timer in the v2 open → thread-render path. To pinpoint it you can add two event log entries: one immediately before `renderThread(root)` in the v2 branch and one at the very end of `renderThread`. That will show whether the delay is inside `renderThread` or between contact-v2:open and the first line of `renderThread`.

---

## 4. Direction: why is every message “incoming”? (senderEmail vs activeAccountEmail)

**Where direction is set**

- **Print-view messages** (around 7150–7153 in `extractMessagesFromPrintView`):
  - `normalizedAccount = normalize(extractEmail(accountEmail||"")||accountEmail||"").toLowerCase()`
  - `senderEmail = emailMatch[1].toLowerCase()`
  - `direction = (normalizedAccount && senderEmail === normalizedAccount) ? "outgoing" : "incoming"`
  So direction is correct if `accountEmail` (passed from `hydrateThreadFromPrintView`) is the current user and matches the sender in the print HTML.

- **Row/timeline messages** (around 7670–7685 in `normalizeTimelineRowMessageV2`):
  - `activeEmail = extractEmail(conversationContext.activeAccountEmail || "")`
  - If `senderEmail === activeEmail` → `"outgoing"`; else if senderEmail is set and not equal → `"incoming"`.

So both paths rely on having the right **activeAccountEmail** (and for print view, passing it as `accountEmail`). If `state.activeAccountEmail` is empty or wrong when we open the contact or when we hydrate, every message can be classified as incoming.

**Fixes applied**

- In `openContactTimelineFromRowV2` we now set **before** building context:
  - `state.activeAccountEmail = extractEmail(activeAccountEmail || "") || state.activeAccountEmail`
  - `state.activeContactEmail = contactEmail || state.activeContactEmail`
- In `fetchAndRenderThreads`, when calling `hydrateThreadFromPrintView`, we now pass:
  - `accountEmail = state.activeAccountEmail || detectCurrentUserEmail(true) || detectCurrentUserEmail() || ""`
  so print-view extraction gets a non-empty account when possible.
- In `extractMessagesFromPrintView`, `normalizedAccount` is computed from `accountEmail` with a safe fallback so we don’t pass a non-string.

With this, direction should be correct for jjnsjs682@gmail.com once the account is set at open and used for both row and print-view normalization.

---

## 5. Thread f:1858147013026049927: 9 messages in print view, only 2 in the merge – where do the other 7 go?

**Possible places**

1. **Print-view extraction** – We only push a row when the table has an email and "To:" and we don’t skip by `continue`. So all 9 should be extracted if the HTML has 9 such tables.
2. **appendMessagesToTimeline** (around 8410–8421):
   - `normalized = normalizeThreadMessagesForChat(messages, "", conversationContext)`
   - `filtered = normalized.filter((msg) => messageBelongsToConversation(msg, conversationContext))`
   So any message dropped here is because **messageBelongsToConversation** returned false.

**messageBelongsToConversation** (around 940–1045) keeps a message if, in short:

- It’s optimistic outgoing, or
- `participantSet` or `snapshot.senderEmail` includes the contact, or
- We have no contact (allow all), or
- We have no activeAccountEmail but inferred contact match, or
- `hasAccount` (participantSet or sender is activeAccountEmail), or
- `keepAsIncoming` (sender === contact) or `keepAsOutgoing` (sender === activeAccountEmail and (contact match or mailbox sent)).

For print-view messages, `participantSet` comes from `messagePartySnapshot` (sender + recipientEmails + msg.participants). If the print view doesn’t populate recipientEmails well, participantSet might be incomplete and we might drop messages that we should keep. The same logic can drop messages if **contactEmail** or **activeAccountEmail** in the context is wrong at the time of append.

**What we fixed**

- Setting `state.activeAccountEmail` and `state.activeContactEmail` in `openContactTimelineFromRowV2` (and using a fallback in `fetchAndRenderThreads`) ensures that when discovery runs and `appendMessagesToTimeline` runs, `activeConversationContext()` has the correct contact and account. That should reduce incorrect drops. If 7 messages still disappear, the next step is to log when `messageBelongsToConversation` returns false for a print_view message (e.g. log contactEmail, activeAccountEmail, snapshot.senderEmail, participantSet) and to inspect **bodyPreview** (or bodyText) of the 9 print-view messages to confirm all 9 are present after extraction and before the filter.

---

## Summary of code changes

1. **Discovery delay:** Trigger discovery (and optional fetchAndRenderThreads) from `openContactTimelineFromRowV2` as soon as the contact is opened, same as in loadContactChat.
2. **Bootstrap scan delay:** Schedule the mailbox scan kick with `setTimeout(..., 500)` instead of `scheduleDeferredWork` (no requestIdleCallback).
3. **Direction / account:** Set `state.activeAccountEmail` and `state.activeContactEmail` in `openContactTimelineFromRowV2`; in `fetchAndRenderThreads` pass `accountEmail` with a detectCurrentUserEmail fallback; normalize `accountEmail` safely in `extractMessagesFromPrintView`.
4. **2 s gap:** No code change; path is documented; suggest adding two event-log points around `renderThread` to measure where the 2 s is.
5. **7 messages dropped:** No filter logic change; ensuring correct state at open and at append should help; further debugging via logs and bodyPreview is suggested if the issue remains.
