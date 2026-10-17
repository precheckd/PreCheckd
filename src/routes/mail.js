const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const MailMessage = require('../models/MailMessage');
const MailAlias = require('../models/MailAlias');
const MailReport = require('../models/MailReport');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { addressFor } = require('../utils/mailAlias');
const { warningsFor } = require('../utils/messageSafety');
const OutreachMessage = require('../models/OutreachMessage');
const { ensureMailAlias } = require('../utils/mailAlias');
const outreach = require('../services/outreach');
const { sendReply, replyTarget, isNoReply, DAILY_REPLY_CAP, MAX_REPLY_CHARS } = require('../services/mailReply');

// The merged Inbox + Mail page (roadmap #5 for candidates, #4 for recruiters).
//   LEFT  = verified: conversations with connected PreCheckd members, plus mail
//           from verified recruiters.
//   RIGHT = not verified: all other outside mail; mail our checks flagged sits
//           in a collapsed group at the bottom.
// Recruiters get the same page: LEFT = PreCheckd conversations, RIGHT = outside
// mail, led by replies to their outreach emails. Everything below works on
// req.ns ('candidate' or 'recruiter') so one page serves both.

const LIST_LIMIT = 100;

// Fixed wording for reply problems (never echo anything from the request).
const REPLY_ERRORS = {
  empty: 'Write a message before sending.',
  too_long: `Replies can be up to ${MAX_REPLY_CHARS} characters.`,
  no_reply: 'This sender does not accept replies (it is a no-reply address).',
  unsafe: 'Replies cannot include Social Security, card or bank account numbers. Take those out and try again.',
  blocked: 'We cannot send to this address.',
  rate: `You have reached today's limit of ${DAILY_REPLY_CAP} replies. Try again tomorrow.`,
  send_failed: 'Something went wrong sending your reply. Please try again.'
};

// Candidates and fully set-up recruiters share this page. req.ns / req.ownerId
// say whose mail it is; every query below is scoped to them.
async function requireMember(req, res, next) {
  try {
    if (req.session.candidateId) {
      req.ns = 'candidate';
      req.ownerId = req.session.candidateId;
      return next();
    }
    if (req.session.recruiterId) {
      const recruiter = await Recruiter.findById(req.session.recruiterId);
      if (!recruiter) return res.redirect('/login');
      // A claim account has no PreCheckd address or conversations yet.
      if (recruiter.accountTier === 'unverified_claim') return res.redirect('/recruiter-dashboard/claim');
      req.ns = 'recruiter';
      req.ownerId = req.session.recruiterId;
      return next();
    }
    return res.redirect('/login');
  } catch (error) {
    console.error('Error checking mail access:', error);
    return res.status(500).send('Server error');
  }
}

router.use(requireMember);

function oneLine(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
}

function mailRow(m) {
  return {
    href: `/mail/${m._id}`,
    name: m.fromName || m.fromAddress || 'Unknown sender',
    address: m.fromAddress,
    subject: m.subject || '(no subject)',
    preview: oneLine(m.textBody, 110),
    at: m.receivedAt,
    unread: !m.readAt,
    kind: 'mail',
    recruiterName: m.recruiterName,
    outreachReply: Boolean(m.outreachReply),
    attachmentCount: (m.attachments || []).length,
    trackerPending: Boolean(m.suggestion && m.suggestion.action && m.suggestion.state === 'pending')
  };
}

