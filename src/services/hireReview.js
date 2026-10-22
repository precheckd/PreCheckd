// Staff view of hires that need a look: a named hire who said "no", a repost after a cancellation, and
// "hired elsewhere" confirmations nobody answered after a week. Pure query helpers.
const JobPosting = require('../models/JobPosting');

const DAY = 86400000;
const STALE_DAYS = 7;

async function listHireReviews({ now = new Date() } = {}) {
  const all = await JobPosting.find({ status: 'closed' });
  const rows = [];
  for (const p of all) {
    const hires = (p.outcome && p.outcome.hires) || [];
    const pending = hires.filter((h) => h.source === 'elsewhere' && h.status === 'pending' && now.getTime() - new Date(h.sentAt).getTime() > STALE_DAYS * DAY);
    const denied = hires.filter((h) => h.status === 'denied');
    const expired = hires.filter((h) => h.status === 'expired');
    const unresolved = !p.reviewClearedAt && (pending.length || denied.length || expired.length);
    if (!p.reviewFlag && !unresolved) continue;
    rows.push({ id: String(p._id), title: p.title, company: p.hiringCompany, recruiterId: String(p.recruiterId), flag: p.reviewFlag || null,
      pending: pending.length, denied: denied.length, expired: expired.length, closedAt: p.closedAt });
  }
  // also flagged postings that are not closed (repost flags are set on new open postings)
  const open = await JobPosting.find({ status: 'open' });
  for (const p of open) {
    if (!p.reviewFlag) continue;
    rows.push({ id: String(p._id), title: p.title, company: p.hiringCompany, recruiterId: String(p.recruiterId), flag: p.reviewFlag, pending: 0, denied: 0, expired: 0, closedAt: null });
  }
  return rows.sort((a, b) => (b.flag ? 1 : 0) - (a.flag ? 1 : 0) || String(b.id).localeCompare(String(a.id)));
}

async function clearFlag(id) {
  const p = await JobPosting.findById(id);
  if (!p) return false;
  p.reviewFlag = null;
  p.reviewClearedAt = new Date();
  await p.save();
  return true;
}

module.exports = { listHireReviews, clearFlag, STALE_DAYS };
