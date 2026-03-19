# Mailita Extension (Active Runtime)

This is the active Chrome Manifest V3 extension package for Mailita.

## Key Behavior

- Runs only on `https://mail.google.com/*`
- Replaces visible Gmail with a full-screen Mailita shell
- Loads the left rail from `/api/messages/summary`
- Loads the open chat pane from `/api/messages/contact`
- Starts background sync automatically instead of exposing a manual sync button
- Shows explicit cold-start vs timeout/network messaging from the service worker

## Backend URL

- `https://email-bcknd.onrender.com`

## Current Runtime Shape

- Manifest: `/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json`
- Background worker: `/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js`
- Gmail content script: `/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js`
- Styles: `/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css`

## Main User Flow

1. Finish popup onboarding with Gmail address + Gmail App Password.
2. Open Gmail.
3. Mailita summary list loads quickly from cached or summary data.
4. Opening a person loads only that contact's conversation.
5. Background sync jobs refresh the mailbox automatically.

## Notes

- The active runtime is still raw manifest-loaded JS/CSS, not a bundled frontend app.
- The Privacy settings tab controls the temporary debug log and remote-image behavior.
- Reply send still goes through native Gmail compose automation.
