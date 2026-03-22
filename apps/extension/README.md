# Mailita Extension (Active Runtime)

This is the active Chrome Manifest V3 extension package for Mailita.

## Key Behavior

- Runs only on `https://mail.google.com/*`
- Replaces visible Gmail with a full-screen Mailita shell
- Loads the left rail from the Gmail API through the extension service worker
- Loads the open chat pane from the Gmail API through the extension service worker
- Starts local refresh automatically instead of exposing a manual sync button
- Uses Google OAuth instead of App Password onboarding

## Current Runtime Shape

- Manifest: `/Users/a_a_k/Downloads/EORG/apps/extension/manifest.json`
- Background worker: `/Users/a_a_k/Downloads/EORG/apps/extension/background/service-worker.js`
- Local Gmail adapter: `/Users/a_a_k/Downloads/EORG/apps/extension/background/gmail-local.js`
- Gmail content script: `/Users/a_a_k/Downloads/EORG/apps/extension/content/gmail-inject.js`
- Styles: `/Users/a_a_k/Downloads/EORG/apps/extension/content/styles.css`

## Main User Flow

1. Click `Connect with Google`.
2. Open Gmail.
3. Mailita summary list loads from the local Gmail API cache.
4. Opening a person loads only that contact's conversation.
5. Background refresh keeps the mailbox current.

## Notes

- The active runtime is still raw manifest-loaded JS/CSS, not a bundled frontend app.
- The Privacy settings tab controls the temporary debug log and remote-image behavior.
- Reply send still goes through native Gmail compose automation.
- The IMAP backend remains in the repo as a fallback path, but it is not the default beta setup.
