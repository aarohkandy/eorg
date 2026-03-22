import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const repoRoot = path.resolve(import.meta.dirname, '..', '..');
const workerPath = path.join(repoRoot, 'apps', 'extension', 'background', 'service-worker.js');
const workerCode = fs.readFileSync(workerPath, 'utf8');

function createChromeStub() {
  const localData = {};
  return {
    action: {
      setBadgeText: async () => {},
      setTitle: async () => {},
      setBadgeBackgroundColor: async () => {}
    },
    storage: {
      local: {
        async get(keys) {
          if (!keys) return { ...localData };
          if (Array.isArray(keys)) {
            return keys.reduce((acc, key) => {
              acc[key] = localData[key];
              return acc;
            }, {});
          }
          if (typeof keys === 'string') {
            return { [keys]: localData[keys] };
          }
          if (keys && typeof keys === 'object') {
            return Object.keys(keys).reduce((acc, key) => {
              acc[key] = localData[key] ?? keys[key];
              return acc;
            }, {});
          }
          return {};
        },
        async set(values) {
          Object.assign(localData, values || {});
        },
        async clear() {
          for (const key of Object.keys(localData)) {
            delete localData[key];
          }
        }
      }
    },
    tabs: {
      onActivated: { addListener: () => {} },
      onUpdated: { addListener: () => {} },
      query: async () => [],
      update: async () => ({}),
      create: async () => ({})
    },
    windows: {
      update: async () => ({})
    },
    runtime: {
      onInstalled: { addListener: () => {} },
      onStartup: { addListener: () => {} },
      onMessage: { addListener: () => {} }
    }
  };
}

function loadWorkerContext() {
  const context = {
    chrome: createChromeStub(),
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ success: true }) }),
    AbortController,
    URLSearchParams,
    Date,
    console,
    setTimeout,
    clearTimeout
  };
  vm.createContext(context);
  vm.runInContext(workerCode, context, { filename: workerPath });
  return context;
}

test('legacy 4-step in-progress state migrates to single-step OAuth connect stage', () => {
  const ctx = loadWorkerContext();
  const legacy = {
    step: 'generate_app_password',
    status: {
      welcome: 'done',
      enable_imap: 'done',
      generate_app_password: 'done',
      connect_account: 'pending'
    },
    connected: false
  };

  const migrated = ctx.normalizeGuideState(legacy, false);
  assert.equal(migrated.step, 'connect_account');
  assert.equal(migrated.status.connect_account, 'in_progress');
  assert.equal(migrated.total, 1);
  assert.equal(migrated.progress, 0);
});

test('legacy connected users remain fully connected after normalization', () => {
  const ctx = loadWorkerContext();
  const legacyConnected = {
    step: 'connect_account',
    status: {
      welcome: 'done',
      enable_imap: 'done',
      generate_app_password: 'done',
      connect_account: 'done'
    },
    connected: true
  };

  const migrated = ctx.normalizeGuideState(legacyConnected, true);
  assert.equal(migrated.connected, true);
  assert.equal(migrated.status.connect_account, 'done');
  assert.equal(migrated.progress, 1);
  assert.equal(migrated.total, 1);
});

test('empty state falls back safely to the single OAuth connect step', () => {
  const ctx = loadWorkerContext();
  const migrated = ctx.normalizeGuideState(null, false);

  assert.equal(migrated.step, 'connect_account');
  assert.equal(migrated.substep, 'connect_ready');
  assert.equal(migrated.status.connect_account, 'in_progress');
  assert.equal(migrated.progress, 0);
  assert.equal(migrated.total, 1);
});
