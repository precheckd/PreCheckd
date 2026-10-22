const { properName } = require('../utils/properName');
const { Resend } = require('resend');
const crypto = require('crypto');
const { brandShell, emailButton, escapeHtml } = require('../utils/emailLayout');

const resend = new Resend(process.env.RESEND_API_KEY);

const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';

// Every send in this file goes through here instead of calling
// resend.emails.send directly — with MOCK_EMAIL=true, nothing actually
// goes out, it just logs to the console. Use this during testing so you
// can use made-up/fake "reported" addresses without emailing real people,
// the same way MOCK_SMS/MOCK_IDENTITY already work for phone/identity.
// Every email gets the PreCheckd look. Bodies written as plain fragments
// (<p>...</p>) are wrapped in the branded layout here, so a new email can never
// go out unbranded; bodies that already are full branded documents pass through.
function brandedHtml(html, subject) {
  if (/^\s*<!doctype/i.test(html || '')) return html;
  const body = String(html || '')
    .replace(/<a href=/g, '<a style="color:#1B8A4B;font-weight:600;" href=')
    .replace(/<p>/g, '<p style="margin:0 0 14px;">');
  return brandShell({
    bodyHtml: body,
    preheader: subject || '',
    footerHtml: 'This is an automated message from PreCheckd.'
  });
}

async function sendEmail(rawParams) {
  const params = { ...rawParams, html: brandedHtml(rawParams.html, rawParams.subject) };
  if (MOCK_EMAIL) {
    console.log(`[MOCK EMAIL] To: ${params.to} | Subject: ${params.subject}`);
    console.log(params.html);
    return { mock: true };
  }

  return resend.emails.send(params);
}

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/founding-recruiter/verify-email?token=${token}`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Verify your email for PreCheckd',
    html: `
      <p>Hi ${properName(firstName)},</p>
      <p>Click the link below to verify your email address for your PreCheckd profile:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 48 hours. If you didn't sign up for PreCheckd, you can safely ignore this email.</p>
    `,
  });
}

// Used three ways, all through the same /reset-password/:token page:
//   1. A recruiter or candidate who clicked "Forgot password"
//   2. An account created before passwords existed, getting its one-time
//      migration link to set a password for the first time
//   3. (future) A claim-account invite, once that flow is built
async function sendPasswordResetEmail(toEmail, firstName, token, { isFirstTime = false } = {}) {
  const resetUrl = `${process.env.APP_BASE_URL}/reset-password/${token}`;

  const subject = isFirstTime ? 'Set your PreCheckd password' : 'Reset your PreCheckd password';
  const intro = isFirstTime
    ? `We've moved to password-based logins. Click below to set a password for your PreCheckd account:`
    : `Click the link below to set a new password for your PreCheckd account:`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject,
    html: `
      <p>Hi ${properName(firstName)},</p>
      <p>${intro}</p>
      <p><a href="${resetUrl}">${resetUrl}</a></p>
      <p>This link expires in 30 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

async function sendCandidateVerificationLink(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/candidate/verify-email?token=${token}`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Verify your email for PreCheckd',
    html: `
      <p>Hi ${properName(firstName)},</p>
      <p>Click the link below to verify your email address for your PreCheckd profile:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 48 hours. If you didn't sign up for PreCheckd, you can safely ignore this email.</p>
    `,
  });
}

async function sendConnectionAcceptedEmail(candidateEmail, candidateFirstName, recruiterName) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `${recruiterName} accepted your connection request`,
    html: `
      <p>Hi ${properName(candidateFirstName)},</p>
      <p><strong>${recruiterName}</strong> accepted your connection request on PreCheckd.</p>
      <p>You can now message them directly through your PreCheckd inbox.</p>
    `,
  });
}

async function sendConnectionDeclinedEmail(candidateEmail, candidateFirstName, recruiterName) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `Update on your connection request`,
    html: `
      <p>Hi ${properName(candidateFirstName)},</p>
      <p><strong>${recruiterName}</strong> declined your connection request on PreCheckd.</p>
      <p>Don't be discouraged — keep browsing and connecting with other verified recruiters.</p>
    `,
  });
}

