# Mailita Render Deployment

This file is the operator/deployer source of truth for the active Mailita backend.

## 1. Render Service Definition

- Provider: Render
- Type: Web Service
- Root directory: `apps/backend`
- Build command: `npm install`
- Start command: `npm start`

Notes:

- Mailita does not require a monorepo build step for the active backend.
- The backend package is self-contained under `apps/backend`.

## 2. Required Environment Variables

These must exist before the backend can work:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ENCRYPTION_KEY`
- `PORT`
- `SELF_URL`

Recommended values:

- `PORT=3000`
- `SELF_URL=https://email-bcknd.onrender.com`

Meaning:

- `SUPABASE_URL`
  - the Supabase project URL
- `SUPABASE_SERVICE_KEY`
  - service-role key used for backend reads/writes
- `ENCRYPTION_KEY`
  - symmetric key used for encrypted App Password storage
- `PORT`
  - local runtime port
- `SELF_URL`
  - public backend URL used in some self-referential/debug flows

Mailita also consumes Render-provided metadata when present:

- `RENDER_GIT_COMMIT`
- `RENDER_DEPLOYED_AT`
- `RENDER_DEPLOY_TIMESTAMP`
- `RENDER_DEPLOY_ID`

These appear in `/health` and debug payloads and are extremely helpful during mismatch
investigations.

## 3. Supabase Schema Setup

Apply:

- [infra/supabase-schema.sql](/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql)

The 1.5.0 release depends on these schema additions:

### `messages` columns

- `contact_key`
- `contact_email`
- `contact_name`
- `body_text`
- `body_html`
- `body_format`
- `has_remote_images`
- `has_linked_images`

### `sync_jobs` table

1.5.0 introduces background sync jobs. That requires:

- `sync_jobs`
- indexes on `user_id` and `status`

### Important fallback note

The backend can fall back if the schema is stale:

- message upserts can drop back to a legacy shape
- sync job persistence can fall back to in-memory tracking

This helps avoid a full outage, but it does **not** mean the deployment is healthy. Apply the
schema before calling the release complete.

## 4. Deploy Procedure

1. Ensure `main` contains the intended release commit.
2. Confirm Render service root is `apps/backend`.
3. Confirm all required env vars are set.
4. Apply the current Supabase schema.
5. Deploy the service.
6. Check:
   - `/health`
   - version
   - build SHA
   - deployed-at metadata if available
7. Open Mailita in Gmail and verify:
   - summary list loads
   - opening a contact loads a conversation
   - sync jobs start automatically
   - contact conversations include sent + received mail together

## 5. 1.5.0 Runtime Behavior That Matters In Production

### Sync is job-based now

`POST /api/messages/sync` should return quickly with:

- `success`
- `jobId`
- `status`

The extension or operator should then poll:

- `GET /api/messages/sync/status?jobId=...`

### Summary and contact routes stay responsive

The app should not need a full blocking mailbox fetch just to show the inbox list. The summary
route is intentionally lighter than the legacy mailbox route.

### `/health` is necessary but not sufficient

If `/health` is fast but `/api/messages` or `/api/messages/sync` is slow, Mailita can still
feel broken in the browser.

## 6. Expected Operator Checks After Deploy

### Backend checks

- [https://email-bcknd.onrender.com/health](https://email-bcknd.onrender.com/health) returns `200`
- `/health` version matches the release version
- `/health` build SHA matches the pushed commit on `main`

### Functional checks

- `GET /api/messages/summary` returns quickly for a connected user
- opening a person in Mailita loads `GET /api/messages/contact`
- `POST /api/messages/sync` returns a `jobId`
- `GET /api/messages/sync/status` progresses to completed or failed

## 7. If Something Goes Wrong

### `/health` is up but Mailita times out

This usually means:

- the real mailbox route is slow
- or the browser/network path is slow

It does **not** automatically mean Render is sleeping.

### Rich message bodies are missing

Check:

1. whether the schema includes the new `messages` body/contact columns
2. whether `/health` version/build is the expected deploy
3. whether the backend trace shows schema fallback warnings

### Sync looks stuck

Check:

1. whether `POST /api/messages/sync` returned a `jobId`
2. whether `GET /api/messages/sync/status` is moving through phases
3. whether the worker is timing out locally while the job continues

## 8. Rollback

If you must roll back:

1. choose the previous known-good Git SHA on `main`
2. redeploy Render from that SHA
3. keep the Supabase schema in place unless the older code is known to be incompatible
4. verify:
   - `/health`
   - summary list
   - contact load
   - reply send
   - automatic sync behavior
