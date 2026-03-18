export const DEFAULT_HEADER_FIELDS = ['references', 'in-reply-to'];
export const DEFAULT_FETCH_FIELDS = [
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

export function buildFetchQuery(fetchFields = DEFAULT_FETCH_FIELDS) {
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

export function describeFetchQuery(query) {
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

export function resolveFetchTarget(totalMessages, rangeInput, fallbackLimit = 50) {
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
