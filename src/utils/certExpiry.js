// Shared rules for certification expiry. A cert with no expiry date never
// expires (as far as we know). A cert is valid through the END of its expiry
// day (UTC), so one that expires "March 1" still shows as current on March 1.
const DAY_MS = 24 * 60 * 60 * 1000;

// Accepts a Date, an ISO/"YYYY-MM-DD" string, or null. Returns a Date at UTC
// midnight of that calendar day, or null if missing/invalid.
function parseExpiry(value) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return Number.isNaN(date.getTime()) ? null : date;
}

function startOfUtcDay(now) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

// Whole days from today until the expiry day: 0 = expires today, negative =
// already expired. Null when the cert has no expiry date.
function daysUntilExpiry(cert, now = new Date()) {
  const expiry = parseExpiry(cert && cert.expiresAt);
  if (!expiry) return null;
  return Math.round((expiry.getTime() - startOfUtcDay(now).getTime()) / DAY_MS);
}

function isExpired(cert, now = new Date()) {
  const days = daysUntilExpiry(cert, now);
  return days !== null && days < 0;
}

// Certs that are still current (no expiry date, or not past it yet).
function activeCerts(certs, now = new Date()) {
  return (certs || []).filter((cert) => !isExpired(cert, now));
}

function isoDay(value) {
  const date = parseExpiry(value);
  return date ? date.toISOString().slice(0, 10) : '';
}

module.exports = { parseExpiry, daysUntilExpiry, isExpired, activeCerts, isoDay, DAY_MS };
