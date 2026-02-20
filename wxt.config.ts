import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  extensionApi: 'chrome',
  manifest: {
    name: 'Gmail Hard Reskin',
    description: 'A resilient visual Gmail overlay that survives SPA rerenders.',
    permissions: ['storage'],
    host_permissions: ['https://mail.google.com/*']
  }
});
