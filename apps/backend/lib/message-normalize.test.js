import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeImapMessage,
  mapRowToMessage,
  mapMessageToRow,
  mapMessageToLegacyRow
} from './message-normalize.js';

test('normalizeImapMessage populates canonical contact fields and rich body fields', () => {
  const message = normalizeImapMessage(
    {
      uid: 42,
      internalDate: '2026-03-18T00:00:00.000Z',
      envelope: {
        messageId: '<msg-42@example.com>',
        subject: 'Hello there',
        from: [{ name: 'Me', address: 'me@example.com' }],
        to: [{ name: 'Ali', address: 'ali@example.com' }]
      },
      snippet: 'preview',
      bodyText: 'Hello Ali',
      bodyHtml: '<p>Hello <strong>Ali</strong></p>',
      bodyFormat: 'html',
      hasRemoteImages: true,
      hasLinkedImages: true,
      flags: ['\\Seen']
    },
    'SENT',
    'me@example.com'
  );

  assert.equal(message.contactKey, 'contact:ali@example.com');
  assert.equal(message.contactEmail, 'ali@example.com');
  assert.equal(message.contactName, 'Ali');
  assert.equal(message.bodyText, 'Hello Ali');
  assert.equal(message.bodyHtml, '<p>Hello <strong>Ali</strong></p>');
  assert.equal(message.bodyFormat, 'html');
  assert.equal(message.hasRemoteImages, true);
  assert.equal(message.hasLinkedImages, true);
  assert.equal(message.threadId, '<msg-42@example.com>');
});

test('mapRowToMessage falls back to legacy identity fields when canonical columns are absent', () => {
  const message = mapRowToMessage({
    id: 'INBOX-1',
    uid: 1,
    message_id: '<msg-1@example.com>',
    subject: 'Security alert',
    from_name: 'Google',
    from_email: 'no-reply@accounts.google.com',
    to_addresses: [{ name: 'Me', email: 'me@example.com' }],
    date: '2026-03-18T00:00:00.000Z',
    snippet: 'Preview text',
    is_outgoing: false,
    folder: 'INBOX',
    thread_id: '<msg-1@example.com>',
    flags: ['\\Seen']
  });

  assert.equal(message.contactKey, 'contact:no-reply@accounts.google.com');
  assert.equal(message.contactEmail, 'no-reply@accounts.google.com');
  assert.equal(message.contactName, 'Google');
  assert.equal(message.bodyText, 'Preview text');
  assert.equal(message.bodyHtml, '');
  assert.equal(message.bodyFormat, 'text');
});

test('mapMessageToRow and mapMessageToLegacyRow preserve 1.5.0 rich-body data and legacy compatibility', () => {
  const message = {
    id: 'SENT-2',
    uid: 2,
    messageId: '<msg-2@example.com>',
    subject: 'Follow up',
    from: { name: 'Me', email: 'me@example.com' },
    to: [{ name: 'Ali', email: 'ali@example.com' }],
    date: '2026-03-18T00:00:00.000Z',
    snippet: 'Follow up preview',
    bodyText: 'Follow up text',
    bodyHtml: '<p>Follow up text</p>',
    bodyFormat: 'html',
    hasRemoteImages: false,
    hasLinkedImages: false,
    isOutgoing: true,
    folder: 'SENT',
    threadId: '<msg-2@example.com>',
    contactKey: 'contact:ali@example.com',
    contactEmail: 'ali@example.com',
    contactName: 'Ali',
    flags: ['\\Seen']
  };

  const richRow = mapMessageToRow(message, 'user-123');
  const legacyRow = mapMessageToLegacyRow(message, 'user-123');

  assert.equal(richRow.contact_key, 'contact:ali@example.com');
  assert.equal(richRow.contact_email, 'ali@example.com');
  assert.equal(richRow.contact_name, 'Ali');
  assert.equal(richRow.body_text, 'Follow up text');
  assert.equal(richRow.body_html, '<p>Follow up text</p>');
  assert.equal(richRow.body_format, 'html');
  assert.equal(richRow.user_id, 'user-123');

  assert.equal(legacyRow.body_text, undefined);
  assert.equal(legacyRow.contact_key, undefined);
  assert.equal(legacyRow.snippet, 'Follow up preview');
});
