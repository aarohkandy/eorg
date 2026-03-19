import { deriveThreadId } from './imap.js';
import {
  buildContactIdentity,
  normalizeEmail
} from './message-identity.js';

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

function coerceText(value) {
  return typeof value === 'string' ? value : '';
}

function legacyRowFallback(row) {
  const from = {
    name: row.from_name || '',
    email: row.from_email || ''
  };
  const to = Array.isArray(row.to_addresses) ? row.to_addresses : [];
  const isOutgoing = Boolean(row.is_outgoing);
  return buildContactIdentity(from, to, isOutgoing);
}

export function mapMessageToLegacyRow(message, userId) {
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

export function normalizeImapMessage(message, folder, userEmail) {
  const from = normalizeAddress(message?.envelope?.from?.[0] || {});
  const to = Array.isArray(message?.envelope?.to)
    ? message.envelope.to.map(normalizeAddress)
    : [];

  const user = normalizeEmail(userEmail);
  const isOutgoing = from.email && user ? from.email === user : folder === 'SENT';
  const contactIdentity = buildContactIdentity(from, to, isOutgoing);

  return {
    id: `${folder}-${message.uid}`,
    uid: message.uid,
    messageId: message?.envelope?.messageId || '',
    subject: message?.envelope?.subject || '(no subject)',
    from,
    to,
    date: safeDate(message?.internalDate),
    snippet: String(message?.snippet || ''),
    bodyText: coerceText(message?.bodyText || message?.snippet || ''),
    bodyHtml: coerceText(message?.bodyHtml),
    bodyFormat: coerceText(message?.bodyFormat || (message?.bodyHtml ? 'html' : 'text')) || 'text',
    hasRemoteImages: Boolean(message?.hasRemoteImages),
    hasLinkedImages: Boolean(message?.hasLinkedImages),
    isOutgoing,
    folder,
    threadId: deriveThreadId(message),
    contactKey: contactIdentity.contactKey,
    contactEmail: contactIdentity.contactEmail,
    contactName: contactIdentity.contactName,
    flags: Array.isArray(message?.flags) ? message.flags.map((flag) => String(flag)) : [],
    debug: message?.debug || null
  };
}

export function mapRowToMessage(row) {
  const legacyIdentity = legacyRowFallback(row);
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
    bodyText: coerceText(row.body_text || row.snippet || ''),
    bodyHtml: coerceText(row.body_html),
    bodyFormat: coerceText(row.body_format || (row.body_html ? 'html' : 'text')) || 'text',
    hasRemoteImages: Boolean(row.has_remote_images),
    hasLinkedImages: Boolean(row.has_linked_images),
    isOutgoing: Boolean(row.is_outgoing),
    folder: row.folder,
    threadId: row.thread_id || row.message_id || row.id,
    contactKey: coerceText(row.contact_key) || legacyIdentity.contactKey,
    contactEmail: coerceText(row.contact_email) || legacyIdentity.contactEmail,
    contactName: coerceText(row.contact_name) || legacyIdentity.contactName,
    flags: Array.isArray(row.flags) ? row.flags : [],
    debug: null
  };
}

export function mapMessageToRow(message, userId) {
  return {
    ...mapMessageToLegacyRow(message, userId),
    contact_key: message.contactKey || '',
    contact_email: message.contactEmail || '',
    contact_name: message.contactName || '',
    body_text: message.bodyText || '',
    body_html: message.bodyHtml || '',
    body_format: message.bodyFormat || 'text',
    has_remote_images: Boolean(message.hasRemoteImages),
    has_linked_images: Boolean(message.hasLinkedImages)
  };
}
