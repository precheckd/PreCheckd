// The free founding year (invite only, first 100 recruiters). Their Stripe subscription starts with a 365-day trial and the
// card is on file. The deal is about real activity, not a count of open jobs:
//   - post at least 3 real jobs in the first 30 days, and then
//   - keep at least 2 "maintained": open now, or filled (closed as hired) in the last 30 days.
// Miss it and they get a warning and 30 days to fix it. If it is still missed when the 30 days are up, the trial ends
// early: the card is charged the locked $349 and the paid year starts ("I'm not running a charity").
// runFreeYearCheck is idempotent, so it can run every hour: every email and charge is guarded by the stored state.
const JobPosting = require('../models/JobPosting');
const Recruiter = require('../models/Recruiter');
const publicJob = require('./publicJob');
const emailService = require('./emailService');

const DAY = 86400000;
const POSTED_TARGET = 3;
const POSTED_WINDOW_DAYS = 30;
const MAINTAINED_TARGET = 2;
const HIRED_WINDOW_DAYS = 30;
const CURE_DAYS = 30;
const REMIND_DAYS_BEFORE = 7;
const base = () => process.env.APP_BASE_URL || 'https://precheckd.com';
const fmt = (d) => new Date(d).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });

// Pure: what should happen tonight for one free-year recruiter.
//   fy: the billing.freeYear block, counts: { posted, maintained }
// Returns { action: none|warn|clear|remind|end|complete, reason?, postedMet? } (postedMet: record that the 3-jobs bar is met).
function evaluate(fy, counts, now = new Date()) {
  if (!fy || !fy.status || fy.status === 'ended') return { action: 'none' };
  const t = new Date(now).getTime();
  if (fy.trialEnd && t >= new Date(fy.trialEnd).getTime()) return { action: 'complete' };
  const postedMet = Boolean(fy.postedMetAt) || counts.posted >= POSTED_TARGET;
  const out = {};
  if (postedMet && !fy.postedMetAt) out.postedMet = true;
  let failing = null;
  if (!postedMet && fy.startedAt && t >= new Date(fy.startedAt).getTime() + POSTED_WINDOW_DAYS * DAY) failing = 'posted';
  else if (postedMet && counts.maintained < MAINTAINED_TARGET) failing = 'maintained';
  if (!failing) return Object.assign(out, { action: fy.status === 'warned' ? 'clear' : 'none' });
  if (fy.status !== 'warned') return Object.assign(out, { action: 'warn', reason: failing });
  const cure = fy.cureBy ? new Date(fy.cureBy).getTime() : null;
  if (cure && t >= cure) return Object.assign(out, { action: 'end', reason: failing });
  if (cure && !fy.reminderSentAt && cure - t <= REMIND_DAYS_BEFORE * DAY) return Object.assign(out, { action: 'remind', reason: failing });
  return Object.assign(out, { action: 'none' });
}

// Real numbers from the postings.
async function countsFor(recruiter, now = new Date()) {
  const fy = recruiter.billing.freeYear || {};
  const since = fy.startedAt ? new Date(fy.startedAt) : new Date(0);
  const posted = await JobPosting.countDocuments({ recruiterId: recruiter._id, createdAt: { $gte: since }, status: { $ne: 'removed' } });
  const open = (await JobPosting.find({ recruiterId: recruiter._id, status: 'open' })).filter((p) => publicJob.isOpenNow(p, new Date(now).getTime())).length;
  const filled = await JobPosting.countDocuments({
    recruiterId: recruiter._id, status: 'closed', 'outcome.kind': { $in: ['hired_precheckd', 'hired_elsewhere'] },
    'outcome.recordedAt': { $gte: new Date(new Date(now).getTime() - HIRED_WINDOW_DAYS * DAY) },
  });
  return { posted, maintained: open + filled, open, filled };
}

const WHY = {
  posted: 'You have not posted 3 real jobs in your first 30 days.',
  maintained: 'You have fewer than 2 jobs maintained. A job counts when it is open, or when it closed as filled in the last 30 days.',
};

// Pure: the words for each email. `d` carries { cureBy, reason, trialEnd }.
function notice(kind, d = {}) {
  const url = base() + '/billing';
  const list = {
    started: {
      subject: 'Your free founding year has started',
      headline: 'Your free year has started',
      paragraphs: [
        d.trialEnd ? `You are one of the first 100 founding recruiters. Your first year is free, until ${fmt(d.trialEnd)}. After that it is $349 a year, and that price stays locked as long as you stay a member.` : 'You are one of the first 100 founding recruiters. Your first year is free, then $349 a year, locked in.',
        'The deal: post at least 3 real jobs in your first 30 days, then keep at least 2 going. A job counts while it is open, or for 30 days after it closes as filled.',
        'If it slips, we email you first and give you 30 days to fix it. If it is still not fixed, your card is charged $349 and your paid year starts.',
      ],
      button: 'Open my membership', url,
    },
    warning: {
      subject: 'Action needed: your free founding year',
      headline: 'Your free year needs a fix',
      paragraphs: [
        WHY[d.reason] || WHY.maintained,
        d.cureBy ? `You have until ${fmt(d.cureBy)} to fix it. If it is fixed, nothing changes. If not, your card is charged $349 on that date and your paid year starts.` : 'You have 30 days to fix it. If not, your card is charged $349 and your paid year starts.',
      ],
      button: 'Post or manage jobs', url: base() + '/recruiter-jobs',
    },
    reminder: {
      subject: 'One week left to fix your free founding year',
      headline: 'One week left',
      paragraphs: [
        WHY[d.reason] || WHY.maintained,
        d.cureBy ? `If it is not fixed by ${fmt(d.cureBy)}, your card is charged $349 and your paid year starts.` : 'If it is not fixed soon, your card is charged $349 and your paid year starts.',
      ],
      button: 'Post or manage jobs', url: base() + '/recruiter-jobs',
    },
    back_on_track: {
      subject: 'You are back on track',
      headline: 'Your free year is safe',
      paragraphs: ['Thanks for fixing it. You are meeting the founding bar again, and your free year continues.'],
      button: 'Open my membership', url,
    },
    ended_bar: {
      subject: 'Your free founding year has ended',
      headline: 'Your paid year has started',
      paragraphs: [
        'The founding bar was not met by the end of the 30 days, so your free year ended early. Your card was charged $349 for your first paid year, and your locked founding price continues.',
        'You keep everything: your jobs, applicants and membership. Stripe emails the receipt.',
      ],
      button: 'Open my membership', url,
    },
  };
  return list[kind] || null;
}

