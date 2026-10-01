const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);

const MOCK_EMAIL = process.env.MOCK_EMAIL === 'true';

// Every send in this file goes through here instead of calling
// resend.emails.send directly — with MOCK_EMAIL=true, nothing actually
// goes out, it just logs to the console. Use this during testing so you
// can use made-up/fake "reported" addresses without emailing real people,
// the same way MOCK_SMS/MOCK_IDENTITY already work for phone/identity.
async function sendEmail(params) {
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
      <p>Hi ${firstName},</p>
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
      <p>Hi ${firstName},</p>
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
      <p>Hi ${firstName},</p>
      <p>Click the link below to verify your email address for your PreCheckd profile:</p>
      <p><a href="${verifyUrl}">${verifyUrl}</a></p>
      <p>This link expires in 48 hours. If you didn't sign up for PreCheckd, you can safely ignore this email.</p>
    `,
  });
}

async function sendConnectionAcceptedEmail(candidateEmail, candidateFirstName, recruiterName, recruiterEmail) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `${recruiterName} accepted your connection request`,
    html: `
      <p>Hi ${candidateFirstName},</p>
      <p><strong>${recruiterName}</strong> accepted your connection request on PreCheckd.</p>
      <p>You can now reach them directly at: <strong>${recruiterEmail}</strong></p>
      <p>You can also message them directly through your PreCheckd inbox.</p>
    `,
  });
}

async function sendConnectionDeclinedEmail(candidateEmail, candidateFirstName, recruiterName) {
  return sendEmail({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `Update on your connection request`,
    html: `
      <p>Hi ${candidateFirstName},</p>
      <p><strong>${recruiterName}</strong> declined your connection request on PreCheckd.</p>
      <p>Don't be discouraged — keep browsing and connecting with other verified recruiters.</p>
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
      <p>Hi ${recipientFirstName},</p>
      <p><strong>${senderName}</strong> sent you a message on PreCheckd.</p>
      <p><a href="${inboxUrl}">View it in your inbox</a></p>
    `,
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

module.exports = {
  sendVerificationEmail,
  sendFraudClaimInviteEmail,
  generateVerificationToken,
  sendPasswordResetEmail,
  sendCandidateVerificationLink,
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail,
  sendNewMessageEmail,
  sendFraudReportThankYouEmail,
  generateSixDigitCode
};