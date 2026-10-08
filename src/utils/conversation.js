// The running recruiter<->candidate conversation for one accepted
// connection. Everything that reads or writes a conversation — the
// standalone thread page, the chat pane next to a profile, the JSON
// polling/sending endpoints, and the contact-info request flow — goes
// through here so the access rules (accepted connection, must be a party)
// live in one place.
//
// A conversation isn't its own record: it's every Message tied to the
// connection (connectionRequestId), in _id order.
const Message = require('../models/Message');
const ConnectionRequest = require('../models/ConnectionRequest');
const Recruiter = require('../models/Recruiter');
const Candidate = require('../models/Candidate');
const {
  CONTACT_WARNING_TITLE,
  CONTACT_WARNING_POINTS,
  otherSide,
  sharedContactFor,
  hasSharedAnything
} = require('./contactSharing');

const { checkOutgoing, warningsFor } = require('./messageSafety');

const MAX_MESSAGE_LENGTH = 2000;
const INITIAL_MESSAGE_LIMIT = 200;
const POLL_MESSAGE_LIMIT = 200;

// currentUser is { type: 'recruiter'|'candidate', id }. Returns null if the
// connection doesn't exist, isn't accepted, or the user isn't a party to it.
// A suspended/inactive recruiter on the other end is still loadable (so the
// history can be read) but flagged via ctx.otherUnavailable so sending is
// blocked — deliberately the same either way, nothing here distinguishes
// "deactivated" from "suspended for fraud."
async function loadConversationContext(currentUser, connectionRequestId) {
  if (!currentUser || !connectionRequestId) return null;

  const connection = await ConnectionRequest.findById(connectionRequestId).catch(() => null);
  if (!connection || connection.status !== 'accepted') return null;

  const { type, id } = currentUser;
  const isRecruiterParty = type === 'recruiter' && connection.recruiterId.toString() === id;
  const isCandidateParty = type === 'candidate' && connection.candidateId.toString() === id;
  if (!isRecruiterParty && !isCandidateParty) return null;

  const otherType = otherSide(type);
  const otherId = type === 'recruiter' ? connection.candidateId : connection.recruiterId;
  const OtherModel = otherType === 'recruiter' ? Recruiter : Candidate;
  const SelfModel = type === 'recruiter' ? Recruiter : Candidate;

  const otherFields = otherType === 'recruiter'
    ? 'firstName lastName email phone slug isActive isSuspended'
    : 'firstName lastName email phone';

  const [other, self] = await Promise.all([
    OtherModel.findById(otherId).select(otherFields),
    SelfModel.findById(id).select('firstName lastName email phone')
  ]);

  if (!other || !self) return null;

  const otherUnavailable = otherType === 'recruiter' && (other.isSuspended || other.isActive === false);

  return { connection, type, id, otherType, otherId, other, self, otherUnavailable };
}

function messageToJson(m, ctx) {
  const mine = m.senderType === ctx.type && Boolean(m.senderId) && m.senderId.toString() === ctx.id;
  const kind = m.kind || 'message';

  return {
    id: m._id.toString(),
    mine,
    kind,
    body: m.body,
    sentAt: new Date(m.sentAt).toISOString(),
    // Scam-pattern warnings are for the person RECEIVING a message, worked
    // out when it's displayed so the rules can improve without touching
    // stored messages.
    warnings: !mine && kind === 'message' ? warningsFor(m.body) : []
  };
}

// What the viewer can do / see on the contact-info side right now.
function contactSummary(ctx) {
  const c = ctx.connection;
  const open = c.contactRequestStatus === 'requested';
  const iAsked = open && c.contactRequestedBy === ctx.type;
  const iAmAsked = open && !iAsked;

  const shared = sharedContactFor(c, ctx.type, ctx.other);

  return {
    iAsked,
    iAmAsked,
    iShared: hasSharedAnything(c, ctx.type),
    shared: shared ? { email: shared.email, phone: shared.phone } : null,
    // Only handed to the client when they're being asked, so they can see
    // exactly what they'd be sharing.
    own: iAmAsked ? { email: ctx.self.email, phone: ctx.self.phone || null } : null
  };
}

async function fetchMessages(ctx, { afterId } = {}) {
  const base = { connectionRequestId: ctx.connection._id };

  if (afterId) {
    const messages = await Message.find({ ...base, _id: { $gt: afterId } })
      .sort({ _id: 1 })
      .limit(POLL_MESSAGE_LIMIT);
    return messages;
  }

  const latest = await Message.find(base).sort({ _id: -1 }).limit(INITIAL_MESSAGE_LIMIT);
  return latest.reverse();
}

async function markThreadRead(ctx) {
  await Message.updateMany(
    {
      connectionRequestId: ctx.connection._id,
      recipientType: ctx.type,
      recipientId: ctx.id,
      readAt: null
    },
    { readAt: new Date() }
  );
}

