const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const MailMessage = require('../models/MailMessage');
const MailAlias = require('../models/MailAlias');
const MailReport = require('../models/MailReport');
const Candidate = require('../models/Candidate');
const { addressFor } = require('../utils/mailAlias');
const { warningsFor } = require('../utils/messageSafety');
const { sendReply, replyTarget, isNoReply, DAILY_REPLY_CAP, MAX_REPLY_CHARS } = require('../services/mailReply');

// The merged Inbox + Mail page (roadmap #5), candidate side first.
//   LEFT  = verified: conversations with connected PreCheckd members, plus mail
//           from verified recruiters.
//   RIGHT = not verified: all other outside mail; mail our checks flagged sits
//           in a collapsed group at the bottom.
// The existing /messages Inbox stays as it is until this page replaces it.

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

function requireCandidate(req, res, next) {
  if (req.session.candidateId) return next();
  if (req.session.recruiterId) return res.redirect('/messages');
  return res.redirect('/login');
}

router.use(requireCandidate);

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
    attachmentCount: (m.attachments || []).length,
    trackerPending: Boolean(m.suggestion && m.suggestion.action && m.suggestion.state === 'pending')
  };
}

// One row per accepted connection that has messages, plus Trust & Safety
// dispute messages: the same rows the existing Inbox shows.
async function conversationRows(candidateId) {
  const id = candidateId.toString();
  const connections = await ConnectionRequest.find({ candidateId: id, status: 'accepted' }).populate('recruiterId');
  const connById = new Map(connections.map((c) => [c._id.toString(), c]));

  const [convoMessages, disputeMessages] = await Promise.all([
    connections.length > 0
      ? Message.find({ connectionRequestId: { $in: connections.map((c) => c._id) } }).sort({ _id: -1 })
      : [],
    Message.find({ recipientType: 'candidate', recipientId: id, fraudReportId: { $ne: null } }).sort({ sentAt: -1 })
  ]);

  const byConn = new Map();
  convoMessages.forEach((m) => {
    const key = m.connectionRequestId.toString();
    if (!byConn.has(key)) byConn.set(key, { last: m, unreadCount: 0 });
    if (!m.readAt && m.recipientType === 'candidate' && m.recipientId && m.recipientId.toString() === id) {
      byConn.get(key).unreadCount += 1;
    }
  });

  const rows = [];
  byConn.forEach(({ last, unreadCount }, key) => {
    const conn = connById.get(key);
    const other = conn && conn.recruiterId;
    if (!other) return;
    const mine = last.senderType === 'candidate';
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
    const ownerId = req.session.candidateId;
    const mailFilter = { namespace: 'candidate', ownerId, direction: 'in', deletedAt: null };

    // Banner after deleting or reporting. Undo is offered for a message that
    // belongs to this user and is still in its 30-day window.
    let undo = null;
    if (mongoose.isValidObjectId(req.query.deleted)) {
      const gone = await MailMessage.findOne({
        _id: req.query.deleted, namespace: 'candidate', ownerId, direction: 'in', deletedAt: { $ne: null }
      });
      if (gone) undo = { id: gone._id.toString(), subject: gone.subject || '(no subject)' };
    }
    const reported = req.query.reported === '1';

    const [conversations, verifiedMail, otherMail, flaggedMail, alias] = await Promise.all([
      conversationRows(ownerId),
      MailMessage.find({ ...mailFilter, senderCheck: 'verified_recruiter', flagged: false }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailMessage.find({ ...mailFilter, senderCheck: { $ne: 'verified_recruiter' }, flagged: false }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailMessage.find({ ...mailFilter, flagged: true }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailAlias.findOne({ namespace: 'candidate', ownerId })
    ]);

    const left = [...conversations, ...verifiedMail.map(mailRow)]
      .sort((a, b) => new Date(b.at) - new Date(a.at));
    const right = otherMail.map(mailRow);
    const flagged = flaggedMail.map(mailRow);

    const unreadCount = (rows) => rows.filter((r) => r.unread).length;

    res.render('mail', {
      pageTitle: 'Mail | PreCheckd',
      left,
      right,
      flagged,
      leftUnread: left.reduce((n, r) => n + (r.kind === 'conversation' ? (r.unreadCount || 0) : (r.unread ? 1 : 0)), 0),
      rightUnread: unreadCount(right),
      aliasAddress: alias ? addressFor('candidate', alias.alias) : null,
      undo,
      reported
    });
  } catch (error) {
    console.error('Error loading mail page:', error);
    res.status(500).send('Server error');
  }
});

// Loads one of this candidate's received messages (not deleted, not a sent reply).
function findMine(req, extra = {}) {
  if (!mongoose.isValidObjectId(req.params.id)) return null;
  return MailMessage.findOne({
    _id: req.params.id,
    namespace: 'candidate',
    ownerId: req.session.candidateId,
    direction: 'in',
    ...extra
  });
}

async function renderMessage(req, res, message, { error = null, draft = '', status = 200 } = {}) {
  const replies = await MailMessage.find({
    namespace: 'candidate',
    ownerId: req.session.candidateId,
    direction: 'out',
    inReplyToMailId: message._id,
    deletedAt: null
  }).sort({ receivedAt: 1 });
  const target = replyTarget(message);
  res.status(status).render('mail-detail', {
    pageTitle: `${message.subject || 'Message'} | PreCheckd`,
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
        { namespace: 'candidate', ownerId: message.ownerId, fromAddress },
        {
          $setOnInsert: {
            namespace: 'candidate',
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
        { namespace: 'candidate', ownerId: message.ownerId, direction: 'in', fromAddress, deletedAt: null },
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
// wrote to you. Nothing about the recipient comes from the request.
router.post('/:id/reply', async (req, res) => {
  try {
    const message = await findMine(req, { deletedAt: null });
    if (!message) return res.status(404).send('Message not found.');

    const body = typeof req.body.body === 'string' ? req.body.body : '';
    const [owner, alias] = await Promise.all([
      Candidate.findById(req.session.candidateId),
      MailAlias.findOne({ namespace: 'candidate', ownerId: req.session.candidateId, status: 'active' })
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
