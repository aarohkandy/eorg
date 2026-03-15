import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import {
  IMAP_PROBE_ATTRIBUTE_SETS,
  IMAP_PROBE_RANGE_SETS,
  probeFetch,
  probeImapConnection,
  probeMailboxOpen,
  probeSearch
} from './lib/imap.js';

const TEST_EMAIL = process.env.TEST_IMAP_EMAIL || 'your-email@gmail.com';
const TEST_APP_PASSWORD = process.env.TEST_IMAP_APP_PASSWORD || 'replace-with-16-char-app-password';
const TEST_QUERY = String(process.env.TEST_IMAP_QUERY || '').trim();
const ARTIFACT_PATH = new URL('./imap-probe.log', import.meta.url);
const BASELINE_RANGE = { type: 'absolute-last', count: 5 };
const BASELINE_FIELDS = IMAP_PROBE_ATTRIBUTE_SETS[5]?.fields || ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure', 'headers'];

const summary = {
  passed: 0,
  failed: 0,
  skipped: 0,
  firstFailure: 'none',
  smallestFailingShape: 'none'
};

const lines = [];

function quote(value) {
  return JSON.stringify(String(value || ''));
}

function compactValue(value) {
  if (value == null || value === '') return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function formatRange(range) {
  return compactValue(range) || 'none';
}

function formatAttrs(attrs) {
  return compactValue(Array.isArray(attrs) ? attrs.join(',') : attrs) || 'none';
}

function buildResultLine(result) {
  const parts = [
    new Date().toISOString(),
    `probe=${result.probe}`,
    `status=${result.status}`
  ];

  if (result.mode) parts.push(`mode=${result.mode}`);
  if (result.folder) parts.push(`folder=${result.folder}`);
  if (result.fetchMode) parts.push(`fetchMode=${result.fetchMode}`);
  if (result.range) parts.push(`range=${formatRange(result.range)}`);
  if (Number.isFinite(result.requestedCount)) parts.push(`requestedCount=${result.requestedCount}`);
  if (Number.isFinite(result.resolvedStart)) parts.push(`resolvedStart=${result.resolvedStart}`);
  if (result.attrs) parts.push(`attrs=${formatAttrs(result.attrs)}`);
  if (Number.isFinite(result.count)) parts.push(`count=${result.count}`);
  if (Number.isFinite(result.matched)) parts.push(`matched=${result.matched}`);
  if (Number.isFinite(result.requested)) parts.push(`requested=${result.requested}`);
  if (Number.isFinite(result.durationMs)) parts.push(`durationMs=${result.durationMs}`);
  if (result.requestId) parts.push(`requestId=${result.requestId}`);
  if (Number.isFinite(result.mailboxInfo?.exists)) parts.push(`exists=${result.mailboxInfo.exists}`);
  if (Number.isFinite(result.mailboxInfo?.uidNext)) parts.push(`uidNext=${result.mailboxInfo.uidNext}`);
  if (result.code) parts.push(`code=${result.code}`);
  if (result.error) parts.push(`error=${quote(result.error)}`);
  if (result.raw) parts.push(`raw=${quote(result.raw)}`);
  if (result.query) parts.push(`query=${quote(result.query)}`);
  if (Array.isArray(result.capabilities) && result.capabilities.length) {
    parts.push(`caps=${quote(result.capabilities.join(','))}`);
  }

  return parts.join(' ');
}

function recordResult(result) {
  const line = buildResultLine(result);
  lines.push(line);
  console.log(line);

  if (result.status === 'PASS') summary.passed += 1;
  if (result.status === 'FAIL') summary.failed += 1;
  if (result.status === 'SKIP') summary.skipped += 1;

  if (result.status === 'FAIL' && summary.firstFailure === 'none') {
    summary.firstFailure = result.probe;
  }

  if (result.status === 'FAIL' && result.folder && result.range && result.attrs) {
    const candidate = `${result.folder}/${result.range}/${formatAttrs(result.attrs)}/${result.mode || 'single'}`;
    if (summary.smallestFailingShape === 'none') {
      summary.smallestFailingShape = candidate;
    } else {
      const currentScore = summary.smallestFailingShape.split('/')[2].split(',').length;
      const nextScore = formatAttrs(result.attrs).split(',').length;
      if (nextScore < currentScore) {
        summary.smallestFailingShape = candidate;
      }
    }
  }
}

async function recordPass(probe, mode, payload = {}) {
  recordResult({ probe, mode, status: 'PASS', ...payload });
}

async function recordFail(probe, mode, payload = {}) {
  recordResult({ probe, mode, status: 'FAIL', ...payload });
}

async function recordSkip(probe, reason) {
  recordResult({ probe, status: 'SKIP', error: reason });
}

async function runConnectionProbe() {
  const result = await probeImapConnection(TEST_EMAIL, TEST_APP_PASSWORD);
  if (result.success) {
    await recordPass('connection-only', 'single', result);
    return true;
  }
  await recordFail('connection-only', 'single', result);
  return false;
}

async function runMailboxOpenProbe(folder) {
  const result = await probeMailboxOpen(TEST_EMAIL, TEST_APP_PASSWORD, folder);
  if (result.success) {
    await recordPass(`open-${folder}`, 'single', result);
    return result;
  }
  await recordFail(`open-${folder}`, 'single', result);
  return result;
}

async function runFetchProbe(probe, folder, mode, range, fields, extra = {}) {
  const result = await probeFetch(TEST_EMAIL, TEST_APP_PASSWORD, folder, {
    range,
    fetchFields: fields,
    fetchStrategy: extra.fetchStrategy || mode,
    limit: extra.limit || 5
  });

  if (result.success) {
    await recordPass(probe, mode, result);
    return result;
  }

  await recordFail(probe, mode, result);
  return result;
}

async function runSequentialProbe() {
  const inbox = await runFetchProbe('sequential-inbox', 'INBOX', 'sequential', BASELINE_RANGE, BASELINE_FIELDS, {
    fetchStrategy: 'sequential'
  });
  const sent = await runFetchProbe('sequential-sent', '[Gmail]/Sent Mail', 'sequential', BASELINE_RANGE, BASELINE_FIELDS, {
    fetchStrategy: 'sequential'
  });
  return inbox.success && sent.success;
}

async function runParallelProbe() {
  const [inbox, sent] = await Promise.all([
    probeFetch(TEST_EMAIL, TEST_APP_PASSWORD, 'INBOX', {
      range: BASELINE_RANGE,
      fetchFields: BASELINE_FIELDS,
      fetchStrategy: 'parallel',
      limit: 5
    }),
    probeFetch(TEST_EMAIL, TEST_APP_PASSWORD, '[Gmail]/Sent Mail', {
      range: BASELINE_RANGE,
      fetchFields: BASELINE_FIELDS,
      fetchStrategy: 'parallel',
      limit: 5
    })
  ]);

  if (inbox.success) {
    await recordPass('parallel-inbox', 'parallel', inbox);
  } else {
    await recordFail('parallel-inbox', 'parallel', inbox);
  }

  if (sent.success) {
    await recordPass('parallel-sent', 'parallel', sent);
  } else {
    await recordFail('parallel-sent', 'parallel', sent);
  }

  return inbox.success && sent.success;
}

async function runAttributeMatrix(folder) {
  for (const preset of IMAP_PROBE_ATTRIBUTE_SETS) {
    await runFetchProbe(`attrs-${preset.name}`, folder, 'single', BASELINE_RANGE, preset.fields);
  }
}

async function runRangeMatrix(folder) {
  for (const rangePreset of IMAP_PROBE_RANGE_SETS) {
    await runFetchProbe(`range-${rangePreset.name}`, folder, 'single', rangePreset.target, BASELINE_FIELDS, {
      limit: rangePreset.target?.count || 50
    });
  }
}

async function runSearchProbe(folder) {
  if (!TEST_QUERY) {
    await recordSkip(`search-${folder}`, 'TEST_IMAP_QUERY is not set.');
    return;
  }

  const result = await probeSearch(TEST_EMAIL, TEST_APP_PASSWORD, folder, TEST_QUERY, {
    fetchFields: BASELINE_FIELDS,
    fetchStrategy: 'single',
    limit: 5
  });

  if (result.success) {
    await recordPass(`search-${folder}`, 'single', result);
  } else {
    await recordFail(`search-${folder}`, 'single', result);
  }
}

async function flushArtifact() {
  lines.push(`passed=${summary.passed}`);
  lines.push(`failed=${summary.failed}`);
  lines.push(`skipped=${summary.skipped}`);
  lines.push(`first_failure=${summary.firstFailure}`);
  lines.push(`smallest_failing_shape=${summary.smallestFailingShape}`);
  await writeFile(ARTIFACT_PATH, `${lines.join('\n')}\n`, 'utf8');
}

async function run() {
  if (
    TEST_EMAIL === 'your-email@gmail.com' ||
    TEST_APP_PASSWORD === 'replace-with-16-char-app-password'
  ) {
    await recordSkip('probe-matrix', 'Set TEST_IMAP_EMAIL and TEST_IMAP_APP_PASSWORD before running test-imap.js.');
    await flushArtifact();
    return;
  }

  const connectionOk = await runConnectionProbe();
  if (!connectionOk) {
    await flushArtifact();
    process.exit(1);
  }

  const inboxOpen = await runMailboxOpenProbe('INBOX');
  const sentOpen = await runMailboxOpenProbe('[Gmail]/Sent Mail');

  if (inboxOpen.success) {
    await runFetchProbe('baseline-inbox', 'INBOX', 'single', BASELINE_RANGE, BASELINE_FIELDS);
    await runAttributeMatrix('INBOX');
    await runRangeMatrix('INBOX');
    await runSearchProbe('INBOX');
  }

  if (sentOpen.success) {
    await runFetchProbe('baseline-sent', '[Gmail]/Sent Mail', 'single', BASELINE_RANGE, BASELINE_FIELDS);
    await runAttributeMatrix('[Gmail]/Sent Mail');
    await runRangeMatrix('[Gmail]/Sent Mail');
    await runSearchProbe('[Gmail]/Sent Mail');
  }

  if (inboxOpen.success && sentOpen.success) {
    await runSequentialProbe();
    await runParallelProbe();
  }

  await flushArtifact();

  if (summary.failed > 0) {
    process.exit(1);
  }
}

run().catch(async (error) => {
  await recordFail('probe-matrix', 'single', {
    error: error?.message || 'Unexpected probe runner failure.'
  });
  await flushArtifact();
  process.exit(1);
});
