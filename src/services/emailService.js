const { Resend } = require('resend');
const crypto = require('crypto');

const resend = new Resend(process.env.RESEND_API_KEY);

function generateVerificationToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateSixDigitCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

async function sendVerificationEmail(toEmail, firstName, token) {
  const verifyUrl = `${process.env.APP_BASE_URL}/api/founding-recruiter/verify-email?token=${token}`;

  return resend.emails.send({
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

  return resend.emails.send({
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

  return resend.emails.send({
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
  return resend.emails.send({
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
  return resend.emails.send({
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

  return resend.emails.send({
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

  return resend.emails.send({
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

module.exports = {
  sendVerificationEmail,
  generateVerificationToken,
  sendPasswordResetEmail,
  sendCandidateVerificationLink,
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail,
  sendNewMessageEmail,
  sendFraudReportThankYouEmail,
  generateSixDigitCode
};