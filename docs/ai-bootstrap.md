# Mailita AI Bootstrap

Use this file if you are a new AI entering the repository with only GitHub access.

## Read Order

1. [README.md](/Users/a_a_k/Downloads/EORG/README.md)
2. [docs/version-1.5.0-status.md](/Users/a_a_k/Downloads/EORG/docs/version-1.5.0-status.md)
3. [docs/render-deploy.md](/Users/a_a_k/Downloads/EORG/docs/render-deploy.md)
4. [docs/troubleshooting.md](/Users/a_a_k/Downloads/EORG/docs/troubleshooting.md)
5. [docs/context.md](/Users/a_a_k/Downloads/EORG/docs/context.md)

## Active Runtime

Ignore older scaffolding first. The active runtime is:

- extension: [apps/extension](/Users/a_a_k/Downloads/EORG/apps/extension)
- backend: [apps/backend](/Users/a_a_k/Downloads/EORG/apps/backend)
- schema: [infra/supabase-schema.sql](/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql)

## First Technical Checks

1. Check [apps/extension/manifest.json](/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json)
2. Check [apps/extension/background/service-worker.js](/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js)
3. Check [apps/extension/content/gmail-inject.js](/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js)
4. Check [apps/backend/routes/messages.js](/Users/a_a_k/Downloads/EORG/apps/backend/routes/messages.js)
5. Check [apps/backend/lib/imap.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/imap.js)
6. Check [apps/backend/lib/message-normalize.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-normalize.js)
7. Check [apps/backend/lib/message-identity.js](/Users/a_a_k/Downloads/EORG/apps/backend/lib/message-identity.js)

## Setup Requirements

### Render env vars

- `SUPABASE_URL`
- `SUPABASE_SERVICE_KEY`
- `ENCRYPTION_KEY`
- `PORT`
- `SELF_URL`

### Supabase

Apply:

- [infra/supabase-schema.sql](/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql)

### Extension load

Load unpacked from:

- [apps/extension](/Users/a_a_k/Downloads/EORG/apps/extension)

## Architectural Facts You Must Not Miss

- The active extension runtime is raw manifest-loaded JS, not a bundled app.
- Summary/contact endpoints are the preferred mailbox flow.
- Sync is background-job based in 1.5.0.
- The legacy full mailbox route still exists for compatibility.
- Rich email rendering depends on `bodyText` / `bodyHtml` and the updated schema.
- Contact merging depends on canonical backend fields, not ad hoc frontend heuristics.

## Common Failure Modes

- `/health` up but mailbox routes timing out
- stale or missing schema columns causing fallback behavior
- extension newer than deployed backend
- rich bodies missing because only snippets are cached or extracted
- split conversations because canonical contact fields are absent

## Local Verification Commands

From repo root:

```bash
node --check apps/backend/routes/messages.js
node --check apps/backend/lib/imap.js
node --check apps/backend/lib/message-normalize.js
node --check apps/extension/background/service-worker.js
node --check apps/extension/content/gmail-inject.js
npm run test:contracts
```

## Release Discipline

- keep version surfaces aligned
- update docs when runtime behavior changes
- do not remove compatibility paths casually
- push `main` only after syntax/tests/docs line up
