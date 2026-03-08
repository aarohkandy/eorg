# Gmail Unified: "Saw It In The Store" -> Fully Working

This is the exact production onboarding and verification flow.

## 0) Before You Start

- Install and pin the extension from Chrome Web Store.
- Keep one Gmail tab open while setting up.
- Backend endpoint is [https://email-bcknd.onrender.com](https://email-bcknd.onrender.com).

## 1) First-Time Popup Onboarding

1. Click the extension icon.
2. Step through onboarding:
   - Enable IMAP in Gmail settings.
   - Generate a Google App Password (name it `Gmail Unified`).
   - Connect with Gmail address + App Password.
3. Wait for `Connected` confirmation.

If you see:

`Backend server is starting up, please wait 60 seconds and try again.`

wait ~60 seconds and retry connect.

## 2) Open Gmail Full-Screen Runtime

1. Open `https://mail.google.com`.
2. Confirm native Gmail is hidden and full-screen black Mailita shell is visible.
3. Confirm left rail shows Inbox/Sent counters.

## 3) Complete Settings Setup (Required)

Open **Settings** in the lower-left corner and run this order:

1. **Check backend status**
2. **Sync now**
3. **Reload mailbox**

Expected outcomes:

- Backend status returns healthy
- Message list fills in
- No persistent empty-state after reload

## 4) Functional Verification Checklist

- Inbox list renders multiple rows.
- Sent mailbox loads from backend.
- Opening a conversation shows full thread timeline.
- Sending from thread input works and returns to normal state.
- Disconnect clears account and prompts re-onboarding.

## 5) Cold-Start Handling (Render Free Tier)

If backend was idle, first call can fail with cold-start behavior.

Expected UX:

- Popup and in-app settings show explicit 60-second wake-up message.
- User can retry after waiting; no cryptic failure required.

## 6) Fast Troubleshooting

- **Not connected yet**
  - Open popup and reconnect.
- **Cold start message**
  - Wait ~60 seconds, then retry Check backend status.
- **No messages after connect**
  - Run Settings sequence again: Check backend status -> Sync now -> Reload mailbox.
- **Wrong account**
  - Disconnect in settings/popup, then reconnect correct account.

## 7) Shipping Gate

A build is release-ready only when:

- Full-screen runtime replaces visible Gmail reliably.
- Inbox + Sent both populate from backend.
- Settings sequence succeeds in one pass on a connected account.
- Cold-start message appears clearly when backend is sleeping.
- No triage/Q&A prompt is shown in active UX.
