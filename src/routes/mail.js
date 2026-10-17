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
const candidateCompose = require('../services/candidateCompose');
const { buildThreads, threadOf } = require('../utils/mailThreads');
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
const THREAD_LOAD_LIMIT = 300;

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

// The new words only: cut a reply at the quoted original ("On ... wrote:",
// "-----Original Message-----", an Outlook From/Sent block, or ">" lines) so a
// list preview never shows the quoted header. Falls back to the whole text.
function stripQuoted(text) {
  const lines = String(text || '').split(/\r?\n/);
  let cut = lines.length;
  for (let i = 0; i < lines.length; i += 1) {
    const l = lines[i].trim();
    const next = (lines[i + 1] || '').trim();
    if (/^>/.test(l)
      || /^On\s.{3,300}wrote:?$/i.test(l)
      || (/^On\s/i.test(l) && /^.{0,200}wrote:?$/i.test(next))
      || /^-{2,}\s*(Original Message|Forwarded message)/i.test(l)
      || /^_{5,}$/.test(l)
      || (/^From:\s/i.test(l) && /^(Sent|Date):\s/i.test(next))) { cut = i; break; }
  }
  const head = lines.slice(0, cut).join(' ').trim();
  return head || String(text || '');
}

const SENDER_BADGES = {
  verified_recruiter: { text: '\u2713 Verified recruiter', cls: 'verified' },
  verified_candidate: { text: '\u2713 Verified candidate', cls: 'verified' },
  member_candidate: { text: 'PreCheckd member', cls: 'member' }
};

function mailRow(m) {
  return {
    href: `/mail/${m._id}`,
    id: m._id.toString(),
    deletable: true,
    badge: SENDER_BADGES[m.senderCheck] || null,
    name: m.fromName || m.fromAddress || 'Unknown sender',
    address: m.fromAddress,
    subject: m.subject || '(no subject)',
    preview: oneLine(stripQuoted(m.textBody), 110),
    at: m.receivedAt,
    unread: !m.readAt,
    kind: 'mail',
    recruiterName: m.recruiterName,
    outreachReply: Boolean(m.outreachReply),
    attachmentCount: (m.attachments || []).length,
    trackerPending: Boolean(m.suggestion && m.suggestion.action && m.suggestion.state === 'pending')
  };
}

// One Inbox row per conversation (see utils/mailThreads.js): the latest message
// received sets the subject and preview, the latest message of any kind sets the
// date, and the row is unread while any received message in it is.
function threadRow(thread) {
  const ins = thread.filter((m) => m.direction === 'in');
  const latestIn = ins[ins.length - 1];
  const latest = thread[thread.length - 1];
  const names = [];
  ins.forEach((m) => { const n = m.fromName || m.fromAddress || 'Unknown sender'; if (!names.includes(n)) names.push(n); });
  if (thread.some((m) => m.direction === 'out')) names.push('me');
  const row = mailRow(latestIn);
  return {
    ...row,
    name: names.join(', '),
    count: thread.length,
    at: latest.receivedAt,
    unread: ins.some((m) => !m.readAt),
    outreachReply: ins.some((m) => m.outreachReply),
    trackerPending: ins.some((m) => m.suggestion && m.suggestion.action && m.suggestion.state === 'pending')
  };
}

