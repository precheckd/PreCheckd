// The two weekly emails to candidates (replacing the daily unread digest):
//
//  - Monday ~7am ET: "Your week on PreCheckd" — unread messages first, then
//    what needs their attention, then a little newsletter.
//  - Thursday ~7am ET: a short email about unread messages that arrived since
//    the Monday email. Skipped when there are none.
//
// Rules:
// - Empty sections are left out. If a candidate has nothing personal and
//   there's no current "what's new" item, the Monday email isn't sent at all.
//   (A safety tip alone never triggers a send.)
// - Never includes message content, only who it's from and how many.
// - weeklyEmailOptOut turns off both emails. Every email carries a signed
//   unsubscribe link.
// - Runs hourly; each run only acts during its own window (Monday or Thursday,
//   7:00-10:59 ET), so a restart or short outage that morning still catches
//   up. Claims are atomic (like the digest), so two server instances or
//   repeat runs never double-send.
const Candidate = require('../models/Candidate');
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const { getRecentViewCount } = require('../utils/viewTracker');
const { getMissingMatchingRequirements } = require('../utils/candidateMatchingRequirements');
const { daysUntilExpiry, isoDay } = require('../utils/certExpiry');
const { currentWhatsNew, tipForWeek } = require('../content/weeklyEmail');
const { senderNames } = require('./messageDigest');
const { sendWeeklyRecapEmail, sendUnreadMessagesEmail } = require('./emailService');

const TZ = 'America/New_York';
const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW = { startHour: 7, endHour: 11 };
const CERT_WINDOW_DAYS = 90;

function easternParts(now) {
  const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: 'numeric', hour12: false, timeZone: TZ })
    .formatToParts(now);
  const weekday = parts.find((p) => p.type === 'weekday').value;
  const hour = Number(parts.find((p) => p.type === 'hour').value) % 24;
  return { weekday, hour };
}

function inWindow(now, weekday) {
  const parts = easternParts(now);
  return parts.weekday === weekday && parts.hour >= WINDOW.startHour && parts.hour < WINDOW.endHour;
}

// Unread messages for a candidate grouped by sender: [{ name, count }].
async function unreadBySender(candidateId, { since = null } = {}) {
  const query = { recipientType: 'candidate', recipientId: candidateId, readAt: null };
  if (since) query.sentAt = { $gt: since };
  const messages = await Message.find(query);
  if (messages.length === 0) return { total: 0, senders: [] };

  const names = await senderNames(messages);
  const senders = new Map();
  messages.forEach((m) => {
    const key = m.senderType === 'system' ? 'system' : `${m.senderType}:${m.senderId}`;
    const name = m.senderType === 'system' ? 'PreCheckd Trust & Safety' : names.get(key) || 'Someone';
    if (!senders.has(key)) senders.set(key, { name, count: 0 });
    senders.get(key).count += 1;
  });
  return { total: messages.length, senders: [...senders.values()] };
}

