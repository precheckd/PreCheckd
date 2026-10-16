// Verified recruiter outreach (roadmap #4): a verified recruiter emails someone
// who is not yet on PreCheckd. The email goes out from the recruiter's own
// PreCheckd address (alias@recruiters.precheckd.com), so replies come back
// through PreCheckd and nobody's real address is exposed, and it carries a
// "Verified by PreCheckd" block that LINKS to the recruiter's live page (a
// pasted badge image would be easy to fake).
//
// Safeguards live here, not in the route: only fully verified recruiters, a
// template plus a short note (no free-form subject), daily and monthly caps,
// one email per address per 30 days, the shared do-not-contact list, a
// per-recruiter "not interested" list, the same SSN/card/bank check as in-site
// messages, no clickable links in the note, and an automatic pause after
// repeated scam reports. The recipient's page offers Not interested, Stop all,
// and Report as scam; List-Unsubscribe headers do the same from the mail app.
const { Resend } = require('resend');
const OutreachMessage = require('../models/OutreachMessage');
const OutreachBlock = require('../models/OutreachBlock');
const Suppression = require('../models/Suppression');
const { TEMPLATES } = require('../content/outreachTemplates');
const { checkOutgoing } = require('../utils/messageSafety');
const { addressFor } = require('../utils/mailAlias');
const { outreachChoiceUrl } = require('../utils/outreachToken');
const { brandShell, escapeHtml, FONT } = require('../utils/emailLayout');
const { safeDisplayName } = require('./inboundEmail');

const resend = new Resend(process.env.RESEND_API_KEY);
const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_NOTE_CHARS = 1000;
const MAX_NOTE_LINKS = 2;
const REPEAT_WINDOW_DAYS = 30;
const PAUSE_AFTER_REPORTS = 3;

const limits = () => ({
  daily: Number(process.env.OUTREACH_DAILY_CAP) || 10,
  monthly: Number(process.env.OUTREACH_MONTHLY_CAP) || 50
});
const enabled = () => process.env.OUTREACH_ENABLED === 'true';
const postalAddress = () => String(process.env.OUTREACH_POSTAL_ADDRESS || '').trim();

const EMAIL_RE = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;
const OWN_DOMAINS = ['in.precheckd.com', 'recruiters.precheckd.com'];

