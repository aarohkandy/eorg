# Mailita 1.5.0

Mailita is a Chrome extension that replaces Gmail's visible interface with a chat-style UI.
The active beta now reads Gmail directly from the extension using Google OAuth and the Gmail API,
keeps mailbox data local to the browser, and renders conversations by person instead of by Gmail thread.

## Active Runtime

- Extension runtime: `/Users/a_a_k/Downloads/EORG/apps/extension`
- Backend runtime: `/Users/a_a_k/Downloads/EORG/apps/backend`
- Supabase schema source of truth: `/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql`

The active extension runtime is the raw MV3 manifest under
`/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json`.
The backend still exists as an IMAP fallback path, but it is no longer the default beta setup flow.

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

1. Create a Chrome extension OAuth client for this extension ID in Google Cloud.
2. Put that client ID in `/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json` under `oauth2.client_id`.
3. Load the extension from `/Users/a_a_k/Downloads/EORG/apps/extension`.
4. Open `https://mail.google.com`.
5. Click `Connect with Google` in the extension popup or the in-page setup overlay.
6. Approve Gmail read access and verify Mailita takes over the page.
7. Add `gmail.send` in Google Cloud Data Access before testing replies so Mailita can send directly through the Gmail API.

## Important URLs

- Gmail: [https://mail.google.com](https://mail.google.com)
- Chrome extension OAuth: [https://developer.chrome.com/docs/extensions/how-to/integrate/oauth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth)
- Gmail API scopes: [https://developers.google.com/workspace/gmail/api/auth/scopes](https://developers.google.com/workspace/gmail/api/auth/scopes)

## Setup and Recovery Docs

- Runtime context: [/Users/a_a_k/Downloads/EORG/docs/context.md](/Users/a_a_k/Downloads/EORG/docs/context.md)
- AI bootstrap: [/Users/a_a_k/Downloads/EORG/docs/ai-bootstrap.md](/Users/a_a_k/Downloads/EORG/docs/ai-bootstrap.md)
- Render deployment: [/Users/a_a_k/Downloads/EORG/docs/render-deploy.md](/Users/a_a_k/Downloads/EORG/docs/render-deploy.md)
- Release/operator status: [/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md](/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md)
- Troubleshooting: [/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md](/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md)
- Store-to-working walkthrough: [/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md](/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md)

## Notes

- The beta default is `gmail_api_local`; backend IMAP remains available only as a fallback path.
- Reply send now prefers the Gmail API and only falls back to native Gmail compose automation if the direct send path fails.
- If you keep the backend path enabled, the old Supabase and Render requirements still apply there.