// Recruiter-facing counterparts to sendConnectionAcceptedEmail/
// sendConnectionDeclinedEmail above, for when the CANDIDATE is the one
// responding — i.e. the connection request was recruiter-initiated
// (via /candidate-search), so the recruiter is the party waiting on a
// decision rather than the one who made it.
async function sendRecruiterConnectionAcceptedEmail(recruiterEmail, recruiterFirstName, candidateDisplayName) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: recruiterEmail,
    subject: `${candidateDisplayName} accepted your connection request`,
    html: `
      <p>Hi ${properName(recruiterFirstName)},</p>
      <p><strong>${candidateDisplayName}</strong> accepted your connection request on PreCheckd.</p>
      <p>You can now view their full profile and message them directly through your PreCheckd dashboard.</p>
    `,
  });
}

async function sendRecruiterConnectionDeclinedEmail(recruiterEmail, recruiterFirstName, candidateDisplayName) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: recruiterEmail,
    subject: `Update on your connection request`,
    html: `
      <p>Hi ${properName(recruiterFirstName)},</p>
      <p><strong>${candidateDisplayName}</strong> declined your connection request on PreCheckd.</p>
    `,
  });
}

async function sendNewMessageEmail(toEmail, recipientFirstName, senderName, subject) {
  const inboxUrl = `${process.env.APP_BASE_URL}/messages`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: subject ? `New message: ${subject}` : `You have a new message on PreCheckd`,
    html: `
      <p>Hi ${properName(recipientFirstName)},</p>
      <p><strong>${senderName}</strong> sent you a message on PreCheckd.</p>
      <p><a href="${inboxUrl}">View it in your inbox</a></p>
    `,
  });
}

// Daily digest of unread messages. Deliberately names who they're from and
// how many, never what they said — the point is to bring people back to the
// site, and message content doesn't belong in email.
async function sendMessageDigestEmail(toEmail, recipientFirstName, senders) {
  const inboxUrl = `${process.env.APP_BASE_URL}/messages`;
  const total = senders.reduce((sum, s) => sum + s.count, 0);
  const escape = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const lines = senders
    .map((s) => `<li><strong>${escape(s.name)}</strong> — ${s.count} unread message${s.count === 1 ? '' : 's'}</li>`)
    .join('');

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: total === 1 ? 'You have an unread message on PreCheckd' : `You have ${total} unread messages on PreCheckd`,
    html: `
      <p>Hi ${escape(properName(recipientFirstName))},</p>
      <p>You have messages waiting on PreCheckd:</p>
      <ul>${lines}</ul>
      <p><a href="${inboxUrl}">Open your inbox</a> to read and reply — conversations stay on PreCheckd, where your verified identity protects you.</p>
    `,
  });
}

