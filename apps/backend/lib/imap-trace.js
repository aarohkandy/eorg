import { parseImapError, pushTrace, sanitizeTraceDetails } from './errors.js';

function stringifyDetailValue(value) {
  if (value == null) return '';

  if (Array.isArray(value)) {
    return value.map((entry) => stringifyDetailValue(entry)).filter(Boolean).join(',');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

export function joinDetailParts(parts = {}) {
  return Object.entries(parts)
    .map(([key, value]) => {
      const normalized = sanitizeTraceDetails(stringifyDetailValue(value));
      if (!normalized) return '';
      return `${key}=${normalized}`;
    })
    .filter(Boolean)
    .join('; ');
}

function errorSnapshot(error, parsedMessage) {
  const rawMessage = sanitizeTraceDetails(error?.message);
  return {
    parsed: parsedMessage,
    errorName: error?.name,
    errorMessage: rawMessage && rawMessage !== parsedMessage ? rawMessage : undefined,
    errorCode: error?.code,
    response: error?.response,
    responseText: error?.responseText,
    serverResponseCode: error?.serverResponseCode,
    command: error?.command
  };
}

export function pushImapTrace(trace, level, stage, message, details = {}, extra = {}) {
  return pushTrace(trace, 'IMAP', level, stage, message, {
    code: extra.code,
    details: joinDetailParts(details)
  });
}

export function buildImapFailureDetails(parsed, folder, options = {}) {
  return joinDetailParts({
    requestId: options.requestId,
    folder,
    fetchStrategy: options.fetchStrategy,
    fetchMode: options.fetchMode,
    range: options.fetchTarget,
    requestedCount: options.requestedCount,
    resolvedStart: options.resolvedStart,
    attrs: options.fetchAttributes,
    mailboxExists: options.mailboxExists,
    uidNext: options.uidNext,
    highestModseq: options.highestModseq,
    capabilities: options.capabilities,
    ...errorSnapshot(options.rawError, parsed?.message)
  });
}

export function logImapFailure(trace, parsed, folder, options = {}) {
  const details = buildImapFailureDetails(parsed, folder, options);

  if (parsed?.code === 'AUTH_FAILED') {
    pushTrace(trace, 'IMAP', 'error', 'imap_auth_failed', 'Gmail rejected the App Password.', {
      code: parsed.code,
      details
    });
    return;
  }

  if (parsed?.code === 'FOLDER_NOT_FOUND') {
    pushTrace(trace, 'IMAP', 'error', 'imap_folder_missing', `Required Gmail folder is missing: ${folder}.`, {
      code: parsed.code,
      details
    });
    return;
  }

  if (parsed?.code === 'CONNECTION_FAILED') {
    pushTrace(trace, 'IMAP', 'error', 'imap_connection_failed', 'Could not reach Gmail IMAP.', {
      code: parsed.code,
      details
    });
    return;
  }

  const actionLabel = options.operation === 'search'
    ? `IMAP search failed for ${folder}.`
    : (options.operation === 'fetch'
      ? `IMAP header fetch failed for ${folder}.`
      : 'IMAP request failed.');

  pushTrace(trace, 'IMAP', 'error', 'imap_failed', actionLabel, {
    code: parsed?.code || 'BACKEND_UNAVAILABLE',
    details
  });
}

export function summarizeProbeError(error, folder, extra = {}) {
  const parsed = parseImapError(error, folder);
  return {
    success: false,
    code: parsed.code,
    error: parsed.message,
    raw: joinDetailParts(errorSnapshot(error, parsed.message)),
    ...extra
  };
}
