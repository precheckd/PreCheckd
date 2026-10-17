// A verified candidate writes to someone outside PreCheckd (roadmap #4): a
// LinkedIn contact, an "email your resume to..." request, a referral. It goes
// out from the candidate's own PreCheckd address, so replies come back through
// Mail and their real email stays private.
//
// Safeguards live here, not in the route: fully verified candidates only (identity,
// phone and email), free-form text but ONE recipient (no CC/bulk), a daily cap, the
// same SSN/card/bank check as every other message, the shared do-not-contact list,
// a per-member "not interested" list, at most a few links, attachments limited
// to the member's own PreCheckd verified resume and Certificate of Verification
// (never an arbitrary upload), a footer saying a verified PreCheckd member wrote
// it, an opt-out/report link, and an automatic pause after repeated scam reports.
const { Resend } = require('resend');
const MailMessage = require('../models/MailMessage');
const MailBlock = require('../models/MailBlock');
const Suppression = require('../models/Suppression');
const { checkOutgoing } = require('../utils/messageSafety');
const { addressFor } = require('../utils/mailAlias');
const { mailChoiceUrl } = require('../utils/outreachToken');
const { generateCertificate } = require('../utils/certificateGenerator');
const { safeDisplayName } = require('./inboundEmail');

const resend = new Resend(process.env.RESEND_API_KEY);
const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';
const DAY_MS = 24 * 60 * 60 * 1000;
const DAILY_CAP = () => Number(process.env.MAIL_COMPOSE_DAILY_CAP) || 20;
const MAX_BODY_CHARS = 5000;
const MAX_SUBJECT_CHARS = 150;
const MAX_LINKS = 3;
const PAUSE_AFTER_REPORTS = 3;
const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const OWN_DOMAINS = ['in.precheckd.com', 'recruiters.precheckd.com'];

