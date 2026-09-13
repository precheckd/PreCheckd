const BLOCKED_EMAIL_DOMAINS = [
  'gmail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'msn.com',
  'protonmail.com',
  'proton.me',
  'mail.com',
  'gmx.com',
  'yandex.com',
  'zoho.com',
  'inbox.com'
];

function isBlockedEmailDomain(email) {
  if (!email || typeof email !== 'string') return false;
  const domain = email.split('@')[1];
  if (!domain) return false;
  return BLOCKED_EMAIL_DOMAINS.includes(domain.trim().toLowerCase());
}

module.exports = { BLOCKED_EMAIL_DOMAINS, isBlockedEmailDomain };