// Heads-up that one or more certifications are expiring (or just expired).
// `certs` is [{ name, daysLeft, expiresOn: "YYYY-MM-DD" }]. Links to Edit
// Profile, where the "Check for new certifications" button picks up a
// renewal from Credly.
async function sendCertExpiryReminderEmail(toEmail, firstName, slug, certs) {
  const editUrl = `${process.env.APP_BASE_URL}/candidate/${slug}/edit`;
  const escape = (str) => String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const formatDate = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC'
  });
  const when = (c) => {
    if (c.daysLeft > 1) return `expires in ${c.daysLeft} days (${formatDate(c.expiresOn)})`;
    if (c.daysLeft === 1) return `expires tomorrow (${formatDate(c.expiresOn)})`;
    if (c.daysLeft === 0) return `expires today (${formatDate(c.expiresOn)})`;
    return `expired on ${formatDate(c.expiresOn)}`;
  };

  const sorted = [...certs].sort((a, b) => a.daysLeft - b.daysLeft);
  const first = sorted[0];
  const subject = sorted.length === 1
    ? `Your ${first.name} certification ${when(first).split(' (')[0]}`
    : `${sorted.length} of your certifications are expiring soon`;

  const badge = (c) => {
    const label = c.daysLeft < 0 ? 'Expired'
      : c.daysLeft === 0 ? 'Today'
      : c.daysLeft === 1 ? '1 day left'
      : `${c.daysLeft} days left`;
    const [bg, fg] = c.daysLeft < 0 ? ['#FDECEA', '#B3261E'] : c.daysLeft <= 7 ? ['#FFF3DC', '#9A5B00'] : ['#E8F6EE', '#1B7F4B'];
    return `<span style="display:inline-block;background:${bg};color:${fg};font-size:12px;font-weight:700;padding:3px 10px;border-radius:999px;">${label}</span>`;
  };

  const cards = sorted.map((c) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 10px;border:1px solid #DDE5E7;border-left:4px solid ${c.daysLeft < 0 ? '#B3261E' : c.daysLeft <= 7 ? '#E59A1A' : '#2ECC71'};border-radius:8px;"><tr>
      <td style="padding:12px 14px;">
        <div style="font-weight:700;font-size:16px;color:#1F2A2E;">${escape(c.name)}</div>
        <div style="font-size:13px;color:#6B7B80;margin-top:2px;">${c.daysLeft < 0 ? 'Expired' : 'Expires'} ${formatDate(c.expiresOn)}</div>
      </td>
      <td align="right" style="padding:12px 14px;white-space:nowrap;vertical-align:middle;">${badge(c)}</td>
    </tr></table>`).join('');

  const headline = sorted.length === 1
    ? (first.daysLeft < 0 ? 'Your certification has expired' : 'Your certification is expiring soon')
    : 'Your certifications are expiring soon';

  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1B7F4B;">Certification reminder</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#1F2A2E;">${headline}</h1>
    <p style="margin:0 0 16px;">Hi ${escape(properName(firstName))}, a quick heads-up about your profile:</p>
    ${cards}
    <p style="margin:16px 0 0;">Keeping your certifications current keeps your verified profile strong. Once a certification expires, it no longer shows as verified to recruiters.</p>
    ${emailButton(editUrl, 'Update my certifications')}
    <p style="margin:14px 0 0;font-size:14px;color:#4A5A5F;">Already renewed? Open Edit Profile and use <em>Check for new certifications</em> (or update the date) and we&rsquo;ll pick it up.</p>`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject,
    html: brandShell({
      bodyHtml,
      preheader: sorted.length === 1
        ? `${first.name} ${when(first).split(' (')[0]}. Keep your verified profile current.`
        : `${sorted.length} certifications need attention to stay verified.`,
      footerHtml: 'You are receiving this because a certification on your PreCheckd profile is expiring.',
    }),
  });
}

// A skills-test notice (results ready, review outcome, retake open, ...). `notice` is
// { subject, headline, paragraphs[], button, reminder }. Never carries scores or review reasons.
async function sendSkillNoticeEmail(toEmail, firstName, slug, notice) {
  const url = `${process.env.APP_BASE_URL || 'https://precheckd.com'}/candidate/${slug}/skills`;
  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1B7F4B;">Skills</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#1F2A2E;">${escapeHtml(notice.headline)}</h1>
    <p style="margin:0 0 14px;">Hi ${escapeHtml(properName(firstName))},</p>
    ${notice.paragraphs.map((t) => `<p style="margin:0 0 14px;">${escapeHtml(t)}</p>`).join('')}
    ${emailButton(url, notice.button)}`;
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: notice.subject,
    html: brandShell({
      bodyHtml,
      preheader: notice.headline,
      footerHtml: notice.reminder
        ? 'You are receiving this because of a skills test on your PreCheckd account. You can turn these reminders off on your Skills page.'
        : 'You are receiving this because of a skills test on your PreCheckd account.'
    })
  });
}

// Generic nudge to a candidate that PreCheckd Verification wrote to them. Never says what about: the details
// are only in their PreCheckd inbox, which is also the one place we ask for anything.
async function sendVerificationNoticeEmail(toEmail, firstName, caseId) {
  const url = `${process.env.APP_BASE_URL || 'https://precheckd.com'}/messages/verification/${caseId}`;
  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1B7F4B;">Verification</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#1F2A2E;">You have a message from PreCheckd Verification</h1>
    <p style="margin:0 0 14px;">Hi ${escapeHtml(properName(firstName))},</p>
    <p style="margin:0 0 14px;">We sent you a message about an item on your profile. Sign in to read it and reply.</p>
    <p style="margin:0 0 14px;">PreCheckd will never ask you for anything by email. Verification questions are only ever asked in your PreCheckd inbox.</p>
    ${emailButton(url, 'Open my message')}`;
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'You have a message from PreCheckd Verification',
    html: brandShell({ bodyHtml, preheader: 'Open your PreCheckd inbox to read it', footerHtml: 'You are receiving this because we are verifying an item on your PreCheckd profile.' })
  });
}

