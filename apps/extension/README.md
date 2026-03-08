# Gmail Unified Extension (Active Runtime)

This is the active Chrome extension package.

## Key Behavior

- Runs only on `https://mail.google.com/*`
- Replaces visible Gmail with a full-screen custom shell
- Loads Inbox/Sent from backend through service worker actions
- Uses popup onboarding for first-time setup
- Shows explicit Render cold-start guidance

## Backend URL

- `https://email-bcknd.onrender.com`

## Cold Start UX

When Render is asleep, extension responses are normalized as `BACKEND_COLD_START` and the UI shows:

> Backend server is starting up, please wait 60 seconds and try again.

## Main User Flow

1. Popup onboarding (IMAP + App Password)
2. Open Gmail full-screen shell
3. In Settings: Check backend status -> Sync now -> Reload mailbox
4. Use Inbox/Sent and thread reply normally

## Non-Goals (Current Build)

- AI triage and inbox Q&A are disabled.
