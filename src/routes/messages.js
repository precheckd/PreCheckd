const express = require('express');
const router = express.Router();
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const {
  CONTACT_WARNING_TITLE,
  CONTACT_WARNING_POINTS,
  otherSide
} = require('../utils/contactSharing');
const {
  loadConversationContext,
  messageToJson,
  contactSummary,
  fetchMessages,
  markThreadRead,
  buildPane,
  sendThreadMessage,
  requestContact,
  respondToContactRequest
} = require('../utils/conversation');
const { checkOutgoing, warningsFor } = require('../utils/messageSafety');

// Messages no longer trigger a notification email each — unread messages go
// out in a once-a-day digest instead (see services/messageDigest.js), so a
// back-and-forth doesn't turn into a pile of emails.

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
    if (req.path.endsWith('/poll') || req.method === 'POST') {
      return res.status(403).json({ error: 'You must be logged in.' });
    }
    return res.status(403).send('You must be logged in to view this page.');
  }
  req.currentUser = user;
  next();
}

router.use(requireLoggedIn);

// What to show as a conversation's one-line preview.
function previewFor(m, meType, meId) {
  const mine = m.senderType === meType && m.senderId && m.senderId.toString() === meId;
  if (m.kind === 'contact_request') return mine ? 'You asked for contact info' : 'Asked for your contact info';
  if (m.kind === 'contact_shared') return mine ? 'You shared your contact info' : 'Shared their contact info';
  if (m.kind === 'contact_declined') return mine ? 'You chose to keep talking here for now' : 'Would rather keep talking here for now';
  return `${mine ? 'You: ' : ''}${m.body}`;
}

// GET /messages — inbox: one row per conversation (accepted connection that
// has messages), plus any Trust & Safety dispute messages, newest first.
router.get('/', async (req, res) => {
  try {
    const { type, id } = req.currentUser;
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

    // Messages are newest-first, so the first one seen per connection is
    // its latest.
    const rowsByConn = new Map();
    convoMessages.forEach((m) => {
      const key = m.connectionRequestId.toString();
      if (!rowsByConn.has(key)) rowsByConn.set(key, { last: m, unreadCount: 0 });
      const isUnreadForMe = !m.readAt && m.recipientType === type && m.recipientId && m.recipientId.toString() === id;
      if (isUnreadForMe) rowsByConn.get(key).unreadCount += 1;
    });

    const rows = [];

    rowsByConn.forEach(({ last, unreadCount }, key) => {
      const conn = connById.get(key);
      const other = conn && (isRecruiter ? conn.candidateId : conn.recruiterId);
      if (!other) return;

      rows.push({
        href: `/messages/thread/${key}`,
        name: `${other.firstName} ${other.lastName}`,
        preview: previewFor(last, type, id),
        sentAt: last.sentAt,
        unreadCount
      });
    });

    disputeMessages.forEach((m) => {
      rows.push({
        href: `/messages/${m._id}`,
        name: 'PreCheckd Trust & Safety',
        preview: m.subject || m.body,
        sentAt: m.sentAt,
        unreadCount: m.readAt ? 0 : 1
      });
    });

    rows.sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));

    res.render('inbox', { rows, currentUserType: type });
  } catch (error) {
    console.error('Error loading inbox:', error);
    res.status(500).send('Server error');
  }
});

// GET /messages/compose — the old standalone compose form. Messaging now
// lives in the conversation view, so every Send Message link lands there.
router.get('/compose', (req, res) => {
  const { connectionRequestId } = req.query;
  if (!connectionRequestId) {
    return res.status(400).send('Missing connection request.');
  }
  res.redirect(`/messages/thread/${encodeURIComponent(connectionRequestId)}`);
});

// GET /messages/sent — simple confirmation shown to the sender after sending
router.get('/sent', (req, res) => {
  res.render('message-sent', { currentUserType: req.currentUser.type });
});


// --- Conversation view (one running thread per accepted connection) ------

// GET /messages/thread/:connectionRequestId — the standalone conversation
// page. The same pane is embedded next to each profile.
router.get('/thread/:connectionRequestId', async (req, res) => {
  try {
    const pane = await buildPane(req.currentUser, req.params.connectionRequestId, { markRead: true });
    if (!pane) return res.status(403).send('Not authorized.');

    res.render('thread', { pane, title: `${pane.otherName} | PreCheckd` });
  } catch (error) {
    console.error('Error loading conversation:', error);
    res.status(500).send('Server error');
  }
});

