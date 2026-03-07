# Gmail Unified Extension

Manifest V3 extension that runs directly in Gmail and fetches messages through the background service worker.

## Key behavior

- Sidebar in `mail.google.com`
- Filters: All / Inbox / Sent
- Search with debounce
- Force sync action
- Cold-start state handling for Render wake-up delays

## Cold start UX

When backend is waking, the UI shows:

"Backend server is starting up, please wait 60 seconds and try again."

with manual retry and automatic retry countdown.
