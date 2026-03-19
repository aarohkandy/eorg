import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import { parseImapError, pushTrace, sanitizeTraceDetails } from './errors.js';

const IMAP_HOST = 'imap.gmail.com';
const IMAP_PORT = 993;
const DEFAULT_HEADER_FIELDS = ['references', 'in-reply-to'];
const MAX_SNIPPET_LENGTH = 4000;
const MAX_BODY_TEXT_LENGTH = 24000;
const DEFAULT_FETCH_FIELDS = [
  'uid',
  'envelope',
  'flags',
  'internalDate',
  'bodyStructure',
  'headers'
];

export const IMAP_PROBE_ATTRIBUTE_SETS = [
  { name: 'uid-only', fields: ['uid'] },
  { name: 'uid-envelope', fields: ['uid', 'envelope'] },
  { name: 'uid-envelope-flags', fields: ['uid', 'envelope', 'flags'] },
  { name: 'uid-envelope-flags-date', fields: ['uid', 'envelope', 'flags', 'internalDate'] },
  {
    name: 'uid-envelope-flags-date-structure',
    fields: ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure']
  },
  {
    name: 'uid-envelope-flags-date-structure-headers',
    fields: ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure', 'headers']
  },
  {
    name: 'uid-envelope-flags-date-structure-headers-thread',
    fields: ['uid', 'envelope', 'flags', 'internalDate', 'bodyStructure', 'headers', 'threadId']
  }
];

export const IMAP_PROBE_RANGE_SETS = [
  { name: 'all', target: '*' },
  { name: 'recent-1', target: '*:-1' },
  { name: 'recent-5', target: '*:-5' },
  { name: 'recent-50', target: '*:-50' },
  { name: 'absolute-last-1', target: { type: 'absolute-last', count: 1 } },
  { name: 'absolute-last-5', target: { type: 'absolute-last', count: 5 } },
  { name: 'absolute-last-50', target: { type: 'absolute-last', count: 50 } }
];

function createRuntimeId(prefix = 'imap') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

function stringifyDetailValue(value) {
  if (value == null) return '';

  if (Array.isArray(value)) {
    return value.map((entry) => stringifyDetailValue(entry)).filter(Boolean).join(',');
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }

  return String(value);
}

function joinDetailParts(parts = {}) {
  return Object.entries(parts)
    .map(([key, value]) => {
      const normalized = sanitizeTraceDetails(stringifyDetailValue(value));
      if (!normalized) return '';
      return `${key}=${normalized}`;
    })
    .filter(Boolean)
    .join('; ');
}

