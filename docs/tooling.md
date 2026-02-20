# Tooling Integration

This project now integrates multiple tools for reliability and developer workflow.

## 1) InboxSDK (runtime integration)

- Vendored SDK file: `inboxsdk.js` (official bundle from `@inboxsdk/core@2.2.11`)
- Loaded by manifest before app scripts.
- Runtime bootstrap in `content.js` initializes InboxSDK only if configured.

### Configure in Settings

Open extension Settings view and set:
- `Enable InboxSDK`: checked
- `InboxSDK App ID`: your valid InboxSDK app id (format similar to `sdk_...`)
- `InboxSDK Version`: `2`

If disabled or missing App ID, extension falls back to existing DOM/observer logic.

## 2) Playwright (headless verification)

Python-based Playwright harnesses are in `tests/headless/`:
- `run_triage_harness.py` validates triage apply logic and thread fallback.
- `run_chat_harness.py` validates Ask Inbox Q&A flow.
- `run_all.sh` executes both.

Run:

```bash
bash tests/headless/run_all.sh
```

## 3) WXT scaffolding

WXT config and entrypoints were added for modern extension workflow migration:
- `wxt.config.ts`
- `src/entrypoints/content.ts`
- `src/entrypoints/background.ts`
- `tsconfig.json`
- `package.json` scripts (`dev`, `build`, `zip`)

This scaffold keeps current legacy JS files active while enabling staged migration.
