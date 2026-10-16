// Inbound email (email foundation, roadmap #4).
//
// Resend posts an `email.received` webhook when mail arrives at an address on
// in.precheckd.com (candidates) or recruiters.precheckd.com (recruiters). The
// webhook carries metadata only. For each recipient that is a real, active
// PreCheckd alias we:
//   1. claim the (email, alias) pair in InboundEmail, so a retried webhook
//      never forwards twice;
//   2. drop suppressed senders and hold viruses / floods;
//   3. keep a plain-text copy in the owner's PreCheckd Mail (MailMessage, shown
//      on the /mail page);
//   4. relay the message to the owner's real inbox as a branded PreCheckd
//      email: sender, a verified/unverified badge, the message as plain text,
//      and the untouched original attached as .eml.
// Mail to unknown or disabled addresses is dropped silently (no bounce), so
// nobody can probe who is on PreCheckd.
//
// Known limits for now: attachments are not scanned beyond the mail
// provider's virus verdict; a reply goes straight to the sender (Reply-To),
// which shows the owner's real address (the relay-reply thread is part of
// roadmap #5/#6).
const { Resend } = require('resend');
const MailAlias = require('../models/MailAlias');
const InboundEmail = require('../models/InboundEmail');
const MailMessage = require('../models/MailMessage');
const Suppression = require('../models/Suppression');
const Candidate = require('../models/Candidate');
const Recruiter = require('../models/Recruiter');
const { parseAddress, addressFor } = require('../utils/mailAlias');
const { brandShell, escapeHtml } = require('../utils/emailLayout');

const resend = new Resend(process.env.RESEND_API_KEY);
const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';
// Most messages relayed to one address per rolling 24 hours; the rest are held.
const DAILY_CAP = Number(process.env.INBOUND_DAILY_CAP) || 50;
const STALE_PROCESSING_MS = 10 * 60 * 1000;
const MAX_TEXT_CHARS = 8000;
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

