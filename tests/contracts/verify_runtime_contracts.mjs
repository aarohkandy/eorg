import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

function readJson(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return JSON.parse(fs.readFileSync(absolutePath, 'utf8'));
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  return fs.readFileSync(absolutePath, 'utf8');
}

function assertIncludes(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message);
}

function assertNotIncludes(haystack, needle, message) {
  assert.ok(!haystack.includes(needle), message);
}

function verifyActiveManifest() {
  const manifest = readJson('apps/extension/manifest.json');
  const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
  const hostPermissions = Array.isArray(manifest.host_permissions) ? manifest.host_permissions : [];

  assert.deepEqual(
    permissions,
    ['storage', 'unlimitedStorage', 'tabs', 'alarms', 'identity'],
    'Active manifest permissions must include identity for Google OAuth.'
  );
  assert.equal(manifest.name, 'Mailita', 'Active manifest name must be Mailita.');
  assert.match(
    String(manifest.description || ''),
    /direct Gmail OAuth/i,
    'Active manifest description must reflect the direct Gmail OAuth runtime.'
  );
  assert.ok(
    !('web_accessible_resources' in manifest),
    'Active manifest must not expose legacy web_accessible_resources.'
  );
  assert.equal(
    manifest.background?.service_worker,
    'background/service-worker.js',
    'Active manifest must use extension service worker.'
  );

  const script = manifest.content_scripts?.[0];
  assert.deepEqual(
    script?.js,
    ['content/gmail-inject.js'],
    'Active manifest must load the Mailita injector only.'
  );
  assert.deepEqual(
    script?.css,
    ['content/styles.css'],
    'Active manifest must load the Mailita stylesheet only.'
  );
  assert.ok(
    hostPermissions.includes('https://mail.google.com/*'),
    'Active manifest must include Gmail host permission.'
  );
  assert.ok(
    hostPermissions.includes('https://www.googleapis.com/*'),
    'Active manifest must include Gmail API host permission.'
  );
  assert.ok(
    manifest.oauth2?.client_id,
    'Active manifest must declare an OAuth client ID placeholder or value.'
  );
  assert.deepEqual(
    script?.matches,
    ['https://mail.google.com/*'],
    'Active content script should run only on Gmail pages.'
  );
}

function verifyRootManifestWrapper() {
  const manifest = readJson('manifest.json');

  assert.equal(
    manifest.background?.service_worker,
    'apps/extension/background/service-worker.js',
    'Root manifest must delegate service worker to the active extension runtime.'
  );
  assert.deepEqual(
    manifest.content_scripts?.[0]?.js,
    ['apps/extension/content/gmail-inject.js'],
    'Root manifest must delegate content script to apps/extension runtime.'
  );
  assert.deepEqual(
    manifest.content_scripts?.[0]?.css,
    ['apps/extension/content/styles.css'],
    'Root manifest must delegate content CSS to apps/extension runtime.'
  );
  assert.deepEqual(
    manifest.content_scripts?.[0]?.matches,
    ['https://mail.google.com/*'],
    'Root manifest wrapper content script scope must mirror active Gmail-only runtime.'
  );
  assert.ok(
    !('web_accessible_resources' in manifest),
    'Root manifest wrapper must not expose legacy web_accessible_resources.'
  );
}

function verifyWorkerContracts() {
  const worker = readText('apps/extension/background/service-worker.js');

  assertIncludes(
    worker,
    'const DEFAULT_MAIL_SOURCE = MAIL_SOURCE_GMAIL_API_LOCAL;',
    'Service worker must default to the local Gmail API mail source.'
  );
  assertIncludes(
    worker,
    "importScripts('gmail-local.js');",
    'Service worker must import the local Gmail adapter.'
  );
  assertNotIncludes(
    worker,
    'inboxsdk__injectPageWorld',
    'Service worker must not keep legacy InboxSDK page-world injection active.'
  );
  assertNotIncludes(
    worker,
    'chrome.scripting.executeScript',
    'Service worker must not execute legacy page-world script injection.'
  );
}

function verifyClientCredentialSafety() {
  const worker = readText('apps/extension/background/service-worker.js');
  const injector = readText('apps/extension/content/gmail-inject.js');
  const popup = readText('apps/extension/popup/popup.js');

  assertNotIncludes(
    worker,
    'chrome.storage.local.set({ appPassword',
    'Service worker must never write appPassword into chrome.storage.'
  );
  assertNotIncludes(
    worker,
    'localStorage.setItem("appPassword"',
    'Service worker must never write appPassword into localStorage.'
  );
  assertNotIncludes(
    popup,
    'chrome.storage.local.set({ appPassword',
    'Popup must never write appPassword into chrome.storage.'
  );
  assertNotIncludes(
    injector,
    'chrome.storage.local.set({ appPassword',
    'Content injector must never write appPassword into chrome.storage.'
  );
  assertIncludes(
    injector,
    "sendWorker('CONNECT_GOOGLE')",
    'Content injector must start the Google OAuth connect flow.'
  );
  assertIncludes(
    popup,
    "callWorker('CONNECT_GOOGLE')",
    'Popup must start the Google OAuth connect flow.'
  );
}