function oneLine(s, max) {
  return String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isFullyVerified(r) {
  return Boolean(r && r.accountTier === 'standard' && r.isActive && !r.isSuspended && r.isPhoneVerified && r.isIdentityVerified);
}

function companyOf(recruiter) {
  const c = String(recruiter.company || '').trim();
  return c && c !== 'Not provided' ? oneLine(c, 80) : '';
}

function profileUrl(recruiter) {
  return `${process.env.APP_BASE_URL || 'https://precheckd.com'}/recruiter/${recruiter.slug}`;
}

// What the sender may still send, for the form.
async function quotaFor(recruiterId) {
  const { daily, monthly } = limits();
  const [today, month] = await Promise.all([
    OutreachMessage.countDocuments({ recruiterId, status: 'sent', sentAt: { $gte: new Date(Date.now() - DAY_MS) } }),
    OutreachMessage.countDocuments({ recruiterId, status: 'sent', sentAt: { $gte: new Date(Date.now() - 30 * DAY_MS) } })
  ]);
  return { dailyLeft: Math.max(0, daily - today), monthlyLeft: Math.max(0, monthly - month), daily, monthly };
}

// --- The email itself -------------------------------------------------------

function buildEmail({ recruiter, template, first, role, note, messageId }) {
  const name = oneLine([recruiter.firstName, recruiter.lastName].filter(Boolean).join(' '), 60);
  const company = companyOf(recruiter);
  const intro = template.intro({ first, recruiter: name, company, role });
  const choiceUrl = outreachChoiceUrl(messageId);
  const profile = profileUrl(recruiter);
  const postal = postalAddress();

  const text = [
    intro,
    note ? `\n${note}` : '',
    `\n${name}`,
    `\n---\nVerified by PreCheckd: ${name}'s identity and phone number have been verified. Check it yourself: ${profile}`,
    'Reply to this email to answer directly. It goes through PreCheckd, so your address stays private.',
    `\nNot interested, or want to stop these emails? ${choiceUrl}`,
    `PreCheckd, ${postal}`
  ].filter(Boolean).join('\n');

  const para = (s) => escapeHtml(s).replace(/\n/g, '<br>');
  const bodyHtml = `
    <p style="margin:0 0 14px;font-family:${FONT};font-size:15px;">${para(intro)}</p>
    ${note ? `<p style="margin:0 0 14px;font-family:${FONT};font-size:15px;">${para(note)}</p>` : ''}
    <p style="margin:0 0 18px;font-family:${FONT};font-size:15px;">${escapeHtml(name)}${company ? `<br><span style="color:#5B6B70;">${escapeHtml(company)}</span>` : ''}</p>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:6px 0 14px;"><tr><td style="background:#EAF8F0;border:1px solid #2ECC71;border-radius:8px;padding:12px 14px;font-family:${FONT};font-size:14px;color:#14532D;">
      <strong>&#10003; Verified by PreCheckd.</strong> ${escapeHtml(name)}'s identity and phone number have been verified.
      <a href="${profile}" style="color:#14532D;font-weight:700;">See their live verification page</a> (this badge is a link, not a picture, so it can't be faked).
    </td></tr></table>
    <p style="margin:0;font-family:${FONT};font-size:13px;color:#5B6B70;">Reply to this email to answer directly. It goes through PreCheckd, so your address stays private.</p>`;
  const footerHtml = `You are receiving this one email because a verified recruiter reached out through PreCheckd. <a href="${choiceUrl}" style="color:#5B6B70;">Not interested, stop these emails, or report this as a scam</a>.<br>PreCheckd, ${escapeHtml(postal)}`;
  return { text, html: brandShell({ bodyHtml, preheader: `${name} is a verified recruiter`, footerHtml }), choiceUrl };
}

// --- Sending ------------------------------------------------------------------

// recruiter: Recruiter doc; alias: their MailAlias row; input: { toEmail,
// toName, templateKey, role, note }. Returns { ok: true, id } or { error }.
async function sendOutreach({ recruiter, alias, input }) {
  if (!enabled()) return { error: 'disabled' };
  if (!postalAddress() && !MOCK_EMAIL) return { error: 'not_configured' };
  if (!isFullyVerified(recruiter) || !alias) return { error: 'not_verified' };

  const template = TEMPLATES[input.templateKey];
  if (!template) return { error: 'template' };

  const toEmail = String(input.toEmail || '').trim().toLowerCase();
  if (toEmail.length > 254 || !EMAIL_RE.test(toEmail)) return { error: 'bad_email' };
  const domain = toEmail.split('@')[1];
  if (OWN_DOMAINS.includes(domain)) return { error: 'bad_email' };
  if (toEmail === String(recruiter.email || '').toLowerCase()) return { error: 'bad_email' };

  const role = oneLine(input.role, 80);
  if (template.needsRole && (!role || /https?:|www\.|@/i.test(role))) return { error: 'role' };
  const note = String(input.note || '').replace(/\r\n/g, '\n').trim();
  if (note.length > MAX_NOTE_CHARS) return { error: 'note_long' };
  if ((note.match(/https?:\/\/|www\./gi) || []).length > MAX_NOTE_LINKS) return { error: 'note_links' };
  const unsafe = checkOutgoing(note);
  if (unsafe) return { error: 'unsafe', message: unsafe.message };

  // Reports staff have not yet reviewed (npm run mail-alias -- outreach-reviewed <recruiter-email> clears the pause).
  const reports = (await OutreachMessage.find({ recruiterId: recruiter._id, recipientAction: 'scam_report' })).filter((m) => !m.reportReviewed);
  if (reports.length >= PAUSE_AFTER_REPORTS) return { error: 'paused' };

  if (await Suppression.findOne({ value: { $in: [toEmail, domain] } })) return { error: 'blocked' };
  if (await OutreachBlock.findOne({ recruiterId: recruiter._id, toEmail })) return { error: 'blocked' };

  const recent = await OutreachMessage.findOne({
    recruiterId: recruiter._id, toEmail, status: 'sent', sentAt: { $gte: new Date(Date.now() - REPEAT_WINDOW_DAYS * DAY_MS) }
  });
  if (recent) return { error: 'duplicate' };

  const quota = await quotaFor(recruiter._id);
  if (quota.dailyLeft <= 0) return { error: 'daily_cap' };
  if (quota.monthlyLeft <= 0) return { error: 'monthly_cap' };

  const recruiterName = oneLine([recruiter.firstName, recruiter.lastName].filter(Boolean).join(' '), 60);
  const first = oneLine(input.toName, 40).split(' ')[0] || 'there';
  const subject = oneLine(template.subject({ recruiter: recruiterName, role }), 120);

  // Created first so the email's link can carry its id; counts toward the caps only once sent.
  const doc = await OutreachMessage.create({
    recruiterId: recruiter._id, toEmail, toName: oneLine(input.toName, 40), templateKey: input.templateKey,
    role, note, subject, status: 'failed'
  });

  const mail = buildEmail({ recruiter, template, first, role, note, messageId: doc._id });
  const fromAddress = addressFor('recruiter', alias.alias);
  const displayName = `${safeDisplayName(recruiterName, alias.alias)} via PreCheckd`;

  if (MOCK_EMAIL) {
    console.log(`[MOCK EMAIL] outreach from ${fromAddress} to ${toEmail} | ${subject}`);
  } else {
    const { data, error } = await resend.emails.send({
      from: `${displayName} <${fromAddress}>`,
      to: toEmail,
      replyTo: fromAddress,
      subject,
      text: mail.text,
      html: mail.html,
      headers: {
        'List-Unsubscribe': `<${mail.choiceUrl}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
      }
    });
    if (error) {
      console.error('[outreach] send failed:', error.message || error.name);
      return { error: 'send_failed' };
    }
    doc.emailId = data && data.id ? data.id : null;
  }
  doc.status = 'sent';
  doc.sentAt = new Date();
  await doc.save();
  return { ok: true, id: doc._id };
}

// The recipient's choice. Returns true when applied.
async function applyChoice(messageId, choice) {
  const msg = await OutreachMessage.findById(messageId);
  if (!msg) return false;
  if (choice === 'stop_all') {
    await Suppression.updateOne(
      { value: msg.toEmail },
      { $setOnInsert: { value: msg.toEmail, type: 'address', reason: 'opt_out', note: 'Stopped all recruiter email via outreach link' } },
      { upsert: true }
    );
  } else if (choice === 'not_interested' || choice === 'scam_report') {
    await OutreachBlock.updateOne(
      { recruiterId: msg.recruiterId, toEmail: msg.toEmail },
      { $setOnInsert: { recruiterId: msg.recruiterId, toEmail: msg.toEmail, reason: choice } },
      { upsert: true }
    );
  } else {
    return false;
  }
  // A scam report is never downgraded by a later, milder choice.
  if (!(msg.recipientAction === 'scam_report' && choice !== 'scam_report')) {
    msg.recipientAction = choice;
    msg.recipientActionAt = new Date();
  }
  await msg.save();
  return true;
}

module.exports = { sendOutreach, applyChoice, quotaFor, buildEmail, isFullyVerified, enabled, TEMPLATES, MAX_NOTE_CHARS };
