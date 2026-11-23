// Loads schools into the directory from rows (name, ipedsId, website, registrarEmail, registrarPhone, sourceUrl).
//   - an address copied from the school's own site (with its source link)  -> confirmed
//   - no address, but the school's domain accepts mail                       -> guessed: registrar@<domain>
//   - nothing usable                                                         -> needs_research
// Existing rows are updated but a confirmed address is never overwritten by a guess.
const dns = require('dns').promises;
const School = require('../models/School');

const domainOf = (website) => String(website || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0].trim();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

async function acceptsMail(domain, resolver = dns) {
  if (!domain) return false;
  try { const mx = await resolver.resolveMx(domain); return Array.isArray(mx) && mx.length > 0; } catch (e) { return false; }
}

// Returns { name, ipedsId, domain, registrarEmail, registrarPhone, emailStatus, sourceUrl } for one row.
async function classify(row, resolver = dns) {
  const name = String(row.name || '').trim();
  const domain = domainOf(row.website);
  const given = String(row.registrarEmail || '').trim().toLowerCase();
  const out = { name, ipedsId: String(row.ipedsId || '').trim() || null, domain, registrarEmail: '', registrarPhone: String(row.registrarPhone || '').trim(), emailStatus: 'needs_research', sourceUrl: String(row.sourceUrl || '').trim() };
  if (given && EMAIL_RE.test(given) && out.sourceUrl) { out.registrarEmail = given; out.emailStatus = 'confirmed'; }
  else if (domain && await acceptsMail(domain, resolver)) { out.registrarEmail = `registrar@${domain}`; out.emailStatus = 'guessed'; }
  return out;
}

async function importRows(rows, { resolver = dns, now = new Date() } = {}) {
  const counts = { confirmed: 0, guessed: 0, needs_research: 0, skipped: 0 };
  for (const row of rows) {
    if (!String(row.name || '').trim()) { counts.skipped += 1; continue; }
    const c = await classify(row, resolver);
    const existing = (c.ipedsId && await School.findOne({ ipedsId: c.ipedsId })) || await School.findOne({ nameKey: School.keyOf(c.name) });
    if (existing) {
      if (existing.emailStatus === 'confirmed' && c.emailStatus !== 'confirmed') { counts.skipped += 1; continue; }
      Object.assign(existing, c, { checkedAt: now });
      await existing.save();
    } else {
      await School.create({ ...c, checkedAt: now });
    }
    counts[c.emailStatus] += 1;
  }
  return counts;
}

module.exports = { classify, importRows, domainOf, acceptsMail };
