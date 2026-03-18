import { decrypt } from '../lib/crypto.js';
import { fetchMessages } from '../lib/imap.js';
import { normalizeImapMessage } from '../lib/message-normalize.js';
import { IMAP_FOLDERS, dedupeById, sortByDateDesc } from './messages-params.js';

export async function fetchFromImap(user, requestedFolders, limit, trace = [], options = {}) {
  const password = decrypt(user.encrypted_password);
  const requestId = String(options.requestId || '').trim();
  const fetchStrategy = String(options.fetchStrategy || (requestedFolders.length > 1 ? 'parallel' : 'single')).trim();

  const taskFactory = (folder) => async () => {
    const imapFolder = IMAP_FOLDERS[folder];
    const rawMessages = await fetchMessages(user.email, password, imapFolder, limit, trace, {
      requestId: requestId ? `${requestId}-${folder.toLowerCase()}` : undefined,
      fetchStrategy
    });
    return rawMessages.map((message) => normalizeImapMessage(message, folder, user.email));
  };

  const tasks = requestedFolders.map((folder) => taskFactory(folder));
  const results = fetchStrategy === 'sequential'
    ? await tasks.reduce(async (accPromise, task) => {
      const acc = await accPromise;
      const next = await task();
      acc.push(next);
      return acc;
    }, Promise.resolve([]))
    : await Promise.all(tasks.map((task) => task()));
  return sortByDateDesc(dedupeById(results.flat()));
}
