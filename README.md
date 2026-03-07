# Gmail Unified (IMAP Rebuild)

This repository now uses a three-part architecture:

1. `apps/backend` - Node.js/Express IMAP backend with Supabase cache.
2. `apps/extension` - Chrome extension (MV3) injected into Gmail.
3. `legacy/gmail-dom-v1` - archived selector-based Gmail DOM implementation.

## Why this rebuild

The legacy DOM selector extraction was removed from active runtime. The current extension gets data from the backend via IMAP (`imap.gmail.com:993`) and no longer depends on Gmail internal class names.

## Active extension behavior

- Injects a right sidebar into Gmail (`mail.google.com`).
- Shows Inbox + Sent in a unified timeline with thread grouping.
- Supports filters (All/Inbox/Sent), search, sync, unread hints, and auto-refresh.
- Handles Render cold starts with a dedicated user-visible message:

`Backend server is starting up, please wait 60 seconds and try again.`

## Directory map

- `/apps/backend/server.js` - API server + keep-alive timers.
- `/apps/backend/routes` - auth/messages/health endpoints.
- `/apps/backend/lib` - IMAP, crypto, Supabase, normalization helpers.
- `/apps/extension/background/service-worker.js` - API proxy + error classifier.
- `/apps/extension/content/gmail-inject.js` - Gmail sidebar UI.
- `/apps/extension/popup` - setup/connect/sync/disconnect UI.
- `/manifest.json` - active extension manifest pointing to `apps/extension/*`.

## Backend quick start

```bash
cd apps/backend
npm install
cp .env.example .env
npm run test:imap
npm run dev
```

## Extension quick start

1. Update backend URL in `apps/extension/background/service-worker.js`.
2. Open `chrome://extensions`.
3. Enable Developer mode.
4. Load unpacked from repository root (`/Users/a_a_k/Downloads/EORG`).
5. Open Gmail and use the popup to connect with Gmail + App Password.

## Supabase setup

Run `/infra/supabase-schema.sql` in your Supabase SQL editor.

## Notes

- No Gmail API/OAuth is used.
- App Password is encrypted server-side and never stored in extension storage.
- Known old DOM implementation remains archived under `/legacy/gmail-dom-v1` for reference only.
