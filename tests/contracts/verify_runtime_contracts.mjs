import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..', '..');

const ACTIVE_BACKEND_URL = 'https://email-bcknd.onrender.com';

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
    ['storage', 'unlimitedStorage', 'tabs'],
    'Active manifest permissions must be scoped to storage/unlimitedStorage/tabs only.'
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
    'Active manifest must load the Gmail Unified injector only.'
  );
  assert.deepEqual(
    script?.css,
    ['content/styles.css'],
    'Active manifest must load the Gmail Unified stylesheet only.'
  );
  assert.ok(
    hostPermissions.includes('https://mail.google.com/*'),
    'Active manifest must include Gmail host permission.'
  );
  assert.ok(
    hostPermissions.includes(`${ACTIVE_BACKEND_URL}/*`),
    'Active manifest must include backend host permission.'
  );
  assert.ok(
    !hostPermissions.includes('https://myaccount.google.com/*'),
    'Active manifest must not inject onboarding runtime into Google Account pages.'
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
    `const BACKEND_URL = '${ACTIVE_BACKEND_URL}';`,
    'Service worker must pin BACKEND_URL to Render production backend.'
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
    'passInput.value = \'\';',
    'Content injector must clear app password input after connect attempt.'
  );
  assertIncludes(
    popup,
    "onboardingPasswordInput.value = '';",
    'Popup onboarding must clear app password input after connect attempt.'
  );
  assertIncludes(
    injector,
    "sendWorker('CONNECT', { email, appPassword })",
    'Content injector must keep CONNECT payload contract { email, appPassword }.'
  );
  assertIncludes(
    popup,
    "callWorker('CONNECT', { email, appPassword })",
    'Popup must keep CONNECT payload contract { email, appPassword }.'
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
    "const GUIDE_STEPS = ['welcome', 'connect_account'];",
    'Service worker onboarding model must be two-step (welcome + connect_account).'
  );
  assertIncludes(
    injector,
    "const GUIDE_STEPS = ['welcome', 'connect_account'];",
    'Gmail overlay onboarding model must be two-step (welcome + connect_account).'
  );
  assertIncludes(
    popup,
    "const GUIDE_STEP_KEYS = ['welcome', 'connect_account'];",
    'Popup onboarding model must be two-step (welcome + connect_account).'
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
    'Step 1 of 2',
    'Popup onboarding should present instruction-first two-step copy.'
  );
  assertIncludes(
    popupHtml,
    'Before You Connect',
    'Popup onboarding should start with prerequisite instructions.'
  );
  assertIncludes(
    injector,
    'https://myaccount.google.com/apppasswords',
    'Gmail overlay must provide a direct path to Google App Passwords.'
  );
  assertIncludes(
    popup,
    'https://myaccount.google.com/apppasswords',
    'Popup must provide a direct path to Google App Passwords.'
  );
  assertIncludes(
    popupHtml,
    'Open App Passwords',
    'Popup onboarding should let the user open App Passwords from the flow.'
  );
  assertIncludes(
    popupHtml,
    'Open 2-Step Verification',
    'Popup onboarding should let the user recover by opening 2-Step Verification.'
  );
}

function main() {
  verifyActiveManifest();
  verifyRootManifestWrapper();
  verifyWorkerContracts();
  verifyClientCredentialSafety();
  verifyOnboardingModel();
  console.log('Runtime contract checks passed.');
}

main();
