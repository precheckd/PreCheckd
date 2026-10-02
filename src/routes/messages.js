const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { sendNewMessageEmail } = require('../services/emailService');

function getCurrentUser(req) {
  if (req.session.recruiterId) {
    return { type: 'recruiter', id: req.session.recruiterId };
  }
  if (req.session.candidateId) {
    return { type: 'candidate', id: req.session.candidateId };
  }
  return null;
}

function requireLoggedIn(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(403).send('You must be logged in to view this page.');
  }
  req.currentUser = user;
  next();
}

router.use(requireLoggedIn);

// GET /messages — inbox for whichever user type is logged in
router.get('/', async (req, res) => {
  try {
    const { type, id } = req.currentUser;

    const messages = await Message.find({ recipientType: type, recipientId: id })
      .sort({ sentAt: -1 });

    const messagesForView = await Promise.all(messages.map(async (m) => {
      let senderName = 'Unknown';
      let senderSlug = null;

      if (m.senderType === 'system') {
        senderName = 'PreCheckd Trust & Safety';
      } else if (m.senderType === 'recruiter') {
        const sender = await Recruiter.findById(m.senderId).select('firstName lastName slug');
        if (sender) {
          senderName = `${sender.firstName} ${sender.lastName}`;
          senderSlug = sender.slug;
        }
      } else {
        const sender = await Candidate.findById(m.senderId).select('firstName lastName slug');
        if (sender) {
          senderName = `${sender.firstName} ${sender.lastName}`;
          senderSlug = sender.slug;
        }
      }

      return {
        _id: m._id,
        subject: m.subject,
        body: m.body,
        sentAt: m.sentAt,
        readAt: m.readAt,
        senderType: m.senderType,
        senderName,
        senderSlug,
        connectionRequestId: m.connectionRequestId
      };
    }));

    res.render('inbox', { messages: messagesForView, currentUserType: type });
  } catch (error) {
    console.error('Error loading inbox:', error);
    res.status(500).send('Server error');
  }
});

// GET /messages/compose — blank compose form, tied to an accepted connection
router.get('/compose', async (req, res) => {
  try {
    const { type, id } = req.currentUser;
    const { connectionRequestId } = req.query;

    if (!connectionRequestId) {
      return res.status(400).send('Missing connection request.');
    }

    const connection = await ConnectionRequest.findById(connectionRequestId);

    if (!connection || connection.status !== 'accepted') {
      return res.status(403).send('You can only message someone through an accepted connection.');
    }

    const isRecruiterParty = type === 'recruiter' && connection.recruiterId.toString() === id;
    const isCandidateParty = type === 'candidate' && connection.candidateId.toString() === id;

    if (!isRecruiterParty && !isCandidateParty) {
      return res.status(403).send('Not authorized to message on this connection.');
    }

    const recipientType = type === 'recruiter' ? 'candidate' : 'recruiter';
    const recipientId = type === 'recruiter' ? connection.candidateId : connection.recruiterId;
    const RecipientModel = recipientType === 'recruiter' ? Recruiter : Candidate;
    const recipient = await RecipientModel.findById(recipientId).select('firstName lastName isSuspended');

    if (!recipient || (recipientType === 'recruiter' && recipient.isSuspended)) {
      return res.status(404).send('Recipient not found.');
    }

    res.render('message-compose', {
      connectionRequestId,
      recipientName: `${recipient.firstName} ${recipient.lastName}`
    });
  } catch (error) {
    console.error('Error loading compose page:', error);
    res.status(500).send('Server error');
  }
});

// GET /messages/sent — simple confirmation shown to the sender after sending
router.get('/sent', (req, res) => {
  res.render('message-sent', { currentUserType: req.currentUser.type });
});