// Asks an employer or school to confirm one entry. Facts only, nothing sensitive requested. Replies go to
// VERIFICATION_REPLY_TO (a mailbox staff read).
async function sendEmployerVerificationEmail({ to, contactName, kind, candidateName, subject, detail, dates, attempt }) {
  const isWork = kind === 'workHistory';
  const lines = [
    `${candidateName} has asked PreCheckd to confirm the following${isWork ? ' employment' : ' education'} ${isWork ? 'with your organization' : 'at your institution'}:`
  ];
  const factHtml = [[isWork ? 'Job title' : 'Degree', detail], ['Dates', dates], [isWork ? 'Employer' : 'School', subject]]
    .filter((r) => r[1]).map((r) => `<tr><td style="padding:2px 14px 2px 0;color:#5A6B70;">${escapeHtml(r[0])}</td><td style="padding:2px 0;font-weight:600;">${escapeHtml(r[1])}</td></tr>`).join('');
  const reply = process.env.VERIFICATION_REPLY_TO || 'verifications@precheckd.com';
  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1B7F4B;">Verification request</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#1F2A2E;">${isWork ? 'Can you confirm an employment record?' : 'Can you confirm an education record?'}</h1>
    <p style="margin:0 0 14px;">${contactName ? `Hello ${escapeHtml(contactName)},` : 'Hello,'}</p>
    <p style="margin:0 0 14px;">${escapeHtml(lines[0])}</p>
    <table style="margin:0 0 14px;font-size:15px;">${factHtml}</table>
    <p style="margin:0 0 14px;">Please reply to this email to say whether this is accurate${isWork ? ' (title and dates are all we need)' : ' (degree and graduation date are all we need)'}. We do not need salary, performance or any other personal details, and please do not send any.</p>
    <p style="margin:0 0 14px;">PreCheckd is a service that verifies the facts on a person's profile before recruiters see them. ${attempt > 1 ? 'This is a follow-up to our earlier request.' : ''}</p>`;
  return sendEmail({
    from: 'PreCheckd Verification <noreply@precheckd.com>',
    replyTo: reply,
    to,
    subject: `${isWork ? 'Employment' : 'Education'} verification request: ${candidateName}`,
    html: brandShell({ bodyHtml, preheader: 'A short fact check, reply to confirm', footerHtml: 'You are receiving this because a person listed your organization on their PreCheckd profile. Reply to this email if it reached you in error.' })
  });
}

// A plain alert to the staff mailbox (STAFF_ALERT_EMAIL). Without it the alert is only logged.
async function sendStaffAlertEmail({ subject, headline, paragraphs, buttonUrl, buttonLabel }) {
  const to = process.env.STAFF_ALERT_EMAIL;
  if (!to) { console.log(`[staff alert, no STAFF_ALERT_EMAIL set] ${subject}`); return null; }
  const bodyHtml = `
    <p style="margin:0 0 6px;font-size:13px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;color:#1B7F4B;">Staff</p>
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.25;color:#1F2A2E;">${escapeHtml(headline)}</h1>
    ${paragraphs.map((t) => `<p style="margin:0 0 14px;">${escapeHtml(t)}</p>`).join('')}
    ${buttonUrl ? emailButton(buttonUrl, buttonLabel || 'Open') : ''}`;
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to,
    subject,
    html: brandShell({ bodyHtml, preheader: headline, footerHtml: 'Internal alert for PreCheckd staff.' })
  });
}

