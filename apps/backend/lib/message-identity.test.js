import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeEmail,
  displayNameFromIdentity,
  contactKeyFromIdentity,
  buildContactIdentity,
  messageMatchesContact
} from './message-identity.js';

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  USER@Example.COM  '), 'user@example.com');
  assert.equal(normalizeEmail(''), '');
});

test('buildContactIdentity uses primary recipient for outgoing mail', () => {
  const identity = buildContactIdentity(
    { name: 'Me', email: 'me@example.com' },
    [
      { name: 'Ali', email: 'Ali@example.com' },
      { name: 'CC', email: 'cc@example.com' }
    ],
    true
  );

  assert.deepEqual(identity, {
    contactKey: 'contact:ali@example.com',
    contactEmail: 'ali@example.com',
    contactName: 'Ali'
  });
});

test('buildContactIdentity uses sender for incoming mail', () => {
  const identity = buildContactIdentity(
    { name: 'LinkedIn', email: 'Invitations@LinkedIn.com' },
    [{ name: 'Me', email: 'me@example.com' }],
    false
  );

  assert.deepEqual(identity, {
    contactKey: 'contact:invitations@linkedin.com',
    contactEmail: 'invitations@linkedin.com',
    contactName: 'LinkedIn'
  });
});

test('contactKeyFromIdentity falls back to name label when email is missing', () => {
  assert.equal(contactKeyFromIdentity({ name: 'No Email Contact' }), 'contact-label:no email contact');
});

test('displayNameFromIdentity prefers name then email then unknown', () => {
  assert.equal(displayNameFromIdentity({ name: 'Ali', email: 'ali@example.com' }), 'Ali');
  assert.equal(displayNameFromIdentity({ email: 'ali@example.com' }), 'ali@example.com');
  assert.equal(displayNameFromIdentity({}), 'Unknown contact');
});

test('messageMatchesContact prefers canonical contactEmail and falls back to from/to data', () => {
  assert.equal(
    messageMatchesContact({ contactEmail: 'Sender@example.com' }, 'sender@example.com'),
    true
  );
  assert.equal(
    messageMatchesContact(
      {
        from: { email: 'sender@example.com' },
        to: [{ email: 'me@example.com' }]
      },
      'sender@example.com'
    ),
    true
  );
  assert.equal(
    messageMatchesContact(
      {
        from: { email: 'me@example.com' },
        to: [{ email: 'target@example.com' }]
      },
      'target@example.com'
    ),
    true
  );
  assert.equal(messageMatchesContact({}, 'missing@example.com'), false);
});
