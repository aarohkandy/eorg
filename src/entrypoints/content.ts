import '../../apps/extension/content/gmail-inject.js';

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_idle',
  main() {
    // Gmail Unified runtime bootstraps itself on load.
  }
});
