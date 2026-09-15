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

async function sendLoginEmail(toEmail, firstName, token) {
  const loginUrl = `${process.env.APP_BASE_URL}/login/verify?token=${token}`;

  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd login link',
    html: `
      <p>Hi ${firstName},</p>
      <p>Click the link below to log in to your PreCheckd account:</p>
      <p><a href="${loginUrl}">${loginUrl}</a></p>
      <p>This link expires in 15 minutes and can only be used once. If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

async function sendCandidateVerificationCode(toEmail, firstName, code) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd verification code',
    html: `
      <p>Hi ${firstName},</p>
      <p>Your verification code is: <strong>${code}</strong></p>
      <p>Enter this code to finish verifying your email address. This code expires in 10 minutes.</p>
    `,
  });
}

async function sendCandidateLoginCode(toEmail, firstName, code) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: toEmail,
    subject: 'Your PreCheckd login code',
    html: `
      <p>Hi ${firstName},</p>
      <p>Your login code is: <strong>${code}</strong></p>
      <p>Enter this code to log back into PreCheckd. This code expires in 10 minutes.</p>
    `,
  });
}

async function sendNewConnectionRequestEmail(recruiterEmail, recruiterFirstName, candidateName, candidateLinkedInUrl, note) {
  const dashboardUrl = `${process.env.APP_BASE_URL}/recruiter-dashboard/requests`;

  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: recruiterEmail,
    subject: 'New connection request on PreCheckd',
    html: `
      <p>Hi ${recruiterFirstName},</p>
      <p><strong>${candidateName}</strong> would like to connect with you on PreCheckd.</p>
      <p>LinkedIn: <a href="${candidateLinkedInUrl}">${candidateLinkedInUrl}</a></p>
      ${note ? `<p>Note from ${candidateName}: "${note}"</p>` : ''}
      <p><a href="${dashboardUrl}">Review this request</a></p>
    `,
  });
}

async function sendConnectionAcceptedEmail(candidateEmail, candidateFirstName, recruiterName, recruiterEmail) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `${recruiterName} accepted your connection request!`,
    html: `
      <p>Hi ${candidateFirstName},</p>
      <p>Good news — <strong>${recruiterName}</strong> accepted your connection request on PreCheckd.</p>
      <p>You can reach them directly at: <a href="mailto:${recruiterEmail}">${recruiterEmail}</a></p>
    `,
  });
}

async function sendConnectionDeclinedEmail(candidateEmail, candidateFirstName, recruiterName) {
  return resend.emails.send({
    from: 'PreCheckd <noreply@precheckd.com>',
    to: candidateEmail,
    subject: `Update on your PreCheckd connection request`,
    html: `
      <p>Hi ${candidateFirstName},</p>
      <p><strong>${recruiterName}</strong> was not able to connect at this time.</p>
      <p>You're welcome to reach out to other verified recruiters on PreCheckd.</p>
    `,
  });
}

module.exports = {
  sendVerificationEmail,
  generateVerificationToken,
  sendLoginEmail,
  sendCandidateVerificationCode,
  sendCandidateLoginCode,
  generateSixDigitCode,
  sendNewConnectionRequestEmail,
  sendConnectionAcceptedEmail,
  sendConnectionDeclinedEmail
};