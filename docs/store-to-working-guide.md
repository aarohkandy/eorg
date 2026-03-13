# Gmail Unified: "Saw It In The Store" -> Fully Working

This is the exact production onboarding and verification flow.

## 0) Before You Start

- Install and pin the extension from Chrome Web Store.
- Keep one Gmail tab open while setting up.
- Backend endpoint is [https://email-bcknd.onrender.com](https://email-bcknd.onrender.com).
- IMAP setup is handled automatically by the backend path; onboarding no longer includes an IMAP step.

## 1) First-Time Popup Onboarding

1. Click the extension icon.
2. Step through onboarding:
   - Step 1: use the in-flow `Open App Passwords` action.
   - If Google blocks App Passwords, use the in-flow `Open 2-Step Verification` recovery path first.
   - Step 2: connect with Gmail address + Google App Password.
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

## 8) Onboarding QA Matrix (Expanded)

Run all scenarios before sign-off. For each one, record `PASS/FAIL`, browser version, and any screenshots.

### A) Fresh install path

1. Clear extension storage and reinstall.
2. Open popup and verify step order: Before you connect -> Connect account.
3. Generate App Password in Google Account Security page.
4. Paste Gmail email + App Password in popup and connect.

Pass criteria:
- No ambiguous copy; the primary action is obvious at each step.
- Step index/progress is consistent across popup + Gmail overlay + badge.
- User lands in connected state with mailbox loading.

### B) Already-configured account path

1. Pre-set `userId`, `userEmail`, `onboardingComplete=true`.
2. Open popup and Gmail tab.

Pass criteria:
- Popup opens directly in connected view.
- Gmail shell loads mailbox without showing blocked onboarding screens.
- Guide can open in review mode only (non-blocking).

### C) Misconfigured path

1. Keep account disconnected.
2. Attempt connect with missing or incorrect credentials.
3. Return to popup/Gmail guide and retry.

Pass criteria:
- Guidance does not dead-end; user can return to instruction step and retry connect.
- No stale onboarding navigation CTA appears for removed IMAP/App Password steps.

### D) Backend cold start / unavailable

1. Trigger cold-start response (`502/503/504` or timeout).
2. Attempt connect and message sync from both popup and Gmail surface.

Pass criteria:
- User sees explicit 60-second retry guidance.
- No cryptic or silent failure.
- Retry action recovers when backend is healthy.

### E) Credential failure / reconnect

1. Enter wrong app password and submit connect.
2. Verify error handling.
3. Enter correct app password and reconnect.

Pass criteria:
- Error copy is actionable and non-ambiguous.
- Input remains usable for immediate retry.
- Successful reconnect returns to connected state and updates guide/badge.

### F) Feature removal validation

1. Open Gmail while disconnected.
2. Verify onboarding renders only the two active steps.
3. Inspect DOM for legacy spotlight/setup helper nodes.

Pass criteria:
- No IMAP onboarding step appears in popup or Gmail overlay.
- No spotlight/highlight overlay appears.
- No setup-helper/auto-detection flow is active.

### G) Service worker restart during onboarding

1. Start onboarding at step 2 or 3.
2. Restart extension service worker (`chrome://extensions` -> Service Worker -> stop/restart).
3. Continue onboarding.

Pass criteria:
- Guide state persists (step, evidence, progress).
- Popup, Gmail overlay, and badge rehydrate consistently after restart.

### H) Accessibility and reduced motion

1. Enable OS/browser reduced-motion.
2. Walk through onboarding in popup and Gmail surfaces using keyboard only.

Pass criteria:
- Motion-heavy effects are suppressed under reduced-motion.
- Focus order and Enter key submission work on connect step.
- Disabled CTA states are clear and non-interactive.
