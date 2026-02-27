# Thread reply (Send) — where it lives and how to test

## One sentence

**Send button and Enter in the thread input both call `submitThreadReply(root)` in content.js, which uses `ReskinCompose.replyToThread(text)` in compose.js to send via Gmail’s UI.**

## Code locations

| What | File | Where |
|------|------|--------|
| UI: input + Send button | content.js | `renderThread()` builds `.rv-thread-input` and `.rv-thread-send` |
| Single submit handler | content.js | `submitThreadReply(root)` — call this for both Send click and Enter |
| Send click | content.js | Root click handler: `target.closest(".rv-thread-send")` → `submitThreadReply(root)` |
| Enter key | content.js | In `renderThread()`, threadInput keydown Enter → `submitThreadReply(root)` (no duplicate logic) |
| Gmail: Reply + fill + Send | compose.js | `replyToThread(body)` — finds Reply, fills body, finds Send or Ctrl+Enter |

## When changing “send” behavior

1. **UI only (e.g. add a shortcut):** In content.js, add another path that calls `submitThreadReply(root)`. Do not duplicate the actual send logic.
2. **Gmail side (reply not sending):** In compose.js, adjust `replyToThread`, `findReplyButton`, `waitForReplyCompose`, `findSendInRoot`, or `sendViaKeyboard`. Gmail’s DOM changes; selectors are in constants at the top of compose.js.

## How to test quickly

1. **In browser:** Reload the extension, open Gmail, open a thread in the reskin, type in the input, then:
   - Click **Send** → reply should send.
   - Clear, type again, press **Enter** → same behavior.
2. **With Cursor + Browser MCP:** Use the cursor-ide-browser MCP: navigate to Gmail, open a thread, use `browser_type` in the input, then `browser_snapshot` to find the Send button and simulate click or keydown to verify both paths.

## Why this helps

- One handler (`submitThreadReply`) so “send on button” and “send on Enter” can’t get out of sync.
- PERSISTENT_PREFERENCES and this doc tell the AI to wire both to that handler instead of adding a second implementation.
- When it still doesn’t work, the failure is usually in compose.js (Gmail DOM/selectors), not in the UI wiring.
