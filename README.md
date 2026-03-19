# Mailita 1.5.0

Mailita is a Chrome extension that replaces Gmail's visible interface with a chat-style UI.
It uses a backend on Render, fetches mail from Gmail over IMAP, normalizes/cache-stores it in
Supabase, and renders conversations by person instead of by Gmail thread.

## Active Runtime

- Extension runtime: `/Users/a_a_k/Downloads/EORG/apps/extension`
- Backend runtime: `/Users/a_a_k/Downloads/EORG/apps/backend`
- Supabase schema source of truth: `/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql`

The active extension runtime is the raw MV3 manifest under
`/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json`.

## What 1.5.0 Includes

- Mailita branding across the active extension and backend
- Person-first left rail powered by summary/contact endpoints
- Automatic background sync job model
- Rich message body support (`bodyText`, `bodyHtml`) for chat rendering
- Inline email images and linked images preserved when available
- Compact conversation header and pinned composer
- Settings panel with Theme, Privacy, and Account tabs
- Temporary debug log moved into Privacy so it no longer pushes the composer down

## Quick Start

1. Set up Supabase using `/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql`.
2. Configure the backend environment variables listed in
   `/Users/a_a_k/Downloads/EORG/docs/render-deploy.md`.
3. Deploy the backend from `/Users/a_a_k/Downloads/EORG/apps/backend`.
4. Load the extension from `/Users/a_a_k/Downloads/EORG/apps/extension`.
5. Connect Gmail with a Gmail App Password from the extension popup or the in-app guide.
6. Open `https://mail.google.com` and verify Mailita takes over the page.

## Important URLs

- Backend health: [https://email-bcknd.onrender.com/health](https://email-bcknd.onrender.com/health)
- Gmail: [https://mail.google.com](https://mail.google.com)
- App Passwords: [https://myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
- 2-Step Verification: [https://myaccount.google.com/signinoptions/two-step-verification](https://myaccount.google.com/signinoptions/two-step-verification)

## Setup and Recovery Docs

- Runtime context: [/Users/a_a_k/Downloads/EORG/docs/context.md](/Users/a_a_k/Downloads/EORG/docs/context.md)
- AI bootstrap: [/Users/a_a_k/Downloads/EORG/docs/ai-bootstrap.md](/Users/a_a_k/Downloads/EORG/docs/ai-bootstrap.md)
- Render deployment: [/Users/a_a_k/Downloads/EORG/docs/render-deploy.md](/Users/a_a_k/Downloads/EORG/docs/render-deploy.md)
- Release/operator status: [/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md](/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md)
- Troubleshooting: [/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md](/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md)
- Store-to-working walkthrough: [/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md](/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md)

## Notes

- `/health` being up does not guarantee `/api/messages` or `/api/messages/sync` are fast.
- Summary/contact endpoints are intentionally lighter than the legacy full mailbox endpoint.
- The backend can fall back to legacy cache writes if the Supabase `messages` table is missing
  the new 1.5.0 rich-body columns, but rich HTML persistence requires the updated schema.
