// Inbound email (email foundation + candidate Mail, roadmap #4/#5).
//
// Resend posts an `email.received` webhook when mail arrives at an address on
// in.precheckd.com (candidates) or recruiters.precheckd.com (recruiters). The
// webhook carries metadata only. For each recipient that is a real, active
// PreCheckd alias we:
//   1. claim the (email, alias) pair in InboundEmail, so a retried webhook
//      never delivers twice;
//   2. drop suppressed or owner-reported senders and hold viruses / floods;
//   3. save the message as plain text in the owner's PreCheckd Mail
//      (MailMessage, shown on the /mail page). That IS the delivery: nothing
//      is forwarded to the owner's real inbox. Unread mail is surfaced by the
//      nav badge and the Monday and Thursday emails (services/weeklyEmails.js).
// Mail to unknown or disabled addresses is dropped silently (no bounce), so
// nobody can probe who is on PreCheckd.
//
// Known limits for now: attachments are not scanned beyond the mail
// provider's virus verdict, and are not stored (name and size only).
const { Resend } = require('resend');
const MailAlias = require('../models/MailAlias');
const InboundEmail = require('../models/InboundEmail');
const MailMessage = require('../models/MailMessage');
const MailReport = require('../models/MailReport');
const { suggestFor } = require('./applicationTracker');
const Suppression = require('../models/Suppression');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { parseAddress } = require('../utils/mailAlias');
const { unwrapForwarded } = require('../utils/forwardedMail');
const OutreachMessage = require('../models/OutreachMessage');

const resend = new Resend(process.env.RESEND_API_KEY);
// Most messages delivered to one address per rolling 24 hours; the rest are
// held. Generous on purpose: someone applying to many jobs gets bursts of
// confirmations, and held mail is invisible to them.
const DAILY_CAP = Number(process.env.INBOUND_DAILY_CAP) || 200;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
// Longest message body kept in PreCheckd's own copy (plain text).
const STORED_TEXT_CHARS = 20000;

// --- Small pure helpers (exported for tests) ----------------------------

// '"Jane Doe" <jane@x.com>' | 'Jane <jane@x.com>' | 'jane@x.com'
function parseSender(from) {
  const raw = String(from || '').trim();
  const m = raw.match(/^"?([^"<]*?)"?\s*<([^<>\s]+)>$/);
  const address = (m ? m[2] : raw).toLowerCase();
  const name = m ? m[1].trim() : '';
  return { name, address };
}

function headerValue(headers, name) {
  if (!headers) return null;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  return key ? String(headers[key]) : null;
}

// True only when the mail provider's checks say the sender really sent it
// (DMARC pass, or both SPF and DKIM pass). Missing headers mean "not
// confirmed", never "confirmed".
function senderAuthenticated(headers) {
  const auth = headerValue(headers, 'authentication-results') || '';
  if (/dmarc=pass/i.test(auth)) return true;
  return /spf=pass/i.test(auth) && /dkim=pass/i.test(auth);
}

function virusFound(headers) {
  return /fail/i.test(headerValue(headers, 'x-ses-virus-verdict') || '');
}

function spamSuspected(headers) {
  return /fail/i.test(headerValue(headers, 'x-ses-spam-verdict') || '');
}

