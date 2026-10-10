// Emails candidates before a certification expires: 90 days out, 30 days
// out, and on the day it expires.
//
// Rules:
// - Before emailing, the candidate's Credly wallet is checked again (when
//   they've linked one), so someone who already renewed never gets a
//   reminder for the old date. If Credly can't be reached, the reminder is
//   held for up to HOLD_DAYS and then sent anyway, so a private or broken
//   Credly profile can't block reminders forever.
// - Each reminder goes out once per cert per expiry date (remindersSent keys
//   are "<expiry day>:<threshold>"). A renewal means a new expiry date, which
//   starts the cycle over.
// - A cert gets the most urgent threshold that applies to it. One added with
//   20 days left gets the 30-day reminder, not the 90.
// - Certs already expired by more than EXPIRED_GRACE_DAYS are skipped, so
//   turning this on never emails people about long-lapsed certs.
// - Only sent during daytime hours in America/New_York.
const Candidate = require('../models/Candidate');
const { syncWithCredly } = require('../utils/credlyVerification');
const { daysUntilExpiry, isoDay } = require('../utils/certExpiry');
const { sendCertExpiryReminderEmail } = require('./emailService');
const { inSendWindow } = require('./messageDigest');

const THRESHOLDS = [0, 30, 90]; // days before expiry; ascending
const EXPIRED_GRACE_DAYS = 7;
const HOLD_DAYS = 3;

// The most urgent threshold a cert has reached, or null if none yet.
function thresholdFor(daysLeft) {
  if (daysLeft === null || daysLeft < -EXPIRED_GRACE_DAYS) return null;
  return THRESHOLDS.find((t) => daysLeft <= t) ?? null;
}

// Certs that currently need a reminder, as { cert, daysLeft, threshold, key }.
function dueReminders(candidate, now) {
  const due = [];
  (candidate.certifications || []).forEach((cert) => {
    const daysLeft = daysUntilExpiry(cert, now);
    const threshold = thresholdFor(daysLeft);
    if (threshold === null) return;
    const key = `${isoDay(cert.expiresAt)}:${threshold}`;
    if ((cert.remindersSent || []).includes(key)) return;
    due.push({ cert, daysLeft, threshold, key });
  });
  return due;
}

// Returns { sent, skipped, held, outsideWindow? }. `now` is injectable for tests.
async function runCertExpiryReminders({ now = new Date() } = {}) {
  if (!inSendWindow(now)) return { sent: 0, skipped: 0, held: 0, outsideWindow: true };

  const horizon = new Date(now.getTime() + 91 * 24 * 60 * 60 * 1000);
  const floor = new Date(now.getTime() - (EXPIRED_GRACE_DAYS + 2) * 24 * 60 * 60 * 1000);

  const candidates = await Candidate.find({
    certifications: { $elemMatch: { expiresAt: { $ne: null, $gte: floor, $lte: horizon } } }
  });

  let sent = 0;
  let skipped = 0;
  let held = 0;

  for (const candidate of candidates) {
    try {
      if (!candidate.email) { skipped += 1; continue; }
      if (dueReminders(candidate, now).length === 0) { skipped += 1; continue; }

      // Re-check Credly first: a renewal changes the stored expiry date.
      let credlyChecked = true;
      if (candidate.credlyUsername) {
        const before = candidate.credlyLastSyncedAt ? candidate.credlyLastSyncedAt.getTime() : 0;
        await syncWithCredly(candidate);
        const after = candidate.credlyLastSyncedAt ? candidate.credlyLastSyncedAt.getTime() : 0;
        credlyChecked = after > before;
        if (credlyChecked) await candidate.save();
      }

      let due = dueReminders(candidate, now);
      if (!credlyChecked) {
        // Couldn't confirm against Credly; hold briefly, then send anyway.
        const stillFresh = due.filter((d) => d.daysLeft > d.threshold - HOLD_DAYS);
        if (stillFresh.length > 0) {
          held += 1;
          due = due.filter((d) => d.daysLeft <= d.threshold - HOLD_DAYS);
        }
      }
      if (due.length === 0) { skipped += 1; continue; }

      // Record first, send second; undo if the send fails so the next run retries.
      due.forEach(({ cert, key }) => cert.remindersSent.push(key));
      await candidate.save();

      try {
        await sendCertExpiryReminderEmail(candidate.email, candidate.firstName, candidate.slug, due.map((d) => ({
          name: d.cert.name,
          daysLeft: d.daysLeft,
          expiresOn: isoDay(d.cert.expiresAt)
        })));
        sent += 1;
      } catch (err) {
        console.error('Failed to send cert expiry reminder:', err);
        due.forEach(({ cert, key }) => {
          cert.remindersSent = cert.remindersSent.filter((k) => k !== key);
        });
        await candidate.save().catch(() => {});
        skipped += 1;
      }
    } catch (err) {
      console.error('Cert expiry reminder failed for a candidate:', err);
      skipped += 1;
    }
  }

  return { sent, skipped, held };
}

module.exports = { runCertExpiryReminders, thresholdFor, dueReminders, THRESHOLDS };
