# Gmail Hard Reskin

A Manifest V3 Chrome extension that overlays Gmail with a custom full-screen viewer while still using Gmail's native data and navigation.

## What It Does

- Replaces Gmail's visible UI with a custom "Mail Viewer" surface.
- Extracts thread metadata (sender, subject, date) from Gmail DOM with resilient selector fallbacks.
- Opens threads by dispatching clicks to Gmail's own nodes to preserve native navigation behavior.
- Re-renders on SPA updates via a debounced `MutationObserver`.

## Project Structure

- `manifest.json`: Extension manifest and content script wiring.
- `content.js`: Active runtime for Gmail detection, extraction, rendering, and interaction.
- `styles.css`: Full visual reskin and layout styling.
- `compose.js`: Compose/send automation helper module (currently not wired in `manifest.json`).
- `threads.js`: Alternate thread extraction helper module (currently not wired in `manifest.json`).

## Install Locally

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this project directory.
5. Open Gmail at `https://mail.google.com/mail/u/0/#inbox`.

## Usage

- The custom viewer mounts automatically when Gmail is ready.
- Click **Refresh** in the viewer header to re-run extraction manually.
- Click any rendered item to open the corresponding Gmail thread.

## Debugging

Use DevTools Console on Gmail and filter by `[reskin]`.

Expected lifecycle logs:

- `Waiting for Gmail landmarks...`
- `Gmail ready. Applying viewer.`
- `Extractor source: rows|links|rows+links`
- `Rendered N messages`
- `Mutation observer started (debounced 75ms).`

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
- `compose.js` and `threads.js` are helper modules and not part of current runtime unless added to `manifest.json`.

## Security and Privacy

- Runs only on `https://mail.google.com/*`.
- Does not send data to external services.
- Operates fully in-page through content script DOM reads/writes.

## Release

See `PUBLISHING.md` for a step-by-step GitHub publishing flow.