// --- Weekly candidate emails ---------------------------------------------
// Monday recap and Thursday unread-messages email (services/weeklyEmails.js).
// Names who messages are from and how many, never what they said. Each email
// carries a signed unsubscribe link plus List-Unsubscribe headers.
const { unsubscribeUrl } = require('../utils/emailUnsubscribe');

function weeklyEscape(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function weeklyButton(href, label) {
  return `<p style="margin: 14px 0 0;"><a href="${href}" style="display:inline-block;background:#2ECC71;color:#12262B;font-weight:700;text-decoration:none;padding:10px 18px;border-radius:8px;">${weeklyEscape(label)}</a></p>`;
}

function weeklyShell(firstName, intro, sectionsHtml, unsubUrl, settingsUrl) {
  return brandShell({
    bodyHtml: `<p style="margin:0 0 14px;">Hi ${weeklyEscape(properName(firstName))},</p>
        ${intro ? `<p style="margin:0 0 6px;">${intro}</p>` : ''}
        ${sectionsHtml}`,
    footerHtml: `You get this email because you have a PreCheckd candidate account.<br>
        <a href="${unsubUrl}" style="color:#6B7B80;">Unsubscribe</a> from these weekly emails, or manage it in <a href="${settingsUrl}" style="color:#6B7B80;">Edit Profile</a>.`,
  });
}

function weeklySection(title, bodyHtml) {
  return `<div style="margin-top:22px;padding-top:16px;border-top:1px solid #E6ECEE;"><div style="font-weight:700;font-size:15px;margin-bottom:6px;">${weeklyEscape(title)}</div>${bodyHtml}</div>`;
}

function senderList(senders) {
  return `<ul style="margin:6px 0 0;padding-left:20px;">${senders
    .map((s) => `<li><strong>${weeklyEscape(s.name)}</strong> — ${s.count} unread message${s.count === 1 ? '' : 's'}</li>`)
    .join('')}</ul>`;
}

function formatWeeklyDate(iso) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

// "Jobs you qualify for": the full list, each one a job the candidate can apply to right now.
function weeklyJobsSection(jobs, base) {
  const lines = jobs.map((j) => `<li><a href="${base}${j.path}" style="color:#1B7F4B;font-weight:700;">${weeklyEscape(j.title)}</a> at ${weeklyEscape(j.company)}<br><span style="font-size:14px;color:#52666C;">${weeklyEscape(j.location)} · ${weeklyEscape(j.pay)}</span></li>`).join('');
  return weeklySection('Jobs you qualify for', `<ul style="margin:0;padding-left:20px;">${lines}</ul><p style="margin:8px 0 0;font-size:14px;">You meet every requirement for these, so you can apply right now.</p>${weeklyButton(`${base}/jobs`, 'See all open jobs')}`);
}

async function sendWeeklyRecapEmail(candidate, recap) {
  const base = process.env.APP_BASE_URL;
  const unsubUrl = unsubscribeUrl(candidate._id.toString());
  const settingsUrl = `${base}/candidate/${candidate.slug}/edit`;
  const sections = [];

  if (recap.jobs && recap.jobs.length > 0) sections.push(weeklyJobsSection(recap.jobs, base));

  if (recap.unread.total > 0) {
    sections.push(`<div style="margin-top:14px;background:#F2FAF5;border:1px solid #BFE8CF;border-radius:10px;padding:14px 16px;">
      <div style="font-weight:700;font-size:17px;">You have ${plural(recap.unread.total, 'unread message', 'unread messages')}</div>
      ${senderList(recap.unread.senders)}
      ${weeklyButton(`${base}/mail`, 'Open your Mail')}
    </div>`);
  }

  const waiting = [];
  if (recap.pendingRequests > 0) waiting.push(`<li>${plural(recap.pendingRequests, 'connection request is', 'connection requests are')} waiting for your answer</li>`);
  if (recap.fullAccessRequests > 0) waiting.push(`<li>${plural(recap.fullAccessRequests, 'recruiter has', 'recruiters have')} asked for access to your video and resume</li>`);
  if (waiting.length > 0) {
    sections.push(weeklySection('Waiting on you', `<ul style="margin:0;padding-left:20px;">${waiting.join('')}</ul>${weeklyButton(`${base}/connections`, 'Review requests')}`));
  }

  const activity = [];
  if (recap.newConnections > 0) activity.push(`<li>${plural(recap.newConnections, 'new connection', 'new connections')} this week</li>`);
  if (recap.views > 0) activity.push(`<li>${plural(recap.views, 'person', 'people')} viewed your profile this week</li>`);
  if (activity.length > 0) {
    sections.push(weeklySection('Your week', `<ul style="margin:0;padding-left:20px;">${activity.join('')}</ul>`));
  }

  if (recap.expiringCerts.length > 0) {
    const lines = recap.expiringCerts.map((c) => {
      const when = c.daysLeft === 0 ? 'expires today' : c.daysLeft === 1 ? 'expires tomorrow' : `expires in ${c.daysLeft} days`;
      return `<li><strong>${weeklyEscape(c.name)}</strong> ${when} (${formatWeeklyDate(c.expiresOn)})</li>`;
    }).join('');
    sections.push(weeklySection('Certifications expiring soon', `<ul style="margin:0;padding-left:20px;">${lines}</ul><p style="margin:8px 0 0;font-size:14px;">Once a certification expires it stops showing as verified to recruiters.</p>`));
  }

  if (recap.todo.length > 0) {
    const lines = recap.todo.map((t) => `<li>${weeklyEscape(t.text)} <a href="${base}${t.path}" style="color:#1B7F4B;">Go</a></li>`).join('');
    sections.push(weeklySection('Worth doing', `<ul style="margin:0;padding-left:20px;">${lines}</ul>`));
  }

  if (recap.whatsNew.length > 0) {
    sections.push(weeklySection('What\'s new on PreCheckd', `<ul style="margin:0;padding-left:20px;">${recap.whatsNew.map((t) => `<li>${weeklyEscape(t)}</li>`).join('')}</ul>`));
  }

  if (recap.tip) {
    sections.push(weeklySection('Stay safe out there', `<p style="margin:0;">${weeklyEscape(recap.tip)}</p>`));
  }

  const subject = recap.unread.total > 0
    ? `You have ${plural(recap.unread.total, 'unread message', 'unread messages')} on PreCheckd`
    : 'Your week on PreCheckd';

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidate.email,
    subject,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    },
    html: weeklyShell(candidate.firstName, '', sections.join(''), unsubUrl, settingsUrl),
  });
}

