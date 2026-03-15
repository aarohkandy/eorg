export class AppError extends Error {
  constructor(code, message, status = 500, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retriable = Boolean(extra.retriable);
    this.retryAfterSec = Number.isFinite(extra.retryAfterSec) ? extra.retryAfterSec : undefined;
    this.trace = Array.isArray(extra.trace) ? normalizeTraceEntries(extra.trace) : undefined;
  }
}

const CONNECT_ERROR_DEFAULT_MESSAGE =
  'Wrong email or App Password. Enable IMAP in Gmail settings and generate a valid App Password.';

function createTraceId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function sanitizeTraceDetails(details) {
  if (details == null) return undefined;

  const value = String(details)
    .replace(/\b[a-z0-9]{4}(?:\s+[a-z0-9]{4}){3}\b/gi, '[redacted app password]')
    .replace(/\s+/g, ' ')
    .trim();

  return value || undefined;
}

function normalizeTraceEntries(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const source = String(entry.source || '').trim().toUpperCase();
      const level = String(entry.level || '').trim().toLowerCase();
      const stage = String(entry.stage || '').trim();
      const message = String(entry.message || '').trim();

      if (!source || !level || !stage || !message) return null;

      return {
        id: typeof entry.id === 'string' && entry.id ? entry.id : createTraceId(),
        ts: typeof entry.ts === 'string' && entry.ts ? entry.ts : new Date().toISOString(),
        source,
        level,
        stage,
        message,
        code: typeof entry.code === 'string' && entry.code ? entry.code : undefined,
        details: sanitizeTraceDetails(entry.details)
      };
    })
    .filter(Boolean);
}

export function pushTrace(trace, source, level, stage, message, extra = {}) {
  const entry = normalizeTraceEntries([{
    source,
    level,
    stage,
    message,
    code: extra.code,
    details: extra.details
  }])[0];

  if (entry && Array.isArray(trace)) {
    trace.push(entry);
  }

  return entry || null;
}

function mergeTraces(...groups) {
  const seen = new Set();
  const merged = [];

  for (const entry of normalizeTraceEntries(groups.flat())) {
    const signature = [
      entry.ts,
      entry.source,
      entry.level,
      entry.stage,
      entry.message,
      entry.code || '',
      entry.details || ''
    ].join('|');

    if (seen.has(signature)) continue;
    seen.add(signature);
    merged.push(entry);
  }

  return merged;
}

export function buildConnectFailure(code, message, trace = []) {
  const normalizedCode = String(code || 'AUTH_FAILED').trim() || 'AUTH_FAILED';
  const normalizedMessage = String(message || '').trim();
  const mergedTrace = mergeTraces(trace);

  if (normalizedCode === 'AUTH_FAILED' || normalizedCode === 'NOT_CONNECTED') {
    return new AppError(
      normalizedCode,
      normalizedMessage || CONNECT_ERROR_DEFAULT_MESSAGE,
      401,
      { trace: mergedTrace }
    );
  }

  if (normalizedCode === 'FOLDER_NOT_FOUND') {
    return new AppError(
      normalizedCode,
      normalizedMessage || 'Required Gmail folders are not available for this account.',
      400,
      { trace: mergedTrace }
    );
  }

  if (normalizedCode === 'CONNECTION_FAILED') {
    return new AppError(
      normalizedCode,
      normalizedMessage || 'Cannot reach imap.gmail.com. Check network connectivity and try again.',
      503,
      { retriable: true, retryAfterSec: 60, trace: mergedTrace }
    );
  }

  return new AppError(
    normalizedCode,
    normalizedMessage || 'Unable to verify Gmail connection right now.',
    503,
    { retriable: true, retryAfterSec: 60, trace: mergedTrace }
  );
}

export function buildErrorResponse(error, fallbackTrace = []) {
  const trace = mergeTraces(error?.trace, fallbackTrace);

  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        success: false,
        code: error.code,
        error: error.message,
        retriable: error.retriable || undefined,
        retryAfterSec: error.retryAfterSec,
        trace: trace.length ? trace : undefined
      }
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error?.message || 'Unexpected backend error',
      trace: trace.length ? trace : undefined
    }
  };
}

export function parseImapError(error, folder) {
  const message = sanitizeTraceDetails(error?.message || 'Unknown IMAP error') || 'Unknown IMAP error';
  if (message.includes('AUTHENTICATIONFAILED')) {
    return new AppError(
      'AUTH_FAILED',
      'Wrong email or App Password. Enable IMAP in Gmail settings and generate a valid App Password.',
      401
    );
  }

  if (message.includes('Mailbox does not exist')) {
    return new AppError(
      'FOLDER_NOT_FOUND',
      `The folder "${folder}" does not exist on this Gmail account. Gmail Sent folder must be "[Gmail]/Sent Mail".`,
      400
    );
  }

  if (
    message.includes('ECONNREFUSED') ||
    message.includes('ENOTFOUND') ||
    message.includes('ETIMEDOUT')
  ) {
    return new AppError(
      'CONNECTION_FAILED',
      'Cannot reach imap.gmail.com. Check network connectivity and try again.',
      503,
      { retriable: true, retryAfterSec: 60 }
    );
  }

  return new AppError('BACKEND_UNAVAILABLE', message, 500);
}
