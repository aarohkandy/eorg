# Mailita Context

Last updated: 2026-03-18 (America/Los_Angeles)

This is the highest-signal context and handoff file in the repository. It is written for a
fresh engineer or AI that has access only to GitHub and the codebase, not the original chat
history.

If this document and the code disagree, trust the code for exact implementation details and
use this document for architecture, intent, operational history, and debugging context.

## 1. What Mailita Is

Mailita is a Chrome extension that takes over Gmail and presents email as a chat-style UI.

The product goal is:

- the user opens Gmail
- Mailita visually replaces Gmail's normal interface
- the left rail groups messages by person, not Gmail thread
- the detail pane shows chronological sent + received mail as chat
- the user can reply from the bottom composer without feeling like they are using traditional
  email software

Mailita is not a general-purpose webmail client yet. It is a focused Gmail overlay backed by a
custom IMAP + Supabase backend.

## 2. Current 1.5.0 State

Mailita 1.5.0 is the first release where the system is organized around:

- Mailita branding instead of Gmail Unified branding
- summary-first mailbox loading
- per-contact conversation loading
- automatic background sync jobs
- canonical backend contact identity fields
- richer message body fields for chat rendering
- operator-facing setup and troubleshooting docs in `docs/`

The user specifically wanted this release to:

- remove manual Sync from the visible UI
- keep the composer pinned at the bottom
- use one canonical contact merge model for sent + received mail
- render real email content instead of only snippets
- preserve images and linked images when safe
- make the repo easy to hand to another AI with no chat history

## 3. Active Runtime and File Map

The active runtime is the `apps/extension` + `apps/backend` stack.

### Extension

- [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json)
  - the canonical MV3 manifest for the active runtime
  - version `1.5.0`
  - loads one service worker and one content script
