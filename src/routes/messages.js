const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const { sendNewMessageEmail } = require('../services/emailService');
const {
  CONTACT_WARNING_TITLE,
  CONTACT_WARNING_POINTS,
  otherSide,
  hasSharedAnything
} = require('../utils/contactSharing');

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


// --- Contact-info request flow -------------------------------------------
// Contact details stay hidden after a connection is accepted. Either side
// can ask for the other's email/phone from here, after a warning that
// moving off PreCheckd drops its protections; the other chooses what to
// share (or "Not now"). The request and the answer travel as messages so
// they use the existing unread badge and notification email.

// Loads the accepted connection and works out who the current user and the
// other party are. Returns null if the user isn't a party to it.
async function loadContactContext(req, connectionRequestId) {
  if (!connectionRequestId) return null;

  const connection = await ConnectionRequest.findById(connectionRequestId).catch(() => null);
  if (!connection || connection.status !== 'accepted') return null;

  const { type, id } = req.currentUser;
  const isRecruiterParty = type === 'recruiter' && connection.recruiterId.toString() === id;
  const isCandidateParty = type === 'candidate' && connection.candidateId.toString() === id;
  if (!isRecruiterParty && !isCandidateParty) return null;

  const otherType = otherSide(type);
  const otherId = type === 'recruiter' ? connection.candidateId : connection.recruiterId;
  const OtherModel = otherType === 'recruiter' ? Recruiter : Candidate;
  const SelfModel = type === 'recruiter' ? Recruiter : Candidate;

  const [other, self] = await Promise.all([
    OtherModel.findById(otherId).select('firstName lastName isSuspended'),
    SelfModel.findById(id).select('firstName lastName email phone')
  ]);

  if (!other || !self || (otherType === 'recruiter' && other.isSuspended)) return null;

  return { connection, type, id, otherType, otherId, other, self };
}

async function sendContactNotice({ ctx, kind, subject, body }) {
  const message = await Message.create({
    connectionRequestId: ctx.connection._id,
    senderType: ctx.type,
    senderId: ctx.id,
    recipientType: ctx.otherType,
    recipientId: ctx.otherId,
    kind,
    subject,
    body
  });

  const RecipientModel = ctx.otherType === 'recruiter' ? Recruiter : Candidate;
  const recipient = await RecipientModel.findById(ctx.otherId).select('email firstName');
  if (recipient) {
    sendNewMessageEmail(
      recipient.email,
      recipient.firstName,
      `${ctx.self.firstName} ${ctx.self.lastName}`,
      subject
    ).catch((err) => {
      console.error('Failed to send contact notice email:', err);
    });
  }

  return message;
}

// GET /messages/contact/request — warning + confirm screen
router.get('/contact/request', async (req, res) => {
  try {
    const ctx = await loadContactContext(req, req.query.connectionRequestId);
    if (!ctx) return res.status(403).send('Not authorized.');

    // Nothing to ask for if they've already shared, or you've already asked.
    const alreadyShared = hasSharedAnything(ctx.connection, ctx.otherType);
    const alreadyRequested =
      ctx.connection.contactRequestStatus === 'requested' && ctx.connection.contactRequestedBy === ctx.type;
    const theyAsked =
      ctx.connection.contactRequestStatus === 'requested' && ctx.connection.contactRequestedBy === ctx.otherType;

    res.render('contact-request', {
      connectionRequestId: ctx.connection._id.toString(),
      otherName: `${ctx.other.firstName} ${ctx.other.lastName}`,
      warningTitle: CONTACT_WARNING_TITLE,
      warningPoints: CONTACT_WARNING_POINTS,
      alreadyShared,
      alreadyRequested,
      theyAsked,
      currentUserType: ctx.type
    });
  } catch (error) {
    console.error('Error loading contact request page:', error);
    res.status(500).send('Server error');
  }
});