// Everything the chat pane needs to render, as plain JSON-safe data.
async function buildPane(currentUser, connectionRequestId, { markRead = false } = {}) {
  const ctx = await loadConversationContext(currentUser, connectionRequestId);
  if (!ctx) return null;

  const messages = await fetchMessages(ctx);
  const unreadCount = messages.filter(
    (m) => !m.readAt && m.recipientType === ctx.type && m.recipientId && m.recipientId.toString() === ctx.id
  ).length;

  if (markRead) await markThreadRead(ctx);

  const last = messages[messages.length - 1];

  return {
    connectionRequestId: ctx.connection._id.toString(),
    meType: ctx.type,
    otherName: `${ctx.other.firstName} ${ctx.other.lastName}`,
    // Where to see the other person's profile (recruiters reach a
    // candidate through the connection; candidates through the public
    // recruiter page).
    profileUrl: ctx.type === 'recruiter'
      ? `/recruiter-dashboard/requests/${ctx.connection._id}/candidate`
      : (ctx.other.slug ? `/recruiter/${ctx.other.slug}` : null),
    canSend: !ctx.otherUnavailable,
    messages: messages.map((m) => messageToJson(m, ctx)),
    lastId: last ? last._id.toString() : null,
    unreadCount: markRead ? 0 : unreadCount,
    contact: contactSummary(ctx),
    warning: { title: CONTACT_WARNING_TITLE, points: CONTACT_WARNING_POINTS },
    maxLength: MAX_MESSAGE_LENGTH
  };
}

async function sendThreadMessage(ctx, rawBody) {
  const body = typeof rawBody === 'string' ? rawBody.trim() : '';
  if (!body) return { error: 'Message body is required.', status: 400 };
  if (body.length > MAX_MESSAGE_LENGTH) {
    return { error: `Messages can be up to ${MAX_MESSAGE_LENGTH} characters.`, status: 400 };
  }
  if (ctx.otherUnavailable) {
    return { error: 'This person is no longer active on PreCheckd, so you can\'t send a message here.', status: 403 };
  }

  // Never send or store SSNs, card numbers or bank account details.
  const unsafe = checkOutgoing(body);
  if (unsafe) {
    return { error: unsafe.message, status: 400, blocked: unsafe.reason };
  }

  const message = await Message.create({
    connectionRequestId: ctx.connection._id,
    senderType: ctx.type,
    senderId: ctx.id,
    recipientType: ctx.otherType,
    recipientId: ctx.otherId,
    kind: 'message',
    body
  });

  return { message };
}

// --- Contact-info request flow -------------------------------------------
// The request and the answer are stored as messages in the conversation.
// Nothing is emailed per message — unread messages (these included) go out
// in the daily digest.

async function createNotice(ctx, kind, subject, body) {
  return Message.create({
    connectionRequestId: ctx.connection._id,
    senderType: ctx.type,
    senderId: ctx.id,
    recipientType: ctx.otherType,
    recipientId: ctx.otherId,
    kind,
    subject,
    body
  });
}

// Returns { outcome } where outcome is one of: 'sent', 'already_shared',
// 'open_by_me', 'open_by_them'.
async function requestContact(ctx) {
  const { connection } = ctx;

  if (hasSharedAnything(connection, ctx.otherType)) return { outcome: 'already_shared' };

  if (connection.contactRequestStatus === 'requested') {
    return { outcome: connection.contactRequestedBy === ctx.type ? 'open_by_me' : 'open_by_them' };
  }

  connection.contactRequestStatus = 'requested';
  connection.contactRequestedBy = ctx.type;
  connection.contactRequestedAt = new Date();
  await connection.save();

  await createNotice(
    ctx,
    'contact_request',
    'Contact info request',
    `${ctx.self.firstName} ${ctx.self.lastName} would like to exchange contact details outside PreCheckd. ` +
      'You decide what, if anything, to share — you can also choose "Not now" and keep talking here.'
  );

  return { outcome: 'sent' };
}

// action: 'share' | 'decline'. Returns { ok: true, action } or { error, status }.
async function respondToContactRequest(ctx, { action, shareEmail, sharePhone }) {
  const { connection } = ctx;

  // Only the person who was asked can answer, and only while it's open.
  if (connection.contactRequestStatus !== 'requested' || connection.contactRequestedBy === ctx.type) {
    return { error: 'There is no open contact request to answer.', status: 400 };
  }

  if (action === 'share') {
    const email = Boolean(shareEmail);
    const phone = Boolean(sharePhone) && Boolean(ctx.self.phone);

    if (!email && !phone) {
      return { error: 'Choose at least one thing to share, or pick "Not now".', status: 400 };
    }

    connection.contactShared[ctx.type] = { email, phone, sharedAt: new Date() };
    connection.contactRequestStatus = 'none';
    connection.contactRequestedBy = null;
    connection.markModified('contactShared');
    await connection.save();

    await createNotice(
      ctx,
      'contact_shared',
      'Contact info shared',
      `${ctx.self.firstName} ${ctx.self.lastName} shared their contact details with you.`
    );

    return { ok: true, action: 'share' };
  }

  if (action === 'decline') {
    connection.contactRequestStatus = 'declined';
    connection.contactRequestedBy = null;
    await connection.save();

    await createNotice(
      ctx,
      'contact_declined',
      'Contact info request',
      `${ctx.self.firstName} ${ctx.self.lastName} would rather keep talking on PreCheckd for now.`
    );

    return { ok: true, action: 'decline' };
  }

  return { error: 'Unknown action.', status: 400 };
}

module.exports = {
  MAX_MESSAGE_LENGTH,
  loadConversationContext,
  messageToJson,
  contactSummary,
  fetchMessages,
  markThreadRead,
  buildPane,
  sendThreadMessage,
  requestContact,
  respondToContactRequest
};