function buildForwardEmail({ sender, subject, textBody, senderCheck, recruiterName, aliasAddress, spam, attachmentCount, namespace }) {
  let badge;
  if (namespace === 'candidate') {
    badge = senderCheck === 'verified_recruiter'
      ? `<div style="background:#E8F6EE;border:1px solid #BFE8CF;border-radius:8px;padding:10px 12px;color:#1B7F4B;font-weight:700;">&#10003; Verified PreCheckd recruiter${recruiterName ? `: ${escapeHtml(recruiterName)}` : ''}</div>`
      : `<div style="background:#FFF3DC;border:1px solid #F3D9A4;border-radius:8px;padding:10px 12px;color:#7A4A00;"><strong>Not a verified PreCheckd recruiter.</strong> We could not confirm who sent this. Be careful with links, attachments and requests for personal information.</div>`;
  } else {
    badge = '';
  }
  const spamNote = spam
    ? `<div style="margin-top:10px;background:#FDECEA;border:1px solid #F3B8B3;border-radius:8px;padding:10px 12px;color:#B3261E;">Our mail checks flagged this message as likely spam.</div>`
    : '';
  const truncated = textBody.length > MAX_TEXT_CHARS;
  const shown = truncated ? `${textBody.slice(0, MAX_TEXT_CHARS)}\n\n[Message shortened. The full original is attached.]` : textBody;

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1B7F4B;">Forwarded by PreCheckd</p>
    <h1 style="margin:0 0 14px;font-size:20px;line-height:1.3;color:#1F2A2E;">${escapeHtml(subject)}</h1>
    <p style="margin:0 0 12px;font-size:14px;color:#4A5A5F;">From <strong style="color:#1F2A2E;">${escapeHtml(sender.name || sender.address)}</strong> &lt;${escapeHtml(sender.address)}&gt;<br>Sent to your PreCheckd address ${escapeHtml(aliasAddress)}</p>
    ${badge}${spamNote}
    <div style="margin:16px 0 0;padding:14px 16px;background:#F5F8F9;border:1px solid #DDE5E7;border-radius:8px;font-size:14px;white-space:pre-wrap;word-wrap:break-word;">${escapeHtml(shown) || '(no text)'}</div>
    <p style="margin:14px 0 0;font-size:13px;color:#6B7B80;">The message is shown as plain text for your safety. The original is attached as <em>forwarded_message.eml</em>${attachmentCount ? ` along with its ${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}` : ''}; only open attachments from people you trust.</p>`;

  const text = `Forwarded by PreCheckd\n\nFrom: ${sender.name ? `${sender.name} ` : ''}<${sender.address}>\nSent to: ${aliasAddress}\n${namespace === 'candidate' ? (senderCheck === 'verified_recruiter' ? 'Verified PreCheckd recruiter.' : 'NOT a verified PreCheckd recruiter. Be careful with links, attachments and requests for personal information.') : ''}\n\n${shown}\n\nThe original message is attached as forwarded_message.eml.`;

  return {
    html: brandShell({
      bodyHtml,
      preheader: `${sender.name || sender.address}: ${subject}`,
      footerHtml: 'You are receiving this because mail was sent to your PreCheckd address.'
    }),
    text
  };
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

// Stores the plain-text message for the owner's PreCheckd mail page. Never
// throws: the relay to the real inbox must not depend on this.
async function storeMessage({ emailId, full, aliasRow, sender, senderCheck, recruiterName, textBody }) {
  try {
    const spam = spamSuspected(full.headers);
    const body = String(textBody || '');
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
          subject: String(full.subject || '').slice(0, 300),
          textBody: body.slice(0, STORED_TEXT_CHARS),
          bodyTruncated: body.length > STORED_TEXT_CHARS,
          attachments: attachmentSummary(full),
          senderCheck,
          recruiterName,
          flagged: spam,
          flagReason: spam ? 'spam_verdict' : null,
          receivedAt: new Date()
        }
      },
      { upsert: true }
    );
  } catch (err) {
    console.error('[inbound] could not store message copy:', err.message);
  }
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
  if (virusFound(full.headers)) return settle(row, 'held', { reason: 'virus_verdict' });

  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recent = await InboundEmail.countDocuments({ aliasId: aliasRow._id, status: 'forwarded', receivedAt: { $gte: since } });
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

  const aliasAddress = addressFor(aliasRow.namespace, aliasRow.alias);
  const textBody = (full.text && full.text.trim()) || htmlToText(full.html);

  // Keep a copy in the owner's PreCheckd mail (roadmap #5). Best effort: if
  // saving fails the relay below still goes out, and the webhook retry (or a
  // later message) is unaffected.
  await storeMessage({ emailId, full, aliasRow, sender, senderCheck, recruiterName, textBody });

  const { html, text } = buildForwardEmail({
    sender,
    subject: full.subject || '(no subject)',
    textBody,
    senderCheck,
    recruiterName,
    aliasAddress,
    spam: spamSuspected(full.headers),
    attachmentCount,
    namespace: aliasRow.namespace
  });

  if (MOCK_EMAIL) {
    console.log(`[MOCK EMAIL] inbound relay to owner of ${aliasAddress}`);
    return settle(row, 'forwarded', { senderCheck, forwardedEmailId: 'mock' });
  }

  const from = `${safeDisplayName(sender.name, sender.address.split('@')[0])} via PreCheckd <${aliasAddress}>`;
  const { data, error } = await resend.emails.receiving.forward({
    emailId,
    to: owner.email,
    from,
    passthrough: false,
    html,
    text
  });
  if (error) {
    await settle(row, 'failed', { reason: String(error.message || error.name || 'send_error').slice(0, 200) });
    throw new Error(`Forward failed: ${error.message || error.name}`);
  }
  return settle(row, 'forwarded', { senderCheck, forwardedEmailId: data && data.id });
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

  const results = { forwarded: 0, held: 0, dropped: 0, duplicate: 0, unknown: targets.size - aliasRows.length };
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
  console.log(`[inbound] email.received id=${data.email_id} forwarded=${results.forwarded} held=${results.held} dropped=${results.dropped} duplicate=${results.duplicate} unknown_recipient=${results.unknown}`);
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
  parseSender, senderAuthenticated, virusFound, spamSuspected, htmlToText, safeDisplayName, buildForwardEmail
};