// POST /messages/contact/request — send the request
router.post('/contact/request', async (req, res) => {
  try {
    const ctx = await loadContactContext(req, req.body.connectionRequestId);
    if (!ctx) return res.status(403).send('Not authorized.');

    const { connection } = ctx;

    if (hasSharedAnything(connection, ctx.otherType)) {
      return res.redirect('/connections');
    }

    if (connection.contactRequestStatus === 'requested') {
      // Already open — either you asked, or they did and are waiting on you.
      return res.redirect(connection.contactRequestedBy === ctx.type ? '/connections' : '/messages');
    }

    connection.contactRequestStatus = 'requested';
    connection.contactRequestedBy = ctx.type;
    connection.contactRequestedAt = new Date();
    await connection.save();

    await sendContactNotice({
      ctx,
      kind: 'contact_request',
      subject: 'Contact info request',
      body: `${ctx.self.firstName} ${ctx.self.lastName} would like to exchange contact details outside PreCheckd. ` +
        'You decide what, if anything, to share — you can also choose "Not now" and keep talking here.'
    });

    res.redirect('/messages/sent');
  } catch (error) {
    console.error('Error sending contact request:', error);
    res.status(500).send('Server error');
  }
});

// POST /messages/contact/respond — the person who was asked shares or declines
router.post('/contact/respond', async (req, res) => {
  try {
    const ctx = await loadContactContext(req, req.body.connectionRequestId);
    if (!ctx) return res.status(403).send('Not authorized.');

    const { connection } = ctx;

    // Only the person who was asked can answer, and only while it's open.
    if (connection.contactRequestStatus !== 'requested' || connection.contactRequestedBy === ctx.type) {
      return res.status(400).send('There is no open contact request to answer.');
    }

    if (req.body.action === 'share') {
      const shareEmail = req.body.shareEmail === 'on';
      const sharePhone = req.body.sharePhone === 'on' && Boolean(ctx.self.phone);

      if (!shareEmail && !sharePhone) {
        return res.status(400).send('Choose at least one thing to share, or pick "Not now".');
      }

      connection.contactShared[ctx.type] = {
        email: shareEmail,
        phone: sharePhone,
        sharedAt: new Date()
      };
      connection.contactRequestStatus = 'none';
      connection.contactRequestedBy = null;
      connection.markModified('contactShared');
      await connection.save();

      await sendContactNotice({
        ctx,
        kind: 'contact_shared',
        subject: 'Contact info shared',
        body: `${ctx.self.firstName} ${ctx.self.lastName} shared their contact details with you. You'll find them under Connections.`
      });

      return res.redirect('/connections');
    }

    if (req.body.action === 'decline') {
      connection.contactRequestStatus = 'declined';
      connection.contactRequestedBy = null;
      await connection.save();

      await sendContactNotice({
        ctx,
        kind: 'contact_declined',
        subject: 'Contact info request',
        body: `${ctx.self.firstName} ${ctx.self.lastName} would rather keep talking on PreCheckd for now.`
      });

      return res.redirect('/messages');
    }

    res.status(400).send('Unknown action.');
  } catch (error) {
    console.error('Error responding to contact request:', error);
    res.status(500).send('Server error');
  }
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

    // An open contact request shows Share / Not now for its recipient.
    let contactPrompt = null;
    if (message.kind === 'contact_request' && message.connectionRequestId) {
      const ctx = await loadContactContext(req, message.connectionRequestId);
      if (
        ctx &&
        ctx.connection.contactRequestStatus === 'requested' &&
        ctx.connection.contactRequestedBy === ctx.otherType
      ) {
        contactPrompt = {
          connectionRequestId: ctx.connection._id.toString(),
          warningTitle: CONTACT_WARNING_TITLE,
          warningPoints: CONTACT_WARNING_POINTS,
          ownEmail: ctx.self.email,
          ownPhone: ctx.self.phone || null
        };
      }
    }

    res.render('message-detail', {
      message,
      senderName,
      senderUnavailable,
      contactPrompt,
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