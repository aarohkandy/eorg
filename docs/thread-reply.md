# Thread reply (Send) — where it lives and how to test

## Scope note (2026-02-28)

The contact-centric merged timeline update keeps send behavior intentionally unchanged. Bottom input Send
and Enter still use the same existing send pipeline below.

## One sentence

**Send button and Enter in the thread input both call `submitThreadReply(root)` in content.js, which first forces native thread context, then calls `ReskinCompose.replyToThread(text, { threadId, mailbox, threadHintHref, forceThreadContext, timeoutMs })` in compose.js and expects `{ ok, stage, reason? }`.**

## Scheduler note (core phase)

- Contact/thread open and send start now bump an `interactionEpoch` in `content.js`.
- Mailbox scan is cooperative: if interaction epoch changes (open thread/contact, back, send), scan pauses and resumes only when list view is active again.
- This keeps reply context stable while preserving the same `submitThreadReply` → `replyToThread` contract.

## Code locations

| What | File | Where |
|------|------|--------|
| UI: input + Send button | content.js | `renderThread()` builds `.rv-thread-input` and `.rv-thread-send` |
| Single submit handler | content.js | `submitThreadReply(root)` — call this for both Send click and Enter |
| Send click | content.js | Root click handler: `target.closest(".rv-thread-send")` → `submitThreadReply(root)` |
| Enter key | content.js | In `renderThread()`, threadInput keydown Enter → `submitThreadReply(root)` (no duplicate logic) |
| Gmail: Reply + fill + Send | compose.js | `replyToThread(body, opts)` — staged reply acquisition + structural send targeting + send verification |

## When changing “send” behavior

1. **UI only (e.g. add a shortcut):** In content.js, add another path that calls `submitThreadReply(root)`. Do not duplicate the actual send logic.
2. **Gmail side (reply not sending):** In compose.js, adjust staged acquisition (`findExistingReplyCompose`, `openReplyByContainer`, `findReplyButton` fallback), send detection (`findSendInRoot`), or verification (`waitForSendCompletion`).

## How to test quickly

1. **In browser:** Reload the extension, open Gmail, open a thread in the reskin, type in the input, then:
   - Click **Send** → reply should send.
   - Clear, type again, press **Enter** → same behavior.
   - If Gmail cannot send, input text should remain and button should show a short retry label with failure stage.
2. **With Cursor + Browser MCP:** Use the cursor-ide-browser MCP: navigate to Gmail, open a thread, use `browser_type` in the input, then `browser_snapshot` to find the Send button and simulate click or keydown to verify both paths.

## Why this helps

- One handler (`submitThreadReply`) so “send on button” and “send on Enter” can’t get out of sync.
- PERSISTENT_PREFERENCES and this doc tell the AI to wire both to that handler instead of adding a second implementation.
- Failures now return `stage`/`reason` for targeted diagnosis instead of generic “reply failed.”
