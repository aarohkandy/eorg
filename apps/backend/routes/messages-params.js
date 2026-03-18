import { pushTrace } from '../lib/errors.js';

export const IMAP_FOLDERS = {
  INBOX: 'INBOX',
  SENT: '[Gmail]/Sent Mail'
};

export function createRequestId(prefix = 'messages') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function appendDetails(existing, extra = {}) {
  const base = String(existing || '').trim();
  const additions = Object.entries(extra)
    .map(([key, value]) => {
      if (value == null || value === '') return '';
      return `${key}=${value}`;
    })
    .filter(Boolean)
    .join('; ');

  return [base, additions].filter(Boolean).join('; ');
}

export function pushDbTrace(trace, level, stage, message, extra = {}) {
  return pushTrace(trace, 'DB', level, stage, message, extra);
}

export function hasSpecificFailure(trace) {
  return Array.isArray(trace) && trace.some((entry) =>
    entry &&
    entry.level === 'error' &&
    (entry.source === 'DB' || entry.source === 'IMAP')
  );
}

export function parseFolder(folder) {
  const value = String(folder || 'all').toLowerCase();
  if (value === 'inbox') return 'inbox';
  if (value === 'sent') return 'sent';
  return 'all';
}

export function parseLimit(raw, fallback) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), 200);
}

export function parseBoolean(value) {
  return String(value || '').toLowerCase() === 'true';
}

export function getRequestedFolders(folder) {
  if (folder === 'inbox') return ['INBOX'];
  if (folder === 'sent') return ['SENT'];
  return ['INBOX', 'SENT'];
}

export function sortByDateDesc(messages) {
  return [...messages].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}

export function dedupeById(messages) {
  const byId = new Map();
  messages.forEach((message) => {
    byId.set(message.id, message);
  });
  return [...byId.values()];
}

export function buildCounts(messages) {
  const inboxCount = messages.filter((message) => message.folder === 'INBOX').length;
  const sentCount = messages.filter((message) => message.folder === 'SENT').length;
  return { inboxCount, sentCount };
}
