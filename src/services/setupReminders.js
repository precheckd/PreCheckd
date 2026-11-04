// Reminder emails for new candidates who haven't finished the guided setup
// (utils/candidateOnboarding.js): about 1, 3 and 7 days after signup, then no more.
//
// Rules:
// - Only accounts the setup applies to (onboarding.required), not finished, with a
//   verified email, not unsubscribed (weeklyEmailOptOut covers these too).
// - If the setup got finished some other way, we stamp it complete and send nothing.
// - Sent 9:00-19:59 ET so nothing lands overnight.
// - If a stage was missed (server down), only the latest due reminder is sent and the
//   older ones are marked sent too, so nobody gets two emails at once.
// - Each stage is claimed atomically before sending, and handed back if the send fails,
//   so two server instances or repeat runs never double-send.
const Candidate = require('../models/Candidate');
const { setupProgress } = require('../utils/candidateOnboarding');
const { sendSetupReminderEmail } = require('./emailService');

const TZ = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;
const SEND_HOURS = { start: 9, end: 20 };
const MAX_AGE_DAYS = 30;
const STAGES = [
  { key: 'd1', days: 1 },
  { key: 'd3', days: 3 },
  { key: 'd7', days: 7 }
];

function easternHour(now) {
  const h = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: TZ }).format(now);
  return Number(h) % 24;
}

function dueStages(candidate, now) {
  const sent = new Set((candidate.onboarding && candidate.onboarding.remindersSent) || []);
  const age = now.getTime() - candidate.createdAt.getTime();
  return STAGES.filter((s) => age >= s.days * DAY_MS && !sent.has(s.key));
}

async function runSetupReminders({ now = new Date() } = {}) {
  const hour = easternHour(now);
  if (hour < SEND_HOURS.start || hour >= SEND_HOURS.end) return { sent: 0, skipped: 0, outsideWindow: true };

  const candidates = await Candidate.find({
    'onboarding.required': true,
    'onboarding.completedAt': null,
    'onboarding.remindersSent': { $ne: 'd7' },
    email: { $ne: null },
    emailVerifiedAt: { $ne: null },
    weeklyEmailOptOut: { $ne: true },
    createdAt: { $gte: new Date(now.getTime() - MAX_AGE_DAYS * DAY_MS) }
  });

  let sent = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    try {
      const progress = setupProgress(candidate);
      if (progress.complete) {
        await Candidate.updateOne({ _id: candidate._id }, { 'onboarding.completedAt': now });
        skipped += 1;
        continue;
      }
      const due = dueStages(candidate, now);
      if (due.length === 0) { skipped += 1; continue; }

      const keys = due.map((s) => s.key);
      const claimed = await Candidate.updateOne(
        { _id: candidate._id, 'onboarding.remindersSent': { $nin: keys }, weeklyEmailOptOut: { $ne: true } },
        { $addToSet: { 'onboarding.remindersSent': { $each: keys } } }
      );
      if (!claimed.modifiedCount) { skipped += 1; continue; }

      try {
        await sendSetupReminderEmail(candidate, {
          stage: keys[keys.length - 1],
          remaining: progress.steps.filter((s) => !s.done),
          total: progress.total
        });
        sent += 1;
      } catch (err) {
        console.error('Failed to send setup reminder email:', err);
        await Candidate.updateOne({ _id: candidate._id }, { $pull: { 'onboarding.remindersSent': { $in: keys } } }).catch(() => {});
        skipped += 1;
      }
    } catch (err) {
      console.error('Setup reminder failed for a candidate:', err);
      skipped += 1;
    }
  }
  return { sent, skipped };
}

module.exports = { runSetupReminders, dueStages, STAGES };
