// Reminders to record how a job ended: 3 and 1 days before the close date, then daily once the account is paused.
// Morning window (8:00-10:59 ET, any day). Also flips postings past their close date to "awaiting outcome".
const JobPosting = require('../models/JobPosting');
const Recruiter = require('../models/Recruiter');
const { notify } = require('./notifications');
const { closeExpired } = require('./postingOutcome');
const { easternParts } = require('./weeklyEmails');

const DAY = 86400000;
const inWindow = (now) => { const h = easternParts(now).hour; return h >= 8 && h < 11; };

async function runOutcomeReminders({ now = new Date(), send } = {}) {
  await closeExpired({ now });
  if (!inWindow(now)) return { sent: 0, outsideWindow: true };
  const deliver = send || require('./emailService').sendOutcomeReminderEmail;
  let sent = 0;

  for (const p of await JobPosting.find({ status: 'open' })) {
    const daysLeft = Math.ceil((new Date(p.closeDate).getTime() - now.getTime()) / DAY);
    const due = [1, 3].find((t) => daysLeft <= t && daysLeft >= 1 && !(p.closeRemindersSent || []).includes(t));
    if (!due) continue;
    const recruiter = await Recruiter.findById(p.recruiterId);
    if (!recruiter || !recruiter.email) continue;
    p.closeRemindersSent = [...new Set([...(p.closeRemindersSent || []), ...[1, 3].filter((t) => t >= due)])];
    await p.save();
    try { await deliver(recruiter, p, { kind: 'upcoming', daysLeft }); sent += 1; } catch (e) { console.error('Outcome reminder failed:', e.message); }
    await notify('recruiter', p.recruiterId, 'job_closing', `${p.title} closes in ${daysLeft} day${daysLeft === 1 ? '' : 's'}. You will record how it ended.`, `/recruiter-jobs/${p._id}`);
  }

  const cutoff = now.getTime() - 20 * 3600000;
  for (const p of await JobPosting.find({ status: 'awaiting_outcome' })) {
    if (p.lastOutcomeReminderAt && new Date(p.lastOutcomeReminderAt).getTime() > cutoff) continue;
    const recruiter = await Recruiter.findById(p.recruiterId);
    if (!recruiter || !recruiter.email) continue;
    p.lastOutcomeReminderAt = now;
    await p.save();
    try { await deliver(recruiter, p, { kind: 'overdue' }); sent += 1; } catch (e) { console.error('Outcome reminder failed:', e.message); }
  }
  return { sent };
}

module.exports = { runOutcomeReminders, inWindow };