function verifyOnboardingModel() {
  const worker = readText('apps/extension/background/service-worker.js');
  const injector = readText('apps/extension/content/gmail-inject.js');
  const popup = readText('apps/extension/popup/popup.js');
  const popupHtml = readText('apps/extension/popup/popup.html');
  const styles = readText('apps/extension/content/styles.css');

  assertIncludes(
    worker,
    "const GUIDE_STEPS = ['connect_account'];",
    'Service worker onboarding model must be a single-step OAuth flow.'
  );
  assertIncludes(
    injector,
    "const GUIDE_STEPS = ['connect_account'];",
    'Gmail overlay onboarding model must be a single-step OAuth flow.'
  );
  assertNotIncludes(
    injector,
    'enable_imap',
    'Gmail overlay must not run legacy enable_imap step logic.'
  );
  assertNotIncludes(
    injector,
    'generate_app_password',
    'Gmail overlay must not run legacy generate_app_password step logic.'
  );
  assertNotIncludes(
    popup,
    'enable_imap',
    'Popup must not run legacy enable_imap step logic.'
  );
  assertNotIncludes(
    popup,
    'generate_app_password',
    'Popup must not run legacy generate_app_password step logic.'
  );
  assertNotIncludes(
    styles,
    'gmail-unified-spotlight',
    'Spotlight/highlight CSS path must be removed from active runtime.'
  );
  assertNotIncludes(
    injector,
    'spotlight',
    'Spotlight/highlight runtime path must be removed from Gmail overlay.'
  );
  assertIncludes(
    popupHtml,
    'Connect with Google',
    'Popup onboarding should offer Google OAuth as the primary action.'
  );
  assertNotIncludes(
    injector,
    'https://myaccount.google.com/apppasswords',
    'Gmail overlay must not provide a direct path to Google App Passwords.'
  );
  assertNotIncludes(
    popup,
    'myaccount.google.com/apppasswords',
    'Popup must not provide a direct path to Google App Passwords.'
  );
  assertIncludes(
    popupHtml,
    'Open Gmail',
    'Popup should keep a direct path back to Gmail.'
  );
}

function verifyAutomaticSyncAndSettingsContracts() {
  const worker = readText('apps/extension/background/service-worker.js');
  const injector = readText('apps/extension/content/gmail-inject.js');
  const popupHtml = readText('apps/extension/popup/popup.html');
  const popupJs = readText('apps/extension/popup/popup.js');

  assertIncludes(
    worker,
    'const SYNC_FETCH_TIMEOUT_MS = 10000;',
    'Service worker sync timeout must be 10 seconds per request.'
  );
  assertIncludes(
    worker,
    "const SYNC_ALARM_NAME = 'mailita-sync-cadence';",
    'Service worker must keep the automatic sync cadence alarm.'
  );
  assertIncludes(
    worker,
    "fetchBackend(`/api/messages/sync/status?${params.toString()}`",
    'Service worker must poll sync status instead of waiting on one blocking sync response.'
  );
  assertIncludes(
    injector,
    "sendWorker('SYNC_MESSAGES', { trackActivity: false })",
    'Mailita UI must auto-trigger background sync from the content runtime.'
  );
  assertNotIncludes(
    injector,
    'id="gmailUnifiedSync"',
    'Mailita UI must not render the old top-bar Sync button.'
  );
  assertNotIncludes(
    injector,
    '<header class="gmail-unified-topbar">',
    'Mailita UI must not render the removed global top bar.'
  );
  assertNotIncludes(
    popupHtml,
    'syncBtn',
    'Popup must not expose the old manual sync button.'
  );
  assertNotIncludes(
    popupHtml,
    'retrySyncBtn',
    'Popup must not expose the old retry sync button.'
  );
  assertNotIncludes(
    popupJs,
    'syncBtn',
    'Popup runtime must not wire the removed manual sync button.'
  );
  assertNotIncludes(
    popupJs,
    'retrySyncBtn',
    'Popup runtime must not wire the removed retry sync button.'
  );
}

function main() {
  verifyActiveManifest();
  verifyRootManifestWrapper();
  verifyWorkerContracts();
  verifyClientCredentialSafety();
  verifyOnboardingModel();
  verifyAutomaticSyncAndSettingsContracts();
  console.log('Runtime contract checks passed.');
}

main();