// GET /messages/thread/:connectionRequestId/poll?afterId=&markRead=1 — new
// messages since afterId plus the current contact-request state. The pane
// calls this every ~12s; markRead is only set while the pane is actually on
// screen, so a hidden tab doesn't mark things read.
router.get('/thread/:connectionRequestId/poll', async (req, res) => {
  try {
    const ctx = await loadConversationContext(req.currentUser, req.params.connectionRequestId);
    if (!ctx) return res.status(403).json({ error: 'Not authorized.' });

    const afterId = /^[a-f0-9]{24}$/i.test(req.query.afterId || '') ? req.query.afterId : null;
    const messages = await fetchMessages(ctx, { afterId });

    if (req.query.markRead === '1') await markThreadRead(ctx);

    res.json({
      messages: messages.map((m) => messageToJson(m, ctx)),
      canSend: !ctx.otherUnavailable,
      contact: contactSummary(ctx)
    });
  } catch (error) {
    console.error('Error polling conversation:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// POST /messages/thread/:connectionRequestId/send  { body }
router.post('/thread/:connectionRequestId/send', async (req, res) => {
  try {
    const ctx = await loadConversationContext(req.currentUser, req.params.connectionRequestId);
    if (!ctx) return res.status(403).json({ error: 'Not authorized.' });

    const result = await sendThreadMessage(ctx, req.body.body);
    if (result.error) return res.status(result.status).json({ error: result.error });

    res.json({ message: messageToJson(result.message, ctx) });
  } catch (error) {
    console.error('Error sending conversation message:', error);
    res.status(500).json({ error: 'Something went wrong sending your message.' });
  }
});

// POST /messages/thread/:connectionRequestId/contact/request
router.post('/thread/:connectionRequestId/contact/request', async (req, res) => {
  try {
    const ctx = await loadConversationContext(req.currentUser, req.params.connectionRequestId);
    if (!ctx) return res.status(403).json({ error: 'Not authorized.' });

    const result = await requestContact(ctx);
    res.json({ outcome: result.outcome, contact: contactSummary(ctx) });
  } catch (error) {
    console.error('Error requesting contact info:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// POST /messages/thread/:connectionRequestId/contact/respond
//   { action: 'share'|'decline', shareEmail, sharePhone }
router.post('/thread/:connectionRequestId/contact/respond', async (req, res) => {
  try {
    const ctx = await loadConversationContext(req.currentUser, req.params.connectionRequestId);
    if (!ctx) return res.status(403).json({ error: 'Not authorized.' });

    const result = await respondToContactRequest(ctx, {
      action: req.body.action,
      shareEmail: req.body.shareEmail === true || req.body.shareEmail === 'on',
      sharePhone: req.body.sharePhone === true || req.body.sharePhone === 'on'
    });
    if (result.error) return res.status(result.status).json({ error: result.error });

    res.json({ ok: true, contact: contactSummary(ctx) });
  } catch (error) {
    console.error('Error responding to contact request:', error);
    res.status(500).json({ error: 'Something went wrong.' });
  }
});

// --- Contact-info request flow: standalone pages -------------------------
// (Same flow as the pane's buttons, for the Connections page and the
// legacy single-message view.) Contact details stay hidden after a
// connection is accepted; either side can ask, after a warning that moving
// off PreCheckd drops its protections, and the other chooses what to share.

// GET /messages/contact/request — warning + confirm screen
router.get('/contact/request', async (req, res) => {
  try {
    const ctx = await loadConversationContext(req.currentUser, req.query.connectionRequestId);
    if (!ctx) return res.status(403).send('Not authorized.');

    const summary = contactSummary(ctx);

    res.render('contact-request', {
      connectionRequestId: ctx.connection._id.toString(),
      otherName: `${ctx.other.firstName} ${ctx.other.lastName}`,
      warningTitle: CONTACT_WARNING_TITLE,
      warningPoints: CONTACT_WARNING_POINTS,
      alreadyShared: Boolean(summary.shared),
      alreadyRequested: summary.iAsked,
      theyAsked: summary.iAmAsked,
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
    const ctx = await loadConversationContext(req.currentUser, req.body.connectionRequestId);
    if (!ctx) return res.status(403).send('Not authorized.');

    const result = await requestContact(ctx);

    if (result.outcome === 'already_shared') return res.redirect('/connections');
    if (result.outcome === 'open_by_them') return res.redirect(`/messages/thread/${ctx.connection._id}`);
    res.redirect(`/messages/thread/${ctx.connection._id}`);
  } catch (error) {
    console.error('Error sending contact request:', error);
    res.status(500).send('Server error');
  }
});

// POST /messages/contact/respond — the person who was asked shares or declines
router.post('/contact/respond', async (req, res) => {
  try {
    const ctx = await loadConversationContext(req.currentUser, req.body.connectionRequestId);
    if (!ctx) return res.status(403).send('Not authorized.');

    const result = await respondToContactRequest(ctx, {
      action: req.body.action,
      shareEmail: req.body.shareEmail === 'on',
      sharePhone: req.body.sharePhone === 'on'
    });
    if (result.error) return res.status(result.status).send(result.error);

    res.redirect(result.action === 'share' ? '/connections' : `/messages/thread/${ctx.connection._id}`);
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
      const ctx = await loadConversationContext(req.currentUser, message.connectionRequestId);
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
      warnings: message.senderType === 'system' || (message.kind || 'message') !== 'message' ? [] : warningsFor(message.body),
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

    // Same safety rules as the conversation pane: no SSNs, card numbers or
    // bank account details in messages.
    const unsafe = checkOutgoing(body);
    if (unsafe) {
      return res.status(400).send(unsafe.message);
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

    await Message.create({
      connectionRequestId,
      senderType: type,
      senderId: id,
      recipientType,
      recipientId,
      subject: subject && subject.trim() ? subject.trim() : null,
      body: body.trim()
    });

    // A reply sent from the old single-message view lands back in the
    // conversation it belongs to.
    res.redirect(`/messages/thread/${connection._id}`);
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).send('Server error');
  }
});

module.exports = router;