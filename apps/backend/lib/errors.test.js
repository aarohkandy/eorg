import test from 'node:test';
import assert from 'node:assert/strict';
import { AppError, buildConnectFailure } from './errors.js';

test('buildConnectFailure maps auth failures to 401', () => {
  const error = buildConnectFailure('AUTH_FAILED', 'Bad credentials');
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AUTH_FAILED');
  assert.equal(error.status, 401);
  assert.equal(error.message, 'Bad credentials');
  assert.equal(error.retriable, false);
  assert.equal(error.retryAfterSec, undefined);
});

test('buildConnectFailure maps IMAP network failures to retriable 503', () => {
  const error = buildConnectFailure('CONNECTION_FAILED', 'Cannot reach IMAP');
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'CONNECTION_FAILED');
  assert.equal(error.status, 503);
  assert.equal(error.message, 'Cannot reach IMAP');
  assert.equal(error.retriable, true);
  assert.equal(error.retryAfterSec, 60);
});

test('buildConnectFailure maps folder issues to 400', () => {
  const error = buildConnectFailure('FOLDER_NOT_FOUND', 'Sent folder missing');
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'FOLDER_NOT_FOUND');
  assert.equal(error.status, 400);
  assert.equal(error.message, 'Sent folder missing');
  assert.equal(error.retriable, false);
});

test('buildConnectFailure falls back to AUTH_FAILED defaults', () => {
  const error = buildConnectFailure(undefined, '');
  assert.ok(error instanceof AppError);
  assert.equal(error.code, 'AUTH_FAILED');
  assert.equal(error.status, 401);
  assert.match(error.message, /Wrong email or App Password/i);
});
