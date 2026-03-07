# Gmail Unified Backend

Node.js + Express backend for IMAP message fetch, cache, and search.

## Quick start

1. Copy `.env.example` to `.env` and fill values.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Run IMAP proof-of-concept:
   ```bash
   npm run test:imap
   ```
4. Start API server:
   ```bash
   npm run dev
   ```

## Endpoints

- `GET /health`
- `POST /api/auth/connect`
- `DELETE /api/auth/disconnect`
- `GET /api/messages`
- `GET /api/messages/search`
- `POST /api/messages/sync`