function oneLine(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isFullyVerified(c) {
  return Boolean(c && c.isIdentityVerified && c.isPhoneVerified && c.emailVerifiedAt);
}

function baseUrl() { return process.env.APP_BASE_URL || 'https://precheckd.com'; }

async function quotaFor(ownerId) {
  const used = await MailMessage.countDocuments({
    namespace: 'candidate', ownerId, direction: 'out', composed: true, receivedAt: { $gte: new Date(Date.now() - DAY_MS) }
  });
  return { left: Math.max(0, DAILY_CAP() - used), cap: DAILY_CAP() };
}

const COMPOSE_ERRORS = {
  disabled: 'Sending to people outside PreCheckd is not switched on yet.',
  not_verified: 'Only fully verified members (identity, phone and email) can send these emails.',
  bad_email: 'Enter a valid email address for the person you want to reach.',
  subject: 'Add a subject.',
  empty: 'Write a message before sending.',
  too_long: `Keep your message under ${MAX_BODY_CHARS} characters.`,
  links: `Your message can include at most ${MAX_LINKS} links.`,
  unsafe: 'Messages cannot include Social Security, card or bank account numbers. Take those out and try again.',
  paused: 'Sending is paused while PreCheckd staff review reports from recipients. Please contact support.',
  blocked: 'We cannot email this address. The person may have asked not to be contacted.',
  rate: "You've reached today's limit. Try again tomorrow.",
  no_resume: 'You have no resume on file to attach. Upload one on your profile first.',
  attach_failed: 'We could not prepare your attachment. Please try again, or send without it.',
  send_failed: 'The email could not be sent. Please try again in a few minutes.'
};

async function loadResume(candidate) {
  if (!candidate.resumeUrl) return null;
  try {
    const r = await fetch(candidate.resumeUrl);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch (e) {
    console.error('[compose] could not fetch resume:', e.message);
    return null;
  }
}

function footerFor(candidate, name, choiceUrl) {
  const lines = ['', '---'];
  lines.push(`${name} is a verified PreCheckd member: identity, phone and email have been checked.${candidate.publicVerifyPage ? ` See for yourself: ${baseUrl()}/verify/${candidate.slug}` : ''}`);
  lines.push('Reply to this email to answer directly. It goes through PreCheckd, so addresses stay private.');
  lines.push(`Not interested, or want to stop emails like this? ${choiceUrl}`);
  return lines.join('\n');
}

// candidate: Candidate doc; alias: their MailAlias row;
// input: { toEmail, subject, body, attachResume, attachCertificate }.
// Returns { ok: true, id } or { error, message? }.
async function sendNew({ candidate, alias, input, enabled }) {
  if (!enabled) return { error: 'disabled' };
  if (!isFullyVerified(candidate) || !alias) return { error: 'not_verified' };

  const toEmail = String(input.toEmail || '').trim().toLowerCase();
  if (toEmail.length > 254 || !EMAIL_RE.test(toEmail)) return { error: 'bad_email' };
  const domain = toEmail.split('@')[1];
  if (OWN_DOMAINS.includes(domain) || toEmail === String(candidate.email || '').toLowerCase()) return { error: 'bad_email' };

  const subject = oneLine(input.subject, MAX_SUBJECT_CHARS);
  if (!subject) return { error: 'subject' };
  const body = String(input.body || '').replace(/\r\n/g, '\n').trim();
  if (!body) return { error: 'empty' };
  if (body.length > MAX_BODY_CHARS) return { error: 'too_long' };
  if ((body.match(/https?:\/\/|www\./gi) || []).length > MAX_LINKS) return { error: 'links' };
  const unsafe = checkOutgoing(`${subject}\n${body}`);
  if (unsafe) return { error: 'unsafe', message: unsafe.message };

  const reports = await MailMessage.find({ namespace: 'candidate', ownerId: candidate._id, composed: true, recipientAction: 'scam_report', reportReviewed: false });
  if (reports.length >= PAUSE_AFTER_REPORTS) return { error: 'paused' };

  if (await Suppression.findOne({ value: { $in: [toEmail, domain] } })) return { error: 'blocked' };
  if (await MailBlock.findOne({ ownerId: candidate._id, toEmail })) return { error: 'blocked' };

  const quota = await quotaFor(candidate._id);
  if (quota.left <= 0) return { error: 'rate' };

  // Attachments: only the member's own verified resume / certificate, built here.
  const attachments = [];
  const first = oneLine(candidate.firstName, 40), last = oneLine(candidate.lastName, 40);
  const fileBase = [first, last].filter(Boolean).join('-').replace(/[^A-Za-z0-9-]/g, '') || 'Member';
  if (input.attachResume || input.attachCertificate) {
    try {
      const resume = input.attachResume ? await loadResume(candidate) : null;
      if (input.attachResume && !resume) return { error: 'no_resume' };
      if (resume) attachments.push({ filename: `PreCheckd-Verified-Resume-${fileBase}.pdf`, content: await generateCertificate(candidate, resume, baseUrl()) });
      if (input.attachCertificate) attachments.push({ filename: `PreCheckd-Certificate-of-Verification-${fileBase}.pdf`, content: await generateCertificate(candidate, null, baseUrl()) });
    } catch (e) {
      console.error('[compose] attachment failed:', e.message);
      return { error: 'attach_failed' };
    }
  }

  const name = oneLine([first, last].filter(Boolean).join(' '), 60);
  const fromAddress = addressFor('candidate', alias.alias);
  const displayName = safeDisplayName(name, alias.alias);

  // Stored first so the email's opt-out link can carry its id.
  const doc = await MailMessage.create({
    namespace: 'candidate', ownerId: candidate._id, aliasId: alias._id, direction: 'out', composed: true,
    fromAddress, fromName: displayName, toAddress: toEmail, subject, textBody: body,
    attachments: attachments.map((a) => ({ filename: a.filename, contentType: 'application/pdf', size: a.content.length })),
    readAt: new Date(), receivedAt: new Date()
  });
  const choiceUrl = mailChoiceUrl(doc._id);
  const text = `${body}\n\n${name}${footerFor(candidate, name, choiceUrl)}`;

  if (MOCK_EMAIL) {
    console.log(`[MOCK EMAIL] compose from ${fromAddress} to ${toEmail} | ${subject} | ${attachments.length} attachment(s)`);
  } else {
    const { data, error } = await resend.emails.send({
      from: `${displayName} <${fromAddress}>`,
      to: toEmail,
      replyTo: fromAddress,
      subject,
      text,
      attachments: attachments.length ? attachments : undefined,
      headers: { 'List-Unsubscribe': `<${choiceUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
    });
    if (error) {
      console.error('[compose] send failed:', error.message || error.name);
      await MailMessage.deleteOne({ _id: doc._id });
      return { error: 'send_failed' };
    }
    if (data && data.id) { doc.emailId = data.id; await doc.save(); }
  }
  return { ok: true, id: doc._id };
}

// The recipient's choice. Returns true when applied.
async function applyChoice(mailId, choice) {
  const msg = await MailMessage.findById(mailId);
  if (!msg || !msg.composed || msg.direction !== 'out') return false;
  const toEmail = String(msg.toAddress || '').toLowerCase();
  if (choice === 'stop_all') {
    await Suppression.updateOne(
      { value: toEmail },
      { $setOnInsert: { value: toEmail, type: 'address', reason: 'opt_out', note: 'Stopped all PreCheckd member email via compose link' } },
      { upsert: true }
    );
  } else if (choice === 'not_interested' || choice === 'scam_report') {
    await MailBlock.updateOne(
      { ownerId: msg.ownerId, toEmail },
      { $setOnInsert: { ownerId: msg.ownerId, toEmail, reason: choice } },
      { upsert: true }
    );
  } else {
    return false;
  }
  if (!(msg.recipientAction === 'scam_report' && choice !== 'scam_report')) {
    msg.recipientAction = choice;
    msg.recipientActionAt = new Date();
  }
  await msg.save();
  return true;
}

module.exports = { sendNew, applyChoice, quotaFor, isFullyVerified, COMPOSE_ERRORS, MAX_BODY_CHARS, MAX_SUBJECT_CHARS, DAILY_CAP };
