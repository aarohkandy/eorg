# Persistent Preferences

This file stores repeated user preferences that should be applied at the start of each session.

## Preference Version
Current version: `0.2.6`

Versioning rules:
- For each normal update to this file, increment by `0.0.1`.
- Only increment by `0.1` or `1.0` when the user explicitly says to do so.

## Active Preferences
- Check this file first at the beginning of each session.
- If a request is a repeated preference, record it here so the user does not have to repeat it.
- Keep entries concise and actionable.
- **Version bumps:** When changing version/status in this project, increment by `0.0.1` unless the user explicitly says otherwise (e.g. `0.1` or `1.0`).
- **Thread reply (Send):** Both the Send button and Enter in the thread input must submit the reply. There is a single handler: `submitThreadReply(root)` in content.js. Do not add a second code path for "send on Enter" or "send on button" — wire both to this function. Gmail sending is in compose.js `replyToThread()`. See `docs/thread-reply.md` for flow and how to test.

## Change Log
- `0.0.1` Initial file created with user-defined versioning policy.
- `0.0.2` Version increment after subsequent project changes (per +0.0.1 rule).
- `0.0.3` Added preference: all version/status changes use +0.0.1 unless user says otherwise.
- `0.0.4` Full-screen fix: removed gap at top, made UI fill 100vw/100vh
- `0.0.5` Fix Drafts/Sent scroll-to-bottom on click
- `0.0.6` Fix resize grip cursor (wider hit area, proper col-resize symbol)
- `0.0.7` Fix Settings panel clickability (moved early-return below action buttons)
- `0.0.8` Fix left column: consistent left-alignment, reduced default width
- `0.0.9` Fix triage filter clicks (case-sensitive level matching)
- `0.1.0` Thread view: strip Gmail HTML, render as clean Discord-style chat
- `0.1.1` Chat area uses 1fr (flex fill) instead of fixed px width
- `0.1.2` CSS cleanup: tighter sidebar spacing, proper button styles
- `0.1.3` Fix sender extraction: broader Gmail DOM selectors, use email attribute
- `0.1.4` Strip Gmail HTML more aggressively: remove tracking pixels, replace images with alt text, clean empty divs
- `0.1.5` Add message input bar at bottom of chat thread view
- `0.1.6` Dotted line separators between messages in thread view
- `0.1.7` Auto-scroll to latest message (bottom) when opening a thread
- `0.1.8` Spread out left column: larger padding/gaps for breathing room
- `0.1.9` Shadow DOM email embeds: render original email HTML (images, layout, links) in isolated card per message
- `0.2.0` Fix empty list on load: never cache empty signature, re-render aggressively until messages appear
- `0.2.1` Raise collectMessages limit from 60 to 200 so all inbox messages are visible
- `0.2.2` Fix duplicate messages in thread: dedup by body text + skip dominated containers
- `0.2.3` Message embeds sized to content (fit-content, max-width 520px, rounded card)
- `0.2.4` Send button sends Gmail reply: wired compose.js, replyToThread via native Gmail reply UI, Enter key support
- `0.2.5` Fix triple-duplicate messages: dedup by whitespace-stripped body text, query [data-message-id] first then fallback
- `0.2.6` Thread reply: single submitThreadReply() for Send + Enter; added docs/thread-reply.md for flow and testing