// Everything a member has not deleted, for grouping (received and sent).
async function threadMessages(ns, ownerId) {
  const [received, sent] = await Promise.all([
    MailMessage.find({ namespace: ns, ownerId, direction: 'in', deletedAt: null }).sort({ receivedAt: -1 }).limit(THREAD_LOAD_LIMIT),
    MailMessage.find({ namespace: ns, ownerId, direction: 'out', deletedAt: null }).sort({ receivedAt: -1 }).limit(THREAD_LOAD_LIMIT)
  ]);
  return [...received, ...sent];
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

// GET /mail?tab=inbox|conversations|sent
const TABS = ['inbox', 'conversations', 'sent'];

async function sentRows(ns, ownerId) {
  const [replies, outreachSent] = await Promise.all([
    MailMessage.find({ namespace: ns, ownerId, direction: 'out', deletedAt: null }).sort({ receivedAt: -1 }).limit(100),
    ns === 'recruiter' ? OutreachMessage.find({ recruiterId: ownerId, status: 'sent' }).sort({ sentAt: -1 }).limit(100) : []
  ]);
  const answered = outreachSent.length
    ? await MailMessage.find({
      namespace: ns, ownerId, direction: 'in', outreachReply: true, deletedAt: null,
      fromAddress: { $in: outreachSent.map((m) => m.toEmail) }
    }).sort({ receivedAt: -1 })
    : [];
  const replyBy = new Map();
  answered.forEach((r) => { if (!replyBy.has(r.fromAddress)) replyBy.set(r.fromAddress, r); });

  const rows = [];
  const composedTo = replies.filter((m) => m.composed).map((m) => m.toAddress);
  const composedAnswers = composedTo.length
    ? await MailMessage.find({ namespace: ns, ownerId, direction: 'in', deletedAt: null, fromAddress: { $in: composedTo } }).sort({ receivedAt: -1 })
    : [];
  const answerBy = new Map();
  composedAnswers.forEach((r) => { if (!answerBy.has(r.fromAddress)) answerBy.set(r.fromAddress, r); });
  replies.forEach((m) => {
    if (m.composed) {
      const answer = answerBy.get(String(m.toAddress || '').toLowerCase());
      const choice = m.recipientAction ? outreach.STATUS_NOTE[m.recipientAction] : '';
      return rows.push({
        href: answer ? `/mail/${answer._id}` : null,
        name: `To: ${m.toAddress || ''}`, subject: m.subject || '(no subject)', preview: oneLine(m.textBody, 110),
        at: m.receivedAt, unread: false,
        chip: choice || (answer ? 'Replied' : 'Sent'), chipClass: choice ? 'note' : (answer ? 'reply' : '')
      });
    }
    return rows.push({
      href: m.inReplyToMailId ? `/mail/${m.inReplyToMailId}#reply` : null,
      name: `To: ${m.toAddress || ''}`, subject: m.subject || '(no subject)', preview: oneLine(m.textBody, 110),
      at: m.receivedAt, unread: false, chip: 'Reply', chipClass: ''
    });
  });
  outreachSent.forEach((m) => {
    const reply = replyBy.get(m.toEmail);
    const choice = m.recipientAction ? outreach.STATUS_NOTE[m.recipientAction] : '';
    rows.push({
      href: reply ? `/mail/${reply._id}` : null,
      name: `To: ${m.toEmail}`, subject: m.subject, preview: m.note ? oneLine(m.note, 110) : '',
      at: m.sentAt, unread: false,
      chip: choice || (reply ? 'Replied' : 'Outreach'), chipClass: choice ? 'note' : (reply ? 'reply' : '')
    });
  });
  return rows.sort((a, b) => new Date(b.at) - new Date(a.at));
}

router.get('/', async (req, res) => {
  try {
    const { ns, ownerId } = req;
    const tab = TABS.includes(req.query.tab) ? req.query.tab : 'inbox';
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

    const [conversations, allMail, flaggedMail, alias, sent] = await Promise.all([
      conversationRows(ns, ownerId),
      threadMessages(ns, ownerId),
      MailMessage.find({ ...mailFilter, flagged: true }).sort({ receivedAt: -1 }).limit(LIST_LIMIT),
      MailAlias.findOne({ namespace: ns, ownerId }),
      tab === 'sent' ? sentRows(ns, ownerId) : []
    ]);

    // Newest first by default; the header arrows sort by sender, subject or date.
    const sortKey = ['from', 'subject', 'date'].includes(req.query.sort) ? req.query.sort : 'date';
    const dir = req.query.dir === 'asc' ? 'asc' : 'desc';
    const keyOf = (r) => (sortKey === 'from' ? String(r.name || '').toLowerCase()
      : sortKey === 'subject' ? String(r.subject || r.preview || '').toLowerCase() : new Date(r.at).getTime());
    const sortRows = (rows) => rows.sort((a, b) => {
      const x = keyOf(a), y = keyOf(b);
      const c = x < y ? -1 : x > y ? 1 : 0;
      return (dir === 'asc' ? c : -c) || (new Date(b.at) - new Date(a.at));
    });

    // Verified senders get a badge, not a higher spot in the list. Verified senders get a badge, not a
    // higher spot in the list.
    // Flagged mail stays out of the Inbox (it has its own group below).
    const notFlagged = allMail.filter((m) => !m.flagged);
    const inbox = sortRows(buildThreads(notFlagged)
      .filter((t) => t.some((m) => m.direction === 'in'))
      .map(threadRow)
      .slice(0, LIST_LIMIT));
    const conv = sortRows(conversations);
    sortRows(sent);
    const flagged = flaggedMail.map(mailRow);

    res.render('mail', {
      pageTitle: 'Mail | PreCheckd',
      tab, sortKey, dir,
      rowsByTab: { inbox, conversations: conv, sent },
      flagged,
      counts: {
        inbox: inbox.filter((r) => r.unread).length,
        conversations: conv.reduce((n, r) => n + (r.unreadCount || 0), 0)
      },
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

async function renderCompose(req, res, { error = null, sent = false, form = {}, statusCode = 200, trackerGuess = null } = {}) {
  if (req.ns === 'candidate') {
    const candidate = await Candidate.findById(req.ownerId);
    if (!candidate) return res.redirect('/login');
    const quota = await candidateCompose.quotaFor(candidate._id);
    return res.status(statusCode).render('mail-compose', {
      pageTitle: 'New message | PreCheckd',
      viewer: 'candidate',
      enabled: outreach.enabled(),
      verified: candidateCompose.isFullyVerified(candidate),
      hasResume: Boolean(candidate.resumeUrl),
      quota, error, sent, form, trackerGuess,
      maxBody: candidateCompose.MAX_BODY_CHARS
    });
  }
  const recruiter = await Recruiter.findById(req.ownerId);
  if (!recruiter) return res.redirect('/login');
  const quota = await outreach.quotaFor(recruiter._id);
  return res.status(statusCode).render('mail-compose', {
    pageTitle: 'New message | PreCheckd',
    viewer: 'recruiter',
    enabled: outreach.enabled(),
    verified: outreach.isFullyVerified(recruiter),
    quota, error, sent, form, trackerGuess: null,
    templates: Object.entries(outreach.TEMPLATES).map(([key, t]) => ({ key, label: t.label, needsRole: t.needsRole })),
    maxNote: outreach.MAX_NOTE_CHARS
  });
}

router.get('/new', async (req, res) => {
  try {
    const guess = req.query.sent === '1' ? req.session.composeTrackerGuess || null : null;
    delete req.session.composeTrackerGuess;
    return await renderCompose(req, res, { sent: req.query.sent === '1', trackerGuess: guess });
  } catch (error) {
    console.error('Error loading new message page:', error);
    return res.status(500).send('Server error');
  }
});

router.post('/new', async (req, res) => {
  try {
    const body = req.body || {};
    if (req.ns === 'candidate') {
      const candidate = await Candidate.findById(req.ownerId);
      if (!candidate) return res.redirect('/login');
      const form = {
        toEmail: String(body.toEmail || '').slice(0, 254), subject: String(body.subject || '').slice(0, 300),
        body: String(body.body || '').slice(0, 20000),
        attachResume: body.attachResume === 'on', attachCertificate: body.attachCertificate === 'on'
      };
      let alias = null;
      try { alias = await ensureMailAlias('candidate', candidate); } catch (e) { alias = null; }
      const result = await candidateCompose.sendNew({ candidate, alias, input: form, enabled: outreach.enabled() });
      if (result.error) {
        return await renderCompose(req, res, { error: result.message || candidateCompose.COMPOSE_ERRORS[result.error] || 'Something went wrong.', form, statusCode: 400 });
      }
      req.session.composeTrackerGuess = result.trackerGuess || null;
      return res.redirect('/mail/new?sent=1');
    }
    const recruiter = await Recruiter.findById(req.ownerId);
    if (!recruiter) return res.redirect('/login');
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

router.get('/sent', (req, res) => res.redirect('/mail?tab=sent'));

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

// The conversation a message belongs to (oldest first). A message that is not
// in the loaded set (for example a flagged one) still gets its own conversation.
async function loadThread(req, message) {
  const all = await threadMessages(req.ns, req.ownerId);
  if (!all.some((m) => String(m._id) === String(message._id))) all.push(message);
  return threadOf(all, message._id) || [message];
}

async function renderMessage(req, res, clicked, { error = null, draft = '', status = 200 } = {}) {
  const thread = await loadThread(req, clicked);
  const received = thread.filter((m) => m.direction === 'in');
  // The newest message received is the one you reply to, report or add to the tracker.
  const message = received[received.length - 1] || clicked;

  // For a reply to outreach: what the recruiter originally sent that address.
  let outreachSent = null;
  const fromOutreach = received.find((m) => m.outreachReply) || null;
  if (req.ns === 'recruiter' && fromOutreach && fromOutreach.fromAddress) {
    const o = await OutreachMessage.findOne({ recruiterId: req.ownerId, toEmail: fromOutreach.fromAddress, status: 'sent' }).sort({ sentAt: -1 });
    if (o) outreachSent = { subject: o.subject, at: o.sentAt, note: o.note || '' };
  }
  const target = replyTarget(message);
  res.status(status).render('mail-detail', {
    outreachSent,
    pageTitle: `${message.subject || 'Message'} | PreCheckd`,
    viewer: req.ns,
    message,
    items: thread.map((m) => ({ m, warnings: m.direction === 'in' ? warningsFor(m.textBody) : [] })),
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

    // Opening a conversation reads everything received in it.
    const thread = await loadThread(req, message);
    for (const m of thread) {
      if (m.direction === 'in' && !m.readAt) {
        m.readAt = new Date();
        await m.save();
      }
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
    // Deleting removes the whole conversation (same timestamp, so Undo brings it all back).
    const thread = await loadThread(req, message);
    const now = new Date();
    for (const m of thread) {
      m.deletedAt = now;
      if (!m.readAt) m.readAt = now;
      await m.save();
    }
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
    const stamp = message.deletedAt;
    const together = await MailMessage.find({ namespace: req.ns, ownerId: req.ownerId, deletedAt: stamp });
    for (const m of (together.length ? together : [message])) {
      m.deletedAt = null;
      await m.save();
    }
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
