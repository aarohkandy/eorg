import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseImapError } from './errors.js';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;

function maskEmail(email) {
  const value = String(email || '').trim();
  const at = value.indexOf('@');
  if (at <= 1) return '***';
  return `${value.slice(0, 1)}***${value.slice(at - 1)}`;
}

function buildClient(email, appPassword) {
  return new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: email, pass: appPassword },
    logger: false
  });
}

function walkParts(node, acc = []) {
  if (!node) return acc;
  if (Array.isArray(node.childNodes) && node.childNodes.length > 0) {
    node.childNodes.forEach((child) => walkParts(child, acc));
    return acc;
  }

  acc.push(node);
  return acc;
}

function selectTextPart(bodyStructure) {
  const leaves = walkParts(bodyStructure, []);
  const textPlain = leaves.find((part) =>
    String(part.type || '').toLowerCase() === 'text' &&
    String(part.subtype || '').toLowerCase() === 'plain'
  );
  if (textPlain?.part) return textPlain.part;

  const textHtml = leaves.find((part) =>
    String(part.type || '').toLowerCase() === 'text' &&
    String(part.subtype || '').toLowerCase() === 'html'
  );
  return textHtml?.part || null;
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function parseHeaderValue(headers, key) {
  if (!headers) return '';

  if (typeof headers.get === 'function') {
    const value = headers.get(key);
    if (Array.isArray(value)) return value.join(' ');
    return value ? String(value) : '';
  }

  if (typeof headers === 'object') {
    const direct = headers[key] ?? headers[key.toLowerCase()];
    if (Array.isArray(direct)) return direct.join(' ');
    return direct ? String(direct) : '';
  }

  return '';
}

function sanitizeSnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

async function extractSnippet(client, message) {
  const part = selectTextPart(message.bodyStructure);
  if (!part) return '';

  try {
    const { content } = await client.download(message.uid, part, { uid: true });
    const rawBuffer = await streamToBuffer(content);
    const parsed = await simpleParser(rawBuffer);
    return sanitizeSnippet(parsed.text || parsed.html || rawBuffer.toString('utf8'));
  } catch (error) {
    console.warn(`[IMAP] Failed to parse snippet for UID ${message.uid}: ${error.message}`);
    return '';
  }
}

async function attachSnippets(email, appPassword, folder, messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages || [];
  }

  const client = buildClient(email, appPassword);

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);

    try {
      for (const message of messages) {
        message.snippet = await extractSnippet(client, message);
      }
    } finally {
      lock.release();
    }
  } catch (error) {
    console.warn(
      `[IMAP] Failed to attach snippets in ${folder}: ${error?.message || String(error)}`
    );
    for (const message of messages) {
      message.snippet ||= '';
    }
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }

  return messages;
}

export async function fetchMessages(email, appPassword, folder, limit = 50) {
  const maskedEmail = maskEmail(email);
  console.log(`[IMAP] Connecting to ${IMAP_HOST}:${IMAP_PORT} for ${maskedEmail}`);
  const client = buildClient(email, appPassword);

  try {
    await client.connect();
    console.log(`[IMAP] Connected successfully for ${maskedEmail}`);

    const lock = await client.getMailboxLock(folder);
    console.log(`[IMAP] Opened folder: ${folder}`);
    let collected = [];

    try {
      const totalMessages = client.mailbox.exists || 0;
      console.log(`[IMAP] Found ${totalMessages} messages in ${folder}`);

      if (totalMessages === 0) {
        return [];
      }

      const range = `*:-${Math.max(1, Number(limit) || 50)}`;
      for await (const message of client.fetch(range, {
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        flags: true,
        uid: true,
        headers: ['references', 'in-reply-to']
      })) {
        collected.push({ ...message });
      }

      console.log(`[IMAP] Fetched ${collected.length} message envelopes from ${folder}`);
    } finally {
      lock.release();
    }

    return await attachSnippets(email, appPassword, folder, collected);
  } catch (error) {
    const parsed = parseImapError(error, folder);
    console.error(`[IMAP ERROR] ${parsed.code}: ${parsed.message}`);
    throw parsed;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
    console.log(`[IMAP] Connection closed for ${maskedEmail}`);
  }
}

export async function searchMessages(email, appPassword, folder, query, limit = 20) {
  const maskedEmail = maskEmail(email);
  console.log(`[IMAP] Connecting to ${IMAP_HOST}:${IMAP_PORT} for ${maskedEmail} (search)`);
  const client = buildClient(email, appPassword);

  try {
    await client.connect();
    console.log(`[IMAP] Connected successfully for ${maskedEmail}`);

    const lock = await client.getMailboxLock(folder);
    console.log(`[IMAP] Opened folder: ${folder}`);
    let messages = [];

    try {
      const matchedUids = await client.search({ body: query });
      const slice = matchedUids.slice(-Math.max(1, Number(limit) || 20));
      if (!slice.length) {
        console.log(`[IMAP] Search returned 0 messages in ${folder}`);
        return [];
      }

      for await (const message of client.fetch(slice, {
        envelope: true,
        bodyStructure: true,
        internalDate: true,
        flags: true,
        uid: true,
        headers: ['references', 'in-reply-to']
      })) {
        messages.push({ ...message });
      }

      console.log(`[IMAP] Search fetched ${messages.length} message envelopes from ${folder}`);
    } finally {
      lock.release();
    }

    return await attachSnippets(email, appPassword, folder, messages);
  } catch (error) {
    const parsed = parseImapError(error, folder);
    console.error(`[IMAP ERROR] ${parsed.code}: ${parsed.message}`);
    throw parsed;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
    console.log(`[IMAP] Connection closed for ${maskedEmail}`);
  }
}

export async function testConnection(email, appPassword) {
  const maskedEmail = maskEmail(email);
  console.log(`[IMAP] Testing connection for ${maskedEmail}`);
  const client = buildClient(email, appPassword);

  try {
    await client.connect();
    console.log(`[IMAP] Connection test PASSED for ${maskedEmail}`);
    await client.logout();
    return { success: true };
  } catch (error) {
    const parsed = parseImapError(error, '[Gmail]/Sent Mail');
    console.error(`[IMAP ERROR] ${parsed.code}: ${parsed.message}`);
    return { success: false, code: parsed.code, error: parsed.message };
  }
}

export function deriveThreadId(message) {
  const headers = message?.headers;
  const refs = parseHeaderValue(headers, 'references')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (refs.length > 0) {
    return refs[0];
  }

  const inReplyTo = parseHeaderValue(headers, 'in-reply-to').trim();
  if (inReplyTo) {
    return inReplyTo;
  }

  return message?.envelope?.messageId || `uid-${message?.uid || 'unknown'}`;
}