// One row per accepted connection that has messages, plus Trust & Safety
// dispute messages: the same rows the existing Inbox shows. `type` is who is
// looking ('candidate' or 'recruiter'); the other side of each connection is
// the opposite kind.
async function conversationRows(type, ownerId) {
  const id = ownerId.toString();
  const isRecruiter = type === 'recruiter';
  const connections = await ConnectionRequest.find(
    isRecruiter ? { recruiterId: id, status: 'accepted' } : { candidateId: id, status: 'accepted' }
  ).populate(isRecruiter ? 'candidateId' : 'recruiterId');
  const connById = new Map(connections.map((c) => [c._id.toString(), c]));

  const [convoMessages, disputeMessages] = await Promise.all([
    connections.length > 0
      ? Message.find({ connectionRequestId: { $in: connections.map((c) => c._id) } }).sort({ _id: -1 })
      : [],
    Message.find({ recipientType: type, recipientId: id, fraudReportId: { $ne: null } }).sort({ sentAt: -1 })
  ]);

  const byConn = new Map();
  convoMessages.forEach((m) => {
    const key = m.connectionRequestId.toString();
    if (!byConn.has(key)) byConn.set(key, { last: m, unreadCount: 0 });
    if (!m.readAt && m.recipientType === type && m.recipientId && m.recipientId.toString() === id) {
      byConn.get(key).unreadCount += 1;
    }
  });

  const rows = [];
  byConn.forEach(({ last, unreadCount }, key) => {
    const conn = connById.get(key);
    const other = conn && (isRecruiter ? conn.candidateId : conn.recruiterId);
    if (!other) return;
    const mine = last.senderType === type;
    let preview = last.body;
    if (last.kind === 'contact_request') preview = mine ? 'You asked for contact info' : 'Asked for your contact info';
    else if (last.kind === 'contact_shared') preview = mine ? 'You shared your contact info' : 'Shared their contact info';
    else if (last.kind === 'contact_declined') preview = mine ? 'You chose to keep talking here for now' : 'Would rather keep talking here for now';
    else preview = `${mine ? 'You: ' : ''}${last.body}`;
    rows.push({
      href: `/messages/thread/${key}`,
      name: `${other.firstName} ${other.lastName}`,
      subject: null,
      preview: oneLine(preview, 110),
      at: last.sentAt,
      unread: unreadCount > 0,
      unreadCount,
      kind: 'conversation'
    });
  });

  disputeMessages.forEach((m) => {
    rows.push({
      href: `/messages/${m._id}`,
      name: 'PreCheckd Trust & Safety',
      subject: null,
      preview: oneLine(m.subject || m.body, 110),
      at: m.sentAt,
      unread: !m.readAt,
      unreadCount: m.readAt ? 0 : 1,
      kind: 'conversation'
    });
  });

  return rows;
}

