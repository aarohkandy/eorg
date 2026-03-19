# Mailita Troubleshooting

This file captures the real operational lessons from the Mailita 1.5.0 cycle.

## 1. `/health` Is Up but Gmail Still Says It Failed

This was a major issue during the 1.5.0 cycle.

Important rule:

- `/health` up does **not** mean `/api/messages` or `/api/messages/sync` are fast.

If Mailita says:

> Backend /health is up, but /api/messages... timed out

that means:

- Render is reachable
- but the real mailbox route is too slow for the browser timeout budget, or the browser/network
  path is bottlenecked

It is **not** the same as a confirmed Render cold start.

What to do:

1. compare `/health` timing with the failing route timing
2. check whether the failure mentions `/api/messages`, `/api/messages/contact`, or
   `/api/messages/sync`
3. treat it as a route-performance or browser-network problem first, not an uptime problem

## 2. Why Snippet-Only Rendering Looked Bad

Earlier builds only rendered `snippet` text in the chat pane.

That caused:

- no inline images
- ugly raw link dumps
- email bodies that looked nothing like Gmail

1.5.0 fixes this by carrying rich body fields (`bodyText`, `bodyHtml`) through the backend and
rendering sanitized HTML in the extension when available.

If the UI starts looking raw/ugly again, check:

1. whether the backend is sending only `snippet`
2. whether `body_html` / `body_text` are missing in cached rows
3. whether the updated schema was applied

## 3. Why Conversations Failed to Merge Properly

Sent/received merge bugs came from duplicated contact-key logic.

The fix direction is:

- compute canonical `contactKey`, `contactEmail`, and `contactName` on the backend
- preserve them in cache
- use them consistently in summary, contact, legacy fallback, and UI state

If a conversation still looks split:

1. check whether the contact email differs across directions
2. inspect cached rows for missing `contact_email`
3. confirm the updated schema is applied

## 4. Why Long Sync Requests Felt Like Downtime

Old behavior:

- `/api/messages/sync` blocked until IMAP finished
- the extension timed out after 12 seconds and looked broken

1.5.0 fix:

- sync is now a background job
- the extension starts the job quickly
- the worker polls `/api/messages/sync/status`

If sync still looks bad:

1. confirm the backend is returning a `jobId`
2. poll the status route manually
3. verify the worker timeout message mentions the sync path specifically

## 5. Why Content Extraction Sometimes Failed Even When IMAP Was Working

During this cycle, there were cases where:

- IMAP fetch completed
- cached rows updated
- but all visible message content was still blank

Important lesson:

- this can be a MIME/body extraction bug, not a cache bug and not a frontend bug

The richer debug path added in this cycle exists specifically to separate:

- stale cache
- old backend deploy
- no useful MIME part selected
- parse failure
- sanitized-empty output

## 6. How to Verify a Live Deploy

Check:

- `/health`
- version
- build SHA
- deployed-at value if present

If the UI and backend disagree, check whether the extension is newer than the deployed Render
build.

## 7. Schema Mismatch Symptoms

If the database schema is old, you may see:

- fallback warnings for missing `messages` rich-body columns
- no persisted `body_html` / `body_text`
- no canonical `contact_email`
- sync job persistence falling back to in-memory only

This means the code may still run, but the full 1.5.0 behavior is not actually deployed.

## 8. Debugging Priority Order

When something looks wrong, debug in this order:

1. `/health` version/build
2. schema currentness
3. summary/contact route timing
4. sync job status
5. rich body presence (`bodyText` / `bodyHtml`)
6. canonical contact fields (`contactKey` / `contactEmail`)

That order avoids repeating the most expensive mistakes from this cycle.
