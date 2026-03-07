import 'dotenv/config';
import { fetchMessages } from './lib/imap.js';
import { normalizeImapMessage } from './lib/message-normalize.js';

const TEST_EMAIL = process.env.TEST_IMAP_EMAIL || 'your-email@gmail.com';
const TEST_APP_PASSWORD = process.env.TEST_IMAP_APP_PASSWORD || 'replace-with-16-char-app-password';

async function run() {
  if (
    TEST_EMAIL === 'your-email@gmail.com' ||
    TEST_APP_PASSWORD === 'replace-with-16-char-app-password'
  ) {
    console.error(
      '[IMAP TEST] Set TEST_IMAP_EMAIL and TEST_IMAP_APP_PASSWORD in your environment before running test-imap.js.'
    );
    process.exit(1);
  }

  console.log(`[IMAP TEST] Starting IMAP proof-of-concept for ${TEST_EMAIL}`);

  const [inboxRaw, sentRaw] = await Promise.all([
    fetchMessages(TEST_EMAIL, TEST_APP_PASSWORD, 'INBOX', 5),
    fetchMessages(TEST_EMAIL, TEST_APP_PASSWORD, '[Gmail]/Sent Mail', 5)
  ]);

  const inbox = inboxRaw.map((message) => normalizeImapMessage(message, 'INBOX', TEST_EMAIL));
  const sent = sentRaw.map((message) => normalizeImapMessage(message, 'SENT', TEST_EMAIL));

  console.log('[IMAP TEST] Last 5 INBOX messages');
  inbox.forEach((message, index) => {
    console.log(
      `${index + 1}. subject="${message.subject}" from="${message.from.email}" date="${message.date}" isOutgoing=${message.isOutgoing}`
    );
  });

  console.log('[IMAP TEST] Last 5 SENT messages');
  sent.forEach((message, index) => {
    console.log(
      `${index + 1}. subject="${message.subject}" from="${message.from.email}" date="${message.date}" isOutgoing=${message.isOutgoing}`
    );
  });

  console.log('[IMAP TEST] Proof-of-concept completed successfully');
}

run().catch((error) => {
  console.error(`[IMAP TEST ERROR] ${error.message}`);
  process.exit(1);
});