function readableCapabilities(client) {
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

function mailboxSnapshot(client, folder) {
  const mailbox = client?.mailbox && typeof client.mailbox === 'object' ? client.mailbox : {};
  return {
    folder,
    path: typeof mailbox.path === 'string' && mailbox.path ? mailbox.path : folder,
    exists: Number.isFinite(mailbox.exists) ? mailbox.exists : undefined,
    uidNext: Number.isFinite(mailbox.uidNext) ? mailbox.uidNext : undefined,
    highestModseq: mailbox.highestModseq != null ? mailbox.highestModseq : undefined
  };
}

function buildFetchQuery(fetchFields = DEFAULT_FETCH_FIELDS) {
  const query = {};
  for (const field of Array.isArray(fetchFields) ? fetchFields : DEFAULT_FETCH_FIELDS) {
    if (field === 'headers') {
      query.headers = [...DEFAULT_HEADER_FIELDS];
      continue;
    }

    if (field === 'threadId') {
      query.threadId = true;
      continue;
    }

    query[field] = true;
  }
  return query;
}

function describeFetchQuery(query) {
  const fields = [];
  if (query.uid) fields.push('uid');
  if (query.envelope) fields.push('envelope');
  if (query.flags) fields.push('flags');
  if (query.internalDate) fields.push('internalDate');
  if (query.bodyStructure) fields.push('bodyStructure');
  if (query.headers) fields.push(`headers(${query.headers.join(',')})`);
  if (query.threadId) fields.push('threadId');
  return fields.join(',');
}

function resolveFetchTarget(totalMessages, rangeInput, fallbackLimit = 50) {
  if (rangeInput && typeof rangeInput === 'object' && rangeInput.type === 'absolute-last') {
    const count = Math.max(1, Number(rangeInput.count) || Math.max(1, Number(fallbackLimit) || 50));
    const start = Math.max(1, Number(totalMessages || 0) - count + 1);
    return {
      target: `${start}:*`,
      label: `${start}:*`,
      fetchMode: 'sequence-range',
      requestedCount: count,
      resolvedStart: start
    };
  }

  if (typeof rangeInput === 'string' && rangeInput.trim()) {
    return {
      target: rangeInput,
      label: rangeInput,
      fetchMode: 'sequence-range',
      requestedCount: undefined,
      resolvedStart: undefined
    };
  }

  const count = Math.max(1, Number(fallbackLimit) || 50);
  const start = Math.max(1, Number(totalMessages || 0) - count + 1);
  return {
    target: `${start}:*`,
    label: `${start}:*`,
    fetchMode: 'sequence-range',
    requestedCount: count,
    resolvedStart: start
  };
}

function errorSnapshot(error, parsedMessage) {
  const rawMessage = sanitizeTraceDetails(error?.message);
  return {
    parsed: parsedMessage,
    errorName: error?.name,
    errorMessage: rawMessage && rawMessage !== parsedMessage ? rawMessage : undefined,
    errorCode: error?.code,
    response: error?.response,
    responseText: error?.responseText,
    serverResponseCode: error?.serverResponseCode,
    command: error?.command
  };
}

function pushImapTrace(trace, level, stage, message, details = {}, extra = {}) {
  return pushTrace(trace, 'IMAP', level, stage, message, {
    code: extra.code,
    details: joinDetailParts(details)
  });
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

function stripHtmlTags(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(head|title)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ');
}

function sanitizeText(value, maxLength = MAX_SNIPPET_LENGTH) {
  return String(value || '')
    .replace(/\r\n?/g, '\n')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, maxLength);
}

function sanitizeSnippet(value) {
  return sanitizeText(value, MAX_SNIPPET_LENGTH);
}

function sanitizeBodyText(value) {
  return sanitizeText(value, MAX_BODY_TEXT_LENGTH);
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeEmailHtml(value) {
  let html = String(value || '').trim();
  if (!html) return '';

  html = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|form|iframe|object|embed|link|meta|base)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<(script|style|form|iframe|object|embed|link|meta|base)\b[^>]*\/?>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+srcdoc\s*=\s*(['"]).*?\1/gi, '')
    .replace(/\s+srcdoc\s*=\s*[^\s>]+/gi, '');

  html = html.replace(/<(a|img)\b([^>]*)>/gi, (match, tag, attrs) => {
    let nextAttrs = attrs || '';
    nextAttrs = nextAttrs.replace(/\s+(href|src)\s*=\s*(['"])(.*?)\2/gi, (attrMatch, attrName, quote, url) => {
      const normalized = String(url || '').trim();
      const isImageData = /^data:image\//i.test(normalized);
      const allowed = /^(https?:)?\/\//i.test(normalized) || /^mailto:/i.test(normalized) || isImageData;
      if (!allowed) return '';
      return ` ${attrName.toLowerCase()}=${quote}${normalized}${quote}`;
    });
    nextAttrs = nextAttrs.replace(/\s+style\s*=\s*(['"])(.*?)\1/gi, (attrMatch, quote, styleValue) => {
      const style = String(styleValue || '');
      const lower = style.toLowerCase();
      if (
        lower.includes('display:none')
        || lower.includes('visibility:hidden')
        || lower.includes('opacity:0')
      ) {
        return '';
      }
      return ` style=${quote}${style}${quote}`;
    });

    if (tag.toLowerCase() === 'a') {
      if (!/\starget=/i.test(nextAttrs)) nextAttrs += ' target="_blank"';
      if (!/\srel=/i.test(nextAttrs)) nextAttrs += ' rel="noopener noreferrer"';
    }

    if (tag.toLowerCase() === 'img') {
      nextAttrs += ' loading="lazy"';
      nextAttrs += ' referrerpolicy="no-referrer"';
    }

    return `<${tag}${nextAttrs}>`;
  });

  html = html.replace(/<img\b([^>]*)>/gi, (match, attrs) => {
    const lower = String(attrs || '').toLowerCase();
    const widthMatch = lower.match(/\bwidth\s*=\s*['"]?(\d+)/i);
    const heightMatch = lower.match(/\bheight\s*=\s*['"]?(\d+)/i);
    const width = widthMatch ? Number(widthMatch[1]) : null;
    const height = heightMatch ? Number(heightMatch[1]) : null;
    if ((width && width <= 2) || (height && height <= 2)) return '';
    if (lower.includes('display:none') || lower.includes('visibility:hidden') || lower.includes('opacity:0')) return '';
    return `<img${attrs}>`;
  });

  return html;
}

function fallbackHtmlFromText(text) {
  const normalized = sanitizeBodyText(text);
  if (!normalized) return '';
  return normalized
    .split('\n')
    .map((line) => escapeHtml(line))
    .join('<br>');
}

function htmlSignals(html) {
  const markup = String(html || '');
  return {
    hasRemoteImages: /<img\b[^>]*\bsrc=(['"])(https?:)?\/\//i.test(markup),
    hasLinkedImages: /<a\b[^>]*href=(['"])(https?:)?\/\//i.test(markup) && /<img\b/i.test(markup)
  };
}

function normalizePartType(node) {
  return String(node?.type || '').toLowerCase();
}

function normalizePartSubtype(node) {
  return String(node?.subtype || '').toLowerCase();
}

function normalizePartDisposition(node) {
  return String(node?.disposition || '').toLowerCase();
}

function isAttachmentNode(node) {
  const disposition = normalizePartDisposition(node);
  return disposition === 'attachment' || Boolean(node?.dispositionParameters?.filename);
}

function collectStructureNodes(
  node,
  depth = 0,
  acc = [],
  ancestors = [],
  path = '1',
  isRoot = true
) {
  if (!node || typeof node !== 'object') return acc;

  const type = normalizePartType(node);
  const subtype = normalizePartSubtype(node);
  const disposition = normalizePartDisposition(node);
  const hasChildren = Array.isArray(node.childNodes) && node.childNodes.length > 0;
  const part = isRoot && type === 'multipart' && hasChildren ? null : path;

  acc.push({
    part,
    type,
    subtype,
    disposition: disposition || null,
    encoding: typeof node?.encoding === 'string' ? String(node.encoding).toLowerCase() : null,
    isAttachment: isAttachmentNode(node),
    pathDepth: depth,
    containerPath: ancestors,
    hasChildren,
    size: Number.isFinite(Number(node?.size)) ? Number(node.size) : null
  });

  if (hasChildren) {
    const nextAncestors = [...ancestors, `${type}/${subtype || '*'}`];
    node.childNodes.forEach((child, index) => {
      const childPath = isRoot && type === 'multipart'
        ? `${index + 1}`
        : `${path}.${index + 1}`;
      collectStructureNodes(child, depth + 1, acc, nextAncestors, childPath, false);
    });
  }

  return acc;
}

function structureNodeLabel(node) {
  const part = node.part || 'root';
  const type = node.type || 'unknown';
  const subtype = node.subtype ? `/${node.subtype}` : '';
  const attachment = node.isAttachment ? '[attachment]' : '';
  const disposition = node.disposition && node.disposition !== 'attachment'
    ? `[${node.disposition}]`
    : '';
  return `${'>'.repeat(node.pathDepth)}${part}:${type}${subtype}${attachment || disposition}`;
}

function buildStructureSummary(bodyStructure) {
  if (!bodyStructure) return 'none';
  return collectStructureNodes(bodyStructure)
    .map((node) => structureNodeLabel(node))
    .join(' | ')
    .slice(0, 2000);
}

function collectCandidateParts(bodyStructure) {
  return collectStructureNodes(bodyStructure)
    .filter((node) => node.part)
    .filter((node) => (
      node.type === 'text'
      || (node.type === 'message' && node.subtype === 'rfc822')
    ));
}

function selectBestCandidate(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return null;

  const score = (node) => {
    let priority = 99;
    if (node.type === 'text' && node.subtype === 'plain' && !node.isAttachment) priority = 0;
    else if (node.type === 'text' && node.subtype === 'html' && !node.isAttachment) priority = 1;
    else if (node.type === 'text' && !node.isAttachment) priority = 2;
    else if (node.type === 'message' && node.subtype === 'rfc822' && !node.isAttachment) priority = 3;
    else if (node.type === 'text' && node.subtype === 'plain') priority = 10;
    else if (node.type === 'text' && node.subtype === 'html') priority = 11;
    else if (node.type === 'text') priority = 12;
    else if (node.type === 'message' && node.subtype === 'rfc822') priority = 13;

    return [
      priority,
      node.pathDepth ?? 99,
      Number.parseInt(String(node.part || '999').split('.').join(''), 10) || 999
    ];
  };

  return [...list].sort((left, right) => {
    const leftScore = score(left);
    const rightScore = score(right);
    for (let index = 0; index < leftScore.length; index += 1) {
      if (leftScore[index] !== rightScore[index]) {
        return leftScore[index] - rightScore[index];
      }
    }
    return 0;
  })[0] || null;
}

function selectionStrategyForCandidate(candidate) {
  if (!candidate) return 'none';
  if (candidate.type === 'text' && candidate.subtype === 'plain') return 'part_text_plain';
  if (candidate.type === 'text' && candidate.subtype === 'html') return 'part_text_html';
  if (candidate.type === 'text') return 'part_text_other';
  if (candidate.type === 'message' && candidate.subtype === 'rfc822') return 'embedded_rfc822_text';
  return 'none';
}

function hasAttachmentOnlyStructure(bodyStructure, candidates = []) {
  const nodes = collectStructureNodes(bodyStructure)
    .filter((node) => node.part && !node.hasChildren);
  return Boolean(nodes.length) && !candidates.length && nodes.every((node) => node.isAttachment);
}

function defaultExtractionDebug(message, folder) {
  return {
    uid: message?.uid,
    folder,
    hasBodyStructure: Boolean(message?.bodyStructure),
    structureSummary: buildStructureSummary(message?.bodyStructure),
    candidateParts: [],
    selectedPart: null,
    selectedPartType: null,
    selectedPartSubtype: null,
    selectionStrategy: 'none',
    fallbackAttempted: false,
    fallbackStage: 'none',
    fallbackTriggerReason: 'none',
    downloadedBytes: 0,
    rawDownloadBytes: 0,
    parserSource: 'none',
    rawFallbackParserSource: 'none',
    finalContentSource: 'none',
    rawTextLength: 0,
    sanitizedLength: 0,
    finalEmptyReason: 'success',
    emptyReason: 'success'
  };
}

async function parseBufferToContent(rawBuffer, options = {}) {
  try {
    const parsed = await simpleParser(rawBuffer);
    let parsedText = '';
    let parsedHtml = '';
    let parserSource = 'none';
    let rawTextLength = 0;
    let finalContentSource = 'none';

    if (parsed.text) {
      parsedText = parsed.text;
      parserSource = 'text';
      rawTextLength = parsed.text.length;
      finalContentSource = options.mode === 'raw' ? 'raw_text' : 'part_text';
      parsedHtml = sanitizeEmailHtml(parsed.html || fallbackHtmlFromText(parsed.text));
    } else if (parsed.html) {
      parsedHtml = sanitizeEmailHtml(parsed.html || '');
      parsedText = stripHtmlTags(parsedHtml || parsed.html || '');
      parserSource = 'html';
      rawTextLength = String(parsed.html || '').length;
      finalContentSource = options.mode === 'raw' ? 'raw_html' : 'part_html';
    } else {
      parsedText = rawBuffer.toString('utf8');
      parserSource = 'raw';
      rawTextLength = parsedText.length;
      finalContentSource = options.mode === 'raw' ? 'raw_utf8' : 'part_text';
    }

    const bodyText = sanitizeBodyText(parsedText);
    const snippet = sanitizeSnippet(parsedText);
    const bodyHtml = parsedHtml || fallbackHtmlFromText(bodyText);
    const signals = htmlSignals(bodyHtml);
    return {
      success: true,
      text: bodyText,
      snippet,
      html: bodyHtml,
      parserSource,
      rawTextLength,
      sanitizedLength: bodyText.length,
      finalContentSource,
      hasRemoteImages: signals.hasRemoteImages,
      hasLinkedImages: signals.hasLinkedImages,
      bodyFormat: bodyHtml ? 'html' : 'text'
    };
  } catch (error) {
    return {
      success: false,
      error
    };
  }
}

function finalizeExtractionDebug(debug, finalEmptyReason) {
  debug.finalEmptyReason = finalEmptyReason;
  debug.emptyReason = finalEmptyReason;
  return debug;
}

function pushFinalExtractionTrace(trace, message, debug, options = {}) {
  if (!options.includeExtractionDebug) return;

  pushImapTrace(
    trace,
    debug.finalEmptyReason === 'success' ? 'success' : 'warning',
    debug.finalEmptyReason === 'success' ? 'imap_extract_success' : 'imap_extract_empty',
    debug.finalEmptyReason === 'success'
      ? `Extracted message text for UID ${message.uid}.`
      : `Message text was empty for UID ${message.uid}.`,
    {
      requestId: options.requestId,
      folder: options.folder,
      uid: message?.uid,
      selectionStrategy: debug.selectionStrategy,
      finalContentSource: debug.finalContentSource,
      finalEmptyReason: debug.finalEmptyReason,
      fallbackTriggerReason: debug.fallbackTriggerReason,
      sanitizedLength: debug.sanitizedLength
    }
  );
}

async function attemptRawMessageFallback(client, message, debug, trace = [], options = {}) {
  debug.fallbackAttempted = true;
  debug.fallbackStage = 'raw_message_parse';
  debug.selectionStrategy = 'raw_full_message';

  if (options.includeExtractionDebug) {
    pushImapTrace(trace, 'info', 'imap_raw_fallback_started', `Starting full-message fallback for UID ${message.uid}.`, {
      requestId: options.requestId,
      folder: options.folder,
      uid: message?.uid,
      fallbackTriggerReason: debug.fallbackTriggerReason
    });
  }

  let rawBuffer = null;
  try {
    const { content } = await client.download(message.uid, undefined, { uid: true });
    rawBuffer = await streamToBuffer(content);
    debug.rawDownloadBytes = rawBuffer.length;
  } catch (error) {
    finalizeExtractionDebug(debug, 'raw_download_failed');
    if (options.includeExtractionDebug) {
      pushImapTrace(trace, 'warning', 'imap_raw_fallback_failed', `Full-message fallback download failed for UID ${message.uid}.`, {
        requestId: options.requestId,
        folder: options.folder,
        uid: message?.uid,
        finalEmptyReason: debug.finalEmptyReason
      });
    }
    return { text: '', snippet: '', html: '', bodyFormat: 'text', hasRemoteImages: false, hasLinkedImages: false, debug };
  }

  const parsedResult = await parseBufferToContent(rawBuffer, { mode: 'raw' });
  if (!parsedResult.success) {
    finalizeExtractionDebug(debug, 'raw_parse_failed');
    if (options.includeExtractionDebug) {
      pushImapTrace(trace, 'warning', 'imap_raw_fallback_failed', `Full-message fallback parse failed for UID ${message.uid}.`, {
        requestId: options.requestId,
        folder: options.folder,
        uid: message?.uid,
        finalEmptyReason: debug.finalEmptyReason
      });
    }
    return { text: '', snippet: '', html: '', bodyFormat: 'text', hasRemoteImages: false, hasLinkedImages: false, debug };
  }

  debug.rawFallbackParserSource = parsedResult.parserSource;
  debug.rawTextLength = parsedResult.rawTextLength;
  debug.sanitizedLength = parsedResult.sanitizedLength;
  debug.finalContentSource = parsedResult.text ? parsedResult.finalContentSource : 'none';
  debug.parserSource = parsedResult.parserSource;

  if (parsedResult.text) {
    finalizeExtractionDebug(debug, 'success');
    if (options.includeExtractionDebug) {
      pushImapTrace(trace, 'success', 'imap_raw_fallback_success', `Full-message fallback recovered text for UID ${message.uid}.`, {
        requestId: options.requestId,
        folder: options.folder,
        uid: message?.uid,
        rawFallbackParserSource: debug.rawFallbackParserSource,
        finalContentSource: debug.finalContentSource,
        sanitizedLength: debug.sanitizedLength
      });
    }
    return {
      text: parsedResult.text,
      snippet: parsedResult.snippet,
      html: parsedResult.html,
      bodyFormat: parsedResult.bodyFormat,
      hasRemoteImages: parsedResult.hasRemoteImages,
      hasLinkedImages: parsedResult.hasLinkedImages,
      debug
    };
  }

  finalizeExtractionDebug(debug, 'raw_sanitized_empty');
  if (options.includeExtractionDebug) {
    pushImapTrace(trace, 'warning', 'imap_raw_fallback_failed', `Full-message fallback still produced empty text for UID ${message.uid}.`, {
      requestId: options.requestId,
      folder: options.folder,
      uid: message?.uid,
      rawFallbackParserSource: debug.rawFallbackParserSource,
      finalEmptyReason: debug.finalEmptyReason
    });
  }
  return { text: '', snippet: '', html: '', bodyFormat: 'text', hasRemoteImages: false, hasLinkedImages: false, debug };
}

async function extractMessageContent(client, message, trace = [], options = {}) {
  const debug = defaultExtractionDebug(message, options.folder);
  const candidateParts = collectCandidateParts(message.bodyStructure);
  const selectedNode = selectBestCandidate(candidateParts);

  debug.candidateParts = candidateParts.map((node) => ({
    part: node.part,
    type: node.type,
    subtype: node.subtype,
    disposition: node.disposition,
    encoding: node.encoding,
    isAttachment: node.isAttachment,
    pathDepth: node.pathDepth
  }));

  if (options.includeExtractionDebug) {
    pushImapTrace(trace, 'info', 'imap_structure_scanned', `Scanned MIME structure for UID ${message.uid}.`, {
      requestId: options.requestId,
      folder: options.folder,
      uid: message?.uid,
      structureSummary: debug.structureSummary,
      candidateCount: debug.candidateParts.length
    });
  }

  if (selectedNode?.part) {
    debug.selectedPart = String(selectedNode.part);
    debug.selectedPartType = selectedNode.type || null;
    debug.selectedPartSubtype = selectedNode.subtype || null;
    debug.selectionStrategy = selectionStrategyForCandidate(selectedNode);
    if (options.includeExtractionDebug) {
      pushImapTrace(trace, 'info', 'imap_part_selected', `Selected MIME part ${selectedNode.part} for UID ${message.uid}.`, {
        requestId: options.requestId,
        folder: options.folder,
        uid: message?.uid,
        selectionStrategy: debug.selectionStrategy,
        selectedPart: debug.selectedPart
      });
    }
  }

  if (!selectedNode?.part) {
    debug.fallbackTriggerReason = 'no_candidate_part';
    finalizeExtractionDebug(
      debug,
      message?.bodyStructure
        ? (hasAttachmentOnlyStructure(message.bodyStructure, candidateParts)
          ? 'attachment_only_structure'
          : 'no_candidate_part')
        : 'no_body_structure'
    );
    const fallbackResult = await attemptRawMessageFallback(client, message, debug, trace, options);
    pushFinalExtractionTrace(trace, message, fallbackResult.debug, options);
    return fallbackResult;
  }

  let partBuffer = null;
  try {
    const { content } = await client.download(message.uid, selectedNode.part, { uid: true });
    partBuffer = await streamToBuffer(content);
    debug.downloadedBytes = partBuffer.length;
  } catch (error) {
    console.warn(`[IMAP] Failed to download part ${selectedNode.part} for UID ${message.uid}: ${error.message}`);
    debug.fallbackTriggerReason = 'part_download_failed';
    finalizeExtractionDebug(debug, 'part_download_failed');
    if (options.includeExtractionDebug) {
      pushImapTrace(trace, 'warning', 'imap_part_download_failed', `Selected MIME part download failed for UID ${message.uid}.`, {
        requestId: options.requestId,
        folder: options.folder,
        uid: message?.uid,
        selectedPart: debug.selectedPart,
        finalEmptyReason: debug.finalEmptyReason
      });
    }
    const fallbackResult = await attemptRawMessageFallback(client, message, debug, trace, options);
    pushFinalExtractionTrace(trace, message, fallbackResult.debug, options);
    return fallbackResult;
  }

  const parsedResult = await parseBufferToContent(partBuffer, { mode: 'part' });
  if (!parsedResult.success) {
    debug.fallbackTriggerReason = 'part_parse_empty';
    finalizeExtractionDebug(debug, 'part_parse_failed');
    const fallbackResult = await attemptRawMessageFallback(client, message, debug, trace, options);
    pushFinalExtractionTrace(trace, message, fallbackResult.debug, options);
    return fallbackResult;
  }

  debug.parserSource = parsedResult.parserSource;
  debug.rawTextLength = parsedResult.rawTextLength;
  debug.sanitizedLength = parsedResult.sanitizedLength;

  if (parsedResult.text) {
    debug.finalContentSource = parsedResult.finalContentSource;
    finalizeExtractionDebug(debug, 'success');
    pushFinalExtractionTrace(trace, message, debug, options);
    return {
      text: parsedResult.text,
      snippet: parsedResult.snippet,
      html: parsedResult.html,
      bodyFormat: parsedResult.bodyFormat,
      hasRemoteImages: parsedResult.hasRemoteImages,
      hasLinkedImages: parsedResult.hasLinkedImages,
      debug
    };
  }

  debug.fallbackTriggerReason = 'part_parse_empty';
  finalizeExtractionDebug(debug, 'part_sanitized_empty');
  const fallbackResult = await attemptRawMessageFallback(client, message, debug, trace, options);
  pushFinalExtractionTrace(trace, message, fallbackResult.debug, options);
  return fallbackResult;
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
        const extraction = await extractMessageContent(client, message, [], { folder });
        message.snippet = extraction.snippet || extraction.text;
        message.bodyText = extraction.text || '';
        message.bodyHtml = extraction.html || '';
        message.bodyFormat = extraction.bodyFormat || (message.bodyHtml ? 'html' : 'text');
        message.hasRemoteImages = Boolean(extraction.hasRemoteImages);
        message.hasLinkedImages = Boolean(extraction.hasLinkedImages);
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
      message.bodyText ||= '';
      message.bodyHtml ||= '';
      message.bodyFormat ||= 'text';
      message.hasRemoteImages = Boolean(message.hasRemoteImages);
      message.hasLinkedImages = Boolean(message.hasLinkedImages);
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

function buildImapFailureDetails(parsed, folder, options = {}) {
  return joinDetailParts({
    requestId: options.requestId,
    folder,
    fetchStrategy: options.fetchStrategy,
    fetchMode: options.fetchMode,
    range: options.fetchTarget,
    requestedCount: options.requestedCount,
    resolvedStart: options.resolvedStart,
    attrs: options.fetchAttributes,
    mailboxExists: options.mailboxExists,
    uidNext: options.uidNext,
    highestModseq: options.highestModseq,
    capabilities: options.capabilities,
    ...errorSnapshot(options.rawError, parsed?.message)
  });
}

function logImapFailure(trace, parsed, folder, options = {}) {
  const details = buildImapFailureDetails(parsed, folder, options);

  if (parsed?.code === 'AUTH_FAILED') {
    pushTrace(trace, 'IMAP', 'error', 'imap_auth_failed', 'Gmail rejected the App Password.', {
      code: parsed.code,
      details
    });
    return;
  }

  if (parsed?.code === 'FOLDER_NOT_FOUND') {
    pushTrace(trace, 'IMAP', 'error', 'imap_folder_missing', `Required Gmail folder is missing: ${folder}.`, {
      code: parsed.code,
      details
    });
    return;
  }

  if (parsed?.code === 'CONNECTION_FAILED') {
    pushTrace(trace, 'IMAP', 'error', 'imap_connection_failed', 'Could not reach Gmail IMAP.', {
      code: parsed.code,
      details
    });
    return;
  }

  const actionLabel = options.operation === 'search'
    ? `IMAP search failed for ${folder}.`
    : (options.operation === 'fetch'
      ? `IMAP header fetch failed for ${folder}.`
      : 'IMAP request failed.');

  pushTrace(trace, 'IMAP', 'error', 'imap_failed', actionLabel, {
    code: parsed?.code || 'BACKEND_UNAVAILABLE',
    details
  });
}

function summarizeProbeError(error, folder, extra = {}) {
  const parsed = parseImapError(error, folder);
  return {
    success: false,
    code: parsed.code,
    error: parsed.message,
    raw: joinDetailParts(errorSnapshot(error, parsed.message)),
    ...extra
  };
}

export async function fetchMessages(email, appPassword, folder, limit = 50, trace = [], options = {}) {
  const maskedEmail = maskEmail(email);
  const requestId = String(options.requestId || createRuntimeId('fetch')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  let capabilities = [];
  let mailboxInfo = {};
  let fetchTarget = null;

  console.log(`[IMAP] requestId=${requestId} connecting to ${IMAP_HOST}:${IMAP_PORT} for ${maskedEmail}`);
  pushImapTrace(trace, 'info', 'imap_connecting', `Connecting to Gmail for ${folder}.`, {
    requestId,
    fetchStrategy
  });

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    console.log(`[IMAP] requestId=${requestId} connected for ${maskedEmail}`);
    pushImapTrace(trace, 'success', 'imap_connected', `Connected to Gmail for ${folder}.`, {
      requestId,
      fetchStrategy,
      capabilities
    });

    const lock = await client.getMailboxLock(folder);
    mailboxInfo = mailboxSnapshot(client, folder);
    console.log(`[IMAP] requestId=${requestId} opened folder ${folder}`);
    pushImapTrace(trace, 'info', 'imap_mailbox_opened', `Opened Gmail folder ${folder}.`, {
      requestId,
      fetchStrategy,
      path: mailboxInfo.path,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq
    });

    let collected = [];

    try {
      const totalMessages = mailboxInfo.exists || 0;
      console.log(`[IMAP] requestId=${requestId} found ${totalMessages} messages in ${folder}`);
      pushImapTrace(trace, 'info', 'imap_fetch_started', `Fetching recent message headers from ${folder}.`, {
        requestId,
        fetchStrategy,
        mailboxExists: totalMessages,
        uidNext: mailboxInfo.uidNext,
        highestModseq: mailboxInfo.highestModseq
      });

      if (totalMessages === 0) {
        pushImapTrace(trace, 'success', 'imap_fetch_complete', `No messages found in ${folder}.`, {
          requestId,
          fetchStrategy
        });
        return [];
      }

      fetchTarget = resolveFetchTarget(totalMessages, options.range, limit);
      console.log(
        `[IMAP] requestId=${requestId} fetch folder=${folder} mode=${fetchTarget.fetchMode} range=${fetchTarget.label} requestedCount=${fetchTarget.requestedCount || 'n/a'} resolvedStart=${fetchTarget.resolvedStart || 'n/a'} attrs=${fetchAttributes} strategy=${fetchStrategy}`
      );
      pushImapTrace(trace, 'info', 'imap_fetch_command', `Requesting header batch from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        requestedCount: fetchTarget.requestedCount,
        resolvedStart: fetchTarget.resolvedStart,
        attrs: fetchAttributes,
        mailboxExists: mailboxInfo.exists,
        uidNext: mailboxInfo.uidNext,
        highestModseq: mailboxInfo.highestModseq
      });

      for await (const message of client.fetch(fetchTarget.target, fetchQuery)) {
        collected.push({ ...message, snippet: '' });
      }

      for (const message of collected) {
        const extraction = await extractMessageContent(client, message, trace, {
          folder,
          requestId,
          includeExtractionDebug: Boolean(options.includeExtractionDebug)
        });
        message.snippet = extraction.snippet || extraction.text;
        message.bodyText = extraction.text || '';
        message.bodyHtml = extraction.html || '';
        message.bodyFormat = extraction.bodyFormat || (message.bodyHtml ? 'html' : 'text');
        message.hasRemoteImages = Boolean(extraction.hasRemoteImages);
        message.hasLinkedImages = Boolean(extraction.hasLinkedImages);
        if (options.includeExtractionDebug) {
          message.debug = extraction.debug;
        }
      }

      console.log(`[IMAP] requestId=${requestId} fetched ${collected.length} message envelopes from ${folder}`);
      pushImapTrace(trace, 'success', 'imap_fetch_complete', `Fetched ${collected.length} recent messages from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        requestedCount: fetchTarget.requestedCount,
        resolvedStart: fetchTarget.resolvedStart,
        attrs: fetchAttributes,
        count: collected.length
      });
    } finally {
      lock.release();
    }

    return collected;
  } catch (error) {
    const parsed = parseImapError(error, folder);
    console.error(`[IMAP ERROR] requestId=${requestId} ${parsed.code}: ${parsed.message}`);
    logImapFailure(trace, parsed, folder, {
      operation: 'fetch',
      requestId,
      fetchStrategy,
      fetchMode: fetchTarget?.fetchMode,
      fetchTarget: fetchTarget?.label,
      requestedCount: fetchTarget?.requestedCount,
      resolvedStart: fetchTarget?.resolvedStart,
      fetchAttributes,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq,
      capabilities,
      rawError: error
    });
    throw parsed;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
    console.log(`[IMAP] requestId=${requestId} connection closed for ${maskedEmail}`);
  }
}

export async function searchMessages(email, appPassword, folder, query, limit = 20, trace = [], options = {}) {
  const maskedEmail = maskEmail(email);
  const requestId = String(options.requestId || createRuntimeId('search')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  let capabilities = [];
  let mailboxInfo = {};
  let fetchTarget = null;

  console.log(`[IMAP] requestId=${requestId} connecting to ${IMAP_HOST}:${IMAP_PORT} for ${maskedEmail} (search)`);
  pushImapTrace(trace, 'info', 'imap_connecting', `Connecting to Gmail for search in ${folder}.`, {
    requestId,
    fetchStrategy
  });

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    console.log(`[IMAP] requestId=${requestId} connected for ${maskedEmail} (search)`);
    pushImapTrace(trace, 'success', 'imap_connected', `Connected to Gmail for search in ${folder}.`, {
      requestId,
      fetchStrategy,
      capabilities
    });

    const lock = await client.getMailboxLock(folder);
    mailboxInfo = mailboxSnapshot(client, folder);
    console.log(`[IMAP] requestId=${requestId} opened folder ${folder} (search)`);
    pushImapTrace(trace, 'info', 'imap_mailbox_opened', `Opened Gmail folder ${folder}.`, {
      requestId,
      fetchStrategy,
      path: mailboxInfo.path,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq
    });

    let messages = [];

    try {
      const matchedUids = await client.search({ body: query });
      const slice = matchedUids.slice(-Math.max(1, Number(limit) || 20));
      pushImapTrace(trace, 'info', 'imap_search_started', `Searching ${folder} for matching messages.`, {
        requestId,
        fetchStrategy,
        queryLength: String(query || '').trim().length,
        matched: matchedUids.length,
        requested: slice.length
      });
      if (!slice.length) {
        console.log(`[IMAP] requestId=${requestId} search returned 0 messages in ${folder}`);
        pushImapTrace(trace, 'success', 'imap_search_complete', `No search results in ${folder}.`, {
          requestId,
          fetchStrategy
        });
        return [];
      }

      fetchTarget = {
        target: slice,
        label: `uids(${slice.length})`,
        fetchMode: 'uid-list'
      };
      console.log(
        `[IMAP] requestId=${requestId} search fetch folder=${folder} mode=${fetchTarget.fetchMode} attrs=${fetchAttributes} strategy=${fetchStrategy} matched=${slice.length}`
      );
      pushImapTrace(trace, 'info', 'imap_search_fetch_command', `Requesting search result headers from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        attrs: fetchAttributes,
        requested: slice.length,
        mailboxExists: mailboxInfo.exists,
        uidNext: mailboxInfo.uidNext
      });

      for await (const message of client.fetch(slice, fetchQuery)) {
        messages.push({ ...message });
      }

      console.log(`[IMAP] requestId=${requestId} search fetched ${messages.length} message envelopes from ${folder}`);
      pushImapTrace(trace, 'success', 'imap_search_complete', `Search fetched ${messages.length} messages from ${folder}.`, {
        requestId,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        attrs: fetchAttributes,
        count: messages.length
      });
    } finally {
      lock.release();
    }

    return await attachSnippets(email, appPassword, folder, messages);
  } catch (error) {
    const parsed = parseImapError(error, folder);
    console.error(`[IMAP ERROR] requestId=${requestId} ${parsed.code}: ${parsed.message}`);
    logImapFailure(trace, parsed, folder, {
      operation: 'search',
      requestId,
      fetchStrategy,
      fetchMode: fetchTarget?.fetchMode,
      fetchTarget: fetchTarget?.label,
      fetchAttributes,
      mailboxExists: mailboxInfo.exists,
      uidNext: mailboxInfo.uidNext,
      highestModseq: mailboxInfo.highestModseq,
      capabilities,
      rawError: error
    });
    throw parsed;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
    console.log(`[IMAP] requestId=${requestId} connection closed for ${maskedEmail}`);
  }
}

export async function testConnection(email, appPassword, trace = [], options = {}) {
  const maskedEmail = maskEmail(email);
  const requestId = String(options.requestId || createRuntimeId('connect')).trim();
  const client = buildClient(email, appPassword);
  let capabilities = [];
  pushImapTrace(trace, 'info', 'imap_connecting', 'Connecting to Gmail to verify credentials.', {
    requestId
  });

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    console.log(`[IMAP] requestId=${requestId} connection test passed for ${maskedEmail}`);
    pushImapTrace(trace, 'success', 'imap_connected', 'Connected to Gmail successfully.', {
      requestId,
      capabilities
    });
    pushImapTrace(trace, 'success', 'imap_auth_verified', 'Gmail accepted the App Password.', {
      requestId
    });
    await client.logout();
    return { success: true, trace };
  } catch (error) {
    const parsed = parseImapError(error, '[Gmail]/Sent Mail');
    console.error(`[IMAP ERROR] requestId=${requestId} ${parsed.code}: ${parsed.message}`);
    logImapFailure(trace, parsed, '[Gmail]/Sent Mail', {
      operation: 'connect',
      requestId,
      capabilities,
      rawError: error
    });
    return { success: false, code: parsed.code, error: parsed.message, trace };
  }
}

export async function probeImapConnection(email, appPassword, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-connect')).trim();
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();

  try {
    await client.connect();
    return {
      success: true,
      requestId,
      durationMs: Date.now() - startedAt,
      capabilities: readableCapabilities(client)
    };
  } catch (error) {
    return summarizeProbeError(error, 'INBOX', {
      requestId,
      durationMs: Date.now() - startedAt
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function probeMailboxOpen(email, appPassword, folder, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-open')).trim();
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();

  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const mailboxInfo = mailboxSnapshot(client, folder);
      return {
        success: true,
        requestId,
        folder,
        durationMs: Date.now() - startedAt,
        capabilities: readableCapabilities(client),
        mailboxInfo
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    return summarizeProbeError(error, folder, {
      requestId,
      folder,
      durationMs: Date.now() - startedAt
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function probeFetch(email, appPassword, folder, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-fetch')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();
  let capabilities = [];
  let mailboxInfo = {};
  let fetchTarget = null;
  let count = 0;

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    const lock = await client.getMailboxLock(folder);
    try {
      mailboxInfo = mailboxSnapshot(client, folder);
      fetchTarget = resolveFetchTarget(mailboxInfo.exists || 0, options.range, options.limit || 5);

      for await (const _message of client.fetch(fetchTarget.target, fetchQuery)) {
        count += 1;
      }

      return {
        success: true,
        requestId,
        folder,
        fetchStrategy,
        fetchMode: fetchTarget.fetchMode,
        range: fetchTarget.label,
        requestedCount: fetchTarget.requestedCount,
        resolvedStart: fetchTarget.resolvedStart,
        attrs: fetchAttributes,
        count,
        durationMs: Date.now() - startedAt,
        capabilities,
        mailboxInfo
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    const failure = summarizeProbeError(error, folder, {
      requestId,
      folder,
      fetchStrategy,
      fetchMode: fetchTarget?.fetchMode,
      range: fetchTarget?.label,
      requestedCount: fetchTarget?.requestedCount,
      resolvedStart: fetchTarget?.resolvedStart,
      attrs: fetchAttributes,
      durationMs: Date.now() - startedAt,
      capabilities,
      mailboxInfo
    });
    return failure;
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
  }
}

export async function probeSearch(email, appPassword, folder, query, options = {}) {
  const requestId = String(options.requestId || createRuntimeId('probe-search')).trim();
  const fetchStrategy = String(options.fetchStrategy || 'single').trim();
  const fetchQuery = buildFetchQuery(options.fetchFields || DEFAULT_FETCH_FIELDS);
  const fetchAttributes = describeFetchQuery(fetchQuery);
  const client = buildClient(email, appPassword);
  const startedAt = Date.now();
  let capabilities = [];
  let mailboxInfo = {};
  let matched = 0;
  let requested = 0;
  let count = 0;

  try {
    await client.connect();
    capabilities = readableCapabilities(client);
    const lock = await client.getMailboxLock(folder);
    try {
      mailboxInfo = mailboxSnapshot(client, folder);
      const matchedUids = await client.search({ body: query });
      matched = matchedUids.length;
      const limit = Math.max(1, Number(options.limit) || 5);
      const slice = matchedUids.slice(-limit);
      requested = slice.length;

      for await (const _message of client.fetch(slice, fetchQuery)) {
        count += 1;
      }

      return {
        success: true,
        requestId,
        folder,
        fetchStrategy,
        fetchMode: 'uid-list',
        range: `uids(${requested})`,
        attrs: fetchAttributes,
        matched,
        requested,
        count,
        query,
        durationMs: Date.now() - startedAt,
        capabilities,
        mailboxInfo
      };
    } finally {
      lock.release();
    }
  } catch (error) {
    return summarizeProbeError(error, folder, {
      requestId,
      folder,
      fetchStrategy,
      fetchMode: 'uid-list',
      range: `uids(${requested})`,
      attrs: fetchAttributes,
      matched,
      requested,
      query,
      durationMs: Date.now() - startedAt,
      capabilities,
      mailboxInfo
    });
  } finally {
    try {
      if (client.usable) {
        await client.logout();
      }
    } catch {
      // Ignore logout errors.
    }
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