// GET /mail
router.get('/', async (req, res) => {
  try {
    const { ns, ownerId } = req;
    const isRecruiter = ns === 'recruiter';
    const mailFilter = { namespace: ns, ownerId, direction: 'in', deletedAt: null };

    // Banner after deleting or reporting. Undo is offered for a message that
    // belongs to this user and is still in its 30-day window.
    let undo = null;
    if (mongoose.isValidObjectId(req.query.deleted)) {
      const gone = await MailMessage.findOne({
        _id: req.query.deleted, namespace: ns, ownerId, direction: 'in', deletedAt: { $ne: null }
      });
      if (gone) undo = { id: gone._id.toString(), subject: gone.subject || '(no subject)' };
    }
    const reported = req.query.reported === '1';

    const [conversations, verifiedMail, otherMail, flaggedMail, alias] = await Promise.all([
      conversationRows(ns, ownerId),
      MailMessage.find({ ...mailFilter, senderCheck: 'verified_recruiter', flagged: false }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailMessage.find({ ...mailFilter, senderCheck: { $ne: 'verified_recruiter' }, flagged: false }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailMessage.find({ ...mailFilter, flagged: true }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailAlias.findOne({ namespace: ns, ownerId })
    ]);

    // Recruiters have no "verified sender" mail: the left column is PreCheckd
    // conversations only, and replies to their outreach lead the right column.
    const left = [...conversations, ...verifiedMail.map(mailRow)]
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const right = otherMail.map(mailRow);
    if (isRecruiter) right.sort((a, b) => (Number(b.outreachReply) - Number(a.outreachReply)) || (new Date(b.at) - new Date(a.at)));
    const flagged = flaggedMail.map(mailRow);

    const unreadCount = (rows) => rows.filter((r) => r.unread).length;

    res.render('mail', {
      pageTitle: 'Mail | PreCheckd',
      left,
      right,
      flagged,
      leftUnread: left.reduce((n, r) => n + (r.kind === 'conversation' ? (r.unreadCount || 0) : (r.unread ? 1 : 0)), 0),
      rightUnread: unreadCount(right),
      viewer: ns,
      aliasAddress: alias ? addressFor(ns, alias.alias) : null,
      undo,
      reported
    });
  } catch (error) {
    console.error('Error loading mail page:', error);
    res.status(500).send('Server error');
  }
});

// --- New message + Sent (recruiters) -----------------------------------------
// A recruiter's first email to someone not on PreCheckd is written here, from a
// template (services/outreach.js holds every safeguard). Once the person
// replies, the conversation is ordinary Mail.

function recruitersOnly(req, res, next) {
  if (req.ns !== 'recruiter') return res.status(404).send('Not found.');
  next();
}

async function renderCompose(req, res, { error = null, sent = false, form = {}, statusCode = 200 } = {}) {
  const recruiter = await Recruiter.findById(req.ownerId);
  if (!recruiter) return res.redirect('/login');
  const quota = await outreach.quotaFor(recruiter._id);
  return res.status(statusCode).render('mail-compose', {
    pageTitle: 'New message | PreCheckd',
    enabled: outreach.enabled(),
    verified: outreach.isFullyVerified(recruiter),
    quota, error, sent, form,
    templates: Object.entries(outreach.TEMPLATES).map(([key, t]) => ({ key, label: t.label, needsRole: t.needsRole })),
    maxNote: outreach.MAX_NOTE_CHARS
  });
}

router.get('/new', recruitersOnly, async (req, res) => {
  try {
    return await renderCompose(req, res, { sent: req.query.sent === '1' });
  } catch (error) {
    console.error('Error loading new message page:', error);
    return res.status(500).send('Server error');
  }
});

router.post('/new', recruitersOnly, async (req, res) => {
  try {
    const recruiter = await Recruiter.findById(req.ownerId);
    if (!recruiter) return res.redirect('/login');
    const body = req.body || {};
    const form = {
      toEmail: String(body.toEmail || '').slice(0, 254), toName: String(body.toName || '').slice(0, 40),
      templateKey: String(body.templateKey || ''), role: String(body.role || '').slice(0, 80), note: String(body.note || '').slice(0, 5000)
    };
    let alias = null;
    try { alias = await ensureMailAlias('recruiter', recruiter); } catch (e) { alias = null; }
    const result = await outreach.sendOutreach({ recruiter, alias, input: form });
    if (result.error) {
      return await renderCompose(req, res, { error: result.message || outreach.OUTREACH_ERRORS[result.error] || 'Something went wrong.', form, statusCode: 400 });
    }
    return res.redirect('/mail/new?sent=1');
  } catch (error) {
    console.error('Error sending new message:', error);
    return res.status(500).send('Server error');
  }
});

router.get('/sent', recruitersOnly, async (req, res) => {
  try {
    const sent = await OutreachMessage.find({ recruiterId: req.ownerId, status: 'sent' }).sort({ sentAt: -1 }).limit(100);
    const replies = sent.length
      ? await MailMessage.find({
        namespace: 'recruiter', ownerId: req.ownerId, direction: 'in', outreachReply: true, deletedAt: null,
        fromAddress: { $in: sent.map((m) => m.toEmail) }
      }).sort({ receivedAt: -1 })
      : [];
    const replyBy = new Map();
    replies.forEach((r) => { if (!replyBy.has(r.fromAddress)) replyBy.set(r.fromAddress, r); });
    res.render('mail-sent', {
      pageTitle: 'Sent | PreCheckd',
      enabled: outreach.enabled(),
      rows: sent.map((m) => {
        const reply = replyBy.get(m.toEmail);
        return {
          to: m.toEmail, subject: m.subject, at: m.sentAt,
          status: m.recipientAction ? outreach.STATUS_NOTE[m.recipientAction] : '',
          replyId: reply ? reply._id.toString() : null
        };
      })
    });
  } catch (error) {
    console.error('Error loading sent mail:', error);
    res.status(500).send('Server error');
  }
});

// Loads one of this member's received messages (not deleted, not a sent reply).
function findMine(req, extra = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return MailMessage.findOne({
    _id: req.params.id,
    namespace: req.ns,
    ownerId: req.ownerId,
    direction: 'in',
    ...extra
  });
}

async function renderMessage(req, res, message, { error = null, draft = '', status = 200 } = {}) {
  const replies = await MailMessage.find({
    namespace: req.ns,
    ownerId: req.ownerId,
    direction: 'out',
    inReplyToMailId: message._id,
    deletedAt: null
  }).sort({ receivedAt: 1 });
  // For a reply to outreach: what the recruiter originally sent that address.
  let outreachSent = null;
  if (req.ns === 'recruiter' && message.outreachReply && message.fromAddress) {
    const o = await OutreachMessage.findOne({ recruiterId: req.ownerId, toEmail: message.fromAddress, status: 'sent' }).sort({ sentAt: -1 });
    if (o) outreachSent = { subject: o.subject, at: o.sentAt, note: o.note || '' };
  }
  const target = replyTarget(message);
  res.status(status).render('mail-detail', {
    outreachSent,
    pageTitle: `${message.subject || 'Message'} | PreCheckd`,
    viewer: req.ns,
    message,
    warnings: warningsFor(message.textBody),
    replies,
    canReply: Boolean(target) && !isNoReply(target),
    replyError: error,
    replySent: req.query.sent === '1',
    replyDemo: req.query.demo === '1',
    draft
  });
}

// GET /mail/:id — one received message (marks it read)
router.get('/:id', async (req, res) => {
  try {
    const message = await findMine(req, { deletedAt: null });
    if (!message) return res.status(404).send('Message not found.');

    if (!message.readAt) {
      message.readAt = new Date();
      await message.save();
    }
    await renderMessage(req, res, message);
  } catch (error) {
    console.error('Error loading mail message:', error);
    res.status(500).send('Server error');
  }
});

// POST /mail/:id/delete — hidden at once; removed for good ~30 days later.
router.post('/:id/delete', async (req, res) => {
  try {
    const message = await findMine(req, { deletedAt: null });
    if (!message) return res.status(404).send('Message not found.');
    message.deletedAt = new Date();
    if (!message.readAt) message.readAt = message.deletedAt;
    await message.save();
    res.redirect(`/mail?deleted=${message._id}`);
  } catch (error) {
    console.error('Error deleting mail message:', error);
    res.status(500).send('Server error');
  }
});

// POST /mail/:id/restore — undo a delete
router.post('/:id/restore', async (req, res) => {
  try {
    const message = await findMine(req, { deletedAt: { $ne: null } });
    if (!message) return res.status(404).send('Message not found.');
    message.deletedAt = null;
    await message.save();
    res.redirect(`/mail/${message._id}`);
  } catch (error) {
    console.error('Error restoring mail message:', error);
    res.status(500).send('Server error');
  }
});

// POST /mail/:id/report — report the sender as a scam: this person never gets
// mail from that address again, earlier mail from it is hidden, and staff get a
// record to review. It does not block the sender for anyone else.
router.post('/:id/report', async (req, res) => {
  try {
    const message = await findMine(req, { deletedAt: null });
    if (!message) return res.status(404).send('Message not found.');

    const fromAddress = String(message.fromAddress || '').toLowerCase();
    if (fromAddress.includes('@')) {
      await MailReport.updateOne(
        { namespace: req.ns, ownerId: message.ownerId, fromAddress },
        {
          $setOnInsert: {
            namespace: req.ns,
            ownerId: message.ownerId,
            fromAddress,
            fromDomain: fromAddress.split('@')[1],
            subject: String(message.subject || '').slice(0, 300),
            senderCheck: message.senderCheck,
            status: 'new'
          }
        },
        { upsert: true }
      );
      await MailMessage.updateMany(
        { namespace: req.ns, ownerId: message.ownerId, direction: 'in', fromAddress, deletedAt: null },
        { $set: { deletedAt: new Date() } }
      );
    }
    res.redirect('/mail?reported=1');
  } catch (error) {
    console.error('Error reporting mail message:', error);
    res.status(500).send('Server error');
  }
});

// POST /mail/:id/reply { body } — sent from the PreCheckd address to whoever
// wrote to you (for a recruiter, usually someone answering their outreach). Nothing about the recipient comes from the request.
router.post('/:id/reply', async (req, res) => {
  try {
    const message = await findMine(req, { deletedAt: null });
    if (!message) return res.status(404).send('Message not found.');

    const body = typeof req.body.body === 'string' ? req.body.body : '';
    const [owner, alias] = await Promise.all([
      (req.ns === 'recruiter' ? Recruiter : Candidate).findById(req.ownerId),
      MailAlias.findOne({ namespace: req.ns, ownerId: req.ownerId, status: 'active' })
    ]);
    if (!owner || !alias) {
      return renderMessage(req, res, message, { error: REPLY_ERRORS.send_failed, draft: body, status: 400 });
    }

    const result = await sendReply({ message, owner, alias, body });
    if (result.error) {
      return renderMessage(req, res, message, {
        error: REPLY_ERRORS[result.error] || REPLY_ERRORS.send_failed,
        draft: body,
        status: 400
      });
    }
    res.redirect(`/mail/${message._id}?sent=1${result.demo ? '&demo=1' : ''}`);
  } catch (error) {
    console.error('Error replying to mail message:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
