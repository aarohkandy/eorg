export class AppError extends Error {
  constructor(code, message, status = 500, extra = {}) {
    super(message);
    this.code = code;
    this.status = status;
    this.retriable = Boolean(extra.retriable);
    this.retryAfterSec = Number.isFinite(extra.retryAfterSec) ? extra.retryAfterSec : undefined;
  }
}

const CONNECT_ERROR_DEFAULT_MESSAGE =
  'Wrong email or App Password. Enable IMAP in Gmail settings and generate a valid App Password.';

export function buildConnectFailure(code, message) {
  const normalizedCode = String(code || 'AUTH_FAILED').trim() || 'AUTH_FAILED';
  const normalizedMessage = String(message || '').trim();

  if (normalizedCode === 'AUTH_FAILED' || normalizedCode === 'NOT_CONNECTED') {
    return new AppError(
      normalizedCode,
      normalizedMessage || CONNECT_ERROR_DEFAULT_MESSAGE,
      401
    );
  }

  if (normalizedCode === 'FOLDER_NOT_FOUND') {
    return new AppError(
      normalizedCode,
      normalizedMessage || 'Required Gmail folders are not available for this account.',
      400
    );
  }

  if (normalizedCode === 'CONNECTION_FAILED') {
    return new AppError(
      normalizedCode,
      normalizedMessage || 'Cannot reach imap.gmail.com. Check network connectivity and try again.',
      503,
      { retriable: true, retryAfterSec: 60 }
    );
  }

  return new AppError(
    normalizedCode,
    normalizedMessage || 'Unable to verify Gmail connection right now.',
    503,
    { retriable: true, retryAfterSec: 60 }
  );
}

export function buildErrorResponse(error) {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        success: false,
        code: error.code,
        error: error.message,
        retriable: error.retriable || undefined,
        retryAfterSec: error.retryAfterSec
      }
    };
  }

  return {
    status: 500,
    body: {
      success: false,
      code: 'BACKEND_UNAVAILABLE',
      error: error?.message || 'Unexpected backend error'
    }
  };
}

export function parseImapError(error, folder) {
  const message = String(error?.message || 'Unknown IMAP error');
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