async function sendUnreadMessagesEmail(candidate, { fresh, totalUnread }) {
  const base = process.env.APP_BASE_URL;
  const unsubUrl = unsubscribeUrl(candidate._id.toString());
  const settingsUrl = `${base}/candidate/${candidate.slug}/edit`;

  const body = `<div style="margin-top:14px;background:#F2FAF5;border:1px solid #BFE8CF;border-radius:10px;padding:14px 16px;">
      <div style="font-weight:700;font-size:17px;">${plural(fresh.total, 'new message', 'new messages')} since Monday</div>
      ${senderList(fresh.senders)}
      ${totalUnread > fresh.total ? `<p style="margin:10px 0 0;font-size:14px;">That's ${totalUnread} unread in total.</p>` : ''}
      ${weeklyButton(`${base}/mail`, 'Open your Mail')}
    </div>
    <p style="margin:14px 0 0;font-size:14px;">Conversations stay on PreCheckd, where your verified identity protects you.</p>`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidate.email,
    subject: fresh.total === 1 ? 'You have a new message on PreCheckd' : `You have ${fresh.total} new messages on PreCheckd`,
    headers: {
      'List-Unsubscribe': `<${unsubUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click'
    },
    html: weeklyShell(candidate.firstName, '', body, unsubUrl, settingsUrl),
  });
}