// GET /messages/:id — view a single message, marks it read
router.get('/:id', async (req, res) => {
  try {
    const { type, id } = req.currentUser;
    const message = await Message.findById(req.params.id);

    if (!message || message.recipientType !== type || message.recipientId.toString() !== id) {
      return res.status(403).send('Not authorized to view this message.');
    }

    if (!message.readAt) {
      message.readAt = new Date();
      await message.save();
    }

    let senderName = 'Unknown';
    // Whoever is viewing this is always the recipient here, so the sender
    // is always the other party in the thread — the one they'd reply to.
    // If that's a recruiter who's since gone inactive or been suspended,
    // flag it so the reply form can be swapped for an explanation instead
    // of a reply that would otherwise silently 404. Deliberately the same
    // message either way — nothing here distinguishes "deactivated" from
    // "suspended for fraud."
    let senderUnavailable = false;
    if (message.senderType === 'system') {
      senderName = 'PreCheckd Trust & Safety';
    } else if (message.senderType === 'recruiter') {
      const sender = await Recruiter.findById(message.senderId).select('firstName lastName isActive isSuspended');
      if (sender) {
        senderName = `${sender.firstName} ${sender.lastName}`;
        senderUnavailable = !sender.isActive || sender.isSuspended;
      }
    } else {
      const sender = await Candidate.findById(message.senderId).select('firstName lastName');
      if (sender) senderName = `${sender.firstName} ${sender.lastName}`;
    }

    res.render('message-detail', {
      message,
      senderName,
      senderUnavailable,
      currentUserType: type
    });
  } catch (error) {
    console.error('Error loading message:', error);
    res.status(500).send('Server error');
  }
});

// POST /messages/send — send a new message, tied to an accepted connection,
// or a reply in a fraud-dispute thread (tied to a fraudReportId instead)
router.post('/send', async (req, res) => {
  try {
    const { type, id } = req.currentUser;
    const { connectionRequestId, fraudReportId, subject, body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).send('Message body is required.');
    }

    // --- Dispute-thread reply: addressed to the system mailbox, not a
    // real recipient. Only a recruiter can be party to one of these (a
    // claim account has no inbox access at all, and a dispute thread is
    // always about a recruiter's own account), and only if they're
    // actually the recruiter this specific thread belongs to — checked
    // against an existing message in the thread rather than trusting the
    // posted fraudReportId on its own.
    if (fraudReportId) {
      if (type !== 'recruiter') {
        return res.status(403).send('Not authorized to reply to this thread.');
      }

      const ownsThread = await Message.findOne({ fraudReportId, recipientType: 'recruiter', recipientId: id });
      if (!ownsThread) {
        return res.status(403).send('Not authorized to reply to this thread.');
      }

      await Message.create({
        fraudReportId,
        senderType: 'recruiter',
        senderId: id,
        recipientType: 'system',
        subject: subject && subject.trim() ? subject.trim() : null,
        body: body.trim()
      });

      // No recipient email to fire here — staff checks dispute replies
      // from the internal dashboard rather than getting pinged per-reply.
      return res.redirect('/messages/sent');
    }

    const connection = await ConnectionRequest.findById(connectionRequestId);

    if (!connection || connection.status !== 'accepted') {
      return res.status(403).send('You can only message someone through an accepted connection.');
    }

    const isRecruiterParty = type === 'recruiter' && connection.recruiterId.toString() === id;
    const isCandidateParty = type === 'candidate' && connection.candidateId.toString() === id;

    if (!isRecruiterParty && !isCandidateParty) {
      return res.status(403).send('Not authorized to message on this connection.');
    }

    const recipientType = type === 'recruiter' ? 'candidate' : 'recruiter';
    const recipientId = type === 'recruiter' ? connection.candidateId : connection.recruiterId;

    if (recipientType === 'recruiter') {
      const recipientRecruiter = await Recruiter.findById(recipientId).select('isSuspended');
      if (!recipientRecruiter || recipientRecruiter.isSuspended) {
        return res.status(404).send('Recipient not found.');
      }
    }

    const message = await Message.create({
      connectionRequestId,
      senderType: type,
      senderId: id,
      recipientType,
      recipientId,
      subject: subject && subject.trim() ? subject.trim() : null,
      body: body.trim()
    });

    const RecipientModel = recipientType === 'recruiter' ? Recruiter : Candidate;
    const recipient = await RecipientModel.findById(recipientId).select('email firstName');
    const SenderModel = type === 'recruiter' ? Recruiter : Candidate;
    const sender = await SenderModel.findById(id).select('firstName lastName');

    if (recipient) {
      sendNewMessageEmail(
        recipient.email,
        recipient.firstName,
        sender ? `${sender.firstName} ${sender.lastName}` : 'Someone',
        message.subject
      ).catch((err) => {
        console.error('Failed to send new message notification email:', err);
      });
    }

    // Redirect the sender to a confirmation page — the sender is never
    // the recipient, so redirecting to the message detail view (which is
    // recipient-only) would always deny them access.
    res.redirect('/messages/sent');
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;