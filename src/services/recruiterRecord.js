// A recruiter's public track record: how many jobs they have open, and (once they have closed one) how their jobs ended.
// Counts only, never a percentage: a job can have several openings, and a cancelled job is often not the recruiter's fault.
// Only CONFIRMED hires count (the hired person confirmed by email); pending, denied and expired ones never show.
const JobPosting = require('../models/JobPosting');
const pub = require('./publicJob');

function summarize(postings, now = Date.now()) {
  const rec = { openNow: 0, closed: 0, hiresPrecheckd: 0, hiresElsewhere: 0, hiresTotal: 0, notFilled: 0, showHistory: false };
  (postings || []).forEach((p) => {
    if (pub.isOpenNow(p, now)) { rec.openNow++; return; }
    if (p.status !== 'closed' || !p.outcome || !p.outcome.kind) return;
    rec.closed++;
    if (p.outcome.kind === 'not_filled' || p.outcome.kind === 'cancelled') rec.notFilled++;
    (p.outcome.hires || []).forEach((h) => {
      if (h.status !== 'confirmed') return;
      if (h.source === 'precheckd') rec.hiresPrecheckd++;
      else if (h.source === 'elsewhere') rec.hiresElsewhere++;
    });
  });
  rec.hiresTotal = rec.hiresPrecheckd + rec.hiresElsewhere;
  // Nothing about outcomes is shown until the recruiter has closed a job, so a new recruiter is not shown as 0 for 0.
  rec.showHistory = rec.closed >= 1;
  return rec;
}

// A failure here must never take down the profile or job page, so it falls back to an empty record.
async function forRecruiter(recruiterId, now = Date.now()) {
  try {
    const postings = await JobPosting.find({ recruiterId, status: { $in: ['open', 'closed'] } })
      .select('status closeDate outcome.kind outcome.hires.source outcome.hires.status').lean();
    return summarize(postings, now);
  } catch (error) {
    console.error('Error loading recruiter record:', error);
    return summarize([], now);
  }
}

module.exports = { summarize, forRecruiter };
