# Mailita: Store to Fully Working

This is the exact human/operator flow for getting Mailita from extension install to a working
Gmail session.

## 1. Install and Pin

1. Install the extension.
2. Pin it in Chrome so the popup is easy to reach during setup.

## 2. Create a Gmail App Password

1. Open [Google App Passwords](https://myaccount.google.com/apppasswords).
2. If App Passwords is blocked, enable
   [2-Step Verification](https://myaccount.google.com/signinoptions/two-step-verification) first.
3. Create a new App Password for Mailita and copy the 16-character code.

## 3. Connect the Account

1. Open the Mailita popup.
2. Enter the Gmail address to sync.
3. Enter the App Password.
4. Connect.

Expected result:

- Popup shows connected state
- Backend connection succeeds
- Background sync starts automatically

## 4. Open Gmail

1. Open [https://mail.google.com](https://mail.google.com).
2. Confirm the visible Gmail UI is replaced by the Mailita shell.
3. Confirm the left rail loads people/conversation summaries.

## 5. Verify Core Behavior

- Opening a person shows a chat-style history
- Composer stays pinned at the bottom while the message lane scrolls
- Images and linked images render when available in the message body
- Settings tabs switch properly
- No manual Sync button is required

## 6. What to Do When It Looks Down

- If `/health` is up but `/api/messages` is slow, the backend is not necessarily asleep.
- If Mailita says a request timed out while `/health` is up, treat it as a slow path or local
  network bottleneck first.
- Use the Privacy debug panel only when actively investigating content/merge problems.

## 7. Production Readiness Checklist

- Backend deployed from `apps/backend`
- Supabase schema applied from `infra/supabase-schema.sql`
- `/health` reports the expected version/build
- Extension manifest version matches the release version
- Gmail render, reply send, settings, and background sync all work in one session