function htmlToText(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Display name used in the From line: strips anything that could break the
// header or impersonate structure, and caps the length.
function safeDisplayName(name, fallback) {
  const cleaned = String(name || '').replace(/[\r\n"<>@]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
  return cleaned || fallback;
}

// --- Lookups ------------------------------------------------------------

async function isSuppressed(address) {
  const domain = address.split('@')[1];
  return Boolean(await Suppression.findOne({ value: { $in: [address, domain].filter(Boolean) } }));
}

async function loadOwner(namespace, ownerId) {
  if (namespace === 'candidate') {
    const c = await Candidate.findById(ownerId);
    return c && c.email ? c : null;
  }
  const r = await Recruiter.findById(ownerId);
  return r && r.email && r.accountTier === 'standard' && r.isActive && !r.isSuspended ? r : null;
}

async function verifiedRecruiterFor(address) {
  return Recruiter.findOne({
    email: address,
    accountTier: 'standard',
    isActive: true,
    isSuspended: { $ne: true },
    isPhoneVerified: true,
    isIdentityVerified: true
  });
}

// A registered candidate account for this sender address ('verified' when identity,
// phone and email are all verified). Only called for authenticated mail.
async function candidateFor(address) {
  const cand = await Candidate.findOne({ email: address });
  if (!cand) return null;
  return { fully: Boolean(cand.isIdentityVerified && cand.isPhoneVerified && cand.emailVerifiedAt) };
}

// Claims (emailId, alias). Returns the row to work on, or null when this
// message is already handled or being handled.
async function claim(emailId, aliasRow, fields) {
  try {
    return await InboundEmail.create({ emailId, aliasId: aliasRow._id, namespace: aliasRow.namespace, ownerId: aliasRow.ownerId, ...fields, status: 'processing' });
  } catch (err) {
    if (err.code !== 11000) throw err;
  }
  const existing = await InboundEmail.findOne({ emailId, aliasId: aliasRow._id });
  if (!existing) return null;
  const stale = existing.status === 'processing' && Date.now() - new Date(existing.updatedAt).getTime() > STALE_PROCESSING_MS;
  if (existing.status === 'failed' || stale) {
    existing.status = 'processing';
    await existing.save();
    return existing;
  }
  return null;
}

async function settle(row, status, extra = {}) {
  row.status = status;
  Object.assign(row, extra);
  await row.save();
  return status;
}

// --- Saving a copy in PreCheckd -----------------------------------------------

function attachmentSummary(full) {
  return (full.attachments || []).slice(0, 20).map((a) => ({
    filename: String(a.filename || a.name || 'attachment').slice(0, 200),
    contentType: String(a.content_type || a.contentType || '').slice(0, 100),
    size: Number(a.size) || 0
  }));
}

// The address a reply should go to: the message's Reply-To when it has one
// (application systems often send from no-reply and reply to a real mailbox).
function replyAddress(full) {
  const raw = Array.isArray(full.reply_to) ? full.reply_to[0] : (full.reply_to || headerValue(full.headers, 'reply-to'));
  const addr = raw ? parseSender(String(raw)).address : '';
  return addr && addr.includes('@') ? addr.slice(0, 200) : null;
}

function messageIdOf(full) {
  const id = full.message_id || headerValue(full.headers, 'message-id');
  return id ? String(id).trim().slice(0, 500) : null;
}

// Stores the plain-text message in the owner's PreCheckd Mail. This is the
// delivery, so a failure throws (the webhook answers 500 and Resend retries).
async function storeMessage({ emailId, full, aliasRow, sender, senderCheck, recruiterName, textBody, owner, authenticated }) {
  const spam = spamSuspected(full.headers);
  const body = String(textBody || '');
  const subject = String(full.subject || '').slice(0, 300);
  const references = String(headerValue(full.headers, 'references') || '').slice(0, 1000) || null;
  const inReplyTo = String(headerValue(full.headers, 'in-reply-to') || '').slice(0, 500) || null;

  // Candidate mail is read for the application tracker. The result is only a
  // pending suggestion the member must confirm; flagged mail gets none.
  // A message the member forwarded from their OWN registered address (and that
  // passed sender authentication, so nobody else can pose as them) is read as
  // the original message found inside the forward.
  let original = null;
  if (aliasRow.namespace === 'candidate' && authenticated && owner && owner.email
    && String(sender.address || '').toLowerCase() === String(owner.email).trim().toLowerCase()) {
    original = unwrapForwarded(body);
  }
  const readAs = original
    ? { fromAddress: original.fromAddress, fromName: original.fromName, subject: original.subject, textBody: original.textBody }
    : { fromAddress: sender.address, fromName: sender.name || '', subject, textBody: body };
  const suggestion = aliasRow.namespace === 'candidate' && !spam
    ? await suggestFor({ ownerId: aliasRow.ownerId, mail: { ...readAs, referencesHeader: references, inReplyToHeader: inReplyTo } })
    : null;

  // A recruiter's mail from someone they emailed through outreach is a reply.
  // A lookup failure must never stop delivery, so it just means "not marked".
  let outreachReply = false;
  if (aliasRow.namespace === 'recruiter' && sender.address) {
    outreachReply = Boolean(await OutreachMessage.exists({ recruiterId: aliasRow.ownerId, toEmail: sender.address, status: 'sent' }).catch(() => false));
  }

  await MailMessage.updateOne(
    { emailId, aliasId: aliasRow._id },
    {
      $setOnInsert: {
        namespace: aliasRow.namespace,
        ownerId: aliasRow.ownerId,
        aliasId: aliasRow._id,
        direction: 'in',
        emailId,
        fromAddress: sender.address,
        fromName: sender.name || null,
        subject,
        textBody: body.slice(0, STORED_TEXT_CHARS),
        bodyTruncated: body.length > STORED_TEXT_CHARS,
        attachments: attachmentSummary(full),
        replyTo: replyAddress(full),
        messageIdHeader: messageIdOf(full),
        referencesHeader: references,
        inReplyToHeader: inReplyTo,
        outreachReply,
        originalFromAddress: original ? original.fromAddress : null,
        originalFromName: original ? (original.fromName || null) : null,
        ...(suggestion ? { suggestion } : {}),
        senderCheck,
        recruiterName,
        flagged: spam,
        flagReason: spam ? 'spam_verdict' : null,
        receivedAt: new Date()
      }
    },
    { upsert: true }
  );
}

// --- Per-recipient processing --------------------------------------------

async function processRecipient({ emailId, full, aliasRow, sender }) {
  const attachmentCount = (full.attachments || []).length;
  const row = await claim(emailId, aliasRow, {
    fromAddress: sender.address,
    fromName: sender.name || null,
    subject: (full.subject || '').slice(0, 300),
    attachmentCount
  });
  if (!row) return 'duplicate';

  if (await isSuppressed(sender.address)) return settle(row, 'dropped', { reason: 'suppressed_sender' });
  // The owner reported this sender as a scam: they never hear from it again.
  if (await MailReport.exists({ namespace: aliasRow.namespace, ownerId: aliasRow.ownerId, fromAddress: sender.address })) {
    return settle(row, 'dropped', { reason: 'reported_by_owner' });
  }
  if (virusFound(full.headers)) return settle(row, 'held', { reason: 'virus_verdict' });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await InboundEmail.countDocuments({ aliasId: aliasRow._id, status: { $in: ['delivered', 'forwarded'] }, receivedAt: { $gte: since } });
  if (recent >= DAILY_CAP) return settle(row, 'held', { reason: 'daily_cap' });

  const owner = await loadOwner(aliasRow.namespace, aliasRow.ownerId);
  if (!owner) return settle(row, 'dropped', { reason: 'owner_unavailable' });

  let senderCheck = 'unverified';
  let recruiterName = null;
  if (aliasRow.namespace === 'candidate' && senderAuthenticated(full.headers)) {
    const rec = await verifiedRecruiterFor(sender.address);
    if (rec) {
      senderCheck = 'verified_recruiter';
      recruiterName = [rec.firstName, rec.lastName].filter(Boolean).join(' ') + (rec.company && rec.company !== 'Not provided' ? ` (${rec.company})` : '');
    }
  }

  // A recruiter's mail from a registered candidate address (never a name or profile link: candidates stay anonymous until they connect).
  if (aliasRow.namespace === 'recruiter' && senderAuthenticated(full.headers)) {
    const cand = await candidateFor(sender.address).catch(() => null);
    if (cand) senderCheck = cand.fully ? 'verified_candidate' : 'member_candidate';
  }

  const textBody = (full.text && full.text.trim()) || htmlToText(full.html);
  try {
    await storeMessage({ emailId, full, aliasRow, sender, senderCheck, recruiterName, textBody, owner, authenticated: senderAuthenticated(full.headers) });
  } catch (err) {
    await settle(row, 'failed', { reason: String(err.message || 'store_error').slice(0, 200) });
    throw new Error(`Could not store message: ${err.message}`);
  }
  return settle(row, 'delivered', { senderCheck });
}

// --- Webhook entry points -------------------------------------------------

async function handleReceived(data) {
  // Every address this message was delivered to on our domains.
  const targets = new Map();
  for (const addr of [...(data.received_for || []), ...(data.to || []), ...(data.cc || [])]) {
    const parsed = parseAddress(addr);
    if (parsed) targets.set(`${parsed.namespace}:${parsed.alias}`, parsed);
  }

  const aliasRows = [];
  for (const { namespace, alias } of targets.values()) {
    const row = await MailAlias.findOne({ namespace, alias, status: 'active' });
    if (row) aliasRows.push(row);
  }

  const results = { delivered: 0, held: 0, dropped: 0, duplicate: 0, unknown: targets.size - aliasRows.length };
  if (aliasRows.length > 0) {
    // One fetch gets the body and the authentication headers.
    const { data: full, error } = await resend.emails.receiving.get(data.email_id);
    if (error || !full) throw new Error(`Could not fetch received email: ${error && error.message}`);
    const sender = parseSender(full.from || data.from);

    for (const aliasRow of aliasRows) {
      const outcome = await processRecipient({ emailId: data.email_id, full, aliasRow, sender });
      results[outcome] = (results[outcome] || 0) + 1;
    }
  }

  // Metadata only: never log subjects, bodies or addresses.
  console.log(`[inbound] email.received id=${data.email_id} delivered=${results.delivered} held=${results.held} dropped=${results.dropped} duplicate=${results.duplicate} unknown_recipient=${results.unknown}`);
  return results;
}

// Hard bounces and spam complaints go on the shared do-not-contact list.
// Soft bounces (mailbox full, temporary failure) do not.
async function addSuppressions(addresses, reason, note) {
  for (const raw of addresses || []) {
    const value = parseSender(raw).address;
    if (!value || !value.includes('@')) continue;
    await Suppression.updateOne(
      { value },
      { $setOnInsert: { value, type: 'address', reason, note: note ? String(note).slice(0, 200) : null } },
      { upsert: true }
    );
  }
}

async function handleDeliveryEvent(event) {
  if (event.type === 'email.bounced' && /permanent/i.test((event.data.bounce && event.data.bounce.type) || '')) {
    await addSuppressions(event.data.to, 'bounce', event.data.bounce.subType);
    console.log(`[inbound] hard bounce suppressed (${(event.data.to || []).length} address)`);
  } else if (event.type === 'email.complained') {
    await addSuppressions(event.data.to, 'complaint');
    console.log(`[inbound] spam complaint suppressed (${(event.data.to || []).length} address)`);
  }
}

// Express handler. Mounted with express.raw so the body is untouched (the
// signature covers the exact bytes Resend sent).
async function handleWebhook(req, res) {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    // 5xx so Resend retries once the secret is configured.
    console.error('[inbound] RESEND_WEBHOOK_SECRET is not set');
    return res.status(503).send('Not configured');
  }

  let event;
  try {
    event = resend.webhooks.verify({
      payload: req.body.toString('utf8'),
      headers: {
        id: req.get('svix-id'),
        timestamp: req.get('svix-timestamp'),
        signature: req.get('svix-signature'),
      },
      webhookSecret: secret,
    });
  } catch (err) {
    return res.status(400).send('Invalid signature');
  }

  try {
    if (event.type === 'email.received') {
      await handleReceived(event.data);
    } else if (event.type === 'email.bounced' || event.type === 'email.complained') {
      await handleDeliveryEvent(event);
    }
  } catch (err) {
    // 5xx makes Resend retry; handlers are safe to repeat.
    console.error('[inbound] handler failed:', err.message);
    return res.status(500).send('Handler error');
  }

  return res.status(200).send('ok');
}

module.exports = {
  handleWebhook, handleReceived, handleDeliveryEvent, processRecipient,
  parseSender, senderAuthenticated, virusFound, spamSuspected, htmlToText, safeDisplayName,
  replyAddress, messageIdOf
};
