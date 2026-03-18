import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../package.json');

function normalizeOptional(value) {
  const normalized = String(value || '').trim();
  return normalized || undefined;
}

export function getBuildInfo() {
  return {
    version: String(packageJson?.version || '0.0.0'),
    buildSha: normalizeOptional(process.env.RENDER_GIT_COMMIT) || 'unknown',
    deployedAt: normalizeOptional(
      process.env.RENDER_DEPLOYED_AT
      || process.env.RENDER_DEPLOY_TIMESTAMP
      || process.env.RENDER_DEPLOY_ID
    )
  };
}
