// Once-a-day "you have unread messages" email for RECRUITERS (candidates
// get the weekly emails), instead of an email per message. Names who the messages are from and how many — never the
// content — as a nudge back to the site.
//
// Rules:
// - Only messages still unread after MIN_UNREAD_AGE_MS count, so someone
//   actively chatting in the app never gets an email about it.
// - At most one digest per account per ~day (lastMessageDigestAt).
// - Only sent during daytime hours in America/New_York.
// - The claim on lastMessageDigestAt is atomic, so if more than one server
//   instance runs this at once, only one of them sends.
const Message = require('../models/Message');
const MailMessage = require('../models/MailMessage');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { sendMessageDigestEmail } = require('./emailService');

const MIN_UNREAD_AGE_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 22 * 60 * 60 * 1000;
const SEND_WINDOW = { startHour: 9, endHour: 20, timeZone: 'America/New_York' };

function inSendWindow(now) {
  const hour = Number(
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: SEND_WINDOW.timeZone }).format(now)
  ) % 24;
  return hour >= SEND_WINDOW.startHour && hour < SEND_WINDOW.endHour;
}

async function senderNames(messages) {
  const recruiterIds = new Set();
  const candidateIds = new Set();
  messages.forEach((m) => {
    if (m.senderType === 'recruiter' && m.senderId) recruiterIds.add(m.senderId.toString());
    if (m.senderType === 'candidate' && m.senderId) candidateIds.add(m.senderId.toString());
  });

  const [recruiters, candidates] = await Promise.all([
    Recruiter.find({ _id: { $in: [...recruiterIds] } }).select('firstName lastName'),
    Candidate.find({ _id: { $in: [...candidateIds] } }).select('firstName lastName')
  ]);

  const names = new Map();
  recruiters.forEach((r) => names.set(`recruiter:${r._id}`, `${r.firstName} ${r.lastName}`));
  candidates.forEach((c) => names.set(`candidate:${c._id}`, `${c.firstName} ${c.lastName}`));
  return names;
}

// Returns { sent, skipped } counts. `now` is injectable for tests.
async function runMessageDigest({ now = new Date() } = {}) {
  if (!inSendWindow(now)) return { sent: 0, skipped: 0, outsideWindow: true };

  const unread = await Message.find({
    readAt: null,
    // Candidates get the weekly emails instead (services/weeklyEmails.js);
    // a daily email to someone away for two weeks would look like spam.
    recipientType: 'recruiter',
    recipientId: { $ne: null },
    sentAt: { $lte: new Date(now.getTime() - MIN_UNREAD_AGE_MS) }
  });

  // Replies to a recruiter's outreach emails waiting in their Mail. Counted
  // per recruiter and never named: the sender and subject are written by an
  // outsider, so they stay out of the email.
  const replies = await MailMessage.find({
    namespace: 'recruiter', direction: 'in', outreachReply: true, flagged: false,
    deletedAt: null, readAt: null,
    receivedAt: { $lte: new Date(now.getTime() - MIN_UNREAD_AGE_MS) }
  });

  if (unread.length === 0 && replies.length === 0) return { sent: 0, skipped: 0 };

  const names = await senderNames(unread);

  // Group by recipient, then by sender.
  const byRecipient = new Map();
  unread.forEach((m) => {
    const key = `${m.recipientType}:${m.recipientId}`;
    if (!byRecipient.has(key)) byRecipient.set(key, { type: m.recipientType, id: m.recipientId, senders: new Map() });

    const senderKey = m.senderType === 'system' ? 'system' : `${m.senderType}:${m.senderId}`;
    const senderName = m.senderType === 'system'
      ? 'PreCheckd Trust & Safety'
      : names.get(senderKey) || 'Someone';

    const senders = byRecipient.get(key).senders;
    if (!senders.has(senderKey)) senders.set(senderKey, { name: senderName, count: 0 });
    senders.get(senderKey).count += 1;
  });

  replies.forEach((m) => {
    const key = `recruiter:${m.ownerId}`;
    if (!byRecipient.has(key)) byRecipient.set(key, { type: 'recruiter', id: m.ownerId, senders: new Map() });
    const senders = byRecipient.get(key).senders;
    if (!senders.has('outreach-replies')) senders.set('outreach-replies', { name: 'Replies to your outreach', count: 0 });
    senders.get('outreach-replies').count += 1;
  });

  let sent = 0;
  let skipped = 0;
  const cutoff = new Date(now.getTime() - MIN_GAP_MS);

  for (const { type, id, senders } of byRecipient.values()) {
    const Model = type === 'recruiter' ? Recruiter : Candidate;

    // Claim today's digest atomically; null back means someone else already
    // did, or one went out too recently.
    const claimFilter = {
      _id: id,
      $or: [{ lastMessageDigestAt: null }, { lastMessageDigestAt: { $lt: cutoff } }]
    };
    if (type === 'recruiter') claimFilter.isSuspended = { $ne: true };

    const account = await Model.findOneAndUpdate(claimFilter, { lastMessageDigestAt: now }, { new: true })
      .select('email firstName');

    if (!account || !account.email) {
      skipped += 1;
      continue;
    }

    try {
      await sendMessageDigestEmail(account.email, account.firstName, [...senders.values()]);
      sent += 1;
    } catch (err) {
      console.error('Failed to send message digest email:', err);
      // Release the claim so the next run can try again.
      await Model.updateOne({ _id: id }, { lastMessageDigestAt: null }).catch(() => {});
      skipped += 1;
    }
  }

  return { sent, skipped };
}

module.exports = { runMessageDigest, inSendWindow, senderNames };