async function send(kind, recruiter, d) {
  try {
    const n = notice(kind, d);
    if (!n || !recruiter.email) return false;
    await emailService.sendBillingNoticeEmail(recruiter.email, recruiter.firstName, n);
    return true;
  } catch (e) { console.error('Free-year email failed:', kind, e.message); return false; }
}

// Called once the invite checkout is paid (a trial: no money moves, the card is saved). Safe to call twice.
async function start(recruiter, invite, sub, now = new Date()) {
  const fy = recruiter.billing.freeYear;
  if (fy && fy.inviteId && String(fy.inviteId) === String(invite._id)) return false;
  const trialEnd = sub && sub.trial_end ? new Date(sub.trial_end * 1000) : new Date(new Date(now).getTime() + 365 * DAY);
  recruiter.billing.freeYear = { inviteId: invite._id, startedAt: new Date(now), trialEnd, status: 'ok', postedMetAt: null, warnedAt: null, cureBy: null, reminderSentAt: null, reason: null, endedAt: null, endedReason: null };
  recruiter.markModified('billing.freeYear');
  await recruiter.save();
  await send('started', recruiter, { trialEnd });
  return true;
}

// For the billing page: where the recruiter stands. null when they are not in a free year.
async function progress(recruiter, now = new Date()) {
  const fy = recruiter.billing && recruiter.billing.freeYear;
  if (!fy || !fy.status || fy.status === 'ended') return null;
  const c = await countsFor(recruiter, now);
  return { status: fy.status, trialEnd: fy.trialEnd, cureBy: fy.cureBy, posted: c.posted, postedTarget: POSTED_TARGET, postedMet: Boolean(fy.postedMetAt) || c.posted >= POSTED_TARGET,
    maintained: c.maintained, maintainedTarget: MAINTAINED_TARGET, reason: fy.reason,
    postByDate: fy.startedAt ? new Date(new Date(fy.startedAt).getTime() + POSTED_WINDOW_DAYS * DAY) : null };
}

// The nightly (really hourly, it is idempotent) check.
async function runFreeYearCheck({ stripe, now = new Date() } = {}) {
  const list = await Recruiter.find({ 'billing.freeYear.status': { $in: ['ok', 'warned'] } });
  const summary = { checked: list.length, warned: 0, cleared: 0, reminded: 0, ended: 0, completed: 0 };
  for (const r of list) {
    try {
      const fy = r.billing.freeYear;
      // Cancelled or otherwise not in good standing: there is no free year left to police.
      if (r.billing.status !== 'active') { fy.status = 'ended'; fy.endedAt = new Date(now); fy.endedReason = 'not_active'; r.markModified('billing.freeYear'); await r.save(); continue; }
      const counts = await countsFor(r, now);
      const res = evaluate(fy, counts, now);
      if (res.postedMet) fy.postedMetAt = new Date(now);
      if (res.action === 'warn') {
        fy.status = 'warned'; fy.warnedAt = new Date(now); fy.cureBy = new Date(new Date(now).getTime() + CURE_DAYS * DAY); fy.reason = res.reason; fy.reminderSentAt = null;
        r.markModified('billing.freeYear'); await r.save(); summary.warned += 1;
        await send('warning', r, { reason: res.reason, cureBy: fy.cureBy });
      } else if (res.action === 'clear') {
        fy.status = 'ok'; fy.warnedAt = null; fy.cureBy = null; fy.reason = null; fy.reminderSentAt = null;
        r.markModified('billing.freeYear'); await r.save(); summary.cleared += 1;
        await send('back_on_track', r, {});
      } else if (res.action === 'remind') {
        fy.reminderSentAt = new Date(now);
        r.markModified('billing.freeYear'); await r.save(); summary.reminded += 1;
        await send('reminder', r, { reason: res.reason, cureBy: fy.cureBy });
      } else if (res.action === 'end') {
        // Ending the trial now makes Stripe charge the first $349 invoice straight away. If Stripe fails, nothing is
        // marked, so the next run tries again.
        if (stripe && r.billing.subscriptionId) await stripe.subscriptions.update(r.billing.subscriptionId, { trial_end: 'now' });
        fy.status = 'ended'; fy.endedAt = new Date(now); fy.endedReason = 'bar_missed'; fy.reason = res.reason;
        r.markModified('billing.freeYear'); await r.save(); summary.ended += 1;
        await send('ended_bar', r, {});
      } else if (res.action === 'complete') {
        fy.status = 'ended'; fy.endedAt = new Date(now); fy.endedReason = 'completed';
        r.markModified('billing.freeYear'); await r.save(); summary.completed += 1;
      } else if (res.postedMet) { r.markModified('billing.freeYear'); await r.save(); }
    } catch (e) { console.error('[free-year] check failed for', String(r._id), e.message); }
  }
  return summary;
}

module.exports = { POSTED_TARGET, MAINTAINED_TARGET, CURE_DAYS, evaluate, notice, start, progress, countsFor, runFreeYearCheck };
