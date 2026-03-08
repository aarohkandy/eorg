# Gmail Unified (Full-Screen Gmail Replacement)

This project runs a full-screen black Gmail replacement UI inside `mail.google.com` and syncs Inbox + Sent
through an IMAP backend at [https://email-bcknd.onrender.com](https://email-bcknd.onrender.com).

## What Is Active

- Full-screen Mailita-style interface (native Gmail UI hidden while active)
- Backend-driven mailbox sync (Inbox + Sent)
- First-time popup onboarding for IMAP + App Password setup
- Settings actions in-app:
  - Check backend status
  - Sync now
  - Reload mailbox
  - Disconnect
- Explicit Render cold-start UX (`~60s` wake-up guidance)

## Store-To-Working Pipeline

1. Install extension from the Chrome Web Store and pin it.
2. Open popup and complete onboarding:
   - Enable IMAP
   - Generate Gmail App Password
   - Connect account
3. Open Gmail (`https://mail.google.com`).
4. Open in-app **Settings** (bottom-left):
   - Run **Check backend status**
   - Run **Sync now**
   - Run **Reload mailbox**
5. Verify list/thread behavior:
   - Inbox and Sent data present
   - Thread opens correctly
   - Reply send path works

If backend is cold, the UI shows:

> Backend server is starting up, please wait 60 seconds and try again.

## Runtime Layout

- `apps/backend/` — Express + IMAP + Supabase backend
- `apps/extension/` — MV3 extension (popup, service worker, full-screen Gmail UI)
- `legacy/gmail-dom-v1/` — archived legacy implementation

## Notes

- Legacy triage/Q&A modules are not part of the active UX path.
- Existing compatibility modules remain in the tree, but setup/sync/full-screen mail is the supported flow.

## More Guides

- [/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md](/Users/a_a_k/Downloads/EORG/docs/store-to-working-guide.md)
