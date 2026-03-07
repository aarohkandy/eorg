import { deriveThreadId } from './imap.js';

function normalizeAddress(address) {
  return {
    name: address?.name || '',
    email: String(address?.address || '').toLowerCase()
  };
}

function safeDate(value) {
  if (!value) return new Date(0).toISOString();
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date(0).toISOString();
  return date.toISOString();
}

export function normalizeImapMessage(message, folder, userEmail) {
  const from = normalizeAddress(message?.envelope?.from?.[0] || {});
  const to = Array.isArray(message?.envelope?.to)
    ? message.envelope.to.map(normalizeAddress)
    : [];

  const user = String(userEmail || '').toLowerCase();
  const isOutgoing = from.email && user ? from.email === user : folder === 'SENT';

  return {
    id: `${folder}-${message.uid}`,
    uid: message.uid,
    messageId: message?.envelope?.messageId || '',
    subject: message?.envelope?.subject || '(no subject)',
    from,
    to,
    date: safeDate(message?.internalDate),
    snippet: String(message?.snippet || '').slice(0, 200),
    isOutgoing,
    folder,
    threadId: deriveThreadId(message),
    flags: Array.isArray(message?.flags) ? message.flags.map((flag) => String(flag)) : []
  };
}

export function mapRowToMessage(row) {
  return {
    id: row.id,
    uid: row.uid,
    messageId: row.message_id,
    subject: row.subject,
    from: {
      name: row.from_name || '',
      email: row.from_email || ''
    },
    to: Array.isArray(row.to_addresses) ? row.to_addresses : [],
    date: new Date(row.date).toISOString(),
    snippet: row.snippet || '',
    isOutgoing: Boolean(row.is_outgoing),
    folder: row.folder,
    threadId: row.thread_id || row.message_id || row.id,
    flags: Array.isArray(row.flags) ? row.flags : []
  };
}

export function mapMessageToRow(message, userId) {
  return {
    id: message.id,
    user_id: userId,
    uid: message.uid,
    message_id: message.messageId,
    subject: message.subject,
    from_name: message.from.name,
    from_email: message.from.email,
    to_addresses: message.to,
    date: message.date,
    snippet: message.snippet,
    is_outgoing: message.isOutgoing,
    folder: message.folder,
    thread_id: message.threadId,
    flags: message.flags,
    cached_at: new Date().toISOString()
  };
}
