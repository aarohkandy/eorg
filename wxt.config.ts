import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  manifest: {
    name: 'Gmail Unified',
    description: 'Full-screen Gmail replacement with backend Inbox + Sent sync.',
    permissions: ['storage', 'unlimitedStorage', 'tabs'],
    host_permissions: [
      'https://mail.google.com/*',
      'https://email-bcknd.onrender.com/*'
    ]
  }
});
