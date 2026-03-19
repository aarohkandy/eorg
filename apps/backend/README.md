# Mailita Backend

Node.js + Express backend for Mailita.

It:

- authenticates extension users
- connects to Gmail over IMAP
- normalizes Inbox + Sent messages
- caches them in Supabase
- exposes summary/contact/full-mailbox/search APIs
- runs background sync jobs

## Quick Start

1. Copy `/Users/a_a_k/Downloads/EORG/apps/backend/.env.example` to `.env`.
2. Fill the required variables:
   - `SUPABASE_URL`
   - `SUPABASE_SERVICE_KEY`
   - `ENCRYPTION_KEY`
   - `PORT`
   - `SELF_URL`
3. Apply the schema in `/Users/a_a_k/Downloads/EORG/infra/supabase-schema.sql`.
4. Install dependencies:

```bash
npm install
```

5. Start the backend:

```bash
npm run dev
```

## Endpoints

- `GET /health`
- `POST /api/auth/connect`
- `DELETE /api/auth/disconnect`
- `GET /api/messages`
- `GET /api/messages/summary`
- `GET /api/messages/contact`
- `GET /api/messages/search`
- `POST /api/messages/sync`
- `GET /api/messages/sync/status`
- `POST /api/messages/debug/contact`

## Notes

- `POST /api/messages/sync` is a background job starter in 1.5.0. It should return quickly
  with a `jobId`, while IMAP work continues asynchronously.
- Rich body fields (`body_text`, `body_html`, `body_format`, image flags, canonical contact
  fields) require the updated `messages` table schema.
- The backend will fall back to legacy `messages` upserts if the new rich-body columns are not
  present yet, but you should still apply the 1.5.0 schema before calling the release complete.