- [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
  - the extension transport/orchestration layer
  - talks to the backend
  - owns connect/disconnect, summary fetch, contact fetch, search, and sync job polling
  - owns the browser-side distinction between:
    - true cold start
    - API timeout
    - browser/network fetch failure
    - health-up-but-mailbox-path-slow
- [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
  - the full Mailita Gmail overlay runtime
  - owns boot, UI state, left rail rendering, thread rendering, settings, debug panel,
    contact loads, and Gmail send automation hookup
- [apps/extension/content/styles.css](/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css)
  - Mailita 1.5.0 shell styles
  - black/khaki material system
  - pinned composer layout
  - settings panel and privacy/debug placement
- [apps/extension/popup/popup.html](/Users/a_a_k/Downloads/EORG/apps/extension/popup/popup.html)
  - popup onboarding / connection UI
- [apps/extension/popup/popup.js](/Users/a_a_k/Downloads/EORG/apps/extension/popup/popup.js)
  - popup logic
  - manual Sync was intentionally removed here in 1.5.0

### Backend

- [apps/backend/server.js](/Users/a_a_k/Downloads/EORG/apps/backend/server.js)
  - Express app entrypoint
- [apps/backend/routes/auth.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/auth.js)
  - account connect/disconnect flow
- [apps/backend/routes/health.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/health.js)
  - health metadata endpoint
  - reports version + build metadata
- [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
  - main backend mailbox API
  - owns:
    - `GET /api/messages`
    - `GET /api/messages/summary`
    - `GET /api/messages/contact`
    - `GET /api/messages/search`
    - `POST /api/messages/sync`
    - `GET /api/messages/sync/status`
    - `POST /api/messages/debug/contact`
- [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
  - IMAP/ImapFlow operations
  - body extraction
  - rich body sanitization
  - diagnostics for MIME structure / fallback extraction
- [apps/backend/lib/message-normalize.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-normalize.js)
  - canonical message mapping between IMAP objects, Supabase rows, and UI payloads
  - carries rich body fields and canonical contact identity
- [apps/backend/lib/message-identity.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-identity.js)
  - canonical contact identity helpers
  - this is the 1.5.0 fix for sent/received split logic
- [apps/backend/lib/build-info.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/build-info.js)
  - version/build metadata helper for `/health` and debug payloads

### Schema / Infra

- [infra/supabase-schema.sql](/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql)
  - source-of-truth schema for:
    - `users`
    - `messages`
    - `sync_jobs`

### Key docs

- [README.md](/Users/a_a_k/Downloads/EORG/README.md)
- [docs/render-deploy.md](/Users/a_a_k/Downloads/EORG/docs/render-deploy.md)
- [docs/troubleshooting.md](/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md)
- [docs/version-1.5.0-status.md](/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md)
- [docs/store-to-working-guide.md](/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md)
- [docs/ai-bootstrap.md](/Users/a_a_k/Downloads/EORG/docs/ai-bootstrap.md)

## 4. Runtime Model

### Extension model

The active extension runtime is raw MV3 JavaScript loaded directly from the manifest.

Important implication:

- no active bundler is required at runtime
- the extension is loaded from `apps/extension/manifest.json`
- the service worker and content script are plain files

The content script does not fetch Gmail data from the page DOM as the product source of truth.
It talks to the backend through the service worker.

### Backend model

The backend is Node + Express, deployed on Render, and backed by Supabase.

Mail fetch model:

- user stores Gmail address + App Password through the backend
- backend decrypts credentials
- backend fetches Inbox + Sent via IMAP/ImapFlow
- backend normalizes/cache-stores message rows
- extension loads summaries and per-contact conversations from the backend

## 5. 1.5.0 Architecture

### 5.1 Summary/contact split

Before 1.5.0, the UI heavily depended on one full-mailbox response.

In 1.5.0 the preferred load path is:

1. `GET /api/messages/summary`
2. render the left rail
3. `GET /api/messages/contact?contactEmail=...` only when a person is opened

The legacy `GET /api/messages` route is intentionally still present as a compatibility and
rollback path.

### 5.2 Background sync jobs

Before 1.5.0, sync was a blocking request and looked like downtime if IMAP took too long.

In 1.5.0:

- `POST /api/messages/sync` starts or resumes a job and returns quickly
- `GET /api/messages/sync/status` is polled by the service worker
- the worker uses a 10-second timeout per sync request
- only one active sync job should exist per user at a time
- automatic sync is started:
  - after connect
  - after boot
  - after successful send
  - on a 10-minute cadence via `chrome.alarms`

### 5.3 Canonical contact identity

1.5.0 centralizes contact identity in the backend.

Canonical message fields:

- `contactKey`
- `contactEmail`
- `contactName`

This is important because earlier merge bugs came from the frontend and backend each deriving
"the other person" differently.

### 5.4 Rich body fields

1.5.0 extends the message model with:

- `bodyText`
- `bodyHtml`
- `bodyFormat`
- `hasRemoteImages`
- `hasLinkedImages`

The goal is to let the UI render something closer to Gmail for emails with real HTML bodies,
instead of dumping only plain snippets.

## 6. Current UI Behavior

### 6.1 Top-level shell

The active shell is Mailita-branded and visually distinct from Gmail.

Intentional 1.5.0 choices:

- no top-bar Sync button
- settings lives in the top-right
- automatic sync runs in the background
- the top bar should not duplicate the currently opened contact name

### 6.2 Left rail

The left rail is person-first.

Each summary row should show:

- the contact name/email
- the latest subject
- the latest time

The rail should be sorted by newest activity across both directions.

### 6.3 Conversation pane

The detail pane is intended to be a strict three-row layout:

1. compact header
2. scrollable message lane
3. pinned composer

The composer should always remain visible. The message lane, not the whole detail pane, should
scroll.

### 6.4 Settings

Mailita settings are in-app and tabbed:

- Theme
- Privacy
- Account

The temporary debug log is intentionally under Privacy in 1.5.0 so it does not push the
conversation UI down.

### 6.5 Reply flow

Reply send still goes through Gmail-page automation from the content runtime. The user
preference preserved across sessions is:

- Send button and the keyboard-send path both funnel through `submitThreadReply(...)`
- Gmail send automation returns structured status
- composer text must survive failure

## 7. Current Data and API Surface

### Health

- `GET /health`
  - returns status, timestamp, uptime, and build metadata

### Auth

- `POST /api/auth/connect`
- `DELETE /api/auth/disconnect`

### Mailbox

- `GET /api/messages`
  - legacy full mailbox route
- `GET /api/messages/summary`
  - summary-first route for the left rail
- `GET /api/messages/contact`
  - focused contact route for one chat pane
- `GET /api/messages/search`
  - current search route, still kept on the older broader path
- `POST /api/messages/sync`
  - start/resume sync job
- `GET /api/messages/sync/status`
  - sync job polling route
- `POST /api/messages/debug/contact`
  - heavy contact debug route used when content extraction is failing

## 8. Supabase Requirements

The 1.5.0 schema adds important fields.

### `messages` table additions

- `contact_key`
- `contact_email`
- `contact_name`
- `body_text`
- `body_html`
- `body_format`
- `has_remote_images`
- `has_linked_images`

### `sync_jobs` table

1.5.0 adds a `sync_jobs` table so sync status can be stored and inspected.

The backend contains best-effort fallbacks:

- if new message columns are missing, upserts can fall back to a legacy shape
- if `sync_jobs` is unavailable, job persistence can fall back to in-memory tracking

Those fallbacks prevent hard crashes, but they do not mean the deployment is fully correct.

## 9. What Broke During This Cycle

These are the major struggles from the 1.5.0 cycle.

### 9.1 `/health` up did not mean the app was healthy

The user saw cases where:

- uptime monitoring said the backend was up
- Mailita said something failed or was "starting up"

Root cause:

- `/health` is a cheap endpoint
- `/api/messages` and `/api/messages/sync` are the expensive paths
- a slow mailbox path or local network bottleneck can fail while `/health` still looks fine

This is why the service worker now distinguishes:

- actual cold start
- timed out mailbox route
- generic fetch failure
- health-up-but-real-route-slow

### 9.2 Snippet-only rendering looked terrible

The UI originally displayed mostly `snippet` text:

- raw URLs
- broken-looking newsletter bodies
- no inline images
- nothing like Gmail

The 1.5.0 fix direction is richer body extraction plus sanitized HTML rendering.

### 9.3 IMAP body extraction initially looked like a cache issue but was not

The debug logs eventually proved:

- the backend was live
- the cache was not the only problem
- body extraction sometimes failed at MIME part selection

This led to:

- better extraction diagnostics
- richer fallback behavior
- raw-message fallback support

### 9.4 Sync felt like downtime

Earlier sync behavior blocked too long and got mislabeled as backend sleep.

That is why the user requested the background-job sync model, and 1.5.0 follows that
direction.

### 9.5 Sent/received merge logic was inconsistent

There were periods where a person’s sent and received messages did not merge cleanly.

The structural fix is the new backend canonical identity helper:

- [apps/backend/lib/message-identity.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-identity.js)

## 10. What Is Still Risky

Even after 1.5.0, these areas deserve caution:

- [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
  is still very large
- [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
  is still very large
- HTML sanitization in
  [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
  is hand-rolled and should be treated as a future hardening target
- sync jobs are intentionally lightweight and practical, but not yet a full durable job system
- search is still on the older broader flow and was intentionally not refactored in this pass

## 11. How To Bring Mailita Up From Scratch

### 11.1 Backend

1. Apply [infra/supabase-schema.sql](/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql)
2. Configure Render with the env vars documented in
   [docs/render-deploy.md](/Users/a_a_k/Downloads/EORG/docs/render-deploy.md)
3. Deploy `apps/backend`
4. Check `/health`

### 11.2 Extension

1. Load unpacked extension from
   [apps/extension](/Users/a_a_k/Downloads/EORG/apps/extension)
2. Open the popup
3. Connect Gmail with address + App Password
4. Open Gmail and verify Mailita takes over

### 11.3 Minimum sanity checks

- summary list loads
- opening a contact loads a conversation
- composer remains pinned
- settings tabs switch
- disconnect works
- reply send still works
- `/api/messages/sync` returns a `jobId`

## 12. What To Read First If You Are A New AI

Read these in this order:

1. [README.md](/Users/a_a_k/Downloads/EORG/README.md)
2. [docs/version-1.5.0-status.md](/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md)
3. [docs/render-deploy.md](/Users/a_a_k/Downloads/EORG/docs/render-deploy.md)
4. [docs/troubleshooting.md](/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md)
5. this file
6. then the code:
   - [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
   - [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
   - [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
   - [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)

## 13. Historical Notes

There are older docs and legacy runtime files in this repository.

Important rule:

- do not assume older docs describe the active runtime
- treat anything that still says "Gmail Unified", manual Sync, or old version numbers as
  historical unless a newer 1.5.0 doc explicitly points back to it

The active runtime for this release is Mailita 1.5.0 under `apps/extension` and
`apps/backend`.
