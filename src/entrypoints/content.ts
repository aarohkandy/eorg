import '../../inboxsdk.js';
import '../../ai.js';
import '../../triage.js';
import '../../content.js';

export default defineContentScript({
  matches: ['https://mail.google.com/*'],
  runAt: 'document_idle',
  main() {
    // Legacy JS content stack bootstraps itself on load.
  }
});
