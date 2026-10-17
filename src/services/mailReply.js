// Replying to a received message from the owner's PreCheckd Mail (roadmap #5).
//
// The reply is sent FROM the owner's PreCheckd address, so their real email is
// never exposed, and ONLY to the person who wrote to them: the recipient is
// taken from the stored message, never from the request. There is no "new
// message" form, which keeps a PreCheckd address from being used to spam
// strangers. Replies pass the same safety check as in-site messages (no SSNs,
// card or bank details) and are capped per day.
const { Resend } = require('resend');
const MailMessage = require('../models/MailMessage');
const Suppression = require('../models/Suppression');
const { checkOutgoing } = require('../utils/messageSafety');
const { addressFor } = require('../utils/mailAlias');
const { safeDisplayName } = require('./inboundEmail');

const resend = new Resend(process.env.RESEND_API_KEY);
const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';
const DAILY_REPLY_CAP = Number(process.env.MAIL_REPLY_DAILY_CAP) || 20;
const MAX_REPLY_CHARS = 5000;

const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|donotreply|mailer-daemon|postmaster|bounces?)([-_.+].*)?$/i;

// Where a reply to this message would go.
function replyTarget(message) {
  return String(message.replyTo || message.fromAddress || '').trim().toLowerCase();
}

// True when nobody reads the target mailbox (no-reply senders).
function isNoReply(address) {
  const local = String(address || '').split('@')[0];
  return !local || NO_REPLY.test(local);
}

function subjectFor(subject) {
  const s = String(subject || '').trim() || '(no subject)';
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

// Result: { ok: true, demo?: true } or { error: <code>, message?: <text> }.
// `owner` needs firstName/lastName; `alias` is the owner's MailAlias row.
async function sendReply({ message, owner, alias, body }) {
  const text = String(body || '').trim();
  if (!text) return { error: 'empty' };
  if (text.length > MAX_REPLY_CHARS) return { error: 'too_long' };

  const to = replyTarget(message);
  if (!to.includes('@') || isNoReply(to)) return { error: 'no_reply' };

  const unsafe = checkOutgoing(text);
  if (unsafe) return { error: 'unsafe', message: unsafe.message };

  const domain = to.split('@')[1];
  if (await Suppression.findOne({ value: { $in: [to, domain] } })) return { error: 'blocked' };

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sentToday = await MailMessage.countDocuments({
    namespace: message.namespace, ownerId: message.ownerId, direction: 'out', composed: { $ne: true }, receivedAt: { $gte: since }
  });
  if (sentToday >= DAILY_REPLY_CAP) return { error: 'rate' };

  // Sample messages are not real senders: nothing is sent.
  if (message.isDemo) return { ok: true, demo: true };

  const fromAddress = addressFor(message.namespace, alias.alias);
  const displayName = safeDisplayName([owner.firstName, owner.lastName].filter(Boolean).join(' '), alias.alias);
  const subject = subjectFor(message.subject);

  const headers = {};
  if (message.messageIdHeader) {
    headers['In-Reply-To'] = message.messageIdHeader;
    headers.References = [message.referencesHeader, message.messageIdHeader].filter(Boolean).join(' ').slice(-1500);
  }

  if (MOCK_EMAIL) {
    console.log(`[MOCK EMAIL] reply from ${fromAddress} to ${to} | ${subject}`);
  } else {
    const { error } = await resend.emails.send({
      from: `${displayName} <${fromAddress}>`,
      to,
      replyTo: fromAddress,
      subject,
      text,
      headers
    });
    if (error) {
      console.error('[mail] reply send failed:', error.message || error.name);
      return { error: 'send_failed' };
    }
  }

  await MailMessage.create({
    namespace: message.namespace,
    ownerId: message.ownerId,
    aliasId: alias._id,
    direction: 'out',
    fromAddress,
    fromName: displayName,
    toAddress: to,
    subject,
    textBody: text,
    inReplyToMailId: message._id,
    readAt: new Date(),
    receivedAt: new Date()
  });
  return { ok: true };
}

module.exports = { sendReply, replyTarget, isNoReply, subjectFor, DAILY_REPLY_CAP, MAX_REPLY_CHARS };
