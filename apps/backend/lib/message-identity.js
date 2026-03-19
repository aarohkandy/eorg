export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

export function displayNameFromIdentity(identity) {
  const name = String(identity?.name || '').trim();
  const email = normalizeEmail(identity?.email);
  return name || email || 'Unknown contact';
}

export function contactKeyFromIdentity(identity) {
  const email = normalizeEmail(identity?.email);
  if (email) return `contact:${email}`;

  const label = String(identity?.name || '').trim().toLowerCase();
  if (label) return `contact-label:${label}`;

  return '';
}

export function buildContactIdentity(from, to, isOutgoing) {
  if (isOutgoing) {
    const primaryRecipient = Array.isArray(to) ? to[0] : null;
    const email = normalizeEmail(primaryRecipient?.email);
    const name = String(primaryRecipient?.name || '').trim();
    return {
      contactKey: contactKeyFromIdentity({ email, name }),
      contactEmail: email,
      contactName: name || email || 'Unknown contact'
    };
  }

  const email = normalizeEmail(from?.email);
  const name = String(from?.name || '').trim();
  return {
    contactKey: contactKeyFromIdentity({ email, name }),
    contactEmail: email,
    contactName: name || email || 'Unknown contact'
  };
}

export function messageMatchesContact(message, contactEmail) {
  const target = normalizeEmail(contactEmail);
  if (!target) return false;

  const canonical = normalizeEmail(message?.contactEmail);
  if (canonical) return canonical === target;

  const fromEmail = normalizeEmail(message?.from?.email);
  const toEmails = Array.isArray(message?.to)
    ? message.to.map((entry) => normalizeEmail(entry?.email)).filter(Boolean)
    : [];

  return fromEmail === target || toEmails.includes(target);
}