// Everything the Monday email might say about one candidate.
async function gatherRecap(candidate, now) {
  const [unread, requests, views] = await Promise.all([
    unreadBySender(candidate._id),
    ConnectionRequest.find({ candidateId: candidate._id }),
    getRecentViewCount('candidate', candidate._id, { now })
  ]);

  const weekAgo = now.getTime() - 7 * DAY_MS;
  const pendingRequests = requests.filter((r) =>
    r.status === 'pending' && r.initiatedBy === 'recruiter' && (!r.expiresAt || r.expiresAt.getTime() > now.getTime())).length;
  const fullAccessRequests = requests.filter((r) =>
    r.status === 'accepted' && r.fullAccessStatus === 'requested'
    && (!r.fullAccessExpiresAt || r.fullAccessExpiresAt.getTime() > now.getTime())).length;
  const newConnections = requests.filter((r) =>
    r.status === 'accepted' && r.respondedAt && r.respondedAt.getTime() >= weekAgo).length;

  const expiringCerts = (candidate.certifications || [])
    .map((cert) => ({ cert, daysLeft: daysUntilExpiry(cert, now) }))
    .filter((c) => c.daysLeft !== null && c.daysLeft >= 0 && c.daysLeft <= CERT_WINDOW_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((c) => ({ name: c.cert.name, daysLeft: c.daysLeft, expiresOn: isoDay(c.cert.expiresAt) }));

  const todo = [];
  getMissingMatchingRequirements(candidate).forEach((req) => {
    todo.push({
      text: `Finish "${req.label}" — recruiters can't find you in search until you do.`,
      path: req.page === 'verify-identity' ? `/candidate/${candidate.slug}/verify-identity` : `/candidate/${candidate.slug}/${req.page}`
    });
  });
  const newBadges = (candidate.credlyUnmatchedBadges || []).length;
  if (newBadges > 0) {
    todo.push({
      text: `We found ${newBadges} more badge${newBadges === 1 ? '' : 's'} on your Credly profile that you haven't added yet.`,
      path: `/candidate/${candidate.slug}/edit`
    });
  }
  if (candidate.isPhoneVerified && candidate.isIdentityVerified && !candidate.publicVerifyPage) {
    todo.push({
      text: 'Your public verification page is off. Turn it on to get a link you can add to your email signature.',
      path: `/candidate/${candidate.slug}/edit`
    });
  }

  const personal = unread.total > 0 || pendingRequests > 0 || fullAccessRequests > 0 || newConnections > 0
    || views > 0 || expiringCerts.length > 0 || todo.length > 0;

  return { unread, pendingRequests, fullAccessRequests, newConnections, views, expiringCerts, todo, personal };
}

// Monday. Returns { sent, skipped, outsideWindow? }.
async function runWeeklyRecap({ now = new Date() } = {}) {
  if (!inWindow(now, 'Mon')) return { sent: 0, skipped: 0, outsideWindow: true };

  const claimCutoff = new Date(now.getTime() - 5 * DAY_MS);
  const candidates = await Candidate.find({
    email: { $ne: null },
    weeklyEmailOptOut: { $ne: true },
    $or: [{ lastWeeklyEmailAt: null }, { lastWeeklyEmailAt: { $lt: claimCutoff } }]
  });

  const whatsNew = currentWhatsNew(now);
  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const recap = await gatherRecap(candidate, now);
      if (!recap.personal && whatsNew.length === 0) {
        // Nothing to say. Still mark Thursday's cut-off so it only covers newer messages.
        await Candidate.updateOne({ _id: candidate._id }, { unreadCoveredThrough: now });
        skipped += 1;
        continue;
      }

      const previous = { lastWeeklyEmailAt: candidate.lastWeeklyEmailAt, unreadCoveredThrough: candidate.unreadCoveredThrough };
      const claimed = await Candidate.findOneAndUpdate(
        { _id: candidate._id, weeklyEmailOptOut: { $ne: true }, $or: [{ lastWeeklyEmailAt: null }, { lastWeeklyEmailAt: { $lt: claimCutoff } }] },
        { lastWeeklyEmailAt: now, unreadCoveredThrough: now },
        { new: true }
      );
      if (!claimed) { skipped += 1; continue; }

      try {
        await sendWeeklyRecapEmail(candidate, { ...recap, whatsNew, tip: tipForWeek(now) });
        sent += 1;
      } catch (err) {
        console.error('Failed to send weekly recap email:', err);
        await Candidate.updateOne({ _id: candidate._id }, previous).catch(() => {});
        skipped += 1;
      }
    } catch (err) {
      console.error('Weekly recap failed for a candidate:', err);
      skipped += 1;
    }
  }

  return { sent, skipped };
}

// Thursday. Only messages that arrived after the last cut-off (set by Monday's
// run, or the Thursday run itself), still unread. Returns { sent, skipped }.
async function runUnreadMessagesEmail({ now = new Date() } = {}) {
  if (!inWindow(now, 'Thu')) return { sent: 0, skipped: 0, outsideWindow: true };

  const claimCutoff = new Date(now.getTime() - 2 * DAY_MS);
  const candidates = await Candidate.find({
    email: { $ne: null },
    weeklyEmailOptOut: { $ne: true },
    $or: [{ lastUnreadEmailAt: null }, { lastUnreadEmailAt: { $lt: claimCutoff } }]
  });

  let sent = 0;
  let skipped = 0;

  for (const candidate of candidates) {
    try {
      const since = candidate.unreadCoveredThrough || new Date(now.getTime() - 4 * DAY_MS);
      const fresh = await unreadBySender(candidate._id, { since });
      if (fresh.total === 0) { skipped += 1; continue; }

      const allUnread = await unreadBySender(candidate._id);

      const previous = { lastUnreadEmailAt: candidate.lastUnreadEmailAt, unreadCoveredThrough: candidate.unreadCoveredThrough };
      const claimed = await Candidate.findOneAndUpdate(
        { _id: candidate._id, weeklyEmailOptOut: { $ne: true }, $or: [{ lastUnreadEmailAt: null }, { lastUnreadEmailAt: { $lt: claimCutoff } }] },
        { lastUnreadEmailAt: now, unreadCoveredThrough: now },
        { new: true }
      );
      if (!claimed) { skipped += 1; continue; }

      try {
        await sendUnreadMessagesEmail(candidate, { fresh, totalUnread: allUnread.total });
        sent += 1;
      } catch (err) {
        console.error('Failed to send unread messages email:', err);
        await Candidate.updateOne({ _id: candidate._id }, previous).catch(() => {});
        skipped += 1;
      }
    } catch (err) {
      console.error('Unread messages email failed for a candidate:', err);
      skipped += 1;
    }
  }

  return { sent, skipped };
}

module.exports = { runWeeklyRecap, runUnreadMessagesEmail, gatherRecap, inWindow, easternParts };
