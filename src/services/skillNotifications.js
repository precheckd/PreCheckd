// Bell notifications for skill tests. Each one is claimed with a one-shot flag on the attempt, so
// webhook retries, re-imports and the hourly job can never send the same notice twice.
const Candidate = require('../models/Candidate');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const { notify } = require('./notifications');

const DAY = 86400000;
const RETAKE_DAYS = 60;
const STALE_DAYS = 365;
const EXPIRY_WARN_MS = 2 * DAY;

async function context(result) {
  const [c, a] = await Promise.all([Candidate.findById(result.candidateId), SkillAssessment.findOne({ assessmentId: result.assessmentId })]);
  return { c, name: (a && a.name) || 'skills' };
}
const link = (c) => `/candidate/${c.slug}/skills`;

// Right after a report is stored: results ready, or held for review (no reason given).
async function resultsLanded(result) {
  if (result.status !== 'completed' || result.resultNotified) return false;
  result.resultNotified = true;
  await result.save();
  const { c, name } = await context(result);
  if (!c) return false;
  const title = result.held && !result.reviewDecision
    ? `Your ${name} results are being reviewed. We'll let you know when they're done`
    : `Your ${name} results are ready`;
  await notify('candidate', c._id, 'skill_result', title, link(c));
  return true;
}

// Hourly: retake open, needs retake, link expiring. Returns counts for the job log.
async function runSkillReminders(now = Date.now()) {
  const counts = { retake: 0, stale: 0, expiring: 0 };
  const done = await SkillResult.find({ status: 'completed' });
  const newerExists = (r) => done.some((o) => o.candidateId.toString() === r.candidateId.toString()
    && o.assessmentId === r.assessmentId && o.completedAt && r.completedAt && o.completedAt > r.completedAt);

  for (const r of done) {
    if (!r.completedAt || r.reviewDecision === 'rejected') continue;
    const age = now - r.completedAt.getTime();
    if (!r.retakeNotified && age >= RETAKE_DAYS * DAY) {
      r.retakeNotified = true; await r.save();
      if (!newerExists(r)) {
        const { c, name } = await context(r);
        if (c) { await notify('candidate', c._id, 'skill_retake', `You can retake ${name} now`, link(c)); counts.retake++; }
      }
    }
    if (!r.staleNotified && age >= STALE_DAYS * DAY && (!r.held || r.reviewDecision === 'approved')) {
      r.staleNotified = true; await r.save();
      if (!newerExists(r)) {
        const { c, name } = await context(r);
        if (c) { await notify('candidate', c._id, 'skill_stale', `Your ${name} result is over a year old and needs a retake`, link(c)); counts.stale++; }
      }
    }
  }

  const open = await SkillResult.find({ status: { $in: ['invited', 'started'] }, expiryNotified: false });
  for (const r of open) {
    if (!r.expiresAt) continue;
    const left = r.expiresAt.getTime() - now;
    if (left > 0 && left <= EXPIRY_WARN_MS) {
      r.expiryNotified = true; await r.save();
      const { c, name } = await context(r);
      if (c) { await notify('candidate', c._id, 'skill_expiring', `Your ${name} link expires soon`, link(c)); counts.expiring++; }
    }
  }
  return counts;
}

module.exports = { resultsLanded, runSkillReminders };
