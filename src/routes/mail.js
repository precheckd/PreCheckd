const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const MailMessage = require('../models/MailMessage');
const MailAlias = require('../models/MailAlias');
const { addressFor } = require('../utils/mailAlias');
const { warningsFor } = require('../utils/messageSafety');

// The merged Inbox + Mail page (roadmap #5), candidate side first.
//   LEFT  = verified: conversations with connected PreCheckd members, plus mail
//           from verified recruiters.
//   RIGHT = not verified: all other outside mail; mail our checks flagged sits
//           in a collapsed group at the bottom.
// The existing /messages Inbox stays as it is until this page replaces it.

const LIST_LIMIT = 100;

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
    attachmentCount: (m.attachments || []).length
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
    const mailFilter = { namespace: 'candidate', ownerId, direction: 'in' };

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
      aliasAddress: alias ? addressFor('candidate', alias.alias) : null
    });
  } catch (error) {
    console.error('Error loading mail page:', error);
    res.status(500).send('Server error');
  }
});

// GET /mail/:id — one received message (marks it read)
router.get('/:id', async (req, res) => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).send('Message not found.');
    const message = await MailMessage.findOne({
      _id: req.params.id,
      namespace: 'candidate',
      ownerId: req.session.candidateId
    });
    if (!message) return res.status(404).send('Message not found.');

    if (!message.readAt) {
      message.readAt = new Date();
      await message.save();
    }

    res.render('mail-detail', {
      pageTitle: `${message.subject || 'Message'} | PreCheckd`,
      message,
      warnings: warningsFor(message.textBody)
    });
  } catch (error) {
    console.error('Error loading mail message:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;
