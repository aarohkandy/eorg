# Mailita 1.5.0 Status

## Release

- Version: `1.5.0`
- Release line: `main`
- Expected post-push state:
  - extension manifest, root manifest, root package, and backend package all report `1.5.0`
  - `/health` reports version `1.5.0`
  - the release commit on `main` uses the message `everything works`

Note about commit SHA:

- This document lives inside the release commit, so it cannot safely self-contain its own final
  Git SHA without changing that SHA again.
- To identify the exact release commit, read the latest `main` commit whose subject is
  `everything works`.

## What 1.5.0 Means

- Mailita branding is the active product identity
- summary/contact mailbox load is the main path
- sync is background-job based
- chat detail view renders rich bodies when available
- settings debug tools live under Privacy
- manual sync controls are intentionally removed from the user-facing UI

## Active Components

- Extension: `/Users/a_a_k/Downloads/EORG/apps/extension`
- Backend: `/Users/a_a_k/Downloads/EORG/apps/backend`
- Schema: `/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql`
- Operator bootstrap doc: `/Users/a_a_k/Downloads/EORG/docs/ai-bootstrap.md`

## Bring-Up Steps

1. Apply the Supabase schema.
2. Deploy the backend to Render from `apps/backend`.
3. Load the extension from `apps/extension`.
4. Connect Gmail with an App Password.
5. Open Gmail and verify Mailita takes over.

## What Should Be Live After Release

- `/api/messages/summary` drives first paint in the left rail
- `/api/messages/contact` drives the chat pane
- `POST /api/messages/sync` starts a background job instead of blocking
- `GET /api/messages/sync/status` is the route the worker polls
- canonical contact fields exist throughout the message pipeline
- rich body fields are persisted when the schema is current

## Rollback Guidance

If you must revert:

1. Revert to the previous known-good `main` commit.
2. Redeploy Render.
3. Reload the unpacked extension.
4. Verify:
   - `/health`
   - summary list
   - contact detail
   - reply send
   - automatic sync
   - no broken schema assumptions

## Things an Operator Should Always Check

- `/health` version + build SHA
- Render service root and env vars
- Supabase schema currentness
- whether timeouts are happening on `/api/messages`, `/api/messages/contact`, or `/api/messages/sync`
- whether the extension is newer than the deployed backend
