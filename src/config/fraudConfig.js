const PUBLIC_EMAIL_DOMAINS = [
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'aol.com',
  'icloud.com', 'live.com', 'msn.com', 'protonmail.com', 'mail.com',
  'gmx.com', 'yandex.com', 'zoho.com'
];

// Number of DISTINCT reporters required before an email/domain shows up
// on the internal fraud dashboard. Not exposed anywhere public.
const EMAIL_REPORT_THRESHOLD = 5;
const DOMAIN_REPORT_THRESHOLD = 10;

module.exports = {
  PUBLIC_EMAIL_DOMAINS,
  EMAIL_REPORT_THRESHOLD,
  DOMAIN_REPORT_THRESHOLD,
};