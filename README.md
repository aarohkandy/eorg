# Gmail Hard Reskin

A Manifest V3 Chrome extension that overlays Gmail with a custom full-screen viewer while still using Gmail's native data and navigation.

## What It Does

- Replaces Gmail's visible UI with a custom "Mailita" surface.
- Extracts thread metadata (sender, subject, date) from Gmail DOM with resilient selector fallbacks.
- Uses contact-first list rows for Inbox/Sent (one row per contact) and opens merged contact chat on click.
- Builds contact timelines from row/cache sources (Inbox + Sent) with deterministic merge/dedupe ordering.
- Adds AI inbox triage and Ask Inbox Q&A (manual/explicit runs; background AI automation is off in core phase).
- Persists local triage state so badges/filters still work even if Gmail label sync fails.

## Project Structure

- `manifest.json`: Extension manifest and content script wiring.
- `content.js`: Active runtime for Gmail detection, extraction, rendering, and interaction.
- `ai.js`: Provider settings and AI request pipeline (Groq/OpenRouter/Ollama).
- `triage.js`: Gmail label apply + fallback logic and triage label detection.
- `styles.css`: Full visual reskin and layout styling.
- `compose.js`: Compose/send automation helper module used by thread reply send flow.
- `threads.js`: Alternate thread extraction helper module (currently not wired in `manifest.json`).
- `tests/headless/`: Playwright harnesses for triage and Ask Inbox regression tests.
- `docs/tooling.md`: WXT/Playwright integration notes.

## Install Locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project directory.
5. Open Gmail at `https://mail.google.com/mail/u/0/#inbox`.

## Usage

- The custom viewer mounts automatically when Gmail is ready.
- Contact-first list and scan status run from the left sidebar.
- AI triage is available from sidebar actions, but auto background AI kicks are disabled in this phase.
- Ask Inbox runs from the right rail chat panel.

## Debugging

Use DevTools Console on Gmail and filter by `[reskin]`.

Page-console bridge (works from normal DevTools page context):

- `await window.ReskinChatDebug.enable()`
- `await window.ReskinChatDebug.dumpState()`
- `await window.ReskinChatDebug.dumpMailboxCache()`
- `await window.ReskinChatDebug.dumpAccountState()`
- `await window.ReskinChatDebug.dumpReplyDebug()`

Expected lifecycle logs:

- `Waiting for Gmail landmarks...`
- `Gmail ready. Applying viewer.`
- `Extractor source: rows|links|rows+links`
- `Rendered N messages`
- `Mutation observer started (debounced 75ms).`
- `thread-extract:source` and `thread-render:timeline` while opening a thread
- `contact-v2:open`, `contact-v2:scope`, `contact-v2:timeline-built`, `contact-v2:cache-refresh` for contact timeline v2
- `interaction:epoch` and scheduler fields from `dumpState()` for scan preemption/debug
- `startup-filter:default-all` when first inbox load defaults to unfiltered view

`InboxSDK` injection errors can appear in console on some Gmail builds. They are non-fatal for timeline
rendering: the extension automatically falls back to DOM extraction (`inboxsdk:fallback-dom`).

If you see `No messages captured. Gmail selectors did not match this view.`:

1. Reload the extension from `chrome://extensions`.
2. Hard refresh Gmail (`Ctrl+Shift+R` / `Cmd+Shift+R`).
3. Use overlay **Refresh** button.
4. Capture a fresh console dump plus current Gmail URL hash for selector tuning.

## Development Notes

- Gmail DOM is highly dynamic and class names are obfuscated.
- Prefer stable attributes (`role`, `aria-*`, `data-thread-id`, `data-legacy-thread-id`, `href` patterns).
- Keep extraction logic defensive and non-destructive.
- Avoid mutating Gmail nodes; render custom nodes under `#reskin-root`.

## Known Limitations

- Gmail DOM changes can still break extraction and require selector updates.
- The extension currently targets Chromium-based browsers.
- `threads.js` is a helper module and not part of current runtime unless added to `manifest.json`.

## Security and Privacy

- Runs only on `https://mail.google.com/*`.
- AI triage/Q&A sends selected inbox content to configured provider only when enabled + consented in Settings.
- Operates in-page through content script DOM reads/writes for Gmail interactions.

## Release

See `PUBLISHING.md` for a step-by-step GitHub publishing flow.
