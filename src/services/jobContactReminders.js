// Nudges for the "who can confirm your jobs" page (services/jobContacts.js): one bell notice about a day after
// signup and one email about three days after, each sent once, and only while a job still needs an answer.
// The weekly recap carries a line too (services/weeklyEmails.js). Same safety rules as setupReminders: emails go
// 9:00-19:59 ET, only to verified, subscribed addresses, and each nudge is claimed atomically before it is sent.
const Candidate = require('../models/Candidate');
const { notify } = require('./notifications');
const { sendJobContactReminderEmail } = require('./emailService');
const { missingCount } = require('./jobContacts');

const TZ = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_HOURS = { start: 9, end: 20 };
const BELL_AFTER_DAYS = 1;
const EMAIL_AFTER_DAYS = 3;
const MAX_AGE_DAYS = 60;

const easternHour = (now) => Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }).format(now)) % 24;

// Which nudges are due for this candidate right now (pure; the run does the sending).
function due(candidate, now) {
  const age = now.getTime() - candidate.createdAt.getTime();
  const nudge = candidate.jobContactNudge || {};
  if (age > MAX_AGE_DAYS * DAY_MS || missingCount(candidate) === 0) return { bell: false, email: false };
  const hour = easternHour(now);
  const canEmail = Boolean(candidate.email && candidate.emailVerifiedAt && !candidate.weeklyEmailOptOut && hour >= SEND_HOURS.start && hour < SEND_HOURS.end);
  return {
    bell: age >= BELL_AFTER_DAYS * DAY_MS && !nudge.bellAt,
    email: canEmail && age >= EMAIL_AFTER_DAYS * DAY_MS && !nudge.emailAt
  };
}

async function runJobContactReminders({ now = new Date() } = {}) {
  const candidates = await Candidate.find({
    createdAt: { $gte: new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS), $lte: new Date(now.getTime() - BELL_AFTER_DAYS * DAY_MS) },
    $or: [{ 'jobContactNudge.bellAt': null }, { 'jobContactNudge.emailAt': null }],
    'workHistory.0': { $exists: true }
  });
  let bells = 0; let emails = 0;
  for (const candidate of candidates) {
    try {
      const d = due(candidate, now);
      const url = `/candidate/${candidate.slug}/job-contacts`;
      if (d.bell) {
        const claimed = await Candidate.updateOne({ _id: candidate._id, 'jobContactNudge.bellAt': null }, { $set: { 'jobContactNudge.bellAt': now } });
        if (claimed.modifiedCount) { await notify('candidate', candidate._id, 'job_contacts', 'Tell us who can confirm your jobs', url); bells += 1; }
      }
      if (d.email) {
        const claimed = await Candidate.updateOne({ _id: candidate._id, 'jobContactNudge.emailAt': null }, { $set: { 'jobContactNudge.emailAt': now } });
        if (!claimed.modifiedCount) continue;
        try { await sendJobContactReminderEmail(candidate, { count: missingCount(candidate) }); emails += 1; }
        catch (err) {
          console.error('Failed to send job contact reminder email:', err);
          await Candidate.updateOne({ _id: candidate._id }, { $set: { 'jobContactNudge.emailAt': null } }).catch(() => {});
        }
      }
    } catch (err) { console.error('Job contact reminder failed for a candidate:', err); }
  }
  return { bells, emails };
}

module.exports = { due, runJobContactReminders };
