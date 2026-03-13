import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(thisFile), '..');
const rootManifestPath = path.join(repoRoot, 'manifest.json');
const extensionManifestPath = path.join(repoRoot, 'apps', 'extension', 'manifest.json');

function readManifest(manifestPath) {
  return JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
}

function collectManifestFileRefs(manifest) {
  const refs = [];
  if (manifest.background?.service_worker) refs.push(manifest.background.service_worker);
  if (manifest.action?.default_popup) refs.push(manifest.action.default_popup);

  for (const script of manifest.content_scripts || []) {
    for (const jsFile of script.js || []) refs.push(jsFile);
    for (const cssFile of script.css || []) refs.push(cssFile);
  }

  for (const resourceBlock of manifest.web_accessible_resources || []) {
    for (const file of resourceBlock.resources || []) {
      if (!String(file).includes('*')) refs.push(file);
    }
  }

  return refs;
}

function assertManifestRefsExist(manifestPath) {
  const manifestDir = path.dirname(manifestPath);
  const manifest = readManifest(manifestPath);
  const refs = collectManifestFileRefs(manifest);

  for (const ref of refs) {
    const targetPath = path.join(manifestDir, ref);
    assert.equal(
      fs.existsSync(targetPath),
      true,
      `Missing manifest runtime file: ${path.relative(repoRoot, targetPath)}`
    );
  }
}

test('root manifest runtime files exist', () => {
  assertManifestRefsExist(rootManifestPath);
});

test('apps/extension manifest runtime files exist', () => {
  assertManifestRefsExist(extensionManifestPath);
});

test('duplicate manifests keep core permission parity', () => {
  const rootManifest = readManifest(rootManifestPath);
  const extManifest = readManifest(extensionManifestPath);

  assert.deepEqual(
    [...rootManifest.permissions].sort(),
    [...extManifest.permissions].sort(),
    'permissions diverged'
  );
  assert.deepEqual(
    [...rootManifest.host_permissions].sort(),
    [...extManifest.host_permissions].sort(),
    'host permissions diverged'
  );
  assert.equal(
    rootManifest.content_scripts?.[0]?.matches?.join(','),
    extManifest.content_scripts?.[0]?.matches?.join(','),
    'content script match patterns diverged'
  );
});

test('root manifest explicitly points to active extension content path', () => {
  const rootManifest = readManifest(rootManifestPath);
  assert.equal(
    rootManifest.content_scripts?.[0]?.js?.[0],
    'apps/extension/content/gmail-inject.js'
  );
  assert.equal(
    rootManifest.content_scripts?.[0]?.css?.[0],
    'apps/extension/content/styles.css'
  );
});
