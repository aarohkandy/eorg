import { ImapFlow } from 'imapflow';

export const IMAP_HOST = 'imap.gmail.com';
export const IMAP_PORT = 993;

export function createRuntimeId(prefix = 'imap') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return '***';
  return `${value.slice(0, 1)}***${value.slice(at - 1)}`;
}

export function buildClient(email, appPassword) {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false
  });
}

export function readableCapabilities(client) {
  const capabilities = client?.capabilities;
  if (!capabilities) return [];

  try {
    if (typeof capabilities[Symbol.iterator] === 'function') {
      return Array.from(capabilities).map((entry) => String(entry)).sort();
    }
  } catch {
    // Ignore capability snapshot issues.
  }

  if (Array.isArray(capabilities)) {
    return capabilities.map((entry) => String(entry)).sort();
  }

  return [];
}

export function mailboxSnapshot(client, folder) {
  const mailbox = client?.mailbox && typeof client.mailbox === 'object' ? client.mailbox : {};
  return {
    folder,
    path: typeof mailbox.path === 'string' && mailbox.path ? mailbox.path : folder,
    exists: Number.isFinite(mailbox.exists) ? mailbox.exists : undefined,
    uidNext: Number.isFinite(mailbox.uidNext) ? mailbox.uidNext : undefined,
    highestModseq: mailbox.highestModseq != null ? mailbox.highestModseq : undefined
  };
}