async function sendFraudReportThankYouEmail(toEmail, couponCode) {
  const candidateLandingUrl = `${process.env.APP_BASE_URL}/candidate-landing`;
  const recruiterSearchUrl = `${process.env.APP_BASE_URL}/recruiter-search`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Thanks for reporting — here\'s what happens next',
    html: `
      <p>Hi,</p>
      <p>Thanks for taking the time to report a suspicious recruiter to PreCheckd. Here's what happens next:</p>
      <ol>
        <li>Your report is logged immediately and checked against every PreCheckd recruiter account.</li>
        <li>If it matches an existing account, that's flagged for review, and depending on the recruiter's verification status, we may reach out to them.</li>
        <li>Our team reviews new reports directly — this isn't fully automated yet, so a real person looks at what you submitted.</li>
      </ol>
      ${couponCode ? `
      <p>As a thank-you, here's a code good for 20% off PreCheckd once our paid features launch:</p>
      <p style="font-size: 1.3em; font-weight: bold; letter-spacing: 0.08em; color: #1F363C;">${couponCode}</p>
      <p>Save this — we'll let you know when it's ready to use.</p>
      ` : ''}
      <p>In the meantime, see how PreCheckd verifies every recruiter before they can reach candidates:</p>
      <p><a href="${candidateLandingUrl}">For Candidates</a> &middot; <a href="${recruiterSearchUrl}">Browse Verified Recruiters</a></p>
    `,
  });
}

// Sent to a recruiter email that was named in a fraud/review report but
// doesn't match any existing PreCheckd account. Not a marketing email and
// never advertised anywhere — the only way anyone gets this is by being
// named in a report. Reuses the same /reset-password/:token page to let
// them set a password and claim the account.
async function sendFraudClaimInviteEmail(toEmail, token) {
  const claimUrl = `${process.env.APP_BASE_URL}/reset-password/${token}`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Someone left feedback about you on PreCheckd',
    html: `
      <p>Hi,</p>
      <p>A candidate submitted feedback on PreCheckd about an experience with a recruiter at this email address.</p>
      <p>Create an account to see what was reported:</p>
      <p><a href="${claimUrl}">${claimUrl}</a></p>
      <p>This link expires in 14 days and can only be used once. If you believe this was sent in error, you can safely ignore it.</p>
    `,
  });
}

// Verifies someone actually owns the email they typed into the public
// fraud report form, before that submission is allowed to do anything
// (create a claim account, email a recruiter, etc.). No account, no
// password — just proof of inbox access for this one submission.
async function sendFraudReporterVerificationEmail(toEmail, code) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd verification code',
    html: `
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>Enter this code to continue your fraud report. It expires in 10 minutes.</p>
    `,
  });
}

// Sent to an existing, already-active account (standard or a previously
// claimed account — anything with a password set) when a new report names
// them by exact email match. Deliberately neutral: no description of what
// was reported, no verdict, just "something's on file, go look." At most
// one of these per account per 24 hours (see Recruiter.lastFraudNotifiedAt)
// so several same-day reports don't read as a pile-on.
async function sendFraudReportNoticeEmail(toEmail) {
  const loginUrl = `${process.env.APP_BASE_URL}/login`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'A report was filed about your PreCheckd account',
    html: `
      <p>Hi,</p>
      <p>A candidate submitted feedback on PreCheckd mentioning your account. This hasn't been reviewed or verified by PreCheckd — we're letting you know right away, for transparency, so you're aware and have the chance to respond.</p>
      <p><a href="${loginUrl}">Log in to see it</a></p>
    `,
  });
}

// Sent to an unverified/claim account when a candidate runs their email
// through the public Email Checker widget. Not an accusation — just an FYI
// that someone looked them up, plus a nudge to get verified. At most one
// per account per week (see Recruiter.lastLookupNudgeAt), however many
// lookups happen in that window, so it reads as useful rather than spammy.
async function sendLookupNudgeEmail(toEmail) {
  const loginUrl = `${process.env.APP_BASE_URL}/login`;

  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Someone looked up your email on PreCheckd',
    html: `
      <p>Hi,</p>
      <p>A candidate recently used PreCheckd's Email Checker tool to look into this email address. This isn't a report or any kind of accusation — candidates use this tool to research recruiters before responding to outreach.</p>
      <p>If you're a legitimate recruiter, getting verified on PreCheckd is the fastest way to show candidates you're trustworthy before they decide whether to engage.</p>
      <p><a href="${loginUrl}">Log in or get verified</a></p>
    `,
  });
}

