// Bell notifications for skill tests. Each one is claimed with a one-shot flag on the attempt, so
// webhook retries, re-imports and the hourly job can never send the same notice twice.
const Candidate = require('../models/Candidate');
const SkillAssessment = require('../models/SkillAssessment');
const SkillResult = require('../models/SkillResult');
const { notify } = require('./notifications');
const { sendSkillNoticeEmail } = require('./emailService');

const DAY = 86400000;
const RETAKE_DAYS = 60;
const STALE_DAYS = 365;
const EXPIRY_WARN_MS = 2 * DAY;

async function context(result) {
  const [c, a] = await Promise.all([Candidate.findById(result.candidateId), SkillAssessment.findOne({ assessmentId: result.assessmentId })]);
  return { c, name: (a && a.name) || 'skills' };
}
const link = (c) => `/candidate/${c.slug}/skills`;

// Copy for each kind: bell title plus email. No scores and no review reasons, ever.
// `name` is the test or skill name; `date` is only used by 'rejected'.
const COPY = {
  skill_result: (n) => ({ bell: `Your ${n} results are ready`, subject: `Your ${n} results are ready`, headline: 'Your results are ready',
    paragraphs: [`Your ${n} results are in. Sign in to see them and choose what recruiters can see.`], button: 'View my results' }),
  skill_held: (n) => ({ bell: `Your ${n} results are being reviewed. We'll let you know when they're done`, subject: `Your ${n} results are being reviewed`, headline: 'Your results are being reviewed',
    paragraphs: [`We run a quick check on some attempts before the results are published. Yours is in that check now, and we'll email you as soon as it's done.`], button: 'Open my Skills page' }),
  skill_approved: (n) => ({ bell: `Your ${n} results have been published`, subject: `Your ${n} results are published`, headline: 'Your results are published',
    paragraphs: [`The check on your ${n} attempt is finished and your results are now on your profile. You choose what recruiters see.`], button: 'View my results' }),
  skill_rejected: (n, d) => ({ bell: `We couldn't verify your ${n} attempt, so it wasn't published. You can try again from ${d}`, subject: `About your ${n} attempt`, headline: `We couldn't verify this attempt`,
    paragraphs: [`We couldn't verify your ${n} attempt, so the results weren't published.`, `You can try again from ${d}.`], button: 'Open my Skills page' }),
  skill_ready: (n) => ({ bell: `A ${n} test is ready for you`, subject: `Your ${n} test is ready`, headline: 'The test you asked for is ready',
    paragraphs: [`You asked to be tested on ${n}, and the test is now available.`], button: 'Take the test' }),
  skill_retake: (n) => ({ bell: `You can retake ${n} now`, subject: `You can retake ${n}`, headline: 'You can retake this test', reminder: true,
    paragraphs: [`It has been 60 days since your ${n} attempt, so you can take it again. Your latest result is the one that counts.`], button: 'Open my Skills page' }),
  skill_stale: (n) => ({ bell: `Your ${n} result is over a year old and needs a retake`, subject: `Your ${n} result needs a retake`, headline: 'Time for a retake', reminder: true,
    paragraphs: [`Your ${n} result is more than a year old, so recruiters now see it marked as needing a retake. Retaking keeps it current.`], button: 'Open my Skills page' }),
  skill_expiring: (n) => ({ bell: `Your ${n} link expires soon`, subject: `Your ${n} test link expires soon`, headline: 'Your test link expires soon', reminder: true,
    paragraphs: [`You started a ${n} test but haven't finished it, and your link expires in about two days.`], button: 'Continue my test' })
};

// Bell notification plus email. Email failures are logged and never block the bell or the caller.
async function deliver(c, type, name, date) {
  const copy = COPY[type](name, date);
  await notify('candidate', c._id, type === 'skill_held' || type === 'skill_approved' || type === 'skill_rejected' ? 'skill_review' : type, copy.bell, link(c));
  if (copy.reminder && c.skillRemindersOptOut) return;
  if (!c.email) return;
  try { await sendSkillNoticeEmail(c.email, c.firstName, c.slug, copy); }
  catch (e) { console.error(`[skills] ${type} email failed:`, e.message); }
}

// Right after a report is stored: results ready, or held for review (no reason given).
async function resultsLanded(result) {
  if (result.status !== 'completed' || result.resultNotified) return false;
  result.resultNotified = true;
  await result.save();
  const { c, name } = await context(result);
  if (!c) return false;
  await deliver(c, result.held && !result.reviewDecision ? 'skill_held' : 'skill_result', name);
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
        if (c) { await deliver(c, 'skill_retake', name); counts.retake++; }
      }
    }
    if (!r.staleNotified && age >= STALE_DAYS * DAY && (!r.held || r.reviewDecision === 'approved')) {
      r.staleNotified = true; await r.save();
      if (!newerExists(r)) {
        const { c, name } = await context(r);
        if (c) { await deliver(c, 'skill_stale', name); counts.stale++; }
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
      if (c) { await deliver(c, 'skill_expiring', name); counts.expiring++; }
    }
  }
  return counts;
}

module.exports = { deliver, resultsLanded, runSkillReminders };
