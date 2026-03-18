import { simpleParser } from 'mailparser';
import { buildClient } from './imap-client.js';

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

function sanitizeSnippet(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

export async function extractSnippet(client, message) {
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

export async function attachSnippets(email, appPassword, folder, messages) {
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