// The admin login's second factor — sent to Kent directly rather than
// through SMS (which this reuses from the recruiter/candidate phone-
// verification path and depends on the destination number not being on
// AWS's opt-out suppression list, which turned out to be an issue here).
// Email doesn't have that failure mode, so it's the more reliable second
// factor for a single-admin login like this one.
async function sendAdminLoginCodeEmail(code) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: 'kent@precheckd.com',
    subject: 'Your PreCheckd admin login code',
    html: `
      <p>Your admin login code is: <strong>${code}</strong></p>
      <p>Enter this on the login page to finish signing in. It expires in 10 minutes.</p>
    `,
  });
}

// Sent to Kent directly (not a recruiter/candidate notice) when an IP hits
// the admin-login rate limit — a burst of wrong passwords/codes against
// the one shared admin secret. Debounced per IP so it's one heads-up per
// hour of continued hammering, not one email per rejected attempt.
async function sendAdminLoginAlertEmail(ip, attemptCount) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: 'kent@precheckd.com',
    subject: 'Repeated failed admin logins on PreCheckd',
    html: `
      <p>An IP address (${ip}) has made ${attemptCount} failed attempts against the internal admin login in the past hour and is now rate-limited.</p>
      <p>No action needed unless this keeps happening — the shared secret and SMS code are both still required either way.</p>
    `,
  });
}

// Recruiter's daily "new applicants" summary. Names only counts and postings, never candidate details.
async function sendApplicantDigestEmail(recruiter, groups) {
  const base = process.env.APP_BASE_URL;
  const total = groups.reduce((n, g) => n + g.count, 0);
  const lines = groups.map((g) => `<li><a href="${base}/recruiter-jobs/${g.jobId}/applicants" style="color:#1B7F4B;font-weight:700;">${weeklyEscape(g.title)}</a> at ${weeklyEscape(g.company)}: ${g.count} new applicant${g.count === 1 ? '' : 's'}</li>`).join('');
  const bodyHtml = `<p style="margin:0 0 14px;">Hi ${weeklyEscape(properName(recruiter.firstName))},</p>
    <p style="margin:0 0 6px;">${total} new applicant${total === 1 ? '' : 's'} since the last summary. Everyone listed met every requirement.</p>
    <ul style="margin:8px 0 0;padding-left:20px;">${lines}</ul>
    ${weeklyButton(`${base}/recruiter-jobs`, 'Open my job postings')}`;
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: recruiter.email,
    subject: `${total} new applicant${total === 1 ? '' : 's'} on PreCheckd`,
    html: brandShell({ bodyHtml, preheader: `${total} new applicant${total === 1 ? '' : 's'}`, footerHtml: `You get this because you post jobs on PreCheckd. Turn it off with the checkbox on <a href="${base}/recruiter-jobs" style="color:#6B7B80;">My job postings</a>.` }),
  });
}

module.exports = {
  brandedHtml,
  sendVerificationEmail,
  sendFraudClaimInviteEmail,
  sendFraudReportNoticeEmail,
  sendFraudReporterVerificationEmail,
  generateVerificationToken,
  sendPasswordResetEmail,
  sendCandidateVerificationLink,
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail,
  sendRecruiterConnectionAcceptedEmail,
  sendRecruiterConnectionDeclinedEmail,
  sendNewMessageEmail,
  sendMessageDigestEmail,
  sendCertExpiryReminderEmail,
  sendSkillNoticeEmail,
  sendStaffAlertEmail,
  sendVerificationNoticeEmail,
  sendEmployerVerificationEmail,
  sendWeeklyRecapEmail,
  weeklyJobsSection,
  sendApplicantDigestEmail,
  sendUnreadMessagesEmail,
  sendFraudReportThankYouEmail,
  sendLookupNudgeEmail,
  sendAdminLoginAlertEmail,
  sendAdminLoginCodeEmail,
  generateSixDigitCode
};